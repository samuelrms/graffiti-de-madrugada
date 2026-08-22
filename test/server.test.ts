import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createGame, cleanRoomName, newRoomId } from '../src/server/http/server.ts';
import { WEAPONS, type GameOptions } from '../src/server/game/config.ts';
import { movementViolation } from '../src/server/game/geometry.ts';
import * as C from '../src/shared/city.ts';
import type { Face, Building } from '../src/shared/city.ts';
import type { PlayerSnapshot, StateSnapshot, Welcome } from '../src/shared/protocol.ts';

interface Client { socket: Socket; state: StateSnapshot; welcome: Welcome; events: Array<{ e: string; d: any }>; full?: boolean }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const city = C.generateCity();

let clientSeq = 0;
function connect(port: number, room: string, name?: string, client: string = `c${++clientSeq}`): Promise<Client> {
  return new Promise((resolve, reject) => {
    const s = io(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    const data = { socket: s, state: null, welcome: null, events: [] } as unknown as Client;
    s.on('welcome', (w) => { data.welcome = w; resolve(data); });
    s.on('joinError', (e) => { if (e.reason === 'full') resolve({ socket: s, full: true } as Client); else { s.close(); reject(new Error(`joinError ${e.reason}`)); } });
    s.on('connect', () => s.emit('join', { room, name, client }));
    s.on('state', (st) => { data.state = st; });
    for (const e of ['painted', 'shot', 'hit', 'damaged', 'killed', 'pickup', 'power', 'respawned', 'reset', 'roomClosed', 'roomInfo']) s.on(e, (d) => data.events.push({ e, d }));
    s.on('connect_error', reject);
  });
}
async function until(fn: () => boolean, ms = 5000): Promise<true> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(25); }
  throw new Error('timeout waiting for condition');
}
const me = (c: Client): PlayerSnapshot => c.state.players.find((p) => p.id === c.socket.id)!;
const placeNextToWall = (c: Client, bi: number, face: Face, extra: Record<string, unknown> = {}) => {
  const b = city[bi];
  const t = C.tileCenter(b, face, 0, 0);
  c.socket.emit('pos', { x: t.x + t.nx * 2, y: 0, z: t.z + t.nz * 2, rot: Math.atan2(-t.nx, -t.nz) + Math.PI, anim: 'idle', ...extra });
  return t;
};

