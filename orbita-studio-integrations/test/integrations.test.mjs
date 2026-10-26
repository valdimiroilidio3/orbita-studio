// Órbita Studio — testes das integrações.
//
// Correm contra o servidor construído (`dist/server.mjs`) e contra o módulo. Sem rede: o
// OpenStreetMap é substituído por um servidor local que devolve o mesmo formato do Nominatim e do
// Overpass. Cada teste arranca o servidor com o seu próprio ORBITA_DATA_DIR — não toca nos dados
// de quem está a correr o escritório.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'dist', 'server.mjs');
const TOKEN = 'a'.repeat(64);
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

/* ---------- um OpenStreetMap falso, com o formato verdadeiro ---------- */
let osm;
const OSM_ELEMENTS = [
  { type: 'node', id: 111, lat: 40.2, lon: -8.4, tags: { name: 'Clínica Dentária Mondego', amenity: 'dentist', 'addr:street': 'Rua da Sofia', 'addr:housenumber': '12', phone: '+351239111222', website: 'https://mondego-dental.pt' } },
  { type: 'node', id: 222, lat: 40.21, lon: -8.41, tags: { name: 'Sorriso Celas', amenity: 'dentist', 'addr:city': 'Coimbra', 'contact:phone': '+351239333444' } },
  { type: 'way', id: 333, tags: { name: 'Dental sem coordenadas', amenity: 'dentist' } }, // sem lat/lon: tem de ser descartado
];
async function startOsm() {
  osm = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/search') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([{ lat: '40.2033', lon: '-8.4103', display_name: 'Coimbra, Portugal', name: 'Coimbra' }]));
    }
    if (url.pathname === '/interpreter') {
      let raw = '';
      req.on('data', c => { raw += c; });
      return req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        // o 3º elemento não tem coordenadas: tem de ser descartado pelo módulo
        res.end(JSON.stringify({ elements: OSM_ELEMENTS }));
      });
    }
    res.writeHead(404); res.end('[]');
  });
  await new Promise(r => osm.listen(0, '127.0.0.1', r));
}

/* ---------- arrancar o servidor ---------- */
let srv;
let base;
let dataDir;
let logs = '';

function startServer(extraEnv = {}, { waitForPort = true } = {}) {
  return new Promise((resolve) => {
    const port = 4900 + Math.floor(Math.random() * 90);
    const child = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: {
        ...process.env,
        ORBITA_API_TOKEN: TOKEN,
        PORT: String(port),
        HOST: '127.0.0.1',
        RATE_LIMIT: '1000',
        ORBITA_DATA_DIR: dataDir,
        OSM_NOMINATIM_URL: `http://127.0.0.1:${osm.address().port}`,
        OSM_OVERPASS_URL: `http://127.0.0.1:${osm.address().port}/interpreter`,
        // nenhum provider pago ligado: é assim que os testes provam a honestidade
        SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', RESEND_API_KEY: '', ORBITA_EMAIL_FROM: '',
        META_ACCESS_TOKEN: '', META_IG_USER_ID: '', META_GRAPH_API_VERSION: '', VERCEL_DEPLOY_HOOK_URL: '',
        GITHUB_TOKEN: '', GEMINI_API_KEY: '',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', d => { logs += d; });
    child.stderr.on('data', d => { logs += d; });
    const url = `http://127.0.0.1:${port}`;
    const wait = async () => {
      for (let i = 0; i < 80; i++) {
        try { const r = await fetch(url + '/health'); if (r.ok) return resolve({ child, url }); } catch { /* ainda a arrancar */ }
        await new Promise(r => setTimeout(r, 100));
      }
      resolve({ child, url });
    };
    if (waitForPort) wait(); else resolve({ child, url });
  });
}

before(async () => {
  await startOsm();                        // o OSM falso primeiro
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-int-'));
  const started = await startServer();     // e só depois o servidor que lhe fala
  srv = started.child;
  base = started.url;
});

after(() => { srv?.kill('SIGKILL'); osm?.close(); if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true }); });

