# Artin Strike

Tactical CS-style bomb-defusal FPS vs AI bots: raycast engine, economy, buy menu, WebAudio gunshots. Canvas, no dependencies

## Map

A recreation of the classic **de_dust2** layout on a 48×40 tile grid — T spawn (south), mid with the double doors, catwalk/short, long A with the pit, upper/lower tunnels, and the A/B bomb sites (CT spawn north-center, A north-east, B north-west), dressed in a procedural desert palette: sandstone and tan-plaster walls, dusty sand floor, hazy sky.

## Features

- Wolfenstein-style raycasting engine on canvas: DDA wall casting with half-resolution textured floor/ceiling casting and distance shading, procedurally generated textures (sandstone / plaster / crate), distance fog, per-column z-buffered billboard sprites
- First-person weapon viewmodel: procedural per-weapon gun rendered lower-right with walk bob, recoil kick, reload, weapon-switch and grenade-throw animations, muzzle flash, AWP scope overlay
- CS-style radar (top-left): player-centered circular radar with teammates, spotted enemies and the bomb blip
- Bomb defusal mode, 4v4: Terrorist bots pick site A or B, escort the carrier, plant the bomb, and guard it; Counter-Terrorist bots split defense, rotate on plant, and defuse. Hold **E** to plant (T) or defuse (CT)
- **Halftime side swap**: you play the first half as CT, then swap to Terrorist after round 5 — carry the bomb (optional toggle), walk it to a site and plant while CT bots hunt the defuse. Scoreboard tracks both halves, HUD shows your current side, match result and career stats aggregate your two halves
- Freeze time at round start (~5s, weapons and movement locked, buy menu open), round-end reason banners ("Bomb defused" / "Target bombed" / "Elimination"), and a short post-round pause
- CS-style economy: $800 start, $300 per kill, $3250 win, escalating loss-streak bonus ($1900 + $500 per consecutive loss), $800 plant bonus for the T side even on a lost round
- Grouped buy menu — Pistols (P250, Desert Eagle $700), Rifles (AK-47 $2700, M4A4 $3100), Sniper (AWP $4750: bolt-action, one-shot body kill, RMB scope with zoomed FOV), Gear (kevlar, defuse kit, grenades, ammo)
- Grenades (key **4** or **G** to cycle, LMB to throw): flashbang $200 (screen whiteout scaled by view angle and distance, bots caught in radius/LOS spray blind), smoke $300 (plume blocks raycast sprite visibility and bot vision for ~15s), HE $300 (radius damage with falloff). Bots flash sites before entering and lob flash/HE at range
- Six weapons: knife, P250, Desert Eagle, AK-47 (full-auto), M4A4, AWP — with distinct damage, falloff, fire rate, magazine, reload, price and move-speed factors, recoil kick, spread bloom that grows under sustained fire and movement
- Bot AI: BFS grid pathfinding with string-pulling and stuck recovery, patrol/hunt/engage states, reaction times, burst fire with strafing, aim that tightens the longer they track you, gunfire-noise investigation, flashbang blindness
- Full game chrome: round timer, match score (first to 6, sides swap at the half), kill feed, Tab scoreboard with per-half scores, live minimap with bomb sites / teammates / enemy fire blips, hitmarkers, damage vignette, round banners, spectate-a-teammate cam when you die
- All sound synthesized with Web Audio (per-weapon gunshots, reloads, AWP bolt, grenade pins/bounces/pops, flashbang ring, bomb beeps that accelerate, explosion, round stingers) — zero audio files
- Career stats (matches W/L, best score) and mouse sensitivity persisted in localStorage

## Run

Open index.html in any modern browser. No build step, no dependencies.

## Controls

- **WASD** move · **Shift** walk (slower, tighter spread) · **Mouse** aim (pointer lock)
- **LMB** fire / throw grenade · **RMB** AWP scope · **R** reload · **1/2/3** primary / pistol / knife · **4/G** cycle grenades
- **B** buy menu (during freeze time) · **E** plant (T) / defuse (CT, hold near the bomb) · **Tab** scoreboard
- **Esc** releases the mouse and pauses

## Tech notes

- The renderer casts one ray per 2px screen column into a tile grid, textures each wall slice from offscreen canvases generated at boot, then draws enemies as depth-sorted billboards clipped against the per-column z-buffer — no WebGL, no assets
- Bots navigate a recreation of the de_dust2 layout (48×40 tiles) with BFS over the tile grid; paths are smoothed by greedily skipping to the furthest waypoint with line-of-sight, and bots repath when body-blocked
- Combat is hitscan: ray-vs-circle against enemies, clipped by a DDA wall cast, so cover genuinely blocks shots for both you and the bots
- Recoil is modeled as a yaw kick that decays exponentially plus a bloom term feeding both the shot cone and the CSS crosshair gap

## Roadmap

- Headshot hitbox (aim-height check) with damage multiplier
- Bot difficulty tiers (reaction time, aim error, aggression sliders)
- Touch controls: virtual stick + drag-look for mobile play
- Proper overtime on a draw
