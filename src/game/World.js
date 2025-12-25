import * as THREE from 'three';
import { randRange } from './math.js';

// Placeholder world: one big arcade hall + simple props + colliders.
// TODO: replace placeholder assets with real glb/models/textures.
export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060a');

    /** @type {Array<{box:THREE.Box3, tag:string}>} */
    this.colliders = [];
    /** @type {Array<import('three').Object3D>} */
    this.raycastMeshes = [];

    /** @type {Array<THREE.Vector3>} */
    this.spawnPoints = [];

    /** @type {Array<{id:number, taskIndex:number, position:THREE.Vector3}>} */
    this.arcades = [];

    this.elevators = {
      p1: { doorCollider: null, doorMesh: null, display: null, anchor: new THREE.Vector3(-34, 0, 0) },
      p2: { doorCollider: null, doorMesh: null, display: null, anchor: new THREE.Vector3(34, 0, 0) }
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
    const roomW = 80; // X
    const roomD = 40; // Z
    const wallH = 8;

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
    this._addArcadesAndProps();
    this._addElevators();
    this._buildSpawnPoints(roomW, roomD);
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

  _addArcadesAndProps() {
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

    // Three "task" machines, spaced on one side.
    mkArcade(-8, -16, 0); // Task 1
    mkArcade(0, -16, 1); // Task 2
    mkArcade(8, -16, 2); // Task 3

    // Extra decorative machines.
    for (let i = 0; i < 6; i++) {
      mkArcade(-30 + i * 4, 16, null);
    }
    for (let i = 0; i < 6; i++) {
      mkArcade(-30 + i * 4, -18, null);
    }

    // Pool table, ping pong, benches, bowling lane illusion.
    this._addBoxProp({
      size: new THREE.Vector3(4.6, 1.1, 2.4),
      pos: new THREE.Vector3(-10, 0.55, 6),
      color: 0x143c2a,
      tag: 'prop'
    });
    this._addBoxProp({
      size: new THREE.Vector3(3.6, 1.0, 1.8),
      pos: new THREE.Vector3(10, 0.5, 8),
      color: 0x2b3b55,
      tag: 'prop'
    });
    this._addBoxProp({
      size: new THREE.Vector3(8, 0.2, 3.2),
      pos: new THREE.Vector3(0, 0.1, 14),
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
      pos: new THREE.Vector3(-18, 0.35, -2),
      color: 0x3a2a1e,
      tag: 'prop'
    });
    this._addBoxProp({
      size: new THREE.Vector3(5, 0.7, 1.1),
      pos: new THREE.Vector3(18, 0.35, 2),
      color: 0x3a2a1e,
      tag: 'prop'
    });
  }

  _addElevators() {
    const mkElevator = (anchor, key) => {
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x1a2334,
        roughness: 0.55,
        metalness: 0.25
      });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 5.0, 5.4), frameMat);
      frame.position.set(anchor.x, 2.5, anchor.z);
      this.scene.add(frame);

      // Hollow look by adding a dark inner box.
      const inner = new THREE.Mesh(
        new THREE.BoxGeometry(5.0, 4.6, 5.0),
        new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 1.0, metalness: 0.0 })
      );
      inner.position.set(anchor.x, 2.3, anchor.z);
      this.scene.add(inner);

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
    const dir = key === 'p1' ? 1 : -1;
    // Slide door outwards (towards outside wall) a bit to "open" the doorway.
    e.doorMesh.position.x = e.anchor.x + dir * (2.55 + open01 * 1.8);
    // Disable collider when mostly open.
    if (e.doorCollider) {
      // Update collider to match animated door.
      e.doorMesh.updateMatrixWorld(true);
      e.doorCollider.box.setFromObject(e.doorMesh);
      e.doorCollider.disabled = open01 > 0.8;
    }
  }
}

