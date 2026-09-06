// ImportPanel — bring artwork in from the custom_upload bucket (Pass 16, point 2).
//
// ===========================================================================
// 1. WHY A GRID AND NOT A CAROUSEL
// ===========================================================================
// The photo gallery is a carousel because its content is PHOTOGRAPHS: you look at one,
// large, and the ones either side are context. Choosing a sticker is the opposite task —
// you are scanning a set for the one you want, and the question "which of these" is
// answered fastest when they are all in front of you at once.
//
// A grid also handles an UNKNOWN COUNT better, which is what a bucket someone drops files
// into actually is. A carousel of one is a strange, lonely thing and a carousel of forty
// is forty arrow presses; a grid of one is a single tile in the corner and a grid of
// forty is five pages. The layout does not change shape with the count, only how much of
// it is filled — so there is no count at which it starts looking wrong.
//
// Paging rather than scrolling, because a scroll needs a drag gesture that competes with
// every other drag in this project (the platform, the sticker, the resize handle), and
// two arrow chips reuse a control the gallery already taught.
//
// ===========================================================================
// 2. EVERY IMAGE IS NORMALISED BEFORE IT IS EVER PLACEABLE
// ===========================================================================
// A downloaded texture is not a sticker. It goes through StickerImport.normalise(),
// which measures its alpha bounds and hands back a StickerArt carrying a quad whose UVs
// are those bounds plus the aspect derived from them. The thumbnail in the grid is drawn
// from that SAME StickerArt, at that same aspect — so the tile is a true preview of what
// lands on the shirt, and if the trim were wrong you would see it here first.
//
// ===========================================================================
// 3. PASS 41 — THE LISTING IS FRESH ON EVERY OPEN
// ===========================================================================
// Until this pass the bucket was listed ONCE, on the first open (loadStarted), and every
// later open showed that first listing: a sticker uploaded after the panel had been opened
// once did not exist as far as the Lens was concerned until the Lens restarted. That is
// exactly the shot the demo needs — upload from the web app, open the panel, place it —
// so open() now re-lists custom_upload every time (refresh), and RECONCILES rather than
// reloads: names already downloaded keep their normalised StickerArt (no flicker, no
// second download), names that are new are fetched and normalised as they land, names
// that have gone are dropped, and the order follows the fresh listing — newest first, as
// SupabaseClient.listBucket now asks. An open while a refresh is still in flight queues
// one more refresh for when it finishes, so an upload that lands mid-download is caught
// on the next open too. Nothing else caches: SupabaseClient.fetchTexture is a plain GET
// of the object's public URL, and a new file is a new URL. (The one thing outside the
// Lens's control: Supabase's CDN caches a public object by URL, so RE-UPLOADING UNDER THE
// SAME NAME can serve the old bytes for a while — a new upload should have a new name.)
//
// ===========================================================================
// 4. WITHOUT CREDENTIALS THE + IS INERT AND SAYS SO
// ===========================================================================
// Same rule as the rest of Pass 15: a public repo has no credentials, and the button
// must not look broken. So the plate is drawn dimmed, a short line under it reads
// "Import off", and the tap handler returns immediately — no request, no retry, no
// spinner that never resolves. A listing that fails with credentials present is the same
// shape of answer, in the panel rather than on the button.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { buildRing, buildTriangle } from "./Geo"
import { LAYERS, ViewportLayers, setLayerDeep } from "./Layers"
import { StickerArt } from "./Stickers"
import { normalise } from "./StickerImport"
import { CONFIG_FILE, SupabaseClient, credentialsMissing, logNoCredentialsOn } from "./SupabaseClient" // Pass 49
import { BUCKET_UPLOAD } from "./SupabaseConfig"
import {
  addFlatShape,
  addLabel,
  makePlateButton,
  setShapeColor,
  uiDisc,
  uiQuad,
  CHIP_EDGE,
  CHIP_FILL,
  CHIP_GLYPH,
  GLYPH_COL,
  LABEL_COL,
  LABEL_DIM_COL,
  PLATE_COL,
  PLATE_GLYPH_SCALE,
  PLATE_R,
  PRINT_COL,
  QUAD_MAT,
  addButtonWord,
  WIDE_BTN_H,
  WIDE_BTN_GLYPH_X,
  addHeadPill,
  addBackCircle,
  BACK_CIRCLE_POS,
  HEAD_Y,
  HEAD_PILL_H,
  WIDE_BTN_WORD_X,
  WIDE_BTN_TEXT_SIZE,
  requestButtonCentring,
  uiRoundRect,
  uiRoundRing,
  WIDE_BTN_W,
  WIDE_BTN_R,
  setTextColor, // Pass 43
  stackVisual,
} from "./PhotoUi"
import { GLASS, pick, raiseAbovePlate, UI_COL_X, UI_BTN_DX } from "./UiTheme"
import { IMP_SLOT_H, SLOT_BTN_W, SLOT_BTN_X, SLOT_BTN_R, SLOT_BTN_HIT } from "./StickerTrayUI"

