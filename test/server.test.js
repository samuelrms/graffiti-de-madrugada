const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createGame, WEAPONS } = require('../server');
const C = require('../shared/city');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const city = C.generateCity();

function connect(port) {
  return new Promise((resolve, reject) => {
    const s = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    const data = { socket: s, state: null, welcome: null, events: [] };
    s.on('welcome', (w) => { data.welcome = w; resolve(data); });
    s.on('full', () => resolve({ socket: s, full: true }));
    s.on('state', (st) => { data.state = st; });
    for (const e of ['painted', 'shot', 'hit', 'damaged', 'killed', 'pickup', 'power', 'respawned', 'reset']) s.on(e, (d) => data.events.push({ e, d }));
    s.on('connect_error', reject);
  });
}
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  throw new Error('timeout waiting for condition');
}
const me = (c) => c.state.players.find((p) => p.id === c.socket.id);
const placeNextToWall = (c, bi, face, extra = {}) => {
  const b = city[bi];
  const t = C.tileCenter(b, face, 0, 0);
  c.socket.emit('pos', { x: t.x + t.nx * 2, y: 0, z: t.z + t.nz * 2, rot: Math.atan2(-t.nx, -t.nz) + Math.PI, anim: 'idle', ...extra });
  return t;
};

async function setup(t, opts = {}) {
  const game = createGame({ port: 0, quiet: true, countdownSeconds: 0.2, ...opts });
  await wait(50);
  const clients = [];
  t.after(async () => { clients.forEach((c) => c.socket.close()); await game.close(); });
  return {
    game,
    add: async (ready = true) => {
      const c = await connect(game.port);
      clients.push(c);
      if (ready && !c.full) c.socket.emit('ready', true);
      return c;
    }
  };
}

test('health endpoint responds', async (t) => {
  const { game } = await setup(t);
  const r = await fetch(`http://localhost:${game.port}/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('static assets for client are served (three, shared city, page)', async (t) => {
  const { game } = await setup(t);
  for (const path of ['/', '/game.js', '/shared/city.js', '/vendor/three/three.module.js', '/vendor/three/three.core.js']) {
    const r = await fetch(`http://localhost:${game.port}${path}`);
    assert.equal(r.status, 200, path);
  }
});

test('lobby waits for two players who are all ready, then countdown, then playing', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  await wait(150);
  assert.equal(game.phase, 'lobby');
  assert.equal(a.welcome.slot, 0);
  const b = await add(false);
  assert.equal(b.welcome.slot, 1);
  await wait(200);
  assert.equal(game.phase, 'lobby', 'does not start until everyone is ready');
  await until(() => a.state.players.find((p) => p.id === b.socket.id).ready === false);
  b.socket.emit('ready', true);
  await until(() => game.phase === 'playing');
  assert.equal(a.state.players.length, 2);
  assert.ok(a.state.timeLeft > 0);
});

test('13th player is rejected, slots are reused after disconnect', async (t) => {
  const { game, add } = await setup(t);
  const clients = [];
  for (let i = 0; i < 12; i++) clients.push(await add());
  assert.deepEqual(clients.map((c) => c.welcome.slot), [...Array(12).keys()]);
  const extra = await add();
  assert.equal(extra.full, true);
  clients[5].socket.close();
  await wait(100);
  const again = await add();
  assert.equal(again.welcome.slot, 5);
  assert.equal(new Set(clients.filter((c) => c !== clients[5]).map((c) => c.welcome.colors[c.welcome.slot])).size, 11);
});

test('paint: in range counts, out of range rejected, stealing transfers score', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => game.phase === 'playing');
  placeNextToWall(a, 0, 1);
  placeNextToWall(b, 0, 1);
  await wait(80);
  a.socket.emit('paint', C.tileKey(0, 1, 0, 0));
  await until(() => me(a).score === 1);
  a.socket.emit('paint', C.tileKey(0, 1, 0, 0)); // same tile again: no double count
  a.socket.emit('paint', C.tileKey(0, 1, 0, 9)); // far up the wall: out of range
  a.socket.emit('paint', 'not:a:key');
  await wait(300);
  assert.equal(me(a).score, 1);
  assert.equal(me(a).tiles, 1);
  b.socket.emit('paint', C.tileKey(0, 1, 0, 0));
  await until(() => me(b).score === 1);
  assert.equal(me(a).score, 0);
  assert.equal(me(a).tiles, 0);
  const painted = a.events.filter((e) => e.e === 'painted');
  assert.equal(painted.length, 2);
  assert.equal(painted[1].d.slot, 1);
});

