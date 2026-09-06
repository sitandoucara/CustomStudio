// PhotoUi — the shared language of the photo surfaces, in one place (Pass 13).
//
// WHY THIS FILE EXISTS. Pass 12 had exactly one photo surface — the single-photo
// review — so its palette, its 1x1 white texture and its flat-shape builder all lived
// as private detail inside PhotoBooth. Pass 13 adds a SECOND surface (the gallery
// carousel) and a SECOND button (the gallery button) that must read as the same
// object family as the first. Anything both of them look at is here, so "the same" is
// a shared constant rather than a copied number.
//
// It also breaks a would-be import cycle: PhotoBooth owns the gallery and so imports
// PhotoGallery, therefore PhotoGallery cannot import PhotoBooth. Both import this.
//
// The palette is still, deliberately, the RotationPlatform's own values — the shutter
// and the gallery button are two more controls on the same plate language, and reading
// them off the same numbers is what keeps them from drifting into a second style.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { buildUnitQuad } from "./StickerCompositor"
import { buildDisc, buildRing, buildRoundedRect, buildRoundedRectRing, buildTriangle } from "./Geo"
import { LAYERS, setLayerDeep } from "./Layers"
import { GLASS, pick, nextUiOrder, stackVisual } from "./UiTheme"
export { nextUiOrder, stackVisual } from "./UiTheme" // Pass 43: the stack-order counter lives in UiTheme

export const MOTE_MAT = requireAsset("../Materials/MoteMaterial.mat") as Material // unlit, base-tex OFF -> solid baseColor
export const QUAD_MAT = requireAsset("../StickerQuadMat.mat") as Material // unlit ImageMaterial (textured)

// --- The frame format ---------------------------------------------------------
// A 7:8 portrait frame: taller than wide, the way a garment is photographed. Shared
// because the gallery mounts prints of whatever the capture produces, and the two
// must not be able to disagree.
export const PHOTO_RT_W = 896
export const PHOTO_RT_H = 1024
export const PHOTO_ASPECT = PHOTO_RT_W / PHOTO_RT_H

// --- Palette ------------------------------------------------------------------
// Pass 24: the glass plate is a shade lighter and a touch more opaque than the classic
// one, and its rim is a thin, brighter line — the reference's panels are drawn with a
// hairline of light along their edge rather than a soft halo.
export const PLATE_COL = pick(new vec4(0.055, 0.06, 0.08, 0.88), new vec4(0.075, 0.075, 0.105, 0.86)) // control plate body
export const RIM_COL = pick(new vec4(0.72, 0.79, 0.9, 0.2), new vec4(0.82, 0.84, 0.97, 0.34)) // lit rim past the plate
/** Pass 24 — the reference's violet: on whatever is selected or grabbable. */
export const ACCENT_VIOLET = new vec4(0.66, 0.45, 0.98, 1.0)
export const ACCENT_FILL = new vec4(0.47, 0.30, 0.82, 0.96) // a selected pill's body
export const ACCENT_GLOW = new vec4(0.62, 0.42, 0.98, 0.32) // the soft halo around it
export const GLASS_ON_FILL = new vec4(0.20, 0.20, 0.28, 0.96) // a selected tool pill (lighter glass)
/**
 * PASS 38 — THE ONE TILE BACKING, shared by all three panels.
 *
 * A tile that holds a choice — a font in the text panel, a shape in the gems panel, a
 * sticker in the tray — is a soft flat translucent rounded rectangle and nothing else: no
 * recess, no rim thickness, no drop shadow. Pass 35 went the other way and gave the gem
 * tiles the UIKit sticker tile's raised three-layer treatment; this is the reversal, and
 * it is one constant so the three panels cannot drift apart again. The text panel's
 * inactive font button is where the value comes from — it is the one that was already right.
 */
export const PANEL_TILE_FILL = new vec4(0.16, 0.16, 0.22, 0.95)
// The reference's selected pill and its "Importer" button are a violet-to-pink gradient.
// A flat shape here is one colour, so the gradient is a small texture (uiGradientTexture)
// on the same rounded rectangle, left to right; ACCENT_FILL is its midpoint, which is
// what any flat part drawn over it (a glyph cut-out) uses to disappear into it.
export const ACCENT_GRAD_A = new vec4(0.44, 0.27, 0.86, 0.96) // left: violet
export const ACCENT_GRAD_B = new vec4(0.70, 0.36, 0.78, 0.96) // right: towards the reference's pink
const GRAD_W = 64
/** How far the rim shows past a glass panel's body. */
export const GLASS_RIM = 0.16
/** Corner radius of a glass panel. */
export const GLASS_R = 2.2
export const GLYPH_COL = new vec4(0.92, 0.95, 1.0, 0.95) // glyph drawn on a plate
export const LABEL_COL = new vec4(1, 1, 1, 0.85) // primary caption
export const LABEL_DIM_COL = new vec4(1, 1, 1, 0.5) // secondary caption (counters, hints)
export const CHIP_FILL = new vec4(0.98, 0.99, 1.0, 0.97) // white action chip
export const CHIP_GLYPH = new vec4(0.16, 0.2, 0.26, 1.0) // dark slate glyph on a chip
export const CHIP_EDGE = pick(new vec4(0.36, 0.72, 0.93, 1.0), ACCENT_VIOLET) // the selection frame's accent: blue in classic, violet in glass
// The one new colour in the family: a chip whose action REMOVES something. Same white
// chip, same dark glyph — only the accent ring changes, so "this is destructive" is a
// one-property difference rather than a second chip design.
export const CHIP_DANGER = new vec4(0.94, 0.44, 0.42, 1.0)
export const PRINT_COL = new vec4(0.97, 0.98, 1.0, 1.0) // the white margin a photo is mounted on

// --- The round control plate (Pass 16) ----------------------------------------
// The photo button, the gallery button and the import + are one object with three
// different glyphs on it, so its dimensions live here rather than in whichever file
// happened to draw one first. A circle, deliberately small, with a hit box more than
// twice its width — shrink what is looked at, not what is pressed.
export const PLATE_R = 2.5
export const PLATE_RIM_PAD = 0.3
export const PLATE_HIT = new vec3(10.4, 6.2, 3)
/** Glyphs were drawn for the older, wider plate; this scales them as a group. */
export const PLATE_GLYPH_SCALE = 0.78

// --- Shared meshes ------------------------------------------------------------
// Built once on first use and handed out, rather than rebuilt per surface: the review,
// the carousel and both buttons draw the same unit quad and the same unit disc.
const DISC_SEGMENTS = 56

let _quad: RenderMesh | null = null
let _disc: RenderMesh | null = null

export function uiQuad(): RenderMesh {
  if (!_quad) _quad = buildUnitQuad()
  return _quad
}

export function uiDisc(): RenderMesh {
  if (!_disc) _disc = buildDisc(DISC_SEGMENTS)
  return _disc
}

// --- Pass 30: the turntable, shared ------------------------------------------------------
// The oval plate every garment stands on. RotationPlatform draws it under the composition;
// the gallery and the photo view draw the SAME plate at the SAME place on their own layer,
// so the two surfaces read as the same room rather than a separate screen.
export const TABLE_WORLD_Y = -15.3
export const TABLE_WORLD_Z = -126
export const TABLE_RX = 17.5
export const TABLE_RY = 2.7
export const TABLE_RIM = 0.45
export const TABLE_COL = new vec4(0.09, 0.09, 0.12, 0.92)
export const TABLE_RIM_COL = new vec4(0.80, 0.78, 0.98, 0.55)
export const TABLE_GLOW_COL = new vec4(0.62, 0.42, 0.98, 0.22)

