"""
genpanels — turn a garment mesh into the PRINTABLE PANEL TABLE the Lens runs on.

    python3 tools/genpanels.py cap            # print the table and the diagnostics
    python3 tools/genpanels.py cap --write    # ... and write Assets/Scripts/CapPanels.ts

WHAT CHANGED IN PASS 20, and why each change exists:

1. CLAMP RECTS ARE GROWN IN THE ISLAND, NOT IN THE SUB-WINDOW.
   A panel is a printable REGION, and a curved surface needs several of them so the
   facing guard has an honest normal for each. Pass 18 inscribed each region's rectangle
   inside its own slice of the island, which left a strip of cloth between neighbouring
   rectangles that belonged to no panel at all — 7.9 cm of it on the cap's crown, which
   is where the drag stalled. The rectangle is now grown inside the WHOLE island from the
   region's centre, so two regions of one continuous piece of cloth overlap, and the
   condition that matters holds:

        h_A + h_B  >=  D + S            (D = distance between rect centres,
                                         h = clamp-rect half-widths, S = sticker side)

   dead zone = (D - h_A - h_B + S + hysteresis) / 2, so satisfying it drives the stall to
   half the hysteresis and no further. Across a REAL seam the island ends, the growth
   stops there, and the guarantee that a sticker is never half-drawn is what stops it —
   the rectangle is bounded by the cloth, not by a rule someone has to remember.

2. RECTS ARE GROWN IN UV, WHICH IS WHERE THE RUNTIME CLAMP ACTUALLY WORKS.
   StickerSystem.clampToPanel converts a UV offset to centimetres through cmToUv/uvToCm —
   an affine map — so the clamp region is a rectangle in UV space, rotated by atlasRotDeg.
   Pass 11 searched for it by rasterising in the cloth frame, which is a different shape
   on a curved panel and can therefore certify a rectangle the runtime will not honour.
   Growing the same rectangle the runtime clamps to removes that whole class of mismatch.

3. OFF-ISLAND GRID SAMPLES ARE FITTED, NOT CLAMPED.
   The sampled mesh grid spans the rect's UV bounding box plus padding, so its corners can
   fall off the island. Pass 18's generator clamped those to the nearest edge sample,
   which collapsed 11-20% of every cap panel's cells onto each other (42 of 210 on
   capRight). A collapsed cell makes panelUvToMesh locally constant, which makes the
   Newton solve in worldToUV singular and localNormal fall back to the panel average —
   the exact failure it exists to prevent. Off-island cells are now evaluated from a cubic
   least-squares fit of the panel's own on-island samples, so the surface continues
   smoothly instead of folding.

4. SPLITS ARE DECIDED BY MEASUREMENT.
   An island is split along its dominant UV axis when the surface normal SWEEPS across it
   by more than SPLIT_TRIGGER_DEG, into enough regions that each sweeps at most
   SPLIT_TARGET_DEG. Measured bin-to-bin along the axis rather than as a global spread, so
   a flat brim disc — whose extreme normals are its rolled edge, not a sweep — is left
   whole while the crown's 167 degree arc is cut into three.
"""
import sys, math, glob, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lsmesh import Mesh
from survey import (GARMENTS, STICKER_SIDE, islands_of, norm, sub, add, mul, dot, cross, UP,
                    load_meshes)

# --- how a panel is decided ----------------------------------------------------------
SPLIT_TRIGGER_DEG = 60.0   # a normal sweep wider than this needs more than one region
SPLIT_TARGET_DEG = 55.0    # ... and is cut into regions no wider than this
SPLIT_BINS = 12            # bins along the axis used to measure the sweep
SPLIT_TUBE = False         # Pass 27: per-garment opt-in (survey.py splitTube) — see split_island
# An island whose INTERIOR bins (all but the outermost at each end) agree to within this
# is a flat face with a hem, and its rim bins are left out of the sweep. Measured: the
# tote front's interior is 13.6 degrees, the cap crown top's 47.0, the brim's 41.7.
FLAT_INTERIOR_DEG = 20.0
# A split is only kept if EVERY region it produces can still hold a sticker at this scale.
# Splitting improves the facing guard's honesty and costs usable rectangle; past this point
# the trade stops being worth it and the island is left whole.
SPLIT_MIN_SCALE = 0.90
MASK_RES = 700             # island rasterisation, per axis, over the island's UV bbox
RECT_STEPS = 44            # aspect ratios tried when growing the rect
RECT_PROBE = 34            # sample grid used to test that a rect is inside the island
GRID_CM = 1.0              # target centimetres per sampled-grid cell
GRID_MIN, GRID_MAX = 8, 34
GRID_PAD_CELLS = 1.5       # padding around the rect's UV bbox, in cells
HOME_V_FRAC = 0.623        # where a new sticker lands vertically (Pass 11's constant)
# A region that cannot hold a sticker at roughly the size one is PLACED at is not a print
# surface — putting one there would clamp it smaller the instant it landed. The cap places
# at 0.85, the shirt at 1.0; 0.60 keeps every real panel on both and drops the sweatband
# slivers, which is the whole population in question.
SCALE_FLOOR = 0.60
# StickerSystem's own liveness threshold. A surface whose normal can never bring this much
# of itself round to the camera — max facing over all yaws is sqrt(nx^2 + nz^2) — can never
# be live, can never win activePanel, and can never be dragged onto. Carrying one in the
# table costs a per-frame normal rotation and a candidate slot to no purpose.
PANEL_FACING_MIN = 0.30
# How far past the h_A + h_B >= D + S condition the rects are grown. The rect is capped at
# the neighbour's half-distance plus half a sticker plus this, rather than grown to the
# island edge: overlapping by a sticker width is what closes the dead zone, and growing
# further would stretch a region across cloth its average normal no longer describes.
OVERLAP_MARGIN_CM = 0.40


# =====================================================================================
# island geometry
# =====================================================================================
class Region:
    """One printable region: a whole island, or one slice of one."""
    __slots__ = ("island", "tris", "name", "n", "right", "up", "cu", "cv",
                 "cmPerU", "cmPerV", "atlasRot", "hr", "hu", "homeU", "homeV",
                 "grid", "gnu", "gnv", "gu0", "gu1", "gv0", "gv1", "pick", "area", "scale",
                 "missing", "gridAt", "mask", "sweep", "rectU", "rectV", "target")


def tri_uv_centroid(mesh, t):
    return ((mesh.uv[t[0]][0] + mesh.uv[t[1]][0] + mesh.uv[t[2]][0]) / 3.0,
            (mesh.uv[t[0]][1] + mesh.uv[t[1]][1] + mesh.uv[t[2]][1]) / 3.0)