const auth = (extra = {}) => ({ authorization: `Bearer ${TOKEN}`, ...extra });
const post = (p, body, headers = auth()) => fetch(base + p, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (p, headers = auth()) => fetch(base + p, { headers });

/* ---------- 1. o token ---------- */
test('o servidor recusa arrancar sem ORBITA_API_TOKEN', async () => {
  const { child } = await startServer({ ORBITA_API_TOKEN: '' }, { waitForPort: false });
  const code = await new Promise(r => child.on('close', r));
  assert.equal(code, 1, 'devia sair com código 1 (falha fechado)');
  assert.match(logs, /ORBITA_API_TOKEN/);
});

test('token curto também é recusado', async () => {
  let out = '';
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, ORBITA_API_TOKEN: 'curto', PORT: '4999' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const code = await new Promise(r => child.on('close', r));
  assert.equal(code, 1);
  assert.match(out, /mínimo 32/);
});

/* ---------- 2. portas de entrada ---------- */
test('/health é aberto e não mostra segredos', async () => {
  const r = await fetch(base + '/health');
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.apiTokenConfigured, true);
  assert.ok(!JSON.stringify(body).includes(TOKEN), 'o token nunca pode sair no /health');
});

test('a página inicial explica o serviço sem revelar chaves', async () => {
  const r = await fetch(base + '/');
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.match(text, /Órbita · Integrações/);
  assert.ok(!text.includes(TOKEN));
  assert.ok(!/Bearer\s+[a-f0-9]{64}/i.test(text));
});

test('/v1/status sem token → 401', async () => {
  const r = await fetch(base + '/v1/status');
  assert.equal(r.status, 401);
});

test('/v1/status com token errado → 401', async () => {
  const r = await fetch(base + '/v1/status', { headers: { authorization: 'Bearer ' + 'b'.repeat(64) } });
  assert.equal(r.status, 401);
});

test('/v1/status com token certo devolve o estado honesto dos providers', async () => {
  const { status, body } = await j(await get('/v1/status'));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.apiTokenConfigured, true);
  assert.equal(body.mode, 'local-json', 'sem Supabase, os leads ficam em JSON local');
  const ids = body.providers.map(p => p.id);
  for (const id of ['openstreetmap', 'gemini', 'supabase', 'resend', 'github', 'instagram', 'vercel-deploy', 'content-queue']) {
    assert.ok(ids.includes(id), 'falta o provider ' + id);
  }
  const resend = body.providers.find(p => p.id === 'resend');
  assert.equal(resend.configured, false, 'sem RESEND_API_KEY não pode dizer que está configurado');
  assert.equal(resend.ready, false);
  assert.equal(body.safety.externalWritesRequireToken, true);
  assert.ok(!JSON.stringify(body).includes(TOKEN));
});

test('o token também entra pelo cabeçalho x-orbita-api-token', async () => {
  const r = await fetch(base + '/v1/status', { headers: { 'x-orbita-api-token': TOKEN } });
  assert.equal(r.status, 200);
});

/* ---------- 3. leads: descoberta contra o OSM falso ---------- */
test('descobre empresas no OSM e descarta as que não têm coordenadas', async () => {
  const { status, body } = await j(await post('/v1/leads/discover', { location: 'Coimbra, Portugal', category: 'dentist', radiusMeters: 2000, limit: 20 }));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.discovery.provider, 'openstreetmap');
  assert.equal(body.discovery.count, 2, 'o elemento sem lat/lon não pode entrar');
  assert.match(body.discovery.attribution, /OpenStreetMap/);
  const names = body.discovery.results.map(r => r.name);
  assert.deepEqual(names.sort(), ['Clínica Dentária Mondego', 'Sorriso Celas']);
  const comSite = body.discovery.results.find(r => r.name === 'Clínica Dentária Mondego');
  assert.equal(comSite.website, 'https://mondego-dental.pt/');
  assert.equal(comSite.digitalPresence, 'website-listed');
  const semSite = body.discovery.results.find(r => r.name === 'Sorriso Celas');
  assert.equal(semSite.digitalPresence, 'no-website-listed');
});

test('guarda os leads, não duplica e devolve a lista', async () => {
  const first = await j(await post('/v1/leads/discover', { location: 'Coimbra, Portugal', category: 'dentist', save: true }));
  assert.equal(first.status, 200);
  assert.equal(first.body.saved.saved, 2);
  assert.equal(first.body.saved.storage, 'local-json');

  const second = await j(await post('/v1/leads/discover', { location: 'Coimbra, Portugal', category: 'dentist', save: true }));
  assert.equal(second.body.saved.saved, 0, 'a segunda vez não pode duplicar');
  assert.equal(second.body.saved.totalSubmitted, 2);

  const list = await j(await get('/v1/leads'));
  assert.equal(list.status, 200);
  assert.equal(list.body.leads.length, 2);
  const lead = list.body.leads.find(l => l.companyName === 'Sorriso Celas');
  assert.ok(lead.id, 'cada lead tem id');
  assert.equal(lead.source, 'openstreetmap');
});

