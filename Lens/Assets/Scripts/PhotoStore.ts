// PhotoStore — where photographs come from, behind one small interface (Pass 13).
//
// ===========================================================================
// THE POINT OF THIS FILE
// ===========================================================================
// The gallery in Pass 13 reads an in-session array. In a couple of days it reads
// Supabase. That swap must not be a rewrite of the carousel, so the carousel is not
// allowed to know where photos live: it talks to `PhotoStore`, an interface with six
// methods, and `SessionPhotoStore` below is simply the first implementation of it.
//
// The interface is shaped for a REMOTE store even though the only implementation today
// is local. Three decisions carry that:
//
//   1. NEWEST FIRST, BY INDEX. `at(0)` is the newest photo and `count()` is how many
//      there are. That is a page of a query — `order by taken_at desc limit n` — and
//      not "the array, which you may now iterate". A remote store answers it from a
//      cache of the last page it fetched, and nothing above it changes.
//
//   2. `texture` MAY BE NULL. A local photo has its pixels the instant it exists; a
//      remote one has a URL and a download. So the record type says the pixels are
//      optional from the start and the carousel already draws a placeholder frame for
//      a record whose texture has not arrived — which is exactly the state a remote
//      store spends its first second in. Nothing about that path is speculative: it is
//      the path the empty slot already takes today.
//
//   3. CHANGES ARE PUSHED, NOT POLLED. `onChanged` fires whenever the contents change,
//      and the carousel relays that straight into a re-layout. A local store fires it
//      synchronously inside add/remove. A remote store fires it when a fetch lands, a
//      realtime row arrives, or a delete is confirmed by the server. The carousel is
//      already written as "re-read the store and re-lay-out", so an asynchronous
//      arrival is not a new case for it.
//
// What is deliberately NOT in the interface: anything that returns the backing array,
// anything that takes an "oldest-first" index, and anything synchronous that a network
// cannot answer. `remove` returns void rather than a boolean for the same reason — a
// remote delete is optimistic locally and confirmed by an `onChanged` later.
//
// SWAPPING IT. `new SupabasePhotoStore(...)` in ScarfCustomizer.buildScene, handed to
// PhotoBooth in place of the SessionPhotoStore it makes today. PhotoBooth's `add` call
// becomes an upload; everything the gallery does is already interface-only.

/**
 * One photograph.
 *
 * `texture` is the frozen, independent copy — nothing redraws it — or null when the
 * pixels are not (yet) available, which is the normal state of a remote record that
 * has not finished downloading.
 *
 * The rest is the state the shot was taken in, recorded at the shutter rather than
 * recovered later, because by the time a gallery is browsed the shirt has moved on. It
 * is what the gallery captions each frame with, what a remote store would serialise
 * into a row, and — see the persistence note in PhotoGallery — the only part of a
 * photograph that a string-only local store could ever have kept.
 */
export interface PhotoRecord {
  id: number
  texture: Texture | null
  takenAtSec: number
  shirtColor: vec4
  yawDeg: number
  stickerCount: number

  // --- Pass 15. Where this photograph came from and what happened to it. ---
  /**
   * PASS 19 — THE FULL-RESOLUTION PIXELS, held only while something still needs them.
   *
   * `texture` is what the UI draws and is eventually a PHOTO_THUMB_W x PHOTO_THUMB_H
   * thumbnail. `fullTexture` is the 896x1024 frozen capture, and it exists for exactly
   * two consumers: the single-photo review (which prints it 46 cm tall) and the JPEG
   * encoder (which must upload full quality). Both announce themselves in `fullClaims`;
   * when the last claim is released the store downsamples once, points `texture` at the
   * thumbnail and drops this reference, and the 3.5 MB becomes garbage.
   *
   * Null the moment that has happened, and null from birth on a cloud record, which never
   * had full-resolution pixels in this process to begin with.
   */
  fullTexture: Texture | null
  /**
   * Who still needs `fullTexture`. Keys are FULL_CLAIM_* — a set rather than a counter so
   * a double release is harmless, which matters because the review and the upload finish
   * in either order and neither knows about the other.
   */
  fullClaims: { [claim: string]: boolean }

  /** "session" = taken on this device just now. "cloud" = listed out of custom_photos. */
  origin: PhotoOrigin
  /** What the upload did. Always "local" when there are no credentials. */
  upload: UploadState
  /** custom_photos.id once the row exists, "" otherwise. Also the dedupe key. */
  remoteId: string
  /** custom_save object path once uploaded, "" otherwise. */
  storagePath: string
  /** created_at as epoch ms, or the capture's wall clock for a session photo. 0 = unknown. */
  createdAtMs: number
  /**
   * True when this record's image was asked for and could not be had — a row whose
   * object is no longer in the bucket. The carousel already draws an empty mount for a
   * null texture; this is what lets it say WHY instead of looking broken.
   */
  imageMissing: boolean
}

