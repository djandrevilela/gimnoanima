/* Gimnoanima — interface: ecrãs, editores, definições */
(function () {
  "use strict";
  const GA = window.GA;
  const $ = (id) => document.getElementById(id);
  const esc = GA.escapeHtml;
  const PASSWORD = "gmna27"; // só um "cadeado" simbólico; a proteção real é o token

  // ---------------------------------------------------------------- utils
  function simpleHash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i); return String(h >>> 0); }
  const PASSWORD_HASH = simpleHash(PASSWORD);

  GA.toast = function (msg) {
    const el = document.createElement("div");
    el.className = "toast-msg"; el.textContent = msg;
    $("toastHost").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2600);
  };
  const toast = GA.toast;
  const emptyState = (msg, ico) => `<div class="empty-state"><div class="ico">${ico || "🤸"}</div><p>${esc(msg)}</p></div>`;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function withScrollPreserved(fn) {
    const mainEl = $("appMain"); const y = window.scrollY; const my = mainEl ? mainEl.scrollTop : 0;
    fn();
    window.scrollTo(0, y); if (mainEl) mainEl.scrollTop = my;
    requestAnimationFrame(() => { window.scrollTo(0, y); if (mainEl) mainEl.scrollTop = my; });
  }

  async function saveOrShareFile(blob, filename, mimeType) {
    try {
      const file = new File([blob], filename, { type: mimeType });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return true; }
    } catch (err) { if (err && err.name === "AbortError") return false; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  // ---------------------------------------------------------------- editor genérico
  let editCb = null;
  function openEditor(opts) {
    editCb = opts;
    $("editTitle").textContent = opts.title;
    $("editBody").innerHTML = opts.html;
    $("editSaveBtn").textContent = opts.saveLabel || "Guardar";
    const del = $("editDeleteBtn");
    del.hidden = !opts.onDelete;
    del.innerHTML = '<i class="bi bi-trash"></i> ' + esc(opts.deleteLabel || "Apagar");
    $("editModal").hidden = false;
    if (opts.onOpen) opts.onOpen($("editBody"));
  }
  function closeEditor() { $("editModal").hidden = true; editCb = null; }
  $("editClose").addEventListener("click", closeEditor);
  $("editCancelBtn").addEventListener("click", closeEditor);
  $("editModal").addEventListener("click", (e) => { if (e.target === $("editModal")) closeEditor(); });
  $("editSaveBtn").addEventListener("click", () => {
    if (!editCb) return;
    const r = editCb.onSave($("editBody"));
    if (r !== false) closeEditor();
  });
  $("editDeleteBtn").addEventListener("click", () => {
    if (!editCb || !editCb.onDelete) return;
    if (editCb.confirmText && !window.confirm(editCb.confirmText)) return;
    const cb = editCb; closeEditor(); cb.onDelete();
  });

  // ---------------------------------------------------------------- login / sessão
  $("loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (simpleHash($("loginPassword").value) === PASSWORD_HASH) {
      localStorage.setItem(GA.LS.SESSION, "1"); $("loginError").hidden = true; $("loginForm").reset(); showApp();
    } else $("loginError").hidden = false;
  });
  $("logoutBtn").addEventListener("click", () => { localStorage.removeItem(GA.LS.SESSION); location.reload(); });
  function showApp() { $("loginScreen").hidden = true; $("appShell").hidden = false; boot(); }

  // ---------------------------------------------------------------- navegação / bloqueio
  const views = ["plano", "objetivos", "progresso", "atletas", "presencas"];
  let currentView = "plano";
  document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  function switchView(v) {
    currentView = v;
    document.querySelectorAll(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $("appMain").scrollTo(0, 0); window.scrollTo(0, 0);
    renderCurrentView();
  }

  function renderGate(state) {
    const gate = $("gateBox");
    if (state === "locked") {
      const st = GA.syncStatus();
      if (GA.hasToken() && st === "syncing") {
        gate.innerHTML = `<div class="gate-ico">⏳</div><h3>A carregar…</h3><p>A obter os dados do repositório privado.</p>`;
      } else if (GA.hasToken() && st === "error") {
        gate.innerHTML = `<div class="gate-ico">⚠️</div><h3>Não foi possível carregar</h3><p>Verifica o repositório e o token em <strong>Mais</strong>.</p>
          <button type="button" class="btn btn-primary" id="gateRetry"><i class="bi bi-arrow-repeat"></i> Tentar novamente</button>`;
        $("gateRetry").addEventListener("click", () => GA.syncNow(true));
      } else {
        gate.innerHTML = `<div class="gate-ico">🔒</div><h3>Conteúdo protegido</h3>
          <p>Os treinos, atletas e presenças só ficam visíveis depois de ligares o <strong>token</strong> do repositório privado de dados.</p>
          <button type="button" class="btn btn-primary" id="gateOpen"><i class="bi bi-key"></i> Ligar com token</button>`;
        $("gateOpen").addEventListener("click", openSettings);
      }
    } else {
      gate.innerHTML = `<div class="gate-ico">🤸</div><h3>Ainda não há classes</h3>
        <p>Cria a primeira classe e escolhe os dias em que treina por semana.</p>
        <button type="button" class="btn btn-primary" id="gateNewClass"><i class="bi bi-plus-lg"></i> Nova classe</button>`;
      $("gateNewClass").addEventListener("click", () => openClassEditor(null));
    }
  }

  function renderClassBar() {
    const bar = $("classBar"); const cur = GA.currentClass();
    bar.innerHTML = GA.classes().map((c) => `<button type="button" class="class-chip ${cur && c.id === cur.id ? "active" : ""}" data-class="${esc(c.id)}">${esc(c.label)}</button>`).join("");
    bar.querySelectorAll(".class-chip").forEach((b) => b.addEventListener("click", () => {
      if (cur && b.dataset.class === cur.id) return;
      GA.setCurrentClass(b.dataset.class); renderCurrentView();
    }));
  }

  function renderCurrentView() {
    const state = !GA.isUnlocked() ? "locked" : !GA.classes().length ? "empty" : "ok";
    views.forEach((v) => $("view-" + v).classList.toggle("d-none", state !== "ok" || v !== currentView));
    $("gateBox").hidden = state === "ok";
    $("classBar").hidden = state !== "ok";
    if (state !== "ok") { renderGate(state); return; }
    renderClassBar();
    ({ plano: renderPlano, objetivos: renderObjetivos, progresso: renderProgresso, atletas: renderAtletas, presencas: renderPresencas })[currentView]();
  }

  // ================================================================ PLANO
  const planoSel = {}; // classId -> periodId
  let planoMode = "pendentes";
  let phaseExpanded = false;
  document.querySelectorAll(".btn[data-planomode]").forEach((btn) => btn.addEventListener("click", () => {
    planoMode = btn.dataset.planomode;
    document.querySelectorAll(".btn[data-planomode]").forEach((b) => b.classList.toggle("active", b === btn));
    renderPlano();
  }));

  function periodFor(cls, selMap, periods) {
    let id = selMap[cls.id];
    if (!periods.some((p) => p.id === id)) {
      const next = GA.nextSessionIso(cls);
      const p = periods.find((x) => x.sessions.includes(next)) || periods[periods.length - 1];
      id = p ? p.id : null; selMap[cls.id] = id;
    }
    return periods.find((p) => p.id === id) || null;
  }

  const MICRO_COLORS = ["#6D9EEB", "#5BB174", "#F2B84B", "#C27BA0", "#1FA3A3", "#F28C28"];
  function microColor(micro) {
    if (!micro) return "#E1E6EE";
    let h = 0; for (let i = 0; i < micro.length; i++) h = (h * 31 + micro.charCodeAt(i)) >>> 0;
    return MICRO_COLORS[h % MICRO_COLORS.length];
  }

  function planHtml(plan) {
    const rows = plan ? [["🔥", "Aquecimento", plan.aquecimento], ["🎲", "Jogo / Outro", plan.jogo], ["🤸", "Ginástica", plan.ginastica], ["🧘", "Alongamentos", plan.alongamento]].filter((r) => r[2]) : [];
    if (!rows.length) return `<div class="sc-empty">Plano por definir</div>`;
    return rows.map((r) => `<div class="row-line">${r[0]} <span class="lbl">${r[1]}</span><br>${esc(r[2])}</div>`).join("");
  }

  function currentPhase(cls) {
    const ph = (cls.phases || []).filter((p) => p.title).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    if (!ph.length) return null;
    const t = GA.todayIso();
    return ph.find((p) => p.start && p.end && t >= p.start && t <= p.end)
      || (ph[0].start && t < ph[0].start ? ph[0] : null)
      || (ph[ph.length - 1].end && t > ph[ph.length - 1].end ? ph[ph.length - 1] : null)
      || ph.find((p) => p.start && p.start > t) || ph[0];
  }
  const phRange = (p) => (p.start && p.end ? `${GA.fmtDateShort(p.start)} — ${GA.fmtDateShort(p.end)}` : "");

  function renderPhaseBanner(cls) {
    const host = $("phaseBanner"); const ph = currentPhase(cls);
    if (!ph) {
      host.innerHTML = `<div class="pb-title"><i class="bi bi-signpost-split"></i> Fases da época</div><div class="pb-desc">Ainda sem fases definidas.</div>
        <div class="pb-actions"><button type="button" class="pb-link" id="phaseEditBtn">Definir fases</button></div>`;
    } else {
      const desc = ph.description || "";
      const all = (cls.phases || []).filter((p) => p.title).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
      host.innerHTML = `
        <div class="pb-title"><i class="bi bi-signpost-split"></i> Estamos na ${esc(ph.title)}</div>
        ${phRange(ph) ? `<div class="pb-range">${phRange(ph)}</div>` : ""}
        <div class="pb-desc">${esc(phaseExpanded || desc.length <= 110 ? desc : desc.slice(0, 110) + "…")}</div>
        <div class="pb-actions">
          <button type="button" class="pb-link" id="phaseToggleBtn">${phaseExpanded ? "Ver menos" : "Ver todas as fases"}</button>
          <button type="button" class="pb-link" id="phaseEditBtn">Editar fases</button>
        </div>
        ${phaseExpanded ? `<div class="mt-2 d-flex flex-column gap-2">${all.map((p) => `
          <div style="padding:8px 10px;border-radius:10px;background:${p === ph ? "rgba(31,163,163,0.18)" : "rgba(255,255,255,0.7)"};">
            <div style="font-weight:700;font-size:0.76rem;">${esc(p.title)} <span style="font-weight:600;color:var(--gm-muted);">${phRange(p) ? "(" + phRange(p) + ")" : ""}</span></div>
            <div style="font-size:0.72rem;color:var(--gm-muted);margin-top:2px;">${esc(p.description || "")}</div></div>`).join("")}</div>` : ""}`;
      const tg = $("phaseToggleBtn"); if (tg) tg.addEventListener("click", () => { phaseExpanded = !phaseExpanded; renderPhaseBanner(cls); });
    }
    $("phaseEditBtn").addEventListener("click", () => openPhasesEditor(cls));
  }

  function renderPlano() {
    const cls = GA.currentClass();
    renderPhaseBanner(cls);
    const periods = GA.periodsOfClass(cls);
    const tabs = $("planoPeriodTabs"); const host = $("planoSessionList");
    if (!periods.length) {
      tabs.innerHTML = "";
      host.innerHTML = emptyState("Esta classe ainda não tem dias de treino. Define os dias da semana e as datas em Mais → Classes e dias de treino.", "📅");
      return;
    }
    const period = periodFor(cls, planoSel, periods);
    tabs.innerHTML = periods.map((p) => `<button type="button" class="btn btn-outline-secondary ${p.id === period.id ? "active" : ""}" data-period="${p.id}">${esc(p.label)}</button>`).join("");
    tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { planoSel[cls.id] = b.dataset.period; renderPlano(); }));

    const sessions = period.sessions.filter((d) => (planoMode === "historico" ? GA.getCompleted(cls.id, d) : !GA.getCompleted(cls.id, d)));
    host.innerHTML = sessions.map((d) => {
      const plan = GA.getPlan(cls, d); const done = GA.getCompleted(cls.id, d);
      const badges = [];
      if (plan && plan.micro) badges.push(`<span class="badge-micro">${esc(plan.micro)}</span>`);
      if (plan && plan.formato) badges.push(`<span class="badge-formato">${esc(plan.formato)}</span>`);
      return `<div class="session-card ${done ? "is-done" : ""}" data-date="${d}" style="border-left-color:${microColor(plan && plan.micro)}">
        <div class="sc-top"><div class="sc-date">${esc(GA.fmtDateLong(d))}</div><div class="sc-badges">${badges.join("")}</div></div>
        <div class="sc-plan">${planHtml(plan)}</div>
        <div class="sc-actions">
          <button type="button" class="sc-edit-btn"><i class="bi bi-pencil"></i> Editar plano</button>
          <button type="button" class="sc-done-btn ${done ? "done" : ""}"><i class="bi ${done ? "bi-check-circle-fill" : "bi-circle"}"></i> ${done ? "Treino realizado" : "Marcar como realizado"}</button>
        </div></div>`;
    }).join("") || emptyState(planoMode === "historico" ? "Ainda não há treinos no histórico." : "Todos os treinos deste período já foram marcados como realizados.");

    host.querySelectorAll(".session-card").forEach((card) => {
      const d = card.dataset.date;
      card.querySelector(".sc-edit-btn").addEventListener("click", () => openPlanEditor(cls, d));
      card.querySelector(".sc-done-btn").addEventListener("click", () => { GA.setCompleted(cls.id, d, !GA.getCompleted(cls.id, d)); renderPlano(); });
    });
  }

  function openPlanEditor(cls, date) {
    const p = GA.getPlan(cls, date) || {};
    const isExtra = (cls.extra || []).includes(date);
    openEditor({
      title: cap(GA.fmtDateLong(date)),
      html: `
        <div class="row g-2 mb-2">
          <div class="col-7"><label class="form-label small">Foco do treino</label><input class="form-control" id="pfMicro" value="${esc(p.micro || "")}" placeholder="ex: Trampolins, Solo…"></div>
          <div class="col-5"><label class="form-label small">Formato</label><input class="form-control" id="pfFormato" list="pfFormatos" value="${esc(p.formato || "")}" placeholder="Estações…">
            <datalist id="pfFormatos"><option value="Estações"><option value="Filas"><option value="Circuito Geral"></datalist></div>
        </div>
        <div class="mb-2"><label class="form-label small">🔥 Aquecimento</label><input class="form-control" id="pfAquec" value="${esc(p.aquecimento || "")}"></div>
        <div class="mb-2"><label class="form-label small">🎲 Jogo / Outro</label><input class="form-control" id="pfJogo" value="${esc(p.jogo || "")}"></div>
        <div class="mb-2"><label class="form-label small">🤸 Ginástica</label><textarea class="form-control" id="pfGin" rows="5">${esc(p.ginastica || "")}</textarea></div>
        <div class="mb-1"><label class="form-label small">🧘 Alongamentos</label><input class="form-control" id="pfAlong" value="${esc(p.alongamento || "")}"></div>`,
      onSave: () => {
        GA.setPlan(cls.id, date, {
          micro: $("pfMicro").value, formato: $("pfFormato").value, aquecimento: $("pfAquec").value,
          jogo: $("pfJogo").value, ginastica: $("pfGin").value, alongamento: $("pfAlong").value,
        });
        renderCurrentView(); toast("Plano guardado.");
      },
      deleteLabel: isExtra ? "Remover este dia extra" : "Cancelar este treino (remover do calendário)",
      confirmText: isExtra ? "Remover este dia extra?" : "Remover este dia do calendário? (feriado, treino cancelado…)\nO plano e as presenças desse dia ficam guardados mas escondidos.",
      onDelete: () => { GA.cancelDate(cls.id, date); renderCurrentView(); toast("Dia removido do calendário."); },
    });
  }

  $("planoExtraBtn").addEventListener("click", () => {
    const cls = GA.currentClass(); if (!cls) return;
    openEditor({
      title: "Adicionar dia extra",
      html: `<label class="form-label small">Data do treino extra</label><input type="date" class="form-control" id="exDate" value="${GA.todayIso()}">`,
      saveLabel: "Adicionar",
      onSave: () => {
        const d = $("exDate").value; if (!d) { toast("Escolhe uma data."); return false; }
        GA.addExtraDate(cls.id, d); planoSel[cls.id] = null; renderCurrentView(); toast("Dia extra adicionado.");
      },
    });
  });

  function phaseRowHtml(p) {
    p = p || {};
    return `<div class="phase-edit-row">
      <div class="d-flex gap-2 mb-2"><input class="form-control form-control-sm ph-title" placeholder="Título (ex: Fase 1 - Adaptação)" value="${esc(p.title || "")}">
        <button type="button" class="icon-btn danger ph-del" title="Remover"><i class="bi bi-trash"></i></button></div>
      <div class="row g-2 mb-2"><div class="col-6"><input type="date" class="form-control form-control-sm ph-start" value="${esc(p.start || "")}"></div>
        <div class="col-6"><input type="date" class="form-control form-control-sm ph-end" value="${esc(p.end || "")}"></div></div>
      <textarea class="form-control form-control-sm ph-desc" rows="2" placeholder="Descrição / objetivos da fase">${esc(p.description || "")}</textarea></div>`;
  }
  function openPhasesEditor(cls) {
    const phases = (cls.phases || []).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    openEditor({
      title: "Fases da época — " + cls.label,
      html: `<div id="phRows">${phases.map(phaseRowHtml).join("")}</div><button type="button" class="btn btn-outline-primary btn-sm w-100" id="phAdd"><i class="bi bi-plus-lg"></i> Adicionar fase</button>`,
      onOpen: (body) => {
        $("phAdd").addEventListener("click", () => $("phRows").insertAdjacentHTML("beforeend", phaseRowHtml()));
        body.addEventListener("click", (e) => { const d = e.target.closest(".ph-del"); if (d) d.closest(".phase-edit-row").remove(); });
      },
      onSave: (body) => {
        const out = [];
        body.querySelectorAll(".phase-edit-row").forEach((r, i) => {
          const title = r.querySelector(".ph-title").value.trim(); if (!title) return;
          out.push({ id: "ph" + i + "-" + Date.now().toString(36), title, start: r.querySelector(".ph-start").value, end: r.querySelector(".ph-end").value, description: r.querySelector(".ph-desc").value.trim() });
        });
        GA.setPhases(cls.id, out); renderCurrentView(); toast("Fases guardadas.");
      },
    });
  }

  // ================================================================ OBJETIVOS
  function renderObjetivos() {
    const cls = GA.currentClass();
    $("objetivosList").innerHTML = cls.objectives.map((o) => `
      <div class="objective-card" data-obj="${esc(o.id)}">
        <button type="button" class="obj-edit" title="Editar"><i class="bi bi-pencil"></i></button>
        ${o.categoria ? `<span class="objective-cat-badge">${esc(o.categoria)}</span>` : ""}
        <h3>${esc(o.nome)}</h3>
        <ul class="level-list">${o.niveis.map((l, i) => `<li><span class="lvl-num">${i + 1}</span><span>${esc(l)}</span></li>`).join("")}</ul>
      </div>`).join("") || emptyState("Ainda não há objetivos nesta classe. Toca em “Novo objetivo” para criar o primeiro.", "🚩");
    $("objetivosList").querySelectorAll(".objective-card").forEach((c) => c.querySelector(".obj-edit").addEventListener("click", () => openObjectiveEditor(cls, cls.objectives.find((o) => o.id === c.dataset.obj))));
  }
  $("objNewBtn").addEventListener("click", () => openObjectiveEditor(GA.currentClass(), null));

  function openObjectiveEditor(cls, obj) {
    const o = obj || { id: "obj-" + Date.now().toString(36), categoria: "", nome: "", niveis: ["", "", "", "", ""] };
    const cats = [...new Set(cls.objectives.map((x) => x.categoria).filter(Boolean))];
    openEditor({
      title: obj ? "Editar objetivo" : "Novo objetivo",
      html: `
        <div class="mb-2"><label class="form-label small">Categoria</label><input class="form-control" id="obCat" list="obCats" value="${esc(o.categoria)}" placeholder="ex: Solo, Trampolim…">
          <datalist id="obCats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
        <div class="mb-2"><label class="form-label small">Objetivo</label><input class="form-control" id="obNome" value="${esc(o.nome)}" placeholder="ex: Mortal à Frente"></div>
        <div class="form-label small">5 níveis de progresso (1 = primeira fase · 5 = objetivo alcançado)</div>
        ${[0, 1, 2, 3, 4].map((i) => `<div class="input-group input-group-sm mb-1"><span class="input-group-text">${i + 1}</span><input class="form-control ob-lvl" value="${esc(o.niveis[i] || "")}" placeholder="${i === 4 ? "Objetivo alcançado" : "Nível " + (i + 1)}"></div>`).join("")}`,
      onSave: (body) => {
        const nome = $("obNome").value.trim(); if (!nome) { toast("Dá um nome ao objetivo."); return false; }
        const niveis = Array.from(body.querySelectorAll(".ob-lvl")).map((i, idx) => i.value.trim() || (idx === 4 ? "Objetivo alcançado" : "Nível " + (idx + 1)));
        GA.saveObjective(cls.id, { id: o.id, categoria: $("obCat").value.trim(), nome, niveis });
        renderCurrentView(); toast("Objetivo guardado.");
      },
      deleteLabel: "Apagar objetivo",
      confirmText: "Apagar este objetivo? O progresso já registado deixa de aparecer.",
      onDelete: obj ? () => { GA.removeObjective(cls.id, o.id); renderCurrentView(); toast("Objetivo apagado."); } : null,
    });
  }

  // ================================================================ PROGRESSO
  let progMode = "atleta";
  const progAtleta = {}, progObj = {};
  document.querySelectorAll(".progresso-mode-tabs .btn").forEach((btn) => btn.addEventListener("click", () => {
    progMode = btn.dataset.progmode;
    document.querySelectorAll(".progresso-mode-tabs .btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderProgresso();
  }));

  function progCardHtml(aid, obj, mode) {
    const level = GA.getProgress(aid, obj.id);
    const desc = level > 0 ? obj.niveis[level - 1] : "Ainda não iniciado";
    let segs = "";
    for (let i = 1; i <= 5; i++) segs += `<div class="prog-seg ${i <= level ? "filled" : ""} ${i <= level && level === 5 ? "done" : ""}"></div>`;
    return `<div class="prog-card" data-athlete="${esc(aid)}" data-obj="${esc(obj.id)}">
      <div class="prog-title">${esc(mode === "objetivo" ? GA.displayName(aid) : obj.nome)}</div>
      <div class="prog-sub">${esc(obj.categoria || "")}</div>
      <div class="prog-bar-row"><button type="button" class="prog-btn btn-minus" ${level <= 0 ? "disabled" : ""}>–</button>
        <div class="prog-bar">${segs}</div><button type="button" class="prog-btn btn-plus" ${level >= 5 ? "disabled" : ""}>+</button></div>
      <div class="prog-level-label">Nível ${level}/5</div><div class="prog-level-desc">${esc(desc)}</div></div>`;
  }

  function renderProgresso() {
    const cls = GA.currentClass(); const athletes = GA.sortedAthletes(cls); const objs = cls.objectives;
    const ap = $("progressoAtletaPicker"), op = $("progressoObjetivoPicker"), content = $("progressoContent");
    ap.classList.toggle("d-none", progMode !== "atleta"); op.classList.toggle("d-none", progMode !== "objetivo");
    if (!athletes.length) { ap.innerHTML = op.innerHTML = ""; content.innerHTML = emptyState("Ainda não há atletas nesta classe. Adiciona-os no ecrã Atletas.", "👥"); return; }
    if (!objs.length) { ap.innerHTML = op.innerHTML = ""; content.innerHTML = emptyState("Ainda não há objetivos nesta classe. Cria-os no ecrã Objetivos.", "🚩"); return; }
    if (!athletes.includes(progAtleta[cls.id])) progAtleta[cls.id] = athletes[0];
    if (!objs.some((o) => o.id === progObj[cls.id])) progObj[cls.id] = objs[0].id;

    if (progMode === "atleta") {
      ap.innerHTML = athletes.map((a) => `<button type="button" class="picker-chip ${a === progAtleta[cls.id] ? "active" : ""}" data-athlete="${esc(a)}">${esc(GA.displayName(a))}</button>`).join("");
      ap.querySelectorAll(".picker-chip").forEach((c) => c.addEventListener("click", () => { progAtleta[cls.id] = c.dataset.athlete; renderProgresso(); }));
      content.innerHTML = objs.map((o) => progCardHtml(progAtleta[cls.id], o, "atleta")).join("");
    } else {
      op.innerHTML = objs.map((o) => `<button type="button" class="picker-chip ${o.id === progObj[cls.id] ? "active" : ""}" data-obj="${esc(o.id)}">${esc(o.nome)}</button>`).join("");
      op.querySelectorAll(".picker-chip").forEach((c) => c.addEventListener("click", () => { progObj[cls.id] = c.dataset.obj; renderProgresso(); }));
      const obj = objs.find((o) => o.id === progObj[cls.id]);
      content.innerHTML = athletes.map((a) => progCardHtml(a, obj, "objetivo")).join("");
    }
    content.querySelectorAll(".prog-card").forEach((card) => {
      const a = card.dataset.athlete, o = card.dataset.obj;
      card.querySelector(".btn-plus").addEventListener("click", () => withScrollPreserved(() => { GA.setProgress(a, o, GA.getProgress(a, o) + 1); renderProgresso(); }));
      card.querySelector(".btn-minus").addEventListener("click", () => withScrollPreserved(() => { GA.setProgress(a, o, GA.getProgress(a, o) - 1); renderProgresso(); }));
    });
  }

  // ================================================================ ATLETAS (gestão aqui)
  function renderAtletas() {
    const cls = GA.currentClass(); const athletes = GA.sortedAthletes(cls);
    $("atletasCount").textContent = athletes.length + (athletes.length === 1 ? " atleta" : " atletas");
    $("atletasList").innerHTML = athletes.map((a) => {
      const g = GA.getGroup(a);
      return `<div class="athlete-row" data-athlete="${esc(a)}"><span class="athlete-name">${esc(GA.displayName(a))}</span>
        <div class="athlete-controls"><div class="group-btns">${[1, 2, 3].map((n) => `<button type="button" class="group-btn g${n} ${g === n ? "active" : ""}" data-g="${n}">${n}</button>`).join("")}</div>
          <button type="button" class="icon-btn ath-edit" title="Editar nome"><i class="bi bi-pencil"></i></button>
          <button type="button" class="icon-btn danger ath-del" title="Remover"><i class="bi bi-trash"></i></button></div></div>`;
    }).join("") || emptyState("Ainda não há atletas nesta classe. Escreve um nome acima e toca em Adicionar.", "👥");
    $("atletasList").querySelectorAll(".athlete-row").forEach((row) => {
      const a = row.dataset.athlete;
      row.querySelectorAll(".group-btn").forEach((b) => b.addEventListener("click", () => withScrollPreserved(() => { GA.setGroup(a, parseInt(b.dataset.g, 10)); renderAtletas(); })));
      row.querySelector(".ath-edit").addEventListener("click", () => openAthleteEditor(cls, a));
      row.querySelector(".ath-del").addEventListener("click", () => {
        if (!window.confirm(`Remover ${GA.displayName(a)} de ${cls.label}?\n\nO nome é apagado; o histórico (anónimo) de presenças e progresso fica guardado.`)) return;
        GA.removeAthlete(cls.id, a); renderAtletas(); toast("Atleta removido.");
      });
    });
  }
  function addAthleteFromInput() {
    const cls = GA.currentClass(); const name = $("atletaNewName").value.trim();
    if (!cls) return; if (!name) { toast("Escreve o nome do atleta."); return; }
    GA.addAthlete(cls.id, name); $("atletaNewName").value = ""; renderAtletas(); toast("Atleta adicionado.");
  }
  $("atletaAddBtn").addEventListener("click", addAthleteFromInput);
  $("atletaNewName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addAthleteFromInput(); } });
  function openAthleteEditor(cls, aid) {
    openEditor({
      title: "Editar atleta",
      html: `<label class="form-label small">Nome</label><input class="form-control" id="atNome" value="${esc(GA.displayName(aid))}">`,
      onSave: () => {
        const n = $("atNome").value.trim(); if (!n) { toast("O nome não pode ficar vazio."); return false; }
        GA.renameAthlete(aid, n); renderAtletas(); toast("Nome guardado.");
      },
    });
  }

  // ================================================================ PRESENÇAS
  let presMode = "marcar";
  const presSel = {}; // classId -> { periodId, dateIso }

  function ensureSel(cls, periods) {
    let sel = presSel[cls.id];
    const ok = sel && periods.some((p) => p.id === sel.periodId && p.sessions.includes(sel.dateIso));
    if (!ok) {
      const next = GA.nextSessionIso(cls);
      const p = periods.find((x) => x.sessions.includes(next)) || periods[periods.length - 1];
      sel = p ? { periodId: p.id, dateIso: next && p.sessions.includes(next) ? next : p.sessions[0] } : null;
      presSel[cls.id] = sel;
    }
    return sel;
  }
  function attendanceGap(cls, aid) {
    const today = GA.todayIso(); const flat = GA.sessionsOf(cls).filter((d) => d <= today); let streak = 0;
    for (let i = flat.length - 1; i >= 0; i--) {
      const v = GA.getAttendance(cls.id, flat[i], aid); if (!v) continue; if (v === "Presente") break; streak++;
    }
    return streak;
  }
  const warnHtml = (cls, aid) => { const s = attendanceGap(cls, aid); return s > 4 ? `<div class="att-warn"><i class="bi bi-exclamation-triangle-fill"></i> não vem há ${s} treinos</div>` : ""; };

  function renderPresencas() {
    const cls = GA.currentClass(); const periods = GA.periodsOfClass(cls);
    const modeHost = $("presencasModeTabs");
    modeHost.innerHTML = `<button type="button" class="btn btn-outline-secondary ${presMode === "marcar" ? "active" : ""}" data-mode="marcar">Marcar presenças</button>
      <button type="button" class="btn btn-outline-secondary ${presMode === "totais" ? "active" : ""}" data-mode="totais">Total</button>`;
    modeHost.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.mode === presMode) return; withScrollPreserved(() => { presMode = b.dataset.mode; renderPresencas(); }); }));
    $("presencasMarcarSection").classList.toggle("d-none", presMode !== "marcar");
    $("presencasTotaisSection").classList.toggle("d-none", presMode !== "totais");
    if (presMode === "totais") { renderTotais(cls); return; }

    const sel = ensureSel(cls, periods);
    if (!sel) {
      $("presencasPeriodTabs").innerHTML = ""; $("presencasDatePicker").innerHTML = ""; $("presencasTreinoBadge").hidden = true; $("presencasSummary").innerHTML = "";
      $("presencasList").innerHTML = emptyState("Esta classe ainda não tem dias de treino. Define-os em Mais → Classes e dias de treino.", "📅"); return;
    }
    const period = periods.find((p) => p.id === sel.periodId);
    const tabs = $("presencasPeriodTabs");
    tabs.innerHTML = periods.map((p) => `<button type="button" class="btn btn-outline-secondary ${p.id === sel.periodId ? "active" : ""}" data-period="${p.id}">${esc(p.label)}</button>`).join("");
    tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => withScrollPreserved(() => {
      const np = periods.find((p) => p.id === b.dataset.period); const today = GA.todayIso();
      sel.periodId = np.id; sel.dateIso = np.sessions.find((d) => d >= today) || np.sessions[np.sessions.length - 1]; renderPresencas();
    })));

    const dp = $("presencasDatePicker");
    dp.innerHTML = period.sessions.map((d) => `<button type="button" class="picker-chip ${d === sel.dateIso ? "active" : ""}" data-date="${d}">${GA.getCompleted(cls.id, d) ? "✅ " : ""}${GA.fmtDateShort(d)}</button>`).join("");
    dp.querySelectorAll(".picker-chip").forEach((c) => c.addEventListener("click", () => withScrollPreserved(() => { sel.dateIso = c.dataset.date; renderPresencas(); })));
    const active = dp.querySelector(".picker-chip.active"); if (active && active.scrollIntoView) active.scrollIntoView({ inline: "center", block: "nearest" });

    const done = GA.getCompleted(cls.id, sel.dateIso); const badge = $("presencasTreinoBadge");
    badge.hidden = false; badge.className = "treino-badge " + (done ? "done" : "pending");
    badge.innerHTML = done ? `<i class="bi bi-check-circle-fill"></i> Este treino já foi marcado como realizado no Plano.`
      : `<i class="bi bi-clock-history"></i> Este treino ainda não foi marcado como realizado. Podes marcá-lo na vista Plano.`;

    const athletes = GA.sortedAthletes(cls); const list = $("presencasList");
    list.innerHTML = athletes.map((a) => {
      const v = GA.getAttendance(cls.id, sel.dateIso, a);
      return `<div class="attendance-row" data-athlete="${esc(a)}"><div class="att-name-col"><span class="att-name">${esc(GA.displayName(a))}</span>${warnHtml(cls, a)}</div>
        <div class="att-btns"><button type="button" class="att-btn p ${v === "Presente" ? "active" : ""}" data-val="Presente">P</button>
          <button type="button" class="att-btn j ${v === "Justificou" ? "active" : ""}" data-val="Justificou">J</button>
          <button type="button" class="att-btn f ${v === "Faltou" ? "active" : ""}" data-val="Faltou">F</button></div></div>`;
    }).join("") || emptyState("Ainda não há atletas nesta classe. Adiciona-os no ecrã Atletas.", "👥");
    list.querySelectorAll(".attendance-row").forEach((row) => row.querySelectorAll(".att-btn").forEach((btn) => btn.addEventListener("click", () => withScrollPreserved(() => {
      GA.setAttendance(cls.id, sel.dateIso, row.dataset.athlete, btn.dataset.val); renderPresencas();
    }))));
    let p = 0, j = 0, f = 0;
    athletes.forEach((a) => { const v = GA.getAttendance(cls.id, sel.dateIso, a); if (v === "Presente") p++; else if (v === "Justificou") j++; else if (v === "Faltou") f++; });
    $("presencasSummary").innerHTML = `<span class="chip">✅ ${p} presentes</span><span class="chip">📋 ${j} justificaram</span><span class="chip">❌ ${f} faltaram</span>`;
  }

  function renderTotais(cls) {
    const sessions = GA.sessionsOf(cls);
    $("presencasTotaisList").innerHTML = GA.sortedAthletes(cls).map((a) => {
      let p = 0, j = 0, f = 0;
      sessions.forEach((d) => { const v = GA.getAttendance(cls.id, d, a); if (v === "Presente") p++; else if (v === "Justificou") j++; else if (v === "Faltou") f++; });
      return `<div class="attendance-row"><div class="att-name-col"><span class="att-name">${esc(GA.displayName(a))}</span>${warnHtml(cls, a)}</div>
        <div class="totals-counts"><span>✅ ${p}</span><span>📋 ${j}</span><span>❌ ${f}</span></div></div>`;
    }).join("") || emptyState("Sem atletas nesta classe.", "👥");
  }

  // ================================================================ MAIS (definições)
  const settingsModal = $("settingsModal");
  function openSettings() {
    const cfg = GA.loadSyncCfg();
    if (cfg) { $("syncRepo").value = cfg.repo || ""; $("syncBranch").value = cfg.branch || "main"; }
    $("syncDisconnectBtn").hidden = !GA.hasToken();
    renderSettings(); settingsModal.hidden = false;
  }
  function closeSettings() { settingsModal.hidden = true; }
  $("settingsModalClose").addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(); });
  $("navSettingsBtn").addEventListener("click", openSettings);

  function renderSyncBlock() {
    const cfg = GA.loadSyncCfg(); const st = GA.syncStatus();
    $("syncStatusBlock").innerHTML = !cfg || !cfg.repo
      ? `<i class="bi bi-cloud-slash"></i> Ainda não ligado — sem token não é possível ver classes, atletas nem treinos.`
      : `<i class="bi bi-github"></i> Repositório <strong>${esc(cfg.repo)}</strong> (ramo ${esc(cfg.branch || "main")}) — ${({ off: "Não ligado", syncing: "A sincronizar…", synced: "Sincronizado", error: "Erro na última sincronização" })[st]}`;
  }
  function renderSettings() {
    renderSyncBlock();
    const unlocked = GA.isUnlocked();
    $("settingsDataSection").hidden = !unlocked;
    if (!unlocked) return;
    $("municipalInput").value = GA.config().settings.municipal || "";
    $("settingsClassList").innerHTML = GA.classes().map((c) => `
      <div class="class-row" data-class="${esc(c.id)}"><div><strong>${esc(c.label)}</strong>
        <div class="sub">${c.weekdays.length ? GA.WD_ORDER.filter((d) => c.weekdays.includes(d)).map((d) => GA.WD_SHORT[d]).join(", ") : "sem dias definidos"} · ${GA.sessionsOf(c).length} treinos · ${c.athletes.length} atletas</div></div>
        <button type="button" class="icon-btn cls-edit" title="Editar"><i class="bi bi-pencil"></i></button></div>`).join("") || `<div class="small text-muted mb-2">Ainda não há classes.</div>`;
    $("settingsClassList").querySelectorAll(".class-row").forEach((r) => r.querySelector(".cls-edit").addEventListener("click", () => openClassEditor(GA.classById(r.dataset.class))));
  }
  GA.on("sync-status", (s) => {
    const btn = $("syncStatusBtn"); btn.classList.remove("synced", "syncing", "error");
    const map = { off: ["bi-cloud-slash", "Local", "Toca para ligar o token"], syncing: ["bi-arrow-repeat", "A sincronizar…", "A sincronizar…"],
      synced: ["bi-cloud-check", "Sincronizado", "Toca para sincronizar agora"], error: ["bi-exclamation-triangle", "Erro", "Falhou — toca para tentar novamente"] }[s];
    if (s !== "off") btn.classList.add(s);
    $("syncStatusIcon").className = "bi " + map[0]; $("syncStatusText").textContent = map[1]; btn.title = map[2];
    if (!settingsModal.hidden) renderSyncBlock();
  });
  GA.on("data-changed", () => { renderCurrentView(); if (!settingsModal.hidden) renderSettings(); });

  $("syncStatusBtn").addEventListener("click", () => { if (GA.hasToken()) GA.syncNow(true); else openSettings(); });
  $("syncNowBtn").addEventListener("click", () => { if (GA.hasToken()) GA.syncNow(true); else toast("Primeiro liga o repositório e o token."); });
  $("syncForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const repo = $("syncRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
    const branch = $("syncBranch").value.trim() || "main"; const token = $("syncToken").value.trim();
    if (!repo || !token) { toast("Preenche o repositório e o token."); return; }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("O repositório tem de ter o formato utilizador/repositório, ex: o-teu-user/gimnoanima-dados."); return; }
    $("syncToken").value = "";
    await GA.connect(repo, branch, token);
    $("syncDisconnectBtn").hidden = !GA.hasToken(); renderSettings();
  });
  $("syncDisconnectBtn").addEventListener("click", () => {
    if (!window.confirm("Desligar e apagar os dados deste dispositivo?\n\nOs dados continuam no repositório privado, mas só voltas a vê-los ligando o token outra vez.")) return;
    GA.disconnect(); $("syncDisconnectBtn").hidden = true; renderSettings(); toast("Desligado. Dados apagados deste dispositivo.");
  });

  // --- classes: criar / editar / apagar
  $("classNewBtn").addEventListener("click", () => openClassEditor(null));
  function openClassEditor(cls) {
    const c = cls || { label: "", weekdays: [], start: GA.todayIso(), end: GA.defaultSeasonEnd(), excludeHolidays: true };
    openEditor({
      title: cls ? "Editar classe" : "Nova classe",
      html: `
        <div class="mb-2"><label class="form-label small">Nome da classe</label><input class="form-control" id="ceName" value="${esc(c.label)}" placeholder="ex: AnimaKids"></div>
        <div class="mb-2"><div class="form-label small">Dias de treino por semana</div>
          <div class="wd-row">${GA.WD_ORDER.map((d) => `<label class="wd-chip"><input type="checkbox" class="ce-wd" value="${d}" ${c.weekdays.includes(d) ? "checked" : ""}> ${GA.WD_SHORT[d]}</label>`).join("")}</div></div>
        <div class="row g-2 mb-2"><div class="col-6"><label class="form-label small">Início da época</label><input type="date" class="form-control" id="ceStart" value="${esc(c.start)}"></div>
          <div class="col-6"><label class="form-label small">Fim da época</label><input type="date" class="form-control" id="ceEnd" value="${esc(c.end)}"></div></div>
        <label class="small d-block mb-2"><input type="checkbox" id="ceHol" ${c.excludeHolidays !== false ? "checked" : ""}> Não treinar em feriados nacionais nem no feriado municipal</label>
        <div class="small text-muted">${cls ? "Se mudares os dias ou as datas, os planos e presenças dos dias que deixarem de existir ficam guardados, mas escondidos." : "Depois de criares a classe, adiciona os atletas no ecrã Atletas e escreve o plano de cada dia no ecrã Plano."}</div>`,
      saveLabel: cls ? "Guardar" : "Criar classe",
      onSave: (body) => {
        const label = $("ceName").value.trim(); const weekdays = Array.from(body.querySelectorAll(".ce-wd:checked")).map((i) => parseInt(i.value, 10));
        const start = $("ceStart").value, end = $("ceEnd").value, excl = $("ceHol").checked;
        if (!label) { toast("Dá um nome à classe."); return false; }
        if (GA.classes().some((x) => x.label.toLowerCase() === label.toLowerCase() && (!cls || x.id !== cls.id))) { toast("Já existe uma classe com esse nome."); return false; }
        if (!weekdays.length) { toast("Escolhe pelo menos um dia de treino."); return false; }
        if (!start || !end || start > end) { toast("Confirma as datas de início e fim."); return false; }
        if (cls) GA.updateClass(cls.id, { label, weekdays, start, end, excludeHolidays: excl });
        else { const n = GA.addClass({ label, weekdays, start, end, excludeHolidays: excl }); GA.setCurrentClass(n.id); }
        renderSettings(); renderCurrentView(); toast(cls ? "Classe guardada." : "Classe criada.");
      },
      deleteLabel: "Apagar classe",
      confirmText: cls ? `Apagar a classe ${cls.label} e os seus ${cls.athletes.length} atletas?\n\nOs nomes e planos são apagados; o histórico anónimo de presenças fica guardado.` : "",
      onDelete: cls ? () => { GA.removeClass(cls.id); if (!GA.classes().length) localStorage.removeItem(GA.LS.CLASS); renderSettings(); renderCurrentView(); toast("Classe apagada."); } : null,
    });
  }

  $("municipalSaveBtn").addEventListener("click", () => {
    const v = $("municipalInput").value.trim();
    if (v && !/^\d\d-\d\d$/.test(v)) { toast("Usa o formato dia-mês, ex: 29-06."); return; }
    GA.setMunicipal(v); renderCurrentView(); toast("Feriado municipal guardado.");
  });

  // --- exportar / importar
  $("exportBtn").addEventListener("click", async () => {
    const blob = new Blob([JSON.stringify({ config: GA.config(), state: GA.state() }, null, 2)], { type: "application/json" });
    await saveOrShareFile(blob, "gimnoanima-copia-seguranca.json", "application/json");
  });
  $("importLegacyBtn").addEventListener("click", () => $("importLegacyFile").click());
  $("importLegacyFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const old = JSON.parse(await f.text());
      if (!old || (!old.attendance && !old.progress && !old.groups)) throw new Error("formato");
      const r = GA.importLegacyState(old);
      renderCurrentView();
      toast(`Importado: ${r.attendance} presenças, ${r.progress} níveis, ${r.groups} grupos.` + (r.skipped ? " (Algumas classes não existem: AnimaKids/MoveKids.)" : ""));
    } catch (err) { toast("Ficheiro inválido. Escolhe o animakids-state.json da app antiga."); }
  });

  const MESES_ABR = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  async function exportPresencasExcel() {
    if (typeof XLSX === "undefined") { toast("Biblioteca de Excel não carregou. Verifica a ligação à internet."); return; }
    const wb = XLSX.utils.book_new(); const used = new Set();
    GA.classes().forEach((cls) => {
      let prefix = cls.label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "CL";
      for (let n = 2; used.has(prefix); n++) prefix = prefix.slice(0, 1) + n;
      used.add(prefix);
      const months = {};
      GA.sessionsOf(cls).forEach((iso) => { const d = GA.parseIso(iso); const k = d.getFullYear() + "-" + GA.pad(d.getMonth() + 1); (months[k] = months[k] || { y: d.getFullYear(), m: d.getMonth(), dates: new Set() }).dates.add(iso); });
      Object.keys(months).sort().forEach((k) => {
        const info = months[k]; const dim = new Date(info.y, info.m + 1, 0).getDate();
        const aoa = [[cls.label + " — Presenças"], ["Mês:", GA.MONTHS_PT[info.m], "", "Ano:", info.y], []];
        const header = ["Nº", "Nome", "Presente", "Justificou", "Faltou"]; const wd = ["", "", "", "", ""];
        for (let d = 1; d <= dim; d++) { header.push(d); wd.push(GA.WD_SHORT[new Date(info.y, info.m, d).getDay()]); }
        aoa.push(header, wd);
        const athletes = GA.sortedAthletes(cls);
        athletes.forEach((a, idx) => {
          const row = [idx + 1, GA.displayName(a), null, null, null];
          for (let d = 1; d <= dim; d++) {
            const iso = `${info.y}-${GA.pad(info.m + 1)}-${GA.pad(d)}`;
            const v = info.dates.has(iso) ? GA.getAttendance(cls.id, iso, a) : null;
            row.push(v === "Presente" ? "P" : v === "Justificou" ? "J" : v === "Faltou" ? "F" : "");
          }
          aoa.push(row);
        });
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const c0 = XLSX.utils.encode_col(5), c1 = XLSX.utils.encode_col(4 + dim);
        athletes.forEach((a, idx) => {
          const r = 5 + idx, ref = `${c0}${r + 1}:${c1}${r + 1}`;
          ws[XLSX.utils.encode_cell({ r, c: 2 })] = { t: "n", f: `COUNTIF(${ref},"P")` };
          ws[XLSX.utils.encode_cell({ r, c: 3 })] = { t: "n", f: `COUNTIF(${ref},"J")` };
          ws[XLSX.utils.encode_cell({ r, c: 4 })] = { t: "n", f: `COUNTIF(${ref},"F")` };
        });
        ws["!cols"] = [{ wch: 4 }, { wch: 30 }, { wch: 9 }, { wch: 10 }, { wch: 8 }].concat(Array(dim).fill({ wch: 4 }));
        XLSX.utils.book_append_sheet(wb, ws, (prefix + "-" + MESES_ABR[info.m] + String(info.y).slice(2)).slice(0, 31));
      });
    });
    if (!wb.SheetNames.length) { toast("Ainda não há treinos para exportar."); return; }
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (await saveOrShareFile(blob, "Presencas_Gimnoanima.xlsx", blob.type)) toast("Excel de presenças exportado.");
  }
  $("exportExcelBtn").addEventListener("click", exportPresencasExcel);

  // ================================================================ INSTALAR COMO APP
  let installEvt = null; // Android/Chrome/Edge: o browser entrega o diálogo de instalação
  const isStandalone = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function updateInstallUi() {
    const show = !isStandalone(); // já instalada: esconde
    document.querySelectorAll(".js-install").forEach((b) => { b.hidden = !show; });
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; updateInstallUi(); });
  window.addEventListener("appinstalled", () => { installEvt = null; updateInstallUi(); toast("App instalada."); });
  document.querySelectorAll(".js-install").forEach((b) => b.addEventListener("click", async () => {
    if (installEvt) {
      installEvt.prompt();
      try { await installEvt.userChoice; } catch (e) { /* ignore */ }
      installEvt = null; updateInstallUi(); return;
    }
    const steps = isIOS()
      ? `<ol class="small ps-3 mb-0"><li class="mb-2">Abre esta página no <strong>Safari</strong> (não no Chrome nem dentro de outra app).</li>
          <li class="mb-2">Toca no ícone <strong>Partilhar</strong> (quadrado com uma seta para cima) na barra do Safari.</li>
          <li class="mb-2">Desce e escolhe <strong>“Adicionar ao ecrã principal”</strong>.</li>
          <li>Toca em <strong>Adicionar</strong>. O ícone da Gimnoanima fica no ecrã principal.</li></ol>`
      : `<ol class="small ps-3 mb-0"><li class="mb-2">Abre esta página no <strong>Chrome</strong> (não dentro do WhatsApp, Instagram ou outra app — usa “Abrir no browser”).</li>
          <li class="mb-2">Toca no menu <strong>⋮</strong> (canto superior direito).</li>
          <li class="mb-2">Escolhe <strong>“Instalar app”</strong> ou <strong>“Adicionar ao ecrã principal”</strong>.</li>
          <li>Confirma. O ícone da Gimnoanima fica no ecrã principal.</li></ol>`;
    openEditor({ title: "Instalar a Gimnoanima", html: steps, saveLabel: "Percebi", onSave: () => {} });
  }));

  // ================================================================ BOOT
  function boot() {
    GA.setSyncStatus(GA.hasToken() ? "syncing" : "off");
    if (GA.hasToken()) GA.syncNow(false);
    switchView("plano");
  }
  updateInstallUi();
  if (localStorage.getItem(GA.LS.SESSION) === "1") showApp(); else $("loginScreen").hidden = false;
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(() => {}));
})();
