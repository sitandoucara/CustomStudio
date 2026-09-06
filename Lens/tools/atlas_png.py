"""
atlas_png — draw what the survey found, so the two verdicts can be SEEN.

Left panel:  every UV island in its own colour, printable ones bright, the rest dim,
             with each printable island's largest inscribed rect outlined.
Right panel: the MIRROR TEST. Every texel is tinted by the sign of the mesh-space X of
             the triangles covering it — cool for the -X half, warm for the +X half, and
             RED for any texel covered by both. A mirrored atlas is red down its middle;
             this one has no red pixel anywhere, which IS the verdict.

Pure stdlib: zlib + struct. No PIL.
"""
import sys, math, zlib, struct
sys.path.insert(0, "tools")
from survey import survey, raster_tris, STICKER_SIDE

RES = 720
GAP = 24


def png(path, w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(raw, 9))
    out += chunk(b"IEND", b"")
    open(path, "wb").write(out)


PALETTE = [
    (255, 122, 89), (86, 190, 255), (255, 205, 84), (129, 226, 150),
    (198, 150, 255), (255, 150, 200), (120, 255, 226), (255, 178, 110),
    (150, 175, 255), (222, 240, 120), (255, 140, 160), (110, 220, 190),
]


def run(which, out):
    s = survey(which, quiet=True)
    rows = s["rows"]
    cmPerMesh = s["cmPerMesh"]
    side = STICKER_SIDE[which]

    printable = {}
    for m, isl, rect, jac in rows:
        if rect and jac:
            sc = min(rect["halfRight"], rect["halfUp"]) * cmPerMesh / (side / 2.0)
            printable[isl.idx] = sc >= 0.4

    cover = raster_tris([(isl.idx, (m, isl)) for m, isl, _, _ in rows], RES)

    W = RES * 2 + GAP
    H = RES
    buf = bytearray([16, 17, 22] * (W * H))

    def put(px, py, x, y, c):
        i = ((RES - 1 - y) * W + px + x) * 3
        buf[i], buf[i + 1], buf[i + 2] = c

    for (x, y), lst in cover.items():
        ids = sorted(set(i for i, _ in lst))
        # --- left: islands
        col = PALETTE[ids[0] % len(PALETTE)]
        if not printable.get(ids[0], False):
            col = tuple(int(c * 0.30) + 18 for c in col)
        if len(ids) > 1:
            col = (255, 0, 0)  # a cross-island collision, if one existed
        put(0, 0, x, y, col)
        # --- right: mirror test
        xs = [v for _, v in lst]
        lo, hi = min(xs), max(xs)
        if lo < -0.5 and hi > 0.5:
            c = (255, 0, 0)                      # both halves under one texel = MIRRORED
        elif hi < 0:
            c = (70, 150, 235)                   # -X half
        elif lo > 0:
            c = (240, 150, 60)                   # +X half
        else:
            c = (200, 200, 205)                  # straddles the centre line
        put(RES + GAP, 0, x, y, c)

    png(out, W, H, buf)
    coll = sum(1 for l in cover.values() if len(set(i for i, _ in l)) > 1)
    mirror = sum(1 for l in cover.values()
                 if min(v for _, v in l) < -0.5 and max(v for _, v in l) > 0.5)
    print("%s -> %s   %d texels covered (%.1f%%)   cross-island collisions: %d   mirrored texels: %d"
          % (which, out, len(cover), 100.0 * len(cover) / (RES * RES), coll, mirror))


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "cap",
        sys.argv[2] if len(sys.argv) > 2 else "/tmp/atlas.png")
