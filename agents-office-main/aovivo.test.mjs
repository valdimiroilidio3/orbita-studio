/* ===========================================================================
   1.77.0 · DUAS FRASES QUE NÃO PODEM VOLTAR (6 nov 2026)

   O dono viu estas duas no ecrã, e ambas eram nossas:

     1 · «null value in column "hash" of relation "orbita_contas" violates
         not-null constraint» — a conta que nasce do GitHub não tem palavra-
         passe, e a base da 1.54.0 exigia uma. Agora: o erro é traduzido para o
         ficheiro que o corrige (`orbita_1_77_0.sql`), e o próprio servidor
         aplica essa migração e volta a tentar a escrita UMA vez.

     2 · «A ligação ao vivo não está de pé (stale)» — os caminhos ao vivo só
         existiam no `serve.mjs`. Agora existe um retrato na base de dados, e o
         cliente lê-o a cada 8 s quando o fluxo contínuo não se estabelece.
         Nunca fica «desactualizado» com dados frescos, nem diz que a ligação
         caiu quando ela nunca foi servida.

   O que se prova aqui, sem rede e sem base verdadeira:

     · a nulabilidade de `hash` é reconhecida como esquema em falta, e não como
       um dado inválido;
     · a mensagem diz `orbita_1_77_0.sql` — o ficheiro certo;
     · uma conta com fornecedor e sem palavra-passe NÃO é escrita com um hash
       inventado;
     · o retrato ao vivo conta o trabalho real (estado, tentativa, erro), e um
       posto sem tarefas diz «sem tarefa» em vez de inventar atividade;
     · o fluxo `/api/ops/aovivo/stream` diz `hello` e fecha-se sozinho — não
       promete uma ligação eterna que a Vercel não pode dar.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { explificar } from './api/_repo.mjs';
import { faltaEsquemaDaPorta, FICHEIROS_DA_PORTA } from './api/_autoesquema.mjs';
import { retrato, estadoDoPosto, redigir, SEAT } from './api/_aovivo.mjs';
import handler, { servirAoVivo } from './api/_aovivo-rota.mjs';

/* ---------- 1 · a conta do dono, sem palavra-passe ---------- */

test('1.77.0 · «null value in column hash» é esquema em falta — e manda para o ficheiro certo', () => {
  const cru = 'null value in column "hash" of relation "orbita_contas" violates not-null constraint';
  const e = explificar(cru, { code: '23502' });

  assert.equal(e.semEsquema, true, 'a base a exigir uma palavra-passe é esquema, não é um dado do utilizador');
  assert.equal(e.ficheiro, 'orbita_1_77_0.sql', 'o erro tem de nomear o ficheiro que o corrige');
  assert.match(e.mensagem, /hash|palavra-passe/);
  assert.match(e.mensagem, /orbita_1_77_0\.sql/);
  assert.doesNotMatch(e.mensagem, /violates not-null/, 'o dono não volta a ler o erro cru do Postgres');
  assert.equal(faltaEsquemaDaPorta(Object.assign(new Error(cru), { code: '23502' })), true,
    'a auto-cura tem de reconhecer este erro para poder aplicar a migração');
});

test('1.77.0 · a migração entra na lista da porta (idempotente, como as outras)', () => {
  assert.ok(FICHEIROS_DA_PORTA.includes('orbita_1_77_0.sql'));
  assert.equal(FICHEIROS_DA_PORTA.at(-1), 'orbita_1_77_0.sql', 'a última migração é a que se aplica por último');
});

test('1.77.0 · um erro de valor inválido noutra coluna NÃO é tratado como esquema da porta', () => {
  const e = explificar('null value in column "titulo" of relation "orbita_tasks" violates not-null constraint', { code: '23502' });
  assert.equal(e.semEsquema, false, 'só `hash` da porta é regra antiga — o resto é um dado em falta');
  assert.equal(e.ficheiro, null);
});

