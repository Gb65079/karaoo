class Player {
  constructor() {
    this.audio = new Audio();
    this.liricle = new Liricle();
    this.preferences = {};
    this.players = [];
    this.mics = [];
    this.ready = false;
    this.gabarito = null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass();

    this.voiceFilter = {
      audioSource: null,
      filtroAtivado: false,
      splitter: null,
      gainEsquerdo: null,
      gainDireito: null,
      inverterFase: null,
      merger: null
    };
  }

  // chame isso quando os jogadores forem definidos (fora da classe), antes de init()
  setPlayers(playerConfigs) {
    this.players = playerConfigs;
    this.mics = this.players.map(() => new Mic(this.audioContext));
  }

  assignMic(playerIndex, deviceId) {
    this.players[playerIndex].micId = deviceId;
    this.mics[playerIndex].setDevice(deviceId);
  }

  async listInputDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  init() {
    if (!this.players.length) {
      console.warn("Player.init() chamado sem jogadores definidos — chame setPlayers() antes.");
    }

    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.audio.volume = 1;
    this.audio.src = song.file;

    this.loadEvents();
    this.createVoiceCancel();

    this.liricle.load({ text: song.lyrics });
    document.getElementById('music-title').innerHTML = song.title;
    document.getElementById('music-box-title').innerHTML = song.title;
    this.liricle.offset = -100;
    if (this.preferences.gameType == "multiplayer") multiplayerMode();
  }

  async play() {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (!this.audio.firstPlay) {
      this.audio.currentTime = 0;
      this.audio.firstPlay = true;
    }

    if (this.audio.paused) {
      this.audio.play().catch(e => console.error("Erro no play:", e));
    } else {
      this.audio.pause();
    }
  }

  async linkThumb(nomeMusica) {
       const query = encodeURIComponent(nomeMusica);
  const response = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`);
  const data = await response.json();

  if (data.results.length > 0) {
    // Substitui a resolução padrão de 100x100 por 600x600
    const urlCapa = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
          const img = document.getElementById('music-thumb');
          img.src = urlCapa;
          img.style.display = 'block';
  }
  }
  loadEvents() {
    this.audio.onplay = () => {
      const playIcon = document.getElementById('play');
      if (playIcon) playIcon.innerHTML = '<i class="icon-pause"></i>';
    };
    this.audio.onpause = () => {
      const playIcon = document.getElementById('play');
      if (playIcon) playIcon.innerHTML = '<i class="icon-play_arrow"></i>';
    };
    this.audio.ontimeupdate = () => {
      this.liricle.sync(this.audio.currentTime, false);
      document.getElementById('duration').innerHTML =
        this.calculateTotalValue(this.audio.currentTime) + ' / ' + this.calculateTotalValue(this.audio.duration);
    };
    this.audio.onerror = (e) => console.error("Erro crítico ao carregar a faixa de áudio:", e);

    this.audio.oncanplaythrough = async () => {
      this.linkThumb(song.title);
      this.ready = true;
      document.getElementById('duration').innerHTML = '00:00 / ' + this.calculateTotalValue(this.audio.duration);
      if (!this.gabarito) {
        gerarGabaritoDoAudioObject(this.audio).then(gabarito => {
          if(gabarito == "err") return openModal(`<h3>Oops...</h3>
    parece que o gabarito não foi gerado... oque deseja fazer?
    
    <div class="button" onclick="window.location.reload()">reiniciar player</div>
    <div class="button another" onclick="gerarGabaritoDoAudioObject(this.audio) \n closeModal()">tentar gerar de novo</div>
    `)
          this.gabarito = gabarito;
          closeModal();
        });
      }
    };

    let previousVerseStart = null;
    const selectedLevel = "medium";

    this.audio.onended = async () => {
      if (previousVerseStart !== null) {
        const slice = (this.gabarito || []).filter(p => p.tempo >= previousVerseStart);
        const results = await Promise.all(this.mics.map(mic => mic.stopAndSend(slice, selectedLevel)));
        results.forEach((result, i) => {
          this.players[i].points += result.points;
        });
      }
      finish();
      console.log("Final scores:", this.players.map(p => `P${p.player}: ${p.points}`));
    };

    this.liricle.on('sync', async (line) => {
      if (previousVerseStart !== null && player.preferences.gamePoints) {
        await new Promise(r => setTimeout(r, 700)); // folga pra captura terminar

        const slice = (this.gabarito || [])
          .filter(p => p.tempo >= previousVerseStart && p.tempo < line.time)
          .map(p => ({ tempo: p.tempo - previousVerseStart, nota: p.nota }));

        // para e avalia todos os mics em paralelo
        const results = await Promise.all(this.mics.map(mic => mic.stopAndSend(slice, selectedLevel)));

        results.forEach((result, i) => {
    if(this.players[i].points <= 1000) {
    if(result.points < 50) this.players[i].points -= 25;
    else this.players[i].points += result.points
    }
    console.log(`P${this.players[i].player} — Verse ${result.verseIndex}: ${result.percentage}% (+${result.points})`);

    const pointsEl = document.querySelector(`.points[data-player="${this.players[i].player}"]`);
    if (pointsEl) {
        pointsEl.textContent = `+ ${result.points}`;
        pointsEl.classList.toggle("up", result.points > 50);
        pointsEl.classList.toggle("down", result.points <= 50);
    }
});
      }

      previousVerseStart = line.time;

      // inicia a gravação em todos os mics ao mesmo tempo
      this.mics.forEach(mic => mic.startVerseRecording(line.index));

      // destaque visual do verso — igual ao que você já tinha
      const boxes = document.querySelectorAll(".box-player");
      document.querySelectorAll(".verse.selected").forEach(el => el.classList.remove('selected'));
      boxes.forEach((box, playerIndex) => {
        const content = box.querySelector('.content') || box.querySelector('#content');
        if (!content) return;
        const targetVerse = content.querySelector(`#verse-${playerIndex}-${line.index}`);
        if (targetVerse) {
          targetVerse.classList.add('selected');
          targetVerse.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });

    this.liricle.on("load", (data) => {
      const boxes = document.querySelectorAll('.box-player');
      boxes.forEach((box, playerIndex) => {
        const content = box.querySelector('.content') || box.querySelector('#content');
        if (content) {
          content.innerHTML = data.lines
            .map((line, lineIndex) => `<div class='verse' id='verse-${playerIndex}-${lineIndex}'>${line.text}</div>`)
            .join('');
        }
      });
    });
  }

  
  createVoiceCancel() {
    this.voiceFilter.audioSource = this.audioContext.createMediaElementSource(this.audio);
    this.voiceFilter.splitter = this.audioContext.createChannelSplitter(2);
    this.voiceFilter.gainEsquerdo = this.audioContext.createGain();
    this.voiceFilter.gainDireito = this.audioContext.createGain();
    this.voiceFilter.inverterFase = this.audioContext.createGain();
    this.voiceFilter.inverterFase.gain.value = -1;
    this.voiceFilter.merger = this.audioContext.createChannelMerger(2);

    this.voiceFilter.audioSource.connect(this.audioContext.destination);
  }

  activateVoiceCancel() {
    if (this.voiceFilter.filtroAtivado) return;

    this.voiceFilter.audioSource.disconnect();

    // Roteamento L - R (Center Channel Cancellation)
    this.voiceFilter.audioSource.connect(this.voiceFilter.splitter);

    // Canal L
    this.voiceFilter.splitter.connect(this.voiceFilter.gainEsquerdo, 0);
    this.voiceFilter.gainEsquerdo.connect(this.voiceFilter.merger, 0, 0);

    // Canal R invertido enviado ao L para cancelar frequências do centro
    this.voiceFilter.splitter.connect(this.voiceFilter.gainDireito, 1);
    this.voiceFilter.gainDireito.connect(this.voiceFilter.inverterFase);
    this.voiceFilter.inverterFase.connect(this.voiceFilter.merger, 0, 0);

    // Copia o resultado para o canal R
    this.voiceFilter.gainEsquerdo.connect(this.voiceFilter.merger, 0, 1);

    this.voiceFilter.merger.connect(this.audioContext.destination);
    this.voiceFilter.filtroAtivado = true;
  }
  calculateTotalValue(length) {
  var minutes = Math.floor(length / 60);
    var  seconds_int = length - minutes * 60;
if(seconds_int < 10){
  seconds_int = "0"+seconds_int;
}

if(minutes < 10){
  minutes = "0"+minutes;
}
    var seconds_str = seconds_int.toString();
     var  seconds = seconds_str.substr(0, 2);
      var time = minutes + ':' + seconds;
//console.info(seconds_int)
  return time
}
}