/** Where a record came from. */
export type PhotoOrigin = "session" | "cloud"

/**
 * What happened to a photograph's upload.
 *
 * "local" is not a failure — it is the honest state of every photograph when the Lens
 * is running without credentials, which is the state a judge cloning the repo will see.
 * It is deliberately distinct from "failed", which means an upload was attempted.
 */
export type UploadState = "local" | "uploading" | "saved" | "failed"

/**
 * What the gallery says about where its contents came from. One short sentence, shown
 * under the carousel, so the user is never guessing whether a photo is safe or whether
 * deleting it did what they think.
 */
export interface StoreStatus {
  /** True when the cloud is configured AND answering. */
  cloud: boolean
  /** The line to show. Already user-facing prose. */
  line: string
  /**
   * Pass 36: this line is about something that just happened and the user may need to act
   * on — a delete in flight, or one the cloud refused. The glass gallery hides its footer
   * by default (Pass 34) and shows it only for these, so a refused delete cannot be
   * silent while every ordinary source line stays out of the way.
   */
  urgent?: boolean
}

/** What a record needs to be created from; the store assigns the id. */
export interface PhotoDraft {
  texture: Texture | null
  takenAtSec: number
  shirtColor: vec4
  yawDeg: number
  stickerCount: number
}

/**
 * The gallery's whole view of the world. Six methods, all of them answerable by a
 * remote store from a cached page.
 */
export interface PhotoStore {
  /** How many photographs are available. */
  count(): number
  /** The i-th photograph, NEWEST FIRST. Out of range returns null. */
  at(i: number): PhotoRecord | null
  /** Index of the record with this id, newest-first, or -1. */
  indexOf(id: number): number
  /** File a new photograph and return it. Newest, so it lands at index 0. */
  add(draft: PhotoDraft): PhotoRecord
  /** Remove one photograph by id. Unknown ids are ignored. */
  remove(id: number): void
  /** Fired after any change to the contents. The gallery re-reads and re-lays-out. */
  readonly onChanged: PhotoStoreEvent

  /**
   * "Now would be a good time to re-read the source." Called when the gallery opens.
   *
   * A hint, not a command, and deliberately synchronous-returning: a local store ignores
   * it, a remote one starts a fetch and fires onChanged when it lands. Nothing waits.
   */
  refresh(): void

  /** One sentence about where the contents came from — see StoreStatus. */
  status(): StoreStatus

  /**
   * Pass 36: per-frame, from the gallery while it is open. Optional because only a store
   * with timed messages of its own needs it — the session store has none and does not
   * implement it.
   */
  tick?(dt: number): void

  /**
   * The state of the most recent upload, for the discreet indicator by the shutter.
   * Always "local" for a store that does not upload.
   */
  lastUploadState(): UploadState

  /**
   * "I no longer need this photograph's full-resolution pixels."
   *
   * Called by the review when it closes and by the uploader when it has encoded. When the
   * last claim goes, the store swaps in a thumbnail and releases the full capture. Calling
   * it with a claim that was never held, or twice, is a no-op — see PhotoRecord.fullClaims.
   */
  releaseFull(rec: PhotoRecord, claim: string): void
}

/**
 * The smallest event that does the job — the project's other events come from SIK and
 * UIKit, and a store has no business importing either.
 */
export class PhotoStoreEvent {
  private handlers: (() => void)[] = []
  add(h: () => void): void {
    this.handlers.push(h)
  }
  invoke(): void {
    for (let i = 0; i < this.handlers.length; i++) this.handlers[i]()
  }
}

/**
 * How many photographs are kept. The cap exists so an hour of shutter presses does not
 * accumulate frozen textures without bound; a remote store would keep the same number
 * RESIDENT and page the rest.
 *
 * Pass 19: 12 -> 10, alongside the thumbnail policy below. The cap alone was never the
 * real answer — 12 full captures is 42 MB and 10 is still 35 — but it is the backstop
 * that makes the worst case a fixed number rather than a function of how long someone
 * plays with the shutter.
 */
export const PHOTO_STORE_MAX = 10

