# Homestead performance and realism implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** Smoother home-building gameplay, scalable rendering and more realistic models and lighting, with reproducible verification.
**Architecture:** Independent movement/spatial, rendering/quality/environment, and asset pipeline modules; main.js owns integration. Existing project records remain the source of truth. Controller owns building/UI changes, benchmark, integration and review.
**Tech Stack:** Three.js r180, Vite, Node tests, Playwright/Chromium, offline asset processing.
**Spec:** ../specs/2026-10-03-performance-realism.md

## Global constraints
- Preserve project version 1, 43 catalog pieces, existing saves and keyboard controls.
- Node 20.19+ or 22.12+, WebGL desktop, locally bundled CC0 assets/fonts.
- Target 60 FPS / 16.7 ms on hardware desktop; label cloud software GPU measurements.
- No always-on cubemap capture; no required external gameplay requests.

## Review focus
- Releasing pointer lock or tab blur clears movement and braking state.
- Imported/removed/moved walls update collision immediately, including upper floors.
- Instancing and LOD never lose selection ownership or dispose shared source geometry.
- Progressive loads cannot replace active ghosts, override project changes, or stall startup on a missing asset.
- Resizing/quality changes keep AO, antialiasing and reflection targets valid; hidden tabs do not corrupt timing.

### Task 1: Baseline and benchmark
Files: tests/performance.mjs, docs/performance-report.md, test-artifacts (ignored).
- [x] Implement reproducible real Chromium views and render counters, CPU spatial workload and frame samples; renderer metadata in JSON.
- [x] Capture unchanged baseline starter exterior and living room; include blank plot and dense repeated-item comparisons.

### Task 2: Movement and spatial index
Files: src/player.js, src/spatial.js, src/simulation.js; tests/player.test.js, spatial.test.js.
Interfaces: Player.update(dt,records) remains usable; Player.advance(dt,records) handles fixed step/interpolation; Player.invalidateSpatial() called on project edits; Player.reset/leave clear motion.
- [x] Write and run failing cadence, acceleration, wall/corner, doorway, stair, boundary and spatial invalidation tests.
- [x] Implement broadphase grid, bounded fixed-step simulation, rounded collision footprint and interpolated eye-height motion.
- [x] Run motion tests and existing building tests; review diff and correct defects.

### Task 3: Rendering, scenery, quality and lighting
Files: src/world.js, src/quality.js, src/scenery.js, src/lighting.js; tests/quality.test.js, scenery.test.js.
Interfaces: world.render(dt), world.setQuality(mode), world.quality (state), world.updateFixtures(records), world.invalidateLighting(records), world.stats and world.resize() preserve existing world members.
- [x] Write failing quality stability and geometry/instancing tests.
- [x] Implement adaptive resolution/AO/shadow presets, spatial instancing/LOD/wind, aggregate renderer stats and room-aware lighting/reflections.
- [x] Validate composer resize, sky/reflection synchronization, bounded captures and unchanged editing ownership.

### Task 4: Asset fidelity and loading
Files: src/models.js, src/materials.js, src/assets.js, public/models, public/textures, public/thumbnails, public/ASSET-CREDITS.md, scripts/asset tools; tests/assets.test.js.
Interfaces: loadDetailedModels({onProgress,onLoaded,renderer}={}) resolves all assets; detailedObject returns clone or null; modelScale(bounds,catalogSize) preserves proportions; texture API remains compatible. Catalog thumbnails static URLs.
- [x] Validate CC0 asset sources, texture compression tools and compatible bed/kitchen/bath model coverage.
- [x] Add tests for uniform fitting, locally complete resources and fallbacks; run red before implementation.
- [x] Add compressed textures/geometry, progressive loading callbacks, uniform scale and practical material/detail improvements.
- [x] Generate thumbnails offline after integration and check all 43 URLs.

### Task 5: Main/building/UI integration
Files: src/main.js, src/building.js, src/ui.js, src/style.css, index.html, src/feedback.js.
- [x] Initialize playable scene before detailed downloads; progress/retry fallback and safe mesh refresh. Replace startup thumbnail renderer with static assets.
- [x] Wire fixed simulation, quality controls, performance overlay, visibility suspension and spatial invalidation.
- [x] Optimize ghosts, add snap guides/feedback/audio and preserve edit/undo/import behavior.
- [x] Add browser assertions for quality, progressive loading, repeated-item picking and resource lifecycle.

### Task 6: Acceptance and iteration
Files: tests/browser.mjs, tests/performance.mjs, docs/performance-report.md, README.md, screenshots/upgrade.
- [x] Run complete Node tests, production build and Chromium interaction suite; fix failures and rerun impacted checks.
- [x] Compare baseline with upgraded scenery/large-home timing and geometry/texture budgets under matched views/settings.
- [x] Capture and inspect real exterior/interior/golden-hour screenshots; adjust visual defects.
- [x] Independent whole-change review, fix substantive findings, rerun relevant checks and report measured limits honestly.
