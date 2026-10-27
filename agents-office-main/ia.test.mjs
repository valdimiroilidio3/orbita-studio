/* ===========================================================================
   1.18.0 · provas da camada de IA (30 out 2026)

   O que se prova aqui, sem rede e sem chaves verdadeiras:
     · o cliente fala os três dialetos e classifica os erros;
     · o router só escolhe fornecedores com chave, respeita o preferido e desliga;
     · o fallback passa ao modelo seguinte e regista o que falhou;
     · o orçamento trava antes de gastar sem fim;
     · as ferramentas validam argumentos, respeitam permissões e não fazem o que
       é destrutivo sem aprovação;
     · o orquestrador corre um trabalho inteiro (plano → passos → ferramenta →
       revisão) sobre uma base em memória, com um fornecedor falso;
     · sem fornecedor, a execução falha com a razão escrita (não inventa);
     · nenhuma rota devolve a chave.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import { FORNECEDORES, comChave, mascarar, MODELOS } from './api/_ia/catalogo.mjs';
import { ErroIA, falar, listarModelos } from './api/_ia/cliente.mjs';
import { cadeia, diagnostico, falarComFallback, limparFora, orcamento, marcarFora, foraDoAr, eModeloIndisponivel } from './api/_ia/router.mjs';
import { FERRAMENTAS, INDISPONIVEIS, executar, validar } from './api/_ia/ferramentas.mjs';
import { criarMotor } from './api/_ia/motor.mjs';
import { correr, lerPlano, normalizarPlano } from './api/_ia/orquestrador.mjs';
import { rotasIA } from './api/_ia/rotas.mjs';
import { AGENTES } from './api/_ia/agentes.mjs';

const CHAVE = 'sk-teste-1234567890abcdef';
const envFalso = { OPENROUTER_API_KEY: CHAVE };

const json = (corpo, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(corpo) });

/* ---------- 1 · catálogo ---------- */
test('catálogo: comChave só vê variáveis com valor (mais os keyless), e a máscara não revela a chave', () => {
  /* 1.19.0: os keyless do freellmapi (Kilo, OVH) estão «prontos» sem chave —
     é isso que os torna utilizáveis já; os outros continuam a precisar dela. */
  const semNada = comChave({});
  assert.equal(semNada.every((x) => x.semChave), true, 'apareceu um fornecedor com chave sem haver chave');
  /* 27 out 2026: o Kilo fechou o anónimo (medido em produção); sobram o OVH
     (anónimo, ~2 pedidos/min) e o LLM7 (anónimo, 100/h — o freellmapi diz que
     os modelos básicos respondem sem chave). */
  assert.deepEqual(semNada.map((x) => x.id).sort(), ['llm7', 'ovh']);
  assert.equal(comChave({ OPENROUTER_API_KEY: CHAVE }).some((x) => x.id === 'openrouter' && x.variavel === 'OPENROUTER_API_KEY'), true);
  const vistos = comChave({ GROQ_API_KEY: CHAVE, CEREBRAS_API_KEY: '   ' }).filter((x) => !x.semChave);
  assert.deepEqual(vistos, [{ id: 'groq', variavel: 'GROQ_API_KEY' }]);
  const m = mascarar(CHAVE);
  assert.ok(!m.includes('1234567890'), 'a máscara mostrou o meio da chave');
  assert.match(m, /^sk-tes…cdef$/);
  assert.equal(Object.keys(FORNECEDORES).length >= 60, true, 'os fornecedores do freellmapi não entraram');
  assert.equal(MODELOS.length >= 120, true, 'os modelos do freellmapi não entraram');
});

