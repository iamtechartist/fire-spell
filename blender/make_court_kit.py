# The lamp court kit: one arcade bay (low wall, paired columns, arch), a hanging lantern, a lantern
# post and the great brazier. Run headless:
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P blender/make_court_kit.py -- public/models/court.glb
# Each part is its own object, split by material (Stone, Iron, Glass, Bronze, Coal), so the page can
# instance it and light the glass. Local frame: X along the wall, -Y toward the court, Z up.
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
W = 2.395                      # bay width: 33 bays round a 12.6 m circle
MATS = {n: bpy.data.materials.new(n) for n in ("Stone", "Iron", "Glass", "Bronze", "Coal")}


def finish(bm, name, mat, bevel=0.012, smooth_angle=38):
    if bevel:
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.calc_face_angle(0) > math.radians(50)], offset=bevel, segments=2, profile=0.6, affect="EDGES")
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(MATS[mat])
    mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL"); mod.keep_sharp = True
    try:
        me.shade_auto_smooth = True
    except Exception:
        pass
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    except Exception:
        pass
    bpy.ops.object.modifier_apply(modifier="wn")
    ob.select_set(False)
    return ob


def box(bm, x0, x1, y0, y1, z0, z1):
    vs = [bm.verts.new((x, y, z)) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        bm.faces.new([vs[i] for i in f])


def lathe(bm, profile, seg=32, cx=0.0, cy=0.0, sides=None):
    """profile: [(radius, z)], bottom to top. sides=n makes a prism (n flat sides)."""
    n = sides or seg
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((cx + r * math.cos(i / n * math.tau + (math.pi / n if sides else 0)), cy + r * math.sin(i / n * math.tau + (math.pi / n if sides else 0)), z)) for i in range(n)])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])


def column(bm, cx, cy, z0, h, r):
    # square plinth, two rolls and a hollow at the foot, a shaft that swells then narrows, a bell capital
    box(bm, cx - r * 1.55, cx + r * 1.55, cy - r * 1.55, cy + r * 1.55, z0, z0 + r * 0.7)
    zb = z0 + r * 0.7
    prof = [(r * 1.5, zb), (r * 1.52, zb + r * 0.18), (r * 1.3, zb + r * 0.38), (r * 1.16, zb + r * 0.5), (r * 1.3, zb + r * 0.62),
            (r * 1.32, zb + r * 0.78), (r * 1.08, zb + r * 0.95)]
    top = z0 + h
    for i in range(9):
        t = i / 8
        prof.append((r * (1.0 + 0.045 * math.sin(t * math.pi * 0.9) - 0.13 * t), zb + r * 0.95 + (top - r * 1.9 - zb - r * 0.95) * t))
    zc = top - r * 1.9
    prof += [(r * 1.02, zc + r * 0.15), (r * 0.98, zc + r * 0.3), (r * 1.08, zc + r * 0.6), (r * 1.4, zc + r * 1.15), (r * 1.62, zc + r * 1.5), (r * 1.6, zc + r * 1.62)]
    lathe(bm, prof, 20, cx, cy)


def cage(bm_iron, bm_glass, cx, cy, z0, r, h, hang=True):
    # six-sided lamp: plates top and bottom, corner bars, two bands; glass just inside
    lathe(bm_iron, [(r * 0.5, z0 - 0.03), (r * 1.08, z0), (r * 1.08, z0 + 0.03)], cx=cx, cy=cy, sides=6)
    lathe(bm_iron, [(r * 1.18, z0 + h), (r * 1.2, z0 + h + 0.03), (r * 0.72, z0 + h + r * 0.75), (r * 0.2, z0 + h + r * 1.25), (r * 0.12, z0 + h + r * 1.6), (0.0, z0 + h + r * 1.75)], cx=cx, cy=cy, sides=6)
    for i in range(6):
        a = i / 6 * math.tau + math.pi / 6
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        box(bm_iron, x - 0.011, x + 0.011, y - 0.011, y + 0.011, z0 + 0.03, z0 + h)
    for zz in (z0 + h * 0.3, z0 + h * 0.74):
        lathe(bm_iron, [(r * 1.02, zz - 0.009), (r * 1.06, zz - 0.009), (r * 1.06, zz + 0.009), (r * 1.02, zz + 0.009)], cx=cx, cy=cy, sides=6)
    lathe(bm_glass, [(r * 0.9, z0 + 0.035), (r * 0.9, z0 + h - 0.005)], cx=cx, cy=cy, sides=6)


# ---------------- arcade bay
s = bmesh.new()
box(s, -W / 2, W / 2, -0.23, 0.23, 0.0, 0.7)                       # low wall
box(s, -W / 2, W / 2, -0.31, 0.31, 0.7, 0.8)                       # its coping stone
box(s, -W / 2, W / 2, -0.27, 0.27, 0.0, 0.09)                      # a plinth course
for cy in (-0.15, 0.15):
    column(s, -W / 2, cy, 0.8, 2.22, 0.088)
