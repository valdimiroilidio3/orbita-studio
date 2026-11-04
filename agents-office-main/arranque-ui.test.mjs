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
async function abrir({ hash = '#/hoje', sessao = false, saudes = [SAUDE_QUEBRADA], prontidao = PRONTIDAO, cru = false } = {}) {
  const leituras = [];
  let i = 0;
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${hash}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
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
  return { dom, doc, w: dom.window, leituras, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 500) => new Promise((r) => setTimeout(r, ms));

test('1 · sem contas, o ecrã da primeira conta diz o que falta na instalação', async () => {
  const { doc, texto } = await abrir({ saudes: [SAUDE_QUEBRADA] });
  const t = texto();
  assert.match(t, /Criar a primeira conta/);
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
  assert.match(valor, /\/api\/setup\?token=/);
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
