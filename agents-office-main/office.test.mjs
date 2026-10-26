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
import * as THREE from 'three';
import { makePlant, leafGeometry, stemGeometry, seededRandom, PLANT_KINDS, makeDesk, makeChair } from './src/builders.js';
import {
  MODES, MODE_KEYS, fileProblem, packFiles, contextChoices, chatBody, metaLine, effortLabel,
  loadPrefs, savePrefs, PREFS_KEY, FILES_MAX,
} from './src/composer.js'; // 27 out 2026: o conversador

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

/* ---------- as plantas (1.9.6): geometria de folha, não esferas ----------
   Estes testes correm sem DOM e sem WebGL: as texturas (nervuras, sombra de contacto) são
   opcionais por desenho — sem `document` ficam nulas e a geometria é a mesma. É isso que
   permite provar a forma de uma folha em `node --test`. */

test('o sorteio é reprodutível: a mesma semente dá sempre a mesma sequência', () => {
  const a = seededRandom(7), b = seededRandom(7), c = seededRandom(8);
  const A = [a(), a(), a()], B = [b(), b(), b()], C = [c(), c(), c()];
  assert.deepEqual(A, B);
  assert.notDeepEqual(A, C);
  for (const v of A) assert.ok(v >= 0 && v < 1);
});

test('a folha estreita na base, engorda a um terço e acaba em bico', () => {
  const g = leafGeometry({ len: 1, wid: 0.5, droop: 0, fold: 0, wave: 0, ring: 20, seg: 10 });
  const p = g.attributes.position;
  const larguraEm = (v) => { // a largura da linha v é a distância entre o primeiro e o último vértice
    const i0 = Math.round(v * 20) * 11, i1 = i0 + 10;
    return Math.abs(p.getX(i1) - p.getX(i0));
  };
  assert.ok(larguraEm(0) < 0.02, 'a base da folha tem de ser estreita');
  const meio = larguraEm(0.35);
  assert.ok(meio > 0.3, 'a folha tem de abrir (' + meio.toFixed(2) + ')');
  assert.ok(larguraEm(1) < meio, 'a ponta tem de ser mais estreita que o ombro');
  assert.ok(larguraEm(1) < 0.12, 'a ponta tem de acabar em bico');
  assert.ok(Math.abs(p.getZ(p.count - 1) - 1) < 0.01, 'a folha começa na base e acaba no comprimento');
});

test('a folha dobra ao meio e pende — é isso que a separa de uma esfera', () => {
  const plana = leafGeometry({ len: 1, wid: 0.5, droop: 0, fold: 0, wave: 0 });
  const dobrada = leafGeometry({ len: 1, wid: 0.5, droop: 0, fold: 0.2, wave: 0 });
  // numa linha a meio da folha: o bordo (j=0) sobe em relação à nervura (j=seg/2)
  const vAoMeio = 6 * 11; // linha 6 de 10, 11 vértices por linha
  const dobra = (g) => { const p = g.attributes.position; return p.getY(vAoMeio) - p.getY(vAoMeio + 5); };
  assert.ok(Math.abs(dobra(plana)) < 0.001, 'sem `fold` a folha é plana');
  assert.ok(dobra(dobrada) > 0.02, 'os bordos têm de subir em relação à nervura: ' + dobra(dobrada).toFixed(3));

  const caida = leafGeometry({ len: 1, wid: 0.5, droop: 0.4, fold: 0, wave: 0 });
  const p = caida.attributes.position;
  const yPonta = p.getY(p.count - 1), yBase = p.getY(0);
  assert.ok(yPonta < yBase - 0.3, `a ponta tem de cair (${yPonta.toFixed(2)} vs ${yBase.toFixed(2)})`);
});

