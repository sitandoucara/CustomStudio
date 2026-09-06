// PaintLayer — free drawing on the fabric, in its own persistent texture (Pass 17).
//
// ===========================================================================
// 1. WHY A PERSISTENT TEXTURE AND NOT ANOTHER QUAD STACK
// ===========================================================================
// Stickers are re-stamped from scratch every bake: the compositor is handed the whole
// list and redraws it, which is what makes deleting one of four genuinely remove it.
// Paint cannot work that way. A stroke is thousands of overlapping dabs, and keeping
// them as a list to be redrawn would grow without bound and cost a full re-draw of the
// entire drawing on every frame.
//
// So paint ACCUMULATES into one texture that nothing ever clears. A stroke writes into
// it and is then forgotten; the texture is the drawing. The compositor draws it as a
// single quad between the fabric and the stickers, which is also exactly the layer order
// the design asks for:
//
//     base colour (opaque fabric quad)  ->  PAINT  ->  stickers
//
// That ordering is not enforced by a sort key, it is hierarchy order in the bake rig —
// the compositor draws with depth testing off and relies on draw order, and this quad is
// created in the constructor between the fabric and the sticker pool. A sticker is
// therefore always over paint by construction, and painting across one cannot touch it.
//
// ===========================================================================
// 2. WHAT IT COSTS
// ===========================================================================
// PAINT_SIZE x PAINT_SIZE x RGBA8, held twice: once as a CPU Uint8Array that is the
// authoritative drawing, and once as the GPU texture the compositor samples. At 512
// that is 1 MB each, 2 MB total, fixed for the life of the Lens — it does not grow with
// the number of strokes, because there is no such thing as a stroke once it is drawn.
//
// 512 rather than the bake target's 1024: the shirt's front torso occupies roughly
// 300 x 340 of the atlas at this size, over a usable 15.9 x 25.4 cm, which is about 19
// pixels per centimetre. A brush is a soft-edged blob, not a hairline, so 19 px/cm is
// past the point where more resolution is visible — and 1024 would have cost 8 MB and
// quadrupled every upload for no difference anyone could see.
//
// ===========================================================================
// 3. WHY UPLOADS ARE DIRTY-RECT AND ONCE PER FRAME
// ===========================================================================
// setPixels can write a SUB-RECTANGLE, so a dab uploads its own bounding box rather than
// the megabyte. A fast drag lays down dozens of dabs per frame, so the rects are unioned
// as they are stamped and exactly one upload happens per frame, in flush(). Worst case
// — a stroke crossing the whole atlas in one frame — that is the full texture; typical
// case it is a few tens of kilobytes.
//
// ===========================================================================
// 4. THE BRUSH IS ROUND ON THE CLOTH, NOT IN THE ATLAS
// ===========================================================================
// The atlas is anisotropic and each panel has its own cm-per-uv (and the sleeves are
// turned in it), so a circle in texture space would be an ellipse on the garment, and a
// different ellipse on every panel. The dab is therefore an ELLIPSE in texture space
// whose axes are the brush radius converted through that panel's own cm-per-u and
// cm-per-v — which comes out as a circle on the fabric wherever it is painted.

/** Texture resolution. See note 2 for why this is 512 and not 1024. */
export const PAINT_SIZE = 512
/** Brush radius on the cloth, in centimetres. */
export const PAINT_RADIUS_CM_MIN = 0.45
export const PAINT_RADIUS_CM_MAX = 2.2
export const PAINT_RADIUS_CM_DEFAULT = 0.95
/**
 * How far apart consecutive dabs may be, as a fraction of the brush radius. 0.30 leaves
 * every dab overlapping its neighbour by 70%, which is what makes a fast drag a
 * continuous stroke instead of a dotted line — the interpolation between two pointer
 * samples is subdivided until no gap is bigger than this.
 */
export const PAINT_STEP_FRAC = 0.30
/** Hard ceiling on dabs per interpolated segment, so a wild drag cannot stall a frame. */
export const PAINT_MAX_STEPS = 96
/**
 * The dab's soft edge, as a fraction of its radius. A hard circle at 19 px/cm shows its
 * stair-steps; a falloff over the outer 35% reads as a brush and costs nothing.
 */
