// Ponte escritório ↔ base nova de agentes (orbita-core). Corre com fornecedor falso e pasta temporária.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as empresa from './empresa.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'empresa-test-'));
const SEM = () => false;
// cada teste começa sem motor detetado em cache
import { beforeEach } from 'node:test';
beforeEach(() => empresa.limparCacheMotor());

// fornecedor falso: escreve as entregas que o agente pede (lidas do próprio prompt)
const fornecedorFalso = async (_url, opts) => {
  const texto = JSON.parse(opts.body).messages[1].content;
  const m = texto.match(/Escreves estas entregas[^:]*: (.+?)\.?$/m);
  const lista = m ? m[1].split(', ') : [];
  const blocos = lista.map((f) => `=== ficheiro: ${f} ===\nconteúdo de ${f}\n=== fim ===`).join('\n');
  return { ok: true, json: async () => ({ choices: [{ message: { content: blocos } }] }) };
};
const ENV_API = { ORBITA_CORE_API_URL: 'https://fornecedor.test/v1', ORBITA_CORE_API_KEY: 'segredo-do-teste' };

test('estado: equipa, fluxo e motor, sem projetos ainda', () => {
  const dataDir = tmp();
  const e = empresa.estado({ dataDir, env: {}, agora: 1, detetar: SEM, perguntar: null });
  assert.equal(Object.keys(e.divisoes).length, 3);
  assert.equal(e.agentes.length, 14);
  assert.equal(e.fluxo.length, 10);
  assert.equal(e.motor.motor, 'sem-motor');
  assert.deepEqual(e.projetos, []);
  assert.ok(!JSON.stringify(e).includes('segredo'), 'nada de chaves no estado');
});

test('validarPedido: recusa nome vazio, pedido vazio, nome longo e motor desconhecido', () => {
  assert.match(empresa.validarPedido({ nome: '', pedido: 'x' }).erro, /nome/);
  assert.match(empresa.validarPedido({ nome: 'a', pedido: '   ' }).erro, /pedido/);
  assert.match(empresa.validarPedido({ nome: 'a'.repeat(81), pedido: 'x' }).erro, /máximo/);
  assert.match(empresa.validarPedido({ nome: 'a', pedido: 'x', motor: 'ollama' }).erro, /motor inválido/);
  assert.equal(empresa.validarPedido({ nome: 'a', pedido: 'x', motor: 'gratis' }).motor, 'gratis');
  const ok = empresa.validarPedido({ nome: '  Lista  ', pedido: ' x ' });
  assert.equal(ok.nome, 'Lista');
  assert.equal(ok.pedido, 'x');
});

test('criar sem motor não cria pasta nenhuma e diz porquê', () => {
  const dataDir = tmp();
  const r = empresa.criar({ dataDir, nome: 'Sem motor', pedido: 'x', env: {}, agora: 1, detetar: SEM, perguntar: null });
  assert.equal(r.status, 422);
  assert.equal(r.corpo.erro, 'sem motor');
  assert.equal(fs.existsSync(path.join(dataDir, 'empresa', 'projetos')), false);
});

test('criar com API: arranca o fluxo, escreve as entregas e fica concluído', async () => {
  const dataDir = tmp();
  const r = empresa.criar({ dataDir, nome: 'Lista de Compras', pedido: 'Lista partilhável, sem contas.', motor: 'api', env: ENV_API, fetchImpl: fornecedorFalso });
  assert.equal(r.status, 202);
  assert.equal(r.corpo.id, 'lista-de-compras');
  assert.equal(r.corpo.motor, 'api');
  await empresa.esperarFluxo(r.corpo.id);
  const p = empresa.lerProjeto({ dataDir, id: 'lista-de-compras' });
  assert.equal(p.correndo, false);
  assert.ok(p.etapas.every((e) => e.estado === 'concluido'), JSON.stringify(p.etapas.map((e) => e.estado)));
  assert.equal(p.passagens.length, 9);
  assert.ok(fs.existsSync(path.join(dataDir, 'empresa', 'projetos', 'lista-de-compras', 'site', 'index.html')));
  const e = empresa.estado({ dataDir, env: {}, agora: 2, detetar: SEM, perguntar: null });
  assert.equal(e.projetos[0].estado, 'concluido');
  assert.equal(e.projetos[0].etapasFeitas, 10);
});

test('criar o mesmo projeto outra vez devolve 409 e não apaga o existente', async () => {
  const dataDir = tmp();
  const a = empresa.criar({ dataDir, nome: 'Repetido', pedido: 'a', motor: 'api', env: ENV_API, fetchImpl: fornecedorFalso });
  await empresa.esperarFluxo(a.corpo.id);
  const b = empresa.criar({ dataDir, nome: 'Repetido', pedido: 'b', motor: 'api', env: ENV_API, fetchImpl: fornecedorFalso });
  assert.equal(b.status, 409);
  assert.ok(fs.existsSync(path.join(dataDir, 'empresa', 'projetos', 'repetido', 'project.json')));
});