test('a cor da folha varia dentro da folha: escura na base e na nervura, clara no limbo', () => {
  const g = leafGeometry({ len: 1, wid: 0.5, droop: 0.2, fold: 0.1, wave: 0.03, ring: 12, seg: 8 });
  const c = g.attributes.color;
  const lum = (i) => c.getX(i) + c.getY(i) + c.getZ(i);
  // linha a meio (índice 6 de 12), 9 vértices por linha: base (v=0), nervura (u=0) e limbo (u≈0,5)
  const linha = 6 * 9;
  const base = lum(0), meio = lum(linha), nervura = lum(linha + 4), limbo = lum(linha + 2);
  assert.ok(meio > base, `o meio da folha tem de ser mais claro que a base (${meio.toFixed(2)} vs ${base.toFixed(2)})`);
  assert.ok(nervura < limbo, `a nervura central tem de ser mais escura que o limbo (${nervura.toFixed(2)} vs ${limbo.toFixed(2)})`);
  for (let i = 0; i < c.count; i++) assert.ok(lum(i) > 0 && c.getX(i) <= 1.001, 'cor fora de 0..1');
});

test('o pecíolo é um tubo que afina da base para a ponta', () => {
  const g = stemGeometry([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 0.3, 0), new THREE.Vector3(0.5, 0.35, 0),
  ], 0.06, 0.015, 10, 6);
  const p = g.attributes.position;
  // o raio de um anel: a maior distância ao CENTRO do anel (a curva dobra, a origem não serve)
  const raio = (anel) => {
    const ids = Array.from({ length: 7 }, (_, j) => anel * 7 + j);
    const cx = ids.reduce((s, i) => s + p.getX(i), 0) / 7, cy = ids.reduce((s, i) => s + p.getY(i), 0) / 7;
    return Math.max(...ids.map((i) => Math.hypot(p.getX(i) - cx, p.getY(i) - cy)));
  };
  assert.ok(raio(0) > raio(10) * 2, 'o pecíolo tem de afinar');
  assert.ok(g.attributes.normal, 'sem normais não há luz');
});

test('a planta monta-se em poucas malhas: vaso, terra, pedras, caules e folhagem', () => {
  const g = makePlant({ seed: 2, kind: 'upright' });
  const malhas = g.children.filter((c) => c.isMesh);
  assert.ok(malhas.length >= 4 && malhas.length <= 7, `devia ser uma planta leve, tem ${malhas.length} malhas`);
  const folha = malhas.find((m) => m.material && m.material.vertexColors);
  assert.ok(folha, 'falta a malha da folhagem (com cor por vértice)');
  assert.ok(folha.material.side === THREE.DoubleSide, 'uma folha tem duas faces');
  assert.ok(folha.geometry.attributes.color.count === folha.geometry.attributes.position.count);
  assert.ok(folha.geometry.attributes.position.count > 3000, 'folhagem com poucos vértices lê-se como esferas');
  assert.deepEqual(g.userData.plant && g.userData.plant.kind, 'upright');
});

test('as duas espécies são plantas diferentes, e cada uma cabe na sua altura', () => {
  for (const kind of Object.keys(PLANT_KINDS)) {
    const g = makePlant({ seed: 4, kind });
    const caixa = new THREE.Box3().setFromObject(g);
    const altura = caixa.max.y - caixa.min.y, largura = caixa.max.x - caixa.min.x;
    assert.ok(altura > 1.4 && altura < 3.4, `${kind}: altura fora do razoável (${altura.toFixed(2)})`);
    assert.ok(largura > 0.9 && largura < 3.8, `${kind}: largura fora do razoável (${largura.toFixed(2)})`);
    assert.ok(caixa.min.y > -0.01 && caixa.min.y < 0.05, `${kind}: o vaso tem de assentar no chão`);
  }
  const u = PLANT_KINDS.upright, b = PLANT_KINDS.broad;
  assert.ok(u.rise > b.rise, 'a vertical tem de crescer mais para cima');
  assert.ok(b.wid > u.wid, 'a de folha larga tem de ter folhas mais largas');
});

