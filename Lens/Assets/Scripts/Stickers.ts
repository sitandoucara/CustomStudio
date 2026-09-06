// Stickers — shared sticker constants (textures + the locked front-chest UV rect).
// Imported by StickerTrayUI (thumbnails), StickerCompositor (bake target), and
// StickerSystem (placement/selection). Keeping these in one place means the tray art,
// the baked stamp, and the world-space hit target all agree on the same 3 flowers.

// Flat flower sticker textures (imported PNGs, transparent background).
import { UI_COL_X, UI_PANEL_HALF_W, pick } from "./UiTheme"
export const STICKER_TEXTURES: Texture[] = [
  requireAsset("../GeneratedTextures/Daisy.png") as Texture,
  // Pass 34: the blue butterfly, second in the tray; drawn tight to its bounds (480 x 400).
  requireAsset("../GeneratedTextures/Butterfly.png") as Texture,
  requireAsset("../GeneratedTextures/CherryBlossom.png") as Texture,
  requireAsset("../GeneratedTextures/Sunflower.png") as Texture,
  // Pass 24: two more, drawn in the flowers' treatment (flat fill, hairline outline) and
  // trimmed to their alpha bounds offline like them — but NOT padded back to a square, so
  // each carries its own aspect (STICKER_ASPECT) and the frame hugs the ink from the start.
  requireAsset("../GeneratedTextures/Heart.png") as Texture,
  requireAsset("../GeneratedTextures/Bow.png") as Texture,
]
export const STICKER_NAMES: string[] = ["Daisy", "Butterfly", "CherryBlossom", "Sunflower", "Heart", "Bow"]
/** Long side is 1; the short side is the trimmed image's ratio (486x447 heart since Pass 40, 358x244 bow). */
export const STICKER_ASPECT: { w: number; h: number }[] = [
  { w: 1, h: 1 }, { w: 1, h: 0.848 }, { w: 1, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 0.920 }, { w: 1, h: 0.682 },
]

/**
 * ONE PIECE OF ARTWORK a sticker can be made of (Pass 16).
 *
 * Until now a sticker was a Texture and nothing else, because all three were square
 * PNGs trimmed to their alpha bounds at build time (Pass 9) — so "the texture" and "the
 * visible artwork" were the same rectangle and neither the frame nor the seam clamp had
 * to tell them apart. An imported image breaks both assumptions at once: it arrives with
 * whatever transparent padding its author left around it, and it is very likely not
 * square. This type is what carries the difference.
 *
 * `mesh` is the trimming. Rather than crop the PIXELS into a new texture, the artwork's
 * alpha bounds are baked as a UV sub-rectangle into a quad mesh built for this artwork —
 * so the quad samples only the part of the image that has ink in it. Nothing is copied,
 * nothing is reallocated, and the built-ins pass null to get the plain 0..1 quad they
 * have always used. See StickerImport.normalise().
 *
 * `wFrac`/`hFrac` are the aspect, as fractions of the LONG side: the larger is always 1
 * and the smaller is the ratio. STICKER_SIDE_CM therefore means "the long side of the
 * artwork on the cloth", and a square sticker — every built-in — is 1,1 and behaves
 * exactly as it did before this pass.
 */
export interface StickerArt {
  tex: Texture
  /** Quad carrying the trimmed UV sub-rect, or null for the plain full-texture quad. */
  mesh: RenderMesh | null
  wFrac: number
  hFrac: number
  name: string
  /**
   * Pass 34: a built-in whose PNG carries a margin names its ink bounds here (UV, row 0
   * at the bottom); StickerSystem builds the trimmed quad from it on first use, so the
   * frame hugs the ink like an import's does.
   */
  trim?: { u0: number; v0: number; u1: number; v1: number }
}

/** The butterfly's ink inside its 512 x 427 PNG: x 13..498, y 2..413 from the top (measured). */
export const BUTTERFLY_TRIM = { u0: 13 / 512, v0: (427 - 414) / 427, u1: 499 / 512, v1: (427 - 2) / 427 }
/**
 * PASS 40 — THE SOLID HEART. The Pass-24 heart carried a pale highlight ellipse that read
 * as a hole; it is redrawn (GeneratedTextures/Heart.svg) as one flat fill with a hairline
 * outline and nothing inside it, through the butterfly's route: ConvertSvgToTexture at
 * 512, which leaves the converter's ~2.5% margin, so the ink is trimmed here. Measured on
 * the PNG: 512 x 461, ink x 13..499, y 13..460 (486 x 447, aspect 1.087); below the cleft
 * between the lobes — which closes 14% down the ink and is outside the outline — there is
 * not one pixel under alpha 128 inside the outline.
 */
export const HEART_TRIM = { u0: 13 / 512, v0: (461 - 460) / 461, u1: 499 / 512, v1: (461 - 13) / 461 }

/**
 * The three built-in flowers as StickerArt. Square and untrimmed-at-runtime, because
 * they were already trimmed to their alpha bounds offline in Pass 9 — which is exactly
 * what StickerImport.normalise() now does at runtime for everything else.
 */
export const BUILTIN_ART: StickerArt[] = [0, 1, 2, 3, 4, 5].map((i) => ({
  tex: STICKER_TEXTURES[i],
  mesh: null,
  wFrac: STICKER_ASPECT[i].w,
  hFrac: STICKER_ASPECT[i].h,
  name: STICKER_NAMES[i],
  trim: i === 1 ? BUTTERFLY_TRIM : i === 4 ? HEART_TRIM : undefined,
}))