// ===========================================================================
// PASS 19 — WHAT A PHOTOGRAPH COSTS AFTER IT HAS BEEN TAKEN
// ===========================================================================
// A capture freezes an independent 896 x 1024 RGBA8 copy of the render target: 3.5 MB,
// and until this pass it was held at that size for the whole session. Twelve of them is
// 42 MB, and browsing the cloud gallery added a decoded 896 x 1024 texture per listed
// row on top of that. It was the largest allocation in the Lens by a wide margin.
//
// The observation that fixes it: the full-resolution pixels have exactly TWO consumers,
// and both are finished with them within a second of the shutter.
//
//   the review   prints the photograph 46 cm tall, once, immediately after capture
//   the encoder  turns it into a full-quality JPEG for Supabase, once
//
// Everything after that — the carousel, every re-open of the gallery, the whole rest of
// the session — draws it at 32 cm on a card. So the record keeps a THUMBNAIL and the
// full capture is released as soon as the last of those two lets go.
//
// WHY 448 x 512 AND NOT SMALLER. Half in each axis, a quarter of the bytes, and still
// oversampled for both surfaces: the review's 46 cm print covers roughly 69% of the
// frame height, and the carousel's card is 32 cm. Going to a quarter (224 x 256) would
// put the review at about 1:1 with no headroom for a sharper display or a viewer leaning
// in, and would save 0.66 MB per photo against a budget the halving already fixes.
//
// The aspect is PHOTO_RT_W : PHOTO_RT_H exactly, so the box filter below is a clean 2x2
// and no resampling artefacts are possible.
export const PHOTO_THUMB_W = 448
export const PHOTO_THUMB_H = 512

/** Claim keys for PhotoRecord.fullClaims. */
export const FULL_CLAIM_REVIEW = "review"
export const FULL_CLAIM_UPLOAD = "upload"

/**
 * Downsample a texture by an integer factor with a box filter, into a new independent
 * texture. Returns null if the source cannot be read, in which case the caller keeps
 * what it had — degrading to the pre-Pass-19 behaviour rather than losing a photograph.
 *
 * WHY THE PIXELS GO THROUGH THE CPU. The alternative is a second render target and an
 * ortho camera, which is how the sticker bake works — but that costs a permanent 0.875 MB
 * target and a camera to save a one-off cost, and it lands a frame late, which would make
 * the release asynchronous for no benefit. This runs once per photograph, on the frame the
 * review is dismissed, which is already a transition.
 *
 * A source whose control is not procedural (a decoded JPEG from the cloud) is copied into
 * one first — that copy is transient and released on return.
 */
/**
 * Print what each photograph costs, as it is taken and as it is released. Ships false;
 * flip it to re-measure after any change to the capture size or the thumbnail size.
 */
export const PHOTO_MEM_LOG = false

export function downscaleTexture(src: Texture, dstW: number, dstH: number): Texture | null {
  const t0 = PHOTO_MEM_LOG ? getTime() : 0
  try {
    const sw = src.getWidth()
    const sh = src.getHeight()
    if (sw <= 0 || sh <= 0) return null
    if (sw <= dstW || sh <= dstH) return null // already at or below the target: keep it

    // Integer box factors. Anything else falls back to point sampling, which is still
    // correct, just less smooth — no garment asset produces that case today.
    const kx = Math.max(1, Math.floor(sw / dstW))
    const ky = Math.max(1, Math.floor(sh / dstH))

    let readable = src
    let ctrl = src.control as ProceduralTextureProvider
    if (!ctrl || typeof (ctrl as any).getPixels !== "function") {
      readable = ProceduralTextureProvider.createFromTexture(src)
      ctrl = readable.control as ProceduralTextureProvider
    }
    if (!ctrl || typeof (ctrl as any).getPixels !== "function") return null

    const srcBuf = new Uint8Array(sw * sh * 4)
    ctrl.getPixels(0, 0, sw, sh, srcBuf)

    const w = Math.floor(sw / kx)
    const h = Math.floor(sh / ky)
    const dst = new Uint8Array(w * h * 4)
    const n = kx * ky
    for (let y = 0; y < h; y++) {
      const oRow = y * w * 4
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0
        const sx0 = x * kx
        const sy0 = y * ky
        for (let j = 0; j < ky; j++) {
          let i = ((sy0 + j) * sw + sx0) * 4
          for (let k = 0; k < kx; k++) {
            r += srcBuf[i]; g += srcBuf[i + 1]; b += srcBuf[i + 2]; a += srcBuf[i + 3]
            i += 4
          }
        }
        const o = oRow + x * 4
        dst[o] = (r / n) | 0
        dst[o + 1] = (g / n) | 0
        dst[o + 2] = (b / n) | 0
        dst[o + 3] = (a / n) | 0
      }
    }

    const out = ProceduralTextureProvider.createWithFormat(w, h, TextureFormat.RGBA8Unorm)
    ;(out.control as ProceduralTextureProvider).setPixels(0, 0, w, h, dst)
    if (PHOTO_MEM_LOG) {
      print(
        "[PHOTOMEM] downscaled " + sw + "x" + sh + " -> " + w + "x" + h +
        "  (" + ((sw * sh * 4) / 1048576).toFixed(2) + " MB -> " +
        ((w * h * 4) / 1048576).toFixed(2) + " MB) in " +
        ((getTime() - t0) * 1000).toFixed(0) + " ms"
      )
    }
    return out
  } catch (_e) {
    return null
  }
}

