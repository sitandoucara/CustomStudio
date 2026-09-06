// ScarfCustomizer — main @component (Pass 2: front-facing t-shirt + live color slider).
//
// Composition:
//   - A textured white GLB t-shirt floats centered in front of the user at z = -110cm.
//     It stays FRONT-FACING at all times (no spin, no sway) with only a very subtle
//     vertical bob, so its front reads clearly and stickers can land on the front.
//   - A vertical UIKit color slider (ColorSliderUI, its own SceneObject) emits a
//     0..1 value as the user drags; we map it to a hue sweep and tint the t-shirt's
//     base color live, MULTIPLYING the fabric texture so the cotton shading is preserved.
//   - A vertical tray of 3 flat flower sticker thumbnails (StickerTrayUI) sits on the
//     right — DISPLAY ONLY this pass (tappable, no placement onto the shirt yet).
//   - Subtle additive ambient motes drift for atmosphere; the camera clears to
//     transparent so the scene is see-through AR (no opaque background).
//
// The customized object was a scarf in Pass 1 (its GLB was removed in Pass 42).
// ScarfController's clone-material + multiply-tint + sticker-ready slot are reused
// verbatim — only the driven prefab (t-shirt) and idle (bob-only) changed.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { ColorSliderUI } from "./ColorSliderUI"
import { GemUI } from "./GemUI"
import { StickerTrayUI } from "./StickerTrayUI"
import { ScarfController } from "./ScarfController"
import { AmbientParticles } from "./AmbientParticles"
import { StickerSystem } from "./StickerSystem"
import { RotationPlatform } from "./RotationPlatform"
import { PhotoBooth } from "./PhotoBooth"
import { RemotePhotoStore } from "./RemotePhotoStore"
import { PhotoRecord } from "./PhotoStore"
import { tickButtonCentring, addFlatShape, uiQuad, PANEL_TILE_FILL, LABEL_COL, ACCENT_FILL } from "./PhotoUi" // Pass 37; Pass 43 test patches
import { SockSelector } from "./SockSelector" // Pass 39
import { SupabaseClient, setSupabaseVerbose, setDeleteBadKey, logCredentialState } from "./SupabaseClient"
import { ImportPanel } from "./ImportPanel"
import { PaintUI } from "./PaintUI"
import { GLASS, UI_COL_X } from "./UiTheme"
import { CameraProbe, WorldColorPicker } from "./WorldColor"
import { GarmentButtons } from "./GarmentButtons"
import { GARMENTS, GARMENT_INIT } from "./Garments"
import { LAYERS, ViewportLayers, setLayerDeep } from "./Layers"
import { valueToColor } from "./ColorUtils"
import {
  DEBUG_YAW_DEG,
  DEBUG_PROJECTION_PROBE,
  DEBUG_PROBE_YAWS,
  DEBUG_DRAG_PATH,
  DEBUG_DRAG_STOP_AT,
  DEBUG_PHOTO_SCRIPT,
  DEBUG_SUPABASE_LOG,
  DEBUG_DELETE_BAD_KEY,
  DEBUG_CAMERA_PROBE,
  PAINT_UI_DEPTH,
} from "./Stickers"

// Pass 6 swapped the AI-generated shirt for the imported, properly-UV-unwrapped Sketchfab
// tee. Pass 18 moved the prefab, the fit and the panel table out of here entirely: every
// garment is a GarmentDef in Garments.ts, and this file only ever iterates GARMENTS. That
// is the whole of "adding a third garment changes no behaviour code" — there is no name
// of a garment anywhere below this line.
const MOTE_MESH = requireAsset("../GeneratedMeshes/MoteSphere.mesh") as RenderMesh
const MOTE_MAT = requireAsset("../Materials/MoteMaterial.mat") as Material

@component
export class ScarfCustomizer extends BaseScriptComponent {
  // Inspector toggle: flip ON to wireframe every collider for hit-zone diagnosis
  // (Hard Rule 6.7). Takes effect on preview restart.
  @input
  debugColliders: boolean = false

  // Wired by the bootstrap to the ColorSliderUI ScriptComponent. Typed as the UI
  // class directly — no getScript(), no cast (Channel A / Hard Rule 3).
  @input
  uiHud!: ColorSliderUI

  // Wired by the bootstrap to the StickerTrayUI ScriptComponent (Channel A). Tapping a
  // tray thumbnail emits onStickerTapped(index); we stamp that flower on the shirt.
  @input
  stickerTray!: StickerTrayUI

  // Pass 18: ONE controller per garment, all built at boot, exactly one enabled. `garment`
  // is whichever of them is on screen; `garmentIndex` indexes GARMENTS.
  private garments: ScarfController[] = []
  private garmentIndex = GARMENT_INIT
  private sockSelector!: SockSelector
  private garment!: ScarfController
  private garmentButtons!: GarmentButtons
  private gemUI!: GemUI // Pass 29
  private gemShape = 5
  private gemColor = 10
  private gemSize = 0.9
  // The colour slider's value PER GARMENT. The slider itself is never touched by a switch
  // — the shirt's hue is remembered here and pushed back through applyColor, which is the
  // same path a drag of the slider takes, so there is no second way for a colour to be set.
  private garmentColorValue: number[] = []
  private particles!: AmbientParticles
  private stickers!: StickerSystem
  private platform!: RotationPlatform
  private booth!: PhotoBooth
  // Where photographs live (Pass 15). This IS the swap Pass 13's interface was built
  // for, and it is the one line that changed to make it: RemotePhotoStore composes a
  // SessionPhotoStore and adds the cloud on top. With no credentials it degrades to
  // exactly that inner store, so a clone of this public repo — which has none — behaves
  // bit for bit like Pass 13 and never issues a request.
  private supabase = new SupabaseClient()
  private photoStore = new RemotePhotoStore(this.supabase)
  // Who owns the screen while an overlay is up. One instance, shared by the photo
  // review, the gallery carousel and the import panel — see Layers.ViewportLayers.
  private viewport = new ViewportLayers()
  private importPanel!: ImportPanel
  // Pass 17: the tool switch, the palette and the erase button. The paint texture itself
  // is owned by StickerSystem (it is part of what gets baked onto the garment).
  private paintUI!: PaintUI
  private fpsEvery = 0 // Pass 43 verification: print the frame clock every N frames (harness step fpsEvery)
  private colorValue = 0.5 // last value the slider emitted; stamped on every photo
  // Pass 31: a colour picked from the world, when one is the garment's colour instead of
  // the slider's; remembered per garment like the slider value.
  private pickedColor: vec4 | null = null
  private garmentPicked: (vec4 | null)[] = []
  private picker!: WorldColorPicker
  private pickClosedFrame = -1 // verification pacing (afterPick steps)
  private firedSteps: boolean[] = [] // afterPick steps fire once
  private frame = 0 // frames since boot (Pass 12 photo harness)
  private measureAtFrame = -1 // Pass 35: the frame the button measurement prints on
  private measureProbes: SceneObject[] = [] // Pass 35: the cap-height probes, destroyed after the read
  private probeFrame = 0 // verification harness only (DEBUG_PROJECTION_PROBE)
  private dragFrame = 0 // verification harness only (DEBUG_DRAG_PATH)
  private debugBooted = false // verification harness only (see stickers.runBootDebug)
  private cameraProbe: CameraProbe | null = null // verification only (DEBUG_CAMERA_PROBE)

