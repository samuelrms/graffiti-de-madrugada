import type { Server, Socket } from 'socket.io';
import * as CITY from '../../shared/city.ts';
import type { Building, PickupPoint } from '../../shared/city.ts';
import {
  MAX_TEAMS, TEAM_COLORS, TEAM_NAMES,
  type Anim, type ClientToServer, type GameMode, type KillWeapon, type Phase, type PlayerSnapshot, type RoomInfo,
  type ServerToClient, type StateSnapshot, type WeaponName, type Winner
} from '../../shared/protocol.ts';
import {
  CLASS_POWER, COLORS, DEATH_TILE_LOSS, KILL_BONUS, MAX_HP, MAX_Y, MELEE_COOLDOWN_MS, MELEE_DAMAGE,
  MELEE_RANGE, PAINT_COOLDOWN_MS, PAINT_RANGE, PICKUP_TYPES, POWERS, STUN_MS, WEAPONS, type GameOptions
} from './config.ts';
import { movementViolation, rayBox, raySphere } from './geometry.ts';

export type IO = Server<ClientToServer, ServerToClient>;
export type GameSocket = Socket<ClientToServer, ServerToClient>;

interface Player {
  id: string;
  slot: number;
  name: string;
  /** slot colour in FFA, team colour in teams mode */
  color: string;
  team: number;
  joinedAt: number;
  x: number; y: number; z: number; rot: number;
  anim: Anim;
  hp: number;
  armor: number;
  dead: boolean;
  respawnAt: number;
  stunUntil: number;
  weapon: WeaponName;
  ammo: number;
  shoesUntil: number;
  doubleUntil: number;
  shieldUntil: number;
  smokeUntil: number;
  freeMoveUntil: number;
  lastPosAt: number;
  violations: number;
  score: number;
  tiles: number;
  kills: number;
  deaths: number;
  ready: boolean;
  meleeReadyAt: number;
  paintReadyAt: number;
  shootReadyAt: number;
  powerReadyAt: number;
  lastWeapon: KillWeapon;
}

interface Pickup extends PickupPoint { id: number; takenUntil: number }

export interface RoomMeta { id: string; name: string; locked: boolean }

/** One isolated match: its own players, paint, pickups and phase. Broadcasts to the Socket.IO room `id`. */
export interface Room extends RoomMeta {
  readonly phase: Phase;
  readonly size: number;
  readonly ownerId: string;
  readonly mode: GameMode;
  readonly teams: number;
  /** ms timestamp since the room has been empty (0 while occupied) */
  readonly emptySince: number;
  info(): RoomInfo;
  /** Adds a socket; returns false when full. */
  join(socket: GameSocket, name?: string): boolean;
  leave(socket: GameSocket): void;
  tick(): void;
  /** Kicks everyone (they receive `roomClosed`). */
  destroy(): void;
  /** Called by the registry when the last player leaves. */
  onEmpty?: () => void;
  /** Called for every socket that leaves (voluntarily, disconnect or room destroyed). */
  onLeave?: (socket: GameSocket) => void;
}

// Shared by every room; generating the city is cheap but there is no reason to repeat it.
const CITY_BUILDINGS: Building[] = CITY.generateCity();

