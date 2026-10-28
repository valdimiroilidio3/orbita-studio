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
import { FORNECEDORES, comChave, mascarar, MODELOS, SEM_CHAVE } from './api/_ia/catalogo.mjs';
import { ErroIA, falar, listarModelos } from './api/_ia/cliente.mjs';
import { cadeia, diagnostico, falarComFallback, limparFora, orcamento, marcarFora, foraDoAr, eModeloIndisponivel } from './api/_ia/router.mjs';
import { FERRAMENTAS, INDISPONIVEIS, executar, validar } from './api/_ia/ferramentas.mjs';
import { criarMotor, esquecerBloqueios } from './api/_ia/motor.mjs';
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
  /* 1.33.0: além dos keyless, o OpenCode Zen publica a sua própria chave
     (`public`) para os modelos gratuitos — pronto sem conta do dono. */
  assert.deepEqual(semNada.map((x) => x.id).sort(), ['llm7', 'opencode', 'ovh', 'pollinations']);
  assert.deepEqual(semNada.filter((x) => x.variavel === SEM_CHAVE).map((x) => x.id).sort(), ['llm7', 'ovh', 'pollinations']);
  assert.deepEqual(semNada.filter((x) => x.publica).map((x) => x.id), ['opencode']);
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
  assert.ok(
    semChave.every((m) => FORNECEDORES[m.fornec].keyless || FORNECEDORES[m.fornec].chavePublica),
    'entrou um fornecedor com chave obrigatória sem chave',
  );
  const comOpenRouter = cadeia('plano', { chaves: { openrouter: 'OPENROUTER_API_KEY' }, desligados: ['ovh', 'opencode', 'llm7', 'pollinations'] });
  assert.ok(comOpenRouter.length > 0);
  assert.ok(comOpenRouter.every((m) => m.fornec === 'openrouter'));
  assert.ok(comOpenRouter[0].etiquetas.includes('raciocinio'));
  const visao = cadeia('visao', { chaves: { openrouter: 'X' } });
  assert.ok(visao.every((m) => m.etiquetas.includes('visao')));
  /* visão é o único tipo que nunca se relaxa (um modelo sem olhos não lê imagem) */
  assert.equal(cadeia('visao', { chaves: { groq: 'X' }, desligados: ['ovh', 'llm7', 'opencode', 'pollinations'] }).length, 0, 'groq não tem modelos de visão no catálogo');
  assert.equal(cadeia('visao', { chaves: {}, desligados: ['ovh', 'opencode', 'pollinations'] }).length, 0, 'a visão foi relaxada para um modelo sem visão');
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
  assert.deepEqual(diagnostico({ chaves: {}, desligados: ['ovh', 'llm7', 'kilo', 'opencode', 'pollinations'] }).pronto, false);
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
  await repo.ia.config.gravar('desligados', ['ovh', 'kilo', 'llm7', 'opencode', 'pollinations']);
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
  await repo.ia.config.gravar('desligados', ['kilo', 'ovh', 'llm7', 'opencode', 'pollinations']);
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
  assert.deepEqual(prontos, ['llm7', 'opencode', 'ovh', 'pollinations']);
  /* o OpenCode não mostra uma variável de ambiente: mostra que não precisa */
  const oc = r.corpo.fornecedores.find((f) => f.id === 'opencode');
  assert.equal(oc.semChave, true);
  assert.equal(JSON.stringify(r.corpo).includes('chave-publica'), false, 'a marca interna não deve sair na resposta');
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
  const c = cadeia('plano', { chaves: {}, desligados: ['ovh', 'kilo', 'opencode', 'pollinations'] });
  assert.ok(c.length > 0, 'a cadeia ficou vazia mesmo havendo fornecedor pronto');
  assert.ok(c.every((m) => m.fornec === 'llm7'));
  assert.equal(c.every((m) => m.relaxado), true);
  /* quando há modelos com a etiqueta, não se relaxa nada */
  const normal = cadeia('texto', { chaves: {}, desligados: ['ovh', 'kilo', 'opencode', 'pollinations'] });
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

