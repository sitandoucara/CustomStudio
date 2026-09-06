// RotationPlatform — the slim plate under the shirt with a slide-to-rotate control (Pass 8).
//
// Reference: Refs/inspi — a dark, restrained plate sitting just under the hem, with a
// faint lit rim, a hairline horizontal track carrying evenly-spaced tick dots, and a
// single round button riding on the track. Dragging that button turns the shirt on its
// Y axis, live. Centre of the track is ALWAYS 0 deg (front-facing); the two ends are
// -180 and +180, so a full sweep either way brings the back of the shirt into view.
//
// Visual language matches the rest of the UI (dark translucent BackPlates + white type):
// near-black translucent plate, soft white rim, white-at-low-alpha track and ticks.
//
// Input path — the SAME one the color slider and the sticker drag already use: a raw SIK
// Interactable on a world-space box collider, driven by SIK's MouseInteractor in the
// Editor preview (mouse drag) and by hand pinch on device. Nothing here is screen-space,
// so there is no separate editor-only code path to maintain.
//
// Drag maths: the whole platform lives in ONE camera-facing plane at the shirt's depth,
// so we intersect the interactor's ray with that plane and read the X of the hit. The
// grab offset is captured on drag-start, so the button never jumps to the cursor — it
// follows it. Everything is a plain helper class (not a @component), constructed and
// ticked by ScarfCustomizer, exactly like ScarfController and AmbientParticles.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { DragInteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event"
import { buildUnitQuad } from "./StickerCompositor"
import { buildDisc, buildRing, buildTriangle } from "./Geo"
import { SHIRT_YAW_RANGE_DEG } from "./Stickers"
import { GLASS, caption, pick } from "./UiTheme"
import { addLabel, uiRoundRect, addTurntable, TABLE_WORLD_Y, TABLE_WORLD_Z, ACCENT_VIOLET, ACCENT_GLOW, GLASS_RIM, RIM_COL as GLASS_RIM_COL } from "./PhotoUi"
import { uiFlatPass, stackVisual } from "./PhotoUi" // Pass 43

const MOTE_MAT = requireAsset("../Materials/MoteMaterial.mat") as Material // unlit, base-tex OFF -> solid baseColor

// --- Placement (world cm). The shirt is fit to 30 cm tall centred on the GarmentRoot
// origin, so its hem sits near y = -15; the plate tucks just below that at the same
// constant depth the rest of the composition uses.
const PLATFORM_Y = pick(-18.9, -21.3) // the TRACK's height. Pass 33 (glass): level with the midpoint of the stacked buttons (-19.0, -23.6). The drag is root-local, so it follows.
// Pass 25: the glass panel is a SLIM BAR, as in the reference — 28.4 x 4.6, the caption on
// its own line above the track. The track height, the knob and its 6 x 6 grab box are
// unchanged; the wide buttons at x +/-21.4 clear the bar's ends by 2.4 cm.
const PLATE_RX = pick(16.2, 14.2) // plate half-width (Pass 9: smaller footprint)
const PLATE_RY = pick(2.05, 2.3) // plate half-height (Pass 9: thinner; glass: a line for the label)
const RIM_PAD = pick(0.3, GLASS_RIM) // how far the soft rim extends past the plate body
// Pass 24 (glass): the plate is a rounded rectangle whose centre sits a little ABOVE the
// track, so the "ROTATION" caption has a line to itself and the track keeps its height.
const PLATE_DY = pick(0.0, 0.55)
const PLATE_R = 2.6
const LABEL_Y = 1.6
const LABEL_SIZE = 30
// The turntable under the garment (glass only) lives in PhotoUi since Pass 30 (TABLE_*).

// --- Track + button. Pass 9 shrinks what you SEE, not what you can press: the visible
// chip drops from 2.55 cm to BTN_R below, while BTN_HIT keeps the grab area a
// comfortable ~6 cm box, so the control reads as discreet but stays easy to catch.
const TRACK_HALF = 11.4 // half the button's travel, in cm; maps to +/- SHIRT_YAW_RANGE_DEG
const TRACK_BAR = 0.09 // hairline track
const TICK_COUNT = 13 // tick dots along the track (odd, so one sits exactly on centre)
const TICK_R = 0.16 // tick dot radius
const BTN_R = 1.45 // VISIBLE button radius
const BTN_HIT = 6.0 // full width/height of the button's (invisible) grab box
const BTN_RING = 0.11 // button ring stroke thickness
const GLYPH_R = 0.74 // rotate-glyph arc radius inside the button
const GLYPH_BAR = 0.1 // rotate-glyph arc stroke thickness

// --- Colors (restrained: near-black plate, soft white detail; Pass 9 softens them all)
const PLATE_COL = new vec4(0.055, 0.06, 0.08, 0.88)
const RIM_COL = new vec4(0.72, 0.79, 0.9, 0.2)
const TRACK_COL = new vec4(1.0, 1.0, 1.0, 0.22)
const TICK_COL = new vec4(1.0, 1.0, 1.0, 0.36)
const BTN_FILL = new vec4(0.12, 0.14, 0.19, 0.95)
const BTN_EDGE = pick(new vec4(0.9, 0.94, 0.99, 0.95), ACCENT_VIOLET) // bright rim keeps it reading as grabbable
const BTN_GLOW_R = BTN_R + 0.55 // glass: the soft violet halo behind the knob
const GLYPH_COL = new vec4(0.92, 0.95, 1.0, 0.95)