test('lerProjeto: recusa ids que não são slugs (sem fugas de caminho) e devolve null se não existir', () => {
  const dataDir = tmp();
  assert.equal(empresa.lerProjeto({ dataDir, id: '../../etc' }), null);
  assert.equal(empresa.lerProjeto({ dataDir, id: 'Maiúsculas' }), null);
  assert.equal(empresa.lerProjeto({ dataDir, id: 'nao-existe' }), null);
  assert.equal(empresa.lerProjeto({ dataDir, id: undefined }), null);
});

test('motor escolhido por tarefa: API se o servidor a tiver, senão gratuito; o Claude Code só se for pedido', async () => {
  empresa.limparCacheMotor();
  const dataDir = tmp();
  const perguntar = async () => '';
  const api = empresa.estado({ dataDir, env: ENV_API, agora: 10, detetar: () => true, perguntar });
  assert.equal(api.motor.motor, 'api');
  empresa.limparCacheMotor();
  const gratis = empresa.estado({ dataDir, env: {}, agora: 100000, detetar: () => true, perguntar });
  assert.equal(gratis.motor.motor, 'gratis', 'com CLI instalado, por omissão não se usa o Claude Code');
  empresa.limparCacheMotor();
  const cli = empresa.criar({ dataDir, nome: 'Com CLI', pedido: 'x', motor: 'claude-cli', env: {}, detetar: () => true, perguntar: null });
  assert.equal(cli.status, 202, 'pedido à mão, o CLI é usado');
  assert.equal(cli.corpo.motor, 'claude-cli');
  await empresa.esperarFluxo(cli.corpo.id);
});

test('motor gratuito: corre o fluxo com a função de pergunta injetada (sem rede)', async () => {
  const dataDir = tmp();
  const pedidos = [];
  const perguntar = async (sistema, pedido) => {
    pedidos.push(sistema);
    // o fornecedor falso devolve as entregas pedidas (lidas do próprio pedido)
    const m = pedido.match(/Escreves estas entregas[^:]*: (.+?)\.?$/m);
    const lista = m ? m[1].split(', ') : [];
    return lista.map((f) => `=== ficheiro: ${f} ===\nconteúdo de ${f}\n=== fim ===`).join('\n');
  };
  const r = empresa.criar({ dataDir, nome: 'Gratuito', pedido: 'Uma página simples.', motor: 'gratis', env: {}, perguntar });
  assert.equal(r.status, 202);
  assert.equal(r.corpo.motor, 'gratis');
  await empresa.esperarFluxo(r.corpo.id);
  const p = empresa.lerProjeto({ dataDir, id: 'gratuito' });
  assert.ok(p.etapas.every((e) => e.estado === 'concluido'), JSON.stringify(p.etapas.map((e) => e.estado)));
  assert.equal(pedidos.length, 10, 'uma chamada por etapa');
  assert.ok(pedidos.every((x) => x.includes('=== ficheiro: CAMINHO ===')));
});

test('motor gratuito de ponta a ponta: a cadeia real (perguntarGratis) corre com a fronteira de rede substituída', async () => {
  const dataDir = tmp();
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push(String(url));
    const pedido = JSON.parse(opts.body).messages.at(-1).content;
    const m = pedido.match(/Escreves estas entregas[^:]*: (.+?)\.?$/m);
    const lista = m ? m[1].split(', ') : [];
    const content = lista.map((f) => `=== ficheiro: ${f} ===\nconteúdo de ${f}\n=== fim ===`).join('\n');
    const corpo = JSON.stringify({ choices: [{ message: { content } }] });
    return { ok: true, status: 200, text: async () => corpo, json: async () => JSON.parse(corpo) };
  };
  try {
    const r = empresa.criar({ dataDir, nome: 'Cadeia Real', pedido: 'Teste.', motor: 'gratis', env: {} });
    assert.equal(r.status, 202, JSON.stringify(r.corpo));
    await empresa.esperarFluxo(r.corpo.id);
    const p = empresa.lerProjeto({ dataDir, id: 'cadeia-real' });
    assert.ok(p.etapas.every((e) => e.estado === 'concluido'), JSON.stringify(p.etapas.map((e) => e.estado)));
    assert.ok(chamadas.length >= 10, 'a cadeia gratuita foi chamada');
    assert.ok(chamadas.every((u) => !u.includes('fornecedor.test')), 'nada foi para fora da cadeia gratuita');
  } finally {
    globalThis.fetch = original;
  }
});
