// Gamepad support (standard mapping: Xbox / PlayStation / Steam Deck).
// Left stick moves, right stick looks, RT uses the tool, A jumps/climbs,
// X punches, Y power, B swaps tool, LB/L3 sprint, Start opens the menu.
import { settings } from '../core/settings.ts';
import { input, net, player } from '../core/state.ts';

const DEAD = 0.18;
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export interface PadActions {
  jump(down: boolean): void;
  fire(down: boolean): void;
  melee(): void;
  power(): void;
  swap(): void;
  menu(): void;
  sprint(down: boolean): void;
}

const prev: boolean[] = [];
let connected = false;
let onConnected: (() => void) | null = null;

export function setupGamepad(actions: PadActions, onFirstConnect: () => void): void {
  onConnected = onFirstConnect;
  addEventListener('gamepadconnected', () => { if (!connected) { connected = true; onConnected?.(); } });
  gamepadActions = actions;
}
let gamepadActions: PadActions | null = null;

const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/** Called from the simulation loop with dt in seconds. */
export function pollGamepad(dt: number): void {
  const pads = navigator.getGamepads?.() ?? [];
  const gp = pads.find((p) => p && p.connected);
  if (!gp || !gamepadActions) { if (input.pad.active) { input.pad.active = false; input.pad.x = input.pad.y = 0; } return; }
  if (!connected) { connected = true; onConnected?.(); }

  // Movement (left stick) feeds the same vector the touch joystick uses.
  const mx = dz(gp.axes[0] ?? 0), my = dz(gp.axes[1] ?? 0);
  input.pad.x = mx; input.pad.y = my;
  input.pad.active = mx !== 0 || my !== 0;

  // Look (right stick)
  const lx = dz(gp.axes[2] ?? 0), ly = dz(gp.axes[3] ?? 0);
  if (net.cfg && (lx || ly)) {
    const s = 2.6 * settings.padSensitivity * dt;
    player.yaw -= lx * Math.abs(lx) * s;
    player.pitch = Math.max(-0.6, Math.min(1.25, player.pitch + ly * Math.abs(ly) * s * (settings.invertY ? -1 : 1)));
  }

  const pressed = (i: number) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value ?? 0) > 0.5;
  const edge = (i: number, down: (d: boolean) => void, onlyDown = false) => {
    const now = pressed(i);
    if (now !== !!prev[i]) { if (!onlyDown || now) down(now); prev[i] = now; }
  };
  const A = gamepadActions;
  edge(BTN.A, A.jump);
  edge(BTN.RT, A.fire);
  edge(BTN.X, () => A.melee(), true);
  edge(BTN.Y, () => A.power(), true);
  edge(BTN.B, () => A.swap(), true);
  edge(BTN.START, () => A.menu(), true);
  const sprint = pressed(BTN.LB) || pressed(BTN.L3);
  if (sprint !== !!prev[BTN.LB]) { A.sprint(sprint); prev[BTN.LB] = sprint; }
}
