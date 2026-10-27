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

import { CHAVE_PUBLICA, FORNECEDORES, MODELOS, comChave } from './api/_ia/catalogo.mjs';
import {
  PROVADOS, catalogoDaCadeia, curado, descobertosGratuitos, estadoCurto, etiquetasDoId,
  porProvar, porVelocidade, provadosActivos, provasDe, resumo,
} from './api/_ia/gratuitos.mjs';
import { falar } from './api/_ia/cliente.mjs';
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
  /* 1.33.0: o OpenCode Zen também tem um modelo com olhos (nemotron VL) */
  const semOvh = cadeia('visao', { chaves: {}, desligados: ['ovh'], limite: 10 });
  assert.equal(semOvh.length > 0, true);
  assert.equal(semOvh.every((m) => m.etiquetas.includes('visao')), true);
  /* e se não houver nenhum, fica vazia em vez de aceitar um cego */
  assert.deepEqual(cadeia('visao', { chaves: {}, desligados: ['ovh', 'opencode'], limite: 10 }), []);
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


/* ---------- 6 · 1.33.0 · OpenCode Zen e Pollinations, sem chave do dono ---------- */

test('catálogo: o OpenCode publica a chave e o Pollinations é keyless', () => {
  assert.equal(FORNECEDORES.opencode.chavePublica, 'public');
  assert.equal(FORNECEDORES.pollinations.keyless, true);
  assert.equal(FORNECEDORES.pollinations.estilo, 'pollinations', 'o tier anónimo não é OpenAI');
  assert.equal(FORNECEDORES.pollinations.base, 'https://text.pollinations.ai');
  /* os quatro nomes antigos do OpenCode já não existem no serviço */
  const ids = MODELOS.filter((m) => m.fornecedor === 'opencode').map((m) => m.modelo);
  assert.ok(ids.includes('deepseek-v4.1-flash-free'), 'a lista é a real de GET /models');
  assert.equal(ids.includes('deepseek-v4-flash-free'), false);
  assert.ok(ids.length >= 8);

  const prontos = comChave({}).map((p) => p.id);
  assert.ok(prontos.includes('opencode'), 'sem conta: a chave é a publicada pelo serviço');
  assert.ok(prontos.includes('pollinations'));
  const pub = comChave({}).find((p) => p.id === 'opencode');
  assert.equal(pub.variavel, CHAVE_PUBLICA);
  assert.equal(pub.semChave, true);
});

test('pollinations: fala por GET, sem chave, e devolve o texto simples', async () => {
  const pedidos = [];
  const fetchImpl = async (url, opt = {}) => {
    pedidos.push({ url: String(url), opt });
    return { ok: true, status: 200, text: async () => 'teste' };
  };
  const r = await falar({
    fornec: 'pollinations', prov: FORNECEDORES.pollinations, chave: '', modelo: 'openai-fast',
    mensagens: [{ role: 'system', content: 'sê breve' }, { role: 'user', content: 'Diz apenas a palavra teste' }],
    fetchImpl,
  });
  assert.equal(r.texto, 'teste');
  assert.equal(r.uso.entrada, 0);
  const [p] = pedidos;
  assert.equal(p.opt.method, 'GET');
  assert.equal(p.opt.body, undefined, 'GET não leva corpo');
  assert.equal(p.opt.headers.authorization, undefined, 'keyless: nenhum cabeçalho de chave');
  assert.match(p.url, /^https:\/\/text\.pollinations\.ai\/Diz%20apenas%20a%20palavra%20teste\?/);
  assert.match(p.url, /model=openai-fast/);
  assert.match(p.url, /system=s/i, 'o system prompt viaja no pedido');
});

test('pollinations: o limite (402) é retentável e cai no fornecedor seguinte', async () => {
  const fetchImpl = async () => ({ ok: false, status: 402, text: async () => '{"error":"rate limited"}' });
  await assert.rejects(
    () => falar({
      fornec: 'pollinations', prov: FORNECEDORES.pollinations, chave: '', modelo: 'openai-fast',
      mensagens: [{ role: 'user', content: 'olá' }], fetchImpl,
    }),
    (e) => e.codigo === 'credito' && e.retentavel === true,
  );
});

