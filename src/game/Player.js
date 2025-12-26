import * as THREE from 'three';
import { clamp, yawPitchToDir } from './math.js';

export const PLAYER_RADIUS = 0.45;
export const PLAYER_HEIGHT = 1.75;

export class Player {
  constructor({ id, color }) {
    this.id = id; // 'p1' or 'p2'

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3(0, 0, 0);

    this.yaw = 0;
    this.pitch = 0;

    this.onGround = false;
    this.controlsLocked = false; // used when task UI is open

    this.maxHp = 100;
    this.hp = 100;
    this.dead = false;
    this.deathTimer = 0;

    this.invulnTimer = 0;
    this.invulnDuration = 3.0;

    this.taskLevel = 0; // 0..3

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 180);
    this.camera.position.set(0, 1.6, 0);

    // Visible humanoid (placeholder) + invisible hitbox for raycasts.
    // User request: head/torso/legs/arms; right arm holds weapon, left arm stays idle.
    this.model = new THREE.Group();
    this.model.name = `${id}-model`;

    const mainMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.65,
      metalness: 0.12,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1a1f2a,
      roughness: 0.9,
      metalness: 0.05,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    this._emissiveMats = [mainMat, darkMat];

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.25), mainMat);
    this.torso.position.set(0, 1.05, 0);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), mainMat);
    this.head.position.set(0, 1.55, 0);
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.65, 0.16), darkMat);
    this.legL.position.set(-0.12, 0.33, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.12;

    // Arms
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), darkMat);
    this.armL.position.set(-0.38, 1.12, 0);
    this.armL.rotation.x = 0.15; // idle
    this.armR = this.armL.clone();
    this.armR.position.x = 0.38;
    this.armR.rotation.x = -0.9; // holding pose forward

    this.model.add(this.torso, this.head, this.legL, this.legR, this.armL, this.armR);

    this.hitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
    );
    this.hitbox.userData.isPlayerHitbox = true;
    this.hitbox.userData.playerId = id;
    this.hitbox.position.set(0, PLAYER_HEIGHT / 2, 0);
  }

  addToScene(scene) {
    scene.add(this.model);
    scene.add(this.hitbox);
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
  }

  setYawPitch(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -1.35, 1.35);
  }

  getEyePosition(out = new THREE.Vector3()) {
    out.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
    return out;
  }

  getAimDir(out = new THREE.Vector3()) {
    return yawPitchToDir(this.yaw, this.pitch, out);
  }

  updateVisual(dt) {
    // Blink when invulnerable.
    if (this.invulnTimer > 0) {
      const t = Math.floor((this.invulnTimer * 10) % 2);
      const e = t ? 0.9 : 0.1;
      for (const m of this._emissiveMats) {
        m.emissive.setHex(0x4ad1ff);
        m.emissiveIntensity = e;
      }
    } else {
      for (const m of this._emissiveMats) m.emissiveIntensity = 0.0;
    }

    // Update meshes & camera transforms.
    this.model.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.model.rotation.y = this.yaw;
    // Head pitch hint (small).
    this.head.rotation.x = this.pitch * 0.4;
    // Right arm "aims" a bit with pitch.
    this.armR.rotation.x = -0.9 + this.pitch * 0.5;

    this.hitbox.position.set(this.pos.x, this.pos.y + PLAYER_HEIGHT / 2, this.pos.z);

    this.camera.position.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  startInvuln() {
    this.invulnTimer = this.invulnDuration;
  }

  takeDamage(amount) {
    if (this.invulnTimer > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.dead = true;
      this.deathTimer = 0.7; // short death blackout duration
      return true;
    }
    return false;
  }

  respawnAt(pos) {
    this.dead = false;
    this.hp = this.maxHp;
    this.vel.set(0, 0, 0);
    this.pos.copy(pos);
    this.startInvuln();
  }
}

