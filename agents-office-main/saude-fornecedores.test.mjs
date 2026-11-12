/* 1.87.1 · o alerta quando um fornecedor cai (A5). Prova: 3 falhas seguidas com a
   última nas 24 h → «em baixo»; um sucesso devolve «ok»; 1–2 falhas não alertam;
   sem pedidos recentes não há alerta; o alerta chega a /ia/uso, a /ops/falhas e ao ecrã. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { saudeDosFornecedores, MINIMO_FALHAS_SEGUIDAS } from './api/_ia/saude.mjs';
import { resumoDeUso } from './api/_ia/painel.mjs';
import { painelDeFalhas } from './api/_falhas.mjs';
import { alertasDeFornecedores, cartaoFalhas } from './src/ia.js';

const AGORA = Date.parse('2026-10-25T12:00:00Z');
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const esc = (x) => x;
const linha = (fornecedor, horasAtras, ok, extra = {}) => ({
  fornecedor, ok, criado: iso(AGORA - horasAtras * H), modelo: 'm', erro: ok ? null : 'rate limit', ...extra,
});

test('1.87.1 · o mínimo de falhas seguidas é 3', () => {
  assert.equal(MINIMO_FALHAS_SEGUIDAS, 3);
});

test('1.87.1 · 3 falhas seguidas, a última há pouco → «em-baixo» e alerta', () => {
  const r = saudeDosFornecedores([
    linha('groq', 0.1, false), linha('groq', 0.2, false), linha('groq', 0.3, false),
    linha('groq', 5, true, { criado: iso(AGORA - 5 * H) }),
  ], { agora: AGORA });
  const g = r.fornecedores.find((f) => f.fornecedor === 'groq');
  assert.equal(g.estado, 'em-baixo');
  assert.equal(g.falhasSeguidas, 3);
  assert.equal(g.ultimoOk.quando, iso(AGORA - 5 * H), 'a última resposta boa é a real');
  assert.equal(r.alertas.length, 1);
  assert.equal(r.alertas[0].fornecedor, 'groq');
  assert.match(r.alertas[0].mensagem, /groq falhou 3 pedidos seguidos/);
});

test('1.87.1 · 1 ou 2 falhas seguidas → «a-falhar», sem alerta', () => {
  const r = saudeDosFornecedores([linha('ovh', 0.1, false), linha('ovh', 0.2, false), linha('ovh', 0.3, true)], { agora: AGORA });
  assert.equal(r.fornecedores[0].estado, 'a-falhar');
  assert.equal(r.fornecedores[0].falhasSeguidas, 2);
  assert.equal(r.alertas.length, 0);
});

test('1.87.1 · um sucesso no meio interrompe a contagem: não há alerta', () => {
  const r = saudeDosFornecedores([
    linha('llm7', 0.1, false), linha('llm7', 0.2, true), linha('llm7', 0.3, false), linha('llm7', 0.4, false), linha('llm7', 0.5, false),
  ], { agora: AGORA });
  assert.equal(r.fornecedores[0].falhasSeguidas, 1, 'a sequência conta a partir da mais recente');
  assert.equal(r.alertas.length, 0);
});

test('1.87.1 · o fornecedor volta a responder → sai do alerta sozinho', () => {
  const r = saudeDosFornecedores([
    linha('groq', 0.1, true),
    linha('groq', 0.2, false), linha('groq', 0.3, false), linha('groq', 0.4, false),
  ], { agora: AGORA });
  assert.equal(r.fornecedores[0].estado, 'ok');
  assert.equal(r.alertas.length, 0);
});

test('1.87.1 · falhas antigas (mais de 24 h) não alertam: o fornecedor fica «parado»', () => {
  const r = saudeDosFornecedores([linha('pollinations', 30, false), linha('pollinations', 31, false), linha('pollinations', 32, false)], { agora: AGORA });
  assert.equal(r.fornecedores[0].estado, 'parado');
  assert.equal(r.alertas.length, 0);
});

test('1.87.1 · nunca respondeu bem nesta base: o alerta diz isso', () => {
  const r = saudeDosFornecedores([linha('tavily', 0.1, false), linha('tavily', 0.2, false), linha('tavily', 0.3, false)], { agora: AGORA });
  assert.match(r.alertas[0].mensagem, /nunca respondeu bem nesta base/);
  assert.equal(r.alertas[0].desde, null);
});

test('1.87.1 · dois fornecedores: só o que caiu aparece no alerta, e primeiro na lista', () => {
  const r = saudeDosFornecedores([
    linha('groq', 0.1, true), linha('ovh', 0.1, false), linha('ovh', 0.2, false), linha('ovh', 0.3, false),
  ], { agora: AGORA });
  assert.deepEqual(r.alertas.map((a) => a.fornecedor), ['ovh']);
  assert.equal(r.fornecedores[0].fornecedor, 'ovh', 'o que caiu vai para o topo');
});

test('1.87.1 · lista vazia ou linhas nulas não rebentam', () => {
  assert.deepEqual(saudeDosFornecedores([], { agora: AGORA }), { fornecedores: [], alertas: [] });
  assert.doesNotThrow(() => saudeDosFornecedores([null, undefined, linha('groq', 0.1, true)], { agora: AGORA }));
});

test('1.87.1 · /ia/uso (resumoDeUso) traz o heartbeat e o alerta', async () => {
  /* resumoDeUso usa o relógio real: as linhas têm de ser de agora, não de AGORA */
  const agoraReal = Date.now();
  const l = (h, ok) => ({ fornecedor: 'groq', ok, criado: new Date(agoraReal - h * H).toISOString(), modelo: 'm', erro: ok ? null : 'rate limit' });
  const u = await resumoDeUso([l(0.1, false), l(0.2, false), l(0.3, false)], {});
  assert.equal(u.saude[0].estado, 'em-baixo');
  assert.equal(u.alertas.length, 1);
});

