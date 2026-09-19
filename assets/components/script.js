const songs = [{
    title: "Amor de Que - Pabllo Vittar",
    file: "../songs/pablo.mp3",
    lyrics: `[ti:Amor de Que]
[ar:Pabllo Vittar]
[al:111]
[length:02:38]

[00:13.81]O que os olhos não veem, o coração não sente
[00:17.57]Eu tenho um jeito de amar bem diferente
[00:20.73]O que você não vê é que as outras mentem
[00:24.48]Eu tô dizendo a verdade na tua frente
[00:27.61]Veja bem, não é maldade
[00:31.14]É que tem tanto homem bonito na cidade
[00:34.42]E eu tô na flor da idade
[00:38.01]Melhor se arrepender do que passar vontade
[00:41.46]Eu espero que você entenda
[00:45.06]Que o meu amor é amor de quenga
[00:48.35]Eu não quero que você se prenda
[00:51.81]No meu amor, amor de quenga
[00:55.67]Eu sento, tu sente
[00:57.42]Eu sento, tu sente
[00:59.19]Eu sento, tu sente
[01:00.93]Assim é a gente
[01:02.72]Eu sento, tu sente
[01:04.37]Eu sento, tu sente
[01:06.00]Eu sento, tu sente
[01:07.70]Assim é a gente
[01:15.51]O que os olhos não veem, o coração não sente
[01:19.22]Eu tenho um jeito de amar bem diferente
[01:22.32]O que você não vê é que as outras mentem
[01:26.10]Eu tô dizendo a verdade na tua frente
[01:29.39]Veja bem, não é maldade
[01:32.96]É que tem tanto homem bonito na cidade
[01:36.16]E eu tô na flor da idade
[01:39.64]Melhor se arrepender do que passar vontade
[01:43.21]Eu espero que você entenda
[01:46.67]Que o meu amor é amor de quenga
[01:50.01]Eu não quero que você se prenda
[01:53.52]No meu amor, amor de quenga
[01:57.24]Eu sento, tu sente
[01:59.04]Eu sento, tu sente
[02:00.71]Eu sento, tu sente
[02:02.45]Assim é a gente
[02:04.48]Eu sento, tu sente
[02:06.03]Eu sento, tu sente
[02:07.76]Eu sento, tu sente
[02:09.35]Assim é a gente
[02:13.39]Meu amor
[02:15.32]Eu te amo, pai, tu sabe
[02:18.66]Mas o meu amor é amor de quenga`
}, {
    title: "-",
    file: "",
    lyrics: ``
}]

let song = null;
const player = new Player();

let steps = 0;

function multiplayerMode() {
        const main = document.getElementsByTagName('main')[0]
        
        document.getElementsByTagName('header')[0]
        .innerHTML += `
        <div class="user connected" id="player2">
            <img src="../avatars/avatar${getAvatarRandom()}.png" alt="User">
            <div class="status">
            </div>
        </div>`;

        main.querySelector(".box-player").classList.add("multiplayer");

        main.innerHTML += `
        <div class="box-player multiplayer toOpen" id="player2">
            <div class="points" data-player="2">0</div>
            <h2>${song.title}</h2>
            <div id="content">
                ${player.liricle.data.lines.map((line, index) => `<div class='verse' id='verse-1-${index}'>${line.text}</div>`).join('')}
            </div>
        </div>`;
    }

function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  
  // 1. Calcula RMS
  let sumOfSquares = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    sumOfSquares += val * val;
  }
  const rms = Math.sqrt(sumOfSquares / SIZE);
  
  // REDUZIDO: de 0.01 para 0.001 para não descartar o MP3
  if (rms < 0.001) return null;

  const minFrequency = 70;   // C2 (nota bem grave)
  const maxFrequency = 1200; // D6 (nota aguda)
  
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

  // REDUZIDO: de 0.3 para 0.1 (permite capturar a frequência mesmo com instrumentos de fundo)
  if (bestCorrelation > 0.1 && bestLag !== -1) {
    return sampleRate / bestLag;
  }

  return null;
}

