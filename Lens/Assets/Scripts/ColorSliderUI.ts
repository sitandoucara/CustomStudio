// ColorSliderUI — Specs UI module (generated per /specs-build-ui, Hard Rule 3).
//
// A vertical in-world color slider built from the UIKit `Slider` primitive.
// The UIKit Slider is horizontal-only (its drag math reads local X), so we make
// it vertical by rotating its holder SceneObject +90 deg about Z: world-vertical
// then maps to the slider's local X, and the drag/knob math still works because
// Slider inverts the world transform to local space before reading X.
//
// Because Slider is built on the UIKit Element/Interactable system, SIK's
// MouseInteractor drives it in the Editor preview automatically — dragging with
// the MOUSE works with no manual TouchEvent mock (specs-interaction-recipes §2).
//
// Channel A (event bus): exposes `onColorValue: PublicApi<number>` (0..1, bottom->top).
//
// Pass 7 — VISIBLE RAINBOW TRACK: a real rainbow gradient strip (red→…→violet, then a
// WHITE zone at the top) is drawn as the slider track, with the knob sliding along it.
// The strip texture and the shirt color both come from ColorUtils.trackColor(t), and the
// strip spans exactly the knob's travel, so the color directly under the knob IS the color
// the shirt becomes — no mismatch. The UIKit Slider's own grey track-fill is hidden so the
// rainbow reads cleanly; the UIKit knob + drag math are kept for interaction.

import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event"
import { buildRainbowTexture } from "./ColorUtils"
import { buildUnitQuad } from "./StickerCompositor"
import { buildDisc, buildRing, buildRoundedRect } from "./Geo"
import { GLASS, caption, pick, raiseAbovePlate } from "./UiTheme"
import { addDropperGlyph, addGlassPanel, GLASS_R } from "./PhotoUi"
import { uiFlatPass, setTextColor, stackVisual, nextUiOrder, setShapeColor } from "./PhotoUi" // Pass 43, 44
import { hidePlateVisuals } from "./UiTheme"

const QUAD_MAT = requireAsset("../StickerQuadMat.mat") as Material // unlit ImageMaterial (textured)

// Slider geometry (must match the _size below): track length = size.x, knob = size.y.
// The knob CENTER travels size.x - size.y, so the rainbow spans exactly that range and
// value t ↔ the pixel under the knob center ↔ trackColor(t) ↔ the applied shirt color.
// Pass 32: the track is shorter in glass so the swatch, the hex and the dropper stack under it.
const SLIDER_LEN = pick(23, 19)
const SLIDER_THICK = 3
// Pass 24 (glass): the panel grows to 7 x 32 and the slider rides 2.1 cm higher in it,
// to leave room for the reference's swatch and hex read-out underneath. SLIDER_LEN is
// untouched, so the knob's travel and the value it reads are exactly what they were; the
// whole control simply sits higher, hit box included (it is the Slider's own).
const PANEL_SIZE = pick(new vec2(5.5, 30), new vec2(7.0, 32))
const CAPTION_Y = pick(13.2, 14.3)
const CAPTION_SIZE = pick(38, 36)
const HOLDER_Y = pick(-1.5, 2.6)
const SWATCH_Y = -9.4 // glass only
// Pass 31: the world-colour dropper. In glass it shares the swatch's row — the swatch moves
// right, the chip sits left, the hex stays centred under both — because the picked colour
// lands in that swatch and the two belong together. Classic has no swatch row; the chip
// sits under the track with a shorter grab box (audit: the track's collider ends at -13.0).
// Pass 32: one column — slider, swatch, hex, dropper — evenly spaced (2.3 cm) under the track.
const SWATCH_X = 0
const PICK_X = 0
const PICK_Y = pick(-14.4, -14.0)
const PICK_R = pick(1.0, 1.2)
const PICK_HIT = pick(new vec3(2.6, 2.2, 3), new vec3(3.4, 2.6, 3))
const PICK_FILL = new vec4(0.12, 0.14, 0.19, 0.95)
const PICK_GLYPH_K = pick(0.62, 0.8)
// Pass 31: while a picked colour is active the knob DETACHES — hidden, the rainbow dimmed,
// the caption reading "Picked" — and the swatch and hex show the picked colour. The
// track never moves to a colour it does not contain; the first touch on it takes over.
const CAPTION_PICKED = "Picked"
const RAINBOW_DIM = new vec4(0.45, 0.45, 0.45, 1)
const RAINBOW_FULL = new vec4(1, 1, 1, 1)
const SWATCH_R = 1.3
const SWATCH_RING = 0.14
const HEX_Y = -11.7
const HEX_SIZE = 34
const SWATCH_RING_COL = new vec4(0.82, 0.84, 0.97, 0.5)
const HEX_COL = new vec4(1, 1, 1, 0.72)
const MOTE_MAT = requireAsset("../Materials/MoteMaterial.mat") as Material