def face_normal(mesh, t):
    return norm(cross(sub(mesh.pos[t[1]], mesh.pos[t[0]]),
                      sub(mesh.pos[t[2]], mesh.pos[t[0]])))


def face_area(mesh, t):
    f = cross(sub(mesh.pos[t[1]], mesh.pos[t[0]]), sub(mesh.pos[t[2]], mesh.pos[t[0]]))
    return 0.5 * math.sqrt(dot(f, f))


def avg_normal(mesh, tris):
    n = (0.0, 0.0, 0.0)
    for t in tris:
        n = add(n, mul(face_normal(mesh, t), face_area(mesh, t)))
    return norm(n)


def normal_sweep(mesh, tris, axis):
    """How far the surface normal TURNS from one end of the island to the other along
    `axis` (0 = u, 1 = v). Bin-to-bin, so a rolled edge does not read as a sweep."""
    vals = [tri_uv_centroid(mesh, t)[axis] for t in tris]
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-9:
        return 0.0, []
    bins = [[] for _ in range(SPLIT_BINS)]
    for t in tris:
        k = int((tri_uv_centroid(mesh, t)[axis] - lo) / (hi - lo) * (SPLIT_BINS - 1e-9))
        bins[k].append(t)
    ns = [avg_normal(mesh, b) for b in bins if b]
    if len(ns) < 2:
        return 0.0, ns
    # The WIDEST angle between any two bins, not the accumulated bin-to-bin turn. A brim
    # disc curls down at both edges, so its total variation is large while one average
    # normal still represents it perfectly well; the crown's 167 degree arc has two bins
    # that genuinely point 167 degrees apart. Only the second kind needs splitting.
    def widest(bins_):
        w = 0.0
        for i in range(len(bins_)):
            for j in range(i + 1, len(bins_)):
                c = max(-1.0, min(1.0, dot(bins_[i], bins_[j])))
                w = max(w, math.degrees(math.acos(c)))
        return w
    # Pass 22: the rim bins are dropped ONLY WHEN THE INTERIOR IS FLAT. A hem, a rolled rim
    # or an inner lining sits at the END of an island's axis and turns hard away from the
    # face in the last few percent of area; on the tote's flat front the two rim bins sat
    # at 46 and 37 degrees while the ten between them were within 14 — and their pairwise
    # 82 degrees split a flat rectangle in half. Pass 21 trimmed the rims unconditionally,
    # which also flattened the cap's crown top: its interior bins already turn through 47
    # degrees, trimming took the full 65 down to 47, the island was left whole with an
    # average normal that can never face the camera, and the capTop panel vanished. So
    # the rims are trimmed only when what is between them is flat to FLAT_INTERIOR_DEG —
    # then the rims are a hem on a flat face; otherwise the surface is curved end to end
    # and every bin counts, exactly as in Pass 20.
    if len(ns) >= 6 and widest(ns[1:-1]) <= FLAT_INTERIOR_DEG:
        ns = ns[1:-1]
    return widest(ns), ns


# =====================================================================================
# the island's UV mask, and growing a rect inside it
# =====================================================================================
class Mask:
    def __init__(self, mesh, tris, res=MASK_RES):
        us, vs = [], []
        for t in tris:
            for i in t:
                us.append(mesh.uv[i][0]); vs.append(mesh.uv[i][1])
        self.u0, self.u1 = min(us), max(us)
        self.v0, self.v1 = min(vs), max(vs)
        pad = 1e-4
        self.u0 -= pad; self.v0 -= pad; self.u1 += pad; self.v1 += pad
        self.res = res
        self.du = (self.u1 - self.u0) / res
        self.dv = (self.v1 - self.v0) / res
        self.bits = bytearray(res * res)
        for t in tris:
            a, b, c = (mesh.uv[t[0]], mesh.uv[t[1]], mesh.uv[t[2]])
            det = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
            if abs(det) < 1e-16:
                continue
            x0 = max(0, int((min(a[0],b[0],c[0]) - self.u0) / self.du))
            x1 = min(res-1, int((max(a[0],b[0],c[0]) - self.u0) / self.du) + 1)
            y0 = max(0, int((min(a[1],b[1],c[1]) - self.v0) / self.dv))
            y1 = min(res-1, int((max(a[1],b[1],c[1]) - self.v0) / self.dv) + 1)
            for x in range(x0, x1 + 1):
                pu = self.u0 + (x + 0.5) * self.du
                for y in range(y0, y1 + 1):
                    pv = self.v0 + (y + 0.5) * self.dv
                    l1 = ((b[1]-c[1])*(pu-c[0]) + (c[0]-b[0])*(pv-c[1])) / det
                    if l1 < 0: continue
                    l2 = ((c[1]-a[1])*(pu-c[0]) + (a[0]-c[0])*(pv-c[1])) / det
                    if l2 < 0: continue
                    if 1.0 - l1 - l2 < 0: continue
                    self.bits[y * res + x] = 1

    def inside(self, u, v):
        x = int((u - self.u0) / self.du)
        y = int((v - self.v0) / self.dv)
        if x < 0 or y < 0 or x >= self.res or y >= self.res:
            return False
        return self.bits[y * self.res + x] == 1


def rect_fits(mask, cu, cv, rMin, rMax, uMin, uMax, cmPerU, cmPerV, rotDeg):
    """Is the whole clamp rectangle — the one the runtime clamps to — on the cloth?

    Asymmetric on purpose. A region at the END of an island can reach a long way toward
    its neighbour and hardly at all the other way, and a search that only ever tries
    symmetric rectangles has to take the smaller of the two — which is precisely what
    leaves a gap between the last two regions of an arc.
    """
    a = math.radians(rotDeg)
    ca, sa = math.cos(a), math.sin(a)
    n = RECT_PROBE
    for i in range(n + 1):
        r = rMin + (rMax - rMin) * i / n
        for j in range(n + 1):
            up_ = uMin + (uMax - uMin) * j / n
            du = -(r * ca - up_ * sa) / cmPerU
            dv = (r * sa + up_ * ca) / cmPerV
            if not mask.inside(cu + du, cv + dv):
                return False
    return True


def _grow_axis(test, cap):
    """Largest extent in one direction for which `test` holds, bounded by `cap`."""
    if not test(0.02):
        return 0.0
    lo, hi = 0.0, cap
    if test(cap):
        return cap
    for _ in range(24):
        mid = (lo + hi) / 2
        if test(mid): lo = mid
        else: hi = mid
    return lo


