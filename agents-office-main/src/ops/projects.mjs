// Órbita — os projetos: da oportunidade ao código, do código à entrega.
//
// Um projeto não é um cartão numa lista. É uma máquina de estados com provas:
//
//   rascunho ──gerar──► gerado ──QA──► qa_passou ──aprovar──► aprovado ──entregar──► entregue
//                          ▲              │
//                          └── qa_falhou ◄┘   (e qualquer geração volta a «gerado»)
//
// Cada passo deixa rasto em `events` (cadeia de hashes), o QA fica em `qa_runs` com o manifesto
// dos ficheiros auditados, e as entregas em `deliveries`. Não há estado em memória.
//
// Regras que isto faz cumprir:
//   · um negócio, um projeto (índice único em lead_id);
//   · aprovar exige uma auditoria aprovada cujos ficheiros ainda sejam os mesmos;
//   · entregar exige aprovação — e «entregar» só quer dizer o que se pode provar (preview real
//     servido por nós, ou um deployment pedido a um serviço configurado).
import fs from 'node:fs';
import path from 'node:path';
import { audit, now, uid } from './db.mjs';
import { getLead } from './leads.mjs';
import { KINDS, STACKS, plan, writeFiles, currentManifest } from './generate.mjs';
export { KINDS, STACKS };
import { auditDir, changesSince } from './qa.mjs';
import { offerOf } from './personalize.mjs';
import { dossier } from './research.mjs';

export const STATUS = ['rascunho', 'gerado', 'qa_falhou', 'qa_passou', 'aprovado', 'entregue'];
export const TRANSITIONS = {
  rascunho: ['gerado'],
  gerado: ['qa_passou', 'qa_falhou', 'gerado'],
  qa_falhou: ['gerado'],
  qa_passou: ['gerado', 'aprovado'],
  aprovado: ['gerado', 'entregue'],
  entregue: ['gerado'],
};
const safe = v => { try { return JSON.parse(v || '[]'); } catch { return []; } };
const listOf = v => Array.isArray(v) ? v.map(x => String(x)).filter(Boolean) : String(v || '').split('\n').map(s => s.trim()).filter(Boolean);

function row(r) {
  return r ? {
    ...r,
    goals: safe(r.goals), pages: safe(r.pages), features: safe(r.features), acceptance: safe(r.acceptance),
  } : null;
}

const slugify = s => String(s || 'projeto').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 44) || 'projeto';

