/* ===========================================================================
   1.67.0 · O CICLO (5 nov 2026)

   A frase que este ficheiro existe para tornar verdadeira: «os agentes
   trabalham sozinhos». Até aqui, `state: 'queued'` era uma linha esquecida —
   ninguém a ia buscar. Aqui prova-se, com um repositório em memória e um motor
   de mentira, que:

     · só corre o que está na fila, pela ordem em que foi posto;
     · **duas invocações ao mesmo tempo não fazem o mesmo trabalho duas vezes**
       (o cadeado é o `state`, condicional);
     · sem autonomia registada não se gasta nada — a tarefa fica à espera com a
       razão escrita, e aprovar depois fá-la correr;
     · `proposto` corre e deixa à espera; `autonomo` corre e fecha;
     · o tempo da função é respeitado: o ciclo para a meio e deixa o resto;
     · sem motor de IA a tarefa falha e diz porquê — nunca inventa um resultado.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import {
  decidir, haMotor, escopoDaTarefa, correrCiclo, fraseDoCiclo, resumoDoCiclo, NIVEIS,
} from './api/_ia/ciclo.mjs';

const ENV = { ORBITA_ADMIN_TOKEN: 'a'.repeat(32) };

/** Um lead e um projeto: as tarefas apontam para eles. */
async function cenario({ autonomia = null } = {}) {
  const repo = createMemRepo({
    leads: [{ id: 'l1', name: 'Ana', city: 'Coimbra', category: 'restaurante' }],
    projetos: [{ id: 'p1', name: 'Site', client: 'Ana', kind: 'landing' }],
  });
  if (autonomia) await repo.autonomia.guardar({ escopo: escopoDaTarefa(autonomia.kind), nivel: autonomia.nivel });
  return repo;
}

/** Um motor que responde sempre — e conta quantas vezes foi chamado. */
function motorDeMentira(pedidos = { n: 0 }, { falhar = false } = {}) {
  return {
    async pedir() {
      pedidos.n += 1;
      if (falhar) throw new Error('todos os modelos recusaram');
      return { fornec: 'teste', modelo: 'm1', texto: 'resposta do agente', tentativas: 1 };
    },
  };
}

const emFila = (repo) => repo.tarefas.emFila(10);

/* ---------- a decisão, pura ---------- */

test('1.67.0 · a autonomia decide: pede-me sempre não gasta, proposto mostra, autónomo fecha', () => {
  const sempre = decidir({ nivel: 'pedir_sempre' });
  assert.equal(sempre.correr, false);
  assert.match(sempre.porque, /autorização/);

  const proposto = decidir({ nivel: 'proposto' });
  assert.equal(proposto.correr, true);
  assert.equal(proposto.aprovar, false, 'propõe — não fecha sozinho');

  const autonomo = decidir({ nivel: 'autonomo' });
  assert.equal(autonomo.correr, true);
  assert.equal(autonomo.aprovar, true);
  assert.match(autonomo.porque, /política/);

  /* um nível que não existe cai no mais seguro, nunca no mais solto */
  assert.equal(decidir({ nivel: 'yolo' }).correr, false);
  assert.equal(decidir({}).correr, false);
  assert.deepEqual(NIVEIS, ['pedir_sempre', 'proposto', 'autonomo']);
});

test('1.67.0 · sem motor de IA nada corre, e diz-se porquê', () => {
  assert.equal(haMotor({ env: {} }), true, 'a cadeia gratuita não precisa de chave');
  assert.equal(haMotor({ env: { ORBITA_IA: 'desligada' } }), false);
  const d = decidir({ nivel: 'autonomo', temMotor: false });
  assert.equal(d.correr, false);
  assert.match(d.porque, /não há motor/);
});

/* ---------- o ciclo a sério ---------- */