/**
 * A rectangle in the shirt's [0,1] UV atlas: center (uc,vc) + half-width/half-height.
 * The shirt shares ONE atlas across front/back/both sleeves, so this rect is the
 * empirically-calibrated sub-region that lands on the FRONT CHEST (see StickerCompositor
 * calibration + the build report). A sticker composited here appears on the center torso.
 */
export interface UVRect {
  uc: number
  vc: number
  hw: number
  hh: number
}

// =============================================================================
// IMPORTED SHIRT CONFIG (Pass 6) — Assets/black_t-shirt (Sketchfab tee).
// EVERYTHING shirt-specific lives in this one block. Swapping to a different
// imported shirt = re-run the offline mesh detector and edit ONLY these consts
// (fit + island + footprint + UV map); no other file needs to change.
//
// All values below were AUTO-DETECTED at build time by parsing the shirt's
// `.mesh` (tshirt_tshirt_0.mesh): 1634 verts, stride-48, pos/normal/uv. Front
// panel = the largest UV island whose faces point toward the viewer (+Z, net
// prefab rotation is identity). See the Pass-6 build report for the raw numbers.
// -----------------------------------------------------------------------------

// --- Fit: size + recenter the imported prefab to match where the old shirt sat.
// The prefab root ships at 100x; at that scale the mesh is ~9 cm tall with its
// pivot ~15 cm below it. We scale it to SHIRT_TARGET_HEIGHT_CM and recenter its
// bbox onto the GarmentRoot origin so the UI (slider left, tray right) lines up.
export const SHIRT_PREFAB_DEFAULT_SCALE = 100 // prefab root's shipped uniform scale
export const SHIRT_NATIVE_HEIGHT_CM = 9.0 // mesh Y-span rendered at default scale (cm)
export const SHIRT_NATIVE_CENTER = { x: 0.0, y: 15.44, z: 0.495 } // bbox center at default scale, in GarmentRoot space
// Pass 25: 27 cm, down from 30, so the tee sits inside the turntable with air around it.
// Every cm-on-cloth number below scales by SHIRT_FIT_K with it, so a sticker keeps its
// size RELATIVE to the shirt and the drag lands on the same UV it always did.
export const SHIRT_TARGET_HEIGHT_CM = 27.0 // desired on-screen height
export const SHIRT_FIT_K = SHIRT_TARGET_HEIGHT_CM / 30.0 // 0.9: this pass's resize of the Pass-6 fit

// --- Pass 8: Y-ROTATION range driven by the platform slider. The track maps
// linearly from its left end to its right end onto [-180, +180] degrees, so the
// exact CENTRE of the track is 0 deg = front-facing (the Pass-7 boot pose), and
// either end shows the back of the shirt.
export const SHIRT_YAW_RANGE_DEG = 180

// --- Pass 8: how far the front panel may turn away before sticker interaction is
// suspended. This is the dot product between the panel's live world normal and the
// direction from the panel back to the camera: 1.0 = dead-on, 0.0 = edge-on.
// 0.30 ~= 72.5 deg off-axis — past that the panel is close to edge-on (a pixel of
// mouse travel maps to a huge UV step) or turning to the back, so we stop
// interacting rather than let a drag stamp somewhere the user cannot see.
//
// PASS 11: this is now applied PER PANEL. Every panel in ShirtPanels.PANELS has its
// own outward normal, so each is independently LIVE or not: the panel you are looking
// at accepts taps, drags, resizes and shows its frame, and the ones turned away go
// quiet. Turning the shirt round therefore hands interaction from the chest to the
// back rather than suspending it, and the threshold keeps its original job — stopping
// a gesture on a panel that has gone near edge-on, where one pixel of pointer travel
// maps to a huge step across the cloth.
export const PANEL_FACING_MIN = 0.30

// --- Pass 11: how much a sticker prefers to STAY on the panel it is already on.
// While dragging, the pointer is tested against every live panel; the one it is
// actually over wins, but the current panel gets this much of a head start (in CM on
// the cloth) so a sticker sitting near a seam does not flicker between two panels. A
// hop happens only when the pointer is clearly over the other panel AND the sticker's
// whole footprint fits there.
export const PANEL_HOP_HYSTERESIS_CM = 1.4
/**
 * PASS 39 — the hop rule's revert switch. true: a sticker leaves its panel only when the
 * pointer has left its rect AND is properly over another (instant hop, no proximity hops
 * across bake targets — see StickerSystem.dragToRay). false: the Pass-11 scoring, every
 * panel ranked by distance-outside with the current one given the hysteresis head start.
 */
export const HOP_RULE_PASS39: boolean = true

// --- Pass 27: which panel a fresh tap lands on ---------------------------------------
// "Whichever surface faces the camera": the panels whose facing is within this much of
// the best facing are the candidates, and among THEM the largest (pickWeight) wins. Size
// never outranks facing; it only settles near-ties. (Pass 26's facing-cubed weighting was
// the exponent this replaces.)
export const PANEL_PICK_FACING_TOL = 0.08

// --- Pass 26: duplicate ---------------------------------------------------------------
// The copy lands this far right and down of the original, in cm on the cloth, so it is
// visibly a second object; the panel clamp then pulls it back in if that leaves the rect.
export const DUP_OFFSET_CM = 1.6

