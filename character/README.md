# Character pipeline

How the playable 3D character was built, as scripts you can adapt to build your own: reference photos, an image model
for character sheets, an image-to-3D model for the shape, then Blender for mesh, textures, rig, clips, morph targets and
export. Everything after the pictures is scripted and re-runs in a few minutes.

> **This folder ships without the source images** (photos, generated sheets, shapes, painted views, work files). They
> belong to a real person and are not published, so **the pipeline cannot be run as it stands**: you supply your own
> inputs (see "Bring your own photos"). The finished demo model files stay in `../public/models` and
> `../public/img`; they were produced by these scripts from the author's own photos. Without a character of your own the
> client shows the stand-in figure (`../public/models/standin.glb`).

## Bring your own photos

What the pipeline needs from you, and where it goes (all of these paths are git-ignored):

| Input | Where | Notes |
|---|---|---|
| 6 to 12 photos of the subject | `refs/selected/*.jpg` | Face from the front and three-quarter, full body, varied light, no heavy filters. JPEG (convert HEIC with `sips -s format jpeg` or `magick`). Only people who agreed to be modelled: do not commit photos of anyone |
| Optional body-proportion reference | `refs/body-reference.png` | A full-body cut-out, used to check proportions against the generated sheet |
| Description of the character | `appearance.json` | Copy `appearance.example.json`. Height, build, likeness (hair, face, skin), the base clothes. `scripts/gen_image.py` fills the `{{KEY}}` placeholders in `prompts/*.txt` from it |
| Landmark picks | `config.json` | Copy `config.example.json`. Pixel positions read off your own sheets (see "Landmarks"). The example values are placeholders |
| Image model key | env `OPENAI_API_KEY` (or `GEMINI_API_KEY`), or `work/.openaikey` / `work/.geminikey` | Paid calls; each is logged with a rough cost estimate in `work/SPEND.md`. The model name is `IMAGE_MODEL` for `outfits.sh`, the second argument of `gen_image.py` otherwise |
| Hugging Face token (optional) | env `HF_TOKEN` | Raises the quota of the free shape Space |
| Wardrobe photos (optional) | `refs/cutouts/<item>.jpg` and `outfits.json` | For alternate outfits, see "Outfits" |

Layout after you start: `sheets/` (generated character sheets: `body_front`, `body_back`, `bust_front`, painted side and
back views), `src/shapes/` (`body.glb`, `bust.glb` from the image-to-3D step), `work/` (every intermediate and
`work/out/` for the results). None of it is committed.

## What it builds

| file | what |
|---|---|
| `work/out/gun.glb` | one skinned mesh (2 materials: head, body), 67-bone Mixamo-named skeleton, 15 clips, 8 morph targets (3 body, 5 face), 2K colour + normal and 1K roughness per material (JPEG), no compression extensions. Y-up, metres, feet at the origin, facing +Z, scaled to `height_m` from the config |
| `work/out/gun.usdz` | same mesh, skeleton and textures (PNG) with the `idle` clip baked on the default time line, for SceneKit / RealityKit. No morph targets |
| `work/out/gun-<clip>.usdz` | one per activity clip (`sleeping`, `working`, `eating`, `training`, `walking`, `celebrating`): same mesh and skeleton, that one animation, textures embedded at 1K. About 7 MB each |
| `work/out/gun-lite.glb` | phone tier, under 1 MB: same 67 bones and names, same `lean` / `heavy` / `muscular` body morphs and `blink` / `blinkL` / `blinkR` / `smile` / `browUp` face morphs, about 25k triangles, 1K colour + normal and 512 px roughness (JPEG), clips `idle`, `walking`, `training`, `sleeping`, `working`, `eating`, `celebrating`. Needs the meshopt decoder (`EXT_meshopt_compression` + `KHR_mesh_quantization`) |
| `work/out/gun.webp`, `gun-full.webp` | 512x512 head-and-shoulders and 760x1280 full-body renders of the GLB, transparent |

`gun` is the id the engine uses for the player's character (`public/models/<id>.glb`). It is an internal key, never
shown; keep it so the client finds your files.

