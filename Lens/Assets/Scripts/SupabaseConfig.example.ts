// SupabaseConfig — the project's Supabase coordinates, and NOTHING else (Pass 14).
//
// WHERE THE SECRETS LIVE, AND WHY THIS FILE.
//
// A Lens has no server side and no environment: every value it uses at runtime is
// compiled into the bundle. So there is no arrangement in which the anon key is not
// shipped to the device — the only real question is whether it also ends up in version
// control, and this file is the answer to that:
//
//   - it is the ONLY place the two values appear, so there is exactly one thing to
//     rotate and exactly one thing to keep out of a repository;
//   - it is listed in .gitignore, alongside SupabaseConfig.example.ts which IS
//     committed and carries the shape without the values;
//   - nothing else in the project hard-codes a URL, a key, a bucket or a table name.
//
// The anon key is designed to be public — it is the same key a web app ships in its
// JavaScript, and what actually protects the data is the row-level security on the
// table and the bucket policies, not the secrecy of the key. Keeping it out of a public
// repo is hygiene (it makes the project trivially scrapeable and rate-limitable), not
// the security boundary. The security boundary is the anon policy set, which for this
// project is INSERT, SELECT and — since Pass 36 — DELETE, on both custom_photos and the
// custom_save bucket. Anyone holding this key can therefore remove photographs.
//
// FILL THESE IN. Both empty means every remote call is skipped and reports
// "no credentials" rather than failing — see SupabaseClient.available().

/** e.g. https://abcdefghijklm.supabase.co  — no trailing slash. */
export const SUPABASE_URL = "" // <-- paste here in SupabaseConfig.ts

/** The anon / publishable key (the long eyJ... JWT). */
export const SUPABASE_ANON_KEY = ""

// --- The backend's shape, as configured. Do not change these without changing it. ---
/** Bucket the Lens WRITES finished photographs to. public, 10 MB, image/png + image/jpeg. */
export const BUCKET_SAVE = "custom_save"
/** Bucket the Lens READS supplied images from. public, 5 MB, image/png + image/jpeg. */
export const BUCKET_UPLOAD = "custom_upload"
/** Table of photograph records. anon INSERT + SELECT. */
export const TABLE_PHOTOS = "custom_photos"

/** True when both credentials are present. */
export function hasCredentials(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
}

/**
 * The project URL with any trailing slashes removed.
 *
 * Every caller builds paths as baseUrl() + "/rest/v1/...", and a URL pasted with a
 * trailing slash would otherwise produce "//rest/v1/..." — which some gateways route
 * and some 404, i.e. exactly the kind of failure that looks like a credentials problem
 * and is not. Normalising here rather than asking anyone to re-paste the value.
 */
export function baseUrl(): string {
  let u = SUPABASE_URL
  while (u.length > 0 && u.charAt(u.length - 1) === "/") u = u.substring(0, u.length - 1)
  return u
}
