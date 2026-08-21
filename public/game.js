import * as THREE from 'three';

const C = window.CITY;
const socket = io();
const $ = (s) => document.querySelector(s);

// ---------- Net state ----------
let me = null; // my id
let cfg = null; // welcome payload
let state = { phase: 'lobby', players: [], timeLeft: 0, winner: null, pickups: [] };
const remote = new Map(); // id -> { group, parts, target }
let mySlot = 0;

// ---------- Three setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070812);
scene.fog = new THREE.Fog(0x070812, 40, 140);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Lights: moon + ambient + a few street lamps
scene.add(new THREE.HemisphereLight(0x4a5aa0, 0x221828, 1.0));
const moon = new THREE.DirectionalLight(0xbfd0ff, 1.1);
moon.position.set(60, 120, 40);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -120; moon.shadow.camera.right = 120;
moon.shadow.camera.top = 120; moon.shadow.camera.bottom = -120;
moon.shadow.camera.far = 400;
moon.target.position.set(C.MAP_SIZE / 2, 0, C.MAP_SIZE / 2);
scene.add(moon, moon.target);

// ---------- City ----------
const buildings = C.generateCity();
const buildingMeshes = [];
const matCache = {};
function buildingMaterial(b) {
  const key = `${b.kind}:${Math.round(b.hue * 8)}`;
  if (matCache[key]) return matCache[key];
  const base = new THREE.Color().setHSL(b.hue, 0.18, b.kind === 'tower' ? 0.22 : 0.3);
  // window texture
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, 64, 64);
  const rnd = () => Math.random();
  const cols = b.kind === 'house' ? 2 : 4, rows = b.kind === 'house' ? 2 : 4;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const lit = rnd() < 0.45;
    g.fillStyle = lit ? `hsl(${40 + rnd() * 20} 90% ${55 + rnd() * 20}%)` : '#0c0d16';
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
  const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
  const mat = buildingMaterial(b).clone();
  mat.map = mat.map.clone();
  mat.map.needsUpdate = true;
  mat.map.repeat.set(Math.max(1, Math.round(b.w / 6)), Math.max(1, Math.round(b.h / 4)));
  const mesh = new THREE.Mesh(geo, mat);
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
    // rooftop rim
    const rim = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, 0.4, b.d + 0.4), new THREE.MeshStandardMaterial({ color: 0x1a1a24 }));
    rim.position.set(b.x, b.h + 0.2, b.z);
    cityGroup.add(rim);
  }
});
scene.add(cityGroup);

// Ground, sidewalks, street markings
const ground = new THREE.Mesh(new THREE.PlaneGeometry(C.MAP_SIZE + 400, C.MAP_SIZE + 400), new THREE.MeshStandardMaterial({ color: 0x15141c, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(C.MAP_SIZE / 2, -0.01, C.MAP_SIZE / 2);
ground.receiveShadow = true;
scene.add(ground);
const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 1 });
const lineMat = new THREE.MeshBasicMaterial({ color: 0x8a8a6a });
for (let i = 0; i < C.BLOCKS; i++) for (let j = 0; j < C.BLOCKS; j++) {
  const sw = new THREE.Mesh(new THREE.BoxGeometry(C.BLOCK + 2, 0.2, C.BLOCK + 2), sidewalkMat);
  sw.position.set(C.STREET + i * C.CELL + C.BLOCK / 2, 0.1, C.STREET + j * C.CELL + C.BLOCK / 2);
  sw.receiveShadow = true;
  scene.add(sw);
}
for (let i = 0; i <= C.BLOCKS; i++) {
  const c = i * C.CELL + C.STREET / 2;
  const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, C.MAP_SIZE), lineMat);
  l1.rotation.x = -Math.PI / 2; l1.position.set(c, 0.01, C.MAP_SIZE / 2); scene.add(l1);
  const l2 = new THREE.Mesh(new THREE.PlaneGeometry(C.MAP_SIZE, 0.3), lineMat);
  l2.rotation.x = -Math.PI / 2; l2.position.set(C.MAP_SIZE / 2, 0.01, c); scene.add(l2);
}
// Street lamps at spawns (lights) and decorative poles at other intersections
const lampMat = new THREE.MeshStandardMaterial({ color: 0x444455 });
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
C.spawnPoints().forEach((s) => {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 6), lampMat);
  pole.position.set(s.x + 3.5, 3, s.z - 3.5); scene.add(pole);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35), bulbMat);
  bulb.position.set(s.x + 3.5, 6, s.z - 3.5); scene.add(bulb);
  const light = new THREE.PointLight(0xffc878, 30, 26, 1.6);
  light.position.copy(bulb.position); scene.add(light);
});
// Map boundary: neon fence
const fence = new THREE.Mesh(new THREE.BoxGeometry(C.MAP_SIZE, 3, C.MAP_SIZE), new THREE.MeshBasicMaterial({ color: 0xff2d75, wireframe: true, transparent: true, opacity: 0.25 }));
fence.position.set(C.MAP_SIZE / 2, 1.5, C.MAP_SIZE / 2);
scene.add(fence);

