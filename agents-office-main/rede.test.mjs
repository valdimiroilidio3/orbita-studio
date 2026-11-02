// Testes da REDE do Cérebro — 1.58.0 (2 nov 2026).
//
// O dono pediu que o Cérebro representasse «relações entre tarefas, agentes e
// conhecimento». Até aqui só tinha notas. `src/rede.js` constrói os três tipos de
// nó e as arestas reais entre eles, sem `Math.random` e sem tocar em three nem no
// DOM — é por isso que se prova aqui:
//
//   · agente → tarefa quando a tarefa é dele;
//   · tarefa → nota quando o servidor disse qual foi a nota;
//   · sem nota, NÃO há aresta (nem nó de conhecimento inventado);
//   · as mesmas entradas dão sempre o mesmo desenho (posições determinísticas);
//   · só entra o agente que tem trabalho escolhido — os outros não fazem peso;
//   · o limite respeita-se, e o que está aberto entra antes do que já acabou.
//
//   node --test rede.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { construirRede, resumoDaRede, notaDaTarefa, estadoDaTarefa, TIPOS, GRUPO } from './src/rede.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const AGENTES = [
  { id: 'elead', nome: 'ORBITA DIRECTOR', sala: 'emails' },
  { id: 'imail', nome: 'CHEFE DE GABINETE', sala: 'emails' },
  { id: 'pros', nome: 'LEAD HUNTER', sala: 'sales' },
];

const NOTAS = [{ id: 'briefing-aurora' }, { id: 'site-aurora' }, { id: 'nota-solta' }];

test('1 · sem trabalho, a rede está vazia — e di-lo', () => {
  const r = construirRede({});
  assert.equal(r.vazio, true);
  assert.equal(r.nos.length, 0);
  assert.equal(r.ligacoes.length, 0);
  assert.match(resumoDaRede(r).curto, /vazia/);
  assert.match(resumoDaRede(r).longo, /nasce do trabalho real/);
});

test('2 · agente → tarefa → nota: as duas arestas que o pedido nomeia', () => {
  const r = construirRede({
    agentes: AGENTES,
    tarefas: [
      { id: 1, agent: 'elead', title: 'Escrever o briefing', state: 'waiting', nota: 'briefing-aurora' },
    ],
    notas: NOTAS,
  });
  assert.equal(r.contagens.agentes, 1);
  assert.equal(r.contagens.tarefas, 1);
  assert.equal(r.contagens.notas, 1);
  assert.equal(r.contagens.ligacoes, 2, 'agente—tarefa e tarefa—nota');

  const chaves = r.ligacoes.map((l) => `${l.a} ${l.b}`);
  assert.ok(chaves.includes('agente:elead tarefa:1'));
  assert.ok(chaves.includes('tarefa:1 nota:briefing-aurora'));

  const tipos = r.nos.map((n) => n.tipo).sort();
  assert.deepEqual(tipos, ['agente', 'nota', 'tarefa']);
  assert.equal(TIPOS.tarefa.rotulo, 'Tarefas');
});

test('3 · sem nota declarada não há aresta inventada — nem nó de conhecimento', () => {
  const r = construirRede({
    agentes: AGENTES,
    tarefas: [{ id: 2, agent: 'pros', title: 'Prospectar Coimbra', state: 'doing' }],
    notas: NOTAS,
  });
  assert.equal(r.contagens.notas, 0);
  assert.equal(r.contagens.ligacoes, 1, 'só agente—tarefa');
  assert.equal(r.nos.filter((n) => n.tipo === 'nota').length, 0);
});

test('4 · uma nota que o grafo não tem não entra na rede', () => {
  const r = construirRede({
    agentes: AGENTES,
    tarefas: [{ id: 3, agent: 'elead', title: 'Escrever', state: 'done', nota: 'nota-que-nao-existe' }],
    notas: NOTAS,
  });
  assert.equal(r.contagens.notas, 0);
  assert.equal(r.contagens.ligacoes, 1);
});

test('5 · o mesmo trabalho dá sempre o mesmo desenho (sem sorteio)', () => {
  const entrada = {
    agentes: AGENTES,
    tarefas: [
      { id: 1, agent: 'elead', title: 'A', state: 'doing' },
      { id: 2, agent: 'imail', title: 'B', state: 'waiting', note: 'site-aurora' },
      { id: 3, agent: 'pros', title: 'C', state: 'done' },
    ],
    notas: NOTAS,
  };
  const a = construirRede(entrada);
  const b = construirRede(entrada);
  assert.deepEqual(a.nos.map((n) => [n.chave, n.x, n.y]), b.nos.map((n) => [n.chave, n.x, n.y]));
  for (const n of a.nos) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), 'posição é um número');
    assert.ok(Math.hypot(n.x, n.y) <= 0.95, 'ninguém fica fora do orbe');
  }
});