/* ---------- 8 · GET /ia/diagnostico (1.42.0) ---------- */
test('rota /ia/diagnostico: um pedido real a cada motor activo, sem revelar a chave', async () => {
  const repo = createMemRepo();
  const vistos = [];
  const fetchImpl = async (url, opt = {}) => {
    vistos.push({ url: String(url), auth: opt.headers?.authorization || null });
    if (String(url).startsWith('https://gen.pollinations.ai')) {
      return json({ model: 'openai/gpt-5.4-nano', choices: [{ message: { content: 'órbita' } }], usage: { prompt_tokens: 8, completion_tokens: 2 } });
    }
    return json({ error: { message: 'sem serviço' } }, 503);
  };
  const r = await rotasIA(repo, {
    caminho: '/ia/diagnostico', metodo: 'GET',
    env: { POLLINATIONS_API_KEY: 'sk-uma-chave-comprida-1234' }, fetchImpl,
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  const pol = r.corpo.motores.find((m) => m.fornec === 'pollinations');
  assert.equal(pol.ok, true, 'o Pollinations com chave tem de responder no diagnóstico');
  assert.equal(pol.modelo, 'openai/gpt-5.4-nano');
  assert.equal(pol.resposta, 'órbita');
  assert.equal(pol.comChave, true);
  /* foi pelo tier com chave, e não pelo anónimo */
  const pedido = vistos.find((v) => v.url.startsWith('https://gen.pollinations.ai'));
  assert.match(pedido.url, /\/v1\/chat\/completions$/);
  assert.equal(pedido.auth, 'Bearer sk-uma-chave-comprida-1234');
  /* o diagnóstico não vaza a chave nem inventa sucesso nos que falharam */
  assert.ok(!JSON.stringify(r.corpo).includes('sk-uma-chave-comprida-1234'), 'a chave saiu na resposta');
  assert.equal(r.corpo.motores.filter((m) => m.ok).length, r.corpo.aResponder);
  assert.match(r.corpo.resumo, /responderam agora/);
});

test('rota /ia/diagnostico: só keyless e sem rede diz a verdade (nenhum respondeu)', async () => {
  const repo = createMemRepo();
  const r = await rotasIA(repo, {
    caminho: '/ia/diagnostico?fornec=pollinations', metodo: 'GET', env: {},
    fetchImpl: async () => json({ error: 'sem rede' }, 502),
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.aResponder, 0);
  assert.equal(r.corpo.motores.length, 1, 'o filtro ?fornec= limita a um');
  assert.match(r.corpo.motores[0].erro, /openai-fast/);
  assert.equal(r.corpo.motores[0].comChave, false);
});

/* ---------- 9 · descobrir modelos de todos os fornecedores (1.43.0) ---------- */
test('rota /ia/modelos/descobrir: «todos» pergunta a quem se pode e devolve o resumo', async () => {
  const repo = createMemRepo();
  const vistos = [];
  const fetchImpl = async (url) => {
    vistos.push(String(url));
    if (String(url).includes('gen.pollinations.ai')) {
      return json({ data: [
        { id: 'openai/gpt-5.4-nano', paid_only: false, tools: true, context_length: 400000 },
        { id: 'meta/muse-spark-1.3', paid_only: true },
      ] });
    }
    return json({ data: [{ id: 'codestral-latest' }] });
  };
  const r = await rotasIA(repo, {
    caminho: '/ia/modelos/descobrir', metodo: 'POST', corpo: { fornecedor: 'todos' },
    env: { POLLINATIONS_API_KEY: 'sk-chave-suficiente-1234' }, fetchImpl,
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.ok(r.corpo.quantos > 0);
  assert.ok(r.corpo.guardados.pollinations.quantos === 2);
  assert.ok(vistos.some((u) => u.includes('gen.pollinations.ai')), 'não perguntou ao Pollinations');
  /* e o que ficou guardado alimenta a cadeia — sem os pagos */
  const g = await rotasIA(repo, { caminho: '/ia/gratuitos', metodo: 'GET', env: {}, fetchImpl });
  const modelos = (g.corpo.catalogo || []).filter((m) => m.fornec === 'pollinations').map((m) => m.modelo);
  assert.ok(modelos.includes('openai/gpt-5.4-nano'));
  assert.equal(modelos.includes('meta/muse-spark-1.3'), false);
});

/* ---------- 1.44.0 · provar modelos em lote ---------- */
test('provar-modelos: só o que responde é promovido, e passa a entrar na cadeia', async () => {
  const repo = createMemRepo();
  const pedidos = [];
  const fetchImpl = async (url, opt) => {
    const corpo = JSON.parse(opt.body);
    pedidos.push(corpo.model);
    if (String(corpo.model).includes('qwen3-coder')) {
      return json({ choices: [{ message: { content: 'ok' } }] });
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'model not found' } }) };
  };
  const motor = criarMotor({ repo, env: { OPENROUTER_API_KEY: CHAVE }, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'openrouter', limite: 3 });

  assert.equal(r.testados, 3, 'o tecto não foi respeitado');
  assert.equal(r.provados, 1);
  assert.equal(r.resultados.filter((x) => x.ok).length, 1);
  assert.equal(r.resultados.find((x) => x.ok).modelo.includes('qwen3-coder'), true);

  const cfg = await repo.ia.config.ler();
  const provados = Object.keys(cfg.testes?.openrouter?.provados || {});
  assert.equal(provados.length, 1, 'a prova boa não ficou gravada');
  assert.equal(provados[0].includes('qwen3-coder'), true);
  assert.equal(provados.some((m) => m.includes('gpt-oss')), false, 'gravou um modelo que falhou');

  /* a prova entra na cadeia: o mesmo modelo aparece nos gratuitos provados */
  const gr = await motor.gratuitos();
  assert.equal(gr.modelos.some((m) => m.fornec === 'openrouter' && m.modelo.includes('qwen3-coder')), true);
});

test('provar-modelos: não gasta pedidos em fornecedores sem acesso nem nos já provados', async () => {
  const repo = createMemRepo();
  let chamadas = 0;
  const fetchImpl = async () => { chamadas += 1; return json({ choices: [{ message: { content: 'ok' } }] }); };
  const motor = criarMotor({ repo, env: {}, fetchImpl });   // sem chave: só keyless
  const antes = await motor.provarModelos({ fornec: 'openrouter', limite: 5 });
  assert.equal(antes.testados, 0, 'tentou um fornecedor sem chave');
  assert.equal(chamadas, 0);

  /* provar duas vezes o mesmo modelo não repete o pedido (a não ser com `forcar`) */
  await repo.ia.config.gravar('testes', { llm7: { provados: { 'codestral-latest': { ok: true, ms: 10 } } } });
  const motor2 = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor2.provarModelos({ fornec: 'llm7', limite: 8 });
  assert.equal(r.resultados.some((x) => x.modelo === 'codestral-latest'), false, 'voltou a provar o que já estava provado');
});

test('rota /ia/provar-modelos: GET para verificação, e fornecedor desconhecido é recusado', async () => {
  const repo = createMemRepo();
  const fetchImpl = async () => json({ choices: [{ message: { content: 'ok' } }] });
  const r = await rotasIA(repo, { caminho: '/ia/provar-modelos?fornecedor=llm7&limite=1', metodo: 'GET', env: {}, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.fornecedor, 'llm7');
  assert.equal(Array.isArray(r.corpo.resultados), true);
  const mau = await rotasIA(repo, { caminho: '/ia/provar-modelos', metodo: 'POST', corpo: { fornecedor: 'nao-existe' }, env: {}, fetchImpl });
  assert.equal(mau.status, 400);
});

test('provar-modelos: um limite do fornecedor para o lote na hora (não queima 9 tentativas)', async () => {
  const repo = createMemRepo();
  let chamadas = 0;
  const fetchImpl = async () => {
    chamadas += 1;
    return { ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'Free usage limit reached' } }) };
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'opencode', limite: 6, concorrencia: 1 });
  assert.equal(r.provados, 0);
  assert.equal(chamadas, 1, `insistiu ${chamadas} vezes num fornecedor sem quota`);
  assert.equal(r.saltados.length, 1);
  assert.equal(r.saltados[0].fornec, 'opencode');
  assert.match(r.saltados[0].motivo, /limite/);
  assert.equal(r.porProvarRestantes > 0, true, 'as restantes ficam contadas para a próxima chamada');
});

