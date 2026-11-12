import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENTES, DIVISOES, daDivisao, agente } from '../src/elenco.mjs';
import { escolherMotor, dentroDaPasta, executarAgente, instrucaoDoAgente } from '../src/motores.mjs';
import { FLUXO, criarProjeto, correrFluxo, escreverPassagem } from '../src/equipa.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-core-'));

test('elenco: três divisões, ids únicos e campos completos', () => {
  const ids = AGENTES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'ids duplicados');
  assert.deepEqual(Object.keys(DIVISOES), ['produto', 'design', 'programacao']);
  for (const a of AGENTES) {
    for (const campo of ['nome', 'papel', 'jeito', 'missao', 'criterio']) assert.ok(a[campo], `${a.id} sem ${campo}`);
    assert.ok(a.entregas.length > 0, `${a.id} sem entregas`);
    assert.ok(a.recebe.length > 0, `${a.id} sem passagens de entrada`);
  }
  assert.ok(daDivisao('produto').length >= 3);
  assert.ok(daDivisao('design').length >= 3);
  assert.ok(daDivisao('programacao').length >= 5);
});

test('fluxo: só usa agentes do elenco e só nas três divisões', () => {
  for (const passo of FLUXO) {
    const a = agente(passo.agente);
    assert.ok(['produto', 'design', 'programacao'].includes(a.divisao));
  }
  assert.equal(new Set(FLUXO.map((p) => p.agente)).size, FLUXO.length, 'agente repetido no fluxo');
});

test('caminhos: recusa fuga da pasta do projeto', () => {
  const pasta = tmp();
  assert.throws(() => dentroDaPasta(pasta, '../fora.txt'), /fora do projeto/);
  assert.throws(() => dentroDaPasta(pasta, 'a/../../fora.txt'), /fora do projeto/);
  assert.throws(() => dentroDaPasta(pasta, '/etc/passwd'), /fora do projeto/);
  assert.throws(() => dentroDaPasta(pasta, ''), /vazio/);
  assert.equal(dentroDaPasta(pasta, 'site/index.html'), path.join(path.resolve(pasta), 'site', 'index.html'));
});

test('motor: sem CLI e sem chave resulta em sem-motor, nunca em sucesso falso', () => {
  const r = escolherMotor({ env: {}, detetarCli: () => false });
  assert.equal(r.motor, 'sem-motor');
  assert.match(r.motivo, /Nenhum motor/);
});

test('motor: por omissão usa a API (se configurada), depois o gratuito; o Claude Code nunca entra sozinho', () => {
  const perguntar = async () => '';
  const env = { ORBITA_CORE_API_URL: 'https://x.test/v1', ORBITA_CORE_API_KEY: 'k' };
  assert.equal(escolherMotor({ env, detetarCli: () => true, perguntar }).motor, 'api');
  assert.equal(escolherMotor({ env: {}, detetarCli: () => true, perguntar }).motor, 'gratis');
  assert.equal(escolherMotor({ env: {}, detetarCli: () => true }).motor, 'sem-motor', 'com CLI instalado e sem gratuito, não se usa o Claude Code por omissão');
});

test('motor gratuito: sem função de pergunta fica sem-motor, com razão', () => {
  const r = escolherMotor({ preferido: 'gratis', env: {} });
  assert.equal(r.motor, 'sem-motor');
  assert.match(r.motivo, /não está ligado/);
});

test('motor gratuito: corre um agente com a função injetada e escreve os ficheiros', async () => {
  const pasta = tmp();
  const pedidos = [];
  const perguntar = async (system, user) => { pedidos.push({ system, user }); return '=== ficheiro: site/index.html ===\n<h1>Olá</h1>\n=== fim ==='; };
  const r = await executarAgente({ motor: escolherMotor({ preferido: 'gratis', perguntar }), agente: agente('dev-frontend'), tarefa: 't', entregas: ['site/index.html'], pasta });
  assert.equal(r.ok, true);
  assert.equal(r.motor, 'gratis');
  assert.equal(fs.readFileSync(path.join(pasta, 'site/index.html'), 'utf8'), '<h1>Olá</h1>');
  assert.match(pedidos[0].system, /=== ficheiro: CAMINHO ===/, 'o formato de blocos segue no pedido');
  assert.match(pedidos[0].user, /Desenvolvedor Frontend/);
});