export class RotationPlatform {
  private root: SceneObject
  private button!: SceneObject
  private interactable!: Interactable

  private quad: RenderMesh
  private disc: RenderMesh

  private planeZ: number
  private dragging = false
  private grabOffsetX = 0
  private buttonX = 0 // live button position along the track, in cm; 0 = centre = 0 deg

  private _onYaw = new Event<number>()
  /** Fires with the shirt's Y rotation in degrees as the button is dragged. */
  get onYaw(): PublicApi<number> {
    return this._onYaw.publicApi()
  }

  /**
   * @param parent parent for the platform rig (the unscaled main root)
   * @param center world position the composition is built around (the shirt's centre)
   */
  constructor(parent: SceneObject, center: vec3) {
    this.quad = buildUnitQuad()
    this.disc = buildDisc(56)
    this.planeZ = center.z

    this.root = global.scene.createSceneObject("RotationPlatform")
    this.root.setParent(parent)
    this.root.getTransform().setWorldPosition(new vec3(center.x, center.y + PLATFORM_Y, center.z))

    this.buildPlate()
    this.buildTrack()
    this.buildButton()
  }

  /** Bind the drag. Called from OnStartEvent, where SIK subscriptions must live. */
  init(): void {
    this.interactable.onDragStart.add((e: DragInteractorEvent) => {
      const x = this.pointerX(e)
      if (x === null) return
      this.dragging = true
      // Grab-relative: remember where on the button we grabbed it, so the button
      // tracks the cursor from where it is instead of snapping under it.
      this.grabOffsetX = this.buttonX - x
    })
    this.interactable.onDragUpdate.add((e: DragInteractorEvent) => {
      if (!this.dragging) return
      const x = this.pointerX(e)
      if (x === null) return
      this.setButtonX(x + this.grabOffsetX)
    })
    this.interactable.onDragEnd.add(() => {
      this.dragging = false
    })

    // Boot pose: button dead centre, shirt at 0 deg / front-facing.
    this.setButtonX(0)
  }

  /** Current shirt yaw in degrees for the current button position. */
  getYawDeg(): number {
    return (this.buttonX / TRACK_HALF) * SHIRT_YAW_RANGE_DEG
  }

  /**
   * Drive the control to a given yaw, exactly as a drag would: the button slides to the
   * matching point on the track and the same onYaw event is emitted. Used by the Pass-8
   * verification harness (DEBUG_YAW_DEG) so captures show the real control, not a
   * shortcut straight to the shirt's transform.
   */
  setYawDeg(deg: number): void {
    this.setButtonX((deg / SHIRT_YAW_RANGE_DEG) * TRACK_HALF)
  }

  /** Move the button (clamped to the track) and emit the matching yaw. */
  private setButtonX(x: number): void {
    this.buttonX = Math.max(-TRACK_HALF, Math.min(TRACK_HALF, x))
    this.button.getTransform().setLocalPosition(new vec3(this.buttonX, 0, 0.6))
    this._onYaw.invoke(this.getYawDeg())
  }

