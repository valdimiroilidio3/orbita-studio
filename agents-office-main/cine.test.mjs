/* ===========================================================================
   1.48.0 · O CINE (28 out 2026)

   Pedido do dono: cada lead abre um Master Prompt próprio e dele nascem peças
   visuais — com um ecrã de nível superior e sem nada simulado.

   O que estes testes provam, e por esta ordem:
     · o plano é DESTA lead: dois negócios diferentes não podem dar o mesmo
       conceito, e a leitura diz o que falta em vez de inventar;
     · a IA escreve o plano quando responde, e quando não responde fica a versão
       por regras COM o motivo — nunca texto de regras apresentado como IA;
     · a geração é um pedido HTTP verdadeiro: bytes conferidos, `content-type`
       conferido, e um HTML de erro não passa por imagem;
     · o vídeo não se finge: devolve a razão e os modelos pagos que existem;
     · o arquivo guarda prompt, versões, imagens e aprovação, e não guarda bytes
       de tudo (só das mais recentes e da aprovada);
     · a vista do ecrã não pode mostrar uma imagem de exemplo enquanto gera.
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analisarLead, construirMasterPrompt, briefNormalizada, masterPromptComIA, juntarPlano,
  masterEmTexto, lerJSON, gerarImagem, estadoDoVideo, gerarVideo, urlDeImagem,
  prepararCine, gerarCine, aprovarImagem, apagarImagem, lerArquivo, listarProjectos,
  travessaoGeracao, limparTravessao, estadoCine, FORMATOS, ESTILOS, MODELOS_IMAGEM,
} from './api/_cine.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { vistaCine, carregarCine, prepararCine as prepararUI, gerarCineUI, accaoCine } from './src/cine.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CLINICA = {
  id: 'l1', name: 'Clínica do Mondego', category: 'Clínica dentária', city: 'Coimbra',
  website: 'clinicadomondego.pt', phone: '+351239000000', rating: 4.8, reviews: 64,
  status: 'novo', source: 'geoapify',
};
const OFICINA = { id: 'l2', name: 'Oficina Alves', category: 'Oficina automóvel', city: 'Leiria' };

/** Uma resposta de imagem verdadeira: cabeçalhos como os do `fetch`. */
const respostaImagem = (bytes = 4000, tipo = 'image/jpeg') => ({
  ok: true, status: 200,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? tipo : null) },
  arrayBuffer: async () => new Uint8Array(bytes).fill(7).buffer,
  text: async () => '',
});

const respostaHTML = () => ({
  ok: true, status: 200,
  headers: { get: () => 'text/html; charset=utf-8' },
  arrayBuffer: async () => new Uint8Array(4000).buffer,
  text: async () => '<html>not found</html>',
});

/* ------------------------------ o plano ------------------------------- */

test('cine: o plano é desta lead — dois negócios não dão o mesmo conceito', () => {
  const a = construirMasterPrompt(CLINICA, { objetivo: 'encher a agenda de Setembro' });
  const b = construirMasterPrompt(OFICINA, {});
  assert.equal(a.via, 'regra');
  assert.match(a.seccoes.conceito, /Clínica do Mondego/);
  assert.match(a.seccoes.conceito, /Coimbra/);
  assert.match(b.seccoes.conceito, /Oficina Alves/);
  assert.notEqual(a.prompts.imagem, b.prompts.imagem, 'o prompt de imagem não pode ser o mesmo para dois negócios');
  assert.match(a.prompts.imagem, /clínica|instrumentos|luvas/i);
  assert.match(b.prompts.imagem, /oficina|capô|ferramenta/i);
});

test('cine: a leitura diz o que falta e proíbe inventar o que não se sabe', () => {
  const a = analisarLead(OFICINA);
  assert.equal(a.setor, 'automovel');
  assert.ok(a.faltam.includes('avaliação'), 'sem nota pública tem de constar em falta');
  assert.ok(a.proibido.some((p) => /avalia/i.test(p)), 'o plano tem de proibir citações inventadas');
  const comNota = analisarLead(CLINICA);
  assert.equal(comNota.sinais.qualidade, 'excelente');
  assert.equal(comNota.proibido.some((p) => /avalia/i.test(p)), false, 'com nota real já pode haver orgulho');
});

