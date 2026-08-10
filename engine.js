/* fps-strike — engine.js
 * Wolfenstein-style raycasting engine: procedural textures, textured walls,
 * half-resolution floor/ceiling casting with distance shading, billboard
 * sprites with per-column z-buffering, and a top-down map painter.
 * Exposed as the global `Engine`. No dependencies, no modules (file:// safe).
 */
(function () {
  'use strict';

  var TEX = 64;          // texture size in px
  var STRIP = 2;         // screen column width in px (ray step)
  var MAX_DEPTH = 24;    // fog distance in tiles
  var FOV_PLANE = 0.66;  // camera plane half-length (~66 degree FOV)
  var SHADES = 16;       // floor/ceiling distance-shade levels

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

  // Floor: dusty checkered concrete tiles.
  function texFloor() {
    var c = makeCanvas(TEX, TEX), x = c.getContext('2d');
    x.fillStyle = '#57534c'; x.fillRect(0, 0, TEX, TEX);
    x.fillStyle = '#4c4942'; x.fillRect(0, 0, 32, 32);
    x.fillRect(32, 32, 32, 32);
    x.strokeStyle = 'rgba(20,18,14,0.7)'; x.lineWidth = 2;
    x.strokeRect(1, 1, 31, 31); x.strokeRect(33, 1, 31, 31);
    x.strokeRect(1, 33, 31, 31); x.strokeRect(33, 33, 31, 31);
    noiseOn(x, TEX, TEX, 600, 0.55);
    return c;
  }

  // Ceiling: dark plated metal with seams and lamps.
  function texCeiling() {
    var c = makeCanvas(TEX, TEX), x = c.getContext('2d');
    x.fillStyle = '#2e3238'; x.fillRect(0, 0, TEX, TEX);
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2;
    x.strokeRect(1, 1, TEX - 2, TEX - 2);
    x.beginPath(); x.moveTo(TEX / 2, 0); x.lineTo(TEX / 2, TEX); x.stroke();
    x.fillStyle = 'rgba(200,210,220,0.10)';
    x.fillRect(8, 8, 16, 16); x.fillRect(40, 40, 16, 16); // dim panels
    noiseOn(x, TEX, TEX, 350, 0.5);
    return c;
  }

  // Read an RGB canvas into per-shade-level Uint32 arrays (ABGR little-endian).
  function shadeLevels(canvas) {
    var ctx = canvas.getContext('2d');
    var data = ctx.getImageData(0, 0, TEX, TEX).data;
    var levels = [];
    for (var l = 0; l < SHADES; l++) {
      var f = 1 - (l / (SHADES - 1)) * 0.88; // darkening factor per level
      var arr = new Uint32Array(TEX * TEX);
      for (var p = 0; p < TEX * TEX; p++) {
        var r = (data[p * 4] * f) | 0, g = (data[p * 4 + 1] * f) | 0, b = (data[p * 4 + 2] * f) | 0;
        arr[p] = 0xFF000000 | (b << 16) | (g << 8) | r;
      }
      levels.push(arr);
    }
    return levels;
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
    this.floorLevels = shadeLevels(texFloor());
    this.ceilLevels = shadeLevels(texCeiling());
    this.zbuffer = null;
    this.floorC = null;   // half-res floor buffer canvas
    this.floorImg = null; // its ImageData
    this.floorBuf = null; // Uint32 view over floorImg
  }

  Raycaster.prototype.resize = function () {
    var w = Math.min(this.canvas.clientWidth || 960, 1100);
    this.canvas.width = Math.floor(w / STRIP) * STRIP;
    this.canvas.height = Math.floor(this.canvas.width * 0.5625 / STRIP) * STRIP;
    this.zbuffer = new Float32Array(this.canvas.width);
    var fw = this.canvas.width >> 1, fh = this.canvas.height >> 1;
    if (!this.floorC || this.floorC.width !== fw || this.floorC.height !== fh) {
      this.floorC = makeCanvas(fw, fh);
      var fctx = this.floorC.getContext('2d');
      this.floorImg = fctx.createImageData(fw, fh);
      this.floorBuf = new Uint32Array(this.floorImg.data.buffer);
    }
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

  /* Half-resolution floor + ceiling casting. For each half-res row, walk the
   * floor plane between the leftmost and rightmost camera rays and sample the
   * pre-shaded texture level for that row distance. `hz` is the camera height
   * in world units (0.5 standing, lower when crouched). */
  Raycaster.prototype.renderFloor = function (cam, yc, dirX, dirY, planeX, planeY) {
    var fw = this.floorC.width, fh = this.floorC.height;
    var buf = this.floorBuf, hz = cam.z != null ? cam.z : 0.5;
    var rdx0 = dirX - planeX, rdy0 = dirY - planeY;
    var rdx1 = dirX + planeX, rdy1 = dirY + planeY;
    var hy = yc >> 1; // horizon in half-res rows
    for (var y = 0; y < fh; y++) {
      var p = y - hy;
      if (p === 0) continue;
      var isFloor = p > 0;
      var ap = isFloor ? p : -p;
      var rowDist = ((isFloor ? hz : 1 - hz) * fh) / ap;
      if (rowDist > MAX_DEPTH * 1.5) rowDist = MAX_DEPTH * 1.5;
      var level = this.floorLevels[0]; // placeholder, reassigned below
      var lv = Math.min(SHADES - 1, (rowDist * 1.1) | 0);
      level = isFloor ? this.floorLevels[lv] : this.ceilLevels[lv];
      var stepX = rowDist * (rdx1 - rdx0) / fw;
      var stepY = rowDist * (rdy1 - rdy0) / fw;
      var fx = cam.x + rowDist * rdx0, fy = cam.y + rowDist * rdy0;
      var rowOff = y * fw;
      for (var x = 0; x < fw; x++) {
        var tx = ((fx - Math.floor(fx)) * TEX) | 0;
        var ty = ((fy - Math.floor(fy)) * TEX) | 0;
        buf[rowOff + x] = level[ty * TEX + tx];
        fx += stepX; fy += stepY;
      }
    }
    var fctx = this.floorC.getContext('2d');
    fctx.putImageData(this.floorImg, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.floorC, 0, 0, this.canvas.width, this.canvas.height);
  };

  Raycaster.prototype.render = function (world, cam, sprites) {
    var ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    var dirX = Math.cos(cam.dir), dirY = Math.sin(cam.dir);
    var zoom = cam.zoom || 1;
    var planeX = -dirY * FOV_PLANE * zoom, planeY = dirX * FOV_PLANE * zoom;
    var hz = cam.z != null ? cam.z : 0.5; // camera height, world units
    var yc = H / 2 + (cam.height || 0);   // horizon row (px), shaken/kicked

    // Textured floor + ceiling.
    this.renderFloor(cam, yc, dirX, dirY, planeX, planeY);

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
      var y0 = yc - hz * lineH;
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
      var yTop = yc - hz * size + vOff;
      var x0 = Math.floor(screenX - drawW / 2);
      var x1 = Math.floor(screenX + drawW / 2);
      if (s.alpha != null) ctx.globalAlpha = s.alpha;
      for (var sx = Math.max(0, x0); sx < Math.min(W, x1); sx += STRIP) {
        if (this.zbuffer[sx] <= ty) continue; // occluded by wall
        var u = (sx - x0) / (x1 - x0);
        var texCol = Math.floor(u * s.img.width);
        ctx.drawImage(s.img, texCol, 0, Math.max(1, STRIP * s.img.width / (x1 - x0)), s.img.height, sx, yTop, STRIP, size);
      }
      if (s.alpha != null) ctx.globalAlpha = 1;
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

  // Small round grenade (in-hand viewmodel / thrown projectile).
  function makeGrenade(color) {
    var c = makeCanvas(32, 32), x = c.getContext('2d');
    x.clearRect(0, 0, 32, 32);
    x.fillStyle = color;
    x.beginPath(); x.arc(16, 18, 10, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.25)';
    x.beginPath(); x.arc(13, 15, 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#3a3d42'; x.fillRect(13, 4, 6, 6);   // fuse head
    x.strokeStyle = '#c7ccd4'; x.lineWidth = 2;
    x.beginPath(); x.arc(21, 7, 4, -1.2, 1.6); x.stroke(); // pin ring
    return c;
  }

  // Smoke plume puff (soft gray blob, drawn with alpha at render time).
  function makeSmokePuff() {
    var c = makeCanvas(96, 96), x = c.getContext('2d');
    x.clearRect(0, 0, 96, 96);
    for (var i = 0; i < 5; i++) {
      var r = 22 + Math.random() * 18;
      var cx = 48 + (Math.random() - 0.5) * 30, cy = 48 + (Math.random() - 0.5) * 30;
      var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(196,200,206,0.85)');
      g.addColorStop(1, 'rgba(160,164,170,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 96, 96);
    }
    return c;
  }

  // Impact puff: wall dust ('#c9c2b4') or blood ('#a31621').
  function makePuff(color) {
    var c = makeCanvas(32, 32), x = c.getContext('2d');
    x.clearRect(0, 0, 32, 32);
    var g = x.createRadialGradient(16, 16, 0, 16, 16, 15);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
    return c;
  }

  /* ------------------------------------------------------------------ *
   * Top-down map painter (used by radar.js, drawn once per map)
   * ------------------------------------------------------------------ */

  function paintMap(world, sites, pxPerTile) {
    var s = pxPerTile || 8;
    var c = makeCanvas(world.w * s, world.h * s);
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, c.width, c.height);
    for (var y = 0; y < world.h; y++) {
      for (var x = 0; x < world.w; x++) {
        var v = world.grid[y][x];
        if (v > 0) {
          ctx.fillStyle = v === 3 ? '#5a4a30' : '#4a5464';
          ctx.fillRect(x * s, y * s, s, s);
        } else {
          ctx.fillStyle = '#1d232e';
          ctx.fillRect(x * s, y * s, s, s);
        }
      }
    }
    ['A', 'B'].forEach(function (k) {
      var st = sites[k];
      ctx.fillStyle = 'rgba(240,165,0,0.13)';
      ctx.fillRect((st.x - 2) * s, (st.y - 2) * s, s * 5, s * 5);
      ctx.fillStyle = '#f0a500';
      ctx.font = 'bold ' + Math.floor(s * 1.8) + 'px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(k, (st.x + 0.5) * s, (st.y + 0.5) * s);
    });
    return c;
  }

  window.Engine = {
    World: World,
    Raycaster: Raycaster,
    castRay: castRay,
    makeCanvas: makeCanvas,
    makeSoldier: makeSoldier,
    makeBomb: makeBomb,
    makeGrenade: makeGrenade,
    makeSmokePuff: makeSmokePuff,
    makePuff: makePuff,
    paintMap: paintMap,
    STRIP: STRIP
  };
})();
