// Home screen: list public rooms, create a room (optionally locked), join by id or name.
// Room links look like /#r=abc123 so a locked room can be shared by URL alone.
import type { JoinError, RoomInfo } from '../../shared/protocol.ts';
import { t } from '../core/i18n.ts';
import { audio } from '../audio/audio.ts';
import { esc } from './hud.ts';
import { I } from './icons.ts';
import { socket } from '../net/socket.ts';
import { $, net } from '../core/state.ts';

export const room = { info: null as RoomInfo | null };
export const isOwner = () => !!room.info && room.info.ownerId === net.me;
const NAME_KEY = 'gdm:name';
const CLIENT_KEY = 'gdm:client';
let pollTimer = 0;

/** Per-browser token: the server allows one player per token (no multi-tab). */
export function clientToken(): string {
  let t = localStorage.getItem(CLIENT_KEY);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(CLIENT_KEY, t); }
  return t;
}

export function roomIdFromUrl(): string | null {
  const m = location.hash.match(/[#&]r=([a-z0-9]{4,12})/i);
  return m ? m[1].toLowerCase() : null;
}
export function roomLink(id: string): string { return `${location.origin}${location.pathname}#r=${id}`; }

export function playerName(): string { return ($<HTMLInputElement>('#homeName').value || localStorage.getItem(NAME_KEY) || '').trim().slice(0, 12); }

export function joinRoom(key: string): void {
  const name = playerName();
  if (name) localStorage.setItem(NAME_KEY, name);
  $('#homeError').textContent = '';
  socket.emit('join', { room: key, name: name || undefined, client: clientToken() });
}

export async function createRoom(name: string, locked: boolean): Promise<void> {
  const r = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, locked }) });
  if (!r.ok) { $('#homeError').textContent = t('home.createFail'); audio.synth.error(); return; }
  const info = (await r.json()) as RoomInfo;
  joinRoom(info.id);
}

export function showHome(): void {
  document.body.classList.remove('inroom');
  $('#home').classList.remove('hidden');
  $('#overlay').classList.add('hidden');
  history.replaceState(null, '', location.pathname);
  void refreshRooms();
  clearInterval(pollTimer);
  pollTimer = window.setInterval(() => { void refreshRooms(); }, 3000);
}
export function hideHome(): void {
  document.body.classList.add('inroom');
  $('#home').classList.add('hidden');
  clearInterval(pollTimer);
}

async function refreshRooms(): Promise<void> {
  try {
    const rooms = (await (await fetch('/api/rooms')).json()) as RoomInfo[];
    const list = $('#roomList');
    if (!rooms.length) { list.innerHTML = `<li class="empty">${t('home.noRooms')}</li>`; return; }
    const PHASE: Record<string, string> = { lobby: t('phase.lobby'), countdown: t('phase.countdown'), playing: t('phase.playing'), ended: t('phase.ended') };
    list.innerHTML = rooms.map((r) =>
      `<li><button data-join="${r.id}"><b>${esc(r.name)}</b><span>${I.users(14)} ${r.players}/${r.maxPlayers} · ${PHASE[r.phase] ?? r.phase}</span><code>${r.id}</code></button></li>`
    ).join('');
  } catch { /* server unreachable; keep the old list */ }
}

const joinError = (r: JoinError): string => t((`join.${r}`) as never) || t('join.generic');

export function renderHomeLabels(): void {
  $('#quickplay').innerHTML = `${I.zap(18)} ${t('home.quickplay')}`;
  $('#createBtn').innerHTML = `${I.plus(16)} ${t('home.create')}`;
  $('#joinBtn').innerHTML = `${I.login(16)} ${t('home.join')}`;
  $('#lockLabel').innerHTML = `${I.lock(16)} ${t('home.locked')}`;
  $('#credits').innerHTML = t('home.credits', { author: '<a href="https://samuelramos.dev" rel="author">Samuel Ramos</a>' });
  if (room.info) renderRoomBadge(room.info);
}

