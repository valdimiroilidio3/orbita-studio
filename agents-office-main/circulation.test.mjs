// A PLANTA DAS PORTAS — provas de geometria pura (28 out 2026, pedido 36).
//
// O dono pediu uma coisa que se prova sem três dimensões: «melhore os lugares das portas e analisa
// bem». O sítio da porta e o traçado da ponte vivem em `src/circulation.js`, que não sabe o que é
// three — é por isso que se pode provar aqui, em milissegundos, sem browser e sem WebGL.
//
// O que fica provado, e porque importa:
//   · a porta está no BORDO do pod (nem 1 m à frente da parede, nem no meio do chão);
//   · a porta ABRE PARA O CÉREBRO (o eixo aponta para o átrio, e há espaço livre do lado de fora);
//   · a ponte NASCE DA PORTA (0,9 m à frente, no eixo dela) e ACABA NO POD do Cérebro;
//   · a ponte não atravessa a sala nem corre por dentro do pod;
//   · as três salas cuja porta cai no lado aberto ficam com `screen` (o anteparo) e as outras não.
//
//   node --test circulation.test.mjs      (ou: npm run test:circulation)

import test from 'node:test';
import assert from 'node:assert/strict';

import { doorPlan, doorPlans } from './src/circulation.js';
import { LAYOUT, DEPT_KEYS } from './src/data.js';

const ATRIO = { x: 8, z: 8 };
const perto = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const naBorda = (v, meio, tol = 1e-9) => perto(Math.abs(v), meio, tol);

test('uma planta por sala, na ordem das salas e sem o Cérebro', () => {
  const ps = doorPlans(LAYOUT, ATRIO);
  assert.equal(ps.length, DEPT_KEYS.length);
  // a ordem é a do `LAYOUT` (sem o Cérebro): estável, e por isso comparável entre execuções
  assert.deepEqual(ps.map((p) => p.key), Object.keys(LAYOUT).filter((k) => k !== 'brain'));
  for (const p of ps) assert.ok(!Object.is(p.key, 'brain'));
  assert.equal(new Set(ps.map((p) => p.key)).size, ps.length);
});

test('a porta assenta no bordo do pod, no eixo que dá para o Cérebro', () => {
  for (const p of doorPlans(LAYOUT, ATRIO)) {
    const L = LAYOUT[p.key];
    const noX = p.side === '+x' || p.side === '-x';
    const dim = noX ? L.w : L.d;
    const local = noX ? p.local.x : p.local.z;
    // no bordo: exactamente meio pod, e o sinal do lado bate com o sinal da coordenada
    assert.ok(perto(Math.abs(local), dim / 2), `${p.key}: a porta não está no bordo (${local} de ${dim / 2})`);
    assert.equal(Math.sign(local), Math.sign(noX ? p.dir.x : p.dir.z), `${p.key}: a porta está no lado errado`);
    // o eixo é um vector unitário de um só eixo (as salas não estão rodadas)
    assert.ok(perto(Math.hypot(p.dir.x, p.dir.z), 1), `${p.key}: o eixo da porta não é unitário`);
    assert.ok((p.dir.x === 0) !== (p.dir.z === 0), `${p.key}: o eixo da porta não é recto`);
    // o mundo e o local dizem a mesma coisa
    assert.ok(perto(p.at.x, L.pos[0] + p.local.x));
    assert.ok(perto(p.at.z, L.pos[1] + p.local.z));
    assert.ok(perto(p.angle, Math.atan2(p.dir.x, p.dir.z)), `${p.key}: o ângulo do grupo não corresponde ao eixo`);
  }
});

test('a porta abre para o Cérebro — e há espaço livre do lado de fora', () => {
  for (const p of doorPlans(LAYOUT, ATRIO)) {
    const L = LAYOUT[p.key];
    // 1 · o Cérebro (ou o seu canto mais próximo) está do lado para onde a porta abre
    const face = { x: Math.max(-8, Math.min(8, p.at.x)), z: Math.max(-8, Math.min(8, p.at.z)) };
    const paraDentro = (face.x - p.at.x) * p.dir.x + (face.z - p.at.z) * p.dir.z;
    assert.ok(paraDentro > 0.5, `${p.key}: a porta não olha para o Cérebro (${paraDentro})`);
    // 2 · 2 m à frente da porta é FORA do pod da sala (não é uma porta a abrir para dentro de si)
    const fora = { x: p.at.x + p.dir.x * 2, z: p.at.z + p.dir.z * 2 };
    const dentro = Math.abs(fora.x - L.pos[0]) < L.w / 2 - 1e-9
      && Math.abs(fora.z - L.pos[1]) < L.d / 2 - 1e-9;
    assert.equal(dentro, false, `${p.key}: a porta abre para dentro da sala`);
  }
});

