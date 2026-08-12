# Artin Strike

Tactical CS-style bomb-defusal FPS vs AI bots: raycast engine, economy, buy menu, WebAudio gunshots. Canvas, no dependencies

## Map

A recreation of the classic **de_dust2** layout on a 48×40 tile grid — T spawn (south), mid with the double doors, catwalk/short, long A with the pit, upper/lower tunnels, and the A/B bomb sites (CT spawn north-center, A north-east, B north-west), dressed in a procedural desert palette: sandstone and tan-plaster walls, dusty sand floor, hazy sky.

## Features

- Wolfenstein-style raycasting engine on canvas: DDA wall casting with half-resolution textured floor/ceiling casting and distance shading, procedurally generated textures (sandstone / plaster / crate), distance fog, per-column z-buffered billboard sprites
- First-person weapon viewmodel: procedural per-weapon gun rendered lower-right with walk bob, recoil kick, reload and weapon-switch animations, muzzle flash
- CS-style radar (top-left): player-centered circular radar with teammates, spotted enemies and the bomb blip
- Bomb defusal mode, 4v4: Terrorist bots pick site A or B, escort the carrier, plant the bomb, and guard it; Counter-Terrorist bots split defense, rotate on plant, and defuse. You play CT — hold **E** to defuse
- Buy menu with CS-style economy: $800 start, $300 per kill, $3250 win / $1900 loss, buy phase each round. AK-47, P250, kevlar armor (absorbs 40%), defuse kit (halves defuse time), ammo refills
- Three weapons: rifle (full-auto), pistol (semi), knife — with recoil kick, spread bloom that grows under sustained fire and movement, reloads, range damage falloff
- Bot AI: BFS grid pathfinding with string-pulling and stuck recovery, patrol/hunt/engage states, reaction times, burst fire with strafing, aim that tightens the longer they track you, gunfire-noise investigation
- Full game chrome: round timer, match score (first to 6), kill feed, Tab scoreboard, live minimap with bomb sites / teammates / enemy fire blips, hitmarkers, damage vignette, round banners, spectate-a-teammate cam when you die
- All sound synthesized with Web Audio (gunshots, reloads, bomb beeps that accelerate, explosion, round stingers) — zero audio files
- Career stats (matches W/L, best score) and mouse sensitivity persisted in localStorage

## Run

Open index.html in any modern browser. No build step, no dependencies.

## Controls

- **WASD** move · **Shift** walk (slower, tighter spread) · **Mouse** aim (pointer lock)
- **LMB** fire · **R** reload · **1/2/3** rifle / pistol / knife
- **B** buy menu (during buy phase) · **E** defuse (hold, near the bomb) · **Tab** scoreboard
- **Esc** releases the mouse and pauses

## Tech notes

- The renderer casts one ray per 2px screen column into a tile grid, textures each wall slice from offscreen canvases generated at boot, then draws enemies as depth-sorted billboards clipped against the per-column z-buffer — no WebGL, no assets
- Bots navigate a recreation of the de_dust2 layout (48×40 tiles) with BFS over the tile grid; paths are smoothed by greedily skipping to the furthest waypoint with line-of-sight, and bots repath when body-blocked
- Combat is hitscan: ray-vs-circle against enemies, clipped by a DDA wall cast, so cover genuinely blocks shots for both you and the bots
- Recoil is modeled as a yaw kick that decays exponentially plus a bloom term feeding both the shot cone and the CSS crosshair gap

## Roadmap

- Headshot hitbox (aim-height check) with damage multiplier
- Half-time team swap: play a half as the Terrorists planting the bomb
- Flashbang / smoke grenades with line-of-sight and occlusion effects
- Bot difficulty tiers (reaction time, aim error, aggression sliders)
- Touch controls: virtual stick + drag-look for mobile play
- Loss-streak bonus economy and proper overtime on a draw
