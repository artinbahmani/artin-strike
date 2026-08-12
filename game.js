/* artin-strike — game.js
 * Game glue: map, player, bots, weapons, economy, rounds, bomb logic, HUD.
 * engine.js (Engine), audio.js (SoundFX), ai.js (AI), viewmodel.js
 * (Viewmodel) and radar.js (Radar) must load first.
 */
(function () {
  'use strict';

  /* ================================================================== *
   * Map — a recreation of the classic de_dust2 layout (48x40):
   * T spawn south, CT spawn north-center, A site north-east (goose nook,
   * ramp from CT, long A with doors + pit, catwalk/short), B site
   * north-west (tunnel door + CT back corridor), mid with the double
   * doors pinch, upper/lower tunnels linking T spawn to B and mid.
   * '#'/border = sandstone wall, interior '#' = plaster, 'X' = crate
   * 'A'/'B' = bomb sites, 'C' = CT spawn, 'T' = T spawn, '.' = floor
   * ================================================================== */
  var MAP_ROWS = [
    '################################################',
    '################################################',
    '##............#######...C....#####.............#',
    '##....................C...C..#####.............#',
    '##.....................C...C...................#',
    '##.....B......#######...................A......#',
    '##............#########..#########.............#',
    '##............#########..#######...............#',
    '##............#########..#######.....X.........#',
    '##............#########..#######...............#',
    '#########..############..########...##........##',
    '########...############..########...X#....#...##',
    '########...###########..#########...##....#...##',
    '########...###########..#########...##....#...##',
    '########...##########....########...#######...##',
    '########...##########....########...#######...##',
    '########...##########....########...#######...##',
    '########...##########...............#######...##',
    '########...##########...............#######..###',
    '########...##########...............#######...##',
    '########...##########.X..##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########.................##################...##',
    '########.................##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########...##########....##################...##',
    '########...########...........................##',
    '########.....................###################',
    '##########...........T...T...###################',
    '###################....T...T.###################',
    '###################.T........###################',
    '###################..........###################',
    '################################################'
  ];

  var sites = { A: { x: 2, y: 2 }, B: { x: 21, y: 2 } };
  var ctSpawns = [], tSpawns = [];

  function parseMap() {
    var w = MAP_ROWS[0].length, h = MAP_ROWS.length;
    var grid = [];
    for (var y = 0; y < h; y++) {
      var row = [];
      for (var x = 0; x < w; x++) {
        var ch = MAP_ROWS[y].charAt(x) || '#';
        if (ch === 'A') { sites.A = { x: x, y: y }; row.push(0); }
        else if (ch === 'B') { sites.B = { x: x, y: y }; row.push(0); }
        else if (ch === 'C') { ctSpawns.push({ x: x + 0.5, y: y + 0.5 }); row.push(0); }
        else if (ch === 'T') { tSpawns.push({ x: x + 0.5, y: y + 0.5 }); row.push(0); }
        else if (ch === 'X') row.push(3);
        else if (ch === '#') row.push((x === 0 || y === 0 || x === w - 1 || y === h - 1) ? 1 : 2);
        else row.push(0);
      }
      grid.push(row);
    }
    // Need 4 spawn points per team; pad with free neighbours of the markers.
    expandSpawns(ctSpawns, grid);
    expandSpawns(tSpawns, grid);
    return grid;
  }

  function expandSpawns(list, grid) {
    var base = list.slice();
    var dirs = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1]];
    for (var i = 0; i < base.length && list.length < 4; i++) {
      for (var d = 0; d < dirs.length && list.length < 4; d++) {
        var nx = Math.floor(base[i].x) + dirs[d][0];
        var ny = Math.floor(base[i].y) + dirs[d][1];
        var p = { x: nx + 0.5, y: ny + 0.5 };
        var dup = list.some(function (s) { return s.x === p.x && s.y === p.y; });
        if (!dup && grid[ny] && grid[ny][nx] === 0) list.push(p);
      }
    }
  }

  var world = new Engine.World(parseMap());

  /* ================================================================== *
   * Constants
   * ================================================================== */
  var WEAPONS = {
    knife:  { kind: 'knife',  name: 'Knife', dmg: 55, rate: 0.5,  range: 1.7, auto: false },
    pistol: { kind: 'pistol', name: 'P250',  dmg: 25, rate: 0.19, magSize: 13, reserveSize: 52, reload: 1.6, price: 300,  spread: 0.010, bloom: 0.009, falloff: 12, auto: false },
    rifle:  { kind: 'rifle',  name: 'AK-47', dmg: 33, rate: 0.105, magSize: 30, reserveSize: 90, reload: 2.4, price: 2700, spread: 0.008, bloom: 0.012, falloff: 15, auto: true }
  };
  var SHOP = [
    { id: 'rifle',  name: 'AK-47',       price: 2700, desc: '30/90 · full auto' },
    { id: 'pistol', name: 'P250',        price: 300,  desc: '13/52 sidearm' },
    { id: 'armor',  name: 'Kevlar Vest', price: 650,  desc: 'absorbs 40% damage' },
    { id: 'kit',    name: 'Defuse Kit',  price: 400,  desc: 'halves defuse time' },
    { id: 'ammo',   name: 'Full Ammo',   price: 200,  desc: 'refill all reserves' }
  ];

  var BUY_TIME = 8, ROUND_TIME = 100, BOMB_TIME = 30, END_TIME = 4;
  var PLANT_TIME = 3, DEFUSE_TIME = 5, DEFUSE_KIT_TIME = 2.5;
  var WIN_ROUNDS = 6, MAX_ROUNDS = 11;
  var KILL_REWARD = 300, WIN_REWARD = 3250, LOSS_REWARD = 1900, START_MONEY = 800;

  var CT_NAMES = ['Raptor', 'Vex', 'Nomad'];
  var T_NAMES = ['Saber', 'Ghost', 'Jackal', 'Rook'];

  /* ================================================================== *
   * State
   * ================================================================== */
  var player = {
    isPlayer: true, name: 'You', team: 'CT',
    x: 2.5, y: 17.5, dir: -Math.PI / 2,
    hp: 100, armor: 0, alive: true,
    weapons: { rifle: null, pistol: { mag: 13, reserve: 52 }, knife: true },
    current: 'pistol',
    money: START_MONEY, kills: 0, deaths: 0, kit: false,
    bloom: 0, kick: 0, fireT: 0, reloading: 0, switching: 0,
    speed: 0, muzzle: 0
  };

  var bots = [];
  var bomb = { planted: false, x: 0, y: 0, timer: BOMB_TIME, dropped: null, beepT: 0 };
  var scores = { ct: 0, t: 0 };
  var roundNum = 0;
  var phase = 'menu';       // menu | buy | live | roundEnd | matchEnd
  var phaseTimer = 0;
  var time = 0;             // global clock (seconds), drives AI memory
  var noise = null;         // last gunshot position, for bot investigation
  var blips = [];           // recent enemy shots, drawn on the minimap
  var running = false, paused = false;
  var matchOverPending = false;
  var buyOpen = false, sbOpen = false;
  var spectate = null;
  var shake = 0;
  var bannerT = 0;
  var defusing = { active: false, t: 0 };
  var mouseDown = false;

  /* ================================================================== *
   * DOM
   * ================================================================== */
  function $(id) { return document.getElementById(id); }
  var canvas = $('game'), radarCv = $('radar');
  var ray = new Engine.Raycaster(canvas);
  var el = {
    timer: $('timer'), scoreCt: $('score-ct'), scoreT: $('score-t'), roundLabel: $('round-label'),
    healthFill: $('health-fill'), healthNum: $('health-num'),
    armorFill: $('armor-fill'), armorNum: $('armor-num'),
    money: $('money'), weaponName: $('weapon-name'),
    ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
    hint: $('hint'), killfeed: $('killfeed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    defuseWrap: $('defuse-wrap'), defuseFill: $('defuse-fill'), defuseLabel: $('defuse-label'),
    spectate: $('spectate-label'), dmg: $('dmg-overlay'), hitmarker: $('hitmarker'),
    buyMenu: $('buy-menu'), buyItems: $('buy-items'), buyMoney: $('buy-money'),
    scoreboard: $('scoreboard'), sbBody: $('sb-body'),
    start: $('start-overlay'), pause: $('pause-overlay'), match: $('match-overlay'),
    matchResult: $('match-result'), matchScore: $('match-score'),
    statsLine: $('stats-line'), sens: $('sens'), crosshair: $('crosshair')
  };

  var spriteCT = Engine.makeSoldier('#3d5a80', '#26374d');
  var spriteT = Engine.makeSoldier('#8a6d3b', '#54431f');
  var spriteBomb = Engine.makeBomb();

  /* ================================================================== *
   * Stats (localStorage)
   * ================================================================== */
  var STATS_KEY = 'fps-strike-stats';
  var SENS_KEY = 'fps-strike-sens';
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || { matches: 0, wins: 0, bestScore: '' }; }
    catch (e) { return { matches: 0, wins: 0, bestScore: '' }; }
  }
  function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
  }
  function renderStatsLine() {
    var s = loadStats();
    el.statsLine.textContent = s.matches > 0
      ? 'career: ' + s.wins + 'W / ' + (s.matches - s.wins) + 'L' + (s.bestScore ? ' · best ' + s.bestScore : '')
      : '';
  }
  var sensitivity = parseFloat(localStorage.getItem(SENS_KEY) || '1') || 1;
  el.sens.value = sensitivity;
  el.sens.addEventListener('input', function () {
    sensitivity = parseFloat(el.sens.value);
    try { localStorage.setItem(SENS_KEY, String(sensitivity)); } catch (e) { }
  });
  renderStatsLine();

  /* ================================================================== *
   * Helpers
   * ================================================================== */
  function angleDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function canBe(x, y, r) {
    return !world.solid(x - r, y - r) && !world.solid(x + r, y - r) &&
           !world.solid(x - r, y + r) && !world.solid(x + r, y + r);
  }
  function tryMove(e, dx, dy, r) {
    if (canBe(e.x + dx, e.y, r)) e.x += dx;
    if (canBe(e.x, e.y + dy, r)) e.y += dy;
  }
  function los(x1, y1, x2, y2) { return AI.losGrid(world, x1, y1, x2, y2); }

  function wallDist(px, py, ang) {
    var h = Engine.castRay(world, px, py, Math.cos(ang), Math.sin(ang));
    return h ? h.dist : 99;
  }
  // Distance along ray to circle edge, or -1.
  function rayCircle(px, py, ang, cx, cy, r) {
    var dx = cx - px, dy = cy - py;
    var cos = Math.cos(ang), sin = Math.sin(ang);
    var along = dx * cos + dy * sin;
    if (along <= 0) return -1;
    var perp = Math.abs(dx * sin - dy * cos);
    return perp > r ? -1 : along;
  }

  function foesOf(team) {
    var out = [];
    var i;
    if (team === 'CT') {
      for (i = 0; i < bots.length; i++) if (bots[i].team === 'T') out.push(bots[i]);
    } else {
      out.push(player);
      for (i = 0; i < bots.length; i++) if (bots[i].team === 'CT') out.push(bots[i]);
    }
    return out;
  }
  function teamAlive(team) {
    var n = 0, list = foesOf(team === 'CT' ? 'T' : 'CT');
    for (var i = 0; i < list.length; i++) if (list[i].alive) n++;
    return n;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function fmtMoney(m) { return '$' + m; }

  /* ================================================================== *
   * Bots
   * ================================================================== */
  function makeBot(id, name, team) {
    return {
      id: id, name: name, team: team, isPlayer: false,
      x: 1.5, y: 1.5, dir: 0,
      hp: 100, armor: 0, alive: true,
      weapon: { kind: 'pistol', mag: 13 },
      speed: rand(2.5, 2.9), reaction: rand(0.35, 0.65),
      site: 'A', offX: 0, offY: 0, hasBomb: false,
      money: START_MONEY, kills: 0, deaths: 0,
      flash: 0, moving: false,
      path: null, pathI: 0, repathT: 0, goal: null,
      lastSeen: null, trackRef: null, trackT: 0, reacted: false,
      burstLeft: 0, fireT: 0, strafeT: 0, strafeDir: 1, reloadT: 0,
      channel: null,
      sprite: team === 'CT' ? spriteCT : spriteT
    };
  }

  function spawnBots() {
    bots = [];
    CT_NAMES.forEach(function (n, i) { bots.push(makeBot(i, n, 'CT')); });
    T_NAMES.forEach(function (n, i) { bots.push(makeBot(10 + i, n, 'T')); });
  }

  /* ================================================================== *
   * Combat
   * ================================================================== */
  function applyDamage(target, dmg, attacker) {
    if (!target.alive) return;
    if (target.armor > 0) {
      var absorbed = Math.min(target.armor, dmg * 0.4);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.hp -= dmg;
    if (target.isPlayer) {
      el.dmg.style.opacity = Math.min(1, 0.4 + dmg / 60);
      SoundFX.hurt();
    }
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deaths++;
      attacker.kills++;
      attacker.money = Math.min(16000, attacker.money + KILL_REWARD);
      addFeed(attacker, target);
      SoundFX.death();
      // Bomb carrier drops the bomb where they died.
      if (target.hasBomb) {
        target.hasBomb = false;
        bomb.dropped = { x: target.x, y: target.y };
        addFeedText('Bomb dropped');
      }
      if (target.isPlayer) onPlayerDeath(attacker);
    }
  }

  function onPlayerDeath(killer) {
    el.spectate.textContent = 'You were eliminated by ' + killer.name + ' — spectating';
    el.spectate.classList.add('show');
    spectate = null;
    defusing.active = false;
  }

  // Hitscan shot. Shooter may be the player or a bot.
  function fireBullet(shooter, ang, wdef) {
    var wd = wallDist(shooter.x, shooter.y, ang);
    var foes = foesOf(shooter.team);
    var best = null, bestD = wd;
    for (var i = 0; i < foes.length; i++) {
      var f = foes[i];
      if (!f.alive) continue;
      var d = rayCircle(shooter.x, shooter.y, ang, f.x, f.y, 0.35);
      if (d > 0 && d < bestD) { best = f; bestD = d; }
    }
    noise = { x: shooter.x, y: shooter.y, t: time };
    if (!shooter.isPlayer) blips.push({ x: shooter.x, y: shooter.y, t: time, team: shooter.team });

    if (best) {
      var fall = bestD < wdef.falloff ? 1 : Math.max(0.55, 1 - (bestD - wdef.falloff) / 24);
      applyDamage(best, wdef.dmg * fall, shooter);
      if (shooter.isPlayer) {
        SoundFX.hit();
        el.hitmarker.classList.add('show');
        setTimeout(function () { el.hitmarker.classList.remove('show'); }, 140);
      }
    }
  }

  function meleeAttack(shooter) {
    var foes = foesOf(shooter.team);
    for (var i = 0; i < foes.length; i++) {
      var f = foes[i];
      if (!f.alive) continue;
      var d = Math.hypot(f.x - shooter.x, f.y - shooter.y);
      if (d < WEAPONS.knife.range &&
          Math.abs(angleDiff(Math.atan2(f.y - shooter.y, f.x - shooter.x), shooter.dir)) < 0.6) {
        applyDamage(f, WEAPONS.knife.dmg, shooter);
        if (shooter.isPlayer) {
          el.hitmarker.classList.add('show');
          setTimeout(function () { el.hitmarker.classList.remove('show'); }, 140);
        }
        return;
      }
    }
  }

  /* ================================================================== *
   * Player actions
   * ================================================================== */
  function currentWeapon() { return WEAPONS[player.current]; }

  function playerFire() {
    if (!player.alive || player.reloading > 0 || player.switching > 0) return;
    if (phase !== 'live') return;
    var wdef = currentWeapon();
    if (player.fireT > 0) return;

    if (player.current === 'knife') {
      player.fireT = wdef.rate;
      SoundFX.knife();
      meleeAttack(player);
      shake = Math.max(shake, 0.06);
      return;
    }
    var w = player.weapons[player.current];
    if (w.mag <= 0) { SoundFX.dryFire(); player.fireT = 0.25; return; }
    w.mag--;
    player.fireT = wdef.rate;

    // Spread: base + bloom from sustained fire + movement penalty.
    var spread = wdef.spread + player.bloom + Math.min(0.03, player.speed * 0.008);
    var ang = player.dir + (Math.random() + Math.random() - 1) * spread;
    player.bloom = Math.min(0.09, player.bloom + wdef.bloom);
    player.kick += rand(-0.006, 0.006) + (Math.random() < 0.5 ? -0.004 : 0.004); // recoil yaw kick
    shake = Math.max(shake, player.current === 'rifle' ? 0.12 : 0.08);
    player.muzzle = 0.06;
    SoundFX.shot(wdef.kind);
    fireBullet(player, ang, wdef);
  }

  function playerReload() {
    if (player.current === 'knife' || player.reloading > 0 || !player.alive) return;
    var w = player.weapons[player.current];
    var wdef = currentWeapon();
    if (w.mag >= wdef.magSize || w.reserve <= 0) return;
    player.reloading = wdef.reload;
    SoundFX.reload();
  }

  function switchWeapon(slot) {
    if (!player.alive) return;
    var target = slot === 1 ? 'rifle' : slot === 2 ? 'pistol' : 'knife';
    if (target === 'rifle' && !player.weapons.rifle) return;
    if (target === player.current) return;
    player.current = target;
    player.reloading = 0;
    player.switching = 0.4;
    player.bloom = 0;
  }

  /* ================================================================== *
   * AI facade (consumed by ai.js)
   * ================================================================== */
  var G = {
    world: world, sites: sites,
    get phase() { return phase; },
    get time() { return time; },
    get bomb() { return bomb; },
    get noise() { return noise; },
    foesOf: foesOf,
    los: los,
    tryMove: tryMove,
    botShoot: function (bot, target, err) {
      if (bot.reloadT > 0) return;
      var wdef = WEAPONS[bot.weapon.kind];
      bot.weapon.mag--;
      bot.flash = 0.06;
      SoundFX.shot(wdef.kind);
      var movePenalty = bot.moving ? 0.02 : 0;
      var ang = Math.atan2(target.y - bot.y, target.x - bot.x) +
                (Math.random() + Math.random() - 1) * (err + movePenalty + wdef.spread);
      fireBullet(bot, ang, wdef);
      if (bot.weapon.mag <= 0) {
        bot.weapon.mag = wdef.magSize;
        bot.reloadT = 2.2;
      }
    },
    onPlant: function (b) {
      bomb.planted = true;
      bomb.dropped = null;
      bomb.x = b.x; bomb.y = b.y;
      bomb.timer = BOMB_TIME;
      b.hasBomb = false;
      addFeedText(b.name + ' planted the bomb');
      showBanner('BOMB PLANTED', 'defend... no — DEFUSE IT!', 2.5);
      SoundFX.plant();
    },
    onDefuse: function (b) {
      if (!bomb.planted) return;
      bomb.planted = false;
      endRound('CT', b.name + ' defused the bomb');
    },
    onPickupBomb: function (b) {
      bomb.dropped = null;
      b.hasBomb = true;
      addFeedText(b.name + ' recovered the bomb');
    },
    closestAliveT: function (x, y) {
      var best = null, bd = 1e9;
      for (var i = 0; i < bots.length; i++) {
        var b = bots[i];
        if (b.team !== 'T' || !b.alive) continue;
        var d = Math.hypot(b.x - x, b.y - y);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    }
  };

  /* ================================================================== *
   * Round flow
   * ================================================================== */
  function placeUnits() {
    // Player at first CT spawn.
    var ps = ctSpawns[0];
    player.x = ps.x; player.y = ps.y;
    player.dir = Math.atan2(sites.A.y + 0.5 - ps.y, sites.A.x + 0.5 - ps.x);
    var ci = 1, ti = 0;
    bots.forEach(function (b) {
      var sp = b.team === 'CT' ? ctSpawns[ci++ % ctSpawns.length] : tSpawns[ti++ % tSpawns.length];
      b.x = sp.x; b.y = sp.y;
      b.dir = Math.atan2(2.5 - sp.y, (b.team === 'CT' ? sites.A.x : sites.B.x) + 0.5 - sp.x);
      b.hp = 100; b.alive = true;
      b.path = null; b.pathI = 0; b.goal = null; b.channel = null;
      b.lastSeen = null; b.flash = 0; b.reloadT = 0; b.burstLeft = 0; b.fireT = 0;
      b.hasBomb = false;
    });
  }

  function assignRoles() {
    // Terrorists commit to one site; CTs split A/B with staggered offsets.
    var tSite = Math.random() < 0.5 ? 'A' : 'B';
    var ctBots = bots.filter(function (b) { return b.team === 'CT'; });
    var tBots = bots.filter(function (b) { return b.team === 'T'; });
    ctBots.forEach(function (b, i) {
      b.site = i % 2 === 0 ? 'A' : 'B';
      b.offX = (i - 1) * 1.5; b.offY = (i % 2) * 1.5;
    });
    tBots.forEach(function (b, i) {
      b.site = tSite;
      b.offX = (i % 2) * 1.6 - 0.8; b.offY = ((i / 2) | 0) * 1.6;
    });
    // Bomb to a random T.
    tBots[(Math.random() * tBots.length) | 0].hasBomb = true;
    // Bot economy: buy a rifle when they can afford one.
    bots.forEach(function (b) {
      if (b.money >= WEAPONS.rifle.price + 1000) {
        b.money -= WEAPONS.rifle.price;
        b.weapon = { kind: 'rifle', mag: WEAPONS.rifle.magSize };
      } else {
        b.weapon = { kind: 'pistol', mag: WEAPONS.pistol.magSize };
      }
    });
  }

  function nextRound() {
    roundNum++;
    phase = 'buy';
    phaseTimer = BUY_TIME;
    bomb = { planted: false, x: 0, y: 0, timer: BOMB_TIME, dropped: null, beepT: 0 };
    blips = []; noise = null; spectate = null;
    player.hp = 100; player.alive = true;
    player.bloom = 0; player.kick = 0; player.reloading = 0; player.fireT = 0;
    defusing.active = false;
    el.spectate.classList.remove('show');
    placeUnits();
    assignRoles();
    el.roundLabel.textContent = 'ROUND ' + roundNum;
    showBanner('ROUND ' + roundNum, 'buy phase — press B', 2.5);
    openBuy();
  }

  function goLive() {
    phase = 'live';
    phaseTimer = ROUND_TIME;
    closeBuy();
    showBanner('LIVE', 'defend sites A and B', 2);
  }

  function endRound(winner, reason) {
    if (phase === 'roundEnd' || phase === 'matchEnd') return;
    phase = 'roundEnd';
    phaseTimer = END_TIME;
    defusing.active = false;
    if (winner === 'CT') scores.ct++; else scores.t++;
    el.scoreCt.textContent = scores.ct;
    el.scoreT.textContent = scores.t;

    var i, reward = winner === 'CT' ? WIN_REWARD : LOSS_REWARD;
    player.money = Math.min(16000, player.money + reward);
    for (i = 0; i < bots.length; i++) {
      bots[i].money = Math.min(16000, bots[i].money + (bots[i].team === winner ? WIN_REWARD : LOSS_REWARD));
    }

    var won = winner === 'CT';
    showBanner(won ? 'ROUND WON' : 'ROUND LOST', reason, 3);
    if (won) SoundFX.roundWin(); else SoundFX.roundLose();

    var over = scores.ct >= WIN_ROUNDS || scores.t >= WIN_ROUNDS || roundNum >= MAX_ROUNDS;
    matchOverPending = over;
  }

  function endMatch() {
    phase = 'matchEnd';
    var won = scores.ct > scores.t;
    var draw = scores.ct === scores.t;
    el.matchResult.textContent = draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
    el.matchResult.className = won ? 'win' : 'lose';
    el.matchScore.textContent = 'CT ' + scores.ct + ' — ' + scores.t + ' T';
    el.match.classList.remove('hidden');
    document.exitPointerLock && document.exitPointerLock();

    var s = loadStats();
    s.matches++;
    if (won) s.wins++;
    var sc = scores.ct + '-' + scores.t;
    if (!s.bestScore || scores.ct > parseInt(s.bestScore, 10)) s.bestScore = sc;
    saveStats(s);
    renderStatsLine();
  }

  function restartMatch() {
    scores.ct = 0; scores.t = 0; roundNum = 0;
    player.money = START_MONEY; player.kills = 0; player.deaths = 0;
    player.armor = 0; player.kit = false;
    player.weapons = { rifle: null, pistol: { mag: 13, reserve: 52 }, knife: true };
    player.current = 'pistol';
    spawnBots();
    el.match.classList.add('hidden');
    nextRound();
  }

  function checkWinConditions() {
    if (phase !== 'live') return;
    if (bomb.planted) {
      if (bomb.timer <= 0) { explode(); return; }
      if (teamAlive('CT') === 0) endRound('T', 'counter-terrorists eliminated');
      return;
    }
    if (teamAlive('T') === 0) endRound('CT', 'terrorists eliminated');
    else if (teamAlive('CT') === 0) endRound('T', 'counter-terrorists eliminated');
    else if (phaseTimer <= 0) endRound('CT', 'time expired — site held');
  }

  function explode() {
    SoundFX.explosion();
    shake = 1.2;
    // Damage everything near the bomb.
    var all = [player].concat(bots);
    all.forEach(function (e) {
      if (!e.alive) return;
      var d = Math.hypot(e.x - bomb.x, e.y - bomb.y);
      if (d < 9 && los(bomb.x, bomb.y, e.x, e.y)) {
        applyDamage(e, 220 * (1 - d / 9), { name: 'the bomb', team: e.team === 'CT' ? 'T' : 'CT', kills: 0, money: 0, isPlayer: false });
      }
    });
    bomb.planted = false;
    endRound('T', 'bomb detonated');
  }

  /* ================================================================== *
   * Bomb beeping + player defuse
   * ================================================================== */
  function updateBomb(dt) {
    if (!bomb.planted) return;
    bomb.timer -= dt;
    // Beeps accelerate as the timer runs down.
    bomb.beepT -= dt;
    if (bomb.beepT <= 0) {
      SoundFX.beep(bomb.timer < 8);
      bomb.beepT = Math.max(0.15, bomb.timer / BOMB_TIME);
    }
    // Player defuse: hold E near the bomb.
    if (player.alive && keys.KeyE &&
        Math.hypot(player.x - bomb.x, player.y - bomb.y) < 1.3) {
      if (!defusing.active) { defusing.active = true; defusing.t = 0; }
      defusing.t += dt;
      var need = player.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
      if ((defusing.t * 4 | 0) !== ((defusing.t - dt) * 4 | 0)) SoundFX.defusing();
      if (defusing.t >= need) {
        bomb.planted = false;
        defusing.active = false;
        SoundFX.defused();
        endRound('CT', 'you defused the bomb');
      }
    } else {
      defusing.active = false;
    }
  }

  /* ================================================================== *
   * Buy menu
   * ================================================================== */
  function buildBuyMenu() {
    el.buyItems.innerHTML = '';
    SHOP.forEach(function (item, i) {
      var div = document.createElement('div');
      div.className = 'buy-item';
      div.dataset.item = item.id;
      div.innerHTML = '<span class="key">' + (i + 1) + '</span>' +
        '<span class="bname">' + item.name + '</span>' +
        '<span class="bdesc">' + item.desc + '</span>' +
        '<span class="bprice">$' + item.price + '</span>';
      div.addEventListener('click', function () { buy(item.id); });
      el.buyItems.appendChild(div);
    });
  }

  function refreshBuyMenu() {
    el.buyMoney.textContent = fmtMoney(player.money);
    var rows = el.buyItems.children;
    SHOP.forEach(function (item, i) {
      var owned = (item.id === 'rifle' && player.weapons.rifle) ||
                  (item.id === 'pistol') ||
                  (item.id === 'armor' && player.armor >= 100) ||
                  (item.id === 'kit' && player.kit);
      var afford = player.money >= item.price;
      rows[i].classList.toggle('disabled', !afford || !!owned);
    });
  }

  function buy(id) {
    if (phase !== 'buy' || !player.alive) return;
    var item = SHOP.filter(function (s) { return s.id === id; })[0];
    if (!item || player.money < item.price) return;
    if (id === 'rifle') {
      if (player.weapons.rifle) return;
      player.weapons.rifle = { mag: WEAPONS.rifle.magSize, reserve: WEAPONS.rifle.reserveSize };
      switchWeapon(1);
    } else if (id === 'pistol') return; // already standard issue
    else if (id === 'armor') { if (player.armor >= 100) return; player.armor = 100; }
    else if (id === 'kit') { if (player.kit) return; player.kit = true; }
    else if (id === 'ammo') {
      if (player.weapons.rifle) player.weapons.rifle.reserve = WEAPONS.rifle.reserveSize;
      player.weapons.pistol.reserve = WEAPONS.pistol.reserveSize;
    }
    player.money -= item.price;
    SoundFX.buy();
    refreshBuyMenu();
  }

  // While the pointer is locked, the browser retargets every mouse event to the
  // canvas, so buy rows can never be clicked. Free the cursor while the menu is
  // open and re-lock when it closes.
  function openBuy() {
    buyOpen = true; refreshBuyMenu(); el.buyMenu.classList.remove('hidden');
    document.exitPointerLock && document.exitPointerLock();
  }
  function closeBuy() {
    buyOpen = false; el.buyMenu.classList.add('hidden');
    if (running && !paused) lockPointer();
  }
  function toggleBuy() { if (phase === 'buy') { buyOpen ? closeBuy() : openBuy(); } }

  /* ================================================================== *
   * Kill feed / banner / scoreboard
   * ================================================================== */
  function feedName(e) {
    var cls = e.isPlayer ? 'me' : (e.team === 'CT' ? 'ct' : 't');
    return '<span class="' + cls + '">' + e.name + '</span>';
  }
  function addFeed(killer, victim) {
    addFeedRaw(feedName(killer) + ' ▸ ' + feedName(victim));
  }
  function addFeedText(t) { addFeedRaw('<span>' + t + '</span>'); }
  function addFeedRaw(html) {
    var div = document.createElement('div');
    div.className = 'feed-row';
    div.innerHTML = html;
    el.killfeed.appendChild(div);
    while (el.killfeed.children.length > 5) el.killfeed.removeChild(el.killfeed.firstChild);
    setTimeout(function () { div.classList.add('fade'); }, 4200);
    setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 5000);
  }

  function showBanner(title, sub, dur) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.classList.add('show');
    bannerT = dur || 2;
  }

  function refreshScoreboard() {
    var all = [player].concat(bots).slice().sort(function (a, b) { return b.kills - a.kills; });
    el.sbBody.innerHTML = all.map(function (e) {
      return '<tr class="' + (e.isPlayer ? 'me' : '') + (e.alive ? '' : ' dead') + '">' +
        '<td>' + e.name + '</td>' +
        '<td class="' + (e.team === 'CT' ? 'ct' : 't') + '">' + e.team + '</td>' +
        '<td>' + e.kills + '</td><td>' + e.deaths + '</td>' +
        '<td>' + e.money + '</td></tr>';
    }).join('');
  }

  /* ================================================================== *
   * Input
   * ================================================================== */
  var keys = {};
  document.addEventListener('keydown', function (e) {
    if (e.code === 'Tab') { e.preventDefault(); if (running && !sbOpen) { sbOpen = true; refreshScoreboard(); el.scoreboard.classList.remove('hidden'); } return; }
    keys[e.code] = true;
    if (!running) return;
    if (e.code === 'KeyR') playerReload();
    if (e.code === 'KeyB') toggleBuy();
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      if (buyOpen && phase === 'buy') {
        var idx = parseInt(e.code.slice(-1), 10) - 1;
        if (SHOP[idx]) buy(SHOP[idx].id);
      } else {
        switchWeapon(parseInt(e.code.slice(-1), 10));
      }
    }
    if (e.code === 'Digit4' && buyOpen && phase === 'buy') buy(SHOP[3].id);
    if (e.code === 'Digit5' && buyOpen && phase === 'buy') buy(SHOP[4].id);
  });
  document.addEventListener('keyup', function (e) {
    keys[e.code] = false;
    if (e.code === 'Tab') { sbOpen = false; el.scoreboard.classList.add('hidden'); }
  });

  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    // Re-acquire pointer lock lost outside the pause flow (e.g. after the buy
    // phase auto-locked failed, or Esc while dead). This click only aims.
    if (running && !paused && !buyOpen && document.pointerLockElement !== canvas) {
      lockPointer();
      return;
    }
    mouseDown = true;
    if (running && !paused) playerFire();
  });
  document.addEventListener('mouseup', function () { mouseDown = false; });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('mousemove', function (e) {
    if (document.pointerLockElement !== canvas || paused || !running) return;
    player.dir += e.movementX * 0.0023 * sensitivity;
  });

  document.addEventListener('pointerlockchange', function () {
    var locked = document.pointerLockElement === canvas;
    // Losing the lock means the user pressed Esc — pause, unless the lock was
    // released deliberately (buy menu open, match over) or the game is already
    // paused. Dead players spectate and don't need a pause screen.
    if (!locked && running && !paused && !buyOpen && player.alive && (phase === 'live' || phase === 'buy')) {
      paused = true;
      el.pause.classList.remove('hidden');
    }
  });

  function lockPointer() {
    if (!canvas.requestPointerLock || document.pointerLockElement === canvas) return;
    var p = canvas.requestPointerLock();
    // Rejects during the Esc cooldown or without a user gesture; the next
    // canvas click retries, so this is safe to ignore.
    if (p && p.catch) p.catch(function () { });
  }

  $('btn-start').addEventListener('click', function () {
    SoundFX.unlock();
    el.start.classList.add('hidden');
    running = true; paused = false;
    lockPointer();
    restartMatch();
  });
  $('btn-resume').addEventListener('click', function () {
    paused = false;
    el.pause.classList.add('hidden');
    lockPointer();
  });
  $('btn-restart').addEventListener('click', function () {
    lockPointer();
    restartMatch();
  });

  /* ================================================================== *
   * Update
   * ================================================================== */
  function updatePlayer(dt) {
    if (!player.alive) { player.speed = 0; return; }
    var spd = keys.ShiftLeft || keys.ShiftRight ? 1.8 : 3.6;
    var mx = 0, my = 0;
    if (keys.KeyW) my += 1;
    if (keys.KeyS) my -= 1;
    if (keys.KeyA) mx -= 1;
    if (keys.KeyD) mx += 1;
    var frozen = phase === 'buy';
    if ((mx || my) && !frozen) {
      var len = Math.hypot(mx, my);
      mx /= len; my /= len;
      var cos = Math.cos(player.dir), sin = Math.sin(player.dir);
      var dx = (cos * my - sin * mx) * spd * dt;
      var dy = (sin * my + cos * mx) * spd * dt;
      tryMove(player, dx, dy, 0.28);
      player.speed = spd;
      SoundFX.footstep();
    } else {
      player.speed = 0;
    }

    // Timers.
    if (player.fireT > 0) player.fireT -= dt;
    if (player.switching > 0) player.switching -= dt;
    if (player.muzzle > 0) player.muzzle -= dt;
    player.bloom = Math.max(0, player.bloom - dt * 0.055);
    player.kick *= Math.pow(0.0015, dt); // recoil recovery
    if (player.reloading > 0) {
      player.reloading -= dt;
      if (player.reloading <= 0) {
        var w = player.weapons[player.current];
        var wdef = currentWeapon();
        var need = wdef.magSize - w.mag;
        var take = Math.min(need, w.reserve);
        w.mag += take; w.reserve -= take;
      }
    }
    // Full-auto fire while the button is held.
    if (mouseDown && currentWeapon().auto) playerFire();
  }

  function update(dt) {
    time += dt;
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.remove('show'); }
    if (shake > 0) shake = Math.max(0, shake - dt * 2.5);
    blips = blips.filter(function (b) { return time - b.t < 1.6; });

    if (phase === 'buy' || phase === 'live' || phase === 'roundEnd') {
      phaseTimer -= dt;
      if (phase === 'buy' && phaseTimer <= 0) goLive();
      else if (phase === 'roundEnd' && phaseTimer <= 0) {
        if (matchOverPending) endMatch(); else nextRound();
      }
    }

    updatePlayer(dt);

    for (var i = 0; i < bots.length; i++) {
      var b = bots[i];
      if (b.reloadT > 0) b.reloadT -= dt;
      if (b.flash > 0) b.flash -= dt;
      AI.think(b, G, dt);
    }

    // Light body separation so bots don't stack.
    var units = [player].concat(bots);
    for (i = 0; i < units.length; i++) {
      var a = units[i];
      if (!a.alive) continue;
      for (var j = i + 1; j < units.length; j++) {
        var c = units[j];
        if (!c.alive) continue;
        var dx = c.x - a.x, dy = c.y - a.y;
        var d = Math.hypot(dx, dy);
        if (d > 0.001 && d < 0.55) {
          var push = (0.55 - d) / 2;
          var nx = dx / d * push, ny = dy / d * push;
          tryMove(a, -nx, -ny, 0.28);
          tryMove(c, nx, ny, 0.28);
        }
      }
    }

    updateBomb(dt);
    checkWinConditions();
  }

  /* ================================================================== *
   * Render
   * ================================================================== */
  function render() {
    // Camera: player, or a surviving teammate when dead.
    var cam = player;
    if (!player.alive) {
      if (!spectate || !spectate.alive) {
        spectate = null;
        for (var i = 0; i < bots.length; i++) {
          if (bots[i].team === 'CT' && bots[i].alive) { spectate = bots[i]; break; }
        }
      }
      if (spectate) cam = spectate;
    }

    var renderCam = {
      x: cam.x, y: cam.y,
      dir: cam.dir + (cam.isPlayer ? player.kick : 0) + (shake > 0 ? rand(-0.012, 0.012) * shake : 0)
    };

    // Build the sprite list for this frame.
    var sprites = [];
    bots.forEach(function (b) {
      if (!b.alive || b === cam) return;
      sprites.push({
        x: b.x, y: b.y, img: b.sprite, scale: 0.9, aspect: 0.5,
        flash: b.flash,
        marker: b.team === 'CT' ? '#5aa2ff' : null
      });
    });
    if (bomb.planted || bomb.dropped) {
      sprites.push({
        x: bomb.planted ? bomb.x : bomb.dropped.x,
        y: bomb.planted ? bomb.y : bomb.dropped.y,
        img: spriteBomb, scale: 0.45, vOff: 0.55
      });
    }

    ray.render(world, renderCam, sprites);
    drawViewmodel(cam);
    drawMinimapNow(cam);
  }

  // First-person weapon: procedural gun/knife lower-right with walk bob,
  // recoil kick and reload animation (see viewmodel.js).
  function drawViewmodel(cam) {
    var kind = cam.isPlayer ? player.current : (cam.weapon ? cam.weapon.kind : 'rifle');
    var wdef = cam.isPlayer ? currentWeapon() : null;
    Viewmodel.draw(ray.ctx, canvas.width, canvas.height, {
      kind: kind,
      bobPhase: time * 9,
      moveAmt: cam.isPlayer ? Math.min(1, player.speed / 3) : 0,
      swayX: 0, swayY: shake > 0 ? rand(-2, 2) * shake : 0,
      kick: cam.isPlayer ? Math.min(1, Math.abs(player.kick) * 50 + (player.muzzle > 0 ? 0.5 : 0)) : 0,
      muzzle: cam.isPlayer ? player.muzzle : 0,
      reloadFrac: cam.isPlayer && player.reloading > 0 && wdef.reload
        ? 1 - player.reloading / wdef.reload : -1,
      switchFrac: cam.isPlayer ? Math.max(0, player.switching / 0.4) : 0,
      throwFrac: -1,
      t: time
    });
  }

  function drawMinimapNow(cam) {
    var dots = [];
    bots.forEach(function (b) {
      if (!b.alive) return;
      if (b.team === 'CT' && b !== cam) dots.push({ x: b.x, y: b.y, color: '#5aa2ff' });
    });
    blips.forEach(function (b) {
      if (b.team === 'T') dots.push({ x: b.x, y: b.y, color: '#ff5347' });
    });
    var bombPos = null;
    if (bomb.planted || bomb.dropped) {
      bombPos = {
        x: bomb.planted ? bomb.x : bomb.dropped.x,
        y: bomb.planted ? bomb.y : bomb.dropped.y,
        blink: bomb.planted && ((time * 2) | 0) % 2 === 0
      };
    }
    Radar.draw(radarCv, {
      player: { x: cam.x, y: cam.y, dir: cam.dir },
      dots: dots,
      bomb: bombPos
    });
  }

  /* ================================================================== *
   * HUD
   * ================================================================== */
  function updateHUD() {
    el.healthFill.style.width = player.hp + '%';
    el.healthNum.textContent = Math.ceil(player.hp);
    el.armorFill.style.width = player.armor + '%';
    el.armorNum.textContent = Math.ceil(player.armor);
    el.money.textContent = fmtMoney(player.money);

    var wdef = currentWeapon();
    el.weaponName.textContent = wdef.name;
    if (player.current === 'knife') {
      el.ammoMag.textContent = '—'; el.ammoRes.textContent = '—';
    } else {
      var w = player.weapons[player.current];
      el.ammoMag.textContent = player.reloading > 0 ? '…' : w.mag;
      el.ammoRes.textContent = w.reserve;
    }

    // Timer shows bomb countdown in red once planted.
    if (bomb.planted) {
      el.timer.textContent = fmtTime(bomb.timer);
      el.timer.classList.add('danger');
    } else {
      el.timer.textContent = phase === 'buy' ? 'BUY ' + Math.ceil(phaseTimer) : fmtTime(phaseTimer);
      el.timer.classList.remove('danger');
    }

    // Crosshair gap tracks spread; hidden while dead.
    var spread = wdef.spread ? (wdef.spread + player.bloom + Math.min(0.03, player.speed * 0.008)) : 0.01;
    document.documentElement.style.setProperty('--gap', Math.round(4 + spread * 900) + 'px');
    el.crosshair.style.opacity = player.alive && !buyOpen && !sbOpen ? 1 : 0;

    // Contextual hint.
    var hint = '';
    if (phase === 'buy') hint = 'B — buy menu · round starts in ' + Math.ceil(phaseTimer);
    else if (bomb.planted && player.alive) {
      var d = Math.hypot(player.x - bomb.x, player.y - bomb.y);
      hint = d < 1.3 ? 'HOLD E TO DEFUSE' : 'bomb planted — find it and defuse!';
    } else if (player.alive && phase === 'live') hint = '';
    el.hint.textContent = hint;

    // Defuse progress bar.
    if (defusing.active) {
      el.defuseWrap.classList.add('show');
      var need = player.kit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
      el.defuseFill.style.width = Math.min(100, defusing.t / need * 100) + '%';
      el.defuseLabel.textContent = player.kit ? 'DEFUSING (KIT)' : 'DEFUSING';
    } else {
      el.defuseWrap.classList.remove('show');
    }

    // Damage vignette fade.
    var cur = parseFloat(el.dmg.style.opacity || 0);
    if (cur > 0) el.dmg.style.opacity = Math.max(0, cur - 0.02);

    if (sbOpen) refreshScoreboard();
    if (buyOpen) el.buyMoney.textContent = fmtMoney(player.money);
  }

  /* ================================================================== *
   * Main loop
   * ================================================================== */
  var last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!running) return;
    var dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    if (!paused) {
      update(dt);
      render();
      updateHUD();
    }
  }

  /* ================================================================== *
   * Boot
   * ================================================================== */
  function boot() {
    ray.resize();
    window.addEventListener('resize', ray.resize.bind(ray));
    Radar.setMap(world, sites);
    buildBuyMenu();
    spawnBots();
    requestAnimationFrame(loop);
  }
  boot();
})();
