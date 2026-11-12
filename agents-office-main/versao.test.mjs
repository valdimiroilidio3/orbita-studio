/* 1.89.1 · a página diz de que build é, e avisa quando o servidor já vai noutra versão.
   Antes, o único número visível era «Órbita Project 1.0.0», fixo no código. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avaliarVersao, buildDaPagina, verificarVersao } from './src/versao.js';

test('1.89.1 · mesma versão: a página diz build e não avisa', () => {
  assert.deepEqual(avaliarVersao('1.89.1', '1.89.1'), { estado: 'igual', texto: 'build 1.89.1' });
});

test('1.89.1 · versão diferente: avisa e pede para recarregar, com as duas', () => {
  const v = avaliarVersao('1.88.0', '1.89.1');
  assert.equal(v.estado, 'atrasada');
  assert.match(v.texto, /build 1\.88\.0/);
  assert.match(v.texto, /servidor está em 1\.89\.1/);
});

test('1.89.1 · sem resposta do servidor, ou sem build escrito, não se inventa uma comparação', () => {
  assert.equal(avaliarVersao('1.89.1', '').estado, 'desconhecida');
  assert.equal(avaliarVersao('__VERSAO__', '1.89.1').estado, 'desconhecida', 'um build que não foi injetado não conta');
});

function docFalso(build) {
  const el = { textContent: '', dataset: { versao: build }, classList: { toggle(n, on) { this.n = [n, on]; } } };
  return { getElementById: (id) => (id === 'lcBuild' ? el : null), el };
}

test('1.89.1 · verificarVersao escreve no rodapé e marca o atraso', async () => {
  const doc = docFalso('1.88.0');
  const r = await verificarVersao({ doc, fetchImpl: async (url, opts) => {
    assert.equal(url, '/api/health', 'caminho relativo, como o resto da página');
    assert.equal(opts.cache, 'no-store');
    return { json: async () => ({ versao: '1.89.1' }) };
  } });
  assert.equal(r.estado, 'atrasada');
  assert.match(doc.el.textContent, /servidor está em 1\.89\.1/);
  assert.deepEqual(doc.el.classList.n, ['atras', true]);
});

test('1.89.1 · sem rede a página não parte: fica desconhecida', async () => {
  const doc = docFalso('1.89.1');
  const r = await verificarVersao({ doc, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r.estado, 'desconhecida');
  assert.equal(doc.el.textContent, 'build 1.89.1');
});

test('1.89.1 · o rodapé tem o marcador do build (o build.mjs o troca pela versão)', () => {
  const shell = readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');
  assert.match(shell, /id="lcBuild" data-versao="__VERSAO__"/);
  assert.equal(buildDaPagina({ getElementById: () => null }), '');
});
