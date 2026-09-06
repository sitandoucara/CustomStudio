// TextEditorUI — the STICKERS panel, when a text object is selected (Pass 28).
//
// ===========================================================================
// THE PANEL IS CONTEXTUAL, NOT MODAL
// ===========================================================================
// There is no "text mode". The right-hand plate shows the sticker library until a TEXT
// object is selected, at which point the library's content is hidden and this editor is
// shown in the same footprint; deselecting, or selecting a sticker, brings the library
// back. StickerTrayUI.showEditor is the one switch, driven every frame from what is
// actually selected, so the panel can never disagree with the frame on the garment.
//
// ===========================================================================
// TYPING: THE EDITOR'S OWN KEYS
// ===========================================================================
// The Preview has no keyboard this project can rely on, and every input in it is driven
// by the MOUSE through SIK. So the editor carries its own keys — A to Z, 0 to 9, space
// and delete — each a tiny plate with a box collider, exactly the object every other
// control here is. Thirty-eight small targets fit in six rows inside the plate's width
// and stay well inside the mouse's precision; the alternative, a preset word list,
// would have made "type your name" impossible, and a Lens Studio text input would have
// depended on the desktop keyboard reaching the preview.
//
// ===========================================================================
// FITTING THE EXISTING PLATE
// ===========================================================================
// The plate is 7.0 x 32 (Pass 41; it was 8.2) and does not grow. From the top: the caption; the entry line
// (what the object says); the six key rows plus the space / delete row; five font
// buttons, each drawn in its own face; a row of nine colour chips; and Done. It totals
// 25 cm of the 32 available. Colour is a HORIZONTAL CHIP ROW rather than a second slider:
// nine choices fit in one 6 cm line, and text wants a handful of clear colours, not a
// continuous hue.

import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { buildRing } from "./Geo"
import { LAYERS, setLayerDeep } from "./Layers"
import { GLASS, caption, raiseAbovePlate } from "./UiTheme"
import {
  addFlatShape, addLabel, addCheckGlyph, setShapeColor, uiDisc, uiRoundRect,
  ACCENT_FILL, ACCENT_VIOLET, LABEL_COL, LABEL_DIM_COL, PANEL_TILE_FILL,
} from "./PhotoUi"
import { TEXT_FONTS, TEXT_FONT_NAMES, TEXT_PALETTE, TEXT_MAX_CHARS, TextStyle } from "./TextArt"

export interface TextEditorHooks {
  /** The selected text object's style changed (one or more fields). */
  onChange: (patch: Partial<TextStyle>) => void
  /** Done: deselect, so the library returns. */
  onDone: () => void
}

// --- Layout, in the plate's own cm (y up, 0 at its centre) ----------------------------
const ED_Z = 0.7 // in front of the plate's content plane
const ED_CAPTION_Y = 14.1
const ED_CAPTION_SIZE = 41
const ED_ENTRY_Y = 12.0
// Pass 41: the plate is 7.0 wide now (StickerTrayUI, matched to the colour panel), so the
// full-width pieces — the entry line, the five font buttons and Done — are ED_PILL_W, the
// gem panel's pill width in the same 7.0 plate (0.7 cm of glass each side, as there). The
// font names drop 46 -> 42 so "Playfair" and the script "Pacifico" stay inside 5.6.
const ED_PILL_W = 5.6
const ED_ENTRY_W = ED_PILL_W
const ED_ENTRY_H = 1.9
const ED_ENTRY_R = 0.5
const ED_ENTRY_SIZE = 30
const ED_ENTRY_FILL = new vec4(0.03, 0.03, 0.05, 0.9)
const ED_ENTRY_HINT = "Tap to type" // Pass 33
const ED_ON_PANEL_KEYS = false // Pass 34: physical typing reaches the entry (confirmed by hand); true brings the 38 keys back
const ED_ENTRY_HINT_DY = 1.55
const ED_ENTRY_HINT_SIZE = 24
const ED_KEY_ROWS = ["ABCDEF", "GHIJKL", "MNOPQR", "STUVWX", "YZ0123", "456789"]
const ED_KEY_TOP_Y = 10.2
const ED_KEY_PITCH = 0.95
const ED_KEY_SIZE = 0.86
const ED_KEY_R = 0.22
const ED_KEY_LABEL = 24
const ED_KEY_HIT = 0.9 // the grab box: a hair under the pitch, so neighbours never overlap
const ED_KEY_FILL = PANEL_TILE_FILL // Pass 38: the shared tile backing — this panel is where the value came from
const ED_SPACE_COLS = 4 // the space key spans the first four columns of the last row
// Pass 34: with the keys gone the panel reads, top to bottom — caption, the entry line
// with its "Tap to type" hint, five font buttons (2.3 tall, labels at 46), the nine
// colour chips in two columns, Done.
const ED_FONT_TOP_Y = 8.3
const ED_FONT_PITCH = 2.65
const ED_FONT_W = ED_PILL_W
const ED_FONT_H = 2.3
const ED_FONT_R = 0.7
const ED_FONT_LABEL = 42 // Pass 41: was 46 in the 6.2 button
const ED_SWATCH_TOP_Y = -4.4
const ED_SWATCH_COLS = 2
const ED_SWATCH_COL_X = 1.35 // the two columns, either side of the centre
const ED_SWATCH_PITCH_Y = 1.45
const ED_SWATCH_R = 0.52
const ED_SWATCH_RING = 0.1
const ED_SWATCH_EDGE = new vec4(1, 1, 1, 0.34) // faint edge so black reads on the plate
const ED_SWATCH_HIT = new vec3(2.5, 1.4, 3)
const ED_DONE_Y = -12.6
const ED_DONE_W = ED_PILL_W
const ED_DONE_H = 1.6
const ED_DONE_LABEL = 30 // pre-Pass-35, kept for the classic revert
/** Pass 35: a check instead of the word "Done". The pill and its grab box are unchanged. */
const ED_DONE_ICON_K = 1.15
const ED_HIT_DEPTH = 3

