# Third-party material

This project is MIT licensed (`LICENSE`). It bundles and builds on the material below. "Verified" means checked against
the files in this repository; anything marked **unverified** comes from the upstream project as remembered or documented
elsewhere and should be re-checked before relying on it.

## three.js r170 and its addons (`public/vendor/three`)

- `build/three.module.min.js`: three.js r170 (`REVISION = "170"`). Licence: MIT, "Copyright 2010-2024 Three.js Authors"
  (verified: SPDX header in the file; the r170 `LICENSE` is MIT).
- `addons/**`: the three.js `examples/jsm` files of the same release, MIT, same copyright holder. Source
  <https://github.com/mrdoob/three.js/tree/r170>.
- The vendored folder contains no `LICENSE` file of its own. The MIT notice must travel with copies of three.js: the
  full text is reproduced below.

Bundled decoders (the client loads these at run time through `GLTFLoader`, `DRACOLoader` and `KTX2Loader`,
`public/app/stage/character.js`):

| Files | What | Licence |
|---|---|---|
| `addons/libs/meshopt_decoder.module.js` | meshoptimizer 0.18 WebAssembly decoder (Arseny Kapoulkine) | MIT (verified: header of the file) |
| `addons/libs/draco/gltf/draco_decoder.{js,wasm}`, `draco_wasm_wrapper.js` | Draco mesh decoder, glTF build (Google) | Apache-2.0 (verified: `addons/libs/draco/README.md` states it; the Apache-2.0 text itself is not in the repository) |
| `addons/libs/basis/basis_transcoder.{js,wasm}` | Basis Universal transcoder (Binomial LLC) | Apache-2.0 (verified: `addons/libs/basis/README.md`; licence text not in the repository) |
| `addons/libs/ktx-parse.module.js`, `zstddec.module.js` | KTX 2.0 container parser and Zstandard decoder used by `KTX2Loader` | **unverified**: both are Don McCurdy's packages (MIT); the zstd decoder embeds Zstandard (BSD-3-Clause / GPL-2.0 dual licensed, used under BSD). The files carry no header |

Apache-2.0 requires a copy of the licence to accompany redistribution; add the text (<https://www.apache.org/licenses/LICENSE-2.0.txt>)
next to the Draco and Basis files, or delete them if no model uses them (see "Vendored files that look unused").

### three.js licence text

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Vendored three.js files

Only the files the client imports are vendored under `public/vendor/three`: the module build, the glTF, Draco and
KTX2 loaders, three small utilities, the room environment, the colour-space helper, the meshopt, KTX and Zstandard
decoders, and the Draco (glTF build) and Basis transcoders. `public/vendor/three/LICENSE` carries the three.js MIT text.

## Stand-in figure and skeleton template: Xbot

`public/models/standin.glb` (the only copy in this repository; the character pipeline reads the same file) is byte-identical (SHA-256 starting `002f8d269de68e5d`,
2,930,032 bytes) and is also byte-identical to `examples/models/gltf/Xbot.glb` in the three.js r170 repository (verified by
downloading it from `raw.githubusercontent.com/mrdoob/three.js/r170/...` and comparing). It is the "X Bot" character with
seven clips (`agree`, `headShake`, `idle`, `run`, `sad_pose`, `sneak_pose`, `walk`) that the three.js examples ship; it is
understood to originate from Mixamo (Adobe) (**unverified**: the file's metadata only says it was exported through Blender,
glTF I/O v1.1.46).

Terms: the stand-in figure, its skeleton and its clips derive from Adobe Mixamo, and so do the character rig and the
stand-in clips built from them (next section). The three.js repository's MIT licence does not obviously cover Mixamo
content, and the `examples/models/gltf` folder carries no per-file licence at r170. This repository's MIT licence does not
extend to these assets either: Adobe's terms govern them. Anyone redistributing this repository, or the model files on
their own, should check Adobe's current Mixamo terms first. The alternative is to replace the stand-in with an original
figure and rebuild the character skeleton from it (`character/scripts/blender/04_rig.py` reads `public/models/standin.glb`,
and the clip names in the table in `character/README.md` follow it).

## Character model: rig and clips derived from the stand-in

`public/models/gun.glb`, `gun-lite.glb` and the `gun*.usdz` files carry a 67-bone skeleton whose bone names are
`mixamorig:*`. The skeleton is the Xbot skeleton above, fitted to the character's mesh by
`character/scripts/blender/04_rig.py`, and the clips that share a name with the stand-in's (`idle`, `walk`, `run`, `agree`,
`headShake`, `sad_pose`, `sneak_pose`, and `walking`, which is the same walk under a second name) are retargeted from the
stand-in's clips. So these files contain a rig and stand-in
animation clips derived from Adobe Mixamo content (as far as the origin of Xbot could be established, see above), and the
same **unverified** terms apply to them. The other clips (`cheer`, `sit`, `celebrating`, `working`, `eating`,
`training`, `sleeping`) are described in `character/README.md` as authored from key poses in that script (**unverified**
beyond that description). The mesh, textures and morph targets are the project's own.

## Map outlines (`public/app/ui/data`, `public/app/stage/data`)

- `land-50m.json` (minimap) and `land-110m.json` (globe): TopoJSON land outlines from `world-atlas` 2.0.2 (ISC licence, Mike
  Bostock), built from Natural Earth land polygons (public domain). Verified for the 50m file from `ui/data/SOURCE.txt`; the 110m
  file is described the same way in the header comment of `stage/globe.js`, its package version is **unverified**.

## Audio

All sound files in `public/audio` are generated by `scripts/audio/render.mjs` from code, with no samples. The pink-noise
source in `scripts/audio/dsp.mjs` is a three-pole filter in the manner of Paul Kellet's pink noise filter
(<https://www.musicdsp.org>); the coefficients in the file are not the ones Kellet published, so it is credited as inspiration, not
copied (**unverified** against the original).

## Fonts and icons

No font files are bundled: the stylesheets name system and optional fonts (Inter, Didot and fallbacks) and fall back to
what the device has. Icons under `public/img` are the project's own (not checked against any external source).

## Tools used to build the character (acknowledgements, not licences)

The demo character was made with the help of: OpenAI image models (character sheets and painted views), Tencent
Hunyuan3D-2.1 through a Hugging Face Space (image to 3D shape), Blender (mesh, texture bake, rig, export), Google MediaPipe
(face landmarks), gltfpack / meshoptimizer by Arseny Kapoulkine (compression), ImageMagick, and `uv`. Use of each tool's output
is subject to that tool's own terms; check them before publishing characters you generate.
