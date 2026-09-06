// RemotePhotoStore — the Supabase-backed PhotoStore (Pass 15).
//
// This is the swap Pass 13 was shaped for. The carousel is not touched by this file: it
// still asks count() / at(i) / remove(id) and re-lays-out on onChanged, exactly as it did
// against the in-session array. What changed is what is behind those six methods.
//
// ===========================================================================
// 1. IT DEGRADES TO PASS 13, EXACTLY
// ===========================================================================
// With no credentials this class IS SessionPhotoStore with a status line. It composes a
// real SessionPhotoStore rather than reimplementing one, so the no-credentials path is
// not a parallel code path that can rot — it is the same object doing the same work, and
// every cloud branch is guarded by one `client.available()` check that is false.
//
// Nothing fetches at boot. Uploads happen on capture, listing happens on gallery open,
// and both are no-ops without credentials. A judge cloning the public repo gets Pass 13,
// bit for bit, with one dim line saying why.
//
// ===========================================================================
// 2. THE MERGE — SESSION FIRST, ALWAYS
// ===========================================================================
// `view` is rebuilt from two lists: the session's photographs, then the cloud's. Session
// first is not a sort, it is a rule, and it is what makes "photos taken this session
// appear immediately" true: a photograph is in the carousel the instant the shutter
// closes, before a single byte has been uploaded, and it does not move when the upload
// lands or when a later listing arrives.
//
// The dedupe is by remoteId. When a session photograph's row is inserted we learn its
// uuid; any cloud row carrying that uuid is the SAME photograph seen from the other side,
// and is dropped from the cloud half. Without this, opening the gallery after a capture
// would show every photo twice — once as a local texture and once as a download of
// itself.
//
// ===========================================================================
// 3. DELETION IS REAL (PASS 36)
// ===========================================================================
// Passes 15 to 35 deleted from the view only: the anon policy set was INSERT and SELECT,
// so a row DELETE came back HTTP 200 having deleted nothing and an object DELETE came
// back 403. A cloud photograph's id went into a `hidden` set, was filtered out of every
// later listing, and came back next launch. The DELETE policies now exist
// ("custom_photos anon delete" and "custom_save anon delete"), so that whole mechanism
// is gone and delete means delete.
//
// THE ORDER IS ROW FIRST, THEN OBJECT, and it is not arbitrary. Either half can fail, so
// pick the ordering whose failure state is the harmless one:
//
//   row first  -> if the object delete then fails, an object is left in the bucket that
//                 no row points at. Nothing lists it, nothing downloads it, nobody can
//                 see it. It costs bytes.
//   object first -> if the row delete then fails, a row is left pointing at an object
//                 that is gone. That row IS listed, and it draws an "image unavailable"
//                 card — the exact damage the Pass 14 spike left behind.
//
// A leaked object is invisible; a leaked row is a broken card. So the row goes first, and
// the card is only removed once the row is PROVED gone (SupabaseClient.deleteRow, which
// does not believe status codes — see the note there). If the row survives, the card
// stays exactly where it is and the gallery says why. If the object delete fails after
// the row is gone, the photograph is already unreachable and the card does not come
// back; the leak is logged and named in the footer rather than hidden.
//
// A photograph taken THIS session that has already been uploaded is deleted the same
// way — it has a remoteId, so it has a cloud copy, and dropping only the local record
// would bring it back on the next launch.
//
// ===========================================================================
// 4. FAILURE IS A STATE, NOT AN EXCEPTION
// ===========================================================================
// Every remote call returns a CallResult and every failure lands in `cloudReachable` and
// the status line. An upload that fails leaves the photograph exactly where it is — in
// the session list, with its frozen texture, visible in the carousel — and marks it
// "failed" for the indicator. Nothing is lost and nothing is retried behind the user's
// back.

import {
  FULL_CLAIM_REVIEW,
  FULL_CLAIM_UPLOAD,
  PHOTO_THUMB_H,
  PHOTO_THUMB_W,
  PhotoDraft,
  PhotoRecord,
  PhotoStore,
  PhotoStoreEvent,
  SessionPhotoStore,
  StoreStatus,
  PHOTO_MEM_LOG,
  UploadState,
  downscaleTexture,
} from "./PhotoStore"
import { CLOUD_LIST_LIMIT, CloudPhotoRow, NO_CREDS_LINE, SupabaseClient, colorToHex, hexToColor } from "./SupabaseClient"
import { DEBUG_PHOTO_NO_UPLOAD } from "./Stickers"

