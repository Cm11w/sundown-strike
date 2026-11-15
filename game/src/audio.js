// Procedural audio: every sound synthesized with WebAudio — filtered noise
// bursts, sine thumps, scheduled clicks. No audio files, no network.
// Distance attenuates and muffles; stereo pan follows the bearing, so
// footsteps, reloads and bomb beeps are tactical information.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.volume = 0.8;
    this.ambienceOn = false;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // 1s of white noise, reused by every noise-based sound.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  // Stereo placement: pan -1 (left) .. 1 (right), gain by distance.
  spatial(dist, pan) {
    const g = this.ctx.createGain();
    g.gain.value = 1 / (1 + Math.max(0, dist) * 0.09);
    let node = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      node = p;
    }
    node.connect(this.master);
    return g;
  }
  noise({ dur, freq, type = 'lowpass', gain = 0.5, decay = 6, dist = 0, pan = 0, q = 0.8, when = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.max(60, freq / (1 + dist * 0.06)); // distance muffles
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.spatial(dist, pan));
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  tone({ freq, freqEnd = null, dur, type = 'sine', gain = 0.3, dist = 0, pan = 0, when = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.spatial(dist, pan));
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  shot(weapon, dist, pan) {
    if (!this.ctx) return;
    const R = {
      rifle: () => { this.noise({ dur: 0.14, freq: 2400, gain: 0.55, dist, pan }); this.tone({ freq: 110, freqEnd: 45, dur: 0.12, type: 'triangle', gain: 0.4, dist, pan }); },
      smg: () => { this.noise({ dur: 0.09, freq: 3000, gain: 0.42, dist, pan }); this.tone({ freq: 130, freqEnd: 60, dur: 0.08, type: 'triangle', gain: 0.3, dist, pan }); },
      shotgun: () => { this.noise({ dur: 0.3, freq: 1500, gain: 0.8, dist, pan }); this.tone({ freq: 85, freqEnd: 35, dur: 0.25, type: 'triangle', gain: 0.55, dist, pan }); },
      sniper: () => { this.noise({ dur: 0.22, freq: 3600, gain: 0.7, dist, pan }); this.tone({ freq: 95, freqEnd: 40, dur: 0.2, type: 'triangle', gain: 0.5, dist, pan }); this.noise({ dur: 0.4, freq: 900, gain: 0.18, dist, pan, when: 0.12 }); },
      pistol: () => { this.noise({ dur: 0.1, freq: 2800, gain: 0.45, dist, pan }); this.tone({ freq: 140, freqEnd: 60, dur: 0.08, type: 'triangle', gain: 0.3, dist, pan }); },
      handcannon: () => { this.noise({ dur: 0.2, freq: 1800, gain: 0.7, dist, pan }); this.tone({ freq: 75, freqEnd: 32, dur: 0.22, type: 'triangle', gain: 0.55, dist, pan }); },
      knife: () => { this.noise({ dur: 0.14, freq: 1200, type: 'bandpass', gain: 0.25, dist, pan, q: 2 }); },
    };
    (R[weapon] || R.rifle)();
  }
  reload() {
    if (!this.ctx) return;
    this.noise({ dur: 0.05, freq: 4000, type: 'highpass', gain: 0.22 });
    this.noise({ dur: 0.05, freq: 3500, type: 'highpass', gain: 0.25, when: 0.35 });
    this.noise({ dur: 0.06, freq: 3000, type: 'highpass', gain: 0.3, when: 0.7 });
  }
  dryFire() { this.noise({ dur: 0.04, freq: 4500, type: 'highpass', gain: 0.2 }); }
  step(dist, pan, loud) {
    if (!this.ctx || loud <= 0) return;
    this.noise({ dur: 0.07, freq: 500 + loud * 300, gain: 0.12 * loud + 0.04, dist, pan });
  }
  jump() { this.noise({ dur: 0.08, freq: 400, gain: 0.1 }); }
  beep(frac, dist, pan) {
    if (!this.ctx) return;
    this.tone({ freq: 1250, dur: 0.07, type: 'square', gain: 0.16, dist, pan });
  }
  explosion(dist, pan, big) {
    if (!this.ctx) return;
    this.noise({ dur: big ? 1.4 : 0.8, freq: 900, gain: big ? 0.9 : 0.65, dist, pan });
    this.tone({ freq: 55, freqEnd: 28, dur: big ? 1.1 : 0.6, type: 'sine', gain: 0.7, dist, pan });
  }
  flashRing() {
    if (!this.ctx) return;
    this.tone({ freq: 3400, dur: 1.4, type: 'sine', gain: 0.12 });
    this.tone({ freq: 2900, dur: 1.1, type: 'sine', gain: 0.07 });
  }
  hitmark(headshot) {
    if (!this.ctx) return;
    this.tone({ freq: headshot ? 2400 : 1750, dur: 0.06, type: 'square', gain: 0.14 });
  }
  hurt() {
    if (!this.ctx) return;
    this.tone({ freq: 180, freqEnd: 90, dur: 0.15, type: 'sawtooth', gain: 0.14 });
  }
  plantTick() { this.noise({ dur: 0.04, freq: 3000, type: 'highpass', gain: 0.2 }); }
  plantDone() {
    this.tone({ freq: 660, dur: 0.12, gain: 0.2 });
    this.tone({ freq: 880, dur: 0.18, gain: 0.2, when: 0.1 });
  }
  defuseDone() {
    this.tone({ freq: 880, dur: 0.12, gain: 0.2 });
    this.tone({ freq: 1174, dur: 0.2, gain: 0.2, when: 0.1 });
  }
  stinger(win) {
    if (!this.ctx) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.22, when: i * 0.13 }));
  }
  click() { this.tone({ freq: 900, dur: 0.05, type: 'square', gain: 0.1 }); }
  buy() {
    this.tone({ freq: 700, dur: 0.07, gain: 0.14 });
    this.tone({ freq: 1050, dur: 0.09, gain: 0.14, when: 0.06 });
  }
  deny() { this.tone({ freq: 220, dur: 0.12, type: 'square', gain: 0.12 }); }
  startAmbience() {
    if (!this.ctx || this.ambienceOn) return;
    this.ambienceOn = true;
    // Wind: looped noise through a wandering lowpass.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG); lfoG.connect(f.frequency);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    // Distant waves: slow swell on a second loop.
    const src2 = this.ctx.createBufferSource();
    src2.buffer = this.noiseBuf; src2.loop = true; src2.playbackRate.value = 0.7;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'lowpass'; f2.frequency.value = 240;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.035;
    const lfo2 = this.ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2G = this.ctx.createGain();
    lfo2G.gain.value = 0.02;
    lfo2.connect(lfo2G); lfo2G.connect(g2.gain);
    src2.connect(f2); f2.connect(g2); g2.connect(this.master);
    src2.start(); lfo2.start();
    // Low harbour hum.
    const hum = this.ctx.createOscillator();
    hum.type = 'sine'; hum.frequency.value = 55;
    const hg = this.ctx.createGain();
    hg.gain.value = 0.014;
    hum.connect(hg); hg.connect(this.master);
    hum.start();
  }
}
