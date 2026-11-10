# 10593 Wells Branch — plan-based reference home

## Open and keep your existing home

Project actions → **Explore 10593 Wells Branch**, or open `/?home=wells-branch`.

The reference has a separate save namespace (`homestead-project-wells-branch-v1`); the original sandbox remains under `homestead-project-v1`. Switching first saves the current workspace and refuses navigation if saving fails. Unreadable/invalid stored data is retained untouched instead of being overwritten by the fallback example; exporting is still available, and an explicit import/reset authorizes replacement.

In the reference workspace, Project actions provides **Exterior view**, **Front facade**, **Ground-floor cutaway**, **Upper-floor cutaway**, **Export project**, and **Return to my sandbox**. Cutaways are presentation only: no saved objects are deleted or moved. Only house/furniture material clones are clipped; landscape/shared source materials are unchanged. AO is paused during inspection so its override-normal pass cannot include hidden upper geometry. Walking returns to the complete exterior and starts at the front path.

The downloadable v1 save is `public/examples/10593-wells-branch.homestead.json`. Import it into this updated version of Homestead; earlier versions do not know the authored `wb-*` part IDs. Regenerate it with:

```sh
node scripts/export-reference-homes.mjs
```

## Evidence and fidelity

User-supplied listing:
- https://www.zillow.com/homedetails/10593-Wells-Branch-Rd-Frisco-TX-75035/440082979_zpid/
- Same MLS photo tour, inspected when Zillow blocked gallery access: https://www.propertypanorama.com/10593-Wells-Branch-Drive-Frisco-TX-75035/unbranded

The builder explicitly associates this exact address with the **Melrose / D413**:
- https://landonhomes.com/new-homes-for-sale/10593-wells-branch/
- https://landonhomes.com/home-builder-plans/d413-melrose/
- First floor: https://landonhomes.com/wp-content/uploads/2022/03/D413-First-Floor.png
- Second floor: https://landonhomes.com/wp-content/uploads/2022/03/D413-Second-Floor.png

All 21 listing photos were inspected. The first/second-floor diagrams supplied dimensions and adjacencies; the facade and interior photos supplied white brick/stucco, charcoal shutters/door, gray shingles, window groupings, a teal study, white kitchen cabinetry/island, open dining/family arrangement and the upper lounge overlooking the family room.

### Source discrepancy — do not claim an exact as-built replica

The MLS/Zillow lists **2,394 sq ft and 3½ baths**. The builder's exact-address page says **2,335 sq ft and 2½ baths**, while the current D413 design page says approximately **2,391 sq ft** but still supplies the older two-full-bath diagrams. No documented position of an extra full bath was found. The model follows the supplied plans: primary ensuite, upstairs bath and powder room. It does **not invent a third full bathroom**.

This is a plan/photo-based reconstruction, not a survey, permit model or engineering document. Roof intersections, attic/front-gable massing, story heights and hidden construction are approximated from photographs. The front gable's feature window does not establish a verified habitable room behind it. Furnishings and appliances are editable catalog substitutes, not copies of the exact staged products. Doors are posed ajar and the rear garage overhead door raised for walkthroughs. Neighborhood houses and unphotographed details are not invented.

### Plan labels used for scale

| Space | Published dimensions |
| --- | --- |
| Study | 10′ × 12′ |
| Primary bedroom | 13′8″ × 14′6″ |
| Family | 12′10″ × 15′8″ |
| Dining | 14′4″ × 9′9″ |
| Rear garage | 18′2″ × 20′ |
| Covered patio | 13′4″ × 8′ |
| Upper bedroom 2 | 10′ × 14′4″ |
| Upper bedrooms 3 and 4 | 10′ × 11′8″ |
| Upper game room | 13′ × 14′ |

The traced outline is approximately 8.5 m wide at the front / 9.5 m at the rear garage and 18.5 m deep. Authored slab extents include partition/circulation areas and are not a claim that every nominal room dimension is exact. The double-height family and entry voids have no upper floor. First-floor surfaces are at 0.2 m, upper surfaces at 3.2 m; 16 stair risers connect them. The primary suite is downstairs, with three bedrooms and the game room upstairs.

## Implementation and editing

- `src/homes/wells-branch.js` is a deterministic fixed-part kit and furniture layout. Its structural IDs are registered in `ITEM_MAP` but do not clutter the existing 43-item palette. Records retain the unchanged v1 schema; positions/rotations/colors/finishes remain editable, selectable, exportable and undoable.
- `property-geometry.js` builds continuous roof masses, whitewashed brick, actual window/door apertures, shutters, trim, stairs and cabinets. The whitewashed color tile shares the existing brick normal/roughness channels; no listing photos or third-party floor-plan images are bundled in the app.
- Rendering and capsule collision share wall-opening rectangles. Window glass remains solid; offset doors are traversable. Variable-size floors use their real rotated footprint and thickness. Rounded foot support permits stepping onto the raised porch without a jump; native walking tests remain applicable. The porch roof's sloped collision/ceiling height follows local position, not a full-height AABB.
- `property-rooms.js` infers authored volumes only when actual floor/ceiling slabs cover their footprint; decorative roof art alone is insufficient. Moving/removing support geometry updates room membership. Existing 3 m room inference is unchanged for the Cedar sandbox; four debounced local probes remain the maximum.
- Local clipping uses material clones and excludes garden scenery. Shared source materials and serialized records are restored/unchanged. Cutaway hit-testing rejects invisible roof hits. Removing the last reference piece or entering Walk clears inspection. Cube captures temporarily disable clipping and restore its state.
- Painted white-brick materials belong to bounded geometry templates, not an unbounded per-color cache; retirement waits for the last live copy and never disposes global shared materials.

## Verification

Unit coverage includes v1 round-trip/download consistency, immutable layout generation, workspace isolation/load-failure protection, dimensions/voids, real and offset openings, porch entry without jumping, the full stair rise/upper landing, sloped ceiling clearance, actual slab closure, finite/UV-mapped roof geometry, isolated material clipping and template-owned material lifetime. Browser validation covers workspace switching/storage failure, views without save mutation, walking/upper access, paint/export/reload, preserved sandbox data, unreadable-save protection and a 320px viewport.

As elsewhere in Homestead, SwiftShader counts/timings are diagnostics, not proof of hardware 60 FPS or measured VRAM. Reference source plans/photos were used for inspection, not redistributed as application assets.
