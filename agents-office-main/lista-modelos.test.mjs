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
  opcoesDoCatalogo, notaDaLista, parDeModelo, parDoPasso, chaveDoPar, etiquetaDoModelo, nomeCurto, DA_CASA,
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
  assert.deepEqual(r.contagem, { casa: 3, orbita: 3, semChave: 1, desligados: 1, inuteis: 1 });
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