function extrairGabaritoPitch(audioBuffer, intervaloMs = 100) { // 100ms é ideal para gabarito leve
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0); // Canal esquerdo/mono
  const samplesPorIntervalo = Math.floor((sampleRate * intervaloMs) / 1000);
  const windowSize = 2048; 
  const gabarito = [];

  for (let i = 0; i < channelData.length - windowSize; i += samplesPorIntervalo) {
    const tempoSegundos = parseFloat((i / sampleRate).toFixed(2));
    
    // Pega o trecho do buffer
    const slice = channelData.subarray(i, i + windowSize);

    const pitchHz = autoCorrelate(slice, sampleRate);
    
    if (pitchHz) {
      const notaMidi = Math.round(12 * Math.log2(pitchHz / 440) + 69);
      
      // Filtra notas fora do alcance vocal (ex: 36 a 84 no MIDI)
      if (notaMidi >= 36 && notaMidi <= 84) {
        gabarito.push({
          tempo: tempoSegundos,
          nota: notaMidi
        });
      }
    }
  }

  return gabarito;
}

// 2. FUNÇÃO PRINCIPAL: Passa a sua instância do new Audio()
async function gerarGabaritoDoAudioObject(audioInstance) {
    try {
  console.log("Baixando e decodificando o áudio da URL:", audioInstance.src);

  // Pega a URL contida no audioInstance.src (ex: 'assets/musica.mp3' ou 'http://...')
  const response = await fetch(audioInstance.src);
  const arrayBuffer = await response.arrayBuffer();

  // Decodifica os dados de áudio na memória
  const audioCtx = new AudioContext();
  const decodedAudio = await audioCtx.decodeAudioData(arrayBuffer);

  // Gera o gabarito (a cada 50ms)
  const gabarito = extrairGabaritoPitch(decodedAudio, 50);

  console.log("Gabarito gerado com sucesso!", gabarito);
  if(!gabarito) openModal(`<h3>Oops...</h3>
    parece que o gabarito não foi gerado... oque deseja fazer?
    
    <div class="button" onclick="window.location.reload()">reiniciar player</div>
    <div class="button another" onclick="gerarGabaritoDoAudioObject(this.audio) \n closeModal()">tentar gerar de novo</div>
    `)
  return gabarito;
} catch(e) {
    console.log(e)
    openModal(`<h3>Oops...</h3>
    parece que o gabarito não foi gerado... oque deseja fazer?
    
    <div class="button" onclick="window.location.reload()">reiniciar player</div>
    <div class="button another" onclick="gerarGabaritoDoAudioObject(this.audio) \n closeModal()">tentar gerar de novo</div>
    `)
}
}