export function createRoom(io: IO, meta: RoomMeta, cfg: GameOptions): Room {
  const buildings = CITY_BUILDINGS;
  type Ev = keyof ServerToClient;
  const emit = <E extends Ev>(ev: E, ...args: Parameters<ServerToClient[E]>): void => {
    io.to(meta.id).emit(ev, ...(args as any));
  };
  const spawns = CITY.spawnPoints();
  const pickups: Pickup[] = CITY.pickupPoints().map((p, i) => ({ id: i, ...p, takenUntil: 0 }));

  // ---------- State ----------
  const players = new Map<string, Player>();
  const sockets = new Map<string, GameSocket>();
  let emptySince = Date.now();
  let ownerId = '';
  let mode: GameMode = 'ffa';
  let teams = 2;
  // eslint-disable-next-line prefer-const -- assigned at the end; closures read it at call time
  let room: Room;
  let paint = new Map<string, number>(); // tileKey -> slot
  let phase: Phase = 'lobby';
  let phaseEndsAt = 0;
  let winner: Winner | null = null;

  function freeSlot(): number {
    const used = new Set([...players.values()].map((p) => p.slot));
    for (let i = 0; i < cfg.maxPlayers; i++) if (!used.has(i)) return i;
    return -1;
  }

  function respawn(p: Player): void {
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
    p.freeMoveUntil = Date.now() + 1500;
    p.lastPosAt = 0;
    emit('respawned', { id: p.id, x: p.x, y: p.y, z: p.z });
  }

  // ---------- Teams ----------
  const teamOf = (p: Player) => (mode === 'teams' ? p.team : -1);
  const sameTeam = (a: Player, b: Player) => mode === 'teams' && a.team === b.team;
  function smallestTeam(): number {
    const counts = new Array<number>(teams).fill(0);
    for (const p of players.values()) if (p.team >= 0 && p.team < teams) counts[p.team]++;
    let best = 0;
    for (let t = 1; t < teams; t++) if (counts[t] < counts[best]) best = t;
    return best;
  }
  /** Deal players round-robin by join order so teams differ by at most one. Lobby only. */
  function rebalance(): void {
    if (phase !== 'lobby') return;
    const ordered = [...players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    ordered.forEach((p, i) => { p.team = mode === 'teams' ? i % teams : -1; });
    for (const p of players.values()) applyColor(p);
  }
  function applyColor(p: Player): void {
    p.color = mode === 'teams' ? TEAM_COLORS[p.team] : COLORS[p.slot];
  }
  function setMode(nextMode: GameMode, nextTeams: number): void {
    mode = nextMode;
    teams = Math.max(2, Math.min(MAX_TEAMS, Math.floor(nextTeams) || 2));
    rebalance();
    emit('roomInfo', info());
  }

  function newPlayer(id: string, slot: number): Player {
    const p = {
      id, slot, name: `Crew${slot + 1}`, color: COLORS[slot], team: -1, joinedAt: Date.now(),
      x: 0, y: 0, z: 0, rot: 0, anim: 'idle', hp: MAX_HP, armor: 0, dead: false, respawnAt: 0, stunUntil: 0,
      weapon: 'pistol', ammo: Infinity, shoesUntil: 0, doubleUntil: 0, shieldUntil: 0, smokeUntil: 0,
      freeMoveUntil: 0, lastPosAt: 0, violations: 0, score: 0, tiles: 0, kills: 0, deaths: 0, ready: false,
      meleeReadyAt: 0, paintReadyAt: 0, shootReadyAt: 0, powerReadyAt: 0, lastWeapon: 'pistol'
    } satisfies Player;
    return p;
  }

  function resetPlayer(p: Player): void {
    respawn(p);
    p.score = 0; p.tiles = 0; p.kills = 0; p.deaths = 0; p.ready = false;
    p.meleeReadyAt = 0; p.paintReadyAt = 0; p.shootReadyAt = 0; p.powerReadyAt = 0;
  }

  function startCountdown(): void {
    paint = new Map();
    winner = null;
    for (const pk of pickups) pk.takenUntil = 0;
    for (const p of players.values()) resetPlayer(p);
    phase = 'countdown';
    phaseEndsAt = Date.now() + cfg.countdownSeconds * 1000;
    emit('reset');
  }
  function startMatch(): void { phase = 'playing'; phaseEndsAt = Date.now() + cfg.matchSeconds * 1000; }
  function endMatch(): void {
    phase = 'ended'; phaseEndsAt = 0;
    if (mode === 'teams') {
      const totals = new Array<number>(teams).fill(0);
      for (const p of players.values()) if (p.team >= 0) totals[p.team] += p.score;
      const order = totals.map((score, team) => ({ score, team })).sort((a, b) => b.score - a.score);
      winner = order.length > 1 && order[0].score === order[1].score
        ? { name: 'Empate', color: '#f4efe8', score: order[0].score }
        : { name: `Equipe ${TEAM_NAMES[order[0].team]}`, color: TEAM_COLORS[order[0].team], score: order[0].score, team: order[0].team };
      return;
    }
    const ranked = [...players.values()].sort((a, b) => b.score - a.score);
    if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
      winner = { name: ranked[0].name, color: ranked[0].color, score: ranked[0].score };
    } else {
      winner = { name: 'Empate', color: '#f4efe8', score: ranked[0]?.score ?? 0 };
    }
  }
  function backToLobby(): void {
    phase = 'lobby'; phaseEndsAt = 0; winner = null; paint = new Map();
    for (const p of players.values()) resetPlayer(p);
    rebalance();
    emit('reset');
  }
  function bySlot(slot: number): Player | null {
    for (const p of players.values()) if (p.slot === slot) return p;
    return null;
  }

  // ---------- Combat ----------
  function damage(target: Player, amount: number, by: Player | null, now: number): void {
    if (target.dead || phase !== 'playing') return;
    if (by && by !== target && sameTeam(by, target)) return; // no friendly fire
    if (now < target.shieldUntil) amount *= 0.5;
    const absorbed = Math.min(target.armor, amount * 0.7);
    target.armor -= absorbed;
    target.hp = Math.max(0, target.hp - (amount - absorbed));
    emit('damaged', { id: target.id, by: by?.id, hp: Math.round(target.hp), armor: Math.round(target.armor) });
    if (target.hp <= 0) {
      target.hp = 0; target.dead = true; target.deaths++;
      target.respawnAt = now + cfg.respawnMs;
      const loss = Math.floor(target.score * DEATH_TILE_LOSS);
      target.score -= loss;
      if (by && by !== target) { by.kills++; by.score += KILL_BONUS + loss; }
      emit('killed', {
        id: target.id, by: by?.id, byName: by?.name, byColor: by?.color, name: target.name, color: target.color,
        loss, weapon: by?.lastWeapon ?? 'pistol'
      });
    }
  }

  function tick(): void {
    const now = Date.now();
    if (phase === 'lobby' && players.size >= cfg.minPlayers && [...players.values()].every((p) => p.ready)) startCountdown();
    if (phase === 'countdown' && now >= phaseEndsAt) startMatch();
    if (phase === 'playing' && now >= phaseEndsAt) endMatch();
    if ((phase === 'countdown' || phase === 'playing') && players.size < cfg.minPlayers) backToLobby();

    if (phase === 'playing') {
      for (const p of players.values()) {
        if (p.dead && now >= p.respawnAt) respawn(p);
        if (p.dead) continue;
        for (const pk of pickups) {
          if (now < pk.takenUntil) continue;
          if (Math.hypot(pk.x - p.x, pk.z - p.z) > 1.4 || Math.abs(pk.y - p.y) > 2) continue;
          const def = PICKUP_TYPES[pk.type];
          pk.takenUntil = now + def.respawn;
          if (pk.type === 'bazooka') { p.weapon = 'bazooka'; p.ammo = WEAPONS.bazooka.ammo; }
          if (pk.type === 'vest') p.armor = Math.min(100, p.armor + (def.armor ?? 0));
          if (pk.type === 'shoes') p.shoesUntil = now + (def.duration ?? 0);
          if (pk.type === 'doublecan') p.doubleUntil = now + (def.duration ?? 0);
          if (pk.type === 'medkit') p.hp = Math.min(MAX_HP, p.hp + (def.heal ?? 0));
          emit('pickup', { id: pk.id, by: p.id, type: pk.type });
        }
      }
    }
    emit('state', snapshot(now));
  }

  function snapshot(now: number): StateSnapshot {
    const list: PlayerSnapshot[] = [...players.values()].map((p) => ({
      id: p.id, slot: p.slot, name: p.name, color: p.color, cls: p.slot % 4, team: teamOf(p), ready: p.ready, deaths: p.deaths,
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
    }));
    return {
      phase,
      timeLeft: phaseEndsAt ? Math.max(0, Math.ceil((phaseEndsAt - now) / 1000)) : 0,
      winner,
      pickups: pickups.map((pk) => (now < pk.takenUntil ? 0 : 1)),
      players: list
    };
  }

  function info(): RoomInfo {
    return { id: meta.id, name: meta.name, locked: meta.locked, players: players.size, maxPlayers: cfg.maxPlayers, phase, mode, teams, ownerId };
  }

  const EVENTS = ['pos', 'paint', 'shoot', 'melee', 'power', 'rename', 'ready', 'restart', 'leave', 'setMode', 'closeRoom'] as const;

  function leave(socket: GameSocket): void {
    if (!players.has(socket.id)) return;
    players.delete(socket.id);
    sockets.delete(socket.id);
    socket.leave(meta.id);
    for (const e of EVENTS) socket.removeAllListeners(e);
    if (ownerId === socket.id) {
      // Ownership passes to whoever has been here the longest.
      const next = [...players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      ownerId = next?.id ?? '';
    }
    rebalance();
    room.onLeave?.(socket);
    if (players.size === 0) { emptySince = Date.now(); emit('roomInfo', info()); room.onEmpty?.(); return; }
    emit('roomInfo', info());
  }

  function join(socket: GameSocket, name?: string): boolean {
    const slot = freeSlot();
    if (slot < 0) return false;
    const p = newPlayer(socket.id, slot);
    resetPlayer(p);
    if (name) p.name = name.trim().slice(0, 12) || p.name;
    players.set(socket.id, p);
    sockets.set(socket.id, socket);
    emptySince = 0;
    if (!ownerId) ownerId = socket.id;
    if (mode === 'teams') p.team = phase === 'lobby' ? -1 : smallestTeam();
    if (phase === 'lobby') rebalance(); else applyColor(p);
    socket.join(meta.id);
    socket.emit('welcome', {
      room: info(),
      id: socket.id, slot, matchSeconds: cfg.matchSeconds, minPlayers: cfg.minPlayers,
      power: CLASS_POWER[slot % 4], powers: POWERS, weapons: WEAPONS,
      pickups: pickups.map((pk) => ({ id: pk.id, type: pk.type, x: pk.x, y: pk.y, z: pk.z })),
      paint: [...paint.entries()],
      colors: COLORS
    });

    // Client-side physics, server-side sanity: speed cap, no flying, no clipping.
    socket.on('pos', (d) => {
      const me = players.get(socket.id);
      if (!me || !d || me.dead) return;
      const x = Number(d.x), y = Number(d.y), z = Number(d.z), rot = Number(d.rot);
      if (![x, y, z, rot].every(Number.isFinite)) return;
      const now = Date.now();
      const nx = Math.max(0, Math.min(CITY.MAP_SIZE, x));
      const ny = Math.max(0, Math.min(MAX_Y, y));
      const nz = Math.max(0, Math.min(CITY.MAP_SIZE, z));
      const dt = Math.min(1, (now - (me.lastPosAt || now)) / 1000);
      me.lastPosAt = now;
      const reason = cfg.validateMovement ? movementViolation(buildings, me, nx, ny, nz, dt, now) : null;
      if (reason) {
        me.violations++;
        socket.emit('correct', { x: me.x, y: me.y, z: me.z, reason });
        return;
      }
      me.x = nx; me.y = ny; me.z = nz;
      me.rot = rot;
      me.anim = typeof d.anim === 'string' ? (d.anim.slice(0, 8) as Anim) : 'idle';
    });

    socket.on('paint', (key) => {
      const me = players.get(socket.id);
      const now = Date.now();
      if (!me || me.dead || phase !== 'playing' || now < me.stunUntil || now < me.paintReadyAt) return;
      const t = typeof key === 'string' ? CITY.parseKey(key) : null;
      if (!t) return;
      const b = buildings[t.bi];
      if (!b) return;
      const info = CITY.faceInfo(b, t.face);
      if (t.i < 0 || t.j < 0 || t.i >= info.cols || t.j >= info.rows) return;
      const c = CITY.tileCenter(b, t.face, t.i, t.j);
      if (Math.hypot(c.x - me.x, c.y - (me.y + 1), c.z - me.z) > PAINT_RANGE) return;
      const prevSlot = paint.get(key);
      if (prevSlot === me.slot) return;
      const prev = prevSlot !== undefined && prevSlot >= 0 ? bySlot(prevSlot) : null;
      if (prev && sameTeam(prev, me)) return; // already ours
      const value = CITY.tileValue(t.j) * (now < me.doubleUntil ? 2 : 1);
      if (prev) { prev.score -= CITY.tileValue(t.j); prev.tiles--; }
      paint.set(key, me.slot);
      me.score += value; me.tiles++;
      me.paintReadyAt = now + PAINT_COOLDOWN_MS;
      emit('painted', { key, slot: me.slot, color: me.color, value, by: me.id });
    });

    // Hitscan shot. Client sends origin (eye) + direction; server resolves.
    socket.on('shoot', (d) => {
      const me = players.get(socket.id);
      const now = Date.now();
      if (!me || me.dead || phase !== 'playing' || now < me.stunUntil || now < me.shootReadyAt || !d) return;
      const w = WEAPONS[me.weapon] ?? WEAPONS.pistol;
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
      let victim: Player | null = null;
      for (const o of players.values()) {
        if (o === me || o.dead || sameTeam(o, me)) continue;
        const t = raySphere(ox, oy, oz, dx, dy, dz, o.x, o.y + 0.9, o.z, 0.8);
        if (t < tHit) { tHit = t; victim = o; }
      }
      const hx = ox + dx * tHit, hy = oy + dy * tHit, hz = oz + dz * tHit;
      if (w.splash > 0) {
        for (const o of players.values()) {
          if (o.dead || o === me) continue;
          const dist = Math.hypot(o.x - hx, o.y + 0.9 - hy, o.z - hz);
          if (dist <= w.splash) damage(o, w.damage * (1 - (dist / w.splash) * 0.6), me, now);
        }
      } else if (victim) {
        damage(victim, w.damage, me, now);
      }
      emit('shot', { by: me.id, weapon: me.weapon, ox, oy, oz, hx, hy, hz, hit: !!victim || w.splash > 0 });
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
        if (o === me || o.dead || sameTeam(o, me)) continue;
        const dx = o.x - me.x, dy = o.y - me.y, dz = o.z - me.z;
        const dist = Math.hypot(dx, dz);
        if (dist > MELEE_RANGE || Math.abs(dy) > 2) continue;
        if ((dx * fx + dz * fz) / (dist || 1) < 0.3) continue;
        o.stunUntil = now + STUN_MS;
        o.freeMoveUntil = now + 600;
        damage(o, MELEE_DAMAGE, me, now);
        emit('hit', { by: me.id, victim: o.id, fx, fz });
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
      if (name === 'jump') me.freeMoveUntil = now + 1500;
      emit('power', { id: me.id, name, duration: pw.duration });
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
    socket.on('leave', () => leave(socket));
    socket.on('setMode', (m) => {
      if (socket.id !== ownerId || phase !== 'lobby' || !m) return;
      if (m.mode !== 'ffa' && m.mode !== 'teams') return;
      setMode(m.mode, Number(m.teams) || teams);
    });
    socket.on('closeRoom', () => { if (socket.id === ownerId) room.destroy(); });
    emit('roomInfo', info());
    return true;
  }

  room = {
    get id() { return meta.id; },
    get name() { return meta.name; },
    get locked() { return meta.locked; },
    get phase() { return phase; },
    get size() { return players.size; },
    get emptySince() { return emptySince; },
    get ownerId() { return ownerId; },
    get mode() { return mode; },
    get teams() { return teams; },
    info, join, leave, tick,
    destroy() {
      emit('roomClosed');
      for (const s of [...sockets.values()]) leave(s);
    }
  };
  return room;
}
