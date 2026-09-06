// GemSystem — small faceted stones glued to the cloth (Pass 29).
//
// ===========================================================================
// GEMS ARE GEOMETRY, NOT A STAMP
// ===========================================================================
// Stickers, text and paint bake into the garment's texture. A gem cannot: a flat picture
// of a rhinestone is exactly the thing that makes it look cheap. So every gem here is a
// little faceted solid — a flat-back cabochon with a vertical girdle, a bevelled crown
// and a flat table — with a normal per facet, lit by the scene's own light through a PBR
// material. As the platform turns, the facets catch the light differently, which is the
// whole point of doing it in 3D.
//
// ===========================================================================
// ONE DRAW CALL PER COLOUR, NOT ONE PER GEM
// ===========================================================================
// A shirt covered in gems is the goal, not the edge case, so a SceneObject per stone was
// never an option: four hundred stones would be four hundred draw calls. Instead every
// gem is appended into a MeshBuilder shared by all gems of ITS COLOUR on ITS GARMENT —
// its vertices already placed, oriented and sized in the garment's own space — and each
// such batch is one RenderMeshVisual with one material clone tinted that colour. Ten
// colours means at most ten draw calls for the whole covered garment; one colour means
// one. A gem costs ~60 triangles (180 unshared vertices at 32 bytes = 5.8 KB, plus 360
// bytes of indices), so 400 gems are 72 k vertices and 2.4 MB, which stays comfortable;
// GEM_MAX_PER_GARMENT refuses the 401st rather than letting a scatter run away.
//
// The batches are children of the garment's VISUAL, so they turn, bob, hide and show with
// it, are on the SHIRT layer so the photo camera sees them, and are the garment's state:
// switching garments switches which batches are on screen, nothing is parked or restored.
//
// ===========================================================================
// REMOVAL: UNDO THE LAST STROKE, OR ARM AND CLEAR
// ===========================================================================
// Gems are placed in quantity; a frame per stone would be the wrong interaction. Every
// tap or drag is a STROKE, and each stroke remembers how many vertices it appended to
// which batches — always at their END, since strokes do not interleave — so Undo pops
// the last stroke exactly, and nothing else. Clear takes everything, and like the paint
// erase it has to be pressed twice, because losing a covered garment to a misclick is
// worse than one extra tap.

import { LAYERS, setLayerDeep } from "./Layers"
import { whiteTexture } from "./PhotoUi"

// PASS 40 — THE DROP IS GONE; THE FLOWER IS THE FIFTH CUT. The drop's outline (a circle
// with a point on top) never read as a stone in the panel, and the reference sheets
// (Refs/gem_2, the girl's forehead) carry a five-petal flower instead: a small round
// centre with rounded petals round it. Built the same way as every other cut — flat
// back, girdle, bevelled crown, one normal per facet — with one difference the shape
// needs: its TABLE is a circle, not the outline shrunk. Shrinking a flower gives a
// smaller flower; a circle gives the round centre, and the bevel from each petal's tip
// down to that circle is what makes the petals rise. See outline() and buildGem.
export type GemShape = "round" | "heart" | "star" | "square" | "flower"
export const GEM_SHAPES: GemShape[] = ["round", "heart", "star", "square", "flower"]
export const GEM_SHAPE_NAMES: string[] = ["Round", "Heart", "Star", "Square", "Flower", "Mix"]
/**
 * The flower's outline is FIVE PETAL CIRCLES, not a cosine: r = a + b cos(5 theta) was
 * tried first and gives a rounded star — the lobes taper to a point. A petal is round at
 * its tip, so each petal is a circle of radius FLOWER_PETAL_R centred FLOWER_PETAL_D out
 * from the stone's centre, and the outline follows each circle's outer arc between the
 * two points where it meets its neighbours (the notches, on the 36-degree bisectors).
 * The tip sits at D + R = 1.0; the notch at 0.58. Five samples per petal (the notch and
 * four along the arc, none exactly on the tip so the tip reads as a short round edge) is
 * 25 points, and at five triangles an outline edge that is 125 triangles a stone against
 * the 60 of a 12-point round.
 */
