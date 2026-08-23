// Night city ambience, fully synthesized: wind (brown noise through a slowly
// moving lowpass), a 50 Hz electrical hum with harmonics, distant traffic
// (filtered noise sweeps panned left/right) and sparse crickets.
import { engine } from './engine.ts';

let started = false;
let carTimer = 0;
let cricketTimer = 0;

export function startAmbient(): void {
  if (started || !engine.ctx) return;
  started = true;
  const c = engine.ctx;
  const out = engine.ambient;

  // Wind: brown noise -> lowpass with a slow LFO on the cutoff.
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  const wind = c.createBufferSource(); wind.buffer = buf; wind.loop = true;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.5;
  const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
  const lfoGain = c.createGain(); lfoGain.gain.value = 180;
  lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
  const wg = c.createGain(); wg.gain.value = 0.16;
  wind.connect(lp); lp.connect(wg); wg.connect(out);
  wind.start(); lfo.start();

  // Electrical hum from the street lamps.
  for (const [f, v] of [[50, 0.012], [100, 0.006], [150, 0.003]] as const) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = c.createGain(); g.gain.value = v; o.connect(g); g.connect(out); o.start();
  }

  const car = () => {
    if (!engine.ready) return;
    const t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.6;
    const dur = 3 + Math.random() * 3;
    f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(900, t + dur * 0.5); f.frequency.linearRampToValueAtTime(180, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = c.createStereoPanner(); const dir = Math.random() < 0.5 ? 1 : -1;
    pan.pan.setValueAtTime(-dir, t); pan.pan.linearRampToValueAtTime(dir, t + dur);
    s.connect(f); f.connect(g); g.connect(pan); pan.connect(out);
    s.start(t); s.stop(t + dur + 0.1);
  };
  const cricket = () => {
    if (!engine.ready) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 4200 + Math.random() * 600;
    const g = c.createGain(); g.gain.value = 0;
    const pan = c.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g); g.connect(pan); pan.connect(out); o.start(t);
    const chirps = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < chirps; i++) { const a = t + i * 0.09; g.gain.setValueAtTime(0.012, a); g.gain.setValueAtTime(0, a + 0.04); }
    o.stop(t + chirps * 0.09 + 0.1);
  };
  const loop = (fn: () => void, min: number, max: number, set: (id: number) => void) => {
    const tick = () => { fn(); set(window.setTimeout(tick, (min + Math.random() * (max - min)) * 1000)); };
    set(window.setTimeout(tick, (min + Math.random() * (max - min)) * 1000));
  };
  loop(car, 9, 22, (id) => { carTimer = id; });
  loop(cricket, 4, 11, (id) => { cricketTimer = id; });
}

export function stopAmbient(): void {
  clearTimeout(carTimer); clearTimeout(cricketTimer);
}
