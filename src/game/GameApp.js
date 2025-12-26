import * as THREE from 'three';
import { Input } from './Input.js';
import { AudioManager } from './AudioManager.js';
import { World } from './World.js';
import { Player, PLAYER_HEIGHT, PLAYER_RADIUS } from './Player.js';
import { WeaponState, WeaponType, damageForWeapon, weaponForTaskLevel } from './Weapons.js';
import { TaskSystem } from './TaskSystem.js';
import { clamp, dist2, randRange } from './math.js';

const WIN_KILLS = 10;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setScissorTest(true);

    this.input = new Input({ canvas: this.canvas });
    this.audio = new AudioManager();

    this.world = new World();
    this.world.build();

    this.players = {
      p1: new Player({ id: 'p1', color: 0x63b3ff }),
      p2: new Player({ id: 'p2', color: 0xff4fd7 })
    };
    this.players.p1.addToScene(this.world.scene);
    this.players.p2.addToScene(this.world.scene);

    this.weapons = {
      p1: new WeaponState(),
      p2: new WeaponState()
    };

    // Spawn/elevator state.
    this.state = 'MENU'; // MENU -> TRANSITION -> ELEVATOR -> PLAY -> WIN
    this.elevator = {
      t: 10,
      doorOpen01: 0,
      fightMsgTimer: 0,
      _lastShownInt: 10
    };

    this.scores = { p1: 0, p2: 0 };
    this._raycaster = new THREE.Raycaster();
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();

    this.config = {
      mouseFireMode: 'p2' // 'p2' | 'both'
    };

    this._ui = this._bindUI();

    this.taskSystem = new TaskSystem({
      input: this.input,
      elP1: document.getElementById('task-p1'),
      elP2: document.getElementById('task-p2'),
      onComplete: (playerId, taskIndex) => this._onTaskComplete(playerId, taskIndex),
      onClose: (playerId) => {
        // Fix: closing via UI button must also unlock the player's controls.
        this.players[playerId].controlsLocked = false;
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
      restartBtn: document.getElementById('restart-btn'),

      controlsHelp: document.getElementById('controls-help'),

      p1: {
        hud: document.getElementById('hud-p1'),
        hp: document.getElementById('p1-hp'),
        prompt: document.getElementById('p1-prompt'),
        invuln: document.getElementById('p1-invuln'),
        weapon: document.getElementById('p1-weapon')
      },
      p2: {
        hud: document.getElementById('hud-p2'),
        hp: document.getElementById('p2-hp'),
        prompt: document.getElementById('p2-prompt'),
        invuln: document.getElementById('p2-invuln'),
        weapon: document.getElementById('p2-weapon'),
        radar: document.getElementById('p2-radar')
      }
    };
    ui.p1.radar = document.getElementById('p1-radar');
    ui.p1.radarCtx = ui.p1.radar?.getContext('2d');
    ui.p2.radarCtx = ui.p2.radar?.getContext('2d');

    ui.startBtn.addEventListener('click', async () => {
      this.audio.ensure(); // user gesture unlock
      await this.audio.playOneShot(assetUrl('assets/audio/sfx/ui_click.ogg'), { volume: 0.7 });
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

    ui.restartBtn.addEventListener('click', async () => {
      await this.audio.playOneShot(assetUrl('assets/audio/sfx/ui_click.ogg'), { volume: 0.7 });
      this._toMenu();
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

  _applyMenuMode(isMenu) {
    // Keep the menu DOM alive because it owns the fade overlay.
    if (isMenu) {
      this._ui.menu.classList.remove('in-game');
    } else {
      this._ui.menu.classList.add('in-game');
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

    this._resetRound();
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
    this._ui.centerMsg.textContent = 'ELEVATOR';

    // Reset elevator timer and close doors.
    this.elevator.t = 10;
    this.elevator.doorOpen01 = 0;
    this.elevator.fightMsgTimer = 0;
    this.elevator._lastShownInt = 10;
    this.world.setElevatorDoorOpen('p1', 0);
    this.world.setElevatorDoorOpen('p2', 0);
    this.world.setElevatorCabinAlpha('p1', 1);
    this.world.setElevatorCabinAlpha('p2', 1);
    this.world.setElevatorDisplay('p1', '10');
    this.world.setElevatorDisplay('p2', '10');

    // Spawn both players inside their elevators.
    this._spawnInElevator();

    // Start ambient (optional; no crash if missing).
    this.audio.playAmbientLoop(assetUrl('assets/audio/music/arcade_ambient.ogg'), { volume: 0.35 });
  }

  _resetRound() {
    this.scores.p1 = 0;
    this.scores.p2 = 0;

    // Task progression persists for the whole round (otherwise tasks feel pointless).
    // If you want "every respawn resets to knife", reset taskLevel on respawn instead.
    this.players.p1.taskLevel = 0;
    this.players.p2.taskLevel = 0;

    this.weapons.p1.setWeapon(weaponForTaskLevel(this.players.p1.taskLevel));
    this.weapons.p2.setWeapon(weaponForTaskLevel(this.players.p2.taskLevel));

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
      }
    }

    // Elevator phase countdown.
    if (this.state === 'ELEVATOR') {
      this.elevator.t = Math.max(0, this.elevator.t - dt);
      const shown = Math.ceil(this.elevator.t);
      if (shown !== this.elevator._lastShownInt) {
        this.elevator._lastShownInt = shown;
        this.world.setElevatorDisplay('p1', String(shown));
        this.world.setElevatorDisplay('p2', String(shown));
      }

      // Door stays closed until 0.
      if (this.elevator.t <= 0) {
        // Animate door open.
        this.elevator.doorOpen01 = Math.min(1, this.elevator.doorOpen01 + dt * 1.2);
        this.world.setElevatorDoorOpen('p1', this.elevator.doorOpen01);
        this.world.setElevatorDoorOpen('p2', this.elevator.doorOpen01);
        // Fade away the white cabin as doors open so the arena becomes visible.
        const alpha = clamp(1 - this.elevator.doorOpen01 * 1.15, 0, 1);
        this.world.setElevatorCabinAlpha('p1', alpha);
        this.world.setElevatorCabinAlpha('p2', alpha);

        if (this.elevator.fightMsgTimer <= 0) {
          this._ui.centerMsg.textContent = 'FIGHT';
          this.elevator.fightMsgTimer = 1.6;
        }
        this.elevator.fightMsgTimer = Math.max(0, this.elevator.fightMsgTimer - dt);
        if (this.elevator.doorOpen01 >= 1 && this.elevator.fightMsgTimer <= 0) {
          this._ui.centerMsg.classList.add('hidden');
          this.state = 'PLAY';
        }
      }
    }

    // Gameplay updates.
    if (this.state === 'ELEVATOR' || this.state === 'PLAY') {
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
  }

  _handleTaskToggles() {
    const p1 = this.players.p1;
    const p2 = this.players.p2;
    const near1 = this._nearestArcade(p1);
    const near2 = this._nearestArcade(p2);

    // P1 toggle: E
    if (this.input.wasPressed('KeyE')) {
      if (this.taskSystem.isOpen('p1')) {
        this.taskSystem.close('p1');
        p1.controlsLocked = false;
      } else if (near1) {
        this._tryOpenTask('p1', near1.taskIndex);
      }
    }

    // P2 toggle: Right click
    if (this.input.mouse.rightPressed) {
      if (this.taskSystem.isOpen('p2')) {
        this.taskSystem.close('p2');
        p2.controlsLocked = false;
      } else if (near2) {
        this._tryOpenTask('p2', near2.taskIndex);
      }
    }
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
  }

  _onTaskComplete(playerId, taskIndex) {
    const p = this.players[playerId];
    if (taskIndex !== p.taskLevel) return;
    p.taskLevel = clamp(p.taskLevel + 1, 0, 3);
    this.weapons[playerId].setWeapon(weaponForTaskLevel(p.taskLevel));
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

    // Combat.
    this._handleReloads();
    this._handleFiring(dt);

    // Visual updates (mesh/camera).
    p1.updateVisual(dt);
    p2.updateVisual(dt);

    // Sniper camera FOV zoom blending.
    this._applySniperZoom('p1');
    this._applySniperZoom('p2');
  }

  _maybeRespawn(deadId, enemyId) {
    const p = this.players[deadId];
    if (!p.dead) return;
    if (p.deathTimer > 0) return;

    const spawn = this._pickSpawnFarFromEnemy(this.players[enemyId]);
    p.respawnAt(spawn);
    p.setYawPitch(randRange(-Math.PI, Math.PI), 0);

    // Re-equip based on tasks completed.
    this.weapons[deadId].setWeapon(weaponForTaskLevel(p.taskLevel));
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
    if (this.input.isDown('KeyQ')) p.yaw -= yawSpeed * dt;
    if (this.input.isDown('KeyH')) p.yaw += yawSpeed * dt;
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
      if (ok) this.audio.playOneShot('/assets/audio/sfx/reload.ogg', { volume: 0.7 });
    }
    // P2 reload: Middle click
    if (this.input.mouse.middlePressed && !this.players.p2.controlsLocked && !this.players.p2.dead) {
      const ok = this.weapons.p2.startReload();
      if (ok) this.audio.playOneShot('/assets/audio/sfx/reload.ogg', { volume: 0.7 });
    }
  }

  _handleFiring(dt) {
    // Fire input sources:
    // - P2: Mouse Left
    // - P1: ShiftLeft (always) + optional Mouse Left when mouseFireMode === 'both'
    const p1FirePressed = this.input.wasPressed('ShiftLeft') || (this.config.mouseFireMode === 'both' && this.input.mouse.leftPressed);
    const p1FireReleased = this.input.wasReleased('ShiftLeft') || (this.config.mouseFireMode === 'both' && this.input.mouse.leftReleased);

    const p2FirePressed = this.input.mouse.leftPressed;
    const p2FireReleased = this.input.mouse.leftReleased;

    this._processFire('p1', 'p2', p1FirePressed, p1FireReleased);
    if (this.config.mouseFireMode === 'p2') {
      this._processFire('p2', 'p1', p2FirePressed, p2FireReleased);
    } else {
      // In "both", P2 still fires from mouse, but P1 already consumed mouse for its own handling too.
      this._processFire('p2', 'p1', p2FirePressed, p2FireReleased);
    }
  }

  _processFire(shooterId, targetId, pressed, released) {
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

    // Other weapons: fire on press.
    if (!pressed) return;
    if (w.type === WeaponType.KNIFE) {
      this._knifeAttack(shooterId, targetId);
    } else {
      this._shootHitscan(shooterId, targetId);
    }
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

    const hits = this._raycaster.intersectObjects([target.hitbox, ...this.world.raycastMeshes], true);
    const hit = hits[0];
    if (hit && hit.object === target.hitbox) {
      const dmg = damageForWeapon(w.type);
      const died = target.takeDamage(dmg);
      if (died) this._onKill(shooterId, targetId);
    }

    w.consumeShot();

    // SFX.
    if (w.type === WeaponType.PISTOL) this.audio.playOneShot(assetUrl('assets/audio/sfx/pistol.ogg'), { volume: 0.6 });
    if (w.type === WeaponType.VANDAL) this.audio.playOneShot(assetUrl('assets/audio/sfx/vandal.ogg'), { volume: 0.55 });
    if (w.type === WeaponType.SNIPER) this.audio.playOneShot(assetUrl('assets/audio/sfx/sniper.ogg'), { volume: 0.7 });
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
    const hits = this._raycaster.intersectObject(target.hitbox, false);
    if (hits.length) {
      const died = target.takeDamage(damageForWeapon(WeaponType.KNIFE));
      if (died) this._onKill(shooterId, targetId);
      this.audio.playOneShot(assetUrl('assets/audio/sfx/knife.ogg'), { volume: 0.6 });
    } else {
      this.audio.playOneShot(assetUrl('assets/audio/sfx/knife.ogg'), { volume: 0.35 });
    }
    w.consumeShot();
  }

  _onKill(killerId, victimId) {
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
    const arcades = this.world.arcades;

    const draw = (id, canvas, ctx) => {
      if (!canvas || !ctx) return;
      const self = this.players[id];
      const other = this.players[id === 'p1' ? 'p2' : 'p1'];

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

      // Task locations as '?'.
      ctx.font = '900 16px ui-sans-serif, system-ui, Segoe UI, Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const a of arcades) {
        const p = toRadar(a.position);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('?', p.x, p.y);
      }

      // Other player dot.
      {
        const p = toRadar(other.pos);
        ctx.fillStyle = id === 'p1' ? '#ff4fd7' : '#63b3ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Self arrow (shows facing direction).
      {
        const p = toRadar(self.pos);
        const yaw = self.yaw;
        const dx = -Math.sin(yaw);
        const dz = -Math.cos(yaw);
        const ang = Math.atan2(-dz, dx); // map world forward to screen orientation

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.fillStyle = id === 'p1' ? '#63b3ff' : '#ff4fd7';
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, 5);
        ctx.lineTo(-6, -5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
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

