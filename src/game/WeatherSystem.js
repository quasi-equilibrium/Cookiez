import * as THREE from 'three';

export const WeatherType = Object.freeze({
  VOLCANO: 'volcano',
  SUN: 'sun',
  CLOUD: 'cloud',
  LIGHTNING: 'lightning'
});

const STORAGE_KEY = 'arcade_duel_weather';

export class WeatherSystem {
  constructor({ ui, world, audio, onInventoryOpen, onInventoryClose }) {
    this.ui = ui;
    this.world = world;
    this.audio = audio;
    this.onInventoryOpen = onInventoryOpen;
    this.onInventoryClose = onInventoryClose;

    this.inventoryItems = []; // items opened from packs (max 2 opens)
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

    // Inventory UI (bag -> full-screen overlay).
    this.ui.invBag?.addEventListener('click', () => this.openInventory());
    this.ui.invClose?.addEventListener('click', () => this.closeInventory());
    this.ui.invOverlay?.addEventListener('click', (e) => {
      if (e.target === this.ui.invOverlay) this.closeInventory();
    });
  }

  openPackModal() {
    this.ui.packOverlay?.classList.remove('hidden');
    this.ui.packResult?.classList.add('hidden');
    this.ui.packBig?.classList.remove('opened');
    this._syncPackStatus();
  }

  closePackModal() {
    this.ui.packOverlay?.classList.add('hidden');
  }

  openPack() {
    if (!this.ui.packBig) return;
    if (this.ui.packBig.classList.contains('opened')) return;

    // Limit: only 2 opens total.
    if (this.inventoryItems.length >= 2) {
      this._syncPackStatus(true);
      // Also show a clear message in the result area.
      if (this.ui.packResultItem) this.ui.packResultItem.textContent = 'PARANIZ KALMADI';
      this.ui.packResult?.classList.remove('hidden');
      return;
    }

    this.ui.packBig.classList.add('opened');

    // Prefer a new item if possible (avoid duplicates when there are choices).
    let got = this._randomWeather();
    const all = [WeatherType.VOLCANO, WeatherType.SUN, WeatherType.CLOUD, WeatherType.LIGHTNING];
    for (let tries = 0; tries < 8; tries++) {
      if (!this.inventoryItems.includes(got) || this.inventoryItems.length >= all.length) break;
      got = this._randomWeather();
    }
    this.inventoryItems.push(got);
    this._save();

    // Reveal result after "tear".
    setTimeout(() => {
      if (this.ui.packResultItem) this.ui.packResultItem.textContent = got.toUpperCase();
      this.ui.packResult?.classList.remove('hidden');
      this._syncUI();
    }, 650);
  }

  openInventory() {
    document.exitPointerLock?.();
    this.ui.invOverlay?.classList.remove('hidden');
    this.onInventoryOpen?.();
    this._syncInventoryOverlay();
  }

  closeInventory() {
    this.ui.invOverlay?.classList.add('hidden');
    this.onInventoryClose?.();
  }

  applyToWorld() {
    // Apply selected weather to scene visuals.
    const type = this.selected ?? WeatherType.SUN;
    this.ui.weatherPill?.classList.remove('hidden');
    if (this.ui.weatherPill) this.ui.weatherPill.dataset.weather = type;

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
      // Brighter/cleaner look for "SUN".
      this.world.setLighting({ ambient: 0.5, hemi: 0.55, key: 0.78, tint: 0xffd48a });
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
    // Bag is always visible (inventory can be empty).
    this.ui.invBag?.classList.remove('hidden');
    this._syncPackStatus();
    this._syncInventoryOverlay();
  }

  _syncPackStatus(noMoney = false) {
    if (!this.ui.packStatus) return;
    const remaining = Math.max(0, 2 - this.inventoryItems.length);
    if (noMoney || remaining === 0) {
      this.ui.packStatus.textContent = 'PARANIZ KALMADI';
      this.ui.packStatus.classList.add('no-money');
      return;
    }
    this.ui.packStatus.classList.remove('no-money');
    this.ui.packStatus.textContent = `${remaining}/2 PACK HAKKIN VAR`;
  }

  _syncInventoryOverlay() {
    const grid = this.ui.invGrid;
    if (!grid) return;
    grid.innerHTML = '';

    const items = this.inventoryItems;
    const empty = !items || items.length === 0;
    this.ui.invEmpty?.classList.toggle('hidden', !empty);

    if (empty) return;

    for (let i = 0; i < items.length; i++) {
      const type = items[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `inv-item${this.selected === type ? ' selected' : ''}`;
      btn.dataset.weather = type;

      const icon = document.createElement('div');
      icon.className = 'wicon';
      icon.dataset.weather = type;

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = type.toUpperCase();

      btn.appendChild(icon);
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        this.selected = type;
        this._save();
        this._syncUI();
        this.applyToWorld();
      });

      grid.appendChild(btn);
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ inventoryItems: this.inventoryItems, selected: this.selected }));
    } catch {
      // ignore
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.inventoryItems = Array.isArray(d.inventoryItems) ? d.inventoryItems.slice(0, 2) : [];
      this.selected = d.selected ?? null;
    } catch {
      // ignore
    }
  }
}

