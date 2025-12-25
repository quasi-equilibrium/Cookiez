# ARCADE DUEL (Vite + Three.js)

Split-screen 2-player FPS inside a single 80's arcade hall.

## Run

```bash
npm install
npm run dev
```

Build/preview:

```bash
npm run build
npm run preview
```

## Core controls

- **Player 1 (Left)**
  - Move: `W A S D`
  - Look (keyboard): `Q` (left), `F` (right), `T` (up), `G` (down)
  - Jump: `Space`
  - Use arcade: `E`
  - Reload: `R`
  - Fire: `Left Shift` (always) + optional `Mouse Left` (see Mouse Fire toggle)
- **Player 2 (Right)**
  - Move: `Arrow keys`
  - Look: `Mouse` (pointer lock; click canvas to lock, `Esc` to unlock)
  - Fire: `Mouse Left`
  - Use arcade: `Mouse Right`
  - Reload: `Mouse Middle`

## Mouse sharing note (important)

There is only **one mouse**:

- Mouse movement is always treated as **P2 aim**.
- Mouse left click is **P2 fire** by default.
- If you want mouse left click to also fire P1, toggle **Mouse Fire → Both** (in menu, or press `H` and change it in the help overlay).

## Tasks → weapon upgrades

Arcade machines offer 3 tasks (must be done in order):

1. **Tic Tac Toe** (CPU is 60% optimal / 40% random)
2. **Multiplication**
3. **Snake** (eat 10 food)

Completing tasks upgrades your weapon: `Knife → Pistol → Vandal → Sniper`.

## Assets

See `public/assets/README.md` for recommended formats and expected paths.