test('a lista pode ser lida e um lead pode mudar de estado', async () => {
  const list = await j(await get('/v1/leads?limit=1'));
  assert.equal(list.body.leads.length, 1);
  const id = list.body.leads[0].id;
  const patched = await j(await fetch(`${base}/v1/leads/${id}`, { method: 'PATCH', headers: auth({ 'content-type': 'application/json' }), body: JSON.stringify({ status: 'qualified', notes: 'tem site antigo' }) }));
  assert.equal(patched.status, 200);
  assert.equal(patched.body.lead.status, 'qualified');
  assert.equal(patched.body.lead.notes, 'tem site antigo');

  const invalid = await j(await fetch(`${base}/v1/leads/${id}`, { method: 'PATCH', headers: auth({ 'content-type': 'application/json' }), body: JSON.stringify({ status: 'inventado' }) }));
  assert.equal(invalid.status, 400);

  const missing = await j(await fetch(`${base}/v1/leads/nao-existe`, { method: 'PATCH', headers: auth({ 'content-type': 'application/json' }), body: JSON.stringify({ status: 'won' }) }));
  assert.equal(missing.status, 404);
});

test('lead manual inválido é explicado, não aceite em silêncio', async () => {
  const empty = await j(await post('/v1/leads', { website: 'https://sem-nome.pt' }));
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /companyName|company/i);

  const preview = await j(await post('/v1/leads/preview', { companyName: 'Barbearia Nova', website: 'barbearia-nova.pt', city: 'Coimbra' }));
  assert.equal(preview.status, 200);
  assert.equal(preview.body.normalized[0].website, 'https://barbearia-nova.pt/');
  assert.match(preview.body.normalized[0].dedupeKey, /^domain:barbearia-nova\.pt$/);
});

test('descobrir sem localização é recusado com uma frase útil', async () => {
  const { status, body } = await j(await post('/v1/leads/discover', { location: '', category: 'dentist' }));
  assert.equal(status, 400);
  assert.match(body.error, /cidade|zona/i);
});

/* ---------- 4. WhatsApp: prepara, não envia ---------- */
test('o link de WhatsApp usa E.164 e diz que não envia nada', async () => {
  const { status, body } = await j(await post('/v1/whatsapp/link', { phone: '+351 912 345 678', message: 'Olá, falamos do site?' }));
  assert.equal(status, 200);
  assert.equal(body.provider, 'whatsapp-click-to-chat');
  assert.match(body.url, /^https:\/\/wa\.me\/351912345678\?text=/);
  assert.equal(body.doesNotSend, true);

  const bad = await j(await post('/v1/whatsapp/link', { phone: '912345678' }));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /internacional|\+/i);
});

/* ---------- 5. escritas externas exigem aprovação ---------- */
test('email sem aprovação é bloqueado e sem Resend é dito, não fingido', async () => {
  const noApproval = await j(await post('/v1/email/send', { to: 'cliente@exemplo.pt', subject: 'Olá', text: 'Corpo' }));
  assert.equal(noApproval.status, 400);
  assert.match(noApproval.body.error, /approved/i);

  const noConsent = await j(await post('/v1/email/send', { approved: true, to: 'cliente@exemplo.pt', subject: 'Olá', text: 'Corpo', purpose: 'requested_follow_up' }));
  assert.equal(noConsent.status, 400);
  assert.match(noConsent.body.error, /confirmação|consent|referência/i);

  const notConfigured = await j(await post('/v1/email/send', { approved: true, recipientConsent: true, consentReference: 'pedido por email 21/10', to: 'cliente@exemplo.pt', subject: 'Olá', text: 'Corpo', purpose: 'requested_follow_up' }));
  assert.equal(notConfigured.status, 503);
  assert.match(notConfigured.body.error, /Resend/i);
});

test('publicar no Instagram e fazer deploy sem configuração responde 503, não 500', async () => {
  const ig = await j(await post('/v1/instagram/publish', { approved: true, imageUrl: 'https://exemplo.pt/foto.jpg', caption: 'Olá' }));
  assert.equal(ig.status, 503);
  assert.ok(ig.body.error.length > 10);

  const vercel = await j(await post('/v1/vercel/deploy', { approved: true }));
  assert.equal(vercel.status, 503);
  assert.match(vercel.body.error, /Vercel/i);

  const noApproval = await j(await post('/v1/vercel/deploy', {}));
  assert.equal(noApproval.status, 400);
  assert.match(noApproval.body.error, /approved/i);
});

