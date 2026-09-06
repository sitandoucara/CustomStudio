// StickerTrayUI — Specs UI module (per /specs-build-ui, Hard Rule 3).
//
// A vertical tray of 3 tappable flat-flower sticker thumbnails, shown on the RIGHT
// side of the view. Pass 2 is DISPLAY ONLY: the thumbnails are tappable/hoverable
// (each is a UIKit Button, so SIK's MouseInteractor drives it in the Editor), and a
// tap emits onStickerTapped(index) — but there is NO placement/drag-onto-shirt logic
// yet (that is next pass). Built from UIKit primitives only: BackPlate + FlexLayout
// column + Button + ElementContent(leadingIcon). Flower art is flat 2D PNG textures.

import { FlexLayout } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import { FlexItem } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import { FlexAlign, FlexDirection, FlexJustify, FlexAlignSelf } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import { ElementContent } from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event"
import { GLASS, caption, pick, raiseAbovePlate, hidePlateVisuals, UI_COL_X, UI_BTN_DX, UI_PANEL_HALF_W } from "./UiTheme"
import { TextEditorUI, TextEditorHooks } from "./TextEditorUI"
import { TextStyle } from "./TextArt"
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { addLabel, addButtonWord, addFlatShape, uiRoundRect, makePlateButton, LABEL_COL, LABEL_DIM_COL, PANEL_TILE_FILL, PLATE_COL, PLATE_GLYPH_SCALE,
  WIDE_BTN_W,
  WIDE_BTN_H,
  WIDE_BTN_R,
  WIDE_BTN_GLYPH_X,
  WIDE_BTN_WORD_X,
  WIDE_BTN_TEXT_SIZE,
  WIDE_BTN_GLYPH_LABEL_SIZE,
  addGlassPanel,
  GLASS_R,
  setTextColor, // Pass 43
  stackVisual,
} from "./PhotoUi"

// Flat flower sticker textures (imported PNGs with transparent background).
const STICKERS: { name: string; tex: Texture }[] = [
  { name: "Daisy", tex: requireAsset("../GeneratedTextures/Daisy.png") as Texture },
  { name: "Butterfly", tex: requireAsset("../GeneratedTextures/Butterfly.png") as Texture }, // Pass 34
  { name: "CherryBlossom", tex: requireAsset("../GeneratedTextures/CherryBlossom.png") as Texture },
  { name: "Sunflower", tex: requireAsset("../GeneratedTextures/Sunflower.png") as Texture },
  // Pass 24: the same order as Stickers.BUILTIN_ART — a tap's index is that list's index.
  { name: "Heart", tex: requireAsset("../GeneratedTextures/Heart.png") as Texture },
  { name: "Bow", tex: requireAsset("../GeneratedTextures/Bow.png") as Texture },
]

/** Pass 43: UIKit's ElementContent puts its icon Image two levels down ("<tile> Content" / icon). */
function hasImageDeep(o: SceneObject): boolean {
  if (o.getComponent("Component.Image")) return true
  for (let i = 0; i < o.getChildrenCount(); i++) if (hasImageDeep(o.getChild(i))) return true
  return false
}

// --- Typography (compact type-scale, per /specs-build-ui) --------------------
const TYPE_SCALE: { [role: string]: number } = { Caption: 38, Subheadline: 41 }
function applyTextRole(t: Text, role: string): void {
  t.size = TYPE_SCALE[role] ?? TYPE_SCALE.Caption
}

