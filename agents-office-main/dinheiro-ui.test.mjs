/* ===========================================================================
   1.55.0 · O SALDO NO ECRÃ, COM A CONTA À VISTA

   Os testes de `dinheiro.test.mjs` provam os números. Este prova o que o dono lê:
   `dist/mesa.html` num DOM, com `/api/rpc` a responder como em produção.

   O que se exige do ecrã:
     · a conta à vista (tokens × preço) e o câmbio usado, escritos;
     · um fornecedor que custou não aparece «a zero»;
     · chamadas sem preço aparecem como desconhecidas e **não** somadas em
       silêncio;
     · a margem não é a receita quando há custo.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');

const SALDO = {
  janela: { dias: 90 },
  receitaCentimos: 25050, custoCentimos: 47, margemCentimos: 25003,
  porCampanha: [{ campanha: 'Coimbra', cents: 25050 }],
  custosPorFornecedor: [{
    provider: 'groq', fornecedor: 'groq', fornecedorNome: 'Groq', chamadas: 10, tokens: 800000,
    microUsd: 512000, cents: 47, centimos: 47, desconhecido: false, preco: [0.59, 0.79],
  }],
  unitarios: { custoPorLead: 47 },
  custosPorProjeto: [{ id: 'p_1', nome: 'Site da Clínica', tarefas: 5, microUsd: 256000, centimos: 24 }],
  custosPorLead: [{ id: 'l_1', nome: 'Clínica do Mondego', tarefas: 5, microUsd: 256000, centimos: 24 }],
  tarefas: { total: 10, custoCentimos: 47, semCusto: 0 },
  midia: {
    geracoes: 2, microUsd: 20000, centimos: 2, desconhecidas: 0,
    porFornecedor: [{ fornecedor: 'pollinations', fornecedorNome: 'Pollinations', geracoes: 2, microUsd: 20000, centimos: 2, desconhecido: false }],
    nota: 'custo da mídia gerada: usa-se o valor real quando o fornecedor o devolve',
  },
  contaAVista: {
    linhas: [{
      fornecedor: 'groq', fornecedorNome: 'Groq', modelo: 'llama-3.3-70b-versatile',
      chamadas: 10, tokensIn: 600000, tokensOut: 200000, microUsd: 512000, centimos: 47,
      desconhecidas: 0, preco: [0.59, 0.79], fonte: 'catalogo',
    }],
    microUsd: 512000, centimos: 47, desconhecidas: 0, chamadas: 10,
    cambio: { taxa: 0.92, fonte: 'padrao', nota: 'valor de referência' },
    nota: 'preços do catálogo — é uma conta, não uma fatura',
  },
  semDados: { custo: null, receita: null, cambio: '1 USD = 0,92 € é um valor de referência' },
  entradas: [{ id: 'r_1', at: new Date().toISOString(), campaign: 'Coimbra', amount_cents: 25050 }],
};

const SALDO_DESCONHECIDO = {
  ...SALDO,
  custoCentimos: 0, margemCentimos: 25050,
  custosPorFornecedor: [{ provider: 'novo', fornecedor: 'novo', fornecedorNome: 'novo', chamadas: 1, tokens: 7000, microUsd: 0, cents: 0, desconhecido: true, preco: null }],
  contaAVista: {
    linhas: [{ fornecedor: 'novo', fornecedorNome: 'novo', modelo: 'secreto', chamadas: 1, tokensIn: 5000, tokensOut: 2000, microUsd: null, desconhecidas: 1, preco: null, fonte: 'ausente' }],
    microUsd: 0, centimos: 0, desconhecidas: 1, chamadas: 1,
    cambio: { taxa: 0.92, fonte: 'padrao', nota: 'valor de referência' },
    nota: 'preços do catálogo — é uma conta, não uma fatura',
  },
  tarefas: { total: 1, custoCentimos: 0, semCusto: 1 },
  custosPorProjeto: [], custosPorLead: [],
  semDados: { custo: 'Uma chamada ficou fora da soma: não há preço conhecido para novo/secreto.', receita: null, cambio: null },
};

async function abrirSaldo(saldo) {
  const dom = new JSDOM(HTML, {
    url: 'https://mesa.test/#/saldo', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        if (u.includes('/api/rpc')) { const b = JSON.parse(opt.body || '{}'); caminho = b.caminho; } else caminho = new URL(u, 'https://mesa.test').pathname;
        const rota = caminho.split('?')[0];
        const responder = (corpo) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo }) });
        if (rota === '/ops/saldo') return responder(saldo);
        const fixo = {
          '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: {} },
          '/ops/summary': { leads: { total: 1 }, projetos: { total: 1 }, custos: { apiCentimos: saldo.custoCentimos, chamadas: 1 } },
          '/ops/today': { decidir: [] }, '/ops/leads': { leads: [] }, '/ops/projetos': { projetos: [], tipos: [] },
          '/ops/messages': { messages: [] }, '/ops/clientes': { clientes: [], activo: null },
          '/ops/utilizadores': { utilizadores: [], papeis: [] }, '/ops/sessoes': { sessoes: [] },
        };
        return responder(fixo[rota] ?? {});
      };
    },
  });
  await new Promise((r) => setTimeout(r, 450));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return doc.body.textContent.replace(/\s+/g, ' ');
}

test('saldo no ecrã: conta à vista, preço, câmbio e margem verdadeira', async () => {
  const t = await abrirSaldo(SALDO);
  assert.match(t, /A conta à vista/);
  assert.match(t, /600 000 → 200 000/, 'os tokens que entraram na conta');
  assert.match(t, /0\.59 \/ 0\.79 USD por 1M tokens/, 'o preço aplicado');
  assert.match(t, /Groq/);
  assert.match(t, /0,92/, 'o câmbio usado está escrito');
  assert.match(t, /é uma conta, não uma fatura/);
  assert.match(t, /Custo por projeto[\s\S]*Site da Clínica/, 'o custo está atribuído ao projeto');
  assert.match(t, /10 tarefa\(s\)/, 'e às tarefas');
  assert.match(t, /Mídia gerada[\s\S]*Pollinations/, 'a mídia gerada também aparece no custo');
  assert.doesNotMatch(t, /margem[\s\S]{0,80}250,50\s€/, 'a margem não pode voltar a ser igual à receita');
});

test('saldo no ecrã: sem preço, o custo é «desconhecido» — não zero em silêncio', async () => {
  const t = await abrirSaldo(SALDO_DESCONHECIDO);
  assert.match(t, /fora da soma/);
  assert.match(t, /novo\/secreto/);
  assert.match(t, /sem preço/);
  assert.match(t, /desconhecido/);
  assert.match(t, /1 sem custo registado|1 tarefa\(s\) guardada\(s\), 1 sem custo registado/);
});