// --- Detected FRONT-CHEST UV island: the +Z-facing torso panel (776 tris).
// Sleeves (114 tris each, x=±2.9) sit in disjoint UV regions, so clamping a
// sticker's FOOTPRINT to this bbox can never cross a seam onto a sleeve/back.
//
// SUPERSEDED IN PASS 11 by ShirtPanels.PANELS[PANEL_FRONT]. Kept because it records
// what Pass 6 detected and because the Pass-11 survey is best read against it: this
// is a BOUNDING BOX of a subset of the front island, and 11.2% of it is HOLE (the
// armpit notches and the neckline), which a sticker's footprint could reach and be
// clipped by. The panel table uses the largest rectangle INSCRIBED in the island
// instead — u [0.1221, 0.4697], v [0.3740, 0.8975] — which cannot contain a hole.
export const FRONT_PANEL_ISLAND = { uMin: 0.090, uMax: 0.503, vMin: 0.324, vMax: 0.966 }

// --- Sticker FOOTPRINT half-extent in UV, at scale 1.0. hw:hh ≈ dY/dV : dX/dU so
// the square flower PNG renders roughly square on the fabric (the panel is ~12.8
// cm/uv in U, ~13.8 cm/uv in V). ~2.4 cm in mesh space → ~8.1 x 8.1 cm on the
// scaled-up shirt. This is the BASE half-extent; the live footprint is this times
// the sticker's current scale (see STICKER_SCALE_* below).
export const STICKER_UV_HALF = { hw: 0.095, hh: 0.088 }

// --- Pass 11: a sticker's size is now PHYSICAL, not a UV rectangle.
// A sticker can live on the chest, the back or a sleeve, and those panels have
// slightly different cm-per-uv, so carrying a UV half-extent would quietly resize a
// sticker every time it hopped. The primary quantity is therefore its side ON THE
// CLOTH, and each panel turns that into its own UV rectangle.
//
// The value is exactly what Pass 10 stamped on the front at scale 1.0: a UV width of
// 2 x STICKER_UV_HALF.hw = 0.190, which on the front's true 45.53 cm/u is 8.65 cm. So
// the front sticker keeps precisely the width it had. Its HEIGHT grows about 5.6%,
// because Pass 10 measured the front's cm/u with a long chord projected onto world X
// and under-read it by 6%, which left the stamp slightly squashed; a square is now
// genuinely square on the fabric.
export const STICKER_SIDE_CM = 8.65 * SHIRT_FIT_K // 7.79 on the 27 cm tee (0.190 u x 40.98 cm/u)

// --- Pass 8: RESIZE limits. The resize handle multiplies STICKER_UV_HALF by a
// uniform scale in [MIN, MAX], anchored on the sticker centre. World sizes below
// use the front panel's measured 42.6 cm/uv in U and 46.1 cm/uv in V (= dXdU/dYdV
// x innerScale x the shirt's fit scale of 333.3):
//   MIN 0.45 -> hw 0.0428, hh 0.0396 UV  ->  3.6 x 3.7 cm on the shirt
//   1.00     -> hw 0.0950, hh 0.0880 UV  ->  8.1 x 8.1 cm  (the Pass-7 size)
//   MAX 1.90 -> hw 0.1805, hh 0.1672 UV  -> 15.4 x 15.4 cm
// MAX is also capped at runtime by the front-panel island itself (the island is
// 0.413 wide in u, so a footprint wider than that could never fit): 1.90 leaves
// ~0.05 UV of headroom in u, so the largest sticker still lives fully inside the
// panel and the seam clamp never has to fight the size clamp.
export const STICKER_SCALE_MIN = 0.45
export const STICKER_SCALE_MAX = 1.90
export const STICKER_SCALE_INIT = 1.0

// --- Pass 9: sticker ROTATION on the fabric.
// The angle is stored in degrees CCW as the user sees it on the shirt front, 0 =
// upright. A rotated square's axis-aligned footprint grows by (|cos t| + |sin t|),
// peaking at sqrt(2) = 1.414 at 45 deg, so the seam clamp is widened by that factor
// (see StickerSystem.footprintGrowth) and the effective scale is capped so even a
// turned sticker stays inside the front-panel island. Because the requested scale is
// kept separate from that cap, turning back to 0 deg restores the full size.
export const STICKER_ROT_INIT_DEG = 0

// Soft snap: while dragging the rotate handle, any angle within TOL of a multiple of
// STEP is pulled onto it, so upright / 45 / 90 are easy to land on exactly.
export const STICKER_SNAP_STEP_DEG = 15
export const STICKER_SNAP_TOL_DEG = 4

// --- UV <-> mesh-local linear map (the front panel is ~planar, facing +Z).
// x = (u-uc)*dXdU ; y = y0 + (v-vc)*dYdV ; front surface at mesh z = frontZ.
// corr(v,Y)=0.999, corr(u,X)=-0.997 → clean affine fit. Used both ways:
// UV->world to place the hit target / selection box, world->UV for drag picking.
export const UV_MAP = {
  uc: 0.296, dXdU: -12.77, // u center 0.296 ↔ X 0
  vc: 0.645, y0: 15.40, dYdV: 13.84, // v center 0.645 ↔ Y 15.40
  frontZ: 1.42, // mesh-local Z of the front surface
  innerScale: 0.01, // mesh-space -> prefab-root(GarmentVisual)-local
}

// --- Initial stamp: centered horizontally on the island, on the UPPER chest
// (high v = up). Whole flower stays inside the island (no crop, no neckline).
export const INITIAL_STICKER_UV = { u: 0.296, v: 0.70 }

