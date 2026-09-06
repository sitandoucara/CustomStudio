"""
survey — the offline atlas survey a garment must pass before it can be customised.

Run:  python3 tools/survey.py cap        # or: shirt
Prints the island table, the mirroring verdict and the cross-island overlap verdict.
Method is Pass 11's, unchanged, and is re-validated against the shirt each run.
"""
import sys, math, glob
sys.path.insert(0, "tools")
from lsmesh import Mesh

RASTER = 1024          # atlas resolution the overlap / mirror tests rasterise onto
CLOTH_RASTER = 400     # resolution the inscribed rect is found at, in the cloth frame
UP = (0.0, 1.0, 0.0)

GARMENTS = {
    "cap":   dict(meshes=sorted(glob.glob("Assets/Garments/cap/Meshes/*.mesh")),
                  nativeAxis="x", targetCm=26.0),
    "shirt": dict(meshes=["Assets/Garments/black_t-shirt/Meshes/tshirt_tshirt_0.mesh"],
                  nativeAxis="y", targetCm=30.0),
    # Pass 21. The hoodie's prefab chain nets to a -90 degree turn about X below its
    # root (Sketchfab -90, fbx +90, "a pose hoodie" -90) at a net scale of 1.0, so raw
    # mesh Z is the garment's UP. `meshRotX` bakes that into every position and normal
    # at load, so the survey, the generator and the emitted grid all live in the
    # prefab-root-local frame the runtime probe reads — which is the frame the shirt
    # and the cap happened to be in already, their chains being identity.
    "hoodie": dict(meshes=["Assets/hoodie/Meshes/a pose hoodie_Material_0.mesh"],
                   nativeAxis="y", targetCm=30.0, meshRotX=-90.0),
    # Pass 21 (tote). The PRINT SURFACE only: Object_12 is the bag's front face with a
    # clean 0..1 unwrap on its own material. The body (Object_11) and the handle base
    # (Object_8) tile their UVs across 20 and 6 tiles — a sticker baked into 0..1 would
    # repeat on every tile, front and back — so they are excluded from the atlas and the
    # runtime keeps the bake OFF their materials (see GarmentDef.printMaterials).
    "tote": dict(meshes=["Assets/Garments/tote_bag/Meshes/Object_12.mesh"],
                 nativeAxis="y", targetCm=18.4),
    # Pass 22 (joggers). A Blender "Sweatpants Mockup": the pants and the drawstring
    # straps, each its own mesh and material, one 0..1 unwrap authored for print. The
    # chain under the prefab root is Scenes (identity) / Scene (identity) / Sweatpants at
    # rotation X +85.761383, uniform scale 0.839522 and a TRANSLATION of (0.014637,
    # 1.283407, 0.127708) in root-local units. `meshRotX` turns the mesh so its length
    # runs up Y as it does on screen; `meshOffset` is that translation divided by the
    # 0.839522 (so that root-local = meshToLocal x rotated-mesh, which is the one
    # relation StickerSystem assumes between the grid and the prefab root).
    "joggers": dict(meshes=["Assets/joggers/jogging_reduced/Meshes/Sweatpants Mockup2.mesh",
                            "Assets/joggers/jogging_reduced/Meshes/Sweatpants Mockup21.mesh"],
                    nativeAxis="y", targetCm=31.0, meshRotX=85.761383,
                    meshOffset=(0.014637 / 0.839522, 1.283407 / 0.839522, 0.127708 / 0.839522)),
    # Pass 23 (socks). A Sketchfab PAIR: two meshes, sock-left-b and sock-right-b, each on
    # its own material. The chain under the prefab root is Sketchfab_model (X -90) /
    # Socks.fbx (X +90, scale 0.01) / RootNode / sock-*-b at translation (-0.394841,
    # 57.169460, -1.008038) and scale 2748.479736 — the rotations cancel, the net scale is
    # 27.4848, and the translation in rotated-mesh units is t / 2748.48. Same chain for
    # both socks, so one offset serves the pair.
    "socks": dict(meshes=["Assets/Garments/socks/Meshes/sock-left-b_medias_0.mesh",
                          "Assets/Garments/socks/Meshes/sock-right-b_medias.001_0.mesh"],
                  nativeAxis="x", targetCm=21.0, weld=True,
                  # Pass 23: each sock is its own BAKE TARGET (see GarmentDef.printTargets) —
                  # their charts share the atlas, so one bake would print on both.
                  targets={"sock-left-b_medias_0": 0, "sock-right-b_medias.001_0": 1},
                  # Pass 27: each leg is now its own cylinder chart (tools/reunwrap_socks.py), so a
                  # tube is cut into quarters — front, outer, back, inner — not 25-degree slivers
                  # spanning leg and foot; the home is the region's own centre (mid-shin).
                  targetTags=["L", "R"], jacobian="mean", splitAxis="sweep", splitTube=True, splitMinScale=0.60, splitTargetDeg=90.0, homeUpCm=0.0,
                  meshOffset=(-0.394841 / 2748.479736, 57.169460 / 2748.479736, -1.008038 / 2748.479736)),
    # Pass 32 (sunglasses). Sketchfab "bellagio": three meshes on three materials — Object_0
    # the FRAME (white marble), Object_2 the temple BRACKETS (gold), Object_1 the LENSES
    # (black glass) — the lenses are left out of the atlas, they are not printed. The chain
    # under the prefab root is Sketchfab_model (X -90, scale 1.049659) / Sketchfab_Scene /
    # GLTF_SceneRootNode (X +90) / sunglasses (scale 100) / Scenes / Object_4 / Object_6 /
    # Object_8 / frame.002_0 (translation (0, -0.002516, 0), Y 0.33 deg, ignored): the
    # rotations cancel, the net scale is 104.9659, the translation is in mesh units.
    "sunglasses": dict(meshes=["Assets/sunglasses/Meshes/Object_0.mesh",
                               "Assets/sunglasses/Meshes/Object_2.mesh"],
                       nativeAxis="x", targetCm=18.0,
                       meshOffset=(0.0, -0.002516, 0.0)),
}

