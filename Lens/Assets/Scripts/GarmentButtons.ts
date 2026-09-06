// GarmentButtons — WHICH garment you are customising (Pass 18).
//
// ===========================================================================
// 1. WHERE IT SITS, AND WHY THERE
// ===========================================================================
// Every other control in this composition is a TOOL: it changes something about the
// garment in front of you. The colour slider and the palette are on the left, the sticker
// tray and the import + are on the right, the rotation platform and the photo buttons are
// below. Those three clusters ring the garment, and each of them answers "what do I do to
// this thing".
//
// This control answers a different question — "which thing" — so putting it in any of
// those clusters would file it as a fourth tool, and the first thing a person would try
// is dragging it. It goes ABOVE the garment instead, centred, on the one edge of the
// composition that is empty (the shirt reaches y +15, the slider panel +15, and nothing
// at all is above them). Above and centred is where a title goes, and a title is exactly
// what this is: it names the object the whole rest of the screen is acting on.
//
// It is also drawn as a SEGMENTED CONTROL rather than as two plates — one plate, two
// pills, the active one filled. That is the same object the paint tool switch already
// uses for Colour / Paint, and it is the shape that reads as "these are alternatives,
// exactly one of them is true" instead of "here are two buttons you may press". The
// rotation platform below is deliberately NOT this shape: it is a dark plate with a
// bright knob, because it is a continuous control, not a choice.
//
// ===========================================================================
// 2. THE GLYPHS
// ===========================================================================
// Geometry, like every glyph in this project — the camera, the bin, the rotate arrows and
// the import plus are all flat quads and discs, and so are these. Each garment carries
// its own glyph as DATA in its GarmentDef (see Garments.GlyphPart), drawn in a -1..1
// square and scaled here to whatever the button is. A third garment therefore draws its
// own button by listing rectangles in Garments.ts; this file never learns its name.
//
// A `cut` part is drawn in the pill's CURRENT fill colour over the body, which is how the
// tee gets its neckline and the cap its brim line. That is why every glyph part is kept
// and recoloured when the selection changes rather than being built once and forgotten.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { GarmentDef, GlyphPart } from "./Garments"
import { LAYERS, setLayerDeep } from "./Layers"
import {
  addFlatShape, addGradientShape, setShapeColor, uiDisc, uiQuad, uiRoundRect, addGlassPanel,
  PLATE_COL, RIM_COL, ACCENT_FILL, ACCENT_GLOW, GLASS_R,
} from "./PhotoUi"
import { GLASS, pick, UI_TOP_BOX_X, UI_TOP_BOX_TOP_Y, UI_TOP_BOX_W, UI_GARMENT_BOX_H, UI_TOP_TILE, UI_TOP_TILE_R } from "./UiTheme"

// --- Placement -----------------------------------------------------------------
// Centred over the garment at the composition's constant depth. GB_Y clears the shirt's
// top edge (+15) and the two side panels (+15) with room to breathe, and is close enough
// to the garment to read as belonging to it rather than floating on its own.
// PASS 45 (glass) — Refs/new_ui: the row becomes a rounded BOX at the top of the RIGHT
// column, flush with the column's outer edge (UiTheme's top boxes), its four glyph tiles
// in two rows of two — shirt and cap above, tote and socks below, the order of the
// reference. The selected tile keeps exactly the treatment the selected pill had: the
// accent gradient, the violet halo, the white glyph.
export const GB_X = pick(0, UI_TOP_BOX_X)
export const GB_Y = pick(19.6, UI_TOP_BOX_TOP_Y - UI_GARMENT_BOX_H / 2) // 20.15: the box's centre
export const GB_Z = -110
/** The row's / box's bottom edge, which the sock selector hangs under (SockSelector.SS_Y). */
export const GB_BOTTOM_Y = GB_Y - pick(2.9, UI_GARMENT_BOX_H / 2)
// Pass 45 (glass): the 2 x 2 grid's pitch, from the reference (75 and 60 px at 20.7 px/cm).
const GB_TILE_DX = 3.6
const GB_TILE_DY = 2.9

