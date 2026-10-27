// Testes da camada de ferramentas de pesquisa (1.30.0, 27 out 2026).
//
// O que se prova aqui, sem rede e sem chaves a sério:
//   · uma ferramenta não chama o fornecedor sem chave — diz o que falta;
//   · o mesmo pedido duas vezes custa um pedido só (cache) e não há chamadas em
//     série sem controlo (tecto por minuto, por dia e por mês);
//   · os resultados da web trazem fontes e URL, e os fracos caem no limiar;
//   · as empresas saem sem duplicados e sem telefone/email/site inventados;
//   · cada execução deixa registo (ferramenta, estado, fontes, erro) e distingue
//     o que é real do que é inferência do modelo;
//   · `ler_pagina` distingue página vazia, tempo esgotado e falha do fornecedor;
//   · as rotas novas respondem e as antigas continuam a responder na mesma forma;
//   · o servidor MCP expõe as ferramentas e falha com uma razão, não com um erro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  executar, execucoes, estadoFerramentas, limparExecucoes, semDuplicados,
} from './api/_ferramentas.mjs';
import { consumir, guardarCache, lerCache, limparCache, limitesDe, reiniciar, uso } from './api/_limites.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CHAVE_GEO = 'geo-de-teste-nao-e-chave';
const CHAVE_TAV = 'tav-de-teste-nao-e-chave';
const ENV = { GEOAPIFY_API_KEY: CHAVE_GEO, TAVILY_API_KEY: CHAVE_TAV };

/** Um `fetch` de mentira que regista o que lhe pediram. */
function falso(rotas) {
  const pedidos = [];
  const fn = async (url, opcoes = {}) => {
    const u = String(url);
    pedidos.push({ url: u, opcoes });
    const chave = Object.keys(rotas).find((k) => u.includes(k));
    if (!chave) throw new Error(`pedido inesperado: ${u}`);
    const r = typeof rotas[chave] === 'function' ? await rotas[chave](url, opcoes) : rotas[chave];
    if (r instanceof Error) throw r;
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => r.json, text: async () => String(r.texto ?? JSON.stringify(r.json ?? '')) };
  };
  fn.pedidos = pedidos;
  return fn;
}

const TAVILY_OK = {
  json: {
    answer: 'A Câmara de Coimbra aprovou o orçamento em outubro.',
    results: [
      { title: 'Orçamento de Coimbra aprovado', url: 'https://noticias.pt/coimbra', content: 'A assembleia votou ontem.', score: 0.91, published_date: '2026-10-24' },
      { title: 'Câmara municipal — notícias', url: 'https://cm-coimbra.pt/noticias', content: 'Sessão de outubro.', score: 0.72 },
      { title: 'Desporto', url: 'https://desporto.pt/x', content: 'Jogo de sábado.', score: 0.04 },
    ],
  },
};

const GEO_OK = { json: { results: [{ formatted: 'Coimbra, Portugal', city: 'Coimbra', country: 'Portugal', country_code: 'pt', lat: 40.2111, lon: -8.4291 }] } };
const PLACES_OK = {
  json: {
    features: [
      {
        properties: {
          name: 'Clínica do Mondego', city: 'Coimbra', formatted: 'Rua Larga 3, Coimbra', lat: 40.208, lon: -8.426,
          distance: 300, place_id: 'p1', categories: ['healthcare', 'healthcare.dentist'],
          datasource: { raw: { phone: '+351 239 000 000', website: 'https://mondego.pt' } },
        },
      },
      {
        properties: {
          name: 'Clínica do Mondego', city: 'Coimbra', formatted: 'Rua Larga 3, Coimbra', lat: 40.208, lon: -8.426,
          distance: 300, place_id: 'p1b', categories: ['healthcare.dentist'],
        },
      },
      {
        properties: {
          name: 'Dentária Nova', city: 'Coimbra', formatted: 'Av. Fernão de Magalhães 1, Coimbra', lat: 40.21, lon: -8.43,
          distance: 900, place_id: 'p2', categories: ['healthcare.dentist'],
        },
      },
    ],
  },
};

const limpar = () => { reiniciar(); limparExecucoes(); limparCache(); };

/* ---------- 1 · limites e cache ---------- */

