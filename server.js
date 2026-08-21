const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

// ---------- Config ----------
const PORT = Number(process.env.PORT || 8080);
const TICK_MS = 50; // 20 Hz
const GRID_W = 40;
const GRID_H = 24;
const TILE = 20; // px, client renders with same size
const MATCH_SECONDS = 90;
const COUNTDOWN_SECONDS = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const SPEED = 180; // px/s
const DASH_SPEED = 520;
const DASH_MS = 220;
const DASH_COOLDOWN_MS = 1500;
const STUN_MS = 900; // pushed player drops spray can
const PLAYER_RADIUS = 9;

const COLORS = ['#ff2d75', '#00e5ff', '#b4ff39', '#ffb300', '#b967ff'];

// ---------- State ----------
const players = new Map(); // socket.id -> player
let grid = new Int8Array(GRID_W * GRID_H).fill(-1); // owner slot or -1
let phase = 'lobby'; // lobby | countdown | playing | ended
let phaseEndsAt = 0;
let winner = null;
let lastTick = Date.now();

function freeSlot() {
  const used = new Set([...players.values()].map((p) => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function spawnPoint(slot) {
  const spots = [
    [3, 3],
    [GRID_W - 4, GRID_H - 4],
    [GRID_W - 4, 3],
    [3, GRID_H - 4],
    [Math.floor(GRID_W / 2), Math.floor(GRID_H / 2)]
  ];
  const [gx, gy] = spots[slot] || spots[4];
  return { x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 };
}

function resetPlayer(p) {
  const s = spawnPoint(p.slot);
  p.x = s.x;
  p.y = s.y;
  p.dx = 0;
  p.dy = 0;
  p.facing = { x: 1, y: 0 };
  p.dashUntil = 0;
  p.dashReadyAt = 0;
  p.stunUntil = 0;
  p.tapDir = null;
  p.tapUntil = 0;
  p.score = 0;
}

function startCountdown() {
  grid = new Int8Array(GRID_W * GRID_H).fill(-1);
  winner = null;
  for (const p of players.values()) resetPlayer(p);
  phase = 'countdown';
  phaseEndsAt = Date.now() + COUNTDOWN_SECONDS * 1000;
}

function startMatch() {
  phase = 'playing';
  phaseEndsAt = Date.now() + MATCH_SECONDS * 1000;
}

function endMatch() {
  phase = 'ended';
  phaseEndsAt = 0;
  const ranked = [...players.values()].sort((a, b) => b.score - a.score);
  if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
    winner = { name: ranked[0].name, color: ranked[0].color, score: ranked[0].score };
  } else {
    winner = { name: 'Empate', color: '#e2e8f0', score: ranked[0]?.score ?? 0 };
  }
}

function backToLobby() {
  phase = 'lobby';
  phaseEndsAt = 0;
  winner = null;
  grid = new Int8Array(GRID_W * GRID_H).fill(-1);
  for (const p of players.values()) resetPlayer(p);
}

function paint(p) {
  const gx = Math.floor(p.x / TILE);
  const gy = Math.floor(p.y / TILE);
  if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return;
  const i = gy * GRID_W + gx;
  if (grid[i] === p.slot) return;
  if (grid[i] >= 0) {
    const prev = [...players.values()].find((o) => o.slot === grid[i]);
    if (prev) prev.score--;
  }
  grid[i] = p.slot;
  p.score++;
}

function tick() {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  if (phase === 'lobby' && players.size >= MIN_PLAYERS) startCountdown();
  if (phase === 'countdown' && now >= phaseEndsAt) startMatch();
  if (phase === 'playing' && now >= phaseEndsAt) endMatch();
  if (phase !== 'lobby' && players.size < MIN_PLAYERS && phase !== 'ended') backToLobby();

  if (phase === 'playing' || phase === 'countdown') {
    const list = [...players.values()];
    for (const p of list) {
      if (phase !== 'playing') continue;
      if (now < p.stunUntil) continue;
      const dashing = now < p.dashUntil;
      let vx = p.dx;
      let vy = p.dy;
      if (!vx && !vy && p.tapDir && now < p.tapUntil) {
        vx = p.tapDir.x;
        vy = p.tapDir.y;
      }
      if (dashing) {
        vx = p.facing.x;
        vy = p.facing.y;
      }
      const len = Math.hypot(vx, vy) || 1;
      const spd = dashing ? DASH_SPEED : SPEED;
      p.x += (vx / len) * spd * dt;
      p.y += (vy / len) * spd * dt;
      p.x = Math.max(PLAYER_RADIUS, Math.min(GRID_W * TILE - PLAYER_RADIUS, p.x));
      p.y = Math.max(PLAYER_RADIUS, Math.min(GRID_H * TILE - PLAYER_RADIUS, p.y));
      paint(p);
    }

    // Dash collisions: dasher stuns victim and pushes them.
    for (const a of list) {
      if (now >= a.dashUntil) continue;
      for (const b of list) {
        if (a === b || now < b.stunUntil) continue;
        const ddx = b.x - a.x;
        const ddy = b.y - a.y;
        const d = Math.hypot(ddx, ddy);
        if (d < PLAYER_RADIUS * 2.2) {
          b.stunUntil = now + STUN_MS;
          const n = d || 1;
          b.x = Math.max(PLAYER_RADIUS, Math.min(GRID_W * TILE - PLAYER_RADIUS, b.x + (ddx / n) * 40));
          b.y = Math.max(PLAYER_RADIUS, Math.min(GRID_H * TILE - PLAYER_RADIUS, b.y + (ddy / n) * 40));
          a.dashUntil = 0;
          io.emit('hit', { by: a.id, victim: b.id, x: b.x, y: b.y });
        }
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
    grid: Buffer.from(grid.buffer).toString('base64'),
    players: [...players.values()].map((p) => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      color: p.color,
      x: Math.round(p.x),
      y: Math.round(p.y),
      score: p.score,
      stunned: now < p.stunUntil,
      dashing: now < p.dashUntil,
      dashReadyIn: Math.max(0, p.dashReadyAt - now)
    }))
  };
}

// ---------- HTTP + Socket ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Graffiti de Madrugada em http://localhost:${PORT}`);
});
const io = new Server(httpServer);

