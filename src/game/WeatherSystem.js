import * as THREE from 'three';

export const WeatherType = Object.freeze({
  VOLCANO: 'volcano',
  SUN: 'sun',
  CLOUD: 'cloud',
  LIGHTNING: 'lightning'
});

const STORAGE_KEY = 'arcade_duel_weather';

export class WeatherSystem {
  constructor({ ui, world, audio }) {
    this.ui = ui;
    this.world = world;
    this.audio = audio;

    this.inventoryItem = null; // last opened item
    this.selected = null;

    // Lightning effect state.
    this._lightningT = 0;
    this._nextLightning = 3.5;
    this._flash = null;
  }

  mount() {
    this._load();
    this._syncUI();

    // Pack UI.
    this.ui.packBtn?.addEventListener('click', () => this.openPackModal());
    this.ui.packClose?.addEventListener('click', () => this.closePackModal());
    this.ui.packOverlay?.addEventListener('click', (e) => {
      if (e.target === this.ui.packOverlay) this.closePackModal();
    });
    this.ui.packBig?.addEventListener('click', () => this.openPack());

    // Inventory UI.
    this.ui.invItem?.addEventListener('click', () => {
      // Show select button for current item.
      this.ui.invSelect?.classList.toggle('hidden', false);
    });
    this.ui.invSelect?.addEventListener('click', () => {
      if (!this.inventoryItem) return;
      this.selected = this.inventoryItem;
      this._save();
      this._syncUI();
    });
  }

  openPackModal() {
    this.ui.packOverlay?.classList.remove('hidden');
    this.ui.packResult?.classList.add('hidden');
    this.ui.packBig?.classList.remove('opened');
  }

  closePackModal() {
    this.ui.packOverlay?.classList.add('hidden');
  }

  openPack() {
    if (!this.ui.packBig) return;
    if (this.ui.packBig.classList.contains('opened')) return;
    this.ui.packBig.classList.add('opened');

    const got = this._randomWeather();
    this.inventoryItem = got;
    this._save();

    // Reveal result after "tear".
    setTimeout(() => {
      if (this.ui.packResultItem) this.ui.packResultItem.textContent = got.toUpperCase();
      this.ui.packResult?.classList.remove('hidden');
      this._syncUI();
    }, 650);
  }

  applyToWorld() {
    // Apply selected weather to scene visuals.
    const type = this.selected ?? WeatherType.SUN;
    this.ui.weatherPill?.classList.remove('hidden');
    if (this.ui.weatherPill) this.ui.weatherPill.textContent = `WEATHER: ${type.toUpperCase()}`;

    const scene = this.world.scene;

    if (type === WeatherType.VOLCANO) {
      scene.background = new THREE.Color('#120106');
      scene.fog = new THREE.FogExp2(0x220008, 0.015);
      this.world.setLighting({ ambient: 0.25, hemi: 0.25, key: 0.55, tint: 0xff5a2f });
    } else if (type === WeatherType.CLOUD) {
      scene.background = new THREE.Color('#0a0f18');
      scene.fog = new THREE.FogExp2(0x0a0f18, 0.022);
      this.world.setLighting({ ambient: 0.22, hemi: 0.2, key: 0.45, tint: 0x9fb2c9 });
    } else if (type === WeatherType.LIGHTNING) {
      scene.background = new THREE.Color('#060915');
      scene.fog = new THREE.FogExp2(0x060915, 0.02);
      this.world.setLighting({ ambient: 0.18, hemi: 0.2, key: 0.4, tint: 0x63b3ff });
      this._ensureLightningLight();
    } else {
      // SUN
      scene.background = new THREE.Color('#05060a');
      scene.fog = null;
      this.world.setLighting({ ambient: 0.35, hemi: 0.45, key: 0.65, tint: 0xffd48a });
    }
  }

  update(dt, isActive) {
    // Only animate lightning during gameplay.
    if (!isActive) return;
    if (this.selected !== WeatherType.LIGHTNING) return;
    this._ensureLightningLight();

    this._nextLightning -= dt;
    if (this._nextLightning <= 0) {
      this._nextLightning = 2.8 + Math.random() * 4.0;
      this._lightningT = 0.18;
      // Quick flash, optional thunder (fallback to explosion-ish).
      this.audio?.playOneShot?.(`${import.meta.env.BASE_URL}assets/audio/sfx/thunder.ogg`, { volume: 0.7, fallback: 'explosion' });
    }

    if (this._lightningT > 0) {
      this._lightningT -= dt;
      const a = Math.max(0, this._lightningT / 0.18);
      this._flash.intensity = a * 6.0;
    } else {
      this._flash.intensity = 0;
    }
  }

  _ensureLightningLight() {
    if (this._flash) return;
    this._flash = new THREE.DirectionalLight(0xb7dcff, 0);
    this._flash.position.set(10, 20, 5);
    this.world.scene.add(this._flash);
  }

  _randomWeather() {
    const all = [WeatherType.VOLCANO, WeatherType.SUN, WeatherType.CLOUD, WeatherType.LIGHTNING];
    return all[Math.floor(Math.random() * all.length)];
  }

  _syncUI() {
    // Inventory visibility.
    if (this.ui.inventory) this.ui.inventory.classList.remove('hidden');

    if (!this.inventoryItem) {
      this.ui.invItem?.classList.add('hidden');
      this.ui.invSelect?.classList.add('hidden');
      this.ui.invCheck?.classList.add('hidden');
      return;
    }

    this.ui.invItem?.classList.remove('hidden');
    if (this.ui.invItem) this.ui.invItem.textContent = this.inventoryItem.slice(0, 2).toUpperCase();

    // Checkmark if selected.
    const sel = this.selected === this.inventoryItem;
    this.ui.invCheck?.classList.toggle('hidden', !sel);
    this.ui.invSelect?.classList.toggle('hidden', sel);
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ inventoryItem: this.inventoryItem, selected: this.selected }));
    } catch {
      // ignore
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.inventoryItem = d.inventoryItem ?? null;
      this.selected = d.selected ?? null;
    } catch {
      // ignore
    }
  }
}

