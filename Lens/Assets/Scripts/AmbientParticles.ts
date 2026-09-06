// AmbientParticles — plain helper class (NOT a @component). Spawns a handful of
// small, faint motes that drift slowly around the scarf for subtle atmosphere.
// Additive blend + depthWrite off keeps them see-through-AR friendly (no opaque
// background — pure soft glow that composites over the real world).

interface Mote {
  obj: SceneObject
  base: vec3
  phase: vec3
  speed: vec3
  rise: number
}

export class AmbientParticles {
  private motes: Mote[] = []
  private t: number = 0

  // Drift volume (cm) around the parent origin, and mote look.
  private static readonly HALF = new vec3(22, 17, 13)
  private static readonly DRIFT = new vec3(1.6, 1.1, 1.4) // cm sway amplitude per axis
  private static readonly MOTE_SCALE = 0.45               // tuned visually after capture
  private static readonly MOTE_COLOR = new vec4(0.55, 0.62, 0.78, 1.0) // faint, cool

  /**
   * @param mesh     small sphere RenderMesh (from SphereMeshPreset, made in bootstrap)
   * @param material unlit particle material (from UnlitMaterialPreset, made in bootstrap)
   * @param parent   SceneObject the motes live under (placed at the scene center)
   * @param count    number of motes (keep small — "subtle")
   */
  constructor(mesh: RenderMesh, material: Material, parent: SceneObject, count: number = 16) {
    // One shared, additive, faint material for all motes.
    const mat = material.clone()
    const pass: any = mat.mainPass
    try { pass.baseColor = AmbientParticles.MOTE_COLOR } catch (_e) { /* ignore */ }
    try { pass.blendMode = BlendMode.Add } catch (_e) { /* ignore */ }
    try { pass.depthTest = true } catch (_e) { /* ignore */ }
    try { pass.depthWrite = false } catch (_e) { /* ignore */ }

    for (let i = 0; i < count; i++) {
      const obj = global.scene.createSceneObject("Mote_" + i)
      obj.setParent(parent)
      const rmv = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = mesh
      rmv.clearMaterials()
      rmv.addMaterial(mat)

      const base = new vec3(
        (Math.random() * 2 - 1) * AmbientParticles.HALF.x,
        (Math.random() * 2 - 1) * AmbientParticles.HALF.y,
        (Math.random() * 2 - 1) * AmbientParticles.HALF.z
      )
      const s = AmbientParticles.MOTE_SCALE * (0.6 + Math.random() * 0.8)
      const tf = obj.getTransform()
      tf.setLocalPosition(base)
      tf.setLocalScale(new vec3(s, s, s))

      this.motes.push({
        obj,
        base,
        phase: new vec3(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28),
        speed: new vec3(0.25 + Math.random() * 0.3, 0.2 + Math.random() * 0.25, 0.22 + Math.random() * 0.28),
        rise: 1.2 + Math.random() * 1.6, // cm/s slow upward drift
      })
    }
  }

  /** Per-frame drift: gentle sine sway on each axis plus a slow upward rise that wraps. */
  update(dt: number): void {
    this.t += dt
    const H = AmbientParticles.HALF
    const D = AmbientParticles.DRIFT
    for (const m of this.motes) {
      if (isNull(m.obj)) continue
      // Slow rise, wrapping from top back to bottom of the volume.
      m.base.y += m.rise * dt
      if (m.base.y > H.y) m.base.y = -H.y
      const x = m.base.x + Math.sin(this.t * m.speed.x + m.phase.x) * D.x
      const y = m.base.y + Math.sin(this.t * m.speed.y + m.phase.y) * D.y
      const z = m.base.z + Math.sin(this.t * m.speed.z + m.phase.z) * D.z
      m.obj.getTransform().setLocalPosition(new vec3(x, y, z))
    }
  }
}