/** The turntable's three ellipses at `center` (world), depth-tested so garments stand on it. */
export function addTurntable(parent: SceneObject, center: vec3, depthSorted: boolean = true): void {
  const disc = uiDisc()
  const at = (dz: number): vec3 => new vec3(center.x, center.y, center.z + dz)
  addFlatShape(parent, disc, at(-0.2), new vec3(TABLE_RX + 2.2, TABLE_RY + 1.0, 1), TABLE_GLOW_COL, 0, depthSorted)
  addFlatShape(parent, disc, at(-0.1), new vec3(TABLE_RX + TABLE_RIM, TABLE_RY + TABLE_RIM * 0.6, 1), TABLE_RIM_COL, 0, depthSorted)
  addFlatShape(parent, disc, at(0), new vec3(TABLE_RX, TABLE_RY, 1), TABLE_COL, 0, depthSorted)
}

// --- Pass 30: the surfaces' title block and Back pill (Refs/ui_galery, ui_photo) ----------
export const TITLE_SIZE = 96
export const TITLE_UNDERLINE = new vec2(3.6, 0.18)
export const TITLE_UNDERLINE_DY = -2.5
export const SUBTITLE_SIZE = 44
export const SUBTITLE_DY = -4.6
export const BACK_PILL_W = 9.0
export const BACK_PILL_H = 3.2
export const BACK_PILL_R = 1.6
export const BACK_PILL_HIT = new vec3(9.6, 3.8, 3)
export const BACK_CHEVRON_X = -2.7
export const BACK_WORD_X = 0.7
export const BACK_WORD_SIZE = 40
export const CAL_SIZE = 1.1 // the small calendar glyph before a date

/** "Gallery" / "Photo": the word, a short violet underline, and a dim subtitle. */
export function addTitle(parent: SceneObject, pos: vec3, word: string, subtitle: string, depthSorted: boolean = true): void {
  addLabel(parent, pos, word, TITLE_SIZE, LABEL_COL, HorizontalAlignment.Center, depthSorted)
  addFlatShape(parent, uiRoundRect(TITLE_UNDERLINE.x, TITLE_UNDERLINE.y, TITLE_UNDERLINE.y / 2),
    new vec3(pos.x, pos.y + TITLE_UNDERLINE_DY, pos.z), new vec3(1, 1, 1), ACCENT_VIOLET, 0, depthSorted)
  addLabel(parent, new vec3(pos.x, pos.y + SUBTITLE_DY, pos.z), subtitle, SUBTITLE_SIZE, LABEL_DIM_COL, HorizontalAlignment.Center, depthSorted)
}

/** The Back pill: glass, a chevron and the word. The caller binds its Interactable. */
export function addBackPill(parent: SceneObject, pos: vec3, depthSorted: boolean = true): SceneObject {
  const pill = global.scene.createSceneObject("BackPill")
  pill.setParent(parent)
  pill.getTransform().setLocalPosition(pos)
  addFlatShape(pill, uiRoundRect(BACK_PILL_W + 2 * GLASS_RIM, BACK_PILL_H + 2 * GLASS_RIM, BACK_PILL_R + GLASS_RIM),
    new vec3(0, 0, -0.1), new vec3(1, 1, 1), RIM_COL, 0, depthSorted)
  addFlatShape(pill, uiRoundRect(BACK_PILL_W, BACK_PILL_H, BACK_PILL_R), vec3.zero(), new vec3(1, 1, 1), PLATE_COL, 0, depthSorted)
  // chevron: two short bars
  addFlatShape(pill, uiQuad(), new vec3(BACK_CHEVRON_X + 0.25, 0.32, 0.2), new vec3(1.0, 0.16, 1), LABEL_COL, Math.PI / 4, depthSorted)
  addFlatShape(pill, uiQuad(), new vec3(BACK_CHEVRON_X + 0.25, -0.32, 0.2), new vec3(1.0, 0.16, 1), LABEL_COL, -Math.PI / 4, depthSorted)
  addLabel(pill, new vec3(BACK_WORD_X, 0, 0.2), "Back", BACK_WORD_SIZE, LABEL_COL, HorizontalAlignment.Center, depthSorted)
  const collider = pill.createComponent("Physics.ColliderComponent") as ColliderComponent
  const shape = Shape.createBoxShape()
  shape.size = BACK_PILL_HIT
  collider.shape = shape
  collider.fitVisual = false
  const inter = pill.createComponent(Interactable.getTypeName()) as Interactable
  inter.targetingMode = 3
  return pill
}

/** A small calendar glyph, left of a date. */
export function addCalendarGlyph(parent: SceneObject, pos: vec3, depthSorted: boolean = true): void {
  const s = CAL_SIZE
  addFlatShape(parent, uiRoundRect(s, s, 0.18), pos, new vec3(1, 1, 1), LABEL_DIM_COL, 0, depthSorted)
  addFlatShape(parent, uiQuad(), new vec3(pos.x, pos.y + s * 0.28, pos.z + 0.05), new vec3(s * 0.8, s * 0.12, 1), PLATE_COL, 0, depthSorted)
  addFlatShape(parent, uiQuad(), new vec3(pos.x - s * 0.18, pos.y - s * 0.1, pos.z + 0.05), new vec3(s * 0.16, s * 0.16, 1), PLATE_COL, 0, depthSorted)
  addFlatShape(parent, uiQuad(), new vec3(pos.x + s * 0.18, pos.y - s * 0.1, pos.z + 0.05), new vec3(s * 0.16, s * 0.16, 1), PLATE_COL, 0, depthSorted)
}

/** Pass 30: a rounded-rect ring in cm, cached. */
const _rings: { [key: string]: RenderMesh } = {}
export function uiRoundRing(w: number, h: number, r: number, t: number): RenderMesh {
  const key = w.toFixed(3) + "x" + h.toFixed(3) + "r" + r.toFixed(3) + "t" + t.toFixed(3)
  if (!_rings[key]) _rings[key] = buildRoundedRectRing(w, h, r, t, 10)
  return _rings[key]
}

/** Pass 24: a rounded rectangle in cm (scale 1). Cached by its dimensions. */
const _rects: { [key: string]: RenderMesh } = {}
export function uiRoundRect(w: number, h: number, r: number): RenderMesh {
  const key = w.toFixed(3) + "x" + h.toFixed(3) + "r" + r.toFixed(3)
  if (!_rects[key]) _rects[key] = buildRoundedRect(w, h, r, 10)
  return _rects[key]
}

/**
 * Pass 24: one glass panel — a lit rim behind a dark body, both rounded rectangles.
 * Returns the body so it can be recoloured (a selected pill is the same panel filled).
 */
export function addGlassPanel(
  parent: SceneObject,
  pos: vec3,
  w: number,
  h: number,
  r: number,
  fill: vec4 = PLATE_COL,
  rim: vec4 = RIM_COL,
  rimPad: number = GLASS_RIM,
  depthSorted: boolean = false
): SceneObject {
  addFlatShape(parent, uiRoundRect(w + 2 * rimPad, h + 2 * rimPad, r + rimPad),
    new vec3(pos.x, pos.y, pos.z - 0.1), new vec3(1, 1, 1), rim, 0, depthSorted)
  return addFlatShape(parent, uiRoundRect(w, h, r), pos, new vec3(1, 1, 1), fill, 0, depthSorted)
}

// --- The 1x1 white texture ----------------------------------------------------
let _white: Texture | null = null

/**
 * A 1x1 opaque white texture, made once.
 *
 * The ImageMaterial multiplies baseTex by baseColor, so a white pixel makes baseColor
 * the material's flat albedo — the same trick the compositor's fabric quad uses with
 * the shirt's own 1x1 white base map. Built rather than borrowed so nothing here
 * depends on the garment's asset.
 */
