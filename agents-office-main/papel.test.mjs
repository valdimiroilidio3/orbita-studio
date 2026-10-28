/* ===========================================================================
   1.47.0 · O ECRÃ DE PAPEL (28 out 2026)

   Pedido do dono: «Digitalizar papel podes colocar». A leitura passou a existir
   na 1.46.0; o que aqui se prova é a cara dela, sem browser e sem rede:

     · a vista diz quem lê, e diz «sem leitor» quando não há — não finge;
     · mandar a fotografia mostra a transcrição, os campos e o que faltou;
     · propor um lead não grava nada; guardar é um clique separado;
     · no modo local a mesa diz a verdade (aqui não há olhos), em vez de um 404;
     · encolher a fotografia nunca perde a imagem (sem canvas, segue o original).
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { vistaPapel, carregarPapel, digitalizarFoto, proporLead, guardarLead, limparPapel, encolherFoto } from './src/papel.js';
import { createLocalApi } from './src/localapi.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** uma API de mesa falsa: o mesmo contrato que o mesa.js dá a vista */
function apiFalsa({ respostas = {}, falhaEm = [] } = {}) {
  const chamadas = [];
  const api = {
    S: {},
    chamadas,
    pintado: 0,
    paint() { this.pintado += 1; },
    toast(msg) { this.ultimoToast = msg; },
    async call(caminho, metodo = 'GET', corpo = null) {
      chamadas.push({ caminho, metodo, corpo });
      if (falhaEm.includes(caminho)) throw new Error(`HTTP 404 em ${caminho}`);
      return respostas[caminho] ?? null;
    },
  };
  return api;
}

const ESTADO = {
  ok: true,
  ocr: { disponivel: true, via: 'visao', motivo: null },
  visao: { disponivel: true, cadeia: [{ fornec: 'ovh', modelo: 'Qwen2.5-VL-72B-Instruct' }] },
};

const LEITURA = {
  ok: true, id: 'doc_1', texto: 'Clínica do Mondego Lda\nNIF 123456789', caracteres: 36,
  campos: [
    { campo: 'nif', valor: '123456789', confianca: 0.95, controlo: 'digito-mod11' },
    { campo: 'nome', valor: 'Clínica do Mondego Lda', confianca: 0.55, heuristica: 'primeira linha' },
  ],
  faltam: ['telefone', 'email'],
  avisos: ['não encontrei telefone, email no documento — confirma à mão'],
  via: 'visao', leitor: { modelo: 'Qwen2.5-VL-72B-Instruct', fornecedor: 'ovh', ms: 413 },
};

test('papel: a vista mostra quem lê (modelo e fornecedor) e a câmara', async () => {
  const api = apiFalsa({ respostas: { '/digitalizar/estado': ESTADO } });
  await carregarPapel(api);
  const html = vistaPapel(api.S, { esc });
  assert.match(html, /Leitor pronto/);
  assert.match(html, /ovh\/Qwen2\.5-VL-72B-Instruct/);
  assert.match(html, /id="papelFoto"/);
  assert.match(html, /capture="environment"/, 'no telemóvel tem de abrir a câmara de trás');
  assert.match(html, /Abrir câmara/);
});

test('papel: sem leitor a vista diz porquê — não há botão a fingir que funciona', async () => {
  const api = apiFalsa({ respostas: { '/digitalizar/estado': { ok: true, ocr: { disponivel: false, via: null, motivo: 'não há modelo de visão com acesso' }, visao: null } } });
  await carregarPapel(api);
  const html = vistaPapel(api.S, { esc });
  assert.match(html, /Sem leitor/);
  assert.match(html, /não há modelo de visão com acesso/);
});

test('papel: enviar a fotografia mostra a transcrição, os campos e o que faltou', async () => {
  const api = apiFalsa({ respostas: { '/digitalizar/estado': ESTADO, '/digitalizar': LEITURA } });
  await carregarPapel(api);
  await digitalizarFoto(api, { base64: 'iVBORw0KGgo=', mime: 'image/jpeg' });
  const enviado = api.chamadas.find((c) => c.caminho === '/digitalizar');
  assert.equal(enviado.metodo, 'POST');
  assert.equal(enviado.corpo.imagem, 'iVBORw0KGgo=');
  const html = vistaPapel(api.S, { esc });
  assert.match(html, /Clínica do Mondego Lda/);
  assert.match(html, /123456789/);
  assert.match(html, /95%/, 'a confiança de cada campo tem de estar à vista');
  assert.match(html, /Não encontrei: <b>telefone, email<\/b>/);
  assert.match(html, /Qwen2\.5-VL-72B-Instruct/);
  assert.match(html, /Preparar lead/);
  assert.equal(api.S.papelOcupado, false);
});

test('papel: um documento ilegível devolve a razão em palavras e ninguém inventa campos', async () => {
  const api = apiFalsa({ respostas: { '/digitalizar/estado': ESTADO, '/digitalizar': { ok: false, codigo: 'vazio', erro: 'não há texto legível nesta imagem', campos: [] } } });
  await carregarPapel(api);
  await digitalizarFoto(api, { base64: 'iVBORw0KGgo=', mime: 'image/jpeg' });
  const html = vistaPapel(api.S, { esc });
  assert.match(html, /não há texto legível nesta imagem/);
  assert.equal(api.S.papelResultado.campos.length, 0);
});

