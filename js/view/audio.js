/* MECHANICAL DAWN — audio.js : synthesized sound effects and adaptive music (WebAudio, no assets) */
(function (root) {
  'use strict';
  const MD = root.MD;
  const A = MD.Audio = { muted: false, ready: false, level: 0, dawn: false };
  let ac, master, sfxBus, musicBus, delayIn, noiseBuf, droneGain, timer;
  let nextNote = 0, step = 0;
  const last = {};

  A.init = function () {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = A.muted ? 0 : 0.85;
    master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    comp.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(comp);
    musicBus = ac.createGain(); musicBus.gain.value = 0.3; musicBus.connect(comp);
    delayIn = ac.createDelay(1.2); delayIn.delayTime.value = 0.34;
    const fb = ac.createGain(); fb.gain.value = 0.33;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const wet = ac.createGain(); wet.gain.value = 0.4;
    delayIn.connect(lp); lp.connect(fb); fb.connect(delayIn); lp.connect(wet); wet.connect(comp);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    A.ready = true;
    startMusic();
  };

  A.setMuted = function (m) {
    A.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ac.currentTime, 0.05);
  };

  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function tone(f, t, dur, o) {
    o = o || {};
    const osc = ac.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ac.createGain();
    const v = o.vol || 0.1, at = o.attack || 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; osc.connect(fl); node = fl; }
    node.connect(g);
    g.connect(o.bus || sfxBus);
    if (o.send) { const sg = ac.createGain(); sg.gain.value = o.send; g.connect(sg); sg.connect(delayIn); }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(t, dur, o) {
    o = o || {};
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ac.createBiquadFilter();
    fl.type = o.ft || 'bandpass';
    fl.frequency.setValueAtTime(o.f || 1000, t);
    if (o.fs) fl.frequency.exponentialRampToValueAtTime(o.fs, t + dur);
    fl.Q.value = o.q || 1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.1, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(o.bus || sfxBus);
    if (o.send) { const sg = ac.createGain(); sg.gain.value = o.send; g.connect(sg); sg.connect(delayIn); }
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  function throttle(name, gap) {
    const t = ac.currentTime;
    if (last[name] && t - last[name] < gap) return false;
    last[name] = t;
    return true;
  }

  const SFX = {
    step(t) { noise(t, 0.05, { f: 320, q: 0.7, vol: 0.16 }); tone(120, t, 0.08, { type: 'triangle', vol: 0.12, slide: 70 }); },
    lay(t, p) { tone(700 + (p.battery || 0) * 45, t + 0.02, 0.06, { type: 'square', vol: 0.045, slide: 1300, lp: 3000 }); },
    glide(t) { if (throttle('glide', 0.05)) tone(1500, t, 0.025, { type: 'sine', vol: 0.025 }); },
    drill(t) { noise(t, 0.42, { f: 700, fs: 2600, q: 5, vol: 0.2 }); tone(65, t, 0.42, { type: 'sawtooth', vol: 0.07, lp: 600 }); },
    rubble(t) { noise(t, 0.3, { f: 200, q: 0.5, vol: 0.25, ft: 'lowpass' }); },
    pickup(t) { tone(988, t, 0.07, { type: 'square', vol: 0.07, lp: 4000 }); tone(1319, t + 0.07, 0.12, { type: 'square', vol: 0.07, lp: 4000 }); },
    crystal(t) { [1568, 2093, 2637].forEach((f, k) => tone(f, t + k * 0.05, 0.3, { type: 'sine', vol: 0.07, send: 0.5 })); },
    cell(t) { [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, t + k * 0.06, 0.2, { type: 'square', vol: 0.06, send: 0.3, lp: 3500 })); },
    blocked(t) { if (throttle('blocked', 0.25)) tone(150, t, 0.16, { type: 'square', vol: 0.07, slide: 95, lp: 1200 }); },
    empty(t) { [620, 500, 380].forEach((f, k) => tone(f, t + k * 0.09, 0.12, { type: 'square', vol: 0.06, lp: 2500 })); },
    ret(t) { noise(t, 0.7, { f: 500, fs: 3200, q: 2, vol: 0.1 }); tone(260, t, 0.7, { type: 'sine', vol: 0.07, slide: 1100 }); },
    recharge(t) { [392, 523, 659, 784].forEach((f, k) => tone(f, t + k * 0.07, 0.22, { type: 'triangle', vol: 0.09, send: 0.3 })); },
    connect(t) { tone(220, t, 0.3, { type: 'sawtooth', vol: 0.05, slide: 440, lp: 1500 }); tone(660, t + 0.12, 0.3, { type: 'sine', vol: 0.08, send: 0.4 }); },
    restoreStart(t) { for (let k = 0; k < 4; k++) noise(t + k * 0.08, 0.05, { f: 2400, q: 6, vol: 0.1 }); },
    restored(t) {
      tone(55, t, 0.9, { type: 'sine', vol: 0.3, slide: 40 });
      noise(t, 0.6, { f: 300, fs: 3000, q: 1, vol: 0.12 });
      [261.6, 329.6, 392, 523.3].forEach((f) => tone(f, t + 0.05, 2.4, { type: 'sawtooth', vol: 0.04, attack: 0.25, lp: 1800, send: 0.3 }));
      [784, 988, 1175, 1568].forEach((f, k) => tone(f, t + 0.25 + k * 0.11, 0.6, { type: 'triangle', vol: 0.07, send: 0.5 }));
    },
    build(t) {
      noise(t, 0.1, { f: 500, vol: 0.14 }); noise(t + 0.18, 0.1, { f: 700, vol: 0.14 });
      tone(880, t + 0.32, 0.08, { type: 'square', vol: 0.06, lp: 3000 }); tone(1320, t + 0.42, 0.14, { type: 'square', vol: 0.06, lp: 3000 });
    },
    rescue(t) { tone(660, t, 0.09, { type: 'square', vol: 0.06, slide: 990, lp: 3000 }); tone(990, t + 0.11, 0.14, { type: 'square', vol: 0.06, slide: 1320, lp: 3000 }); },
    upgrade(t) { [392, 494, 587, 784, 988, 1175].forEach((f, k) => tone(f, t + k * 0.05, 0.35, { type: 'sawtooth', vol: 0.04, send: 0.4, lp: 2600 })); },
    click(t) { tone(1800, t, 0.02, { type: 'square', vol: 0.025 }); },
    deny(t) { tone(220, t, 0.08, { type: 'square', vol: 0.05, lp: 1500 }); tone(180, t + 0.08, 0.1, { type: 'square', vol: 0.05, lp: 1500 }); },
    deliver(t, p) { if (throttle('deliver', 0.12)) tone(1400 + Math.random() * 400, t, 0.05, { type: 'triangle', vol: 0.035 * (p.vol || 1) }); },
    weld(t, p) { if (throttle('weld', 0.18)) noise(t, 0.07, { f: 4200, q: 3, vol: 0.045 * (p.vol || 1) }); },
    mined(t, p) { if (throttle('mined', 0.15)) noise(t, 0.05, { f: 260, q: 1, vol: 0.07 * (p.vol || 1) }); },
    log(t) { for (let k = 0; k < 7; k++) tone(1100 + Math.random() * 900, t + k * 0.045, 0.03, { type: 'square', vol: 0.035, lp: 4000 }); },
    discover(t) { tone(523, t, 0.18, { type: 'triangle', vol: 0.08, send: 0.5 }); tone(784, t + 0.13, 0.3, { type: 'triangle', vol: 0.08, send: 0.5 }); },
    breakFixed(t) { noise(t, 0.2, { f: 3000, q: 2, vol: 0.08 }); tone(440, t + 0.1, 0.3, { type: 'triangle', vol: 0.07, slide: 880, send: 0.3 }); },
    ping(t, p) { tone(mf(72 + [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24][p.k % 11]), t, 0.25, { type: 'triangle', vol: 0.05, send: 0.35 }); },
    ignite(t) {
      tone(36, t, 4, { type: 'sine', vol: 0.4, slide: 55, attack: 1.5 });
      noise(t, 3.5, { f: 120, fs: 6000, q: 0.7, vol: 0.12, attack: 2.5 });
      [146.8, 220, 293.7, 370, 440, 587.3].forEach((f, k) => tone(f, t + 2.2 + k * 0.03, 5, { type: 'sawtooth', vol: 0.035, attack: 0.6, lp: 2400, send: 0.4 }));
      [1175, 1480, 1760, 2349].forEach((f, k) => tone(f, t + 2.6 + k * 0.18, 1.2, { type: 'triangle', vol: 0.06, send: 0.6 }));
    },
  };

  A.play = function (name, p) {
    if (!ac || A.muted) return;
    const fn = SFX[name];
    if (fn) fn(ac.currentTime + ((p && p.delay) || 0), p || {});
  };

  // ---------------------------------------------------------------- adaptive music
  const SIXTEENTH = 60 / 84 / 4;
  const MINOR = [[50, 53, 57, 60, 64], [46, 50, 53, 57, 62], [41, 48, 53, 57, 60], [48, 52, 55, 60, 62]];
  const MAJOR = [[50, 54, 57, 62, 64], [47, 50, 54, 57, 62], [43, 50, 55, 59, 62], [45, 52, 57, 61, 64]];
  const MELODY = [0, -1, -1, 2, -1, 3, -1, -1, 4, -1, 3, -1, 2, -1, -1, -1, 1, -1, 2, -1, -1, -1, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1];

  function startMusic() {
    droneGain = ac.createGain();
    droneGain.gain.value = 0;
    droneGain.connect(musicBus);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(droneGain);
    [[73.42, 'sine', 0.5], [110, 'sine', 0.3], [146.83, 'triangle', 0.12], [73.6, 'sawtooth', 0.06]].forEach(([f, ty, v]) => {
      const o = ac.createOscillator(); o.type = ty; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = v;
      o.connect(g); g.connect(lp); o.start();
    });
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ac.createGain(); lg.gain.value = 220;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    droneGain.gain.linearRampToValueAtTime(0.32, ac.currentTime + 4);
    nextNote = ac.currentTime + 0.2;
    timer = setInterval(schedule, 30);
  }

  function schedule() {
    if (!ac) return;
    while (nextNote < ac.currentTime + 0.15) {
      playStep(step, nextNote);
      nextNote += SIXTEENTH;
      step = (step + 1) % 256;
    }
  }

  function playStep(st, t) {
    const bar = Math.floor(st / 16), b = st % 16, L = A.level;
    const chords = A.dawn ? MAJOR : MINOR;
    const ch = chords[Math.floor(bar / 2) % 4];
    const mb = musicBus;
    if (b === 0 && bar % 2 === 0 && L >= 1) {
      for (const m of ch.slice(0, 4)) tone(mf(m), t, SIXTEENTH * 32, { type: 'triangle', vol: 0.05, attack: 0.9, bus: mb, lp: 1400 });
    }
    if (L >= 2) {
      if (b % 8 === 0) tone(110, t, 0.18, { type: 'sine', vol: 0.18, slide: 45, bus: mb });
      if (b % 4 === 2) noise(t, 0.04, { f: 7000, ft: 'highpass', vol: 0.05, bus: mb });
      if (b === 12) noise(t, 0.09, { f: 1800, q: 2, vol: 0.05, bus: mb });
    }
    if (L >= 3 && b % 2 === 0) {
      const m = ch[(st / 2 | 0) % 5] + 12;
      tone(mf(m), t, 0.14, { type: 'square', vol: 0.022, lp: 1800, bus: mb, send: 0.25 });
    }
    if (L >= 4) {
      const n = MELODY[st % 32];
      if (n >= 0) tone(mf(ch[n] + 24), t, 0.5, { type: 'triangle', vol: 0.045, bus: mb, send: 0.4 });
    }
    if (L <= 1 && b % 4 === 0 && Math.random() < 0.09) {
      const pent = [62, 65, 67, 69, 72, 74, 77];
      tone(mf(pent[(Math.random() * pent.length) | 0] + 12), t, 0.8, { type: 'sine', vol: 0.03, bus: mb, send: 0.6 });
    }
  }

  A.setLevel = function (lv, dawn) { A.level = lv; A.dawn = !!dawn; };
})(typeof window !== 'undefined' ? window : globalThis);