/**
 * The in-session implementation: an array, newest at the front.
 *
 * Newest-at-the-front rather than push-and-reverse, because `at(0)` is the hot path
 * (the carousel asks for it every frame) and because it makes the eviction of the
 * oldest a `pop()`.
 */
export class SessionPhotoStore implements PhotoStore {
  readonly onChanged = new PhotoStoreEvent()

  private records: PhotoRecord[] = []
  private nextId = 1

  count(): number {
    return this.records.length
  }

  at(i: number): PhotoRecord | null {
    if (i < 0 || i >= this.records.length) return null
    return this.records[i]
  }

  indexOf(id: number): number {
    for (let i = 0; i < this.records.length; i++) {
      if (this.records[i].id === id) return i
    }
    return -1
  }

  add(draft: PhotoDraft): PhotoRecord {
    const rec: PhotoRecord = {
      id: this.nextId++,
      texture: draft.texture,
      takenAtSec: draft.takenAtSec,
      shirtColor: draft.shirtColor,
      yawDeg: draft.yawDeg,
      stickerCount: draft.stickerCount,
      // Born holding its own full-resolution pixels. Claims are set by the caller — see
      // RemotePhotoStore.add, which knows whether an upload will want them.
      fullTexture: draft.texture,
      fullClaims: {},
      origin: "session",
      upload: "local",
      remoteId: "",
      storagePath: "",
      createdAtMs: wallClockMs(),
      imageMissing: false,
    }
    this.records.unshift(rec)
    // Oldest out first, so the newest N are always the ones kept.
    while (this.records.length > PHOTO_STORE_MAX) this.records.pop()
    this.onChanged.invoke()
    return rec
  }

  remove(id: number): void {
    const i = this.indexOf(id)
    if (i < 0) return
    this.records.splice(i, 1)
    this.onChanged.invoke()
  }

  /** Nothing to re-read: the array IS the source. */
  refresh(): void { /* no-op */ }

  status(): StoreStatus {
    return { cloud: false, line: SESSION_ONLY_LINE }
  }

  lastUploadState(): UploadState {
    return "local"
  }

  /**
   * Drop one claim on a record's full-resolution pixels, and demote it when that was the
   * last one: build the thumbnail, point `texture` at it, and let go of the capture.
   *
   * The swap is what actually frees the memory — `fullTexture` and `texture` start out
   * pointing at the SAME object, so clearing one reference on its own frees nothing.
   * If the downsample fails the record simply keeps the full texture as its display
   * texture, which is exactly what every photograph did before this pass.
   */
  releaseFull(rec: PhotoRecord, claim: string): void {
    if (!rec.fullClaims[claim]) return
    delete rec.fullClaims[claim]
    for (const k in rec.fullClaims) {
      if (rec.fullClaims[k]) return // somebody else is still printing or encoding it
    }
    if (!rec.fullTexture) return
    const thumb = downscaleTexture(rec.fullTexture, PHOTO_THUMB_W, PHOTO_THUMB_H)
    if (thumb) rec.texture = thumb
    rec.fullTexture = null
    this.onChanged.invoke() // the carousel rebinds the slot; see PhotoGallery's boundTex
  }

  /** Direct access to the backing list, for a wrapper that composes this store. */
  all(): PhotoRecord[] {
    return this.records
  }
}

/** What a session-only gallery says about itself. */
export const SESSION_ONLY_LINE = "This session only"

/**
 * Wall-clock time in epoch milliseconds, or 0 if the runtime has no usable clock.
 *
 * Guarded rather than trusted: `Date` comes from the language, not from the Lens API, so
 * a runtime is free to stub it. Anything before the year 2000 is treated as "no clock"
 * and every caller degrades to a relative label instead of printing 1970.
 */
const CLOCK_SANITY_MS = 946684800000 // 2000-01-01T00:00:00Z

export function wallClockMs(): number {
  try {
    const t = Date.now()
    return t > CLOCK_SANITY_MS ? t : 0
  } catch (_e) {
    return 0
  }
}
