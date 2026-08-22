// Deterministic city generator shared by server and browser.
// Same seed => same buildings on both sides, so the server can validate paint.
export const SEED = 7331;
export const BLOCKS = 6; // blocks per side
export const BLOCK = 24; // block size (units)
export const STREET = 8; // street width
export const CELL = BLOCK + STREET;
export const MAP_SIZE = BLOCKS * CELL + STREET;
export const TILE = 2; // paint tile size on walls
export function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function generateCity() {
    const rnd = mulberry32(SEED);
    const buildings = [];
    for (let bx = 0; bx < BLOCKS; bx++) {
        for (let bz = 0; bz < BLOCKS; bz++) {
            const ox = STREET + bx * CELL; // block origin
            const oz = STREET + bz * CELL;
            const r = rnd();
            const center = Math.abs(bx - 2.5) + Math.abs(bz - 2.5) < 2.5;
            if (center && r < 0.7) {
                // downtown: one tower
                const w = 12 + Math.floor(rnd() * 8);
                const d = 12 + Math.floor(rnd() * 8);
                const h = 16 + Math.floor(rnd() * 18);
                buildings.push({ kind: 'tower', x: ox + BLOCK / 2, z: oz + BLOCK / 2, w, d, h, hue: rnd() });
            }
            else if (r < 0.35) {
                // two shops side by side
                for (let k = 0; k < 2; k++) {
                    const w = 9;
                    const d = 14 + Math.floor(rnd() * 6);
                    const h = 7 + Math.floor(rnd() * 5);
                    buildings.push({ kind: 'shop', x: ox + 6 + k * 12, z: oz + BLOCK / 2, w, d, h, hue: rnd() });
                }
            }
            else {
                // 2x2 houses
                for (let i = 0; i < 2; i++) {
                    for (let j = 0; j < 2; j++) {
                        if (rnd() < 0.15)
                            continue;
                        const w = 7 + Math.floor(rnd() * 3);
                        const d = 7 + Math.floor(rnd() * 3);
                        const h = 4 + Math.floor(rnd() * 3);
                        buildings.push({ kind: 'house', x: ox + 6 + i * 12, z: oz + 6 + j * 12, w, d, h, hue: rnd() });
                    }
                }
            }
        }
    }
    return buildings;
}
// Spawn points: street intersections, spread out.
export function spawnPoints() {
    const pts = [];
    for (let i = 0; i <= BLOCKS; i++) {
        for (let j = 0; j <= BLOCKS; j++) {
            pts.push({ x: i * CELL + STREET / 2, z: j * CELL + STREET / 2 });
        }
    }
    // Pick 12 well separated ones (corners, edge mids, inner ring).
    const pick = [
        [0, 0], [6, 6], [0, 6], [6, 0], [3, 0], [3, 6], [0, 3], [6, 3], [2, 2], [4, 4], [2, 4], [4, 2]
    ];
    return pick.map(([i, j]) => pts[i * (BLOCKS + 1) + j]);
}
// Pickup points: unused intersections (ground) + tops of some buildings.
export function pickupPoints() {
    const used = new Set(spawnPoints().map((s) => `${s.x},${s.z}`));
    const types = ['vest', 'medkit', 'shoes', 'doublecan', 'bazooka'];
    const rnd = mulberry32(SEED + 7);
    const out = [];
    for (let i = 0; i <= BLOCKS; i++) {
        for (let j = 0; j <= BLOCKS; j++) {
            const x = i * CELL + STREET / 2, z = j * CELL + STREET / 2;
            if (used.has(`${x},${z}`))
                continue;
            if (rnd() < 0.55)
                continue;
            out.push({ type: types[Math.floor(rnd() * 4)], x, y: 0, z });
        }
    }
    // Bazookas + vests on rooftops: reward for climbing.
    const city = generateCity();
    city.forEach((b, bi) => {
        if (b.kind === 'tower' && rnd() < 0.8)
            out.push({ type: 'bazooka', x: b.x, y: b.h, z: b.z, roof: bi });
        else if (b.kind === 'shop' && rnd() < 0.5)
            out.push({ type: rnd() < 0.5 ? 'vest' : 'medkit', x: b.x, y: b.h, z: b.z, roof: bi });
    });
    return out;
}
// Wall faces. face 0:+x 1:-x 2:+z 3:-z. Tile grid per face: cols along the
// face width, rows up the height. Returns tile center in world space.
export function faceInfo(b, face) {
    const along = face < 2 ? b.d : b.w;
    return { cols: Math.floor(along / TILE), rows: Math.floor(b.h / TILE) };
}
export function tileCenter(b, face, i, j) {
    const y = j * TILE + TILE / 2;
    const half = face < 2 ? b.d / 2 : b.w / 2;
    const t = -half + i * TILE + TILE / 2;
    switch (face) {
        case 0: return { x: b.x + b.w / 2, y, z: b.z + t, nx: 1, nz: 0 };
        case 1: return { x: b.x - b.w / 2, y, z: b.z + t, nx: -1, nz: 0 };
        case 2: return { x: b.x + t, y, z: b.z + b.d / 2, nx: 0, nz: 1 };
        default: return { x: b.x + t, y, z: b.z - b.d / 2, nx: 0, nz: -1 };
    }
}
export function tileKey(bi, face, i, j) {
    return `${bi}:${face}:${i}:${j}`;
}
export function parseKey(key) {
    const p = key.split(':').map(Number);
    if (p.length !== 4 || !p.every(Number.isInteger) || p[1] < 0 || p[1] > 3)
        return null;
    return { bi: p[0], face: p[1], i: p[2], j: p[3] };
}
// Points for a tile: higher = more (reason to climb).
export function tileValue(j) {
    return 1 + Math.floor((j * TILE) / 6);
}
//# sourceMappingURL=city.js.map