// The status lines, in one place because they are the entire user-facing explanation of
// a subsystem that is otherwise invisible. Short enough to sit under the carousel.
// PASS 49: "Cloud save off — this session only" described the state and stopped there.
// The gallery is one of the two places a public clone meets it, so the line now names the
// file to fill in (NO_CREDS_LINE, shared with the import panel and the boot log).
export const LINE_NO_CREDS = NO_CREDS_LINE
export const LINE_LOADING = "Loading from cloud…"
export const LINE_UNREACHABLE = "Cloud unreachable — this session only"
/** Pass 36: delete is no longer view-only, and the line that said it was is now wrong. */
export const LINE_CLOUD = "Cloud + this session — delete removes it from the cloud too"
export const LINE_CLOUD_EMPTY = "Cloud is empty — this session only"

// Pass 36 — what the gallery says while a delete is happening, and after one that did
// not. A refusal must be visible where it was asked for, so these are shown in the
// footer, which is otherwise hidden on the glass page.
export const LINE_DELETING = "Deleting from the cloud…"
export const DELETE_FAIL_PREFIX = "Not deleted — "
export const DELETE_FAIL_SUFFIX = ". The photo is still in the cloud."
/** The row went but its object did not. The photo is unreachable; the bytes are not. */
export const DELETE_ORPHAN_OBJECT = "Deleted. One image file could not be removed from storage."
/** Pressing delete on a photograph whose upload has not finished. */
export const DELETE_NOTICE_UPLOADING = "Still uploading — try again in a moment."
/** How long a PASSING delete notice stays on screen. Failures are sticky — see notify(). */
export const DELETE_NOTICE_SEC = 6.0

/** Ids handed to cloud-backed records. Negative so they can never collide with the
 *  session store's own positive counter, whatever order things arrive in. */
const CLOUD_ID_BASE = -1

/**
 * Pass 36: print each half of a delete with its HTTP status and the evidence the client
 * used to decide it. On in shipped code — a delete is destructive and rare, it is one
 * line per press, and it is the only record of what happened to a photograph.
 */
export const DELETE_LOG = true

export class RemotePhotoStore implements PhotoStore {
  readonly onChanged = new PhotoStoreEvent()

  private session: SessionPhotoStore
  private client: SupabaseClient

  private cloud: PhotoRecord[] = []
  private view: PhotoRecord[] = []
  private nextCloudId = CLOUD_ID_BASE
  // Pass 36: `hidden` is gone. It held the ids of cloud rows deleted from the view, was
  // consulted in loadFromCloud() and in rebuild(), and existed only because the delete
  // could not reach the server. It can, now.
  /** What to say about the last delete, if anything. Cleared on a timer and on open. */
  private deleteNotice = ""
  private noticeUntil = -1
  private elapsed = 0
  /** remoteIds with a delete in flight, so a second press cannot start a second one. */
  private deleting: { [remoteId: string]: boolean } = {}

  private loading = false
  private everListed = false
  private cloudReachable = true
  private upload: UploadState = "local"

  constructor(client: SupabaseClient) {
    this.client = client
    this.session = new SessionPhotoStore()
    this.session.onChanged.add(() => this.rebuild())
    this.rebuild()
  }

  // ---------------------------------------------------------------------------
  // PhotoStore
  // ---------------------------------------------------------------------------

  count(): number {
    return this.view.length
  }

  at(i: number): PhotoRecord | null {
    if (i < 0 || i >= this.view.length) return null
    return this.view[i]
  }

  indexOf(id: number): number {
    for (let i = 0; i < this.view.length; i++) if (this.view[i].id === id) return i
    return -1
  }

  /**
   * File a new photograph. It is in the carousel before this method returns; the upload
   * is started and deliberately NOT awaited.
   */
  add(draft: PhotoDraft): PhotoRecord {
    const rec = this.session.add(draft) // fires onChanged -> rebuild()
    // PASS 19 — declare who will need the full-resolution pixels, BEFORE anything can
    // release them. The review always will: PhotoBooth prints this record 46 cm tall on
    // the very next line. The encoder only will if there is a cloud to encode for — with
    // no credentials that claim is never taken, so a credential-less session demotes the
    // photograph the moment the review closes and never holds 3.5 MB either.
    rec.fullClaims[FULL_CLAIM_REVIEW] = true
    if (this.client.available()) {
      rec.fullClaims[FULL_CLAIM_UPLOAD] = true
      this.uploadInBackground(rec)
    }
    return rec
  }

