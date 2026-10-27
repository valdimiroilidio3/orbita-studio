// Testes dos motores gratuitos (1.32.0, 27 out 2026).
//
// O que se prova aqui, sem rede:
//   · a lista curada existe, é keyless e diz quando foi medida;
//   · a cadeia põe o que já respondeu à frente — o LLM7/codestral deixou de ser
//     ignorado só porque o catálogo não o tinha para aquele fornecedor;
//   · em «visão» a cadeia fica vazia em vez de aceitar um modelo sem olhos;
//   · o router salta um modelo que o fornecedor diz não ter, e a lista de
//     «fora» sobrevive a um processo novo (o problema do serverless);
//   · o motor pede mesmo ao modelo certo e responde — a IA gratuita trabalha;
//   · `GET /ia/gratuitos` responde sem revelar chaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FORNECEDORES } from './api/_ia/catalogo.mjs';
import {
  PROVADOS, curado, estadoCurto, porVelocidade, provadosActivos, resumo,
} from './api/_ia/gratuitos.mjs';
import {
  cadeia, exportarFora, falarComFallback, foraDoAr, importarFora, limparFora, marcarFora,
} from './api/_ia/router.mjs';
import { criarMotor } from './api/_ia/motor.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';

const json = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) });
const cadeiaDe = (tipo, extra = {}) => cadeia(tipo, { chaves: {}, desligados: [], provados: PROVADOS, limite: 5, ...extra });
const nomes = (fila) => fila.map((x) => `${x.fornec || x.fornecedor}/${x.modelo}`);

/* ---------- 1 · a lista ---------- */

test('gratuitos: a lista curada é keyless e diz quando foi medida', () => {
  assert.ok(PROVADOS.length >= 3);
  for (const p of PROVADOS) {
    assert.ok(FORNECEDORES[p.fornec], `fornecedor desconhecido: ${p.fornec}`);
    assert.equal(FORNECEDORES[p.fornec].keyless, true, `${p.fornec} devia ser keyless`);
    assert.match(p.medido, /^\d{4}-\d{2}-\d{2}/);
    assert.ok(Number.isFinite(p.ms) && p.ms > 0, 'tem de ter latência medida');
  }
  const codestral = curado('llm7', 'codestral-latest');
  assert.ok(codestral);
  assert.equal(codestral.ok >= 10, true, 'o codestral respondeu 16 vezes em produção');
  assert.equal([...PROVADOS].sort(porVelocidade)[0].modelo, 'codestral-latest', 'o mais rápido primeiro');
});

test('gratuitos: desligar um fornecedor tira-o da lista activa', () => {
  assert.equal(provadosActivos({}).length, PROVADOS.length);
  const semLlm7 = provadosActivos({ desligados: ['llm7'] });
  assert.equal(semLlm7.some((p) => p.fornec === 'llm7'), false);
  const r = resumo({ desligados: ['llm7'] });
  assert.equal(r.pronto, true);
  assert.equal(r.modelos.every((m) => m.fornec !== 'llm7'), true);
  assert.equal(estadoCurto({ desligados: ['llm7'] }).pronto, true);
  assert.match(estadoCurto({}).frase, /codestral|Qwen/);
});

/* ---------- 2 · a cadeia ---------- */

test('cadeia: o modelo medido em produção passa à frente, por tipo de trabalho', () => {
  assert.equal(nomes(cadeiaDe('codigo'))[0], 'llm7/codestral-latest');
  assert.equal(nomes(cadeiaDe('texto'))[0], 'llm7/codestral-latest');
  assert.equal(nomes(cadeiaDe('rapido'))[0], 'llm7/codestral-latest');
  assert.equal(nomes(cadeiaDe('plano'))[0], 'ovh/Qwen3.5-397B-A17B', 'plano pede raciocínio: vai o Qwen');
  /* sem a lista, o codestral desce: o catálogo dá-lhe `texto/codigo` e o router
     prefere modelos maiores; com a medição, passa à frente de todos. */
  const comLista = nomes(cadeiaDe('rapido', { limite: 20 }));
  const semLista = nomes(cadeia('rapido', { chaves: {}, desligados: [], limite: 20 }));
  assert.equal(comLista[0], 'llm7/codestral-latest');
  assert.ok(semLista.indexOf('llm7/codestral-latest') > 0, `sem a medição devia descer, veio ${semLista[0]}`);
});

test('cadeia: «visão» não é relaxada — só entram modelos com olhos', () => {
  const fila = cadeiaDe('visao', { limite: 10 });
  assert.ok(fila.length > 0, 'há um modelo de visão no catálogo (OVH Qwen2.5-VL)');
  assert.equal(fila.every((m) => (m.etiquetas || []).includes('visao')), true);
  /* e se não houver nenhum, fica vazia em vez de aceitar um cego */
  assert.deepEqual(cadeia('visao', { chaves: {}, desligados: ['ovh'], limite: 10 }), []);
});

test('cadeia: respeita a lista de desligados e de modelos já tentados', () => {
  assert.equal(nomes(cadeiaDe('codigo', { desligados: ['llm7'] })).includes('llm7/codestral-latest'), false);
  const evitando = cadeiaDe('codigo', { tentados: [{ fornec: 'llm7', modelo: 'codestral-latest' }] });
  assert.equal(nomes(evitando).includes('llm7/codestral-latest'), false);
  assert.ok(evitando.length > 0, 'e ainda sobra por onde tentar');
});

