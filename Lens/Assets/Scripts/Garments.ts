// Garments — what a garment IS, and the two that exist (Pass 18).
//
// ===========================================================================
// THIS IS THE FILE A THIRD GARMENT IS ADDED TO
// ===========================================================================
// Everything that makes the shirt a shirt and the cap a cap lives in a GarmentDef:
// the prefab, how to size and centre it, its printable regions, its atlas metrics, and
// its sticker limits. Nothing else in the project knows there is more than one garment
// shape — the drag, the paint, the seam clamp, the selection frame, the compositor and
// the photo capture all read these numbers and would not notice a tote bag arriving.
//
// ADDING ONE is exactly five things, all of them in this file or next to it:
//   1. import the asset;
//   2. run `python3 tools/survey.py <name>` over its mesh — the same reader that produced
//      the shirt's Pass-11 table and the cap's — and READ ITS TWO VERDICTS before writing
//      any code. It reports every island with its triangle count, UV bounds, normal, cm
//      per uv, largest inscribed rect and max sticker scale, and then answers the only
//      two questions that can kill a garment outright: is the atlas MIRRORED (do the two
//      halves share UV space, so a sticker on the right also prints on the left), and do
//      any two islands OVERLAP. Neither is fixable downstream;
//   3. write the <Name>Panels.ts table it describes;
//   4. add a GarmentDef here — fit, panels, sticker limits, glyph — and push it into
//      GARMENTS;
//   5. there is no 5.
// No change to StickerSystem, PaintLayer, StickerCompositor, ScarfController, PhotoBooth,
// GarmentButtons or ScarfCustomizer: not one of them names a garment.
//
// ===========================================================================
// WHAT EACH GARMENT COSTS, AND WHERE THE CEILING IS
// ===========================================================================
// PER GARMENT, permanently, from the moment the Lens boots:
//   paint layer      2.0 MB   512 x 512 RGBA8, held twice — the CPU buffer that IS the
//                             drawing plus the GPU texture the bake samples. Allocated
//                             whether or not anything is ever drawn on it.
//   mesh + materials ~0.3-1 MB  vertex/index buffers plus the cloned material set. The
//                             cap is 14,690 triangles across 7 meshes, the shirt 2,640
//                             across 1.
//   its textures     whatever the asset ships, and this is the term that actually
//                             dominates. The cap brings TWO 2048 maps the shirt does not
//                             (a normal map, which is used, and the team-branded albedo,
//                             which is not — it is bound only so the crown material's
//                             ENABLE_BASE_TEX has something to point at before the bake
//                             takes over, and could be swapped for a 1x1 to reclaim it).
//   sticker list     a few hundred bytes.
//
// SHARED, and NOT multiplied by garment count: the bake render target (1024 RGBA8, 4 MB)
// and its camera, the selection frame, the hit slots, the paint capture plane, the photo
// booth's 896x1024 target. That is the deliberate part of the design — only one garment
// is ever on screen, so a second bake rig would be four megabytes redrawing a picture
// nobody is looking at, every frame.
//
// SO: two garments is fine, and not close to anything. The Lens's texture budget is the
// binding constraint long before the paint layers are, and the honest ceiling is roughly
// EIGHT to TEN garments at 512 paint — past that, either drop PAINT_SIZE to 256 (0.5 MB
// each, and at ~19 px/cm on the shirt front today, 256 would still be ~9 px/cm, which is
// visibly softer but not broken) or allocate paint lazily on the first stroke, which
// costs nothing until someone actually draws and would push the ceiling well past twenty.
// Neither is worth doing at two.
//
// ===========================================================================
// WHY THE SHIRT'S NUMBERS ARE RE-EXPORTED RATHER THAN RE-MEASURED
// ===========================================================================
// The generator reproduces ShirtPanels.ts to within 0.4% on normals and exactly on
// rect centres and atlas rotations, but its meshPerU/V differ by ~4% because it takes an
// area-weighted Jacobian where Pass 11 took a median edge ratio. Both are defensible;
// neither is worth a regression on a shipping garment. So the shirt keeps the table it
// has always had, and the generator is used only for garments that do not have one yet.
// That is also the honest general rule: a survey tool proposes numbers for NEW meshes,
// it does not get to overwrite numbers that are already known good on screen.