export const FLOWER_PETALS = 5
export const FLOWER_PETAL_D = 0.625 // petal circle centre, from the stone's centre
export const FLOWER_PETAL_R = 0.375 // petal circle radius (D + R = 1: the tip is the stone's radius)
export const FLOWER_ARC_DEG = [-36, -27, -9, 9, 27] // sample angles about a petal's centre line; +36 is the next petal's -36
export const FLOWER_POINTS = FLOWER_PETALS * FLOWER_ARC_DEG.length // 25
/** The round centre's radius, as a fraction of the stone's — inside the notch radius (0.58), like the reference's dot. */
export const FLOWER_TABLE_K = 0.44
/** The sixth shape choice: every stone picks one of the five at random. */
export const GEM_SHAPE_MIX = GEM_SHAPES.length

// --- The colours -------------------------------------------------------------------
// Jewel tones, as the stones on the reference sheets are: each is a saturated hue held
// at high value so it reads on a white garment, and dark enough in chroma to read on a
// saturated one; "diamond" is the clear stone, kept just off white so it still shows on
// white cloth by its facets. An eleventh choice, Mix, draws a colour per stone.
export const GEM_COLORS: { name: string; rgb: vec4 }[] = [
  { name: "Ruby", rgb: new vec4(0.92, 0.10, 0.28, 1) },
  { name: "Pink", rgb: new vec4(0.96, 0.32, 0.66, 1) },
  { name: "Amber", rgb: new vec4(0.98, 0.60, 0.10, 1) },
  { name: "Citrine", rgb: new vec4(0.98, 0.84, 0.16, 1) },
  { name: "Peridot", rgb: new vec4(0.56, 0.86, 0.22, 1) },
  { name: "Emerald", rgb: new vec4(0.08, 0.66, 0.42, 1) },
  { name: "Aqua", rgb: new vec4(0.12, 0.80, 0.86, 1) },
  { name: "Sapphire", rgb: new vec4(0.14, 0.34, 0.94, 1) },
  { name: "Amethyst", rgb: new vec4(0.60, 0.28, 0.92, 1) },
  { name: "Diamond", rgb: new vec4(0.90, 0.93, 1.00, 1) },
]
export const GEM_COLOR_MIX = GEM_COLORS.length

// --- Pass 41: THE PICKED COLOUR, TREATED AS A GEM ----------------------------------------
// The eyedropper in the gem panel is the third caller of the world-colour picker. What
// comes back from the camera is FLAT — a wall, a jacket, a floor: usually low in
// saturation, often mid in value — and a stone painted that colour reads as a bead of
// plastic, not a jewel. The ten tones above are all the same recipe: a hue held at high
// saturation AND high value, so the emissive glow (GEM_EMISSIVE_K) and the specular of
// the PBR material have something bright to work with. gemTone() puts a picked colour
// through that recipe — its HUE is kept exactly, its saturation is raised to at least
// GEM_TONE_S_MIN and its value to at least GEM_TONE_V_MIN — and then the stone takes the
// same baseColor / metallic / roughness / emissive path as every other batch (batchFor),
// so it catches the light exactly as the eleven do. A near-grey pick (saturation under
// GEM_TONE_S_GREY: white walls, black cloth) has no hue worth saturating; it becomes a
// clear stone like "Diamond", held near white, since a black gem would be invisible on
// a dark garment and a grey one reads as dirt.
//
// The panel's chip shows the TONED colour — the colour the stones will be — and the log
// prints both hexes, so the change is visible and on the record.
/** The panel's index for the eyedropper's chip (the ten tones are 0..9, Mix is 10). */
export const GEM_COLOR_PICKED = GEM_COLORS.length + 1
/** Batch keys for picked colours start here; the ten tones and Mix stay below it. */
export const GEM_COLOR_CUSTOM_BASE = 100
export const GEM_TONE_S_MIN = 0.72 // the least saturated of the ten tones (Diamond aside) is Peridot at 0.74
export const GEM_TONE_V_MIN = 0.90 // the darkest of the ten is Emerald at 0.66; stones want light
export const GEM_TONE_S_GREY = 0.14 // under this a pick has no hue: it becomes a clear stone
export const GEM_TONE_DIAMOND = new vec4(0.90, 0.93, 1.00, 1) // the clear stone, "Diamond" above

/** The picked colours registered so far, in registration order — a batch key each. */
const PICKED_GEM_COLORS: { name: string; rgb: vec4 }[] = []

