# Asset loading, fidelity and compression

The detailed bed and electric range are bundled CC0 Poly Haven models. All gameplay dependencies remain local. Ordinary startup uses the built-in procedural models immediately; the controller starts detailed loading once the scene is playable and replaces only current placed records when their item arrives.

## Provenance

License verified on 2026-10-03 against https://polyhaven.com/license: all Poly Haven assets are CC0 1.0, including commercial use and modifications. Source asset metadata was obtained through https://api.polyhaven.com/assets?t=models and each `/files/{asset}` API. The added models retain source URLs and download MD5 checksums in their `PROVENANCE.json`.

| Catalog item | Source | Author | Detail |
| --- | --- | --- | --- |
| Bed | [GothicBed_01](https://polyhaven.com/a/GothicBed_01) | Kirill Sannikov | Carved timber sleeping bed, full mattress and wrinkled linen duvet |
| Stove | [electric_stove](https://polyhaven.com/a/electric_stove) | Kuutti Siitonen | Four hotplates, control knobs, oven window and textured enamel |

The imported bed is a full sleeping bed, approximately 1.51m wide × 2.06m long after fitting. Its catalog headboard height is 1.55m, preserving adult mattress length while the 1.8 × 2.2m catalog footprint remains unchanged. Model height, width and depth are bounded by the catalog dimensions, with one uniform scale applied to all axes. The coffee-table source axes are rotated before fitting. All model bottoms are grounded and footprints centered. Saves and collisions continue to use the catalog.

The previous sofa, lounge chair, coffee table, plant, shrub and tree remain Poly Haven CC0. Potted-plant geometry received bounded-error simplification; foliage borders are locked to preserve silhouette and texture coverage. The garden tree retains three source leaf layers, with two additional rotations at 2.1 and 4.2 radians applied before uniform fitting; all three layers share their geometry and material. Source material and geometry are shared among cached clones. Imported finishes retain each saved record color on the mapped surfaces: sofa upholstery, armchair pillow, plant pot, bed atlas, and opaque range enamel/cabinet. The sleeping bed uses one baked material for quilt, pillow and timber, so its tint affects that complete atlas; the range keeps its separate transparent oven-glass material unchanged. Tint variants share the source textures and are cached by item, source material and color. Other imported timber and foliage retain their photographed colors. This is a color mapping onto selected imported surfaces; it does not replace their baked texture set with arbitrary plaster/oak/brick finish textures.

## Offline recipe

No new runtime dependency is required beyond the existing Three.js package. Development-only tools can live outside the repository:

```sh
mkdir -p /tmp/homestead-asset-tools
cd /tmp/homestead-asset-tools
npm install @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0
```

Download the official [KTX-Software 4.4.2 Linux package](https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2), extract it under `/tmp/ktx-software`, and use `/tmp/ktx-software/bin/toktx`. The texture script also requires Python Pillow. From the application directory:

```sh
python scripts/fetch-models.py GothicBed_01 electric_stove
ASSET_TOOLS=/tmp/homestead-asset-tools node scripts/optimize-models.mjs
python scripts/prepare-assets.py --toktx /tmp/ktx-software/bin/toktx
node --test tests/assets.test.js
npm run build
```

For full source regeneration, restore the previously curated local JPEG/model originals before these steps; the earlier curated fabric/concrete/plaster color treatments are retained. The fetch script validates original checksums. Optimization welds/deduplicates/prunes geometry, bounds potted-plant simplification error to 0.002, and writes two distinct outputs: ordinary JPEG `model.gltf` and quantized/meshopt `compressed.gltf` with dedicated `compressed-0.bin`. A marker prevents cumulative plant simplification on reruns. The ordinary model never depends on meshopt or KTX2 decoding.

Texture color maps use 1024px mipmapped ETC1S (quality 192), while normal maps use 512px UASTC (quality 2, Zstd level 6). Scalar/packed maps use 512px ETC1S. All encoded files contain full mip chains. Normal maps retain three components for Three.js shader compatibility. Material KTX2 images are vertically flipped offline to match `TextureLoader`; glTF textures preserve the glTF convention. JPEG fallback images use the same bounded resolutions. Historical `2k` filenames remain for compatibility and do not indicate current pixel size.

`public/asset-manifest.json` records compressed and fallback paths, dimensions and encodings. The compatible Basis transcoder is copied from Three.js r180 into `public/basis/`, with Apache 2.0 license. MeshoptDecoder comes from the same locally bundled Three.js addon package.

## Loading contract

Call `configureAssets(renderer)` immediately after renderer creation, before `texture()` or `mat()` calls. It checks the renderer's compressed texture extensions; unsupported GPUs use JPEG directly. `texture()` remains synchronous. A valid white 1×1 DataTexture (neutral tangent-space blue for normal maps) keeps the playable scene lit before downloads complete. Pending clones receive decoded pixels while preserving their own wrapping, repeat, offset, color space and identity. Compressed material failure automatically tries the JPEG. `texturesReady()`/`assetsReady()` settle even when optional files fail.

`loadDetailedModels({renderer,onProgress,onLoaded}={})` loads at most two models concurrently and resolves an array of `{item,status,error?}` after all currently unloaded entries settle. It never rejects merely because an optional asset is absent. An initial progress callback reports `{loaded:0,failed:0,completed:0,total,item:null,status:'loading'}`; each settled asset reports the current counts and item with `status:'loaded'` or `'failed'`. `onLoaded(itemId)` runs only after the model is cached and `getModelRevision(itemId)` increments. The controller can safely invalidate that item template and rebuild current placed clones at this point. A subsequent call retries failed entries; already loaded models are reused. Calls while a stream is active share its promise.

With a compatible renderer, GLTFLoader uses local MeshoptDecoder and KTX2Loader. If compressed loading or transcoding fails, it retries the ordinary glTF/JPEG variant. Without a renderer it directly uses that ordinary variant. `detailedObject(item,color)` returns a shared-resource clone or `null` while the procedural fallback is needed.

## Measured sizes

These are asset-file measurements, not a hardware performance claim. Before processing, the models plus material textures occupied **38,700,105 bytes**, including the newly downloaded bed/range (the original application was approximately 35.5 MB). The final optimized file totals are below; JPEG and geometry fallbacks remain shipped.

| Files | Bytes |
| --- | ---: |
| Model JPEG textures | 3,363,544 |
| Model KTX2 textures | 6,073,511 |
| Model geometry, both variants | 5,291,672 |
| Model glTF manifests | 122,109 |
| Material JPEG textures | 1,497,876 |
| Material KTX2 textures | 2,433,982 |
| Local Basis runtime + license | 597,657 |

The listed model/material texture and geometry/manifest files occupy **18,782,694 bytes**, a **51.5% reduction** against the source set while adding alternate compressed and fallback representations. On the compressed path the runtime downloads one model geometry variant and KTX2 textures; ordinary JPEG textures included as optional glTF sources are not also downloaded by GLTFLoader.

| Model | Original triangles | Final triangles | JPEG-path geometry bytes | Meshopt geometry bytes |
| --- | ---: | ---: | ---: | ---: |
| Electric stove | 13,914 | 13,914 | 460,676 | 139,132 |
| Lounge chair | 8,916 | 8,916 | 240,728 | 87,912 |
| Coffee table | 4,504 | 4,504 | 154,864 | 55,676 |
| Indoor plant | 58,286 | 48,124 | 1,487,944 | 587,000 |
| Shrub | 4,098 | 4,098 | 166,092 | 70,140 |
| Sofa | 2,728 | 2,728 | 74,864 | 28,856 |
| Tree | 12,702 | 12,702 | 599,288 | 253,456 |
| Sleeping bed | 18,745 | 18,745 | 658,648 | 226,396 |

The tree table reports source-buffer triangles. Its three shared leaf layers produce **24,338 rendered triangles per detailed tree** (12,702 original + two × 5,818 leaf triangles) while retaining one shared leaf geometry/texture allocation.

For all 54 bundled texture files, RGBA8 plus generated mipmaps would cost about **604 MB** at original resolutions versus **151 MB** for the bounded JPEG fallbacks. Typical BC1 color/scalar and BC7 normal GPU transcoding at the new resolutions would use approximately **22 MB**. These are theoretical full-set allocations; actual residency depends on the selected scene, GPU formats, alpha channels and renderer behavior. Runtime browser measurements belong in the performance report.

## Verification

Fourteen asset tests verify uniform scale, rotated-source grounding, progressive callbacks, partial failure continuation, missing/unsupported compressed fallback, pending clone pixel propagation with independent UV transforms, KTX2 magic/mipmap chains, local glTF resource closure, matching buffer sizes for both geometry variants, successful decoding of every meshopt buffer view with the actual bundled Three.js decoder, and neutral GPU placeholder pixels with correct data/compressed/JPEG upload flags, and two-color imported bed/range cloning without changing source materials, baked textures or oven glass, adult imported mattress length, and three shared tree-leaf layers with grounded uniform bounds. Production build passes. Full-suite execution and browser shader/resource/visual checks are coordinated by the controller alongside the other in-flight changes.