import { Panel, PANELS, PANEL_GRID } from "./ShirtPanels"
import { CAP_PANELS, CAP_PANEL_GRID } from "./CapPanels"
import { TOTE_PANELS, TOTE_PANEL_GRID } from "./TotePanels"
import { SOCKS_PANELS, SOCKS_PANEL_GRID } from "./SocksPanels"
import { pick } from "./UiTheme" // Pass 45: GARMENT_RAISE is a layout value, so it follows UI_STYLE
import {
  SHIRT_PREFAB_DEFAULT_SCALE,
  SHIRT_NATIVE_HEIGHT_CM,
  SHIRT_NATIVE_CENTER,
  SHIRT_TARGET_HEIGHT_CM,
  STICKER_SIDE_CM,
  STICKER_SCALE_MIN,
  STICKER_SCALE_MAX,
  STICKER_SCALE_INIT,
  STICKER_CASCADE_RIGHT_CM,
  STICKER_CASCADE_DOWN_CM,
  STICKER_CASCADE_WRAP,
} from "./Stickers"

/**
 * How to size and centre an imported prefab.
 *
 * `nativeCm` and `targetCm` are measured on the SAME axis, whichever one reads as the
 * garment's defining dimension: height for a shirt, width for a cap (a cap normalised on
 * height would tower over the composition, and one normalised on depth would be a brim
 * with a hat behind it). `center` is the prefab's bbox centre at its shipped scale, and
 * is subtracted so the bbox lands on the parent origin — which is what lets the rotation
 * platform spin the garment about its own middle rather than about an importer's pivot.
 */
export interface GarmentFit {
  prefabScale: number
  nativeCm: number
  targetCm: number
  center: { x: number; y: number; z: number }
  /**
   * Mesh space -> prefab-root-local. The ONE number that has to be read off the asset
   * rather than measured, and the one that would silently break a new garment if it were
   * assumed: the shirt's importer wrapped its mesh in an 0.01 node (a glTF metres-to-
   * centimetres conversion), the cap's did not. Every mesh<->world conversion in
   * StickerSystem goes through it — the panel grid, the seam clamp, the paint projection
   * and the cm-per-mesh measurement — so a garment with the wrong value here places
   * stickers hundreds of centimetres from the cloth rather than merely a little off.
   *
   * How to find it for a new garment: open its .prefab and multiply the Scale of every
   * node BELOW the root down to the RenderMeshVisual. Root scale itself is `prefabScale`.
   * (prefabScale x meshToLocal is 1 on both garments here, which is what makes `nativeCm`
   * simply the mesh's own span.)
   */
  meshToLocal: number
  /**
   * PASS 25 — where the garment RESTS. The fit centres the bbox on the parent origin,
   * which put a 12 cm cap in mid-air over the turntable. This is added to the visual's
   * local y after centring, so every garment's lowest point lands at GARMENT_REST_BOTTOM
   * regardless of its height. The pivot (and so the platform's spin axis) is unmoved;
   * everything glued to the cloth follows the visual. 0 for the shirt, whose hem was
   * already there.
   */
  restY?: number
}

/**
 * PASS 45 — the garments RISE off the turntable, all four by the same amount. With the
 * tool switch and the garment row gone from the top centre (UiTheme's top boxes) the
 * composition's free height runs from the rotation bar to the boxes' top line, and the
 * garments sit slightly higher in it. Only the garment moves: the turntable, its position
 * and size, and the rotation bar are exactly where they were, and the pivot (the spin
 * axis) is unmoved, so every fit, panel table and calibration is untouched — this is the
 * same `restY` offset Pass 25 seats each garment with, applied after centring.
 */
export const GARMENT_RAISE = pick(0, 2.0)
/** The y every garment's bottom edge is brought to: just above the turntable's rim (Pass 45: plus the raise). */
export const GARMENT_REST_BOTTOM = -13.5 + GARMENT_RAISE

