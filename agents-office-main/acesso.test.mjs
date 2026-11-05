/* ===========================================================================
   1.66.0 · O ACESSO POR TOKEN (4 nov 2026)

   Porque este ficheiro existe: até aqui, `ORBITA_API_TOKEN` e
   `ORBITA_ADMIN_TOKEN` eram pedidos ao dono pela lista de prontidão — «fecha o
   /api/*», «protege a página e a mesa» — e **nenhum ficheiro do servidor os
   lia**. O `/api/*` estava fechado pela porta, com sessões; os tokens não faziam
   nada. Pedir a alguém que invente dois segredos e não os usar é a pior espécie
   de mentira: dá trabalho e não dá segurança.

   O que aqui se prova, contra a porta FECHADA a sério (`seguranca: true`):

     · sem sessão e sem token → 401 (o que já era verdade);
     · com `Authorization: Bearer <ORBITA_API_TOKEN>` → a API responde;
     · com `x-orbita-token` → o mesmo;
     · `ORBITA_ADMIN_TOKEN` vale mais do que o da API (aprova; o outro não);
     · **contas e palavras-passe não se abrem com token** (403, dito por palavras);
     · um token errado, vazio, curto ou ausente não abre nada;
     · o token no endereço não serve — a lição da 1.64;
     · o `/api/health` diz que os tokens estão configurados, sem mostrar nenhum.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { limitador } from './api/_porta.mjs';
import {
  TOKENS, MINIMOS, tokenDoPedido, iguais, quemPeloToken, estadoDosTokens, EXPLICACAO,
  nomesParecidos, fraseDoNomeErrado,
} from './api/_acesso.mjs';

const API = 'a'.repeat(32) + 'b'.repeat(32);
const ADMIN = 'c'.repeat(32) + 'd'.repeat(32);
const ENV = { SETUP_TOKEN: 'token-de-instalacao-para-teste', ORBITA_API_TOKEN: API, ORBITA_ADMIN_TOKEN: ADMIN };

/** A porta fechada à mão: em memória ela fica dormente por desenho. */
const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: ENV, seguranca: true, ...extra,
});

const peloBearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

/* ---------- a peça pura ---------- */

test('1.66.0 · o token vem do cabeçalho (Bearer ou x-orbita-token) ou do corpo', () => {
  assert.equal(tokenDoPedido({ authorization: 'Bearer abc' }), 'abc');
  assert.equal(tokenDoPedido({ authorization: 'bearer   abc  ' }), 'abc');
  assert.equal(tokenDoPedido({ 'x-orbita-token': 'xyz' }), 'xyz');
  assert.equal(tokenDoPedido({}, { token: 'no-corpo' }), 'no-corpo');
  assert.equal(tokenDoPedido({ authorization: 'Basic abc' }), '', 'só Bearer serve');
  assert.equal(tokenDoPedido({}, null), '');
});

test('1.66.0 · o endereço nunca serve de transporte do token', () => {
  assert.equal(tokenDoPedido({}, null), '');
  const q = new URLSearchParams('token=' + API);
  assert.equal(tokenDoPedido(Object.fromEntries(q), null), '', 'um URL trazido por engano não abre a porta');
});

test('1.66.0 · a comparação não aceita vazio e distingue maiúsculas', () => {
  assert.equal(iguais('', ''), false, 'ambiente sem variável não abre nada');
  assert.equal(iguais('abc', ''), false);
  assert.equal(iguais('abc', 'abc'), true);
  assert.equal(iguais('abc', 'abd'), false);
  assert.equal(iguais('abc', 'ab'), false);
  assert.equal(iguais('ABC', 'abc'), false);
});

test('1.66.0 · quem entra por token, e qual dos dois', () => {
  assert.equal(quemPeloToken({ headers: peloBearer(API).headers, env: ENV }).papel, 'operador');
  assert.equal(quemPeloToken({ headers: peloBearer(ADMIN).headers, env: ENV }).papel, 'dono');
  assert.equal(quemPeloToken({ headers: peloBearer(API).headers, env: ENV }).variavel, 'ORBITA_API_TOKEN');
  assert.equal(quemPeloToken({ headers: peloBearer('errado').headers, env: ENV }), null);
  assert.equal(quemPeloToken({ headers: peloBearer(API).headers, env: {} }), null, 'sem variável não há token');
});

test('1.66.0 · uma variável curta demais é como se não estivesse lá', () => {
  const curto = { ORBITA_API_TOKEN: 'demi-token' };
  assert.equal(quemPeloToken({ headers: peloBearer('demi-token').headers, env: curto }), null);
  const est = estadoDosTokens(curto);
  assert.equal(est.ORBITA_API_TOKEN.configurado, false);
  assert.equal(est.ORBITA_API_TOKEN.curto, true, 'diz que está lá mas é curto — em vez de fingir que não existe');
});