// ---------- Paint decals ----------
const paintMeshes = new Map();
const decalGeo = new THREE.PlaneGeometry(C.TILE * 1.15, C.TILE * 1.15);
const splatTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const blob = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.8})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  blob(64, 64, 46, 1);
  for (let i = 0; i < 14; i++) { const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 26; blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + Math.random() * 9, 0.9); }
  const t = new THREE.CanvasTexture(cv); return t;
})();
function setPaint(key, color) {
  const t = C.parseKey(key);
  if (!t) return;
  const b = buildings[t.bi];
  const c = C.tileCenter(b, t.face, t.i, t.j);
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
function clearPaint() {
  for (const m of paintMeshes.values()) scene.remove(m);
  paintMeshes.clear();
}

// ---------- Pickups ----------
const pickupMeshes = [];
const PICKUP_LOOK = {
  bazooka: { color: 0xff6a00, geo: new THREE.CylinderGeometry(0.25, 0.3, 1.6), label: 'BAZUCA' },
  vest: { color: 0x4d7cff, geo: new THREE.BoxGeometry(0.9, 1, 0.4), label: 'COLETE' },
  shoes: { color: 0xb4ff39, geo: new THREE.BoxGeometry(0.9, 0.4, 0.5), label: 'TÊNIS' },
  doublecan: { color: 0xff2d75, geo: new THREE.CylinderGeometry(0.3, 0.3, 0.9), label: 'LATA 2X' },
  medkit: { color: 0xff3b3b, geo: new THREE.BoxGeometry(0.8, 0.8, 0.8), label: 'KIT' }
};
function makeLabel(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.shadowColor = '#000'; g.shadowBlur = 8;
  g.fillText(text, 128, 32);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(4, 1, 1);
  return sp;
}
function buildPickups(list) {
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

// ---------- Characters (procedural, 12 distinct looks) ----------
const LOOKS = [
  { hat: 'cap', scale: 1, width: 1, skin: 0xc68642, back: false },
  { hat: 'beanie', scale: 1.15, width: 0.8, skin: 0xffdbac, back: false },
  { hat: 'none', scale: 0.85, width: 1.3, skin: 0x8d5524, back: true },
  { hat: 'mohawk', scale: 1, width: 1, skin: 0xf1c27d, back: false },
  { hat: 'hood', scale: 1.05, width: 1.1, skin: 0xe0ac69, back: false },
  { hat: 'bucket', scale: 0.95, width: 1, skin: 0x5c3a1e, back: true },
  { hat: 'afro', scale: 1, width: 1, skin: 0x3b2219, back: false },
  { hat: 'ponytail', scale: 1.05, width: 0.85, skin: 0xffdbac, back: false },
  { hat: 'helmet', scale: 1, width: 1.15, skin: 0xc68642, back: true },
  { hat: 'headphones', scale: 0.9, width: 1, skin: 0xf1c27d, back: false },
  { hat: 'bandana', scale: 1.1, width: 1, skin: 0x8d5524, back: false },
  { hat: 'antenna', scale: 1, width: 1, skin: 0x9aa0b0, back: true }
];
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(x, y, z); m.castShadow = true; return m;
}
function buildCharacter(slot, colorHex) {
  const L = LOOKS[slot % LOOKS.length];
  const team = new THREE.Color(colorHex);
  const dark = team.clone().multiplyScalar(0.35);
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const W = L.width;
  const legL = box(0.22 * W, 0.75, 0.25, 0x1f2230, -0.15 * W, 0.375, 0);
  const legR = box(0.22 * W, 0.75, 0.25, 0x1f2230, 0.15 * W, 0.375, 0);
  const torso = box(0.6 * W, 0.7, 0.35, team, 0, 1.1, 0);
  torso.material.emissive = team.clone().multiplyScalar(0.25);
  torso.userData.em = torso.material.emissive.clone();
  const armL = box(0.16, 0.65, 0.16, dark, -0.4 * W, 1.1, 0);
  const armR = box(0.16, 0.65, 0.16, dark, 0.4 * W, 1.1, 0);
  armL.geometry.translate(0, -0.25, 0); armR.geometry.translate(0, -0.25, 0);
  armL.position.y = armR.position.y = 1.35;
  legL.geometry.translate(0, -0.375, 0); legR.geometry.translate(0, -0.375, 0);
  legL.position.y = legR.position.y = 0.75;
  const head = L.hat === 'antenna'
    ? box(0.42, 0.42, 0.42, L.skin, 0, 1.7, 0)
    : new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: L.skin }));
  head.position.y = 1.7; head.castShadow = true;
  // eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045), eyeMat); e.position.set(s * 0.09, 1.74, -0.2); body.add(e); }
  // spray can in right hand
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26), new THREE.MeshStandardMaterial({ color: team, emissive: team, emissiveIntensity: 0.3 }));
  can.position.set(0, -0.55, -0.08); armR.add(can);
  // weapon (hidden until pistol mode)
  const gun = box(0.1, 0.12, 0.4, 0x2b2b33, 0, -0.5, -0.25); gun.visible = false; armR.add(gun);
  const bazooka = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.2), new THREE.MeshStandardMaterial({ color: 0xff6a00 }));
  bazooka.rotation.x = Math.PI / 2; bazooka.position.set(0.2, 1.55, -0.2); bazooka.visible = false;
  // hats
  const hat = new THREE.Group(); hat.position.y = 1.7;
  const hc = dark.clone().lerp(team, 0.5);
  switch (L.hat) {
    case 'cap': { hat.add(box(0.5, 0.14, 0.5, hc, 0, 0.2, 0)); hat.add(box(0.5, 0.05, 0.3, hc, 0, 0.14, 0.32)); break; }
    case 'beanie': { const b = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, 1.3), new THREE.MeshStandardMaterial({ color: hc })); b.position.y = 0.06; hat.add(b); break; }
    case 'mohawk': { hat.add(box(0.08, 0.32, 0.5, team, 0, 0.3, 0)); break; }
    case 'hood': { const h = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8, 0, Math.PI * 2, 0, 1.9), new THREE.MeshStandardMaterial({ color: hc })); h.position.y = -0.02; h.position.z = 0.05; hat.add(h); break; }
    case 'bucket': { hat.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.22, 10), new THREE.MeshStandardMaterial({ color: hc }))); hat.children[0].position.y = 0.18; break; }
    case 'afro': { const a = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshStandardMaterial({ color: 0x1b1210 })); a.position.y = 0.1; a.position.z = 0.04; hat.add(a); break; }
    case 'ponytail': { hat.add(box(0.48, 0.12, 0.48, 0x3a1f0c, 0, 0.2, 0)); hat.add(box(0.12, 0.55, 0.12, 0x3a1f0c, 0, -0.1, 0.32)); break; }
    case 'helmet': { const h = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, 1.6), new THREE.MeshStandardMaterial({ color: hc, metalness: 0.5, roughness: 0.3 })); hat.add(h); hat.add(box(0.5, 0.12, 0.1, 0x111111, 0, 0.03, -0.22)); break; }
    case 'headphones': { hat.add(box(0.6, 0.06, 0.08, 0x222222, 0, 0.22, 0)); for (const s of [-1, 1]) hat.add(box(0.1, 0.22, 0.22, team, s * 0.28, 0.02, 0)); break; }
    case 'bandana': { hat.add(box(0.5, 0.18, 0.5, team, 0, -0.08, 0)); break; }
    case 'antenna': { hat.add(box(0.04, 0.4, 0.04, 0x888888, 0, 0.4, 0)); const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: team })); ball.position.y = 0.62; hat.add(ball); break; }
  }
  if (L.back) body.add(box(0.45 * W, 0.5, 0.25, hc, 0, 1.15, 0.3));
  body.add(legL, legR, torso, armL, armR, head, hat, bazooka);
  body.scale.setScalar(L.scale);
  // name + hp sprite
  const tagCv = document.createElement('canvas'); tagCv.width = 256; tagCv.height = 64;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tagCv), transparent: true, depthTest: false }));
  tag.scale.set(3, 0.75, 1); tag.position.y = 2.35 * L.scale; g.add(tag);
  // shield bubble
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4d7cff, transparent: true, opacity: 0.25 }));
  bubble.position.y = 1; bubble.visible = false; g.add(bubble);
  return { group: g, parts: { body, legL, legR, armL, armR, can, gun, bazooka, tag, tagCv, bubble, torso }, t: Math.random() * 10 };
}
function updateTag(ch, p) {
  const g = ch.parts.tagCv.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.font = 'bold 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = p.color; g.shadowColor = '#000'; g.shadowBlur = 6;
  g.fillText(p.name, 128, 20);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(48, 42, 160, 12);
  g.fillStyle = '#ff3b3b'; g.fillRect(48, 42, 160 * Math.max(0, p.hp) / 100, 12);
  if (p.armor > 0) { g.fillStyle = '#4d7cff'; g.fillRect(48, 54, 160 * Math.min(1, p.armor / 100), 5); }
  ch.parts.tag.material.map.needsUpdate = true;
}
function animateCharacter(ch, anim, dt, painting) {
  const P = ch.parts;
  ch.t += dt;
  const t = ch.t;
  let swing = 0;
  if (anim === 'run') swing = Math.sin(t * 11) * 0.7;
  if (anim === 'climb') swing = Math.sin(t * 8) * 0.9;
  P.legL.rotation.x = swing; P.legR.rotation.x = -swing;
  if (anim === 'climb') { P.armL.rotation.x = -2.4 + swing * 0.4; P.armR.rotation.x = -2.4 - swing * 0.4; }
  else if (painting) { P.armL.rotation.x = -swing * 0.6; P.armR.rotation.x = -1.5 + Math.sin(t * 30) * 0.08; }
  else { P.armL.rotation.x = -swing; P.armR.rotation.x = swing; }
  if (anim === 'jump') { P.legL.rotation.x = 0.5; P.legR.rotation.x = -0.3; }
  P.body.position.y = anim === 'run' ? Math.abs(Math.sin(t * 11)) * 0.06 : 0;
}