test('provar-modelos: o fornecedor que deu limite fica de fora da chamada seguinte (e expira)', async () => {
  esquecerBloqueios();   // a memória do processo é partilhada com o teste anterior
  const repo = createMemRepo();
  let chamadas = 0;
  const fetchImpl = async () => { chamadas += 1; return { ok: false, status: 429, text: async () => '{"error":"limite"}' }; };
  const agoraFixo = new Date('2026-10-28T08:00:00.000Z');
  const motor = criarMotor({ repo, env: {}, fetchImpl, agora: () => agoraFixo.toISOString() });
  await motor.provarModelos({ fornec: 'opencode', limite: 2, concorrencia: 1 });
  assert.equal(chamadas, 1);

  /* segunda chamada, 5 minutos depois: nem um pedido ao mesmo fornecedor */
  const motor2 = criarMotor({ repo, env: {}, fetchImpl, agora: () => new Date(agoraFixo.getTime() + 5 * 60 * 1000).toISOString() });
  const r2 = await motor2.provarModelos({ fornec: 'opencode', limite: 2, concorrencia: 1 });
  assert.equal(chamadas, 1, 'voltou a bater no fornecedor bloqueado');
  assert.equal(r2.testados, 0);
  assert.match(r2.saltados[0].motivo, /limite/);
  assert.equal(r2.saltados[0].ate, '2026-10-28T08:30:00.000Z');

  /* 40 minutos depois o bloqueio expirou: volta a tentar */
  const motor3 = criarMotor({ repo, env: {}, fetchImpl, agora: () => new Date(agoraFixo.getTime() + 40 * 60 * 1000).toISOString() });
  await motor3.provarModelos({ fornec: 'opencode', limite: 1, concorrencia: 1 });
  assert.equal(chamadas, 2, 'o bloqueio não expirou');
});

