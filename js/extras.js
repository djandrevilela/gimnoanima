/* Gimnoanima — eventos do calendário e cópia de planos (editores) */
(function () {
  "use strict";
  const GA = window.GA; const esc = GA.escapeHtml;
  const U = () => GA.ui; // ajudantes da interface (definidos em ui.js)
  const $ = (id) => document.getElementById(id);
  GA.extras = {};

  // ------------------------------------------------------------------ eventos
  const typeIcon = (t) => (GA.EVENT_TYPES[t] || GA.EVENT_TYPES.outro)[0];
  const typeName = (t) => (GA.EVENT_TYPES[t] || GA.EVENT_TYPES.outro)[1];
  const rangeLabel = (ev) => (ev.endDate && ev.endDate !== ev.date ? `${GA.fmtDateShort(ev.date)} - ${GA.fmtDateShort(ev.endDate)}` : GA.fmtDateLong(ev.date));
  const classesLabel = (ev) => (!ev.classes || !ev.classes.length ? "Todas as classes"
    : ev.classes.map((id) => { const c = GA.classById(id); return c ? c.label : null; }).filter(Boolean).join(", ") || "Todas as classes");
  GA.extras.typeIcon = typeIcon; GA.extras.typeName = typeName; GA.extras.rangeLabel = rangeLabel; GA.extras.classesLabel = classesLabel;

  GA.extras.openEventEditor = function (ev, defaults) {
    const e = ev || { id: "ev-" + Date.now().toString(36), title: "", type: "sarau", date: GA.todayIso(), endDate: "", classes: [], note: "" };
    Object.assign(e, ev ? {} : (defaults || {}));
    const all = GA.classes(); const chosen = new Set(!e.classes || !e.classes.length ? all.map((c) => c.id) : e.classes);
    U().openEditor({
      title: ev ? "Editar evento" : "Novo evento",
      html: `
        <div class="mb-2"><label class="form-label small">Título</label><input class="form-control" id="evTitle" value="${esc(e.title)}" placeholder="ex: Sarau de final de ano"></div>
        <div class="mb-2"><label class="form-label small">Tipo</label><select class="form-select" id="evType">
          ${Object.keys(GA.EVENT_TYPES).map((k) => `<option value="${k}" ${k === e.type ? "selected" : ""}>${GA.EVENT_TYPES[k][0]} ${GA.EVENT_TYPES[k][1]}</option>`).join("")}</select>
          <div class="small text-muted mt-1">“Sem treino” remove esses dias do calendário (Plano e Presenças).</div></div>
        <div class="row g-2 mb-2"><div class="col-6"><label class="form-label small">Data</label><input type="date" class="form-control" id="evDate" value="${esc(e.date)}"></div>
          <div class="col-6"><label class="form-label small">Até (opcional)</label><input type="date" class="form-control" id="evEnd" value="${esc(e.endDate || "")}"></div></div>
        <div class="mb-2"><div class="form-label small">Classes</div><div class="wd-row">
          ${all.map((c) => `<label class="wd-chip"><input type="checkbox" class="ev-cls" value="${esc(c.id)}" ${chosen.has(c.id) ? "checked" : ""}> ${esc(c.label)}</label>`).join("")}</div></div>
        <div class="mb-1"><label class="form-label small">Notas</label><textarea class="form-control" id="evNote" rows="2">${esc(e.note || "")}</textarea></div>`,
      onSave: (body) => {
        const title = $("evTitle").value.trim(), date = $("evDate").value, end = $("evEnd").value;
        if (!title) { U().toast("Dá um título ao evento."); return false; }
        if (!date) { U().toast("Escolhe a data."); return false; }
        if (end && end < date) { U().toast("A data final não pode ser anterior à inicial."); return false; }
        const sel = Array.from(body.querySelectorAll(".ev-cls:checked")).map((i) => i.value);
        if (!sel.length) { U().toast("Escolhe pelo menos uma classe."); return false; }
        GA.saveEvent({ id: e.id, title, type: $("evType").value, date, endDate: end && end !== date ? end : "", classes: sel.length === all.length ? [] : sel, note: $("evNote").value.trim() });
        U().renderCurrentView(); GA.extras.renderEventList(); U().toast("Evento guardado.");
      },
      deleteLabel: "Apagar evento", confirmText: "Apagar este evento?",
      onDelete: ev ? () => { GA.removeEvent(e.id); U().renderCurrentView(); GA.extras.renderEventList(); U().toast("Evento apagado."); } : null,
    });
  };

  // lista de eventos (em Mais)
  GA.extras.renderEventList = function () {
    const host = $("settingsEventList"); if (!host) return;
    const list = GA.events();
    host.innerHTML = list.map((ev) => `<div class="class-row" data-ev="${esc(ev.id)}"><div><strong>${typeIcon(ev.type)} ${esc(ev.title)}</strong>
      <div class="sub">${esc(rangeLabel(ev))} · ${esc(classesLabel(ev))}</div></div>
      <button type="button" class="icon-btn ev-edit" title="Editar"><i class="bi bi-pencil"></i></button></div>`).join("") || `<div class="small text-muted mb-2">Ainda não há eventos.</div>`;
    host.querySelectorAll(".class-row").forEach((r) => r.querySelector(".ev-edit").addEventListener("click", () => {
      const ev = GA.events().find((x) => x.id === r.dataset.ev); if (ev) GA.extras.openEventEditor(ev);
    }));
  };

  // cartão de evento no Plano (dias sem sessão)
  GA.extras.eventCardHtml = function (ev) {
    const noTrain = ev.type === "sem_treino";
    return `<div class="session-card event-card ${noTrain ? "event-notrain" : ""}" data-ev="${esc(ev.id)}" style="border-left-color:${noTrain ? "#9AA5B4" : "var(--laranja)"}">
      <div class="sc-top"><div class="sc-date">${typeIcon(ev.type)} ${esc(ev.title)}</div><div class="sc-badges"><span class="badge-micro">${esc(typeName(ev.type))}</span></div></div>
      <div class="sc-plan"><div class="row-line">📅 ${esc(rangeLabel(ev))}</div>${ev.note ? `<div class="row-line">${esc(ev.note)}</div>` : ""}</div>
      <div class="sc-actions"><span class="small text-muted">${esc(classesLabel(ev))}</span><button type="button" class="sc-edit-btn ev-card-edit"><i class="bi bi-pencil"></i> Editar</button></div></div>`;
  };

  // ------------------------------------------------------------------ copiar plano para outras datas
  GA.extras.openCopyDialog = function (cls, fromDate, plan) {
    const sessions = GA.sessionsOf(cls).filter((d) => d > fromDate);
    if (!sessions.length) { U().toast("Não há mais dias de treino depois deste."); return; }
    const wd = GA.parseIso(fromDate).getDay(); let lastMonth = "";
    const rows = sessions.map((d) => {
      const dt = GA.parseIso(d); const m = d.slice(0, 7); let head = "";
      if (m !== lastMonth) { lastMonth = m; head = `<div class="copy-month">${esc(GA.MONTHS_PT[dt.getMonth()])} ${dt.getFullYear()}</div>`; }
      return `${head}<label class="copy-row"><input type="checkbox" class="cp-date" value="${d}" data-wd="${dt.getDay()}"> <span>${esc(GA.WD_SHORT[dt.getDay()])} ${dt.getDate()} ${esc(GA.MONTHS_PT[dt.getMonth()].slice(0, 3))}</span>${GA.getPlan(cls, d) ? '<span class="copy-has">já tem plano</span>' : ""}</label>`;
    }).join("");
    U().openEditor({
      title: "Copiar plano para…",
      html: `<div class="small text-muted mb-2">Copia o plano de ${esc(GA.fmtDateLong(fromDate))} para os dias que escolheres.</div>
        <div class="d-flex flex-wrap gap-2 mb-2">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="cpSame">Mesmo dia da semana</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="cpAll">Todos os seguintes</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="cpNone">Limpar</button></div>
        <div class="copy-list">${rows}</div>
        <label class="small d-block mt-2"><input type="checkbox" id="cpOver"> Substituir planos já existentes</label>`,
      saveLabel: "Copiar",
      onOpen: (body) => {
        const boxes = () => Array.from(body.querySelectorAll(".cp-date"));
        $("cpSame").addEventListener("click", () => boxes().forEach((b) => { b.checked = +b.dataset.wd === wd; }));
        $("cpAll").addEventListener("click", () => boxes().forEach((b) => { b.checked = true; }));
        $("cpNone").addEventListener("click", () => boxes().forEach((b) => { b.checked = false; }));
      },
      onSave: (body) => {
        const dates = Array.from(body.querySelectorAll(".cp-date:checked")).map((b) => b.value);
        if (!dates.length) { U().toast("Escolhe pelo menos um dia."); return false; }
        const over = $("cpOver").checked; const n = GA.copyPlan(cls.id, plan, dates, over);
        U().renderCurrentView();
        U().toast(n === dates.length ? `Plano copiado para ${n} dia(s).` : `Plano copiado para ${n} dia(s); ${dates.length - n} já tinham plano e ficaram como estavam.`);
      },
    });
  };
})();
