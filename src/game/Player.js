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

    // Visible body (placeholder) + invisible hitbox for raycasts.
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 6, 12), mat);
    this.body.position.set(0, PLAYER_HEIGHT / 2, 0);

    this.hitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
    );
    this.hitbox.userData.isPlayerHitbox = true;
    this.hitbox.userData.playerId = id;
    this.hitbox.position.copy(this.body.position);
  }

  addToScene(scene) {
    scene.add(this.body);
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
      this.body.material.emissive.setHex(0x4ad1ff);
      this.body.material.emissiveIntensity = e;
    } else {
      this.body.material.emissiveIntensity = 0.0;
    }

    // Update meshes & camera transforms.
    this.body.position.set(this.pos.x, this.pos.y + PLAYER_HEIGHT / 2, this.pos.z);
    this.hitbox.position.copy(this.body.position);

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

