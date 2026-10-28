/* ===========================================================================
   1.49.0 · provas do Mem0 — 28 out 2026

   Tudo aqui corre sem rede e sem chaves: o `fetch` é falso e inspeccionável.

   O que se prova:
     · sem `MEM0_API_KEY` não sai um único pedido — e o estado di-lo;
     · a chave nunca aparece numa resposta, só mascarada;
     · 401, 429 e rede em baixo dão motivos distintos, e nenhum atira;
     · a procura junta semântica + lexical sem repetir a mesma nota;
     · guardar escreve localmente primeiro: se o Mem0 falhar, a nota fica;
     · o import faz plano sem `confirmar` e só envia com ele;
     · as rotas `/ia/memoria`, `/ia/memoria/importar` e `DELETE mem0:<id>`
       devolvem o que aconteceu, incluindo o erro.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import * as mem0 from './api/_ia/mem0.mjs';
import * as memoria from './api/_ia/memoria.mjs';
import { rotasIA } from './api/_ia/rotas.mjs';

const CHAVE = 'm0-FqdaqsYBx4w2lTJYyxwgwH18KthFZKUTNh6uT149';
const envComChave = { MEM0_API_KEY: CHAVE, MEM0_ORG_ID: 'org_fiJvHSnPHxUcSURDk49VQlxbnIRyMG3v5i4AipHF', MEM0_PROJECT_ID: 'proj_WmsKb6RxpXWY0mZzjAH0Q5BEdewURXBqtCahldA6' };

const resp = (corpo, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(corpo) });

/** Um `fetch` falso que registra tudo o que lhe foi pedido. */
function fetchFalso(guiao) {
  const chamadas = [];
  const fn = async (url, opcoes = {}) => {
    chamadas.push({ url, metodo: opcoes.method || 'GET', cabecalhos: opcoes.headers || {}, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    const r = typeof guiao === 'function' ? guiao(url, opcoes, chamadas.length) : guiao;
    if (r instanceof Error) throw r;
    return r;
  };
  fn.chamadas = chamadas;
  return fn;
}

const notaLocal = {
  titulo: 'O dono prefere PT-PT sem estrangeirismos',
  texto: 'Nas respostas e na interface: português de Portugal, sem «você» e sem anglismos desnecessários.',
  etiquetas: ['preferencias'],
  fonte: 'conversa',
  projeto: 'orbita',
};

/* ---------- 1 · sem chave não se faz nada ---------- */
test('mem0: sem chave não sai um único pedido e o estado diz porquê', async () => {
  const fetch = fetchFalso(() => { throw new Error('não devia haver pedido nenhum'); });
  const s = await mem0.saude(mem0.config({}), { fetchImpl: fetch });
  assert.equal(s.configurada, false);
  assert.equal(s.ligada, false);
  assert.match(s.porque, /MEM0_API_KEY/);
  assert.equal(fetch.chamadas.length, 0);
});

/* ---------- 2 · com chave: ping, e a chave não sai ---------- */
test('mem0: com chave faz ping e a resposta só mostra a chave mascarada', async () => {
  const fetch = fetchFalso(resp({ status: 'ok' }));
  const s = await mem0.saude(mem0.config(envComChave), { fetchImpl: fetch });
  assert.equal(s.ligada, true);
  assert.equal(s.chave, `m0-F…T149`);
  assert.equal(JSON.stringify(s).includes(CHAVE), false, 'a chave inteira não pode aparecer');
  assert.equal(fetch.chamadas[0].url, 'https://api.mem0.ai/v1/ping/');
  assert.equal(fetch.chamadas[0].cabecalhos.Authorization, `Token ${CHAVE}`);
  assert.equal(fetch.chamadas[0].cabecalhos['X-Org-Id'], envComChave.MEM0_ORG_ID);
});

/* ---------- 3 · erros distintos, nenhum atira ---------- */
test('mem0: 401, 429 e rede em baixo dão motivos diferentes', async () => {
  const r401 = await mem0.saude(mem0.config(envComChave), { fetchImpl: fetchFalso(resp({ detail: 'invalid' }, 401)) });
  assert.equal(r401.ligada, false);
  assert.match(r401.porque, /401/);

  const r429 = await mem0.pesquisar(mem0.config(envComChave), { consulta: 'x', fetchImpl: fetchFalso(resp({}, 429)) });
  assert.equal(r429.ok, false);
  assert.match(r429.motivo, /429/);

  const semRede = await mem0.saude(mem0.config(envComChave), {
    fetchImpl: fetchFalso(() => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })),
  });
  assert.equal(semRede.ligada, false);
  assert.match(semRede.porque, /ECONNRESET|sem ligação/);
});

