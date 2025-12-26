## Asset placeholders (you will replace these)

This project runs with placeholder geometry/materials and will **not crash** if assets are missing.

### Recommended formats

- **Models**: `.glb` (binary glTF)
- **Textures**: `.png`
  - **Walls/Floor**: 2048×2048
  - **Props**: 1024×1024
  - **Small props**: 512×512
  - **UI icons (optional)**: 256×256
- **Audio**
  - **SFX**: `.wav` (or `.ogg`)
  - **Music loops**: `.ogg` (recommended for looping)

### Suggested folder structure

- `public/assets/models/`
- `public/assets/textures/`
- `public/assets/audio/sfx/`
- `public/assets/audio/music/`

### Expected audio paths (optional)

If you add files at these paths, the game will auto-load them:

- Ambient loop: `public/assets/audio/music/arcade_ambient.ogg`
- Pistol: `public/assets/audio/sfx/pistol.ogg`
- Vandal: `public/assets/audio/sfx/vandal.ogg`
- Sniper: `public/assets/audio/sfx/sniper.ogg`
- Knife: `public/assets/audio/sfx/knife.ogg`
- Reload: `public/assets/audio/sfx/reload.ogg`
- UI click: `public/assets/audio/sfx/ui_click.ogg`
- Explosion: `public/assets/audio/sfx/explosion.ogg`
- Elevator door: `public/assets/audio/sfx/elevator_door.ogg`
- Footstep: `public/assets/audio/sfx/step.ogg`
- Task start: `public/assets/audio/sfx/task_start.ogg`
- Task complete: `public/assets/audio/sfx/task_complete.ogg`
- Death: `public/assets/audio/sfx/death.ogg`

### TODO markers in code

Search for `TODO: replace placeholder assets` to find where to wire real models/textures/audio.

