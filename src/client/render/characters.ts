// Procedural characters v2: jointed bodies (hips, knees, shoulders, elbows),
// capsule limbs, faces, sneakers, jackets and 12 distinct looks. Cel-shaded with
// a 3-step toon ramp plus an inverted-hull outline on the big parts. Everything
// is built from primitives — no external assets.
import * as THREE from 'three';
import type { Anim, PlayerSnapshot } from '../../shared/protocol.ts';

type Hat = 'cap' | 'beanie' | 'none' | 'mohawk' | 'hood' | 'bucket' | 'afro' | 'ponytail' | 'helmet' | 'headphones' | 'bandana' | 'antenna';
type Mouth = 'smile' | 'grin' | 'flat' | 'o';
type Jacket = 'hoodie' | 'vest' | 'open' | 'tee';
interface Look { hat: Hat; scale: number; width: number; skin: number; hair: number; back: boolean; mouth: Mouth; jacket: Jacket; pants: number; shoes: number }

export const LOOKS: Look[] = [
  { hat: 'cap', scale: 1, width: 1, skin: 0xc68642, hair: 0x2b1a10, back: false, mouth: 'grin', jacket: 'open', pants: 0x1f2230, shoes: 0xf1f1f1 },
  { hat: 'beanie', scale: 1.15, width: 0.82, skin: 0xffdbac, hair: 0x5a3a1e, back: false, mouth: 'smile', jacket: 'hoodie', pants: 0x2a2a3a, shoes: 0x222222 },
  { hat: 'none', scale: 0.86, width: 1.3, skin: 0x8d5524, hair: 0x120a06, back: true, mouth: 'flat', jacket: 'vest', pants: 0x3a3128, shoes: 0xffffff },
  { hat: 'mohawk', scale: 1, width: 1, skin: 0xf1c27d, hair: 0x111111, back: false, mouth: 'grin', jacket: 'tee', pants: 0x101018, shoes: 0xff3b3b },
  { hat: 'hood', scale: 1.05, width: 1.1, skin: 0xe0ac69, hair: 0x3a2414, back: false, mouth: 'flat', jacket: 'hoodie', pants: 0x1f2230, shoes: 0x222222 },
  { hat: 'bucket', scale: 0.95, width: 1, skin: 0x5c3a1e, hair: 0x0b0704, back: true, mouth: 'smile', jacket: 'open', pants: 0x4a3b2a, shoes: 0xf1f1f1 },
  { hat: 'afro', scale: 1, width: 1, skin: 0x3b2219, hair: 0x1b1210, back: false, mouth: 'grin', jacket: 'tee', pants: 0x2a2a3a, shoes: 0xffe600 },
  { hat: 'ponytail', scale: 1.05, width: 0.85, skin: 0xffdbac, hair: 0x3a1f0c, back: false, mouth: 'smile', jacket: 'open', pants: 0x101018, shoes: 0xff4dff },
  { hat: 'helmet', scale: 1, width: 1.15, skin: 0xc68642, hair: 0x2b1a10, back: true, mouth: 'o', jacket: 'vest', pants: 0x1f2230, shoes: 0x222222 },
  { hat: 'headphones', scale: 0.9, width: 1, skin: 0xf1c27d, hair: 0x8a5a2a, back: false, mouth: 'smile', jacket: 'hoodie', pants: 0x3a3128, shoes: 0x00e5ff },
  { hat: 'bandana', scale: 1.1, width: 1, skin: 0x8d5524, hair: 0x120a06, back: false, mouth: 'flat', jacket: 'tee', pants: 0x2a2a3a, shoes: 0xf1f1f1 },
  { hat: 'antenna', scale: 1, width: 1, skin: 0x9aa0b0, hair: 0x9aa0b0, back: true, mouth: 'o', jacket: 'vest', pants: 0x30343f, shoes: 0xb4ff39 }
];

// ---------- Toon materials ----------
const toonRamp = (() => {
  const data = new Uint8Array([70, 150, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0a12, side: THREE.BackSide });

type ToonMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;

function toon(color: THREE.ColorRepresentation, emissive = 0): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, emissive, emissiveIntensity: 0.5 });
}