// Pass 24 — FIVE THUMBNAILS IN THE SAME TRAY. The panel is 32 cm tall (it was 33) and
// the import button sits below it as before, so five tiles have to fit where three did:
// the tile drops from 8.0 to 4.9 cm and the artwork inside it from 4.9 to 3.3, which is
// also the reference's weight — its thumbnails are lighter than ours were. Five tiles at
// 4.9 with 0.6 between them is 26.9 cm, plus the caption and the paddings: 31.4 of 32.
// THE ONE THING THE REVERT CANNOT RESTORE: classic had three tiles at 8.0, and five at
// 8.0 do not fit in 33 cm, so classic keeps its panel, gaps and paddings but shows the
// five stickers at 5.0 (art 3.6) — the largest tile that fits under the caption.
// Pass 25 (glass): the tray is the reference's 8.2 cm wide and the Import button lives
// INSIDE it, in a slot the layout reserves under the fifth tile (see getImportSlot):
// caption + five 4.2 tiles + the 4.2 slot + six 0.5 gaps + 1.0 paddings = 31.2 of 32.
// Pass 32: the Import/Text slot left the tray; the freed height went to the tiles (4.2 -> 5.0).
// Pass 34: SIX tiles. The 32 cm tray holds caption + 6 x 4.2 + 6 gaps x 0.5 + 2 x 1.0 pads = 31.8, so
// the tiles give back the Pass-32 growth (5.0 -> 4.2, icon 3.6 -> 3.2); nothing else moves.
const BUTTON_SIZE = pick(5.0, 4.2)
// Pass 9: the sticker PNGs were trimmed to their alpha bounds, so the artwork now fills
// its icon box instead of sitting inside ~30% transparent padding. Pulled in from 6.2 so
// the thumbnails keep the same visual weight in the tray as before the trim.
const ICON_SIZE = pick(3.6, 3.2)
// PASS 41 — THE SAME WIDTH AS THE LEFT PANEL. The tray was the reference's 8.2 while the
// colour / paint / gem panel opposite it is 7.0 (2 x UI_PANEL_HALF_W), and the two standing
// panels either side of the garment read as a mismatched pair. The tray now takes its width
// from the same constant the left panel and the paint-plane clamp use, so the pair cannot
// drift apart again. What had to give: the tiles' clearance to the plate's edge (2.0 -> 1.4
// cm a side; the 4.2 tiles themselves are unchanged in a 5.0 inner width), and, in the text
// editor that shares this plate, the entry line, the font buttons and Done narrow from 6.2
// to 5.6 — the gem panel's pill width in the same 7.0 plate (TextEditorUI). Import and Text
// under the tray are the wide-button family (8.2) that Photo and Gallery are under the 7.0
// colour panel, so they stay as they are and the two columns now match exactly.
const TRAY_W = pick(11, 2 * UI_PANEL_HALF_W)
const TRAY_H = pick(33, 32)
const TRAY_ROW_GAP = pick(0.9, 0.5)
const TRAY_PAD_Y = pick(1.4, 1.0)
const TRAY_PAD_X = pick(1.2, 1.0)
/** Glass: the Import button's slot, the width the panel leaves inside its paddings. */
export const IMP_SLOT_W = TRAY_W - 2 * TRAY_PAD_X
export const IMP_SLOT_H = 4.2
// Pass 28: the slot holds TWO buttons side by side — Import on the left, Add text on the
// right. They are the two ways of bringing new content in, so they share a row; putting
// the text button on a row of its own would have cost the tiles 0.6 cm each. Each button
// is a little under half the slot, and their grab boxes never meet.
export const SLOT_BTN_W = 2.95
export const SLOT_BTN_X = 1.625 // Import at -x, Add text at +x
export const SLOT_BTN_R = 1.2
export const SLOT_BTN_HIT = new vec3(3.1, 4.6, 3)
const ADD_TEXT_GLYPH = "Aa"
const ADD_TEXT_GLYPH_SIZE = 38
const ADD_TEXT_GLYPH_Y = 0.55
const ADD_TEXT_WORD = "Text"
const ADD_TEXT_WORD_SIZE = 22
const ADD_TEXT_WORD_Y = -1.05
/** Classic: a round plate under the tray, mirroring the gallery button on the left. */
const ADD_TEXT_CENTER_CLASSIC = new vec3(21.4, -25.7, -110)
// Pass 32 (glass): below the tray, the second of the right column's two wide buttons.
// Pass 33: LOCAL to the tray root (which ScarfCustomizer moves to UI_COL_X at OnStart), so
// the button lands at UI_COL_X + UI_BTN_DX like the Import button above it.
const ADD_TEXT_LOCAL_GLASS = new vec3(UI_BTN_DX, -23.6, 0)
const ADD_TEXT_HIT_GLASS = new vec3(10.4, 4.5, 3)
// PASS 44: the word "Text" comes up a step. At the family's 40 it sat beside a glyph that
// is itself lettering ("Aa" at label size 55, filling the 1.8 glyph box) and is the
// shortest word of the four, so it read lighter than Photo, Gallery and My stickers. Only
// the word's size moves: the glyph box, the gap (wideBtnWordX carries the type's bearing
// at any size) and the pad are the family's, and the group is re-centred by measurement
// as every button is (requestButtonCentring).
// Pass 46: 4 -> 0. Refs/ui_btn sets "Text" at the same cap height as the other three
// (0.97 against 0.98..1.02); the family's size carries it now.
const ADD_TEXT_WORD_BOOST = 0
const ADD_TEXT_GLASS_SIZE = WIDE_BTN_TEXT_SIZE + ADD_TEXT_WORD_BOOST
const ADD_TEXT_GLYPH_DY = -0.05 // optical centre of "Aa" at glyph size
const TRAY_CAPTION = pick("Stickers", "Stickers")
/** Pass 38: the flat tile backing sits just behind the Button's plane. */
const TILE_BACK_Z = -0.02
/** Its corner radius, in the proportion the text panel's font buttons use (0.7 on a 2.3 tall button). */
const TILE_BACK_R = BUTTON_SIZE * 0.3

