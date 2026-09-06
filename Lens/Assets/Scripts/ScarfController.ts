// ScarfController — plain helper class (NOT a @component) that owns ONE floating,
// idling, tintable GARMENT. Constructed and driven by the main ScarfCustomizer script.
//
// PASS 18. There is one of these per garment and they all live at once, only one of them
// enabled (setActive). Nothing in here knows what shape it is holding: the prefab, the
// scale, the recentre and the mesh-to-local factor all come out of the GarmentDef it was
// handed, so a third garment needs no change to this file at all. The name is Pass 1's
// (it held a scarf); it is kept because renaming it would touch every import for nothing.
//
// Live tint (texture-preserving): the GLB ships with its own PBR material carrying
// the knit fabric baseTex. We CLONE that material per instance and multiply its
// base color by the chosen tint. Because base color multiplies the texture in the
// shader, the fabric weave + shading stay fully intact — it tints the texture
// rather than flattening it to a solid color.
//
// Sticker-ready (prepare-the-ground only, NO stickers this pass): the material
// instance is owned by this controller, its fabric baseTex is kept intact and
// exposed via get/setBaseTexture(), and the texture source is indirected through a
// single swappable slot. A later pass can render fabric + UV-stamped flower
// stickers into a RenderTarget / dynamic texture and feed it through setBaseTexture()
// — the tint pipeline downstream is unchanged. See STICKER-READY note below.

import { GarmentDef } from "./Garments"

interface TintTarget {
  mat: Material
  /** The material asset's name, as matched against GarmentDef.printMaterials. */
  name: string
  /** Does the bake go here? False = this surface takes the slider colour as a flat tint. */
  print: boolean
  /** Pass 23: WHICH bake — the index into GarmentDef.printTargets, 0 for a single bake. */
  target: number
  /** The texture currently bound — the render target, once the compositor takes over. */
  baseTex: Texture | null
  /**
   * What the ASSET shipped, captured before anything was swapped in.
   *
   * Pass 18 needs this. setBaseTexture overwrites `baseTex` with the compositor's render
   * target, so after the first bind `getBaseTexture()` returns the bake — and asking for
   * the fabric source again, which is exactly what switching back to a garment does,
   * would feed the render target into its own fabric layer. Keeping the original is the
   * whole fix; nothing else changes.
   */
  originalTex: Texture | null
}

export class ScarfController {
  /** Everything shape-specific about the thing this controller is holding. */
  private def: GarmentDef
  private visual: SceneObject | null = null
  private pivot: SceneObject | null = null
  private tintTargets: TintTarget[] = []

  private baseLocalPos: vec3 = vec3.zero()
  private t: number = 0
  private yawRad: number = 0 // Pass 8: user-driven Y rotation; 0 = front-facing

  // Idle feel — the garment's IDLE is still a VERY subtle vertical bob only: no
  // turntable spin, no sway. The only rotation is the one the user dials in on the
  // platform slider (setYawDeg), which is applied about the bbox centre — see the
  // GarmentPivot note in the constructor.
  private static readonly BOB_AMPL = 0.4       // cm, tiny vertical bob
  private static readonly BOB_SPEED = 0.6      // rad/s

  /**
   * Instantiate the scarf GLB under `parent` and prepare its tint material(s).
   * The GLB is normalized to its target size at import, so default prefab scale is
   * left untouched (Hard Rule 6.8 — never rescale to convert units).
   */
  constructor(def: GarmentDef, parent: SceneObject) {
    this.def = def
    // Pass 8 — GarmentPivot. fitToScene() below offsets the visual by -center*k so
    // the mesh bbox lands on the parent origin; that means the VISUAL's own origin
    // is the mesh pivot, ~51 cm below and 1.65 cm behind the shirt. Spinning the
    // visual directly would orbit the shirt around that off-centre point (a visible
    // Z lurch as it turns). So we insert an empty pivot at the parent origin — i.e.
    // exactly at the shirt's bbox centre — and rotate THAT instead. The visual keeps
    // its fit offset + idle bob underneath, unchanged.
    this.pivot = global.scene.createSceneObject("GarmentPivot")
    this.pivot.setParent(parent)

    this.visual = def.prefab.instantiate(this.pivot)
    this.visual.name = "GarmentVisual"
    this.collectTintTargets(this.visual)
    if (def.printMaterials !== null && !this.tintTargets.some((t) => t.print)) {
      print("[GARMENT] " + def.id + ": none of its materials matched printMaterials " +
        JSON.stringify(def.printMaterials) + " — found " +
        JSON.stringify(this.tintTargets.map((t) => t.name)))
    }
    if (def.printTargets) {
      for (let k = 0; k < def.printTargets.length; k++) {
        if (!this.tintTargets.some((t) => t.target === k)) {
          print("[GARMENT] " + def.id + ": bake target " + k + " matched no material " +
            JSON.stringify(def.printTargets[k]) + " — found " +
            JSON.stringify(this.tintTargets.map((t) => t.name)))
        }
      }
    }
    // Pass 7: color now lives in the baked fabric layer (StickerCompositor.setFabricColor),
    // NOT in a global baseColorFactor multiply. Neutralize the shirt's base factor to white
    // so nothing globally multiplies (and darkens) the baked flower. Also drop metallic to 0
    // so the fabric albedo reads as a true diffuse color — this is what makes TRUE white and
    // fully-saturated hues reachable (a metallic base would reflect ambient and read muddy).
    // Wrinkle/weave realism still comes from the untouched normal + roughness maps.
    this.neutralizeShirtShading()
    // Pass 6: the imported prefab ships ~9 cm tall with a pivot ~15 cm below it,
    // so size + recenter it onto the parent (GarmentRoot) origin before we read
    // the idle base position. Old GLB shirts were already sized/centered; this is
    // the one imported-shirt adjustment (all numbers are named consts in Stickers).
    this.fitToScene()
    this.baseLocalPos = this.visual.getTransform().getLocalPosition()
  }