test('motor gratuito: se nenhum modelo responde, a etapa fica em erro com a causa (sem inventar ficheiros)', async () => {
  const pasta = tmp();
  const perguntar = async () => { throw new Error('todos os modelos falharam'); };
  const r = await executarAgente({ motor: escolherMotor({ preferido: 'gratis', perguntar }), agente: agente('dev-frontend'), tarefa: 't', entregas: ['a.html'], pasta });
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'erro');
  assert.match(r.erro, /nenhum modelo gratuito respondeu: todos os modelos falharam/);
  assert.deepEqual(fs.readdirSync(pasta), []);
});

test('motor gratuito: resposta sem blocos não escreve nada', async () => {
  const pasta = tmp();
  const perguntar = async () => 'desculpa, não posso';
  const r = await executarAgente({ motor: escolherMotor({ preferido: 'gratis', perguntar }), agente: agente('dev-frontend'), tarefa: 't', entregas: ['a.html'], pasta });
  assert.equal(r.estado, 'sem-ficheiros');
  assert.equal(fs.existsSync(path.join(pasta, 'a.html')), false);
});

test('motor gratuito: um caminho fora do projeto recusa a resposta inteira', async () => {
  const pasta = tmp();
  const perguntar = async () => '=== ficheiro: ok.html ===\nbom\n=== fim ===\n=== ficheiro: ../fuga.txt ===\nmau\n=== fim ===';
  const r = await executarAgente({ motor: escolherMotor({ preferido: 'gratis', perguntar }), agente: agente('dev-frontend'), tarefa: 't', entregas: ['ok.html'], pasta });
  assert.equal(r.ok, false);
  assert.match(r.erro, /fora do projeto/);
  assert.equal(fs.existsSync(path.join(pasta, 'ok.html')), false, 'nada fica a meio');
});

test('motor: forçar um motor indisponível diz porquê', () => {
  assert.equal(escolherMotor({ preferido: 'api', env: {} }).motor, 'sem-motor');
  assert.equal(escolherMotor({ preferido: 'claude-cli', env: {}, detetarCli: () => false }).motor, 'sem-motor');
});

test('instrução do agente inclui papel, entregas e a regra de não inventar testes', () => {
  const txt = instrucaoDoAgente(agente('dev-backend'), 'tarefa', ['server/server.mjs']);
  assert.match(txt, /Desenvolvedor Backend/);
  assert.match(txt, /server\/server\.mjs/);
  assert.match(txt, /Não inventes resultados de testes/);
});

test('motor API: escreve os ficheiros devolvidos e recusa caminhos fora do projeto', async () => {
  const pasta = tmp();
  const env = { ORBITA_CORE_API_URL: 'https://x.test/v1', ORBITA_CORE_API_KEY: 'segredo-teste' };
  const resposta = (texto) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: texto } }] }) });

  const bom = await executarAgente({
    motor: { motor: 'api', modelo: 'm' }, agente: agente('dev-frontend'), tarefa: 't',
    entregas: ['site/index.html'], pasta, env,
    fetchImpl: resposta('=== ficheiro: site/index.html ===\n<h1>Olá</h1>\n=== fim ===\n'),
  });
  assert.equal(bom.ok, true);
  assert.equal(fs.readFileSync(path.join(pasta, 'site/index.html'), 'utf8'), '<h1>Olá</h1>');

  const mau = await executarAgente({
    motor: { motor: 'api', modelo: 'm' }, agente: agente('dev-frontend'), tarefa: 't',
    entregas: ['x.html'], pasta: tmp(), env,
    fetchImpl: resposta('=== ficheiro: ../fuga.txt ===\nnada\n=== fim ===\n'),
  });
  assert.equal(mau.ok, false);
  assert.match(mau.erro, /fora do projeto/);
});

