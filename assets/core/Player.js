class Player {
  constructor() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('AudioContext não suportado neste ambiente.');
    this.audioContext = new AudioContextClass();
    this.outputBus = this.audioContext.createGain();
    this.outputBus.connect(this.audioContext.destination);
    this.audio = new Audio();
    this.liricle = new Liricle();
    this.preferences = {};
    this.players = [];
    this.mics = [];
    this.ready = false;
    this.gabarito = null;
    this.song = null;
    this.voiceFilter = this.createVoiceFilterState();
  }

  createVoiceFilterState() {
    return { audioSource: null, filtroAtivado: false, splitter: null, gainEsquerdo: null, gainDireito: null, merger: null };
  }

  setPlayers(playerConfigs) {
    this.players = playerConfigs;
    this.mics = this.players.map(() => new Mic(this.audioContext, this.outputBus));
    this.players.forEach((player, index) => {
      if (player.micId) this.mics[index].setDevice(player.micId);
    });
  }

  assignMic(playerIndex, deviceId) {
    if (!this.players[playerIndex] || !this.mics[playerIndex]) return;
    this.players[playerIndex].micId = deviceId;
    this.mics[playerIndex].setDevice(deviceId);
  }

  async listInputDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  }

  init(songConfig) {
    if (songConfig) this.song = songConfig;
    if (!this.song) throw new Error('Player.init() precisa receber uma música.');
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.audio.volume = 1;
    this.audio.src = this.song.file;
    this.loadEvents();
    this.createVoiceCancel();
    this.liricle.load({ text: this.song.lyrics });
    document.getElementById('music-title').textContent = this.song.title;
    document.getElementById('music-box-title').textContent = this.song.title;
    this.liricle.offset = -100;
    if (this.preferences.gameType === 'multiplayer' && typeof window.multiplayerMode === 'function') window.multiplayerMode();
  }

  async play() {
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    if (!this.audio.firstPlay) {
      this.audio.currentTime = 0;
      this.audio.firstPlay = true;
    }
    if (this.audio.paused) await this.audio.play().catch(error => console.error('Erro no play:', error));
    else this.audio.pause();
  }

  async generateGabarito() {
    const response = await fetch(this.audio.src);
    const arrayBuffer = await response.arrayBuffer();
    const decodedAudio = await this.audioContext.decodeAudioData(arrayBuffer);
    return this.extractPitchGuide(decodedAudio, 50);
  }

  extractPitchGuide(audioBuffer, intervalMs) {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const intervalSize = Math.floor(sampleRate * intervalMs / 1000);
    const windowSize = 2048;
    const guide = [];
    for (let index = 0; index < channelData.length - windowSize; index += intervalSize) {
      const pitchHz = this.getPitch(channelData.subarray(index, index + windowSize), sampleRate);
      if (!pitchHz) continue;
      const note = Math.round(12 * Math.log2(pitchHz / 440) + 69);
      if (note >= 36 && note <= 84) guide.push({ tempo: Number((index / sampleRate).toFixed(2)), nota: note });
    }
    return guide;
  }

  getPitch(buffer, sampleRate) {
    const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
    if (rms < 0.001) return null;
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
    return bestCorrelation > 0.1 && bestLag !== -1 ? sampleRate / bestLag : null;
  }

  async linkThumb(songName) {
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(songName)}&entity=song&limit=1`);
    const data = await response.json();
    if (!data.results.length) return;
    const image = document.getElementById('music-thumb');
    image.src = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
    image.style.display = 'block';
  }

  loadEvents() {
    this.audio.onplay = () => document.getElementById('play').innerHTML = '<i class="icon-pause"></i>';
    this.audio.onpause = () => document.getElementById('play').innerHTML = '<i class="icon-play_arrow"></i>';
    this.audio.ontimeupdate = () => {
      this.liricle.sync(this.audio.currentTime, false);
      document.getElementById('duration').textContent = `${this.calculateTotalValue(this.audio.currentTime)} / ${this.calculateTotalValue(this.audio.duration)}`;
    };
    this.audio.onerror = error => console.error('Erro crítico ao carregar a faixa de áudio:', error);
    this.audio.oncanplaythrough = async () => {
      this.linkThumb(this.song.title);
      this.ready = true;
      document.getElementById('duration').textContent = `00:00 / ${this.calculateTotalValue(this.audio.duration)}`;
      if (this.gabarito) return;
      try {
        this.gabarito = await this.generateGabarito();
        if (typeof window.closeModal === 'function') window.closeModal();
      } catch (error) {
        console.error('Erro ao gerar gabarito:', error);
        if (typeof window.openModal === 'function') window.openModal('<h3>Oops...</h3>Não foi possível gerar o gabarito.');
      }
    };

    let previousVerseStart = null;
    const selectedLevel = 'medium';
    this.audio.onended = async () => {
      if (previousVerseStart !== null) {
        const slice = (this.gabarito || []).filter(point => point.tempo >= previousVerseStart);
        const results = await Promise.all(this.mics.map(mic => mic.stopAndSend(slice, selectedLevel)));
        results.forEach((result, index) => this.players[index].points += result.points);
      }
      this.mics.forEach(mic => mic.close());
      if (typeof window.finish === 'function') window.finish();
    };

    this.liricle.on('sync', async line => {
      if (previousVerseStart !== null && this.preferences.gamePoints) {
        await new Promise(resolve => setTimeout(resolve, 700));
        const slice = (this.gabarito || []).filter(point => point.tempo >= previousVerseStart && point.tempo < line.time).map(point => ({ tempo: point.tempo - previousVerseStart, nota: point.nota }));
        const results = await Promise.all(this.mics.map(mic => mic.stopAndSend(slice, selectedLevel)));
        results.forEach((result, index) => this.updateScore(result, index));
      }
      previousVerseStart = line.time;
      this.mics.forEach(mic => mic.startVerseRecording(line.index));
      this.selectVerse(line.index);
    });

    this.liricle.on('load', data => {
      document.querySelectorAll('.box-player').forEach((box, playerIndex) => {
        const content = box.querySelector('.content') || box.querySelector('#content');
        if (content) content.innerHTML = data.lines.map((line, lineIndex) => `<div class="verse" id="verse-${playerIndex}-${lineIndex}">${line.text}</div>`).join('');
      });
    });
  }

  updateScore(result, index) {
    const player = this.players[index];
    if (player.points <= 1000) player.points += result.points < 50 ? -25 : result.points;
    const pointsElement = document.querySelector(`.points[data-player="${player.player}"]`);
    if (!pointsElement) return;
    pointsElement.textContent = `+ ${result.points}`;
    pointsElement.classList.toggle('up', result.points > 50);
    pointsElement.classList.toggle('down', result.points <= 50);
  }

  selectVerse(lineIndex) {
    document.querySelectorAll('.verse.selected').forEach(element => element.classList.remove('selected'));
    document.querySelectorAll('.box-player').forEach((box, playerIndex) => {
      const verse = box.querySelector(`#verse-${playerIndex}-${lineIndex}`);
      if (verse) {
        verse.classList.add('selected');
        verse.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  createVoiceCancel() {
    if (this.voiceFilter.audioSource) return;
    const filter = this.voiceFilter;
    filter.audioSource = this.audioContext.createMediaElementSource(this.audio);
    filter.splitter = this.audioContext.createChannelSplitter(2);
    filter.gainEsquerdo = this.audioContext.createGain();
    filter.gainDireito = this.audioContext.createGain();
    filter.gainDireito.gain.value = -1;
    filter.merger = this.audioContext.createChannelMerger(2);
    filter.audioSource.connect(this.outputBus);
  }

  activateVoiceCancel() {
    if (this.voiceFilter.filtroAtivado) return;
    const filter = this.voiceFilter;
    filter.audioSource.disconnect();
    filter.audioSource.connect(filter.splitter);
    filter.splitter.connect(filter.gainEsquerdo, 0);
    filter.splitter.connect(filter.gainDireito, 1);
    filter.gainEsquerdo.connect(filter.merger, 0, 0);
    filter.gainEsquerdo.connect(filter.merger, 0, 1);
    filter.gainDireito.connect(filter.merger, 0, 0);
    filter.gainDireito.connect(filter.merger, 0, 1);
    filter.merger.connect(this.outputBus);
    filter.filtroAtivado = true;
  }

  deactivateVoiceCancel() {
    if (!this.voiceFilter.filtroAtivado) return;
    const filter = this.voiceFilter;
    filter.audioSource.disconnect();
    filter.splitter.disconnect();
    filter.gainEsquerdo.disconnect();
    filter.gainDireito.disconnect();
    filter.merger.disconnect();
    filter.audioSource.connect(this.outputBus);
    filter.filtroAtivado = false;
  }

  calculateTotalValue(length) {
    if (!Number.isFinite(length)) return '00:00';
    return `${String(Math.floor(length / 60)).padStart(2, '0')}:${String(Math.floor(length % 60)).padStart(2, '0')}`;
  }
}
