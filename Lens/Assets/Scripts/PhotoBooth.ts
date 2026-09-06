// PhotoBooth — take a still photograph of the shirt you just designed, and keep it
// (Pass 12; the gallery and the icon-only buttons are Pass 13).
//
// THE IDEA. In the real world you would photograph the finished garment. There is no
// camera in the Editor preview, so the Lens takes the picture of itself: a second camera
// renders the SHIRT LAYER ONLY into a render target, and pressing the shutter FREEZES
// that frame into an independent texture. The frozen texture is then shown back, large,
// with a close chip to return to editing.
//
// ===========================================================================
// 1. THE PART THAT DECIDES WHETHER THIS WORKS — THE FREEZE
// ===========================================================================
// A render target is not a picture, it is a live surface: its camera redraws it every
// frame, so anything that merely displays `photoRT` is a MIRROR — recolour the shirt and
// the "photo" recolours with it. The mechanism that turns the live surface into a still
// is:
//
//     ProceduralTextureProvider.createFromTexture(photoRT)
//
// which allocates a NEW texture and copies the source's current pixels into it. What
// comes back is backed by a ProceduralTextureProvider, not by the render target: it has
// no camera, nothing redraws it, and it keeps the exact pixels of the instant the
// shutter was pressed for as long as it is referenced. The live shirt carries on being
// edited underneath and the photo does not move. That copy is the whole trick, and it is
// the only place in this file where a Texture is created per shot.
//
// Two alternatives were rejected. (a) Displaying `photoRT` directly and disabling its
// camera: the target keeps whatever was last drawn, but there is exactly ONE of it, so a
// second photo destroys the first and a gallery is impossible. (b) Reading the pixels
// back with getPixels() into a new ProceduralTextureProvider: same result, a full
// CPU round-trip slower, and createFromTexture already is that operation done on the GPU.
//
// ===========================================================================
// 2. HOW THE UI IS KEPT OUT
// ===========================================================================
// By layer, not by hiding: the capture camera's renderLayer is LAYERS.shirt and nothing
// else, so the slider, the tray, the platform, the selection frame, the tap targets and
// the ambient motes are not merely invisible in the shot — they are not submitted to it.
// See Layers.ts for the full split.
//
// The selection frame is on the UI layer and so is already excluded, but the shutter
// ALSO asks StickerSystem to suspend its chrome for the exposure (onCaptureBegin /
// onCaptureEnd) and puts it back afterwards. Suspending rather than deselecting is what
// keeps the promise that everything is exactly where it was: `selected` is never
// touched, so the same sticker is still selected, still at its position, scale and angle,
// when the photo is dismissed.
//
// ===========================================================================
// 3. THE BACKGROUND — AND WHAT A TRANSPARENT DISPLAY DOES TO IT
// ===========================================================================
// The capture frames a seamless: an opaque card in PHOTO_BG standing BACKDROP_Z behind
// the shirt on a layer only the capture camera renders. A card rather than a clear
// colour, because a camera's clear defaults to the device background and on a Lens the
// device background is the street — which is exactly the "screenshot of the street" this
// had to avoid, and is what the first build of this produced. Read back with getPixels,
// the frozen texture is now a clean product shot: rgba(204,207,214,255) everywhere the
// garment is not.
//
// PHOTO_BG is LIGHT, and that is a display decision rather than a taste one. Specs is a
// see-through display: the Lens is composited onto the world additively, so black is
// transparent and only light is added. There is no such thing as an opaque surface on it
// — measured here across every blend mode and clear option, a white quad comes out
// white, a mid-grey one comes out as a 44% wash with the street legible through it, and a
// near-black one is invisible. A dark or mid-grey seamless would therefore be a window,
// not a ground. A light one is dense on the display AND is the classic product-shot
// seamless, so the photograph reads as a bright card held up in front of you, which is
// what a photograph held up in front of you actually looks like through glasses.
//
// The review does not try to dim the world behind it either — it cannot. What it does
// instead is take the viewport's LAYERS: while a photo is up the scene camera renders the
// PHOTO layer only, so the shirt, the tray, the slider and the platform are not drawn and
// the print has the frame to itself. See bindViewportCamera.
//
// ===========================================================================
// 4. THE GALLERY (Pass 13)
// ===========================================================================
// Pass 12 filed each shot into a list against this pass needing one, and that is what
// happened: the capture still does not produce "the photo", it hands a draft to a
// PhotoStore and shows the newest. What changed is that the list is now behind an
// INTERFACE (PhotoStore.ts) rather than being an array field here, because the store is
// moving to Supabase — see the note at the top of PhotoStore.ts for the shape of that
// swap, and note 5 in PhotoGallery.ts for what local persistence could and could not do.
//
// This file keeps the capture, the freeze, the two buttons and the single-photo review
// it always had. The carousel is PhotoGallery's, and the only things the booth does for
// it are the two it already knew how to do: swap the viewport camera onto the PHOTO
// layer while a surface is up, and put the layers back on close.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { buildRing, buildTriangle } from "./Geo"
import { LAYERS, ViewportLayers, setLayerDeep } from "./Layers"
import { PhotoGallery, formatStamp } from "./PhotoGallery"
import { FULL_CLAIM_REVIEW, PhotoRecord, PhotoStore, UploadState } from "./PhotoStore"
import {
  addFlatShape,
  addLabel,
  setShapeColor,
  uiDisc,
  uiQuad,
  whiteTexture,
  CHIP_EDGE,
  CHIP_FILL,
  CHIP_GLYPH,
  GLYPH_COL,
  LABEL_COL,
  PHOTO_RT_H,
  PHOTO_RT_W,
  PLATE_COL,
  PRINT_COL,
  QUAD_MAT,
  RIM_COL,
  addGlassPanel,
  addButtonWord,
  WIDE_BTN_W,
  WIDE_BTN_H,
  WIDE_BTN_R,
  WIDE_BTN_GLYPH_X,
  WIDE_BTN_GLYPH_SCALE,
  addCalendarGlyph,
  addTurntable,
  uiRoundRect,
  uiRoundRing,
  TABLE_WORLD_Y,
  TABLE_WORLD_Z,
  ACCENT_VIOLET,
  LABEL_DIM_COL,
  addHeadPill,
  addBackCircle,
  BACK_CIRCLE_POS,
  HEAD_Y,
  setTextColor, // Pass 43
  stackVisual,
} from "./PhotoUi"
import { GLASS, pick, UI_COL_X, UI_BTN_DX } from "./UiTheme"
import { DEBUG_PHOTO_NO_UPLOAD } from "./Stickers"

