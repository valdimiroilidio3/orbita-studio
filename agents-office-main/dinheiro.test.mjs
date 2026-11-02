/* ===========================================================================
   1.55.0 · DINHEIRO VERDADEIRO — o que este ficheiro prova

   O defeito que o dono viu: `/ops/saldo` dizia `custoCentimos: 0` e
   `margemCentimos = receitaCentimos`. Não era falta de dados — o `/ia/uso` já
   guardava os tokens de cada chamada. Era falta de conta.

   A prova exigida pelo plano: **correr 10 tarefas e o saldo mostrar a soma com a
   conta à vista** (tokens × preço), sem um fornecedor «a zero». Aqui correm-se
   as 10 tarefas (motor falso com uso conhecido), gravam-se as 10 linhas de uso
   como o motor grava, e lê-se o saldo pela rota verdadeira.

   Regras que os testes protegem:
     · a soma é feita em micro-USD inteiros e só se arredonda no fim — 10 tarefas
       de 9,42 cêntimos dão 0,94 €? Não: dão 94 cêntimos, não 90;
     · preço desconhecido é `null`, nunca `0`, e o saldo diz quantas chamadas
       ficaram de fora;
     · o tecto de custo por execução existe e é respeitado, com o valor escrito.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  CAMBIO_PADRAO, cambioDe, centimosDeMicro, custoDeUso,
  eurosDeMicro, precosDoAmbiente, precoDe, tectoDeCusto,
} from './api/_dinheiro.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { orcamento } from './api/_ia/router.mjs';
import { criarECorrer, custoDaExecucao } from './api/_tarefas.mjs';
import { FICHEIROS, COLUNAS_EXIGIDAS } from './api/_esquema.mjs';

const GROQ = { fornec: 'groq', modelo: 'llama-3.3-70b-versatile' };   // 0,59 / 0,79 USD por 1M
const USO = { entrada: 60000, saida: 20000 };                         // 51 200 micro-USD por tarefa (4,71 cêntimos)

const chamar = (repo, caminho, metodo = 'GET', corpo = null, env = {}) => responder(repo, {
  caminho, metodo, corpo, env, fetchImpl: () => { throw new Error('sem rede neste teste'); },
});

/* -------------------------------------------------------------- a aritmética */

test('preço e conta: tokens × preço = micro-USD exacto, e o preço do dono manda', () => {
  assert.deepEqual(precoDe(GROQ.fornec, GROQ.modelo).preco, [0.59, 0.79]);
  assert.equal(precoDe('nao-existe', 'modelo'), null, 'sem preço, não se inventa um');

  const c = custoDeUso({ ...GROQ, entrada: 60000, saida: 20000 });
  assert.equal(c.microUsd, 51200, '60000×0,59 + 20000×0,79 = 51 200 micro-USD');
  assert.equal(c.desconhecido, false);
  assert.equal(c.preco[0], 0.59);

  /* um preço declarado pelo dono ganha ao do catálogo — é a fatura dele */
  const env = { ORBITA_PRECOS_IA: JSON.stringify({ 'groq/llama-3.3-70b-versatile': [1, 2] }) };
  const pago = custoDeUso({ ...GROQ, entrada: 1000000, saida: 0, env });
  assert.equal(pago.microUsd, 1000000, '1M tokens de entrada a 1 USD = 1 000 000 micro-USD');
  assert.equal(pago.fonte, 'ambiente');

  /* um modelo sem preço não é zero: é desconhecido */
  const sem = custoDeUso({ fornec: 'groq', modelo: 'inventado-9000', entrada: 1000, saida: 1000 });
  assert.equal(sem.microUsd, null);
  assert.equal(sem.desconhecido, true);
  assert.match(sem.nota, /ORBITA_PRECOS_IA/);

  assert.deepEqual(precosDoAmbiente({ ORBITA_PRECOS_IA: 'isto não é json' }), {});
  assert.deepEqual(precosDoAmbiente({ ORBITA_PRECOS_IA: JSON.stringify({ x: [1] }) }), {}, 'entradas malformadas ficam de fora, sem rebentar');
});