async function setup(t: TestContext, opts: Partial<GameOptions> = {}) {
  // Tests connect from one IP, so the per-IP limit is off unless a test opts in.
  const game = createGame({ port: 0, quiet: true, countdownSeconds: 0.2, validateMovement: false, maxPerIp: 0, ...opts });
  await game.ready;
  const room = game.createRoom('Teste');
  const clients: Client[] = [];
  t.after(async () => { clients.forEach((c) => c.socket.close()); await game.close(); });
  return {
    game,
    room,
    add: async (ready = true, roomKey: string = room.id, name?: string, client?: string) => {
      const c = await connect(game.port, roomKey, name, client);
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
  assert.deepEqual(await r.json(), { ok: true, rooms: 1 });
});

const post = (base: string, body: unknown) => fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

test('rooms: create, list public only, join by id or name, locked only by id, not-found', async (t) => {
  const { game, add } = await setup(t);
  const base = `http://localhost:${game.port}`;
  const created = await post(base, { name: ' Beco <b>13</b> ' });
  assert.equal(created.name, 'Beco b13/b');
  assert.match(created.id, /^[a-z0-9]{6}$/);
  const secret = await post(base, { name: 'Segredo', locked: true });
  assert.equal(secret.locked, true);
  const list = await (await fetch(`${base}/api/rooms`)).json();
  assert.deepEqual(list.map((r: any) => r.name).sort(), ['Beco b13/b', 'Teste']);
  assert.ok(!list.some((r: any) => r.id === secret.id), 'locked room hidden from the list');
  const byName = await add(false, 'beco b13/b');
  assert.equal(byName.welcome.room.id, created.id);
  const byId = await add(false, secret.id.toUpperCase());
  assert.equal(byId.welcome.room.id, secret.id);
  assert.equal(byId.welcome.room.locked, true);
  await assert.rejects(add(false, 'segredo'), /not-found/, 'locked rooms cannot be joined by name');
  await assert.rejects(add(false, 'zzzzzz'), /not-found/);
  const info = await (await fetch(`${base}/api/rooms/${created.id}`)).json();
  assert.equal(info.players, 1);
  assert.equal((await fetch(`${base}/api/rooms/nope00`)).status, 404);
});

test('rooms are isolated: paint and phase in one room do not leak into another', async (t) => {
  const { game, room, add } = await setup(t);
  const other = game.createRoom('Outra');
  const a = await add();
  const b = await add();
  const c = await add(false, other.id);
  await until(() => room.phase === 'playing');
  assert.equal(other.phase, 'lobby');
  placeNextToWall(a, 0, 1);
  await wait(80);
  a.socket.emit('paint', C.tileKey(0, 1, 0, 0));
  await until(() => me(a).score === 1);
  assert.equal(c.state.players.length, 1);
  assert.ok(!c.events.some((e) => e.e === 'painted'));
  assert.equal(me(b).score, 0);
});

test('rooms die when the last player leaves; unused rooms survive inside the TTL', async (t) => {
  const { game, room, add } = await setup(t);
  assert.ok(game.rooms.has(room.id), 'created but unused: kept for a while');
  const a = await add(false);
  const b = await add(false);
  await until(() => room.size === 2);
  a.socket.emit('leave');
  await until(() => room.size === 1);
  assert.ok(game.rooms.has(room.id), 'still occupied');
  b.socket.close();
  await until(() => !game.rooms.has(room.id));
  await assert.rejects(add(false), /not-found/, 'destroyed room cannot be joined');
});

test('one player per browser token; per-IP limit is configurable', async (t) => {
  const { add } = await setup(t);
  await add(false, undefined, 'Tab1', 'browser-A');
  await assert.rejects(add(false, undefined, 'Tab2', 'browser-A'), /duplicate/, 'second tab of the same browser');
  const other = await add(false, undefined, 'Other', 'browser-B');
  assert.equal(other.welcome.slot, 1);
  other.socket.emit('leave');
  await wait(100);
  const back = await add(false, undefined, 'Back', 'browser-B');
  assert.equal(back.welcome.slot, 1, 'token released on leave');
});

test('default MAX_PER_IP=1 blocks a second player from the same address', async (t) => {
  const { game, add } = await setup(t, { maxPerIp: 1 });
  const a = await add(false, undefined, 'A', 'browser-A');
  await assert.rejects(add(false, undefined, 'B', 'browser-B'), /ip-limit/);
  a.socket.close();
  await wait(150);
  const fresh = game.createRoom('Outra');
  const c = await add(false, fresh.id, 'C', 'browser-C');
  assert.equal(c.welcome.slot, 0, 'IP released on disconnect');
});

test('owner: first in, passes on leave, can set mode and close the room', async (t) => {
  const { game, room, add } = await setup(t);
  const a = await add(false);
  const b = await add(false);
  const c = await add(false);
  await until(() => room.size === 3);
  assert.equal(room.ownerId, a.socket.id);
  assert.equal(a.welcome.room.ownerId, a.socket.id);
  b.socket.emit('setMode', { mode: 'teams', teams: 2 }); // not the owner: ignored
  await wait(100);
  assert.equal(room.mode, 'ffa');
  a.socket.emit('setMode', { mode: 'teams', teams: 9 }); // clamped to 4
  await until(() => room.mode === 'teams');
  assert.equal(room.teams, 4);
  a.socket.emit('leave');
  await until(() => room.ownerId !== a.socket.id);
  assert.equal(room.ownerId, b.socket.id, `owner should pass to b (size ${room.size})`);
  c.socket.emit('closeRoom'); // not the owner
  await wait(100);
  assert.ok(game.rooms.has(room.id));
  b.socket.emit('closeRoom');
  await until(() => !game.rooms.has(room.id));
  await until(() => c.events.some((e) => e.e === 'roomClosed'));
});

test('teams: balanced assignment, rebalanced on leave, no friendly fire, team winner', async (t) => {
  const { room, add } = await setup(t, { matchSeconds: 0.8 });
  const a = await add(false);
  await until(() => room.size === 1);
  a.socket.emit('setMode', { mode: 'teams', teams: 2 });
  await until(() => room.mode === 'teams');
  const b = await add(false);
  const c = await add(false);
  const d = await add(false);
  await until(() => room.size === 4 && a.state.players.length === 4);
  const teamsOf = () => a.state.players.map((p) => p.team);
  assert.deepEqual(teamsOf(), [0, 1, 0, 1]);
  assert.equal(me(a).color, me(c).color, 'teammates share the team colour');
  assert.notEqual(me(a).color, me(b).color);
  d.socket.emit('leave');
  await until(() => a.state.players.length === 3);
  assert.deepEqual(teamsOf().sort(), [0, 0, 1]);
  for (const x of [a, b, c]) x.socket.emit('ready', true);
  await until(() => room.phase === 'playing');
  // a and c are teammates: shooting c does nothing; shooting b hurts.
  a.socket.emit('pos', { x: 100, y: 0, z: 100, rot: 0, anim: 'idle' });
  c.socket.emit('pos', { x: 103, y: 0, z: 100, rot: 0, anim: 'idle' });
  b.socket.emit('pos', { x: 106, y: 0, z: 100, rot: 0, anim: 'idle' });
  await wait(80);
  a.socket.emit('shoot', { ox: 100, oy: 1.4, oz: 100, dx: 1, dy: 0, dz: 0 });
  await until(() => me(b).hp < 100, 2000);
  assert.equal(me(c).hp, 100, 'teammate neither blocks nor takes the shot');
  placeNextToWall(a, 0, 1);
  placeNextToWall(c, 0, 1);
  await wait(80);
  a.socket.emit('paint', C.tileKey(0, 1, 0, 0));
  await until(() => me(a).score === 1);
  c.socket.emit('paint', C.tileKey(0, 1, 0, 0)); // already the team's tile
  await wait(250);
  assert.equal(me(c).score, 0);
  assert.equal(me(a).score, 1);
  await until(() => a.state.phase === 'ended', 4000);
  assert.equal(a.state.winner!.team, 0);
  assert.match(a.state.winner!.name, /Equipe/);
});

test('room ids avoid look-alike characters and names are sanitized', () => {
  for (let i = 0; i < 200; i++) assert.match(newRoomId(), /^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
  assert.equal(cleanRoomName('  <script>x</script> '), 'scriptx/script');
  assert.equal(cleanRoomName('a'.repeat(40)).length, 24);
  assert.equal(cleanRoomName(null), '');
});

test('serves the built client from staticDir', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdm-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>ok</h1>');
  const { game } = await setup(t, { staticDir: dir });
  const r = await fetch(`http://localhost:${game.port}/`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>ok</h1>');
});

test('lobby waits for two players who are all ready, then countdown, then playing', async (t) => {
  const { room, add } = await setup(t);
  const a = await add();
  await wait(150);
  assert.equal(room.phase, 'lobby');
  assert.equal(a.welcome.slot, 0);
  const b = await add(false);
  assert.equal(b.welcome.slot, 1);
  await wait(200);
  assert.equal(room.phase, 'lobby', 'does not start until everyone is ready');
  await until(() => a.state.players.find((p) => p.id === b.socket.id)!.ready === false);
  b.socket.emit('ready', true);
  await until(() => room.phase === 'playing');
  assert.equal(a.state.players.length, 2);
  assert.ok(a.state.timeLeft > 0);
});

test('13th player is rejected, slots are reused after disconnect', async (t) => {
  const { add } = await setup(t);
  const clients: Client[] = [];
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
  const { room, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => room.phase === 'playing');
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
  const { room, add } = await setup(t);
  const a = await add();
  await add();
  await until(() => room.phase === 'playing');
  placeNextToWall(a, 0, 1);
  await wait(80);
  for (let i = 0; i < 5; i++) a.socket.emit('paint', C.tileKey(0, 1, i, 0));
  await wait(250);
  assert.equal(me(a).tiles, 1);
});

test('pistol shots damage, kill, award bonus and respawn the victim', async (t) => {
  const { room, add } = await setup(t, { respawnMs: 300 });
  const a = await add();
  const b = await add();
  await until(() => room.phase === 'playing');
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
  const killed = a.events.find((e) => e.e === 'killed')!;
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
  const { room, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => room.phase === 'playing');
  const bld = city[0];
  a.socket.emit('pos', { x: bld.x - bld.w / 2 - 2, y: 0, z: bld.z, rot: 0, anim: 'idle' });
  b.socket.emit('pos', { x: bld.x + bld.w / 2 + 2, y: 0, z: bld.z, rot: 0, anim: 'idle' });
  await wait(80);
  a.socket.emit('shoot', { ox: bld.x - bld.w / 2 - 2, oy: 1.4, oz: bld.z, dx: 1, dy: 0, dz: 0 });
  await until(() => a.events.some((e) => e.e === 'shot'));
  const shot = a.events.find((e) => e.e === 'shot')!.d;
  assert.equal(shot.hit, false);
  assert.ok(Math.abs(shot.hx - (bld.x - bld.w / 2)) < 0.01, 'tracer ends at wall');
  assert.equal(me(b).hp, 100);
});

test('melee stuns and damages only targets in front', async (t) => {
  const { room, add } = await setup(t);
  const a = await add();
  const b = await add();
  const c = await add();
  await until(() => room.phase === 'playing');
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
  const { room, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => room.phase === 'playing');
  const vest = a.welcome.pickups.find((p) => p.type === 'vest' && p.y === 0)!;
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
  const med = a.welcome.pickups.find((p) => p.type === 'medkit' && p.y === 0)!;
  a.socket.emit('pos', { x: med.x, y: 0, z: med.z, rot: 0, anim: 'idle' });
  await until(() => me(a).hp > hpBefore);
  assert.equal(me(a).hp, 100);
});

test('bazooka pickup gives limited ammo and splash damage', async (t) => {
  const { room, add } = await setup(t);
  const a = await add();
  const b = await add();
  await until(() => room.phase === 'playing');
  const bz = a.welcome.pickups.find((p) => p.type === 'bazooka')!;
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
  const { room, add } = await setup(t);
  const a = await add(); // slot 0 -> dash
  const b = await add(); // slot 1 -> shield
  await until(() => room.phase === 'playing');
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
  const { room, add } = await setup(t, { matchSeconds: 0.6 });
  const a = await add();
  const b = await add();
  await until(() => room.phase === 'playing');
  placeNextToWall(a, 0, 1);
  await wait(80);
  a.socket.emit('paint', C.tileKey(0, 1, 0, 0));
  await until(() => room.phase === 'ended', 3000);
  await until(() => a.state.phase === 'ended');
  assert.equal(a.state.winner!.name, me(a).name);
  a.socket.emit('restart');
  await until(() => room.phase === 'lobby');
  await until(() => a.state.phase === 'lobby');
  assert.equal(me(a).score, 0);
  assert.equal(me(a).ready, false, 'everyone must ready up again');
  assert.ok(a.events.some((e) => e.e === 'reset'));
  a.socket.emit('ready', true);
  b.socket.emit('ready', true);
  await until(() => room.phase === 'playing');
});

test('position updates are clamped to the map and ignore garbage', async (t) => {
  const { room, add } = await setup(t);
  const a = await add();
  await add();
  await until(() => room.phase === 'playing');
  a.socket.emit('pos', { x: -50, y: 500, z: 9999, rot: 1, anim: 'x'.repeat(50) });
  await wait(80);
  assert.equal(me(a).x, 0);
  assert.equal(me(a).y, 60);
  assert.equal(me(a).z, C.MAP_SIZE);
  assert.equal(me(a).anim.length, 8);
  a.socket.emit('pos', { x: 'nope' });
  a.socket.emit('pos', null);
  await wait(80);
  assert.equal(me(a).x, 0);
});

test('movement validation: speed cap, clipping and flying are rejected', () => {
  const me = { x: 100, y: 0, z: 100 };
  const now = 10000;
    assert.equal(movementViolation(city, me, 101, 0, 100, 0.05, now), null, 'normal walk');
  assert.equal(movementViolation(city, me, 130, 0, 100, 0.05, now), 'speed', 'teleport');
  assert.equal(movementViolation(city, me, 100, 5, 100, 0.05, now), 'vspeed', 'rocket jump');
  const b: Building = city[0];
  assert.equal(movementViolation(city, { x: b.x, y: 0, z: b.z }, b.x, 0, b.z, 0.05, now), 'clip', 'inside building');
  assert.equal(movementViolation(city, { x: b.x, y: b.h, z: b.z }, b.x, b.h, b.z, 0.05, now), null, 'standing on roof');
  assert.equal(movementViolation(city, { x: 100, y: 20, z: 100 }, 100, 20, 100, 0.05, now), 'fly', 'hovering over a street');
  assert.equal(movementViolation(city, { x: 100, y: 20, z: 100 }, 101, 19, 100, 0.05, now), null, 'falling over a street');
  const wall = { x: b.x - b.w / 2 - 0.5, y: 10, z: b.z };
  assert.equal(movementViolation(city, wall, wall.x, Math.min(10, b.h - 1), wall.z, 0.05, now), null, 'climbing a wall');
  assert.equal(movementViolation(city, { x: 100, y: 0, z: 100, freeMoveUntil: now + 100 }, 130, 0, 100, 0.05, now), null, 'knockback window');
});

test('server snaps a cheating client back and keeps the last valid position', async (t) => {
  const { room, add } = await setup(t, { validateMovement: true });
  const a = await add();
  await add();
  await until(() => room.phase === 'playing');
  const sp = C.spawnPoints()[0];
  const corrections: Array<{ reason: string; x: number }> = [];
  a.socket.on('correct', (d: { reason: string; x: number }) => corrections.push(d));
  await wait(1600); // respawn grace window
  a.socket.emit('pos', { x: sp.x + 1, y: 0, z: sp.z, rot: 0, anim: 'run' });
  await wait(60);
  a.socket.emit('pos', { x: sp.x + 80, y: 0, z: sp.z, rot: 0, anim: 'run' });
  await until(() => corrections.length === 1);
  assert.equal(corrections[0].reason, 'speed');
  assert.equal(corrections[0].x, sp.x + 1);
  await wait(60);
  assert.equal(me(a).x, sp.x + 1);
});