test('1.67.0 · corre o que está na fila, pela ordem em que foi posto', async () => {
  const repo = await cenario({ autonomia: { kind: 'investigar', nivel: 'autonomo' } });
  const a = await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  const b = await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });

  const pedidos = { n: 0 };
  const r = await correrCiclo({ repo, env: ENV, motor: motorDeMentira(pedidos), limite: 5 });

  assert.equal(r.feitas.length, 2);
  assert.deepEqual(r.feitas.map((f) => f.id), [a.id, b.id], 'a ordem da fila é a ordem de criação');
  assert.equal(pedidos.n, 2, 'uma chamada ao modelo por tarefa, nem mais nem menos');
  assert.equal((await repo.tarefas.byId(a.id)).state, 'succeeded');
  assert.match((await repo.tarefas.byId(a.id)).resultado, /resposta do agente/);
  assert.equal((await emFila(repo)).length, 0, 'a fila ficou vazia');
  assert.match(r.frase, /2 concluída/);
});

test('1.67.0 · dois ciclos ao mesmo tempo: cada tarefa corre uma só vez', async () => {
  const repo = await cenario({ autonomia: { kind: 'investigar', nivel: 'autonomo' } });
  await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });

  const pedidos = { n: 0 };
  const motor = motorDeMentira(pedidos);
  /* dois ciclos em paralelo, como duas invocações da função ao mesmo tempo */
  const [um, dois] = await Promise.all([
    correrCiclo({ repo, env: ENV, motor, limite: 5 }),
    correrCiclo({ repo, env: ENV, motor, limite: 5 }),
  ]);
  const corridas = [...um.feitas, ...dois.feitas].filter((f) => f.acao !== 'a_espera');
  assert.equal(corridas.length, 2, 'duas tarefas — nem três nem quatro');
  assert.equal(pedidos.n, 2, 'o modelo foi chamado duas vezes, não quatro: o cadeado segura');
  const levadas = [...um.paradas, ...dois.paradas].filter((p) => p.motivo === 'outro ciclo');
  assert.equal(levadas.length, 2, 'o ciclo que chegou depois diz que outro já as levava');
});

