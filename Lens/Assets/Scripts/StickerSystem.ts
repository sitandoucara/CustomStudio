// StickerSystem — many stickers, anywhere on the GARMENT: place / select / delete /
// deselect + free surface drag + resize + rotate (Pass 11).
//
// Owns:
//   - a StickerCompositor that bakes the placed STACK onto the shirt (via
//     ScarfController.setBaseTexture — the stamps follow the fabric UVs),
//   - one co-located transparent INTERACTABLE quad per placed sticker (the stamps are
//     baked into the texture and can't receive taps, so these are the hit targets),
//   - a single SELECTION FRAME (hairline stroke + corner dots + a discreet x + a
//     resize handle + a rotate handle) that moves to whichever sticker is selected,
//   - a full-view background interactable for tap-away DESELECT,
//   - a UV PROBE (a child of the shirt visual) that converts between the shirt's mesh
//     space and world space using the shirt's LIVE transform.
//
// Taps are kept strictly separate (per spec):
//   - tapping a TRAY THUMBNAIL   → placeSticker(i): ADDS a flower on the panel that is
//                                  facing the camera, and selects it,
//   - tapping a PLACED STICKER   → selects it (and deselects the previous one),
//   - tapping the x              → removes the SELECTED sticker + hides the frame,
//   - tapping EMPTY space        → deselect: hides the frame, keeps every sticker.
//
// ===========================================================================
// PASS 11 — THE WHOLE GARMENT
// ===========================================================================
// Everything up to Pass 10 assumed one printable surface, the front chest. The shirt
// actually unwraps into 16 UV islands, of which six are big enough to print on: two
// torsos and four sleeve halves. ShirtPanels.ts holds the survey and the per-panel
// data; this file is what those six panels changed here.
//
// A. A STICKER BELONGS TO A PANEL. `PlacedSticker.panel` indexes the garment's panel table.
//    Its size is carried in CENTIMETRES (this.def.stickerSideCm x scale) rather than as a UV
//    rectangle, so it keeps its size on the cloth when it moves between panels whose
//    atlases have different cm-per-uv. Every UV quantity — the stamp, the seam clamp,
//    the frame — is derived from that one physical size through the panel's own metrics
//    by computeStampFor(), so the three cannot disagree.
//
// B. THE SEAM DECISION — option (b), "clamp to the current panel, hop when the whole
//    footprint fits". Chosen, and here is the reasoning, because the brief asked.
//
//    The islands are disjoint in UV (verified: no two of the sixteen overlap anywhere in
//    the atlas), so a sticker straddling a 3D seam would be sliced in the bake — half of
//    it drawn on the torso, the other half missing because the sleeve's half of the
//    rectangle lands in whatever unrelated part of the atlas happens to sit next door.
//    Option (a) accepts that; the brief rules it out, and rightly.
//
//    So the sticker is clamped inside its current panel's rect, and HOPS to a
//    neighbouring panel the moment the pointer is genuinely over that panel AND the
//    sticker's whole footprint fits there. The drag itself is a real surface drag: the
//    interactor's ray is intersected with every LIVE panel, converted to that panel's uv
//    through its own sampled mesh, and the panel the pointer is actually over wins (with
//    PANEL_HOP_HYSTERESIS_CM of stickiness so a sticker resting on a seam does not
//    flicker). It reads as the sticker sliding across the garment and catching briefly
//    at each seam before stepping over it — never sliced, never somewhere the pointer
//    was not.
//
//    What I did NOT do, and what would supersede this: stamp the sticker PER TRIANGLE.
//    Project each mesh triangle under the sticker into the sticker's own tangent plane
//    to get texture coordinates, then draw those triangles into their own UV positions
//    in the atlas. That paints THROUGH the mesh rather than into one island's rectangle,
//    so a sticker crossing a seam stays continuous in 3D because each side is drawn
//    where its own island lives. It is the real answer, and it is a build of its own — a
//    per-frame dynamic MeshBuilder over the triangles in range, edge clamping so the
//    artwork does not smear outside its quad, and a selection frame that follows a curved
//    path across two islands. Option (b) is exact and small; that is a pass in itself.
//
// C. PLACEMENT FOLLOWS ORIENTATION. activePanel() scores every panel by how squarely its
//    live world normal faces the camera, weighted by Panel.pickWeight (torsos 1.0,
//    sleeves 0.55, so a sleeve only wins when it is plainly the thing you are looking at
//    and neither torso is). A tap on a thumbnail lands on the winner, at that panel's
//    home UV, cascaded by how many stickers that panel already carries.
//
// D. THE FACING GUARD IS PER PANEL. Pass 10 had one global switch: past
//    PANEL_FACING_MIN the front panel was near edge-on and ALL sticker interaction was
//    suspended. Now each panel is independently live — its world normal's z against the
//    same threshold — and a sticker's hit target, and its frame when selected, follow the
//    liveness of ITS panel. Turning the shirt therefore hands interaction from the chest
//    to the back instead of switching it off, while still refusing to drag on a panel
//    that has gone edge-on. The two torsos have opposite normals so at most one is ever
//    live; around 90 degrees neither is, and the sleeves are.
//
// Kept from earlier passes, unchanged in behaviour: the live-matrix projection (the
// pointer's ray meets the panel where it actually is, so the platform's yaw, the fit
// scale and the idle bob are all folded in), the single selection frame built from the
// compositor's own stamp, the segmented frame edges that follow the cloth's curvature,
// the depth-staggered hit targets that make the topmost sticker win a tap, the 15-degree
// rotation snap, and the full re-stamp on every change so a delete really deletes.
//
// All hit targets are raw SIK Interactables on world-space colliders (sanctioned 3D
// scene content — Hard Rule 3 carve-out). SIK's MouseInteractor drives them with the
// MOUSE in the Editor preview. Event subscriptions bind when a slot is created, which is
// in / after OnStart.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { DragInteractorEvent } from "SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent"
import { ScarfController } from "./ScarfController"
import { uiFlatPass } from "./PhotoUi" // Pass 43
import { StickerCompositor, Stamp, computeStampFor, buildUnitQuad, StickerPlacement, buildUnitQuadUV } from "./StickerCompositor"
import { buildDisc, buildRibbon, buildRing, buildTriangle } from "./Geo"
import { Panel, panelUvToMesh } from "./ShirtPanels"
import { GarmentDef } from "./Garments"
import { LAYERS, setLayerDeep } from "./Layers"
import { PaintLayer } from "./PaintLayer"
import { PlacementHint } from "./PlacementHint"
import { GLASS, pick } from "./UiTheme"
import { TextBaker, TextStyle, TEXT_DEFAULT, TEXT_FONT_INIT, TEXT_COLOR_INIT } from "./TextArt"
import {
  GemSystem, GemShape, GEM_SHAPES, GEM_SHAPE_MIX, GEM_COLORS, GEM_COLOR_MIX, GEM_SIZE_INIT, GEM_COLOR_CUSTOM_BASE, isGemColorKey,
  GEM_SIZE_JITTER, GEM_TRAIL_SPACING_K, GEM_LIMIT_WORD, GEM_LIFT_CM,
} from "./GemSystem"
import {
  STICKER_TEXTURES,
  StickerArt,
  BUILTIN_ART,
  PAINT_PLANE_POS,
  PAINT_PLANE_SIZE,
  PAINT_PLANE_PAD,
  PAINT_PLANE_LIFT,
  PAINT_SHADOW_LIMIT,
  PAINT_SHADOW_TOP, // Pass 45
  PAINT_UI_DEPTH,
  CALIBRATION_PROBES,
  CAL_PROBE_HALF,
  DEBUG_FORCE_STATE,
  DEBUG_DRAG_UV,
  DEBUG_PLACE_INDEX,
  DEBUG_STICKER_SCALE,
  DEBUG_STICKER_ROT,
  DEBUG_MULTI,
  DEBUG_SELECT_INDEX,
  DEBUG_DELETE_INDEX,
  DEBUG_TAP_UV,
  DEBUG_FRAME_FIT,
  DEBUG_PANEL_SURVEY,
  DEBUG_DRAG_PATH,
  STICKER_ROT_INIT_DEG,
  STICKER_SNAP_STEP_DEG,
  STICKER_SNAP_TOL_DEG,
  PANEL_FACING_MIN,
  PANEL_HOP_HYSTERESIS_CM,
  HOP_RULE_PASS39,
  PANEL_PICK_FACING_TOL,
  DUP_OFFSET_CM,
} from "./Stickers"

const MOTE_MAT = requireAsset("../Materials/MoteMaterial.mat") as Material // unlit, base-tex OFF → solid baseColor

// --- Interaction rig sizing (WORLD cm). The imported shirt is fit to ~30 cm tall
// (SHIRT_TARGET_HEIGHT_CM); the flower renders ~8.6 cm at scale 1.0.
const FRONT_OFFSET = 2.0 // push the first hit target off the panel, along its live normal
const HIT_PAD = 0.9 // how far the tap target extends past the sticker footprint
const HIT_BOX_DEPTH = 1.0 // thin, so the depth stagger below actually separates the boxes

// Pass 10/11 — HOW OVERLAP PICKING IS MADE EXACT.
//
// Tap targets are staggered along their panel's live normal by HIT_DEPTH_STEP per index,
// so the interactor's ray meets the TOPMOST sticker's collider first and pick order is
// the same list order as draw order.
//
// A stagger alone is NOT enough: the cloth is curved, and over a torso panel its own
// depth swings about 6 cm. Hang each box off its own patch of fabric and a sticker placed
// LATER but lower down can end up further from the camera than an earlier one, and the
// ray picks the buried sticker. So the boxes do not follow the cloth in depth: each takes
// the sticker's TANGENTIAL position and is then flattened onto its PANEL's own mean plane
// (Pass 11 — Pass 10 could hard-code one z because there was only the front) and lifted
// HIT_PLANE_LIFT clear of it. Depth order is then purely the index. Colliders are
// invisible, so being a few cm off the cloth costs nothing but a few percent of ray
// parallax at the sticker's edges — well inside HIT_PAD.
const HIT_DEPTH_STEP = 0.35
const HIT_PLANE_LIFT = 2.0 // cm clear of the panel's mean plane, before FRONT_OFFSET
// The selection frame clears the whole stack, so its chips always win over any sticker.
const FRAME_LIFT = 0.8
//
// PASS 44 — THE LOST TAP, MEASURED AND NAMED. The lift above used to run along the
// PANEL'S NORMAL. Head-on that is straight at the eye; on a panel turned away it is
// mostly SIDEWAYS. The harness's ray probe (debugRayProbe: the very rayCastAll SIK's
// mouse interactor casts, from the eye through the sticker's visible centre) found the
// tap target 4.0 cm beside the sticker on the cap's side panels (facing 0.42: a 4.35 cm
// lift x sin 65 deg), where the box itself is foreshortened to 2.4 cm on screen — so the
// ray through the sticker met NOTHING but the backdrop, and a tap deselected instead of
// selecting. The shirt's front was fine at all eight edges (facing ~1, the lift is depth);
// its sleeves were 1.7 cm off and only saved by the box's padding. Every panel a sticker
// stalls against when dragged sideways — the cap's sides, the socks' insteps, the sleeves
// — is a turned panel, which is why it read as "near the edge, where it cannot be dragged
// further". The drag never shared the fault: it works from the pointer's ray, not the box.
//
// So the lift now runs along the EYE'S RAY through the sticker's visible centre: the box
// keeps its depth on the panel's mean plane (the Pass 10/11 pick-order guarantee: every
// box of a panel lies on one plane, staggered by index, so at any pixel the highest index
// is nearest), and its screen position IS the sticker's, on every panel at every angle.
// The frame's root takes the same path, so its chips still clear the whole stack.
const HIT_RAY_MIN_FACING = 0.05 // below this the ray runs along the plane; keep the old placement

// --- Selection frame (Pass 10 rework): ONE hairline, with a halo that reads as the
// line's edge rather than as a second rectangle.
//
// FRAME_BAR is the visible stroke. FRAME_HALO_EDGE is how much dark shows on EACH side of
// it — the whole of Pass-10 point 1 is that this used to be 0.10 cm (as thick as the
// stroke itself, on both sides), which draws a second, heavier rectangle a millimetre
// out. At 0.04 it is a defined edge on the stroke and nothing more, and it still lifts
// the light-blue clear of a white shirt.
const FRAME_BAR = 0.16 // the hairline itself
const FRAME_HALO_EDGE = 0.04 // dark showing on EACH side of the hairline
const FRAME_HALO = FRAME_BAR + 2 * FRAME_HALO_EDGE // total backing thickness — derived, never drifts
const FRAME_EDGE_PAD = 0.0 // gap between the artwork's edge and the stroke's CENTRELINE

// ============================================================================
// PASS 38 — THE FRAME TO Refs/ui_selector
// ============================================================================
//
// WHAT MADE THE LINE LOOK SEGMENTED. Not the segments. Each side is six straight quads
// (FRAME_SEGMENTS) and each quad ran LONG so the joins would close: the stroke by
// FRAME_BAR, the dark backing by FRAME_HALO. The stroke is opaque, so its overlaps are
// invisible — paint the same violet twice and you still have violet. The BACKING is not:
// it is dark at alpha 0.5, and two overlapping translucent quads composite to
// 1-(1-a)^2 = 0.75, not 0.5. So every join carried a 0.24 cm bead of darker backing, six
// per side, twenty-four round the frame. That regular dark beading is what read as
// "built from pieces".
//
// The reference has no dark backing at all — it is a violet line with a light core and a
// soft bloom, on a white shirt. So in glass the backing is replaced by two BUTTED glow
// bands: butted, because a translucent layer must never overlap itself. Butting leaves a
// wedge of halfWidth x the angle change at each join — at six segments over the cloth's
// curve that is under 0.01 cm, which is nothing. The opaque core keeps its overlap and so
// the line itself is unbroken.
//
// Classic keeps the dark halo exactly as it shipped.
const FRAME_GLOW_OUT_W = 0.62 // the outer bloom's total width
const FRAME_GLOW_IN_W = 0.34 // the inner bloom's
const FRAME_GLOW_OUT = new vec4(0.66, 0.45, 0.98, 0.16)
const FRAME_GLOW_IN = new vec4(0.66, 0.45, 0.98, 0.30)
/** The stroke's own colour in glass: a lit core, lighter than the bloom around it. */
const FRAME_CORE = new vec4(0.82, 0.71, 1.0, 1.0)

// PASS 38 — RENDER ORDER, and why this is the fix rather than a reparent.
//
// Every part of the frame is drawn with depthTest OFF, so depth cannot order them, and
// every part carried renderOrder 0 — which left the draw order to the engine's own
// sorting of the transparent queue. The chips are BUILT last (they are the final children
// of StickerSelectionSpin, verified in the running scene), so hierarchy order would have
// put them on top; they were not on top, which is what proves the queue was not being
// ordered by hierarchy. Depth-sorting a set of quads that all sit within a millimetre of
// each other on a curved, rotating surface is not something to reason about — it changes
// with the angle, the scale and the panel.
//
// So the order is now STATED. renderOrder is the primary sort key for the queue, ahead of
// any depth or hierarchy consideration, and these six values are a strict stack: bloom
// under line under dot under chip-bloom under chip under glyph. It cannot come apart at
// an angle or a scale because nothing about it is geometric.
const FRAME_ORDER_GLOW = 10
const FRAME_ORDER_GLOW_IN = 11
const FRAME_ORDER_LINE = 12
const FRAME_ORDER_DOT = 13
const FRAME_ORDER_CHIP_GLOW = 14
const FRAME_ORDER_CHIP_DISC = 15
const FRAME_ORDER_CHIP_GLYPH = 16

// PASS 38 — the midpoint dots. Decorative anchors at the middle of each edge, as the
// reference has them: no collider, no handler, nothing happens when they are pressed.
// The reference's dot is 30 px across on a 14 px bar, so its RADIUS is about one bar
// thickness — which is how it is expressed here, so it tracks the stroke's weight.
const FRAME_DOT_K = 1.05
const FRAME_DOT_R = FRAME_BAR * FRAME_DOT_K
const FRAME_DOT_COL = new vec4(1, 1, 1, 0.98)
const FRAME_DOT_GLOW_K = 1.9
const FRAME_DOT_GLOW = new vec4(0.66, 0.45, 0.98, 0.34)
/** Which chain point is the middle of a side. FRAME_SEGMENTS is even, so this is exact. */
const FRAME_MID_INDEX = 3

// How many straight segments each side of the frame is drawn from. The stamp's edge is a
// straight line in the shirt's UV ATLAS, but the cloth it is printed on is curved, so on
// screen that edge is a CURVE — and a single straight bar between two corners cuts the
// chord. At scale 1.0 the sag is under a millimetre and invisible; at maximum scale the
// sticker spans most of the torso and the chord runs 1.2 cm outside the artwork at the
// middle of each side. Six segments per side follow the curve to well under the stroke's
// own width, for 48 small quads in total — the frame is only laid out when the sticker
// changes, not per frame, so this costs nothing to run.
const FRAME_SEGMENTS = 6

// Pass 26: FOUR corner chips (x, duplicate, resize, rotate), drawn AT the cloth's depth so
// they are coplanar with the frame, and scaled with the frame: radius = SEL_CHIP_K x the
// frame's shorter side, held between SEL_CHIP_R_MIN and SEL_CHIP_R_MAX. Their colliders
// stay on the frame's lifted plane (SEL_CHIP_HIT_Z), placed on the eye's ray through each
// chip, so they still out-rank every sticker's tap target and never leave the chip.
const CHIP_R = 1.15 // the chips' DRAWN radius at scale 1 (the glyphs are drawn for this)
const SEL_CHIP_K = 0.16
const SEL_CHIP_R_MIN = 0.6
const SEL_CHIP_R_MAX = 1.3
const SEL_CHIP_HIT_MIN = 2.4 // a chip's grab box is never smaller than this, in cm
const SEL_CHIP_HIT_Z = 0.4 // frame-local z of the chips' colliders (the lifted plane)
// Pass 44: the chip boxes were 3 cm deep. On a panel turned 65 degrees that depth lies
// almost ALONG the view, so each box smeared ~3 cm sideways on screen and the ray probe
// found all four chips over the centre of a small sticker on the cap's side (a body tap
// would have duplicated or deleted it). Thin, like the tap targets: a ray through the
// disc crosses the lifted plane at the box's centre, so depth buys nothing.
const SEL_CHIP_HIT_DEPTH = HIT_BOX_DEPTH
const SEL_CHIP_LIFT = 0.1 // the chip's disc sits this far off the cloth, like the corner dots did
// PASS 38 — the chips to the reference. Measured off Refs/ui_selector: the ring is 14 px
// on an 86 px disc and the frame's line is also 14 px, so THE RING IS THE SAME WEIGHT AS
// THE LINE — that is the rule, rather than two numbers that can drift apart. The glyph
// strokes are 16 px on the same 86 px disc, noticeably heavier than ours were.
const CHIP_RING = pick(0.10, FRAME_BAR) // chip outline stroke
const GLYPH_BAR = pick(0.13, 0.18) // stroke of the x / resize glyphs
const GLYPH_LEN = 1.25 // length of the x / resize glyph strokes
/** The chip's bloom, in multiples of its radius. Two bands, as the frame's line has. */
const CHIP_GLOW_OUT_K = 1.42
const CHIP_GLOW_IN_K = 1.18
const CHIP_GLOW_OUT = new vec4(0.66, 0.45, 0.98, 0.20)
const CHIP_GLOW_IN = new vec4(0.66, 0.45, 0.98, 0.38)

// --- Pass 9: ROTATE handle. It sits on the TOP EDGE, centred, lifted clear of the frame
// on a short stem. Both corner diagonals are already taken (x top-left, resize
// bottom-right) and the remaining two corners carry the plain dots, so an edge is the
// only collision-free spot left — and top-centre-above is the conventional place for a
// rotate grip. Being on the mid-line also means it never lands under the other chips.

// How many tap targets to build up front. There is no cap on how many stickers can
// coexist — ensureHitSlot() grows the pool on demand — but SIK wants its Interactables
// subscribed during OnStart, so the first handful are built there rather than in the
// middle of a tap handler.
const HIT_SLOT_PREBUILD = 8

/** Newton steps for worldToUV. Two are enough from a good seed; six is margin. */
const NEWTON_STEPS = 6

