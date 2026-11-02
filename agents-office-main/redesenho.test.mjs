/* ===========================================================================
   1.57.0 · O REDESENHO DA PÁGINA DO PROJETO — PROVAS

   Duas metades, como o trabalho:

     A. o que se pode calcular sem DOM — o progresso (média de cinco etapas
        reais), o resumo da lead (só o que está guardado), as iniciais e as abas
        válidas. Estes testes correm contra `src/projeto.js`, não contra o HTML;

     B. o que o dono VÊ — `dist/mesa.html` a correr num DOM com um `/api/rpc`
        falso: cabeçalho global com pesquisa, barra lateral de 248 px, quatro
        abas que trocam o painel, progresso com a percentagem certa, resumo da
        lead com o telefone verdadeiro, e o formulário do briefing na coluna
        principal (com «Salvar» e «Gerar Prompt Master» a sério).

   O que NÃO se prova aqui: pixéis medidos (sem browser não há layout), nem o
   ecrã real de um telemóvel. O que fica provado é a estrutura, os tokens, as
   acções e as contas — ver o relatório para o que falta medir.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { JSDOM } from 'jsdom';

import { progresso, resumoLead, iniciais, origemLegivel, ABAS_PROJETO, abaValida } from './src/projeto.js';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');

/* ══════════════════════════ A. contas puras ══════════════════════════ */

test('progresso: um projeto acabado de abrir está a zero — nada é assumido', () => {
  const p = progresso({ projeto: { status: 'rascunho' } });
  assert.equal(p.pct, 0);
  assert.equal(p.feitas, 0);
  assert.deepEqual(p.etapas.map((e) => e.id), ['briefing', 'master', 'imagens', 'video', 'entrega']);
  assert.ok(p.etapas.every((e) => e.estado === 'pendente'));
});

test('progresso: briefing gravado e Prompt Master escrito valem duas etapas de cinco (40%)', () => {
  const briefing = {
    valores: { empresa: 'Clínica do Mondego' },
    dados: { briefing: { gravadoEm: '2026-10-26T09:00:00Z' }, master: { versao: 3 } },
  };
  const p = progresso({ projeto: { status: 'rascunho' }, briefing });
  assert.equal(p.pct, 40);
  assert.equal(p.feitas, 2);
  assert.equal(p.etapas[0].estado, 'feito');
  assert.equal(p.etapas[1].estado, 'feito');
  assert.match(p.etapas[0].nota, /2026/);
  assert.equal(p.etapas[1].nota, 'versão 3');
});

test('progresso: uma imagem concluída e uma em curso contam de forma diferente', () => {
  const media = {
    dados: {
      geracoes: [
        { tipo: 'imagem', estado: 'concluida' },
        { tipo: 'imagem', estado: 'em_processamento' },
        { tipo: 'video', estado: 'aguardando' },
      ],
    },
  };
  const p = progresso({ projeto: { status: 'rascunho' }, media });
  const porId = Object.fromEntries(p.etapas.map((e) => [e.id, e]));
  assert.equal(porId.imagens.estado, 'feito');
  assert.equal(porId.video.estado, 'activo');
  /* 1 feito + 0,5 em curso, em 5 etapas */
  assert.equal(p.pct, 30);
});

test('progresso: «aprovado» prepara a entrega, «entregue» fecha-a — e só aí chega a 100%', () => {
  const briefing = { dados: { briefing: { gravadoEm: '2026-10-26T09:00:00Z' }, master: { versao: 1 } } };
  const media = { dados: { geracoes: [{ tipo: 'imagem', estado: 'concluida' }, { tipo: 'video', estado: 'concluida' }] } };
  const aprovado = progresso({ projeto: { status: 'qa_passou' }, briefing, media });
  assert.equal(aprovado.etapas[4].estado, 'activo');
  assert.equal(aprovado.pct, 90);
  const entregue = progresso({ projeto: { status: 'entregue' }, briefing, media });
  assert.equal(entregue.etapas[4].estado, 'feito');
  assert.equal(entregue.pct, 100);
});

