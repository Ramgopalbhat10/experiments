# Local material assets

PBR texture sets and environment illumination from [Poly Haven](https://polyhaven.com), released under [CC0](https://polyhaven.com/license):

- wood_table_001: oak surfaces
- painted_plaster_wall: painted plaster
- denim_fabric: upholstery weave (albedo neutralized for recoloring)
- grass_ground: garden lawn
- grey_plaster: concrete (albedo neutralized)
- marble_01: stone worktops
- kloofendal_48d_partly_cloudy_puresky: HDR environment

Color textures are bundled at up to 1K resolution; normal and scalar maps use 512px. Each texture has a mipmapped KTX2/Basis variant and a local JPEG fallback. Plaster and concrete albedos were neutralized to preserve the game's finish colors. No asset service is contacted while playing.

## Furniture and indoor foliage

Detailed models and accompanying baked PBR textures from Poly Haven, CC0:

- sofa_02: upholstered seating
- modern_arm_chair_01: wooden lounge chair with leather cushions
- modern_coffee_table_01: timber coffee table
- potted_plant_01: indoor plant with photographed leaves

The source geometry is grounded, centered and uniformly fitted within catalog dimensions; its photographed proportions are preserved. Oak albedo was lightened to an unfinished timber palette. Model source names and local dependencies are preserved in `models/`.

- tree_small_02: garden tree (geometry simplified for realtime use)
- shrub_04: garden shrub


## Additional furniture and kitchen detail (2026-10-03)

- [GothicBed_01](https://polyhaven.com/a/GothicBed_01), Kirill Sannikov: carved timber sleeping bed with a full-length mattress, wrinkled linen duvet, and tall head/footboard. Uniformly fitted within the existing bed footprint at realistic adult sleeping length; headboard height is 1.55m.
- [electric_stove](https://polyhaven.com/a/electric_stove), Kuutti Siitonen: electric range with four hotplates, controls and oven glass.

Both are **CC0 1.0**, verified against [Poly Haven's asset license](https://polyhaven.com/license). Original download URLs and MD5 checksums are recorded in each model's `PROVENANCE.json`. No live Poly Haven API request is made while playing.

## Compression runtime

`basis/basis_transcoder.js` and `basis/basis_transcoder.wasm` are the Basis Universal transcoder bundled with Three.js r180, [Binomial LLC](https://github.com/BinomialLLC/basis_universal), Apache 2.0; the license is in `basis/LICENSE`. Three.js GLTFLoader, KTX2Loader and MeshoptDecoder are bundled through the existing Three.js dependency (MIT). Offline mesh optimization uses glTF Transform and meshoptimizer; these are build tools, with no added runtime package dependency.