test('a ponte nasce da porta e acaba no pod do Cérebro', () => {
  for (const p of doorPlans(LAYOUT, ATRIO)) {
    // nasce 0,9 m à frente da porta, no eixo dela
    const dx = p.bridge.from.x - p.at.x;
    const dz = p.bridge.from.z - p.at.z;
    assert.ok(perto(Math.hypot(dx, dz), 0.9), `${p.key}: a ponte não começa à porta (${Math.hypot(dx, dz)})`);
    assert.ok(perto(dx * p.dir.z - dz * p.dir.x, 0), `${p.key}: a ponte sai enviesada da porta`);
    // acaba no bordo do pod do Cérebro (num canto ou no meio de um lado, nunca a flutuar)
    assert.ok(naBorda(p.bridge.to.x, ATRIO.x) || naBorda(p.bridge.to.z, ATRIO.z),
      `${p.key}: a ponte não chega ao pod do Cérebro (${p.bridge.to.x},${p.bridge.to.z})`);
    assert.ok(perto(p.bridge.len, Math.hypot(p.bridge.to.x - p.bridge.from.x, p.bridge.to.z - p.bridge.from.z)),
      `${p.key}: o comprimento da ponte não é o da linha recta`);
    assert.ok(p.bridge.len > 3, `${p.key}: a ponte é curta demais`);
    // e o `atrium` é o ponto de chegada
    assert.deepEqual(p.atrium, p.bridge.to);
  }
});

test('a ponte não atravessa a sala nem corre por dentro do pod do Cérebro', () => {
  for (const p of doorPlans(LAYOUT, ATRIO)) {
    const L = LAYOUT[p.key];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = p.bridge.from.x + (p.bridge.to.x - p.bridge.from.x) * t;
      const z = p.bridge.from.z + (p.bridge.to.z - p.bridge.from.z) * t;
      const dentroDaSala = Math.abs(x - L.pos[0]) < L.w / 2 - 1e-6
        && Math.abs(z - L.pos[1]) < L.d / 2 - 1e-6;
      assert.equal(dentroDaSala, false, `${p.key}: a ponte entra na sala em (${x.toFixed(2)},${z.toFixed(2)})`);
      // o pod do Cérebro só pode ser tocado no fim (é lá que se chega)
      if (t < 0.999) {
        const dentroDoCerebro = Math.abs(x) < ATRIO.x - 1e-6 && Math.abs(z) < ATRIO.z - 1e-6;
        assert.equal(dentroDoCerebro, false, `${p.key}: a ponte atravessa o pod do Cérebro`);
      }
    }
  }
});

test('com parede, vão; sem parede, anteparo — e as seis portas caem em sítios diferentes', () => {
  const ps = doorPlans(LAYOUT, ATRIO);
  for (const p of ps) {
    const comParede = p.side === '-x' || p.side === '-z';   // as paredes estão sempre no lado oculto
    assert.equal(p.walled, comParede, `${p.key}: o lado ${p.side} não devia ser ${p.walled ? 'de parede' : 'aberto'}`);
    assert.equal(p.screen, !comParede, `${p.key}: o anteparo não corresponde ao lado aberto`);
    if (comParede) assert.equal(p.openingSide, p.side, `${p.key}: o vão não está no pano da porta`);
    else assert.equal(p.openingSide, null, `${p.key}: um lado aberto não tem vão para cortar`);
  }
  assert.equal(ps.filter((p) => p.screen).length, 3, 'metade das salas devia ter a porta no lado aberto');
  const sitios = new Set(ps.map((p) => `${p.at.x}|${p.at.z}`));
  assert.equal(sitios.size, ps.length, 'duas salas ficaram com a porta no mesmo sítio');
});

test('a planta não depende do estado: chamar duas vezes dá o mesmo, e não estraga o LAYOUT', () => {
  const antes = JSON.stringify(LAYOUT);
  const a = doorPlans(LAYOUT, ATRIO);
  const b = doorPlans(LAYOUT, ATRIO);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(LAYOUT), antes, 'o LAYOUT foi alterado por engano');
  assert.deepEqual(doorPlan('sales', LAYOUT, ATRIO), a.find((p) => p.key === 'sales'));
});

test('o átrio é um argumento: com um átrio maior, as pontes acabam mais longe', () => {
  const grande = doorPlans(LAYOUT, { x: 12, z: 12 });
  for (const p of grande) {
    assert.ok(naBorda(p.bridge.to.x, 12) || naBorda(p.bridge.to.z, 12),
      `${p.key}: a ponte não acaba no átrio maior`);
  }
  const normal = doorPlans(LAYOUT, ATRIO);
  const soma = (ps) => ps.reduce((n, p) => n + p.bridge.len, 0);
  // um átrio maior chega mais perto das salas: as pontes encurtam (é a prova de que o átrio é lido)
  assert.ok(soma(grande) < soma(normal), 'um átrio maior devia encurtar as pontes');
});

test('uma sala que não existe é um erro, não um NaN', () => {
  assert.throws(() => doorPlan('nao-existe', LAYOUT, ATRIO), /sala desconhecida/);
});
