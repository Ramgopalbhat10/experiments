# Rainier Explorer

A Firewatch-inspired hiking game set in **Mount Rainier National Park**, built with three.js. It covers about 41 × 41 km of real terrain around the mountain: glaciers, alpine lakes, waterfalls, trails, fire lookouts and fall colour. You can play in third or first person, carry hiking gear, make camp, cook, listen to the radio and stargaze.


## Run it

There's no build step: it's plain ES modules, and three.js loads from a CDN through an import map.

```bash
# from the repository root
python3 -m http.server 8000
# then open http://localhost:8000/mount-rainier-explorer/
```

Any static file server works. Options go in the URL:

| Param | Example | Effect |
|---|---|---|
| `at` | `?at=reflection` | Start at a place id (see `src/data/places.js`) |
| `t` | `?t=6.5` | Start time of day (hours) |
| `season` | `?season=summer` | `summer`, `autumn` (default) or `winter` |
| `q` | `?q=high` | Graphics: `low`, `medium`, `high` |
| `stats` | `?stats` | Show fps / draw calls |

## Controls

| Key | Action |
|---|---|
| WASD / arrows, Shift, Space | Walk, run, jump |
| Mouse (click to lock) | Look |
| **V** | First / third person |
| **1–8** or wheel (first person) | Gear: hands, map, compass, radio, camera, binoculars, flashlight, trekking poles |
| Left click | Use held gear (unfold map, radio on/off, photo, binoculars, flashlight) |
| Right mouse | Look through binoculars; the rangefinder shows distance, elevation and what you're looking at |
| **C** / **E** | Make camp / camp menu: light the fire, cook, sleep, stargaze, pack up |
| **G** | Lie back and stargaze (**X** toggles constellation lines) |
| **K** / **N** | Radio music on/off / next track |
| **L** | Flashlight |
| **F** | Fast-travel walking speed |
| **M** / **J** | Paper map (click a place to travel there) / places journal |
| **P** | Photo (click it to download) |
| **[ ]**, **T** | Nudge the clock / time-lapse |
| **U** | Hide HUD |

Gamepads and touch screens (virtual joystick) also work.

## What's in it

**World (real data)**
- Terrain from USGS 3DEP elevation (20 m grid), drawn as a geometry-clipmap LOD with bicubic heights, CDLOD morphing and skirts. You can see the whole mountain from anywhere in the park.
- Land cover (forest, meadow, rock, snow) classified from Sentinel‑2 imagery. Glaciers, lakes, rivers, trails, roads, buildings and waterfalls come from OpenStreetMap.
- 350+ lakes sit at their surveyed levels with shallow shores. The nearest lake gets a real planar reflection, so Reflection Lakes and Tipsoo mirror the mountain.
- 90+ named waterfalls with animated sheets and mist, fire lookouts (Tolmie, Fremont, Gobblers Knob, Shriner, High Rock) whose windows glow at night, and OSM buildings (Paradise Inn, Longmire, Sunrise).
- 45 curated destinations with descriptions, discovery tracking, and a ranger on the radio with a line about each one.

**Look (after Firewatch)**
- Canvas-painted foliage textures: conifers built from drooping branch cards with soft canopy shading, painted impostors in the distance, windblown grass, fireweed and lupine, and huckleberry and vine maple that turn crimson in autumn.
- A sky with a teal-to-tangerine gradient, posterized clouds and god rays. Height fog blends into the horizon, and a baked terrain shadow lets the mountain cast shadows for kilometres at sunset.
- Faceted boulders and cliffs, snags, fallen logs, glacier crevasses and debris-covered snouts.
- Real night sky: bright-star catalogue and constellations rotated by local sidereal time for the in-game date, plus a Milky Way along the true galactic plane.

**Play**
- First-person hands holding each item: an orange walkie-talkie with an LCD, a compass with a live needle, the topo map showing where you are, a disposable camera, binoculars, a flashlight and trekking poles.
- Energy drains as you hike and comes back from cooking (coffee, huckleberry oatmeal, chili, s'mores and more) and sleep.
- Camp anywhere flat: dome tent, stone fire ring with flames, embers, smoke and flickering light, plus a stove with a steaming pot.
- The radio plays procedural fingerpicked guitar in five tracks (Karplus–Strong strings, no audio files). There's also procedural wind, water, birdsong, marmots and footsteps.

## Project layout

```
index.html            HUD, panels, import map
src/main.js           boot, renderer, frame loop
src/world/            heightfield, terrain (clipmap), atmosphere, sky, stars,
                      foliage + vegetation, paths, water, waterfalls, structures
src/player/           character, controller (3rd/1st person, stargazing)
src/gameplay/         game (gear, energy, radio, camp menu), camp, viewmodel (hands)
src/ui/               HUD, paper map
src/data/             places, radio lines
src/audio.js          ambience + radio music
src/post.js           HDR grade, bloom, god rays, binocular mask
tools/build_data.py   bakes assets/ from the source datasets
assets/               terrain.png, landcover.png, features.json
```

## Rebuilding the data

```bash
pip install numpy pillow
python3 tools/build_data.py     # downloads tiles into tools/.cache, writes assets/
```

`terrain.png` stores elevation in decimetres across the R/G channels, with flags (lake, river, road, glacier) in B. `landcover.png` holds forest, meadow and snow in R/G/B. `features.json` holds vectors in local metres (x east, z south), with the origin at 46.845°N, 121.715°W.

## Attribution

- Elevation: USGS 3DEP via [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
- Land cover derived from [Sentinel‑2 cloudless 2016](https://s2maps.eu) by EOX IT Services GmbH (CC BY 4.0), which contains modified Copernicus Sentinel data (2016)
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- The art direction is inspired by *Firewatch* (Campo Santo). This is a fan experiment, and every model, texture and sound is generated procedurally.
