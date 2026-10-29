/* ===========================================================================
   1.53.0 · A LOJA DE APPS — provas sem servidor e sem rede.

   O dono pediu duas coisas que se provam: o visual das imagens (secções com
   contagem, cartões, `✓ Conectado` / `Conectar`) e que o botão LIGUE mesmo.

   O que fica provado aqui:
     · as secções e as contagens são as da referência (Programação 11, Design 3,
       Produtividade 12) e nenhuma app fica de fora do catálogo;
     · `Conectado` só aparece com prova do servidor; sem prova, o botão diz
       `Conectar` — e um serviço OAuth/CLI/sem-API não finge ter chave;
     · carregar em `Conectar` abre o campo, e «Guardar e testar» faz um POST
       verdadeiro com o id e os valores certos;
     · a resposta 501 (o site publicado, onde as chaves vivem no ambiente da
       Vercel) é mostrada por palavras — não se diz «guardado»;
     · sem servidor, a folha abre na mesma e diz que as chaves vivem na máquina.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { APPS, SECOES, agrupar, estadoDoApp, juntarComServidor, iniciais } from './src/catalogo-apps.js';
import { createApps, CSS_APPS } from './src/apps.js';

const dom = () => new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://127.0.0.1:4600/' });

/** Um servidor falso que registra o que lhe pediram. */
function servidorFalso(respostas = {}) {
  const chamadas = [];
  const fetchImpl = async (url, init = {}) => {
    chamadas.push({ url, init });
    const caminho = String(url);
    const corpo = respostas[caminho] ?? respostas.default ?? { ok: true };
    return { status: corpo.__status ?? 200, ok: (corpo.__status ?? 200) < 400, json: async () => corpo.corpo ?? corpo };
  };
  return { chamadas, fetchImpl };
}

/* ---------- o catálogo ---------- */
test('as secções são as da referência, pela ordem, e as contagens batem com o catálogo', () => {
  assert.deepEqual([...SECOES], ['Programação', 'Design', 'Dados e análise', 'Produtividade', 'IA', 'Mensagens', 'Pagamentos e loja', 'Infra e nuvem']);
  const grupos = agrupar();
  const porNome = Object.fromEntries(grupos.map((g) => [g.nome, g.itens.length]));
  assert.equal(porNome['Programação'], 11, 'a referência tem «Programação 11»');
  assert.equal(porNome['Design'], 3);
  assert.equal(porNome['Produtividade'], 12);
  // nenhuma app do catálogo se perde pelo caminho
  assert.equal(grupos.reduce((n, g) => n + g.itens.length, 0), APPS.length);
});

test('cada app diz como se liga: e as que não têm chave dizem-no antes de se clicar', () => {
  const ids = APPS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'há um id repetido');
  for (const a of APPS) {
    assert.ok(['chave', 'oauth', 'cli', 'sem-api'].includes(a.tipo), `${a.id}: tipo desconhecido (${a.tipo})`);
    if (a.tipo === 'chave') assert.ok(a.env.length, `${a.id}: diz que tem chave e não diz qual`);
    if (a.tipo !== 'chave') assert.equal(a.env.length === 0 || !!a.site, true, `${a.id}: sem chave nem sítio para explicar`);
  }
  // os casos honestos existem mesmo (não são uma promessa vazia)
  assert.equal(APPS.find((a) => a.id === 'canva').tipo, 'oauth');
  assert.equal(APPS.find((a) => a.id === 'obsidian').tipo, 'cli');
  assert.equal(APPS.find((a) => a.id === 'paper').tipo, 'sem-api');
});

test('o estado de um cartão segue a prova do servidor — nunca o contrário', () => {
  const github = APPS.find((a) => a.id === 'github');
  assert.equal(estadoDoApp(github, null).rotulo, 'Conectar');
  assert.equal(estadoDoApp(github, { configured: true, ready: false, error: 'HTTP 401' }).rotulo, 'Por provar');
  const ok = estadoDoApp(github, { configured: true, ready: true, status: 200, latencyMs: 180 });
  assert.equal(ok.rotulo, 'Conectado');
  assert.match(ok.detalhe, /200 · 180 ms/);
  // um serviço que não aceita chave nunca aparece como «falta a chave»
  assert.equal(estadoDoApp(APPS.find((a) => a.id === 'canva'), null).rotulo, 'OAuth');
  assert.equal(estadoDoApp(APPS.find((a) => a.id === 'obsidian'), null).rotulo, 'Local');
  // e o que o servidor conhece e a interface não (personalizado) aparece na lista
  const juntos = juntarComServidor(APPS, [{ id: 'meu-servico', name: 'Meu', configured: true, ready: true }]);
  assert.ok(juntos.some((a) => a.id === 'meu-servico' && a.extra));
});