// --- The + button (under the sticker tray) ------------------------------------
// Mirrors the photo button's height on the other side of the composition: the tray
// panel is 11 x 33 centred at x +21, so it spans y -16.5..+16.5 and this tucks below it
// at exactly the height of the shutter on the left. The two sides of the UI then have
// their controls on the same line.
// Pass 32 (glass): the button left the tray. It is the top of the right column, stacked with
// Add text the way Photo and Gallery are stacked on the left: same size, same pitch.
const IMP_BTN_CENTER = new vec3(UI_COL_X + UI_BTN_DX, pick(-19.2, -19.0), -110)
const IMP_BTN_HIT_GLASS = new vec3(10.4, 4.5, 3)
// The + glyph: two bars, drawn like every other glyph in this project.
const IMP_PLUS_LEN = 2.5
const IMP_PLUS_BAR = 0.44
// Pass 25 (glass): the reference's Import button — INSIDE the sticker tray, in the slot
// the tray reserves under its fifth tile (StickerTrayUI.getImportSlot), the + above the
// word, in the accent gradient. Its hit box is the slot plus a little (IMP_HIT), which
// keeps it clear of the tile above; in classic nothing here changes.
const IMP_PLUS_X = pick(0, WIDE_BTN_GLYPH_X)
const IMP_PLUS_Y = pick(0, 0)
const IMP_PLUS_SCALE = pick(PLATE_GLYPH_SCALE, 0.72) // Pass 33: 2.5 x 0.72 = 1.8, the glyph box
// PASS 44 — THE WORD. "+ Import" promised a file browser. What the button opens is the
// stickers already uploaded from the web app — the panel's own head pill says "Uploaded
// stickers" — so the button now says what it opens: the user's own stickers. Nothing is
// picked from disk and nothing is promised. (Pass 25 made the words English throughout.)
// Pass 45: "My lib" — the same promise in a word that fits the family's pad. The glyph is
// a LIBRARY now, not a plus: a 2 x 2 grid of tiles, the panel's own grid in miniature (a
// plus says "add a new file"; a grid of images says "the images you already have").
const IMP_WORD = "My lib"
// PASS 46 — the library glyph as Refs/ui_btn draws it, measured (cm at 91.4 px/cm): a
// FOLDER 1.55 wide, 1.09 tall including a 0.55-wide tab at its top left, with a PICTURE
// CARD 1.00 wide over its lower right — the card starts 0.67 in from the folder's left
// edge and 0.10 under the icon's top, and its pointed bottom reaches 0.19 under the
// folder's; a dot sits in the card's upper half. The reference's card is a mid grey on a
// dark folder; here, light glyph on a dark plate, the card is the mid tone between them.
// The whole icon is 1.55 x 1.28, the same box as the camera and the frame.
const IMP_LIB_FOLDER = new vec2(1.55, 0.95)
const IMP_LIB_TAB = new vec2(0.55, 0.14)
const IMP_LIB_CARD = new vec2(1.0, 0.92)
const IMP_LIB_CARD_DX = 0.67
const IMP_LIB_CARD_TOP = 0.10
const IMP_LIB_POINT_H = 0.26
const IMP_LIB_POINT_W = 0.5
const IMP_LIB_DOT_R = 0.13
const IMP_LIB_DOT_DY = 0.30 // under the card's top
const IMP_LIB_R = 0.12 // the folder's and the card's corner radius
const IMP_LIB_CARD_COL = new vec4(0.56, 0.58, 0.66, 1)
const IMP_WORD_Y = 0
const IMP_WORD_SIZE = WIDE_BTN_TEXT_SIZE // Pass 37: the family's word size, not a second copy of it
const IMP_BTN_R = pick(SLOT_BTN_R, WIDE_BTN_R)
const IMP_HIT = pick(SLOT_BTN_HIT, IMP_BTN_HIT_GLASS)
const IMP_SLOT_Z = 0.3 // in front of the tray's content plane
// The inert label, in the same grey and the same place as "Cloud save off"; in glass it
// sits just under the tray's bottom edge.
const IMP_LABEL_DY = pick(-(PLATE_R + 2.05), -(IMP_SLOT_H / 2 + 1.25))
const IMP_LABEL_SIZE_GLASS = 34
const IMP_LABEL_SIZE = 44
// Pass 44: the credential-less word follows the button's word ("Stickers off" beside
// "My stickers", the way "Cloud save off" sits beside the shutter), not the old verb.
const IMP_OFF_WORD = "Lib off" // Pass 45: follows "My lib"
const IMP_DIM = 0.45 // how far the plate and glyph are knocked back when inert

