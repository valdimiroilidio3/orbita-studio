// Órbita — os testes da plataforma (28 out 2026, pedido 34c).
//
// O que se prova aqui é exactamente o que o dono pediu: «a API funciona logo, automaticamente». Um
// teste que fingisse a rede não provaria nada — por isso a rede é substituída por um `fetchImpl`
// falso e o que se verifica é a LÓGICA: quem fica `ready`, quem fica com a chave em falta, e que
// nenhuma chave sai numa mensagem de erro. A sonda real é do servidor, com as chaves do dono.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlatform, ensureApiToken, parseEnvFile, CATALOG } from './platform.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-platform-'));

/* ---------- o .env ---------- */
test('.env: lê pares, aspas e export, e ignora lixo', () => {
  const env = parseEnvFile([
    '# comentário',
    'OPENAI_API_KEY=sk-abc',
    'export STRIPE_SECRET_KEY="sk_test_123"',
    "RESEND_API_KEY='re_123'",
    'linha inválida sem igual',
    'VAZIA=',
  ].join('\n'));
  assert.equal(env.OPENAI_API_KEY, 'sk-abc');
  assert.equal(env.STRIPE_SECRET_KEY, 'sk_test_123');
  assert.equal(env.RESEND_API_KEY, 're_123');
  assert.equal(env.VAZIA, '');
  assert.equal(Object.keys(env).length, 4);
});

test('token interno: nasce sozinho no primeiro arranque e não se repete', () => {
  const root = tmp();
  const env = {};
  const a = ensureApiToken({ root, env });
  assert.equal(a.created, true);
  assert.ok(env.ORBITA_API_TOKEN.length >= 32, 'o token gerado tem de ter 32+ caracteres');
  const escrito = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.match(escrito, /ORBITA_API_TOKEN=[A-Za-z0-9_-]{32,}/);
  assert.match(escrito, /# gerado por Órbita no primeiro arranque/, 'a linha explica-se a si mesma');
  // segunda chamada: nada muda, o ficheiro não cresce
  const antes = fs.statSync(path.join(root, '.env')).size;
  const b = ensureApiToken({ root, env });
  assert.equal(b.created, false);
  assert.equal(fs.statSync(path.join(root, '.env')).size, antes);
  assert.equal(b.length, env.ORBITA_API_TOKEN.length);
});

test('token interno: um token já existente no ambiente manda e não é reescrito', () => {
  const root = tmp();
  const env = { ORBITA_API_TOKEN: 'x'.repeat(40) };
  const r = ensureApiToken({ root, env });
  assert.equal(r.created, false);
  assert.equal(r.source, 'ambiente');
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
});

/* ---------- as sondas ---------- */
const fakeFetch = (plan) => async (url, init) => {
  const hit = plan.find((p) => String(url).includes(p.match));
  if (!hit) throw new Error('rede falsa: ' + url);
  if (hit.throw) throw Object.assign(new Error(hit.throw), { name: hit.throw === 'aborted' ? 'AbortError' : 'Error' });
  const body = hit.body || {};
  return {
    status: hit.status || 200, statusText: hit.statusText || 'OK',
    clone: () => ({ json: async () => body }),
    json: () => Promise.resolve(body),
  };
};

test('sondas: 200 é «pronta», 401 é «com chave mas falhou», sem chave é «falta»', async () => {
  const root = tmp();
  const env = { OPENAI_API_KEY: 'sk-segredo-123456', STRIPE_SECRET_KEY: 'sk_live_segredo_9' };
  const p = createPlatform({
    root, env,
    fetchImpl: fakeFetch([
      { match: 'api.openai.com', status: 200, body: { data: [] } },
      { match: 'api.stripe.com', status: 401, statusText: 'Unauthorized' },
    ]),
  });
  await p.probeAll({ force: true });
  const s = p.status();
  const byId = Object.fromEntries(s.list.map((x) => [x.id, x]));
  assert.equal(byId.openai.ready, true);
  assert.equal(byId.openai.verified, true);
  assert.equal(byId.openai.latencyMs >= 0, true);
  assert.equal(byId.stripe.configured, true);
  assert.equal(byId.stripe.ready, false);
  assert.match(byId.stripe.error, /401/);
  assert.equal(byId.gemini.configured, false);
  assert.deepEqual(byId.gemini.missing, ['GEMINI_API_KEY']);
  assert.ok(s.summary.missingKeys.includes('GEMINI_API_KEY'));
  assert.equal(s.summary.ready, 1);
});

test('sondas: nenhuma chave aparece nas mensagens de erro', async () => {
  const segredo = 'sk-supersecreto-abcdef123456';
  const root = tmp();
  const env = { OPENAI_API_KEY: segredo };
  const p = createPlatform({
    root, env,
    // o serviço devolve a chave no texto do erro: é o pior caso, e tem de sair tapado
    fetchImpl: async () => { throw Object.assign(new Error(`chave inválida: ${segredo}`), { cause: { code: 'ENOTFOUND' } }); },
  });
  await p.probeAll({ force: true });
  const s = p.status();
  const err = s.list.find((x) => x.id === 'openai').error;
  assert.ok(err, 'devia haver erro registado');
  assert.ok(!err.includes(segredo), 'a chave não pode sair no erro: ' + err);
  assert.match(err, /\*\*\*/);
  assert.match(err, /ENOTFOUND/, 'o código da causa é o que diz o que fazer a seguir');
});

test('sondas: um serviço sem sonda não finge que está verificado', async () => {
  const root = tmp();
  const env = { AWS_ACCESS_KEY_ID: 'AKIA123', AWS_SECRET_ACCESS_KEY: 'segredo' };
  const p = createPlatform({ root, env, fetchImpl: fakeFetch([]) });
  await p.probeAll({ force: true });
  const aws = p.status().list.find((x) => x.id === 'aws');
  assert.equal(aws.configured, true);
  assert.equal(aws.verified, false);
  assert.equal(aws.ready, true, 'configurado e sem sonda barata: conta como pronto, mas não verificado');
  assert.match(aws.note, /não há sonda/);
});

/* ---------- o .env a quente ---------- */
test('.env a quente: uma chave nova entra sem reiniciar e limpa as sondas velhas', async () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, '.env'), 'GITHUB_TOKEN=ghp_1\n');
  const env = {};
  const p = createPlatform({
    root, env,
    fetchImpl: fakeFetch([{ match: 'api.github.com', status: 200 }, { match: 'api.resend.com', status: 200 }]),
  });
  p.reloadEnv();
  assert.equal(env.GITHUB_TOKEN, 'ghp_1');
  await p.probeAll({ force: true });
  assert.equal(p.status().list.find((x) => x.id === 'github').ready, true);
  // o dono acrescenta a chave do Resend e grava
  fs.writeFileSync(path.join(root, '.env'), 'GITHUB_TOKEN=ghp_1\nRESEND_API_KEY=re_2\n');
  const r = p.reloadEnv();
  assert.deepEqual(r.changed, ['RESEND_API_KEY']);
  assert.equal(p.status().list.find((x) => x.id === 'resend').verified, false, 'a sonda antiga não vale para uma chave nova');
  await p.probeAll();
  assert.equal(p.status().list.find((x) => x.id === 'resend').ready, true);
  // e se a chave sair do ficheiro, deixa de estar configurada
  fs.writeFileSync(path.join(root, '.env'), 'GITHUB_TOKEN=ghp_1\n');
  p.reloadEnv();
  assert.equal(p.status().list.find((x) => x.id === 'resend').configured, false);
  assert.equal(p.meta.reloads, 3);
});

