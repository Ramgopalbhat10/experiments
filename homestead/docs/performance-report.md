# Performance and realism verification

The upgrade starts from merged main `deb3f1b`, preserving project JSON version 1, the 43 catalog entries and the 108-piece example layout. Both versions were measured sequentially in the same Chromium 151 / ANGLE SwiftShader cloud environment, with a 960 × 540 viewport, 0.8 render scale, half-resolution contact occlusion and identical camera positions. The upgrade uses Balanced quality; its 1536px sun-shadow map replaces the original 2048px map. Reflection updates and shader warm-up settled before steady-state recording. Each scenario records 12 frames after five warm-up frames.

**These are comparative software-rendering diagnostics. They do not establish 60 FPS on a hardware desktop.** CPU render time measures JavaScript/driver submission, including possible backpressure; frame cadence includes GPU work and browser scheduling. A 12-frame sample is small and does not represent a long gameplay soak.

## Measured comparison

All counters include every composer pass. Values below show original → upgraded.

| Scene | Draw calls | Rendered triangles | Resident geometries | Median frame ms | Median CPU render ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starter exterior | 658 → 616 | 3,631,301 → 1,058,107 | 342 → 152 | 1503.4 → 797.4 | 13.6 → 17.5 |
| Starter living room | 203 → 207 | 1,992,051 → 422,851 | 342 → 152 | 1637.4 → 1275.9 | 5.6 → 5.5 |
| 200 repeated chairs | 1,187 → 146 | 2,343,857 → 383,797 | 611 → 155 | 1050.1 → 533.4 | 11.6 → 3.3 |
| Blank plot | 19 → 53 | 1,180,529 → 70,989 | 11 → 155 | 730.3 → 367.6 | 1.6 → 1.5 |

Rendered triangles fell 70.9% outside the starter house, 78.8% in its living room, 83.6% with 200 chairs and 94.0% on the blank plot. Median software-rendered frame cadence improved 22.1–49.7%. The repeated-chair case cuts draw calls 87.7% and CPU submission 71.6%.

The tradeoffs are explicit: spatial scenery tiles increase blank-plot draw calls from 19 to 53 while replacing over a million distant triangles. Living-room calls increase slightly from 203 to 207. Exterior CPU submission rises from 13.6 to 17.5ms in this software run; the measured frame cadence still improves 47.0%. This measurement includes driver backpressure and does not isolate pure application CPU cost. Geometry templates remain cached after switching to an empty plot, so resident geometry count differs from active geometry. Texture counts rise from 59 to 71 in the furnished home (68 without its room reflections), despite substantially smaller textures and compressed GPU formats; counts are not byte measurements.

Model and material files, including JPEG/glTF fallback variants, total **18,782,694 bytes versus 38,700,105 source bytes: 51.5% smaller**, including the newly added sleeping bed and stove. The local Basis runtime adds 597,657 bytes. See the [asset report](assets-upgrade.md) for source licenses, exact byte budgets and theoretical GPU texture allocations.

Reproducible raw evidence: [baseline](benchmarks/baseline.json), [upgrade](benchmarks/upgraded.json), [render checks](benchmarks/render-check.json), [streaming and instance checks](benchmarks/upgrade-browser.json). Baseline blank-plot timing was captured in a separate sequential run with identical settings. Baseline pixel-ratio metadata was corrected to reflect the 0.8 override actually used during sampling.

## Verification

