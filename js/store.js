/* Gimnoanima — dados (config + estado), acesso por token e sincronização GitHub.
 *
 * TUDO o que é dado do clube (classes, atletas, planos, objetivos, presenças…)
 * vive apenas no repositório PRIVADO e na cache deste dispositivo. O código
 * público não contém nenhum nome nem plano.
 *
 *   gimnoanima-config.json : classes, atletas (nomes), objetivos, fases, planos
 *   gimnoanima-state.json  : grupos, progresso, presenças, treinos realizados
 */
(function () {
  "use strict";
  const GA = window.GA;

  const LS = {
    SESSION: "gimnoanima-session", CONFIG: "gimnoanima-config", STATE: "gimnoanima-state",
    SYNC: "gimnoanima-sync", LOADED: "gimnoanima-loaded", CLASS: "gimnoanima-class",
  };
  const FILES = { config: "gimnoanima-config.json", state: "gimnoanima-state.json" };
  const EPOCH = new Date(0).toISOString();
  GA.LS = LS;

  // ---------------- eventos simples ----------------
  const listeners = {};
  GA.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  GA.emit = (ev, data) => { (listeners[ev] || []).forEach((fn) => fn(data)); };

  // ---------------- modelo ----------------
  function defaultConfig() {
    return { version: 1, updatedAt: EPOCH, settings: { municipal: "06-29" }, roster: {}, classes: [] };
  }
  function defaultState() {
    return { version: 1, updatedAt: EPOCH, groups: {}, progress: {}, attendance: {}, completed: {} };
  }
  function normalizeClass(c) {
    const athletes = Array.isArray(c.athletes) ? c.athletes.slice() : [];
    const prefix = String(c.prefix || "X");
    let max = 0;
    athletes.forEach((a) => { if (String(a).startsWith(prefix)) max = Math.max(max, parseInt(String(a).replace(/^\D+/, ""), 10) || 0); });
    return {
      id: String(c.id), label: String(c.label || "Classe"), prefix,
      nextNum: Math.max(Number(c.nextNum) || 1, max + 1),
      weekdays: Array.isArray(c.weekdays) ? c.weekdays.map(Number) : [],
      start: c.start || "", end: c.end || "",
      excludeHolidays: c.excludeHolidays !== false,
      exclude: Array.isArray(c.exclude) ? c.exclude.slice() : [],
      extra: Array.isArray(c.extra) ? c.extra.slice() : [],
      athletes,
      objectives: Array.isArray(c.objectives) ? c.objectives : [],
      phases: Array.isArray(c.phases) ? c.phases : [],
      plans: c.plans && typeof c.plans === "object" ? c.plans : {},
    };
  }
  function normalizeConfig(c) {
    const base = defaultConfig();
    if (!c || typeof c !== "object") return base;
    return {
      version: 1, updatedAt: c.updatedAt || EPOCH,
      settings: Object.assign(base.settings, c.settings || {}),
      roster: c.roster && typeof c.roster === "object" ? c.roster : {},
      classes: (Array.isArray(c.classes) ? c.classes : []).filter((x) => x && x.id).map(normalizeClass),
    };
  }
  function normalizeState(s) {
    const base = defaultState();
    if (!s || typeof s !== "object") return base;
    return {
      version: 1, updatedAt: s.updatedAt || EPOCH,
      groups: s.groups || {}, progress: s.progress || {}, attendance: s.attendance || {}, completed: s.completed || {},
    };
  }
  function loadJson(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }

  let CONFIG = normalizeConfig(loadJson(LS.CONFIG));
  let STATE = normalizeState(loadJson(LS.STATE));
  GA.config = () => CONFIG;
  GA.state = () => STATE;

  const saveConfig = () => localStorage.setItem(LS.CONFIG, JSON.stringify(CONFIG));
  const saveState = () => localStorage.setItem(LS.STATE, JSON.stringify(STATE));
  function touchConfig() { CONFIG.updatedAt = new Date().toISOString(); saveConfig(); schedulePush(); }
  function touchState() { STATE.updatedAt = new Date().toISOString(); saveState(); schedulePush(); }
  GA.touchConfig = touchConfig; GA.touchState = touchState;

  // ---------------- acesso (token) ----------------
  GA.loadSyncCfg = () => loadJson(LS.SYNC);
  const saveSyncCfg = (cfg) => localStorage.setItem(LS.SYNC, JSON.stringify(cfg));
  GA.hasToken = () => { const c = GA.loadSyncCfg(); return !!(c && c.repo && c.token); };
  // Só quem ligou o token (e já carregou os dados do repositório privado)
  // consegue ver/editar classes, atletas e treinos.
  GA.isUnlocked = () => GA.hasToken() && localStorage.getItem(LS.LOADED) === "1";

  let gen = 0; // muda sempre que desligamos/trocamos de repositório: sincronizações antigas deixam de contar
  GA.wipeLocalData = function () {
    gen++;
    CONFIG = defaultConfig(); STATE = defaultState();
    [LS.CONFIG, LS.STATE, LS.LOADED, LS.CLASS].forEach((k) => localStorage.removeItem(k));
  };
  GA.disconnect = function () {
    localStorage.removeItem(LS.SYNC);
    GA.wipeLocalData();
    setStatus("off");
    GA.emit("data-changed");
  };

  // ---------------- classe selecionada ----------------
  GA.classes = () => CONFIG.classes;
  GA.classById = (id) => CONFIG.classes.find((c) => c.id === id);
  GA.currentClass = () => {
    const id = localStorage.getItem(LS.CLASS);
    return GA.classById(id) || CONFIG.classes[0] || null;
  };
  GA.setCurrentClass = (id) => localStorage.setItem(LS.CLASS, id);

  // ---------------- atletas / calendário ----------------
  GA.displayName = (id) => CONFIG.roster[id] || "Atleta " + id;
  GA.sortedAthletes = (cls) => cls.athletes.slice().sort((a, b) => GA.compareNames(GA.displayName(a), GA.displayName(b)) || a.localeCompare(b));
  GA.sessionsOf = (cls) => GA.classSessions(cls, CONFIG.settings.municipal);
  GA.periodsOfClass = (cls) => GA.periodsOf(cls, GA.sessionsOf(cls));
  GA.nextSessionIso = (cls) => {
    const list = GA.sessionsOf(cls); const today = GA.todayIso();
    return list.find((d) => d >= today) || list[list.length - 1] || null;
  };

  // ---------------- estado (presenças, progresso, grupos) ----------------
  GA.getProgress = (aid, objId) => (STATE.progress[aid] && STATE.progress[aid][objId]) || 0;
  GA.setProgress = (aid, objId, level) => {
    (STATE.progress[aid] = STATE.progress[aid] || {})[objId] = Math.max(0, Math.min(5, level));
    touchState();
  };
  GA.getGroup = (aid) => STATE.groups[aid] || null;
  GA.setGroup = (aid, g) => { STATE.groups[aid] = STATE.groups[aid] === g ? null : g; touchState(); };
  GA.getAttendance = (cid, date, aid) => (STATE.attendance[cid] && STATE.attendance[cid][date] && STATE.attendance[cid][date][aid]) || null;
  GA.setAttendance = (cid, date, aid, val) => {
    const byDate = (STATE.attendance[cid] = STATE.attendance[cid] || {});
    const entry = (byDate[date] = byDate[date] || {});
    entry[aid] = entry[aid] === val ? null : val;
    touchState();
  };
  GA.getCompleted = (cid, date) => !!(STATE.completed[cid] && STATE.completed[cid][date]);
  GA.setCompleted = (cid, date, v) => { (STATE.completed[cid] = STATE.completed[cid] || {})[date] = !!v; touchState(); };

  // ---------------- config: classes ----------------
  function pickPrefix(label) {
    const used = new Set(CONFIG.classes.map((c) => c.prefix));
    const letters = (label.toUpperCase().replace(/[^A-Z]/g, "") + "ABCDEFGHIJKLMNOPQRSTUVWXYZ").split("");
    return letters.find((l) => !used.has(l)) || "C" + (CONFIG.classes.length + 1);
  }
  GA.addClass = (data) => {
    const cls = normalizeClass({
      id: GA.slugify(data.label) + "-" + Date.now().toString(36).slice(-4), prefix: pickPrefix(data.label),
      label: data.label, weekdays: data.weekdays, start: data.start, end: data.end, excludeHolidays: data.excludeHolidays,
    });
    CONFIG.classes.push(cls); touchConfig(); return cls;
  };
  GA.updateClass = (id, patch) => { const c = GA.classById(id); if (c) { Object.assign(c, patch); touchConfig(); } };
  GA.removeClass = (id) => {
    const c = GA.classById(id); if (!c) return;
    c.athletes.forEach((a) => delete CONFIG.roster[a]);
    CONFIG.classes = CONFIG.classes.filter((x) => x.id !== id);
    touchConfig();
  };
  GA.setMunicipal = (md) => { CONFIG.settings.municipal = md; touchConfig(); };

  // ---------------- config: atletas ----------------
  GA.addAthlete = (cid, name) => {
    const c = GA.classById(cid); if (!c) return null;
    const id = c.prefix + GA.pad(c.nextNum); c.nextNum += 1; // nunca reutiliza códigos
    c.athletes.push(id); CONFIG.roster[id] = name; touchConfig(); return id;
  };
  GA.renameAthlete = (id, name) => { CONFIG.roster[id] = name; touchConfig(); };
  GA.removeAthlete = (cid, id) => {
    const c = GA.classById(cid); if (!c) return;
    c.athletes = c.athletes.filter((x) => x !== id);
    delete CONFIG.roster[id]; touchConfig();
  };

  // ---------------- config: planos de treino (por dia) ----------------
  GA.getPlan = (cls, date) => cls.plans[date] || null;
  GA.setPlan = (cid, date, plan) => {
    const c = GA.classById(cid); if (!c) return;
    const clean = {};
    Object.keys(plan).forEach((k) => { const v = String(plan[k] || "").trim(); if (v) clean[k] = v; });
    if (Object.keys(clean).length) c.plans[date] = clean; else delete c.plans[date];
    touchConfig();
  };
  GA.cancelDate = (cid, date) => {
    const c = GA.classById(cid); if (!c) return;
    if ((c.extra || []).includes(date)) c.extra = c.extra.filter((d) => d !== date);
    else if (!c.exclude.includes(date)) c.exclude.push(date);
    touchConfig();
  };
  GA.addExtraDate = (cid, date) => {
    const c = GA.classById(cid); if (!c) return;
    c.exclude = c.exclude.filter((d) => d !== date);
    if (!c.extra.includes(date)) c.extra.push(date);
    touchConfig();
  };

  // ---------------- config: objetivos e fases ----------------
  GA.saveObjective = (cid, obj) => {
    const c = GA.classById(cid); if (!c) return;
    const i = c.objectives.findIndex((o) => o.id === obj.id);
    if (i >= 0) c.objectives[i] = obj; else c.objectives.push(obj);
    touchConfig();
  };
  GA.removeObjective = (cid, objId) => {
    const c = GA.classById(cid); if (!c) return;
    c.objectives = c.objectives.filter((o) => o.id !== objId); touchConfig();
  };
  GA.setPhases = (cid, phases) => { const c = GA.classById(cid); if (c) { c.phases = phases; touchConfig(); } };

  // ---------------- importar estado da app antiga (AnimaKids) ----------------
  GA.importLegacyState = function (old) {
    const res = { attendance: 0, progress: 0, groups: 0, completed: 0, skipped: 0 };
    const has = (id) => !!GA.classById(id);
    Object.keys(old.groups || {}).forEach((k) => { if (old.groups[k]) { STATE.groups[k] = old.groups[k]; res.groups++; } });
    Object.keys(old.progress || {}).forEach((a) => {
      Object.keys(old.progress[a] || {}).forEach((o) => { (STATE.progress[a] = STATE.progress[a] || {})[o] = old.progress[a][o]; res.progress++; });
    });
    const classOf = (periodId) => (String(periodId).startsWith("mk-") ? "movekids" : "animakids");
    Object.keys(old.attendance || {}).forEach((p) => {
      const cid = classOf(p);
      if (!has(cid)) { res.skipped++; return; }
      Object.keys(old.attendance[p] || {}).forEach((date) => {
        Object.keys(old.attendance[p][date] || {}).forEach((a) => {
          const v = old.attendance[p][date][a]; if (!v) return;
          ((STATE.attendance[cid] = STATE.attendance[cid] || {})[date] = STATE.attendance[cid][date] || {})[a] = v; res.attendance++;
        });
      });
    });
    Object.keys(old.completed || {}).forEach((p) => {
      const cid = classOf(p);
      if (!has(cid)) { res.skipped++; return; }
      Object.keys(old.completed[p] || {}).forEach((date) => {
        if (old.completed[p][date]) { (STATE.completed[cid] = STATE.completed[cid] || {})[date] = true; res.completed++; }
      });
    });
    touchState();
    return res;
  };

  // =====================================================================
  //  SINCRONIZAÇÃO GITHUB (repositório privado)
  // =====================================================================
  let syncStatus = "off"; // off | syncing | synced | error
  GA.syncStatus = () => syncStatus;
  function setStatus(s) { syncStatus = s; GA.emit("sync-status", s); }
  GA.setSyncStatus = setStatus;

  async function ghFail(res, fallback) {
    let msg = fallback;
    try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (e) { /* ignore */ }
    if (res.status === 401) msg = "Token inválido ou expirado.";
    else if (res.status === 403) msg = "Sem permissão (confirma que o token tem “Contents: Read and write”).";
    else if (res.status === 404) msg = "Repositório não encontrado, ou o token não tem acesso a ele.";
    return new Error(msg);
  }
  const utf8ToB64 = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64ToUtf8 = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));

  async function pull(cfg, path) {
    const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch || "main")}`;
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${cfg.token}` }, cache: "no-store" });
    if (res.status === 404) return { remote: null, sha: null };
    if (!res.ok) throw await ghFail(res, "GET falhou: " + res.status);
    const json = await res.json();
    return { remote: JSON.parse(b64ToUtf8(json.content)), sha: json.sha };
  }
  async function push(cfg, path, data, sha) {
    const payload = {
      message: "Gimnoanima: atualizar " + path + " (" + new Date().toISOString() + ")",
      content: utf8ToB64(JSON.stringify(data, null, 2)), branch: cfg.branch || "main",
    };
    if (sha) payload.sha = sha;
    const res = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
      method: "PUT", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await ghFail(res, "PUT falhou: " + res.status);
      err.status = res.status; throw err;
    }
    return res.json();
  }
  // conflito de versão (outro dispositivo gravou entretanto): relê o sha e repete
  async function pushRetry(cfg, path, dataFn, sha, attempt) {
    attempt = attempt || 1;
    try { return await push(cfg, path, dataFn(), sha); }
    catch (err) {
      if (!(/does not match|sha/i.test(err.message) || err.status === 409 || err.status === 422) || attempt > 3) throw err;
      const fresh = await pull(cfg, path);
      return pushRetry(cfg, path, dataFn, fresh.sha, attempt + 1);
    }
  }

  const DOCS = [
    { path: FILES.config, get: () => CONFIG, adopt: (r) => { CONFIG = normalizeConfig(r); saveConfig(); } },
    { path: FILES.state, get: () => STATE, adopt: (r) => { STATE = normalizeState(r); saveState(); } },
  ];
  // ganha sempre a versão mais recente (updatedAt)
  async function syncDoc(cfg, doc, myGen) {
    const { remote, sha } = await pull(cfg, doc.path);
    if (myGen !== gen) return "stale"; // entretanto desligámos / mudámos de repositório
    const localT = doc.get().updatedAt || EPOCH;
    const remoteT = (remote && remote.updatedAt) || EPOCH;
    if (remote && remoteT > localT) { doc.adopt(remote); return "pulled"; }
    if (!remote || localT > remoteT) { await pushRetry(cfg, doc.path, () => doc.get(), sha); return "pushed"; }
    return "same";
  }

  let inFlight = false, queued = null, pushTimer = null;
  GA.syncNow = async function (showToast) {
    if (inFlight) { queued = showToast || queued; return; }
    const cfg = GA.loadSyncCfg();
    if (!cfg || !cfg.repo || !cfg.token) { setStatus("off"); return; }
    inFlight = true; setStatus("syncing");
    const myGen = gen;
    try {
      for (const doc of DOCS) { if ((await syncDoc(cfg, doc, myGen)) === "stale") return; }
      if (myGen !== gen) return;
      localStorage.setItem(LS.LOADED, "1");
      setStatus("synced");
      GA.emit("data-changed");
      if (showToast) GA.toast("Sincronizado com o GitHub.");
    } catch (err) {
      console.error("[Gimnoanima sync]", err);
      setStatus("error");
      GA.emit("data-changed");
      if (showToast) GA.toast("Falha na sincronização: " + err.message);
    } finally {
      inFlight = false;
      if (queued !== null) { const t = queued; queued = null; GA.syncNow(t); }
    }
  };
  function schedulePush() {
    if (!GA.hasToken()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => GA.syncNow(false), 1500);
  }

  // ligar um repositório/token. Se mudar de repositório, a cache local é
  // apagada para nunca misturar dados de repositórios diferentes.
  GA.connect = async function (repo, branch, token) {
    const prev = GA.loadSyncCfg();
    if (!prev || prev.repo !== repo) GA.wipeLocalData();
    else gen++; // mesmo repositório, token novo: descarta sincronizações em curso com o token antigo
    saveSyncCfg({ repo, branch: branch || "main", token });
    await GA.syncNow(true);
  };

  GA.normalize = { config: normalizeConfig, state: normalizeState }; // testes
})();
