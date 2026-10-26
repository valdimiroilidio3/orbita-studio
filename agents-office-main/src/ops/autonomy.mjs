// Órbita — autonomia graduada: o sistema só ganha o direito de enviar sozinho com casos.
//
// A regra que faz isto ser confiança e não marketing:
//   · começa tudo em «pede-me sempre»;
//   · a proposta de subir de nível vem dos números (50 casos, 95% aprovados), nunca de um menu;
//   · subir é uma decisão do dono, escrita com quem e quando;
//   · descer é imediato e não pede justificação;
//   · e há sempre um travão geral por cima disto: o interruptor de emergência, o opt-out, o
//     aquecimento do número e o limite de envios continuam a mandar.
import { audit, getSetting, now, setSetting, uid } from './db.mjs';

export const LEVELS = ['pedir_sempre', 'proposto', 'autonomo'];
export const DEFAULT = { minCasos: 50, minTaxa: 0.95 };

export function thresholds(db) {
  return {
    minCasos: getSetting(db, 'autonomia.min_casos', DEFAULT.minCasos),
    minTaxa: getSetting(db, 'autonomia.min_taxa', DEFAULT.minTaxa),
  };
}

export function setThresholds(db, { minCasos, minTaxa }, actor = 'dono') {
  if (minCasos !== undefined) {
    const n = +minCasos;
    if (!(n >= 5 && n <= 5000)) throw Object.assign(new Error('o mínimo de casos tem de ficar entre 5 e 5000'), { status: 400 });
    setSetting(db, 'autonomia.min_casos', Math.round(n));
  }
  if (minTaxa !== undefined) {
    const t = +minTaxa;
    if (!(t > 0.5 && t <= 1)) throw Object.assign(new Error('a taxa mínima tem de estar entre 50% e 100%'), { status: 400 });
    setSetting(db, 'autonomia.min_taxa', t);
  }
  audit(db, { actor, action: 'autonomia.limiar', entity: 'sistema', entityId: 'autonomia', detail: thresholds(db) });
  return thresholds(db);
}

/** O tipo de uma mensagem: o canal e o gancho principal que ela usa. */
export function scopeOf({ channel, evidenceUsed = [], body = '' }) {
  const first = (evidenceUsed || [])[0];
  const hook = first?.key || (/sem site|não tem site/i.test(body) ? 'sem-site' : 'geral');
  return `${channel || 'email'}:${hook}`;
}