// --- PASS 44 — THE TRACK AND THE KNOB TO Refs/color_slider ------------------------------
// The track. Its footprint is exactly what it was — TRACK_W is the knob's travel
// (SLIDER_LEN - SLIDER_THICK) and TRACK_H the drawn thickness — but it is a stadium now,
// ends fully rounded, rather than a hard-edged quad. Geo.buildRoundedRect maps its UVs
// as u = 0.5 + x / w, the unit quad's own mapping, so the rainbow texture lies along it
// exactly as before and the colour under the knob's centre is still trackColor(value).
const TRACK_W = SLIDER_LEN - SLIDER_THICK
const TRACK_H = SLIDER_THICK - 0.4
const TRACK_R = TRACK_H / 2
const TRACK_SEGMENTS = 12
// The knob. Refs/color_slider: a disc FILLED WITH THE CURRENT COLOUR, a white ring, and a
// small white dot at the centre. UIKit's own knob is not rebuilt: its SceneObject, its
// collider and its drag math are untouched and it still moves the way it always did —
// only its grey RenderMeshVisual is kept hidden (as the track body and fill have been
// since Pass 7) and these three discs are drawn where it is. They live on a root under
// the SliderHolder that copies the knob's world position every LateUpdate (after UIKit's
// own update has moved it), rather than as children of the knob's object, because a
// UIKit Visual animates its own transform's scale on hover and press and that would
// scale the discs with it. The fill takes the colour the owner applies (setSwatchColor),
// which is trackColor(value) — the colour under the knob by construction (Pass 7).
const CUSTOM_KNOB = pick(false, true)
// Pass 45: a little smaller — the disc is now the track's own width (2.5 against 2.6), the
// ring just past it. Drawn size only: the hit target is UIKit's Slider collider, untouched.
// Pass 48: smaller again, 1.25 -> 1.08 — the disc sits inside the 2.6 track with the ring
// reaching its edges. Still drawn size only.
const KNOB_R = 1.08
const KNOB_RING = 0.16
const KNOB_DOT_R = 0.26
/**
 * PASS 49 — THE KNOB'S MARKS ARE NOT WHITE ANY MORE, and the reason is the boot state.
 * The knob's disc takes the colour of the track under it (setSwatchColor), the ring is the
 * band just outside it and the dot sits at its centre. Both were white — which reads
 * everywhere on the rainbow except at the ONE position that greets everybody: white sits
 * mid-track, and a garment boots white, so the first thing anyone saw was a white disc
 * with a white ring and a white dot on a white band. The knob was invisible exactly when
 * it mattered most.
 *
 * The shared rim (PhotoUi.RIM_COL) was tried first, since reusing it would put the knob in
 * the system the plates already speak. It cannot carry this: in glass it is
 * (0.82, 0.84, 0.97) at alpha 0.34, which composites over a white disc to 0.94 — six per
 * cent off white, no edge at all. So this is its own constant, in the rim's OWN cool
 * blue-white hue, darker and more opaque so it holds against white: over white it lands at
 * 0.68, a third of the way down and unmistakably an edge, and over a saturated stone it is
 * a light grey mark that reads softer than the white one it replaces rather than heavier.
 * Colour only: the size, the shape, the collider, the value mapping and the disc's own
 * colour are all untouched.
 */
