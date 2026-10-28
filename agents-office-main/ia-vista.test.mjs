// Testes da vista da IA na mesa (1.34.0, 27 out 2026).
//
// O defeito que o dono viu: mesa → IA → «A carregar o Control Center…» para
// sempre. A causa não era o motor — era a leitura falhar (a versão publicada
// não tinha a rota) e a vista não ter estado de erro. Aqui prova-se:
//   · uma leitura falhada deixa a razão à vista e um botão para voltar a tentar;
//   · um estado já lido não desaparece quando a leitura seguinte falha;
//   · com estado, a lista das gratuitas aparece com provados e por provar;
//   · no modo local, os quatro motores sem chave estão lá, e «Provar» não é
//     oferecido (não há servidor para fazer o pedido).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { carregarIA, vistaIA, accaoIA } from './src/ia.js';
import { createLocalApi, GRATUITOS_LOCAIS } from './src/localapi.js';
import { FORNECEDORES } from './api/_ia/catalogo.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const desenhar = (S) => vistaIA(S, { esc, hhmm: (x) => x, when: (x) => x });
const semApi = () => ({ S: {}, call: async (caminho) => { throw Object.assign(new Error(`HTTP 404 em ${caminho}`), { status: 404 }); } });

test('vista IA: uma leitura falhada diz a razão e oferece tentar outra vez', async () => {
  const api = { ...semApi(), paint() {}, toast() {} };
  await carregarIA(api);
  assert.equal(api.S.ia, null, 'sem estado lido não se inventa um');
  assert.match(api.S.iaErro, /404/);
  const html = desenhar(api.S);
  assert.match(html, /Não consegui ler o estado da IA/);
  assert.match(html, /data-act="ia-recarregar"/);
  assert.doesNotMatch(html, /A carregar o Control Center/, 'a vista não pode ficar presa a carregar');
});

test('vista IA: um estado antigo continua à vista, com o aviso em cima', async () => {
  const api = { ...semApi(), paint() {}, toast() {} };
  api.S.ia = { pronto: true, modo: 'servidor', fornecedores: [{ id: 'llm7', nome: 'LLM7', configurado: true, semChave: true, estado: 'funcional', limites: 'anónimo' }], agentes: [], ferramentas: [], indisponiveis: [] };
  await carregarIA(api);
  assert.match(api.S.iaErro, /404/);
  const html = desenhar(api.S);
  assert.match(html, /Não consegui actualizar agora/);
  assert.match(html, /LLM7/, 'o estado anterior não pode desaparecer');
  assert.doesNotMatch(html, /A carregar o Control Center/);
});

test('vista IA: com estado e gratuitas, mostra provados e por provar sem chamar funcional ao resto', async () => {
  const estado = {
    pronto: true, modo: 'servidor', fornecedores: [
      { id: 'llm7', nome: 'LLM7', configurado: true, semChave: true, estado: 'funcional', limites: 'anónimo', familia: 'nucleo' },
      { id: 'opencode', nome: 'OpenCode Zen', configurado: true, semChave: true, estado: 'por_testar', limites: 'public', familia: 'nucleo' },
    ], agentes: [], ferramentas: [], indisponiveis: [], memoria: {}, estudio: {},
  };
  const gratuitos = {
    ok: true, pronto: true, total: 1, totalPorProvar: 1, medidoEm: '2026-10-27',
    modelos: [{ fornec: 'llm7', fornecedor: 'LLM7', modelo: 'codestral-latest', medidoMs: 1500, etiquetas: ['codigo'], keyless: true }],
    porProvar: [{ fornec: 'opencode', fornecedor: 'OpenCode Zen', modelo: 'big-pickle', semChave: true, etiquetas: ['codigo'] }],
    estado: { frase: '1 gratuitos provados · 1 por provar' },
    cadeia: { codigo: [{ fornec: 'llm7', modelo: 'codestral-latest' }] },
  };
  const api = {
    S: {},
    call: async (caminho) => {
      if (caminho === '/ia/estado') return estado;
      if (caminho === '/ia/gratuitos') return gratuitos;
      if (caminho === '/ia/uso') return { resumo: [], errosRecentes: [] };
      if (caminho === '/ia/runs') return { runs: [] };
      if (caminho === '/media/trabalhos') return { trabalhos: [] };
      throw new Error('rota inesperada: ' + caminho);
    },
    paint() {}, toast() {},
  };
  await carregarIA(api);
  assert.equal(api.S.iaErro, null);
  const html = desenhar(api.S);
  assert.match(html, /IA gratuita/);
  assert.match(html, /codestral-latest/);
  assert.match(html, /por provar/);
  assert.match(html, /data-act="ia-provar" data-fornec="opencode" data-modelo="big-pickle"/);
  assert.match(html, /llm7\/codestral-latest/, 'a cadeia real por tipo de trabalho aparece');
});