test('gratuitos: os bloqueios do fornecedor aparecem (e os expirados não)', async () => {
  const repo = createMemRepo();
  await repo.ia.config.gravar('testes', {
    opencode: { bloqueadoAte: new Date(Date.now() + 60 * 60 * 1000).toISOString(), bloqueadoPor: 'limite de utilização em opencode' },
    keka: { bloqueadoAte: new Date(Date.now() - 60 * 60 * 1000).toISOString(), bloqueadoPor: 'velho' },
  });
  const motor = criarMotor({ repo, env: {}, fetchImpl: async () => { throw new Error('sem rede'); } });
  const gr = await motor.gratuitos();
  assert.equal(gr.bloqueios.length, 1);
  assert.equal(gr.bloqueios[0].fornec, 'opencode');
  assert.match(gr.bloqueios[0].motivo, /limite/);
});

test('provar-modelos: o lote faz rodízio entre fornecedores (um só não o consome)', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  const vistos = [];
  const fetchImpl = async (url, opt) => {
    vistos.push(JSON.parse(opt.body).model);
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ limite: 6, concorrencia: 1 });
  const donos = r.alvos.map((a) => a.fornec);
  assert.equal(r.alvos.length, 6);
  assert.equal(new Set(donos.slice(0, 4)).size >= 2, true, `o lote começou todo no mesmo fornecedor: ${donos.join(',')}`);
  assert.equal(vistos.length, 6);
});

test('provar-modelos: não repete os curados, nem bloqueia um keyless por erro de chave de um modelo', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  const pedidos = [];
  const fetchImpl = async (url, opt) => {
    const modelo = JSON.parse(opt.body).model;
    pedidos.push(modelo);
    if (modelo === 'DeepSeek-V4.1-Flash') return { ok: false, status: 401, text: async () => '{"error":"Missing API key."}' };
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  await repo.ia.config.gravar('descobertos', { llm7: { quando: new Date().toISOString(), modelos: [{ id: 'DeepSeek-V4.1-Flash' }, { id: 'Inkling-Small' }] } });
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'llm7', limite: 4 });

  assert.equal(r.alvos.some((a) => a.modelo === 'codestral-latest'), false, 'repetiu um modelo da lista curada');
  const erroChave = r.resultados.find((x) => x.codigo === 'chave');
  assert.ok(erroChave, 'o teste precisa de exercer o erro de chave');
  assert.equal(erroChave.doFornecedor, false, 'bloqueou o fornecedor keyless inteiro por um modelo com tier pago');
  assert.equal(r.saltados.some((x) => x.fornec === 'llm7'), false);
});

test('provar-modelos: um 502 marca o modelo de fora (6 h) para não voltar a ser tentado', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  const fetchImpl = async () => ({ ok: false, status: 502, text: async () => '{"error":"upstream"}' });
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'pollinations', limite: 1, concorrencia: 1 });
  const alvo = r.alvos[0];
  assert.equal(foraDoAr(alvo.fornec, alvo.modelo), true, 'o modelo avariado não ficou de fora');
  /* a cadeia deixa de o propor */
  const c = cadeia('texto', { chaves: { pollinations: SEM_CHAVE }, limite: 20 });
  assert.equal(c.some((x) => x.fornec === alvo.fornec && x.modelo === alvo.modelo), false);
});

test('provar-modelos: um modelo de raciocínio tem segunda oportunidade com mais tokens', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  const orcamentos = [];
  const fetchImpl = async (url, opt) => {
    const corpo = JSON.parse(opt.body);
    orcamentos.push(corpo.max_tokens);
    /* primeiro pedido: vazio (gastou tudo a pensar); segundo: responde */
    const texto = corpo.max_tokens > 64 ? 'ok' : '';
    return json({ choices: [{ message: { content: texto } }] });
  };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'ovh', limite: 1, concorrencia: 1 });
  assert.deepEqual(orcamentos.slice(0, 2), [64, 900], 'não deu a segunda oportunidade com espaço para pensar');
  assert.equal(r.resultados[0].ok, true);
  assert.equal(r.resultados[0].tentativas, 2);
  assert.equal(r.provados, 1);
});

test('provar-modelos: um modelo de áudio/tempo-real sai da cadeia e não fica «por provar»', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'Model "openai/gpt-transcribe" is a audio model and cannot be used on the text endpoint.' } }) });
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'pollinations', limite: 1, concorrencia: 1 });
  const alvo = r.alvos[0];
  assert.equal(r.resultados[0].codigo, 'naoConversa');
  assert.equal(r.resultados[0].doFornecedor, false, 'não pode bloquear o fornecedor inteiro');
  assert.equal(foraDoAr(alvo.fornec, alvo.modelo), true, 'o modelo que não conversa continua a ser tentado');
});