# ---------------------------------------------------------------- vector helpers
def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def mul(a, s): return (a[0]*s, a[1]*s, a[2]*s)
def dot(a, b): return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a):
    l = math.sqrt(dot(a, a))
    return (0.0, 0.0, 0.0) if l < 1e-12 else (a[0]/l, a[1]/l, a[2]/l)


# ---------------------------------------------------------------- island finding
class Island:
    __slots__ = ("mesh", "idx", "tris", "n", "uMin", "uMax", "vMin", "vMax",
                 "uvArea", "meshArea", "centroid", "right", "up", "role")


def islands_of(mesh, meshName):
    """Connected components of the triangle graph under shared VERTEX INDEX.
    The importer duplicates vertices along every UV seam, so vertex connectivity
    IS island connectivity."""
    parent = list(range(mesh.vertexCount))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    for a, b, c in mesh.tris:
        union(a, b); union(a, c)
    groups = {}
    for t in mesh.tris:
        groups.setdefault(find(t[0]), []).append(t)

    out = []
    for tris in groups.values():
        isl = Island()
        isl.mesh = meshName
        isl.tris = tris
        n = (0.0, 0.0, 0.0)
        uvA = 0.0
        mA = 0.0
        csum = (0.0, 0.0, 0.0)
        uMin = vMin = 1e9; uMax = vMax = -1e9
        for a, b, c in tris:
            pa, pb, pc = mesh.pos[a], mesh.pos[b], mesh.pos[c]
            fn = cross(sub(pb, pa), sub(pc, pa))
            area = 0.5 * math.sqrt(dot(fn, fn))
            n = add(n, mul(norm(fn), area))
            mA += area
            csum = add(csum, mul(add(add(pa, pb), pc), area / 3.0))
            ua, ub, uc = mesh.uv[a], mesh.uv[b], mesh.uv[c]
            uvA += abs((ub[0]-ua[0]) * (uc[1]-ua[1]) - (uc[0]-ua[0]) * (ub[1]-ua[1])) * 0.5
            for uu, vv in (ua, ub, uc):
                uMin = min(uMin, uu); uMax = max(uMax, uu)
                vMin = min(vMin, vv); vMax = max(vMax, vv)
        isl.n = norm(n)
        isl.uvArea = uvA
        isl.meshArea = mA
        isl.centroid = mul(csum, 1.0 / mA) if mA > 0 else (0.0, 0.0, 0.0)
        isl.uMin, isl.uMax, isl.vMin, isl.vMax = uMin, uMax, vMin, vMax
        # cloth frame: right = up x n, up = n x right
        r = norm(cross(UP, isl.n))
        if dot(r, r) < 0.5:                      # island faces straight up/down
            r = norm(cross((0.0, 0.0, 1.0), isl.n))
        isl.right = r
        isl.up = norm(cross(isl.n, r))
        out.append(isl)
    out.sort(key=lambda i: -len(i.tris))
    return out