// --- The capture -------------------------------------------------------------
// The 7:8 portrait frame, the palette, the shared meshes and the flat-shape builder all
// come from PhotoUi (Pass 13): the gallery is a second surface in the same family and
// the two must not be able to disagree about any of them.
// Where the capture camera stands, measured forward (+Z) from the shirt's own centre,
// and how much of the world it frames vertically there. The shirt is
// SHIRT_TARGET_HEIGHT_CM (30) tall, so 42 cm of frame leaves an even margin all round
// and 36.75 cm of width — enough for the sleeves at any yaw.
const PHOTO_CAM_DIST = 62
const PHOTO_FRAME_H_CM = 42
const PHOTO_CAM_NEAR = 1
const PHOTO_CAM_FAR = 400
// Renders after the sticker bake (renderOrder -10) so the shirt's texture is this
// frame's, and before the main camera (0).
const PHOTO_CAM_ORDER = -5
// The seamless the shirt is photographed against — a LIGHT neutral in classic (see note 3
// above). Pass 30 (glass): a DARK grey, rgb(43,45,51) — the darkest grey that still reads
// as a deliberate studio ground next to the near-black photo card (0.05) in Preview, and
// light enough that a black garment's silhouette still separates from it. The cost is the
// one note 3 describes: on the see-through display a 17% grey is mostly window, so on
// device the ground shows the room through it and the garment reads as floating in a
// framed card, while the stored photograph (phone, web, gallery) is a proper dark studio.
const PHOTO_BG = pick(new vec4(0.80, 0.81, 0.84, 1.0), new vec4(0.45, 0.46, 0.50, 1.0))
// and painted onto a physical card rather than left to the camera's clear. How far behind
// the shirt's centre it stands, and how big it is. At PHOTO_CAM_DIST + 42 = 104 cm from
// the lens the frame is 70 x 62 cm, so 100 x 88 covers it with room to spare at any yaw.
const BACKDROP_Z = -42
const BACKDROP_SIZE = new vec2(100, 88)

// How many frames the capture camera is left running before the pixels are copied. The
// camera is enabled inside a tap handler, which is before this frame's render; one frame
// would be enough, two is margin against the render happening later in the tick than the
// handler that enabled it.
const CAPTURE_WARMUP_FRAMES = 2

// --- The shutter button (under the colour slider) ----------------------------
// The slider panel is 5.5 x 30 centred at (-21, 0, -110), so it spans y -15..+15; the
// button tucks 1.5 cm below its bottom edge. It is nudged left of the panel's centre so
// its right edge clears the rotation platform (which spans x -16.2..+16.2 at y -18.9).
// Plate size and plate position are UNCHANGED from Pass 12 — Pass 13 drops the word
// "Photo" and nothing else, so the control keeps its place and its footprint and only
// its contents change.
// Pass 32: the stack closed up (pitch 6.5 -> 4.6) and the buttons shrank; the grab boxes stay generous.
const PB_CENTER = new vec3(-(UI_COL_X + UI_BTN_DX), pick(-19.2, -19.0), -110)
// PASS 16 — A CIRCLE, AND A SMALLER ONE. Up to Pass 15 the plate was a 9.4 x 4.9 cm
// ellipse, which was the shape the word "Photo" needed and which outlived the word by
// three passes. One radius replaces the two half-axes, so the plate cannot be anything
// but round, and 2.5 takes the footprint from 36 cm2 to 19.6 — a 46% reduction that is
// obvious next to the platform rather than a nudge.
//
// THE HIT BOX IS UNCHANGED. PB_HIT is still 10.4 x 6.2, which is now more than twice the
// plate in width: what shrank is what you look at, not what you press — the same split
// the rotation platform's button has always used.
const PB_R = 2.5 // plate radius
const PB_RIM_PAD = 0.3 // soft lit rim past the plate body, as on the platform
const PB_HIT = pick(new vec3(10.4, 6.2, 3), new vec3(10.4, 4.5, 3)) // grab box — deliberately far larger than the plate
// Both glyphs were drawn for the old, wider plate. Rather than re-dimension a dozen
// constants, they are scaled as a group — so the camera and the picture frame keep their
// proportions to each other exactly, and one number tunes how much air is left inside
// the circle.
// Pass 24 (glass): the button is the wide rounded rectangle from PhotoUi (same centre,
// same PB_HIT), the glyph moves left inside it and the word sits to its right.
const PB_GLYPH_SCALE = pick(0.78, WIDE_BTN_GLYPH_SCALE)
// Camera glyph, drawn as geometry like the rotate and resize handles. Pass 13: the
// label is gone, so the glyph moves to the PLATE'S CENTRE. It kept its size — an
// icon-only button whose icon is also the same size as it was is the whole change.
const PB_GLYPH_X = pick(0, WIDE_BTN_GLYPH_X)
const PB_BODY = new vec2(2.9, 2.05) // camera body (before PB_GLYPH_SCALE). Pass 46: 1.72 -> 2.05, so the icon is 1.55 x 1.32 like the reference's 1.55 x 1.33
const PB_BUMP = new vec2(1.02, 0.42) // viewfinder hump on top of the body
const PB_BUMP_X = -0.62
const PB_LENS_R = 0.58
const PB_LENS_BAR = 0.12 // lens ring stroke
const PB_DOT_R = 0.15 // shutter pip, top-right of the body
const PB_WORD = "Photo" // glass only
const GB_WORD = "Gallery" // glass only (Pass 25: English throughout)

// --- The gallery button (directly under the shutter) -------------------------
// The same plate, the same rim, the same hit box, one plate-height plus a gap below —
// so the two read as a pair of controls rather than as two separate ideas. A camera to
// TAKE a photograph and a framed picture to LOOK at them is the pairing every phone
// uses, and it is why neither needs a word under it.
const GB_GAP = 1.5 // clear space between the two plates
const PB_PITCH = pick(2 * PB_R + GB_GAP, 4.6) // Pass 32 (glass): button plus one clear centimetre
const GB_CENTER = new vec3(PB_CENTER.x, PB_CENTER.y - PB_PITCH, PB_CENTER.z)
// Picture glyph: a frame, knocked out, with a sun and two hills inside it.
const GB_FRAME = new vec2(2.9, 2.6) // Pass 46: 2.9 x WIDE_BTN_GLYPH_SCALE = the measured 1.55 box; 2.6 tall so the icon is 1.55 x 1.39 like the reference's 1.50 x 1.40
const GB_FRAME_BAR = 0.25 // frame stroke
const GB_SUN_R = 0.27
const GB_SUN = new vec2(-0.78, 0.42)
const GB_HILL_W = 2.02 // the big hill: width and height on screen...
const GB_HILL_H = 1.0
const GB_HILL_X = 0.34
const GB_HILL_Y = -0.56
const GB_HILL2_W = 1.24 // ...and the small one in front of it
const GB_HILL2_H = 0.68
const GB_HILL2_X = -0.62
const GB_HILL2_Y = -0.72

// --- The upload indicator (under the gallery button) -------------------------
// One dot and one short line, directly under the two buttons. It is the whole of the
// cloud's presence in the editing UI, and it is deliberately not a control: nothing here
// can be pressed, nothing blocks, and nothing appears in front of the garment.
//
// The no-credentials case is the one this is really designed around. A judge cloning the
// public repo runs with an empty config, and the honest thing to show is not an error
// and not silence — it is a dim, permanent, unalarming line saying the feature is off.
// So "Cloud save off" is a STATE, drawn in the same grey as the slider's caption, and it
// never blinks, never retries and never asks for anything.
const UP_CENTER = new vec3(GB_CENTER.x, GB_CENTER.y - (PB_R + 2.05), GB_CENTER.z)
const UP_DOT_X = -3.5
const UP_DOT_R = 0.38
const UP_TEXT_X = 0.5
const UP_TEXT_SIZE = 44
// How long "Saved" stays up before the row fades back to nothing. A success does not
// need to persist — the gallery is where a photograph's fate is actually reported.
const UP_SAVED_HOLD_SEC = 3.5
// A failure stays until the next capture: it is the one state the user might want to act
// on, and it costs nothing to leave a dim four-word line on screen.
const UP_FAILED_HOLD_SEC = 1e9
// The dot's colours: off, in flight, landed, refused. Muted deliberately — this is a
// status light, not an alert.
const UP_COL_OFF = new vec4(0.55, 0.58, 0.64, 0.55)
const UP_COL_BUSY = new vec4(0.98, 0.80, 0.38, 0.95)
const UP_COL_OK = new vec4(0.45, 0.86, 0.62, 0.95)
const UP_COL_FAIL = new vec4(0.94, 0.52, 0.48, 0.95)
const UP_TEXT_OFF = new vec4(1, 1, 1, 0.42)
const UP_TEXT_ON = new vec4(1, 1, 1, 0.72)
// The words. "Cloud save off" rather than "unavailable": nothing is broken, and the
// difference matters to someone deciding whether they have configured it wrong.
const UP_WORD_OFF = "Cloud save off"
const UP_WORD_BUSY = "Saving…"
const UP_WORD_OK = "Saved to cloud"
const UP_WORD_FAIL = "Not saved"

