// Órbita — a camada de fornecedores de IA (25 out 2026).
//
// O escritório falava só com o Claude Code. Passa a falar com qualquer motor que aceite um
// system prompt e um pedido, e devolva texto:
//
//   · CLI   — Claude Code (`claude`), Codex (`codex`), Gemini (`gemini`) ou qualquer binário
//             configurado com um modelo de argumentos.
//   · API   — Claude (Anthropic), OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Gemini,
//             Ollama e LM Studio. Todas as que falam o dialeto OpenAI vão pelo mesmo caminho.
//
// Regras:
//   · Nada é instalado por nós. Se o binário não existe ou a chave não está no ambiente, o
//     fornecedor aparece como indisponível e a razão é dita em português — não rebentamos.
//   · Só o CLI do Claude recebe ferramentas (servidores MCP + Chrome). Os outros motores
//     devolvem texto; a oficina continua verdadeira, só sem mãos.
//   · A escolha vive em `office.config.json` → `ai`, ou no ambiente (AO_AI, AO_AI_MODEL), ou
//     ainda em `data/ai.json` quando alguém a troca pela API do servidor.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as mcp from './mcp.mjs';
import { modelId, normModel } from './src/models.js';

const CLI_CWD = path.join(os.tmpdir(), 'agents-office-cli');

/* ---------- os motores que conhecemos ---------- */
export const PRESETS = {
  'claude-cli': {
    label: 'Claude Code', kind: 'cli', bin: 'claude', tools: true,
    args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--system-prompt', '{system}'],
    models: { sonnet: 'sonnet', opus: 'opus', fable: 'fable' },
    hint: 'instala com `npm i -g @anthropic-ai/claude-code` e corre `claude` uma vez para entrar',
  },
  'codex-cli': {
    label: 'Codex', kind: 'cli', bin: 'codex', tools: false,
    args: ['exec', '--skip-git-repo-check', '--model', '{model}', '{prompt}'],
    models: { sonnet: '', opus: '', fable: '' },   // vazio = o modelo que o próprio Codex tiver configurado
    hint: 'instala com `npm i -g @openai/codex` e corre `codex` uma vez para entrar',
  },
  'gemini-cli': {
    label: 'Gemini', kind: 'cli', bin: 'gemini', tools: false,
    args: ['-p', '{prompt}', '--model', '{model}'],
    models: { sonnet: '', opus: '', fable: '' },
    hint: 'instala com `npm i -g @google/gemini-cli` e corre `gemini` uma vez para entrar',
  },
  'cli': {
    label: 'CLI personalizada', kind: 'cli', bin: '', tools: false,
    args: ['{prompt}'],
    models: { sonnet: '', opus: '', fable: '' },
    hint: 'define `ai.bin` e `ai.args` (usa {prompt}, {system} e {model})',
  },

  'anthropic': {
    label: 'Claude (API)', kind: 'api', style: 'anthropic', baseUrl: 'https://api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5',
    models: { sonnet: 'claude-sonnet-5', opus: 'claude-opus-5', fable: 'claude-fable-5-1' },
    hint: 'ANTHROPIC_API_KEY no ambiente',
  },
  'openai': {
    label: 'OpenAI', kind: 'api', style: 'openai', baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY', model: '',
    hint: 'OPENAI_API_KEY + o modelo em `ai.model` (ou AO_AI_MODEL)',
  },
  'openrouter': {
    label: 'OpenRouter', kind: 'api', style: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY', model: '',
    hint: 'OPENROUTER_API_KEY + um modelo tipo `anthropic/claude-sonnet-5`',
  },
  'groq': {
    label: 'Groq', kind: 'api', style: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY', model: '',
    hint: 'GROQ_API_KEY + o modelo em `ai.model`',
  },
  'mistral': {
    label: 'Mistral', kind: 'api', style: 'openai', baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY', model: '',
    hint: 'MISTRAL_API_KEY + o modelo em `ai.model`',
  },
  'deepseek': {
    label: 'DeepSeek', kind: 'api', style: 'openai', baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY', model: '',
    hint: 'DEEPSEEK_API_KEY + o modelo em `ai.model`',
  },
  'xai': {
    label: 'xAI', kind: 'api', style: 'openai', baseUrl: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY', model: '',
    hint: 'XAI_API_KEY + o modelo em `ai.model`',
  },
  'gemini': {
    label: 'Gemini (API)', kind: 'api', style: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY', model: '',
    hint: 'GEMINI_API_KEY + o modelo em `ai.model`',
  },
  'ollama': {
    label: 'Ollama (local)', kind: 'api', style: 'openai', baseUrl: 'http://127.0.0.1:11434/v1',
    keyEnv: '', model: 'llama3.2', noKey: true,
    hint: 'corre `ollama serve` e `ollama pull llama3.2`',
  },
  'lmstudio': {
    label: 'LM Studio (local)', kind: 'api', style: 'openai', baseUrl: 'http://127.0.0.1:1234/v1',
    keyEnv: '', model: 'local-model', noKey: true,
    hint: 'abre o LM Studio e liga o servidor local (porta 1234)',
  },
  'openai-compatible': {
    label: 'API compatível com OpenAI', kind: 'api', style: 'openai', baseUrl: '',
    keyEnv: 'AO_AI_KEY', model: '',
    hint: 'define `ai.baseUrl`, `ai.keyEnv` e `ai.model` — serve para qualquer endpoint /chat/completions',
  },
};