export class TextEditorUI {
  private root: SceneObject
  private hooks: TextEditorHooks | null = null
  private entry!: Text
  private entryBody!: SceneObject
  private entryHint!: Text
  private keyboardOpen = false
  private fontButtons: SceneObject[] = []
  private swatchRings: SceneObject[] = []
  private current: TextStyle = { text: "", font: -1, color: -1 }

  constructor(parent: SceneObject) {
    this.root = global.scene.createSceneObject("TextEditor")
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(0, 0, ED_Z))
    this.build()
    setLayerDeep(this.root, LAYERS.ui)
    raiseAbovePlate(this.root) // above the plate once it is hovered — see UiTheme
    this.root.enabled = false
  }

  bind(hooks: TextEditorHooks): void {
    this.hooks = hooks
  }

  getSceneObject(): SceneObject {
    return this.root
  }

  /** Show the editor for `style`, or hide it. Cheap when nothing changed. */
  show(style: TextStyle | null): void {
    if (!style) {
      if (this.root.enabled) this.root.enabled = false
      return
    }
    if (!this.root.enabled) this.root.enabled = true
    if (style.text !== this.current.text) {
      this.entry.text = style.text.length > 0 ? style.text : " "
      this.current.text = style.text
    }
    if (style.font !== this.current.font) {
      for (let i = 0; i < this.fontButtons.length; i++) {
        setShapeColor(this.fontButtons[i], i === style.font ? ACCENT_FILL : ED_KEY_FILL)
      }
      this.current.font = style.font
    }
    if (style.color !== this.current.color) {
      for (let i = 0; i < this.swatchRings.length; i++) this.swatchRings[i].enabled = i === style.color
      this.current.color = style.color
    }
  }

  // ---------------------------------------------------------------------------

  private build(): void {
    addLabel(this.root, new vec3(0, ED_CAPTION_Y, 0), caption("Text"), ED_CAPTION_SIZE, new vec4(1, 1, 1, 0.9))

    // The entry line: what the object says.
    addFlatShape(this.root, uiRoundRect(ED_ENTRY_W, ED_ENTRY_H, ED_ENTRY_R), new vec3(0, ED_ENTRY_Y, 0), new vec3(1, 1, 1), ED_ENTRY_FILL)
    this.entry = addLabel(this.root, new vec3(0, ED_ENTRY_Y, 0.1), " ", ED_ENTRY_SIZE, LABEL_COL)
    this.entry.horizontalOverflow = HorizontalOverflow.Shrink
    this.entry.layoutRect = Rect.create(-ED_ENTRY_W / 2 + 0.3, ED_ENTRY_W / 2 - 0.3, -ED_ENTRY_H / 2, ED_ENTRY_H / 2)
    // Pass 33: the entry is a FIELD. A tap on it asks the system keyboard for input; what
    // arrives is written straight to the object. The Text component's own "editable"
    // switch is tried too, in case this version routes physical keys through it.
    this.entryBody = addFlatShape(this.root, uiRoundRect(ED_ENTRY_W, ED_ENTRY_H, ED_ENTRY_R), new vec3(0, ED_ENTRY_Y, 0.05), new vec3(1, 1, 1), new vec4(0, 0, 0, 0))
    this.entryHint = addLabel(this.root, new vec3(0, ED_ENTRY_Y - ED_ENTRY_HINT_DY, 0.1), ED_ENTRY_HINT, ED_ENTRY_HINT_SIZE, LABEL_DIM_COL)
    try { (this.entry as any).editable = true; print("[KEYS] Text.editable set") } catch (e) { print("[KEYS] Text.editable unavailable: " + e) }
    this.addHit(this.entryBody, ED_ENTRY_W, ED_ENTRY_H, () => this.tapEntry())

    // PASS 33 — THE 38 ON-PANEL KEYS ARE BEHIND ONE SWITCH. The entry line above is a live
    // field that asks the system keyboard for input (tapEntry); the keys stay until physical
    // keystrokes are confirmed to reach Preview. ED_ON_PANEL_KEYS = false hides them.
    if (ED_ON_PANEL_KEYS) {
    // The keys.
    const cols = ED_KEY_ROWS[0].length
    const x0 = -((cols - 1) / 2) * ED_KEY_PITCH
    for (let r = 0; r < ED_KEY_ROWS.length; r++) {
      const y = ED_KEY_TOP_Y - r * ED_KEY_PITCH
      for (let c = 0; c < cols; c++) {
        const ch = ED_KEY_ROWS[r].charAt(c)
        this.makeKey(ch, new vec3(x0 + c * ED_KEY_PITCH, y, 0), ED_KEY_SIZE, () => this.type(ch))
      }
    }
    const yLast = ED_KEY_TOP_Y - ED_KEY_ROWS.length * ED_KEY_PITCH
    const spaceW = ED_SPACE_COLS * ED_KEY_PITCH - (ED_KEY_PITCH - ED_KEY_SIZE)
    const spaceX = x0 + ((ED_SPACE_COLS - 1) / 2) * ED_KEY_PITCH
    this.makeKey("SPACE", new vec3(spaceX, yLast, 0), spaceW, () => this.type(" "), ED_KEY_LABEL - 6)
    const delCols = cols - ED_SPACE_COLS
    const delW = delCols * ED_KEY_PITCH - (ED_KEY_PITCH - ED_KEY_SIZE)
    const delX = x0 + (ED_SPACE_COLS + (delCols - 1) / 2) * ED_KEY_PITCH
    this.makeKey("DEL", new vec3(delX, yLast, 0), delW, () => this.backspace(), ED_KEY_LABEL - 6)

    }
    // The five fonts, each named in its own face.
    for (let i = 0; i < TEXT_FONTS.length; i++) {
      const y = ED_FONT_TOP_Y - i * ED_FONT_PITCH
      const body = addFlatShape(this.root, uiRoundRect(ED_FONT_W, ED_FONT_H, ED_FONT_R), new vec3(0, y, 0), new vec3(1, 1, 1), ED_KEY_FILL)
      const label = addLabel(this.root, new vec3(0, y, 0.1), TEXT_FONT_NAMES[i], ED_FONT_LABEL, LABEL_COL)
      try { label.font = TEXT_FONTS[i] } catch (_e) { /* the default face, then */ }
      this.fontButtons.push(body)
      const idx = i
      this.addHit(body, ED_FONT_W, ED_FONT_H - 0.1, () => this.emit({ font: idx }))
    }

    // The colour chips.
    for (let i = 0; i < TEXT_PALETTE.length; i++) {
      const chip = global.scene.createSceneObject("TextSwatch" + i)
      chip.setParent(this.root)
      const col = i % ED_SWATCH_COLS
      const row = Math.floor(i / ED_SWATCH_COLS)
      chip.getTransform().setLocalPosition(new vec3((col - (ED_SWATCH_COLS - 1) / 2) * 2 * ED_SWATCH_COL_X, ED_SWATCH_TOP_Y - row * ED_SWATCH_PITCH_Y, 0))
      addFlatShape(chip, uiDisc(), vec3.zero(), new vec3(ED_SWATCH_R, ED_SWATCH_R, 1), TEXT_PALETTE[i])
      addFlatShape(chip, buildRing(1 - ED_SWATCH_RING / ED_SWATCH_R, 32), new vec3(0, 0, 0.05), new vec3(ED_SWATCH_R, ED_SWATCH_R, 1), ED_SWATCH_EDGE)
      const ring = addFlatShape(chip, buildRing(1 - ED_SWATCH_RING / (ED_SWATCH_R + 0.1), 32), new vec3(0, 0, 0.1), new vec3(ED_SWATCH_R + 0.1, ED_SWATCH_R + 0.1, 1), ACCENT_VIOLET)
      ring.enabled = false
      this.swatchRings.push(ring)
      const idx = i
      this.addHit(chip, ED_SWATCH_HIT.x, ED_SWATCH_HIT.y, () => this.emit({ color: idx }))
    }

    // Done: back to the library. PASS 35 — a check, not the word. The pill keeps its size
    // and its grab box (ED_DONE_W x ED_DONE_H, as generous as it was); only what is looked
    // at changed, and it is the same check the photo page's head pill draws.
    const done = addFlatShape(this.root, uiRoundRect(ED_DONE_W, ED_DONE_H, ED_DONE_H / 2), new vec3(0, ED_DONE_Y, 0), new vec3(1, 1, 1), ED_KEY_FILL)
    if (GLASS) addCheckGlyph(this.root, new vec3(0, ED_DONE_Y, 0.1), ED_DONE_ICON_K, LABEL_COL, false)
    else addLabel(this.root, new vec3(0, ED_DONE_Y, 0.1), "Done", ED_DONE_LABEL, LABEL_DIM_COL)
    this.addHit(done, ED_DONE_W, ED_DONE_H, () => { if (this.hooks) this.hooks.onDone() })
  }

  /** Pass 33: the entry line was tapped — ask the system keyboard for text. */
  private tapEntry(): void {
    const tis: any = (global as any).textInputSystem
    if (!tis || !tis.requestKeyboard) { print("[KEYS] no textInputSystem in this runtime"); return }
    try {
      const opts: any = new (TextInputSystem as any).KeyboardOptions()
      try { opts.enablePreview = false } catch (_e) { /* ignore */ }
      try { opts.keyboardType = (TextInputSystem as any).KeyboardType.Text } catch (_e) { /* ignore */ }
      try { opts.returnKeyType = (TextInputSystem as any).ReturnKeyType.Done } catch (_e) { /* ignore */ }
      try { opts.initialText = this.current.text } catch (_e) { /* ignore */ }
      opts.onTextChanged = (text: string, _range: any) => {
        print("[KEYS] onTextChanged: \"" + text + "\"")
        const t = text.substring(0, TEXT_MAX_CHARS)
        this.entry.text = t.length > 0 ? t : " "
        this.current.text = t
        this.emit({ text: t })
      }
      opts.onKeyboardStateChanged = (open: boolean) => { print("[KEYS] keyboard " + (open ? "opened" : "closed")); this.keyboardOpen = open }
      opts.onReturnKeyPressed = () => { print("[KEYS] return"); try { tis.dismissKeyboard() } catch (_e) { /* ignore */ } }
      tis.requestKeyboard(opts)
      print("[KEYS] requestKeyboard sent")
    } catch (e) {
      print("[KEYS] requestKeyboard threw: " + e)
    }
  }

  /** Verification: the same tap the entry's hit box makes. */
  debugTapEntry(): void {
    this.tapEntry()
  }

  private makeKey(label: string, pos: vec3, w: number, onTap: () => void, size: number = ED_KEY_LABEL): void {
    const key = addFlatShape(this.root, uiRoundRect(w, ED_KEY_SIZE, ED_KEY_R), pos, new vec3(1, 1, 1), ED_KEY_FILL)
    addLabel(key, new vec3(0, 0, 0.1), label, size, LABEL_COL)
    this.addHit(key, w + (ED_KEY_HIT - ED_KEY_SIZE), ED_KEY_HIT, onTap)
  }

  private addHit(obj: SceneObject, w: number, h: number, onTap: () => void): void {
    const collider = obj.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(w, h, ED_HIT_DEPTH)
    collider.shape = shape
    collider.fitVisual = false
    const inter = obj.createComponent(Interactable.getTypeName()) as Interactable
    inter.targetingMode = 3 // Direct + Indirect, so mouse and hand both reach it
    inter.onTriggerEnd.add(() => onTap())
  }

  private type(ch: string): void {
    if (this.current.text.length >= TEXT_MAX_CHARS) return
    this.emit({ text: this.current.text + ch })
  }

  private backspace(): void {
    if (this.current.text.length === 0) return
    this.emit({ text: this.current.text.substring(0, this.current.text.length - 1) })
  }

  private emit(patch: Partial<TextStyle>): void {
    if (this.hooks) this.hooks.onChange(patch)
  }
}