def max_square(mask, cu, cv, cmPerU, cmPerV, rotDeg):
    """The largest UPRIGHT SQUARE, in centimetres of cloth, that fits centred on (cu, cv).

    This is the honest measure of "can a sticker live here": a sticker is a square in
    centimetres and the runtime's own max-scale test is min(halfRight, halfUp). Sizing a
    region by rectangle AREA instead answers a different question and cheerfully accepts a
    38 x 6 cm sliver across a whole crown, which is how the split search first talked
    itself out of splitting the one island that needs it most.
    """
    def fits(h):
        return rect_fits(mask, cu, cv, -h, h, -h, h, cmPerU, cmPerV, rotDeg)
    if not fits(0.05):
        return 0.0
    lo, hi = 0.05, 60.0
    if fits(hi):
        return hi
    for _ in range(24):
        mid = (lo + hi) / 2
        if fits(mid): lo = mid
        else: hi = mid
    return lo


def grow_rect(mask, cu, cv, cmPerU, cmPerV, rotDeg, targetHalf=None, minHu=0.0):
    """Grow a clamp rectangle around (cu, cv), then re-centre it.

    Returns (hr, hu, shiftR, shiftU): the half-extents and how far the rectangle's centre
    moved from the region's centroid, in centimetres along the region's own axes. The
    caller folds the shift into rectU/rectV — the clamp centre is not required to be the
    region's centroid, and on an end region it must not be.
    """
    BIG = 60.0
    cap = BIG if targetHalf is None else targetHalf
    hu0 = max(minHu, 0.02)

    def fitsU(h):
        return rect_fits(mask, cu, cv, -0.02, 0.02, -h, h, cmPerU, cmPerV, rotDeg)
    huMax = _grow_axis(fitsU, BIG)
    if huMax <= 0:
        return 0.0, 0.0, 0.0, 0.0
    hu = max(min(huMax, hu0), 0.0) if minHu > 0 else huMax

    def grow_at(hu_try):
        eR = _grow_axis(lambda e: rect_fits(mask, cu, cv, -0.02, e, -hu_try, hu_try,
                                            cmPerU, cmPerV, rotDeg), cap)
        eL = _grow_axis(lambda e: rect_fits(mask, cu, cv, -e, 0.02, -hu_try, hu_try,
                                            cmPerU, cmPerV, rotDeg), cap)
        return eL, eR

    # Take the height first (a panel too short for a sticker is useless), then the width.
    hu = min(huMax, max(hu0, huMax * 0.5)) if targetHalf is not None else huMax
    eL, eR = grow_at(hu)
    if targetHalf is None:
        best = (0.0, 0.0, 0.0, 0.0)
        for k in range(1, RECT_STEPS + 1):
            h = huMax * k / RECT_STEPS
            l, r = grow_at(h)
            if (l + r) * h > best[0]:
                best = ((l + r) * h, (l + r) / 2.0, h, (r - l) / 2.0)
        return best[1], best[2], best[3], 0.0

    # The TALLEST rectangle that still reaches the target width. Width is what has to
    # satisfy h_A + h_B >= D + S, so it is not negotiable; height is then taken as far as
    # the cloth allows at that width, rather than being surrendered to the floor. Without
    # this every panel came out exactly one sticker tall — technically passing, with no
    # vertical room left to drag in.
    def reaches(h):
        l, r = grow_at(h)
        return (l + r) / 2.0 >= cap - 1e-3
    if reaches(hu0):
        lo, hi = hu0, max(hu0, huMax)
        if not reaches(hi):
            for _ in range(22):
                mid = (lo + hi) / 2
                if reaches(mid): lo = mid
                else: hi = mid
        else:
            lo = hi
        l, r = grow_at(lo)
        return (l + r) / 2.0, lo, (r - l) / 2.0, 0.0
    # The target is out of reach at any usable height — take the widest the floor allows.
    l, r = grow_at(hu0)
    return (l + r) / 2.0, hu0, (r - l) / 2.0, 0.0


# =====================================================================================
# sampling the mesh, and fitting what falls off it
# =====================================================================================
def uv_to_pos(mesh, tris, u, v):
    for t in tris:
        a, b, c = mesh.uv[t[0]], mesh.uv[t[1]], mesh.uv[t[2]]
        det = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
        if abs(det) < 1e-16: continue
        l1 = ((b[1]-c[1])*(u-c[0]) + (c[0]-b[0])*(v-c[1])) / det
        if l1 < -1e-9 or l1 > 1+1e-9: continue
        l2 = ((c[1]-a[1])*(u-c[0]) + (a[0]-c[0])*(v-c[1])) / det
        if l2 < -1e-9 or l2 > 1+1e-9: continue
        l3 = 1 - l1 - l2
        if l3 < -1e-9: continue
        return tuple(l1*mesh.pos[t[0]][k] + l2*mesh.pos[t[1]][k] + l3*mesh.pos[t[2]][k]
                     for k in range(3))
    return None


def poly_terms(u, v, order):
    t = [1.0, u, v]
    if order >= 2: t += [u*u, u*v, v*v]
    if order >= 3: t += [u*u*u, u*u*v, u*v*v, v*v*v]
    return t


def lstsq(A, b):
    """Normal equations with a small ridge — these systems are tiny and well conditioned
    once the ridge is there, and it avoids a numpy dependency in a tool that otherwise
    has none."""
    m = len(A[0])
    ata = [[sum(A[k][i]*A[k][j] for k in range(len(A))) + (1e-9 if i == j else 0.0)
            for j in range(m)] for i in range(m)]
    atb = [sum(A[k][i]*b[k] for k in range(len(A))) for i in range(m)]
    for i in range(m):
        p = max(range(i, m), key=lambda r: abs(ata[r][i]))
        if abs(ata[p][i]) < 1e-14: return None
        ata[i], ata[p] = ata[p], ata[i]
        atb[i], atb[p] = atb[p], atb[i]
        for r in range(i+1, m):
            f = ata[r][i] / ata[i][i]
            for c in range(i, m): ata[r][c] -= f * ata[i][c]
            atb[r] -= f * atb[i]
    x = [0.0]*m
    for i in range(m-1, -1, -1):
        s = atb[i] - sum(ata[i][j]*x[j] for j in range(i+1, m))
        x[i] = s / ata[i][i]
    return x