export const IDS = Object.keys(PRESETS);

/* ---------- utilidades ---------- */
const onPath = bin => {
  if (!bin) return null;
  if (bin.includes('/')) return fs.existsSync(bin) ? bin : null;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* segue */ }
  }
  return null;
};

function readJSON(p, fallback = {}) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }

/** A definição efetiva de um fornecedor: preset + o que o proprietário escreveu em `ai.providers[id]`. */
export function define(id, cfg = {}) {
  const ai = cfg.ai || {};
  const preset = PRESETS[id];
  const custom = (ai.providers || {})[id] || {};
  const base = preset || { label: id, kind: 'api', style: 'openai', hint: 'fornecedor definido em office.config.json → ai.providers' };
  const d = { id, ...base, ...custom };
  // o modelo: o do fornecedor, depois o do escritório para esse id, depois o ambiente
  const envModel = process.env.AO_AI_MODEL;
  const models = { ...(base.models || {}), ...(custom.models || {}) };
  d.models = models;
  d.model = custom.model
    || envModel
    || (ai.models || {})[id]
    || (base.model || Object.values(models).find(Boolean) || '');
  // chave: só do ambiente, nunca de um ficheiro versionado
  d.hasKey = d.noKey ? true : (d.keyEnv ? !!process.env[d.keyEnv] : false);
  return d;
}

/** Porque é que este fornecedor não pode correr agora — ou null se pode. */
export function why(d) {
  if (d.probed === false) return d.probeReason || `${d.label}: nada a responder em ${d.baseUrl}`;
  if (d.kind === 'cli') {
    if (!d.bin) return `${d.label}: falta o binário (define ai.providers.${d.id}.bin)`;
    if (!onPath(d.bin)) return `${d.label}: \`${d.bin}\` não está no PATH — ${d.hint || 'instala-o'}`;
    return null;
  }
  if (!d.baseUrl) return `${d.label}: falta o endereço (ai.providers.${d.id}.baseUrl)`;
  if (!d.hasKey) return `${d.label}: falta a chave — põe ${d.keyEnv} no ambiente`;
  if (!d.model) return `${d.label}: falta o modelo (ai.model, AO_AI_MODEL ou ai.providers.${d.id}.model)`;
  return null;
}

/** O modelo a usar neste turno, dado o nome da casa (sonnet · opus · fable). */
export function modelFor_(d, houseModel) {
  const key = normModel(houseModel);
  if (key && d.models && d.models[key]) return d.models[key];
  return d.model || '';
}

/* ---------- resolução: quem está disponível, por que ordem ---------- */
export function resolve(cfg = {}, dataDir = null) {
  const ai = cfg.ai || {};
  const saved = dataDir ? readJSON(path.join(dataDir, 'ai.json'), {}) : {};
  const wanted = process.env.AO_AI || saved.provider || ai.provider || 'auto';

  // todos os ids que interessam: os pedidos, os de fallback, os definidos à mão, e os presets
  const order = [];
  const push = id => { if (id && !order.includes(id)) order.push(id); };
  if (wanted && wanted !== 'auto') push(wanted);
  for (const id of (ai.fallback || [])) push(id);
  for (const id of Object.keys(ai.providers || {})) push(id);
  for (const id of IDS) push(id);

  const candidates = order.map(id => {
    const d = define(id, cfg);
    // um servidor local (Ollama/LM Studio) não tem chave: só uma sonda prova que está lá. Até lá
    // não conta como disponível — não se promete um motor que talvez não responda.
    const pending = d.kind === 'api' && d.noKey;
    const problem = pending ? `${d.label}: por confirmar em ${d.baseUrl}` : why(d);
    return { ...d, pending, available: pending ? false : !problem, reason: problem, tools: d.kind === 'cli' && !!d.tools };
  });
  const unproven = candidates.filter(c => c.pending);
  const active = candidates.find(c => c.available) || null;
  return {
    unproven: unproven.map(c => c.id),
    active,
    candidates,
    requested: wanted,
    saved: saved.provider || null,
    unavailable: candidates.filter(c => !c.available).map(c => c.reason),
  };
}

