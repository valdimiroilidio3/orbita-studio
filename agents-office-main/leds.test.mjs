// A luz que acende — 1.40.0 (28 out 2026).
// Puro: sem three, sem DOM. Prova-se aqui que a intensidade segue o trabalho real
// e que o arranque é escalonado — que é o que o dono pediu («leds acendendo
// realmente»), sem que a cena passe a ser um vídeo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LUZ, alvo, respirar, acender, aproximar, luzDaSala, fimDoArranque } from './src/leds.js';

test('1 · sala vazia não está apagada — fica em repouso', () => {
  assert.equal(alvo({}), LUZ.repouso);
  assert.ok(LUZ.repouso > 0.2 && LUZ.repouso < 0.5, 'o repouso tem de se ver, sem ofuscar');
});

test('2 · com trabalho a sala acende, e mais tarefas acendem mais (até ao tecto)', () => {
  const uma = alvo({ live: 1 });
  const tres = alvo({ live: 3 });
  assert.equal(uma, LUZ.acesa);
  assert.ok(tres > uma);
  assert.ok(alvo({ live: 40 }) <= LUZ.tecto, 'nunca passa o tecto');
});

test('3 · só à espera de aprovação acende menos do que a trabalhar', () => {
  assert.ok(alvo({ waiting: 2 }) < alvo({ live: 2 }));
  assert.ok(alvo({ waiting: 2 }) > LUZ.repouso, 'à espera também é vida');
});

test('4 · o respirar fica perto de 1 e não passa a amplitude', () => {
  for (const t of [0, 500, 1234, 2600, 4199, 5000]) {
    const r = respirar(t);
    assert.ok(r >= 1 - LUZ.pulso - 1e-9 && r <= 1 + LUZ.pulso + 1e-9, `respirar(${t}) = ${r}`);
  }
  assert.equal(respirar(1234, { calmo: true }), 1, 'com «menos movimento» não respira');
});

test('5 · o arranque é escalonado: cada sala acende à sua vez, e a última só no fim', () => {
  const inicio = 1000;
  assert.equal(acender(1000, { inicio, atraso: 0 }), 0, 'no instante zero ainda está apagada');
  assert.equal(acender(1000 + LUZ.acender + 10, { inicio, atraso: 0 }), 1, 'passado o tempo, acesa');
  const cedo = acender(1000 + 200, { inicio, atraso: 0 });
  assert.ok(cedo > 0 && cedo < 1, 'a meio da rampa está entre apagada e acesa');
  assert.equal(acender(1000 + 200, { inicio, atraso: 2000 }), 0, 'a sala com atraso ainda dorme');
  assert.ok(fimDoArranque(6, { inicio }) > inicio + LUZ.acender);
});

test('6 · o cintilar de arranque não sai dos limites [0,1]', () => {
  for (let t = 0; t <= 1200; t += 13) {
    const v = acender(t, { inicio: 0 });
    assert.ok(v >= 0 && v <= 1, `acender(${t}) = ${v}`);
  }
});

test('7 · acender é mais rápido do que apagar, e a aproximação converge', () => {
  let v = 0;
  v = aproximar(v, 1, 100);
  const subiu = v;
  let w = 1;
  w = aproximar(w, 0, 100);
  /* comparar o PROGRESSO, não o valor: subir partiu de 0, descer partiu de 1 */
  assert.ok(subiu > 1 - w, `depois de 100 ms, subir avança mais (${subiu.toFixed(3)}) do que descer (${(1 - w).toFixed(3)})`);
  for (let i = 0; i < 200; i++) v = aproximar(v, 1, 16);
  assert.equal(v, 1, 'acaba exatamente no alvo (sem deriva)');
});

test('8 · luzDaSala junta tudo e começa apagada no arranque', () => {
  const zero = luzDaSala(0, { live: 2 }, { inicio: 0 });
  assert.equal(zero.valor, 0, 'no primeiro frame ainda não há luz');
  const depois = luzDaSala(2000, { live: 2 }, { inicio: 0 });
  assert.ok(depois.valor > LUZ.acesa * 0.9, 'passado o arranque está acesa');
  assert.ok(depois.valor <= LUZ.tecto * (1 + LUZ.pulso), 'e nunca acima do tecto com o respirar');
});