test('1.87.1 · /ops/falhas traz o alerta, lido das mesmas linhas de uso', async () => {
  const repo = {
    tarefas: { list: async () => [] },
    ia: {
      uso: { recentes: async () => [linha('groq', 0.1, false), linha('groq', 0.2, false), linha('groq', 0.3, false)] },
      runs: { listar: async () => [] },
    },
    geracoes: { porPeriodo: async () => [] },
    mensagens: { list: async () => [] },
  };
  const p = await painelDeFalhas(repo, { agora: AGORA });
  assert.equal(p.alertas.length, 1);
  assert.equal(p.alertas[0].fornecedor, 'groq');
  assert.equal(p.porOrigem.find((o) => o.id === 'modelo').total, 3);
});

test('1.87.1 · o ecrã desenha o alerta com a palavra «caiu» e o último erro', () => {
  const html = alertasDeFornecedores([{ fornecedor: 'groq', falhasSeguidas: 3, desde: null, erro: 'rate limit' }], { esc, when: esc });
  assert.match(html, /groq caiu\./);
  assert.match(html, /3 pedidos seguidos falharam/);
  assert.match(html, /Último erro: rate limit/);
  assert.match(html, /role="alert"/);
  assert.equal(alertasDeFornecedores([], { esc, when: esc }), '');
  assert.equal(alertasDeFornecedores(undefined, { esc, when: esc }), '');
});

test('1.87.1 · o cartão «Falhas» põe o alerta por cima das contagens', () => {
  const html = cartaoFalhas({
    janelaDias: 7, total: 3, ultimas24h: 3, origensSemLeitura: 0, frase: '3 falha(s)', porOrigem: [], recentes: [],
    alertas: [{ fornecedor: 'ovh', falhasSeguidas: 3, desde: null, erro: 'timeout' }],
  }, { esc, when: esc });
  assert.match(html, /ovh caiu\./);
  assert.ok(html.indexOf('ovh caiu.') < html.indexOf('<table'), 'o alerta tem de vir antes da tabela');
});
