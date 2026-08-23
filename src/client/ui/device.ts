// Touch devices: landscape is mandatory (a rotate gate blocks portrait), and we
// go fullscreen + lock orientation on the first tap where the browser allows it
// (Android/Chrome). iPhone Safari has no Fullscreen API for pages: the gate tells
// the player to rotate and suggests "Add to Home Screen" (standalone = fullscreen).
import { t } from '../core/i18n.ts';
import { $, isTouch } from '../core/state.ts';
import { I } from './icons.ts';

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const isPortrait = () => matchMedia('(orientation: portrait)').matches || innerHeight > innerWidth;

export function setupDevice(): void {
  if (!isTouch) return;
  document.body.classList.add('touch');
  if (isIOS) document.body.classList.add('ios');
  renderGate();
  const update = () => {
    const portrait = isPortrait();
    document.body.classList.toggle('portrait', portrait);
    $('#rotate').classList.toggle('hidden', !portrait);
  };
  update();
  addEventListener('resize', update);
  addEventListener('orientationchange', () => setTimeout(update, 150));
  screen.orientation?.addEventListener?.('change', update);

  // First tap in landscape: fullscreen + orientation lock where supported.
  const goFullscreen = () => {
    if (isPortrait()) return;
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement) {
      const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
      req?.({ navigationUI: 'hide' } as FullscreenOptions)?.catch(() => { /* not allowed (iOS) */ });
    }
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    so.lock?.('landscape').catch(() => { /* unsupported or not fullscreen */ });
  };
  addEventListener('pointerdown', goFullscreen, { passive: true });
  // Hide the Safari toolbar as much as a page can: scroll past the top after load.
  addEventListener('load', () => setTimeout(() => scrollTo(0, 1), 300));
}

function renderGate(): void {
  const gate = document.createElement('div');
  gate.id = 'rotate';
  gate.className = 'hidden';
  gate.innerHTML = `<div class="rotateCard">${I.rotate(48)}<h2>${t('rotate.title')}</h2><p>${t('rotate.text')}</p>${isIOS && !standalone ? `<p class="hint">${t('rotate.ios')}</p>` : ''}</div>`;
  document.body.append(gate);
}
