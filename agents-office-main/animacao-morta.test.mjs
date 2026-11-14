// Código morto de animação (auditoria, 14 nov): a pose de festejar/abater-se era escrita
// em `resolveApproval` mas nunca lida (revertida em 999b97f). Este teste prova que a escrita
// sem leitura não volta, que a reação por emoji continua, e que as animações ligadas a estado
// real (cfgLed, cfgPulse, cfgShimmer, apprIn) continuam no CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');

test('resolveApproval não escreve cheerUntil/slumpUntil (nada os lê desde 999b97f)', () => {
  assert.doesNotMatch(main, /\.(cheerUntil|slumpUntil)\s*=/);
});

test('resolveApproval mantém a reação visível por emoji', () => {
  const i = main.indexOf('function resolveApproval');
  assert.ok(i >= 0, 'resolveApproval existe');
  const corpo = main.slice(i, i + 4000);
  assert.match(corpo, /spawnEmote\(r, approved \? '✅' : '❌'\)/);
});

test('as animações ligadas a estado real continuam no CSS', () => {
  for (const nome of ['cfgLed', 'cfgPulse', 'cfgShimmer', 'apprIn']) {
    assert.match(shell, new RegExp(`@keyframes ${nome}\\b`), `@keyframes ${nome}`);
  }
});
