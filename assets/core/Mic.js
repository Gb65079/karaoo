class Mic {
  constructor(audioContext, outputNode = audioContext?.destination) {
    if (!audioContext) throw new Error('Mic precisa receber o AudioContext do Player.');
    this.audioContext = audioContext;
    this.outputNode = outputNode;
    this.mediaRecorder = null;
    this.stream = null;
    this.audioChunks = [];
    this.vocalPitches = [];
    this.currentVerseIndex = null;
    this.selectedDeviceId = null;
    this.verseStartTime = 0;
    this.isRecording = false;
    this.monitorEnabled = false;
    this.monitorVolume = 0.5;
    this.monitorGain = null;
    this.monitorFilter = null;
    this.monitorCompressor = null;
    this.micSourceNode = null;
    this.analyser = null;
    this.analysisFrame = null;
    this.silenceThreshold = 0.003;
    this.correlationThreshold = 0.1;
  }

  setDevice(deviceId) {
    this.selectedDeviceId = deviceId;
  }

  async startVerseRecording(verseIndex) {
    await this.resumeContext();
    this.stopAnalysis();
    this.currentVerseIndex = verseIndex;
    this.audioChunks = [];
    this.vocalPitches = [];
    this.verseStartTime = this.audioContext.currentTime;

    try {
      await this.ensureStream();
      this.isRecording = true;
      this.startAnalysis();
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };
      this.mediaRecorder.start(50);
    } catch (error) {
      this.isRecording = false;
      console.error('Erro ao acessar o microfone:', error);
      if (typeof window.openModal === 'function') window.openModal('<h3>Oops...</h3>Não foi possível acessar o microfone.');
    }
  }

  async resumeContext() {
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
  }

  async startMonitoring(enabled = false, volume = this.monitorVolume) {
    await this.resumeContext();
    this.monitorEnabled = enabled;
    this.monitorVolume = volume;
    await this.ensureStream();
    this.setMonitor(enabled, volume);
  }

  async ensureStream() {
    if (this.stream && this.stream.active) return;
    const constraints = {
      audio: {
        ...(this.selectedDeviceId ? { deviceId: { exact: this.selectedDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.setupAudioAnalyser(this.stream);
  }

  setMonitor(enabled, volume = 0.5) {
    this.monitorEnabled = enabled;
    this.monitorVolume = volume;
    if (!this.monitorGain) return;
    this.monitorGain.gain.setValueAtTime(enabled ? volume : 0, this.audioContext.currentTime);
  }

  setupAudioAnalyser(stream) {
    this.disconnectAudioNodes();
    this.micSourceNode = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.micSourceNode.connect(this.analyser);
    this.monitorFilter = this.audioContext.createBiquadFilter();
    this.monitorFilter.type = 'highpass';
    this.monitorFilter.frequency.value = 100;
    this.monitorCompressor = this.audioContext.createDynamicsCompressor();
    this.monitorCompressor.threshold.value = -30;
    this.monitorCompressor.knee.value = 18;
    this.monitorCompressor.ratio.value = 4;
    this.monitorCompressor.attack.value = 0.003;
    this.monitorCompressor.release.value = 0.2;
    this.monitorGain = this.audioContext.createGain();
    this.monitorGain.gain.setValueAtTime(this.monitorEnabled ? this.monitorVolume : 0, this.audioContext.currentTime);
    this.micSourceNode.connect(this.monitorFilter);
    this.monitorFilter.connect(this.monitorCompressor);
    this.monitorCompressor.connect(this.monitorGain);
    this.monitorGain.connect(this.outputNode);
  }

  startAnalysis() {
    const buffer = new Float32Array(this.analyser.fftSize);
    const processFrame = () => {
      if (!this.isRecording || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(buffer);
      const pitchHz = this.getPitch(buffer, this.audioContext.sampleRate);
      if (pitchHz) {
        const note = Math.round(12 * Math.log2(pitchHz / 440) + 69);
        if (note >= 36 && note <= 85) {
          this.vocalPitches.push({ tempo: Number((this.audioContext.currentTime - this.verseStartTime).toFixed(2)), nota: note });
        }
      }
      this.analysisFrame = requestAnimationFrame(processFrame);
    };
    processFrame();
  }

  stopAnalysis() {
    if (this.analysisFrame) cancelAnimationFrame(this.analysisFrame);
    this.analysisFrame = null;
  }

  disconnectAudioNodes() {
    if (this.micSourceNode) {
      try { this.micSourceNode.disconnect(); } catch (error) { }
    }
    if (this.monitorGain) {
      try { this.monitorGain.disconnect(); } catch (error) { }
    }
    if (this.monitorFilter) {
      try { this.monitorFilter.disconnect(); } catch (error) { }
    }
    if (this.monitorCompressor) {
      try { this.monitorCompressor.disconnect(); } catch (error) { }
    }
    this.micSourceNode = null;
    this.monitorGain = null;
    this.monitorFilter = null;
    this.monitorCompressor = null;
  }

  getPitch(buffer, sampleRate) {
    const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
    if (rms < this.silenceThreshold) return null;
    const minLag = Math.floor(sampleRate / 1200);
    const maxLag = Math.floor(sampleRate / 70);
    let bestLag = -1;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let correlation = 0;
      for (let index = 0; index < buffer.length - lag; index += 1) correlation += buffer[index] * buffer[index + lag];
      correlation /= buffer.length - lag;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    return bestCorrelation > this.correlationThreshold && bestLag !== -1 ? sampleRate / bestLag : null;
  }

  async stopAndSend(expectedGabaritoSlice = [], selectedLevel = 'easy') {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return { verseIndex: this.currentVerseIndex, points: 0, percentage: 0 };
    }

    return new Promise(resolve => {
      this.mediaRecorder.onstop = () => {
        this.stopAnalysis();
        this.isRecording = false;
        resolve(this.vocalPitches.length < 5 ? { verseIndex: this.currentVerseIndex, sungText: '', percentage: 0, points: 0 } : this.calculateRealScore(expectedGabaritoSlice, selectedLevel));
      };
      this.mediaRecorder.stop();
    });
  }

  close() {
    this.stopAnalysis();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.disconnectAudioNodes();
  }

  calculateRealScore(expectedGabaritoSlice, selectedLevel) {
    if (!expectedGabaritoSlice.length) {
      const percentage = Math.min(100, Math.round((this.vocalPitches.length / 30) * 100));
      let points = Math.round(percentage * 0.8);
      if (selectedLevel === 'easy') points = Math.min(100, points + 15);
      return { verseIndex: this.currentVerseIndex, sungText: 'Voz detectada', percentage, points };
    }

    const correctNotes = this.vocalPitches.filter(({ tempo, nota }) => {
      const target = expectedGabaritoSlice.reduce((closest, current) => Math.abs(current.tempo - tempo) < Math.abs(closest.tempo - tempo) ? current : closest);
      return Math.abs(target.nota - nota) <= 2;
    }).length;
    const percentage = Math.round((correctNotes / this.vocalPitches.length) * 100);
    const rules = { easy: { minCut: 20, maxCap: 70 }, medium: { minCut: 30, maxCap: 80 }, hard: { minCut: 45, maxCap: 90 } };
    const { minCut, maxCap } = rules[selectedLevel] || rules.easy;
    const points = percentage >= minCut ? Math.round(Math.min(1, (percentage - minCut) / (maxCap - minCut)) * 500) : 0;
    return { verseIndex: this.currentVerseIndex, sungText: `${correctNotes}/${this.vocalPitches.length} notas certas`, percentage, points };
  }
}
