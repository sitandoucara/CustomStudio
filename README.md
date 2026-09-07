# CUSTOM STUDIO — Spectacles

> A spatial design studio for SPECS. Pick a garment — a t-shirt, a cap, a tote bag, a pair of socks — and customise it in the air in front of you: recolour it, paint on it, place stickers and typed text, scatter faceted 3D gems across it. Turn it on its turntable to work on the back. Photograph the result, and it lands in a cloud gallery you can open from any phone or laptop.

---

## About

Custom Studio is a customisation tool, not a viewer. A garment floats at arm's length on a
turntable; everything you do to it is direct manipulation with your hands. You drag a
sticker across the cloth and it follows the surface, around the curve of a cap's crown or
down the front of a shin. You paint on it and the stroke stops where the fabric ends. You
drop a gem and it lies flat against the weave, catching the light, because it is a real
faceted solid rather than a picture of one.

Four garments ship, and they are not four special cases. Each one is a **garment
definition** — its mesh, its fit and centring, its printable panels with their own
centimetre scales and clamp rectangles — generated from the model itself by a pair of
tools in `Lens/tools/`. Adding a fifth is one definition plus its asset, with no change to
the drag, paint, gem, clamp or capture code.

Four kinds of content sit on top of that, in a defined order. The base colour lives in the
fabric layer, paint accumulates in its own persistent texture above it, and stickers, text
and imported artwork bake above the paint. Gems are the exception, and deliberately so:
they are geometry, not pixels, so a gem is the one thing here that could not exist on a
flat screen.

When a design is finished, a shutter button photographs it against a studio ground through
a second camera that sees only the garment. The still is frozen into an independent
texture, uploaded to Supabase as a JPEG, and appears in an in-Lens gallery and on a
companion web page where you can also drop your own artwork into the sticker library.

> **A note on scope:** the Lens is fully usable with no backend at all. Without Supabase
> credentials, every garment, tool, capture and gallery still works — the cloud save and
> the artwork import are simply labelled off. Nothing breaks, nothing retries, nothing asks.

---

## Features

**The garments**

- Four garments on a segmented control: **t-shirt, cap, tote bag, socks**. One on screen at
  a time, centred on the turntable, front-facing.
- Each keeps its own state — base colour, paint layer, stickers, text, gems. Switching to
  the cap and back finds the shirt exactly as you left it.
- A **rotation bar** turns the active garment on its Y axis, ±180°, so the back and the
  sides are reachable. Centre always means front-facing.
- The **socks are a pair**, one garment with a separate bake target per sock, so a sticker
  or a stroke lands only on the sock it sits on. A Left/Right selector says which one
  receives the next thing you place.

**Colour**

- A rainbow slider with **white at its centre**, so a garment boots blank — the honest
  starting point for a customiser. The colour applied is exactly the colour under the knob.
- An **eyedropper** that samples the real world through the Spectacles camera: aim at a
  wall, an awning, a plant, and the average of that patch becomes the garment's colour or
  the brush's.

**Paint**

- A persistent paint layer per garment, with nine colour chips, a **brush size slider**
  (0.9 to 4.4 cm on the cloth) and a two-tap erase that clears the paint and nothing else.
- The brush is an ellipse in texture space whose axes come from each panel's own
  centimetres-per-UV, which makes it a circle **on the cloth** — on every panel, including
  sleeves whose unwraps are rotated in the atlas.
- Strokes are rejected outside a panel rather than clamped, so a brush running off the
  fabric stops at the edge instead of smearing down a seam.

**Stickers, text and imported artwork**

- Six built-in stickers, and any image you upload to the library.
- A selection frame with four corner handles: **delete, duplicate, resize, rotate**, with
  15° rotation snapping. The frame hugs the visible artwork at every scale and angle —
  imported images are measured for their alpha bounds at import, so transparent padding
  never ends up inside the frame.
- **Typed text** behaves exactly like a sticker: five fonts, nine colours, dragged, resized,
  rotated, duplicated. It is rendered to a texture and stamped through the same path.
