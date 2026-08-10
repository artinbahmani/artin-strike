/* fps-strike — radar.js
 * CS-style circular radar: player-centered, rotates so the view direction is
 * always up, teammates always visible, enemies only when spotted, bomb icon.
 * Exposed as the global `Radar`.
 */
(function () {
  'use strict';

  var RANGE = 9;       // world tiles visible from center to edge
  var PX_TILE = 8;     // prerendered map resolution
  var mapImg = null, mapW = 0, mapH = 0;

  function setMap(world, sites) {
    mapImg = Engine.paintMap(world, sites, PX_TILE);
    mapW = world.w; mapH = world.h;
  }

  /* opts: { player: {x,y,dir}, dots: [{x,y,color,icon}], bomb: {x,y,blink} } */
  function draw(canvas, opts) {
    var ctx = canvas.getContext('2d');
    var S = canvas.width, C = S / 2;
    var scale = C / RANGE;
    var p = opts.player;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    // Circular mask with a dark rim.
    ctx.beginPath(); ctx.arc(C, C, C - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(8,10,14,0.9)';
    ctx.fillRect(0, 0, S, S);

    if (mapImg) {
      ctx.translate(C, C);
      ctx.rotate(-p.dir - Math.PI / 2); // forward = up
      ctx.scale(scale, scale);
      ctx.translate(-p.x, -p.y);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mapImg, 0, 0, mapW, mapH);

      // Dots in world space.
      (opts.dots || []).forEach(function (d) {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 0.28, 0, Math.PI * 2);
        ctx.fill();
      });
      // Planted / dropped bomb: flashing marker.
      if (opts.bomb) {
        ctx.fillStyle = opts.bomb.blink ? '#ff5347' : '#f0a500';
        ctx.fillRect(opts.bomb.x - 0.3, opts.bomb.y - 0.3, 0.6, 0.6);
        ctx.strokeStyle = 'rgba(255,83,71,0.6)';
        ctx.lineWidth = 0.12;
        ctx.strokeRect(opts.bomb.x - 0.45, opts.bomb.y - 0.45, 0.9, 0.9);
      }
    }
    ctx.restore();

    // Player wedge at the center, always pointing up.
    ctx.fillStyle = '#f5f7fa';
    ctx.beginPath();
    ctx.moveTo(C, C - 6);
    ctx.lineTo(C - 4.5, C + 5);
    ctx.lineTo(C, C + 2.5);
    ctx.lineTo(C + 4.5, C + 5);
    ctx.closePath(); ctx.fill();

    // Rim.
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(C, C, C - 1, 0, Math.PI * 2); ctx.stroke();
  }

  window.Radar = { setMap: setMap, draw: draw, RANGE: RANGE };
})();
