/* ===========================================================================
   1.63.0 · O ARRANQUE NO ECRÃ (4 nov 2026)

   `arranque.test.mjs` prova as contas. Este prova o que a pessoa vê e faz,
   contra `dist/mesa.html` (o ficheiro publicado):

     · sem contas, o ecrã da primeira conta diz o que falta na instalação —
       com a versão, a tabela que falta e os grupos por configurar;
     · a página do arranque (com sessão) mostra o NOME de cada variável e a
       acção concreta, e a peça que se resolve a seguir;
     · «Verificar outra vez» volta a ler e diz o que mudou — ou que nada mudou,
       com a razão mais provável (o redeploy);
     · quando o `/api/health` não responde (ou devolve HTML, como um servidor
       só de ficheiros), a vista diz «não sei» — nunca «está tudo bem»;
     · copiar a acção põe o texto à mão (e sem área de transferência, mostra-o).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');

const SAUDE_QUEBRADA = {
  ok: false, modo: 'base', base: 'dpfqageawguekdjbdwyt', faltam: ['orbita_faturas'], versao: '1.62.0',
  prontidao: { pronto: false, criticasEmFalta: ['Acesso'], essenciaisEmFalta: ['Correio', 'WhatsApp'] },
};

const SAUDE_BOA = {
  ok: true, modo: 'base', base: 'dpfqageawguekdjbdwyt', faltam: [], versao: '1.63.0',
  prontidao: { pronto: true, criticasEmFalta: [], essenciaisEmFalta: [] },
};

const PRONTIDAO = {
  pronto: false,
  grupos: [
    {
      id: 'acesso', nome: 'Acesso', critico: true, pronto: false,
      itens: [
        { nome: 'Token da API', pronto: false, variavel: 'ORBITA_API_TOKEN', porque: 'fecha `/api/*`: 32 caracteres ou mais' },
        { nome: 'Token de administração', pronto: true, variavel: 'ORBITA_ADMIN_TOKEN', porque: 'protege a página e a mesa' },
      ],
    },
    {
      id: 'correio', nome: 'Correio', critico: false, pronto: false,
      itens: [{ nome: 'Chave Resend', pronto: false, variavel: 'RESEND_API_KEY', porque: 'as mensagens não saem' }],
    },
  ],
};

const EU = {
  user: { id: 'u1', name: 'Valdimiro', email: 'v@orbita.pt', role: 'owner' },
  modo: 'base', perms: { admin: true, read: true, write: true, approve: true },
};

const PORTA = {
  status: 401,
  corpo: {
    error: 'entra', mode: 'sessao', primeiraContaPossivel: true,
    estado: { modo: 'sessao', descricao: 'esta instalação ainda não tem contas', primeiraContaPossivel: true, exigeToken: true },
  },
};

/**
 * Abre a mesa com um `fetch` de mentira.
 * `saudes` é a fila de respostas do `/api/health` (uma por leitura); a última
 * repete-se. `cru` devolve HTML em vez de JSON, como um servidor de ficheiros.
 */
