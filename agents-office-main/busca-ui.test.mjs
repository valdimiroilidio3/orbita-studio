/* ===========================================================================
   1.62.0 · A BUSCA AO ALCANCE DO POLEGAR, NO ECRÃ (2 nov 2026)

   `busca.test.mjs` prova as contas. Este prova o que se vê e o que se faz contra
   `dist/mesa.html` (o ficheiro publicado):

     · há uma porta para a pesquisa no telemóvel (o Ctrl K não é uma porta num
       telefone);
     · a folha abre, escreve-se, procura o mesmo endpoint e mostra cartões;
     · os recentes são os que se pesquisaram — não sugestões inventadas;
     · criar uma tarefa a partir de um lead leva o alvo, o tipo certo e vai «à
       espera de aprovação»; sem alvo, diz o que falta em vez de criar nada;
     · fechar (X, Esc, fundo) fecha mesmo.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');

const PESQUISA = {
  query: 'clinica',
  total: 2,
  nota: 'resultados reais, sem estimativas',
  grupos: [
    { label: 'Leads', itens: [{ id: 'l1', name: 'Clínica Aurora', city: 'Coimbra · dentária', route: '#/lead/l1' }] },
    { label: 'Projetos', itens: [{ id: 'p1', name: 'Site da Clínica', client: 'Aurora · landing', route: '#/projeto/p1' }] },
  ],
};

const PROJETOS = { projetos: [], tipos: [] };

async function abrir(extra = {}) {
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: 'https://mesa.test/#/hoje', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        if (u.includes('/api/rpc')) { const b = JSON.parse(opt.body || '{}'); caminho = b.caminho; pedidos.push({ caminho, metodo: b.metodo, corpo: b.corpo }); }
        else caminho = new URL(u, 'https://mesa.test').pathname;
        const rota = caminho.replace(/^\/api/, '').split('?')[0];
        const ok = (c) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) });
        if (extra[rota]) {
          const r = typeof extra[rota] === 'function' ? extra[rota](opt) : extra[rota];
          if (r && r.__raw) return r.__raw;   // uma resposta HTTP crua (avaria a sério)
          return ok(r);
        }
        const fixo = {
          '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: { admin: true, read: true, write: true, approve: true } },
          '/ops/summary': { leads: { total: 0 }, projetos: { total: 0 }, custos: {} },
          '/ops/today': { decidir: [] }, '/ops/leads': { leads: [] },
          '/ops/messages': { messages: [] }, '/ops/projetos': PROJETOS,
          '/ops/clientes': { clientes: [], activo: null },
          '/ops/saldo': { janela: { dias: 90 }, receitaCentimos: 0, custoCentimos: 0, margemCentimos: 0, contaAVista: { chamadas: 0, linhas: [], desconhecidas: 0 } },
          '/ops/tarefas': { tarefas: [], tipos: {}, departamentos: [] },
          '/ops/pesquisa': PESQUISA,
          '/ia/runs': { runs: [] },
        };
        return ok(fixo[rota] ?? {});
      };
    },
  });
  await new Promise((r) => setTimeout(r, 600));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { dom, doc, pedidos, w: dom.window, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function escrever(w, doc, valor) {
  const campo = doc.querySelector('#buscaQ');
  assert.ok(campo, 'o campo da folha existe');
  campo.value = valor;
  campo.dispatchEvent(new w.Event('input', { bubbles: true }));
}

test('1 · há uma porta para a pesquisa no telemóvel (o Ctrl K sozinho não chega)', async () => {
  const { doc } = await abrir();
  const abrirBtn = doc.querySelector('[data-act="busca-abrir"]');
  assert.ok(abrirBtn, 'há um botão de pesquisa no cabeçalho');
  assert.equal(abrirBtn.getAttribute('aria-label'), 'pesquisar');
  const folha = doc.querySelector('#buscaSheet');
  assert.ok(folha);
  assert.equal(folha.hidden, true, 'a folha começa fechada');
});

test('2 · um toque abre a folha com o campo pronto a escrever', async () => {
  const { doc, w } = await abrir();
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(120);
  const folha = doc.querySelector('#buscaSheet');
  assert.equal(folha.hidden, false);
  assert.equal(folha.getAttribute('role'), 'dialog');
  assert.equal(folha.getAttribute('aria-modal'), 'true');
  assert.ok(doc.querySelector('#buscaQ'), 'o campo existe');
  assert.equal(doc.activeElement?.id, 'buscaQ', 'o foco vai para o campo');
  void w;
});

test('3 · escrever procura o mesmo endpoint e mostra cartões por grupo', async () => {
  const { doc, pedidos, w, texto } = await abrir();
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  escrever(w, doc, 'clinica');
  await esperar(600);
  const pedido = pedidos.find((p) => p.caminho.startsWith('/ops/pesquisa'));
  assert.ok(pedido, 'a pesquisa foi pedida');
  assert.match(decodeURIComponent(pedido.caminho), /q=clinica/);
  const t = texto();
  assert.match(t, /Clínica Aurora/);
  assert.match(t, /Site da Clínica/);
  assert.equal(doc.querySelectorAll('.busca-item').length, 2);
  assert.ok(!/nada corresponde/.test(t));
});

test('4 · uma consulta curta não faz pedido e diz o mínimo', async () => {
  const { doc, pedidos, w, texto } = await abrir();
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  escrever(w, doc, 'c');
  await esperar(400);
  assert.equal(pedidos.filter((p) => p.caminho.startsWith('/ops/pesquisa')).length, 0, 'com uma letra não se procura');
  assert.match(texto(), /pelo menos 2 letras/);
});

test('5 · nada encontrado diz-se, em vez de uma lista vazia', async () => {
  const vazio = { query: 'zzz', total: 0, grupos: [], nota: 'nada corresponde — nem leads, nem projetos, nem tarefas, nem mensagens' };
  const { doc, w, texto } = await abrir({ '/ops/pesquisa': vazio });
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  escrever(w, doc, 'zzz');
  await esperar(600);
  const t = texto();
  assert.match(t, /nada corresponde/);
  assert.equal(doc.querySelectorAll('.busca-item').length, 0);
});

test('6 · um erro da pesquisa aparece escrito, não como «sem resultados»', async () => {
  /* 500 com a frase do servidor: é assim que uma avaria chega à mesa (o
     `decidirResposta` distingue isto de «rota ausente» e não cai no local) */
  const { doc, w, texto } = await abrir({
    '/ops/pesquisa': () => ({
      __raw: { ok: false, status: 500, json: async () => ({ error: 'a base não respondeu' }) },
    }),
  });
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  escrever(w, doc, 'clinica');
  await esperar(700);
  assert.match(texto(), /a base não respondeu/);
});