# ---------------------------------------------------------------- rasterisation
def raster_tris(meshes, res):
    """Rasterise every triangle of every mesh onto res x res of UV.
    Returns {texel: [(islandId, meshX_of_triangle_centroid), ...]}."""
    cover = {}
    for iid, (mesh, isl) in meshes:
        for a, b, c in isl.tris:
            ua, ub, uc = mesh.uv[a], mesh.uv[b], mesh.uv[c]
            xcen = (mesh.pos[a][0] + mesh.pos[b][0] + mesh.pos[c][0]) / 3.0
            x0 = max(0, int(math.floor(min(ua[0], ub[0], uc[0]) * res)))
            x1 = min(res - 1, int(math.ceil(max(ua[0], ub[0], uc[0]) * res)))
            y0 = max(0, int(math.floor(min(ua[1], ub[1], uc[1]) * res)))
            y1 = min(res - 1, int(math.ceil(max(ua[1], ub[1], uc[1]) * res)))
            d = (ub[1]-uc[1])*(ua[0]-uc[0]) + (uc[0]-ub[0])*(ua[1]-uc[1])
            if abs(d) < 1e-14:
                continue
            for px in range(x0, x1 + 1):
                pu = (px + 0.5) / res
                for py in range(y0, y1 + 1):
                    pv = (py + 0.5) / res
                    l1 = ((ub[1]-uc[1])*(pu-uc[0]) + (uc[0]-ub[0])*(pv-uc[1])) / d
                    if l1 < 0 or l1 > 1: continue
                    l2 = ((uc[1]-ua[1])*(pu-uc[0]) + (ua[0]-uc[0])*(pv-uc[1])) / d
                    if l2 < 0 or l2 > 1: continue
                    l3 = 1.0 - l1 - l2
                    if l3 < 0 or l3 > 1: continue
                    cover.setdefault((px, py), []).append((iid, xcen))
    return cover


