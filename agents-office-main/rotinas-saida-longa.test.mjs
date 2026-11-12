/* 1.89.1 · «respostas reais para todos os modelos» — ata e perguntas frequentes.
   O problema: uma ata ou um FAQ completo não cabia nos 900 tokens de saída, e um
   modelo de raciocínio que gasta o orçamento a pensar devolve texto vazio. Se a
   cadeia inteira faz isso, a tarefa falhava. Agora: o orçamento é o da rotina, e
   «vazio» em toda a cadeia dobra o orçamento uma vez (até 4000). Estes testes
   simulam os modelos com a regra real: cada um responde se tiver espaço. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROTINAS, executarTarefa } from './api/_tarefas.mjs';

const erroVazio = (fornec, modelo) => Object.assign(new Error(`${fornec}/${modelo} devolveu uma resposta vazia`), { codigo: 'vazio' });

/** Um motor com a cadeia de modelos dada. Cada modelo responde só com espaço suficiente. */
function cadeia(modelos) {
  const chamadas = [];
  return {
    chamadas,
    pedir: async (_tipo, _msgs, { maxTokens }) => {
      chamadas.push(maxTokens);
      const erros = [];
      for (const m of modelos) {
        if (maxTokens >= m.precisa) return { texto: `Resposta real de ${m.nome}.`, fornec: m.fornec, modelo: m.nome, tentativas: 1 };
        erros.push({ fornec: m.fornec, modelo: m.nome, codigo: m.codigo || 'vazio', erro: 'vazio' });
      }
      throw Object.assign(new Error('todos os modelos falharam'), { codigo: 'todosfalharam', erros });
    },
  };
}

const repoFalso = () => ({
  tarefas: { patch: async (id, c) => ({ id, ...c }) },
  leads: { byId: async () => ({ name: 'Oficina Teste', city: 'Braga', website: null }) },
  projetos: { byId: async () => ({ name: 'Site da Oficina', client: 'Oficina Teste' }) },
});

test('1.89.1 · a ata e o FAQ pedem o orçamento de saída da sua rotina, não 900', () => {
  assert.ok(ROTINAS.ata.maxTokens >= 1500, `ata com ${ROTINAS.ata.maxTokens} tokens de saída`);
  assert.ok(ROTINAS.faq.maxTokens >= 2000, `faq com ${ROTINAS.faq.maxTokens} tokens de saída`);
});

test('1.89.1 · um modelo de raciocínio (precisa de 2000) não faz falhar a ata: dobra o orçamento e responde', async () => {
  const motor = cadeia([{ fornec: 'ovh', nome: 'qwen-reasoning', precisa: 2500 }]);
  const r = await executarTarefa({ repo: repoFalso(), tarefa: { kind: 'ata', payload: { pedido: 'Notas: decidimos subir o preço' } }, env: {}, motor });
  assert.equal(r.ok, true, `a ata falhou: ${r.erro}`);
  assert.match(r.resultado, /Resposta real de qwen-reasoning/);
  assert.deepEqual(motor.chamadas, [1600, 3200], 'uma tentativa com o orçamento da rotina, outra com o dobro');
});

test('1.89.1 · uma cadeia com um modelo rápido e um de raciocínio responde pela cadeia, sem falhar', async () => {
  const motor = cadeia([
    { fornec: 'groq', nome: 'rapido', precisa: 400 },
    { fornec: 'ovh', nome: 'raciocinio', precisa: 3000 },
  ]);
  const r = await executarTarefa({ repo: repoFalso(), tarefa: { kind: 'faq', entity_id: 'p_1', entidade: 'projeto', payload: {} }, env: {}, motor });
  assert.equal(r.ok, true, `o FAQ falhou: ${r.erro}`);
  assert.ok(r.resultado.length > 0);
});

test('1.89.1 · o FAQ com uma cadeia que precisa de muito tem teto: 4000, nunca mais', async () => {
  const motor = cadeia([{ fornec: 'ovh', nome: 'enorme', precisa: 9000 }]);
  const r = await executarTarefa({ repo: repoFalso(), tarefa: { kind: 'faq', entity_id: 'p_1', entidade: 'projeto', payload: {} }, env: {}, motor });
  assert.equal(r.ok, false, 'sem resposta real não se inventa uma');
  assert.match(r.erro, /todos os modelos falharam|vazio/);
  assert.ok(Math.max(...motor.chamadas) <= 4000, `o pedido maior foi ${Math.max(...motor.chamadas)} tokens`);
  assert.equal(motor.chamadas.length, 2, 'duas tentativas, não mais');
});

test('1.89.1 · um erro que não é de resposta vazia (chave recusada) não dobra o orçamento', async () => {
  const motor = cadeia([{ fornec: 'groq', nome: 'sem-chave', precisa: 99999, codigo: 'chave' }]);
  const r = await executarTarefa({ repo: repoFalso(), tarefa: { kind: 'ata', payload: { pedido: 'x' } }, env: {}, motor });
  assert.equal(r.ok, false);
  assert.deepEqual(motor.chamadas, [1600], 'um só pedido: repetir uma chave recusada só gasta tempo');
});

test('1.89.1 · a ata continua a não inventar: sem texto do modelo, a tarefa falha com o motivo', async () => {
  const motor = { pedir: async () => ({ texto: '   ', fornec: 'groq', modelo: 'm', tentativas: 1 }) };
  const r = await executarTarefa({ repo: repoFalso(), tarefa: { kind: 'ata', payload: { pedido: 'Notas' } }, env: {}, motor });
  assert.equal(r.ok, false);
  assert.match(r.erro, /sem texto/);
});