function gemHex(c: vec4): string {
  const h = (x: number): string => {
    const n = Math.max(0, Math.min(255, Math.round(x * 255)))
    return (n < 16 ? "0" : "") + n.toString(16).toUpperCase()
  }
  return "#" + h(c.x) + h(c.y) + h(c.z)
}

/** A flat colour put through the jewel-tone recipe the ten tones follow. See the note above. */
export function gemTone(c: vec4): vec4 {
  const r = c.x, g = c.y, b = c.z
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const s = max <= 1e-6 ? 0 : d / max
  if (s < GEM_TONE_S_GREY) return new vec4(GEM_TONE_DIAMOND.x, GEM_TONE_DIAMOND.y, GEM_TONE_DIAMOND.z, 1)
  let h = 0
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    if (h < 0) h += 6
  }
  const s2 = Math.max(s, GEM_TONE_S_MIN)
  const v2 = Math.max(max, GEM_TONE_V_MIN)
  const cc = v2 * s2
  const x = cc * (1 - Math.abs((h % 2) - 1))
  const m = v2 - cc
  let rr = 0, gg = 0, bb = 0
  if (h < 1) { rr = cc; gg = x } else if (h < 2) { rr = x; gg = cc } else if (h < 3) { gg = cc; bb = x }
  else if (h < 4) { gg = x; bb = cc } else if (h < 5) { rr = x; bb = cc } else { rr = cc; bb = x }
  return new vec4(rr + m, gg + m, bb + m, 1)
}

/**
 * Register a (toned) picked colour and get the batch key its stones are placed under.
 * The same colour picked twice gets the same key, so re-picking never splits a batch.
 */
export function registerGemColor(rgb: vec4): number {
  const hex = gemHex(rgb)
  for (let i = 0; i < PICKED_GEM_COLORS.length; i++) {
    if (PICKED_GEM_COLORS[i].name === hex) return GEM_COLOR_CUSTOM_BASE + i
  }
  PICKED_GEM_COLORS.push({ name: hex, rgb: new vec4(rgb.x, rgb.y, rgb.z, 1) })
  return GEM_COLOR_CUSTOM_BASE + PICKED_GEM_COLORS.length - 1
}

/** A placed colour key (tone index or picked key) is a colour a batch can be built for. */
export function isGemColorKey(key: number): boolean {
  if (key >= 0 && key < GEM_COLORS.length) return true
  return key >= GEM_COLOR_CUSTOM_BASE && key - GEM_COLOR_CUSTOM_BASE < PICKED_GEM_COLORS.length
}

export function gemColorRgb(key: number): vec4 {
  if (key >= GEM_COLOR_CUSTOM_BASE) {
    const p = PICKED_GEM_COLORS[key - GEM_COLOR_CUSTOM_BASE]
    return p ? p.rgb : GEM_TONE_DIAMOND
  }
  const t = GEM_COLORS[Math.max(0, Math.min(GEM_COLORS.length - 1, key))]
  return t.rgb
}

export function gemColorName(key: number): string {
  if (key >= GEM_COLOR_CUSTOM_BASE) {
    const p = PICKED_GEM_COLORS[key - GEM_COLOR_CUSTOM_BASE]
    return p ? "Picked_" + p.name : "Picked"
  }
  return GEM_COLORS[Math.max(0, Math.min(GEM_COLORS.length - 1, key))].name
}

// --- Size and scatter ---------------------------------------------------------------
export const GEM_SIZE_MIN = 0.4 // cm across: the tiny scattered stones
export const GEM_SIZE_MAX = 2.4 // one large centrepiece
export const GEM_SIZE_INIT = 0.9
/** Every stone's size is the chosen size times a random factor in [1 - J, 1 + J]. */
export const GEM_SIZE_JITTER = 0.22
/** Along a drag, the next stone drops once the pointer is this many stone-widths on. */
export const GEM_TRAIL_SPACING_K = 1.7
/** A gem's height as a fraction of its width — a flat-back stone, not a bead. */
export const GEM_HEIGHT_K = 0.34
/** How far the flat back sits off the cloth, so the base never z-fights the fabric. */
export const GEM_LIFT_CM = 0.04
export const GEM_MAX_PER_GARMENT = 400
/**
 * PASS 40 — THE CEILING THAT WAS ACTUALLY THERE. Every batch is one MeshBuilder with
 * UInt16 indices (the only index type the API offers), so a batch holds at most 65,535
 * vertices — and a batch is one COLOUR on one garment. At 180 unshared vertices a round
 * stone that is 364 stones of one colour; the 400-per-garment cap above only ever held
 * for a scatter spread across colours, and a single-colour scatter would have appended
 * past the index range at stone 365. The flower is 300 vertices (100 triangles), so
 * its single-colour ceiling is 218. place() now refuses a stone that would push its
 * batch past this, whatever the garment count says; Mix scatters spread over ten batches
 * and keep the full 400.
 */