test('limites: o minuto trava o pedido seguinte e diz quanto esperar', () => {
  reiniciar();
  const env = { ORBITA_LIMITE_TAVILY_MIN: '2' };
  assert.equal(consumir('tavily', { env, agora: 1_000_000 }).ok, true);
  assert.equal(consumir('tavily', { env, agora: 1_000_100 }).ok, true);
  const terceiro = consumir('tavily', { env, agora: 1_000_200 });
  assert.equal(terceiro.ok, false);
  assert.equal(terceiro.codigo, 'limite');
  assert.ok(terceiro.esperarMs > 0, 'tem de dizer quanto falta');
  assert.match(terceiro.motivo, /minuto/);
  /* passado o minuto, volta a deixar */
  assert.equal(consumir('tavily', { env, agora: 1_065_000 }).ok, true);
});

test('limites: a quota do dia e do mês recusam com código próprio', () => {
  reiniciar();
  const env = { ORBITA_LIMITE_GEOAPIFY_DIA: '2' };
  assert.equal(consumir('geoapify', { env, agora: 5_000 }).ok, true);
  assert.equal(consumir('geoapify', { env, agora: 6_000, custo: 1 }).ok, true);
  const r = consumir('geoapify', { env, agora: 7_000 });
  assert.equal(r.codigo, 'quota');
  assert.match(r.motivo, /dia/);

  reiniciar();
  const mes = { ORBITA_LIMITE_TAVILY_MES: '1', ORBITA_LIMITE_TAVILY_DIA: '100' };
  assert.equal(consumir('tavily', { env: mes, agora: 5_000 }).ok, true);
  assert.equal(consumir('tavily', { env: mes, agora: 6_000 }).codigo, 'quota');
});

test('limites: os planos reais estão em código e o override não inventa fornecedor', () => {
  assert.equal(limitesDe('tavily', {}).mes, 1000);
  assert.equal(limitesDe('geoapify', {}).dia, 3000);
  assert.equal(limitesDe('nao-existe', {}), null);
  assert.equal(consumir('nao-existe', {}).codigo, 'fornecedor-desconhecido');
});

test('cache: guarda, serve dentro do prazo e esquece depois', () => {
  reiniciar();
  guardarCache('tavily', 'k', { v: 1 }, { agora: 1_000 });
  assert.deepEqual(lerCache('tavily', 'k', 2_000).valor, { v: 1 });
  assert.equal(lerCache('tavily', 'k', 1_000 + 5 * 60 * 1000 + 1), null, 'passados 5 minutos já não serve');
});

/* ---------- 2 · as ferramentas ---------- */

test('executar: sem chave diz qual falta e não chama ninguém', async () => {
  limpar();
  const f = falso({});
  const r = await executar('pesquisar_web', { consulta: 'qualquer coisa' }, { env: {}, fetchImpl: f });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'semchave');
  assert.match(r.erro, /TAVILY_API_KEY/);
  assert.equal(r.real, true);
  assert.equal(r.inferido, false);
  assert.equal(f.pedidos.length, 0, 'sem chave não há pedido');
  assert.equal(JSON.stringify(r).includes(CHAVE_TAV), false);
});

test('executar: web devolve fontes, resposta curta e deixa cair os fracos', async () => {
  limpar();
  const f = falso({ '/search': TAVILY_OK });
  const r = await executar('pesquisar_web', { consulta: 'orçamento coimbra outubro 2026' }, { env: ENV, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.fornecedor, 'tavily');
  assert.equal(r.dados.resultados.length, 2, 'o resultado com 0,04 fica de fora');
  assert.equal(r.dados.descartados, 1);
  assert.match(r.avisos.join(' '), /limiar de relevância/);
  assert.equal(r.fontes.length, 2);
  assert.ok(r.fontes.every((u) => u.startsWith('https://')));
  assert.equal(r.dados.resultados[0].publicado, '2026-10-24');
  assert.equal(r.cache, false);
  assert.equal(r.real, true);
  assert.equal(r.inferido, false);

  /* a mesma pergunta outra vez: custo zero */
  const b = await executar('pesquisar_web', { consulta: 'orçamento coimbra outubro 2026' }, { env: ENV, fetchImpl: f });
  assert.equal(b.ok, true);
  assert.equal(b.cache, true);
  assert.equal(f.pedidos.length, 1, 'a segunda vez não volta a bater no fornecedor');
});

test('executar: web sem resultados úteis é «vazio», não é sucesso', async () => {
  limpar();
  const f = falso({ '/search': { json: { results: [{ title: 'qqq', url: 'https://x.pt', content: 'nada', score: 0.06 }] } } });
  const r = await executar('pesquisar_web', { consulta: 'zxqv inexistente qqq' }, { env: ENV, fetchImpl: f });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'vazio');
  assert.match(r.erro, /relevância/);
  assert.equal(r.dados.resultados.length, 0);
});