const KNOB_MARK_COL = new vec4(0.64, 0.67, 0.78, 0.90)
const KNOB_RING_COL = KNOB_MARK_COL
const KNOB_DOT_COL = KNOB_MARK_COL
const KNOB_Z = 0.3 // holder-local lift over the rainbow
const KNOB_SEGMENTS = 48

// Pass 27 verification only (SHIP AS 0): print debugDump every N frames, so the state AFTER a
// real pointer interaction can be read from the log. 0 = off.
const DEBUG_SLIDER_DUMP_EVERY: number = 0
let _dumpFrame = 0

// Debug (verification only; SHIP AS -1): force the slider's starting value so a capture
// deterministically shows a specific shirt color + knob position. -1 = normal (0.5).
const DEBUG_SLIDER_VALUE: number = -1

// --- Typography (compact type-scale, per /specs-build-ui) --------------------
const TYPE_SCALE: { [role: string]: { size: number; weight: string } } = {
  Caption: { size: 38, weight: "medium" },
  Subheadline: { size: 41, weight: "bold" },
}
function applyTextRole(t: Text, role: string, distanceCm: number = 110): void {
  const spec = TYPE_SCALE[role] ?? TYPE_SCALE.Caption
  t.size = Math.round(spec.size * (distanceCm / 110))
}

@component
export class ColorSliderUI extends BaseScriptComponent {
  private slider!: Slider
  private trackFill: any = null
  private swatch: SceneObject | null = null
  // Pass 26: the rainbow texture and its material are HELD here. Engine objects made from
  // script and referenced only by a material pass have been seen to drop out under memory
  // pressure (the socks allocate two paint layers at once), which leaves the track sampling
  // nothing — a flat grey bar. Holding them, and re-binding every frame, closes that.
  private rainbowTex: Texture | null = null
  private rainbowMat: Material | null = null
  private hexText: Text | null = null
  private captionText: Text | null = null
  private pickInteractable: Interactable | null = null
  private detached = false
  // Pass 44: the drawn knob (see CUSTOM_KNOB) — its root and the disc that takes the colour.
  private knobRoot: SceneObject | null = null
  private knobFill: SceneObject | null = null
  private _onPick = new Event<boolean>()

  private _onColorValue = new Event<number>()
  /** Fires with the slider value 0..1 (bottom->top) as the user drags. */
  get onColorValue(): PublicApi<number> { return this._onColorValue.publicApi() }
  /** Pass 31: the dropper chip was pressed. */
  get onPick(): PublicApi<boolean> { return this._onPick.publicApi() }

