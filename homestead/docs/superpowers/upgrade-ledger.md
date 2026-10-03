# Upgrade execution ledger

Baseline branch feature/homestead-performance-realism starts at merged main deb3f1b; isolated worktree /workspace/homestead-upgrade. User explicitly directed all recommendations to completion with iteration and verification. Controller coordinates native integration with independent movement, rendering, asset implementation and independent review per applicable skills.

## Completed implementation
- Motion: fixed120Hz interpolation, acceleration/braking, rounded collision, stairs/ceiling/jump, explicit spatial invalidation and hidden-tab clearMotion. Red/green tests and cached2000-record query benchmark.
- Assets: bed+stove CC0 source assets,8 streamed detailed types, uniform fit,54 KTX2 maps, meshopt geometry, bounded concurrency and local fallback.14 tests covering source fidelity, compressed dependencies, fallbacks and paint retention.
- Rendering: spatial scenery instancing/LOD/leaf wind, photographed leafsprays, qualitypresets, roomlayout/windowfill/probes, skyreflectionmatching andaggregatecounters.
- Integration: cached shared geometry with reference retirement, welded vertices, editable instancing with IDpickmapping and room buckets, staticcatalogthumbnails, progress, settings, optionalinteractionaudio, cheapghosts/snapguides and cachedplacementvalidity.

## Review and iteration
- Ruling: room partition doorway remains a separate reflection volume despite passable doorway — useful room-scale reflections, no collision change.
- Fixed60Hz recovery trial/backoff and upperfloorceiling inference after independent review.
- Fixed loaded bed/stove color loss with cached tint variants preserving source maps and oven glass.
- Fixed pending black material placeholders with valid neutral1×1 pixels and data/compressed upload flags.
- Fixed moving=null lookup and stale guide visibility after red regressions.
- Fixed quantized model CPU transform overflow: normalized integer attributes dequantized before baking to metre coordinates, welded after merging; actual bedthumbnail exposed the corruption.
- Ruling: local room cubemap capture uses bounded8-bit radiance while atmospheric environment remains HDR — GPU probe inspection found nonfinite half-float captures producing black surfaces; preserve stable finite room reflections rather than exporting invalid radiance.
- Fixed test harness duplicate-app import: use the exact document scriptURL including Vite timestamp; rejected earlier visualcaptures as invalid.
- Fixed benchmark effective pixelratio metadata, automaticsoftwareGPU detection and blankplot coverage.

## Evidence so far
- Fresh full Node suite78/78 passed after model transform fix; production build checked at each integrationstage.
- Original Chromium gameplay suite passed all existing UI/save/walk/narrow checks with no consoleerrors.
- Extended real browser checks passed for playable loading, edit preservation, instance picking/painting/removal/undo, rotated wall attachment, collision invalidation and motion clearing. All eight detailed models loaded; no console errors.
- All43 static WebP catalog previews regenerated, including the full adult sleeping bed.
- Independent final scoped review found no remaining actionable bugs; quality/lighting captures and matched benchmarks complete the remaining acceptance checks.

- Final glazing regression: low-opacity transparent panes do not cast opaque sun shadows; solid frames continue to cast shadows.

- Final GPU checks: all7 graphics/resize/lighting assertions passed; all3 local reflection maps had zero nonfinite samples; texture count remained bounded across repeated day/golden-hour changes; no console or WebGL errors. Five updated views captured and inspected.

- Matched software GPU benchmark: starter exterior triangles3,631,301→1,058,107; living1,992,051→422,851;200chairs2,343,857→383,797; blank1,180,529→70,989. Densechair calls1187→146. Median frame cadence improved22–50%; exterior CPU submission increased in this run. Raw evidence and limits recorded in docs/performance-report.md.

- Final original interaction suite rerun against frozen upgrade: all placement/select/paint/move/remove/undo/persistence/import/export/walk/pointer-lock/levels/grid/lighting/narrow-screen groups passed with no browser errors. Final build recopies the43 final previews. All plan acceptance checks complete, with local hardware60FPS explicitly unverified and a reproducible hardware runner provided.