test('vista IA: no modo local os quatro motores sem chave estão listados e provar não é oferecido', async () => {
  const memoria = new Map();
  const storage = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v), removeItem: (k) => memoria.delete(k) };
  const local = createLocalApi({ storage });
  const api = {
    S: {}, paint() {}, toast() {},
    call: (caminho, metodo, corpo) => local.call(caminho, metodo, corpo),
  };
  await carregarIA(api);
  const html = desenhar(api.S);
  for (const id of ['llm7', 'ovh', 'opencode', 'pollinations']) {
    assert.match(html, new RegExp(id, 'i'), `${id} tem de aparecer no modo local`);
  }
  assert.match(html, /precisa do servidor/);
  assert.doesNotMatch(html, /data-act="ia-provar"/, 'sem servidor não se oferece um pedido real');
  assert.doesNotMatch(html, /A carregar o Control Center/);
});

test('modo local: a lista de gratuitas não finge provas e espelha o catálogo do servidor', async () => {
  const memoria = new Map();
  const local = createLocalApi({ storage: { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v), removeItem: (k) => memoria.delete(k) } });
  const g = await local.call('/ia/gratuitos', 'GET');
  assert.equal(g.ok, true);
  assert.equal(g.modo, 'local');
  assert.equal(g.pronto, false, 'no browser não há provas registadas');
  assert.equal(g.total, 0);
  assert.equal(g.modelos.length, 0);
  assert.equal(g.totalPorProvar, GRATUITOS_LOCAIS.length);
  assert.ok(g.porProvar.every((p) => p.semChave === true));
  /* o espelho não pode divergir do catálogo em silêncio */
  for (const g2 of GRATUITOS_LOCAIS) {
    assert.ok(FORNECEDORES[g2.fornec], `${g2.fornec} não existe no catálogo do servidor`);
    assert.ok(FORNECEDORES[g2.fornec].keyless || FORNECEDORES[g2.fornec].chavePublica, `${g2.fornec} deixou de ser sem chave`);
  }
});

test('acção ia-recarregar: volta a pedir o estado e diz o que aconteceu', async () => {
  let tentativas = 0;
  const estado = { pronto: false, modo: 'servidor', fornecedores: [], agentes: [], ferramentas: [], indisponiveis: [] };
  const api = {
    S: {}, paint() {}, /* sem toast: a acção não pode rebentar quando ele falta */
    call: async (caminho) => {
      if (caminho === '/ia/estado') { tentativas++; return estado; }
      if (caminho === '/ia/gratuitos') return { ok: true, modelos: [], porProvar: [], estado: { frase: 'x' } };
      if (caminho === '/ia/uso') return { resumo: [], errosRecentes: [] };
      if (caminho === '/ia/runs') return { runs: [] };
      if (caminho === '/media/trabalhos') return { trabalhos: [] };
      throw new Error('rota inesperada');
    },
    toast() {},
  };
  const tratado = await accaoIA('ia-recarregar', null, api);
  assert.equal(tratado, true);
  assert.equal(tentativas, 1);
  assert.equal(api.S.iaErro, null);
  assert.ok(api.S.ia, 'o estado ficou lido');
});

/* ---------- 1.50.0 · a conversa com a IA à escolha ---------- */
const estadoComAgentes = () => ({
  pronto: true, modo: 'servidor',
  fornecedores: [{ id: 'llm7', nome: 'LLM7', configurado: true, semChave: true, estado: 'funcional', limites: 'anónimo', familia: 'nucleo' }],
  agentes: [
    { id: 'research', nome: '02 Research', papel: 'Planeia', ferramentas: ['mesa_resumo'], modelo: null, fornecedor: null, escolha: null },
    { id: 'reviewer', nome: '08 Reviewer', papel: 'Verifica', ferramentas: [], modelo: 'codestral-latest', fornecedor: 'llm7', escolha: { fornecedor: 'llm7', modelo: 'codestral-latest' } },
  ],
  ferramentas: [], indisponiveis: [], memoria: {}, estudio: {},
});

const modelosComModelos = () => ({
  fornecedores: [
    { id: 'llm7', nome: 'LLM7', comChave: true, desligado: false, catalogo: [{ modelo: 'codestral-latest' }, { modelo: 'gpt-oss:20b' }], descobertos: [] },
    { id: 'ovh', nome: 'OVH AI Endpoints', comChave: false, desligado: false, catalogo: [{ modelo: 'Qwen3.8-27B' }], descobertos: [] },
  ],
  totalModelosCatalogo: 3,
});

function apiComTudo(extra = {}) {
  return {
    S: {},
    call: async (caminho, metodo) => {
      if (caminho === '/ia/estado') return estadoComAgentes();
      if (caminho === '/ia/modelos') return modelosComModelos();
      if (caminho === '/ia/gratuitos') return { ok: true, modelos: [], porProvar: [] };
      if (caminho === '/ia/uso') return { resumo: [], errosRecentes: [] };
      if (caminho === '/ia/runs') return { runs: [] };
      if (caminho === '/media/trabalhos') return { trabalhos: [] };
      if (caminho === '/ia/chat') return extra.chat ? extra.chat(metodo) : { resposta: 'olá', fornecedor: 'llm7', modelo: 'codestral-latest', ms: 12, tentativas: 1, ferramentas: [], pedido: null };
      if (caminho === '/ia/config') return extra.config ? extra.config() : { ok: true, agentes: {} };
      throw new Error('rota inesperada: ' + caminho);
    },
    paint() {}, toast() {},
  };
}