  onAwake(): void {
    // Root Canvas — SortingType.Hierarchy by default (what UIKit relies on).
    this.sceneObject.createComponent("Component.Canvas")

    // Narrow vertical backing panel so the control reads cleanly on see-through AR.
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    backPlate.onInitialized.add(() => {
      backPlate.size = PANEL_SIZE
    })
    // Pass 33: ONE radius across the three tool panels. UIKit's plate keeps its collider
    // and hover (the interaction plane), but its own rounded visual is hidden every frame
    // (see the update below) and the same glass panel the paint and gem panels draw
    // (PhotoUi.addGlassPanel, GLASS_R) is drawn in its place.
    if (GLASS) {
      const plate = global.scene.createSceneObject("GlassPlate")
      plate.setParent(this.sceneObject)
      plate.getTransform().setLocalPosition(new vec3(0, 0, 0.2))
      addGlassPanel(plate, vec3.zero(), PANEL_SIZE.x, PANEL_SIZE.y, GLASS_R)
    }

    // Content sits +0.6cm in front of the backing to avoid z-fighting, and AFTER
    // the BackPlate in the child list so the Canvas hierarchy sort paints it on top.
    const content = global.scene.createSceneObject("Content")
    content.setParent(this.sceneObject)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    // Caption "Color" near the top of the panel.
    const capObj = global.scene.createSceneObject("Caption")
    capObj.setParent(content)
    capObj.getTransform().setLocalPosition(new vec3(0, CAPTION_Y, 0.1))
    const cap = capObj.createComponent("Component.Text") as Text
    stackVisual(cap) // Pass 43
    cap.text = caption(pick("Color", "Colour"))
    cap.depthTest = true
    cap.horizontalOverflow = HorizontalOverflow.Overflow
    cap.horizontalAlignment = HorizontalAlignment.Center
    cap.verticalAlignment = VerticalAlignment.Center
    applyTextRole(cap, "Caption")
    cap.size = CAPTION_SIZE
    setTextColor(cap, new vec4(1, 1, 1, 0.85)) // Pass 43
    this.captionText = cap

    // Pass 24 (glass): the current colour as a swatch and its hex, under the slider.
    if (GLASS) this.buildSwatch(content)
    // Pass 31: the world-colour dropper, both styles.
    this.buildPickChip(content)
    this.createEvent("OnStartEvent").bind(() => {
      if (this.pickInteractable) this.pickInteractable.onTriggerEnd.add(() => this._onPick.invoke(true))
    })

    // Slider holder — rotated +90deg about Z makes the horizontal slider vertical.
    const holder = global.scene.createSceneObject("SliderHolder")
    holder.setParent(content)
    holder.getTransform().setLocalPosition(new vec3(0, HOLDER_Y, 0.1))
    holder.getTransform().setLocalRotation(quat.angleAxis(Math.PI / 2, new vec3(0, 0, 1)))

    // Rainbow track FIRST, so under the Canvas hierarchy sort it paints BEHIND the knob
    // (which the Slider adds as a later child during initialize()).
    this.buildRainbowTrack(holder)

    // Create the Slider. Slider/Switch require the explicit `_size` + `initialize()`
    // pattern (size must be set BEFORE init or the fill/knob don't refresh).
    // size.x = track length (becomes vertical after the holder rotation).
    this.slider = holder.createComponent(Slider.getTypeName()) as Slider
    ;(this.slider as any)._size = new vec3(SLIDER_LEN, SLIDER_THICK, 1)
    this.slider.initialize()
    this.slider.currentValue = DEBUG_SLIDER_VALUE >= 0 ? DEBUG_SLIDER_VALUE : 0.5

    // Hide the UIKit slider's own visuals so ONLY the rainbow reads as the track. The knob
    // stays; the grey track body + grey fill are hidden. Interaction (collider + drag math)
    // is unaffected — it lives on the component, not the visual meshes.
    this.hideVisual((this.slider as any)._visual)
    this.hideVisual((this.slider as any)._trackFillVisual)
    // Pass 44: the reference's knob, drawn over UIKit's (which stays hidden from here on).
    if (CUSTOM_KNOB) this.buildKnob(holder)

    // PASS 25 — THE FIX FOR THE LOST RAINBOW. UIKit's Element re-enables every visual it
    // owns in enableVisuals(), which runs on OnEnableEvent — so the moment paint mode gave
    // the slider's SceneObject back (or anything else toggled it), the grey track and the
    // grey fill came back with it, drawn OVER the rainbow: the fill grew with the knob and
    // the whole strip read as a plain grey bar. One check per frame keeps them off.
    // Pass 43: once UIKit has built the Slider's parts, give the Slider an order LATER than
    // everything raised above the plate below, so its knob (Slider order + 2) stays above
    // the rainbow from every angle. Three orders are consumed: the Slider's, its track
    // fill's (+1) and its knob's (+2).
    let sliderOrdered = false
    this.createEvent("UpdateEvent").bind(() => {
      if (!sliderOrdered && (this.slider as any)._initialized) {
        sliderOrdered = true
        const o = nextUiOrder(); nextUiOrder(); nextUiOrder()
        try { (this.slider as any).renderOrder = o } catch (_e) { /* ignore */ }
      }
      this.hideVisual((this.slider as any)._visual)
      this.hideVisual((this.slider as any)._trackFillVisual)
      if (GLASS) hidePlateVisuals(this.sceneObject) // Pass 33: UIKit's own plate stays hidden
      // Pass 31: the knob is part of the guarantee — shown only while the colour is on the track.
      // Pass 44: with the drawn knob, UIKit's own stays hidden and the drawn one follows `detached`.
      if (this.detached || CUSTOM_KNOB) this.hideVisual((this.slider as any)._knobVisual)
      else this.showVisual((this.slider as any)._knobVisual)
      if (this.knobRoot && this.knobRoot.enabled === this.detached) this.knobRoot.enabled = !this.detached
      this.rebindRainbow()
      if (DEBUG_SLIDER_DUMP_EVERY > 0 && ++_dumpFrame % DEBUG_SLIDER_DUMP_EVERY === 0) this.debugDump("periodic f" + _dumpFrame)
    })

    // Forward the color value out to the main script (Channel A).
    //
    // Pass 8 — LIVE recolor while dragging: the UIKit Slider only fires `onValueChange`
    // on drag-END (when the knob settles), which made the shirt jump to the final color on
    // release instead of tracking the knob. `onKnobMoved` fires CONTINUOUSLY every frame the
    // knob moves (during the drag itself and the settle spring), carrying the live knob value
    // 0..1. Forwarding BOTH gives an instant per-frame recolor during the scrub plus the exact
    // settled value at the end. The downstream path (applyColor → setFabricColor) only writes
    // the fabric layer's baseColor — no re-stamp / re-bake — so this stays cheap and smooth.
    this.slider.onKnobMoved.add((v: number) => {
      this._onColorValue.invoke(v)
    })
    this.slider.onValueChange.add((v: number) => {
      this._onColorValue.invoke(v)
    })

    // Pass 27: the caption, swatch, hex and rainbow are ours, not UIKit's, so UIKit does not
    // order them above its plate. Do it here — the knob (order 2) must stay above the rainbow.
    raiseAbovePlate(capObj)
    for (let i = 0; i < content.getChildrenCount(); i++) {
      const c = content.getChild(i)
      if (c.name === "SliderHolder") continue // UIKit's own parts keep UIKit's orders
      raiseAbovePlate(c)
    }
    const rainbow = holder.getChild(0) // built first, before the Slider added its parts
    if (rainbow && rainbow.name === "RainbowTrack") raiseAbovePlate(rainbow)
    // Pass 44: the drawn knob was stacked at creation, before the rainbow was re-stacked
    // just above; it goes up again here so it draws over the track (the first build did
    // not, and only the ring's sides showed past the strip).
    if (this.knobRoot) raiseAbovePlate(this.knobRoot)
  }

