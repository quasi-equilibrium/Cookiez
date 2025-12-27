import * as THREE from 'three';

export const WeatherType = Object.freeze({
  VOLCANO: 'volcano',
  SUN: 'sun',
  CLOUD: 'cloud',
  LIGHTNING: 'lightning',
  ALL_GOLD: 'all_gold',
  BOMBER: 'bomber',
  YILBASI: 'yilbasi',
  TUHAFLIKLAR: 'tuhafliklar'
});

export class WeatherSystem {
  constructor({ ui, world, audio, onInventoryOpen, onInventoryClose }) {
    this.ui = ui;
    this.world = world;
    this.audio = audio;
    this.onInventoryOpen = onInventoryOpen;
    this.onInventoryClose = onInventoryClose;

    // In-memory only (refresh resets everything).
    this.inventoryItems = [];
    this.selected = null;

    // Packs: base 2 + bonus from code.
    this._basePackCredits = 2;
    this.packCredits = this._basePackCredits;

    // Codes: refresh resets these.
    this._redeemed = new Set(); // 'cookiez' | 'vip' | 'all_vip'

    // Lightning effect state.
    this._lightningT = 0;
    this._nextLightning = 3.5;
    this._flash = null;

    // Bomber effect state.
    this._nextBomb = 1.2;

    // Rain visuals.
    this._rain = null; // {points, geo, positions, count}
    this._rainT = 0;

    // Snow visuals (yılbaşı).
    this._snow = null; // {points, geo, positions, count}
    this._snowT = 0;
    this._yilbasiGiftT = 0;
    this._yilbasiGiftAt = 0;
    this._yilbasiGiftDone = false;
    this._yilbasiGiftAt2 = 0;
    this._yilbasiGiftDone2 = false;
  }

