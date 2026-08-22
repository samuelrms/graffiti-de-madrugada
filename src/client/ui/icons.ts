// Lucide icons rendered to inline SVG strings for the HUD.
import {
  ArrowBigUp, ArrowUp, BriefcaseMedical, Check, CloudFog, Crosshair, Crown, Flame, Footprints, Hand, Handshake, Heart,
  Link, Lock, LogIn, Moon, Plus, Repeat, Rocket, Shield, ShieldCheck, Skull, Sparkles, SprayCan, Trophy, Users, Wind, Zap, createElement, type IconNode
} from 'lucide';
import type { KillWeapon, PowerName } from '../../shared/protocol.ts';
import type { PickupType } from '../../shared/city.ts';

const cache = new Map<string, string>();

export function icon(node: IconNode, name: string, size = 18, cls = ''): string {
  const key = `${name}:${size}:${cls}`;
  let s = cache.get(key);
  if (!s) {
    const el = createElement(node, { width: size, height: size, 'stroke-width': 2.25, class: `ic ${cls}`.trim() });
    s = el.outerHTML;
    cache.set(key, s);
  }
  return s;
}

export const I = {
  spray: (s = 18) => icon(SprayCan, 'spray', s),
  pistol: (s = 18) => icon(Crosshair, 'pistol', s),
  bazooka: (s = 18) => icon(Rocket, 'bazooka', s),
  melee: (s = 18) => icon(Hand, 'melee', s),
  hp: (s = 18) => icon(Heart, 'hp', s),
  armor: (s = 18) => icon(Shield, 'armor', s),
  shoes: (s = 18) => icon(Footprints, 'shoes', s),
  double: (s = 18) => icon(Sparkles, 'double', s),
  shieldOn: (s = 18) => icon(ShieldCheck, 'shieldOn', s),
  smoke: (s = 18) => icon(CloudFog, 'smoke', s),
  trophy: (s = 18) => icon(Trophy, 'trophy', s),
  tie: (s = 18) => icon(Handshake, 'tie', s),
  skull: (s = 18) => icon(Skull, 'skull', s),
  flame: (s = 18) => icon(Flame, 'flame', s),
  moon: (s = 18) => icon(Moon, 'moon', s),
  medkit: (s = 18) => icon(BriefcaseMedical, 'medkit', s),
  check: (s = 18) => icon(Check, 'check', s),
  jump: (s = 18) => icon(ArrowUp, 'jump', s),
  swap: (s = 18) => icon(Repeat, 'swap', s),
  zap: (s = 18) => icon(Zap, 'zap', s),
  users: (s = 18) => icon(Users, 'users', s),
  lock: (s = 18) => icon(Lock, 'lock', s),
  link: (s = 18) => icon(Link, 'link', s),
  plus: (s = 18) => icon(Plus, 'plus', s),
  login: (s = 18) => icon(LogIn, 'login', s),
  crown: (s = 18) => icon(Crown, 'crown', s)
};

export const POWER_ICON: Record<PowerName, (s?: number) => string> = {
  dash: (s = 18) => icon(Wind, 'dash', s),
  shield: (s = 18) => icon(Shield, 'shield', s),
  jump: (s = 18) => icon(ArrowBigUp, 'superjump', s),
  smoke: (s = 18) => icon(CloudFog, 'smoke', s)
};

export const KILL_ICON: Record<KillWeapon, (s?: number) => string> = {
  pistol: I.pistol,
  bazooka: I.bazooka,
  melee: I.melee
};

export const PICKUP_ICON: Record<PickupType, (s?: number) => string> = {
  bazooka: I.bazooka,
  vest: I.armor,
  shoes: I.shoes,
  doublecan: I.double,
  medkit: I.medkit
};
