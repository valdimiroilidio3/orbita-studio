/* ===========================================================================
   1.84.0 · A COERÊNCIA DO CONTROL CENTER (11 nov 2026)

   O que estava incoerente, medido antes de ser corrigido:

     · o escritório tem 47 lugares, o Orchestrator corre 8 motores, o motor de
       tarefas produz 6 tipos — e o mapa de postos falava `lead.pesquisar`,
       `projeto.gerar`, que o motor de produção nunca escreve. Resultado: no ao
       vivo, NENHUMA tarefa caía no seu posto;
     · `/ops/agentes` devolvia `agentes: []` em todas as salas;
     · o Control Center mostrava 8 agentes e nenhuma ligação aos 47;
     · o cartão do estúdio dizia «nenhum trabalho pedido» com imagens geradas;
     · a lista de «o que esta instalação não faz» afirmava que não havia
       fornecedor de pesquisa, com a Tavily ligada em produção.

   As provas abaixo são as cinco, uma a uma.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import { rotasIA } from './api/_ia/rotas.mjs';
import { responder } from './api/_rotas.mjs';
import { retrato } from './api/_aovivo.mjs';
import { montarEstado, estudioComImagem } from './api/_ia/painel.mjs';
import { criarMotor } from './api/_ia/motor.mjs';
import {
  elenco, agentesDaSala, rotinasDoPosto, motores,
  POSTO_DA_ROTINA, DEPARTAMENTO_DA_ROTINA, DEPARTAMENTO_EN_DA_ROTINA,
  SALA_DO_DEPARTAMENTO_PT, SALAS,
} from './api/_elenco.mjs';
import { ROTINAS } from './api/_tarefas.mjs';
import { INDISPONIVEIS, FERRAMENTAS, indisponiveisComAmbiente } from './api/_ia/ferramentas.mjs';
import { vistaIA } from './src/ia.js';

const desenhar = (S) => vistaIA(S, { esc: (x) => x, hhmm: (x) => x, when: (x) => x });

/* ---------- 1 · o elenco ---------- */

test('1.84.0 · o elenco tem os 47 lugares, repartidos pelas seis salas, sem perder ninguém', () => {
  const e = elenco();
  assert.equal(e.total, 47, 'os lugares do escritório mudaram de número sem isto ser revisto');
  assert.equal(e.agentes.length, 47);
  const soma = e.porSala.reduce((n, s) => n + s.agentes.length, 0);
  assert.equal(soma, 47, 'a soma das salas tem de dar o escritório inteiro');
  assert.equal(e.porSala.length, 6, 'são seis salas na cena');
  for (const s of e.porSala) assert.ok(SALAS[s.id], `a sala ${s.id} não tem nome em português`);
  /* todos os identificadores são únicos */
  assert.equal(new Set(e.agentes.map((a) => a.id)).size, 47);
  /* e nenhum lugar vem sem papel escrito */
  const semPapel = e.agentes.filter((a) => !a.papel || !a.faz);
  assert.deepEqual(semPapel.map((a) => a.id), [], 'há lugares sem papel ou sem descrição');
});

test('1.84.0 · com trabalho próprio e consultivos: a conta fecha e é a verdade do motor', () => {
  const e = elenco();
  assert.equal(e.comRotina + e.consultivos, e.total);
  assert.equal(e.comRotina, e.agentes.filter((a) => a.temRotina).length);
  /* um agente só tem rotina se houver um tipo de tarefa REAL que acabe nele */
  for (const a of e.agentes.filter((x) => x.temRotina)) {
    assert.ok(a.rotinas.length > 0);
    for (const k of a.rotinas) {
      assert.ok(ROTINAS[k], `${a.id} diz ter a rotina «${k}», que o motor não conhece`);
      assert.equal(POSTO_DA_ROTINA[k], a.id);
    }
  }
  /* e os 5 postos que o motor usa estão todos no elenco */
  const postos = new Set(Object.values(POSTO_DA_ROTINA));
  for (const posto of postos) {
    assert.ok(e.agentes.some((a) => a.id === posto), `o posto ${posto} não existe na cena`);
  }
  assert.match(e.resumo, /47 lugares/);
  assert.match(e.resumo, /consultivos/);
});