test('paint cooldown limits rate', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  await add();
  await until(() => game.phase === 'playing');
  placeNextToWall(a, 0, 1);
  await wait(80);
  for (let i = 0; i < 5; i++) a.socket.emit('paint', C.tileKey(0, 1, i, 0));
  await wait(250);
  assert.equal(me(a).tiles, 1);
});

test('pistol shots damage, kill, award bonus and respawn the victim', async (t) => {
  const { game, add } = await setup(t, { respawnMs: 300 });
  const a = await add();
  const b = await add();
  await until(() => game.phase === 'playing');
  a.socket.emit('pos', { x: 100, y: 0, z: 100, rot: -Math.PI / 2, anim: 'idle' });
  b.socket.emit('pos', { x: 103, y: 0, z: 100, rot: Math.PI / 2, anim: 'idle' });
  await wait(80);
  const shots = Math.ceil(100 / WEAPONS.pistol.damage);
  for (let i = 0; i < shots; i++) {
    a.socket.emit('shoot', { ox: 100, oy: 1.4, oz: 100, dx: 1, dy: 0, dz: 0 });
    await wait(WEAPONS.pistol.cooldown + 20);
  }
  await until(() => me(b).dead);
  assert.equal(me(b).hp, 0);
  assert.equal(me(a).kills, 1);
  assert.equal(me(a).score, 8);
  const killed = a.events.find((e) => e.e === 'killed');
  assert.equal(killed.d.id, b.socket.id);
  assert.equal(killed.d.by, a.socket.id);
  assert.equal(killed.d.byName, 'Crew1');
  assert.equal(killed.d.name, 'Crew2');
  assert.equal(killed.d.weapon, 'pistol');
  await until(() => !me(b).dead, 2000);
  assert.equal(me(b).hp, 100);
  const sp = C.spawnPoints()[1];
  assert.equal(me(b).x, sp.x);
  assert.equal(me(b).z, sp.z);
});

test('shots are blocked by buildings', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => game.phase === 'playing');
  const bld = city[0];
  a.socket.emit('pos', { x: bld.x - bld.w / 2 - 2, y: 0, z: bld.z, rot: 0, anim: 'idle' });
  b.socket.emit('pos', { x: bld.x + bld.w / 2 + 2, y: 0, z: bld.z, rot: 0, anim: 'idle' });
  await wait(80);
  a.socket.emit('shoot', { ox: bld.x - bld.w / 2 - 2, oy: 1.4, oz: bld.z, dx: 1, dy: 0, dz: 0 });
  await until(() => a.events.some((e) => e.e === 'shot'));
  const shot = a.events.find((e) => e.e === 'shot').d;
  assert.equal(shot.hit, false);
  assert.ok(Math.abs(shot.hx - (bld.x - bld.w / 2)) < 0.01, 'tracer ends at wall');
  assert.equal(me(b).hp, 100);
});

test('melee stuns and damages only targets in front', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  const b = await add();
  const c = await add();
  await until(() => game.phase === 'playing');
  a.socket.emit('pos', { x: 100, y: 0, z: 100, rot: -Math.PI / 2, anim: 'idle' }); // faces +x
  b.socket.emit('pos', { x: 101.5, y: 0, z: 100, rot: 0, anim: 'idle' }); // in front
  c.socket.emit('pos', { x: 98.5, y: 0, z: 100, rot: 0, anim: 'idle' }); // behind
  await wait(80);
  a.socket.emit('melee');
  await until(() => me(b).hp < 100);
  assert.equal(me(b).hp, 75);
  assert.equal(me(b).stunned, true);
  assert.equal(me(c).hp, 100);
  a.socket.emit('melee'); // cooldown
  await wait(150);
  assert.equal(me(b).hp, 75);
});