  onAwake(): void {
    // PASS 49 — say the credential state ONCE, at boot, before anything else prints. A
    // public clone ships SupabaseConfig.ts with two empty strings; this is the line that
    // tells whoever opened the project which file to fill in and what it turns on. It is
    // printed here and nowhere in the frame loop.
    logCredentialState()

    this.buildScene()

    // Subscribe to the slider inside OnStart — the UI builds its Slider in its own
    // onAwake, and SIK events must bind in OnStart (specs-interaction-recipes §1).
    this.createEvent("OnStartEvent").bind(() => {
      if (DEBUG_CAMERA_PROBE) this.cameraProbe = new CameraProbe()
      this.uiHud.onColorValue.add((v: number) => this.applyColor(v))
      this.uiHud.onPick.add(() => this.picker.open("garment"))
      // Pass 33: a text object tapped under Paint or Gems brings Colour back and selects it.
      // Pass 44: through focusText, the one route into editing a text object.
      this.stickers.onTextUnderTool = (i: number) => this.focusText(i)
      // Pass 33 (glass): the two UIKit panels are scene objects placed at +/-21 in the
      // prefab; the columns now hang off UI_COL_X, so they are moved here, once.
      if (GLASS) {
        this.uiHud.getSceneObject().getTransform().setWorldPosition(new vec3(-UI_COL_X, 0, -PAINT_UI_DEPTH))
        this.stickerTray.getSceneObject().getTransform().setWorldPosition(new vec3(UI_COL_X, 0, -PAINT_UI_DEPTH))
      }
      this.picker.init()
      // Seed the t-shirt with the slider's starting color so it's tinted from frame 1.
      this.applyColor(this.uiHud.getValue())

      // Sticker flow (Pass 3): wire tray taps → stamp, and bind the select/delete/
      // deselect interactions. init() reads the live shirt bounds, so it must run in
      // OnStart (after buildScene's onAwake) and is where SIK events bind.
      this.stickers.init()
      this.stickerTray.onStickerTapped.add((i: number) => this.stickers.placeSticker(i))
      // Pass 28: text. The Add text button places one; the editor (the same panel, when a
      // text object is selected) edits it; Done deselects, which brings the library back.
      this.stickerTray.onAddText.add(() => this.addText()) // Pass 44: place, then focusText
      this.stickerTray.bindText({
        onChange: (patch) => this.stickers.editSelectedText(patch),
        onDone: () => this.stickers.selectSticker(-1),
      })

      // Rotation platform (Pass 8): dragging its button turns the shirt on Y, live.
      // Its own SIK drag subscriptions bind here, and its init() seeds the boot pose
      // (button dead centre → 0 deg → front-facing, exactly as before this pass).
      this.platform.onYaw.add((deg: number) => this.garment.setYawDeg(deg))
      this.platform.init()

      // Photo booth (Pass 12): the shutter under the colour slider, the capture camera
      // that sees the shirt layer and nothing else, and the review overlay.
      this.booth.init()

      // Import panel (Pass 16): the + under the sticker tray, and the grid of artwork
      // from custom_upload. Its init() also decides the button's resting appearance,
      // which is why it runs after the client has had a chance to see the config.
      this.importPanel.init()

      // Paint (Pass 17). The tool switch hides the colour slider and shows the palette;
      // switching to Paint enables StickerSystem's capture plane, which is what stops
      // sticker gestures from firing while a brushstroke is in progress.
      this.paintUI.bindSlider(this.uiHud.getSceneObject())
      this.paintUI.init()
      this.gemUI.init() // Pass 29

      // Garment choice (Pass 18). Its SIK subscriptions bind here like every other
      // control's, and applySelection paints the boot state — the shirt, active.
      this.garmentButtons.init()
      this.sockSelector.init()

      // Pass 15 verification aid: print every Supabase request's status and body.
      // Ships false — see DEBUG_SUPABASE_LOG.
      if (DEBUG_SUPABASE_LOG) setSupabaseVerbose(true)
      if (DEBUG_DELETE_BAD_KEY) setDeleteBadKey(true) // Pass 36 verification only

      // Pass 12 — THE LAYER SPLIT, applied here rather than at construction.
      // The two UIKit panels grow their own children (backplate, knob, buttons) inside
      // their own onAwake, and script onAwakes run in hierarchy order, so a sweep from
      // buildScene would miss whatever had not been built yet. OnStart is after every
      // onAwake in the scene, which is the first moment the subtrees are complete.
      this.assignLayers()

      // Verification harness (Pass 8): force the control to an angle through the same
      // setButtonX -> onYaw path a drag emits, so a capture shows the real button
      // position AND the real shirt rotation. null in shipped code.
      if (DEBUG_YAW_DEG !== null) this.platform.setYawDeg(DEBUG_YAW_DEG)
    })

    this.createEvent("UpdateEvent").bind(() => {
      const dt = getDeltaTime()
      if (this.cameraProbe) this.cameraProbe.update()
      this.picker.update()
      this.garment.updateIdle(dt)
      this.particles.update(dt)
      // AFTER updateIdle, so the sticker rig is re-glued to the shirt's pose for
      // THIS frame (it now bobs AND rotates), and the facing guard sees the truth.
      this.stickers.update()
      // Verification harness: run the sticker debug drivers on the FIRST frame, not in
      // OnStart. The shirt's dialled-in yaw is only written onto the pivot by updateIdle
      // above, so before this point every panel still reads as front-facing and any
      // driver that asks "which panel am I looking at" would get the wrong answer.
      if (!this.debugBooted) {
        this.debugBooted = true
        this.stickers.runBootDebug()
      }
      // The booth only does work while an exposure is in flight or the gallery carousel
      // is easing; otherwise this is a compare and a return.
      this.booth.update(dt)
      // Paint: upload whatever was drawn this frame (one setPixels for the whole frame's
      // dabs), and let the erase button appear or disappear.
      this.stickers.flushPaint()
      this.paintUI.update(dt)
      this.gemUI.update(dt)
      // Pass 28: the right panel follows the selection — editor for text, library otherwise.
      this.stickerTray.showEditor(this.stickers.selectedTextStyle())
      tickButtonCentring() // Pass 37: settles each icon-and-word group once its word has laid out
      if (DEBUG_PROJECTION_PROBE) this.runProjectionProbe()
      if (DEBUG_DRAG_PATH.length > 0) this.runDragPath()
      if (DEBUG_PHOTO_SCRIPT.length > 0) this.runPhotoScript()
      if (this.fpsEvery > 0 && this.frame % this.fpsEvery === 0) print("[FPS] frame " + this.frame + " t=" + getTime().toFixed(2) + " dt=" + (getDeltaTime() * 1000).toFixed(0) + "ms") // Pass 43
      if (this.measureAtFrame >= 0 && this.frame >= this.measureAtFrame) this.measureButtonsPrint()
      this.frame++
    })

    if (this.debugColliders) {
      this.setColliderDebugAll(this.getSceneObject(), true)
    }
  }