test('micro-USD → cêntimos: arredonda no fim, e o câmbio é declarado', () => {
  assert.equal(centimosDeMicro(102400), 9, '0,1024 USD × 0,92 = 0,094 € = 9,42 cêntimos, arredondados a 9');
  assert.equal(centimosDeMicro(null), null, 'desconhecido não vira 0');
  assert.equal(eurosDeMicro(102400), '0,09 €');
  assert.equal(centimosDeMicro(10000, 1), 1, '1 cêntimo é 10 000 micro-EUR a 1:1');
  const padrao = cambioDe({});
  assert.equal(padrao.fonte, 'padrao');
  assert.equal(padrao.taxa, CAMBIO_PADRAO);
  assert.match(padrao.nota, /ORBITA_CAMBIO_USD_EUR/);
  assert.deepEqual(cambioDe({ ORBITA_CAMBIO_USD_EUR: '1' }), { taxa: 1, fonte: 'ambiente', nota: 'taxa declarada em ORBITA_CAMBIO_USD_EUR' });
  assert.equal(tectoDeCusto({}), null, 'sem variável não há tecto');
  assert.equal(tectoDeCusto({ ORBITA_ORCAMENTO_CENTIMOS: '10', ORBITA_CAMBIO_USD_EUR: '1' }), 100000, '10 cêntimos = 100 000 micro-USD a 1:1');
});

test('o orçamento tem tecto de custo e diz quanto é que rebentou', () => {
  const orc = orcamento({ maxCustoMicroUsd: 50000, maxTokens: 1e9 });
  orc.gastar({ entrada: 1000, saida: 500 }, 10, { preco: [0.59, 0.79] });
  assert.equal(orc.custoMicroUsd, 985);
  assert.equal(orc.resumo().custoCentimos, centimosDeMicro(985));
  let erro = null;
  try { orc.gastar(USO, 10, { preco: [0.59, 0.79] }); } catch (e) { erro = e; }
  assert.ok(erro, 'o segundo passo passa o tecto de 5000 micro-USD');
  assert.equal(erro.codigo, 'orcamento');
  assert.match(erro.message, /orçamento de custo esgotado/);
  assert.match(erro.message, /0,05 €/, 'a mensagem mostra o tecto em euros, não em micro-USD');

  /* sem tecto continua a somar */
  const livre = orcamento({ maxTokens: 1e9 });
  livre.gastar(USO, 1, { preco: [0.59, 0.79] });
  assert.equal(livre.custoMicroUsd, 51200);
  assert.equal(livre.resumo().maxCustoMicroUsd, null);
});

/* ------------------------------------------- a prova: 10 tarefas e o saldo */

