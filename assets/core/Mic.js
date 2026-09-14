class Mic {
  constructor(sharedAudioContext = null) {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.currentVerseIndex = null;
    this.selectedDeviceId = null;

    // mesmos limiares usados na extração do gabarito — antes estavam desalinhados
    this.silenceThreshold = 0.003;
    this.correlationThreshold = 0.1;

    this.vocalPitches = []; // { tempo (relativo ao início do verso), nota }
    this.verseStartTime = 0;

    this.audioContext = sharedAudioContext || new (window.AudioContext || window.webkitAudioContext)();

    // monitor de voz no speaker — desligado por padrão, só liga se o usuário permitir
    this.monitorEnabled = false;
    this.monitorGain = null;
    this.micSourceNode = null;
  }

  async getDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  setDevice(deviceId) {
    this.selectedDeviceId = deviceId;
  }

  // chame isso a partir de um toggle/checkbox na UI, com o usuário decidindo explicitamente
  setMonitor(enabled, volume = 0.5) {
    this.monitorEnabled = enabled;
    if (this.monitorGain) {
      this.monitorGain.gain.value = enabled ? volume : 0;
    }
  }

  async startVerseRecording(verseIndex) {
    this.currentVerseIndex = verseIndex;
    this.audioChunks = [];
    this.vocalPitches = [];
    this.verseStartTime = this.audioContext.currentTime;

    const constraints = {
      audio: {
        ...(this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true // ligado de novo — sem isso o sinal fica fraco demais pro limiar de RMS
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.setupAudioAnalyser(stream);

      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };
      this.mediaRecorder.start(50);
      this.isRecording = true;
    } catch (err) {
      console.error("Erro ao acessar o microfone:", err);

      openModal(`<h3>Ooops...</h3>
        parece que o outro player está sem voz, essa partida não pode continuar...`);

        player.play();
        player.audio.src = "";

        setTimeout(()=>window.location.reload(),1000);
    }
  }

  setupAudioAnalyser(stream) {
    this.micSourceNode = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.micSourceNode.connect(this.analyser);

    // saída opcional pro speaker — some com o volume em 0 até o usuário permitir via setMonitor
    this.monitorGain = this.audioContext.createGain();
    this.monitorGain.gain.value = this.monitorEnabled ? 0.5 : 0;
    this.micSourceNode.connect(this.monitorGain);
    this.monitorGain.connect(this.audioContext.destination);

    const buffer = new Float32Array(this.analyser.fftSize);

    const processFrame = () => {
      if (!this.isRecording) return;

      this.analyser.getFloatTimeDomainData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      const rms = Math.sqrt(sum / buffer.length);

      if (rms > this.silenceThreshold) {
        const pitchHz = this.autoCorrelate(buffer, this.audioContext.sampleRate);
        if (pitchHz) {
          const midiNote = Math.round(12 * Math.log2(pitchHz / 440) + 69);
          if (midiNote >= 36 && midiNote <= 85) {
            this.vocalPitches.push({
              tempo: parseFloat((this.audioContext.currentTime - this.verseStartTime).toFixed(2)),
              nota: midiNote
            });
          }
        }
      }

      requestAnimationFrame(processFrame);
    };

    processFrame();
  }

  // mesma lógica que você já validou pro gabarito, agora também usada ao vivo
  autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    let sumOfSquares = 0;
    for (let i = 0; i < SIZE; i++) sumOfSquares += buffer[i] * buffer[i];
    const rms = Math.sqrt(sumOfSquares / SIZE);
    if (rms < 0.001) return null;

    const minFrequency = 70;
    const maxFrequency = 1200;
    const maxLag = Math.floor(sampleRate / minFrequency);
    const minLag = Math.floor(sampleRate / maxFrequency);

    let bestLag = -1;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0;
      for (let i = 0; i < SIZE - lag; i++) correlation += buffer[i] * buffer[i + lag];
      correlation = correlation / (SIZE - lag);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestCorrelation > this.correlationThreshold && bestLag !== -1) {
      return sampleRate / bestLag;
    }
    return null;
  }

  // agora recebe a fatia do gabarito correspondente ao verso, não mais um texto esperado
  async stopAndSend(expectedGabaritoSlice = [], selectedLevel = 'easy') {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return resolve({ verseIndex: this.currentVerseIndex, points: 0, percentage: 0 });
      }

      this.mediaRecorder.onstop = async () => {
        if (this.mediaRecorder.stream) {
          this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        this.isRecording = false;

        if (this.vocalPitches.length < 5) {
          console.log("Sem voz/silêncio detectado. Pontuação: 0");
          return resolve({ verseIndex: this.currentVerseIndex, sungText: "", percentage: 0, points: 0 });
        }

        const result = this.calculateRealScore(expectedGabaritoSlice, selectedLevel);
        resolve(result);
      };

      this.mediaRecorder.stop();
    });
  }

  calculateRealScore(expectedGabaritoSlice, selectedLevel) {
    // sem gabarito pra esse trecho -> cai pro modo "presença de voz", permissivo
    if (!expectedGabaritoSlice || expectedGabaritoSlice.length === 0) {
      const totalAmostrasVoz = this.vocalPitches.length;
      let accuracy = Math.min(100, Math.round((totalAmostrasVoz / 30) * 100));
      let points = Math.round(accuracy * 0.8);
      if (selectedLevel === 'easy') points = Math.min(100, points + 15);
      return { verseIndex: this.currentVerseIndex, sungText: "Voz detectada", percentage: accuracy, points };
    }

    // compara cada nota cantada com a nota esperada mais próxima no tempo, com tolerância de 2 semitons
    let acertos = 0;
    this.vocalPitches.forEach(({ tempo, nota }) => {
      const alvo = expectedGabaritoSlice.reduce((prev, curr) =>
        Math.abs(curr.tempo - tempo) < Math.abs(prev.tempo - tempo) ? curr : prev
      );
      if (Math.abs(alvo.nota - nota) <= 2) acertos++;
    });

    const accuracy = Math.round((acertos / this.vocalPitches.length) * 100);

    const rules = {
      easy: { minCut: 20, maxCap: 70 },
      medium: { minCut: 30, maxCap: 80 },
      hard: { minCut: 45, maxCap: 90 }
    };
    const { minCut, maxCap } = rules[selectedLevel] || rules.easy;

    let points = 0;
    if (accuracy >= minCut) {
      const scale = Math.min(1, (accuracy - minCut) / (maxCap - minCut));
      points = Math.round(scale * 500);
    }

    return {
      verseIndex: this.currentVerseIndex,
      sungText: `${acertos}/${this.vocalPitches.length} notas certas`,
      percentage: accuracy,
      points
    };
  }
}