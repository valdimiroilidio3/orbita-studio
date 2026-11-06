/* ===========================================================================
   1.68.0 · A FILA DIZ A VERDADE (5 nov 2026)

   A 1.67.0 fez a fila mexer. Isto faz o ecrã dizer **quando** cada tarefa corre
   e **há quanto tempo** está à espera — as duas perguntas que «2 à espera»
   esconde. E as duas que doem:

     · com um agendador **diário**, uma tarefa à espera há mais de um dia é uma
       tarefa que o ciclo não apanhou (e isso agora vê-se e diz-se);
     · um tipo em «pede-me sempre» **nunca** corre sozinho — e a fila tem de o
       dizer em vez de deixar a pessoa à espera de um ciclo que não a leva.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NIVEIS, escopoDaTarefa, promessaDaTarefa, proximoCiclo, faltaPara, analisarFila, fraseDaFila,
  decidirAoAbrir, HORAS_ENTRE_ABERTURAS,
} from './src/fila.js';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { quandoEOCiclo } from './api/_rotas.mjs';

const H = 3600000;
const iso = (msAtras, agora = Date.now()) => new Date(agora - msAtras).toISOString();
const AGORA = Date.UTC(2026, 10, 5, 21, 0, 0);   // 5 nov, 21:00 UTC

const tarefa = (id, kind, msAtras) => ({ id, kind, state: 'queued', created_at: iso(msAtras) });

test('1.68.0 · a promessa de cada nível: sozinha, com espera, ou nunca sem ti', () => {
  const sempre = promessaDaTarefa({ nivel: 'pedir_sempre' });
  assert.equal(sempre.correSozinha, false);
  assert.equal(sempre.quando, 'a-tua-decisao');
  assert.match(sempre.rotulo, /tua autorização/);

  const proposto = promessaDaTarefa({ nivel: 'proposto', agendador: true });
  assert.equal(proposto.correSozinha, true);
  assert.match(proposto.rotulo, /próximo ciclo, e espera por ti/);

  const autonomo = promessaDaTarefa({ nivel: 'autonomo', agendador: true });
  assert.match(autonomo.rotulo, /corre no próximo ciclo/);

  /* sem agendador não se promete um ciclo que não vai acontecer */
  assert.match(promessaDaTarefa({ nivel: 'autonomo', agendador: false }).rotulo, /quando carregares/);
  /* um nível inventado cai no mais seguro */
  assert.equal(promessaDaTarefa({ nivel: 'yolo' }).nivel, 'pedir_sempre');
  assert.deepEqual(NIVEIS, ['pedir_sempre', 'proposto', 'autonomo']);
  assert.equal(escopoDaTarefa('investigar'), 'tarefa:investigar');
});

test('1.68.0 · o próximo ciclo é calculado (07:00 UTC), não prometido', () => {
  const p = proximoCiclo({ agora: AGORA });
  assert.equal(p.quando, '2026-11-06T07:00:00.000Z', 'às 21h o próximo é amanhã às 7h UTC');
  assert.equal(faltaPara(p.emMs), 'daqui a 10 h');

  const deMadrugada = proximoCiclo({ agora: Date.UTC(2026, 10, 6, 2, 0, 0) });
  assert.equal(deMadrugada.quando, '2026-11-06T07:00:00.000Z');

  /* sem agendador, «não sei» — não é «daqui a nada» */
  assert.equal(proximoCiclo({ agora: AGORA, agendador: false }), null);
  assert.equal(proximoCiclo({ agora: AGORA, horaUTC: 99 }), null);
  assert.equal(quandoEOCiclo(new Date(AGORA)), '2026-11-06T07:00:00.000Z');
});

