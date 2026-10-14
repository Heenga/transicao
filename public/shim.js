/*
 * Transição — camada de conta e dados.
 * Cuida do login (usuário + senha) e liga o app às rotas do servidor:
 *   db        → tabela "documents" no Supabase (com segurança por linha)
 *   user      → quem está logado e se é organizador
 *   sample    → IA (Claude) pelo /api/ai, com ferramentas executadas no navegador
 *   downloads → baixar arquivos
 */
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const USER_DOMAIN = "users.transicao.app";
  // O Supabase exige 6+ caracteres; senhas curtas (ex.: PIN de 4 números) ganham um sufixo fixo.
  const authPass = p => p.length < 6 ? p + "#transicao" : p;
  let sb = null, session = null, me = null;

  // ---------- chamadas ao servidor ----------
  async function api(path, opts = {}) {
    const { data: { session: s } } = await sb.auth.getSession();
    session = s;
    const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...(s ? { authorization: "Bearer " + s.access_token } : {}), ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: j.code || (r.status === 401 ? "not_granted" : "upstream_error"), message: j.message || "Erro de conexão.", status: r.status };
    return j;
  }

  // ---------- banco de dados ----------
  const snap = (path, d) => ({ id: path.split("/").pop(), exists: d != null, data: () => (d == null ? undefined : d), metadata: {} });
  const dbErr = e => ({ code: e?.code === "42501" ? "invalid_argument" : "unavailable", message: e?.message || "Falha no banco." });
  function poll(fn, next, err, ms) {
    let alive = true;
    const tick = async () => { try { const v = await fn(); if (alive) next(v); } catch (e) { if (alive && err) err(e); } };
    tick(); const t = setInterval(tick, ms);
    const vis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }
  const docRef = path => ({
    id: path.split("/").pop(), path,
    async get() { const { data, error } = await sb.from("documents").select("data").eq("path", path).maybeSingle(); if (error) throw dbErr(error); return snap(path, data?.data); },
    async set(d) { const { error } = await sb.from("documents").upsert({ path, owner: me.id, data: d }, { onConflict: "path" }); if (error) throw dbErr(error); },
    async update(d) { const s = await this.get(); return this.set({ ...(s.data() || {}), ...d }); },
    async delete() { const { error } = await sb.from("documents").delete().eq("path", path); if (error) throw dbErr(error); },
    onSnapshot(next, err) { return poll(() => this.get(), next, err, 30000); },
    collection: sub => colRef(path + "/" + sub),
  });
  const colRef = path => {
    const q = {
      path,
      doc: id => docRef(path + "/" + id),
      async get() {
        const { data, error } = await sb.from("documents").select("path,data").like("path", path + "/%");
        if (error) throw dbErr(error);
        const depth = path.split("/").length + 1;
        const docs = (data || []).filter(r => r.path.split("/").length === depth).map(r => snap(r.path, r.data));
        return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} };
      },
      onSnapshot(next, err) { return poll(() => q.get(), next, err, 20000); },
      async add(d) { const ref = docRef(path + "/" + crypto.randomUUID()); await ref.set(d); return ref; },
      where() { return q; }, orderBy() { return q; }, limit() { return q; },
    };
    return q;
  };
  const db = Object.freeze({ collection: colRef, doc: docRef });

  // ---------- usuário ----------
  const user = Object.freeze({
    id: async () => me.id, isOwner: async () => !!me.isAdmin, canEdit: async () => !!me.isAdmin, can: async () => true,
    me: async () => ({ id: me.id, name: me.username, email: null, isOwner: !!me.isAdmin, canEdit: !!me.isAdmin, avatarUrl: "", color: "#14203D" }),
    profiles: async ids => Object.fromEntries(ids.map(i => [i, { id: i, name: "" }])),
  });

  // ---------- IA ----------
  const blobToB64 = b => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(b); });
  async function shrinkImage(blob) {
    try {
      const bmp = await createImageBitmap(blob); const max = 1400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.85));
    } catch { return blob; }
  }
  async function sample(input, opts = {}) {
    let messages = typeof input === "string" ? [{ role: "user", content: input }] : input.map(m => ({ role: m.role, content: m.content }));
    if (opts.images?.length) {
      const last = messages[messages.length - 1];
      const imgs = [];
      for (const b of opts.images) { const s = await shrinkImage(b); imgs.push({ type: "image", source: { type: "base64", media_type: s.type || "image/jpeg", data: await blobToB64(s) } }); }
      last.content = [...imgs, { type: "text", text: typeof last.content === "string" ? last.content : JSON.stringify(last.content) }];
    }
    const tools = (opts.tools || []).map(t => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema || { type: "object", properties: {} } }));
    const tier = opts.modelTier || "default";
    for (let round = 0; round < 8; round++) {
      if (opts.signal?.aborted) throw { code: "cancelled" };
      const res = await api("/api/ai", { method: "POST", body: JSON.stringify({ messages, tools, tier, maxTokens: opts.maxTokens, system: opts.system }), signal: opts.signal })
        .catch(e => { if (e?.name === "AbortError") throw { code: "cancelled" }; throw e; });
      const text = (res.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      if (res.stop_reason === "tool_use" && tools.length) {
        messages.push({ role: "assistant", content: res.content });
        const results = [];
        for (const b of res.content.filter(b => b.type === "tool_use")) {
          const t = (opts.tools || []).find(x => x.name === b.name);
          try { const out = await t.execute(b.input || {}); results.push({ type: "tool_result", tool_use_id: b.id, content: typeof out === "string" ? out : JSON.stringify(out ?? "ok") }); }
          catch (e) { results.push({ type: "tool_result", tool_use_id: b.id, content: String(e?.message || e), is_error: true }); }
        }
        messages.push({ role: "user", content: results });
        if (text && opts.onText) opts.onText({ text, delta: text });
        continue;
      }
      if (opts.onText) opts.onText({ text, delta: text });
      return { text, truncated: res.stop_reason === "max_tokens" };
    }
    throw { code: "upstream_error", message: "A IA não concluiu a resposta." };
  }
  sample.json = async (input, opts = {}) => {
    const note = "\n\nResponda APENAS com JSON válido, sem texto antes ou depois.";
    const inp = typeof input === "string" ? input + note : input.map((m, i) => i === input.length - 1 ? { ...m, content: m.content + note } : m);
    const r = await sample(inp, { ...opts, maxTokens: opts.maxTokens || (opts.modelTier === "complex" ? 12000 : 4000) });
    const t = r.text.trim();
    const tryParse = s => { try { return JSON.parse(s); } catch { return undefined; } };
    let v = tryParse(t);
    if (v === undefined) { const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) v = tryParse(f[1]); }
    if (v === undefined) { const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]")); if (a >= 0 && b > a) v = tryParse(t.slice(a, b + 1)); }
    if (v === undefined || r.truncated) throw { code: "invalid_json", text: t };
    return v;
  };
  sample.limits = async () => ({ maxInputBytes: 1_400_000, images: { maxCount: 1, maxBytes: 8_000_000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } });

  // ---------- downloads ----------
  const downloads = Object.freeze({
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { saved: true };
    },
  });

  window.claude = Object.freeze({ use: async name => ({ db, user, sample, downloads })[name] ?? null });

  // ---------- Strava ----------
  async function connectStrava() {
    try { const { url } = await api("/api/strava/connect", { method: "POST" }); location.href = url; }
    catch (e) { alert(e.message || "Não consegui iniciar a conexão com o Strava."); }
  }
  async function disconnectStrava() { await api("/api/strava/disconnect", { method: "POST" }); me.strava = { connected: false }; }

  // ---------- login ----------
  const showErr = (msg) => { const el = $("#auth_err"); el.textContent = msg || ""; el.hidden = !msg; };
  function setMode(m) {
    document.querySelectorAll("[data-authmode]").forEach(b => b.setAttribute("aria-pressed", b.dataset.authmode === m));
    $("#auth_signup_extra").hidden = m !== "signup";
    $("#auth_submit").textContent = m === "signup" ? "Criar minha conta" : "Entrar";
    $("#auth_pass").autocomplete = m === "signup" ? "new-password" : "current-password";
    $("#authform").dataset.mode = m; showErr("");
  }
  async function start() {
    try { me = await api("/api/me"); }
    catch (e) {
      if (e.code === "not_member" || e.code === "not_granted") { await sb.auth.signOut(); return showAuth(e.code === "not_member" ? "Essa conta não faz parte do grupo." : ""); }
      return showAuth("Não consegui conectar ao servidor. Tente de novo.");
    }
    window.TRI = { api, me, connectStrava, disconnectStrava, logout };
    $("#auth").hidden = true; $("#app").hidden = false; $("#logout").hidden = false;
    window.__startApp?.();
  }
  function showAuth(msg) { $("#auth").hidden = false; $("#app").hidden = true; $("#logout").hidden = true; showErr(msg); $("#auth_user")?.focus(); }
  async function logout() { await sb.auth.signOut(); location.href = "/"; }

  async function init() {
    document.querySelectorAll("[data-authmode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.authmode)));
    let cfg;
    try { cfg = await fetch("/api/config").then(r => r.json()); } catch { cfg = {}; }
    if (cfg.version) {
      const built = cfg.builtAt ? new Date(cfg.builtAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
      $("#appversion").textContent = ["Versão " + cfg.version, cfg.commit, built].filter(Boolean).join(" · ");
    }
    if (!cfg.supabaseUrl || !window.supabase) { $("#auth").hidden = false; showErr("Configuração do servidor incompleta: confira as variáveis do Supabase no Vercel."); return; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    $("#logout").addEventListener("click", logout);
    $("#authform").addEventListener("submit", async e => {
      e.preventDefault();
      const mode = $("#authform").dataset.mode || "login";
      const username = $("#auth_user").value.trim().toLowerCase(), raw = $("#auth_pass").value, password = authPass(raw);
      const btn = $("#auth_submit"); btn.disabled = true; showErr("");
      try {
        if (mode === "signup") {
          if (raw.length < 4) throw { message: "A senha precisa ter pelo menos 4 caracteres." };
          if (raw !== $("#auth_pass2").value) throw { message: "As senhas não conferem." };
          await api("/api/signup", { method: "POST", body: JSON.stringify({ username, password, code: $("#auth_code").value.trim() }) });
        }
        const { error } = await sb.auth.signInWithPassword({ email: `${username}@${USER_DOMAIN}`, password });
        if (error) throw { message: "Usuário ou senha incorretos." };
        await start();
      } catch (err) { showErr(err.message || "Não foi possível entrar."); }
      btn.disabled = false;
    });
    setMode("login");
    const { data: { session: s } } = await sb.auth.getSession();
    if (s) start(); else showAuth("");
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
