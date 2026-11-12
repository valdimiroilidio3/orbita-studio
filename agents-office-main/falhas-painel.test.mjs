/* 1.87.0 · o painel «Falhas» (A5). Prova: o que falhou, quantas vezes, a última
   falha real; uma origem sem leitura diz porquê; segredos não saem. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { painelDeFalhas, limparSegredos, ORIGENS } from './api/_falhas.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { createLocalApi } from './src/localapi.js';
import { cartaoFalhas, vistaIA } from './src/ia.js';

const AGORA = Date.parse('2026-10-25T12:00:00Z');
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();

function repoComFalhas(extra = {}) {
  return {
    tarefas: { list: async () => [
      { id: 't1', state: 'failed', kind: 'escritorio', title: 'Campanha', error: 'timeout ao modelo', finished_at: iso(AGORA - 2 * H) },
      { id: 't2', state: 'failed', kind: 'escritorio', title: 'Relatório', error: 'chave Bearer abcdef1234567890 inválida', finished_at: iso(AGORA - 9 * 24 * H) },
      { id: 't3', state: 'done', kind: 'escritorio', finished_at: iso(AGORA - H) },
      null,
    ] },
    ia: {
      uso: { recentes: async () => [
        { ok: false, fornecedor: 'groq', modelo: 'llama', erro: 'rate limit', criado: iso(AGORA - 5 * H) },
        { ok: true, fornecedor: 'groq', criado: iso(AGORA - H) },
      ] },
      runs: { listar: async () => [{ id: 'r1', estado: 'falhou', objetivo: 'Site', erro: 'sem resposta', criado: iso(AGORA - 3 * H), fim: iso(AGORA - 3 * H) }] },
    },
    geracoes: { porPeriodo: async () => [{ id: 'g1', estado: 'falhou', fornecedor: 'pollinations', prompt: 'logo', erro: 'api_key=SEGREDO123456789', actualizado: iso(AGORA - 4 * H) }] },
    mensagens: { list: async () => [{ id: 'm1', status: 'falhou', channel: 'email', subject: 'Fatura', erro: 'Authorization: Bearer xyz', created_at: iso(AGORA - 30 * 60e3) }] },
    ...extra,
  };
}

test('1.87.0 · as cinco origens existem e têm rótulo e sítio no ecrã', () => {
  assert.deepEqual(ORIGENS.map((o) => o.id), ['tarefa', 'modelo', 'imagem', 'execucao', 'envio']);
  for (const o of ORIGENS) assert.ok(o.rotulo && o.onde, o.id);
});

test('1.87.0 · conta só o que falhou na janela e separa as últimas 24 h', async () => {
  const p = await painelDeFalhas(repoComFalhas(), { agora: AGORA });
  const tar = p.porOrigem.find((o) => o.id === 'tarefa');
  assert.equal(tar.total, 1, 'a tarefa de há 9 dias está fora dos 7 dias');
  assert.equal(tar.ultimas24h, 1);
  assert.equal(p.porOrigem.find((o) => o.id === 'modelo').total, 1, 'o pedido com ok:true não é falha');
  assert.equal(p.porOrigem.find((o) => o.id === 'imagem').total, 1);
  assert.equal(p.porOrigem.find((o) => o.id === 'execucao').total, 1);
  assert.equal(p.porOrigem.find((o) => o.id === 'envio').total, 1);
  assert.equal(p.total, 5);
  assert.equal(p.origensSemLeitura, 0);
});

test('1.87.0 · a última falha é a real, com a hora e o erro guardado', async () => {
  const p = await painelDeFalhas(repoComFalhas(), { agora: AGORA });
  const tar = p.porOrigem.find((o) => o.id === 'tarefa');
  assert.equal(tar.ultimo.quando, iso(AGORA - 2 * H));
  assert.equal(tar.ultimo.erro, 'timeout ao modelo');
  assert.equal(tar.ultimo.quem, 'escritorio');
});

test('1.87.0 · a lista de recentes vai da mais nova para a mais antiga', async () => {
  const p = await painelDeFalhas(repoComFalhas(), { agora: AGORA });
  const quando = p.recentes.map((r) => Date.parse(r.quando));
  assert.deepEqual([...quando].sort((a, b) => b - a), quando);
  assert.equal(p.recentes[0].origem, 'envio', 'a falha de há 30 minutos é a mais recente');
});

test('1.87.0 · uma origem que não se lê diz porquê — não aparece como zero', async () => {
  const repo = repoComFalhas({ mensagens: { list: async () => { throw new Error('tabela orbita_mensagens em falta'); } } });
  const p = await painelDeFalhas(repo, { agora: AGORA });
  const envio = p.porOrigem.find((o) => o.id === 'envio');
  assert.equal(envio.total, null, 'não pode ser 0 quando não se leu');
  assert.match(envio.indisponivel, /tabela orbita_mensagens em falta/);
  assert.equal(p.origensSemLeitura, 1);
  assert.match(p.frase, /1 origem\(ns\) sem leitura/);
});

test('1.87.0 · segredos saem limpos: Bearer, chave em URL e o valor real do ambiente', async () => {
  const env = { GROQ_API_KEY: 'gsk_valor_real_do_ambiente_9876' };
  const repo = repoComFalhas({
    tarefas: { list: async () => [{ id: 'tx', state: 'failed', kind: 'escritorio', error: 'falhou com gsk_valor_real_do_ambiente_9876 em /x?token=ABCDEF12345', finished_at: iso(AGORA - H) }] },
  });
  const p = await painelDeFalhas(repo, { agora: AGORA, env });
  const txt = JSON.stringify(p);
  assert.ok(!txt.includes('gsk_valor_real_do_ambiente_9876'), 'o valor da chave do ambiente vazou');
  assert.ok(!txt.includes('ABCDEF12345'), 'o token em URL vazou');
  assert.ok(!txt.includes('SEGREDO123456789'), 'a api_key no erro da imagem vazou');
  assert.ok(!txt.includes('xyz'), 'o Bearer do correio vazou');
});

test('1.87.0 · limparSegredos: texto sem segredo fica igual', () => {
  assert.equal(limparSegredos('timeout ao modelo', {}), 'timeout ao modelo');
  assert.equal(limparSegredos(null), '');
});

test('1.87.0 · o erro longo é cortado a 300 caracteres', async () => {
  const longo = 'x'.repeat(900);
  const repo = repoComFalhas({ tarefas: { list: async () => [{ id: 'l', state: 'failed', kind: 'k', error: longo, finished_at: iso(AGORA - H) }] } });
  const p = await painelDeFalhas(repo, { agora: AGORA });
  assert.ok(p.porOrigem[0].ultimo.erro.length <= 300);
});

test('1.87.0 · a rota /ops/falhas responde no servidor com o painel', async () => {
  const repo = createMemRepo();
  const r = await responder(repo, { caminho: '/ops/falhas', metodo: 'GET', seguranca: false });
  assert.equal(r.status, 200, JSON.stringify(r).slice(0, 200));
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.porOrigem.length, 5);
  assert.equal(r.corpo.total, 0);
  assert.match(r.corpo.frase, /nenhuma falha/);
});

test('1.87.0 · o modo local lê as tarefas falhadas e diz que as outras origens não se lêem', async () => {
  const guardado = new Map();
  const api = createLocalApi({ storage: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v) } });
  const p = await api.call('/ops/falhas');
  assert.equal(p.modo, 'local');
  assert.equal(p.porOrigem.length, 5);
  for (const o of p.porOrigem.filter((x) => x.id !== 'tarefa')) {
    assert.ok(o.indisponivel, o.id);
    assert.equal(o.total, null);
  }
});

test('1.87.0 · o cartão mostra a falha real, a origem sem leitura e a janela', async () => {
  const p = await painelDeFalhas(repoComFalhas({ mensagens: { list: async () => { throw new Error('sem tabela'); } } }), { agora: AGORA });
  const html = cartaoFalhas(p, { esc: (x) => x, when: (x) => x });
  assert.match(html, /Falhas/);
  assert.match(html, /timeout ao modelo/);
  assert.match(html, /sem leitura — sem tabela/);
  assert.match(html, /Últimos 7 dias/);
});

test('1.87.0 · o cartão nunca diz zero quando não leu; diz que está a carregar ou o erro', () => {
  const esc = (x) => x;
  assert.match(cartaoFalhas(null, { esc, when: esc }), /A carregar as falhas/);
  assert.match(cartaoFalhas({ erroLeitura: 'o servidor não respondeu' }, { esc, when: esc }), /Não consegui ler as falhas: o servidor não respondeu/);
});

test('1.87.0 · o Control Center mostra o cartão «Falhas» dentro da vista IA', () => {
  const html = vistaIA({ ia: { modelos: [], uso: { resumo: [], errosRecentes: [] }, runs: [], trabalhos: [], gratuitos: null }, iaFalhas: null },
    { esc: (x) => x, hhmm: (x) => x, when: (x) => x });
  assert.match(html, /Falhas/, 'o cartão tem de estar no Control Center');
});
