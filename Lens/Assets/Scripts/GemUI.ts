// GemUI — the left panel while the Gems tool is active (Pass 29).
//
// Takes the colour slider's footprint exactly as the paint palette does: the tool switch
// shows one of the three, and switching back restores the previous one untouched. From
// the top: six SHAPES (the five cuts from the reference sheets and Mix, which draws a
// cut per stone); eleven COLOURS (ten jewel tones and Mix); a horizontal SIZE slider,
// from the tiny scattered stones to one large centrepiece; UNDO, which removes the last
// tap or trail; and CLEAR, which — like the paint erase — must be pressed twice.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { DragInteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import { buildRing } from "./Geo"
import { LAYERS, setLayerDeep } from "./Layers"
import { GLASS, caption, pick, UI_COL_X } from "./UiTheme"
import {
  addFlatShape, addLabel, addUndoGlyph, addBinGlyph, setShapeColor, uiDisc, uiQuad, uiRoundRect, addGlassPanel,
  PLATE_COL, ACCENT_FILL, ACCENT_VIOLET, LABEL_COL, LABEL_DIM_COL, GLASS_R, CHIP_EDGE, PANEL_TILE_FILL,
} from "./PhotoUi"
import {
  GEM_SHAPES, GEM_SHAPE_NAMES, GEM_SHAPE_MIX, GEM_COLORS, GEM_COLOR_MIX, GEM_COLOR_PICKED,
  GEM_SIZE_MIN, GEM_SIZE_MAX, GEM_SIZE_INIT, buildGemIcon, gemTone, registerGemColor,
} from "./GemSystem"
import { addDropperGlyph, lumaOf } from "./PhotoUi"
import { hexOf } from "./WorldColor"

export interface GemUIHooks {
  onShape: (shape: number) => void
  /** A colour KEY: 0..9 a tone, GEM_COLOR_MIX, or (Pass 41) a picked key from registerGemColor. */
  onColor: (color: number) => void
  onSize: (cm: number) => void
  onUndo: () => void
  onClear: () => void
  /** Pass 41: the dropper chip asks for a colour from the world. */
  onPick: () => void
}

