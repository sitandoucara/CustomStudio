"""
reunwrap_socks — give each sock's LEG its own cylinder chart (Pass 27).

WHY. The Sketchfab pair unwraps each sock as ONE body island covering the leg and most of
the foot, cut down the BACK of the leg. Cut around the tube, every generated region spans
leg AND foot, so its mean normal tilts 30-50 degrees and nothing scores like the shirt's
chest; the body island's cm/v also varies 50-71 (one centroid triangle at 9.5), which makes
a drag up the shin uneven. The sock's own albedo is unused (fabricFromAlbedo false), so its
UVs are ours to choose.

WHAT. Every triangle whose centroid is above Y_ANKLE and whose normal points OUTWARD from
the leg axis is re-mapped to a cylinder chart: u around the leg (front centre in the
middle, cut at the BACK), v up the leg, isotropic at CM_PER_U. The mesh is unwelded (each
triangle owns its vertices), so this needs no topology change; only texture0 floats are
rewritten in place. Inner-cuff triangles (normals pointing inward) and everything below the
ankle keep their original UVs. Originals are in tools/backup/.
"""
import math, struct, sys, shutil
sys.path.insert(0, "tools")
from lsmesh import Mesh

Y_ANKLE = 0.085          # mesh units: above this the sock is a straight tube (see slice table)
CM_PER_UNIT = 21.0 / 0.266  # the pair spans 0.266 mesh units = 21 cm on screen (SOCKS_TARGET_WIDTH_CM)
CM_PER_U = 55.0          # chart scale, close to the body island's own (~51 cm/u)
CUT_OFFSET = math.pi / 4  # see phi_of: puts the cut on a quarter boundary, the front quarter on the shin
U_MARGIN = 0.03          # atlas space kept free either side of the chart for triangles that straddle the cut
V_MARGIN_UNITS = 0.006   # let leg-side triangles that dip under the ankle extend a little below v0
CHARTS = {
    # mesh name: (u0, v0) bottom-left of the chart in the atlas — a region free of that
    # sock's other islands (left: its strip is at u .43-.51; right: its strip at u .68-.76)
    "sock-left-b_medias_0": (0.56, 0.56),
    "sock-right-b_medias.001_0": (0.06, 0.56),
}