test('1.68.0 · a análise ordena pela espera e diz o que vai acontecer a cada uma', () => {
  const r = analisarFila({
    tarefas: [tarefa('t1', 'investigar', 2 * H), tarefa('t2', 'mensagem', 30 * H), { id: 't3', kind: 'qa', state: 'running' }],
    autonomia: { 'tarefa:investigar': 'autonomo', 'tarefa:mensagem': 'pedir_sempre' },
    agora: Date.now(),
  });
  assert.equal(r.naFila, 2, 'só as queued entram');
  assert.deepEqual(r.itens.map((i) => i.id), ['t2', 't1'], 'a mais antiga primeiro');
  assert.equal(r.itens[0].nivel, 'pedir_sempre');
  assert.equal(r.itens[0].correSozinha, false);
  assert.equal(r.itens[1].correSozinha, true);
  assert.equal(r.contagem.autonomo, 1);
  assert.equal(r.contagem.pedir_sempre, 1);
  assert.equal(r.maisAntiga.id, 't2');
  assert.match(r.maisAntiga.espera, /1 d/);
});

test('1.68.0 · uma tarefa à espera há mais de um dia é apontada (o ciclo diário não a apanhou)', () => {
  const r = analisarFila({ tarefas: [tarefa('t1', 'qa', 26 * H)], agora: Date.now() });
  assert.equal(r.itens[0].perdida, true);
  assert.equal(r.perdidas, 1);
  assert.match(r.frase, /há mais de um dia/);
  assert.match(r.frase, /não a apanhou/);

  const fresco = analisarFila({ tarefas: [tarefa('t1', 'qa', 3 * H)], agora: Date.now() });
  assert.equal(fresco.perdidas, 0);
  assert.doesNotMatch(fresco.frase, /mais de um dia/);
});

test('1.68.0 · sem data de criação, diz que não sabe (não diz «agora»)', () => {
  const r = analisarFila({ tarefas: [{ id: 't1', kind: 'qa', state: 'queued' }], agora: Date.now() });
  assert.equal(r.itens[0].espera, null);
  assert.equal(r.itens[0].esperaDesconhecida, true);
  assert.equal(r.itens[0].perdida, false, 'sem data não se acusa ninguém');
  assert.doesNotMatch(r.frase, /a mais antiga/);
});

test('1.68.0 · a frase diz o número, a idade e o que falta', () => {
  const fases = analisarFila({
    tarefas: [tarefa('t1', 'investigar', 5 * H), tarefa('t2', 'mensagem', 2 * H)],
    autonomia: { 'tarefa:investigar': 'autonomo' },
    agora: Date.now(), agendador: true,
  });
  assert.match(fases.frase, /2 tarefas na fila/);
  assert.match(fases.frase, /a mais antiga há 5 h/);
  assert.match(fases.frase, /1 corre sozinha daqui a/);
  assert.match(fases.frase, /1 espera por ti/);

  const soEsperas = analisarFila({ tarefas: [tarefa('t1', 'qa', H)], agora: Date.now() });
  assert.match(soEsperas.frase, /1 espera por ti/);
  assert.doesNotMatch(soEsperas.frase, /corre sozinha/);
});

test('1.68.0 · sem agendador a frase diz que a fila só anda à mão', () => {
  const r = analisarFila({
    tarefas: [tarefa('t1', 'investigar', H)],
    autonomia: { 'tarefa:investigar': 'autonomo' },
    agendador: false, agora: Date.now(),
  });
  assert.equal(r.proximo, null);
  assert.match(r.frase, /quando correres o ciclo/);
  assert.match(r.frase, /só anda quando carregares/);
});

test('1.68.0 · fila vazia diz que está vazia', () => {
  const r = analisarFila({ tarefas: [], agora: Date.now() });
  assert.equal(r.naFila, 0);
  assert.match(fraseDaFila({}), /vazia/);
});

/* ---------- a leitura do servidor ---------- */

