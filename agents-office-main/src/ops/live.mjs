// Órbita — o que está a acontecer, agora, em cada posto de trabalho.
//
// O escritório 3D já sabia desenhar os agentes e os monitores. O que não sabia era *o que* mostrar:
// cada ecrã repetia três linhas de exemplo. Isto liga cada monitor ao trabalho que a base de dados
// já guarda — tarefas, jobs, projetos, QA e a cadeia de eventos — e nada mais.
//
// Regras que esta camada faz cumprir:
//   · um agente só está em `live` se houver trabalho a correr ou evento real nos últimos 2 minutos;
//   · sem tarefas, o estado é `idle` e o ecrã di-lo por palavras — não inventa atividade;
//   · `error` só com uma falha registada e ainda fresca; `waiting` para fila e aprovações;
//   · a percentagem não existe: mostra-se o que se sabe (tentativa 1/3, minutos decorridos,
//     passos concluídos da cadeia) e nunca um número inventado;
//   · caminhos absolutos, tokens e variáveis de ambiente não saem daqui — há um `redact()`.
import { DEPARTMENTS, KINDS, row as taskRow } from './tasks.mjs';
import { filesOf } from './projects.mjs';

/** O posto 3D que trata de cada tipo de tarefa — só agentes que já existem no escritório. */
export const SEAT = {
  'lead.pesquisar': 'vmail',     // AUDITOR DE WEBSITES
  'lead.qualificar': 'ilm',      // QUALIFICADOR
  'proposta.preparar': 'piper',  // PROPOSTAS
  'mensagem.redigir': 'folo',    // SEGUIMENTOS
  'projeto.briefing': 'dasst',   // UI E DESIGN SYSTEM
  'projeto.gerar': 'crep',       // FRONTEND
  'projeto.qa': 'qa',            // QA E TESTES
  'projeto.corrigir': 'cass',    // BACKEND E INTEGRAÇÕES
  'projeto.entregar': 'apay',    // DEPLOYS E INFRA
  'conteudo.rascunho': 'newt',   // CONTEÚDO E NEWSLETTER
  'command.revisao': 'elead',    // ORBITA DIRECTOR
};

/** Departamento de operação → departamento do escritório (os seis que já existem na cena). */
export const DEPT_BRIDGE = {
  command: 'emails', prospect: 'sales', sales: 'ops', design: 'fin', engineering: 'delivery', media: 'marketing',
};

const FRESH_MS = 2 * 60 * 1000;      // «live» = evento real neste intervalo
const ERROR_MS = 30 * 60 * 1000;     // uma falha antiga não pinta o posto de vermelho para sempre
const DONE_MS = 24 * 3600 * 1000;    // o histórico curto do painel

const nowMs = () => Date.now();
const ms = iso => (iso ? new Date(iso).getTime() : 0);