/** Os servidores locais (Ollama, LM Studio) não têm chave: a única prova é responderem. Uma
 *  sonda curta a /models decide se entram na lista de motores utilizáveis. */
export async function probe(res, ms = 800) {
  for (const c of res.candidates) {
    if (!(c.kind === 'api' && c.noKey && c.baseUrl)) continue;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(`${c.baseUrl.replace(/\/$/, '')}/models`, { signal: ac.signal });
      c.probed = r.ok;
      if (!r.ok) c.probeReason = `${c.label}: respondeu ${r.status} em ${c.baseUrl}`;
    } catch {
      c.probed = false;
      c.probeReason = `${c.label}: nada a responder em ${c.baseUrl} — ${c.hint || 'liga o servidor local'}`;
    } finally { clearTimeout(timer); }
    c.pending = false;
    const problem = why(c);
    c.available = !problem;
    c.reason = problem;
  }
  res.active = pick(res);
  res.unavailable = res.candidates.filter(c => !c.available).map(c => c.reason);
  return res;
}

/** Quem fica ativo: o primeiro utilizável. Se nenhum estiver, ninguém — um escritório sem motor
 *  diz que não tem motor e explica o que falta, em vez de fingir que tem. */
export function pick(res) {
  return res.candidates.find(c => c.available) || null;
}

/* ---------- os runners ---------- */
function timeoutError(ms) { return new Error(`O modelo demorou mais de ${Math.round(ms / 1000)} s`); }

async function askHttp(d, { system, user, maxTokens = 4000, timeout = 300000, model }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const want = model || d.model;
  try {
    if (d.style === 'anthropic') {
      const res = await fetch(`${d.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST', signal: ac.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env[d.keyEnv] || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: want, max_tokens: maxTokens,
          system: system ? [{ type: 'text', text: system }] : undefined,
          messages: [{ role: 'user', content: user }],
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${d.label} respondeu ${res.status}${j.error?.message ? ': ' + j.error.message : ''}`);
      const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const u = j.usage || {};
      return {
        text, tools: [], modelId: j.model || want,
        usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 },
      };
    }
    // dialeto OpenAI: /chat/completions — serve OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI,
    // Gemini (endpoint compatível), Ollama e LM Studio
    const headers = { 'content-type': 'application/json' };
    if (d.keyEnv && process.env[d.keyEnv]) headers.authorization = `Bearer ${process.env[d.keyEnv]}`;
    const res = await fetch(`${d.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: ac.signal, headers,
      body: JSON.stringify({
        model: want, max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${d.label} respondeu ${res.status}${j.error?.message ? ': ' + j.error.message : ''}`);
    const text = (j.choices?.[0]?.message?.content || '').trim();
    const u = j.usage || {};
    return {
      text, tools: [], modelId: j.model || want,
      usage: { input_tokens: u.prompt_tokens || u.input_tokens || 0, output_tokens: u.completion_tokens || u.output_tokens || 0 },
    };
  } finally { clearTimeout(timer); }
}

/** Arranca um binário e devolve o texto. `{prompt}`, `{system}` e `{model}` são substituídos nos
 *  argumentos; se o modelo de argumentos não tiver `{prompt}`, o pedido vai pelo stdin. */
function askCli(d, { system, user, timeout = 300000, model }) {
  fs.mkdirSync(CLI_CWD, { recursive: true }); // sem isto o spawn rebenta com ENOENT (cwd inexistente)
  const want = model || d.model || '';
  const args = (d.args || ['{prompt}']).map(a => String(a)
    .replaceAll('{prompt}', user).replaceAll('{system}', system || '').replaceAll('{model}', want))
    .filter(a => a !== '' || true);
  const viaStdin = !(d.args || []).some(a => String(a).includes('{prompt}'));
  const bin = onPath(d.bin) || d.bin;
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: CLI_CWD, env: { ...process.env, CLAUDECODE: '' }, stdio: [viaStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(timeoutError(timeout)); }, timeout);
    p.stdout.on('data', dd => { out += dd; });
    p.stderr.on('data', dd => { err += dd; });
    p.on('error', e => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? `${d.label}: \`${d.bin}\` não encontrado` : e.message));
    });
    if (viaStdin) { try { p.stdin.write(user); p.stdin.end(); } catch { /* ignora */ } }
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) return reject(new Error(`${d.bin} saiu com ${code}${err ? ': ' + err.trim().slice(0, 300) : ''}`));
      resolve({ text: out.trim(), tools: [], modelId: want || d.bin });
    });
  });
}

/** O runner do Claude Code: mantém tudo o que o escritório já sabia fazer — stream-json, MCP,
 *  o Chrome do proprietário, o modelo e o esforço. */
