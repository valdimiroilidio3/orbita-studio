// Órbita — the local server (Beta).
// Serves the office and makes it real on your own Claude login:
//   · the command bar routes a typed task through Claude to the right agent in the department
//   · the agent produces the deliverable, which is saved as a note in your brain folder
//   · the Brain is your vault's real wiki-link graph, rebuilt live as notes are written
//   · chat with any agent is a real conversation in that agent's persona, grounded in your notes
// Everything stays on this machine: data/tasks.json and <brain>/Órbita/*.md.
//
//   npm start                 → http://localhost:4520
//   PORT=4600 npm start       → another port
//
// Claude backend: the Claude Code CLI (`claude -p`, your existing login) — or the official SDK
// if ANTHROPIC_API_KEY is set. AO_MODEL=<model> overrides the model.
//
// V3.1: the connectors are real — the MCP servers your Claude Code is connected to are what the
// top bar shows and what the agents can call (mcp.mjs); the roster is yours (office.agents.json,
// roster.mjs). Tool calls only happen on the CLI backend: the SDK path has no MCP servers.
// V3.2: how the work is done is yours too — each agent's `brief` (roster.mjs) and the skills
// bound to it (skills.mjs: skills/ + <brain>/Órbita/skills/) go into every task and chat.
// V3.3: the agents learn — every "revise: …" is recorded and standing rules come back into the
// prompt (learn.mjs); a department lead interviews the owner in chat and writes the briefs and a
// skill for its team (onboard.mjs). Roster, skills and lessons are re-read before every task.
// V3.5: routines — the office keeps its own clock (routines.mjs + src/when.js). A routine in
// <brain>/Órbita/routines.json fires at its minute whether or not the page is open; the
// server creates the task, runs it here, and a result that needs the owner's OK waits in
// WAITING ON APPROVAL until /approve (the agent then does the outbound step) or /reject (with a
// note, which the agent learns from). Emails, Accounting and Sales only in this release.
// V3.2 (16 Sep): AGENT TEAMS + CLAUDE IN CHROME. A team task (TEAM in the bar, "as a team" in the sentence,
// `team: true` on a routine) goes to the department lead, who plans the pieces; the office runs one
// Claude process per teammate at the same time (teams.mjs, pool of `teams.max`), keeps the shared
// piece list and the notes they leave each other on the task (`task.team`, polled by the page), and
// the lead writes the finished deliverable from the pieces. Every `claude -p` gets --chrome when
// `tools.browser` is on: the agents can drive the owner's own Chrome (mcp.mjs).
// V3.2.1: the CALENDAR (P). A task can be scheduled for a date (`at` on POST /api/tasks → state
// 'scheduled', `dueAt`; the clock below fires it, marked LATE if the office was off) and a routine
// can start from a date (`when.start`, src/when.js). Cancel = DELETE /api/tasks/:id.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig, ROOT } from './config.mjs';
import { layoutGraph, readVault, readOfficeNotes } from './graph-build.mjs';
import { DEPTS, DEPT_KEYS } from './src/data.js';
import * as mcp from './mcp.mjs';
import { loadRoster } from './roster.mjs';
import { loadSkills } from './skills.mjs';
import * as learn from './learn.mjs';
import * as onboard from './onboard.mjs';
import * as routines from './routines.mjs';
import * as usage from './usage.mjs';
import * as teams from './teams.mjs';
import { createPlatform, ensureApiToken } from './platform.mjs'; // 28 out 2026: as APIs reais, a máquina, e o arranque sem passos manuais
import * as integrations from './integrations.mjs'; // 26 out 2026: a ponte para fora (OSM, Gemini, Resend, GitHub, Instagram, Vercel)
import * as ai from './providers.mjs'; // 25 out 2026: Claude Code · Codex · Gemini · APIs compatíveis
import { fmtTime, fmtDateTime, fmtDateTimeLong } from './src/time.js'; // 24 horas, num sítio só
import * as google from './google.mjs'; // 25 out 2026: pesquisa real — Places (leads) e Programmable Search (contexto)
import * as pesquisa from './api/_pesquisa.mjs'; // 27 out 2026 (1.25.0): Geoapify (leads) e Tavily (contexto), as mesmas do servidor
import * as ops from './src/ops/index.mjs';
import { createForge } from './forge/index.mjs';      // 27 out 2026: a oficina de ferramentas dos agentes
import { createBus } from './forge/bus.mjs';
import {
  createLimiter, authorized, adminMode, csrfOk,
  authenticate, sessionCookie, clearSessionCookie, sessionToken, wantsSecureCookie, SESSION_COOKIE,
} from './src/ops/guard.mjs';
import * as auth from './src/ops/auth.mjs';
import { zipBuffer } from './src/ops/zip.mjs'; // 26 out 2026: SQLite, fila, funil, aprovação e auditoria
import { normModel, modelFor, modelArgs, modelId, modelName, MODEL_KEYS, DEFAULT_MODEL, normEffort, effortFor, effortName, EFFORT_KEYS } from './src/models.js';
import { parseWhen, describe, valid as validWhen, untilText } from './src/when.js';

const cfg = loadConfig();
// O bundle é gerado por build.mjs e vem commitado, mas `dist/` não sobrevive a todas as cópias do
// repositório (é um directório de artefactos). Se faltar, constrói-se UMA vez no arranque — assim o
// `npm start` num clone limpo abre o escritório em vez de rebentar na primeira visita a `/`.
function ensureBundle() {
  const out = path.join(ROOT, 'dist', 'command-centre-v2.html');
  if (fs.existsSync(out) && fs.existsSync(path.join(ROOT, 'dist', 'mesa.html'))) return;
  console.log('  bundle ausente: a construir (node build.mjs)…');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) console.error('  aviso: a construção falhou — / e /app vão responder 503 até `npm run build`.');
}
ensureBundle();
const HTML = path.join(ROOT, 'dist', 'command-centre-v2.html'); // built by build.mjs; shipped so npm start works without a build
const MESA = path.join(ROOT, 'dist', 'mesa.html'); // a mesa de trabalho: Hoje, leads, aprovação, conversas, saldo
const DATA = process.env.ORBITA_DATA_DIR ? path.resolve(process.env.ORBITA_DATA_DIR) : path.join(ROOT, 'data'); // 26 out 2026: os dados podem viver fora do repo (testes, alojamentos)

// ---------- operação a sério (26 out 2026) ----------
// SQLite: leads, mensagens, fila, eventos e consumo das APIs. Sem estado escondido em memória.
//
// 27 out 2026 · modo agência: cada cliente tem o SEU ficheiro de base de dados, numa pasta sua.
// O registo dos clientes vive em data/clientes.db e o espaço activo nas definições. Um dono, um
// ecrã, um negócio de cada vez — trocar de cliente é fechar uma ligação e abrir outra.
const REG = (() => {
  try { return ops.tenants.openRegistry(DATA); }
  catch (e) { console.warn(`  registo de clientes indisponível: ${e.message}`); return null; }
})();
let OPS = null;
function openOpsFor(cliente) {
  const dir = cliente ? cliente.pasta : DATA;
  const db = cliente ? cliente.dbFile : undefined; // sem cliente, a base é a de sempre
  try {
    return ops.openOps({ dataDir: dir, dbFile: db, concurrency: 2, pollMs: 2000 });
  } catch (e) { console.warn(`  operação indisponível: ${e.message}`); return null; }
}
OPS = openOpsFor(REG ? ops.tenants.active(REG) : null);
function switchClient(id) {
  if (!REG) throw new Error('não há registo de clientes nesta instalação');
  const cliente = ops.tenants.setActive(REG, id);
  const before = OPS;
  OPS = openOpsFor(cliente);
  if (!OPS) { OPS = before; throw new Error('não consegui abrir a base deste cliente'); }
  try { before?.close(); } catch { /* já fechada */ }
  globalThis.__orbitaDeliver = deliverOut;
  return cliente;
}
// Como é que uma mensagem aprovada sai. Uma só função para os dois caminhos (o envio imediato e
// o outbox a drenar sozinho), a receber o item do outbox: email pelo Resend, WhatsApp por link.
const deliverOut = async (item) => {
  const msg = OPS && OPS.messages.getMessage(OPS.db, item.message_id);
  if (!msg) throw new Error('a mensagem deste envio já não existe');
  const lead = OPS.leads.getLead(OPS.db, msg.lead_id);
  if (!lead) throw new Error('o lead desta mensagem já não existe');
  if (item.channel === 'whatsapp') {
    const link = integrations.whatsappClickToChatUrl(lead.phone, msg.body);
    return { doesNotSend: true, url: link.url, note: 'link wa.me pronto — o dono revê e envia no WhatsApp' };
  }
  if (lead.consent !== 'dado') {
    throw new Error('sem consentimento registado para email — regista com POST /api/ops/leads/:id/consent antes de enviar');
  }
  return integrations.sendApprovedEmail(DATA, {
    approved: true, recipientConsent: true, consentReference: `ops:${lead.id}:${msg.approved_at || ''}`,
    purpose: 'requested_follow_up', to: lead.email, subject: msg.subject || 'Sem assunto', text: msg.body,
  });
};
const FILE = path.join(DATA, 'tasks.json');
const BRAIN = cfg.brainPath;
const NOTES_DIR = path.join(BRAIN, 'Órbita');
const CLI_CWD = path.join(os.tmpdir(), 'agents-office-cli'); // an empty cwd: no CLAUDE.md, no repo context
const CLI_MCP_CONFIG = path.join(CLI_CWD, 'orbita-mcp.json');
// The CLI runs in an empty cwd (no CLAUDE.md, no repo), so the project's .mcp.json never loads.
// Write a standalone copy with an absolute path to the integrations server instead.
function ensureCliMcpConfig() {
  const projectConfig = path.join(ROOT, '.mcp.json');
  if (!fs.existsSync(projectConfig)) return null;
  try {
    const servers = JSON.parse(fs.readFileSync(projectConfig, 'utf8')).mcpServers || {};
    if (!servers.orbita_integrations) return null;
    const standalone = { mcpServers: { orbita_integrations: {
      type: 'stdio', command: process.execPath,
      args: [path.join(ROOT, 'mcp-servers', 'orbita-integrations', 'index.mjs')],
    } } };
    fs.mkdirSync(CLI_CWD, { recursive: true });
    fs.writeFileSync(CLI_MCP_CONFIG, JSON.stringify(standalone, null, 2), { mode: 0o600 });
    return CLI_MCP_CONFIG;
  } catch (error) {
    console.warn(`config MCP do Órbita indisponível: ${error.message}`);
    return null;
  }
}
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
const RUN_TIMEOUT = Math.max(60, +cfg.timeout || 300) * 1000; // agents with tools take longer than a plain draft
{ const m = normModel(cfg.model); if (cfg.model && !m) console.warn(`config: o modelo tem de ser sonnet, opus ou fable (recebi "${cfg.model}") — a usar ${DEFAULT_MODEL}`); cfg.model = m || DEFAULT_MODEL; } // V3.6: three models, by name
{ const e = normEffort(cfg.effort); if (cfg.effort && !e) console.warn(`config: o esforço tem de ser low, medium, high, xhigh ou max (recebi "${cfg.effort}") — a usar o do modelo`); cfg.effort = e || ''; } // V3.6.1: the office's effort, empty = the model's own
mcp.configure(cfg);
mcp.useConfig(ensureCliMcpConfig()); // se o .mcp.json do projeto existir, os agentes recebem-no como --mcp-config
const TEAMS = teams.settings(cfg); // V3.2 (16 Sep): { enabled, max }
const roster = loadRoster(BRAIN);
const AGENTS = roster.agents; // id · department · lead · name · role · does · tools · brief
/* ---------- A OFICINA (27 out 2026) ----------
   Cada agente pode forjar uma ferramenta própria. A oficina grava-a em data/forge, prova-a contra
   os dados reais desta máquina, e tudo o que faz sai em eventos — os mesmos que o terminal do
   browser (`F`) e o `node tools/forge.mjs watch` mostram. Se apareceu no terminal, aconteceu. */
const forgeBus = createBus({ file: path.join(DATA, 'forge', 'log.ndjson') });
const FORGE = createForge({
  root: path.join(DATA, 'forge'),
  brainDir: BRAIN, dataDir: DATA, docsDir: path.join(ROOT, 'docs'),
  rooms: DEPT_KEYS, agents: AGENTS.map(a => a.id), bus: forgeBus,
});
// para o ao vivo: nome, função e departamento de cada posto vêm da mesma lista que a cena usa
const ROSTER = Object.fromEntries(AGENTS.map(a => [a.id, { name: a.name, role: a.role, dept: a.department }]));
for (const w of roster.problems) console.warn('agents:', w);
let skills = loadSkills(BRAIN, AGENTS); // reloaded before every task and chat, so a new skill needs no restart
for (const w of skills.problems) console.warn('skills:', w);
// the roster's editable fields are re-read too (a brief written by the lead's interview, or by hand, lands without a restart)
function reloadRoster() {
  const r = loadRoster(BRAIN);
  for (const a of r.agents) { const cur = AGENTS.find(x => x.id === a.id); if (cur) Object.assign(cur, { name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief }); }
  if (r.problems.join() !== roster.problems.join()) for (const w of r.problems) console.warn('agents:', w);
  Object.assign(roster, { problems: r.problems, customised: r.customised, briefed: r.briefed, files: r.files });
}
const refreshSkills = () => { reloadRoster(); const s = loadSkills(BRAIN, AGENTS); if (s.problems.join() !== skills.problems.join()) for (const w of s.problems) console.warn('skills:', w); skills = s; return s; };
const leadOf = dept => AGENTS.find(a => a.department === dept && a.lead) || AGENTS.find(a => a.department === dept);
const setupMap = () => Object.fromEntries(DEPT_KEYS.map(k => [k, onboard.isSetUp(AGENTS, skills, k)]));

/* ---------- o motor de IA (providers.mjs) ----------
   O escritório já não está preso ao Claude Code: resolve() escolhe, por ordem, o primeiro motor
   que está realmente utilizável nesta máquina — CLI no PATH ou chave no ambiente. A escolha do
   proprietário (office.config.json → ai, AO_AI, ou data/ai.json) ganha; o resto é failover. */
let AI = ai.resolve(cfg, DATA);
await ai.probe(AI, 900); // os servidores locais (Ollama, LM Studio) só contam se responderem
let runner = null, backend = AI.active?.id || 'nenhum';

/* ---------- storage ---------- */
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const save = list => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2)); };
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* ---------- the usage gauge (V3.6, A3): Claude's own numbers, the office's count underneath ---------- */
const USTATE = usage.loadState(DATA);
let usageCache = { at: 0, value: null, stale: true };
async function getUsage(force) {
  if (!force && !usageCache.stale && usageCache.value && Date.now() - usageCache.at < 60000) return usageCache.value;
  const u = await usage.fetchUsage();
  const v = u.ok ? { ...u, office: usage.fallback(USTATE).window } : { ...usage.fallback(USTATE), reason: u.reason };
  usageCache = { at: Date.now(), value: v, stale: false };
  return v;
}
function bumpUsage(u) { if (!u) return; Object.assign(USTATE, usage.record(USTATE, u)); usage.saveState(DATA, USTATE); usageCache.stale = true; }
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ---------- ask Claude ---------- */
// askX → { text, tools }: tools = the MCP/web tools the agent actually called (for the office to
// light up). On the CLI the agent gets --allowedTools = every connected server the config allows
// (+ web); file tools, Bash and sub-agents stay off — the office is not a coding session.
// the model the agent's turn ran on: a --chrome run (V3.2 (16 Sep)) also reports a small Haiku helper call in modelUsage, so the first key is not the answer —
// prefer the key of the family we asked for, else the biggest non-Haiku talker
function ranOn(mu, want) {
  const keys = Object.keys(mu || {}); if (!keys.length) return null;
  const fam = normModel(want) || cfg.model;
  return keys.find(k => k.includes(fam)) || keys.filter(k => !/haiku/.test(k)).sort((a, b) => (mu[b].outputTokens || 0) - (mu[a].outputTokens || 0))[0] || keys[0];
}
/** O Claude Code, com tudo o que já sabia fazer (ferramentas MCP, Chrome, modelo e esforço). */
function askClaudeCli(d, { system, user, maxTokens = 4000, tools = true, timeout = RUN_TIMEOUT, model = cfg.model, effort = null }) {
  return ai.askClaudeCli(d, { system, user, maxTokens, tools, timeout, model, effort }, {
    allowedTools: mcp.allowedTools, modelArgs, ranOn, cliArgs: mcp.cliArgs, fromInit: mcp.fromInit,
  });
}

function buildRunner() {
  runner = ai.makeRunner(AI.active, cfg, { askClaudeCli });
  backend = AI.active?.id || 'nenhum';
  return runner;
}
buildRunner();

