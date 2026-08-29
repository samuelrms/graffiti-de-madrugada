// Audio engine: context, buses, compressor, reverb send, ducking and a distance model.
//
//   sfx ──┬─────────────► master ──► compressor ──► destination
//         └─► reverb ───►
//   music ────────────►
//   ambient ──────────►
//
// Music and ambient are "ducked" (lowered briefly) when a stinger plays.
import { onSettings, settings } from '../core/settings.ts';

export interface Pos { x: number; y: number; z: number }

class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  ambient!: GainNode;
  reverbSend!: GainNode;
  private duck!: GainNode;
  readonly listener = { x: 0, y: 0, z: 0, yaw: 0 };

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }
  get now(): number { return this.ctx?.currentTime ?? 0; }

  /** Must come from a user gesture the first time. */
  unlock(): boolean {
    if (this.ctx) { if (this.ctx.state !== 'running') void this.ctx.resume(); return this.ready; }
    const c = new AudioContext();
    this.ctx = c;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18;
    this.master = c.createGain();
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.duck = c.createGain(); this.duck.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.duck);
    this.ambient = c.createGain(); this.ambient.connect(this.duck);
    // Short, dark reverb from a synthetic impulse (no sample needed).
    const conv = c.createConvolver();
    conv.buffer = impulse(c, 1.1, 2.6);
    const wet = c.createGain(); wet.gain.value = 0.32;
    conv.connect(wet); wet.connect(this.master);
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 1;
    this.reverbSend.connect(conv);
    this.applyVolumes();
    onSettings(() => this.applyVolumes());
    void c.resume();
    return true;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.sfx.gain.value = settings.sfx;
    this.music.gain.value = settings.music;
    this.ambient.gain.value = settings.music;
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
  }

  /** Gain multiplier + stereo pan for a world position; null when out of range. */
  spatial(at: Pos, maxDist = 60): { gain: number; pan: number } | null {
    const dx = at.x - this.listener.x, dy = at.y - this.listener.y, dz = at.z - this.listener.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return null;
    const gain = 1 / (1 + (d * d) / 45);
    const right = (dx * Math.cos(this.listener.yaw) - dz * Math.sin(this.listener.yaw)) / (d || 1);
    return { gain, pan: Math.max(-1, Math.min(1, right * 0.85)) };
  }

  /** Output chain for a one-shot: gain -> (pan) -> sfx bus, plus reverb send. */
  out(volume: number, at?: Pos, reverb = 0.35): { input: AudioNode; ok: boolean } {
    const c = this.ctx!;
    const g = c.createGain();
    let vol = volume;
    let node: AudioNode = g;
    if (at) {
      const s = this.spatial(at);
      if (!s) return { input: g, ok: false };
      vol *= s.gain;
      const pan = c.createStereoPanner(); pan.pan.value = s.pan;
      g.connect(pan); node = pan;
    }
    g.gain.value = vol;
    node.connect(this.sfx);
    if (reverb > 0) { const send = c.createGain(); send.gain.value = reverb; node.connect(send); send.connect(this.reverbSend); }
    return { input: g, ok: true };
  }

  /** Lower music/ambient for a moment (stingers, death). */
  duckFor(seconds: number, depth = 0.35): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(depth, t, 0.05);
    this.duck.gain.setTargetAtTime(1, t + seconds, 0.6);
  }
}

function impulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export const engine = new Engine();