// ---------- Local player ----------
const player = {
  x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0.3, onGround: true, climbing: false,
  anim: 'idle', tool: 'spray', dead: false, stunned: false
};
let myChar = null;
const keys = new Set();
let mouseDown = false;
let lastPaintAt = 0, lastPosSent = 0, dashUntil = 0, superJump = false;
const R = 0.45, H = 1.75;
const WALK = 7, SHOES = 10.5, DASH = 17;
const GRAVITY = 26, JUMP = 9, CLIMB = 4.5;

function spawnLocal(x, y, z) {
  player.x = x; player.y = y; player.z = z; player.vy = 0; player.climbing = false;
  player.yaw = Math.atan2(C.MAP_SIZE / 2 - x, C.MAP_SIZE / 2 - z) + Math.PI;
}

function myState() { return state.players.find((p) => p.id === me); }

function physics(dt) {
  const ms = myState();
  player.dead = !!ms?.dead;
  player.stunned = !!ms?.stunned;
  const canMove = state.phase === 'playing' && !player.dead && !player.stunned;
  const now = performance.now();
  let speed = WALK;
  if (ms?.shoes) speed = SHOES;
  if (now < dashUntil) speed = DASH;

  let ix = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
  let iz = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
  if (!canMove) ix = iz = 0;
  const len = Math.hypot(ix, iz) || 1;
  ix /= len; iz /= len;
  // camera-relative
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const mx = (ix * cos + iz * sin) * speed * dt;
  const mz = (-ix * sin + iz * cos) * speed * dt;
  const moving = ix !== 0 || iz !== 0;

  // Horizontal move + resolve against buildings (solid only while below roof)
  player.x += mx; player.z += mz;
  let wall = null;
  for (const b of buildings) {
    if (player.y >= b.h - 0.05) continue; // on/above roof level
    const minX = b.x - b.w / 2 - R, maxX = b.x + b.w / 2 + R;
    const minZ = b.z - b.d / 2 - R, maxZ = b.z + b.d / 2 + R;
    if (player.x <= minX || player.x >= maxX || player.z <= minZ || player.z >= maxZ) continue;
    const px = Math.min(player.x - minX, maxX - player.x);
    const pz = Math.min(player.z - minZ, maxZ - player.z);
    if (px < pz) { player.x = player.x - minX < maxX - player.x ? minX : maxX; wall = b; }
    else { player.z = player.z - minZ < maxZ - player.z ? minZ : maxZ; wall = b; }
  }
  player.x = Math.max(R, Math.min(C.MAP_SIZE - R, player.x));
  player.z = Math.max(R, Math.min(C.MAP_SIZE - R, player.z));

  // Climb: touching a wall + holding space (or pushing into it while airborne)
  const wantClimb = wall && canMove && (keys.has(' ') || (moving && !player.onGround));
  if (wantClimb) {
    player.climbing = true;
    player.vy = CLIMB * (ms?.shoes ? 1.4 : 1);
    // mantle
    if (player.y >= wall.h - 0.4) { player.y = wall.h; player.vy = 2; player.climbing = false; }
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
  // Jump
  if (canMove && keys.has(' ') && grounded && !wall) {
    player.vy = superJump ? JUMP * 1.9 : JUMP;
    superJump = false;
    grounded = false;
  }
  player.onGround = grounded;

  player.anim = player.climbing ? 'climb' : !grounded ? 'jump' : moving ? 'run' : 'idle';
  if (player.y < -5) spawnLocal(C.MAP_SIZE / 2, 0, C.MAP_SIZE / 2);
}

// ---------- Camera ----------
function updateCamera() {
  const eye = new THREE.Vector3(player.x, player.y + 1.5, player.z);
  const dist = 7;
  // pitch > 0 looks down (camera above); pitch < 0 looks up
  const dir = new THREE.Vector3(
    Math.sin(player.yaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    Math.cos(player.yaw) * Math.cos(player.pitch)
  );
  let d = dist;
  const ray = new THREE.Raycaster(eye, dir.clone(), 0.1, dist);
  const hits = ray.intersectObjects(buildingMeshes, false);
  if (hits.length) d = Math.max(1.2, hits[0].distance - 0.3);
  camera.position.copy(eye).addScaledVector(dir, d);
  if (camera.position.y < 0.4) camera.position.y = 0.4;
  // look slightly ahead of the player so the crosshair sits in front of them
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  camera.lookAt(eye.clone().addScaledVector(fwd, 3).add(new THREE.Vector3(0, 0.4 - Math.sin(player.pitch) * 2.5, 0)));
}

// ---------- Aim / paint / shoot ----------
const raycaster = new THREE.Raycaster();
function aimRay() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  return raycaster;
}
function aimWallTile() {
  const rc = aimRay();
  rc.far = 40;
  const hits = rc.intersectObjects(buildingMeshes, false);
  if (!hits.length) return null;
  const h = hits[0];
  const b = buildings[h.object.userData.bi];
  const n = h.face.normal; // local normal == world (no rotation)
  if (Math.abs(n.y) > 0.5) return null; // roof/floor
  const face = n.x > 0.5 ? 0 : n.x < -0.5 ? 1 : n.z > 0.5 ? 2 : 3;
  const along = face < 2 ? h.point.z - b.z + b.d / 2 : h.point.x - b.x + b.w / 2;
  const i = Math.floor(along / C.TILE);
  const j = Math.floor(h.point.y / C.TILE);
  const info = C.faceInfo(b, face);
  if (i < 0 || j < 0 || i >= info.cols || j >= info.rows) return null;
  const dist = Math.hypot(h.point.x - player.x, h.point.y - (player.y + 1), h.point.z - player.z);
  return { key: C.tileKey(h.object.userData.bi, face, i, j), dist, point: h.point };
}
function tryPaint(now) {
  const t = aimWallTile();
  $('#cross').classList.toggle('can', !!t && t.dist <= 4.5);
  if (!mouseDown || !t || t.dist > 4.5 || now - lastPaintAt < 120) return;
  lastPaintAt = now;
  socket.emit('paint', t.key);
}
function shoot() {
  const rc = aimRay();
  const o = rc.ray.origin, d = rc.ray.direction;
  // origin from player's eye to keep server validation happy
  socket.emit('shoot', { ox: player.x, oy: player.y + 1.4, oz: player.z, dx: d.x, dy: d.y, dz: d.z });
  const hits = rc.intersectObjects(buildingMeshes, false);
  void o; void hits;
}

// ---------- Effects ----------
const effects = [];
function tracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  scene.add(line);
  effects.push({ obj: line, until: performance.now() + 120, fade: true });
}
function burst(pos, color, size = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  m.position.copy(pos); scene.add(m);
  effects.push({ obj: m, until: performance.now() + 250, grow: true });
}
function updateEffects(now) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (now > e.until) { scene.remove(e.obj); effects.splice(i, 1); continue; }
    if (e.grow) e.obj.scale.multiplyScalar(1.12);
    if (e.fade) e.obj.material.opacity *= 0.85;
  }
}
function toast(text, color = '#fff') {
  const t = $('#toast'); t.textContent = text; t.style.color = color; t.style.opacity = 1;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.opacity = 0), 1600);
}

