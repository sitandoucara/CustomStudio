const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

const BUCKET_STICKERS = "custom_upload";
const BUCKET_PHOTOS = "custom_save";
const TABLE_PHOTOS = "custom_photos";

/* ------------------------------------------------------------------ */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg"];
const BASE = SUPABASE_URL.replace(/\/+$/, "");

const el = (id) => document.getElementById(id);

const drop = el("drop");
const preview = el("preview");
const grid = el("grid");
const saveBtn = el("save");
const clearBtn = el("clear");
const actions = el("actions");
const msg = el("msg");
const tabS = el("tabStickers");
const tabG = el("tabGallery");

const input = Object.assign(document.createElement("input"), {
  type: "file",
  accept: "image/png,image/jpeg",
});

input.style.display = "none";
document.body.appendChild(input);

let picked = null;
let tab = "stickers";
let stickers = [];
let photos = [];

let armed = null;
let armTimer = null;

/* ------------------------------------------------------------------ */
/*  SUPABASE HELPERS                                                   */
/* ------------------------------------------------------------------ */

const headers = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
});

const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

const publicUrl = (bucket, path) =>
  BASE + "/storage/v1/object/public/" + bucket + "/" + encodePath(path);

/*
  Pour les photos de la galerie, on ajoute une version à l'URL.
  Cela évite qu'un navigateur ou un CDN affiche une ancienne image
  depuis son cache alors que le contenu a changé.
*/
function versionedPublicUrl(bucket, path, version) {
  const url = publicUrl(bucket, path);

  if (version == null || version === "") {
    return url;
  }

  return url + "?v=" + encodeURIComponent(String(version));
}

/*
  ------------------------------------------------------------------
  LISTING D'UN BUCKET
  ------------------------------------------------------------------

  Renvoie les objets réellement présents dans le Storage, avec leur
  chemin complet.

  L'API renvoie "name" relatif au préfixe demandé, donc on reconstruit
  le chemin complet nous-mêmes. Les dossiers reviennent avec id === null
  et sont écartés.
*/
async function listBucket(bucket, prefix) {
  const at = prefix || "";

  const res = await fetch(BASE + "/storage/v1/object/list/" + bucket, {
    method: "POST",

    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },

    /*
      Évite qu'une réponse de listing précédente
      reste utilisée par le navigateur.
    */
    cache: "no-store",

    body: JSON.stringify({
      prefix: at,
      limit: 1000,

      sortBy: {
        column: "created_at",
        order: "desc",
      },
    }),
  });

  if (!res.ok) {
    throw new Error("Listing " + bucket + " failed: HTTP " + res.status);
  }

  const rows = await res.json();

  return rows
    .filter((o) => o && o.name && !o.name.endsWith("/") && o.id)
    .map((o) => ({
      ...o,
      path: at ? at + "/" + o.name : o.name,
    }));
}

/* ------------------------------------------------------------------ */
/*  UI HELPERS                                                         */
/* ------------------------------------------------------------------ */

function say(text, kind) {
  msg.textContent = text || "";
  msg.className = "msg" + (kind ? " " + kind : "");
}

function kb(b) {
  return b < 1048576
    ? Math.round(b / 1024) + " KB"
    : (b / 1048576).toFixed(1) + " MB";
}

