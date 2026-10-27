// Órbita — as tarefas dos seis departamentos, como trabalho que se pode verificar.
//
// Um avatar não é um estado. Antes disto, a cena 3D mexia-se porque sim: o desenho dizia «a
// trabalhar» e ninguém sabia em quê. Aqui há uma máquina de estados guardada na base de dados e a
// cena passa a ler aquilo que está escrito:
//
//   queued ──correr──► running ──► succeeded | failed | awaiting_approval
//                        │                          │
//                        └── timeout ──► failed     └── aprovar ──► succeeded
//
// Regras que isto faz cumprir:
//   · uma tarefa por (chave, departamento) enquanto não terminar — nada de duplicados;
//   · tentativas limitadas; esgotadas, a tarefa falha e fica o motivo escrito;
//   · prazo (timeout) por tarefa: o que passa do prazo falha, não fica pendurado para sempre;
//   · acções de risco não se executam sozinhas — param em `awaiting_approval` à espera do dono;
//   · uma tarefa que falhou pode ser repetida, mas a anterior fica no registo: repetir não apaga;
//   · o resultado e a evidência ficam na linha, não na conversa.
//
// Se não houver motor de IA configurado, as tarefas que precisam de texto dizem isso e ficam em
// `failed` com o motivo — em vez de inventarem um resultado. As determinísticas correm sempre.
import { audit, now, uid } from './db.mjs';

/** Os seis departamentos, na ordem em que a cadeia produz. */
export const DEPARTMENTS = [
  { key: 'command', n: '01', name: 'ORION', role: 'Command', does: 'Coordena, prioriza e distribui; vigia erros e resultados.' },
  { key: 'prospect', n: '02', name: 'LUNA', role: 'Prospect', does: 'Pesquisa permitida, qualifica leads e mantém o CRM sem duplicados.' },
  { key: 'sales', n: '03', name: 'KAI', role: 'Sales', does: 'Prepara propostas e seguimentos; abre projeto quando a oportunidade é ganha.' },
  { key: 'design', n: '04', name: 'NOVA', role: 'Design Lab', does: 'Briefing, arquitectura da informação, design system e especificação.' },
  { key: 'engineering', n: '05', name: 'ZEKE', role: 'Engineering', does: 'Gera código, integra, testa, corrige e prepara a entrega.' },
  { key: 'media', n: '06', name: 'MIRA', role: 'Media', does: 'Rascunhos, imagens de apresentação, estudos de caso e calendário.' },
];

export const STATE = ['queued', 'running', 'succeeded', 'failed', 'awaiting_approval', 'cancelled'];

/** Que departamento trata de cada tipo de trabalho. Sem isto, a tarefa não entra. */
export const KINDS = {
  'lead.pesquisar': { dept: 'prospect', label: 'Pesquisar o site do lead', deterministic: true },
  'lead.qualificar': { dept: 'prospect', label: 'Qualificar e pontuar o lead', deterministic: true },
  'proposta.preparar': { dept: 'sales', label: 'Preparar proposta', deterministic: true },
  'mensagem.redigir': { dept: 'sales', label: 'Redigir a mensagem', deterministic: false },
  'projeto.briefing': { dept: 'design', label: 'Escrever o briefing e o design system', deterministic: true },
  'projeto.gerar': { dept: 'engineering', label: 'Gerar o código do projeto', deterministic: true },
  'projeto.qa': { dept: 'engineering', label: 'Auditar a qualidade', deterministic: true },
  'projeto.corrigir': { dept: 'engineering', label: 'Corrigir o que o QA apontou', deterministic: false },
  'projeto.entregar': { dept: 'engineering', label: 'Entregar (preview / externo)', deterministic: true },
  'conteudo.rascunho': { dept: 'media', label: 'Escrever um rascunho de conteúdo', deterministic: false },
  'command.revisao': { dept: 'command', label: 'Revisão de prioridades', deterministic: true },
};

const DEPT = Object.fromEntries(DEPARTMENTS.map(d => [d.key, d]));
export const deptOf = key => DEPT[key] || null;

const safe = v => { try { return JSON.parse(v || '{}'); } catch { return {}; } };
const safeList = v => { try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };

export function row(r) {
  if (!r) return null;
  return {
    id: r.id, kind: r.kind, dept: r.dept, deptName: DEPT[r.dept]?.name || r.dept,
    title: r.title || KINDS[r.kind]?.label || r.kind, state: r.state,
    entity: r.entity || '', entityId: r.entity_id || '',
    payload: safe(r.payload), result: safe(r.result), evidence: safeList(r.evidence),
    attempts: r.attempts, max_attempts: r.max_attempts,
    created_at: r.created_at, started_at: r.started_at, finished_at: r.finished_at,
    duration_ms: r.started_at && r.finished_at ? Math.max(0, new Date(r.finished_at) - new Date(r.started_at)) : null,
    error: r.error || '', needsApproval: !!r.needs_approval, approved_by: r.approved_by || '',
    approved_at: r.approved_at || null, timeout_ms: r.timeout_ms,
    dedupe: r.dedupe || '', parent_id: r.parent_id || '',
    stateLabel: {
      queued: 'à espera', running: 'a correr', succeeded: 'concluída', failed: 'falhou',
      awaiting_approval: 'espera aprovação', cancelled: 'cancelada',
    }[r.state] || r.state,
  };
}

export function get(db, id) { return row(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)); }

export function list(db, { limit = 50, dept = null, state = null, entityId = null } = {}) {
  const where = []; const args = [];
  if (dept) { where.push('dept = ?'); args.push(dept); }
  if (state) { where.push('state = ?'); args.push(state); }
  if (entityId) { where.push('entity_id = ?'); args.push(entityId); }
  const sql = `SELECT * FROM tasks${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...args, limit).map(row);
}

/**
 * Abre uma tarefa. Se já existir uma aberta com a mesma chave e departamento, devolve essa — não
 * cria duplicados. `approval: true` marca trabalho que só avança com autorização do dono.
 */
export function create(db, { kind, entity = '', entityId = '', title = '', payload = {}, dedupe = '', approval = false, timeoutMs = 5 * 60000, maxAttempts = 3, parentId = '', actor = 'dono' } = {}) {
  const meta = KINDS[kind];
  if (!meta) throw Object.assign(new Error(`tipo de tarefa desconhecido: ${kind}`), { status: 400 });
  const entityId2 = String(entityId || '');
  const dedupeKey = dedupe || `${kind}:${entity}:${entityId2}`;
  const open = db.prepare("SELECT * FROM tasks WHERE dedupe = ? AND state IN ('queued','running','awaiting_approval') ORDER BY created_at LIMIT 1").get(dedupeKey);
  if (open) return { task: row(open), existed: true };
  const id = uid('t_');
  const at = now();
  db.prepare(`INSERT INTO tasks (id, kind, dept, title, entity, entity_id, payload, state, attempts, max_attempts,
      timeout_ms, needs_approval, dedupe, parent_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`)
    .run(id, kind, meta.dept, title || meta.label, entity, entityId2, JSON.stringify(payload || {}), 'queued',
      maxAttempts, timeoutMs, approval ? 1 : 0, dedupeKey, String(parentId || ''), at);
  audit(db, { actor, action: 'tarefa.criada', entity: 'tarefa', entityId: id, detail: { kind, dept: meta.dept, dedupe: dedupeKey } });
  return { task: get(db, id), existed: false };
}

/** Marca como corrida a tentativa. Devolve a linha já actualizada (ou null se não estava à espera). */
function claim(db, id) {
  const t = get(db, id);
  if (!t) throw Object.assign(new Error('tarefa não encontrada'), { status: 404 });
  if (t.state === 'succeeded' || t.state === 'cancelled') throw Object.assign(new Error(`a tarefa já está ${t.stateLabel}`), { status: 409 });
  if (t.state === 'awaiting_approval') throw Object.assign(new Error('a tarefa espera aprovação humana; aprova ou rejeita antes de a repetir'), { status: 409 });
  if (t.attempts >= t.max_attempts && t.state === 'failed') {
    throw Object.assign(new Error(`tentativas esgotadas (${t.attempts}/${t.max_attempts}) — abre uma tarefa nova`), { status: 409 });
  }
  db.prepare("UPDATE tasks SET state='running', attempts=attempts+1, started_at=?, finished_at=NULL, error='' WHERE id=?").run(now(), id);
  return get(db, id);
}

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(`tempo esgotado (${Math.round(ms / 1000)} s) em ${label}`), { timeout: true })), ms);
    if (t.unref) t.unref();
  }),
]);

/**
 * Corre uma tarefa com um tratador determinístico.
 *
 * `handlers[kind](payload, task)` devolve `{ result, evidence }`. Erros → `failed` com o motivo.
 * Tempo esgotado → `failed` (marcado como timeout). Sem tratador → `failed` a dizer que o motor
 * não está configurado — nunca um «concluído» inventado.
 */
export async function run(db, id, { handlers = {}, actor = 'sistema' } = {}) {
  const t = claim(db, id);
  const started = Date.now();
  try {
    const handler = handlers[t.kind];
    if (!handler) {
      const why = KINDS[t.kind]?.deterministic === false
        ? 'esta tarefa precisa de um motor de IA e não há nenhum configurado (GEMINI_API_KEY vazia)'
        : `não há tratador para «${t.kind}»`;
      throw new Error(why);
    }
    const out = await withTimeout(Promise.resolve(handler(t.payload, t)), t.timeout_ms || 5 * 60000, t.kind);
    const result = out?.result ?? out ?? {};
    const evidence = Array.isArray(out?.evidence) ? out.evidence : [];
    const state = t.needsApproval ? 'awaiting_approval' : 'succeeded';
    db.prepare('UPDATE tasks SET state=?, result=?, evidence=?, finished_at=?, error=? WHERE id=?')
      .run(state, JSON.stringify(result).slice(0, 8000), JSON.stringify(evidence).slice(0, 8000), now(), '', id);
    audit(db, { actor, action: state === 'awaiting_approval' ? 'tarefa.espera_aprovacao' : 'tarefa.concluida', entity: 'tarefa', entityId: id, detail: { kind: t.kind, ms: Date.now() - started } });
    return { task: get(db, id), ok: true };
  } catch (e) {
    const msg = String(e?.message || e || 'falhou sem motivo escrito');
    db.prepare("UPDATE tasks SET state='failed', finished_at=?, error=? WHERE id=?")
      .run(now(), msg.slice(0, 500), id);
    audit(db, { actor, action: 'tarefa.falhou', entity: 'tarefa', entityId: id, detail: { kind: t.kind, ms: Date.now() - started, error: e.message, timeout: !!e.timeout } });
    return { task: get(db, id), ok: false, error: e.message };
  }
}

/** Aprovação humana de uma tarefa que esperava por ela. Quem aprova fica escrito. */
export function approve(db, id, { actor = 'dono', note = '' } = {}) {
  const t = get(db, id);
  if (!t) throw Object.assign(new Error('tarefa não encontrada'), { status: 404 });
  if (t.state !== 'awaiting_approval') throw Object.assign(new Error(`só se aprova o que espera aprovação (está ${t.stateLabel})`), { status: 409 });
  db.prepare("UPDATE tasks SET state='succeeded', approved_by=?, approved_at=?, result=? WHERE id=?")
    .run(actor, now(), JSON.stringify({ ...t.result, aprovado_por: actor, nota: note }).slice(0, 8000), id);
  audit(db, { actor, action: 'tarefa.aprovada', entity: 'tarefa', entityId: id, detail: { kind: t.kind, note } });
  return get(db, id);
}

export function reject(db, id, { actor = 'dono', reason = 'sem autorização' } = {}) {
  const t = get(db, id);
  if (!t) throw Object.assign(new Error('tarefa não encontrada'), { status: 404 });
  if (t.state !== 'awaiting_approval') throw Object.assign(new Error(`só se rejeita o que espera aprovação (está ${t.stateLabel})`), { status: 409 });
  db.prepare("UPDATE tasks SET state='cancelled', finished_at=?, error=? WHERE id=?").run(now(), String(reason).slice(0, 500), id);
  audit(db, { actor, action: 'tarefa.rejeitada', entity: 'tarefa', entityId: id, detail: { reason } });
  return get(db, id);
}

/**
 * Recupera o que ficou a meio. Um processo que morre deixa tarefas em `running` sem fim; ao
 * arrancar, as que passaram do prazo voltam à fila (se ainda têm tentativas) ou falham.
 */
export function recover(db, { actor = 'sistema' } = {}) {
  const rows = db.prepare("SELECT * FROM tasks WHERE state = 'running'").all();
  let requeued = 0, failed = 0;
  for (const r of rows) {
    const t = row(r);
    const started = t.started_at ? new Date(t.started_at).getTime() : 0;
    const expired = !started || Date.now() - started > (t.timeout_ms || 5 * 60000);
    if (!expired) continue; // ainda pode estar a correr de verdade (outro processo)
    if (t.attempts < t.max_attempts) {
      db.prepare("UPDATE tasks SET state='queued', error=? WHERE id=?").run('interrompida a meio; volta à fila', r.id);
      requeued++;
      audit(db, { actor, action: 'tarefa.requeue', entity: 'tarefa', entityId: r.id, detail: { attempts: t.attempts } });
    } else {
      db.prepare("UPDATE tasks SET state='failed', finished_at=?, error=? WHERE id=?").run(now(), 'interrompida a meio e sem tentativas', r.id);
      failed++;
      audit(db, { actor, action: 'tarefa.falhou', entity: 'tarefa', entityId: r.id, detail: { motivo: 'interrompida' } });
    }
  }
  return { requeued, failed, vistos: rows.length };
}

/** Estado por departamento — é isto que a cena 3D lê. Nada de animações inventadas. */
export function board(db) {
  const out = DEPARTMENTS.map(d => ({
    ...d,
    queued: 0, running: 0, failed: 0, awaiting: 0, succeeded: 0,
    last: null, lastAt: null,
  }));
  const by = Object.fromEntries(out.map(d => [d.key, d]));
  for (const r of db.prepare('SELECT dept, state, COUNT(*) AS n FROM tasks GROUP BY dept, state').all()) {
    const d = by[r.dept];
    if (!d) continue;
    if (r.state === 'queued') d.queued = r.n;
    else if (r.state === 'running') d.running = r.n;
    else if (r.state === 'failed') d.failed = r.n;
    else if (r.state === 'awaiting_approval') d.awaiting = r.n;
    else if (r.state === 'succeeded') d.succeeded = r.n;
  }
  for (const r of db.prepare("SELECT dept, title, state, finished_at, created_at FROM tasks ORDER BY created_at DESC LIMIT 60").all()) {
    const d = by[r.dept];
    if (!d || d.last) continue;
    d.last = `${r.title} · ${row({ ...r, attempts: 0, max_attempts: 0 }).stateLabel}`;
    d.lastAt = r.finished_at || r.created_at;
  }
  const totals = out.reduce((a, d) => ({
    queued: a.queued + d.queued, running: a.running + d.running, failed: a.failed + d.failed,
    awaiting: a.awaiting + d.awaiting, succeeded: a.succeeded + d.succeeded,
  }), { queued: 0, running: 0, failed: 0, awaiting: 0, succeeded: 0 });
  return { departamentos: out, totais: totals, emCurso: out.filter(d => d.running > 0).map(d => d.name) };
}

/** A cadeia do projeto: do briefing à entrega, com o departamento de cada passo. */
export const CHAIN = [
  { key: 'projeto.briefing', dept: 'design', label: 'Briefing' },
  { key: 'projeto.gerar', dept: 'engineering', label: 'Código' },
  { key: 'projeto.qa', dept: 'engineering', label: 'Qualidade' },
  { key: 'projeto.entregar', dept: 'engineering', label: 'Entrega' },
  { key: 'conteudo.rascunho', dept: 'media', label: 'Conteúdo' },
];

export function chainOf(db, projectId) {
  return CHAIN.map(step => {
    const t = db.prepare("SELECT * FROM tasks WHERE kind = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1").get(step.key, projectId);
    return { ...step, task: row(t) };
  });
}

/** Histórico de uma entidade (projeto, lead), sem duplicar o que já está em `events`. */
export function historyOf(db, entityId, { limit = 40 } = {}) {
  return db.prepare('SELECT * FROM tasks WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?').all(entityId, limit).map(row);
}

/** Números para o painel: o que está à espera, o que falhou, quanto demorou. */
export function summary(db) {
  const b = board(db);
  const durs = db.prepare("SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400000) AS ms FROM tasks WHERE started_at IS NOT NULL AND finished_at IS NOT NULL").get();
  const total = Object.values(b.totais).reduce((a, n) => a + n, 0);
  return {
    total, ...b.totais,
    duracaoMediaMs: durs?.ms ? Math.round(durs.ms) : null,
    semMotor: KINDS && Object.values(KINDS).some(k => !k.deterministic) ? 'há tarefas que exigem um motor de IA; sem ele ficam falhadas com o motivo' : null,
  };
}
