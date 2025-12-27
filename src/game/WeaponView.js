import * as THREE from 'three';
import { WeaponType } from './Weapons.js';
import { clamp } from './math.js';

// First-person weapon placeholders + simple FX (muzzle flash + tracer + knife swing).
// No external assets required.
export class WeaponView {
  constructor({ id, scene, camera }) {
    this.id = id;
    this.scene = scene;
    this.camera = camera;

    // Weapon model is attached to the camera so it stays in view.
    this.root = new THREE.Group();
    this.root.name = `${id}-weaponRoot`;
    this.root.position.set(0.32, -0.28, -0.58);
    this.root.rotation.set(0, 0, 0);
    // User request: bigger guns.
    this.root.scale.setScalar(1.35);

    // Build weapon meshes.
    this.models = {
      [WeaponType.KNIFE]: buildKnife(),
      [WeaponType.PISTOL]: buildPistol(),
      [WeaponType.VANDAL]: buildVandal(),
      [WeaponType.SNIPER]: buildSniper(),
      [WeaponType.BOTTLE]: buildBottle(),
      [WeaponType.SHOTGUN]: buildShotgun(),
      [WeaponType.LASER]: buildLaser()
    };
    for (const m of Object.values(this.models)) {
      m.visible = false;
      this.root.add(m);
    }

    // Muzzle flash: a small additive quad at the weapon muzzle.
    const flashGeo = new THREE.PlaneGeometry(0.22, 0.22);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlash.visible = false;
    this.root.add(this.muzzleFlash);
    this._flashT = 0;

    // World-space tracer line (hitscan visualization).
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const tracerMat = new THREE.LineBasicMaterial({
      color: 0xffd24a,
      transparent: true,
      opacity: 0.9
    });
    this.tracer = new THREE.Line(tracerGeo, tracerMat);
    this.tracer.frustumCulled = false;
    this.tracer.visible = false;
    scene.add(this.tracer);
    this._tracerT = 0;

    // Knife swing animation (only obvious on hit).
    this._knifeSwing = 0; // 0..1
    this._knifeSwingVel = 0;

    // Knife trail (exaggerated slash effect).
    const trailGeo = new THREE.PlaneGeometry(0.5, 0.22);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.knifeTrail = new THREE.Mesh(trailGeo, trailMat);
    this.knifeTrail.visible = false;
    this.root.add(this.knifeTrail);

    // Vandal color cycling.
    this._t = 0;
    this._vandalPalette = [0x6f7a8a, 0xdfe7f2, 0x63b3ff, 0x37e6a1];
  }

  attach() {
    // Camera must be in the scene graph for children to render.
    this.camera.add(this.root);
  }

  setWeapon(type) {
    for (const [k, m] of Object.entries(this.models)) m.visible = k === type;
  }

  triggerShot({ weaponType }) {
    // Place muzzle flash near the muzzle per weapon.
    const muzzle = this._getMuzzleLocal(weaponType);
    this.muzzleFlash.position.copy(muzzle);
    this.muzzleFlash.rotation.set(0, 0, 0);
    this.muzzleFlash.visible = true;
    this._flashT = weaponType === WeaponType.SNIPER ? 0.07 : 0.05;

    // Color per weapon.
    if (weaponType === WeaponType.SNIPER) {
      this.muzzleFlash.material.color.setHex(0xaad8ff); // blue-white
      this.muzzleFlash.material.opacity = 0.95;
    } else {
      this.muzzleFlash.material.color.setHex(0xffb13b); // yellow-orange
      this.muzzleFlash.material.opacity = 0.9;
    }
  }

  showTracer({ weaponType, origin, end }) {
    const pos = this.tracer.geometry.attributes.position.array;
    pos[0] = origin.x;
    pos[1] = origin.y;
    pos[2] = origin.z;
    pos[3] = end.x;
    pos[4] = end.y;
    pos[5] = end.z;
    this.tracer.geometry.attributes.position.needsUpdate = true;

    // Color per weapon.
    if (weaponType === WeaponType.SNIPER) this.tracer.material.color.setHex(0xff3333); // red
    else this.tracer.material.color.setHex(0xffd24a); // yellow

    this.tracer.material.opacity = 0.95;
    this.tracer.visible = true;
    this._tracerT = weaponType === WeaponType.SNIPER ? 0.08 : 0.06;
  }

  triggerKnifeHitSwing() {
    this._knifeSwingVel = Math.max(this._knifeSwingVel, 10.0);
    this._knifeSwing = Math.max(this._knifeSwing, 0.35);
  }

  triggerKnifeWhiffSwing() {
    this._knifeSwingVel = Math.max(this._knifeSwingVel, 7.0);
    this._knifeSwing = Math.max(this._knifeSwing, 0.2);
  }