// --- The review ---------------------------------------------------------------
// The print sits just in front of the UI plane (z -110) rather than close to the eye: the
// composition is already known to be visible out to x +/-26 at that depth, so a print
// sized inside that box is on screen whatever the field of view turns out to be. It is
// held at arm's length, which is where you would hold a photograph.
// Pass 32: the card stands ON the plate — at the garments' own depth (-110, ten centimetres
// behind the chrome), scaled by the same ten percent so it reads the size it did, with its
// bottom edge on the plate's centre line (VIEW_CARD_FOOT_Y, in that plane).
const VIEW_Z = pick(-100, -110)
const VIEW_CENTER_Y = pick(0.0, 6.6)
const VIEW_H = pick(46, 28.6) // printed height in cm; width follows the capture's aspect
const VIEW_CHROME_Z = -100 // the head pill and the Back circle stay at the panels' depth
const VIEW_PROJ = VIEW_CHROME_Z / VIEW_Z // where a card point projects to at the chrome depth (the x chip must sit in front of the blocker)
// --- Pass 30 (glass): Refs/ui_photo — the gallery's family. Title block, Back pill, one
// dark rounded card with a violet rim and four corner brackets, the x chip inside its
// top-right corner, the calendar + date caption in the band, the turntable underneath.
const VIEW_TITLE_Y = 24.0
const VIEW_BACK_POS = new vec3(-24, 24, -100)
const VIEW_TITLE_WORD = "Creation captured" // Pass 32: a check mark, then the words
const VIEW_TITLE_SUB = "Your creation has been captured"
const VIEW_CARD_T = 0.9
const VIEW_CARD_R = 2.6
const VIEW_CAP_BAND = 4.8
const VIEW_CARD_FILL = new vec4(0.05, 0.05, 0.08, 0.88)
const VIEW_CARD_RIM = new vec4(0.62, 0.42, 0.98, 0.92) // Pass 33: near-opaque — see PhotoGallery.GAL_CARD_RIM
const VIEW_CARD_RIM_T = 0.18
const VIEW_RING_INSET = 0.3
const VIEW_BRACKET_LEN = 3.2 // the corner brackets' arm length
const VIEW_BRACKET_T = 0.32
const VIEW_BRACKET_INSET = 0.9 // from the image's corner, inwards
const VIEW_GLASS_CHIP_FILL = new vec4(0.10, 0.10, 0.14, 0.92)
const VIEW_GLASS_CAP_SIZE = 42
const VIEW_GLASS_CAP_DY = -2.5 // from the image's bottom edge
const VIEW_GLASS_CAL_X = -6.2
const VIEW_GLASS_CAP_X = 0.9
const VIEW_W = (VIEW_H * PHOTO_RT_W) / PHOTO_RT_H
const VIEW_BORDER = 0.95 // white margin around the image, so it reads as a print
const VIEW_BLOCK_Z = -101 // the input blocker's plane: behind the print, in front of every control
const VIEW_BLOCK_SIZE = 300 // comfortably past any field of view
const VIEW_CAP_Y = -VIEW_H / 2 - VIEW_BORDER - 1.8 // caption, below the print
// Sized against the same measurement that set the gallery's caption (see GAL_CAP_SIZE):
// at 32 this caption was about a centimetre tall under a 46 cm print and could be seen
// to be there without being readable. Pass 13 only changes the number.
const VIEW_CAP_SIZE = 68
const VIEW_CLOSE_R = 1.3 // close chip radius
const VIEW_CLOSE_RING = 0.11
const VIEW_CLOSE_BAR = 0.15 // stroke of the x
const VIEW_CLOSE_LEN = 1.36
const VIEW_CLOSE_HIT = new vec3(4.0, 4.0, 3)

/**
 * One photograph — the record type moved to PhotoStore.ts in Pass 13, where the source
 * of photographs lives. Re-exported under its old name so nothing that referred to a
 * "Photo" has to be renamed to keep working.
 */
export type Photo = PhotoRecord

/** What the booth needs from the rest of the app, so it owns none of it. */
export interface PhotoBoothHooks {
  /** Hide the editing chrome for the exposure (belt and braces over the layer split). */
  onCaptureBegin: () => void
  /** Put the chrome back, exactly as it was. */
  onCaptureEnd: () => void
  /** The state to stamp on the record. */
  readState: () => { shirtColor: vec4; yawDeg: number; stickerCount: number }
}

/**
 * Idle -> Exposing (capture camera running, waiting out CAPTURE_WARMUP_FRAMES) ->
 * Viewing (a frozen photo is on screen) -> Idle, plus Gallery (the carousel is up),
 * which idle enters and returns to directly. A string union rather than a const enum:
 * the project compiles with isolatedModules, which rules const enums out.
 *
 * Viewing and Gallery are mutually exclusive on purpose: both draw on the PHOTO layer,
 * and both take the viewport camera's layers for as long as they are up, so exactly one
 * of them may be on screen at a time.
 */
type BoothState = "idle" | "exposing" | "viewing" | "gallery"

export class PhotoBooth {
  private root: SceneObject
  private hooks: PhotoBoothHooks
  private quadMesh: RenderMesh
  private discMesh: RenderMesh

  // Capture rig
  private photoRT!: Texture
  private photoCamObj!: SceneObject
  private photoCam!: Camera
  private backdrop!: SceneObject

  // Review overlay. The camera swap itself lives in ViewportLayers (Pass 16), shared
  // with the import panel so three overlays cannot disagree about who owns the screen.
  private viewport: ViewportLayers
  private viewerRoot!: SceneObject
  private printObj!: SceneObject
  private photoObj!: SceneObject
  private photoMat!: Material
  private captionText!: Text
  private closeChip: SceneObject | null = null // classic only since Pass 35

  // Buttons
  private buttonObj!: SceneObject
  private galleryButtonObj!: SceneObject
  private statusDot!: SceneObject
  private statusText!: Text
  private statusShown: UploadState | "off" = "off"
  private statusUntil = 0
  private shutterInteractable!: Interactable
  private galleryInteractable!: Interactable
  private closeInteractable: Interactable | null = null // classic only since Pass 35
  private blockInteractable!: Interactable

  // THE STORE — handed in, never owned: see PhotoStore.ts. Swapping the session store
  // for a Supabase-backed one is a different object at this reference and nothing else.
  private store: PhotoStore
  private gallery!: PhotoGallery
  private viewIndex = -1
  /**
   * PASS 19 — the record the review is currently printing, held by reference rather than
   * by index because the store's indices shift as photographs arrive and are deleted.
   * While it is non-null this photograph is holding 3.5 MB of full-resolution pixels on
   * the review's behalf; letting go of it is what releases them.
   */
  private reviewing: PhotoRecord | null = null