  /**
   * Pass 44: the drawn knob — ring, colour disc, centre dot — on a root under the holder
   * that follows UIKit's knob. See CUSTOM_KNOB.
   */
  private buildKnob(holder: SceneObject): void {
    const kv: any = (this.slider as any)._knobVisual
    const knobObj: SceneObject | null = kv && kv.renderMeshVisual ? kv.renderMeshVisual.getSceneObject() : null
    if (!knobObj) return
    const root = global.scene.createSceneObject("DrawnKnob")
    root.setParent(holder)
    this.knobRoot = root
    const mk = (name: string, mesh: RenderMesh, z: number, r: number, col: vec4): SceneObject => {
      const obj = global.scene.createSceneObject(name)
      obj.setParent(root)
      obj.getTransform().setLocalPosition(new vec3(0, 0, z))
      obj.getTransform().setLocalScale(new vec3(r, r, 1))
      const v = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      v.mesh = mesh
      stackVisual(v) // Pass 43: above the rainbow, which was stacked before it
      const mat = MOTE_MAT.clone()
      uiFlatPass(mat.mainPass, col, false)
      v.clearMaterials()
      v.addMaterial(mat)
      return obj
    }
    mk("KnobRing", buildDisc(KNOB_SEGMENTS), KNOB_Z, KNOB_R + KNOB_RING, KNOB_RING_COL)
    this.knobFill = mk("KnobFill", buildDisc(KNOB_SEGMENTS), KNOB_Z + 0.05, KNOB_R, new vec4(1, 1, 1, 1))
    mk("KnobDot", buildDisc(KNOB_SEGMENTS), KNOB_Z + 0.1, KNOB_DOT_R, KNOB_DOT_COL)
    // Follow UIKit's knob after its own update has moved it. Only the position is copied:
    // the root keeps the holder's rotation and unit scale.
    const holderTf = holder.getTransform()
    this.createEvent("LateUpdateEvent").bind(() => {
      const wp = knobObj.getTransform().getWorldPosition()
      const lp = holderTf.getInvertedWorldTransform().multiplyPoint(wp)
      root.getTransform().setLocalPosition(new vec3(lp.x, lp.y, 0))
    })
  }

