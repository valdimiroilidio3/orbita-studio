/* ===========================================================================
   1.59.0 · O CRM NO ECRÃ (2 nov 2026)

   `crm.test.mjs` prova as contas e `api.test.mjs` as rotas. Este prova o que o
   dono vê e faz: a carteira com as fases, a confiança e a verificação em cada
   linha, os duplicados que aparecem sem fundir nada, a exportação em CSV que se
   descarrega uma vez por clique, e — na ficha do lead — a proveniência, a
   próxima ação e o registo de quem fez o quê.

   Corre contra `dist/mesa.html` (o ficheiro que vai para produção), com
   `/api/rpc` a responder como em produção. Não é um mockup: é o bundle real.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');
const DIA = 24 * 3600 * 1000;
/* 3 nov 2026 · as datas desta ficha eram fixas (30/10, 31/10) e «atrasada há 3 dias» é calculado
   com o relógio de quem corre o teste: no dia seguinte ficava vermelho sem nada estar partido.
   Passam a ser relativas a hoje, ancoradas ao meio-dia local para o «há N dias» não oscilar com a
   hora a que o teste corre (às 00:30 ou às 23:00 o mesmo instante pode contar dias diferentes). */
const HOJE = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; })();
const dia = (n) => { const d = new Date(HOJE); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const quando = (n, h = 9, m = 12) => { const d = new Date(HOJE); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };

const LEAD_OK = {
  id: 'l1', name: 'Clínica do Mondego', category: 'Saúde', city: 'Coimbra',
  phone: '+351 239 000 111', email: 'geral@clinicadomondego.pt',
  website: 'https://clinicadomondego.pt', website_estado: 'ok',
  website_verificado_em: quando(-2), website_motivo: 'respondeu 200 · 418 ms',
  source: 'pesquisa', fonte_url: 'https://exemplo.pt/lista', status: 'contactado', score: 61,
  proxima_acao: 'Ligar a marcar reunião', proxima_acao_em: dia(-3), qualificacao: 88,
};
const LEAD_DUP = {
  id: 'l2', name: 'Café Central', category: 'Restauração', city: 'Coimbra',
  phone: '239000111', status: 'novo', score: 40,
};
const LEAD_SEM = { id: 'l3', name: 'Padaria do Bairro', city: 'Porto', status: 'novo', score: 0 };

const LISTA = {
  ok: true,
  leads: [LEAD_OK, LEAD_DUP, LEAD_SEM],
  pipeline: { fases: [], total: 3 },
};

const FICHA = {
  ok: true,
  lead: LEAD_OK,
  dossier: null,
  messages: [],
  eventos: [
    { id: 'e1', lead_id: 'l1', tipo: 'verificacao', texto: 'site verificado: respondeu 200 · 418 ms', autor: 'valdimiro@exemplo.pt', criado: quando(-2, 9, 12) },
    { id: 'e2', lead_id: 'l1', tipo: 'proxima_acao', texto: 'próxima ação: Ligar a marcar reunião · ' + dia(-3), autor: 'valdimiro@exemplo.pt', criado: quando(-4, 8, 0) },
  ],
  confianca: { pontos: 95, nivel: 'alta', razoes: ['site verificado e a responder (+40)'] },
  verificacao: { estado: 'ok', rotulo: 'Site verificado', quando: quando(-2), dias: 2, motivo: 'respondeu 200 · 418 ms' },
  proxima: { estado: 'atrasada', texto: 'Ligar a marcar reunião', rotulo: 'atrasada há 3 dias', dias: -3 },
  qualificacao: { valor: 88, origem: 'guardada', rotulo: 'definida à mão' },
};

async function abrir(rota = '#/leads', extra = {}) {
  const pedidos = [];
  const descargas = [];
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${rota}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.URL.createObjectURL = (b) => { descargas.push(b); return 'blob:mesa'; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { descargas.push({ nome: this.download }); };
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        if (u.includes('/api/rpc')) { const b = JSON.parse(opt.body || '{}'); caminho = b.caminho; pedidos.push({ caminho, metodo: b.metodo, corpo: b.corpo }); }
        else caminho = new URL(u, 'https://mesa.test').pathname;
        const rota = caminho.replace(/^\/api/, '').split('?')[0];
        const ok = (c) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) });
        if (extra[rota]) {
          const r = extra[rota];
          return ok(typeof r === 'function' ? r(opt) : r);
        }
        const fixo = {
          '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: { admin: true, read: true, write: true } },
          '/ops/summary': { leads: { total: 3 }, projetos: { total: 0 }, custos: {} },
          '/ops/today': { decidir: [] },
          '/ops/leads': LISTA,
          '/ops/pipeline': { fases: [], total: 3 },
          '/ops/projetos': { projetos: [], tipos: [] },
          '/ops/messages': { messages: [] },
          '/ops/clientes': { clientes: [], activo: null },
          '/ops/saldo': { janela: { dias: 90 }, receitaCentimos: 0, custoCentimos: 0, margemCentimos: 0, contaAVista: {}, semDados: {} },
          '/ops/tarefas': { tarefas: [] },
          '/ops/agentes': { agentes: [] },
        };
        return ok(fixo[rota] ?? {});
      };
    },
  });
  await new Promise((r) => setTimeout(r, 500));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { dom, doc, pedidos, descargas, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 120) => new Promise((r) => setTimeout(r, ms));

