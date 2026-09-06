// StickerImport — turning an arbitrary downloaded image into a well-behaved sticker
// (Pass 16, point 3).
//
// ===========================================================================
// THE PROBLEM THIS SOLVES
// ===========================================================================
// The three built-in flowers were trimmed to their alpha bounds OFFLINE in Pass 9,
// because transparent padding made the selection frame bound the IMAGE rather than the
// visible artwork — a daisy with 20% padding got a frame 20% too big on every side, at
// every scale and every angle. The fix was to crop the PNGs on disk, which works
// beautifully for three files you control and not at all for a bucket someone else
// drops logos into.
//
// So the same normalisation now happens at runtime, to every imported image, before it
// is ever placed.
//
// ===========================================================================
// HOW — UV SUB-RECT, NOT A PIXEL CROP
// ===========================================================================
// The obvious implementation is: read the pixels, crop them, upload a new texture. That
// costs a full GPU->CPU readback, a second full-size buffer for the cropped copy, and a
// CPU->GPU upload — per image, for something the texture coordinates can express for
// free.
//
// Instead the alpha bounds become the QUAD'S UVs. `buildUnitQuadUV(u0,v0,u1,v1)` builds
// a quad that samples only the inked rectangle, so the quad IS the visible artwork.
// Nothing is copied and nothing is reallocated; the only cost is the measurement.
// Everything downstream — the stamp's four corners, the selection frame, the seam
// clamp, the rotated-footprint growth — is already derived from the quad, so all of it
// becomes correct for free.
//
// ===========================================================================
// THE MEASUREMENT, AND WHAT IT COSTS
// ===========================================================================
// A Texture is not readable. `ProceduralTextureProvider.createFromTexture(tex)` returns
// a copy that IS (the same call PhotoBooth freezes a photograph with), and its provider
// exposes getPixels over a rectangle.
//
// Two things keep that affordable on an image of unknown size:
//
//   1. BANDS. The image is read SCAN_BAND rows at a time rather than all at once, so
//      peak memory is width x SCAN_BAND x 4 bytes — about half a megabyte for a 2048px
//      image — instead of the whole thing. A 4000x3000 photo would otherwise want a
//      48 MB buffer to answer a question about its edges.
//
//   2. A STRIDE. Alpha bounds do not need per-pixel precision: being one pixel out on a
//      1024px image moves the frame by a tenth of a millimetre on the shirt. The scan
//      therefore steps SCAN_STRIDE pixels in both axes and then pads the result back out
//      by that stride, so the bounds are guaranteed to CONTAIN the artwork rather than
//      clip it. Work drops by stride squared — 16x at stride 4.
//
// ===========================================================================
// JPEGs, AND WHY "NO ALPHA" IS NOT A FAILURE
// ===========================================================================
// A JPEG has no transparency: every pixel is alpha 255, so the alpha bounds are the
// whole image and the sticker prints as a rectangle. That is the correct answer, not a
// degenerate one, and it falls out of the same code path — there is no "does this have
// alpha" branch anywhere here. `findAlphaBounds` returns the full rectangle when
// everything is opaque, exactly as it returns the ink rectangle when some of it is not.
//
// The one thing that would break is a fully TRANSPARENT image (or one whose every pixel
// is under the threshold), which would produce an empty rectangle and a zero-sized
// sticker. That is the single guarded case: an empty result falls back to the full
// image.

import { buildUnitQuadUV } from "./StickerCompositor"
import { StickerArt } from "./Stickers"

/**
 * Alpha at or below this is "not ink". Not zero, because PNG exporters routinely leave
 * a fringe of 1-3 alpha around antialiased edges, and trimming to alpha > 0 would then
 * measure the fringe instead of the artwork.
 */
export const ALPHA_INK_MIN = 8
/** Rows read per getPixels call — see note 1 above. */
export const SCAN_BAND = 64
/** Pixels stepped per sample in both axes — see note 2 above. */
export const SCAN_STRIDE = 4
/**
 * Aspect ratios beyond this are clamped. A 20:1 banner would otherwise become a sticker
 * 8.65 cm wide and 4 mm tall, which is not a sticker, it is a hair. Clamping keeps the
 * short axis usable and simply crops nothing — the artwork is letterboxed into the
 * clamped rectangle by the quad's own UVs, which is the one case where a little padding
 * is the lesser evil.
 */
export const MAX_ASPECT = 4.0

/** What a measurement produced. `ok` is false when the texture could not be read at all. */
export interface NormaliseResult {
  art: StickerArt | null
  ok: boolean
  /** Milliseconds the measurement took, for the record. */
  ms: number
  /** The bounds found, in 0..1 texture space. */
  u0: number
  v0: number
  u1: number
  v1: number
  width: number
  height: number
  /** True when nothing in the image was transparent — a JPEG, or an opaque PNG. */
  fullyOpaque: boolean
}

/**
 * Measure an imported texture's alpha bounds and return it as a placeable StickerArt.
 *
 * The returned art carries a quad whose UVs are those bounds and an aspect derived from
 * them, so the sticker that comes out is indistinguishable — to every other system in
 * this project — from one of the three built-ins.
 */
