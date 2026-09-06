"""
glbreduce — make an imported mockup GLB something Lens Studio will actually load.

    python3 tools/glbreduce.py in.glb out.glb [--max 1024] [--albedo 64] [--keep-node NAME ...]

Pass 22, for the joggers. The Sweatpants mockup shipped an 8000 x 8000 normal map (26 MB
of JPEG) which Lens Studio's glTF loader refuses outright ("Invalid image data"), two
studio-light meshes from the mockup scene, and a 5689 x 5689 "Example" print. This keeps
only the named nodes (default: every node whose mesh is not a light), resizes every image
that is a normal map to --max on its long side, every base-colour map to --albedo (the
bake replaces the albedo at runtime, so it is bound only so ENABLE_BASE_TEX has a target),
and rebuilds the binary chunk from the buffer views that are still referenced.
"""
import sys, json, struct, io
from PIL import Image

def read_glb(p):
    d = open(p, "rb").read()
    magic, ver, length = struct.unpack("<III", d[:12])
    off, js, binc = 12, None, b""
    while off < length:
        cl, ct = struct.unpack("<II", d[off:off+8])
        body = d[off+8:off+8+cl]
        if ct == 0x4E4F534A: js = json.loads(body)
        elif ct == 0x004E4942: binc = body
        off += 8 + cl
    return js, binc

def write_glb(p, js, binc):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    binc += b"\x00" * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    with open(p, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack("<II", len(binc), 0x004E4942)); f.write(binc)