def run(write):
    for name, (u0, v0) in CHARTS.items():
        path = "Assets/Garments/socks/Meshes/%s.mesh" % name
        m = Mesh(path)
        tex = [a for a in m.attrs if a["semantic"] == "texture0"][0]
        vrec = [v for k, v in m.root if k == "vertices"][0]
        irec = [v for k, v in m.root if k == "indices"][0]
        assert vrec[2] == 0 and irec[2] == vrec[1] and m.dataOff + vrec[1] + irec[1] == len(m.raw), "unexpected blob layout"
        # leg axis from the vertices above the ankle
        up = [pp for pp in m.pos if pp[1] > Y_ANKLE]
        cx = sum(pp[0] for pp in up) / len(up)
        cz = sum(pp[2] for pp in up) / len(up)
        ytop = max(pp[1] for pp in m.pos)
        rs = [math.hypot(pp[0] - cx, pp[2] - cz) for pp in up]
        rmean = sum(rs) / len(rs)
        circ_cm = 2 * math.pi * rmean * CM_PER_UNIT
        height_cm = (ytop - Y_ANKLE) * CM_PER_UNIT
        wU = circ_cm / CM_PER_U
        hV = height_cm / CM_PER_U

        def phi_of(i):
            x, y, z = m.pos[i]
            # 0 at the FRONT (+z, toes). The chart's cut is at +/-pi of this angle, and the
            # generator cuts the chart into four EQUAL quarters, so the angle is offset by an
            # eighth of a turn (CUT_OFFSET): the quarters then sit at front / right / back /
            # left with the front quarter CENTRED on the shin, and the cut falls on the
            # back-left diagonal, on a quarter boundary.
            phi = math.atan2(x - cx, z - cz) + CUT_OFFSET
            if phi > math.pi:
                phi -= 2 * math.pi
            return phi

        def uv_of(i, phi):
            y = m.pos[i][1]
            return (u0 + wU * (0.5 + phi / (2 * math.pi)), v0 + hV * (y - Y_ANKLE) / (ytop - Y_ANKLE))

        # which triangles move: centroid above the ankle AND outward-facing
        moving = []
        for ti, t in enumerate(m.tris):
            cy = sum(m.pos[i][1] for i in t) / 3
            if cy < Y_ANKLE:
                continue
            nx = sum(m.nrm[i][0] for i in t) / 3
            nz = sum(m.nrm[i][2] for i in t) / 3
            px = sum(m.pos[i][0] for i in t) / 3 - cx
            pz = sum(m.pos[i][2] for i in t) / 3 - cz
            if nx * px + nz * pz <= 0:
                continue
            moving.append(ti)
        movingSet = set(moving)
        usedByStaying = set(i for ti, t in enumerate(m.tris) if ti not in movingSet for i in t)

        # Per-corner UVs. A triangle straddling the cut (its phis span more than pi) is
        # unwrapped to the HIGH side, past the chart's right edge into U_MARGIN, so it never
        # spans the whole chart. Vertices then get one UV per (vertex, uv) pair: written in
        # place when nothing else uses that vertex with another uv, DUPLICATED otherwise
        # (the mesh is partly indexed: a vertex may serve two triangles). Copies are
        # appended and the triangles repointed.
        vsz = m.vertexSize
        vdata = bytearray(m.raw[m.dataOff : m.dataOff + vrec[1]])
        tris = [list(t) for t in m.tris]
        assigned = {}   # orig vertex -> uv written in place
        dup = {}        # (orig vertex, uv key) -> new index
        nverts = m.vertexCount
        straddle = 0
        for ti in moving:
            phis = [phi_of(i) for i in tris[ti]]
            if max(phis) - min(phis) > math.pi:
                phis = [ph + 2 * math.pi if ph < 0 else ph for ph in phis]
                straddle += 1
            for k in range(3):
                i = tris[ti][k]
                uv = uv_of(i, phis[k])
                key = (round(uv[0], 6), round(uv[1], 6))
                if i not in usedByStaying and (i not in assigned or assigned[i] == key):
                    assigned[i] = key
                    struct.pack_into("<2f", vdata, i * vsz + tex["offset"], *uv)
                else:
                    j = dup.get((i, key))
                    if j is None:
                        j = nverts; nverts += 1; dup[(i, key)] = j
                        rec = bytearray(m.raw[m.dataOff + i * vsz : m.dataOff + (i + 1) * vsz])
                        struct.pack_into("<2f", rec, tex["offset"], *uv)
                        vdata += rec
                    tris[ti][k] = j
        assert nverts < 65535
        idata = struct.pack("<%dH" % (3 * len(tris)), *[i for t in tris for i in t])

        # Patch the two blob records in the (padded, fixed-size) header, then rebuild the data.
        head = bytearray(m.raw[: m.dataOff])
        def patch(key, size, off):
            kidx = m.strings.index(key)
            old = struct.pack("<HIII", 0x0f, kidx, *[vrec[1], vrec[2]] if key == "vertices" else [irec[1], irec[2]])
            at = head.find(old)
            assert at >= 0, "record not found: " + key
            head[at : at + len(old)] = struct.pack("<HIII", 0x0f, kidx, size, off)
        patch("vertices", len(vdata), 0)
        patch("indices", len(idata), len(vdata))
        out = bytes(head) + bytes(vdata) + idata
        print("%s: axis (%.4f, %.4f) r %.4f -> circumference %.1f cm, height %.1f cm; chart u %.3f-%.3f (+%.2f margin) v %.3f-%.3f; %d of %d triangles re-mapped, %d straddle the cut, %d vertices duplicated (%d -> %d)"
              % (name, cx, cz, rmean, circ_cm, height_cm, u0, u0 + wU, U_MARGIN, v0, v0 + hV, len(moving), len(m.tris), straddle, len(dup), m.vertexCount, nverts))
        if write:
            open(path, "wb").write(out)
            print("  written", path, len(out), "bytes")

if __name__ == "__main__":
    run("--write" in sys.argv)
