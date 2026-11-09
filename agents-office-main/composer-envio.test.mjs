/* ===========================================================================
   1.79.0 · O ENVIO QUE NÃO VOLTA — E O CAMPO QUE NÃO MORRE (9 nov 2026)

   O dono, no ORBITA DIRECTOR:

     «depois da primeira pergunta ele buga e já não aceita escrever mais»

   O caminho estava no compositor: enquanto o `onSubmit` estava à espera,
   `state.busy` ficava a `true` para sempre. A seta desactivava-se, o Enter
   deixava de fazer nada, e se a resposta nunca chegasse só recarregar a página
   resolvia. Um cartão que parece partido é pior do que um erro.

   O que aqui se prova — contra o markup A SÉRIO (o `src/shell.html`, o mesmo
   que vai para produção) e um DOM de verdade (jsdom):

     · o campo aceita texto enquanto se espera;
     · a espera é visível, com segundos, e há um botão Parar;
     · o prazo do cartão liberta-o sozinho, com uma frase honesta;
     · um Enter durante a espera explica-se em vez de não fazer nada;
     · o pedido é abortado a sério quando se carrega em Parar;
     · o campo não colapsa para 0 px quando está escondido.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { initComposer, PRAZO_ENVIO_MS, AVISO_LENTO_MS } from './src/composer.js';

const SHELL = fs.readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');

/** Monta o cartão a partir do shell real, sem scripts e sem rede. */
function montar({ onSubmit, prazoMs } = {}) {
  const dom = new JSDOM(SHELL.replace('<!--APP-->', ''), { url: 'https://exemplo.pt/' });
  const { window } = dom;
  const vistos = [];
  window.fetch = async () => { vistos.push('fetch'); return { ok: false, status: 404, json: async () => ({}), text: async () => '' }; };
  const antes = globalThis.fetch;
  globalThis.fetch = window.fetch;
  const c = initComposer({
    doc: window.document,
    storage: null,
    prazoMs,
    onSubmit: onSubmit || (async () => { vistos.push('enviado'); }),
  });
  return { c, window, doc: window.document, vistos, restaurar: () => { globalThis.fetch = antes; } };
}

const escrever = (doc, texto) => {
  const i = doc.getElementById('mIn');
  i.value = texto;
  i.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  return i;
};
const clicarEnviar = (doc) => doc.getElementById('mSend').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('1.79.0 · o cartão nunca fica preso: a escrita continua e a espera é visível', async () => {
  let resolver;
  const { c, doc, restaurar } = montar({
    onSubmit: () => new Promise((r) => { resolver = r; }),
  });
  try {
    assert.ok(c, 'o compositor ligou-se ao markup do shell');
    const campo = escrever(doc, 'primeira pergunta');
    assert.equal(doc.getElementById('mSend').disabled, false);
    clicarEnviar(doc);
    await esperar(30);

    /* 1 · a espera está escrita no cartão */
    const linha = doc.getElementById('mcWait');
    assert.equal(linha.hidden, false, 'a linha da espera aparece');
    assert.match(linha.textContent, /à espera da resposta/);
    assert.match(linha.textContent, /0 s|1 s/);

    /* 2 · a seta continua a ser uma seta: apagada com o campo vazio. O Parar tem
       o seu próprio botão, escrito, na linha da espera (1.79.1). */
    const seta = doc.getElementById('mSend');
    assert.equal(seta.disabled, true, 'sem texto, a seta está apagada — não é um travão disfarçado');
    assert.equal(seta.getAttribute('aria-label'), 'enviar mensagem');
    assert.match(linha.textContent, /Parar/, 'o Parar está escrito na linha da espera');

    /* 3 · o campo aceita texto (era isto que o dono não conseguia) */
    const campo2 = doc.getElementById('mIn');
    campo2.value = 'segunda pergunta';
    campo2.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    assert.equal(campo2.value, 'segunda pergunta');
    assert.equal(campo2.disabled, false, 'o campo nunca é desactivado durante a espera');

    /* 4 · um Enter aqui explica-se em vez de não fazer nada */
    campo2.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await esperar(10);
    assert.match(doc.getElementById('mcToast').textContent, /Ainda estou à espera/);

    /* 5 · Parar solta o cartão e aborta o pedido */
    doc.querySelector('#mcWait [data-parar]').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await esperar(10);
    assert.equal(doc.getElementById('mcWait').hidden, true, 'a linha da espera sai');
    assert.equal(c.state().busy, false);
    assert.match(doc.getElementById('mcToast').textContent, /Parado/);
    resolver?.();
  } finally { restaurar(); }
});

