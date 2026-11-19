// Órbita — the roster (Beta). Who sits where is fixed (six pods, one seat per agent in
// src/data.js — the number is never written by hand, it is AGENTS.length); what each
// agent is called, does and uses is yours to change in office.agents.local.json (or the brain).
// office.agents.json holds the defaults, one entry per seat.
//   built-in defaults  ← office.agents.json  ← <brain>/Órbita/agents.json  ← office.agents.local.json (gitignored)
// Departments, leads and seats cannot be changed from these files; the office ignores such
// edits and says so. `brief` is the owner's standing instructions to that agent (multi-line),
// read before every task. Skills — how a kind of work is done — live beside the agents in
// skills.mjs. See CLAUDE.md for how to change agents with Claude Code.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadConfig } from './config.mjs';
import { AGENTS, DEPTS } from './src/data.js';
import { IDENTITY } from './src/agentes.js';

export const FILE = path.join(ROOT, 'office.agents.json');
export const LOCAL = path.join(ROOT, 'office.agents.local.json');
export const brainFile = brainPath => path.join(brainPath, 'Órbita', 'agents.json');
/* O número de lugares vem do elenco real (src/data.js). Não se escreve à mão: quando um
   lugar entra ou sai, as mensagens e os testes acompanham sozinhos. */
export const LUGARES = AGENTS.length;
const EDITABLE = ['name', 'role', 'does', 'tools', 'brief', 'model', 'effort'];
const BRIEF_MAX = 2000;
const MODELS = ['sonnet', 'opus', 'fable']; // V3.6: an agent's model, by name; empty = the office default
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']; // V3.6.1: an agent's effort; empty = the office's, then the model's own

export function defaults() {
  return AGENTS.map(a => { const p = IDENTITY[a.id] || {}; return { id: a.id, department: a.dept, lead: !!a.lead, name: a.name, role: p.role || '', does: p.does || '', tools: [], brief: '', model: '', effort: '' }; });
}
// returns { agents, problems } — problems are human sentences, never thrown
export function validate(doc, base = defaults()) {
  const problems = [];
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.agents) ? doc.agents : null;
  if (!list) return { agents: base, problems: ['o ficheiro tem de ser {"agents": [...]}'] };
  const out = base.map(a => ({ ...a, tools: [...a.tools] }));
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object' || !e.id) { problems.push('uma entrada não tem "id" — skipped'); continue; }
    const a = out.find(x => x.id === e.id);
    if (!a) { problems.push(`"${e.id}" não é um dos ${LUGARES} lugares — ignorado (não se acrescentam agentes; renomeia um lugar)`); continue; }
    if (seen.has(e.id)) problems.push(`"${e.id}" aparece duas vezes — a última entrada ganha`);
    seen.add(e.id);
    if (e.department !== undefined && e.department !== a.department) problems.push(`"${e.id}": department cannot change (${a.department} → ${e.department}) — ignored`);
    if (e.lead !== undefined && !!e.lead !== a.lead) problems.push(`"${e.id}": lead cannot change — ignored`);
    for (const k of Object.keys(e)) if (!['id', 'department', 'lead', ...EDITABLE].includes(k)) problems.push(`"${e.id}": unknown field "${k}" — ignored`);
    if (e.name !== undefined) { const n = String(e.name).trim(); if (!n) problems.push(`"${e.id}": empty name — kept "${a.name}"`); else a.name = n.slice(0, 32).toUpperCase(); }
    if (e.role !== undefined) a.role = String(e.role).trim().slice(0, 80);
    if (e.does !== undefined) a.does = String(e.does).trim().slice(0, 400);
    if (e.tools !== undefined) { if (!Array.isArray(e.tools)) problems.push(`"${e.id}": tools tem de ser uma lista — ignorado`); else a.tools = e.tools.map(String).map(s => s.trim()).filter(Boolean).slice(0, 12); }
    if (e.model !== undefined) { // V3.6: sonnet · opus · fable, or empty for the office default
      const m = String(e.model || '').toLowerCase().trim();
      if (!m) a.model = ''; else if (MODELS.includes(m)) a.model = m; else problems.push(`"${e.id}": model must be sonnet, opus or fable (got "${e.model}") — kept ${a.model || 'the office default'}`);
    }
    if (e.effort !== undefined) { // V3.6.1: low · medium · high · xhigh · max, or empty
      const v = String(e.effort || '').toLowerCase().trim();
      if (!v) a.effort = ''; else if (EFFORTS.includes(v)) a.effort = v; else problems.push(`"${e.id}": effort must be low, medium, high, xhigh or max (got "${e.effort}") — kept ${a.effort || 'the default'}`);
    }
    if (e.brief !== undefined) { // a string, or a list of lines
      const b = (Array.isArray(e.brief) ? e.brief.map(String).join('\n') : String(e.brief)).trim();
      if (b.length > BRIEF_MAX) problems.push(`"${e.id}": brief is over ${BRIEF_MAX} caracteres — cortado (põe a versão longa numa competência)`);
      a.brief = b.slice(0, BRIEF_MAX);
    }
  }
  return { agents: out, problems };
}
function read(p) { if (!fs.existsSync(p)) return null; try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { __error: e.message }; } }
/* A ordem de precedência é a da lista: cada fonte corrige a anterior, a última ganha.
   Recebe as fontes como argumento para que o teste a possa exercer com ficheiros temporários. */
export function montarPlantel(fontes, base = defaults()) {
  let agents = base; const problems = []; const files = [];
  for (const { path: p, label } of fontes) {
    if (!fs.existsSync(p)) continue;
    files.push(label);
    const doc = read(p); if (!doc) continue;
    if (doc.__error) { problems.push(`${label}: não é JSON válido (${doc.__error.split('\n')[0]}) — ignored`); continue; }
    const r = validate(doc, agents); agents = r.agents; problems.push(...r.problems.map(x => `${label}: ${x}`));
  }
  return { agents, problems, files };
}
export function loadRoster(brainPath = loadConfig().brainPath) {
  const fontes = [
    { path: FILE, label: 'office.agents.json' },
    { path: brainFile(brainPath), label: 'brain/Órbita/agents.json' },
    { path: LOCAL, label: 'office.agents.local.json' },
  ];
  const { agents, problems, files } = montarPlantel(fontes);
  /* «personalizado» = qualquer campo que difere do valor por omissão. Conta também tools,
     model e effort (antes só contava name, role, does e brief). */
  const D = defaults();
  const customised = agents.filter((a, i) => {
    const d = D[i];
    return a.name !== d.name || a.role !== d.role || a.does !== d.does || !!a.brief
      || JSON.stringify(a.tools) !== JSON.stringify(d.tools) || a.model !== d.model || a.effort !== d.effort;
  }).length;
  return { agents, problems, customised, briefed: agents.filter(a => a.brief).length, files };
}
export const deptName = k => DEPTS[k]?.name || k;
