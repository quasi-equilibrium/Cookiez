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

    // Hit feedback.
    this.damageFlashTimer = 0;

    this.taskLevel = 0; // 0..3

    // Bottle pickup (temporary melee).
    this.hasBottle = false;
    this.bottlePrevWeapon = null;

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
    // Legs: tinted (not plain dark).
    const legColor = new THREE.Color(color).multiplyScalar(0.55).lerp(new THREE.Color(0x1a1f2a), 0.25);
    const darkMat = new THREE.MeshStandardMaterial({
      color: legColor,
      roughness: 0.9,
      metalness: 0.05,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    // Arms: slightly brighter tint for contrast.
    const armColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.12);
    const armMat = new THREE.MeshStandardMaterial({
      color: armColor,
      roughness: 0.55,
      metalness: 0.12,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    this._emissiveMats = [mainMat, darkMat, armMat];
    this._baseMatColors = new Map();
    for (const m of this._emissiveMats) this._baseMatColors.set(m, m.color.clone());

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.25), mainMat);
    this.torso.name = `${id}-torso`;
    this.torso.position.set(0, 1.05, 0);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), mainMat);
    this.head.name = `${id}-head`;
    this.head.position.set(0, 1.55, 0);
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.65, 0.16), darkMat);
    this.legL.name = `${id}-legL`;
    this.legL.position.set(-0.12, 0.33, 0);
    this.legR = this.legL.clone();
    this.legR.name = `${id}-legR`;
    this.legR.position.x = 0.12;

    // Arms
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), armMat);
    this.armL.name = `${id}-armL`;
    this.armL.position.set(-0.38, 1.12, 0);
    this.armL.rotation.x = 0.15; // idle
    this.armR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), armMat);
    this.armR.name = `${id}-armR`;
    this.armR.position.x = 0.38;
    this.armR.rotation.x = -0.9; // holding pose forward

    // Funny face: eyes + mouth (cheap geometry, no textures).
    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf3f6ff,
      roughness: 0.25,
      metalness: 0.05,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    const eyePupilMat = new THREE.MeshStandardMaterial({
      color: 0x05060a,
      roughness: 0.7,
      metalness: 0.0,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    const mouthMat = new THREE.MeshStandardMaterial({
      color: 0x05060a,
      roughness: 0.8,
      metalness: 0.0,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    this._emissiveMats.push(eyeWhiteMat, eyePupilMat, mouthMat);
    this._baseMatColors.set(eyeWhiteMat, eyeWhiteMat.color.clone());
    this._baseMatColors.set(eyePupilMat, eyePupilMat.color.clone());
    this._baseMatColors.set(mouthMat, mouthMat.color.clone());

    const eyeGeo = new THREE.SphereGeometry(0.05, 10, 8);
    const pupilGeo = new THREE.SphereGeometry(0.022, 10, 8);
    const mouthGeo = new THREE.TorusGeometry(0.075, 0.016, 8, 16, Math.PI);

    this.eyeL = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    this.eyeL.name = `${id}-eyeL`;
    // Put the face on the FRONT of the head.
    // (three.js "forward" is -Z, so +Z looked like it was on the back)
    this.eyeL.position.set(-0.06, 0.03, -0.185);
    this.eyeR = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    this.eyeR.name = `${id}-eyeR`;
    this.eyeR.position.set(0.06, 0.03, -0.185);

    this.pupilL = new THREE.Mesh(pupilGeo, eyePupilMat);
    this.pupilL.name = `${id}-pupilL`;
    this.pupilL.position.set(-0.06, 0.03, -0.215);
    this.pupilR = new THREE.Mesh(pupilGeo, eyePupilMat);
    this.pupilR.name = `${id}-pupilR`;
    this.pupilR.position.set(0.06, 0.03, -0.215);

    this.mouth = new THREE.Mesh(mouthGeo, mouthMat);
    this.mouth.name = `${id}-mouth`;
    this.mouth.position.set(0, -0.07, -0.195);
    this.mouth.rotation.y = Math.PI; // face towards -Z
    this.mouth.rotation.z = Math.PI; // smile
    this.mouth.scale.set(1.0, 0.8, 1.0);

    // Put the face on the head so head pitch also moves the face.
    this.head.add(this.eyeL, this.eyeR, this.pupilL, this.pupilR, this.mouth);

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

  flashRed(duration = 1.0) {
    this.damageFlashTimer = Math.max(this.damageFlashTimer, duration);
  }

  getAimDir(out = new THREE.Vector3()) {
    return yawPitchToDir(this.yaw, this.pitch, out);
  }

  updateVisual(dt) {
    if (this.damageFlashTimer > 0) this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);

    // Blink when invulnerable.
    if (this.invulnTimer > 0) {
      const t = Math.floor((this.invulnTimer * 10) % 2);
      const e = t ? 0.9 : 0.1;
      for (const m of this._emissiveMats) {
        m.emissive.setHex(0x4ad1ff);
        m.emissiveIntensity = e;
      }
    } else {
      for (const m of this._emissiveMats) {
        m.emissiveIntensity = 0.0;
      }
    }

    // Damage flash: turn the character red briefly, then fade back.
    if (this.invulnTimer <= 0 && this.damageFlashTimer > 0) {
      const a = clamp(this.damageFlashTimer / 1.0, 0, 1);
      const red = new THREE.Color(0xff2b2b);
      for (const m of this._emissiveMats) {
        const base = this._baseMatColors.get(m);
        if (!base) continue;
        m.color.copy(base).lerp(red, a * 0.85);
      }
    } else {
      // Restore base colors (important after flash).
      for (const m of this._emissiveMats) {
        const base = this._baseMatColors.get(m);
        if (base) m.color.copy(base);
      }
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
      this.model.visible = false;
      return true;
    }
    return false;
  }

  respawnAt(pos) {
    this.dead = false;
    this.hp = this.maxHp;
    this.vel.set(0, 0, 0);
    this.pos.copy(pos);
    this.damageFlashTimer = 0;
    this.model.visible = true;
    this.hasBottle = false;
    this.bottlePrevWeapon = null;
    this.startInvuln();
  }
}

