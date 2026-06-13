#  Space Dodger

A production-quality, browser-based arcade game built with pure HTML, CSS, and Vanilla JavaScript — no frameworks, no build tools, no dependencies.



## Overview

Space Dodger puts you in the cockpit of a futuristic spaceship at the bottom of the screen. Asteroids rain down from above — dodge them for as long as possible, collect power-ups, and climb the leaderboard. The longer you survive, the harder it gets.

---

## Features

### Gameplay
- Smooth spaceship movement with inertia
- Procedurally generated asteroids with randomised shapes, sizes, and rotation
- Continuous score based on survival time
- Difficulty scaling — asteroids get faster and spawn more frequently as you level up

### Visuals
- Animated, twinkling starfield background
- Canvas-drawn spaceship with engine flame and particle trails
- Rotating asteroids with crater detail
- Explosion particle effects on collision
- Screen shake on death
- Glowing shield ring when protected
- Glassmorphism UI panels with neon cyan / purple accents

### Audio
- All sound synthesised via the Web Audio API — no external files required
- Ambient space drone with LFO modulation
- Distinct sounds for: explosion, power-up collect, level-up, score milestones
- Toggle button to mute / unmute at any time

### Power-Ups
- **🛡 Shield** — absorbs one asteroid hit
- **⏱ Slow Motion** — reduces asteroid speed to 38% for 6 seconds
- **⚡ Score Booster** — doubles score gain for 6 seconds

### Persistence
All stats are saved to `localStorage` and persist between sessions:
- High Score
- Total Games Played
- Best Survival Time

---

## Getting Started

No installation, no build step, no internet connection required (after the font loads).

1. Download or clone the three files into the same folder:
   ```
   index.html
   style.css
   script.js
   ```
2. Open `index.html` in any modern browser.
3. Click **LAUNCH MISSION** and play.

> **Tip:** For the best experience use a Chromium-based browser (Chrome, Edge, Brave) or Firefox on desktop.

---

## How to Play

- Your ship sits at the bottom of the screen.
- Asteroids fall from the top — avoid them.
- Your score increases automatically the longer you survive.
- Collect glowing power-up orbs for temporary advantages.
- Every 200 points you advance a level, increasing asteroid speed and spawn rate.
- One hit from an unblocked asteroid ends the game.

---

## Controls

|      Action      | Keyboard     | Mobile 
|------------------|--------------|--------
| Move Left        | `←` or `A `  | Swipe / drag left 
| Move Right       | `→` or `D`   | Swipe / drag right
| Pause / Resume   | `P` or `Esc` | Pause button (HUD) 




## Progression System

| Level | Score Required | Asteroid Speed | Spawn Interval |
|-------|---------------|----------------|----------------|
| 1 | 0 | 1× | 1400 ms |
| 2 | 200 | 1.15× | 1310 ms |
| 3 | 400 | 1.30× | 1220 ms |
| 4 | 600 | 1.45× | 1130 ms |
| … | … | +0.15× per level | −90 ms per level (min 350 ms) |

A **"LEVEL UP!"** banner flashes on screen and the level badge pulses on every promotion.

---

## Project Structure

```
space-dodger/
├── index.html   — HTML shell: canvases, HUD overlay, all screen panels
├── style.css    — All styling: design tokens, glassmorphism, animations, responsive layout
└── script.js    — All game logic (7 classes, ~1 000 lines, no dependencies)
```

### JavaScript Architecture (`script.js`)

|     Class          | Responsibility 
|--------------------|---------------
| `AudioManager`     | Web Audio API synthesis — tones, noise, ambient drone 
| `StarfieldManager` | Animated parallax star background on a dedicated canvas 
| `Particle`         | Single particle with velocity, drag, gravity, and fade 
| `ParticleSystem`   | Pool of particles; manages explosion bursts and engine trails 
| `Asteroid`         | Procedural rock entity with irregular polygon shape and craters 
| `PowerUp`          | Collectible orb with pulsing glow and type-specific behaviour 
| `Ship`             | Player entity — movement, thrust flame, shield ring, collision 
| `Game`             | Master controller: state machine, game loop (`requestAnimationFrame`), spawning, HUD, persistence 

---

## Technical Details

- **Rendering:** Two layered `<canvas>` elements — one for the starfield (full viewport), one for game entities (fixed logical resolution 480 × 760, scaled via CSS).
- **Game loop:** `requestAnimationFrame` with delta-time capped at 50 ms to prevent spiral-of-death on tab blur.
- **Collision:** Circle–circle for ship vs asteroid; AABB for ship vs power-up.
- **Audio:** Fully synthesised using `OscillatorNode`, `GainNode`, `BiquadFilterNode`, and `AudioBufferSourceNode`. No audio files are loaded.
- **Persistence:** `localStorage` keys `sd_highScore`, `sd_gamesPlayed`, `sd_bestTime`.
- **Fonts:** Orbitron (display) + Inter (body) loaded from Google Fonts.

---

## Browser Support

|          Browser       |   Supported    |
|------------------------|----------------|
| Chrome / Edge 90+      | ✅            |
| Firefox 88+            | ✅            |
| Safari 15+             | ✅            |
| Mobile Chrome / Safari | ✅            |
| Internet Explorer      | ❌            |

Requires support for: `Canvas 2D API`, `Web Audio API`, `requestAnimationFrame`, `localStorage`, CSS `backdrop-filter`.