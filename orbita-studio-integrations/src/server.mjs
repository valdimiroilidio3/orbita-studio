// Órbita Studio — o servidor das integrações.
//
// Uma ponte HTTP autenticada por token para a camada de integrações (`integrations.mjs`, sem
// dependências). Nada aqui inventa estado: cada rota devolve o que o provider respondeu, ou a
// razão exata pela qual ainda não está configurado.
//
// Regras que este ficheiro faz cumprir:
//   · sem `ORBITA_API_TOKEN` (32+ caracteres) o servidor NÃO arranca — falha fechado;
//   · todas as rotas /v1/* exigem `Authorization: Bearer …` ou `x-orbita-api-token`;
//   · escritas externas (email, Instagram, Vercel, GitHub) exigem `approved: true` no corpo;
//   · os segredos nunca saem daqui — o /health e a página inicial mostram só booleanos;
//   · limite de pedidos por minuto e corpo máximo de 256 KB.
import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  apiTokenOk, integrationStatus, getIntegrationError,
  discoverBusinesses, listLeads, saveLeads, updateLead, normalizeLead,
  geminiAssist, sendApprovedEmail, suppressEmail,
  whatsappClickToChatUrl, githubWriteFile, githubRepository,
  publishInstagram, triggerVercelDeploy,
  listContentDrafts, createContentDraft, markContentPublished,
} from '../integrations.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version || '1.0.0'; } catch { return '1.0.0'; } })();
const NAME = 'orbita-studio-integrations';
const STARTED = new Date();
const PORT = Number(process.env.PORT || 4530);
const HOST = process.env.HOST || '0.0.0.0';
const RATE_LIMIT = Math.max(1, Number(process.env.RATE_LIMIT || 120));
const WINDOW_MS = 60_000;
const MAX_BODY = 256 * 1024;
// Onde vivem os leads, rascunhos e supressões. Em testes (e em produção isolada) aponta-se para
// outro sítio com ORBITA_DATA_DIR, para não sujar os dados de quem está a correr o escritório.
const DATA_DIR = process.env.ORBITA_DATA_DIR || undefined;

/* ---------- token: falha fechado ---------- */
const TOKEN = String(process.env.ORBITA_API_TOKEN || '');
if (TOKEN.length < 32) {
  console.error('✗ ORBITA_API_TOKEN ausente ou demasiado curto (mínimo 32 caracteres).');
  console.error('  Gera um com:  node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"');
  console.error('  E coloca-o no .env deste pacote (nunca no git).');
  process.exit(1);
}

/* ---------- utilidades HTTP ---------- */
const json = (res, code, body, extra = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...extra });
  res.end(payload);
};
const html = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};
const readBody = req => new Promise((resolve, reject) => {
  let size = 0, tooBig = false; const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; } // deixa escorrer e responde no fim
    chunks.push(c);
  });
  req.on('end', () => {
    if (tooBig) { const e = new Error('Corpo demasiado grande (máximo 256 KB).'); e.status = 413; return reject(e); }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return resolve({});
    try { resolve(JSON.parse(raw)); } catch { const e = new Error('JSON inválido no corpo do pedido.'); e.status = 400; reject(e); }
  });
  req.on('error', reject);
});

/* ---------- limite de pedidos ---------- */
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > WINDOW_MS) { hits.set(key, { start: now, count: 1 }); return false; }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k); }, WINDOW_MS).unref();

const clientKey = req => {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : String(req.headers['x-orbita-api-token'] || '');
  if (token) return 't:' + createHash('sha256').update(token).digest('hex').slice(0, 16);
  return 'ip:' + (req.socket.remoteAddress || 'desconhecido');
};