export const GEM_BATCH_MAX_VERTS = 65535
/** Where the tap is refused past the ceiling. */
export const GEM_LIMIT_WORD = "Gem limit reached"

const GEM_MAT = requireAsset("../Materials/GemMaterial.mat") as Material
const GEM_METALLIC = 0.15
const GEM_ROUGHNESS = 0.22
/** A little self-light, as a fraction of the stone's colour: the plastic-jewel glow, and
 * what keeps a stone readable where the scene's one light does not reach a facet. */
const GEM_EMISSIVE_K = 0.22
const GEM_TABLE_K = 0.56 // the flat top's size as a fraction of the base
const GEM_GIRDLE_K = 0.45 // where the vertical wall ends, as a fraction of the height

// --- Outlines, unit radius, XY plane, anticlockwise ----------------------------------
function outline(shape: GemShape): vec2[] {
  const pts: vec2[] = []
  if (shape === "round") {
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push(new vec2(Math.cos(a), Math.sin(a))) }
  } else if (shape === "square") {
    const s = 0.86
    pts.push(new vec2(-s, -s), new vec2(s, -s), new vec2(s, s), new vec2(-s, s))
  } else if (shape === "star") {
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2
      const r = i % 2 === 0 ? 1.0 : 0.46
      pts.push(new vec2(r * Math.cos(a), r * Math.sin(a)))
    }
  } else if (shape === "heart") {
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2
      // The classic heart curve, scaled to a unit-ish radius.
      const x = 16 * Math.pow(Math.sin(t), 3)
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      pts.push(new vec2(x / 17, y / 17 + 0.1))
    }
  } else {
    // flower (Pass 40): five round petals, one tip straight up. Along a ray at angle
    // `da` from a petal's centre line, the outline is that petal circle's FAR intersection:
    //   r(da) = D cos(da) + sqrt(R^2 - D^2 sin^2(da))
    for (let k = 0; k < FLOWER_PETALS; k++) {
      const centre = Math.PI / 2 + (k / FLOWER_PETALS) * Math.PI * 2
      for (const deg of FLOWER_ARC_DEG) {
        const da = (deg * Math.PI) / 180
        const under = FLOWER_PETAL_R * FLOWER_PETAL_R - FLOWER_PETAL_D * FLOWER_PETAL_D * Math.sin(da) * Math.sin(da)
        const r = FLOWER_PETAL_D * Math.cos(da) + Math.sqrt(Math.max(0, under))
        const a = centre + da
        pts.push(new vec2(r * Math.cos(a), r * Math.sin(a)))
      }
    }
  }
  // Make sure the winding is anticlockwise (positive area) so normals point out.
  let area = 0
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y }
  if (area < 0) pts.reverse()
  return pts
}

/** A flat fan of a shape's outline, for the shape buttons. Unit size, faces +Z. */
export function buildGemIcon(shape: GemShape): RenderMesh {
  const b = new MeshBuilder([{ name: "position", components: 3 }, { name: "texture0", components: 2 }])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  const pts = outline(shape)
  const v: number[] = [0, 0, 0, 0.5, 0.5]
  for (const p of pts) v.push(p.x, p.y, 0, 0.5 + p.x / 2, 0.5 + p.y / 2)
  b.appendVerticesInterleaved(v)
  const idx: number[] = []
  for (let i = 0; i < pts.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % pts.length))
  b.appendIndices(idx)
  b.updateMesh()
  return b.getMesh()
}

