// Geo — tiny procedural mesh helpers (Pass 8).
//
// The Pass-8 UI (rotation platform + reworked selection frame) needs round shapes:
// the platform plate is an ellipse, the tick marks and corner handles are dots, and
// the rotate glyph / resize glyph are arcs and arrowheads. Rather than ship a folder
// of PNGs, we build them once with MeshBuilder and reuse the RenderMesh everywhere.
//
// Every mesh here uses the SAME vertex layout as StickerCompositor.buildUnitQuad
// (position:3 + texture0:2), so all of them work with the existing StickerQuadMat /
// MoteMaterial clones without any shader change. All shapes are centered on the
// origin in the XY plane (facing +Z) and sized to a UNIT radius / unit extent, so the
// caller scales them with the SceneObject transform.

function build(verts: number[], indices: number[]): RenderMesh {
  const b = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  b.appendVerticesInterleaved(verts)
  b.appendIndices(indices)
  b.updateMesh()
  return b.getMesh()
}

/**
 * Filled disc of radius 1 in the XY plane (a triangle fan around a center vertex).
 * Scaling the SceneObject non-uniformly turns it into the platform's ellipse.
 */
export function buildDisc(segments: number = 48): RenderMesh {
  const verts: number[] = [0, 0, 0, 0.5, 0.5] // center
  const indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const x = Math.cos(a)
    const y = Math.sin(a)
    verts.push(x, y, 0, x * 0.5 + 0.5, y * 0.5 + 0.5)
  }
  for (let i = 1; i <= segments; i++) {
    indices.push(0, i, i + 1)
  }
  return build(verts, indices)
}

/**
 * Annulus / arc band in the XY plane: a ring of outer radius 1 and inner radius
 * `inner`, spanning [startDeg, endDeg]. A full 0..360 span gives a ring outline;
 * a partial span gives the open arcs used by the rotate glyph.
 */
export function buildRing(
  inner: number,
  segments: number = 48,
  startDeg: number = 0,
  endDeg: number = 360
): RenderMesh {
  const verts: number[] = []
  const indices: number[] = []
  const a0 = (startDeg * Math.PI) / 180
  const a1 = (endDeg * Math.PI) / 180
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments
    const c = Math.cos(a)
    const s = Math.sin(a)
    const u = i / segments
    verts.push(c * inner, s * inner, 0, u, 0)
    verts.push(c, s, 0, u, 1)
  }
  for (let i = 0; i < segments; i++) {
    const k = i * 2
    indices.push(k, k + 2, k + 3, k, k + 3, k + 1)
  }
  return build(verts, indices)
}

/**
 * Isoceles triangle pointing +X, inscribed in the unit box (x in [-0.5,0.5],
 * y in [-0.5,0.5]). Used as the arrowheads on the rotate and resize glyphs;
 * rotate the SceneObject about Z to aim it.
 */
export function buildTriangle(): RenderMesh {
  const verts = [
    0.5, 0.0, 0, 1.0, 0.5,
    -0.5, 0.5, 0, 0.0, 1.0,
    -0.5, -0.5, 0, 0.0, 0.0,
  ]
  return build(verts, [0, 1, 2])
}


/**
 * A rounded rectangle in the XY plane, centred, in the units it is given (no scaling
 * needed afterwards): `w` by `h` with corner radius `r`. Pass 24 — every glass panel,
 * pill and button is one of these; before this pass the same surfaces were ellipses, or
 * a quad between two discs.
 */
export function buildRoundedRect(w: number, h: number, r: number, segments: number = 8): RenderMesh {
  const b = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  const verts: number[] = [0, 0, 0, 0.5, 0.5]
  const ring: number[] = []
  // Corner centres, anticlockwise from top-right.
  const cx = [w / 2 - rr, -w / 2 + rr, -w / 2 + rr, w / 2 - rr]
  const cy = [h / 2 - rr, h / 2 - rr, -h / 2 + rr, -h / 2 + rr]
  let n = 1
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i <= segments; i++) {
      const a = (Math.PI / 2) * c + ((Math.PI / 2) * i) / segments
      const x = cx[c] + rr * Math.cos(a)
      const y = cy[c] + rr * Math.sin(a)
      verts.push(x, y, 0, 0.5 + x / w, 0.5 + y / h)
      ring.push(n++)
    }
  }
  b.appendVerticesInterleaved(verts)
  const idx: number[] = []
  for (let i = 0; i < ring.length; i++) idx.push(0, ring[i], ring[(i + 1) % ring.length])
  b.appendIndices(idx)
  b.updateMesh()
  return b.getMesh()
}


/**
 * Pass 30: a rounded-rectangle RING — the outer w x h with corner radius r, minus the
 * inner one `t` narrower on every side. Drawn over a square image it rounds the image's
 * corners without a mask: the ring covers whatever pokes past its inner curve.
 */
