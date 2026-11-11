/* ===========================================================================
   1.85.0 · as ferramentas de web e de imagem, provadas sem rede.

   Tudo aqui corre com fetch falso e repositório falso: não gasta créditos, não
   chama a Tavily nem o Pollinations. O que se prova:
     · cada agente só vê as ferramentas que lhe foram dadas;
     · sem chave, a resposta diz qual variável falta — e não inventa resultados;
     · com resultados, os que têm pouca relevância ficam FORA e são contados;
     · a chave nunca aparece no resultado devolvido ao modelo;
     · imagem_gerar não corre sem aprovação humana e nunca devolve bytes.
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FERRAMENTAS, executar } from './api/_ia/ferramentas.mjs';
import { AGENTES, promptDe } from './api/_ia/agentes.mjs';

const CHAVE = 'tvly-SEGREDO-de-teste-12345';

const fetchFalso = (corpo, { status = 200 } = {}) => {
  const chamadas = [];
  const f = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    return { ok: status < 400, status, json: async () => corpo };
  };
  f.chamadas = chamadas;
  return f;
};

/* ---------- permissões ---------- */

test('1.85.0 · a pesquisa é dada à Investigação, não ao resto', () => {
  assert.ok(AGENTES.research.ferramentas.includes('web_pesquisar'));
  assert.ok(AGENTES.research.ferramentas.includes('web_ler'));
  for (const id of ['backend', 'qa', 'reviewer', 'design', 'frontend', 'orchestrator']) {
    assert.ok(!AGENTES[id].ferramentas.includes('web_pesquisar'), `${id} não devia pesquisar na web`);
  }
});

test('1.85.0 · a imagem é dada ao Designer e ao Criativo, e só a eles', () => {
  assert.ok(AGENTES.design.ferramentas.includes('imagem_gerar'));
  assert.ok(AGENTES.creative.ferramentas.includes('imagem_gerar'));
  for (const id of ['research', 'backend', 'frontend', 'qa', 'reviewer', 'orchestrator']) {
    assert.ok(!AGENTES[id].ferramentas.includes('imagem_gerar'), `${id} não devia gerar imagens`);
  }
});

test('1.85.0 · nenhum prompt diz que o agente não tem acesso à internet', () => {
  for (const id of Object.keys(AGENTES)) {
    assert.doesNotMatch(promptDe(id), /não tens acesso à internet/i, `${id} ainda diz que não tem internet`);
    assert.doesNotMatch(promptDe(id), /não há serviço de imagem configurado/i, `${id} ainda diz que não há imagem`);
  }
});

