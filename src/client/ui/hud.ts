// DOM HUD: scoreboard, timer, health, tools, lobby, end screen, kill feed, toasts.
import type { KilledEvent, PowerName } from '../../shared/protocol.ts';
import { I, KILL_ICON, POWER_ICON } from './icons.ts';
import { $, myState, net, player } from '../core/state.ts';

export const POWER_LABEL: Record<PowerName, string> = { dash: 'Disparada', shield: 'Escudo', jump: 'Super pulo', smoke: 'Fumaça' };

export function fmt(s: number): string { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export let iAmReady = false;
export function setReady(flag: boolean): void {
  iAmReady = flag;
  $('#ready').classList.toggle('on', flag);
  $('#ready').innerHTML = flag ? `${I.check(16)} Pronto (cancelar)` : 'Pronto!';
}

let toastTimer = 0;
export function toast(html: string, color = '#fff'): void {
  const t = $('#toast'); t.innerHTML = html; t.style.color = color; t.style.opacity = '1';
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (t.style.opacity = '0'), 1600);
}

export function killFeed(d: KilledEvent): void {
  const el = document.createElement('div');
  el.className = 'kill';
  el.innerHTML = `<span style="color:${d.byColor ?? '#fff'}">${esc(d.byName ?? 'A noite')}</span> ${KILL_ICON[d.weapon]?.(16) ?? I.skull(16)} <span style="color:${d.color}">${esc(d.name)}</span>`;
  const feed = $('#feed');
  feed.prepend(el);
  while (feed.children.length > 5) feed.lastElementChild?.remove();
  setTimeout(() => el.remove(), 6000);
}

let dmgFlashUntil = 0;
export function flashDamage(): void { dmgFlashUntil = performance.now() + 150; }
export function isFlashing(now: number): boolean { return now < dmgFlashUntil; }

export function updateHud(): void {
  const state = net.state;
  const ms = myState();
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  $('#board').innerHTML = sorted.map((p) =>
    `<span class="chip${p.id === net.me ? ' me' : ''}${p.dead ? ' dead' : ''}"><i style="background:${p.color}"></i>${esc(p.name)}<b>${p.score}</b></span>`
  ).join('');
  $('#timer').innerHTML = state.phase === 'playing' ? `${I.moon(26)} ${fmt(state.timeLeft)}` : state.phase === 'countdown' ? 'Chacoalha a lata' : '--';

  if (ms) {
    $('#hp i').style.width = `${ms.hp}%`;
    $('#armor i').style.width = `${ms.armor}%`;
    $('#hpText').innerHTML = `${I.hp(20)} ${ms.hp}${ms.armor ? ` <span class="armorTxt">${I.armor(18)} ${ms.armor}</span>` : ''}`;
    const wIcon = ms.weapon === 'bazooka' ? I.bazooka(16) : I.pistol(16);
    const wName = ms.weapon === 'bazooka' ? `Bazuca (${ms.ammo})` : 'Pistola de tinta';
    $('#tool').innerHTML = `<span class="${player.tool === 'spray' ? 'on' : ''}"><kbd>1</kbd> ${I.spray(16)} Spray</span><span class="${player.tool === 'gun' ? 'on' : ''}"><kbd>2</kbd> ${wIcon} ${wName}</span>`;
    const pw = net.cfg?.power;
    if (pw) {
      $('#power').style.opacity = ms.powerReadyIn > 0 ? '0.45' : '1';
      $('#power').innerHTML = `<kbd>Q</kbd> ${POWER_ICON[pw](16)} ${POWER_LABEL[pw]}${ms.powerReadyIn > 0 ? ` (${Math.ceil(ms.powerReadyIn / 1000)}s)` : ''}`;
    }
    $('#push i').style.width = `${100 - ms.meleeReadyIn / 12}%`;
    $('#stun').classList.toggle('on', ms.stunned);
    $('#buffs').innerHTML = [ms.shoes && I.shoes(20), ms.double && I.double(20), ms.shield && I.shieldOn(20), ms.smoke && I.smoke(20)].filter(Boolean).join(' ');
  }

  const ov = $('#overlay');
  $('#lobby').style.display = state.phase === 'lobby' ? 'block' : 'none';
  if (state.phase === 'lobby') {
    ov.classList.remove('hidden');
    $('#ovTitle').textContent = 'Lobby da crew';
    const readyCount = state.players.filter((p) => p.ready).length;
    $('#ovText').textContent = `${state.players.length} na rua · ${readyCount} prontos — compartilhe o link`;
    $('#lobbyList').innerHTML = state.players.map((p) =>
      `<li class="${p.ready ? 'ok' : ''}"><i style="background:${p.color}"></i>${esc(p.name)}${p.id === net.me ? ' (você)' : ''}<b>${p.ready ? `${I.check(14)} PRONTO` : 'esperando'}</b></li>`
    ).join('');
    const min = net.cfg?.minPlayers ?? 2;
    $('#lobbyHint').textContent = state.players.length < min ? `Precisa de pelo menos ${min} jogadores.` : readyCount < state.players.length ? 'A noite começa quando todos estiverem prontos.' : 'Começando…';
    $('#restart').style.display = 'none';
    if (ms && ms.ready !== iAmReady) setReady(ms.ready);
  } else if (state.phase === 'countdown') {
    ov.classList.remove('hidden');
    $('#ovTitle').innerHTML = `<span class="big">${state.timeLeft}</span>`;
    $('#ovText').textContent = 'Piche paredes altas (valem mais), escale prédios, derrube rivais.';
    $('#restart').style.display = 'none';
  } else if (state.phase === 'ended') {
    ov.classList.remove('hidden');
    const w = state.winner;
    $('#ovTitle').innerHTML = w && w.name !== 'Empate' ? `${I.trophy(34)} <span style="color:${w.color}">${esc(w.name)}</span> dominou a cidade!` : `${I.tie(34)} Empate!`;
    const ranked = [...state.players].sort((a, b) => b.score - a.score);
    $('#ovText').innerHTML = ranked.map((p, i) => `${i + 1}. <span style="color:${p.color}">${esc(p.name)}</span> — ${p.score} pts · ${p.tiles} tiles · ${p.kills} kills`).join('<br>');
    $('#restart').style.display = 'inline-block';
    document.exitPointerLock?.();
  } else if (ms?.dead) {
    ov.classList.remove('hidden');
    $('#ovTitle').innerHTML = `${I.skull(34)} Derrubado`;
    $('#ovText').textContent = `Voltando em ${Math.ceil(ms.respawnIn / 1000)}s…`;
    $('#restart').style.display = 'none';
  } else {
    ov.classList.add('hidden');
  }
}