/** One stone, ready to append: where, which way is out, how big, how turned, what. */
export interface GemSpec {
  /** Centre of the flat back, in the garment visual's LOCAL space. */
  pos: vec3
  /** Outward normal there, local space, unit. */
  normal: vec3
  /** Width across, in local units (cm divided by the visual's world scale). */
  size: number
  /** How far the flat back sits off the cloth, in the same local units (GEM_LIFT_CM scaled). */
  lift: number
  /** Turn about the normal, radians. */
  rot: number
  shape: GemShape
  color: number // a colour KEY: an index into GEM_COLORS, or a picked key from registerGemColor (Pass 41)
}

interface Batch {
  builder: MeshBuilder
  obj: SceneObject
  count: number
}

interface StrokeRecord {
  /** Per batch touched: how many vertices and indices this stroke appended, at the end. */
  parts: { color: number; verts: number; idx: number }[]
  gems: number
}

interface GemSet {
  id: string
  visual: SceneObject
  batches: { [color: number]: Batch }
  strokes: StrokeRecord[]
  count: number
}

export class GemSystem {
  private sets: { [id: string]: GemSet } = {}
  private active: GemSet | null = null
  private open: StrokeRecord | null = null

  /** The garment on screen changed: its batches are its state, nothing to restore. */
  switchTo(id: string, visual: SceneObject | null): void {
    if (!visual) { this.active = null; return }
    let s = this.sets[id]
    if (!s) {
      s = { id, visual, batches: {}, strokes: [], count: 0 }
      this.sets[id] = s
    }
    this.active = s
    this.open = null
  }

  count(): number {
    return this.active ? this.active.count : 0
  }

  canUndo(): boolean {
    return !!this.active && this.active.strokes.length > 0
  }

  beginStroke(): void {
    this.open = { parts: [], gems: 0 }
  }

  endStroke(): void {
    if (this.open && this.active && this.open.gems > 0) this.active.strokes.push(this.open)
    this.open = null
  }

  /** Append one stone. Returns false past the ceiling. */
  place(g: GemSpec): boolean {
    const s = this.active
    if (!s) return false
    if (s.count >= GEM_MAX_PER_GARMENT) return false
    const batch = this.batchFor(s, g.color)
    const v0 = batch.builder.getVerticesCount()
    const i0 = batch.builder.getIndicesCount()
    const { verts, idx } = buildGem(g, v0)
    if (v0 + verts.length / 8 > GEM_BATCH_MAX_VERTS) return false // this colour's batch is full (see GEM_BATCH_MAX_VERTS)
    batch.builder.appendVerticesInterleaved(verts)
    batch.builder.appendIndices(idx)
    batch.builder.updateMesh()
    batch.count++
    s.count++
    if (!this.open) this.beginStroke()
    const rec = this.open as StrokeRecord
    let part = rec.parts.find((p) => p.color === g.color)
    if (!part) { part = { color: g.color, verts: 0, idx: 0 }; rec.parts.push(part) }
    part.verts += verts.length / 8
    part.idx += idx.length
    rec.gems++
    return true
  }

  /** Remove the last stroke, exactly. */
  undo(): void {
    const s = this.active
    if (!s || s.strokes.length === 0) return
    const rec = s.strokes.pop() as StrokeRecord
    for (const part of rec.parts) {
      const batch = s.batches[part.color]
      if (!batch) continue
      const nv = batch.builder.getVerticesCount()
      const ni = batch.builder.getIndicesCount()
      batch.builder.eraseIndices(ni - part.idx, ni) // (from, to): the stroke's indices are the last ones
      batch.builder.eraseVertices(nv - part.verts, nv)
      batch.builder.updateMesh()
      batch.count -= part.verts / 180
    }
    s.count -= rec.gems
    if (s.count < 0) s.count = 0
  }

  /** Every stone on this garment. */
  clear(): void {
    const s = this.active
    if (!s) return
    for (const k in s.batches) {
      const b = s.batches[k]
      b.obj.destroy()
    }
    s.batches = {}
    s.strokes = []
    s.count = 0
    this.open = null
  }

