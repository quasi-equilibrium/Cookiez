# ARCADE DUEL (Vite + Three.js)

Split-screen 2-player FPS inside a single 80's arcade hall.

## Oyun üzerinde değişiklik yapmak (kısa rehber)

Bu repo tamamen istemci tarafı (Vite + Three.js). Oyun “entrypoint”i `src/main.js`, ana oyun döngüsü ve kurallar `src/game/GameApp.js` içindedir.

### Çalıştırma

```bash
npm install
npm run dev
```

### En çok değiştirilen yerler (dosya haritası)

- **Oyun kuralları / skor / ateş etme / hareket**: `src/game/GameApp.js`
  - Kazanma skoru: `WIN_KILLS`
  - Hareket/jump/gravity/speed gibi sayılar: `_updateMovement()`
  - Hasar verme, vurma (raycast), barrel patlama tetikleme: `_shootHitscan()` / `_knifeAttack()`
- **Silah istatistikleri (damage, şarjör, fire-rate, reload)**: `src/game/Weapons.js`
  - Hasarlar: `damageForWeapon()`
  - Mermi ve şarjör sayıları: `WeaponState.setWeapon()`
  - Atış hızı: `WeaponState.consumeShot()`
- **Harita / objeler / spawnlar / arcade makineleri**: `src/game/World.js`
  - Harita boyutu: `roomW`, `roomD`
  - Arcade makinelerinin konumu/dağılımı: `_addArcadesAndProps()`
  - Variller (barrels): `_addBarrels()` ve `explodeBarrel()`
- **Görevler (TicTacToe / Çarpım / Snake)**: `src/game/TaskSystem.js`
  - Metinler, zorluk, snake hızı, “10 food” gibi hedefler burada.
- **Kontroller / input**: `src/game/Input.js`
  - Klavye tuşları, mouse click/lock davranışı burada.
- **Oyuncu canı, invuln, model/hitbox**: `src/game/Player.js`
  - `maxHp`, `invulnDuration`, hitbox boyutları gibi değerler burada.
- **UI (menü, HUD, yazılar)**: `index.html` ve `src/style.css`

### GitHub Pages notu

GitHub Pages’e doğru deploy için `npm run build` çıktısı olan `dist/` yayınlanmalı. Repo zaten `.github/workflows/deploy-pages.yml` ile bunu yapacak şekilde ayarlı.

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

## GitHub Pages deploy (neden butonlar çalışmıyordu?)

Vite projeleri **repo kökünden** (source) servis edilirse JS paketlenmediği için çalışmaz. GitHub Pages’te doğru yöntem:

- Pages kaynağı: **GitHub Actions**
- Deploy: workflow `Deploy to GitHub Pages` (`.github/workflows/deploy-pages.yml`) `dist/` klasörünü yayınlar.

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

