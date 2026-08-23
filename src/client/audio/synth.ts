// Synthesized one-shots: paint weapons, stingers, UI. Everything is generated from
// oscillators and noise so the whole set shares one character (and no licence).
import { engine, type Pos } from './engine.ts';

let noiseBuf: AudioBuffer | null = null;
function noise(): AudioBuffer {
  const c = engine.ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Exponential-ish envelope on a gain param. */
function env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function osc(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode, t = engine.now, attack = 0.005): void {
  const c = engine.ctx!;
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); env(g, t, peak, attack, dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + attack + dur + 0.05);
}

function burst(dur: number, peak: number, dest: AudioNode, filter: { type: BiquadFilterType; f0: number; f1?: number; q?: number }, t = engine.now): void {
  const c = engine.ctx!;
  const s = c.createBufferSource(); s.buffer = noise();
  const f = c.createBiquadFilter(); f.type = filter.type; f.Q.value = filter.q ?? 0.8;
  f.frequency.setValueAtTime(filter.f0, t);
  if (filter.f1) f.frequency.exponentialRampToValueAtTime(filter.f1, t + dur);
  const g = c.createGain(); env(g, t, peak, 0.003, dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t); s.stop(t + dur + 0.05);
}

const ready = () => engine.ready;

export const synth = {
  /** Paint pistol: a soft pneumatic "thwip" — air pop + tiny pitch drop + wet splat. */
  pistol(at?: Pos, volume = 0.7): void {
    if (!ready()) return;
    const { input, ok } = engine.out(volume, at, 0.25); if (!ok) return;
    burst(0.06, 1, input, { type: 'bandpass', f0: 1800, f1: 600, q: 1.2 });
    osc('sine', 520, 140, 0.09, 0.7, input);
    burst(0.12, 0.35, input, { type: 'lowpass', f0: 900, f1: 300 }, engine.now + 0.03);
  },
  /** Paint bazooka: deep pneumatic launch + whoosh. */
  bazooka(at?: Pos, volume = 0.9): void {
    if (!ready()) return;
    const { input, ok } = engine.out(volume, at, 0.4); if (!ok) return;
    osc('sine', 160, 45, 0.35, 1, input);
    burst(0.3, 0.8, input, { type: 'lowpass', f0: 1400, f1: 200 });
    burst(0.45, 0.3, input, { type: 'bandpass', f0: 500, f1: 2200, q: 0.6 }, engine.now + 0.05);
  },
  /** Paint balloon bursting: wet splat with a thud. */
  splat(at?: Pos, volume = 0.9): void {
    if (!ready()) return;
    const { input, ok } = engine.out(volume, at, 0.5); if (!ok) return;
    osc('sine', 110, 38, 0.4, 1, input);
    burst(0.25, 0.9, input, { type: 'lowpass', f0: 2500, f1: 250, q: 0.5 });
    burst(0.5, 0.25, input, { type: 'bandpass', f0: 900, f1: 400 }, engine.now + 0.08);
  },
  /** Small wet tile splat (a tile got painted). */
  tile(at?: Pos, volume = 0.3): void {
    if (!ready()) return;
    const { input, ok } = engine.out(volume, at, 0.2); if (!ok) return;
    burst(0.07, 1, input, { type: 'bandpass', f0: 1200 + Math.random() * 800, f1: 500, q: 1.5 });
  },
  /** Paint hitting a wall (missed shot). */
  wallHit(at?: Pos, volume = 0.35): void {
    if (!ready()) return;
    const { input, ok } = engine.out(volume, at, 0.4); if (!ok) return;
    burst(0.1, 1, input, { type: 'lowpass', f0: 1600, f1: 300 });
  },
  /** Ability used: soft rising chord swell. */
  power(at?: Pos, volume = 0.6): void {
    if (!ready()) return;
    const { input, ok } = engine.out(volume, at, 0.6); if (!ok) return;
    const t = engine.now;
    for (const [f, d] of [[220, 0], [330, 0.04], [440, 0.08]] as const) osc('triangle', f * 0.98, f, 0.45, 0.35, input, t + d, 0.03);
  },
  shield(volume = 0.6): void {
    if (!ready()) return;
    const { input } = engine.out(volume, undefined, 0.7);
    const t = engine.now;
    osc('sine', 300, 900, 0.5, 0.5, input, t, 0.08);
    burst(0.6, 0.2, input, { type: 'highpass', f0: 3000, f1: 6000 }, t);
  },
  pickup(volume = 0.6): void {
    if (!ready()) return;
    const { input } = engine.out(volume, undefined, 0.3);
    const t = engine.now;
    osc('triangle', 660, 660, 0.08, 0.5, input, t);
    osc('triangle', 990, 990, 0.14, 0.5, input, t + 0.07);
  },
  hurt(volume = 0.85): void {
    if (!ready()) return;
    const { input } = engine.out(volume, undefined, 0.2);
    osc('square', 180, 90, 0.12, 0.25, input);
    burst(0.08, 0.6, input, { type: 'lowpass', f0: 1200, f1: 400 });
  },
  // ---- UI ----
  click(volume = 0.5): void { if (!ready()) return; const { input } = engine.out(volume, undefined, 0); burst(0.03, 1, input, { type: 'bandpass', f0: 2400, q: 2 }); },
  hover(volume = 0.3): void { if (!ready()) return; const { input } = engine.out(volume, undefined, 0); osc('sine', 900, 1100, 0.04, 0.5, input); },
  error(volume = 0.5): void { if (!ready()) return; const { input } = engine.out(volume, undefined, 0.1); osc('square', 220, 160, 0.18, 0.3, input); },
  tick(high = false, volume = 0.5): void { if (!ready()) return; const { input } = engine.out(volume, undefined, 0.2); osc('sine', high ? 1320 : 880, high ? 1320 : 880, 0.08, 0.6, input); },

  // ---- Stingers (short musical phrases, A minor, lo-fi) ----
  stinger(kind: 'start' | 'kill' | 'death' | 'victory' | 'defeat' | 'ready', volume = 0.8): void {
    if (!ready()) return;
    const { input } = engine.out(volume, undefined, 0.8);
    const t = engine.now;
    const note = (f: number, at: number, dur: number, peak = 0.5, type: OscillatorType = 'triangle') => osc(type, f, f, dur, peak, input, t + at, 0.01);
    const A3 = 220, C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392, A4 = 440, C5 = 523.25, E5 = 659.25, A5 = 880, F3 = 174.61, E3 = 164.81, A2 = 110;
    switch (kind) {
      case 'start': // rising run into a hit
        [A3, C4, E4, A4].forEach((f, i) => note(f, i * 0.07, 0.12, 0.4));
        note(A4, 0.3, 0.5, 0.5); note(E5, 0.3, 0.5, 0.3); osc('sine', 110, 55, 0.35, 0.8, input, t + 0.3);
        engine.duckFor(1.2, 0.3);
        break;
      case 'kill':
        note(E5, 0, 0.08, 0.5); note(A5, 0.08, 0.22, 0.5); note(A4, 0.08, 0.22, 0.25);
        engine.duckFor(0.5, 0.55);
        break;
      case 'death':
        note(E4, 0, 0.25, 0.4, 'sawtooth'); note(D4, 0.22, 0.25, 0.35, 'sawtooth'); note(A3, 0.44, 0.7, 0.4, 'sawtooth');
        osc('sine', 90, 40, 0.9, 0.7, input, t);
        engine.duckFor(1.4, 0.3);
        break;
      case 'victory':
        [A4, C5, E5, A5].forEach((f, i) => note(f, i * 0.11, 0.5, 0.45));
        [A3, E4].forEach((f) => note(f, 0.44, 1.2, 0.3));
        note(A5, 0.44, 1.2, 0.35); osc('sine', 110, 110, 1.2, 0.5, input, t + 0.44, 0.05);
        engine.duckFor(2.2, 0.25);
        break;
      case 'defeat':
        [E4, D4, C4, A3].forEach((f, i) => note(f, i * 0.28, 0.5, 0.45, 'sawtooth'));
        note(F3, 0.84, 1.4, 0.35, 'sawtooth'); note(E3, 1.1, 1.2, 0.3, 'sawtooth');
        osc('sine', 70, 38, 1.6, 0.9, input, t + 0.84);
        burst(1.2, 0.15, input, { type: 'lowpass', f0: 400, f1: 120 }, t + 0.84);
        engine.duckFor(2.8, 0.2);
        break;
      case 'ready':
        note(A4, 0, 0.1, 0.4); note(E5, 0.1, 0.3, 0.4);
        break;
    }
    void A2;
  }
};