test('7 · criar uma tarefa a partir de um lead leva o alvo e o tipo certo', async () => {
  const { doc, pedidos, w } = await abrir({
    '/ops/tarefas': { tarefa: { id: 't1', state: 'awaiting_approval' } },
  });
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  escrever(w, doc, 'investigar clinica');
  await esperar(600);
  const btn = doc.querySelector('.busca-item [data-act="busca-tarefa"]');
  assert.ok(btn, 'cada resultado com lead/projeto oferece uma tarefa');
  btn.click();
  await esperar(400);
  const criada = pedidos.find((p) => p.caminho === '/ops/tarefas' && p.metodo === 'POST');
  assert.ok(criada, 'a tarefa foi criada no servidor');
  assert.equal(criada.corpo.kind, 'investigar', 'o verbo escrito manda no tipo');
  assert.equal(criada.corpo.entityId, 'l1');
  assert.equal(criada.corpo.entidade, 'lead');
  assert.equal(criada.corpo.aprovacao, true, 'uma pesquisa não é uma ordem: fica à espera de aprovação');
  assert.equal(criada.corpo.correr, true);
});

test('8 · sem resultado com alvo, não se cria uma tarefa vazia', async () => {
  const semAlvo = { query: 'fechar', total: 1, grupos: [{ label: 'Tarefas', itens: [{ id: 't9', title: 'Fechar o site', route: '#/tarefas' }] }] };
  const { doc, pedidos, w, texto } = await abrir({ '/ops/pesquisa': semAlvo });
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  escrever(w, doc, 'fechar site');
  await esperar(600);
  assert.equal(doc.querySelectorAll('.busca-item [data-act="busca-tarefa"]').length, 0, 'sem lead nem projeto não há botão de tarefa');
  const rodape = [...doc.querySelectorAll('.busca-rodape [data-act="busca-tarefa"]')][0];
  assert.equal(rodape.getAttribute('aria-disabled'), 'true');
  assert.match(rodape.getAttribute('title'), /precisa de um lead ou projeto/);
  rodape.click();
  await esperar(200);
  assert.equal(pedidos.filter((p) => p.caminho === '/ops/tarefas' && p.metodo === 'POST').length, 0);
  assert.match(texto(), /escolhe primeiro|precisa de um alvo/);
});

test('9 · uma consulta pesquisada fica nos recentes e volta a um toque', async () => {
  const { doc, w, texto } = await abrir();
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  escrever(w, doc, 'clinica');
  await esperar(600);
  assert.ok(w.localStorage.getItem('orbita.busca.recentes'), 'os recentes ficam guardados neste browser');
  const campo = doc.querySelector('#buscaQ');
  campo.value = '';
  campo.dispatchEvent(new w.Event('input', { bubbles: true }));
  await esperar(200);
  const chip = doc.querySelector('[data-act="busca-recente"]');
  assert.ok(chip, 'o recente aparece quando o campo está vazio');
  assert.equal(chip.textContent.trim(), 'clinica');
  chip.click();
  await esperar(700);
  assert.match(texto(), /Clínica Aurora/, 'o recente volta a trazer resultados');
});

test('10 · o X, o Esc e o fundo fecham a folha', async () => {
  const { doc, w } = await abrir();
  const abrirFolha = () => doc.querySelector('[data-act="busca-abrir"]').click();
  abrirFolha();
  await esperar(100);
  doc.querySelector('[data-act="busca-fechar"]').click();
  await esperar(100);
  assert.equal(doc.querySelector('#buscaSheet').hidden, true);

  abrirFolha();
  await esperar(100);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await esperar(100);
  assert.equal(doc.querySelector('#buscaSheet').hidden, true);

  abrirFolha();
  await esperar(100);
  doc.querySelector('#buscaSheet').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(100);
  assert.equal(doc.querySelector('#buscaSheet').hidden, true);
});

test('11 · «Nova tarefa» na folha leva ao formulário completo', async () => {
  const { doc } = await abrir();
  doc.querySelector('[data-act="busca-abrir"]').click();
  await esperar(100);
  const btn = doc.querySelector('.busca-rodape [data-act="tarefa-rapida"]');
  assert.ok(btn);
  btn.click();
  await esperar(500);
  assert.equal(doc.querySelector('#buscaSheet').hidden, true, 'a folha fecha para o formulário não ficar por baixo');
});