test('a cadeia põe os provados pela app à frente dos descobertos que nunca responderam', async () => {
  const repo = createMemRepo();
  await repo.ia.config.gravar('descobertos', { pollinations: { quando: new Date().toISOString(), modelos: [
    { id: 'community/alguem/modelo-bonito', janela: 1048576, ferramentas: true, visao: true, raciocinio: true },
  ] } });
  await repo.ia.config.gravar('testes', { pollinations: { provados: { 'openai-fast': { ok: true, ms: 900, quando: new Date().toISOString() } } } });
  const motor = criarMotor({ repo, env: {}, fetchImpl: async () => { throw new Error('sem rede'); } });
  const c = await motor.cadeiaPara('texto');
  assert.equal(c[0].modelo, 'openai-fast', `a cadeia começou em ${c[0].fornec}/${c[0].modelo} em vez do modelo que já respondeu`);
  assert.equal(c.some((x) => x.modelo.includes('community/')), false, 'um modelo nunca provado saltou para a frente');
});

test('um bloqueio inválido (keyless sem chave) é ignorado e limpo sozinho', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  let chamadas = 0;
  const fetchImpl = async () => { chamadas += 1; return json({ choices: [{ message: { content: 'ok' } }] }); };
  /* o LLM7 não tem modelos no catálogo declarado: os reais vêm da descoberta */
  await repo.ia.config.gravar('descobertos', { llm7: { quando: new Date().toISOString(), modelos: [{ id: 'DeepSeek-V4.1-Flash' }, { id: 'Inkling-Small' }] } });
  /* o bloqueio real que a produção tinha: LLM7 «Missing API key» até 6 h depois */
  await repo.ia.config.gravar('testes', { llm7: {
    bloqueadoAte: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    bloqueadoPor: 'chave recusada por llm7: Missing API key.',
  } });
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'llm7', limite: 2, concorrencia: 1 });
  assert.equal(chamadas > 0, true, 'o bloqueio inválido impediu de provar um fornecedor keyless');
  assert.equal(r.ignorados.length, 1);
  assert.match(r.ignorados[0].porque, /keyless/);
  const cfg = await repo.ia.config.ler();
  assert.equal(cfg.testes.llm7.bloqueadoAte, undefined, 'o bloqueio inválido continua gravado');
});

test('rota /ia/bloqueios: vê e limpa, com o motivo de cada um', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  await repo.ia.config.gravar('testes', { ovh: { bloqueadoAte: new Date(Date.now() + 60_000).toISOString(), bloqueadoPor: 'limite de utilização em ovh' } });
  const fetchImpl = async () => json({ choices: [{ message: { content: 'ok' } }] });
  const ver = await rotasIA(repo, { caminho: '/ia/bloqueios?ver=1', metodo: 'GET', env: {}, fetchImpl });
  assert.equal(ver.corpo.bloqueios.length, 1);
  assert.equal(ver.corpo.bloqueios[0].fornec, 'ovh');
  const limpar = await rotasIA(repo, { caminho: '/ia/bloqueios/limpar', metodo: 'POST', corpo: {}, env: {}, fetchImpl });
  assert.equal(limpar.corpo.quantos, 1);
  const ver2 = await rotasIA(repo, { caminho: '/ia/bloqueios?ver=1', metodo: 'GET', env: {}, fetchImpl });
  assert.equal(ver2.corpo.bloqueios.length, 0);
});

/* ---------- 1.45.1 · um modelo que o fornecedor diz ser pago não é «gratuito» ---------- */
test('descoberta por GET: os modelos que o LLM7 marca como pro não entram nos gratuitos', async () => {
  esquecerBloqueios();
  const repo = createMemRepo();
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('api.llm7.io')) {
      return json({ object: 'list', data: [
        { id: 'Qwen2.5-Coder-32B', tier: 'free' },
        { id: 'DeepSeek-V4.1-Flash', tier: 'pro', usage_based_only: true },
        { id: 'Inkling-Small', tier: 'pro' },
      ] });
    }
    return json({ data: [] });
  };
  /* a descoberta passa a poder ser pedida num GET — sem isto, um URL sozinho
     não conseguia perguntar a lista real a ninguém */
  const r = await rotasIA(repo, {
    caminho: '/ia/modelos/descobrir?fornecedor=llm7&forcar=1', metodo: 'GET', env: {}, fetchImpl,
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.fornecedor, 'llm7');
  assert.equal(r.corpo.guardados.llm7.quantos, 3, 'a descoberta tem de guardar a lista crua');
  const g = await rotasIA(repo, { caminho: '/ia/gratuitos', metodo: 'GET', env: {}, fetchImpl });
  const llm7 = (g.corpo.porProvar || []).filter((m) => m.fornec === 'llm7').map((m) => m.modelo);
  assert.deepEqual(llm7, ['Qwen2.5-Coder-32B'],
    `entraram modelos pagos na lista dos gratuitos: ${llm7.join(', ')}`);
  /* e o `pago` fica registado como a API o declarou, não como um palpite */
  const cfg = await repo.ia.config.ler();
  const guardados = cfg.descobertos.llm7.modelos;
  assert.equal(guardados.find((m) => m.id === 'DeepSeek-V4.1-Flash').pago, true);
  assert.equal(guardados.find((m) => m.id === 'Qwen2.5-Coder-32B').pago, null);
});