export const PAINT_FEATHER = 0.35

/** One rectangle of the texture that has been written and not yet uploaded. */
interface DirtyRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
  any: boolean
}

export class PaintLayer {
  private tex: Texture
  private ctrl: ProceduralTextureProvider
  /** The authoritative drawing. RGBA, row 0 at the bottom, matching setPixels. */
  private buf: Uint8Array
  /** Scratch for the sub-rectangle upload, grown on demand. */
  private scratch: Uint8Array | null = null

  private dirty: DirtyRect = { minX: 0, minY: 0, maxX: 0, maxY: 0, any: false }
  private painted = false

  private colR = 255
  private colG = 255
  private colB = 255
  private radiusCm = PAINT_RADIUS_CM_DEFAULT

  // Stroke state
  private strokeActive = false
  private lastU = 0
  private lastV = 0

  constructor() {
    this.buf = new Uint8Array(PAINT_SIZE * PAINT_SIZE * 4) // zeroed: fully transparent
    this.tex = ProceduralTextureProvider.createWithFormat(
      PAINT_SIZE,
      PAINT_SIZE,
      TextureFormat.RGBA8Unorm
    )
    this.ctrl = this.tex.control as ProceduralTextureProvider
    this.ctrl.setPixels(0, 0, PAINT_SIZE, PAINT_SIZE, this.buf)
  }

  /** The texture the compositor draws between the fabric and the stickers. */
  getTexture(): Texture {
    return this.tex
  }

  /** True once anything has been painted — drives whether the erase button exists. */
  hasPaint(): boolean {
    return this.painted
  }

  setColor(c: vec4): void {
    this.colR = Math.max(0, Math.min(255, Math.round(c.x * 255)))
    this.colG = Math.max(0, Math.min(255, Math.round(c.y * 255)))
    this.colB = Math.max(0, Math.min(255, Math.round(c.z * 255)))
  }

  setRadiusCm(cm: number): void {
    this.radiusCm = Math.max(PAINT_RADIUS_CM_MIN, Math.min(PAINT_RADIUS_CM_MAX, cm))
  }

  getRadiusCm(): number {
    return this.radiusCm
  }

  // ---------------------------------------------------------------------------
  // Strokes
  // ---------------------------------------------------------------------------

  /** Begin a stroke. The next point is stamped without interpolation. */
  beginStroke(): void {
    this.strokeActive = false // set on the first point, which has nothing to join to
  }

  endStroke(): void {
    this.strokeActive = false
  }

