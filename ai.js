/* fps-strike — ai.js
 * Bot intelligence: BFS grid pathfinding plus a small state machine per bot
 * (objective -> hunt -> engage -> plant/defuse). Exposed as the global `AI`.
 * Bots act through the game facade `G` so all combat rules stay in game.js.
 *
 * Realism layer: 150-400ms reaction delay on first sight, aim error that
 * shrinks while tracking, hearing (gunshots and loud footsteps), flashbang
 * blindness (bots spray at their last memory), a bias for holding near wall
 * corners while engaging, and occasional flash/HE usage at range.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * BFS pathfinding on the tile grid (4-connected).
   * Returns a list of tile-center waypoints [{x,y}...], or null.
   * ------------------------------------------------------------------ */
  function findPath(world, sx, sy, tx, ty) {
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    if (sx === tx && sy === ty) return [{ x: tx + 0.5, y: ty + 0.5 }];
    if (world.at(tx, ty) > 0) {
      // Target inside a wall: nudge to a free neighbour.
      var fixed = false;
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        if (world.at(tx + nb[i][0], ty + nb[i][1]) === 0) { tx += nb[i][0]; ty += nb[i][1]; fixed = true; break; }
      }
      if (!fixed) return null;
    }
    var W = world.w, H = world.h;
    var prev = new Int32Array(W * H).fill(-1);
    var q = [sy * W + sx];
    prev[sy * W + sx] = sy * W + sx;
    var dirs = [1, -1, W, -W];
    var target = ty * W + tx;
    var head = 0;
    while (head < q.length) {
      var cur = q[head++];
      if (cur === target) break;
      var cx = cur % W, cy = (cur / W) | 0;
      for (var d = 0; d < 4; d++) {
        var n = cur + dirs[d];
        var nx = n % W, ny = (n / W) | 0;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue; // no wrap
        if (prev[n] !== -1 || world.at(nx, ny) > 0) continue;
        prev[n] = cur;
        q.push(n);
      }
    }
    if (prev[target] === -1) return null;
    var path = [];
    var c = target;
    while (c !== sy * W + sx) {
      path.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
      c = prev[c];
    }
    path.reverse();
    // Greedy string-pulling: from each anchor, skip to the furthest
    // waypoint with clear line-of-sight. Falls back to the raw path.
    var out = [];
    var anchor = { x: sx + 0.5, y: sy + 0.5 };
    var k = 0;
    while (k < path.length) {
      var far = k;
      for (var m = path.length - 1; m > k; m--) {
        if (AI.losGrid(world, anchor.x, anchor.y, path[m].x, path[m].y)) { far = m; break; }
      }
      out.push(path[far]);
      anchor = path[far];
      k = far + 1;
    }
    return out;
  }

  var AI = {};

  // Grid line-of-sight: sample along the segment, blocked by solid tiles.
  AI.losGrid = function (world, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.ceil(dist / 0.1));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (world.solid(x1 + dx * t, y1 + dy * t)) return false;
    }
    return true;
  };

  AI.findPath = findPath;

  /* ------------------------------------------------------------------ *
   * Bot brain — called once per frame per alive bot.
   * G provides: world, sites, bomb, phase, time, noise,
   *             los(), tryMove(), foesOf(), botShoot(), botThrowNade(),
   *             onPlant(), onDefuse(), onPickupBomb(), closestAliveT()
   * ------------------------------------------------------------------ */

  function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
  function angleDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function setDestination(bot, G, x, y) {
    // Repath at most every ~0.8s or when the goal moved meaningfully.
    var moved = !bot.goal || Math.abs(bot.goal.x - x) > 1 || Math.abs(bot.goal.y - y) > 1;
    bot.repathT -= 1;
    if (moved || bot.repathT <= 0 || !bot.path || bot.pathI >= bot.path.length) {
      bot.path = findPath(G.world, bot.x, bot.y, x, y);
      bot.pathI = 0;
      bot.goal = { x: x, y: y };
      bot.repathT = 45; // frames
    }
  }

  function followPath(bot, G, dt, speed) {
    if (!bot.path || bot.pathI >= bot.path.length) return true;
    var wp = bot.path[bot.pathI];
    var dx = wp.x - bot.x, dy = wp.y - bot.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.25) { bot.pathI++; return bot.pathI >= bot.path.length; }
    var step = Math.min(speed * dt, dist);
    G.tryMove(bot, (dx / dist) * step, (dy / dist) * step, 0.28);
    bot.moving = speed > 2; // loud footsteps only at full speed
    // Stuck detection: snagged on a corner — skip ahead and force a repath.
    bot.stuckT = bot.stuckT || 0;
    if (bot.lastX !== undefined &&
        Math.hypot(bot.x - bot.lastX, bot.y - bot.lastY) < speed * dt * 0.3) {
      bot.stuckT += dt;
      if (bot.stuckT > 0.5) {
        bot.pathI++;
        bot.repathT = 0;
        bot.stuckT = 0;
      }
    } else {
      bot.stuckT = 0;
    }
    bot.lastX = bot.x; bot.lastY = bot.y;
    return false;
  }

  // Pick the closest visible living enemy. FOV ~ 120 degrees.
  function acquireTarget(bot, G) {
    if (bot.flashed > 0) return null; // flash-blind
    var best = null, bestD = 20;
    var foes = G.foesOf(bot.team);
    for (var i = 0; i < foes.length; i++) {
      var f = foes[i];
      if (!f.alive) continue;
      var dx = f.x - bot.x, dy = f.y - bot.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 18 || d >= bestD) continue;
      var ang = angleTo(bot.x, bot.y, f.x, f.y);
      if (Math.abs(angleDiff(ang, bot.dir)) > 1.05 && d > 2.5) continue; // outside FOV unless point-blank
      if (!G.los(bot.x, bot.y, f.x, f.y)) continue; // walls AND smoke
      best = f; bestD = d;
    }
    return best;
  }

  /* Cover bias: pick the strafe side that has a wall within ~1.2 tiles, so
   * the bot settles next to a corner instead of standing in the open. */
  function pickCoverSide(bot, G, aimAng) {
    for (var s = 0; s < 2; s++) {
      var sign = s === 0 ? 1 : -1;
      var a = aimAng + Math.PI / 2 * sign;
      var px = bot.x + Math.cos(a) * 1.2, py = bot.y + Math.sin(a) * 1.2;
      if (G.world.solid(px, py)) return sign;
    }
    return Math.random() < 0.5 ? -1 : 1;
  }

  // Blind-fire at the last known enemy position while flashed.
  function flashedBehaviour(bot, G, dt) {
    bot.flashed -= dt;
    if (bot.lastSeen && G.time - bot.lastSeen.t < 3) {
      var aimAng = angleTo(bot.x, bot.y, bot.lastSeen.x, bot.lastSeen.y);
      bot.dir += angleDiff(aimAng, bot.dir) * Math.min(1, dt * 3);
      bot.fireT -= dt;
      if (bot.fireT <= 0 && Math.abs(angleDiff(bot.dir, aimAng)) < 0.4) {
        G.botShoot(bot, bot.lastSeen, 0.22); // spraying blind
        bot.fireT = 0.25 + Math.random() * 0.3;
      }
    } else {
      bot.dir += Math.sin(G.time * 5 + bot.id) * 0.06; // disoriented
    }
  }

  AI.think = function (bot, G, dt) {
    if (!bot.alive || G.phase === 'buy' || G.phase === 'roundEnd' || G.phase === 'matchEnd') return;
    bot.moving = false;
    if (bot.flash > 0) bot.flash -= dt;
    if (bot.flashed > 0) { flashedBehaviour(bot, G, dt); return; }
    if (bot.nadeCd > 0) bot.nadeCd -= dt;

    var target = acquireTarget(bot, G);
    var now = G.time;

    if (target) {
      bot.lastSeen = { x: target.x, y: target.y, t: now, ref: target };
    }

    /* --- Channelled actions (plant / defuse) take priority --- */
    if (bot.channel) {
      var ch = bot.channel;
      // Cancel if an enemy is visible and close.
      if (target && ch.breakOnThreat) { bot.channel = null; }
      else {
        ch.t += dt;
        bot.dir += angleDiff(angleTo(bot.x, bot.y, ch.x, ch.y), bot.dir) * 0.2;
        if (ch.t >= ch.need) {
          bot.channel = null;
          if (ch.kind === 'plant') G.onPlant(bot);
          else G.onDefuse(bot);
        }
        return;
      }
    }

    /* --- Combat --- */
    if (target) {
      var aimAng = angleTo(bot.x, bot.y, target.x, target.y);
      var dist = Math.hypot(target.x - bot.x, target.y - bot.y);
      // Turn toward target; aim error shrinks the longer the bot tracks it.
      if (bot.trackRef !== target) { bot.trackRef = target; bot.trackT = 0; bot.reacted = false; bot.coverSide = 0; }
      bot.trackT += dt;
      if (!bot.reacted && bot.trackT > bot.reaction) bot.reacted = true;
      bot.dir += angleDiff(aimAng, bot.dir) * Math.min(1, dt * 8);
      var err = Math.max(0.015, 0.09 - bot.trackT * 0.05);

      // Occasionally lob a grenade at a target held at range.
      if (bot.reacted && bot.nadeCd <= 0 && bot.nades && dist > 3.5 && dist < 12) {
        bot.nadeCd = 9 + Math.random() * 6;
        if (bot.nades.flash > 0 && Math.random() < 0.5) { bot.nades.flash--; G.botThrowNade(bot, 'flash', target); }
        else if (bot.nades.he > 0) { bot.nades.he--; G.botThrowNade(bot, 'he', target); }
      }

      if (bot.reacted) {
        bot.burstLeft = bot.burstLeft || 0;
        bot.fireT -= dt;
        if (bot.fireT <= 0) {
          if (bot.burstLeft <= 0) {
            bot.burstLeft = bot.weapon.kind === 'rifle' ? 3 + (Math.random() * 3 | 0) : 1 + (Math.random() * 2 | 0);
          }
          var aimed = Math.abs(angleDiff(bot.dir, aimAng)) < 0.12;
          if (aimed) {
            G.botShoot(bot, target, err);
            bot.burstLeft--;
            bot.fireT = bot.weapon.kind === 'rifle' ? 0.11 : 0.28;
            if (bot.burstLeft <= 0) bot.fireT = 0.45 + Math.random() * 0.5; // pause between bursts
          } else {
            bot.fireT = 0.05;
          }
        }
      }

      // Movement: hold still while firing (CS discipline), strafe between
      // bursts toward the nearest wall corner for cover.
      if (bot.burstLeft <= 0 || !bot.reacted) {
        if (!bot.coverSide) bot.coverSide = pickCoverSide(bot, G, aimAng);
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) { bot.coverSide = pickCoverSide(bot, G, aimAng); bot.strafeT = 0.4 + Math.random() * 0.6; }
        var sa = aimAng + Math.PI / 2 * bot.coverSide;
        G.tryMove(bot, Math.cos(sa) * 1.4 * dt, Math.sin(sa) * 1.4 * dt, 0.28);
        bot.moving = true;
      }
      return;
    }

    /* --- No visible enemy: pursue objective --- */
    var bomb = G.bomb;

    if (bot.team === 'T') {
      if (bomb.planted) {
        // Guard the planted bomb from a short distance.
        var gd = Math.hypot(bot.x - bomb.x, bot.y - bomb.y);
        if (gd > 4) { setDestination(bot, G, bomb.x, bomb.y); followPath(bot, G, dt, bot.speed); }
        else hunt(bot, G, dt);
        return;
      }
      if (bot.hasBomb) {
        var site = G.sites[bot.site];
        if (AI.losGrid(G.world, bot.x, bot.y, site.x + 0.5, site.y + 0.5) &&
            Math.hypot(bot.x - site.x - 0.5, bot.y - site.y - 0.5) < 2.2) {
          bot.channel = { kind: 'plant', t: 0, need: 3, x: bot.x, y: bot.y, breakOnThreat: true };
        } else {
          setDestination(bot, G, site.x, site.y);
          followPath(bot, G, dt, bot.speed);
        }
        return;
      }
      if (bomb.dropped) {
        // Closest T bot retrieves the bomb.
        var carrier = G.closestAliveT(bomb.x, bomb.y);
        if (carrier === bot) {
          if (Math.hypot(bot.x - bomb.x, bot.y - bomb.y) < 0.7) { G.onPickupBomb(bot); return; }
          setDestination(bot, G, bomb.x, bomb.y);
          followPath(bot, G, dt, bot.speed);
          return;
        }
      }
      // Escort: move toward assigned site with a per-bot offset.
      var s2 = G.sites[bot.site];
      setDestination(bot, G, s2.x + bot.offX, s2.y + bot.offY);
      followPath(bot, G, dt, bot.speed);
      return;
    }

    /* --- CT behaviour --- */
    if (bomb.planted) {
      var bd = Math.hypot(bot.x - bomb.x, bot.y - bomb.y);
      if (bd < 1.1) {
        bot.channel = { kind: 'defuse', t: 0, need: bot.kit ? 2.5 : 5, x: bomb.x, y: bomb.y, breakOnThreat: true };
      } else {
        setDestination(bot, G, bomb.x, bomb.y);
        followPath(bot, G, dt, bot.speed);
      }
      return;
    }
    hunt(bot, G, dt);
  };

  // Investigate last-seen position or recent noise, else hold assigned site.
  function hunt(bot, G, dt) {
    var now = G.time;
    if (bot.lastSeen && now - bot.lastSeen.t < 4) {
      setDestination(bot, G, bot.lastSeen.x, bot.lastSeen.y);
      followPath(bot, G, dt, bot.speed);
      return;
    }
    if (G.noise && now - G.noise.t < 5) {
      var nd = Math.hypot(bot.x - G.noise.x, bot.y - G.noise.y);
      if (nd < (G.noise.r || 12)) { // gunshots carry far, footsteps don't
        setDestination(bot, G, G.noise.x, G.noise.y);
        followPath(bot, G, dt, bot.speed * 0.75); // walk in quiet
        return;
      }
    }
    var site = G.sites[bot.site];
    var d = Math.hypot(bot.x - site.x - bot.offX, bot.y - site.y - bot.offY);
    if (d > 0.8) {
      setDestination(bot, G, site.x + bot.offX, site.y + bot.offY);
      followPath(bot, G, dt, bot.speed * 0.8);
    } else {
      // Idle scan: slowly sweep view around the site.
      bot.dir += Math.sin(now * 0.7 + bot.id) * 0.01;
    }
  }

  window.AI = AI;
})();