/* ---------- 2 · cliente, três dialetos ---------- */
test('cliente openai: manda o modelo e as ferramentas, e lê texto + tool_calls', async () => {
  let visto;
  const f = async (url, opt) => {
    visto = { url, corpo: JSON.parse(opt.body), h: opt.headers };
    return json({
      model: 'qwen/qwen3-coder:free',
      choices: [{ message: { content: ' pronto ', tool_calls: [{ id: 'c1', function: { name: 'lead_criar', arguments: '{"nome":"Café Central"}' } }] } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    });
  };
  const r = await falar({
    fornec: 'openrouter', prov: FORNECEDORES.openrouter, chave: CHAVE, modelo: 'qwen/qwen3-coder:free',
    mensagens: [{ role: 'system', content: 'és um agente' }, { role: 'user', content: 'olá' }],
    ferramentas: [{ nome: 'lead_criar', descricao: 'cria', parametros: { type: 'object' } }],
    fetchImpl: f,
  });
  assert.equal(visto.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(visto.h.authorization, `Bearer ${CHAVE}`);
  assert.equal(visto.corpo.messages[0].role, 'system');
  assert.equal(visto.corpo.tools[0].function.name, 'lead_criar');
  assert.equal(r.texto, 'pronto');
  assert.equal(r.chamadas[0].nome, 'lead_criar');
  assert.deepEqual(r.chamadas[0].argumentos, { nome: 'Café Central' });
  assert.deepEqual(r.uso, { entrada: 12, saida: 7 });
});

test('cliente anthropic: x-api-key, system separado e blocos tool_use', async () => {
  let visto;
  const r = await falar({
    fornec: 'anthropic', prov: FORNECEDORES.anthropic, chave: CHAVE, modelo: 'claude-sonnet-5',
    mensagens: [{ role: 'system', content: 'regras' }, { role: 'user', content: 'olá' }],
    fetchImpl: async (url, opt) => {
      visto = { url, corpo: JSON.parse(opt.body), h: opt.headers };
      return json({ model: 'claude-sonnet-5', content: [{ type: 'text', text: 'certo' }, { type: 'tool_use', id: 't1', name: 'mesa_resumo', input: {} }], usage: { input_tokens: 5, output_tokens: 3 } });
    },
  });
  assert.equal(visto.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(visto.h['x-api-key'], CHAVE);
  assert.equal(visto.corpo.system, 'regras');
  assert.equal(visto.corpo.max_tokens > 0, true);
  assert.equal(r.texto, 'certo');
  assert.deepEqual(r.chamadas[0], { id: 't1', nome: 'mesa_resumo', argumentos: {} });
  assert.deepEqual(r.uso, { entrada: 5, saida: 3 });
});

test('cliente google: chave em cabeçalho (nunca na URL) e functionCall desembrulhado', async () => {
  let visto;
  const r = await falar({
    fornec: 'google', prov: FORNECEDORES.google, chave: CHAVE, modelo: 'gemini-2.5-flash',
    mensagens: [{ role: 'user', content: 'olá' }],
    fetchImpl: async (url, opt) => {
      visto = { url, corpo: JSON.parse(opt.body), h: opt.headers };
      return json({ candidates: [{ content: { parts: [{ text: 'viva' }, { functionCall: { name: 'leads_listar', args: { limite: 3 } } }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 } });
    },
  });
  assert.match(visto.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.ok(!visto.url.includes(CHAVE), 'a chave foi para a URL');
  assert.equal(visto.h['x-goog-api-key'], CHAVE);
  assert.equal(r.texto, 'viva');
  assert.equal(r.chamadas[0].nome, 'leads_listar');
  assert.deepEqual(r.chamadas[0].argumentos, { limite: 3 });
  assert.deepEqual(r.uso, { entrada: 8, saida: 4 });
});

test('cliente: erros classificados — 401 não se repete, 429 repete', async () => {
  const chamar = (status, corpo) => falar({
    fornec: 'groq', prov: FORNECEDORES.groq, chave: CHAVE, modelo: 'llama-3.1-8b-instant',
    mensagens: [{ role: 'user', content: 'x' }],
    fetchImpl: async () => json(corpo, status),
  });
  await assert.rejects(() => chamar(401, { error: { message: 'invalid api key' } }), (e) => {
    assert.ok(e instanceof ErroIA);
    assert.equal(e.codigo, 'chave');
    assert.equal(e.retentavel, false);
    return true;
  });
  await assert.rejects(() => chamar(429, { error: { message: 'rate limit' } }), (e) => (e.codigo === 'limite' && e.retentavel === true));
  await assert.rejects(() => chamar(404, { error: { message: 'model not found' } }), (e) => e.codigo === 'modelo');
});

test('cliente: sem chave não vai à rede', async () => {
  let foi = false;
  await assert.rejects(() => falar({ fornec: 'groq', prov: FORNECEDORES.groq, chave: '', modelo: 'x', mensagens: [], fetchImpl: async () => { foi = true; return json({}); } }), (e) => e.codigo === 'semchave');
  assert.equal(foi, false);
});

/* ---------- 3 · router ---------- */
test('router: só fornecedores utilizáveis (chave ou keyless), e o tipo certo para o tipo de trabalho', () => {
  const semChave = cadeia('plano', { chaves: {} });
  /* sem chave nenhuma só entram os keyless — e o OVH, que responde anónimo,
     agora traz modelos reais ao catálogo (antes não trazia nenhum). */
  assert.ok(semChave.length > 0);
  assert.ok(semChave.every((m) => FORNECEDORES[m.fornec].keyless), 'entrou um fornecedor com chave obrigatória sem chave');
  const comOpenRouter = cadeia('plano', { chaves: { openrouter: 'OPENROUTER_API_KEY' }, desligados: ['ovh'] });
  assert.ok(comOpenRouter.length > 0);
  assert.ok(comOpenRouter.every((m) => m.fornec === 'openrouter'));
  assert.ok(comOpenRouter[0].etiquetas.includes('raciocinio'));
  const visao = cadeia('visao', { chaves: { openrouter: 'X' } });
  assert.ok(visao.every((m) => m.etiquetas.includes('visao')));
  /* visão é o único tipo que nunca se relaxa (um modelo sem olhos não lê imagem) */
  assert.equal(cadeia('visao', { chaves: { groq: 'X' }, desligados: ['ovh', 'llm7'] }).length, 0, 'groq não tem modelos de visão no catálogo');
  assert.equal(cadeia('visao', { chaves: {}, desligados: ['ovh'] }).length, 0, 'a visão foi relaxada para um modelo sem visão');
});

test('router: preferido do agente vai à frente, e desligado fica de fora', () => {
  const chaves = { openrouter: 'X', google: 'Y' };
  const lista = cadeia('plano', { chaves });
  const preferido = { fornecedor: 'google', modelo: 'gemini-2.5-pro' };
  const c = cadeia('plano', { chaves, preferido });
  assert.deepEqual({ fornec: c[0].fornec, modelo: c[0].modelo }, { fornec: preferido.fornecedor, modelo: preferido.modelo });
  assert.ok(lista.length >= c.length - 0);
  const semGoogle = cadeia('plano', { chaves, desligados: ['google'] });
  assert.ok(semGoogle.every((m) => m.fornec !== 'google'));
  const diag = diagnostico({ chaves });
  assert.equal(diag.pronto, true);
  /* sem chave nenhuma o router ainda tem o OVH (anónimo); desligando os
     keyless é que fica sem nada — antes ficava sem nada mesmo com eles vivos. */
  assert.equal(diagnostico({ chaves: {} }).pronto, true);
  assert.deepEqual(diagnostico({ chaves: {}, desligados: ['ovh', 'llm7', 'kilo'] }).pronto, false);
});

test('router: um fornecedor keyless entra na cadeia sem haver chave dele', () => {
  const c = cadeia('texto', { chaves: {} });
  assert.ok(c.some((m) => m.fornec === 'ovh'), 'o OVH não entrou na cadeia sem chave');
  assert.ok(cadeia('texto', { chaves: {}, desligados: ['ovh'] }).every((m) => m.fornec !== 'ovh'), 'o desligado continuou a entrar');
});

test('fallback: o primeiro falha, o segundo responde, e o uso fica registado', async () => {
  const eventos = [];
  const orc = orcamento({ maxChamadas: 5 });
  const r = await falarComFallback('texto', {
    chaves: { openrouter: 'X' },
    orc,
    executar: async (entrada, { tentativa }) => {
      if (tentativa === 1) throw Object.assign(new ErroIA('limite', { codigo: 'limite', retentavel: true, fornec: entrada.fornec }), {});
      return { texto: 'segundo', uso: { entrada: 10, saida: 5 }, modelo: entrada.modelo, fornec: entrada.fornec, ms: 120 };
    },
    registar: (e) => eventos.push(e),
  });
  assert.equal(r.texto, 'segundo');
  assert.equal(r.tentativas, 2);
  assert.equal(eventos.filter((e) => !e.ok).length, 1);
  assert.equal(orc.chamadas, 1);
});

test('orçamento: chega ao limite e para com erro claro', () => {
  const orc = orcamento({ maxChamadas: 1 });
  orc.gastar({ entrada: 1, saida: 1 }, 10, { preco: [1, 1] });
  assert.throws(() => orc.gastar({ entrada: 1, saida: 1 }, 10, { preco: [1, 1] }), (e) => e.codigo === 'orcamento');
});

/* ---------- 4 · ferramentas ---------- */
test('ferramentas: validação recusa o que está mal, antes de tocar na base', async () => {
  const repo = createMemRepo();
  const ctx = { repo, agente: 'backend', permitidas: Object.keys(FERRAMENTAS) };
  const semNome = await executar('lead_criar', { cidade: 'Coimbra' }, ctx);
  assert.equal(semNome.ok, false);
  assert.match(semNome.erro, /falta «nome»/);
  const tipoErrado = await executar('lead_criar', { nome: 'X', telefone: 912345678 }, ctx);
  assert.equal(tipoErrado.ok, false);
  const estadoInvalido = await executar('lead_actualizar', { id: 'a', estado: 'talvez' }, ctx);
  assert.equal(estadoInvalido.ok, false);
  const extra = await executar('lead_criar', { nome: 'Café', invenção: 1 }, ctx);
  assert.equal(extra.ok, false);
  assert.equal(repo._dados.leads.length, 0, 'escreveu apesar de os argumentos estarem mal');
});

test('ferramentas: permissões por agente e aprovação para o destrutivo', async () => {
  const repo = createMemRepo();
  const r1 = await executar('lead_criar', { nome: 'Café Central', cidade: 'Coimbra' }, { repo, agente: 'research', permitidas: AGENTES.research.ferramentas });
  assert.equal(r1.ok, false);
  assert.match(r1.erro, /não tem permissão/);

  await repo.receitas.insert({ amount_cents: 5000, campaign: 'x' });
  const id = repo._dados.receitas[0].id;
  const semAprovacao = await executar('receita_apagar', { id }, { repo, agente: 'backend', permitidas: Object.keys(FERRAMENTAS) });
  assert.equal(semAprovacao.ok, false);
  assert.equal(semAprovacao.precisaAprovacao, true);
  assert.equal(repo._dados.receitas.length, 1, 'apagou sem aprovação');
  const comAprovacao = await executar('receita_apagar', { id }, { repo, agente: 'backend', permitidas: Object.keys(FERRAMENTAS), aprovado: true });
  assert.equal(comAprovacao.ok, true);
  assert.equal(repo._dados.receitas.length, 0);
});

test('ferramentas: lead_criar não duplica nome+cidade', async () => {
  const repo = createMemRepo();
  const ctx = { repo, agente: 'backend', permitidas: Object.keys(FERRAMENTAS) };
  const a = await executar('lead_criar', { nome: 'Café Central', cidade: 'Coimbra' }, ctx);
  const b = await executar('lead_criar', { nome: 'cafe central ', cidade: 'COIMBRA' }, ctx);
  assert.equal(a.ok, true);
  assert.equal(b.dados.duplicado, true);
  assert.equal(repo._dados.leads.length, 1);
});

test('ferramentas: o que não existe está declarado, não fingido', () => {
  const ids = INDISPONIVEIS.map((i) => i.id);
  for (const esperado of ['pesquisa_web', 'execucao_de_codigo', 'geracao_de_imagens']) assert.ok(ids.includes(esperado));
  assert.equal(FERRAMENTAS.pesquisa_web, undefined);
});

test('validar: aceita args válidos e enumera erros em português', () => {
  const ok = validar(FERRAMENTAS.leads_listar.parametros, { limite: 10, estado: 'novo' });
  assert.deepEqual(ok.erros, []);
  const mau = validar(FERRAMENTAS.leads_listar.parametros, { limite: 500, estado: 'x' });
  assert.equal(mau.ok, false);
  assert.equal(mau.erros.length, 2);
});

/* ---------- 5 · plano ---------- */
test('plano: lê JSON embrulhado em prosa e normaliza agentes', () => {
  const obj = lerPlano('Claro! Aqui vai:\n```json\n{"passos":[{"agente":"Agent 04 - Frontend","titulo":"t","instrucao":"fazer","criterio":"c"}],"limites":["sem web"]}\n```');
  const p = normalizarPlano(obj);
  assert.equal(p.passos.length, 1);
  assert.equal(p.passos[0].agente, 'frontend');
  assert.deepEqual(p.limites, ['sem web']);
  assert.equal(normalizarPlano({ nada: true }), null);
});

/* ---------- 6 · orquestrador de ponta a ponta (fornecedor falso) ---------- */
function fornecedorFalso({ plano = null, chamarFerramenta = null } = {}) {
  const pedidos = [];
  const fetchImpl = async (url, opt) => {
    const corpo = JSON.parse(opt.body);
    pedidos.push({ url, corpo });
    const sistema = corpo.messages?.[0]?.content || '';
    const ultima = corpo.messages[corpo.messages.length - 1];
    let texto = 'feito.';

    if (sistema.includes('Orchestrator')) {
      texto = JSON.stringify(plano || {
        passos: [
          { agente: 'research', titulo: 'Ver o que já existe', instrucao: 'resume a mesa', criterio: 'numeros reais' },
          { agente: 'backend', titulo: 'Guardar o lead', instrucao: 'cria o lead do Café Central', criterio: 'lead criado' },
        ],
        limites: ['sem pesquisa web'],
      });
    } else if (sistema.includes('Reviewer')) {
      texto = JSON.stringify({ decisao: 'aprovado', justificacao: 'os passos devolveram resultados reais', corrigir: [] });
    } else if (chamarFerramenta && ultima?.role !== 'tool') {
      return json({
        choices: [{ message: { content: '', tool_calls: [{ id: 'tc1', function: { name: chamarFerramenta.nome, arguments: JSON.stringify(chamarFerramenta.args) } }] } }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });
    }
    return json({ choices: [{ message: { content: texto } }], usage: { prompt_tokens: 30, completion_tokens: 20 } });
  };
  return { fetchImpl, pedidos };
}

test('orquestrador: plano → passos → ferramenta → revisão, tudo gravado na base', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = fornecedorFalso({ chamarFerramenta: { nome: 'lead_criar', args: { nome: 'Café Central', cidade: 'Coimbra' } } });
  /* o teste fixa o fornecedor: o OVH (keyless) seria candidato e este falso só
     fala o dialeto que o teste preparou. Desligar é uma função real do motor. */
  await repo.ia.config.gravar('desligados', ['ovh', 'kilo', 'llm7']);
  const motor = criarMotor({ repo, env: envFalso, fetchImpl });
  const run = await correr({ repo, motor, objetivo: 'Encontrar um cliente para o site do Café Central', env: envFalso });

  assert.equal(run.estado, 'concluido', `esperava concluido, veio ${run.estado}: ${run.erro || ''}`);
  assert.equal(run.plano.passos.length, 2);
  assert.equal(run.revisao.decisao, 'aprovado');
  assert.match(run.resultado, /Research/);
  assert.equal(run.artefactos.ferramentasUsadas.some((f) => f.nome === 'lead_criar' && f.ok), true);

  const passos = await repo.ia.steps.porRun(run.id);
  assert.ok(passos.length >= 3, 'faltam passos gravados');
  assert.equal(passos.every((p) => p.modelo), true, 'há passos sem modelo registado');
  assert.equal(repo._dados.leads.length, 1, 'a ferramenta não mexeu na base');
  assert.equal(repo._dados.leads[0].name, 'Café Central');

  const uso = await repo.ia.uso.recentes();
  assert.ok(uso.length >= 3, 'o uso não foi registado');
  assert.equal(uso.every((u) => u.fornecedor === 'openrouter'), true);
});

test('orquestrador: sem fornecedor pronto (keyless desligados), falha com a razão escrita', async () => {
  const repo = createMemRepo();
  /* 1.19.0: por omissão há dois keyless prontos; para provar a falha honesta,
     desligam-se os dois — é o mesmo caminho de quem não tem nada configurado. */
  await repo.ia.config.gravar('desligados', ['kilo', 'ovh', 'llm7']);
  const motor = criarMotor({ repo, env: {}, fetchImpl: async () => { throw new Error('não devia chamar'); } });
  const run = await correr({ repo, motor, objetivo: 'qualquer coisa', env: {} });
  assert.equal(run.estado, 'falhou');
  assert.match(run.erro, /nenhum fornecedor de IA configurado/);
  assert.equal((await repo.ia.steps.porRun(run.id)).length, 0);
});

test('orquestrador: execução cancelada antes de começar fica cancelada', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = fornecedorFalso();
  const motor = criarMotor({ repo, env: envFalso, fetchImpl });
  const r = await repo.ia.runs.criar({ objetivo: 'x', estado: 'cancelado' });
  const run = await correr({ repo, motor, objetivo: 'x', runId: r.id, env: envFalso });
  assert.equal(run.estado, 'cancelado');
});

test('orquestrador: retomar continua do plano gravado e não repete o que já está feito', async () => {
  const repo = createMemRepo();
  const { fetchImpl, pedidos } = fornecedorFalso();
  const motor = criarMotor({ repo, env: envFalso, fetchImpl });
  const plano = {
    passos: [
      { agente: 'research', titulo: 'Ver o que já existe', instrucao: 'resume a mesa', criterio: 'números reais' },
      { agente: 'backend', titulo: 'Guardar o lead', instrucao: 'regista o que falta', criterio: 'lead gravado' },
    ],
    limites: ['sem pesquisa web'],
  };
  const criada = await repo.ia.runs.criar({ objetivo: 'retomar isto', estado: 'parcial', plano });
  await repo.ia.steps.criar({ run_id: criada.id, ordem: 1, agente: 'research', titulo: 'Ver o que já existe', estado: 'concluido', saida: '3 leads na base' });

  const run = await correr({ repo, motor, objetivo: criada.objetivo, runId: criada.id, retomar: true, env: envFalso });

  assert.equal(run.estado, 'concluido', `esperava concluido, veio ${run.estado}: ${run.erro || ''}`);
  const passos = await repo.ia.steps.porRun(criada.id);
  assert.equal(passos.filter((x) => x.ordem === 1).length, 1, 'o passo já concluído foi repetido');
  assert.equal(passos.some((x) => x.ordem === 2 && x.agente === 'backend'), true, 'o passo em falta não correu');
  assert.match(run.resultado, /3 leads na base/, 'o contexto do passo anterior não foi reaproveitado');
  const planeou = pedidos.filter((x) => String(x.corpo.messages?.[0]?.content || '').includes('Responde SÓ com um objecto JSON'));
  assert.equal(planeou.length, 0, 'voltou a pedir um plano em vez de usar o gravado');
  assert.equal(run.revisao.decisao, 'aprovado');
});

test('orquestrador: retomar sem plano gravado continua a planear do zero', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = fornecedorFalso();
  const motor = criarMotor({ repo, env: envFalso, fetchImpl });
  const criada = await repo.ia.runs.criar({ objetivo: 'sem plano ainda', estado: 'novo' });
  const run = await correr({ repo, motor, objetivo: criada.objetivo, runId: criada.id, retomar: true, env: envFalso });
  assert.equal(run.estado, 'concluido');
  assert.equal(run.plano.passos.length, 2);
});

/* ---------- 7 · rotas ---------- */
test('rota /ia/runs/:id/correr: retomar sem plano é recusado com razão', async () => {
  const repo = createMemRepo();
  const r0 = await repo.ia.runs.criar({ objetivo: 'sem plano', estado: 'parcial' });
  const r = await rotasIA(repo, { caminho: `/ia/runs/${r0.id}/correr`, metodo: 'POST', corpo: { retomar: true }, env: envFalso });
  assert.equal(r.status, 409);
  assert.match(r.corpo.error, /não tem plano gravado/);
});

test('rota /ia/estado: só os keyless ficam prontos sem chave, e nunca devolve a chave', async () => {
  const repo = createMemRepo();
  const r = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: {} });
  assert.equal(r.status, 200);
  /* Só o OVH funciona sem chave (o Kilo passou a exigir conta — medido a
     27 out 2026) → há motor, mas nada está «funcional» até um teste real. */
  const prontos = r.corpo.fornecedores.filter((f) => f.configurado).map((f) => f.id).sort();
  assert.deepEqual(prontos, ['llm7', 'ovh']);
  assert.equal(r.corpo.fornecedores.every((f) => f.estado !== 'funcional'), true, 'alguém ficou «funcional» sem teste');
  assert.ok(!JSON.stringify(r.corpo).includes(CHAVE));
});

test('rota /ia/estado: com chave mostra o NOME da variável, a máscara e «por testar»', async () => {
  const repo = createMemRepo();
  const r = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: envFalso });
  const f = r.corpo.fornecedores.find((x) => x.id === 'openrouter');
  assert.equal(f.configurado, true);
  assert.equal(f.variavel, 'OPENROUTER_API_KEY');
  assert.equal(f.estado, 'por_testar');
  assert.ok(!JSON.stringify(r.corpo).includes(CHAVE), 'a chave saiu na resposta');
  assert.ok(!JSON.stringify(r.corpo).includes('1234567890'));
});

test('rota /ia/testar: um teste REAL marca o fornecedor como funcional', async () => {
  const repo = createMemRepo();
  const chamadas = [];
  const fetchImpl = async (url) => {
    chamadas.push(url);
    if (url.endsWith('/models')) return json({ data: [{ id: 'qwen/qwen3-coder:free' }] });
    return json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
  };
  const r = await rotasIA(repo, { caminho: '/ia/testar', metodo: 'POST', corpo: { fornecedor: 'openrouter' }, env: envFalso, fetchImpl });
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.modelos, 1);
  assert.equal(chamadas.length, 2);
  const depois = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: envFalso });
  const f = depois.corpo.fornecedores.find((x) => x.id === 'openrouter');
  assert.equal(f.estado, 'funcional');
  assert.equal(f.ultimoTeste.ok, true);
});