def main():
    a = sys.argv[1:]
    src, dst = a[0], a[1]
    mx = int(a[a.index("--max")+1]) if "--max" in a else 1024
    alb = int(a[a.index("--albedo")+1]) if "--albedo" in a else 64
    keep = [a[i+1] for i, x in enumerate(a) if x == "--keep-node"]
    js, binc = read_glb(src)
    bvs = js["bufferViews"]

    # ---- which nodes survive
    nodes = js["nodes"]
    if not keep:
        keep = [n["name"] for n in nodes if "mesh" in n and "light" not in n["name"].lower()]
    keepIdx = [i for i, n in enumerate(nodes) if n.get("name") in keep]
    print("keeping nodes:", [(i, nodes[i]["name"]) for i in keepIdx])
    meshIdx = sorted(set(nodes[i]["mesh"] for i in keepIdx if "mesh" in nodes[i]))
    matIdx = sorted(set(pr["material"] for m in meshIdx for pr in js["meshes"][m]["primitives"] if "material" in pr))
    texIdx = set()
    for m in matIdx:
        mat = js["materials"][m]
        pbr = mat.get("pbrMetallicRoughness", {})
        for key in ("baseColorTexture", "metallicRoughnessTexture"):
            if key in pbr: texIdx.add(pbr[key]["index"])
        for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            if key in mat: texIdx.add(mat[key]["index"])
    texIdx = sorted(texIdx)
    imgIdx = sorted(set(js["textures"][t]["source"] for t in texIdx))
    # which images are albedo (base colour) — everything else is treated as a data map
    albedoImgs = set()
    for m in matIdx:
        pbr = js["materials"][m].get("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr:
            albedoImgs.add(js["textures"][pbr["baseColorTexture"]["index"]]["source"])

    # ---- new binary: referenced accessor buffer views + re-encoded images
    newBin = bytearray()
    bvMap = {}
    def take(bvi):
        if bvi in bvMap: return bvMap[bvi]
        b = bvs[bvi]
        data = binc[b.get("byteOffset", 0): b.get("byteOffset", 0) + b["byteLength"]]
        while len(newBin) % 4: newBin.append(0)
        nb = dict(b); nb["buffer"] = 0; nb["byteOffset"] = len(newBin)
        newBin.extend(data)
        bvMap[bvi] = len(newBvs); newBvs.append(nb)
        return bvMap[bvi]
    newBvs = []

    accMap = {}
    newAcc = []
    def takeAcc(ai):
        if ai in accMap: return accMap[ai]
        acc = dict(js["accessors"][ai])
        if "bufferView" in acc: acc["bufferView"] = take(acc["bufferView"])
        accMap[ai] = len(newAcc); newAcc.append(acc)
        return accMap[ai]

    newMeshes = []
    meshMap = {}
    for m in meshIdx:
        mesh = json.loads(json.dumps(js["meshes"][m]))
        for pr in mesh["primitives"]:
            pr["attributes"] = {k: takeAcc(v) for k, v in pr["attributes"].items()}
            if "indices" in pr: pr["indices"] = takeAcc(pr["indices"])
            if "material" in pr: pr["material"] = matIdx.index(pr["material"])
        meshMap[m] = len(newMeshes); newMeshes.append(mesh)

    newImages = []
    imgMap = {}
    for i in imgIdx:
        im = js["images"][i]
        b = bvs[im["bufferView"]]
        raw = binc[b.get("byteOffset", 0): b.get("byteOffset", 0) + b["byteLength"]]
        pic = Image.open(io.BytesIO(raw))
        w, h = pic.size
        target = alb if i in albedoImgs else mx
        s = min(1.0, target / float(max(w, h)))
        nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
        pic = pic.convert("RGB")
        if (nw, nh) != (w, h): pic = pic.resize((nw, nh), Image.LANCZOS)
        out = io.BytesIO()
        if i in albedoImgs:
            pic.save(out, "PNG", optimize=True); mime = "image/png"
        else:
            pic.save(out, "PNG", optimize=True); mime = "image/png"
        data = out.getvalue()
        while len(newBin) % 4: newBin.append(0)
        newBvs.append({"buffer": 0, "byteOffset": len(newBin), "byteLength": len(data)})
        newBin.extend(data)
        print("  image %-20s %5d x %-5d -> %4d x %-4d  %8d -> %7d bytes  %s"
              % (im.get("name"), w, h, nw, nh, len(raw), len(data), "albedo" if i in albedoImgs else "data map"))
        imgMap[i] = len(newImages)
        newImages.append({"name": im.get("name"), "mimeType": mime, "bufferView": len(newBvs) - 1})

    newTex = []
    texMap = {}
    for t in texIdx:
        tex = dict(js["textures"][t]); tex["source"] = imgMap[tex["source"]]
        texMap[t] = len(newTex); newTex.append(tex)
    newMats = []
    for m in matIdx:
        mat = json.loads(json.dumps(js["materials"][m]))
        pbr = mat.get("pbrMetallicRoughness", {})
        for key in ("baseColorTexture", "metallicRoughnessTexture"):
            if key in pbr: pbr[key]["index"] = texMap[pbr[key]["index"]]
        for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            if key in mat: mat[key]["index"] = texMap[mat[key]["index"]]
        newMats.append(mat)
    newNodes = []
    for i in keepIdx:
        n = dict(nodes[i])
        if "mesh" in n: n["mesh"] = meshMap[n["mesh"]]
        n.pop("children", None)
        newNodes.append(n)
    out = {
        "asset": js["asset"],
        "scene": 0,
        "scenes": [{"name": js.get("scenes", [{}])[0].get("name", "Scene"), "nodes": list(range(len(newNodes)))}],
        "nodes": newNodes, "meshes": newMeshes, "materials": newMats,
        "textures": newTex, "images": newImages,
        "accessors": newAcc, "bufferViews": newBvs,
        "buffers": [{"byteLength": len(newBin)}],
    }
    if "samplers" in js: out["samplers"] = js["samplers"]
    write_glb(dst, out, bytes(newBin))
    import os
    print("wrote %s  %.1f MB (from %.1f MB)" % (dst, os.path.getsize(dst)/1e6, os.path.getsize(src)/1e6))

if __name__ == "__main__":
    main()
