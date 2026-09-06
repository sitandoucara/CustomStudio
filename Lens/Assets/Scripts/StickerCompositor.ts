// StickerCompositor — bakes the fabric texture + flower sticker(s) into a live
// render-target texture, so the flower appears PAINTED onto the shirt (following its
// UVs / folds) rather than floating in front of it.
//
// Pass 7 — COLOR LIVES IN THE COMPOSITE (sticker over tint):
//   The shirt color is no longer a global baseColorFactor multiply (which darkened the
//   baked flower too). Instead the FABRIC layer is painted with the chosen slider color
//   (setFabricColor → the full-frame fabric quad's baseColor), so the color becomes part
//   of the texture itself. The flower is then stamped ON TOP at its FULL, TRUE colors
//   (alpha-blended, no multiply). The shirt material's baseColorFactor is set neutral
//   white by ScarfController, so nothing globally multiplies the flower. Fabric realism
//   (wrinkles/weave) is preserved by the shirt's normal + roughness maps, which are
//   untouched — a flat-ish albedo is fine. Result: every flower keeps its real colors on
//   any shirt color, and the shirt can reach true white and fully-saturated hues.
//
// How it works (off-scene render-to-texture):
//   - A dedicated orthographic Camera renders a small quad rig into a RenderTarget
//     texture (`rt`). The whole rig is parked FAR off to the side (RIG_OFFSET) so the
//     main scene camera never sees the quads and the ortho camera only frames its own
//     quads (the main scene is outside its narrow frustum).
//   - A full-frame quad draws the original fabric baseTex → rt reproduces the fabric
//     1:1 (rt UV == shirt UV). Flower quads then draw on top at the front-chest UV rect.
//   - `rt` is fed to the shirt via ScarfController.setBaseTexture(). Because the shirt
//     samples `rt` with its own mesh UVs, the flower lands wherever its quad sits in UV
//     space and deforms with the fabric. The live color slider (setTint → baseColor
//     multiply) keeps working on top, since tint is independent of baseTex.
//
// Pass 10 — MANY STICKERS, ONE BAKE, ONE SOURCE OF TRUTH:
//   The quad pool now holds the whole placed STACK, drawn in list order (index 0 at
//   the bottom, the last one on top — the bake camera has depth testing off, so draw
//   order alone decides who covers whom). The caller re-sends the complete list on
//   every change instead of adding draws, so a delete is a genuine removal: the next
//   bake simply does not contain that quad, and everything under it is untouched.
//   And setStickers now RECORDS what it drew, as a `Stamp` per sticker (see below) —
//   the rectangle the selection frame is built from, so the frame can never be
//   computed from a parallel calculation again.
//
// The quad material is a base-texture-enabled ImageMaterial (unlit, alpha-blended),
// created at bootstrap as Materials/StickerQuadMat.mat.

// (no imports from Stickers: since Pass 11 a placement carries its own panel metrics)

import { LAYERS, setLayerDeep } from "./Layers"

const QUAD_MAT = requireAsset("../StickerQuadMat.mat") as Material

const RT_SIZE = 1024 // render-target resolution (square)
const ORTHO = 100 // world units spanning the full square ortho frustum
const RIG_OFFSET = new vec3(6000, 0, 0) // parked far off-axis; main camera never frames it
// Pass 23: a second rig (the socks' second bake target) is parked this much further along
// +X. Both rigs are on the bake layer and each rig's camera renders that whole layer, so
// two rigs at ONE spot would each bake the other's quads as well — which is exactly what
// happened before this spacing existed: one sock showed a streak of the other's daisy,
// and both lost their paint under the other rig's opaque fabric quad. ORTHO is 100, so
// 500 apart leaves each camera's frustum with nothing but its own rig in it.
const RIG_SLOT_SPACING = 500

// UV -> world sign flips. Render targets can be Y-flipped vs. sampling; if calibration
// shows the bake mirrored/inverted, flip the matching flag here (no other math changes).
const FLIP_U = false
const FLIP_V = false

interface Quad {
  frame: SceneObject // carries the position + the panel-aspect scale
  obj: SceneObject // child: carries the rotation + a UNIFORM world-cm scale
  visual: RenderMeshVisual
  mat: Material
}

