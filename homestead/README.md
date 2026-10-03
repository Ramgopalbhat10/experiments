# Homestead

A first-person home-building sandbox made with Three.js. Explore the furnished Cedar House, or start with an empty plot and build your own home.

## Run

Requires Node.js 20.19+ or 22.12+ and a desktop browser with WebGL.

```sh
cd homestead
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

```sh
npm run build
npm run preview
```

The production output is in `dist/`. All game assets and fonts are local; the running game has no external asset requests.

## Play

- Click **Walk around**, then use **WASD** and the mouse. **Shift** runs, **Space** jumps, **Escape** releases the cursor.
- Outside Walk mode, right-drag on the world to look around. Click the ground to place the active piece.
- Select catalog pieces or use **1–8** for quick building selections. **R** rotates 90°. **Page Up / Down** changes the building level; the HUD also has level buttons.
- Structural pieces use a 3 m module; furniture uses a 0.25 m grid. Walls align with floor edges. Roofs are placed 3 m above the active floor.
- Use **V / Select** and click a piece to customize, move, or remove it. Choose a material and color, then click **Finish** in the selected-object panel. **P / Paint** applies the current finish directly to clicked objects. Some decorative surfaces keep their original appearance.
- Aim at a wall to hang a painting; it aligns with the surface automatically. Rugs and furniture rest on floor surfaces at every building level.
- **Ctrl / Command + Z** undoes changes. **Delete** removes a selected item. **B** toggles the catalog. **/** focuses catalog search.
- In the project menu (**•••**), export/import JSON, start an empty plot, or restore the example house. Reset actions ask for confirmation and can be undone.

The catalog has 43 pieces across construction, living, kitchen, bedroom, bathroom, décor, and gardening. It includes flat and pitched roofs, stairs, doors, windows, furniture, fixtures, paintings, rugs, plants, fencing, and a pergola. Five finishes and preset/custom colors customize compatible surfaces. Daylight and golden-hour lighting are available.

Projects autosave to this browser's local storage. Export a JSON copy to move between devices or retain separate homes. The plot is 42 × 42 m, with ground and two upper building levels and a 2,000-item limit. The scene combines detailed CC0 furniture models with procedural construction pieces and simplified collision. PBR texture maps, HDR reflections, contact occlusion, warm fixtures, and antialiasing improve close-up detail. Desktop keyboard/mouse controls are the primary supported gameplay; the catalog and menus also adapt to narrow screens.

## Verify

```sh
npm test
npm run build
```

Browser interaction checks require Chromium and the dev server:

```sh
npm run dev -- --port 5173
# In another terminal:
CHROME_PATH=/usr/bin/chromium npm run test:browser
```

`GAME_URL` changes the test URL. Browser tests cover real UI placement, selection, finish application, move/remove/undo, save reload, import/export, malformed imports, pointer-lock walking, and narrow-screen controls. They write screenshots into ignored `test-artifacts/`.

## Structure

`catalog.js` defines items and finishes; `project.js` validates state and handles undo; `objects.js` builds and batches catalog geometry; `models.js` loads detailed furniture assets; `world.js` sets up the landscape and lighting; `player.js` handles movement; `building.js` handles editing and placement; `ui.js` connects the HUD; `main.js` wires the app and persistence.

Three.js and Vite are used under their respective licenses. Local DM Sans and Libre Caslon Display fonts are distributed under the SIL Open Font License, included in `public/fonts/`.

Furniture, foliage, photographed PBR maps, and the HDR sky are locally bundled CC0 assets from Poly Haven. See [asset credits](public/ASSET-CREDITS.md). Models are downloaded with the app; gameplay requires no external asset services.