function setStatus(db, id, status, actor, reason) {
  const p = get(db, id);
  if (!p) throw Object.assign(new Error('projeto não encontrado'), { status: 404 });
  if (!STATUS.includes(status)) throw Object.assign(new Error(`estado desconhecido: ${status}`), { status: 400 });
  if (status !== p.status && !(TRANSITIONS[p.status] || []).includes(status)) {
    throw Object.assign(new Error(`de «${p.status}» não se passa a «${status}» — segue o pipeline (${(TRANSITIONS[p.status] || []).join(', ') || 'fim'})`), { status: 409 });
  }
  db.prepare('UPDATE projects SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
  audit(db, { actor, action: 'projeto.estado', entity: 'projeto', entityId: id, detail: { de: p.status, para: status, reason: reason || '' } });
  return get(db, id);
}

export function get(db, id) {
  return row(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

export function list(db, { limit = 100, status = null } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?').all(limit);
  return rows.map(row);
}

export function byLead(db, leadId) {
  return row(db.prepare('SELECT * FROM projects WHERE lead_id = ?').get(leadId));
}

/** Cria o projeto. Se já existir um para este lead, recusa em vez de duplicar. */
export function create(db, dataDir, { leadId = '', name, client = '', niche = '', city = '', kind = 'landing', stack = 'html', brief = '', goals = [], pages = [], features = [], acceptance = '', actor = 'dono' } = {}) {
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('o projeto precisa de um nome'), { status: 400 });
  if (!KINDS[kind]) throw Object.assign(new Error(`tipo de projeto desconhecido: ${kind} (há ${Object.keys(KINDS).join(', ')})`), { status: 400 });
  if (!STACKS.includes(stack)) throw Object.assign(new Error(`stack não suportada nesta versão: ${stack} (há ${STACKS.join(', ')})`), { status: 400 });
  if (leadId) {
    const existing = byLead(db, leadId);
    if (existing) throw Object.assign(new Error(`este lead já tem um projeto: «${existing.name}» (${existing.id})`), { status: 409 });
    const lead = getLead(db, leadId);
    if (!lead) throw Object.assign(new Error('lead não encontrado'), { status: 404 });
    client = client || lead.name;
    niche = niche || lead.category || '';
    city = city || lead.city || '';
  }
  const id = uid('p_');
  const slug = `${slugify(clean)}-${id.slice(-4)}`;
  const dir = path.join(dataDir, 'projetos', slug);
  fs.mkdirSync(dir, { recursive: true });
  const blueprint = KINDS[kind];
  const goalsList = listOf(goals).length ? listOf(goals) : ['A página explica o que o negócio faz', 'O visitante consegue falar num toque', 'O preço não é uma surpresa'];
  const created = now();
  db.prepare(`INSERT INTO projects (id, lead_id, name, client, niche, city, kind, stack, brief, goals, pages, features, acceptance, status, dir, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, leadId, clean, client, niche, city, kind, stack, String(brief || ''), JSON.stringify(goalsList),
      JSON.stringify(listOf(pages).length ? listOf(pages) : blueprint.pages),
      JSON.stringify(listOf(features).length ? listOf(features) : blueprint.features),
      JSON.stringify(listOf(acceptance).length ? listOf(acceptance) : blueprint.acceptance),
      'rascunho', dir, created, created);
  audit(db, { actor, action: 'projeto.criado', entity: 'projeto', entityId: id, detail: { name: clean, kind, leadId, dir } });
  return get(db, id);
}

/** Cria o projeto a partir de um lead, com o briefing já escrito a partir do que se sabe. */
export function fromLead(db, dataDir, leadId, { kind = 'landing', brief = '', actor = 'dono' } = {}) {
  const lead = getLead(db, leadId);
  if (!lead) throw Object.assign(new Error('lead não encontrado'), { status: 404 });
  const offer = offerOf(db);
  const d = dossier(db, lead);
  const facts = (d.evidence || []).map(e => e.label).slice(0, 4);
  const auto = [
    `${lead.name}${lead.city ? ', ' + lead.city : ''} — ${lead.category || 'negócio local'}.`,
    `O que se sabe: ${[lead.rating ? `${lead.rating} ★ (${lead.reviews || 0} opiniões)` : '', lead.website ? `site: ${lead.website}` : 'sem site próprio', facts.join('; ')].filter(Boolean).join(' · ')}.`,
    offer.preco_eur ? `Oferta: ${offer.nome || 'página'} por ${offer.preco_eur} €, entrega em ${offer.prazo_dias || '—'} dias.` : '',
  ].filter(Boolean).join(' ');
  return create(db, dataDir, {
    leadId, name: `${lead.name} — ${KINDS[kind].label}`, client: lead.name, niche: lead.category || '', city: lead.city || '',
    kind, brief: brief || auto, actor,
  });
}

/** Registo de execução: fica na fila (tabela jobs) como evidência, com duração e resultado. */
function recordRun(db, { kind, projectId, startedAt, ok, result, error = '' }) {
  const id = uid('j_');
  const at = now();
  db.prepare(`INSERT INTO jobs (id, kind, payload, status, attempts, max_attempts, run_at, started_at, finished_at, error, result, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, kind, JSON.stringify({ projectId }), ok ? 'feito' : 'falhou', 1, 1, startedAt, startedAt, at,
      String(error).slice(0, 500), JSON.stringify(result || {}).slice(0, 4000), startedAt);
  return id;
}

/** Gera os ficheiros no disco. Devolve o manifesto e o que foi escrito. */
export function generate(db, id, actor = 'dono') {
  const p = get(db, id);
  if (!p) throw Object.assign(new Error('projeto não encontrado'), { status: 404 });
  const startedAt = now();
  try {
    const offer = p.lead_id ? offerOf(db) : {};
    const { files, notes } = plan(p, offer);
    const manifest = writeFiles(p.dir, files);
    const bytes = Object.values(files).reduce((a, c) => a + Buffer.byteLength(c, 'utf8'), 0);
    const result = { files: Object.keys(files), bytes, notes, manifestKeys: Object.keys(manifest).length };
    const jobId = recordRun(db, { kind: 'projeto.gerar', projectId: id, startedAt, ok: true, result });
    // uma geração nova invalida a aprovação anterior: o que foi aprovado já não é o que está aqui
    db.prepare("UPDATE projects SET status='gerado', updated_at=? WHERE id=?").run(now(), id);
    audit(db, { actor, action: 'projeto.gerado', entity: 'projeto', entityId: id, detail: { ficheiros: result.files.length, bytes, jobId } });
    return { project: get(db, id), manifest, files: result.files, bytes, notes, jobId };
  } catch (e) {
    recordRun(db, { kind: 'projeto.gerar', projectId: id, startedAt, ok: false, error: e.message });
    audit(db, { actor, action: 'projeto.gerar_falhou', entity: 'projeto', entityId: id, detail: e.message });
    throw Object.assign(new Error(`a geração falhou: ${e.message}`), { status: 500 });
  }
}

/** Corre o QA, guarda o relatório e move o projeto para qa_passou/qa_falhou. */
export function qa(db, id, actor = 'dono') {
  const p = get(db, id);
  if (!p) throw Object.assign(new Error('projeto não encontrado'), { status: 404 });
  const startedAt = now();
  const report = auditDir(p.dir, { kind: p.kind });
  const runId = uid('qa_');
  db.prepare(`INSERT INTO qa_runs (id, at, project_id, total, critical, important, minor, passed, manifest, report)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(runId, report.at, id, report.total, report.critical, report.important, report.minor, report.passed ? 1 : 0,
      JSON.stringify(report.manifest), JSON.stringify(report.items));
  recordRun(db, {
    kind: 'projeto.qa', projectId: id, startedAt, ok: true,
    result: { runId, total: report.total, critical: report.critical, important: report.important, minor: report.minor, passed: report.passed },
  });
  const next = report.passed ? 'qa_passou' : 'qa_falhou';
  db.prepare('UPDATE projects SET status=?, updated_at=? WHERE id=?').run(next, now(), id);
  audit(db, { actor, action: 'projeto.qa', entity: 'projeto', entityId: id, detail: { runId, ...{ total: report.total, critical: report.critical, important: report.important, minor: report.minor, passed: report.passed } } });
  return { run: { id: runId, ...report, manifest: undefined }, project: get(db, id) };
}

export function lastQa(db, id) {
  const r = db.prepare('SELECT * FROM qa_runs WHERE project_id = ? ORDER BY at DESC, rowid DESC LIMIT 1').get(id);
  if (!r) return null;
  return { ...r, passed: !!r.passed, manifest: safe2(r.manifest), report: safe(r.report) };
}
const safe2 = v => { try { return JSON.parse(v || '{}'); } catch { return {}; } };

/** Aprovar: exige QA aprovado e ficheiros inalterados desde essa auditoria. */
export function approve(db, id, { actor = 'dono', note = '' } = {}) {
  const p = get(db, id);
  if (!p) throw Object.assign(new Error('projeto não encontrado'), { status: 404 });
  if (p.status === 'aprovado' || p.status === 'entregue') return { project: p, already: true };
  if (p.status !== 'qa_passou') {
    throw Object.assign(new Error(`só se aprova depois do QA passar (está «${p.status}»)`), { status: 409 });
  }
  const run = lastQa(db, id);
  if (!run || !run.passed) throw Object.assign(new Error('não há nenhuma auditoria aprovada para este projeto'), { status: 409 });
  const changed = changesSince(run.manifest, p.dir);
  if (changed.length) {
    throw Object.assign(new Error(`os ficheiros mudaram depois do QA (${changed.map(c => c.file).join(', ')}) — corre a auditoria outra vez`), { status: 409 });
  }
  setStatus(db, id, 'aprovado', actor, note);
  audit(db, { actor, action: 'projeto.aprovado', entity: 'projeto', entityId: id, detail: { qaRun: run.id, note } });
  return { project: get(db, id) };
}

/**
 * Entregar. `preview` é real: os ficheiros passam a ser servidos em /preview/<id>/.
 * `vercel` e `github` só avançam com credenciais configuradas — e dizem o que falta.
 */
export function deliver(db, id, { target = 'preview', actor = 'dono' } = {}) {
  const p = get(db, id);
  if (!p) throw Object.assign(new Error('projeto não encontrado'), { status: 404 });
  if (!['preview', 'vercel', 'github'].includes(target)) throw Object.assign(new Error(`destino desconhecido: ${target}`), { status: 400 });
  if (p.status !== 'aprovado' && p.status !== 'entregue') {
    throw Object.assign(new Error(`só se entrega um projeto aprovado (está «${p.status}»)`), { status: 409 });
  }
  const run = lastQa(db, id);
  if (!run || !run.passed) throw Object.assign(new Error('a entrega exige uma auditoria aprovada'), { status: 409 });
  const changed = changesSince(run.manifest, p.dir);
  if (changed.length) throw Object.assign(new Error(`entrega bloqueada: os ficheiros mudaram depois do QA (${changed.map(c => c.file).join(', ')})`), { status: 409 });

  const record = (status, url, detail) => {
    const rid = uid('d_');
    db.prepare('INSERT INTO deliveries (id, at, project_id, target, status, url, detail) VALUES (?,?,?,?,?,?,?)')
      .run(rid, now(), id, target, status, url || '', detail || '');
    return rid;
  };

  if (target === 'preview') {
    const url = `/preview/${id}/`;
    const rid = record('concluido', url, 'ficheiros servidos pelo próprio Órbita');
    db.prepare("UPDATE projects SET status='entregue', preview_url=?, updated_at=? WHERE id=?").run(url, now(), id);
    audit(db, { actor, action: 'projeto.entregue', entity: 'projeto', entityId: id, detail: { target, url, deliveryId: rid } });
    return { ok: true, url, target, project: get(db, id) };
  }

  if (target === 'vercel') {
    const hook = process.env.VERCEL_DEPLOY_HOOK || '';
    if (!hook) {
      record('recusado', '', 'falta VERCEL_DEPLOY_HOOK');
      throw Object.assign(new Error('Vercel não está configurado: falta VERCEL_DEPLOY_HOOK no .env (Project Settings → Git → Deploy Hooks). Sem isso não há deployment a pedir.'), { status: 409, missing: 'VERCEL_DEPLOY_HOOK' });
    }
    record('pedido', '', 'deploy hook disparado; falta confirmar o estado na Vercel');
    audit(db, { actor, action: 'projeto.deploy_pedido', entity: 'projeto', entityId: id, detail: { target: 'vercel' } });
    return { ok: false, pending: true, target, note: 'Pedido de deployment registado. Confirmar na Vercel — pedir não é estar publicado.' };
  }

  if (!process.env.GITHUB_TOKEN) {
    record('recusado', '', 'falta GITHUB_TOKEN');
    throw Object.assign(new Error('GitHub não está configurado: falta GITHUB_TOKEN no .env (fine-grained, Contents: write no repositório alvo).'), { status: 409, missing: 'GITHUB_TOKEN' });
  }
  record('pedido', '', 'token presente; envio de ficheiros não implementado nesta versão');
  return { ok: false, pending: true, target, note: 'Token configurado, mas o envio de ficheiros para o GitHub ainda não está implementado nesta versão.' };
}

export function deliveries(db, id) {
  return db.prepare('SELECT * FROM deliveries WHERE project_id = ? ORDER BY at DESC').all(id);
}

/** Ficheiros atuais com tamanho e se mudaram desde o último QA. */
export function filesOf(db, id) {
  const p = get(db, id);
  if (!p) return [];
  const manifest = currentManifest(p.dir);
  const run = lastQa(db, id);
  return Object.entries(manifest).map(([file, hash]) => {
    let size = 0;
    try { size = fs.statSync(path.join(p.dir, file)).size; } catch { /* ficheiro removido */ }
    return { file, size, changed: !!(run && run.manifest?.[file] !== hash) };
  }).sort((a, b) => a.file.localeCompare(b.file));
}

export function detail(db, id) {
  const p = get(db, id);
  if (!p) return null;
  const run = lastQa(db, id);
  return {
    project: p,
    files: filesOf(db, id),
    qa: run,
    changes: run ? changesSince(run.manifest, p.dir) : [],
    deliveries: deliveries(db, id),
    lead: p.lead_id ? getLead(db, p.lead_id) : null,
    events: db.prepare("SELECT at, actor, action, detail FROM events WHERE entity = 'projeto' AND entity_id = ? ORDER BY id DESC LIMIT 30").all(id),
  };
}

/** Resumo para o topo da lista. */
export function summary(db) {
  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM projects GROUP BY status').all();
  const by = Object.fromEntries(counts.map(r => [r.status, r.n]));
  const total = counts.reduce((a, r) => a + r.n, 0);
  const entregues = by.entregue || 0;
  return { total, porEstado: by, entregues, aprovados: by.aprovado || 0, emQa: (by.qa_passou || 0) + (by.qa_falhou || 0), rascunhos: by.rascunho || 0 };
}
