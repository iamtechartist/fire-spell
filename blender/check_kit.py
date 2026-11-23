# Plain-light look at the court kit: three bays with lanterns, a post, the brazier.
import bpy, sys, math
from mathutils import Vector
src, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
obs = {o.name: o for o in sc.objects}
W = 2.395
def copy(name, x, y=0.0):
    o = obs[name].copy(); sc.collection.objects.link(o); o.location = (x, y, 0); return o
for k in (-1, 1):
    for n in ("Bay_Stone", "Lantern_Iron", "Lantern_Glass"):
        copy(n, k * W)
for n in ("Post_Stone", "Post_Iron", "Post_Glass"):
    obs[n].location = (-1.2, -3.0, 0)
for n in ("Brazier_Stone", "Brazier_Bronze", "Brazier_Coal"):
    obs[n].location = (1.6, -3.4, 0)
cols = {"Stone": (0.55, 0.52, 0.47), "Iron": (0.03, 0.03, 0.035), "Glass": (0.9, 0.55, 0.15), "Bronze": (0.25, 0.15, 0.07), "Coal": (0.02, 0.02, 0.02)}
for m in bpy.data.materials:
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b and m.name in cols:
        b.inputs["Base Color"].default_value = (*cols[m.name], 1)
        b.inputs["Roughness"].default_value = 0.35 if m.name in ("Iron", "Bronze") else 0.8
        if m.name in ("Iron", "Bronze"): b.inputs["Metallic"].default_value = 0.9
bpy.ops.mesh.primitive_plane_add(size=60)
sc.render.engine = "CYCLES"; sc.cycles.samples = 32; sc.cycles.use_denoising = True
try:
    p = bpy.context.preferences.addons["cycles"].preferences; p.compute_device_type = "METAL"; p.get_devices()
    for d in p.devices: d.use = True
    sc.cycles.device = "GPU"
except Exception as e: print(e)
sc.render.resolution_x, sc.render.resolution_y = 1400, 800
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.55, 0.62, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.7
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
sun.data.energy = 3.0; sun.data.angle = 0.05; sun.rotation_euler = (math.radians(58), 0, math.radians(-40))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 38
cam.location = (2.2, -10.5, 3.4)
cam.rotation_euler = (Vector((0.1, 0, 2.0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