  private buildScene(): void {
    const CENTER = new vec3(0, 0, -110) // comfortable constant depth, in front of the user
    const root = this.getSceneObject()

    // Every garment, built at boot into the SAME GarmentRoot at the SAME centre, all but
    // one disabled. They therefore arrive centred in the same place, at the size their own
    // fit asks for, front-facing, with no per-garment positioning anywhere: "one garment on
    // screen at a time, in the same place" is a property of the scene graph, not of a rule
    // somebody has to remember. Building them all up front costs one prefab instantiation
    // each, once, and makes a switch a pair of `enabled` writes.
    const garmentRoot = global.scene.createSceneObject("GarmentRoot")
    garmentRoot.setParent(root)
    garmentRoot.getTransform().setLocalPosition(CENTER)
    for (let i = 0; i < GARMENTS.length; i++) {
      const c = new ScarfController(GARMENTS[i], garmentRoot)
      c.setActive(i === this.garmentIndex)
      this.garments.push(c)
      this.garmentColorValue.push(this.colorValue)
      this.garmentPicked.push(null)
    }
    this.garment = this.garments[this.garmentIndex]

    const ambientRoot = global.scene.createSceneObject("AmbientRoot")
    ambientRoot.setParent(root)
    ambientRoot.getTransform().setLocalPosition(CENTER)
    this.particles = new AmbientParticles(MOTE_MESH, MOTE_MAT, ambientRoot, 16)

    // Sticker system: bakes flowers onto the shirt (via the compositor) and owns the
    // world-space select/delete/deselect interactions. All its objects live under the
    // unscaled main root (the shirt GLB root carries a 100x scale), positioned by world
    // coordinates derived from the shirt's live bounds.
    this.stickers = new StickerSystem(root, this.garment, GARMENTS[this.garmentIndex])

    // Rotation platform: the slim plate + slide-to-rotate track under the shirt.
    // Parented to the unscaled main root and positioned around the same CENTER the
    // rest of the composition uses, so it sits at the shirt's constant depth.
    this.platform = new RotationPlatform(root, CENTER)

    // Photo booth (Pass 12). It is handed the same CENTER so its capture camera stands
    // squarely in front of the shirt, and a small set of hooks rather than the objects
    // themselves: it suspends the editing chrome for the exposure and stamps the state
    // onto each record, without owning the sticker system or the platform.
    // Paint (Pass 17). Built after the sticker system, because the paint layer it drives
    // belongs to that system — the paint is baked onto the garment, so it lives with the
    // thing that owns the bake.
    this.paintUI = new PaintUI(root, () => this.stickers.getPaintLayers(), {
      onToolChanged: (tool) => {
        this.stickers.setTool(tool)
        this.gemUI.setVisible(tool === "gems") // Pass 29: the gem panel owns the left side while Gems is the tool
      },
      onErase: () => this.stickers.clearPaint(),
      onPick: () => this.picker.open("brush"),
    })

    // Pass 31: the world-colour picker. One overlay, two callers: the slider's dropper
    // colours the garment, the palette's colours the brush.
    this.picker = new WorldColorPicker(root, this.viewport, {
      onPicked: (c, target) => {
        if (target === "garment") this.applyPicked(c)
        else if (target === "gems") this.gemUI.setPickedColor(c) // Pass 41: the third caller
        else this.paintUI.setPickedColor(c)
      },
      onClosed: () => { this.pickClosedFrame = this.frame },
    })

    // Pass 29: the gem controls — shape, colour, size, undo, clear — in the slider's footprint.
    this.gemUI = new GemUI(root, {
      onShape: (i) => this.gemStyle(i, undefined, undefined),
      onColor: (i) => this.gemStyle(undefined, i, undefined),
      onSize: (cm) => this.gemStyle(undefined, undefined, cm),
      onUndo: () => this.stickers.undoGems(),
      onClear: () => this.stickers.clearGems(),
      onPick: () => this.picker.open("gems"), // Pass 41: the gem panel's dropper
    })

    // Import panel (Pass 16). Placement goes through the SAME entry point a tray tap
    // uses — StickerSystem.placeArt — so an imported logo is a sticker in every sense
    // rather than a second kind of thing that merely looks like one.
    this.importPanel = new ImportPanel(root, this.supabase, this.viewport, {
      onPick: (art) => this.stickers.placeArt(art),
    }, () => this.stickerTray.getImportSlot()) // Pass 25 (glass): the button lives in the tray

    // Which garment you are customising (Pass 18). Above the composition, centred — see
    // the note at the top of GarmentButtons for why there and not in a tool cluster.
    this.garmentButtons = new GarmentButtons(root, GARMENTS, this.garmentIndex, (i) =>
      this.selectGarment(i)
    )
    // Pass 39: Left / Right sock — the placement target for the pair, shown only on the socks.
    this.sockSelector = new SockSelector(root, (side) => this.selectSock(side))
    this.syncSockSelector()

    this.booth = new PhotoBooth(root, CENTER, this.photoStore, this.viewport, {
      onCaptureBegin: () => this.stickers.setChromeVisible(false),
      onCaptureEnd: () => this.stickers.setChromeVisible(true),
      readState: () => ({
        shirtColor: this.currentColor(),
        yawDeg: this.platform.getYawDeg(),
        stickerCount: this.stickers.getStickerCount(),
      }),
    })
  }