test('rota /ia/testar: falha real fica registada como erro (não como funciona)', async () => {
  const repo = createMemRepo();
  const fetchImpl = async (url) => (url.endsWith('/models') ? json({ data: [{ id: 'x' }] }) : json({ error: { message: 'invalid key' } }, 401));
  const r = await rotasIA(repo, { caminho: '/ia/testar', metodo: 'POST', corpo: { fornecedor: 'openrouter' }, env: envFalso, fetchImpl });
  assert.equal(r.corpo.ok, false);
  assert.match(r.corpo.erro, /chave recusada/);
  const estado = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: envFalso });
  assert.equal(estado.corpo.fornecedores.find((x) => x.id === 'openrouter').estado, 'erro');
});

test('motor.testar: um keyless (ovh) não é «falta chave» — testa anónimo, sem Bearer', async () => {
  /* Encontrado em produção a 27 out 2026: /api/setup dizia «falta OVH_API_KEY»
     para um fornecedor marcado como sem chave. A rota /ia/testar tem de o testar
     a sério (pedido anónimo), não recusar antes de tentar. */
  const repo = createMemRepo();
  const cabecalhos = [];
  const fetchImpl = async (url, opt = {}) => {
    cabecalhos.push(opt.headers || {});
    if (String(url).endsWith('/models')) return json({ data: [{ id: 'Qwen3-32B' }] });
    return json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.testar('ovh');
  assert.equal(r.ok, true);
  assert.equal(cabecalhos.length, 2, 'não fez o teste real');
  assert.ok(cabecalhos.every((h) => !h.authorization), 'mandou um Bearer sem haver chave');
  const est = await motor.estado();
  assert.equal(est.fornecedores.find((f) => f.id === 'ovh').estado, 'funcional');
});

test('motor.testar: resposta vazia não conta como sucesso — tenta o modelo seguinte', async () => {
  /* 27 out 2026, OVH: o primeiro modelo do catálogo é de raciocínio e devolveu
     texto vazio com 16 tokens de saída; o estado dizia «funcional» com «» como
     resposta. Agora vazio é falha e passa-se ao candidato seguinte. */
  const repo = createMemRepo();
  const usados = [];
  const fetchImpl = async (url, opt = {}) => {
    if (String(url).endsWith('/models')) return json({ data: [{ id: 'Qwen3.5-397B-A17B' }, { id: 'gpt-oss-20b' }] });
    const modelo = JSON.parse(opt.body).model;
    usados.push(modelo);
    if (modelo === 'Qwen3.5-397B-A17B') return json({ choices: [{ message: { content: '' } }] });
    return json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 4, completion_tokens: 1 } });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.testar('ovh');
  assert.equal(r.ok, true);
  assert.equal(r.modelo, 'gpt-oss-20b');
  assert.deepEqual(usados, ['Qwen3.5-397B-A17B', 'gpt-oss-20b']);
});

