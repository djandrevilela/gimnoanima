/* Gimnoanima — utilidades: texto, datas, feriados e calendário de treinos */
(function () {
  "use strict";
  const GA = (window.GA = window.GA || {});

  GA.escapeHtml = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  GA.MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  GA.WEEKDAYS_PT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  GA.WD_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  GA.WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Seg..Dom

  const pad = (n) => String(n).padStart(2, "0");
  GA.pad = pad;
  GA.isoLocal = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  GA.parseIso = (iso) => new Date(iso + "T00:00:00");
  GA.todayIso = () => GA.isoLocal(new Date());
  GA.fmtDateLong = (iso) => {
    const d = GA.parseIso(iso);
    return `${GA.WEEKDAYS_PT[d.getDay()]}, ${d.getDate()} ${GA.MONTHS_PT[d.getMonth()]}`;
  };
  GA.fmtDateShort = (iso) => {
    const d = GA.parseIso(iso);
    return `${d.getDate()} ${GA.MONTHS_PT[d.getMonth()].slice(0, 3)}`;
  };
  GA.monthAbbr = (m) => GA.MONTHS_PT[m].charAt(0).toUpperCase() + GA.MONTHS_PT[m].slice(1, 3);
  GA.slugify = (s) =>
    String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "classe";
  GA.defaultSeasonEnd = () => {
    const d = new Date();
    return (d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear()) + "-07-31";
  };

  // ---- ordenação alfabética (pt) ----
  GA.compareNames = (a, b) => String(a).localeCompare(String(b), "pt", { sensitivity: "base" });

  // ---- feriados nacionais (PT) + municipal ----
  GA.easter = function (y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  };
  GA.holidaysForYear = function (y, municipal) {
    const set = new Set(["01-01", "04-25", "05-01", "06-10", "08-15", "10-05", "11-01", "12-01", "12-08", "12-25"].map((md) => `${y}-${md}`));
    if (municipal && /^\d\d-\d\d$/.test(municipal)) set.add(`${y}-${municipal}`);
    const e = GA.easter(y);
    const off = (days) => { const d = new Date(e); d.setDate(d.getDate() + days); return GA.isoLocal(d); };
    set.add(off(-2)); // Sexta-feira Santa
    set.add(off(0));  // Páscoa
    set.add(off(60)); // Corpo de Deus
    return set;
  };

  // ---- calendário de uma classe: dias da semana entre início e fim,
  //      sem feriados / dias cancelados, mais dias extra ----
  const cache = new Map();
  GA.classSessions = function (cls, municipal) {
    const key = [cls.id, cls.start, cls.end, (cls.weekdays || []).join(","), cls.excludeHolidays, (cls.exclude || []).join(","), (cls.extra || []).join(","), municipal].join("|");
    if (cache.has(key)) return cache.get(key);
    const out = new Set();
    if (cls.start && cls.end && cls.start <= cls.end) {
      const hol = new Set();
      if (cls.excludeHolidays !== false) {
        for (let y = +cls.start.slice(0, 4); y <= +cls.end.slice(0, 4); y++) GA.holidaysForYear(y, municipal).forEach((x) => hol.add(x));
      }
      const excl = new Set(cls.exclude || []);
      const wd = cls.weekdays || [];
      const d = GA.parseIso(cls.start), end = GA.parseIso(cls.end);
      while (d <= end) {
        const iso = GA.isoLocal(d);
        if (wd.includes(d.getDay()) && !hol.has(iso) && !excl.has(iso)) out.add(iso);
        d.setDate(d.getDate() + 1);
      }
    }
    (cls.extra || []).forEach((x) => out.add(x));
    const list = [...out].sort();
    if (cache.size > 200) cache.clear();
    cache.set(key, list);
    return list;
  };

  // períodos de até 4 meses (ex.: "Set - Dez 2026"), para os separadores
  GA.periodsOf = function (cls, sessions) {
    if (!sessions.length) return [];
    const first = GA.parseIso(sessions[0]);
    const base = first.getFullYear() * 12 + first.getMonth();
    const chunks = {};
    sessions.forEach((iso) => {
      const dt = GA.parseIso(iso);
      const idx = Math.floor((dt.getFullYear() * 12 + dt.getMonth() - base) / 4);
      (chunks[idx] = chunks[idx] || []).push(iso);
    });
    return Object.keys(chunks).map(Number).sort((a, b) => a - b).map((idx, n) => {
      const list = chunks[idx];
      const a = GA.parseIso(list[0]), b = GA.parseIso(list[list.length - 1]);
      let label;
      if (a.getFullYear() === b.getFullYear()) {
        label = a.getMonth() === b.getMonth()
          ? `${GA.monthAbbr(a.getMonth())} ${a.getFullYear()}`
          : `${GA.monthAbbr(a.getMonth())} - ${GA.monthAbbr(b.getMonth())} ${a.getFullYear()}`;
      } else {
        label = `${GA.monthAbbr(a.getMonth())} ${a.getFullYear()} - ${GA.monthAbbr(b.getMonth())} ${b.getFullYear()}`;
      }
      return { id: `p${n + 1}`, label, sessions: list };
    });
  };
})();
