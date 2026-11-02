/* ===========================================================================
   1.61.0 · AS EXECUÇÕES NO ECRÃ (2 nov 2026)

   `execucao.test.mjs` prova as contas e `ia.test.mjs` a pausa/cancelamento no
   orquestrador. Este prova o que o dono vê e faz, contra `dist/mesa.html`:

     · a lista mostra os cinco estados por palavras e o número real do id;
     · o detalhe mostra o que o passo recebeu, as acções que correu e o que
       voltou — e o erro ao lado, não no lugar do resultado;
     · «Repetir» e «Parar» só aparecem quando são verdade (e, quando não são,
       dizem porquê);
     · aprovar exige nome e fica escrito com hora; recusar fecha com motivo;
     · o custo sem preço diz «desconhecido», nunca 0,00 €;
     · a barra de uma mão mostra uma execução parada e abre-a.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');
const AGORA = Date.now();
const iso = (min) => new Date(AGORA - min * 60000).toISOString();

const RUN_ESPERA = {
  id: 'a3f19c88-aaaa-4bbb-8ccc-000000000001',
  objetivo: 'Apagar a receita antiga da Clínica Aurora',
  estado: 'aguarda_aprovacao', criado: iso(24), fim: null,
  agente: 'backend', modelo: 'qwen3', fornecedor: 'ovh',
  pendente: { ordem: 2, agente: 'backend', ferramenta: 'receita_apagar', resumo: '«receita_apagar» é destrutiva e pede a tua autorização antes de correr' },
  autorizacoes: [],
};

const RUN_FALHOU = {
  id: 'b4e28d99-bbbb-4ccc-8ddd-000000000002',
  objetivo: 'Preparar a proposta para o Café Central',
  estado: 'falhou', criado: iso(180), fim: iso(175),
  erro: 'o passo 2 falhou: o fornecedor não respondeu (timeout)',
  autorizacoes: [{ por: 'Valdimiro', em: iso(178), o_que: 'receita_apagar', motivo: 'é lixo', decisao: 'aprovada' }],
  cancelamento: { pedido: true, por: 'Valdimiro', em: iso(176), efectivo: true },
  custo_centimos: 0, tokens_in: 1200, tokens_out: 300,
};

const RUN_CONCLUIDO = {
  id: 'c5f39e00-cccc-4ddd-8eee-000000000003',
  objetivo: 'Organizar os leads de Coimbra',
  estado: 'concluido', criado: iso(60), fim: iso(55),
  revisao: { decisao: 'aprovado' }, custo_centimos: 5, tokens_in: 900, tokens_out: 200,
};

const PASSOS = [
  {
    id: 's1', ordem: 1, agente: 'research', titulo: 'Ver o que já existe', estado: 'concluido',
    entrada: 'resume a mesa e diz o que há', saida: 'Há 3 leads e 1 projeto.',
    duracao_ms: 2400, criado: iso(23),
    ferramentas: [{ nome: 'mesa_resumo', ok: true, resumo: '3 leads · 1 projeto', argumentos: { limite: 5 } }],
  },
  {
    id: 's2', ordem: 2, agente: 'backend', titulo: 'Apagar a receita', estado: 'aguarda_aprovacao',
    entrada: 'apaga a receita rec_1', saida: null, duracao_ms: 800, criado: iso(22),
    erro: '«receita_apagar» precisa de aprovação humana',
    ferramentas: [{ nome: 'receita_apagar', ok: false, precisaAprovacao: true, argumentos: { id: 'rec_1' } }],
  },
];

const DETALHE_ESPERA = {
  run: RUN_ESPERA, passos: PASSOS,
  visivel: { id: 'a_espera', rotulo: 'À espera de aprovação', curto: 'à espera', cor: '#b26a00', tecnico: 'aguarda_aprovacao', activo: true, fechado: false, porque: RUN_ESPERA.pendente.resumo },
  lidos: [], registo: [], autorizacoes: [], resumo: {},
  recuperacao: {
    necessaria: true, porque: RUN_ESPERA.pendente.resumo,
    opcoes: [
      { id: 'aprovar', rotulo: 'Aprovar e continuar', accao: 'run-aprovar', porque: 'a acção corre com o teu nome no registo' },
      { id: 'recusar', rotulo: 'Recusar', accao: 'run-recusar', porque: 'a execução fecha cancelada' },
    ],
  },
  accoes: { cancelar: { sim: true, porque: 'verificado entre passos' }, repetir: { sim: false, porque: 'ainda não fechou' }, aprovar: { sim: true, porque: 'há uma acção à espera' } },
};

const DETALHE_FALHOU = {
  run: RUN_FALHOU,
  passos: [
    { ...PASSOS[0], criado: iso(179) },
    { id: 's2', ordem: 2, agente: 'backend', titulo: 'Apagar a receita', estado: 'falhou', entrada: 'apaga a receita', saida: '', erro: 'timeout do fornecedor', duracao_ms: 12000, criado: iso(177), ferramentas: [] },
  ],
  visivel: { id: 'falhou', rotulo: 'Falhou', cor: '#b3261e', tecnico: 'falhou', activo: false, fechado: true, porque: 'o passo 2 falhou: timeout' },
  registo: [], autorizacoes: [], resumo: {},
  recuperacao: {
    necessaria: true, porque: 'o passo 2 («Apagar a receita») falhou: timeout do fornecedor',
    opcoes: [
      { id: 'retomar', rotulo: 'Continuar do passo falhado', accao: 'run-retomar', porque: 'os passos concluídos não se repetem' },
      { id: 'repetir', rotulo: 'Correr tudo outra vez', accao: 'run-repetir', porque: 'abre uma execução nova' },
    ],
  },
  accoes: { cancelar: { sim: false, porque: 'já fechou (falhou)' }, repetir: { sim: true, porque: 'abre uma execução nova' }, aprovar: { sim: false, porque: 'já fechou' } },
};

const LISTA = { runs: [RUN_ESPERA, RUN_FALHOU, RUN_CONCLUIDO] };

async function abrir(rota = '#/execucoes', extra = {}) {
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${rota}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.prompt = () => 'não apagar nada hoje';
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        if (u.includes('/api/rpc')) {
          const b = JSON.parse(opt.body || '{}');
          caminho = b.caminho; pedidos.push({ caminho, metodo: b.metodo, corpo: b.corpo });
        } else caminho = new URL(u, 'https://mesa.test').pathname;
        const rota = caminho.replace(/^\/api/, '').split('?')[0];
        const ok = (c) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) });
        const semQuery = (r) => r;
        if (extra[rota]) { const r = extra[rota]; return ok(typeof r === 'function' ? r(opt) : r); }
        const fixo = {
          '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: { admin: true, read: true, write: true, approve: true } },
          '/ops/summary': { leads: { total: 0 }, projetos: { total: 0 }, custos: {} },
          '/ops/today': { decidir: [] }, '/ops/leads': { leads: [] },
          '/ops/messages': { messages: [] }, '/ops/projetos': { projetos: [], tipos: [] },
          '/ops/clientes': { clientes: [], activo: null },
          '/ops/saldo': { janela: { dias: 90 }, receitaCentimos: 0, custoCentimos: 0, margemCentimos: 0, contaAVista: { chamadas: 0, linhas: [], desconhecidas: 0 } },
          '/ops/tarefas': { tarefas: [], tipos: {}, departamentos: [] },
          '/ia/runs': LISTA,
          '/ia/runs/a3f19c88-aaaa-4bbb-8ccc-000000000001': DETALHE_ESPERA,
          '/ia/runs/b4e28d99-bbbb-4ccc-8ddd-000000000002': DETALHE_FALHOU,
        };
        return ok(semQuery(fixo[rota] ?? {}));
      };
    },
  });
  await new Promise((r) => setTimeout(r, 600));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { dom, doc, pedidos, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 200) => new Promise((r) => setTimeout(r, ms));

test('1 · a lista diz em que estado está cada execução, por palavras', async () => {
  const { doc, texto } = await abrir();
  const t = texto();
  assert.match(t, /Execuções/);
  assert.match(t, /À espera de aprovação/, 'a execução parada diz-se parada');
  assert.match(t, /Falhou/);
  assert.match(t, /Concluído/);
  assert.equal(doc.querySelectorAll('.run-card').length, 3);
  assert.match(t, /#a3f19c/, 'o número é o início real do id, não um contador inventado');
});

test('2 · a lista avisa o que está parado à espera de uma pessoa', async () => {
  const { texto } = await abrir();
  const t = texto();
  assert.match(t, /Parado à tua espera/);
  assert.match(t, /não avançam/);
});

test('3 · o detalhe mostra o que o passo recebeu, o que correu e o que voltou', async () => {
  const { doc, texto } = await abrir('#/execucao/a3f19c88-aaaa-4bbb-8ccc-000000000001');
  const t = texto();
  assert.match(t, /Execução #a3f19c/);
  assert.match(t, /Entrada · o que lhe foi pedido/);
  assert.match(t, /resume a mesa e diz o que há/);
  assert.match(t, /Acções · o que correu no servidor/);
  assert.match(t, /mesa_resumo/);
  assert.match(t, /3 leads · 1 projeto/);
  assert.match(t, /Resultado · o que voltou/);
  assert.match(t, /Há 3 leads e 1 projeto/);
  assert.match(t, /pediu aprovação humana — não correu/, 'a acção parada não se mostra como feita');
  assert.equal(doc.querySelectorAll('.run-step').length, 2);
});

test('4 · o detalhe diz quem autorizou, com hora e motivo', async () => {
  const { texto } = await abrir('#/execucao/b4e28d99-bbbb-4ccc-8ddd-000000000002');
  const t = texto();
  assert.match(t, /Quem autorizou/);
  assert.match(t, /Valdimiro/);
  assert.match(t, /receita_apagar/);
  assert.match(t, /é lixo/);
  assert.match(t, /Paragem efectiva/);
});

test('5 · um passo falhado mostra o erro ao lado, com recuperação do passo', async () => {
  const { doc, texto } = await abrir('#/execucao/b4e28d99-bbbb-4ccc-8ddd-000000000002');
  const t = texto();
  assert.match(t, /timeout do fornecedor/);
  assert.match(t, /Continuar do passo falhado/);
  const retomar = doc.querySelector('[data-act="run-retomar"]');
  assert.ok(retomar, 'há um botão para continuar do passo');
  assert.match(retomar.getAttribute('title'), /os passos concluídos não se repetem/, 'e diz o que faz');
});

test('6 · «Parar» está inactivo quando já fechou, e diz porquê', async () => {
  const { doc } = await abrir('#/execucao/b4e28d99-bbbb-4ccc-8ddd-000000000002');
  const parar = [...doc.querySelectorAll('.run-acts .btn')].find((b) => b.textContent.trim() === 'Parar');
  assert.ok(parar);
  assert.equal(parar.getAttribute('aria-disabled'), 'true');
  assert.match(parar.getAttribute('title'), /já fechou/);
  const repetir = [...doc.querySelectorAll('.run-acts .btn')].find((b) => b.textContent.trim() === 'Repetir');
  assert.equal(repetir.getAttribute('aria-disabled'), null, 'repetir pode: a execução fechou');
});

test('7 · «Repetir» está inactivo enquanto a execução ainda corre', async () => {
  const { doc } = await abrir('#/execucao/a3f19c88-aaaa-4bbb-8ccc-000000000001');
  const repetir = [...doc.querySelectorAll('.run-acts .btn')].find((b) => b.textContent.trim() === 'Repetir');
  assert.equal(repetir.getAttribute('aria-disabled'), 'true');
  assert.match(repetir.getAttribute('title'), /ainda não fechou/);
});

test('8 · aprovar pede nome, chama a rota certa e manda continuar', async () => {
  const { doc, pedidos } = await abrir('#/execucao/a3f19c88-aaaa-4bbb-8ccc-000000000001', {
    '/ia/runs/a3f19c88-aaaa-4bbb-8ccc-000000000001/aprovar': { ok: true, nota: 'a autorização fica com o teu nome', run: { ...RUN_ESPERA, estado: 'novo' } },
    '/ia/runs/a3f19c88-aaaa-4bbb-8ccc-000000000001/correr': { ok: true, run: { ...RUN_CONCLUIDO } },
  });
  const btn = doc.querySelector('[data-act="run-aprovar"]');
  assert.ok(btn, 'o botão de aprovar existe');
  btn.click();
  await esperar(400);
  const aprov = pedidos.find((p) => p.caminho.endsWith('/aprovar'));
  assert.ok(aprov, 'a aprovação foi pedida ao servidor');
  assert.equal(aprov.metodo, 'POST');
  assert.equal(aprov.corpo.por, 'Valdimiro', 'quem autoriza vai no corpo — sem nome não há histórico');
  assert.ok(pedidos.some((p) => p.caminho.endsWith('/correr')), 'depois de aprovar, a execução continua');
});

test('9 · recusar pergunta o motivo e envia-o no corpo', async () => {
  const { doc, pedidos } = await abrir('#/execucao/a3f19c88-aaaa-4bbb-8ccc-000000000001', {
    '/ia/runs/a3f19c88-aaaa-4bbb-8ccc-000000000001/recusar': { ok: true, nota: 'fecha com a razão escrita', run: { ...RUN_ESPERA, estado: 'cancelado' } },
  });
  const btn = doc.querySelector('[data-act="run-recusar"]');
  assert.ok(btn);
  btn.click();
  await esperar(300);
  const rec = pedidos.find((p) => p.caminho.endsWith('/recusar'));
  assert.ok(rec);
  assert.equal(rec.corpo.motivo, 'não apagar nada hoje');
  assert.equal(rec.corpo.por, 'Valdimiro');
});

test('10 · parar uma execução viva chama o cancelamento com o teu nome', async () => {
  const { doc, pedidos } = await abrir('#/execucao/a3f19c88-aaaa-4bbb-8ccc-000000000001', {
    '/ia/runs/a3f19c88-aaaa-4bbb-8ccc-000000000001/cancelar': { ok: true, nota: 'a paragem é verificada entre passos' },
  });
  const parar = [...doc.querySelectorAll('.run-acts .btn')].find((b) => b.textContent.trim() === 'Parar');
  assert.equal(parar.getAttribute('aria-disabled'), null);
  parar.click();
  await esperar(300);
  const c = pedidos.find((p) => p.caminho.endsWith('/cancelar'));
  assert.ok(c);
  assert.equal(c.corpo.por, 'Valdimiro');
});

test('11 · repetir abre uma ligação nova e mostra o aviso de duplicado', async () => {
  const { doc, pedidos } = await abrir('#/execucao/b4e28d99-bbbb-4ccc-8ddd-000000000002', {
    '/ia/runs/b4e28d99-bbbb-4ccc-8ddd-000000000002/repetir': { ok: true, repetida: false, run: { id: 'b4e28d99-bbbb-4ccc-8ddd-000000000002' }, nota: 'já estava aberta' },
  });
  const repetir = [...doc.querySelectorAll('.run-acts .btn')].find((b) => b.textContent.trim() === 'Repetir');
  repetir.click();
  await esperar(300);
  assert.ok(pedidos.some((p) => p.caminho.endsWith('/repetir')), 'a repetição foi pedida');
  const t = doc.body.textContent.replace(/\s+/g, ' ');
  assert.match(t, /já estava aberta/, 'o aviso diz que não se criaram duas');
});

test('12 · custo sem preço é «desconhecido», nunca 0,00 €', async () => {
  const { doc, texto } = await abrir('#/execucao/b4e28d99-bbbb-4ccc-8ddd-000000000002');
  const t = texto();
  assert.match(t, /desconhecido/);
  assert.match(t, /Zero seria uma mentira/);
  const ficha = doc.querySelector('.run-ficha').textContent.replace(/\s+/g, ' ');
  assert.match(ficha, /Custo\s*desconhecido/);
  assert.ok(!/0,00\s*€/.test(ficha), 'na ficha da execução não se mostra um custo medido quando não houve medição');
});

test('13 · a barra de uma mão mostra uma execução parada e abre-a', async () => {
  const { doc } = await abrir('#/hoje');
  const mobar = doc.querySelector('#mobar');
  assert.ok(mobar && !mobar.hidden, 'a barra aparece porque há uma execução à espera');
  const t = mobar.textContent.replace(/\s+/g, ' ');
  assert.match(t, /à tua espera/);
  assert.match(t, /Apagar a receita antiga/, 'a execução parada é a decisão da barra');
  const abrirBtn = mobar.querySelector('[data-act="run-abrir"]');
  assert.ok(abrirBtn, 'e há um botão para a abrir com o polegar');
  assert.equal(abrirBtn.getAttribute('data-id'), RUN_ESPERA.id);
});

test('14 · filtrar por «falhou» deixa só as que falharam', async () => {
  const { doc } = await abrir();
  const filtro = [...doc.querySelectorAll('[data-act="run-filtrar"]')].find((b) => b.getAttribute('data-id') === 'falhou');
  assert.ok(filtro);
  filtro.click();
  await esperar(120);
  const cartoes = doc.querySelectorAll('.run-card');
  assert.equal(cartoes.length, 1);
  assert.match(cartoes[0].textContent, /Falhou/);
});
