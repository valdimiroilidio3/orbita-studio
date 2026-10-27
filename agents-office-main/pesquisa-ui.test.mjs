/* ===========================================================================
   A gaveta PESQUISAR — provas de interface (27 out 2026 · 1.28.0).

   Duas coisas que o dono pediu e que aqui ficam medidas, não prometidas:

     1 · a pesquisa fala com as rotas PUBLICADAS (`/api/rpc?caminho=/pesquisa/*`).
         Antes pedia `/api/google` e `/api/google/search`, que só existem em
         `serve.mjs` — na aplicação publicada davam 404 e a gaveta ficava quieta;
     2 · o manual de configuração saiu da interface. Nem «console.cloud.google.com»
         nem «GOOGLE_MAPS_API_KEY» podem voltar a aparecer a quem usa o escritório.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

const HTML = `<!doctype html><body>
  <button id="topLeads"></button>
  <div id="leadsPanel" hidden>
    <div class="ld-h"><span class="lab">Pesquisar</span><span class="cnt">—</span><span class="sp"></span>
      <button class="ld-refresh"></button><button class="ld-close"></button></div>
    <div class="ld-seg" role="tablist">
      <button class="ld-m on" data-k="places" role="tab"></button>
      <button class="ld-m" data-k="web" role="tab"></button>
      <span class="ld-fonte" data-fonte></span>
    </div>
    <div class="ld-form">
      <input class="ld-what"><input class="ld-where"><button class="go">Procurar</button>
    </div>
    <div class="ld-chips" data-chips hidden></div>
    <div class="ld-row2"><span class="hint"></span></div>
    <div class="ld-list"></div>
    <div class="ld-foot"><span class="hint"></span><button class="ld-task">→ TAREFA</button></div>
  </div>
  <div class="tp-in"></div>
</body>`;

const estadoOk = {
  status: 200,
  corpo: {
    ok: true,
    fontes: {
      geoapify: { disponivel: true, oQue: 'empresas reais' },
      tavily: { disponivel: true, oQue: 'web' },
      google: { places: { disponivel: false }, web: { disponivel: false } },
      qualquer: true,
    },
  },
};
const categorias = { status: 200, corpo: { total: 2, categorias: [{ id: 'dentista', categoria: 'healthcare.dentist' }, { id: 'cafe', categoria: 'catering.cafe' }] } };
const guardados = { status: 200, corpo: { leads: [{ id: 'l1', name: 'Clínica Velha', city: 'Coimbra', website: null, phone: '239000000', score: 88, notes: 'sem site' }] } };
const empresas = {
  status: 200,
  corpo: {
    ok: true, fonte: 'geoapify', encontrados: 2,
    leads: [
      { nome: 'Clínica do Mondego', cidade: 'Coimbra', morada: 'Rua Larga 1, Coimbra', telefone: '+351 239 111 222', website: '', nota: 88, porque: 'sem site · telefone público', lat: 40.2, lon: -8.4 },
      { nome: 'Dental Sé', cidade: 'Coimbra', morada: 'Praça 8 de Maio, Coimbra', telefone: '', website: 'https://dentalse.pt', nota: 46, porque: 'já tem site', lat: 40.21, lon: -8.42 },
    ],
    guardados: { novos: 2, repetidos: 0, total: 2 },
  },
};
const web = {
  status: 200,
  corpo: {
    ok: true, fonte: 'tavily', encontrados: 1, respostaCurta: 'O mercado é fragmentado.',
    resultados: [{ titulo: 'Retrato do setor', url: 'https://exemplo.pt/estudo', excerto: 'Há 1 200 clínicas na região.', relevancia: 0.81 }],
  },
};

/** Um `fetch` que registra o que foi pedido e responde com o real. */
function montarFetch(pedidos) {
  return async (url, opt = {}) => {
    const alvo = decodeURIComponent(String(url) + (typeof opt.body === 'string' ? ' ' + opt.body : ''));
    pedidos.push(alvo);
    const corpo = alvo.includes('/pesquisa/estado') ? estadoOk
      : alvo.includes('/pesquisa/categorias') ? categorias
      : alvo.includes('/ops/leads') ? guardados
      : alvo.includes('/pesquisa/leads') ? empresas
      : alvo.includes('/pesquisa/web') ? web
      : { status: 404, corpo: { erro: 'rota desconhecida' } };
    return { ok: true, status: 200, json: async () => corpo };
  };
}

