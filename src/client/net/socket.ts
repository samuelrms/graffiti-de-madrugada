// Socket.IO client: typed events from the shared protocol.
import { io, type Socket } from 'socket.io-client';
import * as THREE from 'three';
import * as CITY from '../../shared/city.ts';
import type { ClientToServer, ServerToClient } from '../../shared/protocol.ts';
import { flashDamage, killFeed, setReady, toast, updateHud } from '../ui/hud.ts';
import { I, PICKUP_ICON } from '../ui/icons.ts';
import { spawnLocal, superJumpNow } from '../game/physics.ts';
import { buildPickups, burst, clearPaint, setPaint, tracer } from '../render/scene.ts';
import { $, buildings, input, net, player } from '../core/state.ts';

export const socket: Socket<ServerToClient, ClientToServer> = io();

socket.on('welcome', (w) => {
  net.cfg = w; net.me = w.id; net.mySlot = w.slot;
  buildPickups(w.pickups);
  for (const [key, slot] of w.paint) setPaint(key, w.colors[slot] ?? '#888');
  const s = CITY.spawnPoints()[w.slot % 12];
  spawnLocal(s.x, 0, s.z);
});
socket.on('disconnect', () => { $('#overlay').classList.remove('hidden'); $('#ovTitle').textContent = 'Desconectado'; $('#ovText').textContent = 'Recarregue a página.'; });
socket.on('reset', () => {
  clearPaint();
  setReady(false);
  const s = CITY.spawnPoints()[net.mySlot % 12];
  spawnLocal(s.x, 0, s.z);
});
socket.on('respawned', (d) => { if (d.id === net.me) spawnLocal(d.x, d.y, d.z); });
socket.on('correct', (d) => { player.x = d.x; player.y = d.y; player.z = d.z; player.vy = 0; });
socket.on('painted', (d) => {
  setPaint(d.key, d.color);
  if (d.by === net.me) {
    const t = CITY.parseKey(d.key);
    if (t) { const c = CITY.tileCenter(buildings[t.bi], t.face, t.i, t.j); burst(new THREE.Vector3(c.x, c.y, c.z), d.color, 0.4); }
  }
});
socket.on('shot', (d) => {
  const from = new THREE.Vector3(d.ox, d.oy, d.oz), to = new THREE.Vector3(d.hx, d.hy, d.hz);
  const p = net.state.players.find((x) => x.id === d.by);
  tracer(from, to, p?.color ?? '#fff');
  if (d.weapon === 'bazooka') burst(to, '#ff6a00', 1.5); else if (d.hit) burst(to, p?.color ?? '#fff', 0.3);
});
socket.on('hit', (d) => {
  if (d.victim === net.me) { player.x += d.fx * 1.5; player.z += d.fz * 1.5; player.vy = 4; }
  const v = net.state.players.find((x) => x.id === d.victim);
  if (v) burst(new THREE.Vector3(v.x, v.y + 1, v.z), '#ffffff', 0.6);
});
socket.on('damaged', (d) => { if (d.id === net.me) flashDamage(); });
socket.on('killed', (d) => {
  if (d.id === net.me) toast(`${I.skull(26)} ${d.byName ?? 'A noite'} te derrubou (-${d.loss})`, '#ff3b3b');
  else if (d.by === net.me) toast(`${I.flame(26)} Você derrubou ${d.name}`, '#b4ff39');
  killFeed(d);
});
socket.on('pickup', (d) => {
  if (d.by !== net.me) return;
  const text = { bazooka: 'Bazuca de tinta!', vest: 'Colete +50', shoes: 'Tênis turbo', doublecan: 'Lata 2x pontos', medkit: 'Vida +60' }[d.type];
  toast(`${PICKUP_ICON[d.type](26)} ${text}`);
});
socket.on('power', (d) => {
  if (d.id !== net.me) return;
  if (d.name === 'dash') input.dashUntil = performance.now() + d.duration;
  if (d.name === 'jump') superJumpNow();
  toast({ dash: 'Disparada!', shield: 'Escudo!', jump: 'Super pulo!', smoke: 'Fumaça!' }[d.name]);
});
socket.on('state', (s) => { if (!net.cfg) return; net.state = s; updateHud(); });