/** Mesh with an optional inverted-hull outline as a child (cheap cel outline). */
function part(geo: THREE.BufferGeometry, mat: THREE.MeshToonMaterial, outline = 0): ToonMesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  if (outline > 0) {
    const o = new THREE.Mesh(geo, outlineMat);
    o.scale.setScalar(outline);
    o.userData.outline = true;
    m.add(o);
  }
  return m;
}

/** Capsule along -y starting at the origin (so a joint group can rotate it). */
function limb(radius: number, length: number, mat: THREE.MeshToonMaterial, outline = 1.12): ToonMesh {
  const geo = new THREE.CapsuleGeometry(radius, length, 4, 10);
  geo.translate(0, -length / 2, 0);
  return part(geo, mat, outline);
}

function box(w: number, h: number, d: number, mat: THREE.MeshToonMaterial, x = 0, y = 0, z = 0, outline = 0): ToonMesh {
  const m = part(new THREE.BoxGeometry(w, h, d, 1, 1, 1), mat, outline);
  m.position.set(x, y, z);
  return m;
}
function sphere(r: number, mat: THREE.MeshToonMaterial, x = 0, y = 0, z = 0, outline = 0): ToonMesh {
  const m = part(new THREE.SphereGeometry(r, 14, 12), mat, outline);
  m.position.set(x, y, z);
  return m;
}

export interface Character {
  group: THREE.Group;
  parts: {
    body: THREE.Group;
    hipL: THREE.Group; hipR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group;
    shoulderL: THREE.Group; shoulderR: THREE.Group; elbowL: THREE.Group; elbowR: THREE.Group;
    torso: ToonMesh; head: THREE.Group;
    can: THREE.Mesh; gun: THREE.Mesh; bazooka: THREE.Mesh;
    tag: THREE.Sprite; tagCv: HTMLCanvasElement;
    bubble: THREE.Mesh;
    // kept for callers that used the old names
    legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  };
  t: number;
  lastTag: number;
  lastOp: number;
  emissive: THREE.Color;
  color: string;
}

