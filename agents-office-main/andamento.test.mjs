// 1.80.0 · O ANDAMENTO DOS AGENTES — as contas, provadas sem cena e sem browser.
//
// O que fica provado:
//   · só há andamento com trabalho real (live/waiting) — sem tarefa, nada;
//   · o anel é ACTIVIDADE (um ciclo) e o número ao centro é TEMPO decorrido —
//     nunca uma percentagem inventada;
//   · as frases saem de campos reais do retrato (título, início, tentativa);
//   · o balão quebra texto e desenha-se (com um contexto 2D duplo, sem canvas);
//   · quem pediu menos movimento não perde a informação: a fracção pode ficar fixa
//     sem o rótulo desaparecer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RITMO, decorrido, desde, andamentoDoPosto, linhasDoPosto, perguntaDoChefe, respostaDoPosto,
  proximaFala, quebrar, desenharBalao, desenharAnel,
} from './src/andamento.js';

const AGORA = Date.parse('2026-11-09T14:05:00.000Z');

const retrato = (extra = {}) => ({
  id: 'crep', state: 'live',
  task: { id: 't1', title: 'Gerar o site da clínica', kind: 'projeto.gerar', state: 'running', started_at: '2026-11-09T14:03:00.000Z', attempts: 1, maxAttempts: 3 },
  ...extra,
});

/** Um contexto 2D de mentira: guarda as chamadas para se poder afirmar o que se desenhou. */
function ctxDuplo() {
  const ops = [];
  return {
    ops,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '', textBaseline: '', lineCap: '',
    beginPath: () => ops.push(['beginPath']),
    closePath: () => ops.push(['closePath']),
    rect: (...a) => ops.push(['rect', ...a]),
    roundRect: (...a) => ops.push(['roundRect', ...a]),
    fill: () => ops.push(['fill']),
    stroke: () => ops.push(['stroke']),
    arc: (...a) => ops.push(['arc', ...a]),
    moveTo: (...a) => ops.push(['moveTo', ...a]),
    lineTo: (...a) => ops.push(['lineTo', ...a]),
    clearRect: (...a) => ops.push(['clearRect', ...a]),
    fillText: (t, x, y) => ops.push(['fillText', t, x, y]),
  };
}

test('1.80.0 · o tempo decorrido é o único número: mm:ss e depois horas', () => {
  assert.equal(decorrido(0), '00:00');
  assert.equal(decorrido(133000), '02:13');
  assert.equal(decorrido(3_725_000), '1h02');
  assert.equal(decorrido(-5), '00:00', 'um relógio torto não dá tempo negativo');
});

test('1.80.0 · «há quanto tempo» em português, sem números inventados', () => {
  assert.equal(desde('2026-11-09T14:03:00.000Z', AGORA), 'há 2 min');
  assert.equal(desde('2026-11-09T14:04:40.000Z', AGORA), 'agora');
  assert.equal(desde('2026-11-09T11:05:00.000Z', AGORA), 'há 3 h');
  assert.equal(desde(null, AGORA), '');
  assert.equal(desde('ontem', AGORA), '');
});

test('1.80.0 · sem trabalho não há animação — o posto fica parado', () => {
  assert.equal(andamentoDoPosto(null), null);
  assert.equal(andamentoDoPosto({ state: 'idle' }), null);
  assert.equal(andamentoDoPosto({ state: 'error' }), null);
  assert.equal(linhasDoPosto({ state: 'idle' }).length, 0);
});

test('1.80.0 · com trabalho: o anel é actividade, o centro é o tempo real, e a cor diz o estado', () => {
  const a = andamentoDoPosto(retrato(), { agora: AGORA });
  assert.ok(a);
  assert.equal(a.estado, 'live');
  assert.equal(a.rotulo, '02:00', 'o centro mostra o tempo desde o início real da tarefa');
  assert.equal(a.color, '#1E9070');
  assert.equal(a.titulo, 'Gerar o site da clínica');
  assert.equal(a.tentativa, '1/3');
  // a fracção anda com o relógio e não passa de 1
  const b = andamentoDoPosto(retrato(), { agora: AGORA + 5000 });
  assert.notEqual(a.fraccao, b.fraccao);
  assert.ok(a.fraccao >= 0 && a.fraccao < 1);
  // «à espera» muda a cor e o que se diz
  const w = andamentoDoPosto(retrato({ state: 'waiting' }), { agora: AGORA });
  assert.equal(w.color, '#B4830B');
  assert.equal(w.estado, 'waiting');
});