test('executar: empresas sem duplicados e sem contactos inventados', async () => {
  limpar();
  const f = falso({ 'geocode/search': GEO_OK, 'v2/places': PLACES_OK });
  const r = await executar('pesquisar_empresas', { oQue: 'dentistas', onde: 'Coimbra' }, { env: ENV, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.fornecedor, 'geoapify');
  assert.equal(r.dados.empresas.length, 2, 'a clínica repetida conta uma vez');
  assert.equal(r.dados.repetidos, 1);
  const nova = r.dados.empresas.find((l) => l.nome === 'Dentária Nova');
  assert.equal(nova.telefone, '', 'sem telefone nos dados, fica vazio — não se inventa');
  assert.equal(nova.website, '');
  assert.equal(nova.email, '');
  assert.equal(r.dados.centro.cidade, 'Coimbra');
  assert.equal(r.real, true);
});

test('executar: parâmetros em falta não gastam créditos', async () => {
  limpar();
  const f = falso({});
  const r = await executar('pesquisar_empresas', { onde: 'Coimbra' }, { env: ENV, fetchImpl: f });
  assert.equal(r.codigo, 'parametros');
  assert.match(r.erro, /atividade/);
  assert.equal(f.pedidos.length, 0);
  const semZona = await executar('pesquisar_empresas', { oQue: 'dentistas' }, { env: ENV, fetchImpl: f });
  assert.match(semZona.erro, /zona/);
  const vazia = await executar('pesquisar_web', { consulta: ' ' }, { env: ENV, fetchImpl: f });
  assert.equal(vazia.codigo, 'parametros');
});

test('executar: o tecto por minuto devolve «limite» antes de chamar o fornecedor', async () => {
  limpar();
  const f = falso({ '/search': TAVILY_OK });
  const env = { ...ENV, ORBITA_LIMITE_TAVILY_MIN: '1' };
  const a = await executar('pesquisar_web', { consulta: 'primeira pergunta' }, { env, fetchImpl: f });
  assert.equal(a.ok, true);
  const b = await executar('pesquisar_web', { consulta: 'segunda pergunta' }, { env, fetchImpl: f });
  assert.equal(b.ok, false);
  assert.equal(b.codigo, 'limite');
  assert.ok(b.esperarMs > 0);
  assert.equal(f.pedidos.length, 1);
});

test('executar: página vazia, tempo esgotado e falha do fornecedor têm códigos distintos', async () => {
  limpar();
  const vazia = await executar('ler_pagina', { url: 'https://a.pt/vazio' }, {
    env: ENV,
    fetchImpl: falso({ 'api.tavily.com/extract': { json: { results: [{ url: 'https://a.pt/vazio', raw_content: '   ' }] } } }),
  });
  assert.equal(vazia.ok, false);
  assert.equal(vazia.codigo, 'vazio');

  limpar();
  const relogio = new Error('abortado');
  relogio.name = 'AbortError';
  const tempo = await executar('ler_pagina', { url: 'https://a.pt/lento' }, { env: ENV, fetchImpl: falso({ '/extract': relogio }) });
  assert.equal(tempo.codigo, 'timeout');

  limpar();
  const falha = await executar('ler_pagina', { url: 'https://a.pt/erro' }, {
    env: ENV, fetchImpl: falso({ '/extract': { status: 500, json: { detail: 'boom' } } }),
  });
  assert.equal(falha.ok, false);
  assert.equal(falha.codigo, 'falha');
  assert.match(falha.erro, /Tavily|500|boom/i);
});

/* ---------- 3 · registo por execução ---------- */

test('registo: cada execução deixa ferramenta, estado, fontes e erro', async () => {
  limpar();
  const repo = createMemRepo();
  const f = falso({ '/search': TAVILY_OK });
  await executar('pesquisar_web', { consulta: 'economia portuguesa' }, { env: ENV, fetchImpl: f, repo });
  await executar('pesquisar_web', { consulta: 'xy' }, { env: {}, fetchImpl: f, repo });

  const linhas = execucoes(10);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[1].ferramenta, 'pesquisar_web');
  assert.equal(linhas[1].ok, true);
  assert.equal(linhas[1].fontes.length, 2);
  assert.equal(linhas[1].real, true);
  assert.equal(linhas[1].inferido, false);
  assert.equal(linhas[0].ok, false);
  assert.equal(linhas[0].codigo, 'semchave');
  assert.match(linhas[0].erro, /TAVILY_API_KEY/);

  const atividade = repo._dados.atividade.filter((a) => a.tipo === 'pesquisa');
  assert.equal(atividade.length, 2, 'o registo também entra na actividade do repo');
  assert.match(atividade[0].texto, /pesquisar_web/);
  assert.equal(JSON.stringify(atividade).includes(CHAVE_TAV), false, 'o registo nunca leva chaves');
});