  /** The swatch disc with its ring, and the hex line under it. */
  private buildSwatch(parent: SceneObject): void {
    const mk = (mesh: RenderMesh, pos: vec3, scale: vec3, col: vec4): SceneObject => {
      const obj = global.scene.createSceneObject("Swatch")
      obj.setParent(parent)
      obj.getTransform().setLocalPosition(pos)
      obj.getTransform().setLocalScale(scale)
      const v = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      v.mesh = mesh
      stackVisual(v) // Pass 43
      const mat = MOTE_MAT.clone()
      uiFlatPass(mat.mainPass, col, false) // Pass 43
      v.clearMaterials()
      v.addMaterial(mat)
      return obj
    }
    this.swatch = mk(buildDisc(40), new vec3(SWATCH_X, SWATCH_Y, 0.1), new vec3(SWATCH_R, SWATCH_R, 1), new vec4(1, 1, 1, 1))
    mk(buildRing(1 - SWATCH_RING / (SWATCH_R + 0.2), 40), new vec3(SWATCH_X, SWATCH_Y, 0.15), new vec3(SWATCH_R + 0.2, SWATCH_R + 0.2, 1), SWATCH_RING_COL)
    const hexObj = global.scene.createSceneObject("Hex")
    hexObj.setParent(parent)
    hexObj.getTransform().setLocalPosition(new vec3(0, HEX_Y, 0.1))
    const t = hexObj.createComponent("Component.Text") as Text
    stackVisual(t) // Pass 43
    t.text = "#FFFFFF"
    t.depthTest = true
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.size = HEX_SIZE
    setTextColor(t, HEX_COL) // Pass 43
    this.hexText = t
  }

  /** Pass 31: the dropper chip — a dark disc, a ring, the glyph, and its own grab box. */
  private buildPickChip(parent: SceneObject): void {
    const chip = global.scene.createSceneObject("PickColour")
    chip.setParent(parent)
    chip.getTransform().setLocalPosition(new vec3(PICK_X, PICK_Y, 0.1))
    const mk = (mesh: RenderMesh, pos: vec3, scale: vec3, col: vec4): void => {
      const obj = global.scene.createSceneObject("PickPart")
      obj.setParent(chip)
      obj.getTransform().setLocalPosition(pos)
      obj.getTransform().setLocalScale(scale)
      const v = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      v.mesh = mesh
      stackVisual(v) // Pass 43
      const mat = MOTE_MAT.clone()
      uiFlatPass(mat.mainPass, col, false) // Pass 43
      v.clearMaterials()
      v.addMaterial(mat)
    }
    mk(buildDisc(40), vec3.zero(), new vec3(PICK_R, PICK_R, 1), PICK_FILL)
    mk(buildRing(1 - SWATCH_RING / (PICK_R + 0.2), 40), new vec3(0, 0, 0.05), new vec3(PICK_R + 0.2, PICK_R + 0.2, 1), SWATCH_RING_COL)
    addDropperGlyph(chip, new vec3(0, 0, 0.1), PICK_GLYPH_K)
    const col = chip.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = PICK_HIT
    col.shape = shape
    col.fitVisual = false
    this.pickInteractable = chip.createComponent(Interactable.getTypeName()) as Interactable
    this.pickInteractable.targetingMode = 3
  }

  /**
   * Pass 31: a picked colour is (or is no longer) the one applied. Detached: the knob
   * is hidden, the rainbow dimmed, the caption says so. The swatch and hex are set by the
   * caller through setSwatchColor, so what is shown is always what was applied.
   */
  setDetached(on: boolean): void {
    this.detached = on
    if (this.captionText) this.captionText.text = on ? caption(CAPTION_PICKED) : caption(pick("Color", "Colour"))
    if (this.rainbowMat) {
      try { (this.rainbowMat.mainPass as any).baseColor = on ? RAINBOW_DIM : RAINBOW_FULL } catch (_e) { /* ignore */ }
    }
  }

  isDetached(): boolean {
    return this.detached
  }