test('.env a quente: o ambiente real manda sobre o ficheiro', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, '.env'), 'STRIPE_SECRET_KEY=do_ficheiro\n');
  const env = { STRIPE_SECRET_KEY: 'do_ambiente' };
  const p = createPlatform({ root, env });
  p.reloadEnv();
  assert.equal(env.STRIPE_SECRET_KEY, 'do_ambiente');
});

/* ---------- qualquer app: serviços declarados em ficheiro ---------- */
test('serviços personalizados: um ficheiro acrescenta uma API sem tocar em código', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'data', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'api', 'providers.json'), JSON.stringify([
    { id: 'meu-crm', name: 'CRM da casa', kind: 'crm', env: ['MEU_CRM_TOKEN'], probe: { url: 'https://crm.exemplo.pt/api/me', header: 'Authorization', prefix: 'Bearer ' } },
    { id: '', name: 'inválido sem id', env: ['X'] },
    { id: 'sem-chave', name: 'sem env', env: [] },
  ]));
  const env = { MEU_CRM_TOKEN: 'tok_123' };
  const seen = [];
  const p = createPlatform({
    root, env,
    fetchImpl: async (url, init) => { seen.push(init.headers); return { status: 200, statusText: 'OK', clone: () => ({ json: async () => ({}) }) }; },
  });
  await p.probeAll({ force: true });
  const s = p.status();
  const crm = s.list.find((x) => x.id === 'meu-crm');
  assert.ok(crm, 'o serviço declarado devia aparecer');
  assert.equal(crm.custom, true);
  assert.equal(crm.ready, true);
  const hdr = Object.entries(seen[0] || {}).find(([k]) => k.toLowerCase() === 'authorization');
  assert.equal(hdr && hdr[1], 'Bearer tok_123', 'o cabeçalho declarado tem de ser usado');
  assert.equal(s.list.filter((x) => x.custom).length, 1, 'entradas inválidas são ignoradas, não rebentam');
});

