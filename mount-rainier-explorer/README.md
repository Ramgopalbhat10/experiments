# Rainier Explorer

A Firewatch-inspired hiking game set in **Mount Rainier National Park**, built with three.js. It covers about 41 × 41 km of real terrain around the mountain: glaciers, alpine lakes, waterfalls, trails, fire lookouts and fall colour. You see the park through the hiker's eyes (third person is one key away), carry hiking gear, make camp, cook, listen to the radio and stargaze.


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
| `ao` | `?ao=0` | Turn ambient occlusion off |
| `view` | `?view=third` | Start behind the hiker instead of first person |
| `detail`, `props`, `sat` | `?props=0` | Turn off the scanned ground textures, the scanned models and photo foliage, or the satellite colour |
| `shafts` | `?shafts=2` | Light-shaft strength (`0` turns them off) |
| `puffs` | `?puffs=1` | Add the cumulus billboards around the summit |

## Controls

| Key | Action |
|---|---|
| WASD / arrows, Shift, Space | Walk, run, jump |
| Mouse (click to lock) | Look |
| **V** | Third / first person (first person is the default) |
| **1–8** or wheel (first person) | Gear: hands, map, compass, radio, camera, binoculars, flashlight, trekking poles |
| Left click | Use held gear (unfold map, radio on/off, photo, binoculars, flashlight) |
| Right mouse | Look through binoculars; the rangefinder shows distance, elevation and what you're looking at |
| **C** / **E** | Make camp / camp menu: light the fire, cook, sleep, stargaze, pack up |
| **G** | Lie back and stargaze (**X** toggles constellation lines) |
| **Enter** | Radio the ranger in plain words (needs a Jev key, see below) |
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

**Matched to the real place**
- Fall colour follows the real ecology. Huckleberry, heather and mountain ash grow thickest along the trails through the subalpine band (about 1,350–1,950 m), with grassy openings between them. Lower down the meadows turn vine-maple gold, and higher up they give way to cured grass, pumice and rubble, as at Sunrise. Near and mid-distance shrubs and the far terrain share one colour function, so the hand-off is seamless.
- Distant peaks read as brown and grey andesite, with talus streaked down the fall line, rust staining, and individual stones close up. Far meadows are muted to rust and olive rather than saturated patches.
- Dense subalpine fir and mountain hemlock "tree islands" on a 4 m placement grid, plus lone firs standing in the meadows, as at Paradise and Spray Park. Conifers use three LODs: full branch sprays, a lighter mid-distance mesh, and impostors.
- Named waterfalls are set pieces: a gorge carved into the terrain, a craggy face of broken andesite ledges (wet and dark where the water runs, mossy on the ledges), thin strands dropping ledge to ledge, a plunge pool, and a footbridge wherever a trail crosses above the lip (Myrtle Falls under the Skyline Trail bridge).
- Paved trails (the Skyline loop) are weathered asphalt with stone edges and post-and-rope lines; dirt trails have packed tread and edge rocks.
- OSM buildings have stone foundations, plank siding, fascia boards, stone chimneys, varied window rows (sky reflected in the glass, warm light at night) and shingled roofs.
- Lakes have shelving shores, boulders and sedges at the waterline. You arrive on a low shore with open water toward the mountain.
- The sky is a September-afternoon blue with high cirrus. The high cone is dark reddish andesite against the glaciers.
- By default you start at the Myrtle Falls viewpoint at 3:30 PM in autumn.