// --- Pass 10: WHERE A NEWLY PLACED STICKER LANDS.
// Every tray tap ADDS a sticker; nothing is replaced. Two placements were on the
// table — "centre of the largest free area" and "cascade from the home spot" — and
// this is the cascade. Free-area search sounds tidier but it is not: with three or
// four flowers on a small chest panel the largest gap moves unpredictably from tap
// to tap, so the same gesture puts the new sticker somewhere different every time
// and the user has to hunt for what they just added. The cascade is dead
// predictable — each new sticker appears one step DOWN and to the viewer's RIGHT of
// the last home position, so a run of taps lays out a legible diagonal staircase
// where the newest is always the bottom-right-most AND (by stacking order) on top.
// The step is a bit over half a footprint at scale 1.0, so consecutive stickers
// overlap enough to make the stacking order visible but never hide each other.
// After WRAP steps the cascade returns to the home spot so a long run stays on the
// chest; the seam clamp catches anything the wrap misses.
// PASS 11: the step is expressed in CENTIMETRES ON THE CLOTH rather than in UV, and
// each panel converts it through its own cm-per-uv and atlas rotation. Two reasons:
// the cascade then looks the same on the chest, the back and a sleeve, and it stays
// correct on the sleeves, whose unwraps are turned 30-152 degrees in the atlas so a
// fixed (du, dv) would cascade diagonally in some random direction. The values are
// Pass 10's front steps converted through the front's cm-per-uv, so the front's
// cascade is unchanged. The count that drives it is PER PANEL, so stickers on the
// back cascade among themselves instead of against the ones on the chest.
export const STICKER_CASCADE_RIGHT_CM = 2.05 * SHIRT_FIT_K
export const STICKER_CASCADE_DOWN_CM = 2.50 * SHIRT_FIT_K
export const STICKER_CASCADE_WRAP = 6

// Back-compat rect used by the compositor for the very first bake; the live
// UV is tracked in StickerSystem and re-stamped on place/drag.
export const FRONT_CHEST_UV: UVRect = {
  uc: INITIAL_STICKER_UV.u, vc: INITIAL_STICKER_UV.v,
  hw: STICKER_UV_HALF.hw, hh: STICKER_UV_HALF.hh,
}

// --- Pass 17: the paint capture plane -----------------------------------------
// The collider that receives paint gestures, sized to cover THE GARMENT AND NOTHING
// ELSE. It stands in front of the shirt (which sits at z -110), so while paint is the
// active tool the interactor's ray meets it before any sticker hit target — that is what
// separates the two input modes, rather than a flag checked in every handler.
//
// The extents are chosen against the composition's own furniture: the colour slider
// panel spans x -23.75..-18.25, the sticker tray x +15.5..+26.5, the rotation platform
// sits at y -18.9 and the round buttons below both panels. A half-extent of 17 clears
// all of them while covering the shirt, which is ~13 cm to a sleeve tip at its widest
// and 15 cm tall.
// Pass 18 moved this forward from z -100. The cap's brim reaches z -90 and its crown's
// sticker hit slots sit at about z -101, so a plane at -100 was 0.7 cm behind the very
// targets it exists to shadow — paint mode would have let a sticker grab fire mid-stroke
// on the cap while working correctly on the shirt. At -88 it is in front of every garment
// in the project, and still behind nothing: every control sits at z -110 and outside the
// plane's 34 x 34 footprint.
export const PAINT_PLANE_POS = new vec3(0, 0, -88)
export const PAINT_PLANE_SIZE = new vec3(34, 34, 3)
// PASS 25 — THE PLANE FITS THE GARMENT, AND THE CONTROLS ARE OUT OF ITS SHADOW.
// The reasoning above was wrong in one respect: the plane is in FRONT of the controls, so
// what matters is not its 34 x 34 footprint but its SHADOW from the eye. A point on the
// plane at z -88 covers x * 110 / 88 at the controls' depth, so the plane shadowed
// everything within +/-21.25 cm — the rotation knob, half of every palette chip, the
// tray's inner half, the buttons. That is the "palette works half the time, rotation
// never" bug. StickerSystem.fitPaintPlane now sizes the plane to the live garment's own
// bounding box (plus PAINT_PLANE_PAD, at PAINT_PLANE_LIFT in front of it, wide enough
// for any yaw) and CLAMPS it so its shadow at the controls' depth never crosses
// PAINT_SHADOW_LIMIT — the innermost edge of any control's hit box on each axis
// (tray 16.9, colour panel 17.5, rotation knob top 15.9, garment row bottom 17.4).
export const PAINT_PLANE_PAD = 1.2 // cm of plane past the garment's box on each side
export const PAINT_PLANE_LIFT = 2.0 // cm in front of the garment's nearest point
// Pass 33: derived from the column position — the panel's inner edge minus the same 1.3 cm
// margin the 16.2 of Pass 25 left (21 - 3.5 - 1.3). Re-audited with the columns at 22.6.
export const PAINT_SHADOW_MARGIN = 1.3
export const PAINT_SHADOW_LIMIT = new vec2(UI_COL_X - UI_PANEL_HALF_W - PAINT_SHADOW_MARGIN, 15.4) // half-extents at UI depth the shadow may not cross (y: the BOTTOM edge)
// PASS 45 — THE TOP EDGE IS ITS OWN LIMIT. Until now one number bounded the shadow above
// and below (15.4, set by the rotation knob's top at the bottom and the garment row's
// boxes at the top). The tool switch and the garment row have left the top centre for the
// column tops (UiTheme's top boxes, whose grab boxes stay outside +/-x 17.8 anyway), and
// the garments rise 2 cm (Garments.GARMENT_RAISE), so the top edge is re-derived from
// what is actually left above the garment: the paint erase chip, which hangs beside the
// tool box at the top left — its grab box's bottom edge is 20.65 - 2.1 = 18.55 at the UI
// depth — minus the same 1.3 cm margin. The sock selector (visible on the socks only) has
// its boxes' bottom at 12.1, and the socks' plane tops out at 6.9, well under it.
export const PAINT_SHADOW_TOP = pick(15.4, 17.2)
export const PAINT_UI_DEPTH = 110 // the controls' depth from the eye, cm

