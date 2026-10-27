// Testes do Centro de Controlo (1.20.0, 27 out 2026).
//
// O que se prova aqui, sem rede e sem browser:
//   · a sala cresce em filas inteiras quando entra um agente, e nunca encolhe;
//   · o agente novo recebe o primeiro lugar livre (não fica em cima de outro);
//   · uma cor inválida é recusada — não pinta a sala de erro;
//   · uma configuração guardada estragada é ignorada (a cena abre na mesma);
//   · as rotas guardam e devolvem os ajustes, e recusam o que não faz sentido;
//   · os três estados (configurado / ligado / a funcionar) vêm de factos:
//     chave no ambiente, último teste real e execuções nas últimas 24 h.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aplicarNaCena, contarAgentes, corDoVidro, corValida, filasNecessarias,
  gravarAjustes, idDeAgente, lerAjustes, lugarLivre, plantaAjustada, profundidadePara,
} from './src/salas.js';
import { SEAT_GRID } from './src/data.js';
import {
  comAgente, comCor, limparAjustes, retrato, semAgente,
} from './api/_controlo.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const chamar = (repo, caminho, metodo = 'GET', corpo = null) => responder(repo, { caminho, metodo, corpo, env: {} });

/* ---------- 1 · a conta da sala ---------- */
test('salas: filas e profundidade crescem com a lotação, sem inventar centímetros', () => {
  assert.equal(filasNecessarias(0), 1);
  assert.equal(filasNecessarias(2), 1);
  assert.equal(filasNecessarias(3), 2);
  assert.equal(filasNecessarias(7), 4);
  /* uma fila a mais = exactamente um `rowStep` a mais */
  assert.ok(Math.abs((profundidadePara(5) - profundidadePara(4)) - SEAT_GRID.rowStep) < 1e-9, 'a fila a mais não vale um rowStep');
  /* a faixa da frente nunca é comida */
  assert.ok(profundidadePara(6) > SEAT_GRID.wallGap + SEAT_GRID.entryBand);
});

test('salas: um agente novo ocupa o primeiro lugar livre, nunca o de outro', () => {
  const agentes = [
    { id: 'a', dept: 'sales', grid: [0, 0] },
    { id: 'b', dept: 'sales', grid: [1, 0] },
    { id: 'c', dept: 'sales', grid: [0, 1] },
  ];
  assert.deepEqual(lugarLivre(agentes, 'sales'), [1, 1]);
  assert.deepEqual(lugarLivre([], 'fin'), [0, 0]);
});

test('salas: a planta só cresce (nunca encolhe uma sala que já existia)', () => {
  const layout = { sales: { pos: [30, -23], w: 20, d: 34 } };
  const vazia = plantaAjustada(layout, []);
  assert.equal(vazia.sales.d, 34, 'sem agentes a sala não pode encolher');
  const cheia = plantaAjustada(layout, Array.from({ length: 11 }, (_, i) => ({ id: `x${i}`, dept: 'sales', grid: [i % 2, Math.floor(i / 2)] })));
  assert.ok(cheia.sales.d > 34, 'com 11 agentes a sala tem de crescer');
  assert.equal(cheia.sales.d, profundidadePara(6));
});

/* ---------- 2 · cores ---------- */
test('cores: só entra hexadecimal, e o vidro é mais escuro do que o chip', () => {
  assert.equal(corValida('#5ADEB7'), true);
  assert.equal(corValida('#abc'), true);
  assert.equal(corValida('verde'), false);
  assert.equal(corValida('#12345'), false);
  assert.notEqual(corDoVidro('#5ADEB7').toLowerCase(), '#5adeb7');
  assert.equal(corDoVidro('nada'), 'nada');
});

test('cores: uma sala com cor nova muda o chip e o vidro, e as outras ficam quietas', () => {
  const DEPTS = { sales: { chip: '#111111', ink: '#222222', glass: '#333333' }, fin: { chip: '#444444', ink: '#555555', glass: '#666666' } };
  const LAYOUT = { sales: { pos: [0, 0], w: 20, d: 34 }, fin: { pos: [1, 0], w: 20, d: 26 } };
  const AGENTS = [];
  const r = aplicarNaCena({ DEPTS, LAYOUT, AGENTS }, { cores: { sales: '#EADC8F' }, agentes: [] });
  assert.deepEqual(r.cores, ['sales']);
  assert.equal(DEPTS.sales.chip, '#EADC8F');
  assert.notEqual(DEPTS.sales.glass, '#333333');
  assert.equal(DEPTS.fin.chip, '#444444', 'a outra sala não pode mudar de cor');
});

