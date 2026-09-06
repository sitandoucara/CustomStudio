// PhotoGallery — every photograph taken, as a carousel (Pass 13).
//
// ===========================================================================
// 1. WHAT IT IS
// ===========================================================================
// One print large in the centre, its neighbours smaller and set back on either side,
// an arrow chip each way, a caption under the centre print, a delete chip and a close
// chip on its top corners. Same plate/chip/print language as the single-photo review —
// every colour, the white mount and the flat-shape builder come from PhotoUi, so this
// is a second surface in one family rather than a second style.
//
// ===========================================================================
// 2. THE CAROUSEL IS ANIMATED PER CARD, NOT BY ONE SCROLL OFFSET
// ===========================================================================
// The obvious implementation is a single float `pos` that eases toward the selected
// index, with every card drawn at `i - pos`. It reads correctly while you page — and it
// cannot express a DELETION. When the centred photo is removed, the cards to its left
// must stay exactly where they are while the cards to its right each slide one slot
// left to close the gap; the two halves move by different amounts, and one scalar
// offset can only move all of them together. (Try it and the whole strip jumps.)
//
// So the animated quantity lives PER CARD: `disp[id]` is where card `id` is drawn now,
// in slots from the centre, and every frame it eases toward `indexOf(id) - index`.
// Paging moves every target by the same amount, which looks exactly like a single
// scroll offset. Deleting moves only the targets of the cards after the gap, which is
// the gap closing. One mechanism, both behaviours, and it is also what makes a photo
// arriving from a network (which appears in the middle of an order, not at the end)
// animate into place instead of popping.
//
// `disp` is rebuilt from the live record ids every frame, so a card that leaves the
// store takes its animation state with it and nothing has to be cleaned up.
//
// ===========================================================================
// 3. THE SOURCE IS AN INTERFACE — see PhotoStore.ts
// ===========================================================================
// Nothing below touches an array. The carousel asks `count()` and `at(i)` (newest
// first), calls `remove(id)`, and re-lays-out whenever `onChanged` fires. A record's
// `texture` may be null and a card whose texture is null draws as an empty mount, which
// is the state a remote record is in while its pixels download. Swapping this session's
// SessionPhotoStore for a Supabase-backed one is a different object passed to the
// constructor and no change here.
//
// ===========================================================================
// 4. THE CAPTION — WHAT IS WORTH SHOWING, AND WHY
// ===========================================================================
// Each record carries shirtColor, yawDeg, stickerCount and takenAtSec. The caption
// shows the first three and not the fourth:
//
//   - the COLOUR as a swatch, not as text. It is the loudest thing about a design and
//     the photograph already shows it — but the photograph shows it under the shot's
//     lighting, and the swatch shows the value that was actually applied. It is also
//     the one field that identifies a shot at a glance when the carousel is scrolled
//     past at thumbnail size.
//   - the FACING as a word (Front / Back / Side). This is the field the picture is
//     WORST at: a plain-coloured shirt photographed from the back looks much like one
//     photographed from the front, and "Back" is what tells you which of two near
//     identical shots you are about to delete.
//   - the STICKER COUNT, because it is what distinguishes two shots of the same colour
//     from the same angle — the whole point of taking more than one.
//
// takenAtSec is deliberately not shown. It is SECONDS SINCE THIS LENS BOOTED, so it
// reads as "0:42" — a number that means nothing to the person looking at it and that
// becomes actively wrong the moment the store is remote and the photo was taken
// yesterday. Ordering already carries the same information, honestly: newest first,
// and the counter line says "1 / 4 · newest" so the direction is not a guess. When the
// store is remote and the field holds a real wall-clock time, THAT is the moment to put
// a date in the caption.
//
// ===========================================================================
// 5. PERSISTENCE — WHAT IS AND IS NOT POSSIBLE LOCALLY
// ===========================================================================
// persistentStorageSystem stores strings, numbers and typed-array-shaped values, not
// Textures, so the frozen pixels of a photograph cannot be written to it as pixels.
// The two things that could be persisted locally are:
//
//   (a) THE PIXELS, encoded. Texture -> getPixels() -> base64 -> a store key. A single
//       896x1024 frame is 3.6 MB raw and ~4.8 MB base64 — per photo, times twelve —
//       which is far outside what a Lens's key-value store is for, and the encode is a
//       multi-megabyte string built on the main thread. Not viable, and not worth
//       building even if it were: Supabase Storage is exactly this, done properly.
//
//   (b) THE DESIGN, and re-render at launch. Every record already carries the complete
//       recipe of its shot — shirtColor, yawDeg, stickerCount — and that is ~60 bytes of
//       JSON. Twelve of them is under a kilobyte. Re-photographing them at boot is the
//       existing capture path run headless: set the colour, set the yaw, stamp the
//       stickers, run the capture camera two frames, freeze. It is genuinely realistic.
//       It is also NOT free: the sticker list is not in the record today (only a count),
//       so the record would have to grow a full sticker array; the shirt has to be
//       driven through twelve states before the first frame the user sees, which is a
//       visible boot stall of roughly twelve times CAPTURE_WARMUP_FRAMES; and it is a
//       reconstruction, not a photograph — anything that later becomes non-deterministic
//       (a different fit, a changed palette, an added feature) silently changes the
//       "old" photos.
//
// The recommendation is in the pass summary; the code deliberately builds neither.
//
// ===========================================================================

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { buildRing, buildTriangle } from "./Geo"
import { LAYERS, setLayerDeep } from "./Layers"
import { GLASS, pick } from "./UiTheme"
import { DEBUG_GALLERY_EMPTY } from "./Stickers"
import { credentialsMissing, logNoCredentialsOn } from "./SupabaseClient" // Pass 49
import { PhotoRecord, PhotoStore } from "./PhotoStore"
import {
  addFlatShape,
  addLabel,
  setShapeColor,
  uiDisc,
  uiQuad,
  CHIP_DANGER,
  CHIP_EDGE,
  CHIP_FILL,
  CHIP_GLYPH,
  LABEL_COL,
  LABEL_DIM_COL,
  PHOTO_ASPECT,
  PRINT_COL,
  QUAD_MAT,
  addHeadPill,
  addBackCircle,
  BACK_CIRCLE_POS,
  HEAD_Y,
  HEAD_SUB_DY,
  HEAD_SUB_SIZE,
  addCalendarGlyph,
  addTurntable,
  uiRoundRect,
  uiRoundRing,
  TABLE_WORLD_Y,
  TABLE_WORLD_Z,
  ACCENT_VIOLET,
  PLATE_COL,
  setTextColor, // Pass 43
  stackVisual,
} from "./PhotoUi"

