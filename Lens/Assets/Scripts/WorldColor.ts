/**
 * WorldColor — Pass 31. A colour picked from the REAL WORLD through the device camera.
 *
 * 1. THE CAMERA (probe, step 1 of the brief). `CameraModule.requestCamera` returns a live
 *    texture in Preview — 1392 x 1590 at full size, a new frame every tick, readable with
 *    ProceduralTextureProvider.createFromTexture + getPixels, and fed by the simulated
 *    environment. `requestImage` is rejected in Preview ("Image request not supported"),
 *    so the continuous texture is the only path, and it is the one used.
 *
 * 2. THE GESTURE: ARM, AIM, CONFIRM. The dropper chip in a panel opens this overlay, which
 *    takes the viewport (the same mechanism as the photo view) so the garment and every
 *    panel leave the frame and the world is what you see. A reticle sits at the centre of
 *    the view; you aim by looking — the sampled patch is always the centre of the camera
 *    frame; the swatch beside the reticle shows the average of that patch live, with its
 *    hex; "Use colour" applies it to the target the chip named (garment or brush), "Cancel"
 *    applies nothing. Not "one tap on the world": the hand ray has nothing to target in
 *    the world, and a tap that lands on the wrong thing would be a blind pick, which is the
 *    failure mode the brief names. Arming first also removes the garment from the centre
 *    of the view, which is exactly where you need to look through.
 *
 * 3. THE PATCH. One pixel is sensor noise; the patch is PICK_PATCH_FRAC of the frame's
 *    width (3.5%: 10 px on the ~280 px frame requested here, about 2.5 degrees of view —
 *    a coin at arm's length), averaged, every PICK_SAMPLE_EVERY frames. The frame is
 *    requested small (PICK_FRAME_SMALL) so the copy that makes it readable is a few
 *    hundred kilobytes, not nine megabytes, ten times a second.
 *
 * 4. COLOUR SPACE. The camera's bytes are treated exactly as the slider's own colours: a
 *    vec4 of r/255, g/255, b/255 that goes to the swatch, the hex and the garment through
 *    the same applyColor path. The swatch you confirm is therefore, by construction, the
 *    colour the garment is given — the Pass 27 guarantee, kept.
 */

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { buildRing } from "./Geo"
import { LAYERS, ViewportLayers, setLayerDeep } from "./Layers"
import {
  addFlatShape,
  addLabel,
  setShapeColor,
  uiDisc,
  uiQuad,
  uiRoundRect,
  addHeadPill,
  addBackCircle,
  BACK_CIRCLE_POS,
  HEAD_Y,
  HEAD_SUB_DY,
  HEAD_SUB_SIZE,
  ACCENT_VIOLET,
  ACCENT_FILL,
  LABEL_COL,
  LABEL_DIM_COL,
  PLATE_COL,
  RIM_COL,
} from "./PhotoUi"

const cameraModule = require("LensStudio:CameraModule") as CameraModule

// --- the camera and the patch --------------------------------------------------------
export const PICK_FRAME_SMALL = 320 // imageSmallerDimension asked of the camera
export const PICK_PATCH_FRAC = 0.035 // side of the averaged square, as a fraction of frame width
export const PICK_SAMPLE_EVERY = 3 // frames between two readings of the patch

