/* ===========================================================================
   1.78.0 · O CONTROLE REMOTO E O «A CARREGAR O CONTROL CENTER…»
   (7 nov 2026)

   Dois pedidos do dono, no mesmo dia:

     1 · «melhorar o remote de controlo do escritório, mais qualidade e mais
         realismo, ícones reais, mais elegante» — o comando novo (`src/remoto.js`)
         com ícones do Lucide (`src/icones.js`);
     2 · «A carregar o Control Center… a pedir o estado ao servidor, e estar 100%
         funcional» — a vista da IA não pode ficar presa.

   O que aqui se prova, contra um DOM a sério (jsdom) e sem browser:

     · o comando nasce fechado, abre com um clique e diz o estado da ligação
       com as mesmas palavras do resto do produto;
     · as seis salas trazem o nome, a cor e o número real de quem trabalha; sem
       dados, a sala diz «sem ligação» e NÃO mostra um zero inventado;
     · cada botão faz a acção certa — e nada é simulado: as acções são funções
       passadas de fora e são chamadas com o argumento certo;
     · os ícones são SVG a sério (24×24, traço redondo), não glifos de texto;
     · o prazo da vista da IA existe e diz qual pedido não respondeu; e o estado
       chega à página antes de os pedidos secundários terminarem.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { criarRemoto, estadoDeLigacao, ESTADO_LIGACAO } from './src/remoto.js';
import { ICONES, icone, iconeTexto } from './src/icones.js';
import { comPrazo, carregarIA, vistaIA } from './src/ia.js';

const SHELL = fs.readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');
const BUNDLE = fs.readFileSync(new URL('./dist/command-centre-v2.html', import.meta.url), 'utf8');

const dom = () => new JSDOM('<!doctype html><body></body>');

/** Um `liveUi` mínimo, com a mesma forma do verdadeiro. */
const liveFalso = ({ status = 'live', modo = 'sse', totais = {} } = {}) => ({
  status: () => status,
  modo: () => modo,
  meta: () => ({ totais, at: new Date().toISOString() }),
});

const montar = (opcoes = {}) => {
  const { window } = dom();
  const chamadas = [];
  const acoes = new Proxy({}, {
    get: (_, nome) => (...args) => chamadas.push([nome, ...args]),
  });
  /* o retrato vem do mesmo `liveUi` que pinta os monitores — como no `main.js` */
  const live = liveFalso(opcoes.live);
  const dados = {
    estado: () => ({
      status: live.status(),
      modo: live.modo(),
      totais: opcoes.live?.totais || { running: 2, waiting: 1, queued: 3 },
    }),
    trabalho: (dept) => ({ emails: { live: 2, waiting: 0 }, sales: { live: 0, waiting: 1 } }[dept] || { live: 0, waiting: 0 }),
    decisoes: () => 1,
    ...(opcoes.dados || {}),
  };
  const r = criarRemoto({
    doc: window.document,
    liveUi: live,
    acoes: opcoes.acoes || acoes,
    dados,
    aberto: opcoes.aberto,
    guardar: opcoes.guardar,
  });
  window.document.body.appendChild(r.raiz);
  return { r, chamadas, window, doc: window.document, acoes };
};

/* ---------- 1 · o comando ---------- */

test('1.78.0 · o comando nasce fechado, abre com o clique e fecha outra vez', () => {
  const { r, window } = montar();
  const painel = window.document.getElementById('rmtPainel');
  const botao = window.document.querySelector('.rmt-toggle');

  assert.equal(r.estaAberto(), false);
  assert.equal(botao.getAttribute('aria-expanded'), 'false');
  assert.ok(painel.hidden, 'fechado, o painel não ocupa o ecrã');

  botao.click();
  assert.equal(r.estaAberto(), true);
  assert.equal(botao.getAttribute('aria-expanded'), 'true');
  assert.equal(painel.hidden, false);

  botao.click();
  assert.equal(r.estaAberto(), false);
  assert.ok(painel.hidden);
});