// ---------- Input ----------
const canvas = renderer.domElement;
canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0025;
  player.pitch = Math.max(-0.6, Math.min(1.25, player.pitch + e.movementY * 0.0025));
});
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas || e.button !== 0) return;
  mouseDown = true;
  if (player.tool === 'gun' && state.phase === 'playing' && !player.dead && !player.stunned) shoot();
});
addEventListener('mouseup', () => { mouseDown = false; });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', ' '].includes(k)) { keys.add(k); e.preventDefault(); }
  if (k === 'arrowup') keys.add('w'); if (k === 'arrowdown') keys.add('s');
  if (k === 'arrowleft') keys.add('a'); if (k === 'arrowright') keys.add('d');
  if (k === '1') setTool('spray');
  if (k === '2') setTool('gun');
  if (k === 'f' && !e.repeat) socket.emit('melee');
  if (k === 'q' && !e.repeat) socket.emit('power');
  if (k === 'tab') { e.preventDefault(); $('#board').classList.add('full'); }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === 'arrowup') keys.delete('w'); if (k === 'arrowdown') keys.delete('s');
  if (k === 'arrowleft') keys.delete('a'); if (k === 'arrowright') keys.delete('d');
  if (k === 'tab') $('#board').classList.remove('full');
});
addEventListener('blur', () => keys.clear());
addEventListener('wheel', (e) => setTool(e.deltaY > 0 ? (player.tool === 'spray' ? 'gun' : 'spray') : (player.tool === 'gun' ? 'spray' : 'gun')));
function setTool(t) { player.tool = t; updateHud(); }
$('#restart').addEventListener('click', () => socket.emit('restart'));
let iAmReady = false;
$('#ready').addEventListener('click', () => {
  iAmReady = !iAmReady;
  if ($('#lobbyName').value.trim()) socket.emit('rename', $('#lobbyName').value);
  socket.emit('ready', iAmReady);
  $('#ready').classList.toggle('on', iAmReady);
  $('#ready').textContent = iAmReady ? 'Pronto ✓ (cancelar)' : 'Pronto!';
});
for (const sel of ['#name', '#lobbyName']) {
  $(sel).addEventListener('change', () => { socket.emit('rename', $(sel).value); $('#name').value = $('#lobbyName').value = $(sel).value; });
  $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
}

