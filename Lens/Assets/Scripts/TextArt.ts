// TextArt — typed text as sticker artwork (Pass 28).
//
// ===========================================================================
// A TEXT OBJECT IS A STICKER WHOSE ARTWORK HAPPENS TO BE TYPED
// ===========================================================================
// Nothing downstream learns about text. A Text component is rendered by its own camera
// into a render target, the pixels are copied into a readable texture and trimmed to
// their alpha bounds by exactly the code an imported PNG goes through (StickerImport.
// normalise), and what comes out is a StickerArt: a texture, a trimmed quad and an
// aspect. The compositor stamps it, the frame hugs it, the seam clamp clamps it, the
// drag / resize / rotate / duplicate / delete paths never see a difference. Re-typing,
// a new font or a new colour is a re-render that swaps the art under the same
// placement, so the object keeps its position, scale and turn.
//
// THE RIG IS SHARED, THE TEXTURES ARE NOT. One Text, one camera, one render target;
// every render is copied out into its own readable texture (createFromTexture makes a
// new one), so ten text objects are ten textures and one rig. A render is asked for on
// one frame and collected on a later one, because the camera draws between script
// updates; the requester gets a callback with the art.
//
// A LONG STRING WRAPS, IT DOES NOT STRETCH. A line of text is wide, and an aspect past
// TEXT_MAX_ASPECT would make a sticker the seam clamp can barely fit anywhere. So the
// string is broken into lines of at most TEXT_LINE_CHARS characters (at word boundaries
// where there are any), which holds every line under the aspect limit and makes a long
// string a taller block rather than a wider one. TEXT_MAX_CHARS caps the whole.

import { LAYERS, setLayerDeep } from "./Layers"
import { StickerArt } from "./Stickers"
import { normalise } from "./StickerImport"

/** What a text object says and how it is set. Carried on the PlacedSticker. */
export interface TextStyle {
  text: string
  font: number // index into TEXT_FONTS
  color: number // index into TEXT_PALETTE
}

// --- The faces ----------------------------------------------------------------------
// Five Google Fonts imported as Font assets (Assets/Fonts): a clean sans, a serif, a
// script, a condensed display face and a monospace — five genuinely different voices.
export const TEXT_FONTS: Font[] = [
  requireAsset("../Fonts/Inter.ttf") as Font,
  requireAsset("../Fonts/Playfair Display.ttf") as Font,
  requireAsset("../Fonts/Pacifico.ttf") as Font,
  requireAsset("../Fonts/Bebas Neue.ttf") as Font,
  requireAsset("../Fonts/Space Mono.ttf") as Font,
]
export const TEXT_FONT_NAMES: string[] = ["Inter", "Playfair", "Pacifico", "Bebas", "Mono"]

// --- The colours --------------------------------------------------------------------
// Independent of the garment colour and of the paint palette: nine chips, black and
// white first (the two that read on any garment), then seven saturated hues.
export const TEXT_PALETTE: vec4[] = [
  new vec4(0.08, 0.08, 0.10, 1),
  new vec4(1.00, 1.00, 1.00, 1),
  new vec4(0.90, 0.20, 0.25, 1),
  new vec4(0.97, 0.56, 0.12, 1),
  new vec4(0.98, 0.85, 0.15, 1),
  new vec4(0.20, 0.70, 0.35, 1),
  new vec4(0.15, 0.50, 0.95, 1),
  new vec4(0.55, 0.32, 0.88, 1),
  new vec4(0.92, 0.35, 0.65, 1),
]

export const TEXT_DEFAULT = "HELLO" // what a fresh text object says
export const TEXT_FONT_INIT = 0
export const TEXT_COLOR_INIT = 0
export const TEXT_MAX_CHARS = 21 // three full lines
export const TEXT_LINE_CHARS = 7 // longest line: keeps every line under TEXT_MAX_ASPECT
export const TEXT_MAX_ASPECT = 4 // StickerImport.MAX_ASPECT — the wrap is what keeps us under it

// --- The rig ------------------------------------------------------------------------
const TEXT_RT = 1024 // the render target is square; the trim finds the ink inside it
const TEXT_ORTHO = 100 // world units the camera frames
const TEXT_RIG_OFFSET = new vec3(0, -6000, 0) // parked where no other camera looks
const TEXT_RENDER_SIZE = 880 // Text.size: one line ~ a fifth of the frame (220 gave 45 px; measured)
const TEXT_LINE_SPACING = 0.95
const TEXT_RENDER_FRAMES = 2 // frames between asking for a render and reading it back

/** Break a string into lines of at most TEXT_LINE_CHARS, at spaces where possible. */
export function wrapText(raw: string): string {
  const s = raw.substring(0, TEXT_MAX_CHARS)
  const words = s.split(" ").filter((w) => w.length > 0)
  const lines: string[] = []
  let cur = ""
  const push = (w: string): void => {
    // A word longer than a line is cut into line-sized pieces.
    while (w.length > TEXT_LINE_CHARS) {
      if (cur.length > 0) { lines.push(cur); cur = "" }
      lines.push(w.substring(0, TEXT_LINE_CHARS))
      w = w.substring(TEXT_LINE_CHARS)
    }
    if (w.length === 0) return
    if (cur.length === 0) cur = w
    else if (cur.length + 1 + w.length <= TEXT_LINE_CHARS) cur += " " + w
    else { lines.push(cur); cur = w }
  }
  for (const w of words) push(w)
  if (cur.length > 0) lines.push(cur)
  return lines.join("\n")
}

