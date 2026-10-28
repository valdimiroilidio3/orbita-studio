// «Implementa todas as gratuitas» — 1.39.0 (27 out 2026).
//
// O que se prova aqui: a acção que passa em revista os fornecedores que NÃO
// precisam de chave nova (keyless ou chave pública), faz um pedido real a cada
// um deles e só marca como funcional o que respondeu. O `fetch` é falso — o
// contrato é o real — por isso o teste mede o que a rota faz, não a internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rotasIA } from './api/_ia/rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const json = (obj, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => obj, text: async () => JSON.stringify(obj),
});

/* Um servidor que responde como o LLM7 e recusa tudo o resto. */
function mundo({ aceitar = /api\.llm7\.io/, modelos = ['codestral-latest'] } = {}) {
  const vistos = [];
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url);
    vistos.push(u);
    if (!aceitar.test(u)) return json({ error: { message: 'sem serviço aqui' } }, 503);
    if (/\/models\b/.test(u)) return json({ data: modelos.map((m) => ({ id: m })) });
    const corpo = JSON.parse(opt.body || '{}');
    return json({ model: corpo.model, choices: [{ message: { content: 'estou vivo' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
  };
  return { fetchImpl, vistos };
}

test('1 · prova os keyless e diz quem respondeu; quem falhou fica com o motivo', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = mundo();
  const r = await rotasIA(repo, {
    caminho: '/ia/provar-gratuitas', metodo: 'POST', corpo: { limite: 4 }, env: {}, fetchImpl,
  });

  assert.equal(r.status, 200);
  assert.ok(r.corpo.testados >= 1);
  const llm7 = r.corpo.resultados.find((x) => x.fornec === 'llm7');
  assert.ok(llm7, 'o LLM7 (keyless) tem de estar na revisão');
  assert.equal(llm7.ok, true);
  assert.equal(llm7.modelo, 'codestral-latest');
  assert.ok(llm7.ms !== undefined);

  /* e a prova ficou guardada: o que respondeu passa a contar como funcional */
  const estado = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: {}, fetchImpl });
  const f = estado.corpo.fornecedores.find((x) => x.id === 'llm7');
  assert.equal(f.estado, 'funcional', 'sem gravar a prova, «funcional» seria uma promessa');
  assert.equal(f.ultimoTeste?.ok, true);
});

test('2 · quando nada responde, a resposta é falsa e explica-se (nunca «ok» por omissão)', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = mundo({ aceitar: /nunca-acontece/ });
  const r = await rotasIA(repo, {
    caminho: '/ia/provar-gratuitas', metodo: 'POST', corpo: { limite: 2 }, env: {}, fetchImpl,
  });
  assert.equal(r.corpo.ok, false);
  assert.equal(r.corpo.provados, 0);
  assert.ok(r.corpo.falhados >= 1);
  const algum = r.corpo.resultados[0];
  assert.ok(algum.erros.length >= 1, 'cada falha tem de trazer o motivo');
  assert.match(algum.erros.join(' | '), /503|sem serviço|sem resposta/i);
});

test('3 · o tecto é respeitado — não se varre a internet toda num pedido', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = mundo();
  const r = await rotasIA(repo, {
    caminho: '/ia/provar-gratuitas', metodo: 'POST', corpo: { limite: 1 }, env: {}, fetchImpl,
  });
  assert.equal(r.corpo.testados, 1);
});

test('4 · escolher fornecedores explicitamente (o botão «provar estas») ', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = mundo();
  const r = await rotasIA(repo, {
    caminho: '/ia/provar-gratuitas', metodo: 'POST', corpo: { fornec: ['pollinations'] }, env: {}, fetchImpl,
  });
  assert.equal(r.corpo.testados, 1);
  assert.equal(r.corpo.resultados[0].fornec, 'pollinations');
  assert.equal(r.corpo.resultados[0].ok, false, 'o mundo falso só responde ao LLM7');
});

/* ---------------- o escritório também arranca sem chave ---------------- */

test('5 · sem chave nenhuma, o motor do escritório é a cadeia gratuita e responde', async () => {
  const { resolve, makeRunner } = await import('./providers.mjs');
  const antes = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_API_KEY']) delete process.env[k];
  try {
    const res = resolve({ ai: { provider: 'auto' } }, null);
    assert.ok(res.active, 'sem chaves tem de haver um motor — é isso que «começar os trabalhos» exige');
    assert.equal(res.active.id, 'gratis');
    assert.equal(res.active.tools, false, 'a cadeia gratuita escreve, não mexe');

    const { fetchImpl } = mundo();
    const runner = makeRunner(res.active, {}, {});
    const texto = await runner.ask('És um assistente.', 'Diz olá em português.', { fetchImpl });
    assert.equal(texto, 'estou vivo');
    const x = await runner.askX({ system: 'És um assistente.', user: 'Diz olá.', fetchImpl });
    assert.match(String(x.modelId), /^llm7\//, 'o modelo devolvido tem de dizer quem respondeu');
    assert.equal(x.tools.length, 0);
  } finally {
    for (const [k, v] of Object.entries(antes)) if (v !== undefined) process.env[k] = v;
  }
});
