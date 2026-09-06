// SupabaseClient — the only file in the project that knows HTTP exists (Pass 15).
//
// ===========================================================================
// THE ONE RULE
// ===========================================================================
// Supabase is an ENHANCEMENT, never a dependency. This repo is public and the
// credentials are not in it, so the normal state of a fresh clone is NO CREDENTIALS —
// and in that state this class must be inert in the strongest sense: it does not
// resolve a module, it does not build a URL, and above all it never issues a request
// that can fail. `available()` is checked before every call, and the constructor does
// not even ask for InternetModule unless credentials exist.
//
// That is why there is no "ping the server at boot" here. A connectivity check is a
// request that fails when there is no network, and a failed request on boot is exactly
// the broken-looking thing the constraint forbids. The Lens instead learns whether the
// cloud is reachable the first time it genuinely needs it — on the first upload, or when
// the gallery is opened — and says so honestly at that point.
//
// ===========================================================================
// WHAT THE SPIKE ESTABLISHED (Pass 14 Part A), ENCODED HERE AS DECISIONS
// ===========================================================================
//   - Uploads read /storage/v1/object/<bucket>/<path> (needs the anon INSERT policy).
//   - Downloads read /storage/v1/object/PUBLIC/<bucket>/<path>. This form serves on the
//     bucket's public flag alone — proved by fetching an object back with no credentials
//     at all and getting 200 with the full bytes — so dropping the "custom_save anon
//     read" policy on storage.objects cannot break reading photographs back. The
//     non-public form goes through RLS and WOULD break. One word, and it is the
//     difference between working today and breaking tomorrow.
//   - The project URL is normalised by baseUrl(): a pasted trailing slash otherwise
//     produces "//rest/v1/..." and a failure that looks like a bad key.
//   - JPEG at IntermediateQuality is 27 KB for the 896x1024 capture and uploads in
//     ~170 ms; PNG is 227 KB and ~464 ms. JPEG is what ships.
//   - Base64.encodeTextureAsync does not block the frame — six fired in one frame did
//     not produce a single outlier frame — so the encode is safe to run inline.

import {
  BUCKET_SAVE,
  BUCKET_UPLOAD,
  SUPABASE_ANON_KEY,
  TABLE_PHOTOS,
  baseUrl,
  hasCredentials,
} from "./SupabaseConfig"

import { DEBUG_NO_CREDS } from "./Stickers" // Pass 44: verification switch, ships false

/** JPEG rather than PNG: 27 KB against 227 KB for a visually identical product shot. */
export const UPLOAD_ENCODING = EncodingType.Jpg
export const UPLOAD_QUALITY = CompressionQuality.IntermediateQuality
export const UPLOAD_MIME = "image/jpeg"
export const UPLOAD_EXT = "jpg"
/** Everything this Lens writes lives under one prefix, so it is one selection to manage. */
export const UPLOAD_PREFIX = "photos/"
/** How many rows the gallery lists. Matches the in-session cap, so the two agree. */
export const CLOUD_LIST_LIMIT = 12
/**
 * How many objects the import panel will list. Generous, because it is a bucket someone
 * drops files into by hand and the panel pages rather than truncating meaningfully — but
 * bounded, because every one of them becomes a downloaded texture held in memory.
 */
export const IMPORT_LIST_LIMIT = 60
/** Extensions the import panel will try to load. Anything else in the bucket is skipped. */
export const IMPORT_EXTENSIONS = [".png", ".jpg", ".jpeg"]

/** Set true to print every request's status and body. Verification aid; ships false. */
export let SUPABASE_VERBOSE = false

/**
 * PASS 36 VERIFICATION ONLY (SHIPS FALSE). Send the row DELETE with a corrupted apikey,
 * so PostgREST refuses it for real. There is no other way to see a genuine refusal now
 * that the policy exists, and the failure path — the card stays, the gallery says why —
 * is the half of this feature that must not be taken on trust. Only the DELETE is
 * affected; listing and upload keep the real key.
 */
