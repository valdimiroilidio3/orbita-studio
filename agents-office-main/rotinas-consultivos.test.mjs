/* 1.88.0 · onze consultivos passam a ter rotina própria (A9 do alvo 1.0).
   Prova: 16 de 47 com trabalho (1.89.0: 18 de 49), nenhum posto com duas rotinas, nenhuma rotina
   com dois postos, cada pedido distinto e com o contexto real; e uma rotina sem
   resposta do modelo FALHA — não inventa o resultado. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { elencoBase, ROTINA } from './src/elenco.js';
import { ROTINAS, executarTarefa } from './api/_tarefas.mjs';

const NOVAS = ['oportunidade', 'triagem', 'consentimento', 'contrato', 'renovacao', 'crescimento',
  'seo_pagina', 'caso_estudo', 'plano_projeto', 'documentacao', 'seguranca'];

test('1.88.0 · o escritório tem 49 lugares (1.89.0: +2), e 18 têm trabalho próprio', () => {
  const e = elencoBase();
  assert.equal(e.total, 49, 'nenhum lugar novo: a sala não mudou');
  assert.equal(e.comRotina, 18); /* 1.89.0: + ata e faq */
  assert.equal(e.consultivos, 31);
});

test('1.88.0 · cada tipo de trabalho tem motor, posto e sala — e nenhum fica de fora', () => {
  for (const kind of NOVAS) {
    assert.ok(ROTINAS[kind], `${kind} sem rotina no motor`);
    assert.ok(ROTINA[kind], `${kind} sem posto no elenco`);
    assert.ok(ROTINA[kind].titulo, `${kind} sem título`);
  }
  assert.deepEqual(Object.keys(ROTINA).filter((k) => !ROTINAS[k]), []);
  assert.deepEqual(Object.keys(ROTINAS).filter((k) => !ROTINA[k]), []);
});

test('1.88.0 · não há dois agentes com a mesma rotina, nem um agente com duas', () => {
  const postos = Object.values(ROTINA).map((r) => r.posto).filter(Boolean);
  assert.equal(new Set(postos).size, postos.length, 'um posto com duas rotinas');
  const ids = new Set(elencoBase().agentes.map((a) => a.id));
  for (const p of postos) assert.ok(ids.has(p), `o posto «${p}» não é um dos 49 lugares`);
  const titulos = Object.values(ROTINA).map((r) => r.titulo);
  assert.equal(new Set(titulos).size, titulos.length, 'dois tipos com o mesmo título');
});

test('1.88.0 · cada pedido é distinto e pede português de Portugal com o contexto', () => {
  const textos = NOVAS.map((k) => ROTINAS[k].pedido('CONTEXTO-DE-TESTE'));
  assert.equal(new Set(textos).size, NOVAS.length, 'dois pedidos iguais');
  for (const t of textos) {
    assert.ok(t.includes('CONTEXTO-DE-TESTE'), 'o pedido tem de levar o contexto real');
    assert.match(t, /português de Portugal/);
    assert.match(t, /nada inventad|não inventes|inventar/i, 'tem de dizer para não inventar');
  }
});

test('1.88.0 · a rotina de um lead lê o lead da base', async () => {
  const repo = { leads: { byId: async () => ({ name: 'Oficina Teste', city: 'Lisboa', website: null }) }, projetos: { byId: async () => null } };
  let pedido = null;
  const motor = { pedir: async (_t, msgs) => { pedido = msgs[1].content; return { texto: 'Resposta de teste.', fornec: 'groq', modelo: 'm', tentativas: 1 }; } };
  const r = await executarTarefa({ repo, tarefa: { kind: 'renovacao', entity_id: 'l_1', entidade: 'lead' }, env: {}, motor });
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'succeeded');
  assert.match(pedido, /Oficina Teste/, 'o pedido não levou o lead real');
});

test('1.88.0 · sem resposta do modelo, a rotina FALHA — não inventa um resultado', async () => {
  const repo = { leads: { byId: async () => ({ name: 'X' }) }, projetos: { byId: async () => null } };
  const motor = { pedir: async () => ({ texto: '   ', fornec: 'groq', modelo: 'm' }) };
  const r = await executarTarefa({ repo, tarefa: { kind: 'triagem', entity_id: 'l_2', entidade: 'lead' }, env: {}, motor });
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'failed');
  assert.match(r.erro, /sem texto/);
});