// --- Pass 17: the palette ------------------------------------------------------
// TEN CHIPS, and the reason for each.
//
// The shirt is never dark in the way a photograph is dark: the colour slider produces
// full-VALUE hues (see ColorUtils.trackColor, which pins v = 1.0) plus a white zone, so
// the garment is always either white or a vivid saturated hue. Paint therefore has to
// read against white AND against saturated red / green / blue.
//
// The eight chromatic chips are mid-luminance and high-saturation: dark enough to hold
// against white cotton, saturated enough not to disappear into a hue of their own family.
// They are spaced roughly evenly round the wheel so any two adjacent chips are
// distinguishable at chip size.
//
// Black and white are the two achromatic ends, and they are here because each is the
// answer to the other's failure: white is the only paint that reads on a saturated blue
// or violet shirt, black the only one that reads on a pale yellow or a white one. A
// palette of chromatic chips alone would leave one of those two cases with nothing.
// Pass 32: NO BLACK. On the additive display black emits nothing: a black stroke on a
// white shirt in Preview is a window onto the street behind the garment, not a black mark
// (verified, Pass 32). The chip was kept in Pass 17 for pale garments; it never served them.
export const PAINT_PALETTE: vec4[] = [
  new vec4(0.98, 0.98, 1.00, 1), // near-white — reads on every saturated hue
  new vec4(0.90, 0.22, 0.27, 1), // red
  new vec4(0.96, 0.55, 0.15, 1), // orange
  new vec4(0.95, 0.82, 0.20, 1), // yellow
  new vec4(0.30, 0.72, 0.35, 1), // green
  new vec4(0.15, 0.70, 0.72, 1), // teal
  new vec4(0.20, 0.45, 0.90, 1), // blue
  new vec4(0.55, 0.35, 0.85, 1), // violet
  new vec4(0.90, 0.35, 0.65, 1), // pink
]
/** Which chip is selected at boot. Index 1 (red) — visible on the boot-white shirt. */
export const PAINT_PALETTE_INIT = 1

// --- Calibration harness ------------------------------------------------------
// When CALIBRATION_PROBES is non-empty, StickerSystem bakes ALL these probes onto
// the shirt at once (instead of normal one-tap placement) so a single preview capture
// reveals which UV lands on the front chest. Set to [] to disable (normal runtime).
export interface CalibrationProbe {
  tex: number // index into STICKER_TEXTURES (distinct flower = distinct marker)
  uc: number
  vc: number
}
export const CAL_PROBE_HALF = 0.11 // half-size of each calibration probe in UV (matches FRONT_CHEST_UV footprint)
// Empirically-mapped front-chest UV island (Pass 4): u ∈ [0.51, 0.65] (seam at u≈0.50 on
// the left, side at u≈0.66 on the right), v ∈ [0.62, 0.86]. FRONT_CHEST_UV sits centred at
// u=0.58 with margin on all sides. Set to [] for normal runtime (calibration disabled).
export const CALIBRATION_PROBES: CalibrationProbe[] = []

// --- Debug state driver (verification only; SHIP AS 0) -------------------------
// This project's MCP server does not expose PreviewInteractTool, so the tap-driven
// states are verified by forcing them through the SAME code paths the taps invoke.
//   0 = normal (live interactions)
//   1 = placed (stamp on chest, no selection box)
//   2 = placed + selected (stamp + selection box + delete button)
//   3 = placed then deleted (clean shirt, box hidden)
export const DEBUG_FORCE_STATE: number = 0

// Optional: after force-placing+selecting (state 2), programmatically DRAG the
// sticker to this UV through the SAME clamp+restamp path a real pinch-drag uses,
// so drag positions can be captured deterministically. null = no debug drag.
export const DEBUG_DRAG_UV: { u: number; v: number } | null = null

// Which flower the debug driver places (0=Daisy, 1=CherryBlossom, 2=Sunflower).
export const DEBUG_PLACE_INDEX: number = 0

// --- Pass 8 debug drivers (verification only; SHIP AS null / false) -----------
// SIK Interactables in this project's preview only receive hover/trigger from a REAL
// mouse in the panel — injected touch events move the interactor's cursor but never
// raise its trigger, so drags cannot be simulated from outside (this is true of the
// Pass-7 interactables too, not just the new ones). As in Pass 7, each new state is
// therefore driven through the SAME functions the gestures call, so a capture shows
// the real result.

// Force the platform slider (and therefore the shirt's Y rotation) to this angle at
// boot, through RotationPlatform.setYawDeg -> the same onYaw path a drag emits, so the
// BUTTON moves along its track too. null = normal (centred, 0 deg, front-facing).
export const DEBUG_YAW_DEG: number | null = null

// Force the placed sticker's rotation (degrees) through the same path the rotate
// handle drives. null = normal (STICKER_ROT_INIT_DEG).
export const DEBUG_STICKER_ROT: number | null = null