// --- The plate -----------------------------------------------------------------
// Pass 21: the plate's WIDTH is derived from the pill count, not fixed. Two pills fitted a
// 7.9 half-width; three would have spilled 2.8 cm past each end of it. Deriving it means a
// fourth garment lays out correctly without anyone remembering this constant exists. The
// side margin is what keeps the outermost pill's rounded cap inside the plate's own
// curve — the plate is an ellipse, so its edge falls away faster than a pill's does.
// 0.825 reproduces the two-pill plate Pass 18 shipped (half-width 7.9) exactly, so the
// control looks the same until a third garment actually arrives.
// Pass 25 (glass): the row is the reference's size — 24.5 x 4.4 with 5.6 x 3.6 pills — and
// its grab boxes shrink with the pills (GB_HIT), so the row and the tool switch above it
// read as two groups with clear space between them.
const GB_PLATE_SIDE_PAD = pick(0.825, 0.7) // clear plate past the outermost pill, each side
const GB_PLATE_RY = pick(2.9, 2.2) // plate half-height
const GB_RIM_PAD = 0.3 // the soft lit rim past the plate body, as on the platform

// --- The two pills -------------------------------------------------------------
const GB_PILL_W = pick(6.9, UI_TOP_TILE) // full width of one pill (Pass 45 glass: a square tile)
const GB_PILL_H = pick(4.5, UI_TOP_TILE) // full height
const GB_PILL_GAP = 0.35 // clear space between them
const GB_PILL_CAP_R = GB_PILL_H / 2 // a pill is a quad between two half-round caps
// Grab box — a little past the pill, as everywhere. Its HEIGHT is capped so its bottom
// edge (19.6 - 2.5 = 17.1) stays clear of the paint capture plane's top edge at y 17:
// while paint is the active tool that plane shadows everything behind it, and a garment
// button you cannot press while painting would be a trap.
// Pass 45 (glass): the full grid pitch both ways, 3.6 x 2.9 — as generous as the grid
// allows; neighbours meet at the pitch and never overlap (audit).
const GB_HIT_CLEAR = 0.05 // a hair between neighbouring grab boxes, so they never register as touching (audit)
const GB_HIT = pick(new vec3(7.4, 5.0, 3), new vec3(GB_TILE_DX - GB_HIT_CLEAR, GB_TILE_DY - GB_HIT_CLEAR, 3))

// --- The glyph -----------------------------------------------------------------
// The -1..1 glyph frame maps to +/- GB_GLYPH_R centimetres inside the pill.
// Pass 45 (glass): 0.75 in a 2.3 tile — the reference's glyph is ~30 px in a 48 px tile.
const GB_GLYPH_R = pick(1.42, 0.75)
const GB_GLYPH_Z = 0.2

// --- Colours -------------------------------------------------------------------
// The selected pill is the paint switch's ON pill exactly: a near-white fill with a dark
// slate glyph. The unselected one is the plate showing through, with the glyph in the
// same soft white every other glyph on a dark plate uses. Reading as selected is
// therefore a genuine figure/ground inversion, not a brightness difference — which is
// what survives being looked at on a phone in daylight.
// Pass 24 (glass): the selected pill is the reference's violet with a white glyph, and an
// unselected pill has no body at all — its glyph sits straight on the plate.
// The glass body is the accent GRADIENT texture (PhotoUi.addGradientShape), so its "fill"
// is a white tint to show it and a clear one to hide it; the cut-outs, being flat, take
// the gradient's midpoint colour instead (GB_ON_CUT) and disappear into it.
const GB_ON_FILL = pick(new vec4(0.86, 0.92, 1.0, 0.96), new vec4(1, 1, 1, 1))
const GB_ON_CUT = pick(new vec4(0.86, 0.92, 1.0, 0.96), ACCENT_FILL)
const GB_ON_GLYPH = pick(new vec4(0.10, 0.13, 0.18, 1.0), new vec4(0.98, 0.98, 1.0, 1.0))
const GB_OFF_FILL = pick(new vec4(0.14, 0.16, 0.21, 0.9), new vec4(0, 0, 0, 0))
const GB_OFF_GLYPH = new vec4(0.92, 0.95, 1.0, 0.82)
const GB_PILL_R = pick(1.3, UI_TOP_TILE_R) // glass pill corner radius (Pass 45: the tile's)