test('1.85.0 · um agente sem a ferramenta não a consegue chamar, mesmo que a peça', async () => {
  const r = await executar('web_pesquisar', { consulta: 'clínicas dentárias em Coimbra' }, {
    agente: 'backend', permitidas: AGENTES.backend.ferramentas, env: { TAVILY_API_KEY: CHAVE }, fetchImpl: fetchFalso({}),
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não tem permissão/);
});

/* ---------- pesquisa web ---------- */

test('1.85.0 · web_pesquisar sem chave diz a variável que falta e não pesquisa', async () => {
  const f = fetchFalso({});
  const r = await executar('web_pesquisar', { consulta: 'mercado de bicicletas elétricas' }, {
    agente: 'research', permitidas: AGENTES.research.ferramentas, env: {}, fetchImpl: f,
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /TAVILY_API_KEY/);
  assert.equal(f.chamadas.length, 0, 'chamou a rede sem chave');
});

test('1.85.0 · web_pesquisar devolve resultados reais e conta os que ficam fora', async () => {
  const f = fetchFalso({
    answer: 'Resposta curta de teste.',
    results: [
      { title: 'Página forte', url: 'https://exemplo.pt/a', content: 'texto útil', score: 0.82, published_date: '2026-10-01' },
      { title: 'Ruído', url: 'https://exemplo.pt/b', content: 'lixo', score: 0.04 },
    ],
  });
  const r = await executar('web_pesquisar', { consulta: 'concorrência de clínicas em Coimbra', limite: 5 }, {
    agente: 'research', permitidas: AGENTES.research.ferramentas, env: { TAVILY_API_KEY: CHAVE }, fetchImpl: f,
  });
  assert.equal(r.ok, true);
  assert.equal(r.dados.encontrados, 1);
  assert.equal(r.dados.descartados, 1, 'o resultado de relevância baixa tem de ser contado, não escondido');
  assert.equal(r.dados.resultados[0].url, 'https://exemplo.pt/a');
  assert.equal(r.dados.respostaCurta, 'Resposta curta de teste.');
  assert.equal(f.chamadas.length, 1);
  assert.match(f.chamadas[0].url, /api\.tavily\.com\/search|\/search$/);
});

test('1.85.0 · a chave da Tavily nunca sai no resultado devolvido ao modelo', async () => {
  const f = fetchFalso({ results: [] });
  const r = await executar('web_pesquisar', { consulta: 'zxqv inexistente' }, {
    agente: 'research', permitidas: AGENTES.research.ferramentas, env: { TAVILY_API_KEY: CHAVE }, fetchImpl: f,
  });
  assert.ok(!JSON.stringify(r).includes(CHAVE), 'a chave apareceu no resultado');
});

test('1.85.0 · web_pesquisar recusa argumentos inválidos antes de tocar na rede', async () => {
  const f = fetchFalso({});
  const r = await executar('web_pesquisar', { consulta: 'ok', dominio_inventado: 'x' }, {
    agente: 'research', permitidas: AGENTES.research.ferramentas, env: { TAVILY_API_KEY: CHAVE }, fetchImpl: f,
  });
  assert.equal(r.ok, false);
  assert.equal(f.chamadas.length, 0);
});

test('1.85.0 · web_ler só aceita endereços http(s) completos', async () => {
  const f = fetchFalso({});
  const r = await executar('web_ler', { url: 'file:///etc/passwd' }, {
    agente: 'research', permitidas: AGENTES.research.ferramentas, env: { TAVILY_API_KEY: CHAVE }, fetchImpl: f,
  });
  assert.equal(r.ok, false);
  assert.equal(f.chamadas.length, 0, 'chamou a rede com um endereço que não é web');
});

/* ---------- imagem ---------- */

test('1.85.0 · imagem_gerar não corre sem aprovação humana', async () => {
  let tocou = false;
  const repo = { projetos: { byId: async () => { tocou = true; return { id: 'p1', name: 'Café' }; } } };
  const r = await executar('imagem_gerar', { projeto_id: 'p1', prompt: 'uma chávena de café na mesa de madeira' }, {
    repo, agente: 'design', permitidas: AGENTES.design.ferramentas,
  });
  assert.equal(r.ok, false);
  assert.equal(r.precisaAprovacao, true);
  assert.equal(tocou, false, 'foi à base antes de ter o OK');
});

test('1.85.0 · imagem_gerar com aprovação e projeto falso: diz que não encontrou o projeto', async () => {
  const repo = { projetos: { byId: async () => null } };
  const r = await executar('imagem_gerar', { projeto_id: 'nao-existe', prompt: 'uma chávena de café na mesa de madeira' }, {
    repo, agente: 'design', permitidas: AGENTES.design.ferramentas, aprovadas: ['imagem_gerar'],
  });
  assert.equal(r.ok, false);
  assert.match(r.resumo || r.erro, /projeto não encontrado/);
});

test('1.85.0 · imagem_gerar: o pedido é a geração da Mídia, e o resultado não traz bytes', async () => {
  const criados = [];
  const repo = {
    projetos: { byId: async () => ({ id: 'p1', name: 'Café Central' }) },
    geracoes: {
      porChave: async () => null,
      contarDesde: async () => 0, contarDoProjetoDesde: async () => 0, contarActivas: async () => 0,
      criar: async (g) => { criados.push(g); return { id: 'g1', ...g }; },
    },
    atividade: { add: async () => null },
  };
  const r = await executar('imagem_gerar', { projeto_id: 'p1', prompt: 'uma chávena de café na mesa de madeira' }, {
    repo, agente: 'design', permitidas: AGENTES.design.ferramentas, aprovadas: ['imagem_gerar'], env: {},
  });
  assert.equal(r.ok, true, r.erro || r.resumo);
  assert.match(r.resumo, /ainda a aguardar geração/, 'diz que a imagem ainda não existe');
  assert.equal(r.dados.geracao_id, 'g1');
  assert.ok(JSON.stringify(r).length < 2000, 'o resultado é grande: pode ter bytes lá dentro');
  assert.equal(criados.length, 1, 'não criou exatamente um pedido');
  assert.equal(criados[0].tipo, 'imagem');
});

test('1.85.0 · ferramentas novas declaradas com o esquema que o modelo recebe', () => {
  for (const id of ['web_pesquisar', 'web_ler', 'imagem_gerar']) {
    assert.equal(FERRAMENTAS[id].parametros.type, 'object', id);
    assert.equal(typeof FERRAMENTAS[id].executar, 'function', id);
    assert.ok(FERRAMENTAS[id].descricao.length > 20, id);
  }
});