  /** Delegated to the session store, which owns the records that have full pixels. */
  releaseFull(rec: PhotoRecord, claim: string): void {
    this.session.releaseFull(rec, claim)
  }

  /**
   * Delete a photograph — for good. See note 3 for the ordering and why.
   *
   * Anything with a remoteId has a cloud copy, whichever list it is sitting in, and is
   * deleted PESSIMISTICALLY: the card stays on screen until the row is proved gone. That
   * is the whole point — removing a card while the photograph survives in the bucket is
   * the one outcome worse than not deleting at all.
   *
   * Anything without one is local and only local, and goes immediately.
   */
  remove(id: number): void {
    const at = this.indexOf(id)
    const rec = at >= 0 ? this.view[at] : null
    if (!rec) return
    if (rec.remoteId && this.deleting[rec.remoteId]) return // a press already in flight

    // An upload in flight has no remoteId YET but is about to have one. Dropping the
    // record now would let the insert land behind it and the photograph would be back on
    // the next launch, which is exactly what this pass exists to stop.
    if (rec.upload === "uploading") {
      this.notify(DELETE_NOTICE_UPLOADING, false) // passes on its own; nothing is wrong
      return
    }

    if (rec.remoteId && this.client.available()) {
      this.deleting[rec.remoteId] = true
      this.clearNotice()
      this.onChanged.invoke() // the footer says "Deleting…" on this frame
      this.deleteFromCloud(rec)
      return
    }

    this.dropLocal(rec)
  }

  /** Take a record out of whichever list holds it. Local bookkeeping only. */
  private dropLocal(rec: PhotoRecord): void {
    if (rec.origin === "session") {
      this.session.remove(rec.id) // fires onChanged -> rebuild()
      return
    }
    for (let i = 0; i < this.cloud.length; i++) {
      if (this.cloud[i].id === rec.id) {
        this.cloud.splice(i, 1)
        break
      }
    }
    this.rebuild()
  }

  /**
   * The real delete. Row first, then object — note 3 has the reasoning.
   *
   * Neither half trusts a status code: deleteRow proves the row is gone by the
   * representation it hands back or by a second SELECT, and deleteObject reads the code
   * out of storage's 400 envelope. Only a proved row removes the card.
   */
  private async deleteFromCloud(rec: PhotoRecord): Promise<void> {
    const rowId = rec.remoteId
    const path = rec.storagePath

    const row = await this.client.deleteRow(rowId)
    if (!row.ok) {
      // The photograph is still in the cloud. The card must stay, and the user must know.
      delete this.deleting[rowId]
      this.notify(DELETE_FAIL_PREFIX + row.reason + DELETE_FAIL_SUFFIX)
      this.onChanged.invoke()
      return
    }
    if (DELETE_LOG) {
      print("[DELETE] row " + rowId + " gone (HTTP " + row.status + ", proved by " + row.verified + ")")
    }

    // The row is provably gone, so nothing will ever list this photograph again. The card
    // goes now, whatever the object does next.
    this.dropLocal(rec)

    const obj = await this.client.deleteObject(path)
    if (DELETE_LOG) {
      print("[DELETE] object " + path + " -> " + (obj.ok ? "gone (" + obj.verified + ")" : "FAILED: " + obj.reason) +
        " (HTTP " + obj.status + ")")
    }
    delete this.deleting[rowId]
    if (!obj.ok) {
      // A leaked object: invisible to everything, but say so rather than pretend.
      this.notify(DELETE_ORPHAN_OBJECT)
    }
    this.onChanged.invoke()
  }

  /**
   * Say one thing about the last delete.
   *
   * `sticky` is the difference between "here is what is happening" and "here is what went
   * wrong". A refusal means the photograph the user asked to delete is STILL IN THE CLOUD,
   * and a message about that which fades after a few seconds is barely better than no
   * message: it can be missed entirely, and then the user believes a delete happened that
   * did not. So failures stay until the next thing the user does — another delete, or
   * closing and reopening the gallery — and only the passing remarks expire on their own.
   */
  private notify(line: string, sticky: boolean = true): void {
    this.deleteNotice = line
    this.noticeUntil = sticky ? -1 : this.elapsed + DELETE_NOTICE_SEC
  }

  private clearNotice(): void {
    this.deleteNotice = ""
    this.noticeUntil = -1
  }

  /** Per-frame, from the gallery. Only there to expire a non-sticky notice. */
  tick(dt: number): void {
    this.elapsed += dt
    if (this.deleteNotice && this.noticeUntil >= 0 && this.elapsed > this.noticeUntil) {
      this.clearNotice()
      this.onChanged.invoke()
    }
  }