test('descoberta: a lista real do fornecedor alimenta a cadeia (e a paga não)', () => {
  const cfg = { testes: { opencode: { ok: true, lista: ['modelo-novo-free', 'nemotron-3.5-super-vl-free'] } } };
  const extra = descobertosGratuitos(cfg);
  assert.deepEqual(extra.map((d) => d.modelo), ['modelo-novo-free', 'nemotron-3.5-super-vl-free']);
  assert.equal(extra[0].gratuito, true);
  assert.equal(extra[0].preco[0], 0);
  assert.ok(extra[1].etiquetas.includes('visao'), 'o nome diz VL: entra na cadeia de visão');

  const catalogo = catalogoDaCadeia(cfg);
  assert.ok(catalogo.some((m) => m.modelo === 'modelo-novo-free'));
  /* um fornecedor pago descoberto não entra: só os sem custo */
  const pago = { testes: { openrouter: { ok: true, lista: ['gpt-5', 'qwen/qwen3-coder:free'] } } };
  assert.deepEqual(descobertosGratuitos(pago).map((d) => d.modelo), ['qwen/qwen3-coder:free'], 'num gateway misto só entra o que diz free');
  assert.equal(catalogoDaCadeia(pago, []).some((m) => m.modelo === 'gpt-5'), false, 'o pago nunca é acrescentado pela descoberta');
});

test('motor: sem nenhuma chave, o OpenCode entra pelo `Bearer public`', async () => {
  limparFora();
  const pedidos = [];
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url);
    pedidos.push({ url: u, headers: opt.headers || {}, corpo: opt.body ? JSON.parse(opt.body) : null });
    if (u.includes('llm7.io')) return json({ error: { message: "Model 'codestral-latest' is currently unavailable." } }, 400);
    if (u.includes('ovh.net')) return json({ error: { message: 'API rate limit exceeded' } }, 429);
    return json({ choices: [{ message: { content: 'feito pelo opencode' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } });
  };
  const motor = criarMotor({ repo: createMemRepo(), env: {}, fetchImpl });
  const r = await motor.pedir('codigo', [{ role: 'user', content: 'escreve uma função' }]);
  assert.equal(r.texto, 'feito pelo opencode');
  assert.equal(r.fornec, 'opencode');
  const doOpencode = pedidos.filter((p) => p.url.includes('opencode.ai'));
  assert.ok(doOpencode.length >= 1);
  assert.equal(doOpencode[0].headers.authorization, 'Bearer public', 'a chave publicada pelo serviço, não inventada');
  assert.equal(JSON.stringify(pedidos).includes('sem-chave'), false);
  limparFora();
});

test('motor: o teste real do Pollinations lista os modelos e responde', async () => {
  const repo = createMemRepo();
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url);
    if (u.endsWith('/models')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'openai-fast', description: 'GPT-OSS 20B (OVH)' }]) };
    }
    return { ok: true, status: 200, text: async () => 'ok' };
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.testar('pollinations');
  assert.equal(r.ok, true);
  assert.equal(r.modelo, 'openai-fast');
  assert.equal(r.modelos, 1);
  const cfg = await repo.ia.config.ler();
  assert.deepEqual(cfg.testes.pollinations.lista, ['openai-fast'], 'a lista fica guardada para a cadeia');
  assert.equal(cfg.testes.pollinations.ok, true);
});

test('gratuitos: separa o que está provado do que só existe', () => {
  const chaves = comChave({});
  const r = resumo({ chaves });
  assert.ok(r.total >= 3);
  assert.ok(r.porProvar.length >= 5, 'há gratuitos prontos por provar');
  const nomesFalta = r.porProvar.map((p) => `${p.fornec}/${p.modelo}`);
  assert.ok(nomesFalta.includes('pollinations/openai-fast'));
  assert.ok(nomesFalta.some((n) => n.startsWith('opencode/')));
  /* nenhum dos provados aparece na lista dos que faltam provar */
  const nomesProvados = r.modelos.map((m) => `${m.fornec}/${m.modelo}`);
  assert.equal(nomesFalta.some((n) => nomesProvados.includes(n)), false);
  assert.match(estadoCurto({ chaves }).frase, /provados .* por provar/);
  assert.equal(etiquetasDoId('nemotron-3.5-super-vl-free').includes('visao'), true);
  assert.equal(porProvar({ chaves }).every((p) => p.etiquetas.length > 0), true);
});


/* ---------- a prova que faz a diferença: «por provar» → «provado» ---------- */