// Force the placed sticker's uniform scale through the same StickerSystem.setStickerScale
// the resize handle drives (clamping, re-stamping and frame re-layout all included).
// null = normal (STICKER_SCALE_INIT).
export const DEBUG_STICKER_SCALE: number | null = null

// Round-trip the rotation-aware world->UV projection at a sweep of shirt angles and
// print the error (see StickerSystem.probeProjection). false = normal.
export const DEBUG_PROJECTION_PROBE: boolean = false
export const DEBUG_PROBE_YAWS: number[] = [0, 30, 60, 85, 120]

// --- Pass 10 debug drivers (verification only; SHIP AS [] / null / false) ------
// Same rule as every pass before: the preview's SIK Interactables only fire from a
// real mouse in the panel, so multi-sticker states are driven through the SAME
// public methods the taps call (placeSticker / selectSticker / deleteSelected /
// moveStickerToUV / setStickerScale / setStickerRotation), and a capture then shows
// the real result of the real code path.

/**
 * A scripted stack of stickers to place at boot, in order (so the last one ends up
 * on top). `tex` indexes STICKER_TEXTURES; `u`/`v` are absolute UV (null = let the
 * cascade decide); `scale` and `rot` go through the resize / rotate paths.
 */
export interface DebugPlacement {
  tex: number
  panel?: number // Pass 11: which panel to put it on (default: whichever faces the camera)
  u?: number
  v?: number
  scale?: number
  rot?: number
}
export const DEBUG_MULTI: DebugPlacement[] = []

// After DEBUG_MULTI has been placed: which sticker to leave SELECTED (-1 = none,
// default is "the last one placed", which is what a real tap sequence leaves).
export const DEBUG_SELECT_INDEX: number | null = null

// After DEBUG_MULTI has been placed and DEBUG_SELECT_INDEX applied: delete the
// sticker at this index through the same path the x chip drives. null = no delete.
export const DEBUG_DELETE_INDEX: number | null = null

// Simulate a TAP at this UV through the same topmost-wins pick the ray uses, then
// select whatever it hits. Used to verify overlap picking. null = no simulated tap.
export const DEBUG_TAP_UV: { u: number; v: number } | null = null

// Print the frame-vs-stamp agreement for the selected sticker (Pass-10 point 2
// acceptance): the stamped UV corners, the frame corners built from them, and the
// residual between them. false = normal.
export const DEBUG_FRAME_FIT: boolean = false

// --- Pass 11 debug drivers (verification only; SHIP AS null / false) -----------

/**
 * Print the live panel survey at boot: every panel's facing, whether it is live, and
 * which one a tap would place on right now.
 */
export const DEBUG_PANEL_SURVEY: boolean = false

/**
 * Pass 22 verification only: hold the placement-refusal hint on screen indefinitely
 * instead of fading it, so a capture can be taken of it. Ships false.
 */
export const DEBUG_HINT_STICKY: boolean = false

/**
 * Walk the SELECTED sticker along a path, one step per entry, through the REAL drag
 * code (a synthetic ray aimed at the target from the camera, pushed into the same
 * ray -> panel -> uv -> hop -> clamp path a pinch-drag uses). Each step first turns the
 * shirt to `yaw`, exactly as the platform slider would, so the target panel is facing
 * the camera when the drag reaches it. `atPanel`/`u`/`v` name the point being aimed at.
 * Used to verify a sticker travelling from the chest round to the back.
 */
export interface DebugDragStep {
  yaw: number
  atPanel: number
  u: number
  v: number
}
export const DEBUG_DRAG_PATH: DebugDragStep[] = []

/** Which step of DEBUG_DRAG_PATH to leave the shirt on for the capture (-1 = the last). */
export const DEBUG_DRAG_STOP_AT: number = -1

// --- Pass 12 debug driver (verification only; SHIP AS []) ---------------------
/**
 * A frame-stamped timeline for verifying the PHOTO flow, driven through exactly the
 * public entry points a real tap calls: `PhotoBooth.requestCapture()` is what the
 * shutter's Interactable calls, `PhotoBooth.dismiss()` is what the close chip calls,
 * `RotationPlatform.setYawDeg()` is what a drag on the platform button emits, and
 * `ScarfCustomizer.applyColor()` is what the colour slider emits. So a capture taken
 * while this runs shows the real result of the real code path, not a shortcut.
 *
 * Frames rather than seconds because the capture itself is frame-counted
 * (CAPTURE_WARMUP_FRAMES): the exposure needs the capture camera to have actually
 * rendered, so "shoot at frame 20, recolour at frame 30" is the only way to say
 * "recolour AFTER the shutter" without guessing at a wall-clock delay.
 */
