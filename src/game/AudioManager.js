// Minimal WebAudio wrapper with a single master volume.
// Will not crash if files are missing.
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._buffers = new Map();
    this._missing = new Set();
    this._ambientNode = null;
    this._volume = 0.7;
    /** @type {Map<string, {stop:()=>void}>} */
    this._loops = new Map();
  }

  async ensure() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(this.ctx.destination);
  }

  async unlock() {
    // Must be called from a user gesture (e.g. clicking START) in most browsers.
    await this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // ignore
      }
    }
  }

  setVolume(v) {
    this._volume = v;
    if (this.master) this.master.gain.value = v;
  }

  async loadBuffer(url) {
    if (this._buffers.has(url)) return this._buffers.get(url);
    if (this._missing.has(url)) return null;
    try {
      await this.ensure();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this._buffers.set(url, buf);
      return buf;
    } catch (e) {
      // Placeholder-safe: missing assets are expected early on.
      this._missing.add(url);
      return null;
    }
  }

  async playOneShot(url, { volume = 1, fallback = null } = {}) {
    await this.ensure();
    const buf = await this.loadBuffer(url);
    if (!this.ctx) return;
    if (!buf) {
      if (fallback) this._playSynthOneShot(fallback, { volume });
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.master);
    src.start();
  }

  async playAmbientLoop(url, { volume = 0.35, fallback = null } = {}) {
    if (this._ambientNode) return;
    await this.ensure();
    const buf = await this.loadBuffer(url);
    if (!this.ctx) return;
    if (!buf) {
      if (fallback) {
        this.startLoop('ambient', fallback, { volume });
      }
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.master);
    src.start();
    this._ambientNode = { src, g };
  }

  stopAmbient() {
    if (!this._ambientNode) return;
    try {
      this._ambientNode.src.stop();
    } catch {
      // ignore
    }
    this._ambientNode = null;
  }

  startLoop(key, type, { volume = 0.5 } = {}) {
    if (this._loops.has(key)) return;
    if (!this.ctx) return;

    if (type === 'taskBeep') {
      // Bip-bip-bip loop (all players can hear).
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 880;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.master);
      osc.start();

      const interval = setInterval(() => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        // 3 quick beeps.
        for (let i = 0; i < 3; i++) {
          const tt = t + i * 0.18;
          g.gain.cancelScheduledValues(tt);
          g.gain.setValueAtTime(0, tt);
          g.gain.linearRampToValueAtTime(volume, tt + 0.01);
          g.gain.linearRampToValueAtTime(0, tt + 0.09);
        }
      }, 750);

      this._loops.set(key, {
        stop: () => {
          clearInterval(interval);
          try {
            osc.stop();
          } catch {
            // ignore
          }
        }
      });
      return;
    }

    if (type === 'elevatorHum') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 2.2;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 8;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const g = this.ctx.createGain();
      g.gain.value = volume * 0.35;
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      lfo.start();

      this._loops.set(key, {
        stop: () => {
          try {
            osc.stop();
            lfo.stop();
          } catch {
            // ignore
          }
        }
      });
      return;
    }
  }

  stopLoop(key) {
    const l = this._loops.get(key);
    if (!l) return;
    this._loops.delete(key);
    l.stop();
  }

  _playSynthOneShot(type, { volume }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (type === 'pistol') {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(volume * 0.001, t);
      g.gain.exponentialRampToValueAtTime(volume * 0.35, t + 0.005);
      g.gain.exponentialRampToValueAtTime(volume * 0.001, t + 0.09);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.1);
      return;
    }

    if (type === 'vandal') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(volume * 0.001, t);
      g.gain.exponentialRampToValueAtTime(volume * 0.25, t + 0.005);
      g.gain.exponentialRampToValueAtTime(volume * 0.001, t + 0.08);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.09);
      return;
    }

    if (type === 'sniper') {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(volume * 0.001, t);
      g.gain.exponentialRampToValueAtTime(volume * 0.5, t + 0.005);
      g.gain.exponentialRampToValueAtTime(volume * 0.001, t + 0.16);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.18);
      return;
    }

    if (type === 'reload') {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.setValueAtTime(180, t + 0.05);
      osc.frequency.setValueAtTime(140, t + 0.1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * 0.12, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.16);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.18);
      return;
    }

    if (type === 'step') {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(80, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * 0.08, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.06);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.07);
      return;
    }

    if (type === 'death') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.25);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * 0.25, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.28);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.3);
      return;
    }

    if (type === 'taskComplete') {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      const notes = [440, 660, 880];
      notes.forEach((f, i) => {
        const tt = t + i * 0.08;
        osc.frequency.setValueAtTime(f, tt);
        g.gain.setValueAtTime(0, tt);
        g.gain.linearRampToValueAtTime(volume * 0.18, tt + 0.01);
        g.gain.linearRampToValueAtTime(0, tt + 0.06);
      });
      osc.stop(t + 0.26);
      return;
    }

    if (type === 'elevatorDoor') {
      // Short mechanical "thunk + slide" impression.
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * 0.18, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.22);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.24);
      return;
    }
  }
}

