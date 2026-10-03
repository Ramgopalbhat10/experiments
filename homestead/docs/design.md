# Homestead — proposed game design

Build a complete home in a first-person Three.js sandbox. The project lives in its own `homestead` folder and runs independently of other repository projects.

## First playable version

A landscaped plot with a starter foundation and optional furnished example house lets the player build immediately. A warm daylight scene, shadows, textured materials, detailed procedural objects, and a restrained translucent HUD give the game a realistic architectural feel.

Mouse look and WASD movement use pointer lock. Escape releases the cursor for menus. A visible help overlay explains movement, placement, rotation, removal, and saving. A responsive catalog remains usable at smaller screen sizes; desktop keyboard and mouse are the primary gameplay controls.

A Fortnite-inspired numbered toolbar selects floors, walls, window walls, doorways, roofs, stairs, and catalog objects. A translucent placement preview shows snapped position, orientation, and whether placement is valid. Structural pieces snap to a consistent module size; furniture and plants use a finer grid. Rotation, cancellation, object removal, and undo make building reversible. Structural height can be adjusted to build more than one level.

The catalog covers foundations, several wall finishes, doors, windows, floors, roofs, stairs, sofas, tables, chairs, beds, cabinets, kitchen counters, bathroom fixtures, lights, rugs, paintings, planters, trees, shrubs, fencing, and paths. Each category has representative detailed objects rather than an unlimited asset collection. Material presets and color swatches customize compatible pieces. Paint applies to existing selected objects as well as newly placed pieces.

Projects save automatically to local storage and can be exported and imported as JSON. A deliberate reset action restores the starting plot. There is no account, backend, multiplayer, resource grind, or structural engineering simulation in this version.

## Architecture

Use JavaScript, Three.js, and Vite, with plain HTML/CSS for the HUD. Modules separate rendering and world setup, player movement, the object catalog and factories, placement and selection, project persistence, and UI. Procedural geometry and reusable textured materials avoid a dependency on external model services. Shared geometry and materials keep the scene affordable to render.

World state contains stable object IDs, catalog item keys, transforms, material choices, and a save schema version. Rendered objects are derived from this state. Imported saves are validated before replacing the current project; malformed saves show a readable error and preserve existing work. A WebGL failure displays a useful fallback message.

## Gameplay details and limits

The player has unlimited items. Placement is limited to the plot and rejects duplicate structural placements. Ground and floor collision keep walking natural; stairs or a build-height control allow upper-floor construction. Furniture can be moved by selecting and replacing it. Lighting is primarily daylight with modest emissive fixtures; photorealism and physically accurate plumbing, electrical systems, or construction sequencing are outside the first version.

## Verification

Verify a production build and browser startup without console errors. Exercise pointer lock, movement, category selection, material changes, snapped placement, rotation, removal, undo, save reload, export/import, invalid import handling, and reset. Inspect the initial view and HUD at desktop and narrow viewport widths. Check a complete floor/walls/door/windows/roof assembly and furnished garden scene before calling the playable version complete.

## Proposed implementation sequence

1. Scaffold the isolated project and render the landscaped plot with a polished initial HUD.
2. Implement first-person controls, object selection, snapping, previews, and structural construction.
3. Add detailed catalog factories, material/color controls, interiors, and gardening.
4. Add undo, persistence, import/export, help, and responsive refinements.
5. Run the build and browser interaction checks and document launch instructions.

This design was approved in chat. Implementation and verification are tracked in `implementation-plan.md` and `progress.md`.