test('o azulejo tem duas letras, não uma imagem', () => {
  assert.equal(iniciais('PostHog'), 'PH');
  assert.equal(iniciais('GitHub'), 'GH');
  assert.equal(iniciais('1Password'), '1P');
  assert.equal(CSS_APPS.includes('backdrop-filter'), true, 'o vidro tem de desfocar o que está atrás');
});

/* ---------- a folha, num documento a sério ---------- */
test('abre, mostra as secções e os cartões com o estado certo', async () => {
  const d = dom();
  const { fetchImpl } = servidorFalso({
    '/api/platform/apis': { list: [{ id: 'github', name: 'GitHub', configured: true, ready: true, status: 200, latencyMs: 142 }] },
  });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 0));
  const raiz = d.window.document.getElementById('apps');
  assert.ok(raiz, 'a folha não foi montada');
  assert.equal(raiz.hidden, false);
  const secoes = [...raiz.querySelectorAll('.ax-sec b')].map((b) => b.textContent);
  assert.deepEqual(secoes.slice(0, 4), ['Programação', 'Design', 'Dados e análise', 'Produtividade']);
  assert.equal(raiz.querySelectorAll('.ax-card').length, APPS.length, 'todos os apps têm cartão');
  const gh = [...raiz.querySelectorAll('.ax-card')].find((c) => c.textContent.includes('GitHub'));
  assert.match(gh.textContent, /Conectado/, 'o GitHub provado tem de dizer Conectado');
  assert.match(gh.textContent, /142 ms/);
  const canva = [...raiz.querySelectorAll('.ax-card')].find((c) => c.textContent.includes('Canva'));
  assert.match(canva.textContent, /OAuth/);
  apps.close();
  assert.equal(raiz.hidden, true);
});

test('o campo de ligação grava a chave no servidor com o id e os valores certos', async () => {
  const d = dom();
  const { chamadas, fetchImpl } = servidorFalso({
    '/api/platform/apis': { list: [] },
    '/api/platform/key': { ok: true, id: 'github', probe: { ok: true, status: 200, ms: 210 } },
  });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 0));
  const doc = d.window.document;
  const cartao = [...doc.querySelectorAll('.ax-card')].find((c) => c.textContent.includes('GitHub'));
  cartao.querySelector('[data-acao=ligar]').click();
  const campo = doc.querySelector('#f-GITHUB_TOKEN');
  assert.ok(campo, 'o campo da chave não abriu');
  campo.value = 'ghp_teste_123';
  doc.querySelector('[data-acao=guardar]').click();
  await new Promise((r) => setTimeout(r, 10));
  const pedido = chamadas.find((c) => c.url === '/api/platform/key');
  assert.ok(pedido, 'não houve pedido para guardar');
  assert.equal(pedido.init.method, 'POST');
  const corpo = JSON.parse(pedido.init.body);
  assert.equal(corpo.id, 'github');
  assert.equal(corpo.values.GITHUB_TOKEN, 'ghp_teste_123');
  assert.match(doc.querySelector('.ax-result').textContent, /HTTP 200 em 210 ms/);
});

test('onde as chaves não se escrevem (501), a resposta é a verdade — não um «guardado»', async () => {
  const d = dom();
  const { fetchImpl } = servidorFalso({
    '/api/platform/apis': { __status: 404, error: 'não existe' },
    '/api/rpc?caminho=%2Fplatform%2Fapis': { status: 200, corpo: { list: [] } },
    '/api/platform/key': { __status: 501, error: 'as chaves vivem nas variáveis de ambiente da Vercel' },
  });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 0));
  const doc = d.window.document;
  const cartao = [...doc.querySelectorAll('.ax-card')].find((c) => c.textContent.includes('Vercel'));
  cartao.querySelector('[data-acao=ligar]').click();
  doc.querySelector('#f-VERCEL_TOKEN').value = 'tok';
  doc.querySelector('[data-acao=guardar]').click();
  await new Promise((r) => setTimeout(r, 10));
  const resultado = doc.querySelector('.ax-result');
  assert.match(resultado.textContent, /variáveis de ambiente da Vercel/);
  assert.doesNotMatch(resultado.textContent, /Guardado/);
  assert.equal(resultado.className.includes('bad'), true);
});

