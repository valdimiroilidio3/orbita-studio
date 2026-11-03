import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAVE_MODO, MODOS, lerModo, gravarModo, modoInicial, rotuloDoBotao,
  proximoModo, fraseDoModo,
} from './src/escritorio-modo.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m };
};

test('1 · a escolha do dono manda em tudo', () => {
  const a = modoInicial({ guardado: '3d', toque: true, estreito: true, movimentoReduzido: true });
  assert.equal(a.modo, '3d');
  assert.equal(a.decididoPor, 'dono');
  const b = modoInicial({ guardado: 'planta', toque: false, estreito: false });
  assert.equal(b.modo, 'planta');
  assert.match(b.porque, /escolheste a planta/);
});

test('2 · quem pediu menos movimento não leva uma cena animada por omissão', () => {
  const r = modoInicial({ movimentoReduzido: true });
  assert.equal(r.modo, 'planta');
  assert.equal(r.decididoPor, 'movimento');
  assert.match(r.porque, /menos movimento/);
});

test('3 · no telemóvel a planta abre primeiro', () => {
  const r = modoInicial({ toque: true, estreito: true });
  assert.equal(r.modo, 'planta');
  assert.match(r.porque, /telemóvel/);
  const tablet = modoInicial({ toque: true, estreito: false });
  assert.equal(tablet.modo, 'planta');
});

test('4 · no computador o escritório abre em 3D, como sempre', () => {
  const r = modoInicial({ toque: false, estreito: false });
  assert.equal(r.modo, '3d');
  assert.equal(r.decididoPor, 'computador');
});

test('5 · ecrã estreito com rato não é telemóvel', () => {
  const r = modoInicial({ toque: false, estreito: true });
  assert.equal(r.modo, '3d');
  assert.equal(r.decididoPor, 'ecra');
});

test('6 · sem armazém (navegação privada) não se promete memória', () => {
  const r = modoInicial({ semArmazem: true });
  assert.equal(r.modo, '3d');
  assert.match(r.porque, /não guarda preferências/);
});

test('7 · ler/gravar: só modos conhecidos, e um armazém avariado não parte nada', () => {
  assert.equal(CHAVE_MODO, 'orbita.oficina.modo');
  const s = mem();
  assert.equal(lerModo(s), null, 'sem nada guardado não há escolha');
  assert.equal(gravarModo(s, 'planta'), true);
  assert.equal(lerModo(s), 'planta');
  s.setItem(CHAVE_MODO, 'qualquer coisa');
  assert.equal(lerModo(s), null, 'um valor desconhecido vale «sem escolha»');
  assert.equal(gravarModo(s, 'outro'), false);
  assert.equal(gravarModo(null, 'planta'), false);
  const avariado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.equal(lerModo(avariado), null);
  assert.equal(gravarModo(avariado, '3d'), false);
});

test('8 · o botão diz o que vai fazer, não onde estás', () => {
  const naPlanta = rotuloDoBotao('planta');
  assert.match(naPlanta.texto, /3D/);
  assert.match(naPlanta.aria, /3D/);
  const no3d = rotuloDoBotao('3d');
  assert.match(no3d.texto, /Planta/);
  assert.match(no3d.titulo, /planta 2D/);
});

test('9 · alternar troca de vista e o caminho de volta existe sempre', () => {
  assert.equal(proximoModo('planta'), '3d');
  assert.equal(proximoModo('3d'), 'planta');
  assert.equal(proximoModo(proximoModo('3d')), '3d');
  for (const m of ['planta', '3d']) {
    assert.match(fraseDoModo(m), /3D|Planta/, `a frase de ${m} diz onde está a outra vista`);
  }
  assert.deepEqual(Object.keys(MODOS).sort(), ['3d', 'planta']);
});

test('10 · em qualquer caso, o 3D existe como opção', () => {
  for (const caso of [{}, { toque: true }, { estreito: true }, { movimentoReduzido: true }, { guardado: 'planta' }]) {
    const r = modoInicial(caso);
    assert.ok(['planta', '3d'].includes(r.modo));
    assert.ok(r.porque.length > 10, 'a decisão é sempre explicada');
  }
});

/* ---------------------------------------------------------------
   As ligações ao command centre (o que faz o botão e o que faz a pinça).
   Estes três testes leem a fonte: o escritório 3D exige WebGL, e provar o
   gesto à unha negra num browser falso só provaria o browser falso.
   --------------------------------------------------------------- */
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');

test('11 · o botão da vista guarda a escolha e diz o que vai fazer', () => {
  assert.match(MAIN, /import \{[^}]*modoInicial[^}]*\} from '\.\/escritorio-modo\.js'/);
  assert.match(MAIN, /function alternarVista\(\)/);
  assert.match(MAIN, /gravarModo\(armazemDoModo\(\), modoOficina\)/);
  assert.match(MAIN, /setAttribute\('aria-pressed'/, 'o botão anuncia o estado');
  assert.match(MAIN, /dataset\.modo = modoOficina/);
  assert.match(MAIN, /if \(modoOficina === 'planta'\) \{ oficina\.abrir\(\)/, 'no telemóvel a planta abre no arranque');
  assert.match(MAIN, /else if \(e\.key === 'm' \|\| e\.key === 'M'\) alternarVista\(\)/, 'a tecla M passa pelo mesmo caminho');
});

test('12 · a pinça está ligada ao canvas e usa a conta testada', () => {
  assert.match(MAIN, /zoomDaPinca/);
  assert.match(MAIN, /if \(dedos\.size === 2\)/);
  assert.match(MAIN, /pinca = \{ dist: distanciaDe\(\), zoom: view\.zoom \}/);
  assert.match(MAIN, /if \(pinca && dedos\.size >= 2\)/, 'o move da pinça tem caminho próprio');
  assert.match(MAIN, /view\.zoom = r\.zoom;/, 'o zoom da pinça aplica-se à câmara');
  assert.match(MAIN, /pointercancel/, 'um dedo cancelado não deixa a pinça pendurada');
});

test('13 · o aviso do modo existe e explica onde está a outra vista', () => {
  assert.match(SHELL, /id="modoOficina"/);
  assert.match(SHELL, /aria-live="polite"/);
  assert.match(SHELL, /\[data-modo="planta"\]/);
  assert.match(SHELL, /max-width: 640px[\s\S]{0,200}#zoomCtl button \{ width: 52px; height: 52px; \}/, 'no telemóvel o alvo cresce');
  assert.match(MAIN, /fraseDoModo\(modoOficina\)/);
});