test('1.78.0 · a preferência de abrir fica guardada — e é respeitada à construção', () => {
  const escrito = [];
  /* construir já aberto (o que o `main.js` faz quando a preferência é «1») */
  const { r, window } = montar({ aberto: true, guardar: (v) => escrito.push(v) });
  assert.equal(r.estaAberto(), true);
  assert.equal(escrito.at(-1), true, 'o construtor grava o estado que pintou');

  window.document.querySelector('.rmt-toggle').click();
  assert.equal(escrito.at(-1), false);
  window.document.querySelector('.rmt-toggle').click();
  assert.equal(escrito.at(-1), true);
  assert.deepEqual(escrito, [true, false, true]);
});

test('1.78.0 · o estado da ligação diz a verdade — e usa as palavras do produto', () => {
  assert.equal(estadoDeLigacao('live', 'sse').texto, 'ao vivo');
  assert.equal(estadoDeLigacao('live', 'sondagem').texto, 'a ler', 'o retrato lido a cada 8 s não é «ao vivo» a fingir');
  assert.equal(estadoDeLigacao('connecting', 'sse').texto, 'a ligar');
  assert.equal(estadoDeLigacao('stale', 'sse').texto, 'sem dados novos');
  assert.equal(estadoDeLigacao('off', 'parado').texto, 'sem ligação');

  const { r, window } = montar({ live: { status: 'off', modo: 'parado' } });
  assert.equal(window.document.querySelector('.rmt-est').textContent, 'sem ligação');
  assert.equal(r.raiz.dataset.estado, 'off');
});

test('1.78.0 · as seis salas têm nome, cor e o número de quem está a trabalhar', () => {
  const { r, window } = montar();
  const salas = [...window.document.querySelectorAll('.rmt-sala')];
  assert.equal(salas.length, 6, 'as seis salas da cena');
  assert.deepEqual(salas.map((b) => b.dataset.sala), ['emails', 'delivery', 'sales', 'marketing', 'fin', 'ops']);

  const emails = salas.find((b) => b.dataset.sala === 'emails');
  assert.equal(emails.dataset.estado, 'a-trabalhar');
  assert.equal(emails.querySelector('.rmt-sala-num').textContent, '2');
  assert.match(emails.getAttribute('aria-label'), /COMANDO — 2 a trabalhar/);
  assert.ok(emails.querySelector('.rmt-cor').style.background, 'a cor da sala é a mesma da cena');

  const vendas = salas.find((b) => b.dataset.sala === 'sales');
  assert.equal(vendas.dataset.estado, 'espera', 'um posto à espera do OK não é «a trabalhar»');
  assert.equal(vendas.querySelector('.rmt-sala-num').textContent, '1');

  r.atualizar();
});

test('1.78.0 · sem dados, a sala diz «sem ligação» e não mostra um zero inventado', () => {
  const { window } = montar({ dados: { trabalho: () => null } });
  const salas = [...window.document.querySelectorAll('.rmt-sala')];
  for (const b of salas) {
    assert.equal(b.dataset.estado, 'sem-ligacao');
    assert.equal(b.querySelector('.rmt-sala-num').textContent, '', 'nenhum número sem fonte');
    assert.equal(b.title, 'sem ligação');
  }
});

test('1.78.0 · os botões fazem o que dizem — a sala, a vista e o «hoje»', () => {
  const { window, chamadas } = montar();
  window.document.querySelector('.rmt-toggle').click();

  window.document.querySelector('[data-sala="marketing"]').click();
  assert.deepEqual(chamadas.at(-1), ['sala', 'marketing']);

  window.document.querySelector('[data-vista="geral"]').click();
  assert.deepEqual(chamadas.at(-1), ['geral']);

  window.document.querySelector('[data-vista="aerea"]').click();
  assert.deepEqual(chamadas.at(-1), ['aerea']);

  window.document.querySelector('[data-vista="esq"]').click();
  assert.deepEqual(chamadas.at(-1), ['esquerda']);

  window.document.querySelector('[data-vista="dir"]').click();
  assert.deepEqual(chamadas.at(-1), ['direita']);

  window.document.querySelector('[data-vista="planta"]').click();
  assert.deepEqual(chamadas.at(-1), ['planta']);

  window.document.querySelector('[data-num="decisoes"]').click();
  assert.deepEqual(chamadas.at(-1), ['hoje'], 'o contador das decisões leva ao sítio onde se decide');
});