test('1.66.0 · o retrato dos tokens é de nomes e booleanos, nunca de valores', () => {
  const est = estadoDosTokens(ENV);
  assert.equal(est.ORBITA_API_TOKEN.configurado, true);
  assert.equal(est.ORBITA_ADMIN_TOKEN.configurado, true);
  const texto = JSON.stringify(est);
  assert.equal(texto.includes(API), false);
  assert.equal(texto.includes(ADMIN), false);
  for (const t of TOKENS) assert.ok(MINIMOS[t.variavel] > 0, `${t.variavel} tem mínimo`);
});

/* ---------- a porta, fechada a sério ---------- */

test('1.66.0 · sem sessão e sem token, a API continua a não responder', async () => {
  limitador.limpar();
  const r = await chamar(createMemRepo(), '/ops/summary');
  assert.equal(r.status, 401);
  assert.equal(r.corpo.error, 'entra');
  assert.match(r.corpo.tambemPorToken || '', /Authorization: Bearer/, 'e diz que há um caminho de máquina');
});

test('1.66.0 · com o token da API no cabeçalho, a API responde', async () => {
  limitador.limpar();
  const r = await chamar(createMemRepo(), '/ops/summary', 'GET', null, peloBearer(API));
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(typeof r.corpo, 'object');
  assert.ok(r.corpo.leads, 'a rota respondeu a sério, não com um corpo vazio');
});

test('1.66.0 · o mesmo token por `x-orbita-token` (é o que um script usa)', async () => {
  limitador.limpar();
  const r = await chamar(createMemRepo(), '/ops/summary', 'GET', null, { headers: { 'x-orbita-token': API } });
  assert.equal(r.status, 200);
});

test('1.66.0 · o token da API escreve mas não aprova; o de administração aprova', async () => {
  limitador.limpar();
  const repo = createMemRepo();
  const criar = await chamar(repo, '/ops/leads', 'POST', { name: 'Ana', city: 'Coimbra' }, peloBearer(API));
  assert.equal(criar.status, 200, `operador devia poder criar: ${JSON.stringify(criar.corpo)}`);
  assert.equal(criar.corpo.created, 1, 'o lead entrou mesmo');

  /* `enviar` exige `approve`: o operador bate na porta, o administrador passa e
     só falha por a mensagem não existir — que é outra coisa, e diz-se */
  const negado = await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, peloBearer(API));
  assert.equal(negado.status, 403, 'um token de operador não envia');
  assert.equal(negado.corpo.exige, 'approve');

  /* a rota atira (404) em vez de devolver: aqui apanha-se para poder distinguir
     «barrado pela permissão» de «passou e não achei a mensagem» */
  let comoAdmin = null;
  try {
    comoAdmin = await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, peloBearer(ADMIN));
  } catch (e) {
    comoAdmin = { status: e.status, corpo: e.corpo };
  }
  assert.equal(comoAdmin.status, 404, `o token de administração passa a permissão: ${JSON.stringify(comoAdmin.corpo)}`);
});

test('1.66.0 · contas e palavras-passe NÃO se abrem com token nenhum', async () => {
  limitador.limpar();
  const repo = createMemRepo();
  for (const [caminho, metodo] of [['/ops/utilizadores', 'GET'], ['/ops/utilizadores', 'POST'], ['/ops/sessoes', 'GET']]) {
    for (const t of [API, ADMIN]) {
      const r = await chamar(repo, caminho, metodo, { email: 'x@y.pt', password: 'a-b-c-d-e-f-g-h' }, peloBearer(t));
      assert.equal(r.status, 403, `${caminho} ${metodo} com token devia dar 403`);
      assert.match(r.corpo.error, /não se abrem com token/);
      assert.match(r.corpo.hint, /sessão/,'e diz o que fazer');
    }
  }
});

test('1.66.0 · um token errado não abre nada (e não é meia-entrada)', async () => {
  limitador.limpar();
  for (const t of ['errado', API.slice(0, -1), `${API}x`, '']) {
    const r = await chamar(createMemRepo(), '/ops/summary', 'GET', null, peloBearer(t));
    assert.equal(r.status, 401, `«${t.slice(0, 6)}…» não podia entrar`);
  }
});