Clips (all in place; bone names match `public/models/standin.glb`):

| clip | length | what |
|---|---|---|
| `idle` | 2.5 s loop | standing, breathing, weight shift (from the Xbot template) |
| `walk`, `walking` | 0.97 s loop | the same walk under both names |
| `run` | 0.7 s loop | from the template |
| `agree`, `headShake` | 1.8 s, 2.6 s | from the template |
| `cheer`, `celebrating` | 2.4 s | arms up twice, back to idle; the same motion under both names |
| `sit` | 3 s loop | on a 46 cm seat, hands on thighs |
| `working` | 3.2 s loop | seated, forearms forward at desk height, hands tapping in turn, small head moves |
| `eating` | 3.2 s loop | seated, right hand from table to mouth and back |
| `training` | 2.6 s loop | bodyweight squat, arms reach forward at the bottom |
| `sleeping` | 4 s loop | on the back, centred on the origin, head toward -Z, one hand on the stomach, slow breath |
| `sad_pose`, `sneak_pose` | additive | key 0 is the reference stance, the rest is the pose held: `AnimationUtils.makeClipAdditive(clip)` then `subclip(clip, name, 2, 3, 30)`, blend mode `THREE.AdditiveAnimationBlendMode` |

Seated clips have no chair: the stage supplies a seat 46 cm high under the hips (hips are about 0.42 m behind the feet).
The seat and the sleeping mat are the stage's; the root never leaves the origin.

## Requirements

Blender 5.x (or the `bpy` wheel through `scripts/blender/run_bpy.py`, for machines where the Blender app cannot start
headless: same scripts, same results; point `BLENDER` at a wrapper that calls it), `uv` (runs the numpy / pillow / scipy
helpers), `npx` (gltfpack), ImageMagick (`magick`), Python 3 with `gradio_client` for the shape step, Node with the
`playwright` package (`npm i -D playwright` at the repository root) for the verify screenshots, mediapipe (fetched by
`uv run --with` for the face landmarks). Xcode command line tools (`usdchecker`, `swift`) are only needed to check the
USDZ files on macOS.

