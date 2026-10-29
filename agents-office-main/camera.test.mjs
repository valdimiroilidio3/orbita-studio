/* ===========================================================================
   1.53.0 · A CÂMARA — provas sem three, sem GPU e sem browser.

   O pedido foi «arrastar e mover, scroll para os lados, outros ângulos da
   câmara». Aqui prova-se a conta que faz isso: os quatro ângulos fecham um
   quarto de volta exacto, o yaw não acumula, a inclinação tem limites e a
   direcção devolvida é sempre unitária (senão o zoom parecia mudar sozinho).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ANGULOS, AEREA, INCLINACAO_MIN, INCLINACAO_MAX, INCLINACAO_BASE, RAD_POR_PIXEL,
  direcaoDaCamara, rodar, normalizarAngulo, inclinacaoValida, anguloActual,
  proximoAngulo, etiquetaDoAngulo, gestoDoScroll, gestoDoArrasto,
} from './src/camera.js';

const PI = Math.PI;
const perto = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('a isométrica da casa continua a ser a de origem (ninguém perde a vista que tinha)', () => {
  const d = direcaoDaCamara(0, INCLINACAO_BASE);
  const len = Math.hypot(d.x, d.y, d.z);
  perto(len, 1);
  // a direcção é a (1, 0.92, 1) normalizada
  const base = { x: 1, y: 0.92, z: 1 };
  const bl = Math.hypot(base.x, base.y, base.z);
  perto(d.x, base.x / bl);
  perto(d.y, base.y / bl);
  perto(d.z, base.z / bl);
});

test('rodar um quarto de volta quatro vezes fecha a volta exacta', () => {
  let yaw = 0;
  for (let i = 0; i < 4; i++) yaw = rodar(yaw, PI / 2);
  perto(normalizarAngulo(yaw), 0);
  // e a direcção volta a ser a mesma
  const d = direcaoDaCamara(yaw, INCLINACAO_BASE);
  const o = direcaoDaCamara(0, INCLINACAO_BASE);
  perto(d.x, o.x); perto(d.z, o.z);
});

test('o yaw dá a volta em vez de acumular: rodar 400 vezes não é um número enorme', () => {
  let yaw = 0;
  for (let i = 0; i < 400; i++) yaw = rodar(yaw, 0.37);
  assert.ok(Math.abs(yaw) <= PI, `yaw ficou em ${yaw}`);
  assert.ok(Number.isFinite(yaw));
  assert.equal(normalizarAngulo(PI), PI, 'π fica π (o intervalo é (-π, π])');
  perto(normalizarAngulo(PI + 0.1), -PI + 0.1);
});

test('a inclinação tem limites: nem por baixo do chão nem a pino infinito', () => {
  assert.equal(inclinacaoValida(-10), INCLINACAO_MIN);
  assert.equal(inclinacaoValida(99), INCLINACAO_MAX);
  assert.equal(inclinacaoValida('abc'), INCLINACAO_BASE);
  assert.equal(inclinacaoValida(1.2), 1.2);
  // e a direcção continua unitária nos extremos
  for (const t of [INCLINACAO_MIN, 0.9, 1.5, INCLINACAO_MAX]) {
    const d = direcaoDaCamara(0.7, t);
    perto(Math.hypot(d.x, d.y, d.z), 1);
  }
});

test('a vista aérea olha de cima sem mudar de lado', () => {
  const baixa = direcaoDaCamara(0, INCLINACAO_BASE);
  const alta = direcaoDaCamara(AEREA.yaw, AEREA.inclinacao);
  assert.ok(alta.y > baixa.y, 'a vista aérea tem de estar mais acima');
  // a mesma direcção no plano (o lado não muda), só a altura
  perto(Math.atan2(alta.z, alta.x), Math.atan2(baixa.z, baixa.x), 1e-9);
  // e o raio no plano encolhe: olhar de cima «achata» a perspectiva
  assert.ok(Math.hypot(alta.x, alta.z) < Math.hypot(baixa.x, baixa.z));
});

test('os quatro ângulos estão a 90° um do outro, e o próximo segue o sentido', () => {
  const ys = ANGULOS.map((a) => a.yaw);
  for (let i = 1; i < ys.length; i++) perto(normalizarAngulo(ys[i] - ys[i - 1]), -PI / 2);
  assert.equal(proximoAngulo(0, 1).id, 'no');
  assert.equal(proximoAngulo(0, -1).id, 'se');
  assert.equal(anguloActual(0.1).id, 'ne');
  assert.equal(anguloActual(-PI / 2 + 0.05).id, 'no');
});

test('o rótulo diz onde estamos — e diz AÉREA quando se olha de cima', () => {
  assert.equal(etiquetaDoAngulo(0, INCLINACAO_BASE), 'NE');
  assert.equal(etiquetaDoAngulo(-PI / 2, INCLINACAO_BASE), 'NO · -90°');
  assert.equal(etiquetaDoAngulo(0, AEREA.inclinacao), 'AÉREA');
});

test('o scroll lateral RODA e o vertical dá ZOOM — cada gesto faz uma coisa', () => {
  assert.deepEqual(gestoDoScroll({ deltaX: 40, deltaY: 2 }), { tipo: 'rodar', valor: 40 });
  assert.deepEqual(gestoDoScroll({ deltaY: 120 }), { tipo: 'zoom', valor: 120 });
  assert.deepEqual(gestoDoScroll({ deltaY: 120, shiftKey: true }), { tipo: 'rodar', valor: 120 });
  // um trackpad manda os dois eixos: manda o maior
  assert.deepEqual(gestoDoScroll({ deltaX: 3, deltaY: 60 }), { tipo: 'zoom', valor: 60 });
  // e o passo é pequeno: 100 px de scroll são ~24°
  const graus = 100 * RAD_POR_PIXEL * 180 / PI;
  assert.ok(graus > 20 && graus < 30, `100 px davam ${graus.toFixed(1)}°`);
});

test('o arrasto com Alt (ou botão do meio/direito) roda; sem ele, move o chão', () => {
  assert.equal(gestoDoArrasto({}), 'mover');
  assert.equal(gestoDoArrasto({ altKey: true }), 'rodar');
  assert.equal(gestoDoArrasto({ botao: 1 }), 'rodar');
  assert.equal(gestoDoArrasto({ botao: 2 }), 'rodar');
});

test('o main.js usa esta conta em vez de ter a direcção fixa', () => {
  const main = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
  assert.match(main, /from '\.\/camera\.js'/);
  assert.match(main, /direcaoDaCamara\(view\.yaw \+ view\.arc, view\.tilt\)/, 'a câmara tem de usar o ângulo escolhido');
  assert.doesNotMatch(main, /isoWork\.copy\(ISO\);/, 'a direcção fixa não pode ter ficado');
  assert.match(main, /gestoDoScroll\(e\)/);
  /* 1.53.2 · o gesto passou a saber também se o dedo caiu no vazio e se há Shift */
  assert.match(main, /gestoDoArrasto\(\{ altKey: e\.altKey, botao: e\.button, vazio, shiftKey: e\.shiftKey \}\)/);
  assert.match(main, /if \(e\.key === '\['\)/, 'falta a tecla de rodar');
  const shell = readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');
  assert.match(shell, /id="zAerea"/, 'o botão da vista aérea não existe no HTML');
  assert.match(shell, /id="zAngle"/, 'falta a pastilha que diz em que ângulo estamos');
});

