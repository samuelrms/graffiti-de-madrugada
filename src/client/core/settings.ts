// Player settings persisted in localStorage (language, audio, look sensitivity).
export type Lang = 'pt-BR' | 'en';

export interface Settings {
  lang: Lang;
  master: number;
  sfx: number;
  music: number;
  sensitivity: number;
  padSensitivity: number;
  invertY: boolean;
}

const KEY = 'gdm:settings';

function detectLang(): Lang {
  const nav = (navigator.language || 'pt-BR').toLowerCase();
  return nav.startsWith('pt') ? 'pt-BR' : 'en';
}

export const DEFAULTS: Settings = {
  lang: detectLang(),
  master: 0.8,
  sfx: 1,
  music: 0.5,
  sensitivity: 1,
  padSensitivity: 1,
  invertY: false
};

export const settings: Settings = { ...DEFAULTS, ...safeLoad() };

function safeLoad(): Partial<Settings> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>; } catch { return {}; }
}

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

export function onSettings(fn: Listener): void { listeners.add(fn); }

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  localStorage.setItem(KEY, JSON.stringify(settings));
  for (const fn of listeners) fn(settings);
}
