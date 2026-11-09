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

  // As chaves levam o caminho da página: duas instalações da app no mesmo
  // endereço (ex: /gimnoanima/ e /animakids/) deixam de partilhar dados/token.
  const NS = "gimnoanima:" + location.pathname.replace(/[^/]*$/, "") + ":";
  const LS = {
    SESSION: NS + "session", CONFIG: NS + "config", STATE: NS + "state",
    SYNC: NS + "sync", LOADED: NS + "loaded", CLASS: NS + "class",
    SHA_CONFIG: NS + "sha-config", SHA_STATE: NS + "sha-state",
    DIRTY_CONFIG: NS + "dirty-config", DIRTY_STATE: NS + "dirty-state",
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
    return { version: 1, updatedAt: EPOCH, settings: { municipal: "06-29" }, roster: {}, contacts: {}, templates: [], events: [], classes: [] };
  }
  function defaultState() {
    return { version: 1, updatedAt: EPOCH, groups: {}, progress: {}, progressLog: [], attendance: {}, completed: {} };
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
      notes: c.notes && typeof c.notes === "object" ? c.notes : {}, // notas por treino (data -> texto)
    };
  }
  function normalizeConfig(c) {
    const base = defaultConfig();
    if (!c || typeof c !== "object") return base;
    return {
      version: 1, updatedAt: c.updatedAt || EPOCH,
      settings: Object.assign(base.settings, c.settings || {}),
      roster: c.roster && typeof c.roster === "object" ? c.roster : {},
      contacts: c.contacts && typeof c.contacts === "object" ? c.contacts : {}, // atleta -> {guardian, phone, email, notes}
      templates: Array.isArray(c.templates) ? c.templates : [],                 // modelos de treino (partilhados)
      events: Array.isArray(c.events) ? c.events : [],                          // eventos do calendário
      classes: (Array.isArray(c.classes) ? c.classes : []).filter((x) => x && x.id).map(normalizeClass),
    };
  }
  function normalizeState(s) {
    const base = defaultState();
    if (!s || typeof s !== "object") return base;
    return {
      version: 1, updatedAt: s.updatedAt || EPOCH,
      groups: s.groups || {}, progress: s.progress || {}, progressLog: Array.isArray(s.progressLog) ? s.progressLog : [],
      attendance: s.attendance || {}, completed: s.completed || {},
    };
  }
  function loadJson(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }

  let CONFIG = normalizeConfig(loadJson(LS.CONFIG));
  let STATE = normalizeState(loadJson(LS.STATE));
  GA.config = () => CONFIG;
  GA.state = () => STATE;

  const saveConfig = () => localStorage.setItem(LS.CONFIG, JSON.stringify(CONFIG));
  const saveState = () => localStorage.setItem(LS.STATE, JSON.stringify(STATE));
  // "dirty" = este dispositivo tem alterações ainda não enviadas ao GitHub
  function markDirty(doc) { doc.ver++; localStorage.setItem(doc.dirtyKey, "1"); }
  function touchConfig() { CONFIG.updatedAt = new Date().toISOString(); saveConfig(); markDirty(DOCS[0]); schedulePush(); }
  function touchState() { STATE.updatedAt = new Date().toISOString(); saveState(); markDirty(DOCS[1]); schedulePush(); }
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
    [LS.CONFIG, LS.STATE, LS.LOADED, LS.CLASS, LS.SHA_CONFIG, LS.SHA_STATE, LS.DIRTY_CONFIG, LS.DIRTY_STATE].forEach((k) => localStorage.removeItem(k));
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
  GA.sessionsOf = (cls) => {
    const noTrain = GA.noTrainingDates(cls);
    const all = GA.classSessions(cls, CONFIG.settings.municipal);
    return noTrain.size ? all.filter((d) => !noTrain.has(d)) : all;
  };
  GA.periodsOfClass = (cls) => GA.periodsOf(cls, GA.sessionsOf(cls));
  GA.nextSessionIso = (cls) => {
    const list = GA.sessionsOf(cls); const today = GA.todayIso();
    return list.find((d) => d >= today) || list[list.length - 1] || null;
  };

  // ---------------- estado (presenças, progresso, grupos) ----------------
  GA.getProgress = (aid, objId) => (STATE.progress[aid] && STATE.progress[aid][objId]) || 0;
  GA.setProgress = (aid, objId, level) => {
    level = Math.max(0, Math.min(5, level));
    const prev = GA.getProgress(aid, objId);
    (STATE.progress[aid] = STATE.progress[aid] || {})[objId] = level;
    if (level !== prev) logProgress(aid, objId, prev, level);
    touchState();
  };
  // Histórico: 1 registo por atleta+objetivo+dia (o último nível do dia).
  // Os dados importados antes desta versão não têm histórico.
  function logProgress(aid, objId, prev, level) {
    const d = GA.todayIso(); const log = STATE.progressLog;
    const i = log.findIndex((e) => e.a === aid && e.o === objId && e.d === d);
    if (i >= 0) { if (log[i].p === level) log.splice(i, 1); else log[i].l = level; }
    else log.push({ a: aid, o: objId, d, l: level, p: prev });
  }
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
    c.athletes.forEach((a) => { delete CONFIG.roster[a]; delete CONFIG.contacts[a]; });
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
    delete CONFIG.roster[id]; delete CONFIG.contacts[id]; touchConfig();
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

  // ---------------- config: notas por treino ----------------
  GA.getNote = (cls, date) => (cls.notes && cls.notes[date]) || "";
  GA.setNote = (cid, date, text) => {
    const c = GA.classById(cid); if (!c) return;
    text = String(text || "").trim();
    if (text) c.notes[date] = text; else delete c.notes[date];
    touchConfig();
  };

  // ---------------- config: modelos de treino e cópia de planos ----------------
  const PLAN_FIELDS = ["micro", "formato", "aquecimento", "jogo", "ginastica", "alongamento"];
  GA.PLAN_FIELDS = PLAN_FIELDS;
  GA.templates = () => CONFIG.templates.slice().sort((a, b) => GA.compareNames(a.name, b.name));
  GA.saveTemplate = (name, plan) => {
    const clean = {}; PLAN_FIELDS.forEach((k) => { const v = String(plan[k] || "").trim(); if (v) clean[k] = v; });
    const ex = CONFIG.templates.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (ex) { ex.plan = clean; touchConfig(); return ex; }
    const tpl = { id: "tpl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, plan: clean };
    CONFIG.templates.push(tpl); touchConfig(); return tpl;
  };
  GA.removeTemplate = (id) => { CONFIG.templates = CONFIG.templates.filter((x) => x.id !== id); touchConfig(); };
  // copia um plano para várias datas; devolve quantas foram escritas
  GA.copyPlan = (cid, plan, dates, overwrite) => {
    const c = GA.classById(cid); if (!c) return 0; let n = 0;
    dates.forEach((d) => {
      if (c.plans[d] && !overwrite) return;
      const clean = {}; PLAN_FIELDS.forEach((k) => { const v = String(plan[k] || "").trim(); if (v) clean[k] = v; });
      if (Object.keys(clean).length) { c.plans[d] = clean; n++; }
    });
    if (n) touchConfig();
    return n;
  };

  // ---------------- config: eventos do calendário ----------------
  GA.EVENT_TYPES = { sarau: ["🎭", "Sarau / Espetáculo"], competicao: ["🏆", "Competição / Torneio"], reuniao: ["👥", "Reunião"], sem_treino: ["🚫", "Sem treino"], outro: ["📌", "Outro"] };
  GA.events = () => CONFIG.events.slice().sort((a, b) => a.date.localeCompare(b.date));
  GA.eventAppliesTo = (ev, cls) => !ev.classes || !ev.classes.length || ev.classes.includes(cls.id);
  GA.eventCovers = (ev, date) => date >= ev.date && date <= (ev.endDate || ev.date);
  GA.eventsFor = (cls) => GA.events().filter((ev) => GA.eventAppliesTo(ev, cls));
  GA.eventsOn = (cls, date) => GA.eventsFor(cls).filter((ev) => GA.eventCovers(ev, date));
  GA.noTrainingDates = (cls) => {
    const out = new Set();
    CONFIG.events.forEach((ev) => {
      if (ev.type !== "sem_treino" || !GA.eventAppliesTo(ev, cls)) return;
      const d = GA.parseIso(ev.date), end = GA.parseIso(ev.endDate || ev.date);
      for (let i = 0; d <= end && i < 400; i++) { out.add(GA.isoLocal(d)); d.setDate(d.getDate() + 1); }
    });
    return out;
  };
  GA.saveEvent = (ev) => {
    const i = CONFIG.events.findIndex((x) => x.id === ev.id);
    if (i >= 0) CONFIG.events[i] = ev; else CONFIG.events.push(ev);
    touchConfig();
  };
  GA.removeEvent = (id) => { CONFIG.events = CONFIG.events.filter((x) => x.id !== id); touchConfig(); };

  // ---------------- config: contactos do encarregado de educação ----------------
  GA.getContact = (aid) => CONFIG.contacts[aid] || {};
  GA.setContact = (aid, data) => {
    const clean = {}; ["guardian", "phone", "email", "notes"].forEach((k) => { const v = String(data[k] || "").trim(); if (v) clean[k] = v; });
    if (Object.keys(clean).length) CONFIG.contacts[aid] = clean; else delete CONFIG.contacts[aid];
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
  const DOCS = [
    { key: "config", path: FILES.config, shaKey: LS.SHA_CONFIG, dirtyKey: LS.DIRTY_CONFIG, ver: 0,
      get: () => CONFIG, adopt: (r) => { CONFIG = normalizeConfig(r); saveConfig(); } },
    { key: "state", path: FILES.state, shaKey: LS.SHA_STATE, dirtyKey: LS.DIRTY_STATE, ver: 0,
      get: () => STATE, adopt: (r) => { STATE = normalizeState(r); saveState(); } },
  ];

  // Regra: o que decide NÃO é a hora dos relógios, mas se o ficheiro no GitHub
  // mudou desde a última vez que o vimos (sha) e se este dispositivo tem
  // alterações por enviar (dirty).
  //   • GitHub igual ao último visto + alterações locais  -> envia
  //   • GitHub mudou + nada por enviar aqui               -> adota o do GitHub
  //   • GitHub mudou + alterações aqui (conflito)         -> fica o mais recente
  async function syncDoc(cfg, doc, myGen) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { remote, sha } = await pull(cfg, doc.path);
      if (myGen !== gen) return "stale"; // entretanto desligámos / mudámos de repositório
      const base = localStorage.getItem(doc.shaKey);
      const local = doc.get();
      const localT = local.updatedAt || EPOCH;
      const remoteT = (remote && remote.updatedAt) || EPOCH;
      let dirty = localStorage.getItem(doc.dirtyKey) === "1";

      if (remote) {
        if (!base && !dirty && localT > remoteT) dirty = true; // cache de versões antigas, sem registo de sincronização
        if (sha === base) { if (!dirty) return "same"; }
        else if (!dirty || localT < remoteT) {
          doc.adopt(remote); localStorage.setItem(doc.shaKey, sha); localStorage.removeItem(doc.dirtyKey);
          return "pulled";
        }
      }
      // enviar: ficheiro ainda não existe, GitHub inalterado, ou conflito em que o local é mais recente
      const ver = doc.ver;
      try {
        const res = await push(cfg, doc.path, local, remote ? sha : null);
        if (myGen !== gen) return "stale";
        if (res && res.content && res.content.sha) localStorage.setItem(doc.shaKey, res.content.sha);
        else localStorage.removeItem(doc.shaKey);
        if (doc.ver === ver) localStorage.removeItem(doc.dirtyKey); // se entretanto houve nova alteração, continua por enviar
        return "pushed";
      } catch (err) {
        const conflict = /does not match|sha/i.test(err.message) || err.status === 409 || err.status === 422;
        if (!conflict || attempt === 3) throw err;
        // alguém gravou entretanto: volta a ler e decide de novo
      }
    }
  }

  let inFlight = false, queued = null, pushTimer = null;
  GA.syncNow = async function (showToast) {
    if (inFlight) { queued = showToast || queued; return; }
    const cfg = GA.loadSyncCfg();
    if (!cfg || !cfg.repo || !cfg.token) { setStatus("off"); return; }
    if (!/^[^/\s]+\/[^/\s]+$/.test(cfg.repo)) {
      setStatus("error");
      if (showToast) GA.toast("Repositório inválido: usa o formato utilizador/repositório (ex: o-teu-user/gimnoanima-dados).");
      return;
    }
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
      if (showToast) GA.toast(err instanceof TypeError
        ? "Não foi possível contactar o GitHub. Confirma o repositório (utilizador/repositório) e a ligação à internet."
        : "Falha na sincronização: " + err.message);
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
