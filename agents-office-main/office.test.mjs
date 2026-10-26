// Testes do ESCRITÓRIO (dados + paleta) — sem browser, sem WebGL, sem jsdom.
//
// Porque existem (26 out 2026, V7). O chão das salas passou a ser vidro colorido e a cor deixou
// de estar num sítio só: vive em `src/data.js` (o hex), é derivada em `src/palette.js` (base,
// aresta, poça) e desenhada em `src/builders.js`. Três ficheiros que não se vêem uns aos outros.
// Estes testes são a única coisa que os obriga a dizer a mesma coisa.
//
// A regra que o dono pediu — «vermelho, verde, azul, roxo, amarelo e azul céu» — é verificada
// por matiz, não por hex: se amanhã o tom for afinado, o teste continua a saber o que quer.
//
//   node --test office.test.mjs        (ou: npm run test:office)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHex, toHex, mix, shade, tint, hsl, familyOf, glassLayers, GLASS_FAMILIES,
} from './src/palette.js';
import { DEPTS, DEPT_KEYS, AGENTS, LAYOUT, officeProblems, assertOffice } from './src/data.js';

/* ---------- cor: a matemática que tudo o resto usa ---------- */

test('parseHex aceita #rgb e #rrggbb e recusa o resto com o nome da cor', () => {
  assert.deepEqual(parseHex('#1FA36B'), { r: 31, g: 163, b: 107 });
  assert.deepEqual(parseHex('1fa36b'), { r: 31, g: 163, b: 107 });
  assert.deepEqual(parseHex('#F00'), { r: 255, g: 0, b: 0 });
  for (const mau of ['', null, undefined, '#12345', 'vermelho', '#GGGGGG', 'rgb(1,2,3)']) {
    assert.throws(() => parseHex(mau), /cor inválida/, `devia recusar ${String(mau)}`);
  }
});

test('toHex fecha em 0–255 e devolve sempre seis dígitos', () => {
  assert.equal(toHex({ r: 300, g: -20, b: 15.6 }), '#ff0010');
  assert.equal(toHex({ r: 0, g: 0, b: 0 }), '#000000');
});

test('mix vai de uma ponta à outra e passa pelo meio', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(mix('#000000', '#FFFFFF', 1), '#ffffff');
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
});

test('shade escurece, tint clareia, e nenhum dos dois mexe no matiz', () => {
  const cor = '#4A6DE0';
  const escura = shade(cor, 0.46), clara = tint(cor, 0.34);
  assert.ok(hsl(escura).l < hsl(cor).l, 'shade tem de baixar a luminosidade');
  assert.ok(hsl(clara).l > hsl(cor).l, 'tint tem de subir a luminosidade');
  assert.ok(Math.abs(hsl(escura).h - hsl(cor).h) < 6, 'shade não pode mudar a família da cor');
  assert.ok(Math.abs(hsl(clara).h - hsl(cor).h) < 6, 'tint não pode mudar a família da cor');
});

test('hsl devolve os matizes canónicos', () => {
  assert.equal(Math.round(hsl('#FF0000').h), 0);
  assert.equal(Math.round(hsl('#00FF00').h), 120);
  assert.equal(Math.round(hsl('#0000FF').h), 240);
  assert.equal(hsl('#808080').s, 0);
});

/* ---------- as seis famílias que o dono pediu ---------- */

test('familyOf nomeia cada família pedida e reconhece o vidro fosco', () => {
  assert.equal(familyOf('#DC5348'), 'vermelho');
  assert.equal(familyOf('#1FA36B'), 'verde');
  assert.equal(familyOf('#4A6DE0'), 'azul');
  assert.equal(familyOf('#41AEE4'), 'azul céu');
  assert.equal(familyOf('#8B5AD6'), 'roxo');
  assert.equal(familyOf('#E3B93A'), 'amarelo');
  assert.equal(familyOf('#AEB6AB'), 'neutro', 'o cinza-esverdeado do centro é vidro fosco');
  assert.equal(familyOf('#FFFFFF'), 'neutro');
});

test('as famílias não se sobrepõem — uma cor pertence a uma só', () => {
  for (const f of GLASS_FAMILIES) {
    assert.ok(f.from >= 0 && f.to <= 360 && f.from <= f.to, `intervalo inválido em ${f.name}`);
  }
  for (let i = 0; i < GLASS_FAMILIES.length; i++) {
    for (let j = i + 1; j < GLASS_FAMILIES.length; j++) {
      const a = GLASS_FAMILIES[i], b = GLASS_FAMILIES[j];
      if (a.name === b.name) continue; // o vermelho tem dois intervalos: 345–360 e 0–12
      const sobrepoe = a.from <= b.to && b.from <= a.to;
      assert.ok(!sobrepoe, `${a.name} (${a.from}–${a.to}) sobrepõe-se a ${b.name} (${b.from}–${b.to})`);
    }
  }
});

/* ---------- as camadas do chão de vidro ---------- */

test('glassLayers deriva base escura, aresta clara e poça branca, e valida a cor', () => {
  const L = glassLayers('#DC5348');
  assert.equal(L.glass, '#DC5348');
  assert.ok(hsl(L.base).l < hsl(L.glass).l - 0.1, 'a base tem de ser visivelmente mais funda');
  assert.ok(hsl(L.edge).l > hsl(L.glass).l, 'a aresta tem de ser mais clara que a laje');
  assert.equal(L.pool, '#FFFFFF');
  assert.ok(hsl(L.wash).l > 0.85, 'o tom de papel (para o HTML) tem de ser pálido');
  assert.throws(() => glassLayers('vermelho'), /cor inválida/);
});

/* ---------- os dados do escritório ---------- */