// --- The panel ----------------------------------------------------------------
const IMP_Z = -100
// Pass 32 (glass, Refs/ui_import): four columns of rounded dark tiles, each sticker in its
// own frame, under the family's head pill ("Uploaded stickers" with the count) and Back circle.
const IMP_CENTER_Y = pick(1.5, 5.0)
const IMP_COLS = pick(3, 4)
const IMP_ROWS = 3
const IMP_PAGE = IMP_COLS * IMP_ROWS
const IMP_CELL = pick(10.0, 7.4) // the square a thumbnail is fitted into, in cm
const IMP_GAP = pick(2.4, 1.6)
const IMP_TILE_PAD = 0.7 // the tile past the thumbnail square (glass)
const IMP_TILE_R = 1.6
const IMP_TILE_FILL = new vec4(0.05, 0.05, 0.08, 0.88)
const IMP_TILE_RIM = new vec4(1, 1, 1, 0.26)
const IMP_TILE_RIM_T = 0.14
const IMP_HEAD_WORD = "Uploaded stickers"
const IMP_HEAD_GAP = 2.2 // head pill to the first row (glass)
const IMP_GRID_TOP_Y = HEAD_Y - HEAD_PILL_H / 2 - IMP_HEAD_GAP
const IMP_MOUNT_PAD = 0.5 // white mount around each thumbnail
// Grid extent, derived so the constants above are the only things to tune.
const IMP_GRID_W = IMP_COLS * IMP_CELL + (IMP_COLS - 1) * IMP_GAP
const IMP_GRID_H = IMP_ROWS * IMP_CELL + (IMP_ROWS - 1) * IMP_GAP

// Title and footer hug the rows actually in use, not the maximum grid — see layout().
const IMP_TITLE_GAP = 3.4
const IMP_TITLE_SIZE = 76
const IMP_FOOT_GAP = 3.6
const IMP_FOOT_SIZE = 52
const IMP_CHIP_GAP = 2.4 // clear space between the grid's edge and the close chip

const IMP_CHIP_R = 1.3
const IMP_CHIP_RING = 0.11
const IMP_CHIP_HIT = new vec3(4.0, 4.0, 3)
const IMP_CLOSE_BAR = 0.15
const IMP_CLOSE_LEN = 1.36
const IMP_ARROW_R = 1.45
const IMP_ARROW_X = IMP_GRID_W / 2 + 3.2
const IMP_ARROW_TRI = new vec2(1.12, 1.32)
const IMP_ARROW_HIT = new vec3(4.8, 4.8, 3)

const IMP_BLOCK_Z = -101
const IMP_BLOCK_SIZE = 300

// The words. Short, and each one says what the Lens actually knows.
const IMP_TITLE = "Import artwork"
const IMP_LINE_LOADING = "Loading from your bucket…"
const IMP_LINE_EMPTY = "Nothing in custom_upload — drop a PNG or JPEG in it"
const IMP_LINE_FAILED = "Could not reach the bucket"
// PASS 49: "no credentials configured" named the problem and not the fix. The panel's
// footer is where it already puts every other empty state, so it is where the file to
// fill in is named — the same sentence shape the gallery's footer uses.
const IMP_LINE_NOCREDS = "Cloud is off — fill in " + CONFIG_FILE

/** One downloaded, normalised, placeable image. */
interface ImportItem {
  name: string
  art: StickerArt
}

/** One grid cell: a white mount and the thumbnail on it, plus its own tap target. */
interface Cell {
  root: SceneObject
  mount: SceneObject
  image: SceneObject
  mat: Material
  interactable: Interactable
  index: number // which item it currently shows, -1 for none
}

export interface ImportPanelHooks {
  /** A tile was tapped. The panel has already closed. */
  onPick: (art: StickerArt) => void
}

type ImportState = "idle" | "loading" | "ready" | "empty" | "failed" | "nocreds"

export class ImportPanel {
  private client: SupabaseClient
  private viewport: ViewportLayers
  private hooks: ImportPanelHooks

  private buttonObj!: SceneObject
  private buttonInteractable!: Interactable
  private buttonLabel!: Text
  private plateBody!: SceneObject
  private glyphParts: SceneObject[] = [] // Pass 45: the library grid (was the two bars of a plus)
  private buttonWord: Text | null = null
  private slot: () => SceneObject | null

  private root!: SceneObject
  private gridRoot!: SceneObject
  private cells: Cell[] = []
  private titleText!: Text
  private headCount: Text | null = null // Pass 32 (glass)
  private footText!: Text
  private closeChip!: SceneObject
  private leftArrow!: SceneObject
  private rightArrow!: SceneObject
  private closeInteractable!: Interactable
  private leftInteractable!: Interactable
  private rightInteractable!: Interactable
  private blockInteractable!: Interactable

  private items: ImportItem[] = []
  private state: ImportState = "idle"
  private open_ = false
  private page = 0
  private loading = false // Pass 41: a listing + downloads are in flight
  private refreshQueued = false // Pass 41: an open arrived mid-flight; list again when done
  private refreshes = 0 // how many listings have run (verification)
  /** Cumulative normalise cost, for the record. */
  private normMsTotal = 0