/** One garment: its asset, its fit, its printable regions and its sticker limits. */
export interface GarmentDef {
  id: string
  /** Shown nowhere; used in logs and to name scene objects. */
  label: string
  prefab: ObjectPrefab
  fit: GarmentFit
  /** Printable regions. NOT islands — see the note at the top of CapPanels.ts. */
  panels: Panel[]
  /** Sampled mesh positions the panels index into. */
  panelGrid: number[]
  /** The long side of a sticker on this garment's cloth, in cm, at scale 1. */
  stickerSideCm: number
  scaleMin: number
  scaleMax: number
  scaleInit: number
  cascadeRightCm: number
  cascadeDownCm: number
  cascadeWrap: number
  /**
   * Does the compositor's FABRIC layer start from the mesh's own albedo?
   *
   * The fabric quad is `baseColour x albedo`, so this is only ever true when the albedo
   * is neutral. The shirt's is a 1x1 white, so it is; the cap ships a 2048 print of a
   * blue team cap with a logo on the crown and a cream sweatband, so feeding that in
   * would put someone else's branding under every colour the slider can reach. The cap
   * therefore composites onto flat colour, and its seams come back through the normal
   * map, which is untouched either way.
   */
  fabricFromAlbedo: boolean
  /**
   * PASS 21 — which of the garment's materials receive the BAKE. `null` means all of
   * them, which is what the shirt and the cap have always done and still do.
   *
   * The tote is why this exists. Its body mesh tiles its UVs across twenty copies of
   * the 0..1 square (a repeating canvas weave), so a sticker baked into that square would
   * print twenty times over the bag, front and back — measured: 93.7% of the body's
   * texels carry both a front-facing and a back-facing triangle once the tiling is
   * wrapped. Its front face is a separate mesh on its own material with a clean single
   * unwrap. So the bake goes to THAT material only, and every other material of the
   * garment takes the slider colour as a flat tint instead (ScarfController
   * .setNonPrintColor), so the whole bag still recolours as one object.
   *
   * Matched by material asset name. A garment whose list matches nothing prints a
   * warning at boot rather than silently showing a blank print surface.
   */
  printMaterials: string[] | null
  /**
   * PASS 23 — several BAKES, one per material group. Set only by a garment whose print
   * surfaces sit on separate materials but SHARE one UV chart, so that a single bake
   * sampled by all of them would print every sticker on every surface. The socks are
   * that garment: sock-left and sock-right are two meshes on two materials, and the
   * right sock's chart is the left's shifted 0.11 in u — 60% of their texels coincide.
   * Each group gets its own compositor and its own paint layer; every panel says which
   * (Panel.target) and every sticker and stroke goes into its panel's target only.
   * When set, `printMaterials` is ignored and any material in no group is tint-only.
   */
  printTargets?: string[][]
  /** The glyph on this garment's button, in the button's own -1..1 frame. */
  glyph: GlyphPart[]
}

/**
 * One flat shape of a button glyph, drawn in a -1..1 square centred on the button.
 *
 * Declarative rather than a draw function so a garment definition stays DATA — adding a
 * tote bag is a list of rectangles in this file, not a new method in the UI. It is the
 * same vocabulary every other glyph in the project is built from (see PhotoUi.addFlatShape
 * and the camera / bin / rotate glyphs): quads and discs, each with an in-plane turn.
 */
export interface GlyphPart {
  shape: "quad" | "disc"
  x: number
  y: number
  w: number
  h: number
  /** In-plane rotation, degrees CCW. */
  rot?: number
  /** Cut-outs are drawn in the plate colour over the body — see the shirt's neckline. */
  cut?: boolean
}

/** The shirt's importer wrapped its mesh in an 0.01 node. See GarmentFit.meshToLocal. */
export const SHIRT_MESH_TO_LOCAL = 0.01
/** The tee's hem is already at -13.5 when centred (27 cm tall); Pass 45 lifts it with the rest. */
export const SHIRT_REST_Y = GARMENT_RAISE

