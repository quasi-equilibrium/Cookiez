import * as THREE from 'three';
import { WeaponType } from './Weapons.js';
import { randRange } from './math.js';

// MENU-only background: simple dummy bots shooting (visual only).
// Not connected to gameplay. No collisions/raycast/hitboxes.
export class DemoBots {
  constructor({ scene, roomW, roomD }) {
    this.scene = scene;
    this.roomW = roomW;
    this.roomD = roomD;

    this.group = new THREE.Group();
    this.group.name = 'menu-demo-bots';
    scene.add(this.group);

    this._raycaster = new THREE.Raycaster();
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();

    /** @type {Array<any>} */
    this.bots = [];

    // Shared tracer pool.
    this._tracers = [];
    for (let i = 0; i < 18; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      scene.add(line);
      this._tracers.push({ line, t: 0 });
    }
  }

  build() {
    // Two pairs.
    this._spawnBot({ x: -18, z: -10, color: 0x63b3ff });
    this._spawnBot({ x: -8, z: 14, color: 0x63b3ff });
    this._spawnBot({ x: 18, z: 10, color: 0xff4fd7 });
    this._spawnBot({ x: 8, z: -14, color: 0xff4fd7 });
  }

  _spawnBot({ x, z, color }) {
    const bot = makeHumanoid(color);
    bot.group.position.set(x, 0, z);
    bot.yaw = randRange(-Math.PI, Math.PI);
    bot.fireT = randRange(0.1, 0.6);
    bot.moveT = randRange(0.8, 1.6);
    bot.target = new THREE.Vector3(randRange(-25, 25), 0, randRange(-18, 18));
    bot.weapon = Math.random() < 0.5 ? WeaponType.VANDAL : WeaponType.PISTOL;
    this.group.add(bot.group);
    this.bots.push(bot);
  }

  update(dt) {
    // Move bots a bit and shoot at the opposite team.
    for (const b of this.bots) {
      b.moveT -= dt;
      if (b.moveT <= 0) {
        b.moveT = randRange(0.8, 1.8);
        b.target.set(randRange(-28, 28), 0, randRange(-20, 20));
      }
      const to = this._tmpV.copy(b.target).sub(b.group.position);
      const d = to.length();
      if (d > 0.001) {
        to.multiplyScalar(1 / d);
        const speed = 1.6;
        b.group.position.addScaledVector(to, speed * dt);
        b.yaw = Math.atan2(-to.x, -to.z);
      }
      // pose
      b.group.rotation.y = b.yaw;

      b.fireT -= dt;
      if (b.fireT <= 0) {
        b.fireT = b.weapon === WeaponType.VANDAL ? randRange(0.09, 0.16) : randRange(0.18, 0.32);
        const target = this._pickEnemy(b);
        if (target) this._shoot(b, target);
      }
    }

    // Update tracers.
    for (const t of this._tracers) {
      if (!t.line.visible) continue;
      t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / 0.08);
      if (t.t <= 0) t.line.visible = false;
    }
  }

  _pickEnemy(bot) {
    const team = bot.team;
    const enemies = this.bots.filter((b) => b.team !== team);
    if (enemies.length === 0) return null;
    // closest
    let best = enemies[0];
    let bestD2 = Infinity;
    for (const e of enemies) {
      const dx = e.group.position.x - bot.group.position.x;
      const dz = e.group.position.z - bot.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  _shoot(bot, target) {
    // Flash
    bot.flashT = 0.06;

    const origin = this._tmpV.copy(bot.group.position);
    origin.y += 1.35;
    const end = this._tmpV2.copy(target.group.position);
    end.y += 1.35;

    const tracer = this._tracers.find((t) => !t.line.visible);
    if (tracer) {
      const pos = tracer.line.geometry.attributes.position.array;
      pos[0] = origin.x;
      pos[1] = origin.y;
      pos[2] = origin.z;
      pos[3] = end.x;
      pos[4] = end.y;
      pos[5] = end.z;
      tracer.line.geometry.attributes.position.needsUpdate = true;
      tracer.line.material.color.setHex(0xffd24a);
      tracer.line.material.opacity = 0.9;
      tracer.line.visible = true;
      tracer.t = 0.06;
    }
  }

  setEnabled(v) {
    this.group.visible = v;
    for (const t of this._tracers) t.line.visible = v && t.line.visible;
  }
}

function makeHumanoid(color) {
  const group = new THREE.Group();

  const mats = {
    main: new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 0.9, metalness: 0.05 })
  };

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.22), mats.main);
  torso.position.set(0, 1.05, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mats.main);
  head.position.set(0, 1.42, 0);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), mats.dark);
  legL.position.set(-0.1, 0.45, 0);
  const legR = legL.clone();
  legR.position.x = 0.1;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.12), mats.dark);
  armL.position.set(-0.32, 1.08, 0);
  const armR = armL.clone();
  armR.position.x = 0.32;
  armR.rotation.x = -0.8; // "holding" pose

  group.add(torso, head, legL, legR, armL, armR);

  return {
    group,
    team: color === 0x63b3ff ? 0 : 1,
    yaw: 0,
    fireT: 0,
    moveT: 0,
    target: new THREE.Vector3(),
    weapon: WeaponType.VANDAL,
    flashT: 0
  };
}

