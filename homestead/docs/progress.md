# Homestead implementation ledger

Plan: `docs/implementation-plan.md`. Spec approved in chat.

Pre-flight: Catalog keys are shared by state, factories, import validation, and UI. Positions use meters; structural module is 3m. Records: id, item, position [x,y,z], rotation (radians), finish, color.

Execution: Inline in the existing `work` branch, confined to the requested new project folder. User's instruction to start implementation supersedes additional workflow approval gates. Decorative geometry is verified visually; meaningful state behavior is tested.

Task 1: complete — validated state, snapping, structural slots, history, and safe import. Node suite includes plot-footprint and malformed-save cases.
Task 2: complete — 43 procedural catalog objects, furnished example home, textured landscape, sunlight/shadows, local fonts, and generated catalog previews.
Task 3: implemented — first-person movement, construction, selection/paint/move/remove, undo, HUD, search, finishes, persistence, export/import, confirmation dialogs, level/grid/lighting controls.
Task 4: complete — production build passes; full browser interaction pass succeeds with no console errors; desktop and narrow screenshots inspected; README includes launch commands and controls.

Verification findings: start camera was obscured by a tree; moved spawn into an open sightline. Batched geometry reduces draw calls; mixed indexed/rounded geometry needed normalization, covered by a failing-then-passing regression test. Escape explicitly releases pointer lock. Imported overlapping structure slots and rotated footprints now have failing-then-passing state tests.

Scope decisions: Three build levels (ground + two upper levels), roofs up to 9 m. Representative procedural objects and simplified collision satisfy the sandbox scope; physically accurate engineering and photorealistic asset libraries remain outside this version. No publishing, push, or merge performed.

Independent review: Three Important issues (roof movement height, upper-level support/stair transitions, rugs below floor surfaces) fixed with regression tests observed failing then passing. The 320 px catalog-close overlap was also corrected. Painting placement now mounts to the targeted wall, covered by another failing-then-passing regression test. The HUD reflects the actual mode after moving pieces.

Final automated suite: 15/15 tests pass. Production build passes. Final browser pass after wall-mount refinement completes every interaction group with no console errors. Vite reports its standard size advisory for the 513 kB Three.js dependency chunk (131 kB gzip); the app code is a separate 72 kB chunk (26 kB gzip).

Browser test correction: Vite's HTML can give the entry module a timestamp URL. Tests now import that exact entry URL for movement inspection, avoiding creation of a second app instance. Real player movement and Escape key clearing were then verified successfully.

The movement wait also uses a synchronous predicate with a handle to the real game, because Playwright treats an async predicate's Promise as truthy before the position has changed. Final browser exit code: 0. No deferred review findings. Source changes remain in the requested folder on the existing branch; the development server is available on port 5173.

## User-requested realism refinement

Completed: six locally bundled CC0 model sources for seating, tables, indoor plants, garden trees and shrubs; PBR texture sets; HDR environment reflections; balanced sunlight and warm fixture lights; contact occlusion and antialiasing; recessed cabinets, open sink/tub cavities, curved faucets, hob details, draped bedding, plank floors, textured artwork and planter joinery. Starter layout separates kitchen/bathroom and faces seating toward its table/TV. Asset licenses are bundled in `public/ASSET-CREDITS.md`.

Optimization: source tree reduced to 12,702 triangles; two rotated copies of its 5,818-triangle leaf primitive fill the canopy, giving 24,338 triangles per tree. Indoor plant reduced from 176,226 to 58,286 triangles; shrub reduced from 27,327 to 4,098. Model textures recompressed locally while preserving normal and roughness maps. Half-resolution SSAO excludes alpha foliage and transparent glass. Fixtures are limited to eight realtime lights.

Verification after final refinement: 15/15 Node tests pass; production build passes; full Chromium browser interaction suite passes with no console errors, including placement, duplicate rejection, selection, paint, move/remove/undo, persistence, import/export, walking, Escape, levels, grid, lighting and narrow-screen controls. Browser timeout accommodates cloud software WebGL shader compilation. Independent review found no Critical or Important lifecycle/batching defects. Actual screenshots are in `screenshots/realism/`. Updated runnable preview and full source/build archives are in `/workspace`. No publish, push or merge performed.

## Performance and realism upgrade (2026-10-03)

All upgrade acceptance tasks are complete on `feature/homestead-performance-realism`, starting from merged main `deb3f1b`. Verification:78/78 Node tests, production build, original gameplay browser suite, extended progressive/instance suite and7 render/quality/lighting checks pass. Five final captures inspected; all43 previews regenerated. Independent final review found no remaining actionable bugs. See [measured report](performance-report.md) and [execution ledger](superpowers/upgrade-ledger.md) for fixes, benchmarks and hardware limits. Software GPU frame cadence improved22–50%; this does not establish60FPS on a hardware desktop.