  /** Show a UIKit Visual's RenderMeshVisual again (the knob, after a detached spell). */
  private showVisual(v: any): void {
    try {
      if (v && v.renderMeshVisual && !v.renderMeshVisual.enabled) v.renderMeshVisual.enabled = true
    } catch (_e) { /* ignore */ }
  }

  /** Hide a UIKit Visual's underlying RenderMeshVisual without disturbing interaction. */
  private hideVisual(v: any): void {
    try {
      if (v && v.renderMeshVisual && v.renderMeshVisual.enabled) v.renderMeshVisual.enabled = false
    } catch (_e) { /* ignore */ }
  }

  /**
   * Build the visible rainbow gradient strip as the slider track. It's a child of the
   * (rotated) holder, so its local X == the slider's value axis == world-vertical. Its
   * length equals the knob's travel (SLIDER_LEN - SLIDER_THICK) so the color under the
   * knob center is exactly trackColor(value) — the same color applied to the shirt.
   */
  private buildRainbowTrack(holder: SceneObject): void {
    const tex = buildRainbowTexture(128, 8)
    this.rainbowTex = tex
    const obj = global.scene.createSceneObject("RainbowTrack")
    obj.setParent(holder)
    const tf = obj.getTransform()
    tf.setLocalPosition(new vec3(0, 0, 0.02)) // just in front of the (hidden) track body
    // Pass 44 (glass): the stadium mesh carries its size; classic keeps the scaled unit quad.
    const rounded = pick(false, true)
    tf.setLocalScale(rounded ? new vec3(1, 1, 1) : new vec3(TRACK_W, TRACK_H, 1))

    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = rounded ? buildRoundedRect(TRACK_W, TRACK_H, TRACK_R, TRACK_SEGMENTS) : buildUnitQuad()
    stackVisual(visual) // Pass 43 (raiseAbovePlate then puts it at PLATE_CONTENT_ORDER)
    const mat = QUAD_MAT.clone()
    this.rainbowMat = mat
    const pass: any = mat.mainPass
    try { pass.baseTex = tex } catch (_e) { /* ignore */ }
    try { pass.baseColor = new vec4(1, 1, 1, 1) } catch (_e) { /* ignore */ }
    try { pass.depthTest = false } catch (_e) { /* ignore */ } // overlay by draw order
    try { pass.depthWrite = false } catch (_e) { /* ignore */ }
    try { pass.twoSided = true } catch (_e) { /* ignore */ }
    visual.clearMaterials()
    visual.addMaterial(mat)
  }

  /** Pass 26: keep the rainbow bound to its track (see rainbowTex). */
  private rebindRainbow(): void {
    if (!this.rainbowMat || !this.rainbowTex) return
    try {
      const pass: any = this.rainbowMat.mainPass
      const cur: Texture | null = pass.baseTex
      if (!cur || !cur.isSame(this.rainbowTex)) pass.baseTex = this.rainbowTex
    } catch (_e) { /* ignore */ }
  }