test('1.79.0 · o sinal do Parar chega ao pedido e é abortado', async () => {
  let sinal = null;
  const { doc, restaurar } = montar({ onSubmit: (texto, meta, opts) => { sinal = opts?.signal; return new Promise(() => {}); } });
  try {
    escrever(doc, 'ola');
    clicarEnviar(doc);
    await esperar(20);
    assert.ok(sinal, 'o envio recebe um AbortSignal');
    assert.equal(sinal.aborted, false);
    doc.querySelector('#mcWait [data-parar]').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await esperar(10);
    assert.equal(sinal.aborted, true, 'carregar em Parar aborta a ligação a sério');
  } finally { restaurar(); }
});

test('1.79.0 · o prazo do cartão liberta-o sozinho e diz isso', async () => {
  const { c, doc, restaurar } = montar({ prazoMs: 60, onSubmit: () => new Promise(() => {}) });
  try {
    escrever(doc, 'uma pergunta que fica sem resposta');
    clicarEnviar(doc);
    await esperar(20);
    assert.equal(c.state().busy, true);
    await esperar(80);
    assert.equal(c.state().busy, false, 'passado o prazo, o cartão liberta-se');
    assert.equal(doc.getElementById('mcWait').hidden, true);
    assert.match(doc.getElementById('mcToast').textContent, /não chegou em dois minutos|Parado/);
    /* e a seta volta a ser uma seta */
    assert.equal(doc.getElementById('mSend').getAttribute('aria-label'), 'enviar mensagem');
    assert.equal(doc.getElementById('mIn').value, 'uma pergunta que fica sem resposta', 'o texto não se perde');
  } finally { restaurar(); }
});

test('1.79.0 · o aviso de lentidão muda de frase aos 20 s', () => {
  assert.equal(AVISO_LENTO_MS, 20000);
  assert.equal(PRAZO_ENVIO_MS, 120000);
  assert.ok(PRAZO_ENVIO_MS > AVISO_LENTO_MS, 'primeiro avisa-se, só depois se desiste');
});

test('1.79.0 · depois de uma resposta, o cartão volta ao normal e limpa-se', async () => {
  let n = 0;
  const { c, doc, restaurar } = montar({ onSubmit: async () => { n += 1; } });
  try {
    escrever(doc, 'primeira');
    clicarEnviar(doc);
    await esperar(20);
    assert.equal(n, 1);
    assert.equal(c.state().busy, false);
    assert.equal(doc.getElementById('mIn').value, '', 'enviada, a mensagem sai do campo');
    /* e a segunda pergunta funciona — era aqui que «já não aceitava escrever» */
    escrever(doc, 'segunda');
    clicarEnviar(doc);
    await esperar(20);
    assert.equal(n, 2, 'a segunda pergunta é enviada a sério');
  } finally { restaurar(); }
});

test('1.79.0 · o campo não colapsa quando está escondido (scrollHeight a 0)', async () => {
  const { doc, restaurar } = montar({ onSubmit: async () => {} });
  try {
    const campo = doc.getElementById('mIn');
    /* escondido, o jsdom (como o browser) devolve scrollHeight 0 */
    doc.getElementById('mChat').style.display = 'none';
    Object.defineProperty(campo, 'offsetParent', { get: () => null, configurable: true });
    Object.defineProperty(campo, 'scrollHeight', { get: () => 0, configurable: true });
    campo.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    assert.notEqual(campo.style.height, '0px', 'o campo não pode ficar com 0 px de altura');
    assert.ok(!campo.style.height || /^[2-9]\dpx$/.test(campo.style.height));
  } finally { restaurar(); }
});
