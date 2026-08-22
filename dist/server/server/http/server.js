// HTTP + Socket.IO server and the room registry. Each room is an isolated match.
import { randomBytes } from 'node:crypto';
import express from 'express';
import { Server } from 'socket.io';
import { DEFAULTS } from "../game/config.js";
import { createRoom } from "../game/room.js";
/** Rooms created through the API but never joined are removed after this long. Occupied rooms die as soon as the last player leaves. */
const UNUSED_ROOM_TTL_MS = 60_000;
const MAX_ROOMS = 200;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
export function newRoomId(len = 6) {
    const bytes = randomBytes(len);
    let id = '';
    for (let i = 0; i < len; i++)
        id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
    return id;
}
export function cleanRoomName(raw) {
    return String(raw ?? '').replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 24);
}
export function createGame(opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    const rooms = new Map();
    const current = new Map(); // socket.id -> room
    const clientOf = new Map(); // socket.id -> browser token
    const activeClients = new Set(); // browser tokens currently inside a room
    const ipCount = new Map(); // ip -> players inside rooms
    const app = express();
    app.set('trust proxy', true); // Render / Cloudflare tunnel put the client IP in X-Forwarded-For
    app.use(express.json({ limit: '4kb' }));
    app.get('/health', (_req, res) => { res.json({ ok: true, rooms: rooms.size }); });
    /** Public rooms only; locked rooms are reachable by id alone. */
    const publicRooms = () => [...rooms.values()].filter((r) => !r.locked).map((r) => r.info());
    app.get('/api/rooms', (_req, res) => { res.json(publicRooms()); });
    app.get('/api/rooms/:id', (req, res) => {
        const r = rooms.get(String(req.params.id).toLowerCase());
        if (!r) {
            res.status(404).json({ error: 'not-found' });
            return;
        }
        res.json(r.info());
    });
    app.post('/api/rooms', (req, res) => {
        if (rooms.size >= MAX_ROOMS) {
            res.status(503).json({ error: 'too-many-rooms' });
            return;
        }
        const name = cleanRoomName(req.body?.name) || 'Sala sem nome';
        const locked = !!req.body?.locked;
        res.status(201).json(makeRoom(name, locked).info());
    });
    if (cfg.staticDir)
        app.use(express.static(cfg.staticDir));
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });
    const httpServer = app.listen(cfg.port, '0.0.0.0', () => {
        if (!cfg.quiet)
            console.log(`Graffiti de Madrugada em http://localhost:${httpServer.address().port}`);
        resolveReady();
    });
    const io = new Server(httpServer);
    function makeRoom(name, locked) {
        let id = newRoomId();
        while (rooms.has(id))
            id = newRoomId();
        const room = createRoom(io, { id, name, locked }, cfg);
        room.onEmpty = () => { room.destroy(); rooms.delete(id); };
        room.onLeave = (socket) => { if (current.get(socket.id) === room) {
            current.delete(socket.id);
            release(socket);
        } };
        rooms.set(id, room);
        return room;
    }
    function ipOf(socket) {
        const fwd = socket.handshake.headers['x-forwarded-for'];
        const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
        return (first?.trim() || socket.handshake.address || '').replace(/^::ffff:/, '');
    }
    /** Resolve by id (any room) or by name (public rooms only, case-insensitive). */
    function findRoom(key) {
        const k = key.trim();
        const byId = rooms.get(k.toLowerCase());
        if (byId)
            return byId;
        const lower = k.toLowerCase();
        return [...rooms.values()].find((r) => !r.locked && r.name.toLowerCase() === lower);
    }
    function release(socket) {
        const token = clientOf.get(socket.id);
        if (token) {
            activeClients.delete(token);
            clientOf.delete(socket.id);
        }
        const ip = ipOf(socket);
        const n = (ipCount.get(ip) ?? 1) - 1;
        if (n <= 0)
            ipCount.delete(ip);
        else
            ipCount.set(ip, n);
    }
    function leaveCurrent(socket) {
        current.get(socket.id)?.leave(socket); // room.onLeave cleans the registry maps
    }
    io.on('connection', (socket) => {
        socket.on('join', (req) => {
            const key = typeof req?.room === 'string' ? req.room : '';
            if (!key) {
                socket.emit('joinError', { reason: 'invalid' });
                return;
            }
            const room = findRoom(key);
            if (!room) {
                socket.emit('joinError', { reason: 'not-found' });
                return;
            }
            leaveCurrent(socket);
            // One player per browser (token) and, by default, one per IP.
            const token = typeof req.client === 'string' ? req.client.slice(0, 64) : '';
            if (token && activeClients.has(token)) {
                socket.emit('joinError', { reason: 'duplicate' });
                return;
            }
            const ip = ipOf(socket);
            if (cfg.maxPerIp > 0 && (ipCount.get(ip) ?? 0) >= cfg.maxPerIp) {
                socket.emit('joinError', { reason: 'ip-limit' });
                return;
            }
            if (!room.join(socket, typeof req.name === 'string' ? req.name : undefined)) {
                socket.emit('joinError', { reason: 'full' });
                return;
            }
            current.set(socket.id, room);
            if (token) {
                activeClients.add(token);
                clientOf.set(socket.id, token);
            }
            ipCount.set(ip, (ipCount.get(ip) ?? 0) + 1);
        });
        socket.on('disconnect', () => leaveCurrent(socket));
    });
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [id, room] of rooms) {
            if (room.size === 0 && now - room.emptySince > UNUSED_ROOM_TTL_MS) {
                room.destroy();
                rooms.delete(id);
                continue;
            }
            room.tick();
        }
    }, cfg.tickMs);
    return {
        io,
        ready,
        rooms,
        get port() { return httpServer.address().port; },
        createRoom: makeRoom,
        close() {
            clearInterval(timer);
            for (const r of rooms.values())
                r.destroy();
            io.close();
            return new Promise((resolve) => httpServer.close(() => resolve()));
        }
    };
}
//# sourceMappingURL=server.js.map