// ---------- Socket ----------
socket.on('welcome', (w) => {
  cfg = w; me = w.id; mySlot = w.slot;
  buildPickups(w.pickups);
  for (const [key, slot] of w.paint) setPaint(key, w.colors[slot] || '#888');
  const s = C.spawnPoints()[w.slot % 12];
  spawnLocal(s.x, 0, s.z);
  $('#power').textContent = POWER_LABEL[w.power];
});
socket.on('full', () => { $('#ovTitle').textContent = 'Muro lotado'; $('#ovText').textContent = 'Máximo de 12 pichadores.'; });
socket.on('disconnect', () => { $('#overlay').classList.remove('hidden'); $('#ovTitle').textContent = 'Desconectado'; $('#ovText').textContent = 'Recarregue a página.'; });
socket.on('reset', () => { clearPaint(); iAmReady = false; $('#ready').classList.remove('on'); $('#ready').textContent = 'Pronto!'; const s = C.spawnPoints()[mySlot % 12]; spawnLocal(s.x, 0, s.z); });
socket.on('respawned', (d) => { if (d.id === me) spawnLocal(d.x, d.y, d.z); });
socket.on('painted', (d) => {
  setPaint(d.key, d.color);
  if (d.by === me) { const t = C.parseKey(d.key); const c = C.tileCenter(buildings[t.bi], t.face, t.i, t.j); burst(new THREE.Vector3(c.x, c.y, c.z), d.color, 0.4); }
});
socket.on('shot', (d) => {
  const from = new THREE.Vector3(d.ox, d.oy, d.oz), to = new THREE.Vector3(d.hx, d.hy, d.hz);
  const p = state.players.find((x) => x.id === d.by);
  tracer(from, to, p?.color || '#fff');
  if (d.weapon === 'bazooka') burst(to, '#ff6a00', 1.5); else if (d.hit) burst(to, p?.color || '#fff', 0.3);
});
socket.on('hit', (d) => {
  if (d.victim === me) { player.x += d.fx * 1.5; player.z += d.fz * 1.5; player.vy = 4; }
  const v = state.players.find((x) => x.id === d.victim);
  if (v) burst(new THREE.Vector3(v.x, v.y + 1, v.z), '#ffffff', 0.6);
});
socket.on('damaged', (d) => { if (d.id === me) flashDamage(); });
socket.on('killed', (d) => {
  if (d.id === me) toast(`💀 ${d.byName || 'A noite'} te derrubou  (-${d.loss})`, '#ff3b3b');
  else if (d.by === me) toast(`🔥 Você derrubou ${d.name}`, '#b4ff39');
  const icon = { pistol: '🔫', bazooka: '🚀', melee: '👊' }[d.weapon] || '💀';
  const el = document.createElement('div');
  el.className = 'kill';
  el.innerHTML = `<span style="color:${d.byColor || '#fff'}">${esc(d.byName || 'A noite')}</span> ${icon} <span style="color:${d.color}">${esc(d.name)}</span>`;
  $('#feed').prepend(el);
  while ($('#feed').children.length > 5) $('#feed').lastChild.remove();
  setTimeout(() => el.remove(), 6000);
});
socket.on('pickup', (d) => {
  if (d.by === me) toast({ bazooka: '🚀 Bazuca de tinta!', vest: '🦺 Colete +50', shoes: '👟 Tênis turbo', doublecan: '🎨 Lata 2x pontos', medkit: '➕ Vida +60' }[d.type]);
});
socket.on('power', (d) => {
  if (d.id !== me) return;
  if (d.name === 'dash') dashUntil = performance.now() + d.duration;
  if (d.name === 'jump') { superJump = true; player.vy = JUMP * 1.9; player.onGround = false; }
  toast({ dash: '💨 Disparada!', shield: '🛡️ Escudo!', jump: '🦘 Super pulo!', smoke: '🌫️ Fumaça!' }[d.name]);
});
socket.on('state', (s) => { state = s; updateHud(); });