export function buildCharacter(slot: number, colorHex: string): Character {
  const L = LOOKS[slot % LOOKS.length];
  const team = new THREE.Color(colorHex);
  const dark = team.clone().multiplyScalar(0.45);
  const W = L.width;

  const skin = toon(L.skin);
  const shirt = toon(team, team.getHex());
  shirt.emissiveIntensity = 0.18;
  const jacketMat = toon(dark);
  const pants = toon(L.pants);
  const shoe = toon(L.shoes);
  const hairMat = toon(L.hair);
  const accent = toon(dark.clone().lerp(team, 0.5));

  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  // ---- Legs: hip joint -> upper leg -> knee joint -> lower leg -> sneaker ----
  const HIP_Y = 0.82;
  const makeLeg = (side: number) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.13 * W, HIP_Y, 0);
    hip.add(limb(0.095 * W, 0.32, pants));
    const knee = new THREE.Group(); knee.position.y = -0.36;
    knee.add(limb(0.085 * W, 0.3, pants));
    const sneaker = box(0.2 * W, 0.1, 0.34, shoe, 0, -0.4, -0.06, 1.1);
    const sole = box(0.21 * W, 0.04, 0.35, toon(0x1a1a1a), 0, -0.46, -0.06);
    knee.add(sneaker, sole);
    hip.add(knee);
    return { hip, knee };
  };
  const legL = makeLeg(-1), legR = makeLeg(1);

  // ---- Torso ----
  const torsoGeo = new THREE.CapsuleGeometry(0.27 * W, 0.42, 4, 12);
  torsoGeo.scale(1, 1, 0.72);
  const torso = part(torsoGeo, shirt, 1.08);
  torso.position.y = HIP_Y + 0.3;
  // Jacket / vest details
  const jacket = new THREE.Group();
  if (L.jacket === 'hoodie' || L.jacket === 'open') {
    for (const s of [-1, 1]) jacket.add(box(0.12 * W, 0.5, 0.3, jacketMat, s * 0.2 * W, HIP_Y + 0.33, 0.02, 1.06));
    if (L.jacket === 'open') jacket.add(box(0.5 * W, 0.06, 0.3, jacketMat, 0, HIP_Y + 0.08, 0));
  }
  if (L.jacket === 'vest') jacket.add(box(0.5 * W, 0.46, 0.12, accent, 0, HIP_Y + 0.32, 0.2, 1.06));
  jacket.add(box(0.5 * W, 0.05, 0.3, toon(0x111111), 0, HIP_Y + 0.03, 0)); // belt
  if (L.back) jacket.add(box(0.42 * W, 0.44, 0.22, accent, 0, HIP_Y + 0.35, 0.28, 1.06));

  // ---- Arms: shoulder -> upper arm -> elbow -> forearm -> hand ----
  const SH_Y = HIP_Y + 0.62;
  const makeArm = (side: number) => {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.33 * W, SH_Y, 0);
    shoulder.add(sphere(0.085, L.jacket === 'tee' ? shirt : jacketMat, 0, 0, 0));
    shoulder.add(limb(0.07, 0.26, L.jacket === 'tee' ? skin : jacketMat));
    const elbow = new THREE.Group(); elbow.position.y = -0.3;
    elbow.add(limb(0.06, 0.24, L.jacket === 'hoodie' ? jacketMat : skin));
    elbow.add(sphere(0.07, skin, 0, -0.3, 0, 1.15)); // hand
    shoulder.add(elbow);
    return { shoulder, elbow };
  };
  const armL = makeArm(-1), armR = makeArm(1);

  // ---- Head ----
  const head = new THREE.Group();
  head.position.y = SH_Y + 0.34;
  const neck = part(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 10), skin); neck.position.y = -0.1; head.add(neck);
  const skull = L.hat === 'antenna' ? box(0.42, 0.42, 0.42, skin, 0, 0.05, 0, 1.08) : sphere(0.245, skin, 0, 0.05, 0, 1.08);
  skull.scale.set(1, 1.08, 1);
  head.add(skull);
  const eyeWhite = toon(0xffffff); const pupil = toon(0x111111);
  for (const s of [-1, 1]) {
    head.add(sphere(0.052, eyeWhite, s * 0.09, 0.08, -0.2));
    head.add(sphere(0.028, pupil, s * 0.09, 0.08, -0.245));
    head.add(box(0.09, 0.022, 0.03, hairMat, s * 0.09, 0.16, -0.215)); // brow
  }
  const mouthMat = toon(0x2a0a10);
  if (L.mouth === 'smile') { const m = part(new THREE.TorusGeometry(0.06, 0.014, 6, 12, Math.PI), mouthMat); m.rotation.z = Math.PI; m.position.set(0, -0.06, -0.225); head.add(m); }
  if (L.mouth === 'grin') head.add(box(0.14, 0.04, 0.02, toon(0xffffff), 0, -0.07, -0.235));
  if (L.mouth === 'flat') head.add(box(0.1, 0.02, 0.02, mouthMat, 0, -0.07, -0.235));
  if (L.mouth === 'o') head.add(sphere(0.03, mouthMat, 0, -0.07, -0.23));
  // Hair / hats
  const hc = dark.clone().lerp(team, 0.5);
  const hatMat = toon(hc);
  switch (L.hat) {
    case 'cap': head.add(sphere(0.26, hatMat, 0, 0.12, 0, 1.06)); head.add(box(0.34, 0.04, 0.22, hatMat, 0, 0.14, -0.3)); break;
    case 'beanie': { const b = sphere(0.27, hatMat, 0, 0.1, 0, 1.06); b.scale.set(1, 0.95, 1); head.add(b); head.add(box(0.5, 0.08, 0.5, hatMat, 0, -0.02, 0)); break; }
    case 'none': head.add(sphere(0.25, hairMat, 0, 0.14, 0.02)); break;
    case 'mohawk': head.add(sphere(0.245, hairMat, 0, 0.09, 0.02)); head.add(box(0.08, 0.3, 0.42, toon(team, team.getHex()), 0, 0.34, 0, 1.1)); break;
    case 'hood': { const h = sphere(0.34, jacketMat, 0, 0.04, 0.06, 1.06); h.scale.set(1, 0.95, 1); head.add(h); break; }
    case 'bucket': head.add(sphere(0.245, hairMat, 0, 0.1, 0.02)); head.add(part(new THREE.CylinderGeometry(0.26, 0.4, 0.2, 12), hatMat)).position.y = 0.26; break;
    case 'afro': head.add(sphere(0.4, hairMat, 0, 0.15, 0.04, 1.06)); break;
    case 'ponytail': head.add(sphere(0.255, hairMat, 0, 0.1, 0.02, 1.06)); head.add(limb(0.06, 0.4, hairMat, 1.12)).position.set(0, 0.12, 0.24); break;
    case 'helmet': { const h = sphere(0.3, toon(hc), 0, 0.08, 0, 1.06); h.material.emissive = hc.clone().multiplyScalar(0.2); head.add(h); head.add(box(0.46, 0.1, 0.08, toon(0x111111), 0, 0.05, -0.27)); break; }
    case 'headphones': head.add(sphere(0.25, hairMat, 0, 0.13, 0.02)); head.add(box(0.56, 0.05, 0.08, toon(0x222222), 0, 0.3, 0)); for (const s of [-1, 1]) head.add(box(0.08, 0.18, 0.18, toon(team), s * 0.27, 0.06, 0, 1.1)); break;
    case 'bandana': head.add(box(0.52, 0.16, 0.52, toon(team), 0, 0.12, 0, 1.06)); head.add(box(0.1, 0.3, 0.04, toon(team), 0.2, -0.02, 0.26)); break;
    case 'antenna': { head.add(box(0.04, 0.36, 0.04, toon(0x888888), 0, 0.42, 0)); const ball = sphere(0.07, toon(team, team.getHex()), 0, 0.62, 0); head.add(ball); break; }
  }

  // ---- Tools in the right hand ----
  const can = part(new THREE.CylinderGeometry(0.065, 0.065, 0.24, 10), toon(team, team.getHex()));
  can.material.emissiveIntensity = 0.35;
  can.position.set(0, -0.32, -0.06); armR.elbow.add(can);
  const gun = box(0.08, 0.1, 0.34, toon(0x2b2b33), 0, -0.3, -0.22); gun.visible = false; armR.elbow.add(gun);
  const bazooka = part(new THREE.CylinderGeometry(0.11, 0.13, 1.2, 10), toon(0xff6a00));
  bazooka.rotation.x = Math.PI / 2; bazooka.position.set(0.22, SH_Y + 0.1, -0.2); bazooka.visible = false;

  body.add(legL.hip, legR.hip, torso, jacket, armL.shoulder, armR.shoulder, head, bazooka);
  body.scale.setScalar(L.scale);

  // Contact shadow blob
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; blob.userData.blob = true;
  g.add(blob);

  // Name + hp tag
  const tagCv = document.createElement('canvas'); tagCv.width = 256; tagCv.height = 64;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tagCv), transparent: true, depthTest: false }));
  tag.scale.set(3, 0.75, 1); tag.position.y = 2.45 * L.scale; g.add(tag);
  // Shield bubble
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4d7cff, transparent: true, opacity: 0.25 }));
  bubble.position.y = 1; bubble.visible = false; g.add(bubble);

  return {
    group: g,
    parts: {
      body, hipL: legL.hip, hipR: legR.hip, kneeL: legL.knee, kneeR: legR.knee,
      shoulderL: armL.shoulder, shoulderR: armR.shoulder, elbowL: armL.elbow, elbowR: armR.elbow,
      torso, head, can, gun, bazooka, tag, tagCv, bubble,
      legL: legL.hip, legR: legR.hip, armL: armL.shoulder, armR: armR.shoulder
    },
    t: Math.random() * 10, lastTag: 0, lastOp: 1, emissive: torso.material.emissive.clone(), color: colorHex
  };
}