  mount() {
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

    // Code UI (menu only).
    this.ui.codeBtn?.addEventListener('click', () => this.openCodeModal());
    this.ui.codeClose?.addEventListener('click', () => this.closeCodeModal());
    this.ui.codeOverlay?.addEventListener('click', (e) => {
      if (e.target === this.ui.codeOverlay) this.closeCodeModal();
    });
    this.ui.codeSubmit?.addEventListener('click', () => this._submitCode());
    this.ui.codeInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitCode();
    });

    // VIP UI (menu only).
    this.ui.vipBtn?.addEventListener('click', () => this.openVipModal());
    this.ui.vipClose?.addEventListener('click', () => this.closeVipModal());
    this.ui.vipOverlay?.addEventListener('click', (e) => {
      if (e.target === this.ui.vipOverlay) this.closeVipModal();
    });
    this.ui.vipSubmit?.addEventListener('click', () => this._submitVip());
    this.ui.vipInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitVip();
    });
    this.ui.vipAll?.addEventListener('click', () => this._grantAllVip());
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

    if (this.packCredits <= 0) {
      this._syncPackStatus(true);
      if (this.ui.packResultItem) this.ui.packResultItem.textContent = 'PARANIZ KALMADI';
      this.ui.packResult?.classList.remove('hidden');
      return;
    }

    this.ui.packBig.classList.add('opened');
    this.packCredits = Math.max(0, this.packCredits - 1);

    // Standard pack: only 4 base weathers.
    const got = this._randomWeatherStandard();
    this.inventoryItems.push(got);

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
    const type = this.selected ?? WeatherType.SUN;
    this.ui.weatherPill?.classList.remove('hidden');
    if (this.ui.weatherPill) this.ui.weatherPill.dataset.weather = type;

    const scene = this.world.scene;
    if (type !== WeatherType.ALL_GOLD) this.world.applyTheme?.('default');

    if (type === WeatherType.ALL_GOLD) {
      scene.background = new THREE.Color('#2a2205');
      scene.fog = new THREE.FogExp2(0x2a2205, 0.012);
      this.world.setLighting({ ambient: 0.75, hemi: 0.75, key: 0.95, tint: 0xffd24a });
      this.world.applyTheme?.('gold');
      this.world.setLavaVisible?.(false);
    } else if (type === WeatherType.BOMBER) {
      scene.background = new THREE.Color('#06060b');
      scene.fog = new THREE.FogExp2(0x06060b, 0.02);
      this.world.setLighting({ ambient: 0.22, hemi: 0.25, key: 0.5, tint: 0xff7a1a });
      this.world.setLavaVisible?.(false);
    } else if (type === WeatherType.VOLCANO) {
      // Only visual lava look (no damage handled in GameApp via multiplier).
      scene.background = new THREE.Color('#2a0a00');
      scene.fog = new THREE.FogExp2(0x2a0a00, 0.02);
      this.world.setLighting({ ambient: 0.22, hemi: 0.25, key: 0.6, tint: 0xff7a1a });
      this.world.setLavaVisible?.(true);
    } else if (type === WeatherType.CLOUD) {
      scene.background = new THREE.Color('#070a10');
      scene.fog = new THREE.FogExp2(0x0a0f18, 0.022);
      this.world.setLighting({ ambient: 0.2, hemi: 0.18, key: 0.38, tint: 0x9fb2c9 });
      this.world.setLavaVisible?.(false);
    } else if (type === WeatherType.LIGHTNING) {
      // STORM: dark + rain + yellow lightning every ~2s.
      scene.background = new THREE.Color('#070a12');
      scene.fog = new THREE.FogExp2(0x070a12, 0.024);
      this.world.setLighting({ ambient: 0.16, hemi: 0.18, key: 0.35, tint: 0xffd24a });
      this._ensureLightningLight(0xffd24a);
      this.world.setLavaVisible?.(false);
    } else if (type === WeatherType.YILBASI) {
      scene.background = new THREE.Color('#0c1322');
      scene.fog = new THREE.FogExp2(0x0c1322, 0.022);
      this.world.setLighting({ ambient: 0.55, hemi: 0.55, key: 0.75, tint: 0xeaf2ff });
      this.world.applyTheme?.('snow');
      this.world.setLavaVisible?.(false);
      // Reset gift timer each time you apply the weather.
      this._yilbasiGiftT = 0;
      this._yilbasiGiftAt = 30 + Math.random() * 10; // 30..40s
      this._yilbasiGiftDone = false;
      this._yilbasiGiftAt2 = this._yilbasiGiftAt + 20; // second gift 20s later
      this._yilbasiGiftDone2 = false;
    } else {
      // SUN
      scene.background = new THREE.Color('#0b1530');
      scene.fog = null;
      this.world.setLighting({ ambient: 0.72, hemi: 0.75, key: 0.95, tint: 0xfff0b5 });
      this.world.setLavaVisible?.(false);
    }
  }

  update(dt, isActive) {
    if (!isActive) return;

    // Lightning.
    if (this.selected === WeatherType.LIGHTNING) {
      this._ensureLightningLight(0xffd24a);
      this._nextLightning -= dt;
      if (this._nextLightning <= 0) {
        this._nextLightning = 2.0;
        this._lightningT = 0.16;
        this.audio?.playOneShot?.(`${import.meta.env.BASE_URL}assets/audio/sfx/thunder.ogg`, { volume: 0.6, fallback: 'explosion' });
      }
      if (this._lightningT > 0) {
        this._lightningT -= dt;
        const a = Math.max(0, this._lightningT / 0.16);
        this._flash.intensity = a * 6.0;
      } else if (this._flash) {
        this._flash.intensity = 0;
      }
    } else if (this._flash) {
      this._flash.intensity = 0;
    }

    // Bomber: rain bombs.
    if (this.selected === WeatherType.BOMBER) {
      this._nextBomb -= dt;
      if (this._nextBomb <= 0) {
        // Slower spawn rate to keep FPS stable.
        this._nextBomb = 2.6 + Math.random() * 2.4;
        const marginX = 16;
        const marginZ = 14;
        const x = (Math.random() - 0.5) * (this.world.roomW - marginX * 2);
        const z = (Math.random() - 0.5) * (this.world.roomD - marginZ * 2);
        this.world.spawnBomb?.(x, z);
      }
    }

    // Rain: active during CLOUD and STORM.
    const raining = this.selected === WeatherType.CLOUD || this.selected === WeatherType.LIGHTNING;
    if (raining) {
      this._ensureRain();
      this._updateRain(dt);
      this.audio?.startLoop?.('rain', 'rain', { volume: 0.14 });
    } else {
      this.audio?.stopLoop?.('rain');
      if (this._rain?.points) this._rain.points.visible = false;
    }

    // Snow: active during YILBASI.
    const snowing = this.selected === WeatherType.YILBASI;
    if (snowing) {
      this._ensureSnow();
      this._updateSnow(dt);
      this.audio?.startLoop?.('snow', 'snow', { volume: 0.22 });

      // Gift spawn + announcements.
      this._yilbasiGiftT += dt;
      if (!this._yilbasiGiftDone && this._yilbasiGiftT >= this._yilbasiGiftAt) {
        this._yilbasiGiftDone = true;
        const line = 'ooooo noel baba geldi ve haritaya hediye bıraktı';
        // Toast (reuse the global toast element).
        if (this.ui.toastMsg) {
          this.ui.toastMsg.textContent = line;
          this.ui.toastMsg.classList.remove('show');
          // eslint-disable-next-line no-unused-expressions
          this.ui.toastMsg.offsetWidth;
          this.ui.toastMsg.classList.add('show');
          setTimeout(() => this.ui.toastMsg.classList.remove('show'), 3000);
        }
        this.audio?.speak?.(line, { lang: 'tr-TR', rate: 1.0, pitch: 1.0, volume: 1.0 });

        const marginX = 18;
        const marginZ = 16;
        const x = (Math.random() - 0.5) * (this.world.roomW - marginX * 2);
        const z = (Math.random() - 0.5) * (this.world.roomD - marginZ * 2);
        this.world.spawnGift?.(x, z);
      }
      if (!this._yilbasiGiftDone2 && this._yilbasiGiftT >= this._yilbasiGiftAt2) {
        this._yilbasiGiftDone2 = true;
        const line = 'oooooo noel baba 1 tane daha hediye bırakmış';
        if (this.ui.toastMsg) {
          this.ui.toastMsg.textContent = line;
          this.ui.toastMsg.classList.remove('show');
          // eslint-disable-next-line no-unused-expressions
          this.ui.toastMsg.offsetWidth;
          this.ui.toastMsg.classList.add('show');
          setTimeout(() => this.ui.toastMsg.classList.remove('show'), 3000);
        }
        this.audio?.speak?.(line, { lang: 'tr-TR', rate: 1.0, pitch: 1.0, volume: 1.0 });
        const marginX = 18;
        const marginZ = 16;
        const x = (Math.random() - 0.5) * (this.world.roomW - marginX * 2);
        const z = (Math.random() - 0.5) * (this.world.roomD - marginZ * 2);
        this.world.spawnGift?.(x, z);
      }
    } else {
      this.audio?.stopLoop?.('snow');
      if (this._snow?.points) this._snow.points.visible = false;
    }
  }

  _ensureLightningLight(colorHex = 0xb7dcff) {
    if (this._flash) {
      this._flash.color.setHex(colorHex);
      return;
    }
    this._flash = new THREE.DirectionalLight(colorHex, 0);
    this._flash.position.set(10, 20, 5);
    this.world.scene.add(this._flash);
  }

  _ensureRain() {
    if (this._rain) {
      this._rain.points.visible = true;
      return;
    }
    const count = 1400;
    const positions = new Float32Array(count * 3);
    const w = this.world.roomW;
    const d = this.world.roomD;
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * w;
      positions[i * 3 + 1] = 2 + Math.random() * 16;
      positions[i * 3 + 2] = (Math.random() - 0.5) * d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9ecbff,
      size: 0.08,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    this.world.scene.add(points);
    this._rain = { points, geo, positions, count };
  }

  _updateRain(dt) {
    const r = this._rain;
    if (!r) return;
    this._rainT += dt;
    const w = this.world.roomW;
    const d = this.world.roomD;
    const fall = 18;
    for (let i = 0; i < r.count; i++) {
      const yIdx = i * 3 + 1;
      r.positions[yIdx] -= fall * dt;
      if (r.positions[yIdx] <= 0.2) {
        // respawn at top
        r.positions[i * 3 + 0] = (Math.random() - 0.5) * w;
        r.positions[yIdx] = 10 + Math.random() * 10;
        r.positions[i * 3 + 2] = (Math.random() - 0.5) * d;
      }
    }
    r.geo.attributes.position.needsUpdate = true;
  }

  _randomWeatherStandard() {
    const all = [WeatherType.VOLCANO, WeatherType.SUN, WeatherType.CLOUD, WeatherType.LIGHTNING, WeatherType.YILBASI];
    return all[Math.floor(Math.random() * all.length)];
  }

  _ensureSnow() {
    if (this._snow) {
      this._snow.points.visible = true;
      return;
    }
    const count = 900;
    const positions = new Float32Array(count * 3);
    const w = this.world.roomW;
    const d = this.world.roomD;
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * w;
      positions[i * 3 + 1] = 2 + Math.random() * 18;
      positions[i * 3 + 2] = (Math.random() - 0.5) * d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.14,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    this.world.scene.add(points);
    this._snow = { points, geo, positions, count };
  }

  _updateSnow(dt) {
    const s = this._snow;
    if (!s) return;
    this._snowT += dt;
    const w = this.world.roomW;
    const d = this.world.roomD;
    const fall = 4.2;
    for (let i = 0; i < s.count; i++) {
      const xIdx = i * 3 + 0;
      const yIdx = i * 3 + 1;
      const zIdx = i * 3 + 2;
      // gentle drift
      s.positions[xIdx] += Math.sin(this._snowT * 0.6 + i) * 0.02;
      s.positions[zIdx] += Math.cos(this._snowT * 0.5 + i) * 0.02;
      s.positions[yIdx] -= fall * dt;
      if (s.positions[yIdx] <= 0.2) {
        s.positions[xIdx] = (Math.random() - 0.5) * w;
        s.positions[yIdx] = 10 + Math.random() * 12;
        s.positions[zIdx] = (Math.random() - 0.5) * d;
      }
    }
    s.geo.attributes.position.needsUpdate = true;
  }

  _syncUI() {
    this.ui.invBag?.classList.remove('hidden');
    this._syncPackStatus();
    this._syncInventoryOverlay();
  }

  _syncPackStatus(noMoney = false) {
    if (!this.ui.packStatus) return;
    const remaining = Math.max(0, this.packCredits);
    if (noMoney || remaining <= 0) {
      this.ui.packStatus.textContent = 'PARANIZ KALMADI';
      this.ui.packStatus.classList.add('no-money');
      return;
    }
    this.ui.packStatus.classList.remove('no-money');
    this.ui.packStatus.textContent = `${remaining} PACK HAKKIN VAR`;
  }

  _syncInventoryOverlay() {
    const grid = this.ui.invGrid;
    if (!grid) return;
    grid.innerHTML = '';

    const items = this.inventoryItems;
    const empty = !items || items.length === 0;
    this.ui.invEmpty?.classList.toggle('hidden', !empty);
    if (empty) return;

    for (const type of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isVip = type === WeatherType.ALL_GOLD || type === WeatherType.BOMBER || type === WeatherType.TUHAFLIKLAR;
      btn.className = `inv-item${isVip ? ' vip' : ''}${this.selected === type ? ' selected' : ''}`;
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
        this._syncUI();
        this.applyToWorld();
      });

      grid.appendChild(btn);
    }
  }

  openCodeModal() {
    this.ui.codeOverlay?.classList.remove('hidden');
    if (this.ui.codeMsg) this.ui.codeMsg.textContent = '';
    if (this.ui.codeInput) {
      this.ui.codeInput.value = '';
      this.ui.codeInput.focus();
    }
  }

  closeCodeModal() {
    this.ui.codeOverlay?.classList.add('hidden');
  }

  _submitCode() {
    const raw = (this.ui.codeInput?.value ?? '').trim().toLowerCase();
    if (!this.ui.codeMsg) return;

    if (raw === 'cookiez') {
      if (this._redeemed.has('cookiez')) {
        this.ui.codeMsg.textContent = 'bunu zaten aldınız';
        return;
      }
      this._redeemed.add('cookiez');
      this.packCredits += 3;
      this.ui.codeMsg.textContent = '3 packed kazandınız';
      this._syncUI();
      return;
    }

    if (raw === 'reset') {
      this.inventoryItems = [];
      this.selected = null;
      // Refill packs to current entitlement for this session.
      this.packCredits = this._basePackCredits + (this._redeemed.has('cookiez') ? 3 : 0);
      this.applyToWorld();
      this.ui.codeMsg.textContent = 'envanter sıfırlandı';
      this._syncUI();
      return;
    }

    this.ui.codeMsg.textContent = 'geçersiz kod';
  }

  openVipModal() {
    this.ui.vipOverlay?.classList.remove('hidden');
    if (this.ui.vipMsg) this.ui.vipMsg.textContent = '';
    this.ui.vipAll?.classList.add('hidden');
    if (this.ui.vipInput) {
      this.ui.vipInput.value = '';
      this.ui.vipInput.focus();
    }
  }

  closeVipModal() {
    this.ui.vipOverlay?.classList.add('hidden');
  }

  _submitVip() {
    const raw = (this.ui.vipInput?.value ?? '').trim();
    if (!this.ui.vipMsg) return;

    if (raw === '797500') {
      this._redeemed.add('vip');
      this.ui.vipMsg.textContent =
        'KODLAR:\n- cookiez → 3 pack hakkı (1 kez)\n- reset → envanteri sıfırlar\nVIP:\n- 797500 → kod listesini gösterir\nALL VIP:\n- all_gold → haritayı altın yapar\n- bomber → bomba yağdırır\n- tuhaflıklar → portal/garip mod';
      this.ui.vipAll?.classList.remove('hidden');
      return;
    }

    this.ui.vipMsg.textContent = 'yanlış VIP kodu';
  }

  _grantAllVip() {
    if (!this.ui.vipMsg) return;
    if (!this._redeemed.has('vip')) {
      this.ui.vipMsg.textContent = 'önce VIP kodu gir';
      return;
    }
    if (this._redeemed.has('all_vip')) {
      this.ui.vipMsg.textContent = 'bunu zaten aldınız';
      return;
    }
    this._redeemed.add('all_vip');
    if (!this.inventoryItems.includes(WeatherType.ALL_GOLD)) this.inventoryItems.push(WeatherType.ALL_GOLD);
    if (!this.inventoryItems.includes(WeatherType.BOMBER)) this.inventoryItems.push(WeatherType.BOMBER);
    if (!this.inventoryItems.includes(WeatherType.TUHAFLIKLAR)) this.inventoryItems.push(WeatherType.TUHAFLIKLAR);
    this.ui.vipMsg.textContent = 'VIP eşyalar envantere geldi';
    this._syncUI();
    // Make it obvious: open inventory immediately so user sees items.
    this.openInventory();
  }
}

