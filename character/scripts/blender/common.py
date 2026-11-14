"""Shared helpers for the headless Blender steps (import with sys.path.insert)."""
import bpy, json, os, math
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# A second character: CHAR=<name> reads character/people/<name>/config.json and keeps every work file under
# $WOG_PEOPLE/<name>/work (default character/work/people). Without CHAR the main character is built.
CHAR = os.environ.get("CHAR", "").strip()
WORK = os.path.join(os.path.expanduser(os.environ.get("WOG_PEOPLE", os.path.join(ROOT, "work", "people"))), CHAR, "work") if CHAR else os.path.join(ROOT, "work")


def P(*a):
    if CHAR and a and (a[0] == "work" or a[0].startswith("work/")):
        return os.path.join(WORK, *([a[0][5:]] if a[0] != "work" else []), *a[1:])
    return os.path.join(ROOT, *a)


def cfg():
    path = P("people", CHAR, "config.json") if CHAR else P("config.json")
    if not os.path.exists(path):
        raise SystemExit(f"missing {path}: copy config.example.json to config.json and fill in your own pixel picks (README, Landmarks)")
    return json.load(open(path))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    ob.name = name
    ob.data.materials.clear()
    return ob


def co(ob):
    a = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_co(ob, a):
    ob.data.vertices.foreach_set("co", np.ascontiguousarray(a, np.float32).ravel())
    ob.data.update()


def activate(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def smooth_shade(ob):
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    ob.data.update()


def setup_preview(scene, res=(900, 1200), transparent=True, engine="BLENDER_EEVEE"):
    scene.render.engine = engine
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    bg = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.55


def ortho_cam(scene, name, center, direction, scale, clip=10.0):
    """Orthographic camera looking along `direction` (unit vector) at `center`."""
    cam = bpy.data.cameras.new(name)
    cam.type = "ORTHO"
    cam.ortho_scale = scale
    cam.clip_end = clip * 3
    ob = bpy.data.objects.new(name, cam)
    scene.collection.objects.link(ob)
    d = Vector(direction).normalized()
    ob.location = Vector(center) - d * clip
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def add_sun(scene, direction, strength=2.5, name="sun"):
    l = bpy.data.lights.new(name, "SUN")
    l.energy = strength
    l.angle = math.radians(25)
    ob = bpy.data.objects.new(name, l)
    scene.collection.objects.link(ob)
    ob.rotation_euler = Vector(direction).normalized().to_track_quat("-Z", "Z").to_euler()
    return ob


def clay(name="clay", color=(0.72, 0.72, 0.72)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = 0.75
    return m


def render(scene, cam, path):
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