// --- Where it sits: the colour panel's own footprint ------------------------------------
const UI_X = -UI_COL_X // Pass 33: the left column
const UI_Z = -110
const PANEL_W = pick(5.5, 7.0)
const PANEL_H = pick(30, 32)
const G_LABEL_Y = pick(13.6, 14.3)
const G_LABEL_SIZE = pick(44, 36)
// Shapes: two columns, three rows.
const G_SHAPE_TOP_Y = 11.4
const G_SHAPE_PITCH_Y = 2.55
const G_SHAPE_COL_X = 1.55
const G_SHAPE_W = 2.75
const G_SHAPE_H = 2.3
const G_SHAPE_R = 0.6
const G_SHAPE_ICON = 0.8 // icon radius inside the button
const G_SHAPE_HIT = new vec3(2.9, 2.45, 3)
const G_MIX_LABEL = 26
// PASS 38 — THE SHAPE TILES, FLAT AGAIN. Pass 35 gave these the UIKit sticker tile's
// raised three-layer treatment — a recessed darker body, a hairline rim, a drop shadow
// down-and-right — so that the gems panel and the stickers tray would read as one system.
// The direction has changed: the STICKER tiles are the ones being flattened, to the text
// panel's inactive font button, and these follow so that all three panels stay one
// language. The shadow, the rim and the recessed fill are gone; what is left is
// PANEL_TILE_FILL, the single backing the other two panels use.
const G_TILE_FILL = PANEL_TILE_FILL
// Colours: two columns, six rows (ten tones + Mix).
// Pass 35: the words on the two buttons below became icons, which freed room at the
// bottom of the panel; the freed room goes into the circles (0.58 -> 0.78) and into the
// pitch that keeps them apart (1.3 -> 1.75, still 0.19 of clear glass between two chips).
const G_SWATCH_TOP_Y = 3.6
const G_SWATCH_PITCH_Y = 1.75
const G_SWATCH_COL_X = 1.6
const G_SWATCH_R = 0.78
const G_SWATCH_RING = 0.12
const G_SWATCH_HIT = new vec3(3.0, 1.7, 3)
const G_SWATCH_EDGE = new vec4(1, 1, 1, 0.3)
// PASS 41 — THE EYEDROPPER, in the twelfth slot. The grid is two columns by six rows and
// held eleven chips (ten tones and Mix), which left one slot empty in the last row. The
// dropper takes the LEFT slot of that row and Mix moves to the right one, so the dropper
// sits to the left of Mix as the brief describes it. It is the paint palette's dropper
// chip at this panel's chip size — a dark disc, the faint edge every chip carries, the
// glyph, the same violet selection ring — with the same G_SWATCH_HIT grab box as its
// neighbours (3.0 x 1.7 on a 3.2 x 1.75 pitch: 0.2 and 0.05 of clearance, as audited).
// It is the third caller of WorldColorPicker, and behaves as the paint one does: a tap
// opens the picker; once a colour is held the chip IS that colour (put through gemTone —
// see GemSystem) and is selectable like any chip, and a tap while already selected asks
// for a new pick.
//
// MIX LEAVES IT ALONE. Mix draws from the ten tones only. The ten are a curated set that
// read as jewels against every garment colour; a picked colour is whatever the room
// offered, and it changes with every pick — so a Mix that included it would change its
// composition silently, and often for the worse (a beige wall among rubies). The picked
// colour is a deliberate choice, used when it is selected.
const G_PICK_SLOT = GEM_COLORS.length // grid slot 10: last row, left
const G_MIX_SLOT = GEM_COLORS.length + 1 // grid slot 11: last row, right
const G_PICK_FILL = new vec4(0.12, 0.14, 0.19, 0.95) // the paint dropper's dark disc
// PASS 48 — THE DROPPER GROWS. At the chips' 0.78 it read as one more chip with a tiny
// glyph in it. It is now the paint palette's own dropper chip, radius 1.0 (diameter 2.0
// against the chips' 1.56: 1.28 x the radius, 1.64 x the area) with the paint glyph's
// own 0.72 scale, and its row drops G_LAST_ROW_DROP so it clears the row above. Its grab
// box grows with it (G_PICK_HIT, 3.0 x 2.2: 0.25 clear of the row above, audited).
const G_PICK_R = 1.0
const G_PICK_GLYPH_K = 0.72
const G_PICK_HIT = new vec3(3.0, 2.2, 3)
const G_LAST_ROW_DROP = 0.45 // the last row (dropper + Mix) sits this much further down than the pitch
const G_PICK_GLYPH_COL = new vec4(1, 1, 1, 0.92)
const G_PICK_GLYPH_DARK = new vec4(0.10, 0.12, 0.16, 0.95) // the glyph on a light picked colour
const G_PICK_GLYPH_LUMA = 0.55
// The size slider: a hairline track with a round knob, dragged along x.
// Pass 48: everything under the chips moves down and apart — the label 0.9, the slider
// 1.1, undo 0.9, the bin 1.3 — so the label clears the dropper by 1.0, the knob the label
// by 0.65, undo the knob by 1.05 and the bin undo by 0.9 (was 0.5); the bin's bottom is
// 0.9 above the panel's edge. Grab boxes keep their sizes and move with their controls.
const G_SIZE_LABEL_Y = -7.9
const G_SIZE_Y = -9.4
const G_SIZE_HALF = 2.4 // half the knob's travel
const G_SIZE_TRACK = 0.09
const G_SIZE_KNOB_R = 0.55
const G_SIZE_KNOB_RING = 0.1
const G_SIZE_HIT = new vec3(6.6, 2.4, 3)
const G_SIZE_LABEL_SIZE = 30
// Undo and Clear. Pass 35: icons, not words — an undo arrow and a bin. The pills keep
// their 5.6 x 1.6 body and their 5.6 x 1.6 grab box exactly; only what is drawn on them
// changed, so nothing about how easy they are to press moved.
const G_BTN_W = 5.6
const G_BTN_H = 1.6
const G_UNDO_Y = -11.8 // Pass 48: was -10.9
const G_CLEAR_Y = -14.3 // Pass 48: was -13.0
const G_BTN_LABEL = 30 // pre-Pass-35 word size, kept for the classic revert
const G_BTN_ICON_K = 1.0
const G_BIN_ARMED_TILT = 0.42 // rad: the lid tips when Clear is armed, since there is no word to change
const G_BTN_FILL = new vec4(0.16, 0.16, 0.22, 0.95)
const G_CLEAR_ARMED = new vec4(0.94, 0.44, 0.42, 1.0)
const G_CLEAR_WORD = "Clear gems"
const G_CLEAR_ARMED_WORD = "Tap to clear"
const G_CLEAR_ARM_SEC = 4.0
const G_HIT_DEPTH = 3