test('1.66.0 · o corpo também serve, mas o endereço não', async () => {
  limitador.limpar();
  const noCorpo = await responder(createMemRepo(), {
    caminho: '/ops/summary', metodo: 'POST', corpo: { token: API }, env: ENV, seguranca: true,
  });
  assert.equal(noCorpo.status, 200);

  const noEndereco = await responder(createMemRepo(), {
    caminho: `/ops/summary?token=${API}`, metodo: 'GET', env: ENV, seguranca: true,
  });
  assert.equal(noEndereco.status, 401, 'um token no URL não é um token');
});

test('1.66.0 · o `/api/health` diz que os tokens existem, sem os mostrar', async () => {
  const { default: health } = await import('./api/health.mjs');
  const guardado = { ...process.env };
  try {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) delete process.env[k];
    Object.assign(process.env, ENV);
    let corpo = null;
    const res = {
      setHeader() {}, status() { return res; }, json(x) { corpo = x; return res; },
    };
    await health({ method: 'GET', url: '/api/health', headers: {} }, res);
    assert.equal(corpo.acesso.ORBITA_API_TOKEN.configurado, true);
    assert.equal(corpo.acesso.ORBITA_ADMIN_TOKEN.configurado, true);
    const texto = JSON.stringify(corpo);
    assert.equal(texto.includes(API), false, 'a saúde nunca mostra o valor');
    assert.equal(texto.includes(ADMIN), false);
  } finally {
    for (const k of Object.keys(ENV)) delete process.env[k];
    Object.assign(process.env, guardado);
  }
});

test('1.66.0 · a explicação de como se usa o token está escrita para gente', () => {
  assert.match(EXPLICACAO.como, /Authorization: Bearer/);
  assert.match(EXPLICACAO.como, /nunca no endereço/);
  assert.match(EXPLICACAO.contas, /sessão/);
});

/* ---------- 1.66.1 · o nome quase certo ----------
   Dois segredos criados na Vercel como `ORBITA_APITOKEN` (sem o segundo `_`)
   ficaram invisíveis: a saúde dizia «Acesso em falta» e o valor estava lá. */

const CONHECIDOS = ['ORBITA_API_TOKEN', 'ORBITA_ADMIN_TOKEN', 'SETUP_TOKEN', 'SUPABASE_URL'];

test('1.66.1 · um nome sem o segundo `_` é apanhado e diz qual é o certo', () => {
  const achados = nomesParecidos({ ORBITA_APITOKEN: 'x'.repeat(64), ORBITA_ADMINTOKEN: 'y'.repeat(64) }, CONHECIDOS);
  assert.deepEqual(achados, [
    { encontrado: 'ORBITA_ADMINTOKEN', devia: 'ORBITA_ADMIN_TOKEN' },
    { encontrado: 'ORBITA_APITOKEN', devia: 'ORBITA_API_TOKEN' },
  ]);
  assert.match(fraseDoNomeErrado(achados[1]), /ORBITA_APITOKEN/);
  assert.match(fraseDoNomeErrado(achados[1]), /ORBITA_API_TOKEN/);
  assert.match(fraseDoNomeErrado(achados[1]), /Redeploy/);
});

test('1.66.1 · nomes certos não geram aviso, e maiúsculas/minúsculas não contam', () => {
  assert.deepEqual(nomesParecidos({ ORBITA_API_TOKEN: 'a'.repeat(64) }, CONHECIDOS), []);
  /* um nome diferente a sério não é «quase»: não se inventam avisos */
  assert.deepEqual(nomesParecidos({ MEU_TOKEN: 'a', VERCEL_URL: 'x' }, CONHECIDOS), []);
});

test('1.66.1 · um nome em minúsculas também é um nome que a app não lê', () => {
  /* o Node no servidor compara nomes com maiúsculas: `orbita_api_token` nunca é
     lido, por isso é «quase» — e diz-se, em vez de ficar invisível */
  assert.deepEqual(nomesParecidos({ orbita_api_token: 'a'.repeat(64) }, CONHECIDOS), [
    { encontrado: 'orbita_api_token', devia: 'ORBITA_API_TOKEN' },
  ]);
});

test('1.66.1 · uma variável vazia não conta como «quase» (é como não existir)', () => {
  assert.deepEqual(nomesParecidos({ ORBITA_APITOKEN: '' }, CONHECIDOS), []);
  assert.deepEqual(nomesParecidos({ ORBITA_APITOKEN: '   ' }, CONHECIDOS), []);
});

test('1.66.1 · o aviso é só de nomes: nenhum valor sai no que se devolve', () => {
  const segredo = 'z'.repeat(64);
  const achados = nomesParecidos({ ORBITA_APITOKEN: segredo }, CONHECIDOS);
  const texto = JSON.stringify(achados) + fraseDoNomeErrado(achados[0]);
  assert.equal(texto.includes(segredo), false);
});
