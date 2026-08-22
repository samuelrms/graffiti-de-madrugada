import type { Building } from '../../shared/city.ts';
import { MAX_SPEED, SPEED_SLACK } from './config.ts';

/** Buildings whose footprint (expanded by `pad`) contains (x, z). */
export function buildingsAt(buildings: Building[], x: number, z: number, pad: number): Building[] {
  return buildings.filter((b) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad);
}

export interface Mover { x: number; y: number; z: number; freeMoveUntil?: number }
export type Violation = 'speed' | 'vspeed' | 'clip' | 'fly';

/** Reason why a reported position is not physically plausible, or null when it is. */
export function movementViolation(buildings: Building[], me: Mover, x: number, y: number, z: number, dt: number, now: number): Violation | null {
  // Knockback / respawn windows get a free pass on speed.
  if (now > (me.freeMoveUntil || 0)) {
    const dist = Math.hypot(x - me.x, z - me.z);
    if (dist > MAX_SPEED * dt + SPEED_SLACK) return 'speed';
    if (y - me.y > 12 * dt + 2.5) return 'vspeed';
  }
  // Inside a solid building (below its roof)?
  for (const b of buildingsAt(buildings, x, z, -0.2)) if (y < b.h - 0.3) return 'clip';
  // High up without anything to stand on or climb? (falling is always allowed)
  if (y > 7 && y >= me.y - 0.01) {
    const near = buildingsAt(buildings, x, z, 1.3);
    if (!near.some((b) => y <= b.h + 0.5)) return 'fly';
  }
  return null;
}

/** Ray vs axis-aligned box (slab test). Returns the entry distance or Infinity. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Building): number {
  const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
  const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
  let tmin = 0, tmax = Infinity;
  const axes: Array<[number, number, number, number]> = [[ox, dx, minX, maxX], [oy, dy, 0, b.h], [oz, dz, minZ, maxZ]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Ray vs sphere. Returns the entry distance or Infinity. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}
