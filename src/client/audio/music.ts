// Procedural lo-fi loop: 86 BPM with swing, kick / snare / hats, a triangle bass
// on A minor pentatonic, two detuned-saw chords through a slow lowpass, and vinyl
// crackle. Scheduled with a lookahead timer so it never drifts.
// Intensity: 'lobby' (chords + crackle), 'match' (full beat), 'off'.
import { engine } from './engine.ts';

type Level = 'off' | 'lobby' | 'match';
const BPM = 86;
const STEP = 60 / BPM / 4; // sixteenth
const SWING = 0.08; // fraction of a step added to off-beat sixteenths

// 2 bars x 16 steps. A minor: Am7 -> Fmaj7
const KICK = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
const HAT = [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0];
const BASS: Array<number | 0> = [55, 0, 0, 55, 0, 0, 82.41, 0, 0, 0, 98, 0, 0, 0, 73.42, 0, 43.65, 0, 0, 43.65, 0, 0, 65.41, 0, 0, 0, 55, 0, 0, 0, 49, 0];
const CHORDS: number[][] = [[220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63]]; // Am7, Fmaj7 (one per bar)

let level: Level = 'off';
let timer = 0;
let nextTime = 0;
let step = 0;
let crackle: AudioBufferSourceNode | null = null;
let bus: GainNode | null = null;
let chordFilter: BiquadFilterNode | null = null;

function ensureBus(): GainNode {
  const c = engine.ctx!;
  if (!bus) {
    bus = c.createGain(); bus.gain.value = 0;
    // gentle lo-fi: roll off the top, tiny saturation via waveshaper
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    shaper.curve = curve;
    bus.connect(lp); lp.connect(shaper); shaper.connect(engine.music);
    chordFilter = c.createBiquadFilter(); chordFilter.type = 'lowpass'; chordFilter.frequency.value = 900; chordFilter.Q.value = 0.7;
    chordFilter.connect(bus);
  }
  return bus;
}

function kick(t: number): void {
  const c = engine.ctx!;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = c.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  o.connect(g); g.connect(bus!); o.start(t); o.stop(t + 0.35);
}
function snare(t: number): void {
  const c = engine.ctx!;
  const s = c.createBufferSource(); s.buffer = noiseBuffer();
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
  const g = c.createGain(); g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  s.connect(f); f.connect(g); g.connect(bus!); s.start(t); s.stop(t + 0.2);
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
  const g2 = c.createGain(); g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g2); g2.connect(bus!); o.start(t); o.stop(t + 0.14);
}
function hat(t: number, open: boolean): void {
  const c = engine.ctx!;
  const s = c.createBufferSource(); s.buffer = noiseBuffer();
  const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = c.createGain(); g.gain.setValueAtTime(open ? 0.16 : 0.11, t); g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.22 : 0.05));
  s.connect(f); f.connect(g); g.connect(bus!); s.start(t); s.stop(t + 0.25);
}
function bass(t: number, f: number): void {
  const c = engine.ctx!;
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
  o.connect(lp); lp.connect(g); g.connect(bus!); o.start(t); o.stop(t + 0.45);
}
function chord(t: number, notes: number[], dur: number): void {
  const c = engine.ctx!;
  for (const n of notes) for (const det of [-6, 6]) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = n; o.detune.value = det;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.25); g.gain.setValueAtTime(0.045, t + dur - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(chordFilter!); o.start(t); o.stop(t + dur + 0.05);
  }
}

let nb: AudioBuffer | null = null;
function noiseBuffer(): AudioBuffer {
  const c = engine.ctx!;
  if (!nb) { nb = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return nb;
}
function startCrackle(): void {
  const c = engine.ctx!;
  if (crackle) return;
  const buf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 0.8 : (Math.random() * 2 - 1) * 0.004;
  crackle = c.createBufferSource(); crackle.buffer = buf; crackle.loop = true;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
  const g = c.createGain(); g.gain.value = 0.5;
  crackle.connect(hp); hp.connect(g); g.connect(bus!); crackle.start();
}

function schedule(): void {
  const c = engine.ctx!;
  const lookahead = 0.25;
  while (nextTime < c.currentTime + lookahead) {
    const i = step % 32;
    const t = nextTime + (i % 2 === 1 ? STEP * SWING : 0);
    if (i % 16 === 0) chord(t, CHORDS[(step / 16 | 0) % 2], STEP * 16);
    if (level === 'match') {
      if (KICK[i]) kick(t);
      if (SNARE[i]) snare(t);
      if (HAT[i]) hat(t, i % 8 === 6);
      const b = BASS[i]; if (b) bass(t, b);
    }
    nextTime += STEP;
    step++;
  }
}

export const music = {
  set(next: Level): void {
    if (!engine.ctx) { level = next; return; }
    const c = engine.ctx;
    ensureBus();
    const target = next === 'off' ? 0 : next === 'lobby' ? 0.4 : 0.55;
    bus!.gain.setTargetAtTime(target, c.currentTime, 0.6);
    if (chordFilter) chordFilter.frequency.setTargetAtTime(next === 'match' ? 1400 : 800, c.currentTime, 1.2);
    if (next !== 'off' && level === 'off') {
      nextTime = c.currentTime + 0.1; step = 0;
      startCrackle();
      clearInterval(timer); timer = window.setInterval(schedule, 80);
    }
    if (next === 'off') { clearInterval(timer); timer = 0; }
    level = next;
  },
  get level(): Level { return level; },
  /** Re-apply after the context is created (settings/unlock). */
  resume(): void { const l = level; level = 'off'; this.set(l); }
};
