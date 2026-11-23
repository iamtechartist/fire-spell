# Look at a rigged Meshy character from every side in plain light, and list what is in the file.
#   Blender -b -P blender/check_model.py -- art_src/meshy/mage-all-clips.glb /out/dir mage
import bpy, sys, math, json
from mathutils import Vector

src, out, name = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
tris = 0
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
size = hi - lo
centre = (lo + hi) / 2
info = {
    "meshes": len(meshes), "triangles": tris, "size_m": [round(v, 3) for v in size],
    "min": [round(v, 3) for v in lo], "armatures": [[a.name, len(a.data.bones), [round(s, 4) for s in a.scale]] for a in arms],
    "actions": [[a.name, round((a.frame_range[1] - a.frame_range[0]) / bpy.context.scene.render.fps, 2)] for a in bpy.data.actions],
    "images": [[i.name, i.size[0], i.size[1]] for i in bpy.data.images if i.size[0]],
    "bones": [b.name for b in arms[0].data.bones][:80] if arms else [],
}
print("INFO " + json.dumps(info))

# rest pose for the look: no action playing
for a in arms:
    if a.animation_data:
        a.animation_data.action = None
    for pb in a.pose.bones:
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception as e:
    print("cpu", e)
scene.render.resolution_x, scene.render.resolution_y = 640, 880
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.35, 0.36, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scene.collection.objects.link(sun)
sun.data.energy = 2.5; sun.rotation_euler = (math.radians(50), 0, math.radians(35))

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 70
H = max(size.z, size.x * 1.25)

def shot(tag, az, target, dist, lens=70):
    cam.data.lens = lens
    a = math.radians(az)
    cam.location = target + Vector((math.sin(a) * dist, -math.cos(a) * dist, dist * 0.06))
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (math.radians(52), 0, a + math.radians(30))
    scene.render.filepath = f"{out}/{name}_{tag}.png"
    bpy.ops.render.render(write_still=True)

dist = H * 3.1
for tag, az in [("front", 0), ("right", 90), ("back", 180), ("three_quarter", -35)]:
    shot(tag, az, centre, dist)
head = Vector((centre.x, centre.y, hi.z - size.z * 0.09))
shot("face", 12, head, size.z * 0.75, 85)