export function buildRoundedRectRing(w: number, h: number, r: number, t: number, segments: number = 8): RenderMesh {
  const b = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  const ring = (ww: number, hh: number, rr: number): number[][] => {
    const k = Math.max(0, Math.min(rr, ww / 2, hh / 2))
    const cx = [ww / 2 - k, -ww / 2 + k, -ww / 2 + k, ww / 2 - k]
    const cy = [hh / 2 - k, hh / 2 - k, -hh / 2 + k, -hh / 2 + k]
    const pts: number[][] = []
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i <= segments; i++) {
        const a = (Math.PI / 2) * c + ((Math.PI / 2) * i) / segments
        pts.push([cx[c] + k * Math.cos(a), cy[c] + k * Math.sin(a)])
      }
    }
    return pts
  }
  const outer = ring(w, h, r)
  const inner = ring(w - 2 * t, h - 2 * t, Math.max(0.01, r - t))
  const verts: number[] = []
  for (let i = 0; i < outer.length; i++) {
    verts.push(outer[i][0], outer[i][1], 0, 0.5 + outer[i][0] / w, 0.5 + outer[i][1] / h)
    verts.push(inner[i][0], inner[i][1], 0, 0.5 + inner[i][0] / w, 0.5 + inner[i][1] / h)
  }
  b.appendVerticesInterleaved(verts)
  const idx: number[] = []
  const n = outer.length
  for (let i = 0; i < n; i++) {
    const a = 2 * i, bb = 2 * i + 1, c = 2 * ((i + 1) % n), d = 2 * ((i + 1) % n) + 1
    idx.push(a, c, d, a, d, bb)
  }
  b.appendIndices(idx)
  b.updateMesh()
  return b.getMesh()
}

/**
 * PASS 38 — A RIBBON: one mesh along a polyline, with mitred joins.
 *
 * WHY THIS EXISTS. The selection frame draws each side as a chain of segments so the
 * stroke follows the cloth's curve rather than cutting the chord between the corners
 * (StickerSystem.FRAME_SEGMENTS). Drawing that chain as a row of separate quads is what
 * made the line look built-from-pieces, and neither way of butting them up works:
 *
 *   overlap them  -> a TRANSLUCENT layer composites over itself, and every join carries a
 *                    brighter (or, for the old dark backing, darker) bead;
 *   butt them     -> adjacent quads are rotated about their own midpoints, so away from
 *                    the centre line a wedge of halfWidth x the turn angle opens at every
 *                    join, and the glow shows a gap.
 *
 * There is no width to tune that fixes both. A ribbon has neither problem because it has
 * no joins: the whole side is ONE triangle strip, and at each interior point the two
 * edge vertices sit on the MITRE — the bisector of the two segment normals, lengthened by
 * 1/cos(theta/2) so the band keeps its width through the turn. Coverage is exact and the
 * surface is painted once, so any alpha composites exactly once too.
 *
 * `pts` are in the caller's own space and their z is CARRIED, not flattened, so a ribbon
 * laid along a curved surface stays on it. The mesh is therefore absolute, not a unit
 * shape: the object holding it sits at identity.
 */
export function buildRibbon(pts: { x: number; y: number; z: number }[], halfWidth: number): RenderMesh {
  const n = pts.length
  const verts: number[] = []
  const indices: number[] = []
  if (n < 2) return build([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2])

  // Unit direction of each segment, and its left normal.
  const dx: number[] = []
  const dy: number[] = []
  for (let i = 0; i < n - 1; i++) {
    let ax = pts[i + 1].x - pts[i].x
    let ay = pts[i + 1].y - pts[i].y
    const L = Math.sqrt(ax * ax + ay * ay) || 1
    dx.push(ax / L)
    dy.push(ay / L)
  }

  for (let i = 0; i < n; i++) {
    // The mitre at point i: the bisector of the normals either side of it. At the two
    // ends there is only one segment, so the mitre is just that segment's normal.
    const a = i === 0 ? 0 : i - 1
    const b = i === n - 1 ? n - 2 : i
    // Left normals of the incoming and outgoing segments.
    const nax = -dy[a]
    const nay = dx[a]
    const nbx = -dy[b]
    const nby = dx[b]
    let mx = nax + nbx
    let my = nay + nby
    const ml = Math.sqrt(mx * mx + my * my)
    if (ml < 1e-6) { mx = nbx; my = nby } else { mx /= ml; my /= ml }
    // 1/cos(theta/2): how much longer the mitre has to be to hold the band's width
    // through the turn. Clamped so a hairpin cannot fire the vertex off to infinity.
    const cosHalf = mx * nbx + my * nby
    const scale = Math.min(RIBBON_MITRE_LIMIT, 1 / Math.max(0.2, Math.abs(cosHalf)))
    const ox = mx * halfWidth * scale
    const oy = my * halfWidth * scale
    const u = i / (n - 1)
    verts.push(pts[i].x + ox, pts[i].y + oy, pts[i].z, u, 1)
    verts.push(pts[i].x - ox, pts[i].y - oy, pts[i].z, u, 0)
  }
  for (let i = 0; i < n - 1; i++) {
    const k = i * 2
    indices.push(k, k + 2, k + 3, k, k + 3, k + 1)
  }
  return build(verts, indices)
}

/** How far a mitre may stretch at a sharp turn before it is cut short. */
export const RIBBON_MITRE_LIMIT = 4
