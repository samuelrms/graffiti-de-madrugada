const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const CITY = require('./shared/city');

// ---------- Config ----------
const DEFAULTS = {
  port: Number(process.env.PORT || 8080),
  tickMs: 50, // 20 Hz broadcast
  matchSeconds: 180,
  countdownSeconds: 3,
  respawnMs: 3000,
  minPlayers: 2,
  maxPlayers: 12,
  quiet: false
};

const PAINT_RANGE = 4.5;
const PAINT_COOLDOWN_MS = 120;
const MELEE_RANGE = 2.6;
const MELEE_COOLDOWN_MS = 1200;
const MELEE_DAMAGE = 25;
const STUN_MS = 900;

const MAX_HP = 100;
const KILL_BONUS = 8;
const DEATH_TILE_LOSS = 0.2; // victim loses 20% of tiles' score (tiles stay painted, neutral)

const WEAPONS = {
  pistol: { damage: 14, range: 34, cooldown: 260, splash: 0, ammo: Infinity },
  bazooka: { damage: 45, range: 40, cooldown: 1100, splash: 4.5, ammo: 4 }
};

// Powers by class (slot % 4). Client applies movement effects; server applies stat effects.
const POWERS = {
  dash: { cooldown: 5000, duration: 700 },
  shield: { cooldown: 12000, duration: 5000, armor: 40 },
  jump: { cooldown: 6000, duration: 600 },
  smoke: { cooldown: 14000, duration: 4000 }
};
const CLASS_POWER = ['dash', 'shield', 'jump', 'smoke'];

const PICKUP_TYPES = {
  bazooka: { respawn: 25000 },
  vest: { respawn: 20000, armor: 50 },
  shoes: { respawn: 18000, duration: 12000 },
  doublecan: { respawn: 18000, duration: 15000 },
  medkit: { respawn: 15000, heal: 60 }
};

const COLORS = [
  '#ff2d75', '#00e5ff', '#b4ff39', '#ffb300', '#b967ff', '#ff6a00',
  '#2dff9b', '#ff4dff', '#4d7cff', '#ffe600', '#ff3b3b', '#7dffea'
];