async function abrir({ hash = '#/hoje', sessao = false, saudes = [SAUDE_QUEBRADA], prontidao = PRONTIDAO, cru = false, setups = [] } = {}) {
  const leituras = [];
  const pedidosSetup = [];
  let i = 0;
  let is = 0;
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${hash}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        /* 1.64.0 · o /api/setup passa a ser chamado pelo cartão do esquema */
        if (u.includes('/api/setup')) {
          const corpo = JSON.parse(opt.body || '{}');
          pedidosSetup.push({ metodo: opt.method || 'GET', ...corpo });
          const r = setups[Math.min(is, Math.max(0, setups.length - 1))] || { status: 404, corpo: { error: 'não existe' } };
          is += 1;
          return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo };
        }
        if (u.includes('/api/health')) {
          const corpo = saudes[Math.min(i, saudes.length - 1)];
          i += 1;
          leituras.push(corpo);
          if (cru) return { ok: true, status: 200, json: async () => { throw new Error('não é JSON'); } };
          return { ok: !!corpo.ok, status: corpo.ok ? 200 : 503, json: async () => corpo };
        }
        const b = JSON.parse(opt.body || '{}');
        const caminho = b.caminho;
        if (caminho === '/auth/eu' && !sessao) return { ok: true, status: 200, json: async () => PORTA };
        if (caminho === '/sistema/prontidao' && prontidao) return { ok: true, status: 200, json: async () => ({ status: 200, corpo: prontidao }) };
        const fixo = {
          '/auth/eu': EU,
          '/ops/summary': { leads: { total: 0 }, projetos: { total: 0 }, custos: {} },
          '/ops/today': { decidir: [] }, '/ops/leads': { leads: [] },
          '/ops/messages': { messages: [] }, '/ops/projetos': { projetos: [], tipos: [] },
          '/ops/clientes': { clientes: [], activo: null },
          '/ops/saldo': { janela: { dias: 90 }, receitaCentimos: 0, custoCentimos: 0, margemCentimos: 0, contaAVista: { chamadas: 0, linhas: [], desconhecidas: 0 } },
          '/ops/tarefas': { tarefas: [], tipos: {}, departamentos: [] },
          '/ia/runs': { runs: [] },
        };
        const c = typeof fixo[caminho] === 'function' ? fixo[caminho]() : (fixo[caminho] ?? {});
        return { ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) };
      };
    },
  });
  await new Promise((r) => setTimeout(r, 700));
  const doc = dom.window.document;
  /* o bundle inteiro vive num <script>: se ficasse no texto, qualquer asserção
     sobre uma variável casaria com o código em vez de com o ecrã */
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { dom, doc, w: dom.window, leituras, pedidosSetup, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 500) => new Promise((r) => setTimeout(r, ms));

test('1 · sem contas, o ecrã da primeira conta diz o que falta na instalação', async () => {
  const { doc, texto } = await abrir({ saudes: [SAUDE_QUEBRADA] });
  const t = texto();
  /* 1.69.0 · o título do ecrã mudou com a entrada nova: já não se «cria a
     primeira conta» — entra-se como dono, por GitHub, Google ou código. */
  assert.match(t, /Entrar como dono/);
  assert.match(t, /O que falta nesta instalação/);
  assert.match(t, /versão 1\.62\.0/);
  assert.match(t, /Falta a tabela orbita_faturas/);
  assert.match(t, /Acesso por configurar/);
  assert.match(t, /orbita_1_56_0\.sql/, 'a migração em falta diz o ficheiro a aplicar');
  assert.ok(doc.querySelector('#lgEmail'), 'o formulário continua a existir: o cartão não tapa a porta');
  assert.ok(doc.querySelector('[data-act="verificar-arranque"]'), 'há um botão para voltar a ler');
});

test('2 · um servidor sem /api (devolve HTML) não vira «está tudo bem»', async () => {
  const { texto, leituras } = await abrir({ saudes: [SAUDE_QUEBRADA], cru: true });
  const t = texto();
  assert.equal(leituras.length, 1, 'tentou ler a saúde');
  assert.match(t, /leitura limitada/);
  assert.match(t, /não sei dizer o que falta/i);
  assert.doesNotMatch(t, /Está tudo no sítio/, 'sem leitura não se anuncia saúde');
});

test('3 · com sessão, a página do arranque mostra o nome de cada variável e o passo a seguir', async () => {
  const { doc, texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA] });
  const t = texto();
  assert.match(t, /Arranque/);
  assert.match(t, /a seguir/);
  assert.match(t, /Falta a tabela orbita_faturas/);
  assert.match(t, /ORBITA_API_TOKEN/, 'o nome da variável aparece com sessão');
  assert.match(t, /RESEND_API_KEY/);
  assert.match(t, /Vercel → Project → Settings → Environment Variables/);
  assert.match(t, /Já está no sítio/);
  assert.match(t, /ORBITA_ADMIN_TOKEN/, 'o que já está também se nomeia');
  assert.match(t, /Redeploy/);
  assert.ok(doc.querySelector('[data-act="arranque-copiar"]'), 'a acção tem o texto à mão de copiar');
});

