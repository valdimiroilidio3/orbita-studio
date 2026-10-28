/* ===========================================================================
   1.52.0 · A LISTA DE MODELOS DO PAINEL DE TAREFAS

   O dono: «lista de modelo na aba tarefas (sonnet,opus,fable) essa lista deve
   aumentar colocando todas as ias que aceitaram responder».

   O que se prova aqui, sem browser e sem rede:
     · a lista cresce com os pares reais do catálogo — e só com quem pode responder;
     · quem ficou de fora é contado (sem chave, desligado, inutilizável);
     · quem já respondeu de verdade vem à frente;
     · a escolha guarda-se como `fornecedor|modelo` e o rótulo diz o fornecedor;
     · nada cai em silêncio para sonnet — nem no servidor, nem no cartão.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  opcoesDoCatalogo, notaDaLista, parDeModelo, parDoPasso, chaveDoPar, etiquetaDoModelo, nomeCurto,
  provasDeGratuitos, provasDeUso, juntarProvas, DA_CASA,
} from './src/lista-modelos.js';
import { modelName, modelId, normModel } from './src/models.js';

const catalogo = () => ({
  fornecedores: [
    {
      id: 'ovh', nome: 'OVH AI Endpoints', comChave: true, desligado: false, gratuito: true,
      catalogo: [
        { modelo: 'Qwen3.5-9B', gratuito: true },
        { modelo: 'gpt-oss-120b', gratuito: true },
        { modelo: 'Qwen3.5-9B', gratuito: true }, // repetido: entra uma vez
      ],
    },
    { id: 'openrouter', nome: 'OpenRouter', comChave: false, desligado: false, catalogo: [{ modelo: 'qwen/qwen3-coder:free' }] },
    { id: 'vercel', nome: 'Vercel AI Gateway', comChave: true, desligado: true, catalogo: [{ modelo: 'openai/gpt-5-mini' }] },
    { id: 'aclide', nome: 'ACLIDE', comChave: true, desligado: false, estado: 'inutilizavel', catalogo: [] },
    { id: 'pollinations', nome: 'Pollinations', comChave: true, desligado: false, catalogo: [{ modelo: 'openai', gratuito: true }] },
  ],
});

test('a lista cresce: os três da casa e os pares reais da IA da Órbita', () => {
  const r = opcoesDoCatalogo(catalogo());
  assert.equal(r.grupos.length, 2);
  assert.deepEqual(r.grupos[0].opcoes.map((o) => o.valor), ['sonnet', 'opus', 'fable'], 'os três da casa não desaparecem');
  const orbita = r.grupos[1].opcoes.map((o) => o.valor).sort();
  assert.deepEqual(orbita, ['ovh|Qwen3.5-9B', 'ovh|gpt-oss-120b', 'pollinations|openai']);
  assert.match(r.grupos[1].rotulo, /IA da Órbita — 3 modelo/);
});

test('só entra quem pode responder agora — e o que fica de fora é contado', () => {
  const r = opcoesDoCatalogo(catalogo());
  const valores = r.grupos[1].opcoes.map((o) => o.valor);
  assert.equal(valores.some((v) => v.startsWith('openrouter|')), false, 'sem chave não entra');
  assert.equal(valores.some((v) => v.startsWith('vercel|')), false, 'desligado não entra');
  assert.equal(valores.some((v) => v.startsWith('aclide|')), false, 'inutilizável não entra');
  assert.deepEqual(r.contagem, { casa: 3, orbita: 3, comunidade: 0, semChave: 1, desligados: 1, inuteis: 1 });
  const nota = notaDaLista(r.contagem);
  assert.match(nota, /3 modelo\(s\) da IA da Órbita/);
  assert.match(nota, /1 fornecedor\(es\) sem chave/);
  assert.match(nota, /1 desligado\(s\)/);
  assert.match(nota, /1 inutilizável\(is\)/);
});

test('um modelo repetido no catálogo do fornecedor entra uma vez só', () => {
  const r = opcoesDoCatalogo(catalogo());
  assert.equal(r.grupos[1].opcoes.filter((o) => o.valor === 'ovh|Qwen3.5-9B').length, 1);
});

test('quem já respondeu de verdade vem à frente (a ordem é a da evidência)', () => {
  const provas = { provados: [{ fornec: 'ovh', modelo: 'gpt-oss-120b' }], ms: { 'ovh\u0000gpt-oss-120b': 900 } };
  const r = opcoesDoCatalogo(catalogo(), {}, provas);
  assert.equal(r.grupos[1].opcoes[0].valor, 'ovh|gpt-oss-120b');
  assert.match(r.grupos[1].opcoes[0].etiqueta, /provado/);
  /* um provado sem latência medida vem depois de um medido */
  const duas = { provados: [{ fornec: 'ovh', modelo: 'Qwen3.5-9B' }, { fornec: 'pollinations', modelo: 'openai' }], ms: { 'ovh\u0000Qwen3.5-9B': 3000 } };
  const r2 = opcoesDoCatalogo(catalogo(), {}, duas);
  assert.equal(r2.grupos[1].opcoes[0].valor, 'ovh|Qwen3.5-9B', 'o medido é o primeiro');
  assert.equal(r2.grupos[1].opcoes[1].valor, 'pollinations|openai', 'o provado sem medição vem depois');
});

