/* ===========================================================================
   1.57.2 · A MESA COMO CENTRO DE COMANDO — provas

   O pedido: a vista principal responde a quatro perguntas — o que está a
   acontecer, o que foi concluído, o que precisa da minha aprovação e o que está
   bloqueado — e mostra o estado das salas sem obrigar a abrir o escritório.

   Duas metades:
     A. as contas puras (`src/painel.js`): os quatro números, a série de sete
        dias, a fila de aprovações com urgência, o estado das salas tirado das
        tarefas, a atividade e o que está preso;
     B. a vista a sério (`dist/mesa.html` num DOM, com `/api/rpc` falso): os
        cartões, as acções de aprovar/rejeitar e as salas na primeira dobra.

   O que NÃO se prova: pixéis medidos (sem browser) e o comportamento de um
   servidor verdadeiro (o `/api/rpc` é falso, com o mesmo envelope da produção).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import {
  resumoOperacional, filaDeAprovacao, estadoAgentes, atividadeRecente,
  proximosTrabalhos, bloqueios, serieConclusoes, idade, saudacao, fraseDoEstado,
  DEPARTAMENTO_POR_TIPO,
} from './src/painel.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(AQUI, 'dist', 'mesa.html'), 'utf8');
const AGORA = Date.parse('2026-11-02T12:00:00Z');
const hAtras = (h) => new Date(AGORA - h * 3600000).toISOString();

const TAREFAS = [
  { id: 't1', kind: 'codigo', state: 'running', created_at: hAtras(1) },
  { id: 't2', kind: 'mensagem', state: 'queued', created_at: hAtras(2) },
  { id: 't3', kind: 'qa', state: 'succeeded', finished_at: hAtras(3) },
  { id: 't4', kind: 'investigar', state: 'failed', finished_at: hAtras(4), error: 'o fornecedor recusou (429)' },
  { id: 't5', kind: 'briefing', state: 'awaiting_approval', created_at: hAtras(5) },
  { id: 't6', kind: 'qa', state: 'succeeded', finished_at: hAtras(30) }, // ontem: fora das 24 h
];

/* ══════════════════════════ A. as contas ══════════════════════════ */

test('resumo: os quatro números saem das tarefas e dos rascunhos, não do ecrã', () => {
  const hoje = { decidir: [{ id: 'm1', kind: 'mensagem', lead: { name: 'Clínica Aurora', score: 80 } }] };
  const projetos = [{ id: 'p1', status: 'qa_falhou', name: 'Site' }];
  const r = resumoOperacional({ tarefas: TAREFAS, hoje, projetos, agora: AGORA });

  const porId = Object.fromEntries(r.cartoes.map((c) => [c.id, c]));
  assert.equal(porId['a-correr'].valor, 1, 'uma a correr');
  assert.equal(porId.concluido.valor, 1, 'só a concluída nas últimas 24 h (a de ontem não conta)');
  assert.equal(porId.aprovar.valor, 2, 'um rascunho + uma tarefa à espera');
  assert.equal(porId.bloqueado.valor, 2, 'uma tarefa falhada + um projeto sem QA');
  assert.deepEqual(r.contagens, { aCorrer: 1, naFila: 1, concluidas: 1, falhadas: 1, aprovar: 2, bloqueado: 2 });
  /* as notas dizem o que compõe o número */
  assert.match(porId.aprovar.nota, /1 rascunho/);
  assert.match(porId.aprovar.nota, /1 tarefa/);
  assert.match(porId.bloqueado.nota, /1 tarefa falhada/);
});

test('resumo: sem nada, tudo a zero com a razão escrita — nunca um número inventado', () => {
  const r = resumoOperacional({ tarefas: [], hoje: { decidir: [] }, projetos: [], agora: AGORA });
  assert.deepEqual(r.cartoes.map((c) => c.valor), [0, 0, 0, 0]);
  assert.match(r.cartoes[0].nota, /nada a correr/);
  assert.match(r.cartoes[2].nota, /nada à espera de ti/);
  assert.match(r.cartoes[3].nota, /nada bloqueado/);
});