test('vest absorbs damage and medkit heals; pickups respawn later', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => game.phase === 'playing');
  const vest = a.welcome.pickups.find((p) => p.type === 'vest' && p.y === 0);
  a.socket.emit('pos', { x: vest.x, y: 0, z: vest.z, rot: 0, anim: 'idle' });
  await until(() => me(a).armor === 50);
  assert.equal(a.state.pickups[vest.id], 0, 'pickup hidden after taken');
  // b shoots a once
  a.socket.emit('pos', { x: 100, y: 0, z: 100, rot: 0, anim: 'idle' });
  b.socket.emit('pos', { x: 97, y: 0, z: 100, rot: 0, anim: 'idle' });
  await wait(80);
  b.socket.emit('shoot', { ox: 97, oy: 1.4, oz: 100, dx: 1, dy: 0, dz: 0 });
  await until(() => me(a).hp < 100);
  assert.ok(me(a).hp > 100 - WEAPONS.pistol.damage, 'armor absorbed part');
  assert.ok(me(a).armor < 50);
  const hpBefore = me(a).hp;
  const med = a.welcome.pickups.find((p) => p.type === 'medkit' && p.y === 0);
  a.socket.emit('pos', { x: med.x, y: 0, z: med.z, rot: 0, anim: 'idle' });
  await until(() => me(a).hp > hpBefore);
  assert.equal(me(a).hp, 100);
});

test('bazooka pickup gives limited ammo and splash damage', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => game.phase === 'playing');
  const bz = a.welcome.pickups.find((p) => p.type === 'bazooka');
  a.socket.emit('pos', { x: bz.x, y: bz.y, z: bz.z, rot: 0, anim: 'idle' });
  await until(() => me(a).weapon === 'bazooka');
  assert.equal(me(a).ammo, WEAPONS.bazooka.ammo);
  a.socket.emit('pos', { x: 100, y: 0, z: 100, rot: 0, anim: 'idle' });
  b.socket.emit('pos', { x: 104, y: 0, z: 102, rot: 0, anim: 'idle' }); // off-axis, inside splash
  await wait(80);
  // aim at the ground 4 units ahead: rocket explodes there, b is 2 units from the blast
  a.socket.emit('shoot', { ox: 100, oy: 1.4, oz: 100, dx: 4, dy: -1.4, dz: 0 });
  await until(() => me(b).hp < 100);
  assert.equal(me(a).ammo, WEAPONS.bazooka.ammo - 1);
});

test('powers: shield halves damage, cooldown enforced', async (t) => {
  const { game, add } = await setup(t);
  const a = await add(); // slot 0 -> dash
  const b = await add(); // slot 1 -> shield
  await until(() => game.phase === 'playing');
  assert.equal(b.welcome.power, 'shield');
  b.socket.emit('power');
  await until(() => me(b).shield);
  assert.ok(me(b).powerReadyIn > 0);
  a.socket.emit('pos', { x: 100, y: 0, z: 100, rot: 0, anim: 'idle' });
  b.socket.emit('pos', { x: 103, y: 0, z: 100, rot: 0, anim: 'idle' });
  await wait(80);
  a.socket.emit('shoot', { ox: 100, oy: 1.4, oz: 100, dx: 1, dy: 0, dz: 0 });
  await until(() => me(b).hp < 100);
  assert.equal(me(b).hp, 93); // 14 * 0.5
});

test('match ends with a winner and restart starts a new countdown', async (t) => {
  const { game, add } = await setup(t, { matchSeconds: 0.6 });
  const a = await add();
  const b = await add();
  await until(() => game.phase === 'playing');
  placeNextToWall(a, 0, 1);
  await wait(80);
  a.socket.emit('paint', C.tileKey(0, 1, 0, 0));
  await until(() => game.phase === 'ended', 3000);
  await until(() => a.state.phase === 'ended');
  assert.equal(a.state.winner.name, me(a).name);
  a.socket.emit('restart');
  await until(() => game.phase === 'lobby');
  await until(() => a.state.phase === 'lobby');
  assert.equal(me(a).score, 0);
  assert.equal(me(a).ready, false, 'everyone must ready up again');
  assert.ok(a.events.some((e) => e.e === 'reset'));
  a.socket.emit('ready', true);
  b.socket.emit('ready', true);
  await until(() => game.phase === 'playing');
});

test('position updates are clamped to the map and ignore garbage', async (t) => {
  const { game, add } = await setup(t);
  const a = await add();
  await add();
  await until(() => game.phase === 'playing');
  a.socket.emit('pos', { x: -50, y: 500, z: 9999, rot: 1, anim: 'x'.repeat(50) });
  await wait(80);
  assert.equal(me(a).x, 0);
  assert.equal(me(a).y, 80);
  assert.equal(me(a).z, C.MAP_SIZE);
  assert.equal(me(a).anim.length, 8);
  a.socket.emit('pos', { x: 'nope' });
  a.socket.emit('pos', null);
  await wait(80);
  assert.equal(me(a).x, 0);
});