test('1 · a lista mostra a carteira: as fases, os verificados, os atrasados e a frase', async () => {
  const { doc, texto } = await abrir();
  const t = texto();
  assert.match(t, /Carteira/, 'há um cartão de carteira');
  assert.match(t, /3 leads/, 'a frase diz quantos são');
  assert.match(t, /com site verificado/);
  assert.match(t, /por verificar/);
  assert.match(t, /1 com ação atrasada/, 'a ação atrasada não se esconde na nota');
  const fases = [...doc.querySelectorAll('.crm-fase')];
  assert.equal(fases.length, 7, 'as sete fases do funil, uma a uma');
  assert.ok(fases.some((f) => f.dataset.fase === 'novo' && f.querySelector('b').textContent === '2'));
});

test('2 · cada linha diz o site, a confiança e a próxima ação — sem abrir a ficha', async () => {
  const { doc, texto } = await abrir();
  const linhas = [...doc.querySelectorAll('.row.crm')];
  assert.equal(linhas.length, 3);
  const clinica = linhas[0];
  assert.match(clinica.textContent, /Clínica do Mondego/);
  assert.match(clinica.textContent, /Site verificado/, 'o estado do site está na linha');
  assert.match(clinica.textContent, /95\/100 · alta/, 'a confiança está na linha');
  assert.match(clinica.textContent, /Ligar a marcar reunião · atrasada há 3 dias/, 'a próxima ação, com o atraso');
  const chip = clinica.querySelector('.crm-chip[title]');
  assert.match(chip.getAttribute('title'), /site verificado|Site verificado/i, 'o porquê está no title');
  assert.match(texto(), /Sem site/, 'a padaria não finge um site');
});

test('3 · exportar: um clique, um pedido, um ficheiro com as linhas certas', async () => {
  const csv = '\uFEFFNome;Setor\r\nClínica do Mondego;Saúde\r\nCafé Central;Restauração\r\n';
  const { doc, pedidos, descargas, dom } = await abrir('#/leads', {
    '/ops/leads.csv': { ok: true, csv, linhas: 2, ficheiro: 'leads-2026-11-02.csv' },
  });
  const botao = doc.querySelector('[data-act="csv-leads"]');
  assert.ok(botao, 'há um botão de exportar');
  botao.click();
  botao.click();                 // o segundo clique não pode pedir outra vez
  await esperar();
  const chamadas = pedidos.filter((p) => p.caminho === '/ops/leads.csv');
  assert.equal(chamadas.length, 1, 'dois cliques seguidos não geram duas exportações');
  assert.ok(descargas.length >= 1, 'o ficheiro chegou ao browser');
  const nomes = descargas.filter((d) => d && d.nome).map((d) => d.nome);
  assert.ok(nomes.includes('leads-2026-11-02.csv'), 'o ficheiro tem o nome que o servidor deu');
  const blob = descargas.find((d) => typeof d.text === 'function');
  assert.ok(blob, 'o CSV foi passado como Blob');
  assert.match(await blob.text(), /Clínica do Mondego;Saúde/, 'o conteúdo é o que o servidor devolveu, não um CSV inventado');
  assert.match(dom.window.document.querySelector('#toast').textContent, /2 lead\(s\) exportados/);
});