test('cine: o formato e o estilo escolhidos entram no plano e no prompt', () => {
  const b = briefNormalizada({ formato: '9:16', estilo: 'noir' });
  assert.equal(b.formato, '9:16');
  assert.equal(b.largura, 768);
  const mp = construirMasterPrompt(CLINICA, { formato: '9:16', estilo: 'noir' });
  assert.equal(mp.estilo, 'noir');
  assert.match(mp.prompts.imagem, /9:16/);
  assert.match(mp.seccoes.fotografia.luz, /fonte dura/i);
});

test('cine: a IA escreve o plano e o modelo fica registado (não é texto de regras com etiqueta de IA)', async () => {
  const motor = { pedir: async () => ({
    texto: JSON.stringify({
      conceito: 'Um consultório que se abre como uma casa: luz, calma e precisão.',
      direcaoArte: 'Branco quente, madeira clara, instrumentos alinhados como ourivesaria.',
      narrativa: 'Começa no reflexo do espelho, abre nas mãos e fecha no sorriso de quem sai.',
      emocao: 'alívio', promptImagem: 'editorial photograph, warm white clinic, morning window light, 50mm',
      promptVideo: 'slow dolly-in, warm window light, shallow depth of field',
      restricoes: ['sem texto na imagem'],
    }),
    modelo: 'openai/gpt-5.5', fornec: 'pollinations', ms: 900,
  }) };
  const r = await masterPromptComIA({ lead: CLINICA, brief: {}, motor });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'ia');
  assert.equal(r.modelo, 'openai/gpt-5.5');
  const junto = juntarPlano(construirMasterPrompt(CLINICA, {}), r);
  assert.equal(junto.via, 'ia');
  assert.match(junto.seccoes.conceito, /consultório que se abre/);
  assert.match(junto.prompts.imagem, /editorial photograph/, 'o prompt da IA tem de ser usado');
  assert.match(junto.prompts.imagem, /Sem texto na imagem/, 'as regras garantem as restrições');
});

test('cine: quando a IA falha, o plano é o das regras e o motivo vai escrito', async () => {
  const motor = { pedir: async () => { const e = new Error('todos os modelos falharam'); e.codigo = 'limite'; throw e; } };
  const r = await masterPromptComIA({ lead: CLINICA, brief: {}, motor });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'limite-fornecedor');
  assert.match(r.motivo, /todos os modelos falharam/);
  const junto = juntarPlano(construirMasterPrompt(CLINICA, {}), r);
  assert.equal(junto.via, 'regra', 'não se apresenta texto de regras como se fosse da IA');
  assert.ok(junto.prompts.imagem.length > 60);
});

test('cine: uma resposta com JSON incompleto é recusada (não se aproveita meia resposta)', async () => {
  const motor = { pedir: async () => ({ texto: '{"conceito":"só isto"}', modelo: 'x', fornec: 'y' }) };
  const r = await masterPromptComIA({ lead: CLINICA, brief: {}, motor });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'resposta-incompleta');
  assert.match(r.motivo, /direcaoArte/);
});

