// Órbita — A PLATAFORMA: as APIs reais, a máquina, e o arranque sem configuração (28 out 2026).
//
// Pedido do dono: «implementa entrada de API real; assim que lançar o projecto, colocar a API já deve
// funcionar de forma automática; faz esse preparo agora, para todos os tipos de app; as APIs devem
// funcionar logo, instantaneamente.»
//
// A ideia, dita sem marketing:
//   1. Há UM catálogo de serviços (IA, pagamentos, correio, base de dados, deploy, mensagens, dados).
//   2. No arranque o servidor lê o `.env`, vê que chaves existem e SONDA cada serviço configurado —
//      uma chamada real, com prazo, sem nunca escrever a chave em lado nenhum.
//   3. Quando o `.env` muda, ninguém tem de reiniciar nada: o ficheiro é vigiado, as chaves entram a
//      quente e as sondas correm outra vez. É o «instantaneamente» do pedido.
//   4. `GET /api/platform` devolve o retrato — máquina, versões, o que está pronto, o que falta e
//      qual é o nome da variável que falta. Com CORS aberto, qualquer app (web, mobile, outro
//      servidor) consegue ler isto no arranque dela e saber com o que conta.
//
// O que este módulo NÃO faz: não inventa «pronto». Um serviço só é `ready` depois de uma sonda real
// ter respondido; quem não tem chave aparece como `configured:false` com a chave que falta escrita.
// Serviços que não têm sonda barata (AWS, contas de serviço Google) dizem-no (`verified:false`).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROBE_TIMEOUT_MS = 6000;
const PROBE_TTL_MS = 10 * 60 * 1000;      // uma sonda vale 10 minutos
const MACHINE_TTL_MS = 60 * 1000;
const TOOLS_TTL_MS = 5 * 60 * 1000;

/* ---------- o catálogo ----------
   `env`: TODAS as variáveis listadas têm de existir. `probe`: uma chamada barata e sem efeitos
   secundários (um GET de metadados). `headers(env)` devolve os cabeçalhos — a chave nunca sai daqui
   para fora do processo a não ser dentro do pedido ao serviço. */