/** One garment's pill: the parts that have to be recoloured when selection moves. */
interface Pill {
  root: SceneObject
  /** Body + the two caps — everything that carries the fill colour. */
  fills: SceneObject[]
  /** Glyph parts drawn in the glyph colour. */
  glyphs: SceneObject[]
  /** Glyph parts drawn in the FILL colour, i.e. the cut-outs. */
  cuts: SceneObject[]
  interactable: Interactable
}

export class GarmentButtons {
  private root!: SceneObject
  private pills: Pill[] = []
  private selected = 0
  private onPick: (index: number) => void

  /**
   * @param parent  the main root (unscaled world centimetres)
   * @param defs    every garment, in the order their buttons appear
   * @param initial which one is active at boot
   * @param onPick  a button was pressed; the caller performs the swap and calls back
   *                through setSelected, so this control never assumes it won
   */
  constructor(
    parent: SceneObject,
    defs: GarmentDef[],
    initial: number,
    onPick: (index: number) => void
  ) {
    this.onPick = onPick
    this.selected = initial
    this.build(parent, defs)
  }

  /** Bind the SIK subscriptions. Called from OnStartEvent, where they must live. */
  init(): void {
    for (let i = 0; i < this.pills.length; i++) {
      const idx = i
      this.pills[i].interactable.onTriggerEnd.add(() => this.onPick(idx))
    }
    this.applySelection()
  }

  /** Which button reads as selected. Driven by the caller AFTER the swap has happened. */
  setSelected(i: number): void {
    if (i < 0 || i >= this.pills.length) return
    this.selected = i
    this.applySelection()
  }

  getSceneObject(): SceneObject {
    return this.root
  }

  /** Verification entry point: the same call a press makes. */
  debugPick(i: number): void {
    if (i >= 0 && i < this.pills.length) this.onPick(i)
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private build(parent: SceneObject, defs: GarmentDef[]): void {
    this.root = global.scene.createSceneObject("GarmentButtons")
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(GB_X, GB_Y, GB_Z))

    const disc = uiDisc()
    const quad = uiQuad()

    // The plate, and its soft rim behind it — the platform's own two shapes. Wide enough
    // for however many pills there are (see GB_PLATE_SIDE_PAD).
    const rowW = defs.length * GB_PILL_W + (defs.length - 1) * GB_PILL_GAP
    const plateRx = rowW / 2 + GB_PLATE_SIDE_PAD
    if (GLASS) {
      // Pass 45: the top box — the family's glass panel at the family's radius, two rows
      // of two tiles inside it (a fifth garment would start a third row).
      addGlassPanel(this.root, new vec3(0, 0, 0), UI_TOP_BOX_W, UI_GARMENT_BOX_H, GLASS_R)
      const rows = Math.ceil(defs.length / 2)
      for (let i = 0; i < defs.length; i++) {
        const col = i % 2
        const row = Math.floor(i / 2)
        const x = (col - 0.5) * GB_TILE_DX
        const y = ((rows - 1) / 2 - row) * GB_TILE_DY
        this.pills.push(this.makePill(defs[i], x, y, disc, quad))
      }
    } else {
      addFlatShape(this.root, disc, new vec3(0, 0, -0.1),
        new vec3(plateRx + GB_RIM_PAD, GB_PLATE_RY + GB_RIM_PAD, 1), RIM_COL)
      addFlatShape(this.root, disc, new vec3(0, 0, 0),
        new vec3(plateRx, GB_PLATE_RY, 1), PLATE_COL)
      // Pills laid out from the centre outwards, so the row is centred whatever the count.
      const x0 = -((defs.length - 1) / 2) * (GB_PILL_W + GB_PILL_GAP)
      for (let i = 0; i < defs.length; i++) {
        this.pills.push(this.makePill(defs[i], x0 + i * (GB_PILL_W + GB_PILL_GAP), 0, disc, quad))
      }
    }

    setLayerDeep(this.root, LAYERS.ui) // chrome: on screen, never in a photograph
  }

