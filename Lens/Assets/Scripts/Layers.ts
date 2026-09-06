// Layers — the render-layer split introduced in Pass 12, in one place.
//
// WHY. Up to Pass 11 every runtime object lived on the default layer (0) and the one
// scene camera rendered all of it. Pass 12 needs a camera that sees the PRODUCT and
// nothing else — no slider, no tray, no platform, no selection frame — so the photo it
// takes reads as a product shot rather than a screenshot. A render layer is exactly
// that filter: a Camera only draws a SceneObject whose `layer` is enabled on the
// camera's `renderLayer`, so splitting the scene once here lets every camera in the
// project state its subject declaratively instead of hiding objects around a capture.
//
// THE SPLIT (and what was already where — everything below used to be on layer 0):
//
//   0  DEFAULT   untouched, pre-existing scene content: the main Camera Object, the two
//                LightSources, the SpectaclesInteractionKit rig (incl. its cursors and
//                hand visuals) and the AiPreviewAgent handler — plus, from the runtime
//                build, the ambient motes (atmosphere, deliberately NOT in the photo).
//   1  SHIRT     the garment and its stickers: GarmentRoot -> GarmentPivot ->
//                GarmentVisual and the whole imported mesh under it. The stickers are
//                BAKED INTO the shirt's own base texture by StickerCompositor, so they
//                are on this layer by construction — there is nothing separate to move,
//                and a sticker can never be half in and half out of the photo.
//   2  UI        every control and every piece of chrome: the ColorSlider panel (and the
//                photo button beneath it), the StickerTray panel, the RotationPlatform,
//                the per-sticker tap targets, the deselect backdrop, and the selection
//                frame with its x / resize / rotate handles.
//   3  BAKE      the StickerCompositor's off-scene quad rig and its orthographic camera.
//                It was already invisible to the main camera by being parked 6000 cm
//                off-axis; giving it its own layer makes that a rule rather than a
//                distance, and keeps it out of the photo camera's frustum by name.
//   4  PHOTO     the photo review (the print, its caption, the close chip and an
//                invisible input blocker). While a photograph is on screen the scene
//                camera renders THIS LAYER AND NOTHING ELSE, which is how the review
//                gets the frame to itself without a single object being disabled — see
//                PhotoBooth.bindViewportCamera.
//   5  BACKDROP  one opaque card behind the shirt, in the capture camera's renderLayer
//                and in nobody else's. It is what makes the photo a product shot: a
//                camera's clear is "the device background" unless told otherwise, and
//                on a Lens the device background is the street. A card on a private
//                layer is a physical seamless, and it cannot be got wrong by a clear
//                setting that a runtime chooses to ignore.
//
// WHY NUMBERED LAYERS AND NOT LayerSet.makeUnique(). makeUnique() allocates outside the
// normal 32-layer space; a LightSource or Camera whose renderLayer was authored in the
// Studio UI carries a 32-bit mask, which cannot contain such a layer. Numbered layers
// 1..4 sit inside that mask, so the scene's existing lights keep lighting the shirt
// after it moves off layer 0. (ScarfCustomizer also unions SHIRT into every
// LightSource's renderLayer at boot, belt and braces — see walkCamerasAndLights.)

export const LAYER_DEFAULT_NUM = 0
export const LAYER_SHIRT_NUM = 1
export const LAYER_UI_NUM = 2
export const LAYER_BAKE_NUM = 3
export const LAYER_PHOTO_NUM = 4
export const LAYER_BACKDROP_NUM = 5
/** Pass 28: the text baker's rig — a Text component and the camera that renders it to a texture. */
export const LAYER_TEXT_NUM = 6

/**
 * The LayerSets themselves, built lazily on first use.
 *
 * Lazily, because these modules are imported at script-load time and a LayerSet is an
 * engine object; building them inside a getter keeps construction inside the first
 * onAwake that actually asks for one, which is where every other engine object in this
 * project is made.
 */
