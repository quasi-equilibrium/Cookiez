// Shared input layer (keyboard + one mouse) for split-screen 2P.
//
// Important constraint: there is only ONE mouse.
// - Mouse movement is treated as P2 look (pointer lock).
// - Mouse left click is used for P2 fire by default.
// - To satisfy the "left click shoots" requirement while keeping the game playable,
//   we offer a toggle: Mouse Fire -> "P2 only" (default) / "Both".
//   When set to "Both", mouse left will also trigger P1 fire.
//   P1 ALWAYS has an alternate fire key: Left Shift.
export class Input {
  constructor({ canvas }) {
    this.canvas = canvas;

    this.keysDown = new Set();
    this.keysPressed = new Set();
    this.keysReleased = new Set();

    this.mouse = {
      dx: 0,
      dy: 0,
      leftDown: false,
      leftPressed: false,
      leftReleased: false,
      rightDown: false,
      rightPressed: false,
      rightReleased: false,
      middlePressed: false
    };

    this.pointerLocked = false;

    this._onKeyDown = (e) => {
      if (!this.keysDown.has(e.code)) this.keysPressed.add(e.code);
      this.keysDown.add(e.code);
      // Prevent page scroll on arrows/space.
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    };

    this._onKeyUp = (e) => {
      this.keysDown.delete(e.code);
      this.keysReleased.add(e.code);
    };

    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    };

    this._onMouseDown = (e) => {
      // We want right click to be usable for tasks: prevent context menu.
      if (e.button === 2) e.preventDefault();
      if (e.button === 0) {
        if (!this.mouse.leftDown) this.mouse.leftPressed = true;
        this.mouse.leftDown = true;
      } else if (e.button === 2) {
        if (!this.mouse.rightDown) this.mouse.rightPressed = true;
        this.mouse.rightDown = true;
      } else if (e.button === 1) {
        this.mouse.middlePressed = true;
      }
    };

    this._onMouseUp = (e) => {
      if (e.button === 0) {
        this.mouse.leftDown = false;
        this.mouse.leftReleased = true;
      } else if (e.button === 2) {
        this.mouse.rightDown = false;
        this.mouse.rightReleased = true;
      }
    };

    this._onContextMenu = (e) => e.preventDefault();

    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    };
  }

  mount() {
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  unmount() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }

  frameStart() {
    // Called each frame to reset one-frame deltas.
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.leftPressed = false;
    this.mouse.leftReleased = false;
    this.mouse.rightPressed = false;
    this.mouse.rightReleased = false;
    this.mouse.middlePressed = false;
  }

  isDown(code) {
    return this.keysDown.has(code);
  }
  wasPressed(code) {
    return this.keysPressed.has(code);
  }
  wasReleased(code) {
    return this.keysReleased.has(code);
  }
}