# ---------------------------------------------------------------- inscribed rect
def cloth_mask(mesh, isl, res):
    """Rasterise the island in ITS OWN cloth frame. Returns (mask, x0, y0, cell)."""
    pts = []
    for a, b, c in isl.tris:
        for i in (a, b, c):
            d = sub(mesh.pos[i], isl.centroid)
            pts.append((dot(d, isl.right), dot(d, isl.up)))
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cell = max((x1-x0), (y1-y0)) / (res - 1)
    if cell <= 0: return None
    nx = int((x1-x0)/cell) + 2
    ny = int((y1-y0)/cell) + 2
    mask = [[False]*ny for _ in range(nx)]
    for a, b, c in isl.tris:
        p = []
        for i in (a, b, c):
            d = sub(mesh.pos[i], isl.centroid)
            p.append(((dot(d, isl.right)-x0)/cell, (dot(d, isl.up)-y0)/cell))
        det = (p[1][1]-p[2][1])*(p[0][0]-p[2][0]) + (p[2][0]-p[1][0])*(p[0][1]-p[2][1])
        if abs(det) < 1e-12: continue
        gx0 = max(0, int(min(q[0] for q in p))); gx1 = min(nx-1, int(max(q[0] for q in p))+1)
        gy0 = max(0, int(min(q[1] for q in p))); gy1 = min(ny-1, int(max(q[1] for q in p))+1)
        for gx in range(gx0, gx1+1):
            for gy in range(gy0, gy1+1):
                px, py = gx+0.5, gy+0.5
                l1 = ((p[1][1]-p[2][1])*(px-p[2][0]) + (p[2][0]-p[1][0])*(py-p[2][1]))/det
                if l1 < 0: continue
                l2 = ((p[2][1]-p[0][1])*(px-p[2][0]) + (p[0][0]-p[2][0])*(py-p[2][1]))/det
                if l2 < 0: continue
                if 1.0-l1-l2 < 0: continue
                mask[gx][gy] = True
    return mask, x0, y0, cell


def largest_rect(mask):
    """Largest all-true axis-aligned rectangle, histogram method.
    Returns (gx0, gy0, gx1, gy1) inclusive, or None."""
    nx, ny = len(mask), len(mask[0])
    best = (0, None)
    heights = [0]*ny
    for gx in range(nx):
        for gy in range(ny):
            heights[gy] = heights[gy] + 1 if mask[gx][gy] else 0
        stack = []
        for gy in range(ny + 1):
            h = heights[gy] if gy < ny else 0
            start = gy
            while stack and stack[-1][1] >= h:
                s, sh = stack.pop()
                area = sh * (gy - s)
                if area > best[0]:
                    best = (area, (gx - sh + 1, s, gx, gy - 1))
                start = s
            stack.append((start, h))
    return best[1]


# ---------------------------------------------------------------- uv <-> cloth
def uv_jacobian(mesh, isl, cu, cv):
    """d(cloth)/du and d(cloth)/dv, averaged over the triangles nearest (cu,cv)."""
    best = None
    for a, b, c in isl.tris:
        ua, ub, uc = mesh.uv[a], mesh.uv[b], mesh.uv[c]
        d = (ub[1]-uc[1])*(ua[0]-uc[0]) + (uc[0]-ub[0])*(ua[1]-uc[1])
        if abs(d) < 1e-14: continue
        l1 = ((ub[1]-uc[1])*(cu-uc[0]) + (uc[0]-ub[0])*(cv-uc[1]))/d
        l2 = ((uc[1]-ua[1])*(cu-uc[0]) + (ua[0]-uc[0])*(cv-uc[1]))/d
        l3 = 1.0-l1-l2
        pen = -min(0.0, min(l1, l2, l3))
        if best is None or pen < best[0]:
            best = (pen, (a, b, c))
        if pen == 0.0: break
    if best is None:
        return None   # every triangle in this island is degenerate in UV (zero-area unwrap)
    a, b, c = best[1]
    ua, ub, uc = mesh.uv[a], mesh.uv[b], mesh.uv[c]
    det = (ub[0]-ua[0])*(uc[1]-ua[1]) - (uc[0]-ua[0])*(ub[1]-ua[1])
    if abs(det) < 1e-14: return None
    pa, pb, pc = mesh.pos[a], mesh.pos[b], mesh.pos[c]
    e1, e2 = sub(pb, pa), sub(pc, pa)
    # dP/du = ( dv2*e1 - dv1*e2 ) / det   with dv1 = vb-va, dv2 = vc-va
    dv1, dv2 = ub[1]-ua[1], uc[1]-ua[1]
    du1, du2 = ub[0]-ua[0], uc[0]-ua[0]
    dPdu = mul(sub(mul(e1, dv2), mul(e2, dv1)), 1.0/det)
    dPdv = mul(sub(mul(e2, du1), mul(e1, du2)), 1.0/det)
    to2 = lambda p: (dot(p, isl.right), dot(p, isl.up))
    return to2(dPdu), to2(dPdv)