export let DEBUG_DELETE_BAD_KEY = false
export function setDeleteBadKey(v: boolean): void {
  DEBUG_DELETE_BAD_KEY = v
}
export function setSupabaseVerbose(v: boolean): void {
  SUPABASE_VERBOSE = v
}

/** One row of custom_photos, as the Lens cares about it. */
export interface CloudPhotoRow {
  id: string
  storage_path: string
  shirt_color: string
  yaw_deg: number
  sticker_count: number
  created_at: string
}

/** The shape every call returns: never throws, always reports. */
/**
 * PASS 36 — WHAT A DELETE ACTUALLY RETURNS, AND WHY A STATUS CODE IS NOT AN ANSWER.
 *
 * The Pass 14 spike found the trap and this type exists to keep anyone from walking into
 * it again: PostgREST answers a DELETE that RLS filtered away with HTTP 200 and an empty
 * body. No error, no clue, nothing deleted. Storage is differently dishonest — it wraps a
 * 403 inside a 400 envelope whose body carries the real code as a STRING field. So
 * neither service can be believed on its status line alone, and `ok` here never means
 * "the request did not error": it means THE THING IS GONE, established by evidence.
 *
 * `verified` records which evidence. "representation" is the deleted row handed back by
 * PostgREST — proof positive, the strongest thing available. "reselect" is a second
 * request that looked for the row and did not find it, which is what settles an empty
 * representation. "absent" means the target was already not there, which is a success for
 * an idempotent delete and is exactly the state the Pass 14 spike's orphaned rows are in.
 */
export type DeleteEvidence = "representation" | "reselect" | "absent" | "none"

export interface DeleteOutcome {
  /** True only when the target is provably gone. Never inferred from the status code. */
  ok: boolean
  /** The HTTP status of the delete itself, for the log. */
  status: number
  /** How `ok` was established. "none" whenever ok is false. */
  verified: DeleteEvidence
  /** Empty when ok; otherwise a short phrase fit to show a user. */
  reason: string
  /** The raw response body, truncated. For the verification log only. */
  raw: string
}

/** What a storage error envelope looks like once parsed out of its 400. */
const STORAGE_NOT_FOUND = "not_found"
/** Storage says this, and only this, when a delete really removed the object. */
export const STORAGE_DELETED_MSG = "Successfully deleted"
/** How much of a response body is kept for the log. */
const RAW_KEEP = 300

// The failure phrases. Short, in one place, and written to be READ BY THE USER on the
// gallery page — a delete that did not happen has to say so where it was asked for.
export const DELETE_REASON_NO_CREDS = "no cloud configured"
export const DELETE_REASON_NO_ROW = "no cloud row"
export const DELETE_REASON_OFFLINE = "no connection"
export const DELETE_REASON_REFUSED = "the cloud refused it"
export const DELETE_REASON_MISSING = "not found"
export const DELETE_REASON_SERVER = "the cloud errored"
export const DELETE_REASON_GENERIC = "the cloud refused it"
/** 200, empty representation, and the row is still there: the Pass 14 silent refusal. */
export const DELETE_REASON_RLS = "the cloud kept it"
export const DELETE_REASON_SURVIVED = "it is still there"
/** The delete may or may not have happened and we could not find out. Never claim success. */
export const DELETE_REASON_UNVERIFIED = "could not confirm"

/**
 * Pull the real error out of a storage response body. Storage returns
 * {"statusCode":"403","error":"Unauthorized","message":"..."} — inside an HTTP 400 — so
 * the only trustworthy code is the one in the JSON, and it is a STRING, not a number.
 * Returns empty strings for a body that carries no envelope, which is the success shape.
 */
export function parseStorageEnvelope(raw: string): { code: string; error: string; message: string } {
  const none = { code: "", error: "", message: "" }
  if (!raw) return none
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== "object") return none
    const code = o.statusCode !== undefined ? String(o.statusCode) : ""
    const err = o.error !== undefined ? String(o.error) : ""
    const msg = o.message !== undefined ? String(o.message) : ""
    // A success body is {"message":"Successfully deleted"} — a message with no error.
    if (code === "" && err === "") return none
    return { code: code, error: err, message: msg }
  } catch (_e) {
    return none
  }
}

