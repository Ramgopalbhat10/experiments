# Homestead Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, task by task.

**Goal:** Deliver the approved first-person home-building sandbox as a runnable local Three.js app.

**Architecture:** A Three.js renderer consumes validated project records. Plain HTML/CSS controls the catalog and tool HUD. Separate modules handle object factories, terrain, movement, placement, and saved state.

**Tech Stack:** JavaScript ES modules, Three.js, Vite, Node test runner, Playwright for browser verification.

**Spec:** `docs/design.md` (approved in chat).

## Global Constraints

- Work in the new `homestead` folder under the main repository.
- First-person keyboard/mouse gameplay; responsive catalog UI.
- Unlimited items, local saves, JSON import/export, no backend.
- Representative detailed catalog across structure, interiors, and garden.
- Placement preview, snapping, rotation, selection, painting, removal, undo.

## Review Focus

- Invalid imported records must preserve the active project.
- Duplicate structural placement and out-of-plot placement must be rejected.
- Pointer-lock release must not leave movement keys held.
- Moving or painting objects must remain undoable and persist through reload.
- Narrow screens must retain accessible catalog and project actions.

### Task 1: Project state and persistence

**Files:** `package.json`, `src/catalog.js`, `src/project.js`, `tests/project.test.js`.
**Interfaces:** `CATALOG` item records; `snapPosition(item, position)`; `validateProject(data)`; `Project` with `place`, `remove`, `update`, `undo`, `replace`, `serialize`.

- [ ] Write and run failing state tests for snapping, placement bounds/duplicates, validation, paint/move undo, and safe import.
- [ ] Implement the catalog metadata and project state.
- [ ] Run `npm test`; expect all state tests passing.

### Task 2: Detailed world and rendered catalog

**Files:** `index.html`, `src/materials.js`, `src/objects.js`, `src/world.js`, `src/starter.js`.
**Interfaces:** `createObject(record)` returns a Three.js group; `createWorld(canvas)` returns renderer, scene, camera; `starterProject()` supplies validated records.

- [ ] Build reusable procedural materials and catalog factories for complete structural, interior, and garden categories.
- [ ] Render a landscaped plot and a coherent furnished house with shadows and sky.
- [ ] Verify production compilation and inspect a rendered desktop screenshot.

### Task 3: Playable construction and HUD

**Files:** `src/main.js`, `src/player.js`, `src/building.js`, `src/ui.js`, `src/style.css`.
**Interfaces:** Player handles pointer lock and movement; building consumes `Project` and exposes tool/selection/preview operations; UI invokes those operations and shows project state.

- [ ] Implement first-person walking, gravity/floor/stair support, collision, and a build-height control.
- [ ] Implement preview, structural/furniture snapping, rotation, placement, editing, painting, move, remove, and undo.
- [ ] Add illustrated catalog, search, categories, material/color settings, hotbar, help, day lighting, saves, import/export, and blank/example project actions.
- [ ] Browser-check placement, pointer lock, held-key clearing, painting, undo, persistence, and narrow viewport controls.

### Task 4: Verification and delivery

**Files:** `tests/browser.mjs`, `README.md`, repository `README.md` project listing.

- [ ] Run the full Node tests and production build.
- [ ] Run browser interaction checks including malformed import, reset confirmation, export/import, and console errors.
- [ ] Capture and inspect desktop and narrow screenshots; review source for regressions.
- [ ] Document commands and controls; leave the runnable project in the requested folder.

## Execution decisions

User explicitly requested implementation after design approval; proceed inline without additional plan approvals. Keep the existing work branch and requested project path. Use state tests for consequential logic and browser checks for rendering/interaction; do not add tests that mirror decorative geometry. No publishing or external messaging.