  private batchFor(s: GemSet, color: number): Batch {
    let b = s.batches[color]
    if (b) return b
    const obj = global.scene.createSceneObject("Gems_" + gemColorName(color))
    obj.setParent(s.visual)
    obj.getTransform().setLocalPosition(vec3.zero())
    obj.getTransform().setLocalRotation(quat.quatIdentity())
    obj.getTransform().setLocalScale(new vec3(1, 1, 1))
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ])
    builder.topology = MeshTopology.Triangles
    builder.indexType = MeshIndexType.UInt16
    builder.updateMesh()
    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = builder.getMesh()
    const mat = GEM_MAT.clone()
    const pass: any = mat.mainPass
    const c = gemColorRgb(color) // Pass 41: a tone, or a picked colour already through gemTone()
    // The preset ships with its base texture enabled and unset, which multiplies every
    // stone towards black: a 1x1 white makes baseColor the albedo, as the fabric layer does.
    try { pass.baseTex = whiteTexture() } catch (_e) { /* ignore */ }
    try { pass.baseColor = c } catch (_e) { /* ignore */ }
    try { pass.metallic = GEM_METALLIC } catch (_e) { /* ignore */ }
    try { pass.roughness = GEM_ROUGHNESS } catch (_e) { /* ignore */ }
    try { pass.Port_Emissive_N006 = new vec3(c.x * GEM_EMISSIVE_K, c.y * GEM_EMISSIVE_K, c.z * GEM_EMISSIVE_K) } catch (_e) { /* ignore */ }
    visual.clearMaterials()
    visual.addMaterial(mat)
    setLayerDeep(obj, LAYERS.shirt) // in the photograph, lit by the shirt's light
    b = { builder, obj, count: 0 }
    s.batches[color] = b
    return b
  }
}

/**
 * The facets of one stone, as flat-shaded triangles (three fresh vertices each, one
 * normal per face) in the garment visual's local space. Layout: position 3, normal 3,
 * texture0 2 — eight floats a vertex; 60 triangles for a 12-point outline.
 */
function buildGem(g: GemSpec, firstIndex: number): { verts: number[]; idx: number[] } {
  const pts = outline(g.shape)
  const n = pts.length
  const r = g.size / 2
  const h = g.size * GEM_HEIGHT_K
  // Frame: normal is local z; pick a tangent, then turn it by rot about the normal.
  const N = g.normal.normalize()
  let T = Math.abs(N.y) < 0.9 ? new vec3(0, 1, 0).cross(N) : new vec3(1, 0, 0).cross(N)
  T = T.normalize()
  const B = N.cross(T).normalize()
  const c = Math.cos(g.rot)
  const s = Math.sin(g.rot)
  const X = T.uniformScale(c).add(B.uniformScale(s))
  const Y = B.uniformScale(c).sub(T.uniformScale(s))
  const base = g.pos.add(N.uniformScale(g.lift)) // in local units: 0.04 cm here is 12 cm at the shirt's scale if you forget
  const P = (px: number, py: number, pz: number): vec3 => base.add(X.uniformScale(px)).add(Y.uniformScale(py)).add(N.uniformScale(pz))

  const ring = (k: number, z: number): vec3[] => pts.map((p) => P(p.x * r * k, p.y * r * k, z))
  const bottom = ring(1.0, 0)
  const girdle = ring(1.0, h * GEM_GIRDLE_K)
  // Pass 40: the flower's table is a CIRCLE at the same point count — each outline point
  // maps to the circle at its own angle, so the bevel quads still pair up one to one, and
  // a petal's tip has a long bevel down to the centre where a notch has a short one.
  const table = g.shape === "flower"
    ? pts.map((p) => { const a = Math.atan2(p.y, p.x); return P(Math.cos(a) * r * FLOWER_TABLE_K, Math.sin(a) * r * FLOWER_TABLE_K, h) })
    : ring(GEM_TABLE_K, h)
  const centre = P(0, 0, h)

  const verts: number[] = []
  const idx: number[] = []
  let vi = firstIndex
  const tri = (a: vec3, b: vec3, cc: vec3): void => {
    let nn = b.sub(a).cross(cc.sub(a))
    if (nn.length < 1e-12) nn = N; else nn = nn.normalize()
    for (const p of [a, b, cc]) verts.push(p.x, p.y, p.z, nn.x, nn.y, nn.z, 0.5, 0.5)
    idx.push(vi, vi + 1, vi + 2)
    vi += 3
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    // girdle wall
    tri(bottom[i], bottom[j], girdle[j])
    tri(bottom[i], girdle[j], girdle[i])
    // crown bevel
    tri(girdle[i], girdle[j], table[j])
    tri(girdle[i], table[j], table[i])
    // table
    tri(table[i], table[j], centre)
  }
  return { verts, idx }
}
