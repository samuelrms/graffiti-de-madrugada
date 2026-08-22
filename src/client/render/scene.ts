// Three.js scene: renderer, lights, procedural city, paint decals, pickups.
import * as THREE from 'three';
import * as CITY from '../../shared/city.ts';
import type { Building, PickupType } from '../../shared/city.ts';
import type { PickupInfo } from '../../shared/protocol.ts';
import { buildings } from '../core/state.ts';

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070812);
scene.fog = new THREE.Fog(0x070812, 40, 140);

export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- Lights: moon + hemisphere + street lamps ----------
scene.add(new THREE.HemisphereLight(0x4a5aa0, 0x221828, 1.0));
const moon = new THREE.DirectionalLight(0xbfd0ff, 1.1);
moon.position.set(60, 120, 40);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -120; moon.shadow.camera.right = 120;
moon.shadow.camera.top = 120; moon.shadow.camera.bottom = -120;
moon.shadow.camera.far = 400;
moon.target.position.set(CITY.MAP_SIZE / 2, 0, CITY.MAP_SIZE / 2);
scene.add(moon, moon.target);

// ---------- City ----------
export const buildingMeshes: THREE.Mesh[] = [];
const matCache: Record<string, THREE.MeshStandardMaterial> = {};

function buildingMaterial(b: Building): THREE.MeshStandardMaterial {
  const key = `${b.kind}:${Math.round(b.hue * 8)}`;
  if (matCache[key]) return matCache[key];
  const base = new THREE.Color().setHSL(b.hue, 0.18, b.kind === 'tower' ? 0.22 : 0.3);
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, 64, 64);
  const cols = b.kind === 'house' ? 2 : 4, rows = b.kind === 'house' ? 2 : 4;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const lit = Math.random() < 0.45;
    g.fillStyle = lit ? `hsl(${40 + Math.random() * 20} 90% ${55 + Math.random() * 20}%)` : '#0c0d16';
    g.fillRect(6 + i * (52 / cols), 6 + j * (52 / rows), 52 / cols - 6, 52 / rows - 6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.05 });
  matCache[key] = m;
  return m;
}

const cityGroup = new THREE.Group();
buildings.forEach((b, bi) => {
  const mat = buildingMaterial(b).clone();
  mat.map = mat.map!.clone();
  mat.map.needsUpdate = true;
  mat.map.repeat.set(Math.max(1, Math.round(b.w / 6)), Math.max(1, Math.round(b.h / 4)));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
  mesh.position.set(b.x, b.h / 2, b.z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.bi = bi;
  cityGroup.add(mesh);
  buildingMeshes.push(mesh);
  if (b.kind === 'house') {
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.72, 2.2, 4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(b.hue, 0.5, 0.28), roughness: 1 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(b.x, b.h + 1.1, b.z);
    roof.castShadow = true;
    cityGroup.add(roof);
  } else {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, 0.4, b.d + 0.4), new THREE.MeshStandardMaterial({ color: 0x1a1a24 }));
    rim.position.set(b.x, b.h + 0.2, b.z);
    cityGroup.add(rim);
  }
});
scene.add(cityGroup);

// Ground, sidewalks, street markings
const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY.MAP_SIZE + 400, CITY.MAP_SIZE + 400), new THREE.MeshStandardMaterial({ color: 0x15141c, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(CITY.MAP_SIZE / 2, -0.01, CITY.MAP_SIZE / 2);
ground.receiveShadow = true;
scene.add(ground);
const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 1 });
const lineMat = new THREE.MeshBasicMaterial({ color: 0x8a8a6a });
for (let i = 0; i < CITY.BLOCKS; i++) for (let j = 0; j < CITY.BLOCKS; j++) {
  const sw = new THREE.Mesh(new THREE.BoxGeometry(CITY.BLOCK + 2, 0.2, CITY.BLOCK + 2), sidewalkMat);
  sw.position.set(CITY.STREET + i * CITY.CELL + CITY.BLOCK / 2, 0.1, CITY.STREET + j * CITY.CELL + CITY.BLOCK / 2);
  sw.receiveShadow = true;
  scene.add(sw);
}
for (let i = 0; i <= CITY.BLOCKS; i++) {
  const c = i * CITY.CELL + CITY.STREET / 2;
  const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, CITY.MAP_SIZE), lineMat);
  l1.rotation.x = -Math.PI / 2; l1.position.set(c, 0.01, CITY.MAP_SIZE / 2); scene.add(l1);
  const l2 = new THREE.Mesh(new THREE.PlaneGeometry(CITY.MAP_SIZE, 0.3), lineMat);
  l2.rotation.x = -Math.PI / 2; l2.position.set(CITY.MAP_SIZE / 2, 0.01, c); scene.add(l2);
}
// Street lamps next to every spawn (off to the side so they never block the camera)
const lampMat = new THREE.MeshStandardMaterial({ color: 0x444455 });
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
CITY.spawnPoints().forEach((s) => {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 6), lampMat);
  pole.position.set(s.x - 4.5, 3, s.z + 4.5); scene.add(pole);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35), bulbMat);
  bulb.position.set(s.x - 4.5, 6, s.z + 4.5); scene.add(bulb);
  const light = new THREE.PointLight(0xffc878, 30, 26, 1.6);
  light.position.copy(bulb.position); scene.add(light);
});
// Map boundary: neon fence
const fence = new THREE.Mesh(new THREE.BoxGeometry(CITY.MAP_SIZE, 3, CITY.MAP_SIZE), new THREE.MeshBasicMaterial({ color: 0xff2d75, wireframe: true, transparent: true, opacity: 0.25 }));
fence.position.set(CITY.MAP_SIZE / 2, 1.5, CITY.MAP_SIZE / 2);
scene.add(fence);