test('4 · o servidor sem CSV não escreve um ficheiro vazio', async () => {
  const { doc, descargas } = await abrir('#/leads', { '/ops/leads.csv': { ok: true, csv: '', linhas: 0 } });
  doc.querySelector('[data-act="csv-leads"]').click();
  await esperar();
  const nomes = descargas.filter((d) => d && d.nome);
  assert.equal(nomes.length, 0, 'nada é descarregado quando não há CSV');
  assert.match(doc.querySelector('#toast').textContent, /nada foi exportado/i);
});

test('5 · os duplicados aparecem com as duas fichas, e nada é fundido', async () => {
  const { doc, pedidos, texto } = await abrir('#/leads', {
    '/ops/leads/duplicados': { ok: true, total: 1, leads: 3, grupos: [
      { chave: 'telefone:239000111', motivo: 'telefone', rotulo: 'mesmo telefone', ids: ['l1', 'l2'],
        leads: [
          { id: 'l1', name: 'Clínica do Mondego', city: 'Coimbra', phone: '+351 239 000 111', status: 'contactado' },
          { id: 'l2', name: 'Café Central', city: 'Coimbra', phone: '239000111', status: 'novo' },
        ] },
    ] },
  });
  const botao = doc.querySelector('[data-act="ver-duplicados"]');
  assert.ok(botao, 'há um aviso com o número de duplicados');
  assert.equal(botao.getAttribute('aria-expanded'), 'false');
  botao.click();
  await esperar();
  assert.equal(pedidos.filter((p) => p.caminho === '/ops/leads/duplicados').length, 1);
  assert.equal(doc.querySelector('[data-act="ver-duplicados"]').getAttribute('aria-expanded'), 'true');
  const t = texto();
  assert.match(t, /mesmo telefone/);
  assert.match(t, /3 leads analisados/);
  assert.match(t, /nada foi fundido/);
  const itens = [...doc.querySelectorAll('.crm-dup-i')];
  assert.equal(itens.length, 2, 'as duas fichas ficam à vista para uma pessoa decidir');
  assert.equal(itens[0].dataset.act, 'ver-lead', 'cada uma abre a ficha');
  assert.equal(pedidos.filter((p) => p.metodo === 'PATCH' || p.metodo === 'DELETE').length, 0, 'detetar não altera nada');
});

test('6 · a ficha do lead mostra proveniência, confiança, próxima ação e quem fez o quê', async () => {
  const { doc, texto } = await abrir('#/lead/l1', { '/ops/leads/l1': FICHA });
  const t = texto();
  assert.match(t, /Proveniência e confiança/);
  assert.match(t, /95\/100 · alta/);
  assert.match(t, /site verificado e a responder/, 'as razões vêm escritas');
  assert.match(t, /pesquisa/, 'a fonte aparece');
  assert.match(t, /exemplo\.pt\/lista/, 'o endereço da fonte também');
  assert.match(t, /respondeu 200 · 418 ms/, 'o motivo da verificação é o real');
  const [ano, mes, d] = dia(-2).split('-');
  assert.ok(t.includes(`${d}/${mes}/${ano}`) || t.includes(dia(-2)), 'a data da verificação está à vista');
  assert.match(t, /88/);
  assert.match(t, /definida à mão/, 'a qualificação diz de onde veio');
  assert.match(t, /Próxima ação/);
  assert.match(t, /atrasada há 3 dias/);
  assert.match(t, /Quem fez o quê/);
  assert.match(t, /valdimiro@exemplo\.pt/, 'o autor de cada mudança fica escrito');
  assert.match(t, /verificação do site/);
  const barra = doc.querySelector('.crm-bar i');
  assert.equal(barra.style.width, '95%', 'a barra mede a confiança');
});