export interface CallResult<T> {
  ok: boolean
  status: number
  value: T | null
  error: string
}

export class SupabaseClient {
  private internet: InternetModule | null = null
  private media: RemoteMediaModule | null = null
  private resolved = false

  /**
   * True when this Lens can talk to Supabase at all.
   *
   * Credentials first and the module second, because the credential check is free and
   * is the one that is false in the public-repo case.
   */
  available(): boolean {
    if (credentialsMissing()) return false // Pass 44: the harness's credential-less switch; Pass 49: one definition
    this.resolve()
    return this.internet !== null
  }

  /** Resolve the engine modules once, and only if we are going to use them. */
  private resolve(): void {
    if (this.resolved) return
    this.resolved = true
    try {
      this.internet = require("LensStudio:InternetModule") as InternetModule
    } catch (_e) {
      this.internet = null
    }
    try {
      this.media = require("LensStudio:RemoteMediaModule") as RemoteMediaModule
    } catch (_e) {
      this.media = null
    }
  }

  // ---------------------------------------------------------------------------
  // Out
  // ---------------------------------------------------------------------------

  /**
   * Encode a Texture to JPEG bytes.
   *
   * Wrapped in a Promise because everything downstream is async and a callback pair in
   * the middle of an await chain is where upload code goes to die. The encode itself is
   * the engine's, and the spike showed it does not block the frame.
   */
  encodeJpeg(texture: Texture): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      try {
        Base64.encodeTextureAsync(
          texture,
          (b64: string) => {
            try {
              resolve(Base64.decode(b64))
            } catch (_e) {
              resolve(null)
            }
          },
          () => resolve(null),
          UPLOAD_QUALITY,
          UPLOAD_ENCODING
        )
      } catch (_e) {
        resolve(null)
      }
    })
  }

  /** A storage path nothing else will collide with. */
  makeObjectPath(): string {
    const stamp = Math.floor(getTime() * 1000)
    const salt = Math.floor(Math.random() * 1000000)
    return UPLOAD_PREFIX + stamp + "-" + salt + "." + UPLOAD_EXT
  }

  /** PUT the bytes into custom_save. Needs the anon INSERT policy on storage.objects. */
  async uploadImage(path: string, bytes: Uint8Array): Promise<CallResult<string>> {
    return this.call<string>("upload " + path, async () => {
      const r = await this.internet!.fetch(
        baseUrl() + "/storage/v1/object/" + BUCKET_SAVE + "/" + path,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": UPLOAD_MIME,
            "x-upsert": "true",
          },
          body: bytes,
        }
      )
      const txt = await r.text()
      return { status: r.status, value: path, raw: txt }
    })
  }

  /** INSERT one row and return it, so the caller learns its id and created_at. */
  async insertRow(
    storagePath: string,
    shirtColorHex: string,
    yawDeg: number,
    stickerCount: number
  ): Promise<CallResult<CloudPhotoRow>> {
    return this.call<CloudPhotoRow>("insert row", async () => {
      const r = await this.internet!.fetch(baseUrl() + "/rest/v1/" + TABLE_PHOTOS, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          storage_path: storagePath,
          shirt_color: shirtColorHex,
          yaw_deg: yawDeg,
          sticker_count: stickerCount,
        }),
      })
      const txt = await r.text()
      let row: CloudPhotoRow | null = null
      try {
        const arr = JSON.parse(txt)
        if (arr && arr.length > 0) row = arr[0] as CloudPhotoRow
      } catch (_e) { /* surfaced through raw */ }
      return { status: r.status, value: row, raw: txt }
    })
  }

  // ---------------------------------------------------------------------------
  // In
  // ---------------------------------------------------------------------------

  /**
   * The objects in a bucket, by name.
   *
   * Listing (unlike reading) genuinely needs the anon SELECT policy on storage.objects,
   * even for a public bucket — which is why custom_upload keeps its policy while
   * custom_save does not need one. A bucket with no listing policy comes back as an
   * empty array rather than an error, so the caller cannot tell "empty" from "not
   * permitted"; the panel therefore says "nothing in the bucket" for both, which is the
   * honest description of what it can see.
   */
  async listBucket(bucket: string = BUCKET_UPLOAD): Promise<CallResult<string[]>> {
    return this.call<string[]>("list bucket " + bucket, async () => {
      const r = await this.internet!.fetch(baseUrl() + "/storage/v1/object/list/" + bucket, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        // Pass 41: newest first, so a file uploaded a moment ago is the first tile on the
        // first page — and stays inside IMPORT_LIST_LIMIT however full the bucket gets.
        body: JSON.stringify({ prefix: "", limit: IMPORT_LIST_LIMIT, offset: 0, sortBy: { column: "created_at", order: "desc" } }),
      })
      const txt = await r.text()
      let names: string[] | null = null
      try {
        const arr = JSON.parse(txt)
        names = []
        for (let i = 0; i < arr.length; i++) {
          const n = arr[i].name as string
          if (!n) continue
          // Storage lists "folders" as zero-metadata rows; skip those and anything that
          // is not an image the runtime can decode.
          if (!arr[i].id) continue
          const lower = n.toLowerCase()
          let okExt = false
          for (let k = 0; k < IMPORT_EXTENSIONS.length; k++) {
            if (lower.length >= IMPORT_EXTENSIONS[k].length &&
                lower.substring(lower.length - IMPORT_EXTENSIONS[k].length) === IMPORT_EXTENSIONS[k]) okExt = true
          }
          if (okExt) names.push(n)
        }
      } catch (_e) { /* surfaced through raw */ }
      return { status: r.status, value: names, raw: txt }
    })
  }

  /** The newest rows of custom_photos, newest first. */
  async listPhotos(limit: number = CLOUD_LIST_LIMIT): Promise<CallResult<CloudPhotoRow[]>> {
    return this.call<CloudPhotoRow[]>("list photos", async () => {
      const r = await this.internet!.fetch(
        baseUrl() + "/rest/v1/" + TABLE_PHOTOS +
        "?select=id,storage_path,shirt_color,yaw_deg,sticker_count,created_at" +
        "&order=created_at.desc&limit=" + limit,
        {
          method: "GET",
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: "Bearer " + SUPABASE_ANON_KEY,
          },
        }
      )
      const txt = await r.text()
      let rows: CloudPhotoRow[] | null = null
      try {
        rows = JSON.parse(txt) as CloudPhotoRow[]
      } catch (_e) { /* surfaced through raw */ }
      return { status: r.status, value: rows, raw: txt }
    })
  }

  /**
   * Download one object from custom_save and decode it into a Texture.
   *
   * PUBLIC read form — see the header note. This is the call that must keep working
   * after the "custom_save anon read" policy is dropped.
   */
  async fetchTexture(storagePath: string, bucket: string = BUCKET_SAVE): Promise<Texture | null> {
    if (!this.available() || !this.media) return null
    const res = await this.call<Uint8Array>("download " + bucket + "/" + storagePath, async () => {
      const r = await this.internet!.fetch(
        baseUrl() + "/storage/v1/object/public/" + bucket + "/" + encodeObjectPath(storagePath),
        { method: "GET" }
      )
      const bytes = r.status === 200 ? await r.bytes() : null
      return { status: r.status, value: bytes, raw: bytes ? bytes.length + " bytes" : "no body" }
    })
    if (!res.ok || !res.value) return null

    return new Promise((resolve) => {
      try {
        const resource = DynamicResource.createWithBuffer(res.value!)
        this.media!.loadResourceAsImageTexture(
          resource,
          (tex: Texture) => resolve(tex),
          (_err: string) => resolve(null)
        )
      } catch (_e) {
        resolve(null)
      }
    })
  }


  // ---------------------------------------------------------------------------
  // Delete (Pass 36) — the two halves, each of which verifies itself
  // ---------------------------------------------------------------------------

  /**
   * DELETE one row from custom_photos and PROVE it is gone.
   *
   * `Prefer: return=representation` is the whole trick. Asked for it, PostgREST returns
   * the rows it actually deleted; the Pass 14 failure mode — 200 with nothing deleted —
   * then shows up as an empty array instead of as silence. So:
   *
   *   body contains the id  -> deleted, and we are holding the proof
   *   body is []            -> RLS matched nothing... OR the server declined to return a
   *                            representation. Those are not the same thing, and the only
   *                            way to tell them apart is to LOOK, so an empty body sends
   *                            a SELECT after it. Gone means gone; still there means the
   *                            delete was refused and the caller must not remove the card.
   *   body is not JSON      -> same second look, for the same reason.
   *
   * Needs the "custom_photos anon delete" policy. Without it every delete lands in the
   * second branch and comes back ok:false — which is the correct behaviour, not a bug.
   */
  async deleteRow(rowId: string): Promise<DeleteOutcome> {
    if (!this.available()) return { ok: false, status: 0, verified: "none", reason: DELETE_REASON_NO_CREDS, raw: "" }
    if (!rowId) return { ok: false, status: 0, verified: "none", reason: DELETE_REASON_NO_ROW, raw: "" }

    const res = await this.call<string>("DELETE row " + rowId, async () => {
      const r = await this.internet!.fetch(
        baseUrl() + "/rest/v1/" + TABLE_PHOTOS + "?id=eq." + encodeURIComponent(rowId),
        {
          method: "DELETE",
          headers: {
            apikey: deleteKey(),
            Authorization: "Bearer " + deleteKey(),
            Prefer: "return=representation",
          },
        }
      )
      const txt = await r.text()
      return { status: r.status, value: txt, raw: txt }
    })

    const raw = (res.value ?? res.error ?? "").substring(0, RAW_KEEP)
    if (!res.ok) {
      // A real transport or server error. Nothing was deleted and nothing needs checking.
      return { ok: false, status: res.status, verified: "none", reason: this.deleteReason(res.status, raw), raw: raw }
    }

    // Did it hand back the row it deleted?
    let returned = 0
    let sawId = false
    try {
      const arr = JSON.parse(res.value ?? "[]")
      if (arr && arr.length !== undefined) {
        returned = arr.length
        for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === rowId) sawId = true
      }
    } catch (_e) { returned = -1 } // unparseable: fall through to the second look
    if (sawId) return { ok: true, status: res.status, verified: "representation", reason: "", raw: raw }

    // Empty or unparseable. LOOK, rather than guess — this is the Pass 14 lesson.
    const still = await this.rowExists(rowId)
    if (still === false) return { ok: true, status: res.status, verified: "reselect", reason: "", raw: raw }
    if (still === null) {
      return { ok: false, status: res.status, verified: "none", reason: DELETE_REASON_UNVERIFIED, raw: raw }
    }
    return {
      ok: false, status: res.status, verified: "none",
      reason: returned === 0 ? DELETE_REASON_RLS : DELETE_REASON_SURVIVED, raw: raw,
    }
  }

  /**
   * Is this row still in custom_photos? true / false / null when the question could not
   * be asked at all (a SELECT that itself failed proves nothing either way, and saying
   * "gone" on a dropped connection is how a photo gets removed from a view while it is
   * still in the cloud).
   */
  async rowExists(rowId: string): Promise<boolean | null> {
    const res = await this.call<string>("re-select row " + rowId, async () => {
      const r = await this.internet!.fetch(
        baseUrl() + "/rest/v1/" + TABLE_PHOTOS + "?select=id&id=eq." + encodeURIComponent(rowId),
        { method: "GET", headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY } }
      )
      const txt = await r.text()
      return { status: r.status, value: txt, raw: txt }
    })
    if (!res.ok || res.value === null) return null
    try {
      const arr = JSON.parse(res.value)
      if (!arr || arr.length === undefined) return null
      return arr.length > 0
    } catch (_e) {
      return null
    }
  }

  /**
   * DELETE one object from custom_save.
   *
   * Storage does not use RLS's silent-success trick, but it has its own: a refusal comes
   * back as HTTP 400 whose BODY carries the real code as a string — {"statusCode":"403",
   * "error":"Unauthorized",...}. So the status line says 400, the truth says 403, and a
   * plain `r.status === 200` check reads a permissions failure as a bad request.
   *
   * A missing object arrives the same way, as a 400 wrapping 404. That is NOT a failure:
   * the object is not there, which is what was asked for. It is also the state of every
   * row the Pass 14 spike left behind, whose storage_path never named a real object — so
   * treating "already absent" as success is what lets those cards be deleted at all.
   */
  async deleteObject(path: string, bucket: string = BUCKET_SAVE): Promise<DeleteOutcome> {
    if (!this.available()) return { ok: false, status: 0, verified: "none", reason: DELETE_REASON_NO_CREDS, raw: "" }
    if (!path) {
      // No object was ever uploaded for this record. Nothing to remove is a clean success.
      return { ok: true, status: 0, verified: "absent", reason: "", raw: "" }
    }

    const res = await this.call<string>("DELETE object " + bucket + "/" + path, async () => {
      const r = await this.internet!.fetch(
        baseUrl() + "/storage/v1/object/" + bucket + "/" + encodeObjectPath(path),
        {
          method: "DELETE",
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY },
        }
      )
      const txt = await r.text()
      return { status: r.status, value: txt, raw: txt }
    })

    const raw = (res.value ?? res.error ?? "").substring(0, RAW_KEEP)
    const inner = parseStorageEnvelope(raw)
    // "Object not found", however it is wrapped, means the bytes are not there.
    if (inner.code === "404" || inner.error === STORAGE_NOT_FOUND) {
      return { ok: true, status: res.status, verified: "absent", reason: "", raw: raw }
    }
    if (!res.ok || inner.code !== "") {
      const shown = inner.code !== "" ? inner.code : String(res.status)
      return { ok: false, status: res.status, verified: "none", reason: this.deleteReason(Number(shown) || res.status, raw), raw: raw }
    }
    // 2xx with no error envelope. Storage says so in words; accept either.
    return { ok: true, status: res.status, verified: "representation", reason: "", raw: raw }
  }

  /** One short phrase per failure shape, fit to put in front of a user. */
  private deleteReason(status: number, raw: string): string {
    if (status === 0) return DELETE_REASON_OFFLINE
    if (status === 401 || status === 403) return DELETE_REASON_REFUSED
    if (status === 404) return DELETE_REASON_MISSING
    if (status >= 500) return DELETE_REASON_SERVER
    return DELETE_REASON_GENERIC + " (" + status + ")" + (raw ? "" : "")
  }

  // ---------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------

  /**
   * Run one call and turn every possible outcome into a CallResult.
   *
   * Nothing in this file throws at its caller. An upload that fails must leave the Lens
   * working exactly as it does today, and the way to guarantee that is for the failure
   * to be an ordinary return value that the caller cannot forget to handle — not an
   * exception crossing an async boundary into the frame loop.
   */
  private async call<T>(
    label: string,
    fn: () => Promise<{ status: number; value: T | null; raw: string }>
  ): Promise<CallResult<T>> {
    if (!this.available()) {
      return { ok: false, status: 0, value: null, error: "no credentials" }
    }
    const t0 = getTime()
    try {
      const out = await fn()
      const ok = out.status >= 200 && out.status < 300
      if (SUPABASE_VERBOSE) {
        print(
          "[supabase] " + label + ": HTTP " + out.status + " in " +
          ((getTime() - t0) * 1000).toFixed(0) + " ms"
        )
        print("[supabase]     -> " + out.raw.substring(0, 400))
      }
      return { ok: ok, status: out.status, value: out.value, error: ok ? "" : out.raw.substring(0, 200) }
    } catch (e) {
      if (SUPABASE_VERBOSE) print("[supabase] " + label + ": THREW — " + e)
      return { ok: false, status: 0, value: null, error: "" + e }
    }
  }
}