function when(iso) {
  const d = new Date(iso);

  if (isNaN(d)) {
    return "";
  }

  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function prettyName(path) {
  const file = path.split("/").pop() || path;

  return file.replace(/\.[a-z0-9]+$/i, "").replace(/-[a-z0-9]{6,}$/i, "");
}

function counts() {
  el("cntStickers").textContent = stickers.length;
  el("cntGallery").textContent = photos.length;

  el("specStickers").textContent = stickers.length;
  el("specPhotos").textContent = photos.length;
}

/* ------------------------------------------------------------------ */
/*  PICKING & UPLOAD                                                   */
/* ------------------------------------------------------------------ */

function reject(reason) {
  picked = null;
  actions.hidden = true;
  drop.classList.remove("has-art");
  say(reason, "err");
}

function accept(file) {
  say("");

  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
    return reject(
      "SVG isn't supported. Export it as a PNG with a transparent background first.",
    );
  }

  if (!ALLOWED.includes(file.type)) {
    return reject(
      "That's a " +
        (file.type || "unknown file") +
        ". Only PNG and JPEG can be used as stickers.",
    );
  }

  if (file.size > MAX_BYTES) {
    return reject(
      "That file is " +
        kb(file.size) +
        ". The limit is 5 MB — resize it and try again.",
    );
  }

  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    picked = file;

    preview.src = url;

    drop.classList.add("has-art");

    actions.hidden = false;

    saveBtn.disabled = false;
    saveBtn.textContent = "Save to library";

    el("dropTitle").textContent = file.name;

    el("dropSub").textContent =
      img.naturalWidth +
      " × " +
      img.naturalHeight +
      " px · " +
      kb(file.size) +
      (file.type === "image/jpeg" ? " · JPEG, prints as a rectangle" : "");
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject("That file couldn't be read as an image.");
  };

  img.src = url;
}

function resetPicker() {
  picked = null;
  input.value = "";

  preview.src = "";

  drop.classList.remove("has-art");

  actions.hidden = true;

  el("dropTitle").textContent = "Drop your artwork here";

  el("dropSub").textContent = "or click to choose a file";
}

function safeName(name) {
  const dot = name.lastIndexOf(".");

  const ext = dot > -1 ? name.slice(dot).toLowerCase() : ".png";

  const stem =
    (dot > -1 ? name.slice(0, dot) : name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "artwork";

  return stem + "-" + Date.now().toString(36) + ext;
}

/* ------------------------------------------------------------------ */
/*  PICKER EVENTS                                                      */
/* ------------------------------------------------------------------ */

drop.addEventListener("click", () => {
  if (!picked) {
    input.click();
  }
});

drop.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && !picked) {
    e.preventDefault();
    input.click();
  }
});

input.addEventListener("change", () => {
  if (input.files[0]) {
    accept(input.files[0]);
  }
});

["dragenter", "dragover"].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  }),
);

["dragleave", "drop"].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
  }),
);

drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];

  if (f) {
    accept(f);
  }
});

clearBtn.addEventListener("click", () => {
  resetPicker();
  say("");
});

/* ------------------------------------------------------------------ */
/*  SAVE STICKER                                                       */
/* ------------------------------------------------------------------ */