async function abrirGaveta() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(HTML, { url: 'https://mesa.teste/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const pedidos = [];
  globalThis.fetch = montarFetch(pedidos);
  const { initLeads } = await import('./src/leads.js');
  const gaveta = initLeads({ api: '/api' });
  gaveta.open();
  await new Promise((r) => setTimeout(r, 40));
  return { dom, document: dom.window.document, pedidos, gaveta };
}

test('pesquisa: a gaveta lê o estado e as categorias pelas rotas publicadas', async () => {
  const { document, pedidos } = await abrirGaveta();
  const juntos = pedidos.join(' | ');
  assert.match(juntos, /\/api\/rpc\?caminho=%2Fpesquisa%2Festado|\/api\/rpc\?caminho=\/pesquisa\/estado/);
  assert.ok(juntos.includes('/pesquisa/categorias'), 'as sugestões deviam vir de /pesquisa/categorias');
  assert.ok(juntos.includes('/ops/leads'), 'a lista guardada vem de /ops/leads');
  /* a fonte aparece dita em nome de gente, não em nome de variável */
  assert.equal(document.querySelector('[data-fonte]').textContent, 'Geoapify · OpenStreetMap');
  assert.equal(document.querySelector('.ld-h .cnt').textContent, '1 GUARDADOS');
});

test('pesquisa: nada de manuais de configuração na interface', async () => {
  const { document } = await abrirGaveta();
  const texto = document.getElementById('leadsPanel').textContent;
  for (const proibido of ['console.cloud.google.com', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_CSE_ID', 'GEOAPIFY_API_KEY', 'TAVILY_API_KEY', 'variável']) {
    assert.ok(!texto.includes(proibido), `«${proibido}» não pode aparecer na gaveta do visitante`);
  }
  /* as chaves continuam a existir — no código do servidor, que é o sítio delas */
});

test('pesquisa: procurar empresas devolve leads reais com nota e sem site', async () => {
  const { document, pedidos } = await abrirGaveta();
  document.querySelector('.ld-what').value = 'dentistas';
  document.querySelector('.ld-where').value = 'Coimbra';
  document.querySelector('.ld-form .go').dispatchEvent(new document.defaultView.Event('click'));
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(pedidos.some((p) => p.includes('/pesquisa/leads') && p.includes('dentistas')), 'o POST devia levar a atividade e a zona');
  const html = document.querySelector('.ld-list').innerHTML;
  assert.match(html, /Clínica do Mondego/);
  assert.match(html, /Rua Larga 1, Coimbra/);
  assert.match(html, /sem site/);
  assert.match(html, /88<small>NOTA/);
  assert.match(html, /Dental Sé/);
  assert.match(document.querySelector('.ld-row2 .hint').textContent, /2 empresas/);
  assert.match(document.querySelector('.ld-row2 .hint').innerHTML, /\+2 novos/);
});

test('pesquisa: a web devolve fontes com excertos e resposta curta', async () => {
  const { document, pedidos } = await abrirGaveta();
  document.querySelector('.ld-seg .ld-m[data-k="web"]').dispatchEvent(new document.defaultView.Event('click'));
  document.querySelector('.ld-what').value = 'mercado de clínicas';
  document.querySelector('.ld-form .go').dispatchEvent(new document.defaultView.Event('click'));
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(pedidos.some((p) => p.includes('/pesquisa/web')));
  const html = document.querySelector('.ld-list').innerHTML;
  assert.match(html, /Retrato do setor/);
  assert.match(html, /exemplo\.pt/);
  assert.match(html, /Há 1 200 clínicas na região/);
  assert.match(document.querySelector('.ld-row2 .hint').innerHTML, /O mercado é fragmentado/);
  assert.equal(document.querySelector('.ld-task').hidden, true, 'resultados da web não geram tarefas de abordagem');
});

test('pesquisa: quando a fonte cai, a frase é de gente — não é um nome de variável', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(HTML, { url: 'https://mesa.teste/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.fetch = async (url, opt = {}) => {
    const alvo = String(url) + (typeof opt.body === 'string' ? ' ' + opt.body : '');
    if (decodeURIComponent(alvo).includes('/pesquisa/estado')) {
      return { ok: true, status: 200, json: async () => ({ status: 200, corpo: { fontes: { geoapify: { disponivel: true }, tavily: { disponivel: false }, google: { places: { disponivel: false }, web: { disponivel: false } } } } }) };
    }
    if (decodeURIComponent(alvo).includes('/pesquisa/leads')) {
      return { ok: true, status: 200, json: async () => ({ status: 502, corpo: { ok: false, erro: 'falta GEOAPIFY_API_KEY no ambiente' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ status: 200, corpo: { leads: [], categorias: [] } }) };
  };
  const { initLeads } = await import('./src/leads.js');
  const gaveta = initLeads({ api: '/api' });
  gaveta.open();
  await new Promise((r) => setTimeout(r, 40));
  document.querySelector('.ld-what').value = 'dentistas';
  document.querySelector('.ld-where').value = 'Coimbra';
  document.querySelector('.ld-form .go').dispatchEvent(new dom.window.Event('click'));
  await new Promise((r) => setTimeout(r, 60));
  const dito = document.querySelector('.ld-row2 .hint').textContent;
  assert.match(dito, /não está disponível agora/);
  assert.ok(!dito.includes('GEOAPIFY'), 'o nome da variável não chega ao visitante');
});