/* ---------- 4 · pesquisa: mapeamento e filtros ---------- */
test('mem0: a pesquisa mapeia score em pontos e leva o user_id do filtro', async () => {
  const fetch = fetchFalso(resp([{ id: 'abc123', memory: 'Prefere respostas curtas', score: 0.87, metadata: { projeto: 'orbita' }, created_at: '2026-10-01T10:00:00Z' }]));
  const r = await mem0.pesquisar(mem0.config(envComChave), { consulta: 'como responder', limite: 5, fetchImpl: fetch });
  assert.equal(r.ok, true);
  assert.equal(r.achados.length, 1);
  assert.equal(r.achados[0].id, 'mem0:abc123');
  assert.equal(r.achados[0].origem, 'mem0');
  assert.equal(r.achados[0].pontos, 8.7);
  assert.equal(fetch.chamadas[0].url, 'https://api.mem0.ai/v2/memories/search/');
  assert.deepEqual(fetch.chamadas[0].corpo.filters, { user_id: 'orbita' });
  assert.equal(fetch.chamadas[0].corpo.version, 'v2');
});

/* ---------- 5 · guardar no Mem0 é verbatim, com metadata ---------- */
test('mem0: adicionar guarda o texto tal como está (infer:false) e devolve o id', async () => {
  const fetch = fetchFalso(resp([{ id: 'novo-1', event: 'ADD' }]));
  const r = await mem0.adicionar(mem0.config(envComChave), {
    texto: 'Uma nota suficientemente longa para passar.',
    titulo: 'Decisão',
    metadados: { projeto: 'orbita' },
    fetchImpl: fetch,
  });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'novo-1');
  assert.equal(fetch.chamadas[0].corpo.infer, false);
  assert.equal(fetch.chamadas[0].corpo.messages[0].content, 'Uma nota suficientemente longa para passar.');
  assert.equal(fetch.chamadas[0].corpo.metadata.titulo, 'Decisão');
  assert.equal(fetch.chamadas[0].corpo.user_id, 'orbita');
});

/* ---------- 6 · a procura da memória junta as duas camadas ---------- */
test('memória: com Mem0 a procura é mem0+lexical e não repete a mesma nota', async () => {
  const repo = createMemRepo();
  await memoria.guardar(repo, notaLocal, { env: {} });

  const igual = `# ${notaLocal.titulo}\n\n${notaLocal.texto}`;
  const fetch = fetchFalso(resp([{ id: 'x1', memory: igual, score: 0.9 }, { id: 'x2', memory: 'Prefere tabelas a parágrafos longos', score: 0.6 }]));
  const r = await memoria.procurar(repo, { consulta: 'português de portugal', env: envComChave, fetchImpl: fetch });

  assert.equal(r.modo, 'mem0+lexical');
  assert.equal(r.mem0.ligada, true);
  const textos = r.achados.map((n) => String(n.texto).slice(0, 40));
  assert.equal(new Set(textos).size, textos.length, 'a mesma nota não pode aparecer duas vezes');
  assert.equal(r.achados.some((n) => n.origem === 'mem0'), true);
});

/* ---------- 7 · Mem0 em baixo: a lexical continua e diz o motivo ---------- */
test('memória: Mem0 em baixo não estraga a procura local e o motivo vai na resposta', async () => {
  const repo = createMemRepo();
  await memoria.guardar(repo, notaLocal, { env: {} });
  const r = await memoria.procurar(repo, {
    consulta: 'português',
    env: envComChave,
    fetchImpl: fetchFalso(resp({ detail: 'boom' }, 500)),
  });
  assert.equal(r.modo, 'lexical');
  assert.equal(r.mem0.ligada, false);
  assert.match(r.mem0.motivo, /500/);
  assert.equal(r.achados.length >= 1, true);
});