**Look (photo-real materials)**
- Photo-scanned models from Poly Haven (CC0): mossy and grey boulders, rock faces, ferns, stumps, fallen trunks and branches, and small plants, simplified to three levels of detail and placed by the same ecology rules (ferns carpet the low forest, pebbles thicken on thin alpine soils).
- Conifers are built from branch sprays baked from a scanned fir sapling's real needles: Douglas fir with open crowns and dead lower limbs, drooping hemlocks, and narrow subalpine fir spires, with bark-textured trunks, mid-distance meshes and impostors rendered from the same trees.
- Huckleberry, vine maple and deciduous crowns use leaf clumps baked from a scanned shrub; the season's palette colours the real leaves (crimson huckleberry, gold vine maple).
- Ground, trails, roads and buildings use scanned textures (grass, forest floor, cliff, talus, snow, gravel; plank siding, stone, shingles). Beyond the near field the ground takes its colour from Sentinel‑2 imagery with the satellite's own shading divided out.
- A filmic grade (fitted ACES, teal shadows, amber highlights), valley mist that pools in low ground, and volumetric light shafts marched through the sun's shadow map. Height fog blends into the horizon, and a baked terrain shadow lets the mountain cast shadows for kilometres at sunset.
- Glacier crevasses and debris-covered snouts, snags, and a weathered-rock shader on the waterfall ledges.
- Screen-space ambient occlusion (depth only, half resolution, medium and high quality) grounds shrubs, trees and rocks. Conifers are self-shadowed inside the crown.
- Real night sky: bright-star catalogue and constellations rotated by local sidereal time for the in-game date, plus a Milky Way along the true galactic plane.

