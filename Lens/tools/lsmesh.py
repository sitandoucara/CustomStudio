"""
lsmesh — a reader for Lens Studio's binary .mesh format.

Written for the Pass 11 shirt survey and generalised in Pass 18 so any imported
garment can be surveyed the same way. The format is a tagged key/value stream:

    u32 version | u32 unknown | 64 bytes reserved
    u32 stringCount, then that many (u32 len, bytes) names   <- 1-indexed
    records until the root END:
        u16 type | u32 keyIdx | u32 size | payload(size)
    type 0x00  END of the enclosing object
    type 0x01  bool        0x02 int32      0x06 uint32
    type 0x07  float[2]    0x08 float[3]   0x0e BEGIN object (size 0)
    type 0x0f  BLOB        the size field IS the byte length; a u32 offset into the
                           trailing data section follows it in place of a payload
    type 0x18  string index
    the data section begins immediately after the root END.
"""
import struct

T_END, T_BOOL, T_I32, T_U32 = 0x00, 0x01, 0x02, 0x06
T_F2, T_F3, T_OBJ, T_BLOB, T_STR = 0x07, 0x08, 0x0e, 0x0f, 0x18


class Mesh:
    def __init__(self, path):
        self.path = path
        d = open(path, "rb").read()
        self.raw = d
        p = 72
        n, = struct.unpack_from("<I", d, p); p += 4
        self.strings = [""]
        for _ in range(n):
            ln, = struct.unpack_from("<I", d, p); p += 4
            self.strings.append(d[p:p + ln].decode("utf-8")); p += ln
        self.root, p = self._obj(d, p)
        self.dataOff = p
        self._decode()

    def _obj(self, d, p):
        out = []
        while True:
            t, = struct.unpack_from("<H", d, p); p += 2
            if t == T_END:
                return out, p
            k, = struct.unpack_from("<I", d, p); p += 4
            key = self.strings[k] if k < len(self.strings) else "?%d" % k
            if t == T_OBJ:
                sz, = struct.unpack_from("<I", d, p); p += 4
                val, p = self._obj(d, p)
            else:
                sz, = struct.unpack_from("<I", d, p); p += 4
                if t == T_BLOB:
                    off, = struct.unpack_from("<I", d, p); p += 4
                    val = ("blob", sz, off)
                elif t == T_BOOL:
                    val = d[p] != 0; p += sz
                elif t in (T_I32, T_U32, T_STR):
                    val, = struct.unpack_from("<i" if t == T_I32 else "<I", d, p); p += sz
                    if t == T_STR:
                        val = self.strings[val]
                elif t == T_F2:
                    val = struct.unpack_from("<2f", d, p); p += sz
                elif t == T_F3:
                    val = struct.unpack_from("<3f", d, p); p += sz
                else:
                    val = d[p:p + sz]; p += sz
            out.append((key, val))
        return out, p

    def _get(self, obj, key, default=None):
        for k, v in obj:
            if k == key:
                return v
        return default

    def _decode(self):
        r = self.root
        d = self.raw
        self.indexType = self._get(r, "indexType", 1)
        self.topology = self._get(r, "topology", 0)
        self.bbmin = self._get(r, "bbmin")
        self.bbmax = self._get(r, "bbmax")
        layout = self._get(r, "vertexlayout", [])
        self.vertexSize = self._get(layout, "vertexSize", 0)
        attrs = []
        for k, v in layout:
            if k == "attributes":
                for k2, v2 in v:
                    attrs.append({
                        "semantic": self._get(v2, "semantic"),
                        "type": self._get(v2, "type"),
                        "cc": self._get(v2, "componentCount"),
                        "offset": self._get(v2, "offset"),
                    })
        self.attrs = attrs

        vb = self._get(r, "vertices")
        ib = self._get(r, "indices")
        vlen, voff = vb[1], vb[2]
        ilen, ioff = ib[1], ib[2]
        vbase = self.dataOff + voff
        ibase = self.dataOff + ioff
        self.vertexCount = vlen // self.vertexSize

        def attr(sem):
            for a in attrs:
                if a["semantic"] == sem:
                    return a
            return None

        ap, an, at = attr("position"), attr("normal"), attr("texture0")
        self.pos, self.nrm, self.uv = [], [], []
        for i in range(self.vertexCount):
            b = vbase + i * self.vertexSize
            self.pos.append(struct.unpack_from("<3f", d, b + ap["offset"]))
            self.nrm.append(struct.unpack_from("<3f", d, b + an["offset"]) if an else (0.0, 0.0, 0.0))
            self.uv.append(struct.unpack_from("<2f", d, b + at["offset"]) if at else (0.0, 0.0))

        # indexType 1 => uint16, 2 => uint32 (observed; fall back on size)
        stride = 2 if ilen // 2 > self.vertexCount or self.indexType == 1 else 4
        if self.indexType == 2:
            stride = 4
        cnt = ilen // stride
        fmt = "<%d%s" % (cnt, "H" if stride == 2 else "I")
        idx = struct.unpack_from(fmt, d, ibase)
        self.tris = [(idx[i], idx[i + 1], idx[i + 2]) for i in range(0, cnt - 2, 3)]

    def __repr__(self):
        return "<Mesh %s verts=%d tris=%d>" % (self.path.split("/")[-1], self.vertexCount, len(self.tris))
