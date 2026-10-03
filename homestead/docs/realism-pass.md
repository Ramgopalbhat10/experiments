# Realism refinement

Requested in chat after the first screenshot review: furniture needs convincing shapes, finer detailing, better lighting, and more polished surfaces.

Keep the existing sandbox, controls, catalog IDs, and save schema. Improve the actual rendered world with:

- Detailed, locally bundled CC0 furniture and indoor foliage models, normalized to placement footprints. Procedural versions remain available if a model fails to load.
- Photographed color, normal and roughness maps, with meter-scaled box UVs and adjustable finish colors. Neutralized plaster/fabric and lightened oak preserve the warm palette.
- Recessed kitchen cabinetry, curved taps, real sink/bath cavities, cast hob fittings, upholstery piping, a draped duvet, individual floorboards, planter joinery, and curved garden foliage.
- Prefiltered HDR environment reflections, balanced sunlight/sky fill, warm working fixtures, half-resolution contact occlusion, and final antialiasing.
- Bounded fixture count (8), reduced geometry for distant trees, shared geometry/materials, and batched decorative parts.

Validation: state/geometry regression suite, production build, actual Chromium screenshots at matching viewpoints, console/resource checks, and existing browser interaction suite. Decorative changes are verified visually rather than with tests that mirror their geometry. Asset sources and licenses are recorded in `public/ASSET-CREDITS.md`.

Garden scan optimization: tree_small_02 was reduced from 2,062,487 triangles to 12,702 triangles (branches 5,187; leaves 5,818; trunk 1,697) with meshoptimizer through glTF-Transform. Local binary size fell from 91 MB to 586 KB. Texture transforms and baked materials remain intact. Transparent foliage is excluded from the normal-only contact-occlusion pass so alpha cards do not create rectangular occlusion.

The starter house now separates the bathroom from the kitchen and faces its sofa toward the table and television. This changes only newly loaded example layouts; existing exported projects retain their records.

Final foliage budgets: 24,338 triangles per tree including two rotated canopy copies; 58,286 triangles per indoor plant; 4,098 triangles per shrub. Source photographs were recompressed at high quality to reduce transfer size. All six models' local dependencies were checked.

Final verification: 15 Node tests, production build and full Chromium interaction checks pass. Updated screenshot set includes exterior, living room, kitchen, bedroom and golden-hour views.