test('motor.testar: se todos responderem vazio, fica erro (não «funcional»)', async () => {
  const repo = createMemRepo();
  const fetchImpl = async (url) => (String(url).endsWith('/models')
    ? json({ data: [{ id: 'Qwen3.5-397B-A17B' }] })
    : json({ choices: [{ message: { content: '   ' } }] }));
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  await assert.rejects(() => motor.testar('ovh'), /respondeu vazio/);
  const est = await motor.estado();
  assert.equal(est.fornecedores.find((f) => f.id === 'ovh').estado, 'erro');
});

test('motor.testar: quem exige chave e não a tem continua a ser recusado', async () => {
  const repo = createMemRepo();
  const motor = criarMotor({ repo, env: {}, fetchImpl: async () => { throw new Error('não devia chamar'); } });
  await assert.rejects(() => motor.testar('openrouter'), /falta OPENROUTER_API_KEY/);
});

test('rota /ia/runs: cria, corre e devolve os passos', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = fornecedorFalso({ chamarFerramenta: { nome: 'mesa_resumo', args: {} } });
  const criada = await rotasIA(repo, { caminho: '/ia/runs', metodo: 'POST', corpo: { objetivo: 'Preparar a abordagem ao Café Central' }, env: envFalso });
  assert.equal(criada.status, 201);
  const id = criada.corpo.run.id;
  const corrida = await rotasIA(repo, { caminho: `/ia/runs/${id}/correr`, metodo: 'POST', corpo: {}, env: envFalso, fetchImpl });
  assert.equal(corrida.status, 200);
  assert.equal(corrida.corpo.run.estado, 'concluido');
  const lida = await rotasIA(repo, { caminho: `/ia/runs/${id}`, metodo: 'GET', env: envFalso });
  assert.equal(lida.corpo.run.id, id);
  assert.ok(lida.corpo.passos.length >= 2);
  const curta = await rotasIA(repo, { caminho: '/ia/runs', metodo: 'POST', corpo: { objetivo: 'oi' }, env: envFalso });
  assert.equal(curta.status, 400);
});