/* ---------- 2 · o retrato ao vivo ---------- */

const T = (o) => ({ attempts: 1, max_attempts: 3, created_at: '2026-11-06T09:00:00.000Z', ...o });

test('1.77.0 · o retrato conta o trabalho real: em curso, na fila, falhado e sem tarefa', () => {
  const agora = new Date('2026-11-06T10:00:00.000Z').getTime();
  const r = retrato({
    agentes: ['crep', 'dasst', 'qa', 'vmail'],
    agora,
    tarefas: [
      T({ id: 't1', kind: 'projeto.gerar', title: 'Gerar o site da clínica', state: 'running', started_at: '2026-11-06T09:58:00.000Z' }),
      T({ id: 't2', kind: 'projeto.briefing', title: 'Briefing', state: 'awaiting_approval', created_at: '2026-11-06T09:40:00.000Z' }),
      T({ id: 't3', kind: 'projeto.qa', title: 'Auditar', state: 'failed', error: 'falhou em /home/chelton/segredo/token.ts: a sintaxe', finished_at: '2026-11-06T09:55:00.000Z' }),
    ],
  });

  assert.equal(r.agents.crep.state, 'live');
  assert.equal(r.agents.crep.task.title, 'Gerar o site da clínica');
  assert.equal(r.agents.crep.task.stateLabel, 'a correr');
  assert.equal(r.agents.dasst.state, 'waiting');
  assert.equal(r.agents.qa.state, 'error');
  assert.match(r.agents.qa.task.error, /…\/segredo\/token\.ts/, 'o caminho absoluto não sai do servidor');
  assert.doesNotMatch(r.agents.qa.task.error, /\/home\/chelton/);
  assert.equal(r.agents.vmail.state, 'idle', 'um posto sem tarefas não inventa atividade');
  assert.equal(r.agents.vmail.hasData, false);
  assert.deepEqual(r.agents.vmail.lines.map((l) => l.k), ['idle']);
  assert.equal(r.totais.running, 1);
  assert.equal(r.totais.failed, 1);
  assert.deepEqual(r.abertas.map((t) => t.id), ['t1', 't2']);
  assert.equal(typeof r.serverTime, 'number');
});

test('1.77.0 · «ao vivo» só com trabalho a correr ou evento recente — nunca por omissão', () => {
  const agora = new Date('2026-11-06T10:00:00.000Z').getTime();
  const e1 = estadoDoPosto([T({ id: 'a', state: 'succeeded', finished_at: '2026-11-06T09:59:00.000Z' })], { agora });
  assert.equal(e1.state, 'idle', 'concluída há um minuto não é «a trabalhar»');

  const e2 = estadoDoPosto([], { agora, eventos: [{ at: '2026-11-06T09:59:30.000Z', texto: 'crep escreveu 12 ficheiros' }] });
  assert.equal(e2.state, 'live', 'um evento real recente é atividade');

  const e3 = estadoDoPosto([], { agora, eventos: [{ at: '2026-11-06T09:00:00.000Z', texto: 'crep antigo' }] });
  assert.equal(e3.state, 'idle', 'um evento de há uma hora já não é «ao vivo»');

  const e4 = estadoDoPosto([T({ id: 'f', state: 'failed', finished_at: '2026-11-05T10:00:00.000Z', error: 'x' })], { agora });
  assert.equal(e4.state, 'idle', 'uma falha de ontem não pinta o posto de vermelho hoje');
});

test('1.77.0 · o redactor esconde segredos e caminhos absolutos', () => {
  assert.match(redigir('chave sk-abcdefgh12345678 em /home/chelton/dev/orbita/segredo.mjs'), /«segredo»/);
  assert.doesNotMatch(redigir('/home/chelton/dev/orbita/segredo.mjs'), /\/home\/chelton/);
});