test('6 · só entra o agente que tem trabalho escolhido', () => {
  const r = construirRede({
    agentes: [...AGENTES, { id: 'qa', nome: 'QA E TESTES', sala: 'delivery' }],
    tarefas: [
      { id: 1, agent: 'elead', title: 'A', state: 'doing' },
      { id: 2, agent: 'desconhecido', title: 'B', state: 'doing' },
      { id: 3, title: 'C sem dono', state: 'queued' },
    ],
    notas: NOTAS,
  });
  const idsDeAgente = r.nos.filter((n) => n.tipo === 'agente').map((n) => n.id);
  assert.deepEqual(idsDeAgente, ['elead'], 'o agente sem tarefa e o desconhecido ficam de fora');
  assert.equal(r.contagens.tarefas, 3);
  assert.equal(r.contagens.semDono, 1, 'a tarefa sem dono conta-se e diz-se');
});

test('7 · o limite respeita-se e o trabalho aberto entra antes do fechado', () => {
  const tarefas = [
    { id: 1, agent: 'elead', title: 'Feita ontem', state: 'done', finished_at: '2026-11-01T10:00:00Z' },
    { id: 2, agent: 'elead', title: 'À espera do OK', state: 'awaiting_approval', created_at: '2026-11-02T09:00:00Z' },
    { id: 3, agent: 'imail', title: 'A correr', state: 'running', created_at: '2026-11-02T10:00:00Z' },
    { id: 4, agent: 'pros', title: 'Na fila', state: 'queued', created_at: '2026-11-02T11:00:00Z' },
  ];
  const r = construirRede({ agentes: AGENTES, tarefas, notas: NOTAS, limite: 2 });
  const titulos = r.nos.filter((n) => n.tipo === 'tarefa').map((n) => n.rotulo);
  assert.equal(titulos.length, 2);
  assert.deepEqual(titulos.sort(), ['A correr', 'À espera do OK'], 'o que está aberto vem primeiro');
});

test('8 · os três vocabulários de estado do trabalho coincidem', () => {
  assert.equal(estadoDaTarefa({ state: 'doing' }), 'aberta');
  assert.equal(estadoDaTarefa({ state: 'running' }), 'aberta');
  assert.equal(estadoDaTarefa({ state: 'awaiting_approval' }), 'espera');
  assert.equal(estadoDaTarefa({ state: 'queued' }), 'fila');
  assert.equal(estadoDaTarefa({ state: 'succeeded' }), 'feita');
  assert.equal(estadoDaTarefa({ state: 'failed' }), 'falhou');
  assert.equal(estadoDaTarefa(null), 'outra');
});

test('9 · a nota de uma tarefa é encontrada onde quer que o servidor a ponha', () => {
  assert.equal(notaDaTarefa({ nota: 'a' }), 'a');
  assert.equal(notaDaTarefa({ note: 'b' }), 'b');
  assert.equal(notaDaTarefa({ resultado: { nota: 'c' } }), 'c');
  assert.equal(notaDaTarefa({ piece: { note: 'd' } }), 'd');
  assert.equal(notaDaTarefa({}), null);
  assert.equal(notaDaTarefa({ nota: '   ' }), null);
});

test('10 · o resumo diz a verdade em duas medidas (curta e longa)', () => {
  const r = construirRede({
    agentes: AGENTES,
    tarefas: [
      { id: 1, agent: 'elead', title: 'A', state: 'doing', nota: 'site-aurora' },
      { id: 2, agent: 'pros', title: 'B', state: 'doing' },
    ],
    notas: NOTAS,
  });
  const s = resumoDaRede(r);
  assert.equal(s.curto, '2 agentes · 2 tarefas · 1 nota');
  assert.match(s.longo, /3 ligações reais/);
});

test('11 · as chaves dos nós são as que o grafo do Cérebro sabe procurar', () => {
  const r = construirRede({
    agentes: AGENTES,
    tarefas: [{ id: 'abc', agent: 'elead', title: 'A', state: 'doing', nota: 'briefing-aurora' }],
    notas: NOTAS,
  });
  const chaves = new Set(r.nos.map((n) => n.chave));
  assert.ok(chaves.has('agente:elead'));
  assert.ok(chaves.has('tarefa:abc'));
  assert.ok(chaves.has('nota:briefing-aurora'), 'a nota usa a chave da nota que já existe no grafo');
  assert.equal(GRUPO.agente, '00-Agentes');
  assert.equal(GRUPO.tarefa, '00-Tarefas');
});

test('12 · o Cérebro lê esta rede e não guarda trabalho velho', () => {
  const brain = fs.readFileSync(path.join(ROOT, 'src/brain.js'), 'utf8');
  assert.match(brain, /const rede = construirRede\(\{ agentes, tarefas, notas: base\.map\(n => \(\{ id: n\.id \}\)\) \}\)/);
  assert.match(brain, /nodes\.length = baseLen/, 'os nós de trabalho são cortados antes de se reconstruírem');
  assert.match(brain, /links = links\.filter\(\(\[a, b\]\) => a < baseLen && b < baseLen\)/, 'as arestas velhas saem com eles');
  assert.match(brain, /idx\.set\(no\.chave, i\)/, 'as chaves da rede ligam-se aos índices do grafo');
  assert.match(brain, /baseLen = null; redeAtual = null;/, 'um grafo novo do servidor recomeça a base');
});