test('registo: sem base, o rasto vai para ficheiro de dados (fora do git)', async () => {
  limpar();
  const f = falso({ '/search': TAVILY_OK });
  const dir = path.join(AQUI, 'data');
  const antes = process.env.ORBITA_DATA_DIR;
  process.env.ORBITA_DATA_DIR = dir;
  try {
    await executar('pesquisar_web', { consulta: 'rasto em ficheiro' }, { env: ENV, fetchImpl: f });
    const { execucoesEmFicheiro } = await import('./api/_ferramentas.mjs');
    const rasto = execucoesEmFicheiro(5);
    assert.ok(rasto.length >= 1);
    assert.equal(rasto[0].ferramenta, 'pesquisar_web');
    assert.equal(JSON.stringify(rasto).includes(CHAVE_TAV), false);
  } finally {
    if (antes == null) delete process.env.ORBITA_DATA_DIR; else process.env.ORBITA_DATA_DIR = antes;
    const fs = await import('node:fs');
    try { fs.unlinkSync(path.join(dir, 'pesquisa-log.json')); } catch { /* já não estava */ }
  }
});

/* ---------- 4 · rotas ---------- */

const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) =>
  responder(repo, { caminho, metodo, corpo, env: ENV, ...extra });

test('rotas: /pesquisa/uso mostra consumo e tectos, sem chaves', async () => {
  limpar();
  const repo = createMemRepo();
  const r = await chamar(repo, '/pesquisa/uso');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.fornecedores.length, 2);
  const tav = r.corpo.fornecedores.find((x) => x.fornecedor === 'tavily');
  assert.equal(tav.creditos.tetoMes, 1000);
  assert.equal(tav.creditos.restanteMes, 1000);
  assert.equal(tav.janela.porMinuto, 20);
  assert.match(r.corpo.nota, /instância/);
  assert.equal(JSON.stringify(r.corpo).includes(CHAVE_TAV), false);
});

test('rotas: /pesquisa/ferramentas diz o que os agentes podem chamar', async () => {
  const repo = createMemRepo();
  const r = await chamar(repo, '/pesquisa/ferramentas');
  assert.equal(r.status, 200);
  const nomes = r.corpo.ferramentas.map((f) => f.nome);
  assert.deepEqual(nomes.sort(), ['ler_pagina', 'pesquisar_empresas', 'pesquisar_web']);
  const web = r.corpo.ferramentas.find((f) => f.nome === 'pesquisar_web');
  assert.ok(web.para.includes('marketing'));
  assert.equal(r.corpo.estado, undefined, 'estado das fontes não vai aqui');
  assert.equal(JSON.stringify(r.corpo).includes(CHAVE_TAV), false);
});

