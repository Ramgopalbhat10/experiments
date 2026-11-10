# Realism iteration 2: interiors and contact detail

## Scope

Keep the r180/WebGL renderer, catalog, save schema, editing and texture fallbacks. This iteration improves daylight contrast, makes room captures failure-safe, offers a measured High-only GTAO experiment, separates linen paint from bed timber, and adds aligned brick surface channels. It does not claim physical GI, perfect wall occlusion, or hardware 60 FPS.

## Lighting and reflections

- Reduce hemisphere fill from 0.48/0.28 to 0.36/0.20 (day/evening), and fixture intensity/range from 32/6 m and 16/4 m to 18/4.5 m and 9/3 m. The eight-fixture cap stays unchanged.
- Window fill is 3.5/2 intensity, 2.8 m range, with at most four exposed openings. Interior glazed partitions no longer become extra sky sources. An overhead-cover test also excludes covered porches/double-height spaces missed by the 3 m room heuristic; open-to-sky courtyards remain eligible.
- Local environment strength is 0.65 after capture, 0.16 while using sky fallback. Nearby placed foliage is no longer omitted inconsistently between single objects and instance batches. The expensive distant landscape remains excluded; local capture far distance is 24 m.
- Keep four debounced 128px **unsigned-byte** local cubes and the existing sky-only PMREM. Reintroducing half-float room capture without solving the prior overflow/NaN problem is not justified. Clamped LDR is a deliberate quality limit, not true HDR GI.
- Preserve the last valid local probe across a lighting change until its replacement succeeds. Failed local/sky generation keeps the old map or diffuse-light fallback, reports a failure count, drains queued work without a per-frame retry loop, and restores renderer target/cube face/mip, XR, clear state, tone mapping, scene override/background, material maps and visibility.

Window and fixture fills remain bounded, unshadowed approximations. They do not solve arbitrary indirect transport or all near-wall light leakage. These changes should be judged with day/evening views, not by globally raising exposure.

## Standard vs Enhanced contact shadows

In **Graphics & sound → Contact shadows**, Standard remains the default. Enhanced requests GTAO only at effective High quality. Balanced (including Auto fallback) uses SSAO; Low disables AO. The preference persists independently of the project save.

`ContactOcclusion` owns exactly one delegate and resizes it with the current quality AO scale. Switching effects disposes the old targets/noise/materials, including resources omitted by the r180 addon dispose methods. Both normal passes exclude sky, glass, alpha-tested foliage and helper lines/points, restoring existing hidden states even if rendering throws.

GTAO uses eight samples, a 0.25 m starting radius, modest blend intensity and denoising. Its `needsSwap` behavior differs from SSAO and is forwarded correctly. Construction, resize, capability or render failure latches to SSAO; a failed SSAO fallback disables only AO. Resize/quality changes do not silently reallocate a failed-off effect. An explicit preference change retries. Because SSAO composites in-place, a fatal AO failure re-renders the base scene before OutputPass instead of exposing a partially modified read buffer.

Enhanced is **opt-in**, not an asserted universal improvement. Compare the same camera, exposure, render scale and tier; reject halos, overly dark creases and foliage/glass artifacts. Hardware GPU timing and render-target memory must justify any future default change.

## Bed: separate verified surfaces

The Poly Haven CC0 GothicBed_01 atlas contains linen and timber in a single texture set. The authoring recipe identifies five complete UV-connected linen components (quilt, pillows and mattress edges), verified against UV bounds, source positions and atlas pixels. It splits **2,419 linen / 16,326 timber triangles** into two primitives; no triangle, UV or photographed map is discarded. It does not infer materials from a runtime brightness threshold or rectangular UV mask.

Only `_linen` is tinted; `_timber` retains its photographed color. Both share the original color/normal/roughness images. Plain and meshopt/KTX2 sources plus both geometry-only LODs are regenerated; low detail has 5,413 triangles. All mapped-material UV validation remains enabled.

Cost: one extra material draw per rendered bed representation, rather than a custom shader hook that could be lost when room materials are cloned. Vertex/index bytes remain bounded; no new texture downloads. Legacy unsplit sources stay untinted instead of recoloring timber. The procedural bed already paints its fabric while retaining wood.

Rebuild from `homestead/`, using the pinned tools described by `scripts/generate-lods.mjs`:

```sh
node scripts/separate-bed-materials.mjs
node scripts/generate-lods.mjs
```

The source split records an authoring marker and is idempotent; changed source geometry fails the strict island/count audit and must be inspected again. Original provenance checksums still describe the upstream downloads, not these locally authored buffers.

## Brick surface detail

Generate one cached set of 256² RGBA color, normal and roughness textures from the same periodic staggered-joint height field. Color is sRGB; normals/scalars are non-color data. All channels share wrap/repeat, mipmaps and edge texels. Eight courses close the stagger pattern at the repeat boundary. Normal strength is restrained, mortar is rougher than brick, and there is no displacement/silhouette change or extra draw call.

Approximate RGBA8 residency with mipmaps is 1 MiB for all three maps, versus about 1.33 MiB for the old single 512² color canvas, excluding driver overhead. There are two additional material texture samples; this is not free shading. No downloaded asset or runtime dependency is added. Slate remains unchanged.

## Verification

Focused unit coverage includes effect tier/preference/scaling, init/render/resize failures, latched-off behavior, recovery of partial composites, visibility/state restoration, idempotent resource disposal, exposed/covered/courtyard window classification, failed probe replacement, periodic aligned brick channels and color spaces, bed primitive/material/UV closure, tint/cache isolation and all original LOD UV regressions.

Preview captures use matching living, painted-bed, evening and grazing-brick views; High-quality SSAO/GTAO captures compare one effect at a time. Browser checks cover the native settings control, quality fallback and a 320px viewport. Existing gameplay, streaming/LOD and quality/reflection suites must still pass. Cloud SwiftShader frame intervals are relative diagnostics, not hardware GPU timings or a 60 FPS assessment. The capture harness pauses drawing to obtain stable screenshots; its manual frame intervals are not a valid before/after speed comparison. Use the same continuous-RAF performance runner for effect A/B comparisons:

```sh
BENCH_QUALITY=high BENCH_AO=ssao BENCH_VIEWS=starter-living BENCH_FRAMES=180 npm run test:performance
BENCH_QUALITY=high BENCH_AO=gtao BENCH_VIEWS=starter-living BENCH_FRAMES=180 npm run test:performance
```

The runner records requested/active AO, resolution, renderer and software flag. `BENCH_SCREENSHOTS=0` permits data-only runs when software rendering stalls image capture; it does not change the measured rendering loop.
