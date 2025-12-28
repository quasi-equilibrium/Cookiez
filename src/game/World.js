import * as THREE from 'three';
import { randRange } from './math.js';

// Placeholder world: one big arcade hall + simple props + colliders.
// TODO: replace placeholder assets with real glb/models/textures.
export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060a');

    // Bigger arena (user request: "ciddi haritayı bayağı büyüt").
    this.roomW = 170;
    this.roomD = 90;

    /** @type {Array<{box:THREE.Box3, tag:string}>} */
    this.colliders = [];
    /** @type {Array<import('three').Object3D>} */
    this.raycastMeshes = [];

    /** @type {Array<THREE.Vector3>} */
    this.spawnPoints = [];

    /** @type {Array<{id:number, taskIndex:number, position:THREE.Vector3}>} */
    this.arcades = [];

    /** @type {Array<{id:number, mesh:THREE.Mesh, collider:any, exploded:boolean}>} */
    this.barrels = [];

    /** @type {Array<{id:number, mesh:THREE.Mesh, position:THREE.Vector3, picked:boolean}>} */
    this.bottles = [];

    /** @type {Array<{id:number, mesh:THREE.Object3D, state:'falling'|'ready'|'opened', vel:THREE.Vector3}>} */
    this.gifts = [];

    /** @type {Array<{id:number, mesh:THREE.Mesh, light:THREE.Light|null, box:THREE.Box3, t:number}>} */
    this.fireBlocks = [];

    /** @type {Array<{mesh:THREE.Mesh, t:number, maxT:number}>} */
    this.fx = [];

    /** @type {Array<{mesh:THREE.Mesh, vel:THREE.Vector3, state:'falling'|'armed', fuse:number}>} */
    this.bombs = [];

    /** @type {Array<THREE.Object3D>} */
    this._themeTargets = [];
    this._themeMode = 'default';

    // Performance caps (bomber can create lots of objects).
    this._maxFireBlocks = 36;
    this._maxBombs = 8;

    // Volcano lava visuals (no gameplay damage).
    /** @type {Array<THREE.Mesh>} */
    this.lavaPools = [];
    this._lavaOn = false;
    this._lavaT = 0;

    // Hack bits visuals (floating 10111000).
    /** @type {Array<THREE.Sprite>} */
    this.hackBits = [];
    this._hackOn = false;

    this.elevators = {
      // Anchors will be recomputed from room size in build().
      p1: { doorCollider: null, doorMesh: null, display: null, cabin: null, anchor: new THREE.Vector3(-34, 0, 0) },
      p2: { doorCollider: null, doorMesh: null, display: null, cabin: null, anchor: new THREE.Vector3(34, 0, 0) }
    };

    this._displayCanvas = {
      p1: document.createElement('canvas'),
      p2: document.createElement('canvas')
    };
    this._displayCtx = {
      p1: this._displayCanvas.p1.getContext('2d'),
      p2: this._displayCanvas.p2.getContext('2d')
    };

    // Lights (stored so WeatherSystem can tint them).
    this.lights = { ambient: null, hemi: null, key: null };
  }

  _registerThemeMesh(obj) {
    // Clone materials so we can tint safely.
    obj.traverse?.((o) => {
      if (!o.isMesh) return;
      const mesh = /** @type {THREE.Mesh} */ (o);
      if (mesh.material && !Array.isArray(mesh.material)) {
        mesh.material = mesh.material.clone();
        const m = /** @type {THREE.MeshStandardMaterial} */ (mesh.material);
        m.userData._base = {
          color: m.color?.clone?.(),
          emissive: m.emissive?.clone?.(),
          emissiveIntensity: m.emissiveIntensity ?? 0,
          metalness: m.metalness ?? 0,
          roughness: m.roughness ?? 1
        };
      }
      this._themeTargets.push(mesh);
    });
  }

  applyTheme(mode) {
    if (!mode) return;
    if (mode === this._themeMode) return;
    this._themeMode = mode;

    for (const o of this._themeTargets) {
      if (!o.isMesh) continue;
      const m = o.material;
      if (!m || Array.isArray(m)) continue;
      const base = m.userData?._base;
      if (!base) continue;
      if (mode === 'gold') {
        m.color?.setHex?.(0xffd24a);
        if (m.emissive) m.emissive.setHex(0xffb13b);
        m.emissiveIntensity = 0.45;
        m.metalness = 0.65;
        m.roughness = 0.25;
      } else if (mode === 'snow') {
        m.color?.setHex?.(0xeaf2ff);
        if (m.emissive) m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.08;
        m.metalness = 0.05;
        m.roughness = 0.95;
      } else {
        if (base.color) m.color.copy(base.color);
        if (base.emissive && m.emissive) m.emissive.copy(base.emissive);
        m.emissiveIntensity = base.emissiveIntensity ?? 0;
        m.metalness = base.metalness ?? m.metalness;
        m.roughness = base.roughness ?? m.roughness;
      }
    }
  }

  build() {
    const scene = this.scene;

    // Lighting: general + neon-ish accents.
    this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(this.lights.ambient);
    this.lights.hemi = new THREE.HemisphereLight(0x9ecbff, 0x2a1b12, 0.45);
    scene.add(this.lights.hemi);
    this.lights.key = new THREE.DirectionalLight(0xffffff, 0.65);
    const key = this.lights.key;
    key.position.set(15, 22, 8);
    key.castShadow = false;
    scene.add(key);

    // Room dimensions.
    const roomW = this.roomW; // X
    const roomD = this.roomD; // Z
    const wallH = 8;

    // Move elevators to opposite ends of the (bigger) room.
    this.elevators.p1.anchor.set(-roomW / 2 + 12, 0, 0);
    this.elevators.p2.anchor.set(roomW / 2 - 12, 0, 0);

    // Floor.
    const floorGeo = new THREE.PlaneGeometry(roomW, roomD, 1, 1);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      roughness: 0.95,
      metalness: 0.05
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = false;
    scene.add(floor);
    this._registerThemeMesh(floor);

    // Walls (4 thin boxes) + colliders.
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x141b2b,
      roughness: 0.9,
      metalness: 0.05
    });
    const thickness = 1.0;
    const mkWall = (w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      this._addColliderFromMesh(mesh, 'wall');
      this._registerThemeMesh(mesh);
      return mesh;
    };
    // Z walls
    mkWall(roomW + thickness, wallH, thickness, 0, wallH / 2, roomD / 2);
    mkWall(roomW + thickness, wallH, thickness, 0, wallH / 2, -roomD / 2);
    // X walls
    mkWall(thickness, wallH, roomD + thickness, roomW / 2, wallH / 2, 0);
    mkWall(thickness, wallH, roomD + thickness, -roomW / 2, wallH / 2, 0);

    // Neon signs (simple emissive planes).
    const neonMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f1a,
      emissive: 0x34a2ff,
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metalness: 0.1
    });
    const neon1 = new THREE.Mesh(new THREE.PlaneGeometry(10, 2), neonMat);
    neon1.position.set(0, 6, -roomD / 2 + 0.55);
    scene.add(neon1);
    const neon2 = neon1.clone();
    neon2.material = neonMat.clone();
    neon2.material.emissive = new THREE.Color(0xff4fd7);
    neon2.position.set(0, 6, roomD / 2 - 0.55);
    neon2.rotateY(Math.PI);
    scene.add(neon2);

    // Props & arcade machines.
    this._addArcadesAndProps(roomW, roomD);
    this._addElevators();
    this._buildSpawnPoints(roomW, roomD);
    this._addLavaPools(roomW, roomD);
    this._ensureHackBits();
    this._addBottles(roomW, roomD, 14);
  }

  spawnGift(x, z) {
    // Allow up to 2 gifts alive at once.
    const alive = this.gifts.filter((g) => g.state !== 'opened').length;
    if (alive >= 2) return;

    const baseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.1 });
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: 0xff3333,
      roughness: 0.45,
      metalness: 0.15,
      emissive: 0xff3333,
      emissiveIntensity: 0.08
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), baseMat);
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.92), ribbonMat);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.62, 0.12), ribbonMat);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 10, 16), ribbonMat);
    bow.rotation.x = Math.PI / 2;
    bow.position.y = 0.32;

    const gift = new THREE.Group();
    gift.add(box, r1, r2, bow);
    gift.position.set(x, 18, z);
    gift.rotation.y = randRange(-Math.PI, Math.PI);
    this.scene.add(gift);

    const id = this.gifts.length;
    this.gifts.push({ id, mesh: gift, state: 'falling', vel: new THREE.Vector3(randRange(-0.05, 0.05), -0.7, randRange(-0.05, 0.05)) });
  }

  openGiftNear(pos) {
    let best = null;
    let bestD2 = Infinity;
    for (const g of this.gifts) {
      if (g.state !== 'ready') continue;
      const dx = g.mesh.position.x - pos.x;
      const dz = g.mesh.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = g;
      }
    }
    if (!best || bestD2 > 2.4 * 2.4) return false;
    best.state = 'opened';
    best.mesh.visible = false;
    return true;
  }

  pickBottle(id) {
    const b = this.bottles[id];
    if (!b || b.picked) return false;
    b.picked = true;
    b.mesh.visible = false;
    if (b.mesh.userData.light) this.scene.remove(b.mesh.userData.light);
    return true;
  }

  _addBottles(roomW, roomD, count) {
    // Gold bottles scattered around (pickup).
    this.bottles.length = 0;
    const spots = [];
    const pickSpot = () => {
      const marginX = 18;
      const marginZ = 14;
      for (let tries = 0; tries < 120; tries++) {
        const x = randRange(-roomW / 2 + marginX, roomW / 2 - marginX);
        const z = randRange(-roomD / 2 + marginZ, roomD / 2 - marginZ);
        if (Math.abs(x) > roomW / 2 - 30 && Math.abs(z) < 16) continue; // avoid elevators
        const ok = spots.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > 9 * 9);
        if (!ok) continue;
        const v = new THREE.Vector3(x, 0, z);
        spots.push(v);
        return v;
      }
      return new THREE.Vector3(0, 0, 0);
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      roughness: 0.25,
      metalness: 0.6,
      emissive: 0xffb13b,
      emissiveIntensity: 0.35
    });
    const geoBody = new THREE.CylinderGeometry(0.22, 0.26, 0.75, 14);
    const geoNeck = new THREE.CylinderGeometry(0.14, 0.18, 0.35, 12);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2a, roughness: 0.7, metalness: 0.1 });

    const makeBottleAt = (pos, id) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(geoBody, mat.clone());
      body.position.y = 0.38;
      const neck = new THREE.Mesh(geoNeck, mat.clone());
      neck.position.y = 0.9;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), capMat);
      cap.position.y = 1.12;
      g.add(body, neck, cap);
      g.position.set(pos.x, 0, pos.z);
      g.rotation.y = randRange(-Math.PI, Math.PI);
      this.scene.add(g);
      // No per-bottle point light (performance). Emissive is enough.
      g.userData.light = null;
      this.bottles.push({ id, mesh: g, position: new THREE.Vector3(pos.x, 0, pos.z), picked: false });
    };

    for (let id = 0; id < count; id++) makeBottleAt(pickSpot(), id);
  }

  update(dt) {
    this._lavaT += dt;

    // Update fire flicker + lifetime.
    for (let i = this.fireBlocks.length - 1; i >= 0; i--) {
      const f = this.fireBlocks[i];
      f.t -= dt;
      // Flicker emissive + light.
      const flick = 0.65 + Math.random() * 0.6;
      f.mesh.material.emissiveIntensity = flick * 1.6;
      if (f.light) f.light.intensity = flick * 2.0;

      if (f.t <= 0) {
        this.scene.remove(f.mesh);
        if (f.light) this.scene.remove(f.light);
        this.fireBlocks.splice(i, 1);
      } else {
        f.mesh.updateMatrixWorld(true);
        f.box.setFromObject(f.mesh);
      }
    }

    // Lava shimmer (visual only).
    if (this._lavaOn && this.lavaPools.length) {
      const flick = 0.75 + Math.sin(this._lavaT * 2.1) * 0.18 + Math.random() * 0.12;
      for (const m of this.lavaPools) {
        if (!m.visible) continue;
        const mat = m.material;
        if (!mat || Array.isArray(mat)) continue;
        mat.emissiveIntensity = flick * 2.2;
      }
    }

    // Hack bits drift.
    if (this._hackOn && this.hackBits.length) {
      const t = Date.now() * 0.001;
      for (const s of this.hackBits) {
        if (!s.visible) continue;
        s.position.x += Math.sin(t + s.userData._seed) * dt * 0.18;
        s.position.z += Math.cos(t * 1.3 + s.userData._seed) * dt * 0.18;
        s.material.opacity = 0.25 + (Math.sin(t * 1.5 + s.userData._seed) * 0.5 + 0.5) * 0.55;
      }
    }

    // Gift falling/update.
    for (let i = this.gifts.length - 1; i >= 0; i--) {
      const g = this.gifts[i];
      if (g.state === 'falling') {
        g.vel.y -= 2.2 * dt;
        g.mesh.position.addScaledVector(g.vel, dt);
        if (g.mesh.position.y <= 0.4) {
          g.mesh.position.y = 0.4;
          g.state = 'ready';
          g.vel.set(0, 0, 0);
        }
      }
    }

    // Update one-shot FX.
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const fx = this.fx[i];
      fx.t -= dt;
      const k = 1 - fx.t / fx.maxT;
      fx.mesh.scale.setScalar(0.6 + k * 2.2);
      fx.mesh.material.opacity = Math.max(0, 1 - k);
      if (fx.t <= 0) {
        this.scene.remove(fx.mesh);
        this.fx.splice(i, 1);
      }
    }

    // Update bombs (bomber weather).
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      if (b.state === 'falling') {
        b.vel.y -= 12 * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        if (b.mesh.position.y <= 0.25) {
          b.mesh.position.y = 0.25;
          b.state = 'armed';
          b.fuse = 2.0;
          b.vel.set(0, 0, 0);
        }
      } else {
        b.fuse -= dt;
        if (b.mesh.material?.emissive) {
          const blink = b.fuse < 0.7 ? (Math.sin((2 - b.fuse) * 28) * 0.5 + 0.5) : 0.2;
          b.mesh.material.emissiveIntensity = 0.2 + blink * 1.2;
        }
        if (b.fuse <= 0) {
          const pos = b.mesh.position.clone();
          this.scene.remove(b.mesh);
          this.bombs.splice(i, 1);

          // Explosion visual.
          const fx = new THREE.Mesh(
            new THREE.SphereGeometry(0.7, 8, 6),
            new THREE.MeshBasicMaterial({
              color: 0xffb13b,
              transparent: true,
              opacity: 1,
              blending: THREE.AdditiveBlending,
              depthWrite: false
            })
          );
          fx.position.set(pos.x, 0.7, pos.z);
          this.scene.add(fx);
          this.fx.push({ mesh: fx, t: 0.35, maxT: 0.35 });

          // 6 fire blocks.
          const o = 1.3;
          const offsets = [
            new THREE.Vector3(o, 0, 0),
            new THREE.Vector3(-o, 0, 0),
            new THREE.Vector3(0, 0, o),
            new THREE.Vector3(0, 0, -o),
            new THREE.Vector3(o * 0.75, 0, o * 0.75),
            new THREE.Vector3(-o * 0.75, 0, -o * 0.75)
          ];
          for (const off of offsets) this._spawnFireBlock(pos.x + off.x, pos.z + off.z, { lifetime: 7.0, withLight: false });
        }
      }
    }
  }

  setLavaVisible(on) {
    this._lavaOn = !!on;
    for (const m of this.lavaPools) m.visible = this._lavaOn;
  }

  setHackBitsVisible(on) {
    this._hackOn = !!on;
    for (const s of this.hackBits) s.visible = this._hackOn;
  }

  _addLavaPools(roomW, roomD) {
    // Big visible lava patches around the arena.
    // They are visuals only (no collision, no damage).
    for (const m of this.lavaPools) this.scene.remove(m);
    this.lavaPools.length = 0;

    const spots = [
      new THREE.Vector3(-roomW * 0.22, 0.012, -roomD * 0.18),
      new THREE.Vector3(roomW * 0.18, 0.012, -roomD * 0.22),
      new THREE.Vector3(-roomW * 0.05, 0.012, roomD * 0.18),
      new THREE.Vector3(roomW * 0.26, 0.012, roomD * 0.12),
      new THREE.Vector3(-roomW * 0.3, 0.012, roomD * 0.05),
      new THREE.Vector3(0, 0.012, -roomD * 0.05),
      new THREE.Vector3(roomW * 0.05, 0.012, roomD * 0.02)
    ];

    const makePool = (pos, r) => {
      const geo = new THREE.CircleGeometry(r, 32);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2b0a00,
        emissive: 0xff6a00,
        emissiveIntensity: 2.0,
        roughness: 0.18,
        metalness: 0.0
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.rotation.y = randRange(-Math.PI, Math.PI);
      mesh.visible = false;
      this.scene.add(mesh);
      this.lavaPools.push(mesh);
    };

    for (let i = 0; i < spots.length; i++) makePool(spots[i], 4.6 + (i % 3) * 2.2);
  }

  _ensureHackBits() {
    if (this.hackBits.length) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '1000 44px ui-monospace, ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#37e6a1';
    ctx.fillText('10111000', canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;

    for (let i = 0; i < 28; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.scale.set(2.3, 1.1, 1);
      s.position.set(
        randRange(-this.roomW / 2 + 12, this.roomW / 2 - 12),
        randRange(1.2, 6.5),
        randRange(-this.roomD / 2 + 10, this.roomD / 2 - 10)
      );
      s.userData._seed = Math.random() * 1000;
      s.visible = false;
      this.scene.add(s);
      this.hackBits.push(s);
    }
  }

  setLighting({ ambient, hemi, key, tint }) {
    // Safe no-op if called before build.
    if (this.lights.ambient) this.lights.ambient.intensity = ambient;
    if (this.lights.hemi) this.lights.hemi.intensity = hemi;
    if (this.lights.key) this.lights.key.intensity = key;
    if (tint && this.lights.key) this.lights.key.color.setHex(tint);
  }

  _buildSpawnPoints(roomW, roomD) {
    // A set of spawn points around the room (not inside elevators).
    const pts = [];
    const xs = [-roomW / 2 + 6, -roomW / 4, 0, roomW / 4, roomW / 2 - 6];
    const zs = [-roomD / 2 + 6, -roomD / 4, 0, roomD / 4, roomD / 2 - 6];
    for (const x of xs) {
      for (const z of zs) {
        if (Math.abs(x) > 28 && Math.abs(z) < 6) continue; // keep center lanes near elevators cleaner
        pts.push(new THREE.Vector3(x + randRange(-2, 2), 0, z + randRange(-2, 2)));
      }
    }
    this.spawnPoints = pts;
  }

  _addColliderFromMesh(mesh, tag) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    this.colliders.push({ box, tag });
    this.raycastMeshes.push(mesh);
  }

  _addBoxProp({ size, pos, color, tag }) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.75,
        metalness: 0.15
      })
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this._addColliderFromMesh(mesh, tag);
    this._registerThemeMesh(mesh);
    return mesh;
  }

  _addArcadesAndProps(roomW, roomD) {
    const scene = this.scene;
    const mkArcade = (x, z, taskIndex = null) => {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 2.2, 1.1),
        new THREE.MeshStandardMaterial({
          // More realistic: grey metal with warm yellow glow (no green).
          color: 0x232a33,
          roughness: 0.55,
          metalness: 0.35,
          emissive: 0xffd24a,
          emissiveIntensity: taskIndex != null ? 0.35 : 0.08
        })
      );
      body.position.set(x, 1.1, z);
      scene.add(body);
      this._addColliderFromMesh(body, 'arcade');
      this._registerThemeMesh(body);

      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.6),
        new THREE.MeshStandardMaterial({
          color: 0x0a0f16,
          emissive: taskIndex != null ? 0xffd24a : 0x8b93a2,
          emissiveIntensity: taskIndex != null ? 1.35 : 0.25
        })
      );
      screen.position.set(x, 1.5, z + 0.56);
      scene.add(screen);
      this._registerThemeMesh(screen);

      if (taskIndex != null) {
        this.arcades.push({
          id: this.arcades.length,
          taskIndex,
          position: new THREE.Vector3(x, 0, z)
        });
      }
    };

    // Task machines: "çok farklı random yerlerde" and far apart.
    // We randomize their XZ positions each build (i.e., each page load / deploy).
    // They are kept away from the walls and from each other.
    this.arcades.length = 0;
    const placed = [];
    const pickSpot = () => {
      const marginX = 18;
      const marginZ = 14;
      for (let tries = 0; tries < 100; tries++) {
        const x = randRange(-roomW / 2 + marginX, roomW / 2 - marginX);
        const z = randRange(-roomD / 2 + marginZ, roomD / 2 - marginZ);
        // Keep away from elevators.
        if (Math.abs(x) > roomW / 2 - 28 && Math.abs(z) < 14) continue;
        const ok = placed.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > 28 * 28);
        if (!ok) continue;
        const v = new THREE.Vector3(x, 0, z);
        placed.push(v);
        return v;
      }
      // Fallback deterministic spots (still far).
      return new THREE.Vector3(0, 0, -roomD / 2 + 20);
    };

    const t0 = pickSpot();
    mkArcade(t0.x, t0.z, 0);
    const t1 = pickSpot();
    mkArcade(t1.x, t1.z, 1);
    const t2 = pickSpot();
    mkArcade(t2.x, t2.z, 2);

    // Extra decorative machines (spread around the larger room).
    for (let i = 0; i < 12; i++) {
      const x = randRange(-roomW / 2 + 14, roomW / 2 - 14);
      const z = randRange(-roomD / 2 + 10, roomD / 2 - 10);
      mkArcade(x, z, null);
    }

    // Pool table, ping pong, benches, bowling lane illusion.
    this._addBoxProp({
      size: new THREE.Vector3(4.6, 1.1, 2.4),
      pos: new THREE.Vector3(-roomW / 6, 0.55, roomD / 8),
      color: 0x143c2a,
      tag: 'prop'
    });
    this._addBoxProp({
      size: new THREE.Vector3(3.6, 1.0, 1.8),
      pos: new THREE.Vector3(roomW / 6, 0.5, roomD / 6),
      color: 0x2b3b55,
      tag: 'prop'
    });
    this._addBoxProp({
      size: new THREE.Vector3(8, 0.2, 3.2),
      pos: new THREE.Vector3(0, 0.1, roomD / 3),
      color: 0x1b2233,
      tag: 'prop'
    });
    // Bowling pins area (decor)
    for (let i = 0; i < 6; i++) {
      this._addBoxProp({
        size: new THREE.Vector3(0.4, 0.8, 0.4),
        pos: new THREE.Vector3(22 + (i % 3) * 0.6, 0.4, -6 + Math.floor(i / 3) * 0.6),
        color: 0xe8eef8,
        tag: 'prop'
      });
    }
    // Benches
    this._addBoxProp({
      size: new THREE.Vector3(5, 0.7, 1.1),
      pos: new THREE.Vector3(-roomW / 4, 0.35, -roomD / 10),
      color: 0x3a2a1e,
      tag: 'prop'
    });
    this._addBoxProp({
      size: new THREE.Vector3(5, 0.7, 1.1),
      pos: new THREE.Vector3(roomW / 4, 0.35, roomD / 10),
      color: 0x3a2a1e,
      tag: 'prop'
    });

    // Extra cover/decoration requested:
    // - long panels (panolar)
    // - boxes (kutular)
    // - spikes/skewers (şişler)
    // - tables (masalar)
    // - long flags/banners (uzun flamalar)
    for (let i = 0; i < 10; i++) {
      this._addBoxProp({
        size: new THREE.Vector3(randRange(6, 14), randRange(1.6, 2.6), 0.6),
        pos: new THREE.Vector3(randRange(-roomW / 2 + 24, roomW / 2 - 24), 0.9, randRange(-roomD / 2 + 18, roomD / 2 - 18)),
        color: 0x2a3244,
        tag: 'prop'
      });
    }
    for (let i = 0; i < 16; i++) {
      this._addBoxProp({
        size: new THREE.Vector3(randRange(1.2, 2.6), randRange(0.8, 1.6), randRange(1.2, 2.6)),
        pos: new THREE.Vector3(randRange(-roomW / 2 + 20, roomW / 2 - 20), 0.6, randRange(-roomD / 2 + 16, roomD / 2 - 16)),
        color: 0x3a2a1e,
        tag: 'prop'
      });
    }
    // Tables (long and low).
    for (let i = 0; i < 8; i++) {
      this._addBoxProp({
        size: new THREE.Vector3(randRange(3.8, 6.8), 1.0, randRange(1.2, 2.2)),
        pos: new THREE.Vector3(randRange(-roomW / 2 + 22, roomW / 2 - 22), 0.5, randRange(-roomD / 2 + 18, roomD / 2 - 18)),
        color: 0x2b3b55,
        tag: 'prop'
      });
    }
    // Spikes/skewers (decor, not colliders to avoid annoying gameplay).
    for (let i = 0; i < 30; i++) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, randRange(0.8, 1.6), 8),
        new THREE.MeshStandardMaterial({ color: 0x9099a8, roughness: 0.25, metalness: 0.7 })
      );
      spike.position.set(randRange(-roomW / 2 + 18, roomW / 2 - 18), 0.4, randRange(-roomD / 2 + 14, roomD / 2 - 14));
      this.scene.add(spike);
      // no collider
    }
    // Banners: thin emissive planes.
    for (let i = 0; i < 10; i++) {
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, randRange(6, 10)),
        new THREE.MeshStandardMaterial({
          color: 0x0a0f1a,
          emissive: Math.random() < 0.5 ? 0x34a2ff : 0xff4fd7,
          emissiveIntensity: 1.6,
          side: THREE.DoubleSide,
          roughness: 0.4,
          metalness: 0.1
        })
      );
      banner.position.set(randRange(-roomW / 2 + 10, roomW / 2 - 10), 4.2, randRange(-roomD / 2 + 10, roomD / 2 - 10));
      banner.rotation.y = randRange(-Math.PI, Math.PI);
      this.scene.add(banner);
    }

    // Explosive barrels: lots around the arena.
    this._addBarrels(roomW, roomD, 26);
  }

  spawnBomb(x, z) {
    // Cap bombs to avoid build-up.
    if (this.bombs.length >= this._maxBombs) return;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1a1f2a,
        roughness: 0.65,
        metalness: 0.25,
        emissive: 0xff2b2b,
        emissiveIntensity: 0.2
      })
    );
    mesh.position.set(x, 14, z);
    this.scene.add(mesh);
    this.bombs.push({
      mesh,
      vel: new THREE.Vector3(randRange(-0.8, 0.8), -randRange(4.5, 7.5), randRange(-0.8, 0.8)),
      state: 'falling',
      fuse: 2.0
    });
  }

  _addBarrels(roomW, roomD, count) {
    this.barrels.length = 0;
    const spots = [];
    const pickSpot = () => {
      const marginX = 16;
      const marginZ = 14;
      for (let tries = 0; tries < 150; tries++) {
        const x = randRange(-roomW / 2 + marginX, roomW / 2 - marginX);
        const z = randRange(-roomD / 2 + marginZ, roomD / 2 - marginZ);
        // Keep away from elevators.
        if (Math.abs(x) > roomW / 2 - 30 && Math.abs(z) < 16) continue;
        // Keep away from task arcades so they aren't blocked.
        const nearTask = this.arcades.some((a) => (a.position.x - x) ** 2 + (a.position.z - z) ** 2 < 8 * 8);
        if (nearTask) continue;
        const ok = spots.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > 6 * 6);
        if (!ok) continue;
        const v = new THREE.Vector3(x, 0, z);
        spots.push(v);
        return v;
      }
      return new THREE.Vector3(0, 0, 0);
    };

    const bodyGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 16, 1, false);
    const ringGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.08, 16);
    // Make barrels VERY visible (user said "didn't happen" -> likely couldn't find).
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff3a2f,
      roughness: 0.45,
      metalness: 0.25,
      emissive: 0xff7a1a,
      emissiveIntensity: 0.65
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x182033,
      roughness: 0.8,
      metalness: 0.2
    });

    // Guaranteed barrels near elevators + center so you can always test quickly.
    const fixed = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, roomD * 0.25),
      new THREE.Vector3(0, 0, -roomD * 0.25),
      new THREE.Vector3(-roomW * 0.25, 0, 0),
      new THREE.Vector3(roomW * 0.25, 0, 0),
      // Near elevator exits
      new THREE.Vector3(this.elevators.p1.anchor.x + 10, 0, 0),
      new THREE.Vector3(this.elevators.p2.anchor.x - 10, 0, 0)
    ];

    const makeBarrelAt = (p, id) => {
      const barrel = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, mat.clone());
      body.position.y = 0.5;
      const r1 = new THREE.Mesh(ringGeo, ringMat);
      r1.position.y = 0.22;
      const r2 = new THREE.Mesh(ringGeo, ringMat);
      r2.position.y = 0.78;
      barrel.add(body, r1, r2);
      barrel.position.set(p.x, 0, p.z);
      barrel.rotation.y = randRange(-Math.PI, Math.PI);
      this.scene.add(barrel);

      // Collider + raycast on body mesh.
      body.userData.isBarrel = true;
      body.userData.barrelId = id;
      this._addColliderFromMesh(body, 'barrel');
      const collider = this.colliders[this.colliders.length - 1];

      // Glow light so it's obvious.
      const light = new THREE.PointLight(0xff7a1a, 1.2, 6.0, 2.0);
      light.position.set(p.x, 1.1, p.z);
      this.scene.add(light);
      barrel.userData.light = light;

      this.barrels.push({ id, mesh: barrel, collider, exploded: false });
    };

    let id = 0;
    for (const p of fixed) makeBarrelAt(p, id++);
    for (; id < count; id++) makeBarrelAt(pickSpot(), id);
  }

  explodeBarrel(id) {
    const b = this.barrels[id];
    if (!b || b.exploded) return null;
    b.exploded = true;
    b.mesh.visible = false;
    if (b.collider) b.collider.disabled = true;
    if (b.mesh.userData.light) this.scene.remove(b.mesh.userData.light);

    const pos = b.mesh.position.clone();

    // Explosion visual (quick expanding sphere).
    const fx = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffb13b,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    fx.position.set(pos.x, 0.7, pos.z);
    this.scene.add(fx);
    this.fx.push({ mesh: fx, t: 0.35, maxT: 0.35 });

    // Spawn 4 fire blocks on the ground.
    const offsets = [
      new THREE.Vector3(1.3, 0, 0),
      new THREE.Vector3(-1.3, 0, 0),
      new THREE.Vector3(0, 0, 1.3),
      new THREE.Vector3(0, 0, -1.3)
    ];
    for (const o of offsets) {
      this._spawnFireBlock(pos.x + o.x, pos.z + o.z);
    }

    return pos;
  }

  _spawnFireBlock(x, z, { lifetime = 20.0, withLight = true } = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a1a06,
      emissive: 0xff9a2f,
      emissiveIntensity: 1.6,
      roughness: 0.7,
      metalness: 0.0
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 1.2), mat);
    mesh.position.set(x, 0.09, z);
    this.scene.add(mesh);

    let light = null;
    if (withLight) {
      light = new THREE.PointLight(0xffa24a, 2.0, 6.0, 2.0);
      light.position.set(x, 0.55, z);
      this.scene.add(light);
    }

    const box = new THREE.Box3().setFromObject(mesh);
    this.fireBlocks.push({ id: this.fireBlocks.length, mesh, light, box, t: lifetime });

    // Cap fire blocks (remove oldest) to keep FPS stable.
    while (this.fireBlocks.length > this._maxFireBlocks) {
      const old = this.fireBlocks.shift();
      if (!old) break;
      this.scene.remove(old.mesh);
      if (old.light) this.scene.remove(old.light);
    }
  }

  _addElevators() {
    const mkElevator = (anchor, key) => {
      // Elevator cabin: white walls with a REAL doorway opening.
      // This fixes the "door opens but still looks blocked" bug from a solid cube.
      const cabinGroup = new THREE.Group();
      cabinGroup.position.set(anchor.x, 0, anchor.z);
      this.scene.add(cabinGroup);
      this.elevators[key].cabin = cabinGroup;

      const cabinMats = [];
      const whiteMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1.0
      });
      const mkPanel = (geo, x, y, z, ry = 0) => {
        const m = new THREE.Mesh(geo, whiteMat.clone());
        m.position.set(x, y, z);
        m.rotation.y = ry;
        cabinGroup.add(m);
        cabinMats.push(m.material);
        return m;
      };

      const w = 5.0;
      const h = 4.6;
      const d = 5.0;
      const doorH = 4.2;
      const doorW = 3.6; // opening width in Z
      const doorDir = key === 'p1' ? 1 : -1; // doorway faces center

      // Floor + ceiling
      const floor = new THREE.PlaneGeometry(w, d);
      floor.rotateX(-Math.PI / 2);
      mkPanel(floor, 0, 0.002, 0);
      const ceil = new THREE.PlaneGeometry(w, d);
      ceil.rotateX(Math.PI / 2);
      mkPanel(ceil, 0, h, 0);

      // Side walls (Z+ / Z-)
      const wallSide = new THREE.PlaneGeometry(w, h);
      mkPanel(wallSide, 0, h / 2, d / 2, 0);
      mkPanel(wallSide, 0, h / 2, -d / 2, Math.PI);

      // Back wall (opposite door)
      const backWall = new THREE.PlaneGeometry(d, h);
      mkPanel(backWall, -doorDir * (w / 2), h / 2, 0, doorDir === 1 ? -Math.PI / 2 : Math.PI / 2);

      // Front wall pieces around the doorway (leave gap for the door).
      const sidePieceW = (d - doorW) / 2; // along Z
      const sidePiece = new THREE.PlaneGeometry(sidePieceW, h);
      // Left piece
      mkPanel(
        sidePiece,
        doorDir * (w / 2),
        h / 2,
        -(doorW / 2 + sidePieceW / 2),
        doorDir === 1 ? Math.PI / 2 : -Math.PI / 2
      );
      // Right piece
      mkPanel(
        sidePiece,
        doorDir * (w / 2),
        h / 2,
        doorW / 2 + sidePieceW / 2,
        doorDir === 1 ? Math.PI / 2 : -Math.PI / 2
      );
      // Top piece above doorway
      const topH = h - doorH;
      const topPiece = new THREE.PlaneGeometry(doorW, topH);
      mkPanel(topPiece, doorDir * (w / 2), doorH + topH / 2, 0, doorDir === 1 ? Math.PI / 2 : -Math.PI / 2);

      cabinGroup.userData._mats = cabinMats;

      // Door at the side facing the center (towards +X for P1 elevator, towards -X for P2).
      const door = new THREE.Mesh(
        // Slightly larger than the opening to avoid tiny "leaks".
        new THREE.BoxGeometry(0.35, 4.3, 3.9),
        new THREE.MeshStandardMaterial({
          color: 0x8b93a2,
          roughness: 0.55,
          metalness: 0.1
        })
      );
      // Keep door aligned with the doorway plane and slide along Z in setElevatorDoorOpen().
      door.userData.doorDir = doorDir;
      door.position.set(anchor.x + doorDir * (w / 2 + 0.175), 2.1, anchor.z);
      this.scene.add(door);

      this._addColliderFromMesh(door, 'elevatorDoor');
      const doorCollider = this.colliders[this.colliders.length - 1];
      // Used for right-to-left sliding direction in setElevatorDoorOpen().
      door.userData.slideZDir = key === 'p1' ? 1 : -1;

      // Collision: the visible "frame" mesh is a solid cube (placeholder), so we DO NOT use it
      // for collision. Instead we add invisible wall colliders so players can stand inside.
      const wallMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
      const mkWall = (w, h, d, x, y, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
        m.position.set(x, y, z);
        this.scene.add(m);
        this._addColliderFromMesh(m, 'elevatorWall');
        return m;
      };
      const wallH = 4.2;
      const t = 0.25;
      const innerW = 5.0;
      const innerD = 5.0;
      // Side walls (Z+ / Z-)
      mkWall(innerW, wallH, t, anchor.x, 2.1, anchor.z + innerD / 2);
      mkWall(innerW, wallH, t, anchor.x, 2.1, anchor.z - innerD / 2);
      // Back wall (opposite the door opening)
      mkWall(t, wallH, innerD, anchor.x - doorDir * (innerW / 2), 2.1, anchor.z);

      // A simple in-world "floor number" display (canvas texture on a plane).
      const c = this._displayCanvas[key];
      c.width = 256;
      c.height = 128;
      const tex = new THREE.CanvasTexture(c);
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), mat);
      plane.position.set(anchor.x, 4.4, anchor.z - 2.2);
      plane.rotation.y = doorDir === 1 ? 0 : Math.PI;
      this.scene.add(plane);

      this.elevators[key].doorCollider = doorCollider;
      this.elevators[key].doorMesh = door;
      this.elevators[key].display = { canvas: c, tex, plane };
      this.setElevatorDisplay(key, '10');
    };

    mkElevator(this.elevators.p1.anchor, 'p1');
    mkElevator(this.elevators.p2.anchor, 'p2');
  }

  setElevatorCabinAlpha(key, alpha) {
    const c = this.elevators[key].cabin;
    if (!c) return;
    c.visible = alpha > 0.01;
    // Cabin is a Group; fade all its materials (keep display visible).
    const mats = c.userData?._mats ?? [];
    for (const m of mats) m.opacity = alpha;

    // If the cabin is visible, hide the 3D display so the player sees "only white".
    const disp = this.elevators[key].display?.plane;
    if (disp) disp.visible = alpha <= 0.01;
  }

  setElevatorDisplay(key, text) {
    const ctx = this._displayCtx[key];
    const canvas = this._displayCanvas[key];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#02040a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#9fe3ff';
    ctx.font = '900 72px ui-sans-serif, system-ui, Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(120,200,255,0.6)';
    ctx.shadowBlur = 16;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    this.elevators[key].display.tex.needsUpdate = true;
  }

  setElevatorDoorOpen(key, open01) {
    // open01: 0 = closed, 1 = open
    const e = this.elevators[key];
    // Door behavior: slide RIGHT -> LEFT relative to the player's view.
    // P1 looks +X, so "left" is +Z. P2 looks -X, so "left" is -Z.
    // So we slide along Z with opposite directions per elevator.
    const zDir = e.doorMesh.userData.slideZDir ?? (key === 'p1' ? 1 : -1);
    // Keep door in doorway plane (X fixed) and slide along Z to open.
    const doorDir = e.doorMesh.userData.doorDir ?? (key === 'p1' ? 1 : -1);
    e.doorMesh.position.x = e.anchor.x + doorDir * (2.5 + 0.175);
    e.doorMesh.position.z = e.anchor.z + zDir * (open01 * 2.4);
    // Disable collider when mostly open.
    if (e.doorCollider) {
      // Update collider to match animated door.
      e.doorMesh.updateMatrixWorld(true);
      e.doorCollider.box.setFromObject(e.doorMesh);
      e.doorCollider.disabled = open01 > 0.8;
    }
  }
}