test('série: sete dias de conclusões reais, com o dia de hoje no fim', () => {
  const serie = serieConclusoes(TAREFAS, { dias: 7, agora: AGORA });
  assert.equal(serie.length, 7);
  assert.equal(serie[6].n, 1, 'a tarefa concluída há 3 h está no dia de hoje');
  assert.equal(serie.reduce((n, d) => n + d.n, 0), 2, 'as duas concluídas caem dentro dos sete dias');
});

test('idade: minutos, horas e dias — e nada quando a data não presta', () => {
  assert.equal(idade(hAtras(0.005), AGORA), 'agora');
  assert.equal(idade(hAtras(0.4), AGORA), '24 min');
  assert.equal(idade(hAtras(3), AGORA), '3 h');
  assert.equal(idade(new Date(AGORA - 3 * 86400000).toISOString(), AGORA), '3 d');
  assert.equal(idade('ontem', AGORA), null);
  assert.equal(idade(null, AGORA), null);
});

test('fila de aprovações: rascunhos, autonomia e tarefas, com a urgência do que está guardado', () => {
  const hoje = {
    decidir: [
      { id: 'm1', kind: 'mensagem', channel: 'whatsapp', body: 'Olá! Vi que a clínica abriu…', lead: { id: 'l1', name: 'Clínica Aurora', score: 82 }, at: hAtras(1) },
      { id: 'm2', kind: 'mensagem', channel: 'email', body: 'Proposta', lead: { name: 'Padaria Central', score: 40 }, at: hAtras(9) },
      { id: 'a1', kind: 'autonomia', text: 'pede para enviar sem perguntar', at: hAtras(20) },
    ],
  };
  const tarefas = [{ id: 't5', kind: 'briefing', state: 'awaiting_approval', created_at: hAtras(5), entity_id: 'p1' }];
  const fila = filaDeAprovacao({ hoje, tarefas, rotulos: { briefing: 'Escrever o briefing' }, agora: AGORA });

  assert.equal(fila.length, 4, 'três decisões + uma tarefa');
  assert.equal(fila[0].urgencia, 'alta', 'a mensagem para um lead de nota alta vem primeiro');
  assert.equal(fila[0].titulo, 'Clínica Aurora');
  assert.equal(fila.find((i) => i.id === 'a1').urgencia, 'baixa');
  const tarefa = fila.find((i) => i.tipo === 'tarefa');
  assert.equal(tarefa.titulo, 'Escrever o briefing');
  assert.equal(tarefa.urgencia, 'alta');
  /* as de mensagem abrem o cartão da decisão; a de tarefa tem botões próprios */
  assert.equal(tarefa.atalho, 'tarefa');
  assert.equal(fila.find((i) => i.id === 'm1').atalho, 'pick');
  /* sem dados não explode */
  assert.deepEqual(filaDeAprovacao({}), []);
});

test('agentes: o estado de cada sala sai das tarefas (a correr, bloqueada, na fila, em descanso)', () => {
  const departamentos = [
    { id: 'comando', nome: 'Comando' },
    { id: 'prospeccao', nome: 'Prospecção' },
    { id: 'vendas', nome: 'Vendas' },
    { id: 'engenharia', nome: 'Engenharia' },
    { id: 'design', nome: 'Design' },
  ];
  const { linhas, resumo } = estadoAgentes({ departamentos, tarefas: TAREFAS, agora: AGORA });
  const porId = Object.fromEntries(linhas.map((l) => [l.id, l]));

  assert.equal(porId.comando.estado, 'espera-ti', 'a tarefa de briefing é do comando e espera por ti');
  assert.equal(porId.prospeccao.estado, 'bloqueado', 'a de investigar falhou');
  assert.equal(porId.vendas.estado, 'na-fila', 'a de mensagem está na fila');
  assert.equal(porId.engenharia.estado, 'a-trabalhar', 'o código está a correr');
  assert.equal(porId.design.estado, 'sem-trabalho', 'sem tarefas nenhumas — e diz-se');
  assert.equal(porId.prospeccao.ultimaFalha, null, 'a falha vem do servidor, não da lista crua');
  assert.equal(resumo.aTrabalhar, 1);
  assert.equal(resumo.bloqueados, 1);
  assert.equal(resumo.total, 5);
});