export class GemUI {
  private root: SceneObject
  private hooks: GemUIHooks
  private shapeBodies: SceneObject[] = []
  private swatchRings: SceneObject[] = []
  private knob!: SceneObject
  private sizeText!: Text
  private clearLabel: Text | null = null // classic only since Pass 35
  private clearBody!: SceneObject
  private binLid: SceneObject[] = [] // Pass 35: the bin's lid and handle, tipped when armed
  private sizeInteractable!: Interactable
  private shape = GEM_SHAPE_MIX
  private color = GEM_COLOR_MIX // the panel index: 0..9, GEM_COLOR_MIX or GEM_COLOR_PICKED
  // Pass 41: the dropper chip, the toned colour it holds and the batch key that colour has.
  private pickDisc!: SceneObject
  private pickGlyph: SceneObject[] = []
  private pickedColor: vec4 | null = null
  private pickedKey = -1
  private size = GEM_SIZE_INIT
  private dragging = false
  private grabOffset = 0
  private armedUntil = -1
  private elapsed = 0
  private interactables: { inter: Interactable; fn: () => void }[] = []

  constructor(parent: SceneObject, hooks: GemUIHooks) {
    this.hooks = hooks
    this.root = global.scene.createSceneObject("GemUI")
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(UI_X, 0, UI_Z))
    this.build()
    setLayerDeep(this.root, LAYERS.ui)
    this.root.enabled = false
  }

  /** Bind the SIK subscriptions. Called from OnStartEvent, where they must live. */
  init(): void {
    for (const it of this.interactables) it.inter.onTriggerEnd.add(() => it.fn())
    this.sizeInteractable.onDragStart.add((e: DragInteractorEvent) => {
      const x = this.pointerX(e)
      if (x === null) return
      this.dragging = true
      this.grabOffset = this.knobX() - x
    })
    this.sizeInteractable.onDragUpdate.add((e: DragInteractorEvent) => {
      if (!this.dragging) return
      const x = this.pointerX(e)
      if (x === null) return
      this.setSizeFromX(x + this.grabOffset)
    })
    this.sizeInteractable.onDragEnd.add(() => { this.dragging = false })
    this.applyStyle()
    this.hooks.onShape(this.shape)
    this.hooks.onColor(this.color)
    this.hooks.onSize(this.size)
  }

  setVisible(on: boolean): void {
    if (this.root.enabled !== on) this.root.enabled = on
    if (!on) this.disarm()
  }

  update(dt: number): void {
    this.elapsed += dt
    if (this.armedUntil >= 0 && this.elapsed > this.armedUntil) this.disarm()
  }

  /** Verification entry points: the same calls the buttons make. */
  debugShape(i: number): void { this.pickShape(i) }
  debugColor(i: number): void { this.pickColor(i) }
  /** Pass 41 (verification): a tap on the dropper chip. */
  debugTapPick(): void { this.tapPick() }
  debugSize(cm: number): void { this.setSize(cm) }
  debugUndo(): void { this.hooks.onUndo() }
  debugClear(): void { this.tapClear() }

  // ---------------------------------------------------------------------------

  private pickShape(i: number): void {
    this.shape = i
    this.applyStyle()
    this.hooks.onShape(i)
  }

  private pickColor(i: number): void {
    if (i === GEM_COLOR_PICKED && !this.pickedColor) return // nothing picked yet: the chip is a dropper, not a colour
    this.color = i
    this.applyStyle()
    this.hooks.onColor(i === GEM_COLOR_PICKED ? this.pickedKey : i)
  }

  /**
   * Pass 41: a colour arrived from the world. It goes through the jewel-tone recipe
   * (GemSystem.gemTone), is registered as a batch key, becomes the dropper chip's colour
   * and is selected, so the next stones are that colour. Like the paint dropper, it stays
   * on the chip when another chip is chosen, and one tap brings it back.
   */
  setPickedColor(c: vec4): void {
    const toned = gemTone(c)
    print("[GEMS] picked " + hexOf(c) + " -> gem tone " + hexOf(toned))
    this.pickedColor = toned
    this.pickedKey = registerGemColor(toned)
    setShapeColor(this.pickDisc, toned)
    const glyph = lumaOf(toned) > G_PICK_GLYPH_LUMA ? G_PICK_GLYPH_DARK : G_PICK_GLYPH_COL
    for (const g of this.pickGlyph) setShapeColor(g, glyph)
    this.pickColor(GEM_COLOR_PICKED)
  }

  private tapPick(): void {
    if (this.pickedColor && this.color !== GEM_COLOR_PICKED) { this.pickColor(GEM_COLOR_PICKED); return }
    this.hooks.onPick()
  }

  private setSize(cm: number): void {
    this.size = Math.max(GEM_SIZE_MIN, Math.min(GEM_SIZE_MAX, cm))
    this.knob.getTransform().setLocalPosition(new vec3(this.knobX(), G_SIZE_Y, 0.4))
    this.sizeText.text = "Size  " + this.size.toFixed(1) + " cm"
    this.hooks.onSize(this.size)
  }

  private knobX(): number {
    return ((this.size - GEM_SIZE_MIN) / (GEM_SIZE_MAX - GEM_SIZE_MIN)) * 2 * G_SIZE_HALF - G_SIZE_HALF
  }

  private setSizeFromX(x: number): void {
    const t = Math.max(0, Math.min(1, (x + G_SIZE_HALF) / (2 * G_SIZE_HALF)))
    this.setSize(GEM_SIZE_MIN + t * (GEM_SIZE_MAX - GEM_SIZE_MIN))
  }

  /** The pointer's x on the panel's plane, in panel-local cm (the platform's own maths). */
  private pointerX(e: DragInteractorEvent): number | null {
    const origin = e.interactor.startPoint
    const dir = e.interactor.direction
    let hit: vec3 | null = null
    if (origin && dir && Math.abs(dir.z) > 1e-5) {
      const t = (UI_Z - origin.z) / dir.z
      if (t > 0) hit = origin.add(dir.uniformScale(t))
    }
    if (!hit) hit = e.interactor.planecastPoint ?? e.interactor.targetHitPosition ?? null
    if (!hit) return null
    return hit.x - this.root.getTransform().getWorldPosition().x
  }

  private tapClear(): void {
    if (this.armedUntil < 0) {
      this.armedUntil = this.elapsed + G_CLEAR_ARM_SEC
      setShapeColor(this.clearBody, G_CLEAR_ARMED)
      this.setBinArmed(true)
      if (this.clearLabel) this.clearLabel.text = G_CLEAR_ARMED_WORD
      return
    }
    this.disarm()
    this.hooks.onClear()
  }

  private disarm(): void {
    this.armedUntil = -1
    if (this.clearBody) setShapeColor(this.clearBody, G_BTN_FILL)
    this.setBinArmed(false)
    if (this.clearLabel) this.clearLabel.text = G_CLEAR_WORD
  }

  /** Pass 35: the bin's lid tips when Clear is armed — the icon's version of the word change. */
  private setBinArmed(on: boolean): void {
    const a = on ? G_BIN_ARMED_TILT : 0
    for (const part of this.binLid) part.getTransform().setLocalRotation(quat.angleAxis(a, vec3.forward()))
  }

  private applyStyle(): void {
    for (let i = 0; i < this.shapeBodies.length; i++) setShapeColor(this.shapeBodies[i], i === this.shape ? ACCENT_FILL : pick(G_BTN_FILL, G_TILE_FILL))
    for (let i = 0; i < this.swatchRings.length; i++) this.swatchRings[i].enabled = i === this.color
  }

  // ---------------------------------------------------------------------------

  private build(): void {
    if (GLASS) addGlassPanel(this.root, new vec3(0, 0, -0.2), PANEL_W, PANEL_H, GLASS_R)
    else addFlatShape(this.root, uiQuad(), new vec3(0, 0, -0.2), new vec3(PANEL_W, PANEL_H, 1), PLATE_COL)
    addLabel(this.root, new vec3(0, G_LABEL_Y, 0.2), caption("Gems"), G_LABEL_SIZE, LABEL_COL) // Pass 33: the same white as the Colour caption

    // Shapes.
    for (let i = 0; i <= GEM_SHAPES.length; i++) {
      const col = i % 2
      const row = Math.floor(i / 2)
      const pos = new vec3((col === 0 ? -1 : 1) * G_SHAPE_COL_X, G_SHAPE_TOP_Y - row * G_SHAPE_PITCH_Y, 0.2)
      const body = addFlatShape(this.root, uiRoundRect(G_SHAPE_W, G_SHAPE_H, G_SHAPE_R), pos, new vec3(1, 1, 1), pick(G_BTN_FILL, G_TILE_FILL))
      if (i < GEM_SHAPES.length) {
        addFlatShape(body, buildGemIcon(GEM_SHAPES[i]), new vec3(0, 0, 0.1), new vec3(G_SHAPE_ICON, G_SHAPE_ICON, 1), LABEL_COL)
      } else {
        addLabel(body, new vec3(0, 0, 0.1), GEM_SHAPE_NAMES[GEM_SHAPE_MIX], G_MIX_LABEL, LABEL_COL)
      }
      this.shapeBodies.push(body)
      const idx = i
      this.addHit(body, G_SHAPE_HIT, () => this.pickShape(idx))
    }

    // Colours: the ten tones, Mix, and (Pass 41) the dropper — twelve chips, two by six.
    // swatchRings[i] is chip i's selection ring, indexed as this.color is.
    for (let i = 0; i <= GEM_COLORS.length + 1; i++) {
      const slot = i === GEM_COLOR_MIX ? G_MIX_SLOT : i === GEM_COLOR_PICKED ? G_PICK_SLOT : i
      const col = slot % 2
      const row = Math.floor(slot / 2)
      const chip = global.scene.createSceneObject(i === GEM_COLOR_PICKED ? "GemPick" : "GemSwatch" + i)
      chip.setParent(this.root)
      const drop = slot >= G_PICK_SLOT ? G_LAST_ROW_DROP : 0 // Pass 48: the last row sits lower
      chip.getTransform().setLocalPosition(new vec3((col === 0 ? -1 : 1) * G_SWATCH_COL_X, G_SWATCH_TOP_Y - row * G_SWATCH_PITCH_Y - drop, 0.2))
      const r = i === GEM_COLOR_PICKED ? G_PICK_R : G_SWATCH_R // Pass 48: the dropper is the larger chip
      if (i === GEM_COLOR_PICKED) {
        this.pickDisc = addFlatShape(chip, uiDisc(), vec3.zero(), new vec3(r, r, 1), G_PICK_FILL)
        addFlatShape(chip, buildRing(1 - G_SWATCH_RING / r, 32), new vec3(0, 0, 0.05), new vec3(r, r, 1), G_SWATCH_EDGE)
        this.pickGlyph = addDropperGlyph(chip, new vec3(0, 0, 0.08), G_PICK_GLYPH_K, G_PICK_GLYPH_COL)
      } else if (i < GEM_COLORS.length) {
        addFlatShape(chip, uiDisc(), vec3.zero(), new vec3(G_SWATCH_R, G_SWATCH_R, 1), GEM_COLORS[i].rgb)
        addFlatShape(chip, buildRing(1 - G_SWATCH_RING / G_SWATCH_R, 32), new vec3(0, 0, 0.05), new vec3(G_SWATCH_R, G_SWATCH_R, 1), G_SWATCH_EDGE)
      } else {
        // Mix: a disc of four wedges, one per quarter, in four of the tones.
        const wedge = [0, 3, 6, 8]
        for (let k = 0; k < 4; k++) {
          addFlatShape(chip, buildRing(0.0, 12, k * 90, (k + 1) * 90), new vec3(0, 0, 0), new vec3(G_SWATCH_R, G_SWATCH_R, 1), GEM_COLORS[wedge[k]].rgb)
        }
      }
      const ring = addFlatShape(chip, buildRing(1 - G_SWATCH_RING / (r + 0.14), 36), new vec3(0, 0, 0.1), new vec3(r + 0.14, r + 0.14, 1), ACCENT_VIOLET)
      ring.enabled = false
      this.swatchRings.push(ring)
      const idx = i
      if (i === GEM_COLOR_PICKED) this.addHit(chip, G_PICK_HIT, () => this.tapPick())
      else this.addHit(chip, G_SWATCH_HIT, () => this.pickColor(idx))
    }

    // Size.
    this.sizeText = addLabel(this.root, new vec3(0, G_SIZE_LABEL_Y, 0.2), "Size", G_SIZE_LABEL_SIZE, LABEL_DIM_COL)
    addFlatShape(this.root, uiQuad(), new vec3(0, G_SIZE_Y, 0.2), new vec3(2 * G_SIZE_HALF, G_SIZE_TRACK, 1), new vec4(1, 1, 1, 0.3))
    this.knob = global.scene.createSceneObject("GemSizeKnob")
    this.knob.setParent(this.root)
    this.knob.getTransform().setLocalPosition(new vec3(0, G_SIZE_Y, 0.4))
    addFlatShape(this.knob, uiDisc(), vec3.zero(), new vec3(G_SIZE_KNOB_R, G_SIZE_KNOB_R, 1), new vec4(0.12, 0.14, 0.19, 0.95))
    addFlatShape(this.knob, buildRing(1 - G_SIZE_KNOB_RING / G_SIZE_KNOB_R, 40), new vec3(0, 0, 0.1), new vec3(G_SIZE_KNOB_R, G_SIZE_KNOB_R, 1), ACCENT_VIOLET)
    // The drag target is the whole track, so a grab anywhere along it works.
    const sizeHit = global.scene.createSceneObject("GemSizeHit")
    sizeHit.setParent(this.root)
    sizeHit.getTransform().setLocalPosition(new vec3(0, G_SIZE_Y, 0.4))
    const col = sizeHit.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = G_SIZE_HIT
    col.shape = shape
    col.fitVisual = false
    this.sizeInteractable = sizeHit.createComponent(Interactable.getTypeName()) as Interactable
    this.sizeInteractable.targetingMode = 3

    // Undo, Clear. Pass 35: glyphs on the same two pills, at the same two centres, with
    // the same two grab boxes; classic keeps the words.
    const undo = addFlatShape(this.root, uiRoundRect(G_BTN_W, G_BTN_H, G_BTN_H / 2), new vec3(0, G_UNDO_Y, 0.2), new vec3(1, 1, 1), G_BTN_FILL)
    if (GLASS) addUndoGlyph(undo, new vec3(0, 0, 0.1), G_BTN_ICON_K, LABEL_COL)
    else addLabel(undo, new vec3(0, 0, 0.1), "Undo last", G_BTN_LABEL, LABEL_COL)
    this.addHit(undo, new vec3(G_BTN_W, G_BTN_H, G_HIT_DEPTH), () => this.hooks.onUndo())
    this.clearBody = addFlatShape(this.root, uiRoundRect(G_BTN_W, G_BTN_H, G_BTN_H / 2), new vec3(0, G_CLEAR_Y, 0.2), new vec3(1, 1, 1), G_BTN_FILL)
    if (GLASS) {
      // The bin's lid and handle are kept: with no word to change, tipping the lid open is
      // how the armed state says "the next tap does it".
      this.binLid = addBinGlyph(this.clearBody, new vec3(0, 0, 0.1), G_BTN_ICON_K, LABEL_COL)
    } else {
      this.clearLabel = addLabel(this.clearBody, new vec3(0, 0, 0.1), G_CLEAR_WORD, G_BTN_LABEL, LABEL_COL)
    }
    this.addHit(this.clearBody, new vec3(G_BTN_W, G_BTN_H, G_HIT_DEPTH), () => this.tapClear())

    this.setSize(GEM_SIZE_INIT)
  }

  private addHit(obj: SceneObject, size: vec3, fn: () => void): void {
    const col = obj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = size
    col.shape = shape
    col.fitVisual = false
    const inter = obj.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3
    this.interactables.push({ inter, fn })
  }
}