/**
 * THE stamped rectangle — the single source of truth for "where the artwork is"
 * (Pass 10, point 2).
 *
 * Every consumer that needs to know where a flower landed reads this, because it
 * is not a description of the stamp, it IS the stamp: setStickers() drives the
 * quad's SceneObject transforms from these exact numbers and stores the object in
 * the same breath. Before Pass 10 the selection frame ran its own parallel sizing
 * (STICKER_UV_HALF x the measured cm-per-uv, then +FRAME_PAD, positioned through
 * the affine UV_MAP), which is how the frame and the artwork drifted apart.
 *
 * `corners` are the four corners of the quad, in the shirt's UV atlas, in the
 * order (-1,-1), (+1,-1), (+1,+1), (-1,+1) of the unit quad — i.e. bottom-left,
 * bottom-right, top-right, top-left as the user sees them on the shirt front.
 */
export interface Stamp {
  uc: number
  vc: number
  sideCm: number // the artwork's LONG side in world cm; see wFrac/hFrac
  wFrac: number // Pass 16: the quad is sideCm*wFrac by sideCm*hFrac. Both 1 = square.
  hFrac: number
  rotRad: number // the sticker's turn PLUS the panel's atlas rotation
  cmPerU: number
  cmPerV: number
  sigma: number // Pass 26: the atlas handedness the stamp was computed with
  corners: vec2[] // 4 UV corners, BL, BR, TR, TL
  hu: number // half-extents of the corners' axis-aligned UV bbox — what the seam
  hv: number // clamp has to fit inside the panel (Pass 11)
}

/**
 * A sticker to composite: which texture, where in the shirt UV atlas, how big it is on
 * the cloth, how far it is turned — and, since Pass 11, WHICH PANEL's unwrap it is
 * being stamped into.
 *
 * `sideCm` is the sticker's real size on the fabric. Making the physical size the
 * primary quantity (Pass 10 carried a UV half-extent instead) is what lets a sticker
 * hop from the chest to the back or a sleeve without changing size: each panel's atlas
 * has its own cm-per-uv, and the same sideCm simply becomes a different UV rectangle.
 *
 * `rotDeg` is still just the CCW angle the user sees on the panel they are looking at.
 * `atlasRotDeg` is how far that panel's unwrap is turned in the atlas (0 for both
 * torsos, 30-152 degrees for the sleeves); the two are added, so the call site never
 * has to think about it. The nested quad transform (see makeQuad) absorbs the atlas
 * anisotropy and the atlas mirror as before.
 */
export interface StickerPlacement {
  tex: Texture
  uc: number
  vc: number
  sideCm: number
  rotDeg: number
  cmPerU: number
  cmPerV: number
  atlasRotDeg: number
  /** Pass 16 — aspect, as fractions of the long side. Built-ins are 1, 1. */
  wFrac: number
  hFrac: number
  /** Pass 16 — the artwork's trimmed quad, or null for the plain 0..1 one. */
  mesh: RenderMesh | null
  /**
   * Pass 26 — the atlas's HANDEDNESS at this spot: -1 where +u runs to the viewer's left
   * (the shirt, and as it turns out every garment here), +1 where it runs right. Measured
   * from the cloth (StickerSystem.frameAt) rather than assumed. Absent means -1.
   */
  sigma?: number
}

export function buildUnitQuad(): RenderMesh {
  const b = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  // Centered unit quad in the XY plane, UV 0..1 (bottom-left origin).
  b.appendVerticesInterleaved([
    -0.5, -0.5, 0, 0, 0,
    0.5, -0.5, 0, 1, 0,
    0.5, 0.5, 0, 1, 1,
    -0.5, 0.5, 0, 0, 1,
  ])
  b.appendIndices([0, 1, 2, 0, 2, 3])
  b.updateMesh()
  return b.getMesh()
}

/**
 * The same centred unit quad, but sampling only the sub-rectangle [u0,u1] x [v0,v1] of
 * its texture (Pass 16).
 *
 * This is how imported artwork is trimmed. The alternative — reading the image back,
 * cropping the pixels and uploading a new texture — costs a full GPU->CPU->GPU round
 * trip and a second copy of every image in memory, to achieve something the texture
 * coordinates can express for free. Here the artwork's alpha bounds simply become the
 * quad's UVs, so the quad IS the visible artwork and everything downstream that reasons
 * about the quad's corners is automatically reasoning about the ink.
 */