  private state: BoothState = "idle"
  private exposureFrames = 0
  private elapsed = 0

  /**
   * @param root   parent for the whole rig (the unscaled main root)
   * @param center the world point the composition is built around (the shirt's centre)
   * @param store  where photographs live (PhotoStore.ts) — in-session today, remote later
   * @param hooks  chrome suspend / restore + the state to stamp on each record
   */
  constructor(
    root: SceneObject,
    center: vec3,
    store: PhotoStore,
    viewport: ViewportLayers,
    hooks: PhotoBoothHooks
  ) {
    this.root = root
    this.store = store
    this.viewport = viewport
    this.hooks = hooks
    this.quadMesh = uiQuad()
    this.discMesh = uiDisc()

    this.buildCaptureRig(center)
    this.buildButton()
    this.buildGalleryButton()
    this.buildUploadIndicator()
    this.buildViewer()
    // The carousel reads the same store the shutter writes to, and asks to be closed
    // through the booth so the viewport camera's layers are restored in one place.
    this.gallery = new PhotoGallery(root, store, { onClose: () => this.closeGallery() })
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Bind the SIK subscriptions. Called from OnStartEvent, where they must live. */
  init(): void {
    // Both on trigger END — "when the press is released" — which is also what the sticker
    // tray does. It matters for the close chip in particular: dismissing hides the chip's
    // own SceneObject, so acting on trigger START would tear the target out from under a
    // gesture that has not finished, and SIK never gets to end it.
    this.shutterInteractable.onTriggerEnd.add(() => this.requestCapture())
    this.galleryInteractable.onTriggerEnd.add(() => this.openGallery())
    // Pass 35: glass has no x chip on the card — Back alone dismisses (see buildGlassViewer).
    if (this.closeInteractable) this.closeInteractable.onTriggerEnd.add(() => this.dismiss())
    this.gallery.init()
    // The scrim carries an Interactable with no handler ON PURPOSE: it sits nearer the
    // eye than every control, so while a photo is up the interactor's ray targets it
    // and the slider / tray / platform / stickers underneath cannot be touched by
    // accident. Dismissal stays deliberate — the close chip, and only the close chip.
  }

  /** Per-frame. Runs the exposure countdown; idle otherwise. */
  update(dt: number): void {
    this.elapsed += dt
    this.updateUploadIndicator()
    // The carousel eases its cards; it returns immediately while closed.
    this.gallery.update(dt)
    if (this.state !== "exposing") return
    this.exposureFrames++
    if (this.exposureFrames >= CAPTURE_WARMUP_FRAMES) this.freeze()
  }

  /**
   * Press the shutter — the same entry point the button's tap calls.
   *
   * It does not capture here. It starts the capture camera and hands the chrome
   * suspend to the app, then lets `update` count out CAPTURE_WARMUP_FRAMES so the
   * render target genuinely holds a frame drawn with the chrome down before the pixels
   * are copied. Capturing inline would copy whatever the target held from last time.
   */
  requestCapture(): void {
    if (this.state !== "idle") return
    this.state = "exposing"
    this.exposureFrames = 0
    this.hooks.onCaptureBegin()
    this.photoCamObj.enabled = true
  }

  /** Close the review and return to editing. Nothing about the design was touched. */
  dismiss(): void {
    if (this.state !== "viewing") return
    this.viewerRoot.enabled = false
    this.restoreViewportLayers()
    this.state = "idle"
    // PASS 19 — the print is off the screen, so the review no longer needs the full
    // capture. If the upload has already finished with it this is the call that swaps in
    // the thumbnail and lets 3.5 MB go; if not, the uploader's own release will.
    this.endReview()
  }

  /**
   * Let go of whatever the review was printing. Idempotent, and safe to call when nothing
   * is being reviewed — which is why both dismiss() and showPhoto() can call it without
   * either having to know what the other did.
   */
  private endReview(): void {
    const rec = this.reviewing
    this.reviewing = null
    if (rec) this.store.releaseFull(rec, FULL_CLAIM_REVIEW)
  }

  /**
   * Open the carousel — the same entry point the gallery button's tap calls.
   *
   * It takes the viewport's layers exactly as the single-photo review does, for exactly
   * the same reason (see bindViewportCamera): while the gallery is up the scene camera
   * renders the PHOTO layer and nothing else, so the prints have the frame to themselves
   * and not one object in the design is enabled, disabled or moved to achieve it.
   */
  openGallery(): void {
    if (this.state !== "idle") return
    this.gallery.open()
    this.viewport.take(LAYERS.photo)
    this.state = "gallery"
  }

  /** Close the carousel and return to editing, everything exactly as it was left. */
  closeGallery(): void {
    if (this.state !== "gallery") return
    this.gallery.close()
    this.restoreViewportLayers()
    this.state = "idle"
  }

  /** Page the carousel. -1 is toward the newer end, +1 toward the older. */
  galleryStep(dir: number): void {
    if (this.state !== "gallery") return
    this.gallery.step(dir)
  }

  /** Delete the centred photograph in the carousel. */
  galleryDelete(): void {
    if (this.state !== "gallery") return
    this.gallery.deleteCurrent()
  }

  /** Pass 36 (verification): which record the carousel is showing, so a harness delete can name it. */
  galleryCentred(): PhotoRecord | null {
    if (this.state !== "gallery") return null
    return this.gallery.centred()
  }

  /** True while the carousel is on screen. */
  isGalleryOpen(): boolean {
    return this.state === "gallery"
  }

  /** The store the shutter writes to and the carousel reads. */
  getStore(): PhotoStore {
    return this.store
  }

  /** Which photo the single-photo review is showing, or -1 when nothing is up. */
  getViewIndex(): number {
    return this.state === "viewing" ? this.viewIndex : -1
  }

  /** True while a frozen photo is on screen in the single-photo review. */
  isViewing(): boolean {
    return this.state === "viewing"
  }

  /**
   * Show photo `i` in the single-photo review. NEWEST FIRST, as everywhere else since
   * Pass 13 — a capture shows index 0, which is the shot just taken.
   */
  showPhoto(i: number): void {
    const p = this.store.at(i)
    if (!p) return
    // Hand the previous photograph's full-resolution pixels back before printing another.
    // In practice the review only ever shows the shot just taken, but a second showPhoto
    // without a dismiss would otherwise pin the first one for the rest of the session.
    if (this.reviewing && this.reviewing !== p) this.endReview()
    this.viewIndex = i
    this.reviewing = p
    if (p.texture) {
      try { (this.photoMat.mainPass as any).baseTex = p.texture } catch (_e) { /* ignore */ }
    }
    this.photoObj.enabled = p.texture !== null
    this.captionText.text = GLASS
      ? (p.createdAtMs > 0 ? formatStamp(p.createdAtMs) : "this session") + "   ·   " + (i + 1) + " / " + this.store.count()
      : i + 1 + " / " + this.store.count()
    this.viewerRoot.enabled = true
    this.viewport.take(LAYERS.photo)
    this.state = "viewing"
  }

  /** Put the scene camera back on the layers it edits with. */
  private restoreViewportLayers(): void {
    this.viewport.release()
  }

  // ---------------------------------------------------------------------------
  // The freeze
  // ---------------------------------------------------------------------------

  /**
   * Copy the live render target into an INDEPENDENT texture and file it as a Photo.
   *
   * `ProceduralTextureProvider.createFromTexture` is the mechanism: it allocates a new
   * texture backed by a ProceduralTextureProvider and copies the source's current
   * contents into it. No camera writes to the result, so it is a still. This is the one
   * line in the file that makes the difference between a photo and a mirror.
   */
  /**
   * Pass 31 (verification): the average of a patch at the garment's chest in the frozen
   * photograph, printed so a picked colour can be compared with what it renders as.
   */
  private debugReadCentre(frozen: Texture): void {
    try {
      const ctrl = frozen.control as ProceduralTextureProvider
      const w = frozen.getWidth()
      const h = frozen.getHeight()
      const s = 24
      const spots: [string, number, number][] = [["chest", 0.5, 0.42], ["belly", 0.5, 0.55], ["ground", 0.12, 0.12]]
      let msg = "[PHOTO] " + w + "x" + h
      for (const [name, fx, fy] of spots) {
        const buf = new Uint8Array(s * s * 4)
        ctrl.getPixels(Math.floor(fx * w - s / 2), Math.floor(fy * h - s / 2), s, s, buf)
        let r = 0, g = 0, b = 0
        for (let i = 0; i < s * s; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2] }
        msg += " " + name + "=(" + Math.round(r / (s * s)) + "," + Math.round(g / (s * s)) + "," + Math.round(b / (s * s)) + ")"
      }
      print(msg)
    } catch (e) {
      print("[PHOTO] readback failed: " + e)
    }
  }