export const CATALOG = [
  { id: 'openai', name: 'OpenAI', kind: 'ia', env: ['OPENAI_API_KEY'], docs: 'https://platform.openai.com/docs',
    probe: { url: 'https://api.openai.com/v1/models', headers: (e) => ({ authorization: `Bearer ${e.OPENAI_API_KEY}` }) } },
  { id: 'anthropic', name: 'Anthropic / Claude', kind: 'ia', env: ['ANTHROPIC_API_KEY'], docs: 'https://docs.anthropic.com',
    probe: { url: 'https://api.anthropic.com/v1/models', headers: (e) => ({ 'x-api-key': e.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }) } },
  { id: 'gemini', name: 'Google Gemini', kind: 'ia', env: ['GEMINI_API_KEY'], docs: 'https://ai.google.dev',
    probe: { url: (e) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(e.GEMINI_API_KEY)}` } },
  { id: 'openrouter', name: 'OpenRouter', kind: 'ia', env: ['OPENROUTER_API_KEY'], docs: 'https://openrouter.ai/docs',
    probe: { url: 'https://openrouter.ai/api/v1/key', headers: (e) => ({ authorization: `Bearer ${e.OPENROUTER_API_KEY}` }) } },
  { id: 'groq', name: 'Groq', kind: 'ia', env: ['GROQ_API_KEY'], docs: 'https://console.groq.com/docs',
    probe: { url: 'https://api.groq.com/openai/v1/models', headers: (e) => ({ authorization: `Bearer ${e.GROQ_API_KEY}` }) } },
  { id: 'mistral', name: 'Mistral', kind: 'ia', env: ['MISTRAL_API_KEY'], docs: 'https://docs.mistral.ai',
    probe: { url: 'https://api.mistral.ai/v1/models', headers: (e) => ({ authorization: `Bearer ${e.MISTRAL_API_KEY}` }) } },
  { id: 'huggingface', name: 'Hugging Face', kind: 'ia', env: ['HF_TOKEN'], docs: 'https://huggingface.co/docs/api-inference',
    probe: { url: 'https://huggingface.co/api/whoami-v2', headers: (e) => ({ authorization: `Bearer ${e.HF_TOKEN}` }) } },
  { id: 'replicate', name: 'Replicate', kind: 'ia', env: ['REPLICATE_API_TOKEN'], docs: 'https://replicate.com/docs',
    probe: { url: 'https://api.replicate.com/v1/account', headers: (e) => ({ authorization: `Bearer ${e.REPLICATE_API_TOKEN}` }) } },
  { id: 'elevenlabs', name: 'ElevenLabs (voz)', kind: 'ia', env: ['ELEVENLABS_API_KEY'], docs: 'https://elevenlabs.io/docs',
    probe: { url: 'https://api.elevenlabs.io/v1/user', headers: (e) => ({ 'xi-api-key': e.ELEVENLABS_API_KEY }) } },

  { id: 'google-places', name: 'Google Places / Geocoding', kind: 'dados', env: ['GOOGLE_MAPS_API_KEY'], docs: 'https://developers.google.com/maps/documentation/places',
    probe: { url: (e) => `https://maps.googleapis.com/maps/api/geocode/json?address=Coimbra&key=${encodeURIComponent(e.GOOGLE_MAPS_API_KEY)}` },
    ok: (r, body) => body && body.status === 'OK' },
  { id: 'google-search', name: 'Google Programmable Search', kind: 'dados', env: ['GOOGLE_SEARCH_KEY', 'GOOGLE_SEARCH_CX'], docs: 'https://developers.google.com/custom-search/v1/overview',
    probe: { url: (e) => `https://www.googleapis.com/customsearch/v1?q=orbita&num=1&key=${encodeURIComponent(e.GOOGLE_SEARCH_KEY)}&cx=${encodeURIComponent(e.GOOGLE_SEARCH_CX)}` } },

  { id: 'supabase', name: 'Supabase', kind: 'base-de-dados', env: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], docs: 'https://supabase.com/docs/guides/api',
    probe: { url: (e) => `${String(e.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/`, headers: (e) => ({ apikey: e.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}` }) },
    note: 'A chave service-role é poder absoluto: fica só no servidor.' },
  { id: 'airtable', name: 'Airtable', kind: 'base-de-dados', env: ['AIRTABLE_TOKEN'], docs: 'https://airtable.com/developers/web/api/introduction',
    probe: { url: 'https://api.airtable.com/v0/meta/whoami', headers: (e) => ({ authorization: `Bearer ${e.AIRTABLE_TOKEN}` }) } },
  { id: 'notion', name: 'Notion', kind: 'base-de-dados', env: ['NOTION_TOKEN'], docs: 'https://developers.notion.com',
    probe: { url: 'https://api.notion.com/v1/users/me', headers: (e) => ({ authorization: `Bearer ${e.NOTION_TOKEN}`, 'notion-version': '2022-06-28' }) } },

  { id: 'github', name: 'GitHub', kind: 'codigo', env: ['GITHUB_TOKEN'], docs: 'https://docs.github.com/rest',
    probe: { url: 'https://api.github.com/rate_limit', headers: (e) => ({ authorization: `Bearer ${e.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' }) } },
  { id: 'vercel', name: 'Vercel', kind: 'deploy', env: ['VERCEL_TOKEN'], docs: 'https://vercel.com/docs/rest-api',
    probe: { url: 'https://api.vercel.com/v2/user', headers: (e) => ({ authorization: `Bearer ${e.VERCEL_TOKEN}` }) } },
  { id: 'cloudflare', name: 'Cloudflare', kind: 'deploy', env: ['CLOUDFLARE_API_TOKEN'], docs: 'https://developers.cloudflare.com/api',
    probe: { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: (e) => ({ authorization: `Bearer ${e.CLOUDFLARE_API_TOKEN}` }) } },
  { id: 'aws', name: 'Amazon Web Services', kind: 'deploy', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], docs: 'https://docs.aws.amazon.com',
    probe: null, note: 'Assinatura SigV4: não há sonda barata sem região. Configurado ≠ verificado.' },

  { id: 'stripe', name: 'Stripe', kind: 'pagamentos', env: ['STRIPE_SECRET_KEY'], docs: 'https://stripe.com/docs/api',
    probe: { url: 'https://api.stripe.com/v1/balance', headers: (e) => ({ authorization: `Bearer ${e.STRIPE_SECRET_KEY}` }) } },
  { id: 'shopify', name: 'Shopify Admin', kind: 'loja', env: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'], docs: 'https://shopify.dev/docs/api/admin-rest',
    probe: { url: (e) => `https://${String(e.SHOPIFY_STORE_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '')}/admin/api/2024-07/shop.json`, headers: (e) => ({ 'x-shopify-access-token': e.SHOPIFY_ADMIN_TOKEN }) } },

  { id: 'resend', name: 'Resend (email)', kind: 'mensagens', env: ['RESEND_API_KEY'], docs: 'https://resend.com/docs/api-reference',
    probe: { url: 'https://api.resend.com/domains', headers: (e) => ({ authorization: `Bearer ${e.RESEND_API_KEY}` }) } },
  { id: 'sendgrid', name: 'SendGrid', kind: 'mensagens', env: ['SENDGRID_API_KEY'], docs: 'https://docs.sendgrid.com/api-reference',
    probe: { url: 'https://api.sendgrid.com/v3/scopes', headers: (e) => ({ authorization: `Bearer ${e.SENDGRID_API_KEY}` }) } },
  { id: 'twilio', name: 'Twilio (SMS)', kind: 'mensagens', env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], docs: 'https://www.twilio.com/docs/usage/api',
    probe: { url: (e) => `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(e.TWILIO_ACCOUNT_SID)}.json`, headers: (e) => ({ authorization: 'Basic ' + Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64') }) } },
  { id: 'telegram', name: 'Telegram Bot', kind: 'mensagens', env: ['TELEGRAM_BOT_TOKEN'], docs: 'https://core.telegram.org/bots/api',
    probe: { url: (e) => `https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/getMe` } },
  { id: 'slack', name: 'Slack', kind: 'mensagens', env: ['SLACK_BOT_TOKEN'], docs: 'https://api.slack.com/methods',
    probe: { url: 'https://slack.com/api/auth.test', method: 'POST', headers: (e) => ({ authorization: `Bearer ${e.SLACK_BOT_TOKEN}` }) },
    ok: (r, body) => body && body.ok === true },
  { id: 'discord', name: 'Discord Bot', kind: 'mensagens', env: ['DISCORD_BOT_TOKEN'], docs: 'https://discord.com/developers/docs',
    probe: { url: 'https://discord.com/api/v10/users/@me', headers: (e) => ({ authorization: `Bot ${e.DISCORD_BOT_TOKEN}` }) } },
  { id: 'meta', name: 'Meta / Instagram Graph', kind: 'redes', env: ['META_ACCESS_TOKEN'], docs: 'https://developers.facebook.com/docs/graph-api',
    probe: { url: (e) => `https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(e.META_ACCESS_TOKEN)}` },
    note: 'Publicar exige conta profissional e permissões aprovadas.' },
];

const TOOL_NAMES = ['git', 'gh', 'node', 'npm', 'python3', 'docker', 'claude', 'codex', 'gemini', 'rg', 'curl', 'ffmpeg', 'sqlite3'];

const whichCmd = () => (process.platform === 'win32' ? 'where' : 'which');
const redactValue = (text, env) => {
  let out = String(text || '');
  for (const v of Object.values(env)) {
    const s = String(v || '');
    if (s.length >= 8) out = out.split(s).join('***');
  }
  return out;
};
const oneLine = (s, max = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

function execP(cmd, args, timeout = 1200) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
        if (err && !stdout && !stderr) return resolve(null);
        resolve(String(stdout || stderr || '').trim());
      });
    } catch { resolve(null); }
  });
}

