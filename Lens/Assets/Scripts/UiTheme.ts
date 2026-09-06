// UiTheme — ONE constant decides how the whole interface looks (Pass 24).
//
// UI_STYLE = "glass" is the Refs/ui_inspi treatment: dark glass panels with rounded
// corners and a thin lit rim, violet on whatever is selected, small uppercase captions,
// icon-and-word buttons, a labelled rotation panel and a turntable under the garment.
//
// UI_STYLE = "classic" is the interface exactly as it shipped before this pass. Every
// value that changed is written as pick(classic, glass) beside the constant it replaces,
// so flipping this one word puts every surface, every position and every hit box back —
// there is no second thing to revert.
//
// Behaviour is not in here. Nothing reads UI_STYLE except to choose a shape, a colour, a
// word or a position; the gestures, the calibrations and the garments never see it.

export type UiStyle = "classic" | "glass"

/** THE REVERT CONSTANT. "glass" = the reference look; "classic" = the pre-Pass-24 look. */
export const UI_STYLE: UiStyle = "glass"

export const GLASS = (UI_STYLE as UiStyle) === "glass" // cast: TS narrows the const to its literal, and both spellings must compile

/** The value for the active style. Written beside every constant this pass changed. */
export function pick<T>(classic: T, glass: T): T {
  return GLASS ? glass : classic
}

/**
 * PASS 43 — THE STACK ORDER IS WRITTEN DOWN, NOT LEFT TO THE CAMERA. Every flat control
 * in this interface turns depth off and stacks by draw order, and among blended visuals
 * of EQUAL renderOrder the engine draws back to front by each visual's distance from the
 * camera. Head-on that agrees with the hierarchy; turn the preview camera and a wide body
 * whose centre is d cm to the side of its glyph becomes the nearer of the two once
 * d·sin θ exceeds the glyph's 0.1 cm lift — the 7 cm tool pill past 2 degrees, a 2.8 cm
 * tile past 4, the panel plate over its chips past 14 — and draws OVER the glyph. That is
 * the "selected glyph goes violet, then transparent" of the brief, and why the start
 * view was the only correct one. So every flat part, gradient, image quad and label is
 * given an explicit renderOrder from its place in the hierarchy (uiOrderFor): the stack
 * the code has always meant ("stack by draw order, which is hierarchy order"), written
 * down, so two overlapping visuals never fall back to the distance sort. The base clears
 * UIKit's own plate (0) and knob (2) and the sticker selection frame (10..16).
 */
export const UI_ORDER_BASE = 100
// WHY ONE ORDER PER VISUAL. Creation order is the only rule that holds everywhere: a
// glyph is built after its body, a caption after the card it sits over, the plate before
// everything on it. A bucketed order (hierarchy depth, then sibling index) was tried and
// failed exactly there — the gallery's footer, a shallower subtree built after the cards,
// dropped under them. The cost was measured with the harness's fpsEvery step: 512
// distinct orders, orders in the thousands, and this counter all run at the same 45 fps,
// 21 ms a frame, as one shared order. Distinct render orders are not what the engine
// charges for.
let _uiOrder = UI_ORDER_BASE
/** The next explicit render order: whatever is created next draws on top of what exists. */
export function nextUiOrder(): number {
  return _uiOrder++
}
/** Put a freshly created visual on top of everything created before it. */
export function stackVisual(v: BaseMeshVisual): void {
  try { v.renderOrder = nextUiOrder() } catch (_e) { /* ignore */ }
}

/**
 * PASS 27 — THE SLIDER'S LOST RAINBOW, REPRODUCED AND NAMED. A real SIK hover/drag on a
 * UIKit BackPlate puts it in its hovered state, and from then on the plate is drawn AFTER
 * everything we placed on it at the same render order — the rainbow, the caption, the
 * swatch, the hex all vanish behind a lighter plate while UIKit's own knob, which carries
 * renderOrder 2, stays visible. Nothing is disabled, moved or unbound (see
 * ColorSliderUI.debugDump). So everything custom that sits on a UIKit BackPlate is given
 * an explicit render order above the plate (0). Pass 43: that order is the creation
 * counter above rather than a fixed 1, so the content also stays above our own glass
 * plates; the UIKit Slider is then given a later order of its own so its knob (order + 2)
 * stays above the rainbow — see ColorSliderUI.
 */