test('agentes: aceita as contagens que o servidor já juntou, sem as somar duas vezes', () => {
  const departamentos = [{
    id: 'engenharia', nome: 'Engenharia',
    tarefas: { aCorrer: 3, naFila: 1, porAprovar: 0, concluidas: 12, falhadas: 0 },
    ultima: hAtras(1), ultimaFalha: { error: 'antiga' },
  }];
  const { linhas } = estadoAgentes({ departamentos, tarefas: [], agora: AGORA });
  assert.equal(linhas[0].aCorrer, 3);
  assert.equal(linhas[0].concluidas, 12);
  assert.equal(linhas[0].estado, 'a-trabalhar');
  assert.equal(linhas[0].idade ?? linhas[0].ultimaIdade, '1 h');
});

test('atividade, próximos e bloqueios: ordem por data, e o limite respeitado', () => {
  const eventos = [
    { action: 'lead', detail: '3 novos', at: hAtras(2) },
    { action: 'config', detail: 'salas', at: hAtras(8) },
  ];
  const ativ = atividadeRecente({ eventos, tarefas: TAREFAS, rotulos: { qa: 'Auditoria de qualidade' }, limite: 3 });
  assert.equal(ativ.length, 3);
  assert.ok(ativ[0].quando >= ativ[1].quando, 'do mais recente para o mais antigo');
  assert.ok(ativ.some((i) => /Auditoria de qualidade — concluída/.test(i.titulo)));
  assert.ok(ativ.some((i) => i.tom === 'risk'), 'a falha aparece marcada');

  const prox = proximosTrabalhos({ tarefas: TAREFAS, rotulos: { codigo: 'Gerar o código', mensagem: 'Escrever uma mensagem' }, limite: 5 });
  assert.deepEqual(prox.map((t) => t.estado), ['running', 'awaiting_approval', 'queued']);
  assert.equal(prox[0].titulo, 'Gerar o código');

  const presos = bloqueios({ tarefas: TAREFAS, projetos: [{ id: 'p1', name: 'Site', status: 'qa_falhou', updated_at: hAtras(1) }], rotulos: { investigar: 'Investigar o lead' } });
  assert.equal(presos.length, 2);
  assert.match(presos.map((b) => b.motivo).join(' '), /429/);
  assert.ok(presos.some((b) => b.rota === '#/projeto/p1'));
});

test('frase do estado: diz o que precisa de ti, sem adornos', () => {
  assert.match(fraseDoEstado({ contagens: { bloqueado: 2, aprovar: 1 } }), /bloqueadas/);
  assert.match(fraseDoEstado({ contagens: { aprovar: 1 } }), /precisa da tua aprovação/);
  assert.match(fraseDoEstado({ contagens: { aCorrer: 2 } }), /a correr/);
  assert.match(fraseDoEstado({ contagens: {} }), /Nada à espera de ti/);
  assert.ok(['Bom dia', 'Boa tarde', 'Boa noite'].includes(saudacao(AQUORA_OU_AGORA())));
  function AQUORA_OU_AGORA() { return AGORA; }
});

test('a tabela de salas por tipo é a mesma no browser, no servidor e no armazém local', () => {
  const ler = (ficheiro) => {
    const txt = fs.readFileSync(path.join(AQUI, ficheiro), 'utf8');
    const bloco = txt.slice(txt.indexOf('DEPARTAMENTOS_POR_TIPO'));
    const corpo = bloco.slice(0, bloco.indexOf('}') + 1);
    const pares = {};
    for (const m of corpo.matchAll(/([a-z_]+)\s*:\s*'([a-z]+)'/g)) pares[m[1]] = m[2];
    return pares;
  };
  const servidor = ler('api/_rotas.mjs');
  const local = ler('src/localapi.js');
  assert.deepEqual(servidor, DEPARTAMENTO_POR_TIPO, 'servidor e browser dizem o mesmo');
  assert.deepEqual(local, DEPARTAMENTO_POR_TIPO, 'armazém local e browser dizem o mesmo');
});

