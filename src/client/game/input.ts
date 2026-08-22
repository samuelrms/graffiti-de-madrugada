// Keyboard, mouse (pointer lock) and touch controls.
import { I } from '../ui/icons.ts';
import { setReady, updateHud, iAmReady } from '../ui/hud.ts';
import { socket } from '../net/socket.ts';
import { aimDirection, aimWallTile } from './physics.ts';
import { renderer } from '../render/scene.ts';
import { $, input, isTouch, net, player, type Tool } from '../core/state.ts';

const canvas = renderer.domElement;
const keys = input.keys;

export function setTool(t: Tool): void { player.tool = t; updateHud(); }

export function shoot(): void {
  const d = aimDirection();
  socket.emit('shoot', { ox: player.x, oy: player.y + 1.4, oz: player.z, dx: d.x, dy: d.y, dz: d.z });
}

let lastPaintAt = 0;
/** Called every frame: updates the crosshair and paints while the mouse is held. */
export function tryPaint(now: number): void {
  const t = aimWallTile();
  $('#cross').classList.toggle('can', !!t && t.dist <= 4.5);
  if (!input.mouseDown || !t || t.dist > 4.5 || now - lastPaintAt < 120) return;
  lastPaintAt = now;
  socket.emit('paint', t.key);
}

const canAct = () => net.state.phase === 'playing' && !player.dead && !player.stunned;

// ---------- Mouse ----------
canvas.addEventListener('click', () => { if (!isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0025;
  player.pitch = Math.max(-0.6, Math.min(1.25, player.pitch + e.movementY * 0.0025));
});
addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas || e.button !== 0) return;
  input.mouseDown = true;
  if (player.tool === 'gun' && canAct()) shoot();
});
addEventListener('mouseup', () => { input.mouseDown = false; });
addEventListener('wheel', () => setTool(player.tool === 'spray' ? 'gun' : 'spray'));

// ---------- Keyboard ----------
const ARROWS: Record<string, string> = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', ' ', 'shift'].includes(k)) { keys.add(k); e.preventDefault(); }
  if (ARROWS[k]) keys.add(ARROWS[k]);
  if (k === '1') setTool('spray');
  if (k === '2') setTool('gun');
  if (k === 'f' && !e.repeat) socket.emit('melee');
  if (k === 'q' && !e.repeat) socket.emit('power');
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (ARROWS[k]) keys.delete(ARROWS[k]);
});
addEventListener('blur', () => keys.clear());

// ---------- Lobby / name ----------
$('#restart').addEventListener('click', () => socket.emit('restart'));
$('#ready').addEventListener('click', () => {
  const next = !iAmReady;
  const name = $<HTMLInputElement>('#lobbyName').value.trim();
  if (name) socket.emit('rename', name);
  socket.emit('ready', next);
  setReady(next);
});
for (const sel of ['#name', '#lobbyName']) {
  const el = $<HTMLInputElement>(sel);
  el.addEventListener('change', () => {
    socket.emit('rename', el.value);
    $<HTMLInputElement>('#name').value = $<HTMLInputElement>('#lobbyName').value = el.value;
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
}

// ---------- Touch (phones/tablets) ----------
if (isTouch) {
  document.body.classList.add('touch');
  const stick = $('#stick'), knob = $('#stick i');
  let stickId: number | null = null, lookId: number | null = null, lookLast: { x: number; y: number } | null = null;
  const stickCenter = () => { const r = stick.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (e.clientX < innerWidth / 2 && stickId === null) {
      stickId = e.pointerId;
      const c = stickCenter();
      stick.style.left = `${e.clientX - c.r}px`; stick.style.top = `${e.clientY - c.r}px`; stick.style.bottom = 'auto';
      input.touch.active = true;
    } else if (lookId === null) {
      lookId = e.pointerId; lookLast = { x: e.clientX, y: e.clientY };
    }
  });
  addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      const c = stickCenter();
      let dx = (e.clientX - c.x) / c.r, dy = (e.clientY - c.y) / c.r;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      input.touch.x = Math.abs(dx) < 0.15 ? 0 : dx;
      input.touch.y = Math.abs(dy) < 0.15 ? 0 : dy;
      knob.style.transform = `translate(${dx * c.r * 0.6}px, ${dy * c.r * 0.6}px)`;
    } else if (e.pointerId === lookId && lookLast) {
      player.yaw -= (e.clientX - lookLast.x) * 0.006;
      player.pitch = Math.max(-0.6, Math.min(1.25, player.pitch + (e.clientY - lookLast.y) * 0.006));
      lookLast = { x: e.clientX, y: e.clientY };
    }
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      stickId = null; input.touch.active = false; input.touch.x = input.touch.y = 0;
      knob.style.transform = ''; stick.style.left = '40px'; stick.style.top = 'auto'; stick.style.bottom = '110px';
    }
    if (e.pointerId === lookId) { lookId = null; lookLast = null; }
  };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);
  const hold = (btn: HTMLElement, down: () => void, up?: () => void) => {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); down(); });
    const rel = (e: Event) => { e.preventDefault(); up?.(); };
    btn.addEventListener('pointerup', rel); btn.addEventListener('pointercancel', rel);
  };
  const B = (t: string) => $(`#tbtns [data-t="${t}"]`);
  B('fire').innerHTML = I.spray(30); B('jump').innerHTML = I.jump(28); B('melee').innerHTML = I.melee(26); B('swap').innerHTML = I.swap(24);
  hold(B('jump'), () => keys.add(' '), () => keys.delete(' '));
  hold(B('fire'), () => { input.mouseDown = true; if (player.tool === 'gun' && canAct()) shoot(); }, () => { input.mouseDown = false; });
  hold(B('melee'), () => socket.emit('melee'));
  hold(B('power'), () => socket.emit('power'));
  hold(B('swap'), () => { setTool(player.tool === 'spray' ? 'gun' : 'spray'); B('fire').innerHTML = player.tool === 'spray' ? I.spray(30) : I.pistol(30); });
}