test('cine: lerJSON apanha o objecto mesmo com cercas e conversa à volta', () => {
  assert.deepEqual(lerJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(lerJSON('Claro! {"a":{"b":2}} espero que sirva'), { a: { b: 2 } });
  assert.equal(lerJSON('sem json nenhum'), null);
});

test('cine: o master em texto leva as secções todas (para se poder copiar)', () => {
  const mp = construirMasterPrompt(CLINICA, {});
  const t = masterEmTexto({ ...mp, leadNome: 'Clínica do Mondego' });
  for (const chave of ['Conceito:', 'Direcção de arte:', 'Fotografia:', 'Narrativa:', 'Restrições:', 'Prompt de imagem:']) {
    assert.ok(t.includes(chave), `falta «${chave}» no texto`);
  }
});

/* ---------------------------- a geração ------------------------------- */

test('cine: gerar confere o tipo e o tamanho dos bytes (um HTML de erro não é imagem)', async () => {
  const bom = await gerarImagem({ prompt: 'fotografia editorial de uma clínica dentária ao amanhecer', env: {}, fetchImpl: async () => respostaImagem() });
  assert.equal(bom.ok, true);
  assert.match(bom.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(bom.bytes, 4000);
  assert.equal(bom.modelo, 'flux', 'sem chave, o tier anónimo só conhece o flux — e é o que se diz');

  const mau = await gerarImagem({ prompt: 'fotografia editorial de uma clínica dentária ao amanhecer', env: {}, fetchImpl: async () => respostaHTML() });
  assert.equal(mau.ok, false);
  assert.match(mau.erro, /text\/html/);
  assert.ok(mau.tentativas.length >= 1);
});

test('cine: com chave a rota é a da conta; sem chave cai no tier anónimo — e diz qual foi', async () => {
  const vistos = [];
  const fetchImpl = async (url) => { vistos.push(url); return respostaImagem(); };
  const comChave = await gerarImagem({ prompt: 'retrato de um dentista a preparar instrumentos', env: { POLLINATIONS_API_KEY: 'k123' }, fetchImpl });
  assert.equal(comChave.via, 'chave');
  assert.equal(comChave.modelo, MODELOS_IMAGEM[0].id, 'com a chave usa-se o modelo que o dono escolheu');
  assert.match(vistos[0], /gen\.pollinations\.ai\/image\//);
  vistos.length = 0;
  const anon = await gerarImagem({ prompt: 'retrato de um dentista a preparar instrumentos', env: {}, fetchImpl });
  assert.equal(anon.via, 'anonimo');
  assert.match(vistos[0], /image\.pollinations\.ai\/prompt\//);
  assert.equal(vistos.some((u) => u.includes('k123')), false, 'a chave não pode ir no URL');
});

test('cine: a mesma semente dá o mesmo pedido (regenerar é reprodutível)', () => {
  const a = urlDeImagem({ prompt: 'x', seed: 42 });
  const b = urlDeImagem({ prompt: 'x', seed: 42 });
  assert.equal(a.url, b.url);
  assert.match(a.url, /seed=42/);
  assert.notEqual(urlDeImagem({ prompt: 'x', seed: 43 }).url, a.url);
});

test('cine: uma falha do fornecedor chega com o código HTTP dele', async () => {
  const r = await gerarImagem({
    prompt: 'fotografia de uma oficina ao fim do dia, luz quente',
    env: {}, fetchImpl: async () => ({ ok: false, status: 402, headers: { get: () => null }, text: async () => '{"error":"insufficient pollen"}' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'semcreditos');
  assert.match(r.erro, /402/);
});

test('cine: vídeo não se finge — devolve a razão e os modelos pagos que existem', async () => {
  const est = await estadoDoVideo({ env: {} });
  assert.equal(est.disponivel, false);
  assert.ok(est.modelos.length >= 3);
  assert.match(est.motivo, /Pollen|worker/);
  const r = await gerarVideo({ repo: createMemRepo(), env: {}, pedido: 'plano cinematográfico de uma clínica' });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'semvideo');
});

/* ---------------------------- o arquivo ------------------------------- */

test('cine: preparar guarda o plano com versão, e gerar guarda a imagem no projecto da lead', async () => {
  const repo = createMemRepo();
  const prep = await prepararCine(repo, CLINICA, { formato: '4:5' }, { motor: null });
  assert.equal(prep.ok, true);
  assert.equal(prep.versao.via, 'regra');
  assert.equal(prep.projeto.master.formato, '4:5');

  const ger = await gerarCine(repo, 'l1', { quantidade: 2, fetchImpl: async () => respostaImagem(6000) });
  assert.equal(ger.ok, true);
  assert.equal(ger.geradas, 2);
  const arquivo = await lerArquivo(repo);
  const p = arquivo.projetos.l1;
  assert.equal(p.imagens.length, 2);
  assert.match(p.imagens[0].dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(arquivo.provas.imagem.modelo, MODELOS_IMAGEM[0].id);
  assert.ok(p.historico.some((h) => h.tipo === 'imagem'));
});

test('cine: sem Master Prompt não há geração — e o motivo é esse, não um erro genérico', async () => {
  const repo = createMemRepo();
  const ger = await gerarCine(repo, 'l9', { fetchImpl: async () => respostaImagem() });
  assert.equal(ger.ok, false);
  assert.equal(ger.codigo, 'semprojecto');
  assert.match(ger.erro, /Master Prompt/);
});

test('cine: aprovar marca UMA e o histórico registra; apagar tira-a do projecto', async () => {
  const repo = createMemRepo();
  await prepararCine(repo, CLINICA, {}, { motor: null });
  await gerarCine(repo, 'l1', {
    quantidade: 2,
    fetchImpl: (() => { let n = 0; return async () => { n += 1; return respostaImagem(3000 + n * 100); }; })(),
  });
  let arquivo = await lerArquivo(repo);
  const duas = arquivo.projetos.l1.imagens;
  assert.equal(duas.length, 2);
  const ap = await aprovarImagem(repo, 'l1', duas[1].id);
  assert.equal(ap.ok, true);
  arquivo = await lerArquivo(repo);
  assert.equal(arquivo.projetos.l1.aprovada, duas[1].id);
  assert.equal(arquivo.projetos.l1.imagens.filter((i) => i.aprovada).length, 1, 'só uma pode estar aprovada');
  const del = await apagarImagem(repo, 'l1', duas[0].id);
  assert.equal(del.ok, true);
  arquivo = await lerArquivo(repo);
  assert.equal(arquivo.projetos.l1.imagens.length, 1);
  assert.equal(arquivo.projetos.l1.aprovada, duas[1].id, 'apagar outra imagem não desaprova a aprovada');
});

test('cine: os bytes guardados ficam nas recentes e na aprovada (o resto guarda a semente)', async () => {
  const repo = createMemRepo();
  await prepararCine(repo, CLINICA, {}, { motor: null });
  await gerarCine(repo, 'l1', { quantidade: 4, fetchImpl: async () => respostaImagem(9000) });
  const arquivo = await lerArquivo(repo);
  const imgs = arquivo.projetos.l1.imagens;
  assert.equal(imgs.length, 4);
  assert.equal(imgs.filter((i) => i.dataUrl).length <= 2, true, 'quatro imagens em base64 estouram a linha jsonb');
  assert.equal(imgs.every((i) => Number.isFinite(i.seed)), true, 'sem bytes, a semente tem de existir para se regenerar');
});

test('cine: o travessão de geração trava e diz quanto falta esperar', () => {
  limparTravessao();
  for (let i = 0; i < 12; i += 1) assert.equal(travessaoGeracao({ quantas: 1 }).ok, true);
  const travado = travessaoGeracao({ quantas: 1 });
  assert.equal(travado.ok, false);
  assert.match(travado.erro, /12 imagens/);
  limparTravessao();
});

test('cine: a lista de projectos traz o nome da lead, a via do plano e a peça aprovada', async () => {
  const repo = createMemRepo();
  await prepararCine(repo, CLINICA, {}, { motor: null });
  await gerarCine(repo, 'l1', { quantidade: 1, fetchImpl: async () => respostaImagem() });
  let arquivo = await lerArquivo(repo);
  await aprovarImagem(repo, 'l1', arquivo.projetos.l1.imagens[0].id);
  const lista = await listarProjectos(repo);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].lead.name, 'Clínica do Mondego');
  assert.equal(lista[0].via, 'regra');
  assert.equal(lista[0].imagens, 1);
  assert.ok(lista[0].aprovada?.dataUrl, 'a lista precisa de miniatura da aprovada');
});

/* ------------------------------ as rotas ------------------------------ */

test('rotas /cine: estado diz o que há, e sem lead a resposta diz o que falta pedir', async () => {
  const repo = createMemRepo({ leads: [{ ...CLINICA, dedupe_key: 'x', created_at: new Date().toISOString() }] });
  const est = await responder(repo, { caminho: '/cine/estado', metodo: 'GET', env: {} });
  assert.equal(est.status, 200);
  assert.equal(est.corpo.imagem.modelos.length, MODELOS_IMAGEM.length);
  assert.equal(est.corpo.imagem.provado, null, 'sem prova não se diz que funciona');
  assert.equal(est.corpo.video.disponivel, false);

  const semLead = await responder(repo, { caminho: '/cine/preparar', metodo: 'POST', corpo: {}, env: {} });
  assert.equal(semLead.status, 404);
  assert.match(semLead.corpo.erro, /leadId/);
});

test('rotas /cine: preparar, gerar, aprovar e ler o projecto — de ponta a ponta', async () => {
  const repo = createMemRepo({ leads: [{ ...CLINICA, dedupe_key: 'x', created_at: new Date().toISOString() }] });
  const prep = await responder(repo, {
    caminho: '/cine/preparar', metodo: 'POST', env: {},
    corpo: { lead: CLINICA, brief: { formato: '16:9', objetivo: 'encher a agenda' } },
  });
  assert.equal(prep.status, 200);
  assert.equal(prep.corpo.versao.via, 'regra');

  const ger = await responder(repo, {
    caminho: '/cine/gerar', metodo: 'POST', env: {},
    corpo: { leadId: 'l1', quantidade: 1 },
    fetchImpl: async () => respostaImagem(),
  });
  assert.equal(ger.status, 200);
  assert.equal(ger.corpo.geradas, 1);

  const proj = await responder(repo, { caminho: '/cine/projeto?leadId=l1', metodo: 'GET', env: {} });
  assert.equal(proj.status, 200);
  assert.equal(proj.corpo.projeto.imagens.length, 1);
  const id = proj.corpo.projeto.imagens[0].id;

  const ap = await responder(repo, { caminho: '/cine/aprovar', metodo: 'POST', env: {}, corpo: { leadId: 'l1', imagemId: id } });
  assert.equal(ap.status, 200);
  assert.equal(ap.corpo.projeto.aprovada, id);

  const semMaster = await responder(repo, { caminho: '/cine/gerar', metodo: 'POST', env: {}, corpo: { lead: OFICINA, quantidade: 1 }, fetchImpl: async () => respostaImagem() });
  assert.equal(semMaster.status, 409, 'gerar sem projecto tem de ser 409, não 200 com nada');
});

/* ------------------------------- a vista ------------------------------ */

function apiFalsa(respostas = {}) {
  const chamadas = [];
  return {
    S: {}, chamadas, pintado: 0,
    paint() { this.pintado += 1; },
    toast(m) { this.ultimoToast = m; },
    async call(caminho, metodo = 'GET', corpo = null) {
      chamadas.push({ caminho, metodo, corpo });
      const r = respostas[caminho];
      if (typeof r === 'function') return r(corpo);
      if (r === undefined) throw new Error(`HTTP 404 em ${caminho}`);
      return r;
    },
  };
}

const ESTADO_OK = {
  ok: true,
  imagem: { via: 'pollinations', comChave: true, provado: null, modelos: MODELOS_IMAGEM, motivoSemChave: null },
  video: { disponivel: false, motivo: 'vídeo precisa de créditos Pollen ou do worker', modelos: [{ rotulo: 'Kling 3.0', nota: '720p' }], worker: { vivo: false } },
  formatos: FORMATOS, estilos: ESTILOS, arquivo: { projetos: 0, imagens: 0, aprovadas: 0, comMaster: 0 },
};

test('vista do cine: sem plano mostra a porta — e não mostra imagem nenhuma', async () => {
  const api = apiFalsa({
    '/cine/estado': ESTADO_OK,
    '/cine/projeto?leadId=l1': () => { throw new Error('HTTP 404: esta lead ainda não tem trabalho de Cine'); },
    '/cine/abrir': { ok: true, chave: 'l1', criado: true, projeto: { lead: CLINICA, imagens: [], historico: [] }, analise: analisarLead({ ...CLINICA, rating: null, reviews: null, website: null }), estilos: ESTILOS, formatos: FORMATOS, modelos: MODELOS_IMAGEM },
  });
  await carregarCine(api, 'l1');
  const html = vistaCine(api.S, { esc, leadId: 'l1' });
  assert.match(html, /Clínica do Mondego/);
  assert.match(html, /Escrever o Master Prompt/);
  assert.doesNotMatch(html, /<img /, 'não pode haver imagem antes de gerar');
  assert.match(html, /O que o sistema leu/);
  assert.match(html, /falta: /i);
});

test('vista do cine: com plano mostra as secções, os estilos e o vídeo por fazer', async () => {
  const repo = createMemRepo();
  const prep = await prepararCine(repo, CLINICA, { formato: '1:1', estilo: 'estudio' }, { motor: null });
  const api = apiFalsa({
    '/cine/estado': ESTADO_OK,
    '/cine/projeto?leadId=l1': { ok: true, projeto: prep.projeto },
  });
  await carregarCine(api, 'l1');
  const html = vistaCine(api.S, { esc, leadId: 'l1' });
  assert.match(html, /Master Prompt/);
  assert.match(html, /Conceito/);
  assert.match(html, /Direcção de arte/);
  assert.match(html, /Restrições/);
  assert.match(html, /data-act="cine-gerar"/);
  assert.match(html, /data-act="cine-estilo"/);
  assert.match(html, /Vídeo cinematográfico/);
  assert.match(html, /ainda não há como/);
  assert.match(html, /data-act="cine-video"[^>]*disabled/, 'o botão do vídeo não pode estar activo sem caminho real');
});

test('vista do cine: a preparar, o que se mostra é um esqueleto — nunca uma imagem de exemplo', async () => {
  const api = apiFalsa({
    '/cine/estado': ESTADO_OK,
    '/cine/projeto?leadId=l1': () => { throw new Error('HTTP 404'); },
    '/cine/abrir': { ok: true, chave: 'l1', projeto: { lead: CLINICA, imagens: [], historico: [] }, analise: analisarLead(CLINICA) },
    '/cine/preparar': (() => {
      const repo = createMemRepo();
      return async () => ({ ok: true, ...(await prepararCine(repo, CLINICA, {}, { motor: null })) });
    })(),
  });
  await carregarCine(api, 'l1');
  api.S.cine.aPreparar = true;
  const html = vistaCine(api.S, { esc, leadId: 'l1' });
  assert.match(html, /cine-skeleton/);
  assert.doesNotMatch(html, /<img /);
});

test('vista do cine: a falha da geração aparece em palavras, com o código do fornecedor', async () => {
  const repo = createMemRepo();
  await prepararCine(repo, CLINICA, {}, { motor: null });
  const api = apiFalsa({
    '/cine/estado': ESTADO_OK,
    '/cine/projeto?leadId=l1': async () => ({ ok: true, projeto: (await lerArquivo(repo)).projetos.l1 }),
    '/cine/gerar': { ok: false, codigo: 'semcreditos', erro: 'a imagem não veio: HTTP 402: insufficient pollen', tentativas: [{ via: 'chave', erro: 'HTTP 402: insufficient pollen' }] },
  });
  await carregarCine(api, 'l1');
  await gerarCineUI(api);
  const html = vistaCine(api.S, { esc, leadId: 'l1' });
  assert.match(html, /402/);
  assert.match(html, /insufficient pollen/);
  assert.equal(api.S.cine.aGerar, false, 'o estado de carregamento tem de fechar mesmo quando falha');
});

test('vista do cine: aprovar pede o servidor e só depois é que a peça fica aprovada', async () => {
  const repo = createMemRepo();
  await prepararCine(repo, CLINICA, {}, { motor: null });
  await gerarCine(repo, 'l1', { quantidade: 1, fetchImpl: async () => respostaImagem() });
  const projeto = (await lerArquivo(repo)).projetos.l1;
  const id = projeto.imagens[0].id;
  const api = apiFalsa({
    '/cine/estado': ESTADO_OK,
    '/cine/projeto?leadId=l1': { ok: true, projeto },
    '/cine/aprovar': { ok: true, projeto: { ...projeto, aprovada: id, imagens: projeto.imagens.map((i) => ({ ...i, aprovada: i.id === id })) } },
  });
  await carregarCine(api, 'l1');
  const clicou = await accaoCine('cine-aprovar', { dataset: { id } }, api);
  assert.equal(clicou, true);
  assert.equal(api.chamadas.some((c) => c.caminho === '/cine/aprovar'), true);
  const html = vistaCine(api.S, { esc, leadId: 'l1' });
  assert.match(html, /aprovada<\/span>/);
});

test('vista do cine: no modo local o ecrã diz que precisa do servidor', async () => {
  const { createLocalApi } = await import('./src/localapi.js');
  const guardado = new Map();
  const local = createLocalApi({ storage: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v) } });
  const api = {
    S: {}, pintado: 0, paint() { this.pintado += 1; }, toast() {},
    call: (caminho, metodo = 'GET', corpo = null) => local.call(caminho, metodo, corpo),
  };
  await carregarCine(api, null);
  const html = vistaCine(api.S, { esc });
  assert.match(html, /Ainda sem projectos/);
});