/* ══════════════════════════ B. a vista num DOM ══════════════════════════ */

const TAREFAS_API = [
  { id: 't1', kind: 'codigo', state: 'running', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 't2', kind: 'mensagem', state: 'queued', created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: 't3', kind: 'qa', state: 'succeeded', finished_at: new Date(Date.now() - 3 * 3600000).toISOString() },
  { id: 't4', kind: 'investigar', state: 'failed', finished_at: new Date(Date.now() - 4 * 3600000).toISOString(), error: 'o fornecedor recusou (429)' },
  { id: 't5', kind: 'briefing', state: 'awaiting_approval', created_at: new Date(Date.now() - 5 * 3600000).toISOString(), entity_id: 'p1' },
];

const MAPA = {
  '/auth/eu': { user: { id: 'u1', name: 'Valdimiro Oilídio', email: 'dono@orbita.pt', role: 'owner' }, modo: 'base', perms: {} },
  '/ops/summary': { ok: true, leads: { total: 3, comContacto: 2 }, projetos: { total: 1 }, custos: { apiCentimos: 1234 } },
  '/ops/today': { ok: true, decidir: [{ id: 'm1', kind: 'mensagem', channel: 'whatsapp', body: 'Olá! Vi que a clínica abriu uma unidade nova…', lead: { id: 'l1', name: 'Clínica Aurora', score: 82, city: 'Coimbra' } }], presenca: { parado: false } },
  '/ops/leads': { leads: [{ id: 'l1', name: 'Clínica Aurora', status: 'novo', created_at: new Date().toISOString(), phone: '912345678' }] },
  '/ops/projetos': { projetos: [{ id: 'p1', name: 'Site da Aurora', status: 'qa_falhou' }], resumo: { total: 1 }, tipos: [] },
  '/ops/messages': { messages: [] },
  '/ops/clientes': { clientes: [], activo: null },
  '/ops/saldo': {},
  '/ops/tarefas': { tarefas: TAREFAS_API, tipos: { investigar: { label: 'Investigar o lead' }, mensagem: { label: 'Escrever uma mensagem' }, briefing: { label: 'Escrever o briefing' }, codigo: { label: 'Gerar o código' }, qa: { label: 'Auditoria de qualidade' } }, departamentos: [] },
  '/ops/atividade': { eventos: [{ action: 'lead', detail: '3 novos leads', at: new Date(Date.now() - 600000).toISOString() }] },
  '/ops/agentes': { departamentos: [
    { id: 'comando', nome: 'Comando', tarefas: { aCorrer: 0, naFila: 0, porAprovar: 1, concluidas: 2, falhadas: 0 } },
    { id: 'engenharia', nome: 'Engenharia', tarefas: { aCorrer: 1, naFila: 0, porAprovar: 0, concluidas: 5, falhadas: 0 } },
    { id: 'prospeccao', nome: 'Prospecção', tarefas: { aCorrer: 0, naFila: 0, porAprovar: 0, concluidas: 1, falhadas: 1 } },
  ], resumo: { total: 5, running: 1, awaiting: 1 } },
};

async function abrirVistaGeral() {
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: 'https://mesa.test/#/hoje',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        const caminho = u.includes('/api/rpc') ? JSON.parse(opt.body || '{}').caminho : new URL(u, 'https://mesa.test').pathname;
        pedidos.push(caminho);
        const rota = caminho.split('?')[0];
        return { ok: true, status: 200, json: async () => ({ status: 200, corpo: MAPA[rota] ?? {} }) };
      };
    },
  });
  await new Promise((r) => setTimeout(r, 600));
  return { doc: dom.window.document, dom, pedidos };
}

