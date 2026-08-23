// Pause menu (Esc / Start): resume, settings, controls, leave. The match keeps running.
import { audio } from '../audio/audio.ts';
import { applyStatic, t } from '../core/i18n.ts';
import { settings, updateSettings, type Lang } from '../core/settings.ts';
import { $, net } from '../core/state.ts';
import { I } from './icons.ts';

let open = false;
export const isPaused = () => open;
let onLanguageChange: (() => void) | null = null;
let onLeave: (() => void) | null = null;

export function setupPause(hooks: { onLanguageChange: () => void; onLeave: () => void }): void {
  onLanguageChange = hooks.onLanguageChange;
  onLeave = hooks.onLeave;
  renderControls();
  const lang = $<HTMLSelectElement>('#setLang');
  lang.value = settings.lang;
  lang.addEventListener('change', () => { updateSettings({ lang: lang.value as Lang }); applyStatic(); renderControls(); onLanguageChange?.(); });
  bindRange('#setMaster', 'master'); bindRange('#setSfx', 'sfx'); bindRange('#setMusic', 'music');
  bindRange('#setSens', 'sensitivity'); bindRange('#setPadSens', 'padSensitivity');
  const inv = $<HTMLInputElement>('#setInvertY');
  inv.checked = settings.invertY;
  inv.addEventListener('change', () => updateSettings({ invertY: inv.checked }));
  $('#pauseResume').addEventListener('click', () => { audio.synth.click(); closePause(); });
  $('#pauseLeave').addEventListener('click', () => { audio.synth.click(); closePause(); onLeave?.(); });
  document.querySelectorAll<HTMLButtonElement>('#pauseTabs button').forEach((b) => b.addEventListener('click', () => {
    audio.synth.click();
    document.querySelectorAll('#pauseTabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll<HTMLElement>('.pausePane').forEach((p) => { p.style.display = p.id === b.dataset.pane ? '' : 'none'; });
  }));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && net.cfg) { e.preventDefault(); togglePause(); } });
}

function bindRange(sel: string, key: 'master' | 'sfx' | 'music' | 'sensitivity' | 'padSensitivity'): void {
  const el = $<HTMLInputElement>(sel);
  el.value = String(settings[key]);
  el.addEventListener('input', () => updateSettings({ [key]: Number(el.value) }));
  el.addEventListener('change', () => audio.synth.hover());
}

export function togglePause(): void { if (open) closePause(); else openPause(); }
export function openPause(): void {
  if (!net.cfg) return;
  open = true;
  $('#pause').classList.remove('hidden');
  document.body.classList.add('paused');
  document.exitPointerLock?.();
  audio.synth.click();
}
export function closePause(): void {
  open = false;
  $('#pause').classList.add('hidden');
  document.body.classList.remove('paused');
}

function renderControls(): void {
  const rows: Array<[string, string, string]> = [
    ['ctl.move', 'WASD / ←↑↓→', t('ctl.pad.move')], ['ctl.run', 'Shift', t('ctl.pad.run')], ['ctl.look', 'Mouse', t('ctl.pad.look')],
    ['ctl.jump', 'Space', t('ctl.pad.jump')], ['ctl.use', 'Click', t('ctl.pad.use')], ['ctl.swap', '1 / 2 / wheel', t('ctl.pad.swap')],
    ['ctl.melee', 'F', t('ctl.pad.melee')], ['ctl.power', 'Q', t('ctl.pad.power')], ['ctl.menu', 'Esc', t('ctl.pad.menu')]
  ];
  $('#ctlTable').innerHTML = `<tr><th></th><th>${I.users(14)} ${t('ctl.keyboard')}</th><th>${t('ctl.gamepad')}</th></tr>` +
    rows.map(([k, kb, pad]) => `<tr><td>${t(k as never)}</td><td><kbd>${kb}</kbd></td><td><kbd>${pad}</kbd></td></tr>`).join('');
}