test('progresso: sem dados nenhuns diz «pendente» em vez de inventar progresso', () => {
  const p = progresso({ projeto: null, briefing: null, media: null });
  assert.equal(p.pct, 0);
  assert.ok(p.etapas.every((e) => e.estado === 'pendente'));
});

test('resumoLead: só o que está guardado, com tel: e mailto: quando servem para ligar', () => {
  const r = resumoLead({
    name: 'Clínica Aurora', phone: '+351 912 345 678', email: 'geral@aurora.pt',
    city: 'Coimbra', category: 'Clínica dentária', source: 'geoapify',
    created_at: '2026-10-01T10:00:00Z',
  });
  assert.equal(r.existe, true);
  assert.equal(r.nome, 'Clínica Aurora');
  const porChave = Object.fromEntries(r.linhas.map((l) => [l.chave, l]));
  assert.equal(porChave.origem.valor, 'Geoapify (pesquisa de empresas)');
  assert.equal(porChave.contacto.valor, '+351 912 345 678');
  assert.equal(porChave.contacto.href, 'tel:+351912345678');
  assert.equal(porChave.contacto.copiavel, true);
  assert.equal(porChave.email.href, 'mailto:geral@aurora.pt');
  assert.equal(porChave.local.valor, 'Coimbra · Clínica dentária');
  assert.match(porChave.data.valor, /2026/);
});

test('resumoLead: sem lead e sem campos diz «não informado» — não preenche nada', () => {
  const vazio = resumoLead(null);
  assert.equal(vazio.existe, false);
  assert.deepEqual(vazio.linhas, []);
  assert.match(vazio.nota, /não tem lead ligada/i);

  const semNada = resumoLead({ name: '' });
  const porChave = Object.fromEntries(semNada.linhas.map((l) => [l.chave, l]));
  assert.equal(porChave.origem.valor, 'não informada');
  assert.equal(porChave.contacto.valor, 'não informado');
  assert.equal(porChave.contacto.href, null);
  assert.equal(porChave.contacto.copiavel, false);
  assert.equal(porChave.local.valor, 'não informada');
  assert.equal(semNada.nome, 'sem nome');
  /* não se inventa uma linha de email quando não há telefone */
  assert.equal(porChave.email, undefined);
});

test('origemLegivel: traduz as origens conhecidas e devolve o resto tal como está', () => {
  assert.equal(origemLegivel('geoapify'), 'Geoapify (pesquisa de empresas)');
  assert.equal(origemLegivel('manual'), 'escrita à mão');
  assert.equal(origemLegivel(' '), 'não informada');
  assert.equal(origemLegivel('feira-de-santarem'), 'feira-de-santarem');
});

test('iniciais: duas letras legíveis para a marca do projeto', () => {
  assert.equal(iniciais('Clínica Aurora'), 'CA');
  assert.equal(iniciais('Órbita'), 'ÓR');
  assert.equal(iniciais('  '), '?');
});

test('abas: quatro, sempre válidas — uma aba desconhecida cai no briefing', () => {
  assert.deepEqual(ABAS_PROJETO.map((a) => a.id), ['briefing', 'master', 'imagens', 'video']);
  assert.equal(abaValida('master'), 'master');
  assert.equal(abaValida('video'), 'video');
  assert.equal(abaValida('contabilidade'), 'briefing');
  assert.equal(abaValida(undefined), 'briefing');
});

/* ══════════════════════════ B. a mesa num DOM ══════════════════════════ */

const PROJETO = {
  project: {
    id: 'p1', name: 'Clínica Aurora', niche: 'dentária', client: 'Aurora Lda',
    city: 'Coimbra', kind: 'landing', status: 'aprovado', lead_id: 'l1',
    brief: 'Uma landing para marcar consultas.', goals: ['marcar consultas'], acceptance: [],
  },
  qa: { passed: true, at: '2026-10-20T10:00:00Z', report: [] },
  files: [], changes: [], deliveries: [], events: [],
};