/**
 * O token interno da API (`ORBITA_API_TOKEN`), sem passos manuais.
 *
 * As rotas que escrevem para fora (enviar email, publicar, deploy, CRM) exigem este token com 32+
 * caracteres. Pedir ao dono «gera um token e mete no .env» é o passo manual que ele mandou acabar:
 * por isso, no arranque, se não houver token em lado nenhum, gera-se um (256 bits), escreve-se no
 * `.env` e usa-se. Se já existir um — no ambiente ou no ficheiro — não se toca em nada.
 */
export function ensureApiToken({ root = ROOT, env = process.env } = {}) {
  const file = path.join(root, '.env');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* primeiro arranque */ }
  const fromFile = parseEnvFile(text);
  const existing = String(env.ORBITA_API_TOKEN || fromFile.ORBITA_API_TOKEN || '').trim();
  if (existing.length >= 32) {
    if (!env.ORBITA_API_TOKEN) env.ORBITA_API_TOKEN = existing;
    return { created: false, source: env.ORBITA_API_TOKEN === existing && !fromFile.ORBITA_API_TOKEN ? 'ambiente' : '.env', length: existing.length };
  }
  const token = crypto.randomBytes(32).toString('base64url');    // 43 caracteres
  const line = `# gerado por Órbita no primeiro arranque (${new Date().toISOString().slice(0, 10)}): assina as rotas privadas\nORBITA_API_TOKEN=${token}\n`;
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  try {
    fs.appendFileSync(file, sep + (text ? '\n' : '') + line, { mode: 0o600 });
  } catch (e) {
    // sem permissão para escrever o .env: a API funciona na mesma nesta sessão, mas morre no reinício
    env.ORBITA_API_TOKEN = token;
    return { created: true, source: 'memória (não consegui escrever o .env)', length: token.length, warning: oneLine(e.message, 120) };
  }
  // uma linha antiga e curta (ex.: ORBITA_API_TOKEN=curto) fica lá e passaria à frente; o ambiente
  // manda sobre o ficheiro, por isso basta pôr a chave no ambiente.
  env.ORBITA_API_TOKEN = token;
  return { created: true, source: '.env', length: token.length };
}

