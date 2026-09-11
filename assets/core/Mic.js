class Mic {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.currentVerseIndex = null;

    const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = SpeechClass ? new SpeechClass() : null;
    this.currentTranscript = "";
    this.isListening = false;
  }

  async loadMics() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (err) {
      console.error("Erro ao enumerar dispositivos:", err);
      return [];
    }
  }

  async init(deviceId) {
    if (this.stream) this.stop();

    const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.configureSpeechRecognition();
    } catch (err) {
      console.error("Erro ao inicializar microfone:", err);
    }
  }

  configureSpeechRecognition() {
    if (!this.recognition) return;

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'pt-BR';

    this.recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          this.currentTranscript += ' ' + event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
    };

    this.recognition.onerror = (e) => {
      if (e.error !== 'no-speech') console.warn('SpeechRecognition Error:', e.error);
    };

    this.recognition.onend = () => {
      // Reinicia automaticamente caso deva continuar escutando
      if (this.isListening) {
        try {
          this.recognition.start();
        } catch (e) {}
      }
    };
  }

  startVerseRecording(verseIndex) {
    if (!this.stream) return;

    // Para gravações ativas para não empilhar instâncias
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.currentVerseIndex = verseIndex;
    this.audioChunks = [];
    this.currentTranscript = "";

    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.audioChunks.push(event.data);
    };

    this.mediaRecorder.start(100);

    if (this.recognition && !this.isListening) {
      try {
        this.recognition.start();
        this.isListening = true;
      } catch (e) {}
    }
  }

  stopAndSend(expectedVerseText = "", level = 'easy') {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve({ verseIndex: this.currentVerseIndex, percentage: 0, points: 0, sungText: "" });
        return;
      }

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
        const userSpeech = this.currentTranscript.trim();

        const percentage = this.calculateAccuracyPercentage(userSpeech, expectedVerseText);
        const points = this.calculatePointsByLevel(percentage, level);

        const result = {
          verseIndex: this.currentVerseIndex,
          sungText: userSpeech,
          percentage: percentage,
          points: points,
          audioBlob: audioBlob
        };

        this.audioChunks = [];
        this.currentTranscript = "";
        resolve(result);
      };

      this.mediaRecorder.stop();
    });
  }
 wordSimilarity(a, b) {
  if (a === b) return 1;
  const dist = levenshtein(a, b); // implementação simples de distância de edição
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

calculateAccuracyPercentage(spokenText, expectedText) {
  if (!spokenText || !expectedText) return 0;
  const normalize = str => str.toLowerCase().replace(/[^\w\s]/gi, '').trim().split(/\s+/);
  const spokenWords = normalize(spokenText);
  const expectedWords = normalize(expectedText);

  let score = 0;
  expectedWords.forEach(expected => {
    const best = Math.max(0, ...spokenWords.map(s => this.wordSimilarity(s, expected)));
    if (best > 0.7) score += 1; // conta como "acerto" com tolerância
  });

  return Math.min(100, Math.round((score / expectedWords.length) * 100));
}

  calculatePointsByLevel(percentage, level = 'easy') {
    const rules = {
      easy: { minCut: 30, maxCap: 80 },
      medium: { minCut: 50, maxCap: 90 },
      hard: { minCut: 70, maxCap: 98 }
    };

    const { minCut, maxCap } = rules[level] || rules['easy'];

    if (percentage < minCut) return 0;
    if (percentage >= maxCap) return 500;

    const scale = (percentage - minCut) / (maxCap - minCut);
    return Math.round(scale * 500);
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.recognition && this.isListening) {
      this.isListening = false;
      this.recognition.stop();
    }
  }
}
