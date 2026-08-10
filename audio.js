/* fps-strike — audio.js
 * All sound effects synthesized with the Web Audio API. No audio files.
 * Exposed as the global `SoundFX`. The context is created lazily on the
 * first user gesture (pointer-lock click) to satisfy autoplay policies.
 * World sounds (bot gunfire, footsteps) take a distance for attenuation.
 */
(function () {
  'use strict';

  var ctx = null;
  var master = null;
  var noiseBuf = null;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
      var len = ctx.sampleRate * 1.2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  // Distance attenuation: volume and high-frequency content both fall off.
  function atten(dist) {
    if (!dist) return 1;
    return Math.max(0.02, 1 / (1 + dist * 0.28));
  }

  // Filtered noise burst: the body of every gunshot/explosion.
  function noise(dur, freq, gain, type) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); src.stop(ctx.currentTime + dur);
  }

  function tone(freq, dur, gain, type, slideTo) {
    var o = ctx.createOscillator();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur);
  }

  var lastStep = 0, lastWorldStep = 0;

  // Per-weapon gunshot signatures.
  var SHOTS = {
    rifle:  function (v, f) { noise(0.16, 900 * f + 300, 0.9 * v); tone(160, 0.12, 0.5 * v, 'sawtooth', 60); },   // AK-47
    m4:     function (v, f) { noise(0.14, 1300 * f + 300, 0.8 * v); tone(220, 0.10, 0.4 * v, 'sawtooth', 80); },  // M4A4
    awp:    function (v, f) { noise(0.45, 700 * f + 200, 1.1 * v); tone(110, 0.35, 0.7 * v, 'sawtooth', 40); },   // AWP crack
    deagle: function (v, f) { noise(0.2, 1100 * f + 200, 0.95 * v); tone(180, 0.14, 0.5 * v, 'square', 70); },    // Desert Eagle
    pistol: function (v, f) { noise(0.11, 1600 * f + 400, 0.7 * v); tone(320, 0.07, 0.35 * v, 'square', 120); }   // P250
  };

  window.SoundFX = {
    unlock: ensure,

    // kind: rifle/m4/awp/deagle/pistol · dist: tiles from the listener
    shot: function (kind, dist) {
      if (!ensure()) return;
      var fn = SHOTS[kind] || SHOTS.pistol;
      var v = atten(dist);
      if (v <= 0.03) return;
      fn(v, Math.max(0.3, 1 - (dist || 0) * 0.04));
    },
    dryFire: function () { if (ensure()) tone(1200, 0.04, 0.15, 'square'); },
    reload: function () {
      if (!ensure()) return;
      tone(500, 0.05, 0.2, 'square');
      setTimeout(function () { if (ctx) tone(340, 0.06, 0.25, 'square'); }, 220);
    },
    bolt: function () { // AWP rechamber: clack-clack
      if (!ensure()) return;
      noise(0.05, 2400, 0.3, 'bandpass');
      setTimeout(function () { if (ctx) noise(0.06, 1800, 0.35, 'bandpass'); }, 180);
    },
    knife: function () { if (ensure()) noise(0.14, 3200, 0.35, 'bandpass'); },
    hit: function () { if (ensure()) tone(1400, 0.05, 0.3, 'sine', 900); },
    headshot: function () { if (ensure()) { tone(2200, 0.06, 0.35, 'triangle', 1400); noise(0.08, 3800, 0.25, 'bandpass'); } },
    hurt: function () { if (ensure()) { tone(220, 0.15, 0.4, 'sawtooth', 120); noise(0.1, 500, 0.3); } },
    death: function () { if (ensure()) tone(180, 0.4, 0.4, 'sawtooth', 55); },
    // Player footstep; vol 0..1 (running 1, walking ~0.25, crouched ~0).
    footstep: function (vol) {
      if (!ensure()) return;
      if (vol == null) vol = 1;
      var now = Date.now();
      if (now - lastStep < 260) return;
      lastStep = now;
      if (vol > 0.02) noise(0.05, 400, 0.13 * vol);
    },
    // Someone else's footstep, attenuated by distance.
    stepAt: function (dist, running) {
      if (!ensure()) return;
      var now = Date.now();
      if (now - lastWorldStep < 300) return;
      var v = atten(dist) * (running ? 1 : 0.3);
      if (v < 0.04) return;
      lastWorldStep = now;
      noise(0.05, 380, 0.12 * v);
    },
    plant: function () { if (ensure()) { tone(660, 0.08, 0.3); setTimeout(function () { if (ctx) tone(660, 0.08, 0.3); }, 150); } },
    beep: function (fast) { if (ensure()) tone(fast ? 1560 : 1040, 0.07, 0.35, 'sine'); },
    defusing: function () { if (ensure()) tone(520, 0.1, 0.2, 'triangle'); },
    defused: function () { if (ensure()) { tone(523, 0.15, 0.3, 'sine'); setTimeout(function () { if (ctx) tone(784, 0.25, 0.3, 'sine'); }, 160); } },
    explosion: function (dist) {
      if (!ensure()) return;
      var v = atten(dist);
      noise(1.1, 220, 1.2 * v);
      tone(90, 0.9, 0.8 * v, 'sine', 30);
    },
    heBounce: function () { if (ensure()) noise(0.04, 1200, 0.15, 'bandpass'); },
    pin: function () { if (ensure()) tone(900, 0.05, 0.2, 'triangle', 1400); },
    flashbang: function (dist) {
      if (!ensure()) return;
      var v = atten(dist);
      tone(3400, 0.7, 0.5 * v, 'sine');           // ringing ear
      noise(0.3, 3000, 0.8 * v, 'highpass');
    },
    smokePop: function (dist) {
      if (!ensure()) return;
      var v = atten(dist);
      noise(0.4, 500, 0.5 * v);
      tone(140, 0.3, 0.3 * v, 'sine', 60);
    },
    roundWin: function () {
      if (!ensure()) return;
      tone(392, 0.12, 0.3, 'triangle');
      setTimeout(function () { if (ctx) tone(587, 0.22, 0.3, 'triangle'); }, 130);
    },
    roundLose: function () {
      if (!ensure()) return;
      tone(330, 0.15, 0.3, 'triangle');
      setTimeout(function () { if (ctx) tone(220, 0.3, 0.3, 'triangle'); }, 160);
    },
    buy: function () { if (ensure()) tone(880, 0.06, 0.25, 'sine', 1320); }
  };
})();