def role_of(isl, bb):
    """A human name for what part of the garment this island is."""
    n = isl.n
    c = isl.centroid
    yr = (c[1]-bb[0][1])/(bb[1][1]-bb[0][1]+1e-9)
    zr = (c[2]-bb[0][2])/(bb[1][2]-bb[0][2]+1e-9)
    if n[1] > 0.80: return "top / crown cap"
    if n[1] < -0.80: return "underside"
    side = "front" if n[2] > 0.5 else ("rear" if n[2] < -0.5 else ("right" if n[0] > 0 else "left"))
    band = "low" if yr < 0.25 else ("mid" if yr < 0.7 else "high")
    return "%s, %s (z%.2f)" % (side, band, zr)


# ---------------------------------------------------------------- main
def load_meshes(cfg):
    """Every mesh of a garment, rotated into the prefab-root-local frame if its chain
    asks for it. Positions AND normals turn; UVs do not."""
    out = []
    for p in cfg["meshes"]:
        m = Mesh(p)
        rx = cfg.get("meshRotX", 0.0)
        if rx:
            a = math.radians(rx); c, s_ = math.cos(a), math.sin(a)
            rot = lambda v: (v[0], v[1]*c - v[2]*s_, v[1]*s_ + v[2]*c)
            m.pos = [rot(v) for v in m.pos]
            m.nrm = [rot(v) for v in m.nrm]
            for k in ("bbmin", "bbmax"):
                if getattr(m, k, None): setattr(m, k, rot(getattr(m, k)))
        # Pass 22: a translation in the chain, in (rotated) mesh units. Positions only —
        # normals and UVs are unaffected by where the mesh sits.
        off = cfg.get("meshOffset")
        if off:
            m.pos = [(v[0] + off[0], v[1] + off[1], v[2] + off[2]) for v in m.pos]
            for k in ("bbmin", "bbmax"):
                if getattr(m, k, None):
                    b = getattr(m, k); setattr(m, k, (b[0] + off[0], b[1] + off[1], b[2] + off[2]))
        # Pass 23: WELD. The socks arrived with every triangle owning its own three
        # vertices (22,816 vertices for 11,408 triangles), which makes every triangle its
        # own island under shared-index connectivity and stalls the survey in a 22,000-
        # island loop. Welding vertices that share a position AND a uv restores the
        # connectivity the importer normally leaves: seams keep their split (different
        # uv), everything else joins. Opt-in per garment so the shipped cap and tote
        # tables regenerate byte for byte.
        if cfg.get("weld"):
            weld_mesh(m)
        out.append((p.split("/")[-1].replace(".mesh", ""), m))
    return out


def weld_mesh(m, digits=6):
    """Merge vertices with identical (rounded) position and uv; remap the triangles."""
    key2new = {}
    old2new = []
    pos, uv, nrm = [], [], []
    for i in range(m.vertexCount):
        k = (tuple(round(c, digits) for c in m.pos[i]), tuple(round(c, digits) for c in m.uv[i]))
        j = key2new.get(k)
        if j is None:
            j = len(pos); key2new[k] = j
            pos.append(m.pos[i]); uv.append(m.uv[i]); nrm.append(m.nrm[i] if m.nrm else (0.0, 0.0, 0.0))
        old2new.append(j)
    before = m.vertexCount
    m.pos, m.uv = pos, uv
    if m.nrm: m.nrm = nrm
    m.vertexCount = len(pos)
    m.tris = [(old2new[a], old2new[b], old2new[c]) for a, b, c in m.tris]
    m.tris = [t for t in m.tris if len(set(t)) == 3]
    print("welded %s: %d -> %d vertices" % (m.path.split("/")[-1], before, m.vertexCount))