box(s, -W / 2 - 0.2, -W / 2 + 0.2, -0.33, 0.33, 3.02, 3.12)        # the block the pair carries
# the arch and the wall over it: a profile with a half-round hole, pushed through the wall
R, ZS, ZT, HALF = W / 2 - 0.2, 3.12, 4.7, 0.26
N = 18
front, back = [], []
pts = [(-W / 2, ZS), (-W / 2, ZT), (W / 2, ZT), (W / 2, ZS)] + [(R * math.cos(i / N * math.pi), ZS + R * math.sin(i / N * math.pi)) for i in range(N + 1)]
for x, z in pts:
    front.append(s.verts.new((x, -HALF, z))); back.append(s.verts.new((x, HALF, z)))
s.faces.new(front); s.faces.new(list(reversed(back)))
for i in range(len(pts)):
    j = (i + 1) % len(pts)
    s.faces.new((front[j], front[i], back[i], back[j]))
# a raised band following the arch, front and back
for sgn in (-1, 1):
    ring = []
    for i in range(N + 1):
        a = i / N * math.pi
        for rr, yy in ((R, HALF), (R, HALF + 0.035), (R + 0.2, HALF + 0.035), (R + 0.2, HALF)):
            ring.append(s.verts.new((rr * math.cos(a), sgn * yy, ZS + rr * math.sin(a))))
    for i in range(N):
        for k in range(3):
            q = [ring[i * 4 + k], ring[i * 4 + k + 1], ring[(i + 1) * 4 + k + 1], ring[(i + 1) * 4 + k]]
            s.faces.new(q if sgn < 0 else list(reversed(q)))
box(s, -W / 2, W / 2, -0.34, 0.34, ZT, ZT + 0.14)                   # cornice
bmesh.ops.recalc_face_normals(s, faces=s.faces)
finish(s, "Bay_Stone", "Stone", bevel=0.01)

# ---------------- hanging lantern (hangs from the crown of the arch)
i, g = bmesh.new(), bmesh.new()
crown = ZS + R
lathe(i, [(0.011, 2.86), (0.011, crown)], 8)                        # chain, as a rod with links
for k in range(9):
    z = 2.9 + k * (crown - 2.94) / 8
    lathe(i, [(0.012, z - 0.03), (0.024, z - 0.012), (0.024, z + 0.012), (0.012, z + 0.03)], 8)
cage(i, g, 0, 0, 2.3, 0.15, 0.46)
lathe(i, [(0.03, 2.2), (0.012, 2.24), (0.03, 2.27)], 8)             # drop finial
finish(i, "Lantern_Iron", "Iron", bevel=0.0)
finish(g, "Lantern_Glass", "Glass", bevel=0.0)

# ---------------- lantern post
s, i, g = bmesh.new(), bmesh.new(), bmesh.new()
box(s, -0.34, 0.34, -0.34, 0.34, 0.0, 0.2)
box(s, -0.26, 0.26, -0.26, 0.26, 0.2, 0.34)
lathe(s, [(0.2, 0.34), (0.2, 0.42), (0.165, 0.5), (0.15, 1.3), (0.172, 1.34), (0.172, 1.42), (0.146, 1.46), (0.122, 2.24), (0.19, 2.34), (0.19, 2.4)], sides=8)
box(s, -0.21, 0.21, -0.21, 0.21, 2.4, 2.5)
cage(i, g, 0, 0, 2.53, 0.19, 0.5)
finish(s, "Post_Stone", "Stone", bevel=0.014)
finish(i, "Post_Iron", "Iron", bevel=0.0)
finish(g, "Post_Glass", "Glass", bevel=0.0)

# ---------------- the great brazier
s, b, c = bmesh.new(), bmesh.new(), bmesh.new()
lathe(s, [(1.4, 0.0), (1.4, 0.26), (1.36, 0.3), (1.02, 0.3), (1.02, 0.56), (0.98, 0.6)], 48)
lathe(b, [(0.5, 0.6), (0.52, 0.66), (0.3, 0.76), (0.18, 0.95), (0.2, 1.05), (0.42, 1.14), (0.78, 1.28), (0.98, 1.46), (1.06, 1.66), (1.1, 1.72), (1.05, 1.76), (0.96, 1.7)], 48)
for k in range(12):                                                 # rivets under the rim
    a = k / 12 * math.tau
    lathe(b, [(0.0, 1.52), (0.035, 1.53), (0.035, 1.56), (0.0, 1.58)], 8, cx=1.01 * math.cos(a), cy=1.01 * math.sin(a))
lathe(c, [(0.96, 1.66), (0.8, 1.74), (0.5, 1.8), (0.2, 1.83), (0.0, 1.84)], 32)
finish(s, "Brazier_Stone", "Stone", bevel=0.016)
finish(b, "Brazier_Bronze", "Bronze", bevel=0.0)
finish(c, "Brazier_Coal", "Coal", bevel=0.0)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_materials="EXPORT", export_normals=True, export_texcoords=False)
print("KIT", {o.name: len(o.data.polygons) for o in bpy.context.scene.objects})