- **78/78 Node tests pass.** Coverage includes equivalent movement at 30/60/120 Hz, smooth acceleration/braking, rounded collision, door clearance, stairs, jumping, ceilings, boundaries, input clearing and spatial invalidation. A 2,000-record layout returned at most four local candidates with cached queries; the query timing printed by the runner is a CPU diagnostic rather than a fixed performance threshold.
- **Production build passes.** The app chunk is approximately 271kB / 94kB gzip, and the Three.js chunk 568kB / 145kB gzip. Vite emits its standard 500kB chunk advisory for Three.js.
- **Original gameplay browser suite passes after the final changes.** Placement, selection, painting, moving, removal, undo, persistence, import/export, invalid imports, walking, pointer lock, levels, grid, daylight/golden hour and narrow-screen controls pass without browser errors.
- **Progressive/instancing browser checks pass.** The scene stays usable while model requests are held; all eight detailed model types load; active edits survive loading; individual instances can be selected, painted, removed and restored; a painting mounts correctly to a rotated instanced wall; collision edits invalidate immediately. No browser errors.
- **Seven rendering checks pass.** Real settings controls switch Low/Balanced/High/Auto, resize keeps composer/AO targets consistent, and golden hour replaces the reflected sky. All three local reflection maps contain zero nonfinite GPU samples. Texture count remains 71 across repeated daylight/golden-hour rebuilds; there are no browser warnings, console errors or WebGL errors.
- **All 43 WebP catalog previews regenerated and decoded successfully.** Ordinary startup does not construct a thumbnail renderer. Five final [actual views](../screenshots/upgrade/) were captured and visually inspected, including the full sleeping bed and detailed stove.
- **Independent final code review found no remaining actionable bugs.** Geometry/template ownership, instance IDs, progressive refresh, quality stability, room boundaries and probe lifecycle were reviewed after fixing the substantive findings.

## Implementation decisions and limits

- Movement uses a fixed 120Hz simulation with interpolated display and bounded catch-up. Collision uses catalog footprints and a rounded player footprint rather than full mesh physics; saves retain existing positions and dimensions.
- Geometry templates share resources until their final live copy releases; editing batches retain individual ownership and separate room lighting. Distant scenery uses much cheaper crowns, while nearby foliage uses photographed leaf sprays and gentle wind.
- Room inference treats doors as reflection partitions and upper floors as ceilings. Local probes are capped at four, captured at 128px with edit debounce and a 1.2-second cooldown. Local captures use bounded LDR radiance to avoid observed half-float overflow; the atmospheric sky retains HDR reflections. This is a practical editable-scene approximation, not global illumination or ray tracing.
- Saved colors tint mapped imported surfaces; the bed has one baked atlas, so its tint affects timber and cloth together. Procedural cabinets and construction remain modular and editable. The asset guide documents exact material mapping.
- Automatic quality downgrades after sustained slow frames, ignores short spikes/hidden-tab gaps and uses cautious 60Hz recovery trials with backoff. Hidden tabs suspend the loop and clear motion. No always-on cubemap captures or required external asset requests.

## Reproduce and test a local GPU

```sh
npm install
npm run dev -- --port 5174
# In another terminal, with installed Chromium and hardware acceleration:
GAME_URL=http://127.0.0.1:5174 BENCH_FRAMES=180 HEADED=1 npm run test:performance
```

Check `metadata.softwareRendering` and the GL renderer string before assessing the **60 FPS / 16.7ms target**. That target remains unverified on user hardware because this environment only exposes SwiftShader. Repeat across Low/Balanced/High at the intended display resolution and with the performance overlay enabled during actual walking.

To reproduce the cloud comparison:

```sh
SOFTWARE_GPU=1 BENCH_FRAMES=12 BENCH_WIDTH=960 BENCH_HEIGHT=540 RENDER_SCALE=0.8 GAME_URL=http://127.0.0.1:5174 BENCH_OUTPUT=test-artifacts/performance.json npm run test:performance
```

`BENCH_QUALITY`, `BENCH_FRAMES`, `BENCH_WIDTH`, `BENCH_HEIGHT`, `RENDER_SCALE`, `BENCH_OUTPUT`, and comma-separated `BENCH_VIEWS` select settings and scenarios. Run one GPU browser at a time to avoid contaminating timings. Full browser verification uses `test:browser`, `test:upgrade` and `test:render` against the same `GAME_URL`.
