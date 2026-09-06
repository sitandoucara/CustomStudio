// PaintUI — the tool switch, the palette and the erase button (Pass 17).
//
// ===========================================================================
// 1. THE TOOL SWITCH REPLACES THE PANEL, IT DOES NOT REBUILD IT
// ===========================================================================
// The colour slider is a UIKit panel with its own backplate, track, knob and caption,
// built inside its own onAwake. Turning it into a palette by mutating it would mean
// reaching into a component this project deliberately treats as a black box.
//
// So Paint mode simply DISABLES the slider's SceneObject and enables a palette panel of
// the same size in the same place — geometry, like every other control here. Switching
// back re-enables it, and because nothing ever touched the slider's value, the rainbow
// comes back exactly where it was left. That is the whole implementation of "restores
// the rainbow slider with its previous value": there is no state to restore because none
// was disturbed.
//
// ===========================================================================
// 2. ERASE ASKS FIRST, AND WHY THAT RATHER THAN UNDO
// ===========================================================================
// Losing a drawing to a misclick is the worst outcome available in this pass, so the
// erase button is a TWO-STEP: the first tap arms it — the chip turns warm and the label
// reads "Tap to clear" — and only a second tap within ERASE_ARM_SEC actually wipes. It
// disarms itself on timeout, and on any new stroke.
//
// Undo was the alternative and was rejected on cost: the paint layer is a megabyte, so a
// single level of undo means a second megabyte held permanently for an action that
// happens rarely, and a multi-level undo means several. A confirm costs one tap and no
// memory, and it is legible without explanation — which matters more for a control whose
// entire job is "do not do this by accident".

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { buildRing, buildTriangle } from "./Geo"
import { GLASS, caption, pick, UI_COL_X } from "./UiTheme"
import { LAYERS, setLayerDeep } from "./Layers"
import { PaintLayer, PAINT_RADIUS_CM_MIN, PAINT_RADIUS_CM_MAX, PAINT_RADIUS_CM_DEFAULT } from "./PaintLayer"
import { DragInteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import { PAINT_PALETTE, PAINT_PALETTE_INIT } from "./Stickers"
import {
  addFlatShape,
  addLabel,
  setShapeColor,
  uiDisc,
  uiQuad,
  CHIP_EDGE,
  CHIP_FILL,
  CHIP_GLYPH,
  GLYPH_COL,
  LABEL_COL,
  LABEL_DIM_COL,
  PLATE_COL,
  RIM_COL,
  ACCENT_VIOLET,
  ACCENT_FILL, // Pass 45
  ACCENT_GLOW, // Pass 45
  addGradientShape, // Pass 45
  GLASS_ON_FILL,
  GLASS_R,
  addGlassPanel,
  uiRoundRect,
  addDropperGlyph,
  lumaOf,
  setTextColor, // Pass 43
} from "./PhotoUi"
import { UI_TOP_BOX_X, UI_TOP_BOX_TOP_Y, UI_TOP_BOX_W, UI_TOOL_BOX_H, UI_TOP_TILE, UI_TOP_TILE_R } from "./UiTheme" // Pass 45

// --- Where everything sits ------------------------------------------------------
// The colour slider panel is 5.5 x 30 centred at (-21, 0, -110); the palette replaces it
// in place, and the tool row sits just above its top edge.
const UI_X = -UI_COL_X // Pass 33: the left column
const UI_Z = -110
// Pass 24 (glass): the panel is a shade wider and taller (7 x 32), to hold the swatch
// and hex read-out the reference puts under the slider; the palette matches it.
const PANEL_W = pick(5.5, 7.0)
const PANEL_H = pick(30, 32)

// The two tool pills. Classic: side by side above the colour panel, on the left. Glass
// (Pass 24): centred at the very top of the composition, above the garment row, as in
// the reference — each pill carrying an icon and its word. Their hit boxes move with
// them; the pills grew, so the boxes grew to match.
const TOOL_X = pick(UI_X, 0)
// Pass 25: the switch is the reference's size (14.7 x 3.8, pills 6.6 x 2.9) and sits
// 1.4 cm clear above the garment row (row top 21.8, switch bottom 23.3).
const TOOL_Y = pick(17.6, 25.2)
const TOOL_W = pick(5.3, 6.6)
const TOOL_H = pick(2.5, 2.9)
const TOOL_GAP = pick(0.5, 0.5)
const TOOL_TEXT_SIZE = pick(46, 38)
const TOOL_HIT = pick(new vec3(6.2, 4.2, 3), new vec3(6.9, 4.0, 3)) // 6.9: the two boxes meet at the gap, never overlap (audit)
const TOOL_PLATE_PAD = 0.45 // glass: clear plate past the pills, each side
const TOOL_ICON_X = -2.05 // glass: icon centre inside the pill
const TOOL_TEXT_X = 0.7 // glass: word centre inside the pill
const TOOL_ICON_R = 0.66
const TOOL_BRUSH_K = TOOL_ICON_R / 0.78 // the brush was drawn for a 0.78 icon
// A pill is a quad between two half-round caps — the plate language, elongated.
const TOOL_CAP_R = TOOL_H / 2
// PASS 45 (glass) — THE TOOL BOX, Refs/new_ui: the switch leaves the top centre for the
// top of the LEFT column, a rounded box (UiTheme's top boxes) holding three glyph TILES in
// one row — the words are gone, the glyph is the pill. The selected tile is the garment
// row's selected pill exactly: the accent gradient with its violet halo and a white glyph
// (the reference draws both selections the same way); an unselected tile has no body.
// The grab boxes are the full tile pitch wide and the full box tall — as generous as the
// geometry allows without neighbours overlapping (they meet at the pitch, audit).
const TOOL_BOX_X = -UI_TOP_BOX_X // 22.1 into the left column
const TOOL_BOX_Y = UI_TOP_BOX_TOP_Y - UI_TOOL_BOX_H / 2 // 20.65: the box's centre
const TOOL_TILE_PITCH = 2.55
const TILE_HIT_CLEAR = 0.05 // a hair between neighbouring grab boxes, so they never register as touching (audit)
const TOOL_TILE_HIT = new vec3(TOOL_TILE_PITCH - TILE_HIT_CLEAR, UI_TOOL_BOX_H, 3)
const TOOL_TILE_ON_GLYPH = new vec4(0.98, 0.98, 1.0, 1.0) // white on violet, as the garment tiles
const TOOL_TILE_ON_CUT = ACCENT_FILL // the palette's wells and the gem's table line, cut into the violet
const TOOL_ERASE_GAP = 0.9 // clear space between the tool box and the erase chip

// The palette: one column of round chips in the slider's place.
const CHIP_R = pick(1.15, 1.0) // Pass 34: a little smaller again
// Pass 30: the glass chips close up (2.3) to leave the bottom of the panel for the brush
// size slider; their grab boxes shrink with them so neighbours never overlap.
// Pass 31: the dropper chip heads the column — it is a colour source like the chips, so
// it lives with them, in the slot above the first chip; the caption moves up to make room.
// Pass 32: nine chips at a 2.6 pitch (20.8 cm) — the black chip is gone and the column breathes.
const CHIP_STEP = 2.75 // Pass 33: a little more air
const CHIP_TOP_NUDGE = pick(-1.8, -1.3) // the column nudged to clear the caption and the dropper
const PICK_CHIP_Y = pick(11.6, 12.4)
const PICK_FILL = new vec4(0.12, 0.14, 0.19, 0.95)
const PICK_GLYPH_K = 0.72
const PICK_GLYPH_DARK = new vec4(0.10, 0.12, 0.16, 0.95) // the glyph on a light picked colour
const PICK_GLYPH_LUMA = 0.55
const CHIP_SEL_RING = 0.17 // selection ring thickness
// Every chip carries a faint outline, whatever its colour. Without it the near-black
// chip is invisible against the palette's own dark plate — a swatch you cannot see is
// not a swatch, and the two achromatic ends are exactly the ones that need to be
// pickable (see the palette note in Stickers.ts).
const CHIP_EDGE_RING = 0.09
const CHIP_EDGE_COL = new vec4(1, 1, 1, 0.34)
const CHIP_HIT = new vec3(5.0, 2.2, 3)
const PALETTE_LABEL_Y = pick(13.6, 14.6)
// Pass 30 — the BRUSH SIZE slider, under the chips: the gem panel's slider, same form,
// same maths (PhotoUi/GemUI). Radius range is PaintLayer's own PAINT_RADIUS_CM_MIN..MAX
// (0.45 .. 2.2 cm, so 0.9 .. 4.4 cm strokes on the cloth); the default is the old brush.
const BRUSH_LABEL_Y = pick(-13.4, -13.9) // Pass 33: clear of the last chip (its bottom is at -13.45)
const BRUSH_Y = pick(-14.6, -15.0)
const BRUSH_HALF = 2.4 // half the knob's travel
const BRUSH_TRACK = 0.09
const BRUSH_KNOB_R = 0.55
const BRUSH_KNOB_RING = 0.1
const BRUSH_HIT = new vec3(6.6, 2.4, 3)
const BRUSH_LABEL_SIZE = 30
const PALETTE_LABEL_SIZE = pick(44, 36)

// The erase chip, to the right of the tool row. It exists only when paint does.
const ERASE_R = 1.3
// Pass 45 (glass): beside the tool box, inward of it, on the box's centre line. Its grab
// box bottom (20.65 - 2.1 = 18.55) is what Stickers.PAINT_SHADOW_TOP is derived from.
const ERASE_X = pick(-13.2, TOOL_BOX_X + UI_TOP_BOX_W / 2 + TOOL_ERASE_GAP + ERASE_R)
const ERASE_Y = pick(TOOL_Y, TOOL_BOX_Y)
const ERASE_RING = 0.11
const ERASE_HIT = new vec3(4.2, 4.2, 3)
// Bin glyph, drawn as geometry like every other glyph in this project.
const ERASE_CAN = new vec2(1.0, 1.06)
const ERASE_CAN_Y = -0.2
const ERASE_LID = new vec2(1.36, 0.18)
const ERASE_LID_Y = 0.44
const ERASE_GRIP = new vec2(0.52, 0.17)
const ERASE_GRIP_Y = 0.6
// How long the armed state lasts before it gives up and disarms itself.
const ERASE_ARM_SEC = 4.0
const ERASE_LABEL_DY = -2.2
const ERASE_LABEL_SIZE = 40
const ERASE_ARMED_COL = new vec4(0.94, 0.44, 0.42, 1.0)
const ERASE_WORD_ARMED = "Tap to clear"

// Colours for the two tool states.
const TOOL_ON_FILL = pick(new vec4(0.86, 0.92, 1.0, 0.96), GLASS_ON_FILL)
const TOOL_ON_TEXT = pick(new vec4(0.10, 0.13, 0.18, 1.0), new vec4(0.98, 0.98, 1.0, 1.0))
const TOOL_OFF_TEXT = new vec4(1, 1, 1, 0.72)
const TOOL_OFF_FILL = new vec4(0, 0, 0, 0) // glass: an unselected pill has no body
const TOOL_ICON_ON = ACCENT_VIOLET
const TOOL_ICON_OFF = new vec4(1, 1, 1, 0.78)
const CHIP_SEL_COL = pick(CHIP_FILL, ACCENT_VIOLET) // the selected chip's ring

/** Pass 29: the three tools the top switch offers. */
export type ToolKind = "colour" | "paint" | "gems"

export interface PaintUIHooks {
  /** The tool changed. */
  onToolChanged: (tool: ToolKind) => void
  /** Erase was confirmed. */
  onErase: () => void
  /** Pass 31: the dropper chip asks for a colour from the world. */
  onPick: () => void
}

/** One tool pill: its shapes and its label, so the active state can recolour them. */
interface Pill {
  root: SceneObject
  /** Pass 45: the tool's name — glass tiles carry no word, so the name is kept here. */
  name: string
  body: SceneObject
  /** Glass (Pass 45): the violet halo behind the tile; classic: the left cap. */
  capL: SceneObject
  capR: SceneObject
  /** The word — classic only since Pass 45. */
  label: Text | null
  interactable: Interactable
  /** Glass: the icon's parts, recoloured with the state. */
  icon: SceneObject[]
}

export class PaintUI {
  /**
   * The ACTIVE garment's paint layer, asked for rather than held.
   *
   * Pass 18: each garment owns its own drawing, so a reference captured at construction
   * would be the shirt's for ever — the palette would keep colouring the shirt's layer
   * while the cap was on screen, and the erase button would report the shirt's emptiness.
   * A one-line accessor makes every read current, and the per-frame erase-button test in
   * update() then follows the garment with no extra machinery at all.
   */
  private paint: () => PaintLayer[]
  private hooks: PaintUIHooks
  private sliderObj: SceneObject | null = null

  private colourPill!: Pill
  private paintPill!: Pill
  private gemPill!: Pill // Pass 29
  private paletteRoot!: SceneObject
  private chipRings: SceneObject[] = []
  private chipInteractables: Interactable[] = []
  // Pass 31: the dropper chip, and the picked colour it holds once there is one.
  private pickDisc!: SceneObject
  private pickRing!: SceneObject
  private pickGlyph: SceneObject[] = []
  private pickInteractable!: Interactable
  private pickedColor: vec4 | null = null
  private pickSelected = false

  private brushKnob!: SceneObject
  private brushText!: Text
  private brushInteractable!: Interactable
  private brushCm = PAINT_RADIUS_CM_DEFAULT
  private brushDragging = false
  private brushGrab = 0
  private eraseRoot!: SceneObject
  private eraseRing!: SceneObject
  private eraseLabel!: Text
  private eraseInteractable!: Interactable

  private paintMode = false
  private tool: ToolKind = "colour" // Pass 29
  private selectedChip = PAINT_PALETTE_INIT
  private armedUntil = -1
  private elapsed = 0

  constructor(parent: SceneObject, paint: () => PaintLayer[], hooks: PaintUIHooks) {
    this.paint = paint
    this.hooks = hooks
    this.build(parent)
    for (const l of this.paint()) l.setColor(PAINT_PALETTE[this.selectedChip])
  }

  /**
   * The colour slider's SceneObject, so paint mode can hide it. Handed in rather than
   * looked up, because the slider is an @input on the main component and this class has
   * no business searching the scene for it.
   */
  bindSlider(obj: SceneObject | null): void {
    this.sliderObj = obj
    this.applyTool()
  }

  /** Bind the SIK subscriptions. Called from OnStartEvent, where they must live. */
  init(): void {
    this.colourPill.interactable.onTriggerEnd.add(() => this.setTool("colour"))
    this.paintPill.interactable.onTriggerEnd.add(() => this.setTool("paint"))
    this.gemPill.interactable.onTriggerEnd.add(() => this.setTool("gems"))
    for (let i = 0; i < this.chipInteractables.length; i++) {
      const idx = i
      this.chipInteractables[i].onTriggerEnd.add(() => this.selectChip(idx))
    }
    this.eraseInteractable.onTriggerEnd.add(() => this.tapErase())
    this.pickInteractable.onTriggerEnd.add(() => this.tapPick())
    // Pass 30: the brush slider's drag, the platform's own maths.
    this.brushInteractable.onDragStart.add((e: DragInteractorEvent) => {
      const x = this.brushPointerX(e)
      if (x === null) return
      this.brushDragging = true
      this.brushGrab = this.brushKnobX() - x
    })
    this.brushInteractable.onDragUpdate.add((e: DragInteractorEvent) => {
      if (!this.brushDragging) return
      const x = this.brushPointerX(e)
      if (x === null) return
      const t = Math.max(0, Math.min(1, (x + this.brushGrab + BRUSH_HALF) / (2 * BRUSH_HALF)))
      this.setBrush(PAINT_RADIUS_CM_MIN + t * (PAINT_RADIUS_CM_MAX - PAINT_RADIUS_CM_MIN))
    })
    this.brushInteractable.onDragEnd.add(() => { this.brushDragging = false })
    this.setBrush(this.brushCm)
    this.applyTool()
  }

  /** Pass 30: the brush radius, pushed to every layer of the active garment. */
  private setBrush(cm: number): void {
    this.brushCm = Math.max(PAINT_RADIUS_CM_MIN, Math.min(PAINT_RADIUS_CM_MAX, cm))
    for (const l of this.paint()) l.setRadiusCm(this.brushCm)
    this.brushKnob.getTransform().setLocalPosition(new vec3(this.brushKnobX(), BRUSH_Y, 0.4))
    this.brushText.text = "Brush  " + (2 * this.brushCm).toFixed(1) + " cm"
  }

  private brushKnobX(): number {
    return ((this.brushCm - PAINT_RADIUS_CM_MIN) / (PAINT_RADIUS_CM_MAX - PAINT_RADIUS_CM_MIN)) * 2 * BRUSH_HALF - BRUSH_HALF
  }

  private brushPointerX(e: DragInteractorEvent): number | null {
    const origin = e.interactor.startPoint
    const dir = e.interactor.direction
    let hit: vec3 | null = null
    if (origin && dir && Math.abs(dir.z) > 1e-5) {
      const t = (UI_Z - origin.z) / dir.z
      if (t > 0) hit = origin.add(dir.uniformScale(t))
    }
    if (!hit) hit = e.interactor.planecastPoint ?? e.interactor.targetHitPosition ?? null
    if (!hit) return null
    return hit.x - this.paletteRoot.getTransform().getWorldPosition().x
  }

  /** Verification entry point: the same call the slider's drag makes. */
  debugBrushSize(cm: number): void {
    this.setBrush(cm)
  }

  /** Per-frame: the erase button's existence and its armed countdown. */
  update(dt: number): void {
    this.elapsed += dt
    const has = this.paint().some((l) => l.hasPaint())
    // The button does not exist when there is no paint — not disabled, not greyed: absent.
    this.eraseRoot.enabled = has
    if (!has && this.armedUntil >= 0) this.disarm()
    if (this.armedUntil >= 0 && this.elapsed > this.armedUntil) this.disarm()
  }

  isPaintMode(): boolean {
    return this.paintMode
  }

  getTool(): ToolKind {
    return this.tool
  }

  /**
   * Pass 18: the garment changed under us. The tool, the selected chip and the brush are
   * the USER's settings and deliberately survive the switch — only the layer they act on
   * has moved, so the chosen colour is pushed onto it (a brand-new garment's layer has
   * never been told one) and any armed erase is dropped, since arming it was a statement
   * about a drawing that is no longer on screen.
   */
  onGarmentChanged(): void {
    for (const l of this.paint()) l.setColor(this.brushColor())
    for (const l of this.paint()) l.setRadiusCm(this.brushCm) // Pass 30: the brush is the user's setting too
    this.disarm()
  }

  /**
   * Pass 44: the owner switches the tool — the same call a pill makes, so the pills, the
   * gem panel and the sticker chrome all follow. Used by ScarfCustomizer.focusText.
   */
  showTool(tool: ToolKind): void {
    this.setTool(tool)
  }

  /** Verification entry points: the same calls the pills and the chips make. */
  debugSetTool(tool: boolean | string): void {
    this.showTool(tool === true ? "paint" : tool === false ? "colour" : (tool as ToolKind))
  }
  debugSelectChip(i: number): void {
    this.selectChip(i)
  }
  debugTapErase(): void {
    this.tapErase()
  }

  // ---------------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------------

  /** Pass 29: one of three. Each tool owns the left panel while it is active. */
  private setTool(tool: ToolKind): void {
    if (this.tool === tool) return
    this.tool = tool
    this.paintMode = tool === "paint"
    this.disarm()
    this.applyTool()
    this.hooks.onToolChanged(tool)
  }

  private applyTool(): void {
    this.stylePill(this.colourPill, this.tool === "colour")
    this.stylePill(this.paintPill, this.tool === "paint")
    this.stylePill(this.gemPill, this.tool === "gems")
    this.paletteRoot.enabled = this.tool === "paint"
    if (this.sliderObj) this.sliderObj.enabled = this.tool === "colour"
  }

  /** Pass 31: the brush colour — the picked one while it is selected, else the chip. */
  brushColor(): vec4 {
    return this.pickSelected && this.pickedColor ? this.pickedColor : PAINT_PALETTE[this.selectedChip]
  }

  /**
   * Pass 31: a colour arrived from the world. The dropper chip becomes that colour, an
   * eleventh chip, and is selected. It stays on the chip when another chip is chosen, so
   * one tap brings it back; a tap while it is already selected asks for a new pick.
   */
  setPickedColor(c: vec4): void {
    this.pickedColor = new vec4(c.x, c.y, c.z, 1)
    setShapeColor(this.pickDisc, this.pickedColor)
    const glyph = lumaOf(this.pickedColor) > PICK_GLYPH_LUMA ? PICK_GLYPH_DARK : new vec4(1, 1, 1, 0.92)
    for (const g of this.pickGlyph) setShapeColor(g, glyph)
    this.selectPicked()
  }

  private selectPicked(): void {
    if (!this.pickedColor) return
    this.pickSelected = true
    for (const r of this.chipRings) r.enabled = false
    this.pickRing.enabled = true
    for (const l of this.paint()) l.setColor(this.pickedColor)
    this.disarm()
  }

  private tapPick(): void {
    if (this.pickedColor && !this.pickSelected) { this.selectPicked(); return }
    this.hooks.onPick()
  }

  /** Verification: a tap on the dropper chip. */
  debugTapPick(): void {
    this.tapPick()
  }

  private selectChip(i: number): void {
    if (i < 0 || i >= PAINT_PALETTE.length) return
    this.selectedChip = i
    this.pickSelected = false
    this.pickRing.enabled = false
    for (const l of this.paint()) l.setColor(PAINT_PALETTE[i])
    for (let k = 0; k < this.chipRings.length; k++) {
      this.chipRings[k].enabled = k === i
    }
  }

  /** First tap arms, second tap within ERASE_ARM_SEC wipes. See note 2. */
  private tapErase(): void {
    if (!this.paint().some((l) => l.hasPaint())) return
    if (this.armedUntil < 0) {
      this.armedUntil = this.elapsed + ERASE_ARM_SEC
      setShapeColor(this.eraseRing, ERASE_ARMED_COL)
      this.eraseLabel.text = ERASE_WORD_ARMED
      return
    }
    this.disarm()
    this.hooks.onErase()
  }

  private disarm(): void {
    this.armedUntil = -1
    setShapeColor(this.eraseRing, CHIP_EDGE)
    this.eraseLabel.text = ""
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private build(parent: SceneObject): void {
    const root = global.scene.createSceneObject("PaintUI")
    root.setParent(parent)

    // Pass 29: THREE pills — Colour, Paint, Gems — on one plate. The pitch is the pill
    // plus the gap, so the 6.9 grab boxes at a 7.1 pitch still never meet.
    // Pass 45 (glass): the tool BOX at the top of the left column, three tiles in a row.
    const pitch = pick(TOOL_W + TOOL_GAP, TOOL_TILE_PITCH)
    const rowX = pick(TOOL_X, TOOL_BOX_X)
    const rowY = pick(TOOL_Y, TOOL_BOX_Y)
    if (GLASS) {
      const plate = global.scene.createSceneObject("ToolPlate")
      plate.setParent(root)
      plate.getTransform().setLocalPosition(new vec3(TOOL_BOX_X, TOOL_BOX_Y, UI_Z - 0.3))
      addGlassPanel(plate, new vec3(0, 0, 0), UI_TOP_BOX_W, UI_TOOL_BOX_H, GLASS_R)
    }
    this.colourPill = this.buildPill(root, "Colour", new vec3(rowX - pitch, rowY, UI_Z))
    this.paintPill = this.buildPill(root, "Paint", new vec3(rowX, rowY, UI_Z))
    this.gemPill = this.buildPill(root, "Gems", new vec3(rowX + pitch, rowY, UI_Z))

    // The palette panel: the slider's own footprint, in the slider's own plate colours.
    this.paletteRoot = global.scene.createSceneObject("PaintPalette")
    this.paletteRoot.setParent(root)
    this.paletteRoot.getTransform().setLocalPosition(new vec3(UI_X, 0, UI_Z))
    if (GLASS) addGlassPanel(this.paletteRoot, new vec3(0, 0, -0.2), PANEL_W, PANEL_H, GLASS_R)
    else addFlatShape(this.paletteRoot, uiQuad(), new vec3(0, 0, -0.2), new vec3(PANEL_W, PANEL_H, 1), PLATE_COL)
    addLabel(this.paletteRoot, new vec3(0, PALETTE_LABEL_Y, 0.2), caption("Paint"), PALETTE_LABEL_SIZE, LABEL_COL) // Pass 33: the same white as the Colour caption

    // Pass 31: the dropper chip at the head of the column.
    const pickChip = global.scene.createSceneObject("PaintPick")
    pickChip.setParent(this.paletteRoot)
    pickChip.getTransform().setLocalPosition(new vec3(0, PICK_CHIP_Y, 0.2))
    this.pickDisc = addFlatShape(pickChip, uiDisc(), vec3.zero(), new vec3(CHIP_R, CHIP_R, 1), PICK_FILL)
    addFlatShape(pickChip, buildRing(1 - CHIP_EDGE_RING / CHIP_R, 36), new vec3(0, 0, 0.05), new vec3(CHIP_R, CHIP_R, 1), CHIP_EDGE_COL)
    this.pickRing = addFlatShape(pickChip, buildRing(1 - CHIP_SEL_RING / (CHIP_R + 0.28), 40), new vec3(0, 0, 0.1), new vec3(CHIP_R + 0.28, CHIP_R + 0.28, 1), CHIP_SEL_COL)
    this.pickRing.enabled = false
    this.pickGlyph = addDropperGlyph(pickChip, new vec3(0, 0, 0.15), PICK_GLYPH_K)
    const pcol = pickChip.createComponent("Physics.ColliderComponent") as ColliderComponent
    const pshape = Shape.createBoxShape()
    pshape.size = CHIP_HIT
    pcol.shape = pshape
    pcol.fitVisual = false
    this.pickInteractable = pickChip.createComponent(Interactable.getTypeName()) as Interactable
    this.pickInteractable.targetingMode = 3

    const n = PAINT_PALETTE.length
    const top = ((n - 1) * CHIP_STEP) / 2
    for (let i = 0; i < n; i++) {
      const y = top - i * CHIP_STEP + CHIP_TOP_NUDGE // nudged down to clear the caption
      const chip = global.scene.createSceneObject("PaintChip" + i)
      chip.setParent(this.paletteRoot)
      chip.getTransform().setLocalPosition(new vec3(0, y, 0.2))
      addFlatShape(chip, uiDisc(), vec3.zero(), new vec3(CHIP_R, CHIP_R, 1), PAINT_PALETTE[i])
      addFlatShape(
        chip, buildRing(1 - CHIP_EDGE_RING / CHIP_R, 36), new vec3(0, 0, 0.05),
        new vec3(CHIP_R, CHIP_R, 1), CHIP_EDGE_COL
      )
      // The selection ring, hidden until this chip is the chosen one.
      const ring = addFlatShape(
        chip, buildRing(1 - CHIP_SEL_RING / (CHIP_R + 0.28), 40), new vec3(0, 0, 0.1),
        new vec3(CHIP_R + 0.28, CHIP_R + 0.28, 1), CHIP_SEL_COL
      )
      ring.enabled = i === this.selectedChip
      this.chipRings.push(ring)

      const col = chip.createComponent("Physics.ColliderComponent") as ColliderComponent
      const shape = Shape.createBoxShape()
      shape.size = CHIP_HIT
      col.shape = shape
      col.fitVisual = false
      const inter = chip.createComponent(Interactable.getTypeName()) as Interactable
      inter.targetingMode = 3
      this.chipInteractables.push(inter)
    }

    // Pass 30: the brush size slider under the chips.
    this.brushText = addLabel(this.paletteRoot, new vec3(0, BRUSH_LABEL_Y, 0.2), "Brush", BRUSH_LABEL_SIZE, LABEL_DIM_COL)
    addFlatShape(this.paletteRoot, uiQuad(), new vec3(0, BRUSH_Y, 0.2), new vec3(2 * BRUSH_HALF, BRUSH_TRACK, 1), new vec4(1, 1, 1, 0.3))
    this.brushKnob = global.scene.createSceneObject("BrushKnob")
    this.brushKnob.setParent(this.paletteRoot)
    this.brushKnob.getTransform().setLocalPosition(new vec3(0, BRUSH_Y, 0.4))
    addFlatShape(this.brushKnob, uiDisc(), vec3.zero(), new vec3(BRUSH_KNOB_R, BRUSH_KNOB_R, 1), new vec4(0.12, 0.14, 0.19, 0.95))
    addFlatShape(this.brushKnob, buildRing(1 - BRUSH_KNOB_RING / BRUSH_KNOB_R, 40), new vec3(0, 0, 0.1), new vec3(BRUSH_KNOB_R, BRUSH_KNOB_R, 1), ACCENT_VIOLET)
    const brushHit = global.scene.createSceneObject("BrushSizeHit")
    brushHit.setParent(this.paletteRoot)
    brushHit.getTransform().setLocalPosition(new vec3(0, BRUSH_Y, 0.4))
    const bcol = brushHit.createComponent("Physics.ColliderComponent") as ColliderComponent
    const bshape = Shape.createBoxShape()
    bshape.size = BRUSH_HIT
    bcol.shape = bshape
    bcol.fitVisual = false
    this.brushInteractable = brushHit.createComponent(Interactable.getTypeName()) as Interactable
    this.brushInteractable.targetingMode = 3

    // The erase chip.
    this.eraseRoot = global.scene.createSceneObject("PaintErase")
    this.eraseRoot.setParent(root)
    this.eraseRoot.getTransform().setLocalPosition(new vec3(ERASE_X, ERASE_Y, UI_Z))
    addFlatShape(this.eraseRoot, uiDisc(), vec3.zero(), new vec3(ERASE_R, ERASE_R, 1), CHIP_FILL)
    this.eraseRing = addFlatShape(
      this.eraseRoot, buildRing(1 - ERASE_RING / ERASE_R, 48), new vec3(0, 0, 0.1),
      new vec3(ERASE_R, ERASE_R, 1), CHIP_EDGE
    )
    addFlatShape(this.eraseRoot, uiQuad(), new vec3(0, ERASE_CAN_Y, 0.2), new vec3(ERASE_CAN.x, ERASE_CAN.y, 1), CHIP_GLYPH)
    addFlatShape(this.eraseRoot, uiQuad(), new vec3(0, ERASE_LID_Y, 0.2), new vec3(ERASE_LID.x, ERASE_LID.y, 1), CHIP_GLYPH)
    addFlatShape(this.eraseRoot, uiQuad(), new vec3(0, ERASE_GRIP_Y, 0.2), new vec3(ERASE_GRIP.x, ERASE_GRIP.y, 1), CHIP_GLYPH)
    this.eraseLabel = addLabel(this.eraseRoot, new vec3(0, ERASE_LABEL_DY, 0.2), "", ERASE_LABEL_SIZE, LABEL_COL)
    const ecol = this.eraseRoot.createComponent("Physics.ColliderComponent") as ColliderComponent
    const eshape = Shape.createBoxShape()
    eshape.size = ERASE_HIT
    ecol.shape = eshape
    ecol.fitVisual = false
    this.eraseInteractable = this.eraseRoot.createComponent(Interactable.getTypeName()) as Interactable
    this.eraseInteractable.targetingMode = 3
    this.eraseRoot.enabled = false

    setLayerDeep(root, LAYERS.ui)
  }

  /** A labelled pill: a quad body between two round caps, plus a generous hit box. */
  private buildPill(parent: SceneObject, text: string, pos: vec3): Pill {
    const root = global.scene.createSceneObject("Tool" + text)
    root.setParent(parent)
    root.getTransform().setLocalPosition(pos)

    let body: SceneObject
    let capL: SceneObject
    let capR: SceneObject
    let label: Text | null = null
    const icon: SceneObject[] = []
    if (GLASS) {
      // Pass 24: a rounded rectangle on the shared plate, an icon on the left, the word
      // on the right. Colour's icon is a palette (a disc with three paint wells), Paint's
      // a brush (a slanted handle with a tip) — geometry, like every glyph here.
      // Pass 45: a square TILE with the glyph centred and no word. Its body is the garment
      // tile's — a violet halo (capL) behind the accent gradient (body) — both cleared when
      // the tool is not the active one, so an unselected tile is the glyph on the box.
      const t = UI_TOP_TILE
      capL = addFlatShape(root, uiRoundRect(t + 0.5, t + 0.5, UI_TOP_TILE_R + 0.25), new vec3(0, 0, -0.15), new vec3(1, 1, 1), new vec4(ACCENT_GLOW.x, ACCENT_GLOW.y, ACCENT_GLOW.z, 0))
      body = addGradientShape(root, uiRoundRect(t, t, UI_TOP_TILE_R), new vec3(0, 0, -0.1), new vec3(1, 1, 1), TOOL_OFF_FILL)
      capR = body
      const ix = 0 // Pass 45: the glyph sits at the tile's centre
      const r = TOOL_ICON_R
      if (text === "Colour") {
        icon.push(addFlatShape(root, uiDisc(), new vec3(ix, 0, 0.2), new vec3(r, r, 1), TOOL_ICON_OFF))
        const wells = [[-0.34, 0.28], [0.1, 0.42], [0.42, 0.02]]
        for (const w of wells) {
          icon.push(addFlatShape(root, uiDisc(), new vec3(ix + w[0] * r, w[1] * r, 0.3), new vec3(r * 0.2, r * 0.2, 1), PLATE_COL))
        }
        icon.push(addFlatShape(root, uiDisc(), new vec3(ix + 0.12 * r, -0.42 * r, 0.3), new vec3(r * 0.24, r * 0.24, 1), PLATE_COL))
      } else if (text === "Gems") {
        // Pass 29: a small cut stone — a diamond outline with its table line across it.
        const r = TOOL_ICON_R
        icon.push(addFlatShape(root, uiQuad(), new vec3(ix, 0, 0.2), new vec3(r * 1.3, r * 1.3, 1), TOOL_ICON_OFF, Math.PI / 4))
        icon.push(addFlatShape(root, uiQuad(), new vec3(ix, r * 0.32, 0.3), new vec3(r * 1.5, 0.11, 1), PLATE_COL))
      } else {
        const bk = TOOL_BRUSH_K
        icon.push(addFlatShape(root, uiQuad(), new vec3(ix + 0.16 * bk, -0.1 * bk, 0.2), new vec3(0.32 * bk, 1.5 * bk, 1), TOOL_ICON_OFF, -Math.PI / 5))
        icon.push(addFlatShape(root, buildTriangle(), new vec3(ix - 0.45 * bk, 0.62 * bk, 0.25), new vec3(0.52 * bk, 0.5 * bk, 1), TOOL_ICON_OFF, Math.PI - Math.PI / 5 + Math.PI / 2))
      }
    } else {
      // Soft rim, as on every other plate in this project.
      addFlatShape(root, uiQuad(), new vec3(0, 0, -0.2), new vec3(TOOL_W - TOOL_H + 0.5, TOOL_H + 0.5, 1), RIM_COL)
      body = addFlatShape(root, uiQuad(), new vec3(0, 0, -0.1), new vec3(TOOL_W - TOOL_H, TOOL_H, 1), PLATE_COL)
      capL = addFlatShape(root, uiDisc(), new vec3(-(TOOL_W - TOOL_H) / 2, 0, -0.1), new vec3(TOOL_CAP_R, TOOL_CAP_R, 1), PLATE_COL)
      capR = addFlatShape(root, uiDisc(), new vec3((TOOL_W - TOOL_H) / 2, 0, -0.1), new vec3(TOOL_CAP_R, TOOL_CAP_R, 1), PLATE_COL)
      label = addLabel(root, new vec3(0, 0, 0.2), text, TOOL_TEXT_SIZE, TOOL_OFF_TEXT)
    }

    const col = root.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = pick(TOOL_HIT, TOOL_TILE_HIT)
    col.shape = shape
    col.fitVisual = false
    const inter = root.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3

    return { root, name: text, body, capL, capR, label, interactable: inter, icon }
  }

  private stylePill(p: Pill, active: boolean): void {
    if (GLASS) {
      // Pass 45: the garment tile's treatment — halo and gradient body when on, nothing
      // when off; the glyph white on the violet, the wells cut into it in the accent.
      setShapeColor(p.capL, active ? ACCENT_GLOW : new vec4(0, 0, 0, 0))
      setShapeColor(p.body, active ? new vec4(1, 1, 1, 1) : TOOL_OFF_FILL)
      for (let k = 0; k < p.icon.length; k++) {
        const isWell = (p.icon.length > 2 && k > 0) || (p.name === "Gems" && k > 0) // wells and the gem's table line are cut-outs
        if (isWell) setShapeColor(p.icon[k], active ? TOOL_TILE_ON_CUT : PLATE_COL)
        else setShapeColor(p.icon[k], active ? TOOL_TILE_ON_GLYPH : TOOL_ICON_OFF)
      }
      return
    }
    const fill = active ? TOOL_ON_FILL : PLATE_COL
    setShapeColor(p.body, fill)
    setShapeColor(p.capL, fill)
    setShapeColor(p.capR, fill)
    if (p.label) setTextColor(p.label, active ? TOOL_ON_TEXT : TOOL_OFF_TEXT) // Pass 43
  }
}