/* ---------- 3 · falha e memória de «fora» ---------- */

test('fallback: salta o modelo indisponível e responde pelo seguinte', async () => {
  limparFora();
  const chamados = [];
  const r = await falarComFallback('codigo', {
    chaves: {}, desligados: [], provados: PROVADOS, limite: 3,
    executar: async (entrada) => {
      chamados.push(`${entrada.fornec}/${entrada.modelo}`);
      if (entrada.modelo === 'codestral-latest') {
        throw Object.assign(new Error("Model 'codestral-latest' is currently unavailable."), { codigo: 'pedido', fornec: entrada.fornec });
      }
      return { texto: 'feito pelo segundo', uso: { entrada: 10, saida: 5 }, modelo: entrada.modelo, fornec: entrada.fornec, ms: 90 };
    },
  });
  assert.equal(r.texto, 'feito pelo segundo');
  assert.equal(r.tentativas, 2);
  assert.equal(chamados.length, 2);
  assert.equal(foraDoAr('llm7', 'codestral-latest'), true, 'o modelo recusado fica de parte');
  /* a cadeia seguinte já não conta com ele */
  assert.equal(nomes(cadeiaDe('codigo')).includes('llm7/codestral-latest'), false);
});

test('fora: sobrevive a um arranque a frio (exportar → importar)', () => {
  limparFora();
  marcarFora('llm7', 'gpt-oss-20b', 'unavailable');
  const guardado = exportarFora();
  assert.equal(guardado['llm7/gpt-oss-20b']?.motivo, 'unavailable');

  limparFora();                            // processo novo
  assert.equal(foraDoAr('llm7', 'gpt-oss-20b'), false);
  const n = importarFora(guardado);        // relido da base
  assert.equal(n, 1);
  assert.equal(foraDoAr('llm7', 'gpt-oss-20b'), true);

  /* o que já expirou não volta */
  assert.equal(importarFora({ 'llm7/velho': { at: Date.now() - 7 * 60 * 60 * 1000 } }), 0);
  assert.equal(foraDoAr('llm7', 'velho'), false);
  limparFora();
});

/* ---------- 4 · o motor a trabalhar ---------- */

test('motor: pede ao modelo gratuito medido, sem chave nenhuma', async () => {
  limparFora();
  const repo = createMemRepo();
  const pedidos = [];
  const fetchImpl = async (url, opt) => {
    pedidos.push({ url: String(url), corpo: JSON.parse(opt.body) });
    return json({ choices: [{ message: { content: 'olá do motor' } }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.pedir('codigo', [{ role: 'user', content: 'diz olá' }]);
  assert.equal(r.texto, 'olá do motor');
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].corpo.model, 'codestral-latest', 'o primeiro pedido vai ao modelo que respondeu em produção');
  assert.match(pedidos[0].url, /api\.llm7\.io/, 'e ao fornecedor keyless');
  assert.equal(JSON.stringify(pedidos[0]).includes('authorization'), false, 'keyless: sem cabeçalho de chave');

  const g = await motor.gratuitos();
  assert.equal(g.pronto, true);
  assert.equal(g.estado.pronto, true);
  assert.equal(g.medido.length, PROVADOS.length);
  assert.equal(JSON.stringify(g).includes('API_KEY'), false);
});

test('motor: um modelo que o fornecedor recusa não é pedido outra vez', async () => {
  limparFora();
  const repo = createMemRepo();
  const tentados = [];
  const fetchImpl = async (url, opt) => {
    const modelo = JSON.parse(opt.body).model;
    tentados.push(modelo);
    if (modelo === 'codestral-latest') return json({ error: { message: "Model 'codestral-latest' is currently unavailable." } }, 400);
    return json({ choices: [{ message: { content: 'segundo' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.pedir('texto', [{ role: 'user', content: 'oi' }]);
  assert.equal(r.texto, 'segundo');
  assert.deepEqual(tentados.slice(0, 2), ['codestral-latest', tentados[1]]);
  assert.equal(foraDoAr('llm7', 'codestral-latest'), true);

  /* guardou-se na base (o que um arranque a frio vai reler) */
  const cfg = await repo.ia.config.ler();
  assert.ok(cfg.fora && Object.keys(cfg.fora).some((k) => k.includes('codestral')), 'a marca de «fora» tem de ir para a config');
  limparFora();
});

/* ---------- 5 · a rota ---------- */

test('rota: /ia/gratuitos diz o que há, sem chaves', async () => {
  const repo = createMemRepo();
  const r = await responder(repo, { caminho: '/ia/gratuitos', metodo: 'GET', env: {}, fetchImpl: async () => json({}) });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.pronto, true);
  assert.ok(r.corpo.modelos.length >= 3);
  assert.equal(r.corpo.semChaveNecessaria, r.corpo.modelos.filter((m) => m.keyless).length);
  assert.equal(nomes(r.corpo.cadeia.codigo)[0], 'llm7/codestral-latest');
  assert.equal(JSON.stringify(r.corpo).includes('API_KEY'), false);
  assert.equal(JSON.stringify(r.corpo).includes('Bearer'), false);
});
