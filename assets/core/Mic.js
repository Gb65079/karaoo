class Mic {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.currentVerseIndex = null;
    this.selectedDeviceId = null;
    
    // Aumentamos o limiar para 0.05 para ignorar barulho de fundo e sopros
    this.silenceThreshold = 0.05; 
    this.vocalPitches = []; // Armazena os pitches reais capturados durante o verso
  }
async getDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  }

  setDevice(deviceId) {
    this.selectedDeviceId = deviceId;
  }

  async startVerseRecording(verseIndex) {
    this.currentVerseIndex = verseIndex;
    this.audioChunks = [];
    this.vocalPitches = [];

    const constraints = {
      audio: {
        ...(this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.setupAudioAnalyser(stream);

      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(50); // Coleta a cada 50ms
      this.isRecording = true;
    } catch (err) {
      console.error("Erro ao acessar o microfone:", err);
    }
  }

  setupAudioAnalyser(stream) {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);

    const buffer = new Float32Array(this.analyser.fftSize);

    const processFrame = () => {
      if (!this.isRecording) return;

      this.analyser.getFloatTimeDomainData(buffer);

      // 1. Calcula energia RMS
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      const rms = Math.sqrt(sum / buffer.length);

      // 2. Só extrai o pitch se a energia da voz for SUPERIOR ao limiar de ruído
      if (rms > this.silenceThreshold) {
        const pitchHz = this.autoCorrelate(buffer, this.audioContext.sampleRate);
        if (pitchHz) {
          const midiNote = Math.round(12 * Math.log2(pitchHz / 440) + 69);
          // Salva apenas notas na extensão vocal humana real
          if (midiNote >= 36 && midiNote <= 85) {
            this.vocalPitches.push(midiNote);
          }
        }
      }

      requestAnimationFrame(processFrame);
    };

    processFrame();
  }

  // Algoritmo de Autocorrelação (YIN-based) direto na classe
  autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    const minFrequency = 80;
    const maxFrequency = 1000;
    const maxLag = Math.floor(sampleRate / minFrequency);
    const minLag = Math.floor(sampleRate / maxFrequency);

    let bestLag = -1;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0;
      for (let i = 0; i < SIZE - lag; i++) {
        correlation += buffer[i] * buffer[i + lag];
      }
      correlation = correlation / (SIZE - lag);

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestCorrelation > 0.25 && bestLag !== -1) {
      return sampleRate / bestLag;
    }
    return null;
  }

  async stopAndSend(expectedText, selectedLevel = 'easy') {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return resolve({ verseIndex: this.currentVerseIndex, points: 0, percentage: 0 });
      }

      this.mediaRecorder.onstop = async () => {
        if (this.mediaRecorder.stream) {
          this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
          await this.audioContext.close();
        }

        this.isRecording = false;

        // SE NÃO DETECTOU NENHUMA NOTA DE VOZ NO VERSO OU TEVE POUCAS AMOSTRAS -> 0 PONTOS
        if (this.vocalPitches.length < 5) {
          console.log("Sem voz/silêncio detectado. Pontuação: 0");
          return resolve({
            verseIndex: this.currentVerseIndex,
            sungText: "",
            percentage: 0,
            points: 0
          });
        }

        // Calcula a pontuação real permissiva baseada nas amostras capturadas
        const result = this.calculateRealScore(selectedLevel);
        resolve(result);
      };

      this.mediaRecorder.stop();
    });
  }

  calculateRealScore(selectedLevel) {
    // Quantidade de frames capturados com a voz válida
    const totalAmostrasVoz = this.vocalPitches.length;

    // Regra casual: se a pessoa cantou por pelo menos 1 a 2 segundos no verso
    let points = 0;
    let accuracy = 0;

    if (totalAmostrasVoz >= 10) {
      // Calcula uma pontuação proporcional à constância da voz
      accuracy = Math.min(100, Math.round((totalAmostrasVoz / 30) * 100));
      points = Math.round(accuracy * 0.8);

      if (selectedLevel === 'easy') {
        points = Math.min(100, points + 15);
      }
    }

    return {
      verseIndex: this.currentVerseIndex,
      sungText: "Voz detectada",
      percentage: accuracy,
      points: points
    };
  }
}