test('a mesma semente dá a mesma planta; sementes diferentes dão plantas diferentes', () => {
  const posicoes = (seed) => makePlant({ seed, kind: 'upright' }).children
    .filter((c) => c.isMesh && c.material && c.material.vertexColors)[0]
    .geometry.attributes.position.array;
  const a = posicoes(12), b = posicoes(12), c = posicoes(13);
  assert.deepEqual([...a].slice(0, 300), [...b].slice(0, 300));
  assert.notDeepEqual([...a].slice(0, 300), [...c].slice(0, 300));
});

/* ---------- a secretária (1.9.8): preta, com a luz da sala ----------
   O pedido foi «mesa moderna preta com LED, acessórios gamers, na cor da sala». O que se prova
   aqui é o que se pode provar sem olhos: que a luz é mesmo a da sala, que a tela continua a
   existir (é o contrato com o painel AO VIVO), que cada posto tem uma variante e que tudo é
   determinístico — a cena não muda entre recarregamentos. */

const malhasDe = (g) => { const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };

test('a secretária devolve a tela e a moldura que o main.js espera', () => {
  const live = { tex: null, canvas: null };
  const { group, screenSet } = makeDesk('#CFEBDD', live, { glass: '#1FA36B', seed: 0 });
  assert.ok(screenSet && screenSet.live, 'a tela AO VIVO tem de vir no screenSet');
  const nomes = malhasDe(group).map((m) => m.name).filter(Boolean);
  assert.ok(nomes.includes('screen'), 'falta a malha do ecrã');
  assert.ok(nomes.includes('monBack'), 'falta a moldura do monitor');
  const ecra = malhasDe(group).find((m) => m.name === 'screen');
  const box = new THREE.Box3().setFromObject(ecra);
  assert.ok(box.max.y > 4.0 && box.max.y < 5.6, `o ecrã subiu ou desceu demais (${box.max.y.toFixed(2)})`);
});

test('a luz da secretária é a cor da sala — e não outra', () => {
  for (const glass of ['#1FA36B', '#DC5348', '#8B5AD6']) {
    const { group } = makeDesk('#EEEEEE', null, { glass, seed: 1 });
    const led = malhasDe(group).find((m) => m.userData.part === 'deskLed');
    assert.ok(led, 'falta a malha do LED');
    assert.equal('#' + led.material.emissive.getHexString(), glass.toLowerCase(), 'o LED não está na cor da sala');
    assert.ok(led.material.emissiveIntensity > 0.8, 'um LED apagado não é um LED');
    const halo = malhasDe(group).find((m) => m.material && m.material.blending === THREE.AdditiveBlending);
    assert.ok(halo, 'falta o halo (o brilho à volta da luz)');
    assert.equal('#' + halo.material.color.getHexString(), glass.toLowerCase(), 'o halo não está na cor da sala');
    assert.equal(halo.material.depthWrite, false, 'um halo não pode escrever profundidade (tapava o resto)');
  }
});

test('a mesa é preta: o corpo não é branco nem madeira', () => {
  const { group } = makeDesk('#CFEBDD', null, { glass: '#1FA36B', seed: 2 });
  const corpo = malhasDe(group).find((m) => m.userData.part === 'desk');
  const c = corpo.material.color;
  assert.ok(Math.max(c.r, c.g, c.b) < 0.20, `o corpo da secretária devia ser preto (${c.getHexString()})`);
  assert.ok(corpo.material.metalness > 0.1, 'o preto acetinado tem de ter um pouco de metal');
});

test('cada posto tem uma variante de acessório, e a mesma semente dá a mesma mesa', () => {
  const tamanho = (seed) => {
    const { group } = makeDesk('#CFEBDD', null, { glass: '#1FA36B', seed });
    let v = 0;
    malhasDe(group).forEach((m) => { v += m.geometry.attributes.position.count; });
    return v;
  };
  const a = tamanho(0), b = tamanho(1), c = tamanho(2);
  assert.equal(new Set([a, b, c]).size, 3, 'as três variantes (comando, telemóvel, barra) têm de ser diferentes');
  assert.equal(tamanho(1), b, 'a mesma semente tem de dar a mesma mesa');
});

