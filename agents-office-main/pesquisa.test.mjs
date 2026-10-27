// Testes da pesquisa (1.25.0, 27 out 2026).
//
// O que se prova aqui, sem rede e sem chaves a sério:
//   · sem chave, cada fonte diz que variável falta — não inventa resultados;
//   · a atividade escrita em português é traduzida para a categoria do Geoapify,
//     e o que não é conhecido é recusado em vez de devolver negócios ao acaso;
//   · o fluxo de leads faz dois pedidos reais (geocodificar → sítios), na zona
//     pedida, e normaliza telefone, site, email e nota;
//   · a chave nunca aparece no que sai da função — nem no resultado, nem no erro;
//   · a rota `/pesquisa/leads` guarda no funil, sem duplicar na segunda vez;
//   · o botão «Testar ligação» faz um pedido a sério e guarda o resultado.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIAS, acharCategoria, estado, extrairPagina, geocodificar,
  mascarar, procurarLeads, pesquisarWeb, testarFonte,
} from './api/_pesquisa.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const CHAVE_GEO = 'geo-de-teste-nao-e-uma-chave-a-serio';
const CHAVE_TAV = 'chave-falsa-para-teste-nao-e-segredo';
const ENV = { GEOAPIFY_API_KEY: CHAVE_GEO, TAVILY_API_KEY: CHAVE_TAV };

const GEO = {
  results: [{
    formatted: 'Coimbra, Portugal', city: 'Coimbra', country: 'Portugal', country_code: 'pt',
    lat: 40.2111, lon: -8.4291, result_type: 'city',
  }],
};

const PLACES = {
  features: [
    {
      properties: {
        name: 'Clínica Dentária do Mondego', city: 'Coimbra', formatted: 'Rua Larga 3, 3000-123 Coimbra',
        lat: 40.208, lon: -8.426, distance: 320, place_id: 'p1',
        categories: ['healthcare', 'healthcare.dentist'],
        datasource: { raw: { phone: '+351 239 000 000', website: 'https://dentaria.pt', 'contact:email': 'ola@dentaria.pt' } },
      },
    },
    {
      properties: {
        name: 'Consultório Sem Site', city: 'Coimbra', formatted: 'Av. Emídio Navarro 1, Coimbra',
        lat: 40.209, lon: -8.428, distance: 410, place_id: 'p2',
        categories: ['healthcare.dentist'],
      },
    },
  ],
};

/** Um `fetch` de mentira que regista os pedidos para se poder inspeccioná-los. */
function falso(rotas) {
  const pedidos = [];
  const fn = async (url, opcoes = {}) => {
    const u = String(url);
    pedidos.push({ url: u, opcoes });
    const chave = Object.keys(rotas).find((k) => u.includes(k));
    if (!chave) throw new Error(`pedido inesperado: ${u}`);
    const r = typeof rotas[chave] === 'function' ? rotas[chave](url, opcoes) : rotas[chave];
    const status = r.status || 200;
    return { ok: status < 400, status, json: async () => r.json, text: async () => JSON.stringify(r.json ?? '') };
  };
  fn.pedidos = pedidos;
  return fn;
}

/* ---------- 1 · estado sem chaves ---------- */
test('pesquisa: sem chaves diz o que falta, em vez de fingir que sabe procurar', () => {
  const e = estado({});
  assert.equal(e.geoapify.disponivel, false);
  assert.match(e.geoapify.motivo, /GEOAPIFY_API_KEY/);
  assert.equal(e.tavily.disponivel, false);
  assert.match(e.tavily.motivo, /TAVILY_API_KEY/);
  assert.equal(e.qualquer, false);
  const com = estado(ENV);
  assert.equal(com.geoapify.disponivel, true);
  assert.equal(com.tavily.disponivel, true);
  assert.equal(com.qualquer, true);
  /* a chave não é devolvida: só o nome da variável */
  assert.equal(JSON.stringify(com).includes(CHAVE_GEO), false);
});

test('pesquisa: mascarar mostra o suficiente para reconhecer, nunca a chave toda', () => {
  const m = mascarar(CHAVE_TAV);
  assert.ok(m.startsWith('chav') && m.includes('…'));
  assert.equal(m.length < CHAVE_TAV.length, true);
  assert.equal(mascarar('curta'), '••••');
});