def sample_grid(mesh, tris, gu0, gu1, gv0, gv1, gnu, gnv):
    """The sampled mesh over the grid domain. Off-island cells are FITTED from the panel's
    own on-island samples — never clamped to an edge, which is what collapsed cells."""
    pts = [[None]*gnv for _ in range(gnu)]
    known = []
    for i in range(gnu):
        u = gu0 + (gu1-gu0) * i / (gnu-1)
        for j in range(gnv):
            v = gv0 + (gv1-gv0) * j / (gnv-1)
            p = uv_to_pos(mesh, tris, u, v)
            pts[i][j] = p
            if p: known.append((u, v, p))
    missing = sum(1 for i in range(gnu) for j in range(gnv) if pts[i][j] is None)
    if missing and known:
        order = 3 if len(known) >= 16 else (2 if len(known) >= 8 else 1)
        A = [poly_terms(u, v, order) for u, v, _ in known]
        coef = []
        for axis in range(3):
            c = lstsq(A, [p[axis] for _, _, p in known])
            coef.append(c)
        if all(c is not None for c in coef):
            for i in range(gnu):
                u = gu0 + (gu1-gu0) * i / (gnu-1)
                for j in range(gnv):
                    if pts[i][j] is not None: continue
                    v = gv0 + (gv1-gv0) * j / (gnv-1)
                    t = poly_terms(u, v, order)
                    pts[i][j] = tuple(sum(t[k]*coef[a][k] for k in range(len(t)))
                                      for a in range(3))
    for i in range(gnu):
        for j in range(gnv):
            if pts[i][j] is None: pts[i][j] = (0.0, 0.0, 0.0)
    return pts, missing


def jacobian_at(mesh, tris, u, v):
    """d(pos)/du and d(pos)/dv from the triangle covering (u, v), else the nearest."""
    best = None
    for t in tris:
        a, b, c = mesh.uv[t[0]], mesh.uv[t[1]], mesh.uv[t[2]]
        det = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
        if abs(det) < 1e-16: continue
        l1 = ((b[1]-c[1])*(u-c[0]) + (c[0]-b[0])*(v-c[1])) / det
        l2 = ((c[1]-a[1])*(u-c[0]) + (a[0]-c[0])*(v-c[1])) / det
        pen = -min(0.0, min(l1, l2, 1-l1-l2))
        if best is None or pen < best[0]: best = (pen, t)
        if pen == 0.0: break
    t = best[1]
    ua, ub, uc = mesh.uv[t[0]], mesh.uv[t[1]], mesh.uv[t[2]]
    det = (ub[0]-ua[0])*(uc[1]-ua[1]) - (uc[0]-ua[0])*(ub[1]-ua[1])
    e1 = sub(mesh.pos[t[1]], mesh.pos[t[0]])
    e2 = sub(mesh.pos[t[2]], mesh.pos[t[0]])
    dv1, dv2 = ub[1]-ua[1], uc[1]-ua[1]
    du1, du2 = ub[0]-ua[0], uc[0]-ua[0]
    dPdu = mul(sub(mul(e1, dv2), mul(e2, dv1)), 1.0/det)
    dPdv = mul(sub(mul(e2, du1), mul(e1, du2)), 1.0/det)
    return dPdu, dPdv


# =====================================================================================
# building the table
# =====================================================================================
def role_name(n):
    ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
    if ay > ax and ay > az: return "top" if n[1] > 0 else "under"
    if az >= ax: return "front" if n[2] > 0 else "rear"
    return "right" if n[0] > 0 else "left"


def make_region(m, isl, tris, cm):
    """A region's centre, frame and atlas metrics. Rect and grid come later."""
    r = Region()
    r.island = (m, isl)
    r.tris = tris
    r.n = avg_normal(m, tris)
    if r.n == (0.0, 0.0, 0.0):
        return None
    wsum = cu = cv = 0.0
    for t in tris:
        w = face_area(m, t)
        c = tri_uv_centroid(m, t)
        cu += c[0] * w; cv += c[1] * w; wsum += w
    if wsum <= 0:
        return None
    r.cu, r.cv = cu / wsum, cv / wsum
    rt = norm(cross(UP, r.n))
    if dot(rt, rt) < 0.5:
        rt = norm(cross((0.0, 0.0, 1.0), r.n))
    r.right = rt
    r.up = norm(cross(r.n, rt))
    to2 = lambda p: (dot(p, r.right), dot(p, r.up))
    if JACOBIAN_MODE == "mean":
        # Pass 23: the region's SCALE is the area-weighted mean of |dP/du| and |dP/dv| over
        # its own triangles, and its atlas ROTATION is the area-weighted mean of the
        # projected du direction over the triangles that face the way the region does.
        # The two are averaged separately on purpose: on a tube the projected vectors
        # swing round with the surface and their plain mean cancels to nothing, while
        # their lengths stay steady (the socks' body island: p10-p90 of 60-73 cm/u, 50-71
        # cm/v, but one centroid triangle at 9.5 cm/v). Opt-in per garment (survey.py:
        # jacobian="mean") so the cap and the tote, whose centroid triangles were
        # representative, regenerate byte for byte.
        lenU = lenV = wsum2 = 0.0
        dirU = [0.0, 0.0]; wdir = 0.0
        for t in tris:
            ua, ub, uc = m.uv[t[0]], m.uv[t[1]], m.uv[t[2]]
            det = (ub[0]-ua[0])*(uc[1]-ua[1]) - (uc[0]-ua[0])*(ub[1]-ua[1])
            if abs(det) < 1e-14:
                continue
            e1 = sub(m.pos[t[1]], m.pos[t[0]]); e2 = sub(m.pos[t[2]], m.pos[t[0]])
            dv1, dv2 = ub[1]-ua[1], uc[1]-ua[1]
            du1, du2 = ub[0]-ua[0], uc[0]-ua[0]
            gu = mul(sub(mul(e1, dv2), mul(e2, dv1)), 1.0/det)
            gv = mul(sub(mul(e2, du1), mul(e1, du2)), 1.0/det)
            w = face_area(m, t)
            lenU += math.sqrt(dot(gu, gu)) * w; lenV += math.sqrt(dot(gv, gv)) * w; wsum2 += w
            fw = w * max(0.0, dot(face_normal(m, t), r.n))
            pu = to2(gu); pl = math.sqrt(pu[0]**2 + pu[1]**2)
            if pl > 1e-12 and fw > 0:
                dirU[0] += pu[0] / pl * fw; dirU[1] += pu[1] / pl * fw; wdir += fw
        if wsum2 <= 0 or wdir <= 0:
            return None
        a2 = (dirU[0] / wdir * lenU / wsum2, dirU[1] / wdir * lenU / wsum2)
        b2 = (-a2[1] / max(1e-12, math.sqrt(a2[0]**2 + a2[1]**2)) * lenV / wsum2,
              a2[0] / max(1e-12, math.sqrt(a2[0]**2 + a2[1]**2)) * lenV / wsum2)
    else:
        dPdu, dPdv = jacobian_at(m, isl.tris, r.cu, r.cv)
        a2, b2 = to2(dPdu), to2(dPdv)
    r.cmPerU = math.sqrt(a2[0] ** 2 + a2[1] ** 2) * cm
    r.cmPerV = math.sqrt(b2[0] ** 2 + b2[1] ** 2) * cm
    if r.cmPerU < 1e-6 or r.cmPerV < 1e-6:
        return None
    r.atlasRot = math.degrees(math.atan2(a2[1], a2[0]))
    return r