test('1.67.0 · sem autonomia registada não se gasta nada: fica à espera, com a razão', async () => {
  const repo = await cenario();
  const t = await repo.tarefas.insert({ kind: 'mensagem', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  const pedidos = { n: 0 };
  const r = await correrCiclo({ repo, env: ENV, motor: motorDeMentira(pedidos) });

  assert.equal(pedidos.n, 0, 'nenhuma chamada de IA sem autorização');
  assert.equal(r.feitas[0].acao, 'a_espera');
  assert.match(r.feitas[0].porque, /autorização/);
  const guardada = await repo.tarefas.byId(t.id);
  assert.equal(guardada.state, 'awaiting_approval');
  assert.equal(guardada.resultado ?? null, null, 'sem resultado inventado');

  const act = await repo.atividade.list(5);
  assert.ok(act.some((x) => /ficou à espera/.test(x.texto || x.what || '')), 'a razão fica escrita na Atividade');
});

test('1.67.0 · aprovada na mesa, a tarefa que esperava corre (o caminho não fecha em falso)', async () => {
  const repo = await cenario();
  const t = await repo.tarefas.insert({ kind: 'mensagem', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  await correrCiclo({ repo, env: ENV, motor: motorDeMentira({ n: 0 }), limite: 1 });
  assert.equal((await repo.tarefas.byId(t.id)).state, 'awaiting_approval');

  const r = await responder(repo, {
    caminho: `/ops/tarefas/${t.id}/aprovar`, metodo: 'POST', corpo: {}, env: ENV, seguranca: true,
    headers: { authorization: `Bearer ${ENV.ORBITA_ADMIN_TOKEN}` },
    fetchImpl: async () => { throw new Error('sem rede'); },
  });
  assert.equal(r.status, 200);
  const depois = await repo.tarefas.byId(t.id);
  assert.ok(['succeeded', 'failed'].includes(depois.state), `a aprovação correu a tarefa: ${depois.state}`);
  assert.notEqual(depois.state, 'awaiting_approval');
});

test('1.67.0 · «propõe e espera» corre e deixa o resultado à tua frente', async () => {
  const repo = await cenario({ autonomia: { kind: 'briefing', nivel: 'proposto' } });
  const t = await repo.tarefas.insert({ kind: 'briefing', entity_id: 'p1', entidade: 'projeto', state: 'queued' });
  const r = await correrCiclo({ repo, env: ENV, motor: motorDeMentira({ n: 0 }) });
  assert.equal(r.feitas[0].acao, 'proposta');
  const g = await repo.tarefas.byId(t.id);
  assert.equal(g.state, 'awaiting_approval');
  assert.match(g.resultado, /resposta do agente/);
});

test('1.67.0 · o tempo da função é respeitado: para a meio e diz quantas ficaram', async () => {
  const repo = await cenario({ autonomia: { kind: 'investigar', nivel: 'autonomo' } });
  for (let i = 0; i < 3; i += 1) {
    await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  }
  let relogio = 0;
  const r = await correrCiclo({
    repo, env: ENV, motor: motorDeMentira({ n: 0 }),
    limite: 5, orcamentoMs: 1000, agora: () => { relogio += 600; return relogio; },
  });
  assert.ok(r.feitas.length < 3, 'não correu tudo');
  assert.equal(r.restantes, 1, 'e diz que ficou trabalho na fila');
  assert.match(r.frase, /Ficaram 1 na fila/);
  assert.equal((await emFila(repo)).length > 0, true, 'o que sobrou continua na fila para a próxima');
});

test('1.67.0 · um limite pequeno deixa o resto na fila (não engole tudo)', async () => {
  const repo = await cenario({ autonomia: { kind: 'investigar', nivel: 'autonomo' } });
  for (let i = 0; i < 3; i += 1) {
    await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  }
  const r = await correrCiclo({ repo, env: ENV, motor: motorDeMentira({ n: 0 }), limite: 1 });
  assert.equal(r.feitas.length, 1);
  assert.equal(r.restantes, 1);
  assert.equal((await emFila(repo)).length, 2);
});

test('1.67.0 · a falhar, a tarefa fica falhada com o motivo — não com um resultado bonito', async () => {
  const repo = await cenario({ autonomia: { kind: 'investigar', nivel: 'autonomo' } });
  const t = await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  const r = await correrCiclo({ repo, env: ENV, motor: motorDeMentira({ n: 0 }, { falhar: true }) });
  assert.equal(r.feitas[0].acao, 'falhou');
  const g = await repo.tarefas.byId(t.id);
  assert.equal(g.state, 'failed');
  assert.match(g.error, /recusaram/);
  assert.equal(g.resultado ?? null, null);
});

test('1.67.0 · uma tarefa de tipo desconhecido falha em vez de ficar presa em «a correr»', async () => {
  const repo = await cenario({ autonomia: { kind: 'inventado', nivel: 'autonomo' } });
  const t = await repo.tarefas.insert({ kind: 'inventado', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  const r = await correrCiclo({ repo, env: ENV, motor: motorDeMentira({ n: 0 }) });
  assert.equal(r.feitas[0].acao, 'falhou');
  const g = await repo.tarefas.byId(t.id);
  assert.equal(g.state, 'failed');
  assert.match(g.error, /desconhecido/);
});

test('1.67.0 · a fila vazia diz que está vazia (não «corri nada» com ar de avaria)', async () => {
  const repo = await cenario();
  const r = await correrCiclo({ repo, env: ENV, motor: motorDeMentira({ n: 0 }) });
  assert.equal(r.ok, true);
  assert.equal(r.feitas.length, 0);
  assert.match(r.frase, /fila está vazia/);
  assert.equal(resumoDoCiclo(r).corridas, 0);
});

test('1.67.0 · a frase do ciclo conta o que aconteceu, sem arredondar para bonito', () => {
  const f = fraseDoCiclo({ feitas: [{ acao: 'concluida' }, { acao: 'falhou' }], paradas: [{ motivo: 'outro ciclo' }], restantes: 2 });
  assert.match(f, /1 concluída/);
  assert.match(f, /1 não passaram/);
  assert.match(f, /outro ciclo/);
  assert.match(f, /Ficaram 2 na fila/);
  assert.match(fraseDoCiclo({}), /nada para correr/);
});

/* ---------- as pontas: a rota da mesa e o endereço das máquinas ---------- */

test('1.67.0 · POST /ops/ciclo corre a fila com sessão/token e devolve o resumo', async () => {
  const repo = await cenario({ autonomia: { kind: 'investigar', nivel: 'autonomo' } });
  await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  const r = await responder(repo, {
    caminho: '/ops/ciclo', metodo: 'POST', corpo: { limite: 1 }, env: ENV, seguranca: true,
    headers: { authorization: `Bearer ${ENV.ORBITA_ADMIN_TOKEN}` },
    fetchImpl: async () => { throw new Error('sem rede'); },
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(typeof r.corpo.frase, 'string');
  assert.ok('concluidas' in r.corpo && 'restantes' in r.corpo);
});

test('1.67.0 · GET /ops/ciclo só diz o que está na fila — não corre nada', async () => {
  const repo = await cenario({ autonomia: { kind: 'investigar', nivel: 'autonomo' } });
  await repo.tarefas.insert({ kind: 'investigar', entity_id: 'l1', entidade: 'lead', state: 'queued' });
  const r = await responder(repo, {
    caminho: '/ops/ciclo', metodo: 'GET', env: ENV, seguranca: true,
    headers: { authorization: `Bearer ${ENV.ORBITA_ADMIN_TOKEN}` },
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.naFila, 1);
  assert.equal((await emFila(repo)).length, 1, 'a leitura não mexeu na fila');
});

test('1.67.0 · /api/ciclo recusa-se a correr sem chave nenhuma', async () => {
  const { default: ciclo } = await import('./api/ciclo.mjs');
  const guardado = { ...process.env };
  try {
    for (const k of ['CRON_SECRET', 'ORBITA_ADMIN_TOKEN', 'ORBITA_API_TOKEN', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY']) delete process.env[k];
    let corpo = null;
    let estado = 0;
    const res = { setHeader() {}, status(n) { estado = n; return res; }, json(x) { corpo = x; return res; } };
    await ciclo({ method: 'GET', url: '/api/ciclo', headers: {} }, res);
    assert.equal(estado, 503);
    assert.match(corpo.error, /sem chave/);
    assert.match(corpo.como, /CRON_SECRET/);
  } finally {
    for (const k of ['CRON_SECRET', 'ORBITA_ADMIN_TOKEN', 'ORBITA_API_TOKEN']) delete process.env[k];
    Object.assign(process.env, guardado);
  }
});

test('1.67.0 · /api/ciclo aceita o CRON_SECRET e recusa a chave errada', async () => {
  const { default: ciclo } = await import('./api/ciclo.mjs');
  const guardado = { ...process.env };
  try {
    Object.assign(process.env, { CRON_SECRET: 'c'.repeat(40) });
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
    const chamar = async (headers) => {
      let corpo = null; let estado = 0;
      const res = { setHeader() {}, status(n) { estado = n; return res; }, json(x) { corpo = x; return res; } };
      await ciclo({ method: 'GET', url: '/api/ciclo', headers }, res);
      return { estado, corpo };
    };
    const errado = await chamar({ authorization: 'Bearer errado' });
    assert.equal(errado.estado, 401);
    assert.match(errado.corpo.error, /falta a chave/);
    const certo = await chamar({ authorization: `Bearer ${'c'.repeat(40)}` });
    assert.equal(certo.estado, 503, 'passou a porta e parou na base (que aqui não está ligada)');
    assert.match(certo.corpo.error, /base de dados/);
  } finally {
    delete process.env.CRON_SECRET;
    Object.assign(process.env, guardado);
  }
});
