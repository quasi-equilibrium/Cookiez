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
    /** @type {Map<string, {stop:(fadeMs?:number)=>void}>} */
    this._loops = new Map();
  }

  speak(text, { lang = 'tr-TR', rate = 1.0, pitch = 1.0, volume = 1.0 } = {}) {
    // Uses built-in browser TTS (separate from WebAudio).
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = lang;
      u.rate = rate;
      u.pitch = pitch;
      u.volume = Math.max(0, Math.min(1, volume));
      window.speechSynthesis.cancel(); // avoid stacking
      window.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
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

      let alive = true;
      const interval = setInterval(() => {
        if (!this.ctx || !alive) return;
        const t = this.ctx.currentTime;
        // 3 quick beeps.
        for (let i = 0; i < 3; i++) {
          const tt = t + i * 0.18;
          g.gain.cancelScheduledValues(tt);
          g.gain.setValueAtTime(0, tt);
          // Slightly longer attack/release to reduce clicking/cızırtı.
          g.gain.linearRampToValueAtTime(volume, tt + 0.012);
          g.gain.linearRampToValueAtTime(0, tt + 0.095);
        }
      }, 780);

      this._loops.set(key, {
        stop: (fadeMs = 80) => {
          alive = false;
          clearInterval(interval);
          try {
            const t = this.ctx?.currentTime ?? 0;
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(g.gain.value, t);
            g.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
            osc.stop(t + fadeMs / 1000 + 0.02);
          } catch {
            // ignore
          }
        }
      });
      return;
    }

    if (type === 'mario') {
      // Simple chiptune loop (Mario-ish vibe) using 2 voices.
      const lead = this.ctx.createOscillator();
      lead.type = 'square';
      const bass = this.ctx.createOscillator();
      bass.type = 'triangle';

      const gLead = this.ctx.createGain();
      const gBass = this.ctx.createGain();
      gLead.gain.value = 0;
      gBass.gain.value = 0;

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;

      lead.connect(gLead);
      bass.connect(gBass);
      gLead.connect(lp);
      gBass.connect(lp);
      lp.connect(this.master);

      lead.start();
      bass.start();

      const NOTE = {
        C4: 261.63,
        D4: 293.66,
        E4: 329.63,
        G4: 392.0,
        A4: 440.0,
        C5: 523.25,
        E5: 659.25,
        G5: 783.99
      };

      const leadSeq = [NOTE.E5, NOTE.E5, NOTE.E5, null, NOTE.C5, NOTE.E5, null, NOTE.G5, null, null, null, null, NOTE.G4, null, null, null];
      const bassSeq = [NOTE.C4, null, NOTE.C4, null, NOTE.G4, null, NOTE.G4, null, NOTE.A4, null, NOTE.A4, null, NOTE.G4, null, null, null];

      let step = 0;
      const stepMs = 120;
      let alive = true;

      const tick = () => {
        if (!this.ctx || !alive) return;
        const t = this.ctx.currentTime;
        const l = leadSeq[step % leadSeq.length];
        const b = bassSeq[step % bassSeq.length];

        if (l) {
          lead.frequency.setValueAtTime(l, t);
          gLead.gain.cancelScheduledValues(t);
          gLead.gain.setValueAtTime(0, t);
          gLead.gain.linearRampToValueAtTime(volume * 0.18, t + 0.01);
          gLead.gain.linearRampToValueAtTime(0, t + stepMs / 1000 - 0.01);
        } else {
          gLead.gain.cancelScheduledValues(t);
          gLead.gain.setValueAtTime(0, t);
        }

        if (b) {
          bass.frequency.setValueAtTime(b, t);
          gBass.gain.cancelScheduledValues(t);
          gBass.gain.setValueAtTime(0, t);
          gBass.gain.linearRampToValueAtTime(volume * 0.12, t + 0.01);
          gBass.gain.linearRampToValueAtTime(0, t + stepMs / 1000 - 0.01);
        } else {
          gBass.gain.cancelScheduledValues(t);
          gBass.gain.setValueAtTime(0, t);
        }

        step = (step + 1) % leadSeq.length;
      };

      tick();
      const interval = setInterval(tick, stepMs);

      this._loops.set(key, {
        stop: (fadeMs = 120) => {
          alive = false;
          clearInterval(interval);
          try {
            const t = this.ctx?.currentTime ?? 0;
            gLead.gain.cancelScheduledValues(t);
            gBass.gain.cancelScheduledValues(t);
            gLead.gain.setValueAtTime(gLead.gain.value, t);
            gBass.gain.setValueAtTime(gBass.gain.value, t);
            gLead.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
            gBass.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
            lead.stop(t + fadeMs / 1000 + 0.02);
            bass.stop(t + fadeMs / 1000 + 0.02);
          } catch {
            // ignore
          }
        }
      });
      return;
    }

    if (type === 'elevatorHum') {
      const osc = this.ctx.createOscillator();
      // Use sine to avoid harsh buzzing.
      osc.type = 'sine';
      osc.frequency.value = 52;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1.4;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      lfo.start();

      this._loops.set(key, {
        stop: (fadeMs = 160) => {
          try {
            const t = this.ctx?.currentTime ?? 0;
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(g.gain.value, t);
            g.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
            osc.stop(t + fadeMs / 1000 + 0.02);
            lfo.stop(t + fadeMs / 1000 + 0.02);
          } catch {
            // ignore
          }
        }
      });
      // Fade in.
      g.gain.linearRampToValueAtTime(volume * 0.22, this.ctx.currentTime + 0.15);
      return;
    }

    if (type === 'fireCrackle') {
      // Simple crackle loop (noise-like) made from short square bursts.
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 180;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 0.7;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      osc.start();

      let alive = true;
      const interval = setInterval(() => {
        if (!this.ctx || !alive) return;
        const t = this.ctx.currentTime;
        // Random little bursts.
        const bursts = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < bursts; i++) {
          const tt = t + i * 0.08 + Math.random() * 0.03;
          osc.frequency.setValueAtTime(120 + Math.random() * 220, tt);
          bp.frequency.setValueAtTime(900 + Math.random() * 900, tt);
          g.gain.cancelScheduledValues(tt);
          g.gain.setValueAtTime(0, tt);
          g.gain.linearRampToValueAtTime(volume * 0.12, tt + 0.01);
          g.gain.linearRampToValueAtTime(0, tt + 0.06);
        }
      }, 240);

      this._loops.set(key, {
        stop: (fadeMs = 120) => {
          alive = false;
          clearInterval(interval);
          try {
            const t = this.ctx?.currentTime ?? 0;
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(g.gain.value, t);
            g.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
            osc.stop(t + fadeMs / 1000 + 0.02);
          } catch {
            // ignore
          }
        }
      });
      return;
    }

    if (type === 'rain') {
      // Soft rain hiss using a filtered square + random modulation (cheap).
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 2400;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.3;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      osc.start();

      let alive = true;
      const interval = setInterval(() => {
        if (!this.ctx || !alive) return;
        const t = this.ctx.currentTime;
        // Small random flutter.
        osc.frequency.setValueAtTime(1800 + Math.random() * 1600, t);
        bp.frequency.setValueAtTime(1200 + Math.random() * 1300, t);
        const target = volume * 0.06 + Math.random() * volume * 0.04;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(target, t + 0.04);
      }, 70);

      this._loops.set(key, {
        stop: (fadeMs = 180) => {
          alive = false;
          clearInterval(interval);
          try {
            const t = this.ctx?.currentTime ?? 0;
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(g.gain.value, t);
            g.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
            osc.stop(t + fadeMs / 1000 + 0.02);
          } catch {
            // ignore
          }
        }
      });
      // Fade in.
      g.gain.linearRampToValueAtTime(volume * 0.08, this.ctx.currentTime + 0.2);
      return;
    }
  }

  stopLoop(key) {
    const l = this._loops.get(key);
    if (!l) return;
    this._loops.delete(key);
    l.stop?.();
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

    if (type === 'explosion') {
      // Short boom: low sine drop + clicky edge.
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.22);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * 0.55, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.26);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.28);
      return;
    }

    if (type === 'hangup') {
      // Phone hangup: quick descending beep + click.
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(900, t);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(volume * 0.25, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + 0.14);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.16);
      return;
    }
  }
}