/** The key the row DELETE goes out with. Real, unless the verification flag is on. */
function deleteKey(): string {
  return DEBUG_DELETE_BAD_KEY ? SUPABASE_ANON_KEY.substring(0, SUPABASE_ANON_KEY.length - 6) + "BADKEY" : SUPABASE_ANON_KEY
}

/** vec4 colour -> "#rrggbb", which is what custom_photos.shirt_color holds. */
export function colorToHex(c: vec4): string {
  const hex = (v: number) => {
    const n = Math.max(0, Math.min(255, Math.round(v * 255)))
    const s = n.toString(16)
    return s.length < 2 ? "0" + s : s
  }
  return "#" + hex(c.x) + hex(c.y) + hex(c.z)
}

/** "#rrggbb" -> vec4, for a row coming back the other way. */
export function hexToColor(hex: string): vec4 {
  const h = hex.charAt(0) === "#" ? hex.substring(1) : hex
  if (h.length < 6) return new vec4(1, 1, 1, 1)
  const p = (i: number) => parseInt(h.substring(i, i + 2), 16) / 255
  return new vec4(p(0), p(2), p(4), 1)
}

/**
 * Percent-encode a storage path WITHOUT destroying its slashes.
 *
 * PASS 19 — a bug found while measuring the gallery, not a new feature. Every object this
 * Lens uploads is written under UPLOAD_PREFIX ("photos/"), so every storagePath contains a
 * slash; the download URL was built with encodeURIComponent, which turns that slash into
 * %2F, and Supabase's public-object endpoint answers a path with an encoded separator
 * with HTTP 400. Measured on a real gallery open: five listed rows, five 400s, five
 * photographs drawn as "image missing" mounts. Rows uploaded before the prefix existed
 * have no slash and were the only ones that ever came back.
 *
 * Encoding segment by segment keeps the separators and still escapes anything else.
 */
