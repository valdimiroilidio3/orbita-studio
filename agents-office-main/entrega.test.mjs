// 1.80.0 · A ABA DE ENTREGA — provas sem rede e sem browser a sério.
//
// O que fica provado aqui:
//   · o site corre dentro do sistema: o CSS entra inline no `srcdoc` e o iframe
//     nasce em `sandbox=""` (sem scripts, sem mesma-origem);
//   · o .zip que se descarrega são os bytes que o servidor mandou (base64 →
//     Blob), com o nome certo e o sha256 à vista;
//   · sem servidor, a aba abre e diz porquê — não fica uma folha em branco;
//   · aprovar manda `aprovado: true` e `por` (o servidor recusa sem isso).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createEntrega, paginaParaVer, nomeDoPacote, estadoDoArtefacto, base64ParaBytes } from './src/entrega.js';

const HTML = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8">
<link rel="stylesheet" href="estilo.css"></head><body><h1>Salão Bela Vista</h1></body></html>`;
const CSS = '.h1{color:red}';

function dom() {
  const d = new JSDOM('<!doctype html><body></body>', { url: 'https://escritorio.teste/' });
  return d;
}

/** Um servidor de mentira: responde ao contrato do `/api/rpc`. */
function servidorFalso({ artefactos = [], erro = null, zip = null } = {}) {
  const chamadas = [];
  const fetchImpl = async (url, opts = {}) => {
    const corpo = opts.body ? JSON.parse(opts.body) : null;
    const caminho = corpo?.caminho || '';
    chamadas.push({ caminho, metodo: corpo?.metodo || 'GET' });
    if (erro) return { ok: false, status: 503, json: async () => ({ error: erro }) };
    if (caminho === '/artefactos') return { ok: true, status: 200, json: async () => ({ status: 200, corpo: { ok: true, total: artefactos.length, artefactos } }) };
    if (/\/preview$/.test(caminho)) {
      return {
        ok: true, status: 200,
        json: async () => ({ status: 200, corpo: { ok: true, id: 'site-1', estado: 'rascunho', 'index.html': HTML, 'estilo.css': CSS, 'LEIA-ME.md': 'olá' } }),
      };
    }
    if (/\/zip$/.test(caminho)) {
      return { ok: true, status: 200, json: async () => ({ status: 200, corpo: zip }) };
    }
    if (/\/publicar$/.test(caminho)) {
      return {
        ok: true, status: 200,
        json: async () => ({ status: 200, corpo: { ok: true, artefacto: { ...artefactos[0], estado: 'aprovado', aprovadoPor: 'dono' } } }),
      };
    }
    if (caminho === '/artefactos/site') {
      return {
        ok: true, status: 201,
        json: async () => ({ status: 201, corpo: { ok: true, guardado: 'base', artefacto: { id: 'novo-1', nome: corpo.corpo.nome, estado: 'rascunho', ficheiros: ['index.html'] } } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ status: 404, corpo: { erro: 'rota desconhecida' } }) };
  };
  return { fetchImpl, chamadas };
}

const ESPERA = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('1.80.0 · o CSS entra inline: o site corre no iframe sem pedir nada à rede', () => {
  const pagina = paginaParaVer({ 'index.html': HTML, 'estilo.css': CSS });
  assert.match(pagina, /<style>/);
  assert.match(pagina, /\.h1\{color:red\}/);
  assert.equal(/<link[^>]*estilo\.css/.test(pagina), false, 'o <link> para o CSS local não pode ficar: no srcdoc não há pasta');
  assert.match(pagina, /Salão Bela Vista/);
  assert.equal(paginaParaVer({}), '', 'sem index.html não há página nenhuma para ver');
});

test('1.80.0 · o nome do pacote é seguro: sem acentos, sem barras, .zip sempre', () => {
  assert.equal(nomeDoPacote('Salão Bela-Vista'), 'Salao-Bela-Vista.zip');
  assert.equal(nomeDoPacote('../../etc/passwd'), 'etc-passwd.zip');
  assert.equal(nomeDoPacote(''), 'site.zip');
});

test('1.80.0 · o estado diz o que é — e quem aprovou não fica por dizer', () => {
  const r = estadoDoArtefacto({ estado: 'rascunho' });
  assert.equal(r.rotulo, 'rascunho');
  assert.match(r.porque, /ninguém aprovou/);
  const a = estadoDoArtefacto({ estado: 'aprovado', aprovadoPor: 'dono', publicadoEm: '2026-11-09T10:00:00Z' });
  assert.equal(a.chave, 'aprovado');
  assert.match(a.porque, /aprovado por dono/);
  assert.match(a.porque, /2026-11-09/);
});

test('1.80.0 · base64 → bytes: o que se descarrega é o que o servidor mandou', () => {
  const b = base64ParaBytes('UEsDBAo=');
  assert.deepEqual([...b], [0x50, 0x4b, 0x03, 0x04, 0x0a]);
  assert.equal(base64ParaBytes('').length, 0);
  assert.equal(base64ParaBytes(null).length, 0);
});

test('1.80.0 · abrir a aba mostra o site num iframe isolado, com o nome da sala', async () => {
  const d = dom();
  const artefactos = [{ id: 'site-1', nome: 'Salão Bela Vista', estado: 'rascunho', ficheiros: ['index.html', 'estilo.css'], criadoEm: '2026-11-09T10:00:00Z' }];
  const { fetchImpl } = servidorFalso({ artefactos });
  const e = createEntrega({ doc: d.window.document, fetchImpl });
  e.abrir();
  await ESPERA();

  const raiz = d.window.document.getElementById('entrega');
  assert.ok(raiz && raiz.hidden === false, 'a aba tem de abrir');
  const iframe = raiz.querySelector('iframe');
  assert.ok(iframe, 'tem de haver um iframe com o site');
  assert.equal(iframe.getAttribute('sandbox'), '', 'sandbox="" é a regra: sem scripts e sem mesma-origem');
  assert.equal(iframe.getAttribute('referrerpolicy'), 'no-referrer');
  assert.match(iframe.getAttribute('srcdoc'), /<style>/);
  assert.match(iframe.getAttribute('srcdoc'), /Salão Bela Vista/);
  assert.match(raiz.textContent, /descarregar \.zip/i);
  e.fechar();
  assert.equal(raiz.hidden, true);
});

test('1.80.0 · descarregar o .zip usa os bytes do servidor e o nome certo', async () => {
  const d = dom();
  const artefactos = [{ id: 'site-1', nome: 'Salão', estado: 'rascunho', ficheiros: ['index.html'] }];
  const zip = { ok: true, nome: 'site-1.zip', bytes: 4, sha256: 'abcdef0123456789', ficheiros: [{ nome: 'index.html', bytes: 4 }], base64: 'UEsDBAo=' };
  const { fetchImpl, chamadas } = servidorFalso({ artefactos, zip });
  const criados = [];
  const urlApi = { createObjectURL: (blob) => { criados.push(blob); return 'blob:teste'; }, revokeObjectURL: () => {} };
  const cliques = [];
  const originalCreate = d.window.document.createElement.bind(d.window.document);
  d.window.document.createElement = (tag) => {
    const el = originalCreate(tag);
    if (tag === 'a') { el.click = () => cliques.push(el.getAttribute('download')); }
    return el;
  };

  const e = createEntrega({ doc: d.window.document, fetchImpl, urlApi });
  e.abrir();
  await ESPERA();
  d.window.document.querySelector('#entrega [data-acao="zip"]').click();
  await ESPERA(60);

  assert.ok(chamadas.some((c) => c.caminho === '/artefactos/site-1/zip'), 'tem de pedir o pacote ao servidor');
  assert.equal(criados.length, 1, 'um Blob com os bytes do servidor');
  assert.equal(criados[0].size, 5, 'os bytes são os que vieram (base64 de 5 bytes)');
  assert.equal(cliques[0], 'site-1.zip');
  assert.match(d.window.document.querySelector('#entrega .eg-nota').textContent, /sha256 abcdef012345/);
});

test('1.80.0 · aprovar é assinado: o pedido leva aprovado:true e por:dono', async () => {
  const d = dom();
  const artefactos = [{ id: 'site-1', nome: 'Salão', estado: 'rascunho', ficheiros: ['index.html'] }];
  const { fetchImpl } = servidorFalso({ artefactos });
  const pedidos = [];
  const fetchEspiao = async (url, opts) => { if (opts?.body) pedidos.push(JSON.parse(opts.body)); return fetchImpl(url, opts); };
  const e = createEntrega({ doc: d.window.document, fetchImpl: fetchEspiao });
  e.abrir();
  await ESPERA();
  d.window.document.querySelector('#entrega [data-acao="aprovar"]').click();
  await ESPERA(60);
  const aprovacao = pedidos.find((p) => /\/publicar$/.test(p.caminho));
  assert.ok(aprovacao, 'tem de chamar /artefactos/:id/publicar');
  assert.equal(aprovacao.corpo.aprovado, true);
  assert.equal(aprovacao.corpo.por, 'dono');
  assert.match(d.window.document.querySelector('#entrega').textContent, /aprovado/i);
});

test('1.80.0 · sem servidor a aba abre na mesma e diz o que falhou', async () => {
  const d = dom();
  const { fetchImpl } = servidorFalso({ erro: 'esta instalação não tem base de dados ligada' });
  const e = createEntrega({ doc: d.window.document, fetchImpl });
  e.abrir();
  await ESPERA();
  const texto = d.window.document.getElementById('entrega').textContent;
  assert.match(texto, /Sem ligação ao servidor/);
  assert.match(texto, /base de dados/);
});

test('1.80.0 · criar um site pela aba: pede o brief, escolhe o novo e mostra-o', async () => {
  const d = dom();
  const { fetchImpl, chamadas } = servidorFalso({ artefactos: [] });
  const e = createEntrega({ doc: d.window.document, fetchImpl });
  e.abrir();
  await ESPERA();
  assert.match(d.window.document.getElementById('entrega').textContent, /Ainda não há nada para ver/);

  d.window.document.querySelector('#entrega [data-acao="novo"]').click();
  const form = d.window.document.querySelector('#entrega .eg-form');
  assert.ok(form, 'o formulário do site tem de aparecer');
  form.querySelector('[name="nome"]').value = 'Óptica Central';
  form.querySelector('[name="cidade"]').value = 'Porto';
  form.dispatchEvent(new d.window.Event('submit', { bubbles: true, cancelable: true }));
  await ESPERA(60);

  const criacao = chamadas.find((c) => c.caminho === '/artefactos/site');
  assert.ok(criacao, 'tem de criar o site no servidor');
  assert.match(d.window.document.getElementById('entrega').textContent, /site criado/);
});
