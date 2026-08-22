// Mutable client state shared between modules. Kept in one place on purpose:
// the game is a single screen and every module touches a slice of this.
import type { Building } from '../../shared/city.ts';
import * as CITY from '../../shared/city.ts';
import type { StateSnapshot, Welcome } from '../../shared/protocol.ts';

export type Tool = 'spray' | 'gun';
export type LocalAnim = 'idle' | 'run' | 'sprint' | 'jump' | 'climb';

export interface LocalPlayer {
  x: number; y: number; z: number;
  vy: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  climbing: boolean;
  anim: LocalAnim;
  tool: Tool;
  dead: boolean;
  stunned: boolean;
}

export const buildings: Building[] = CITY.generateCity();

export const net = {
  me: null as string | null,
  cfg: null as Welcome | null,
  mySlot: 0,
  state: { phase: 'lobby', players: [], timeLeft: 0, winner: null, pickups: [] } as StateSnapshot
};

export const player: LocalPlayer = {
  x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0.3, onGround: true, climbing: false,
  anim: 'idle', tool: 'spray', dead: false, stunned: false
};

export const input = {
  keys: new Set<string>(),
  mouseDown: false,
  touch: { active: false, x: 0, y: 0 },
  /** gamepad left stick, same convention as touch */
  pad: { active: false, x: 0, y: 0 },
  /** sprint held by a gamepad button */
  padSprint: false,
  /** set by the dash power; ms timestamp (performance.now) */
  dashUntil: 0,
  superJump: false
};

/** Toggled by tools/ (screenshots, e2e). */
export const flags = { render: true, sim: true, freeCam: false };

export const isTouch = typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

export function myState() {
  return net.state.players.find((p) => p.id === net.me);
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};
