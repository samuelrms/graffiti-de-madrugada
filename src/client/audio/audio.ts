// Web Audio: CC0 samples (see public/audio/CREDITS.txt) + a synthesized spray hiss.
// Positional sounds use distance attenuation and stereo panning relative to the listener.
import { onSettings, settings } from '../core/settings.ts';

export type Sfx =
  | 'step' | 'land' | 'jump' | 'climb' | 'pistol' | 'bazooka' | 'explosion' | 'punch' | 'hurt' | 'hit_wall'
  | 'paint_tile' | 'pickup' | 'power' | 'shield' | 'ui_click' | 'ui_hover' | 'ui_ready' | 'ui_error'
  | 'countdown' | 'match_start' | 'kill' | 'death' | 'victory' | 'defeat' | 'boom';

/** Files per sound; several variants are picked at random. */
const FILES: Record<Sfx, string[]> = {
  step: ['step_0', 'step_1', 'step_2', 'step_3', 'step_4'],
  land: ['land'], jump: ['jump'], climb: ['climb'],
  pistol: ['pistol_0', 'pistol_1', 'pistol_2'], bazooka: ['bazooka'], explosion: ['explosion_0', 'explosion_1'],
  punch: ['punch'], hurt: ['hurt'], hit_wall: ['hit_wall'], paint_tile: ['paint_tile'],
  pickup: ['pickup'], power: ['power'], shield: ['shield'],
  ui_click: ['ui_click'], ui_hover: ['ui_hover'], ui_ready: ['ui_ready'], ui_error: ['ui_error'],
  countdown: ['countdown'], match_start: ['match_start'], kill: ['kill'], death: ['death'], victory: ['victory'], defeat: ['defeat'], boom: ['boom']
};
/** Jingles are "music"; everything else is an effect. */
const MUSIC: Set<Sfx> = new Set(['match_start', 'kill', 'death', 'victory', 'defeat', 'boom']);

let ctx: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musicBus: GainNode;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
const listener = { x: 0, y: 0, z: 0, yaw: 0 };

export const audio = {
  get ready() { return !!ctx && ctx.state === 'running'; },
  /** Must be called from a user gesture (click/key) the first time. */
  unlock(): void {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain(); sfxBus = ctx.createGain(); musicBus = ctx.createGain();
      sfxBus.connect(master); musicBus.connect(master); master.connect(ctx.destination);
      applyVolumes();
      onSettings(applyVolumes);
      void ctx.resume();
      startAmbient();
      // warm the cache
      for (const k of Object.keys(FILES) as Sfx[]) for (const f of FILES[k]) void load(f);
    } else if (ctx.state !== 'running') {
      void ctx.resume();
    }
  },
  setListener(x: number, y: number, z: number, yaw: number): void { listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw; },
  play(name: Sfx, opts: { volume?: number; rate?: number; at?: { x: number; y: number; z: number } } = {}): void {
    if (!ctx || ctx.state !== 'running') return;
    const files = FILES[name];
    const file = files[Math.floor(Math.random() * files.length)];
    const buf = buffers.get(file);
    if (!buf) { void load(file); return; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * (0.95 + Math.random() * 0.1);
    const gain = ctx.createGain();
    let vol = opts.volume ?? 1;
    let node: AudioNode = gain;
    if (opts.at) {
      const dx = opts.at.x - listener.x, dy = opts.at.y - listener.y, dz = opts.at.z - listener.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 60) return;
      vol *= 1 / (1 + d * d / 60);
      const pan = ctx.createStereoPanner();
      // right vector of the listener: (cos yaw, 0, -sin yaw)
      const right = (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / (d || 1);
      pan.pan.value = Math.max(-1, Math.min(1, right * 0.8));
      gain.connect(pan); node = pan;
    }
    gain.gain.value = vol;
    src.connect(gain);
    node.connect(MUSIC.has(name) ? musicBus : sfxBus);
    src.start();
  },
  /** Looping spray hiss (synthesized): on/off, optionally positional. */
  spray(on: boolean, key: string, at?: { x: number; y: number; z: number }): void {
    if (!ctx || ctx.state !== 'running') return;
    const cur = sprays.get(key);
    if (on && !cur) sprays.set(key, makeSpray(at));
    else if (!on && cur) { cur.stop(); sprays.delete(key); }
    else if (on && cur && at) cur.move(at);
  },
  stopAllSprays(): void { for (const s of sprays.values()) s.stop(); sprays.clear(); }
};

function applyVolumes(): void {
  if (!ctx) return;
  master.gain.value = settings.master;
  sfxBus.gain.value = settings.sfx;
  musicBus.gain.value = settings.music;
}

async function load(file: string): Promise<AudioBuffer | null> {
  if (buffers.has(file)) return buffers.get(file)!;
  if (loading.has(file)) return loading.get(file)!;
  const p = (async () => {
    try {
      const res = await fetch(`/audio/${file}.ogg`);
      const buf = await ctx!.decodeAudioData(await res.arrayBuffer());
      buffers.set(file, buf);
      return buf;
    } catch { return null; }
  })();
  loading.set(file, p);
  return p;
}

// ---------- Synthesized spray hiss ----------
interface Spray { stop(): void; move(at: { x: number; y: number; z: number }): void }
const sprays = new Map<string, Spray>();
let noiseBuffer: AudioBuffer | null = null;

function makeSpray(at?: { x: number; y: number; z: number }): Spray {
  const c = ctx!;
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.7;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
  const gain = c.createGain(); gain.gain.value = 0;
  const pan = c.createStereoPanner();
  src.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(pan); pan.connect(sfxBus);
  // tiny rattle of the can's ball at the start
  const rattle = c.createOscillator(); rattle.type = 'square'; rattle.frequency.value = 38;
  const rg = c.createGain(); rg.gain.value = 0.03;
  rattle.connect(rg); rg.connect(sfxBus); rattle.start(); rattle.stop(c.currentTime + 0.12);
  const base = 0.22;
  const move = (p: { x: number; y: number; z: number }) => {
    const dx = p.x - listener.x, dz = p.z - listener.z; const d = Math.hypot(dx, p.y - listener.y, dz);
    gain.gain.setTargetAtTime(base / (1 + d * d / 40), c.currentTime, 0.05);
    pan.pan.value = Math.max(-1, Math.min(1, ((dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / (d || 1)) * 0.8));
  };
  if (at) move(at); else gain.gain.setTargetAtTime(base, c.currentTime, 0.03);
  src.start();
  return {
    stop() { gain.gain.setTargetAtTime(0, c.currentTime, 0.04); src.stop(c.currentTime + 0.3); },
    move
  };
}

// ---------- Ambient: distant city hum (CC0 loop) + synthesized wind ----------
function startAmbient(): void {
  const c = ctx!;
  void load('ambient').then((buf) => {
    if (!buf || !ctx) return;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = 0.6;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = c.createGain(); g.gain.value = 0.12;
    src.connect(lp); lp.connect(g); g.connect(musicBus); src.start();
  });
}