// Troca de motor a quente: só aceita um motor que exista e responda; guarda a escolha em
// data/ai.json (o sítio que ganha ao office.config.json) e reconstrói o runner sem reiniciar.
async function switchProvider(id) {
  if (!ai.IDS.includes(id)) return { error: `não conheço o motor "${id}" — os que existem: ${ai.IDS.join(', ')}` };
  const next = ai.resolve({ ...cfg, ai: { ...(cfg.ai || {}), provider: id } }, DATA);
  await ai.probe(next, 900);
  const target = next.candidates.find(c => c.id === id);
  if (!target) return { error: `não conheço o motor "${id}"`, known: ai.IDS };
  if (!target.available) return { error: target.reason, refused: true, provider: id };
  AI = next; buildRunner();
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'ai.json'), JSON.stringify({ provider: id, at: new Date().toISOString() }, null, 2));
  } catch (e) { return { warning: 'motor trocado, mas não consegui gravar data/ai.json: ' + e.message, active: describeAi() }; }
  console.log(`  ia: motor trocado para ${target.label} (${id})`);
  return { ok: true, active: describeAi() };
}
function describeAi() {
  const a = AI.active;
  return a ? { id: a.id, label: a.label, model: a.model, tools: !!a.tools } : null;
}

// askX → { text, tools }: tools = as ferramentas que o agente realmente chamou (só no CLI do
// Claude). Nos outros motores o texto é a resposta e as ferramentas ficam vazias — é a diferença
// honesta entre um agente com mãos e um modelo que escreve.
async function askX(system, user, { maxTokens = 4000, tools = true, timeout = RUN_TIMEOUT, model = cfg.model, effort = null } = {}) {
  if (!runner) throw new Error('Nenhum motor de IA disponível — vê GET /api/ai');
  const res = await runner.askX({ system, user, maxTokens, tools, timeout, model, effort });
  if (res?.usage) bumpUsage(res.usage);
  return res;
}
const ask = async (system, user, opts) => (await askX(system, user, { tools: false, ...opts })).text;
function parseJSON(text, what = 'a resposta') {
  const s = String(text ?? '').replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error(`${runner?.label || 'o motor'} não devolveu ${what} em JSON — respondeu: "${s.trim().slice(0, 120) || '(vazio)'}"`);
  try { return JSON.parse(s.slice(a, b + 1)); }
  catch (e) { throw new Error(`${runner?.label || 'o motor'} devolveu JSON inválido em ${what} (${e.message}) — respondeu: "${s.trim().slice(0, 120)}"`); }
}