/** Lê um `.env` sem dependências. Devolve os pares e não toca no ambiente. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v.replace(/\\n/g, '\n');
  }
  return out;
}

export function createPlatform({
  root = ROOT,
  env = process.env,
  fetchImpl = globalThis.fetch,
  dataDir = path.join(root, 'data'),
  now = () => Date.now(),
} = {}) {
  const envFile = path.join(root, '.env');
  const customFile = path.join(dataDir, 'api', 'providers.json');
  const cache = new Map();          // id → { at, ok, status, ms, error }
  const fromFile = new Set();       // chaves que vieram do .env (o ambiente real manda sempre)
  let machineAt = 0, machineData = null, toolsAt = 0, toolsData = null;
  let reloads = 0, lastReloadAt = null;

  /* ---------- serviços personalizados ----------
     Qualquer serviço que não esteja no catálogo entra por `data/api/providers.json`:
       [{ "id":"meu", "name":"Meu Serviço", "kind":"api", "env":["MEU_TOKEN"],
          "probe": { "url":"https://api.exemplo.com/health", "header":"Authorization", "prefix":"Bearer " } }]
     É isto que faz o «para todos os tipos de app»: não é preciso tocar em código para acrescentar
     um serviço — é preciso um ficheiro. Entradas inválidas são ignoradas com um aviso, nunca rebentam. */
  function customProviders() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(customFile, 'utf8')); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const p of raw.slice(0, 60)) {
      if (!p || typeof p !== 'object') continue;
      const id = oneLine(p.id, 40).toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      const name = oneLine(p.name || id, 60);
      const envKeys = Array.isArray(p.env) ? p.env.filter((k) => /^[A-Z_][A-Z0-9_]*$/i.test(String(k))) : [];
      if (!id || !name || !envKeys.length) continue;
      const probe = p.probe && typeof p.probe.url === 'string'
        ? {
          url: p.probe.url,
          method: /^POST$/i.test(p.probe.method || '') ? 'POST' : 'GET',
          headers: p.probe.header ? (e) => ({ [p.probe.header]: `${p.probe.prefix || ''}${e[envKeys[0]] || ''}`.trim() }) : () => ({}),
        }
        : null;
      out.push({ id, name, kind: oneLine(p.kind || 'api', 24), env: envKeys, docs: oneLine(p.docs || '', 200), probe, custom: true, note: oneLine(p.note || 'Serviço declarado em data/api/providers.json.', 160) });
    }
    return out;
  }

  const all = () => [...CATALOG, ...customProviders()];
  const filled = (k) => String(env[k] ?? '').trim().length > 0;

  function describe(p) {
    const configured = p.env.every(filled);
    const missing = p.env.filter((k) => !filled(k));
    const c = cache.get(p.id);
    const fresh = c && now() - c.at < PROBE_TTL_MS;
    const verified = !!(c && fresh && c.ok);
    return {
      id: p.id, name: p.name, kind: p.kind, docs: p.docs || '',
      configured, missing,
      ready: verified || (configured && !p.probe),
      verified,
      checkedAt: c ? new Date(c.at).toISOString() : null,
      latencyMs: c && fresh ? c.ms : null,
      status: c && fresh ? c.status : null,
      error: c && fresh && !c.ok ? c.error : null,
      note: p.note || '',
      custom: !!p.custom,
    };
  }

  async function probeOne(p) {
    if (!p.probe || !fetchImpl) return { id: p.id, skipped: true };
    const at = now();
    const started = at;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    try {
      const url = typeof p.probe.url === 'function' ? p.probe.url(env) : p.probe.url;
      const headers = p.probe.headers ? p.probe.headers(env) : {};
      const res = await fetchImpl(url, { method: p.probe.method || 'GET', headers, signal: ctl.signal, redirect: 'follow' });
      let body = null;
      try { body = await res.clone().json(); } catch { /* muitos serviços não devolvem JSON */ }
      const ok = p.ok ? !!p.ok(res, body) : res.status < 400;
      const entry = { at, ok, status: res.status, ms: now() - started, error: ok ? null : oneLine(redactValue(`HTTP ${res.status} ${res.statusText}`, env), 140) };
      cache.set(p.id, entry);
      return { id: p.id, ...entry };
    } catch (e) {
      const ms = now() - started;
      const aborted = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
      // `fetch failed` sozinho não diz nada a quem tem de resolver o problema: o código da causa
      // (DNS, TLS, recusa de ligação) é o que muda o próximo passo.
      const causa = e && e.cause && (e.cause.code || e.cause.message);
      const texto = e && e.message ? e.message + (causa && !e.message.includes(causa) ? `: ${causa}` : '') : 'falhou';
      const entry = { at, ok: false, status: 0, ms, error: aborted ? `sem resposta em ${PROBE_TIMEOUT_MS / 1000} s` : oneLine(redactValue(texto, env), 160) };
      cache.set(p.id, entry);
      return { id: p.id, ...entry };
    } finally { clearTimeout(timer); }
  }

  /** Sonda todos os serviços configurados (em paralelo, 4 de cada vez). Só corre com os que têm chave. */
  async function probeAll({ force = false } = {}) {
    const targets = all().filter((p) => p.probe && p.env.every(filled))
      .filter((p) => force || !cache.has(p.id) || now() - cache.get(p.id).at >= PROBE_TTL_MS);
    const results = [];
    const queue = [...targets];
    const worker = async () => { while (queue.length) results.push(await probeOne(queue.shift())); };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return results;
  }

  function status() {
    const list = all().map(describe);
    return {
      list,
      summary: {
        total: list.length,
        configured: list.filter((p) => p.configured).length,
        ready: list.filter((p) => p.ready).length,
        pending: list.filter((p) => p.configured && p.ready === false && p.verified === false && p.missing.length === 0).length,
        missingKeys: [...new Set(list.flatMap((p) => p.missing))].sort(),
      },
      checkedAt: new Date(now()).toISOString(),
    };
  }

  function reloadEnv() {
    reloads += 1; lastReloadAt = new Date(now()).toISOString();
    let text = '';
    try { text = fs.readFileSync(envFile, 'utf8'); } catch { return { changed: [], count: 0 }; }
    const parsed = parseEnvFile(text);
    const changed = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (!fromFile.has(k) && env[k] !== undefined) continue;   // o ambiente real manda
      if (String(env[k] ?? '') !== v) changed.push(k);
      env[k] = v; fromFile.add(k);
    }
    // uma chave apagada do .env tem de desaparecer (senão a sonda continuaria a mentir)
    for (const k of [...fromFile]) {
      if (!(k in parsed)) { delete env[k]; fromFile.delete(k); changed.push(k); }
    }
    if (changed.length) cache.clear();
    return { changed, count: changed.length };
  }

  /** Vigia o `.env`: mudar uma chave no ficheiro e gravar é o mesmo que reiniciar o servidor. */
  function watchEnv(onChange = () => {}) {
    if (!fs.existsSync(envFile)) return () => {};
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = reloadEnv();
        if (!r.count) return;
        await probeAll({ force: true });
        onChange(r);
      }, 400);
    };
    try { fs.watchFile(envFile, { interval: 1000 }, handler); } catch { return () => {}; }
    return () => { try { fs.unwatchFile(envFile, handler); } catch { /* já não estava */ } };
  }

  /* ---------- a máquina ----------
     O terminal e a API dizem em que máquina o escritório foi aberto: sistema, versão, arquitectura,
     memória, e que ferramentas existem no PATH (com versão, quando a dizem depressa). É isto que faz
     o terminal «funcionar de acordo com a máquina» em vez de fingir que todas são iguais. */
  async function tools() {
    if (toolsData && now() - toolsAt < TOOLS_TTL_MS) return toolsData;
    const which = whichCmd();
    const found = await Promise.all(TOOL_NAMES.map(async (name) => {
      const p = await execP(which, [name], 800);
      if (!p) return { name, found: false, path: null, version: null };
      const bin = p.split(/\r?\n/)[0].trim();
      let version = null;
      for (const flag of ['--version', '-v']) {
        const v = await execP(bin, [flag], 1200);
        if (v) { version = oneLine(v.split(/\r?\n/)[0], 60); break; }
      }
      return { name, found: true, path: bin, version };
    }));
    toolsData = found; toolsAt = now();
    return found;
  }

  async function machine() {
    if (machineData && now() - machineAt < MACHINE_TTL_MS) return machineData;
    const cpus = os.cpus() || [];
    machineData = {
      host: os.hostname(),
      platform: process.platform,
      os: `${os.type()} ${os.release()}`,
      arch: process.arch,
      cpu: cpus[0] ? oneLine(cpus[0].model, 80) : 'desconhecido',
      cores: cpus.length,
      memoryGB: Math.round((os.totalmem() / 1e9) * 10) / 10,
      freeGB: Math.round((os.freemem() / 1e9) * 10) / 10,
      uptimeH: Math.round((os.uptime() / 3600) * 10) / 10,
      node: process.version,
      shell: process.platform === 'win32' ? (env.ComSpec || 'cmd.exe') : (env.SHELL || '/bin/sh'),
      home: os.homedir(),
      cwd: process.cwd(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      pid: process.pid,
      tools: await tools(),
      at: new Date(now()).toISOString(),
    };
    machineAt = now();
    return machineData;
  }

  /** O documento de descoberta: o que qualquer app pode chamar, e com que autenticação. */
  function endpoints(version = '') {
    return {
      version,
      openapiish: 'não é OpenAPI: é a lista curta e verdadeira das rotas que existem',
      cors: 'estas rotas respondem com Access-Control-Allow-Origin: *',
      routes: [
        { method: 'GET', path: '/api/platform', auth: 'nenhuma', why: 'o retrato: máquina, versões e APIs prontas' },
        { method: 'GET', path: '/api/health', auth: 'nenhuma', why: 'estado do escritório, modelos, integrações' },
        { method: 'GET', path: '/api/agents', auth: 'nenhuma', why: 'os 35 agentes, funções e ferramentas' },
        { method: 'GET', path: '/api/brain', auth: 'nenhuma', why: 'o grafo de notas do cérebro' },
        { method: 'GET', path: '/api/forge', auth: 'nenhuma', why: 'a oficina: ferramentas por sala' },
        { method: 'GET', path: '/api/forge/stream', auth: 'nenhuma', why: 'SSE: o terminal da oficina ao vivo' },
        { method: 'POST', path: '/api/forge/draft', auth: 'nenhuma (local)', why: 'forjar, provar e activar uma ferramenta' },
        { method: 'GET', path: '/api/tasks', auth: 'nenhuma (local)', why: 'tarefas e o seu estado real' },
        { method: 'POST', path: '/api/tasks', auth: 'nenhuma (local)', why: 'entregar trabalho a uma sala' },
        { method: 'POST', path: '/api/platform/reload', auth: 'Bearer ORBITA_API_TOKEN', why: 'reler o .env e sondar outra vez' },
        { method: 'POST', path: '/api/platform/probe', auth: 'Bearer ORBITA_API_TOKEN', why: 'forçar uma sonda a todos os serviços' },
      ],
    };
  }

  /** Arranque: uma sonda em segundo plano (não trava o servidor) e o vigia do `.env`. */
  function start({ onChange } = {}) {
    reloadEnv();
    setTimeout(() => { probeAll().catch(() => {}); }, 60);
    const unwatch = watchEnv(onChange);
    return { unwatch, stop: unwatch };
  }

  return {
    machine, tools, status, probeAll, reloadEnv, watchEnv, endpoints, start,
    get envFile() { return envFile; },
    get meta() { return { reloads, lastReloadAt, fromFileKeys: [...fromFile] }; },
    _cache: cache,   // para os testes poderem olhar para o que foi sondado, sem esperar
  };
}
