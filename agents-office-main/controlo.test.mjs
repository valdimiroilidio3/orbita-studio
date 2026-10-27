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
  const vazio = { cores: {}, agentes: [], tamanhos: {} };
  assert.deepEqual(lerAjustes(store('{isto não é json')), vazio);
  assert.deepEqual(lerAjustes(store('null')), vazio);
  assert.deepEqual(lerAjustes(store(JSON.stringify({ cores: { sales: 'verde' }, agentes: [{ nome: '' }] }))), vazio);
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

/* ---------- 7 · a interface ---------- */
test('interface: o painel desenha as seis salas, a cor e os três estados', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body><div id="cfgPanel" hidden><b id="cfgTitle"></b><span class="cfg-sum"></span><div class="cfg-body"></div></div></body>', { url: 'https://mesa.teste/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;

  const estado = {
    status: 200,
    corpo: {
      versao: '1.20.0',
      ajustes: { cores: { sales: '#EADC8F' }, agentes: [{ id: 'gestor', nome: 'Gestor de tráfego', dept: 'sales', funcao: 'anúncios' }], tamanhos: {} },
      registo: [{ quando: new Date('2026-10-27T09:30:00Z').toISOString(), quem: 'dono', o_que: 'sala sales: fundo 44 m' }],
      ia: { pronto: true, conhecido: true, comChave: 2, funcionais: ['llm7'], porTestar: 1, fornecedores: [] },
      execucao: { runs24h: 2, chamadas24h: 9, a_funcionar: true, ultimaChamada: new Date().toISOString() },
      seguranca: { autenticacao: false, chavesNoServidor: true, aprovacaoHumana: true, nota: 'A base responde sem login.' },
    },
  };
  const apis = { status: 200, corpo: { list: [{ id: 'github', name: 'GitHub', kind: 'codigo', env: [], missing: ['GITHUB_TOKEN'], configured: false, verified: false }], summary: { total: 1, configuradas: 0, verificadas: 0 } } };

  const backup = { status: 200, corpo: { ok: true, total: 42, ms: 7, marca: 'abcdef0123456789', problemas: [] } };
  globalThis.fetch = async (url, opt = {}) => {
    /* o caminho vai codificado em ?caminho= (GET) ou no corpo do POST */
    const u = decodeURIComponent(String(url) + (typeof opt.body === 'string' ? opt.body : ''));
    const corpo = u.includes('/controlo/estado') ? estado
      : u.includes('/platform/apis') ? apis
      : u.includes('/backup/teste') ? backup
      : { status: 404, corpo: {} };
    return { ok: true, status: 200, json: async () => corpo };
  };

  const { createConfig } = await import('./src/config.js');
  const cfg = createConfig({ panel: document.getElementById('cfgPanel'), theme: 'auto' });
  cfg.open();
  await new Promise((r) => setTimeout(r, 30));

  const html = document.querySelector('.cfg-body').innerHTML;
  assert.match(html, /Centro de Controlo/);
  for (const sala of ['COMANDO', 'ENGENHARIA', 'PROSPEÇÃO', 'MEDIA', 'DESIGN LAB', 'VENDAS']) {
    assert.ok(html.includes(sala), `a sala ${sala} não aparece no painel`);
  }
  /* os três estados, por palavras, e a execução a sério */
  assert.match(html, /a funcionar/);
  assert.match(html, /por testar/);
  assert.match(html, /2 execuções em 24 h/);
  assert.match(html, /login <b>não configurado<\/b>/);
  /* o agente acrescentado tem botão para sair, e há um botão para acrescentar */
  assert.match(html, /data-menos="gestor"/);
  assert.match(html, /data-mais="sales"/);
  /* 1.21.0: tamanho à mão, com a lotação a mandar no mínimo */
  assert.match(html, /data-tamanho="sales"/);
  assert.match(html, /data-minimo="/);
  /* e o registo de quem mudou o quê, com hora e autor */
  assert.match(html, /Registo de alterações/);
  assert.match(html, /fundo 44 m/);
  assert.match(html, /<i>dono<\/i>/);
  /* 1.23.0: a cópia de segurança tem botão e teste, e o teste diz números */
  assert.match(html, /Backups/);
  assert.match(html, /data-act="testar-copia"/);
  const btn = document.querySelector('[data-act="testar-copia"]');
  btn.dispatchEvent(new dom.window.Event('click'));
  await new Promise((r) => setTimeout(r, 30));
  assert.match(document.querySelector('[data-backup-out]').textContent, /42 linhas/);
  cfg.close();
});

