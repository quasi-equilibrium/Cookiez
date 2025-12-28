import * as THREE from 'three';
import { Input } from './Input.js';
import { AudioManager } from './AudioManager.js';
import { World } from './World.js';
import { Player, PLAYER_HEIGHT, PLAYER_RADIUS } from './Player.js';
import { WeaponState, WeaponType, damageForWeapon, weaponForTaskLevel } from './Weapons.js';
import { TaskSystem } from './TaskSystem.js';
import { WeaponView } from './WeaponView.js';
import { DemoBots } from './DemoBots.js';
import { WeatherSystem } from './WeatherSystem.js';
import { clamp, dist2, randRange } from './math.js';

const WIN_KILLS = 10;
const BUILD_TAG = 'inventory-v1'; // simple visual confirmation on Pages

// Vite sets BASE_URL correctly for GitHub Pages (e.g. "/Cookiez/") and for relative builds ("./").
// IMPORTANT: Never hardcode "/assets/..." for GitHub Pages project sites, because "/assets"
// resolves to the domain root instead of "/<repo>/assets".
const assetUrl = (p) => `${import.meta.env.BASE_URL}${String(p).replace(/^\//, '')}`;

export class GameApp {
  constructor({ canvas }) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    // Performance: cap pixel ratio a bit lower for stability.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setScissorTest(true);

    this.input = new Input({ canvas: this.canvas });
    this.audio = new AudioManager();

    this.world = new World();
    this.world.build();
    this.demoBots = new DemoBots({ scene: this.world.scene, roomW: this.world.roomW, roomD: this.world.roomD });
    this.demoBots.build();
    this.demoBots.setEnabled(true);

    this.players = {
      p1: new Player({ id: 'p1', color: 0x63b3ff }),
      p2: new Player({ id: 'p2', color: 0xff4fd7 })
    };
    this.players.p1.addToScene(this.world.scene);
    this.players.p2.addToScene(this.world.scene);
    // Add cameras to scene so camera-attached weapon models render.
    this.world.scene.add(this.players.p1.camera);
    this.world.scene.add(this.players.p2.camera);

    this.weapons = {
      p1: new WeaponState(),
      p2: new WeaponState()
    };

    // First-person weapon visuals + FX.
    this.weaponViews = {
      p1: new WeaponView({ id: 'p1', scene: this.world.scene, camera: this.players.p1.camera }),
      p2: new WeaponView({ id: 'p2', scene: this.world.scene, camera: this.players.p2.camera })
    };
    this.weaponViews.p1.attach();
    this.weaponViews.p2.attach();

    // Spawn/elevator state.
    this.state = 'MENU'; // MENU -> TRANSITION -> ELEVATOR -> PLAY -> WIN
    this.elevator = {
      t: 10,
      doorOpen01: 0,
      fightMsgTimer: 0,
      _lastShownInt: 10,
      doorSfxPlayed: false,
      introSpoken: false
    };

    this.scores = { p1: 0, p2: 0 };
    this._raycaster = new THREE.Raycaster();
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._tmpHitEnd = new THREE.Vector3();

    // Combat FX.
    this._damageTextPool = [];
    this._damageTexts = [];
    this._bloodPool = [];
    this._blood = [];
    this._corpses = [];
    this._firstKillDone = false;
    this._bonusWeapon = { p1: null, p2: null };
    this._cheatsEnabled = false;
    this._hackUsed = { one: false, two: false, three: false };

    this.config = {
      mouseFireMode: 'p2' // 'p2' | 'both'
    };

    // Footstep cadence per player.
    this._stepT = { p1: 0, p2: 0 };

    this._ui = this._bindUI();
    // Menu-only systems (intro + achievements + idle easter egg).
    this._menuIdleT = 0;
    this._intro = { open: false, mode: 'credits', y: 0 };
    this._badges = { egg: false, star: false, weather: false };
    this._lastBadgeToastAt = 0;
    this._installMenuIdleListeners();
    this.weather = new WeatherSystem({
      ui: this._ui,
      world: this.world,
      audio: this.audio,
      onInventoryOpen: () => {
        // Freeze both players while inventory is open (simple + safe).
        this.players.p1.controlsLocked = true;
        this.players.p2.controlsLocked = true;
      },
      onInventoryClose: () => {
        this.players.p1.controlsLocked = false;
        this.players.p2.controlsLocked = false;
      },
      onHackEnabled: () => {
        this._cheatsEnabled = true;
        this._showToast('hile açıldı (fake)');
      },
      onInventoryChanged: () => {
        this._maybeUnlockWeatherBadge();
      }
    });
    this.weather.mount();

    this.taskSystem = new TaskSystem({
      input: this.input,
      elP1: document.getElementById('task-p1'),
      elP2: document.getElementById('task-p2'),
      onComplete: (playerId, taskIndex) => this._onTaskComplete(playerId, taskIndex),
      onClose: (playerId) => {
        // Fix: closing via UI button must also unlock the player's controls.
        this.players[playerId].controlsLocked = false;
        this._refreshTaskBeepLoop();
      }
    });

