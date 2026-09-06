// SockSelector — LEFT SOCK / RIGHT SOCK, the placement target for the pair (Pass 39).
//
// The socks are one garment with a bake target each (GarmentDef.printTargets), so a new
// sticker, stone or brush stroke lands on whichever sock the pointer's ray meets first —
// and near the middle, where the two feet sit a centimetre apart, that was a coin toss
// nothing on screen explained. This control names the sock that receives NEW content.
//
// TWO DECISIONS, and why:
//
//   DRAG STAYS FREE. The selector answers "where does a new thing go"; a drag is a direct
//   manipulation of a thing that already exists, and its destination is wherever the
//   finger is. A sticker that refused to follow the pointer onto the other sock, with no
//   visible reason, is exactly the stall-then-lurch this pass is removing. What the drag
//   DOES now require is that a hop onto the other sock be deliberate: the pointer must be
//   properly over it, not merely nearer to it than to anything else (StickerSystem.
//   dragToRay, rule 3) — the shin-to-instep sweep flickered onto the right sock's foot for
//   a step under the old proximity rule, and that is the coin toss again, mid-drag.
//
//   THE UNSELECTED SOCK IS UNMARKED, NOT DIMMED. Both socks stay fully interactive — a
//   sticker on either can be selected, dragged, resized — so dimming one would say
//   "disabled", which is false. The control carries the state; the garment is left alone,
//   as in Refs/ui_socks.
//
// Shown ONLY while the socks are the active garment; Left at boot.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { GLASS, pick } from "./UiTheme"
import { GlyphPart, SOCKS_GLYPH, SOCKS_SIDE_TARGET } from "./Garments"
import { LAYERS, setLayerDeep } from "./Layers"
import {
  addFlatShape, addGradientShape, addGlassPanel, addLabel, setShapeColor, uiDisc, uiQuad, uiRoundRect,
  ACCENT_FILL, ACCENT_GLOW, LABEL_COL, PLATE_COL, RIM_COL,
  setTextColor, // Pass 43
} from "./PhotoUi"
import { GB_BOTTOM_Y, GB_Z } from "./GarmentButtons"

/** The two SIDES of the screen, as the viewer sees the pair at yaw 0. Targets come from SOCKS_SIDE_TARGET. */
export const SOCK_LEFT = 0
export const SOCK_RIGHT = 1
export const SOCK_INIT = SOCK_LEFT

