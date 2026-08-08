/* fps-strike — engine.js
 * Wolfenstein-style raycasting engine: procedural textures, textured walls,
 * billboard sprites with per-column z-buffering, and a top-down minimap.
 * Exposed as the global `Engine`. No dependencies, no modules (file:// safe).
 */
(function () {
  'use strict';

  var TEX = 64;          // texture size in px
  var STRIP = 2;         // screen column width in px (ray step)
  var MAX_DEPTH = 24;    // fog distance in tiles
  var FOV_PLANE = 0.66;  // camera plane half-length (~66 degree FOV)

  /* ------------------------------------------------------------------ *
   * Procedural textures
   * ------------------------------------------------------------------ */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function noiseOn(ctx, w, h, amount, alpha) {
    for (var i = 0; i < amount; i++) {
      var v = Math.floor(Math.random() * 60) - 30;
      ctx.fillStyle = 'rgba(' + (v > 0 ? 255 : 0) + ',' + (v > 0 ? 255 : 0) + ',' + (v > 0 ? 255 : 0) + ',' + (Math.abs(v) / 255) * alpha + ')';
      ctx.fillRect(Math.random() * w | 0, Math.random() * h | 0, 2, 2);
    }
  }

  function texBrick() {
    var c = makeCanvas(TEX, TEX), x = c.getContext('2d');
    x.fillStyle = '#7d4a35'; x.fillRect(0, 0, TEX, TEX);
    var bh = 8, bw = 16;
    for (var row = 0; row < TEX / bh; row++) {
      var off = (row % 2) * (bw / 2);
      for (var col = -1; col < TEX / bw + 1; col++) {
        var shade = 100 + ((row * 31 + col * 17) % 40);
        x.fillStyle = 'rgb(' + (shade + 25) + ',' + (shade - 10) + ',' + (shade - 35) + ')';
        x.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
    x.fillStyle = 'rgba(40,30,25,0.9)';
    for (var r = 0; r <= TEX / bh; r++) x.fillRect(0, r * bh - 1, TEX, 1);
    noiseOn(x, TEX, TEX, 250, 0.5);
    return c;
  }

  function texConcrete() {
    var c = makeCanvas(TEX, TEX), x = c.getContext('2d');
    x.fillStyle = '#6d6f72'; x.fillRect(0, 0, TEX, TEX);
    noiseOn(x, TEX, TEX, 700, 0.6);
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2;
    x.strokeRect(1, 1, TEX - 2, TEX - 2);
    x.beginPath(); x.moveTo(0, TEX / 2); x.lineTo(TEX, TEX / 2); x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.18)';
    x.fillRect(0, TEX - 6, TEX, 6); // grime at the base
    return c;
  }

  function texCrate() {
    var c = makeCanvas(TEX, TEX), x = c.getContext('2d');
    x.fillStyle = '#8a6a3f'; x.fillRect(0, 0, TEX, TEX);
    for (var i = 0; i < 8; i++) {
      var s = 96 + ((i * 37) % 36);
      x.fillStyle = 'rgb(' + s + ',' + (s - 30) + ',' + (s - 60) + ')';
      x.fillRect(0, i * 8 + 1, TEX, 6);
    }
    x.strokeStyle = '#4d3a20'; x.lineWidth = 4;
    x.strokeRect(2, 2, TEX - 4, TEX - 4);
    x.beginPath(); x.moveTo(2, 2); x.lineTo(TEX - 2, TEX - 2);
    x.moveTo(TEX - 2, 2); x.lineTo(2, TEX - 2); x.stroke();
    noiseOn(x, TEX, TEX, 200, 0.4);
    return c;
  }

  /* ------------------------------------------------------------------ *
   * World (grid map)
   * ------------------------------------------------------------------ */

  function World(grid) {
    this.grid = grid;
    this.h = grid.length;
    this.w = grid[0].length;
  }
  World.prototype.at = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 1;
    return this.grid[y][x];
  };
  World.prototype.solid = function (x, y) {
    return this.at(Math.floor(x), Math.floor(y)) > 0;
  };

  /* ------------------------------------------------------------------ *
   * Raycaster
   * ------------------------------------------------------------------ */

  function Raycaster(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.textures = [null, texBrick(), texConcrete(), texCrate()];
    this.zbuffer = null;
  }

  Raycaster.prototype.resize = function () {
    var w = Math.min(this.canvas.clientWidth || 960, 1100);
    this.canvas.width = Math.floor(w / STRIP) * STRIP;
    this.canvas.height = Math.floor(this.canvas.width * 0.5625 / STRIP) * STRIP;
    this.zbuffer = new Float32Array(this.canvas.width);
  };

  // Single DDA ray. Returns { dist, side, cell, wallX } or null.
  function castRay(world, px, py, rdx, rdy) {
    if (Math.abs(rdx) < 1e-9) rdx = 1e-9;
    if (Math.abs(rdy) < 1e-9) rdy = 1e-9;
    var mapX = Math.floor(px), mapY = Math.floor(py);
    var ddx = Math.abs(1 / rdx), ddy = Math.abs(1 / rdy);
    var stepX, stepY, sdx, sdy;
    if (rdx < 0) { stepX = -1; sdx = (px - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - px) * ddx; }
    if (rdy < 0) { stepY = -1; sdy = (py - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - py) * ddy; }
    var side = 0, cell = 0, guard = 0;
    while (guard++ < 80) {
      if (sdx < sdy) { mapX += stepX; sdx += ddx; side = 0; }
      else { mapY += stepY; sdy += ddy; side = 1; }
      cell = world.at(mapX, mapY);
      if (cell > 0) {
        var dist = side === 0 ? sdx - ddx : sdy - ddy;
        var wallX = side === 0 ? py + dist * rdy : px + dist * rdx;
        wallX -= Math.floor(wallX);
        return { dist: dist, side: side, cell: cell, wallX: wallX };
      }
    }
    return null;
  }

  Raycaster.prototype.render = function (world, cam, sprites) {
    var ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    var dirX = Math.cos(cam.dir), dirY = Math.sin(cam.dir);
    var planeX = -dirY * FOV_PLANE, planeY = dirX * FOV_PLANE;

    // Ceiling and floor gradients.
    var g = ctx.createLinearGradient(0, 0, 0, H / 2);
    g.addColorStop(0, '#14181f'); g.addColorStop(1, '#232a36');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H / 2);
    g = ctx.createLinearGradient(0, H / 2, 0, H);
    g.addColorStop(0, '#262320'); g.addColorStop(1, '#121110');
    ctx.fillStyle = g; ctx.fillRect(0, H / 2, W, H / 2);

    // Walls.
    for (var x = 0; x < W; x += STRIP) {
      var cameraX = 2 * x / W - 1;
      var rdx = dirX + planeX * cameraX;
      var rdy = dirY + planeY * cameraX;
      var hit = castRay(world, cam.x, cam.y, rdx, rdy);
      if (!hit) { this.zbuffer[x] = MAX_DEPTH; continue; }
      // Perpendicular distance (corrects fisheye).
      var perp = hit.dist * Math.abs(Math.cos(Math.atan2(rdy, rdx) - cam.dir));
      perp = Math.max(perp, 0.05);
      for (var zb = 0; zb < STRIP; zb++) this.zbuffer[x + zb] = perp;

      var lineH = Math.min(H / perp, H * 4);
      var y0 = (H - lineH) / 2;
      var tex = this.textures[hit.cell] || this.textures[1];
      var texX = Math.floor(hit.wallX * TEX);
      if ((hit.side === 0 && rdx > 0) || (hit.side === 1 && rdy < 0)) texX = TEX - texX - 1;
      ctx.drawImage(tex, texX, 0, 1, TEX, x, y0, STRIP, lineH);

      // Distance fog + N/S wall shading.
      var shade = Math.min(0.85, perp / MAX_DEPTH + (hit.side === 1 ? 0.18 : 0));
      if (shade > 0.02) {
        ctx.fillStyle = 'rgba(4,6,10,' + shade.toFixed(3) + ')';
        ctx.fillRect(x, y0, STRIP, lineH);
      }
    }

    // Sprites (billboards), far to near.
    var list = sprites.slice().sort(function (a, b) {
      var da = (a.x - cam.x) * (a.x - cam.x) + (a.y - cam.y) * (a.y - cam.y);
      var db = (b.x - cam.x) * (b.x - cam.x) + (b.y - cam.y) * (b.y - cam.y);
      return db - da;
    });
    var invDet = 1 / (planeX * dirY - dirX * planeY);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var relX = s.x - cam.x, relY = s.y - cam.y;
      var tx = invDet * (dirY * relX - dirX * relY);
      var ty = invDet * (-planeY * relX + planeX * relY); // depth
      if (ty < 0.15) continue;
      var screenX = (W / 2) * (1 + tx / ty);
      var size = (H / ty) * (s.scale || 1);
      var drawW = size * (s.aspect || 1); // aspect = width / height
      var vOff = (s.vOff || 0) * size;
      var yTop = (H - size) / 2 + vOff;
      var x0 = Math.floor(screenX - drawW / 2);
      var x1 = Math.floor(screenX + drawW / 2);
      for (var sx = Math.max(0, x0); sx < Math.min(W, x1); sx += STRIP) {
        if (this.zbuffer[sx] <= ty) continue; // occluded by wall
        var u = (sx - x0) / (x1 - x0);
        var texCol = Math.floor(u * s.img.width);
        ctx.drawImage(s.img, texCol, 0, Math.max(1, STRIP * s.img.width / (x1 - x0)), s.img.height, sx, yTop, STRIP, size);
      }
      // Team marker above teammates.
      if (s.marker) {
        ctx.fillStyle = s.marker;
        var my = yTop - 10;
        ctx.beginPath();
        ctx.moveTo(screenX, my);
        ctx.lineTo(screenX - 5, my - 8);
        ctx.lineTo(screenX + 5, my - 8);
        ctx.fill();
      }
      // Muzzle flash.
      if (s.flash > 0) {
        var fr = size * 0.22 * (0.7 + Math.random() * 0.6);
        var fg = ctx.createRadialGradient(screenX, yTop + size * 0.42, 0, screenX, yTop + size * 0.42, fr);
        fg.addColorStop(0, 'rgba(255,230,140,' + Math.min(1, s.flash * 18) + ')');
        fg.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(screenX - fr, yTop + size * 0.42 - fr, fr * 2, fr * 2);
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Billboard sprite painters (procedural, drawn once)
   * ------------------------------------------------------------------ */

  function makeSoldier(body, accent) {
    var c = makeCanvas(64, 128), x = c.getContext('2d');
    x.clearRect(0, 0, 64, 128);
    // legs
    x.fillStyle = '#1c1e22';
    x.fillRect(20, 84, 10, 40); x.fillRect(34, 84, 10, 40);
    // torso
    x.fillStyle = body;
    x.fillRect(16, 44, 32, 44);
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillRect(16, 44, 32, 8); // vest strap
    // arms
    x.fillStyle = body;
    x.fillRect(10, 48, 8, 30); x.fillRect(46, 48, 8, 30);
    // head + helmet
    x.fillStyle = '#c9a184'; x.fillRect(24, 18, 16, 22);
    x.fillStyle = accent; x.fillRect(20, 10, 24, 14);
    // visor
    x.fillStyle = '#101318'; x.fillRect(26, 26, 12, 6);
    // rifle held across chest
    x.fillStyle = '#0c0d0f';
    x.fillRect(8, 62, 48, 6);
    x.fillRect(44, 56, 6, 14);
    return c;
  }

  function makeBomb() {
    var c = makeCanvas(48, 48), x = c.getContext('2d');
    x.clearRect(0, 0, 48, 48);
    x.fillStyle = '#2a2d33';
    x.fillRect(6, 16, 36, 26);
    x.strokeStyle = '#111'; x.strokeRect(6, 16, 36, 26);
    x.fillStyle = '#3a3f47'; x.fillRect(10, 20, 12, 8);
    x.fillStyle = '#ff3b30'; x.fillRect(30, 22, 6, 6); // blinking light (tinted at draw time)
    x.strokeStyle = '#d8b25a'; x.beginPath(); x.moveTo(12, 16); x.lineTo(20, 4); x.stroke();
    return c;
  }

  /* ------------------------------------------------------------------ *
   * Minimap
   * ------------------------------------------------------------------ */

  function drawMinimap(canvas, world, opts) {
    var ctx = canvas.getContext('2d');
    var S = canvas.width;
    var sc = S / Math.max(world.w, world.h);
    ctx.fillStyle = 'rgba(8,10,14,0.85)';
    ctx.fillRect(0, 0, S, S);
    for (var y = 0; y < world.h; y++) {
      for (var x = 0; x < world.w; x++) {
        if (world.grid[y][x] > 0) {
          ctx.fillStyle = '#3d4653';
          ctx.fillRect(x * sc, y * sc, sc, sc);
        }
      }
    }
    // bomb sites
    ctx.font = 'bold ' + Math.floor(sc * 1.6) + 'px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['A', 'B'].forEach(function (k) {
      var s = opts.sites[k];
      ctx.fillStyle = 'rgba(240,165,0,0.15)';
      ctx.fillRect((s.x - 2) * sc, (s.y - 2) * sc, sc * 5, sc * 5);
      ctx.fillStyle = '#f0a500';
      ctx.fillText(k, (s.x + 0.5) * sc, (s.y + 0.5) * sc);
    });
    // dots: teammates, enemy blips, bomb
    (opts.dots || []).forEach(function (d) {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc((d.x + 0.5) * sc, (d.y + 0.5) * sc, d.r || 3, 0, Math.PI * 2);
      ctx.fill();
    });
    // player arrow
    var p = opts.player;
    if (p) {
      ctx.save();
      ctx.translate(p.x * sc, p.y * sc);
      ctx.rotate(p.dir);
      ctx.fillStyle = '#f5f7fa';
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }

  window.Engine = {
    World: World,
    Raycaster: Raycaster,
    castRay: castRay,
    makeSoldier: makeSoldier,
    makeBomb: makeBomb,
    drawMinimap: drawMinimap,
    STRIP: STRIP
  };
})();