test('rota /ia/config: desligar um fornecedor tira-o da cadeia', async () => {
  const repo = createMemRepo();
  const env2 = { OPENROUTER_API_KEY: CHAVE, GROQ_API_KEY: CHAVE };
  const p = await rotasIA(repo, { caminho: '/ia/config', metodo: 'PATCH', corpo: { desligados: ['groq'], agentes: { backend: { fornecedor: 'groq', modelo: 'qwen/qwen3-32b' } } }, env: env2 });
  assert.deepEqual(p.corpo.desligados, ['groq']);
  const motor = criarMotor({ repo, env: env2, fetchImpl: async () => json({}) });
  const lista = await motor.cadeiaPara('codigo', { agente: 'backend' });
  assert.ok(!lista.some((m) => m.fornec === 'groq'), 'o fornecedor desligado continuou na cadeia');
});

test('rota /ia/chat: usa o agente pedido, executa ferramentas e não inventa', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = fornecedorFalso({ chamarFerramenta: { nome: 'leads_listar', args: { limite: 5 } } });
  const r = await rotasIA(repo, { caminho: '/ia/chat', metodo: 'POST', corpo: { agente: 'research', mensagem: 'quem temos?' }, env: envFalso, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.agente, 'research');
  assert.equal(r.corpo.fornecedor, 'openrouter');
  assert.equal(r.corpo.ferramentas[0].nome, 'leads_listar');
  assert.equal(r.corpo.ferramentas[0].ok, true);
  assert.equal(r.corpo.resposta.length > 0, true);
});