// --- Where it sits, and how big: measured off Refs/ui_socks (Pass 40) ----------------------
// The reference was measured rather than eyeballed, at the one scale the two images share
// — the garment pill, 65 px there and 3.6 cm here (0.0554 cm/px):
//     selector pill      58 px  -> 3.2 cm   (0.89 of the garment pill; Pass 39 had 3.0)
//     selector plate     70 px  -> 3.9 cm   (only 6 px past its pill each side: 0.35 cm.
//                                          Pass 39 padded 0.7, making a 4.4 plate as thick
//                                          as the garment row's — THAT is what read as thick)
//     gap, plate to plate 20 px -> 1.1 cm   (Pass 39: 0.6, which read as glued on)
//     strip width        ~0.78 of the garment row
// The socks' paint plane shadows y +/-10.5 at the controls' depth ([PAINT-PLANE] socks).
// With the plate hanging 1.1 under the garment row's (bottom at GB_Y - 2.2 = 17.4) the
// grab boxes run 12.3..16.4: 1.8 cm clear of the shadow (was 2.8), 1.0 clear of the row.
// Pass 41: a little shorter again. The pill drops 3.2 -> 2.8 (the plate with it, 3.9 -> 3.5);
// the width, the 1.1 gap under the garment row and the 0.35 plate pad are unchanged, and
// the grab boxes KEEP their Pass-40 height (SS_HIT_H, 4.1) rather than shrinking with the
// pill — they run 12.5..16.6, still 0.8 clear of the garment row's boxes (bottom 17.4) and
// 2.0 clear of the socks' paint-plane shadow (+/-10.5).
export const SS_GAP = pick(1.3, 1.1)
export const SS_H = pick(3.4, 2.8)
const SS_HIT_H = pick(SS_H + 0.9, 4.1) // the grab box's height: generous, and not tied to the pill
export const SS_PLATE_PAD = pick(0.825, 0.35)
// PASS 45: the garment row is now a box at the top of the RIGHT column (GarmentButtons,
// Refs/new_ui), with the sticker tray 1.0 cm under it — there is no room in the column for
// this strip (18.7 wide, 3.5 tall). So it keeps its place over the socks at the top centre
// and follows the row VERTICALLY: its plate's top edge hangs the same 1.1 cm (SS_GAP)
// under the garment box's bottom edge (GB_BOTTOM_Y) that it hung under the old row's.
export const SS_Y = GB_BOTTOM_Y - SS_GAP - SS_PLATE_PAD - SS_H / 2
export const SS_Z = GB_Z
const SS_HALF_W = pick(7.2, 9.0) // one half's width
const SS_HALF_GAP = 0.35
const SS_PLATE_R = SS_H / 2 + SS_PLATE_PAD
const SS_PILL_R = pick(SS_H / 2, Math.min(1.5, SS_H / 2)) // never past the half-height, or the corners cross
const SS_GLYPH_R = pick(1.05, 1.0)
const SS_GLYPH_X = -SS_HALF_W / 2 + 1.7 // the glyph's centre, from the half's left edge
const SS_WORD_X = 0.55 // the word's centre
const SS_WORD_SIZE = 36
const SS_DOT_R = 0.24 // the small "selected" dot at the pill's right end (Refs/ui_socks)
const SS_DOT_X = SS_HALF_W / 2 - 1.0
/** Grab box: a hair under the pitch, so the two halves never overlap (audit); taller than the pill. */
const SS_HIT = new vec3(SS_HALF_W + SS_HALF_GAP - 0.1, SS_HIT_H, 3)
const SS_WORDS = ["Left Sock", "Right Sock"]
// Colours: the garment row's own on/off language.
const SS_ON_GLYPH = pick(new vec4(0.10, 0.13, 0.18, 1.0), new vec4(0.98, 0.98, 1.0, 1.0))
const SS_OFF_GLYPH = new vec4(0.92, 0.95, 1.0, 0.62)
const SS_ON_FILL = pick(new vec4(0.86, 0.92, 1.0, 0.96), new vec4(1, 1, 1, 1))
const SS_OFF_FILL = pick(new vec4(0.14, 0.16, 0.21, 0.9), new vec4(0, 0, 0, 0))
const SS_ON_WORD = pick(new vec4(0.10, 0.13, 0.18, 1.0), LABEL_COL)
const SS_OFF_WORD = new vec4(1, 1, 1, 0.55)

interface Half {
  root: SceneObject
  fills: SceneObject[]
  glyphs: SceneObject[]
  word: Text
  dot: SceneObject
  interactable: Interactable
}

export class SockSelector {
  private root!: SceneObject
  private halves: Half[] = []
  private selected = SOCK_INIT
  private onPick: (side: number) => void

  constructor(parent: SceneObject, onPick: (side: number) => void) {
    this.onPick = onPick
    this.build(parent)
  }

  /** Bind the SIK subscriptions. Called from OnStartEvent, where they must live. */
  init(): void {
    for (let i = 0; i < this.halves.length; i++) {
      const side = i
      this.halves[i].interactable.onTriggerEnd.add(() => this.onPick(side))
    }
    this.applySelection()
  }

  /** Which sock reads as selected. Driven by the caller after the placer has been told. */
  setSelected(side: number): void {
    if (side !== SOCK_LEFT && side !== SOCK_RIGHT) return
    this.selected = side
    this.applySelection()
  }

  /** The selected SIDE (SOCK_LEFT / SOCK_RIGHT). */
  getSelected(): number { return this.selected }
  /** The bake target new content goes to: the selected side, through the measured table. */
  getSelectedTarget(): number { return SOCKS_SIDE_TARGET[this.selected] }

  /** Shown only while the socks are the active garment. */
  setVisible(on: boolean): void {
    if (this.root.enabled !== on) this.root.enabled = on
  }

  /** Verification entry point: the same call a press makes. */
  debugPick(side: number): void { this.onPick(side) }

  // ---------------------------------------------------------------------------

  private build(parent: SceneObject): void {
    this.root = global.scene.createSceneObject("SockSelector")
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(0, SS_Y, SS_Z))

    const disc = uiDisc()
    const quad = uiQuad()
    const rowW = 2 * SS_HALF_W + SS_HALF_GAP
    const plateRx = rowW / 2 + SS_PLATE_PAD
    if (GLASS) {
      addGlassPanel(this.root, new vec3(0, 0, 0), 2 * plateRx, SS_H + 2 * SS_PLATE_PAD, SS_PLATE_R)
    } else {
      addFlatShape(this.root, disc, new vec3(0, 0, -0.1), new vec3(plateRx + 0.3, SS_H / 2 + SS_PLATE_PAD + 0.3, 1), RIM_COL)
      addFlatShape(this.root, disc, new vec3(0, 0, 0), new vec3(plateRx, SS_H / 2 + SS_PLATE_PAD, 1), PLATE_COL)
    }