/* ---------- 3 · agentes acrescentados ---------- */
test('agentes: entra na cena, na sala certa, e a sala cresce com ele', () => {
  const DEPTS = { sales: { chip: '#111111', ink: '#222222', glass: '#333333' } };
  const LAYOUT = { sales: { pos: [0, 0], w: 20, d: 34 } };
  const AGENTS = [
    { id: 'a', name: 'A', dept: 'sales', grid: [0, 0] },
    { id: 'b', name: 'B', dept: 'sales', grid: [1, 0] },
    { id: 'c', name: 'C', dept: 'sales', grid: [0, 1] },
    { id: 'd', name: 'D', dept: 'sales', grid: [1, 1] },
    { id: 'e', name: 'E', dept: 'sales', grid: [0, 2] },
    { id: 'f', name: 'F', dept: 'sales', grid: [1, 2] },
    { id: 'g', name: 'G', dept: 'sales', grid: [0, 3] },
    { id: 'h', name: 'H', dept: 'sales', grid: [1, 3] },
  ];
  const antes = LAYOUT.sales.d;
  const r = aplicarNaCena({ DEPTS, LAYOUT, AGENTS }, { cores: {}, agentes: [{ id: 'novo', nome: 'Gestor de tráfego', dept: 'sales', funcao: 'anúncios' }] });
  assert.deepEqual(r.entraram, ['novo']);
  assert.equal(contarAgentes(AGENTS, 'sales'), 9);
  assert.deepEqual(AGENTS.at(-1).grid, [0, 4], 'o nono agente abre a fila 5');
  assert.ok(LAYOUT.sales.d > antes, 'a sala não cresceu para caber o agente novo');
});

test('agentes: a mesma configuração aplicada duas vezes não duplica o agente', () => {
  const DEPTS = { sales: { chip: '#111111', ink: '#222222', glass: '#333333' } };
  const LAYOUT = { sales: { pos: [0, 0], w: 20, d: 34 } };
  const AGENTS = [];
  const ajustes = { cores: {}, agentes: [{ id: 'novo', nome: 'Novo', dept: 'sales', funcao: '' }] };
  aplicarNaCena({ DEPTS, LAYOUT, AGENTS }, ajustes);
  const segunda = aplicarNaCena({ DEPTS, LAYOUT, AGENTS }, ajustes);
  assert.deepEqual(segunda.entraram, []);
  assert.equal(AGENTS.length, 1);
});

/* ---------- 4 · o que é guardado ---------- */
test('guardar: lixo no armazenamento não parte a cena (é ignorado)', () => {
  const store = (v) => ({ getItem: () => v, setItem: () => {} });
  assert.deepEqual(lerAjustes(store('{isto não é json')), { cores: {}, agentes: [] });
  assert.deepEqual(lerAjustes(store('null')), { cores: {}, agentes: [] });
  assert.deepEqual(lerAjustes(store(JSON.stringify({ cores: { sales: 'verde' }, agentes: [{ nome: '' }] }))), { cores: {}, agentes: [] });
  const bom = lerAjustes(store(JSON.stringify({ cores: { sales: '#EADC8F' }, agentes: [{ id: 'x', nome: 'Novo agente', dept: 'sales', funcao: 'faz coisas' }] })));
  assert.equal(bom.cores.sales, '#EADC8F');
  assert.equal(bom.agentes.length, 1);
  assert.equal(bom.agentes[0].id, 'x');
});

test('guardar: escrever e voltar a ler devolve o mesmo', () => {
  const memoria = new Map();
  const store = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v) };
  const escrito = gravarAjustes(store, { cores: { ops: '#BFA2E3' }, agentes: [{ id: 'z', nome: 'Zé', dept: 'ops', funcao: '' }] });
  assert.deepEqual(lerAjustes(store), escrito);
  assert.equal(idDeAgente('Zé', [{ id: 'ze' }]), 'ze-2');
});

/* ---------- 5 · o servidor ---------- */
test('servidor: limparAjustes recusa salas e cores malformadas e corta a lista', () => {
  const r = limparAjustes({
    cores: { sales: '#EADC8F', 'mau id!': '#fff', fin: 'azul' },
    agentes: [{ id: 'a', nome: 'A', dept: 'sales' }, { id: 'a', nome: 'repetido', dept: 'sales' }, { id: '', nome: '', dept: '' }],
  });
  assert.deepEqual(Object.keys(r.cores), ['sales']);
  assert.equal(r.agentes.length, 1);
});

test('servidor: cor inválida é recusada com uma razão, agente sem nome também', () => {
  const base = { cores: {}, agentes: [] };
  assert.match(comCor(base, 'sales', 'verde').erro, /hexadecimal/);
  assert.match(comCor(base, '../etc', '#fff').erro, /sala inválida/);
  assert.match(comAgente(base, { nome: 'A', dept: 'sales' }, 0).erro, /nome/);
  assert.match(comAgente(base, { nome: 'Novo', dept: 'sales' }, 12).erro, /limite de 12/);
  const ok = comAgente(base, { nome: 'Gestor de tráfego', dept: 'sales', funcao: 'anúncios' }, 3);
  assert.equal(ok.agente.id, 'gestor-de-trafego');
  assert.equal(semAgente(ok.ajustes, ok.agente.id).ajustes.agentes.length, 0);
  assert.match(semAgente(base, 'nao-existe').erro, /não encontrado/);
});