  update(dt, { weaponType, sniperZoom01 }) {
    this._t += dt;

    // Small idle sway.
    const sway = 0.02;
    this.root.position.x = 0.32 + Math.sin(this._t * 2.2) * sway;
    this.root.position.y = -0.28 + Math.sin(this._t * 1.8 + 1.2) * sway * 0.6;

    // Sniper zoom pulls the weapon inwards (feel like “tightens”).
    const zoom = weaponType === WeaponType.SNIPER ? sniperZoom01 : 0;
    this.root.position.z = -0.58 + zoom * 0.18;
    this.root.position.x = 0.32 - zoom * 0.08;
    this.root.position.y = -0.28 - zoom * 0.06;

    // Muzzle flash decay.
    if (this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - dt);
      const a = this._flashT / 0.07;
      this.muzzleFlash.material.opacity = clamp(a, 0, 1);
      // Random rotation for “sparks”.
      this.muzzleFlash.rotation.z += dt * 18;
      if (this._flashT === 0) this.muzzleFlash.visible = false;
    }

    // Tracer decay.
    if (this._tracerT > 0) {
      this._tracerT = Math.max(0, this._tracerT - dt);
      this.tracer.material.opacity = clamp(this._tracerT / 0.08, 0, 1);
      if (this._tracerT === 0) this.tracer.visible = false;
    }

    // Knife swing (only affects knife model).
    if (weaponType === WeaponType.KNIFE) {
      const k = this.models[WeaponType.KNIFE];
      this._knifeSwing = Math.max(0, this._knifeSwing - dt * 2.6);
      const s = this._knifeSwing;
      // Exaggerated right->left slash (screen space): move X and rotate Y/Z.
      k.rotation.x = -0.15 - s * 0.9;
      k.rotation.y = -0.3 + s * 1.2;
      k.rotation.z = 0.8 - s * 2.1;
      k.position.x = 0.18 - s * 0.38;
      k.position.z = -0.18 - s * 0.18;
      k.position.y = -0.02 - s * 0.10;

      // Trail visible during swing.
      this.knifeTrail.visible = s > 0.02;
      if (this.knifeTrail.visible) {
        this.knifeTrail.position.set(0.16 - s * 0.25, 0.06, -0.32);
        this.knifeTrail.rotation.set(0, 0, -0.6);
        this.knifeTrail.material.color.setHex(0xffb13b);
        this.knifeTrail.material.opacity = Math.min(0.9, s * 1.8);
      }
    } else {
      // Reset knife pose when not active.
      const k = this.models[WeaponType.KNIFE];
      k.rotation.set(0, 0, 0);
      k.position.set(0, 0, 0);
      this.knifeTrail.visible = false;
    }

    // Vandal “always changing color” (grey/white/blue/green).
    if (weaponType === WeaponType.VANDAL) {
      const m = this.models[WeaponType.VANDAL];
      const mat = /** @type {THREE.MeshStandardMaterial} */ (m.userData.mainMat);
      if (mat) {
        const t = (Math.sin(this._t * 2.2) * 0.5 + 0.5) * (this._vandalPalette.length - 1);
        const i = Math.floor(t);
        const f = t - i;
        const a = new THREE.Color(this._vandalPalette[i]);
        const b = new THREE.Color(this._vandalPalette[Math.min(i + 1, this._vandalPalette.length - 1)]);
        mat.color.copy(a.lerp(b, f));
      }
    }
  }

  _getMuzzleLocal(weaponType) {
    // Local positions for the muzzle flash relative to weapon root.
    if (weaponType === WeaponType.PISTOL) return new THREE.Vector3(0.18, 0.05, -0.24);
    if (weaponType === WeaponType.VANDAL) return new THREE.Vector3(0.38, 0.06, -0.34);
    if (weaponType === WeaponType.SNIPER) return new THREE.Vector3(0.62, 0.08, -0.42);
    if (weaponType === WeaponType.SHOTGUN) return new THREE.Vector3(0.34, 0.06, -0.3);
    if (weaponType === WeaponType.LASER) return new THREE.Vector3(0.5, 0.06, -0.38);
    return new THREE.Vector3(0.12, 0.04, -0.18);
  }
}

function buildKnife() {
  const g = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x252a33, roughness: 0.18, metalness: 0.95 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.85, metalness: 0.1 });

  // Blade: tapered "real knife" feel using a long thin box + tip cone.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.26), bladeMat);
  blade.position.set(0.14, 0.03, -0.12);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 10), bladeMat);
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0.14, 0.03, -0.28);

  // Guard + handle.
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.03), bladeMat);
  guard.position.set(0.1, 0.02, -0.02);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 10), handleMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0.06, 0.02, 0.06);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), handleMat);
  pommel.position.set(0.06, 0.02, 0.14);

  g.add(blade, tip, guard, handle, pommel);
  // Pose to lower-right.
  g.position.set(0.12, -0.03, 0);
  g.rotation.y = -0.35;
  g.rotation.x = 0.2;
  return g;
}

