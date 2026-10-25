// Órbita — as horas, num sítio só (25 out 2026).
//
// O escritório é português: as horas vão de 00:00 a 23:59, nunca em AM/PM. Todas as horas e datas
// da página e do servidor passam por aqui, para não haver um sítio onde o browser decide mostrar
// "1:05 PM" só porque o sistema está em inglês.
//
// Nota: o locale sozinho não chega. `hour12: false` é explícito, e os nomes de dias e meses são
// escritos à mão porque o ICU do Node/browser devolve coisas inconsistentes para pt-PT
// (`weekday: 'short'` → "domingo", `day+month` → "25/10").

export const LOCALE = 'pt-PT';

const pad = n => String(n).padStart(2, '0');
export const WEEKDAYS_SHORT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
export const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const MONTHS_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
export const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** 00:00 → 23:59. A hora do escritório, sempre com dois dígitos. */
export function hhmm(ts) {
  const d = ts instanceof Date ? ts : new Date(ts ?? Date.now());
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 13:05:42 — com segundos (o relógio da barra). */
export const hhmmss = ts => { const d = ts instanceof Date ? ts : new Date(ts ?? Date.now()); return `${hhmm(d)}:${pad(d.getSeconds())}`; };

/** 13:05 · 00:05 · 23:59 — o que a página mostra como hora. */
export const fmtTime = (ts, opts = {}) => {
  const d = new Date(ts ?? Date.now());
  if (Number.isNaN(d.getTime())) return '—';
  return opts.second ? hhmmss(d) : hhmm(d);
};

/** O mesmo, com segundos — o relógio da barra. */
export const fmtClock = ts => fmtTime(ts, { second: true });

/** '25 out.' */
export const fmtDate = (ts, opts = {}) => {
  const d = new Date(ts ?? Date.now());
  if (Number.isNaN(d.getTime())) return '—';
  return opts.weekday ? `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
    : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
};

/** 'sáb., 25 out. 13:05' — a forma curta com a hora a 24 h. */
export const fmtDateTime = (ts, opts = {}) => {
  const d = new Date(ts ?? Date.now());
  if (Number.isNaN(d.getTime())) return '—';
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${hhmm(d)}`;
};

/** 'sábado, 25 de outubro às 13:05' — a forma longa que os agentes leem. */
export const fmtDateTimeLong = (ts) => {
  const d = new Date(ts ?? Date.now());
  if (Number.isNaN(d.getTime())) return '—';
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]} às ${hhmm(d)}`;
};

/** Aceita '9:5', '9:05', '09:05', '24:00' → '09:05', '09:05', '00:00'. Null se não for uma hora. */
export function normaliseHour(value) {
  const m = /^(\d{1,2})[:h.]?(\d{1,2})?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = +m[1] % 24, mi = m[2] === undefined ? 0 : +m[2];
  if (mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

/** As 24 horas do dia, para o relógio do escritório (nunca 12 horas, nunca AM/PM). */
export const HOURS_24 = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`);
export const MINUTES_5 = Array.from({ length: 12 }, (_, m) => `${pad(m * 5)}`);
