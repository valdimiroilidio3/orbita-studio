/* 1.89.1 · O ESQUEMA DA BASE, VERIFICADO E CURADO.
   Antes, a auditoria e o `health` não olhavam para `orbita_tasks.payload` nem
   `.title` (supabase/orbita_1_79_0.sql). Uma base sem elas dizia «ok» e o pedido
   escrito de uma tarefa só falhava na escrita. Estes testes provam: a sonda vê a
   coluna em falta; o curador é chamado com ela; a escrita repete-se depois da
   cura; e, se a cura falhar, a tarefa é recusada com o motivo (sem perder o texto). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUNAS_EXIGIDAS, colunasEmFalta } from './api/_esquema.mjs';
import { mesasEmFalta } from './api/_autoesquema.mjs';
import { createSupabaseRepo, explificar, COLUNAS_DO_1_79 } from './api/_repo.mjs';
import { criarECorrer } from './api/_tarefas.mjs';

const TIPOS = { investigar: { label: 'Investigar o lead' } };

test('1.89.1 · a auditoria exige payload e title em orbita_tasks', () => {
  assert.ok(COLUNAS_EXIGIDAS.orbita_tasks.includes('payload'));
  assert.ok(COLUNAS_EXIGIDAS.orbita_tasks.includes('title'));
  const faltam = colunasEmFalta({ orbita_tasks: ['id', 'state', 'resultado', 'modelo', 'custo_micro_usd'] });
  assert.deepEqual(faltam, { orbita_tasks: ['payload', 'title'] });
  assert.deepEqual(colunasEmFalta({ orbita_tasks: ['id', 'payload', 'title', 'resultado', 'modelo', 'custo_micro_usd'] }), {});
});

test('1.89.1 · o curador vê colunas em falta (tabela.coluna), não só tabelas', () => {
  assert.deepEqual(mesasEmFalta({ ok: false, faltam: [], colunasFaltam: { orbita_tasks: ['payload'] } }), ['orbita_tasks.payload']);
  assert.deepEqual(mesasEmFalta({ ok: true, faltam: [] }), []);
  assert.deepEqual(mesasEmFalta({ ok: false, faltam: ['orbita_faturas'], colunasFaltam: {} }), ['orbita_faturas']);
});

test('1.89.1 · o erro de payload/title diz o ficheiro certo (orbita_1_79_0.sql)', () => {
  const p = explificar("Could not find the 'payload' column of 'orbita_tasks' in the schema cache", { code: 'PGRST204' });
  assert.equal(p.ficheiro, 'orbita_1_79_0.sql');
  assert.ok(COLUNAS_DO_1_79.has('title'));
  const t = explificar('column orbita_tasks.title does not exist', { code: '42703' });
  assert.equal(t.ficheiro, 'orbita_1_79_0.sql');
});

/* uma base falsa que responde como o PostgREST: `payload` (ou `title`) em falta → 400 PGRST204 */
function baseComColunasEm({ falta = [] } = {}) {
  const chamadas = [];
  const fetchImpl = async (url) => {
    chamadas.push(url);
    const m = /select=id,(\w+)/.exec(url);
    const coluna = m && m[1];
    if (coluna && falta.includes(coluna)) {
      return new Response(JSON.stringify({ code: 'PGRST204', message: `Could not find the '${coluna}' column of 'orbita_tasks' in the schema cache`, details: null, hint: null }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { repo: createSupabaseRepo({ url: 'https://x.supabase.co', key: 'k', fetchImpl }), chamadas };
}

test('1.89.1 · health: uma base sem payload/title NÃO diz ok, e diz quais colunas faltam', async () => {
  const { repo } = baseComColunasEm({ falta: ['payload', 'title'] });
  const h = await repo.health();
  assert.equal(h.ok, false, 'a base sem o pedido escrito não pode dizer ok');
  assert.deepEqual(h.colunasFaltam, { orbita_tasks: ['payload', 'title'] });
  assert.deepEqual(mesasEmFalta(h), ['orbita_tasks.payload', 'orbita_tasks.title']);
});

test('1.89.1 · health: a base completa diz ok e não tem colunas em falta', async () => {
  const { repo } = baseComColunasEm({ falta: [] });
  const h = await repo.health();
  assert.equal(h.ok, true);
  assert.deepEqual(h.colunasFaltam, {});
});

test('1.89.1 · uma coluna em falta é curada e a escrita repete-se UMA vez — a tarefa não se perde', async () => {
  const escritas = [];
  let curas = 0;
  const repo = {
    tarefas: {
      insert: async (reg) => {
        escritas.push(reg);
        if (reg.payload && !repo.curada) {
          throw Object.assign(new Error("Could not find the 'payload' column of 'orbita_tasks' in the schema cache"), { semEsquema: true, coluna: 'payload', codigo: 'PGRST204' });
        }
        return { id: 't1', ...reg };
      },
      patch: async (id, campos) => ({ id, ...campos }),
    },
    atividade: { add: async () => null },
    leads: { byId: async () => null },
  };
  const garantir = async () => { curas += 1; repo.curada = true; return { ok: true, aplicadoAgora: true }; };
  const motor = { pedir: async () => ({ texto: 'Resposta de teste.', fornec: 'groq', modelo: 'm', tentativas: 1 }) };
  const r = await criarECorrer({
    repo, corpo: { kind: 'investigar', texto: 'Pesquisa a concorrência de Braga' }, TIPOS, motor, garantir, env: {},
  });
  assert.equal(r.status, 201, 'depois da cura a tarefa é criada');
  assert.equal(curas, 1, 'a cura corre uma vez');
  assert.equal(escritas.length, 2, 'escreve-se outra vez, depois da cura');
  assert.equal(escritas[1].payload.pedido, 'Pesquisa a concorrência de Braga', 'o pedido segue inteiro');
});

test('1.89.1 · se a cura falhar, a tarefa é recusada com o motivo — e nada se perde em silêncio', async () => {
  const repo = {
    tarefas: {
      insert: async () => { throw Object.assign(new Error("Could not find the 'title' column"), { semEsquema: true, coluna: 'title', codigo: 'PGRST204' }); },
      patch: async () => null,
    },
    atividade: { add: async () => null },
  };
  const garantir = async () => ({ ok: false, erro: 'não consegui ligar à base: POSTGRES_URL em falta' });
  const r = await criarECorrer({
    repo, corpo: { kind: 'investigar', texto: 'Escreve a ata' }, TIPOS, motor: { pedir: async () => ({ texto: 'x' }) }, garantir, env: {},
  });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /POSTGRES_URL em falta/, 'diz porque a cura não resultou');
  assert.match(r.corpo.error, /não foi criada/);
});
