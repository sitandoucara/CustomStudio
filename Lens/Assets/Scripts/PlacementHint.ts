// PlacementHint — "nothing was placed, and here is why" (Pass 22).
//
// ===========================================================================
// WHY A REFUSAL NEEDS A FACE
// ===========================================================================
// StickerSystem.placeArt now refuses to place a sticker when the panel that would
// receive it is not LIVE — turned past PANEL_FACING_MIN, so that a tap on a tray
// thumbnail would land the artwork on cloth the camera cannot see. A tote turned round
// to its back is the plain case: its one print surface is the front, and a tap used to
// stamp a daisy onto the unseen side and appear to do nothing at all.
//
// A refusal that is silent is indistinguishable from a tap that did not register, and
// the user's next move is to tap again, harder. So the refusal SAYS SO, on screen, where
// the sticker was going to appear: a dark pill over the garment's lower body, two lines
// of type — "Nothing placed" and what to do about it — that hold for HINT_HOLD_S and
// fade out over HINT_FADE_S. It is built from the same plate, rim, pill and label
// vocabulary as the tool switch and the garment buttons, so it reads as the composition
// speaking rather than as a system alert.
//
// It is chrome: UI layer, never in a photograph, depth test off, at the composition's
// constant depth (HINT_Z is GB_Z is the platform's z, -110) so it draws over whatever
// the garment is doing without being anywhere else in space.

import { LAYERS, setLayerDeep } from "./Layers"
import { DEBUG_HINT_STICKY } from "./Stickers"
import {
  addFlatShape, addLabel, setShapeColor, uiDisc, uiQuad, uiRoundRect,
  PLATE_COL, RIM_COL, LABEL_COL, LABEL_DIM_COL, GLASS_RIM, GLASS_R,
  setTextColor, // Pass 43
} from "./PhotoUi"
import { GLASS } from "./UiTheme"

// --- Placement -----------------------------------------------------------------
// Over the garment's LOWER body, centred: below where a new sticker lands (every home is
// at or above the garment's middle), above the platform's top edge at -16.85, and clear
// of the selection frame of anything already placed at the usual heights.
export const HINT_Y = -10.6
export const HINT_Z = -110 // the composition's constant depth, as GB_Z and the platform

// --- The pill ------------------------------------------------------------------
const HINT_W = 24.0 // full width
const HINT_H = 5.6 // full height — two lines of type
const HINT_CAP_R = HINT_H / 2
const HINT_RIM_PAD = 0.5 // the soft lit rim past the body, as on every plate
const HINT_TITLE_SIZE = 54 // "Nothing placed" — a step above the tool switch's 46, it is the message
const HINT_DETAIL_SIZE = 42 // the remedy, a step down and dimmer
const HINT_TITLE_DY = 1.0
const HINT_DETAIL_DY = -1.05
const HINT_TEXT_Z = 0.2

// --- Timing --------------------------------------------------------------------
export const HINT_HOLD_S = 1.8 // fully visible for this long after the refusal
export const HINT_FADE_S = 0.5 // then fades out over this long

function withAlpha(c: vec4, a: number): vec4 {
  return new vec4(c.x, c.y, c.z, c.w * a)
}

export class PlacementHint {
  private root: SceneObject
  private rim: SceneObject
  private fills: SceneObject[] = []
  private title: Text
  private detail: Text
  private timeLeft = 0

  constructor(parent: SceneObject) {
    this.root = global.scene.createSceneObject("PlacementHint")
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(0, HINT_Y, HINT_Z))

    const quad = uiQuad()
    const disc = uiDisc()
    const bodyW = HINT_W - HINT_H
    if (GLASS) {
      // Pass 24: the same glass panel as every other surface — a rounded rectangle with a
      // hairline rim — in the pill's footprint. Same words, same place, same timing.
      this.rim = addFlatShape(this.root, uiRoundRect(HINT_W + 2 * GLASS_RIM, HINT_H + 2 * GLASS_RIM, GLASS_R + GLASS_RIM),
        new vec3(0, 0, -0.2), new vec3(1, 1, 1), RIM_COL)
      this.fills.push(addFlatShape(this.root, uiRoundRect(HINT_W, HINT_H, GLASS_R), new vec3(0, 0, -0.1), new vec3(1, 1, 1), PLATE_COL))
    } else {
      this.rim = addFlatShape(this.root, quad, new vec3(0, 0, -0.2),
        new vec3(bodyW + HINT_RIM_PAD, HINT_H + HINT_RIM_PAD, 1), RIM_COL)
      this.fills.push(addFlatShape(this.root, quad, new vec3(0, 0, -0.1),
        new vec3(bodyW, HINT_H, 1), PLATE_COL))
      this.fills.push(addFlatShape(this.root, disc, new vec3(-bodyW / 2, 0, -0.1),
        new vec3(HINT_CAP_R, HINT_CAP_R, 1), PLATE_COL))
      this.fills.push(addFlatShape(this.root, disc, new vec3(bodyW / 2, 0, -0.1),
        new vec3(HINT_CAP_R, HINT_CAP_R, 1), PLATE_COL))
    }
    this.title = addLabel(this.root, new vec3(0, HINT_TITLE_DY, HINT_TEXT_Z), "", HINT_TITLE_SIZE, LABEL_COL)
    this.detail = addLabel(this.root, new vec3(0, HINT_DETAIL_DY, HINT_TEXT_Z), "", HINT_DETAIL_SIZE, LABEL_DIM_COL)

    setLayerDeep(this.root, LAYERS.ui) // chrome: on screen, never in a photograph
    this.root.enabled = false
  }

  /** Put the hint up, fully opaque, and start its clock again. */
  show(title: string, detail: string): void {
    this.title.text = title
    this.detail.text = detail
    this.timeLeft = HINT_HOLD_S + HINT_FADE_S
    this.applyAlpha(1)
    this.root.enabled = true
  }

  /** Take it down at once — a garment switch, for instance, makes its advice stale. */
  hide(): void {
    this.timeLeft = 0
    this.root.enabled = false
  }

  isVisible(): boolean {
    return this.root.enabled
  }

  /** Per-frame: hold, then fade, then disappear. */
  update(dt: number): void {
    if (!this.root.enabled) return
    if (DEBUG_HINT_STICKY) return // verification: hold the hint for a capture
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      this.hide()
      return
    }
    this.applyAlpha(Math.min(1, this.timeLeft / HINT_FADE_S))
  }

  private applyAlpha(a: number): void {
    setShapeColor(this.rim, withAlpha(RIM_COL, a))
    for (const o of this.fills) setShapeColor(o, withAlpha(PLATE_COL, a))
    setTextColor(this.title, withAlpha(LABEL_COL, a)) // Pass 43
    setTextColor(this.detail, withAlpha(LABEL_DIM_COL, a))
  }
}