class LayerRegistry {
  private _shirt: LayerSet | null = null
  private _ui: LayerSet | null = null
  private _bake: LayerSet | null = null
  private _photo: LayerSet | null = null
  private _backdrop: LayerSet | null = null
  private _text: LayerSet | null = null

  get shirt(): LayerSet {
    if (!this._shirt) this._shirt = LayerSet.fromNumber(LAYER_SHIRT_NUM)
    return this._shirt
  }
  get ui(): LayerSet {
    if (!this._ui) this._ui = LayerSet.fromNumber(LAYER_UI_NUM)
    return this._ui
  }
  get bake(): LayerSet {
    if (!this._bake) this._bake = LayerSet.fromNumber(LAYER_BAKE_NUM)
    return this._bake
  }
  get photo(): LayerSet {
    if (!this._photo) this._photo = LayerSet.fromNumber(LAYER_PHOTO_NUM)
    return this._photo
  }
  get text(): LayerSet {
    if (!this._text) this._text = LayerSet.fromNumber(LAYER_TEXT_NUM)
    return this._text
  }
  get backdrop(): LayerSet {
    if (!this._backdrop) this._backdrop = LayerSet.fromNumber(LAYER_BACKDROP_NUM)
    return this._backdrop
  }
}

export const LAYERS = new LayerRegistry()

/**
 * Who owns the screen while a full-screen overlay is up (Pass 16).
 *
 * Pass 12 gave the photo review the frame to itself by pointing the scene camera at the
 * PHOTO layer and nothing else, and putting its layers back on dismiss. Pass 13's
 * carousel reused it. Pass 16 adds a third overlay — the import panel — and three
 * copies of "remember the camera's layers, swap them, put them back" is two too many:
 * the failure mode is an overlay that closes without restoring, which leaves the Lens
 * rendering nothing but an empty layer and looks like a crash.
 *
 * So the swap lives here, once, with a COUNT of who is holding it. Only the first take()
 * records the editing layers and only the last release() restores them, which also makes
 * the "close one overlay while another is open" case safe by construction rather than by
 * everyone remembering to check.
 */
export class ViewportLayers {
  private cam: Camera | null = null
  private editLayers: LayerSet | null = null
  private holders = 0

  /** Bind the scene's own camera. Called once, from the boot-time camera walk. */
  bind(cam: Camera | null): void {
    if (!cam) return
    this.cam = cam
    this.editLayers = cam.renderLayer
  }

  /** Pass 31: the bound camera, for head-locked overlays. */
  getCamera(): Camera | null {
    return this.cam
  }

  /** True once a camera has been bound — nothing should overlay before that. */
  isBound(): boolean {
    return this.cam !== null
  }

  /** Give the frame to `layer`. Nesting is counted; the first caller wins. */
  take(layer: LayerSet): void {
    this.holders++
    if (!this.cam) return
    this.cam.renderLayer = layer
  }

  /** Give it back. Only the last holder restores the editing layers. */
  release(): void {
    if (this.holders > 0) this.holders--
    if (this.holders > 0) return
    if (this.cam && this.editLayers) this.cam.renderLayer = this.editLayers
  }
}

/**
 * Put `obj` and every descendant on `layer`.
 *
 * Whole subtrees, because a layer is per SceneObject and not inherited: the imported
 * shirt is a prefab with its own nested mesh objects, and a UIKit panel grows its knob /
 * buttons / backplate as children during its own onAwake. Sweeping the subtree once,
 * after those have been built, is what makes "the shirt is on the shirt layer" true of
 * the actual geometry rather than only of the root that carries the name.
 */
export function setLayerDeep(obj: SceneObject | null, layer: LayerSet): void {
  if (!obj || isNull(obj)) return
  obj.layer = layer
  const n = obj.getChildrenCount()
  for (let i = 0; i < n; i++) setLayerDeep(obj.getChild(i), layer)
}