export function buildUnitQuadUV(u0: number, v0: number, u1: number, v1: number): RenderMesh {
  const b = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ])
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  b.appendVerticesInterleaved([
    -0.5, -0.5, 0, u0, v0,
    0.5, -0.5, 0, u1, v0,
    0.5, 0.5, 0, u1, v1,
    -0.5, 0.5, 0, u0, v1,
  ])
  b.appendIndices([0, 1, 2, 0, 2, 3])
  b.updateMesh()
  return b.getMesh()
}

/**
 * A 1x1 opaque white, built once. PhotoUi has an identical helper, but PhotoUi imports
 * this file for buildUnitQuad, so borrowing it would close an import cycle for four
 * pixels. Two lines is the cheaper answer.
 */
let _bakeWhite: Texture | null = null
function bakeWhite(): Texture {
  if (!_bakeWhite) {
    _bakeWhite = ProceduralTextureProvider.createWithFormat(1, 1, TextureFormat.RGBA8Unorm)
    const c = _bakeWhite.control as ProceduralTextureProvider
    c.setPixels(0, 0, 1, 1, new Uint8Array([255, 255, 255, 255]))
  }
  return _bakeWhite
}

export class StickerCompositor {
  private rt: Texture
  private rig!: SceneObject
  private quadMesh: RenderMesh

  private fabricQuad!: Quad // full-frame background quad — painted with the shirt color
  private paintQuad!: Quad // Pass 17: the persistent paint texture, over the fabric
  private stickerQuads: Quad[] = [] // pool of flower quads (one per placed sticker)
  private stamps: Stamp[] = [] // what each live quad actually stamped — see Stamp

  // How many world cm one unit of atlas u / v spans on the front panel. Defaults match
  // the measured values; StickerSystem overwrites them with live measurements in init().
  constructor(parent: SceneObject, fabricTex: Texture | null, slot: number = 0) {
    this.quadMesh = buildUnitQuad()

    // Live render-target texture.
    this.rt = global.scene.createRenderTargetTexture()
    const ctrl = this.rt.control as RenderTargetProvider
    ctrl.useScreenResolution = false
    ctrl.resolution = new vec2(RT_SIZE, RT_SIZE)
    ctrl.clearColor = new vec4(0.5, 0.5, 0.5, 1)

    // Rig parked far off-axis so the main camera never frames these quads.
    this.rig = global.scene.createSceneObject("StickerCompositorRig")
    this.rig.setParent(parent)
    this.rig.getTransform().setLocalPosition(RIG_OFFSET.add(new vec3(slot * RIG_SLOT_SPACING, 0, 0)))

    // Orthographic camera → renders the quads into rt, BEFORE the main camera each frame.
    const camObj = global.scene.createSceneObject("StickerCompositorCam")
    camObj.setParent(this.rig)
    camObj.getTransform().setLocalPosition(new vec3(0, 0, 60)) // looks -Z toward quads at z≈0
    const cam = camObj.createComponent("Component.Camera") as Camera
    cam.type = Camera.Type.Orthographic
    cam.size = ORTHO
    cam.aspect = 1
    cam.near = 1
    cam.far = 300
    cam.devicePropertyUsage = Camera.DeviceProperty.None
    cam.renderOrder = -10 // render the bake before the main camera (order 0) uses it
    cam.renderTarget = this.rt
    // Pass 12: the bake rig gets a layer of its own and the bake camera is restricted to
    // it. Parking the rig 6000 cm off-axis already kept the main camera from framing it;
    // saying so as a layer makes it a rule instead of a distance, and — the reason it is
    // done in this pass — guarantees the rig can never wander into the PHOTO camera's
    // frustum, which frames a much smaller volume around the shirt.
    cam.renderLayer = LAYERS.bake

    // Full-frame fabric quad — reproduces the fabric 1:1 into rt (rt UV == shirt UV).
    // Its baseColor is the SHIRT COLOR (set live via setFabricColor); fabricTex is the
    // shirt's 1x1 white base texture, so baseColor becomes the flat fabric albedo.
    this.fabricQuad = this.makeQuad(fabricTex, new vec3(0, 0, 0), new vec3(ORTHO, ORTHO, 1), true /*opaque bg*/)

    // PASS 17 — THE PAINT LAYER, and the reason it is created HERE.
    //
    // The bake draws with depth testing off and relies on DRAW ORDER, which is hierarchy
    // order, which is creation order. This quad is made after the fabric and before the
    // first sticker quad, so the stack is fabric -> paint -> stickers permanently, by
    // construction rather than by a sort key someone could later get wrong. Painting
    // across a sticker therefore cannot touch it, and recolouring the fabric cannot
    // disturb either.
    //
    // It is alpha-blended over the fabric, so unpainted texels (alpha 0) show the shirt
    // colour and painted ones reach full alpha — paint is opaque over the base, never a
    // tint of it. The texture itself is set later by setPaintTexture(), because the
    // PaintLayer that owns it is built by StickerSystem.
    this.paintQuad = this.makeQuad(null, new vec3(0, 0, 0.25), new vec3(ORTHO, ORTHO, 1), false)
    this.paintQuad.frame.enabled = false // nothing to draw until a PaintLayer is attached

    setLayerDeep(this.rig, LAYERS.bake)
  }