export function raiseAbovePlate(root: SceneObject): void {
  const rmvs = root.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
  for (const c of rmvs) stackVisual(c)
  const texts = root.getComponents("Component.Text") as Text[]
  for (const t of texts) stackVisual(t)
  // Pass 43: UIKit's ElementContent draws its icon with an Image (order: its Button + 2),
  // which is neither of the above; it has to climb with the rest or it stays under the plate.
  const images = root.getComponents("Component.Image") as Image[]
  for (const im of images) stackVisual(im)
  for (let i = 0; i < root.getChildrenCount(); i++) raiseAbovePlate(root.getChild(i))
}

/** Captions are small uppercase words in the reference ("COLOUR", "STICKERS"). */
export function caption(word: string): string {
  return GLASS ? word.toUpperCase() : word
}

// --- Pass 33: THE SIDE COLUMNS --------------------------------------------------------------
// Everything in the left column (colour / paint / gem panel, Photo, Gallery) hangs off
// -UI_COL_X; everything in the right column (tray, Import, Text) off +UI_COL_X. Glass pushes
// both out by 1.6 cm so the garment in the middle has room; the paint plane's shadow clamp
// (Stickers.PAINT_SHADOW_LIMIT) is derived from the same number.
export const UI_COL_X = pick(21.0, 22.6)
export const UI_BTN_DX = 0.0 // Pass 34: the stacked buttons sit ON the panel's axis, both sides
export const UI_PANEL_HALF_W = 3.5 // the side panels are 7.0 wide

// --- PASS 45: THE TWO TOP BOXES (Refs/new_ui) -----------------------------------------------
// The tool switch and the garment row leave the top centre for the TOPS OF THE TWO COLUMNS:
// each becomes a rounded box of glyph tiles, flush with its column's OUTER edge and reaching
// inward, the two tops on one line. Measured off the reference at the one scale the two
// images share (the 7 cm colour panel is 145 px there: 20.7 px/cm): boxes 8.0 wide; the
// tool box 5.3 tall with its three tiles in one row at a 2.55 pitch; the garment box 6.3
// tall with its four tiles in two rows, 3.6 across and 2.9 down; tiles 2.3 square. The
// reference draws the boxes about 1.0 cm above the panels' tops; here the garment box's
// bottom is 1.0 above the tray and the tool box's 2.0 above the colour panel, because the
// tops are aligned as in the reference and the tool box is the shorter one. The radius is
// GLASS_R, the same one every panel and plate carries.
export const UI_TOP_BOX_W = 8.0
export const UI_TOP_BOX_TOP_Y = 23.3
// Pass 46: the boxes are CENTRED ON THE COLUMN'S AXIS (UI_COL_X), the axis the panel
// below and the two buttons under it already share (Pass 34) — no longer flush with the
// column's outer edge (that put them at 22.1, half a centimetre inward of the axis).
export const UI_TOP_BOX_X = UI_COL_X // 22.6: the panel's own axis
export const UI_TOOL_BOX_H = 5.3
export const UI_GARMENT_BOX_H = 6.3
export const UI_TOP_TILE = 2.3 // a glyph tile's side
export const UI_TOP_TILE_R = 0.65 // its corner radius

/**
 * Pass 33: hide a UIKit BackPlate's own visuals on `root` (the component draws on the same
 * object and, like the slider, re-enables them on every OnEnable), leaving its collider.
 * Our own content lives on child objects, which are not touched.
 */
export function hidePlateVisuals(root: SceneObject): void {
  try {
    const visuals = root.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
    for (const v of visuals) if (v.enabled) v.enabled = false
  } catch (_e) { /* ignore */ }
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const c = root.getChild(i)
    if (c.name !== "BackPlate" && c.name !== "Visual" && c.name.indexOf("RoundedRect") < 0) continue
    try {
      const visuals = c.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
      for (const v of visuals) if (v.enabled) v.enabled = false
    } catch (_e) { /* ignore */ }
  }
}