test('4 · «verificar outra vez» diz o que ficou resolvido', async () => {
  const { doc, w, texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA, SAUDE_BOA] });
  const antes = texto();
  assert.match(antes, /Falta a tabela orbita_faturas/);
  doc.querySelector('[data-act="verificar-arranque"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar();
  const t = texto();
  assert.match(t, /Resolvido: Falta a tabela orbita_faturas/);
  assert.doesNotMatch(t, /Nada mudou/);
});

test('5 · «verificar outra vez» sem mudanças diz que nada mudou — e manda fazer o redeploy', async () => {
  const { doc, w, texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA, SAUDE_QUEBRADA] });
  doc.querySelector('[data-act="verificar-arranque"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar();
  const t = texto();
  assert.match(t, /Nada mudou desde a última leitura/);
  assert.match(t, /Redeploy/);
});

test('6 · copiar a acção põe o texto à mão (e sem área de transferência, mostra-o)', async () => {
  const { doc, w, texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA] });
  const botao = doc.querySelector('[data-act="arranque-copiar"]');
  assert.ok(botao, 'há um botão de copiar');
  const valor = botao.dataset.valor;
  assert.match(valor, /Aplicar o esquema/, 'copia-se a acção, não um endereço com o segredo dentro');
  botao.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(200);
  assert.match(texto(), /Copiado: |Não consegui copiar\. O texto é:/);
  assert.match(texto(), /orbita_1_56_0\.sql/, 'o texto copiado aparece inteiro quando não há área de transferência');
});

test('7 · uma instalação pronta diz que está pronta — e não inventa trabalho', async () => {
  const { texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_BOA], prontidao: { pronto: true, grupos: [] } });
  const t = texto();
  assert.match(t, /Está pronto|Está tudo no sítio/);
  assert.doesNotMatch(t, /Falta a tabela/);
});

test('8 · a rota do arranque não é uma rota inventada: o endereço #\/arranque abre a página', async () => {
  const { texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA] });
  assert.match(texto(), /lido (agora|há \d+ min)/);
});

/* ---------- 1.64.0 · aplicar o esquema a partir da página ---------- */

const AUDITORIA_FALTA = {
  status: 200,
  corpo: {
    ok: false, modo: 'leitura', versao: '1.64.0',
    tabelas: ['orbita_leads', 'orbita_contas'], faltamTabelas: ['orbita_faturas'], faltamColunas: {},
  },
};

const APLICADO = {
  status: 200,
  corpo: { ok: true, aplicados: ['orbita_mesa.sql', 'orbita_1_56_0.sql'], faltam: [], tabelas: ['orbita_faturas'] },
};

test('9 · o token colado na página vai no corpo do pedido — e a leitura mostra o que falta', async () => {
  const { doc, w, pedidosSetup, texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA], setups: [AUDITORIA_FALTA] });
  const campo = doc.querySelector('#esqToken');
  assert.ok(campo, 'há um campo para o SETUP_TOKEN');
  campo.value = 'segredo-que-nao-vai-no-url';
  doc.querySelector('[data-act="esquema-ler"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar();
  assert.equal(pedidosSetup.length, 1);
  assert.equal(pedidosSetup[0].metodo, 'POST', 'o token não vai no endereço');
  assert.equal(pedidosSetup[0].token, 'segredo-que-nao-vai-no-url');
  assert.equal(pedidosSetup[0].ler, true);
  assert.match(texto(), /Faltam 1 tabela da mesa \(orbita_faturas\)/);
});