// Fixed-point passes for rayToPanelUV, and how far outside a panel's rect an
// intermediate pass may wander before being pulled back into the grid's domain.
const RAY_PASSES = 4
const RAY_DOMAIN_SLACK = 0.25
/**
 * PASS 20 — how settled the plane cast has to be for its answer to count, in CENTIMETRES
 * of cloth moved on its final pass.
 *
 * rayToPanelUV is a fixed-point iteration: each pass takes the tangent plane where the
 * last one landed and re-intersects. Near a panel's edge, where the surface is turning
 * away from the ray, it does not converge — it ping-pongs, and the four passes end
 * wherever they happen to be. Before this pass that answer was scored like any other, so
 * a panel on the FAR SIDE of the cap could win a drag with a uv it had made up, and the
 * sticker teleported across the crown (measured: 20 cm jumps, alternating every frame,
 * once the pointer went past the cap's edge).
 *
 * A candidate whose last pass still moved more than this has not found the surface, and is
 * dropped. If that leaves no candidate the drag simply does not move this frame, which is
 * the honest answer to "the pointer is not on the cloth".
 *
 * 0.6 cm is comfortably above the settled case (measured 0.00-0.10 cm on both garments in
 * the region a drag actually uses) and far below the diverged one (4-40 cm).
 */
const RAY_SETTLE_CM = 0.6
/** Pass 26: below this much of world-up left in a panel's plane, it counts as horizontal (see measurePanelFrame). */
const FRAME_UP_MIN = 0.3

// Colors — light blue hairline over a dark halo reads on both a white and a black shirt.
const ACCENT = pick(new vec4(0.36, 0.72, 0.93, 1.0), new vec4(0.66, 0.45, 0.98, 1.0)) // fine stroke: light blue (Refs/inspi), violet in glass (Refs/ui_inspi)
const HALO = new vec4(0.04, 0.08, 0.12, 0.5) // dark backing behind the stroke
const CHIP_FILL = new vec4(0.98, 0.99, 1.0, 0.97) // white chip
const GLYPH_COL = new vec4(0.16, 0.2, 0.26, 1.0) // dark slate glyph on the white chip

/**
 * One placed sticker. Fully independent: its own panel, position, size and angle. The
 * array index is the stacking order (and, by the HIT_DEPTH_STEP construction, the pick
 * order): higher index = drawn later = on top = picked first.
 */
interface PlacedSticker {
  /** Pass 16: the ARTWORK, not just a texture — it carries the trim and the aspect. */
  art: StickerArt
  panel: number // index into the garment's panel table
  u: number
  v: number
  scale: number // the scale the USER asked for (effScale caps it against the panel)
  rotDeg: number // CCW degrees as seen looking at that panel
  /** Pass 28: present when this sticker is TEXT — its artwork is rendered from this. */
  text?: TextStyle
}

/** One sticker's tap target: positioned + panel-oriented root, spin child, collider. */
interface HitSlot {
  root: SceneObject
  spin: SceneObject
  collider: ColliderComponent
  interactable: Interactable
}

/**
 * Where a sticker's CENTRE may sit on a panel: the panel's clamp rect inset by the
 * sticker's own footprint, expressed in CENTIMETRES along that panel's (right, up)
 * axes, about the rect's centre. Working in the cloth frame rather than in UV is what
 * makes this exact on a sleeve, whose unwrap is turned in the atlas — see ShirtPanels.
 */
interface Rect {
  halfRight: number
  halfUp: number
  ok: boolean // false when the footprint is too big for the panel at all
}

/**
 * The first panel of any garment's table — the one a garment faces you with. Index 0 by
 * convention in every GarmentDef (the shirt's front torso, the cap's front crown panel),
 * so nothing here has to know which garment it is looking at.
 */
export const PANEL_FIRST = 0

/** One garment's saved work: everything a round trip has to bring back. */
interface GarmentState {
  stickers: PlacedSticker[]
  /** One paint layer per bake target — one for every garment but the socks. */
  paints: PaintLayer[]
}

export class StickerSystem {
  /** Everything garment-specific this system reads. See Garments.ts. */
  private def: GarmentDef
  // Pass 23 — ONE BAKE PER PRINT TARGET. `compositor` is target 0, which is every garment's
  // only target but the socks'; `compositors[k]` is the rig for target k, built the first
  // time a garment needs it and switched off while one that does not is on screen. The
  // socks are why: two meshes on two materials whose UV charts SHARE the atlas, so one
  // bake sampled by both would print every sticker on both socks. Every panel carries its
  // target (Panel.target), every sticker is baked into its panel's target, and paint
  // goes into the layer of the panel it was painted on.
  private compositor: StickerCompositor
  private compositors: StickerCompositor[] = []
  /** For each placed sticker: which compositor stamped it, and at which index there. */
  private stampMap: { target: number; at: number }[] = []
  private controller: ScarfController
  private root: SceneObject
  private quadMesh: RenderMesh
  private discMesh: RenderMesh

  // The authoritative list. Index order IS stacking order.
  private stickers: PlacedSticker[] = []
  private selected = -1 // index into `stickers`, or -1 for "nothing selected"

  // One hit slot per sticker, created on demand and reused (a delete frees a slot for the
  // next place). Slot i always addresses stickers[i], so the handlers bound at creation
  // stay correct as the list shifts.
  private hitSlots: HitSlot[] = []

  // Interaction objects. The root carries the world position + the PANEL's world
  // orientation (so it lies flat on that panel); the spin child carries only the
  // sticker's own turn, so the scene graph composes the two instead of us.
  private selRoot!: SceneObject // positioned + panel-oriented
  private selSpin!: SceneObject // child of selRoot: the whole frame, turned with the sticker
  private selProbe!: SceneObject // child of selSpin, no visual: world -> frame-local conversion
  /** Pass 47 (verification): the frame's four corners as last laid out, in selSpin's local cm. */
  private lastCorners: vec3[] | null = null
  private delInteractable!: Interactable
  private resizeInteractable!: Interactable
  private rotInteractable!: Interactable
  private dupInteractable!: Interactable // Pass 26
  private bgObj!: SceneObject // full-view tap-away target
  private bgInteractable!: Interactable

  // --- Pass 18: one of these per garment, the whole of "switching keeps my work" ------
  //
  // WHAT IS PER GARMENT AND WHAT IS NOT, and why the split falls where it does:
  //
  //   PER GARMENT   the sticker list and the paint texture. Both are the user's work, so
  //                 both have to survive a round trip, and neither can be re-derived.
  //   SHARED        the bake rig, the selection frame, the hit slots, the paint capture
  //                 plane, the deselect backdrop. All of them are apparatus, all of them
  //                 are re-pointed at whatever garment is active, and duplicating any of
  //                 them per garment would cost memory and a second bake camera to run
  //                 something nobody is looking at.
  //
  // Created on first visit, never destroyed. WHAT THAT COSTS, exactly: a GarmentState is a
  // sticker array (a few hundred bytes) plus a PaintLayer, and a PaintLayer is
  // PAINT_SIZE x PAINT_SIZE x RGBA8 held twice — once as the CPU buffer that IS the
  // drawing and once as the GPU texture the bake samples. At 512 that is 1 MB + 1 MB =
  // 2 MB per garment, fixed, whether it has been drawn on or not. The bake rig's own
  // 1024 render target (4 MB) is shared and does NOT multiply. See the memory note in
  // Garments.ts for where the ceiling is.
  private states: { [id: string]: GarmentState } = {}

  // --- Pass 17: paint -------------------------------------------------------
  /** The ACTIVE garment's drawing. Swapped, not cleared, on a garment switch. */
  private paint = new PaintLayer()
  /** One layer per bake target for the CURRENT garment; `paint` is the one a stroke is writing. */
  private paints: PaintLayer[] = [this.paint]
  private paintMode = false
  /** The capture plane — see buildPaintCapture() for why input is separated this way. */
  private paintObj!: SceneObject
  private paintInteractable!: Interactable
  private painting = false
  private uvProbe!: SceneObject // child of the shirt visual: mesh <-> world via the live transform

  // Selection-frame parts, kept so the frame can be re-laid-out as the sticker changes.
  /** Pass 38: the four decorative midpoint dots, one per edge. Glass only. */
  private edgeDots: { glow: SceneObject; dot: SceneObject }[] = []
  /** Pass 38: one ribbon per layer per side — bottom, right, top, left, in that order. */
  private sideLayers: { glowOut: SceneObject | null; glowIn: SceneObject; core: SceneObject }[] = []
  private closeChip!: SceneObject // top-left: x
  private dupChip!: SceneObject // top-right: duplicate (Pass 26)
  private resizeChip!: SceneObject // bottom-right: resize
  private rotChip!: SceneObject // bottom-left: rotate (Pass 26: off the edge, onto a corner)
  /** Each chip's collider object, on the lifted plane (see SEL_CHIP_HIT_Z). */
  private chipHits: { [name: string]: SceneObject } = {}
  /** Pass 26: memo of each panel's measured atlas frame, per garment. */
  private panelFrames: { [key: string]: { sigma: number; rotDeg: number; cmU: number; cmV: number } } = {}

  private dragging = false
  private resizing = false
  private rotating = false

  // Pass 12: the photo shutter suspends every piece of editing chrome for the exposure.
  // The selection frame and the tap targets are on the UI layer and are therefore
  // already outside the capture camera's renderLayer; this is the belt to that pair of
  // braces, and it is what the brief asked for in so many words ("deselect for the
  // shot"). It suspends the frame WITHOUT touching `selected`, so the same sticker is
  // still selected, at the same position, scale and angle, when the photo is dismissed.
  private chromeVisible = true
  /**
   * Pass 33: under Paint and Gems the sticker tap targets are off and the paint plane takes
   * every tap, so a text object could not be selected there. A tap whose surface hit lands
   * on a TEXT object now goes here instead of painting: the owner switches the tool back
   * to Colour and selects it. Paint under a sticker is invisible anyway (the paint layer
   * lies beneath the stickers), so nothing that could be seen is lost.
   */
  onTextUnderTool: ((index: number) => void) | null = null

  // Per-panel liveness, recomputed each frame (Pass 11's facing guard).
  private live: boolean[] = []

  // Pass 22: the on-screen refusal — "Nothing placed" — for a tap whose target panel is
  // turned away from the camera. See PlacementHint and placeArt.
  private hint!: PlacementHint
  /** Pass 28: renders typed text into sticker artwork. */
  private baker!: TextBaker
  // Pass 29: gems — the stones themselves live in GemSystem; this class does the placing.
  private gems!: GemSystem
  private gemMode = false
  private gemStroke = false
  private gemShape = GEM_SHAPE_MIX
  private gemColor = GEM_COLOR_MIX
  private gemSizeCm = GEM_SIZE_INIT
  private gemLastWorld: vec3 | null = null
  /** Pass 25: refit the paint plane on the next update (after the garment's pose is written). */
  private paintPlaneDirty = false
  private paintCollider!: ColliderComponent

  // Resize gesture state
  private resizeStartScale = 1
  private resizeStartDist = 1

  // Rotate gesture state
  private rotStartAngle = 0 // pointer angle at grab
  private rotStartSticker = 0 // sticker angle at grab

  // Re-measured on every garment (init and switchTo): world cm per MESH unit, which is
  // that garment's fit scale x its meshToLocal. Every panel's meshPerU/meshPerV becomes cm
  // through this, so changing a garment's targetCm still flows through the whole system.
  private cmPerMesh = 3.3333

  // Each panel's mesh-space centre, cached in init(). Used to flatten a tap target onto
  // the panel's mean plane (see HIT_PLANE_LIFT).
  private panelCentre: vec3[] = []

  /**
   * @param root       parent for the compositor rig + interaction targets (the main root)
   * @param controller the shirt controller (fabric texture source + setBaseTexture sink)
   */
  constructor(root: SceneObject, controller: ScarfController, def: GarmentDef) {
    this.def = def
    this.root = root
    this.controller = controller
    this.quadMesh = buildUnitQuad()
    this.discMesh = buildDisc(40)

    // Capture the ORIGINAL fabric texture BEFORE we redirect the shirt to the render
    // target (otherwise getBaseTexture would return the render target — circular).
    const fabricTex = controller.getBaseTexture()
    this.compositor = new StickerCompositor(root, fabricTex)
    this.compositors = [this.compositor]
    // Feed the live baked texture to the shirt. Fabric-only initially (no stickers).
    controller.setBaseTexture(this.compositor.getOutputTexture())

    this.buildSelectionBox()
    this.hint = new PlacementHint(root)
    this.baker = new TextBaker(root)
    this.gems = new GemSystem()
    this.gems.switchTo(def.id, controller.getVisual())
    this.buildPaintCapture()
    // The compositor draws the paint texture between the fabric and the stickers.
    this.compositor.setPaintTexture(this.paint.getTexture())
    this.buildBackgroundTarget()
    this.buildUvProbe()
  }

  // ---------------------------------------------------------------------------
  // Public API (driven by the main script)
  // ---------------------------------------------------------------------------

  /** Called from OnStartEvent: measure the shirt + bind SIK events. */
  init(): void {
    this.measureShirtScale()
    for (let i = 0; i < this.panels.length; i++) {
      const m = panelUvToMesh(this.panels[i], this.def.panelGrid, this.panels[i].homeU, this.panels[i].homeV)
      this.panelCentre.push(new vec3(m.x, m.y, m.z))
      this.live.push(true)
    }
    this.updateLiveness()
    this.bindGlobalInteractions()
    this.bindPaintInteractions()
    this.paintPlaneDirty = true
    for (let i = 0; i < HIT_SLOT_PREBUILD; i++) this.ensureHitSlot(i)

    // Calibration harness: if probes are configured, bake them all at once so a single
    // preview capture reveals the front-chest UV. No interaction in this mode.
    if (CALIBRATION_PROBES.length > 0) {
      const p = this.panels[PANEL_FIRST]
      this.compositor.setStickers(
        CALIBRATION_PROBES.map((c) => ({
          tex: STICKER_TEXTURES[c.tex],
          uc: c.uc,
          vc: c.vc,
          sideCm: CAL_PROBE_HALF * 2 * p.meshPerU * this.cmPerMesh,
          rotDeg: 0,
          cmPerU: p.meshPerU * this.cmPerMesh,
          cmPerV: p.meshPerV * this.cmPerMesh,
          atlasRotDeg: this.panelFrame(PANEL_FIRST).rotDeg,
          sigma: this.panelFrame(PANEL_FIRST).sigma,
          wFrac: 1,
          hFrac: 1,
          mesh: null,
        }))
      )
      return
    }

  }

  /**
   * PASS 18 — SWITCH THE GARMENT UNDER THE WHOLE SYSTEM.
   *
   * This is the single entry point for "customise the cap instead". Everything it does is
   * a re-pointing of apparatus that already existed; there is no cap-shaped branch in this
   * file, and adding a tote bag would not add one.
   *
   *   1. PARK the outgoing garment's work — its sticker list and its paint texture — under
   *      its id, and abandon any gesture that was in flight, because the surface that
   *      gesture was integrating against is about to leave the screen.
   *   2. ADOPT the new definition and controller. `def` is the only thing this class ever
   *      knew about garment shape, so from this line the panel table, the atlas metrics,
   *      the sticker limits and the mesh-to-local factor are all the new garment's.
   *   3. RE-POINT THE ONE BAKE RIG: its paint layer to this garment's drawing, its fabric
   *      layer to this garment's albedo (or to flat colour), and its output back onto this
   *      garment's materials. The previous garment's materials keep pointing at the same
   *      render target — harmless, it is disabled — and get the correct picture again the
   *      moment it is switched back to and the rig is re-pointed at it.
   *   4. RE-MEASURE. The uv probe is a CHILD of the garment visual (that is how it reads
   *      the live bob and yaw), so it has to be re-parented, and cm-per-mesh re-measured
   *      through it: the shirt is 3.33 cm per mesh unit and the cap 1.24.
   *   5. REBUILD the panel caches and re-stamp the restored stack.
   *
   * Colour is not here on purpose: it is the slider's value, the main script owns one per
   * garment, and it arrives through the same setShirtColor() a drag of the slider uses.
   */
  switchTo(def: GarmentDef, controller: ScarfController): void {
    if (def.id === this.def.id) return

    this.states[this.def.id] = { stickers: this.stickers, paints: this.paints }
    this.dragging = false
    this.resizing = false
    this.rotating = false
    this.painting = false
    for (const p of this.paints) p.endStroke()
    this.selected = -1
    this.hint.hide() // its advice named the old garment

    this.def = def
    this.controller = controller
    this.paintPlaneDirty = true // the plane is the garment's size; refit once its pose is written

    let st = this.states[def.id]
    if (!st) {
      st = { stickers: [], paints: [] }
      this.states[def.id] = st
    }
    // Pass 23: one paint layer per bake target, made the first time the garment is shown.
    const targets = this.targetCount()
    while (st.paints.length < targets) st.paints.push(new PaintLayer())
    this.stickers = st.stickers
    this.paints = st.paints
    this.paint = this.paints[0]

    // Re-point one bake rig per target; park the rigs this garment does not use.
    for (let t = 0; t < targets; t++) {
      const c = this.bake(t)
      c.setPaintTexture(this.paints[t].getTexture())
      c.setFabricTexture(def.fabricFromAlbedo ? controller.getOriginalBaseTexture(t) : null)
      controller.setBaseTexture(c.getOutputTexture(), t)
      c.setEnabled(true)
    }
    for (let t = targets; t < this.compositors.length; t++) this.compositors[t].setEnabled(false)

    const visual = controller.getVisual()
    this.uvProbe.setParent(visual ? visual : this.root)
    this.measureShirtScale()
    this.gems.switchTo(def.id, visual) // Pass 29: this garment's stones come with its visual
    this.gemStroke = false

    this.panelCentre = []
    this.live = []
    for (let i = 0; i < this.panels.length; i++) {
      const m = panelUvToMesh(this.panels[i], this.def.panelGrid, this.panels[i].homeU, this.panels[i].homeV)
      this.panelCentre.push(new vec3(m.x, m.y, m.z))
      this.live.push(true)
    }
    this.updateLiveness()
    this.rebuild()
  }

  /** The active garment's id — the main script's cue for which button reads as selected. */
  getGarmentId(): string {
    return this.def.id
  }

  /**
   * Verification harness entry point, called by the main script on the FIRST update
   * frame rather than from init(). It has to be that late: the platform writes the
   * shirt's yaw in updateIdle, so at OnStart time the shirt is still front-on and any
   * driver that depends on which panel is facing the camera — which, in Pass 11, is all
   * of them — would answer for the wrong panel. Inert in shipped code.
   */
  runBootDebug(): void {
    if (CALIBRATION_PROBES.length > 0) return
    if (DEBUG_PANEL_SURVEY) this.printPanelSurvey()
    this.runDebugDrivers()
  }

  /**
   * Per-frame. The shirt MOVES under the rig — it bobs and, with the platform slider,
   * rotates — so every hit target and the selection frame have to be re-glued to the
   * cloth each frame. This also runs the per-panel facing guard.
   */
  update(): void {
    if (CALIBRATION_PROBES.length > 0) return
    this.hint.update(getDeltaTime())
    if (this.paintPlaneDirty) this.fitPaintPlane()
    this.baker.update()

    if (this.updateLiveness()) {
      // Some panel just changed state. If the SELECTED sticker's panel went dark,
      // abandon any in-flight gesture rather than let it keep integrating pointer motion
      // against a plane that has gone edge-on.
      const s = this.stickers[this.selected]
      if (s && !this.live[s.panel]) {
        this.dragging = false
        this.resizing = false
        this.rotating = false
      }
      this.refreshVisibility()
    }
    this.applyWorldTransforms()
  }

  /**
   * Pass 7: set the shirt color. The color is painted into the compositor's FABRIC layer
   * (not a global multiply), so placed flowers keep their true colors on top of it.
   */
  setShirtColor(c: vec4): void {
    for (const k of this.compositors) k.setFabricColor(c)
  }

  // ---------------------------------------------------------------------------
  // Bake targets (Pass 23)
  // ---------------------------------------------------------------------------

  /** How many bakes the current garment needs: its material groups, or one. */
  private targetCount(): number {
    return this.def.printTargets ? this.def.printTargets.length : 1
  }

  /** Which bake a panel prints into. */
  /**
   * PASS 39 — which bake target NEW content goes to on a multi-target garment (the socks:
   * 0 = left, 1 = right). -1 means "any", which is what every single-target garment is
   * and what the socks were before the Left/Right selector. It filters PLACEMENT ONLY:
   * activePanel (a new sticker or text), and surfaceHit for a new stone or brush dab. A
   * drag is not filtered — see dragToRay's rule 3 for the one thing it does require.
   */
  private placeTarget = -1
  setPlaceTarget(t: number): void { this.placeTarget = t }
  getPlaceTarget(): number { return this.placeTarget }
  /** True when `panel` may receive new content under the current placement target. */
  private placeable(panel: number): boolean {
    return this.placeTarget < 0 || this.panelTarget(panel) === this.placeTarget
  }