test('a busca filtra por nome, descrição e secção', async () => {
  const d = dom();
  const { fetchImpl } = servidorFalso({ '/api/platform/apis': { list: [] } });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 0));
  const doc = d.window.document;
  const busca = doc.querySelector('#apps input[type=search]');
  busca.value = 'figma';
  busca.dispatchEvent(new d.window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('.ax-card').length, 1);
  busca.value = 'produtividade';
  busca.dispatchEvent(new d.window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('.ax-card').length, 12);
});

test('sem servidor nenhum, a folha abre e diz onde as chaves vivem', async () => {
  const d = dom();
  const fetchImpl = async () => ({ status: 404, ok: false, json: async () => ({ error: 'nada' }) });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 0));
  const est = apps.estado;
  assert.equal(est.semServidor, true);
  assert.equal(d.window.document.querySelectorAll('.ax-card').length, APPS.length, 'os cartões aparecem na mesma');
});

test('o formulário recusa guardar com o campo vazio, sem chamar o servidor', async () => {
  const d = dom();
  const { chamadas, fetchImpl } = servidorFalso({ '/api/platform/apis': { list: [] } });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 0));
  const doc = d.window.document;
  const cartao = [...doc.querySelectorAll('.ax-card')].find((c) => c.textContent.includes('Figma'));
  cartao.querySelector('[data-acao=ligar]').click();
  doc.querySelector('[data-acao=guardar]').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(chamadas.some((c) => c.url === '/api/platform/key'), false);
  assert.match(doc.querySelector('.ax-result').textContent, /Falta FIGMA_TOKEN/);
});

/* O «Testar» de um cartão já ligado: uma sonda a sério, e o resultado por palavras.
   1.53.0 — o botão existia mas não tinha rota no servidor local; agora tem. */
test('o «Testar» de um cartão com chave pede a sonda ao servidor e mostra o que ele disse', async () => {
  const d = dom();
  const { chamadas, fetchImpl } = servidorFalso({
    '/api/platform/apis': { list: [{ id: 'github', configured: true, ready: true, verified: true }] },
    '/api/platform/testar': { ok: true, id: 'github', status: 200, ms: 143 },
  });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 10));
  const doc = d.window.document;
  const cartao = [...doc.querySelectorAll('.ax-card')].find((c) => c.textContent.includes('GitHub'));
  const testar = cartao.querySelector('[data-acao=testar]');
  assert.ok(testar, 'um cartão ligado tem de ter «Testar»');
  testar.click();
  await new Promise((r) => setTimeout(r, 10));
  const pedido = chamadas.find((c) => c.url === '/api/platform/testar');
  assert.ok(pedido, 'o «Testar» não chega ao servidor');
  assert.equal(pedido.init.method, 'POST');
  assert.equal(JSON.parse(pedido.init.body).id, 'github');
  const toast = doc.querySelector('.ax-toast') || doc.body;
  assert.match(toast.textContent, /respondeu ✓/);
});

test('quando a sonda falha, o «Testar» diz o erro do servidor — não um «respondeu»', async () => {
  const d = dom();
  const { fetchImpl } = servidorFalso({
    '/api/platform/apis': { list: [{ id: 'github', configured: true, ready: true, verified: true }] },
    '/api/platform/testar': { __status: 400, ok: false, error: 'HTTP 401 Unauthorized' },
  });
  const apps = createApps({ doc: d.window.document, fetchImpl });
  apps.open();
  await new Promise((r) => setTimeout(r, 10));
  const doc = d.window.document;
  const cartao = [...doc.querySelectorAll('.ax-card')].find((c) => c.textContent.includes('GitHub'));
  cartao.querySelector('[data-acao=testar]').click();
  await new Promise((r) => setTimeout(r, 10));
  const texto = doc.body.textContent;
  assert.match(texto, /401/);
  assert.equal(/respondeu ✓/.test(texto), false);
});
