#!/bin/bash
# Re-bake textures (step 3 only) with the bpy shim, then rig + export from step 4. Log to stdout.
cd "$(dirname "$0")"
export BLENDER="${BLENDER:-blender}"
"$BLENDER" -b work/stage1.blend --python scripts/blender/03_texture.py 2>&1 | grep -E "class:|fill:|baked|Traceback|Error:|^  File"
./build.sh 4