export function updateTag(ch: Character, p: PlayerSnapshot): void {
  const g = ch.parts.tagCv.getContext('2d')!;
  g.clearRect(0, 0, 256, 64);
  g.font = 'bold 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = p.color; g.shadowColor = '#000'; g.shadowBlur = 6;
  g.fillText(p.name, 128, 20);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(48, 42, 160, 12);
  g.fillStyle = '#ff3b3b'; g.fillRect(48, 42, (160 * Math.max(0, p.hp)) / 100, 12);
  if (p.armor > 0) { g.fillStyle = '#4d7cff'; g.fillRect(48, 54, 160 * Math.min(1, p.armor / 100), 5); }
  ch.parts.tag.material.map!.needsUpdate = true;
}

/** Joint-based animation. Angles in radians; +x rotation swings a limb forward (-z). */
export function animateCharacter(ch: Character, anim: Anim, dt: number, painting: boolean): void {
  const P = ch.parts;
  ch.t += dt;
  const t = ch.t;
  const run = anim === 'run' || anim === 'sprint';
  const freq = anim === 'sprint' ? 15 : 11;
  const amp = anim === 'sprint' ? 1.0 : 0.75;
  const swing = run ? Math.sin(t * freq) * amp : 0;
  const breathe = Math.sin(t * 2.2);

  // Legs
  if (run) {
    P.hipL.rotation.x = swing; P.hipR.rotation.x = -swing;
    P.kneeL.rotation.x = Math.max(0, -swing) * 1.3; P.kneeR.rotation.x = Math.max(0, swing) * 1.3;
  } else if (anim === 'climb') {
    const c = Math.sin(t * 8);
    P.hipL.rotation.x = 0.9 + c * 0.5; P.hipR.rotation.x = 0.9 - c * 0.5;
    P.kneeL.rotation.x = 1.1 + c * 0.4; P.kneeR.rotation.x = 1.1 - c * 0.4;
  } else if (anim === 'jump') {
    P.hipL.rotation.x = 0.7; P.hipR.rotation.x = -0.2; P.kneeL.rotation.x = 1.2; P.kneeR.rotation.x = 0.5;
  } else {
    P.hipL.rotation.x = P.hipR.rotation.x = 0; P.kneeL.rotation.x = P.kneeR.rotation.x = 0.05;
  }

  // Arms
  if (anim === 'climb') {
    const c = Math.sin(t * 8);
    P.shoulderL.rotation.x = -2.6 + c * 0.5; P.shoulderR.rotation.x = -2.6 - c * 0.5;
    P.elbowL.rotation.x = -0.6; P.elbowR.rotation.x = -0.6;
  } else if (painting) {
    P.shoulderL.rotation.x = -swing * 0.5; P.elbowL.rotation.x = -0.5;
    P.shoulderR.rotation.x = -1.45 + Math.sin(t * 28) * 0.06; P.elbowR.rotation.x = -0.35;
  } else if (anim === 'jump') {
    P.shoulderL.rotation.x = -0.9; P.shoulderR.rotation.x = -0.9; P.elbowL.rotation.x = P.elbowR.rotation.x = -0.9;
  } else {
    P.shoulderL.rotation.x = -swing; P.shoulderR.rotation.x = swing;
    P.elbowL.rotation.x = -0.35 - Math.max(0, -swing) * 0.9; P.elbowR.rotation.x = -0.35 - Math.max(0, swing) * 0.9;
    if (!run) { P.shoulderL.rotation.x = breathe * 0.03; P.shoulderR.rotation.x = -breathe * 0.03; }
  }
  // Arms hang slightly away from the torso
  P.shoulderL.rotation.z = 0.12; P.shoulderR.rotation.z = -0.12;

  // Body bob, lean and breathing
  P.body.position.y = run ? Math.abs(Math.sin(t * freq)) * (anim === 'sprint' ? 0.09 : 0.06) : 0;
  P.body.rotation.x = anim === 'sprint' ? 0.22 : run ? 0.08 : anim === 'climb' ? -0.15 : 0;
  P.torso.scale.y = 1 + (run ? 0 : breathe * 0.015);
  P.head.rotation.x = run ? 0.05 : breathe * 0.02;
}

export function setOpacity(ch: Character, op: number): void {
  if (ch.lastOp === op) return;
  ch.lastOp = op;
  ch.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.Material | undefined;
    if (!m || o === ch.parts.bubble || (o as THREE.Sprite).isSprite) return;
    if (o.userData.outline || o.userData.blob) { o.visible = op >= 1; return; }
    m.transparent = op < 1; m.opacity = op;
  });
}