CENTRE_SEARCH = 14         # grid per axis searched for a slice's best square centre


def _bins_along(mesh, tris, axis):
    vals = [tri_uv_centroid(mesh, t)[axis] for t in tris]
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-9:
        return []
    bins = [[] for _ in range(SPLIT_BINS)]
    for t in tris:
        k = int((tri_uv_centroid(mesh, t)[axis] - lo) / (hi - lo) * (SPLIT_BINS - 1e-9))
        bins[k].append(t)
    return [b for b in bins if b]


def axis_coherence(mesh, tris, axis):
    """Pass 27: how well binning along `axis` sorts the normals — the mean length of each
    bin's (un-normalised, area-weighted) mean normal. 1 = every bin faces one way, 0 = every
    bin holds a full ring."""
    lens = []
    for b in _bins_along(mesh, tris, axis):
        sx = sy = sz = w = 0.0
        for t in tris_iter(b):
            a = face_area(mesh, t); n = face_normal(mesh, t)
            sx += n[0] * a; sy += n[1] * a; sz += n[2] * a; w += a
        if w > 0:
            lens.append(math.sqrt(sx * sx + sy * sy + sz * sz) / w)
    return sum(lens) / len(lens) if lens else 0.0


def tris_iter(b):
    return b


def accumulated_turn(mesh, tris, axis):
    """Pass 27: the total bin-to-bin turn of the normal along `axis` — 360 for a closed ring."""
    ns = [avg_normal(mesh, b) for b in _bins_along(mesh, tris, axis)]
    total = 0.0
    for i in range(1, len(ns)):
        c = max(-1.0, min(1.0, dot(ns[i - 1], ns[i])))
        total += math.degrees(math.acos(c))
    return total


def best_square_centre(m, tris, mask, r):
    """The centre inside THIS slice that holds the largest upright square, and its
    half-side. The square itself is still grown in the whole island's mask (a region may
    overlap its neighbour's cloth), but the centre must lie on the slice's own cloth."""
    own = Mask(m, tris, res=200)
    us = [mesh_uv for t in tris for mesh_uv in (m.uv[t[0]], m.uv[t[1]], m.uv[t[2]])]
    u0, u1 = min(p[0] for p in us), max(p[0] for p in us)
    v0, v1 = min(p[1] for p in us), max(p[1] for p in us)
    best, bc = 0.0, (r.cu, r.cv)
    for i in range(1, CENTRE_SEARCH):
        for j in range(1, CENTRE_SEARCH):
            u = u0 + (u1 - u0) * i / CENTRE_SEARCH
            v = v0 + (v1 - v0) * j / CENTRE_SEARCH
            if not own.inside(u, v):
                continue
            q = max_square(mask, u, v, r.cmPerU, r.cmPerV, r.atlasRot)
            if q > best:
                best, bc = q, (u, v)
    return best, bc


def split_island(m, isl, cm, side, mask):
    """How many regions this island becomes, decided by measurement.

    The normal sweep says how many are NEEDED; the usability test says how many are
    AFFORDABLE. Take the largest split that both allows — which leaves a brim whole, cuts
    a 167 degree crown arc into three, and never manufactures a sliver.
    """
    us = [tri_uv_centroid(m, t)[0] for t in isl.tris]
    vs = [tri_uv_centroid(m, t)[1] for t in isl.tris]
    axis = 0 if (max(us) - min(us)) >= (max(vs) - min(vs)) else 1
    if SPLIT_AXIS_MODE == "sweep":
        # Pass 23: split along the axis the normal actually TURNS across, not the longer
        # one. The socks' body chart is 0.49 u by 0.50 v — a coin toss on extent — and the
        # tube's 170 degree sweep runs around it along u; cutting along v would have
        # given four bands that each still turned through 170 degrees. Opt-in (survey.py:
        # splitAxis="sweep") so the cap's tables regenerate byte for byte.
        s0, _ = normal_sweep(m, isl.tris, 0)
        s1, _ = normal_sweep(m, isl.tris, 1)
        axis = 0 if s0 >= s1 else 1
    sweep, _ = normal_sweep(m, isl.tris, axis)
    want = 1 if sweep <= SPLIT_TRIGGER_DEG else max(2, int(math.ceil(sweep / SPLIT_TARGET)))
    if SPLIT_TUBE:
        # Pass 27: a CLOSED TUBE (the socks' legs, each now its own cylinder chart) defeats
        # both measures above. The widest pairwise angle saturates at 180 for a ring, so a
        # 360-degree tube would be cut in two; and along the tube's length every bin holds
        # a full ring of normals whose mean is a near-zero vector pointing anywhere, so the
        # axis choice is a coin toss. So: the split axis is the one along which the bins'
        # normals are COHERENT (a bin's mean normal keeps its length), and the sweep is the
        # accumulated bin-to-bin turn along it — 360 for a ring, hence four quarters at a
        # 90-degree target. Opt-in per garment (survey.py: splitTube=True), so the cap and
        # the tote regenerate byte for byte.
        c0 = axis_coherence(m, isl.tris, 0)
        c1 = axis_coherence(m, isl.tris, 1)
        axis = 0 if c0 >= c1 else 1
        turn = accumulated_turn(m, isl.tris, axis)
        if turn > sweep:
            sweep = turn
            want = 1 if sweep <= SPLIT_TRIGGER_DEG else max(2, int(math.ceil(sweep / SPLIT_TARGET)))
        if os.environ.get("GENPANELS_DEBUG"):
            print("   tube: coherence u %.2f v %.2f -> axis %d, turn %.0f deg, want %d" % (c0, c1, axis, turn, want))
    vals = us if axis == 0 else vs
    a0, a1 = min(vals), max(vals)
    for nsplit in range(want, 0, -1):
        regs = []
        ok = True
        for k in range(nsplit):
            lo_k = a0 + (a1 - a0) * k / nsplit
            hi_k = a0 + (a1 - a0) * (k + 1) / nsplit
            tris = [t for t in isl.tris
                    if lo_k - 1e-9 <= tri_uv_centroid(m, t)[axis] <= hi_k + 1e-9]
            if len(tris) < 4:
                ok = False; break
            r = make_region(m, isl, tris, cm)
            if r is None:
                ok = False; break
            q = max_square(mask, r.cu, r.cv, r.cmPerU, r.cmPerV, r.atlasRot)
            floor = SPLIT_MIN if nsplit > 1 else SCALE_FLOOR
            if q / (side / 2.0) < floor:
                # Pass 23: the centroid is a poor centre for a slice with a notch in it —
                # the socks' body chart has an ankle notch that swallows one slice's
                # centroid at every split count, so the whole tube was left as one region
                # with a 178 degree sweep. Search the slice for the centre that holds the
                # largest square instead. Only reached when the centroid has failed, so a
                # garment whose centroids all pass (the cap, the tote) is untouched.
                q2, c2 = best_square_centre(m, tris, mask, r)
                if q2 > q:
                    q = q2; r.cu, r.cv = c2
            if os.environ.get("GENPANELS_DEBUG"):
                print("      n=%d k=%d tris=%d square %.2f cm -> scale %.2f"
                      % (nsplit, k, len(tris), 2 * q, q / (side / 2.0)))
            if q / (side / 2.0) < floor:
                ok = False; break
            r.hr = r.hu = q
            regs.append(r)
        if ok and regs:
            if os.environ.get("GENPANELS_DEBUG"):
                print("   island %d tris: sweep %.0f deg, want %d, took %d"
                      % (len(isl.tris), sweep, want, nsplit))
            return regs, sweep, nsplit
        if os.environ.get("GENPANELS_DEBUG"):
            print("   island %d tris: nsplit %d rejected" % (len(isl.tris), nsplit))
    return [], sweep, 0


