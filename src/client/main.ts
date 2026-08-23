// Entry: simulation loop (timer, survives background tabs) + render loop (rAF).
import * as THREE from 'three';
import './style.css';
import { animateCharacter, buildCharacter, setOpacity, updateTag, type Character } from './render/characters.ts';
import { applyStatic, t } from './core/i18n.ts';
import { pollGamepad } from './game/gamepad.ts';
import { renderHomeLabels, setupHome } from './ui/home.ts';
import { setupPause } from './ui/pause.ts';
import { setupDevice } from './ui/device.ts';
import { audio } from './audio/audio.ts';
import { isFlashing, updateHud } from './ui/hud.ts';
import { setTool, tryPaint } from './game/input.ts';
import { socket } from './net/socket.ts';
import { aimWallTile, physics, updateCamera } from './game/physics.ts';
import { camera, pickupMeshes, renderer, scene, updateEffects } from './render/scene.ts';
import { $, buildings, flags, input, net, player } from './core/state.ts';

const remote = new Map<string, Character>();
applyStatic();
setupDevice();
setupHome();
setupPause({
  onLanguageChange: () => { renderHomeLabels(); updateHud(); },
  onLeave: () => $('#leaveBtn').click()
});
// Sound needs a user gesture; show a small hint until it is unlocked.
setTimeout(() => { if (!audio.ready && !document.body.classList.contains('touch')) $('#audioHint').classList.remove('hidden'); }, 1500);

// ---------- Simulation: fixed 60 Hz steps, accumulator keeps the remainder ----------
const STEP = 1 / 60;
let lastSim = performance.now();
let acc = 0;
let lastPosSent = 0;
setInterval(() => {
  const now = performance.now();
  acc = Math.min(acc + (now - lastSim) / 1000, 2); // catch up to 2 s when the tab was throttled
  lastSim = now;
  if (!net.cfg) return;
  if (!flags.sim) { acc = 0; return; }
  pollGamepad((now - lastSim + 1) / 1000);
  while (acc >= STEP) { physics(STEP); acc -= STEP; }
  if (now - lastPosSent > 50) {
    lastPosSent = now;
    socket.emit('pos', { x: player.x, y: player.y, z: player.z, rot: player.yaw, anim: input.mouseDown && player.tool === 'spray' ? 'paint' : player.anim });
  }
}, 16);

// ---------- Render ----------
const target = new THREE.Vector3();
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!flags.render) return;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (net.cfg) {
    if (!flags.freeCam) updateCamera();
    if (player.tool === 'spray' && net.state.phase === 'playing' && !player.dead && !player.stunned) tryPaint(now);
    else { $('#cross').classList.remove('can'); audio.spray(false, 'me'); }
  }

  const seen = new Set<string>();
  for (const p of net.state.players) {
    seen.add(p.id);
    let ch = remote.get(p.id);
    if (ch && ch.color !== p.color) { scene.remove(ch.group); remote.delete(p.id); ch = undefined; } // team colour changed
    if (!ch) { ch = buildCharacter(p.slot, p.color); scene.add(ch.group); remote.set(p.id, ch); }
    const isMe = p.id === net.me;
    target.set(isMe ? player.x : p.x, isMe ? player.y : p.y, isMe ? player.z : p.z);
    ch.group.position.lerp(target, isMe ? 1 : Math.min(1, dt * 12));
    const rot = isMe ? player.yaw : p.rot;
    let dr = rot - ch.group.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    ch.group.rotation.y += dr * (isMe ? 1 : Math.min(1, dt * 12));
    const anim = isMe ? player.anim : p.anim === 'paint' ? 'idle' : p.anim;
    animateCharacter(ch, anim, dt, isMe ? input.mouseDown && player.tool === 'spray' : p.anim === 'paint');
    ch.group.visible = !p.dead;
    ch.parts.bubble.visible = p.shield;
    const gunMode = isMe ? player.tool === 'gun' : p.anim !== 'paint';
    ch.parts.gun.visible = gunMode && p.weapon === 'pistol';
    ch.parts.bazooka.visible = gunMode && p.weapon === 'bazooka';
    ch.parts.can.visible = !gunMode;
    setOpacity(ch, p.smoke ? (isMe ? 0.35 : 0.08) : 1);
    ch.parts.tag.visible = !p.smoke || isMe;
    void t;
    if (now - ch.lastTag > 200) { ch.lastTag = now; updateTag(ch, p); }
    ch.parts.torso.material.emissive.copy(p.stunned ? new THREE.Color(0x888888) : ch.emissive);
  }
  for (const [id, ch] of remote) if (!seen.has(id)) { scene.remove(ch.group); remote.delete(id); }

  net.state.pickups?.forEach((on, i) => {
    const g = pickupMeshes[i]; if (!g) return;
    g.visible = !!on; g.rotation.y += dt * 1.5; g.children[0].position.y = Math.sin(now / 300 + i) * 0.15;
  });
  updateEffects(now, !flags.sim);
  $('#dmg').style.opacity = isFlashing(now) ? '1' : '0';
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Debug/automation handle used by tools/ and test/e2e (harmless in production).
declare global {
  interface Window { DBG: unknown }
}
window.DBG = {
  player, camera, scene, remote, buildings, keys: input.keys, socket, flags, THREE,
  state: () => net.state,
  setTool,
  buildCharacter,
  press: (on: boolean) => { input.mouseDown = on; },
  aimWallTile
};