test('rota /ia/chat: mensagem vazia e gigante são recusadas', async () => {
  const repo = createMemRepo();
  const vazia = await rotasIA(repo, { caminho: '/ia/chat', metodo: 'POST', corpo: { mensagem: '  ' }, env: envFalso });
  assert.equal(vazia.status, 400);
  const grande = await rotasIA(repo, { caminho: '/ia/chat', metodo: 'POST', corpo: { mensagem: 'x'.repeat(9000) }, env: envFalso });
  assert.equal(grande.status, 413);
});

test('rota /ia/uso: resume latência, erros e tokens por fornecedor', async () => {
  const repo = createMemRepo();
  await repo.ia.uso.registar({ fornecedor: 'openrouter', modelo: 'a', ok: true, ms: 100, tokens_in: 10, tokens_out: 5 });
  await repo.ia.uso.registar({ fornecedor: 'openrouter', modelo: 'a', ok: false, ms: 300, tokens_in: 0, tokens_out: 0, erro: 'limite' });
  const r = await rotasIA(repo, { caminho: '/ia/uso', metodo: 'GET', env: {} });
  const linha = r.corpo.resumo[0];
  assert.equal(linha.pedidos, 2);
  assert.equal(linha.ok, 1);
  assert.equal(linha.erros, 1);
  assert.equal(linha.latenciaMediaMs, 200);
  assert.equal(r.corpo.errosRecentes[0].erro, 'limite');
});

