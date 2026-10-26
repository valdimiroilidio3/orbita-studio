// Órbita — configuration (Beta).
// office.config.json is the shipped default; office.config.local.json (gitignored) overrides it;
// environment variables override both: AO_NAME, AO_BRAIN, PORT, AO_MODEL.
// V3.1 keys: mcp { allow, deny, departments } · tools { web } · timeout (seconds per agent run) — see mcp.mjs.
// V3.2 (16 Sep) keys: tools { browser } (Claude in Chrome for the agents, default on) · teams { enabled, max } (Agent Teams, default on, up to 4 desks) — see teams.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

// 26 out 2026: o .env do projeto é lido aqui, antes de qualquer configuração. Sem dependências e
// sem sobrepor o que já está no ambiente (uma variável exportada ganha sempre ao ficheiro).
// Sem isto, o passo "cp .env.example .env" do guia não teria efeito nenhum.
export function loadEnv(file = path.join(ROOT, '.env')) {
  const loaded = [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return loaded; } // sem .env é um estado válido
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] !== undefined) continue; // o ambiente manda
    process.env[key] = value;
    if (value) loaded.push(key);
  }
  return loaded;
}
loadEnv();

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function loadConfig() {
  const base = readJSON(path.join(ROOT, 'office.config.json'));
  const local = readJSON(path.join(ROOT, 'office.config.local.json'));
  const c = { name: 'Órbita', brain: './brain', port: 4520, model: 'sonnet', ...base, ...local }; // V3.6: model = sonnet · opus · fable
  c.mcp = { allow: [], deny: [], departments: {}, ...(base.mcp || {}), ...(local.mcp || {}) };
  c.tools = { web: true, browser: true, ...(base.tools || {}), ...(local.tools || {}) }; // V3.2 (16 Sep): browser = Claude in Chrome
  c.teams = { enabled: true, max: 4, ...(base.teams || {}), ...(local.teams || {}) }; // V3.2 (16 Sep): Agent Teams
  // V4 (25 out 2026): `ai` escolhe o motor — provider · fallback · models · providers (ver providers.mjs e AI.md)
  c.ai = { provider: 'auto', fallback: [], models: {}, providers: {}, ...(base.ai || {}), ...(local.ai || {}) };
  c.ai.models = { ...(base.ai?.models || {}), ...(local.ai?.models || {}) };
  c.ai.providers = { ...(base.ai?.providers || {}), ...(local.ai?.providers || {}) };
  if (process.env.AO_AI) c.ai.provider = process.env.AO_AI;
  if (process.env.AO_NAME) c.name = process.env.AO_NAME;
  if (process.env.AO_BRAIN) c.brain = process.env.AO_BRAIN;
  if (process.env.PORT) c.port = +process.env.PORT;
  if (process.env.AO_MODEL) c.model = process.env.AO_MODEL;
  c.port = +c.port || 4520;
  c.brainPath = path.resolve(ROOT, c.brain);
  return c;
}