    this._resizeObserver = null;
    this._running = false;
    this._lastTs = 0;
  }

  start() {
    this.input.mount();

    // Initial setup (menu showing).
    this._resetRound();
    this._applyMenuMode(true);
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.canvas);

    this._running = true;
    requestAnimationFrame((t) => this._frame(t));
  }

  _bindUI() {
    const ui = {
      menu: document.getElementById('menu'),
      menuCenter: document.querySelector('#menu .menu-center'),
      fade: document.getElementById('fade'),
      startBtn: document.getElementById('start-btn'),
      fullscreenBtn: document.getElementById('fullscreen-btn'),
      volume: document.getElementById('volume'),
      mouseFire: document.getElementById('mouse-fire'),
      mouseFireLive: document.getElementById('mouse-fire-live'),

      scoreboard: document.getElementById('scoreboard'),
      splitBar: document.getElementById('split-bar'),
      centerMsg: document.getElementById('center-msg'),
      win: document.getElementById('win-screen'),
      winTitle: document.getElementById('win-title'),
      winSub: document.getElementById('win-sub'),
      stars: document.getElementById('stars'),
      saveBtn: document.getElementById('save-btn'),

      controlsHelp: document.getElementById('controls-help'),
      buildTag: document.getElementById('build-tag'),
      weatherPill: document.getElementById('weather-pill'),
      killPopGlobal: document.getElementById('kill-pop-global'),
      toastMsg: document.getElementById('toast-msg'),
      badgeToast: document.getElementById('badge-toast'),
      badgeToastTitle: document.getElementById('badge-toast-title'),
      badgeToastSub: document.getElementById('badge-toast-sub'),

      invBag: document.getElementById('inv-bag'),
      invOverlay: document.getElementById('inv-overlay'),
      invGrid: document.getElementById('inv-grid'),
      invClose: document.getElementById('inv-close'),
      invEmpty: document.getElementById('inv-empty'),

      introBtn: document.getElementById('intro-btn'),
      introOverlay: document.getElementById('intro-overlay'),
      introSheet: document.getElementById('intro-sheet'),
      introEgg: document.getElementById('intro-egg'),

      achBtn: document.getElementById('ach-btn'),
      achOverlay: document.getElementById('ach-overlay'),
      achGrid: document.getElementById('ach-grid'),
      achClose: document.getElementById('ach-close'),

      packBtn: document.getElementById('pack-btn'),
      packOverlay: document.getElementById('pack-overlay'),
      packBig: document.getElementById('pack-big'),
      packResult: document.getElementById('pack-result'),
      packResultItem: document.getElementById('pack-result-item'),
      packClose: document.getElementById('pack-close'),
      packStatus: document.getElementById('pack-status'),

      codeBtn: document.getElementById('code-btn'),
      codeOverlay: document.getElementById('code-overlay'),
      codeInput: document.getElementById('code-input'),
      codeSubmit: document.getElementById('code-submit'),
      codeClose: document.getElementById('code-close'),
      codeMsg: document.getElementById('code-msg'),

      vipBtn: document.getElementById('vip-btn'),
      vipOverlay: document.getElementById('vip-overlay'),
      vipInput: document.getElementById('vip-input'),
      vipSubmit: document.getElementById('vip-submit'),
      vipAll: document.getElementById('vip-all'),
      vipClose: document.getElementById('vip-close'),
      vipMsg: document.getElementById('vip-msg'),

      p1: {
        hud: document.getElementById('hud-p1'),
        hp: document.getElementById('p1-hp'),
        prompt: document.getElementById('p1-prompt'),
        invuln: document.getElementById('p1-invuln'),
        weapon: document.getElementById('p1-weapon'),
        killPop: document.getElementById('p1-kill-pop'),
        scope: document.getElementById('p1-scope')
      },
      p2: {
        hud: document.getElementById('hud-p2'),
        hp: document.getElementById('p2-hp'),
        prompt: document.getElementById('p2-prompt'),
        invuln: document.getElementById('p2-invuln'),
        weapon: document.getElementById('p2-weapon'),
        killPop: document.getElementById('p2-kill-pop'),
        radar: document.getElementById('p2-radar'),
        scope: document.getElementById('p2-scope')
      }
    };
    if (ui.buildTag) ui.buildTag.textContent = BUILD_TAG;
    ui.p1.radar = document.getElementById('p1-radar');
    ui.p1.radarCtx = ui.p1.radar?.getContext('2d');
    ui.p2.radarCtx = ui.p2.radar?.getContext('2d');

    ui.startBtn.addEventListener('click', async () => {
      await this.audio.unlock(); // user gesture unlock (required for audio in browsers)
      await this.audio.playOneShot(assetUrl('assets/audio/sfx/ui_click.ogg'), { volume: 0.7, fallback: 'taskComplete' });
      this._startTransitionToGame();
    });

    ui.fullscreenBtn.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch {
        // ignore (browser may block)
      }
    });

    ui.volume.addEventListener('input', () => {
      this.audio.setVolume(Number(ui.volume.value));
    });
    this.audio.setVolume(Number(ui.volume.value));

    ui.mouseFire.addEventListener('change', () => {
      this.config.mouseFireMode = ui.mouseFire.value;
      if (ui.mouseFireLive) ui.mouseFireLive.value = ui.mouseFire.value;
    });
    this.config.mouseFireMode = ui.mouseFire.value;
    if (ui.mouseFireLive) ui.mouseFireLive.value = ui.mouseFire.value;

    ui.mouseFireLive?.addEventListener('change', () => {
      this.config.mouseFireMode = ui.mouseFireLive.value;
      ui.mouseFire.value = ui.mouseFireLive.value;
    });

    ui.saveBtn.addEventListener('click', async () => {
      await this.audio.unlock();
      await this.audio.playOneShot(assetUrl('assets/audio/sfx/ui_click.ogg'), { volume: 0.7, fallback: 'taskComplete' });
      // Back to menu without wiping inventory/codes (they live in WeatherSystem memory).
      this._toMenu();
    });

    // Star rating.
    ui._rating = 0;
    ui.stars?.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target);
      const v = Number(btn?.dataset?.star ?? 0);
      if (!v) return;
      ui._rating = v;
      const all = ui.stars.querySelectorAll('.star');
      all.forEach((s) => s.classList.toggle('filled', Number(s.dataset.star) <= ui._rating));
      if (ui._rating === 5) this._unlockBadge('star');
    });

    // Intro (menu only).
    ui.introBtn?.addEventListener('click', async () => {
      await this.audio.unlock();
      await this.audio.playOneShot(assetUrl('assets/audio/sfx/ui_click.ogg'), { volume: 0.7, fallback: 'taskComplete' });
      this._openIntro('credits');
    });
    ui.introOverlay?.addEventListener('click', (e) => {
      // Clicking the egg should not close the overlay.
      if (e.target === ui.introEgg || ui.introEgg?.contains(/** @type {Node} */ (e.target))) return;
      this._closeIntro();
    });
    ui.introEgg?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._unlockBadge('egg');
      this._showToast('Easter egg bulundu');
      this._closeIntro();
    });

    // Achievements (menu only).
    ui.achBtn?.addEventListener('click', async () => {
      await this.audio.unlock();
      await this.audio.playOneShot(assetUrl('assets/audio/sfx/ui_click.ogg'), { volume: 0.7, fallback: 'taskComplete' });
      this._openAchievements();
    });
    ui.achClose?.addEventListener('click', () => this._closeAchievements());
    ui.achOverlay?.addEventListener('click', (e) => {
      if (e.target === ui.achOverlay) this._closeAchievements();
    });

    // Help overlay (H).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') {
        ui.controlsHelp.classList.toggle('hidden');
        if (!ui.controlsHelp.classList.contains('hidden')) document.exitPointerLock?.();
      }
    });

    // Pointer lock request: click canvas during gameplay.
    this.canvas.addEventListener('click', () => {
      if (this.state !== 'ELEVATOR' && this.state !== 'PLAY') return;
      if (this.taskSystem.isOpen('p1') || this.taskSystem.isOpen('p2')) return;
      if (!ui.controlsHelp.classList.contains('hidden')) return;
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
    });

    return ui;
  }

  _installMenuIdleListeners() {
    // Any user interaction resets the 2-minute idle timer (for easter egg).
    const mark = () => {
      this._menuIdleT = 0;
    };
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('mousemove', mark, { passive: true });
    window.addEventListener('keydown', mark, { passive: true });
    window.addEventListener('wheel', mark, { passive: true });
    window.addEventListener('touchstart', mark, { passive: true });
  }

  _openIntro(mode = 'credits') {
    if (!this._ui?.introOverlay || !this._ui?.introSheet) return;
    this._intro.open = true;
    this._intro.mode = mode;
    this._intro.y = 0;
    this._ui.introOverlay.classList.remove('hidden');

    if (mode === 'idle') {
      // Blank slide + egg button.
      this._ui.introSheet.innerHTML = '';
      this._ui.introEgg?.classList.add('hidden');
    } else {
      // Restore credits (in case idle cleared it).
      this._ui.introSheet.innerHTML = `
        <div class="intro-line intro-title">INTRO</div>
        <div class="intro-line">Yapımcılar Cookiez</div>
        <div class="intro-line">Egemen</div>
        <div class="intro-line">hüseyin</div>
        <div class="intro-line">yarıdımcı cursor</div>
      `;
      this._ui.introEgg?.classList.add('hidden');
    }
    this._syncIntroTransform();
  }

  _closeIntro() {
    this._intro.open = false;
    this._ui?.introOverlay?.classList.add('hidden');
    this._ui?.introEgg?.classList.add('hidden');
  }

  _syncIntroTransform() {
    const sheet = this._ui?.introSheet;
    if (!sheet) return;
    sheet.style.transform = `translateY(${this._intro.y}px)`;
  }

  _openAchievements() {
    this._ui?.achOverlay?.classList.remove('hidden');
    this._syncAchievementsUI();
  }

  _closeAchievements() {
    this._ui?.achOverlay?.classList.add('hidden');
  }

  _syncAchievementsUI() {
    const grid = this._ui?.achGrid;
    if (!grid) return;
    grid.innerHTML = '';

    const mk = (key, labelUnlocked, iconKind) => {
      const unlocked = !!this._badges[key];
      const el = document.createElement('div');
      el.className = `badge-item${unlocked ? ' unlocked' : ''}`;

      if (iconKind === 'weather') {
        const icon = document.createElement('div');
        icon.className = 'bicon weather-icons';
        icon.innerHTML = `<span class="cloud"></span><span class="sun"></span><span class="volcano"></span>`;
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = unlocked ? labelUnlocked : '???';
        el.appendChild(icon);
        el.appendChild(label);
        return el;
      }

      const icon = document.createElement('div');
      icon.className = 'bicon';
      icon.dataset.badge = iconKind;
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = unlocked ? labelUnlocked : '???';
      el.appendChild(icon);
      el.appendChild(label);
      return el;
    };

    grid.appendChild(mk('egg', 'Yumurta', 'egg'));
    grid.appendChild(mk('star', 'Yıldız', 'star'));
    grid.appendChild(mk('weather', 'Hava Durumları', 'weather'));
  }

  _showBadgeToast(title) {
    const el = this._ui?.badgeToast;
    if (!el) return;
    const now = performance.now();
    if (now - this._lastBadgeToastAt < 350) return;
    this._lastBadgeToastAt = now;

    if (this._ui.badgeToastTitle) this._ui.badgeToastTitle.textContent = String(title).toUpperCase();
    if (this._ui.badgeToastSub) this._ui.badgeToastSub.textContent = 'Badge kazanıldı';
    el.classList.remove('show');
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3100);
  }

  _unlockBadge(kind) {
    if (this._badges?.[kind]) return;
    this._badges[kind] = true;
    const title = kind === 'egg' ? 'Yumurta' : kind === 'star' ? 'Yıldız' : 'Hava Durumları';
    this._showBadgeToast(title);
    this._syncAchievementsUI();
  }

  _maybeUnlockWeatherBadge() {
    if (this._badges.weather) return;
    // Requirement: collect all weather types EXCEPT volcano.
    const items = this.weather?.inventoryItems ?? [];
    const required = ['sun', 'cloud', 'lightning', 'all_gold', 'bomber', 'yilbasi', 'tuhafliklar', 'hack'];
    const ok = required.every((t) => items.includes(t));
    if (ok) this._unlockBadge('weather');
  }

  _showGlobalKillPop() {
    const el = this._ui?.killPopGlobal;
    if (!el) return;
    el.classList.remove('show');
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1200);
  }

  _showToast(msg) {
    const el = this._ui?.toastMsg;
    if (!el) return;
    el.textContent = String(msg);
    el.classList.remove('show');
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  _showKillPop(killerId) {
    const el = this._ui?.[killerId]?.killPop;
    if (!el) return;
    el.classList.remove('show');
    // Restart animation reliably.
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 980);
  }

  _applyMenuMode(isMenu) {
    // Keep the menu DOM alive because it owns the fade overlay.
    if (isMenu) {
      this._ui.menu.classList.remove('in-game');
      document.body.classList.add('menu-mode');
    } else {
      this._ui.menu.classList.add('in-game');
      document.body.classList.remove('menu-mode');
    }

    // Menu-only UI: bag + inventory overlay must not show in game.
    this._ui.invBag?.classList.toggle('hidden', !isMenu);
    if (!isMenu) {
      this._ui.invOverlay?.classList.add('hidden');
      this._ui.introOverlay?.classList.add('hidden');
      this._ui.achOverlay?.classList.add('hidden');
      this._intro.open = false;
    }
  }

  _toMenu() {
    document.exitPointerLock?.();
    this.state = 'MENU';
    this._applyMenuMode(true);

    this._ui.fade.classList.remove('on');
    this._ui.scoreboard.classList.add('hidden');
    this._ui.splitBar.classList.add('hidden');
    this._ui.centerMsg.classList.add('hidden');
    this._ui.win.classList.add('hidden');

    this.taskSystem.close('p1');
    this.taskSystem.close('p2');
    this.players.p1.controlsLocked = false;
    this.players.p2.controlsLocked = false;

    this.audio.stopLoop('elevator');
    this.audio.stopLoop('taskBeep');
    this.audio.stopLoop('music');
    // If a real ambient audio buffer was playing, stop it too.
    this.audio.stopAmbient();
    this._resetRound();
    this._maybeUnlockWeatherBadge();
  }

  _startTransitionToGame() {
    if (this.state !== 'MENU') return;
    this.state = 'TRANSITION';
    this._applyMenuMode(false);

    // Fade to black...
    this._ui.fade.classList.add('on');

    // After fully black, setup elevator start, then fade back in.
    setTimeout(() => {
      this._beginElevatorPhase();
      // Fade in.
      setTimeout(() => this._ui.fade.classList.remove('on'), 180);
    }, 700);
  }

  _beginElevatorPhase() {
    this.state = 'ELEVATOR';
    this._ui.scoreboard.classList.remove('hidden');
    this._ui.splitBar.classList.remove('hidden');
    this._ui.win.classList.add('hidden');
    this._ui.centerMsg.classList.remove('hidden');
    this._ui.centerMsg.textContent = 'ELEVATOR 10';

    // Reset elevator timer and close doors.
    this.elevator.t = 16;
    this.elevator.doorOpen01 = 0;
    this.elevator.fightMsgTimer = 0;
    this.elevator._lastShownInt = 16;
    this.elevator.doorSfxPlayed = false;
    this.elevator.introSpoken = false;
    this.world.setElevatorDoorOpen('p1', 0);
    this.world.setElevatorDoorOpen('p2', 0);
    this.world.setElevatorCabinAlpha('p1', 1);
    this.world.setElevatorCabinAlpha('p2', 1);
    this.world.setElevatorDisplay('p1', '16');
    this.world.setElevatorDisplay('p2', '16');

    // Spawn both players inside their elevators.
    this._spawnInElevator();

    // No mario music (user request). Keep ambient optional only.
    this.audio.playAmbientLoop(assetUrl('assets/audio/music/arcade_ambient.ogg'), { volume: 0.16, fallback: null });
    // Extra elevator hum layer (stops when doors fully open / fight starts).
    this.audio.startLoop('elevator', 'elevatorHum', { volume: 0.55 });

    // Apply selected weather visuals at match start.
    this.weather.applyToWorld();
  }

  _resetRound() {
    this.scores.p1 = 0;
    this.scores.p2 = 0;
    this._firstKillDone = false;

    // Task progression persists for the whole round (otherwise tasks feel pointless).
    // If you want "every respawn resets to knife", reset taskLevel on respawn instead.
    this.players.p1.taskLevel = 0;
    this.players.p2.taskLevel = 0;

    this.weapons.p1.setWeapon(weaponForTaskLevel(this.players.p1.taskLevel));
    this.weapons.p2.setWeapon(weaponForTaskLevel(this.players.p2.taskLevel));
    this.weaponViews.p1.setWeapon(this.weapons.p1.type);
    this.weaponViews.p2.setWeapon(this.weapons.p2.type);

    // Place players somewhere safe for menu background.
    this.players.p1.respawnAt(new THREE.Vector3(-10, 0, 0));
    this.players.p2.respawnAt(new THREE.Vector3(10, 0, 0));
    this.players.p1.setYawPitch(Math.PI / 2, 0);
    this.players.p2.setYawPitch(-Math.PI / 2, 0);
  }

  _spawnInElevator() {
    const p1 = this.players.p1;
    const p2 = this.players.p2;
    const a1 = this.world.elevators.p1.anchor;
    const a2 = this.world.elevators.p2.anchor;
    p1.respawnAt(new THREE.Vector3(a1.x, 0, a1.z));
    p2.respawnAt(new THREE.Vector3(a2.x, 0, a2.z));
    p1.setYawPitch(Math.PI / 2, 0);
    p2.setYawPitch(-Math.PI / 2, 0);

    // Ensure correct weapon for current task progression.
    this.weapons.p1.setWeapon(weaponForTaskLevel(p1.taskLevel));
    this.weapons.p2.setWeapon(weaponForTaskLevel(p2.taskLevel));
    this.weaponViews.p1.setWeapon(this.weapons.p1.type);
    this.weaponViews.p2.setWeapon(this.weapons.p2.type);
  }

  _resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
  }

  _frame(ts) {
    if (!this._running) return;
    const dt = this._lastTs ? Math.min(0.05, (ts - this._lastTs) / 1000) : 0;
    this._lastTs = ts;

    this._update(dt);
    this._render();

    // Clear one-frame inputs AFTER we've consumed them this frame.
    this.input.frameStart();
    requestAnimationFrame((t) => this._frame(t));
  }

  _update(dt) {
    // Menu background demo (visual only).
    if (this.state === 'MENU') {
      this.demoBots.setEnabled(true);
      this.demoBots.update(dt);

      // Idle easter egg: after 2 minutes idle in menu, show blank intro + egg.
      const anyOverlayOpen =
        !this._ui.packOverlay?.classList.contains('hidden') ||
        !this._ui.codeOverlay?.classList.contains('hidden') ||
        !this._ui.vipOverlay?.classList.contains('hidden') ||
        !this._ui.invOverlay?.classList.contains('hidden') ||
        !this._ui.achOverlay?.classList.contains('hidden') ||
        !this._ui.introOverlay?.classList.contains('hidden');
      if (!anyOverlayOpen) {
        this._menuIdleT += dt;
        if (this._menuIdleT >= 120 && !this._intro.open) {
          this._openIntro('idle');
        }
      }
    } else {
      this.demoBots.setEnabled(false);
    }

    // Intro scroll animation (very slow, downwards).
    if (this._intro.open && this._ui.introSheet) {
      if (this._intro.mode === 'idle') {
        // Slide down a bit, then stop and reveal the egg.
        const stopAt = 260;
        if (this._intro.y < stopAt) {
          this._intro.y = Math.min(stopAt, this._intro.y + 18 * dt);
          if (this._intro.y >= stopAt - 0.01) this._ui.introEgg?.classList.remove('hidden');
        } else {
          this._ui.introEgg?.classList.remove('hidden');
        }
        this._syncIntroTransform();
      } else {
        const maxY = 1600;
        this._intro.y = Math.min(maxY, this._intro.y + 22 * dt);
        this._syncIntroTransform();
      }
    }

    // Weather animation (lightning flashes) during gameplay only.
    this.weather.update(dt, this.state === 'ELEVATOR' || this.state === 'PLAY');

    // Global key: ESC leaves pointer lock by browser default.
    // Toggle tasks:
    if (this.state === 'ELEVATOR' || this.state === 'PLAY') {
      this._handleTaskToggles();
    }

    // Close tasks if a player is dead.
    for (const id of ['p1', 'p2']) {
      if (this.players[id].dead && this.taskSystem.isOpen(id)) {
        this.taskSystem.close(id);
        this.players[id].controlsLocked = false;
        this._refreshTaskBeepLoop();
      }
    }

    // Elevator phase countdown.
    if (this.state === 'ELEVATOR') {
      // Speak intro once near the start of the elevator ride.
      if (!this.elevator.introSpoken && this.elevator.t <= 15.2) {
        this.elevator.introSpoken = true;
        this.audio.speak('Bu oyun tamamen Cookiez tarafından yapıldı. İyi oyunlar.', { lang: 'tr-TR', rate: 1.0, pitch: 1.0, volume: 1.0 });
        setTimeout(() => {
          this.audio.playOneShot(assetUrl('assets/audio/sfx/phone_hangup.ogg'), { volume: 0.6, fallback: 'hangup' });
        }, 2600);
      }

      this.elevator.t = Math.max(0, this.elevator.t - dt);
      const shown = Math.ceil(this.elevator.t);
      if (shown !== this.elevator._lastShownInt) {
        this.elevator._lastShownInt = shown;
        this._ui.centerMsg.textContent = `ELEVATOR ${shown}`;
        this.world.setElevatorDisplay('p1', String(shown));
        this.world.setElevatorDisplay('p2', String(shown));
      }

      // Door stays closed until 0.
      if (this.elevator.t <= 0) {
        // Animate door open.
        this.elevator.doorOpen01 = Math.min(1, this.elevator.doorOpen01 + dt * 1.2);
        if (!this.elevator.doorSfxPlayed) {
          this.elevator.doorSfxPlayed = true;
          this.audio.playOneShot(assetUrl('assets/audio/sfx/elevator_door.ogg'), { volume: 0.7, fallback: 'elevatorDoor' });
          // Elevator reached ground: stop hum immediately (user request).
          this.audio.stopLoop('elevator');
        }
        this.world.setElevatorDoorOpen('p1', this.elevator.doorOpen01);
        this.world.setElevatorDoorOpen('p2', this.elevator.doorOpen01);
        // Keep elevator cabin always visible (user request: "her yeri beyaz olsun").
        this.world.setElevatorCabinAlpha('p1', 1);
        this.world.setElevatorCabinAlpha('p2', 1);

        if (this.elevator.fightMsgTimer <= 0) {
          this._ui.centerMsg.textContent = 'FIGHT';
          this.elevator.fightMsgTimer = 1.6;
        }
        this.elevator.fightMsgTimer = Math.max(0, this.elevator.fightMsgTimer - dt);
        if (this.elevator.doorOpen01 >= 1 && this.elevator.fightMsgTimer <= 0) {
          this._ui.centerMsg.classList.add('hidden');
          this.state = 'PLAY';
          this.audio.stopLoop('elevator');
        }
      }
    }

    // Gameplay updates.
    if (this.state === 'ELEVATOR' || this.state === 'PLAY') {
      this._handleHackKeys();
      this._updatePlayers(dt);
      this.taskSystem.update(dt);
      this._updateHUD();
      this._updateScoreboard();
      this._updateRadar();
    }

    if (this.state === 'WIN') {
      this._updateHUD();
      this._updateScoreboard();
    }

    // World-space combat FX (damage numbers, particles, corpses).
    this._updateCombatFx(dt);
  }

  _handleHackKeys() {
    if (!this._cheatsEnabled) return;
    if (this.state !== 'PLAY') return;

    // (1) give both sniper
    if (this.input.wasPressed('Digit1')) {
      this.players.p1.taskLevel = 3;
      this.players.p2.taskLevel = 3;
      this.weapons.p1.setWeapon(WeaponType.SNIPER);
      this.weapons.p2.setWeapon(WeaponType.SNIPER);
      this.weaponViews.p1.setWeapon(this.weapons.p1.type);
      this.weaponViews.p2.setWeapon(this.weapons.p2.type);
      this._showToast('HACK (1): iki oyuncuya da SNIPER verildi');
    }

    // (2) meteor + fire
    if (this.input.wasPressed('Digit2')) {
      const line = 'ooooooooaaaaaaaa meteor gelioooo';
      this._showToast(line);
      this.audio.speak(line, { lang: 'tr-TR', rate: 1.0, pitch: 1.0, volume: 1.0 });
      // Use existing bomber-style bomb but heavier: spawn a few bombs quickly.
      for (let i = 0; i < 3; i++) {
        const x = randRange(-this.world.roomW / 2 + 20, this.world.roomW / 2 - 20);
        const z = randRange(-this.world.roomD / 2 + 16, this.world.roomD / 2 - 16);
        this.world.spawnBomb?.(x, z);
      }
    }

    // (3) add hack weather item
    if (this.input.wasPressed('Digit3')) {
      this.weather.grantHackWeather?.();
      this._showToast('HACK (3): hack hava durumu eklendi');
    }
  }

  _updateCombatFx(dt) {
    // Damage numbers.
    for (let i = this._damageTexts.length - 1; i >= 0; i--) {
      const d = this._damageTexts[i];
      d.t += dt;
      const a = clamp(1 - d.t / d.life, 0, 1);
      d.sprite.position.addScaledVector(d.vel, dt);
      // Ease-out fade.
      d.sprite.material.opacity = a * a;
      // Slight grow then settle.
      const s = 0.8 + Math.min(0.25, d.t * 0.35);
      d.sprite.scale.setScalar(s);
      if (d.t >= d.life) {
        this.world.scene.remove(d.sprite);
        this._damageTexts.splice(i, 1);
        this._damageTextPool.push(d);
      }
    }

    // Blood particles.
    for (let i = this._blood.length - 1; i >= 0; i--) {
      const p = this._blood[i];
      p.t += dt;
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      // Simple ground collision + slide.
      if (p.mesh.position.y <= 0.02) {
        p.mesh.position.y = 0.02;
        p.vel.y *= -0.15;
        p.vel.x *= 0.55;
        p.vel.z *= 0.55;
      }
      const a = clamp(1 - p.t / p.life, 0, 1);
      p.mesh.material.opacity = a;
      if (p.t >= p.life) {
        this.world.scene.remove(p.mesh);
        this._blood.splice(i, 1);
        this._bloodPool.push(p);
      }
    }

    // Corpses (cheap ragdoll-ish fall + fade).
    for (let i = this._corpses.length - 1; i >= 0; i--) {
      const c = this._corpses[i];
      c.t += dt;
      // Fall/tilt in first 0.35s.
      const k = clamp(c.t / 0.35, 0, 1);
      const ease = 1 - (1 - k) * (1 - k);
      c.group.rotation.x = c.rot0.x + (c.rot1.x - c.rot0.x) * ease;
      c.group.rotation.z = c.rot0.z + (c.rot1.z - c.rot0.z) * ease;
      // Small slide.
      c.group.position.addScaledVector(c.vel, dt);
      c.vel.multiplyScalar(Math.exp(-3.2 * dt));

      // Fade out near the end.
      const fadeStart = 1.0;
      const fadeEnd = 2.0;
      if (c.t >= fadeStart) {
        const a = clamp(1 - (c.t - fadeStart) / (fadeEnd - fadeStart), 0, 1);
        c._mats.forEach((m) => {
          m.transparent = true;
          m.opacity = a;
        });
      }
      if (c.t >= fadeEnd) {
        this.world.scene.remove(c.group);
        this._corpses.splice(i, 1);
      }
    }
  }

  _spawnDamageNumber(worldPos, amount) {
    const text = `-${amount}`;
    const d =
      this._damageTextPool.pop() ??
      (() => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          opacity: 1,
          depthWrite: false
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.9, 0.45, 1);
        return { sprite, canvas, ctx, tex, t: 0, life: 2.0, vel: new THREE.Vector3() };
      })();

    d.t = 0;
    d.life = 2.0;
    d.sprite.material.opacity = 1;
    d.sprite.position.copy(worldPos);
    d.vel.set(randRange(-0.15, 0.15), randRange(0.55, 0.85), randRange(-0.15, 0.15));

    // Draw text to canvas.
    const ctx = d.ctx;
    ctx.clearRect(0, 0, d.canvas.width, d.canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, d.canvas.width, d.canvas.height);
    ctx.font = '1000 72px ui-sans-serif, system-ui, Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeText(text, d.canvas.width / 2, d.canvas.height / 2);
    ctx.fillStyle = '#ff2b2b';
    ctx.fillText(text, d.canvas.width / 2, d.canvas.height / 2);
    d.tex.needsUpdate = true;

    this.world.scene.add(d.sprite);
    this._damageTexts.push(d);
  }

  _spawnBloodParticles(worldPos, count = 10) {
    for (let i = 0; i < count; i++) {
      const p =
        this._bloodPool.pop() ??
        (() => {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xff2b2b, transparent: true, opacity: 1, depthWrite: false })
          );
          return { mesh, vel: new THREE.Vector3(), t: 0, life: 0.9 };
        })();
      p.t = 0;
      p.life = 0.85 + Math.random() * 0.45;
      p.mesh.material.opacity = 1;
      p.mesh.position.copy(worldPos);
      p.mesh.position.y = Math.max(0.15, p.mesh.position.y);
      p.vel.set(randRange(-1.4, 1.4), randRange(1.6, 3.2), randRange(-1.4, 1.4));
      this.world.scene.add(p.mesh);
      this._blood.push(p);
    }
  }

  _spawnCorpseFromPlayer(playerId) {
    const src = this.players[playerId];
    const corpse = src.model.clone(true);

    // Collect materials and make them independent so we can fade safely.
    const mats = new Set();
    corpse.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      mats.add(o.material);
    });

    corpse.position.set(src.pos.x, src.pos.y, src.pos.z);
    corpse.rotation.set(0, src.yaw, 0);

    // Random limb flops for a goofy “ragdoll”.
    const names = [`${playerId}-head`, `${playerId}-armL`, `${playerId}-armR`, `${playerId}-legL`, `${playerId}-legR`];
    for (const n of names) {
      const m = corpse.getObjectByName(n);
      if (!m) continue;
      m.rotation.x += randRange(-1.4, 1.0);
      m.rotation.z += randRange(-0.8, 0.8);
    }

    this.world.scene.add(corpse);
    this._corpses.push({
      group: corpse,
      t: 0,
      vel: new THREE.Vector3(randRange(-0.8, 0.8), 0, randRange(-0.8, 0.8)),
      rot0: new THREE.Vector3(0, src.yaw, 0),
      rot1: new THREE.Vector3(randRange(1.2, 1.7), src.yaw, randRange(-1.0, 1.0)),
      _mats: Array.from(mats)
    });
  }

  _handleTaskToggles() {
    const p1 = this.players.p1;
    const p2 = this.players.p2;
    const near1 = this._nearestArcade(p1);
    const near2 = this._nearestArcade(p2);
    const bottle1 = this._nearestBottle(p1);
    const bottle2 = this._nearestBottle(p2);
    const gift1 = this._nearestGift(p1);
    const gift2 = this._nearestGift(p2);

    // P1 toggle: E
    if (this.input.wasPressed('KeyE')) {
      if (gift1) {
        this._tryOpenGift('p1');
        return;
      }
      if (bottle1) {
        this._tryPickBottle('p1', bottle1.id);
        return;
      }
      if (this.taskSystem.isOpen('p1')) {
        this.taskSystem.close('p1');
        p1.controlsLocked = false;
      } else if (near1) {
        this._tryOpenTask('p1', near1.taskIndex);
      }
    }

    // P2 toggle: Right click
    if (this.input.mouse.rightPressed) {
      if (gift2) {
        this._tryOpenGift('p2');
        return;
      }
      if (bottle2) {
        this._tryPickBottle('p2', bottle2.id);
        return;
      }
      if (this.taskSystem.isOpen('p2')) {
        this.taskSystem.close('p2');
        p2.controlsLocked = false;
      } else if (near2) {
        this._tryOpenTask('p2', near2.taskIndex);
      }
    }
  }

  _nearestBottle(player) {
    let best = null;
    let bestD2 = Infinity;
    for (const b of this.world.bottles ?? []) {
      if (b.picked) continue;
      const d2 = dist2(player.pos, b.position);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = b;
      }
    }
    if (best && bestD2 <= 2.3 * 2.3) return best;
    return null;
  }

  _nearestGift(player) {
    // Gift is a world object; World decides if any is near.
    // We reuse the same distance threshold as bottles.
    for (const g of this.world.gifts ?? []) {
      if (g.state !== 'ready') continue;
      const d2 = dist2(player.pos, g.mesh.position);
      if (d2 <= 2.4 * 2.4) return g;
    }
    return null;
  }

  _grantBonusWeapon(playerId, type) {
    this._bonusWeapon[playerId] = type;
    this.weapons[playerId].setWeapon(type);
    this.weaponViews[playerId].setWeapon(type);
  }

  _tryOpenGift(playerId) {
    const p = this.players[playerId];
    if (p.dead || p.controlsLocked) return;
    const ok = this.world.openGiftNear?.(p.pos);
    if (!ok) return;

    // Random weapon: Laser is normal chance now.
    const roll = Math.random();
    const type = roll < 0.5 ? WeaponType.LASER : WeaponType.SHOTGUN;
    this._grantBonusWeapon(playerId, type);
  }

  _tryPickBottle(playerId, bottleId) {
    const p = this.players[playerId];
    if (p.dead) return;
    if (p.controlsLocked) return;
    if (this.weapons[playerId].type === WeaponType.BOTTLE) return;

    const ok = this.world.pickBottle?.(bottleId);
    if (!ok) return;

    p.hasBottle = true;
    p.bottlePrevWeapon = this.weapons[playerId].type;
    this.weapons[playerId].setWeapon(WeaponType.BOTTLE);
    this.weaponViews[playerId].setWeapon(WeaponType.BOTTLE);
  }

  _tryOpenTask(playerId, taskIndex) {
    const p = this.players[playerId];
    if (p.dead) return;

    // Task gating: must do Task 1 -> Task 2 -> Task 3.
    if (taskIndex !== p.taskLevel) {
      // Locked: show a brief hint via prompt (HUD update will keep it visible near arcade).
      return;
    }

    document.exitPointerLock?.();
    p.controlsLocked = true;
    this.taskSystem.open(playerId, taskIndex);
    // Task start SFX + shared beep loop while ANY player is in a task.
    this.audio.playOneShot(assetUrl('assets/audio/sfx/task_start.ogg'), { volume: 0.8, fallback: 'reload' });
    this._refreshTaskBeepLoop();
  }

  _onTaskComplete(playerId, taskIndex) {
    const p = this.players[playerId];
    if (taskIndex !== p.taskLevel) return;
    p.taskLevel = clamp(p.taskLevel + 1, 0, 3);
    this.weapons[playerId].setWeapon(weaponForTaskLevel(p.taskLevel));
    this.weaponViews[playerId].setWeapon(this.weapons[playerId].type);
    this.audio.playOneShot(assetUrl('assets/audio/sfx/task_complete.ogg'), { volume: 0.9, fallback: 'taskComplete' });
    this._refreshTaskBeepLoop();
  }

  _refreshTaskBeepLoop() {
    const anyOpen = this.taskSystem.isOpen('p1') || this.taskSystem.isOpen('p2');
    if (anyOpen) this.audio.startLoop('taskBeep', 'taskBeep', { volume: 0.12 });
    else this.audio.stopLoop('taskBeep');
  }

  _nearestArcade(player) {
    // Only check XZ distance.
    let best = null;
    let bestD2 = Infinity;
    for (const a of this.world.arcades) {
      const d2 = dist2(player.pos, a.position);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = a;
      }
    }
    // threshold ~ 2.2 units
    if (best && bestD2 <= 2.2 * 2.2) return best;
    return null;
  }

  _updatePlayers(dt) {
    const p1 = this.players.p1;
    const p2 = this.players.p2;

    // Reduce timers.
    for (const p of [p1, p2]) {
      if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
      if (p.dead) p.deathTimer = Math.max(0, p.deathTimer - dt);
    }

    // Respawns.
    this._maybeRespawn('p1', 'p2');
    this._maybeRespawn('p2', 'p1');

    // Weapon updates (cooldown/reload/zoom).
    this.weapons.p1.update(dt);
    this.weapons.p2.update(dt);

    // Aim/look:
    // P1 look uses keyboard (Q/F/T/G).
    this._updateLookP1(dt);
    // P2 look uses mouse delta (pointer lock).
    this._updateLookP2(dt);

    // Movement.
    this._updateMovement('p1', dt);
    this._updateMovement('p2', dt);

    // Fire hazards (from exploded barrels).
    this._updateHazards(dt);

    // Footsteps (placeholder synth if no asset).
    this._updateFootsteps(dt);

    // Combat.
    this._handleReloads();
    this._handleFiring(dt);

    // Visual updates (mesh/camera).
    p1.updateVisual(dt);
    p2.updateVisual(dt);

    // Sniper camera FOV zoom blending.
    this._applySniperZoom('p1');
    this._applySniperZoom('p2');

    // Weapon visuals (first-person models + fx).
    this.weaponViews.p1.update(dt, { weaponType: this.weapons.p1.type, sniperZoom01: this.weapons.p1.sniperZoom01 });
    this.weaponViews.p2.update(dt, { weaponType: this.weapons.p2.type, sniperZoom01: this.weapons.p2.sniperZoom01 });
  }

  _updateHazards(dt) {
    // Update hazard visuals/lifetimes.
    this.world.update(dt);

    // Damage: 25 HP per second while touching a fire block.
    // Volcano request: lava is visual only (no damage).
    const dps = this.weather?.selected === 'volcano' ? 0 : 25;
    const fires = this.world.fireBlocks;
    const anyNear =
      fires.length &&
      (this._isAnyPlayerNearFire(this.players.p1, fires) || this._isAnyPlayerNearFire(this.players.p2, fires));

    // Fire crackle loop if any player is near any fire.
    if (anyNear) this.audio.startLoop('fire', 'fireCrackle', { volume: 0.12 });
    else this.audio.stopLoop('fire');

    for (const id of ['p1', 'p2']) {
      const p = this.players[id];
      if (p.dead) continue;
      // Simple AABB overlap against fire boxes using player radius.
      for (const f of fires) {
        const b = f.box;
        const px = p.pos.x;
        const pz = p.pos.z;
        const withinX = px >= b.min.x - PLAYER_RADIUS && px <= b.max.x + PLAYER_RADIUS;
        const withinZ = pz >= b.min.z - PLAYER_RADIUS && pz <= b.max.z + PLAYER_RADIUS;
        if (withinX && withinZ) {
          p.takeDamage(dps * dt);
        }
      }
    }
  }

  _isAnyPlayerNearFire(player, fires) {
    const r2 = 7.5 * 7.5;
    for (const f of fires) {
      const dx = f.mesh.position.x - player.pos.x;
      const dz = f.mesh.position.z - player.pos.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  _maybeRespawn(deadId, enemyId) {
    const p = this.players[deadId];
    if (!p.dead) return;
    if (p.deathTimer > 0) return;

    const spawn = this._pickSpawnFarFromEnemy(this.players[enemyId]);
    p.respawnAt(spawn);
    p.setYawPitch(randRange(-Math.PI, Math.PI), 0);

    // Re-equip based on tasks completed (or bonus weapon).
    const bonus = this._bonusWeapon[deadId];
    this.weapons[deadId].setWeapon(bonus ?? weaponForTaskLevel(p.taskLevel));
    this.weaponViews[deadId].setWeapon(this.weapons[deadId].type);
    // Drop bottle on death.
    p.hasBottle = false;
    p.bottlePrevWeapon = null;
  }

  _pickSpawnFarFromEnemy(enemy) {
    // Pick the farthest among a random subset of spawn points.
    const pts = this.world.spawnPoints;
    let best = pts[0];
    let bestD2 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = pts[Math.floor(Math.random() * pts.length)];
      const d2 = dist2(p, enemy.pos);
      if (d2 > bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return new THREE.Vector3(best.x, 0, best.z);
  }

  _updateLookP1(dt) {
    const p = this.players.p1;
    if (p.dead) return;
    const yawSpeed = 2.2;
    const pitchSpeed = 1.8;
    // Align with mouse look (P2): yaw decreases when turning right.
    if (this.input.isDown('KeyQ')) p.yaw += yawSpeed * dt; // left
    if (this.input.isDown('KeyF')) p.yaw += yawSpeed * dt; // left (user request)
    if (this.input.isDown('KeyH')) p.yaw -= yawSpeed * dt * 1.45; // right (strong)
    if (this.input.isDown('KeyT')) p.pitch += pitchSpeed * dt;
    if (this.input.isDown('KeyG')) p.pitch -= pitchSpeed * dt;
    p.pitch = clamp(p.pitch, -1.35, 1.35);
  }

  _updateLookP2(dt) {
    const p = this.players.p2;
    if (p.dead) return;
    if (!this.input.pointerLocked) return;
    const sens = 0.0021;
    p.yaw -= this.input.mouse.dx * sens;
    p.pitch -= this.input.mouse.dy * sens;
    p.pitch = clamp(p.pitch, -1.35, 1.35);
  }

  _updateMovement(playerId, dt) {
    const p = this.players[playerId];
    if (p.dead) return;
    if (p.controlsLocked) return; // tasks freeze movement (but player can still be killed)

    const w = this.weapons[playerId];

    let speed = 6.0;
    if (w.type === WeaponType.BOTTLE || p.hasBottle) speed *= 1.15;
    if (w.type === WeaponType.SNIPER && w.sniperZoom01 > 0.2) speed *= 0.55;

    // Input mapping.
    const forward = playerId === 'p1' ? this.input.isDown('KeyW') : this.input.isDown('ArrowUp');
    const back = playerId === 'p1' ? this.input.isDown('KeyS') : this.input.isDown('ArrowDown');
    const left = playerId === 'p1' ? this.input.isDown('KeyA') : this.input.isDown('ArrowLeft');
    const right = playerId === 'p1' ? this.input.isDown('KeyD') : this.input.isDown('ArrowRight');

    const moveX = (right ? 1 : 0) - (left ? 1 : 0);
    const moveZ = (forward ? 1 : 0) - (back ? 1 : 0);

    const len = Math.hypot(moveX, moveZ);
    const mx = len > 0 ? moveX / len : 0;
    const mz = len > 0 ? moveZ / len : 0;

    // Convert local movement to world using yaw.
    const sy = Math.sin(p.yaw);
    const cy = Math.cos(p.yaw);
    // Three.js camera forward at yaw=0 is -Z.
    const forwardX = -sy;
    const forwardZ = -cy;
    const rightX = cy;
    const rightZ = -sy;
    const dirX = rightX * mx + forwardX * mz;
    const dirZ = rightZ * mx + forwardZ * mz;

    // Simple acceleration.
    const accel = 24;
    p.vel.x += dirX * accel * dt;
    p.vel.z += dirZ * accel * dt;

    // Damping.
    const damp = Math.exp(-10 * dt);
    p.vel.x *= damp;
    p.vel.z *= damp;

    // Clamp max speed.
    const flatSpeed = Math.hypot(p.vel.x, p.vel.z);
    if (flatSpeed > speed) {
      const s = speed / flatSpeed;
      p.vel.x *= s;
      p.vel.z *= s;
    }

    // Gravity.
    p.vel.y -= 18 * dt;

    // Jump (only specified for P1).
    if (playerId === 'p1' && this.input.wasPressed('Space') && p.onGround) {
      p.vel.y = 7.5;
      p.onGround = false;
    }

    // Integrate.
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;

    // Ground plane.
    if (p.pos.y < 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.onGround = true;
    }

    // Collide with world boxes in XZ.
    this._resolveWorldCollisions(p);
  }

  _resolveWorldCollisions(p) {
    const r = PLAYER_RADIUS;
    const h = PLAYER_HEIGHT;
    const playerMin = this._tmpV;
    const playerMax = this._tmpV2;

    for (const c of this.world.colliders) {
      if (c.disabled) continue;
      const b = c.box;
      playerMin.set(p.pos.x - r, p.pos.y, p.pos.z - r);
      playerMax.set(p.pos.x + r, p.pos.y + h, p.pos.z + r);
      if (
        playerMax.x < b.min.x ||
        playerMin.x > b.max.x ||
        playerMax.y < b.min.y ||
        playerMin.y > b.max.y ||
        playerMax.z < b.min.z ||
        playerMin.z > b.max.z
      ) {
        continue;
      }

      // Compute overlap in X and Z and push out along the smaller axis.
      const boxCx = (b.min.x + b.max.x) * 0.5;
      const boxCz = (b.min.z + b.max.z) * 0.5;
      const dx1 = playerMax.x - b.min.x;
      const dx2 = b.max.x - playerMin.x;
      const overlapX = Math.min(dx1, dx2);
      const dz1 = playerMax.z - b.min.z;
      const dz2 = b.max.z - playerMin.z;
      const overlapZ = Math.min(dz1, dz2);

      if (overlapX < overlapZ) {
        const dir = p.pos.x < boxCx ? -1 : 1;
        p.pos.x += dir * overlapX;
        p.vel.x = 0;
      } else {
        const dir = p.pos.z < boxCz ? -1 : 1;
        p.pos.z += dir * overlapZ;
        p.vel.z = 0;
      }
    }
  }

  _handleReloads() {
    // P1 reload: R
    if (this.input.wasPressed('KeyR') && !this.players.p1.controlsLocked && !this.players.p1.dead) {
      const ok = this.weapons.p1.startReload();
      if (ok) this.audio.playOneShot(assetUrl('assets/audio/sfx/reload.ogg'), { volume: 0.7, fallback: 'reload' });
    }
    // P2 reload: Middle click
    if (this.input.mouse.middlePressed && !this.players.p2.controlsLocked && !this.players.p2.dead) {
      const ok = this.weapons.p2.startReload();
      if (ok) this.audio.playOneShot(assetUrl('assets/audio/sfx/reload.ogg'), { volume: 0.7, fallback: 'reload' });
    }
  }

  _updateFootsteps(dt) {
    for (const id of ['p1', 'p2']) {
      const p = this.players[id];
      if (p.dead) continue;
      if (!p.onGround) continue;
      if (p.controlsLocked) continue;
      const v = Math.hypot(p.vel.x, p.vel.z);
      const moving = v > 1.0;
      if (!moving) {
        this._stepT[id] = 0;
        continue;
      }
      this._stepT[id] = Math.max(0, this._stepT[id] - dt);
      if (this._stepT[id] === 0) {
        this._stepT[id] = 0.42;
        this.audio.playOneShot(assetUrl('assets/audio/sfx/step.ogg'), { volume: 0.25, fallback: 'step' });
      }
    }
  }

  _handleFiring(dt) {
    // Fire input sources:
    // - P2: Mouse Left
    // - P1: ShiftLeft (always) + optional Mouse Left when mouseFireMode === 'both'
    const p1FirePressed = this.input.wasPressed('ShiftLeft') || (this.config.mouseFireMode === 'both' && this.input.mouse.leftPressed);
    const p1FireReleased = this.input.wasReleased('ShiftLeft') || (this.config.mouseFireMode === 'both' && this.input.mouse.leftReleased);
    const p1FireDown = this.input.isDown('ShiftLeft') || (this.config.mouseFireMode === 'both' && this.input.mouse.leftDown);

    const p2FirePressed = this.input.mouse.leftPressed;
    const p2FireReleased = this.input.mouse.leftReleased;
    const p2FireDown = this.input.mouse.leftDown;

    this._processFire('p1', 'p2', p1FirePressed, p1FireReleased, p1FireDown);
    if (this.config.mouseFireMode === 'p2') {
      this._processFire('p2', 'p1', p2FirePressed, p2FireReleased, p2FireDown);
    } else {
      // In "both", P2 still fires from mouse, but P1 already consumed mouse for its own handling too.
      this._processFire('p2', 'p1', p2FirePressed, p2FireReleased, p2FireDown);
    }
  }

  _processFire(shooterId, targetId, pressed, released, down) {
    const shooter = this.players[shooterId];
    const target = this.players[targetId];
    const w = this.weapons[shooterId];
    if (shooter.dead) return;
    if (shooter.controlsLocked) return; // tasks: stand still; still killable.

    // Sniper: hold to zoom, release to fire (release-to-fire).
    if (w.type === WeaponType.SNIPER) {
      if (pressed) w.sniperAiming = true;
      if (released) {
        if (w.sniperAiming) {
          w.sniperAiming = false;
          this._shootHitscan(shooterId, targetId);
        }
      }
      return;
    }

    // Vandal: full auto while held.
    if (w.type === WeaponType.VANDAL) {
      if (down) this._shootHitscan(shooterId, targetId);
      return;
    }

    // Laser: fire on press (rare).
    if (w.type === WeaponType.LASER) {
      if (!pressed) return;
      this._shootLaser(shooterId, targetId);
      return;
    }

    // Shotgun: fire on press.
    if (w.type === WeaponType.SHOTGUN) {
      if (!pressed) return;
      this._shootShotgun(shooterId, targetId);
      return;
    }

    // Other weapons: fire on press.
    if (!pressed) return;
    if (w.type === WeaponType.KNIFE) {
      this._knifeAttack(shooterId, targetId);
    } else if (w.type === WeaponType.BOTTLE) {
      this._bottleAttack(shooterId, targetId);
    } else {
      this._shootHitscan(shooterId, targetId);
    }
  }

  _shootShotgun(shooterId, targetId) {
    const shooter = this.players[shooterId];
    const target = this.players[targetId];
    const w = this.weapons[shooterId];
    if (!w.canShoot()) {
      if (w.mag === 0) w.startReload();
      return;
    }

    const origin = shooter.getEyePosition(this._tmpV);
    const baseDir = shooter.getAimDir(this._tmpV2).clone();

    this.weaponViews[shooterId].triggerShot({ weaponType: w.type });

    // 7 pellets
    const pellets = 7;
    let hitTarget = false;
    let bestHitPoint = null;
    for (let i = 0; i < pellets; i++) {
      const dir = baseDir.clone();
      dir.x += randRange(-0.06, 0.06);
      dir.y += randRange(-0.04, 0.04);
      dir.z += randRange(-0.06, 0.06);
      dir.normalize();

      this._raycaster.set(origin, dir);
      this._raycaster.far = 40;
      const rayTargets = [...this.world.raycastMeshes];
      if (!target.dead) rayTargets.unshift(target.hitbox);
      const hit = this._raycaster.intersectObjects(rayTargets, true)[0];
      const end = hit ? hit.point : origin.clone().addScaledVector(dir, 40);
      this.weaponViews[shooterId].showTracer({ weaponType: w.type, origin, end });
      if (hit && hit.object === target.hitbox) {
        hitTarget = true;
        bestHitPoint = bestHitPoint ?? hit.point.clone();
      }
    }

    if (hitTarget && !target.dead && target.invulnTimer <= 0) {
      // Close vs far damage.
      const dist = origin.distanceTo(target.getEyePosition(this._tmpV2));
      const dmg = dist <= 8 ? 60 : 30;
      target.flashRed(1.0);
      this._spawnDamageNumber(target.getEyePosition(this._tmpV2).add(new THREE.Vector3(0, 0.18, 0)), dmg);
      if (bestHitPoint) this._spawnBloodParticles(bestHitPoint, 12);
      if (target.takeDamage(dmg)) this._onKill(shooterId, targetId);
    }

    w.consumeShot();
    // SFX uses existing pistol fallback if no asset.
    this.audio.playOneShot(assetUrl('assets/audio/sfx/shotgun.ogg'), { volume: 0.65, fallback: 'vandal' });
  }

  _shootLaser(shooterId, targetId) {
    const shooter = this.players[shooterId];
    const target = this.players[targetId];
    const w = this.weapons[shooterId];
    if (!w.canShoot()) {
      if (w.mag === 0) w.startReload();
      return;
    }

    const origin = shooter.getEyePosition(this._tmpV);
    const dir = shooter.getAimDir(this._tmpV2);
    this._raycaster.set(origin, dir);
    this._raycaster.far = 120;

    const rayTargets = [...this.world.raycastMeshes];
    if (!target.dead) rayTargets.unshift(target.hitbox);
    const hit = this._raycaster.intersectObjects(rayTargets, true)[0];
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 120);

    // Visual: red long laser.
    this.weaponViews[shooterId].triggerShot({ weaponType: w.type });
    this.weaponViews[shooterId].showTracer({ weaponType: WeaponType.SNIPER, origin, end });

    // Small explosion visual + 2 lava blocks.
    this.world._spawnFireBlock?.(end.x + 0.6, end.z, { lifetime: 9.0, withLight: false });
    this.world._spawnFireBlock?.(end.x - 0.6, end.z, { lifetime: 9.0, withLight: false });

    // Direct hit damage + small blast damage.
    if (hit && hit.object === target.hitbox) {
      const dmg = 60;
      if (!target.dead && target.invulnTimer <= 0) {
        target.flashRed(1.0);
        this._spawnDamageNumber(target.getEyePosition(this._tmpV2).add(new THREE.Vector3(0, 0.18, 0)), dmg);
        this._spawnBloodParticles(end, 14);
      }
      const died = target.takeDamage(dmg);
      // splash
      if (!died) {
        const splash = 10;
        target.takeDamage(splash);
      }
      if (died) this._onKill(shooterId, targetId);
    }

    w.consumeShot();
    this.audio.playOneShot(assetUrl('assets/audio/sfx/laser.ogg'), { volume: 0.55, fallback: 'sniper' });
  }

  _breakBottle(shooterId) {
    const p = this.players[shooterId];
    const prev = p.bottlePrevWeapon ?? WeaponType.KNIFE;
    p.hasBottle = false;
    p.bottlePrevWeapon = null;
    this.weapons[shooterId].setWeapon(prev);
    this.weaponViews[shooterId].setWeapon(this.weapons[shooterId].type);
  }

  _bottleAttack(shooterId, targetId) {
    const shooter = this.players[shooterId];
    const target = this.players[targetId];
    const w = this.weapons[shooterId];
    if (!w.canShoot()) return;

    const origin = shooter.getEyePosition(this._tmpV);
    const dir = shooter.getAimDir(this._tmpV2);

    this._raycaster.set(origin, dir);
    this._raycaster.far = 2.0;

    const rayTargets = [...this.world.raycastMeshes];
    if (!target.dead) rayTargets.unshift(target.hitbox);
    const hit = this._raycaster.intersectObjects(rayTargets, true)[0];

    if (hit && hit.object === target.hitbox) {
      const dmg = damageForWeapon(WeaponType.BOTTLE);
      if (!target.dead && target.invulnTimer <= 0) {
        target.flashRed(1.0);
        this._spawnDamageNumber(target.getEyePosition(this._tmpV2).add(new THREE.Vector3(0, 0.18, 0)), dmg);
        this._spawnBloodParticles(hit.point, 14);
      }
      const died = target.takeDamage(dmg);
      this.audio.playOneShot(assetUrl('assets/audio/sfx/glass_break.ogg'), { volume: 0.75, fallback: 'glass' });
      this._breakBottle(shooterId);
      this.weaponViews[shooterId].triggerKnifeHitSwing();
      if (died) this._onKill(shooterId, targetId);
    } else {
      this.weaponViews[shooterId].triggerKnifeWhiffSwing();
    }
    w.consumeShot();
  }

  _shootHitscan(shooterId, targetId) {
    const shooter = this.players[shooterId];
    const target = this.players[targetId];
    const w = this.weapons[shooterId];
    if (!w.canShoot()) {
      // Auto-reload hint: if empty and have reserve, start reload.
      if (w.mag === 0) w.startReload();
      return;
    }

    // Raycast: nearest intersection among world blockers and the target hitbox.
    const origin = shooter.getEyePosition(this._tmpV);
    const dir = shooter.getAimDir(this._tmpV2);

    this._raycaster.set(origin, dir);
    this._raycaster.far = 120;

    const rayTargets = [...this.world.raycastMeshes];
    if (!target.dead) rayTargets.unshift(target.hitbox);
    const hits = this._raycaster.intersectObjects(rayTargets, true);
    const hit = hits[0];
    const end = this._tmpHitEnd;
    if (hit) end.copy(hit.point);
    else end.copy(origin).addScaledVector(dir, 120);

    // Visual: muzzle flash + tracer
    this.weaponViews[shooterId].triggerShot({ weaponType: w.type });
    this.weaponViews[shooterId].showTracer({ weaponType: w.type, origin, end });

    if (hit?.object?.userData?.isBarrel) {
      const pos = this.world.explodeBarrel(hit.object.userData.barrelId);
      if (pos) this.audio.playOneShot(assetUrl('assets/audio/sfx/explosion.ogg'), { volume: 0.8, fallback: 'explosion' });
    } else if (hit && hit.object === target.hitbox) {
      const dmg = damageForWeapon(w.type);
      if (!target.dead && target.invulnTimer <= 0) {
        target.flashRed(1.0);
        this._spawnDamageNumber(target.getEyePosition(this._tmpV2).add(new THREE.Vector3(0, 0.18, 0)), dmg);
        this._spawnBloodParticles(hit.point, w.type === WeaponType.SNIPER ? 16 : 10);
      }
      const died = target.takeDamage(dmg);
      if (died) this._onKill(shooterId, targetId);
    }

    w.consumeShot();

    // SFX.
    if (w.type === WeaponType.PISTOL) this.audio.playOneShot(assetUrl('assets/audio/sfx/pistol.ogg'), { volume: 0.6, fallback: 'pistol' });
    if (w.type === WeaponType.VANDAL) this.audio.playOneShot(assetUrl('assets/audio/sfx/vandal.ogg'), { volume: 0.55, fallback: 'vandal' });
    if (w.type === WeaponType.SNIPER) this.audio.playOneShot(assetUrl('assets/audio/sfx/sniper.ogg'), { volume: 0.7, fallback: 'sniper' });
  }

  _knifeAttack(shooterId, targetId) {
    const shooter = this.players[shooterId];
    const target = this.players[targetId];
    const w = this.weapons[shooterId];
    if (!w.canShoot()) return;

    const origin = shooter.getEyePosition(this._tmpV);
    const dir = shooter.getAimDir(this._tmpV2);

    this._raycaster.set(origin, dir);
    this._raycaster.far = 2.0;
    const rayTargets = [...this.world.raycastMeshes];
    if (!target.dead) rayTargets.unshift(target.hitbox);
    const hits = this._raycaster.intersectObjects(rayTargets, true);
    const hit = hits[0];
    if (hit?.object?.userData?.isBarrel) {
      this.weaponViews[shooterId].triggerKnifeHitSwing();
      const pos = this.world.explodeBarrel(hit.object.userData.barrelId);
      if (pos) this.audio.playOneShot(assetUrl('assets/audio/sfx/explosion.ogg'), { volume: 0.8, fallback: 'explosion' });
      this.audio.playOneShot(assetUrl('assets/audio/sfx/knife.ogg'), { volume: 0.6, fallback: 'pistol' });
    } else if (hit && hit.object === target.hitbox) {
      this.weaponViews[shooterId].triggerKnifeHitSwing();
      const dmg = damageForWeapon(WeaponType.KNIFE);
      if (!target.dead && target.invulnTimer <= 0) {
        target.flashRed(1.0);
        this._spawnDamageNumber(target.getEyePosition(this._tmpV2).add(new THREE.Vector3(0, 0.18, 0)), dmg);
        this._spawnBloodParticles(hit.point, 12);
      }
      const died = target.takeDamage(dmg);
      if (died) this._onKill(shooterId, targetId);
      this.audio.playOneShot(assetUrl('assets/audio/sfx/knife.ogg'), { volume: 0.6, fallback: 'pistol' });
    } else {
      this.weaponViews[shooterId].triggerKnifeWhiffSwing();
      this.audio.playOneShot(assetUrl('assets/audio/sfx/knife.ogg'), { volume: 0.35, fallback: 'step' });
    }
    w.consumeShot();
  }

  _onKill(killerId, victimId) {
    // Death SFX (everyone hears).
    this.audio.playOneShot(assetUrl('assets/audio/sfx/death.ogg'), { volume: 0.7, fallback: 'death' });
    // Spawn a temporary corpse (ragdoll-ish) at the death position.
    this._spawnCorpseFromPlayer(victimId);
    // UI: skull pop for the killer.
    this._showKillPop(killerId);
    // UI: global skull at bottom (always visible).
    this._showGlobalKillPop();

    // First kill callout (once per round).
    if (!this._firstKillDone) {
      this._firstKillDone = true;
      const line = 'aaa bu ilk killin baya iyi görünüyor';
      this._showToast(line);
      this.audio.speak(line, { lang: 'tr-TR', rate: 1.02, pitch: 1.0, volume: 1.0 });
    }
    this.scores[killerId] += 1;
    if (this.scores[killerId] >= WIN_KILLS) {
      this._enterWin(killerId);
    }
  }

  _enterWin(winnerId) {
    document.exitPointerLock?.();
    this.state = 'WIN';
    this._ui.winTitle.textContent = winnerId === 'p1' ? 'P1 WINS' : 'P2 WINS';
    this._ui.win.classList.remove('hidden');
    this._ui.centerMsg.classList.add('hidden');
    this.taskSystem.close('p1');
    this.taskSystem.close('p2');
    this.players.p1.controlsLocked = false;
    this.players.p2.controlsLocked = false;

    // Talk + ask for rating.
    const line = 'ohaaa kazanmışsın inanılmazzzz altaki yıldızdan bizi deyerlendirin lütfen oynadığınız için teşekkürler.';
    this._ui.winSub.textContent = line;
    this.audio.speak(line, { lang: 'tr-TR', rate: 1.0, pitch: 1.0, volume: 1.0 });
    if (this._ui._rating === 5) this._unlockBadge('star');
  }

  _applySniperZoom(playerId) {
    const p = this.players[playerId];
    const w = this.weapons[playerId];
    const base = 75;
    if (w.type !== WeaponType.SNIPER) {
      if (p.camera.fov !== base) {
        p.camera.fov = base;
        p.camera.updateProjectionMatrix();
      }
      return;
    }
    const zoomFov = 30;
    const fov = base + (zoomFov - base) * w.sniperZoom01;
    p.camera.fov = fov;
    p.camera.updateProjectionMatrix();
  }

  _updateScoreboard() {
    this._ui.scoreboard.textContent = `P1: ${this.scores.p1} | P2: ${this.scores.p2}`;
  }

  _updateHUD() {
    const p1 = this.players.p1;
    const p2 = this.players.p2;
    const w1 = this.weapons.p1;
    const w2 = this.weapons.p2;

    // HP bars.
    this._ui.p1.hp.style.width = `${(p1.hp / p1.maxHp) * 100}%`;
    this._ui.p2.hp.style.width = `${(p2.hp / p2.maxHp) * 100}%`;

    // Death effect (blackout) on the player's half.
    this._ui.p1.hud.classList.toggle('dead', p1.dead && p1.deathTimer > 0);
    this._ui.p2.hud.classList.toggle('dead', p2.dead && p2.deathTimer > 0);

    // Invulnerability HUD.
    this._ui.p1.invuln.textContent = p1.invulnTimer > 0 ? `INVULN ${Math.ceil(p1.invulnTimer)}…` : '';
    this._ui.p2.invuln.textContent = p2.invulnTimer > 0 ? `INVULN ${Math.ceil(p2.invulnTimer)}…` : '';

    // Weapon HUD.
    this._ui.p1.weapon.textContent = this._weaponHudText('p1', w1);
    this._ui.p2.weapon.textContent = this._weaponHudText('p2', w2);

    // Sniper scope overlay (per-player half only).
    const scope1 = w1.type === WeaponType.SNIPER && (w1.sniperAiming || w1.sniperZoom01 > 0.65);
    const scope2 = w2.type === WeaponType.SNIPER && (w2.sniperAiming || w2.sniperZoom01 > 0.65);
    this._ui.p1.scope?.classList.toggle('hidden', !scope1);
    this._ui.p2.scope?.classList.toggle('hidden', !scope2);

    // Prompts (only when not in task UI).
    this._ui.p1.prompt.textContent = '';
    this._ui.p2.prompt.textContent = '';
    if ((this.state === 'ELEVATOR' || this.state === 'PLAY') && !this._ui.win.classList.contains('hidden')) {
      // winner screen showing; suppress prompts
      return;
    }

    if (this.state === 'ELEVATOR' || this.state === 'PLAY') {
      if (!this.taskSystem.isOpen('p1') && !p1.dead) {
        const a = this._nearestArcade(p1);
        if (a) {
          const locked = a.taskIndex !== p1.taskLevel;
          const label = locked ? 'LOCKED' : 'Use Arcade';
          const next = p1.taskLevel + 1;
          this._ui.p1.prompt.textContent = `E - ${label} (Task ${next})`;
        }
      }
      if (!this.taskSystem.isOpen('p2') && !p2.dead) {
        const a = this._nearestArcade(p2);
        if (a) {
          const locked = a.taskIndex !== p2.taskLevel;
          const label = locked ? 'LOCKED' : 'Use Arcade';
          const next = p2.taskLevel + 1;
          this._ui.p2.prompt.textContent = `Right Click - ${label} (Task ${next})`;
        }
      }
    }
  }

  _updateRadar() {
    // Simple top-down radar per player.
    const roomW = this.world.roomW;
    const roomD = this.world.roomD;
    // User request: radar shows ONLY self (no enemies, no tasks).

    const draw = (id, canvas, ctx) => {
      if (!canvas || !ctx) return;
      const self = this.players[id];

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, w, h);

      const pad = 10;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

      const toRadar = (pos) => {
        const nx = (pos.x / (roomW / 2)) * 0.5 + 0.5;
        const nz = (pos.z / (roomD / 2)) * 0.5 + 0.5;
        const x = pad + nx * (w - pad * 2);
        const y = pad + (1 - nz) * (h - pad * 2); // flip Z to screen Y
        return { x, y };
      };

      // Self arrow (shows facing direction).
      const p = toRadar(self.pos);
      const yaw = self.yaw;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const ang = Math.atan2(-dz, dx);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, 6);
      ctx.lineTo(-6, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    draw('p1', this._ui.p1.radar, this._ui.p1.radarCtx);
    draw('p2', this._ui.p2.radar, this._ui.p2.radarCtx);
  }

  _weaponHudText(playerId, w) {
    if (w.type === WeaponType.KNIFE) return `Knife`;
    const ammo = `${w.mag}/${w.reserve}`;
    const re = w.reloadTimer > 0 ? ` RELOADING…` : '';
    if (w.type === WeaponType.SNIPER) {
      const mode = w.sniperAiming ? ' (ZOOM)' : '';
      return `${w.type}${mode} ${ammo}${re}`;
    }
    return `${w.type} ${ammo}${re}`;
  }

  _render() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;

    // Ensure renderer is sized (ResizeObserver can lag 1 frame).
    this.renderer.setSize(w, h, false);

    const halfW = Math.floor(w / 2);

    // Left viewport (P1)
    this._renderViewport(0, 0, halfW, h, this.players.p1.camera);
    // Right viewport (P2)
    this._renderViewport(halfW, 0, w - halfW, h, this.players.p2.camera);
  }

  _renderViewport(x, y, w, h, camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    this.renderer.setViewport(x, y, w, h);
    this.renderer.setScissor(x, y, w, h);
    this.renderer.render(this.world.scene, camera);
  }
}

