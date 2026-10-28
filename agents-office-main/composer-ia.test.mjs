/* ===========================================================================
   1.51.0 · a IA da Órbita dentro do compositor — o que se testa aqui é a
   decisão, não o desenho: que pares entram na lista, que pares ficam de fora
   (e são contados), como a escolha se guarda, e que agente da Órbita responde
   por cada posto do escritório.

   Sem jsdom e sem browser: são funções puras de `src/composer.js`, e é isso
   que permite discuti-las (a lição do harness de office.test.mjs).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chaveDeModelo, dividirModelo, modelosDoCatalogo, agenteDaOrbita, IA_SEP,
  corpoDaOrbita, lerRespostaOrbita, juntarAnexos, ROTA_CHAT_ORBITA,
} from './src/composer.js';

/* ---------- a chave da escolha ---------- */
test('a escolha guarda-se como fornecedor|modelo e volta a abrir-se inteira', () => {
  const chave = chaveDeModelo('openrouter', 'qwen/qwen3-coder:free');
  assert.equal(chave, `openrouter${IA_SEP}qwen/qwen3-coder:free`);
  assert.deepEqual(dividirModelo(chave), { fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free' });
  /* um modelo com barras e dois pontos não parte a chave: só o primeiro separador conta */
  assert.deepEqual(dividirModelo(chaveDeModelo('ovh', 'meta/llama:3.3-70b')), { fornecedor: 'ovh', modelo: 'meta/llama:3.3-70b' });
});

test('um nome do CLI nunca é confundido com um par da Órbita', () => {
  assert.equal(dividirModelo('sonnet'), null, '«sonnet» é um modelo do CLI, não um par');
  assert.equal(dividirModelo(''), null);
  assert.equal(dividirModelo('|modelo'), null, 'sem fornecedor não há par');
  assert.equal(dividirModelo('fornecedor|'), null, 'sem modelo não há par');
  assert.equal(dividirModelo(undefined), null);
});

/* ---------- o catálogo ---------- */
const CATALOGO = {
  fornecedores: [
    {
      id: 'openrouter', nome: 'OpenRouter', comChave: true, desligado: false, gratuito: true,
      catalogo: [
        { modelo: 'qwen/qwen3-coder:free', gratuito: true },
        { modelo: 'openai/gpt-oss-120b:free', gratuito: true },
        { modelo: 'qwen/qwen3-coder:free', gratuito: true }, // repetido no catálogo: entra uma vez
      ],
    },
    { id: 'semchave', nome: 'Sem Chave', comChave: false, desligado: false, catalogo: [{ modelo: 'x' }] },
    { id: 'desligado', nome: 'Desligado', comChave: true, desligado: true, catalogo: [{ modelo: 'y' }] },
    { id: 'ovh', nome: 'OVH AI Endpoints', comChave: true, desligado: false, catalogo: ['Qwen3.5-9B'] },
  ],
  esforcos: ['low', 'high'],
  esforcoNota: 'o esforço é o tecto de tokens da resposta',
};

test('só entram modelos de fornecedores que podem responder agora', () => {
  const r = modelosDoCatalogo(CATALOGO);
  const ids = [...new Set(r.modelos.map((m) => m.key.split('|')[0]))].sort();
  assert.deepEqual(ids, ['openrouter', 'ovh'], 'sem chave e desligado ficam de fora');
  assert.equal(r.semChave, 1);
  assert.equal(r.desligados, 1);
});

test('um modelo repetido não aparece duas vezes e a chave é a do par', () => {
  const r = modelosDoCatalogo(CATALOGO);
  const coders = r.modelos.filter((m) => m.model === 'qwen/qwen3-coder:free');
  assert.equal(coders.length, 1);
  assert.equal(coders[0].key, `openrouter${IA_SEP}qwen/qwen3-coder:free`);
  assert.equal(coders[0].provider, 'OpenRouter');
  assert.equal(coders[0].badge, 'O', 'o distintivo é o do fornecedor, não um «A» fixo');
});

test('o catálogo aceita as duas formas (objecto e nome solto) e não inventa nada', () => {
  const r = modelosDoCatalogo(CATALOGO);
  assert.equal(r.modelos.some((m) => m.model === 'Qwen3.5-9B'), true, 'um nome solto também é um modelo');
  assert.deepEqual(modelosDoCatalogo({}).modelos, []);
  assert.deepEqual(modelosDoCatalogo(null).modelos, []);
  assert.deepEqual(modelosDoCatalogo(undefined).modelos, []);
});

test('quem já respondeu a um pedido real vem primeiro', () => {
  const estado = { fornecedores: [{ id: 'ovh', configurado: true, testado: true, ultimoTeste: { ok: true } }] };
  const r = modelosDoCatalogo(CATALOGO, estado);
  assert.equal(r.modelos[0].provider, 'OVH AI Endpoints');
  assert.equal(r.modelos[0].testado, true);
  /* e um teste falhado não conta como provado */
  const falhado = modelosDoCatalogo(CATALOGO, { fornecedores: [{ id: 'ovh', testado: true, ultimoTeste: { ok: false } }] });
  assert.equal(falhado.modelos.find((m) => m.provider === 'OVH AI Endpoints').testado, false);
});

test('os níveis de esforço e a nota vêm do servidor, não da interface', () => {
  const r = modelosDoCatalogo(CATALOGO);
  assert.deepEqual(r.esforcos, ['low', 'high']);
  assert.match(r.nota, /tecto de tokens/);
  assert.deepEqual(modelosDoCatalogo({ fornecedores: [], esforcos: 'nada' }).esforcos, [], 'lixo não passa');
});

/* ---------- a ponte dos agentes ---------- */
test('cada posto do escritório tem um agente da Órbita a responder por ele', () => {
  assert.equal(agenteDaOrbita({ id: 'elead', dept: 'emails' }), 'orchestrator', 'a direcção planeia');
  assert.equal(agenteDaOrbita({ id: 'pros', dept: 'sales' }), 'research', 'a prospeção procura');
  assert.equal(agenteDaOrbita({ id: 'gfx', dept: 'fin' }), 'design');
  assert.equal(agenteDaOrbita({ id: 'crep', dept: 'delivery' }), 'frontend', 'o posto manda sobre a sala');
  assert.equal(agenteDaOrbita({ id: 'qa', dept: 'delivery' }), 'qa');
  assert.equal(agenteDaOrbita({ id: 'vid', dept: 'marketing' }), 'creative');
  assert.equal(agenteDaOrbita({ id: 'legal', dept: 'ops' }), 'reviewer');
});

test('um posto desconhecido cai na sala, e uma sala desconhecida em research — nunca em nada', () => {
  assert.equal(agenteDaOrbita({ id: 'novo-posto', dept: 'delivery' }), 'backend');
  assert.equal(agenteDaOrbita({ id: 'novo-posto', dept: 'sala-que-nao-existe' }), 'research');
  assert.equal(agenteDaOrbita({}), 'research');
  assert.equal(agenteDaOrbita(), 'research');
});

/* ---------- o pedido e a resposta ---------- */
test('o pedido vai por /api/rpc com o contrato da mesa, e leva só o que existe', () => {
  const semPar = corpoDaOrbita({ agente: 'research', mensagem: 'olá' });
  assert.equal(semPar.caminho, '/ia/chat', 'dentro do envelope /api/rpc, o caminho é o da conversa');
  assert.equal(ROTA_CHAT_ORBITA, semPar.caminho);
  assert.equal(semPar.corpo.mensagem, 'olá');
  /* auto: nenhum fornecedor inventado — o router decide */
  assert.equal('fornecedor' in semPar.corpo, false);
  assert.equal('modelo' in semPar.corpo, false);
  assert.equal('esforco' in semPar.corpo, false);

  const comPar = corpoDaOrbita({ mensagem: 'olá', par: { fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free' }, esforco: 'high' });
  assert.equal(comPar.corpo.fornecedor, 'openrouter');
  assert.equal(comPar.corpo.modelo, 'qwen/qwen3-coder:free');
  assert.equal(comPar.corpo.esforco, 'high');
  assert.equal(comPar.corpo.agente, 'research', 'um agente por omissão, nunca nenhum');
});

test('a resposta diz quem respondeu — o que foi pedido pode não ser quem respondeu', () => {
  const out = lerRespostaOrbita({ status: 200, corpo: {
    resposta: 'aqui está', fornecedor: 'ovh', modelo: 'Qwen3.5-9B', ms: 1234,
    esforco: { pedido: 'high', maxTokens: 2400 }, ferramentas: [{}, {}],
  } }, { fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free' });
  assert.equal(out.ok, true);
  assert.equal(out.texto, 'aqui está');
  assert.match(out.meta, /ovh · Qwen3\.5-9B/, 'mostra quem respondeu, não o que se pediu');
  assert.match(out.meta, /tecto 2400 tokens/);
  assert.match(out.meta, /1\.2 s/);
  assert.match(out.meta, /2 ferramenta/);
});

test('uma recusa é lida como recusa, com a razão do servidor e sem fingir resposta', () => {
  const out = lerRespostaOrbita({ status: 400, corpo: { error: 'o modelo «x» não está no catálogo de openrouter' } });
  assert.equal(out.ok, false);
  assert.match(out.erro, /não está no catálogo/);
  /* corpo solto (o servidor local responde directo em algumas rotas) também é aceite */
  const solto = lerRespostaOrbita({ resposta: 'olá', fornecedor: 'pollinations', modelo: 'openai' });
  assert.equal(solto.ok, true);
  assert.match(solto.meta, /pollinations · openai/);
  /* e uma resposta vazia não vira conversa */
  assert.equal(lerRespostaOrbita({ status: 200, corpo: {} }).ok, false);
  assert.equal(lerRespostaOrbita(null).ok, false);
});

test('os anexos entram na mensagem e o que não couber é contado', () => {
  const { mensagem, cortados } = juntarAnexos('olha isto', [
    { name: 'a.md', text: 'linha A' },
    { name: 'b.md', text: 'x'.repeat(9000) },
  ]);
  assert.match(mensagem, /^olha isto\n\n--- a\.md ---\nlinha A$/);
  assert.equal(cortados, 1, 'o anexo grande ficou de fora e é dito');
  assert.equal(juntarAnexos('sem anexos').mensagem, 'sem anexos');
});