def survey(which, quiet=False):
    cfg = GARMENTS[which]
    meshes = load_meshes(cfg)

    lo = [1e9]*3; hi = [-1e9]*3
    for _, m in meshes:
        for p in m.pos:
            for k in range(3):
                lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k])
    bb = (tuple(lo), tuple(hi))
    span = {"x": hi[0]-lo[0], "y": hi[1]-lo[1], "z": hi[2]-lo[2]}
    native = span[cfg["nativeAxis"]]
    cmPerMesh = cfg["targetCm"] / native

    allIsl = []
    for name, m in meshes:
        for isl in islands_of(m, name):
            allIsl.append((m, isl))
    allIsl.sort(key=lambda t: -len(t[1].tris))
    for i, (m, isl) in enumerate(allIsl):
        isl.idx = i
        isl.role = role_of(isl, bb)

    if not quiet:
        print("=" * 100)
        print("ATLAS SURVEY — %s   %d mesh(es), %d verts, %d tris" %
              (which, len(meshes), sum(m.vertexCount for _, m in meshes),
               sum(len(m.tris) for _, m in meshes)))
        print("bbox %s .. %s   span %.3f x %.3f x %.3f   normalised on %s -> %.1f cm"
              " (%.4f cm per mesh unit)" % (
              tuple(round(x, 3) for x in bb[0]), tuple(round(x, 3) for x in bb[1]),
              span["x"], span["y"], span["z"], cfg["nativeAxis"], cfg["targetCm"], cmPerMesh))
        print("=" * 100)

    # --------------------------------------------------- per-island geometry
    rows = []
    for m, isl in allIsl:
        cm = cloth_mask(m, isl, CLOTH_RASTER)
        rect = None
        if cm:
            mask, x0, y0, cell = cm
            r = largest_rect(mask)
            if r:
                gx0, gy0, gx1, gy1 = r
                halfR = (gx1 - gx0 + 1) * cell / 2.0
                halfU = (gy1 - gy0 + 1) * cell / 2.0
                cx = x0 + (gx0 + gx1 + 1) / 2.0 * cell
                cy = y0 + (gy0 + gy1 + 1) / 2.0 * cell
                # rect centre back to UV: nearest vertex in cloth frame, then its uv
                bestd, bestuv = 1e18, (0.0, 0.0)
                for a, b, c in isl.tris:
                    for i in (a, b, c):
                        d = sub(m.pos[i], isl.centroid)
                        q = (dot(d, isl.right) - cx, dot(d, isl.up) - cy)
                        dd = q[0]*q[0] + q[1]*q[1]
                        if dd < bestd:
                            bestd, bestuv = dd, m.uv[i]
                rect = dict(halfRight=halfR, halfUp=halfU, cu=bestuv[0], cv=bestuv[1])
        jac = uv_jacobian(m, isl, rect["cu"], rect["cv"]) if rect else None
        rows.append((m, isl, rect, jac))
    return dict(which=which, meshes=meshes, bb=bb, cmPerMesh=cmPerMesh,
                allIsl=allIsl, rows=rows, span=span, native=native, cfg=cfg)


STICKER_SIDE = {"cap": 6.4, "shirt": 8.65, "hoodie": 8.65, "tote": 7.0, "joggers": 5.0, "socks": 4.5, "sunglasses": 2.0}


