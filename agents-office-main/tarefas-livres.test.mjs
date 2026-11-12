/* 1.89.0 · tarefas com texto livre para TODAS as áreas, não só para o escritório.
   Prova: qualquer tipo aceita o pedido escrito; sem entidade o pedido é o alvo;
   com entidade junta-se ao contexto real; sem a coluna na base a tarefa é
   recusada com a razão (o texto não se perde); e os dois lugares novos têm rotina. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROTINAS, criarECorrer, executarTarefa } from './api/_tarefas.mjs';
import { ROTINA } from './src/elenco.js';

const TIPOS = Object.fromEntries(Object.keys(ROTINAS).map((k) => [k, { label: k }]));

function repoFalso({ semColuna = false } = {}) {
  const gravadas = [];
  const repo = {
    gravadas,
    tarefas: {
      insert: async (reg) => {
        if (semColuna && reg.payload) { const e = new Error('Could not find the \'payload\' column'); e.coluna = 'payload'; e.semEsquema = true; throw e; }
        const t = { id: `t${gravadas.length + 1}`, ...reg }; gravadas.push(t); return t;
      },
      patch: async (id, campos) => ({ id, ...campos }),
    },
    atividade: { add: async () => null },
    leads: { byId: async () => ({ name: 'Oficina Teste', city: 'Lisboa', website: null }) },
    projetos: { byId: async () => ({ name: 'Site da Oficina', client: 'Oficina Teste' }) },
  };
  return repo;
}
const motorQueResponde = (log) => ({
  pedir: async (_t, msgs) => { log.push(msgs[1].content); return { texto: 'Resposta de teste.', fornec: 'groq', modelo: 'm', tentativas: 1 }; },
});

test('1.89.0 · sem entidade, o pedido escrito é o alvo da tarefa (briefing)', async () => {
  const repo = repoFalso(); const log = [];
  const r = await criarECorrer({ repo, corpo: { kind: 'briefing', texto: 'Quero um site para a minha padaria em Braga' }, TIPOS, motor: motorQueResponde(log), env: {} });
  assert.equal(r.status, 201);
  assert.equal(repo.gravadas[0].payload.pedido, 'Quero um site para a minha padaria em Braga');
  assert.match(log[0], /padaria em Braga/);
  assert.equal(r.corpo.tarefa.state, 'succeeded');
});

test('1.89.0 · com entidade, o pedido junta-se ao contexto real do lead', async () => {
  const repo = repoFalso(); const log = [];
  await criarECorrer({ repo, corpo: { kind: 'investigar', entityId: 'l_1', entidade: 'lead', texto: 'Foca-te no que falta no site' }, TIPOS, motor: motorQueResponde(log), env: {} });
  assert.match(log[0], /Oficina Teste/, 'perdeu o lead');
  assert.match(log[0], /Foca-te no que falta no site/, 'perdeu o pedido');
  assert.match(log[0], /Pedido de quem pediu/);
});

test('1.89.0 · sem texto, uma tarefa de área continua como antes (sem payload)', async () => {
  const repo = repoFalso(); const log = [];
  await criarECorrer({ repo, corpo: { kind: 'qa', entityId: 'p_1', entidade: 'projeto' }, TIPOS, motor: motorQueResponde(log), env: {} });
  assert.equal(repo.gravadas[0].payload, undefined);
  assert.equal(repo.gravadas[0].entity_id, 'p_1');
});

test('1.89.0 · sem a coluna na base, a tarefa com texto é RECUSADA com a razão — o texto não se perde', async () => {
  const repo = repoFalso({ semColuna: true });
  const r = await criarECorrer({ repo, corpo: { kind: 'mensagem', entityId: 'l_1', entidade: 'lead', texto: 'Escreve-lhe sobre a renovação' }, TIPOS, motor: motorQueResponde([]), env: {} });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /orbita_1_79_0\.sql/);
  assert.equal(repo.gravadas.length, 0, 'não pode criar uma tarefa sem o texto');
});

test('1.89.0 · TODAS as áreas aceitam o pedido escrito: cada tipo de trabalho (exceto o escritório, que já tinha)', async () => {
  for (const kind of Object.keys(ROTINAS)) {
    if (kind === 'escritorio') continue;
    const repo = repoFalso(); const log = [];
    const r = await criarECorrer({ repo, corpo: { kind, texto: `PEDIDO-DE-${kind}` }, TIPOS, motor: motorQueResponde(log), env: {} });
    assert.equal(r.status, 201, `${kind} recusou o pedido escrito`);
    assert.match(log[0], new RegExp(`PEDIDO-DE-${kind}`), `${kind} não levou o pedido ao motor`);
  }
});

test('1.89.0 · os dois lugares novos do Comando têm rotina própria e sala certa', () => {
  for (const kind of ['ata', 'faq']) {
    assert.ok(ROTINAS[kind], `${kind} sem rotina`);
    assert.equal(ROTINA[kind].deptPt, 'comando');
    assert.equal(ROTINA[kind].posto, kind);
  }
  assert.match(ROTINAS.ata.pedido('NOTAS'), /NOTAS/);
});

test('1.89.0 · uma ata sem resposta do modelo falha — não inventa a ata', async () => {
  const repo = repoFalso();
  const motor = { pedir: async () => ({ texto: '', fornec: 'groq', modelo: 'm' }) };
  const r = await executarTarefa({ repo, tarefa: { kind: 'ata', payload: { pedido: 'Notas: decidimos subir o preço' } }, env: {}, motor });
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'failed');
});