  private panelTarget(panel: number): number {
    const t = this.panels[panel].target
    return t === undefined ? 0 : t
  }

  /** The rig for target `t`, built on first use. */
  private bake(t: number): StickerCompositor {
    while (this.compositors.length <= t) {
      const c = new StickerCompositor(this.root, null, this.compositors.length)
      c.setEnabled(false)
      this.compositors.push(c)
    }
    return this.compositors[t]
  }

  /** What was stamped for sticker `i`, whichever rig stamped it. */
  private stampFor(i: number): Stamp | null {
    const m = this.stampMap[i]
    if (!m) return null
    return this.compositors[m.target].getStamp(m.at)
  }

  /**
   * Tap a tray thumbnail → ADD a flower on whichever panel is FACING the camera (Pass 11)
   * and make it the selected one. It lands at that panel's home, cascaded by how many
   * stickers the panel already carries, so a run of taps on the back lays out its own
   * staircase rather than fighting the ones on the chest.
   */
  placeSticker(index: number): void {
    this.placeArt(BUILTIN_ART[index])
  }

  /**
   * Place ANY artwork — the one path a placement goes through since Pass 16.
   *
   * A tray tap is `placeArt(BUILTIN_ART[i])` and an imported image is `placeArt(art)`
   * with a trimmed quad and a non-square aspect. Nothing downstream distinguishes them,
   * which is the whole requirement: an imported logo is selected, dragged, resized,
   * rotated, hopped between panels and deleted by exactly the code that does it for a
   * daisy, and two copies of the same import are two independent stickers.
   */
  placeArt(art: StickerArt | null): void {
    // Pass 34: a built-in with a named ink rectangle gets its trimmed quad on first use.
    if (art && !art.mesh && art.trim) art.mesh = buildUnitQuadUV(art.trim.u0, art.trim.v0, art.trim.u1, art.trim.v1)
    if (CALIBRATION_PROBES.length > 0) return // calibration mode owns the compositor
    if (!art || !art.tex) return
    const panel = this.activePanel()
    // PASS 22 — THE PLACEMENT GUARD. The winning panel is the one most squarely facing
    // the camera, but "most" can still be "not at all": a tote turned to its back has one
    // print surface and it is behind the bag. Placing there stamps the artwork onto cloth
    // nobody can see and looks exactly like a tap that did not register. So a panel that
    // is not LIVE — the same PANEL_FACING_MIN test that decides whether a sticker can be
    // touched — refuses the placement, and says so on screen (PlacementHint) rather than
    // silently. Every garment goes through this: the cap's rear regions and the shirt's
    // back are refused just the same when they are the best of a bad set of angles.
    const facing = this.panelFacing(panel)
    if (facing < PANEL_FACING_MIN) {
      this.hint.show("Nothing placed", "Turn the " + this.def.label.toLowerCase() + " to face you")
      print("[PLACE] refused: " + this.panels[panel].name + " is turned away (facing " +
        facing.toFixed(2) + " < " + PANEL_FACING_MIN + ")")
      return
    }
    const s: PlacedSticker = {
      art,
      panel,
      u: 0,
      v: 0,
      scale: this.def.scaleInit,
      rotDeg: STICKER_ROT_INIT_DEG,
    }
    this.stickers.push(s)
    this.moveToPanelHome(s, panel)
    this.ensureHitSlot(this.stickers.length - 1)
    this.selected = this.stickers.length - 1 // newest is on top AND selected
    this.rebuild()
  }

  /**
   * Put a sticker at a panel's home: the panel's own home UV, stepped along by the
   * CASCADE for how many stickers that panel already carries, at the largest size the
   * panel can hold up to the normal starting size.
   *
   * The cascade step is in CENTIMETRES on the cloth — right and down — converted through
   * the panel's own metrics, so it looks the same on the chest, the back and a sleeve,
   * and stays correct on a sleeve whose unwrap is turned in the atlas (a fixed UV step
   * would cascade off in some arbitrary diagonal there). Counting PER PANEL is what
   * makes stickers on the back cascade among themselves rather than against the chest.
   */
  private moveToPanelHome(s: PlacedSticker, panel: number): void {
    const p = this.panels[panel]
    let k = 0
    for (const other of this.stickers) if (other !== s && other.panel === panel) k++
    k = k % this.def.cascadeWrap
    const d = this.cmToUv(panel, k * this.def.cascadeRightCm, -k * this.def.cascadeDownCm)
    s.panel = panel
    s.u = p.homeU + d.x
    s.v = p.homeV + d.y
    // Never bigger than this panel can hold: the torsos give the full
    // this.def.scaleInit, a sleeve gives the ~0.5 that fits on it. The sticker arrives
    // correct rather than arriving too big and being shrunk.
    s.scale = Math.min(this.def.scaleInit, this.panelMaxUprightScale(panel))
    this.clampToPanel(s)
  }

  /**
   * Select the sticker at `i` (-1 = deselect everything). Selecting one deselects
   * whatever was selected before — there is only ever one frame.
   *
   * ORDER MATTERS: the frame has to be MOVED onto the new sticker before it is laid out,
   * because layoutSelection() measures the stamped corners in the frame's own local
   * space. Laying out first would measure them against the previous sticker's pose and
   * fling the frame a sticker's distance away from where it belongs.
   */
  selectSticker(i: number): void {
    this.selected = i >= 0 && i < this.stickers.length ? i : -1
    this.refreshVisibility()
    this.applyWorldTransforms()
    if (this.selected >= 0) this.layoutSelection()
  }

  /** Remove the selected sticker; everything under it survives untouched. */
  deleteSelected(): void {
    if (this.selected < 0) return
    this.stickers.splice(this.selected, 1)
    this.selected = -1
    this.dragging = false
    this.resizing = false
    this.rotating = false
    this.rebuild()
  }

  /**
   * Verification entry points (Pass 16): drive the SELECTED sticker's scale and rotation
   * through exactly the functions the resize and rotate handles drive, so a capture shows
   * the real clamped result rather than a shortcut.
   */
  debugSetScale(v: number): void {
    if (this.selected >= 0) this.setStickerScale(v)
  }
  debugSetRotation(deg: number): void {
    if (this.selected >= 0) this.setStickerRotation(deg)
  }

  /** How many stickers are on the shirt (verification harness / diagnostics). */
  getStickerCount(): number {
    return this.stickers.length
  }

  /**
   * Pass 12: suspend / restore the editing chrome for a photo exposure.
   *
   * `selected` is deliberately untouched — this hides the frame and the tap targets, it
   * does not deselect. Everything the user placed comes back exactly as it was, still
   * selected, the instant the shot is over.
   */
  setChromeVisible(v: boolean): void {
    // Pass 17: paint mode also hides the chrome, and it outranks the photo booth. Without
    // this `&& !paintMode`, taking a photograph WHILE painting would put the selection
    // frame back on capture-end — a frame around a sticker you cannot currently grab,
    // sitting over the drawing. The booth is not wrong to ask; paint is simply a stronger
    // reason to keep the chrome down, so the two are combined here rather than the booth
    // being taught about tools.
    this.chromeVisible = v && !this.paintMode
    this.refreshVisibility()
  }

  /** Which sticker is selected right now, or -1 (diagnostics / capture bookkeeping). */
  getSelectedIndex(): number {
    return this.selected
  }

  // ---------------------------------------------------------------------------
  // Panels: facing, liveness, and which one is active
  // ---------------------------------------------------------------------------

  /** A panel's outward normal right now, in world space. */
  private panelNormal(i: number): vec3 {
    const p = this.panels[i]
    return this.controller.getWorldRotation().multiplyVec3(new vec3(p.nx, p.ny, p.nz)).normalize()
  }

  /**
   * How squarely a panel faces the viewer: 1 = dead-on, 0 = edge-on, <0 = turned away.
   * The scene camera is fixed at the origin looking down -Z, so the normal's world +Z
   * component IS its facing — no camera lookup needed.
   */
  private panelFacing(i: number): number {
    return this.panelNormal(i).z
  }

  /**
   * Recompute which panels are live. Returns true if anything changed, so update() only
   * touches the scene graph when it has to.
   */
  private updateLiveness(): boolean {
    let changed = false
    for (let i = 0; i < this.panels.length; i++) {
      const on = this.panelFacing(i) >= PANEL_FACING_MIN
      if (on !== this.live[i]) {
        this.live[i] = on
        changed = true
      }
    }
    return changed
  }

  /**
   * The panel a new sticker should land on: the one whose normal most faces the camera,
   * weighted by Panel.pickWeight so the torsos (1.0) beat the sleeves (0.55) unless a
   * sleeve is plainly what you are looking at. Does NOT itself require the winner to be
   * live — it answers "which panel", and the most-facing surface is the honest answer at
   * any angle. Whether a sticker may be PLACED there is placeArt's question (Pass 22: a
   * winner below PANEL_FACING_MIN is refused, visibly), and whether one can be
   * INTERACTED with is answered per panel by `live`.
   */
  private activePanel(): number {
    // A panel that cannot hold even the smallest upright sticker is not somewhere a tap
    // may put one — otherwise the clamp would have nothing to clamp to and the artwork
    // would hang off the cloth.
    const ok: number[] = []
    let bestFacing = -Infinity
    for (let i = 0; i < this.panels.length; i++) {
      if (this.panelMaxUprightScale(i) < this.def.scaleMin) continue
      if (!this.placeable(i)) continue // Pass 39: the other sock does not take new content
      ok.push(i)
      bestFacing = Math.max(bestFacing, this.panelFacing(i))
    }
    // Pass 27: the panels facing the camera (within PANEL_PICK_FACING_TOL of the best) are
    // the candidates; the largest of them wins. Size never outranks facing.
    let best = PANEL_FIRST
    let bestWeight = -Infinity
    for (const i of ok) {
      if (this.panelFacing(i) < bestFacing - PANEL_PICK_FACING_TOL) continue
      if (this.panels[i].pickWeight > bestWeight) {
        bestWeight = this.panels[i].pickWeight
        best = i
      }
    }
    return best
  }

  /** The largest UPRIGHT sticker a panel can hold, as a scale. */
  private panelMaxUprightScale(panel: number): number {
    const p = this.panels[panel]
    return (Math.min(p.halfRightMesh, p.halfUpMesh) * this.cmPerMesh) / (this.def.stickerSideCm / 2)
  }

  // ---------------------------------------------------------------------------
  // Interaction wiring
  // ---------------------------------------------------------------------------

  /** The frame's chips + the tap-away backdrop. Sticker taps bind per slot. */
  private bindGlobalInteractions(): void {
    // Tap the x → remove the SELECTED sticker + hide the frame.
    this.delInteractable.onTriggerStart.add(() => {
      this.deleteSelected()
    })
    // Pass 26: tap the duplicate chip -> a copy of the selected sticker, selected.
    this.dupInteractable.onTriggerStart.add(() => {
      this.duplicateSelected()
    })
    // Tap empty space → deselect (hide the frame, keep every sticker).
    this.bgInteractable.onTriggerStart.add(() => {
      if (this.selected >= 0 && !this.dragging && !this.resizing && !this.rotating) this.selectSticker(-1)
    })

    // RESIZE (Pass 8): drag the corner handle. The gesture is measured in FOOTPRINT units
    // — how far the pointer is from the sticker centre as a multiple of the unscaled
    // half-side — so the ratio to where the drag started IS the scale ratio, and the
    // handle tracks the pointer without ever snapping.
    this.resizeInteractable.onDragStart.add((e: DragInteractorEvent) => {
      if (!this.gestureAllowed()) return
      const d = this.footprintDistance(e)
      if (d === null || d < 0.08) return // degenerate grab (pointer on the centre)
      this.resizing = true
      this.resizeStartScale = this.stickers[this.selected].scale
      this.resizeStartDist = d
    })
    this.resizeInteractable.onDragUpdate.add((e: DragInteractorEvent) => {
      if (!this.resizing) return
      const d = this.footprintDistance(e)
      if (d === null) return
      this.setStickerScale(this.resizeStartScale * (d / this.resizeStartDist))
    })
    this.resizeInteractable.onDragEnd.add(() => {
      this.resizing = false
    })

    // ROTATE (Pass 9): drag the top handle. The gesture is measured as the ANGLE from the
    // sticker's centre to the pointer, so the sticker turns to follow the handle wherever
    // it is dragged; taking the delta from the grab angle means it never snaps to the
    // pointer when you grab the handle slightly off-centre.
    this.rotInteractable.onDragStart.add((e: DragInteractorEvent) => {
      if (!this.gestureAllowed()) return
      const a = this.pointerAngleDeg(e)
      if (a === null) return
      this.rotating = true
      this.rotStartAngle = a
      this.rotStartSticker = this.stickers[this.selected].rotDeg
    })
    this.rotInteractable.onDragUpdate.add((e: DragInteractorEvent) => {
      if (!this.rotating) return
      const a = this.pointerAngleDeg(e)
      if (a === null) return
      this.setStickerRotation(this.rotStartSticker + shortestDelta(a - this.rotStartAngle))
    })
    this.rotInteractable.onDragEnd.add(() => {
      this.rotating = false
    })
  }

  /** A gesture may start only on a selected sticker whose own panel is facing us. */
  private gestureAllowed(): boolean {
    const s = this.stickers[this.selected]
    return !!s && this.live[s.panel]
  }

  /**
   * Create hit slot `i` if it does not exist yet, and bind its handlers. Slot i always
   * addresses stickers[i]: the list is re-laid-out in full on every change, so a slot's
   * meaning stays "whatever is at that height in the stack" even after a delete shifts
   * everything down.
   */
  private ensureHitSlot(i: number): HitSlot {
    while (this.hitSlots.length <= i) {
      const idx = this.hitSlots.length
      // Transparent (no visual) box collider over the stamped sticker region. Parented to
      // the UNSCALED main root (the shirt prefab root carries a large fit scale —
      // parenting there would inflate colliders). Positioned + oriented every frame.
      const root = global.scene.createSceneObject("StickerHitRoot" + idx)
      root.setParent(this.root)
      const spin = global.scene.createSceneObject("StickerHitTarget" + idx)
      spin.setParent(root)
      const collider = spin.createComponent("Physics.ColliderComponent") as ColliderComponent
      collider.fitVisual = false // honour the explicit box size; never auto-fit to a visual
      const interactable = spin.createComponent(Interactable.getTypeName()) as Interactable
      interactable.targetingMode = 3 // Direct + Indirect, so mouse + hand both hit it
      // Pass 12: chrome, so it belongs to the UI layer and is never submitted to the
      // photo camera. Set here rather than in a sweep because the pool GROWS at runtime,
      // every time a sticker is placed beyond the prebuilt slots.
      setLayerDeep(root, LAYERS.ui)
      const slot: HitSlot = { root, spin, collider, interactable }
      this.hitSlots.push(slot)
      root.enabled = false // nothing to tap until a sticker occupies this slot

      // Tap this sticker → select it, which deselects whatever was selected before.
      interactable.onTriggerStart.add(() => {
        const s = this.stickers[idx]
        print("[TAP] sticker #" + idx + (s ? " on " + this.panels[s.panel].name + " live=" + this.live[s.panel] : " (empty slot)"))
        if (s && this.live[s.panel]) this.selectSticker(idx)
      })
      // FREE SURFACE DRAG: only for the SELECTED sticker. onTriggerStart above already
      // selected it on press, so select-then-drag in one gesture also works.
      interactable.onDragStart.add(() => {
        if (this.selected === idx && this.gestureAllowed()) this.dragging = true
      })
      interactable.onDragUpdate.add((e: DragInteractorEvent) => {
        if (!this.dragging || this.selected !== idx) return
        const origin = e.interactor.startPoint
        const dir = e.interactor.direction
        if (origin && dir) {
          this.dragToRay(origin, dir)
        } else {
          // Fallback for any interactor that publishes no ray: use its drag point.
          const hit = e.interactor.planecastPoint ?? e.interactor.targetHitPosition ?? null
          if (hit) this.dragToWorldPoint(hit)
        }
      })
      interactable.onDragEnd.add(() => {
        this.dragging = false // drop it here; stays selected
      })
    }
    return this.hitSlots[i]
  }

  // ---------------------------------------------------------------------------
  // Sticker geometry — everything derived from ONE physical size
  // ---------------------------------------------------------------------------

  /**
   * Pass 27: the panel's cm per uv comes from the cloth (frameAt at the rect centre), not
   * the table. The generator's area-weighted estimate is within 2% on the shirt and the
   * cap but read 64 cm/u on the socks' new leg chart, which is 55 by construction — a
   * sticker there would have been stamped 14% small. The table's meshPerU/V still serve
   * the generator's own rect geometry.
   */
  private cmPerU(panel: number): number {
    return this.panelFrame(panel).cmU
  }
  private cmPerV(panel: number): number {
    return this.panelFrame(panel).cmV
  }

  /** The sticker's side length on the cloth, in cm, at its EFFECTIVE scale. */
  private sideCm(s: PlacedSticker): number {
    return this.def.stickerSideCm * this.effScale(s)
  }
  private sideCmAt(scale: number): number {
    return this.def.stickerSideCm * scale
  }

  /**
   * The stamp a sticker WOULD produce on `panel` at `scale`, computed by exactly the
   * function the compositor stamps with. Everything that needs the sticker's rectangle —
   * the seam clamp, the maximum scale, the selection frame — goes through here, so there
   * is only ever one description of where the artwork is.
   */
  private stampOn(
    panel: number,
    u: number,
    v: number,
    rotDeg: number,
    scale: number,
    art?: StickerArt
  ): Stamp {
    const f = this.frameAt(panel, u, v) // Pass 26: the cloth's own frame at this spot
    return computeStampFor(
      u,
      v,
      this.def.stickerSideCm * scale,
      rotDeg,
      this.cmPerU(panel),
      this.cmPerV(panel),
      f.rotDeg,
      art ? art.wFrac : 1,
      art ? art.hFrac : 1,
      f.sigma
    )
  }

  /**
   * The rectangle this sticker's CENTRE may occupy on a given panel: the panel's clamp
   * rect inset by the sticker's own UV footprint on THAT panel. `ok` is false when the
   * footprint simply does not fit — which is how a big sticker is stopped from hopping
   * onto a sleeve.
   */
  private centreRect(panel: number, s: PlacedSticker): Rect {
    const p = this.panels[panel]
    // Pass 16: the footprint grows differently on the two cloth axes once the artwork
    // is not square, so the inset is per-axis. For a square (every built-in) both terms
    // collapse to the old side/2 x (|cos| + |sin|).
    const half = this.sideCmAt(this.effScaleOn(panel, s)) / 2
    const g = footprintGrowth2(s.rotDeg, s.art.wFrac, s.art.hFrac)
    const r: Rect = {
      halfRight: p.halfRightMesh * this.cmPerMesh - half * g.right,
      halfUp: p.halfUpMesh * this.cmPerMesh - half * g.up,
      ok: true,
    }
    r.ok = r.halfRight >= 0 && r.halfUp >= 0
    return r
  }

  /**
   * The largest scale `panel` can hold for this sticker at its current rotation. In the
   * cloth frame the sticker is simply a square of `side` cm turned by rotDeg, so its
   * axis-aligned footprint there is side x (|cos| + |sin|) on both axes and the panel's
   * atlas rotation plays no part.
   */
  private maxScaleOn(panel: number, s: PlacedSticker): number {
    const p = this.panels[panel]
    const g = footprintGrowth2(s.rotDeg, s.art.wFrac, s.art.hFrac)
    const halfRight = (this.def.stickerSideCm / 2) * g.right
    const halfUp = (this.def.stickerSideCm / 2) * g.up
    // Each cloth axis gives its own ceiling and the tighter one wins — a wide logo is
    // limited by the panel's width, a tall one by its height, and a square by whichever
    // is smaller, which is exactly what this computed before Pass 16.
    const byRight = halfRight < 1e-6 ? this.def.scaleMax : (p.halfRightMesh * this.cmPerMesh) / halfRight
    const byUp = halfUp < 1e-6 ? this.def.scaleMax : (p.halfUpMesh * this.cmPerMesh) / halfUp
    return Math.min(byRight, byUp)
  }

  /**
   * The scale actually used for stamping and clamping on a panel: the user's requested
   * scale, capped so the sticker STILL fits once its rotation has grown its footprint.
   * Keeping the request and the cap separate matters — turning a max-size sticker to 45
   * degrees shrinks it just enough to stay inside the seams, and turning it back to
   * upright restores the full size instead of losing it.
   */
  private effScaleOn(panel: number, s: PlacedSticker): number {
    return Math.max(this.def.scaleMin, Math.min(s.scale, this.maxScaleOn(panel, s)))
  }
  private effScale(s: PlacedSticker): number {
    return this.effScaleOn(s.panel, s)
  }

