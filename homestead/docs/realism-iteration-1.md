# Realism iteration 1

## Skill discovery before implementation

No maintainer-published official Three.js agent skill pack was verified. Official Three.js r180 source remains the API authority. Reviewed community guidance, without installing scripts or replacing project dependencies:

- [cloudai-x/threejs-skills](https://github.com/cloudai-x/threejs-skills), checkout `0e18186`: performance and materials skills. The skills.sh directory lists this among its most-installed Three.js packs; counts vary over time.
- [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills), checkout `4cce500`: materials/lighting and glTF loading skills.

Both target newer releases (r186). In particular, newer PCF behavior and decoder defaults must not be copied into this r180/WebGL app. Retained existing renderer, composer, KTX2/Basis setup and local fallbacks.

## Rendering changes

### Stable, fitted sun shadows

`SunShadows` fits the existing map to a padded player-ground region plus **every placed object's rotated catalog bounds**, including upper levels. Large projects naturally get wider coverage, trading density rather than clipping their placed receivers. The light-space origin stays fixed in world space; projection centers snap to texels. Camera anchors move in four-metre increments, so tiny camera movements do not redraw or shift the map. Refit on anchor, project, lighting-direction or shadow-resolution changes. Bias is small; normal bias scales with texel size and is bounded to 4–20 mm.

Off-screen casters can project into the fitted receiver area; the shadow volume extends toward the sun and has conservative depth for nearby scenery. The map resolution and quality-tier caps are unchanged. Removed the ineffective directional PCFSoft `shadow.radius` setting.

Scenery shadows deliberately use a **stable rest-pose proxy** while visible foliage has gentle wind. This avoids continuously refreshing a large sun map for a small leaf movement. Scenery LOD has hysteresis and reports changes; changing a caster representation refreshes the shadow immediately. This is a documented real-time approximation, not a claim of perfectly animated foliage shadows or GI.

### Two hero assets and structural material

- Sofa: preserve photographed leather/grain/roughness maps and source geometry; use dielectric shading, moderated normal strength and a restrained rough clearcoat rather than metallic-looking leather. Existing saved tint behavior is retained.
- Indoor plant: separate leaf, pot, stem and gravel material variants while sharing the original textures. **Only the pot receives saved paint.** Previously the substring `pot` also matched the `potted_plant` prefix on the leaf material. Keep cutout leaves opaque/alpha-tested, not blended. The pot retains paint on the procedural fallback too.
- Lime plaster: matte dry-surface roughness and restrained normal relief; small real bevels around window reveals and frames provide grazing-light highlights. No added textures, shader hooks, catalog IDs, or save fields.

### Placed-model LOD

All eight existing imported model types have geometry-only low-detail variants. Selection uses projected size, camera FOV/zoom and hysteresis; selected and moving pieces retain full detail. The test is independent of DPR, preventing quality changes from triggering unwanted detail changes. Decisions run at most five times a second and only representation transitions allocate/rebatch.

Runtime transitions preserve the authoritative project records, collision, owner IDs and undo/save semantics. They rebuild only affected spatial cells, restore their source materials before batching, and retain unaffected batches and room-material clones. Room inference, light fixtures, reflection captures, save callbacks and collision invalidation do not run for a camera-only LOD switch. Picking still resolves each visible instance to its project owner.

Both variants use the exact full-source fit transform. Low meshes bind to full-model materials by mesh name: no duplicate texture downloads/transcodes/GPU textures. Low geometry has meshopt and ordinary glTF fallbacks. Missing, empty or incompatible optional geometry retains the successfully loaded full model; if the source itself is unavailable, the existing procedural fallback remains usable.

`public/lod-manifest.json` records the offline settings and triangle counts. Rebuild from `homestead/`:

```sh
npm install --prefix /tmp/homestead-asset-tools @gltf-transform/core@4.2.1 @gltf-transform/extensions@4.2.1 @gltf-transform/functions@4.2.1 meshoptimizer@0.24.0
node scripts/generate-lods.mjs
```

Full-detail assets are never rewritten by this command. UV borders are locked except on the indoor plant, whose distant open foliage/pebble geometry uses bounded-error simplification. Preserve the originals; do not simplify a previously generated LOD again.

## Verification

Unit coverage includes receiver coverage at plot corners and upper floors in both sun directions, fixed world-space shadow grids across camera anchors, empty plots, LOD hysteresis/zoom/save immutability, hero paint isolation, shared LOD fits/materials, invalid optional geometry, local asset buffer closure, partial-cell picking ownership, stable foliage-depth uniforms, and retention of unrelated room clones/probe work.

The streaming/browser suite also exercises near/far plants, picking, paint, delete/undo, unchanged serialized records and invalid optional LOD fallback. Existing gameplay, lighting/probe, quality/resize and source asset tests remain applicable.

`tests/performance.mjs` now includes `dense-36-plants` and p99 frame/submission summaries. Use `BENCH_FRAMES=180` or longer on a hardware GPU, fixed quality, viewport and render scale. Isolate walking/editing and probe/shadow refresh spikes from steady-state timing. Resource counts are not memory bytes.

A separate Preview-driven before/after check records identical exterior, living, golden-hour and 36-plant views, plus editing/LOD invariants, tiny-camera-motion stability, a 320px viewport and console/WebGL errors. Cloud captures use SwiftShader at 960×540, render scale 0.8, Balanced quality and 30 measured frames after five controlled warm-up frames. Software timing is comparative only; hardware 60 FPS remains unverified. Final measured results are supplied with the task's visual evidence.