test('provar: um modelo específico que responde deixa de estar «por provar»', async () => {
  const repo = createMemRepo();
  let pedido = null;
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url);
    if (u.endsWith('/models')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'big-pickle' }, { name: 'deepseek-v4.1-flash-free' }]) };
    }
    pedido = { url: u, corpo: JSON.parse(opt.body || '{}'), auth: opt.headers?.authorization || null };
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });

  /* antes: o modelo existe e está pronto, mas nunca respondeu */
  const antes = await motor.gratuitos();
  assert.ok(antes.porProvar.some((p) => p.fornec === 'opencode' && p.modelo === 'deepseek-v4.1-flash-free'));

  const r = await motor.testar('opencode', { modelo: 'deepseek-v4.1-flash-free' });
  assert.equal(r.ok, true);
  assert.equal(r.modelo, 'deepseek-v4.1-flash-free', 'o botão «Provar» tem de provar o modelo pedido, não outro');
  assert.equal(pedido.corpo.model, 'deepseek-v4.1-flash-free');
  assert.equal(pedido.auth, 'Bearer public', 'o OpenCode prova-se com a chave que ele próprio publica');

  const cfg = await repo.ia.config.ler();
  assert.equal(cfg.testes.opencode.provados['deepseek-v4.1-flash-free'].ok, true, 'a prova fica registada por modelo');
  assert.equal(typeof cfg.testes.opencode.provados['deepseek-v4.1-flash-free'].ms, 'number');
  assert.ok(cfg.testes.opencode.lista.includes('big-pickle'), 'a lista do fornecedor não se perde ao provar');

  /* depois: passou a provado, com a fonte certa, e saiu dos que faltam */
  const depois = await motor.gratuitos();
  const provado = depois.modelos.find((m) => m.fornec === 'opencode' && m.modelo === 'deepseek-v4.1-flash-free');
  assert.ok(provado, 'um modelo que respondeu tem de contar como provado');
  assert.equal(provado.latenciaActualMs != null || provado.medidoMs != null, true);
  assert.equal(depois.porProvar.some((p) => p.fornec === 'opencode' && p.modelo === 'deepseek-v4.1-flash-free'), false);
  assert.equal(depois.total, antes.total + 1);
});

test('provar: se o fornecedor responder por outro modelo, o pedido não conta como prova', async () => {
  const repo = createMemRepo();
  const fetchImpl = async (url, opt = {}) => {
    const u = String(url);
    if (u.endsWith('/models')) return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'big-pickle' }]) };
    /* recusa o modelo pedido, responde por outro: é o que um gateway faz */
    const modelo = String(JSON.parse(opt.body || '{}').model || '');
    if (modelo === 'nao-existe-free') return { ok: false, status: 400, text: async () => '{"error":"model unavailable"}' };
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.testar('opencode', { modelo: 'nao-existe-free' });
  assert.equal(r.ok, true);
  assert.equal(r.modelo, 'big-pickle', 'caiu para o modelo que responde');
  const cfg = await repo.ia.config.ler();
  assert.equal(cfg.testes.opencode.provados['nao-existe-free'], undefined, 'o que não respondeu não é provado');
  assert.equal(cfg.testes.opencode.provados['big-pickle'].ok, true);
});

test('provar: uma falha não apaga a lista nem as provas anteriores', async () => {
  const repo = createMemRepo();
  let falhar = false;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith('/models')) return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'big-pickle' }]) };
    if (falhar) return { ok: false, status: 500, text: async () => '{"error":"rebentou"}' };
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  await motor.testar('opencode', { modelo: 'big-pickle' });
  falhar = true;
  await assert.rejects(() => motor.testar('opencode', { modelo: 'big-pickle' }));
  const cfg = await repo.ia.config.ler();
  assert.equal(cfg.testes.opencode.ok, false, 'o último teste diz a verdade: falhou');
  assert.deepEqual(cfg.testes.opencode.lista, ['big-pickle'], 'a descoberta não se perde numa falha');
  assert.equal(cfg.testes.opencode.provados['big-pickle'].ok, true, 'a prova histórica não é apagada');
});

test('gratuitos: a rota /ia/testar aceita o modelo e devolve qual respondeu', async () => {
  const repo = createMemRepo();
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.endsWith('/models')) return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'openai-fast' }]) };
    return { ok: true, status: 200, text: async () => 'ok' };
  };
  const r = await responder(repo, { caminho: '/ia/testar', metodo: 'POST', corpo: { fornecedor: 'pollinations', modelo: 'openai-fast' }, env: {}, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.modelo, 'openai-fast');
  assert.equal(r.corpo.prova, 'pedido real a este fornecedor, agora');
});