JACOBIAN_MODE = "centroid"
SPLIT_AXIS_MODE = "extent"
SPLIT_MIN = SPLIT_MIN_SCALE
SPLIT_TARGET = SPLIT_TARGET_DEG
HOME_UP_CM = 0.0


def build(which, verbose=True):
    global JACOBIAN_MODE, SPLIT_AXIS_MODE, SPLIT_MIN, SPLIT_TARGET, HOME_UP_CM
    cfg = GARMENTS[which]
    HOME_UP_CM = cfg.get("homeUpCm", 0.0)
    # Pass 23: how narrow a region has to be, per garment. At the default 55 degrees the
    # socks' body — a 178 degree tube whose atlas seam runs down the front of the shin —
    # became four quarters whose front pair pointed mostly sideways (nz 0.35 and 0.29,
    # one of them below the liveness threshold from dead ahead). At 25 degrees the shin
    # is two tall halves, 9 x 23 cm each, facing the camera at 0.6.
    SPLIT_TARGET = cfg.get("splitTargetDeg", SPLIT_TARGET_DEG)
    JACOBIAN_MODE = cfg.get("jacobian", "centroid")
    SPLIT_AXIS_MODE = cfg.get("splitAxis", "extent")
    # Pass 23: a garment may lower the per-region floor a split has to clear. The socks'
    # body is a 24 cm tube that has to become three or four regions for the facing guard
    # to be honest about its sides, and a third of it cannot hold a 0.90-scale sticker at
    # its centroid; 0.60 (the same floor a whole island must clear) lets it split and
    # the phase-2 growth then widens each region to overlap its neighbours.
    SPLIT_MIN = cfg.get("splitMinScale", SPLIT_MIN_SCALE)
    global SPLIT_TUBE
    SPLIT_TUBE = bool(cfg.get("splitTube", False))
    side = STICKER_SIDE[which]
    meshes = load_meshes(cfg)
    lo = [1e9] * 3; hi = [-1e9] * 3
    for _, m in meshes:
        for p in m.pos:
            for k in range(3):
                lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k])
    span = {"x": hi[0] - lo[0], "y": hi[1] - lo[1], "z": hi[2] - lo[2]}
    cm = cfg["targetCm"] / span[cfg["nativeAxis"]]

    # ---- PHASE 1: which islands are printable, and how many regions each becomes ------
    regions = []
    skipped = []
    for name, m in meshes:
        for isl in islands_of(m, name):
            if len(isl.tris) < 6:
                continue
            mask = Mask(m, isl.tris)
            whole = make_region(m, isl, isl.tris, cm)
            if whole is None:
                skipped.append((len(isl.tris), 0.0, "degenerate frame")); continue
            # Pass 27: a TUBE (a normal sweep wider than the split trigger — the socks' legs,
            # now their own cylinder charts) has no meaningful island-level frame: its mean
            # normal is whatever tiny residual survives cancelling, and a square fitted in
            # that frame fails for no reason. Such an island goes straight to the split, and
            # every region it becomes is sized and tested on its own below. A surface that
            # does not sweep keeps the whole-island test exactly as before.
            s0, _ = normal_sweep(m, isl.tris, 0)
            s1, _ = normal_sweep(m, isl.tris, 1)
            if max(s0, s1) <= SPLIT_TRIGGER_DEG:
                q0 = max_square(mask, whole.cu, whole.cv, whole.cmPerU, whole.cmPerV, whole.atlasRot)
                if q0 / (side / 2.0) < SCALE_FLOOR:
                    skipped.append((len(isl.tris), q0 / (side / 2.0), "no sticker fits")); continue
            regs, sweep, n = split_island(m, isl, cm, side, mask)
            for r in regs:
                r.mask = mask
                r.sweep = sweep
                regions.append(r)

    # ---- PHASE 2: re-grow each rect to OVERLAP its neighbour by a sticker width -------
    keep = []
    for r in regions:
        dr, du = neighbour_distances(r, regions)
        target = None if dr is None else dr / 2.0 + side / 2.0 + OVERLAP_MARGIN_CM
        hr, hu, shiftR, shiftU = grow_rect(r.mask, r.cu, r.cv, r.cmPerU, r.cmPerV,
                                           r.atlasRot, targetHalf=target, minHu=side / 2.0)
        # The clamp rect's centre is the region's centroid PLUS whatever the asymmetric
        # growth shifted it by — on an end region that shift is what lets a symmetric
        # rectangle still reach its neighbour without running off the cloth.
        a = math.radians(r.atlasRot); ca, sa = math.cos(a), math.sin(a)
        r.rectU = r.cu - (shiftR * ca - shiftU * sa) / r.cmPerU
        r.rectV = r.cv + (shiftR * sa + shiftU * ca) / r.cmPerV
        r.hr, r.hu = hr, hu
        r.scale = min(hr, hu) / (side / 2.0)
        r.area = 4 * hr * hu
        if r.scale < SCALE_FLOOR:
            skipped.append((len(r.tris), r.scale, "region too small after sizing")); continue
        if math.sqrt(r.n[0] ** 2 + r.n[2] ** 2) < PANEL_FACING_MIN:
            skipped.append((len(r.tris), math.sqrt(r.n[0] ** 2 + r.n[2] ** 2),
                            "can never face the camera")); continue
        keep.append(r)

    for sk in skipped:
        print("   skipped: %d tris, %.2f, %s" % sk)
    keep.sort(key=lambda r: -(r.n[2] * r.area))
    maxArea = max(r.area for r in keep) if keep else 1.0
    # Pass 23: a garment may have several BAKE TARGETS (the socks: one per sock, because
    # their UV charts share the atlas). Each region carries the target of its mesh, and
    # its name carries the target's tag so socksLFront and socksRFront are told apart.
    targets = cfg.get("targets")
    tags = cfg.get("targetTags", [])
    for r in keep:
        r.pick = round(max(0.5, min(1.0, 0.5 + 0.5 * r.area / maxArea)), 2)
        r.target = targets.get(r.island[1].mesh, 0) if targets else None
        tag = tags[r.target] if (r.target is not None and r.target < len(tags)) else ""
        r.name = which + tag + role_name(r.n).capitalize()
    seen = {}
    for r in keep:
        seen[r.name] = seen.get(r.name, 0) + 1
    counts = {}
    for r in keep:
        if seen[r.name] > 1:
            counts[r.name] = counts.get(r.name, 0) + 1
            r.name = r.name + str(counts[r.name])

    # ---- PHASE 3: the sampled grid ----------------------------------------------------
    at = 0
    for r in keep:
        m, isl = r.island
        a = math.radians(r.atlasRot); ca, sa = math.cos(a), math.sin(a)
        us, vs = [], []
        for sr in (-r.hr, r.hr):
            for su in (-r.hu, r.hu):
                us.append(r.rectU - (sr * ca - su * sa) / r.cmPerU)
                vs.append(r.rectV + (sr * sa + su * ca) / r.cmPerV)
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        gnu = max(GRID_MIN, min(GRID_MAX, int(round((u1 - u0) * r.cmPerU / GRID_CM)) + 1))
        gnv = max(GRID_MIN, min(GRID_MAX, int(round((v1 - v0) * r.cmPerV / GRID_CM)) + 1))
        padU = (u1 - u0) / max(1, gnu - 1) * GRID_PAD_CELLS
        padV = (v1 - v0) / max(1, gnv - 1) * GRID_PAD_CELLS
        r.gu0, r.gu1 = u0 - padU, u1 + padU
        r.gv0, r.gv1 = v0 - padV, v1 + padV
        r.gnu = gnu + int(round(2 * GRID_PAD_CELLS))
        r.gnv = gnv + int(round(2 * GRID_PAD_CELLS))
        r.grid, r.missing = sample_grid(m, isl.tris, r.gu0, r.gu1, r.gv0, r.gv1, r.gnu, r.gnv)
        r.gridAt = at
        at += r.gnu * r.gnv * 3
        # Home is the REGION's own centre — the cloth this panel is actually about — but
        # clamped into the centre-rect, so a newly placed sticker is never born outside
        # the box the clamp is about to pull it into.
        x = -(r.cu - r.rectU) * r.cmPerU
        y = (r.cv - r.rectV) * r.cmPerV
        # Pass 23: a garment may push the home along the region's up axis. The socks' front
        # regions run from the cuff to the instep and their centroid sits at the ankle,
        # where the unwrap shears; HOME_UP_CM lifts a new sticker onto the shin.
        hx = max(-(r.hr - side / 2), min(r.hr - side / 2, ca * x + sa * y))
        hy = max(-(r.hu - side / 2), min(r.hu - side / 2, -sa * x + ca * y + HOME_UP_CM))
        r.homeU = r.rectU - (hx * ca - hy * sa) / r.cmPerU
        r.homeV = r.rectV + (hx * sa + hy * ca) / r.cmPerV
    return dict(which=which, cm=cm, side=side, regions=keep, meshes=meshes,
                span=span, skipped=skipped)