const POWER_LABEL = { dash: 'Q: Disparada', shield: 'Q: Escudo', jump: 'Q: Super pulo', smoke: 'Q: Fumaça' };
let dmgFlashUntil = 0;
function flashDamage() { dmgFlashUntil = performance.now() + 150; }

// ---------- HUD ----------
function fmt(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function esc(t) { return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function updateHud() {
  const ms = myState();
  const board = $('#board');
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  board.innerHTML = sorted.map((p) => `<span class="chip${p.id === me ? ' me' : ''}${p.dead ? ' dead' : ''}"><i style="background:${p.color}"></i>${esc(p.name)}<b>${p.score}</b></span>`).join('');
  $('#timer').textContent = state.phase === 'playing' ? '🌙 ' + fmt(state.timeLeft) : state.phase === 'countdown' ? 'Chacoalha a lata' : '--';
  if (ms) {
    $('#hp i').style.width = `${ms.hp}%`;
    $('#armor i').style.width = `${ms.armor}%`;
    $('#hpText').textContent = `${ms.hp}${ms.armor ? ` +${ms.armor}🦺` : ''}`;
    const wName = ms.weapon === 'bazooka' ? `🚀 Bazuca (${ms.ammo})` : '🔫 Pistola de tinta';
    $('#tool').innerHTML = `<span class="${player.tool === 'spray' ? 'on' : ''}">1 🎨 Spray</span><span class="${player.tool === 'gun' ? 'on' : ''}">2 ${wName}</span>`;
    $('#power').style.opacity = ms.powerReadyIn > 0 ? 0.4 : 1;
    $('#power').textContent = ms.powerReadyIn > 0 ? `${POWER_LABEL[cfg?.power]} (${Math.ceil(ms.powerReadyIn / 1000)}s)` : POWER_LABEL[cfg?.power];
    $('#push i').style.width = `${100 - ms.meleeReadyIn / 12}%`;
    $('#stun').classList.toggle('on', ms.stunned);
    $('#buffs').textContent = [ms.shoes && '👟', ms.double && '🎨2x', ms.shield && '🛡️', ms.smoke && '🌫️'].filter(Boolean).join(' ');
  }
  const ov = $('#overlay');
  $('#lobby').style.display = state.phase === 'lobby' ? 'block' : 'none';
  if (state.phase === 'lobby') {
    ov.classList.remove('hidden');
    $('#ovTitle').textContent = 'Lobby da crew';
    const readyCount = state.players.filter((p) => p.ready).length;
    $('#ovText').textContent = `${state.players.length} na rua · ${readyCount} prontos — compartilhe o link`;
    $('#lobbyList').innerHTML = state.players.map((p) => `<li class="${p.ready ? 'ok' : ''}"><i style="background:${p.color}"></i>${esc(p.name)}${p.id === me ? ' (você)' : ''}<b>${p.ready ? 'PRONTO' : 'esperando'}</b></li>`).join('');
    const min = cfg?.minPlayers ?? 2;
    $('#lobbyHint').textContent = state.players.length < min ? `Precisa de pelo menos ${min} jogadores.` : readyCount < state.players.length ? 'A noite começa quando todos estiverem prontos.' : 'Começando…';
    $('#restart').style.display = 'none';
    if (ms && ms.ready !== iAmReady) { iAmReady = ms.ready; $('#ready').classList.toggle('on', iAmReady); $('#ready').textContent = iAmReady ? 'Pronto ✓ (cancelar)' : 'Pronto!'; }
  } else if (state.phase === 'countdown') {
    ov.classList.remove('hidden');
    $('#ovTitle').innerHTML = `<span class="big">${state.timeLeft}</span>`;
    $('#ovText').textContent = 'Piche paredes altas (valem mais), escale prédios, derrube rivais.';
    $('#restart').style.display = 'none';
  } else if (state.phase === 'ended') {
    ov.classList.remove('hidden');
    const w = state.winner;
    $('#ovTitle').innerHTML = w && w.name !== 'Empate' ? `🏆 <span style="color:${w.color}">${esc(w.name)}</span> dominou a cidade!` : '🤝 Empate!';
    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    $('#ovText').innerHTML = ranked.map((p, i) => `${i + 1}. <span style="color:${p.color}">${esc(p.name)}</span> — ${p.score} pts · ${p.tiles} tiles · ${p.kills} kills`).join('<br>');
    $('#restart').style.display = 'inline-block';
    document.exitPointerLock?.();
  } else if (ms?.dead) {
    ov.classList.remove('hidden');
    $('#ovTitle').innerHTML = `💀 Derrubado`;
    $('#ovText').textContent = `Voltando em ${Math.ceil(ms.respawnIn / 1000)}s…`;
    $('#restart').style.display = 'none';
  } else {
    ov.classList.add('hidden');
  }
}

// ---------- Main loop ----------
// Simulation runs on a timer (keeps working in background tabs); rendering on rAF.
let lastSim = performance.now();
const STEP = 1 / 60;
setInterval(() => {
  const now = performance.now();
  let acc = Math.min((now - lastSim) / 1000, 2); // catch up to 2s when throttled
  lastSim = now;
  if (!cfg) return;
  while (acc >= STEP) { physics(STEP); acc -= STEP; }
  if (now - lastPosSent > 50) {
    lastPosSent = now;
    socket.emit('pos', { x: player.x, y: player.y, z: player.z, rot: player.yaw, anim: mouseDown && player.tool === 'spray' ? 'paint' : player.anim });
  }
}, 16);

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (cfg) {
    updateCamera();
    if (player.tool === 'spray' && state.phase === 'playing' && !player.dead && !player.stunned) tryPaint(now);
    else $('#cross').classList.remove('can');
  }
  // characters
  const seen = new Set();
  for (const p of state.players) {
    seen.add(p.id);
    let ch = remote.get(p.id);
    if (!ch) { ch = buildCharacter(p.slot, p.color); scene.add(ch.group); remote.set(p.id, ch); if (p.id === me) myChar = ch; }
    const isMe = p.id === me;
    const tx = isMe ? player.x : p.x, ty = isMe ? player.y : p.y, tz = isMe ? player.z : p.z;
    const k = isMe ? 1 : Math.min(1, dt * 12);
    ch.group.position.lerp(new THREE.Vector3(tx, ty, tz), k);
    const rot = isMe ? player.yaw : p.rot;
    let dr = rot - ch.group.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    ch.group.rotation.y += dr * (isMe ? 1 : Math.min(1, dt * 12));
    const anim = isMe ? player.anim : p.anim === 'paint' ? 'idle' : p.anim;
    animateCharacter(ch, anim, dt, isMe ? mouseDown && player.tool === 'spray' : p.anim === 'paint');
    ch.group.visible = !p.dead;
    ch.parts.bubble.visible = p.shield;
    const gunMode = isMe ? player.tool === 'gun' : p.anim !== 'paint';
    ch.parts.gun.visible = gunMode && p.weapon === 'pistol';
    ch.parts.bazooka.visible = gunMode && p.weapon === 'bazooka';
    ch.parts.can.visible = !gunMode;
    const op = p.smoke ? (isMe ? 0.35 : 0.08) : 1;
    if (ch.lastOp !== op) {
      ch.lastOp = op;
      ch.group.traverse((o) => { if (o.material && o !== ch.parts.bubble && !o.isSprite) { o.material.transparent = op < 1; o.material.opacity = op; } });
    }
    ch.parts.tag.visible = !p.smoke || isMe;
    if (!ch.lastTag || now - ch.lastTag > 200) { ch.lastTag = now; updateTag(ch, p); }
    ch.parts.torso.material.emissive.copy(p.stunned ? new THREE.Color(0x888888) : ch.parts.torso.userData.em);
  }
  for (const [id, ch] of remote) if (!seen.has(id)) { scene.remove(ch.group); remote.delete(id); }
  // pickups
  state.pickups?.forEach((on, i) => { const g = pickupMeshes[i]; if (!g) return; g.visible = !!on; g.rotation.y += dt * 1.5; g.children[0].position.y = Math.sin(now / 300 + i) * 0.15; });
  updateEffects(now);
  $('#dmg').style.opacity = now < dmgFlashUntil ? 1 : 0;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle (harmless in production)
window.DBG = { player, camera, scene, remote, state: () => state, buildings, keys, socket, setTool, buildCharacter, THREE };
