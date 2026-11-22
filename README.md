# Umrah Ops Room

A phone app (installable web app) for running umrah groups in Makkah, Madinah and Taif:
home screen with today's and tomorrow's programme, pending issues, daily checklists,
rooms and rooming lists, pilgrim flags and photos, complaints and itineraries.

It is a static site (GitHub Pages) with a Supabase database, so two or more staff see
the same data live. Ticks and edits made without signal are kept on the phone and sent
when the connection returns.

## Set up (once)

1. **Supabase** (free): create a project at supabase.com.
   - SQL Editor → run `supabase/schema.sql`, then the private seed file you were given
     (pilgrim names and staff numbers; it is kept out of this public repo on purpose).
   - Authentication → Users → **Add user** for each staff member (email + password,
     tick *Auto confirm*).
   - Authentication → Sign In / Providers → turn **off** "Allow new users to sign up",
     so only the accounts you create can get in.
   - Project Settings → API: copy the **Project URL** and the **anon public** key into `config.js`.
2. **GitHub Pages**: repo Settings → Pages → Source *Deploy from a branch* → pick the
   branch with these files, folder `/ (root)` → Save. The app is then at
   `https://<user>.github.io/claude-video/`.
3. **On each phone**: open that address, sign in, then
   - Android (Chrome): menu ⋮ → **Install app** (or the Install banner).
   - iPhone (Safari): Share → **Add to Home Screen**.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app (UI and logic) |
| `backend.js` | Sign-in, live sync with Supabase, offline cache and write queue, photo storage |
| `config.js` | Your Supabase URL and anon key |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable and open offline |
| `supabase/schema.sql` | Table, security rules, live updates, photo bucket |