test('servidor: as rotas guardam a cor e o agente, e devolvem-nos no estado', async () => {
  const api = createMemRepo();
  const cor = await chamar(api, '/controlo/salas/sales/cor', 'POST', { cor: '#EADC8F' });
  assert.equal(cor.status, 200);
  assert.equal(cor.corpo.ajustes.cores.sales, '#EADC8F');

  const novo = await chamar(api, '/controlo/agentes', 'POST', { nome: 'Gestor de tráfego', dept: 'sales', funcao: 'anúncios', existentesNaSala: 6 });
  assert.equal(novo.status, 201);
  assert.equal(novo.corpo.agente.id, 'gestor-de-trafego');

  const estado = await chamar(api, '/controlo/estado');
  assert.equal(estado.status, 200);
  assert.equal(estado.corpo.ajustes.cores.sales, '#EADC8F');
  assert.equal(estado.corpo.ajustes.agentes.length, 1);
  /* sem motor de IA configurado, o estado NÃO finge: diz que não sabe */
  /* o motor existe (há fornecedores keyless), mas nada está provado sem teste */
  assert.equal(estado.corpo.ia.conhecido, true);
  assert.equal(estado.corpo.ia.funcionais.length, 0);
  assert.ok(estado.corpo.ia.fornecedores.every((f) => 'configurado' in f && 'ligado' in f && 'a_funcionar' in f));
  assert.equal(estado.corpo.execucao.a_funcionar, false);
  assert.equal(estado.corpo.seguranca.autenticacao, false);

  const apagado = await chamar(api, '/controlo/agentes/gestor-de-trafego', 'DELETE');
  assert.equal(apagado.status, 200);
  assert.equal(apagado.corpo.ajustes.agentes.length, 0);
});

test('servidor: /platform/apis diz o que existe no ambiente e o que falta — e não escreve chaves', async () => {
  const api = createMemRepo();
  const r = await chamar(api, '/platform/apis');
  assert.equal(r.status, 200);
  assert.ok(r.corpo.list.length > 10);
  const um = r.corpo.list.find((x) => x.id === 'github');
  assert.equal(um.configured, false);
  assert.ok(um.missing.includes('GITHUB_TOKEN'));
  /* a rota que escrevia chaves é recusada com a razão em produção */
  await assert.rejects(() => chamar(api, '/platform/key', 'POST', { servico: 'github', variavel: 'GITHUB_TOKEN', valor: 'x' }), /Environment Variables/);
});

/* ---------- 6 · os três estados ---------- */
test('estados: «a funcionar» só é verdade com execuções registadas nas últimas 24 h', async () => {
  const api = createMemRepo();
  const antes = await retrato({ repo: api, motor: null });
  assert.equal(antes.execucao.a_funcionar, false);

  await api.ia.runs.criar({ objetivo: 'x', estado: 'concluido' });
  const depois = await retrato({ repo: api, motor: null });
  assert.equal(depois.execucao.a_funcionar, true);
  assert.equal(depois.execucao.runs24h, 1);
  assert.equal(depois.execucao.concluidos24h, 1);

  /* uma execução velha não conta */
  const velho = await retrato({ repo: api, motor: null, agora: Date.now() + 3 * 24 * 60 * 60 * 1000 });
  assert.equal(velho.execucao.a_funcionar, false);
});

test('estados: com motor, cada fornecedor diz configurado · ligado · a funcionar', async () => {
  const api = createMemRepo();
  const motor = {
    estado: async () => ({
      diagnostico: { pronto: true },
      fornecedores: [
        { id: 'ovh', nome: 'OVH', familia: 'freellmapi', configurado: true, semChave: true, variavel: null, ultimoTeste: { ok: true, quando: new Date().toISOString(), ms: 800 } },
        { id: 'groq', nome: 'Groq', familia: 'nucleo', configurado: false, semChave: false, variavel: null, ultimoTeste: null },
        { id: 'vercel', nome: 'Vercel', familia: 'nucleo', configurado: true, semChave: false, variavel: 'AI_GATEWAY_API_KEY', ultimoTeste: { ok: false, quando: new Date().toISOString(), erro: 'sem cartão' } },
      ],
    }),
  };
  const r = await retrato({ repo: api, motor });
  const ovh = r.ia.fornecedores.find((f) => f.id === 'ovh');
  assert.equal(ovh.configurado, true);
  assert.equal(ovh.ligado, true);
  const groq = r.ia.fornecedores.find((f) => f.id === 'groq');
  assert.equal(groq.configurado, false);
  assert.equal(groq.ligado, null, 'sem teste não se diz nem ligado nem desligado');
  const vercel = r.ia.fornecedores.find((f) => f.id === 'vercel');
  assert.equal(vercel.ligado, false);
  assert.equal(r.ia.funcionais.join(','), 'ovh');
  assert.equal(r.ia.porTestar, 0);
});