/* ---------- 2 · a atividade → categoria ---------- */
test('pesquisa: a atividade em português vira categoria do Geoapify', () => {
  assert.equal(acharCategoria('clínicas dentárias').categoria, 'healthcare.dentist');
  assert.equal(acharCategoria('Dentistas').categoria, 'healthcare.dentist');
  assert.equal(acharCategoria('restaurantes').categoria, 'catering.restaurant');
  assert.equal(acharCategoria('cabeleireiros').categoria, 'service.beauty.hairdresser');
  /* uma categoria já em formato Geoapify passa tal e qual */
  assert.deepEqual(acharCategoria('office.lawyer'), { id: 'directo', categoria: 'office.lawyer' });
  /* o que não se conhece não é adivinhado */
  assert.equal(acharCategoria('astronautas'), null);
  assert.ok(CATEGORIAS.length >= 20);
});

test('pesquisa: atividade desconhecida é recusada com a lista, não com resultados ao acaso', async () => {
  await assert.rejects(
    () => procurarLeads({ oQue: 'astronautas', onde: 'Coimbra' }, { env: ENV, fetchImpl: falso({}) }),
    /não sei que categoria procurar/,
  );
  await assert.rejects(
    () => procurarLeads({ oQue: 'dentistas', onde: 'Coimbra' }, { env: {}, fetchImpl: falso({}) }),
    /falta GEOAPIFY_API_KEY/,
  );
});

/* ---------- 3 · geocodificar e procurar ---------- */
test('pesquisa: geocodificar devolve o centro e a cidade', async () => {
  const f = falso({ 'geocode/search': { json: GEO } });
  const [c] = await geocodificar({ texto: 'Coimbra' }, { env: ENV, fetchImpl: f });
  assert.equal(c.cidade, 'Coimbra');
  assert.equal(c.lat, 40.2111);
  const url = f.pedidos[0].url;
  assert.match(url, /text=Coimbra/);
  assert.match(url, /apiKey=/);
});

test('pesquisa: os leads vêm da zona pedida, com telefone, site e nota', async () => {
  const f = falso({ 'geocode/search': { json: GEO }, 'v2/places': { json: PLACES } });
  const r = await procurarLeads({ oQue: 'dentistas', onde: 'Coimbra', limite: 5, raio: 3000 }, { env: ENV, fetchImpl: f });
  assert.equal(r.categoria, 'healthcare.dentist');
  assert.equal(r.encontrados, 2);
  assert.equal(r.centro.cidade, 'Coimbra');

  const url = f.pedidos[1].url;
  assert.match(url, /categories=healthcare\.dentist/);
  assert.match(url, /filter=circle%3A-8\.4291%2C40\.2111%2C3000|filter=circle:-8\.4291,40\.2111,3000/);

  const [com, sem] = r.leads;
  assert.equal(com.nome, 'Clínica Dentária do Mondego');
  assert.equal(com.telefone, '+351239000000');
  assert.equal(com.website, 'https://dentaria.pt');
  assert.equal(com.email, 'ola@dentaria.pt');
  assert.equal(com.nota, 54);
  assert.match(com.porque, /já tem site/);
  assert.equal(sem.nota, 80);
  assert.match(sem.porque, /sem site/);
  assert.equal(JSON.stringify(r).includes(CHAVE_GEO), false, 'a chave não pode viajar no resultado');
});

test('pesquisa: uma recusa do Geoapify não revela a chave', async () => {
  const f = falso({ 'geocode/search': { json: GEO }, 'v2/places': { status: 403, json: { message: 'Forbidden' } } });
  await assert.rejects(
    () => procurarLeads({ oQue: 'dentistas', onde: 'Coimbra' }, { env: ENV, fetchImpl: f }),
    (e) => {
      assert.match(e.message, /recusou a chave/);
      assert.equal(e.message.includes(CHAVE_GEO), false);
      return true;
    },
  );
});