// --- the overlay -------------------------------------------------------------------------
const OV_Z = -100
const OV_BLOCK_Z = -101
const OV_BLOCK_SIZE = 300
// Pass 32 (Refs/ui_picker): head pill with the palette icon, one subtitle in the accent that
// also names the target, a round Back button instead of a Cancel pill, the reticle's inner
// disc filled with the live colour, and "Use colour" alone at the bottom.
const OV_TITLE = "Pick a colour"
const OV_SUBTITLE = "Point at any surface around you"
const OV_TARGET_GARMENT = "for the garment"
const OV_TARGET_BRUSH = "for the brush"
const OV_TARGET_GEMS = "for the gems" // Pass 41: the third caller
const OV_SUB_SEP = "  ·  "
const RETICLE_R = 2.2 // outer ring
const RETICLE_T = 0.12
const RETICLE_INNER_R = 1.4 // roughly the sampled patch on screen
const RETICLE_INNER_T = 0.1
const RETICLE_TICK_LEN = 0.9
const RETICLE_TICK_T = 0.1
const RETICLE_TICK_GAP = 0.5
const RETICLE_COL = new vec4(1, 1, 1, 0.92)
const RETICLE_FILL_R = 1.25 // the inner disc, filled with the live colour
const RETICLE_FILL_A = 0.62
const OV_SWATCH_POS = new vec3(6.2, 0.6, OV_Z)
const OV_SWATCH_R = 1.6
const OV_SWATCH_RING = 0.14
const OV_HEX_DY = -2.9
const OV_HEX_SIZE = 36
const OV_SWATCH_EMPTY = new vec4(0.5, 0.5, 0.55, 1)
const OV_PILL_Y = -20.0
const OV_PILL_W = 13.0 // Pass 33: the wide-button family, one and a half times over
const OV_PILL_H = 3.8
const OV_PILL_R = 1.9
const OV_PILL_RIM = 0.16
const OV_PILL_HIT = new vec3(15.0, 4.7, 3)
const OV_PILL_WORD_SIZE = 38
const OV_CONFIRM_WORD = "Use colour"

export type PickTarget = "garment" | "brush" | "gems" // Pass 41: "gems" — the gem panel's dropper

export interface WorldColorHooks {
  /** A colour was confirmed for `target`. */
  onPicked: (color: vec4, target: PickTarget) => void
  /** The overlay closed, confirmed or cancelled (verification pacing). */
  onClosed?: () => void
}

export function hexOf(c: vec4): string {
  const h = (x: number): string => {
    const n = Math.max(0, Math.min(255, Math.round(x * 255)))
    return (n < 16 ? "0" : "") + n.toString(16).toUpperCase()
  }
  return "#" + h(c.x) + h(c.y) + h(c.z)
}

export class WorldColorPicker {
  private root!: SceneObject
  private targetText!: Text
  private swatchDisc!: SceneObject
  private reticleFill!: SceneObject
  private hexText!: Text
  private confirmInteractable!: Interactable
  private cancelInteractable!: Interactable
  private blockInteractable!: Interactable

  private tex: Texture | null = null
  private cameraTried = false
  private opened = false
  private target: PickTarget = "garment"
  private live: vec4 | null = null
  private frame = 0
  private sizePrinted = false
  private headLocked = false

  constructor(parent: SceneObject, private viewport: ViewportLayers, private hooks: WorldColorHooks) {
    this.build(parent)
  }

  /** Bind SIK events — OnStart, like every other control here. */
  init(): void {
    this.confirmInteractable.onTriggerEnd.add(() => this.confirm())
    this.cancelInteractable.onTriggerEnd.add(() => this.cancel())
  }

  isOpen(): boolean {
    return this.opened
  }

  /** Arm: take the frame, start reading the patch. */
  open(target: PickTarget): void {
    if (this.opened) return
    this.ensureCamera()
    this.lockToHead()
    this.target = target
    this.targetText.text = OV_SUBTITLE + OV_SUB_SEP + (target === "garment" ? OV_TARGET_GARMENT : target === "gems" ? OV_TARGET_GEMS : OV_TARGET_BRUSH)
    this.live = null
    setShapeColor(this.swatchDisc, OV_SWATCH_EMPTY)
    setShapeColor(this.reticleFill, new vec4(OV_SWATCH_EMPTY.x, OV_SWATCH_EMPTY.y, OV_SWATCH_EMPTY.z, RETICLE_FILL_A))
    this.hexText.text = "…"
    this.opened = true
    this.root.enabled = true
    this.viewport.take(LAYERS.photo)
  }

  /** Confirm: the live average goes to the target. Nothing sampled yet -> stays open. */
  confirm(): void {
    if (!this.opened || !this.live) return
    const c = this.live
    print("[PICK] " + this.target + " " + hexOf(c) + " rgb(" + Math.round(c.x * 255) + "," + Math.round(c.y * 255) + "," + Math.round(c.z * 255) + ")")
    this.close()
    this.hooks.onPicked(new vec4(c.x, c.y, c.z, 1), this.target)
  }