  private freeze(): void {
    const frozen = ProceduralTextureProvider.createFromTexture(this.photoRT)
    if (DEBUG_PHOTO_NO_UPLOAD) this.debugReadCentre(frozen) // Pass 31: colour-space measurement, harness only
    // Stop the capture camera first — its work for this shot is done, and leaving it
    // running would redraw the target (and cost a pass) for nothing.
    this.photoCamObj.enabled = false
    this.hooks.onCaptureEnd()

    const st = this.hooks.readState()
    // Filed through the store, which owns ordering and the cap on how many are kept.
    // An upload is this same call against a different implementation.
    this.store.add({
      texture: frozen,
      takenAtSec: this.elapsed,
      shirtColor: st.shirtColor,
      yawDeg: st.yawDeg,
      stickerCount: st.stickerCount,
    })
    this.showPhoto(0) // newest first, so the shot just taken is index 0
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * The capture camera and the render target it draws into.
   *
   * It stands PHOTO_CAM_DIST in front of the shirt's centre looking straight at it, and
   * it does not move: the shirt turns on its own pivot under the platform slider, so a
   * fixed camera photographs whichever side is facing — the chest at 0 degrees, the back
   * at 180 — which is exactly what a product camera on a tripod does.
   */
  private buildCaptureRig(center: vec3): void {
    this.photoRT = global.scene.createRenderTargetTexture()
    const ctrl = this.photoRT.control as RenderTargetProvider
    ctrl.useScreenResolution = false
    ctrl.resolution = new vec2(PHOTO_RT_W, PHOTO_RT_H)
    ctrl.clearColorOption = ClearColorOption.CustomColor
    ctrl.clearColor = PHOTO_BG

    this.photoCamObj = global.scene.createSceneObject("PhotoCaptureCam")
    this.photoCamObj.setParent(this.root)
    this.photoCamObj
      .getTransform()
      .setWorldPosition(new vec3(center.x, center.y, center.z + PHOTO_CAM_DIST))
    setLayerDeep(this.photoCamObj, LAYERS.ui)

    const cam = this.photoCamObj.createComponent("Component.Camera") as Camera
    cam.type = Camera.Type.Perspective
    // The frame is dialled in, not inherited: devicePropertyUsage None keeps the device
    // from overriding fov/aspect, so the shot is composed the same in the Editor preview
    // and on the glasses.
    cam.devicePropertyUsage = Camera.DeviceProperty.None
    cam.aspect = PHOTO_RT_W / PHOTO_RT_H
    cam.fov = 2 * Math.atan(PHOTO_FRAME_H_CM / 2 / PHOTO_CAM_DIST)
    cam.near = PHOTO_CAM_NEAR
    cam.far = PHOTO_CAM_FAR
    cam.renderOrder = PHOTO_CAM_ORDER
    cam.renderTarget = this.photoRT
    cam.enableClearDepth = true
    // Clear settings live on the camera's first ColorRenderTarget; the older
    // Camera.enableClearColor / Camera.clearColor pair is deprecated and warns at boot.
    this.setClearColor(cam, ClearColorOption.CustomColor, PHOTO_BG)
    // The seamless: an opaque card the size of the frame, standing behind the shirt on a
    // layer nothing else renders. Built as a child of the camera's own parent rather than
    // of the shirt, so it never turns with the garment.
    this.backdrop = global.scene.createSceneObject("PhotoBackdrop")
    this.backdrop.setParent(this.root)
    this.backdrop.getTransform().setWorldPosition(new vec3(center.x, center.y, center.z + BACKDROP_Z))
    const bv = this.backdrop.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    bv.mesh = this.quadMesh
    stackVisual(bv) // Pass 43
    this.backdrop.getTransform().setLocalScale(new vec3(BACKDROP_SIZE.x, BACKDROP_SIZE.y, 1))
    // StickerQuadMat (the unlit ImageMaterial) over MoteMaterial, and a 1x1 white base
    // texture under the colour. This is the material the compositor already draws its
    // full-frame OPAQUE fabric background with, so it is known to write a solid, fully
    // opaque pixel — which is the entire job here. The card has to cover the render
    // target's clear completely, in the ALPHA channel as much as in colour: the frozen
    // texture is displayed with alpha blending, so any alpha the background leaves below
    // 1 shows the live street through the finished print.
    const bmat = QUAD_MAT.clone()
    const bpass: any = bmat.mainPass
    try { bpass.baseTex = whiteTexture() } catch (_e) { /* ignore */ }
    try { bpass.baseColor = PHOTO_BG } catch (_e) { /* ignore */ }
    try { bpass.blendMode = BlendMode.Disabled } catch (_e) { /* ignore */ } // straight write, alpha included
    try { bpass.twoSided = true } catch (_e) { /* ignore */ }
    // Ordinary opaque geometry: the shirt is depth-tested PBR and has to sit in FRONT of
    // the card, which is what a real depth test gives for free.
    try { bpass.depthTest = true } catch (_e) { /* ignore */ }
    try { bpass.depthWrite = true } catch (_e) { /* ignore */ }
    bv.clearMaterials()
    bv.addMaterial(bmat)
    setLayerDeep(this.backdrop, LAYERS.backdrop)

    // THE point of the whole layer split: the subject, its ground, and nothing else.
    cam.renderLayer = LAYERS.shirt.union(LAYERS.backdrop)
    this.photoCam = cam

    // Off until the shutter is pressed — a render target only costs a pass while its
    // camera is running, and there is no reason to redraw the product shot 30 times a
    // second when it is looked at once.
    this.photoCamObj.enabled = false
  }

  /** Clear options live on the camera's first ColorRenderTarget (the non-deprecated route). */
  private setClearColor(cam: Camera, option: ClearColorOption, color: vec4): void {
    try {
      const targets = cam.colorRenderTargets
      if (!targets || targets.length === 0) return
      targets[0].clearColorOption = option
      targets[0].clearColor = color
      // Re-assign the array. Lens Studio hands back a COPY of an array-valued property,
      // so mutating an element in place can be silently discarded.
      cam.colorRenderTargets = targets
    } catch (_e) { /* older runtime without ColorRenderTarget — the defaults are fine */ }
  }

  /**
   * Bind the scene's own camera — the review is drawn by IT, not by a camera of our own.
   *
   * The first build of this used a second camera at renderOrder 10 with no colour clear,
   * so the review composited over the finished frame and the live shirt stayed visible,
   * dimmed, behind the print. It does not work, and the reason is worth writing down: a
   * Lens is composited over the device camera feed using its render target's ALPHA, an
   * overlay pass full of blended quads never raises that alpha, and the print came out
   * about 70% transparent with the street legible straight through the photograph. Every
   * combination of blend mode, depth mode and clear option produced the same picture.
   *
   * What does work is the layer split this pass already built. While a photo is up the
   * scene camera renders the PHOTO layer and nothing else, so the print has the frame to
   * itself and nothing is competing with it; being LIGHT (see PHOTO_BG) is then enough
   * for it to read as a photograph on a see-through display. Dismissing puts the
   * camera's layers back.
   *
   * Nothing is enabled or disabled to do it, so the design underneath is not touched:
   * the shirt, the stickers, the selection and every control are still there, still in
   * the same state, simply not being drawn for the moment you are looking at a print.
   */
  bindViewportCamera(cam: Camera | null): void {
    this.viewport.bind(cam)
  }

  /**
   * The shutter: a slim dark plate with a soft rim and a camera glyph drawn from
   * geometry — the plate language of the rotation platform, so it reads as one more
   * control rather than a new idea.
   *
   * PASS 13 — ICON ONLY. The word "Photo" is gone and the glyph has moved to the plate's
   * centre. The plate itself is untouched: same size, same PB_CENTER, same PB_HIT, so
   * the control did not move and did not change how easy it is to hit. Dropping the word
   * is what lets the gallery button sit under it as an equal — two glyphs on two
   * identical plates is a pair; a worded button over a wordless one is a mistake.
   */
  private buildButton(): void {
    this.buttonObj = this.buildPlate("PhotoButton", PB_CENTER)

    // Camera glyph: body + viewfinder hump + lens ring + shutter pip.
    const k = PB_GLYPH_SCALE
    const g = PB_GLYPH_X // Pass 35: the glyph's CENTRE, not scaled — scaling it pulled the glyph 0.87 cm inwards
    this.addShape(this.buttonObj, this.quadMesh, new vec3(g + PB_BUMP_X * k, (PB_BODY.y / 2 + PB_BUMP.y / 2) * k, 0.2), new vec3(PB_BUMP.x * k, PB_BUMP.y * k, 1), GLYPH_COL)
    this.addShape(this.buttonObj, this.quadMesh, new vec3(g, 0, 0.2), new vec3(PB_BODY.x * k, PB_BODY.y * k, 1), GLYPH_COL)
    // The lens is knocked OUT of the body in the plate's own colour, so the glyph reads
    // as a camera rather than as a filled rectangle with a ring on it.
    this.addShape(this.buttonObj, this.discMesh, new vec3(g, 0, 0.3), new vec3(PB_LENS_R * k, PB_LENS_R * k, 1), PLATE_COL)
    this.addShape(this.buttonObj, buildRing(1 - PB_LENS_BAR / PB_LENS_R, 40), new vec3(g, 0, 0.4), new vec3(PB_LENS_R * k, PB_LENS_R * k, 1), GLYPH_COL)
    this.addShape(this.buttonObj, this.discMesh, new vec3(g + (PB_BODY.x / 2 - 0.42) * k, (PB_BODY.y / 2 - 0.38) * k, 0.3), new vec3(PB_DOT_R * k, PB_DOT_R * k, 1), PLATE_COL)
    addButtonWord(this.buttonObj, PB_WORD)

    this.shutterInteractable = this.buttonObj.getComponent(Interactable.getTypeName()) as Interactable
  }

  /**
   * The gallery button: the same plate, directly below the shutter, carrying a framed
   * picture instead of a camera.
   *
   * Drawn the way every glyph in this project is drawn — knocked out of solids rather
   * than imported as a PNG — so it scales, recolours and lives on the UI layer with
   * everything else, and so the two buttons are provably the same object with a
   * different centre and different contents.
   */
  private buildGalleryButton(): void {
    this.galleryButtonObj = this.buildPlate("GalleryButton", GB_CENTER)
    const tri = buildTriangle()

    // The frame: a filled rectangle with its interior knocked back out in the plate's
    // colour, leaving a stroke of GB_FRAME_BAR all round.
    const k = PB_GLYPH_SCALE
    const g = PB_GLYPH_X // Pass 35: the glyph's CENTRE, left of the word — see PhotoUi's button rule
    this.addShape(this.galleryButtonObj, this.quadMesh, new vec3(g, 0, 0.2), new vec3(GB_FRAME.x * k, GB_FRAME.y * k, 1), GLYPH_COL)
    this.addShape(
      this.galleryButtonObj, this.quadMesh, new vec3(g, 0, 0.3),
      new vec3((GB_FRAME.x - 2 * GB_FRAME_BAR) * k, (GB_FRAME.y - 2 * GB_FRAME_BAR) * k, 1), PLATE_COL
    )
    // A sun and two hills inside it — the picture that says "pictures".
    this.addShape(this.galleryButtonObj, this.discMesh, new vec3(g + GB_SUN.x * k, GB_SUN.y * k, 0.4), new vec3(GB_SUN_R * k, GB_SUN_R * k, 1), GLYPH_COL)
    // buildTriangle points +X, so the hills are scaled (height, width) and then turned a
    // quarter turn to point +Y: the transform scales BEFORE it rotates.
    this.addShape(this.galleryButtonObj, tri, new vec3(g + GB_HILL_X * k, GB_HILL_Y * k, 0.4), new vec3(GB_HILL_H * k, GB_HILL_W * k, 1), GLYPH_COL, Math.PI / 2)
    this.addShape(this.galleryButtonObj, tri, new vec3(g + GB_HILL2_X * k, GB_HILL2_Y * k, 0.5), new vec3(GB_HILL2_H * k, GB_HILL2_W * k, 1), GLYPH_COL, Math.PI / 2)
    addButtonWord(this.galleryButtonObj, GB_WORD)

    this.galleryInteractable = this.galleryButtonObj.getComponent(Interactable.getTypeName()) as Interactable
  }

  /**
   * The upload indicator: a dot and a word, under the gallery button.
   *
   * Built once and then only recoloured and relabelled — there is no object here that
   * appears or disappears, so it can never reflow the controls above it.
   */
  private buildUploadIndicator(): void {
    const root = global.scene.createSceneObject("UploadStatus")
    root.setParent(this.root)
    root.getTransform().setWorldPosition(UP_CENTER)
    this.statusDot = this.addShape(root, this.discMesh, new vec3(UP_DOT_X, 0, 0), new vec3(UP_DOT_R, UP_DOT_R, 1), UP_COL_OFF)
    this.statusText = addLabel(root, new vec3(UP_TEXT_X, 0, 0), UP_WORD_OFF, UP_TEXT_SIZE, UP_TEXT_OFF)
    setLayerDeep(root, LAYERS.ui)
  }

  /**
   * Reflect the store's upload state.
   *
   * Driven from the frame loop rather than from a callback, because the state it is
   * showing lives in the store and changes on a network thread's schedule — polling one
   * enum per frame is cheaper and far less brittle than threading an event through the
   * booth for something that is redrawn anyway.
   */
  private updateUploadIndicator(): void {
    const configured = this.storeHasCloud()
    let want: UploadState | "off" = configured ? this.store.lastUploadState() : "off"
    // A finished state reverts to the resting one once its hold expires.
    if ((want === "saved" || want === "local") && this.elapsed > this.statusUntil) {
      want = configured ? "local" : "off"
    }
    if (want === this.statusShown) return
    this.statusShown = want

    let col = UP_COL_OFF
    let word = UP_WORD_OFF
    let textCol = UP_TEXT_OFF
    if (want === "uploading") {
      col = UP_COL_BUSY; word = UP_WORD_BUSY; textCol = UP_TEXT_ON
      this.statusUntil = this.elapsed + UP_SAVED_HOLD_SEC
    } else if (want === "saved") {
      col = UP_COL_OK; word = UP_WORD_OK; textCol = UP_TEXT_ON
      this.statusUntil = this.elapsed + UP_SAVED_HOLD_SEC
    } else if (want === "failed") {
      col = UP_COL_FAIL; word = UP_WORD_FAIL; textCol = UP_TEXT_ON
      this.statusUntil = this.elapsed + UP_FAILED_HOLD_SEC
    } else if (want === "local") {
      // Cloud is configured and nothing is in flight: say nothing at all.
      col = UP_COL_OFF; word = ""; textCol = UP_TEXT_OFF
    }
    setShapeColor(this.statusDot, col)
    this.statusText.text = word
    setTextColor(this.statusText, textCol) // Pass 43
  }

  /** Does the store have a cloud behind it? Duck-typed so the booth stays source-agnostic. */
  private storeHasCloud(): boolean {
    const s: any = this.store
    return typeof s.cloudConfigured === "function" ? s.cloudConfigured() : false
  }

  /** The bare control plate both buttons are: rim, body, grab box, Interactable. */
  private buildPlate(name: string, center: vec3): SceneObject {
    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.root)
    obj.getTransform().setWorldPosition(center)

    if (GLASS) {
      // Pass 24: the wide rounded button, drawn inside the same PB_HIT box.
      addGlassPanel(obj, vec3.zero(), WIDE_BTN_W, WIDE_BTN_H, WIDE_BTN_R)
    } else {
      this.addShape(obj, this.discMesh, new vec3(0, 0, -0.1), new vec3(PB_R + PB_RIM_PAD, PB_R + PB_RIM_PAD, 1), RIM_COL)
      this.addShape(obj, this.discMesh, vec3.zero(), new vec3(PB_R, PB_R, 1), PLATE_COL)
    }

    const collider = obj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = PB_HIT // unchanged in either style
    collider.shape = shape
    collider.fitVisual = false // honour the explicit box size; never auto-fit to a child visual
    const inter = obj.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3 // Direct + Indirect, so mouse + hand both hit it

    setLayerDeep(obj, LAYERS.ui)
    return obj
  }