/* ---------- 1.45.2 · as duas portas do tier anónimo do Pollinations ---------- */
test('Pollinations anónimo: se a porta /openai der 502, a porta GET responde e o texto vale', async () => {
  const vistos = [];
  const fetchImpl = async (url, opt) => {
    vistos.push({ url: String(url), metodo: opt?.method || 'GET' });
    if (String(url).endsWith('/openai')) {
      return json({ error: 'Chat Completions provider returned an empty response' }, 502);
    }
    return { ok: true, status: 200, text: async () => 'orbita' };
  };
  const r = await falar({
    fornec: 'pollinations', prov: FORNECEDORES.pollinations, chave: '', modelo: 'openai',
    mensagens: [{ role: 'user', content: 'Diz apenas a palavra orbita' }], fetchImpl,
  });
  assert.equal(r.texto, 'orbita');
  assert.equal(vistos.length, 2, 'não tentou a segunda porta');
  assert.match(vistos[0].url, /\/openai$/);
  assert.match(vistos[1].url, /text\.pollinations\.ai\/Diz%20apenas.*model=openai/);
});

test('Pollinations anónimo: um modelo de comunidade NÃO é provado pela porta GET', async () => {
  const vistos = [];
  const fetchImpl = async (url) => {
    vistos.push(String(url));
    return json({ error: 'provider returned an empty response' }, 502);
  };
  await assert.rejects(() => falar({
    fornec: 'pollinations', prov: FORNECEDORES.pollinations, chave: '', modelo: 'community/alguem/modelo-bonito',
    mensagens: [{ role: 'user', content: 'olá' }], fetchImpl,
  }), (e) => e instanceof ErroIA && e.codigo === 'avaria');
  assert.equal(vistos.length, 1, 'o GET devolveria o modelo por omissão — isso não prova este modelo');
});

/* ---------- 1.46.0 · uma mensagem pode levar uma imagem (digitalizar papel) ---------- */
test('imagem nas mensagens: cada dialeto recebe a fotografia à sua maneira', async () => {
  const imagem = 'iVBORw0KGgoAAAANSUhEUg==';
  const mensagens = [{
    role: 'user',
    content: [{ type: 'text', text: 'transcreve' }, { type: 'image', mime: 'image/jpeg', base64: imagem }],
  }];
  const corpoDe = async (fornec) => {
    let visto = null;
    const fetchImpl = async (url, opt) => {
      visto = JSON.parse(opt.body);
      return json({ choices: [{ message: { content: 'ok' } }], content: [{ type: 'text', text: 'ok' }], candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    };
    await falar({ fornec, prov: FORNECEDORES[fornec], chave: 'sk-teste-1234', modelo: 'm', mensagens, fetchImpl });
    return visto;
  };
  const openai = await corpoDe('openrouter');
  assert.equal(openai.messages[0].content[1].type, 'image_url');
  assert.match(openai.messages[0].content[1].image_url.url, new RegExp(`^data:image/jpeg;base64,${imagem}$`));
  const google = await corpoDe('google');
  assert.equal(google.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
  assert.equal(google.contents[0].parts[1].inline_data.data, imagem);
  const anthropic = await corpoDe('anthropic');
  assert.equal(anthropic.messages[0].content[1].source.type, 'base64');
  assert.equal(anthropic.messages[0].content[1].source.data, imagem);
  /* e uma mensagem de texto simples continua a ser texto simples */
  const soTexto = await (async () => {
    let visto = null;
    const fetchImpl = async (url, opt) => { visto = JSON.parse(opt.body); return json({ choices: [{ message: { content: 'ok' } }] }); };
    await falar({ fornec: 'openrouter', prov: FORNECEDORES.openrouter, chave: 'sk-teste-1234', modelo: 'm', mensagens: [{ role: 'user', content: 'olá' }], fetchImpl });
    return visto;
  })();
  assert.equal(soTexto.messages[0].content, 'olá');
});

test('provar-modelos: um modelo que o filtro de segurança recusa sai da cadeia (não volta em cada lote)', async () => {
  esquecerBloqueios();
  limparFora();
  const repo = createMemRepo();
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'Request blocked by safety filter: shield' } }) });
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'pollinations', limite: 1, concorrencia: 1 });
  const alvo = r.alvos[0];
  assert.equal(r.resultados[0].codigo, 'naoConversa');
  assert.equal(r.resultados[0].doFornecedor, false, 'não pode bloquear o fornecedor inteiro');
  assert.equal(foraDoAr(alvo.fornec, alvo.modelo), true, 'volta a ser tentado em cada lote');
  const r2 = await motor.provarModelos({ fornec: 'pollinations', limite: 4, concorrencia: 4 });
  assert.equal(r2.alvos.some((a) => a.modelo === alvo.modelo), false, 'o modelo recusado voltou a gastar uma tentativa');
  assert.equal(r2.deFora.some((x) => x.modelo === alvo.modelo), true, 'não se diz por que motivo ele está de fora');
  limparFora();
});