export interface DebugPhotoStep {
  atFrame: number
  yaw?: number // dial the platform to this angle (as a drag on its button would)
  color?: number // drive the colour slider to this value 0..1
  shoot?: boolean // press the shutter
  dismiss?: boolean // press the close chip
  // Pass 13 — the gallery, driven through the same public entry points its own chips
  // call: PhotoBooth.openGallery() is the gallery button, galleryStep() is an arrow,
  // galleryDelete() is the trash chip, closeGallery() is the gallery's close chip.
  placeSticker?: number // stamp tray flower n on the live panel (as a tray tap would)
  openGallery?: boolean
  galleryStep?: number // page by n cards (-1 newer, +1 older), one arrow press per unit
  galleryDelete?: boolean
  /**
   * PASS 36 — THE GUARD ON THE ONE DESTRUCTIVE HARNESS STEP, and it exists because the
   * lack of it destroyed three of the user's photographs.
   *
   * `galleryDelete` used to mean "delete whatever card is centred". That is safe exactly
   * once. Saving a script file makes the editor's file watcher recompile and RESTART the
   * Lens, which runs DEBUG_PHOTO_SCRIPT again from the top — so every script runs at
   * least twice, and the second run's "whatever is centred" is a DIFFERENT photograph,
   * because the first run deleted the one that used to be there.
   *
   * So the step now has to name its target. `deleteExpectPath` is matched against the
   * centred record's storage_path and the delete is REFUSED unless they are equal. A
   * repeat run therefore deletes nothing instead of eating the next photograph along.
   */
  deleteExpectPath?: string
  closeGallery?: boolean
  // Pass 16 — the import panel, through the same entry points its own chips call.
  openImport?: boolean
  /** Tap the n-th tile of the current page (0-based), placing that artwork. */
  pickImport?: number
  closeImport?: boolean
  /** Drive the selected sticker's scale / rotation through the real handle paths. */
  stickerScale?: number
  stickerRot?: number
  /** Drag the selected sticker onto this panel/uv through the real surface-drag path. */
  dragTo?: { panel: number; u: number; v: number }
  // Pass 17 — paint, through the same entry points the pills, chips and brush drive.
  tool?: string // "paint" or "colour"
  paintChip?: number
  paintStroke?: { panel: number; u0: number; v0: number; u1: number; v1: number; samples: number }
  // Pass 18: press a garment button, by index into GARMENTS. Goes through the SAME
  // callback a real press fires, so a capture shows the real swap and the real selected
  // state rather than a shortcut that only moves the model.
  garment?: number
  tapErase?: boolean
  /** Pass 25: print the hit-target audit (every Interactable's box, paint-plane shadowing, overlaps). */
  audit?: boolean
  /** Pass 35: names the audit in the log, so one run can audit every mode and overlay in turn. */
  auditTag?: string
  /**
   * Pass 36: print every row currently in custom_photos (id, storage_path, created_at).
   * This is the ground truth a delete has to be checked against — the gallery's own view
   * is exactly the thing under test, so proving a row is gone means asking the table.
   */
  cloudList?: boolean
  /**
   * Pass 36: delete ONLY the object of the newest cloud-backed photograph, leaving its
   * row. That reproduces the state the Pass 14 spike left behind — a row pointing at an
   * object that is not there, the "image unavailable" card — so the claim that those can
   * now be deleted can be PROVED without touching any of the user's existing rows.
   */
  makeOrphan?: boolean
  /**
   * Pass 35: MEASURE the four icon-and-word buttons (Photo, Gallery, Import, Text) as they
   * are actually rendered — plate box, glyph ink box, glyph-to-word gap, word cap height,
   * left pad, right pad and where the group sits inside the plate. Two-phase: this step
   * builds a cap-height probe, and the numbers print three frames later.
   */
  measureButtons?: boolean
  /** Pass 26: print the panel survey (facing, liveness, measured atlas frame) for the current garment. */
  survey?: boolean
  /** Pass 26: press the duplicate handle. */
  duplicate?: boolean
  /** Pass 27: dump every render mesh under the colour slider (enabled, material, texture). */
  sliderDump?: boolean
  /** Pass 27: drive the slider's knob to this value, as a drag would, and apply the colour. */
  sliderValue?: number
  /**
   * Pass 27: the synthetic drag SWEEP. Drags the selected sticker in `steps` equal steps
   * from (u0,v0) to (u1,v1) on the named panel through the real drag path and prints the
   * table: free / dead / jump steps, gain range, free-tracking share.
   */
  sweep?: { panel: string; u0: number; v0: number; u1: number; v1: number; steps: number;
    /** Pass 39: name a SECOND panel for the end point, so a path can run from one region onto another (the sock's shin onto its instep). */
    panel1?: string }
  // Pass 28 — text, through the same entry points the Add text button and the editor call.
  addText?: boolean
  textSet?: string
  // Pass 29 — gems, through the same entry points the panel and the plane call.
  gemShape?: number
  gemColor?: number
  gemSize?: number
  /** A tap: one stone at this panel uv. */
  gemTap?: { panel: number; u: number; v: number }
  /** A press-and-drag: a trail from (u0,v0) to (u1,v1) in `steps` pointer samples. */
  gemTrail?: { panel: number; u0: number; v0: number; u1: number; v1: number; steps: number }
  gemUndo?: boolean
  gemClear?: boolean
  /** Pass 30: the brush size slider, in radius cm. */
  brushSize?: number
  /** Pass 31: the world-colour picker — open for "garment", "brush" or (Pass 41) "gems"; confirm, cancel, re-select the picked brush chip. */
  pickOpen?: string
  /** Pass 41: a tap on the gem panel's dropper chip, through the same call its grab box makes. */
  gemPickTap?: boolean
  pickConfirm?: boolean
  pickCancel?: boolean
  pickTap?: boolean
  /** Pass 31: this step's atFrame counts from the frame the picker closed (a real press decides when). */
  afterPick?: boolean
  /** Pass 39: press the Left (0) / Right (1) sock selector, through the same call a press makes. */
  sockSide?: number
  /** Pass 33: tap the text editor's entry line (the keyboard experiment). */
  editorTapEntry?: boolean
  /** Pass 33: a tap on the paint plane at a panel uv, to prove the text hand-off under Paint/Gems. */
  tapUnderTool?: { panel: number; u: number; v: number }
  textFont?: number
  textColor?: number
  deselect?: boolean
  /**
   * Pass 43: encode the viewport camera's render target (environment + Lens, exactly as
   * the Preview composites it) and print it to the log as base64 under this tag, so the
   * rendered pixel values of the interface can be READ rather than eyeballed.
   */
  dumpView?: string
  /** Pass 43: place known colour/alpha test patches at the UI depth (see ScarfCustomizer.addTestPatches). */
  testPatches?: boolean
  /** Pass 43: from this step on, print "[FPS] frame N t=seconds" every N frames (0 stops). */
  fpsEvery?: number
  /** Pass 44: cast the pointer's ray at sticker #rayProbeIndex (default: the selected one) and print what it finds. */
  rayProbe?: string
  rayProbeIndex?: number
  /** Pass 44: drag the selected sticker hard into an edge/corner of a panel (dirX, dirY in -1/0/1). */
  dragToEdge?: { panel: number; dirX: number; dirY: number }
  /** Pass 44: select sticker #n through the same call a tap makes (the tap itself cannot be injected from outside). */
  selectIndex?: number
  /** Pass 47: print the drawn frame's drift from the stamped rectangle (StickerSystem.debugFrameProbe). */
  frameProbe?: string
}
/** Pass 44: the eight edge/corner positions of a panel, hardest-first for the scan. */
const EDGE_DIRS: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
/** Pass 44: build the edge scan for one garment: place, shrink, then every edge of every listed panel. */
function edgeScan(garment: number, panels: number[], scale: number, from: number, step: number): DebugPhotoStep[] {
  const out: DebugPhotoStep[] = []
  let f = from
  out.push({ atFrame: f, garment: garment }); f += step
  out.push({ atFrame: f, placeSticker: 0 }); f += step
  out.push({ atFrame: f, stickerScale: scale }); f += step
  for (const p of panels) {
    out.push({ atFrame: f, dragTo: { panel: p, u: -1, v: -1 } }); f += step
    for (const d of EDGE_DIRS) {
      out.push({ atFrame: f, dragToEdge: { panel: p, dirX: d[0], dirY: d[1] } }); f += step / 2
      out.push({ atFrame: f, rayProbe: "p" + p + "(" + d[0] + "," + d[1] + ")" }); f += step / 2
    }
  }
  out.push({ atFrame: f, deselect: true }); f += step
  out.push({ atFrame: f, rayProbe: "deselected" })
  return out
}
/** Pass 45: one garment through the three tools, an audit in each, then a hold for the capture. */
function toolSweep(garment: number, from: number, hold: number): DebugPhotoStep[] {
  const g = "g" + garment
  return [
    { atFrame: from, garment: garment },
    { atFrame: from + 20, tool: "colour" },
    { atFrame: from + 40, audit: true, auditTag: g + "-colour" },
    { atFrame: from + 60, tool: "paint" },
    { atFrame: from + 80, audit: true, auditTag: g + "-paint" },
    { atFrame: from + 100, tool: "gems" },
    { atFrame: from + 120, audit: true, auditTag: g + "-gems" },
    { atFrame: from + 140, tool: "colour" },
    { atFrame: from + 150, audit: true, auditTag: g + "-hold" },
    { atFrame: from + 150 + hold, deselect: true },
  ]
}
/** Pass 47: turn the platform through the five angles, probing the frame at each and holding for a capture. */
function yawSweep(tag: string, from: number, hold: number): DebugPhotoStep[] {
  const out: DebugPhotoStep[] = []
  let f = from
  for (const y of [0, 30, 60, 120, 180]) {
    out.push({ atFrame: f, yaw: y }); f += 40
    out.push({ atFrame: f, frameProbe: tag + "-y" + y }); f += hold
  }
  out.push({ atFrame: f, yaw: 0 })
  return out
}
export const DEBUG_PHOTO_SCRIPT: DebugPhotoStep[] = []