function buildPistol() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.16), mat);
  body.position.set(0.1, 0.07, -0.12);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 10), mat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.22, 0.08, -0.14);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.1), mat);
  grip.position.set(0.04, -0.02, -0.06);
  grip.rotation.z = -0.35;
  g.add(body, barrel, grip);

  // Small in-hand (still smaller than other guns).
  g.scale.setScalar(0.95);
  g.position.set(0.02, -0.02, 0);
  g.rotation.y = -0.25;
  return g;
}

function buildVandal() {
  const g = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({ color: 0x6f7a8a, roughness: 0.55, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.9, metalness: 0.15 });

  // Receiver + barrel (Valorant-ish silhouette).
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.18), mainMat);
  receiver.position.set(0.22, 0.08, -0.14);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.08), mainMat);
  barrel.position.set(0.52, 0.1, -0.16);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.14), darkMat);
  stock.position.set(-0.06, 0.08, -0.14);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), darkMat);
  grip.position.set(0.1, -0.02, -0.1);
  grip.rotation.z = -0.25;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.12), mainMat);
  mag.position.set(0.22, -0.04, -0.18);
  mag.rotation.z = 0.12;

  g.add(receiver, barrel, stock, grip, mag);
  g.userData.mainMat = mainMat;

  // Bigger than pistol.
  g.scale.setScalar(1.2);
  g.position.set(0.0, -0.04, 0);
  g.rotation.y = -0.18;
  return g;
}

function buildSniper() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb9ff7a, roughness: 0.45, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 0.85, metalness: 0.1 });

  // Long thin barrel + body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.14), bodyMat);
  body.position.set(0.28, 0.08, -0.14);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 12), darkMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.74, 0.09, -0.16);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 14), darkMat);
  scope.rotation.z = Math.PI / 2;
  scope.position.set(0.38, 0.16, -0.14);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.14), darkMat);
  stock.position.set(-0.05, 0.08, -0.14);

  g.add(body, barrel, scope, stock);
  g.scale.setScalar(1.22);
  g.position.set(0.0, -0.04, 0);
  g.rotation.y = -0.16;
  return g;
}

function buildBottle() {
  const g = new THREE.Group();
  // Gold-ish bottle.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffd24a,
    roughness: 0.25,
    metalness: 0.6,
    emissive: 0xffb13b,
    emissiveIntensity: 0.12
  });
  const neckMat = new THREE.MeshStandardMaterial({
    color: 0x1a1f2a,
    roughness: 0.7,
    metalness: 0.1
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.22, 14), glassMat);
  body.position.set(0.12, 0.02, -0.12);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.09, 12), glassMat);
  neck.position.set(0.12, 0.15, -0.12);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 10), neckMat);
  cap.position.set(0.12, 0.2, -0.12);

  g.add(body, neck, cap);
  g.scale.setScalar(1.25);
  g.position.set(0.08, -0.02, 0.02);
  g.rotation.y = -0.25;
  g.rotation.z = 0.35;
  return g;
}

function buildShotgun() {
  const g = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({ color: 0x6f7a8a, roughness: 0.55, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.9, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.16), mainMat);
  body.position.set(0.2, 0.08, -0.14);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 12), darkMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.5, 0.1, -0.16);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.14), darkMat);
  pump.position.set(0.38, 0.02, -0.14);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.14), darkMat);
  stock.position.set(-0.06, 0.08, -0.14);
  g.add(body, barrel, pump, stock);
  g.scale.setScalar(1.18);
  g.position.set(0.02, -0.04, 0);
  g.rotation.y = -0.2;
  return g;
}

function buildLaser() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff4fd7, roughness: 0.35, metalness: 0.35, emissive: 0xff3333, emissiveIntensity: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 0.85, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.16), bodyMat);
  body.position.set(0.22, 0.08, -0.14);
  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 14), darkMat);
  emitter.rotation.z = Math.PI / 2;
  emitter.position.set(0.54, 0.09, -0.16);
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 14), bodyMat);
  coil.rotation.z = Math.PI / 2;
  coil.position.set(0.32, 0.16, -0.14);
  g.add(body, emitter, coil);
  g.scale.setScalar(1.22);
  g.position.set(0.0, -0.04, 0);
  g.rotation.y = -0.18;
  return g;
}