  /** Clamp a sticker's centre so its whole footprint stays inside its panel's rect. */
  private clampToPanel(s: PlacedSticker): void {
    const p = this.panels[s.panel]
    const r = this.centreRect(s.panel, s)
    if (!r.ok) {
      s.u = p.rectU
      s.v = p.rectV
      return
    }
    const d = this.uvToCm(s.panel, s.u - p.rectU, s.v - p.rectV)
    const back = this.cmToUv(s.panel, clamp(d.x, -r.halfRight, r.halfRight), clamp(d.y, -r.halfUp, r.halfUp))
    s.u = p.rectU + back.x
    s.v = p.rectV + back.y
  }

  /**
   * How far outside `panel`'s centre-rect a UV lands, in cm — zero when it is properly
   * inside. This is what ranks the panels during a drag.
   */
  private outsideRect(panel: number, uv: vec2, r: Rect): number {
    const p = this.panels[panel]
    const d = this.uvToCm(panel, uv.x - p.rectU, uv.y - p.rectV)
    const ox = Math.max(-r.halfRight - d.x, 0, d.x - r.halfRight)
    const oy = Math.max(-r.halfUp - d.y, 0, d.y - r.halfUp)
    return Math.sqrt(ox * ox + oy * oy)
  }

  /**
   * Set the selected sticker's uniform scale, clamped to [MIN, MAX] and to what its panel
   * can hold, then re-clamp its CENTRE so a sticker that grew near a seam is pushed back
   * inside rather than spilling over it.
   */
  private setStickerScale(v: number): void {
    const s = this.stickers[this.selected]
    if (!s) return
    s.scale = clamp(v, this.def.scaleMin, Math.min(this.def.scaleMax, this.maxScaleOn(s.panel, s)))
    this.clampToPanel(s)
    this.rebuild()
  }

  /**
   * Set the selected sticker's on-panel rotation in degrees (CCW, 0 = upright), with a
   * soft snap onto multiples of STICKER_SNAP_STEP_DEG so straight angles are easy to hit.
   */
  private setStickerRotation(deg: number): void {
    const s = this.stickers[this.selected]
    if (!s) return
    const step = STICKER_SNAP_STEP_DEG
    const nearest = Math.round(deg / step) * step
    s.rotDeg = Math.abs(deg - nearest) <= STICKER_SNAP_TOL_DEG ? nearest : deg
    this.clampToPanel(s)
    this.rebuild()
  }

  /**
   * Re-derive everything that depends on the sticker list, in one place: re-stamp the
   * WHOLE stack (so the bake is a complete redraw, never an accumulation), then re-size /
   * re-glue the tap targets and re-lay the frame on the new stamp.
   */
  private rebuild(): void {
    this.stampAll()
    this.refreshVisibility()
    this.applyWorldTransforms()
    if (this.selected >= 0) this.layoutSelection()
  }

  /**
   * Re-bake the entire placed stack, bottom to top — into each bake target its own
   * stickers, in list order, so draw order within a target is still list order.
   */
  private stampAll(): void {
    const targets = this.targetCount()
    const lists: StickerPlacement[][] = []
    for (let t = 0; t < targets; t++) lists.push([])
    this.stampMap = []
    for (const s of this.stickers) {
      const t = Math.min(this.panelTarget(s.panel), targets - 1)
      this.stampMap.push({ target: t, at: lists[t].length })
      lists[t].push({
        tex: s.art.tex,
        uc: s.u,
        vc: s.v,
        sideCm: this.sideCm(s),
        rotDeg: s.rotDeg,
        cmPerU: this.cmPerU(s.panel),
        cmPerV: this.cmPerV(s.panel),
        atlasRotDeg: this.frameAt(s.panel, s.u, s.v).rotDeg, // Pass 26: measured, not tabled
        wFrac: s.art.wFrac,
        hFrac: s.art.hFrac,
        mesh: s.art.mesh,
        sigma: this.frameAt(s.panel, s.u, s.v).sigma,
      })
    }
    for (let t = 0; t < targets; t++) this.bake(t).setStickers(lists[t])
  }

  /**
   * PASS 26 — DUPLICATE. A copy of the selected sticker: same artwork, size and turn, on
   * the same panel, DUP_OFFSET_CM right and down so it is visibly a second object, pulled
   * back by the same panel clamp every sticker obeys, and selected. From here on it is an
   * independent sticker: it drags, resizes, rotates, hops and deletes on its own.
   */
  duplicateSelected(): void {
    const src = this.stickers[this.selected]
    if (!src || !this.live[src.panel]) return
    const d = this.cmToUv(src.panel, DUP_OFFSET_CM, -DUP_OFFSET_CM)
    const copy: PlacedSticker = {
      art: src.art,
      panel: src.panel,
      u: src.u + d.x,
      v: src.v + d.y,
      scale: src.scale,
      rotDeg: src.rotDeg,
      text: src.text ? { text: src.text.text, font: src.text.font, color: src.text.color } : undefined, // Pass 28: its own copy
    }
    this.stickers.push(copy)
    this.clampToPanel(copy)
    this.ensureHitSlot(this.stickers.length - 1)
    this.selected = this.stickers.length - 1
    this.rebuild()
  }

  /** Verification entry point: the same call the duplicate chip makes. */
  debugDuplicate(): void {
    this.duplicateSelected()
  }

  // ---------------------------------------------------------------------------
  // Pass 28 — text
  // ---------------------------------------------------------------------------

  /**
   * The Add text button: a new TEXT object on the facing panel, saying TEXT_DEFAULT,
   * selected. It goes through placeArt — the same guard, home, cascade and selection a
   * tray tap gets — with a transparent stand-in for the two frames the render takes,
   * then its artwork arrives and it is re-stamped in place.
   */
  placeText(): number {
    const stand = this.baker.placeholderArt()
    const before = this.stickers.length
    this.placeArt(stand)
    if (this.stickers.length === before) return -1 // refused by the placement guard
    const s = this.stickers[this.stickers.length - 1]
    s.text = { text: TEXT_DEFAULT, font: TEXT_FONT_INIT, color: TEXT_COLOR_INIT }
    this.bakeText(s)
    return this.stickers.length - 1 // Pass 44: the owner focuses it (ScarfCustomizer.focusText)
  }

  /** The editor changed the selected text object: re-render it in place. */
  editSelectedText(patch: Partial<TextStyle>): void {
    const s = this.stickers[this.selected]
    if (!s || !s.text) return
    if (patch.text !== undefined) s.text.text = patch.text
    if (patch.font !== undefined) s.text.font = patch.font
    if (patch.color !== undefined) s.text.color = patch.color
    this.bakeText(s)
  }

  /** The selected object's text style when it is text AND its frame is on screen; else null. */
  selectedTextStyle(): TextStyle | null {
    const s = this.stickers[this.selected]
    if (!s || !s.text || !this.chromeVisible || !this.live[s.panel]) return null
    return s.text
  }

  /**
   * Render `s.text` and swap the result in. The sticker keeps its panel, uv, scale and
   * turn; only `art` changes, and the compositor and the frame follow it on the next
   * rebuild. If the garment has been switched away by the time the render lands, the
   * art is still swapped and the restore on switching back stamps it.
   */
  private bakeText(s: PlacedSticker): void {
    if (!s.text) return
    this.baker.render(s, s.text, (art) => {
      if (!art) return
      s.art = art
      if (this.stickers.indexOf(s) >= 0) {
        this.rebuild()
        if (this.selected >= 0) this.layoutSelection()
      }
    })
  }

  /**
   * PASS 27 VERIFICATION — THE SYNTHETIC DRAG SWEEP. Drags the SELECTED sticker along a
   * straight line on the named panel, `steps` equal steps from (u0,v0) to (u1,v1), each
   * step through the REAL drag path (a ray from the eye at the target, into dragToRay:
   * ray -> panel -> uv -> hop -> clamp). For every step the pointer's travel on the cloth
   * is compared with the sticker's: gain = sticker cm / pointer cm. A step is FREE when the
   * sticker follows (gain 0.6..1.5), DEAD when it stays put (gain < 0.25) and a JUMP when
   * it moves far more than the pointer (gain > 1.8, a hop landing elsewhere). Prints one
   * table row. Inert in shipped code.
   */
  debugSweep(panelName: string, u0: number, v0: number, u1: number, v1: number, steps: number, panel1Name?: string): void {
    if (this.selected < 0) { print("[SWEEP] nothing selected"); return }
    let panel = -1
    let panel1 = -1
    for (let i = 0; i < this.panels.length; i++) {
      if (this.panels[i].name === panelName) panel = i
      if (panel1Name && this.panels[i].name === panel1Name) panel1 = i
    }
    if (panel < 0) { print("[SWEEP] no panel named " + panelName); return }
    if (panel1Name && panel1 < 0) { print("[SWEEP] no panel named " + panel1Name); return }
    const s = this.stickers[this.selected]
    const eye = new vec3(0, 0, 0)
    // Put the sticker at the start of the line first, through the same path.
    const start = this.uvToWorld(panel, u0, v0)
    // Pass 39: with a second panel the path is a straight WORLD line from a point on the
    // first to a point on the second — the way a finger actually crosses from the shin
    // onto the instep — rather than one panel's uv extrapolated past its own island.
    const end = panel1 >= 0 ? this.uvToWorld(panel1, u1, v1) : null
    this.dragToRay(eye, start.sub(eye).normalize())
    let prevT = start
    let prevP = this.uvToWorld(s.panel, s.u, s.v)
    let free = 0, dead = 0, jump = 0, other = 0
    let gMin = Infinity, gMax = -Infinity
    let travel = 0, freeTravel = 0
    const hops: string[] = []
    let panelBefore = s.panel
    for (let k = 1; k <= steps; k++) {
      const t = k / steps
      const target = end
        ? new vec3(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t, start.z + (end.z - start.z) * t)
        : this.uvToWorld(panel, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t)
      this.dragToRay(eye, target.sub(eye).normalize())
      const P = this.uvToWorld(s.panel, s.u, s.v)
      const dT = target.sub(prevT).length
      const dP = P.sub(prevP).length
      const g = dT > 1e-6 ? dP / dT : 0
      travel += dT
      if (s.panel !== panelBefore) { hops.push(this.panels[panelBefore].name + ">" + this.panels[s.panel].name + "@" + k); panelBefore = s.panel }
      if (g < 0.25) dead++
      else if (g > 1.8) jump++
      else if (g >= 0.6 && g <= 1.5) { free++; freeTravel += dT; gMin = Math.min(gMin, g); gMax = Math.max(gMax, g) }
      else { other++; gMin = Math.min(gMin, g); gMax = Math.max(gMax, g) }
      prevT = target
      prevP = P
    }
    const resid = prevP.sub(prevT).length
    print(
      "[SWEEP] " + this.def.id + " " + panelName + " (" + u0.toFixed(2) + "," + v0.toFixed(2) + ")->" + (panel1Name ? panel1Name + " " : "") + "(" + u1.toFixed(2) + "," + v1.toFixed(2) + ")" +
      " steps=" + steps + " travel=" + travel.toFixed(1) + "cm | free=" + free + " partial=" + other + " dead=" + dead + " jump=" + jump +
      " | gain " + (gMin === Infinity ? "-" : gMin.toFixed(2) + ".." + gMax.toFixed(2)) +
      " | free-tracking " + (travel > 0 ? ((100 * freeTravel) / travel).toFixed(0) : "0") + "% of the path" +
      " | end residual " + resid.toFixed(2) + "cm" + (hops.length ? " | hops " + hops.join(" ") : "")
    )
  }

  /** One place that decides what is on screen: needs a sticker, on a facing panel. */
  private refreshVisibility(): void {
    for (let i = 0; i < this.hitSlots.length; i++) {
      const s = this.stickers[i]
      this.hitSlots[i].root.enabled = this.chromeVisible && !!s && this.live[s.panel]
    }
    const sel = this.stickers[this.selected]
    this.selRoot.enabled = this.chromeVisible && !!sel && this.live[sel.panel]
  }

  // ---------------------------------------------------------------------------
  // The surface drag (Pass 11 point 1)
  // ---------------------------------------------------------------------------

  /**
   * Move the selected sticker to wherever this ray meets the garment.
   *
   * Every LIVE panel is a candidate. The ray is intersected with each one's plane, the
   * hit is converted to that panel's uv through its own sampled mesh, and the panel is
   * scored by how far OUTSIDE its centre-rect that uv falls — zero if the pointer is
   * properly over it. The current panel gets PANEL_HOP_HYSTERESIS_CM of head start, so a
   * sticker resting on a seam stays put instead of flickering, and a hop happens only
   * once the pointer is unambiguously over the neighbour. Panels that cannot hold the
   * sticker's whole footprint are not candidates at all — which is exactly the "never
   * half-drawn" rule, and is why a big sticker will not step onto a sleeve.
   */
  private dragToRay(origin: vec3, dir: vec3): void {
    const s = this.stickers[this.selected]
    if (!s) return

    // Every live panel that can hold the footprint: where the ray lands on it, and how
    // far OUTSIDE its centre-rect that is (zero = the sticker fits there whole).
    const cand: { i: number; u: number; v: number; out: number; dist: number }[] = []
    let cur: { i: number; u: number; v: number; out: number; dist: number } | null = null
    for (let i = 0; i < this.panels.length; i++) {
      if (!this.live[i]) continue
      const r = this.centreRect(i, s)
      if (!r.ok) continue // the footprint does not fit on this panel at all
      const seedU = i === s.panel ? s.u : this.panels[i].homeU
      const seedV = i === s.panel ? s.v : this.panels[i].homeV
      const uv = this.rayToPanelUV(origin, dir, i, seedU, seedV)
      if (!uv) continue
      const c = { i: i, u: uv.x, v: uv.y, out: this.outsideRect(i, uv, r), dist: this.uvToWorld(i, uv.x, uv.y).sub(origin).length }
      cand.push(c)
      if (i === s.panel) cur = c
    }
    if (cand.length === 0) return

    // PASS 39 — THE HOP RULE: leave only when you must, and only for somewhere that will
    // have you whole.
    //
    // The old rule scored every panel by how far outside its rect the pointer was, gave
    // the current panel PANEL_HOP_HYSTERESIS_CM of head start, and took the lowest. That
    // is what produced the stall-then-lurch the user feels at every seam: once the pointer
    // leaves the current rect the sticker is clamped at the edge (the stall) and stays
    // there until the neighbour's score beats current-minus-hysteresis (the lurch), by
    // which time the pointer is a full hysteresis past the seam. It also let a sticker
    // hop by PROXIMITY onto a panel the pointer was not over at all — measured on the
    // socks: a drag down the left shin flickered onto the RIGHT sock's foot for a step,
    // because that small panel happened to be the least-outside of a bad set.
    //
    //   1. Still inside the current rect: stay. Nothing else is consulted.
    //   2. Otherwise, any panel the pointer is PROPERLY over (out == 0) may take it, and
    //      the one nearest the eye does — the surface the ray actually touches first. The
    //      hop is instant: the frame the pointer is over the neighbour, the sticker is on
    //      it. A hop back is just as instant, and there is no flicker in between, because
    //      a hop needs the pointer to be inside the destination and outside the origin,
    //      and it cannot be both inside and outside the same rect.
    //   3. Nobody has it whole (a seam's gap, a fold, or off the cloth): the old scoring,
    //      with the old hysteresis — but ONLY among panels of the sticker's own bake
    //      target. Sliding along one sock's seams by proximity is what makes its folds
    //      passable; landing on the OTHER sock takes pointing at it (rule 2).
    let best: { i: number; u: number; v: number; out: number; dist: number } | null = null
    if (!HOP_RULE_PASS39) {
      // The Pass-11 rule, kept whole behind the switch.
      let bestScore = Infinity
      for (const c of cand) {
        const score = c.out - (c.i === s.panel ? PANEL_HOP_HYSTERESIS_CM : 0)
        if (score < bestScore) { bestScore = score; best = c }
      }
    } else if (cur && cur.out <= 0) {
      best = cur
    } else {
      for (const c of cand) {
        if (c.out > 0) continue
        if (!best || c.dist < best.dist) best = c
      }
      if (!best) {
        const ownTarget = this.panelTarget(s.panel)
        let bestScore = Infinity
        for (const c of cand) {
          if (this.panelTarget(c.i) !== ownTarget) continue
          const score = c.out - (c.i === s.panel ? PANEL_HOP_HYSTERESIS_CM : 0)
          if (score < bestScore) { bestScore = score; best = c }
        }
      }
    }
    if (!best) return

    s.panel = best.i
    s.u = best.u
    s.v = best.v
    this.clampToPanel(s)
    this.rebuild()
  }

  // ---------------------------------------------------------------------------
  // Paint (Pass 17)
  // ---------------------------------------------------------------------------

  /** This garment's printable regions. */
  private get panels(): Panel[] {
    return this.def.panels
  }

  /**
   * Mesh space -> the garment prefab root's local frame, for THIS garment.
   *
   * Was a single constant (UV_MAP.innerScale = 0.01, the shirt's importer's metres-to-
   * centimetres node) until Pass 18 found that the cap's importer inserted no such node
   * and its factor is 1. Every mesh<->world conversion below reads it from the garment
   * definition, so the difference is a number in Garments.ts rather than a branch here.
   */
  private get meshToLocal(): number {
    return this.def.fit.meshToLocal
  }

  /** The persistent paint texture's owner, for the compositor and the palette UI. */
  getPaintLayer(): PaintLayer {
    return this.paint
  }

  /** Every paint layer of the current garment — one per bake target (Pass 23). */
  getPaintLayers(): PaintLayer[] {
    return this.paints
  }

  /** Upload whatever was painted this frame, on every layer. Once per frame. */
  flushPaint(): void {
    for (const p of this.paints) p.flush()
  }

  /**
   * Switch between placing stickers and painting.
   *
   * THE TWO MODES ARE SEPARATED PHYSICALLY, NOT BY A FLAG.
   *
   * The obvious implementation is `if (paintMode) return` at the top of every sticker
   * handler — which means every future handler must remember to do it, and the one that
   * forgets produces a sticker that grabs mid-brushstroke. Instead paint mode enables a
   * COLLIDER that sits between the eye and the garment, covering the shirt but not the
   * controls. The SIK interactor targets the nearest thing its ray hits, so while that
   * plane is enabled the sticker hit slots and the deselect backdrop are simply not
   * reachable: they receive no events because nothing is pointing at them. Turning paint
   * off disables the plane and every sticker interaction is exactly what it was.
   *
   * The selection frame is also hidden while painting, because a frame you cannot grab
   * is a lie. `selected` is not touched, so switching back restores the same selection.
   */
  setPaintMode(on: boolean): void {
    this.setTool(on ? "paint" : "colour")
  }

  /**
   * Pass 29: the tool is one of three. Paint and Gems both use the capture plane — the
   * same plane, the same fit — and both hide the sticker chrome, because a sticker you
   * cannot grab while sowing stones is not a trap but a frame you cannot grab is a lie.
   */
  setTool(tool: string): void {
    const paint = tool === "paint"
    const gems = tool === "gems"
    if (this.paintMode === paint && this.gemMode === gems) return
    this.paintMode = paint
    this.gemMode = gems
    this.paintObj.enabled = paint || gems
    this.painting = false
    this.gemStroke = false
    for (const p of this.paints) p.endStroke()
    this.chromeVisible = !paint && !gems
    this.refreshVisibility()
  }

  // ---------------------------------------------------------------------------
  // Pass 29 — gems
  // ---------------------------------------------------------------------------

  setGemStyle(shape: number, color: number, sizeCm: number): void {
    this.gemShape = shape
    this.gemColor = color
    this.gemSizeCm = sizeCm
  }

  undoGems(): void { this.gems.undo(); print("[GEMS] undo -> " + this.gems.count() + " stones on " + this.def.id) }
  clearGems(): void { this.gems.clear(); print("[GEMS] clear -> " + this.gems.count() + " stones on " + this.def.id) }
  gemCount(): number { return this.gems.count() }