/* ---------- 8 · tamanho à mão e registo ---------- */
test('tamanho: cabe entre o que a lotação exige e o limite, e nunca abaixo do mínimo', async () => {
  const { tamanhoValido, CRESCER_MAX } = await import('./src/salas.js');
  assert.equal(tamanhoValido(40, { minimo: 31.7, base: 31.7 }), 40);
  assert.equal(tamanhoValido(10, { minimo: 31.7, base: 31.7 }), 31.7, 'abaixo do mínimo tem de subir ao mínimo');
  assert.equal(tamanhoValido(999, { minimo: 31.7, base: 31.7 }), 51.7, `o máximo é mínimo + ${CRESCER_MAX}`);
  assert.equal(tamanhoValido('nada', { minimo: 20, base: 20 }), null);
});

test('tamanho: a sala cresce à mão mas não encolhe abaixo do que os agentes pedem', () => {
  const DEPTS = { sales: { chip: '#111111', ink: '#222222', glass: '#333333' } };
  const LAYOUT = { sales: { pos: [0, 0], w: 20, d: 34 } };
  const AGENTS = [];
  const maior = aplicarNaCena({ DEPTS, LAYOUT, AGENTS }, { cores: {}, agentes: [], tamanhos: { sales: { d: 46 } } });
  assert.equal(maior.salas.sales.profundidade, 46);
  assert.equal(LAYOUT.sales.d, 46);

  const LAYOUT2 = { sales: { pos: [0, 0], w: 20, d: 34 } };
  const menor = aplicarNaCena({ DEPTS, LAYOUT: LAYOUT2, AGENTS: [] }, { cores: {}, agentes: [], tamanhos: { sales: { d: 12 } } });
  assert.equal(menor.salas.sales.profundidade, 34, 'pedir 12 m não pode encolher a sala abaixo da planta');
});

test('servidor: o tamanho é guardado com limites, e o registo diz quem mudou o quê', async () => {
  const api = createMemRepo();
  const r = await chamar(api, '/controlo/salas/sales/tamanho', 'POST', { d: 999, minimo: 31.7, base: 31.7 });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.tamanho.d, 51.7);

  await chamar(api, '/controlo/salas/sales/cor', 'POST', { cor: '#EADC8F' });
  await chamar(api, '/controlo/agentes', 'POST', { nome: 'Gestor de tráfego', dept: 'sales', existentesNaSala: 6 });

  const reg = await chamar(api, '/controlo/registo');

  assert.equal(reg.status, 200);
  assert.ok(reg.corpo.registo.length >= 3, 'as três alterações tinham de ficar registadas');
  assert.ok(reg.corpo.registo.every((x) => x.quem === 'dono' && x.quando && x.o_que));
  assert.ok(reg.corpo.registo.some((x) => x.o_que.includes('tamanho 51.7 m de fundo')), 'o registo diz o tamanho novo');
  assert.ok(reg.corpo.registo.some((x) => /entrou Gestor de tráfego/.test(x.o_que)));

  const estado = await chamar(api, '/controlo/estado');
  assert.equal(estado.corpo.ajustes.tamanhos.sales.d, 51.7);
  assert.ok(estado.corpo.registo.length >= 3, 'o estado também traz o registo');
});

/* ---------- 9 · repintar sem recarregar: que peças, com que tom ---------- */
test('cor ao vivo: só as peças seguras mudam, e cada uma recebe o tom certo', async () => {
  const { tomDaParte, PARTES_VIVAS } = await import('./src/salas.js');
  const { glassLayers } = await import('./src/palette.js');
  const camadas = glassLayers('#8FD3F4');
  const cor = '#E69393';

  assert.equal(tomDaParte('floorGlass', camadas, cor), camadas.glass);
  assert.equal(tomDaParte('floorBase', camadas, cor), camadas.base);
  assert.equal(tomDaParte('floorEdge', camadas, cor), camadas.edge);
  assert.equal(tomDaParte('floorPool', camadas, cor), camadas.pool);
  assert.equal(tomDaParte('deskLed', camadas, cor), cor);
  assert.equal(tomDaParte('entranceSpill', camadas, cor), cor);

  // a planta não se pinta a meio do voo — isso é construir outra sala
  for (const parte of ['plinth', 'desk', 'deskMatte', 'walkway', 'wall', 'plant', ''])
    assert.equal(tomDaParte(parte, camadas, cor), null, `${parte || '(vazio)'} não devia ser repintado`);

  assert.equal(tomDaParte('floorGlass', camadas, 'vermelho'), null, 'cor inválida não pinta nada');
  assert.ok(Object.keys(PARTES_VIVAS).length >= 8);
});