// ============================================================================
// THE BUTTON GLYPHS
// ============================================================================
// Geometry, like every other glyph in this project — no icon textures anywhere. Each is
// drawn in a -1..1 square and scaled to the button by GarmentButtons, so the two are the
// same optical size whatever the button is.
//
// `cut: true` parts are drawn in the button's own fill colour ON TOP of the body, which
// is how the tee gets a neckline and the cap gets a flat brim line without needing a
// second mesh builder: subtract by overdraw, the way the rotate glyph's arcs already do.

/** A tee, front on: two dropped sleeves, a body, and a scooped neck. */
export const SHIRT_GLYPH: GlyphPart[] = [
  { shape: "quad", x: -0.66, y: 0.34, w: 0.66, h: 0.86, rot: -16 }, // left sleeve
  { shape: "quad", x: 0.66, y: 0.34, w: 0.66, h: 0.86, rot: 16 },   // right sleeve
  { shape: "quad", x: 0, y: 0.46, w: 1.30, h: 0.72 },               // shoulder yoke
  { shape: "quad", x: 0, y: -0.34, w: 1.16, h: 1.44 },              // body
  { shape: "disc", x: 0, y: 0.80, w: 0.66, h: 0.46, cut: true },    // neckline
]

/**
 * A cap in PROFILE, brim to the right — the one silhouette that cannot be read as
 * anything else. (Front-on, a cap is a circle, which is a button, a lens or a dot.)
 *
 * The crown and the brim are two discs sitting on a common baseline, and the baseline is
 * the `cut` quad: both discs are drawn whole and their bottoms are then painted out in
 * the pill's fill. That is why the brim's own left edge does not have to be worked out —
 * it is simply tucked inside the crown, and the cut gives both a single flat underside.
 */
export const CAP_GLYPH: GlyphPart[] = [
  { shape: "disc", x: -0.32, y: 0.14, w: 1.50, h: 1.50 },           // crown
  { shape: "disc", x: 0.22, y: -0.42, w: 1.86, h: 0.62 },           // brim, out to the front
  { shape: "quad", x: 0, y: -1.00, w: 3.0, h: 1.00, cut: true },    // the baseline they sit on
  { shape: "disc", x: -0.32, y: 0.86, w: 0.26, h: 0.26 },           // top button
]

const SHIRT_PREFAB = requireAsset("../Garments/black_t-shirt/black_t-shirt.prefab") as ObjectPrefab
const CAP_PREFAB = requireAsset("../Garments/cap/cap.prefab") as ObjectPrefab

// --- The shirt. Exactly the values it has had since Pass 6 / Pass 11. ----------
export const SHIRT_DEF: GarmentDef = {
  id: "shirt",
  label: "T-shirt",
  prefab: SHIRT_PREFAB,
  fit: {
    prefabScale: SHIRT_PREFAB_DEFAULT_SCALE,
    nativeCm: SHIRT_NATIVE_HEIGHT_CM,
    targetCm: SHIRT_TARGET_HEIGHT_CM,
    center: SHIRT_NATIVE_CENTER,
    meshToLocal: SHIRT_MESH_TO_LOCAL,
    restY: SHIRT_REST_Y,
  },
  panels: PANELS,
  panelGrid: PANEL_GRID,
  stickerSideCm: STICKER_SIDE_CM,
  scaleMin: STICKER_SCALE_MIN,
  scaleMax: STICKER_SCALE_MAX,
  scaleInit: STICKER_SCALE_INIT,
  cascadeRightCm: STICKER_CASCADE_RIGHT_CM,
  cascadeDownCm: STICKER_CASCADE_DOWN_CM,
  cascadeWrap: STICKER_CASCADE_WRAP,
  fabricFromAlbedo: true, // the tee's own base map is a 1x1 white
  printMaterials: null, // every material prints, as it always has
  glyph: SHIRT_GLYPH,
}