  /**
   * PASS 27 VERIFICATION — what is actually drawn under this slider right now: every
   * RenderMeshVisual in the subtree with its enabled flag, mesh, material and texture, plus
   * the UIKit Slider's own three visuals. Printed, so a socks dump can be laid beside a
   * shirt dump. Inert in shipped code.
   */
  debugDump(tag: string): void {
    const lines: string[] = []
    const walk = (o: SceneObject, path: string): void => {
      const p = path + "/" + o.name
      const texts = o.getComponents("Component.Text") as Text[]
      for (const t of texts) lines.push(p + " TEXT enabled=" + (t.enabled ? "Y" : "n") + " text=" + t.text + " order=" + t.renderOrder + " depthTest=" + t.depthTest)
      const comps = o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
      for (const c of comps) {
        let mat = "-"
        let tex = "-"
        let col = "-"
        try {
          if (c.getMaterialsCount() > 0) {
            const m = c.getMaterial(0)
            mat = m.name
            const pass: any = m.mainPass
            const t: Texture | null = pass.baseTex
            tex = t ? (t.name || "(unnamed)") + " " + t.getWidth() + "x" + t.getHeight() : "null"
            const bc: vec4 = pass.baseColor
            col = bc ? bc.x.toFixed(2) + "," + bc.y.toFixed(2) + "," + bc.z.toFixed(2) + "," + bc.w.toFixed(2) : "-"
          }
        } catch (_e) { mat = "err" }
        const sc = o.getTransform().getWorldScale()
        let blend = "-"
        let dt = "-"
        try { const pass: any = c.getMaterial(0).mainPass; blend = String(pass.blendMode); dt = String(pass.depthTest) + "/" + String(pass.depthWrite) } catch (_e) { /* ignore */ }
        const wp = o.getTransform().getWorldPosition()
        lines.push(p + " enabled=" + (c.enabled ? "Y" : "n") + " objEnabled=" + (o.enabled ? "Y" : "n") +
          " mesh=" + (c.mesh ? c.mesh.name : "null") + " mat=" + mat + " tex=" + tex + " col=" + col +
          " scale=" + sc.x.toFixed(2) + "," + sc.y.toFixed(2) + "," + sc.z.toFixed(2) +
          " pos=" + wp.x.toFixed(2) + "," + wp.y.toFixed(2) + "," + wp.z.toFixed(2) +
          " order=" + c.renderOrder + " blend=" + blend + " depth=" + dt)
      }
      for (let i = 0; i < o.getChildrenCount(); i++) walk(o.getChild(i), p)
    }
    walk(this.sceneObject, "")
    const s: any = this.slider
    const vis = (v: any): string => {
      try { return v ? (v.renderMeshVisual ? (v.renderMeshVisual.enabled ? "Y" : "n") : "noRMV") : "none" } catch (_e) { return "err" }
    }
    print("[SLIDER] " + tag + " value=" + (s ? s.currentValue : "?") + " uikit track=" + vis(s._visual) + " fill=" + vis(s._trackFillVisual) + " knob=" + vis(s._knobVisual) +
      " rainbowTex=" + (this.rainbowTex ? this.rainbowTex.getWidth() + "x" + this.rainbowTex.getHeight() : "null"))
    for (const l of lines) print("[SLIDER] " + tag + " " + l)
  }

  /** Current slider value 0..1 (main script reads this to set the initial color). */
  getValue(): number {
    return this.slider ? this.slider.currentValue : 0.5
  }

  /**
   * Pass 18: put the knob back where this garment left it.
   *
   * Writing `currentValue` is what the Slider itself does on a drag, so the knob and the
   * fill follow. It deliberately does NOT emit onColorValue — the caller is restoring a
   * remembered value and is about to apply that colour itself, and an echo here would
   * apply it twice and, worse, make the restore look like a user gesture.
   */
  setValue(v: number): void {
    if (!this.slider) return
    try { this.slider.currentValue = Math.max(0, Math.min(1, v)) } catch (_e) { /* ignore */ }
  }

  /**
   * Best-effort: tint the slider's track-fill to the currently selected color so
   * the control visibly reads as a color picker. Never throws — if the UIKit
   * Visual doesn't expose a settable color on this version, it's a silent no-op.
   */
  setSwatchColor(c: vec4): void {
    if (this.knobFill) setShapeColor(this.knobFill, new vec4(c.x, c.y, c.z, 1)) // Pass 44: the knob wears the colour under it
    if (this.swatch) {
      const v = this.swatch.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null
      if (v && v.getMaterialsCount() > 0) {
        try { (v.getMaterial(0).mainPass as any).baseColor = new vec4(c.x, c.y, c.z, 1) } catch (_e) { /* ignore */ }
      }
    }
    if (this.hexText) {
      const h = (x: number): string => {
        const n = Math.max(0, Math.min(255, Math.round(x * 255)))
        return (n < 16 ? "0" : "") + n.toString(16).toUpperCase()
      }
      this.hexText.text = "#" + h(c.x) + h(c.y) + h(c.z)
    }
    if (!this.trackFill) return
    try {
      const v: any = this.trackFill
      if (v.mainMaterial && v.mainMaterial.mainPass) {
        v.mainMaterial.mainPass.baseColor = c
      } else if ("color" in v) {
        v.color = c
      }
    } catch (_e) { /* no-op: feedback is a bonus, not a requirement */ }
  }
}