test('1.68.0 · GET /ops/ciclo diz, por tarefa, o nível e o que vai acontecer', async () => {
  const env = { ORBITA_ADMIN_TOKEN: 'a'.repeat(32), CRON_SECRET: 'c'.repeat(40) };
  const repo = createMemRepo();
  await repo.tarefas.insert({ kind: 'investigar', state: 'queued', entity_id: 'l1', entidade: 'lead' });
  await repo.tarefas.insert({ kind: 'mensagem', state: 'queued', entity_id: 'l1', entidade: 'lead' });
  await repo.autonomia.guardar({ escopo: 'tarefa:investigar', nivel: 'autonomo' });

  const r = await responder(repo, {
    caminho: '/ops/ciclo', metodo: 'GET', env, seguranca: true,
    headers: { authorization: `Bearer ${env.ORBITA_ADMIN_TOKEN}` },
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.naFila, 2);
  assert.equal(r.corpo.agendador, true);
  assert.match(r.corpo.proximo, /T07:00:00\.000Z$/, 'a hora do agendamento, em UTC');

  const investigar = r.corpo.tarefas.find((t) => t.kind === 'investigar');
  const mensagem = r.corpo.tarefas.find((t) => t.kind === 'mensagem');
  assert.equal(investigar.nivel, 'autonomo');
  assert.equal(investigar.correSozinha, true);
  assert.match(investigar.rotulo, /próximo ciclo/);
  assert.equal(mensagem.nivel, 'pedir_sempre');
  assert.equal(mensagem.correSozinha, false);
  assert.match(mensagem.rotulo, /tua autorização/);
});

test('1.68.0 · sem CRON_SECRET a leitura diz que não há agendador (e ninguém inventa um ciclo)', async () => {
  const env = { ORBITA_ADMIN_TOKEN: 'a'.repeat(32) };
  const repo = createMemRepo();
  await repo.tarefas.insert({ kind: 'qa', state: 'queued' });
  const r = await responder(repo, {
    caminho: '/ops/ciclo', metodo: 'GET', env, seguranca: true,
    headers: { authorization: `Bearer ${env.ORBITA_ADMIN_TOKEN}` },
  });
  assert.equal(r.corpo.agendador, false);
  assert.equal(r.corpo.proximo, null);
});

/* ===========================================================================
   1.70.0 · a fila não espera por amanhã
   =========================================================================== */

test('1.70.0 · fila vazia: abrir a Órbita não corre nada', () => {
  const d = decidirAoAbrir({ naFila: 0 });
  assert.equal(d.correr, false);
  assert.match(d.porque, /fila está vazia/);
});

test('1.70.0 · com fila e sem ciclo recente, abrir a Órbita põe a fila a andar', () => {
  const agora = Date.parse('2026-11-06T10:00:00.000Z');
  const d = decidirAoAbrir({ naFila: 3, agora, ultimoMs: agora - 5 * 3600000 });
  assert.equal(d.correr, true);
  assert.match(d.porque, /3 tarefas na fila/);
  assert.match(d.porque, /uma vez por dia/, 'a razão é o relógio do plano, não um capricho');
});

test('1.70.0 · não se corre a fila duas vezes na mesma janela (nem a cada navegação)', () => {
  const agora = Date.parse('2026-11-06T10:00:00.000Z');
  const d = decidirAoAbrir({ naFila: 2, agora, ultimoMs: agora - 30 * 60000 });
  assert.equal(d.correr, false);
  assert.match(d.porque, /já correu há/);

  /* no limite da janela, volta a poder correr */
  const noLimite = decidirAoAbrir({ naFila: 2, agora, ultimoMs: agora - HORAS_ENTRE_ABERTURAS * 3600000 });
  assert.equal(noLimite.correr, true);
});

test('1.70.0 · sem agendador, a abertura é a única coisa que mexe a fila — e di-lo', () => {
  const d = decidirAoAbrir({ naFila: 1, agendador: false, ultimoMs: null });
  assert.equal(d.correr, true);
  assert.match(d.porque, /não há agendador nenhum/);
});

test('1.70.0 · um relógio estragado no browser não bloqueia a fila', () => {
  const d = decidirAoAbrir({ naFila: 1, ultimoMs: Date.now() + 3600000 });
  assert.equal(d.correr, true, 'data no futuro não conta como «correu agora»');
});
