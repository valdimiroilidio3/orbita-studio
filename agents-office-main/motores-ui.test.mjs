/* ===========================================================================
   1.60.0 · MOTORES, AUTONOMIA E O TELEMÓVEL NO ECRÃ (2 nov 2026)

   `motores.test.mjs` prova as contas e `api.test.mjs` a autonomia no servidor.
   Este prova o que o dono vê e faz, contra `dist/mesa.html` (o ficheiro que vai
   para produção):

     · a página Motores mostra o motor escolhido, o que ele sabe fazer, o estado
       de cada integração com a última verificação, e o custo real (ou
       «desconhecido», que é diferente de zero);
     · a autonomia mostra os casos e a taxa, e subir chama a rota certa com o
       tipo certo — sem inventar um nível;
     · as acções sensíveis dizem que exigem aprovação;
     · no telemóvel há um painel em cartões e uma barra de uma mão com a
       primeira decisão, que aprova mesmo.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');
const H = 3600 * 1000;

const ESTADO_IA = {
  fornecedores: [
    {
      id: 'groq', nome: 'Groq', configurado: true, estado: 'funcional', classe: 'api',
      ferramentas: null, limites: '30 pedidos/min · 14 400/dia', variavel: 'GROQ_API_KEY', chaveMascarada: 'gsk_…9f2',
      ultimoTeste: { ok: true, ms: 210, quando: new Date(Date.now() - 2 * H).toISOString() }, modelosNoCatalogo: 4,
    },
    { id: 'ovh', nome: 'OVH', configurado: true, estado: 'por_testar', classe: 'api', ferramentas: false, limites: 'sem limite declarado', ultimoTeste: null, modelosNoCatalogo: 3 },
    { id: 'anthropic', nome: 'Claude (API)', configurado: false, estado: 'sem_chave', classe: 'api', limites: 'não declarado', ultimoTeste: null, variavel: 'ANTHROPIC_API_KEY' },
  ],
  agentes: [
    { id: 'qa', numero: 4, nome: 'QA', papel: 'testes', ferramentas: ['ler', 'correr'], escolha: { fornecedor: 'ovh', modelo: 'qwen3' } },
    { id: 'research', numero: 2, nome: 'Research', papel: 'investigar', ferramentas: [], escolha: { fornecedor: 'groq', modelo: 'gpt-oss' } },
  ],
  ferramentas: [
    { id: 'apagar-receita', nome: 'Apagar receita', descricao: 'Apaga uma entrada de dinheiro.', destrutiva: true },
    { id: 'ler-site', nome: 'Ler site', descricao: 'Abre uma página.' },
  ],
  modo: 'base', pronto: true,
};

const USO = { resumo: [{ fornecedor: 'groq', pedidos: 6, ok: 5, erros: 1, latenciaMediaMs: 320, tokens: 900 }] };
const SALDO = {
  janela: { dias: 90 }, receitaCentimos: 0, custoCentimos: 1234, margemCentimos: -1234,
  contaAVista: { chamadas: 9, linhas: [], desconhecidas: 2, nota: 'preços do catálogo' }, semDados: {},
};
const AUTONOMIA = {
  ok: true,
  lista: [
    { escopo: 'email:geral', nivel: 'pedir_sempre', casos: 3, taxa: 1, podeSubir: false, autor: null, quando: null, motivo: null,
      porque: 'faltam 47 casos decididos à mão para poder subir (mínimo 50)' },
    { escopo: 'email:sem-site', nivel: 'proposto', casos: 64, taxa: 0.97, podeSubir: true,
      autor: 'valdimiro@exemplo.pt', quando: '2026-11-01T09:00:00.000Z', motivo: 'subiu com 64 casos e 97% aprovados',
      porque: 'há 64 casos com 97% aprovados' },
  ],
  resumo: { total: 2, autonomos: 0, propostos: 1, pedemSempre: 1 },
};

async function abrir(rota = '#/motores', extra = {}) {
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${rota}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        if (u.includes('/api/rpc')) { const b = JSON.parse(opt.body || '{}'); caminho = b.caminho; pedidos.push({ caminho, metodo: b.metodo, corpo: b.corpo }); }
        else caminho = new URL(u, 'https://mesa.test').pathname;
        const rota = caminho.replace(/^\/api/, '').split('?')[0];
        const ok = (c) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) });
        if (extra[rota]) { const r = extra[rota]; return ok(typeof r === 'function' ? r(opt) : r); }
        const fixo = {
          '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: { admin: true, read: true, write: true, approve: true } },
          '/ops/summary': { leads: { total: 0 }, projetos: { total: 0 }, custos: {} },
          '/ops/today': { decidir: [] }, '/ops/leads': { leads: [] },
          '/ops/messages': { messages: [] }, '/ops/projetos': { projetos: [], tipos: [] },
          '/ops/clientes': { clientes: [], activo: null }, '/ops/saldo': SALDO,
          '/ops/tarefas': { tarefas: [], tipos: {}, departamentos: [] },
          '/ia/estado': ESTADO_IA, '/ia/uso': USO, '/ops/autonomia': AUTONOMIA,
        };
        return ok(fixo[rota] ?? {});
      };
    },
  });
  await new Promise((r) => setTimeout(r, 600));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { dom, doc, pedidos, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 160) => new Promise((r) => setTimeout(r, ms));

test('1 · a página Motores diz o estado, a última verificação e as capacidades', async () => {
  const { doc, texto } = await abrir();
  const t = texto();
  assert.match(t, /Integrações e última verificação/);
  assert.match(t, /Groq/);
  assert.match(t, /verificado há 2 h/);
  assert.match(t, /nunca verificado/, 'o OVH não finge uma verificação');
  assert.match(t, /Por testar/);
  assert.match(t, /30 pedidos\/min/, 'os limites estão à vista');
  assert.match(t, /gsk_…9f2/, 'a chave aparece mascarada');
  assert.ok(!t.includes('GROQ_API_KEY=') && !/gsk_[A-Za-z0-9]{10,}/.test(t), 'a chave em claro não está no ecrã');
  assert.match(t, /por declarar: Ferramentas/i, 'o Groq não declarou ferramentas — e é dito assim');
  assert.equal(doc.querySelectorAll('.mo-classe.api').length >= 3, true, 'as APIs estão marcadas como APIs');
});

test('2 · o motor escolhido por agente avisa quando o trabalho pede mãos e o motor só dá texto', async () => {
  const { texto } = await abrir();
  const t = texto();
  assert.match(t, /O motor escolhido, por agente/);
  assert.match(t, /QA/);
  assert.match(t, /sem mãos/, 'o aviso aparece antes de a tarefa correr');
  assert.match(t, /ler.*correr|correr.*ler/, 'o aviso diz quais ferramentas o agente pede');
  assert.match(t, /Research/);
});

test('3 · a autonomia mostra casos, taxa e quem decidiu — e a razão de não poder subir', async () => {
  const { doc, texto } = await abrir();
  const t = texto();
  assert.match(t, /Autonomia por tipo de trabalho/);
  assert.match(t, /faltam 47 casos/);
  assert.match(t, /64 casos/);
  assert.match(t, /97% aprovados/);
  assert.match(t, /valdimiro@exemplo\.pt/, 'a decisão tem autor');
  assert.match(t, /50 casos decididos à mão e 95% aprovados/, 'a regra está escrita');
  const subir = [...doc.querySelectorAll('[data-act="auto-up"]')];
  assert.equal(subir.length, 2);
  assert.equal(subir[0].getAttribute('aria-disabled'), 'true', 'sem casos, o botão diz que não pode');
  assert.equal(subir[1].getAttribute('aria-disabled'), null, 'com casos, pode');
});

test('4 · subir chama a rota certa com o tipo certo', async () => {
  const { doc, pedidos } = await abrir('#/motores', {
    '/ops/autonomia/email%3Asem-site/subir': { ok: true, nivel: 'autonomo', rotulo: 'Autónomo' },
    '/ops/autonomia/email:sem-site/subir': { ok: true, nivel: 'autonomo', rotulo: 'Autónomo' },
  });
  const botao = [...doc.querySelectorAll('[data-act="auto-up"]')].find((b) => b.dataset.scope === 'email:sem-site');
  botao.click();
  await esperar(260);
  const chamada = pedidos.find((p) => decodeURIComponent(p.caminho) === '/ops/autonomia/email:sem-site/subir');
  assert.ok(chamada, 'a subida foi pedida ao servidor');
  assert.equal(chamada.metodo, 'POST');
  assert.match(doc.querySelector('#toast').textContent, /Autónomo/);
});

test('5 · descer está à mão para quem já não está em «pede-me sempre»', async () => {
  const { doc, pedidos } = await abrir('#/motores', {
    '/ops/autonomia/email%3Asem-site/descer': { ok: true, nivel: 'pedir_sempre' },
    '/ops/autonomia/email:sem-site/descer': { ok: true, nivel: 'pedir_sempre' },
  });
  const baixar = [...doc.querySelectorAll('[data-act="auto-down"]')];
  assert.equal(baixar.length, 1, 'só o tipo que subiu pode descer');
  baixar[0].click();
  await esperar(260);
  assert.ok(pedidos.some((p) => decodeURIComponent(p.caminho) === '/ops/autonomia/email:sem-site/descer'));
  assert.match(doc.querySelector('#toast').textContent, /pedir-te autorização/);
});

test('6 · as acções sensíveis dizem que exigem aprovação — e a lista vem do servidor', async () => {
  const { texto } = await abrir();
  const t = texto();
  assert.match(t, /Aprovação obrigatória/);
  assert.match(t, /Apagar receita/);
  assert.match(t, /nunca correm sozinhas/);
  assert.doesNotMatch(t, /Ler site/, 'uma ferramenta que não é destrutiva não entra nesta lista');
});

test('7 · o consumo mostra o gasto conhecido e as chamadas sem preço à parte', async () => {
  const { texto } = await abrir();
  const t = texto();
  assert.match(t, /Consumo real, limites e custo/);
  assert.match(t, /12,34/, 'o custo vem do saldo, em euros');
  assert.match(t, /2 chamada\(s\) sem preço conhecido ficam fora da soma/);
  assert.match(t, /fora da soma/, 'o custo não mente ao somar o que não tem preço');
  assert.match(t, /6/);
  assert.match(t, /900/, 'os tokens reais');
});

test('8 · sem motor nenhum, a página diz zero motores em vez de inventar um', async () => {
  const { texto } = await abrir('#/motores', {
    '/ia/estado': { fornecedores: [], agentes: [], ferramentas: [], modo: 'local', motivo: 'a IA corre no servidor' },
  });
  const t = texto();
  assert.match(t, /Modo local|Sem motor ligado/);
  assert.match(t, /a IA corre no servidor|sem motor/i);
  assert.match(t, /0|zero/);
});

test('9 · no telemóvel há cartões operacionais na visão geral', async () => {
  const { doc } = await abrir('#/hoje', {
    '/ops/tarefas': { tarefas: [{ id: 't1', state: 'running' }, { id: 't2', state: 'failed' }], tipos: {}, departamentos: [] },
  });
  const cartoes = [...doc.querySelectorAll('.mo-cards .mo-card')];
  assert.ok(cartoes.length >= 4, 'há cartões de painel');
  const t = cartoes.map((c) => c.textContent.replace(/\s+/g, ' ')).join(' | ');
  assert.match(t, /A correr/);
  assert.match(t, /À espera/);
  assert.match(t, /Falhou/);
  assert.ok(cartoes.every((c) => c.getAttribute('href')?.startsWith('#/')), 'cada cartão leva a um sítio onde se age');
});

test('10 · a barra de uma mão mostra a primeira decisão e aprova mesmo', async () => {
  const mensagem = { id: 'm1', status: 'rascunho', subject: 'Proposta para a Clínica', channel: 'email', created_at: new Date().toISOString(), body: 'Olá' };
  const { doc, pedidos } = await abrir('#/hoje', {
    '/ops/messages': { messages: [mensagem] },
    '/ops/today': { decidir: [{ id: 'm1', kind: 'mensagem', subject: 'Proposta para a Clínica' }] },
    '/ops/messages/m1/approve': { ok: true, mensagem: { ...mensagem, status: 'aprovada' } },
  });
  const bar = doc.querySelector('#mobar');
  assert.ok(bar && !bar.hidden, 'a barra aparece quando há uma decisão');
  assert.match(bar.textContent, /1 decisão à tua espera/);
  assert.match(bar.textContent, /Proposta para a Clínica/);
  const botao = bar.querySelector('.btn.primary');
  assert.equal(botao.dataset.act, 'aprovar');
  assert.equal(botao.dataset.id, 'm1');
  botao.click();
  await esperar(300);
  assert.ok(pedidos.some((p) => p.caminho === '/ops/messages/m1/approve'), 'aprovar a partir da barra chama a rota real');
});

test('11 · sem decisões, a barra desaparece (um aviso permanente deixa de ser aviso)', async () => {
  const { doc } = await abrir('#/hoje');
  const bar = doc.querySelector('#mobar');
  assert.ok(bar);
  assert.equal(bar.hidden, true);
  assert.equal(bar.textContent.trim(), '');
});

test('12 · o botão «+ Tarefa» da barra cria trabalho depressa', async () => {
  const { doc } = await abrir('#/hoje', {
    '/ops/messages': { messages: [{ id: 'm1', status: 'rascunho', subject: 'Proposta', channel: 'email' }] },
  });
  const rapida = doc.querySelector('#mobar [data-act="tarefa-rapida"]');
  assert.ok(rapida, 'há um atalho para criar tarefa');
  rapida.click();
  await esperar(300);
  assert.equal(doc.defaultView.location.hash, '#/tarefas');
});

test('13 · o telemóvel tem CSS próprio e respeita o movimento reduzido', () => {
  const shell = fs.readFileSync(new URL('./src/mesa.html', import.meta.url), 'utf8');
  assert.match(shell, /\.mo-cards \{ display: none; \}/, 'no desktop os cartões não duplicam a grelha');
  assert.match(shell, /@media \(max-width: 820px\)[\s\S]{0,2000}\.mo-cards\s*\{[\s\S]{0,200}display: grid/);
  assert.match(shell, /@media \(max-width: 420px\)[\s\S]{0,300}grid-template-columns: 1fr/, 'num ecrã pequeno, um cartão por linha');
  assert.match(shell, /\.mobar-acts \.btn|\.mobar \.btn \{ min-height: 44px/, 'alvos de 44 px para o dedo');
  assert.match(shell, /prefers-reduced-motion: reduce/);
  assert.match(shell, /safe-area-inset-bottom/, 'a barra respeita a área segura do iPhone');
  assert.match(HTML, /class="mobar"/, 'o bundle publicado traz a barra');
  assert.match(HTML, /mo-card/, 'e o CSS dos cartões móveis');
});
