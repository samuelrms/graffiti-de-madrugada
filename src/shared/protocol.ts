// Wire protocol shared by server and client. Keep this the single source of truth
// for anything that crosses the socket.
import type { PickupType } from './city.ts';

export type Phase = 'lobby' | 'countdown' | 'playing' | 'ended';
export type Anim = 'idle' | 'run' | 'sprint' | 'jump' | 'climb' | 'paint';
export type WeaponName = 'pistol' | 'bazooka';
export type PowerName = 'dash' | 'shield' | 'jump' | 'smoke';
export type KillWeapon = WeaponName | 'melee';

export interface WeaponDef { damage: number; range: number; cooldown: number; splash: number; ammo: number }
export interface PowerDef { cooldown: number; duration: number; armor?: number }

export interface PlayerSnapshot {
  id: string;
  slot: number;
  name: string;
  color: string;
  cls: number;
  /** team index (0..teams-1) in teams mode, -1 in free-for-all */
  team: number;
  ready: boolean;
  deaths: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  anim: Anim;
  score: number;
  tiles: number;
  kills: number;
  hp: number;
  armor: number;
  dead: boolean;
  respawnIn: number;
  weapon: WeaponName;
  /** -1 = unlimited */
  ammo: number;
  stunned: boolean;
  shoes: boolean;
  double: boolean;
  shield: boolean;
  smoke: boolean;
  meleeReadyIn: number;
  powerReadyIn: number;
}

export interface Winner { name: string; color: string; score: number; team?: number }

export interface StateSnapshot {
  phase: Phase;
  timeLeft: number;
  winner: Winner | null;
  /** 1 = available, 0 = taken; indexed by pickup id */
  pickups: number[];
  players: PlayerSnapshot[];
}

export interface PickupInfo { id: number; type: PickupType; x: number; y: number; z: number }

export type GameMode = 'ffa' | 'teams';
/** Fixed palette for up to 4 teams. */
export const TEAM_COLORS = ['#ff2d75', '#00e5ff', '#b4ff39', '#ffb300'];
export const TEAM_NAMES = ['Rosa', 'Ciano', 'Lima', 'Âmbar'];
export const MAX_TEAMS = 4;

export interface RoomInfo {
  id: string;
  name: string;
  locked: boolean;
  players: number;
  maxPlayers: number;
  phase: Phase;
  mode: GameMode;
  /** number of teams when mode === 'teams' (2–4) */
  teams: number;
  /** socket id of the current owner ('' while empty) */
  ownerId: string;
}
/** `client` is a per-browser token so one person cannot play from several tabs. */
export interface JoinRequest { room: string; name?: string; client?: string }
export type JoinError = 'not-found' | 'full' | 'invalid' | 'duplicate' | 'ip-limit';
export interface ModeRequest { mode: GameMode; teams?: number }

export interface Welcome {
  room: RoomInfo;
  id: string;
  slot: number;
  matchSeconds: number;
  minPlayers: number;
  power: PowerName;
  powers: Record<PowerName, PowerDef>;
  weapons: Record<WeaponName, WeaponDef>;
  pickups: PickupInfo[];
  paint: Array<[string, number]>;
  colors: string[];
}

export interface PosUpdate { x: number; y: number; z: number; rot: number; anim: Anim }
export interface ShootRequest { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

export interface PaintedEvent { key: string; slot: number; color: string; value: number; by: string }
export interface ShotEvent { by: string; weapon: WeaponName; ox: number; oy: number; oz: number; hx: number; hy: number; hz: number; hit: boolean }
export interface HitEvent { by: string; victim: string; fx: number; fz: number }
export interface DamagedEvent { id: string; by?: string; hp: number; armor: number }
export interface KilledEvent { id: string; by?: string; byName?: string; byColor?: string; name: string; color: string; loss: number; weapon: KillWeapon }
export interface PickupEvent { id: number; by: string; type: PickupType }
export interface PowerEvent { id: string; name: PowerName; duration: number }
export interface RespawnedEvent { id: string; x: number; y: number; z: number }
export interface CorrectEvent { x: number; y: number; z: number; reason: string }

/** Events the server emits. */
export interface ServerToClient {
  welcome: (w: Welcome) => void;
  joinError: (e: { reason: JoinError }) => void;
  roomInfo: (r: RoomInfo) => void;
  /** the owner closed the room (or it was destroyed); clients go back home */
  roomClosed: () => void;
  state: (s: StateSnapshot) => void;
  reset: () => void;
  respawned: (e: RespawnedEvent) => void;
  correct: (e: CorrectEvent) => void;
  painted: (e: PaintedEvent) => void;
  shot: (e: ShotEvent) => void;
  hit: (e: HitEvent) => void;
  damaged: (e: DamagedEvent) => void;
  killed: (e: KilledEvent) => void;
  pickup: (e: PickupEvent) => void;
  power: (e: PowerEvent) => void;
}

/** Events the client emits. */
export interface ClientToServer {
  join: (req: JoinRequest) => void;
  leave: () => void;
  /** owner only, lobby only */
  setMode: (m: ModeRequest) => void;
  /** owner only */
  closeRoom: () => void;
  pos: (p: PosUpdate) => void;
  paint: (tileKey: string) => void;
  shoot: (s: ShootRequest) => void;
  melee: () => void;
  power: () => void;
  rename: (name: string) => void;
  ready: (flag: boolean) => void;
  restart: () => void;
}