export function whiteTexture(): Texture {
  if (!_white) {
    _white = ProceduralTextureProvider.createWithFormat(1, 1, TextureFormat.RGBA8Unorm)
    const ctrl = _white.control as ProceduralTextureProvider
    ctrl.setPixels(0, 0, 1, 1, new Uint8Array([255, 255, 255, 255]))
  }
  return _white
}

/** Pass 24: the accent gradient, ACCENT_GRAD_A on the left to ACCENT_GRAD_B on the right. */
let _grad: Texture | null = null
export function uiGradientTexture(): Texture {
  if (!_grad) {
    _grad = ProceduralTextureProvider.createWithFormat(GRAD_W, 2, TextureFormat.RGBA8Unorm)
    const ctrl = _grad.control as ProceduralTextureProvider
    const data = new Uint8Array(GRAD_W * 2 * 4)
    for (let x = 0; x < GRAD_W; x++) {
      const t = x / (GRAD_W - 1)
      const c = [
        ACCENT_GRAD_A.x + (ACCENT_GRAD_B.x - ACCENT_GRAD_A.x) * t,
        ACCENT_GRAD_A.y + (ACCENT_GRAD_B.y - ACCENT_GRAD_A.y) * t,
        ACCENT_GRAD_A.z + (ACCENT_GRAD_B.z - ACCENT_GRAD_A.z) * t,
      ]
      for (let y = 0; y < 2; y++) {
        const i = (y * GRAD_W + x) * 4
        data[i] = Math.round(c[0] * 255)
        data[i + 1] = Math.round(c[1] * 255)
        data[i + 2] = Math.round(c[2] * 255)
        data[i + 3] = 255
      }
    }
    ctrl.setPixels(0, 0, GRAD_W, 2, data)
  }
  return _grad
}

// --- PASS 43 — HOW A CONTROL STAYS OPAQUE TO WHATEVER IS BEHIND IT ------------------
// THE MEASUREMENT. The viewport's render target was encoded and read back (harness step
// `dumpView`): a LABEL_COL glyph (alpha 0.85) on a PANEL_TILE_FILL tile (0.95) on the
// glass plate (0.86) lands in the target as rgb 224 with ALPHA 220/255 = 0.86; the tile
// around it 240 = 0.94; the plate 193 = 0.76; the rim 29 = 0.11. The Preview then
// composites that target over the environment as straight alpha, out = rgb·a + env·(1−a)
// (a black 1.0 patch reads black over a lit wall, a white 0.5 patch reads mid-grey, so it
// is neither additive nor premultiplied). So 14% of whatever is behind the panel comes
// through EVERY glyph — more than comes through the tile it sits on (6%) — and a white
// glyph reads 193 + 0.137·env: light grey over the night sky, white over a lit wall, and
// the selected tile's violet (alpha 0.96) reads 0.05·env brighter wherever the wall is.
//
// THE CAUSE. BlendMode.Normal blends the ALPHA channel with the same SrcAlpha /
// OneMinusSrcAlpha factors as the colour, so a translucent layer drawn on an opaque one
// REPLACES the accumulated opacity with a² + a_below·(1−a) instead of adding to it.
// Every flat control in this interface is a translucent layer on another translucent
// layer, so the stack never becomes opaque, and the environment shows through in
// proportion to 1 − a² of the TOP layer, whatever is underneath.
//
// THE FIX, in one place. Every flat control, every recolour and every label goes out with
// PremultipliedAlpha blending (One, OneMinusSrcAlpha) and its colour premultiplied by
// its own alpha. The colour result is identical to Normal blending — rgb·a + below·(1−a)
// — so nothing about the design changes; only the alpha now accumulates as it should,
// a + a_below·(1−a): the same glyph measures 254/255, the tile 251, the plate 232. What
// the panels were designed to look like over black is now what they look like over
// anything. UI_STACK_OPAQUE = false is the revert, and UI_STYLE is untouched by it.
export const UI_STACK_OPAQUE = true
export const UI_BLEND: BlendMode = UI_STACK_OPAQUE ? BlendMode.PremultipliedAlpha : BlendMode.Normal
/** The colour a flat pass or a text fill is handed under UI_BLEND: premultiplied by its alpha. */
export function uiColor(c: vec4): vec4 {
  return UI_STACK_OPAQUE ? new vec4(c.x * c.w, c.y * c.w, c.z * c.w, c.w) : c
}
/** Set a pass's baseColor the way every flat control does (see UI_STACK_OPAQUE). */
export function setPassColor(pass: any, c: vec4): void {
  try { pass.baseColor = uiColor(c) } catch (_e) { /* ignore */ }
}
/** The one configuration of a flat, unlit control pass: colour, blend, sidedness, depth. */
export function uiFlatPass(pass: any, color: vec4, depthSorted: boolean = false): void {
  setPassColor(pass, color)
  try { pass.blendMode = UI_BLEND } catch (_e) { /* ignore */ }
  try { pass.twoSided = true } catch (_e) { /* ignore */ }
  try { pass.depthTest = depthSorted } catch (_e) { /* ignore */ }
  try { pass.depthWrite = depthSorted } catch (_e) { /* ignore */ }
}
/** Colour a Text the way every caption and word is coloured (see UI_STACK_OPAQUE). */
export function setTextColor(t: Text, c: vec4): void {
  try { t.blendMode = UI_BLEND } catch (_e) { /* ignore */ }
  t.textFill.color = uiColor(c)
}

// --- PASS 43 — THE STACK ORDER IS WRITTEN DOWN, NOT LEFT TO THE CAMERA ----------------
// THE SECOND DEFECT, seen by turning the preview camera 12 degrees with the fix above in
// place and again with it off: the SELECTED tool pill's glyph and word, the selected
// garment button's glyph and, further round, the gem tiles' glyphs go faint or take the
// colour of the body under them, while the unselected ones (whose bodies are transparent)
// hold. Every flat control turns depth off and relies on draw order to stack a glyph on
// its body, and among blended visuals of EQUAL renderOrder the engine draws back to
// front by each visual's distance from the camera. Head-on, a glyph 0.1 cm in front of
// its body is the nearer of the two and draws last. Turn the camera by θ and a body
// whose centre is d cm to the side of the glyph's is nearer by d·sin θ − 0.1·cos θ: the
// 7 cm tool pill (its caps 2.9 cm off the glyph) draws OVER its glyph beyond 2 degrees,
// the 2.8 cm gem tile beyond 4 for a glyph 0.1 in front of an off-centre tile, the
// panel plate over its chips beyond 14. The design was only ever correct at the start
// view because the start view is the one place the distances agree with the hierarchy.
//
// THE FIX, in one place. Every flat part, gradient, image quad and label is given an
// explicit renderOrder as it is created — UiTheme.nextUiOrder(), a counter that increases
// in creation order, which is the order the code has always stacked things in ("stack by
// draw order, which is hierarchy order"). Two visuals with different renderOrder never
// fall back to the distance sort, so the stack is the same from every angle. Content on a
// UIKit plate goes through UiTheme.raiseAbovePlate, which now uses the same counter; the
// selection frame keeps its own FRAME_ORDER_* stack (below UI_ORDER_BASE), and the
// sticker-bake cameras are unaffected (camera renderOrder is a different property).

/**
 * Pass 24: a flat shape carrying the accent gradient instead of one colour. `tint`
 * multiplies it, so setShapeColor(obj, white) shows it and a zero-alpha tint hides it —
 * the same recolour call the flat shapes answer to.
 */