- Non-square artwork keeps its aspect ratio, capped at 4:1.

**Gems**

- Six cuts — round, heart, star, square, teardrop, flower — plus Mix, which draws a
  different cut per stone. Eleven jewel tones, plus a Mix that varies the colour too.
- Each gem is a faceted solid with a flat back, a girdle and a bevelled crown, oriented by
  the local surface normal so it lies against the curve of the cloth.
- **A tap drops one; a press-and-drag sows a trail.** Every stone takes a random rotation
  about the normal and a size varied ±22%, because identical clones on a grid is what makes
  this look fake.
- All stones of one colour on one garment share a single mesh, so a covered garment costs
  at most one draw call per colour used.
- Undo removes the last stroke; Clear wipes them all behind a two-tap confirm.

**Capture and the gallery**

- A shutter photographs the garment against a studio ground through a second camera that
  renders only the garment layer — no UI, no selection frame, ever.
- The still is **frozen** into an independent texture the moment you press, so it stays as
  it was while you carry on editing.
- Uploaded to Supabase as a JPEG in about 200 ms, entirely off the frame.
- The gallery is a carousel, newest first, each card captioned with its colour, its facing
  and its date. Delete removes the photo from the cloud for real.

**The library (web companion)**

- Drop a PNG or JPEG and it becomes a sticker available behind the **My lib** button in the
  Lens.
- Two tabs: the sticker library and the photo gallery, both browsable and deletable.
- Rejects what the Lens cannot use, and says why: SVG, oversized files, wrong formats. Warns
  when a PNG has no transparency, because that one prints as a rectangle.

---

## Quick Start

```
CustomStudio/
├── Lens/                    the Lens Studio project
│   ├── Assets/Garments/     the four 3D models
│   ├── tools/               the mesh survey and panel generator
│   ├── docs/
│   └── custom_studio.esproj
├── Web/                     the companion library (static, no build step)
├── LICENSE
└── README.md
```

`Lens/` runs on its own. `Web/` and Supabase are only needed for cloud save and artwork
import.

### 1. Clone the repository

Assets are stored with **Git LFS**. GitHub's "Download ZIP" does not resolve LFS files —
you would get pointer stubs instead of images and the project would fail to open.

```bash
git lfs install
git clone https://github.com/sitandoucara/CustomStudio.git
cd CustomStudio
```

### 2. Run the Lens

Open `Lens/custom_studio.esproj` in **Lens Studio 5.22+**, signed in to your Snapchat
account. Preview works fully in-editor — every gesture is driven by the mouse.

That is the whole setup. Everything below is optional.

### 3. Set up Supabase (optional — enables cloud save and import)