// ---------- Paint decals ----------
const paintMeshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
const decalGeo = new THREE.PlaneGeometry(CITY.TILE * 1.15, CITY.TILE * 1.15);
const splatTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const blob = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.8})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  blob(64, 64, 46, 1);
  for (let i = 0; i < 14; i++) { const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 26; blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + Math.random() * 9, 0.9); }
  return new THREE.CanvasTexture(cv);
})();

export function setPaint(key: string, color: string): void {
  const t = CITY.parseKey(key);
  if (!t) return;
  const b = buildings[t.bi];
  if (!b) return;
  const c = CITY.tileCenter(b, t.face, t.i, t.j);
  let m = paintMeshes.get(key);
  if (!m) {
    m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ color, map: splatTex, transparent: true, opacity: 0.95, depthWrite: false }));
    m.position.set(c.x + c.nx * 0.04, c.y, c.z + c.nz * 0.04);
    m.lookAt(c.x + c.nx, c.y, c.z + c.nz);
    m.rotateZ(Math.random() * Math.PI * 2);
    scene.add(m);
    paintMeshes.set(key, m);
  } else {
    m.material.color.set(color);
  }
}
export function clearPaint(): void {
  for (const m of paintMeshes.values()) scene.remove(m);
  paintMeshes.clear();
}

// ---------- Pickups ----------
export const pickupMeshes: THREE.Group[] = [];
const PICKUP_LOOK: Record<PickupType, { color: number; geo: THREE.BufferGeometry; label: string }> = {
  bazooka: { color: 0xff6a00, geo: new THREE.CylinderGeometry(0.25, 0.3, 1.6), label: 'BAZUCA' },
  vest: { color: 0x4d7cff, geo: new THREE.BoxGeometry(0.9, 1, 0.4), label: 'COLETE' },
  shoes: { color: 0xb4ff39, geo: new THREE.BoxGeometry(0.9, 0.4, 0.5), label: 'TÊNIS' },
  doublecan: { color: 0xff2d75, geo: new THREE.CylinderGeometry(0.3, 0.3, 0.9), label: 'LATA 2X' },
  medkit: { color: 0xff3b3b, geo: new THREE.BoxGeometry(0.8, 0.8, 0.8), label: 'KIT' }
};
function makeLabel(text: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.shadowColor = '#000'; g.shadowBlur = 8;
  g.fillText(text, 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(4, 1, 1);
  return sp;
}
export function buildPickups(list: PickupInfo[]): void {
  list.forEach((pk) => {
    const look = PICKUP_LOOK[pk.type];
    const g = new THREE.Group();
    const m = new THREE.Mesh(look.geo, new THREE.MeshStandardMaterial({ color: look.color, emissive: look.color, emissiveIntensity: 0.6 }));
    if (pk.type === 'bazooka') m.rotation.z = Math.PI / 2;
    g.add(m);
    const lbl = makeLabel(look.label, `#${look.color.toString(16).padStart(6, '0')}`);
    lbl.position.y = 1.6; g.add(lbl);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 24), new THREE.MeshBasicMaterial({ color: look.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = -0.85; g.add(glow);
    g.position.set(pk.x, pk.y + 1, pk.z);
    scene.add(g);
    pickupMeshes[pk.id] = g;
  });
}

// ---------- Transient effects ----------
interface Effect { obj: THREE.Object3D & { material?: THREE.Material & { opacity: number } }; until: number; grow?: boolean; fade?: boolean }
const effects: Effect[] = [];
export function tracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation): void {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  scene.add(line);
  effects.push({ obj: line, until: performance.now() + 120, fade: true });
}
export function burst(pos: THREE.Vector3, color: THREE.ColorRepresentation, size = 1): void {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  m.position.copy(pos); scene.add(m);
  effects.push({ obj: m, until: performance.now() + 250, grow: true });
}
export function updateEffects(now: number, frozen: boolean): void {
  if (frozen) return;
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (now > e.until) { scene.remove(e.obj); effects.splice(i, 1); continue; }
    if (e.grow) e.obj.scale.multiplyScalar(1.12);
    if (e.fade && e.obj.material) e.obj.material.opacity *= 0.85;
  }
}
