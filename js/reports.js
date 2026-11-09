/* Gimnoanima — gráficos de evolução, relatório PDF e Excel de progresso */
(function () {
  "use strict";
  const GA = window.GA;
  const esc = GA.escapeHtml;
  const DAY = 86400000;
  const tms = (iso) => GA.parseIso(iso).getTime();

  // ------------------------------------------------------------------ presenças de um atleta
  GA.athleteAttendance = function (cls, aid) {
    const today = GA.todayIso(); let p = 0, j = 0, f = 0;
    GA.sessionsOf(cls).filter((d) => d <= today).forEach((d) => {
      const v = GA.getAttendance(cls.id, d, aid);
      if (v === "Presente") p++; else if (v === "Justificou") j++; else if (v === "Faltou") f++;
    });
    const tot = p + j + f;
    return { p, j, f, total: tot, rate: tot ? p / tot : null };
  };

  // ------------------------------------------------------------------ evolução do progresso
  // Nível de (atleta, objetivo) no fim de cada dia, a partir do histórico.
  // Sem histórico (ex.: dados importados) o nível atual fica constante.
  function levelIndex() {
    const idx = {};
    GA.state().progressLog.forEach((e) => { (idx[e.a + "|" + e.o] = idx[e.a + "|" + e.o] || []).push(e); });
    Object.keys(idx).forEach((k) => idx[k].sort((x, y) => x.d.localeCompare(y.d)));
    return idx;
  }
  function levelAt(idx, a, o, date) {
    const logs = idx[a + "|" + o];
    if (!logs || !logs.length) return GA.getProgress(a, o);
    let lvl = logs[0].p;
    for (const e of logs) { if (e.d <= date) lvl = e.l; else break; }
    return lvl;
  }
  const PALETTE = ["#0a4fa8", "#f58220", "#5BB174", "#C27BA0", "#1FA3A3", "#8A6D00", "#6C5DAC", "#C0392B", "#2E86AB", "#7D8C3A", "#B5651D", "#4A6572", "#D81B60", "#00897B"];
  GA.PALETTE = PALETTE;

  // mode "atleta": uma linha por objetivo + média do atleta
  // mode "objetivo": uma linha por atleta (ténue) + média da classe
  GA.evolutionData = function (cls, mode, id) {
    const idx = levelIndex(); const today = GA.todayIso();
    const athletes = mode === "atleta" ? [id] : GA.sortedAthletes(cls);
    const objs = mode === "atleta" ? cls.objectives : cls.objectives.filter((o) => o.id === id);
    const relevant = new Set(); let hasHistory = false;
    athletes.forEach((a) => objs.forEach((o) => { const l = idx[a + "|" + o.id]; if (l && l.length) { hasHistory = true; l.forEach((e) => relevant.add(e.d)); } }));
    let start = cls.start || today; relevant.forEach((d) => { if (d < start) start = d; });
    let end = today > start ? today : start;
    const dates = [...new Set([start, end, ...relevant])].filter((d) => d >= start && d <= end).sort();
    const mk = (fn) => dates.map((d) => ({ t: tms(d), d, v: fn(d) }));
    const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
    const lines = mode === "atleta"
      ? objs.map((o, i) => ({ key: o.id, label: o.nome, color: PALETTE[i % PALETTE.length], values: mk((d) => levelAt(idx, id, o.id, d)) }))
      : athletes.map((a) => ({ key: a, label: GA.displayName(a), color: "#8A97A8", values: mk((d) => levelAt(idx, a, id, d)) }));
    const avg = mk((d) => mean(mode === "atleta" ? objs.map((o) => levelAt(idx, id, o.id, d)) : athletes.map((a) => levelAt(idx, a, id, d))));
    return { start, end, lines, avg, hasHistory, mode };
  };

  // SVG responsivo; hidden = chaves de linhas escondidas na legenda
  GA.chartSvg = function (data, hidden) {
    const W = 360, H = 210, L = 26, R = 10, T = 10, B = 26;
    const t0 = tms(data.start), t1 = Math.max(tms(data.end), t0 + DAY);
    const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const Y = (v) => T + (1 - v / 5) * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="evo-svg" role="img" aria-label="Gráfico de evolução do progresso">`;
    for (let v = 0; v <= 5; v++) s += `<line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="#E1E6EE" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 3}" font-size="9" fill="#6B7A8D" text-anchor="end">${v}</text>`;
    // meses no eixo x
    const months = []; const d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0);
    if (d.getTime() < t0) d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= t1) { months.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
    const every = months.length > 8 ? 2 : 1;
    months.forEach((m, i) => {
      const x = X(m.getTime());
      s += `<line x1="${x}" y1="${T}" x2="${x}" y2="${H - B}" stroke="#F0F2F6" stroke-width="1"/>`;
      if (i % every === 0) s += `<text x="${x}" y="${H - 9}" font-size="9" fill="#6B7A8D" text-anchor="middle">${GA.monthAbbr(m.getMonth())}</text>`;
    });
    const step = (vals) => vals.map((p, i) => (i === 0 ? `M${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}` : `H${X(p.t).toFixed(1)} V${Y(p.v).toFixed(1)}`)).join(" ");
    data.lines.forEach((ln) => {
      if (hidden && hidden.has(ln.key)) return;
      const faint = data.mode === "objetivo";
      s += `<path d="${step(ln.values)}" fill="none" stroke="${ln.color}" stroke-width="${faint ? 1 : 1.6}" stroke-opacity="${faint ? 0.35 : 0.85}" stroke-linejoin="round"/>`;
    });
    s += `<path d="${step(data.avg)}" fill="none" stroke="#f58220" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = data.avg[data.avg.length - 1];
    s += `<circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="3.6" fill="#f58220"/>`;
    return s + "</svg>";
  };

  // ------------------------------------------------------------------ Excel: progresso da classe
  GA.exportProgressExcel = async function (cls) {
    if (typeof XLSX === "undefined") { GA.toast("Biblioteca de Excel não carregou. Verifica a ligação à internet."); return false; }
    const objs = cls.objectives; const athletes = GA.sortedAthletes(cls);
    if (!objs.length || !athletes.length) { GA.toast("É preciso ter atletas e objetivos para exportar o progresso."); return false; }
    const header = ["Atleta", "Grupo"].concat(objs.map((o) => (o.categoria ? o.categoria + " - " : "") + o.nome), ["Nível médio", "Objetivos concluídos", "Presenças", "Justificadas", "Faltas", "Taxa de presença"]);
    const aoa = [header];
    athletes.forEach((a) => {
      const att = GA.athleteAttendance(cls, a);
      aoa.push([GA.displayName(a), GA.getGroup(a) || ""].concat(objs.map((o) => GA.getProgress(a, o.id)), [null, null, att.p, att.j, att.f, null]));
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const c0 = XLSX.utils.encode_col(2), c1 = XLSX.utils.encode_col(1 + objs.length);
    const mC = 2 + objs.length; // coluna "Nível médio"
    athletes.forEach((a, i) => {
      const r = i + 1, ref = `${c0}${r + 1}:${c1}${r + 1}`;
      const P = XLSX.utils.encode_col(mC + 2) + (r + 1), J = XLSX.utils.encode_col(mC + 3) + (r + 1), F = XLSX.utils.encode_col(mC + 4) + (r + 1);
      ws[XLSX.utils.encode_cell({ r, c: mC })] = { t: "n", f: `ROUND(AVERAGE(${ref}),2)` };
      ws[XLSX.utils.encode_cell({ r, c: mC + 1 })] = { t: "n", f: `COUNTIF(${ref},5)` };
      ws[XLSX.utils.encode_cell({ r, c: mC + 5 })] = { t: "n", f: `IF((${P}+${J}+${F})=0,"",${P}/(${P}+${J}+${F}))`, z: "0%" };
    });
    ws["!cols"] = [{ wch: 34 }, { wch: 7 }].concat(objs.map(() => ({ wch: 16 })), [{ wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 12 }]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Progresso");
    const leg = [["Objetivo", "Categoria", "Nível 1", "Nível 2", "Nível 3", "Nível 4", "Nível 5"]];
    objs.forEach((o) => leg.push([o.nome, o.categoria || ""].concat(o.niveis)));
    const wl = XLSX.utils.aoa_to_sheet(leg); wl["!cols"] = [{ wch: 36 }, { wch: 16 }, { wch: 34 }, { wch: 34 }, { wch: 34 }, { wch: 34 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, wl, "Legenda");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return GA.saveOrShareFile(blob, `Progresso_${GA.slugify(cls.label)}.xlsx`, blob.type);
  };

  // ------------------------------------------------------------------ PDF: relatório de progresso de um atleta
  const pdfText = (s) => String(s == null ? "" : s)
    .replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2192/g, "->").replace(/[^\u0000-\u00FF]/g, "");
  const BLUE = [10, 79, 168], DARK = [7, 52, 111], ORANGE = [245, 130, 32], GREY = [107, 122, 141], INK = [31, 42, 58];

  async function logoDataUrl() {
    try {
      const res = await fetch("icons/logo-mark.png"); if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsDataURL(blob); });
    } catch (e) { return null; }
  }

  GA.buildAthletePdf = async function (cls, aid) {
    const JS = window.jspdf && window.jspdf.jsPDF;
    if (!JS) throw new Error("A biblioteca de PDF não carregou. Verifica a ligação à internet.");
    const doc = new JS({ unit: "mm", format: "a4" });
    const PW = 210, M = 15, CW = PW - 2 * M;
    const name = pdfText(GA.displayName(aid)); const today = GA.todayIso();
    const fmt = (iso) => { const d = GA.parseIso(iso); return `${GA.pad(d.getDate())}/${GA.pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
    let y = 0, page = 1;
    const footer = () => { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GREY); doc.text("Gimnoanima - Associação Desportiva de Sintra", PW / 2, 289, { align: "center" }); doc.text(String(page), PW - M, 289, { align: "right" }); };
    const newPage = () => { footer(); doc.addPage(); page++; y = 20; };
    const ensure = (h) => { if (y + h > 280) newPage(); };
    const heading = (txt) => { ensure(14); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...BLUE); doc.text(pdfText(txt), M, y); doc.setDrawColor(...ORANGE); doc.setLineWidth(0.6); doc.line(M, y + 1.6, M + 18, y + 1.6); y += 8; };

    // cabeçalho
    doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 26, "F"); doc.setFillColor(...ORANGE); doc.rect(0, 26, PW, 1.4, "F");
    const logo = await logoDataUrl(); if (logo) { try { doc.addImage(logo, "PNG", 12, 3, 20, 20); } catch (e) { /* sem logótipo */ } }
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("Gimnoanima", logo ? 36 : M, 13);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("Relatório de progresso", logo ? 36 : M, 20);
    doc.setFontSize(9); doc.text(fmt(today), PW - M, 13, { align: "right" });

    // atleta
    y = 40; doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(name, M, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...GREY);
    const g = GA.getGroup(aid); const season = cls.start && cls.end ? `${fmt(cls.start)} a ${fmt(cls.end)}` : "";
    doc.text(pdfText(`Classe: ${cls.label}` + (g ? `   |   Grupo de trabalho: ${g}` : "") + (season ? `   |   Época: ${season}` : "")), M, y); y += 10;

    // presenças
    const att = GA.athleteAttendance(cls, aid);
    heading("Presenças");
    const boxes = [["Presenças", att.p], ["Justificadas", att.j], ["Faltas", att.f], ["Taxa de presença", att.rate == null ? "-" : Math.round(att.rate * 100) + "%"]];
    const bw = (CW - 9) / 4;
    boxes.forEach((b, i) => {
      const x = M + i * (bw + 3); doc.setFillColor(238, 243, 251); doc.roundedRect(x, y, bw, 15, 2, 2, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...DARK); doc.text(String(b[1]), x + bw / 2, y + 7.5, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY); doc.text(b[0], x + bw / 2, y + 12.5, { align: "center" });
    });
    y += 23;

    // objetivos
    heading("Objetivos");
    if (!cls.objectives.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...GREY); doc.text("Esta classe ainda não tem objetivos definidos.", M, y); y += 8; }
    cls.objectives.forEach((o) => {
      const level = GA.getProgress(aid, o.id);
      const desc = pdfText(level > 0 ? `Nível ${level}/5 - ${o.niveis[level - 1]}` : "Ainda não iniciado");
      const descLines = doc.splitTextToSize(desc, CW - 2);
      const nameLines = doc.splitTextToSize(pdfText(o.nome), CW - 50);
      const h = nameLines.length * 4.6 + descLines.length * 4.2 + 5;
      ensure(h + 2);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(nameLines, M, y + 3.5);
      if (o.categoria) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY); doc.text(pdfText(o.categoria), PW - M - 38, y + 8.4, { align: "right" }); }
      for (let i = 1; i <= 5; i++) { // barra de 5 níveis
        const bx = PW - M - 36 + (i - 1) * 7.4; if (i <= level) doc.setFillColor(...(level === 5 ? [75, 168, 102] : BLUE)); else doc.setFillColor(225, 230, 238);
        doc.roundedRect(bx, y + 1, 6.4, 3.6, 1, 1, "F");
      }
      let yy = y + nameLines.length * 4.6 + 2; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.text(descLines, M, yy + 1.5);
      y += h; doc.setDrawColor(235, 238, 244); doc.setLineWidth(0.2); doc.line(M, y - 1.5, PW - M, y - 1.5);
    });
    y += 4;

    // evolução
    ensure(70); heading("Evolução do nível médio ao longo da época");
    const data = GA.evolutionData(cls, "atleta", aid);
    const cx = M + 8, cy = y, cw = CW - 10, ch = 46;
    doc.setDrawColor(225, 230, 238); doc.setLineWidth(0.2);
    for (let v = 0; v <= 5; v++) { const yy = cy + ch - (v / 5) * ch; doc.line(cx, yy, cx + cw, yy); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GREY); doc.text(String(v), cx - 2, yy + 1, { align: "right" }); }
    const t0 = tms(data.start), t1 = Math.max(tms(data.end), t0 + DAY); const X = (t) => cx + ((t - t0) / (t1 - t0)) * cw, Y = (v) => cy + ch - (v / 5) * ch;
    const md = new Date(t0); md.setDate(1); if (md.getTime() < t0) md.setMonth(md.getMonth() + 1);
    for (; md.getTime() <= t1; md.setMonth(md.getMonth() + 1)) { doc.setFontSize(7); doc.setTextColor(...GREY); doc.text(GA.monthAbbr(md.getMonth()), X(md.getTime()), cy + ch + 4.5, { align: "center" }); }
    doc.setDrawColor(...ORANGE); doc.setLineWidth(0.9);
    data.avg.forEach((p, i) => { if (!i) return; const q = data.avg[i - 1]; doc.line(X(q.t), Y(q.v), X(p.t), Y(q.v)); doc.line(X(p.t), Y(q.v), X(p.t), Y(p.v)); });
    const lastP = data.avg[data.avg.length - 1]; doc.line(X(lastP.t), Y(lastP.v), cx + cw, Y(lastP.v));
    y += ch + 8;
    if (!data.hasHistory) { doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(...GREY); doc.text(doc.splitTextToSize("Ainda não há histórico de alterações deste atleta: o gráfico mostra o nível atual e passa a registar a evolução a partir de agora.", CW), M, y); y += 8; }
    footer();
    return new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
  };

  GA.exportAthletePdf = async function (cls, aid) {
    try {
      const blob = await GA.buildAthletePdf(cls, aid);
      return await GA.saveOrShareFile(blob, `Relatorio_${GA.slugify(GA.displayName(aid))}_${GA.todayIso()}.pdf`, "application/pdf");
    } catch (err) { GA.toast(err.message || "Não foi possível gerar o PDF."); return false; }
  };
})();
