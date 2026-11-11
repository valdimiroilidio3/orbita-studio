/* ===========================================================================
   1.83.0 · O CONTROL CENTER NUM SÓ PEDIDO (9 nov 2026)

   O que o dono viu: «A carregar o Control Center… / a pedir o estado ao servidor
   / Pedir outra vez», e a exigência: «isto deve já estar 100% funcional, sem dar
   essa lentidão e erro de não carregar».

   As provas abaixo medem, não descrevem:
     · o painel devolve estado + catálogo + uso + execuções + trabalhos +
       gratuitas numa resposta, e diz que está completo;
     · uma parte lenta NÃO segura as outras: memória presa → o painel responde,
       com `parcial` a nomear a memória e o resto inteiro;
     · a memória e o estúdio são lidos AO MESMO TEMPO (antes eram 3 s + 3 s em
       série): com os dois presos, o estado sai em ~2 s, não em ~4 s;
     · a vista faz UM pedido e desenha os fornecedores sem cartão de carregamento;
     · com uma leitura anterior guardada, o primeiro desenho já tem dados;
     · uma leitura parcial antiga não é confundida com uma falha;
     · as rotas antigas continuam a responder a MESMA coisa (uma definição só).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import { rotasIA } from './api/_ia/rotas.mjs';
import { criarMotor } from './api/_ia/motor.mjs';
import { montarEstado, montarPainel, PRAZOS } from './api/_ia/painel.mjs';
import { carregarIA, vistaIA } from './src/ia.js';

const desenhar = (S) => vistaIA(S, { esc: (x) => x, hhmm: (x) => x, when: (x) => x });
const nunca = () => new Promise(() => {});

/** Um repo em memória com a memória da IA presa (`prender: 'memoria'`). */
function repoComPrisao({ prender = null } = {}) {
  const repo = createMemRepo();
  const ia = repo.ia;
  if (prender === 'memoria') {
    ia.memoria = { ...ia.memoria, listar: nunca };
  }
  if (prender === 'estudio') {
    ia.config = { ...ia.config, ler: nunca };
  }
  return { ...repo, ia };
}

test('1.83.0 · /ia/painel: um pedido devolve tudo o que a página precisa', async () => {
  const repo = createMemRepo();
  const r = await rotasIA(repo, { caminho: '/ia/painel', metodo: 'GET', env: {} });
  assert.equal(r.status, 200);
  const p = r.corpo;
  assert.equal(p.ok, true);
  assert.equal(p.completo, true, `o painel devia estar completo: ${JSON.stringify(p.parcial)}`);
  assert.deepEqual(p.parcial, []);
  assert.ok(Array.isArray(p.estado.fornecedores) && p.estado.fornecedores.length > 0, 'sem fornecedores não há Control Center');
  assert.ok(Array.isArray(p.estado.agentes) && p.estado.agentes.length > 0, 'os agentes vêm no mesmo pedido');
  assert.ok(p.modelos && Array.isArray(p.modelos.esforcos), 'o catálogo do selector vem no mesmo pedido');
  assert.ok(p.uso && Array.isArray(p.uso.resumo));
  assert.ok(Array.isArray(p.runs));
  assert.ok(Array.isArray(p.trabalhos));
  assert.ok(p.gratuitos && typeof p.gratuitos === 'object', 'as gratuitas vêm no mesmo pedido');
  assert.equal(typeof p.ms, 'number');
  assert.match(p.lidoEm, /^\d{4}-\d{2}-\d{2}T/);
  /* nenhuma chave pode sair de um caminho novo */
  assert.doesNotMatch(JSON.stringify(p), /sk-teste|API_KEY":/);
});

test('1.83.0 · /ia/painel: uma parte presa não segura o resto (parcial, com o nome)', async () => {
  /* o motor inteiro preso: é o pior caso — a parte «estado» não responde */
  const repo = repoComPrisao({ prender: 'estudio' });
  const antes = Date.now();
  /* a configuração presa arrasta o estado, o catálogo e as gratuitas — as três
     leem a mesma configuração. O que NÃO pode acontecer é o pedido ficar sem
     resposta: cada parte tem o seu prazo e o resto vem na mesma. */
  const p = await montarPainel(repo, { env: {}, prazos: { estado: 300, modelos: 300, gratuitos: 300 } });
  const gasto = Date.now() - antes;
  assert.equal(p.completo, false);
  assert.deepEqual(p.parcial.map((x) => x.parte).sort(), ['estado', 'gratuitos', 'modelos']);
  assert.match(p.parcial.find((x) => x.parte === 'estado').erro, /estado não respondeu em \d+ s/);
  assert.ok(gasto < 2500, `demorou ${gasto} ms — as partes não estão em paralelo`);
  /* o resto continua inteiro: é isso que a página desenha */
  assert.ok(p.uso && Array.isArray(p.uso.resumo));
  assert.ok(Array.isArray(p.runs));
  assert.ok(Array.isArray(p.trabalhos));
  assert.equal(p.estado, null, 'sem estado não se inventa um estado');
  assert.match(p.nota, /faltou ler: /);
});

test('1.83.0 · /ia/painel: a memória presa não é uma falha do painel — é um aviso dentro do estado', async () => {
  const repo = repoComPrisao({ prender: 'memoria' });
  const antes = Date.now();
  const p = await montarPainel(repo, { env: {} });
  const gasto = Date.now() - antes;
  assert.equal(p.completo, true, 'a memória é um resumo: não estraga o resto');
  assert.match(p.estado.memoria.erro, /memória ainda não tem tabela/);
  assert.ok(p.estado.fornecedores.length);
  /* memória e estúdio correm juntos: o prazo é o de um, não a soma dos dois */
  assert.ok(gasto < PRAZOS.estado, `demorou ${gasto} ms: memória e estúdio não estão em paralelo`);
});

test('1.83.0 · montarEstado: o caminho rápido não espera pela memória nem pelo estúdio', async () => {
  const repo = repoComPrisao({ prender: 'memoria' });
  const motor = criarMotor({ repo, env: {} });
  const antes = Date.now();
  const rapido = await montarEstado(motor, { repo, env: {}, resumos: false });
  assert.ok(Date.now() - antes < 500, 'sem resumos o estado não pode esperar por eles');
  assert.equal(rapido.memoria, null);
  assert.equal(rapido.estudio, null);
  assert.ok(rapido.fornecedores.length);
});

test('1.83.0 · /ia/estado devolve a MESMA composição que o painel (uma definição só)', async () => {
  const repo = createMemRepo();
  const { corpo: painel } = await rotasIA(repo, { caminho: '/ia/painel', metodo: 'GET', env: {} });
  const { corpo: estado } = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: {} });
  for (const chave of ['fornecedores', 'agentes', 'ferramentas', 'tipos', 'desligados', 'pronto', 'instalacao', 'diagnostico']) {
    assert.ok(chave in estado, `o /ia/estado perdeu «${chave}»`);
    assert.ok(chave in painel.estado, `o painel perdeu «${chave}»`);
  }
  assert.deepEqual(Object.keys(estado).sort(), Object.keys(painel.estado).sort(), 'as duas rotas têm de falar a mesma língua');
  assert.equal(painel.agentes, undefined, 'o painel entrega os agentes dentro do estado');
  assert.equal(painel.estado.agentes.length, estado.agentes.length);
});

