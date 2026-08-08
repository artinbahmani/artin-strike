/* fps-strike — audio.js
 * All sound effects synthesized with the Web Audio API. No audio files.
 * Exposed as the global `SoundFX`. The context is created lazily on the
 * first user gesture (pointer-lock click) to satisfy autoplay policies.
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

  var lastStep = 0;

  window.SoundFX = {
    unlock: ensure,

    shot: function (kind) {
      if (!ensure()) return;
      if (kind === 'rifle') {
        noise(0.16, 900, 0.9);
        tone(160, 0.12, 0.5, 'sawtooth', 60);
      } else { // pistol
        noise(0.11, 1600, 0.7);
        tone(320, 0.07, 0.35, 'square', 120);
      }
    },
    dryFire: function () { if (ensure()) tone(1200, 0.04, 0.15, 'square'); },
    reload: function () {
      if (!ensure()) return;
      tone(500, 0.05, 0.2, 'square');
      setTimeout(function () { if (ctx) tone(340, 0.06, 0.25, 'square'); }, 220);
    },
    knife: function () { if (ensure()) noise(0.14, 3200, 0.35, 'bandpass'); },
    hit: function () { if (ensure()) tone(1400, 0.05, 0.3, 'sine', 900); },
    hurt: function () { if (ensure()) { tone(220, 0.15, 0.4, 'sawtooth', 120); noise(0.1, 500, 0.3); } },
    death: function () { if (ensure()) tone(180, 0.4, 0.4, 'sawtooth', 55); },
    footstep: function () {
      if (!ensure()) return;
      var now = Date.now();
      if (now - lastStep < 260) return;
      lastStep = now;
      noise(0.05, 400, 0.12);
    },
    plant: function () { if (ensure()) { tone(660, 0.08, 0.3); setTimeout(function () { if (ctx) tone(660, 0.08, 0.3); }, 150); } },
    beep: function (fast) { if (ensure()) tone(fast ? 1560 : 1040, 0.07, 0.35, 'sine'); },
    defusing: function () { if (ensure()) tone(520, 0.1, 0.2, 'triangle'); },
    defused: function () { if (ensure()) { tone(523, 0.15, 0.3, 'sine'); setTimeout(function () { if (ctx) tone(784, 0.25, 0.3, 'sine'); }, 160); } },
    explosion: function () {
      if (!ensure()) return;
      noise(1.1, 220, 1.2);
      tone(90, 0.9, 0.8, 'sine', 30);
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