test('provar-modelos: «faltam N» conta os que ficaram por provar, não só os que não couberam no lote', async () => {
  esquecerBloqueios();
  limparFora();
  const repo = createMemRepo();
  /* um 400 de pedido qualquer: falha, mas não é motivo para sair da lista */
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'pedido inválido para este modelo' } }) });
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'pollinations', limite: 3, concorrencia: 3 });
  assert.equal(r.provados, 0);
  assert.equal(r.testados, 3);
  assert.equal(r.porProvarRestantes, 3, `com os 3 a falhar, «faltam» disse ${r.porProvarRestantes}`);
  assert.equal(r.naoTentados, 0, 'todos couberam no lote');
});

test('provar-modelos: um arranque a frio lê a memória de «fora» e não a repete (1.47.5)', async () => {
  esquecerBloqueios();
  limparFora();
  const repo = createMemRepo();
  /* a base já sabe que estes modelos foram recusados há uma hora */
  await repo.ia.config.gravar('fora', {
    'pollinations/vllm-sr/d3': { at: Date.now() - 60 * 60 * 1000, motivo: 'TypeSafe request' },
    'pollinations/microsoft/microsoft-decision-1': { at: Date.now() - 60 * 60 * 1000, motivo: 'TypeSafe request' },
    'pollinations/respan/span-01-lite': { at: Date.now() - 60 * 60 * 1000, motivo: 'TypeSafe request' },
  });
  /* em produção estes três vieram da descoberta do Pollinations, não do catálogo */
  await repo.ia.config.gravar('descobertos', { pollinations: { quando: new Date().toISOString(), modelos: [
    { id: 'vllm-sr/d3' }, { id: 'microsoft/microsoft-decision-1' }, { id: 'respan/span-01-lite' },
  ] } });
  let chamadas = 0;
  const fetchImpl = async () => { chamadas += 1; return json({ choices: [{ message: { content: 'ok' } }] }); };
  const motor = criarMotor({ repo, env: {}, fetchImpl });
  const r = await motor.provarModelos({ fornec: 'pollinations', limite: 3, concorrencia: 3 });
  const alvos = r.alvos.map((a) => a.modelo);
  assert.equal(alvos.some((m) => m === 'vllm-sr/d3'), false, 'voltou a gastar uma tentativa num TypeSafe já recusado');
  assert.equal(alvos.some((m) => m === 'microsoft/microsoft-decision-1'), false);
  assert.equal(alvos.some((m) => m === 'respan/span-01-lite'), false);
  assert.equal(r.deForaQuantos >= 3, true, 'não se diz que estão de fora');
  assert.equal(chamadas, alvos.length, 'gastou pedidos que a memória já evitava');
  limparFora();
});

