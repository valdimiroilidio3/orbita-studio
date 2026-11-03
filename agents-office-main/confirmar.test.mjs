/* ===========================================================================
   3 nov 2026 · A PERGUNTA ANTES DE ESTRAGAR ALGO — provas.

   O que se prova aqui não é «aparece uma caixa»: é que nenhuma das quatro
   acções que apagam trabalho avança sem um «sim» explícito, que Esc e o véu
   são o mesmo que cancelar, que o foco começa no botão que não estraga nada e
   volta para onde estava, e que o texto de quem chama nunca vira HTML.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { confirmar, htmlDaConfirmacao } from './src/confirmar.js';

/** Monta um documento com um botão que abre o diálogo, como no ecrã. */
function cenario() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><button id="abre">apagar</button></body></html>',
    { pretendToBeVisual: true });
  const doc = dom.window.document;
  globalThis.document = doc;
  const abre = doc.getElementById('abre');
  abre.focus();
  return { dom, doc, abre };
}

const limpar = () => { delete globalThis.document; };

test('confirmar: o «sim» devolve true e o «não» devolve false', async () => {
  const { doc, abre } = cenario();
  try {
    const p1 = confirmar({ titulo: 'Apagar?', texto: 'Perde-se.', confirmar: 'Apagar' });
    const caixa = doc.querySelector('.cf-caixa');
    assert.ok(caixa, 'o diálogo tem de aparecer');
    assert.equal(caixa.getAttribute('role'), 'alertdialog');
    assert.equal(caixa.getAttribute('aria-modal'), 'true');
    assert.equal(doc.getElementById('cf-t').textContent, 'Apagar?');
    assert.equal(doc.getElementById('cf-d').textContent, 'Perde-se.');
    doc.querySelector('[data-cf-sim]').click();
    assert.equal(await p1, true);
    assert.equal(doc.querySelector('.cf-berma'), null, 'o diálogo sai do ecrã depois de responder');

    const p2 = confirmar({ titulo: 'Apagar?' });
    doc.querySelector('[data-cf-nao]').click();
    assert.equal(await p2, false);
    assert.equal(abre.isConnected, true);
  } finally { limpar(); }
});

test('confirmar: Esc e o véu são «não» — e o foco volta para quem perguntou', async () => {
  const { dom, doc, abre } = cenario();
  try {
    const p1 = confirmar({ titulo: 'Apagar?', perigo: true });
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(await p1, false, 'Esc não pode aceitar a pergunta');
    assert.equal(doc.activeElement, abre, 'o foco tem de voltar ao botão de onde veio');

    const p2 = confirmar({ titulo: 'Apagar?' });
    doc.querySelector('.cf-berma').click(); // o véu é o próprio fundo do diálogo
    assert.equal(await p2, false, 'tocar fora do diálogo é desistir, não aceitar');

    /* e um clique dentro da caixa não conta como «fora» (senão o «sim» nunca chegava) */
    const p3 = confirmar({ titulo: 'Apagar?' });
    const caixa = doc.querySelector('.cf-caixa');
    caixa.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(doc.querySelector('.cf-berma') !== null, true, 'um clique na caixa não fecha nada');
    doc.querySelector('[data-cf-sim]').click();
    assert.equal(await p3, true);
  } finally { limpar(); }
});

test('confirmar: com perigo o foco começa no botão que não estraga nada', async () => {
  const { doc } = cenario();
  try {
    const p = confirmar({ titulo: 'Descartar?', confirmar: 'Descartar', cancelar: 'Manter', perigo: true });
    assert.equal(doc.activeElement, doc.querySelector('[data-cf-nao]'), 'o Enter não pode apagar por distracção');
    doc.querySelector('[data-cf-nao]').click();
    await p;

    const p2 = confirmar({ titulo: 'Repor?', confirmar: 'Repor' });
    assert.equal(doc.activeElement, doc.querySelector('[data-cf-sim]'), 'sem perigo, o foco vai para o «sim»');
    doc.querySelector('[data-cf-nao]').click();
    await p2;
  } finally { limpar(); }
});

test('confirmar: Tab anda só entre os dois botões (o resto da página está por trás do véu)', async () => {
  const { dom, doc } = cenario();
  try {
    const p = confirmar({ titulo: 'Apagar?', confirmar: 'Apagar', cancelar: 'Manter' });
    const sim = doc.querySelector('[data-cf-sim]'), nao = doc.querySelector('[data-cf-nao]');
    sim.focus();
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    assert.equal(doc.activeElement, nao, 'do último volta ao primeiro');
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    assert.equal(doc.activeElement, sim, 'e o Shift+Tab faz o caminho contrário');
    nao.click();
    await p;
  } finally { limpar(); }
});

test('confirmar: o texto de quem pergunta nunca vira HTML', () => {
  const html = htmlDaConfirmacao({ titulo: '<img src=x onerror=alert(1)>', texto: 'a & b <b>c</b>', perigo: true });
  assert.doesNotMatch(html, /<img/, 'o título tem de vir escapado');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /a &amp; b &lt;b&gt;c&lt;\/b&gt;/);
  // e o diálogo anuncia-se ao leitor de ecrã
  assert.match(html, /aria-labelledby="cf-t"/);
  assert.match(html, /aria-describedby="cf-d"/);
  assert.match(html, /cf-perigo/, 'a variante perigosa tem de se distinguir');
});

test('confirmar: sem DOM comporta-se como antes (pergunta ao browser)', async () => {
  const antes = globalThis.confirm;
  let perguntou = '';
  globalThis.confirm = (q) => { perguntou = q; return false; };
  try {
    assert.equal(await confirmar({ titulo: 'Apagar?', texto: 'Perde-se.' }), false);
    assert.match(perguntou, /Apagar\?/);
    assert.match(perguntou, /Perde-se\./, 'sem DOM, o texto também tem de chegar a quem pergunta');
  } finally { globalThis.confirm = antes; }
});

test('as cinco perguntas que apagam ou substituem trabalho usam o diálogo da casa', () => {
  const ficheiros = readdirSync(new URL('./src', import.meta.url)).filter((f) => f.endsWith('.js'));
  const comConfirm = [];
  for (const f of ficheiros) {
    if (f === 'confirmar.js') continue; // é o único sítio onde o `confirm` nativo é permitido
    const src = readFileSync(new URL(`./src/${f}`, import.meta.url), 'utf8');
    if (/[^.\w]confirm\s*\(/.test(src) || /globalThis\.confirm/.test(src)) comConfirm.push(f);
  }
  assert.deepEqual(comConfirm, [], 'nenhum ecrã volta a bloquear a página com o confirm do browser');

  for (const [f, quantas] of [['briefing.js', 3], ['media.js', 1], ['mesa.js', 1]]) {
    const src = readFileSync(new URL(`./src/${f}`, import.meta.url), 'utf8');
    assert.match(src, /from '\.\/confirmar\.js'/, `${f} tem de importar o diálogo da casa`);
    assert.equal((src.match(/await confirmar\(\{/g) || []).length, quantas,
      `${f}: ${quantas} pergunta(s) pelo diálogo da casa`);
  }
});