test('a cadeira também é preta, com a costura na cor da sala', () => {
  const ch = makeChair({ glass: '#41AEE4', chip: '#D6EEF9' });
  const malhas = malhasDe(ch);
  const corpo = malhas.find((m) => m.userData.part === 'desk');
  const led = malhas.find((m) => m.userData.part === 'deskLed');
  assert.ok(corpo && led, 'a cadeira tem de ter corpo e costura');
  assert.equal('#' + led.material.emissive.getHexString(), '#41aee4');
  assert.ok(Math.max(corpo.material.color.r, corpo.material.color.g, corpo.material.color.b) < 0.20);
});

test('as peças ficam fundidas: uma secretária são poucas malhas, não trinta', () => {
  const { group } = makeDesk('#CFEBDD', null, { glass: '#1FA36B', seed: 0 });
  const n = malhasDe(group).length;
  assert.ok(n <= 12, `demasiadas malhas por secretária (${n}) — o custo é por posto, e são 35`);
});


/* ---------- o conversador (27 out 2026) ----------
   O compositor não é decoração: cada peça que a página mostra é uma coisa que o servidor recebe.
   Estes testes fixam o contrato entre os dois — os três modos, os três modelos que o servidor
   conhece, os limites dos anexos e a honestidade do menu de contexto. */

test('o compositor tem três modos, e são os que o servidor entende', () => {
  assert.deepEqual(MODE_KEYS, ['plan', 'ask', 'build']);
  assert.deepEqual(MODES.map((m) => m.name), ['Planear', 'Perguntar', 'Construir']);
  for (const m of MODES) assert.ok(m.title && m.title.length > 20, `o modo ${m.key} tem de se explicar numa linha`);
  assert.match(MODES.find((m) => m.key === 'plan').title, /sem ferramentas/i);
  assert.match(MODES.find((m) => m.key === 'build').title, /tarefa/i);
});

test('anexos: só texto, com limites ditos por palavras', () => {
  assert.equal(fileProblem({ name: 'notas.md', size: 1200 }), null);
  assert.equal(fileProblem({ name: 'dados.csv', size: 1200 }), null);
  assert.match(fileProblem({ name: 'foto.png', size: 1200 }), /só texto/);
  assert.match(fileProblem({ name: 'contrato.pdf', size: 1200 }), /só texto/);
  assert.match(fileProblem({ name: 'enorme.txt', size: 900000 }), /grande demais/);
  assert.equal(fileProblem(null), 'ficheiro vazio');
});

test('packFiles respeita o máximo de ficheiros e nunca perde uma recusa em silêncio', () => {
  const mk = (i) => ({ name: `n${i}.md`, size: 10, text: 'x'.repeat(100) });
  const seis = Array.from({ length: FILES_MAX + 1 }, (_, i) => mk(i));
  const { files, rejected } = packFiles([], seis);
  assert.equal(files.length, FILES_MAX);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0], new RegExp(`máximo são ${FILES_MAX}`));
  const comImagem = packFiles([], [{ name: 'a.png', size: 10, text: '' }, mk(9)]);
  assert.equal(comImagem.files.length, 1);
  assert.match(comImagem.rejected[0], /só texto/);
  const orcamento = packFiles([], Array.from({ length: FILES_MAX }, () => ({ name: 'g.txt', size: 999999, text: 'y'.repeat(40000) })));
  assert.ok(orcamento.files.length < FILES_MAX, 'o orçamento total tem de cortar antes de mandar 200 kB para o motor');
  assert.ok(orcamento.rejected.length > 0, 'cortar por orçamento tem de ser dito');
});

