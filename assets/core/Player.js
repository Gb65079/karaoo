
class Player {
  constructor() {
    this.audio = new Audio();
    this.liricle = new Liricle();
    this.preferences = {};
    this.players = {};

    this.mic = new Mic();

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

  init() {
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
    if(this.preferences.gameType == "multiplayer") multiplayerMode();
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
      document.getElementById('duration').innerHTML = this.calculateTotalValue(this.audio.currentTime) + ' / ' + this.calculateTotalValue(this.audio.duration);
    };

    this.audio.onerror = (e) => {
      console.error("Erro crítico ao carregar a faixa de áudio:", e);
    };

    this.audio.oncanplaythrough=async()=>{
      this.linkThumb(song.title)
      document.getElementById('duration').innerHTML = '00:00 / ' + this.calculateTotalValue(this.audio.duration);
      gerarGabaritoDoAudioObject(this.audio).then(gabarito => {
      console.log(gabarito)
      closeModal();
});
    
    }

    let previousVerseText = "";
    const selectedLevel = "medium";

    this.audio.onended = async () => {
      if (previousVerseText) {
        const finalResult = await this.mic.stopAndSend(previousVerseText, selectedLevel);
        
        previousVerseText = "";


      }
      finish();
      console.log(`Final Game Score: ${this.players.points}`);
    };
this.liricle.on('sync', async (line) => {
  if (previousVerseText) {
    // Pequena folga para o áudio alcançar a sincronização
    await new Promise(r => setTimeout(r, 700));
    
    // Finaliza a gravação do verso anterior e obtém a pontuação
    const result = await this.mic.stopAndSend(previousVerseText, selectedLevel);

    console.log(`Verse Index: ${result.verseIndex}`);
    console.log(`Expected: "${previousVerseText}"`);
    console.log(`Sung: "${result.sungText}"`);
    console.log(`Accuracy: ${result.percentage}%`);
    console.log(`Points Awarded: ${result.points}`);

    // --- ENCAIXE DA PONTUAÇÃO NA TELA ---
    const pointsEl = document.getElementsByClassName("points")[0];
    if (pointsEl) {
      pointsEl.innerHTML = result.points;
      
      // Feedback visual se a pontuação foi baixa (<= 50) ou alta
      if (result.points <= 50) {
        pointsEl.classList.add("down");
      } else {
        pointsEl.classList.remove("down");
      }
    }

    // Acumula os pontos no jogador atual
    if (!this.players.points) this.players.points = 0;
    this.players.points += result.points;
  }

  // Prepara o texto e inicia a gravação do novo verso
  previousVerseText = line.text;
  this.mic.startVerseRecording(line.index);

  // Destaque visual do verso em execução no scroll da letra
  const boxes = document.querySelectorAll(".box-player");
  document.querySelectorAll(".verse.selected").forEach(el => el.classList.remove('selected'));

  boxes.forEach((box, playerIndex) => {
    const content = box.querySelector('.content') || box.querySelector('#content');
    if (!content) return;

    const targetVerse = content.querySelector(`#verse-${playerIndex}-${line.index}`);
    if (targetVerse) {
      targetVerse.classList.add('selected'); 
      targetVerse.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
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