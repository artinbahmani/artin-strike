/* fps-strike — viewmodel.js
 * First-person weapon rendering: a procedural canvas gun per weapon, drawn
 * lower-right with walk bob, mouse sway, recoil kick, reload and throw
 * animations, plus the AWP scope overlay. Exposed as the global `Viewmodel`.
 */
(function () {
  'use strict';

  /* st = {
   *   kind: 'knife'|'pistol'|'deagle'|'rifle'|'m4'|'awp'|'nade',
   *   nadeColor, bobPhase, moveAmt (0..1), swayX, swayY,
   *   kick (0..1, decays), muzzle (0..1), reloadFrac (-1 or 0..1),
   *   switchFrac (0..1 raise-in), throwFrac (-1 or 0..1), t
   * } */
  function draw(ctx, W, H, st) {
    var s = H / 560; // resolution-independent scale
    var bobX = Math.sin(st.bobPhase) * 7 * st.moveAmt * s;
    var bobY = Math.abs(Math.cos(st.bobPhase)) * 5 * st.moveAmt * s;
    var dip = 0;
    if (st.switchFrac > 0) dip += st.switchFrac * 60;
    if (st.throwFrac >= 0) dip += Math.sin(st.throwFrac * Math.PI) * 40;

    ctx.save();
    ctx.translate(W * 0.60 + bobX + st.swayX, H + 14 * s + bobY + st.swayY + dip * s);
    ctx.scale(s, s);
    // Recoil: the whole gun jumps back and down.
    if (st.kick > 0.01) {
      ctx.translate(0, st.kick * 16);
      ctx.rotate(st.kick * 0.03);
    }

    switch (st.kind) {
      case 'knife': drawKnife(ctx); break;
      case 'pistol': drawPistol(ctx, st); break;
      case 'deagle': drawDeagle(ctx, st); break;
      case 'rifle': drawAK(ctx, st); break;
      case 'm4': drawM4(ctx, st); break;
      case 'awp': drawAWP(ctx, st); break;
      case 'nade': drawNade(ctx, st); break;
    }
    ctx.restore();
  }

  /* Hands are implied by a dark glove wedge under the grip. */
  function glove(ctx, x, y) {
    ctx.fillStyle = '#22262c';
    ctx.fillRect(x, y, 30, 26);
    ctx.fillStyle = '#2e333b';
    ctx.fillRect(x + 2, y + 2, 26, 8);
  }

  // Shared reload: magazine drops out then seats back in.
  function reloadMag(ctx, st, x, y, w, h, color) {
    if (st.reloadFrac < 0) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); return; }
    var f = st.reloadFrac;
    if (f < 0.45) { // mag slides down and away
      var d = (f / 0.45) * 46;
      ctx.fillStyle = color;
      ctx.fillRect(x - d * 0.3, y + d, w, h);
    } else { // fresh mag seats back in
      var d2 = (1 - (f - 0.45) / 0.55) * 46;
      ctx.fillStyle = '#33373d';
      ctx.fillRect(x - d2 * 0.3, y + d2, w, h);
    }
  }

  function muzzleFlash(ctx, st, x, y, r) {
    if (st.muzzle <= 0) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,235,150,' + Math.min(1, st.muzzle * 14) + ')');
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawKnife(ctx) {
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(58, -46, 12, 34); // handle
    ctx.fillStyle = '#c7ccd4';
    ctx.beginPath();
    ctx.moveTo(58, -46); ctx.lineTo(64, -110); ctx.lineTo(70, -46);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(64, -104); ctx.lineTo(64, -50); ctx.stroke();
    glove(ctx, 50, -14);
  }

  function drawPistol(ctx, st) {
    ctx.fillStyle = '#1b1d21';
    ctx.fillRect(44, -52, 40, 18); // slide
    ctx.fillStyle = '#26292e';
    ctx.fillRect(76, -48, 14, 8);  // barrel
    ctx.fillStyle = '#101215';
    ctx.fillRect(48, -34, 16, 26); // grip
    reloadMag(ctx, st, 50, -12, 12, 12, '#2c3036');
    glove(ctx, 44, -8);
    muzzleFlash(ctx, st, 92, -44, 24);
  }

  function drawDeagle(ctx, st) {
    ctx.fillStyle = '#3d4148';            // chrome-ish slide
    ctx.fillRect(38, -56, 52, 20);
    ctx.fillStyle = '#565b64';
    ctx.fillRect(38, -56, 52, 6);
    ctx.fillStyle = '#26292e';
    ctx.fillRect(84, -50, 20, 10);        // long barrel
    ctx.fillStyle = '#4a3b28';            // wood grips
    ctx.fillRect(42, -36, 18, 30);
    reloadMag(ctx, st, 45, -8, 12, 10, '#3d4148');
    glove(ctx, 38, -4);
    muzzleFlash(ctx, st, 106, -45, 30);
  }

  function drawAK(ctx, st) {
    ctx.fillStyle = '#1b1d21';
    ctx.fillRect(24, -58, 76, 24);        // receiver
    ctx.fillStyle = '#26292e';
    ctx.fillRect(92, -52, 56, 10);        // barrel
    ctx.fillStyle = '#101215';
    ctx.fillRect(140, -54, 8, 14);        // muzzle
    ctx.fillStyle = '#6b4f2e';            // wood furniture
    ctx.fillRect(70, -62, 26, 10);
    ctx.fillRect(26, -40, 18, 16);
    ctx.fillStyle = '#2c3036';
    reloadMag(ctx, st, 52, -34, 16, 30, '#2c3036'); // curved mag
    ctx.fillStyle = '#101215';
    ctx.fillRect(30, -36, 12, 22);        // grip
    glove(ctx, 24, -12);
    muzzleFlash(ctx, st, 150, -47, 30);
  }

  function drawM4(ctx, st) {
    ctx.fillStyle = '#17191d';
    ctx.fillRect(24, -60, 76, 26);        // receiver
    ctx.fillStyle = '#0f1114';
    ctx.fillRect(34, -72, 34, 12);        // carry handle
    ctx.fillStyle = '#22252a';
    ctx.fillRect(92, -54, 58, 10);        // barrel
    ctx.fillStyle = '#0c0e10';
    ctx.fillRect(142, -56, 10, 14);       // muzzle brake
    reloadMag(ctx, st, 52, -34, 14, 30, '#22252a'); // straight mag
    ctx.fillStyle = '#101215';
    ctx.fillRect(30, -36, 12, 22);        // grip
    glove(ctx, 24, -12);
    muzzleFlash(ctx, st, 154, -49, 30);
  }

  function drawAWP(ctx, st) {
    ctx.fillStyle = '#2f4a2e';            // green stock
    ctx.fillRect(16, -56, 84, 26);
    ctx.fillStyle = '#243b23';
    ctx.fillRect(16, -34, 40, 10);
    ctx.fillStyle = '#14161a';
    ctx.fillRect(92, -50, 72, 9);         // long barrel
    ctx.fillRect(158, -52, 10, 13);       // muzzle
    ctx.fillStyle = '#0d0f12';            // scope tube
    ctx.fillRect(44, -72, 44, 14);
    ctx.fillStyle = '#1c2126';
    ctx.fillRect(48, -58, 8, 6); ctx.fillRect(76, -58, 8, 6); // scope rings
    ctx.fillStyle = '#3f5d3d';
    ctx.fillRect(30, -36, 14, 22);        // grip
    ctx.fillStyle = '#101215';
    ctx.fillRect(100, -60, 14, 6);        // bolt handle
    reloadMag(ctx, st, 52, -30, 16, 16, '#1e2b1d');
    glove(ctx, 22, -10);
    muzzleFlash(ctx, st, 170, -45, 38);
  }

  function drawNade(ctx, st) {
    glove(ctx, 36, -22);
    ctx.fillStyle = st.nadeColor || '#3a4a3c';
    ctx.beginPath(); ctx.arc(56, -34, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(50, -40, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a3d42';
    ctx.fillRect(52, -56, 8, 8);          // fuse
    ctx.strokeStyle = '#c7ccd4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(64, -52, 6, -1.2, 1.8); ctx.stroke(); // pin
  }

  // AWP scope: black surround, circular view, mil-dot crosshair.
  function drawScope(ctx, W, H) {
    var cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.42;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true); // punch out the circle
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(10,10,10,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.fillStyle = 'rgba(10,10,10,0.9)';
    for (var i = 1; i <= 3; i++) { // mil dots
      ctx.fillRect(cx - 2, cy - i * r * 0.25 - 2, 4, 4);
      ctx.fillRect(cx - 2, cy + i * r * 0.25 - 2, 4, 4);
      ctx.fillRect(cx - i * r * 0.25 - 2, cy - 2, 4, 4);
      ctx.fillRect(cx + i * r * 0.25 - 2, cy - 2, 4, 4);
    }
    ctx.restore();
  }

  window.Viewmodel = { draw: draw, drawScope: drawScope };
})();
