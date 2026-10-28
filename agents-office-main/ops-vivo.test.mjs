/* ===========================================================================
   A gaveta OPERAÇÃO, viva (1.40.0, pedido 58a: «faz o campo de operações ficar
   bem funcional e activo»).

   O que aqui se prova, com a gaveta a sério dentro de um DOM e um servidor falso:

     1 · a leitura de fundo NÃO rouba o que estás a escrever — com um campo de
         texto em foco (ou um formulário aberto) não há pedidos;
     2 · quando os dados são os mesmos, não se repinta a gaveta (o foco e a
         selecção ficam onde estavam);
     3 · o ponto «ao vivo» diz a verdade: «ao vivo» quando acabou de ler,
         «sem servidor» quando a leitura falha — nunca um número inventado;
     4 · o botão «Atualizar» e as acções lêem sempre, mesmo com foco num campo.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

const HTML = `<!doctype html><body>
  <button id="topOps"></button>
  <div id="opsPanel">
    <div class="op-h"><span class="op-sum">a ler…</span>
      <span class="op-live"><i></i><span class="op-live-t">a ligar…</span></span>
      <span class="sp"></span>
      <button class="op-refresh"></button><button class="op-close"></button></div>
    <div class="op-clientes"><select class="op-stage op-client"></select><button class="op-b" data-act="new-client"></button></div>
    <div class="op-tabs"><button class="op-tab on" data-k="leads"></button><button class="op-tab" data-k="messages"></button></div>
    <div class="op-body"></div>
    <div class="op-foot"><span class="op-note"></span></div>
  </div>
</body>`;

/* Um servidor que responde com o mesmo retrato duas vezes, e depois rebenta. */
function servidor({ falhar = false } = {}) {
  const pedidos = [];
  const corpo = (rota) => {
    if (rota.includes('/ops/summary')) {
      return { ok: true, leads: { total: 2 }, funil: { contactados: 1, clientes: 0 }, conversao: { taxaResposta: 50 }, custos: { apiCentimos: 0 }, porFase: [] };
    }
    if (rota.includes('/ops/leads')) return { leads: [{ id: 'l1', name: 'Clínica do Mondego', city: 'Coimbra', score: 88, status: 'novo' }] };
    if (rota.includes('/ops/messages')) return { messages: [] };
    if (rota.includes('/ops/queue')) return { items: [], enviados: [] };
    if (rota.includes('/ops/events')) return { events: [] };
    if (rota.includes('/ops/clientes')) return { clientes: [], activo: null };
    if (rota.includes('/ops/autonomia')) return { tipos: [], limite: { minCasos: 20, minTaxa: 0.95 } };
    if (rota.includes('/ops/evals')) return { ultimo: null };
    if (rota.includes('/ops/ensaio')) return { activo: false, total: 0 };
    if (rota.includes('/ops/saldo')) return { receitaCentimos: 0, custoCentimos: 0, margemCentimos: 0, porCampanha: [], custosPorFornecedor: [], unitarios: {}, janela: { dias: 90 } };
    if (rota.includes('/ops/aprendizagem')) return { total: 0 };
    return {};
  };
  const fetch = async (url) => {
    const rota = decodeURIComponent(String(url));
    pedidos.push(rota);
    if (falhar) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, json: async () => corpo(rota) };
  };
  return { fetch, pedidos };
}

async function abrir(opcoes = {}) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(HTML, { url: 'https://mesa.teste/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.matchMedia = dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const s = servidor(opcoes);
  globalThis.fetch = s.fetch;
  const { initOps } = await import('./src/ops.js');
  const gaveta = initOps({ api: '/api' });
  return { dom, doc: dom.window.document, pedidos: s.pedidos, gaveta };
}

const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms));

test('a primeira leitura desenha a gaveta e diz «ao vivo»', async () => {
  const { dom, doc, pedidos, gaveta } = await abrir();
  gaveta.open();
  await espera();
  assert.ok(pedidos.length >= 5, `esperava a gaveta a ler as rotas reais, fez ${pedidos.length} pedido(s)`);
  const vivo = doc.querySelector('.op-live-t').textContent;
  assert.equal(vivo, 'ao vivo', `o pulso devia dizer «ao vivo» logo depois de ler, disse «${vivo}»`);
  assert.equal(doc.querySelector('.op-live').classList.contains('bad'), false, 'a leitura correu bem e o ponto ficou vermelho');
  dom.window.close();
});

test('com um campo em foco, a leitura de fundo não pede nada', async () => {
  const { dom, doc, pedidos, gaveta } = await abrir();
  gaveta.open();
  await espera();
  const antes = pedidos.length;

  /* o dono está a escrever num campo da gaveta */
  const campo = doc.createElement('input');
  campo.className = 'op-in';
  doc.querySelector('.op-body').appendChild(campo);
  campo.focus();
  assert.equal(doc.activeElement, campo, 'o campo não ficou com o foco (o teste não prova nada)');

  await gaveta.reload();                      // é o que o intervalo de fundo faz
  assert.equal(pedidos.length, antes, 'a leitura de fundo pediu ao servidor com um campo em foco — ia apagar o texto');

  /* o botão «Atualizar» é um gesto explícito: esse lê sempre */
  doc.querySelector('.op-refresh').click();
  await espera();
  assert.ok(pedidos.length > antes, 'o botão «Atualizar» não leu a base de dados');
  dom.window.close();
});

test('sem novidades, a gaveta não se repinta (o cursor fica onde estava)', async () => {
  const { dom, doc, gaveta } = await abrir();
  gaveta.open();
  await espera();
  const corpo = doc.querySelector('.op-body');
  const marca = doc.createElement('span');
  marca.id = 'marca-do-teste';
  corpo.appendChild(marca);

  await gaveta.reload({ forcar: true });      // mesmos dados, outra leitura
  await espera();
  assert.ok(doc.getElementById('marca-do-teste'), 'a gaveta repintou sem novidade nenhuma — isso apaga o foco e a selecção');
  dom.window.close();
});

test('quando o servidor cala, o ponto diz «sem servidor» e não inventa números', async () => {
  const { dom, doc, gaveta } = await abrir({ falhar: true });
  gaveta.open();
  await espera();
  const vivo = doc.querySelector('.op-live-t').textContent;
  assert.equal(vivo, 'sem servidor', `devia dizer «sem servidor», disse «${vivo}»`);
  assert.equal(doc.querySelector('.op-live').classList.contains('bad'), true, 'o ponto devia ficar vermelho com o servidor em baixo');
  dom.window.close();
});