const LEAD = {
  lead: {
    id: 'l1', name: 'Clínica Aurora', phone: '+351 912 345 678', email: 'geral@aurora.pt',
    city: 'Coimbra', category: 'Clínica dentária', source: 'geoapify', status: 'cliente',
    created_at: '2026-10-01T10:00:00Z',
  },
};

const BRIEFING = {
  campos: [
    { id: 'empresa', label: 'Nome da empresa', tipo: 'texto', origem: 'lead' },
    { id: 'objetivo', label: 'Objetivo', tipo: 'texto-longo', origem: 'lead' },
    { id: 'publico', label: 'Público-alvo', tipo: 'texto-longo', origem: 'ia' },
    { id: 'direcao', label: 'Direção visual', tipo: 'texto-longo', origem: 'ia' },
  ],
  briefing: {
    valores: { empresa: 'Clínica Aurora', objetivo: 'Marcar consultas', publico: 'Famílias de Coimbra', direcao: 'Claro e calmo' },
    origens: { empresa: 'lead', objetivo: 'lead', publico: 'ia', direcao: 'ia' },
    gravadoEm: '2026-10-20T09:00:00Z',
  },
  master: { versao: 2, texto: 'Prompt Master escrito.' },
  emFalta: [],
};

const MEDIA = {
  geracoes: [{ id: 'g1', tipo: 'imagem', estado: 'concluida', prompt: 'fachada', url: null }],
  opcoes: { imagem: { formatos: [{ id: '1x1', label: 'Quadrado' }] }, video: { formatos: [{ id: '16x9', label: 'Horizontal' }] } },
  uso: { hoje: 1 }, limites: { porDia: 20 }, projeto: { nome: 'Clínica Aurora', leadId: 'l1' },
};

const mapaFixo = {
  '/auth/eu': { user: { id: 'u1', name: 'Valdimiro Oilídio', email: 'dono@orbita.pt', role: 'owner' }, modo: 'base', perms: {} },
  '/ops/summary': { ok: true, leads: { total: 3 }, projetos: { total: 1 }, custos: { apiCentimos: 4210 } },
  '/ops/today': { ok: true, decidir: [1, 2] },
  '/ops/leads': { leads: [LEAD.lead] },
  '/ops/leads/l1': LEAD,
  '/ops/projetos': { projetos: [PROJETO.project], resumo: null, tipos: [] },
  '/ops/projetos/p1': PROJETO,
  '/ops/projetos/p1/briefing': BRIEFING,
  '/ops/projetos/p1/media': MEDIA,
  '/ops/messages': { messages: [] },
  '/ops/clientes': { clientes: [{ id: 'c1', nome: 'Aurora Lda' }], activo: { id: 'c1', nome: 'Aurora Lda' } },
  '/ops/saldo': { receitaCentimos: 0, custoCentimos: 0 },
};

async function abrir(hash = '#/projeto/p1') {
  const pedidos = [];
  const escritas = [];
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${hash}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        let corpo = {};
        if (u.includes('/api/rpc')) {
          corpo = JSON.parse(opt.body || '{}');
          caminho = corpo.caminho;
        } else {
          caminho = new URL(u, 'https://mesa.test').pathname;
        }
        pedidos.push(caminho);
        /* o `/api/rpc` leva o método verdadeiro dentro do corpo; o resto no pedido */
        const metodo = u.includes('/api/rpc') ? (corpo.metodo || 'GET') : (opt.method || 'GET');
        if (metodo !== 'GET') escritas.push({ caminho, metodo, corpo });
        /* a gravação do briefing responde o mesmo que a leitura, com o selo novo */
        const rota = caminho.split('?')[0];
        const responder = (c) => ({ ok: true, status: 200, json: async () => c });
        /* o `/api/rpc` da app embrulha as respostas num envelope {status, corpo} */
        const envelope = (corpo) => ({ status: 200, corpo });
        if (rota === '/ops/projetos/p1/briefing' && metodo !== 'GET') {
          return responder(envelope({ ...BRIEFING, briefing: { ...BRIEFING.briefing, gravadoEm: '2026-11-02T10:00:00Z' } }));
        }
        return responder(envelope(mapaFixo[rota] ?? {}));
      };
    },
  });
  await new Promise((r) => setTimeout(r, 500));
  return { dom, doc: dom.window.document, pedidos, escritas };
}

