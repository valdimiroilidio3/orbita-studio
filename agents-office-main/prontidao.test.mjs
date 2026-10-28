/* ===========================================================================
   A PRONTIDÃO E O ESQUEMA (1.41.0 · pedido: «implementa 1+2+3+4»)

   Itens 1 a 4 do lançamento: publicar, ter `/api` a responder, aplicar o SQL e
   ter as variáveis certas. O que aqui se prova — e nenhuma destas provas precisa
   de Vercel, Supabase nem rede:

     · a lista de prontidão aceita os nomes alternativos e NUNCA mostra valores;
     · o `/api/health` sem base responde 503 com explicação — não rebenta (era o
       bug real: `ReferenceError` por usar `ia` antes de o declarar);
     · o `/api/setup` aplica os três ficheiros pela ordem certa, um por
       transacção, e diz quantas tabelas da mesa ficaram a existir;
     · o `/api/setup` sem token responde 404 (não confirma que existe);
     · o remetente do correio tem um nome só (`ORBITA_FROM_EMAIL` ou o antigo).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarProntidao, prontidaoCurta, variaveisEmFalta, remetente } from './api/_prontidao.mjs';
import { aplicarEsquema, FICHEIROS, NAO_APLICADOS, tabelasEmFalta } from './api/_esquema.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo, createSupabaseRepo } from './api/_repo.mjs';

const ENV_COMPLETO = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_FAKE',
  ORBITA_API_TOKEN: 'x'.repeat(43),
  ORBITA_ADMIN_TOKEN: 'y'.repeat(24),
  SETUP_TOKEN: 'token-de-setup-1234',
  DATABASE_URL: 'postgres://u@db.exemplo.pt:5432/postgres',
  TAVILY_API_KEY: 'tvly-FAKE',
  GEOAPIFY_API_KEY: 'geo-NAO-PODE-APARECER',
  RESEND_API_KEY: 're-NAO-PODE-APARECER',
  ORBITA_FROM_EMAIL: 'ola@orbita.pt',
  RESEND_WEBHOOK_SECRET: 'whsec-NAO-PODE-APARECER',
  WHATSAPP_TOKEN: 'wa-NAO-PODE-APARECER',
  WHATSAPP_PHONE_ID: '123456',
  WHATSAPP_APP_SECRET: 'app-NAO-PODE-APARECER',
  WHATSAPP_VERIFY_TOKEN: 'verifica-NAO-PODE-APARECER',
  OPENROUTER_API_KEY: 'sk-NAO-PODE-APARECER',
  ORBITA_OCR_URL: 'https://ocr.exemplo.pt/ler',
};

/* ---------- 1 · a lista de prontidão ---------- */
test('sem nada no ambiente: não lança, e diz o quê e porquê', () => {
  const r = avaliarProntidao({});
  assert.equal(r.pronto, false);
  assert.deepEqual(r.criticasEmFalta, ['Base de dados', 'Acesso', 'Esquema da base']);
  assert.match(r.resumo, /não lançar ainda/);
  /* cada item em falta diz o NOME da variável e a razão em português */
  const base = r.grupos.find((g) => g.id === 'base');
  assert.deepEqual(base.itens.map((i) => i.variavel), ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']);
  assert.ok(base.itens.every((i) => i.porque && i.porque.length > 10), 'um item em falta sem razão escrita');
});

test('com tudo no sítio: pronto, e nenhum valor sai daqui', () => {
  const r = avaliarProntidao(ENV_COMPLETO);
  assert.equal(r.pronto, true, `devia estar pronto e não está: ${r.resumo}`);
  assert.equal(r.essenciaisEmFalta.length, 0);
  const impresso = JSON.stringify(r);
  for (const chave of Object.keys(ENV_COMPLETO)) {
    const v = ENV_COMPLETO[chave];
    if (v.length < 8) continue;                       // valores curtos colidem com palavras
    assert.ok(!impresso.includes(v), `o retrato da prontidão mostrou o VALOR de ${chave} — só o nome pode sair`);
  }
});

test('aceita os nomes alternativos que o código já usava', () => {
  const antigos = {
    NEXT_PUBLIC_SUPABASE_URL: ENV_COMPLETO.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    ORBITA_EMAIL_FROM: 'ola@orbita.pt',               // o nome que o painel conhecia
    TAVILY_KEY: 'tvly', GEOAPIFY_KEY: 'geo',
    POSTGRES_URL: ENV_COMPLETO.DATABASE_URL,
    ORBITA_API_TOKEN: ENV_COMPLETO.ORBITA_API_TOKEN,
    ORBITA_ADMIN_TOKEN: ENV_COMPLETO.ORBITA_ADMIN_TOKEN,
    SETUP_TOKEN: ENV_COMPLETO.SETUP_TOKEN,
  };
  const r = avaliarProntidao(antigos);
  assert.equal(r.pronto, true, `os nomes antigos deviam servir: ${r.criticasEmFalta.join(', ')}`);
  const correio = r.grupos.find((g) => g.id === 'correio');
  assert.ok(correio.itens.find((i) => i.variavel === 'ORBITA_EMAIL_FROM').pronto, 'ORBITA_EMAIL_FROM não foi aceite');
});

test('um token curto não conta como configurado', () => {
  const r = avaliarProntidao({ ...ENV_COMPLETO, ORBITA_API_TOKEN: 'curto' });
  const acesso = r.grupos.find((g) => g.id === 'acesso');
  assert.equal(acesso.pronto, false, 'um token de 5 caracteres não fecha a API');
  assert.ok(variaveisEmFalta({ ...ENV_COMPLETO, ORBITA_API_TOKEN: 'curto' }).includes('ORBITA_API_TOKEN'));
});

test('o remetente do correio tem um nome só', () => {
  assert.equal(remetente({ ORBITA_FROM_EMAIL: 'a@b.pt' }), 'a@b.pt');
  assert.equal(remetente({ ORBITA_EMAIL_FROM: 'c@d.pt' }), 'c@d.pt');
  assert.equal(remetente({}), '');
});

/* ---------- 2 · o esquema ---------- */
test('o esquema aplica-se pela ordem certa, um ficheiro por transacção', async () => {
  const chamadas = [];
  const cliente = { async query(sql, params) { chamadas.push(sql.length > 40 ? 'ficheiro' : sql); return { rows: [] }; } };
  const r = await aplicarEsquema(cliente);
  assert.equal(r.ok, true, r.erro || '');
  assert.deepEqual(r.aplicados.map((a) => a.ficheiro), FICHEIROS);
  /* mesa ANTES da IA: a IA tem chaves estrangeiras para nada, mas a ordem é o contrato */
  assert.equal(FICHEIROS[0], 'orbita_mesa.sql');
  assert.ok(FICHEIROS.includes('orbita_1_37_0.sql'), 'as colunas do envio têm de ser aplicadas');
  /* cada ficheiro abre e fecha transacção; nada corre fora dela */
  assert.equal(chamadas.filter((c) => c === 'begin').length, FICHEIROS.length);
  assert.equal(chamadas.filter((c) => c === 'commit').length, FICHEIROS.length);
  /* e o desenho do SQLite não entra — está lá, com a razão, mas não se aplica */
  assert.ok(NAO_APLICADOS['orbita_schema.sql'].includes('company_name'));
  assert.ok(!FICHEIROS.includes('orbita_schema.sql'), 'o desenho da migração do SQLite não pode ser aplicado');
});

test('um erro a meio faz rollback e para — não deixa meia base', async () => {
  let ficheiros = 0;
  const chamadas = [];
  const cliente = {
    async query(sql) {
      chamadas.push(sql.length > 40 ? 'ficheiro' : sql);
      if (sql.length > 40) { ficheiros += 1; if (ficheiros === 2) throw new Error('syntax error at or near "create"'); }
      return { rows: [] };
    },
  };
  const r = await aplicarEsquema(cliente);
  assert.equal(r.ok, false);
  assert.equal(r.ficheiro, 'orbita_ia.sql');
  assert.match(r.erro, /syntax error/);
  assert.deepEqual(r.aplicados.map((a) => a.ficheiro), ['orbita_mesa.sql']);
  assert.ok(chamadas.includes('rollback'), 'sem rollback a ligação fica presa numa transacção falhada');
  assert.ok(!chamadas.includes('commit') || chamadas.lastIndexOf('commit') < chamadas.lastIndexOf('begin'), 'não podia confirmar o ficheiro que falhou');
});

test('`?so=` aplica um só, e um nome errado é recusado com a lista', async () => {
  const cliente = { async query() { return { rows: [] }; } };
  const um = await aplicarEsquema(cliente, { so: 'orbita_mesa.sql' });
  assert.equal(um.ok, true);
  assert.deepEqual(um.aplicados.map((a) => a.ficheiro), ['orbita_mesa.sql']);
  const errado = await aplicarEsquema(cliente, { so: 'orbita_schema.sql' });
  assert.equal(errado.ok, false);
  assert.match(errado.erro, /não é um ficheiro do esquema/);
});

test('o que falta da mesa é dito pelo nome', () => {
  assert.deepEqual(tabelasEmFalta(['orbita_leads', 'orbita_messages']), ['orbita_tasks', 'orbita_projects', 'orbita_atividade', 'orbita_receitas']);
  assert.deepEqual(tabelasEmFalta(['orbita_leads', 'orbita_messages', 'orbita_tasks', 'orbita_projects', 'orbita_atividade', 'orbita_receitas']), []);
});

/* ---------- 3 · a rota de prontidão e a saúde ---------- */
test('/sistema/prontidao responde pela rota normal, sem valores', async () => {
  const r = await responder(createMemRepo(), { caminho: '/sistema/prontidao', env: ENV_COMPLETO });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.pronto, true);
  assert.ok(!JSON.stringify(r.corpo).includes('NAO_PODE_APARECER'), 'a rota mostrou um valor secreto');
});