export function addGradientShape(
  parent: SceneObject,
  mesh: RenderMesh,
  pos: vec3,
  scale: vec3,
  tint: vec4 = new vec4(1, 1, 1, 1)
): SceneObject {
  const obj = global.scene.createSceneObject("PhotoPart")
  obj.setParent(parent)
  obj.getTransform().setLocalPosition(pos)
  obj.getTransform().setLocalScale(scale)
  const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  visual.mesh = mesh
  stackVisual(visual) // Pass 43
  const mat = QUAD_MAT.clone()
  const pass: any = mat.mainPass
  try { pass.baseTex = uiGradientTexture() } catch (_e) { /* ignore */ }
  uiFlatPass(pass, tint, false) // Pass 43
  visual.clearMaterials()
  visual.addMaterial(mat)
  return obj
}

/**
 * One flat, unlit shape. `rotZ` spins it in its own plane.
 *
 * `depthSorted` picks how it stacks against its neighbours. The buttons, like every
 * other control in this project, turn depth OFF and stack by draw order, which is
 * hierarchy order. The photo surfaces turn it ON: their parts are laid out a few tenths
 * of a centimetre apart on purpose (blocker, print, image, chip), and while one is up
 * the viewport renders that layer and nothing else, so a real depth test orders them
 * without depending on the order they happen to have been built in.
 */
export function addFlatShape(
  parent: SceneObject,
  mesh: RenderMesh,
  pos: vec3,
  scale: vec3,
  color: vec4,
  rotZ: number = 0,
  depthSorted: boolean = false
): SceneObject {
  const obj = global.scene.createSceneObject("PhotoPart")
  obj.setParent(parent)
  const tf = obj.getTransform()
  tf.setLocalPosition(pos)
  tf.setLocalScale(scale)
  if (rotZ !== 0) tf.setLocalRotation(quat.angleAxis(rotZ, new vec3(0, 0, 1)))

  const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  visual.mesh = mesh
  stackVisual(visual) // Pass 43
  const mat = MOTE_MAT.clone() // base-tex OFF -> renders solid baseColor
  uiFlatPass(mat.mainPass, color, depthSorted) // Pass 43: one configuration for every flat control
  visual.clearMaterials()
  visual.addMaterial(mat)
  return obj
}

/** Recolour a shape made by addFlatShape. Used by the carousel to fade its neighbours. */
export function setShapeColor(obj: SceneObject, color: vec4): void {
  const visual = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null
  if (!visual || visual.getMaterialsCount() === 0) return
  setPassColor(visual.getMaterial(0).mainPass, color)
}

/** One line of type. `align` is a HorizontalAlignment; the anchor is the object's own origin. */
export function addLabel(
  parent: SceneObject,
  pos: vec3,
  text: string,
  size: number,
  color: vec4,
  align: HorizontalAlignment = HorizontalAlignment.Center,
  depthSorted: boolean = false
): Text {
  const obj = global.scene.createSceneObject("PhotoLabel")
  obj.setParent(parent)
  obj.getTransform().setLocalPosition(pos)
  const t = obj.createComponent("Component.Text") as Text
  stackVisual(t) // Pass 43
  t.text = text
  t.depthTest = depthSorted
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.horizontalAlignment = align
  t.verticalAlignment = VerticalAlignment.Center
  t.size = size
  setTextColor(t, color) // Pass 43
  return t
}


// Pass 24 (glass): the icon buttons are wide rounded rectangles carrying a glyph on the
// left and a word on the right, as in the reference ("Photo", "Galerie", "Importer").
// THE HIT BOX DOES NOT CHANGE: WIDE_BTN_HIT is PLATE_HIT, the 10.4 x 6.2 box the round
// plate always had, and the button is drawn inside it — so the three buttons keep their
// centres and their grab areas exactly, and only what is looked at is different. The
// width is what fits beside the rotation panel (half-width 16.2 + rim) at x +/-21.4.
// Pass 32: the wide buttons shrank (9.2 x 4.2 -> 8.2 x 3.6); their grab boxes did not.
// Pass 33 — THE BUTTON RULE, for every plate with a glyph and a word:
//   glyph box  = BTN_GLYPH_FRAC of the plate's short side (1.8 on a 3.6 plate)
//   side pad   = BTN_PAD_FRAC of the short side (0.9), both ends
//   glyph and word are ONE group: glyph box, BTN_GROUP_GAP, then the word;
//   word size WIDE_BTN_TEXT_SIZE (34, about 0.3 of the short side in cap height)
//   round buttons: the glyph spans BTN_GLYPH_FRAC of the diameter
//   grab boxes stay 2 cm wider and 0.9 taller than the plate.
//
// PASS 35 — WHY THE FOUR BUTTONS STILL DID NOT MATCH, AND WHAT CHANGED. The rule was
// measured on the rendered geometry rather than looked at (ScarfCustomizer.measureButtons,
// harness step `measureButtons`), and the numbers said two different things:
//
//   1. Photo and Gallery were NOT following the rule. Both multiply the glyph's x OFFSET
//      by the glyph's SCALE (`PB_GLYPH_X * k`), which pulled the glyph's centre from -2.30
//      in to -1.43 and left 1.77 cm of left padding where the rule asks for 0.90. Import
//      and Text used WIDE_BTN_GLYPH_X unscaled and measured the rule's 0.90 exactly.
//   2. The rule itself could not produce the same result on both sides, because it fixed
//      the WORD'S CENTRE at a constant x and let the gap fall where it may. A gap that is
//      a leftover varies with the word: 0.40 cm behind "Gallery" (7 characters) and
//      1.83 cm behind "Text" (4). That is the "large gap" — nothing about the type was
//      ever smaller; cap height measured 0.79 cm on all four.
//
// So the group is now built LEFT TO RIGHT from the pad, and the gap is the constant: the
// glyph's centre is WIDE_BTN_GLYPH_X (never scaled) and the word's LEFT EDGE is
// WIDE_BTN_WORD_X, one BTN_GROUP_GAP past the glyph box. Every button then shows the same
// left pad, the same glyph box and the same gap whatever its word is, and the glyphs of a
// stacked pair line up vertically — which is what makes a stack read as one family.
// ============================================================================
// PASS 46 — THE INSIDE OF THE BUTTON, MEASURED OFF Refs/ui_btn, NOT DESIGNED.
// The reference (2037 x 1452 px) draws the four plates at 817 x 329 px. The plate's
// HEIGHT is the element the reference and the build share (3.6 cm here), so the scale
// is 329 / 3.6 = 91.4 px/cm; the reference plate is 8.94 cm wide at that scale (ours is
// 8.2 — the plate is not in question). Read off the image, in cm:
//     icon box      Photo 1.55 x 1.33, My Lib 1.55 x 1.28, Gallery 1.50 x 1.40, Aa 1.53 x 1.18
//                   -> the icons are 1.55 WIDE; their heights follow each glyph (1.1..1.4)
//     gap           0.76, 0.49, 0.63, 0.53  -> 0.60
//     cap height    P 1.02, M ~1.00, G 0.98, T 0.97  -> 1.00 (the Aa glyph's A is 1.18)
//     left pad      1.67, 1.65, 1.71 (Text 2.10)  -> 1.68: the three icon buttons share it
//     group centre  +0.18, +0.13, +0.47, -0.07 from the plate's centre: the group is NOT
//                   centred — it starts at the pad and the slack collects on the right
//                   (Gallery's right pad is 0.77, Photo's 1.32). Text is the odd one: its
//                   Aa starts 0.42 further in; the three-of-four pad is what is applied.
// The build before this pass: icon box 1.80 (My lib 1.80 x 1.80 — its 2x2 grid filled the
// whole box, solid, while the camera and frame are 1.8 x 1.3 outlines, which is why it
// read as enormous), gap 0.49, cap 0.93 (Text 1.02), left pad 0.90. Where the Pass-35
// rule and the reference disagree, the reference wins: the box is 1.55 not "half the
// plate", the pad is 1.68 not "a quarter", the gap 0.60, the cap 1.00 on all four.
// ============================================================================
export const WIDE_BTN_W = 8.2
export const WIDE_BTN_H = 3.6
export const WIDE_BTN_R = 1.5
export const WIDE_BTN_GLYPH_BOX = 1.55 // Pass 46: measured (was WIDE_BTN_H x 0.5 = 1.8)
export const WIDE_BTN_PAD = 1.68 // Pass 46: measured (was WIDE_BTN_H x 0.25 = 0.9)
export const BTN_GLYPH_FRAC = WIDE_BTN_GLYPH_BOX / WIDE_BTN_H // 0.43, for the round buttons that scale by it
export const BTN_PAD_FRAC = WIDE_BTN_PAD / WIDE_BTN_H
/** Pass 46: the glyph-to-word gap, the reference's mean 0.60 (Pass 37 had 0.5). */
export const BTN_GROUP_GAP = 0.6
export const WIDE_BTN_GLYPH_X = -WIDE_BTN_W / 2 + WIDE_BTN_PAD + WIDE_BTN_GLYPH_BOX / 2 // -2.3, the glyph's CENTRE
/**
 * Pass 35: the word's LEFT EDGE, one gap past the glyph box. A Text left-aligned in a
 * layoutRect starts its ink WIDE_BTN_WORD_BEARING inside the rect's left edge (measured:
 * the same 0.12 cm on all four words), so the rect is offset by that much and the INK,
 * which is the only thing anyone sees, lands one clean BTN_GROUP_GAP past the glyph.
 */