function openModal(content) {
    const modal = document.querySelector('#modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    modal.querySelector(".modal-container").innerHTML = content;
}

function closeModal() {
    const modal = document.querySelector('#modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}


function collectInfos(info) {
    closeModal();

    if(info == "dueto") {
        steps = 3;
        player.preferences.gameType = info;
    }

    switch (steps) {

    case 0: openModal(`
        <h3 style="margin: 2px">Qual modo de jogo prefere?</h3>
        você prefere cantar sozinho ou em grupo<br><br>
        <div class="button" onclick="collectInfos('multiplayer')">multiplayer</div>
        <div class="button another" onclick="collectInfos('singleplayer')">singleplayer</div>
        <div class="button" onclick="collectInfos('dueto')">dueto</div>
        
        `)
    break;

    case 1:
        player.preferences.gameType = info;
        openModal(`
        <h3 style="margin: 2px">Pontuar</h3>
        você prefere que seu canto seja pontuado?<br><br>
        <div class="button" onclick="collectInfos(true)">pontuar</div>
        <div class="button another" onclick="collectInfos(false)">sem competição</div>
        
        `)

    break;

    case 2: 
        player.preferences.gamePoints = info;
        openModal(`
        <h3 style="margin: 2px">Captação</h3>
        você prefere que seu jogo sobreponha a voz por cima?<br><br>
        <div class="button" onclick="collectInfos(true)">captar</div>
        <div class="button another" onclick="collectInfos(false)">sem captar</div>
        
        `)

    break;

    case 3: {
        let songsmapped;

        songs.map((x, i = 0)=>{

             songsmapped += `
            <div class="music-box" onclick="collectInfos(${i})"><h3>${x.title}</h3></div>
            `
             i++;
        }).join(" ")
        player.preferences.gameCaption = info;
        openModal(`
        <h3 style="margin: 2px">Música</h3>
        Qual música você quer cantar?
        ${songsmapped}
        `)

    break;
    }

    case 4:
    case 5: {
    if (!song) song = songs[info];
    else player.players[0].micId = info;

    if (!Array.isArray(player.players) || player.players.length === 0) {
        const configs = player.preferences.gameType === "multiplayer"
            ? [{ player: 1, micId: null, points: 0 }, { player: 2, micId: null, points: 0 }]
            : [{ player: 1, micId: null, points: 0 }];
        player.setPlayers(configs);
    }

    (async () => {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const microfones = devices.filter(device => device.kind === 'audioinput');

        const listaFormatada = microfones.map((mic, index) => ({
            id: mic.deviceId,
            nome: mic.label || `Microfone ${index + 1}`,
            disponivel: player.players?.find(h => h.micId == mic.deviceId) ? false : true
        }));

        openModal(`
        <h3 style="margin: 2px">Como escuto</h3>
        ${player.players[0].micId ? "qual microfone o segundo jogador vai jogar?" : "qual microfone você vai usar?"}
        ${listaFormatada.map(x =>
            x.disponivel ? `<div class="mic-box" onclick="collectInfos('${x.id}')"><i class='icon-mic'></i> ${x.nome}</div>` : ""
        ).join(" ")}
        `);
    })();

    if(steps == 4 && (
        player.preferences.gameType == "singleplayer" || 
        player.preferences.gameType == "dueto" 
    )
 ) steps = 5; 
    break;
}

case 6:

    if(player.preferences.gameType == "multiplayer") {
    player.players[1].micId = info;
    player.assignMic(0, player.players[0].micId);
    player.assignMic(1, player.players[1].micId);
    } else {
        player.players[0].micId = info;
    }

    openModal(`
    <h3 style="margin: 2px">Tudo Pronto!</h3>
    Antes de você cantar... vamos gerar o gabarito das notas....
    `);

    player.init(); // linha órfã "player.mic.setDevice(...)" removida
    break;
    }

    steps = steps + 1;
}

function morePoints(array, atributo) {
  if (!array || array.length === 0) return null; // Evita erros se o array estiver vazio

  return array.reduce((maior, atual) => {
    return atual[atributo] > maior[atributo] ? atual : maior;
  });
}

function finish() {
    if (player.preferences.gameType === "multiplayer") {
        finishMultiplayer();
    } else {
        finishSingleplayer();
    }
}

function finishSingleplayer() {
    const finishScreen = document.getElementsByClassName("finish-screen")[0];
    const user = document.getElementsByClassName("user");

    finishScreen.classList.add("show");
    document.body.style.overflow = "hidden";

    setTimeout(() => {
        finishScreen.style.background = "var(--background)";

        user[0].querySelector("img").style.transform = "scale(2.30)";
        user[0].style.top = "50%";
        user[0].style.right = "50%"; // centralizado, sem par pra dividir o espaço

        const userStatus = user[0].querySelector(".status");
        userStatus.classList.add('big');

        for (let i = -1; i <= player.players[0].points; i++) {
            setTimeout(() => {
                if (i > 500) {
                    userStatus.classList.add("points-up");
                    userStatus.classList.contains("points-minus") ?
                        userStatus.classList.remove("points-minus") : "";
                } else if (i > 100) {
                    userStatus.classList.add("points-minus");
                    userStatus.classList.contains("points-down") ?
                        userStatus.classList.remove("points-down") : "";
                } else {
                    userStatus.classList.add("points-down");
                }
                userStatus.innerHTML = i;

                if (i >= player.players[0].points) {
                    userStatus.classList.add("finish");
                    userStatus.classList.remove('big');
                }
            }, i * 10);
        }

        // etapa final: dá destaque ao avatar único, sem comparação com ninguém
        setTimeout(() => {
            user[0].querySelector("img").style.transform = "scale(5)";
        }, player.players[0].points * 10 + 200);

    }, 800);
}

// a função original, renomeada, cuidando só do caso multiplayer
function finishMultiplayer() {
    const finishScreen = document.getElementsByClassName("finish-screen")[0];
    const user = document.getElementsByClassName("user");

    finishScreen.classList.add("show");
    document.body.style.overflow = "hidden";

    setTimeout(() => {
        finishScreen.style.background = "var(--background)";

        user[0].querySelector("img").style.transform = "scale(2.30)";
        user[0].style.top = "50%";
        user[0].style.right = "65%";

        user[1].querySelector("img").style.transform = "scale(2.30)";
        user[1].style.top = "50%";
        user[1].style.right = "35%";

        const userStatus = user[0].querySelector(".status");
        const userStatus2 = user[1].querySelector(".status");

        userStatus.classList.add('big');
        userStatus2.classList.add('big');

        for (let i = -1; i <= player.players[0].points; i++) {
            setTimeout(() => {
                if (i > 500) {
                    userStatus.classList.add("points-up");
                    userStatus.classList.contains("points-minus") ?
                        userStatus.classList.remove("points-minus") : "";
                } else if (i > 100) {
                    userStatus.classList.add("points-minus");
                    userStatus.classList.contains("points-down") ?
                        userStatus.classList.remove("points-down") : "";
                } else userStatus.classList.add("points-down");
                userStatus.innerHTML = i;

                if (i >= player.players[0].points) {
                    userStatus.classList.add("finish");
                    userStatus.classList.remove('big');
                }
            }, i * 10);
        }

        for (let i = -1; i <= player.players[1].points; i++) {
            setTimeout(() => {
                if (i > 500) {
                    userStatus2.classList.add("points-up");
                    userStatus2.classList.contains("points-minus") ?
                        userStatus2.classList.remove("points-minus") : "";
                } else if (i > 100) {
                    userStatus2.classList.add("points-minus");
                    userStatus2.classList.contains("points-down") ?
                        userStatus2.classList.remove("points-down") : "";
                } else userStatus2.classList.add("points-down");
                userStatus2.innerHTML = i;

                if (i >= player.players[1].points) {
                    userStatus2.classList.add("finish");
                    userStatus2.classList.remove('big');
                }
            }, i * 10);
        }

        setTimeout(() => {
            const userMorePoints = morePoints(player.players, "points");

            user[userMorePoints.player - 1].querySelector("img").style.transform = "scale(5)";
            user[userMorePoints.player - 1].style.right = "50%";

            const multiplayerPosition = userMorePoints.player - 1 == 0 ? 1 : 0;

            user[multiplayerPosition].style.right = "80%";
            user[multiplayerPosition].querySelector("img").style.transform = "scale(1.50)";
            user[multiplayerPosition].style.opacity = "0.5";
            user[multiplayerPosition].querySelector(".status")
                .classList.remove("finish").add("big");

        }, player.players[0].points + player.players[1].points * 16);

    }, 800);
}

document.addEventListener('keydown', (event) => {

    console.log(event.key)
    if  (event.key === 'r' && player.audio.src) {
        player.play();
        player.audio.src = ""
        openModal(`
          <h3>Calma ai!</h3>
          você ainda está numa partida, quer mesmo sair?
          
          <div class="button" onclick="window.location.reload()">sim</div>
          <div class="button another" onclick="player.audio.src = song.file \n closeModal()">não</div>
          
          `)
    } else if(event.key === 'R') window.location.reload();
});

function getAvatarRandom() {
  const indiceAleatorio = Math.floor(Math.random() * 7);
  return indiceAleatorio;
}

window.onload = () => {
    openModal(`
        <h3 style="margin: 2px">Olá Jogador</h3>
        vamos cantar?<br><br>
        <div class="button" onclick="collectInfos()">Prosseguir</div>
        
        `)

    document.getElementsByClassName("user")[0].querySelector("img").src = "../avatars/avatar" + getAvatarRandom() + ".png";
}