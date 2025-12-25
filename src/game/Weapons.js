import { clamp } from './math.js';

export const WeaponType = Object.freeze({
  KNIFE: 'Knife',
  PISTOL: 'Pistol',
  VANDAL: 'Vandal',
  SNIPER: 'Sniper'
});

export function weaponForTaskLevel(level) {
  // Spawn starts with knife (0). Completing tasks upgrades 1..3.
  if (level <= 0) return WeaponType.KNIFE;
  if (level === 1) return WeaponType.PISTOL;
  if (level === 2) return WeaponType.VANDAL;
  return WeaponType.SNIPER;
}

export function damageForWeapon(type) {
  switch (type) {
    case WeaponType.KNIFE:
      return 40;
    case WeaponType.PISTOL:
      return 25;
    case WeaponType.VANDAL:
      return 50;
    case WeaponType.SNIPER:
      return 100;
    default:
      return 10;
  }
}

export class WeaponState {
  constructor() {
    this.type = WeaponType.KNIFE;

    // Ammo model: mag + reserve.
    this.mag = 0;
    this.reserve = 0;

    this.cooldown = 0;
    this.reloadTimer = 0;

    // Sniper special: hold to zoom, release to fire.
    this.sniperAiming = false;
    this.sniperZoom01 = 0;
  }

  setWeapon(type) {
    this.type = type;
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.sniperAiming = false;
    this.sniperZoom01 = 0;

    if (type === WeaponType.KNIFE) {
      this.mag = 0;
      this.reserve = 0;
    } else if (type === WeaponType.PISTOL) {
      this.mag = 12;
      this.reserve = 48;
    } else if (type === WeaponType.VANDAL) {
      this.mag = 30;
      this.reserve = 90;
    } else if (type === WeaponType.SNIPER) {
      this.mag = 5;
      this.reserve = 20;
    }
  }

  getMaxMag() {
    if (this.type === WeaponType.PISTOL) return 12;
    if (this.type === WeaponType.VANDAL) return 30;
    if (this.type === WeaponType.SNIPER) return 5;
    return 0;
  }

  canShoot() {
    if (this.reloadTimer > 0) return false;
    if (this.cooldown > 0) return false;
    if (this.type === WeaponType.KNIFE) return true;
    return this.mag > 0;
  }

  startReload() {
    if (this.type === WeaponType.KNIFE) return false;
    if (this.reloadTimer > 0) return false;
    if (this.mag >= this.getMaxMag()) return false;
    if (this.reserve <= 0) return false;

    // Slightly different per weapon.
    const t = this.type === WeaponType.SNIPER ? 1.6 : this.type === WeaponType.VANDAL ? 1.35 : 1.1;
    this.reloadTimer = t;
    return true;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      if (this.reloadTimer === 0) {
        const max = this.getMaxMag();
        const needed = Math.max(0, max - this.mag);
        const take = Math.min(this.reserve, needed);
        this.mag += take;
        this.reserve -= take;
      }
    }

    // Smooth zoom animation for sniper.
    const target = this.sniperAiming ? 1 : 0;
    const speed = 10;
    this.sniperZoom01 = clamp(this.sniperZoom01 + (target - this.sniperZoom01) * (1 - Math.exp(-speed * dt)), 0, 1);
  }

  consumeShot() {
    if (this.type !== WeaponType.KNIFE) this.mag = Math.max(0, this.mag - 1);
    // Fire rate: pistol/vandal faster, sniper slower, knife has swing delay.
    if (this.type === WeaponType.KNIFE) this.cooldown = 0.45;
    else if (this.type === WeaponType.PISTOL) this.cooldown = 0.22;
    else if (this.type === WeaponType.VANDAL) this.cooldown = 0.11;
    else if (this.type === WeaponType.SNIPER) this.cooldown = 0.85;
  }
}

