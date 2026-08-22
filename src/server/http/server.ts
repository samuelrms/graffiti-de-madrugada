// HTTP + Socket.IO server and the room registry. Each room is an isolated match.
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import compression from 'compression';
import express from 'express';
import { Server } from 'socket.io';
import type { JoinError, RoomInfo } from '../../shared/protocol.ts';
import { DEFAULTS, type GameOptions } from '../game/config.ts';
import { createRoom, type GameSocket, type IO, type Room } from '../game/room.ts';

/** Rooms created through the API but never joined are removed after this long. Occupied rooms die as soon as the last player leaves. */
const UNUSED_ROOM_TTL_MS = 60_000;
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

const LLMS_TXT = `# Graffiti de Madrugada

> Jogo multiplayer 3D gratuito que roda no navegador (WebGL), em português do Brasil. De 2 a 12 jogadores por sala disputam uma cidade aberta durante uma noite de 3 minutos: pichar paredes dá pontos (quanto mais alto, mais vale), escalar prédios libera equipamentos, e armas de tinta, socos e poderes derrubam rivais. Modos: todos contra todos ou 2 a 4 equipes balanceadas.

- Jogar: {URL}/
- Tecnologia: TypeScript, Node, Socket.IO, Three.js
- Autor: Samuel Ramos, https://samuelramos.dev

## Como funciona

- Sem instalação, sem cadastro, sem custo. Funciona em desktop e celular.
- Salas com ID de 6 caracteres; salas abertas aparecem na página inicial, salas trancadas só pelo link.
- Uma pessoa por navegador; o dono da sala escolhe o modo e pode fechá-la.
- Controles: WASD anda, Shift corre, mouse olha, Espaço pula e escala paredes, clique picha ou atira, 1 e 2 trocam spray e arma, F soco, Q poder da classe.
- Classes (poder Q): Corredor (disparada), Tanque (escudo), Saltador (super pulo), Fantasma (fumaça).
- Equipamentos pela cidade: colete, kit médico, tênis turbo, lata 2x, bazuca de tinta no topo das torres.

## API pública

- GET {URL}/api/rooms lista salas abertas; POST cria uma sala (name, locked).
- GET {URL}/health estado do servidor.
`;

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
  const clientOf = new Map<string, string>(); // socket.id -> browser token
  const activeClients = new Set<string>(); // browser tokens currently inside a room
  const ipCount = new Map<string, number>(); // ip -> players inside rooms

  const app = express();
  app.set('trust proxy', true); // Render / Cloudflare tunnel put the client IP in X-Forwarded-For
  app.disable('x-powered-by');
  app.use(compression()); // gzip/brotli: the three.js bundle goes from ~800 KB to ~215 KB
  app.use(express.json({ limit: '4kb' }));

  // SEO: one canonical host. Page requests on another host (e.g. *.onrender.com) are redirected.
  const canonicalHost = new URL(cfg.publicUrl).host;
  app.use((req, res, next) => {
    if (cfg.canonicalRedirect && req.method === 'GET' && req.hostname !== canonicalHost && !req.hostname.startsWith('localhost') && req.path !== '/health' && !req.path.startsWith('/socket.io')) {
      res.redirect(301, `${cfg.publicUrl}${req.originalUrl}`);
      return;
    }
    next();
  });
  // Search engines and AI crawlers are all welcome; only the JSON API is pointless to index.
  const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-SearchBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'CCBot', 'Amazonbot', 'meta-externalagent', 'DuckAssistBot'];
  app.get('/robots.txt', (_req, res) => {
    const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/', ''];
    for (const bot of AI_BOTS) lines.push(`User-agent: ${bot}`, 'Allow: /', '');
    lines.push(`Sitemap: ${cfg.publicUrl}/sitemap.xml`);
    res.type('text/plain').send(lines.join('\n') + '\n');
  });
  // llms.txt: a plain-language summary for LLM crawlers and assistants.
  app.get('/llms.txt', (_req, res) => {
    res.type('text/plain').send(LLMS_TXT.replaceAll('{URL}', cfg.publicUrl));
  });
  app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain').send(`Contact: https://samuelramos.dev\nPreferred-Languages: pt-BR, en\nCanonical: ${cfg.publicUrl}/.well-known/security.txt\n`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${cfg.publicUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>\n`);
  });
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
  if (cfg.staticDir) {
    // Hashed assets are immutable; the HTML must always be revalidated so new builds show up.
    app.use('/assets', express.static(`${cfg.staticDir}/assets`, { immutable: true, maxAge: '1y' }));
    app.use(express.static(cfg.staticDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }));
  }

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
    room.onEmpty = () => { room.destroy(); rooms.delete(id); };
    room.onLeave = (socket) => { if (current.get(socket.id) === room) { current.delete(socket.id); release(socket); } };
    rooms.set(id, room);
    return room;
  }

  function ipOf(socket: GameSocket): string {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
    return (first?.trim() || socket.handshake.address || '').replace(/^::ffff:/, '');
  }

  /** Resolve by id (any room) or by name (public rooms only, case-insensitive). */
  function findRoom(key: string): Room | undefined {
    const k = key.trim();
    const byId = rooms.get(k.toLowerCase());
    if (byId) return byId;
    const lower = k.toLowerCase();
    return [...rooms.values()].find((r) => !r.locked && r.name.toLowerCase() === lower);
  }

  function release(socket: GameSocket): void {
    const token = clientOf.get(socket.id);
    if (token) { activeClients.delete(token); clientOf.delete(socket.id); }
    const ip = ipOf(socket);
    const n = (ipCount.get(ip) ?? 1) - 1;
    if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n);
  }

  function leaveCurrent(socket: GameSocket): void {
    current.get(socket.id)?.leave(socket); // room.onLeave cleans the registry maps
  }

  io.on('connection', (socket: GameSocket) => {
    socket.on('join', (req) => {
      const key = typeof req?.room === 'string' ? req.room : '';
      if (!key) { socket.emit('joinError', { reason: 'invalid' satisfies JoinError }); return; }
      const room = findRoom(key);
      if (!room) { socket.emit('joinError', { reason: 'not-found' }); return; }
      leaveCurrent(socket);
      // One player per browser (token) and, by default, one per IP.
      const token = typeof req.client === 'string' ? req.client.slice(0, 64) : '';
      if (token && activeClients.has(token)) { socket.emit('joinError', { reason: 'duplicate' }); return; }
      const ip = ipOf(socket);
      if (cfg.maxPerIp > 0 && (ipCount.get(ip) ?? 0) >= cfg.maxPerIp) { socket.emit('joinError', { reason: 'ip-limit' }); return; }
      if (!room.join(socket, typeof req.name === 'string' ? req.name : undefined)) { socket.emit('joinError', { reason: 'full' }); return; }
      current.set(socket.id, room);
      if (token) { activeClients.add(token); clientOf.set(socket.id, token); }
      ipCount.set(ip, (ipCount.get(ip) ?? 0) + 1);
    });
    socket.on('disconnect', () => leaveCurrent(socket));
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      if (room.size === 0 && now - room.emptySince > UNUSED_ROOM_TTL_MS) { room.destroy(); rooms.delete(id); continue; }
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