    const x0 = -(SS_HALF_W + SS_HALF_GAP) / 2
    for (let i = 0; i < 2; i++) this.halves.push(this.makeHalf(i, x0 + i * (SS_HALF_W + SS_HALF_GAP), disc, quad))

    setLayerDeep(this.root, LAYERS.ui)
    this.root.enabled = false
  }

  private makeHalf(side: number, x: number, disc: RenderMesh, quad: RenderMesh): Half {
    const root = global.scene.createSceneObject("SockHalf_" + (side === SOCK_LEFT ? "L" : "R"))
    root.setParent(this.root)
    root.getTransform().setLocalPosition(new vec3(x, 0, 0.15))

    const fills: SceneObject[] = []
    if (GLASS) {
      fills.push(addFlatShape(root, uiRoundRect(SS_HALF_W + 0.5, SS_H + 0.5, SS_PILL_R + 0.25),
        new vec3(0, 0, -0.05), new vec3(1, 1, 1), new vec4(ACCENT_GLOW.x, ACCENT_GLOW.y, ACCENT_GLOW.z, 0)))
      fills.push(addGradientShape(root, uiRoundRect(SS_HALF_W, SS_H, SS_PILL_R), new vec3(0, 0, 0), new vec3(1, 1, 1), SS_OFF_FILL))
    } else {
      fills.push(addFlatShape(root, quad, new vec3(0, 0, 0), new vec3(SS_HALF_W - SS_H, SS_H, 1), SS_OFF_FILL))
      fills.push(addFlatShape(root, disc, new vec3(-(SS_HALF_W - SS_H) / 2, 0, 0), new vec3(SS_H / 2, SS_H / 2, 1), SS_OFF_FILL))
      fills.push(addFlatShape(root, disc, new vec3((SS_HALF_W - SS_H) / 2, 0, 0), new vec3(SS_H / 2, SS_H / 2, 1), SS_OFF_FILL))
    }

    // The sock glyph, from the garment's own definition — mirrored for the right sock so
    // the two toes point away from each other, the way the pair sits on the turntable.
    const glyphs: SceneObject[] = []
    const mirror = side === SOCK_RIGHT ? -1 : 1
    for (const g of SOCKS_GLYPH as GlyphPart[]) {
      const mesh = g.shape === "disc" ? disc : quad
      const k = g.shape === "disc" ? 0.5 : 1.0
      glyphs.push(addFlatShape(root, mesh,
        new vec3(SS_GLYPH_X + mirror * g.x * SS_GLYPH_R, g.y * SS_GLYPH_R, 0.2),
        new vec3(g.w * SS_GLYPH_R * k, g.h * SS_GLYPH_R * k, 1), SS_OFF_GLYPH, 0))
    }
    const word = addLabel(root, new vec3(SS_WORD_X, 0, 0.2), SS_WORDS[side], SS_WORD_SIZE, SS_OFF_WORD, HorizontalAlignment.Center)
    const dot = addFlatShape(root, disc, new vec3(SS_DOT_X, 0, 0.2), new vec3(SS_DOT_R, SS_DOT_R, 1), SS_ON_GLYPH)
    dot.enabled = false

    const hit = global.scene.createSceneObject("SockHalfHit_" + (side === SOCK_LEFT ? "L" : "R"))
    hit.setParent(root)
    hit.getTransform().setLocalPosition(new vec3(0, 0, 0.4))
    const collider = hit.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = SS_HIT
    collider.shape = shape
    collider.fitVisual = false
    const interactable = hit.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = 3

    return { root, fills, glyphs, word, dot, interactable }
  }

  private applySelection(): void {
    for (let i = 0; i < this.halves.length; i++) {
      const on = i === this.selected
      const h = this.halves[i]
      for (let k = 0; k < h.fills.length; k++) {
        const halo = GLASS && k === 0
        setShapeColor(h.fills[k], halo ? (on ? ACCENT_GLOW : new vec4(0, 0, 0, 0)) : (on ? SS_ON_FILL : SS_OFF_FILL))
      }
      for (const g of h.glyphs) setShapeColor(g, on ? SS_ON_GLYPH : SS_OFF_GLYPH)
      setTextColor(h.word, on ? SS_ON_WORD : SS_OFF_WORD) // Pass 43
      h.dot.enabled = on
    }
  }
}