  /**
   * One stone at this panel uv — the tap, and every drop along a trail. The stone takes a
   * random turn about the surface normal and a size jittered around the chosen one, which
   * is what keeps a scatter from reading as clones on a grid. `force` is the tap; a trail
   * drops only once the pointer has moved GEM_TRAIL_SPACING_K stone-widths on the cloth.
   */
  private gemAt(panel: number, u: number, v: number, force: boolean): void {
    const size = this.gemSizeCm * (1 + (Math.random() * 2 - 1) * GEM_SIZE_JITTER)
    const world = this.uvToWorld(panel, u, v)
    if (!force && this.gemLastWorld && world.sub(this.gemLastWorld).length < this.gemSizeCm * GEM_TRAIL_SPACING_K) return
    const vis = this.controller.getVisual()
    if (!vis) return
    const m = panelUvToMesh(this.panels[panel], this.def.panelGrid, u, v)
    const n = this.meshNormal(panel, u, v)
    const worldScale = vis.getTransform().getWorldScale().x || 1
    const shape: GemShape = this.gemShape === GEM_SHAPE_MIX
      ? GEM_SHAPES[Math.floor(Math.random() * GEM_SHAPES.length)]
      : GEM_SHAPES[Math.max(0, Math.min(GEM_SHAPES.length - 1, this.gemShape))]
    // Pass 41: a picked colour arrives as a batch KEY (>= GEM_COLOR_CUSTOM_BASE) and is placed
    // as it is; Mix still draws from the TEN tones only — a picked colour is not in the mix
    // (see GemUI, "Mix leaves it alone").
    const color = this.gemColor === GEM_COLOR_MIX
      ? Math.floor(Math.random() * GEM_COLORS.length)
      : (this.gemColor >= GEM_COLOR_CUSTOM_BASE && isGemColorKey(this.gemColor))
        ? this.gemColor
        : Math.max(0, Math.min(GEM_COLORS.length - 1, this.gemColor))
    const ok = this.gems.place({
      pos: new vec3(m.x * this.meshToLocal, m.y * this.meshToLocal, m.z * this.meshToLocal),
      normal: n,
      size: size / worldScale,
      lift: GEM_LIFT_CM / worldScale,
      rot: Math.random() * Math.PI * 2,
      shape,
      color,
    })
    if (!ok) {
      this.hint.show(GEM_LIMIT_WORD, "Undo or clear some to add more")
      return
    }
    this.gemLastWorld = world
  }

  /** The gem under this ray, if the ray meets cloth with room for it: like paintPointFor. */
  private gemPointFor(origin: vec3, dir: vec3): { panel: number; u: number; v: number } | null {
    const r = (this.gemSizeCm * (1 + GEM_SIZE_JITTER)) / 2
    const hit = this.surfaceHit(origin, dir, r)
    return hit // null: off the cloth, or in a seam — no stone
  }

  /**
   * PASS 29 — where a ray meets SAMPLED CLOTH with `inset` cm of room around the point.
   *
   * Two rules paintPointFor lacked, found by the first gem scatter: a stone floated beside
   * a sleeve. (1) The solver may settle on a uv just OUTSIDE a panel's sampled grid, in
   * the slack it allows itself; the mesh position there is an extrapolation into thin air,
   * and the grown clamp rect (it overlaps the neighbour by a sticker width) still accepted
   * it. A hit must lie inside the grid it was solved on. (2) Among panels that all accept
   * the ray, the one whose surface point is NEAREST the eye is the one the ray actually
   * touches; the old "first panel with a perfect score" was the list order.
   */
  private surfaceHit(origin: vec3, dir: vec3, inset: number): { panel: number; u: number; v: number } | null {
    let best: { panel: number; u: number; v: number } | null = null
    let bestDist = Infinity
    for (let i = 0; i < this.panels.length; i++) {
      if (!this.live[i]) continue
      if (!this.placeable(i)) continue // Pass 39: a dab or a stone lands on the selected sock only
      const p = this.panels[i]
      const halfRight = p.halfRightMesh * this.cmPerMesh - inset
      const halfUp = p.halfUpMesh * this.cmPerMesh - inset
      if (halfRight <= 0 || halfUp <= 0) continue
      const uv = this.rayToPanelUV(origin, dir, i, p.homeU, p.homeV)
      if (!uv) continue
      if (uv.x < p.gridU0 || uv.x > p.gridU1 || uv.y < p.gridV0 || uv.y > p.gridV1) continue // off the sampled cloth
      const d = this.uvToCm(i, uv.x - p.rectU, uv.y - p.rectV)
      if (Math.abs(d.x) > halfRight + 1e-4 || Math.abs(d.y) > halfUp + 1e-4) continue // in a seam
      const dist = this.uvToWorld(i, uv.x, uv.y).sub(origin).length
      if (dist < bestDist) { bestDist = dist; best = { panel: i, u: uv.x, v: uv.y } }
    }
    return best
  }

  /** The cloth's outward normal at a panel uv, in MESH space (localNormal, unrotated). */
  private meshNormal(panel: number, u: number, v: number): vec3 {
    const p = this.panels[panel]
    const h = 1e-3
    const a = panelUvToMesh(p, this.def.panelGrid, u - h, v)
    const b = panelUvToMesh(p, this.def.panelGrid, u + h, v)
    const c = panelUvToMesh(p, this.def.panelGrid, u, v - h)
    const d = panelUvToMesh(p, this.def.panelGrid, u, v + h)
    const du = new vec3(b.x - a.x, b.y - a.y, b.z - a.z)
    const dv = new vec3(d.x - c.x, d.y - c.y, d.z - c.z)
    let n = du.cross(dv)
    if (n.length < 1e-9) return new vec3(p.nx, p.ny, p.nz)
    n = n.normalize()
    if (n.x * p.nx + n.y * p.ny + n.z * p.nz < 0) n = n.uniformScale(-1)
    return n
  }