  /**
   * Pass 12 — put every runtime-built subtree on its render layer, and tell the scene's
   * own camera and lights what to do about it. See Layers.ts for the full split.
   *
   * The garment goes to the SHIRT layer (its baked stickers travel with it, being part
   * of its texture); the two UIKit panels, the platform and everything the sticker
   * system builds go to UI; the ambient motes are deliberately LEFT on the default layer
   * — they are atmosphere, and atmosphere has no place in a product shot. The compositor
   * rig puts itself on the BAKE layer and the photo booth puts itself on UI / PHOTO, so
   * the only things left to name here are the ones this script owns.
   */
  private assignLayers(): void {
    const root = this.getSceneObject()
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i)
      if (child.name === "GarmentRoot") setLayerDeep(child, LAYERS.shirt)
      else if (child.name === "RotationPlatform") setLayerDeep(child, LAYERS.ui)
      else if (child.name === "ImportButton") setLayerDeep(child, LAYERS.ui)
    }
    setLayerDeep(this.uiHud.getSceneObject(), LAYERS.ui)
    setLayerDeep(this.stickerTray.getSceneObject(), LAYERS.ui)
    this.configureSceneCameraAndLights()
  }

  /**
   * The scene's authored Camera and LightSources, adjusted for the split.
   *
   * The camera: its authored mask (layer 0 only) UNIONED with SHIRT and UI — the two
   * layers the composition just moved onto — and deliberately NOT the photo layer and
   * NOT the bake layer. Not photo, because the review is not meant to be visible while
   * you are editing; the booth swaps the camera onto that layer for as long as a
   * photograph is up and swaps this set back afterwards. Not bake, because the
   * compositor's quad rig is only ever meant for the compositor's own camera — until
   * this pass it was kept out of frame by being parked 6000 cm away, which is now a rule
   * instead of a distance.
   *
   * This walk is also where the photo booth is handed that camera: the review is drawn
   * by the scene's own camera, by pointing it at the PHOTO layer for as long as a
   * photograph is on screen (see bindViewportCamera).
   *
   * The lights: their authored renderLayer UNIONED with the shirt layer. A LightSource
   * only lights the layers in its renderLayer and the shirt has just moved off layer 0,
   * so this is what keeps it lit — on screen and in the photo. A union rather than
   * LayerSet.all() because the scene's lights carry a deliberate authored mask and there
   * is no reason for this pass to widen it any further than the one layer it created.
   */
  private configureSceneCameraAndLights(): void {
    const mine = this.getSceneObject()
    const n = global.scene.getRootObjectsCount()
    for (let i = 0; i < n; i++) {
      const obj = global.scene.getRootObject(i)
      this.walkCamerasAndLights(obj, mine)
    }
  }

  private walkCamerasAndLights(obj: SceneObject, skip: SceneObject): void {
    if (isNull(obj) || obj === skip) return // our own cameras configure themselves
    const cam = obj.getComponent("Component.Camera") as Camera | null
    if (cam) {
      cam.renderLayer = cam.renderLayer.union(LAYERS.shirt).union(LAYERS.ui)
      this.booth.bindViewportCamera(cam)
    }
    const light = obj.getComponent("Component.LightSource") as LightSource | null
    if (light) light.renderLayer = light.renderLayer.union(LAYERS.shirt)
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.walkCamerasAndLights(obj.getChild(i), skip)
    }
  }

  /**
   * Verification harness (Pass 12, DEBUG_PHOTO_SCRIPT). Fires each step on its frame
   * through the public entry points the real taps and drags call, so a capture shows
   * the real behaviour: dial the platform, drive the colour slider, press the shutter,
   * press the close chip. Inert in shipped code.
   */
  private runPhotoScript(): void {
    for (let si = 0; si < DEBUG_PHOTO_SCRIPT.length; si++) {
      const step = DEBUG_PHOTO_SCRIPT[si]
      const due = step.afterPick
        ? this.pickClosedFrame >= 0 && this.frame === this.pickClosedFrame + step.atFrame && !this.firedSteps[si]
        : step.atFrame === this.frame
      if (!due) continue
      this.firedSteps[si] = true
      if (step.yaw !== undefined) this.platform.setYawDeg(step.yaw)
      if (step.color !== undefined) this.applyColor(step.color)
      if (step.placeSticker !== undefined) this.stickers.placeSticker(step.placeSticker)
      if (step.shoot) this.booth.requestCapture()
      if (step.dismiss) this.booth.dismiss()
      if (step.openGallery) this.booth.openGallery()
      if (step.galleryStep !== undefined) {
        // One call per card, so a multi-card jump is the same sequence of arrow presses
        // a person would make rather than a shortcut the chips cannot produce.
        const dir = step.galleryStep < 0 ? -1 : 1
        for (let k = 0; k < Math.abs(step.galleryStep); k++) this.booth.galleryStep(dir)
      }
      if (step.galleryDelete) this.guardedGalleryDelete(step.deleteExpectPath)
      if (step.closeGallery) this.booth.closeGallery()
      if (step.openImport) this.importPanel.open()
      if (step.pickImport !== undefined) this.importPanel.pickIndex(step.pickImport)
      if (step.closeImport) this.importPanel.close()
      if (step.stickerScale !== undefined) this.stickers.debugSetScale(step.stickerScale)
      if (step.stickerRot !== undefined) this.stickers.debugSetRotation(step.stickerRot)
      if (step.dragTo) this.stickers.debugDragTo(step.dragTo.panel, step.dragTo.u, step.dragTo.v)
      if (step.tool !== undefined) this.paintUI.debugSetTool(step.tool) // "colour", "paint" or "gems"
      if (step.paintChip !== undefined) this.paintUI.debugSelectChip(step.paintChip)
      if (step.paintStroke) {
        const k = step.paintStroke
        this.stickers.debugPaintStroke(k.panel, k.u0, k.v0, k.u1, k.v1, k.samples)
      }
      if (step.tapErase) this.paintUI.debugTapErase()
      if (step.garment !== undefined) this.garmentButtons.debugPick(step.garment)
      if (step.sockSide !== undefined) this.sockSelector.debugPick(step.sockSide)
      if (step.audit) this.auditHitTargets(step.auditTag ?? "")
      if (step.measureButtons) this.measureButtonsBegin()
      if (step.cloudList) this.cloudListProbe()
      if (step.makeOrphan) this.makeOrphanProbe()
      if (step.survey) this.stickers.debugSurvey()
      if (step.duplicate) this.stickers.debugDuplicate()
      if (step.sliderValue !== undefined) { this.uiHud.setValue(step.sliderValue); this.applyColor(step.sliderValue) }
      if (step.sliderDump) this.uiHud.debugDump("garment=" + GARMENTS[this.garmentIndex].id)
      if (step.sweep) this.stickers.debugSweep(step.sweep.panel, step.sweep.u0, step.sweep.v0, step.sweep.u1, step.sweep.v1, step.sweep.steps, step.sweep.panel1)
      if (step.addText) this.addText() // Pass 44: the button's own route
      if (step.selectIndex !== undefined) this.stickers.selectSticker(step.selectIndex) // Pass 44
      if (step.frameProbe !== undefined) this.stickers.debugFrameProbe(step.frameProbe) // Pass 47
      if (step.textSet !== undefined) this.stickers.editSelectedText({ text: step.textSet })
      if (step.textFont !== undefined) this.stickers.editSelectedText({ font: step.textFont })
      if (step.textColor !== undefined) this.stickers.editSelectedText({ color: step.textColor })
      if (step.deselect) this.stickers.selectSticker(-1)
      if (step.gemShape !== undefined) this.gemUI.debugShape(step.gemShape)
      if (step.gemColor !== undefined) this.gemUI.debugColor(step.gemColor)
      if (step.gemSize !== undefined) this.gemUI.debugSize(step.gemSize)
      if (step.gemTap) this.stickers.debugGemTap(step.gemTap.panel, step.gemTap.u, step.gemTap.v)
      if (step.gemTrail) this.stickers.debugGemTrail(step.gemTrail.panel, step.gemTrail.u0, step.gemTrail.v0, step.gemTrail.u1, step.gemTrail.v1, step.gemTrail.steps)
      if (step.gemUndo) this.gemUI.debugUndo()
      if (step.gemClear) this.gemUI.debugClear()
      if (step.brushSize !== undefined) this.paintUI.debugBrushSize(step.brushSize)
      if (step.pickOpen !== undefined) this.picker.open(step.pickOpen === "brush" ? "brush" : step.pickOpen === "gems" ? "gems" : "garment")
      if (step.gemPickTap) this.gemUI.debugTapPick() // Pass 41
      if (step.pickConfirm) this.picker.confirm()
      if (step.pickCancel) this.picker.cancel()
      if (step.pickTap) this.paintUI.debugTapPick()
      if (step.tapUnderTool) this.stickers.debugTapUnderTool(step.tapUnderTool.panel, step.tapUnderTool.u, step.tapUnderTool.v)
      if (step.editorTapEntry) this.stickerTray.debugTapEntry()
      if (step.dumpView !== undefined) this.dumpView(step.dumpView)
      if (step.testPatches) this.addTestPatches()
      if (step.fpsEvery !== undefined) this.fpsEvery = step.fpsEvery
      if (step.rayProbe !== undefined) this.stickers.debugRayProbe(step.rayProbe, step.rayProbeIndex ?? -1) // Pass 44
      if (step.dragToEdge) this.stickers.debugDragToEdge(step.dragToEdge.panel, step.dragToEdge.dirX, step.dragToEdge.dirY) // Pass 44
    }
  }

  /**
   * Pass 43 (verification only). Known colour/alpha patches at the UI depth, in two
   * columns outside the side panels and five rows from the sky to the ground, so the
   * Preview's compositing of Lens RGBA over the environment can be read off a capture.
   */
  private addTestPatches(): void {
    const root = global.scene.createSceneObject("TestPatches")
    root.setParent(this.getSceneObject())
    root.getTransform().setWorldPosition(new vec3(0, 0, -PAINT_UI_DEPTH))
    const cols: vec4[] = [
      new vec4(1, 1, 1, 1), new vec4(1, 1, 1, 0.5), new vec4(1, 1, 1, 0.25),
      new vec4(0, 0, 0, 1), new vec4(0, 0, 0, 0.5), ACCENT_FILL,
    ]
    // The eye sees about +/-35 cm at this depth: two columns just outside the side panels
    // (x = +/-30.5, over the buildings) and two rows above and below everything (sky, ground).
    const place = (x: number, y: number, c: number): void => {
      if (c < cols.length) { addFlatShape(root, uiQuad(), new vec3(x, y, 0), new vec3(3, 3, 1), cols[c]); return }
      // a glyph as the panels draw one: LABEL_COL on a PANEL_TILE_FILL tile
      const tile = addFlatShape(root, uiQuad(), new vec3(x, y, 0), new vec3(3, 3, 1), PANEL_TILE_FILL)
      addFlatShape(tile, uiQuad(), new vec3(0, 0, 0.1), new vec3(0.55, 0.55, 1), LABEL_COL)
    }
    for (let c = 0; c <= cols.length; c++) {
      place(-30.5, 20 - c * 3.3, c)
      place(30.5, 20 - c * 3.3, c)
      place(-9.9 + c * 3.3, 31, c)
      place(-9.9 + c * 3.3, -31, c)
    }
    setLayerDeep(root, LAYERS.ui)
    print("[PATCHES] placed: order white a1, white a.5, white a.25, black a1, black a.5, ACCENT_FILL, glyph-on-tile; columns x=+/-30.5 (top->down), rows y=+31 and -31 (left->right)")
  }

  /**
   * Pass 43 (verification only). Encode the viewport camera's render target — the
   * environment and the Lens composited exactly as the Preview shows them — and print it
   * to the log as base64 in chunks, so the interface's rendered pixel values can be read.
   */
  private dumpView(tag: string): void {
    let cam: Camera | null = null
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const c = global.scene.getRootObject(i).getComponent("Component.Camera") as Camera | null
      if (c) { cam = c; break }
    }
    if (!cam) { print("[VIEWDUMP " + tag + " FAILED no camera]"); return }
    const tex = cam.renderTarget as Texture
    const CHUNK = 3000
    Base64.encodeTextureAsync(tex, (b64: string) => {
      const n = Math.ceil(b64.length / CHUNK)
      print("[VIEWDUMP " + tag + " begin " + n + " " + tex.getWidth() + "x" + tex.getHeight() + "]")
      for (let i = 0; i < n; i++) print("[VIEWDUMP " + tag + " " + i + "] " + b64.substr(i * CHUNK, CHUNK))
      print("[VIEWDUMP " + tag + " end]")
    }, () => print("[VIEWDUMP " + tag + " FAILED encode]"), CompressionQuality.MaximumQuality, EncodingType.Png)
  }




  /**
   * PASS 36 — the guarded harness delete. See DebugPhotoStep.deleteExpectPath for why the
   * unguarded version had to go: a script re-run deletes a different photograph than the
   * one it was written for, and there is no undo on the other side of that request.
   */
  private guardedGalleryDelete(expectPath: string | undefined): void {
    const rec = this.booth.galleryCentred()
    const at = rec ? (rec.storagePath || ScarfCustomizer.DELETE_TARGET_SESSION) : "(nothing)"
    if (!expectPath) {
      print("[GUARD] galleryDelete REFUSED: no deleteExpectPath. Centred card is " + at)
      return
    }
    if (!rec || at !== expectPath) { // `at` is the storage_path, or the session sentinel
      print("[GUARD] galleryDelete REFUSED: expected " + expectPath + " but the centred card is " + at)
      return
    }
    print("[GUARD] galleryDelete allowed on " + at)
    this.booth.galleryDelete()
  }

  /**
   * Pass 36: what a harness delete must name to target a photograph that has no cloud
   * object — one taken this session and not uploaded. A session photo has no storage_path
   * to match on, and "" would mean "unnamed", which the guard refuses on purpose.
   */
  private static readonly DELETE_TARGET_SESSION = "(session, not uploaded)"

  /** Pass 36: the verification probe counts the whole table, not the gallery's one page. */
  private static readonly CLOUD_PROBE_LIMIT = 200

  /**
   * PASS 36 VERIFICATION — the table itself, not the gallery's opinion of it.
   *
   * The gallery's list is the thing under test, so it cannot be the evidence. This asks
   * custom_photos directly and prints every row, which is what "prove it is gone" means.
   */
  private async cloudListProbe(): Promise<void> {
    // A bigger limit than the gallery's: the gallery shows a page, this counts the table.
    const res = await this.supabase.listPhotos(ScarfCustomizer.CLOUD_PROBE_LIMIT)
    if (!res.ok || !res.value) {
      print("[CLOUD] list FAILED: HTTP " + res.status + " " + res.error)
      return
    }
    print("[CLOUD] custom_photos holds " + res.value.length + " row(s) (probe limit " + ScarfCustomizer.CLOUD_PROBE_LIMIT + "):")
    for (let i = 0; i < res.value.length; i++) {
      const r = res.value[i]
      print("[CLOUD]   " + r.id + "  " + r.storage_path + "  " + r.created_at)
    }
  }

  /**
   * PASS 36 VERIFICATION — manufacture one orphaned row, the Pass 14 shape.
   *
   * Deletes the OBJECT of the newest uploaded photograph and leaves its row alone, so the
   * gallery ends up holding a row whose image cannot be fetched — the "image unavailable"
   * card. Point 6 of this pass is whether such a card can now be deleted, and this is how
   * that gets an answer from a real row rather than from reading the code.
   */
  private async makeOrphanProbe(): Promise<void> {
    let target: PhotoRecord | null = null
    for (let i = 0; i < this.photoStore.count(); i++) {
      const rec = this.photoStore.at(i)
      if (rec && rec.remoteId && rec.storagePath) { target = rec; break }
    }
    if (!target) { print("[ORPHAN] no uploaded photograph to orphan"); return }
    const out = await this.supabase.deleteObject(target.storagePath)
    print("[ORPHAN] removed object " + target.storagePath + " -> HTTP " + out.status +
      " ok=" + out.ok + " (" + out.verified + ") — row " + target.remoteId + " is now an orphan")
  }

  /**
   * PASS 35 VERIFICATION — THE BUTTON RULE, MEASURED.
   *
   * Pass 33 wrote a button rule and Pass 34 believed it was being followed on all four
   * icon-and-word buttons. It was not, and three passes of eyeballing did not settle it,
   * so this reads the numbers off the RENDERED geometry instead: every part's world
   * axis-aligned box (BaseMeshVisual.worldAabbMin/Max — the same call for a mesh and for
   * a Text, so a glyph made of quads and a glyph made of letters are measured the same
   * way), expressed in the button's own local centimetres.
   *
   * Cap height cannot be read off the word itself ("Gallery" has a descender, "Photo"
   * does not), so phase one plants a probe Text of the same face and size reading "H",
   * parked far below the panel, and phase two measures that. Text lays out on the frame
   * after it is created, hence the two phases.
   */
  private static readonly MEASURED_BUTTONS: string[][] = [
    ["PhotoButton", "Photo"], ["GalleryButton", "Gallery"],
    ["ImportButton", "My lib"], ["AddTextButton", "Text"], // Pass 45: the words as they read now
  ]
  private static readonly MEASURE_PROBE_DY = -200 // the probe is parked off the panel
  private static readonly MEASURE_DELAY = 3 // frames for Text to lay out

  private findByName(name: string): SceneObject | null {
    let found: SceneObject | null = null
    const walk = (o: SceneObject): void => {
      if (found) return
      if (o.name === name) { found = o; return }
      for (let i = 0; i < o.getChildrenCount(); i++) walk(o.getChild(i))
    }
    const roots = global.scene.getRootObjectsCount()
    for (let i = 0; i < roots && !found; i++) walk(global.scene.getRootObject(i))
    return found
  }

  /** The word Text on a button: the Text component whose string is that button's word. */
  private wordTextOf(btn: SceneObject, word: string): Text | null {
    for (let i = 0; i < btn.getChildrenCount(); i++) {
      const t = btn.getChild(i).getComponent("Component.Text") as Text | null
      if (t && t.text === word) return t
    }
    return null
  }

  /** Phase one: plant a cap-height probe under every measured button. */
  private measureButtonsBegin(): void {
    this.measureProbes = []
    for (const pair of ScarfCustomizer.MEASURED_BUTTONS) {
      const btn = this.findByName(pair[0])
      if (!btn) { print("[BTN] " + pair[0] + " NOT FOUND"); continue }
      const w = this.wordTextOf(btn, pair[1])
      if (!w) { print("[BTN] " + pair[0] + " has no word \"" + pair[1] + "\""); continue }
      const probe = global.scene.createSceneObject("CapProbe_" + pair[0])
      probe.setParent(btn)
      probe.getTransform().setLocalPosition(new vec3(0, ScarfCustomizer.MEASURE_PROBE_DY, 0))
      const t = probe.createComponent("Component.Text") as Text
      t.text = "H"
      t.size = w.size
      t.horizontalOverflow = HorizontalOverflow.Overflow
      t.horizontalAlignment = HorizontalAlignment.Center
      t.verticalAlignment = VerticalAlignment.Center
      try { t.font = w.font } catch (_e) { /* the default face, then */ }
      setLayerDeep(probe, LAYERS.ui)
      this.measureProbes.push(probe)
    }
    this.measureAtFrame = this.frame + ScarfCustomizer.MEASURE_DELAY
  }

  /** Phase two: read every part's box and print the five numbers, side by side. */
  private measureButtonsPrint(): void {
    this.measureAtFrame = -1
    const f = (v: number): string => (v >= 0 ? " " : "") + v.toFixed(2)
    const pad = (s: string, n: number): string => { let o = s; while (o.length < n) o += " "; return o }

    print("[BTN] ---- Pass 35: the button rule, measured on the rendered geometry (cm, button-local) ----")
    print("[BTN] " + pad("button", 14) + pad("plate", 14) + pad("glyphBox", 14) + pad("gap", 8) +
      pad("capH", 8) + pad("leftPad", 9) + pad("rightPad", 9) + "groupCentre")
    for (const pair of ScarfCustomizer.MEASURED_BUTTONS) {
      const btn = this.findByName(pair[0])
      if (!btn) continue
      const tf = btn.getTransform()
      const origin = tf.getWorldPosition()
      const s = tf.getWorldScale()
      // Every box, brought back into the button's own local centimetres.
      const boxOf = (o: SceneObject): number[] | null => {
        const v = (o.getComponent("Component.RenderMeshVisual") as BaseMeshVisual | null)
          ?? (o.getComponent("Component.Text") as BaseMeshVisual | null)
        if (!v || !v.enabled || !o.enabled) return null
        const lo = v.worldAabbMin()
        const hi = v.worldAabbMax()
        return [(lo.x - origin.x) / s.x, (hi.x - origin.x) / s.x, (lo.y - origin.y) / s.y, (hi.y - origin.y) / s.y]
      }
      // Child 0 is the rim, child 1 the plate body (makePlateButton draws them in that
      // order); everything after that is the glyph, except the word and the probe.
      const plate = btn.getChildrenCount() > 1 ? boxOf(btn.getChild(1)) : null
      let gx0 = 1e9, gx1 = -1e9, gy0 = 1e9, gy1 = -1e9
      let wx0 = 0, wx1 = 0, wy0 = 0, wy1 = 0, haveWord = false
      let capH = 0
      for (let i = 2; i < btn.getChildrenCount(); i++) {
        const c = btn.getChild(i)
        const b = boxOf(c)
        if (!b) continue
        const t = c.getComponent("Component.Text") as Text | null
        if (c.name.indexOf("CapProbe") === 0) { capH = b[3] - b[2]; continue }
        if (t && t.text === pair[1]) { wx0 = b[0]; wx1 = b[1]; wy0 = b[2]; wy1 = b[3]; haveWord = true; continue }
        if (b[0] < gx0) gx0 = b[0]
        if (b[1] > gx1) gx1 = b[1]
        if (b[2] < gy0) gy0 = b[2]
        if (b[3] > gy1) gy1 = b[3]
      }
      if (!plate || !haveWord || gx1 < gx0) { print("[BTN] " + pair[0] + ": incomplete"); continue }
      const plateW = plate[1] - plate[0]
      const plateH = plate[3] - plate[2]
      const gap = wx0 - gx1
      const leftPad = gx0 - plate[0]
      const rightPad = plate[1] - wx1
      const groupC = (gx0 + wx1) / 2 - (plate[0] + plate[1]) / 2
      print("[BTN] " + pad(pair[1], 14) +
        pad(f(plateW) + "x" + f(plateH), 14) +
        pad(f(gx1 - gx0) + "x" + f(gy1 - gy0), 14) +
        pad(f(gap), 8) + pad(f(capH), 8) + pad(f(leftPad), 9) + pad(f(rightPad), 9) + f(groupC))
      print("[BTN]   " + pad(pair[1], 12) + " glyph x[" + f(gx0) + "," + f(gx1) + "]  word x[" + f(wx0) + "," + f(wx1) +
        "] ink " + f(wx1 - wx0) + "x" + f(wy1 - wy0) + "  size " + (this.wordTextOf(btn, pair[1]) as Text).size)
    }
    for (const p of this.measureProbes) p.destroy()
    this.measureProbes = []
    print("[BTN] ---- end ----")
  }

  /**
   * PASS 25 VERIFICATION — the hit-target audit. Walks the whole scene for enabled
   * Interactables with a box collider, prints each one's world box, tests every box's
   * SHADOW against the paint capture plane (a box between the eye and the controls
   * shadows whatever its projection from the eye covers — see Stickers.PAINT_SHADOW_LIMIT)
   * and reports every pair of boxes that overlap at a shared depth. Inert in shipped code.
   */
  private auditHitTargets(tag: string = ""): void {
    interface Box { name: string; path: string; x: number; y: number; z: number; hw: number; hh: number; hd: number }
    const boxes: Box[] = []
    let plane: Box | null = null
    const walk = (o: SceneObject, path: string): void => {
      if (!o.enabled) return
      const p = path + "/" + o.name
      const inter = o.getComponent(Interactable.getTypeName())
      const col = o.getComponent("Physics.ColliderComponent") as ColliderComponent | null
      if (inter && col && inter.enabled && col.enabled) {
        const shape: any = col.shape
        const size: vec3 | undefined = shape && shape.size
        if (size) {
          const tf = o.getTransform()
          const wp = tf.getWorldPosition()
          const ws = tf.getWorldScale()
          const b: Box = { name: o.name, path: p, x: wp.x, y: wp.y, z: wp.z,
            hw: (size.x * ws.x) / 2, hh: (size.y * ws.y) / 2, hd: (size.z * ws.z) / 2 }
          if (o.name === "PaintCapturePlane") plane = b
          else boxes.push(b)
        }
      }
      for (let i = 0; i < o.getChildrenCount(); i++) walk(o.getChild(i), p)
    }
    const roots = global.scene.getRootObjectsCount()
    for (let i = 0; i < roots; i++) walk(global.scene.getRootObject(i), "")

    const f = (v: number): string => v.toFixed(1)
    print("[AUDIT] <" + tag + "> " + boxes.length + " interactable boxes" + (plane ? ", paint plane ON" : ", paint plane off"))
    for (const b of boxes) {
      let note = ""
      if (plane) {
        // Project the box's near face from the eye onto the plane's near face.
        const pl: Box = plane
        const zb = b.z + b.hd
        const zp = pl.z + pl.hd
        if (zb < zp) { // the control is behind the plane
          const k = zp / zb
          const px = b.x * k, py = b.y * k, phw = b.hw * k, phh = b.hh * k
          const ox = Math.min(px + phw, pl.x + pl.hw) - Math.max(px - phw, pl.x - pl.hw)
          const oy = Math.min(py + phh, pl.y + pl.hh) - Math.max(py - phh, pl.y - pl.hh)
          if (ox > 0 && oy > 0) note = "  SHADOWED by paint plane (" + f(ox) + " x " + f(oy) + " cm of it)"
        }
      }
      // Pass 44: the box centre in the viewport camera's screen space (0..1, y down), so a
      // real mouse tap can be injected on it from outside.
      let scr = ""
      const cam = this.viewport.getCamera()
      if (cam) { try { const sp = cam.worldSpaceToScreenSpace(new vec3(b.x, b.y, b.z)); scr = " screen (" + sp.x.toFixed(3) + "," + sp.y.toFixed(3) + ")" } catch (_e) { /* ignore */ } }
      print("[AUDIT] " + b.name + " @ (" + f(b.x) + "," + f(b.y) + "," + f(b.z) + ") box " + f(2 * b.hw) + " x " + f(2 * b.hh) + scr + note)
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (Math.abs(a.z - b.z) >= a.hd + b.hd) continue
        const ox = Math.min(a.x + a.hw, b.x + b.hw) - Math.max(a.x - a.hw, b.x - b.hw)
        const oy = Math.min(a.y + a.hh, b.y + b.hh) - Math.max(a.y - a.hh, b.y - b.hh)
        if (ox > 0 && oy > 0) print("[AUDIT] <" + tag + "> OVERLAP " + a.name + " x " + b.name + " (" + f(ox) + " x " + f(oy) + " cm)")
      }
    }
  }

  /**
   * Verification harness (Pass 8, DEBUG_PROJECTION_PROBE). Steps the shirt through a
   * sweep of angles, two frames each: frame A dials the angle in through the platform
   * control, frame B — by which time updateIdle has written the rotation onto the pivot
   * — round-trips the real world->UV projection at that angle and prints the error.
   */
  private runProjectionProbe(): void {
    const idx = Math.floor(this.probeFrame / 2)
    if (idx < DEBUG_PROBE_YAWS.length) {
      if (this.probeFrame % 2 === 0) this.platform.setYawDeg(DEBUG_PROBE_YAWS[idx])
      else this.stickers.probeProjection(DEBUG_PROBE_YAWS[idx])
    }
    this.probeFrame++
  }

  /**
   * Verification harness (Pass 11, DEBUG_DRAG_PATH). Walks the selected sticker across
   * the garment two frames per step: frame A turns the shirt to that step's yaw through
   * the platform control — exactly as dragging its button would — and frame B, by which
   * time updateIdle has written the rotation onto the pivot, pushes a synthetic pointer
   * ray at that step's target through the REAL surface-drag path. Stops on
   * DEBUG_DRAG_STOP_AT so any point along the journey can be captured.
   */
  private runDragPath(): void {
    const last = DEBUG_DRAG_STOP_AT < 0 ? DEBUG_DRAG_PATH.length - 1 : DEBUG_DRAG_STOP_AT
    const idx = Math.floor(this.dragFrame / 2)
    if (idx <= last) {
      if (this.dragFrame % 2 === 0) this.platform.setYawDeg(DEBUG_DRAG_PATH[idx].yaw)
      else this.stickers.dragPathStep(idx)
      this.dragFrame++
    }
  }

  /**
   * PASS 18 — SWAP THE GARMENT.
   *
   * The order here is the whole behaviour, so it is worth reading as a sequence:
   *
   *   PARK   the outgoing garment's colour under its index, and take it off screen.
   *   ADOPT  the new one and enable it. Both live in the same GarmentRoot at the same
   *          centre, so it arrives centred where the last one was with nothing moved.
   *   FACE   the platform back to dead centre, and the garment with it. A cap arriving
   *          already spun to 140 degrees because that is where the shirt was left would be
   *          a garment shown from behind for no reason the user asked for, and the button
   *          and the pose would disagree. Both are written, not just the control, because
   *          the pose is only pushed onto the pivot by updateIdle and a capture taken on
   *          this frame would otherwise show the old angle.
   *   REBIND  the sticker system, which parks and restores stickers and paint (switchTo).
   *   RESTORE the palette's target layer, the slider's knob and this garment's colour —
   *          through applyColor, the same path a slider drag takes.
   *
   * A press on the ALREADY-active button falls out at the first line, so it is a no-op
   * rather than a reset: pressing "shirt" while on the shirt must not straighten it.
   */
  private selectGarment(i: number): void {
    if (i < 0 || i >= GARMENTS.length || i === this.garmentIndex) return

    this.garmentColorValue[this.garmentIndex] = this.colorValue
    this.garmentPicked[this.garmentIndex] = this.pickedColor
    this.garments[this.garmentIndex].setActive(false)

    this.garmentIndex = i
    this.garment = this.garments[i]
    this.garment.setActive(true)

    this.platform.setYawDeg(0)
    this.garment.setYawDeg(0)

    this.stickers.switchTo(GARMENTS[i], this.garment)
    this.syncSockSelector()
    this.paintUI.onGarmentChanged()

    this.uiHud.setValue(this.garmentColorValue[i])
    this.applyColor(this.garmentColorValue[i])
    const picked = this.garmentPicked[i]
    if (picked) this.applyPicked(picked) // Pass 31: this garment wore a world colour
    this.garmentButtons.setSelected(i)
  }

  /** Pass 39: a sock was chosen — new content goes there; the control shows it. */
  private selectSock(side: number): void {
    this.sockSelector.setSelected(side)
    this.syncSockSelector()
  }

  /** Pass 39: the selector is visible only on the socks, and the placer's target follows it. */
  private syncSockSelector(): void {
    const targets = GARMENTS[this.garmentIndex].printTargets
    const socks = !!targets && targets.length > 1 // a garment with more than one bake target: the pair
    this.sockSelector.setVisible(socks)
    this.stickers.setPlaceTarget(socks ? this.sockSelector.getSelectedTarget() : -1)
  }

  /** Pass 29: the gem panel's current choices, pushed to the placer as a set. */
  private gemStyle(shape: number | undefined, color: number | undefined, size: number | undefined): void {
    if (shape !== undefined) this.gemShape = shape
    if (color !== undefined) this.gemColor = color
    if (size !== undefined) this.gemSize = size
    this.stickers.setGemStyle(this.gemShape, this.gemColor, this.gemSize)
  }

  /** Pass 31: the colour the garment wears right now — picked, or the slider's. */
  private currentColor(): vec4 {
    return this.pickedColor ? this.pickedColor : valueToColor(this.colorValue)
  }

  /**
   * Pass 31: a colour from the world becomes the garment's colour. The slider value is
   * left where it was and the knob detaches (see ColorSliderUI.setDetached); the swatch
   * and hex show THIS colour, which is the one applied. The next slider touch comes
   * through applyColor and takes over again.
   */
  private applyPicked(c: vec4): void {
    this.pickedColor = new vec4(c.x, c.y, c.z, 1)
    this.stickers.setShirtColor(this.pickedColor)
    this.garment.setNonPrintColor(this.pickedColor)
    this.uiHud.setSwatchColor(this.pickedColor)
    this.uiHud.setDetached(true)
  }

  private applyColor(v: number): void {
    this.colorValue = v // remembered so every photo can record the colour it was taken at
    if (this.pickedColor) { this.pickedColor = null; this.uiHud.setDetached(false) } // Pass 31: the track takes over
    const c = valueToColor(v)
    // Pass 7: the shirt color lives in the baked FABRIC layer (so flowers stay true-color
    // on top), NOT in a global baseColorFactor multiply. Route it through the compositor.
    this.stickers.setShirtColor(c)
    // Pass 21: surfaces that do not print take the colour as a tint (the tote's body and
    // handles); on the shirt and the cap there are none and this returns at once.
    this.garment.setNonPrintColor(c)
    this.uiHud.setSwatchColor(c)
  }

  /**
   * PASS 44 — ONE ROUTE INTO "EDITING THIS TEXT OBJECT". Two gestures lead there: tapping
   * a text object (Pass 33 handed that off from under Paint and Gems) and creating one with
   * the Text button, which Pass 33 missed. Under Paint or Gems the new object was placed
   * and selected, but those tools hide the sticker chrome, so selectedTextStyle() stayed
   * null and the tray's per-frame follow (showEditor) kept the library up. Both gestures
   * now end here: the tool goes back to Colour through the tool switch itself, so its
   * pills, the gem panel and the sticker chrome all follow, then the object is selected —
   * and the editor opens for the same reason it opens after a tap: a selected text object
   * is on screen. There is no second special case; the creation route simply calls this
   * with the index it just made.
   */
  private focusText(i: number): void {
    this.paintUI.showTool("colour")
    this.stickers.selectSticker(i)
  }

  /** The Text button, and the harness's addText step: place a text object, then focus it. */
  private addText(): void {
    const i = this.stickers.placeText()
    if (i >= 0) this.focusText(i)
  }

  private setColliderDebugAll(obj: SceneObject, on: boolean): void {
    const col = obj.getComponent("Physics.ColliderComponent") as ColliderComponent | null
    if (col) {
      try { (col as any).debugDrawEnabled = on } catch (_e) { /* ignore */ }
    }
    const n = obj.getChildrenCount()
    for (let i = 0; i < n; i++) {
      this.setColliderDebugAll(obj.getChild(i), on)
    }
  }
}