/* ---------- 1.53.0 · voltar à isométrica depois de rodar ---------- */
test('a vista geral endireita a câmara: `zoomOut` volta ao yaw 0 e à inclinação da casa', async () => {
  const src = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
  assert.match(src, /function voltarAoIso/, 'falta a função que devolve a isométrica');
  const zoomOut = /function zoomOut\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(zoomOut, 'não encontrei o `zoomOut`');
  assert.match(zoomOut[0], /voltarAoIso\(550\)/,
    'a vista geral tem de repor o ângulo, senão a câmara fica torcida sem botão para a endireitar');
  // e `voltarAoIso` anima para (0, INCLINACAO_BASE), não para um número escrito à mão
  const fn = /function voltarAoIso[\s\S]*?\n\}/.exec(src)[0];
  assert.match(fn, /animarAngulo\(0, INCLINACAO_BASE, dur\)/);
});

test('a tecla 0 endireita a câmara, e nenhuma tecla nova rouba o foco a um campo', async () => {
  const src = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
  assert.match(src, /e\.key === '0'[\s\S]{0,60}voltarAoIso\(380\)/);
  // a guarda de INPUT/TEXTAREA/SELECT continua antes de qualquer atalho de câmara
  const teclado = /addEventListener\('keydown', \(e\) => \{\n  if \(\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(e\.target\.tagName\)\) return;[\s\S]*?\n\}\);/.exec(src);
  assert.ok(teclado, 'a guarda dos campos desapareceu do teclado da câmara');
  assert.match(teclado[0], /e\.key === '0'/);
});