/* ---------- 4 · Tavily ---------- */
test('pesquisa: a Tavily é chamada com Bearer, e devolve excertos sem a chave', async () => {
  const f = falso({
    'api.tavily.com/search': {
      json: {
        answer: 'O Órbita Studio é um escritório de agentes.',
        results: [
          { title: 'Órbita', url: 'https://exemplo.pt/a', content: 'texto do resultado', score: 0.82 },
          { title: 'Outro', url: 'https://exemplo.pt/b', content: 'mais texto', score: 0.5 },
        ],
      },
    },
  });
  const r = await pesquisarWeb({ consulta: 'Órbita Studio', limite: 3 }, { env: ENV, fetchImpl: f });
  assert.equal(r.encontrados, 2);
  assert.equal(r.resultados[0].url, 'https://exemplo.pt/a');
  assert.equal(r.resultados[0].relevancia, 0.82);
  assert.match(r.respostaCurta, /escritório/);
  const p = f.pedidos[0];
  assert.equal(p.opcoes.method, 'POST');
  assert.equal(p.opcoes.headers.Authorization, `Bearer ${CHAVE_TAV}`);
  const corpo = JSON.parse(p.opcoes.body);
  assert.equal(corpo.query, 'Órbita Studio');
  assert.equal(corpo.max_results, 3);
  assert.equal(JSON.stringify(r).includes(CHAVE_TAV), false);
});

test('pesquisa: uma chave recusada pela Tavily aparece dita, não escondida', async () => {
  const f = falso({ 'api.tavily.com/search': { status: 401, json: { detail: { error: 'Unauthorized' } } } });
  await assert.rejects(
    () => pesquisarWeb({ consulta: 'x' }, { env: ENV, fetchImpl: f }),
    (e) => {
      assert.match(e.message, /recusou a chave \(HTTP 401\)/);
      assert.equal(e.message.includes(CHAVE_TAV), false);
      return true;
    },
  );
});

test('pesquisa: extrair uma página usa /extract e corta o texto', async () => {
  const f = falso({ 'api.tavily.com/extract': { json: { results: [{ title: 'Página', raw_content: 'A'.repeat(30000) }], failed_results: [] } } });
  const r = await extrairPagina({ url: 'https://exemplo.pt/a' }, { env: ENV, fetchImpl: f });
  assert.equal(r.titulo, 'Página');
  assert.equal(r.texto.length, 20000);
  assert.equal(JSON.parse(f.pedidos[0].opcoes.body).urls[0], 'https://exemplo.pt/a');
});

/* ---------- 5 · a sonda do botão «Testar ligação» ---------- */
test('pesquisa: a sonda faz um pedido real e distingue falta de chave de falha', async () => {
  const semChave = await testarFonte('geoapify', { env: {}, fetchImpl: falso({}) });
  assert.equal(semChave.ok, false);
  assert.equal(semChave.codigo, 'semchave');

  const f = falso({ 'geocode/search': { json: GEO }, 'api.tavily.com/search': { json: { results: [{ title: 'a', url: 'https://a.pt', content: 'x' }] } } });
  const geo = await testarFonte('geoapify', { env: ENV, fetchImpl: f });
  assert.equal(geo.ok, true);
  assert.match(geo.detalhe, /Coimbra/);
  const tav = await testarFonte('tavily', { env: ENV, fetchImpl: f });
  assert.equal(tav.ok, true);
  assert.match(tav.detalhe, /1 resultado/);
});

/* ---------- 6 · as rotas ---------- */
const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) =>
  responder(repo, { caminho, metodo, corpo, env: ENV, ...extra });

test('rotas: /pesquisa/estado mostra as fontes e a cifra sem revelar chaves', async () => {
  const repo = createMemRepo();
  const r = await chamar(repo, '/pesquisa/estado');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.fontes.geoapify.disponivel, true);
  assert.equal(r.corpo.cifra.disponivel, false, 'sem ORBITA_CHAVE nem base, não há chave de cifra');
  assert.match(r.corpo.cifra.motivo, /ORBITA_CHAVE/);
  assert.equal(JSON.stringify(r.corpo).includes(CHAVE_GEO), false);
});

test('rotas: /pesquisa/leads guarda no funil e não duplica na segunda vez', async () => {
  const repo = createMemRepo();
  const f = falso({ 'geocode/search': { json: GEO }, 'v2/places': { json: PLACES } });
  const a = await chamar(repo, '/pesquisa/leads', 'POST', { oQue: 'dentistas', onde: 'Coimbra' }, { fetchImpl: f });
  assert.equal(a.status, 200);
  assert.equal(a.corpo.guardados.novos, 2);
  assert.equal(repo._dados.leads.length, 2);
  const guardado = repo._dados.leads.find((l) => l.name.startsWith('Clínica'));
  assert.equal(guardado.source, 'geoapify');
  assert.equal(guardado.phone, '+351239000000');
  assert.match(guardado.notes, /nota 54/);

  const b = await chamar(repo, '/pesquisa/leads', 'POST', { oQue: 'dentistas', onde: 'Coimbra' }, { fetchImpl: f });
  assert.equal(b.corpo.guardados.novos, 0);
  assert.equal(b.corpo.guardados.repetidos, 2);
  assert.equal(repo._dados.leads.length, 2);
});