export const WIDE_BTN_WORD_BEARING = 0.12
/**
 * PASS 37: the bearing is a property of the TYPE, not a fixed distance — it grew with the
 * word when the size went 34 -> 40 and left the gap 0.03 short. Measured 0.12 cm at size
 * 34, so it is carried as a fraction of the size and the gap comes out right at any size.
 */
export const WIDE_BTN_WORD_BEARING_FRAC = WIDE_BTN_WORD_BEARING / 34
/** The layoutRect's left edge for a word at `size`, so its INK lands one gap past the glyph. */
export function wideBtnWordX(size: number): number {
  return WIDE_BTN_GLYPH_X + WIDE_BTN_GLYPH_BOX / 2 + BTN_GROUP_GAP + size * WIDE_BTN_WORD_BEARING_FRAC
}
export const WIDE_BTN_WORD_X = wideBtnWordX(34) // the pre-Pass-37 constant, kept for callers that pass a position
/** Pre-Pass-35: the word's CENTRE. Kept so UI_STYLE = "classic" reverts to the old placement. */
export const WIDE_BTN_TEXT_X = (WIDE_BTN_GLYPH_X + WIDE_BTN_GLYPH_BOX / 2 + BTN_GROUP_GAP + WIDE_BTN_W / 2 - WIDE_BTN_PAD) / 2 // 1.2
/**
 * PASS 37: 34 -> 40. Refs/ui_btn sets its words at a cap height of about 89 px on a 350 px
 * plate = 0.254 of the plate's height; at 34 ours measured 0.79 cm on a 3.6 cm plate,
 * which is 0.219. 40 puts the cap at about 0.92 cm, so the word carries the visual weight
 * the reference gives it instead of sitting under the glyph's.
 */
// Pass 46: 40 -> 43. The reference's cap height is 1.00 cm; 40 measured 0.93, so 43.
export const WIDE_BTN_TEXT_SIZE = 43
export const WIDE_BTN_GLYPH_SCALE = WIDE_BTN_GLYPH_BOX / 2.9 // the camera glyph's 2.9 body fills the box
// Pass 46: 55 -> 50. The reference's "Aa" has a 1.18 cm A; 55 measured a 1.29 box, so 50.
export const WIDE_BTN_GLYPH_LABEL_SIZE = 50
export const WIDE_BTN_HIT = PLATE_HIT

/**
 * The bare round control plate every icon button in this project is: a soft lit rim, a
 * dark body, a generous box collider and an Interactable. The caller adds the glyph.
 * Glass (Pass 24): the wide rounded button instead; `gradient` fills it with the accent
 * gradient (the reference's "Importer"), otherwise `fill` is its body colour. Either way
 * the body is child 1 (the rim is child 0), which is what the import button recolours.
 */
/** Pass 25: a glass button's own dimensions, when it is not the standard wide one. */
export interface WideButtonDims {
  w: number
  h: number
  r: number
  hit: vec3
}

export function makePlateButton(
  parent: SceneObject,
  name: string,
  center: vec3,
  fill: vec4 = PLATE_COL,
  gradient: boolean = false,
  dims: WideButtonDims = { w: WIDE_BTN_W, h: WIDE_BTN_H, r: WIDE_BTN_R, hit: WIDE_BTN_HIT }
): SceneObject {
  const obj = global.scene.createSceneObject(name)
  obj.setParent(parent)
  obj.getTransform().setWorldPosition(center)

  if (pick(false, true)) {
    addFlatShape(obj, uiRoundRect(dims.w + 2 * GLASS_RIM, dims.h + 2 * GLASS_RIM, dims.r + GLASS_RIM),
      new vec3(0, 0, -0.1), new vec3(1, 1, 1), gradient ? ACCENT_GLOW : RIM_COL)
    if (gradient) addGradientShape(obj, uiRoundRect(dims.w, dims.h, dims.r), vec3.zero(), new vec3(1, 1, 1))
    else addFlatShape(obj, uiRoundRect(dims.w, dims.h, dims.r), vec3.zero(), new vec3(1, 1, 1), fill)
  } else {
    addFlatShape(obj, uiDisc(), new vec3(0, 0, -0.1), new vec3(PLATE_R + PLATE_RIM_PAD, PLATE_R + PLATE_RIM_PAD, 1), RIM_COL)
    addFlatShape(obj, uiDisc(), vec3.zero(), new vec3(PLATE_R, PLATE_R, 1), PLATE_COL)
  }

  const collider = obj.createComponent("Physics.ColliderComponent") as ColliderComponent
  const shape = Shape.createBoxShape()
  shape.size = pick(PLATE_HIT, dims.hit)
  collider.shape = shape
  collider.fitVisual = false // honour the explicit box size; never auto-fit to a child visual
  const inter = obj.createComponent(Interactable.getTypeName()) as Interactable
  inter.targetingMode = 3 // Direct + Indirect, so mouse + hand both hit it

  setLayerDeep(obj, LAYERS.ui)
  return obj
}

/** Glass only: the word on a wide button, to the right of its glyph. Classic draws none. */
export function addButtonWord(
  btn: SceneObject,
  word: string,
  color: vec4 = LABEL_COL,
  pos: vec3 = new vec3(pick(WIDE_BTN_TEXT_X, WIDE_BTN_WORD_X), 0, 0.2),
  size: number = WIDE_BTN_TEXT_SIZE
): Text | null {
  if (!pick(false, true)) return null
  if (!GLASS) return addLabel(btn, pos, word, size, color, HorizontalAlignment.Center)
  // Pass 35: LEFT-aligned in glass, so `pos.x` is where the ink starts and the gap behind
  // the glyph is the same on every button whatever the word's length.
  // A Text with HorizontalOverflow.Overflow and no layoutRect aligns inside a default box
  // far wider than the plate — measured: every word's ink started at -8.42, nowhere near
  // its object. So the word is placed at the plate's centre and given an EXPLICIT rect
  // running from the word slot to the far pad; Left then means "start at pos.x".
  const t = addLabel(btn, new vec3(0, pos.y, pos.z), word, size, color, HorizontalAlignment.Left)
  // Pass 37: the x is DERIVED from the size here rather than taken from `pos`, so all four
  // buttons get the same gap by construction and a caller cannot pass a stale one. Only
  // pos.y and pos.z are the caller's to choose.
  t.layoutRect = Rect.create(wideBtnWordX(size), WIDE_BTN_W / 2 - WIDE_BTN_PAD, -WIDE_BTN_H / 2, WIDE_BTN_H / 2)
  // Pass 37: that placement is PROVISIONAL. The word is one gap past the glyph, which is
  // the only part of the arrangement that can be fixed at build time; where the pair sits
  // in the plate needs the word's ink width, which needs a frame. See requestButtonCentring.
  requestButtonCentring(btn, t)
  return t
}