/* ---------- 8 · guardar escreve localmente antes; o Mem0 é um extra ---------- */
test('memória: guardar grava local e empurra para o Mem0; se o Mem0 falhar a nota fica', async () => {
  const repo = createMemRepo();
  const bom = await memoria.guardar(repo, notaLocal, { env: envComChave, fetchImpl: fetchFalso(resp([{ id: 'm-1' }])) });
  assert.equal(bom.criada, true);
  assert.equal(bom.mem0.ok, true);
  assert.equal(bom.mem0.id, 'm-1');

  const outra = { ...notaLocal, titulo: 'Outra nota distinta', texto: 'Texto diferente o suficiente para não ser duplicado.' };
  const mau = await memoria.guardar(repo, outra, { env: envComChave, fetchImpl: fetchFalso(resp({ error: 'fora' }, 503)) });
  assert.equal(mau.ok, true, 'a nota não pode perder-se por causa do Mem0');
  assert.equal(mau.criada, true);
  assert.equal(mau.mem0.ok, false);
  assert.equal(mau.mem0.motivo.length > 0, true);
});

/* ---------- 9 · o import tem plano e portão ---------- */
test('memória: importar mostra o plano sem enviar nada e só envia com confirmar', async () => {
  const repo = createMemRepo();
  const itens = [
    { memory: '# SOUL\n\nGosto de respostas directas, em PT-PT.', metadata: { fonte: 'SOUL.md' } },
    { memory: '# USER\n\nVive em Coimbra. Prefere silêncio a ruído.', metadata: { fonte: 'USER.md' } },
  ];
  const fetch = fetchFalso(resp([{ id: 'i1' }]));
  const plano = await memoria.importar(repo, { itens, env: envComChave, fetchImpl: fetch });
  assert.equal(plano.confirmado, false);
  assert.equal(plano.quantos, 2);
  assert.equal(fetch.chamadas.length, 0, 'sem confirmar não sai nada');

  const feito = await memoria.importar(repo, { itens, confirmar: true, env: envComChave, fetchImpl: fetch });
  assert.equal(feito.importados, 2);
  assert.equal(feito.falhados, 0);
  assert.equal(fetch.chamadas.length, 2);

  const semChave = await memoria.importar(repo, { itens, confirmar: true, env: {}, fetchImpl: fetch });
  assert.equal(semChave.ok, false);
  assert.match(semChave.erro, /MEM0_API_KEY/);
});

/* ---------- 10 · estado: uma ping por minuto, não uma por desenho ---------- */
test('memória: o estado guarda a saúde do Mem0 em cache (não faz ping a cada desenho)', async () => {
  const repo = createMemRepo();
  const env = { MEM0_API_KEY: 'm0-cache-0000000000000000000000000000' };
  const fetch = fetchFalso(resp({ status: 'ok' }));
  const a = await memoria.estado(repo, { env, fetchImpl: fetch });
  const b = await memoria.estado(repo, { env, fetchImpl: fetch });
  assert.equal(a.mem0.ligada, true);
  assert.equal(b.mem0.cache, true);
  assert.equal(fetch.chamadas.length, 1);
});

/* ---------- 11 · as rotas ---------- */
test('rotas: /ia/memoria, /ia/memoria/importar e DELETE mem0:<id> respondem com o real', async () => {
  const repo = createMemRepo();
  const fetch = fetchFalso(() => resp([{ id: 'r-1' }]));

  const estado = await rotasIA(repo, { caminho: '/ia/memoria', metodo: 'GET', env: envComChave, fetchImpl: fetch });
  assert.equal(estado.status, 200);
  assert.equal(estado.corpo.mem0.ligada, true);
  assert.equal(estado.corpo.modo, 'mem0+lexical');

  const semChave = await rotasIA(repo, { caminho: '/ia/memoria', metodo: 'GET', env: {}, fetchImpl: fetch });
  assert.equal(semChave.corpo.mem0.configurada, false);

  const plano = await rotasIA(repo, {
    caminho: '/ia/memoria/importar', metodo: 'POST',
    corpo: { itens: [{ memory: 'Uma memória suficientemente longa para importar.' }] },
    env: envComChave, fetchImpl: fetch,
  });
  assert.equal(plano.status, 200);
  assert.equal(plano.corpo.confirmado, false);

  const confirmado = await rotasIA(repo, {
    caminho: '/ia/memoria/importar', metodo: 'POST',
    corpo: { itens: [{ memory: 'Uma memória suficientemente longa para importar.' }], confirmar: true },
    env: envComChave, fetchImpl: fetch,
  });
  assert.equal(confirmado.corpo.importados, 1);

  const apagar = await rotasIA(repo, { caminho: '/ia/memoria/mem0:r-1a2b3c', metodo: 'DELETE', env: envComChave, fetchImpl: fetch });
  assert.equal(apagar.status, 200);
  assert.equal(apagar.corpo.apagada, 'r-1a2b3c');
});