interface Job {
  style: TextStyle
  name: string
  frame: number
  /** Whose render this is: a queued job for the same owner is replaced, not appended. */
  owner: object
  done: (art: StickerArt | null) => void
}

export class TextBaker {
  private rig: SceneObject
  private rt: Texture
  private textObj: SceneObject
  private text: Text
  private queue: Job[] = []
  private active: Job | null = null
  private frame = 0
  private placeholder: StickerArt | null = null

  constructor(parent: SceneObject) {
    this.rt = global.scene.createRenderTargetTexture()
    const ctrl = this.rt.control as RenderTargetProvider
    ctrl.useScreenResolution = false
    ctrl.resolution = new vec2(TEXT_RT, TEXT_RT)
    ctrl.clearColor = new vec4(0, 0, 0, 0) // transparent: the trim finds the glyphs

    this.rig = global.scene.createSceneObject("TextBakerRig")
    this.rig.setParent(parent)
    this.rig.getTransform().setLocalPosition(TEXT_RIG_OFFSET)

    const camObj = global.scene.createSceneObject("TextBakerCam")
    camObj.setParent(this.rig)
    camObj.getTransform().setLocalPosition(new vec3(0, 0, 60))
    const cam = camObj.createComponent("Component.Camera") as Camera
    cam.type = Camera.Type.Orthographic
    cam.size = TEXT_ORTHO
    cam.aspect = 1
    cam.near = 1
    cam.far = 300
    cam.devicePropertyUsage = Camera.DeviceProperty.None
    cam.renderOrder = -11 // before the sticker bake, which will sample the result
    cam.renderTarget = this.rt
    cam.renderLayer = LAYERS.text

    this.textObj = global.scene.createSceneObject("TextBakerText")
    this.textObj.setParent(this.rig)
    this.text = this.textObj.createComponent("Component.Text") as Text
    this.text.text = ""
    this.text.size = TEXT_RENDER_SIZE
    this.text.horizontalOverflow = HorizontalOverflow.Overflow
    this.text.verticalOverflow = VerticalOverflow.Overflow
    this.text.horizontalAlignment = HorizontalAlignment.Center
    this.text.verticalAlignment = VerticalAlignment.Center
    this.text.lineSpacing = TEXT_LINE_SPACING
    this.text.depthTest = false
    setLayerDeep(this.rig, LAYERS.text)
  }

  /** A 1x1 transparent stand-in for the frame between a request and its render. */
  placeholderArt(): StickerArt {
    if (!this.placeholder) {
      const tex = ProceduralTextureProvider.createWithFormat(1, 1, TextureFormat.RGBA8Unorm)
      ;(tex.control as ProceduralTextureProvider).setPixels(0, 0, 1, 1, new Uint8Array([0, 0, 0, 0]))
      this.placeholder = { tex, mesh: null, wFrac: 1, hFrac: 0.35, name: "text" }
    }
    return this.placeholder
  }

  /** Ask for `style` to be rendered; `done` receives the trimmed art a couple of frames on. */
  render(owner: object, style: TextStyle, done: (art: StickerArt | null) => void): void {
    const job: Job = { style: { text: style.text, font: style.font, color: style.color }, name: "text:" + style.text, frame: -1, owner, done }
    // Typing is several edits a second; only the latest one for an object needs rendering.
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].owner === owner) { this.queue[i] = job; return }
    }
    this.queue.push(job)
  }

  /** Per frame: start the next job, or collect the one that has rendered. */
  update(): void {
    this.frame++
    if (this.active) {
      if (this.frame - this.active.frame < TEXT_RENDER_FRAMES) return
      const job = this.active
      this.active = null
      let art: StickerArt | null = null
      try {
        // The render target is SHARED and redrawn for the next job, so the artwork must
        // own a COPY of the pixels: createFromTexture makes a new readable texture, and
        // normalise trims that copy and keeps it as the art's texture.
        const copy = ProceduralTextureProvider.createFromTexture(this.rt)
        const r = normalise(copy, job.name)
        if (r.ok && r.art) {
          art = r.art
          print("[TEXT] \"" + job.style.text + "\" font " + TEXT_FONT_NAMES[job.style.font] + ": ink " +
            (r.width * (r.u1 - r.u0)).toFixed(0) + "x" + (r.height * (r.v1 - r.v0)).toFixed(0) + " px, aspect " +
            (art.wFrac / art.hFrac).toFixed(2) + ", in " + r.ms.toFixed(1) + " ms")
        } else {
          print("[TEXT] render of \"" + job.style.text + "\" produced no ink")
        }
      } catch (e) {
        print("[TEXT] readback failed: " + e)
      }
      job.done(art)
    }
    if (!this.active && this.queue.length > 0) {
      const job = this.queue.shift() as Job
      this.active = job
      job.frame = this.frame
      this.text.text = wrapText(job.style.text)
      try { this.text.font = TEXT_FONTS[job.style.font] } catch (_e) { /* ignore */ }
      this.text.textFill.color = TEXT_PALETTE[job.style.color]
    }
  }
}