@component
export class StickerTrayUI extends BaseScriptComponent {
  private _onStickerTapped = new Event<number>()
  private importSlot: SceneObject | null = null
  private _onAddText = new Event<void>()
  /** Pass 28: the Add text button was pressed. */
  get onAddText(): PublicApi<void> { return this._onAddText.publicApi() }
  private addTextInteractable: Interactable | null = null
  /** Pass 38: the sticker tiles, whose UIKit visual is suppressed each frame. */
  private tileRoots: SceneObject[] = []
  private editor: TextEditorUI | null = null
  private content: SceneObject | null = null
  private tilesStacked = false // Pass 43
  /** Emits the tapped sticker index 0..2 (reserved for the next pass's placement flow). */
  get onStickerTapped(): PublicApi<number> { return this._onStickerTapped.publicApi() }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")

    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    backPlate.onInitialized.add(() => {
      backPlate.size = new vec2(TRAY_W, TRAY_H)
    })
    // Pass 33: the same glass plate (and radius) as the tool panels — see ColorSliderUI.
    if (GLASS) {
      const plate = global.scene.createSceneObject("GlassPlate")
      plate.setParent(this.sceneObject)
      plate.getTransform().setLocalPosition(new vec3(0, 0, 0.2))
      addGlassPanel(plate, vec3.zero(), TRAY_W, TRAY_H, GLASS_R)
      this.createEvent("UpdateEvent").bind(() => {
        hidePlateVisuals(this.sceneObject)
        // Pass 38: a UIKit Button re-enables its own raised visual whenever its state
        // changes (hover, press), so switching it off once is not enough.
        for (let i = 0; i < this.tileRoots.length; i++) {
          const vs = this.tileRoots[i].getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]
          for (const v of vs) if (v.enabled) v.enabled = false
        }
        // Pass 43: UIKit builds each tile's icon (an Image) after onAwake, at order 2 —
        // under the glass plate now that the plate has an explicit order. Once every icon
        // exists, stack the tiles once, in tile order, above the plate (see UiTheme).
        if (!this.tilesStacked && this.tileRoots.length > 0) {
          let ready = true
          for (let i = 0; i < this.tileRoots.length; i++) if (!hasImageDeep(this.tileRoots[i])) ready = false
          if (ready) {
            this.tilesStacked = true
            for (let i = 0; i < this.tileRoots.length; i++) raiseAbovePlate(this.tileRoots[i])
          }
        }
      })
    }

    const content = global.scene.createSceneObject("Content")
    content.setParent(this.sceneObject)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))
    this.content = content

    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    col.direction = FlexDirection.Column
    col.alignItems = FlexAlign.Center
    col.justifyContent = FlexJustify.Center
    col.rowGap = TRAY_ROW_GAP
    col.paddingTop = TRAY_PAD_Y
    col.paddingBottom = TRAY_PAD_Y
    col.paddingLeft = TRAY_PAD_X
    col.paddingRight = TRAY_PAD_X
    col.width = TRAY_W
    col.height = TRAY_H

    // Caption
    const capObj = global.scene.createSceneObject("Caption")
    capObj.setParent(content)
    const cap = capObj.createComponent("Component.Text") as Text
    stackVisual(cap) // Pass 43
    cap.text = caption(TRAY_CAPTION)
    cap.depthTest = true
    cap.horizontalAlignment = HorizontalAlignment.Center
    cap.verticalAlignment = VerticalAlignment.Center
    cap.horizontalOverflow = HorizontalOverflow.Overflow
    cap.layoutRect = Rect.create(-0.5, 0.5, -0.5, 0.5)
    applyTextRole(cap, "Subheadline")
    setTextColor(cap, new vec4(1, 1, 1, 0.9)) // Pass 43
    const capItem = capObj.createComponent(FlexItem.getTypeName()) as FlexItem
    capItem.alignSelf = FlexAlignSelf.Stretch
    raiseAbovePlate(capObj) // Pass 27: above the plate once it is hovered (see UiTheme)

    // The tappable thumbnails — five since Pass 24
    for (let i = 0; i < STICKERS.length; i++) {
      this.makeStickerButton(content, i, STICKERS[i].tex)
    }

    // Pass 25 (glass): the slot the Import button is parented into (ImportPanel.init).
    // An empty item of an explicit size, so the column leaves room for it.
    if (GLASS) {
      // Pass 32: no slot in the tray. The Add text button is a wide button under the tray,
      // stacked with Import the way Photo and Gallery are stacked on the left.
      const btn = makePlateButton(this.sceneObject, "AddTextButton", vec3.zero(), PLATE_COL, false,
        { w: WIDE_BTN_W, h: WIDE_BTN_H, r: WIDE_BTN_R, hit: ADD_TEXT_HIT_GLASS })
      btn.getTransform().setLocalPosition(ADD_TEXT_LOCAL_GLASS)
      btn.getTransform().setLocalRotation(quat.quatIdentity())
      addLabel(btn, new vec3(WIDE_BTN_GLYPH_X, ADD_TEXT_GLYPH_DY, 0.2), ADD_TEXT_GLYPH, WIDE_BTN_GLYPH_LABEL_SIZE, LABEL_COL) // Pass 33: the glyph fills its box
      // Pass 35: through addButtonWord, the ONE function that places a button's word, so
      // this button cannot drift from Photo / Gallery / Import again.
      addButtonWord(btn, ADD_TEXT_WORD, LABEL_COL, new vec3(WIDE_BTN_WORD_X, 0, 0.2), ADD_TEXT_GLASS_SIZE)
      this.addTextInteractable = btn.getComponent(Interactable.getTypeName()) as Interactable
    } else if (pick(false, true)) {
      this.importSlot = global.scene.createSceneObject("ImportSlot")
      this.importSlot.setParent(content)
      const item = this.importSlot.createComponent(FlexItem.getTypeName()) as FlexItem
      ;(item as any).overrideWidth = IMP_SLOT_W
      ;(item as any).overrideHeight = IMP_SLOT_H
      // Pass 28: the Add text button, the right half of the slot.
      const btn = makePlateButton(this.importSlot, "AddTextButton", new vec3(0, 0, 0), PLATE_COL, false,
        { w: SLOT_BTN_W, h: IMP_SLOT_H, r: SLOT_BTN_R, hit: SLOT_BTN_HIT })
      btn.getTransform().setLocalPosition(new vec3(SLOT_BTN_X, 0, 0.3))
      addLabel(btn, new vec3(0, ADD_TEXT_GLYPH_Y, 0.2), ADD_TEXT_GLYPH, ADD_TEXT_GLYPH_SIZE, LABEL_COL)
      addLabel(btn, new vec3(0, ADD_TEXT_WORD_Y, 0.2), ADD_TEXT_WORD, ADD_TEXT_WORD_SIZE, LABEL_DIM_COL)
      raiseAbovePlate(btn)
      this.addTextInteractable = btn.getComponent(Interactable.getTypeName()) as Interactable
    } else {
      const btn = makePlateButton(this.sceneObject, "AddTextButton", ADD_TEXT_CENTER_CLASSIC)
      addLabel(btn, new vec3(0, 0, 0.2), ADD_TEXT_GLYPH, ADD_TEXT_GLYPH_SIZE * PLATE_GLYPH_SCALE, LABEL_COL)
      this.addTextInteractable = btn.getComponent(Interactable.getTypeName()) as Interactable
    }

    // Pass 28: the text editor lives in the same plate, hidden until a text object is selected.
    this.editor = new TextEditorUI(this.sceneObject)
  }

  /** Bind the SIK subscriptions and the editor's hooks. Called from OnStartEvent. */
  bindText(hooks: TextEditorHooks): void {
    if (this.addTextInteractable) this.addTextInteractable.onTriggerEnd.add(() => this._onAddText.invoke())
    if (this.editor) this.editor.bind(hooks)
  }

  /**
   * Pass 28: the panel follows the selection. A text style means "show the editor for
   * this"; null means "show the library". Called every frame; both branches are cheap
   * when nothing changed.
   */
  showEditor(style: TextStyle | null): void {
    const on = style !== null
    if (this.content && this.content.enabled === on) this.content.enabled = !on
    if (this.editor) this.editor.show(style)
  }

  /** Pass 33 (verification): tap the editor's entry line. */
  debugTapEntry(): void {
    if (this.editor) this.editor.debugTapEntry()
  }

  /** Where the Import button goes in glass; null in classic (it sits under the tray). */
  getImportSlot(): SceneObject | null {
    return this.importSlot
  }

  private makeStickerButton(parent: SceneObject, index: number, tex: Texture): void {
    const so = global.scene.createSceneObject("Sticker_" + index)
    so.setParent(parent)

    // PASS 38 — THE FLAT BACKING, and why it is created HERE, first.
    //
    // A UIKit Button draws itself as a raised well: a body darker than the panel, a
    // hairline rim and a soft drop shadow (that is the treatment Pass 35 copied onto the
    // gem tiles). The direction has changed — these tiles are to read like the text
    // panel's inactive font buttons, which are one flat translucent rounded rectangle.
    //
    // So the Button's own visual is switched off every frame (it turns itself back on
    // when its state changes — the same thing UiTheme.hidePlateVisuals exists for) and
    // this rectangle is drawn in its place. It is built BEFORE the Button and the
    // ElementContent so that it is child 0: the icon's object comes after it in the
    // hierarchy and therefore paints over it. Built after, it would cover the sticker.
    if (GLASS) {
      const back = global.scene.createSceneObject("TileBack")
      back.setParent(so)
      back.getTransform().setLocalPosition(new vec3(0, 0, TILE_BACK_Z))
      addFlatShape(back, uiRoundRect(BUTTON_SIZE, BUTTON_SIZE, TILE_BACK_R), vec3.zero(), new vec3(1, 1, 1), PANEL_TILE_FILL)
    }

    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(BUTTON_SIZE, BUTTON_SIZE, 1)
    this.tileRoots.push(so)

    // ElementContent renders the flower as a centered icon (handles its own material).
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.leadingIcon = tex
    ec.leadingIconSize = ICON_SIZE
    ec.iconLayout = "left"

    so.createComponent(FlexItem.getTypeName())

    // Tappable (display-only this pass): emit the index. No placement logic yet.
    btn.onTriggerUp.add(() => {
      this._onStickerTapped.invoke(index)
    })
  }
}