// --- PASS 37: THE GROUP IS CENTRED, NOT ANCHORED --------------------------------------
//
// Pass 35 built the glyph-and-word group LEFT TO RIGHT FROM A FIXED PAD, so every button
// showed the same left padding and the slack all collected on the right. That made the
// four buttons match each other, which was the ask at the time, but it is the wrong
// shape: the pair reads as an icon pinned to the edge with the word trailing behind it,
// and the group sits off-centre in the plate. Refs/ui_btn puts the two together as ONE
// OBJECT and centres that object, so the air is shared between the two ends.
//
// WHY THIS NEEDS A FRAME. The group's width is glyph + gap + THE WORD'S INK, and a Text's
// ink width is not known until the engine has laid it out — it depends on the string, the
// face and the size, and nothing in this process can predict it ("Gallery" and "Text"
// differ by 1.4 cm). The alternative, guessing a width from the character count the way
// the head pill does, is wrong by over 10% on the words we actually use. So the word is
// built at its provisional left-anchored position, measured on a later frame, and the
// WHOLE GROUP is then slid by one delta.
//
// Sliding the whole group is what keeps the gap exact: the glyph and the word were already
// placed one BTN_GROUP_GAP apart at build time, and a uniform translation cannot change
// the distance between them. Only the group's position in the plate changes.
//
// Children 0 and 1 are the rim and the body (makePlateButton draws them in that order and
// nothing else may be inserted before them); everything from index 2 on is the group.
export const BTN_GROUP_FIRST_CHILD = 2
/** Frames to wait for the engine to lay the Text out before its ink can be measured. */
export const BTN_CENTRE_DELAY = 3

interface PendingCentre {
  btn: SceneObject
  word: Text
  glyphBox: number
  frames: number
}
const pendingCentre: PendingCentre[] = []

/**
 * Ask for `btn`'s group to be centred once its word has been laid out. Called by
 * addButtonWord for every icon-and-word button, and again by anything that CHANGES a
 * word after the fact (the Import button relabels itself when there are no credentials,
 * and a re-centre is the difference between that word being centred and being wherever
 * the old, longer word left it).
 */
/**
 * PASS 45 — THE GROUP IS LEFT-ANCHORED AGAIN. Refs/new_ui puts every button's glyph at
 * the same left pad ("Photo" and "Gallery" glyphs start on one line, the words after
 * them), and the user asks for the same left padding on all the icon-and-word buttons.
 * That is the Pass-35 rule: glyph centre at WIDE_BTN_GLYPH_X, word one gap past the glyph
 * box, the slack on the right. The Pass-37 centring is kept behind this switch.
 */
export const BTN_GROUP_CENTRED = false

export function requestButtonCentring(btn: SceneObject, word: Text, glyphBox: number = WIDE_BTN_GLYPH_BOX): void {
  if (!GLASS || !BTN_GROUP_CENTRED) return // classic centres its word by itself; Pass 45 anchors the group left
  for (let i = 0; i < pendingCentre.length; i++) {
    if (pendingCentre[i].btn === btn) { pendingCentre[i].frames = 0; pendingCentre[i].word = word; return }
  }
  pendingCentre.push({ btn: btn, word: word, glyphBox: glyphBox, frames: 0 })
}

/** Per-frame, from the one update loop. A no-op once every button has settled. */
export function tickButtonCentring(): void {
  for (let i = pendingCentre.length - 1; i >= 0; i--) {
    const p = pendingCentre[i]
    p.frames++
    if (p.frames < BTN_CENTRE_DELAY) continue
    if (applyButtonCentring(p.btn, p.word, p.glyphBox)) pendingCentre.splice(i, 1)
  }
}

/**
 * Measure the word's ink, work out where the group SHOULD start, and slide the group there.
 * Returns false if the Text has not laid out yet, so the caller can try again next frame.
 */
function applyButtonCentring(btn: SceneObject, word: Text, glyphBox: number): boolean {
  let inkW = 0
  try {
    const lo = word.worldAabbMin()
    const hi = word.worldAabbMax()
    const sx = btn.getTransform().getWorldScale().x
    if (sx === 0) return false
    inkW = (hi.x - lo.x) / sx
  } catch (_e) {
    return false
  }
  if (inkW <= 0) return false // not laid out yet

  // Where the group starts today: the glyph's left edge, at the Pass-35 fixed pad.
  const wasLeft = WIDE_BTN_GLYPH_X - glyphBox / 2
  // Where it belongs: half the leftover air on each side.
  const groupW = glyphBox + BTN_GROUP_GAP + inkW
  const wantLeft = -groupW / 2
  const dx = wantLeft - wasLeft
  if (Math.abs(dx) < BTN_CENTRE_EPSILON) return true // already there

  for (let i = BTN_GROUP_FIRST_CHILD; i < btn.getChildrenCount(); i++) {
    const t = btn.getChild(i).getTransform()
    const p = t.getLocalPosition()
    t.setLocalPosition(new vec3(p.x + dx, p.y, p.z))
  }
  return true
}

/** Below this the shift is not worth doing, and doing it twice must be a no-op. */
export const BTN_CENTRE_EPSILON = 0.001

// --- Pass 31: the dropper glyph, drawn as geometry like every other glyph here --------------
export const DROPPER_COL = new vec4(1, 1, 1, 0.92)
export const DROPPER_BODY = new vec2(1.15, 0.32)
export const DROPPER_BULB_R = 0.34
export const DROPPER_BULB_D = 0.5 // bulb centre along the diagonal
export const DROPPER_COLLAR = new vec2(0.22, 0.62)
export const DROPPER_COLLAR_D = 0.18
export const DROPPER_TIP_R = 0.14
export const DROPPER_TIP_D = 0.62

/** A dropper: a diagonal body, a bulb at its upper end, a collar, a drop at the tip. Returns the parts. */
export function addDropperGlyph(parent: SceneObject, pos: vec3, k: number, col: vec4 = DROPPER_COL, depthSorted: boolean = false): SceneObject[] {
  const quad = uiQuad()
  const disc = uiDisc()
  const rot = Math.PI / 4
  return [
    addFlatShape(parent, quad, new vec3(pos.x, pos.y, pos.z), new vec3(DROPPER_BODY.x * k, DROPPER_BODY.y * k, 1), col, rot, depthSorted),
    addFlatShape(parent, disc, new vec3(pos.x + DROPPER_BULB_D * k, pos.y + DROPPER_BULB_D * k, pos.z + 0.02), new vec3(DROPPER_BULB_R * k, DROPPER_BULB_R * k, 1), col, 0, depthSorted),
    addFlatShape(parent, quad, new vec3(pos.x + DROPPER_COLLAR_D * k, pos.y + DROPPER_COLLAR_D * k, pos.z + 0.03), new vec3(DROPPER_COLLAR.x * k, DROPPER_COLLAR.y * k, 1), col, rot, depthSorted),
    addFlatShape(parent, disc, new vec3(pos.x - DROPPER_TIP_D * k, pos.y - DROPPER_TIP_D * k, pos.z + 0.02), new vec3(DROPPER_TIP_R * k, DROPPER_TIP_R * k, 1), col, 0, depthSorted),
  ]
}

