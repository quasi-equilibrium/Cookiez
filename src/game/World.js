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

    /** @type {Array<{id:number, mesh:THREE.Mesh, light:THREE.Light, box:THREE.Box3, t:number}>} */
    this.fireBlocks = [];

    /** @type {Array<{mesh:THREE.Mesh, t:number, maxT:number}>} */
    this.fx = [];

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
  }

  build() {
    const scene = this.scene;

    // Lighting: general + neon-ish accents.
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const hemi = new THREE.HemisphereLight(0x9ecbff, 0x2a1b12, 0.45);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.65);
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
  }

  update(dt) {
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
    return mesh;
  }

  _addArcadesAndProps(roomW, roomD) {
    const scene = this.scene;
    const mkArcade = (x, z, taskIndex = null) => {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 2.2, 1.1),
        new THREE.MeshStandardMaterial({
          color: 0x1a2a44,
          roughness: 0.6,
          metalness: 0.2,
          emissive: taskIndex != null ? 0x2bffb9 : 0x000000,
          emissiveIntensity: taskIndex != null ? 0.9 : 0
        })
      );
      body.position.set(x, 1.1, z);
      scene.add(body);
      this._addColliderFromMesh(body, 'arcade');

      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.6),
        new THREE.MeshStandardMaterial({
          color: 0x0a0f16,
          emissive: taskIndex != null ? 0x7aa6ff : 0x3b6a9f,
          emissiveIntensity: taskIndex != null ? 1.8 : 0.6
        })
      );
      screen.position.set(x, 1.5, z + 0.56);
      scene.add(screen);

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
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2d67ff,
      roughness: 0.6,
      metalness: 0.25,
      emissive: 0x000000
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x182033,
      roughness: 0.8,
      metalness: 0.2
    });

    for (let i = 0; i < count; i++) {
      const p = pickSpot();
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
      body.userData.barrelId = i;
      this._addColliderFromMesh(body, 'barrel');
      const collider = this.colliders[this.colliders.length - 1];

      this.barrels.push({ id: i, mesh: barrel, collider, exploded: false });
    }
  }

  explodeBarrel(id) {
    const b = this.barrels[id];
    if (!b || b.exploded) return null;
    b.exploded = true;
    b.mesh.visible = false;
    if (b.collider) b.collider.disabled = true;

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

  _spawnFireBlock(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a1a06,
      emissive: 0xff9a2f,
      emissiveIntensity: 1.6,
      roughness: 0.7,
      metalness: 0.0
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.9), mat);
    mesh.position.set(x, 0.09, z);
    this.scene.add(mesh);

    const light = new THREE.PointLight(0xffa24a, 2.0, 6.0, 2.0);
    light.position.set(x, 0.55, z);
    this.scene.add(light);

    const box = new THREE.Box3().setFromObject(mesh);
    this.fireBlocks.push({ id: this.fireBlocks.length, mesh, light, box, t: 14.0 });
  }

  _addElevators() {
    const mkElevator = (anchor, key) => {
      // White cabin that hides the map completely during the countdown.
      // We render its faces from the inside (BackSide) so the player camera sees "only white".
      const cabinMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.BackSide,
        transparent: true,
        opacity: 1.0
      });
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(5.0, 4.6, 5.0), cabinMat);
      cabin.position.set(anchor.x, 2.3, anchor.z);
      this.scene.add(cabin);
      this.elevators[key].cabin = cabin;

      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x1a2334,
        roughness: 0.55,
        metalness: 0.25
      });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 5.0, 5.4), frameMat);
      frame.position.set(anchor.x, 2.5, anchor.z);
      this.scene.add(frame);

      // Door at the side facing the center (towards +X for P1 elevator, towards -X for P2).
      const doorDir = key === 'p1' ? 1 : -1;
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 4.2, 3.6),
        new THREE.MeshStandardMaterial({
          color: 0x2c394f,
          roughness: 0.45,
          metalness: 0.35
        })
      );
      door.position.set(anchor.x + doorDir * 2.55, 2.1, anchor.z);
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
    c.material.opacity = alpha;

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
    e.doorMesh.position.x = e.anchor.x + (key === 'p1' ? 1 : -1) * 2.55;
    e.doorMesh.position.z = e.anchor.z + zDir * (open01 * 2.2);
    // Disable collider when mostly open.
    if (e.doorCollider) {
      // Update collider to match animated door.
      e.doorMesh.updateMatrixWorld(true);
      e.doorCollider.box.setFromObject(e.doorMesh);
      e.doorCollider.disabled = open01 > 0.8;
    }
  }
}