Create a project at [supabase.com](https://supabase.com), then run this in **SQL Editor →
New query**:

```sql
-- Two buckets: one for captured photos, one for artwork you upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('custom_save',   'custom_save',   true, 10485760, array['image/png','image/jpeg']),
  ('custom_upload', 'custom_upload', true,  5242880, array['image/png','image/jpeg']);

-- One row per captured photo.
create table public.custom_photos (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null,
  shirt_color   text,
  yaw_deg       real,
  sticker_count smallint,
  created_at    timestamptz not null default now()
);

alter table public.custom_photos enable row level security;

create policy "custom_photos anon insert" on public.custom_photos
  for insert to anon with check (true);
create policy "custom_photos anon read"   on public.custom_photos
  for select to anon using (true);
create policy "custom_photos anon delete" on public.custom_photos
  for delete to anon using (true);

create policy "custom_save anon insert"   on storage.objects
  for insert to anon with check (bucket_id = 'custom_save');
create policy "custom_save anon delete"   on storage.objects
  for delete to anon using (bucket_id = 'custom_save');

-- The Lens lists this bucket to show you what artwork is available.
create policy "custom_upload anon read"   on storage.objects
  for select to anon using (bucket_id = 'custom_upload');
create policy "custom_upload anon insert" on storage.objects
  for insert to anon with check (bucket_id = 'custom_upload');
create policy "custom_upload anon delete" on storage.objects
  for delete to anon using (bucket_id = 'custom_upload');

create index custom_photos_created_at_idx on public.custom_photos (created_at desc);
```

> **`custom_save` needs no SELECT policy.** The bucket is public, so the Lens reads each
> photo by its public URL and never lists the bucket — the gallery lists the table instead.
> `custom_upload` does need one, because the artwork panel discovers what is in there.

Then copy `Lens/Assets/Scripts/SupabaseConfig.example.ts` to `SupabaseConfig.ts` and fill in
two values from **Project Settings → API**: your project URL and the `anon public` key.
That file is gitignored, and it is the only file in the project that ever holds them.

### 4. Run the library (optional)

`Web/` is static, with no build step. Fill in the same two values at the top of
`Web/app.js`, then serve the folder:

```bash
cd Web
python3 -m http.server 8000
```

Open `http://localhost:8000`. Serve it rather than opening the file directly — a `file://`
origin can trip up the requests to Supabase.

---

## Built With

| Tool                                                          | Purpose                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Lens Studio 5.22](https://ar.snap.com/lens-studio)           | AR development environment for SPECS                                              |
| **CLAD**                                                      | The agentic workflow that built it — see the prompt log submitted with this entry |
| TypeScript                                                    | Every controller in the Lens                                                      |
| SpectaclesInteractionKit                                      | Hand tracking, `Interactable`, ray input                                          |
| SpectaclesUIKit                                               | Slider primitives                                                                 |
| CameraModule                                                  | The world colour picker                                                           |
| InternetModule                                                | Supabase Storage and PostgREST calls                                              |
| `Base64.encodeTextureAsync`                                   | Turning a frozen capture into a JPEG                                              |
| `ProceduralTextureProvider`                                   | Freezing the render target, and the gallery thumbnails                            |
| [Supabase](https://supabase.com)                              | Storage, Postgres and Row Level Security                                          |
| Python                                                        | `survey.py` and `genpanels.py`, the garment pipeline                              |
| Inter · Playfair Display · Pacifico · Bebas Neue · Space Mono | The text tool's five faces                                                        |

---

## Notes

A few things worth flagging so nobody is surprised:

- **Cloud features are optional and clearly labelled.** With no `SupabaseConfig.ts`, the
  Lens performs zero network requests — not failed ones, none attempted. The gallery is
  session-only, and both cloud pages say on screen which file to fill in.
- **The anon key is meant to be public**, the same way a web app ships one in its
  JavaScript. What protects the data is the RLS policy set, not the key's secrecy. Note
  that the policies above grant INSERT and DELETE to anyone holding it — that is the right
  trade for a prototype and the wrong one for anything you care about.
- **The world colour picker uses an experimental API.** In Preview it just works. On device
  the camera frame requires Experimental APIs enabled, which prevents public publishing, and
  camera access disables open internet unless Extended Permissions is on — which would in
  turn stop the Supabase save. Preview has both.
- **`UI_STYLE` reverts the whole interface.** One constant in `Lens/Assets/Scripts/UiTheme.ts`
  returns every surface, position and hit box to the pre-restyle build.
- **Not tested on hardware.** SPECS are not publicly available, and the hackathon explicitly
  requires no device. Every gesture is proven with mouse-driven input in Preview; pinch and
  hand-ray are wired but unverified at real arm's length.

---

## Built agentically

The Lens was built by CLAD, one verifiable layer at a time — from the first garment and its
printable panels, through the generation of every sticker, gem and piece of procedural
geometry, to the mesh tools that make a fifth garment a definition rather than a rewrite.

The process, the measurements, the decisions and the dead ends are in the CLAD prompt log
submitted with this entry.

---

## License

MIT License — see [LICENSE](LICENSE). The garment models are excluded; they remain under
their Sketchfab licences.

---

## Credits

Garment models from [Sketchfab](https://sketchfab.com), under their own licences.

Built with [CLAD](https://developers.specs.com) for [SPECS](https://www.specs.com).
Cloud storage on [Supabase](https://supabase.com).

Project by [Sitan Doucara](https://github.com/sitandoucara).
