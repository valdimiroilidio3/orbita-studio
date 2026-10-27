// Testes do motor «Gratuitas (sem chave)» do escritório (1.35.0, 27 out 2026).
//
// O pedido do dono: «implementa uma IA para começar os trabalhos, implementa
// todas gratuitas». O escritório só sabia falar com motores que exigem chave ou
// um CLI instalado — numa instalação limpa não havia motor nenhum e as salas não
// começavam trabalho. Aqui prova-se, sem rede:
//   · a cadeia gratuita aparece como o motor activo quando não há mais nada;
//   · uma pergunta chega ao LLM7 sem chave e volta com texto;
//   · quando o primeiro fornecedor falha, o router passa ao seguinte e diz qual
//     respondeu (fallback real, não promessa);
//   · quando todos falham, o erro nomeia cada um — não inventa uma resposta;
//   · o runner não promete ferramentas (esta cadeia escreve, não mexe).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, define, makeRunner, resolve, summary, why } from './providers.mjs';
import { limparFora } from './api/_ia/router.mjs';

/* o `falar()` do api/_ia lê o corpo com `text()` (é o que a fetch real dá);
   o teste devolve as duas formas para não depender desse detalhe */
const corpo = (obj) => {
  const s = JSON.stringify(obj);
  return { text: async () => s, json: async () => obj };
};
const respostaOpenAI = (texto) => ({
  ok: true, status: 200,
  ...corpo({ model: 'x', choices: [{ message: { content: texto } }], usage: { prompt_tokens: 12, completion_tokens: 7 } }),
});
const falha = (status = 500, msg = 'avaria') => ({ ok: false, status, ...corpo({ error: { message: msg } }) });

test('gratis: existe como fornecedor, não precisa de chave e é o activo sem mais nada', () => {
  assert.ok(PRESETS.gratis, 'falta o fornecedor «gratis»');
  const d = define('gratis', {});
  assert.equal(why(d), null, 'a cadeia gratuita não pode exigir chave para estar disponível');
  const res = resolve({}, null);
  assert.equal(res.active?.id, 'gratis', 'sem chaves, o motor tem de ser a cadeia gratuita');
  assert.equal(res.active.tools, false, 'esta cadeia devolve texto: não pode dizer que dá ferramentas');
  const s = summary(res, {});
  assert.ok(s.available.some((x) => x.id === 'gratis'));
});

test('gratis: a pergunta chega ao LLM7 sem cabeçalho de chave e volta com texto', async () => {
  limparFora();
  const d = define('gratis', {});
  const runner = makeRunner({ ...d, available: true }, {});
  const vistos = [];
  const fetchImpl = async (url, opt = {}) => {
    vistos.push({ url: String(url), headers: opt.headers || {}, corpo: JSON.parse(opt.body || '{}') });
    return respostaOpenAI('Comecei o trabalho: três passos.');
  };
  const r = await runner.askX({ system: 'és um agente', user: 'começa o trabalho', fetchImpl });
  assert.equal(vistos.length, 1, 'uma tentativa chegou');
  assert.match(vistos[0].url, /api\.llm7\.io/);
  assert.equal(vistos[0].headers.authorization, undefined, 'o LLM7 é keyless: não se inventa uma chave');
  assert.equal(vistos[0].corpo.messages[0].role, 'system');
  assert.equal(vistos[0].corpo.messages[1].content, 'começa o trabalho');
  assert.match(r.text, /Comecei o trabalho/);
  assert.match(r.modelId, /^llm7\//);
  assert.equal(r.usage.output_tokens, 7);
});

test('gratis: se o primeiro fornecedor falha, responde o seguinte e o modelo diz qual foi', async () => {
  limparFora();
  const d = define('gratis', {});
  const runner = makeRunner({ ...d, available: true }, {});
  const urls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('llm7')) return falha(500, 'model unavailable');
    return respostaOpenAI('resposta do segundo fornecedor');
  };
  const r = await runner.askX({ user: 'olá', fetchImpl });
  assert.equal(urls.length >= 2, true, 'tinha de tentar outro fornecedor');
  assert.match(urls[0], /llm7/);
  assert.equal(r.text, 'resposta do segundo fornecedor');
  assert.doesNotMatch(r.modelId, /^llm7\//, 'o modelo tem de ser o que respondeu');
});

test('gratis: quando todos falham, o erro nomeia os fornecedores e não devolve texto inventado', async () => {
  limparFora();
  const d = define('gratis', {});
  const runner = makeRunner({ ...d, available: true }, {});
  const fetchImpl = async () => falha(503, 'sem serviço');
  await assert.rejects(
    () => runner.askX({ user: 'olá', fetchImpl }),
    (e) => /todos os modelos falharam/i.test(e.message) && /llm7/.test(e.message),
  );
});

test('gratis: runner.ask devolve só o texto (é o que as salas consomem)', async () => {
  limparFora();
  const d = define('gratis', {});
  const runner = makeRunner({ ...d, available: true }, {});
  const fetchImpl = async () => respostaOpenAI('texto simples');
  const texto = await runner.ask('sistema', 'pedido', { fetchImpl });
  assert.equal(texto, 'texto simples');
});