// --- The cap ------------------------------------------------------------------
// Measured off the mesh across all seven parts: 20.9172 x 15.2009 x 32.3047 at the
// prefab's shipped scale, bbox centred at (-0.0096, 175.629, 5.2258) — the model sits
// ~176 units up the Y axis,
// so the recentre matters more here than it did for the shirt.
//
// NORMALISED ON WIDTH, not height. The shirt is 30 cm tall; a cap scaled to 30 cm tall
// would be a monstrous object, and one matched on depth would read as a brim with a hat
// somewhere behind it. Matching the shirt's 26.5 cm WIDTH puts the two garments at the
// same visual weight in the same frame, which is what "comparable on-screen size" means
// when the two shapes are this different.
export const CAP_PREFAB_DEFAULT_SCALE = 1
// No unit-conversion node anywhere under the cap's prefab root: 1 mesh unit IS 1 local
// unit. (The shirt's importer inserted an 0.01 one — see GarmentFit.meshToLocal.)
export const CAP_MESH_TO_LOCAL = 1.0
export const CAP_NATIVE_WIDTH_CM = 20.9172
// Pass 25: 17 cm wide, down from 26 — a cap is small next to a tee (0.73 of the tee's
// 23.4 cm sleeve span; a real cap is nearer 0.5 but reads as a button at that size).
// CAP_FIT_K scales every cm-on-cloth number below with it.
// Pass 46: 20 -> 22, a step larger (the cap read small next to the tee); still 0.83 of the
// tee's 26.5 cm width, so a cap is still smaller than a shirt. CAP_FIT_K carries every
// cm-on-cloth number below with it (the sticker side, the cascade); the panel rects are
// in mesh units and follow through the live cm-per-mesh measurement.
export const CAP_TARGET_WIDTH_CM = 22.0
export const CAP_FIT_K = CAP_TARGET_WIDTH_CM / 26.0
/** Pass 46: the cap alone rises this much more than the other garments — it read low. */
export const CAP_EXTRA_RAISE = pick(0, 1.5)
/** The cap's half-height at its target width: 14.6 cm tall at 20 wide, scaling with the width. */
export const CAP_HALF_HEIGHT_CM = 7.3 * (CAP_TARGET_WIDTH_CM / 20.0)
export const CAP_NATIVE_CENTER = { x: -0.0096, y: 175.629, z: 5.2258 }
// The cap's crown is a tighter surface than a torso: its usable regions run 9.7 to 21.5
// cm across, against the shirt front's 16.8 x 25.1. A sticker sized for a chest would
// swamp it, so the base side is smaller and the ceiling is lower — the numbers the
// survey reported as each panel's max upright scale are 1.07 to 1.43, and MAX sits just
// under the tightest of them so the seam clamp never has to fight the size clamp.
export const CAP_STICKER_SIDE_CM = 6.4 * CAP_FIT_K // 4.18
export const CAP_REST_Y = GARMENT_REST_BOTTOM + CAP_HALF_HEIGHT_CM + CAP_EXTRA_RAISE // Pass 46: 16.1 cm tall at 22 wide, plus its own lift
export const CAP_STICKER_SCALE_MIN = 0.4
export const CAP_STICKER_SCALE_MAX = 1.4
export const CAP_STICKER_SCALE_INIT = 0.85
export const CAP_CASCADE_RIGHT_CM = 1.5 * CAP_FIT_K
export const CAP_CASCADE_DOWN_CM = 1.8 * CAP_FIT_K
export const CAP_CASCADE_WRAP = 5

export const CAP_DEF: GarmentDef = {
  id: "cap",
  label: "Cap",
  prefab: CAP_PREFAB,
  fit: {
    prefabScale: CAP_PREFAB_DEFAULT_SCALE,
    nativeCm: CAP_NATIVE_WIDTH_CM,
    targetCm: CAP_TARGET_WIDTH_CM,
    center: CAP_NATIVE_CENTER,
    meshToLocal: CAP_MESH_TO_LOCAL,
    restY: CAP_REST_Y,
  },
  panels: CAP_PANELS,
  panelGrid: CAP_PANEL_GRID,
  stickerSideCm: CAP_STICKER_SIDE_CM,
  scaleMin: CAP_STICKER_SCALE_MIN,
  scaleMax: CAP_STICKER_SCALE_MAX,
  scaleInit: CAP_STICKER_SCALE_INIT,
  cascadeRightCm: CAP_CASCADE_RIGHT_CM,
  cascadeDownCm: CAP_CASCADE_DOWN_CM,
  cascadeWrap: CAP_CASCADE_WRAP,
  fabricFromAlbedo: false, // the cap's albedo is a blue team print — see the field note
  printMaterials: null, // both of its materials print
  glyph: CAP_GLYPH,
}