  /**
   * The review: the photo mounted on a white print border, a caption
   * carrying its place in the roll, and a close chip on the print's top-right corner.
   * Built once and hidden; a capture only swaps the texture and the caption.
   */
  private buildViewer(): void {
    this.viewerRoot = global.scene.createSceneObject("PhotoViewer")
    this.viewerRoot.setParent(this.root)

    // An invisible blocker, and no scrim. A dimming scrim was the first design and a
    // see-through display cannot have one: a dark quad adds no light, so it is simply not
    // there (verified — the same quad in red covers the frame, in near-black it is
    // invisible). What the review actually blocks is INPUT: this collider sits nearer the
    // eye than every control, so while a photo is up the interactor's ray targets it and
    // the slider, tray, platform and stickers underneath cannot be touched by accident.
    const blocker = global.scene.createSceneObject("PhotoBlocker")
    blocker.setParent(this.viewerRoot)
    blocker.getTransform().setLocalPosition(new vec3(0, 0, VIEW_BLOCK_Z))
    const blockCol = blocker.createComponent("Physics.ColliderComponent") as ColliderComponent
    const blockShape = Shape.createBoxShape()
    blockShape.size = new vec3(VIEW_BLOCK_SIZE, VIEW_BLOCK_SIZE, 3)
    blockCol.shape = blockShape
    blockCol.fitVisual = false
    this.blockInteractable = blocker.createComponent(Interactable.getTypeName()) as Interactable
    this.blockInteractable.targetingMode = 3

    if (GLASS) {
      this.buildGlassViewer()
    } else {
      // The print: a white margin, then the photograph itself just in front of it.
      this.printObj = this.addShape(
        this.viewerRoot, this.quadMesh,
        new vec3(0, VIEW_CENTER_Y, VIEW_Z),
        new vec3(VIEW_W + 2 * VIEW_BORDER, VIEW_H + 2 * VIEW_BORDER, 1),
        PRINT_COL, 0, true
      )

      this.photoObj = global.scene.createSceneObject("PhotoImage")
      this.photoObj.setParent(this.viewerRoot)
      const ptf = this.photoObj.getTransform()
      ptf.setLocalPosition(new vec3(0, VIEW_CENTER_Y, VIEW_Z + 0.2))
      ptf.setLocalScale(new vec3(VIEW_W, VIEW_H, 1))
      const pv = this.photoObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      pv.mesh = this.quadMesh
      stackVisual(pv) // Pass 43
      this.photoMat = QUAD_MAT.clone()
      const pp: any = this.photoMat.mainPass
      try { pp.baseColor = new vec4(1, 1, 1, 1) } catch (_e) { /* ignore */ }
      // Depth-sorted with the rest of the review — see addShape.
      try { pp.blendMode = BlendMode.Normal } catch (_e) { /* ignore */ }
      try { pp.depthTest = true } catch (_e) { /* ignore */ }
      try { pp.depthWrite = true } catch (_e) { /* ignore */ }
      try { pp.twoSided = true } catch (_e) { /* ignore */ }
      pv.clearMaterials()
      pv.addMaterial(this.photoMat)

      // Caption: which photo of how many. One photo this pass, so it reads "1 / 1" — and
      // it is already the gallery's counter.
      const capObj = global.scene.createSceneObject("PhotoCaption")
      capObj.setParent(this.viewerRoot)
      capObj.getTransform().setLocalPosition(new vec3(0, VIEW_CENTER_Y + VIEW_CAP_Y, VIEW_Z))
      this.captionText = capObj.createComponent("Component.Text") as Text
      stackVisual(this.captionText) // Pass 43
      this.captionText.text = "1 / 1"
      this.captionText.depthTest = true
      this.captionText.horizontalOverflow = HorizontalOverflow.Overflow
      this.captionText.horizontalAlignment = HorizontalAlignment.Center
      this.captionText.verticalAlignment = VerticalAlignment.Center
      this.captionText.size = VIEW_CAP_SIZE
      setTextColor(this.captionText, LABEL_COL) // Pass 43

      // Close chip on the print's top-right corner — the same white chip with an accent
      // ring and a dark slate x that the selection frame uses to remove a sticker, so
      // "this dismisses what is in front of you" reads the same way in both places.
      this.closeChip = global.scene.createSceneObject("PhotoClose")
      this.closeChip.setParent(this.viewerRoot)
      this.closeChip.getTransform().setLocalPosition(
        new vec3(VIEW_W / 2 + VIEW_BORDER, VIEW_CENTER_Y + VIEW_H / 2 + VIEW_BORDER, VIEW_Z + 0.4)
      )
      this.addShape(this.closeChip, this.discMesh, vec3.zero(), new vec3(VIEW_CLOSE_R, VIEW_CLOSE_R, 1), CHIP_FILL, 0, true)
      this.addShape(this.closeChip, buildRing(1 - VIEW_CLOSE_RING / VIEW_CLOSE_R, 48), new vec3(0, 0, 0.1), new vec3(VIEW_CLOSE_R, VIEW_CLOSE_R, 1), CHIP_EDGE, 0, true)
      this.addShape(this.closeChip, this.quadMesh, new vec3(0, 0, 0.2), new vec3(VIEW_CLOSE_LEN, VIEW_CLOSE_BAR, 1), CHIP_GLYPH, Math.PI / 4, true)
      this.addShape(this.closeChip, this.quadMesh, new vec3(0, 0, 0.2), new vec3(VIEW_CLOSE_LEN, VIEW_CLOSE_BAR, 1), CHIP_GLYPH, -Math.PI / 4, true)
      const closeCol = this.closeChip.createComponent("Physics.ColliderComponent") as ColliderComponent
      const closeShape = Shape.createBoxShape()
      closeShape.size = VIEW_CLOSE_HIT
      closeCol.shape = closeShape
      closeCol.fitVisual = false
      this.closeInteractable = this.closeChip.createComponent(Interactable.getTypeName()) as Interactable
      this.closeInteractable.targetingMode = 3
    }

    setLayerDeep(this.viewerRoot, LAYERS.photo)
    this.viewerRoot.enabled = false
  }