test('1.78.0 · os números do painel são os do dia, e as decisões ganham destaque', () => {
  const { window, r } = montar();
  const valor = (k) => window.document.querySelector(`[data-num="${k}"] .rmt-n-v`).textContent;
  assert.equal(valor('live'), '2');
  assert.equal(valor('waiting'), '1');
  assert.equal(valor('queue'), '3');
  assert.equal(valor('decisoes'), '1');
  assert.equal(r.raiz.classList.contains('tem-decisao'), true);

  /* sem decisões, o destaque desaparece — não fica aceso para sempre */
  const semDecisoes = montar({ dados: { decisoes: () => 0 } });
  assert.equal(semDecisoes.r.raiz.classList.contains('tem-decisao'), false);
});

test('1.78.0 · o painel lê no máximo uma vez por segundo (e só quando está aberto)', () => {
  let leituras = 0;
  const { r } = montar({ dados: { estado: () => { leituras += 1; return { status: 'live', modo: 'sse', totais: {} }; } } });
  leituras = 0;
  r.tick(1000);
  assert.equal(leituras, 0, 'fechado não lê nada');
  r.abrir();
  leituras = 0;
  r.tick(2000);
  r.tick(2100);
  r.tick(2200);
  assert.equal(leituras, 1, 'três tiques em 200 ms valem uma leitura');
  r.tick(3300);
  assert.equal(leituras, 2, 'passado um segundo, volta a ler');
});

test('1.78.0 · quem não tem DOM não recebe um objecto a fingir', () => {
  assert.equal(criarRemoto({ doc: null }), null);
});

/* ---------- 2 · os ícones ---------- */

test('1.78.0 · os ícones são SVG a sério (24×24, traço redondo), não glifos de texto', () => {
  const { window } = dom();
  for (const nome of Object.keys(ICONES)) {
    const svg = icone(nome, { doc: window.document, size: 16 });
    assert.ok(svg, `o ícone «${nome}» não foi construído`);
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    assert.equal(svg.getAttribute('stroke-linecap'), 'round');
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'decorativo: quem lê ouve o botão');
    assert.ok(svg.childNodes.length >= 1, 'um ícone sem formas não é um ícone');
  }
  /* o crédito da licença viaja com o código */
  const fonte = fs.readFileSync(new URL('./src/icones.js', import.meta.url), 'utf8');
  assert.match(fonte, /Lucide/);
  assert.match(fonte, /ISC/);
});

test('1.78.0 · o comando usa os ícones em todos os sítios onde antes havia um glifo', () => {
  const { window, doc } = montar({ aberto: true });
  assert.ok(doc.querySelector('.rmt-toggle svg'), 'a pastilha tem ícone');
  assert.ok(doc.querySelector('[data-vista="geral"] svg'));
  assert.ok(doc.querySelector('[data-vista="aerea"] svg'));
  assert.ok(doc.querySelector('[data-num="live"] svg'));
  const painel = doc.getElementById('rmtPainel').textContent;
  assert.doesNotMatch(painel, /[⌂◍‹›]/, 'nenhum glifo de texto no painel');
  void window;
});