export function encodeObjectPath(path: string): string {
  const parts = path.split("/")
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) out.push(encodeURIComponent(parts[i]))
  return out.join("/")
}

// =============================================================================
// PASS 49 — THE CREDENTIAL-LESS STATE, SAID IN WORDS
// =============================================================================
// The shipped SupabaseConfig.ts carries two empty strings, so a public clone boots with
// the cloud off. Pass 44 made that state SAFE — every remote branch is skipped, nothing
// is requested, nothing crashes. What it did not do is make the state LEGIBLE: the
// interface said "Lib off" and "Cloud save off", which tells you it is off and not one
// thing about what to do. These constants are the sentence that closes that gap, in one
// place so the boot log, the gallery footer and the import panel cannot drift apart.
//
// The file is named with its path from the project root, because that is what someone
// who has just cloned the repo has in front of them.

/** The one file that carries the two values, as a path someone can paste into an editor. */
export const CONFIG_FILE = "Assets/Scripts/SupabaseConfig.ts"

/** The on-screen line. Short enough for a footer, specific enough to act on. */
export const NO_CREDS_LINE = "Cloud save off — fill in " + CONFIG_FILE

/**
 * The boot line: what is empty, where it lives, and what filling it in turns on. One
 * line, printed once at start-up — never per frame, never per request.
 */
export const NO_CREDS_TAG = "[custom-studio] "
export const NO_CREDS_BOOT_LINE =
  "Supabase is off: SUPABASE_URL and SUPABASE_ANON_KEY are empty in " + CONFIG_FILE +
  ". Fill both in to turn on cloud photo save, the gallery's cloud list and the My lib " +
  "sticker import. Everything else in the Lens works without them."

/**
 * True when the cloud is off because the config is empty (or the verification switch is
 * on) — as opposed to off because the network is unreachable, which is a different
 * message. This is the condition the new wording is shown for.
 */
export function credentialsMissing(): boolean {
  return DEBUG_NO_CREDS || !hasCredentials()
}

/** Print the boot line, once, if there are no credentials. Called from the orchestrator. */
export function logCredentialState(): void {
  if (credentialsMissing()) print(NO_CREDS_TAG + NO_CREDS_BOOT_LINE)
}

/** The same explanation, printed when a page that needs the cloud is opened without it. */
export function logNoCredentialsOn(page: string): void {
  if (credentialsMissing()) print(NO_CREDS_TAG + page + " opened with no credentials. " + NO_CREDS_BOOT_LINE)
}