  /** True while any delete is waiting on the server. */
  private anyDeleting(): boolean {
    for (const k in this.deleting) if (this.deleting[k]) return true
    return false
  }

  /** The gallery just opened. Re-read the cloud, if there is one. */
  refresh(): void {
    this.clearNotice() // a message about the last delete does not belong to this visit
    if (!this.client.available() || this.loading) return
    this.loading = true
    this.onChanged.invoke() // so the footer says "Loading…" on this frame
    this.loadFromCloud()
  }

  status(): StoreStatus {
    // Pass 36: a delete that did not happen outranks every other thing this line could
    // say. It is the only message here that the user has to act on.
    if (this.deleteNotice) return { cloud: this.client.available(), line: this.deleteNotice, urgent: true }
    if (!this.client.available()) return { cloud: false, line: LINE_NO_CREDS }
    if (this.anyDeleting()) return { cloud: true, line: LINE_DELETING, urgent: true }
    if (this.loading) return { cloud: false, line: LINE_LOADING }
    if (!this.cloudReachable) return { cloud: false, line: LINE_UNREACHABLE }
    if (this.everListed && this.cloud.length === 0) return { cloud: true, line: LINE_CLOUD_EMPTY }
    return { cloud: true, line: LINE_CLOUD }
  }

  lastUploadState(): UploadState {
    return this.upload
  }

  /** True when credentials exist at all — the indicator uses it to decide what to say. */
  cloudConfigured(): boolean {
    return this.client.available()
  }

  // ---------------------------------------------------------------------------
  // Out — the upload, in the background
  // ---------------------------------------------------------------------------

  /**
   * Encode, upload, insert. Fire-and-forget on purpose: nothing in the frame loop waits
   * on this, and every exit path sets a state the indicator can show.
   */
  private async uploadInBackground(rec: PhotoRecord): Promise<void> {
    if (DEBUG_PHOTO_NO_UPLOAD) { // verification only — see Stickers.ts
      this.session.releaseFull(rec, FULL_CLAIM_UPLOAD)
      this.setUpload(rec, "local")
      return
    }
    // PASS 19 — encode from fullTexture, not from `texture`. By the time this resolves,
    // `texture` may already be the 448 x 512 thumbnail (the review closed first), and
    // uploading that would quietly halve the quality of every photograph in the bucket.
    // The claim taken in add() is what guarantees fullTexture is still here to read.
    const source = rec.fullTexture ? rec.fullTexture : rec.texture
    if (!source) {
      this.session.releaseFull(rec, FULL_CLAIM_UPLOAD)
      return
    }
    this.setUpload(rec, "uploading")

    const bytes = await this.client.encodeJpeg(source)
    if (PHOTO_MEM_LOG) {
      print(
        "[PHOTOMEM] uploaded JPEG encoded from " + source.getWidth() + "x" + source.getHeight() +
        " -> " + (bytes ? bytes.length : 0) + " bytes"
      )
    }
    // The encoder is done with the pixels here, whatever happens next — the upload and the
    // row insert work on `bytes`. Releasing at the earliest honest moment is the whole
    // point, and it happens on the failure paths too so a dropped network cannot pin
    // 3.5 MB for the rest of the session.
    this.session.releaseFull(rec, FULL_CLAIM_UPLOAD)
    if (!bytes) {
      this.setUpload(rec, "failed")
      return
    }

    const path = this.client.makeObjectPath()
    const up = await this.client.uploadImage(path, bytes)
    if (!up.ok) {
      this.cloudReachable = up.status !== 0 // a status at all means we reached the server
      this.setUpload(rec, "failed")
      return
    }

    const ins = await this.client.insertRow(
      path,
      colorToHex(rec.shirtColor),
      rec.yawDeg,
      rec.stickerCount
    )
    if (!ins.ok || !ins.value) {
      // The image landed but the row did not. The photograph is safe locally either way,
      // and the orphaned object is harmless — it simply will not be listed.
      this.setUpload(rec, "failed")
      return
    }

    rec.storagePath = path
    rec.remoteId = ins.value.id
    rec.createdAtMs = parseIsoMs(ins.value.created_at) || rec.createdAtMs
    this.cloudReachable = true
    this.setUpload(rec, "saved")
  }

  private setUpload(rec: PhotoRecord, state: UploadState): void {
    rec.upload = state
    this.upload = state
    this.onChanged.invoke()
  }