/* ---------- 10 · testar uma integração, a sério ---------- */
test('integrações: o botão de teste faz um pedido real e diz o que aconteceu', async () => {
  const api = createMemRepo();
  const pedidos = [];
  const fetchFalso = async (url, opt = {}) => {
    pedidos.push({ url: String(url), auth: opt.headers?.Authorization || opt.headers?.apikey });
    if (String(url).includes('api.github.com')) {
      if (!opt.headers?.Authorization) return { ok: false, status: 401, text: async () => 'Bad credentials', json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ login: 'valdimiroilidio3' }), text: async () => '' };
    }
    if (String(url).includes('api.vercel.com')) return { ok: false, status: 403, text: async () => 'Forbidden', json: async () => ({}) };
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  };

  /* com chave: o GitHub responde e diz quem é */
  const bom = await responder(api, {
    caminho: '/platform/testar', metodo: 'POST', corpo: { id: 'github' },
    env: { GITHUB_TOKEN: 'ghp_teste' }, fetchImpl: fetchFalso,
  });
  assert.equal(bom.status, 200);
  assert.equal(bom.corpo.ok, true);
  assert.equal(bom.corpo.detalhe, 'valdimiroilidio3');
  assert.equal(bom.corpo.status, 200);
  assert.equal(pedidos[0].url, 'https://api.github.com/user');
  assert.equal(pedidos[0].auth, 'Bearer ghp_teste');

  /* e o catálogo passa a dizer «verificada» para essa integração */
  const apis = await responder(api, { caminho: '/platform/apis', env: { GITHUB_TOKEN: 'ghp_teste' }, fetchImpl: fetchFalso });
  const gh = apis.corpo.list.find((x) => x.id === 'github');
  assert.equal(gh.verified, true, 'um teste bem-sucedido tinha de marcar a integração como verificada');
  assert.equal(gh.latencyMs != null, true);
  assert.ok(apis.corpo.summary.verificadas >= 1);

  /* sem chave: não se inventa um teste — diz-se o que falta */
  const sem = await responder(api, { caminho: '/platform/testar', metodo: 'POST', corpo: { id: 'vercel' }, env: {}, fetchImpl: fetchFalso });
  assert.equal(sem.corpo.ok, false);
  assert.match(sem.corpo.erro, /falta VERCEL_TOKEN/);
  assert.equal(sem.corpo.codigo, 'semchave');

  /* com chave mas o serviço a recusar: HTTP real, sem véu */
  const mau = await responder(api, { caminho: '/platform/testar', metodo: 'POST', corpo: { id: 'vercel' }, env: { VERCEL_TOKEN: 'x' }, fetchImpl: fetchFalso });
  assert.equal(mau.corpo.ok, false);
  assert.match(mau.corpo.erro, /HTTP 403/);

  /* integração que não existe → 404, não um falso «ok» */
  await assert.rejects(
    () => responder(api, { caminho: '/platform/testar', metodo: 'POST', corpo: { id: 'inexistente' }, env: {}, fetchImpl: fetchFalso }),
    (e) => e.status === 404,
  );

  /* a IA segue o mesmo caminho: sem chave, responde «falta …» */
  const groq = await responder(api, { caminho: '/platform/testar', metodo: 'POST', corpo: { id: 'groq' }, env: {}, fetchImpl: fetchFalso });
  assert.equal(groq.status, 200);
  assert.equal(groq.corpo.ok, false);
  assert.match(groq.corpo.erro, /GROQ_API_KEY/);

  /* e o registo guarda o teste (auditoria) */
  const reg = await chamar(api, '/controlo/registo');
  assert.ok(reg.corpo.registo.some((x) => /teste de github/.test(x.o_que)));
});