test('sem catálogo (a Órbita não respondeu) a lista fica nos três — e a nota diz porquê', () => {
  const r = opcoesDoCatalogo(null);
  assert.equal(r.grupos.length, 1);
  assert.equal(r.grupos[0].opcoes.length, DA_CASA.length);
  assert.match(notaDaLista(r.contagem), /nenhum modelo com chave/);
  assert.equal(opcoesDoCatalogo({}).grupos.length, 1);
});

test('a escolha guarda-se como fornecedor|modelo e nunca é confundida com um nome da casa', () => {
  assert.equal(chaveDoPar('ovh', 'Qwen3.5-9B'), 'ovh|Qwen3.5-9B');
  assert.deepEqual(parDeModelo('ovh|Qwen3.5-9B'), { fornecedor: 'ovh', modelo: 'Qwen3.5-9B' });
  assert.deepEqual(parDeModelo('openrouter|qwen/qwen3-coder:free'), { fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free' });
  assert.equal(parDeModelo('sonnet'), null);
  assert.equal(parDeModelo('|x'), null);
  assert.equal(parDeModelo('ovh|'), null);
  assert.equal(normModel('ovh|Qwen3.5-9B'), null, 'o servidor não transforma um par num nome da casa');
});

test('o rótulo do cartão diz o modelo e o fornecedor, e os três da casa continuam a dizer o nome', () => {
  assert.equal(etiquetaDoModelo('ovh|Qwen3.5-9B'), 'Qwen3.5-9B · OVH AI Endpoints');
  assert.equal(etiquetaDoModelo('openrouter|qwen/qwen3-coder:free'), 'qwen3-coder:free · OpenRouter');
  assert.equal(etiquetaDoModelo('opus'), 'Opus');
  assert.equal(modelName('ovh|Qwen3.5-9B'), 'Qwen3.5-9B · OVH AI Endpoints');
  assert.equal(modelName('opus'), 'Opus');
  assert.equal(modelId('ovh|Qwen3.5-9B'), 'ovh|Qwen3.5-9B', 'o id de um par é o par');
  assert.equal(nomeCurto('a/b/c'), 'c');
});

/* ---------- as garantias no código que corre (o painel e o servidor) ---------- */
const fonte = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

test('o painel de tarefas constrói o menu a partir do catálogo, não de uma lista fixa', () => {
  const s = fonte('src/tasks.js');
  assert.match(s, /opcoesDoCatalogo\(/, 'o menu tem de sair do catálogo');
  assert.match(s, /carregarCatalogo\(\)/, 'e o catálogo tem de ser pedido');
  assert.match(s, /\/rpc\?caminho=/, 'por /api/rpc, que é o único caminho na Vercel');
  assert.match(s, /notaDaLista\(/, 'o que ficou de fora é dito');
  assert.doesNotMatch(s, /P_\.model\.innerHTML = MODEL_KEYS\.map/, 'a lista fixa já não desenha o menu');
});

test('a precedência do par é a da casa: tarefa > rotina > agente > escritório', () => {
  const par = { fornecedor: 'ovh', modelo: 'Qwen3.5-9B' };
  assert.deepEqual(parDoPasso({ tarefa: 'ovh|Qwen3.5-9B', rotina: 'llm7|x', agente: 'pollinations|openai', escritorio: 'groq|y' }), par);
  assert.deepEqual(parDoPasso({ tarefa: 'opus', rotina: 'llm7|x' }), { fornecedor: 'llm7', modelo: 'x' }, 'um nome do CLI não trava a rotina');
  assert.deepEqual(parDoPasso({ tarefa: 'sonnet', agente: 'pollinations|openai' }), { fornecedor: 'pollinations', modelo: 'openai' });
  assert.equal(parDoPasso({ tarefa: 'sonnet', rotina: 'opus', agente: 'fable', escritorio: 'sonnet' }), null, 'sem par, o CLI decide');
  assert.equal(parDoPasso(), null);
});

test('o servidor corre a tarefa no fornecedor escolhido — e diz quem respondeu', () => {
  const s = fonte('serve.mjs');
  assert.match(s, /askOrbita\(/, 'há uma via da IA da Órbita para o passo da tarefa');
  assert.match(s, /criarMotor\(/, 'com o mesmo motor do /api/rpc');
  assert.match(s, /parDoPasso\(/, 'a precedência do par é uma regra só (lista-modelos.js)');
  assert.match(s, /limite: 1/, 'a escolha é uma escolha: um pedido, sem trocar de modelo em silêncio');
  assert.match(s, /modelUsed: par \?/, 'o cartão fica com o par que respondeu');
  assert.doesNotMatch(s, /model: normModel\(model\) \|\| undefined, effort/, 'um par já não é apagado para sonnet');
});

/* ---------- a escolha é uma escolha: o motor não a troca em silêncio ---------- */
test('o motor fixa o par escolhido (antes, o «medido» passava-lhe à frente)', async () => {
  const { criarMotor } = await import('./api/_ia/motor.mjs');
  const { createMemRepo } = await import('./api/_repo.mjs');
  const pedidos = [];
  const fetchImpl = async (url) => {
    pedidos.push(url);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'olá' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const motor = criarMotor({ repo: createMemRepo(), env: {}, fetchImpl });
  const r = await motor.pedir('texto', [{ role: 'user', content: 'olá' }], {
    preferido: { fornecedor: 'ovh', modelo: 'Qwen3.5-9B' }, limite: 1, fixo: true, maxTokens: 2400,
  });
  assert.equal(r.fornec, 'ovh', 'quem respondeu é quem foi escolhido');
  assert.equal(r.modelo, 'Qwen3.5-9B');
  assert.match(pedidos[0], /ovh|kepler/, 'o pedido foi mesmo ao fornecedor escolhido');
  assert.doesNotMatch(pedidos[0], /llm7/, 'não foi ao LLM7 (o «medido» já não ganha ao escolhido)');
});

test('quando o modelo escolhido não responde, a razão é dele — não se troca por outro', async () => {
  const { criarMotor } = await import('./api/_ia/motor.mjs');
  const { createMemRepo } = await import('./api/_repo.mjs');
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'modelo indisponível' } }), { status: 404, headers: { 'content-type': 'application/json' } });
  const motor = criarMotor({ repo: createMemRepo(), env: {}, fetchImpl });
  await assert.rejects(
    () => motor.pedir('texto', [{ role: 'user', content: 'olá' }], { preferido: { fornecedor: 'ovh', modelo: 'Qwen3.5-9B' }, limite: 1, fixo: true }),
    (e) => {
      assert.match(e.message, /o modelo escolhido não respondeu/);
      assert.match(e.message, /ovh\/Qwen3\.5-9B/);
      return true;
    },
  );
});

/* ---------- 1.52.1 · as provas e a prova de fora ---------- */
test('as provas do servidor local são lidas nas duas formas (catalogo e modelos)', () => {
  /* a rota local (1.32.0) responde com `modelos`; a da mesa, com `catalogo`. Ler só
     uma das formas fazia a ordem por evidência nunca se aplicar no `npm start`. */
  const local = { ok: true, modelos: [{ fornec: 'llm7', modelo: 'codestral-latest', ms: 1500 }, { fornec: 'ovh', modelo: 'gpt-oss-120b' }] };
  const p1 = provasDeGratuitos(local);
  assert.deepEqual(p1.provados, [{ fornec: 'llm7', modelo: 'codestral-latest' }, { fornec: 'ovh', modelo: 'gpt-oss-120b' }]);
  assert.equal(p1.ms['llm7\u0000codestral-latest'], 1500);

  const mesa = { catalogo: [{ fornec: 'ovh', modelo: 'Qwen3.5-9B', ms: 8644 }] };
  const p2 = provasDeGratuitos(mesa);
  assert.deepEqual(p2.provados, [{ fornec: 'ovh', modelo: 'Qwen3.5-9B' }]);
  assert.equal(p2.ms['ovh\u0000Qwen3.5-9B'], 8644);

  /* as duas juntas não repetem ninguém */
  const ambas = provasDeGratuitos({ modelos: [{ fornec: 'llm7', modelo: 'x', ms: 10 }], medido: [{ fornec: 'llm7', modelo: 'x', ms: 10 }] });
  assert.equal(ambas.provados.length, 1);

  assert.deepEqual(provasDeGratuitos(null), { provados: [], ms: {} });
  assert.deepEqual(provasDeGratuitos({ nada: true }), { provados: [], ms: {} });
});

test('a prova de fora calcula a mesma lista que o painel (sem segunda opinião)', async () => {
  const { provaDaLista } = await import('./api/_ia/lista.mjs');
  const cat = catalogo();
  const painel = opcoesDoCatalogo(cat);
  const prova = provaDaLista({ catalogo: cat });
  /* e com a evidência de produção (a rota faz o mesmo que o painel) */
  const comUso = provaDaLista({ catalogo: cat, uso: { ultimos: [{ fornecedor: 'ovh', modelo: 'Qwen3.5-9B', ok: true, ms: 1200 }] } });
  assert.equal(comUso.provasLidas, 1);
  assert.match(comUso.grupos[1].opcoes[0], /provado/);
  assert.equal(prova.totalNoMenu, painel.grupos.reduce((n, g) => n + g.opcoes.length, 0));
  assert.deepEqual(prova.grupos[0].valores, ['sonnet', 'opus', 'fable']);
  assert.deepEqual(prova.grupos[1].valores, painel.grupos[1].opcoes.map((o) => o.valor));
  assert.deepEqual(prova.contagem, painel.contagem);
  assert.equal(prova.nota, notaDaLista(painel.contagem));
});

/* ---------- 1.52.2 · a evidência de produção (/ia/uso) ---------- */
test('as provas de produção vêm do registo de uso: só quem respondeu, com a resposta mais rápida', () => {
  const uso = { ultimos: [
    { fornecedor: 'pollinations', modelo: 'openai', ok: true, ms: 3200 },
    { fornecedor: 'pollinations', modelo: 'openai', ok: true, ms: 1800 },
    { fornecedor: 'pollinations', modelo: 'x-ai/grok-4.20', ok: true, ms: 5697 },
    { fornecedor: 'llm7', modelo: 'falhou', ok: false, ms: 100 },
    { fornecedor: 'x', ok: true, ms: 5 },              // sem modelo: não conta
  ] };
  const p = provasDeUso(uso);
  assert.deepEqual(p.provados, [
    { fornec: 'pollinations', modelo: 'openai' },
    { fornec: 'pollinations', modelo: 'x-ai/grok-4.20' },
  ]);
  assert.equal(p.ms['pollinations\u0000openai'], 1800, 'guarda a resposta mais rápida, não a última');
  assert.deepEqual(provasDeUso(null), { provados: [], ms: {} });
});

test('as duas fontes somam-se sem repetir, e a latência menor ganha', () => {
  const a = { provados: [{ fornec: 'ovh', modelo: 'Qwen3.5-9B' }], ms: { 'ovh\u0000Qwen3.5-9B': 9000 } };
  const b = { provados: [{ fornec: 'ovh', modelo: 'Qwen3.5-9B' }, { fornec: 'llm7', modelo: 'x' }], ms: { 'ovh\u0000Qwen3.5-9B': 2000, 'llm7\u0000x': 600 } };
  const j = juntarProvas(a, b);
  assert.equal(j.provados.length, 2);
  assert.equal(j.ms['ovh\u0000Qwen3.5-9B'], 2000);
  assert.equal(j.ms['llm7\u0000x'], 600);
  assert.deepEqual(juntarProvas(null, undefined), { provados: [], ms: {} });
});

test('um modelo descoberto só entra na lista se já respondeu (o resto seria uma lista que falha)', () => {
  const cat = { fornecedores: [{
    id: 'pollinations', nome: 'Pollinations', comChave: true, gratuito: true,
    catalogo: [{ modelo: 'openai', gratuito: true }],
    descobertos: [{ id: 'x-ai/grok-4.20' }, { id: 'community/nunca-testado' }],
  }] };
  const provas = provasDeUso({ ultimos: [
    { fornecedor: 'pollinations', modelo: 'x-ai/grok-4.20', ok: true, ms: 5697 },
    { fornecedor: 'pollinations', modelo: 'community/nunca-testado', ok: false, ms: 90 },
  ] });
  const valores = opcoesDoCatalogo(cat, {}, provas).grupos[1].opcoes.map((o) => o.valor);
  assert.deepEqual(valores.sort(), ['pollinations|openai', 'pollinations|x-ai/grok-4.20']);
  assert.equal(valores.includes('pollinations|community/nunca-testado'), false, 'um modelo que falhou não é oferecido');
});

/* ---------- 1.52.3 · a comunidade tem grupo próprio, no fim ---------- */
test('os modelos community/… ficam num grupo próprio — não encabeçam a lista com nomes estranhos', () => {
  const cat = { fornecedores: [{
    id: 'pollinations', nome: 'Pollinations', comChave: true, gratuito: true,
    catalogo: [{ modelo: 'openai', gratuito: true }],
    descobertos: [
      { id: 'community/Marcus-Mok-GH/pt-harbor' },
      { id: 'x-ai/grok-4.20' },
    ],
  }] };
  const provas = provasDeUso({ ultimos: [
    { fornecedor: 'pollinations', modelo: 'community/Marcus-Mok-GH/pt-harbor', ok: true, ms: 3000 },
    { fornecedor: 'pollinations', modelo: 'x-ai/grok-4.20', ok: true, ms: 4000 },
  ] });
  const r = opcoesDoCatalogo(cat, {}, provas);
  assert.equal(r.grupos.length, 3);
  assert.match(r.grupos[1].rotulo, /IA da Órbita — 2 modelo\(s\), 1 já responderam/);
  assert.equal(r.grupos[1].opcoes[0].valor, 'pollinations|x-ai/grok-4.20', 'o provado «normal» vai à frente');
  assert.match(r.grupos[2].rotulo, /Comunidade — 1 modelo/);
  assert.equal(r.grupos[2].opcoes[0].valor, 'pollinations|community/Marcus-Mok-GH/pt-harbor');
  assert.match(r.grupos[2].opcoes[0].etiqueta, /Marcus-Mok-GH\/pt-harbor · provado/, 'mostra a origem, não só o último pedaço');
  assert.equal(r.contagem.comunidade, 1);
});