  // ---------------------------------------------------------------------------
  // In — the listing
  // ---------------------------------------------------------------------------

  private async loadFromCloud(): Promise<void> {
    const res = await this.client.listPhotos(CLOUD_LIST_LIMIT)
    this.loading = false
    this.everListed = true

    if (!res.ok || !res.value) {
      this.cloudReachable = false
      this.rebuild()
      return
    }
    this.cloudReachable = true

    const rows = res.value
    const next: PhotoRecord[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const existing = this.findCloud(row.id)
      // Re-use the record — and therefore its already-downloaded Texture — so reopening
      // the gallery does not re-download every photograph.
      next.push(existing ? existing : this.recordFromRow(row))
    }
    this.cloud = next
    this.rebuild()

    // Then pull the pixels, one at a time so a dozen downloads do not all land at once.
    for (let i = 0; i < this.cloud.length; i++) {
      const rec = this.cloud[i]
      if (rec.texture || !rec.storagePath) continue
      // Skip anything the merge filtered out — a row this session uploaded is already on
      // screen as a local frozen texture, and downloading a photograph the Lens took
      // thirty seconds ago is pure waste. (Observed: 33 KB re-fetched per capture.)
      if (this.indexOf(rec.id) < 0) continue
      const tex = await this.client.fetchTexture(rec.storagePath)
      if (tex) {
        // PASS 19 — a downloaded JPEG decodes to a full 896 x 1024 RGBA8 texture, and this
        // loop holds every one of them for the session so that re-opening the gallery does
        // not re-download. That cache was costing as much as the session's own photographs
        // put together. Store the thumbnail instead: these records are only ever drawn on a
        // carousel card, they are never reviewed at 46 cm and never re-encoded, so nothing
        // downstream can tell the difference.
        const small = downscaleTexture(tex, PHOTO_THUMB_W, PHOTO_THUMB_H)
        rec.texture = small ? small : tex
      } else {
        // The row is listed but its object is gone from the bucket. Not an error worth
        // interrupting anything for — the record stays, and the caption says so.
        rec.imageMissing = true
      }
      this.onChanged.invoke() // the carousel rebinds this slot and the mount fills in
    }
  }

  private findCloud(remoteId: string): PhotoRecord | null {
    for (let i = 0; i < this.cloud.length; i++) {
      if (this.cloud[i].remoteId === remoteId) return this.cloud[i]
    }
    return null
  }

  private recordFromRow(row: CloudPhotoRow): PhotoRecord {
    return {
      id: this.nextCloudId--,
      texture: null, // filled in when the download lands, already downsampled
      // A cloud record never has full-resolution pixels in this process: the download is
      // thumbnailed on arrival and nothing here ever reviews or re-encodes it.
      fullTexture: null,
      fullClaims: {},
      takenAtSec: 0,
      shirtColor: hexToColor(row.shirt_color),
      yawDeg: row.yaw_deg,
      stickerCount: row.sticker_count,
      origin: "cloud",
      upload: "saved",
      remoteId: row.id,
      storagePath: row.storage_path,
      createdAtMs: parseIsoMs(row.created_at),
      imageMissing: false,
    }
  }

  // ---------------------------------------------------------------------------
  // The merge
  // ---------------------------------------------------------------------------

  /** Session photographs first, then the cloud's, minus anything already shown. */
  private rebuild(): void {
    const out: PhotoRecord[] = []
    const seen: { [remoteId: string]: boolean } = {}

    const local = this.session.all()
    for (let i = 0; i < local.length; i++) {
      out.push(local[i])
      if (local[i].remoteId) seen[local[i].remoteId] = true
    }
    for (let i = 0; i < this.cloud.length; i++) {
      const rec = this.cloud[i]
      if (rec.remoteId && seen[rec.remoteId]) continue
      out.push(rec)
    }
    this.view = out
    this.onChanged.invoke()
  }
}

/**
 * "2026-09-02T10:34:37.267268+00:00" -> epoch ms, or 0.
 *
 * Postgres emits SIX fractional digits and Date.parse is only specified for three, so
 * the fraction is trimmed before parsing rather than trusted — a runtime that rejects
 * the microseconds would otherwise silently produce NaN and every caption would read
 * as "unknown date".
 */
export function parseIsoMs(iso: string): number {
  if (!iso) return 0
  try {
    const trimmed = iso.replace(/(\.\d{3})\d+/, "$1")
    const t = Date.parse(trimmed)
    return isNaN(t) ? 0 : t
  } catch (_e) {
    return 0
  }
}