  cancel(): void {
    if (!this.opened) return
    print("[PICK] cancelled")
    this.close()
  }

  private close(): void {
    this.opened = false
    this.root.enabled = false
    this.viewport.release()
    if (this.hooks.onClosed) this.hooks.onClosed()
  }

  /**
   * The overlay follows the head: the reticle must sit at the centre of the VIEW, which is
   * the centre of the camera frame, wherever you look — unlike every other panel here,
   * which is world-locked in front of where you started. Parented under the scene camera
   * on first open (the camera is bound by then), at the same local depth as the panels.
   */
  private lockToHead(): void {
    if (this.headLocked) return
    const cam = this.viewport.getCamera()
    if (!cam) return
    this.root.setParent(cam.getSceneObject())
    const tf = this.root.getTransform()
    tf.setLocalPosition(vec3.zero())
    tf.setLocalRotation(quat.quatIdentity())
    tf.setLocalScale(vec3.one())
    this.headLocked = true
  }

  /** Per frame while open: read the patch and show it. */
  update(): void {
    if (!this.opened) return
    this.frame++
    if (this.frame % PICK_SAMPLE_EVERY !== 0) return
    const c = this.sample()
    if (!c) return
    this.live = c
    setShapeColor(this.swatchDisc, c)
    setShapeColor(this.reticleFill, new vec4(c.x, c.y, c.z, RETICLE_FILL_A))
    this.hexText.text = hexOf(c)
  }