// --- The tote (Pass 21) --------------------------------------------------------
// Thirteen meshes, three materials, no textures. The bag's FRONT FACE is its own mesh
// (Object_12) on its own material with a clean 0..1 unwrap — that is the print surface
// and the only one. The body (Object_11) and the handle base (Object_8) tile their UVs
// across 20 and 6 copies of the atlas, so they are tint-only: see printMaterials.
//
// SIZED ON THE PRINT FACE'S HEIGHT, not the whole bag's. This tote is a portrait bag —
// body 2.10 x 2.37 mesh units with handles reaching 4.12 — so at the shirt's 30 cm total
// it would be 15 cm wide and the print face 17 cm tall. Fitting the face to 18.43 cm puts
// the whole bag at 32.0 cm with its handles (top at y +16.0, under the garment buttons at
// +17.1 and inside the paint plane's +/-17) and 16.3 cm wide. Centred on the WHOLE bag's
// bbox like the other two, so the rotation pivot is the bag's middle; the body therefore
// sits low in the frame and the handles high, which is what a tote looks like held up.
//
// The chain under the prefab root is Sketchfab -90 / GLTF +90 (identity) at a uniform
// 1.82197 on every part, so meshToLocal is 1.82197 and prefabScale its reciprocal.
const TOTE_PREFAB = requireAsset("../Garments/tote_bag/tote_bag.prefab") as ObjectPrefab
export const TOTE_MESH_TO_LOCAL = 1.82197
export const TOTE_PREFAB_DEFAULT_SCALE = 1 / TOTE_MESH_TO_LOCAL
export const TOTE_NATIVE_HEIGHT_CM = 2.3741 // the print face's height, mesh units
// Pass 25: the whole bag 22 cm tall with handles (was 32) — 0.81 of the tee's height,
// which is about what a tote is against a shirt. TOTE_FIT_K scales the cm numbers below.
// Pass 46: the whole bag 27.5 cm tall with handles (was 25.0) — a step larger, just
// under the tee's 27, so the proportions stay sane. TOTE_FIT_K scales the cm numbers below.
export const TOTE_BAG_HEIGHT_CM = 30.0 // Pass 47: 27.5 -> 30.0, a step larger again; nothing else about the tote changes
export const TOTE_TARGET_HEIGHT_CM = 18.43 * (TOTE_BAG_HEIGHT_CM / 32.0) // the print face's share of it
export const TOTE_FIT_K = TOTE_BAG_HEIGHT_CM / 32.0
export const TOTE_NATIVE_CENTER = { x: -0.0003, y: 2.0834, z: 0.0114 } // whole-bag bbox centre
// A 16.6 x 17.6 cm print face: between the shirt's chest and the cap's crown, so the
// sticker side sits between their 8.65 and 6.4. Max scale on the face is 2.24.
export const TOTE_STICKER_SIDE_CM = 7.0 * TOTE_FIT_K // 4.81
export const TOTE_REST_Y = GARMENT_REST_BOTTOM + TOTE_BAG_HEIGHT_CM / 2 // half the bag's height, handles included
export const TOTE_STICKER_SCALE_MIN = 0.45
export const TOTE_STICKER_SCALE_MAX = 2.0
export const TOTE_STICKER_SCALE_INIT = 1.0
export const TOTE_CASCADE_RIGHT_CM = 2.0 * TOTE_FIT_K
export const TOTE_CASCADE_DOWN_CM = 2.4 * TOTE_FIT_K
export const TOTE_CASCADE_WRAP = 6
/** The bag's front face. Everything else is tint-only — see GarmentDef.printMaterials. */
export const TOTE_PRINT_MATERIALS = ["Mat_Truoc_Tui.002"]

/** A tote, front on: a body under one wide handle loop. */
export const TOTE_GLYPH: GlyphPart[] = [
  { shape: "disc", x: 0, y: 0.46, w: 1.04, h: 0.92 },                 // handle, outer
  { shape: "quad", x: 0, y: -0.40, w: 1.44, h: 1.04 },                // body, over the handle's feet
  { shape: "disc", x: 0, y: 0.50, w: 0.70, h: 0.62, cut: true },      // handle, inner — leaves the loop
]