  private makePill(def: GarmentDef, x: number, y: number, disc: RenderMesh, quad: RenderMesh): Pill {
    const root = global.scene.createSceneObject("GarmentButton_" + def.id)
    root.setParent(this.root)
    root.getTransform().setLocalPosition(new vec3(x, y, 0.15))

    const fills: SceneObject[] = []
    if (GLASS) {
      // Pass 24: a rounded rectangle, with a soft violet glow behind it that only shows
      // when the pill is selected (both are recoloured together in applySelection).
      fills.push(addFlatShape(root, uiRoundRect(GB_PILL_W + 0.5, GB_PILL_H + 0.5, GB_PILL_R + 0.25),
        new vec3(0, 0, -0.05), new vec3(1, 1, 1), new vec4(ACCENT_GLOW.x, ACCENT_GLOW.y, ACCENT_GLOW.z, 0)))
      fills.push(addGradientShape(root, uiRoundRect(GB_PILL_W, GB_PILL_H, GB_PILL_R),
        new vec3(0, 0, 0), new vec3(1, 1, 1), GB_OFF_FILL))
    } else {
      // A rounded pill: one quad between two half-round caps, so the corner radius is the
      // pill's own half-height and no rounded-rect mesh builder is needed.
      fills.push(addFlatShape(root, quad, new vec3(0, 0, 0),
        new vec3(GB_PILL_W - GB_PILL_H, GB_PILL_H, 1), GB_OFF_FILL))
      fills.push(addFlatShape(root, disc, new vec3(-(GB_PILL_W - GB_PILL_H) / 2, 0, 0),
        new vec3(GB_PILL_CAP_R, GB_PILL_CAP_R, 1), GB_OFF_FILL))
      fills.push(addFlatShape(root, disc, new vec3((GB_PILL_W - GB_PILL_H) / 2, 0, 0),
        new vec3(GB_PILL_CAP_R, GB_PILL_CAP_R, 1), GB_OFF_FILL))
    }

    // The glyph, from the garment's own definition. Body parts first, then the cut-outs,
    // because a cut subtracts by being drawn over what it cuts — see the header.
    const glyphs: SceneObject[] = []
    const cuts: SceneObject[] = []
    const draw = (g: GlyphPart, into: SceneObject[], col: vec4): void => {
      const mesh = g.shape === "disc" ? disc : quad
      // A disc's scale is a RADIUS and a quad's is a full side, so a glyph part's w/h —
      // which is a full width and height in the -1..1 frame either way — is halved for
      // the disc. Without this the two shapes would not agree on what "0.5 wide" means.
      const k = g.shape === "disc" ? 0.5 : 1.0
      into.push(addFlatShape(root, mesh,
        new vec3(g.x * GB_GLYPH_R, g.y * GB_GLYPH_R, GB_GLYPH_Z),
        new vec3(g.w * GB_GLYPH_R * k, g.h * GB_GLYPH_R * k, 1),
        col, ((g.rot ? g.rot : 0) * Math.PI) / 180))
    }
    for (const g of def.glyph) if (!g.cut) draw(g, glyphs, GB_OFF_GLYPH)
    for (const g of def.glyph) if (g.cut) draw(g, cuts, GB_OFF_FILL)

    // The grab box, deliberately larger than the pill — shrink what is looked at, not
    // what is pressed, exactly as the photo and import plates do.
    const hit = global.scene.createSceneObject("GarmentButtonHit_" + def.id)
    hit.setParent(root)
    hit.getTransform().setLocalPosition(new vec3(0, 0, 0.4))
    const collider = hit.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = GB_HIT
    collider.shape = shape
    collider.fitVisual = false
    const interactable = hit.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = 3 // Direct + Indirect, so mouse and hand both reach it

    return { root, fills, glyphs, cuts, interactable }
  }

  private applySelection(): void {
    for (let i = 0; i < this.pills.length; i++) {
      const on = i === this.selected
      const fill = on ? GB_ON_FILL : GB_OFF_FILL
      const glyph = on ? GB_ON_GLYPH : GB_OFF_GLYPH
      const p = this.pills[i]
      for (let k = 0; k < p.fills.length; k++) {
        // In glass the first fill is the glow halo: violet when on, invisible when off.
        const halo = GLASS && k === 0
        setShapeColor(p.fills[k], halo ? (on ? ACCENT_GLOW : new vec4(0, 0, 0, 0)) : fill)
      }
      for (const o of p.glyphs) setShapeColor(o, glyph)
      // The cut-outs are the fill showing through, so they follow the fill and the
      // neckline stays a neckline in both states. In glass an OFF pill has no body, so a
      // cut-out has to be the PLATE colour to keep subtracting.
      for (const o of p.cuts) setShapeColor(o, on ? GB_ON_CUT : (GLASS ? PLATE_COL : fill))
    }
  }
}