test('DOM: a vista geral responde às quatro perguntas na primeira dobra', async () => {
  const { doc, pedidos } = await abrirVistaGeral();

  /* pediu as tarefas e as salas — é com isso que responde */
  assert.ok(pedidos.some((p) => p.startsWith('/ops/tarefas')), 'lê as tarefas');
  assert.ok(pedidos.some((p) => p.startsWith('/ops/agentes')), 'lê o estado das salas');

  const kpis = [...doc.querySelectorAll('.cc-kpi')];
  assert.equal(kpis.length, 4, 'quatro cartões no topo');
  const texto = kpis.map((k) => k.textContent.replace(/\s+/g, ' ').trim());
  assert.match(texto[0], /A acontecer agora/);
  assert.match(texto[1], /Concluído \(24 h\)/);
  assert.match(texto[2], /Precisa de ti/);
  assert.match(texto[3], /Bloqueado/);

  /* os números do cenário montado: 1 a correr, 1 concluída, 2 à espera, 3 bloqueadas
     (1 tarefa falhada + 1 projeto sem QA … e o valor sai do que veio) */
  assert.match(texto[0], /A acontecer agora\s*1/);
  assert.match(texto[1], /Concluído \(24 h\)\s*1/);
  assert.match(texto[2], /Precisa de ti\s*2/);
  assert.match(texto[3], /Bloqueado\s*2/);

  /* a série de sete dias, desenhada com contagens reais */
  assert.equal(doc.querySelectorAll('.cc-spark i').length, 7);
});

test('DOM: as aprovações têm acções claras (aprovar/rejeitar) e o rascunho abre o cartão', async () => {
  const { doc, dom } = await abrirVistaGeral();
  const aprov = doc.querySelector('.cc-card');
  assert.match(aprov.textContent, /Aprovações pendentes/);

  /* a tarefa à espera tem os dois botões, ligados às acções que já existiam */
  const aprovar = doc.querySelector('[data-act="aprovar-tarefa"]');
  const rejeitar = doc.querySelector('[data-act="rejeitar-tarefa"]');
  assert.ok(aprovar && rejeitar, 'aprovar e rejeitar a tarefa, com botões');
  assert.equal(aprovar.dataset.id, 't5');

  /* o rascunho de mensagem escolhe-se e abre o cartão da decisão com «Aprovar e enviar» */
  const escolher = doc.querySelector('.cc-row-pick[data-act="pick"]');
  assert.ok(escolher, 'o rascunho é escolhível');
  escolher.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(doc.querySelector('[data-act="aprovar"]'), 'o cartão da decisão traz «Aprovar e enviar»');
  assert.match(doc.body.textContent, /Clínica Aurora/);
});