  /**
   * Attach the paint texture. Called once, when StickerSystem builds its PaintLayer.
   *
   * The quad stays enabled from then on: an all-transparent paint texture composites to
   * nothing, so there is no state to toggle and no branch that can be got wrong. Clearing
   * the paint zeroes the texture rather than hiding the quad.
   */
  setPaintTexture(tex: Texture | null): void {
    if (!tex) {
      this.paintQuad.frame.enabled = false
      return
    }
    try { (this.paintQuad.mat.mainPass as any).baseTex = tex } catch (_e) { /* ignore */ }
    this.paintQuad.frame.enabled = true
  }

  /**
   * Pass 18: point the FABRIC layer at a different garment's albedo (or at nothing).
   *
   * There is one compositor for the whole Lens, not one per garment — only one garment is
   * ever on screen, so a second 1024 render target would be four megabytes rendering a
   * picture nobody is looking at. Switching garments therefore re-points this quad rather
   * than building a second rig. `null` leaves the fabric as flat colour, which is what a
   * garment whose own albedo carries someone else's print needs (see
   * GarmentDef.fabricFromAlbedo).
   */
  setFabricTexture(tex: Texture | null): void {
    const pass: any = this.fabricQuad.mat.mainPass
    try { pass.baseTex = tex ? tex : bakeWhite() } catch (_e) { /* ignore */ }
  }

  /** The live baked texture to feed into ScarfController.setBaseTexture(). */
  getOutputTexture(): Texture {
    return this.rt
  }

  /**
   * Pass 23: a second bake rig exists only for a garment with two print targets (the
   * socks). While any other garment is on screen it is switched off wholesale, so its
   * camera does not redraw a picture nobody samples every frame.
   */
  setEnabled(on: boolean): void {
    this.rig.enabled = on
  }

  /**
   * Paint the FABRIC layer with the chosen shirt color. The color becomes part of the
   * baked texture (not a global multiply), so a flower stamped on top keeps its true
   * colors regardless of shirt color, and the shirt can reach true white / vivid hues.
   * The RT is redrawn every frame by the bake camera, so this takes effect immediately.
   */
  setFabricColor(c: vec4): void {
    const pass: any = this.fabricQuad.mat.mainPass
    try { pass.baseColor = new vec4(c.x, c.y, c.z, 1) } catch (_e) { /* ignore */ }
  }

