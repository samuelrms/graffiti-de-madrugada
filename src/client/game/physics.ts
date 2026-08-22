// Local player physics: gravity, AABB collision with buildings, wall climbing,
// rooftops. Runs on a fixed 60 Hz step independent of rendering.
import * as THREE from 'three';
import * as CITY from '../../shared/city.ts';
import type { Building } from '../../shared/city.ts';
import { buildingMeshes, camera } from '../render/scene.ts';
import { buildings, input, myState, net, player } from '../core/state.ts';

const R = 0.45;
const WALK = 7, RUN = 10.5, SHOES_BONUS = 1.5, DASH = 17;
const GRAVITY = 26, JUMP = 9, CLIMB = 4.5;

export function spawnLocal(x: number, y: number, z: number): void {
  player.x = x; player.y = y; player.z = z; player.vy = 0; player.climbing = false;
  player.yaw = Math.atan2(CITY.MAP_SIZE / 2 - x, CITY.MAP_SIZE / 2 - z) + Math.PI;
}

export function physics(dt: number): void {
  const ms = myState();
  player.dead = !!ms?.dead;
  player.stunned = !!ms?.stunned;
  const canMove = net.state.phase === 'playing' && !player.dead && !player.stunned;
  const now = performance.now();
  const keys = input.keys;
  // Sprint: Shift on keyboard, joystick pushed to the edge on touch. Shoes add 50 % on top.
  const sprinting = keys.has('shift') || (input.touch.active && Math.hypot(input.touch.x, input.touch.y) > 0.92);
  let speed = sprinting ? RUN : WALK;
  if (ms?.shoes) speed *= SHOES_BONUS;
  if (now < input.dashUntil) speed = DASH;

  let ix = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  let iz = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  if (input.touch.active) { ix = input.touch.x; iz = input.touch.y; }
  if (!canMove) ix = iz = 0;
  const len = Math.hypot(ix, iz) || 1;
  ix /= len; iz /= len;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const mx = (ix * cos + iz * sin) * speed * dt;
  const mz = (-ix * sin + iz * cos) * speed * dt;
  const moving = ix !== 0 || iz !== 0;

  // Horizontal move + resolve against buildings (solid only while below roof level)
  player.x += mx; player.z += mz;
  let wall: Building | null = null;
  for (const b of buildings) {
    if (player.y >= b.h - 0.05) continue;
    const minX = b.x - b.w / 2 - R, maxX = b.x + b.w / 2 + R;
    const minZ = b.z - b.d / 2 - R, maxZ = b.z + b.d / 2 + R;
    if (player.x <= minX || player.x >= maxX || player.z <= minZ || player.z >= maxZ) continue;
    const px = Math.min(player.x - minX, maxX - player.x);
    const pz = Math.min(player.z - minZ, maxZ - player.z);
    if (px < pz) { player.x = player.x - minX < maxX - player.x ? minX : maxX; wall = b; }
    else { player.z = player.z - minZ < maxZ - player.z ? minZ : maxZ; wall = b; }
  }
  player.x = Math.max(R, Math.min(CITY.MAP_SIZE - R, player.x));
  player.z = Math.max(R, Math.min(CITY.MAP_SIZE - R, player.z));

  // Climb: touching a wall + holding jump (or pushing into it while airborne)
  const wantClimb = wall && canMove && (keys.has(' ') || (moving && !player.onGround));
  if (wantClimb && wall) {
    player.climbing = true;
    player.vy = CLIMB * (ms?.shoes ? 1.4 : 1);
    if (player.y >= wall.h - 0.4) { player.y = wall.h; player.vy = 2; player.climbing = false; } // mantle
  } else {
    player.climbing = false;
    player.vy -= GRAVITY * dt;
  }
  player.y += player.vy * dt;

  // Vertical resolve: ground + roofs
  let grounded = false;
  if (player.y <= 0) { player.y = 0; player.vy = 0; grounded = true; }
  for (const b of buildings) {
    const inside = player.x > b.x - b.w / 2 - R * 0.5 && player.x < b.x + b.w / 2 + R * 0.5 && player.z > b.z - b.d / 2 - R * 0.5 && player.z < b.z + b.d / 2 + R * 0.5;
    if (!inside) continue;
    if (player.vy <= 0 && player.y <= b.h && player.y > b.h - 1.2) { player.y = b.h; player.vy = 0; grounded = true; }
  }
  if (canMove && keys.has(' ') && grounded && !wall) {
    player.vy = input.superJump ? JUMP * 1.9 : JUMP;
    input.superJump = false;
    grounded = false;
  }
  player.onGround = grounded;
  player.anim = player.climbing ? 'climb' : !grounded ? 'jump' : moving ? (sprinting ? 'sprint' : 'run') : 'idle';
  if (player.y < -5) spawnLocal(CITY.MAP_SIZE / 2, 0, CITY.MAP_SIZE / 2);
}

export function superJumpNow(): void {
  input.superJump = true;
  player.vy = JUMP * 1.9;
  player.onGround = false;
}

// ---------- Camera (third person, pulls in when a building is in the way) ----------
const eye = new THREE.Vector3();
const dir = new THREE.Vector3();
const fwd = new THREE.Vector3();
const look = new THREE.Vector3();
const camRay = new THREE.Raycaster();

export function updateCamera(): void {
  eye.set(player.x, player.y + 1.5, player.z);
  const dist = 7;
  dir.set(Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw) * Math.cos(player.pitch));
  let d = dist;
  camRay.set(eye, dir); camRay.near = 0.1; camRay.far = dist;
  const hits = camRay.intersectObjects(buildingMeshes, false);
  if (hits.length) d = Math.max(1.2, hits[0].distance - 0.3);
  camera.position.copy(eye).addScaledVector(dir, d);
  if (camera.position.y < 0.4) camera.position.y = 0.4;
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  look.copy(eye).addScaledVector(fwd, 3);
  look.y += 0.4 - Math.sin(player.pitch) * 2.5;
  camera.lookAt(look);
}

// ---------- Aiming ----------
const aimRc = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
export interface AimHit { key: string; dist: number; point: THREE.Vector3 }

/** Wall tile under the crosshair, if any. */
export function aimWallTile(): AimHit | null {
  aimRc.setFromCamera(center, camera);
  aimRc.far = 40;
  const hits = aimRc.intersectObjects(buildingMeshes, false);
  if (!hits.length || !hits[0].face) return null;
  const h = hits[0];
  const bi = h.object.userData.bi as number;
  const b = buildings[bi];
  const n = h.face!.normal;
  if (Math.abs(n.y) > 0.5) return null;
  const face: CITY.Face = n.x > 0.5 ? 0 : n.x < -0.5 ? 1 : n.z > 0.5 ? 2 : 3;
  const along = face < 2 ? h.point.z - b.z + b.d / 2 : h.point.x - b.x + b.w / 2;
  const i = Math.floor(along / CITY.TILE);
  const j = Math.floor(h.point.y / CITY.TILE);
  const info = CITY.faceInfo(b, face);
  if (i < 0 || j < 0 || i >= info.cols || j >= info.rows) return null;
  const dist = Math.hypot(h.point.x - player.x, h.point.y - (player.y + 1), h.point.z - player.z);
  return { key: CITY.tileKey(bi, face, i, j), dist, point: h.point };
}

export function aimDirection(): THREE.Vector3 {
  aimRc.setFromCamera(center, camera);
  return aimRc.ray.direction.clone();
}