/** Sem caminhos absolutos, sem segredos por descuido. */
export function redact(text) {
  return String(text == null ? '' : text)
    .replace(/\/home\/[^\s"']+/g, m => '…/' + m.split('/').slice(-2).join('/'))
    .replace(/\/(?:Users|root|var|tmp)\/[^\s"']+/g, m => '…/' + m.split('/').slice(-2).join('/'))
    .replace(/\b(sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{8,}/g, '[chave oculta]')
    .replace(/\b(ORBITA_ADMIN_TOKEN|GEMINI_API_KEY|RESEND_API_KEY|GITHUB_TOKEN|VERCEL_DEPLOY_HOOK)=\S+/g, '$1=[oculto]')
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\b/g, '[token oculto]');
}

const safeJSON = (v, fb) => { try { return JSON.parse(v); } catch { return fb; } };

/** A tarefa tal como pode sair do servidor: sem `payload` (pode levar conteúdo privado) e com o
 *  erro passado pelo `redact`. O resto são números e datas que o painel mostra tal e qual. */
function taskOut(t) {
  if (!t) return null;
  return {
    id: t.id, kind: t.kind, title: t.title, state: t.state, stateLabel: t.stateLabel,
    entity: t.entity, entityId: t.entityId,
    attempts: t.attempts, max_attempts: t.max_attempts,
    started_at: t.started_at, finished_at: t.finished_at, duration_ms: t.duration_ms,
    needsApproval: !!t.needsApproval, error: redact(t.error || ''),
  };
}

/** As linhas de um resultado, explicadas em português — o que foi escrito, testado ou falhou. */
function linesFromResult(kind, result = {}, evidence = [], state = 'succeeded') {
  const out = [];
  if (result.files?.length) out.push({ k: 'file', text: `${result.files.length} ficheiro(s) escritos${result.bytes ? ' · ' + (result.bytes / 1024).toFixed(1) + ' KB' : ''}` });
  if (result.runId) out.push({ k: 'test', text: `QA ${result.passou ? 'passou' : 'falhou'} · ${result.total} problema(s) · ${result.critico} crítico(s)` });
  if (result.estado) out.push({ k: 'ok', text: `estado → ${result.estado}` });
  if (result.url) out.push({ k: 'ok', text: `preview em ${result.url}` });
  if (result.score != null) out.push({ k: 'ok', text: `pontuação ${result.score}/100${result.estado ? ' · ' + result.estado : ''}` });
  if (result.status) out.push({ k: 'result', text: `leitura: ${result.status}${result.factos != null ? ' · ' + result.factos + ' facto(s)' : ''}` });
  if (result.preco_eur != null) out.push({ k: 'result', text: `proposta: ${result.preco_eur} € · ${result.prazo_dias} dia(s)` });
  if (result.esperaAprovacao != null) out.push({ k: 'result', text: `${result.esperaAprovacao} à espera · ${result.tarefasFalhadas} falhada(s) · ${result.projetosSemQa} projeto(s) sem QA` });
  if (result.briefing) out.push({ k: 'file', text: `briefing escrito (${result.paginas?.length || 0} página(s), ${result.criterios?.length || 0} critério(s))` });
  for (const e of (evidence || []).slice(0, 4)) if (e?.label) out.push({ k: 'result', text: redact(e.label) });
  // sem resultado escrito, o que se diz é o estado que está na base de dados — não «concluída» por omissão
  if (!out.length && state === 'failed') out.push({ k: 'error', text: 'falhou — o motivo não ficou escrito' });
  else if (!out.length) out.push({ k: 'result', text: `${state === 'succeeded' ? 'concluída' : state} (${KINDS[kind]?.label || kind})` });
  return out;
}

/**
 * O que o departamento do posto fez — para os 24 postos que não têm tipo de tarefa próprio.
 * É trabalho real, mas **não é deste posto**: quem desenha tem de o dizer, e diz.
 */
function departmentActivity(db, sceneDept, { now = nowMs() } = {}) {
  if (!sceneDept) return null;
  const kinds = Object.entries(KINDS).filter(([, k]) => DEPT_BRIDGE[k.dept] === sceneDept).map(([id]) => id);
  if (!kinds.length) return null;
  const inList = kinds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM tasks WHERE kind IN (${inList}) ORDER BY created_at DESC LIMIT 6`).all(...kinds).map(taskRow);
  if (!rows.length) return null;
  const aberta = rows.find(t => ['running', 'queued', 'awaiting_approval'].includes(t.state)) || null;
  const ultima = rows[0];
  const ref = aberta || ultima;
  return {
    dept: sceneDept,
    active: rows.filter(t => ['running', 'queued', 'awaiting_approval'].includes(t.state)).length,
    at: ref.finished_at || ref.started_at || ref.created_at,
    task: taskOut(ref),
    lines: (ref.state === 'failed'
      ? [{ k: 'error', text: `✕ ${redact(ref.error || 'falhou sem motivo escrito')}` }]
      : linesFromResult(ref.kind, ref.result, ref.evidence, ref.state)).slice(0, 3),
    history: rows.map(t => ({ id: t.id, title: t.title, state: t.state, stateLabel: t.stateLabel, at: t.finished_at || t.started_at || t.created_at })),
  };
}

/** Tudo o que se sabe sobre um posto, a partir das tabelas — sem uma única linha inventada. */
function forAgent(db, agentId, { now = nowMs(), roster = {} } = {}) {
  const dept = Object.entries(SEAT).find(([, id]) => id === agentId)?.[0]
    || (agentId === 'elead' ? 'command' : null);
  const kinds = Object.entries(SEAT).filter(([, id]) => id === agentId).map(([k]) => k);
  const inList = kinds.length ? kinds.map(() => '?').join(',') : null;

  const tarefas = inList
    ? db.prepare(`SELECT * FROM tasks WHERE kind IN (${inList}) ORDER BY created_at DESC LIMIT 12`).all(...kinds).map(taskRow)
    : [];
  const aberta = tarefas.find(t => ['running', 'queued', 'awaiting_approval'].includes(t.state)) || null;
  const ultima = tarefas[0] || null;
  const falhada = tarefas.find(t => t.state === 'failed' && now - ms(t.finished_at || t.created_at) < ERROR_MS) || null;

  const tarefaRef = aberta || ultima;
  const projectId = tarefaRef && tarefaRef.entity === 'projeto' ? tarefaRef.entityId : '';
  const projeto = projectId ? db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) : null;
  const qa = projectId ? db.prepare('SELECT * FROM qa_runs WHERE project_id = ? ORDER BY at DESC LIMIT 1').get(projectId) : null;

  const jobs = inList
    ? db.prepare(`SELECT * FROM jobs WHERE kind IN (${inList}) ORDER BY COALESCE(finished_at, started_at, created_at) DESC LIMIT 6`).all(...kinds)
    : [];

  const eventos = tarefas.length
    ? db.prepare(`SELECT at, actor, action, detail FROM events WHERE entity_id IN (${tarefas.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 14`).all(...tarefas.map(t => t.id))
    : [];

  // ---- estado: só o que está escrito ----
  const lastEventAt = Math.max(
    ...tarefas.map(t => ms(t.finished_at) || ms(t.started_at) || ms(t.created_at)),
    ...jobs.map(j => ms(j.finished_at) || ms(j.started_at) || ms(j.created_at)),
    0,
  );
  let state = 'idle';
  if (aberta?.state === 'running') state = 'live';
  else if (aberta?.state === 'awaiting_approval' || aberta?.state === 'queued') state = 'waiting';
  else if (falhada) state = 'error';
  else if (lastEventAt && now - lastEventAt < FRESH_MS) state = 'live';

  // ---- linhas do monitor ----
  const lines = [];
  if (aberta) {
    lines.push({ k: 'start', text: `▸ ${aberta.title}` });
    if (aberta.started_at) lines.push({ k: 'tool', text: `começou ${new Date(aberta.started_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false })} · tentativa ${aberta.attempts}/${aberta.max_attempts}` });
    if (aberta.state === 'awaiting_approval') lines.push({ k: 'wait', text: 'à espera da tua aprovação' });
  } else if (ultima) {
    lines.push({ k: 'start', text: `▸ ${ultima.title} · ${ultima.stateLabel}` });
    if (ultima.state === 'failed') lines.push({ k: 'error', text: `✕ ${redact(ultima.error || 'falhou sem motivo escrito')}` });
    else lines.push(...linesFromResult(ultima.kind, ultima.result, ultima.evidence, ultima.state));
  } else {
    lines.push({ k: 'idle', text: 'sem tarefas registadas para este posto' });
  }
  if (falhada && falhada.state === 'failed') lines.push({ k: 'error', text: `✕ ${redact(falhada.error || 'falhou')}` });
  for (const j of jobs.slice(0, 3)) {
    if (j.status === 'falhou') lines.push({ k: 'error', text: `✕ ${redact(j.error || 'job falhou')}` });
  }

  // ---- artefactos: só ficheiros que existem ----
  const artifacts = [];
  if (projeto) {
    try {
      const files = filesOf(db, projeto.id);
      for (const f of files.slice(0, 6)) artifacts.push({ kind: 'ficheiro', label: f.file, url: `/preview/${projeto.id}/${encodeURIComponent(f.file)}`, bytes: f.size });
    } catch { /* projeto sem pasta */ }
    artifacts.push({ kind: 'zip', label: `${projeto.id}.zip`, url: `/api/ops/projetos/${projeto.id}/zip` });
    if (qa) artifacts.push({ kind: 'relatorio', label: 'relatório de QA', url: `/api/ops/projetos/${projeto.id}` });
  }

  return {
    id: agentId,
    dept,
    kinds,
    state,
    stateLabel: { live: 'a trabalhar', waiting: 'à espera', error: 'falhou', idle: 'sem tarefa' }[state],
    since: aberta?.started_at || ultima?.finished_at || lastEventAt || null,
    lastEventAt: lastEventAt || null,
    task: taskOut(aberta || (falhada ? falhada : null)),
    last: taskOut(ultima),
    lines: lines.slice(0, 8),
    artifacts,
    verification: qa ? { at: qa.at, passed: !!qa.passed, total: qa.total, critical: qa.critical, important: qa.important, minor: qa.minor } : null,
    project: projeto ? { id: projeto.id, name: projeto.name, status: projeto.status, preview: projeto.preview_url || '' } : null,
    history: tarefas.map(t => ({ id: t.id, title: t.title, state: t.state, stateLabel: t.stateLabel, at: t.finished_at || t.started_at || t.created_at, ms: t.duration_ms, error: redact(t.error || '') })),
    events: eventos.map(e => ({ at: e.at, actor: e.actor, action: e.action, detail: redact(typeof e.detail === 'string' ? e.detail.slice(0, 160) : JSON.stringify(e.detail)).slice(0, 160) })),
    jobs: jobs.map(j => ({ kind: j.kind, status: j.status, error: redact(j.error || ''), at: j.finished_at || j.started_at || j.created_at })),
    hasData: tarefas.length > 0 || jobs.length > 0,
    // o posto não tem tarefas próprias? fica registado o que o departamento dele fez — rotulado
    deptActivity: (tarefas.length || jobs.length) ? null : departmentActivity(db, roster[agentId]?.dept, { now }),
    role: roster[agentId]?.role || '',
    deptName: roster[agentId]?.dept || '',
  };
}

/** O retrato completo: todos os postos, o resumo e a hora do servidor. */
export function snapshot(db, { agents = [], roster = {}, now = nowMs() } = {}) {
  const porAgente = {};
  const lista = agents.length ? agents : Object.values(SEAT);
  for (const id of new Set(lista)) porAgente[id] = forAgent(db, id, { now, roster });
  const tarefas = db.prepare("SELECT state, COUNT(*) AS n FROM tasks GROUP BY state").all();
  const by = Object.fromEntries(tarefas.map(r => [r.state, r.n]));
  const abertas = db.prepare("SELECT * FROM tasks WHERE state IN ('queued','running','awaiting_approval') ORDER BY created_at").all().map(taskRow);
  return {
    ok: true,
    at: new Date(now).toISOString(),
    agents: porAgente,
    totais: {
      live: Object.values(porAgente).filter(a => a.state === 'live').length,
      waiting: by.awaiting_approval || 0,
      queued: by.queued || 0,
      running: by.running || 0,
      failed: by.failed || 0,
      succeeded: by.succeeded || 0,
    },
    abertas: abertas.map(t => ({ id: t.id, kind: t.kind, dept: t.dept, title: t.title, state: t.state, entityId: t.entityId })),
    departamentos: DEPARTMENTS,
    fonte: 'tarefas, jobs, projetos e qa_runs da base de dados do Órbita',
  };
}

/**
 * Impressão digital do que interessa para decidir «mudou». Não inclui durações nem a hora, para
 * não haver um evento por segundo: o cliente calcula o tempo decorrido a partir de `since`.
 */
export function fingerprint(db) {
  const t = db.prepare("SELECT id, state, attempts, started_at, finished_at, error FROM tasks ORDER BY created_at DESC LIMIT 60").all();
  const j = db.prepare("SELECT id, status, finished_at FROM jobs ORDER BY created_at DESC LIMIT 30").all();
  const p = db.prepare('SELECT id, status, updated_at FROM projects ORDER BY updated_at DESC LIMIT 20').all();
  return JSON.stringify([t, j, p]).length + ':' + t.map(x => `${x.id}${x.state}${x.attempts}${x.finished_at || ''}`).join('|')
    + j.map(x => `${x.id}${x.status}`).join('|') + p.map(x => `${x.id}${x.status}${x.updated_at}`).join('|');
}