export const TOTE_DEF: GarmentDef = {
  id: "tote",
  label: "Tote bag",
  prefab: TOTE_PREFAB,
  fit: {
    prefabScale: TOTE_PREFAB_DEFAULT_SCALE,
    nativeCm: TOTE_NATIVE_HEIGHT_CM,
    targetCm: TOTE_TARGET_HEIGHT_CM,
    center: TOTE_NATIVE_CENTER,
    meshToLocal: TOTE_MESH_TO_LOCAL,
    restY: TOTE_REST_Y,
  },
  panels: TOTE_PANELS,
  panelGrid: TOTE_PANEL_GRID,
  stickerSideCm: TOTE_STICKER_SIDE_CM,
  scaleMin: TOTE_STICKER_SCALE_MIN,
  scaleMax: TOTE_STICKER_SCALE_MAX,
  scaleInit: TOTE_STICKER_SCALE_INIT,
  cascadeRightCm: TOTE_CASCADE_RIGHT_CM,
  cascadeDownCm: TOTE_CASCADE_DOWN_CM,
  cascadeWrap: TOTE_CASCADE_WRAP,
  fabricFromAlbedo: false, // it ships no albedo at all
  printMaterials: TOTE_PRINT_MATERIALS,
  glyph: TOTE_GLYPH,
}

// --- The socks (Pass 23) -------------------------------------------------------
// A Sketchfab PAIR: two meshes (sock-left-b, sock-right-b) on two materials (medias,
// medias.001), each 11,408 triangles, welded to 6,010 vertices apiece for the survey.
// They share one UV chart — see printTargets — so each sock is its own bake target and
// the pair is otherwise ONE garment: one colour, one pill, one rotation, one sticker
// list in which every sticker knows which sock it is on.
//
// SIZED ON WIDTH, like the cap. The pair is 1.22 times wider than it is tall and 1.28
// times deeper (the feet point at the camera), so normalised on the shirt's 30 cm height
// it would be 36.6 cm wide and spill past the paint plane's 34. At 28 cm wide the socks
// are 22.9 cm tall and 29.3 cm deep, each sock 7.5 cm across, centred on the pair's own
// bbox so the platform turns them about the gap between them.
//
// The chain under the prefab root is Sketchfab_model (X -90) / Socks.fbx (X +90, scale
// 0.01) / RootNode / sock-*-b (translation, scale 2748.479736): the rotations cancel,
// the net scale below the root is 27.484797, and the translation is baked into the panel
// grid by the survey (meshOffset) so root-local is meshToLocal x grid, as everywhere.
const SOCKS_PREFAB = requireAsset("../Garments/socks/socks.prefab") as ObjectPrefab
export const SOCKS_PREFAB_DEFAULT_SCALE = 100
export const SOCKS_MESH_TO_LOCAL = 27.484797
export const SOCKS_NATIVE_WIDTH_CM = 731.1451 // the pair's x-span at the prefab's shipped scale
// Pass 25: the pair 18 cm wide (was 28) -> 14.7 cm tall, 18.8 cm deep. Socks are the
// smallest garment here, and the pair still fills half the turntable. SOCKS_FIT_K scales
// the cm numbers below.
export const SOCKS_TARGET_WIDTH_CM = 21.0 // Pass 26: up from 18 -> 17.2 cm tall
export const SOCKS_FIT_K = SOCKS_TARGET_WIDTH_CM / 28.0
export const SOCKS_NATIVE_CENTER = { x: 159.017, y: 351.4316, z: 129.2278 } // whole-pair bbox centre, shipped scale
// A sock is 7.5 cm across on screen and its shin panel is 9 x 23 cm, so the sticker is the
// smallest of the four garments. Max scale on the shin is 2.0; MAX sits under it.
export const SOCKS_STICKER_SIDE_CM = 4.5 * SOCKS_FIT_K // 2.89
export const SOCKS_REST_Y = GARMENT_REST_BOTTOM + 8.6 // the pair is 17.2 cm tall at 21 wide
export const SOCKS_STICKER_SCALE_MIN = 0.4
export const SOCKS_STICKER_SCALE_MAX = 1.9
export const SOCKS_STICKER_SCALE_INIT = 1.0
export const SOCKS_CASCADE_RIGHT_CM = 1.2 * SOCKS_FIT_K
export const SOCKS_CASCADE_DOWN_CM = 1.5 * SOCKS_FIT_K
export const SOCKS_CASCADE_WRAP = 4
/** Left sock, then right sock: the material each bake target prints into. */
export const SOCKS_PRINT_TARGETS: string[][] = [["medias"], ["medias.001"]]
/**
 * PASS 39 — WHICH TARGET IS ON WHICH SIDE OF THE SCREEN. The Sketchfab names are the
 * WEARER'S left and right: sock-left-b (target 0, "medias") has its mesh at x +0.089..
 * +0.191 and stands on the RIGHT of the screen at yaw 0; sock-right-b (target 1) at
 * -0.075..+0.027 stands on the LEFT. The panel names (socksL*, socksR*) inherit the
 * same convention. The Left / Right selector speaks the viewer's frame — the pair is
 * looked at, not worn — so it maps a screen SIDE to a bake TARGET through this table,
 * measured off the meshes, rather than assuming target 0 is "left".
 */
