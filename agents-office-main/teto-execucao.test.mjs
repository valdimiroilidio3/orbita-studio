// O teto de custo de UMA execução (ORBITA_ORCAMENTO_CENTIMOS) tem de travar
// as execuções do orquestrador (/ia/runs), não só os pedidos avulsos.
//
// Porque existe: `motor.pedir` põe o teto por omissão, mas o orquestrador
// passa o seu próprio `orc` — e esse não tinha `maxCustoMicroUsd`. Com a
// variável definida, a execução gastava sem limite de custo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import { correr } from './api/_ia/orquestrador.mjs';

/* Um motor falso que gasta muito a cada pedido. `orc.gastar` é a mesma função
   que o motor real chama depois de cada resposta; o preço por token é o que o
   catálogo usa (micro-USD por token). */
function motorQueGasta() {
  const chamadas = [];
  return {
    chamadas,
    async estado() { return { diagnostico: { pronto: true } }; },
    async pedir(tipo, _mensagens, { orc }) {
      chamadas.push(tipo);
      orc.gastar({ entrada: 1000, saida: 0 }, 0, { preco: [1_000_000, 1_000_000] });
      return { texto: '{"passos":[]}', chamadas: [], modelo: 'falso', fornec: 'falso', entrada: 1000 };
    },
  };
}

test('execução: com ORBITA_ORCAMENTO_CENTIMOS, o teto de custo trava a execução', async () => {
  const repo = createMemRepo();
  const motor = motorQueGasta();
  const env = { ORBITA_ORCAMENTO_CENTIMOS: '1' };
  const run = await correr({ repo, motor, objetivo: 'Preparar uma proposta', env });
  assert.notEqual(run.estado, 'concluido', 'a execução concluiu apesar de passar o teto de custo');
  assert.match(String(run.erro || ''), /custo/, `a razão devia dizer custo: «${run.erro || ''}»`);
  assert.equal(motor.chamadas.length, 1, 'depois de passar o teto não pode haver nova chamada');
});

test('execução: sem a variável não há teto de custo (controlo)', async () => {
  const repo = createMemRepo();
  const motor = motorQueGasta();
  const run = await correr({ repo, motor, objetivo: 'Preparar uma proposta', env: {} });
  assert.doesNotMatch(String(run.erro || ''), /custo/, `não devia haver teto sem a variável: «${run.erro || ''}»`);
});
