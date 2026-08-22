// HTTP + Socket.IO server and the room registry. Each room is an isolated match.
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Server } from 'socket.io';
import type { JoinError, RoomInfo } from '../../shared/protocol.ts';
import { DEFAULTS, type GameOptions } from '../game/config.ts';
import { createRoom, type GameSocket, type IO, type Room } from '../game/room.ts';

/** Empty rooms are removed after this long. */
const EMPTY_ROOM_TTL_MS = 60_000;
const MAX_ROOMS = 200;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes

export interface Game {
  readonly port: number;
  readonly ready: Promise<void>;
  readonly rooms: ReadonlyMap<string, Room>;
  io: IO;
  createRoom(name: string, locked?: boolean): Room;
  close(): Promise<void>;
}

export function newRoomId(len = 6): string {
  const bytes = randomBytes(len);
  let id = '';
  for (let i = 0; i < len; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}

export function cleanRoomName(raw: unknown): string {
  return String(raw ?? '').replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 24);
}

export function createGame(opts: Partial<GameOptions> = {}): Game {
  const cfg: GameOptions = { ...DEFAULTS, ...opts };
  const rooms = new Map<string, Room>();
  const current = new Map<string, Room>(); // socket.id -> room

  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.get('/health', (_req, res) => { res.json({ ok: true, rooms: rooms.size }); });

  /** Public rooms only; locked rooms are reachable by id alone. */
  const publicRooms = (): RoomInfo[] => [...rooms.values()].filter((r) => !r.locked).map((r) => r.info());
  app.get('/api/rooms', (_req, res) => { res.json(publicRooms()); });
  app.get('/api/rooms/:id', (req, res) => {
    const r = rooms.get(String(req.params.id).toLowerCase());
    if (!r) { res.status(404).json({ error: 'not-found' }); return; }
    res.json(r.info());
  });
  app.post('/api/rooms', (req, res) => {
    if (rooms.size >= MAX_ROOMS) { res.status(503).json({ error: 'too-many-rooms' }); return; }
    const name = cleanRoomName(req.body?.name) || 'Sala sem nome';
    const locked = !!req.body?.locked;
    res.status(201).json(makeRoom(name, locked).info());
  });
  if (cfg.staticDir) app.use(express.static(cfg.staticDir));

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  const httpServer = app.listen(cfg.port, '0.0.0.0', () => {
    if (!cfg.quiet) console.log(`Graffiti de Madrugada em http://localhost:${(httpServer.address() as AddressInfo).port}`);
    resolveReady();
  });
  const io: IO = new Server(httpServer);

  function makeRoom(name: string, locked: boolean): Room {
    let id = newRoomId();
    while (rooms.has(id)) id = newRoomId();
    const room = createRoom(io, { id, name, locked }, cfg);
    rooms.set(id, room);
    return room;
  }

  /** Resolve by id (any room) or by name (public rooms only, case-insensitive). */
  function findRoom(key: string): Room | undefined {
    const k = key.trim();
    const byId = rooms.get(k.toLowerCase());
    if (byId) return byId;
    const lower = k.toLowerCase();
    return [...rooms.values()].find((r) => !r.locked && r.name.toLowerCase() === lower);
  }

  function leaveCurrent(socket: GameSocket): void {
    const room = current.get(socket.id);
    if (!room) return;
    room.leave(socket);
    current.delete(socket.id);
  }

  io.on('connection', (socket: GameSocket) => {
    socket.on('join', (req) => {
      const key = typeof req?.room === 'string' ? req.room : '';
      if (!key) { socket.emit('joinError', { reason: 'invalid' satisfies JoinError }); return; }
      const room = findRoom(key);
      if (!room) { socket.emit('joinError', { reason: 'not-found' }); return; }
      leaveCurrent(socket);
      if (!room.join(socket, typeof req.name === 'string' ? req.name : undefined)) { socket.emit('joinError', { reason: 'full' }); return; }
      current.set(socket.id, room);
      socket.once('leave', () => current.delete(socket.id));
    });
    socket.on('disconnect', () => leaveCurrent(socket));
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      if (room.size === 0 && now - room.emptySince > EMPTY_ROOM_TTL_MS) { room.destroy(); rooms.delete(id); continue; }
      room.tick();
    }
  }, cfg.tickMs);

  return {
    io,
    ready,
    rooms,
    get port() { return (httpServer.address() as AddressInfo).port; },
    createRoom: makeRoom,
    close() {
      clearInterval(timer);
      for (const r of rooms.values()) r.destroy();
      io.close();
      return new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}