  /**
   * Add one pointer sample to the current stroke, in atlas UV.
   *
   * Interpolation happens HERE rather than at the call site, because only this class
   * knows the brush radius and therefore how finely the gap has to be subdivided. The
   * caller feeds it whatever samples the frame rate happened to produce — one per frame
   * at 5 fps or at 60 — and the stroke comes out the same.
   */
  addPoint(u: number, v: number, cmPerU: number, cmPerV: number): void {
    if (!this.strokeActive) {
      this.strokeActive = true
      this.lastU = u
      this.lastV = v
      this.dab(u, v, cmPerU, cmPerV)
      return
    }
    // Distance travelled ON THE CLOTH, so the step is in centimetres and does not change
    // with the panel's anisotropy.
    const dxCm = (u - this.lastU) * cmPerU
    const dyCm = (v - this.lastV) * cmPerV
    const distCm = Math.sqrt(dxCm * dxCm + dyCm * dyCm)
    const stepCm = Math.max(0.01, this.radiusCm * PAINT_STEP_FRAC)
    let steps = Math.ceil(distCm / stepCm)
    if (steps < 1) steps = 1
    if (steps > PAINT_MAX_STEPS) steps = PAINT_MAX_STEPS
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      this.dab(this.lastU + (u - this.lastU) * t, this.lastV + (v - this.lastV) * t, cmPerU, cmPerV)
    }
    this.lastU = u
    this.lastV = v
  }

  /**
   * One elliptical dab, alpha-composited into the buffer.
   *
   * Straight source-over: the core reaches full alpha so paint is OPAQUE over the base
   * colour (pink on blue is pink, not a blend), and the feathered rim blends with
   * whatever is already there so overlapping dabs in one stroke do not band.
   */
  private dab(u: number, v: number, cmPerU: number, cmPerV: number): void {
    const ru = (this.radiusCm / cmPerU) * PAINT_SIZE
    const rv = (this.radiusCm / cmPerV) * PAINT_SIZE
    if (ru < 0.05 || rv < 0.05) return
    const cx = u * PAINT_SIZE
    const cy = v * PAINT_SIZE

    let x0 = Math.floor(cx - ru)
    let x1 = Math.ceil(cx + ru)
    let y0 = Math.floor(cy - rv)
    let y1 = Math.ceil(cy + rv)
    if (x0 < 0) x0 = 0
    if (y0 < 0) y0 = 0
    if (x1 > PAINT_SIZE - 1) x1 = PAINT_SIZE - 1
    if (y1 > PAINT_SIZE - 1) y1 = PAINT_SIZE - 1
    if (x1 < x0 || y1 < y0) return

    const inner = 1 - PAINT_FEATHER
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / rv
      const rowBase = y * PAINT_SIZE * 4
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / ru
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d >= 1) continue
        // 1 in the core, smoothly to 0 at the rim.
        let a = 1
        if (d > inner) {
          const t = (1 - d) / PAINT_FEATHER
          a = t * t * (3 - 2 * t) // smoothstep
        }
        if (a <= 0) continue
        const i = rowBase + x * 4
        const dstA = this.buf[i + 3] / 255
        const outA = a + dstA * (1 - a)
        if (outA <= 0) continue
        // Source-over on premultiplied-by-hand straight alpha.
        this.buf[i] = Math.round((this.colR * a + this.buf[i] * dstA * (1 - a)) / outA)
        this.buf[i + 1] = Math.round((this.colG * a + this.buf[i + 1] * dstA * (1 - a)) / outA)
        this.buf[i + 2] = Math.round((this.colB * a + this.buf[i + 2] * dstA * (1 - a)) / outA)
        this.buf[i + 3] = Math.round(outA * 255)
      }
    }
    this.markDirty(x0, y0, x1, y1)
    this.painted = true
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.dirty.any) {
      this.dirty.minX = x0
      this.dirty.minY = y0
      this.dirty.maxX = x1
      this.dirty.maxY = y1
      this.dirty.any = true
      return
    }
    if (x0 < this.dirty.minX) this.dirty.minX = x0
    if (y0 < this.dirty.minY) this.dirty.minY = y0
    if (x1 > this.dirty.maxX) this.dirty.maxX = x1
    if (y1 > this.dirty.maxY) this.dirty.maxY = y1
  }

  /**
   * Upload whatever changed this frame. Called once per frame from the update loop, so a
   * drag that laid down forty dabs still costs exactly one setPixels.
   */
  flush(): void {
    if (!this.dirty.any) return
    const x = this.dirty.minX
    const y = this.dirty.minY
    const w = this.dirty.maxX - x + 1
    const h = this.dirty.maxY - y + 1
    this.dirty.any = false

    const need = w * h * 4
    if (!this.scratch || this.scratch.length < need) this.scratch = new Uint8Array(need)
    const s = this.scratch
    // Rows of the dirty rect are not contiguous in the full buffer, so they are gathered.
    for (let row = 0; row < h; row++) {
      const src = ((y + row) * PAINT_SIZE + x) * 4
      const dst = row * w * 4
      for (let k = 0; k < w * 4; k++) s[dst + k] = this.buf[src + k]
    }
    try {
      // setPixels wants exactly w*h*4; hand it a view when the scratch is oversized.
      this.ctrl.setPixels(x, y, w, h, need === s.length ? s : s.subarray(0, need))
    } catch (_e) { /* a failed upload loses one frame of paint, never the drawing */ }
  }

  /**
   * Wipe every stroke. Only the paint: the fabric colour and the stickers are separate
   * layers and are not touched.
   */
  clear(): void {
    if (!this.painted) return
    for (let i = 0; i < this.buf.length; i++) this.buf[i] = 0
    this.painted = false
    this.strokeActive = false
    this.markDirty(0, 0, PAINT_SIZE - 1, PAINT_SIZE - 1)
    this.flush()
  }
}
