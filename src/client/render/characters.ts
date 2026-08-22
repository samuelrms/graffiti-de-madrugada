// Procedural characters: 12 distinct looks built from primitives, team-coloured.
import * as THREE from 'three';
import type { Anim, PlayerSnapshot } from '../../shared/protocol.ts';

type Hat = 'cap' | 'beanie' | 'none' | 'mohawk' | 'hood' | 'bucket' | 'afro' | 'ponytail' | 'helmet' | 'headphones' | 'bandana' | 'antenna';
interface Look { hat: Hat; scale: number; width: number; skin: number; back: boolean }

export const LOOKS: Look[] = [
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

type StdMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

export interface Character {
  group: THREE.Group;
  parts: {
    body: THREE.Group;
    legL: StdMesh; legR: StdMesh; armL: StdMesh; armR: StdMesh; torso: StdMesh;
    can: THREE.Mesh; gun: THREE.Mesh; bazooka: THREE.Mesh;
    tag: THREE.Sprite; tagCv: HTMLCanvasElement;
    bubble: THREE.Mesh;
  };
  t: number;
  lastTag: number;
  lastOp: number;
  emissive: THREE.Color;
  color: string;
}

function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0): StdMesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(x, y, z); m.castShadow = true; return m;
}

export function buildCharacter(slot: number, colorHex: string): Character {
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
  const armL = box(0.16, 0.65, 0.16, dark, -0.4 * W, 1.1, 0);
  const armR = box(0.16, 0.65, 0.16, dark, 0.4 * W, 1.1, 0);
  armL.geometry.translate(0, -0.25, 0); armR.geometry.translate(0, -0.25, 0);
  armL.position.y = armR.position.y = 1.35;
  legL.geometry.translate(0, -0.375, 0); legR.geometry.translate(0, -0.375, 0);
  legL.position.y = legR.position.y = 0.75;
  const head: THREE.Mesh = L.hat === 'antenna'
    ? box(0.42, 0.42, 0.42, L.skin, 0, 1.7, 0)
    : new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: L.skin }));
  head.position.y = 1.7; head.castShadow = true;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045), eyeMat); e.position.set(s * 0.09, 1.74, -0.2); body.add(e); }
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26), new THREE.MeshStandardMaterial({ color: team, emissive: team, emissiveIntensity: 0.3 }));
  can.position.set(0, -0.55, -0.08); armR.add(can);
  const gun = box(0.1, 0.12, 0.4, 0x2b2b33, 0, -0.5, -0.25); gun.visible = false; armR.add(gun);
  const bazooka = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.2), new THREE.MeshStandardMaterial({ color: 0xff6a00 }));
  bazooka.rotation.x = Math.PI / 2; bazooka.position.set(0.2, 1.55, -0.2); bazooka.visible = false;
  const hat = new THREE.Group(); hat.position.y = 1.7;
  const hc = dark.clone().lerp(team, 0.5);
  switch (L.hat) {
    case 'cap': hat.add(box(0.5, 0.14, 0.5, hc, 0, 0.2, 0)); hat.add(box(0.5, 0.05, 0.3, hc, 0, 0.14, 0.32)); break;
    case 'beanie': { const b = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, 1.3), new THREE.MeshStandardMaterial({ color: hc })); b.position.y = 0.06; hat.add(b); break; }
    case 'mohawk': hat.add(box(0.08, 0.32, 0.5, team, 0, 0.3, 0)); break;
    case 'hood': { const h = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8, 0, Math.PI * 2, 0, 1.9), new THREE.MeshStandardMaterial({ color: hc })); h.position.set(0, -0.02, 0.05); hat.add(h); break; }
    case 'bucket': { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.22, 10), new THREE.MeshStandardMaterial({ color: hc })); b.position.y = 0.18; hat.add(b); break; }
    case 'afro': { const a = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshStandardMaterial({ color: 0x1b1210 })); a.position.set(0, 0.1, 0.04); hat.add(a); break; }
    case 'ponytail': hat.add(box(0.48, 0.12, 0.48, 0x3a1f0c, 0, 0.2, 0)); hat.add(box(0.12, 0.55, 0.12, 0x3a1f0c, 0, -0.1, 0.32)); break;
    case 'helmet': { const h = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, 1.6), new THREE.MeshStandardMaterial({ color: hc, metalness: 0.5, roughness: 0.3 })); hat.add(h); hat.add(box(0.5, 0.12, 0.1, 0x111111, 0, 0.03, -0.22)); break; }
    case 'headphones': hat.add(box(0.6, 0.06, 0.08, 0x222222, 0, 0.22, 0)); for (const s of [-1, 1]) hat.add(box(0.1, 0.22, 0.22, team, s * 0.28, 0.02, 0)); break;
    case 'bandana': hat.add(box(0.5, 0.18, 0.5, team, 0, -0.08, 0)); break;
    case 'antenna': { hat.add(box(0.04, 0.4, 0.04, 0x888888, 0, 0.4, 0)); const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07), new THREE.MeshBasicMaterial({ color: team })); ball.position.y = 0.62; hat.add(ball); break; }
    case 'none': break;
  }
  if (L.back) body.add(box(0.45 * W, 0.5, 0.25, hc, 0, 1.15, 0.3));
  body.add(legL, legR, torso, armL, armR, head, hat, bazooka);
  body.scale.setScalar(L.scale);
  const tagCv = document.createElement('canvas'); tagCv.width = 256; tagCv.height = 64;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tagCv), transparent: true, depthTest: false }));
  tag.scale.set(3, 0.75, 1); tag.position.y = 2.35 * L.scale; g.add(tag);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4d7cff, transparent: true, opacity: 0.25 }));
  bubble.position.y = 1; bubble.visible = false; g.add(bubble);
  return {
    group: g,
    parts: { body, legL, legR, armL, armR, torso, can, gun, bazooka, tag, tagCv, bubble },
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

export function animateCharacter(ch: Character, anim: Anim, dt: number, painting: boolean): void {
  const P = ch.parts;
  ch.t += dt;
  const t = ch.t;
  let swing = 0;
  if (anim === 'run') swing = Math.sin(t * 11) * 0.7;
  if (anim === 'sprint') swing = Math.sin(t * 15) * 0.95;
  if (anim === 'climb') swing = Math.sin(t * 8) * 0.9;
  P.legL.rotation.x = swing; P.legR.rotation.x = -swing;
  if (anim === 'climb') { P.armL.rotation.x = -2.4 + swing * 0.4; P.armR.rotation.x = -2.4 - swing * 0.4; }
  else if (painting) { P.armL.rotation.x = -swing * 0.6; P.armR.rotation.x = -1.5 + Math.sin(t * 30) * 0.08; }
  else { P.armL.rotation.x = -swing; P.armR.rotation.x = swing; }
  if (anim === 'jump') { P.legL.rotation.x = 0.5; P.legR.rotation.x = -0.3; }
  P.body.position.y = anim === 'run' ? Math.abs(Math.sin(t * 11)) * 0.06 : anim === 'sprint' ? Math.abs(Math.sin(t * 15)) * 0.09 : 0;
  P.body.rotation.x = anim === 'sprint' ? 0.18 : 0;
}

export function setOpacity(ch: Character, op: number): void {
  if (ch.lastOp === op) return;
  ch.lastOp = op;
  ch.group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m && o !== ch.parts.bubble && !(o as THREE.Sprite).isSprite) { m.transparent = op < 1; m.opacity = op; }
  });
}