test('motor API: a chave não aparece em erros nem em ficheiros', async () => {
  const pasta = tmp();
  const env = { ORBITA_CORE_API_URL: 'https://x.test/v1', ORBITA_CORE_API_KEY: 'segredo-teste' };
  const r = await executarAgente({
    motor: { motor: 'api', modelo: 'm' }, agente: agente('dev-frontend'), tarefa: 't',
    entregas: ['a.html'], pasta, env,
    fetchImpl: async () => { throw new TypeError('rede em baixo'); },
  });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('segredo-teste'));
});

test('fluxo completo com motor falso: cria passagens, entregas e project.json', async () => {
  const raiz = tmp();
  const { pasta } = criarProjeto(raiz, { nome: 'Lista de Compras', pedido: 'Uma lista simples.' });
  // motor que escreve cada entrega pedida
  const fetchImpl = async (_url, opts) => {
    const corpo = JSON.parse(opts.body);
    const texto = corpo.messages[1].content;
    const linhas = [...texto.matchAll(/Escreves estas entregas[^:]*: (.+?)\.?$/gm)];
    const lista = linhas.length ? linhas[0][1].split(', ') : [];
    const blocos = lista.map((f) => `=== ficheiro: ${f} ===\nconteúdo de ${f}\n=== fim ===`).join('\n');
    return { ok: true, json: async () => ({ choices: [{ message: { content: blocos } }] }) };
  };
  const env = { ORBITA_CORE_API_URL: 'https://x.test/v1', ORBITA_CORE_API_KEY: 'k' };
  const r = await correrFluxo(pasta, { motor: { motor: 'api', modelo: 'm' }, env, fetchImpl });
  assert.equal(r.estado, 'concluido');
  for (const passo of FLUXO) for (const f of passo.entregas) assert.ok(fs.existsSync(path.join(pasta, f)), `falta ${f}`);
  const passagens = fs.readdirSync(path.join(pasta, 'handoffs'));
  assert.equal(passagens.length, FLUXO.length - 1, 'uma passagem por transição');
  const estado = JSON.parse(fs.readFileSync(path.join(pasta, 'project.json'), 'utf8'));
  assert.ok(estado.etapas.every((e) => e.estado === 'concluido'));
});

test('fluxo sem motor: para na primeira etapa e não marca nada como feito', async () => {
  const raiz = tmp();
  const { pasta } = criarProjeto(raiz, { nome: 'Teste Parado', pedido: 'x' });
  const r = await correrFluxo(pasta, { motor: { motor: 'sem-motor', motivo: 'sem chave' } });
  assert.equal(r.estado, 'parado');
  assert.equal(r.etapas[0].estado, 'sem-motor');
  assert.ok(r.etapas.slice(1).every((e) => e.estado === 'por-fazer'), 'não salta à frente');
});

test('projeto: não sobrescreve um projeto existente', () => {
  const raiz = tmp();
  criarProjeto(raiz, { nome: 'Repetido', pedido: 'a' });
  assert.throws(() => criarProjeto(raiz, { nome: 'Repetido', pedido: 'b' }), /já existe/);
});

test('passagem: grava metadados e critérios no formato de handoff', () => {
  const pasta = tmp();
  const nome = escreverPassagem(pasta, {
    de: 'gestor-produto', para: 'priorizador-sprint', fase: 'produto',
    contexto: 'c', pedido: 'p', criterios: ['um', 'dois'], evidencia: 'e',
  });
  const txt = fs.readFileSync(path.join(pasta, 'handoffs', nome), 'utf8');
  assert.match(txt, /- de: gestor-produto/);
  assert.match(txt, /- para: priorizador-sprint/);
  assert.match(txt, /1\. um\n2\. dois/);
});