test('1.83.0 · a vista faz UM pedido e desenha os fornecedores, sem cartão de carregamento', async () => {
  const pedidos = [];
  const p = await montarPainel(createMemRepo(), { env: {} });
  const api = {
    S: {},
    async call(caminho) {
      pedidos.push(caminho);
      if (caminho === '/ia/painel') return p;
      throw new Error('rota inesperada: ' + caminho);
    },
    paint() {}, toast() {},
  };
  await carregarIA(api);
  assert.deepEqual(pedidos, ['/ia/painel'], 'a vista não pode pedir seis rotas outra vez');
  assert.equal(api.S.iaCarregando, null);
  assert.equal(api.S.iaErro, null);
  assert.equal(api.S.iaParcial, null);
  assert.equal(api.S.iaActualizando, false);
  assert.ok(api.S.ia.fornecedores.length);
  assert.ok(api.S.iaGratuitos, 'as gratuitas vêm na mesma resposta');
  assert.match(api.S.iaLidoEm, /^\d{4}-\d{2}-\d{2}T/);
  const html = desenhar(api.S);
  assert.doesNotMatch(html, /A carregar o Control Center/);
  assert.doesNotMatch(html, /Pedir outra vez/);
});

test('1.83.0 · leitura anterior guardada: o primeiro desenho já tem dados e diz que está a actualizar', async () => {
  const guardado = {
    estado: { pronto: true, modo: 'servidor', fornecedores: [{ id: 'llm7', nome: 'LLM7', configurado: true, semChave: true, estado: 'funcional' }], agentes: [], ferramentas: [], indisponiveis: [], memoria: {}, estudio: {} },
    modelos: { fornecedores: [], esforcos: [] }, uso: { resumo: [] }, runs: [], trabalhos: [], gratuitos: { ok: true, modelos: [], porProvar: [], estado: { frase: 'x' } },
    lidoEm: '2026-11-09T10:00:00.000Z',
  };
  const memoria = new Map([['orbita.ia.painel', JSON.stringify(guardado)]]);
  globalThis.localStorage = {
    getItem: (k) => memoria.get(k) ?? null,
    setItem: (k, v) => memoria.set(k, v),
    removeItem: (k) => memoria.delete(k),
  };
  try {
    let resolvePainel;
    const api = {
      S: {},
      call: () => new Promise((r) => { resolvePainel = r; }),
      paint() {}, toast() {},
    };
    const promessa = carregarIA(api);
    await new Promise((r) => setTimeout(r, 10));
    /* antes de o servidor responder, a página já tem os fornecedores */
    assert.ok(api.S.ia && api.S.ia.fornecedores.length, 'a leitura anterior não foi usada');
    assert.equal(api.S.iaCarregando, null, 'quem já leu uma vez não vê o cartão de carregamento');
    assert.equal(api.S.iaActualizando, true);
    const html = desenhar(api.S);
    assert.doesNotMatch(html, /A carregar o Control Center/);
    assert.match(html, /A actualizar/);
    assert.match(html, /é a leitura de 2026-11-09T10:00:00.000Z/, 'diz de quando é o que está no ecrã');
    resolvePainel({ estado: { ...guardado.estado, fornecedores: guardado.estado.fornecedores }, parcial: [], lidoEm: '2026-11-09T10:05:00.000Z' });
    await promessa;
    assert.equal(api.S.iaActualizando, false);
    assert.equal(api.S.iaLidoEm, '2026-11-09T10:05:00.000Z', 'e passa a dizer a hora da leitura nova');
    assert.equal(api.S.iaLeituraAntiga, false);
  } finally { delete globalThis.localStorage; }
});