test('as sete salas têm nome, cor de marca e cor de vidro válidas', () => {
  assert.equal(Object.keys(DEPTS).length, 7);
  for (const [k, d] of Object.entries(DEPTS)) {
    for (const campo of ['name', 'short']) assert.ok(d[campo] && d[campo].length, `${k}: falta ${campo}`);
    for (const campo of ['chip', 'ink', 'glass']) {
      assert.match(d[campo], /^#([0-9a-f]{3}|[0-9a-f]{6})$/i, `${k}: ${campo} não é uma cor`);
    }
    assert.ok(['vermelho', 'verde', 'azul', 'azul céu', 'roxo', 'amarelo', 'neutro'].includes(d.glassName),
      `${k}: família de vidro desconhecida (${d.glassName})`);
  }
});

test('as seis salas cobrem as seis cores pedidas, uma cada, e o centro é neutro', () => {
  const porFamilia = new Map();
  for (const k of DEPT_KEYS) {
    const fam = familyOf(DEPTS[k].glass);
    assert.ok(fam && fam !== 'neutro', `${k}: o vidro (${DEPTS[k].glass}) não é de nenhuma família`);
    assert.equal(fam, DEPTS[k].glassName, `${k}: o vidro é ${fam} e o dado diz ${DEPTS[k].glassName}`);
    assert.ok(!porFamilia.has(fam), `${k} repete a família de ${porFamilia.get(fam)} (${fam})`);
    porFamilia.set(fam, k);
  }
  for (const cor of ['vermelho', 'verde', 'azul', 'roxo', 'amarelo', 'azul céu']) {
    assert.ok(porFamilia.has(cor), `falta a cor pedida: ${cor}`);
  }
  assert.equal(familyOf(DEPTS.brain.glass), 'neutro', 'o Cérebro é o único vidro fosco, de propósito');
  assert.equal(porFamilia.size, 6);
});

test('o vidro tem saturação e luz suficientes para ler como vidro sobre o papel', () => {
  for (const k of DEPT_KEYS) {
    const { s, l } = hsl(DEPTS[k].glass);
    assert.ok(s >= 0.35, `${k}: saturação baixa (${s.toFixed(2)}) — fica um chão lavado`);
    assert.ok(l >= 0.28 && l <= 0.72, `${k}: luminosidade fora da janela (${l.toFixed(2)})`);
  }
  const centro = hsl(DEPTS.brain.glass);
  assert.ok(centro.s <= 0.22, 'o centro tem de ser dessaturado para não competir com as salas');
});

test('nenhuma sala partilha a cor de vidro de outra', () => {
  const cores = Object.values(DEPTS).map((d) => String(d.glass).toLowerCase());
  assert.equal(new Set(cores).size, cores.length);
});

/* ---------- a estrutura: pods, agentes, secretárias ---------- */

test('LAYOUT e DEPTS descrevem o mesmo escritório', () => {
  assert.equal(Object.keys(LAYOUT).length, 7, 'sete pods: seis salas e o centro');
  assert.deepEqual([...DEPT_KEYS].sort(), Object.keys(LAYOUT).filter((k) => k !== 'brain').sort());
  for (const [k, L] of Object.entries(LAYOUT)) {
    assert.ok(L.w > 0 && L.d > 0, `${k}: pod sem dimensões`);
    assert.equal(L.pos.length, 2, `${k}: posição inválida`);
  }
  const posicoes = Object.values(LAYOUT).map((L) => L.pos.join(','));
  assert.equal(new Set(posicoes).size, posicoes.length, 'dois pods no mesmo sítio');
});

test('35 agentes, todos numa sala conhecida, um chefe por sala', () => {
  assert.equal(AGENTS.length, 35);
  const ids = AGENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'há ids repetidos');
  for (const a of AGENTS) {
    assert.ok(DEPTS[a.dept], `${a.id}: sala desconhecida (${a.dept})`);
    assert.notEqual(a.dept, 'brain', `${a.id}: o Cérebro não tem secretárias`);
    assert.equal(a.grid.length, 2, `${a.id}: secretária sem coordenadas`);
  }
  for (const k of DEPT_KEYS) {
    const sala = AGENTS.filter((a) => a.dept === k);
    assert.ok(sala.length >= 4, `${k}: sala com pouca gente (${sala.length})`);
    assert.equal(sala.filter((a) => a.lead).length, 1, `${k}: tem de haver um chefe de sala`);
  }
  assert.equal(AGENTS.map((a) => a.dept).filter((d) => DEPT_KEYS.includes(d)).length, 35);
});

test('duas pessoas não se sentam na mesma secretária', () => {
  const vistos = new Map();
  for (const a of AGENTS) {
    const chave = `${a.dept}|${a.grid.join(',')}`;
    assert.ok(!vistos.has(chave), `${a.id} senta-se onde ${vistos.get(chave)} já está (${chave})`);
    vistos.set(chave, a.id);
  }
});

test('officeProblems() está vazio e assertOffice() passa', () => {
  assert.deepEqual(officeProblems(), []);
  assert.equal(assertOffice(), true);
});

test('assertOffice() apanha um erro de dados e diz qual é', () => {
  const antes = DEPTS.fin.glass;
  try {
    DEPTS.fin.glass = 'azul'; // deixa de ser uma cor
    const problemas = officeProblems();
    assert.ok(problemas.some((p) => /fin: glass/.test(p)), 'devia apontar o campo e a sala: ' + problemas.join(' | '));
    assert.throws(() => assertOffice(), /escritório inconsistente/);
  } finally {
    DEPTS.fin.glass = antes;
  }
  assert.deepEqual(officeProblems(), [], 'depois de repor, tem de voltar a estar limpo');
});