test('rotas desconhecidas e método errado não fingem sucesso', async () => {
  const repo = createMemRepo();
  const r = await rotasIA(repo, { caminho: '/ia/inventado', metodo: 'GET', env: {} });
  assert.equal(r.status, 404);
  assert.match(r.corpo.error, /ainda não serve/);
});

test('catálogo e agentes são coerentes: todas as ferramentas dos agentes existem', () => {
  for (const a of Object.values(AGENTES)) {
    for (const f of a.ferramentas) assert.ok(FERRAMENTAS[f], `${a.nome} pede uma ferramenta que não existe: ${f}`);
    assert.ok(a.tipos.every((t) => typeof t === 'string'));
  }
  assert.equal(Object.keys(AGENTES).length, 8);
  assert.ok(MODELOS.every((m) => FORNECEDORES[m.fornecedor]));
});

/* ---------- versão ---------- */
test('a versão servida por /api/health vem do package.json (sem números à mão)', async () => {
  const fs = await import('node:fs');
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const { VERSAO } = await import('./api/_versao.mjs');
  assert.equal(VERSAO, pkg.version);
  const fonte = fs.readFileSync(new URL('./api/health.mjs', import.meta.url), 'utf8');
  assert.ok(!/versao: '\d+\.\d+\.\d+'/.test(fonte), 'a versão voltou a estar escrita à mão no health');
});