// --- Pass 35: the icons that replaced words -------------------------------------------------
// "Done", "Undo" and "Clear gems" were words on pills; they are now glyphs, drawn from
// geometry like every other glyph in this project so they scale, recolour and live on the
// UI layer with the rest. Each is centred on `pos` and `k` scales the whole thing.

/**
 * A check: a short arm falling to the vertex, a long arm rising out of it. Both arms are
 * laid out FROM CHECK_VERTEX — the ends cannot drift apart the way the old pair did.
 * A bar rotated by -45 runs down-to-the-right ("\\"); by +45, up-to-the-right ("/").
 */
export function addCheckGlyph(parent: SceneObject, pos: vec3, k: number = 1, col: vec4 = HEAD_ICON_COL, depthSorted: boolean = true): void {
  const quad = uiQuad()
  const r2 = Math.SQRT1_2 // the arms lie at 45 degrees, so each spans len/sqrt(2) in x and in y
  const vx = pos.x + CHECK_VERTEX.x * k
  const vy = pos.y + CHECK_VERTEX.y * k
  const a = CHECK_SHORT * k
  const b = CHECK_LONG * k
  // Short arm: from up-left down INTO the vertex, so its centre is half a length back up it.
  addFlatShape(parent, quad, new vec3(vx - (a * r2) / 2, vy + (a * r2) / 2, pos.z), new vec3(a, CHECK_T * k, 1), col, -Math.PI / 4, depthSorted)
  // Long arm: OUT of the vertex, up to the right.
  addFlatShape(parent, quad, new vec3(vx + (b * r2) / 2, vy + (b * r2) / 2, pos.z), new vec3(b, CHECK_T * k, 1), col, Math.PI / 4, depthSorted)
}

export const UNDO_R = 0.62 // the arc's radius, before k
export const UNDO_T = 0.20 // its stroke
export const UNDO_HEAD = 0.46 // the arrowhead's span
export const UNDO_SEGS = 28

/**
 * Undo: an arc over the top, from the right round to the left, with an arrowhead at the
 * left end pointing DOWN — the direction the stroke is travelling when it gets there, so
 * the glyph reads as "go back" rather than as a broken ring.
 */
export function addUndoGlyph(parent: SceneObject, pos: vec3, k: number = 1, col: vec4 = LABEL_COL, depthSorted: boolean = false): void {
  const r = UNDO_R * k
  const cy = pos.y - 0.1 * k
  addFlatShape(parent, buildRing(1 - (UNDO_T * k) / r, UNDO_SEGS, 0, 195), new vec3(pos.x, cy, pos.z), new vec3(r, r, 1), col, 0, depthSorted)
  // buildTriangle is inscribed in the unit box pointing +X, so it is scaled (along, across)
  // and then turned a quarter turn the wrong way to point -Y: the transform scales BEFORE
  // it rotates. -Y is where the stroke is heading when it reaches the arc's left end.
  addFlatShape(parent, buildTriangle(), new vec3(pos.x - r, cy - (UNDO_HEAD * k * 1.15) / 2, pos.z + 0.01),
    new vec3(UNDO_HEAD * k * 1.15, UNDO_HEAD * k, 1), col, -Math.PI / 2, depthSorted)
}

export const BIN_LID_W = 1.24
export const BIN_LID_T = 0.19
export const BIN_LID_Y = 0.52
export const BIN_HANDLE_W = 0.46
export const BIN_HANDLE_T = 0.16
export const BIN_HANDLE_Y = 0.70
export const BIN_BODY_W = 0.92
export const BIN_BODY_H = 1.02
export const BIN_WALL_T = 0.17
export const BIN_BODY_Y = -0.05
export const BIN_SLOT_T = 0.13
export const BIN_SLOT_H = 0.56

/**
 * A bin, drawn in strokes rather than as a filled can with holes knocked through it: the
 * Clear pill recolours when it is armed, and a knocked-out hole would still be the old
 * colour. Returns the lid and the handle so the armed state can tip them.
 */
export function addBinGlyph(parent: SceneObject, pos: vec3, k: number = 1, col: vec4 = LABEL_COL, depthSorted: boolean = false): SceneObject[] {
  const quad = uiQuad()
  const y = (v: number): number => pos.y + v * k
  const lid = addFlatShape(parent, quad, new vec3(pos.x, y(BIN_LID_Y), pos.z), new vec3(BIN_LID_W * k, BIN_LID_T * k, 1), col, 0, depthSorted)
  const handle = addFlatShape(parent, quad, new vec3(pos.x, y(BIN_HANDLE_Y), pos.z), new vec3(BIN_HANDLE_W * k, BIN_HANDLE_T * k, 1), col, 0, depthSorted)
  const halfW = ((BIN_BODY_W - BIN_WALL_T) / 2) * k
  const halfH = (BIN_BODY_H / 2) * k
  addFlatShape(parent, quad, new vec3(pos.x - halfW, y(BIN_BODY_Y), pos.z), new vec3(BIN_WALL_T * k, BIN_BODY_H * k, 1), col, 0, depthSorted)
  addFlatShape(parent, quad, new vec3(pos.x + halfW, y(BIN_BODY_Y), pos.z), new vec3(BIN_WALL_T * k, BIN_BODY_H * k, 1), col, 0, depthSorted)
  addFlatShape(parent, quad, new vec3(pos.x, y(BIN_BODY_Y) - halfH, pos.z), new vec3(BIN_BODY_W * k, BIN_WALL_T * k, 1), col, 0, depthSorted)
  addFlatShape(parent, quad, new vec3(pos.x, y(BIN_BODY_Y), pos.z), new vec3(BIN_SLOT_T * k, BIN_SLOT_H * k, 1), col, 0, depthSorted)
  return [lid, handle]
}

/** Relative luminance, for choosing a glyph colour that reads on a picked chip. */
export function lumaOf(c: vec4): number {
  return 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z
}

// --- Pass 32: ONE FAMILY OF SURFACES (Refs/ui_import, Refs/ui_picker) ----------------------
// Every full-screen surface — import, picker, photo, gallery — now opens the same way: a
// round Back button top-left, and a glass HEAD PILL top centre holding an icon, the title
// and, when there is one, a count chip. The subtitle, when a surface has one, sits under
// the pill in the accent colour, as the picker reference shows.
export const HEAD_Y = 25.0
export const HEAD_PILL_H = 4.4
export const HEAD_PILL_R = 2.2
export const HEAD_PILL_PAD = 1.7 // clear space inside each end of the pill
export const HEAD_ICON_W = 2.4 // the icon's slot
export const HEAD_ICON_GAP = 1.0 // between the icon and the word
export const HEAD_WORD_SIZE = 54
export const HEAD_CHAR_W = 0.66 // cm per character at HEAD_WORD_SIZE (measured on "Gallery")
export const HEAD_COUNT_W = 3.0
export const HEAD_COUNT_H = 2.5
export const HEAD_COUNT_R = 1.0
export const HEAD_COUNT_GAP = 1.1
export const HEAD_COUNT_SIZE = 34
export const HEAD_COUNT_FILL = new vec4(0.05, 0.05, 0.08, 0.9)
export const HEAD_SUB_DY = -3.9
export const HEAD_SUB_SIZE = 44
export const HEAD_ICON_COL = ACCENT_VIOLET
export const BACK_CIRCLE_POS = new vec3(-24.0, HEAD_Y, -100)
export const BACK_CIRCLE_R = 1.7 // Pass 33: smaller; the chevron spans half the diameter
export const BACK_CIRCLE_HIT = new vec3(5.0, 5.0, 3)
export const BACK_CHEVRON_LEN = 1.2
export const BACK_CHEVRON_T = 0.2
// PASS 35 — A CHECK THAT IS A CHECK. The two strokes were rotated the WRONG WAY round
// (the short arm at +45 and the long arm at -45 draw a caret, not a tick) and, being
// placed by eye rather than from a shared vertex, their ends missed each other by 0.41 cm
// — so the head pill's "check" read as two loose diagonal bars. A check is one corner: a
// short arm coming DOWN to the right into a vertex, and a long arm going UP from it. Both
// arms are now built from that vertex, so they can only meet.
export const CHECK_SHORT = 0.72 // the arm into the vertex
export const CHECK_LONG = 1.44 // the arm out of it
export const CHECK_T = 0.24
export const CHECK_VERTEX = new vec2(-0.20, -0.44) // where the two arms meet, relative to the glyph's centre