test('papel: propor um lead não grava; guardar é um clique à parte, com o nome à frente', async () => {
  const proposta = { ok: true, lead: { name: 'Clínica do Mondego Lda', phone: '+351239000000', email: null, notes: 'NIF 123456789' }, pronto: true };
  const api = apiFalsa({ respostas: {
    '/digitalizar/estado': ESTADO, '/digitalizar': LEITURA, '/digitalizar/lead': proposta, '/ops/leads': { created: 1 },
  } });
  await carregarPapel(api);
  await digitalizarFoto(api, { base64: 'iVBORw0KGgo=', mime: 'image/jpeg' });
  await proporLead(api);
  assert.equal(api.chamadas.some((c) => c.caminho === '/ops/leads'), false, 'gravou no funil sem confirmação');
  const html = vistaPapel(api.S, { esc });
  assert.match(html, /Lead proposto/);
  assert.match(html, /ainda não está guardado/);
  assert.match(html, /id="papelNome"/);
  await guardarLead(api);
  const gravado = api.chamadas.find((c) => c.caminho === '/ops/leads');
  assert.ok(gravado, 'não gravou depois do clique');
  assert.equal(gravado.corpo.leads[0].name, 'Clínica do Mondego Lda');
  assert.equal(gravado.corpo.leads[0].source, 'digitalizacao');
  assert.equal(api.S.papelGuardado, 'guardado');
  limparPapel(api);
  assert.equal(api.S.papelResultado, null);
});

test('papel: no modo local a mesa diz que não há motor, em vez de estourar', async () => {
  const m = new Map();
  const api = createLocalApi({ storage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } });
  const estadoLocal = await api.call('/digitalizar/estado');
  assert.equal(estadoLocal.ok, true);
  assert.equal(estadoLocal.ocr.disponivel, false);
  assert.equal(estadoLocal.visao.disponivel, false);
  assert.match(estadoLocal.visao.motivo, /servidor/);
  await assert.rejects(() => api.call('/digitalizar', 'POST', { imagem: 'x' }), (e) => e.status === 503);
});

test('papel: encolher a fotografia nunca perde a imagem (sem canvas, segue o original)', async () => {
  const r = await encolherFoto('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  assert.equal(r.base64, 'iVBORw0KGgoAAAANSUhEUg==');
  assert.equal(r.encolhida, false);
  assert.equal(r.mime, 'image/png');
});

/* ---------- 1.47.0 · a câmara ao vivo (e o que acontece quando não há) ---------- */

test('câmara: sem acesso, a vista diz que voltou ao ficheiro — não fica morta', async () => {
  const api = apiFalsa({ respostas: { '/digitalizar/estado': ESTADO } });
  await carregarPapel(api);
  const antes = globalThis.navigator;
  try {
    /* um browser sem getUserMedia (http simples, browser antigo) */
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    const { abrirCamera } = await import('./src/papel.js');
    const ok = await abrirCamera(api);
    assert.equal(ok, false);
    assert.equal(api.S.papelCamera, false);
    assert.match(api.S.papelFalha, /Escolher ficheiro/, 'tem de dizer qual é o plano B');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: antes, configurable: true, writable: true });
  }
});

test('câmara: com permissão dada, o fluxo entra no <video> e o disparo volta a fechá-la', async () => {
  const api = apiFalsa({ respostas: { '/digitalizar/estado': ESTADO, '/digitalizar': LEITURA } });
  await carregarPapel(api);
  const paradas = [];
  const fluxoFalso = { getTracks: () => [{ stop: () => paradas.push('stop') }] };
  const antes = globalThis.navigator;
  const docAntes = globalThis.document;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia: async () => fluxoFalso } }, configurable: true, writable: true,
    });
    /* um documento mínimo: um <video> e um canvas que devolve um JPEG falso */
    const video = { id: 'papelVideo', srcObject: null, videoWidth: 2000, videoHeight: 1000, play: async () => {} };
    Object.defineProperty(globalThis, 'document', {
      value: {
        getElementById: (id) => (id === 'papelVideo' ? video : null),
        createElement: () => ({
          width: 0, height: 0,
          getContext: () => ({ drawImage() {} }),
          toDataURL: () => 'data:image/jpeg;base64,Zm90bw==',
        }),
      }, configurable: true, writable: true,
    });
    const { abrirCamera, dispararFoto, cameraLigada } = await import('./src/papel.js');
    const ok = await abrirCamera(api);
    assert.equal(ok, true);
    assert.equal(api.S.papelCamera, true);
    assert.equal(video.srcObject, fluxoFalso, 'o fluxo não chegou ao <video>');
    assert.equal(cameraLigada(), true);
    await dispararFoto(api);
    assert.equal(cameraLigada(), false, 'a câmara ficou acesa depois do disparo');
    assert.deepEqual(paradas, ['stop']);
    const enviado = api.chamadas.find((c) => c.caminho === '/digitalizar');
    assert.equal(enviado.corpo.imagem, 'Zm90bw==');
    assert.equal(enviado.corpo.mime, 'image/jpeg');
    assert.equal(api.S.papelResultado.texto.includes('Clínica do Mondego'), true);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: antes, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'document', { value: docAntes, configurable: true, writable: true });
  }
});

test('câmara: o site publicado não pode proibir a câmara a si próprio', async () => {
  const fs = await import('node:fs');
  const v = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  const politica = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Permissions-Policy');
  assert.ok(politica, 'falta a Permissions-Policy no vercel.json');
  assert.match(politica.value, /camera=\(self\)/, 'com «camera=()» a câmara ao vivo fica bloqueada no site');
  assert.doesNotMatch(politica.value, /camera=\(\)/);
});