test('1.84.0 · a ponte cobre todos os tipos de trabalho do motor — e não inventa para o «escritorio»', () => {
  for (const kind of Object.keys(ROTINAS)) {
    assert.ok(DEPARTAMENTO_DA_ROTINA[kind], `o tipo «${kind}» não tem sala`);
    assert.ok(SALA_DO_DEPARTAMENTO_PT[DEPARTAMENTO_DA_ROTINA[kind]], `a sala de «${kind}» não existe na cena`);
  }
  /* o trabalho escrito à mão vai para o agente escolhido no pedido: sem posto fixo */
  assert.equal(POSTO_DA_ROTINA.escritorio, undefined);
  /* e o mesmo tipo, em inglês, para o escritório ao vivo */
  assert.equal(DEPARTAMENTO_EN_DA_ROTINA.investigar, 'prospect');
  assert.equal(rotinasDoPosto('elead').includes('escritorio'), false);
});

test('1.84.0 · os 8 motores do Orchestrator são a segunda camada, não os 47 lugares', () => {
  const e = elenco();
  assert.equal(e.motores.length, 8);
  assert.equal(motores().length, 8);
  for (const m of e.motores) {
    assert.ok(m.nome && m.papel, `${m.id} sem nome ou papel`);
    assert.ok(Array.isArray(m.ferramentas));
  }
  /* as duas camadas são listas diferentes. A única sobreposição de nome é o QA
     — o motor `qa` e o posto `qa` da cena — e vem marcada, não escondida. */
  const idsDosLugares = new Set(e.agentes.map((a) => a.id));
  const iguais = e.motores.filter((m) => idsDosLugares.has(m.id));
  assert.deepEqual(iguais.map((m) => m.id), ['qa'], 'apareceu uma sobreposição de nomes que ninguém explicou');
  assert.equal(e.motores.find((m) => m.id === 'qa').postoDaCena, 'qa');
  assert.equal(e.motores.find((m) => m.id === 'research').postoDaCena, null);
  assert.match(e.motoresNota, /8 motores/);
  assert.match(e.motoresNota, /47 lugares/);
});

/* ---------- 2 · o escritório ao vivo acende os postos ---------- */

test('1.84.0 · uma tarefa REAL (kind «investigar») acende o posto dela no escritório ao vivo', () => {
  /* antes: o retrato procurava `lead.pesquisar` e a base tinha `investigar` —
     nenhuma tarefa caía em posto nenhum */
  const tarefas = [{
    id: 't1', kind: 'investigar', title: 'Investigar o Café Central', state: 'succeeded',
    created_at: '2026-11-11T10:00:00.000Z', started_at: '2026-11-11T10:00:00.000Z',
    finished_at: '2026-11-11T10:00:20.000Z',
  }];
  const r = retrato({ tarefas, agora: Date.parse('2026-11-11T10:01:00.000Z') });
  const vmail = r.agents.vmail;
  assert.ok(vmail, 'o posto do AUDITOR DE WEBSITES devia estar no retrato');
  assert.equal(vmail.hasData, true, 'a tarefa real não chegou ao posto');
  assert.equal(vmail.kinds.includes('investigar'), true, 'o tipo do motor de produção tem de contar');
  assert.equal(vmail.last.state, 'succeeded');
});

test('1.84.0 · os dois vocabulários contam: o antigo (lead.pesquisar) e o que o motor escreve', () => {
  const antigo = [{ id: 'a', kind: 'lead.pesquisar', state: 'succeeded', created_at: '2026-11-11T09:00:00.000Z' }];
  const novo = [{ id: 'b', kind: 'investigar', state: 'succeeded', created_at: '2026-11-11T10:00:00.000Z' }];
  const r1 = retrato({ tarefas: antigo, agora: Date.parse('2026-11-11T11:00:00.000Z') });
  const r2 = retrato({ tarefas: novo, agora: Date.parse('2026-11-11T11:00:00.000Z') });
  assert.equal(r1.agents.vmail.hasData, true, 'a ponte partiu o vocabulário antigo');
  assert.equal(r2.agents.vmail.hasData, true, 'a ponte não cobre o vocabulário do motor');
});

