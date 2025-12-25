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
  }

  ensure() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(this.ctx.destination);
  }

  setVolume(v) {
    this._volume = v;
    if (this.master) this.master.gain.value = v;
  }

  async loadBuffer(url) {
    if (this._buffers.has(url)) return this._buffers.get(url);
    if (this._missing.has(url)) return null;
    try {
      this.ensure();
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

  async playOneShot(url, { volume = 1 } = {}) {
    const buf = await this.loadBuffer(url);
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.master);
    src.start();
  }

  async playAmbientLoop(url, { volume = 0.35 } = {}) {
    if (this._ambientNode) return;
    const buf = await this.loadBuffer(url);
    if (!buf || !this.ctx) return;
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
}