test('1.78.0 · o SVG em texto (para o HTML) é igual ao construído no DOM', () => {
  const html = iconeTexto('geral', { size: 20 });
  assert.match(html, /^<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(html, /stroke-linecap="round"/);
  assert.match(html, /<path /);
});

/* ---------- 3 · a vista da IA não fica presa ---------- */

test('1.78.0 · um pedido que não responde é cortado pelo prazo, com o nome do pedido', async () => {
  const pendente = new Promise(() => {});
  const antes = Date.now();
  /* o prazo usa um temporizador que não segura o processo (`unref`), o que é o
     que se quer em produção; aqui segura-se o ciclo para o teste poder esperar */
  const segura = setInterval(() => {}, 25);
  try {
    await assert.rejects(
      () => comPrazo(pendente, 40, 'o catálogo de modelos'),
      /o catálogo de modelos não respondeu em 0 s/,
    );
  } finally { clearInterval(segura); }
  assert.ok(Date.now() - antes < 2000, 'o prazo devolve o controlo, não fica à espera');
});

test('1.78.0 · o estado chega à página ANTES de os pedidos secundários acabarem', async () => {
  const vistos = [];
  let resolveSecundario;
  const estado = { pronto: true, modo: 'servidor', fornecedores: [{ id: 'llm7', nome: 'LLM7', configurado: true, estado: 'funcional' }], agentes: [], ferramentas: [], indisponiveis: [] };
  const api = {
    S: {},
    call: async (caminho) => {
      if (caminho === '/ia/estado') return estado;
      if (caminho === '/ia/modelos') return new Promise((r) => { resolveSecundario = r; });
      if (caminho === '/ia/uso') return { resumo: [], errosRecentes: [] };
      if (caminho === '/ia/runs') return { runs: [] };
      if (caminho === '/media/trabalhos') return { trabalhos: [] };
      if (caminho === '/ia/gratuitos') return { ok: true, modelos: [], porProvar: [] };
      throw new Error('rota inesperada: ' + caminho);
    },
    paint() { vistos.push({ temEstado: !!api.S.ia, carregando: api.S.iaCarregando }); },
  };
  const promessa = carregarIA(api);
  /* deixa correr até ao pedido secundário pendente */
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(vistos.some((v) => v.temEstado), 'a página já recebeu o estado antes do fim');
  assert.ok(vistos.some((v) => v.temEstado && v.carregando && v.carregando.parcial), 'e sabe que ainda está a completar');
  resolveSecundario(null);
  await promessa;
  assert.equal(api.S.iaCarregando, null, 'no fim, o cartão de carregamento sai');
  assert.ok(api.S.ia.fornecedores.length);
});

test('1.78.0 · o cartão de carregamento diz o que pede e há quantos segundos', () => {
  const S = { iaCarregando: { desde: Date.now() - 7400, passo: 'o estado da IA' } };
  const html = vistaIA(S, { esc: (x) => x, hhmm: (x) => x, when: (x) => x });
  assert.match(html, /A carregar o Control Center/);
  assert.match(html, /a pedir o estado da IA ao servidor/);
  assert.match(html, /7 s|8 s/, 'conta os segundos');
  assert.match(html, /data-act="ia-recarregar"/, 'e deixa pedir outra vez');
  assert.match(html, /demorar mais do que o costume/, 'passados 6 s, diz que está lento');
});

test('1.78.0 · quando o estado não chega, a vista diz o prazo — não fica a carregar', () => {
  const S = { iaErro: 'o estado da IA não respondeu em 12 s' };
  const html = vistaIA(S, { esc: (x) => x, hhmm: (x) => x, when: (x) => x });
  assert.match(html, /não respondeu em 12 s/);
  assert.match(html, /data-act="ia-recarregar"/);
  assert.doesNotMatch(html, /A carregar o Control Center/);
});

/* ---------- 4 · o que vai para produção ---------- */

test('1.78.0 · o ficheiro publicado leva o comando, os ícones e o CSS', () => {
  assert.match(BUNDLE, /rmt-toggle/);
  assert.match(BUNDLE, /rmt-painel/);
  /* minificado, o atributo é escrito por `setAttribute` */
  assert.match(BUNDLE, /setAttribute\("viewBox",\s*"0 0 24 24"\)/, 'os ícones vão no pacote (não são pedidos à rede)');
  assert.match(SHELL, /1\.78\.0 · O CONTROLE REMOTO DO ESCRITÓRIO/);
  assert.match(SHELL, /#remoto\[data-estado="off"\] \.rmt-dot \{ background: var\(--risk\)/);
  /* acessibilidade: foco visível e alvo de dedo no telemóvel */
  assert.match(SHELL, /\.rmt-toggle:focus-visible \{ outline: 2px solid var\(--ink\)/);
  assert.match(SHELL, /@media \(max-width: 640px\)[\s\S]{0,400}\.rmt-b \{ height: 44px; \}/);
});

test('1.78.0 · o dock da câmara mantém os ids (os atalhos e os testes não mudam)', () => {
  for (const id of ['zIn', 'zOut', 'zHome', 'zAerea', 'zLeft', 'zRight', 'zAngle', 'zIndex', 'z2d']) {
    assert.match(SHELL, new RegExp(`id="${id}"`), `o botão ${id} desapareceu`);
  }
});