  /** The current live reading (verification). */
  debugLive(): vec4 | null {
    return this.live
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  private ensureCamera(): void {
    if (this.cameraTried) return
    this.cameraTried = true
    try {
      const req = CameraModule.createCameraRequest()
      req.cameraId = CameraModule.CameraId.Default_Color
      try { (req as any).imageSmallerDimension = PICK_FRAME_SMALL } catch (_e) { /* ignore */ }
      this.tex = cameraModule.requestCamera(req)
    } catch (e) {
      print("[PICK] camera unavailable: " + e)
      this.tex = null
    }
  }

  /** The average of the centre patch, or null before the first frame arrives. */
  private sample(): vec4 | null {
    if (!this.tex) return null
    const w = this.tex.getWidth()
    const h = this.tex.getHeight()
    if (w < 4 || h < 4) return null
    if (!this.sizePrinted) {
      this.sizePrinted = true
      print("[PICK] camera frame " + w + "x" + h + ", patch " + Math.max(2, Math.round(PICK_PATCH_FRAC * w)) + " px")
    }
    try {
      const copy = ProceduralTextureProvider.createFromTexture(this.tex)
      const ctrl = copy.control as ProceduralTextureProvider
      const s = Math.max(2, Math.round(PICK_PATCH_FRAC * w))
      const x0 = Math.max(0, Math.floor(w / 2 - s / 2))
      const y0 = Math.max(0, Math.floor(h / 2 - s / 2))
      const buf = new Uint8Array(s * s * 4)
      ctrl.getPixels(x0, y0, s, s, buf)
      let r = 0, g = 0, b = 0
      const n = s * s
      for (let i = 0; i < n; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2] }
      return new vec4(r / n / 255, g / n / 255, b / n / 255, 1)
    } catch (e) {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------

  private build(parent: SceneObject): void {
    this.root = global.scene.createSceneObject("WorldColorPicker")
    this.root.setParent(parent)

    // Input blocker, as the photo view's: nothing underneath can be touched while aiming.
    const blocker = global.scene.createSceneObject("PickBlocker")
    blocker.setParent(this.root)
    blocker.getTransform().setLocalPosition(new vec3(0, 0, OV_BLOCK_Z))
    const bcol = blocker.createComponent("Physics.ColliderComponent") as ColliderComponent
    const bshape = Shape.createBoxShape()
    bshape.size = new vec3(OV_BLOCK_SIZE, OV_BLOCK_SIZE, 3)
    bcol.shape = bshape
    bcol.fitVisual = false
    this.blockInteractable = blocker.createComponent(Interactable.getTypeName()) as Interactable
    this.blockInteractable.targetingMode = 3

    addHeadPill(this.root, new vec3(0, HEAD_Y, OV_Z), OV_TITLE, "palette", null, true)
    this.targetText = addLabel(this.root, new vec3(0, HEAD_Y + HEAD_SUB_DY, OV_Z), OV_SUBTITLE, HEAD_SUB_SIZE, ACCENT_VIOLET, HorizontalAlignment.Center, true)
    const back = addBackCircle(this.root, BACK_CIRCLE_POS, true)
    this.cancelInteractable = back.getComponent(Interactable.getTypeName()) as Interactable

    // The reticle: two rings and four ticks at the centre of the view.
    const quad = uiQuad()
    const disc = uiDisc()
    const centre = new vec3(0, 0, OV_Z)
    addFlatShape(this.root, buildRing(1 - RETICLE_T / RETICLE_R, 64), centre, new vec3(RETICLE_R, RETICLE_R, 1), RETICLE_COL, 0, true)
    addFlatShape(this.root, buildRing(1 - RETICLE_INNER_T / RETICLE_INNER_R, 48), centre, new vec3(RETICLE_INNER_R, RETICLE_INNER_R, 1), ACCENT_VIOLET, 0, true)
    this.reticleFill = addFlatShape(this.root, disc, new vec3(0, 0, OV_Z - 0.05), new vec3(RETICLE_FILL_R, RETICLE_FILL_R, 1), new vec4(0.5, 0.5, 0.55, RETICLE_FILL_A), 0, true)
    const tickAt = RETICLE_R + RETICLE_TICK_GAP + RETICLE_TICK_LEN / 2
    addFlatShape(this.root, quad, new vec3(0, tickAt, OV_Z), new vec3(RETICLE_TICK_T, RETICLE_TICK_LEN, 1), RETICLE_COL, 0, true)
    addFlatShape(this.root, quad, new vec3(0, -tickAt, OV_Z), new vec3(RETICLE_TICK_T, RETICLE_TICK_LEN, 1), RETICLE_COL, 0, true)
    addFlatShape(this.root, quad, new vec3(tickAt, 0, OV_Z), new vec3(RETICLE_TICK_LEN, RETICLE_TICK_T, 1), RETICLE_COL, 0, true)
    addFlatShape(this.root, quad, new vec3(-tickAt, 0, OV_Z), new vec3(RETICLE_TICK_LEN, RETICLE_TICK_T, 1), RETICLE_COL, 0, true)

    // The live swatch beside it, with its hex.
    this.swatchDisc = addFlatShape(this.root, disc, OV_SWATCH_POS, new vec3(OV_SWATCH_R, OV_SWATCH_R, 1), OV_SWATCH_EMPTY, 0, true)
    addFlatShape(this.root, buildRing(1 - OV_SWATCH_RING / (OV_SWATCH_R + 0.2), 48), new vec3(OV_SWATCH_POS.x, OV_SWATCH_POS.y, OV_Z + 0.05),
      new vec3(OV_SWATCH_R + 0.2, OV_SWATCH_R + 0.2, 1), RIM_COL, 0, true)
    this.hexText = addLabel(this.root, new vec3(OV_SWATCH_POS.x, OV_SWATCH_POS.y + OV_HEX_DY, OV_Z), "…", OV_HEX_SIZE, LABEL_DIM_COL, HorizontalAlignment.Center, true)

    // Confirm and cancel pills.
    this.confirmInteractable = this.buildPill(new vec3(0, OV_PILL_Y, OV_Z), OV_CONFIRM_WORD, ACCENT_FILL, "PickConfirm")

    setLayerDeep(this.root, LAYERS.photo)
    this.root.enabled = false
  }

  private buildPill(pos: vec3, word: string, fill: vec4, name: string): Interactable {
    const pill = global.scene.createSceneObject(name)
    pill.setParent(this.root)
    pill.getTransform().setLocalPosition(pos)
    addFlatShape(pill, uiRoundRect(OV_PILL_W + 2 * OV_PILL_RIM, OV_PILL_H + 2 * OV_PILL_RIM, OV_PILL_R + OV_PILL_RIM), new vec3(0, 0, -0.1), new vec3(1, 1, 1), RIM_COL, 0, true)
    addFlatShape(pill, uiRoundRect(OV_PILL_W, OV_PILL_H, OV_PILL_R), vec3.zero(), new vec3(1, 1, 1), fill, 0, true)
    addLabel(pill, new vec3(0, 0, 0.2), word, OV_PILL_WORD_SIZE, LABEL_COL, HorizontalAlignment.Center, true)
    const col = pill.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = OV_PILL_HIT
    col.shape = shape
    col.fitVisual = false
    const inter = pill.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3
    return inter
  }
}

// ---------------------------------------------------------------------------------------
// The step-1 probe (DEBUG_CAMERA_PROBE): which camera paths work in Preview, with pixels.
// ---------------------------------------------------------------------------------------

const PROBE_PATCH = 8 // px, half side of the sampled square

export class CameraProbe {
  private tex: Texture | null = null
  private frames = 0
  private ticks = 0
  private imageTried = false

  constructor() {
    try {
      const req = CameraModule.createCameraRequest()
      req.cameraId = CameraModule.CameraId.Default_Color
      this.tex = cameraModule.requestCamera(req)
      print("[CAMPROBE] requestCamera ok: " + (this.tex ? "texture " + this.tex.getWidth() + "x" + this.tex.getHeight() : "null"))
      const ctrl = this.tex ? (this.tex.control as any) : null
      if (ctrl && ctrl.onNewFrame) {
        ctrl.onNewFrame.add(() => { this.frames++ })
        print("[CAMPROBE] control is " + ctrl.getTypeName() + ", onNewFrame bound")
      } else {
        print("[CAMPROBE] control has no onNewFrame: " + (ctrl ? ctrl.getTypeName() : "null"))
      }
    } catch (e) {
      print("[CAMPROBE] requestCamera threw: " + e)
    }
  }

  update(): void {
    this.ticks++
    if (this.ticks % 60 !== 0) return
    if (!this.imageTried) {
      this.imageTried = true
      try {
        const ireq = CameraModule.createImageRequest()
        const p: any = cameraModule.requestImage(ireq)
        p.then((frame: any) => {
          print("[CAMPROBE] requestImage resolved: " + (frame && frame.texture ? frame.texture.getWidth() + "x" + frame.texture.getHeight() : "no texture"))
        }).catch((e: any) => { print("[CAMPROBE] requestImage rejected: " + e) })
      } catch (e) {
        print("[CAMPROBE] requestImage threw: " + e)
      }
    }
    if (!this.tex) return
    const w = this.tex.getWidth()
    const h = this.tex.getHeight()
    let msg = "[CAMPROBE] tick " + this.ticks + " frames=" + this.frames + " size=" + w + "x" + h
    try {
      const copy = ProceduralTextureProvider.createFromTexture(this.tex)
      const ctrl = copy.control as ProceduralTextureProvider
      const cw = copy.getWidth()
      const ch = copy.getHeight()
      const s = PROBE_PATCH
      const spots: [string, number, number][] = [["centre", cw / 2, ch / 2], ["topleft", s + 2, s + 2], ["bottomright", cw - s - 2, ch - s - 2]]
      for (const [name, cx, cy] of spots) {
        const buf = new Uint8Array(4 * s * 2 * s * 2)
        ctrl.getPixels(Math.floor(cx - s), Math.floor(cy - s), 2 * s, 2 * s, buf)
        let r = 0, g = 0, b = 0, a = 0
        const n = 4 * s * s
        for (let i = 0; i < n; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2]; a += buf[i * 4 + 3] }
        msg += " " + name + "=(" + Math.round(r / n) + "," + Math.round(g / n) + "," + Math.round(b / n) + "," + Math.round(a / n) + ")"
      }
      msg += " copy=" + cw + "x" + ch
    } catch (e) {
      msg += " readback threw: " + e
    }
    print(msg)
  }
}
