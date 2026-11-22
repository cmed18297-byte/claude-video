/* Umrah Ops Room: Supabase backend.
   Gives the app the same small API it used on claude.ai (window.claude.use("db" | "user" | "assets")),
   adds sign-in, an offline cache with a write queue, photo storage, install prompt and the service worker. */
(function () {
  const cfg = window.UMRAH_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const CACHE_KEY = "umrah-cache-v1", QUEUE_KEY = "umrah-queue-v1";
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---------- service worker + install prompt ---------- */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  let deferredInstall = null;
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function installBar(html) {
    if (!document.body) return;
    if (standalone() || ls.get("umrah-install-dismissed", false)) return;
    const bar = document.createElement("div");
    bar.className = "installbar";
    bar.innerHTML = html + '<button class="btn small ghost" data-x>Not now</button>';
    bar.querySelector("[data-x]").onclick = () => { ls.set("umrah-install-dismissed", true); bar.remove(); };
    const go = bar.querySelector("[data-install]");
    if (go) go.onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; bar.remove(); };
    document.body.appendChild(bar);
  }
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; installBar('<span>Install Umrah Ops on this phone</span><button class="btn small primary" data-install>Install</button>'); });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone()) {
    window.addEventListener("load", () => setTimeout(() => installBar("<span>To install: tap Share, then <b>Add to Home Screen</b></span>"), 1500));
  }

  if (!configured) {
    // Not set up yet: run the app on this device only (the app's own local mode).
    window.claude = { use: async () => null };
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
  let session = null;
  let authResolve; const authed = new Promise(r => { authResolve = r; });

  /* ---------- sign-in screen ---------- */
  function showLogin(msg) {
    if (!document.body) { document.addEventListener("DOMContentLoaded", () => showLogin(msg), { once: true }); return; }
    let el = document.getElementById("login");
    if (!el) { el = document.createElement("div"); el.id = "login"; document.body.appendChild(el); }
    el.innerHTML = `<form class="loginbox" id="loginForm">
      <div class="loginlogo"><img src="icons/icon-192.png" alt="" width="64" height="64"></div>
      <h1 style="margin:0;font-size:1.6rem">Umrah Ops Room</h1>
      <p style="margin:0;color:var(--muted);font-size:.88rem">Sign in with the account the group owner created for you.</p>
      <label class="f" for="lg-e">Email<input id="lg-e" type="email" autocomplete="username" required></label>
      <label class="f" for="lg-p">Password<input id="lg-p" type="password" autocomplete="current-password" required></label>
      ${msg ? `<div class="notice warn" style="font-size:.82rem">${msg}</div>` : ""}
      <button class="btn primary" type="submit" style="width:100%">Sign in</button>
    </form>`;
    el.querySelector("form").onsubmit = async e => {
      e.preventDefault();
      const btn = el.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Signing in…";
      const { data, error } = await sb.auth.signInWithPassword({ email: el.querySelector("#lg-e").value.trim(), password: el.querySelector("#lg-p").value });
      if (error) { showLogin(/invalid/i.test(error.message) ? "Wrong email or password." : navigator.onLine ? "Couldn't sign in: " + error.message : "You're offline. Connect to sign in the first time."); return; }
      session = data.session; el.remove(); authResolve();
    };
  }
  window.umrahSignOut = async () => { await sb.auth.signOut().catch(() => {}); ls.set(CACHE_KEY, {}); ls.set(QUEUE_KEY, []); location.reload(); };
  sb.auth.getSession().then(({ data }) => {
    session = data && data.session;
    if (session) authResolve();
    else if (!navigator.onLine && Object.keys(ls.get(CACHE_KEY, {})).length) authResolve(); // offline with cached data
    else showLogin();
  });
  sb.auth.onAuthStateChange((ev, s) => { session = s; if (ev === "SIGNED_OUT" && !document.getElementById("login")) showLogin(); });

  /* ---------- data: cache + realtime + write queue ---------- */
  const store = ls.get(CACHE_KEY, {});   // { collection: { id: data } }
  let queue = ls.get(QUEUE_KEY, []);     // [{ op, col, id, data }]
  const listeners = {};
  let live = false, lastError = "";
  let saveT;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => ls.set(CACHE_KEY, store), 300); };
  function snap(col) {
    const m = store[col] || {};
    const docs = Object.keys(m).sort().map(id => ({ id, exists: true, data: () => m[id], metadata: {} }));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: !live, hasPendingWrites: queue.length > 0 }, docChanges: () => [] };
  }
  function emit(col) { (listeners[col] || []).forEach(fn => { try { fn(snap(col)); } catch (e) { console.error(e); } }); }
  function emitAll() { Object.keys(listeners).forEach(emit); }
  function applyLocal(q) {
    if (q.op === "set") (store[q.col] = store[q.col] || {})[q.id] = q.data;
    else if (store[q.col]) delete store[q.col][q.id];
  }
  async function fetchAll() {
    const fresh = {}; let from = 0;
    for (;;) {
      const { data, error } = await sb.from("docs").select("collection,id,data").range(from, from + 999);
      if (error) throw error;
      data.forEach(r => { (fresh[r.collection] = fresh[r.collection] || {})[r.id] = r.data; });
      if (data.length < 1000) break; from += 1000;
    }
    Object.keys(store).forEach(k => delete store[k]); Object.assign(store, fresh);
    queue.forEach(applyLocal); // unsent local changes stay visible
    live = true; lastError = ""; persist(); emitAll();
  }
  let flushing = false;
  async function flush() {
    if (flushing || !queue.length || !navigator.onLine) return;
    flushing = true;
    try {
      while (queue.length) {
        const q = queue[0]; let res;
        if (q.op === "set") res = await sb.from("docs").upsert({ collection: q.col, id: q.id, data: q.data, updated_at: new Date().toISOString() });
        else res = await sb.from("docs").delete().match({ collection: q.col, id: q.id });
        if (res.error) {
          if (/fetch|network|Failed/i.test(res.error.message || "")) break; // offline: try later
          lastError = res.error.message; console.error("Write refused", res.error);
        }
        queue.shift(); ls.set(QUEUE_KEY, queue);
      }
    } finally { flushing = false; }
  }
  window.addEventListener("online", () => { flush(); fetchAll().catch(() => {}); });
  setInterval(flush, 15000);
  window.umrahSync = () => ({ offline: !navigator.onLine, pending: queue.length, live, error: lastError });

  async function start() {
    await authed;
    sb.channel("docs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p => {
        const row = p.eventType === "DELETE" ? p.old : p.new; if (!row || !row.collection) return;
        if (queue.some(q => q.col === row.collection && q.id === row.id)) return; // our own pending write wins
        if (p.eventType === "DELETE") { if (store[row.collection]) delete store[row.collection][row.id]; }
        else (store[row.collection] = store[row.collection] || {})[row.id] = row.data;
        persist(); emit(row.collection);
      })
      .subscribe(status => { if (status === "SUBSCRIBED") fetchAll().catch(e => { lastError = e.message; }); });
    fetchAll().catch(e => { lastError = e.message; emitAll(); });
    flush();
  }
  const started = start();

  const db = {
    collection(col) {
      return {
        onSnapshot(next) { (listeners[col] = listeners[col] || []).push(next); setTimeout(() => next(snap(col)), 0); return () => { listeners[col] = (listeners[col] || []).filter(f => f !== next); }; },
        doc(id) {
          const write = q => { applyLocal(q); persist(); queue = queue.filter(x => !(x.col === q.col && x.id === q.id)); queue.push(q); ls.set(QUEUE_KEY, queue); emit(col); flush(); return Promise.resolve(); };
          return { id, set: data => write({ op: "set", col, id, data }), delete: () => write({ op: "del", col, id }) };
        },
      };
    },
  };

  /* ---------- photos (private bucket, signed links) ---------- */
  const urls = {}, pendingUrl = {};
  window.umrahPhotoUrl = (path, onReady) => {
    if (urls[path]) return urls[path];
    if (!pendingUrl[path]) {
      pendingUrl[path] = sb.storage.from("photos").createSignedUrl(path, 60 * 60 * 24 * 7).then(({ data }) => { if (data && data.signedUrl) { urls[path] = data.signedUrl; onReady && onReady(); } }).finally(() => { delete pendingUrl[path]; });
    }
    return "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  };
  const assets = {
    async upload(blob) {
      const ext = (blob.type || "image/jpeg").split("/")[1].replace("jpeg", "jpg");
      const path = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)) + "." + ext;
      const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (error) throw { code: /size|large/i.test(error.message) ? "too_large" : "unavailable", message: error.message };
      return { id: path, url: "" };
    },
    async delete(path) { await sb.storage.from("photos").remove([path]); },
  };
  const user = { can: async () => true, canEdit: async () => true, isOwner: async () => false, id: async () => session && session.user.id };

  window.claude = { use: async name => { await started.catch(() => {}); await authed; return name === "db" ? db : name === "user" ? user : name === "assets" ? assets : null; } };
})();
