# Flame crescent: the mesh a ribbon of fire is drawn on. Run headless:
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P blender/make_ribbon.py -- public/models/ribbon.glb
# A banked, cupped blade swept along 118 degrees of a unit circle: pointed tail (u = 0), broad
# shoulder near the head (u = 1). UV.x runs tail to head, UV.y runs inner edge to outer edge.
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index("--") + 1]
SEG_U, SEG_V = 72, 10
SPAN = math.radians(118)
BANK = math.radians(70)        # how far the blade stands up out of the floor plane

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("FlameCrescent")
bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new("UVMap")

def width(u):
    # pointed at both ends, widest at about three quarters of the way to the head
    return 0.68 * (math.sin(math.pi * u ** 0.62) ** 0.85) * (0.35 + 0.65 * u)

rows = []
for i in range(SEG_U + 1):
    u = i / SEG_U
    a = u * SPAN
    centre = Vector((math.cos(a), math.sin(a), 0.0))
    radial = Vector((math.cos(a), math.sin(a), 0.0))
    tangent = Vector((-math.sin(a), math.cos(a), 0.0))
    up = Vector((0.0, 0.0, 1.0))
    w = width(u)
    bank = BANK + 0.55 * (1.0 - u)                 # the tail curls up and over
    rot = Matrix.Rotation(-bank, 3, tangent)       # negative: the outer edge lifts off the floor
    across = rot @ radial                          # the blade's width direction
    normal = rot @ up
    row = []
    for j in range(SEG_V + 1):
        s = j / SEG_V * 2.0 - 1.0
        cup = (1.0 - s * s) * w * 0.3              # cupped, like a tongue of flame
        p = centre + across * (s * w * 0.5 + w * 0.5) + normal * cup
        p.z += 0.05 * math.sin(u * math.pi) + 0.02
        row.append((bm.verts.new(p), u, j / SEG_V))
    rows.append(row)

for i in range(SEG_U):
    for j in range(SEG_V):
        quad = [rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]]
        f = bm.faces.new([q[0] for q in quad])
        for loop, q in zip(f.loops, quad):
            loop[uv_layer].uv = (q[1], q[2])
        f.smooth = True

bm.normal_update()
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("FlameCrescent", mesh)
bpy.context.scene.collection.objects.link(obj)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
                          export_apply=True, export_materials="NONE", export_normals=True, export_texcoords=True)
print("wrote", out, len(mesh.vertices), "verts")