/* ---------- the brain: graph + context ---------- */
let graph = { notes: 0, nodes: [], links: [], floor: [] };
async function rebuildGraph() {
  try { graph = await layoutGraph(BRAIN); } catch (e) { console.warn('brain graph failed:', e.message); }
  return graph;
}
function vaultIndex() { // name → text (vault notes + live office notes)
  const { notes } = readVault(BRAIN); const m = new Map();
  for (const [name, n] of notes) m.set(name, n.text);
  for (const n of readOfficeNotes(BRAIN)) m.set(n.name, n.text);
  return m;
}
// V4 (25 out 2026): os agentes de Prospeção e Vendas leem os leads reais encontrados no Google.
// Só nesses dois departamentos — não faz sentido pôr uma lista de empresas à frente do designer.
function leadBlock(a) {
  if (!['sales', 'ops'].includes(a.department)) return '';
  try {
    const block = google.contextForAgent({ dir: DATA, limit: 8 });
    return block ? `\n\n${block}` : '';
  } catch (e) { return `\n\n(A lista de leads não pôde ser lida: ${e.message})`; }
}
function businessContext(index) {
  const bits = [];
  for (const k of ['CLAUDE', 'index', 'business-model', 'voice']) if (index.has(k)) bits.push(`--- ${k}.md ---\n${index.get(k).slice(0, 1200)}`);
  return bits.join('\n\n');
}
// the notes an agent would read for this task: name/word overlap, department MOC first
function relevantNotes(index, dept, text, n = 4) {
  const words = new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  const mocName = { emails: 'MOC-Emails', sales: 'MOC-Sales', marketing: 'MOC-Marketing', ops: 'MOC-Operations', fin: 'MOC-Finance', delivery: 'MOC-Delivery' }[dept];
  const scored = [];
  for (const [name, txt] of index) {
    if (['CLAUDE', 'index', 'log'].includes(name)) continue;
    const hay = (name + ' ' + txt.slice(0, 1500)).toLowerCase();
    let s = 0; for (const w of words) if (hay.includes(w)) s += name.toLowerCase().includes(w) ? 3 : 1;
    if (name === mocName) s += 2;
    if (s) scored.push([s, name]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const picks = scored.slice(0, n).map(x => x[1]);
  if (mocName && index.has(mocName) && !picks.includes(mocName)) picks.push(mocName);
  return picks;
}
function contextText(index, names) {
  return names.map(n => `--- ${n}.md ---\n${(index.get(n) || '').slice(0, 1800)}`).join('\n\n');
}

/* ---------- the roster, as Claude sees it ---------- */
const persona = a => `${a.name}${a.lead ? ' (líder)' : ''} · ${a.role} · ${a.does}`;
function rosterText(dept) { return AGENTS.filter(a => a.department === dept).map(a => { const sk = skills.names(a); return `- ${a.id} · ${persona(a)}${sk.length ? ' · competências: ' + sk.join(', ') : ''}`; }).join('\n'); }
// what an agent is told about itself: the job, the owner's standing instructions, the skills it follows
function agentBrief(a) {
  const lessons = learn.promptText(BRAIN, a);
  return (a.brief ? `
INSTRUÇÕES PERMANENTES DO PROPRIETÁRIO
${a.brief}
` : '') + (skills.promptText(a) ? `\n${skills.promptText(a)}\n` : '') + (lessons ? `\n${lessons}\n` : '');
}
const toolKeys = names => [...new Set(names.map(n => /^mcp__/.test(n) ? mcp.keyOf(n) : n === 'WebSearch' || n === 'WebFetch' ? 'web' : null).filter(Boolean))];
async function route(dept, text) {
  const d = DEPTS[dept]; refreshSkills();
  const system = `És o encaminhador de ${cfg.name}, um negócio cujos departamentos são geridos por agentes de IA.` +
    'Escolhe o único melhor agente para o pedido do proprietário — um agente cujas competências correspondem ao pedido é o certo — e devolve APENAS um objeto JSON — sem prosa, sem blocos de código.';
  const user = `Departamento: ${d.name}
Agentes (id · nome · função · o que fazem):
${rosterText(dept)}

Pedido do proprietário: "${text}"

` +
    'Devolve: {"agent":"<id da lista>","title":"<título de tarefa imperativo e limpo, máx. 70 caracteres>","plan":["<passo>","<passo>","<passo>"],"eta_minutes":<inteiro>,"why":"<uma frase curta>","needs_ok":<true se isto implicar enviar, publicar, pagar, apagar ou alterar algo fora desta máquina; false se só ler e relatar>}';
  const j = parseJSON(await ask(system, user, { maxTokens: 800, timeout: 150000, model: 'sonnet' }), 'o encaminhamento'); // routing is a one-line JSON job: always Sonnet
  const valid = AGENTS.find(a => a.id === j.agent && a.department === dept);
  const agent = valid ? valid.id : (AGENTS.find(a => a.department === dept && a.lead) || AGENTS.find(a => a.department === dept)).id;
  return { agent, title: String(j.title || text).slice(0, 90), plan: Array.isArray(j.plan) ? j.plan.slice(0, 4).map(String) : [],
    eta: Number.isFinite(j.eta_minutes) ? j.eta_minutes : 30, why: String(j.why || ''), needsOk: typeof j.needs_ok === 'boolean' ? j.needs_ok : routines.guessNeedsOk(text) };
}
// the system prompt every agent run starts from: who it is, its brief, skills and lessons, its tools, the company, the notes for this task
function agentSystem(a, index, read, { extra = '', words = 260 } = {}) {
  const d = DEPTS[a.department];
  return `És ${a.name}, ${a.role || 'um agente'}, no departamento ${d.name} de ${cfg.name}. ${a.does}\n${agentBrief(a)}` + (extra ? `\n${extra}\n` : '') +
    'Escreve o próprio trabalho final, não uma descrição do que farias. Texto simples: um título curto e depois secções curtas ou tópicos. ' +
    `No máximo ${words} palavras, salvo se uma competência ou as instruções do proprietário definirem outra forma — essas ganham. Sem preâmbulo, sem despedida. Fundamenta no contexto da empresa abaixo; onde faltar um facto, assume algo razoável e marca (assumido).` +
    'Se usaste uma ferramenta, di-lo numa linha no fim ("Usado: Gmail — procurei a conversa com o cliente").\n\n' +
    `${mcp.promptText(a.tools)}${(() => { const t = FORGE.promptText(a.department); return t ? '\n\n' + t : ''; })()}\n\nNOTAS DA EMPRESA\n${businessContext(index)}${leadBlock(a)}\n\nNOTAS QUE LESTE PARA ESTA TAREFA\n${contextText(index, read)}`;
}
const modeLineFor = (mode, task) => mode === 'draft' ? '\nPrepara tudo, mas envia, publica, paga ou altera NADA fora desta máquina: o proprietário lê isto primeiro e aprova. Termina com uma linha a dizer exatamente o que vai sair quando for aprovado (ou que nada tem de sair).'
  : mode === 'approve' ? `
O proprietário APROVOU o rascunho abaixo. Faz agora o passo de saída, exatamente como está escrito, com as tuas ferramentas (enviar, publicar, atualizar). Se te faltar uma ferramenta, di-lo e mostra o que terias enviado. Depois relata numa secção curta: o que saiu, para quem e o que não saiu.
Rascunho aprovado:
${task.draft || task.result}` : '';
const pickFor = (task, a) => { // model + effort: four places, one precedence (task > routine > agent > office)
  const pick = modelFor({ task: task.model, routine: task.routineModel, agent: a.model, office: cfg.model });
  const eff = effortFor({ task: task.effort, routine: task.routineEffort, agent: a.effort, office: cfg.effort, model: pick.model });
  return { pick, eff };
};
// persist a task mid-run (a team's pieces move while the run is still going; the page polls /api/tasks)
function persist(task) { const l = load(); const i = l.findIndex(t => t.id === task.id); if (i >= 0) { l[i] = task; save(l); } }
async function run(task, feedback, mode) { // mode: undefined (a task from the bar) · 'routine' (read-only routine) · 'draft' (routine that waits for the OK) · 'approve' (the owner ticked it)
  if (task.team && TEAMS.enabled) { // V3.2 (16 Sep): a team task — the lead plans, the desks work at once, the lead writes the final
    if (mode === 'approve') return runTeamLead(task, feedback, mode); // the outbound step after the OK is the lead's alone
    if (feedback && task.team.pieces?.length) return runTeamLead(task, feedback, mode); // "revise: …" reworks the final from the same pieces
    return runTeam(task, mode);
  }
  const a = AGENTS.find(x => x.id === task.agent);
  refreshSkills();
  const index = vaultIndex();
  const read = relevantNotes(index, a.department, task.title + ' ' + task.text);
  const system = agentSystem(a, index, read);
  const routineLine = task.routine ? `\nIsto é uma rotina (${task.when}): corre no relógio do escritório e o proprietário não está ao teclado. Agora são ${fmtDateTimeLong()}${task.late ? `; esta execução está atrasada, era devida às ${fmtTime(task.due)}` : ''}. Faz o trabalho agora.`
    : task.dueAt ? `\nEsta tarefa foi agendada para ${fmtDateTimeLong(task.dueAt)} e está a correr agora; o proprietário não está ao teclado${task.late ? ' e esta execução está atrasada' : ''}. Faz o trabalho agora.` : '';
  const modeLine = modeLineFor(mode, task);
  const user = `Tarefa: ${task.title}\nPedido do proprietário: ${task.text}` + (task.plan?.length ? `\nPlano acordado: ${task.plan.join(' → ')}` : '') + routineLine + modeLine +
    (feedback && mode !== 'approve' ? `\n\nO proprietário reviu a tua versão anterior e pediu alterações: "${feedback}"\nVersão anterior:\n${task.result}` : '');
  const { pick, eff } = pickFor(task, a);
  // 27 out 2026: as ferramentas que esta sala já forjou correm ANTES de o agente escrever. O que
  // elas leram entra no prompt como dados, não como promessa: o agente escreve sobre números
  // reais (tarefas, notas, documentos) em vez de os inventar.
  const sensed = FORGE.sense({ room: a.department, limit: 3 });
  const senseBlock = sensed.filter(x => x.ok).map(x =>
    `--- ${x.id} · ${x.name} · ${x.ms} ms ---\n${JSON.stringify(x.result).slice(0, 900)}`).join('\n');
  const userFull = senseBlock ? `${user}\n\nDADOS DAS TUAS FERRAMENTAS (lidos agora, nesta máquina)\n${senseBlock}` : user;
  const { text, tools, modelId: ran } = await askX(system, userFull, { model: pick.model, effort: eff.effort });
  if (!text) throw new Error('O Claude não devolveu nada');
  // e se o agente pediu uma ferramenta que não tem (linha `FORGE: …`), a oficina forja-a já — uma
  // por tarefa, para que o terminal não seja um dilúvio e o catálogo não encha de duplicados.
  const forged = [];
  for (const need of FORGE.parseRequests(text).slice(0, 1)) {
    try {
      const made = FORGE.forge({ room: a.department, agent: a.id, need });
      if (made?.tool) forged.push(made.tool);
    } catch (e) { console.warn('oficina: ' + e.message); }
  }
  const result = forged.length
    ? `${text}\n\nOficina: forjei ${forged.map(t => `${t.id} v${t.version} (${t.state === 'active' ? 'activa' : 'em rascunho'}, ${t.examples} prova(s))`).join(' · ')} — está em data/forge/tools/${a.department}/.`
    : text;
  return { result, read, tools: toolKeys(tools), used: mcp.namesOf(tools), skills: skills.names(a), modelUsed: pick.model, modelFrom: pick.from, modelId: ran, effortUsed: eff.effort || '', effortFrom: eff.from };
}

/* ---------- V3.2 (16 Sep) Agent Teams: the lead plans, the desks work at once, the lead writes the final ---------- */
const nameOf = id => id === 'lead' ? 'o líder' : (AGENTS.find(a => a.id === id)?.name || id);
const routineLineFor = task => task.routine ? `\nIsto é uma rotina (${task.when}): corre no relógio do escritório e o proprietário não está ao teclado. Agora são ${fmtDateTimeLong()}. Faz o trabalho agora.`
  : task.dueAt ? `\nEsta tarefa foi agendada para ${fmtDateTimeLong(task.dueAt)} e está a correr agora; o proprietário não está ao teclado. Faz o trabalho agora.` : '';
async function runTeam(task, mode) {
  const lead = AGENTS.find(x => x.id === task.agent), dept = lead.department;
  refreshSkills();
  const index = vaultIndex();
  const seats = AGENTS.filter(a => a.department === dept).map(a => ({ id: a.id, lead: a.lead, name: a.name, role: a.role, does: a.does, skills: skills.names(a) }));
  const max = Math.min(TEAMS.max, teams.askedSize(task.text) || TEAMS.max);
  // 1. the plan — the lead splits the request across the desks (Sonnet, no tools: a JSON job)
  const pp = teams.planPrompt({ business: cfg.name, deptName: DEPTS[dept].name, lead, seats, text: task.text, title: task.title, max, notes: contextText(index, relevantNotes(index, dept, task.title + ' ' + task.text, 3)).slice(0, 4000) });
  let plan;
  try { plan = teams.parsePlan(await ask(pp.system, pp.user, { maxTokens: 1400, timeout: 150000, model: 'sonnet' }), { seats, lead, max, fallback: task }); }
  catch (e) { plan = { pieces: [{ agent: lead.id, title: task.title, text: task.text }], why: '', solo: true, error: e.message }; }
  task.team = { ...(task.team || {}), lead: lead.id, max, pieces: plan.pieces.map(p => ({ ...p, state: 'next' })), messages: [], why: plan.why, solo: plan.solo, plannedAt: Date.now() };
  persist(task);
  console.log(`  ⚑ ${task.id} equipa de ${plan.pieces.length}: ${plan.pieces.map(p => p.agent).join(' + ')}${plan.why ? ' — ' + plan.why : ''}`);
  // 2. the pieces — one Claude process per desk, at the same time (at most `max` in flight)
  const ids = task.team.pieces.map(p => p.agent);
  await teams.pool(task.team.pieces, max, async piece => {
    const a = AGENTS.find(x => x.id === piece.agent);
    piece.state = 'doing'; piece.startedAt = Date.now(); persist(task);
    try {
      const read = relevantNotes(index, dept, piece.title + ' ' + piece.text, 3);
      const system = agentSystem(a, index, read, { extra: teams.teamSection({ me: a, lead, pieces: task.team.pieces, nameOf }), words: 220 });
      const user = `Tarefa (o pedido completo, para contexto): ${task.title}\nPedido do proprietário: ${task.text}\n\nA TUA PARTE: ${piece.title}\n${piece.text}` + routineLineFor(task) + (mode === 'draft' ? modeLineFor('draft', task) : '');
      const { pick, eff } = pickFor(task, a);
      const { text, tools, modelId: ran } = await askX(system, user, { model: pick.model, effort: eff.effort });
      const { body, messages } = teams.parseMessages(text, ids);
      Object.assign(piece, { result: body || '(empty)', tools: toolKeys(tools), used: mcp.namesOf(tools), read, modelId: ran, error: !text });
      for (const m of messages) task.team.messages.push({ from: a.id, to: m.to === lead.id ? 'lead' : m.to, text: m.text, at: Date.now() });
    } catch (e) { Object.assign(piece, { result: 'Não foi possível concluir esta parte: ' + e.message, error: true }); }
    piece.state = 'done'; piece.doneAt = Date.now(); persist(task);
    console.log(`    ${piece.error ? '✗' : '✓'} ${a.name}: ${piece.title} (${(piece.result || '').length} chars${piece.tools?.length ? ', tools: ' + piece.tools.join(' ') : ''})`);
  });
  // 3. the final — the lead writes the deliverable from the pieces and the notes
  return runTeamLead(task, null, mode);
}
async function runTeamLead(task, feedback, mode) {
  const lead = AGENTS.find(x => x.id === task.agent), tm = task.team;
  refreshSkills();
  const index = vaultIndex();
  const read = relevantNotes(index, lead.department, task.title + ' ' + task.text);
  const system = agentSystem(lead, index, read, { extra: `EQUIPA\nTu lideras esta equipa. As partes abaixo foram feitas pelos teus colegas (uma pode ser a tua). Escreves o trabalho final a partir delas.`, words: 450 });
  const user = teams.synthPrompt({ task, pieces: tm.pieces || [], messages: tm.messages || [], nameOf, feedback: mode === 'approve' ? null : feedback }) + routineLineFor(task) + modeLineFor(mode, task);
  const { pick, eff } = pickFor(task, lead);
  const { text, tools, modelId: ran } = await askX(system, user, { model: pick.model, effort: eff.effort, maxTokens: 6000 });
  if (!text) throw new Error('O Claude não devolveu nada');
  const allTools = [...new Set([...(tm.pieces || []).flatMap(p => p.tools || []), ...toolKeys(tools)])];
  const allUsed = [...new Set([...(tm.pieces || []).flatMap(p => p.used || []), ...mcp.namesOf(tools)])];
  const allRead = [...new Set([...read, ...(tm.pieces || []).flatMap(p => p.read || [])])];
  return { result: text, read: allRead, tools: allTools, used: allUsed, skills: skills.names(lead), modelUsed: pick.model, modelFrom: pick.from, modelId: ran, effortUsed: eff.effort || '', effortFrom: eff.from, team: tm };
}
function writeNote(task) { // the deliverable becomes a note in the brain, linked to what was read
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const a = AGENTS.find(x => x.id === task.agent);
  const name = `${new Date(task.doneAt).toISOString().slice(0, 10)} ${slug(task.title)}`;
  const body = `---\nagent: ${a.name}\ndepartment: ${DEPTS[a.department].name}\ntask: ${task.id}\ndone: ${new Date(task.doneAt).toISOString()}${task.used?.length ? '\ntools: ' + task.used.join(', ') : ''}${task.skills?.length ? '\nskills: ' + task.skills.join(', ') : ''}${task.routine ? '\nroutine: ' + task.when + (task.late ? ' (late)' : '') : ''}${task.modelUsed ? '\nmodel: ' + modelName(task.modelUsed) + (task.modelFrom && task.modelFrom !== 'office' ? ' (' + task.modelFrom + ')' : '') : ''}${task.effortUsed ? '\neffort: ' + task.effortUsed + (task.effortFrom && task.effortFrom !== 'model' ? ' (' + task.effortFrom + ')' : '') : ''}${task.approved ? '\napproved: ' + new Date(task.approvedAt).toISOString() : ''}${task.team?.pieces?.length ? '\nteam: ' + task.team.pieces.map(p => nameOf(p.agent)).join(', ') : ''}\n---\n` +
    `# ${task.title}\n\n${task.result}\n\n---\nRead: ${(task.read || []).map(n => `[[${n}]]`).join(' · ') || '—'}\n` + teams.noteExtra(task.team, nameOf);
  fs.writeFileSync(path.join(NOTES_DIR, name + '.md'), body);
  return name;
}
/* ---------- o conversador (27 out 2026) ----------
   O compositor da página pode escolher o modelo e o esforço, pedir um plano em vez de trabalho
   feito, anexar ficheiros de texto e dizer que contexto quer. Nada disto é decorativo: cada
   campo muda o que o motor recebe, e o que ele recebeu volta na resposta (`model`, `effort`,
   `mode`, `context`) para a página poder mostrá-lo sem inventar. */
const CHAT_CONTEXT = {
  brain: { label: 'Cérebro', what: 'as notas da empresa (o vault do Órbita)' },
  docs: { label: 'Documentos', what: 'os documentos markdown do repositório (docs/)' },
};
const CHAT_FILE_MAX = 40000, CHAT_FILES_BUDGET = 60000, CHAT_FILES_MAX = 5;
function docsDir() { return path.join(ROOT, 'docs'); }
function docsList() {
  try { return fs.readdirSync(docsDir()).filter(f => f.endsWith('.md')).sort(); } catch { return []; }
}
function docsContext() { // first heading + first lines of each document: real words, never a summary invented here
  const names = docsList(); const out = [];
  let budget = 6000;
  for (const n of names) {
    if (budget <= 0) break;
    try {
      const txt = fs.readFileSync(path.join(docsDir(), n), 'utf8').slice(0, 600);
      const head = txt.split('\n').find(l => l.trim().startsWith('#')) || '';
      const body = txt.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).slice(0, 4).join(' ');
      const line = `- docs/${n}${head ? ' — ' + head.replace(/^#+\s*/, '').trim() : ''}${body ? ': ' + body.slice(0, 220).trim() : ''}`;
      out.push(line); budget -= line.length;
    } catch { out.push(`- docs/${n}`); }
  }
  return out.join('\n');
}
function chatFiles(files) {
  const list = (Array.isArray(files) ? files : []).slice(0, CHAT_FILES_MAX)
    .map(f => ({ name: String(f?.name || 'ficheiro').replace(/[^\w.\- ()]/g, '').slice(0, 80) || 'ficheiro', text: String(f?.text ?? '') }))
    .filter(f => f.text.trim());
  if (!list.length) return { text: '', names: [], cut: 0 };
  let budget = CHAT_FILES_BUDGET, cut = 0;
  const parts = list.map(f => {
    let t = f.text.slice(0, CHAT_FILE_MAX);
    if (t.length < f.text.length) cut++;
    if (t.length > budget) { t = t.slice(0, Math.max(0, budget)); cut++; }
    budget -= t.length;
    return `--- ${f.name} (${f.text.length} caracteres${t.length < f.text.length ? ', só os primeiros ' + t.length : ''})\n${t}`;
  });
  return {
    text: `\n\nFICHEIROS QUE O PROPRIETÁRIO ANEXOU NESTA MENSAGEM (lê-os; não os escrevas de volta)\n${parts.join('\n\n')}`,
    names: list.map(f => f.name), cut,
  };
}
function chatContext(context, index, dept, asked) { // what the owner ticked in @contexto, resolved here (not in the page)
  const askedList = Array.isArray(context) ? context : [];
  const want = [...new Set(askedList.filter(k => CHAT_CONTEXT[k]))];
  const ignored = askedList.filter(k => !CHAT_CONTEXT[k]);
  if (!want.length) return { text: '', kinds: [], read: [], ignored };
  let text = `\n\nCONTEXTO PEDIDO PELO PROPRIETÁRIO (${want.map(k => CHAT_CONTEXT[k].label).join(' · ')})`;
  const read = [];
  if (want.includes('brain')) {
    const extra = relevantNotes(index, dept, asked, 5);
    read.push(...extra);
    text += `\n\nCÉREBRO — NOTAS ESCOLHIDAS\n${contextText(index, extra) || '(o Cérebro ainda não tem notas)'}`;
  }
  if (want.includes('docs')) {
    const list = docsContext();
    text += `\n\nDOCUMENTOS DO REPOSITÓRIO\n${list || '(não há documentos markdown em docs/)'}`;
  }
  return { text, kinds: want, read, ignored };
}

async function chat(agentId, text, opts = {}) {
  const a = AGENTS.find(x => x.id === agentId); if (!a) throw new Error('unknown agent');
  const d = DEPTS[a.department]; refreshSkills();
  const index = vaultIndex();
  const { history = [], mode = 'ask', model = '', effort = '', auto = false } = opts;
  const plan = mode === 'plan';
  const pick = auto || !normModel(model) ? modelFor({ agent: a.model, office: cfg.model }) : { model: normModel(model), from: 'owner' };
  const eff = auto || !normEffort(effort) ? effortFor({ agent: a.effort, office: cfg.effort, model: pick.model }) : { effort: normEffort(effort), from: 'owner' };
  const read = relevantNotes(index, a.department, text, 3);
  const ctx = chatContext(opts.context, index, a.department, text);
  for (const n of ctx.read) if (!read.includes(n)) read.push(n);
  const files = chatFiles(opts.files);
  const mine = load().filter(t => t.agent === agentId).slice(-6).map(t => `- [${t.state}] ${t.title}`).join('\n');
  const system = `${a.name}, ${a.role || 'um agente'}, no departamento ${d.name} de ${cfg.name}. ${a.does}
${agentBrief(a)}` +
    'Estás a falar com o proprietário. Responde como este agente, na primeira pessoa, de forma breve (menos de 120 palavras, salvo se pedirem detalhe), simples, sem exageros. ' +
    'Usa as notas da empresa; di-lo quando algo não estiver nelas. Se o proprietário te pedir para procurar algo, usa as tuas ferramentas. Nada sai para fora sem o\' OK explícito do proprietário.\n\n' +
    `${plan ? '' : mcp.promptText(a.tools)}\n\nNOTAS DA EMPRESA\n${businessContext(index)}\n\nNOTAS RELEVANTES\n${contextText(index, read)}\n\nAS TUAS TAREFAS RECENTES\n${mine || '—'}` +
    (plan ? '\n\nMODO PLANEAR: o proprietário quer um plano, não trabalho feito. Responde com 3 a 6 passos numerados, o que cada um muda e o que precisas dele. Não executes nada e não uses ferramentas.' : '') +
    ctx.text + files.text;
  const convo = (history || []).slice(-8).map(m => `${m.who === 'user' ? 'Proprietário' : a.name}: ${m.text}`).join('\n');
  const { text: reply, tools } = await askX(system, (convo ? convo + '\n' : '') + `Owner: ${text}\n${a.name}:`, {
    maxTokens: plan ? 900 : 1200, tools: !plan, model: pick.model, effort: eff.effort || null,
  });
  return {
    reply, read, tools: plan ? [] : toolKeys(tools), used: plan ? [] : mcp.namesOf(tools),
    mode: plan ? 'plan' : 'ask', model: pick.model, modelName: modelName(pick.model), modelFrom: pick.from,
    effort: eff.effort || '', effortName: effortName(eff.effort || null), effortFrom: eff.from,
    context: ctx.kinds, contextIgnored: ctx.ignored, files: files.names, filesCut: files.cut,
  };
}

/* ---------- routines: the office's own clock (V3.5) ---------- */
const RSTATE = routines.loadState(DATA);
let rlist = { routines: [], problems: [], path: routines.file(BRAIN) };
function loadRoutines() { // re-read from disk every time: a routine written by Claude Code, or by hand, lands without a restart
  const r = routines.load(BRAIN, AGENTS);
  if (r.problems.join() !== rlist.problems.join()) for (const w of r.problems) console.warn('routines:', w);
  rlist = r;
  const { list, changed } = routines.withState(r.routines, RSTATE);
  if (changed) routines.saveState(DATA, RSTATE);
  return list;
}
const routinesOut = () => { const list = loadRoutines(); return { routines: list, depts: routines.ALLOWED, path: rlist.path, problems: rlist.problems }; };
const agentName = id => AGENTS.find(a => a.id === id)?.name || id;
// routine-driven runs go one at a time, so a burst of catch-ups after a long sleep does not spawn five Claude processes at once
let queue = Promise.resolve();
const enqueue = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
function fire(r, { due = Date.now(), late = false, by = 'routine' } = {}) { // the routine becomes a task and runs here, page or no page
  const task = { id: nid(), dept: r.dept, agent: r.agent, title: r.title, text: r.text, plan: r.plan || [], eta: 15, why: '', state: 'next', addedAt: Date.now(), by, routine: r.id, when: r.desc || describe(r.when), needsOk: r.needsOk, due, late, routineModel: r.model || undefined, routineEffort: r.effort || undefined, team: r.team && TEAMS.enabled ? { lead: r.agent, asked: 'routine' } : undefined };
  const list = load(); list.push(task); save(list);
  routines.advance(RSTATE, r, Date.now(), task.id, late); routines.saveState(DATA, RSTATE);
  console.log(`⏱ ${task.id} → ${task.agent}: ${task.title}${late ? ' (ATRASADA · era para ' + fmtTime(due) + ')' : ''}`);
  enqueue(() => runServerTask(task.id));
  return task;
}
async function runServerTask(id, { feedback, approve } = {}) {
  let list = load(); const task = list.find(t => t.id === id); if (!task) return null;
  task.state = 'doing'; task.startedAt = Date.now(); delete task.ask; save(list);
  try {
    const out = await run(task, feedback, approve ? 'approve' : task.needsOk ? 'draft' : 'routine');
    if (approve) { task.result = (task.draft || task.result) + '\n\n---\nDEPOIS DO TEU OK\n' + out.result; task.approved = true; task.approvedAt = Date.now(); }
    else task.result = out.result;
    Object.assign(task, { read: out.read, tools: [...new Set([...(task.tools || []), ...out.tools])], used: [...new Set([...(task.used || []), ...out.used])], skills: out.skills, error: false, modelUsed: out.modelUsed, modelFrom: out.modelFrom, modelId: out.modelId, effortUsed: out.effortUsed, effortFrom: out.effortFrom, ...(out.team ? { team: out.team } : {}) });
    if (task.needsOk && !approve) { task.state = 'waiting'; task.draft = out.result; task.waitingAt = Date.now(); task.ask = routines.askLine(task); }
    else { task.state = 'done'; task.doneAt = Date.now(); task.note = writeNote(task); await rebuildGraph(); }
  } catch (e) {
    Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Não foi possível concluir esta tarefa: ' + e.message, error: true });
  }
  list = load(); const i = list.findIndex(t => t.id === task.id); if (i >= 0) list[i] = task; save(list);
  console.log(`${task.error ? '✗' : task.state === 'waiting' ? '⏸' : '✓'} ${task.id} ${task.error ? 'failed' : task.state === 'waiting' ? 'à espera do teu OK' : 'done'} (${task.result.length} chars${task.tools?.length ? ', tools: ' + task.tools.join(' ') : ''}${task.note ? ', note: ' + task.note : ''})`);
  return task;
}
function tickRoutines() {
  let list; try { list = loadRoutines(); } catch (e) { console.warn('routines:', e.message); return; }
  for (const { routine, due, late } of routines.due(list, RSTATE)) fire(routine, { due, late });
  tickScheduled();
}
function tickScheduled() { // V3.2.1: a task scheduled for a date fires on its minute — late (once) if the office was off
  const now = Date.now(); let list = load(); let changed = false;
  for (const t of list) {
    if (t.state !== 'scheduled' || !(t.dueAt <= now)) continue;
    t.state = 'next'; t.due = t.dueAt; t.late = now - t.dueAt > routines.LATE_AFTER; t.addedAt = now; changed = true;
    console.log(`⏱ ${t.id} scheduled task fires → ${t.agent}: ${t.title}${t.late ? ' (ATRASADA · era para ' + fmtDateTime(t.dueAt) + ')' : ''}`);
    enqueue(() => runServerTask(t.id));
  }
  if (changed) save(list);
}
const uniqueId = (base, list) => { let id = base || 'routine', n = 2; while (list.some(r => r.id === id)) id = `${base}-${n++}`; return id; };
function editRoutine(id, patch) { const r = rlist.routines.find(x => x.id === id); if (!r) return null; Object.assign(r, patch); routines.save(BRAIN, rlist.routines); return loadRoutines().find(x => x.id === id); }
function removeRoutine(id) { const n = rlist.routines.length; rlist.routines = rlist.routines.filter(x => x.id !== id); if (rlist.routines.length !== n) routines.save(BRAIN, rlist.routines); loadRoutines(); return rlist.routines.length !== n; }
// a sentence (or the REPEAT picker) → a routine in the brain file. Claude names the agent, the title and whether it needs the OK.
async function makeRoutine({ dept, text, when, agent, needsOk, model, effort }) {
  let taskText = String(text || '').trim(), w = when, parsed = null;
  if (!w) {
    parsed = parseWhen(taskText);
    if (!parsed) return { error: 'Não há horário nessa frase. Diz quando: "every weekday at 8am, …", "Segundas às 9h, …", "de hora a hora, 9h-17h, …".', noSchedule: true };
    if (parsed.needsDay) return { error: 'Que dia? Diz "todas as segundas …" or "Seg e Qui …".', needsDay: true };
    if (parsed.needsTime) return { error: 'Que horas? Diz "… às 8h" or "… at 17:30".', needsTime: true };
    w = parsed.when; taskText = parsed.text;
  }
  if (!validWhen(w)) return { error: 'Esse horário está incompleto.' };
  if (!taskText) return { error: 'O que deve acontecer? A frase tem uma hora mas não tem tarefa.' };
  loadRoutines();
  const r = await route(dept, taskText);
  const a = agent && AGENTS.find(x => x.id === agent && x.department === dept) ? agent : r.agent;
  const v = routines.validate({ id: uniqueId(slug(r.title).slice(0, 40), rlist.routines), dept, agent: a, title: r.title, text: taskText, when: w, needsOk: typeof needsOk === 'boolean' ? needsOk : r.needsOk, plan: r.plan, model: normModel(model) || undefined, effort: normEffort(effort) || undefined }, AGENTS, rlist.routines);
  if (v.problems.length) return { error: v.problems.join('; ') };
  rlist.routines.push(v.routine); routines.save(BRAIN, rlist.routines);
  const out = loadRoutines().find(x => x.id === v.routine.id);
  console.log(`⏱ routine ${out.id} → ${out.agent}: ${out.title} (${out.desc} · next ${untilText(out.nextAt)}${out.needsOk ? ' · espera pelo OK' : ''})`);
  return { ok: true, routine: out, why: r.why, guessed: parsed?.guessed ? parsed.guessWord : null };
}
// B2: a routine said to an agent in chat. The lead routes it inside the department; a specialist takes it on.
async function routinesChat(a, text) {
  const t = String(text).trim(), dept = a.department, allowed = routines.ALLOWED.includes(dept);
  if (/^\s*(routines?|schedule|timetable|what(?:'s| is) (?:scheduled|on the (?:schedule|timetable)))\s*\??\s*$/i.test(t)) return { reply: allowed ? routines.listText(loadRoutines(), dept, AGENTS) : routines.refusal(dept) };
  const cmd = /^\s*(pause|stop|resume|start|unpause|delete|remove|run)\b\s*(?:the\s+)?(.*?)\s*[.!]?$/i.exec(t);
  if (cmd && allowed && !parseWhen(t)) {
    const list = loadRoutines(); const words = cmd[2].replace(/\s+(routine|one)$/i, ''); const r = routines.matchRoutine(list, dept, words);
    if (!r) return { reply: (list.some(x => x.dept === dept) ? 'Qual deles? ' : '') + routines.listText(list, dept, AGENTS) };
    const verb = cmd[1].toLowerCase();
    if (verb === 'run') { const task = fire(r, { by: 'you' }); return { reply: `A correr "${r.title}" agora — ${r.agent === a.id ? 'Já tenho' : agentName(r.agent) + ' ficou com ela'}. Aparece no painel${r.needsOk ? ' e espera pelo teu OK antes de algo sair' : ''}.`, task }; }
    if (/pause|stop/.test(verb)) { editRoutine(r.id, { paused: true }); return { reply: `Em pausa "${r.title}". Fica no horário; diz "resume ${r.title.toLowerCase()}" para a reiniciar.` }; }
    if (/resume|start|unpause/.test(verb)) { const n = editRoutine(r.id, { paused: false }); return { reply: `"${r.title}" está de volta — próxima ${untilText(n.nextAt)}.` }; }
    if (/delete|remove/.test(verb)) { removeRoutine(r.id); return { reply: `Apagada "${r.title}". Saiu do horário.` }; }
  }
  const p = parseWhen(t);
  if (!p) return null;
  if (!allowed) return { reply: routines.refusal(dept) };
  if (p.needsDay) return { reply: 'Que dia? Diz outra vez com o dia: "todas as segundas às 9h, …".' };
  if (p.needsTime) return { reply: `Que horas? Diz outra vez com a hora, p. ex. "every weekday at 8am, ${p.text ? p.text.slice(0, 60) : '…'}".` };
  if (!p.text) return { reply: 'Tenho a hora mas não a tarefa. Diz outra vez com o que deve acontecer.' };
  const made = await makeRoutine({ dept, text: p.text, when: p.when, agent: a.lead ? undefined : a.id });
  if (made.error) return { reply: made.error };
  const r = made.routine, who = r.agent === a.id ? 'Já tenho' : `${agentName(r.agent)} ficou com ela`;
  return { reply: `Pronto. ${r.desc.charAt(0).toUpperCase() + r.desc.slice(1)}, ${who}.${made.guessed ? ` I took "${made.guessed}" as ${r.when.at}; say a time to change it.` : ''} ${r.needsOk ? 'Tudo o que for para enviar espera primeiro pelo teu OK.' : 'Só lê, por isso não fica à tua espera.'} Próxima execução ${untilText(r.nextAt)}. Diz "routines" para veres a lista, "pause ${r.title.toLowerCase()}" para a parar.`, routine: r };
}

/* ---------- http ---------- */
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
// 28 out 2026: o retrato da plataforma é público e legível por qualquer app (web, móvel, outro
// servidor). Só estas rotas abrem CORS — as privadas continuam fechadas.
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const jsonCors = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors }); res.end(JSON.stringify(body)); };
const body = req => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); });
// 26 out 2026: integrações. O corpo é limitado por rota (nada de 2 MB a entrar em memória) e tudo o
// que escreve para fora exige ORBITA_API_TOKEN com 32+ caracteres — sem token, a rota nem existe.
const limitedBody = (req, maxBytes = 25000) => new Promise((resolve, reject) => {
  let s = '', done = false;
  req.on('data', d => { if (done) return; s += d; if (Buffer.byteLength(s) > maxBytes) { done = true; reject(Object.assign(new Error('request body too large'), { status: 413 })); req.removeAllListeners('data'); req.resume(); } });
  req.on('end', () => { if (done) return; try { resolve(s ? JSON.parse(s) : {}); } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
});
const requireIntegrationToken = (req, res) => {
  if ((process.env.ORBITA_API_TOKEN || '').length < 32) { json(res, 503, { error: 'Define ORBITA_API_TOKEN com pelo menos 32 caracteres no .env para ativar os endpoints privados.' }); return false; }
  if (!integrations.apiTokenOk(req)) { json(res, 401, { error: 'Token de API inválido ou ausente.' }); return false; }
  return true;
};
const integrationResponse = async (res, fn, successCode = 200) => {
  try { return json(res, successCode, await fn()); }
  catch (e) { const mapped = integrations.getIntegrationError(e); return json(res, mapped.status, { error: mapped.error }); }
};

// 28 out 2026: o token interno deixa de ser um passo manual — nasce aqui se faltar. A plataforma lê
// o .env, vigia-o, e sonda os serviços configurados em segundo plano (não atrasa o arranque).
const tokenInfo = ensureApiToken({ root: ROOT });
const platform = createPlatform({ root: ROOT, env: process.env });
platform.start({ onChange: (r) => console.log(`  plataforma: .env mudou (${r.changed.join(', ')}) — chaves recarregadas e serviços sondados de novo`) });

await rebuildGraph();
{
  const g = google.state(), ls = google.stats(DATA);
  console.log(`  pesquisa google: ${g.places.available ? 'Places ligado' : 'Places sem chave (' + g.places.env + ')'} · ${g.web.available ? 'pesquisa web ligada' : 'pesquisa web sem chave'} · ${ls.total} leads guardados${ls.total ? ' (' + ls.noSite + ' sem site)' : ''}`);
}
if (OPS) {
  globalThis.__orbitaDeliver = deliverOut; // a fila usa o mesmo caminho de envio do servidor
  console.log(`  operação: ${OPS.metrics.summaryLine(OPS.db)} · fila: ${OPS.queue.stats().fila || 0} à espera`);
  try { OPS.queue.enqueue('seguimento.verificar', {}, { maxAttempts: 1 }); } catch { /* sem fila, sem drama */ }
}
const discovering = mcp.discover().then(l => { console.log(`  conectores: ${l.filter(s => s.status === 'connected').length} ligados de ${l.length} (claude mcp list + os do projeto)`); return l; });
const agentsOut = () => { const setup = setupMap(); return AGENTS.map(a => ({ id: a.id, name: a.name, role: a.role, does: a.does, tools: a.tools, brief: a.brief || '', model: a.model || '', effort: a.effort || '', skills: skills.names(a), lessons: learn.count(BRAIN, a.id), department: a.department, lead: a.lead,
  interviewer: leadOf(a.department).id === a.id, setUp: setup[a.department] })); };
const limiter = createLimiter({ windowMs: 60000, max: 300 });
// Entrar é o alvo natural de força bruta: mais apertado do que o resto, por IP.
const loginLimiter = createLimiter({ windowMs: 60000, max: 20 });

/**
 * Que permissão cada rota exige. A regra é explícita e curta — o que não estiver listado é
 * leitura (GET) ou escrita (restantes métodos). Aprovar, entregar e parar envios são «approve»;
 * contas, sessões, dinheiro e oferta são «admin».
 */
function permFor(method, pathname) {
  // Contas, sessões, dinheiro e oferta são de dono — mesmo para ler: a lista de emails não é
  // matéria de leitor.
  if (/^\/api\/ops\/(utilizadores|sessoes)/.test(pathname)) return 'admin';
  if (/^\/api\/ops\/(receita|clientes|oferta|autonomia\/limiar)/.test(pathname)) return 'admin';
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (/\/(aprovar|entregar|rejeitar|approve|enviar|send|stop)$/.test(pathname)) return 'approve';
  if (/^\/api\/ops\/(ensaio|evals\/correr|consent\/opt-out)/.test(pathname)) return 'approve';
  if (/^\/api\/ops\/(tarefas\/[^/]+\/aprovar|tarefas\/[^/]+\/rejeitar)/.test(pathname)) return 'approve';
  return 'write';
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // 1) ritmo: nenhum separador esgota o processo com um ciclo de fetch
    if (url.pathname.startsWith('/api/')) {
      const hit = limiter.check(req.socket.remoteAddress || 'local');
      if (!hit.ok) return json(res, 429, { ok: false, error: `demasiados pedidos — tenta daqui a ${hit.espera}s`, retryAfter: hit.espera });
    }
    // 2) autenticação: quem está do outro lado. Uma pessoa (sessão com papel), uma máquina
    //    (token da instalação, vale como dono) ou o modo local — que só existe quando não há
    //    contas nem token, e que o arranque anuncia em voz alta.
    let AUTH = null;
    if (url.pathname.startsWith('/api/ops')) {
      AUTH = authenticate(req, { db: OPS?.db });
      if (!AUTH.ok) return json(res, 401, { ok: false, ...AUTH });
      // 3) CSRF: uma credencial em cookie não pode ser usada por outro site. O cabeçalho
      //    `x-orbita-admin` não tem este problema (um site estranho não o consegue pôr).
      const csrf = csrfOk(req);
      if (!csrf.ok) return json(res, 403, { ok: false, error: csrf.error });
      // 4) autorização: autenticado não quer dizer autorizado. O papel decide.
      const perm = permFor(req.method, url.pathname);
      if (!AUTH.can(perm)) {
        OPS?.audit?.({ actor: AUTH.user?.email || AUTH.mode, action: 'acesso.negado', entity: 'rota', entityId: url.pathname, detail: { papel: AUTH.role, permissao: perm } });
        return json(res, 403, {
          ok: false, error: `o papel «${AUTH.roleLabel || AUTH.role}» não permite ${perm} nesta rota`,
          papel: AUTH.role, permissao: perm, precisa: perm,
        });
      }
    }
    // 5) o escritório 3D e as suas rotas de dados seguem a mesma guarda que a mesa. Em modo local
    //    (sem contas nem token) continuam abertas; com contas, o browser leva o cookie de sessão
    //    sozinho no mesmo domínio — e quem não entrou é convidado a entrar em /app.
    const ESCritorio = /^\/api\/(tasks|routines|chat|email|deploy|social|ai|crm|leads|content|google)(\/|$)/;
    if (ESCritorio.test(url.pathname)) {
      const a = authenticate(req, { db: OPS?.db });
      if (!a.ok) return json(res, 401, { ok: false, ...a, entrar: '/app' });
      const csrf = csrfOk(req);
      if (!csrf.ok) return json(res, 403, { ok: false, error: csrf.error });
      const perm = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
      if (!a.can(perm)) return json(res, 403, { ok: false, error: `o papel «${a.roleLabel}» não permite ${perm} aqui`, papel: a.role });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/command-centre-v2.html' || url.pathname === '/dark')) {
      if (!fs.existsSync(HTML)) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('o escritório ainda não foi construído — corre `npm run build` na pasta agents-office-main'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      let page = fs.readFileSync(HTML, 'utf8');
      if (url.pathname === '/dark') page = page.replace('<body>', '<body class="dark">'); // /dark: o mesmo ficheiro, em modo escuro
      // Se a instalação está protegida, o escritório precisa de mandar o token em cada pedido. O
      // token não vai aqui dentro: fica no browser (localStorage) e é pedido uma vez.
      // Quem não entrou é levado à mesa: uma sessão serve as duas superfícies.
      page = page.replace('</head>', `<script>(function(){var f=window.fetch;window.fetch=function(u,o){return f(u,o).then(function(r){if(r.status===401&&String(u).indexOf('/api/auth')!==0&&String(u).indexOf('/api/')===0){location.href='/app';}return r;});};})();</script></head>`);
      if (adminMode() === 'token' && (auth.countUsers(OPS?.db) === 0)) page = page.replace('</head>', `<script>(function(){var k='orbita.admin.token';if(!localStorage.getItem(k)){var t=prompt('Este Órbita está protegido. Cola o ORBITA_ADMIN_TOKEN:');if(t)localStorage.setItem(k,t);}var f=window.fetch;window.fetch=function(u,o){o=o||{};var t=localStorage.getItem(k);if(t&&String(u).indexOf('/api/')===0){o.headers=Object.assign({},o.headers,{'x-orbita-admin':t});}return f(u,o);};})();</script></head>`);
      return res.end(page);
    }
    // A mesa de trabalho (26 out 2026): a superfície limpa para decidir. O escritório 3D fica onde
    // está; esta é a página que se abre de manhã e não pede para olhar para uma cena.
    if (req.method === 'GET' && (url.pathname === '/app' || url.pathname === '/mesa' || url.pathname === '/hoje')) {
      if (!fs.existsSync(MESA)) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('a mesa ainda não foi construída — corre `npm run build` na pasta agents-office-main'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(MESA, 'utf8'));
    }
    if (req.method === 'GET' && (url.pathname === '/mesa.js' || url.pathname === '/mesa-dev.html')) {
      const file = path.join(ROOT, 'dist', url.pathname.slice(1));
      res.writeHead(200, { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file, 'utf8'));
    }
    // Preview real: os ficheiros gerados passam a ser servidos por nós. É isto que torna
    // «entregue» uma afirmação verificável em vez de uma promessa.
    const prev = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
    if (prev && req.method === 'GET') {
      const project = OPS.projects.get(OPS.db, decodeURIComponent(prev[1]));
      if (!project) return json(res, 404, { ok: false, error: 'projeto não encontrado' });
      const relRaw = decodeURIComponent(prev[2] || '/');
      const rel = relRaw.replace(/^\/+/, '').replace(/\\/g, '/');
      const root = path.resolve(project.dir);
      const file = path.resolve(root, rel === '' ? 'index.html' : rel);
      if (!file.startsWith(root + path.sep) && file !== root) return json(res, 403, { ok: false, error: 'fora do projeto' });
      let target = file;
      try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch { /* não existe */ }
      if (!fs.existsSync(target)) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!DOCTYPE html><html lang="pt"><meta charset="utf-8"><title>404</title><body style="font-family:system-ui;padding:40px"><h1>Ficheiro não encontrado</h1><p>Este projeto não tem «${rel || 'index.html'}». Volta ao <a href="/preview/${project.id}/">início do preview</a>.</p></body></html>`);
      }
      const ext = path.extname(target).toLowerCase();
      const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(target));
    }
    // 28 out 2026: a plataforma — com que máquina, com que APIs, e o que falta para as ligar
    if (url.pathname === '/api/platform' && req.method === 'OPTIONS') return jsonCors(res, 204, {});
    if (url.pathname === '/api/platform' && req.method === 'GET') {
      return jsonCors(res, 200, {
        ok: true,
        version,
        at: new Date().toISOString(),
        machine: await platform.machine(),
        apis: platform.status(),
        endpoints: platform.endpoints(version),
        token: { present: (process.env.ORBITA_API_TOKEN || '').length >= 32, length: (process.env.ORBITA_API_TOKEN || '').length },
        env: { file: path.relative(ROOT, platform.envFile), reloads: platform.meta.reloads, lastReloadAt: platform.meta.lastReloadAt },
      });
    }
    if (url.pathname === '/api/platform/apis' && req.method === 'GET') return jsonCors(res, 200, platform.status());
    if (url.pathname === '/api/platform/reload' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const r = platform.reloadEnv();
      const probed = await platform.probeAll({ force: true });
      return json(res, 200, { ok: true, changed: r.changed, probed: probed.length, apis: platform.status() });
    }
    /* 29 out 2026 · «cria um campo para implementação de APIs, configurações reais».
       Gravar uma chave é um acto LOCAL: só de loopback (a máquina onde o escritório corre) ou com o
       token da API. Escreve no `.env`, relê-o e sonda o serviço — a resposta traz o HTTP e a latência
       reais, ou o erro real. Nunca devolve o valor da chave. */
    if (url.pathname === '/api/platform/key' && req.method === 'POST') {
      const ip = String((req.socket && req.socket.remoteAddress) || '');
      const local = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip);
      if (!local && !requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 12000).catch((e) => ({ __erro: e }));
      if (b.__erro) return json(res, b.__erro.status || 400, { ok: false, error: b.__erro.message });
      const r = await platform.saveKey({ id: b.id, values: b.values });
      return json(res, r.ok ? 200 : 400, r);
    }
    if (url.pathname === '/api/platform/probe' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const probed = await platform.probeAll({ force: true });
      return json(res, 200, { ok: true, probed, apis: platform.status() });
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, version, backend, ai: ai.summary(AI, cfg).active, google: google.state(), leads: google.stats(DATA), context: { notes: graph.notes, docs: docsList().length }, docList: docsList().slice(0, 60), integrations: (i => ({ mode: i.mode, token: i.apiTokenConfigured, ready: i.providers.filter(p => p.ready).map(p => p.id), missing: i.providers.filter(p => !p.ready).map(p => p.id) }))(integrations.integrationStatus()), model: cfg.model, modelName: modelName(cfg.model), models: MODEL_KEYS, effort: cfg.effort || '', efforts: EFFORT_KEYS, name: cfg.name, brain: BRAIN, notes: graph.notes, depts: DEPT_KEYS,
      agents: agentsOut(), setup: setupMap(), routines: (l => ({ count: l.length, paused: l.filter(r => r.paused).length, depts: routines.ALLOWED }))(loadRoutines()), roster: { customised: roster.customised, briefed: roster.briefed, files: roster.files, problems: roster.problems }, skills: (({ count, shipped, brain, problems }) => ({ count, shipped, brain, problems }))(skills.summary()), tools: !!runner?.tools, mcp: mcp.summary(), teams: TEAMS, browser: mcp.summary().browser });
    if (url.pathname === '/api/agents') return json(res, 200, { agents: agentsOut(), problems: roster.problems, files: roster.files });
    if (url.pathname === '/api/skills') return json(res, 200, refreshSkills().summary()); // reloads from disk: edit a skill, hit this, see it
    if (url.pathname === '/api/lessons') return json(res, 200, { dir: learn.dir(BRAIN), agents: AGENTS.map(a => ({ id: a.id, name: a.name, ...learn.read(BRAIN, a.id) })).filter(x => x.rules.length || x.oneOffs.length) });
    if (url.pathname === '/api/mcp') { if (url.searchParams.get('refresh') === '1') await mcp.discover(); else await discovering; return json(res, 200, { ...mcp.summary(), tools: !!runner?.tools }); }
    // ---- motores de IA: ver, testar e trocar (25 out 2026) ----
    if (url.pathname === '/api/ai' && req.method === 'GET') {
      if (url.searchParams.get('refresh') === '1') { AI = ai.resolve(cfg, DATA); await ai.probe(AI, 900); buildRunner(); }
      return json(res, 200, { ...ai.summary(AI, cfg), activeId: AI.active?.id || null, saved: AI.saved, env: { AO_AI: process.env.AO_AI || null, AO_AI_MODEL: process.env.AO_AI_MODEL || null } });
    }
    if (url.pathname === '/api/ai/test' && req.method === 'POST') {
      const b = await body(req).catch(() => ({}));
      const id = b.provider || AI.active?.id;
      const res2 = ai.resolve({ ...cfg, ai: { ...(cfg.ai || {}), provider: id } }, DATA);
      await ai.probe(res2, 900); // um servidor local pode estar a responder agora
      const target = res2.candidates.find(c => c.id === id);
      if (!target) return json(res, 404, { ok: false, error: `não conheço o motor "${id}"`, known: ai.IDS });
      if (!target.available) return json(res, 400, { ok: false, provider: id, refused: true, error: target.reason });
      const probe = ai.makeRunner(target, cfg, { askClaudeCli });
      const t0 = Date.now();
      try {
        const r = await probe.askX({
          system: 'Respondes sempre em português de Portugal, numa frase curta.',
          user: 'Diz apenas: o motor está ligado.',
          maxTokens: 40, tools: false, timeout: Math.min(RUN_TIMEOUT, 60000), model: cfg.model,
        });
        return json(res, 200, { ok: true, provider: id, label: target.label, model: r.modelId || target.model, ms: Date.now() - t0, text: String(r.text || '').slice(0, 300), tools: r.tools || [] });
      } catch (e) { return json(res, 502, { ok: false, provider: id, label: target.label, ms: Date.now() - t0, error: e.message }); }
    }
    if (url.pathname === '/api/ai/switch' && req.method === 'POST') {
      const b = await body(req);
      if (!b.provider) return json(res, 400, { error: 'falta o campo provider' });
      const out = await switchProvider(String(b.provider));
      return json(res, out.error ? 400 : 200, { ...out, ai: ai.summary(AI, cfg) });
    }
    // ---- pesquisa real da Google: empresas (Places) e web (Programmable Search) ----
    if (url.pathname === '/api/google' && req.method === 'GET') {
      return json(res, 200, { ...google.state(), leads: google.stats(DATA) });
    }
    if (url.pathname === '/api/google/search' && req.method === 'POST') {
      const b = await body(req);
      const kind = b.kind === 'web' ? 'web' : 'places';
      const limit = Math.max(1, Math.min(20, +b.limit || 10));
      const t0 = Date.now();
      try {
        const found = kind === 'places'
          ? await google.searchPlaces({ what: b.what, where: b.where, limit, lang: b.lang || 'pt-PT', region: b.region || 'PT' })
          : await google.searchWeb({ q: b.q || [b.what, b.where].filter(Boolean).join(' '), limit });
        // 26 out 2026: a pesquisa web devolve informação, não empresas — só entra para os leads com save:true explícito.
        const keep = b.save === true || (kind === 'places' && b.save !== false);
        const saved = keep ? google.saveAll(found, DATA) : { added: 0, updated: 0, total: google.stats(DATA).total, leads: found };
        // 26 out 2026: o que a pesquisa encontra entra também na base de dados a sério — pontuado,
        // sem duplicados e pronto para o funil. A gaveta continua a ser a lista rápida; a verdade
        // passa a viver em data/orbita.db.
        let db = null;
        if (OPS && keep && saved.leads?.length) {
          try { db = OPS.leads.importLeads(OPS.db, saved.leads.map(l => ({ ...l, source: 'google' })), 'pesquisa', 'google'); }
          catch (e) { console.warn('  operação: não consegui guardar os resultados na base de dados — ' + e.message); }
        }
        console.log(`🔎 ${kind === 'places' ? 'Places' : 'Pesquisa web'}: "${[b.what, b.where].filter(Boolean).join(' em ') || b.q}" → ${found.length} resultados · +${saved.added} novos`);
        return json(res, 200, { ok: true, kind, ms: Date.now() - t0, found: found.length, added: saved.added, updated: saved.updated, total: saved.total, baseDeDados: db, results: found.slice(0, limit) });
      } catch (e) { return json(res, 502, { ok: false, kind, ms: Date.now() - t0, error: e.message }); }
    }
    // ---- 1.25.0: as fontes que não pedem cartão, iguais às da função publicada ----
    if (url.pathname === '/api/pesquisa' && req.method === 'GET') {
      return json(res, 200, { ok: true, fontes: pesquisa.estado(), google: google.state(), leads: google.stats(DATA) });
    }
    if (url.pathname === '/api/pesquisa/leads' && req.method === 'POST') {
      const b = await body(req);
      const t0 = Date.now();
      try {
        const r = await pesquisa.procurarLeads({
          oQue: b.oQue || b.what, onde: b.onde || b.where, categoria: b.categoria || null,
          limite: Math.max(1, Math.min(50, +b.limite || +b.limit || 20)), raio: +b.raio || 12000,
          pais: b.pais || null, lang: b.lang || 'pt',
        });
        let guardados = null;
        if (b.guardar !== false && r.leads.length && OPS?.leads) {
          try {
            guardados = OPS.leads.importLeads(OPS.db, r.leads.map(l => ({
              name: l.nome, city: l.cidade, phone: l.telefone, email: l.email, website: l.website,
              category: l.categoria, source: 'geoapify', notes: `nota ${l.nota} · ${l.porque}`,
            })), 'pesquisa', 'geoapify');
          } catch (e) { console.warn('  pesquisa: não consegui guardar na base — ' + e.message); }
        }
        console.log(`🔎 Geoapify: ${r.pedido.oQue || r.categoria} em ${r.pedido.onde} → ${r.encontrados} empresas`);
        return json(res, 200, { ok: true, ms: Date.now() - t0, ...r, guardados });
      } catch (e) { return json(res, 502, { ok: false, ms: Date.now() - t0, error: e.message }); }
    }
    if (url.pathname === '/api/pesquisa/web' && req.method === 'POST') {
      const b = await body(req);
      const t0 = Date.now();
      try {
        const r = await pesquisa.pesquisarWeb({ consulta: b.consulta || b.q, limite: Math.max(1, Math.min(20, +b.limite || 8)), profundidade: b.profundidade || 'basic' });
        return json(res, 200, { ok: true, ms: Date.now() - t0, ...r, nota: 'a web dá contexto, não leads — nada foi escrito no funil' });
      } catch (e) { return json(res, 502, { ok: false, ms: Date.now() - t0, error: e.message }); }
    }
    if (url.pathname === '/api/leads' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(200, +url.searchParams.get('limit') || 50));
      const status = url.searchParams.get('status') || null;
      return json(res, 200, { ok: true, google: google.state(), stats: google.stats(DATA), ...google.list({ limit, status }, DATA) });
    }
    if (url.pathname === '/api/leads/status' && req.method === 'POST') {
      const b = await body(req);
      if (!b.id || !b.status) return json(res, 400, { error: 'faltam id e status' });
      const l = google.setStatus(String(b.id), String(b.status), DATA);
      return l ? json(res, 200, { ok: true, lead: l }) : json(res, 404, { error: 'não há lead com esse id' });
    }
    if (url.pathname === '/api/brain') return json(res, 200, graph);
    if (url.pathname === '/api/usage') return json(res, 200, await getUsage(url.searchParams.get('refresh') === '1')); // V3.6: the plan's gauge (never a 500: unavailable is an answer)

    // ---------- integrações (26 out 2026) ----------
    // Leitura do estado é pública e não tem segredos: só diz o que está configurado.
    if (url.pathname === '/api/integrations' && req.method === 'GET') return json(res, 200, integrations.integrationStatus());
    if (url.pathname === '/api/github/file' && req.method === 'PUT') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 750000);
      return integrationResponse(res, () => integrations.githubWriteFile({ ...b, approved: b.approved }), 201);
    }
    if (url.pathname === '/api/github/repo' && req.method === 'GET') {
      if (!requireIntegrationToken(req, res)) return;
      return integrationResponse(res, () => integrations.githubRepository(url.searchParams.get('owner'), url.searchParams.get('repo')));
    }
    if (url.pathname === '/api/whatsapp/link' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 5000);
      return integrationResponse(res, () => integrations.whatsappClickToChatUrl(b.phone, b.message));
    }
    if (url.pathname === '/api/crm/leads/discover' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 12000);
      return integrationResponse(res, async () => {
        const result = await integrations.discoverBusinesses({ location: b.location, category: b.category, radiusMeters: b.radiusMeters, limit: b.limit });
        if (b.save === true && result.results.length) result.saved = await integrations.saveLeads(DATA, result.results.map(x => ({ ...x, city: x.city || result.location, source: 'openstreetmap' })));
        return result;
      });
    }
    if (url.pathname === '/api/crm/leads' && req.method === 'GET') {
      if (!requireIntegrationToken(req, res)) return;
      return integrationResponse(res, async () => ({ ok: true, storage: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local-json', leads: await integrations.listLeads(DATA, Number(url.searchParams.get('limit') || 100)) }));
    }
    if (url.pathname === '/api/crm/leads' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 50000);
      const input = Array.isArray(b.leads) ? b.leads : [b];
      return integrationResponse(res, () => integrations.saveLeads(DATA, input), 201);
    }
    const leadRoute = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
    if (leadRoute && req.method === 'PATCH') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 12000);
      return integrationResponse(res, async () => {
        const lead = await integrations.updateLead(DATA, decodeURIComponent(leadRoute[1]), b);
        if (!lead) { const e = new Error('Lead não encontrado.'); e.status = 404; throw e; }
        return { ok: true, lead };
      });
    }
    if (url.pathname === '/api/ai/assist' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 12000);
      return integrationResponse(res, () => integrations.geminiAssist({ task: b.task, data: b.data || {} }));
    }
    if (url.pathname === '/api/content/drafts' && req.method === 'GET') {
      if (!requireIntegrationToken(req, res)) return;
      return json(res, 200, { ok: true, drafts: integrations.listContentDrafts(DATA, Number(url.searchParams.get('limit') || 100)) });
    }
    if (url.pathname === '/api/content/drafts' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 12000);
      return integrationResponse(res, () => integrations.createContentDraft(DATA, b), 201);
    }
    if (url.pathname === '/api/email/send' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 18000);
      return integrationResponse(res, () => integrations.sendApprovedEmail(DATA, b), 201);
    }
    if (url.pathname === '/api/email/suppress' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 5000);
      return integrationResponse(res, () => integrations.suppressEmail(DATA, b.email, b.reason));
    }
    if (url.pathname === '/api/deploy/vercel' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 5000);
      return integrationResponse(res, () => integrations.triggerVercelDeploy({ approved: b.approved }), 202);
    }
    if (url.pathname === '/api/social/instagram/publish' && req.method === 'POST') {
      if (!requireIntegrationToken(req, res)) return;
      const b = await limitedBody(req, 12000);
      return integrationResponse(res, async () => {
        let target = b;
        if (b.draftId) {
          const draft = integrations.listContentDrafts(DATA, 500).find(x => x.id === b.draftId);
          if (!draft) { const e = new Error('Rascunho não encontrado.'); e.status = 404; throw e; }
          target = { ...b, imageUrl: draft.imageUrl, caption: [draft.caption, draft.hashtags].filter(Boolean).join('\n\n') };
        }
        const published = await integrations.publishInstagram(target);
        const draft = b.draftId ? integrations.markContentPublished(DATA, b.draftId, published) : null;
        return { ...published, draft };
      }, 201);
    }
    /* ---------- a oficina: catálogo, forja, execução, adopção e o terminal ao vivo ---------- */
    if (url.pathname === '/api/forge' && req.method === 'GET') return json(res, 200, FORGE.catalogue());
    if (url.pathname === '/api/forge/events' && req.method === 'GET') {
      const n = Math.min(400, Math.max(1, +(url.searchParams.get('n') || 120)));
      return json(res, 200, { events: FORGE.recent(n), stats: FORGE.stats() });
    }
    if (url.pathname === '/api/forge/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform', connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); return true; } catch { return false; } };
      res.write('retry: 3000\n\n');
      send('hello', { stats: FORGE.stats(), events: FORGE.recent(80) });
      const off = FORGE.subscribe((e) => send('forge', e));
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* sai no close */ } }, 25000);
      req.on('close', () => { clearInterval(ping); off(); });
      return;
    }
    if (url.pathname === '/api/forge/draft' && req.method === 'POST') {
      const b = await body(req);
      if (!DEPTS[b.room] || b.room === 'brain') return json(res, 400, { error: 'sala desconhecida' });
      const agent = AGENTS.find(a => a.id === b.agent && a.department === b.room) ? b.agent : (AGENTS.find(a => a.department === b.room && a.lead) || AGENTS.find(a => a.department === b.room)).id;
      const r = FORGE.forge({ room: b.room, agent, need: String(b.need || '').slice(0, 300), name: b.name, code: b.code || null, scopes: b.scopes, examples: b.examples, activate: b.activate === true });
      // um rascunho NÃO é um erro: a ferramenta foi forjada e provada, só espera o dono. Só as
      // recusas a sério (sem receita, manifesto proibido, provas falhadas) é que voltam 422.
      return json(res, r.ok || r.draft ? 200 : 422, r);
    }
    if (url.pathname === '/api/forge/run' && req.method === 'POST') {
      const b = await body(req);
      if (!DEPTS[b.room] || !b.id) return json(res, 400, { error: 'faltam room e id' });
      return json(res, 200, FORGE.run({ room: b.room, id: String(b.id), input: b.input && typeof b.input === 'object' ? b.input : {}, force: b.force === true }));
    }
    if (url.pathname === '/api/forge/activate' && req.method === 'POST') {
      const b = await body(req);
      const r = FORGE.activate({ room: b.room, id: String(b.id || '') });
      return json(res, r.ok ? 200 : 422, r);
    }
    if (url.pathname === '/api/forge/adopt' && req.method === 'POST') {
      const b = await body(req);
      if (!b.to || !DEPTS[b.to]) return json(res, 400, { error: 'sala de destino desconhecida' });
      const agent = (AGENTS.find(a => a.department === b.to && a.lead) || {}).id;
      const r = FORGE.adopt({ room: b.room, id: String(b.id || ''), to: b.to, agent });
      return json(res, r.ok ? 200 : 422, r);
    }
    if (url.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, load());
    if (url.pathname === '/api/routines' && req.method === 'GET') return json(res, 200, routinesOut());
    if (url.pathname === '/api/routines' && req.method === 'POST') {
      const b = await body(req);
      if (!DEPTS[b.dept] || b.dept === 'brain') return json(res, 400, { error: 'unknown department' });
      if (!routines.ALLOWED.includes(b.dept)) return json(res, 400, { error: routines.refusal(b.dept), refused: true });
      const r = await makeRoutine({ dept: b.dept, text: b.text, when: b.when, agent: b.agent, needsOk: b.needsOk, model: b.model, effort: b.effort });
      return json(res, r.error ? 400 : 200, r);
    }
    const rm = url.pathname.match(/^\/api\/routines\/([^/]+)(?:\/(run|pause|resume))?$/);
    if (rm) {
      const r = loadRoutines().find(x => x.id === rm[1]);
      if (!r) return json(res, 404, { error: 'no such routine' });
      if (req.method === 'APAGAR') { removeRoutine(r.id); return json(res, 200, { ok: true, routines: loadRoutines() }); }
      if (req.method !== 'POST') return json(res, 405, { error: 'PUBLICAR ou APAGAR' });
      if (rm[2] === 'run') return json(res, 200, { ok: true, task: fire(r, { by: 'you' }), routines: loadRoutines() });
      if (rm[2] === 'pause' || rm[2] === 'resume') { editRoutine(r.id, { paused: rm[2] === 'pause' }); return json(res, 200, { ok: true, routines: loadRoutines() }); }
      const b = await body(req); const patch = {};
      if (typeof b.needsOk === 'boolean') patch.needsOk = b.needsOk; if (typeof b.paused === 'boolean') patch.paused = b.paused;
      if (typeof b.text === 'string' && b.text.trim()) patch.text = b.text.trim(); if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 90);
      if (b.when && validWhen(b.when)) patch.when = b.when;
      if (b.model !== undefined) patch.model = normModel(b.model) || '';
      if (b.effort !== undefined) patch.effort = normEffort(b.effort) || '';
      editRoutine(r.id, patch); return json(res, 200, { ok: true, routines: loadRoutines() });
    }
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const { dept, text, model, effort, team, at, run: startNow } = await body(req);
      if (!DEPTS[dept] || dept === 'brain') return json(res, 400, { error: 'unknown department' });
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty task' });
      const dueAt = at ? (typeof at === 'number' ? at : Date.parse(at)) : null; // V3.2.1: a task for a date
      if (at && !(dueAt > 0)) return json(res, 400, { error: 'at tem de ser uma hora (ms ou ISO)' });
      if (dueAt && dueAt < Date.now() - 60000) return json(res, 400, { error: 'essa hora já passou — escolhe uma que ainda esteja à frente' });
      const r = await route(dept, String(text).trim());
      const asTeam = TEAMS.enabled && (team === true || teams.intent(text)); // V3.2 (16 Sep): TEAM in the bar, or "as a team" in the sentence → the lead owns it and splits it
      const task = { id: nid(), dept, agent: asTeam ? leadOf(dept).id : r.agent, title: r.title, text: String(text).trim(), plan: r.plan, eta: r.eta, why: asTeam ? `equipa — ${leadOf(dept).name} divide-a pelas secretárias` : r.why, state: 'next', addedAt: Date.now(), by: 'you', model: normModel(model) || undefined, effort: normEffort(effort) || undefined, // model/effort: set on this task (beats routine, agent, office)
        team: asTeam ? { lead: leadOf(dept).id, asked: team === true ? 'you' : 'text' } : undefined };
      if (dueAt) { task.state = 'scheduled'; task.dueAt = dueAt; task.needsOk = r.needsOk; } // waits for its minute; needsOk decides whether it then waits for the OK
      const list = load(); list.push(task); save(list);
      console.log(`+ ${task.id} → ${task.agent}: ${task.title}${asTeam ? ' (team)' : ''}${dueAt ? ' · scheduled ' + untilText(dueAt) : ''}`);
      // 27 out 2026: o modo CONSTRUIR do compositor cria a tarefa e começa já a corrê-la. O pedido
      // volta com o id (a página acompanha pelo /api/tasks); o trabalho corre na fila do servidor.
      if (startNow === true && !dueAt) { task.state = 'doing'; task.startedAt = Date.now(); save(list); enqueue(() => runServerTask(task.id)); }
      return json(res, 200, task);
    }
    const m = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|revise|approve|reject))?$/);
    if (m && req.method === 'POST' && (m[2] === 'approve' || m[2] === 'reject')) { // D1: the owner's tick on a routine's draft
      const task = load().find(t => t.id === m[1]);
      if (!task) return json(res, 404, { error: 'no such task' });
      if (task.state !== 'waiting') return json(res, 400, { error: 'esta tarefa não está à espera do teu OK' });
      const { feedback } = m[2] === 'reject' ? await body(req) : {};
      const note = String(feedback || '').trim();
      console.log(`${m[2] === 'approve' ? '✅' : '↩'} ${task.id} ${m[2] === 'approve' ? 'aprovada — ' + agentName(task.agent) + ' está a enviar' : 'devolvida: ' + note.slice(0, 80)}`);
      enqueue(() => runServerTask(task.id, m[2] === 'approve' ? { approve: true } : { feedback: note || 'Não é isto. Refazer.' }))
        .then(t => { if (m[2] === 'reject' && note && t && !t.error) { const a = AGENTS.find(x => x.id === t.agent); return learn.classify(ask, a, t, note).then(v => { const r = learn.record(BRAIN, a, t, note, v); console.log(`  ↳ ${a.name} ${r.standing ? 'aprendeu uma regra' : 'registou uma pontual'}: ${r.line.slice(0, 100)}`); }); } })
        .catch(e => console.warn('approval:', e.message));
      return json(res, 200, { ok: true, id: task.id, state: 'doing' });
    }
    if (m && req.method === 'POST' && (m[2] === 'run' || m[2] === 'revise')) {
      const list = load(); const task = list.find(t => t.id === m[1]);
      if (!task) return json(res, 404, { error: 'no such task' });
      const { feedback } = m[2] === 'revise' ? await body(req) : {};
      task.state = 'doing'; task.startedAt = Date.now(); save(list);
      try {
        const { result, read, tools, used, skills: sk, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom, team } = await run(task, feedback);
        Object.assign(task, { state: 'done', doneAt: Date.now(), result, read, tools, used, skills: sk, error: false, modelUsed, modelFrom, modelId: ran, effortUsed, effortFrom, ...(team ? { team } : {}) });
        task.note = writeNote(task);
        await rebuildGraph();
      } catch (e) {
        Object.assign(task, { state: 'done', doneAt: Date.now(), result: 'Não foi possível concluir esta tarefa: ' + e.message, error: true });
      }
      const l2 = load(); const i = l2.findIndex(t => t.id === task.id); if (i >= 0) l2[i] = task; save(l2);
      console.log(`${task.error ? '✗' : '✓'} ${task.id} ${task.error ? 'failed' : 'done'} (${task.result.length} chars${task.tools?.length ? ', tools: ' + task.tools.join(' ') : ''}${task.note ? ', note: ' + task.note : ''})`);
      json(res, 200, task);
      if (feedback && !task.error) { // learn from the correction, after the reply is out the door
        const a = AGENTS.find(x => x.id === task.agent);
        learn.classify(ask, a, task, feedback).then(v => { const r = learn.record(BRAIN, a, task, feedback, v); console.log(`  ↳ ${a.name} ${r.standing ? 'aprendeu uma regra' : 'registou uma pontual'}: ${r.line.slice(0, 100)}`); })
          .catch(e => console.warn('learn:', e.message));
      }
      return;
    }
    if (m && req.method === 'APAGAR') { save(load().filter(t => t.id !== m[1])); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const { agent, text, history, mode, model, effort, auto, files, context } = await body(req);
      if (!text || !String(text).trim()) return json(res, 400, { error: 'empty message' });
      const a = AGENTS.find(x => x.id === agent); if (!a) return json(res, 400, { error: 'unknown agent' });
      const wantsPlan = mode === 'plan'; // MODO PLANEAR: nada aqui cria uma rotina ou abre uma entrevista — devolve-se um plano
      if (!wantsPlan && !onboard.active(DATA, a.department)) { // V3.5: "every weekday at 8am, …" · "routines" · "pause …" · "corre … agora" — unless the lead is mid-interview
        const rc = await routinesChat(a, String(text).trim());
        if (rc) return json(res, 200, { reply: rc.reply, read: [], tools: [], interview: false, routine: rc.routine || null, routines: true });
      }
      if (!wantsPlan && leadOf(a.department).id === a.id) { // the department lead can run the set-up interview
        refreshSkills();
        const o = await onboard.handle(String(text).trim(), { dept: a.department, deptName: DEPTS[a.department].name, lead: a, agents: AGENTS.filter(x => x.department === a.department),
          connected: mcp.summary().servers?.filter(x => x.status === 'connected').map(x => x.name || x.key) || [], brainPath: BRAIN, dataDir: DATA, ask, business: cfg.name, afterWrite: refreshSkills });
        if (o) { if (o.wrote) console.log(`★ ${a.name} configurou ${DEPTS[a.department].name}: ${o.wrote.briefs.length} briefings${o.wrote.skill ? ', competência ' + o.wrote.skill.name : ''}`); return json(res, 200, { reply: o.reply, read: [], tools: [], interview: !o.wrote, setup: setupMap() }); }
      }
      const r = await chat(agent, String(text).trim(), { history, mode, model, effort, auto: auto === true, files, context });
      return json(res, 200, { ...r, interview: false });
    }
    // ---------- /api/auth: contas, sessões e o que cada papel pode fazer ----------
    // Fora de /api/ops de propósito: entrar não exige estar dentro.
    if (url.pathname.startsWith('/api/auth')) {
      const badAuth = e => json(res, e.status || 400, { ok: false, error: e.message });
      const secure = wantsSecureCookie(req);
      const horas = auth.sessionHours(process.env);
      const cookieFor = token => sessionCookie(token, { maxAgeSeconds: horas * 3600, secure });
      const quem = req => authenticate(req, { db: OPS?.db });
      try {
        if (url.pathname === '/api/auth/estado' && req.method === 'GET') {
          return json(res, 200, {
            ok: true, ...auth.authState(OPS?.db), papeis: auth.ROLES, permissoes: auth.PERMS,
            horasSessao: horas, primeiraContaPossivel: !OPS?.db || auth.countUsers(OPS.db) === 0,
          });
        }
        if (url.pathname === '/api/auth/primeiro-dono' && req.method === 'POST') {
          if (!OPS) return json(res, 503, { ok: false, error: 'a operação não está ligada' });
          const lim = loginLimiter.check(req.socket.remoteAddress || 'local');
          if (!lim.ok) return json(res, 429, { ok: false, error: `demasiadas tentativas — tenta daqui a ${lim.espera}s`, retryAfter: lim.espera });
          const b = await limitedBody(req, 8000);
          const user = auth.createFirstOwner(OPS.db, { email: b.email, name: b.name || '', password: b.password });
          const { token } = auth.openSession(OPS.db, user, { hours: horas, agent: req.headers['user-agent'] || '' });
          res.setHeader('set-cookie', cookieFor(token));
          console.log(`★ primeira conta criada: ${user.email} (${user.role})`);
          return json(res, 201, { ok: true, user, papeis: auth.ROLES });
        }
        if (url.pathname === '/api/auth/entrar' && req.method === 'POST') {
          if (!OPS) return json(res, 503, { ok: false, error: 'a operação não está ligada' });
          const lim = loginLimiter.check(req.socket.remoteAddress || 'local');
          if (!lim.ok) return json(res, 429, { ok: false, error: `demasiadas tentativas de entrada — tenta daqui a ${lim.espera}s`, retryAfter: lim.espera });
          const b = await limitedBody(req, 8000);
          const out = auth.login(OPS.db, {
            email: b.email, password: b.password, hours: horas,
            agent: req.headers['user-agent'] || '', ip: req.socket.remoteAddress || '',
          });
          res.setHeader('set-cookie', cookieFor(out.token));
          return json(res, 200, { ok: true, user: out.user, expira: out.expires_at, papeis: auth.ROLES });
        }
        if (url.pathname === '/api/auth/sair' && req.method === 'POST') {
          const token = sessionToken(req);
          const r = token && OPS ? auth.closeSession(OPS.db, token, { actor: 'sessao' }) : { ok: true };
          res.setHeader('set-cookie', clearSessionCookie({ secure }));
          return json(res, 200, { ok: true, ...r });
        }
        if (url.pathname === '/api/auth/eu' && req.method === 'GET') {
          const a = quem(req);
          if (!a.ok) return json(res, 401, { ok: false, ...a, estado: auth.authState(OPS?.db), primeiraContaPossivel: !OPS?.db || auth.countUsers(OPS.db) === 0 });
          return json(res, 200, {
            ok: true, modo: a.mode, user: a.user, papel: a.role, roleLabel: a.roleLabel,
            perms: a.perms, maquina: !!a.machine, local: !!a.local, papeis: auth.ROLES,
            horasSessao: horas,
          });
        }
        if (url.pathname === '/api/auth/palavra-passe' && req.method === 'POST') {
          if (!OPS) return json(res, 503, { ok: false, error: 'a operação não está ligada' });
          const a = quem(req);
          if (!a.ok || !a.user) return json(res, 401, { ok: false, error: 'entra com a tua conta para trocar a palavra-passe' });
          const csrf = csrfOk(req);
          if (!csrf.ok) return json(res, 403, { ok: false, error: csrf.error });
          const b = await limitedBody(req, 8000);
          const row = OPS.db.prepare('SELECT * FROM users WHERE id = ?').get(a.user.id);
          if (!row || !auth.verifyPassword(b.atual, row.password_hash)) return json(res, 401, { ok: false, error: 'a palavra-passe actual não confere' });
          const r = auth.setPassword(OPS.db, a.user.id, b.nova, a.user.email);
          res.setHeader('set-cookie', clearSessionCookie({ secure }));
          return json(res, 200, { ok: true, ...r, nota: 'todas as sessões foram fechadas — entra outra vez' });
        }
      } catch (e) { return badAuth(e); }
      return json(res, 404, { ok: false, error: 'rota de autenticação desconhecida' });
    }

    // ---------- /api/ops: o trabalho real ----------
    // Envio de email exige o token (é o único sítio desta camada que fala com o mundo).
    if (OPS && url.pathname.startsWith('/api/ops')) {
      const bad = e => { const st = e.status || 400; return json(res, st, { ok: false, error: e.message }); };
      try {
        if (url.pathname === '/api/ops/summary' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.metrics.summary(OPS.db), fila: OPS.queue.stats() });
        }
        if (url.pathname === '/api/ops/leads' && req.method === 'GET') {
          const limit = Math.max(1, Math.min(500, +url.searchParams.get('limit') || 50));
          const status = url.searchParams.get('status') || null;
          return json(res, 200, { ok: true, leads: OPS.leads.listLeads(OPS.db, { limit, status }), estados: OPS.leads.STATUSES });
        }
        if (url.pathname === '/api/ops/leads' && req.method === 'POST') {
          const b = await limitedBody(req, 200000);
          const list = Array.isArray(b.leads) ? b.leads : [b];
          const out = OPS.leads.importLeads(OPS.db, list, 'dono', b.source || 'manual');
          return json(res, 201, { ok: true, ...out });
        }
        if (url.pathname === '/api/ops/leads/importar-gravados' && req.method === 'POST') {
          // traz para a base de dados o que a gaveta LEADS já tinha guardado (data/leads.json)
          const saved = google.list({ limit: 500 }, DATA).leads || [];
          const out = OPS.leads.importLeads(OPS.db, saved.map(l => ({ ...l, source: 'google' })), 'dono', 'google');
          if (out.total) OPS.audit({ actor: 'dono', action: 'ops.importou_gravados', entity: 'leads', detail: out });
          return json(res, 200, { ok: true, ...out });
        }
        // ---------- passo 6: projetos, geração, QA e entrega ----------
        if (url.pathname === '/api/ops/projetos' && req.method === 'GET') {
          return json(res, 200, {
            ok: true,
            projetos: OPS.projects.list(OPS.db, { limit: 100, status: url.searchParams.get('estado') || null }),
            resumo: OPS.projects.summary(OPS.db),
            tipos: Object.entries(OPS.projects.KINDS || {}).map(([id, k]) => ({ id, label: k.label, pages: k.pages })),
          });
        }
        if (url.pathname === '/api/ops/projetos' && req.method === 'POST') {
          const b = await limitedBody(req, 20000);
          const project = OPS.projects.create(OPS.db, DATA, {
            leadId: b.leadId || '', name: b.name, client: b.client || '', niche: b.niche || '', city: b.city || '',
            kind: b.kind || 'landing', stack: b.stack || 'html', brief: b.brief || '',
            goals: b.goals || [], pages: b.pages || [], features: b.features || [], acceptance: b.acceptance || [],
          }, 'dono');
          return json(res, 201, { ok: true, projeto: project });
        }
        const projLead = url.pathname.match(/^\/api\/ops\/leads\/([^/]+)\/projeto$/);
        if (projLead && req.method === 'POST') {
          const b = await limitedBody(req, 20000);
          const project = OPS.projects.fromLead(OPS.db, DATA, decodeURIComponent(projLead[1]), { kind: b.kind || 'landing', brief: b.brief || '', actor: 'dono' });
          return json(res, 201, { ok: true, projeto: project });
        }
        const projMatch = url.pathname.match(/^\/api\/ops\/projetos\/([^/]+)(?:\/(gerar|qa|aprovar|entregar|zip))?$/);
        if (projMatch) {
          const id = decodeURIComponent(projMatch[1]);
          const action = projMatch[2] || '';
          if (req.method === 'GET' && !action) {
            const d = OPS.projects.detail(OPS.db, id);
            if (!d) return json(res, 404, { ok: false, error: 'projeto não encontrado' });
            return json(res, 200, { ok: true, ...d });
          }
          if (req.method === 'POST' && action === 'gerar') {
            const out = OPS.projects.generate(OPS.db, id, 'dono');
            return json(res, 200, { ok: true, ...out });
          }
          if (req.method === 'POST' && action === 'qa') {
            const out = OPS.projects.qa(OPS.db, id, 'dono');
            return json(res, out.run.passed ? 200 : 422, { ok: out.run.passed, ...out });
          }
          if (req.method === 'POST' && action === 'aprovar') {
            const b = await limitedBody(req, 4000);
            return json(res, 200, { ok: true, ...OPS.projects.approve(OPS.db, id, { note: b.note || '' }) });
          }
          if (req.method === 'GET' && action === 'zip') {
            const project = OPS.projects.get(OPS.db, id);
            if (!project) return json(res, 404, { ok: false, error: 'projeto não encontrado' });
            const entries = [];
            for (const f of OPS.projects.filesOf(OPS.db, id)) {
              try { entries.push({ name: f.file, data: fs.readFileSync(path.join(project.dir, f.file)) }); } catch { /* saltar */ }
            }
            if (!entries.length) return json(res, 409, { ok: false, error: 'o projeto ainda não tem ficheiros — gera primeiro' });
            const { buffer, sha256 } = zipBuffer(entries);
            res.writeHead(200, {
              'content-type': 'application/zip',
              'content-disposition': `attachment; filename="${project.id}.zip"`,
              'x-orbita-sha256': sha256,
              'cache-control': 'no-store',
            });
            return res.end(buffer);
          }
          if (req.method === 'POST' && action === 'entregar') {
            const b = await limitedBody(req, 4000);
            return json(res, 200, OPS.projects.deliver(OPS.db, id, { target: b.target || 'preview' }));
          }
          return json(res, 405, { ok: false, error: 'GET, ou POST …/gerar · /qa · /aprovar · /entregar' });
        }

        const leadMatch = url.pathname.match(/^\/api\/ops\/leads\/([^/]+)(?:\/(consent|follow-up))?$/);
        if (leadMatch) {
          const id = decodeURIComponent(leadMatch[1]);
          if (req.method === 'GET' && !leadMatch[2]) {
            const lead = OPS.leads.getLead(OPS.db, id);
            if (!lead) return json(res, 404, { ok: false, error: 'lead não encontrado' });
            return json(res, 200, {
              ok: true, lead,
              dossier: OPS.research.dossier(OPS.db, lead),
              messages: OPS.messages.listMessages(OPS.db, { leadId: id, limit: 50 }),
            });
          }
          if (req.method === 'PATCH' && !leadMatch[2]) {
            const b = await limitedBody(req, 8000);
            const lead = b.status
              ? OPS.leads.setStatus(OPS.db, id, b.status, 'dono', b.note || '')
              : OPS.leads.getLead(OPS.db, id);
            if (!lead) return json(res, 404, { ok: false, error: 'lead não encontrado' });
            return json(res, 200, { ok: true, lead });
          }
          if (req.method === 'POST' && leadMatch[2] === 'consent') {
            const b = await limitedBody(req, 4000);
            return json(res, 200, { ok: true, lead: OPS.leads.setConsent(OPS.db, id, b.consent, 'dono', b.reference || '') });
          }
          if (req.method === 'POST' && leadMatch[2] === 'follow-up') {
            const b = await limitedBody(req, 4000);
            return json(res, 200, { ok: true, lead: OPS.leads.scheduleFollowUp(OPS.db, id, b.when) });
          }
          return json(res, 405, { ok: false, error: 'PATCH, POST …/consent ou …/follow-up' });
        }
        if (url.pathname === '/api/ops/messages' && req.method === 'GET') {
          const limit = Math.max(1, Math.min(200, +url.searchParams.get('limit') || 50));
          return json(res, 200, { ok: true, messages: OPS.messages.listMessages(OPS.db, { limit, status: url.searchParams.get('status') || null, leadId: url.searchParams.get('leadId') || null }) });
        }
        if (url.pathname === '/api/ops/messages' && req.method === 'POST') {
          const b = await limitedBody(req, 30000);
          return json(res, 201, { ok: true, message: OPS.messages.draftMessage(OPS.db, { leadId: b.leadId, channel: b.channel || 'email', subject: b.subject || '', body: b.body }, 'agente') });
        }
        const msgMatch = url.pathname.match(/^\/api\/ops\/messages\/([^/]+)\/(approve|reject|send|confirm)$/);
        if (msgMatch && req.method === 'POST') {
          const id = decodeURIComponent(msgMatch[1]), action = msgMatch[2];
          if (action === 'approve') return json(res, 200, { ok: true, message: OPS.messages.approveMessage(OPS.db, id) });
          if (action === 'reject') { const b = await limitedBody(req, 4000); return json(res, 200, { ok: true, message: OPS.messages.rejectMessage(OPS.db, id, b.reason || '') }); }
          if (action === 'confirm') return json(res, 200, { ok: true, message: OPS.messages.confirmSent(OPS.db, id) });
          // o estado primeiro, para a recusa ser honesta; depois o token — mas só para o que sai
          // da máquina. O link do WhatsApp é preparado aqui e enviado à mão pelo dono.
          const m = OPS.messages.getMessage(OPS.db, id);
          if (!m) return json(res, 404, { ok: false, error: 'mensagem não encontrada' });
          if (m.status !== 'aprovada') return json(res, 409, { ok: false, error: `só se envia uma mensagem aprovada (está «${m.status}»)` });
          if (m.channel !== 'whatsapp' && !requireIntegrationToken(req, res)) return;
          const out = await OPS.messages.sendMessage(OPS.db, id, { deliver: deliverOut, actor: 'dono' });
          return json(res, 200, { ok: out.delivered || out.manual || false, ...out });
        }
        if (url.pathname === '/api/ops/consent/opt-out' && req.method === 'POST') {
          const b = await limitedBody(req, 4000);
          return json(res, 200, { ok: true, ...OPS.leads.optOut(OPS.db, { email: b.email, phone: b.phone }, b.reason || 'pedido do destinatário', 'dono') });
        }
        if (url.pathname === '/api/ops/queue' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.queue.stats(), jobs: OPS.queue.list({ limit: 25 }) });
        }
        if (url.pathname === '/api/ops/queue/tick' && req.method === 'POST') {
          const done = await OPS.queue.tick();
          return json(res, 200, { ok: true, feito: done });
        }
        if (url.pathname === '/api/ops/events' && req.method === 'GET') {
          const limit = Math.max(1, Math.min(500, +url.searchParams.get('limit') || 100));
          return json(res, 200, { ok: true, events: OPS.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) });
        }
        // ---------- «Hoje»: três perguntas e mais nada ----------
        if (url.pathname === '/api/ops/today' && req.method === 'GET') {
          const since = url.searchParams.get('since') || null;
          const tasks = load().map(t => ({ ...t, agentName: (AGENTS.find(a => a.id === t.agent) || {}).name || t.agent }));
          const view = OPS.today.screen(OPS.db, { office: { tasks, routines: loadRoutines() }, since });
          return json(res, 200, { ok: true, ...view });
        }
        // O interruptor de emergência: um toque e não sai mais nada.
        if (url.pathname === '/api/ops/stop' && req.method === 'POST') {
          const b = await limitedBody(req, 2000);
          const out = OPS.outbox.setStop(OPS.db, b.stop !== false, 'dono', b.why || '');
          console.log(`${out.parado ? '⏹' : '▶'} envios ${out.parado ? 'parados' : 'retomados'} pelo dono`);
          return json(res, 200, { ok: true, ...out });
        }
        if (url.pathname === '/api/ops/outbox' && req.method === 'GET') {
          const limit = Math.max(1, Math.min(200, +url.searchParams.get('limit') || 25));
          return json(res, 200, { ok: true, ...OPS.outbox.stats(OPS.db), items: OPS.outbox.list(OPS.db, { status: url.searchParams.get('status') || null, limit }) });
        }
        // O registo não é uma tabela qualquer: é uma cadeia. Isto prova-o (ou diz onde partiu).
        if (url.pathname === '/api/ops/events/verify' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.events.verify(OPS.db) });
        }
        // ---------- passo 4: autonomia graduada, ensaio e avaliações ----------
        if (url.pathname === '/api/ops/autonomia' && req.method === 'GET') {
          return json(res, 200, { ok: true, tipos: OPS.autonomy.list(OPS.db), propostas: OPS.autonomy.proposals(OPS.db), limiar: OPS.autonomy.thresholds(OPS.db) });
        }
        if (url.pathname === '/api/ops/autonomia/limiar' && req.method === 'POST') {
          const b = await limitedBody(req, 2000);
          return json(res, 200, { ok: true, limiar: OPS.autonomy.setThresholds(OPS.db, b) });
        }
        const autoMatch = url.pathname.match(/^\/api\/ops\/autonomia\/([^/]+)\/(subir|descer)$/);
        if (autoMatch && req.method === 'POST') {
          const scope = decodeURIComponent(autoMatch[1]);
          const b = await limitedBody(req, 2000);
          if (autoMatch[2] === 'subir') return json(res, 200, { ok: true, tipo: OPS.autonomy.grant(OPS.db, scope, { reason: b.reason || '', force: b.force === true }) });
          return json(res, 200, { ok: true, tipo: OPS.autonomy.revoke(OPS.db, scope, { reason: b.reason || '' }) });
        }
        if (url.pathname === '/api/ops/ensaio' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.autonomy.trialReport(OPS.db) });
        }
        if (url.pathname === '/api/ops/ensaio' && req.method === 'POST') {
          const b = await limitedBody(req, 2000);
          return json(res, 200, { ok: true, ...OPS.autonomy.setTrial(OPS.db, b.activo !== false), relatorio: OPS.autonomy.trialReport(OPS.db) });
        }
        const promoteMatch = url.pathname.match(/^\/api\/ops\/messages\/([^/]+)\/promover$/);
        if (promoteMatch && req.method === 'POST') {
          return json(res, 200, { ok: true, message: OPS.messages.promoteFromTrial(OPS.db, decodeURIComponent(promoteMatch[1])) });
        }
        if (url.pathname === '/api/ops/evals' && req.method === 'GET') {
          const historico = OPS.evals.history(OPS.db);
          const ultimo = OPS.db.prepare('SELECT * FROM evals ORDER BY id DESC LIMIT 1').get();
          // A comparação é com a corrida anterior da mesma versão de prompt: descer é notícia.
          const anterior = historico[1] || null;
          const regressao = !!(ultimo && anterior && anterior.prompt_version === ultimo.prompt_version && ultimo.passed < anterior.passed);
          return json(res, 200, {
            ok: true, historico,
            ultimo: ultimo ? { ...ultimo, detail: JSON.parse(ultimo.detail || '[]') } : null,
            regressao,
            aviso: regressao ? `a qualidade desceu: ${anterior.passed}/${anterior.total} antes, ${ultimo.passed}/${ultimo.total} agora` : null,
            versao: OPS.evals.PROMPT_VERSION,
          });
        }
        if (url.pathname === '/api/ops/evals/correr' && req.method === 'POST') {
          const out = await OPS.evals.runAll(OPS.db);
          return json(res, 200, { ok: out.falhou === 0, ...out });
        }

        // ---------- passo 5: saldo e clientes ----------
        if (url.pathname === '/api/ops/saldo' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.money.balance(OPS.db, { days: Math.max(1, +url.searchParams.get('dias') || 90) }) });
        }
        if (url.pathname === '/api/ops/receita' && req.method === 'POST') {
          const b = await limitedBody(req, 4000);
          const cents = b.amountCents !== undefined ? b.amountCents : Math.round((+b.euros || 0) * 100);
          return json(res, 201, { ok: true, receita: OPS.money.record(OPS.db, { amountCents: cents, campaign: b.campaign || '', leadId: b.leadId || '', note: b.note || '' }) });
        }
        const revMatch = url.pathname.match(/^\/api\/ops\/receita\/([^/]+)$/);
        if (revMatch && req.method === 'DELETE') {
          return json(res, 200, OPS.money.remove(OPS.db, decodeURIComponent(revMatch[1])));
        }
        if (url.pathname === '/api/ops/clientes' && req.method === 'GET') {
          const activo = REG ? ops.tenants.active(REG) : null;
          return json(res, 200, {
            ok: true,
            activo: activo ? { id: activo.id, nome: activo.nome } : null,
            clientes: REG ? ops.tenants.list(REG).map(c => ({ ...c, activo: activo?.id === c.id })) : [],
            nota: REG ? null : 'registo de clientes indisponível',
          });
        }
        if (url.pathname === '/api/ops/clientes' && req.method === 'POST') {
          const b = await limitedBody(req, 6000);
          const made = ops.tenants.create(REG, { nome: b.nome, nicho: b.nicho || '', cidade: b.cidade || '', oferta: b.oferta || null, dadosDir: DATA }, 'dono');
          if (b.entrar !== false) switchClient(made.id);
          return json(res, 201, { ok: true, cliente: { ...made, proximosPassos: made.proximosPassos }, activo: b.entrar !== false });
        }
        const enterMatch = url.pathname.match(/^\/api\/ops\/clientes\/([^/]+)\/entrar$/);
        if (enterMatch && req.method === 'POST') {
          const cliente = switchClient(decodeURIComponent(enterMatch[1]));
          return json(res, 200, { ok: true, cliente: { id: cliente.id, nome: cliente.nome } });
        }
        if (url.pathname === '/api/ops/agencia' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...ops.tenants.rollup(REG) });
        }

        // ---------- passo 3: ver o negócio, escrever com factos, aprender ----------
        if (url.pathname === '/api/ops/oferta' && req.method === 'GET') {
          return json(res, 200, { ok: true, oferta: OPS.personalize.offerOf(OPS.db) });
        }
        if (url.pathname === '/api/ops/oferta' && req.method === 'POST') {
          const b = await limitedBody(req, 4000);
          if (b.preco_eur !== undefined && !(+b.preco_eur >= 0)) return json(res, 400, { ok: false, error: 'o preço tem de ser um número' });
          if (b.prazo_dias !== undefined && !(+b.prazo_dias > 0)) return json(res, 400, { ok: false, error: 'o prazo tem de ser em dias' });
          return json(res, 200, { ok: true, oferta: OPS.personalize.setOffer(OPS.db, b) });
        }
        if (url.pathname === '/api/ops/aprendizagem' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.personalize.learningSummary(OPS.db), pesos: OPS.personalize.learnedWeights(OPS.db) });
        }
        const dossierMatch = url.pathname.match(/^\/api\/ops\/leads\/([^/]+)\/(pesquisar|dossier|rascunho)$/);
        if (dossierMatch) {
          const id = decodeURIComponent(dossierMatch[1]), what = dossierMatch[2];
          const lead = OPS.leads.getLead(OPS.db, id);
          if (!lead) return json(res, 404, { ok: false, error: 'lead não encontrado' });
          if (what === 'dossier' && req.method === 'GET') {
            return json(res, 200, { ok: true, ...OPS.research.dossier(OPS.db, lead) });
          }
          if (what === 'pesquisar' && req.method === 'POST') {
            const r = await OPS.research.researchSite(OPS.db, lead, { actor: 'dono' });
            return json(res, 200, { ok: r.status === 'ok' || r.status === 'sem_site', pesquisa: r, ...OPS.research.dossier(OPS.db, lead) });
          }
          if (what === 'rascunho' && req.method === 'POST') {
            const b = await limitedBody(req, 4000);
            // o motor só entra se estiver ligado; sem ele, o modelo local escreve na mesma
            const engine = (AI.active && backend !== 'nenhum')
              ? (system, user, opts) => ask(system, user, opts)
              : null;
            const made = await OPS.personalize.compose(OPS.db, lead, { channel: b.channel || null, ask: engine, actor: 'agente' });
            const m = OPS.messages.draftMessage(OPS.db, {
              leadId: lead.id, channel: made.channel, subject: made.subject, body: made.body,
              predictions: made.predictions, evidenceUsed: made.evidenceUsed, generatedBy: made.generatedBy, why: made.why,
            }, 'agente');
            return json(res, 201, { ok: true, message: m, ...made });
          }
        }
        const signalMatch = url.pathname.match(/^\/api\/ops\/messages\/([^/]+)\/sinal$/);
        if (signalMatch && req.method === 'POST') {
          const b = await limitedBody(req, 4000);
          const m = OPS.messages.getMessage(OPS.db, signalMatch[1]);
          if (!m) return json(res, 404, { ok: false, error: 'mensagem não encontrada' });
          const out = OPS.personalize.recordSignal(OPS.db, { leadId: m.lead_id, messageId: m.id, kind: b.kind, note: b.note || '', actor: 'dono' });
          OPS.personalize.recalibrate(OPS.db);
          return json(res, 200, { ok: true, ...out, lead: OPS.leads.getLead(OPS.db, m.lead_id) });
        }
        // ---------- contas e sessões (só dono: o permFor já o garantiu) ----------
        if (url.pathname === '/api/ops/utilizadores' && req.method === 'GET') {
          return json(res, 200, { ok: true, utilizadores: auth.listUsers(OPS.db), papeis: auth.ROLES, permissoes: auth.PERMS, minimo: auth.PASSWORD_MIN });
        }
        if (url.pathname === '/api/ops/utilizadores' && req.method === 'POST') {
          const b = await limitedBody(req, 8000);
          const user = auth.createUser(OPS.db, { email: b.email, name: b.name || '', password: b.password, role: b.role || 'leitor', actor: AUTH.user?.email || 'dono' });
          return json(res, 201, { ok: true, utilizador: user });
        }
        const userMatch = url.pathname.match(/^\/api\/ops\/utilizadores\/([^/]+)\/(papel|palavra-passe|desactivar)$/);
        if (userMatch && req.method === 'POST') {
          const id = decodeURIComponent(userMatch[1]);
          const b = await limitedBody(req, 8000);
          const actor = AUTH.user?.email || 'dono';
          if (userMatch[2] === 'papel') return json(res, 200, { ok: true, utilizador: auth.setRole(OPS.db, id, b.role, actor) });
          if (userMatch[2] === 'palavra-passe') return json(res, 200, { ok: true, ...auth.setPassword(OPS.db, id, b.password, actor) });
          return json(res, 200, { ok: true, utilizador: auth.deactivate(OPS.db, id, actor) });
        }
        if (url.pathname === '/api/ops/sessoes' && req.method === 'GET') {
          return json(res, 200, { ok: true, sessoes: auth.listSessions(OPS.db, url.searchParams.get('utilizador') || null), horas: auth.sessionHours(process.env) });
        }
        const sessMatch = url.pathname.match(/^\/api\/ops\/sessoes\/([^/]+)$/);
        if (sessMatch && req.method === 'DELETE') {
          const r = auth.revokeSession(OPS.db, decodeURIComponent(sessMatch[1]), { actor: AUTH.user?.email || 'dono', reason: 'revogada na mesa' });
          return json(res, r.ok ? 200 : 404, { ok: r.ok, ...r });
        }
        // ---------- passo 7: tarefas dos departamentos, funil, pesquisa e atividade ----------
        // ---------- ao vivo: o estado real de cada posto, e o fluxo que o mantém fresco ----------
        // O `/aovivo` é um retrato; o `/aovivo/stream` é SSE — o servidor compara a impressão
        // digital do que interessa a cada 800 ms e só fala quando algo mudou de verdade.
        if (url.pathname === '/api/ops/aovivo' && req.method === 'GET') {
          const quem = String(url.searchParams.get('agentes') || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 60);
          return json(res, 200, { ...OPS.live.snapshot(OPS.db, { agents: quem, roster: ROSTER }), serverTime: Date.now() });
        }
        if (url.pathname === '/api/ops/aovivo/stream' && req.method === 'GET') {
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no', // nginx e afins não podem guardar o fluxo num buffer
          });
          const send = (event, data) => {
            try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); return true; } catch { return false; }
          };
          res.write('retry: 3000\n\n'); // se a ligação cair, o cliente volta sozinho em 3 s
          const agents = String(url.searchParams.get('agentes') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
          let fp = '';
          let vivo = true;
          // `alteracoes` diz, em cada evento, que postos mudaram e para que tarefa/estado — o
          // cliente não tem de adivinhar olhando para o retrato inteiro.
          let anterior = {};
          const mudancas = (snap) => {
            const out = [];
            for (const [id, a] of Object.entries(snap.agents)) {
              const chave = `${a.state}|${a.task ? a.task.id : ''}|${a.task ? a.task.state : ''}|${a.last ? a.last.id : ''}`;
              if (anterior[id] !== undefined && anterior[id] !== chave) {
                out.push({ agente: id, estado: a.state, tarefa: a.task?.title || a.last?.title || null, idTarefa: a.task?.id || a.last?.id || null, at: snap.at });
              }
              anterior[id] = chave;
            }
            return out;
          };
          send('hello', { ok: true, serverTime: Date.now(), agents: OPS.live.snapshot(OPS.db, { agents, roster: ROSTER }), intervalo: 800 });
          mudancas(OPS.live.snapshot(OPS.db, { agents, roster: ROSTER }));
          const timer = setInterval(() => {
            if (!vivo) return;
            try {
              const next = OPS.live.fingerprint(OPS.db);
              if (next !== fp) {
                fp = next;
                const snap = OPS.live.snapshot(OPS.db, { agents, roster: ROSTER });
                if (!send('update', { ...snap, alteracoes: mudancas(snap), serverTime: Date.now() })) return;
              } else if (!send('ping', { serverTime: Date.now() })) return;
            } catch (e) {
              send('erro', { error: String(e.message || e).slice(0, 200) });
            }
          }, 800);
          if (timer.unref) timer.unref();
          req.on('close', () => { vivo = false; clearInterval(timer); try { res.end(); } catch { /* já fechado */ } });
          return; // nunca `return json` — a resposta é um fluxo aberto
        }
        if (url.pathname === '/api/ops/agentes' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.tasks.board(OPS.db), resumo: OPS.tasks.summary(OPS.db), tipos: OPS.tasks.KINDS });
        }
        if (url.pathname === '/api/ops/tarefas' && req.method === 'GET') {
          const limit = Math.max(1, Math.min(200, +url.searchParams.get('limit') || 50));
          return json(res, 200, {
            ok: true,
            tarefas: OPS.tasks.list(OPS.db, { limit, dept: url.searchParams.get('departamento') || null, state: url.searchParams.get('estado') || null, entityId: url.searchParams.get('entidade') || null }),
            estados: OPS.tasks.STATE,
            departamentos: OPS.tasks.DEPARTMENTS,
          });
        }
        if (url.pathname === '/api/ops/tarefas' && req.method === 'POST') {
          const b = await limitedBody(req, 20000);
          const { task, existed } = OPS.tasks.create(OPS.db, {
            kind: b.kind, entity: b.entidade || '', entityId: b.entityId || '',
            title: b.title || '', payload: b.payload || {}, approval: !!b.aprovacao,
            timeoutMs: b.timeoutMs || undefined, maxAttempts: b.maxAttempts || undefined, actor: 'dono',
          });
          // com `correr: true` a tarefa corre já, pelo mesmo caminho dos tratadores (nada de atalhos).
          // O estado devolvido é o que ficou escrito — não o que se esperava que acontecesse.
          if (b.correr) {
            if (task.state === 'queued') await OPS.runTask(task.id, { actor: 'dono' });
            const depois = OPS.tasks.get(OPS.db, task.id);
            const falhou = depois.state === 'failed';
            return json(res, falhou ? 409 : existed ? 200 : 201, {
              ok: !falhou, tarefa: depois, existia: existed, error: falhou ? depois.error : null,
            });
          }
          return json(res, existed ? 200 : 201, { ok: true, tarefa: task, existia: existed });
        }
        const tarefaMatch = url.pathname.match(/^\/api\/ops\/tarefas\/([^/]+)\/(correr|aprovar|rejeitar)$/);
        if (tarefaMatch && req.method === 'POST') {
          const id = decodeURIComponent(tarefaMatch[1]), what = tarefaMatch[2];
          const b = await limitedBody(req, 4000).catch(() => ({}));
          if (what === 'correr') {
            const out = await OPS.runTask(id, { actor: 'dono' });
            return json(res, out.ok ? 200 : 409, { ok: out.ok, tarefa: out.task, error: out.error || null });
          }
          const t = what === 'aprovar'
            ? OPS.tasks.approve(OPS.db, id, { actor: 'dono', note: b.note || '' })
            : OPS.tasks.reject(OPS.db, id, { actor: 'dono', reason: b.reason || 'sem autorização' });
          return json(res, 200, { ok: true, tarefa: t });
        }
        if (url.pathname === '/api/ops/pipeline' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.metrics.pipeline(OPS.db) });
        }
        if (url.pathname === '/api/ops/pesquisa' && req.method === 'GET') {
          const q = url.searchParams.get('q') || '';
          return json(res, 200, { ok: true, ...OPS.search.search(OPS.db, q, { limit: Math.max(1, Math.min(20, +url.searchParams.get('limit') || 6)) }) });
        }
        if (url.pathname === '/api/ops/atividade' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.search.activity(OPS.db, { limit: Math.max(1, Math.min(100, +url.searchParams.get('limit') || 25)) }) });
        }
        if (url.pathname === '/api/ops/usage' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...OPS.messages.usageSummary(OPS.db, Math.max(1, +url.searchParams.get('days') || 30)) });
        }
      } catch (e) { return bad(e); }
      return json(res, 404, { ok: false, error: 'rota de operação desconhecida' });
    }

    json(res, 404, { error: 'não encontrado' });
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
});
server.listen(cfg.port, () => {
  if (tokenInfo.created) console.log(`  api: criei ORBITA_API_TOKEN (${tokenInfo.length} caracteres) em ${tokenInfo.source} — as rotas privadas já funcionam${tokenInfo.warning ? ' (aviso: ' + tokenInfo.warning + ')' : ''}`);
  else console.log(`  api: ORBITA_API_TOKEN presente (${tokenInfo.length} caracteres, ${tokenInfo.source})`);
  platform.machine().then((m) => {
    const p = platform.status();
    console.log(`  máquina: ${m.os} · ${m.arch} · ${m.cores} núcleos · ${m.memoryGB} GB · node ${m.node} · shell ${m.shell}`);
    console.log(`  plataforma: ${p.summary.ready} de ${p.summary.total} API(s) prontas · ${p.summary.configured} com chave${p.summary.missingKeys.length ? ' · falta configurar: ' + p.summary.missingKeys.slice(0, 6).join(', ') + (p.summary.missingKeys.length > 6 ? ' (+' + (p.summary.missingKeys.length - 6) + ')' : '') : ''} → /api/platform`);
  }).catch(() => {});
  const fs0 = FORGE.stats();
  console.log(`  oficina: ${fs0.tools} ferramenta(s) · ${fs0.active} activa(s) · ${fs0.runs} execuções · terminal em /api/forge/stream e na tecla F`);
  console.log(`Órbita ${version} → http://localhost:${cfg.port}`);
  const estadoAcesso = auth.authState(OPS?.db);
  const faltaConta = estadoAcesso.modo === 'sessao' && !estadoAcesso.usuarios;
  console.log(`  acesso: ${estadoAcesso.descricao}${faltaConta ? ' → abre /app e cria a primeira conta' : ''}`);
  if (estadoAcesso.modo === 'local') console.log('  aviso: sem contas e sem token, qualquer pessoa com acesso à porta manda. Para expor na rede, cria uma conta em /app (ou define ORBITA_ADMIN_TOKEN).');
  if (estadoAcesso.modo === 'sessao' && estadoAcesso.token) console.log('  nota: há contas E token de máquina — o token vale como dono, sem deixar rasto de quem. Para o desligar: ORBITA_AUTH=sessao.');
  const avail = AI.candidates.filter(c => c.available).map(c => c.label);
  console.log(`  empresa: ${cfg.name}   cérebro: ${BRAIN} (${graph.notes} notas, ${graph.links.length} ligações)`);
  console.log(`  ia: ${AI.active ? AI.active.label + ' (' + backend + (AI.active.model ? ' · ' + AI.active.model : '') + ')' : 'NENHUM MOTOR DISPONÍVEL'} · ${modelName(cfg.model)}${cfg.effort ? ' · esforço ' + cfg.effort : ''} por omissão (encaminhamento no Sonnet)`);
  console.log(`  motores disponíveis: ${avail.length ? avail.join(' · ') : 'nenhum'}${AI.unavailable.length ? '   · indisponíveis: ' + AI.unavailable.slice(0, 3).join(' · ') : ''}`);
  getUsage(true).then(u => console.log(u.source === 'claude' ? `  utilização: sessão ${u.session?.percent ?? '—'}% · semana ${u.week?.percent ?? '—'}% (o teu plano Claude, como o Claude Code o mostra)` : `  utilização: medidor do Claude indisponível (${u.reason}) — a mostrar a contagem do próprio escritório`)).catch(() => {});
  console.log(`  tarefas: ${FILE}   notas escritas pelos agentes: ${NOTES_DIR}`);
  const rl = loadRoutines(); const nx = rl.filter(r => !r.paused && r.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
  console.log(`  rotinas: ${rl.length} carregadas${rl.some(r => r.paused) ? ' (' + rl.filter(r => r.paused).length + ' em pausa)' : ''}${nx ? ' · próxima ' + untilText(nx.nextAt) + ' ' + nx.title.toUpperCase() + ' (' + nx.agent + ')' : ''} · ${rlist.path}`);
  setInterval(tickRoutines, 20000); tickRoutines(); // the clock: every 20 s; the first tick catches up anything missed while the office was off (once, marked LATE)
  console.log(`  agentes: 35 (${roster.customised} personalizados${roster.briefed ? ', ' + roster.briefed + ' com briefing' : ''}${roster.files.length ? ' via ' + roster.files.join(' + ') : ''})   ferramentas: ${runner?.tools ? 'servidores MCP ligados' + (cfg.tools?.web === false ? '' : ' + web') + (mcp.browserOn() ? ' + o Chrome do proprietário (' + (mcp.browserState().installed ? 'extensão emparelhada' + (mcp.browserState().device ? ': ' + mcp.browserState().device : '') : 'extensão NÃO emparelhada — corre `claude --chrome` uma vez') + ')' : '') : (AI.active ? 'nenhuma neste motor — ' + AI.active.id + ' devolve texto, não mexe' : 'nenhuma — não há motor de IA')}`);
  console.log(`  equipas: ${TEAMS.enabled ? 'ligadas — EQUIPA na barra ou «em equipa» na frase; o líder divide por até ' + TEAMS.max + ' secretárias' : 'desligadas (teams.enabled em office.config.json)'}`);
  const sk = skills.summary(); const setup = setupMap(); const notYet = DEPT_KEYS.filter(k => !setup[k]);
  console.log(`  competências: ${sk.count} (${sk.shipped} incluídas em skills/, ${sk.brain} em ${path.join(NOTES_DIR, 'skills')})${sk.problems.length ? '   ⚠ ' + sk.problems.length + ' problema' + (sk.problems.length > 1 ? 's' : '') + ' — ver npm run check' : ''}`);
  console.log(`  configurado: ${notYet.length === DEPT_KEYS.length ? 'nenhum departamento ainda — abre a conversa de um líder e diz «configurar»' : notYet.length ? (DEPT_KEYS.length - notYet.length) + ' de 6 departamentos (ainda não: ' + notYet.map(k => DEPTS[k].name).join(', ') + ')' : 'os seis departamentos'}   lições: ${learn.dir(BRAIN)}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  console.log(`${sig}: a fechar.`);
  try { OPS?.close(); } catch { /* já fechada */ }
  process.exit(0);
});