**Play**
- First-person hands holding each item: an orange walkie-talkie with an LCD, a compass with a live needle, the topo map showing where you are, a disposable camera, binoculars, a flashlight and trekking poles.
- Energy drains as you hike and comes back from cooking (coffee, huckleberry oatmeal, chili, s'mores and more) and sleep.
- Camp anywhere flat: dome tent, stone fire ring with flames, embers, smoke and flickering light, plus a stove with a steaming pot.
- The radio plays procedural fingerpicked guitar in five tracks (Karplus–Strong strings, no audio files). There's also procedural wind, water, birdsong, marmots and footsteps.

## Talk to the ranger (Jev)

The ranger on the radio can be driven by [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe's "System One" decision model, available through OpenRouter. Jev doesn't write text. It reads the game state plus typed questions and returns typed answers with probabilities in one fast call (typically 70–500 ms), so every word the ranger says is still hand-written.

Open **Settings (O)**, paste your OpenRouter key under **Ranger AI · Jev key**, then press **Test**. The key is stored only in your browser (localStorage) and sent only to `openrouter.ai`. Once a key is set:

- **Press Enter to radio the ranger in plain words.** For example: "take me somewhere with a lake at sunset", "where should I go for fall colour?" then "take me there", "skip to night", "switch to winter", "make camp", "hand me the binoculars", "what am I looking at?". One Jev call turns the message into:
  - an intent: travel, recommend, time, season, camp, stargaze, gear, info or small talk
  - a destination (one of the 45 places)
  - a time of day, a season, a piece of gear, and a reply type

  The game then acts on the answer. If Jev isn't confident, the ranger asks you to say again.
- **The chatter reacts to what you're doing.** The game samples the state every 2 s and notes events such as a sunset, making camp, low energy or reaching snow. After an event, or during a long quiet stretch, one Jev call decides whether the ranger should speak at all. It also picks the best of 50 hand-written lines ([`src/data/ranger.js`](src/data/ranger.js)).

A command call is about 3k input tokens (about $0.0001); a chatter call is about 1.2k. Output tokens are free. Without a key, the radio falls back to the stock lines and nothing is sent anywhere. The Decisions endpoint is alpha, so everything that knows its shape lives in [`src/gameplay/jev.js`](src/gameplay/jev.js).

## Launch trailer

Open `?trailer` (or click **Watch the trailer** on the title screen) and press **Play trailer**. The game goes fullscreen, pre-loads every location for a few seconds, and then plays a one-minute launch trailer live:

- 14 scripted camera moves (Paradise, Myrtle Falls, the Skyline Trail, Glacier Vista, Sunrise, Eunice and Louise lakes, Fremont Lookout at sunset, first-person gameplay, camp, stars and a Reflection Lakes finale)
- titles and location labels
- an original score, with every cut on the beat

**To record it:** start your screen recorder (QuickTime: *File › New Screen Recording*; OBS: *Display Capture* at 60 fps), then press Play trailer. `?trailer` runs on high quality by default, and `?trailer&q=medium` suits slower laptops. Press Esc to stop.

On a machine without a GPU, [`tools/trailer`](tools/trailer) renders the same shot list offline, frame by frame, through the game's `?cine` mode:

```sh
cd tools/trailer
python3 score.py                                   # 60 s score -> score.wav
node render.js frames 1600 900 24 all              # frames/<shot>/NNNN.png (slow without a GPU)
python3 compose.py frames rainier_trailer.mp4      # titles, edit, H.264 + AAC at 1080p
```

## Project layout

```
index.html            HUD, panels, import map
src/main.js           boot, renderer, frame loop
src/world/            heightfield, terrain (clipmap), atmosphere, sky, stars,
                      foliage + vegetation, paths, water, waterfalls, structures
src/player/           character, controller (3rd/1st person, stargazing)
src/gameplay/         game (gear, energy, radio, camp menu), camp, viewmodel (hands),
                      ranger + jev (the Jev-powered radio)
src/ui/               HUD, paper map
src/data/             places, radio lines, ranger line library
src/audio.js          ambience + radio music
src/post.js           HDR grade, SSAO, bloom, god rays, volumetric light shafts
                      (shadow-map ray march), binocular mask
src/trailer/          ?trailer: shot list, live player and title overlay
tools/build_data.py   bakes assets/ from the source datasets
tools/trailer/        offline trailer render, score synthesis, edit/encode
assets/               terrain.png, landcover.png, features.json, satellite.webp, trailer-score.mp3,
                      tex/ (scanned ground maps, baked fir and leaf cards),
                      models/ (scanned rock and forest-floor packs + their textures)
tools/assets/         Poly Haven fetch, model simplification, foliage card baking
```

## Rebuilding the data

```bash
pip install numpy pillow
python3 tools/build_data.py     # downloads tiles into tools/.cache, writes assets/
```

The photo-real assets are rebuilt from Poly Haven downloads:

```bash
cd tools/assets && npm install
python3 fetch_polyhaven.py        # CC0 scans into tools/.cache/polyhaven
node build_models.mjs             # assets/models/*.json (glTF: split, simplified to LODs, meshopt)
python3 build_textures.py         # assets/models/tex/*.webp
node bake/bake_cards.mjs && python3 bake/pack_cards.py   # fir and leaf card atlases
python3 ../build_satellite.py     # assets/satellite.webp from the Sentinel-2 tiles
```

`terrain.png` stores elevation in decimetres across the R/G channels, with flags (lake, river, road, glacier) in B. `landcover.png` holds forest, meadow and snow in R/G/B. `features.json` holds vectors in local metres (x east, z south), with the origin at 46.845°N, 121.715°W.

## Attribution

- Elevation: USGS 3DEP via [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
- Land cover derived from [Sentinel‑2 cloudless 2016](https://s2maps.eu) by EOX IT Services GmbH (CC BY 4.0), which contains modified Copernicus Sentinel data (2016)
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- Photo-scanned textures and models from [Poly Haven](https://polyhaven.com) (CC0). Textures: withered_grass, forrest_ground_01, cliff_side, aerial_rocks_02, rocky_trail, snow_02, river_small_rocks, pine_bark, weathered_plank_siding, rustic_stone_wall_02, grey_roof_01. Models: rock_moss_set_01, rock_moss_set_02, boulder_01, rock_face_01, rock_face_02, namaqualand_boulder_03, fern_02, tree_stump_01, dead_tree_trunk, dead_tree_trunk_02, dry_branches_medium_01, shrub_04; the fir and leaf cards are baked from fir_sapling and shrub_04.
- Terrain colour from [Sentinel‑2 cloudless 2016](https://s2maps.eu) by EOX IT Services GmbH (CC BY 4.0), contains modified Copernicus Sentinel data (2016).
- The first art direction was inspired by *Firewatch* (Campo Santo). This is a fan experiment. Apart from the Poly Haven scans and the satellite imagery, every model, texture and sound is generated procedurally.
