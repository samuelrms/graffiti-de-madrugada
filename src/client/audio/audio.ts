// Audio facade used by the game. Foley (steps, punches, impacts) comes from CC0
// samples (public/audio/CREDITS.txt); weapons, stingers, UI, music and ambience
// are synthesized (synth.ts, music.ts, ambient.ts) through the shared engine.
import { startAmbient } from './ambient.ts';
import { engine, type Pos } from './engine.ts';
import { music } from './music.ts';
import { synth } from './synth.ts';

export type Sample = 'step' | 'land' | 'jump' | 'climb' | 'explosion' | 'punch';
const FILES: Record<Sample, string[]> = {
  step: ['step_0', 'step_1', 'step_2', 'step_3', 'step_4'],
  land: ['land'], jump: ['jump'], climb: ['climb'],
  explosion: ['explosion_0', 'explosion_1'],
  punch: ['punch']
};

const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

async function load(file: string): Promise<AudioBuffer | null> {
  if (buffers.has(file)) return buffers.get(file)!;
  if (loading.has(file)) return loading.get(file)!;
  const p = (async () => {
    try {
      const res = await fetch(`/audio/${file}.ogg`);
      const buf = await engine.ctx!.decodeAudioData(await res.arrayBuffer());
      buffers.set(file, buf);
      return buf;
    } catch { return null; }
  })();
  loading.set(file, p);
  return p;
}

interface PlayOpts { volume?: number; rate?: number; at?: Pos; reverb?: number }

export const audio = {
  get ready() { return engine.ready; },
  /** Must be called from a user gesture (click/key/touch) the first time. */
  unlock(): void {
    const first = !engine.ctx;
    engine.unlock();
    if (first) {
      startAmbient();
      music.resume();
      for (const k of Object.keys(FILES) as Sample[]) for (const f of FILES[k]) void load(f);
    }
  },
  setListener(x: number, y: number, z: number, yaw: number): void { engine.setListener(x, y, z, yaw); },
  /** CC0 sample one-shot. */
  sample(name: Sample, opts: PlayOpts = {}): void {
    if (!engine.ready) return;
    const files = FILES[name];
    const file = files[Math.floor(Math.random() * files.length)];
    const buf = buffers.get(file);
    if (!buf) { void load(file); return; }
    const { input, ok } = engine.out(opts.volume ?? 1, opts.at, opts.reverb ?? 0.3);
    if (!ok) return;
    const src = engine.ctx!.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * (0.94 + Math.random() * 0.12);
    src.connect(input);
    src.start();
  },
  synth,
  music,
  /** exposed for tooling (level meters in tests) */
  engine,
  /** Looping spray hiss (synthesized): on/off per source, optionally positional. */
  spray(on: boolean, key: string, at?: Pos): void {
    if (!engine.ready) return;
    const cur = sprays.get(key);
    if (on && !cur) sprays.set(key, makeSpray(at));
    else if (!on && cur) { cur.stop(); sprays.delete(key); }
    else if (on && cur && at) cur.move(at);
  },
  stopAllSprays(): void { for (const s of sprays.values()) s.stop(); sprays.clear(); }
};

// ---------- Spray hiss ----------
interface Spray { stop(): void; move(at: Pos): void }
const sprays = new Map<string, Spray>();
let noiseBuffer: AudioBuffer | null = null;

function makeSpray(at?: Pos): Spray {
  const c = engine.ctx!;
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3400; bp.Q.value = 0.8;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1100;
  // slight flutter so it does not sound like a static hiss
  const lfo = c.createOscillator(); lfo.frequency.value = 9; const lfoG = c.createGain(); lfoG.gain.value = 400;
  lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start();
  const gain = c.createGain(); gain.gain.value = 0;
  const pan = c.createStereoPanner();
  src.connect(bp); bp.connect(hp); hp.connect(gain); gain.connect(pan); pan.connect(engine.sfx);
  const send = c.createGain(); send.gain.value = 0.15; pan.connect(send); send.connect(engine.reverbSend);
  // ball rattle when the can starts
  const rattle = c.createOscillator(); rattle.type = 'square'; rattle.frequency.value = 34;
  const rg = c.createGain(); rg.gain.value = 0.025; rattle.connect(rg); rg.connect(engine.sfx);
  rattle.start(); rattle.stop(c.currentTime + 0.1);
  const base = 0.2;
  const move = (p: Pos) => {
    const s = engine.spatial(p, 40);
    gain.gain.setTargetAtTime(s ? base * s.gain : 0, c.currentTime, 0.05);
    if (s) pan.pan.value = s.pan;
  };
  if (at) move(at); else gain.gain.setTargetAtTime(base, c.currentTime, 0.03);
  src.start();
  return {
    stop() { gain.gain.setTargetAtTime(0, c.currentTime, 0.04); src.stop(c.currentTime + 0.3); lfo.stop(c.currentTime + 0.3); },
    move
  };
}
