// A corrida completa, sem chaves e sem rede (1.35.0, 27 out 2026).
//
// «Implementa uma IA para começar os trabalhos» quer dizer: uma execução da mesa
// tem de andar do princípio ao fim com os motores gratuitos. Aqui faz-se uma
// corrida real do orquestrador — plano, passos, revisor — com o `fetch` a
// responder como o LLM7 responderia (keyless), e verifica-se o que ficou gravado.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { criarMotor } from './api/_ia/motor.mjs';
import { correr } from './api/_ia/orquestrador.mjs';
import { limparFora } from './api/_ia/router.mjs';
import { createMemRepo } from './api/_repo.mjs';

const corpo = (obj) => { const s = JSON.stringify(obj); return { text: async () => s, json: async () => obj }; };
const resposta = (texto) => ({ ok: true, status: 200, ...corpo({ choices: [{ message: { content: texto } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });

test('corrida: um objectivo atravessa plano, passos e revisor só com motores gratuitos', async () => {
  limparFora();
  const repo = createMemRepo();
  const pedidos = [];
  const fetchImpl = async (url, opt = {}) => {
    const corpoPedido = JSON.parse(opt.body || '{}');
    const sistema = String(corpoPedido.messages?.[0]?.content || '');
    pedidos.push({ url: String(url), sistema });
    if (/objecto JSON/i.test(sistema)) {
      return resposta(JSON.stringify({
        passos: [
          { agente: 'research', titulo: 'Levantar os factos', instrucao: 'Lê o que existe e resume.', criterio: 'Três factos concretos.' },
          { agente: 'reviewer', titulo: 'Rever', instrucao: 'Verifica o que foi produzido.', criterio: 'Diz o que falta.' },
        ],
        limites: ['sem internet neste teste'],
      }));
    }
    return resposta('Trabalho feito: três factos concretos, sem inventar.');
  };

  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const run = await correr({ repo, motor, objetivo: 'Organizar os leads de Coimbra', env: {} });

  assert.ok(run, 'a corrida tem de devolver a execução');
  assert.equal(['concluido', 'parcial'].includes(run.estado), true, `estado inesperado: ${run.estado} (${run.erro || ''})`);
  assert.ok(pedidos.length >= 2, 'houve pelo menos o plano e um passo');
  /* O plano pede raciocínio (vai ao OVH) e os passos pedem texto/código (vão ao
     LLM7): os dois são gratuitos. O que não pode haver é um fornecedor pago. */
  const gratuitos = /api\.llm7\.io|kepler\.ai\.cloud\.ovh|opencode\.ai|text\.pollinations\.ai/;
  assert.equal(pedidos.every((p) => gratuitos.test(p.url)), true, 'houve uma chamada a um fornecedor que não é gratuito: ' + pedidos.map((p) => p.url).join(' · '));
  assert.match(String(run.modelo || ''), /codestral|Qwen|gpt-oss|pickle/i);

  const passos = await repo.ia.steps.porRun(run.id);
  assert.ok(passos.length >= 2, 'os passos ficaram gravados');
  assert.ok(passos.every((s) => s.estado === 'concluido'), 'todos os passos concluíram');
  assert.ok(passos.every((s) => String(s.saida).length > 0), 'cada passo deixou texto — não uma caixa vazia');
  assert.ok(passos.every((s) => /llm7|ovh|opencode|pollinations/.test(String(s.fornecedor))), 'o fornecedor gravado é um dos gratuitos que responderam');
});

test('corrida: sem motor nenhum, a execução falha com a razão escrita (não fica a correr)', async () => {
  limparFora();
  const repo = createMemRepo();
  /* um motor cuja cadeia não tem nada: todos os fornecedores desligados */
  await repo.ia.config.gravar('desligados', ['llm7', 'ovh', 'opencode', 'pollinations']);
  const fetchImpl = async () => { throw new Error('não devia haver pedido'); };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const run = await correr({ repo, motor, objetivo: 'qualquer coisa', env: {} });
  assert.equal(run.estado, 'falhou');
  assert.match(String(run.erro), /fornecedor|motor/i);
});