def report(which):
    s = survey(which)
    cmPerMesh = s["cmPerMesh"]
    side = STICKER_SIDE[which]

    print("\n--- ISLANDS " + "-" * 87)
    print("  #  mesh                       tris   u range        v range        "
          "avg normal              atlas%  role")
    for m, isl, rect, jac in s["rows"]:
        print("%3d  %-24s %6d  %.3f-%.3f  %.3f-%.3f  (%6.3f,%6.3f,%6.3f)  %5.2f%%  %s" % (
            isl.idx, isl.mesh[:24], len(isl.tris), isl.uMin, isl.uMax, isl.vMin, isl.vMax,
            isl.n[0], isl.n[1], isl.n[2], isl.uvArea * 100.0, isl.role))

    print("\n--- SCALE, USABLE RECT AND MAX STICKER " + "-" * 61)
    print("  #  cm per u   cm per v   atlasRot   usable rect (cm)   max sticker scale  printable?")
    printable = []
    for m, isl, rect, jac in s["rows"]:
        if not rect or not jac:
            print("%3d  (degenerate)" % isl.idx); continue
        du, dv = jac
        cmU = math.sqrt(du[0]**2 + du[1]**2) * cmPerMesh
        cmV = math.sqrt(dv[0]**2 + dv[1]**2) * cmPerMesh
        rot = math.degrees(math.atan2(du[1], du[0]))
        w = rect["halfRight"] * 2 * cmPerMesh
        h = rect["halfUp"] * 2 * cmPerMesh
        maxScale = min(rect["halfRight"], rect["halfUp"]) * cmPerMesh / (side / 2.0)
        ok = maxScale >= 0.4
        if ok: printable.append((isl, rect, jac, cmU, cmV, rot, w, h, maxScale))
        print("%3d  %8.2f   %8.2f   %+8.2f   %6.2f x %6.2f     %6.2f           %s" % (
            isl.idx, cmU, cmV, rot, w, h, maxScale, "YES" if ok else "no"))

    # ------------------------------------------------ atlas rasterisation tests
    print("\n--- ATLAS RASTERISATION (%dx%d) %s" % (RASTER, RASTER, "-" * 52))
    pairs = [(isl.idx, (m, isl)) for m, isl, _, _ in s["rows"]]
    cover = raster_tris([(i, mi) for i, mi in pairs], RASTER)
    total = RASTER * RASTER
    used = len(cover)
    collisions = {}
    maxSpanPerIsland = {}
    mirrorTexels = 0
    for texel, lst in cover.items():
        ids = set(i for i, _ in lst)
        if len(ids) > 1:
            key = tuple(sorted(ids))
            collisions[key] = collisions.get(key, 0) + 1
        xs = [x for _, x in lst]
        span = max(xs) - min(xs)
        for i in ids:
            maxSpanPerIsland[i] = max(maxSpanPerIsland.get(i, 0.0), span)
        # a mirrored atlas puts a +X and a -X triangle under the same texel
        if min(xs) < -0.5 and max(xs) > 0.5:
            mirrorTexels += 1
    print("atlas coverage: %.1f%% of the square (%d of %d texels carry cloth)"
          % (100.0 * used / total, used, total))

    print("\n--- MIRRORING VERDICT " + "-" * 78)
    xhalf = max(abs(s["bb"][0][0]), abs(s["bb"][1][0]))
    print("half-width of the model in mesh X: %.3f  (a mirrored pair would span ~%.1f)"
          % (xhalf, 2 * xhalf))
    for m, isl, _, _ in s["rows"]:
        sp = maxSpanPerIsland.get(isl.idx, 0.0)
        flag = "  <-- MIRRORED" if sp > xhalf else ""
        print("  island %2d  %-24s  max mesh-X span under one texel: %7.3f%s"
              % (isl.idx, isl.mesh[:24], sp, flag))
    if mirrorTexels == 0:
        print("VERDICT: NOT MIRRORED. No texel is covered by both a +X and a -X triangle.")
    else:
        print("VERDICT: MIRRORED. %d texels carry both a +X and a -X triangle." % mirrorTexels)

    print("\n--- CROSS-ISLAND OVERLAP " + "-" * 75)
    if not collisions:
        print("VERDICT: NO OVERLAP. No texel is claimed by two islands.")
    else:
        for k, v in sorted(collisions.items(), key=lambda kv: -kv[1]):
            print("  islands %s share %d texels (%.3f%% of the atlas)"
                  % (list(k), v, 100.0 * v / total))
    return s, printable


if __name__ == "__main__":
    report(sys.argv[1] if len(sys.argv) > 1 else "cap")