export function normalise(tex: Texture, name: string): NormaliseResult {
  // Date.now(), not getTime(): getTime() is the FRAME's time and does not advance
  // within a frame, so it reports 0 ms for anything that completes inside one — which
  // is exactly what this does. (Learned the hard way measuring the texture encode in
  // Pass 14.) Date.now() is wall-clock and has millisecond resolution.
  const t0 = nowMs()
  const w = tex.getWidth()
  const h = tex.getHeight()
  const fail: NormaliseResult = {
    art: null, ok: false, ms: 0, u0: 0, v0: 0, u1: 1, v1: 1,
    width: w, height: h, fullyOpaque: false,
  }
  if (w <= 0 || h <= 0) return fail

  let readable: Texture
  try {
    // The same mechanism PhotoBooth freezes a photograph with: a copy backed by a
    // ProceduralTextureProvider, which is the only kind of texture whose pixels can be
    // read back.
    readable = ProceduralTextureProvider.createFromTexture(tex)
  } catch (_e) {
    return fail
  }
  const ctrl = readable.control as ProceduralTextureProvider
  if (!ctrl || !ctrl.getPixels) return fail

  const b = findAlphaBounds(ctrl, w, h)
  const ms = nowMs() - t0
  if (!b.ok) return { ...fail, ms: ms }

  // Bounds -> UVs. getPixels is row 0 at the BOTTOM, the same convention buildUnitQuadUV
  // writes, so no flip is needed here.
  let u0 = b.minX / w
  let u1 = (b.maxX + 1) / w
  let v0 = b.minY / h
  let v1 = (b.maxY + 1) / h

  // Aspect from the INKED rectangle in pixels, then clamped. Long side becomes 1.
  const pw = (b.maxX + 1 - b.minX)
  const ph = (b.maxY + 1 - b.minY)
  let aspect = pw / ph
  if (aspect > MAX_ASPECT) {
    // Too wide: grow the sampled band vertically so the artwork is letterboxed into a
    // MAX_ASPECT rectangle rather than squashed or hair-thin.
    const wantPh = pw / MAX_ASPECT
    const grow = (wantPh - ph) / 2 / h
    v0 -= grow
    v1 += grow
    aspect = MAX_ASPECT
  } else if (aspect < 1 / MAX_ASPECT) {
    const wantPw = ph / MAX_ASPECT
    const grow = (wantPw - pw) / 2 / w
    u0 -= grow
    u1 += grow
    aspect = 1 / MAX_ASPECT
  }

  const wFrac = aspect >= 1 ? 1 : aspect
  const hFrac = aspect >= 1 ? 1 / aspect : 1

  const art: StickerArt = {
    tex: tex, // the ORIGINAL texture; only the quad's UVs changed
    mesh: buildUnitQuadUV(u0, v0, u1, v1),
    wFrac: wFrac,
    hFrac: hFrac,
    name: name,
  }
  return {
    art: art, ok: true, ms: ms,
    u0: u0, v0: v0, u1: u1, v1: v1,
    width: w, height: h, fullyOpaque: b.fullyOpaque,
  }
}

/**
 * The bounding box of everything with alpha above ALPHA_INK_MIN, in pixels.
 *
 * Read in horizontal bands and sampled on a stride; the result is padded back out by the
 * stride so it can only ever be too generous, never too tight. An image with no ink at
 * all reports the full rectangle rather than an empty one — see the JPEG note above.
 */
function findAlphaBounds(
  ctrl: ProceduralTextureProvider,
  w: number,
  h: number
): { minX: number; minY: number; maxX: number; maxY: number; ok: boolean; fullyOpaque: boolean } {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let sawTransparent = false

  for (let y0 = 0; y0 < h; y0 += SCAN_BAND) {
    const rows = Math.min(SCAN_BAND, h - y0)
    let data: Uint8Array
    try {
      data = new Uint8Array(w * rows * 4)
      ctrl.getPixels(0, y0, w, rows, data)
    } catch (_e) {
      break // whatever we have measured so far; the fallback below covers an empty result
    }
    for (let ry = 0; ry < rows; ry += SCAN_STRIDE) {
      const rowBase = ry * w * 4
      for (let x = 0; x < w; x += SCAN_STRIDE) {
        const a = data[rowBase + x * 4 + 3]
        if (a <= ALPHA_INK_MIN) {
          sawTransparent = true
          continue
        }
        const y = y0 + ry
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    // Nothing measured, or nothing above the threshold: use the whole image. A sticker
    // of zero size is never the right answer.
    return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1, ok: true, fullyOpaque: !sawTransparent }
  }
  // Pad by the stride so the box contains the artwork rather than clipping it.
  minX = Math.max(0, minX - SCAN_STRIDE)
  minY = Math.max(0, minY - SCAN_STRIDE)
  maxX = Math.min(w - 1, maxX + SCAN_STRIDE)
  maxY = Math.min(h - 1, maxY + SCAN_STRIDE)
  return { minX, minY, maxX, maxY, ok: true, fullyOpaque: !sawTransparent }
}


/** Millisecond wall clock, guarded — see the note in normalise(). */
function nowMs(): number {
  try {
    return Date.now()
  } catch (_e) {
    return 0
  }
}