test('DOM: cabeçalho e barra lateral do redesenho existem com os dados certos', async () => {
  const { doc } = await abrir();

  /* a barra lateral tem o item novo e continua com as secções todas */
  const nav = doc.querySelector('#nav');
  assert.ok(nav, 'há barra lateral');
  /* o texto de cada item sem os contadores («Visão geral 2») */
  const itens = [...nav.querySelectorAll('a')].map((a) => (a.querySelector('span')?.textContent || a.textContent).trim());
  assert.ok(itens.includes('Visão geral'), 'a visão geral tem nome de visão geral');
  for (const t of ['Leads', 'Projetos', 'Papel', 'Cine', 'Tarefas', 'Agentes', 'IA', 'Saldo', 'Faturas', 'Conversas']) {
    assert.ok(itens.includes(t), `a secção «${t}» não desapareceu`);
  }

  /* o cabeçalho: pesquisa global, atalho, avisos e conta */
  const head = doc.querySelector('#appHead');
  assert.ok(head, 'há cabeçalho de aplicação');
  const gq = doc.querySelectorAll('#gq');
  assert.equal(gq.length, 1, 'uma só caixa de pesquisa na página (é a global)');
  assert.match(head.textContent, /Ctrl K/);
  assert.match(head.textContent, /Valdimiro Oilídio/);
  assert.match(head.textContent, /Aurora Lda/, 'a organização vem do espaço activo, não de texto fixo');
  assert.equal(doc.querySelectorAll('.ndot').length, 1, 'duas decisões à espera = um aviso');
  assert.equal(doc.querySelector('.ndot').textContent, '2');

  /* o cartão do fundo: custo real, sem planos inventados */
  const foot = doc.querySelector('#sideFoot').textContent;
  assert.match(foot, /Consumo de APIs/);
  assert.match(foot, /42,10/);
});

test('DOM: o cabeçalho do projeto vem do projeto seleccionado, não do ecrã', async () => {
  const { doc } = await abrir();
  assert.equal(doc.querySelector('.pj-id h1').textContent, 'Clínica Aurora');
  assert.match(doc.querySelector('.pj-sub').textContent, /dentária · Aurora Lda · Coimbra/);
  assert.equal(doc.querySelector('.pj-ic').textContent, 'CA');
  assert.match(doc.querySelector('.pj-crumbs').textContent, /Projetos/);
  assert.match(doc.querySelector('.pj-crumbs').textContent, /Clínica Aurora/);
  /* o estado é o do projeto (qa_passou), não uma etiqueta decorativa */
  assert.match(doc.querySelector('.pj-status').textContent, /Aprovado/);
});