export type HeadIcon = "check" | "image" | "palette" | "camera"

/** The head pill's icon, drawn as geometry, `k` cm tall-ish, centred at `pos`. */
export function addHeadIcon(parent: SceneObject, pos: vec3, kind: HeadIcon, col: vec4 = HEAD_ICON_COL, depthSorted: boolean = true): void {
  const quad = uiQuad()
  const disc = uiDisc()
  if (kind === "check") {
    addCheckGlyph(parent, pos, 1, col, depthSorted)
  } else if (kind === "image") {
    addFlatShape(parent, uiRoundRing(2.2, 1.8, 0.45, 0.18), pos, new vec3(1, 1, 1), col, 0, depthSorted)
    addFlatShape(parent, disc, new vec3(pos.x - 0.5, pos.y + 0.32, pos.z + 0.02), new vec3(0.2, 0.2, 1), col, 0, depthSorted)
    addFlatShape(parent, buildTriangleMesh(), new vec3(pos.x + 0.15, pos.y - 0.32, pos.z + 0.02), new vec3(1.3, 0.75, 1), col, 0, depthSorted)
  } else if (kind === "palette") {
    addFlatShape(parent, disc, pos, new vec3(1.05, 1.05, 1), col, 0, depthSorted)
    const dot = new vec4(1, 1, 1, 0.92)
    addFlatShape(parent, disc, new vec3(pos.x - 0.38, pos.y + 0.28, pos.z + 0.02), new vec3(0.2, 0.2, 1), dot, 0, depthSorted)
    addFlatShape(parent, disc, new vec3(pos.x + 0.22, pos.y + 0.42, pos.z + 0.02), new vec3(0.2, 0.2, 1), dot, 0, depthSorted)
    addFlatShape(parent, disc, new vec3(pos.x + 0.45, pos.y - 0.2, pos.z + 0.02), new vec3(0.2, 0.2, 1), dot, 0, depthSorted)
    addFlatShape(parent, disc, new vec3(pos.x - 0.2, pos.y - 0.45, pos.z + 0.02), new vec3(0.2, 0.2, 1), dot, 0, depthSorted)
  } else {
    addFlatShape(parent, uiRoundRect(2.2, 1.5, 0.35), pos, new vec3(1, 1, 1), col, 0, depthSorted)
    addFlatShape(parent, quad, new vec3(pos.x - 0.45, pos.y + 0.85, pos.z), new vec3(0.8, 0.3, 1), col, 0, depthSorted)
    addFlatShape(parent, disc, new vec3(pos.x, pos.y - 0.05, pos.z + 0.02), new vec3(0.45, 0.45, 1), new vec4(0.05, 0.05, 0.08, 1), 0, depthSorted)
  }
}

let _headTri: RenderMesh | null = null
function buildTriangleMesh(): RenderMesh {
  if (!_headTri) _headTri = buildTriangle()
  return _headTri
}

/**
 * The head pill: icon, word, optional count chip, centred on `pos`. Its width follows the
 * word (HEAD_CHAR_W per character) so "Gallery" and "Uploaded stickers" both fit.
 */
export function addHeadPill(parent: SceneObject, pos: vec3, word: string, icon: HeadIcon, count: number | null, depthSorted: boolean = true): { root: SceneObject; countText: Text | null } {
  const wordW = word.length * HEAD_CHAR_W
  const countW = count === null ? 0 : HEAD_COUNT_GAP + HEAD_COUNT_W
  const w = HEAD_PILL_PAD + HEAD_ICON_W + HEAD_ICON_GAP + wordW + countW + HEAD_PILL_PAD
  const root = global.scene.createSceneObject("HeadPill")
  root.setParent(parent)
  root.getTransform().setLocalPosition(pos)
  addFlatShape(root, uiRoundRect(w + 2 * GLASS_RIM, HEAD_PILL_H + 2 * GLASS_RIM, HEAD_PILL_R + GLASS_RIM), new vec3(0, 0, -0.1), new vec3(1, 1, 1), RIM_COL, 0, depthSorted)
  addFlatShape(root, uiRoundRect(w, HEAD_PILL_H, HEAD_PILL_R), vec3.zero(), new vec3(1, 1, 1), PLATE_COL, 0, depthSorted)
  let x = -w / 2 + HEAD_PILL_PAD + HEAD_ICON_W / 2
  addHeadIcon(root, new vec3(x, 0, 0.2), icon, HEAD_ICON_COL, depthSorted)
  x += HEAD_ICON_W / 2 + HEAD_ICON_GAP + wordW / 2
  addLabel(root, new vec3(x, 0, 0.2), word, HEAD_WORD_SIZE, LABEL_COL, HorizontalAlignment.Center, depthSorted)
  let countText: Text | null = null
  if (count !== null) {
    x += wordW / 2 + HEAD_COUNT_GAP + HEAD_COUNT_W / 2
    addFlatShape(root, uiRoundRect(HEAD_COUNT_W, HEAD_COUNT_H, HEAD_COUNT_R), new vec3(x, 0, 0.15), new vec3(1, 1, 1), HEAD_COUNT_FILL, 0, depthSorted)
    countText = addLabel(root, new vec3(x, 0, 0.3), String(count), HEAD_COUNT_SIZE, LABEL_COL, HorizontalAlignment.Center, depthSorted)
  }
  return { root, countText }
}

/** The round Back button: glass disc, rim, a chevron; its own grab box and Interactable. */
export function addBackCircle(parent: SceneObject, pos: vec3, depthSorted: boolean = true): SceneObject {
  const back = global.scene.createSceneObject("BackCircle")
  back.setParent(parent)
  back.getTransform().setLocalPosition(pos)
  const disc = uiDisc()
  addFlatShape(back, disc, new vec3(0, 0, -0.1), new vec3(BACK_CIRCLE_R + GLASS_RIM, BACK_CIRCLE_R + GLASS_RIM, 1), RIM_COL, 0, depthSorted)
  addFlatShape(back, disc, vec3.zero(), new vec3(BACK_CIRCLE_R, BACK_CIRCLE_R, 1), PLATE_COL, 0, depthSorted)
  const dy = BACK_CHEVRON_LEN * 0.35
  addFlatShape(back, uiQuad(), new vec3(0.1, dy, 0.2), new vec3(BACK_CHEVRON_LEN, BACK_CHEVRON_T, 1), LABEL_COL, Math.PI / 4, depthSorted)
  addFlatShape(back, uiQuad(), new vec3(0.1, -dy, 0.2), new vec3(BACK_CHEVRON_LEN, BACK_CHEVRON_T, 1), LABEL_COL, -Math.PI / 4, depthSorted)
  const collider = back.createComponent("Physics.ColliderComponent") as ColliderComponent
  const shape = Shape.createBoxShape()
  shape.size = BACK_CIRCLE_HIT
  collider.shape = shape
  collider.fitVisual = false
  const inter = back.createComponent(Interactable.getTypeName()) as Interactable
  inter.targetingMode = 3
  return back
}