  /**
   * The pointer's X on the platform's plane, in platform-local cm.
   *
   * Proper ray/plane intersection off the interactor's own ray (startPoint +
   * direction) rather than trusting a precomputed drag point: the plate is a fixed
   * camera-facing plane at the shirt's depth, so this is exact for both the mouse
   * interactor in the Editor and a hand ray on device. planecastPoint is kept as a
   * fallback for any interactor that does not publish a ray.
   */
  private pointerX(e: DragInteractorEvent): number | null {
    const origin = e.interactor.startPoint
    const dir = e.interactor.direction
    let hit: vec3 | null = null
    if (origin && dir) {
      const dz = dir.z
      if (Math.abs(dz) > 1e-5) {
        const t = (this.planeZ - origin.z) / dz
        if (t > 0) hit = origin.add(dir.uniformScale(t))
      }
    }
    if (!hit) hit = e.interactor.planecastPoint ?? e.interactor.targetHitPosition ?? null
    if (!hit) return null
    return hit.x - this.root.getTransform().getWorldPosition().x
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /** The plate: a soft lit rim ellipse with the dark plate body sitting on top of it. */
  private buildPlate(): void {
    if (GLASS) {
      // The turntable first, so everything else draws over it. Pass 30: drawn by the shared
      // helper (PhotoUi.addTurntable) so the gallery and the photo view can draw the same
      // plate at the same place on their own layer.
      const rootW = this.root.getTransform().getWorldPosition()
      addTurntable(this.root, new vec3(0, TABLE_WORLD_Y - rootW.y, TABLE_WORLD_Z - rootW.z), true)
      // The rotation panel: a rounded rectangle with a hairline rim and its caption.
      const w = 2 * PLATE_RX
      const h = 2 * PLATE_RY
      this.addShape(this.root, uiRoundRect(w + 2 * RIM_PAD, h + 2 * RIM_PAD, PLATE_R + RIM_PAD), new vec3(0, PLATE_DY, -0.1), new vec3(1, 1, 1), GLASS_RIM_COL)
      this.addShape(this.root, uiRoundRect(w, h, PLATE_R), new vec3(0, PLATE_DY, 0), new vec3(1, 1, 1), PLATE_COL)
      addLabel(this.root, new vec3(0, LABEL_Y, 0.2), caption("Rotation"), LABEL_SIZE, new vec4(1, 1, 1, 0.72))
      return
    }
    this.addShape(this.root, this.disc, new vec3(0, 0, -0.1), new vec3(PLATE_RX + RIM_PAD, PLATE_RY + RIM_PAD, 1), RIM_COL)
    this.addShape(this.root, this.disc, new vec3(0, 0, 0), new vec3(PLATE_RX, PLATE_RY, 1), PLATE_COL)
  }

  /** The hairline track and its tick dots, sitting on the plate. */
  private buildTrack(): void {
    this.addShape(this.root, this.quad, new vec3(0, 0, 0.2), new vec3(TRACK_HALF * 2, TRACK_BAR, 1), TRACK_COL)
    for (let i = 0; i < TICK_COUNT; i++) {
      const x = ((i / (TICK_COUNT - 1)) * 2 - 1) * TRACK_HALF
      this.addShape(this.root, this.disc, new vec3(x, 0, 0.3), new vec3(TICK_R, TICK_R, 1), TICK_COL)
    }
  }

  /**
   * The draggable button: dark fill + bright thin ring, carrying a rotate glyph
   * (two opposed arcs with arrowheads). Its collider is a comfortable box a little
   * larger than the visible chip so it is easy to grab with the mouse.
   */
  private buildButton(): void {
    this.button = global.scene.createSceneObject("RotationButton")
    this.button.setParent(this.root)
    this.button.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    if (GLASS) this.addShape(this.button, this.disc, new vec3(0, 0, -0.05), new vec3(BTN_GLOW_R, BTN_GLOW_R, 1), ACCENT_GLOW)
    this.addShape(this.button, this.disc, new vec3(0, 0, 0), new vec3(BTN_R, BTN_R, 1), BTN_FILL)
    const ring = buildRing(1 - BTN_RING / BTN_R, 56)
    this.addShape(this.button, ring, new vec3(0, 0, 0.1), new vec3(BTN_R, BTN_R, 1), BTN_EDGE)

    // Rotate glyph: two opposed arcs, each ending in a small arrowhead.
    const inner = 1 - GLYPH_BAR / GLYPH_R
    this.addShape(this.button, buildRing(inner, 24, 20, 160), new vec3(0, 0, 0.2), new vec3(GLYPH_R, GLYPH_R, 1), GLYPH_COL)
    this.addShape(this.button, buildRing(inner, 24, 200, 340), new vec3(0, 0, 0.2), new vec3(GLYPH_R, GLYPH_R, 1), GLYPH_COL)
    const tri = buildTriangle()
    const head = 0.62
    this.addShape(this.button, tri, new vec3(GLYPH_R * Math.cos(0.35), GLYPH_R * Math.sin(0.35), 0.2), new vec3(head, head, 1), GLYPH_COL, Math.PI / 2 + 0.35)
    this.addShape(this.button, tri, new vec3(-GLYPH_R * Math.cos(0.35), -GLYPH_R * Math.sin(0.35), 0.2), new vec3(head, head, 1), GLYPH_COL, -Math.PI / 2 + 0.35)

    const collider = this.button.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(BTN_HIT, BTN_HIT, 3)
    collider.shape = shape
    collider.fitVisual = false // honour the explicit box size; never auto-fit to a child visual
    this.interactable = this.button.createComponent(Interactable.getTypeName()) as Interactable
    this.interactable.targetingMode = 3 // Direct + Indirect, so mouse + hand both hit it
  }

  /** One flat, unlit, always-on-top shape. `rotZ` spins it in the platform plane. */
  private addShape(
    parent: SceneObject,
    mesh: RenderMesh,
    pos: vec3,
    scale: vec3,
    color: vec4,
    rotZ: number = 0,
    depthSorted: boolean = false
  ): SceneObject {
    const obj = global.scene.createSceneObject("PlatformPart")
    obj.setParent(parent)
    const tf = obj.getTransform()
    tf.setLocalPosition(pos)
    tf.setLocalScale(scale)
    if (rotZ !== 0) tf.setLocalRotation(quat.angleAxis(rotZ, new vec3(0, 0, 1)))

    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = mesh
    stackVisual(visual) // Pass 43
    const mat = MOTE_MAT.clone() // base-tex OFF -> renders solid baseColor
    uiFlatPass(mat.mainPass, color, depthSorted) // Pass 43; depth off = stack by draw order, like the selection box
    visual.clearMaterials()
    visual.addMaterial(mat)
    return obj
  }
}