// --- The prints ---------------------------------------------------------------
// The centred print sits at the review's own depth — just in front of the UI plane
// (z -110) rather than close to the eye, which is where you would hold a photograph.
// It is SMALLER than the single-photo review's print (46 cm tall) because a carousel
// has to leave room either side for the neighbours inside the same field of view.
const GAL_Z = pick(-100, -110) // Pass 32: the cards at the garments' depth
// Pass 32: the cards stand ON the plate — at the garments' depth (GAL_Z -110), ten percent
// larger so they read the size they did, their feet on the plate's centre line.
const GAL_CENTER_Y = pick(2.6, 6.1) // the print rides high, leaving the caption under it
const GAL_H = pick(32, 26.4)
const GAL_CHROME_Z = -100 // head pill, Back circle
// The pressable chips (trash, arrows) stay at the chrome depth — in FRONT of the input
// blocker at -101 — and are placed where the card's corner PROJECTS to at that depth, so
// they sit on the corner to the eye and still take the ray.
const GAL_PROJ = GAL_CHROME_Z / GAL_Z
// --- Pass 30 (glass): Refs/ui_galery -----------------------------------------------------
// The card is a dark rounded glass frame with a violet rim; the photograph sits in its
// upper part with its corners rounded by a ring drawn over it, the caption in a band under
// it INSIDE the card, the trash chip inside its top-right corner. Side cards are turned in
// perspective. Back pill top-left, title block top centre, round arrows lower down, a
// counter pill at the bottom, and the same turntable the garments stand on underneath.
const GAL_TITLE_Y = 24.0
const GAL_BACK_POS = new vec3(-24, 24, -100)
const GAL_CARD_T = 0.9 // the frame's thickness around the image
const GAL_CARD_R = 2.6 // the card's corner radius
const GAL_CAP_BAND = 5.4 // the caption band under the image, inside the card
const GAL_CARD_FILL = new vec4(0.05, 0.05, 0.08, 0.88)
// Pass 33: the rim was 55% translucent, so along the TOP edge, where the night sky sits
// behind it, the additive display had little to add and the edge went faint, while the lit
// street behind the sides and bottom carried it. Near-opaque, it is even all the way round.
const GAL_CARD_RIM = new vec4(0.62, 0.42, 0.98, 0.92)
const GAL_TRASH_INSET = 0.9 // from the image's corner, inward (was on the card's border)
const GAL_RING_INSET = 0.3 // the corner ring stops short of the card's edge (see buildSlot)
const GAL_CARD_RIM_T = 0.18
const GAL_SIDE_TILT_DEG = pick(0, 32) // side cards turned about Y, as in the reference
const GAL_GLASS_ARROW = new vec2(22.0, -6.0)
const GAL_GLASS_CHIP_FILL = new vec4(0.10, 0.10, 0.14, 0.92)
const GAL_TRASH_SIZE = 3.0
const GAL_TRASH_R = 0.9
const GAL_COUNTER_Y = -21.0
const GAL_COUNTER_W = 8.0
const GAL_COUNTER_H = 2.6
const GAL_COUNTER_SIZE = 40
const GAL_GLASS_FOOT_Y = -24.2
const GAL_GLASS_FOOT_SIZE = 36
const GAL_CAP_LINE1_DY = -1.7 // from the image's bottom edge: swatch + facing/stickers
const GAL_CAP_LINE2_DY = -3.9 // calendar + date
const GAL_CAP_SWATCH_X = -7.4
const GAL_CAP_CAL_X = -4.6
const GAL_CAP_TEXT_X = 0.9
const GAL_GLASS_CAP_SIZE = 40
const GAL_GLASS_SUB_SIZE = 42
const GAL_TITLE_WORD = "Gallery"
const GAL_TITLE_SUB = "Your customised creations"
const GAL_W = GAL_H * PHOTO_ASPECT
const GAL_BORDER = 0.85 // white mount around the image, so a card reads as a print

// The neighbours: smaller, pushed sideways, set BACK (more negative z = further from the
// eye) and dimmed. Set back rather than merely small, because on a see-through display
// depth is what says "behind" — and with a real depth test the centre print then
// OCCLUDES them where they overlap, which is what makes the stack read as a stack.
const GAL_SIDE_SCALE = 0.58
const GAL_SIDE_DX = pick(17.6, 20.9) // one slot of travel, in cm
const GAL_SIDE_DZ = -7
const GAL_SIDE_TINT = 0.6 // multiplier on a neighbour's colours at a full slot out
// How far out a card is still drawn, in slots. Past this it is off the side of any
// plausible field of view anyway, so it is dropped rather than faded — a fade would need
// alpha, and alpha on a see-through display is the one thing that does not behave.
const GAL_VIS_SPAN = 1.55
// Cards that can be on screen at once: the centre, its two neighbours, and one either
// side in hand during a transition.
const GAL_SLOTS = 5
// Exponential approach, per second. 14 settles a one-slot move in about a fifth of a
// second — quick enough not to be a wait, slow enough to show which way things moved.
const GAL_EASE = 14
const GAL_SNAP = 0.002 // closer than this to the target, snap and stop

