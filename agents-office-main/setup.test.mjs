/* ===========================================================================
   1.64.0 · O `/api/setup` COM POST (4 nov 2026)

   A página do arranque passou a poder ler e aplicar o esquema sem ninguém ter de
   construir um endereço à mão. Isso obrigou a uma coisa simples e séria: o token
   deixar de andar no URL (fica nos registos do servidor, no histórico e no
   Referer) e passar a ir no corpo do pedido.

   O que aqui se prova, sem base, sem rede e sem Vercel:

     · o `GET` de sempre continua a funcionar (há quem o tenha nos favoritos);
     · o `POST` aceita `{token}`, e o `GET` continua a mandar quando os dois vêm;
     · sem token (ou com o token errado) é **404** — a rota não confirma que existe;
     · com o token certo e sem `DATABASE_URL`, o erro nomeia o que falta;
     · um método que não se serve é **405**, não uma aplicação de esquema às cegas;
     · o corpo tem tecto (413) e JSON inválido vira `{}` em vez de rebentar;
     · o token **nunca** sai na resposta.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

const TOKEN = 'token-de-setup-para-o-teste';

const comAmbiente = async (fn) => {
  const guardado = { SETUP_TOKEN: process.env.SETUP_TOKEN, DATABASE_URL: process.env.DATABASE_URL, POSTGRES_URL: process.env.POSTGRES_URL };
  process.env.SETUP_TOKEN = TOKEN;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  try { await fn(); } finally {
    for (const [k, v] of Object.entries(guardado)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

const resposta = () => ({
  statusCode: 0, body: null, cabecalhos: {},
  setHeader(k, v) { this.cabecalhos[String(k).toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});

const corpoDe = (obj) => (async function* () { yield Buffer.from(JSON.stringify(obj)); })();

test('o token compara-se sem sair à primeira letra diferente', async () => {
  const { tokenIgual } = await import('./api/setup.mjs');
  assert.equal(tokenIgual('abc', 'abc'), true);
  assert.equal(tokenIgual('abd', 'abc'), false);
  assert.equal(tokenIgual('abc', 'abcd'), false, 'tamanhos diferentes não passam');
  assert.equal(tokenIgual('', ''), false, 'sem token esperado não há nada que sirva');
  assert.equal(tokenIgual(undefined, 'abc'), false);
  assert.equal(tokenIgual('abc', undefined), false);
});

test('o corpo lê-se de três formas e tem tecto', async () => {
  const { lerCorpo } = await import('./api/setup.mjs');
  assert.deepEqual(await lerCorpo({ body: { token: 'a' } }), { token: 'a' }, 'corpo já lido pelo runtime');
  assert.deepEqual(await lerCorpo({ body: '{"token":"b"}' }), { token: 'b' }, 'corpo em texto');
  assert.deepEqual(await lerCorpo({ body: 'não é json' }), {}, 'lixo não rebenta');
  assert.deepEqual(await lerCorpo({}), {}, 'sem corpo nenhum');
  const fluxo = { [Symbol.asyncIterator]: () => corpoDe({ token: 'c', ler: true }) };
  assert.deepEqual(await lerCorpo(fluxo), { token: 'c', ler: true }, 'fluxo de bytes');
  const grande = { [Symbol.asyncIterator]: () => (async function* () { yield Buffer.alloc(5000, 97); })() };
  await assert.rejects(() => lerCorpo(grande), (e) => e.status === 413, 'um corpo gigante é recusado');
});

test('POST sem token é 404 — a rota não confirma que existe', async () => {
  await comAmbiente(async () => {
    const { default: setup } = await import('./api/setup.mjs');
    const res = resposta();
    await setup({ method: 'POST', url: '/api/setup', body: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'não existe' });
    assert.equal(res.cabecalhos['cache-control'], 'no-store');
  });
});

test('POST com o token no corpo passa a porta (e o erro seguinte nomeia o que falta)', async () => {
  await comAmbiente(async () => {
    const { default: setup } = await import('./api/setup.mjs');
    const res = resposta();
    await setup({ method: 'POST', url: '/api/setup', body: { token: TOKEN } }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.erro, /DATABASE_URL/, 'sem ligação à base, diz qual é a variável');
    assert.equal(JSON.stringify(res.body).includes(TOKEN), false, 'o token nunca sai na resposta');
  });
});

test('POST com ler:true também passa a porta (a auditoria é o mesmo caminho)', async () => {
  await comAmbiente(async () => {
    const { default: setup } = await import('./api/setup.mjs');
    const res = resposta();
    await setup({ method: 'POST', url: '/api/setup', body: { token: TOKEN, ler: true } }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.erro, /DATABASE_URL/);
  });
});

test('o GET de sempre continua igual', async () => {
  await comAmbiente(async () => {
    const { default: setup } = await import('./api/setup.mjs');
    const semToken = resposta();
    await setup({ method: 'GET', url: '/api/setup' }, semToken);
    assert.equal(semToken.statusCode, 404);
    const comToken = resposta();
    await setup({ method: 'GET', url: `/api/setup?token=${TOKEN}` }, comToken);
    assert.equal(comToken.statusCode, 500);
    assert.match(comToken.body.erro, /DATABASE_URL/);
    /* o endereço ganha ao corpo: quem manda o token de uma forma não é obrigado a mandar das duas */
    const ambos = resposta();
    await setup({ method: 'GET', url: `/api/setup?token=${TOKEN}`, body: { token: 'outro' } }, ambos);
    assert.equal(ambos.statusCode, 500, 'o token do endereço vale');
  });
});

test('um método que não se serve é 405 — não se aplica esquema às cegas', async () => {
  await comAmbiente(async () => {
    const { default: setup } = await import('./api/setup.mjs');
    for (const metodo of ['PUT', 'DELETE', 'PATCH']) {
      const res = resposta();
      await setup({ method: metodo, url: `/api/setup?token=${TOKEN}` }, res);
      assert.equal(res.statusCode, 405, `${metodo} devia ser 405`);
      assert.match(res.body.error, /GET ou POST/);
    }
  });
});

test('token errado é 404 e não 401 — e não diz se o SETUP_TOKEN existe', async () => {
  await comAmbiente(async () => {
    const { default: setup } = await import('./api/setup.mjs');
    const res = resposta();
    await setup({ method: 'POST', url: '/api/setup', body: { token: 'quase-certo-mas-nao' } }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'não existe' });
  });
});