test('7 · «Verificar site agora» pede o site ao servidor e mostra o resultado', async () => {
  const { doc, pedidos, texto } = await abrir('#/lead/l1', {
    '/ops/leads/l1': FICHA,
    '/ops/leads/l1/verificar': { ok: true, lead: { ...LEAD_OK, website_verificado_em: '2026-11-02T10:00:00.000Z' },
      verificacao: { estado: 'ok', quando: '2026-11-02T10:00:00.000Z', motivo: 'respondeu 200 · 260 ms', codigo: 200, ms: 260 },
      confianca: { pontos: 95, nivel: 'alta' } },
  });
  const botao = doc.querySelector('[data-act="verificar-site"]');
  assert.ok(botao, 'o botão existe porque há site guardado');
  botao.click();
  await esperar(200);
  const chamada = pedidos.find((p) => p.caminho === '/ops/leads/l1/verificar');
  assert.ok(chamada, 'a verificação foi pedida ao servidor');
  assert.equal(chamada.metodo, 'POST');
  assert.match(doc.querySelector('#toast').textContent, /Site verificado/);
});

test('8 · a próxima ação guarda-se pelo mesmo contrato da API (PATCH)', async () => {
  const { doc, pedidos } = await abrir('#/lead/l1', { '/ops/leads/l1': FICHA });
  doc.querySelector('#proxAcao').value = 'Enviar proposta';
  doc.querySelector('#proxAcaoEm').value = '2026-11-05';
  doc.querySelector('[data-act="guardar-proxima"]').click();
  await esperar(200);
  const chamada = pedidos.find((p) => p.caminho === '/ops/leads/l1' && p.metodo === 'PATCH');
  assert.ok(chamada, 'a próxima ação vai por PATCH');
  assert.equal(chamada.corpo.proxima_acao, 'Enviar proposta');
  assert.equal(chamada.corpo.proxima_acao_em, '2026-11-05');
  assert.match(doc.querySelector('#toast').textContent, /Próxima ação guardada/);
});

test('9 · limpar a próxima ação manda vazio, e a mesa diz o que ficou', async () => {
  const { doc, pedidos } = await abrir('#/lead/l1', { '/ops/leads/l1': FICHA });
  doc.querySelector('[data-act="limpar-proxima"]').click();
  await esperar(200);
  const chamada = pedidos.find((p) => p.caminho === '/ops/leads/l1' && p.metodo === 'PATCH');
  assert.equal(chamada.corpo.proxima_acao, null);
  assert.equal(chamada.corpo.proxima_acao_em, null);
  assert.match(doc.querySelector('#toast').textContent, /Próxima ação limpa/);
});

test('10 · sem site guardado não há «verificar» — e a mesa explica porquê', async () => {
  const semSite = { ...FICHA, lead: { ...LEAD_SEM }, verificacao: { estado: 'sem_site', rotulo: 'Sem site', quando: null, motivo: 'este lead não tem site guardado' } };
  const { doc, texto } = await abrir('#/lead/l3', { '/ops/leads/l3': semSite });
  assert.equal(doc.querySelector('[data-act="verificar-site"]'), null, 'não há botão para verificar o nada');
  assert.match(texto(), /Sem site guardado não há nada para verificar/);
});