saveBtn.addEventListener("click", async () => {
  if (!picked) {
    return;
  }

  if (!configured()) {
    return say(
      "Add your Supabase URL and anon key at the top of app.js.",
      "err",
    );
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  say("");

  const path = safeName(picked.name);

  try {
    const res = await fetch(
      BASE + "/storage/v1/object/" + BUCKET_STICKERS + "/" + path,
      {
        method: "POST",

        headers: {
          ...headers(),
          "Content-Type": picked.type,
          "x-upsert": "false",
        },

        body: picked,
      },
    );

    if (!res.ok) {
      throw new Error("HTTP " + res.status + " " + (await res.text()));
    }

    say("Saved. Open the Lens and tap + to place it.", "ok");

    resetPicker();

    await loadStickers();

    counts();
    render();
  } catch (err) {
    say("Upload failed. " + err.message, "err");

    saveBtn.disabled = false;
    saveBtn.textContent = "Save to library";
  }
});

/* ------------------------------------------------------------------ */
/*  LOADING                                                            */
/* ------------------------------------------------------------------ */

async function loadStickers() {
  if (!configured()) {
    return;
  }

  const objects = await listBucket(BUCKET_STICKERS, "");

  stickers = objects.map((o) => ({
    path: o.path,

    url: versionedPublicUrl(
      BUCKET_STICKERS,
      o.path,
      o.updated_at || o.created_at || o.id,
    ),

    date: o.created_at || o.updated_at,
  }));
}

async function loadPhotos() {
  if (!configured()) {
    return;
  }

  /*
    La galerie est alimentée par custom_photos, qui porte les
    métadonnées (couleur, nombre de stickers, date).

    Mais la table peut contenir des lignes dont le fichier a
    disparu du Storage. On recoupe donc les deux AVANT de
    compter et d'afficher : sinon le badge annonce le nombre
    de lignes alors que la grille affiche le nombre de fichiers.
  */

  const res = await fetch(
    BASE +
      "/rest/v1/" +
      TABLE_PHOTOS +
      "?select=*" +
      "&order=created_at.desc" +
      "&limit=200",
    {
      headers: {
        ...headers(),
        "Cache-Control": "no-cache",
      },

      cache: "no-store",
    },
  );

  if (!res.ok) {
    throw new Error("Listing photos failed: HTTP " + res.status);
  }

  const rows = await res.json();

  const usable = rows.filter((r) => r && r.id != null && r.storage_path);

  const toPhoto = (r) => ({
    id: r.id,

    path: r.storage_path,

    /*
      On versionne l'URL pour réduire les problèmes
      d'anciennes images encore présentes dans le cache.
    */
    url: versionedPublicUrl(
      BUCKET_PHOTOS,
      r.storage_path,
      r.updated_at || r.created_at || r.id,
    ),

    date: r.created_at,

    color: r.shirt_color,

    stickers: r.sticker_count,
  });

  if (!usable.length) {
    photos = [];
    return;
  }

  /*
    Les chemins peuvent vivre dans des sous-dossiers. On liste
    chaque dossier concerné une seule fois, puis on construit
    l'ensemble des chemins qui existent réellement.
  */
  const folders = new Set(
    usable.map((r) => {
      const cut = r.storage_path.lastIndexOf("/");

      return cut === -1 ? "" : r.storage_path.slice(0, cut);
    }),
  );

  try {
    const listings = await Promise.all(
      [...folders].map((folder) => listBucket(BUCKET_PHOTOS, folder)),
    );

    const onDisk = new Set(listings.flat().map((o) => o.path));

    photos = usable.filter((r) => onDisk.has(r.storage_path)).map(toPhoto);
  } catch (err) {
    /*
      Si le listing du bucket échoue, on n'a aucune raison de
      vider la galerie. On affiche les lignes telles quelles :
      le handler "error" de chaque image reste en place comme
      filet de sécurité.
    */
    console.warn("Storage cross-check skipped:", err);

    photos = usable.map(toPhoto);
  }
}

/* ------------------------------------------------------------------ */
/*  REFRESH                                                            */
/* ------------------------------------------------------------------ */

async function refresh() {
  if (!configured()) {
    grid.innerHTML =
      '<p class="empty">Add your Supabase URL and anon key at the top of app.js to load your library.</p>';

    return;
  }

  try {
    /*
      Les deux listings sont chargés en parallèle.
    */
    await Promise.all([loadStickers(), loadPhotos()]);

    say("");
  } catch (err) {
    say(err.message, "err");
  }

  counts();
  render();
}

/* ------------------------------------------------------------------ */
/*  RENDERING                                                          */
/* ------------------------------------------------------------------ */

function makeTile(item) {
  /*
    IMPORTANT :
    on mémorise le type de tuile maintenant.

    On évite ainsi de dépendre de la variable globale "tab"
    plus tard, notamment pendant les événements asynchrones.
  */
  const tileType = tab;
  const isPhoto = tileType === "gallery";

  const tile = document.createElement("div");

  tile.className = "tile" + (isPhoto ? " photo" : "");

  const art = document.createElement("div");

  art.className = "art";

  const img = document.createElement("img");

  img.src = item.url;
  img.alt = "";
  img.loading = "lazy";

  /*
    --------------------------------------------------------
    FILET DE SÉCURITÉ
    --------------------------------------------------------

    Les lignes fantômes sont normalement déjà écartées par le
    recoupement fait dans loadPhotos().

    Ce handler reste utile pour un fichier supprimé entre le
    listing et l'affichage, ou si le recoupement a échoué.
  */
  img.addEventListener(
    "error",
    () => {
      if (isPhoto) {
        photos = photos.filter((p) => p !== item);
      } else {
        stickers = stickers.filter((s) => s !== item);
      }

      counts();

      if (tile.isConnected) {
        tile.remove();
      }

      /*
        Si l'image supprimée était la dernière,
        on rerender afin d'afficher le message vide.
      */
      const remaining = isPhoto ? photos.length : stickers.length;

      if (remaining === 0 && tab === tileType) {
        render();
      }
    },
    { once: true },
  );

  art.appendChild(img);

  const caption = document.createElement("div");

  caption.className = "caption";

  if (isPhoto) {
    const date = document.createElement("div");

    date.className = "date";
    date.textContent = when(item.date);

    caption.appendChild(date);

    if (item.color || item.stickers != null) {
      const meta = document.createElement("div");

      meta.className = "meta";

      if (item.color) {
        const sw = document.createElement("span");

        sw.className = "swatch";
        sw.style.background = item.color;

        meta.appendChild(sw);
      }

      if (item.stickers != null) {
        meta.appendChild(
          document.createTextNode(
            item.stickers + (item.stickers === 1 ? " sticker" : " stickers"),
          ),
        );
      }

      caption.appendChild(meta);
    }
  } else {
    const name = document.createElement("div");

    name.className = "name";
    name.textContent = prettyName(item.path);

    name.title = item.path;

    caption.appendChild(name);

    if (item.date) {
      const meta = document.createElement("div");

      meta.className = "meta";
      meta.textContent = when(item.date);

      caption.appendChild(meta);
    }
  }

  const del = document.createElement("button");

  del.className = "del";

  del.title = "Delete";

  del.setAttribute("aria-label", "Delete");

  del.innerHTML =
    '<svg viewBox="0 0 24 24">' +
    '<path d="M4 7h16M9.5 7V5h5v2M6.5 7l.9 12.1a1 1 0 001 .9h7.2a1 1 0 001-.9L18.5 7M10 11v5M14 11v5"/>' +
    "</svg>";

  del.addEventListener("click", (e) => {
    e.stopPropagation();

    /*
        On passe également le type de tuile à onDelete.
        Donc même si l'utilisateur change d'onglet pendant
        la requête, le code sait toujours ce qu'il supprime.
      */
    onDelete(item, del, tileType);
  });

  tile.append(del, art, caption);

  return tile;
}

function render() {
  const items = tab === "stickers" ? stickers : photos;

  grid.innerHTML = "";

  if (!items.length) {
    const p = document.createElement("p");

    p.className = "empty";

    p.textContent =
      tab === "stickers"
        ? "No stickers yet. Drop your first piece of artwork above."
        : "No photos yet. Capture one in the Lens and it appears here.";

    grid.appendChild(p);

    return;
  }

  items.forEach((it) => {
    grid.appendChild(makeTile(it));
  });
}

/* ------------------------------------------------------------------ */
/*  DELETE                                                             */
/* ------------------------------------------------------------------ */

function disarm() {
  if (armed && armed._btn) {
    armed._btn.classList.remove("armed");

    armed._btn.title = "Delete";
  }

  armed = null;

  clearTimeout(armTimer);
}

/*
  IMPORTANT :

  "sourceTab" correspond à l'onglet depuis lequel la tuile
  a été créée.

  On ne dépend donc jamais de la variable globale "tab"
  après un await.

  C'était l'un des principaux risques de désynchronisation :
  l'utilisateur pouvait lancer une suppression dans Gallery,
  changer d'onglet, puis la requête revenait alors que
  tab === "stickers".
*/
async function onDelete(item, btn, sourceTab) {
  if (armed !== item) {
    disarm();

    armed = item;
    item._btn = btn;

    btn.classList.add("armed");

    btn.title = "Click again to delete";

    say("Click the bin again to delete. This cannot be undone.");

    armTimer = setTimeout(() => {
      if (armed === item) {
        disarm();
        say("");
      }
    }, 4000);

    return;
  }

  disarm();
  say("");

  /*
    On fige toutes les informations nécessaires AVANT
    le premier await.
  */
  const deletingFrom = sourceTab || tab;

  const isPhoto = deletingFrom === "gallery";

  const bucket = isPhoto ? BUCKET_PHOTOS : BUCKET_STICKERS;

  /*
    Copies pour restaurer l'état local si Supabase échoue.
  */
  const previousPhotos = [...photos];

  const previousStickers = [...stickers];

  /*
    --------------------------------------------------------
    SUPPRESSION OPTIMISTE
    --------------------------------------------------------

    On retire immédiatement la tuile à l'écran.

    L'utilisateur ne doit pas attendre les deux requêtes
    Supabase avant de voir l'image disparaître.
  */
  if (isPhoto) {
    photos = photos.filter((p) => p !== item);
  } else {
    stickers = stickers.filter((s) => s !== item);
  }

  counts();

  /*
    On ne rerender que si l'utilisateur regarde encore
    l'onglet concerné.
  */
  if (tab === deletingFrom) {
    render();
  }

  say("Deleting…");

  try {
    /*
      ------------------------------------------------------
      1. DELETE STORAGE
      ------------------------------------------------------
    */

    const storageRes = await fetch(
      BASE + "/storage/v1/object/" + bucket + "/" + encodePath(item.path),
      {
        method: "DELETE",

        headers: headers(),

        cache: "no-store",
      },
    );

    if (!storageRes.ok) {
      throw new Error(
        "Storage HTTP " + storageRes.status + " " + (await storageRes.text()),
      );
    }

    /*
      ------------------------------------------------------
      2. DELETE DATABASE ROW
      ------------------------------------------------------

      Seulement pour la galerie.

      Les stickers n'utilisent pas custom_photos.
    */
    if (isPhoto) {
      const dbRes = await fetch(
        BASE +
          "/rest/v1/" +
          TABLE_PHOTOS +
          "?id=eq." +
          encodeURIComponent(item.id),
        {
          method: "DELETE",

          headers: {
            ...headers(),

            /*
                PostgREST doit nous retourner la ligne
                réellement supprimée.

                Sans ça, une RLS peut refuser le DELETE
                tout en renvoyant une réponse qui semble
                valide.
              */
            Prefer: "return=representation",
          },

          cache: "no-store",
        },
      );

      if (!dbRes.ok) {
        throw new Error(
          "Database HTTP " + dbRes.status + " " + (await dbRes.text()),
        );
      }

      const rows = await dbRes.json();

      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(
          "The database row wasn't removed. Check the DELETE RLS policy on " +
            TABLE_PHOTOS +
            ".",
        );
      }
    }

    say("Deleted.", "ok");
  } catch (err) {
    /*
      ------------------------------------------------------
      ROLLBACK UI
      ------------------------------------------------------

      La suppression locale était optimiste.

      Si Supabase échoue, on restaure donc l'état précédent.
    */
    photos = previousPhotos;

    stickers = previousStickers;

    counts();

    if (tab === deletingFrom) {
      render();
    }

    say("Delete failed. " + err.message, "err");
  }
}

/* ------------------------------------------------------------------ */
/*  TABS                                                               */
/* ------------------------------------------------------------------ */

function setTab(next) {
  tab = next;

  tabS.setAttribute("aria-selected", String(next === "stickers"));

  tabG.setAttribute("aria-selected", String(next === "gallery"));

  disarm();

  say("");

  render();
}

tabS.addEventListener("click", () => setTab("stickers"));

tabG.addEventListener("click", () => setTab("gallery"));

el("refresh").addEventListener("click", refresh);

/* ------------------------------------------------------------------ */
/*  INITIAL LOAD                                                       */
/* ------------------------------------------------------------------ */

refresh();