test('1.80.0 · as frases saem dos factos: título, estado, tentativa — e a conclusão tem hora', () => {
  const linhas = linhasDoPosto(retrato(), { agora: AGORA });
  assert.equal(linhas[0], '«Gerar o site da clínica»');
  assert.match(linhas[1], /a escrever · há 2 min · tentativa 1\/3/);

  const espera = linhasDoPosto(retrato({ state: 'waiting' }), { agora: AGORA });
  assert.deepEqual(espera, ['«Gerar o site da clínica»', 'à espera do teu OK']);

  const feito = linhasDoPosto({ state: 'idle', last: { state: 'succeeded', title: 'Gerar o site da clínica', finished_at: '2026-11-09T13:45:00.000Z' } }, { agora: AGORA });
  assert.match(feito[0], /pronta às 13:45/);

  const falhou = linhasDoPosto({ state: 'idle', last: { state: 'failed', title: 'x', error: 'disco cheio' } }, { agora: AGORA });
  assert.match(falhou[0], /falhou: disco cheio/);
});

test('1.80.0 · a pergunta entre eles diz o título real e não promete resultado', () => {
  const q = perguntaDoChefe(retrato(), 'LEAD HUNTER', { agora: AGORA });
  assert.equal(q, 'LEAD HUNTER: «Gerar o site da clínica»?');
  assert.equal(perguntaDoChefe(retrato({ state: 'waiting' }), 'X', { agora: AGORA }), '', 'à espera não se pergunta nada');
  assert.match(respostaDoPosto(retrato(), { agora: AGORA }), /^a correr · há 2 min$/);
  assert.match(respostaDoPosto(retrato({ state: 'waiting' }), { agora: AGORA }), /preciso de uma decisão/);
});

test('1.80.0 · dois agentes não falam ao mesmo tempo (a semente é o id)', () => {
  const a = proximaFala('crep', 1_000_000);
  const b = proximaFala('vmail', 1_000_000);
  assert.notEqual(a, b);
  assert.ok(a > 1_000_000 + RITMO.falaMs - 1);
  const pergunta = proximaFala('crep', 1_000_000, 'pergunta');
  assert.ok(pergunta > a, 'a pergunta vem depois da fala');
});

test('1.80.0 · o balão quebra o texto e desenha-se (caixa, bico e linhas)', () => {
  const linhas = quebrar('«Gerar o site da clínica» a escrever há 2 min · tentativa 1/3', { largura: 120 });
  assert.ok(linhas.length >= 3, `esperava várias linhas, vieram ${linhas.length}`);
  for (const l of linhas) assert.ok(l.length > 0);

  const ctx = ctxDuplo();
  const m = desenharBalao(ctx, 'a correr · há 2 min', { largura: 300 });
  assert.ok(m.altura > 40);
  assert.equal(m.linhas, 1);
  const textos = ctx.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.deepEqual(textos, ['a correr · há 2 min']);
  assert.ok(ctx.ops.some((o) => o[0] === 'roundRect'), 'a caixa redonda é o que faz parecer um balão');
  assert.ok(ctx.ops.some((o) => o[0] === 'fill') && ctx.ops.some((o) => o[0] === 'stroke'));
});

test('1.80.0 · o anel: arco de actividade, três pontos a orbitar e o tempo ao centro', () => {
  const ctx = ctxDuplo();
  desenharAnel(ctx, { fraccao: 0.25, rotulo: '02:13', cor: '#1E9070', tamanho: 128 });
  const arcos = ctx.ops.filter((o) => o[0] === 'arc');
  assert.equal(arcos.length, 2 + 3, 'o arco de fundo, o arco de actividade e três pontos');
  const textos = ctx.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.deepEqual(textos, ['02:13']);
  // a fracção é limitada: um relógio adiantado não desenha voltas a mais
  const ctx2 = ctxDuplo();
  desenharAnel(ctx2, { fraccao: 4.2, rotulo: '00:00' });
  const arco = ctx2.ops.filter((o) => o[0] === 'arc')[1];
  assert.ok(Math.abs((arco[5] - arco[4]) - Math.PI * 2) < 0.001, 'a 100% dá uma volta exacta, não duas');
});

test('1.80.0 · o ritmo é declarado num sítio só (a cena lê daqui)', () => {
  assert.ok(RITMO.falaMs > 5000, 'um balão a cada 5 s seria ruído');
  assert.ok(RITMO.vidaMs > 3000);
  assert.ok(RITMO.cicloMs >= 60000, 'um anel rápido finge progresso');
});