test('11 · o CSS do CRM vai no bundle publicado, não só no código-fonte', () => {
  const shell = fs.readFileSync(new URL('./src/mesa.html', import.meta.url), 'utf8');
  for (const cls of ['.crm-card', '.crm-fase', '.crm-sinais', '.crm-chip', '.crm-bar', '.crm-dup', '.crm-prova', '.row.crm']) {
    assert.ok(shell.includes(cls), `falta o estilo ${cls}`);
  }
  assert.match(shell, /@media \(max-width: 1080px\)[\s\S]{0,400}\.row\.crm/);
  assert.match(shell, /@media \(max-width: 820px\)[\s\S]{0,400}\.row\.crm/);
  assert.ok(HTML.includes('.crm-chip'), 'o bundle publicado traz o CSS do CRM');
});


/* ---------- 3 nov 2026 · o CRM como sítio de trabalho, não só como ficha ---------- */

test('12 · a lista põe à frente o que está atrasado, mesmo que tenha entrado por último', async () => {
  /* a base devolve os leads na ordem em que entraram: o atrasado é o ÚLTIMO */
  const { doc } = await abrir('#/leads', { '/ops/leads': { ok: true, leads: [LEAD_SEM, LEAD_DUP, LEAD_OK], pipeline: { fases: [], total: 3 } } });
  const nomes = [...doc.querySelectorAll('.rows .row .nm')].map((n) => n.textContent.trim());
  assert.deepEqual(nomes.slice(0, 1), ['Clínica do Mondego'],
    'quem tem a próxima ação atrasada tem de estar no topo — é o trabalho de hoje');
  assert.equal(nomes.length, 3, 'nenhum lead desaparece por causa da ordem');
});

test('13 · «Atrasadas» conta e filtra: só o que passou do prazo', async () => {
  const { doc } = await abrir();
  const chip = doc.querySelector('[data-act="filter"][data-k="atrasados"]');
  assert.ok(chip, 'com uma ação atrasada tem de haver um filtro para ela');
  assert.match(chip.textContent, /Atrasadas \(1\)/);
  chip.click();
  await esperar();
  const nomes = [...doc.querySelectorAll('.rows .row .nm')].map((n) => n.textContent.trim());
  assert.deepEqual(nomes, ['Clínica do Mondego'], 'o filtro mostra exactamente os atrasados');
});

test('14 · exportar a vista leva o que está à vista, não as 500 linhas da base', async () => {
  const { doc, pedidos, descargas, dom } = await abrir();
  /* sem filtro não há botão de «vista»: exportar tudo continua a ser um clique */
  assert.equal(doc.querySelector('[data-act="csv-vista"]'), null, 'sem filtro, o botão de CSV é o de sempre');

  doc.querySelector('[data-act="filter"][data-k="atrasados"]').click();
  await esperar();
  const botao = doc.querySelector('[data-act="csv-vista"]');
  assert.ok(botao, 'com uma vista filtrada há de haver forma de exportar só ela');
  assert.match(botao.textContent, /\(1\)/, 'o botão diz quantas linhas vai levar');

  botao.click();
  await esperar();
  assert.equal(pedidos.filter((p) => p.caminho === '/ops/leads.csv').length, 0,
    'a vista exporta-se no browser: não vai buscar as 500 ao servidor');
  const blob = descargas.find((d) => typeof d.text === 'function');
  assert.ok(blob, 'o ficheiro chegou ao browser');
  const csv = await blob.text();
  assert.match(csv, /Clínica do Mondego/, 'leva a linha que está à vista');
  assert.doesNotMatch(csv, /Padaria do Bairro/, 'e não leva o que o filtro escondeu');
  assert.match(csv, /Confiança/, 'leva as colunas do CRM (confiança e verificação), como o CSV completo');
  const nome = descargas.filter((d) => d && d.nome).map((d) => d.nome)[0];
  assert.match(nome, /^leads-\d{4}-\d{2}-\d{2}\.csv$/, 'o ficheiro leva a data no nome');
  assert.match(dom.window.document.querySelector('#toast').textContent, /só os que estão à vista/);
});