def neighbour_distances(r, regions):
    """Distance in cm, along r's own right and up axes, to the nearest OTHER region of the
    same island. None when there is none on that axis — then only the cloth bounds it."""
    a = math.radians(r.atlasRot); ca, sa = math.cos(a), math.sin(a)
    bestR = bestU = None
    for o in regions:
        if o is r or o.island[1] is not r.island[1]:
            continue
        x = -(o.cu - r.cu) * r.cmPerU
        y = (o.cv - r.cv) * r.cmPerV  # centroids: this runs BEFORE rects exist
        dr = abs(ca * x + sa * y)
        du = abs(-sa * x + ca * y)
        if dr >= du:
            bestR = dr if bestR is None else min(bestR, dr)
        else:
            bestU = du if bestU is None else min(bestU, du)
    return bestR, bestU


def _nearest_pair(a, b, regs):
    """True when b is a's closest same-island region, or the other way round."""
    def nearest(x):
        best, bd = None, 1e18
        for o in regs:
            if o is x or o.island[1] is not x.island[1]:
                continue
            d = (o.rectU - x.rectU) ** 2 + (o.rectV - x.rectV) ** 2
            if d < bd:
                bd, best = d, o
        return best
    return nearest(a) is b or nearest(b) is a


def collapsed_cells(r, cm):
    """Adjacent grid samples that have collapsed onto each other — the Pass 18 defect."""
    bad = tot = 0
    for i in range(r.gnu - 1):
        for j in range(r.gnv):
            a, b = r.grid[i][j], r.grid[i+1][j]
            d = math.sqrt(sum((a[k]-b[k])**2 for k in range(3))) * cm
            tot += 1
            if d < 0.02: bad += 1
    return bad, tot


def adjacency_report(res):
    """Only NEAREST neighbours — the pairs a drag can actually hop between. Two regions
    at opposite ends of an arc are not adjacent and requiring them to overlap is nonsense."""
    """The h_A + h_B >= D + S condition, for every pair of regions on the same island."""
    out = []
    regs = res["regions"]; S = res["side"]
    for i in range(len(regs)):
        for j in range(i+1, len(regs)):
            a, b = regs[i], regs[j]
            if a.island[1] is not b.island[1]:
                continue
            if not _nearest_pair(a, b, regs):
                continue
            # distance between rect centres, in cm on the cloth, along a's right axis
            du = b.rectU - a.rectU; dv = b.rectV - a.rectV
            aa = math.radians(a.atlasRot); ca, sa = math.cos(aa), math.sin(aa)
            x = -du * a.cmPerU; y = dv * a.cmPerV
            D = math.sqrt((ca*x + sa*y)**2 + (-sa*x + ca*y)**2)
            need = D + S
            have = a.hr + b.hr if abs(ca*x + sa*y) > abs(-sa*x + ca*y) else a.hu + b.hu
            gap = D - (a.hr + b.hr) + S
            out.append((a.name, b.name, D, have, need, gap))
    return out