test('rotas: /pesquisa/web traduz limite em 429 e vazio em 200 explicado', async () => {
  limpar();
  const repo = createMemRepo();
  const f = falso({ '/search': TAVILY_OK });
  const env = { ...ENV, ORBITA_LIMITE_TAVILY_MIN: '1' };
  const a = await responder(repo, { caminho: '/pesquisa/web', metodo: 'POST', corpo: { consulta: 'primeira' }, env, fetchImpl: f });
  assert.equal(a.status, 200);
  assert.equal(a.corpo.encontrados, 2);
  const b = await responder(repo, { caminho: '/pesquisa/web', metodo: 'POST', corpo: { consulta: 'segunda' }, env, fetchImpl: f });
  assert.equal(b.status, 429);
  assert.equal(b.corpo.codigo, 'limite');

  const c = await responder(repo, {
    caminho: '/pesquisa/web', metodo: 'POST', corpo: { consulta: 'nada' }, env: ENV,
    fetchImpl: falso({ '/search': { json: { results: [] } } }),
  });
  assert.equal(c.status, 200);
  assert.equal(c.corpo.ok, false);
  assert.equal(c.corpo.codigo, 'vazio');
});

test('rotas: /pesquisa/leads e /pesquisa/pagina continuam com a mesma forma', async () => {
  limpar();
  const repo = createMemRepo();
  const f = falso({ 'geocode/search': GEO_OK, 'v2/places': PLACES_OK });
  const r = await chamar(repo, '/pesquisa/leads', 'POST', { oQue: 'dentistas', onde: 'Coimbra' }, { fetchImpl: f });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.leads.length, 2);
  assert.equal(r.corpo.repetidos, 1);
  assert.equal(r.corpo.guardados.novos, 2);
  assert.equal(repo._dados.leads.length, 2);
  assert.equal(typeof r.corpo.ms, 'number');
  assert.equal(r.corpo.cache, false);

  const pagina = await chamar(repo, '/pesquisa/pagina', 'POST', { url: 'https://a.pt' }, {
    fetchImpl: falso({ '/extract': { json: { results: [{ url: 'https://a.pt', raw_content: 'Texto da página com detalhe suficiente.' }] } } }),
  });
  assert.equal(pagina.status, 200);
  assert.equal(pagina.corpo.ok, true);
  assert.ok(pagina.corpo.caracteres > 10);

  const semUrl = await chamar(repo, '/pesquisa/pagina', 'POST', {}, { fetchImpl: falso({}) });
  assert.equal(semUrl.status, 400);
});

/* ---------- 5 · sem duplicados, à parte ---------- */

test('semDuplicados: por sítio, por nome+morada e por nome+cidade', () => {
  const { unicos, repetidos } = semDuplicados([
    { nome: 'A', sítioId: 'x', cidade: 'Porto', morada: 'Rua 1' },
    { nome: 'A', sítioId: 'y', cidade: 'Porto', morada: 'Rua 1' },
    { nome: 'A', cidade: 'Lisboa', morada: 'Rua 2' },
    { nome: 'B', cidade: 'Porto', morada: 'Rua 3' },
  ]);
  assert.equal(unicos.length, 3);
  assert.equal(repetidos, 1);
});

/* ---------- 6 · os agentes vêem as ferramentas (MCP) ---------- */

function mcpUmaVez(env, pedidos) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(AQUI, 'mcp-servers/orbita-integrations/index.mjs')], {
      cwd: AQUI, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let saida = '';
    let erros = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('o MCP não respondeu a tempo: ' + erros)); }, 15000);
    p.stdout.on('data', (d) => {
      saida += d;
      const linhas = saida.split('\n').filter(Boolean);
      if (linhas.length >= pedidos.length) {
        clearTimeout(t);
        p.kill();
        resolve(linhas.slice(0, pedidos.length).map((l) => JSON.parse(l)));
      }
    });
    p.stderr.on('data', (d) => { erros += d; });
    p.on('error', reject);
    for (const msg of pedidos) p.stdin.write(JSON.stringify(msg) + '\n');
  });
}

test('agentes: o MCP expõe a pesquisa web, as empresas e o consumo', async () => {
  const [lista] = await mcpUmaVez({}, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  const nomes = lista.result.tools.map((t) => t.name);
  assert.ok(nomes.includes('orbita_web_search'), 'a pesquisa web tem de estar nos agentes');
  assert.ok(nomes.includes('orbita_business_search'));
  assert.ok(nomes.includes('orbita_research_usage'));
  assert.equal(nomes.length, 22);
  const web = lista.result.tools.find((t) => t.name === 'orbita_web_search');
  assert.deepEqual(web.inputSchema.required, ['query']);
});

test('agentes: sem chave a ferramenta responde com a razão, não com resultados', async () => {
  const [, resposta] = await mcpUmaVez({ TAVILY_API_KEY: '', TAVILY_KEY: '', GEOAPIFY_API_KEY: '', GEOAPIFY_KEY: '' }, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'orbita_web_search', arguments: { query: 'notícias de hoje' } } },
  ]);
  const corpo = JSON.parse(resposta.result.content[0].text);
  assert.equal(corpo.ok, false);
  assert.equal(corpo.code, 'semchave');
  assert.match(corpo.error, /TAVILY_API_KEY/);
  assert.deepEqual(corpo.results, []);
  assert.equal(corpo.real, false);
});