function repoComAlvos() {
  const repo = createMemRepo();
  repo._dados.leads.push({ id: 'l_1', name: 'Clínica do Mondego', status: 'contactado', city: 'Coimbra', created_at: new Date().toISOString(), dedupe_key: 'clinica|coimbra' });
  repo._dados.projetos.push({ id: 'p_1', name: 'Site da Clínica', kind: 'site', status: 'rascunho', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return repo;
}

const motorFalso = () => ({
  async pedir(tipo, mensagens, opcoes) {
    /* o motor verdadeiro faz isto por dentro: gasta no orçamento e devolve uso */
    opcoes?.orc?.gastar?.(USO, 40, { preco: [0.59, 0.79] });
    return { texto: 'trabalho feito', fornec: GROQ.fornec, modelo: GROQ.modelo, uso: USO, ms: 40, tentativas: 1 };
  },
});

test('10 tarefas correm, cada uma sabe quanto custou, e o saldo soma com a conta à vista', async () => {
  const repo = repoComAlvos();
  const motor = motorFalso();
  const TIPOS = { investigar: { label: 'Investigar o lead' }, briefing: { label: 'Escrever o briefing' } };

  for (let i = 0; i < 10; i += 1) {
    const lead = i % 2 === 0;
    const r = await criarECorrer({
      repo,
      corpo: lead
        ? { kind: 'investigar', entityId: 'l_1', entidade: 'lead' }
        : { kind: 'briefing', entityId: 'p_1', entidade: 'projeto' },
      motor, TIPOS, env: {},
    });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.tarefa.state, 'succeeded');
    /* o custo vai na resposta e fica GRAVADO na tarefa */
    assert.equal(r.corpo.execucao.custo.microUsd, 51200, `tarefa ${i}: 51 200 micro-USD`);
    assert.equal(r.corpo.tarefa.custo_micro_usd, 51200, `tarefa ${i}: o custo tem de ficar na linha`);
    /* e a linha de uso, como o motor a grava */
    await repo.ia.uso.registar({
      fornecedor: GROQ.fornec, modelo: GROQ.modelo, agente: 'orchestrator', tipo: 'texto',
      ok: true, ms: 40, tokens_in: USO.entrada, tokens_out: USO.saida, erro: null,
    });
  }

  /* a soma à mão: 10 × 102 400 = 1 024 000 micro-USD */
  const micro = 10 * 51200;
  assert.equal(centimosDeMicro(micro), 47, '0,47 € — 47,1 cêntimos arredondados ao fim');

  const s = (await chamar(repo, '/ops/saldo')).corpo;

  assert.equal(s.custoCentimos, 47, 'o custo do saldo é a soma, não zero');
  assert.equal(s.margemCentimos, 0 - 47, 'sem receita escrita, a margem é negativa e diz-se');

  /* um fornecedor, com tokens e preço à vista — não uma linha «a zero» */
  assert.equal(s.custosPorFornecedor.length, 1);
  const g = s.custosPorFornecedor[0];
  assert.equal(g.provider, 'groq');
  assert.equal(g.chamadas, 10);
  assert.equal(g.tokens, 10 * (USO.entrada + USO.saida));
  assert.equal(g.microUsd, micro);
  assert.equal(g.cents, 47);
  assert.equal(g.desconhecido, false);
  assert.deepEqual(g.preco, [0.59, 0.79]);

  /* a conta à vista: cada linha diz de onde vem o número */
  assert.equal(s.contaAVista.linhas.length, 1);
  const l = s.contaAVista.linhas[0];
  assert.equal(l.tokensIn, 10 * USO.entrada);
  assert.equal(l.tokensOut, 10 * USO.saida);
  assert.deepEqual(l.preco, [0.59, 0.79]);
  assert.equal(l.microUsd, micro);
  assert.equal(l.desconhecidas, 0);
  assert.match(s.contaAVista.nota, /não uma fatura/);

  /* o custo está atribuído: 5 tarefas ao lead, 5 ao projeto */
  assert.equal(s.tarefas.total, 10);
  assert.equal(s.tarefas.custoCentimos, 47);
  assert.equal(s.tarefas.semCusto, 0);
  assert.equal(s.custosPorLead[0].id, 'l_1');
  assert.equal(s.custosPorLead[0].tarefas, 5);
  assert.equal(s.custosPorLead[0].microUsd, 5 * 51200);
  assert.equal(s.custosPorLead[0].nome, 'Clínica do Mondego');
  assert.equal(s.custosPorProjeto[0].id, 'p_1');
  assert.equal(s.custosPorProjeto[0].tarefas, 5);

  /* e a média por lead, que é o que o dono usa para decidir */
  assert.equal(s.unitarios.custoPorLead, 47, 'só há um lead: todo o custo é dele');
  assert.equal(s.semDados.custo, null, 'com preço para tudo, não há nada por explicar');

  /* as tarefas lidas pela rota levam o custo já formatado */
  const lista = (await chamar(repo, '/ops/tarefas')).corpo;
  assert.equal(lista.tarefas.length, 10);
  assert.equal(lista.custos.centimos, 47);
  assert.equal(lista.custos.semCusto, 0);
  assert.equal(lista.tarefas[0].custo.centimos, 5, 'por tarefa: 4,71 cêntimos → 5; 10 arredondadas dariam 50, mas o total é 47');
});

test('uma chamada sem preço conhecido aparece como desconhecida — nunca como gratuita', async () => {
  const repo = createMemRepo();
  await repo.ia.uso.registar({ fornecedor: 'fornecedor-novo', modelo: 'modelo-secreto', ok: true, ms: 10, tokens_in: 5000, tokens_out: 2000 });

  const s = (await chamar(repo, '/ops/saldo')).corpo;
  assert.equal(s.contaAVista.desconhecidas, 1);
  assert.equal(s.custoCentimos, 0, 'não se soma o que não se sabe');
  assert.match(s.semDados.custo, /fora da soma/);
  assert.match(s.semDados.custo, /fornecedor-novo\/modelo-secreto/);
  assert.equal(s.custosPorFornecedor[0].desconhecido, true);
  assert.equal(s.custosPorFornecedor[0].microUsd, 0);
  assert.equal(s.custosPorFornecedor[0].tokens, 7000, 'os tokens estão medidos; o preço é que falta');

  /* declarado o preço, a mesma chamada passa a custar — sem mexer nos dados */
  const s2 = (await chamar(repo, '/ops/saldo', 'GET', null, {
    ORBITA_PRECOS_IA: JSON.stringify({ 'fornecedor-novo/modelo-secreto': [2, 4] }),
  })).corpo;
  assert.equal(s2.contaAVista.desconhecidas, 0);
  assert.equal(s2.contaAVista.linhas[0].microUsd, 5000 * 2 + 2000 * 4);
  assert.equal(s2.contaAVista.linhas[0].fonte, 'ambiente');
  assert.ok(s2.custoCentimos > 0);
});

test('o custo é do preço da altura: uma chamada gravada não muda quando o preço muda', async () => {
  const repo = createMemRepo();
  await repo.ia.uso.registar({ fornecedor: GROQ.fornec, modelo: GROQ.modelo, ok: true, ms: 5, tokens_in: 1000000, tokens_out: 0 });
  const antes = (await chamar(repo, '/ops/saldo')).corpo;
  assert.equal(antes.contaAVista.linhas[0].microUsd, 590000);
  const depois = (await chamar(repo, '/ops/saldo', 'GET', null, { ORBITA_PRECOS_IA: JSON.stringify({ groq: [10, 10] }) })).corpo;
  assert.equal(depois.contaAVista.linhas[0].microUsd, 590000, 'a linha gravada mantém o custo da altura');
});

test('sem uso, o saldo diz que o zero é ausência de consumo — não uma medição', async () => {
  const repo = createMemRepo();
  await chamar(repo, '/ops/receita', 'POST', { euros: 250.5, campaign: 'Coimbra' });
  const s = (await chamar(repo, '/ops/saldo')).corpo;
  assert.equal(s.receitaCentimos, 25050);
  assert.equal(s.custoCentimos, 0);
  assert.equal(s.margemCentimos, 25050);
  assert.match(s.semDados.custo, /não houve consumo/);
  assert.deepEqual(s.contaAVista.linhas, []);
  assert.match(s.semDados.cambio, /ORBITA_CAMBIO_USD_EUR/, 'o câmbio de referência é declarado, não escondido');
});

test('/ia/uso mostra a mesma conta, por fornecedor e por modelo', async () => {
  const repo = createMemRepo();
  await repo.ia.uso.registar({ fornecedor: GROQ.fornec, modelo: GROQ.modelo, ok: true, ms: 40, tokens_in: 120000, tokens_out: 40000 });
  await repo.ia.uso.registar({ fornecedor: GROQ.fornec, modelo: GROQ.modelo, ok: false, ms: 5, tokens_in: 0, tokens_out: 0, erro: '429' });

  const r = (await chamar(repo, '/ia/uso')).corpo;
  assert.equal(r.resumo[0].pedidos, 2);
  assert.equal(r.resumo[0].custoMicroUsd, 102400);
  assert.equal(r.resumo[0].custoCentimos, 9);
  assert.equal(r.resumo[0].modelos[0].tokensIn, 120000);
  assert.deepEqual(r.resumo[0].modelos[0].preco, [0.59, 0.79]);
  assert.equal(r.custos.microUsd, 102400);
  assert.equal(r.custos.chamadas, 2);
  assert.equal(r.custos.desconhecidas, 0);
  assert.match(r.custos.nota, /não uma fatura/);
});

test('o custo de uma tarefa vem do orçamento, e sem orçamento nem uso é desconhecido', () => {
  const comOrc = { resumo: () => ({ chamadas: 2, tokens: 3000, custoMicroUsd: 5000, custoCentimos: 0, semPreco: 0 }) };
  const a = custoDaExecucao({ orc: comOrc });
  assert.equal(a.microUsd, 5000);
  assert.equal(a.fonte, 'motor');
  assert.equal(a.desconhecido, false);

  const doUso = custoDaExecucao({ r: { ...GROQ, uso: { entrada: 1000, saida: 500 } } });
  assert.equal(doUso.microUsd, 985);
  assert.equal(doUso.fonte, 'uso');

  const nada = custoDaExecucao({ r: { texto: 'x' } });
  assert.equal(nada.microUsd, null);
  assert.equal(nada.desconhecido, true);
  assert.match(nada.nota, /desconhecido/);
});

test('migração 1.55.0: existe, é idempotente e está na ordem do esquema', () => {
  assert.ok(FICHEIROS.includes('orbita_1_55_0.sql'));
  assert.ok(existsSync(new URL('./supabase/orbita_1_55_0.sql', import.meta.url)));
  const sql = readFileSync(new URL('./supabase/orbita_1_55_0.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.orbita_ai_uso[\s\S]*add column if not exists custo_micro_usd bigint/);
  assert.match(sql, /alter table public\.orbita_tasks[\s\S]*add column if not exists custo_micro_usd bigint/);
  assert.doesNotMatch(sql, /drop table|truncate/i, 'uma migração não apaga dados');
  assert.ok(COLUNAS_EXIGIDAS.orbita_ai_uso.includes('custo_micro_usd'));
  assert.ok(COLUNAS_EXIGIDAS.orbita_tasks.includes('custo_micro_usd'));
});

test('o saldo deixa de ser «receita = margem» no código', () => {
  const rotas = readFileSync(new URL('./api/_rotas.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(rotas, /custoCentimos: 0, margemCentimos: receitaCentimos/, 'a conta antiga não pode voltar');
  assert.match(rotas, /calcularSaldo\(/);
});

test('a faixa do topo («Custos de API») deixa de dizer zero quando há chamadas', async () => {
  const repo = createMemRepo();
  await repo.ia.uso.registar({ fornecedor: GROQ.fornec, modelo: GROQ.modelo, ok: true, ms: 40, tokens_in: 60000, tokens_out: 20000 });
  const sum = (await chamar(repo, '/ops/summary')).corpo;
  assert.equal(sum.custos.apiCentimos, 5, '51 200 micro-USD = 4,71 cêntimos → 5');
  assert.equal(sum.custos.microUsd, 51200);
  assert.equal(sum.custos.chamadas, 1);
  assert.equal(sum.custos.desconhecidas, 0);

  const vazio = (await chamar(createMemRepo(), '/ops/summary')).corpo;
  assert.equal(vazio.custos.apiCentimos, 0);
  assert.equal(vazio.custos.chamadas, 0, 'sem chamadas, o zero é verdade — e diz-se porquê com `chamadas: 0`');
});

test('a mídia gerada entra no custo — e o que não tem valor fiável fica de fora, dito', async () => {
  const repo = createMemRepo();
  const agora = new Date().toISOString();
  repo._dados.geracoes.push(
    { id: 'g1', fornecedor: 'pollinations', tipo: 'imagem', estado: 'concluida', custo_estimado: 0, custo_confiavel: true, criado: agora },
    { id: 'g2', fornecedor: 'outro', tipo: 'imagem', estado: 'concluida', custo_estimado: 0.02, custo_confiavel: true, criado: agora },
    { id: 'g3', fornecedor: 'outro', tipo: 'video', estado: 'concluida', custo_estimado: null, custo_real: null, custo_confiavel: false, criado: agora },
  );
  const s = (await chamar(repo, '/ops/saldo')).corpo;
  assert.equal(s.midia.geracoes, 3);
  assert.equal(s.midia.microUsd, 20000, '0,02 USD = 20 000 micro-USD');
  assert.equal(s.midia.centimos, 2);
  assert.equal(s.midia.desconhecidas, 1);
  assert.equal(s.custoCentimos, 2, 'a mídia conta para o custo total');
  assert.equal(s.margemCentimos, -2);
  assert.match(s.semDados.custo, /geração de mídia ficou fora da soma/);
  assert.equal(s.midia.porFornecedor[0].fornecedor, 'outro');
  assert.equal(s.midia.porFornecedor[0].desconhecido, true, 'o fornecedor tem uma peça sem valor fiável — diz-se');
  assert.equal(s.midia.porFornecedor[0].desconhecidas, 1);
  assert.ok(s.midia.porFornecedor.some((m) => m.fornecedor === 'pollinations' && m.microUsd === 0 && !m.desconhecido), 'a imagem gratuita aparece a 0 porque é gratuita, não porque não se sabe');
});