export function setupHome(): void {
  const nameInput = $<HTMLInputElement>('#homeName');
  nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
  renderHomeLabels();

  $('#quickplay').addEventListener('click', () => {
    audio.synth.click();
    const name = playerName();
    if (name) localStorage.setItem(NAME_KEY, name);
    $('#homeError').textContent = '';
    socket.emit('quickplay', { name: name || undefined, client: clientToken() });
  });
  $('#createForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('#roomName').value.trim() || t('home.roomOf', { name: playerName() || t('home.someone') });
    void createRoom(name, $<HTMLInputElement>('#roomLocked').checked);
  });
  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = $<HTMLInputElement>('#joinKey').value.trim();
    if (key) joinRoom(key);
  });
  $('#roomList').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-join]');
    if (btn?.dataset.join) joinRoom(btn.dataset.join);
  });
  $('#leaveBtn').addEventListener('click', () => { socket.emit('leave'); net.cfg = null; location.hash = ''; location.reload(); });
  $('#copyLink').addEventListener('click', async () => {
    if (!net.cfg) return;
    await navigator.clipboard?.writeText(roomLink(net.cfg.room.id));
    $('#copyLink').innerHTML = `${I.check(14)} ${t('room.copied')}`;
    setTimeout(() => { $('#copyLink').innerHTML = `${I.link(14)} ${t('room.copyLink')}`; }, 1500);
  });

  socket.on('joinError', (e) => {
    showHome();
    $('#homeError').textContent = joinError(e.reason);
    audio.synth.error();
  });
  socket.on('welcome', (w) => {
    hideHome();
    history.replaceState(null, '', `#r=${w.room.id}`);
    renderRoomBadge(w.room);
  });
  socket.on('roomInfo', renderRoomBadge);
  socket.on('roomClosed', () => {
    net.cfg = null;
    showHome();
    $('#homeError').textContent = t('home.closedByOwner');
  });
  $('#modeForm').addEventListener('change', () => {
    const mode = $<HTMLSelectElement>('#modeSelect').value as 'ffa' | 'teams';
    const teams = Number($<HTMLSelectElement>('#teamsSelect').value);
    $('#teamsSelect').style.display = mode === 'teams' ? '' : 'none';
    socket.emit('setMode', { mode, teams });
  });
  $('#closeRoom').addEventListener('click', () => socket.emit('closeRoom'));
  // Deep link: join straight away; otherwise show the home. The socket may have
  // connected while the (heavy) scene was still being built, so check both ways.
  const onConnect = () => {
    const id = roomIdFromUrl();
    if (id && !net.cfg) joinRoom(id); else if (!net.cfg) showHome();
  };
  socket.on('connect', onConnect);
  if (socket.connected) onConnect();
}

function renderRoomBadge(r: RoomInfo): void {
  room.info = r;
  const modeTxt = r.mode === 'teams' ? t('room.teams', { n: r.teams }) : t('room.ffa');
  $('#roomBadge').innerHTML = `${r.locked ? I.lock(14) : I.users(14)} <b>${esc(r.name)}</b> <code>${r.id}</code> · ${modeTxt} <button id="copyLinkInline">${I.link(14)}</button>`;
  $('#copyLinkInline').addEventListener('click', () => $('#copyLink').click());
  $('#copyLink').innerHTML = `${I.link(14)} ${t('room.copyLink')}`;
  $('#lobbyRoom').innerHTML = `${r.locked ? I.lock(16) : I.users(16)} ${esc(r.name)} · <code>${r.id}</code>${r.locked ? ` · ${t('room.locked')}` : ''} · ${modeTxt}`;
  for (const o of $<HTMLSelectElement>('#teamsSelect').options) o.textContent = t('room.teamsN', { n: o.value });
  const owner = isOwner();
  $('#ownerBox').style.display = owner ? '' : 'none';
  $('#closeRoom').style.display = owner ? '' : 'none';
  if (owner) {
    $<HTMLSelectElement>('#modeSelect').value = r.mode;
    $<HTMLSelectElement>('#teamsSelect').value = String(r.teams);
    $('#teamsSelect').style.display = r.mode === 'teams' ? '' : 'none';
  }
}