io.on('connection', (socket) => {
  const slot = freeSlot();
  if (slot < 0) {
    socket.emit('full');
    socket.disconnect(true);
    return;
  }
  const p = {
    id: socket.id,
    slot,
    name: `Crew${slot + 1}`,
    color: COLORS[slot]
  };
  resetPlayer(p);
  players.set(socket.id, p);
  socket.emit('welcome', {
    id: socket.id,
    gridW: GRID_W,
    gridH: GRID_H,
    tile: TILE,
    matchSeconds: MATCH_SECONDS,
    minPlayers: MIN_PLAYERS
  });

  socket.on('input', (input) => {
    const me = players.get(socket.id);
    if (!me || !input) return;
    const dx = Math.sign(Number(input.dx) || 0);
    const dy = Math.sign(Number(input.dy) || 0);
    me.dx = dx;
    me.dy = dy;
    if (dx || dy) {
      me.facing = { x: dx, y: dy };
      // Guarantee at least one tick of movement for very short taps.
      me.tapDir = { x: dx, y: dy };
      me.tapUntil = Date.now() + TICK_MS * 2;
    }
  });

  socket.on('dash', () => {
    const me = players.get(socket.id);
    const now = Date.now();
    if (!me || phase !== 'playing' || now < me.stunUntil || now < me.dashReadyAt) return;
    me.dashUntil = now + DASH_MS;
    me.dashReadyAt = now + DASH_COOLDOWN_MS;
  });

  socket.on('rename', (name) => {
    const me = players.get(socket.id);
    if (!me || typeof name !== 'string') return;
    me.name = name.trim().slice(0, 12) || me.name;
  });

  socket.on('restart', () => {
    if (phase === 'ended' && players.size >= MIN_PLAYERS) startCountdown();
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
  });
});

setInterval(tick, TICK_MS);
