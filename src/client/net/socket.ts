// Socket.IO client: typed events from the shared protocol.
import { io, type Socket } from 'socket.io-client';
import * as THREE from 'three';
import * as CITY from '../../shared/city.ts';
import type { ClientToServer, ServerToClient } from '../../shared/protocol.ts';
import { audio } from '../audio/audio.ts';
import { t } from '../core/i18n.ts';
import { flashDamage, killFeed, setReady, toast, updateHud } from '../ui/hud.ts';
import { I, PICKUP_ICON } from '../ui/icons.ts';
import { spawnLocal, superJumpNow } from '../game/physics.ts';
import { buildPickups, burst, clearPaint, setPaint, tracer } from '../render/scene.ts';
import { $, buildings, input, net, player } from '../core/state.ts';

export const socket: Socket<ServerToClient, ClientToServer> = io();

socket.on('welcome', (w) => {
  net.cfg = w; net.me = w.id; net.mySlot = w.slot;
  audio.music.set('lobby');
  buildPickups(w.pickups);
  for (const [key, slot] of w.paint) setPaint(key, w.colors[slot] ?? '#888');
  const s = CITY.spawnPoints()[w.slot % 12];
  spawnLocal(s.x, 0, s.z);
});
socket.on('disconnect', () => { $('#overlay').classList.remove('hidden'); $('#ovTitle').textContent = t('hud.disconnected'); $('#ovText').textContent = t('hud.reload'); audio.stopAllSprays(); audio.music.set('off'); });
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
  const k = CITY.parseKey(d.key);
  if (!k) return;
  const c = CITY.tileCenter(buildings[k.bi], k.face, k.i, k.j);
  if (d.by === net.me) { burst(new THREE.Vector3(c.x, c.y, c.z), d.color, 0.4); audio.synth.tile(undefined, 0.3); }
  else audio.synth.tile(c, 0.3);
});
socket.on('shot', (d) => {
  const from = new THREE.Vector3(d.ox, d.oy, d.oz), to = new THREE.Vector3(d.hx, d.hy, d.hz);
  const p = net.state.players.find((x) => x.id === d.by);
  tracer(from, to, p?.color ?? '#fff');
  const mine = d.by === net.me;
  if (d.weapon === 'bazooka') audio.synth.bazooka(mine ? undefined : from); else audio.synth.pistol(mine ? undefined : from);
  if (d.weapon === 'bazooka') { burst(to, '#d98e4a', 1.5); audio.synth.splat(to, 1); audio.sample('explosion', { volume: 0.5, at: to, rate: 0.9 }); }
  else if (d.hit) { burst(to, p?.color ?? '#fff', 0.3); audio.synth.tile(to, 0.5); }
  else audio.synth.wallHit(to);
});
socket.on('hit', (d) => {
  if (d.victim === net.me) { player.x += d.fx * 1.5; player.z += d.fz * 1.5; player.vy = 4; }
  const v = net.state.players.find((x) => x.id === d.victim);
  if (v) { burst(new THREE.Vector3(v.x, v.y + 1, v.z), '#ffffff', 0.6); audio.sample('punch', { volume: 0.8, at: { x: v.x, y: v.y + 1, z: v.z } }); }
});
socket.on('damaged', (d) => { if (d.id === net.me) { flashDamage(); audio.synth.hurt(); } });
socket.on('killed', (d) => {
  if (d.id === net.me) { toast(`${I.skull(26)} ${t('toast.killedBy', { name: d.byName ?? t('toast.night'), loss: d.loss })}`, '#e0736c'); audio.synth.stinger('death'); audio.stopAllSprays(); }
  else if (d.by === net.me) { toast(`${I.flame(26)} ${t('toast.youKilled', { name: d.name })}`, '#d98e4a'); audio.synth.stinger('kill'); }
  killFeed(d);
});
socket.on('pickup', (d) => {
  if (d.by !== net.me) return;
  toast(`${PICKUP_ICON[d.type](26)} ${t(`pickup.${d.type}`)}`);
  audio.synth.pickup();
});
socket.on('power', (d) => {
  const p = net.state.players.find((x) => x.id === d.id);
  if (d.name === 'shield' && d.id === net.me) audio.synth.shield(); else audio.synth.power(d.id === net.me ? undefined : p ? { x: p.x, y: p.y + 1, z: p.z } : undefined);
  if (d.id !== net.me) return;
  if (d.name === 'dash') input.dashUntil = performance.now() + d.duration;
  if (d.name === 'jump') superJumpNow();
  toast(t(`toast.${d.name}`));
});

// Phase transitions -> jingles / countdown ticks; remote sprays -> hiss.
let lastPhase = '';
let lastCount = -1;
socket.on('state', (s) => {
  if (!net.cfg) return;
  net.state = s;
  if (s.phase !== lastPhase) {
    if (s.phase === 'playing') { audio.synth.stinger('start'); audio.music.set('match'); }
    if (s.phase === 'lobby' || s.phase === 'countdown') audio.music.set('lobby');
    if (s.phase === 'ended') {
      const me = s.players.find((p) => p.id === net.me);
      const won = s.winner && (s.winner.team !== undefined ? s.winner.team === me?.team : s.winner.name === me?.name);
      audio.music.set('lobby');
      audio.synth.stinger(won ? 'victory' : 'defeat');
      audio.stopAllSprays();
    }
    lastPhase = s.phase;
  }
  if (s.phase === 'countdown' && s.timeLeft !== lastCount) { lastCount = s.timeLeft; audio.synth.tick(s.timeLeft <= 1); }
  for (const p of s.players) if (p.id !== net.me) audio.spray(p.anim === 'paint' && !p.dead, p.id, { x: p.x, y: p.y + 1, z: p.z });
  updateHud();
});