/* ---------- a página inicial (sem segredos) ---------- */
function landingPage() {
  const s = integrationStatus();
  const rows = s.providers.map(p => `<tr>
      <td><b>${p.name}</b><div class="k">${p.kind}</div></td>
      <td>${p.configured ? '<span class="on">configurado</span>' : '<span class="off">sem chave</span>'}</td>
      <td>${p.ready ? '<span class="on">pronto</span>' : '<span class="off">indisponível</span>'}</td>
      <td class="note">${p.note}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>Órbita — Integrações</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--ink:#151414;--cream:#ECEAE3;--grey:#6E6A60;--hair:#D9D5CB;--on:#1E9070;--off:#B4391E}
  *{box-sizing:border-box}
  body{margin:0;background:var(--cream);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:42px 26px}
  main{max-width:980px;margin:0 auto}
  h1{font-family:Georgia,serif;font-weight:400;font-size:30px;letter-spacing:.02em;margin:0 0 4px}
  .sub{color:var(--grey);font-size:13px;letter-spacing:.04em}
  .badge{display:inline-block;border:1px solid var(--hair);border-radius:99px;padding:2px 9px;font-size:10px;letter-spacing:.14em;font-weight:700;margin-left:8px;vertical-align:4px}
  .badge.ok{color:var(--on);border-color:rgba(30,144,112,.5)}
  h2{font-family:Georgia,serif;font-weight:400;font-size:19px;margin:34px 0 10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:9.5px;letter-spacing:.14em;color:var(--grey);border-bottom:1px solid var(--ink);padding:0 8px 7px}
  td{border-bottom:1px solid var(--hair);padding:9px 8px;vertical-align:top}
  .k{font-size:9px;letter-spacing:.12em;color:var(--grey);text-transform:uppercase;margin-top:2px}
  .note{color:var(--grey);font-size:12px;max-width:430px}
  .on{color:var(--on);font-weight:600}.off{color:var(--off);font-weight:600}
  code{background:rgba(21,20,20,.06);border-radius:5px;padding:1px 5px;font-size:12px}
  pre{background:#1B1C1A;color:#ECEAE3;border-radius:11px;padding:14px 16px;overflow-x:auto;font-size:12px;line-height:1.6}
  .foot{margin-top:30px;color:var(--grey);font-size:11.5px;border-top:1px solid var(--hair);padding-top:14px}
</style></head><body><main>
<h1>Órbita · Integrações <span class="badge ok">A CORRER</span></h1>
<div class="sub">${NAME} v${VERSION} · ${s.mode === 'supabase' ? 'Supabase' : 'JSON local'} · arrancou ${STARTED.toLocaleString('pt-PT', { hour12: false })}</div>
<h2>Providers</h2>
<table><thead><tr><th>Serviço</th><th>Chave</th><th>Estado</th><th>Nota</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Chamar a API</h2>
<pre># o token vai no cabeçalho, nunca no URL
curl -s http://localhost:${PORT}/v1/status \\
  -H "Authorization: Bearer $ORBITA_API_TOKEN"

# descobrir empresas numa zona (OpenStreetMap)
curl -s -X POST http://localhost:${PORT}/v1/leads/discover \\
  -H "Authorization: Bearer $ORBITA_API_TOKEN" -H 'content-type: application/json' \\
  -d '{"location":"Coimbra, Portugal","category":"dentist","save":true}'</pre>
<h2>O que este serviço não faz</h2>
<p class="note">Não envia emails, publica, faz deploy nem escreve em repositórios sem <code>approved: true</code>
no corpo do pedido, vindo de uma decisão humana. Não guarda segredos em ficheiros versionados — só os lê do
ambiente. E não mostra valores de chaves: apenas se estão ou não configuradas.</p>
<div class="foot">Órbita Studio · criado por Chelton Mahoze · guia completo em docs/INTEGRATIONS.md · as rotas /v1/* exigem token.</div>
</main></body></html>`;
}

/* ---------- as rotas ---------- */
// method, expressão, handler(ctx) — o handler devolve { code, body } e recebe { req, res, body, params, query }
const ROUTES = [
  ['GET', /^\/$/, () => ({ html: landingPage() })],

  ['GET', /^\/health$/, () => ({
    body: {
      ok: true, service: NAME, version: VERSION, uptimeSeconds: Math.round(process.uptime()),
      startedAt: STARTED.toISOString(), apiTokenConfigured: TOKEN.length >= 32,
    },
  })],

  ['GET', /^\/v1\/status$/, () => ({ body: integrationStatus() })],

  ['POST', /^\/v1\/leads\/discover$/, async ({ body }) => {
    const discovery = await discoverBusinesses({
      location: body.location, category: body.category, radiusMeters: body.radiusMeters, limit: body.limit,
    });
    let saved = null;
    if (body.save === true) {
      saved = await saveLeads(DATA_DIR, discovery.results.map(r => ({
        companyName: r.companyName || r.name, website: r.website, category: r.category, address: r.address,
        city: r.city, phone: r.phone, publicEmail: r.publicEmail, source: 'openstreetmap',
        sourceUrl: r.sourceUrl, osmType: r.osmType, osmId: r.osmId, digitalPresence: r.digitalPresence,
      })));
    }
    return { body: { ok: true, discovery, saved } };
  }],

  ['GET', /^\/v1\/leads$/, async ({ query }) => ({ body: { ok: true, leads: await listLeads(DATA_DIR, Number(query.get('limit') || 100)) } })],

  ['POST', /^\/v1\/leads$/, async ({ body }) => {
    const leads = Array.isArray(body.leads) ? body.leads : [body].filter(x => x && (x.companyName || x.name));
    if (!leads.length) { const e = new Error('Envia um lead ou {"leads":[…]} (campo mínimo: companyName).'); e.status = 400; throw e; }
    return { code: 201, body: { ok: true, ...(await saveLeads(DATA_DIR, leads)) } };
  }],

  ['POST', /^\/v1\/leads\/preview$/, async ({ body }) => {
    // normaliza sem gravar: útil para validar um lote antes de o guardar
    const leads = Array.isArray(body.leads) ? body.leads : [body];
    return { body: { ok: true, normalized: leads.map(normalizeLead) } };
  }],

  ['PATCH', /^\/v1\/leads\/([^/]+)$/, async ({ params, body }) => {
    const lead = await updateLead(DATA_DIR, decodeURIComponent(params[0]), body);
    if (!lead) { const e = new Error('Não há lead com esse id.'); e.status = 404; throw e; }
    return { body: { ok: true, lead } };
  }],

  ['POST', /^\/v1\/whatsapp\/link$/, ({ body }) => ({ body: whatsappClickToChatUrl(body.phone, body.message || '') })],

  ['POST', /^\/v1\/gemini\/assist$/, async ({ body }) => ({ body: await geminiAssist({ task: body.task, data: body.data }) })],

  ['POST', /^\/v1\/email\/send$/, async ({ body }) => ({ body: await sendApprovedEmail(DATA_DIR, body) })],

  ['POST', /^\/v1\/email\/suppress$/, ({ body }) => ({ body: suppressEmail(DATA_DIR, body.email, body.reason) })],

  ['GET', /^\/v1\/github\/repo$/, async ({ query }) => ({
    body: await githubRepository(String(query.get('owner') || ''), String(query.get('repo') || '')),
  })],

  ['POST', /^\/v1\/github\/file$/, async ({ body }) => ({ body: await githubWriteFile(body) })],

  ['POST', /^\/v1\/instagram\/publish$/, async ({ body }) => ({ body: await publishInstagram(body) })],

  ['POST', /^\/v1\/vercel\/deploy$/, async ({ body }) => ({ body: await triggerVercelDeploy({ approved: body.approved }) })],

  ['GET', /^\/v1\/content$/, ({ query }) => ({ body: { ok: true, drafts: listContentDrafts(DATA_DIR, Number(query.get('limit') || 100)) } })],

  ['POST', /^\/v1\/content$/, ({ body }) => ({ code: 201, body: { ok: true, draft: createContentDraft(DATA_DIR, body) } })],

  ['POST', /^\/v1\/content\/([^/]+)\/published$/, ({ params, body }) => {
    const draft = markContentPublished(DATA_DIR, decodeURIComponent(params[0]), body || {});
    if (!draft) { const e = new Error('Não há rascunho com esse id.'); e.status = 404; throw e; }
    return { body: { ok: true, draft } };
  }],
];

const OPEN = new Set(['GET /', 'GET /health']);

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = ROUTES.find(([method, re]) => method === req.method && re.test(url.pathname));
  let code = 500;
  try {
    if (!route) {
      const wrongMethod = ROUTES.some(([, re]) => re.test(url.pathname));
      code = wrongMethod ? 405 : 404;
      json(res, code, { ok: false, error: wrongMethod ? `Método ${req.method} não permitido nesta rota.` : 'Rota desconhecida. Vê GET /v1/status e docs/INTEGRATIONS.md.' });
      return;
    }
    const [, re] = route;
    const key = `${req.method} ${url.pathname}`;
    if (!OPEN.has(key) && !apiTokenOk(req)) {
      code = 401;
      json(res, code, { ok: false, error: 'Token ausente ou inválido. Envia Authorization: Bearer <ORBITA_API_TOKEN>.' });
      return;
    }
    if (!OPEN.has(key) && rateLimited(clientKey(req))) {
      code = 429;
      json(res, code, { ok: false, error: `Limite de ${RATE_LIMIT} pedidos por minuto atingido.` }, { 'retry-after': '60' });
      return;
    }
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const out = await route[2]({ req, res, body, params: re.exec(url.pathname).slice(1), query: url.searchParams });
    code = out.code || 200;
    if (out.html) html(res, code, out.html); else json(res, code, out.body ?? { ok: true });
  } catch (e) {
    if (e?.status === 413) { json(res, 413, { ok: false, error: e.message }); code = 413; }
    else {
      const mapped = getIntegrationError(e);
      code = mapped.status;
      json(res, code, { ok: false, error: mapped.error });
    }
  } finally {
    // registo estruturado, sem segredos: método, caminho, estado e duração
    const ms = Date.now() - startedAt;
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, status: res.statusCode, ms }));
  }
});

server.listen(PORT, HOST, () => {
  const s = integrationStatus();
  const ready = s.providers.filter(p => p.ready).map(p => p.id);
  console.log(`Órbita Integrações ${VERSION} → http://${HOST}:${PORT}`);
  console.log(`  armazenamento: ${s.mode === 'supabase' ? 'Supabase' : 'JSON local'}   token: ${s.apiTokenConfigured ? 'configurado' : 'EM FALTA'}`);
  console.log(`  providers prontos: ${ready.length ? ready.join(' · ') : 'nenhum'}`);
  console.log(`  limites: ${RATE_LIMIT} pedidos/min por token · corpo máximo ${Math.round(MAX_BODY / 1024)} KB`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { console.log(`\n${sig}: a fechar.`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}