/* ---------- a máquina ---------- */
test('máquina: diz o sistema, o node e as ferramentas que existem', async () => {
  const root = tmp();
  const p = createPlatform({ root, env: {}, fetchImpl: fakeFetch([]) });
  const m = await p.machine();
  assert.ok(m.os && m.os.length > 2);
  assert.equal(m.arch, process.arch);
  assert.equal(m.node, process.version);
  assert.ok(m.cores >= 1 && m.memoryGB > 0);
  assert.ok(Array.isArray(m.tools) && m.tools.some((t) => t.name === 'node'));
  assert.ok(m.shell && m.pid === process.pid);
});

test('descoberta: as rotas públicas estão listadas e a privada pede token', () => {
  const p = createPlatform({ root: tmp(), env: {}, fetchImpl: fakeFetch([]) });
  const d = p.endpoints('9.9.9');
  assert.equal(d.version, '9.9.9');
  const paths = d.routes.map((r) => r.method + ' ' + r.path);
  assert.ok(paths.includes('GET /api/platform'));
  assert.ok(paths.some((x) => /reload/.test(x) && x.startsWith('POST')));
  assert.match(d.cors, /Allow-Origin: \*/);
  assert.ok(d.routes.every((r) => r.auth && r.why), 'cada rota diz quem pode e para quê');
});

test('catálogo: identificadores únicos e cada serviço diz que chaves quer', () => {
  const ids = CATALOG.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'há um id repetido no catálogo');
  for (const p of CATALOG) {
    assert.ok(p.env.length > 0, `${p.id} sem variáveis de ambiente`);
    assert.ok(p.env.every((k) => /^[A-Z0-9_]+$/.test(k)), `${p.id} tem uma variável mal escrita`);
    assert.ok(p.name && p.docs && p.kind, `${p.id} incompleto`);
    assert.ok(p.probe === null || typeof p.probe === 'object', `${p.id}: sonda mal declarada`);
  }
});

/* ---------- 1.53.0 · o «Testar» de um serviço da loja ----------
   O botão tem de fazer uma sonda real e dizer a verdade quando não pode: sem chave, o nome da
   variável que falta; serviço sem sonda, o motivo. Nunca «conectado» inventado. */
test('probeId: com chave faz a sonda real e devolve o HTTP', async () => {
  const root = tmp();
  const env = { OPENAI_API_KEY: 'sk-segredo-123456' };
  let pedidos = 0;
  const p = createPlatform({
    root, env,
    fetchImpl: async (url, init) => {
      pedidos += 1;
      const h = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
      assert.equal(h.authorization, 'Bearer sk-segredo-123456');
      return { url, status: 200, statusText: 'OK', clone: () => ({ json: async () => ({ data: [] }) }), json: async () => ({ data: [] }) };
    },
  });
  const r = await p.probeId('openai');
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.ms >= 0, true);
  assert.equal(pedidos, 1);
  assert.equal(JSON.stringify(r).includes('sk-segredo-123456'), false, 'a chave nunca sai na resposta');
});

test('probeId: sem chave diz qual falta e não chama a rede', async () => {
  const root = tmp();
  let pedidos = 0;
  const p = createPlatform({ root, env: {}, fetchImpl: async () => { pedidos += 1; return { status: 200 }; } });
  const r = await p.probeId('figma');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['FIGMA_TOKEN']);
  assert.match(r.error, /FIGMA_TOKEN/);
  assert.equal(pedidos, 0, 'sem chave não há pedido nenhum');
});

test('probeId: um serviço sem sonda automática diz porquê, não finge', async () => {
  const root = tmp();
  const p = createPlatform({ root, env: { PAPER_VAULT: '/notas' }, fetchImpl: async () => ({ status: 200 }) });
  const r = await p.probeId('paper');
  assert.equal(r.ok, false);
  assert.equal(r.noProbe, true);
  assert.match(r.error, /sem sonda automática/);
});

test('probeId: id desconhecido é um erro por palavras', async () => {
  const p = createPlatform({ root: tmp(), env: {}, fetchImpl: async () => ({ status: 200 }) });
  const r = await p.probeId('nao-existe-isto');
  assert.equal(r.ok, false);
  assert.match(r.error, /não conheço o serviço/);
});
