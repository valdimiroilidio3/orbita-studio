/* ===========================================================================
   1.53.0 · A GROQ — a prova de que «Testar» é o mesmo pedido que o teu `curl`.

   O dono criou uma chave da Groq e colou o `curl` que usa:
     POST https://api.groq.com/openai/v1/chat/completions
     Authorization: Bearer gsk_…
     { "model": "openai/gpt-oss-120b", "messages": [...] }

   Este teste não prova que a chave dele é válida (isso é a rede, e a rede não
   está aqui). Prova o que está do nosso lado: com `GROQ_API_KEY` no ambiente,
   o motor fala com o endereço certo, manda o Bearer certo, escolhe o modelo do
   catálogo e só diz «ok» quando recebeu texto de volta. E que a chave nunca
   aparece numa resposta.
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { criarMotor } from './api/_ia/motor.mjs';
import { createMemRepo } from './api/_repo.mjs';

const CHAVE = 'gsk_teste_nao_e_uma_chave_a_serio_000000000000';

const json = (obj, status = 200) => ({
  ok: status < 400, status, headers: new Map([['content-type', 'application/json']]),
  text: async () => JSON.stringify(obj), json: async () => obj, clone() { return this; },
});

/** Um Groq falso, mas com o contrato do verdadeiro. */
function groqFalso({ modelos = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'], texto = 'ok', statusChat = 200 } = {}) {
  const pedidos = [];
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url);
    const cabecalhos = opt.headers || {};
    pedidos.push({ url: u, metodo: opt.method || 'GET', cabecalhos, corpo: opt.body ? JSON.parse(opt.body) : null });
    if (/\/models(\?|$)/.test(u)) return json({ data: modelos.map((id) => ({ id })) });
    if (/\/chat\/completions$/.test(u)) {
      if (statusChat >= 400) return json({ error: { message: 'invalid_api_key' } }, statusChat);
      return json({ choices: [{ message: { role: 'assistant', content: texto } }], usage: { prompt_tokens: 9, completion_tokens: 3 } });
    }
    return json({ erro: 'endereço inesperado: ' + u }, 404);
  };
  return { pedidos, fetchImpl };
}

test('Groq: com chave, «testar» fala com a api.groq.com certa, com o Bearer e o modelo do catálogo', async () => {
  const { pedidos, fetchImpl } = groqFalso();
  const motor = criarMotor({ repo: createMemRepo(), env: { GROQ_API_KEY: CHAVE }, fetchImpl });

  const r = await motor.testar('groq');

  assert.equal(r.ok, true);
  assert.equal(r.modelo, 'openai/gpt-oss-120b', 'o primeiro modelo do catálogo da Groq');
  assert.equal(r.resposta, 'ok');

  const lista = pedidos.find((p) => /\/models$/.test(p.url));
  assert.ok(lista, 'tem de perguntar ao fornecedor que modelos ele serve');
  assert.equal(lista.url, 'https://api.groq.com/openai/v1/models');

  const chat = pedidos.find((p) => /\/chat\/completions$/.test(p.url));
  assert.ok(chat, 'o teste é um pedido de chat a sério, não uma sonda de saúde');
  assert.equal(chat.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(chat.metodo, 'POST');

  const auth = Object.entries(chat.cabecalhos).map(([k, v]) => [k.toLowerCase(), v]);
  assert.deepEqual(Object.fromEntries(auth).authorization, `Bearer ${CHAVE}`);
  assert.equal(chat.corpo.model, 'openai/gpt-oss-120b');
  assert.equal(chat.corpo.messages.at(-1).role, 'user');

  // o que volta para a interface não pode levar a chave
  assert.equal(JSON.stringify(r).includes(CHAVE), false, 'a chave nunca sai numa resposta');
});

test('Groq: sem chave diz que falta a variável — não faz pedido nenhum', async () => {
  const { pedidos, fetchImpl } = groqFalso();
  const motor = criarMotor({ repo: createMemRepo(), env: {}, fetchImpl });
  await assert.rejects(() => motor.testar('groq'), /falta GROQ_API_KEY/);
  assert.equal(pedidos.length, 0);
});

test('Groq: chave recusada é dita por palavras (401), não como um «ok»', async () => {
  const { fetchImpl } = groqFalso({ statusChat: 401 });
  const motor = criarMotor({ repo: createMemRepo(), env: { GROQ_API_KEY: 'gsk_curta_nao_serve' }, fetchImpl });
  await assert.rejects(() => motor.testar('groq'), (e) => {
    assert.match(String(e.message), /401|recus/i);
    assert.equal(String(e.message).includes('gsk_curta_nao_serve'), false);
    return true;
  });
});

test('Groq: um modelo que responde vazio não conta como sucesso (vai ao seguinte)', async () => {
  const pedidos = [];
  const fetchImpl = async (url, opt = {}) => {
    pedidos.push(String(url));
    if (/\/models$/.test(String(url))) return json({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.1-8b-instant' }] });
    const corpo = JSON.parse(opt.body || '{}');
    // o primeiro modelo «pensa» e devolve vazio; o segundo responde de verdade
    const texto = corpo.model === 'openai/gpt-oss-120b' ? '' : 'sim';
    return json({ choices: [{ message: { content: texto } }] });
  };
  const motor = criarMotor({ repo: createMemRepo(), env: { GROQ_API_KEY: CHAVE }, fetchImpl });
  const r = await motor.testar('groq');
  assert.equal(r.ok, true);
  assert.equal(r.modelo, 'llama-3.1-8b-instant');
  assert.equal(pedidos.filter((u) => /chat\/completions$/.test(u)).length, 2);
});
