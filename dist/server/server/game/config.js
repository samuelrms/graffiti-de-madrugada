export const DEFAULTS = {
    port: Number(process.env.PORT || 8080),
    tickMs: 50,
    matchSeconds: 180,
    countdownSeconds: 3,
    respawnMs: 3000,
    minPlayers: 2,
    maxPlayers: 12,
    validateMovement: true,
    maxPerIp: Number(process.env.MAX_PER_IP ?? 1),
    quiet: false
};
export const PAINT_RANGE = 4.5;
export const PAINT_COOLDOWN_MS = 120;
export const MELEE_RANGE = 2.6;
export const MELEE_COOLDOWN_MS = 1200;
export const MELEE_DAMAGE = 25;
export const STUN_MS = 900;
export const MAX_HP = 100;
export const KILL_BONUS = 8;
/** victim loses this share of their score on death (tiles stay painted) */
export const DEATH_TILE_LOSS = 0.2;
export const WEAPONS = {
    pistol: { damage: 14, range: 34, cooldown: 260, splash: 0, ammo: Infinity },
    bazooka: { damage: 45, range: 40, cooldown: 1100, splash: 4.5, ammo: 4 }
};
/** Powers by class (slot % 4). Client applies movement effects; server applies stat effects. */
export const POWERS = {
    dash: { cooldown: 5000, duration: 700 },
    shield: { cooldown: 12000, duration: 5000, armor: 40 },
    jump: { cooldown: 6000, duration: 600 },
    smoke: { cooldown: 14000, duration: 4000 }
};
export const CLASS_POWER = ['dash', 'shield', 'jump', 'smoke'];
export const PICKUP_TYPES = {
    bazooka: { respawn: 25000 },
    vest: { respawn: 20000, armor: 50 },
    shoes: { respawn: 18000, duration: 12000 },
    doublecan: { respawn: 18000, duration: 15000 },
    medkit: { respawn: 15000, heal: 60 }
};
export const COLORS = [
    '#ff2d75', '#00e5ff', '#b4ff39', '#ffb300', '#b967ff', '#ff6a00',
    '#2dff9b', '#ff4dff', '#4d7cff', '#ffe600', '#ff3b3b', '#7dffea'
];
export const MAX_Y = 60;
/** dash is 17; leave headroom for lag + push knockback */
export const MAX_SPEED = 22;
/** units per update tolerated beyond speed * dt */
export const SPEED_SLACK = 2.5;
//# sourceMappingURL=config.js.map