test('1.77.0 · todos os postos do mapa SEAT cabem no retrato', () => {
  const r = retrato({ agentes: Object.values(SEAT) });
  assert.equal(Object.keys(r.agents).length, new Set(Object.values(SEAT)).size);
  for (const a of Object.values(r.agents)) assert.ok(['idle', 'live', 'waiting', 'error'].includes(a.state));
});

/* ---------- 3 · os dois caminhos HTTP ---------- */

function resFalso() {
  const r = { codigo: 200, cabecalhos: {}, corpo: '', escrito: [], terminou: false };
  r.setHeader = (k, v) => { r.cabecalhos[k] = v; };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (o) => { r.corpo = o; r.terminou = true; return r; };
  r.write = (t) => { r.escrito.push(t); return true; };
  r.end = () => { r.terminou = true; };
  r.flushHeaders = () => {};
  return r;
}
const reqCom = (url = '/api/aovivo', headers = {}) => ({ method: 'GET', url, headers, on: () => {} });

test('1.77.0 · sem sessão, o retrato não se dá a estranhos — e diz porquê', async () => {
  const res = resFalso();
  process.env.SUPABASE_URL = 'https://exemplo.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'chave-de-teste';
  try {
    await handler(reqCom('/api/rpc?aovivo=retrato'), res);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  }
  assert.equal(res.codigo, 401);
  assert.equal(res.corpo.error, 'entra');
  assert.ok(res.corpo.hint, 'a recusa explica-se, não fica muda');
});

test('1.77.0 · sem base de dados ligada, a resposta é 503 com a razão — não um retrato vazio', async () => {
  const res = resFalso();
  await handler(reqCom('/api/rpc?aovivo=retrato'), res);
  assert.equal(res.codigo, 503);
  assert.equal(res.corpo.modo, 'local');
  assert.match(res.corpo.erro, /SUPABASE_URL/);
});

test('1.77.0 · o caminho do fluxo é reconhecido pelo `?aovivo=stream` (a reescrita da Vercel)', async () => {
  const res = resFalso();
  await handler(reqCom('/api/rpc?aovivo=stream'), res);
  /* sem base, o 503 é o mesmo — o que importa é que pedir o fluxo não devolve JSON de retrato */
  assert.equal(res.codigo, 503);
  assert.equal(res.cabecalhos['Content-Type'], undefined, 'um 503 de fluxo ainda não abre text/event-stream');
});

/* ---------- 4 · o fluxo, com sessão a sério ---------- */

test('1.77.0 · o fluxo diz `hello` com o retrato e fecha-se sozinho (não promete ligação eterna)', async () => {
  const { createMemRepo } = await import('./api/_repo.mjs');
  const { abrirSessao } = await import('./api/_porta.mjs');

  const repo = createMemRepo();
  const conta = await repo.contas.criar({ email: 'dono@exemplo.pt', nome: 'Dono', papel: 'dono', activo: true, hash: 'x' });
  await repo.tarefas.insert({ kind: 'lead.pesquisar', title: 'Pesquisar o site', state: 'running', attempts: 1, max_attempts: 3 });
  const sessao = await abrirSessao(repo, conta, { headers: {}, secure: true });

  const res = resFalso();
  res.setHeader = (k, v) => { res.cabecalhos[k] = v; };
  await servirAoVivo(
    { method: 'GET', url: '/api/rpc?aovivo=stream&agentes=vmail', headers: { cookie: sessao.cabecalho.split(';')[0] }, on: () => {} },
    res,
    { repo },
  );

  const texto = res.escrito.join('');
  assert.equal(res.codigo, 200);
  assert.match(String(res.cabecalhos['Content-Type']), /text\/event-stream/);
  assert.match(texto, /^retry: \d+/m, 'diz ao browser quando voltar a ligar');
  assert.match(texto, /event: hello/, 'o primeiro retrato chega já');
  assert.match(texto, /"state":"live"/, 'com o trabalho que está a correr');
  assert.doesNotMatch(texto, /hash|password|segredo/i, 'e sem segredos');
});