  /**
   * Scale the imported prefab to SHIRT_TARGET_HEIGHT_CM and recenter its bounding
   * box onto the parent origin. k scales the shipped prefab scale; the pivot
   * offset scales with k so the bbox center lands exactly on the parent origin.
   */
  private fitToScene(): void {
    if (!this.visual) return
    const f = this.def.fit
    const k = f.targetCm / f.nativeCm
    const tf = this.visual.getTransform()
    const s = f.prefabScale * k
    tf.setLocalScale(new vec3(s, s, s))
    tf.setLocalPosition(new vec3(-f.center.x * k, -f.center.y * k + (f.restY ?? 0), -f.center.z * k)) // Pass 25: restY seats it on the turntable
  }

  /** This garment's definition — the panel table, the fit, the sticker limits. */
  getDef(): GarmentDef {
    return this.def
  }

  /**
   * Pass 18: show or hide the whole garment.
   *
   * ONE garment is on screen at a time, and the inactive ones are disabled rather than
   * destroyed — their material clones, their baked texture binding and their tint state
   * are exactly what "going shirt -> cap -> shirt brings back what I left" is made of,
   * and rebuilding them on every switch would both cost a prefab instantiation and lose
   * the fabric-texture wiring. A disabled SceneObject renders nothing and costs nothing
   * per frame beyond its own existence.
   */
  setActive(on: boolean): void {
    if (this.pivot && !isNull(this.pivot)) this.pivot.enabled = on
  }

  /** Walk the instantiated hierarchy, clone every material so tints are instance-local. */
  private collectTintTargets(obj: SceneObject): void {
    const rmv = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null
    if (rmv) {
      const count = Math.max(1, rmv.getMaterialsCount())
      const clones: Material[] = []
      for (let i = 0; i < count; i++) {
        const src = i < rmv.getMaterialsCount() ? rmv.getMaterial(i) : rmv.mainMaterial
        const clone = src.clone()
        clones.push(clone)
        // The GLB ships a glTF-PBR material whose base texture is `baseColorTexture`
        // (NOT `baseTex`). Read that first, falling back to `baseTex` for SimplePBR-style
        // materials, so the fabric texture is captured regardless of shader family.
        let baseTex: Texture | null = null
        try { baseTex = (clone.mainPass as any).baseColorTexture ?? (clone.mainPass as any).baseTex ?? null } catch (_e) { baseTex = null }
        let name = ""
        try { name = src.name } catch (_e) { name = "" }
        // Pass 23: a garment with several bake targets names a material group per
        // target; one without them keeps the Pass 21 rule (printMaterials, or all).
        const groups = this.def.printTargets
        let target = -1
        if (groups) {
          for (let k = 0; k < groups.length; k++) if (groups[k].indexOf(name) >= 0) target = k
        } else {
          const list = this.def.printMaterials
          if (list === null || list.indexOf(name) >= 0) target = 0
        }
        const print = target >= 0
        this.tintTargets.push({ mat: clone, name, print, target, baseTex, originalTex: baseTex })
      }
      rmv.clearMaterials()
      clones.forEach((m) => rmv.addMaterial(m))
    }
    const childCount = obj.getChildrenCount()
    for (let i = 0; i < childCount; i++) {
      this.collectTintTargets(obj.getChild(i))
    }
  }

  /**
   * Multiply the scarf's base color by `color`, preserving the fabric texture.
   * Sets both `baseColor` (SimplePBR-style) and `baseColorFactor` (glTF-style) so
   * the tint lands regardless of which multiply uniform the imported shader exposes;
   * writing a uniform the shader lacks is a harmless no-op.
   */
  setTint(color: vec4): void {
    for (const target of this.tintTargets) {
      const pass = target.mat.mainPass as any
      try { pass.baseColor = color } catch (_e) { /* uniform absent — ignore */ }
      try { pass.baseColorFactor = color } catch (_e) { /* uniform absent — ignore */ }
    }
  }