test('DOM: quatro abas funcionais — o briefing abre por omissão e o clique troca o painel', async () => {
  const { dom, doc } = await abrir();
  const abas = [...doc.querySelectorAll('.pj-tab')];
  assert.deepEqual(abas.map((a) => a.dataset.tab), ['briefing', 'master', 'imagens', 'video']);
  assert.deepEqual(abas.map((a) => a.textContent.trim()), ['Briefing', 'Prompt Master', 'Imagens', 'Vídeo']);
  assert.equal(abas[0].getAttribute('aria-selected'), 'true');
  assert.ok(abas[0].classList.contains('on'));
  /* o painel do briefing está aberto, com o formulário */
  assert.ok(doc.querySelector('.bf-form, [data-campo="empresa"]'), 'o formulário do briefing está na coluna principal');

  /* clicar em «Imagens» troca o painel — sem perder o projeto */
  abas[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const depois = [...doc.querySelectorAll('.pj-tab')];
  assert.equal(depois[2].getAttribute('aria-selected'), 'true');
  assert.equal(depois[0].getAttribute('aria-selected'), 'false');
  assert.equal(doc.querySelector('.pj-id h1').textContent, 'Clínica Aurora', 'o cabeçalho não se perdeu');
  assert.ok(doc.querySelector('.md-card'), 'a vista de mídia desenhou-se');
  assert.ok(doc.querySelector('.md-form'), 'o formulário de mídia continua utilizável');
});

test('DOM: progresso com a percentagem calculada e o resumo da lead com o telefone real', async () => {
  const { doc } = await abrir();
  const prog = doc.querySelector('.pj-aside .pj-panel');
  assert.match(prog.textContent, /Progresso do projeto/);
  /* briefing gravado + master + 1 imagem + entrega em curso = (1+1+1+0+0,5)/5 = 70% */
  assert.equal(doc.querySelector('.pj-pct').textContent, '70%');
  assert.equal(doc.querySelector('.pj-bar i').getAttribute('style'), 'width:70%');
  const etapas = [...doc.querySelectorAll('.pj-step')];
  assert.equal(etapas.length, 5);
  assert.ok(etapas[0].classList.contains('feito'));
  assert.ok(etapas[4].classList.contains('activo'));

  const leadTxt = [...doc.querySelectorAll('.pj-panel')].map((n) => n.textContent).join(' ');
  assert.match(leadTxt, /Resumo da lead/);
  assert.match(leadTxt, /Geoapify \(pesquisa de empresas\)/);
  assert.match(leadTxt, /\+351 912 345 678/);
  assert.match(leadTxt, /Coimbra/);
  assert.match(leadTxt, /Abrir a lead completa/);
  /* o botão de copiar existe e leva o número consigo */
  const copiar = doc.querySelector('[data-act="proj-copiar"]');
  assert.ok(copiar, 'há um botão para copiar o contacto');
  assert.equal(copiar.dataset.valor, '+351 912 345 678');
});

test('DOM: o briefing tem os quatro campos com etiqueta visível e as duas acções', async () => {
  const { doc } = await abrir();
  for (const campo of ['empresa', 'objetivo', 'publico', 'direcao']) {
    assert.ok(doc.querySelector(`[data-campo="${campo}"]`), `campo «${campo}» não está no formulário`);
  }
  const rotulos = [...doc.querySelectorAll('.bf-campo-h label')].map((l) => l.textContent.trim());
  for (const r of ['Nome da empresa', 'Objetivo', 'Público-alvo', 'Direção visual']) {
    assert.ok(rotulos.includes(r), `a etiqueta «${r}» tem de estar escrita, não só no placeholder`);
  }
  /* as origens: lead a cinzento-azulado, sugestão da IA a verde */
  assert.ok(doc.querySelector('.bf-badge.lead'), 'há um selo de origem «lead»');
  assert.ok(doc.querySelector('.bf-badge.ia'), 'há um selo de origem «sugerido pela IA»');
  /* e o rodapé: salvar persiste, gerar usa os dados */
  assert.ok(doc.querySelector('[data-act="bf-guardar"]'), 'Salvar continua ligado à gravação');
  assert.ok(doc.querySelector('[data-act="bf-master"]'), 'Gerar Prompt Master continua ligado');
  /* as abas internas do briefing não se repetem dentro da página do projeto */
  assert.equal(doc.querySelectorAll('.bf-abas').length, 0, 'as abas são as da página, não duas vezes');
});

test('DOM: «Salvar» grava a sério (pedido ao servidor) e não duplica o pedido', async () => {
  const { dom, doc, escritas } = await abrir();
  const campo = doc.querySelector('[data-campo="objetivo"]');
  campo.value = 'Marcar consultas em Coimbra';
  campo.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));

  const salvar = doc.querySelector('[data-act="bf-guardar"]');
  assert.ok(salvar && !salvar.disabled, 'o botão está activo com alterações por gravar');
  salvar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  salvar.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));

  const gravacoes = escritas.filter((e) => e.caminho === '/ops/projetos/p1/briefing' && e.metodo === 'PUT');
  assert.equal(gravacoes.length, 1, 'dois cliques seguidos não podem gravar duas vezes');
  assert.equal(gravacoes[0].corpo.corpo.valores.objetivo, 'Marcar consultas em Coimbra');
});

