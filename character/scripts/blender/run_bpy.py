"""Run one pipeline step with the `bpy` Python wheel instead of the Blender app (same scripts, same results).

  python scripts/blender/run_bpy.py <stage.blend | -> <script.py> [-- args...]

Equivalent to `blender -b <stage.blend> --python <script.py> -- args`: opens the file (or starts from
factory settings when "-"), then runs the script in __main__ with sys.argv as Blender would present it.
"""
import os, sys, runpy
import bpy

blend, script = sys.argv[1], sys.argv[2]
rest = sys.argv[3:]
if blend != "-":
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
sys.argv = ["blender", "--python", script] + rest
runpy.run_path(script, run_name="__main__")