  constructor(
    parent: SceneObject,
    client: SupabaseClient,
    viewport: ViewportLayers,
    hooks: ImportPanelHooks,
    slot: () => SceneObject | null = () => null
  ) {
    this.client = client
    this.viewport = viewport
    this.hooks = hooks
    this.slot = slot
    this.buildButton(parent)
    this.buildPanel(parent)
  }

  /** Bind the SIK subscriptions. Called from OnStartEvent, where they must live. */
  init(): void {
    // Pass 25 (glass): move into the tray's slot. OnStart is the first moment the tray's
    // own onAwake has built it; the layout then positions the slot and the button follows.
    const slot = this.slot()
    if (slot) {
      this.buttonObj.setParent(slot)
      this.buttonObj.getTransform().setLocalPosition(new vec3(-SLOT_BTN_X, 0, IMP_SLOT_Z))
      this.buttonObj.getTransform().setLocalRotation(quat.quatIdentity())
      this.buttonObj.getTransform().setLocalScale(new vec3(1, 1, 1))
      raiseAbovePlate(this.buttonObj) // Pass 27: it sits on the tray's UIKit plate — see UiTheme
    }
    this.buttonInteractable.onTriggerEnd.add(() => this.open())
    this.closeInteractable.onTriggerEnd.add(() => this.close())
    this.leftInteractable.onTriggerEnd.add(() => this.step(-1))
    this.rightInteractable.onTriggerEnd.add(() => this.step(1))
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]
      cell.interactable.onTriggerEnd.add(() => this.pick(cell))
    }
    // The button's resting appearance depends on whether credentials exist, which is
    // known by now — so this is the one place it is decided, and it never changes after.
    this.applyButtonState()
  }

  isOpen(): boolean {
    return this.open_
  }

  /** How many images have been downloaded and normalised so far. */
  itemCount(): number {
    return this.items.length
  }

  /**
   * Verification entry point: tap the n-th tile of the current page, exactly as the
   * tile's own Interactable would. Used by DEBUG_PHOTO_SCRIPT; harmless otherwise.
   */
  pickIndex(n: number): void {
    if (n < 0 || n >= this.cells.length) return
    this.pick(this.cells[n])
  }

  // ---------------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------------

  /**
   * Open the panel.
   *
   * Pass 41 opened it only when the cloud was reachable: with no credentials the button
   * did nothing at all, on the reasoning that opening something after pressing a control
   * marked "off" is worse than not responding.
   *
   * PASS 49 reverses that for the ONE case where silence costs something. A public clone
   * ships an empty SupabaseConfig.ts, and a button that does nothing teaches nobody which
   * file to fill in; the panel opens instead and its footer says so. Nothing is listed and
   * nothing is downloaded on that path — `refresh()` is not even called, so the state is
   * reached without a single request. A cloud that is configured but unreachable (no
   * InternetModule) keeps the old silence: that is not a message about a config file.
   */
  open(): void {
    if (this.open_) return
    const noCreds = credentialsMissing()
    if (!noCreds && !this.client.available()) return
    this.open_ = true
    this.page = 0
    this.root.enabled = true
    this.viewport.take(LAYERS.photo)
    if (noCreds) {
      logNoCredentialsOn("My lib") // the same sentence the footer is about to show
      this.setState("nocreds")
    } else {
      this.refresh() // Pass 41: list the bucket on EVERY open — see note 3
    }
    this.layout()
  }

  /** Pass 41: list the bucket again. Already listing -> one more listing once it finishes. */
  private refresh(): void {
    if (this.loading) { this.refreshQueued = true; return }
    this.loading = true
    this.refreshQueued = false
    if (this.items.length === 0) this.setState("loading")
    this.load().then(() => {
      this.loading = false
      if (this.refreshQueued) this.refresh()
    }).catch((e) => {
      this.loading = false
      print("[import] refresh failed: " + e)
    })
  }

  /** Verification: how many times the bucket has been listed. */
  refreshCount(): number {
    return this.refreshes
  }

  /** Close and return to editing, everything exactly as it was left. */
  close(): void {
    if (!this.open_) return
    this.open_ = false
    this.root.enabled = false
    this.viewport.release()
  }

  private step(dir: number): void {
    const pages = this.pageCount()
    const next = Math.max(0, Math.min(pages - 1, this.page + dir))
    if (next === this.page) return
    this.page = next
    this.layout()
  }

  private pageCount(): number {
    return Math.max(1, Math.ceil(this.items.length / IMP_PAGE))
  }

  /** A tile was tapped: place its artwork and get out of the way. */
  private pick(cell: Cell): void {
    if (!this.open_ || cell.index < 0 || cell.index >= this.items.length) return
    const art = this.items[cell.index].art
    this.close()
    this.hooks.onPick(art)
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * List the bucket, then download and normalise each image, updating the grid as each
   * one lands rather than waiting for all of them. Nothing here is awaited by the frame
   * loop; a failure sets a state and a sentence.
   */
  private async load(): Promise<void> {
    this.refreshes++
    const listed = await this.client.listBucket(BUCKET_UPLOAD)
    if (!listed.ok || !listed.value) {
      // Pass 41: a failed RE-listing keeps what is already on screen rather than blanking it.
      if (this.items.length === 0) this.setState("failed")
      else print("[import] re-list failed; keeping the " + this.items.length + " image(s) already shown")
      this.layout()
      return
    }
    const names = listed.value
    if (names.length === 0) {
      this.items = []
      this.setState("empty")
      this.layout()
      return
    }

    // Pass 41: RECONCILE. Keep the art already normalised for names still listed, drop the
    // names that have gone, and order everything as the fresh listing does.
    const known: { [name: string]: ImportItem } = {}
    for (const it of this.items) known[it.name] = it
    const kept: ImportItem[] = []
    let fresh = 0
    for (const n of names) if (known[n]) kept.push(known[n]); else fresh++
    const dropped = this.items.length - kept.length
    this.items = kept
    if (kept.length > 0) this.setState("ready")
    print("[import] listing #" + this.refreshes + ": " + names.length + " in bucket, " + kept.length + " kept, " + fresh + " new, " + dropped + " gone")
    this.layout()

    for (let i = 0; i < names.length; i++) {
      if (known[names[i]]) continue // already downloaded and normalised
      const tex = await this.client.fetchTexture(names[i], BUCKET_UPLOAD)
      if (!tex) continue // a single bad object does not sink the panel
      const res = normalise(tex, names[i])
      if (!res.ok || !res.art) continue
      this.normMsTotal += res.ms
      print(
        "[import] " + names[i] + ": " + res.width + "x" + res.height +
        " -> uv [" + res.u0.toFixed(3) + "," + res.v0.toFixed(3) + "]..[" +
        res.u1.toFixed(3) + "," + res.v1.toFixed(3) + "]" +
        " aspect " + (res.art.wFrac / res.art.hFrac).toFixed(2) +
        (res.fullyOpaque ? " (opaque, no alpha)" : "") +
        " in " + res.ms.toFixed(1) + " ms"
      )
      // Into the listing's own position, so a new upload lands where the listing put it
      // (first, with newest-first ordering) rather than at the end.
      const item: ImportItem = { name: names[i], art: res.art }
      let at = this.items.length
      for (let k = 0; k < this.items.length; k++) {
        if (names.indexOf(this.items[k].name) > i) { at = k; break }
      }
      this.items.splice(at, 0, item)
      this.setState("ready")
      this.layout()
    }
    if (this.items.length === 0) this.setState("empty")
    else print("[import] " + this.items.length + " image(s), normalise total " + this.normMsTotal.toFixed(1) + " ms")
    this.layout()
  }

  private setState(s: ImportState): void {
    this.state = s
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  private layout(): void {
    if (!this.open_) return
    const pages = this.pageCount()
    if (this.page > pages - 1) this.page = pages - 1
    const first = this.page * IMP_PAGE

    // THE GRID SIZES TO ITS CONTENT. A fixed 3x3 with three images in it puts everything
    // in the top row and leaves two rows of nothing under it, which reads as a loading
    // state that never finished. So the used rows are centred vertically and each row's
    // cells are centred horizontally — one image is a single tile in the middle, nine
    // fill the frame, and every count in between looks deliberate.
    const shown = Math.max(0, Math.min(IMP_PAGE, this.items.length - first))
    const usedRows = Math.max(1, Math.ceil(shown / IMP_COLS))
    const usedH = usedRows * IMP_CELL + (usedRows - 1) * IMP_GAP
    // Pass 34 (glass): the rows hang from the head pill, as in the reference, instead of
    // centring on IMP_CENTER_Y — which, with one row, left a hole under the heading.
    const top = GLASS ? IMP_GRID_TOP_Y - IMP_CELL / 2 : IMP_CENTER_Y + usedH / 2 - IMP_CELL / 2

    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i]
      const idx = first + i
      if (idx >= this.items.length) {
        cell.root.enabled = false
        cell.index = -1
        continue
      }
      const item = this.items[idx]
      cell.index = idx
      cell.root.enabled = true

      const row = Math.floor(i / IMP_COLS)
      const col = i % IMP_COLS
      const inRow = Math.min(IMP_COLS, shown - row * IMP_COLS)
      const rowW = inRow * IMP_CELL + (inRow - 1) * IMP_GAP
      const x = -rowW / 2 + IMP_CELL / 2 + col * (IMP_CELL + IMP_GAP)
      const y = top - row * (IMP_CELL + IMP_GAP)
      cell.root.getTransform().setLocalPosition(new vec3(x, y, IMP_Z))
      // The thumbnail is drawn from the SAME StickerArt that will be placed: same
      // trimmed quad, same aspect, fitted into the cell's square.
      const w = IMP_CELL * item.art.wFrac
      const h = IMP_CELL * item.art.hFrac
      cell.image.getTransform().setLocalScale(new vec3(w, h, 1))
      if (!GLASS) cell.mount.getTransform().setLocalScale(new vec3(w + 2 * IMP_MOUNT_PAD, h + 2 * IMP_MOUNT_PAD, 1)) // glass tiles stay square
      const visual = cell.image.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (visual) visual.mesh = item.art.mesh ? item.art.mesh : uiQuad()
      try { (cell.mat.mainPass as any).baseTex = item.art.tex } catch (_e) { /* ignore */ }
    }

    if (this.headCount) this.headCount.text = String(this.items.length)
    const titleY = IMP_CENTER_Y + usedH / 2 + IMP_TITLE_GAP
    this.titleText.text = IMP_TITLE
    this.titleText.getSceneObject().getTransform().setLocalPosition(new vec3(0, titleY, IMP_Z))
    this.closeChip.getTransform().setLocalPosition(
      new vec3(IMP_GRID_W / 2 + IMP_CHIP_GAP, titleY, IMP_Z + 0.6)
    )
    // Pass 34: the heading carries the count, so the glass page has no footer line.
    // PASS 49 keeps one exception — the no-credentials sentence, which the head pill
    // cannot say and which is the whole reason this page opened.
    this.footText.text = (GLASS && this.state !== "nocreds") ? "" : this.footLine(pages)
    this.footText.getSceneObject().getTransform().setLocalPosition(
      new vec3(0, IMP_CENTER_Y - usedH / 2 - IMP_FOOT_GAP, IMP_Z)
    )
    this.leftArrow.enabled = this.state === "ready" && this.page > 0
    this.rightArrow.enabled = this.state === "ready" && this.page < pages - 1
  }

  private footLine(pages: number): string {
    if (this.state === "nocreds") return IMP_LINE_NOCREDS
    if (this.state === "loading") return IMP_LINE_LOADING
    if (this.state === "failed") return IMP_LINE_FAILED
    if (this.state === "empty" || this.items.length === 0) return IMP_LINE_EMPTY
    const n = this.items.length
    const noun = n === 1 ? "image" : "images"
    return pages > 1
      ? n + " " + noun + "  ·  page " + (this.page + 1) + " / " + pages
      : n + " " + noun
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private buildButton(parent: SceneObject): void {
    // Pass 45: the family's plain plate (PLATE_COL, no gradient) — Photo's and Gallery's.
    this.buttonObj = makePlateButton(parent, "ImportButton", IMP_BTN_CENTER, PLATE_COL, false,
      { w: pick(SLOT_BTN_W, WIDE_BTN_W), h: pick(IMP_SLOT_H, WIDE_BTN_H), r: IMP_BTN_R, hit: IMP_HIT })
    this.buttonInteractable = this.buttonObj.getComponent(Interactable.getTypeName()) as Interactable
    // The plate body is the second shape makePlateButton adds (rim first); remembered so
    // the inert state can knock it back without rebuilding anything.
    this.plateBody = this.buttonObj.getChild(1)

    // Pass 46: the library glyph — the reference's folder with a picture card over its
    // lower right (see IMP_LIB_*). Built in cm, the glyph box's own units; the icon's
    // centre sits at (IMP_PLUS_X, IMP_PLUS_Y) like the camera's and the frame's.
    const iconH = IMP_LIB_CARD_TOP + IMP_LIB_CARD.y + IMP_LIB_POINT_H // 1.28: the icon's top to the card's point
    const top = IMP_PLUS_Y + iconH / 2
    const left = IMP_PLUS_X - IMP_LIB_FOLDER.x / 2
    const dm = (mesh: RenderMesh, x: number, y: number, z: number, sx: number, sy: number, col: vec4, rot: number = 0): void => {
      this.glyphParts.push(addFlatShape(this.buttonObj, mesh, new vec3(x, y, z), new vec3(sx, sy, 1), col, rot))
    }
    // the folder: its tab, then its body
    dm(uiRoundRect(IMP_LIB_TAB.x, IMP_LIB_TAB.y + IMP_LIB_R, IMP_LIB_R / 2), left + IMP_LIB_TAB.x / 2, top - IMP_LIB_TAB.y / 2 - IMP_LIB_R / 2, 0.2, 1, 1, GLYPH_COL)
    dm(uiRoundRect(IMP_LIB_FOLDER.x, IMP_LIB_FOLDER.y, IMP_LIB_R), IMP_PLUS_X, top - IMP_LIB_TAB.y - IMP_LIB_FOLDER.y / 2, 0.25, 1, 1, GLYPH_COL)
    // the card over its lower right, pointed at the bottom, with its dot
    const cardX = left + IMP_LIB_CARD_DX + IMP_LIB_CARD.x / 2
    const cardTop = top - IMP_LIB_CARD_TOP
    dm(uiRoundRect(IMP_LIB_CARD.x, IMP_LIB_CARD.y, IMP_LIB_R), cardX, cardTop - IMP_LIB_CARD.y / 2, 0.3, 1, 1, IMP_LIB_CARD_COL)
    dm(buildTriangle(), cardX, cardTop - IMP_LIB_CARD.y - IMP_LIB_POINT_H / 2 + 0.02, 0.3, IMP_LIB_POINT_H, IMP_LIB_POINT_W, IMP_LIB_CARD_COL, -Math.PI / 2)
    dm(uiDisc(), cardX, cardTop - IMP_LIB_DOT_DY, 0.35, IMP_LIB_DOT_R, IMP_LIB_DOT_R, PLATE_COL)
    this.buttonWord = addButtonWord(this.buttonObj, IMP_WORD, LABEL_COL, new vec3(pick(0, WIDE_BTN_WORD_X), IMP_WORD_Y, 0.2), IMP_WORD_SIZE) // Pass 35: the word's LEFT edge, one gap past the glyph — the same slot as Photo

    this.buttonLabel = addLabel(
      this.buttonObj, new vec3(0, IMP_LABEL_DY, 0.2), "", pick(IMP_LABEL_SIZE, IMP_LABEL_SIZE_GLASS), LABEL_DIM_COL
    )
    if (GLASS) this.buttonLabel.getSceneObject().enabled = false // Pass 32: the word itself says "Import off"
    setLayerDeep(this.buttonObj, LAYERS.ui)
  }

  /** Dim the plate and label it when there is no cloud to import from. */
  private applyButtonState(): void {
    if (this.client.available()) {
      this.buttonLabel.text = ""
      return
    }
    this.setState("nocreds")
    this.buttonLabel.text = IMP_OFF_WORD
    if (GLASS && this.buttonWord) {
      this.buttonWord.text = IMP_OFF_WORD
      // Pass 37: a different word is a different group width, so the centring has to be
      // redone — otherwise "Import off" sits where "Import" left it.
      requestButtonCentring(this.buttonObj, this.buttonWord)
    }
    const d = IMP_DIM
    // Pass 45: the body is the family's flat plate in both styles, so it is knocked back the same way.
    setShapeColor(this.plateBody, new vec4(PLATE_COL.x, PLATE_COL.y, PLATE_COL.z, PLATE_COL.w * d))
    const g = new vec4(GLYPH_COL.x, GLYPH_COL.y, GLYPH_COL.z, GLYPH_COL.w * d)
    for (const p of this.glyphParts) setShapeColor(p, g)
    if (this.buttonWord) setTextColor(this.buttonWord, new vec4(LABEL_COL.x, LABEL_COL.y, LABEL_COL.z, LABEL_COL.w * d)) // Pass 43
  }

  private buildPanel(parent: SceneObject): void {
    this.root = global.scene.createSceneObject("ImportPanel")
    this.root.setParent(parent)

    // Input blocker — the same one the review and the carousel use.
    const blocker = global.scene.createSceneObject("ImportBlocker")
    blocker.setParent(this.root)
    blocker.getTransform().setLocalPosition(new vec3(0, 0, IMP_BLOCK_Z))
    const blockCol = blocker.createComponent("Physics.ColliderComponent") as ColliderComponent
    const blockShape = Shape.createBoxShape()
    blockShape.size = new vec3(IMP_BLOCK_SIZE, IMP_BLOCK_SIZE, 3)
    blockCol.shape = blockShape
    blockCol.fitVisual = false
    this.blockInteractable = blocker.createComponent(Interactable.getTypeName()) as Interactable
    this.blockInteractable.targetingMode = 3

    this.gridRoot = global.scene.createSceneObject("ImportGrid")
    this.gridRoot.setParent(this.root)
    for (let i = 0; i < IMP_PAGE; i++) this.cells.push(this.buildCell())

    // Title, footer and close chip are positioned in layout(), which knows how many rows
    // are actually in use; these are their initial, unimportant placements.
    this.titleText = addLabel(
      this.root, new vec3(0, IMP_CENTER_Y, IMP_Z), IMP_TITLE, IMP_TITLE_SIZE, LABEL_COL,
      HorizontalAlignment.Center, true
    )
    if (GLASS) {
      // Pass 32: the head pill carries the title and the count; the Back circle closes.
      this.titleText.getSceneObject().enabled = false
      const head = addHeadPill(this.root, new vec3(0, HEAD_Y, IMP_Z), IMP_HEAD_WORD, "image", 0, true)
      this.headCount = head.countText
    }
    this.footText = addLabel(
      this.root, new vec3(0, IMP_CENTER_Y, IMP_Z), "", IMP_FOOT_SIZE, LABEL_DIM_COL,
      HorizontalAlignment.Center, true
    )

    this.closeChip = this.buildChip(
      new vec3(IMP_GRID_W / 2 + IMP_CHIP_GAP, IMP_CENTER_Y, IMP_Z + 0.6), IMP_CHIP_R, CHIP_EDGE, IMP_CHIP_HIT
    )
    addFlatShape(this.closeChip, uiQuad(), new vec3(0, 0, 0.2), new vec3(IMP_CLOSE_LEN, IMP_CLOSE_BAR, 1), CHIP_GLYPH, Math.PI / 4, true)
    addFlatShape(this.closeChip, uiQuad(), new vec3(0, 0, 0.2), new vec3(IMP_CLOSE_LEN, IMP_CLOSE_BAR, 1), CHIP_GLYPH, -Math.PI / 4, true)
    this.closeInteractable = this.closeChip.getComponent(Interactable.getTypeName()) as Interactable
    if (GLASS) {
      this.closeChip.enabled = false
      const back = addBackCircle(this.root, BACK_CIRCLE_POS, true)
      this.closeInteractable = back.getComponent(Interactable.getTypeName()) as Interactable
    }

    const tri = requireTriangle()
    this.leftArrow = this.buildChip(new vec3(-IMP_ARROW_X, IMP_CENTER_Y, IMP_Z + 0.6), IMP_ARROW_R, CHIP_EDGE, IMP_ARROW_HIT)
    addFlatShape(this.leftArrow, tri, new vec3(-0.08, 0, 0.2), new vec3(IMP_ARROW_TRI.x, IMP_ARROW_TRI.y, 1), CHIP_GLYPH, Math.PI, true)
    this.leftInteractable = this.leftArrow.getComponent(Interactable.getTypeName()) as Interactable

    this.rightArrow = this.buildChip(new vec3(IMP_ARROW_X, IMP_CENTER_Y, IMP_Z + 0.6), IMP_ARROW_R, CHIP_EDGE, IMP_ARROW_HIT)
    addFlatShape(this.rightArrow, tri, new vec3(0.08, 0, 0.2), new vec3(IMP_ARROW_TRI.x, IMP_ARROW_TRI.y, 1), CHIP_GLYPH, 0, true)
    this.rightInteractable = this.rightArrow.getComponent(Interactable.getTypeName()) as Interactable

    setLayerDeep(this.root, LAYERS.photo)
    this.root.enabled = false
  }

  private buildCell(): Cell {
    const root = global.scene.createSceneObject("ImportCell")
    root.setParent(this.gridRoot)

    let mount: SceneObject
    if (GLASS) {
      // Pass 32: a rounded dark tile with a faint rim, the sticker in its own frame.
      const side = IMP_CELL + 2 * IMP_TILE_PAD
      mount = addFlatShape(root, uiRoundRect(side, side, IMP_TILE_R), vec3.zero(), new vec3(1, 1, 1), IMP_TILE_FILL, 0, true)
      addFlatShape(root, uiRoundRing(side, side, IMP_TILE_R, IMP_TILE_RIM_T), new vec3(0, 0, 0.05), new vec3(1, 1, 1), IMP_TILE_RIM, 0, true)
    } else {
      mount = addFlatShape(
        root, uiQuad(), vec3.zero(),
        new vec3(IMP_CELL + 2 * IMP_MOUNT_PAD, IMP_CELL + 2 * IMP_MOUNT_PAD, 1), PRINT_COL, 0, true
      )
    }

    const image = global.scene.createSceneObject("ImportThumb")
    image.setParent(root)
    image.getTransform().setLocalPosition(new vec3(0, 0, 0.2))
    image.getTransform().setLocalScale(new vec3(IMP_CELL, IMP_CELL, 1))
    const visual = image.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = uiQuad()
    stackVisual(visual) // Pass 43
    const mat = QUAD_MAT.clone()
    const pass: any = mat.mainPass
    try { pass.baseColor = new vec4(1, 1, 1, 1) } catch (_e) { /* ignore */ }
    try { pass.blendMode = BlendMode.Normal } catch (_e) { /* ignore */ }
    try { pass.depthTest = true } catch (_e) { /* ignore */ }
    try { pass.depthWrite = true } catch (_e) { /* ignore */ }
    try { pass.twoSided = true } catch (_e) { /* ignore */ }
    visual.clearMaterials()
    visual.addMaterial(mat)

    const col2 = root.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(IMP_CELL + IMP_GAP, IMP_CELL + IMP_GAP, 3)
    col2.shape = shape
    col2.fitVisual = false
    const inter = root.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3

    root.enabled = false
    return { root, mount, image, mat, interactable: inter, index: -1 }
  }

  private buildChip(pos: vec3, r: number, edge: vec4, hit: vec3): SceneObject {
    const chip = global.scene.createSceneObject("ImportChip")
    chip.setParent(this.root)
    chip.getTransform().setLocalPosition(pos)
    addFlatShape(chip, uiDisc(), vec3.zero(), new vec3(r, r, 1), CHIP_FILL, 0, true)
    addFlatShape(chip, buildRing(1 - IMP_CHIP_RING / r, 48), new vec3(0, 0, 0.1), new vec3(r, r, 1), edge, 0, true)
    const c = chip.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = hit
    c.shape = shape
    c.fitVisual = false
    const inter = chip.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3
    return chip
  }
}

/** buildTriangle, memoised — the two arrows are the only users. */
let _tri: RenderMesh | null = null
function requireTriangle(): RenderMesh {
  if (!_tri) _tri = buildTriangle()
  return _tri
}
