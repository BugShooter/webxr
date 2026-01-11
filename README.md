# WebXR Vision Trainers (Quest)

This folder contains a small WebXR (immersive-vr) project aimed at **binocular / vision training**.
It runs in a browser (e.g. Meta Quest Browser on Quest 3) and uses **Three.js** for rendering.

The core idea is to support **per-eye presentation** (left/right) and **ALT (alternating) fade** timing profiles, so specific stimuli can be shown or suppressed per eye as part of training exercises.

## What’s inside

- **Runtime host**: one shared XR session and scene, common input handling, in-VR menus, and ALT fade profiles.
- **Trainers** (switchable without restarting XR):
  - **Binocular**: basic binocular stimulus training.
  - **Trajectory**: motion/trajectory exercise with quick fade profile switching.
  - **Block Breaker**: simple Arkanoid-style trainer using staged per-eye visibility.

## Controls (Quest controllers)

Global / runtime:
- **Left grip (squeeze)**: toggle VR menu
- **Menu open**:
  - Point + **Trigger**: select
  - **Left stick**: move the menu (distance/height)
  - **Right stick X**: adjust selected numeric setting in Settings

Block Breaker (trainer):
- **Right stick X**: move paddle
- **Right trigger** (or **A**): serve / restart

## Settings

Open the menu → **Settings**:
- Positioning: `distance`, `height`, `scale`
- ALT fade:
  - Enable/disable
  - Select a fade profile
  - Adjust ON/OUT/OFF/IN timings

## Run locally

From the repository root:

```bash
cd webxr
python3 -m http.server 5173
```

Then open:
- `http://localhost:5173/`

Notes:
- WebXR immersive VR typically requires HTTPS on real devices; local testing is easiest in a headset browser via a LAN URL or using an HTTPS tunnel.

## Project structure

- `index.html` — entry page (trainer selection + start button)
- `js/main.js` — bootstraps the runtime (and shows the Build string)
- `js/runtime.js` — shared XR runtime (scene/camera/renderer, controllers, menus, ALT fade)
- `js/base.js` — helpers (HUD panels, easing, input helpers)
- `js/trainers/*.js` — individual trainers

## Disclaimer

This project is an experimental training tool and is **not medical advice**.
If you have eye/vision conditions, consult a qualified professional before using.