test('rotas: /pesquisa/leads sem chave responde 502 com a razão (nunca 500 nem resultado vazio)', async () => {
  const repo = createMemRepo();
  const r = await responder(repo, { caminho: '/pesquisa/leads', metodo: 'POST', corpo: { oQue: 'dentistas', onde: 'Coimbra' }, env: {} });
  assert.equal(r.status, 502);
  assert.match(r.corpo.erro, /GEOAPIFY_API_KEY/);
});

test('rotas: /pesquisa/web devolve contexto e diz que não escreveu no funil', async () => {
  const repo = createMemRepo();
  const f = falso({ 'api.tavily.com/search': { json: { results: [{ title: 'a', url: 'https://a.pt', content: 'x', score: 0.4 }] } } });
  const r = await chamar(repo, '/pesquisa/web', 'POST', { consulta: 'clínicas em Coimbra' }, { fetchImpl: f });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.guardados, null);
  assert.match(r.corpo.nota, /não leads/);
  assert.equal(repo._dados.leads.length, 0);
});

test('rotas: o Centro de Controlo vê as duas fontes e testa-as a sério', async () => {
  const repo = createMemRepo();
  const lista = await chamar(repo, '/platform/apis');
  const geo = lista.corpo.list.find((x) => x.id === 'geoapify');
  const tav = lista.corpo.list.find((x) => x.id === 'tavily');
  assert.ok(geo && tav, 'as duas fontes têm de aparecer no inventário');
  assert.equal(geo.configured, true);
  assert.equal(geo.via, 'chave');
  assert.deepEqual(geo.missing, []);
  /* a Tavily está no catálogo de IA mas não conversa: aparece UMA vez, como
     fonte de pesquisa — não se duplica na lista de modelos que sabem falar */
  assert.equal(lista.corpo.list.filter((x) => x.id.includes('tavily')).length, 1);

  const f = falso({ 'geocode/search': { json: GEO }, 'api.tavily.com/search': { json: { results: [{ title: 'a', url: 'https://a.pt', content: 'x' }] } } });
  const t1 = await chamar(repo, '/platform/testar', 'POST', { id: 'geoapify' }, { fetchImpl: f });
  assert.equal(t1.corpo.ok, true);
  assert.match(t1.corpo.detalhe, /Coimbra/);
  const t2 = await chamar(repo, '/platform/testar', 'POST', { id: 'tavily' }, { fetchImpl: f });
  assert.equal(t2.corpo.ok, true);
  /* o teste fica guardado: da próxima vez a lista diz que está verificada */
  const depois = await chamar(repo, '/platform/apis');
  assert.equal(depois.corpo.list.find((x) => x.id === 'geoapify').verified, true);
});

test('rotas: por GET a pesquisa é só leitura — nada entra no funil', async () => {
  const repo = createMemRepo();
  const f = falso({ 'geocode/search': { json: GEO }, 'v2/places': { json: PLACES } });
  const r = await chamar(repo, '/pesquisa/leads?oQue=dentistas&onde=Coimbra&limite=5', 'GET', null, { fetchImpl: f });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.encontrados, 2);
  assert.equal(r.corpo.guardados, null);
  assert.equal(repo._dados.leads.length, 0, 'um GET não pode escrever na base');

  const t = await chamar(repo, '/pesquisa/teste?fonte=geoapify', 'GET', null, { fetchImpl: f });
  assert.equal(t.status, 200);
  assert.equal(t.corpo.ok, true);
  assert.equal(t.corpo.fonte, 'geoapify');
  assert.equal(repo._dados.atividade.some((a) => String(a.kind || a.tipo || '').includes('pesquisa')), false, 'um GET não assina o registo');
  const x = await chamar(repo, '/pesquisa/teste?fonte=naoexiste', 'GET', null, { fetchImpl: f });
  assert.equal(x.status, 404);
});