  /**
   * Composite the given stickers onto the fabric — the WHOLE stack, in order, with
   * `placements[0]` at the bottom and the last one on top.
   *
   * Pass 10: this is the only way stickers ever reach the shirt. The caller keeps the
   * authoritative list and re-sends all of it on every change (place / drag / resize /
   * rotate / delete), so the bake is always a fresh, complete re-stamp rather than an
   * accumulation of draws that cannot be undone. That is why deleting sticker #2 of 4
   * genuinely removes it and leaves the other three untouched: the render target is
   * redrawn from scratch by the bake camera every frame anyway, and this call simply
   * changes what it draws. Quads are POOLED, so a delete costs no allocation and a
   * re-place reuses the quad that was just freed.
   *
   * An empty list clears (fabric only).
   */
  setStickers(placements: StickerPlacement[]): void {
    // Ensure we have enough flower quads in the pool.
    while (this.stickerQuads.length < placements.length) {
      const q = this.makeQuad(null, vec3.zero(), new vec3(1, 1, 1), false /*alpha*/)
      this.stickerQuads.push(q)
    }
    this.stamps.length = placements.length
    for (let i = 0; i < this.stickerQuads.length; i++) {
      const q = this.stickerQuads[i]
      if (i < placements.length) {
        const p = placements[i]
        try { (q.mat.mainPass as any).baseTex = p.tex } catch (_e) { /* ignore */ }
        // Pass 16: imported artwork brings its own quad, whose UVs are its alpha bounds.
        // Pooled quads are reused across stickers, so this is reassigned every bake
        // rather than only when the quad is made.
        q.visual.mesh = p.mesh ? p.mesh : this.quadMesh

        // ONE computation. `stamp` is what we are about to draw AND what we hand back
        // to anyone who asks where the artwork is (getStamp) — the transforms below are
        // driven from its fields, so a frame built on it cannot drift from the artwork.
        const stamp = this.computeStamp(p)
        this.stamps[i] = stamp

        const pos = this.uvToWorld(stamp.uc, stamp.vc)

        // Parent: park the sticker at its atlas position and hold the cm -> atlas
        // conversion. The negative x is the atlas mirror (see makeQuad).
        const frameTf = q.frame.getTransform()
        frameTf.setLocalPosition(new vec3(pos.x, pos.y, 0.5)) // 0.5cm in front of the fabric quad
        frameTf.setLocalScale(new vec3(stamp.sigma * ORTHO / stamp.cmPerU, ORTHO / stamp.cmPerV, 1)) // Pass 26: the mirror is the atlas's own handedness

        // Child: a world-cm RECTANGLE in the artwork's own aspect (a square for every
        // built-in), turned by the angle the user sees.
        const tf = q.obj.getTransform()
        tf.setLocalScale(new vec3(stamp.sideCm * stamp.wFrac, stamp.sideCm * stamp.hFrac, 1))
        tf.setLocalRotation(quat.angleAxis(stamp.rotRad, new vec3(0, 0, 1)))
        q.frame.enabled = true
      } else {
        q.frame.enabled = false
      }
    }
  }

  /**
   * What the compositor actually stamped for sticker `i`, or null if there is no such
   * sticker. This is the single source of truth the selection frame is built from.
   */
  getStamp(i: number): Stamp | null {
    return i >= 0 && i < this.stamps.length ? this.stamps[i] : null
  }

  /** Turn a placement into THE stamped rectangle. See computeStampFor(). */
  private computeStamp(p: StickerPlacement): Stamp {
    return computeStampFor(
      p.uc, p.vc, p.sideCm, p.rotDeg, p.cmPerU, p.cmPerV, p.atlasRotDeg, p.wFrac, p.hFrac, p.sigma ?? -1
    )
  }

  /** Clear all stickers (restore plain fabric). */
  clear(): void {
    this.setStickers([])
  }

  private uvToWorld(uc: number, vc: number): vec2 {
    const x = (uc - 0.5) * ORTHO * (FLIP_U ? -1 : 1)
    const y = (vc - 0.5) * ORTHO * (FLIP_V ? -1 : 1)
    return new vec2(x, y)
  }

  /**
   * A quad is built as TWO nested SceneObjects, and the nesting is load-bearing.
   *
   * The atlas is anisotropic over the front panel (~42.6 cm per u against ~46.1 cm per
   * v), so a single object that is scaled and then rotated cannot stay square once it
   * turns — at 90 deg it comes out 17% stretched. Nesting fixes that exactly, because
   * the parent's scale is applied AFTER the child's rotation:
   *
   *     world = S_parent . R(theta) . uniform(side) . mesh
   *
   * The child does a UNIFORM scale (so the quad is a true square in world cm) and the
   * rotation; the parent then converts world cm into atlas units with a non-uniform
   * scale. The result is an exact square at an exact angle for every theta. The
   * parent's NEGATIVE x scale is the atlas mirror (increasing u runs to the viewer's
   * left), and it also flips the handedness, so `rotDeg` can be passed straight through
   * as the CCW angle the user sees — no sign juggling anywhere.
   */
  private makeQuad(tex: Texture | null, pos: vec3, scale: vec3, opaque: boolean): Quad {
    const frame = global.scene.createSceneObject(opaque ? "FabricQuadFrame" : "StickerQuadFrame")
    frame.setParent(this.rig)
    frame.getTransform().setLocalPosition(pos)

    const obj = global.scene.createSceneObject(opaque ? "FabricQuad" : "StickerQuad")
    obj.setParent(frame)
    const tf = obj.getTransform()
    tf.setLocalScale(scale)

    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = this.quadMesh
    const mat = QUAD_MAT.clone()
    const pass: any = mat.mainPass
    try { if (tex) pass.baseTex = tex } catch (_e) { /* ignore */ }
    try { pass.baseColor = new vec4(1, 1, 1, 1) } catch (_e) { /* ignore */ }
    try { pass.blendMode = opaque ? BlendMode.Normal : BlendMode.Normal } catch (_e) { /* ignore */ }
    try { pass.twoSided = true } catch (_e) { /* ignore */ }
    try { pass.depthTest = false } catch (_e) { /* ignore */ } // rely on draw order, not depth
    try { pass.depthWrite = false } catch (_e) { /* ignore */ }
    visual.clearMaterials()
    visual.addMaterial(mat)
    if (!opaque) frame.enabled = false // sticker quads start hidden
    // Pooled quads are created on demand as stickers are placed, so the layer is set
    // here rather than only in the constructor's sweep.
    setLayerDeep(frame, LAYERS.bake)

    return { frame, obj, visual, mat }
  }
}

