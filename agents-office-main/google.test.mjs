// ORBITA — a pesquisa da Google, verificada sem chave e sem rede.
//
// `google.mjs` deixa trocar os dois endereços por ambiente (GOOGLE_PLACES_URL / GOOGLE_CSE_URL).
// É isso que permite testar o caminho inteiro — pedido, cabeçalhos, mapeamento, nota de
// oportunidade, deduplicação — contra um servidor local que fala o mesmo dialeto das duas APIs.
// O que NUNCA se testa com falsos é a chave: ela é só um valor de ambiente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const KEYS = ['GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CSE_KEY', 'GOOGLE_CSE_ID', 'GOOGLE_SEARCH_ENGINE_ID'];
const savedEnv = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];

const PLACES = {
  places: [
    {
      id: 'ChIJfake1', displayName: { text: 'Clínica Dentária Alvalade' }, formattedAddress: 'Rua 1, Lisboa, Portugal',
      nationalPhoneNumber: '+351 210 000 001', rating: 3.9, userRatingCount: 12,
      googleMapsUri: 'https://maps.google.com/?cid=1', primaryTypeDisplayName: { text: 'Dentista' },
      addressComponents: [{ longText: 'Lisboa', types: ['locality', 'political'] }],
    },
    {
      id: 'ChIJfake2', displayName: { text: 'Sorrisos do Chiado' }, formattedAddress: 'Rua 2, Lisboa, Portugal',
      websiteUri: 'https://sorrisos.pt', rating: 4.8, userRatingCount: 240,
      googleMapsUri: 'https://maps.google.com/?cid=2', primaryTypeDisplayName: { text: 'Dentista' },
      addressComponents: [{ longText: 'Lisboa', types: ['locality', 'political'] }],
    },
  ],
};
const CSE = { items: [{ title: 'Câmara Municipal de Lisboa', link: 'https://www.lisboa.pt', snippet: 'Site oficial.', displayLink: 'lisboa.pt' }] };

let server, base, dir;

before(async () => {
  server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/v1/places:searchText')) {
      assert.equal(req.headers['x-goog-api-key'], 'chave-de-teste');
      assert.match(String(req.headers['x-goog-fieldmask']), /places\.displayName/);
      let raw = '';
      req.on('data', d => { raw += d; });
      req.on('end', () => { send(200, { ...PLACES, asked: JSON.parse(raw) }); });
      return;
    }
    if (req.url.startsWith('/customsearch/v1')) { send(200, CSE); return; }
    send(404, { error: 'rota desconhecida' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-google-'));
});

after(() => {
  server?.close();
  for (const k of KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('sem chave, o estado diz qual variável falta — e não finge que procura', async () => {
  const g = await import('./google.mjs?fresh');
  const s = g.state();
  assert.equal(s.any, false);
  assert.equal(s.places.available, false);
  assert.match(s.places.reason, /GOOGLE_MAPS_API_KEY/);
  await assert.rejects(() => g.searchPlaces({ what: 'dentistas', where: 'Lisboa' }), /GOOGLE_MAPS_API_KEY/);
});

test('o Places real devolve leads mapeados, com nota e razão', async () => {
  process.env.GOOGLE_MAPS_API_KEY = 'chave-de-teste';
  process.env.GOOGLE_PLACES_URL = `${base}/v1/places:searchText`;
  const g = await import('./google.mjs?places');
  const leads = await g.searchPlaces({ what: 'clínicas dentárias', where: 'Lisboa', limit: 5 });
  assert.equal(leads.length, 2);
  const [semSite, comSite] = leads;
  assert.equal(semSite.name, 'Clínica Dentária Alvalade');
  assert.equal(semSite.city, 'Lisboa');
  assert.equal(semSite.phone, '+351 210 000 001');
  assert.ok(semSite.score > comSite.score, 'sem site tem de pontuar mais alto');
  assert.match(semSite.why, /sem site/);
  assert.match(comSite.why, /já tem site/);
  assert.equal(comSite.website, 'https://sorrisos.pt');
});

test('a pesquisa web devolve título, link e excerto, sem inventar telefones', async () => {
  process.env.GOOGLE_API_KEY = 'chave-de-teste';
  process.env.GOOGLE_CSE_ID = 'cx:de-teste';
  process.env.GOOGLE_CSE_URL = `${base}/customsearch/v1`;
  const g = await import('./google.mjs?web');
  const [hit] = await g.searchWeb({ q: 'câmara municipal de lisboa', limit: 3 });
  assert.equal(hit.name, 'Câmara Municipal de Lisboa');
  assert.equal(hit.website, 'https://www.lisboa.pt');
  assert.equal(hit.phone, '');
  assert.match(hit.snippet, /oficial/);
});

test('a lista guardada deduplica por domínio e por nome+morada', async () => {
  const g = await import('./google.mjs?dedupe');
  const first = g.saveAll([
    { name: 'Sorrisos do Chiado', website: 'https://sorrisos.pt', phone: '', city: 'Lisboa' },
    { name: 'Clínica Alvalade', address: 'Rua 1', phone: '+351 210 000 001', city: 'Lisboa' },
  ], dir);
  assert.equal(first.added, 2);
  const again = g.saveAll([
    { name: 'Sorrisos do Chiado', website: 'https://www.sorrisos.pt', phone: '', city: 'Lisboa' },
    { name: 'Clínica Alvalade', address: 'Rua 1', phone: '+351 210 000 001', city: 'Lisboa' },
  ], dir);
  assert.equal(again.added, 0);
  assert.equal(again.updated, 2);
  assert.equal(again.total, 2);
  const listed = g.list({ limit: 10 }, dir);
  assert.equal(listed.leads.length, 2);
  assert.ok(listed.leads.every(l => l.status === 'novo'));
});

test('o servidor MCP orbita-google expõe as ferramentas e responde com erro honesto sem caminho', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp-servers', 'orbita-google', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, GOOGLE_MAPS_API_KEY: 'chave-de-teste', GOOGLE_PLACES_URL: 'http://127.0.0.1:9/nada' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) lines.push(JSON.parse(line)); } });
  const read = async (id, tries = 60) => {
    for (let n = 0; n < tries; n++) { const hit = lines.find(l => l.id === id); if (hit) return hit; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(`sem resposta para ${id}`);
  };
  const send = m => child.stdin.write(JSON.stringify(m) + '\n');
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } } });
    const init = await read(1);
    assert.equal(init.result.serverInfo.name, 'orbita-google');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (await read(2)).result.tools.map(t => t.name);
    assert.deepEqual(names, ['google_places_search', 'google_web_search', 'google_leads_saved', 'google_leads_save']);
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'google_places_search', arguments: { what: 'dentistas', where: 'Lisboa' } } });
    const call = await read(3);
    assert.equal(call.result.isError, true);
    const payload = JSON.parse(call.result.content[0].text);
    assert.match(payload.error, /não consegui chegar ao Places|não respondeu/);
  } finally { child.kill('SIGTERM'); }
});