  /** Pass 30 (glass): the photo view to Refs/ui_photo. */
  private buildGlassViewer(): void {
    const r = this.viewerRoot
    addHeadPill(r, new vec3(0, HEAD_Y, VIEW_CHROME_Z), VIEW_TITLE_WORD, "check", null, true)
    const back = addBackCircle(r, BACK_CIRCLE_POS, true)
    addTurntable(r, new vec3(0, TABLE_WORLD_Y, TABLE_WORLD_Z), true)

    // The card: rim, dark fill, the photograph, a ring rounding its corners, brackets.
    const cw = VIEW_W + 2 * VIEW_CARD_T
    const ch = VIEW_H + 2 * VIEW_CARD_T + VIEW_CAP_BAND
    const cy = VIEW_CENTER_Y - VIEW_CAP_BAND / 2
    addFlatShape(r, uiRoundRect(cw + 2 * VIEW_CARD_RIM_T, ch + 2 * VIEW_CARD_RIM_T, VIEW_CARD_R + VIEW_CARD_RIM_T), new vec3(0, cy, VIEW_Z - 0.1), new vec3(1, 1, 1), VIEW_CARD_RIM, 0, true)
    this.printObj = addFlatShape(r, uiRoundRect(cw, ch, VIEW_CARD_R), new vec3(0, cy, VIEW_Z), new vec3(1, 1, 1), VIEW_CARD_FILL, 0, true)

    this.photoObj = global.scene.createSceneObject("PhotoImage")
    this.photoObj.setParent(r)
    const ptf = this.photoObj.getTransform()
    ptf.setLocalPosition(new vec3(0, VIEW_CENTER_Y, VIEW_Z + 0.2))
    ptf.setLocalScale(new vec3(VIEW_W, VIEW_H, 1))
    const pv = this.photoObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    pv.mesh = this.quadMesh
    stackVisual(pv) // Pass 43
    this.photoMat = QUAD_MAT.clone()
    const pp: any = this.photoMat.mainPass
    try { pp.baseColor = new vec4(1, 1, 1, 1) } catch (_e) { /* ignore */ }
    try { pp.blendMode = BlendMode.Normal } catch (_e) { /* ignore */ }
    try { pp.depthTest = true } catch (_e) { /* ignore */ }
    try { pp.depthWrite = true } catch (_e) { /* ignore */ }
    try { pp.twoSided = true } catch (_e) { /* ignore */ }
    pv.clearMaterials()
    pv.addMaterial(this.photoMat)
    addFlatShape(r, uiRoundRing(VIEW_W + 2 * VIEW_CARD_T - 2 * VIEW_RING_INSET, VIEW_H + 2 * VIEW_CARD_T - 2 * VIEW_RING_INSET, VIEW_CARD_R - 0.4 - VIEW_RING_INSET, VIEW_CARD_T - VIEW_RING_INSET), new vec3(0, VIEW_CENTER_Y, VIEW_Z + 0.4), new vec3(1, 1, 1), VIEW_CARD_FILL, 0, true) // Pass 34: clear of the rim (see PhotoGallery)

    // Four violet corner brackets, just inside the image's corners.
    const bx = VIEW_W / 2 - VIEW_BRACKET_INSET
    const by = VIEW_H / 2 - VIEW_BRACKET_INSET
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = sx * bx
        const cyy = VIEW_CENTER_Y + sy * by
        addFlatShape(r, this.quadMesh, new vec3(cx - sx * VIEW_BRACKET_LEN / 2, cyy, VIEW_Z + 0.6), new vec3(VIEW_BRACKET_LEN, VIEW_BRACKET_T, 1), ACCENT_VIOLET, 0, true)
        addFlatShape(r, this.quadMesh, new vec3(cx, cyy - sy * VIEW_BRACKET_LEN / 2, VIEW_Z + 0.6), new vec3(VIEW_BRACKET_T, VIEW_BRACKET_LEN, 1), ACCENT_VIOLET, 0, true)
      }
    }

    // Caption in the band: calendar glyph, date, counter.
    const capY = VIEW_CENTER_Y - VIEW_H / 2 + VIEW_GLASS_CAP_DY
    addCalendarGlyph(r, new vec3(VIEW_GLASS_CAL_X, capY, VIEW_Z + 0.5), true)
    this.captionText = addLabel(r, new vec3(VIEW_GLASS_CAP_X, capY, VIEW_Z + 0.5), "", VIEW_GLASS_CAP_SIZE, LABEL_DIM_COL, HorizontalAlignment.Center, true)

    // PASS 35 — NO x ON THE CARD. The card carried an x chip AND the page carries the Back
    // circle, and both did exactly the same thing: dismiss. Two controls for one action is
    // a question the reader has to answer before pressing either, so the chip is gone and
    // Back is the only way out. Nothing else about the card moved; the chip's grab box left
    // the audit with it.
    const backInteractable = back.getComponent(Interactable.getTypeName()) as Interactable
    backInteractable.onTriggerEnd.add(() => this.dismiss())
  }

  /**
   * One flat, unlit shape — the shared builder in PhotoUi, kept as a method here so the
   * existing call sites read as they did. See addFlatShape for what `depthSorted` means.
   */
  private addShape(
    parent: SceneObject,
    mesh: RenderMesh,
    pos: vec3,
    scale: vec3,
    color: vec4,
    rotZ: number = 0,
    depthSorted: boolean = false
  ): SceneObject {
    return addFlatShape(parent, mesh, pos, scale, color, rotZ, depthSorted)
  }
}