/**
 * THE stamp geometry, as a pure function — the single place a sticker's rectangle in
 * the atlas is ever worked out (Pass 10's point 2, generalised to any panel in Pass 11).
 * StickerCompositor.setStickers() drives the quad transforms from its result, and
 * StickerSystem builds the selection frame AND the seam clamp from the same result, so
 * the three cannot drift apart.
 *
 * The four corner UVs are not an independent estimate of where the quad ends up — they
 * are the unit quad's own corners pushed through the exact transform chain that
 * makeQuad + setStickers build, written out in closed form:
 *
 *   corner_local = (qx/2, qy/2)                              the unit quad's corner
 *   corner_cm    = R(rot + atlasRot) . (sideCm * corner_local)      child transform
 *   atlas        = (-ORTHO/cmPerU, ORTHO/cmPerV) * corner_cm + atlas(uc,vc)
 *                                                                  parent transform
 *   uv           = 0.5 + atlas / ORTHO                              uvToWorld, inverted
 *
 * so ORTHO cancels: one unit of quad-local x is exactly -1/cmPerU of u (the negative
 * being the atlas mirror — increasing u runs to the viewer's LEFT on every panel of
 * this shirt) and one unit of quad-local y is 1/cmPerV of v.
 *
 * `atlasRotDeg` is added to the sticker's own angle because the panel's unwrap may be
 * turned in the atlas: both torsos are at 0, but the four sleeve halves sit at 30 to
 * 152 degrees, and folding it in here means everything upstream can keep talking about
 * the plain CCW angle the user sees.
 *
 * `hu`/`hv` are the half-extents of the corners' axis-aligned UV bounding box — the
 * rectangle that actually has to fit between the seams. Deriving the clamp from the
 * corners rather than from a separate footprint formula is what makes the rotated-and-
 * turned-atlas case exact instead of approximately right.
 */
export function computeStampFor(
  uc: number,
  vc: number,
  sideCm: number,
  rotDeg: number,
  cmPerU: number,
  cmPerV: number,
  atlasRotDeg: number,
  wFrac: number = 1,
  hFrac: number = 1,
  sigma: number = -1
): Stamp {
  const rotRad = ((rotDeg + atlasRotDeg) * Math.PI) / 180
  const cos = Math.cos(rotRad)
  const sin = Math.sin(rotRad)
  // Pass 16: half-extents per axis rather than one half-side. Everything below is
  // unchanged, and with wFrac = hFrac = 1 it computes exactly what it computed before —
  // which is why the built-in flowers cannot have shifted by so much as a pixel.
  const hx = (sideCm * wFrac) / 2
  const hy = (sideCm * hFrac) / 2
  const corners: vec2[] = []
  let hu = 0
  let hv = 0
  // BL, BR, TR, TL of the unit quad, as the user sees them on the panel.
  const QX = [-1, 1, 1, -1]
  const QY = [-1, -1, 1, 1]
  for (let k = 0; k < 4; k++) {
    const lx = hx * QX[k]
    const ly = hy * QY[k]
    const cx = lx * cos - ly * sin
    const cy = lx * sin + ly * cos
    const du = (sigma * cx) / cmPerU // Pass 26: sigma is the atlas handedness (-1 = +u runs left)
    const dv = cy / cmPerV
    if (Math.abs(du) > hu) hu = Math.abs(du)
    if (Math.abs(dv) > hv) hv = Math.abs(dv)
    corners.push(new vec2(uc + du, vc + dv))
  }
  return { uc, vc, sideCm, wFrac, hFrac, rotRad, cmPerU, cmPerV, sigma, corners, hu, hv }
}