Environment: `BLENDER` (Blender executable, default `blender`), `CHAR` and `WOG_PEOPLE` (a second character, see below),
`CUTOUTS` (wardrobe photos, default `refs/cutouts`), `IMAGE_MODEL`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`, `HF_TOKEN`,
`FACE_MODEL` (path of the mediapipe face model, downloaded on first use to `work/face_landmarker.task`).

## Pipeline

1. **Reference photos.** `refs/selected/` holds the curated set (see "Bring your own photos").
2. **Character sheet (image model).** `scripts/gen_image.py openai <model> <out> <prompt> <size> high <refs...>`
   with the prompts in `prompts/`: `sheet_front.txt` (A-pose, 1024x1536, six reference photos), then
   `sheet_front_lean.txt` (that sheet as image 1 plus body photos: redraw at the real build, with the fingers apart),
   `sheet_back.txt` (front sheet as reference), `bust_front.txt` (1024x1024, "do not idealise"). Results go in
   `sheets/`. The prompts are templates; `appearance.json` fills in the description.
3. **Shapes (free).** `scripts/hf_hunyuan21_shape.py <out.glb> <image>` runs Hunyuan3D-2.1 shape-only on the public Hugging
   Face Space, once for the body sheet (`OCTREE=512`, needed for separate fingers) and once for the bust
   (`src/shapes/`). The anonymous ZeroGPU quota is about two body runs a day per IP: when it refuses, wait for it
   instead of working around it. The textured mode needs a paid account. `scripts/hf_hunyuan21.py` is the multi-view variant,
   `scripts/fal.py` a minimal client for a hosted alternative.
4. **Landmarks.** `config.json` holds about twenty pixel positions read off the two front pictures (head top, chin,
   shoulders, elbows, wrists, fingertips, hips, knees, ankles). Re-pick them when a sheet changes; nothing else is
   hand-placed. `config.example.json` has placeholder values for a 1024x1536 sheet: open your prepared sheet
   (`work/prep/body_front_pad.png`) in any image viewer and read the pixel coordinates.
5. **Mesh.** `01_build_mesh.py` scales the body to `height_m` and seats the bust on it. The two shapes never agree on
   the neck, so the body is cut 1.8 cm under the chin and each horizontal ring of the bust below the jaw line is
   rescaled to run from the bust's own outline at the jaw to the body's outline at the cut. Then a 2.2 mm voxel remesh,
   a smoothed seam, and decimation of head / hands / body to their own triangle budgets (17k / 7k / 32k).
6. **Side and back views.** `02_clay_views.py` renders grey clay views of that mesh (head right, left, back; body right,
   left). The image model paints over each one (`prompts/head_*.txt`, `prompts/body_*.txt`, clay render as image 1,
   front sheet as image 2), so the painted views line up with the mesh. `prep.sh` cuts all pictures off their backdrop
   (`prep_images.py`: the hem growth that keeps dark cloth edges clean uses a round footprint; `HEM_SOLID=1` restricts it
   to solid dark garments) and registers painted views to their clay silhouettes (IoU 0.97 to 0.99).
7. **Textures.** `03_texture.py` projects the eight pictures onto the high mesh, weighted by how squarely each view sees a
   surface, with a per-view occlusion test, and fills what no view sees by spreading the nearest seen colour over the
   surface. Head pictures own the head and, down the neck, every spot where the body pictures also show skin, so skin has
   one tone from face to collar and the head/body seam sits on the shirt edge. Where body pictures disagree at a hem,
   cloth wins (config `cloth_wins`). Every high-mesh vertex is classed skin or cloth from the sharp body pictures and
   colour is only ever filled within its class (the collar rules: `collar_rules`, `soft_collar`, `soft_collar_steps`;
   also `head_own_below_chin_m`, `head_fallback_body`, `projectors`). Colour and a tangent normal map are baked to the
   game mesh; roughness is derived from colour.
8. **Rig, clips, morphs.** `04_rig.py` fits the Xbot skeleton (`../public/models/standin.glb`, see `../THIRD-PARTY.md`) to the
   landmarks, binds with automatic weights (head rigid; fingers ride on the hand bone, config `rigid_hands`), transfers
   Xbot's clips by world rotation delta, authors the other clips from key poses (`body_pose(...)`: pelvis position, chest /
   pelvis / head pitch, arm directions, two-bone leg IK or leg directions, optional whole-body rotation for lying down)
   and adds the morph targets.
9. **Export.** `05_export.py` writes the GLB, `06_export_usdz.py` the USDZ (`-- <clip> <out.usdz>` exports another clip to
   another file; USD has one time line per file). `07_export_lite.py` writes the phone-tier model (below).
10. **Renders.** The two WebP images are screenshots of `verify/index.html` (see Verify) with `bg=0`.

`./build.sh [1-5]` runs steps 5 to 9 from the given stage into `work/out/` (`PAINT_STOP=1` stops after the clay views so
they can be painted; `./rebuild_from3.sh` is the re-bake + export shortcut). `build.sh` writes to `work/out/` only;
`./publish.sh` copies the deliverables into `../public/` under a temp name and renames them (atomic), so a running app
never reads a half-written file; `./portraits.sh` re-renders the two WebP images (needs a static server on the
repository root, see Verify).

**Lite model.** `07_export_lite.py` (run by `build.sh` step 5) decimates the game mesh per region (head 10k, hands 2.6k,
body 12.4k triangles; morphs ride through as vertex weights and are rebuilt), gives it new UVs, re-bakes 1K textures
from the full mesh (both in a spread-arm pose so nothing overlaps), keeps the seven activity clips and writes
`work/out/gun-lite.raw.glb` (plain glTF). `build.sh` then runs `npx gltfpack@1.3.0 -cc -kn -km -ke` on it: quantized
attributes + meshopt compression, bone, material and morph names kept, textures untouched. If gltfpack cannot be fetched
the raw file ships instead. It loads through three r170's `GLTFLoader.setMeshoptDecoder` with the vendored
`addons/libs/meshopt_decoder.module.js`. Compared with the full model it has a few dark specks on the shirt front and soft
speckle on the neck in a close-up; face and silhouette match.

**Per-clip USDZ.** USD has one time line per file, so a native Apple TV app gets one file per clip. `build.sh` step 5
exports them (list: `ACTIVITY_CLIPS` at the top of `build.sh`). Each file embeds its own textures at 1K: SceneKit does
not reliably resolve references from one .usdz into another. `training` reports a slightly shorter length in SceneKit
because its last 0.23 s is a held pose that is trimmed; the loop is still seamless.

## Verify

```
python3 -m http.server 8791 --bind 127.0.0.1 &          # from the repository root
cd character && node scripts/shots.mjs 8791 qc "idle_front|clip=idle&t=0.4&view=front&hud=0" ...
swift scripts/check_usdz.swift work/out/gun.usdz qc/usdz_scenekit.png          # macOS: [second time] [stand|floor]
usdchecker --arkit work/out/gun.usdz
python3 scripts/inspect_glb.py work/out/gun.glb
```

`verify/index.html` loads `work/out/gun.glb` (or `model=/public/models/gun.glb`, any model) with the vendored three.js and
takes `clip`, `t`, `view`, `cam`, `look`, `morph=heavy:1` (also `blink:1`, `smile:1`), `add=sad_pose:1`, `bg=0`,
`tex=/public/tex/gun_body_<outfit>` (an outfit's baked maps on the body material; `_lite` for the phone model) and `flat=1`
(clay grey, to tell a texture edge from a geometric one). Useful checks: a contact sheet of every clip, the three body
morphs at 0 and 1, a hand close-up, the neck from the side and the back, the USDZ in SceneKit.

## Body morphs

The base mesh is the subject's build as photographed, drawn as an ordinary body (not athletic, not heavy). The three morph
targets move away from that base on the same topology (displacement along the normal, weighted by bone ownership, so they
follow every clip). The client sets `mesh.morphTargetInfluences[mesh.morphTargetDictionary.<name>]` on both primitives.

Recommended mapping from a scale reading (weight `w` in kg, body fat `bf` as a fraction). `baseFatKg` and `baseLeanKg`
are the fat and lean mass of the build the sheets were drawn at:

```
fatKg  = w * bf              leanKg = w * (1 - bf)
heavy    = clamp((fatKg  - baseFatKg) / 15.0, 0, 1)
lean     = clamp((baseFatKg - fatKg)  /  5.9, 0, 1)
muscular = clamp((leanKg - baseLeanKg) / 13.6, 0, 1)
```

Example for a base of 80 kg at 20 % (fat 16.0 kg, lean 64.0 kg):

| reading | fatKg | leanKg | heavy | lean | muscular |
|---|---|---|---|---|---|
| 80 kg, 20 % (the base) | 16.0 | 64.0 | 0 | 0 | 0 |
| 76 kg, 15 % | 11.4 | 64.6 | 0 | 0.78 | 0.04 |
| 88 kg, 25 % | 22.0 | 66.0 | 0.40 | 0 | 0.15 |
| 84 kg, 14 % | 11.8 | 72.2 | 0 | 0.72 | 0.61 |

Sizes at weight 1 (`04_rig.py`, "body morph targets"): `heavy` up to 34 mm at the belly, `lean` up to 14 mm off the waist
and thighs, `muscular` up to 14 mm on upper arms, shoulders, chest and thighs. The end points are estimates (waist grows
about 1 cm per kg of fat); check them against a photo and adjust the divisors. To update the base build later, retake
one front and one back full-body photo in the A-pose against a plain wall, use them in step 2 in place of the old body
photos, redo steps 3 to 4 for the body only, then `./build.sh`. The head pictures and bust shape stay.

## A second character

The same pipeline builds another person's character from your own photos of them: `CHAR=<name> ./build.sh`. Only
`people/<name>/config.json` and `people/<name>/prompts/*.txt` belong in the repository for this; sheets, paintings, shapes
and work files live under `$WOG_PEOPLE/<name>/` (default `work/people`, git-ignored). Outputs are `<name>.glb` and
`<name>-lite.glb`. Differences from the main build, all driven by the config:

- **No bust shape.** One shape run per person (front sheet only). The config has no `bust` key, so `01_build_mesh.py` keeps
  the body shape's own head, cuts a nominal neck line `neck_cut_below_chin_m` under the chin for the head's texture set
  and triangle budget, and writes a synthetic 1024-square head frame as `bust_front` in `build.json`.
- **Face from painted clay views.** `views` lists `head_F` as well as `head_R/L/B` and `body_R/L`; `02_clay_views.py`
  renders them, the image model paints each over its clay render with the person's photos as references, `prep.sh cut` +
  `align` register them, and `projectors` in the config replaces the bust projector with the painted `head_F` (gain 3).
  With `head_fallback_body: true` the body sheets own any head surface no head painting sees.
- **Texture rules as config keys** for long hair and light clothes: `cloth_wins` (default on: where one body picture sees
  dark cloth and another sees skin, cloth wins; switch off when the hair is darker than the top) and
  `head_own_below_chin_m` (default 0.012: how far below the chin the head paintings own the surface outright; raise it
  to 0.10 so long hair over the shoulders comes from the sharp head paintings). `collar_rules: false` and
  `soft_collar: false` switch the collar passes off.
- **Landmarks** can come from MediaPipe pose on the front sheet, with the chin corrected by eye; `height_m` is an assumed
  average (`height_assumed: true`) unless you know a real one.
- Morph targets are built the same way but body weights apply to the main character only. No face morphs without a bust
  sheet. No USDZ.

Order: sheets, then `scripts/hf_hunyuan21_shape.py` (front sheet, `OCTREE=512`), `CHAR=<name> PAINT_STOP=1 ./build.sh 1`
(mesh + clay views), paint the six views, `CHAR=<name> ./build.sh 3`, verify with
`verify/index.html?model=/public/models/<name>.glb`, copy into `public/models/`.

## Outfits

Same cut, different look (colour, print, fabric): an outfit is a set of real wardrobe items painted onto the same body as a
texture set. Describe the outfits in `outfits.json` (copy `outfits.example.json`) and put one photo per item in
`refs/cutouts/`. `scripts/outfit_prompts.py` writes `prompts/outfits/<outfit>_{front,back,L,R}.txt` (the SAME sheet
picture with only the clothes changed, with the item photos as references); `./outfits.sh gen <outfit>` repaints the four
body views into `work/outfits/<outfit>/` (four image calls); `./outfits.sh bake <outfit>` cuts and aligns them
(`HEM_SOLID=1`: the hem growth in `prep_images.py` grows only solid dark garments, not the stray dark fibres of a heather
fabric), runs `03_texture.py` with `OUTFIT=<outfit>` (skin against cloth is decided by skin tone in the outfit's own
pictures, through a synthetic class luminance so the dark-base thresholds keep working; a sleeveless top bares the
shoulders the base sleeve covered, so the yoke rule yields where the look shows skin; the clamp that pulls light texels on
cloth to the fill is relative to the look's cloth colour), then `07_export_lite.py` with `OUTFIT=` (same decimation and UVs
as the shipped lite model, colour and ORM baked from the outfit's full-mesh maps, no export) and publishes
`public/tex/gun_body_<outfit>.jpg` + `_orm.jpg` (2048 / 1024) and `_lite.jpg` + `_lite_orm.jpg` (1024 / 512). The normal
maps are geometry only and stay the model's. The client swaps the body material's `map` and roughness/metalness maps at
run time (`stage.setOutfit(id)`; manifest `public/tex/outfits.json`; Wardrobe tab, "Looks").

**The baked maps depend on the mesh and its UVs**: after any rebuild of the GLB or the lite GLB (steps 1 to 5) run
`./outfits.sh all` (a few minutes per outfit, no image calls). Sleeveless looks are painted on the sleeved cut, so a
faint sleeve line stays on the upper arms; a sleeveless garment proper needs the route below. `verify/index.html?tex=...`
previews a set on either model. Head and body are separate materials for this reason; the seam is under the jaw.

**Different cut (jeans, hoodie, button-up, cap):** a separate garment mesh on the same skeleton. Generate the garment on
the character with steps 2 and 3, cut it from the body, then transfer weights from the character (Blender Data Transfer
modifier, vertex groups, nearest face interpolated) and export it alone with this armature. In three.js bind it with
`garment.bind(body.skeleton)` so one mixer drives both, and hide the covered body triangles (a mask texture in the alpha
channel of the body material is enough). A bare body under the clothes (so shorter garments look right) does not exist:
the model is one clothed surface. Generating an unclothed base is the first step of a real wardrobe system.

## Face morph targets (blink, smile, brow)

`scripts/face_landmarks.py` (mediapipe, run by `build.sh` before step 4 when `work/face_landmarks.json` is missing) reads
478 face landmarks off `sheets/bust_front.png`; `scripts/blender/face_morphs.py` turns the eye corners, lids, mouth
corners, cheeks and brow points into displacements on the game mesh, in the bust sheet's own pixel-to-metre mapping from
`work/build.json`:

| target | what moves |
|---|---|
| `blink`, `blinkL`, `blinkR` | the upper-lid skin comes down over the eye (up to 9 mm), the eye surface sinks 3 mm behind it, the lower lid rises a little. At 1.0 the eye is shut; the half-way frame is a squint |
| `smile` | mouth corners 4 mm up and 2.4 mm out, tucked back; cheeks up and forward |
| `browUp` | the brow line 3 mm up, the skin above it following |

The same function runs again on the decimated phone mesh in `07_export_lite.py`, so the lite model carries the same names.
The USDZ files have no morphs. The stage drives them (`public/app/stage/character.js`, `_face`): blink every 3 to 7 s
(120 ms shut, 180 ms open, one in seven a double), eyes shut while the sleeping clip plays, a resting trace of smile that
grows when the camera is within about two metres, on arrival and on a pulse, a brow lift on a glance. A new bust sheet only
needs `rm work/face_landmarks.json`.

## Known limits

- **Face.** The head is a generated picture of the subject, not a scan: right face shape, brows, colouring and smile, but
  smoother and a few years younger than the photos, and the mouth is closed.
- **Neck.** Geometry is continuous. The skin under the jaw and the bottom of the nape is filled colour, not painted detail.
  Every high-mesh vertex is classed skin or cloth from the sharp body pictures (`03_texture.py`, "skin or cloth"), unseen
  vertices take the class of their nearest classed neighbour, colour is only ever filled within a class, and the bake clamps
  anything light on cloth (or dark on the neck skin) to the class's own fill. The lofted neck base more than 7 cm off the
  axis is shoulder yoke under the shirt and is left to the body pictures. The neckline is smooth because the hem growth in
  `prep_images.py` uses a round footprint (a square one drew every diagonal edge as a 21 px sawtooth) and the "soft collar"
  pass in `03_texture.py` (config `soft_collar`, default on) lets a squarely seen sheet keep its own neckline.
  `verify/index.html?flat=1` renders clay grey to tell a texture edge from a geometric one.
- **Hands.** Thumb, index and middle finger are separate; ring and little finger are partly fused. The fingers do not bend
  (they ride on the hand bone), so there are no fists and no grip.
- **Hems.** A thin lighter rim remains on some sleeve and shorts edges.
- **No facial rig.** Five procedural morph targets stand in for one: a blink that reads well at any distance, a slight smile
  and a brow lift; no speech, no gaze from the eyes themselves (the head turns).
- Textures are painted pictures with baked soft light, not measured albedo.
- A photogrammetry-grade likeness needs a real capture: a turntable phone video of the head (or Polycam / RealityScan)
  replaces steps 2, 3 and 6 for the head.

## Acknowledgements

Image generation (OpenAI image models, Google Gemini image models), image-to-3D (Tencent Hunyuan3D-2.1 via a Hugging Face
Space), face landmarks (MediaPipe), mesh and rig (Blender), skeleton and base clips (the three.js "Xbot" example model),
compression (gltfpack / meshoptimizer). See `../THIRD-PARTY.md`.