test('DOM: nada de botões decorativos — cada acção do cabeçalho e das abas tem comportamento', async () => {
  const { doc } = await abrir();
  const alvos = [...doc.querySelectorAll('.pj [data-act]')].map((n) => n.dataset.act);
  const conhecidas = new Set([
    'gerar', 'qa', 'aprovar-projeto', 'entregar', 'entregar-vercel', 'entregar-github', 'zip',
    'reload', 'proj-tab', 'proj-copiar',
  ]);
  for (const a of alvos) {
    assert.ok(conhecidas.has(a) || a.startsWith('bf-') || a.startsWith('md-') || a.startsWith('ia-'),
      `«${a}» não é uma acção conhecida`);
  }
  /* e as acções antigas não desapareceram da página (este projeto está aprovado) */
  for (const a of ['gerar', 'qa', 'entregar', 'entregar-vercel', 'entregar-github']) {
    assert.ok(alvos.includes(a), `a acção «${a}» perdeu-se no redesenho`);
  }
});

test('DOM: num projeto que passou o QA, «Aprovar» aparece — as acções seguem o estado', async () => {
  const antes = mapaFixo['/ops/projetos/p1'].project.status;
  mapaFixo['/ops/projetos/p1'].project.status = 'qa_passou';
  try {
    const { doc } = await abrir();
    const acts = [...doc.querySelectorAll('#main [data-act]')].map((n) => n.dataset.act);
    assert.ok(acts.includes('aprovar-projeto'), 'o «Aprovar» tem de estar quando o QA passou');
    assert.ok(!acts.includes('entregar'), 'e a entrega ainda não: primeiro aprova-se');
  } finally {
    mapaFixo['/ops/projetos/p1'].project.status = antes;
  }
});

test('DOM: os tokens do redesenho e a grelha 70/30 estão na CSS, e o mobile tem as suas regras', () => {
  assert.match(HTML, /--blue:\s*#155EEF/, 'o azul é o da referência');
  assert.match(HTML, /--bg:\s*#F8FAFC/);
  assert.match(HTML, /--ink:\s*#111318/);
  assert.match(HTML, /--muted:\s*#667085/);
  assert.match(HTML, /--hair:\s*#E2E6ED/);
  assert.match(HTML, /--ok:\s*#12A150/);
  assert.match(HTML, /--side:\s*248px/, 'a barra lateral tem 248 px');
  assert.match(HTML, /--head:\s*76px/, 'o cabeçalho tem 76 px');
  assert.match(HTML, /\.pj-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*336px/s);
  assert.match(HTML, /@media \(max-width:\s*1024px\)\s*\{\s*\.pj-grid\s*\{[^}]*grid-template-columns:\s*1fr/s, 'no tablet a coluna lateral cai abaixo');
  assert.match(HTML, /\.pj-tabs\s*\{[^}]*overflow-x:\s*auto/s, 'no telemóvel as abas deslizam');
  assert.match(HTML, /\.pj-tab\.on::after/, 'a aba activa tem indicador inferior');
  assert.match(HTML, /prefers-reduced-motion/, 'as animações respeitam quem as desliga');
  assert.match(HTML, /\.plan-b/, 'o cartão do fundo da barra lateral existe');
});