test('10 · aplicar pergunta primeiro e, depois, releitura da saúde diz o que mudou', async () => {
  const { doc, w, pedidosSetup, texto } = await abrir({
    hash: '#/arranque', sessao: true,
    saudes: [SAUDE_QUEBRADA, SAUDE_BOA],
    setups: [AUDITORIA_FALTA, APLICADO],
  });
  doc.querySelector('#esqToken').value = 'token-bom';
  doc.querySelector('[data-act="esquema-ler"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar();
  assert.equal(pedidosSetup.length, 1);

  doc.querySelector('[data-act="esquema-aplicar"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(150);
  /* a pergunta é a da casa, não o `confirm` do browser */
  const sim = doc.querySelector('[data-cf-sim]');
  assert.ok(sim, 'aplicar pergunta antes de mexer na base');
  assert.equal(pedidosSetup.length, 1, 'nada foi aplicado antes da resposta');
  sim.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(700);
  assert.equal(pedidosSetup.length, 2);
  assert.equal(pedidosSetup[1].ler, false);
  assert.equal(pedidosSetup[1].token, 'token-bom');
  const t = texto();
  assert.match(t, /2 ficheiros/, 'diz o que aplicou');
  assert.match(t, /Resolvido: Falta a tabela orbita_faturas/, 'quem prova o depois é a saúde');
});

test('11 · sem token não se faz pedido nenhum — pede-se o token', async () => {
  const { doc, w, pedidosSetup, texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA] });
  doc.querySelector('[data-act="esquema-ler"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(200);
  assert.equal(pedidosSetup.length, 0);
  assert.match(texto(), /Cola o SETUP_TOKEN primeiro/);
});

test('12 · token recusado diz que é o token, e não fica guardado para o botão seguinte', async () => {
  const { doc, w, pedidosSetup, texto } = await abrir({
    hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA],
    setups: [{ status: 404, corpo: { error: 'não existe' } }],
  });
  doc.querySelector('#esqToken').value = 'token-errado';
  doc.querySelector('[data-act="esquema-ler"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar();
  assert.match(texto(), /O token não é o desta instalação/);
  /* um segundo clique sem voltar a colar não pode reutilizar o token recusado */
  doc.querySelector('[data-act="esquema-ler"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(200);
  assert.equal(pedidosSetup.length, 1);
  assert.equal(pedidosSetup[0].token, 'token-errado');
});

test('13 · um segredo que o dono inventa gera-se na página, com o mínimo do servidor', async () => {
  const { doc, w, texto } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA] });
  const botao = doc.querySelector('[data-act="arranque-gerar"][data-var="ORBITA_API_TOKEN"]');
  assert.ok(botao, 'ORBITA_API_TOKEN está em falta e não vem de fornecedor nenhum: tem de se poder gerar');
  assert.equal(doc.querySelector('[data-act="arranque-gerar"][data-var="ORBITA_ADMIN_TOKEN"]'), null,
    'o que já está no sítio não oferece «gerar»');
  botao.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar();
  const valor = doc.querySelector('#gen-ORBITA_API_TOKEN');
  assert.ok(valor, 'o valor gerado aparece para copiar');
  assert.ok(valor.textContent.trim().length >= 32, 'com os 32 caracteres que o servidor exige');
  assert.match(valor.textContent.trim(), /^[0-9a-f]+$/, 'hexadecimal: nada que se perca ao copiar');
  assert.match(texto(), /Copia agora/, 'diz que aparece uma vez');
  assert.match(texto(), /Settings → Environment Variables/, 'diz onde colar');
  assert.match(texto(), /Redeploy/, 'e que sem redeploy não chega à função');
});

test('14 · o valor gerado vive na página e não é guardado em lado nenhum', async () => {
  const { doc, w } = await abrir({ hash: '#/arranque', sessao: true, saudes: [SAUDE_QUEBRADA] });
  doc.querySelector('[data-act="arranque-gerar"][data-var="ORBITA_API_TOKEN"]')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar();
  const valor = doc.querySelector('#gen-ORBITA_API_TOKEN').textContent.trim();
  const guardado = [];
  for (let i = 0; i < w.localStorage.length; i += 1) {
    const k = w.localStorage.key(i);
    guardado.push([k, w.localStorage.getItem(k)]);
  }
  assert.equal(guardado.some(([, v]) => String(v).includes(valor)), false,
    'um token não pode acabar no localStorage');
  assert.equal(w.location.href.includes(valor), false, 'nem no endereço');
  assert.equal(doc.documentElement.innerHTML.split(valor).length - 1 >= 1, true, 'mas está à vista para copiar');
});