test('DOM: o estado das salas aparece sem abrir o escritório', async () => {
  const { doc } = await abrirVistaGeral();
  const salas = [...doc.querySelectorAll('.cc-ag')];
  assert.equal(salas.length, 3, 'uma linha por sala');
  const texto = salas.map((s) => s.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
  assert.match(texto, /Engenharia.*A trabalhar/);
  assert.match(texto, /Prospecção.*Bloqueado/);
  assert.match(texto, /Comando.*Espera por ti/);
  assert.ok(doc.querySelector('.cc-dot.a-trabalhar'), 'o ponto azul de «a trabalhar» existe');
  assert.match(doc.querySelector('.cc-foot').textContent, /ver todas as salas/);
});

test('DOM: atividade recente, o que vem a seguir e o que está preso', async () => {
  const { doc } = await abrirVistaGeral();
  const txt = doc.body.textContent;
  assert.match(txt, /Atividade recente/);
  assert.match(txt, /3 novos leads/);
  assert.match(txt, /A seguir/);
  assert.match(txt, /Gerar o código/);
  assert.match(txt, /Bloqueado/);
  assert.match(txt, /o fornecedor recusou \(429\)/);
  /* e os números de leads e custos que já existiam não desapareceram */
  assert.match(txt, /Leads e custos/);
  assert.match(txt, /12,34/);
});

test('DOM: a vista é uma só página, sem overflow horizontal declarado nos cartões', () => {
  assert.match(HTML, /\.cc-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(HTML, /\.cc-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.55fr\)\s*minmax\(0,\s*1fr\)/s);
  assert.match(HTML, /@media \(max-width: 1080px\)\s*\{[\s\S]*?\.cc-grid\s*\{\s*grid-template-columns:\s*1fr/s, 'no tablet a coluna lateral desce');
  assert.match(HTML, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.cc-kpis\s*\{\s*grid-template-columns:\s*repeat\(2/s, 'no telemóvel dois cartões por linha');
  assert.match(HTML, /\.cc-row-t span\{?[^}]*overflow-wrap:\s*anywhere/s, 'texto longo não empurra a coluna');
});


/* ---------- 3 nov 2026 · item 1: a sala diz o que se passa lá dentro ---------- */

test('a sala diz O QUE está a fazer — uma contagem não chega para não abrir a sala', () => {
  const DEPTS = [...new Set(Object.values(DEPARTAMENTO_POR_TIPO))].map((id) => ({ id }));
  const deptDe = (kind) => DEPARTAMENTO_POR_TIPO[kind] || 'comando';
  const tarefa = (id, kind, state, created_at, extra = {}) => ({ id, kind, state, created_at, ...extra });

  const ag = estadoAgentes({
    departamentos: DEPTS,
    tarefas: [
      tarefa('t1', 'mensagem', 'running', '2026-11-03T10:00:00Z'),
      tarefa('t2', 'briefing', 'succeeded', '2026-11-03T08:00:00Z'),
      tarefa('t3', 'qa', 'failed', '2026-11-02T09:00:00Z', { error: 'link quebrado na página' }),
    ],
    rotulos: { mensagem: 'Mensagem ao lead', briefing: 'Briefing', qa: 'Qualidade' },
    agora: Date.parse('2026-11-03T11:00:00Z'),
  });

  const trabalha = ag.linhas.find((l) => l.id === deptDe('mensagem'));
  assert.equal(trabalha.titulo, 'Mensagem ao lead', 'a sala a trabalhar diz o trabalho que corre');
  assert.equal(trabalha.aCorrerAgora, true);

  const quieta = ag.linhas.find((l) => l.id === deptDe('briefing'));
  assert.equal(quieta.titulo, 'Briefing', 'uma sala quieta diz o último trabalho que fez');
  assert.equal(quieta.aCorrerAgora, false, 'e não se faz passar por ocupada');

  const presa = ag.linhas.find((l) => l.id === deptDe('qa'));
  assert.equal(presa.titulo, 'Qualidade');
  assert.match(presa.erro, /link quebrado/, 'o motivo da falha vem com a sala, não escondido atrás de um clique');

  assert.ok(ag.linhas.every((l) => 'titulo' in l), 'todas as salas respondem à mesma pergunta');
});

test('a mesa mostra o trabalho da sala na lista de agentes (sem abrir nenhuma)', () => {
  const mesa = fs.readFileSync(new URL('./src/mesa.js', import.meta.url), 'utf8');
  assert.match(mesa, /estadoAgentes\(\{ departamentos: S\.agentes\?\.departamentos \|\| \[\], tarefas, rotulos, agora \}\)/,
    'a vista tem de passar os rótulos das tarefas às salas');
  const ccAgentes = /function ccAgentes\(ag\)[\s\S]*?\n\}/.exec(mesa)[0];
  assert.match(ccAgentes, /l\.titulo/, 'o que a sala está a fazer tem de aparecer na linha dela');
  const css = fs.readFileSync(new URL('./src/mesa.html', import.meta.url), 'utf8');
  assert.match(css, /\.cc-ag-o \{/, 'o título tem estilo próprio (e corta com reticências, não empurra a coluna)');
});