/* Um fornecedor de mentira, mas por HTTP a sério: prova o caminho completo
   agente → ferramenta → rede → resposta, sem gastar um crédito nem precisar de
   chaves verdadeiras. Os endereços entram por ORBITA_TAVILY_URL/ORBITA_GEOAPIFY_URL. */
function fornecedorLocal() {
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      pedidos.push({ url: req.url, corpo });
      const responder = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/search')) {
        return responder({ answer: 'Resposta curta do fornecedor.', results: [
          { title: 'Fonte real', url: 'https://fonte.pt/noticia', content: 'Excerto com detalhe.', score: 0.88, published_date: '2026-10-26' },
        ] });
      }
      if (req.url.startsWith('/v1/geocode/search')) {
        return responder({ results: [{ formatted: 'Coimbra, Portugal', city: 'Coimbra', country_code: 'pt', lat: 40.2111, lon: -8.4291 }] });
      }
      if (req.url.startsWith('/v2/places')) {
        return responder({ features: [
          { properties: { name: 'Estúdio Aurora', city: 'Coimbra', formatted: 'Rua Nova 1, Coimbra', lat: 40.21, lon: -8.43, place_id: 'a1', categories: ['office'], datasource: { raw: { phone: '+351 239 111 222', website: 'https://aurora.pt' } } } },
          { properties: { name: 'Estúdio Aurora', city: 'Coimbra', formatted: 'Rua Nova 1, Coimbra', lat: 40.21, lon: -8.43, place_id: 'a1b', categories: ['office'] } },
        ] });
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, pedidos, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('agentes: a pesquisa web e as empresas respondem a sério a partir do MCP', async () => {
  const { srv, pedidos, base } = await fornecedorLocal();
  try {
    const [, web, empresas] = await mcpUmaVez(
      { TAVILY_API_KEY: CHAVE_TAV, GEOAPIFY_API_KEY: CHAVE_GEO, ORBITA_TAVILY_URL: base, ORBITA_GEOAPIFY_URL: base },
      [
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'orbita_web_search', arguments: { query: 'notícias de Coimbra', topic: 'news', days: 7 } } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'orbita_business_search', arguments: { location: 'Coimbra', activity: 'dentistas' } } },
      ],
    );
    const w = JSON.parse(web.result.content[0].text);
    assert.equal(w.ok, true);
    assert.equal(w.provider, 'tavily');
    assert.equal(w.real, true);
    assert.equal(w.inferred, false);
    assert.equal(w.results.length, 1);
    assert.equal(w.results[0].url, 'https://fonte.pt/noticia');
    assert.equal(w.results[0].published, '2026-10-26');
    assert.deepEqual(w.sources, ['https://fonte.pt/noticia']);
    const enviado = JSON.parse(pedidos.find((p) => p.url.startsWith('/search')).corpo);
    assert.equal(enviado.topic, 'news');
    assert.equal(enviado.days, 7, 'a janela de notícias chega ao fornecedor');

    const e = JSON.parse(empresas.result.content[0].text);
    assert.equal(e.ok, true);
    assert.equal(e.provider, 'geoapify');
    assert.equal(e.count, 1, 'a empresa repetida conta uma vez');
    assert.equal(e.duplicatesRemoved, 1);
    assert.equal(e.results[0].name, 'Estúdio Aurora');
    assert.equal(e.results[0].phone, '+351239111222', 'o telefone é normalizado, não inventado');
    assert.equal(e.results[0].website, 'https://aurora.pt');
    assert.equal(JSON.stringify(e).includes(CHAVE_GEO), false, 'a chave nunca volta na resposta');
  } finally {
    srv.close();
  }
});