  /**
   * Pass 7: set the global base-color multiply to neutral white and metallic to 0, so
   * the shirt shows the baked fabric albedo (color + flower) at true colors. Called once
   * at construction; the live shirt color is driven through the compositor's fabric layer.
   */
  private neutralizeShirtShading(): void {
    const white = new vec4(1, 1, 1, 1)
    for (const target of this.tintTargets) {
      const pass = target.mat.mainPass as any
      try { pass.baseColor = white } catch (_e) { /* uniform absent — ignore */ }
      try { pass.baseColorFactor = white } catch (_e) { /* uniform absent — ignore */ }
      try { pass.metallicFactor = 0 } catch (_e) { /* uniform absent — ignore */ }
    }
  }

  // --- STICKER-READY: the shirt's fabric texture is fed through this single slot.
  // Pass 3 feeds a live render-target (fabric composited with UV-stamped flowers) here;
  // setTint (baseColorFactor multiply) keeps working on top. The GLB material is glTF-PBR,
  // so the texture uniform is `baseColorTexture` — we write BOTH `baseColorTexture` and
  // `baseTex` so the swap lands regardless of shader family (writing an absent uniform
  // is a harmless no-op).
  getBaseTexture(target: number = 0): Texture | null {
    const t = this.firstPrintTarget(target)
    return t ? t.baseTex : null
  }
  /** The albedo the ASSET shipped, whatever has been swapped in since. See TintTarget. */
  getOriginalBaseTexture(target: number = 0): Texture | null {
    const t = this.firstPrintTarget(target)
    return t ? t.originalTex : null
  }
  private firstPrintTarget(target: number): TintTarget | null {
    for (const t of this.tintTargets) if (t.print && t.target === target) return t
    return null
  }
  /** How many bake targets this garment's materials resolve to (1 for every garment but the socks). */
  getTargetCount(): number {
    let n = 0
    for (const t of this.tintTargets) if (t.print && t.target + 1 > n) n = t.target + 1
    return Math.max(1, n)
  }
  /**
   * Pass 21: the slider colour for every surface that does NOT print. On the shirt and
   * the cap that is no surface at all and this is a no-op; on the tote it is the body and
   * the handles, which would otherwise stay the white neutralizeShirtShading left them.
   */
  setNonPrintColor(color: vec4): void {
    for (const target of this.tintTargets) {
      if (target.print) continue
      const pass = target.mat.mainPass as any
      try { pass.baseColor = color } catch (_e) { /* uniform absent — ignore */ }
      try { pass.baseColorFactor = color } catch (_e) { /* uniform absent — ignore */ }
    }
  }
  setBaseTexture(tex: Texture, which: number = 0): void {
    for (const target of this.tintTargets) {
      if (!target.print || target.target !== which) continue // a tiled or untextured surface never sees the bake
      target.baseTex = tex
      try { (target.mat.mainPass as any).baseColorTexture = tex } catch (_e) { /* ignore */ }
      try { (target.mat.mainPass as any).baseTex = tex } catch (_e) { /* ignore */ }
    }
  }

  /** The instantiated garment SceneObject (idle-bobbed). Sticker hit targets parent here. */
  getVisual(): SceneObject | null {
    return this.visual
  }

  /**
   * Pass 8: set the shirt's Y rotation in degrees. 0 = front-facing (the boot pose),
   * +/-180 = showing its back. Driven live by the platform slider; applied in
   * updateIdle so rotation and bob are written in one place, in one frame.
   */
  setYawDeg(deg: number): void {
    this.yawRad = (deg * Math.PI) / 180
  }

  /** Current Y rotation in degrees. */
  getYawDeg(): number {
    return (this.yawRad * 180) / Math.PI
  }

  /**
   * The shirt's live world rotation. StickerSystem uses this to build the front
   * panel's world plane (normal = rotation * +Z) so placement, drag and the
   * selection frame all follow the shirt at whatever angle it is turned to.
   */
  getWorldRotation(): quat {
    if (!this.visual || isNull(this.visual)) return quat.quatIdentity()
    return this.visual.getTransform().getWorldRotation()
  }

  /**
   * Per-frame: the tiny vertical bob (on the visual) plus the user's dialled-in
   * Y rotation (on the pivot, so the shirt spins about its own centre).
   */
  updateIdle(dt: number): void {
    if (!this.visual || isNull(this.visual)) return
    this.t += dt
    const bob = Math.sin(this.t * ScarfController.BOB_SPEED) * ScarfController.BOB_AMPL
    const tf = this.visual.getTransform()
    tf.setLocalPosition(new vec3(this.baseLocalPos.x, this.baseLocalPos.y + bob, this.baseLocalPos.z))

    if (this.pivot && !isNull(this.pivot)) {
      this.pivot.getTransform().setLocalRotation(quat.angleAxis(this.yawRad, vec3.up()))
    }
  }
}