/**
 * Pass 44, verification only (SHIP AS false): the Lens behaves as if SupabaseConfig held
 * no credentials — SupabaseClient.available() is false — so the credential-less state
 * ("Stickers off", "Cloud save off") can be captured without touching the config file.
 */
export const DEBUG_NO_CREDS: boolean = false

/**
 * Print every Supabase request's HTTP status and response body (Pass 15). A verification
 * aid, not telemetry: it is how a capture proves a file landed in the bucket and a row
 * landed in the table rather than assuming it. Inert in shipped code.
 */
export const DEBUG_SUPABASE_LOG: boolean = false

/**
 * Pass 36, verification only (SHIP AS false): send the row DELETE with a corrupted key so
 * the server really refuses it, and the "card stays, user is told" path can be seen
 * rather than assumed. See SupabaseClient.DEBUG_DELETE_BAD_KEY.
 */
export const DEBUG_DELETE_BAD_KEY: boolean = false

/**
 * Pass 28 verification only (SHIP AS false): a shutter press keeps the photograph in the
 * session and does NOT upload it, so a harness capture leaves nothing in the bucket.
 */
export const DEBUG_PHOTO_NO_UPLOAD: boolean = false
/**
 * Pass 30, verification only: the gallery behaves as if the store held no photos, so the
 * empty state can be captured while the cloud has photos in it. Ships false.
 */
export const DEBUG_GALLERY_EMPTY: boolean = false
/** Pass 31, verification only: run the camera-frame probe (WorldColor.CameraProbe). Ships false. */
export const DEBUG_CAMERA_PROBE: boolean = false