# =====================================================================================
# report + emit
# =====================================================================================
def report(res):
    cm = res["cm"]; S = res["side"]
    print("=" * 104)
    print("%s — %.4f cm per mesh unit, sticker side %.2f cm, %d printable regions"
          % (res["which"], cm, S, len(res["regions"])))
    print("%-14s %7s %14s %9s %9s %9s %8s %7s %9s %s" %
          ("panel", "tris", "rect cm", "maxScale", "cm/u", "atlasRot", "grid", "pick", "collapsed", "target"))
    for r in res["regions"]:
        bad, tot = collapsed_cells(r, cm)
        print("%-14s %7d %6.2f x %-6.2f %8.2f %9.1f %9.1f %4dx%-3d %7.2f %5d/%-4d %s" %
              (r.name, len(r.tris), 2*r.hr, 2*r.hu, r.scale, r.cmPerU, r.atlasRot,
               r.gnu, r.gnv, r.pick, bad, tot, "" if r.target is None else r.target))
    adj = adjacency_report(res)
    if adj:
        print("  --- neighbouring regions of ONE island: h_A + h_B >= D + S ? ---")
        for (a, b, D, have, need, gap) in sorted(adj, key=lambda t: t[2])[:10]:
            ok = "OK" if have >= need - 1e-6 else "GAP"
            print("    %-13s %-13s  D %5.2f  have %5.2f  need %5.2f  gap %+5.2f cm"
                  "   -> dead zone %4.2f cm   %s"
                  % (a, b, D, have, need, max(0.0, gap), max(0.0, gap + 1.4) / 2, ok))


TS_HEAD = '''// %(FILE)s — %(NAME)s's PRINTABLE PANELS, generated by tools/genpanels.py (Pass 20).
//
// DO NOT HAND-EDIT. Regenerate with:
//     python3 tools/genpanels.py %(WHICH)s --write
//
// A panel is a printable REGION, not a UV island: a surface whose normal sweeps more than
// %(TRIG).0f degrees is cut into regions narrow enough that each has an honest average
// normal for the facing guard. %(NREG)d regions here, from %(NISL)d islands.
//
// WHAT PASS 20 FIXED, and how to tell it worked:
//
//   OVERLAPPING CLAMP RECTS. Each region's rectangle is grown inside the WHOLE island
//   from that region's centre, not inscribed inside its own slice. Two regions of one
//   continuous piece of cloth therefore overlap, and h_A + h_B >= D + S holds — which is
//   the condition that makes the panel hop instant instead of leaving a strip of cloth
//   claimed by nobody. Across a real seam the island ends and the rectangle stops there,
//   so a sticker still cannot be half-drawn off the cloth.
//
//   FITTED GRID EDGES. Grid samples that fall outside the island are evaluated from a
//   cubic least-squares fit of this region's own on-island samples. Pass 18 clamped them
//   to the nearest edge sample, which collapsed 11-20%% of every cap panel's cells and
//   made worldToUV's Newton step singular wherever the ray solver wandered into them.
//
// Measured on this build: %(COLLAPSE)s
'''


def emit(res, path, arrName, gridName, frontName):
    cm = res["cm"]
    regs = res["regions"]
    totBad = sum(collapsed_cells(r, cm)[0] for r in regs)
    totCells = sum(collapsed_cells(r, cm)[1] for r in regs)
    nisl = len(set(id(r.island[1]) for r in regs))
    head = TS_HEAD % dict(FILE=os.path.basename(path).replace(".ts", ""),
                          NAME=res["which"], WHICH=res["which"], TRIG=SPLIT_TRIGGER_DEG,
                          NREG=len(regs), NISL=nisl,
                          COLLAPSE="%d collapsed grid cells out of %d." % (totBad, totCells))
    L = [head, '\nimport { Panel } from "./ShirtPanels"\n']
    L.append("\nexport const %s = 0\n" % frontName)
    L.append("\nexport const %s: Panel[] = [\n" % arrName)
    for r in regs:
        L.append("  {\n")
        L.append('    name: "%s",\n' % r.name)
        L.append("    rectU: %.4f, rectV: %.4f, halfRightMesh: %.4f, halfUpMesh: %.4f,\n"
                 % (r.rectU, r.rectV, r.hr / cm, r.hu / cm))
        L.append("    homeU: %.4f, homeV: %.4f,\n" % (r.homeU, r.homeV))
        L.append("    meshPerU: %.4f, meshPerV: %.4f, atlasRotDeg: %.2f,\n"
                 % (r.cmPerU / cm, r.cmPerV / cm, r.atlasRot))
        L.append("    nx: %.4f, ny: %.4f, nz: %.4f, pickWeight: %.2f,\n"
                 % (r.n[0], r.n[1], r.n[2], r.pick))
        L.append("    gridU0: %.4f, gridU1: %.4f, gridV0: %.4f, gridV1: %.4f, gnu: %d, gnv: %d, gridAt: %d,\n"
                 % (r.gu0, r.gu1, r.gv0, r.gv1, r.gnu, r.gnv, r.gridAt))
        if r.target is not None:
            L.append("    target: %d,\n" % r.target)
        L.append("  }, // %.2f x %.2f cm usable, max sticker scale %.2f\n"
                 % (2 * r.hr, 2 * r.hu, r.scale))
    L.append("]\n")
    L.append("\nexport const %s: number[] = [\n" % gridName)
    for r in regs:
        L.append("  // %s  %d x %d\n" % (r.name, r.gnu, r.gnv))
        flat = []
        for i in range(r.gnu):
            for j in range(r.gnv):
                flat.extend(r.grid[i][j])
        for k in range(0, len(flat), 12):
            L.append("  " + ", ".join("%.4f" % x for x in flat[k:k + 12]) + ",\n")
    L.append("]\n")
    open(path, "w").write("".join(L))
    print("wrote %s — %d panels, %d grid floats" %
          (path, len(regs), sum(r.gnu * r.gnv * 3 for r in regs)))


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "cap"
    res = build(which)
    report(res)
    if "--write" in sys.argv:
        spec = {
            "cap": ("Assets/Scripts/CapPanels.ts", "CAP_PANELS", "CAP_PANEL_GRID", "CAP_PANEL_FRONT"),
            "shirt": ("/tmp/ShirtPanels.candidate.ts", "PANELS_GEN", "PANEL_GRID_GEN", "PANEL_FRONT_GEN"),
            "hoodie": ("Assets/Scripts/HoodiePanels.ts", "HOODIE_PANELS", "HOODIE_PANEL_GRID", "HOODIE_PANEL_FRONT"),
            "tote": ("Assets/Scripts/TotePanels.ts", "TOTE_PANELS", "TOTE_PANEL_GRID", "TOTE_PANEL_FRONT"),
            "socks": ("Assets/Scripts/SocksPanels.ts", "SOCKS_PANELS", "SOCKS_PANEL_GRID", "SOCKS_PANEL_FRONT"),
        }[which]
        emit(res, *spec)