// --- Chips (close, delete, arrows) ---------------------------------------------
const GAL_CHIP_R = 1.3
const GAL_CHIP_RING = 0.11
const GAL_CHIP_LIFT = 0.6 // in front of the print's plane
const GAL_CHIP_HIT = new vec3(4.0, 4.0, 3)
const GAL_CLOSE_BAR = 0.15
const GAL_CLOSE_LEN = 1.36
// Trash glyph, drawn as geometry like every other glyph in this project.
const GAL_TRASH_CAN = new vec2(0.94, 1.02)
const GAL_TRASH_CAN_Y = -0.2
const GAL_TRASH_LID = new vec2(1.32, 0.17)
const GAL_TRASH_LID_Y = 0.42
const GAL_TRASH_GRIP = new vec2(0.5, 0.16)
const GAL_TRASH_GRIP_Y = 0.58
const GAL_TRASH_SLOT = new vec2(0.13, 0.62)
const GAL_TRASH_SLOT_X = 0.23
// Arrows: the same white chip with a dark triangle, at the print's own height, sitting
// over the inner edge of each neighbour where a carousel's arrows belong.
const GAL_ARROW_X = 17.4
const GAL_ARROW_R = 1.45
const GAL_ARROW_TRI = new vec2(1.12, 1.32)
const GAL_ARROW_HIT = new vec3(4.8, 4.8, 3)

// --- Caption ------------------------------------------------------------------
// Two centred rows under the print — row one the design, row two the position in the
// roll — with the colour swatch parked at the print's left edge.
//
// Centred rather than left-aligned, and that is a finding rather than a preference: a
// Text whose horizontalOverflow is Overflow has no box to align inside, so it centres on
// its object's origin whatever HorizontalAlignment says. Built left-aligned, the caption
// therefore drew centred on its anchor and ran straight over the swatch. The swatch is
// consequently placed far enough left that the LONGEST caption ("Front · no stickers",
// about 14 cm at GAL_CAP_SIZE) still clears it.
const GAL_CAP_Y = GAL_CENTER_Y - GAL_H / 2 - GAL_BORDER - 2.6
// Text `size` is in font units against a unit-scaled Text object, which on this
// composition works out at roughly 0.023 cm of cap height per unit — so a caption meant
// to be read under a 32 cm print is in the 70s, not in the 30s. Measured in the preview
// rather than guessed: at 32 the caption was about a centimetre tall next to a print
// thirty times that, which is a caption you can see is there and cannot read.
const GAL_CAP_SIZE = 76
const GAL_SUB_Y = GAL_CAP_Y - 3.4
const GAL_SUB_SIZE = 58
// Row three: where these photographs came from, in one sentence. Dimmer and smaller
// than the counter because it is standing information rather than something to read
// every time — but always present, because a gallery whose delete button does not
// delete remotely has to say so at the point the delete button is.
const GAL_FOOT_Y = GAL_SUB_Y - 3.0
const GAL_FOOT_SIZE = 44
const GAL_TEXT_X = 0
const GAL_SWATCH_X = -GAL_W / 2 + 1.2
const GAL_SWATCH_R = 1.05
const GAL_SWATCH_RING = 0.16
// Which side of the garment a yaw is looking at. Under 45 degrees off the front is
// still the front; 135 or more is the back; anything between shows a sleeve and a
// slice of both torsos, which is honestly a "side".
const GAL_FACING_FRONT_DEG = 45
const GAL_FACING_BACK_DEG = 135

// --- Empty state --------------------------------------------------------------
const GAL_EMPTY_SIZE = 128
const GAL_EMPTY_SUB_SIZE = 66
const GAL_EMPTY_SUB_DY = -4.6
// Where the source line sits in the empty state, which has no print above it to hang off.
const GAL_EMPTY_FOOT_Y = GAL_CENTER_Y + GAL_EMPTY_SUB_DY - 4.2

// --- Input blocker --------------------------------------------------------------
// Exactly the review's: an invisible collider nearer the eye than every control, so
// while the gallery is up the interactor's ray targets it and the slider, tray,
// platform and stickers underneath cannot be touched by accident. Dismissal stays
// deliberate — the close chip, and only the close chip.
const GAL_BLOCK_Z = -101
const GAL_BLOCK_SIZE = 300

/** One mounted print in the carousel. Built once; bound to a record per frame. */
interface Slot {
  root: SceneObject
  border: SceneObject
  ring: SceneObject | null // Pass 30 (glass): rounds the image's corners
  image: SceneObject
  mat: Material
  boundId: number
  boundTex: Texture | null
}

/** What the gallery needs from the app around it. */
export interface PhotoGalleryHooks {
  /** The close chip was pressed. The booth puts the viewport's layers back. */
  onClose: () => void
}

export class PhotoGallery {
  private store: PhotoStore
  private hooks: PhotoGalleryHooks

  private root!: SceneObject
  private carouselRoot!: SceneObject
  private captionRoot!: SceneObject
  private emptyRoot!: SceneObject
  private slots: Slot[] = []

  private swatch!: SceneObject
  private metaText!: Text
  private countText!: Text
  private footText!: Text
  private counterText: Text | null = null // Pass 30 (glass)
  private counterPill: SceneObject | null = null
  private headCount: Text | null = null // Pass 32: the count chip in the head pill
  private leftArrow!: SceneObject
  private rightArrow!: SceneObject
  private deleteChip!: SceneObject

  private closeInteractable!: Interactable
  private deleteInteractable!: Interactable
  private leftInteractable!: Interactable
  private rightInteractable!: Interactable
  private blockInteractable!: Interactable

  private open_ = false
  private index = 0
  /** Where each card is drawn NOW, in slots from the centre, keyed by record id. */
  private disp: { [id: number]: number } = {}