/* ---------- 3 · /ops/agentes deixa de dizer que não há agentes ---------- */

test('1.84.0 · /ops/agentes devolve o elenco de cada sala (era `agentes: []` em todas)', async () => {
  const r = await responder(createMemRepo(), { caminho: '/ops/agentes', metodo: 'GET', env: {} });
  assert.equal(r.status, 200);
  const c = r.corpo;
  assert.equal(c.elenco.total, 47);
  /* 1.88.0 · 5 + 11 consultivos que passaram a ter rotina própria */
  assert.equal(c.elenco.comRotina, 16);
  assert.equal(c.elenco.consultivos, 31);
  assert.equal(c.elenco.motores, 8);
  let soma = 0;
  for (const d of c.departamentos) {
    assert.ok(d.agentes.length > 0, `a sala ${d.id} continua sem agentes`);
    soma += d.agentes.length;
    for (const a of d.agentes) {
      assert.equal(typeof a.temRotina, 'boolean', `${a.id} sem temRotina`);
      assert.equal(a.temRotina, (a.rotinas || []).length > 0);
      assert.equal(a.consultivo, !a.temRotina);
    }
    assert.equal(d.elenco.total, d.agentes.length);
    assert.equal(d.elenco.comRotina, d.agentes.filter((a) => a.temRotina).length);
  }
  assert.equal(soma, 47, 'a soma das salas da mesa tem de dar o escritório inteiro');
  /* a prova que o A9 pede: há pelo menos um agente com rotina e um consultivo */
  const todos = c.departamentos.flatMap((d) => d.agentes);
  assert.ok(todos.some((a) => a.temRotina));
  assert.ok(todos.some((a) => a.consultivo));
});

/* ---------- 4 · o estúdio diz as duas metades ---------- */

test('1.84.0 · o estúdio mostra a imagem real (Pollinations) e o OpenMontage, cada um com o seu estado', async () => {
  const repo = createMemRepo();
  /* três gerações reais: duas fechadas, uma falhada */
  for (const [estado, quando] of [['concluida', '2026-11-10T09:00:00.000Z'], ['concluida', '2026-11-09T09:00:00.000Z'], ['falhou', '2026-11-08T09:00:00.000Z']]) {
    await repo.geracoes.criar({
      chave: `k-${quando}`, projeto_id: 'p1', conta_id: 'mesa', tipo: 'imagem',
      fornecedor: 'pollinations', estado, criado: quando, prompt: 'x',
    });
  }
  const est = await estudioComImagem(repo, {});
  assert.equal(est.imagem.fornecedor, 'pollinations');
  assert.equal(est.imagem.disponivel, true);
  assert.equal(est.imagem.seteDias.total, 3);
  assert.equal(est.imagem.seteDias.concluidas, 2);
  assert.equal(est.imagem.seteDias.falhadas, 1);
  assert.equal(est.imagem.ultima.tipo, 'imagem');
  /* o OpenMontage continua declarado — não desapareceu por haver imagem */
  assert.ok(est.openmontage);
  assert.equal(typeof est.openmontage.configurado, 'boolean');
  assert.ok(est.openmontage.porque, 'sem worker, tem de dizer porquê');
});

test('1.84.0 · o estúdio chega ao Control Center dentro do estado (e sem inventar números)', async () => {
  const repo = createMemRepo();
  const motor = criarMotor({ repo, env: {} });
  const estado = await montarEstado(motor, { repo, env: {} });
  assert.equal(estado.estudio.imagem.seteDias.total, 0, 'sem gerações, zero — não um número de exemplo');
  assert.equal(estado.estudio.imagem.ultima, null);
  assert.ok(estado.estudio.openmontage);
  const html = desenhar({ ia: estado });
  assert.match(html, /Imagem — pollinations/);
  assert.match(html, /OpenMontage/);
  assert.doesNotMatch(html, /Nenhum trabalho de media pedido/);
  assert.match(html, /As imagens dos projetos não passam por esta fila/);
});