function createGame(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const buildings = CITY.generateCity();
  const spawns = CITY.spawnPoints();
  const pickups = CITY.pickupPoints().map((p, i) => ({ id: i, ...p, takenUntil: 0 }));

  // ---------- State ----------
  const players = new Map();
  let paint = new Map(); // tileKey -> slot (-1 = neutral)
  let phase = 'lobby';
  let phaseEndsAt = 0;
  let winner = null;

  function freeSlot() {
    const used = new Set([...players.values()].map((p) => p.slot));
    for (let i = 0; i < cfg.maxPlayers; i++) if (!used.has(i)) return i;
    return -1;
  }

  function respawn(p) {
    const s = spawns[p.slot % spawns.length];
    p.x = s.x; p.y = 0; p.z = s.z; p.rot = 0; p.anim = 'idle';
    p.hp = MAX_HP;
    p.armor = 0;
    p.dead = false;
    p.respawnAt = 0;
    p.stunUntil = 0;
    p.weapon = 'pistol';
    p.ammo = Infinity;
    p.shoesUntil = 0;
    p.doubleUntil = 0;
    p.shieldUntil = 0;
    p.smokeUntil = 0;
    io.emit('respawned', { id: p.id, x: p.x, y: p.y, z: p.z });
  }

  function resetPlayer(p) {
    respawn(p);
    p.score = 0; p.tiles = 0; p.kills = 0; p.deaths = 0; p.ready = false;
    p.meleeReadyAt = 0; p.paintReadyAt = 0; p.shootReadyAt = 0; p.powerReadyAt = 0;
  }

  function startCountdown() {
    paint = new Map();
    winner = null;
    for (const pk of pickups) pk.takenUntil = 0;
    for (const p of players.values()) resetPlayer(p);
    phase = 'countdown';
    phaseEndsAt = Date.now() + cfg.countdownSeconds * 1000;
    io.emit('reset');
  }
  function startMatch() { phase = 'playing'; phaseEndsAt = Date.now() + cfg.matchSeconds * 1000; }
  function endMatch() {
    phase = 'ended'; phaseEndsAt = 0;
    const ranked = [...players.values()].sort((a, b) => b.score - a.score);
    if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
      winner = { name: ranked[0].name, color: ranked[0].color, score: ranked[0].score };
    } else {
      winner = { name: 'Empate', color: '#e2e8f0', score: ranked[0]?.score ?? 0 };
    }
  }
  function backToLobby() {
    phase = 'lobby'; phaseEndsAt = 0; winner = null; paint = new Map();
    for (const p of players.values()) resetPlayer(p);
    io.emit('reset');
  }
  function bySlot(slot) { for (const p of players.values()) if (p.slot === slot) return p; return null; }

  // ---------- Combat ----------
  function damage(target, amount, by, now) {
    if (target.dead || phase !== 'playing') return;
    if (now < target.shieldUntil) amount *= 0.5;
    const absorbed = Math.min(target.armor, amount * 0.7);
    target.armor -= absorbed;
    target.hp = Math.max(0, target.hp - (amount - absorbed));
    io.emit('damaged', { id: target.id, by: by?.id, hp: Math.round(target.hp), armor: Math.round(target.armor) });
    if (target.hp <= 0) {
      target.hp = 0; target.dead = true; target.deaths++;
      target.respawnAt = now + cfg.respawnMs;
      const loss = Math.floor(target.score * DEATH_TILE_LOSS);
      target.score -= loss;
      if (by && by !== target) { by.kills++; by.score += KILL_BONUS + loss; }
      io.emit('killed', { id: target.id, by: by?.id, byName: by?.name, byColor: by?.color, name: target.name, color: target.color, loss, weapon: by?.lastWeapon || 'pistol' });
    }
  }

  // Ray vs axis-aligned box (slab). Returns t or Infinity.
  function rayBox(ox, oy, oz, dx, dy, dz, b) {
    const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
    const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
    let tmin = 0, tmax = Infinity;
    const axes = [[ox, dx, minX, maxX], [oy, dy, 0, b.h], [oz, dz, minZ, maxZ]];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
    return tmin;
  }
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = cx - ox, ly = cy - oy, lz = cz - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    if (tca < 0) return Infinity;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > r * r) return Infinity;
    return tca - Math.sqrt(r * r - d2);
  }

  function tick() {
    const now = Date.now();
    if (phase === 'lobby' && players.size >= cfg.minPlayers && [...players.values()].every((p) => p.ready)) startCountdown();
    if (phase === 'countdown' && now >= phaseEndsAt) startMatch();
    if (phase === 'playing' && now >= phaseEndsAt) endMatch();
    if ((phase === 'countdown' || phase === 'playing') && players.size < cfg.minPlayers) backToLobby();

    if (phase === 'playing') {
      for (const p of players.values()) {
        if (p.dead && now >= p.respawnAt) respawn(p);
        if (p.dead) continue;
        // Pickups
        for (const pk of pickups) {
          if (now < pk.takenUntil) continue;
          if (Math.hypot(pk.x - p.x, pk.z - p.z) > 1.4 || Math.abs(pk.y - p.y) > 2) continue;
          const def = PICKUP_TYPES[pk.type];
          pk.takenUntil = now + def.respawn;
          if (pk.type === 'bazooka') { p.weapon = 'bazooka'; p.ammo = WEAPONS.bazooka.ammo; }
          if (pk.type === 'vest') p.armor = Math.min(100, p.armor + def.armor);
          if (pk.type === 'shoes') p.shoesUntil = now + def.duration;
          if (pk.type === 'doublecan') p.doubleUntil = now + def.duration;
          if (pk.type === 'medkit') p.hp = Math.min(MAX_HP, p.hp + def.heal);
          io.emit('pickup', { id: pk.id, by: p.id, type: pk.type });
        }
      }
    }
    io.emit('state', snapshot(now));
  }

  function snapshot(now) {
    return {
      phase,
      timeLeft: phaseEndsAt ? Math.max(0, Math.ceil((phaseEndsAt - now) / 1000)) : 0,
      winner,
      pickups: pickups.map((pk) => (now < pk.takenUntil ? 0 : 1)),
      players: [...players.values()].map((p) => ({
        id: p.id, slot: p.slot, name: p.name, color: p.color, cls: p.slot % 4, ready: p.ready, deaths: p.deaths,
        x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), rot: +p.rot.toFixed(2),
        anim: p.anim, score: p.score, tiles: p.tiles, kills: p.kills,
        hp: Math.round(p.hp), armor: Math.round(p.armor), dead: p.dead,
        respawnIn: p.dead ? Math.max(0, p.respawnAt - now) : 0,
        weapon: p.weapon, ammo: p.ammo === Infinity ? -1 : p.ammo,
        stunned: now < p.stunUntil,
        shoes: now < p.shoesUntil, double: now < p.doubleUntil,
        shield: now < p.shieldUntil, smoke: now < p.smokeUntil,
        meleeReadyIn: Math.max(0, p.meleeReadyAt - now),
        powerReadyIn: Math.max(0, p.powerReadyAt - now)
      }))
    };
  }

  // ---------- HTTP + Socket ----------
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/shared', express.static(path.join(__dirname, 'shared')));
  app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const httpServer = app.listen(cfg.port, '0.0.0.0', () => {
    if (!cfg.quiet) console.log(`Graffiti de Madrugada 3D em http://localhost:${httpServer.address().port}`);
  });
  const io = new Server(httpServer);

  io.on('connection', (socket) => {
    const slot = freeSlot();
    if (slot < 0) { socket.emit('full'); socket.disconnect(true); return; }
    const p = { id: socket.id, slot, name: `Crew${slot + 1}`, color: COLORS[slot] };
    resetPlayer(p);
    players.set(socket.id, p);
    socket.emit('welcome', {
      id: socket.id, slot, matchSeconds: cfg.matchSeconds, minPlayers: cfg.minPlayers,
      power: CLASS_POWER[slot % 4], powers: POWERS, weapons: { pistol: WEAPONS.pistol, bazooka: WEAPONS.bazooka },
      pickups: pickups.map((pk) => ({ id: pk.id, type: pk.type, x: pk.x, y: pk.y, z: pk.z })),
      paint: [...paint.entries()],
      colors: COLORS
    });

    socket.on('pos', (d) => {
      const me = players.get(socket.id);
      if (!me || !d || me.dead) return;
      const x = Number(d.x), y = Number(d.y), z = Number(d.z), rot = Number(d.rot);
      if (![x, y, z, rot].every(Number.isFinite)) return;
      me.x = Math.max(0, Math.min(CITY.MAP_SIZE, x));
      me.y = Math.max(0, Math.min(80, y));
      me.z = Math.max(0, Math.min(CITY.MAP_SIZE, z));
      me.rot = rot;
      me.anim = typeof d.anim === 'string' ? d.anim.slice(0, 8) : 'idle';
    });

    socket.on('paint', (key) => {
      const me = players.get(socket.id);
      const now = Date.now();
      if (!me || me.dead || phase !== 'playing' || now < me.stunUntil || now < me.paintReadyAt) return;
      const t = typeof key === 'string' ? CITY.parseKey(key) : null;
      if (!t) return;
      const b = buildings[t.bi];
      if (!b || t.face < 0 || t.face > 3) return;
      const info = CITY.faceInfo(b, t.face);
      if (t.i < 0 || t.j < 0 || t.i >= info.cols || t.j >= info.rows) return;
      const c = CITY.tileCenter(b, t.face, t.i, t.j);
      if (Math.hypot(c.x - me.x, c.y - (me.y + 1), c.z - me.z) > PAINT_RANGE) return;
      const prevSlot = paint.get(key);
      if (prevSlot === me.slot) return;
      const value = CITY.tileValue(t.j) * (now < me.doubleUntil ? 2 : 1);
      if (prevSlot !== undefined && prevSlot >= 0) {
        const prev = bySlot(prevSlot);
        if (prev) { prev.score -= CITY.tileValue(t.j); prev.tiles--; }
      }
      paint.set(key, me.slot);
      me.score += value; me.tiles++;
      me.paintReadyAt = now + PAINT_COOLDOWN_MS;
      io.emit('painted', { key, slot: me.slot, color: me.color, value, by: me.id });
    });

    // Hitscan shot. Client sends origin (eye) + direction; server resolves.
    socket.on('shoot', (d) => {
      const me = players.get(socket.id);
      const now = Date.now();
      if (!me || me.dead || phase !== 'playing' || now < me.stunUntil || now < me.shootReadyAt || !d) return;
      const w = WEAPONS[me.weapon] || WEAPONS.pistol;
      if (me.ammo <= 0) { me.weapon = 'pistol'; me.ammo = Infinity; return; }
      let ox = Number(d.ox), oy = Number(d.oy), oz = Number(d.oz);
      let dx = Number(d.dx), dy = Number(d.dy), dz = Number(d.dz);
      if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return;
      if (Math.hypot(ox - me.x, oy - me.y - 1.4, oz - me.z) > 3) { ox = me.x; oy = me.y + 1.4; oz = me.z; }
      const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
      me.shootReadyAt = now + w.cooldown;
    me.lastWeapon = me.weapon;
      if (me.ammo !== Infinity) me.ammo--;

      let tHit = w.range;
      for (const b of buildings) tHit = Math.min(tHit, rayBox(ox, oy, oz, dx, dy, dz, b));
      if (dy < 0) tHit = Math.min(tHit, -oy / dy); // ground
      let victim = null;
      for (const o of players.values()) {
        if (o === me || o.dead) continue;
        const t = raySphere(ox, oy, oz, dx, dy, dz, o.x, o.y + 0.9, o.z, 0.8);
        if (t < tHit) { tHit = t; victim = o; }
      }
      const hx = ox + dx * tHit, hy = oy + dy * tHit, hz = oz + dz * tHit;
      if (w.splash > 0) {
        for (const o of players.values()) {
          if (o.dead) continue;
          const dist = Math.hypot(o.x - hx, o.y + 0.9 - hy, o.z - hz);
          if (dist <= w.splash && o !== me) damage(o, w.damage * (1 - dist / w.splash * 0.6), me, now);
        }
      } else if (victim) {
        damage(victim, w.damage, me, now);
      }
      io.emit('shot', { by: me.id, weapon: me.weapon, ox, oy, oz, hx, hy, hz, hit: !!victim || w.splash > 0 });
      if (me.ammo === 0) { me.weapon = 'pistol'; me.ammo = Infinity; }
    });

    socket.on('melee', () => {
      const me = players.get(socket.id);
      const now = Date.now();
      if (!me || me.dead || phase !== 'playing' || now < me.stunUntil || now < me.meleeReadyAt) return;
      me.meleeReadyAt = now + MELEE_COOLDOWN_MS;
    me.lastWeapon = 'melee';
      const fx = -Math.sin(me.rot), fz = -Math.cos(me.rot);
      for (const o of players.values()) {
        if (o === me || o.dead) continue;
        const dx = o.x - me.x, dy = o.y - me.y, dz = o.z - me.z;
        const dist = Math.hypot(dx, dz);
        if (dist > MELEE_RANGE || Math.abs(dy) > 2) continue;
        if ((dx * fx + dz * fz) / (dist || 1) < 0.3) continue;
        o.stunUntil = now + STUN_MS;
        damage(o, MELEE_DAMAGE, me, now);
        io.emit('hit', { by: me.id, victim: o.id, fx, fz });
      }
    });

    socket.on('power', () => {
      const me = players.get(socket.id);
      const now = Date.now();
      if (!me || me.dead || phase !== 'playing' || now < me.powerReadyAt) return;
      const name = CLASS_POWER[me.slot % 4];
      const pw = POWERS[name];
      me.powerReadyAt = now + pw.cooldown;
      if (name === 'shield') me.shieldUntil = now + pw.duration;
      if (name === 'smoke') me.smokeUntil = now + pw.duration;
      io.emit('power', { id: me.id, name, duration: pw.duration });
    });

    socket.on('rename', (name) => {
      const me = players.get(socket.id);
      if (!me || typeof name !== 'string') return;
      me.name = name.trim().slice(0, 12) || me.name;
    });

    socket.on('ready', (flag) => {
      const me = players.get(socket.id);
      if (!me || phase !== 'lobby') return;
      me.ready = !!flag;
    });

    // After a match everyone goes back to the lobby and must ready up again.
    socket.on('restart', () => { if (phase === 'ended') backToLobby(); });
    socket.on('disconnect', () => { players.delete(socket.id); });
  });


  const timer = setInterval(tick, cfg.tickMs);
  return {
    httpServer,
    io,
    get port() { return httpServer.address().port; },
    get phase() { return phase; },
    close() {
      clearInterval(timer);
      io.close();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    }
  };
}

module.exports = { createGame, DEFAULTS, WEAPONS, POWERS, PICKUP_TYPES, COLORS };

if (require.main === module) createGame();