/** Os números de um tipo: quantas foram aprovadas à mão, quantas rejeitadas. */
export function stats(db, scope) {
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM messages WHERE scope = ? OR (scope = '' AND ? = 'geral') GROUP BY status`).all(scope, scope.replace(/^[^:]+:/, ''));
  const by = Object.fromEntries(rows.map(r => [r.status, r.n]));
  const aprovadas = (by.aprovada || 0) + (by.enviada || 0) + (by.rascunho === undefined ? 0 : 0);
  const rejeitadas = (by.rejeitada || 0) + (by.bloqueada || 0);
  const decididas = aprovadas + rejeitadas;
  const taxa = decididas ? aprovadas / decididas : null;
  return { scope, aprovadas, rejeitadas, decididas, taxa, pendentes: (by.rascunho || 0) + (by.aprovada || 0) + (by.ensaio || 0) };
}

export function get(db, scope) {
  const row = db.prepare('SELECT * FROM autonomy WHERE scope = ?').get(scope);
  return row ? { ...row, baseline: safeJSON(row.baseline, {}) } : null;
}

const safeJSON = (v, f) => { try { return JSON.parse(v || '{}'); } catch { return f; } };

function put(db, scope, patch, actor, reason) {
  const cur = get(db, scope) || { scope, status: 'pedir_sempre', decided_at: null, decided_by: '', reason: '', baseline: {} };
  const next = { ...cur, ...patch };
  db.prepare(`INSERT INTO autonomy (id, scope, status, decided_at, decided_by, reason, baseline) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(scope) DO UPDATE SET status=excluded.status, decided_at=excluded.decided_at, decided_by=excluded.decided_by, reason=excluded.reason, baseline=excluded.baseline`)
    .run(cur.id || uid('a_'), scope, next.status, next.decided_at || now(), actor, reason || '', JSON.stringify(next.baseline || {}));
  return get(db, scope);
}

/**
 * O que o sistema recomenda para um tipo, e porquê. Não muda nada — só diz.
 * Devolve `propose: true` quando vale a pena pedir ao dono.
 */
export function recommendation(db, scope) {
  const st = stats(db, scope);
  const t = thresholds(db);
  const cur = get(db, scope);
  const status = cur?.status || 'pedir_sempre';
  const faltamCasos = Math.max(0, t.minCasos - st.decididas);
  const taxaOk = st.taxa !== null && st.taxa >= t.minTaxa;
  const elegivel = st.decididas >= t.minCasos && taxaOk;
  const pct = st.taxa === null ? null : Math.round(st.taxa * 1000) / 10;
  let text;
  if (status === 'autonomo') text = `envio sozinho: ${st.decididas} casos, ${pct}% aprovados`;
  else if (elegivel) text = `posso enviar este tipo sozinho: ${st.decididas} casos, ${pct}% aprovados (preciso de ${t.minCasos} e ${Math.round(t.minTaxa * 100)}%)`;
  else if (faltamCasos > 0) text = `ainda não: faltam ${faltamCasos} casos decididos (${st.decididas}/${t.minCasos})${pct !== null ? ` e a taxa está em ${pct}%` : ''}`;
  else text = `ainda não: a taxa está em ${pct}% e preciso de ${Math.round(t.minTaxa * 100)}%`;
  return {
    scope, status, ...st, taxaPct: pct, limiar: t,
    elegivel: elegivel && status !== 'autonomo',
    propose: elegivel && status !== 'autonomo',
    text,
  };
}

/** Sobe um nível. Só o dono, e só com números que o justifiquem (ou com `force` explícito). */
export function grant(db, scope, { actor = 'dono', force = false, reason = '' } = {}) {
  const rec = recommendation(db, scope);
  if (!rec.elegivel && !force) {
    throw Object.assign(new Error(`não subo sem casos: ${rec.text}`), { status: 409 });
  }
  const out = put(db, scope, {
    status: 'autonomo', decided_at: now(),
    baseline: { casos: rec.decididas, taxa: rec.taxaPct, limiar: rec.limiar },
  }, actor, reason || (force ? 'decisão do dono sem amostra suficiente' : `ganho com ${rec.decididas} casos a ${rec.taxaPct}%`));
  audit(db, { actor, action: 'autonomia.autonomo', entity: 'mensagem', entityId: scope, detail: { casos: rec.decididas, taxa: rec.taxaPct, force } });
  return out;
}

/** Desce. Nunca pergunta nada, nunca falha — revogar é sempre possível. */
export function revoke(db, scope, { actor = 'dono', reason = '' } = {}) {
  const cur = get(db, scope);
  const out = put(db, scope, { status: 'pedir_sempre', decided_at: now(), baseline: cur?.baseline || {} }, actor, reason || 'revogado pelo dono');
  audit(db, { actor, action: 'autonomia.revogada', entity: 'mensagem', entityId: scope, detail: reason });
  return out;
}

/** A pergunta que o sistema faz: «queres que envie este tipo sozinho?» */
export function proposals(db) {
  const scopes = db.prepare("SELECT DISTINCT scope FROM messages WHERE scope != ''").all().map(r => r.scope);
  return scopes.map(s => recommendation(db, s)).filter(r => r.propose);
}

export function list(db) {
  const scopes = db.prepare("SELECT DISTINCT scope FROM messages WHERE scope != ''").all().map(r => r.scope);
  const seen = new Set(scopes);
  for (const row of db.prepare('SELECT scope FROM autonomy').all()) seen.add(row.scope);
  return [...seen].map(s => recommendation(db, s)).sort((a, b) => (b.propose ? 1 : 0) - (a.propose ? 1 : 0));
}

export function isAutonomous(db, scope) {
  return get(db, scope)?.status === 'autonomo';
}

/* ---------- modo ensaio ---------- */

export function trial(db) {
  return { activo: getSetting(db, 'ensaio.activo', false) === true, desde: getSetting(db, 'ensaio.desde', null) };
}

export function setTrial(db, active, actor = 'dono') {
  setSetting(db, 'ensaio.activo', !!active);
  setSetting(db, 'ensaio.desde', active ? now() : null);
  audit(db, { actor, action: active ? 'ensaio.iniciado' : 'ensaio.terminado', entity: 'sistema', entityId: 'ensaio' });
  return trial(db);
}

/** O relatório do ensaio: o que teria saído, para quem, e o que isso mostra. */
export function trialReport(db) {
  const t = trial(db);
  const rows = db.prepare("SELECT * FROM messages WHERE status = 'ensaio' ORDER BY created_at DESC LIMIT 50").all();
  const byScope = {};
  for (const r of rows) byScope[r.scope || 'geral'] = (byScope[r.scope || 'geral'] || 0) + 1;
  return {
    activo: t.activo, desde: t.desde,
    total: rows.length,
    porTipo: byScope,
    amostra: rows.slice(0, 5).map(r => ({ id: r.id, canal: r.channel, corpo: r.body, criado: r.created_at })),
    nota: rows.length ? 'nada disto saiu. Aprova um para o transformar em mensagem a sério.' : 'ainda não há nada escrito em ensaio',
  };
}