export function askClaudeCli(d, opts, hooks) {
  const { system, user, maxTokens = 4000, timeout = 300000, model, effort = null, tools = true } = opts;
  fs.mkdirSync(CLI_CWD, { recursive: true });
  const allowed = tools ? hooks.allowedTools() : [];
  const args = ['-p', user, '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--system-prompt', system,
    '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,Agent,NotebookEdit,Task' + (allowed.includes('WebFetch') ? '' : ',WebFetch,WebSearch')];
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  args.push(...(tools ? hooks.cliArgs() : ['--no-chrome']));
  args.push(...hooks.modelArgs(model, effort));
  const env = { ...process.env }; delete env.CLAUDECODE;
  return new Promise((resolve, reject) => {
    const p = spawn(onPath('claude') || 'claude', args, { cwd: CLI_CWD, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', text = '', used = [], gotResult = false, usageOut = null, modelUsed = null;
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(timeoutError(timeout)); }, timeout);
    const feed = line => {
      if (!line.trim()) return;
      let j; try { j = JSON.parse(line); } catch { return; }
      if (j.type === 'system' && j.subtype === 'init') hooks.fromInit?.(j);
      if (j.type === 'assistant' && j.message?.content) for (const b of j.message.content) if (b.type === 'tool_use' && b.name && !used.includes(b.name)) used.push(b.name);
      if (j.type === 'result') { gotResult = true; text = String(j.result || '').trim(); usageOut = j.usage || null; modelUsed = hooks.ranOn(j.modelUsage, model); }
    };
    p.stdout.on('data', dd => { out += dd; let i; while ((i = out.indexOf('\n')) >= 0) { feed(out.slice(0, i)); out = out.slice(i + 1); } });
    p.stderr.on('data', dd => { err += dd; });
    p.on('error', e => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? 'O Claude Code não está instalado (claude não encontrado no PATH)' : e.message)); });
    p.on('close', code => {
      clearTimeout(timer); feed(out);
      if (code !== 0 && !gotResult) return reject(new Error(`claude exited ${code}${err ? ': ' + err.trim().slice(0, 300) : ''}`));
      if (!gotResult) { try { text = String(JSON.parse(out).result || '').trim(); } catch { text = out.trim(); } }
      resolve({ text, tools: used, usage: usageOut, modelId: modelUsed });
    });
  });
}

/** Cria o runner de um fornecedor já resolvido. `hooks` traz o que é específico do escritório
 *  (allowedTools, modelArgs, ranOn) para este módulo não depender do serve.mjs. */
export function makeRunner(entry, cfg = {}, hooks = {}) {
  const d = entry;
  if (!d) return {
    id: null, label: 'nenhum motor', kind: null, tools: false, model: null,
    askX: async () => { throw new Error('Nenhum motor de IA disponível nesta máquina — vê /api/ai (ou AI.md) para ligar um'); },
    ask: async () => { throw new Error('Nenhum motor de IA disponível nesta máquina — vê /api/ai (ou AI.md) para ligar um'); },
  };
  const askX = async (opts) => {
    if (!d || !d.available) throw new Error(`Nenhum motor de IA disponível — ${d?.reason || 'ver /api/ai'}`);
    if (d.id === 'claude-cli' && hooks.askClaudeCli) return hooks.askClaudeCli(d, opts);
    if (d.kind === 'cli') return askCli(d, opts);
    return askHttp(d, { ...opts, model: opts.model ? modelFor_(d, opts.model) : modelFor_(d, cfg.model) });
  };
  return {
    id: d.id, label: d.label, kind: d.kind, tools: !!d.tools, model: d.model,
    askX,
    ask: async (system, user, opts = {}) => (await askX({ system, user, tools: false, ...opts })).text,
  };
}

/** Resumo para /api/health e /api/ai. */
export function summary(res, cfg = {}) {
  const { active } = res;
  return {
    requested: res.requested,
    active: active ? { id: active.id, label: active.label, kind: active.kind, model: active.model, tools: !!active.tools } : null,
    available: res.candidates.filter(c => c.available).map(c => ({ id: c.id, label: c.label, kind: c.kind, model: c.model, tools: !!c.tools })),
    unavailable: res.candidates.filter(c => !c.available).map(c => ({ id: c.id, label: c.label, reason: c.reason })),
    providers: res.candidates.map(c => ({
      id: c.id, label: c.label, kind: c.kind, style: c.style || null, bin: c.bin || null,
      baseUrl: c.baseUrl || null, keyEnv: c.keyEnv || null, model: c.model || null,
      tools: !!c.tools, available: !!c.available, pending: !!c.pending, reason: c.reason, hint: c.hint || '',
    })),
    note: active && active.kind === 'cli' && active.id !== 'claude-cli'
      ? 'este motor devolve texto: os agentes não recebem ferramentas nem o Chrome enquanto estiver ativo'
      : null,
  };
}