test('router: sem modelos com a etiqueta exigida, a cadeia relaxa e diz que relaxou', () => {
  /* Só o LLM7 está pronto e nenhum modelo dele declara `raciocinio` (o
     gpt-oss-20b, que declarava, foi marcado indisponível a 27 out 2026 porque o
     fornecedor o recusou): em vez de uma cadeia vazia, entra com `relaxado`. */
  const c = cadeia('plano', { chaves: {}, desligados: ['ovh', 'kilo'] });
  assert.ok(c.length > 0, 'a cadeia ficou vazia mesmo havendo fornecedor pronto');
  assert.ok(c.every((m) => m.fornec === 'llm7'));
  assert.equal(c.every((m) => m.relaxado), true);
  /* quando há modelos com a etiqueta, não se relaxa nada */
  const normal = cadeia('texto', { chaves: {}, desligados: ['ovh', 'kilo'] });
  assert.equal(normal.some((m) => m.relaxado), false);
});

/* ---------- 1.23.1 · o router aprende com o que o fornecedor recusa ---------- */
test('router: um modelo que o fornecedor disse não ter sai da cadeia seguinte', () => {
  limparFora();
  const catalogo = [
    { fornecedor: 'llm7', modelo: 'bom', etiquetas: ['texto'], janela: 32000, preco: [0, 0] },
    { fornecedor: 'llm7', modelo: 'morto', etiquetas: ['texto'], janela: 32000, preco: [0, 0] },
  ];
  const chaves = { llm7: null };
  const antes = cadeia('texto', { chaves, catalogo, limite: 5 }).map((x) => x.modelo);
  assert.deepEqual(antes.sort(), ['bom', 'morto']);

  marcarFora('llm7', 'morto', "Model 'morto' is currently unavailable");
  assert.equal(foraDoAr('llm7', 'morto'), true);
  const depois = cadeia('texto', { chaves, catalogo, limite: 5 }).map((x) => x.modelo);
  assert.deepEqual(depois, ['bom'], 'o modelo recusado não devia voltar à cadeia');
  /* e passado o prazo volta a ser considerado */
  assert.equal(foraDoAr('llm7', 'morto', Date.now() + 7 * 60 * 60 * 1000), false);
  limparFora();
});

test('router: quem já respondeu num teste real vai à frente da cadeia', () => {
  const catalogo = [
    { fornecedor: 'llm7', modelo: 'a', etiquetas: ['texto'], janela: 32000, preco: [0, 0] },
    { fornecedor: 'llm7', modelo: 'b', etiquetas: ['texto'], janela: 32000, preco: [0, 0] },
  ];
  const semDica = cadeia('texto', { chaves: { llm7: null }, catalogo, limite: 5 }).map((x) => x.modelo);
  const comDica = cadeia('texto', { chaves: { llm7: null }, catalogo, limite: 5, usados: { 'llm7/b': true } }).map((x) => x.modelo);
  assert.notEqual(semDica[0], 'b', 'sem dica, a ordem é por mérito das etiquetas');
  assert.equal(comDica[0], 'b', 'o modelo que já respondeu devia ir à frente');
});

test('router: as frases de «este modelo não existe» são reconhecidas', () => {
  for (const frase of [
    "Model 'gpt-oss-20b' is currently unavailable.",
    'llm7 recusou o pedido (HTTP 400): model not found',
    'no such model: x',
    'este modelo não existe',
  ]) assert.equal(eModeloIndisponivel(frase), true, frase);
  for (const frase of ['chave recusada (HTTP 401)', 'rate limit', 'Responde apenas: ok']) {
    assert.equal(eModeloIndisponivel(frase), false, frase);
  }
});

test('router: falarComFallback marca o modelo indisponível ao ouvir a recusa', async () => {
  limparFora();
  const catalogo = [
    { fornecedor: 'llm7', modelo: 'morto', etiquetas: ['texto'], janela: 32000, preco: [0, 0] },
    { fornecedor: 'llm7', modelo: 'vivo', etiquetas: ['texto'], janela: 32000, preco: [0, 0] },
  ];
  const visto = [];
  const r = await falarComFallback('texto', {
    chaves: { llm7: null }, catalogo, limite: 5, cadeiaFixa: null,
    executar: async (entrada) => {
      visto.push(entrada.modelo);
      if (entrada.modelo === 'morto') throw new Error("Model 'morto' is currently unavailable");
      return { texto: 'ok', uso: { entrada: 1, saida: 1 }, ms: 3 };
    },
  });
  assert.equal(r.texto, 'ok');
  assert.deepEqual(visto, ['morto', 'vivo']);
  assert.equal(foraDoAr('llm7', 'morto'), true);
  limparFora();
});