export const SOCKS_SIDE_TARGET: number[] = [1, 0] // [screen-left, screen-right]

/**
 * A sock in PROFILE, toe to the right: a leg, a ribbed cuff a shade wider than it, and a
 * foot with a rounded heel and toe. One sock rather than two, because at 1.4 cm two
 * would be a pair of blobs and one sock already says "socks" the way one tee says
 * "t-shirts".
 */
export const SOCKS_GLYPH: GlyphPart[] = [
  { shape: "quad", x: -0.34, y: 0.22, w: 0.72, h: 1.36 },           // leg
  { shape: "quad", x: -0.34, y: 0.86, w: 0.92, h: 0.28 },           // cuff, a shade wider
  { shape: "quad", x: 0.18, y: -0.60, w: 1.40, h: 0.64 },           // foot, out to the toe
  { shape: "disc", x: -0.34, y: -0.60, w: 0.72, h: 0.64 },          // heel, rounded
  { shape: "disc", x: 0.86, y: -0.60, w: 0.64, h: 0.64 },           // toe, rounded
]

export const SOCKS_DEF: GarmentDef = {
  id: "socks",
  label: "Socks",
  prefab: SOCKS_PREFAB,
  fit: {
    prefabScale: SOCKS_PREFAB_DEFAULT_SCALE,
    nativeCm: SOCKS_NATIVE_WIDTH_CM,
    targetCm: SOCKS_TARGET_WIDTH_CM,
    center: SOCKS_NATIVE_CENTER,
    meshToLocal: SOCKS_MESH_TO_LOCAL,
    restY: SOCKS_REST_Y,
  },
  panels: SOCKS_PANELS,
  panelGrid: SOCKS_PANEL_GRID,
  stickerSideCm: SOCKS_STICKER_SIDE_CM,
  scaleMin: SOCKS_STICKER_SCALE_MIN,
  scaleMax: SOCKS_STICKER_SCALE_MAX,
  scaleInit: SOCKS_STICKER_SCALE_INIT,
  cascadeRightCm: SOCKS_CASCADE_RIGHT_CM,
  cascadeDownCm: SOCKS_CASCADE_DOWN_CM,
  cascadeWrap: SOCKS_CASCADE_WRAP,
  fabricFromAlbedo: false, // the socks' albedo is flat grey with someone else's brand doodle
  printMaterials: null, // superseded by printTargets
  printTargets: SOCKS_PRINT_TARGETS,
  glyph: SOCKS_GLYPH,
}

/** Every garment, in the order their buttons appear. The shirt is active at boot. */
export const GARMENTS: GarmentDef[] = [SHIRT_DEF, CAP_DEF, TOTE_DEF, SOCKS_DEF]
export const GARMENT_INIT = 0