test('integrações: a lista de /platform/apis inclui a IA (antes vinha vazia) e diz o que falta', async () => {
  const api = createMemRepo();
  const r = await responder(api, { caminho: '/platform/apis', env: { GROQ_API_KEY: 'k' } });
  assert.equal(r.status, 200);
  const ia = r.corpo.list.filter((x) => x.kind === 'ia');
  assert.ok(ia.length >= 10, `esperava os fornecedores de IA na lista, vieram ${ia.length}`);
  const groq = r.corpo.list.find((x) => x.id === 'groq');
  assert.equal(groq.configured, true);
  assert.equal(groq.verified, false, 'configurada não é verificada');
  const google = r.corpo.list.find((x) => x.id === 'google');
  assert.equal(google.configured, false);
  assert.ok(google.missing.length > 0, 'sem chave, tem de dizer qual falta');
  /* um fornecedor sem chave por desenho (llm7) conta como configurado, mas não como ligado */
  const llm7 = r.corpo.list.find((x) => x.id === 'llm7');
  assert.equal(llm7.configured, true);
  assert.equal(llm7.verified, false);
});

/* ---------- 11 · cópia de segurança que se pode testar ---------- */
test('backup: exporta, a marca apanha alterações, e o restauro conta linha a linha', async () => {
  const { exportar, marca, testar } = await import('./api/_backup.mjs');
  const api = createMemRepo();
  await api.leads.inserir([
    { nome: 'Ana', cidade: 'Coimbra', dedupe_key: 'ana|coimbra', status: 'novo' },
    { nome: 'Rui', cidade: 'Porto', dedupe_key: 'rui|porto', status: 'novo' },
  ]);
  await api.projetos.insert({ name: 'Site da Ana', status: 'briefing' });
  await api.tarefas.insert({ titulo: 'Briefing', estado: 'aberta' });
  await api.mensagens.inserir({ canal: 'email', assunto: 'Olá', corpo: 'texto' });

  const copia = await exportar(api);
  assert.equal(copia.formato, 'orbita-backup/1');
  assert.equal(copia.contagens.leads, 2);
  assert.equal(copia.contagens.projetos, 1);
  assert.equal(copia.total >= 5, true);
  assert.match(copia.marca, /^[0-9a-f]{32}$/);

  /* a marca é estável se nada mudar… */
  assert.equal(marca(JSON.parse(JSON.stringify(copia))), copia.marca);
  /* …e muda se alguém mexer numa linha (é o ponto de uma marca) */
  const mexida = JSON.parse(JSON.stringify(copia));
  mexida.tabelas.leads[0].nome = 'Outra pessoa';
  assert.notEqual(marca(mexida), copia.marca);

  /* o teste sério: exporta, relê, confere e restaura */
  const r = await testar(api);
  assert.equal(r.ok, true, `o teste devia passar: ${JSON.stringify(r.problemas)}`);
  assert.equal(r.contagens.leads, 2);
  assert.equal(r.restaurado.leads, 2);
  assert.equal(r.restaurado.projetos, 1);
  assert.equal(r.restaurado.tarefas, 1);
  assert.equal(r.restaurado.mensagens, 1);
  assert.match(r.prova, /restaurada/);
  assert.deepEqual(r.problemas, []);
});

test('backup: o teste falha — e di-lo — quando a cópia está estragada', async () => {
  const { testar } = await import('./api/_backup.mjs');
  const api = createMemRepo();
  await api.leads.inserir([{ nome: 'Ana', cidade: 'Coimbra', dedupe_key: 'ana|coimbra' }]);

  /* um destino que perde linhas ao restaurar: o teste tem de dar por isso */
  const destinoMau = () => {
    const d = createMemRepo();
    d.leads.inserir = async () => [];
    return d;
  };
  const r = await testar(api, { criarDestino: destinoMau });
  assert.equal(r.ok, false);
  assert.ok(r.problemas.some((p) => /restaurou 0 de 1|devolve 0/.test(p)), JSON.stringify(r.problemas));
});

test('backup: as rotas devolvem a cópia e o resultado do teste (e o registo fica com a prova)', async () => {
  const api = createMemRepo();
  await api.leads.inserir([{ nome: 'Ana', cidade: 'Coimbra', dedupe_key: 'ana|coimbra' }]);
  const copia = await chamar(api, '/backup');
  assert.equal(copia.status, 200);
  assert.equal(copia.corpo.copia.contagens.leads, 1);

  const t = await chamar(api, '/backup/teste', 'POST', {});
  assert.equal(t.status, 200);
  assert.equal(t.corpo.ok, true);

  const reg = await chamar(api, '/controlo/registo');
  assert.ok(reg.corpo.registo.some((x) => /cópia de segurança testada/.test(x.o_que)));
});