/* ---------- 5 · «o que não faz» deixa de mentir ---------- */

test('1.85.0 · a pesquisa e a imagem são ferramentas: deixam de estar na lista do que falta', () => {
  /* a lista do que NÃO existe só tem o que de facto falta */
  const ids = INDISPONIVEIS.map((i) => i.id);
  assert.ok(!ids.includes('pesquisa_web'), 'a pesquisa já é ferramenta (web_pesquisar)');
  assert.ok(!ids.includes('geracao_de_imagens'), 'a imagem já é ferramenta (imagem_gerar)');
  assert.ok(ids.includes('execucao_de_codigo'));
  assert.equal(FERRAMENTAS.web_pesquisar.parametros.required[0], 'consulta');
  assert.equal(FERRAMENTAS.web_ler.parametros.required[0], 'url');
  assert.equal(FERRAMENTAS.imagem_gerar.aprovacao, true);
  /* e o estado ambiental não inventa uma lista paralela */
  assert.deepEqual(indisponiveisComAmbiente({}).map((i) => i.id), INDISPONIVEIS.map((i) => i.id));
});

test('1.84.0 · o Control Center pinta o «existe em…» e o elenco inteiro', async () => {
  const repo = createMemRepo();
  const { corpo } = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: { TAVILY_API_KEY: 'x' } });
  assert.equal(corpo.elenco.total, 47);
  const html = desenhar({ ia: corpo });
  assert.match(html, /O elenco/);
  assert.match(html, /47 lugares no escritório/);
  assert.match(html, /16 com trabalho próprio/);
  assert.match(html, /31 consultivos/);
  /* 1.85.0 · a pesquisa e a imagem já são ferramentas dos agentes, com quem as pode usar */
  assert.match(html, /web_pesquisar/);
  assert.match(html, /quem pode: research/);
  assert.match(html, /pede OK \(custo\)/);
  assert.doesNotMatch(html, /existe em Prospeção/);
  assert.match(html, /Quem tem trabalho próprio e quem é consultivo/);
});

/* ---------- 6 · o modo local diz a mesma coisa ---------- */

test('1.84.0 · no modo local o elenco é o mesmo (47 lugares) — muda o trabalho, não quem existe', async () => {
  const { createLocalApi } = await import('./src/localapi.js');
  const memoria = new Map();
  const storage = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v), removeItem: (k) => memoria.delete(k) };
  const local = createLocalApi({ storage });
  const ag = await local.call('/ops/agentes', 'GET');
  assert.equal(ag.elenco.total, 47);
  assert.equal(ag.elenco.comRotina, 16);
  assert.equal(ag.departamentos.reduce((n, d) => n + d.agentes.length, 0), 47);
  const est = await local.call('/ia/estado', 'GET');
  assert.equal(est.elenco.total, 47);
  assert.equal(est.modo, 'local');
  assert.deepEqual(est.elenco.motores, [], 'os motores vivem no servidor — e o modo local diz isso');
  assert.match(est.elenco.motoresNota, /vivem no servidor/);
});

test('1.84.0 · a tabela dos tipos de trabalho não inventa nem perde nenhum', async () => {
  const e = elenco();
  assert.deepEqual(e.tiposSemMotor, [], 'há um tipo na tabela que o motor de tarefas não produz');
  assert.deepEqual(e.tiposSemPosto, [], 'há um tipo no motor sem sala nem posto declarado');
  /* 1.88.0 · 6 tipos + 11 rotinas dos consultivos = 17 */
  assert.equal(e.tiposDeTrabalho.length, 17);
  /* o trabalho escrito à mão não tem posto fixo, e o painel di-lo por palavras */
  const escritorio = e.tiposDeTrabalho.find((t) => t.kind === 'escritorio');
  assert.equal(escritorio.posto, null);
  assert.equal(escritorio.departamento, 'comando');
});