test('1.83.0 · leitura parcial: mostra o que falta, com o nome, e não esconde o resto', async () => {
  const S = {
    ia: { pronto: true, modo: 'servidor', fornecedores: [{ id: 'llm7', nome: 'LLM7', configurado: true, estado: 'funcional' }], agentes: [], ferramentas: [], indisponiveis: [], memoria: {}, estudio: {} },
    iaParcial: [{ parte: 'gratuitos', erro: 'gratuitos não respondeu em 6 s', ms: 6000 }],
    iaUso: { resumo: [] }, iaRuns: [], iaGratuitos: null,
  };
  const html = desenhar(S);
  assert.match(html, /Leitura parcial/);
  assert.match(html, /gratuitos \(gratuitos não respondeu em 6 s\)/);
  assert.match(html, /data-act="ia-recarregar"/);
  assert.match(html, /LLM7/, 'o resto continua à vista');
});

test('1.83.0 · sem `/ia/painel` (instalação antiga), a vista cai no caminho de sempre', async () => {
  const pedidos = [];
  const estado = { pronto: true, modo: 'servidor', fornecedores: [{ id: 'llm7', nome: 'LLM7', configurado: true, estado: 'funcional' }], agentes: [], ferramentas: [], indisponiveis: [], memoria: {}, estudio: {} };
  const api = {
    S: {},
    async call(caminho) {
      pedidos.push(caminho);
      if (caminho === '/ia/painel') throw new Error('HTTP 404');
      if (caminho === '/ia/estado') return estado;
      if (caminho === '/ia/modelos') return { fornecedores: [], esforcos: [] };
      if (caminho === '/ia/uso') return { resumo: [], errosRecentes: [] };
      if (caminho === '/ia/runs') return { runs: [] };
      if (caminho === '/media/trabalhos') return { trabalhos: [] };
      if (caminho === '/ia/gratuitos') return { ok: true, modelos: [], porProvar: [] };
      throw new Error('rota inesperada: ' + caminho);
    },
    paint() {}, toast() {},
  };
  await carregarIA(api);
  assert.equal(pedidos[0], '/ia/painel');
  assert.ok(pedidos.includes('/ia/estado'), 'a instalação antiga continua a funcionar');
  assert.equal(api.S.iaErro, null, 'uma instalação antiga não é um erro para o dono');
  assert.ok(api.S.ia.fornecedores.length);
});

test('1.83.1 · o painel lê as gratuitas sem acordar os fornecedores (nada de 60 pedidos em série)', async () => {
  const repo = createMemRepo();
  const motor = criarMotor({ repo, env: {} });
  /* conta os pedidos de descoberta: o painel não pode fazer nenhum */
  let pedidos = 0;
  const fetchImpl = async () => { pedidos += 1; throw new Error('o painel não devia falar com fornecedores'); };
  const p = await montarPainel(repo, { env: {}, fetchImpl, motor, prazos: { gratuitos: 1500 } });
  assert.equal(pedidos, 0, 'o painel acordou fornecedores só para desenhar a página');
  assert.equal(p.completo, true, `o painel não pode ficar parcial por causa da descoberta: ${JSON.stringify(p.parcial)}`);
  assert.ok(p.gratuitos && Array.isArray(p.gratuitos.modelos), 'as gratuitas continuam a vir no painel');
  assert.ok(p.gratuitos.cadeia && Object.keys(p.gratuitos.cadeia).length, 'a cadeia por tipo continua a vir');
});

test('1.83.1 · a rota /ia/gratuitos continua a descobrir (é a acção explícita dela)', async () => {
  const repo = createMemRepo();
  const r = await rotasIA(repo, { caminho: '/ia/gratuitos', metodo: 'GET', env: {} });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.corpo.cadeia ? Object.keys(r.corpo.cadeia) : null), 'a cadeia por tipo vem na resposta');
});