test('conversa: o selector mostra a lista real de modelos, com o estado do fornecedor', async () => {
  const api = apiComTudo();
  await carregarIA(api);
  /* escolher o agente que já tem uma escolha fixada: o «automático» passa a dizer qual é */
  api.S.iaChat = { agente: 'reviewer', escolha: '', mensagens: [] };
  const html = desenhar(api.S);
  assert.match(html, /Conversa/);
  assert.match(html, /data-act="ia-chat-mudar" data-qual="agente"/);
  assert.match(html, /data-act="ia-chat-mudar" data-qual="escolha"/);
  assert.match(html, /value="llm7\|codestral-latest"/);
  assert.match(html, /value="ovh\|Qwen3.8-27B"/);
  assert.match(html, /OVH AI Endpoints · sem chave/, 'o fornecedor diz o que lhe falta');
  assert.match(html, /automático \(llm7\/codestral-latest\)/, 'a escolha já fixada do agente aparece');
  assert.doesNotMatch(html, /value="sonnet"/, 'não há uma lista fixa de três modelos');
});

test('conversa: escolher modelo manda o par e a resposta diz quem respondeu', async () => {
  const pedidos = [];
  const api = apiComTudo({
    chat: () => ({ resposta: 'três leads.', fornecedor: 'llm7', modelo: 'gpt-oss:20b', ms: 40, tentativas: 1, ferramentas: [], pedido: { fornecedor: 'llm7', modelo: 'gpt-oss:20b' } }),
  });
  const callBase = api.call;
  api.call = async (caminho, metodo, corpo) => { if (caminho === '/ia/chat') pedidos.push(corpo); return callBase(caminho, metodo, corpo); };
  await carregarIA(api);

  // sem DOM, a caixa vem do estado que a vista desenhou
  api.S.iaChat = { agente: 'research', escolha: 'llm7|gpt-oss:20b', mensagens: [{ quem: 'tu', texto: 'quem temos?' }] };
  const alvo = { value: 'quem temos?' };
  const docAntigo = globalThis.document;
  globalThis.document = { getElementById: () => alvo };
  try {
    await accaoIA('ia-chat-enviar', { dataset: {} }, api);
  } finally { globalThis.document = docAntigo; }

  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].fornecedor, 'llm7');
  assert.equal(pedidos[0].modelo, 'gpt-oss:20b');
  assert.equal(pedidos[0].agente, 'research');
  assert.equal(pedidos[0].mensagem, 'quem temos?');
  const html = desenhar(api.S);
  assert.match(html, /quem temos\?/);
  assert.match(html, /llm7 \/ gpt-oss:20b · 40 ms/);
  assert.match(html, /pedido: llm7\/gpt-oss:20b/);
});

test('conversa: quando falha, a razão fica na conversa (não desaparece num toast)', async () => {
  const api = apiComTudo();
  const callBase = api.call;
  api.call = async (caminho, metodo, corpo) => {
    if (caminho === '/ia/chat') throw new Error('o Mem0 não interessa aqui: o fornecedor recusou (HTTP 402)');
    return callBase(caminho, metodo, corpo);
  };
  await carregarIA(api);
  api.S.iaChat = { agente: 'research', escolha: '', mensagens: [] };
  const docAntigo = globalThis.document;
  globalThis.document = { getElementById: () => ({ value: 'olá' }) };
  try {
    await accaoIA('ia-chat-enviar', { dataset: {} }, api);
  } finally { globalThis.document = docAntigo; }
  const html = desenhar(api.S);
  assert.match(html, /não respondeu/);
  assert.match(html, /HTTP 402/);
});

test('conversa: fixar a escolha grava-a para o agente via PATCH /ia/config', async () => {
  let patch = null;
  const api = apiComTudo({ config: () => ({ ok: true, agentes: { research: { modelo: { fornecedor: 'llm7', modelo: 'gpt-oss:20b' } } } }) });
  const callBase = api.call;
  api.call = async (caminho, metodo, corpo) => { if (caminho === '/ia/config') patch = { metodo, corpo }; return callBase(caminho, metodo, corpo); };
  await carregarIA(api);
  api.S.iaChat = { agente: 'research', escolha: 'llm7|gpt-oss:20b', mensagens: [] };
  await accaoIA('ia-chat-fixar', { dataset: {} }, api);
  assert.equal(patch.metodo, 'PATCH');
  assert.deepEqual(patch.corpo, { agentes: { research: { fornecedor: 'llm7', modelo: 'gpt-oss:20b' } } });
});
