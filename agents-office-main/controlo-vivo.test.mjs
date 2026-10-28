/* ===========================================================================
   O Centro de Controlo, ao vivo (1.40.0 · pedido 58b: «100% funcional ao site
   mudando permanentemente — qualquer mudança afecta realmente o sistema em
   tempo real»).

   Duas coisas se provam aqui, e nenhuma é decorativa:

     1 · cada sala do painel mostra o trabalho que está a acontecer AGORA, lido
         da cena (`window.ORBITA.trabalho`) — a mesma conta que acende a luz;
     2 · esse número chega sozinho, de 3 em 3 segundos, sem repintar o painel
         (um repaint levava o foco e o que estivesse a ser escrito).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

const HTML = `<!doctype html><body>
  <button id="topCfg" aria-expanded="false"></button>
  <div id="cfgPanel" hidden aria-hidden="true"><b id="cfgTitle"></b><span class="cfg-sum"></span><div class="cfg-body"></div></div>
</body>`;

const estado = {
  status: 200,
  corpo: {
    versao: '1.40.0',
    ajustes: { cores: {}, agentes: [], tamanhos: {} },
    registo: [],
    ia: { pronto: true, conhecido: true, comChave: 0, funcionais: [], porTestar: 0, fornecedores: [] },
    execucao: { runs24h: 0, chamadas24h: 0, a_funcionar: false },
    seguranca: { autenticacao: false, chavesNoServidor: true, aprovacaoHumana: true },
  },
};

async function abrir(trabalho) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(HTML, { url: 'https://mesa.teste/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.matchMedia = dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  /* a cena só existe enquanto o teste a segurar — como no browser */
  dom.window.ORBITA = { trabalho };

  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    const corpo = u.includes('/controlo/estado') ? estado : { status: 200, corpo: { list: [], summary: {} } };
    return { ok: true, status: 200, json: async () => corpo };
  };

  const { createConfig } = await import('./src/config.js');
  const cfg = createConfig({ panel: dom.window.document.getElementById('cfgPanel'), theme: 'auto' });
  cfg.open();
  await new Promise((r) => setTimeout(r, 40));
  return { dom, doc: dom.window.document, cfg };
}

const linhaDe = (doc, dept) => doc.querySelector(`[data-now="${dept}"]`);

test('cada sala mostra o trabalho que está a acontecer agora', async () => {
  const { dom, doc, cfg } = await abrir((d) => ({ live: d === 'sales' ? 2 : 0, waiting: d === 'ops' ? 3 : 0, done: 0 }));

  const vendas = linhaDe(doc, 'sales');
  assert.ok(vendas, 'a sala sales não tem a linha do trabalho ao vivo');
  assert.equal(vendas.querySelector('[data-trabalho]').textContent, '2 a trabalhar', 'a sala com trabalho não mostra as 2 tarefas a correr');
  assert.equal(vendas.classList.contains('live'), true, 'o ponto da sala devia estar aceso (.live)');

  const ops = linhaDe(doc, 'ops');
  assert.equal(ops.querySelector('[data-trabalho]').textContent, '3 à espera do teu OK', 'as aprovações pendentes não aparecem');
  assert.equal(ops.classList.contains('live'), false, 'uma sala só à espera não está a produzir — o ponto não devia estar aceso');

  const marketing = linhaDe(doc, 'marketing');
  assert.equal(marketing.querySelector('[data-trabalho]').textContent, 'sem trabalho agora', 'uma sala parada devia dizer que está parada');
  cfg.close();
  dom.window.close();
});

test('o número chega sozinho, sem repintar o painel', async () => {
  let live = 1;
  const { dom, doc, cfg } = await abrir(() => ({ live, waiting: 0, done: 0 }));
  const corpo = doc.querySelector('.cfg-body');
  /* uma marca que só existe se o painel NÃO for reconstruído */
  const marca = doc.createElement('span');
  marca.id = 'marca-do-teste';
  corpo.appendChild(marca);

  const antes = linhaDe(doc, 'fin').querySelector('[data-trabalho]').textContent;
  assert.equal(antes, '1 a trabalhar', `o primeiro retrato devia mostrar 1 a trabalhar, mostrou «${antes}»`);

  live = 4;                                   // a cena passa a ter quatro tarefas
  await new Promise((r) => setTimeout(r, 3200)); // o relógio de 3 s

  assert.ok(doc.getElementById('marca-do-teste'), 'o painel foi reconstruído — isso apagava o foco de quem escreve');
  const depois = linhaDe(doc, 'fin').querySelector('[data-trabalho]').textContent;
  assert.equal(depois, '4 a trabalhar', `o trabalho ao vivo não se actualizou sozinho (ficou «${depois}»)`);
  cfg.close();
  dom.window.close();
});