test('o @contexto só oferece o que existe, e o terminal é recusado com a razão', () => {
  const vazio = contextChoices(null);
  const cerebro = vazio.find((c) => c.key === 'brain');
  assert.equal(cerebro.disabled, true);
  assert.match(cerebro.why, /não tem notas/);
  assert.equal(vazio.find((c) => c.key === 'docs').disabled, true);
  const terminal = vazio.find((c) => c.key === 'terminal');
  assert.equal(terminal.disabled, true, 'o terminal não existe nesta casa');
  assert.match(terminal.why, /não há terminal/);
  const cheio = contextChoices({ context: { notes: 35, docs: 11 } });
  assert.equal(cheio.find((c) => c.key === 'brain').count, 35);
  assert.equal(cheio.find((c) => c.key === 'brain').disabled, false);
  assert.equal(cheio.find((c) => c.key === 'docs').count, 11);
});

test('o corpo do pedido diz ao servidor o modo, o modelo e o esforço — e cala-se no Auto', () => {
  const auto = chatBody({ text: 'olá', mode: 'ask', model: 'opus', effort: 'high', auto: true });
  assert.equal(auto.model, undefined);
  assert.equal(auto.effort, undefined);
  assert.equal(auto.auto, true);
  const escolhido = chatBody({ text: 'olá', mode: 'plan', model: 'opus', effort: 'max', auto: false });
  assert.equal(escolhido.mode, 'plan');
  assert.equal(escolhido.model, 'opus');
  assert.equal(escolhido.effort, 'max');
  assert.equal(escolhido.model === undefined && escolhido.effort === undefined, false);
  assert.equal(chatBody({ text: 'x', mode: 'inventado' }).mode, 'ask');
  assert.equal(chatBody({ text: 'x', context: [] }).context, undefined);
  assert.deepEqual(chatBody({ text: 'x', context: ['brain', 'docs'] }).context, ['brain', 'docs']);
  assert.equal(chatBody({ text: 'x', history: Array.from({ length: 20 }, (_, i) => ({ who: 'user', text: String(i) })) }).history.length, 8);
  const grande = chatBody({ text: 'x', files: [{ name: 'a.txt', text: 'z'.repeat(90000) }] });
  assert.equal(grande.files[0].text.length, 40000, 'o que sai da página já vai cortado');
});

test('a linha por baixo da resposta diz o que correu, não o que se esperava', () => {
  const dito = metaLine({ modelName: 'Opus', effortName: 'X-high', mode: 'plan' }, { files: [{ name: 'a.md' }], context: ['brain'] });
  assert.match(dito, /Opus/);
  assert.match(dito, /x-high/i);
  assert.match(dito, /plano/);
  assert.match(dito, /1 ficheiro/);
  assert.match(dito, /@Cérebro/);
  const vazio = metaLine({}, { model: 'Sonnet' });
  assert.equal(vazio, 'Sonnet · esforço auto');
  assert.equal(effortLabel('max'), 'Max');
  assert.equal(effortLabel(''), 'Auto');
  assert.equal(effortLabel(undefined), 'Auto');
});

test('as preferências do compositor sobrevivem com bom senso (e não rebentam com lixo)', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const base = loadPrefs(storage);
  assert.deepEqual(base, { mode: 'ask', model: '', effort: '', auto: true, favs: [], tour: false, tab: 'all' });
  savePrefs(storage, { mode: 'build', model: 'opus', effort: 'max', auto: false, favs: ['opus', 'fable'], tour: true });
  const lido = loadPrefs(storage);
  assert.equal(lido.mode, 'build');
  assert.equal(lido.auto, false);
  assert.deepEqual(lido.favs, ['opus', 'fable']);
  assert.equal(lido.tour, true);
  mem.set(PREFS_KEY, '{lixo');
  assert.equal(loadPrefs(storage).mode, 'ask');
  mem.set(PREFS_KEY, JSON.stringify({ mode: 'atirar', favs: 'não', auto: 'talvez' }));
  const tolerante = loadPrefs(storage);
  assert.equal(tolerante.mode, 'ask');
  assert.deepEqual(tolerante.favs, []);
  assert.equal(tolerante.auto, true);
});