  /** Verification entry points: a tap and a trail, through the real placement path. */
  debugGemTap(panel: number, u: number, v: number): void {
    this.gems.beginStroke()
    this.gemLastWorld = null
    this.gemAt(panel, u, v, true)
    this.gems.endStroke()
  }
  debugGemTrail(panel: number, u0: number, v0: number, u1: number, v1: number, steps: number): void {
    this.gems.beginStroke()
    this.gemLastWorld = null
    let placed = 0
    let skipped = 0
    let missed = 0
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const target = this.uvToWorld(panel, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t)
      const pt = this.gemPointFor(new vec3(0, 0, 0), target.normalize())
      if (pt) {
        const before = this.gems.count()
        this.gemAt(pt.panel, pt.u, pt.v, k === 0)
        if (this.gems.count() > before) placed++
        else skipped++
      } else {
        missed++
      }
    }
    this.gems.endStroke()
    print("[GEMS] trail: " + this.gems.count() + " stones on " + this.def.id + " (placed " + placed + ", spacing-skipped " + skipped + ", off-cloth " + missed + " of " + (steps + 1) + ")")
  }

  isPaintMode(): boolean {
    return this.paintMode
  }

  /**
   * Verification entry point (Pass 17): paint a stroke from (u0,v0) to (u1,v1) on
   * `panel`, sampled `samples` times.
   *
   * Every sample goes through paintAtRay — a synthetic ray from the camera aimed at that
   * UV, pushed into the SAME ray -> panel -> uv -> clamp path a real drag uses — so a
   * capture shows the real projection and the real seam behaviour, not a shortcut that
   * writes texels directly. A LOW `samples` over a long distance is the interesting case:
   * it is what a fast drag on a slow frame looks like, and the stroke should still come
   * out continuous because PaintLayer subdivides between the samples it is given.
   */
  debugPaintStroke(panel: number, u0: number, v0: number, u1: number, v1: number, samples: number): void {
    const n = Math.max(2, samples)
    for (const p of this.paints) p.beginStroke()
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const u = u0 + (u1 - u0) * t
      const v = v0 + (v1 - v0) * t
      const target = this.uvToWorld(panel, u, v)
      const dir = target.sub(new vec3(0, 0, 0))
      if (dir.length < 1e-4) continue
      this.paintAtRay(new vec3(0, 0, 0), dir.normalize())
    }
    for (const p of this.paints) p.endStroke()
    print("[PAINT] stroke on " + this.panels[panel].name + " samples=" + n + " hasPaint=" +
      this.paints[this.panelTarget(panel)].hasPaint())
  }

  /** Wipe every stroke. The fabric colour and the stickers are untouched. */
  clearPaint(): void {
    for (const p of this.paints) p.clear()
  }

  /**
   * Where a pointer ray should paint, or null if it is not over any paintable panel.
   *
   * The same ray -> panel -> uv projection the sticker drag uses, scored the same way,
   * with one deliberate difference: a point that falls OUTSIDE the chosen panel's rect is
   * REJECTED rather than clamped. Clamping is right for a sticker — it slides along the
   * seam and stays whole — but for paint it would smear a stripe down the seam every time
   * the pointer wandered off the cloth. Rejecting means the stroke simply stops at the
   * edge of the panel, which is what a brush running off a surface does.
   */
  private paintPointFor(origin: vec3, dir: vec3): { panel: number; u: number; v: number } | null {
    // Pass 29: the same surface test the gems use — inside the sampled grid, inside the
    // rect by the brush radius, nearest panel along the ray. See surfaceHit.
    return this.surfaceHit(origin, dir, this.paint.getRadiusCm())
  }

  /** Pass 33: the text object under this ray, if the ray lands inside one; else -1. */
  private textIndexAtRay(origin: vec3, dir: vec3): number {
    const hit = this.surfaceHit(origin, dir, 0)
    if (!hit) return -1
    for (let i = 0; i < this.stickers.length; i++) {
      const s = this.stickers[i]
      if (!s || !s.text || s.panel !== hit.panel || !this.live[s.panel]) continue
      const d = this.uvToCm(hit.panel, hit.u - s.u, hit.v - s.v)
      const a = (-s.rotDeg * Math.PI) / 180
      const dx = d.x * Math.cos(a) - d.y * Math.sin(a)
      const dy = d.x * Math.sin(a) + d.y * Math.cos(a)
      const half = this.sideCm(s) / 2
      if (Math.abs(dx) <= half * s.art.wFrac && Math.abs(dy) <= half * s.art.hFrac) return i
    }
    return -1
  }

  /** Pass 33: true when the tap was handed off to the owner (a text object was under it). */
  private handOffTextTap(origin: vec3, dir: vec3): boolean {
    if (!this.onTextUnderTool) return false
    const i = this.textIndexAtRay(origin, dir)
    if (i < 0) return false
    print("[TEXT] tapped under " + (this.gemMode ? "gems" : "paint") + " -> selecting #" + i)
    this.onTextUnderTool(i)
    return true
  }

  /** Verification: a tap on the paint plane at a panel uv, through the same hand-off. */
  debugTapUnderTool(panel: number, u: number, v: number): void {
    const target = this.uvToWorld(panel, u, v)
    const dir = target.sub(new vec3(0, 0, 0))
    if (dir.length < 1e-4) return
    if (!this.handOffTextTap(new vec3(0, 0, 0), dir.normalize())) {
      const hit = this.surfaceHit(new vec3(0, 0, 0), dir.normalize(), 0)
      let who = ""
      for (let i = 0; i < this.stickers.length; i++) {
        const s = this.stickers[i]
        if (s && s.text) who += " #" + i + "(p" + s.panel + " " + s.u.toFixed(3) + "," + s.v.toFixed(3) + " side " + this.sideCm(s).toFixed(1) + " frac " + s.art.wFrac.toFixed(2) + "x" + s.art.hFrac.toFixed(2) + ")"
      }
      print("[TEXT] tap at " + u.toFixed(2) + "," + v.toFixed(2) + " found no text; hit=" + (hit ? "p" + hit.panel + " " + hit.u.toFixed(3) + "," + hit.v.toFixed(3) : "none") + " texts:" + who)
    }
  }

  /** Stamp one pointer sample. Interpolation to the previous one happens in PaintLayer. */
  private paintAtRay(origin: vec3, dir: vec3): void {
    const pt = this.paintPointFor(origin, dir)
    if (!pt) return
    // Pass 23: the dab goes into the layer of the panel's own bake target. A stroke that
    // crosses from one sock to the other simply continues on the other layer — each
    // layer joins the dabs it is given, and a first dab on a layer has nothing to join.
    this.paint = this.paints[Math.min(this.panelTarget(pt.panel), this.paints.length - 1)]
    this.paint.addPoint(pt.u, pt.v, this.cmPerU(pt.panel), this.cmPerV(pt.panel))
  }

  /** Pull a ray out of an interactor event, however that interactor publishes one. */
  private rayFromEvent(e: any): { origin: vec3; dir: vec3 } | null {
    const it = e && e.interactor ? e.interactor : null
    if (!it) return null
    const origin = it.startPoint
    const dir = it.direction
    if (origin && dir) return { origin: origin, dir: dir }
    const hit = it.planecastPoint ?? it.targetHitPosition ?? null
    if (!hit) return null
    const o = new vec3(0, 0, 0)
    const d = hit.sub(o)
    if (d.length < 1e-4) return null
    return { origin: o, dir: d.normalize() }
  }

  /**
   * The plane that captures paint gestures.
   *
   * It sits between the eye and the garment and is sized to cover the shirt and NOTHING
   * ELSE — the colour slider at x -21, the sticker tray at x +21, the platform at y -19
   * and the buttons under both panels all fall outside it, so the palette stays usable
   * while painting. Disabled at boot and whenever the tool is Colour.
   */
  private buildPaintCapture(): void {
    this.paintObj = global.scene.createSceneObject("PaintCapturePlane")
    this.paintObj.setParent(this.root)
    this.paintObj.getTransform().setLocalPosition(PAINT_PLANE_POS)
    const collider = this.paintObj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = PAINT_PLANE_SIZE
    collider.shape = shape
    collider.fitVisual = false
    this.paintCollider = collider
    this.paintInteractable = this.paintObj.createComponent(Interactable.getTypeName()) as Interactable
    this.paintInteractable.targetingMode = 3 // Direct + Indirect, so mouse + hand both hit it
    setLayerDeep(this.paintObj, LAYERS.ui) // chrome: never in the photo
    this.paintObj.enabled = false
  }

  /**
   * PASS 25 — size the paint plane to THIS garment and nothing else.
   *
   * The plane is a box between the eye and the garment, so what it shadows is not its own
   * footprint but its projection from the eye onto the controls' depth. It is therefore
   * sized from the garment's live world bounding box (every RenderMeshVisual under the
   * visual, measured after updateIdle has written the pose): wide enough for the garment
   * at ANY yaw (the larger of its width and depth), PAINT_PLANE_PAD past it, PAINT_PLANE_LIFT
   * in front of its nearest point — and then clamped so its shadow at PAINT_UI_DEPTH stays
   * inside PAINT_SHADOW_LIMIT, the innermost edge any control's hit box reaches. A garment
   * that outgrows that box loses paint at its very edge rather than shadowing a control.
   * Runs once per garment (paintPlaneDirty), and prints what it chose.
   */
  private fitPaintPlane(): void {
    this.paintPlaneDirty = false
    const vis = this.controller.getVisual()
    if (!vis || !this.paintObj) return
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9
    let n = 0
    const walk = (o: SceneObject): void => {
      const comps = o.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
      for (const c of comps) {
        const a = c.worldAabbMin()
        const b = c.worldAabbMax()
        if (!a || !b) continue
        minX = Math.min(minX, a.x); minY = Math.min(minY, a.y); minZ = Math.min(minZ, a.z)
        maxX = Math.max(maxX, b.x); maxY = Math.max(maxY, b.y); maxZ = Math.max(maxZ, b.z)
        n++
      }
      for (let i = 0; i < o.getChildrenCount(); i++) walk(o.getChild(i))
    }
    walk(vis)
    if (n === 0) return
    const gx = (minX + maxX) / 2
    const gz = (minZ + maxZ) / 2
    const halfXY = Math.max(maxX - minX, maxZ - minZ) / 2 // covers the garment turned to any yaw
    // In front of the nearest point the garment can reach at any yaw.
    const z = Math.max(maxZ, gz + halfXY) + PAINT_PLANE_LIFT
    // The shadow rule: from the eye at the origin, a point at (x, z) lands at x * D / |z|
    // on the controls' plane, and the box's near face is the one that casts furthest. Each
    // EDGE is clamped on its own, so a garment resting low on the turntable keeps its full
    // cover at the top and gives up only what would reach the rotation bar.
    const near = Math.max(1, -z - PAINT_PLANE_SIZE.z / 2)
    const k = near / PAINT_UI_DEPTH
    const limX = PAINT_SHADOW_LIMIT.x * k
    const limY = PAINT_SHADOW_LIMIT.y * k
    const limTop = PAINT_SHADOW_TOP * k // Pass 45: the top edge has its own limit
    const x0 = Math.max(gx - halfXY - PAINT_PLANE_PAD, -limX)
    const x1 = Math.min(gx + halfXY + PAINT_PLANE_PAD, limX)
    const y0 = Math.max(minY - PAINT_PLANE_PAD, -limY)
    const y1 = Math.min(maxY + PAINT_PLANE_PAD, limTop)
    const clampedW = gx - halfXY - PAINT_PLANE_PAD < -limX || gx + halfXY + PAINT_PLANE_PAD > limX
    const clampedH = minY - PAINT_PLANE_PAD < -limY || maxY + PAINT_PLANE_PAD > limTop
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const halfW = (x1 - x0) / 2
    const halfH = (y1 - y0) / 2
    this.paintObj.getTransform().setWorldPosition(new vec3(cx, cy, z))
    const shape = Shape.createBoxShape()
    shape.size = new vec3(2 * halfW, 2 * halfH, PAINT_PLANE_SIZE.z)
    this.paintCollider.shape = shape
    print(
      "[PAINT-PLANE] " + this.def.id + ": garment box x[" + minX.toFixed(1) + "," + maxX.toFixed(1) + "] y[" +
      minY.toFixed(1) + "," + maxY.toFixed(1) + "] z[" + minZ.toFixed(1) + "," + maxZ.toFixed(1) + "]" +
      " -> plane " + (2 * halfW).toFixed(1) + " x " + (2 * halfH).toFixed(1) + " at (" + cx.toFixed(1) + "," +
      cy.toFixed(1) + "," + z.toFixed(1) + "), shadow at UI depth +/-(" + (halfW / k).toFixed(1) + "," +
      (halfH / k).toFixed(1) + ")" + (clampedW ? " [w clamped]" : "") + (clampedH ? " [h clamped]" : "")
    )
  }

  /** Bind the paint gestures. Called from init(), where SIK subscriptions must live. */
  private bindPaintInteractions(): void {
    // A tap paints a single dab, so a dot is possible; a drag paints a stroke.
    // Pass 29: in Gems mode the same plane sows stones — a tap drops one, a drag a trail.
    this.paintInteractable.onTriggerStart.add((e: any) => {
      const r = this.rayFromEvent(e)
      if (!r) return
      if (this.handOffTextTap(r.origin, r.dir)) return // Pass 33
      if (this.gemMode) {
        this.gems.beginStroke()
        this.gemStroke = true
        this.gemLastWorld = null
        const pt = this.gemPointFor(r.origin, r.dir)
        if (pt) this.gemAt(pt.panel, pt.u, pt.v, true)
        return
      }
      for (const p of this.paints) p.beginStroke()
      this.paintAtRay(r.origin, r.dir)
    })
    this.paintInteractable.onDragStart.add((e: any) => {
      if (this.gemMode) return
      this.painting = true
      const r = this.rayFromEvent(e)
      if (r) this.paintAtRay(r.origin, r.dir)
    })
    this.paintInteractable.onDragUpdate.add((e: any) => {
      if (this.gemMode) {
        if (!this.gemStroke) return
        const r = this.rayFromEvent(e)
        if (!r) return
        const pt = this.gemPointFor(r.origin, r.dir)
        if (pt) this.gemAt(pt.panel, pt.u, pt.v, false)
        return
      }
      if (!this.painting) return
      const r = this.rayFromEvent(e)
      if (r) this.paintAtRay(r.origin, r.dir)
    })
    this.paintInteractable.onDragEnd.add(() => {
      if (this.gemStroke) { this.gemStroke = false; this.gems.endStroke() }
      this.painting = false
      for (const p of this.paints) p.endStroke()
    })
    this.paintInteractable.onTriggerEnd.add(() => {
      if (this.gemStroke) { this.gemStroke = false; this.gems.endStroke() }
      this.painting = false
      for (const p of this.paints) p.endStroke()
    })
  }

  /** Fallback drag for an interactor with no ray: aim from the camera at its hit point. */
  private dragToWorldPoint(wp: vec3): void {
    const origin = new vec3(0, 0, 0)
    const dir = wp.sub(origin)
    if (dir.length < 1e-4) return
    this.dragToRay(origin, dir.normalize())
  }

  /**
   * Where a world ray meets a panel, in that panel's uv.
   *
   * The panel's plane is taken through a reference point ON it (the sticker's own
   * position when it is the panel we are already on, otherwise the panel's home) with the
   * panel's live world normal, so the platform's yaw, the fit scale and the idle bob are
   * all folded in — this is the Pass-8 live-matrix projection, now per panel. Two passes:
   * the second re-anchors the plane at the first hit, which takes most of the cloth's
   * curvature out of the answer.
   */
  private rayToPanelUV(origin: vec3, dir: vec3, panel: number, seedU: number, seedV: number): vec2 | null {
    const p = this.panels[panel]
    // Stay near the grid's domain: a pass that overshoots is pulled back (plus a little)
    // so the next tangent plane is still taken on real cloth.
    const mu = (p.gridU1 - p.gridU0) * RAY_DOMAIN_SLACK
    const mv = (p.gridV1 - p.gridV0) * RAY_DOMAIN_SLACK
    let u = seedU
    let v = seedV
    for (let pass = 0; pass < RAY_PASSES; pass++) {
      const planePt = this.uvToWorld(panel, u, v)
      const n = this.localNormal(panel, u, v)
      const denom = n.dot(dir)
      if (Math.abs(denom) < 1e-5) return null // ray parallel to the cloth here
      const t = n.dot(planePt.sub(origin)) / denom
      if (t <= 0) return null // the surface is behind the ray origin
      const uv = this.worldToUV(panel, origin.add(dir.uniformScale(t)), u, v)
      const nu = clamp(uv.x, p.gridU0 - mu, p.gridU1 + mu)
      const nv = clamp(uv.y, p.gridV0 - mv, p.gridV1 + mv)
      // How far this pass moved, in CENTIMETRES of cloth — the unit RAY_SETTLE_CM is in,
      // and the only one in which "still moving" means the same thing on every panel.
      const movedCm =
        Math.abs(nu - u) * this.cmPerU(panel) + Math.abs(nv - v) * this.cmPerV(panel)
      u = nu
      v = nv
      if (movedCm < 1e-3) break
      // Out of passes and still moving: the iteration has not found the cloth here.
      // See RAY_SETTLE_CM — an unsettled answer is worse than no answer.
      if (pass === RAY_PASSES - 1 && movedCm > RAY_SETTLE_CM) return null
    }
    return new vec2(u, v)
  }

  /**
   * The cloth's own outward normal at a point on a panel, in world space.
   *
   * The panel-average normal is the right thing for deciding which panel faces the
   * camera, but it is the wrong thing to intersect a pointer ray with: a torso panel
   * curves through the better part of a right angle from sternum to flank, so a single
   * plane through the panel's mean orientation can put the hit a third of the way across
   * the chest once the shirt is turned. Taking the tangent plane WHERE THE POINTER IS,
   * from the sampled mesh's own derivatives, turns the plane cast into a fixed-point
   * iteration that converges on the real surface instead.
   */
  private localNormal(panel: number, u: number, v: number): vec3 {
    const p = this.panels[panel]
    const h = 1e-3
    const a = panelUvToMesh(p, this.def.panelGrid, u - h, v)
    const b = panelUvToMesh(p, this.def.panelGrid, u + h, v)
    const c = panelUvToMesh(p, this.def.panelGrid, u, v - h)
    const d = panelUvToMesh(p, this.def.panelGrid, u, v + h)
    const du = new vec3(b.x - a.x, b.y - a.y, b.z - a.z)
    const dv = new vec3(d.x - c.x, d.y - c.y, d.z - c.z)
    let n = du.cross(dv)
    if (n.length < 1e-9) return this.panelNormal(panel)
    n = n.normalize()
    // The cross product's sign depends on the island's winding; orient it outward by
    // agreeing with the panel's own average normal.
    if (n.x * p.nx + n.y * p.ny + n.z * p.nz < 0) n = n.uniformScale(-1)
    return this.controller.getWorldRotation().multiplyVec3(n).normalize()
  }

  /**
   * The pointer's bearing from the selected sticker's centre, in degrees CCW as seen on
   * its panel, 0 = to the right. The UV delta is converted to CM in the panel's own
   * (right, up) frame first — taking atan2 straight off raw UV would skew the angle on an
   * anisotropic atlas and be plain wrong on a sleeve, whose unwrap is turned.
   */
  private pointerAngleDeg(e: DragInteractorEvent): number | null {
    const s = this.stickers[this.selected]
    if (!s) return null
    const uv = this.pointerPanelUV(e, s)
    if (!uv) return null
    const d = this.uvToCm(s.panel, uv.x - s.u, uv.y - s.v)
    if (Math.abs(d.x) < 1e-4 && Math.abs(d.y) < 1e-4) return null
    return (Math.atan2(d.y, d.x) * 180) / Math.PI
  }

  /**
   * The pointer's distance from the selected sticker's centre, in units of its UNSCALED
   * half-side (1.0 = exactly on the un-scaled footprint's edge). Taking the max of the
   * two axis ratios means the value tracks whichever edge the corner handle is nearest,
   * which is what makes a corner drag feel like it is dragging that corner.
   */
  private footprintDistance(e: DragInteractorEvent): number | null {
    const s = this.stickers[this.selected]
    if (!s) return null
    const uv = this.pointerPanelUV(e, s)
    if (!uv) return null
    const d = this.uvToCm(s.panel, uv.x - s.u, uv.y - s.v)
    return Math.max(Math.abs(d.x), Math.abs(d.y)) / (this.def.stickerSideCm / 2)
  }

  /** Where this interactor is pointing, on the sticker's OWN panel. */
  private pointerPanelUV(e: DragInteractorEvent, s: PlacedSticker): vec2 | null {
    const origin = e.interactor.startPoint
    const dir = e.interactor.direction
    if (origin && dir) return this.rayToPanelUV(origin, dir, s.panel, s.u, s.v)
    const hit = e.interactor.planecastPoint ?? e.interactor.targetHitPosition ?? null
    return hit ? this.worldToUV(s.panel, hit, s.u, s.v) : null
  }

  // ---------------------------------------------------------------------------
  // Per-panel coordinate conversions
  // ---------------------------------------------------------------------------

  /**
   * A UV delta on a panel → centimetres in that panel's (right, up) frame.
   *
   * The cloth-to-atlas map for a panel is  diag(-1/cmPerU, 1/cmPerV) . R(atlasRot)
   * (see computeStampFor — the negative is the atlas mirror, since increasing u runs to
   * the viewer's LEFT on every panel of this shirt). This is that map inverted.
   */
  private uvToCm(panel: number, du: number, dv: number): vec2 {
    const f = this.panelFrame(panel) // Pass 26: measured frame, with its handedness
    const a = (f.rotDeg * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const x = f.sigma * du * this.cmPerU(panel)
    const y = dv * this.cmPerV(panel)
    return new vec2(cos * x + sin * y, -sin * x + cos * y)
  }

  /** Centimetres in a panel's (right, up) frame → a UV delta on it. Inverse of uvToCm. */
  private cmToUv(panel: number, right: number, up: number): vec2 {
    const f = this.panelFrame(panel)
    const a = (f.rotDeg * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    return new vec2(
      (f.sigma * (right * cos - up * sin)) / this.cmPerU(panel),
      (right * sin + up * cos) / this.cmPerV(panel)
    )
  }

  /** Panel UV → world, through the panel's sampled mesh and the shirt's live transform. */
  private uvToWorld(panel: number, u: number, v: number): vec3 {
    const m = panelUvToMesh(this.panels[panel], this.def.panelGrid, u, v)
    const tf = this.uvProbe.getTransform()
    // The probe is a child of the shirt's prefab root; its local frame relates to mesh
    // space by innerScale (mesh -> prefab-root-local). getWorldPosition() then folds in
    // the shirt's fit scale, idle bob AND the platform's Y rotation automatically.
    tf.setLocalPosition(new vec3(m.x * this.meshToLocal, m.y * this.meshToLocal, m.z * this.meshToLocal))
    return tf.getWorldPosition()
  }

  /**
   * Panel UV → world, flattened onto that PANEL's own mean plane: the sticker's tangential
   * position, at a constant depth. This is where the tap targets and the selection
   * frame's ROOT live, so the stack's depth order is the list order and nothing else —
   * see HIT_PLANE_LIFT.
   */
  private uvToPlane(panel: number, u: number, v: number): vec3 {
    const p = this.panels[panel]
    const m = panelUvToMesh(p, this.def.panelGrid, u, v)
    const c = this.panelCentre[panel]
    // Remove the component of (m - centre) along the panel normal: project onto the
    // panel's mean plane. Pass 10 could just overwrite z; a back panel or a sleeve needs
    // the general form.
    const k = (m.x - c.x) * p.nx + (m.y - c.y) * p.ny + (m.z - c.z) * p.nz
    const tf = this.uvProbe.getTransform()
    tf.setLocalPosition(
      new vec3(
        (m.x - p.nx * k) * this.meshToLocal,
        (m.y - p.ny * k) * this.meshToLocal,
        (m.z - p.nz * k) * this.meshToLocal
      )
    )
    return tf.getWorldPosition()
  }

  /**
   * World → panel UV: the inverse of uvToWorld, ignoring the point's depth off the panel.
   *
   * panelUvToMesh is a sampled table, so there is no closed-form inverse; this Newton-
   * iterates on the two mesh axes the panel actually spans, seeded by the caller (during
   * a drag that is the sticker's own uv, a fraction of a step away). Solving through the
   * same table uvToWorld uses means the two are exact inverses of each other, which is
   * what keeps a drag from creeping.
   */
  private worldToUV(panel: number, wp: vec3, seedU: number, seedV: number): vec2 {
    const p = this.panels[panel]
    const tf = this.uvProbe.getTransform()
    tf.setWorldPosition(wp)
    const lp = tf.getLocalPosition()
    const tx = lp.x / this.meshToLocal
    const ty = lp.y / this.meshToLocal
    const tz = lp.z / this.meshToLocal

    // Solve in the panel's TANGENT plane: use the two mesh axes it spans best, by dropping
    // the one its normal is most aligned with. On a torso that is z (so we solve x and y,
    // exactly as Pass 10 did); on a sleeve, whose normal leans well off -Z, dropping the
    // wrong axis would make the 2x2 singular.
    const ax = Math.abs(p.nx)
    const ay = Math.abs(p.ny)
    const az = Math.abs(p.nz)
    const drop = az >= ax && az >= ay ? 2 : ay >= ax ? 1 : 0
    const pick0 = (m: { x: number; y: number; z: number }): number => (drop === 0 ? m.y : m.x)
    const pick1 = (m: { x: number; y: number; z: number }): number => (drop === 2 ? m.y : m.z)
    const t0 = drop === 0 ? ty : tx
    const t1 = drop === 2 ? ty : tz

    let u = seedU
    let v = seedV
    const H = 1e-3
    for (let it = 0; it < NEWTON_STEPS; it++) {
      const g = panelUvToMesh(p, this.def.panelGrid, u, v)
      const e0 = t0 - pick0(g)
      const e1 = t1 - pick1(g)
      if (Math.abs(e0) < 1e-4 && Math.abs(e1) < 1e-4) break
      const gu = panelUvToMesh(p, this.def.panelGrid, u + H, v)
      const gv = panelUvToMesh(p, this.def.panelGrid, u, v + H)
      const a = (pick0(gu) - pick0(g)) / H
      const b = (pick0(gv) - pick0(g)) / H
      const c = (pick1(gu) - pick1(g)) / H
      const d = (pick1(gv) - pick1(g)) / H
      const det = a * d - b * c
      if (Math.abs(det) < 1e-9) break
      u += (d * e0 - b * e1) / det
      v += (-c * e0 + a * e1) / det
    }
    return new vec2(u, v)
  }

  /**
   * Measure the ACTIVE garment's world cm per MESH unit, by walking the probe one mesh
   * unit and reading how far it went in the world. Every panel's meshPerU/meshPerV becomes
   * centimetres through this, so a garment still follows its own targetCm if it is
   * refitted — and the shirt's 3.33 and the cap's 1.24 are both simply measured, never
   * assumed. Run again on every garment switch.
   */
  private measureShirtScale(): void {
    const tf = this.uvProbe.getTransform()
    tf.setLocalPosition(new vec3(0, 0, 0))
    const a = tf.getWorldPosition()
    tf.setLocalPosition(new vec3(this.meshToLocal, 0, 0))
    const b = tf.getWorldPosition()
    const d = a.distance(b)
    if (d > 0.01) this.cmPerMesh = d
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Resize a slot's tap target to its sticker's current footprint. The collider SHAPE is
   * rebuilt (rather than scaling the SceneObject) so the box is exact regardless of how
   * the runtime treats scaled collision proxies. The box is deliberately THIN in Z so the
   * per-index depth stagger actually separates the stack for ray picking.
   */
  private setHitSize(slot: HitSlot, s: PlacedSticker): void {
    // The collider rides the sticker's own spin child, so it is the UNROTATED rectangle
    // plus padding — the rotation is carried by the transform, not by the box.
    const half = this.sideCm(s) / 2
    const shape = Shape.createBoxShape()
    shape.size = new vec3(
      (half * s.art.wFrac + HIT_PAD) * 2,
      (half * s.art.hFrac + HIT_PAD) * 2,
      HIT_BOX_DEPTH
    )
    slot.collider.shape = shape
  }

  /**
   * Glue every tap target + the selection frame to the cloth at their sticker's UV, on
   * their own panel. All are offset along their PANEL's live normal (not a fixed +Z) and
   * given the orientation that panel has right now, so they lie flat on it and foreshorten
   * with it as the shirt turns. The per-index depth stagger is what makes the topmost
   * sticker win a tap.
   */
  private applyWorldTransforms(): void {
    for (let i = 0; i < this.stickers.length; i++) {
      const s = this.stickers[i]
      const slot = this.ensureHitSlot(i)
      const lift = HIT_PLANE_LIFT + FRONT_OFFSET + i * HIT_DEPTH_STEP
      const tf = slot.root.getTransform()
      tf.setWorldPosition(this.hitAnchor(s.panel, s.u, s.v, lift)) // Pass 44
      tf.setWorldRotation(this.panelPose(s.panel))
      slot.spin.getTransform().setLocalRotation(quat.angleAxis((s.rotDeg * Math.PI) / 180, new vec3(0, 0, 1)))
      this.setHitSize(slot, s)
    }

    const sel = this.stickers[this.selected]
    if (sel) {
      // The frame's ROOT rides the same flat plane as the tap targets, lifted past the
      // whole stack so its chips out-rank every one of them. Its visible strokes are then
      // pulled back onto the cloth by cornerLocal, which measures each corner's TRUE world
      // position against this root.
      //
      // PASS 47 — THE FRAME DRIFTED OFF ITS STICKER AS THE GARMENT TURNED, and this line is
      // why. Pass 44 put the root on the eye's ray (hitAnchor) like the tap targets. But
      // the frame's ribbons, dots and chips are laid out ONCE, in this root's local frame,
      // from the compositor's stamp (layoutSelection / cornerLocal), and are not re-laid
      // as the platform turns — they never were, and never needed to be, because the root
      // used to sit a fixed distance off the cloth ALONG THE PANEL'S NORMAL, so the
      // stamp's position in the root's frame was the same at every angle. On the ray, the
      // root's offset from the cloth swings with the view: measured with debugFrameProbe,
      // the stamp's centre in root-local went from x 0.00 at 0 deg to 2.68 at 30 and 4.56
      // at 60, and the drawn corners were 0.03, 2.78 and 5.33 cm off the stamp. So the
      // root goes back on the normal (Pass 10/26), where a once-laid frame holds at every
      // angle, and the frame is again the stamp's own rectangle and nothing else. The TAP
      // TARGETS keep the ray (Pass 44's fix stands: they are boxes, not laid-out geometry).
      // The chips still out-rank every sticker box on any ray: their plane is lifted past
      // the whole stack, and a box lifted `l` along a ray is never nearer than `l` along
      // the normal.
      const lift = HIT_PLANE_LIFT + FRONT_OFFSET + this.stickers.length * HIT_DEPTH_STEP + FRAME_LIFT
      const selTf = this.selRoot.getTransform()
      selTf.setWorldPosition(this.uvToPlane(sel.panel, sel.u, sel.v).add(this.panelNormal(sel.panel).uniformScale(lift)))
      selTf.setWorldRotation(this.panelPose(sel.panel))
      this.selSpin.getTransform().setLocalRotation(quat.angleAxis((sel.rotDeg * Math.PI) / 180, new vec3(0, 0, 1)))
      // Pass 47: the chips' grab boxes sit on the eye's ray through each disc (placeChip);
      // that ray turns with the garment, so they are re-solved here every frame. The discs
      // themselves are laid-out geometry and stay put.
      for (const chip of [this.closeChip, this.dupChip, this.resizeChip, this.rotChip]) this.solveChipHit(chip)
    }
  }

  /**
   * PASS 44 — where a tap target (or the frame's root) sits for a sticker at (u,v): on the
   * eye's ray through the sticker's VISIBLE centre, at the depth where that ray crosses
   * the panel's mean plane, then `lift` cm back up the ray toward the eye. See the note at
   * HIT_RAY_MIN_FACING for the measurement behind it. The scene camera is fixed at the
   * origin (see panelFacing), so the eye is the origin.
   */
  private hitAnchor(panel: number, u: number, v: number, lift: number): vec3 {
    const eye = new vec3(0, 0, 0)
    const seen = this.uvToWorld(panel, u, v)
    const len = seen.sub(eye).length
    if (len < 1e-4) return seen
    const dir = seen.sub(eye).uniformScale(1 / len)
    const planePt = this.uvToPlane(panel, u, v)
    const n = this.panelNormal(panel)
    const denom = n.dot(dir)
    if (Math.abs(denom) < HIT_RAY_MIN_FACING) return planePt.add(n.uniformScale(lift)) // edge-on: the pre-Pass-44 placement
    const t = n.dot(planePt.sub(eye)) / denom
    return eye.add(dir.uniformScale(Math.max(1, t - lift)))
  }

  /**
   * The world rotation that puts a flat overlay onto a panel: +Z along the panel's
   * outward normal, +Y up the panel, +X to the right AS SEEN when looking at it. Built as
   * right = worldUp x normal, up = normal x right — the same frame the panel table's
   * atlasRotDeg was measured in, which is why a sticker on the back reads the right way
   * round instead of mirrored.
   */
  private panelPose(panel: number): quat {
    const p = this.panels[panel]
    // YAW ONLY — the panel's normal projected onto the horizontal plane. Three reasons
    // it is not the panel's full (right, up, normal) basis:
    //
    //   - For the FRONT this evaluates to identity, which is exactly the shirt world
    //     rotation Pass 10 used. The front's behaviour is bit-for-bit unchanged.
    //   - The frame's local +X/+Y only have to be roughly parallel to the cloth and
    //     correctly HANDED; cornerLocal measures each corner's true world position and
    //     projects it into this plane, so the corners land where the artwork's corners
    //     land whatever the plane's exact tilt. What must be right is the flip — on the
    //     back, "right" is world -X, and the 180-degree yaw is what supplies it.
    //   - Taking the full basis tips the plane by the panel's average pitch (16.7
    //     degrees on the chest, because the torso slopes). The frame then no longer
    //     faces the camera head-on, and the segment chain's small depth steps turn into
    //     visible lateral notches along each edge. Keeping the frame vertical in the
    //     world removes that and matches how a sticker's "up" reads anyway.
    //
    // Built by hand from atan2 rather than quat.lookAt, whose axis convention is not
    // documented — guessing it wrong tips the whole frame off the cloth, which is what
    // it did on the first Pass-11 build.
    const yaw = Math.atan2(p.nx, p.nz)
    return this.controller.getWorldRotation().multiply(quat.angleAxis(yaw, new vec3(0, 1, 0)))
  }

  /**
   * The selection frame: a fine light-blue stroke with a tight dark edge (so it reads on a
   * white shirt AND a black one), a plain dot on two opposite corners, a discreet x chip
   * in one corner, a resize chip in the opposite one and a rotate handle on a stem above
   * the top edge. Geometry is laid out by layoutSelection() from the compositor's stamp,
   * so it follows the sticker's size, angle, position AND panel exactly.
   */
  private buildSelectionBox(): void {
    this.selRoot = global.scene.createSceneObject("StickerSelectionBox")
    this.selRoot.setParent(this.root)
    // Everything visible hangs off the spin node, so the whole frame — bars, dots and all
    // three chips — turns as one with the sticker.
    this.selSpin = global.scene.createSceneObject("StickerSelectionSpin")
    this.selSpin.setParent(this.selRoot)
    // No visual: a scratch node for converting stamped world corners into frame-local
    // coordinates through the live transform chain (see cornerLocal).
    this.selProbe = global.scene.createSceneObject("StickerSelectionProbe")
    this.selProbe.setParent(this.selSpin)

    // Four sides, each a chain of hairline segments. Pass 26: every side's dark backing is
    // built BEFORE any side's stroke, so a segment's halo can never paint over the stroke
    // of the segment before it — that was the "dashed" look. The strokes overlap by a bar
    // width and read as one continuous line.
    // PASS 38: each side is now ONE RIBBON per layer, not a row of quads — see
    // Geo.buildRibbon for why neither overlapping nor butting the quads could work. The
    // objects are created here at identity and their meshes are rebuilt by placeEdgeChain;
    // the chain of points, and therefore the way the stroke follows the cloth, is unchanged.
    for (let side = 0; side < 4; side++) {
      this.sideLayers.push({
        glowOut: GLASS ? this.addSolidShape(this.selSpin, this.quadMesh, vec3.zero(), new vec3(1, 1, 1), FRAME_GLOW_OUT, 0, FRAME_ORDER_GLOW) : null,
        glowIn: this.addSolidShape(this.selSpin, this.quadMesh, vec3.zero(), new vec3(1, 1, 1), pick(HALO, FRAME_GLOW_IN), 0, FRAME_ORDER_GLOW_IN),
        core: this.addSolidShape(this.selSpin, this.quadMesh, vec3.zero(), new vec3(1, 1, 1), pick(ACCENT, FRAME_CORE), 0, FRAME_ORDER_LINE),
      })
    }
    // Pass 38: the four midpoint dots — decoration only, no collider, no handler.
    if (GLASS) {
      for (let side = 0; side < 4; side++) {
        const glow = this.addSolidShape(this.selSpin, this.discMesh, vec3.zero(),
          new vec3(FRAME_DOT_R * FRAME_DOT_GLOW_K, FRAME_DOT_R * FRAME_DOT_GLOW_K, 1), FRAME_DOT_GLOW, 0, FRAME_ORDER_DOT)
        const dot = this.addSolidShape(this.selSpin, this.discMesh, new vec3(0, 0, 0.02),
          new vec3(FRAME_DOT_R, FRAME_DOT_R, 1), FRAME_DOT_COL, 0, FRAME_ORDER_DOT)
        this.edgeDots.push({ glow: glow, dot: dot })
      }
    }


    // FOUR CORNER CHIPS (Pass 26), one each: x top-left, duplicate top-right, resize
    // bottom-right, rotate bottom-left. White disc, accent outline, dark slate glyph.
    this.closeChip = this.makeChip("SelChipDelete")
    this.addSolidShape(this.closeChip, this.quadMesh, new vec3(0, 0, 0.25), new vec3(GLYPH_LEN, GLYPH_BAR, 1), GLYPH_COL, Math.PI / 4, FRAME_ORDER_CHIP_GLYPH)
    this.addSolidShape(this.closeChip, this.quadMesh, new vec3(0, 0, 0.25), new vec3(GLYPH_LEN, GLYPH_BAR, 1), GLYPH_COL, -Math.PI / 4, FRAME_ORDER_CHIP_GLYPH)
    this.delInteractable = this.addChipInteractable(this.closeChip)

    // Duplicate: two overlapping squares — the back one filled, the front one outlined.
    this.dupChip = this.makeChip("SelChipDuplicate")
    const sq = 0.78
    const off = 0.2
    this.addSolidShape(this.dupChip, this.quadMesh, new vec3(-off, off, 0.25), new vec3(sq, sq, 1), GLYPH_COL, 0, FRAME_ORDER_CHIP_GLYPH)
    this.addSolidShape(this.dupChip, this.quadMesh, new vec3(off, -off, 0.3), new vec3(sq, sq, 1), CHIP_FILL, 0, FRAME_ORDER_CHIP_GLYPH)
    this.addSolidShape(this.dupChip, this.quadMesh, new vec3(off, -off + sq / 2, 0.35), new vec3(sq, GLYPH_BAR, 1), GLYPH_COL, 0, FRAME_ORDER_CHIP_GLYPH)
    this.addSolidShape(this.dupChip, this.quadMesh, new vec3(off, -off - sq / 2, 0.35), new vec3(sq, GLYPH_BAR, 1), GLYPH_COL, 0, FRAME_ORDER_CHIP_GLYPH)
    this.addSolidShape(this.dupChip, this.quadMesh, new vec3(off - sq / 2, -off, 0.35), new vec3(GLYPH_BAR, sq, 1), GLYPH_COL, 0, FRAME_ORDER_CHIP_GLYPH)
    this.addSolidShape(this.dupChip, this.quadMesh, new vec3(off + sq / 2, -off, 0.35), new vec3(GLYPH_BAR, sq, 1), GLYPH_COL, 0, FRAME_ORDER_CHIP_GLYPH)
    this.dupInteractable = this.addChipInteractable(this.dupChip)

    // Resize (bottom-right): a diagonal double-headed arrow.
    this.resizeChip = this.makeChip("SelChipResize")
    this.addSolidShape(this.resizeChip, this.quadMesh, new vec3(0, 0, 0.25), new vec3(GLYPH_LEN, GLYPH_BAR, 1), GLYPH_COL, Math.PI / 4, FRAME_ORDER_CHIP_GLYPH)
    const head = 0.5
    const hx = (GLYPH_LEN / 2) * Math.SQRT1_2
    const tri = buildTriangle()
    this.addSolidShape(this.resizeChip, tri, new vec3(hx, hx, 0.25), new vec3(head, head, 1), GLYPH_COL, Math.PI / 4, FRAME_ORDER_CHIP_GLYPH)
    this.addSolidShape(this.resizeChip, tri, new vec3(-hx, -hx, 0.25), new vec3(head, head, 1), GLYPH_COL, Math.PI + Math.PI / 4, FRAME_ORDER_CHIP_GLYPH)
    this.resizeInteractable = this.addChipInteractable(this.resizeChip)

    // Rotate (bottom-left): an open arc with an arrowhead — the platform's own language.
    this.rotChip = this.makeChip("SelChipRotate")
    const rInner = 1 - GLYPH_BAR / CHIP_R
    this.addSolidShape(this.rotChip, buildRing(rInner, 28, 25, 320), new vec3(0, 0, 0.25), new vec3(0.66, 0.66, 1), GLYPH_COL, 0, FRAME_ORDER_CHIP_GLYPH)
    const rHead = 0.44
    const ha = (25 * Math.PI) / 180
    this.addSolidShape(
      this.rotChip, buildTriangle(),
      new vec3(0.66 * Math.cos(ha), 0.66 * Math.sin(ha), 0.25),
      new vec3(rHead, rHead, 1), GLYPH_COL, Math.PI / 2 + ha, FRAME_ORDER_CHIP_GLYPH
    )
    this.rotInteractable = this.addChipInteractable(this.rotChip)

    // Pass 12: the whole frame — bars, dots, x, resize and rotate handles — is chrome.
    setLayerDeep(this.selRoot, LAYERS.ui)
    this.selRoot.enabled = false // hidden until selected
  }

  /**
   * Lay the frame ON the stamped rectangle.
   *
   * The four corners come from StickerCompositor.getStamp() — the very object the
   * compositor drove the sticker quad's transforms from — so this is not a second opinion
   * about where the artwork is, it is the artwork's own rectangle. Each corner UV goes
   * through the same uvToWorld the sticker's position uses, on the sticker's own panel,
   * then through selProbe into the frame's local space (where the panel's pose and the
   * sticker's spin both cancel out, leaving a near-axis-aligned box in cm).
   */
  private layoutSelection(): void {
    const sel = this.stickers[this.selected]
    const stamp = this.stampFor(this.selected)
    if (!sel || !stamp) return
    const panel = sel.panel

    // BL, BR, TR, TL in the frame's own local cm.
    const c: vec3[] = []
    for (let k = 0; k < 4; k++) c.push(this.cornerLocal(panel, stamp.corners[k], FRAME_EDGE_PAD))
    this.lastCorners = c // Pass 47: for debugFrameProbe

    // Each side follows the stamp's edge through the cloth's curvature, not the chord
    // between its corners (see FRAME_SEGMENTS).
    const chains = [
      this.placeEdgeChain(0, panel, stamp.corners[0], stamp.corners[1]),
      this.placeEdgeChain(1, panel, stamp.corners[1], stamp.corners[2]),
      this.placeEdgeChain(2, panel, stamp.corners[3], stamp.corners[2]),
      this.placeEdgeChain(3, panel, stamp.corners[0], stamp.corners[3]),
    ]
    const top = chains[2]
    // Pass 38: each dot on its own side's middle chain point, so it rides the cloth's
    // curve with the line rather than floating on the chord between the corners.
    for (let i = 0; i < this.edgeDots.length; i++) {
      const m = chains[i][FRAME_MID_INDEX]
      this.edgeDots[i].glow.getTransform().setLocalPosition(new vec3(m.x, m.y, m.z + 0.06))
      this.edgeDots[i].dot.getTransform().setLocalPosition(new vec3(m.x, m.y, m.z + 0.08))
    }

    // Pass 26: the chips sit ON the corners at the cloth's own depth, so they are coplanar
    // with the frame at every angle, and scale with it.
    const w = Math.sqrt((c[1].x - c[0].x) ** 2 + (c[1].y - c[0].y) ** 2)
    const h = Math.sqrt((c[3].x - c[0].x) ** 2 + (c[3].y - c[0].y) ** 2)
    const r = Math.max(SEL_CHIP_R_MIN, Math.min(SEL_CHIP_R_MAX, SEL_CHIP_K * Math.min(w, h)))
    this.placeChip(this.closeChip, c[3], r) // top-left: x
    this.placeChip(this.dupChip, c[2], r) // top-right: duplicate
    this.placeChip(this.resizeChip, c[1], r) // bottom-right: resize
    this.placeChip(this.rotChip, c[0], r) // bottom-left: rotate

    if (DEBUG_FRAME_FIT) this.printFrameFit(stamp, c)
  }

  /**
   * One stamped UV corner, expressed in the selection frame's own local cm. `pad` pushes
   * it outward from the frame's centre (0 = the stroke's centreline sits exactly on the
   * artwork's edge).
   *
   * z is KEPT, not flattened. The frame's root is lifted clear of the whole sticker stack
   * so its chips out-rank every tap target, but a stroke drawn on that lifted plane would
   * be nearer the camera than the cloth it is tracing, and the main camera is a PERSPECTIVE
   * one — a few cm of lift at 104 cm magnifies the frame by a few percent, which on a 4 cm
   * half-width is half a millimetre of false gap on every edge. Putting each corner back
   * at the cloth's own depth removes the parallax entirely, at every scale, angle and
   * panel. The parts render on top regardless because they are drawn with depthTest off.
   */
  private cornerLocal(panel: number, uv: vec2, pad: number): vec3 {
    const tf = this.selProbe.getTransform()
    tf.setWorldPosition(this.uvToWorld(panel, uv.x, uv.y))
    const lp = tf.getLocalPosition()
    if (pad === 0) return lp
    const len = Math.sqrt(lp.x * lp.x + lp.y * lp.y) || 1
    return new vec3(lp.x + (lp.x / len) * pad, lp.y + (lp.y / len) * pad, lp.z)
  }

  /**
   * Draw one whole side of the frame, from stamped UV corner `uvA` to stamped UV corner
   * `uvB`, as a chain of FRAME_SEGMENTS hairline pieces.
   *
   * The stamp is a rectangle in the shirt's UV atlas, so its edge is a straight line THERE
   * and sampling it is an exact lerp between the two corner UVs — but each sample is then
   * put through the same uvToWorld the artwork itself follows, so the chain traces the
   * artwork's edge across the cloth's curvature instead of chording it.
   *
   * Returns the sampled points (local cm), so callers that need a point ON the edge — the
   * rotate handle's anchor — get the same ones rather than recomputing.
   */
  private placeEdgeChain(side: number, panel: number, uvA: vec2, uvB: vec2): vec3[] {
    const pts: vec3[] = []
    for (let i = 0; i <= FRAME_SEGMENTS; i++) {
      const t = i / FRAME_SEGMENTS
      pts.push(this.cornerLocal(panel, new vec2(uvA.x + (uvB.x - uvA.x) * t, uvA.y + (uvB.y - uvA.y) * t), FRAME_EDGE_PAD))
    }
    // Pass 38: one mesh per layer for the whole side. The layers are lifted off each
    // other by a hair so the core is unambiguously the topmost of the three.
    const L = this.sideLayers[side]
    if (L.glowOut) this.setRibbon(L.glowOut, pts, pick(FRAME_HALO, FRAME_GLOW_OUT_W) / 2, -0.02)
    this.setRibbon(L.glowIn, pts, pick(FRAME_HALO, FRAME_GLOW_IN_W) / 2, 0)
    this.setRibbon(L.core, pts, FRAME_BAR / 2, 0.05)
    return pts
  }

  /** Rebuild one ribbon along `pts`, `dz` clear of the chain's own depth. */
  private setRibbon(obj: SceneObject, pts: vec3[], halfW: number, dz: number): void {
    const lifted: vec3[] = []
    for (let i = 0; i < pts.length; i++) lifted.push(new vec3(pts[i].x, pts[i].y, pts[i].z + dz))
    const v = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    v.mesh = buildRibbon(lifted, halfW)
  }


  private makeChip(name: string, radius: number = CHIP_R): SceneObject {
    const chip = global.scene.createSceneObject(name)
    chip.setParent(this.selSpin)
    // Pass 38 (glass): two bloom discs behind the chip, the reference's halo. They are
    // BEHIND the white disc, so they never wash the glyph out.
    if (GLASS) {
      this.addSolidShape(chip, this.discMesh, new vec3(0, 0, -0.02), new vec3(radius * CHIP_GLOW_OUT_K, radius * CHIP_GLOW_OUT_K, 1), CHIP_GLOW_OUT, 0, FRAME_ORDER_CHIP_GLOW)
      this.addSolidShape(chip, this.discMesh, new vec3(0, 0, -0.01), new vec3(radius * CHIP_GLOW_IN_K, radius * CHIP_GLOW_IN_K, 1), CHIP_GLOW_IN, 0, FRAME_ORDER_CHIP_GLOW)
    }
    this.addSolidShape(chip, this.discMesh, new vec3(0, 0, 0), new vec3(radius, radius, 1), CHIP_FILL, 0, FRAME_ORDER_CHIP_DISC)
    const ring = buildRing(1 - CHIP_RING / radius, 40)
    this.addSolidShape(chip, ring, new vec3(0, 0, 0.1), new vec3(radius, radius, 1), ACCENT, 0, FRAME_ORDER_CHIP_DISC)
    return chip
  }

  /**
   * Pass 26: put a chip's DISC on a frame corner at the cloth's depth, scaled to radius
   * `r`, and put its COLLIDER on the lifted plane exactly where the eye's ray through the
   * disc crosses it — so the grab box is always under the chip on screen, yet still in
   * front of every sticker's tap target.
   */
  /**
   * Put a chip's grab box where the eye's ray through its disc crosses the frame's lifted
   * plane (frame-local z = SEL_CHIP_HIT_Z). Eye at the origin: points t * P (P = the disc's
   * world position) in frame-local space are t * Lp + (1 - t) * Lo; solve for the t that
   * lands on that plane. Called at layout and (Pass 47) every frame the frame is shown.
   */
  private solveChipHit(chip: SceneObject): void {
    const hit = this.chipHits[chip.name]
    if (!hit) return
    const P = chip.getTransform().getWorldPosition()
    const inv = this.selSpin.getTransform().getInvertedWorldTransform()
    const lp = inv.multiplyPoint(P)
    const lo = inv.multiplyPoint(new vec3(0, 0, 0))
    const dz = lp.z - lo.z
    const t = Math.abs(dz) < 1e-6 ? 1 : (SEL_CHIP_HIT_Z - lo.z) / dz
    const l = lp.uniformScale(t).add(lo.uniformScale(1 - t))
    hit.getTransform().setLocalPosition(new vec3(l.x, l.y, SEL_CHIP_HIT_Z))
  }

  private placeChip(chip: SceneObject, corner: vec3, r: number): void {
    const k = r / CHIP_R
    const tf = chip.getTransform()
    tf.setLocalPosition(new vec3(corner.x, corner.y, corner.z + SEL_CHIP_LIFT))
    tf.setLocalScale(new vec3(k, k, 1))
    const hit = this.chipHits[chip.name]
    if (!hit) return
    this.solveChipHit(chip)
    const box = Math.max(SEL_CHIP_HIT_MIN, 2.3 * r)
    const col = hit.getComponent("Physics.ColliderComponent") as ColliderComponent | null
    if (col) {
      const shape = Shape.createBoxShape()
      shape.size = new vec3(box, box, SEL_CHIP_HIT_DEPTH)
      col.shape = shape
    }
  }

  /**
   * Give a chip its own collider + Interactable, on a SEPARATE object on the frame's
   * lifted plane (placeChip keeps it under the disc). The plane sits past the top of the
   * sticker stack (see FRAME_LIFT), so a ray reaches the chips before ANY sticker's tap
   * target and their taps always win over select/drag.
   */
  private addChipInteractable(chip: SceneObject): Interactable {
    const hit = global.scene.createSceneObject(chip.name + "Hit")
    hit.setParent(this.selSpin)
    hit.getTransform().setLocalPosition(new vec3(0, 0, SEL_CHIP_HIT_Z))
    const collider = hit.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(SEL_CHIP_HIT_MIN, SEL_CHIP_HIT_MIN, SEL_CHIP_HIT_DEPTH)
    collider.shape = shape
    collider.fitVisual = false // honour the explicit box size; never auto-fit to a child visual
    const interactable = hit.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = 3 // Direct + Indirect, so mouse + hand both hit it
    this.chipHits[chip.name] = hit
    return interactable
  }

  private buildBackgroundTarget(): void {
    // Large, invisible tap-away target parked behind the shirt. Taps that miss every
    // sticker / chip / tray / slider / platform fall through to here → deselect.
    this.bgObj = global.scene.createSceneObject("StickerDeselectBackdrop")
    this.bgObj.setParent(this.root)
    this.bgObj.getTransform().setLocalPosition(new vec3(0, 0, -170))
    const collider = this.bgObj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(400, 400, 3)
    collider.shape = shape
    collider.fitVisual = false // honour the explicit box size; never auto-fit to a child visual
    this.bgInteractable = this.bgObj.createComponent(Interactable.getTypeName()) as Interactable
    this.bgInteractable.targetingMode = 3
    setLayerDeep(this.bgObj, LAYERS.ui) // Pass 12: chrome, never in the photo
  }

  private buildUvProbe(): void {
    // A zero-size point child of the shirt visual (prefab root). We move it in local /
    // world space to convert between the shirt's mesh space and world space through its
    // live transform. It has no visual, so the shirt's fit scale doesn't matter here.
    this.uvProbe = global.scene.createSceneObject("StickerUVProbe")
    const visual = this.controller.getVisual()
    this.uvProbe.setParent(visual ? visual : this.root)
  }

  // ---------------------------------------------------------------------------
  // Verification harness (all of it inert in shipped code)
  // ---------------------------------------------------------------------------

  /**
   * VERIFICATION ONLY (DEBUG_PROJECTION_PROBE). Round-trips the projection at the shirt's
   * CURRENT angle: take a known UV on the facing panel, find where it is in the world
   * right now, aim a ray at it from in front of the scene, and push that ray back through
   * the REAL rayToPanelUV. If the recovered UV matches at every angle, the live-world-
   * matrix projection is correct and a drag cannot silently stamp in the wrong place.
   */
  probeProjection(yawDeg: number): void {
    const eye = new vec3(0, 0, 20) // an arbitrary viewpoint in front of the composition
    const panel = this.activePanel()
    const p = this.panels[panel]
    const targets = [
      new vec2(p.homeU, p.homeV),
      new vec2(p.gridU0 + (p.gridU1 - p.gridU0) * 0.35, p.gridV0 + (p.gridV1 - p.gridV0) * 0.35),
      new vec2(p.gridU0 + (p.gridU1 - p.gridU0) * 0.65, p.gridV0 + (p.gridV1 - p.gridV0) * 0.7),
    ]
    for (const t of targets) {
      const world = this.uvToWorld(panel, t.x, t.y)
      const dir = world.sub(eye).normalize()
      const got = this.rayToPanelUV(eye, dir, panel, p.homeU, p.homeV)
      const err = got ? Math.max(Math.abs(got.x - t.x), Math.abs(got.y - t.y)) : -1
      print(
        "[PROBE] yaw=" + yawDeg.toFixed(0) + " panel=" + p.name +
        " facing=" + this.panelFacing(panel).toFixed(3) +
        " want=(" + t.x.toFixed(4) + "," + t.y.toFixed(4) + ")" +
        " got=" + (got ? "(" + got.x.toFixed(4) + "," + got.y.toFixed(4) + ")" : "NULL") +
        " err=" + err.toFixed(5)
      )
    }
  }

  /** Which sticker a tap at this panel+UV lands on: the TOPMOST one containing it, or -1. */
  private pickAtUV(panel: number, u: number, v: number): number {
    for (let i = this.stickers.length - 1; i >= 0; i--) {
      const s = this.stickers[i]
      if (s.panel !== panel) continue
      const d = this.uvToCm(panel, u - s.u, v - s.v)
      const r = (-s.rotDeg * Math.PI) / 180
      const lx = d.x * Math.cos(r) - d.y * Math.sin(r)
      const ly = d.x * Math.sin(r) + d.y * Math.cos(r)
      const h = this.sideCm(s) / 2
      if (Math.abs(lx) <= h && Math.abs(ly) <= h) return i
    }
    return -1
  }

  /** The Pass-11 point-0 survey, printed live: facing, liveness, and the active panel. */
  /** Verification entry point (Pass 26): the panel survey, on demand. */
  debugSurvey(): void {
    this.printPanelSurvey()
  }

  /**
   * PASS 26 — MEASURE a panel's atlas frame from the cloth itself.
   *
   * The screen-space direction of the atlas's +u and +v axes at the panel's centre,
   * read off the sampled mesh through the same uvToWorld every placement uses. The frame
   * is the panel's own: its live outward normal, "up" = world up flattened onto the panel
   * (or AWAY from the viewer for a near-horizontal panel such as the cap's top), "right" =
   * up x normal — so it turns with the garment and is the same at every yaw.
   *
   * Returns the map cm = R(-rotDeg) . diag(sigma * cmPerU, cmPerV) . uv, which is exactly
   * the form computeStampFor and uvToCm assume, with sigma the atlas's HANDEDNESS: -1
   * where +u runs to the viewer's left (the shirt), +1 where it runs to the right.
   */
  private measurePanelFrame(panel: number): { sigma: number; rotDeg: number; cmU: number; cmV: number } {
    const p = this.panels[panel]
    return this.frameAt(panel, p.rectU, p.rectV)
  }

  /** The panel's frame at its rect centre, memoised per garment (it is yaw- and bob-invariant). */
  private panelFrame(panel: number): { sigma: number; rotDeg: number; cmU: number; cmV: number } {
    const key = this.def.id + "#" + panel
    let f = this.panelFrames[key]
    if (!f) {
      f = this.measurePanelFrame(panel)
      this.panelFrames[key] = f
    }
    return f
  }

  /**
   * THE ONE PLACE A STICKER'S "UP" IS DECIDED (Pass 26). The atlas frame at (u, v) on a
   * panel, measured from the cloth: what computeStampFor and the compositor turn the
   * artwork by, so it reads upright at that very spot on any garment, from any table.
   */
  private frameAt(panel: number, u0: number, v0: number): { sigma: number; rotDeg: number; cmU: number; cmV: number } {
    const p = this.panels[panel]
    const e = 0.01
    const wu = this.uvToWorld(panel, u0 + e, v0).sub(this.uvToWorld(panel, u0 - e, v0)).uniformScale(1 / (2 * e))
    const wv = this.uvToWorld(panel, u0, v0 + e).sub(this.uvToWorld(panel, u0, v0 - e)).uniformScale(1 / (2 * e))
    let n = wu.cross(wv)
    const ref = this.controller.getWorldRotation().multiplyVec3(new vec3(p.nx, p.ny, p.nz))
    if (n.length < 1e-9) n = ref
    n = n.normalize()
    if (n.dot(ref) < 0) n = n.uniformScale(-1)
    let up = new vec3(0, 1, 0).sub(n.uniformScale(n.y))
    if (up.length < FRAME_UP_MIN) up = new vec3(0, 0, -1).sub(n.uniformScale(-n.z)) // horizontal panel: up is away from the viewer
    up = up.normalize()
    const right = up.cross(n).normalize()
    const ux = wu.dot(right), uy = wu.dot(up)
    const vx = wv.dot(right), vy = wv.dot(up)
    const det = ux * vy - uy * vx
    const sigma = det < 0 ? -1 : 1
    let rot = (-Math.atan2(uy, ux) * 180) / Math.PI + (sigma < 0 ? 180 : 0)
    while (rot > 180) rot -= 360
    while (rot <= -180) rot += 360
    return { sigma, rotDeg: rot, cmU: Math.sqrt(ux * ux + uy * uy), cmV: Math.sqrt(vx * vx + vy * vy) }
  }

  private printPanelSurvey(): void {
    const act = this.activePanel()
    print("[this.panels] cmPerMesh=" + this.cmPerMesh.toFixed(4) + "  active=" + this.panels[act].name)
    for (let i = 0; i < this.panels.length; i++) {
      const p = this.panels[i]
      print(
        "[this.panels] " + (i === act ? ">" : " ") + " #" + i + " " + p.name +
        " rect " + (p.halfRightMesh * 2 * this.cmPerMesh).toFixed(2) + " x " +
        (p.halfUpMesh * 2 * this.cmPerMesh).toFixed(2) + " cm at uv(" +
        p.rectU.toFixed(3) + "," + p.rectV.toFixed(3) + ")" +
        " maxScale=" + this.panelMaxUprightScale(i).toFixed(2) +
        " cm/u=" + this.cmPerU(i).toFixed(1) + " cm/v=" + this.cmPerV(i).toFixed(1) +
        " atlasRot=" + p.atlasRotDeg.toFixed(1) +
        " facing=" + this.panelFacing(i).toFixed(3) +
        " | measured sigma=" + this.measurePanelFrame(i).sigma + " rot=" + this.measurePanelFrame(i).rotDeg.toFixed(1) +
        " cm/u=" + this.measurePanelFrame(i).cmU.toFixed(2) + " cm/v=" + this.measurePanelFrame(i).cmV.toFixed(2) +
        " live=" + (this.live[i] ? "Y" : "n")
      )
    }
  }

  /**
   * Drive the real place / select / drag / resize / rotate / delete paths from the DEBUG_*
   * constants, because SIK Interactables in this project's preview only receive trigger
   * events from a real mouse in the panel. Everything here goes through the same public
   * methods a tap calls, so a capture shows the real result.
   */
  private runDebugDrivers(): void {
    if (DEBUG_MULTI.length > 0) {
      for (const d of DEBUG_MULTI) {
        this.placeSticker(d.tex)
        const s = this.stickers[this.stickers.length - 1]
        if (!s) continue
        if (d.panel !== undefined && d.panel !== s.panel) {
          // Re-home it as if the tap had happened while THAT panel was facing the
          // camera: the panel's own home, cascaded by how many stickers it already
          // carries, and its own maximum size. Just swapping the panel index would
          // leave the sticker at the front's coordinates and let the clamp drag it
          // somewhere arbitrary.
          this.moveToPanelHome(s, d.panel)
        }
        if (d.scale !== undefined) this.setStickerScale(d.scale)
        if (d.rot !== undefined) this.setStickerRotation(d.rot)
        if (d.u !== undefined && d.v !== undefined) { s.u = d.u; s.v = d.v; this.clampToPanel(s) }
        this.rebuild()
      }
      const sel = this.stickers[this.selected]
      if (DEBUG_TAP_UV && sel) this.selectSticker(this.pickAtUV(sel.panel, DEBUG_TAP_UV.u, DEBUG_TAP_UV.v))
      if (DEBUG_SELECT_INDEX !== null) this.selectSticker(DEBUG_SELECT_INDEX)
      if (DEBUG_DELETE_INDEX !== null) {
        this.selectSticker(DEBUG_DELETE_INDEX)
        this.deleteSelected()
      }
      this.printStack()
      return
    }

    // Pass 3-9 single-sticker states, unchanged.
    if (DEBUG_FORCE_STATE >= 1) {
      this.placeSticker(DEBUG_PLACE_INDEX)
      if (DEBUG_FORCE_STATE !== 2) this.selectSticker(-1)
      if (DEBUG_FORCE_STATE === 3) { this.selectSticker(0); this.deleteSelected() }
      if (DEBUG_DRAG_UV && this.selected >= 0) {
        const s = this.stickers[this.selected]
        s.u = DEBUG_DRAG_UV.u
        s.v = DEBUG_DRAG_UV.v
        this.clampToPanel(s)
        this.rebuild()
      }
      if (DEBUG_STICKER_SCALE !== null && this.selected >= 0) this.setStickerScale(DEBUG_STICKER_SCALE)
      if (DEBUG_STICKER_ROT !== null && this.selected >= 0) this.setStickerRotation(DEBUG_STICKER_ROT)
    }
  }

  /**
   * VERIFICATION ONLY (DEBUG_DRAG_PATH). Walk the selected sticker one step along a path
   * through the REAL drag code: aim a synthetic ray from the camera at the named point on
   * the named panel and push it into dragToRay — the same ray -> panel -> uv -> hop ->
   * clamp path a pinch-drag uses. The main script turns the shirt to the step's yaw first,
   * exactly as the platform slider would, so the target panel is facing the camera when
   * the drag reaches it.
   */
  dragPathStep(step: number): void {
    if (step < 0 || step >= DEBUG_DRAG_PATH.length) return
    if (this.selected < 0) return
    const d = DEBUG_DRAG_PATH[step]
    const target = this.uvToWorld(d.atPanel, d.u, d.v)
    const eye = new vec3(0, 0, 0) // the scene camera
    const dir = target.sub(eye)
    if (dir.length < 1e-4) return
    this.dragToRay(eye, dir.normalize())
    const s = this.stickers[this.selected]
    print(
      "[DRAG] step " + step + " yaw=" + d.yaw.toFixed(0) +
      " aimed at " + this.panels[d.atPanel].name + " (" + d.u.toFixed(3) + "," + d.v.toFixed(3) + ")" +
      " -> sticker on " + this.panels[s.panel].name + " (" + s.u.toFixed(3) + "," + s.v.toFixed(3) + ")"
    )
  }

  /**
   * PASS 44 VERIFICATION — what a real pointer ray finds on the way to sticker #i. Casts
   * the same rayCastAll SIK's MouseTargetProvider casts, from the eye through the sticker's
   * VISIBLE centre, and prints every collider on the way with its distance, plus SIK's own
   * filter applied to it (an Interactable that takes Indirect, inside the camera's screen).
   * Inert in shipped code.
   */
  debugRayProbe(tag: string, i: number = -1): void {
    const idx = i >= 0 ? i : this.selected >= 0 ? this.selected : 0
    const s = this.stickers[idx]
    if (!s) { print("[RAY] <" + tag + "> no sticker #" + idx); return }
    const centre = this.uvToWorld(s.panel, s.u, s.v)
    const eye = new vec3(0, 0, 0)
    const end = centre.uniformScale(3)
    const slot = this.hitSlots[idx]
    const hp = slot ? slot.spin.getTransform().getWorldPosition() : null
    print("[RAY] <" + tag + "> sticker #" + idx + " on " + this.panels[s.panel].name + " uv(" + s.u.toFixed(3) + "," + s.v.toFixed(3) + ")" +
      " centre=(" + centre.x.toFixed(1) + "," + centre.y.toFixed(1) + "," + centre.z.toFixed(1) + ")" +
      (hp ? " hitbox=(" + hp.x.toFixed(1) + "," + hp.y.toFixed(1) + "," + hp.z.toFixed(1) + ") rootEnabled=" + slot.root.enabled : " (no slot)") +
      " live=" + this.live[s.panel] + " facing=" + this.panelFacing(s.panel).toFixed(2) + " selected=" + this.selected)
    const probe = Physics.createGlobalProbe()
    probe.rayCastAll(eye, end, (hits: RayCastHit[]) => {
      let first = "(none)"
      for (const h of hits) {
        const obj = h.collider.getSceneObject()
        const inter = obj.getComponent(Interactable.getTypeName()) as Interactable | null
        const takes = inter ? (inter.targetingMode & 2) !== 0 : false
        let chain = obj.name
        let par = obj.getParent()
        for (let k = 0; k < 3 && par; k++) { chain += " < " + par.name; par = par.getParent() }
        print("[RAY] <" + tag + ">   hit " + h.distance.toFixed(1) + "cm @(" + h.position.x.toFixed(1) + "," + h.position.y.toFixed(1) + "," + h.position.z.toFixed(1) + ") " + chain +
          (inter ? " interactable mode=" + inter.targetingMode + (inter.enabled ? "" : " DISABLED") : " no-interactable"))
        if (first === "(none)" && inter && inter.enabled && takes) first = obj.name
      }
      print("[RAY] <" + tag + "> " + hits.length + " hits; SIK would pick: " + first)
    })
  }

  /**
   * PASS 47 VERIFICATION — where the DRAWN frame is against the STAMPED rectangle, right
   * now. The frame's corners were laid out in the root's local frame (layoutSelection);
   * this puts them back into the world through the root's live transform and measures
   * each against the true world position of the compositor's own stamp corner. Zero drift
   * means the pair is one object at this angle. Also prints the stamp centre in the
   * root's local frame, which is what must stay constant for a once-laid frame to hold.
   */
  debugFrameProbe(tag: string): void {
    const sel = this.stickers[this.selected]
    const stamp = this.stampFor(this.selected)
    if (!sel || !stamp || !this.lastCorners) { print("[FRAME] <" + tag + "> nothing selected / laid out"); return }
    const wt = this.selSpin.getTransform().getWorldTransform()
    let maxD = 0
    for (let k = 0; k < 4; k++) {
      const trueW = this.uvToWorld(sel.panel, stamp.corners[k].x, stamp.corners[k].y)
      const drawn = wt.multiplyPoint(this.lastCorners[k])
      maxD = Math.max(maxD, trueW.distance(drawn))
    }
    const centre = this.uvToWorld(sel.panel, sel.u, sel.v)
    const lc = this.selRoot.getTransform().getInvertedWorldTransform().multiplyPoint(centre)
    print("[FRAME] <" + tag + "> " + this.panels[sel.panel].name + " facing=" + this.panelFacing(sel.panel).toFixed(2) +
      " stamp centre in root-local=(" + lc.x.toFixed(2) + "," + lc.y.toFixed(2) + "," + lc.z.toFixed(2) + ")" +
      " corner drift max=" + maxD.toFixed(2) + " cm")
  }

  /**
   * PASS 44 VERIFICATION — drag the selected sticker HARD into an edge or corner of
   * `panel`: the pointer is aimed at the panel's clamp-rect edge itself (dirX/dirY in
   * -1/0/1), which is past where the sticker's centre may go, so the clamp stops it
   * exactly as a real drag past the edge does. Prints where it ended.
   */
  debugDragToEdge(panel: number, dirX: number, dirY: number): void {
    if (this.selected < 0) return
    const p = this.panels[panel]
    const right = dirX * (p.halfRightMesh * this.cmPerMesh - 0.3)
    const up = dirY * (p.halfUpMesh * this.cmPerMesh - 0.3)
    const d = this.cmToUv(panel, right, up)
    const target = this.uvToWorld(panel, p.rectU + d.x, p.rectV + d.y)
    const dir = target.sub(new vec3(0, 0, 0))
    if (dir.length < 1e-4) return
    this.dragToRay(new vec3(0, 0, 0), dir.normalize())
    const s = this.stickers[this.selected]
    print("[EDGE] " + p.name + " dir(" + dirX + "," + dirY + ") -> sticker on " + this.panels[s.panel].name +
      " (" + s.u.toFixed(3) + "," + s.v.toFixed(3) + ") scale=" + s.scale.toFixed(2))
  }

  /**
   * Verification entry point (Pass 16): drag the SELECTED sticker onto `panel` at
   * (u,v) through the REAL surface-drag path — a synthetic ray from the camera aimed at
   * that point, pushed into the same ray -> panel -> uv -> hop -> clamp code a pinch-drag
   * uses. Prints where the sticker actually ended up, so a capture can be checked
   * against the panel it claims to be on.
   */
  debugDragTo(panel: number, u: number, v: number): void {
    if (this.selected < 0) return
    // Negative uv means "that panel's own clamp-rect centre", so a caller can say
    // "drag it to the back" without knowing the back's atlas coordinates.
    if (u < 0 || v < 0) {
      u = this.panels[panel].rectU
      v = this.panels[panel].rectV
    }
    const target = this.uvToWorld(panel, u, v)
    const dir = target.sub(new vec3(0, 0, 0))
    if (dir.length < 1e-4) return
    this.dragToRay(new vec3(0, 0, 0), dir.normalize())
    const s = this.stickers[this.selected]
    print(
      "[DRAG] aimed at " + this.panels[panel].name + " (" + u.toFixed(3) + "," + v.toFixed(3) + ")" +
      " -> sticker on " + this.panels[s.panel].name + " (" + s.u.toFixed(3) + "," + s.v.toFixed(3) + ")" +
      " art=" + s.art.name
    )
  }

  /** One line per placed sticker, so a capture can be checked against the list. */
  private printStack(): void {
    print("[STACK] n=" + this.stickers.length + " selected=" + this.selected)
    for (let i = 0; i < this.stickers.length; i++) {
      const s = this.stickers[i]
      print(
        "[STACK]  #" + i + " " + this.panels[s.panel].name +
        " uv=(" + s.u.toFixed(3) + "," + s.v.toFixed(3) + ")" +
        " scale=" + this.effScale(s).toFixed(2) + " side=" + this.sideCm(s).toFixed(2) + "cm" +
        " rot=" + s.rotDeg.toFixed(0) + "deg"
      )
    }
  }

  /** Frame-vs-stamp agreement for the selected sticker, in numbers. */
  private printFrameFit(stamp: Stamp, c: vec3[]): void {
    const s = this.stickers[this.selected]
    if (!s) return
    let fw = 0
    let fh = 0
    for (let k = 0; k < 4; k++) { fw += Math.abs(c[k].x) / 4; fh += Math.abs(c[k].y) / 4 }
    print(
      "[FIT] " + this.panels[s.panel].name + " stamp side=" + stamp.sideCm.toFixed(3) +
      "cm half=" + (stamp.sideCm / 2).toFixed(3) +
      " uv footprint half=(" + stamp.hu.toFixed(4) + "," + stamp.hv.toFixed(4) + ")"
    )
    print("[FIT] frame half from stamp corners = " + fw.toFixed(3) + " x " + fh.toFixed(3) + " cm")
  }

  // ---------------------------------------------------------------------------
  // Small builders
  // ---------------------------------------------------------------------------

  /** One flat, unlit, always-on-top shape. `rotZ` spins it in the frame's plane. */
  private addSolidShape(
    parent: SceneObject,
    mesh: RenderMesh,
    pos: vec3,
    scale: vec3,
    color: vec4,
    rotZ: number = 0,
    /**
     * Pass 38: where this part sits in the frame's draw stack. depthTest is off on every
     * one of these, so this is the ONLY thing that orders them — see FRAME_ORDER_GLOW.
     */
    renderOrder: number = 0
  ): SceneObject {
    const obj = global.scene.createSceneObject("SelPart")
    obj.setParent(parent)
    const tf = obj.getTransform()
    tf.setLocalPosition(pos)
    tf.setLocalScale(scale)
    if (rotZ !== 0) tf.setLocalRotation(quat.angleAxis(rotZ, new vec3(0, 0, 1)))

    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = mesh
    const mat = MOTE_MAT.clone() // base-tex OFF → renders solid baseColor
    uiFlatPass(mat.mainPass, color, false) // Pass 43; depth off: the overlay is always on top of the shirt
    visual.renderOrder = renderOrder
    visual.clearMaterials()
    visual.addMaterial(mat)
    return obj
  }
}


/**
 * How much a square's axis-aligned footprint grows when it is turned: |cos| + |sin|, so
 * 1.0 upright and sqrt(2) at 45 degrees. Measured in the panel's CLOTH frame, where the
 * sticker really is a square, so the panel's atlas rotation does not enter into it.
 */
function footprintGrowth(rotDeg: number): number {
  const r = (rotDeg * Math.PI) / 180
  return Math.abs(Math.cos(r)) + Math.abs(Math.sin(r))
}

/**
 * How much a rotated RECTANGLE's axis-aligned footprint grows on each cloth axis, as a
 * multiple of half the artwork's long side (Pass 16).
 *
 * A w x h rectangle turned by t has an axis-aligned bounding box of
 *   (w|cos t| + h|sin t|) x (w|sin t| + h|cos t|)
 * which for w = h collapses to the square case both ways — so a built-in flower gets
 * exactly the number footprintGrowth() has always returned, and the seam clamp for the
 * three original stickers is bit-for-bit what it was.
 */
function footprintGrowth2(rotDeg: number, wFrac: number, hFrac: number): { right: number; up: number } {
  const r = (rotDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  return { right: wFrac * c + hFrac * s, up: wFrac * s + hFrac * c }
}

/** Wrap an angle difference into (-180, 180] so a rotate drag never spins the long way. */
function shortestDelta(deg: number): number {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}