  constructor(parent: SceneObject, store: PhotoStore, hooks: PhotoGalleryHooks) {
    this.store = store
    this.hooks = hooks
    this.build(parent)
    // A photo taken while the gallery is closed changes the store; re-reading on the
    // next open is enough, but refreshing here keeps the two in step if it is ever
    // changed from underneath while open (which is what a remote store will do).
    this.store.onChanged.add(() => this.refresh())
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Bind the SIK subscriptions. Called from OnStartEvent, where they must live. */
  init(): void {
    // Trigger END throughout — "when the press is released" — as everywhere else in
    // this project. It matters most for the close and delete chips: both tear their own
    // target out from under the gesture, and acting on trigger START would leave SIK
    // with a press it can never end.
    this.closeInteractable.onTriggerEnd.add(() => this.hooks.onClose())
    this.deleteInteractable.onTriggerEnd.add(() => this.deleteCurrent())
    this.leftInteractable.onTriggerEnd.add(() => this.step(-1))
    this.rightInteractable.onTriggerEnd.add(() => this.step(1))
    // The blocker carries an Interactable with no handler ON PURPOSE — see GAL_BLOCK_Z.
  }

  /** Show the gallery, newest photo centred. */
  open(): void {
    // PASS 49: the same sentence the footer is about to show, in the log, so a clone that
    // is being run from the console learns it too. Prints only when the config is empty.
    logNoCredentialsOn("Gallery")
    this.open_ = true
    this.index = 0
    this.disp = {} // cards appear at rest, not mid-slide
    this.root.enabled = true
    // Tell the source that now is a good time to re-read itself. A session-only store
    // ignores this; a remote one starts a listing and fires onChanged when it lands.
    // Nothing here waits for it — the carousel opens on whatever is already known, which
    // for a photograph taken a moment ago is the photograph itself.
    this.store.refresh()
    this.layout(0)
  }

  /** Hide it. Nothing about the design was touched. */
  close(): void {
    this.open_ = false
    this.root.enabled = false
  }

  isOpen(): boolean {
    return this.open_
  }

  /** Per-frame. Runs the carousel's easing; a no-op while closed. */
  update(dt: number): void {
    if (!this.open_) return
    if (this.store.tick) this.store.tick(dt) // Pass 36: expires the delete notice
    this.layout(dt)
  }

  // ---------------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------------

  /** Page one card. -1 is toward the newer end (leftwards), +1 toward the older. */
  step(dir: number): void {
    const n = this.count()
    if (n === 0) return
    const next = Math.max(0, Math.min(n - 1, this.index + dir))
    if (next === this.index) return
    // Only the index moves. The next update() eases every card toward its new slot —
    // laying out with dt 0 here would settle them on the spot and there would be no
    // carousel, just a cut.
    this.index = next
  }

  /**
   * Delete the centred photograph.
   *
   * `index` is left alone: after the removal the same index names the card that was to
   * the RIGHT of the deleted one, which is what should now be centred. The cards to the
   * left keep their targets and do not move; the ones to the right each lose a slot and
   * slide in. Both fall out of the per-card easing — see note 2 at the top of the file.
   */
  /** Pass 36 (verification): the record currently centred, or null. */
  centred(): PhotoRecord | null {
    return this.store.at(this.index)
  }

  deleteCurrent(): void {
    const rec = this.store.at(this.index)
    if (!rec) return
    this.store.remove(rec.id) // -> onChanged -> refresh()
  }

  /** Re-read the store after any change to it and re-lay-out. */
  private refresh(): void {
    const n = this.count()
    if (this.index > n - 1) this.index = Math.max(0, n - 1)
    // Same as step(): the next update() animates it. That is what makes a deletion
    // CLOSE the gap on screen rather than blink into its new arrangement.
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  /**
   * Place every visible card, the caption and the chips for this frame.
   *
   * `dt` of 0 means "settle instantly". Only `open()` uses it: a gallery that is opened
   * should already be arranged on its first frame, whereas everything that happens while
   * it is open — paging, deleting — is a movement and is left to the easing.
   */
  private layout(dt: number): void {
    const n = this.count()
    this.emptyRoot.enabled = n === 0
    this.carouselRoot.enabled = n > 0
    this.captionRoot.enabled = n > 0
    if (this.counterPill) this.counterPill.enabled = n > 0
    if (this.headCount) this.headCount.text = String(n)
    this.deleteChip.enabled = n > 0
    // The source line, in both states, at whichever height has content above it.
    const st = this.store.status()
    this.footText.text = st.line
    // Pass 34 hid the source line on the glass page; Pass 36 brings it back for the one
    // kind of line the user has to see — a delete in flight, or one the cloud refused.
    // An urgent line is also drawn in full white rather than the dim footer grey.
    if (GLASS) {
      // Pass 34 hid the source line here; Pass 36 brought it back for an urgent one.
      // PASS 49 brings it back for one more: with an empty SupabaseConfig.ts the footer
      // is the gallery's only place to say WHICH file needs filling in, and a state the
      // user has to act on is exactly the case this exception was carved for. Drawn in
      // the ordinary footer grey — it is a note, not an alarm.
      const urgent = st.urgent === true
      const noCreds = credentialsMissing()
      this.footText.getSceneObject().enabled = urgent || noCreds
      setTextColor(this.footText, urgent ? LABEL_COL : LABEL_DIM_COL) // Pass 43
    }
    this.footText.getSceneObject().getTransform().setLocalPosition(
      new vec3(GAL_TEXT_X, GLASS ? GAL_GLASS_FOOT_Y : (n === 0 ? GAL_EMPTY_FOOT_Y : GAL_FOOT_Y), GAL_Z)
    )

    if (n === 0) {
      this.leftArrow.enabled = false
      this.rightArrow.enabled = false
      this.disp = {}
      return
    }

    // 1. Ease every live card toward its slot, and rebuild `disp` from the live ids so
    //    a deleted card's animation state disappears with it.
    const k = dt > 0 ? Math.min(1, dt * GAL_EASE) : 1
    const next: { [id: number]: number } = {}
    const cards: { rec: PhotoRecord; d: number }[] = []
    for (let i = 0; i < n; i++) {
      const rec = this.store.at(i)
      if (!rec) continue
      const target = i - this.index
      const prev = this.disp[rec.id]
      let d = prev === undefined ? target : prev + (target - prev) * k
      if (Math.abs(target - d) < GAL_SNAP) d = target
      next[rec.id] = d
      cards.push({ rec: rec, d: d })
    }
    this.disp = next

    // 2. Bind the nearest cards to the fixed set of slots. Nearest first, so the centre
    //    always has one and the ones that fall off the end are the far ones.
    cards.sort((a, b) => Math.abs(a.d) - Math.abs(b.d))
    for (let s = 0; s < this.slots.length; s++) {
      const card = s < cards.length ? cards[s] : null
      if (!card || Math.abs(card.d) > GAL_VIS_SPAN) {
        this.slots[s].root.enabled = false
        continue
      }
      this.placeSlot(this.slots[s], card.rec, card.d)
    }

    // 3. Caption and chips for the centred record.
    const cur = this.store.at(this.index)
    if (cur) {
      setShapeColor(this.swatch, cur.shirtColor)
      this.metaText.text = facingLabel(cur.yawDeg) + "  ·  " + stickerLabel(cur.stickerCount)
      if (GLASS) {
        // The date lives in the card; the counter has a pill of its own.
        this.countText.text = (cur.createdAtMs > 0 ? formatStamp(cur.createdAtMs) : (cur.origin === "session" ? "this session" : "")) + uploadLabel(cur)
        if (this.counterText) this.counterText.text = this.index + 1 + " / " + n
      } else {
        this.countText.text = this.index + 1 + " / " + n + whenLabel(cur) + uploadLabel(cur)
      }
    }
    if (this.counterPill) this.counterPill.enabled = n > 0
    this.leftArrow.enabled = this.index > 0
    this.rightArrow.enabled = this.index < n - 1
  }

  /** One card at `d` slots from the centre: sideways, back, smaller and dimmer with |d|. */
  /** The store's count — or none, under the verification flag (see Stickers.ts). */
  private count(): number {
    return DEBUG_GALLERY_EMPTY ? 0 : this.store.count()
  }

  private placeSlot(slot: Slot, rec: PhotoRecord, d: number): void {
    slot.root.enabled = true
    const k = Math.min(Math.abs(d), 1)
    const s = 1 + (GAL_SIDE_SCALE - 1) * k
    const t = 1 + (GAL_SIDE_TINT - 1) * k
    const tf = slot.root.getTransform()
    tf.setLocalPosition(new vec3(d * GAL_SIDE_DX, GAL_CENTER_Y, GAL_Z + GAL_SIDE_DZ * k))
    // z scale stays 1 so the mount / image separation is not squashed with the card.
    tf.setLocalScale(new vec3(s, s, 1))
    // Pass 30: a side card turns away, as in the reference; the centre card faces you.
    const tilt = (-Math.sign(d) * k * GAL_SIDE_TILT_DEG * Math.PI) / 180
    tf.setLocalRotation(quat.angleAxis(tilt, new vec3(0, 1, 0)))
    if (!GLASS) setShapeColor(slot.border, new vec4(PRINT_COL.x * t, PRINT_COL.y * t, PRINT_COL.z * t, PRINT_COL.w))

    // Re-bind only on a change — including a texture that ARRIVED on a record already
    // bound, which is what a remote store's download looks like from here.
    if (slot.boundId !== rec.id || slot.boundTex !== rec.texture) {
      slot.boundId = rec.id
      slot.boundTex = rec.texture
      if (rec.texture) {
        try { (slot.mat.mainPass as any).baseTex = rec.texture } catch (_e) { /* ignore */ }
      }
      // No pixels yet -> the empty mount, which is a print with nothing in it.
      slot.image.enabled = rec.texture !== null
    }
    try { (slot.mat.mainPass as any).baseColor = new vec4(t, t, t, 1) } catch (_e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private build(parent: SceneObject): void {
    const quad = uiQuad()
    const disc = uiDisc()

    this.root = global.scene.createSceneObject("PhotoGallery")
    this.root.setParent(parent)

    // Input blocker (no visual, collider only) — see GAL_BLOCK_Z.
    const blocker = global.scene.createSceneObject("GalleryBlocker")
    blocker.setParent(this.root)
    blocker.getTransform().setLocalPosition(new vec3(0, 0, GAL_BLOCK_Z))
    const blockCol = blocker.createComponent("Physics.ColliderComponent") as ColliderComponent
    const blockShape = Shape.createBoxShape()
    blockShape.size = new vec3(GAL_BLOCK_SIZE, GAL_BLOCK_SIZE, 3)
    blockCol.shape = blockShape
    blockCol.fitVisual = false
    this.blockInteractable = blocker.createComponent(Interactable.getTypeName()) as Interactable
    this.blockInteractable.targetingMode = 3

    // The cards.
    this.carouselRoot = global.scene.createSceneObject("GalleryCarousel")
    this.carouselRoot.setParent(this.root)
    for (let i = 0; i < GAL_SLOTS; i++) this.slots.push(this.buildSlot(this.carouselRoot, quad))

    // The caption, under the centred print.
    this.captionRoot = global.scene.createSceneObject("GalleryCaption")
    this.captionRoot.setParent(this.root)
    const cornerX = GAL_W / 2 + GAL_BORDER
    const cornerY = GAL_CENTER_Y + GAL_H / 2 + GAL_BORDER
    const tri = buildTriangle()
    if (GLASS) {
      // Pass 30 — Refs/ui_galery. Title block, Back pill, the turntable, the caption
      // INSIDE the centre card's band, a square trash chip inside its corner, round arrows
      // lower down and a counter pill at the bottom.
      const head = addHeadPill(this.root, new vec3(0, HEAD_Y, GAL_CHROME_Z), GAL_TITLE_WORD, "image", 0, true)
      this.headCount = head.countText
      addLabel(this.root, new vec3(0, HEAD_Y + HEAD_SUB_DY, GAL_CHROME_Z), GAL_TITLE_SUB, HEAD_SUB_SIZE, ACCENT_VIOLET, HorizontalAlignment.Center, true)
      const back = addBackCircle(this.root, BACK_CIRCLE_POS, true)
      this.closeInteractable = back.getComponent(Interactable.getTypeName()) as Interactable
      addTurntable(this.root, new vec3(0, TABLE_WORLD_Y, TABLE_WORLD_Z), true)

      const imageBottom = GAL_CENTER_Y - GAL_H / 2
      const line1 = imageBottom + GAL_CAP_LINE1_DY
      const line2 = imageBottom + GAL_CAP_LINE2_DY
      const sw = GAL_SWATCH_R * 0.7
      this.swatch = addFlatShape(this.captionRoot, disc, new vec3(GAL_CAP_SWATCH_X, line1, GAL_Z + 0.5), new vec3(sw, sw, 1), new vec4(1, 1, 1, 1), 0, true)
      addFlatShape(this.captionRoot, buildRing(1 - GAL_SWATCH_RING / GAL_SWATCH_R, 40), new vec3(GAL_CAP_SWATCH_X, line1, GAL_Z + 0.6), new vec3(sw, sw, 1), LABEL_DIM_COL, 0, true)
      this.metaText = addLabel(this.captionRoot, new vec3(GAL_CAP_TEXT_X, line1, GAL_Z + 0.5), "Front  ·  no stickers", GAL_GLASS_CAP_SIZE, LABEL_COL, HorizontalAlignment.Center, true)
      addCalendarGlyph(this.captionRoot, new vec3(GAL_CAP_CAL_X, line2, GAL_Z + 0.5), true)
      this.countText = addLabel(this.captionRoot, new vec3(GAL_CAP_TEXT_X, line2, GAL_Z + 0.5), "", GAL_GLASS_SUB_SIZE, LABEL_DIM_COL, HorizontalAlignment.Center, true)

      // The counter pill, and the footer under it (on the root: shown in the empty state).
      this.counterPill = global.scene.createSceneObject("GalleryCounter")
      this.counterPill.setParent(this.root)
      this.counterPill.getTransform().setLocalPosition(new vec3(0, GAL_COUNTER_Y, GAL_Z))
      addFlatShape(this.counterPill, uiRoundRect(GAL_COUNTER_W + 0.32, GAL_COUNTER_H + 0.32, GAL_COUNTER_H / 2 + 0.16), new vec3(0, 0, -0.1), new vec3(1, 1, 1), GAL_CARD_RIM, 0, true)
      addFlatShape(this.counterPill, uiRoundRect(GAL_COUNTER_W, GAL_COUNTER_H, GAL_COUNTER_H / 2), vec3.zero(), new vec3(1, 1, 1), PLATE_COL, 0, true)
      this.counterText = addLabel(this.counterPill, new vec3(0, 0, 0.2), "1 / 1", GAL_COUNTER_SIZE, LABEL_COL, HorizontalAlignment.Center, true)
      this.footText = addLabel(this.root, new vec3(GAL_TEXT_X, GAL_GLASS_FOOT_Y, GAL_Z), "", GAL_GLASS_FOOT_SIZE, LABEL_DIM_COL, HorizontalAlignment.Center, true)
      this.footText.getSceneObject().enabled = false // Pass 34: no source line on the glass page

      // Trash: a square glass chip inside the card's top-right corner.
      this.deleteChip = global.scene.createSceneObject("GalleryChip")
      this.deleteChip.setParent(this.root)
      this.deleteChip.getTransform().setLocalPosition(new vec3((GAL_W / 2 - GAL_TRASH_SIZE / 2 - GAL_TRASH_INSET) * GAL_PROJ, (GAL_CENTER_Y + GAL_H / 2 - GAL_TRASH_SIZE / 2 - GAL_TRASH_INSET) * GAL_PROJ, GAL_CHROME_Z + GAL_CHIP_LIFT))
      addFlatShape(this.deleteChip, uiRoundRect(GAL_TRASH_SIZE, GAL_TRASH_SIZE, GAL_TRASH_R), vec3.zero(), new vec3(1, 1, 1), GAL_GLASS_CHIP_FILL, 0, true)
      addFlatShape(this.deleteChip, uiRoundRing(GAL_TRASH_SIZE, GAL_TRASH_SIZE, GAL_TRASH_R, 0.12), new vec3(0, 0, 0.05), new vec3(1, 1, 1), new vec4(1, 1, 1, 0.35), 0, true)
      this.drawTrash(this.deleteChip, LABEL_COL, GAL_GLASS_CHIP_FILL)
      const dcol = this.deleteChip.createComponent("Physics.ColliderComponent") as ColliderComponent
      const dshape = Shape.createBoxShape()
      dshape.size = GAL_CHIP_HIT
      dcol.shape = dshape
      dcol.fitVisual = false
      this.deleteInteractable = this.deleteChip.createComponent(Interactable.getTypeName()) as Interactable
      this.deleteInteractable.targetingMode = 3

      // Round arrows with a violet ring, lower down beside the turntable.
      this.leftArrow = this.buildChip(this.root, new vec3(-GAL_GLASS_ARROW.x, GAL_GLASS_ARROW.y, GAL_CHROME_Z + GAL_CHIP_LIFT), GAL_ARROW_R, ACCENT_VIOLET, GAL_ARROW_HIT, GAL_GLASS_CHIP_FILL)
      addFlatShape(this.leftArrow, tri, new vec3(-0.08, 0, 0.2), new vec3(GAL_ARROW_TRI.x, GAL_ARROW_TRI.y, 1), LABEL_COL, Math.PI, true)
      this.leftInteractable = this.leftArrow.getComponent(Interactable.getTypeName()) as Interactable
      this.rightArrow = this.buildChip(this.root, new vec3(GAL_GLASS_ARROW.x, GAL_GLASS_ARROW.y, GAL_CHROME_Z + GAL_CHIP_LIFT), GAL_ARROW_R, ACCENT_VIOLET, GAL_ARROW_HIT, GAL_GLASS_CHIP_FILL)
      addFlatShape(this.rightArrow, tri, new vec3(0.08, 0, 0.2), new vec3(GAL_ARROW_TRI.x, GAL_ARROW_TRI.y, 1), LABEL_COL, 0, true)
      this.rightInteractable = this.rightArrow.getComponent(Interactable.getTypeName()) as Interactable
    } else {
      this.swatch = addFlatShape(
        this.captionRoot, disc, new vec3(GAL_SWATCH_X, GAL_CAP_Y, GAL_Z),
        new vec3(GAL_SWATCH_R, GAL_SWATCH_R, 1), new vec4(1, 1, 1, 1), 0, true
      )
      addFlatShape(
        this.captionRoot, buildRing(1 - GAL_SWATCH_RING / GAL_SWATCH_R, 40),
        new vec3(GAL_SWATCH_X, GAL_CAP_Y, GAL_Z + 0.1),
        new vec3(GAL_SWATCH_R, GAL_SWATCH_R, 1), LABEL_DIM_COL, 0, true
      )
      this.metaText = addLabel(
        this.captionRoot, new vec3(GAL_TEXT_X, GAL_CAP_Y, GAL_Z), "Front  ·  no stickers",
        GAL_CAP_SIZE, LABEL_COL, HorizontalAlignment.Center, true
      )
      this.countText = addLabel(
        this.captionRoot, new vec3(GAL_TEXT_X, GAL_SUB_Y, GAL_Z), "1 / 1",
        GAL_SUB_SIZE, LABEL_DIM_COL, HorizontalAlignment.Center, true
      )
      // Parented to the gallery root, not the caption root: it is shown in the EMPTY state
      // too, which is exactly when "cloud save is off" most needs saying.
      this.footText = addLabel(
        this.root, new vec3(GAL_TEXT_X, GAL_FOOT_Y, GAL_Z), "",
        GAL_FOOT_SIZE, LABEL_DIM_COL, HorizontalAlignment.Center, true
      )

      // Chips. Close on the top-right corner of the centred print; delete on the top-LEFT
      // corner, the same chip with a trash glyph and a warm ring.
      const closeChip = this.buildChip(this.root, new vec3(cornerX, cornerY, GAL_Z + GAL_CHIP_LIFT), GAL_CHIP_R, CHIP_EDGE, GAL_CHIP_HIT)
      addFlatShape(closeChip, quad, new vec3(0, 0, 0.2), new vec3(GAL_CLOSE_LEN, GAL_CLOSE_BAR, 1), CHIP_GLYPH, Math.PI / 4, true)
      addFlatShape(closeChip, quad, new vec3(0, 0, 0.2), new vec3(GAL_CLOSE_LEN, GAL_CLOSE_BAR, 1), CHIP_GLYPH, -Math.PI / 4, true)
      this.closeInteractable = closeChip.getComponent(Interactable.getTypeName()) as Interactable

      this.deleteChip = this.buildChip(this.root, new vec3(-cornerX, cornerY, GAL_Z + GAL_CHIP_LIFT), GAL_CHIP_R, CHIP_DANGER, GAL_CHIP_HIT)
      this.drawTrash(this.deleteChip, CHIP_GLYPH, CHIP_FILL)
      this.deleteInteractable = this.deleteChip.getComponent(Interactable.getTypeName()) as Interactable

      this.leftArrow = this.buildChip(this.root, new vec3(-GAL_ARROW_X, GAL_CENTER_Y, GAL_Z + GAL_CHIP_LIFT), GAL_ARROW_R, CHIP_EDGE, GAL_ARROW_HIT)
      addFlatShape(this.leftArrow, tri, new vec3(-0.08, 0, 0.2), new vec3(GAL_ARROW_TRI.x, GAL_ARROW_TRI.y, 1), CHIP_GLYPH, Math.PI, true)
      this.leftInteractable = this.leftArrow.getComponent(Interactable.getTypeName()) as Interactable

      this.rightArrow = this.buildChip(this.root, new vec3(GAL_ARROW_X, GAL_CENTER_Y, GAL_Z + GAL_CHIP_LIFT), GAL_ARROW_R, CHIP_EDGE, GAL_ARROW_HIT)
      addFlatShape(this.rightArrow, tri, new vec3(0.08, 0, 0.2), new vec3(GAL_ARROW_TRI.x, GAL_ARROW_TRI.y, 1), CHIP_GLYPH, 0, true)
      this.rightInteractable = this.rightArrow.getComponent(Interactable.getTypeName()) as Interactable
    }

    // Empty state: said plainly, where the print would have been. Not an empty carousel
    // and not a placeholder frame — there is nothing to browse, and pretending otherwise
    // would leave the arrows and the delete chip standing over nothing.
    this.emptyRoot = global.scene.createSceneObject("GalleryEmpty")
    this.emptyRoot.setParent(this.root)
    addLabel(this.emptyRoot, new vec3(0, GAL_CENTER_Y, GAL_Z), "No photos yet", GAL_EMPTY_SIZE, LABEL_COL, HorizontalAlignment.Center, true)
    addLabel(
      this.emptyRoot, new vec3(0, GAL_CENTER_Y + GAL_EMPTY_SUB_DY, GAL_Z),
      "Press the camera button to take one.", GAL_EMPTY_SUB_SIZE, LABEL_DIM_COL,
      HorizontalAlignment.Center, true
    )

    setLayerDeep(this.root, LAYERS.photo)
    this.root.enabled = false
  }

  /** One mounted print: a white margin, and the photograph itself just in front of it. */
  private buildSlot(parent: SceneObject, quad: RenderMesh): Slot {
    const root = global.scene.createSceneObject("GallerySlot")
    root.setParent(parent)
    let border: SceneObject
    let ring: SceneObject | null = null
    if (GLASS) {
      // Pass 30: the dark card with its violet rim; the image's corners are rounded by
      // a ring drawn over it (Geo.buildRoundedRectRing). The card is taller than the
      // image by the caption band, so its centre sits half a band below the image's.
      const cw = GAL_W + 2 * GAL_CARD_T
      const ch = GAL_H + 2 * GAL_CARD_T + GAL_CAP_BAND
      const cy = -GAL_CAP_BAND / 2
      addFlatShape(root, uiRoundRect(cw + 2 * GAL_CARD_RIM_T, ch + 2 * GAL_CARD_RIM_T, GAL_CARD_R + GAL_CARD_RIM_T), new vec3(0, cy, -0.1), new vec3(1, 1, 1), GAL_CARD_RIM, 0, true)
      border = addFlatShape(root, uiRoundRect(cw, ch, GAL_CARD_R), new vec3(0, cy, 0), new vec3(1, 1, 1), GAL_CARD_FILL, 0, true)
      // Pass 34: the corner-rounding ring used to be exactly the card's width, so its outer
      // edge sat ON the rim's inner edge along the top, left and right (the bottom has the
      // caption band, no ring) and its anti-aliased edge darkened the rim there. It now
      // stops GAL_RING_INSET short of the card's edge on every side.
      ring = addFlatShape(root, uiRoundRing(GAL_W + 2 * GAL_CARD_T - 2 * GAL_RING_INSET, GAL_H + 2 * GAL_CARD_T - 2 * GAL_RING_INSET, GAL_CARD_R - 0.4 - GAL_RING_INSET, GAL_CARD_T - GAL_RING_INSET), new vec3(0, 0, 0.4), new vec3(1, 1, 1), GAL_CARD_FILL, 0, true)
    } else {
      border = addFlatShape(
        root, quad, vec3.zero(),
        new vec3(GAL_W + 2 * GAL_BORDER, GAL_H + 2 * GAL_BORDER, 1), PRINT_COL, 0, true
      )
    }

    const image = global.scene.createSceneObject("GalleryImage")
    image.setParent(root)
    const itf = image.getTransform()
    itf.setLocalPosition(new vec3(0, 0, 0.2))
    itf.setLocalScale(new vec3(GAL_W, GAL_H, 1))
    const visual = image.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = quad
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

    root.enabled = false
    return { root: root, border: border, ring: ring, image: image, mat: mat, boundId: -1, boundTex: null }
  }

  /** A white action chip with an accent ring and a box collider, ready for its glyph. */
  /** The trash glyph: can, lid, grip, and two slots knocked back out in the chip's fill. */
  private drawTrash(chip: SceneObject, glyph: vec4, fill: vec4): void {
    const quad = uiQuad()
    addFlatShape(chip, quad, new vec3(0, GAL_TRASH_CAN_Y, 0.2), new vec3(GAL_TRASH_CAN.x, GAL_TRASH_CAN.y, 1), glyph, 0, true)
    addFlatShape(chip, quad, new vec3(0, GAL_TRASH_LID_Y, 0.2), new vec3(GAL_TRASH_LID.x, GAL_TRASH_LID.y, 1), glyph, 0, true)
    addFlatShape(chip, quad, new vec3(0, GAL_TRASH_GRIP_Y, 0.2), new vec3(GAL_TRASH_GRIP.x, GAL_TRASH_GRIP.y, 1), glyph, 0, true)
    addFlatShape(chip, quad, new vec3(-GAL_TRASH_SLOT_X, GAL_TRASH_CAN_Y, 0.3), new vec3(GAL_TRASH_SLOT.x, GAL_TRASH_SLOT.y, 1), fill, 0, true)
    addFlatShape(chip, quad, new vec3(GAL_TRASH_SLOT_X, GAL_TRASH_CAN_Y, 0.3), new vec3(GAL_TRASH_SLOT.x, GAL_TRASH_SLOT.y, 1), fill, 0, true)
  }

  private buildChip(parent: SceneObject, pos: vec3, r: number, edge: vec4, hit: vec3, fill: vec4 = CHIP_FILL): SceneObject {
    const chip = global.scene.createSceneObject("GalleryChip")
    chip.setParent(parent)
    chip.getTransform().setLocalPosition(pos)
    addFlatShape(chip, uiDisc(), vec3.zero(), new vec3(r, r, 1), fill, 0, true)
    addFlatShape(chip, buildRing(1 - GAL_CHIP_RING / r, 48), new vec3(0, 0, 0.1), new vec3(r, r, 1), edge, 0, true)
    const col = chip.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = hit
    col.shape = shape
    col.fitVisual = false
    const inter = chip.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3 // Direct + Indirect, so mouse + hand both hit it
    return chip
  }
}

/** Which side of the garment a yaw was showing. See GAL_FACING_*_DEG. */
export function facingLabel(yawDeg: number): string {
  let a = yawDeg % 360
  if (a > 180) a -= 360
  if (a < -180) a += 360
  const m = Math.abs(a)
  if (m <= GAL_FACING_FRONT_DEG) return "Front"
  if (m >= GAL_FACING_BACK_DEG) return "Back"
  return "Side"
}

/**
 * When the photograph was taken, for the counter row.
 *
 * created_at is a real wall-clock timestamp now, so this is a date — but it degrades:
 * a record with no usable clock (a session photograph on a runtime whose Date is
 * stubbed) falls back to the ordering it already has rather than printing 1970.
 */
export function whenLabel(rec: PhotoRecord): string {
  if (rec.createdAtMs > 0) return "  ·  " + formatStamp(rec.createdAtMs)
  return rec.origin === "session" ? "  ·  this session" : ""
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** epoch ms -> "2 Sep 10:34", in the viewer's own timezone. */
export function formatStamp(ms: number): string {
  try {
    const d = new Date(ms)
    const pad = (n: number) => (n < 10 ? "0" + n : "" + n)
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
  } catch (_e) {
    return ""
  }
}

/**
 * What happened to this photograph's upload — but only while it is worth saying.
 *
 * A cloud record is self-evidently saved and a session record with nothing to report
 * (no credentials configured) says nothing at all, because "local" is the normal state
 * of this Lens, not a warning.
 */
export function uploadLabel(rec: PhotoRecord): string {
  if (rec.imageMissing) return "  ·  image unavailable"
  if (rec.origin !== "session") return ""
  if (rec.upload === "uploading") return "  ·  saving…"
  if (rec.upload === "saved") return "  ·  saved"
  if (rec.upload === "failed") return "  ·  not saved"
  return ""
}

/** "no stickers" / "1 sticker" / "n stickers". */
export function stickerLabel(n: number): string {
  if (n <= 0) return "no stickers"
  if (n === 1) return "1 sticker"
  return n + " stickers"
}
