// 1.89.2 · a reação à aprovação chega ao corpo do posto.
//
// Antes: `resolveApproval` escrevia `cheerUntil` / `slumpUntil`, e nenhum código
// do ciclo de desenho os lia. Ao aprovar, o agente não festejava; ao recusar, não
// se abatia. Só aparecia o emoji. Estes testes leem o `main.js` e provam que o
// ciclo, antes de «a trabalhar», aplica as duas poses enquanto a janela dura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MAIN = fs.readFileSync(path.join(AQUI, 'src', 'main.js'), 'utf8');
const AVATAR = fs.readFileSync(path.join(AQUI, 'src', 'avatar.js'), 'utf8');

test('aprovar e recusar escrevem as janelas que o ciclo lê', () => {
  assert.match(MAIN, /r\.cheerUntil = now \+ 2400/);
  assert.match(MAIN, /r\.slumpUntil = now \+ 2600/);
  assert.match(MAIN, /now < \(r\.cheerUntil \|\| 0\)/, 'o ciclo tem de ler cheerUntil');
  assert.match(MAIN, /now < \(r\.slumpUntil \|\| 0\)/, 'o ciclo tem de ler slumpUntil');
});

test('a pose de festejar e a de abater-se existem no avatar e são chamadas pelo ciclo', () => {
  assert.match(AVATAR, /case 'cheer':/);
  assert.match(AVATAR, /case 'slump':/);
  assert.match(MAIN, /poseWork\(r\.person, 'cheer'/);
  assert.match(MAIN, /poseWork\(r\.person, 'slump'/);
});

test('a reação tem prioridade sobre «a trabalhar» e sobre a sala a ouvir', () => {
  const trip = MAIN.indexOf('if (r.trip) { crew.tick(r, now, dt); continue; }');
  const cheer = MAIN.indexOf("now < (r.cheerUntil || 0)");
  const slump = MAIN.indexOf("now < (r.slumpUntil || 0)");
  const ouvir = MAIN.indexOf('crew.huddle(r.a.dept)');
  const trabalho = MAIN.indexOf("if (r.state === 'working') {", cheer);
  assert.ok(trip > 0 && trip < cheer, 'quem está a caminho do Cérebro continua a ser conduzido pelo crew');
  assert.ok(cheer > 0 && slump > cheer, 'festejar vem antes de abater-se');
  assert.ok(cheer < ouvir, 'uma aprovação festeja mesmo durante a reunião (a janela é de 2,4 s)');
  assert.ok(trabalho > slump, 'a reação ganha a «a trabalhar»');
});

test('a reação liberta as teclas do posto (sem tecla premida a meio da festa)', () => {
  const i = MAIN.indexOf("now < (r.cheerUntil || 0)");
  const bloco = MAIN.slice(i, i + 900);
  assert.match(bloco, /driveDesk\(r, null, now, 0, dt\)/);
});