test('/api/health sem base responde 503 com a prontidão — não rebenta', async () => {
  const guardado = { ...process.env };
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']) delete process.env[k];
  const { default: health } = await import('./api/health.mjs');
  const res = {
    headers: {}, statusCode: 0, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await health({ method: 'GET', headers: {}, url: '/api/health' }, res);
  assert.equal(res.statusCode, 503, 'sem chaves tem de ser 503, não um 500 da Vercel');
  assert.equal(res.body.modo, 'local');
  assert.ok(res.body.prontidao && res.body.prontidao.pronto === false, 'a saúde tem de trazer a prontidão');
  assert.ok(res.body.prontidao.criticasEmFalta.includes('Base de dados'));
  assert.ok(res.body.versao, 'a saúde tem de dizer a versão');
  process.env = guardado;
});

test('/api/setup sem token responde 404 e não confirma que existe', async () => {
  const guardado = process.env.SETUP_TOKEN;
  process.env.SETUP_TOKEN = 'segredo-de-setup';
  const { default: setup } = await import('./api/setup.mjs');
  const res = {
    statusCode: 0, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await setup({ method: 'GET', url: '/api/setup' }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'não existe' });
  /* com o token certo, mas sem DATABASE_URL, o erro é honesto e nomeia o que falta */
  const guardadoDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
  const res2 = { statusCode: 0, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await setup({ method: 'GET', url: '/api/setup?token=segredo-de-setup' }, res2);
  assert.equal(res2.statusCode, 500);
  assert.match(res2.body.erro, /DATABASE_URL/);
  if (guardadoDb !== undefined) process.env.DATABASE_URL = guardadoDb;
  if (guardado === undefined) delete process.env.SETUP_TOKEN; else process.env.SETUP_TOKEN = guardado;
});

test('a prontidão curta cabe no health e diz o mesmo', () => {
  const c = prontidaoCurta({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'y' });
  assert.equal(typeof c.resumo, 'string');
  assert.ok(Array.isArray(c.criticasEmFalta));
  assert.ok(c.criticasEmFalta.includes('Acesso'));
});

/* ---------- 4 · a saúde olha para as colunas do envio ---------- */
test('a saúde da base prova as colunas do 1.37, não só as tabelas', async () => {
  /* um PostgREST falso: as tabelas existem, mas `subject` ainda não */
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('orbita_messages') && u.includes('subject')) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ message: 'column orbita_messages.subject does not exist' }) };
    }
    return { ok: true, status: 200, text: async () => '[]' };
  };
  const repo = createSupabaseRepo({ url: 'https://abcdefgh.supabase.co', key: 'k', fetchImpl });
  const h = await repo.health();
  assert.equal(h.faltam.length, 0, 'as tabelas existem — o que falta são colunas');
  assert.equal(h.mensagensProntas, false, 'sem as colunas do envio o envio responde 400 e a saúde dizia «ok»');
  assert.equal(h.ok, false);

  /* e, com o esquema completo, diz que sim */
  const bom = createSupabaseRepo({ url: 'https://abcdefgh.supabase.co', key: 'k', fetchImpl: async () => ({ ok: true, status: 200, text: async () => '[]' }) });
  const hb = await bom.health();
  assert.equal(hb.ok, true);
  assert.equal(hb.mensagensProntas, true);
});