test('os botões da câmara dizem os gestos que existem (senão ninguém os descobre)', async () => {
  const html = readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');
  assert.match(html, /id="zLeft"[^>]*title="[^"]*Shift\+scroll/);
  assert.match(html, /id="zAngle"[^>]*title="[^"]*0 endireita/);
  assert.match(html, /id="zAerea"[^>]*title="[^"]*Alt\+arrastar inclina/);
});

/* ---------- 1.53.2 · o arrasto no vazio roda a câmara ---------- */
test('arrastar no vazio roda; sobre uma secretária move; Shift move; Alt roda', () => {
  // o pedido do dono, por palavras: «clicando na área sem nada e arrastando»
  assert.equal(gestoDoArrasto({ vazio: true }), 'rodar');
  assert.equal(gestoDoArrasto({ vazio: false }), 'mover', 'em cima de uma mesa o arrasto continua a mover o chão');
  assert.equal(gestoDoArrasto({ vazio: true, shiftKey: true }), 'mover', 'Shift é a casa do pan');
  assert.equal(gestoDoArrasto({ vazio: true, altKey: true }), 'rodar');
  assert.equal(gestoDoArrasto({ vazio: false, botao: 1 }), 'rodar');
  assert.equal(gestoDoArrasto({ vazio: false, botao: 2 }), 'rodar');
});

test('main.js: o pointerdown sabe o que está por baixo ANTES de decidir o gesto', async () => {
  const src = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
  assert.match(src, /function algoSob\(nx, ny\)/, 'falta a leitura do que está sob o cursor');
  const down = /canvas\.addEventListener\('pointerdown'[\s\S]*?\n\}\);/.exec(src);
  assert.ok(down, 'não encontrei o pointerdown');
  assert.match(down[0], /const vazio = !algoSob\(nx, ny\)/, 'a decisão tem de olhar para o que está debaixo do dedo');
  assert.match(down[0], /gestoDoArrasto\(\{ altKey: e\.altKey, botao: e\.button, vazio, shiftKey: e\.shiftKey \}\)/);
  // e o raio olha para os três alvos que o clique conhece
  const fn = /function algoSob[\s\S]*?\n\}/.exec(src)[0];
  assert.match(fn, /personTargets/);
  assert.match(fn, /clickTargets/);
  assert.match(fn, /mcp\.sprites/);
});

test('um clique sem arrastar continua a abrir a ficha (a rotação não come o clique)', async () => {
  const src = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
  const up = /addEventListener\('pointerup'[\s\S]*?\n\}\);/.exec(src);
  assert.ok(up);
  assert.match(up[0], /if \(wasDrag\) return;/, 'um arrasto não abre nada…');
  assert.match(up[0], /openAgent\(clicked/, '…e um clique sem arrasto continua a abrir o agente');
});
