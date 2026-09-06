// ColorUtils — pure color helpers (plain TS module, not a @component).
// Imported by the main script (color to apply) and by ColorSliderUI (rainbow track).
//
// Pass 7: color no longer MULTIPLIES the fabric texture — it IS the fabric albedo,
// painted into the compositor's fabric layer with a neutral shirt baseColorFactor.
// That means the slider must reach FULL saturation and TRUE white, and the color it
// applies must exactly match the rainbow shown under the knob. So the single source
// of truth is `trackColor(t)`: it builds the visible gradient texture AND the applied
// shirt color, guaranteeing "what you see under the knob is what the shirt becomes".

/** HSV (all 0..1) -> RGB (0..1). */
export function hsvToRgb(h: number, s: number, v: number): vec3 {
  h = ((h % 1) + 1) % 1
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r = 0, g = 0, b = 0
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  return new vec3(r, g, b)
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)) }

// Track layout (t = slider value 0..1, bottom->top) — PASS 27: WHITE AT THE CENTRE.
//   t in [0, 0.5 - WHITE_CORE]  → the WARM half of the wheel, red (bottom) → yellow → green,
//                                 fading to white over the last WHITE_RAMP before the centre
//   t in [0.5 - WHITE_CORE, 0.5 + WHITE_CORE] → TRUE WHITE: the boot value (0.5) is a blank garment
//   t in [0.5 + WHITE_CORE, 1]  → the COOL half, cyan → blue → violet → magenta (top), rising
//                                 out of white over the first WHITE_RAMP
// Every hue family is on the track once, at full value; the knob boots at 0.5 = white.
const WHITE_CORE = 0.03  // half-width of the pure-white band around the centre
const WHITE_RAMP = 0.05  // over this much of t either side of the band, saturation goes 0 -> 1
const HUE_LOW_START = 0.0    // red, at the bottom
const HUE_LOW_END = 0.333    // green, just under the white band
const HUE_HIGH_START = 0.5   // cyan, just over the white band
const HUE_HIGH_END = 0.833   // violet/magenta, at the top

/**
 * The ONE mapping used for both the visible track and the applied shirt color.
 * Full saturation + full value away from the centre so colors are vivid (not muddy);
 * saturation ramps to 0 into the centre so the middle of the track is TRUE white.
 */
export function trackColor(t: number): vec3 {
  t = clamp01(t)
  const d = t - 0.5
  const sat = clamp01((Math.abs(d) - WHITE_CORE) / WHITE_RAMP)
  if (d < 0) {
    const f = clamp01(t / (0.5 - WHITE_CORE)) // 0 at the bottom, 1 at the band
    return hsvToRgb(HUE_LOW_START + (HUE_LOW_END - HUE_LOW_START) * f, sat, 1.0)
  }
  const f = clamp01((t - (0.5 + WHITE_CORE)) / (0.5 - WHITE_CORE)) // 0 at the band, 1 at the top
  return hsvToRgb(HUE_HIGH_START + (HUE_HIGH_END - HUE_HIGH_START) * f, sat, 1.0)
}

/** Slider value 0..1 → the shirt fabric color (exactly the track color under the knob). */
export function valueToColor(v: number): vec4 {
  const rgb = trackColor(v)
  return new vec4(rgb.x, rgb.y, rgb.z, 1.0)
}

/**
 * Build a horizontal rainbow gradient texture whose U axis maps 1:1 to the slider
 * value: pixel at u == trackColor(u). Placed on a quad that spans the knob's travel,
 * so the color directly under the knob is the exact color the shirt receives.
 */
export function buildRainbowTexture(width: number = 128, height: number = 8): Texture {
  const tex = ProceduralTextureProvider.createWithFormat(width, height, TextureFormat.RGBA8Unorm)
  const ctrl = tex.control as ProceduralTextureProvider
  const data = new Uint8Array(width * height * 4)
  for (let x = 0; x < width; x++) {
    const t = width > 1 ? x / (width - 1) : 0
    const c = trackColor(t)
    const r = Math.round(clamp01(c.x) * 255)
    const g = Math.round(clamp01(c.y) * 255)
    const b = Math.round(clamp01(c.z) * 255)
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = 255
    }
  }
  ctrl.setPixels(0, 0, width, height, data)
  return tex
}