/* ---------- 1.50.0 · escolher a IA nesta conversa ---------- */
test('rota /ia/chat: um modelo pedido é validado e usado; um inventado dá 400 com a razão', async () => {
  const repo = createMemRepo();
  const { fetchImpl, pedidos } = fornecedorFalso();

  /* um par que está mesmo no catálogo (openrouter é o que o envFalso tem com chave) */
  const pedido = { fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free' };
  const r = await rotasIA(repo, {
    caminho: '/ia/chat', metodo: 'POST',
    corpo: { agente: 'research', mensagem: 'em duas linhas, o estado', ...pedido },
    env: envFalso, fetchImpl,
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.pedido, pedido, 'a resposta diz o que foi pedido');
  assert.equal(r.corpo.fornecedor, 'openrouter', 'e quem respondeu');
  assert.equal(pedidos.length > 0, true);

  const inventado = await rotasIA(repo, {
    caminho: '/ia/chat', metodo: 'POST',
    corpo: { mensagem: 'olá', fornecedor: 'openrouter', modelo: 'modelo-que-nao-existe' },
    env: envFalso, fetchImpl: async () => { throw new Error('não devia chamar o fornecedor'); },
  });
  assert.equal(inventado.status, 400);
  assert.match(inventado.corpo.error, /não está no catálogo/);
  assert.equal(Array.isArray(inventado.corpo.fornecedores), true);

  const fornecedorMau = await rotasIA(repo, { caminho: '/ia/chat', metodo: 'POST', corpo: { mensagem: 'olá', fornecedor: 'nao-existe' }, env: envFalso });
  assert.equal(fornecedorMau.status, 400);
  assert.match(fornecedorMau.corpo.error, /fornecedor desconhecido/);
});

test('rota /ia/chat: com só o modelo, o fornecedor vem do catálogo (e um homónimo pede o fornecedor)', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = fornecedorFalso();
  const r = await rotasIA(repo, {
    caminho: '/ia/chat', metodo: 'POST',
    corpo: { mensagem: 'estado?', modelo: 'z-ai/glm-4.5-air:free' },
    env: envFalso, fetchImpl,
  });
  /* 1.50.0 · este modelo existe só na openrouter (sem chave aqui): a rota não o
     recusa — diz de que fornecedor é e o router decide com o que há. */
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pedido.fornecedor, 'openrouter');
  assert.equal(r.corpo.pedido.modelo, 'z-ai/glm-4.5-air:free');
});

test('rota /ia/estado: a escolha do agente vem achatada (a interface não recebe um objecto)', async () => {
  const repo = createMemRepo();
  await repo.ia.config.gravar('agentes', { research: { modelo: { fornecedor: 'openrouter', modelo: 'anthropic/claude-sonnet-5' } } });
  const r = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env: envFalso });
  assert.equal(r.status, 200);
  const research = r.corpo.agentes.find((a) => a.id === 'research');
  assert.equal(research.modelo, 'anthropic/claude-sonnet-5');
  assert.equal(research.fornecedor, 'openrouter');
  assert.deepEqual(research.escolha, { fornecedor: 'openrouter', modelo: 'anthropic/claude-sonnet-5' });
  const semEscolha = r.corpo.agentes.find((a) => a.id === 'reviewer');
  assert.equal(semEscolha.modelo, null);
  assert.equal(semEscolha.escolha, null);
});

/* ---------- 1.51.0 · o esforço no /ia/chat ---------- */
test('rota /ia/chat: o esforço escolhido vira o tecto de tokens; um esforço inventado dá 400', async () => {
  const repo = createMemRepo();
  const { fetchImpl, pedidos } = fornecedorFalso();
  const r = await rotasIA(repo, {
    caminho: '/ia/chat', metodo: 'POST',
    corpo: { agente: 'research', mensagem: 'duas linhas', esforco: 'high', fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free' },
    env: envFalso, fetchImpl,
  });
  assert.equal(r.status, 200);
  /* o que se pediu e o que se aplicou, os dois na resposta */
  assert.deepEqual(r.corpo.esforco, { pedido: 'high', maxTokens: 2400 });
  /* e foi mesmo assim que o fornecedor foi chamado: não é um rótulo na interface */
  assert.equal(pedidos.length > 0, true);
  assert.equal(pedidos[0].corpo.max_tokens, 2400);

  const auto = await rotasIA(repo, {
    caminho: '/ia/chat', metodo: 'POST',
    corpo: { mensagem: 'duas linhas', fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free' },
    env: envFalso, fetchImpl,
  });
  assert.equal(auto.status, 200);
  assert.deepEqual(auto.corpo.esforco, { pedido: null, maxTokens: 1200 }, 'sem escolha, o esforço é o de sempre');

  const inventado = await rotasIA(repo, {
    caminho: '/ia/chat', metodo: 'POST',
    corpo: { mensagem: 'olá', esforco: 'turbo' },
    env: envFalso, fetchImpl: async () => { throw new Error('não devia chamar o fornecedor'); },
  });
  assert.equal(inventado.status, 400);
  assert.match(inventado.corpo.error, /esforço desconhecido/);
  assert.deepEqual(inventado.corpo.esforcos, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('rota /ia/modelos: diz os níveis de esforço que o servidor sabe aplicar', async () => {
  const repo = createMemRepo();
  const r = await rotasIA(repo, { caminho: '/ia/modelos', metodo: 'GET', env: envFalso });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.esforcos, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.match(r.corpo.esforcoNota, /tecto de tokens/);
});