test('escrever no GitHub exige aprovação explícita', async () => {
  const r = await j(await post('/v1/github/file', { owner: 'x', repo: 'y', path: 'a.md', content: 'olá' }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /approved|aprova/i);
});

/* ---------- 6. rascunhos de conteúdo e supressão ---------- */
test('um rascunho de conteúdo nasce como draft e pode ser marcado como publicado', async () => {
  const made = await j(await post('/v1/content', { projectName: 'Órbita', caption: 'Três razões para um site novo.', platform: 'instagram', imageUrl: 'https://exemplo.pt/a.jpg' }));
  assert.equal(made.status, 201);
  assert.equal(made.body.draft.status, 'draft');

  const list = await j(await get('/v1/content'));
  assert.equal(list.body.drafts.length, 1);
  assert.equal(list.body.drafts[0].id, made.body.draft.id);

  const published = await j(await post(`/v1/content/${made.body.draft.id}/published`, { mediaId: 'm-1' }));
  assert.equal(published.status, 200);
  assert.equal(published.body.draft.status, 'published');
  assert.equal(published.body.draft.remoteId, 'm-1');

  const missing = await j(await post('/v1/content/nao-existe/published', {}));
  assert.equal(missing.status, 404);

  const invalid = await j(await post('/v1/content', { projectName: 'X' }));
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /caption/i);
});

test('um email suprimido fica registado', async () => {
  const { status, body } = await j(await post('/v1/email/suppress', { email: 'Nao-Quero@Exemplo.pt', reason: 'pediu para não receber' }));
  assert.equal(status, 200);
  assert.equal(body.suppressed, true);
  assert.equal(body.email, 'nao-quero@exemplo.pt');

  const bad = await j(await post('/v1/email/suppress', { email: 'sem-arroba' }));
  assert.equal(bad.status, 400);
});

/* ---------- 7. o edge do HTTP ---------- */
test('rota desconhecida → 404 e método errado → 405', async () => {
  assert.equal((await get('/v1/nao-existe')).status, 404);
  assert.equal((await fetch(base + '/v1/status', { method: 'DELETE', headers: auth() })).status, 405);
});

test('JSON inválido → 400 e corpo gigante → 413', async () => {
  const bad = await fetch(base + '/v1/leads', { method: 'POST', headers: auth({ 'content-type': 'application/json' }), body: '{isto não é json' });
  assert.equal(bad.status, 400);

  const huge = await fetch(base + '/v1/leads', { method: 'POST', headers: auth({ 'content-type': 'application/json' }), body: JSON.stringify({ companyName: 'x'.repeat(300 * 1024) }) });
  assert.equal(huge.status, 413);
});

test('o limite de pedidos responde 429', async () => {
  const limited = await startServer({ RATE_LIMIT: '3' });
  try {
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await fetch(limited.url + '/v1/status', { headers: auth() })).status);
    assert.ok(results.includes(429), 'esperava um 429 depois de 3 pedidos, veio: ' + results.join(','));
  } finally { limited.child.kill('SIGKILL'); }
});

/* ---------- 8. o módulo em si ---------- */
test('o módulo não reporta como pronto nada que não esteja configurado', async () => {
  const mod = await import(path.join(ROOT, 'integrations.mjs'));
  // este teste corre no processo dos testes, que pode herdar chaves da máquina (GITHUB_TOKEN, por
  // exemplo): esvaziamos as variáveis para ver o estado de um pacote sem nada configurado
  const keys = ['GITHUB_TOKEN', 'GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY',
    'ORBITA_EMAIL_FROM', 'META_ACCESS_TOKEN', 'META_IG_USER_ID', 'META_GRAPH_API_VERSION', 'VERCEL_DEPLOY_HOOK_URL'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  const before = mod.integrationStatus();
  for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
  assert.equal(before.apiTokenConfigured, true);
  for (const p of before.providers) {
    if (p.id === 'openstreetmap' || p.id === 'github' || p.id === 'content-queue') assert.equal(p.ready, true);
    else assert.equal(p.ready, false, `${p.id} não devia estar pronto sem chave`);
  }
  assert.equal(mod.getIntegrationError(Object.assign(new Error('x'), { status: 429 })).status, 429);
  assert.equal(mod.getIntegrationError(Object.assign(new Error('x'), { status: 503 })).status, 503);
  assert.equal(mod.getIntegrationError(new Error('x')).status, 400);
});
