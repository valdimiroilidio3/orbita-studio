// Órbita — a mesa de trabalho.
//
// Uma superfície sóbria para o que se faz todos os dias: decidir o que sai, ver os leads, ler o
// porquê de cada um, e saber quanto custou e quanto entrou. O escritório 3D fica onde está — os
// agentes vivem lá; aqui é onde o dono decide.
//
// Regras que esta camada não quebra: nada sai sem aprovação; o envio de WhatsApp é um link
// aberto à mão e confirmado depois; o email só sai com token e consentimento, e a recusa é
// mostrada por palavras; e nenhum número aparece sem vir da base de dados.
import { createLocalApi } from './localapi.js';
import { vistaIA, accaoIA, carregarIA, pararSeguimento, abrirRun } from './ia.js';
/* 1.47.0 · digitalizar papel: a câmara, a transcrição e a proposta de lead */
import { vistaPapel, carregarPapel, accaoPapel, ligarPapel, fecharCamera } from './papel.js';

const API = '/api';
/* 30 out 2026 · pedido do dono: «chega de demonstrações só». Publicada, esta página não tem
   `/api` atrás (a Vercel serve ficheiros estáticos). Em vez do cartão que mandava arrancar o
   Órbita na máquina, a mesa passa a funcionar sobre o armazém deste browser — o mesmo contrato
   (`/auth/*`, `/ops/*`), escritas a sério. Quando houver `/api` a sério, é ela que manda. */
let local = null;
let modoLocal = false;
function usarLocal() {
  if (!local) local = createLocalApi();
  modoLocal = true;
  S.modoLocal = true;
  return local;
}
// Autenticado não é autorizado: a mesa esconde o que o papel não permite (o servidor recusa de
// qualquer forma — isto é cortesia, não é a segurança).
const may = perm => S.eu?.perms?.[perm] !== false;
const papelLabel = () => S.eu?.user?.roleLabel || S.eu?.roleLabel || (S.eu?.modo === 'local' ? 'modo local' : '');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = c => (Number(c || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
const LONG_DATE = (() => {
  const d = new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long' });
  return d.replace('-feira', '');
})();
const when = iso => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
};
const hhmm = iso => (iso ? new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const reasonLines = t => String(t || '').split(' · ').map(s => s.replace(/\s*\(\+?-?\d+\)\s*/g, '').trim()).filter(Boolean);

const IC = {
  hoje: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  leads: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2"/><path d="M16.5 5.6a3 3 0 0 1 0 5.6M18 14.6c2 .6 3.4 2.3 3.4 4.6"/></svg>',
  campanhas: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 3 10.5l6.4 2.3L21 3Z"/><path d="m9.4 12.8 2.3 6.4L21 3"/></svg>',
  conversas: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-8 8 8.4 8.4 0 0 1-3.3-.7L4 20.5l1.2-4.3A8 8 0 1 1 20 12Z"/></svg>',
  saldo: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  papel: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 12h8"/></svg>',
  enviar: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 3 10.5l6.4 2.3L21 3Z"/><path d="m9.4 12.8 2.3 6.4L21 3"/></svg>',
  tick: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5 5L20 6.5"/></svg>',
  chev: '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 5 7 7-7 7"/></svg>',
  lupa: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  pastas: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l2 2.5h8A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z"/></svg>',
  tarefa: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 5.6 8 8.5 5"/><path d="M4 12.5 5.6 14l2.9-3"/><path d="M4 18.5 5.6 20l2.9-3"/><path d="M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20"/></svg>',
  ia: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9.5 15.5h5"/></svg>',
  agentes: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.6"/><circle cx="17" cy="9.5" r="2.2"/><path d="M3 19c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6"/><path d="M14.8 14.7c2.6-.4 5.2 1.2 5.2 4.3"/></svg>',
  contas: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.4 3-5.6 7-5.6s7 2.2 7 5.6"/></svg>',
  vazio: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1-1.3 2.2-2 3.5-2s2.5.7 3.5 2"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
};

const NAV = [
  { k: 'hoje', label: 'Hoje', ic: 'hoje' },
  { k: 'leads', label: 'Leads', ic: 'leads' },
  { k: 'papel', label: 'Papel', ic: 'papel' },
  { k: 'projetos', label: 'Projetos', ic: 'pastas' },
  { k: 'tarefas', label: 'Tarefas', ic: 'tarefa' },
  { k: 'agentes', label: 'Agentes', ic: 'agentes' },
  { k: 'ia', label: 'IA', ic: 'ia' },
  { k: 'contas', label: 'Contas', ic: 'contas' },
  { k: 'conversas', label: 'Conversas', ic: 'conversas' },
  { k: 'saldo', label: 'Saldo', ic: 'saldo' },
];

const S = {
  route: { name: 'hoje', id: null },
  summary: null, today: null, leads: [], messages: [], saldo: null, clientes: null,
  lead: null, leadMessages: [], dossier: null, editandoLead: false,
  pick: null, filter: 'todos', q: '', busy: false, error: '', adding: false,
  projetos: [], projeto: null, tipos: [], token: null, addingProject: false,
  tarefas: [], agentes: null, tiposTarefa: [], deptos: [], tarefaFiltro: { dept: null, state: null },
  pipeline: null, atividade: null, addingTask: false, searching: false, results: null,
  eu: null, needLogin: false, authEstado: null, primeiraConta: false, contas: null, sessoes: [],
  /* 1.18.0 · Control Center da IA */
  ia: null, iaUso: null, iaRuns: [], iaRun: null, iaObjetivo: '',
};
const $ = sel => document.querySelector(sel);
const main = () => $('#main');

const TOKEN_KEY = 'orbita.admin.token';
function adminToken() {
  if (S.token !== null) return S.token;
  try { S.token = localStorage.getItem(TOKEN_KEY) || ''; } catch { S.token = ''; }
  return S.token;
}
/* O `/api` não é um encaminhador de caminhos na Vercel (a função só responde no
   caminho exacto do ficheiro), por isso a mesa manda o caminho DENTRO do pedido
   e abre o envelope `{ status, corpo }` aqui. Daqui para baixo nada muda: as
   rotas, os erros e o modo local continuam a falar a mesma língua.
   `GET /api/health` é a excepção: é um ficheiro próprio, plano. */
async function pedirApi(path, method, body) {
  const opt = { method: 'POST', headers: { 'content-type': 'application/json' } };
  const token = adminToken();
  if (token) opt.headers['x-orbita-admin'] = token;
  opt.body = JSON.stringify({ caminho: path, metodo: method, corpo: body ?? null });
  const r = await fetch(API + '/rpc', opt);
  let j = {};
  try { j = await r.json(); } catch { j = {}; }
  if (!r.ok) {
    // 503 sem base, 405, 500: a mesa trata igual — diz o motivo e cai no local
    return { ok: false, status: r.status, json: async () => j };
  }
  const estado = Number(j.status) || 200;
  return { ok: estado >= 200 && estado < 300, status: estado, json: async () => j.corpo || {} };
}

/* 1.18.0 · a vista da IA usa o MESMO `call` da mesa: assim continua a passar pelo
   modo base e pelo modo local, sem um segundo caminho para a rede. */
const apiMesa = { call, S, paint, toast };

async function call(path, method = 'GET', body) {
  let r;
  try {
    r = await pedirApi(path, method, body);
  } catch {
    // sem rede nenhuma: o trabalho continua neste browser
    return usarLocal().call(path, method, body);
  }
  /* 404/405 = não há função nesse caminho. 503 com `modo: 'local'` = há função, mas a base não
     está ligada (sem chaves, ou sem o esquema aplicado). Nos dois casos a mesa não fica em
     branco: continua neste browser, e o aviso diz porquê. */
  if (r.status === 404 || r.status === 405) return usarLocal().call(path, method, body);
  /* O envelope traz o status do caminho DENTRO do JSON (`{status: 404}`) e a
     resposta HTTP é 200. Sem isto, uma rota que a versão publicada ainda não
     tem (foi o caso de /ia/estado e /ia/gratuitos na 1.29) chegava como erro e
     a página ficava presa em «A carregar…» para sempre. 404/405/503 no envelope
     querem dizer o mesmo que no HTTP: esta instalação não tem a rota — usa o
     armazém do browser e di-lo. */
  if (r.status === 503) {
    let motivo = '';
    try { motivo = (await r.json()).error || ''; } catch { /* sem corpo */ }
    S.baseMotivo = motivo || 'a base de dados não respondeu';
    return usarLocal().call(path, method, body);
  }
  S.baseLigada = true;
  let j = {};
  try { j = await r.json(); } catch { /* resposta vazia */ }
  const doCaminho = Number(j?.status);
  if (doCaminho === 404 || doCaminho === 405) return usarLocal().call(path, method, body);
  if (doCaminho === 503) {
    S.baseMotivo = j?.corpo?.error || S.baseMotivo || 'a base de dados não respondeu';
    return usarLocal().call(path, method, body);
  }
  if (r.status === 401) {
    if (j.hint || j.mode === 'sessao' || j.error === 'entra') {
      // instalação com contas: mostra o ecrã de entrada (não um prompt do browser)
      S.needLogin = true;
      throw Object.assign(new Error(j.error || 'entra para continuar'), { login: true, body: j });
    }
    // token de máquina (instalação sem contas): pede uma vez e guarda no browser
    const given = prompt('Este Órbita está protegido. Cola o ORBITA_ADMIN_TOKEN:');
    S.tokenPrompted = true;
    if (given) {
      S.token = given;
      try { localStorage.setItem(TOKEN_KEY, given); } catch { /* sem storage */ }
      return call(path, method, body);
    }
  }
  if (!r.ok || j.ok === false) {
    const e = new Error(j.error || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

/* o ficheiro escolhido substitui o armazém — só depois de o dono confirmar */
function ligarImportacao() {
  document.addEventListener('change', async (e) => {
    if (e.target && e.target.id === 'lbFile') {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const antes = (local || usarLocal()).estado();
        if (antes.leads + antes.projetos > 0 && !confirm(`Isto substitui o que está aqui (${antes.leads} leads, ${antes.projetos} projetos). Continuar?`)) return;
        const r = usarLocal().importar(await f.text());
        toast(`Cópia lida: ${r.leads} leads, ${r.projetos} projetos.`);
        await boot();
      } catch (err) { toast('Não consegui ler essa cópia: ' + err.message, true); }
      e.target.value = '';
    }
  });
}

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), bad ? 6000 : 3800);
}

/* ---------------- navegação ---------------- */
function parseHash() {
  const h = (location.hash || '#/hoje').replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  const known = ['hoje', 'leads', 'papel', 'conversas', 'saldo', 'lead', 'projetos', 'projeto', 'tarefas', 'agentes', 'contas', 'ia'];
  return { name: known.includes(name) ? name : 'hoje', id: id ? decodeURIComponent(id) : null };
}

function paintNav() {
  if (S.needLogin) { $('#nav').innerHTML = ''; $('#tabbar').innerHTML = ''; return; }
  const cur = S.route.name === 'lead' ? 'leads' : S.route.name;
  const pend = S.today?.decidir?.length || 0;
  const nav = NAV.filter(n => n.k !== 'contas' || may('admin')).map(n => `<a href="#/${n.k}" class="${cur === n.k ? 'on' : ''}"${cur === n.k ? ' aria-current="page"' : ''}>${IC[n.ic]}<span>${n.label}</span>${n.k === 'hoje' && pend ? `<span class="n">${pend}</span>` : ''}</a>`).join('');
  $('#nav').innerHTML = nav;
  // No telemóvel cabem seis: o resto (Conversas) fica a um toque a partir de Hoje.
  const TABS = ['hoje', 'leads', 'projetos', 'tarefas', 'agentes', 'saldo'];
  $('#tabbar').innerHTML = NAV.filter(n => TABS.includes(n.k) && (n.k !== 'contas' || may('admin')))
    .map(n => `<a href="#/${n.k}" class="${cur === n.k ? 'on' : ''}"${cur === n.k ? ' aria-current="page"' : ''}>${IC[n.ic]}<span>${n.label}</span></a>`).join('');
}

function paintSideFoot() {
  const s = S.summary;
  const alta = S.leads.filter(l => (l.score || 0) >= 60).length;
  const total = S.leads.length;
  const pct = total ? Math.round((alta / total) * 100) : 0;
  const clientes = S.clientes?.clientes || [];
  const activo = S.clientes?.activo?.id || '';
  $('#sideFoot').innerHTML = `
    ${S.eu ? `<div class="meter" style="margin-bottom:var(--s3)">
      <div class="mrow"><span class="lbl">${esc(S.eu.user?.name || S.eu.user?.email || 'modo local')}</span><b>${esc(papelLabel())}</b></div>
      <button class="btn quiet small" data-act="abrir-contas" style="margin-top:6px">${S.eu.user ? 'Sair' : (may('admin') ? 'Ver contas' : 'Sair')}</button>
      ${S.eu.local ? '<button class="btn quiet small" data-act="abrir-primeira-conta" style="margin-top:6px">Criar conta de dono</button>' : ''}
    </div>` : ''}
    ${clientes.length ? `<div class="espaco"><label for="espaco">Espaço</label>
      <select id="espaco" aria-label="espaço de cliente">${clientes.map(c => `<option value="${esc(c.id)}"${c.id === activo ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>` : ''}
    <div class="meter">
      <div class="mrow"><span class="lbl">Leads com nota alta</span><b>${alta} / ${total || 0}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <small>Custos de API (30 d): ${s ? money(s.custos?.apiCentimos) : '—'}</small>
    </div>`;
  const sel = $('#espaco');
  if (sel) sel.addEventListener('change', async () => {
    try {
      const r = await call(`/ops/clientes/${encodeURIComponent(sel.value)}/entrar`, 'POST', {});
      toast(`Agora em «${r.cliente.nome}».`);
      await boot(true);
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------------- dados ---------------- */
async function loadEu() {
  try {
    S.eu = await call('/auth/eu');
    S.needLogin = false;
    S.horasSessao = S.eu.horasSessao || S.horasSessao;
    return true;
  } catch (e) {
    if (e.login) {
      S.needLogin = true;
      S.primeiraConta = !!e.body?.primeiraContaPossivel;
      S.authEstado = e.body?.estado || null;
      S.eu = null;
      return false;
    }
    throw e;
  }
}

async function loadContas() {
  const [u, sessoes] = await Promise.all([
    call('/ops/utilizadores').catch(() => ({ utilizadores: [], papeis: [] })),
    call('/ops/sessoes').catch(() => ({ sessoes: [] })),
  ]);
  S.contas = u;
  S.sessoes = sessoes.sessoes || [];
}

async function loadCommon() {
  const [summary, today, leads, messages, saldo, clientes, projetos] = await Promise.all([
    call('/ops/summary').catch(() => null),
    call('/ops/today').catch(() => null),
    call('/ops/leads?limit=200').catch(() => ({ leads: [] })),
    call('/ops/messages?limit=100').catch(() => ({ messages: [] })),
    call('/ops/saldo').catch(() => null),
    call('/ops/clientes').catch(() => null),
    call('/ops/projetos').catch(() => ({ projetos: [], resumo: null, tipos: [] })),
  ]);
  S.summary = summary;
  S.today = today;
  S.leads = leads.leads || [];
  S.messages = messages.messages || [];
  S.saldo = saldo;
  S.clientes = clientes;
  S.projetos = projetos.projetos || [];
  S.projetosResumo = projetos.resumo || null;
  S.tipos = projetos.tipos || [];
}

async function loadTarefas() {
  const f = S.tarefaFiltro || {};
  const qs = new URLSearchParams({ limit: '100' });
  if (f.dept) qs.set('departamento', f.dept);
  if (f.state) qs.set('estado', f.state);
  const r = await call('/ops/tarefas?' + qs.toString());
  S.tarefas = r.tarefas || [];
  S.tiposTarefa = r.tipos ? Object.entries(r.tipos).map(([id, t]) => ({ id, ...t })) : S.tiposTarefa;
  S.deptos = r.departamentos || S.deptos;
}

async function loadAgentes() {
  const [a, at] = await Promise.all([
    call('/ops/agentes').catch(() => null),
    call('/ops/atividade?limit=20').catch(() => null),
  ]);
  S.agentes = a;
  S.atividade = at;
}

async function loadPipeline() {
  S.pipeline = await call('/ops/pipeline').catch(() => null);
}

async function loadProjeto(id) {
  const r = await call(`/ops/projetos/${encodeURIComponent(id)}`);
  S.projeto = r;
}

async function loadLead(id) {
  const r = await call(`/ops/leads/${encodeURIComponent(id)}`);
  S.lead = r.lead;
  S.editandoLead = false;   // abrir outro lead nunca herda o formulário do anterior
  S.dossier = r.dossier || null;
  S.leadMessages = r.messages || [];
}

async function boot(full = true) {
  try {
    if (full) {
      if (!(await loadEu())) { paintNav(); paint(); return; }
      await loadCommon();
    }
    if (S.route.name === 'lead' && S.route.id) await loadLead(S.route.id);
    if (S.route.name === 'projeto' && S.route.id) await loadProjeto(S.route.id);
    if (S.route.name === 'tarefas') await loadTarefas();
    if (S.route.name === 'agentes') await loadAgentes();
    if (S.route.name === 'contas') await loadContas();
    if (S.route.name === 'ia') await carregarIA(apiMesa);
    if (S.route.name === 'papel' && !S.papelEstado) await carregarPapel(apiMesa);
    if (S.route.name === 'leads' && !S.pipeline) await loadPipeline();
    S.error = '';
  } catch (e) { S.error = e.message; }
  paintNav();
  paintSideFoot();
  paint();
}

/* ---------------- pedaços visuais ---------------- */
const scoreClass = n => (n >= 75 ? '' : n >= 55 ? 'mid' : 'low');
const scoreBadge = n => `<span class="badge ${scoreClass(n || 0)}">${n ?? 0} pontos</span>`;
const statusLabel = {
  novo: 'Novo', qualificado: 'Qualificado', contactado: 'Contactado', respondeu: 'Respondeu',
  reuniao: 'Reunião', em_negociacao: 'Em negociação', proposta: 'Proposta enviada', cliente: 'Ganho', perdido: 'Perdido',
};
const NEXT_STATUS = {
  novo: ['qualificado', 'contactado', 'perdido'], qualificado: ['contactado', 'perdido'],
  contactado: ['respondeu', 'em_negociacao', 'perdido'], respondeu: ['reuniao', 'em_negociacao', 'perdido'],
  reuniao: ['em_negociacao', 'cliente', 'perdido'], em_negociacao: ['proposta', 'reuniao', 'perdido'],
  proposta: ['cliente', 'em_negociacao', 'perdido'], cliente: [], perdido: ['novo'],
};
const PROJ_LABEL = { rascunho: 'Rascunho', gerado: 'Código gerado', qa_passou: 'QA aprovado', qa_falhou: 'QA falhou', aprovado: 'Aprovado', entregue: 'Entregue' };
const PROJ_TAG = { rascunho: '', gerado: 'novo', qa_passou: 'respondeu', qa_falhou: 'perdido', aprovado: 'cliente', entregue: 'cliente' };

function headHTML({ title, sub, right = '' }) {
  return `<div class="head"><div><h1>${esc(title)}</h1><div class="sub">${sub}</div></div><div class="head-acts">${right}</div></div>`;
}

function stopPill() {
  const parado = !!S.today?.presenca?.parado;
  if (!may('approve')) return `<span class="pill" title="o teu papel não permite parar envios">${IC.enviar}<span>${parado ? 'Envios parados' : 'Envios ativos'}</span></span>`;
  return `<button class="pill ${parado ? 'stop' : ''}" data-act="toggle-stop" title="${parado ? 'retomar todos os envios' : 'parar todos os envios'}">
    ${IC.enviar}<span>${parado ? 'Envios parados' : 'Envios ativos'}</span></button>`;
}

function statsHTML() {
  const s = S.summary;
  if (!s) return '';
  const ontem = Date.now() - 86400000;
  const novos = S.leads.filter(l => l.created_at && new Date(l.created_at).getTime() >= ontem).length;
  const contacto = S.leads.filter(l => l.phone || l.email).length;
  const respostas = S.leads.filter(l => l.responded_at && new Date(l.responded_at).getTime() >= ontem).length;
  return `<div class="stats">
    <div class="stat"><b>${novos}</b><span>leads novos esta noite</span></div>
    <div class="stat"><b>${contacto}</b><span>com telefone ou email</span></div>
    <div class="stat"><b class="blue">${respostas}</b><span>respostas desde ontem</span></div>
    <div class="stat"><b>${money(s.custos?.apiCentimos)}</b><span>custo das APIs (30 dias)</span></div>
  </div>`;
}

/* ---------------- Hoje ---------------- */
function decisions() {
  const d = S.today?.decidir || [];
  return d.filter(c => c && (c.kind === 'mensagem' || c.kind === 'autonomia'));
}

function pickDecision() {
  const list = decisions();
  if (!list.length) return null;
  return list.find(d => d.id === S.pick) || list[0];
}

function whyItems(lead, dossier) {
  const items = [];
  for (const r of reasonLines(lead?.score_reasons || lead?.reasons || '')) items.push(r);
  for (const e of (dossier?.evidence || []).map(x => x.label).filter(Boolean)) if (items.length < 6) items.push(e);
  return items.slice(0, 6);
}

function decisionCard() {
  const d = pickDecision();
  if (!d) {
    return `<div class="card empty">${IC.vazio}
      <h3>Nada à espera de ti</h3>
      <p>Quando houver um rascunho para aprovar, aparece aqui — com o porquê escrito e o texto pronto. Não há nada escondido: se a lista está vazia, é porque não há trabalho teu pendente.</p>
    </div>`;
  }
  if (d.kind === 'autonomia') {
    return `<div class="card">
      <div class="detail-top"><div><h3>${esc(d.lead?.name || 'Autonomia')}</h3>
        <div class="mt">${esc(d.text || '')}</div></div><span class="badge blue">proposta</span></div>
      <div class="acts"><button class="btn primary" data-act="auto-up" data-scope="${esc(d.id)}">Dar autonomia a este tipo</button>
        <button class="btn ghost" data-act="auto-down" data-scope="${esc(d.id)}">Manter a pedir</button></div>
      <div class="hint">A autonomia continua sujeita ao opt-out, ao PARAR TUDO e ao modo ensaio. Podes revogar com um toque.</div>
    </div>`;
  }
  const lead = d.lead || {};
  const items = [...reasonLines(d.why || ''), ...((d.evidence || []).map(e => e.label))].filter(Boolean).slice(0, 6);
  const acts = d.status === 'aprovada'
    ? `<button class="btn primary" data-act="abrir" data-id="${esc(d.id)}">Abrir WhatsApp</button>
       <button class="btn ghost" data-act="confirmar" data-id="${esc(d.id)}">Já enviei</button>`
    : `<button class="btn ghost" data-act="rejeitar" data-id="${esc(d.id)}">Rejeitar</button>
       <button class="btn primary" data-act="aprovar" data-id="${esc(d.id)}">Aprovar e enviar</button>`;
  return `<div class="card">
    <div class="detail-top">
      <div><h3>${esc(lead.name || 'Sem nome')}</h3>
        <div class="mt">${esc([lead.category, lead.city].filter(Boolean).join(' · ') || 'sem nicho nem cidade')}</div></div>
      ${scoreBadge(lead.score)}
    </div>
    <div class="msg-label">${IC.enviar}<span>Mensagem para ${d.channel === 'whatsapp' ? 'WhatsApp' : 'email'} · sai só depois de aprovares</span></div>
    ${d.subject ? `<div class="hint" style="margin:0 0 6px"><b>${esc(d.subject)}</b></div>` : ''}
    <div class="bubble">${esc(d.body)}</div>
    <details class="why-box">
      <summary><span>Porquê este lead<small>${items.length} sinais · abre para ver</small></span>${IC.chev}</summary>
      <div class="why-grid">${items.length
        ? items.map(x => `<div class="why"><span class="tick">${IC.tick}</span><span>${esc(x)}</span></div>`).join('')
        : '<div class="why"><span>Sem sinais guardados para este lead.</span></div>'}</div>
      ${d.why ? `<div class="hint">${esc(d.why)}</div>` : ''}
      ${d.predictions?.length ? `<div class="hint">Objeções previstas: ${d.predictions.map(p => esc(p.label || p)).join(' · ')}</div>` : ''}
    </details>
    <div class="acts">${acts}</div>
    <div class="hint">Deslizar não é preciso: cada botão faz o mesmo. O envio de WhatsApp é um link que tu abres.</div>
  </div>`;
}

function viewHoje() {
  const list = decisions();
  const pick = pickDecision();
  const n = list.length;
  return `<div class="wrap">
    ${headHTML({
      title: 'Hoje',
      sub: `${esc(LONG_DATE)}${n ? ` · <b>${n}</b> ${n === 1 ? 'lead à espera' : 'leads à espera'} da tua decisão` : ' · nada à espera de ti'}`,
      right: stopPill(),
    })}
    ${statsHTML()}
    <div class="split">
      <div>
        <div class="sec-h"><h2>Precisa de ti</h2><span class="count">${n ? `${n} por decidir` : 'em dia'}</span></div>
        <div class="list">${list.map(d => {
          const l = d.lead || {};
          const on = pick && d.id === pick.id;
          return `<button class="item ${on ? 'on' : ''}" data-act="pick" data-id="${esc(d.id)}">
            <div class="who"><div class="nm">${esc(l.name || 'Autonomia')}</div>
              <div class="mt">${esc(d.kind === 'autonomia' ? 'proposta de autonomia' : [l.category, l.city].filter(Boolean).join(' · ') || d.channel)}</div></div>
            ${d.kind === 'autonomia' ? '<span class="badge blue">novo</span>' : scoreBadge(l.score)}
          </button>`;
        }).join('') || `<div class="card empty">${IC.vazio}<h3>Sem decisões pendentes</h3>
          <p>Um rascunho aparece aqui assim que houver um. Para haver rascunhos, é preciso haver leads: procura-os em ◈ LEADS no escritório, ou escreve à mão na página de um lead.</p></div>`}</div>
      </div>
      <div>${decisionCard()}</div>
    </div>
  </div>`;
}

/* ---------------- Leads ---------------- */
function filteredLeads() {
  const q = S.q.trim().toLowerCase();
  return S.leads.filter(l => {
    if (S.filter === 'sem-site' && (l.website || l.domain)) return false;
    if (S.filter === 'novo' && l.status !== 'novo') return false;
    if (S.filter === 'responderam' && !['respondeu', 'reuniao', 'cliente'].includes(l.status)) return false;
    if (!q) return true;
    return [l.name, l.city, l.category, l.phone, l.email, l.website].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}

function searchBar() {
  const r = S.results;
  return `<div style="margin-bottom:var(--s4)">
    <div class="search">${IC.lupa}<input id="gq" type="search" placeholder="Pesquisar leads, projetos e tarefas…" value="${esc(S.gq || '')}" aria-label="pesquisa global"></div>
    ${r ? (r.total ? `<div class="card" style="margin-top:var(--s2)">
      ${r.grupos.map(g => `<div class="sec-h" style="margin-top:0"><h3 style="font-size:var(--t-s)">${esc(g.label)}</h3><span class="count">${g.itens.length}</span></div>
        <ul class="feed">${g.itens.map(i => `<li><a href="${esc(i.route)}" style="text-decoration:none;color:inherit"><b>${esc(i.name || i.title || i.id)}</b> <span class="count">${esc(i.city || i.client || i.kindLabel || '')}</span></a></li>`).join('')}</ul>`).join('')}
    </div>` : `<div class="hint" style="margin-top:var(--s2)">Nada encontrado para «${esc(r.query)}» — nem leads, nem projetos, nem tarefas.</div>`)
      : (r === null && S.gq ? '' : '')}
  </div>`;
}

function pipelineCard() {
  const p = S.pipeline;
  if (!p || !p.totalLeads) return '';
  return `<div class="card" style="margin-bottom:var(--s4)">
    <div class="sec-h"><h3>Funil</h3><span class="count">${p.totalLeads} leads · ${p.conversaoTotal ?? '—'}% chegam a ganho</span></div>
    <div class="stats" style="margin-bottom:var(--s3)">
      ${p.fases.map(f => `<div class="stat"><b>${f.leads}</b><span>${esc(f.label)}${f.conversao != null ? ` · ${f.conversao}%` : ''}</span></div>`).join('')}
    </div>
    ${p.porOrigem.length ? `<table><tbody>${p.porOrigem.map(o => `<tr><td>${esc(o.origem)}</td><td class="n">${o.total} leads</td><td class="n">${o.ganhos} ganhos</td><td class="n">${o.taxa != null ? o.taxa + '%' : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    ${p.paradas.lista.length ? `<div class="hint" style="margin-top:var(--s2)"><b>${p.paradas.lista.length} oportunidade(s)</b> sem atividade há mais de ${p.paradas.dias} dias: ${p.paradas.lista.slice(0, 4).map(l => esc(l.name) + ' (' + l.dias_parado + ' d)').join(' · ')}${p.paradas.lista.length > 4 ? ' …' : ''}</div>`
      : '<div class="hint" style="margin-top:var(--s2)">Nenhuma oportunidade parada há mais de 14 dias.</div>'}
    ${p.perdidos ? `<div class="hint">${p.perdidos} perdido(s) — o motivo fica nas notas do lead.</div>` : ''}
  </div>`;
}

/* 1.34.0 · procurar leads a partir da mesa. Antes, quem estava na mesa tinha de
   ir ao escritório (◈ LEADS) para uma pesquisa real; agora a mesma rota
   `/pesquisa/leads` (Geoapify, com dedupe) é chamada daqui e o que volta entra
   no funil. «Procurar mais» repete com um limite maior — é a única forma
   honesta de trazer mais: o fornecedor não tem paginação, tem teto. */
function procurarLeadsForm() {
  const p = S.procura || {};
  return `<div class="card" style="margin-bottom:var(--s4)">
    <div class="sec-h"><h3>Procurar leads reais</h3><span class="count">${esc(p.fonte || 'Geoapify')} · sem duplicados</span></div>
    <div class="form three">
      <input class="in" id="plNicho" placeholder="Nicho (ex.: barbearias)" aria-label="nicho a procurar" value="${esc(p.nicho || '')}" autocomplete="off">
      <input class="in" id="plCidade" placeholder="Cidade ou zona" aria-label="cidade a procurar" value="${esc(p.cidade || '')}" autocomplete="off">
      <select class="in" id="plQuantos" aria-label="quantos pedir">
        ${[20, 40, 60, 100].map(n => `<option value="${n}"${Number(p.limite) === n ? ' selected' : ''}>${n} de cada vez</option>`).join('')}
      </select>
    </div>
    <div class="acts" style="margin-top:var(--s2)">
      <button class="btn primary" data-act="procurar-leads">Procurar e guardar</button>
      ${p.nicho || p.cidade ? `<button class="btn ghost" data-act="procurar-leads" data-mais="1">Procurar mais</button>` : ''}
    </div>
    <div class="hint">Cada pesquisa é um pedido real ao fornecedor de empresas. O que voltar é comparado com o que já tens: o repetido actualiza-se, o novo entra como «por contactar».</div>
  </div>`;
}

function novoLeadForm() {
  return `<div class="card" style="margin-bottom:var(--s4)">
    <div class="sec-h"><h3>Acrescentar um lead à mão</h3><span class="count">fica guardado e pontuado</span></div>
    <div class="form three">
      <input class="in" id="nlNome" placeholder="Nome" aria-label="nome">
      <input class="in" id="nlNicho" placeholder="Nicho (ex.: barbearias)" aria-label="nicho">
      <input class="in" id="nlCidade" placeholder="Cidade" aria-label="cidade">
    </div>
    <div class="form two" style="margin-top:var(--s2)">
      <input class="in" id="nlTelefone" placeholder="Telefone" aria-label="telefone">
      <input class="in" id="nlSite" placeholder="Site (se tiver)" aria-label="site">
      <button class="btn primary small" data-act="guardar-lead" style="padding:0 var(--s5)">Guardar</button>
    </div>
    <div class="hint">O melhor caminho é não escreveres nada disto à mão: abre <b>◈ LEADS</b> na barra, escolhe a atividade e a zona, e o que voltar fica guardado, pontuado e sem duplicados. O que escreveres aqui é pontuado pelas mesmas regras.</div>
  </div>`;
}

function viewLeads() {
  const list = filteredLeads();
  const total = S.leads.length;
  const alta = S.leads.filter(l => (l.score || 0) >= 60).length;
  const chips = [['todos', 'Todos'], ['novo', 'Por contactar'], ['sem-site', 'Sem site'], ['responderam', 'Responderam']];
  return `<div class="wrap">
    ${headHTML({
      title: 'Leads',
      sub: total ? `${total} guardados · ${alta} com nota alta · ${S.leads.filter(l => !['novo'].includes(l.status)).length} já contactados` : 'ainda não há nenhum lead guardado',
      right: `${may('write') ? '<button class="btn small ghost" data-act="actualizar-leads" title="voltar a ler os leads da base">↻ Actualizar</button><button class="btn small ghost" data-act="novo-lead">+ Lead</button>' : ''}${stopPill()}`,
    })}
    ${procurarLeadsForm()}
    ${S.adding ? novoLeadForm() : ''}
    ${searchBar()}
    ${pipelineCard()}
    <div class="tools">
      <div class="search">${IC.lupa}<input id="q" type="search" placeholder="Procurar por nome, cidade, nicho…" value="${esc(S.q)}" aria-label="procurar leads"></div>
      ${chips.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`).join('')}
    </div>
    ${list.length ? `<div class="rows">${list.map(l => `<button class="row" data-act="ver-lead" data-id="${esc(l.id)}">
      <div><div class="nm">${esc(l.name)}</div><div class="mt">${esc([l.category, l.city].filter(Boolean).join(' · ') || 'sem nicho nem cidade')}</div></div>
      <div class="cell hide-m">${esc(l.website ? l.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : (l.phone || l.email || 'sem contacto'))}</div>
      <div class="cell"><span class="tag ${esc(l.status)}">${esc(statusLabel[l.status] || l.status)}</span></div>
      ${scoreBadge(l.score)}
    </button>`).join('')}</div>`
      : `<div class="card empty">${IC.vazio}<h3>${total ? 'Nenhum lead neste filtro' : 'Ainda não há leads guardados'}</h3>
        <p>${total
          ? 'Nada corresponde a esta procura. Limpa a pesquisa ou escolhe outro filtro — os dados que existem estão todos aqui.'
          : 'Procura aqui mesmo: escreve o nicho e a cidade no cartão «Procurar leads reais» e o que o fornecedor devolver entra nesta lista, pontuado e sem duplicados. Se preferires, podes acrescentá-los à mão.'}</p></div>`}
  </div>`;
}

/* ---------------- o lead: aprovação, factos, histórico ---------------- */
function currentMessage() {
  const order = { revisao: 0, rascunho: 1, ensaio: 2, aprovada: 3, enviada: 4, falhou: 5, bloqueada: 6, rejeitada: 7 };
  /* 1.37.0 · as respostas que chegam (direction 'in') são conversa, não são o
     rascunho a decidir: se entrassem aqui, a mesa mostrava «Sem mensagem ainda»
     a um lead que já respondeu. */
  return [...S.leadMessages]
    .filter((m) => m.direction !== 'in' && m.status !== 'recebida')
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))[0] || null;
}

function leadMessageCard(m) {
  if (!m) {
    const sinais = reasonLines(S.lead?.score_reasons || '');
    return `<div class="card">
      <div class="sec-h"><h3>Sem mensagem ainda</h3><span class="count">${S.leadMessages.length ? S.leadMessages.length + ' já escritas' : 'nenhuma escrita'}</span></div>
      <p class="hint" style="margin-top:0">Primeiro lê o que o negócio diz de si; depois escreve com esses factos. A mensagem nasce rascunho e não sai sem o teu OK.</p>
      ${sinais.length ? `<div class="why-grid">${sinais.slice(0, 6).map(x => `<div class="why"><span class="tick">${IC.tick}</span><span>${esc(x)}</span></div>`).join('')}</div>` : ''}
      <div class="acts" style="justify-content:center">
        <button class="btn ghost" data-act="pesquisar">Ler o site</button>
        <button class="btn primary" data-act="escrever">Escrever mensagem</button>
      </div>
      <div class="hint" id="leadNote"></div>
    </div>`;
  }
  const st = m.status;
  const items = [
    ...reasonLines(S.lead?.score_reasons || ''),
    ...((S.dossier?.evidence || []).map(e => e.label)),
  ].filter(Boolean).slice(0, 6);
  const acts = st === 'rascunho' || st === 'ensaio'
    ? `<button class="btn ghost" data-act="rejeitar" data-id="${esc(m.id)}">Rejeitar</button>
       <button class="btn primary" data-act="aprovar" data-id="${esc(m.id)}">${st === 'ensaio' ? 'Promover e aprovar' : 'Aprovar e enviar'}</button>`
    : st === 'aprovada'
      ? (m.channel === 'email'
        ? `<button class="btn primary" data-act="enviar" data-id="${esc(m.id)}">Enviar agora</button>
           <button class="btn ghost" data-act="confirmar" data-id="${esc(m.id)}">Já enviei</button>`
        : `<button class="btn primary" data-act="abrir" data-id="${esc(m.id)}">Abrir WhatsApp</button>
           <button class="btn ghost" data-act="confirmar" data-id="${esc(m.id)}">Já enviei</button>`)
      : st === 'falhou'
        ? `<button class="btn primary" data-act="enviar" data-id="${esc(m.id)}">Tentar outra vez</button>
           <button class="btn ghost" data-act="escrever">Escrever outra</button>
           <div class="hint" style="width:100%">O último envio falhou: ${esc(m.erro || 'sem motivo guardado')}</div>`
        : st === 'enviada'
        ? `<button class="btn ghost" data-act="sinal" data-id="${esc(m.id)}" data-kind="respondeu">Respondeu</button>
           <button class="btn ghost" data-act="sinal" data-id="${esc(m.id)}" data-kind="recusou">Recusou</button>`
        : `<button class="btn primary" data-act="escrever">Escrever outra</button>`;
  const estado = {
    rascunho: 'por aprovar', ensaio: 'em ensaio — não sai', aprovada: 'aprovada — falta enviar',
    enviada: 'enviada', rejeitada: 'rejeitada', bloqueada: 'bloqueada (opt-out)', falhou: 'falhou', revisao: 'para rever',
  }[st] || st;
  return `<div class="card">
    <div class="msg-label">${IC.enviar}<span>Mensagem para ${m.channel === 'whatsapp' ? 'WhatsApp' : 'email'} · ${esc(estado)}</span></div>
    ${m.subject ? `<div class="hint" style="margin:0 0 6px"><b>${esc(m.subject)}</b></div>` : ''}
    <div class="bubble">${esc(m.body)}</div>
    <details class="why-box" ${items.length ? '' : 'hidden'}>
      <summary><span>Porquê este lead<small>${items.length} sinais · abre para ver</small></span>${IC.chev}</summary>
      <div class="why-grid">${items.map(x => `<div class="why"><span class="tick">${IC.tick}</span><span>${esc(x)}</span></div>`).join('')}</div>
      ${m.why ? `<div class="hint">${esc(m.why)}</div>` : ''}
    </details>
    <div class="acts">${acts}</div>
    <div class="hint" id="leadNote">${m.status === 'ensaio' ? 'Modo ensaio ligado: esta mensagem não sai. Aprovar promove-a a rascunho a sério.'
      : m.status === 'enviada' ? `Saiu${m.enviada_at ? ` em ${esc(when(m.enviada_at))}` : ''}${m.provider ? ` por ${esc(m.provider)}` : ''}${m.provider_id ? ` · ${esc(m.provider_id)}` : ''}${m.confirmada === 'humano' ? ' (confirmada à mão)' : ''}.`
      : 'Nada sai sem o teu OK. Com as chaves no servidor, o email sai pela Resend e o WhatsApp pela Cloud API; sem elas, o WhatsApp abre na app e confirma-se aqui — quem confirma é uma pessoa.'}</div>
  </div>`;
}

/* 1.36.0 · editar o lead sem sair da mesa (pedido 57e: «actualizar» também é
   corrigir o que está errado). Os campos são os que a API aceita em PATCH —
   telefone, email, site, nicho, cidade e notas — e a nota de estado (funil)
   continua a ser dada pelos botões do funil, para não haver dois caminhos para
   a mesma decisão. Vazio quer dizer «não sei», e apaga o que lá estava. */
function leadEditForm() {
  const l = S.lead || {};
  const campo = (id, rotulo, valor, tipo = 'text', extra = '') =>
    `<label class="fld"><span>${esc(rotulo)}</span><input class="in" id="${id}" type="${tipo}" value="${esc(valor || '')}" ${extra}></label>`;
  return `<div class="card">
    <div class="sec-h"><h3>Editar este lead</h3><span class="count">o que está errado corrige-se aqui</span></div>
    <div class="form two pares">
      ${campo('elTelefone', 'Telefone', l.phone, 'tel', 'inputmode="tel" placeholder="+351 …"')}
      ${campo('elEmail', 'Email', l.email, 'email', 'placeholder="nome@empresa.pt"')}
    </div>
    <div class="form two pares" style="margin-top:var(--s2)">
      ${campo('elSite', 'Site', l.website, 'text', 'placeholder="empresa.pt"')}
      ${campo('elNicho', 'Nicho', l.category, 'text', 'placeholder="dentista, restaurante…"')}
    </div>
    <div class="form pares" style="margin-top:var(--s2)">
      ${campo('elCidade', 'Cidade', l.city, 'text', 'placeholder="Coimbra"')}
    </div>
    <label class="fld" style="margin-top:var(--s2)"><span>Notas</span>
      <textarea class="in" id="elNotas" rows="3" placeholder="o que sabes e não cabe nos campos">${esc(l.notes || '')}</textarea></label>
    <div class="acts" style="margin-top:var(--s3)">
      <button class="btn primary" data-act="guardar-edicao-lead" data-id="${esc(l.id)}">Guardar alterações</button>
      <button class="btn ghost" data-act="cancelar-edicao-lead">Cancelar</button>
    </div>
    <div class="hint">Deixar um campo vazio apaga-o — «não sei» é melhor do que um telefone errado. O histórico de mensagens não é tocado.</div>
  </div>`;
}

function leadFacts() {
  const l = S.lead;
  const r = S.dossier?.research || { status: 'por_fazer' };
  const rows = [
    ['Telefone', l.phone || '—'],
    ['Email', l.email || '—'],
    ['Site', l.website || '—'],
    ['Avaliação', l.rating ? `${Number(l.rating).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★ · ${l.reviews || 0} opiniões` : '—'],
    ['Origem', l.source || '—'],
    ['Estado', statusLabel[l.status] || l.status],
  ];
  const research = r.status === 'ok'
    ? `Lido ${when(r.fetchedAt)} · ${(S.dossier?.evidence || []).length} factos`
    : r.status === 'falhou'
      ? `Não consegui ler: ${esc(r.reason || 'sem motivo guardado')}`
      : 'ainda não li este site';
  return `<div class="card">
    <div class="sec-h"><h3>O que sabemos</h3><button class="btn small ghost" data-act="pesquisar">Ler o site</button></div>
    <table><tbody>${rows.map(([k, v]) => `<tr><td style="color:var(--muted)">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
    <div class="hint">${research}</div>
    ${(S.dossier?.evidence || []).length ? `<div class="hint">${S.dossier.evidence.map(e => `${esc(e.label)}${e.quote ? ` — «${esc(String(e.quote).slice(0, 90))}»` : ''}`).join(' · ')}</div>` : ''}
    ${(S.dossier?.quotes || []).length ? `<div class="hint">Citações guardadas: ${S.dossier.quotes.slice(0, 2).map(q => `«${esc(q)}»`).join(' · ')}</div>` : ''}
  </div>`;
}

function leadHistory() {
  if (!S.leadMessages.length) return '';
  const label = { rascunho: 'rascunho', ensaio: 'ensaio', aprovada: 'aprovada', enviada: 'enviada', rejeitada: 'rejeitada', bloqueada: 'bloqueada', falhou: 'falhou', revisao: 'a rever', recebida: 'respondeu' };
  const respostas = S.leadMessages.filter(m => m.status === 'recebida' || m.direction === 'in').length;
  return `<div class="card">
    <div class="sec-h"><h3>Histórico</h3><span class="count">${S.leadMessages.length} mensagem(ns)${respostas ? ` · ${respostas} do cliente` : ''}</span></div>
    <table><tbody>${S.leadMessages.map(m => {
      const dentro = m.status === 'recebida' || m.direction === 'in';
      return `<tr>
      <td style="color:var(--muted);white-space:nowrap">${esc(hhmm(m.created_at))} · ${esc(when(m.created_at))}</td>
      <td>${dentro ? '<b>← </b>' : '<span style="color:var(--muted)">→ </span>'}${esc(String(m.body).slice(0, 70))}${String(m.body).length > 70 ? '…' : ''}</td>
      <td class="n"><span class="tag ${dentro || m.status === 'enviada' ? 'respondeu' : m.status === 'rejeitada' ? 'perdido' : ''}">${esc(label[m.status] || m.status)}</span></td>
    </tr>`;
    }).join('')}</tbody></table>
  </div>`;
}

function viewLead() {
  const l = S.lead;
  if (!l) return `<div class="wrap"><div class="skeleton">a abrir o lead…</div></div>`;
  const m = currentMessage();
  const next = NEXT_STATUS[l.status] || [];
  const projetoDoLead = S.projetos.find(p => p.lead_id === l.id);
  return `<div class="wrap">
    <div style="margin-bottom:var(--s3)"><a href="#/leads" class="btn quiet small">‹ Leads</a></div>
    <div class="head">
      <div><h1 style="font-size:34px">${esc(l.name)}</h1>
        <div class="sub">${esc([l.category, l.city].filter(Boolean).join(' · ') || 'sem nicho nem cidade')}${l.rating ? ` · ${Number(l.rating).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★` : ''}${l.source ? ` · ${esc(l.source)}` : ''}</div></div>
      <div class="head-acts">${scoreBadge(l.score)}<span class="tag ${esc(l.status)}">${esc(statusLabel[l.status] || l.status)}</span>
        ${may('write') ? `<button class="btn small ghost" data-act="editar-lead" title="corrigir telefone, email, site, nicho ou notas">✎ Editar</button>` : ''}</div>
    </div>
    ${leadMessageCard(m)}
    <div style="display:grid;gap:var(--s4);margin-top:var(--s4)">
      ${S.editandoLead ? leadEditForm() : leadFacts()}
      ${projetoDoLead
        ? `<div class="card"><div class="sec-h"><h3>Projeto</h3><span class="tag ${PROJ_TAG[projetoDoLead.status]}">${esc(PROJ_LABEL[projetoDoLead.status] || projetoDoLead.status)}</span></div>
            <p class="hint" style="margin-top:0">${esc(projetoDoLead.name)}</p>
            <div class="acts" style="margin-top:var(--s3)"><a class="btn primary small" href="#/projeto/${esc(projetoDoLead.id)}">Abrir projeto</a></div></div>`
        : `<div class="card"><div class="sec-h"><h3>Projeto</h3><span class="count">ainda não existe</span></div>
            <p class="hint" style="margin-top:0">Um projeto nasce desta oportunidade: o briefing é escrito com o que já se sabe e o código é gerado a partir dele. Um negócio, um projeto.</p>
            <div class="acts" style="margin-top:var(--s3)"><button class="btn primary small" data-act="criar-projeto" data-id="${esc(l.id)}">Criar projeto</button></div></div>`}
      ${leadHistory()}
      ${next.length ? `<div class="card"><div class="sec-h"><h3>Funil</h3><span class="count">sem saltos</span></div>
        <div class="acts" style="margin-top:0">${next.map(s => `<button class="btn ghost small" data-act="estado" data-id="${esc(l.id)}" data-status="${s}">Marcar ${esc(statusLabel[s])}</button>`).join('')}</div>
        <div class="hint">O funil é novo → contactado → respondeu → reunião → cliente. Saltar passos é recusado, e a recusa diz porquê.</div></div>` : ''}
    </div>
  </div>`;
}

/* ---------------- Projetos ---------------- */
function novoProjetoForm() {
  return `<div class="card" style="margin-bottom:var(--s4)">
    <div class="sec-h"><h3>Novo projeto</h3><span class="count">a partir de um lead ou do zero</span></div>
    <div class="form three">
      <input class="in" id="pjNome" placeholder="Nome do projeto" aria-label="nome do projeto">
      <input class="in" id="pjCliente" placeholder="Cliente" aria-label="cliente">
      <select class="in" id="pjTipo" aria-label="tipo de projeto">
        ${S.tipos.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('') || '<option value="landing">Página de conversão</option>'}
      </select>
    </div>
    <div class="form two" style="margin-top:var(--s2)">
      <input class="in" id="pjCidade" placeholder="Cidade" aria-label="cidade">
      <input class="in" id="pjNicho" placeholder="Nicho" aria-label="nicho">
      <button class="btn primary small" data-act="guardar-projeto" style="padding:0 var(--s5)">Criar</button>
    </div>
    <div class="hint">O briefing começa a partir do lead quando o projeto nasce de uma oportunidade.</div>
  </div>`;
}

function pipeline(p) {
  const steps = [
    ['Briefing', ['rascunho'], 'os dados do cliente e o que se quer alcançar'],
    ['Código', ['gerado', 'qa_falhou', 'qa_passou', 'aprovado', 'entregue'], 'ficheiros escritos no disco'],
    ['Qualidade', ['qa_passou', 'qa_falhou', 'aprovado', 'entregue'], 'estrutura, sintaxe, links, honestidade'],
    ['Aprovação', ['aprovado', 'entregue'], 'a tua decisão, com a auditoria à frente'],
    ['Entrega', ['entregue'], 'preview servido ou ficheiros prontos'],
  ];
  const current = { rascunho: 0, gerado: 1, qa_falhou: 2, qa_passou: 2, aprovado: 3, entregue: 4 }[p.status] ?? 0;
  return `<ol class="steps">${steps.map(([label, done, hint], i) => {
    const state = p.status === 'qa_falhou' && i === 2 ? 'bad' : i < current ? 'done' : i === current ? 'now' : '';
    const isDone = done.includes(p.status) && !(p.status === 'qa_falhou' && i === 2);
    return `<li class="${isDone ? 'done' : state}"><b>${i + 1}. ${esc(label)}</b><small>${esc(hint)}</small></li>`;
  }).join('')}</ol>`;
}

function qaReport(qa) {
  if (!qa) return `<div class="hint">Este projeto ainda não foi auditado. O QA corre sobre os ficheiros no disco e guarda um manifesto — se algo mudar depois, a entrega é bloqueada.</div>`;
  const sev = { critico: 'Crítico', importante: 'Importante', menor: 'Menor' };
  return `<div class="qa-head">
      <span class="badge ${qa.passed ? '' : 'low'}">${qa.passed ? 'passou' : 'falhou'}</span>
      <span class="count">${qa.total === 0 ? 'nenhum problema encontrado' : `${qa.total} problemas · ${qa.critical} críticos · ${qa.important} importantes · ${qa.minor} menores`}</span>
    </div>
    ${qa.report.length ? `<ul class="qa-list">${qa.report.map(i => `<li class="${i.level}"><b>${esc(sev[i.level] || i.level)}</b> <code>${esc(i.code)}</code> ${esc(i.message)}${i.file ? ` <span class="count">(${esc(i.file)})</span>` : ''}</li>`).join('')}</ul>`
      : '<div class="hint">Nenhum problema encontrado: estrutura, sintaxe, links, rótulos e honestidade do texto.</div>'}
    ${qa.navegador ? `<div class="hint">Testes de navegador: ${qa.navegador.executado ? 'correram' : 'não correram'} — ${esc(qa.navegador.motivo)}</div>` : ''}`;
}

function viewProjetos() {
  const list = S.projetos;
  const r = S.projetosResumo || {};
  return `<div class="wrap">
    ${headHTML({
      title: 'Projetos',
      sub: list.length ? `${r.total} no total · ${r.emQa || 0} em QA · ${r.aprovados || 0} aprovados · ${r.entregues || 0} entregues` : 'ainda não há projetos',
      right: `${may('write') ? '<button class="btn small ghost" data-act="novo-projeto">+ Projeto</button>' : ''}${stopPill()}`,
    })}
    ${S.addingProject ? novoProjetoForm() : ''}
    ${searchBar()}
    ${list.length ? `<div class="rows">${list.map(p => `<button class="row" data-act="ver-projeto" data-id="${esc(p.id)}" style="grid-template-columns:1fr 150px 130px">
      <div><div class="nm">${esc(p.name)}</div><div class="mt">${esc([p.client, p.city].filter(Boolean).join(' · ') || 'sem cliente')} · ${esc((S.tipos.find(t => t.id === p.kind) || {}).label || p.kind)}</div></div>
      <div class="cell hide-m">${esc(when(p.updated_at))}</div>
      <div class="cell"><span class="tag ${PROJ_TAG[p.status] || ''}">${esc(PROJ_LABEL[p.status] || p.status)}</span></div>
    </button>`).join('')}</div>`
      : `<div class="card empty">${IC.vazio}<h3>Sem projetos</h3>
        <p>Um projeto nasce de um lead: abre um, escolhe «Criar projeto» e o briefing é escrito com o que já se sabe. A partir daí: código gerado, auditoria de qualidade, aprovação e entrega.</p>
        <div class="acts" style="justify-content:center"><a class="btn primary" href="#/leads" style="max-width:240px">Ver os leads</a></div></div>`}
  </div>`;
}

function viewProjeto() {
  const d = S.projeto;
  if (!d) return `<div class="wrap"><div class="skeleton">a abrir o projeto…</div></div>`;
  const p = d.project;
  const qa = d.qa;
  const podeGerar = ['rascunho', 'gerado', 'qa_falhou', 'qa_passou', 'aprovado', 'entregue'].includes(p.status);
  const podeQa = ['gerado', 'qa_falhou', 'qa_passou', 'aprovado', 'entregue'].includes(p.status);
  const podeAprovar = p.status === 'qa_passou' && qa?.passed;
  const podeEntregar = ['aprovado', 'entregue'].includes(p.status) && qa?.passed;
  return `<div class="wrap">
    <div style="margin-bottom:var(--s3)"><a href="#/projetos" class="btn quiet small">‹ Projetos</a></div>
    <div class="head">
      <div><h1 style="font-size:34px">${esc(p.name)}</h1>
        <div class="sub">${esc([p.client, p.city, p.niche].filter(Boolean).join(' · '))}${p.lead_id ? ` · <a href="#/lead/${esc(p.lead_id)}" style="text-decoration:underline">ver o lead</a>` : ''}</div></div>
      <div class="head-acts"><span class="tag ${PROJ_TAG[p.status] || ''}">${esc(PROJ_LABEL[p.status] || p.status)}</span></div>
    </div>
    ${pipeline(p)}
    <div class="card" style="margin-top:var(--s4)">
      <div class="sec-h"><h3>Briefing</h3><span class="count">${esc(p.kind)} · ${esc(p.stack)}</span></div>
      <p class="hint" style="margin-top:0">${esc(p.brief || 'Sem briefing escrito. Edita o projeto para acrescentar objetivos.')}</p>
      ${p.goals.length ? `<div class="why-grid" style="margin-top:var(--s3)">${p.goals.slice(0, 6).map(g => `<div class="why"><span class="tick">${IC.tick}</span><span>${esc(g)}</span></div>`).join('')}</div>` : ''}
      ${p.acceptance.length ? `<div class="hint">Critérios de aceitação: ${p.acceptance.map(a => esc(a)).join(' · ')}</div>` : ''}
      <div class="acts" style="margin-top:var(--s4)">
        ${podeGerar && may('write') ? `<button class="btn ${p.status === 'rascunho' ? 'primary' : 'ghost'}" data-act="gerar">${p.status === 'rascunho' ? 'Gerar o código' : 'Gerar outra vez'}</button>` : ''}
        ${podeQa && may('write') ? `<button class="btn ${['gerado', 'qa_falhou'].includes(p.status) ? 'primary' : 'ghost'}" data-act="qa">Correr o QA</button>` : ''}
        ${podeAprovar && may('approve') ? `<button class="btn primary" data-act="aprovar-projeto"${qa?.passed ? '' : ' disabled'}>Aprovar</button>` : ''}
        ${podeEntregar && qa?.passed && may('approve') ? `<button class="btn ${p.status === 'aprovado' ? 'primary' : 'ghost'}" data-act="entregar">Entregar preview</button>` : ''}
        ${p.preview_url ? `<a class="btn ghost" href="${esc(p.preview_url)}" target="_blank" rel="noopener">Abrir preview</a>` : ''}
        ${d.files.length ? `<button class="btn ghost" data-act="zip">Obter .zip</button>` : ''}
      </div>
      <div class="hint" id="leadNote">${p.status === 'rascunho' ? 'O primeiro passo escreve os ficheiros no disco — nada é publicado.' : 'A entrega só passa com QA aprovado e ficheiros iguais aos auditados.'}</div>
    </div>
    <div class="cards2" style="margin-top:var(--s4)">
      <div class="card">
        <div class="sec-h"><h3>Qualidade</h3><span class="count">${qa ? esc(hhmm(qa.at)) + ' · ' + esc(when(qa.at)) : 'nunca correu'}</span></div>
        ${qaReport(qa)}
        ${d.changes?.length ? `<div class="hint bad">Ficheiros alterados depois do QA: ${d.changes.map(c => esc(c.file)).join(', ')}. Corre o QA outra vez.</div>` : ''}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Ficheiros</h3><span class="count">${d.files.length}</span></div>
        ${d.files.length ? `<table><tbody>${d.files.map(f => `<tr><td>${esc(f.file)}${f.changed ? ' <span class="tag perdido">alterado</span>' : ''}</td><td class="n">${(f.size / 1024).toFixed(1)} KB</td></tr>`).join('')}</tbody></table>`
          : '<div class="hint">Ainda não há ficheiros. Gera o código para os escrever.</div>'}
      </div>
    </div>
    <div class="cards2" style="margin-top:var(--s4)">
      <div class="card">
        <div class="sec-h"><h3>Entregas</h3><span class="count">preview · Vercel · GitHub</span></div>
        ${d.deliveries.length ? `<table><tbody>${d.deliveries.map(x => `<tr><td>${esc(x.target)}</td><td><span class="tag ${x.status === 'concluido' ? 'respondeu' : 'perdido'}">${esc(x.status)}</span></td><td class="n">${esc(when(x.at))}</td></tr>`).join('')}</tbody></table>`
          : '<div class="hint">Nada entregue ainda.</div>'}
        <div class="acts" style="margin-top:var(--s3)">
          <button class="btn ghost small" data-act="entregar-vercel">Vercel</button>
          <button class="btn ghost small" data-act="entregar-github">GitHub</button>
        </div>
        <div class="hint">Vercel e GitHub só avançam com credenciais no .env — e uma recusa diz exactamente o que falta.</div>
      </div>
      <div class="card">
        <div class="sec-h"><h3>Histórico</h3><span class="count">${d.events.length}</span></div>
        <ul class="feed">${d.events.slice(0, 12).map(e => `<li><b>${esc(e.action.replace('projeto.', ''))}</b> <span class="count">${esc(when(e.at))}</span><br><span class="hint">${esc(String(e.detail || '').slice(0, 120))}</span></li>`).join('') || '<li class="hint">Sem eventos.</li>'}</ul>
      </div>
    </div>
  </div>`;
}

/* ---------------- entrar ---------------- */
function viewLogin() {
  const primeira = S.primeiraConta;
  const estado = S.authEstado || {};
  return `<div class="wrap" style="max-width:520px;margin:8vh auto 0">
    <div class="brand" style="padding:0 0 var(--s5)"><span class="mark" aria-hidden="true"></span> Órbita</div>
    <div class="card">
      <h1 style="font-size:28px;margin-bottom:var(--s2)">${primeira ? 'Criar a primeira conta' : 'Entrar'}</h1>
      <p class="hint" style="margin-top:0">${primeira
        ? 'Esta instalação ainda não tem contas. A primeira é a do dono — e só pode ser criada uma vez.'
        : 'Entra com o email e a palavra-passe que um dono te deu.'}</p>
      <div class="form" style="grid-template-columns:1fr">
        ${primeira ? '<input class="in" id="lgNome" placeholder="O teu nome" aria-label="nome" autocomplete="name">' : ''}
        <input class="in" id="lgEmail" type="email" placeholder="Email" aria-label="email" autocomplete="username" value="">
        <input class="in" id="lgPass" type="password" placeholder="${primeira ? 'Palavra-passe (12+ caracteres)' : 'Palavra-passe'}" aria-label="palavra-passe" autocomplete="${primeira ? 'new-password' : 'current-password'}">
        ${primeira ? '<input class="in" id="lgPass2" type="password" placeholder="Repetir a palavra-passe" aria-label="repetir palavra-passe">' : ''}
        <button class="btn primary" data-act="${primeira ? 'criar-primeira-conta' : 'entrar'}">${primeira ? 'Criar conta e entrar' : 'Entrar'}</button>
      </div>
      <div class="hint" id="leadNote">${primeira
        ? 'A palavra-passe é guardada com scrypt e sal próprio — nunca em claro, nunca em log.'
        : 'Sem conta, pede a um dono que crie uma em Contas. A sessão dura ' + (S.horasSessao || 12) + ' h e pode ser fechada a qualquer momento.'}</div>
      ${estado.modo ? `<div class="hint">modo actual: ${esc(estado.descricao || estado.modo)}</div>` : ''}
      ${primeira ? '<div class="hint"><button class="btn quiet small" data-act="voltar-modo-local">Continuar sem contas (modo local)</button> — só para esta máquina, sem palavra-passe.</div>' : ''}
    </div>
  </div>`;
}

/* ---------------- contas (só dono) ---------------- */
function viewContas() {
  const c = S.contas || { utilizadores: [], papeis: [] };
  const papeis = c.papeis || [];
  const eu = S.eu?.user?.email || '';
  return `<div class="wrap">
    ${headHTML({
      title: 'Contas',
      sub: `${c.utilizadores.length} conta(s) · ${S.sessoes.filter(s => s.state === 'activa').length} sessão(ões) activas · sessões de ${S.horasSessao || 12} h`,
      right: `<button class="btn small ghost" data-act="sair">Sair</button>`,
    })}
    <div class="card" style="margin-bottom:var(--s4)">
      <div class="sec-h"><h3>Quem entra</h3><span class="count">autenticação</span></div>
      <table><tbody>${c.utilizadores.map(u => `<tr>
        <td>${esc(u.name || u.email)}${u.name ? `<div class="count">${esc(u.email)}</div>` : ''}${u.email === eu ? ' <span class="tag">tu</span>' : ''}</td>
        <td>${u.active ? '' : '<span class="tag perdido">inactiva</span>'}</td>
        <td class="n">
          <select class="in" data-act="papel" data-id="${esc(u.id)}" aria-label="papel de ${esc(u.email)}" style="padding:6px">
            ${papeis.map(p => `<option value="${esc(p.key)}"${p.key === u.role ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
          </select>
        </td>
        <td class="n">${u.active && u.role !== 'dono' ? `<button class="btn quiet" data-act="desactivar-conta" data-id="${esc(u.id)}" title="desactivar">✕</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>
      <div class="form" style="margin-top:var(--s3);grid-template-columns:1fr 140px 1fr auto">
        <input class="in" id="ctEmail" type="email" placeholder="email" aria-label="email da nova conta">
        <select class="in" id="ctPapel" aria-label="papel">${papeis.map(p => `<option value="${esc(p.key)}"${p.key === 'leitor' ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
        <input class="in" id="ctPass" type="password" placeholder="palavra-passe (12+)" aria-label="palavra-passe">
        <button class="btn primary small" data-act="criar-conta">Criar</button>
      </div>
      <div class="hint">${papeis.map(p => `<b>${esc(p.label)}</b>: ${esc(p.does)}`).join(' · ')}</div>
    </div>
    <div class="card">
      <div class="sec-h"><h3>Sessões</h3><span class="count">fechar é imediato</span></div>
      ${S.sessoes.length ? `<table><tbody>${S.sessoes.map(s => `<tr>
        <td>${esc(s.user)}</td><td><span class="tag ${s.state === 'activa' ? 'respondeu' : 'perdido'}">${esc(s.state)}</span></td>
        <td class="n count">${esc(hhmm(s.created_at))} → ${esc(hhmm(s.expires_at))}</td>
        <td class="n">${s.state === 'activa' ? `<button class="btn quiet" data-act="revogar-sessao" data-id="${esc(s.id)}" title="fechar sessão">✕</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="hint">Sem sessões registadas.</div>'}
      <div class="hint">O token de máquina (ORBITA_ADMIN_TOKEN), quando existe, não aparece aqui: não é uma pessoa.</div>
    </div>
  </div>`;
}

/* ---------------- Tarefas ---------------- */
const TASK_TAG = { queued: '', running: 'novo', succeeded: 'respondeu', failed: 'perdido', awaiting_approval: 'cliente', cancelled: '' };
const TASK_LABEL = { queued: 'à espera', running: 'a correr', succeeded: 'concluída', failed: 'falhou', awaiting_approval: 'espera aprovação', cancelled: 'cancelada' };
const dur = ms => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function tarefaCard(t) {
  const d = (S.deptos || []).find(x => x.key === t.dept) || {};
  const podeCorrer = ['queued', 'failed'].includes(t.state) && t.attempts < t.max_attempts;
  const ev = t.evidence || [];
  return `<div class="card" style="margin-bottom:var(--s3)">
    <div class="detail-top">
      <div><h3 style="font-size:var(--t-m)">${esc(t.title)}</h3>
        <div class="mt">${esc(d.name || t.dept)} · ${esc(d.role || '')}${t.entityId ? ` · <a href="${t.entity === 'projeto' ? '#/projeto/' + esc(t.entityId) : t.entity === 'lead' ? '#/lead/' + esc(t.entityId) : '#'}" style="text-decoration:underline">${esc(t.entityId)}</a>` : ''}</div></div>
      <span class="tag ${TASK_TAG[t.state] || ''}">${esc(TASK_LABEL[t.state] || t.state)}</span>
    </div>
    <div class="mt" style="margin-top:var(--s2)">
      ${t.attempts}/${t.max_attempts} tentativa(s)${t.duration_ms != null ? ` · ${dur(t.duration_ms)}` : ''}${t.started_at ? ` · começou ${esc(hhmm(t.started_at))}` : ''}
      ${t.needsApproval ? ' · acção externa: exige aprovação' : ''}
    </div>
    ${t.error ? `<div class="hint bad" style="margin-top:var(--s2)">${esc(t.error)}</div>` : ''}
    ${t.state === 'succeeded' && Object.keys(t.result || {}).length ? `<details class="why-box" style="margin-top:var(--s2)"><summary><span>Resultado<small>${esc(Object.keys(t.result).slice(0, 4).join(', '))}</small></span>${IC.chev}</summary>
      <pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);margin:0">${esc(JSON.stringify(t.result, null, 2).slice(0, 1600))}</pre>
      ${ev.length ? `<div class="hint">Evidência: ${ev.slice(0, 6).map(e => esc(e.label)).join(' · ')}</div>` : ''}</details>` : ''}
    ${ev.length && t.state !== 'succeeded' ? `<div class="hint">Evidência: ${ev.slice(0, 4).map(e => esc(e.label)).join(' · ')}</div>` : ''}
    <div class="acts" style="margin-top:var(--s3)">
      ${t.state === 'queued' && may('write') ? `<button class="btn primary small" data-act="correr-tarefa" data-id="${esc(t.id)}">Correr</button>` : ''}
      ${t.state === 'failed' && podeCorrer && may('write') ? `<button class="btn ghost small" data-act="correr-tarefa" data-id="${esc(t.id)}">Repetir</button>` : ''}
      ${t.state === 'awaiting_approval' && may('approve') ? `<button class="btn ghost small" data-act="rejeitar-tarefa" data-id="${esc(t.id)}">Rejeitar</button><button class="btn primary small" data-act="aprovar-tarefa" data-id="${esc(t.id)}">Aprovar</button>` : ''}
      ${t.state === 'failed' && !podeCorrer ? '<span class="count">tentativas esgotadas — abre uma tarefa nova</span>' : ''}
    </div>
  </div>`;
}

function novaTarefaForm() {
  const tipos = S.tiposTarefa.length ? S.tiposTarefa : [];
  return `<div class="card" style="margin-bottom:var(--s4)">
    <div class="sec-h"><h3>Nova tarefa</h3><span class="count">fica guardada na base de dados</span></div>
    <div class="form">
      <select class="in" id="tfTipo" aria-label="tipo de tarefa">${tipos.map(t => `<option value="${esc(t.id)}">${esc(t.label)} · ${esc((S.deptos.find(d => d.key === t.dept) || {}).name || t.dept)}</option>`).join('')}</select>
      <input class="in" id="tfEnt" placeholder="Projeto ou lead (id)" aria-label="entidade">
      <label class="hint" style="display:flex;align-items:center;gap:var(--s2);white-space:nowrap"><input type="checkbox" id="tfAprov"> exige aprovação</label>
      <button class="btn primary small" data-act="criar-tarefa" style="padding:0 var(--s5)">Criar e correr</button>
    </div>
    <div class="hint">O tipo decide o departamento. O que precisa de um motor de IA falha com o motivo escrito — não inventa um resultado.</div>
  </div>`;
}

function viewTarefas() {
  const f = S.tarefaFiltro || {};
  const list = S.tarefas || [];
  const conta = st => list.filter(t => t.state === st).length;
  return `<div class="wrap">
    ${headHTML({
      title: 'Tarefas',
      sub: list.length ? `${list.length} · ${conta('running')} a correr · ${conta('awaiting_approval')} à espera de ti · ${conta('failed')} falhadas` : 'ainda não há tarefas',
      right: `${may('write') ? '<button class="btn small ghost" data-act="nova-tarefa">+ Tarefa</button>' : ''}${stopPill()}`,
    })}
    ${S.addingTask ? novaTarefaForm() : ''}
    <div class="filters" role="group" aria-label="filtrar por departamento" style="margin-bottom:var(--s3)">
      <button class="chip ${!f.dept ? 'on' : ''}" data-act="filtrar-tarefa" data-k="dept" data-v="">Todos</button>
      ${(S.deptos || []).map(d => `<button class="chip ${f.dept === d.key ? 'on' : ''}" data-act="filtrar-tarefa" data-k="dept" data-v="${esc(d.key)}">${esc(d.name)}</button>`).join('')}
    </div>
    <div class="filters" role="group" aria-label="filtrar por estado" style="margin-bottom:var(--s4)">
      <button class="chip ${!f.state ? 'on' : ''}" data-act="filtrar-tarefa" data-k="state" data-v="">Todos</button>
      ${['queued', 'running', 'awaiting_approval', 'succeeded', 'failed'].map(st => `<button class="chip ${f.state === st ? 'on' : ''}" data-act="filtrar-tarefa" data-k="state" data-v="${st}">${TASK_LABEL[st]}</button>`).join('')}
    </div>
    ${list.length ? list.map(tarefaCard).join('') : `<div class="card empty">${IC.vazio}<h3>${f.dept || f.state ? 'Nada neste filtro' : 'Sem tarefas'}</h3>
      <p>${f.dept || f.state
        ? 'Não há tarefas com este departamento e estado. Limpa os filtros — o que existe está todo aqui.'
        : 'Uma tarefa é trabalho com dono, começo, fim e resultado. Cria uma para qualificar um lead, gerar o código de um projeto ou auditar a qualidade — o que corre fica escrito aqui, mesmo que o servidor reinicie.'}</p></div>`}
  </div>`;
}

/* ---------------- Agentes ---------------- */
function viewAgentes() {
  const a = S.agentes;
  const at = S.atividade;
  if (!a) return `<div class="wrap"><div class="skeleton">a ler o estado dos agentes…</div></div>`;
  const deptos = a.departamentos || [];
  const resumo = a.resumo || {};
  return `<div class="wrap">
    ${headHTML({
      title: 'Agentes',
      sub: `${resumo.total || 0} tarefas registadas · ${resumo.running || 0} a correr · ${resumo.awaiting || 0} à espera de aprovação`,
      right: stopPill(),
    })}
    <div class="hint" style="margin-bottom:var(--s4)">O estado vem da base de dados: um agente só aparece «a trabalhar» quando tem uma tarefa em curso. Sem tarefa, não há movimento.</div>
    <div class="steps" style="grid-template-columns:repeat(3,1fr);margin-bottom:var(--s4)">
      ${deptos.map(d => `<li class="${d.running ? 'now' : d.failed ? 'bad' : d.awaiting ? '' : 'done'}">
        <b>${esc(d.n)} · ${esc(d.name)}</b>
        <small>${esc(d.role)}</small>
        <div class="mt" style="margin-top:var(--s2);font-size:11px">${d.running ? 'a trabalhar' : d.awaiting ? 'espera aprovação' : d.queued ? 'com trabalho na fila' : d.failed ? 'com falhas' : d.succeeded ? 'sem trabalho pendente' : 'sem tarefas'}</div>
        <div class="count" style="margin-top:var(--s2)">${d.succeeded} feitas · ${d.failed} falhadas · ${d.queued} na fila</div>
        ${d.last ? `<div class="count" style="margin-top:2px">${esc(String(d.last).slice(0, 60))}</div>` : ''}
      </li>`).join('')}
    </div>
    <div class="cards2">
      <div class="card">
        <div class="sec-h"><h3>O que correu</h3><span class="count">tarefas</span></div>
        ${(at?.tarefas || []).length ? `<table><tbody>${at.tarefas.slice(0, 10).map(t => `<tr>
          <td>${esc(t.title)}<div class="count">${esc(t.deptName || t.dept)}</div></td>
          <td><span class="tag ${TASK_TAG[t.state] || ''}">${esc(TASK_LABEL[t.state] || t.state)}</span></td>
          <td class="n">${t.ms != null ? esc(dur(t.ms)) : ''}</td></tr>`).join('')}</tbody></table>`
          : '<div class="hint">Ainda não correu nenhuma tarefa. Começa em Tarefas ou no projeto de um lead.</div>'}
      </div>
      <div class="card">
        <div class="sec-h"><h3>Falhas e registo</h3><span class="count">${(at?.resumo?.falhasRecentes || 0)} falha(s)</span></div>
        ${at?.resumo?.ultimaFalha ? `<div class="hint bad">Última: ${esc(at.resumo.ultimaFalha.title || at.resumo.ultimaFalha.kind || '')} — ${esc(String(at.resumo.ultimaFalha.error || '').slice(0, 120))}</div>` : '<div class="hint">Nenhuma falha registada.</div>'}
        <ul class="feed" style="margin-top:var(--s2)">${(at?.eventos || []).slice(0, 10).map(e => `<li><b>${esc(e.action)}</b> <span class="count">${esc(hhmm(e.at))} · ${esc(e.actor)}</span></li>`).join('') || '<li class="hint">Sem eventos.</li>'}</ul>
      </div>
    </div>
  </div>`;
}

/* ---------------- Conversas ---------------- */
function viewConversas() {
  const list = S.messages;
  const label = { rascunho: 'por aprovar', ensaio: 'ensaio', aprovada: 'aprovada', enviada: 'enviada', rejeitada: 'rejeitada', bloqueada: 'bloqueada', falhou: 'falhou', revisao: 'a rever', recebida: 'responderam' };
  return `<div class="wrap">
    ${headHTML({
      title: 'Conversas',
      sub: list.length ? `${list.length} mensagens · ${list.filter(m => m.status === 'rascunho').length} à espera do teu OK${list.filter(m => m.status === 'recebida').length ? ` · ${list.filter(m => m.status === 'recebida').length} resposta(s) de clientes` : ''}` : 'ainda não há nenhuma mensagem escrita',
      right: stopPill(),
    })}
    ${list.length ? `<div class="rows">${list.map(m => `<button class="row" data-act="ver-lead" data-id="${esc(m.lead_id)}">
      <div><div class="nm">${esc(m.lead?.name || 'sem lead')}</div><div class="mt">${m.status === 'recebida' || m.direction === 'in' ? '<b>← </b>' : ''}${esc(String(m.body).slice(0, 80))}${String(m.body).length > 80 ? '…' : ''}</div></div>
      <div class="cell hide-m">${esc(m.channel === 'whatsapp' ? 'WhatsApp' : 'email')} · ${esc(when(m.created_at))}</div>
      <div class="cell"><span class="tag ${m.status === 'enviada' ? 'respondeu' : m.status === 'rejeitada' || m.status === 'bloqueada' ? 'perdido' : ''}">${esc(label[m.status] || m.status)}</span></div>
      <div class="cell">${m.lead?.score != null ? scoreBadge(m.lead.score) : ''}</div>
    </button>`).join('')}</div>`
      : `<div class="card empty">${IC.vazio}<h3>Sem conversas</h3>
        <p>Uma conversa começa com um rascunho. Abre um lead e escreve: a mensagem fica aqui, com o estado dela, até decidires o que fazer.</p>
        <div class="acts" style="justify-content:center"><a class="btn primary" href="#/leads" style="max-width:240px">Ver os leads</a></div></div>`}
  </div>`;
}

/* ---------------- Saldo ---------------- */
function viewSaldo() {
  const b = S.saldo;
  if (!b) return `<div class="wrap"><div class="skeleton">a ler o saldo…</div></div>`;
  const u = b.unitarios || {};
  const uni = [
    u.custoPorLead != null ? `custo por lead ${money(u.custoPorLead)}` : '',
    u.custoPorContactado != null ? `por contactado ${money(u.custoPorContactado)}` : '',
    u.custoPorCliente != null ? `por cliente ${money(u.custoPorCliente)}` : '',
    u.receitaPorCliente != null ? `receita por cliente ${money(u.receitaPorCliente)}` : '',
  ].filter(Boolean).join(' · ') || 'sem dados suficientes para custos unitários';
  return `<div class="wrap">
    ${headHTML({ title: 'Saldo', sub: `os últimos ${b.janela?.dias || 90} dias · só o que está registado`, right: stopPill() })}
    <div class="money">
      <div class="card"><b class="ok">${money(b.receitaCentimos)}</b><small>entrou</small></div>
      <div class="card"><b>${money(b.custoCentimos)}</b><small>gastou em APIs</small></div>
      <div class="card"><b class="${b.margemCentimos < 0 ? 'bad' : 'ok'}">${money(b.margemCentimos)}</b><small>margem</small></div>
    </div>
    ${b.semDados?.receita ? `<div class="hint" style="margin-bottom:var(--s4)">${esc(b.semDados.receita)}</div>` : ''}
    <div class="card" style="margin-bottom:var(--s4)">
      <div class="sec-h"><h3>Registar uma entrada</h3><span class="count">escrita por ti</span></div>
      <div class="form">
        <input class="in" id="valor" inputmode="decimal" placeholder="Valor (€)" aria-label="valor em euros">
        <input class="in" id="campanha" placeholder="Campanha (ex.: Coimbra · barbearias)" aria-label="campanha">
        <button class="btn primary small" data-act="receita" style="padding:0 var(--s5)">Registar</button>
      </div>
      <div class="hint">Nada é adivinhado: uma fatura emitida fora do Órbita só entra se a escreveres aqui.</div>
    </div>
    <div class="cards2">
      <div class="card"><div class="sec-h"><h3>Receita por campanha</h3></div>
        <table><tbody>${(b.porCampanha || []).length
          ? b.porCampanha.map(c => `<tr><td>${esc(c.campanha)}</td><td class="n">${money(c.cents)}</td></tr>`).join('')
          : '<tr><td class="hint">Sem entradas registadas.</td></tr>'}</tbody></table></div>
      <div class="card"><div class="sec-h"><h3>Custos por fornecedor</h3></div>
        <table><tbody>${(b.custosPorFornecedor || []).length
          ? b.custosPorFornecedor.map(c => `<tr><td>${esc(c.provider)}</td><td class="n">${money(c.cents)}</td></tr>`).join('')
          : '<tr><td class="hint">Sem custos de API neste período.</td></tr>'}</tbody></table></div>
    </div>
    <div class="hint" style="margin-top:var(--s4)">${esc(uni)}</div>
    ${(b.entradas || []).length ? `<div class="card" style="margin-top:var(--s4)"><div class="sec-h"><h3>Entradas</h3><span class="count">${b.entradas.length}</span></div>
      <table><tbody>${b.entradas.map(e => `<tr><td style="white-space:nowrap;color:var(--muted)">${esc(when(e.at))}</td><td>${esc(e.campaign || 'sem campanha')}</td><td class="n">${money(e.amount_cents)}</td>
        <td class="n"><button class="btn quiet" data-act="apagar-receita" data-id="${esc(e.id)}" title="apagar">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}

/* ---------------- pintar ---------------- */
/* o aviso de que os dados são deste browser — curto, sempre à vista, com a cópia à mão */
function avisoLocal() {
  if (S.baseLigada && !S.modoLocal) {
    return `<div class="basebar" role="status"><span class="dot"></span>Base de dados ligada — o que escreves aqui fica guardado e anda contigo entre aparelhos.</div>`;
  }
  if (!S.modoLocal) return '';
  const e = (local && local.estado()) || { leads: 0, projetos: 0 };
  return `<div class="localbar" role="status">
    <span><b>Modo local</b> — os teus dados ficam neste browser (${e.leads} leads · ${e.projetos} projetos).
      A base de dados não está a responder${S.baseMotivo ? `: ${esc(S.baseMotivo)}` : ' (sem servidor publicado)'}.</span>
    <span class="lb-act">
      <button class="btn quiet small" data-act="exportar-local" title="descarregar uma cópia de tudo">Guardar cópia</button>
      <button class="btn quiet small" data-act="importar-local" title="ler uma cópia que guardaste">Ler cópia</button>
      <button class="btn quiet small" data-act="para-a-base" title="enviar o que está aqui para a base de dados">Enviar para a base</button>
      <input type="file" id="lbFile" accept="application/json,.json" hidden>
    </span>
  </div>`;
}

function paint() {
  if (S.needLogin) { main().innerHTML = viewLogin(); return; }
  if (S.modoLocal) { main().innerHTML = avisoLocal(); }
  /* a barra de estado: verde quando a base responde, âmbar quando se trabalha neste browser */
  const pintar = (html) => { main().innerHTML = ((S.modoLocal || S.baseLigada) ? avisoLocal() : '') + html; };
  // uma rota que o papel não permite não se mostra: volta a Hoje, sem drama
  if (S.route.name === 'contas' && !may('admin')) { S.route = { name: 'hoje', id: null }; }
  if (S.error && !S.summary) {
    /* 30 out 2026: o cartão «precisa do Órbita a correr na tua máquina» saiu. A mesa trabalha
       neste browser (src/localapi.js) e só falha se o armazém do browser estiver bloqueado —
       e nesse caso diz-se isso, não se manda ninguém instalar nada. */
    main().innerHTML = `<div class="wrap"><div class="card empty"><h3>Não consegui abrir o armazém deste browser</h3>
        <p>${esc(S.error)}</p>
        <p class="hint">Se estás em navegação privada, o browser apaga os dados ao fechar a janela e pode bloquear o armazenamento. Abre numa janela normal, ou corre o Órbita na tua máquina com <code>npm start</code>.</p>
        <div class="acts" style="justify-content:center"><button class="btn primary" data-act="reload" style="max-width:220px">Tentar outra vez</button></div></div></div>`;
    return;
  }
  pintar(S.route.name === 'hoje' ? viewHoje()
    : S.route.name === 'papel' ? vistaPapel(S, { esc })
    : S.route.name === 'leads' ? viewLeads()
      : S.route.name === 'lead' ? viewLead()
        : S.route.name === 'projetos' ? viewProjetos()
          : S.route.name === 'projeto' ? viewProjeto()
            : S.route.name === 'tarefas' ? viewTarefas()
              : S.route.name === 'agentes' ? viewAgentes()
              : S.route.name === 'contas' ? viewContas()
              : S.route.name === 'ia' ? vistaIA(S, { esc, hhmm, when })
            : S.route.name === 'conversas' ? viewConversas()
              : viewSaldo());
}

/* ---------------- acções ---------------- */
function waLink(phone, body) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body || '')}`;
}

async function act(name, el, ev) {
  const id = el?.dataset.id;
  // 1.18.0 · o Control Center da IA trata das suas próprias acções
  if (String(name).startsWith('ia-')) { await accaoIA(name, el, apiMesa); return; }
  /* 1.47.0 · papel: abrir câmara, preparar lead, guardar */
  if (String(name).startsWith('papel-') && await accaoPapel(name, el, apiMesa)) return;
  const note = () => $('#leadNote');
  const setNote = (msg, bad) => { const n = note(); if (n) { n.textContent = msg; n.classList.toggle('bad', !!bad); } else toast(msg, bad); };
  try {
    if (name === 'pick') { S.pick = id; paint(); return; }
    if (name === 'filter') { S.filter = el.dataset.k; paint(); return; }
    if (name === 'ver-lead') { location.hash = `#/lead/${encodeURIComponent(id)}`; return; }
    if (name === 'reload') { await boot(true); return; }

    if (name === 'toggle-stop') {
      const parado = !!S.today?.presenca?.parado;
      await call('/ops/stop', 'POST', { stop: !parado });
      toast(!parado ? 'PARAR TUDO ligado: não sai nada, por nenhum caminho.' : 'Envios retomados.');
      await boot();
      return;
    }

    if (name === 'auto-up' || name === 'auto-down') {
      const scope = el.dataset.scope;
      await call(`/ops/autonomia/${encodeURIComponent(scope)}/${name === 'auto-up' ? 'subir' : 'descer'}`, 'POST', { reason: 'decisão na mesa' });
      toast(name === 'auto-up' ? 'Este tipo passa a enviar sozinho. Os travões continuam.' : 'Volta a pedir-te autorização.');
      S.pick = null;
      await boot();
      return;
    }

    if (name === 'aprovar') {
      const m = S.leadMessages.find(x => x.id === id) || (S.today?.decidir || []).find(x => x.id === id);
      // uma mensagem em ensaio tem de sair do ensaio antes de ser aprovada — por essa ordem
      if (m?.status === 'ensaio') await call(`/ops/messages/${encodeURIComponent(id)}/promover`, 'POST', {});
      await call(`/ops/messages/${encodeURIComponent(id)}/approve`, 'POST', {});
      const lead = m?.lead || S.lead || {};
      if ((m?.channel || 'whatsapp') === 'whatsapp') {
        /* 1.38.0 · com WHATSAPP_TOKEN + WHATSAPP_PHONE_ID o WhatsApp sai sozinho.
           Sem chaves, a mesa não inventa: abre o link e espera que uma pessoa
           confirme. O caminho automático é tentado primeiro, não o contrário. */
        const link = waLink(lead.phone, m?.body);
        let auto = null;
        try { auto = await call(`/ops/messages/${encodeURIComponent(id)}/send`, 'POST', {}); } catch (e) { auto = { erro: e.message }; }
        if (auto?.enviada) toast(`WhatsApp enviado (${auto.providerId || 'sem id do fornecedor'}) · ${auto.para}.`);
        else if (link) {
          window.open(link, '_blank', 'noopener');
          toast(`Aprovada. Envio automático indisponível (${auto?.erro || 'sem chaves'}) — abre o WhatsApp e envia; depois «Já enviei».`);
        } else toast('Aprovada, mas o lead não tem telefone: não há link de WhatsApp.', true);
      } else {
        try {
          await call(`/ops/messages/${encodeURIComponent(id)}/send`, 'POST', {});
          toast('Email enviado.');
        } catch (e) { toast('Aprovada. O email não saiu: ' + e.message, true); }
      }
      await boot();
      return;
    }

    if (name === 'rejeitar') {
      const why = prompt('Porque é que rejeitas? (fica no registo)') || 'rejeitada na mesa';
      await call(`/ops/messages/${encodeURIComponent(id)}/reject`, 'POST', { reason: why });
      toast('Rejeitada. A razão ficou guardada.');
      await boot();
      return;
    }

    if (name === 'enviar') {
      /* 1.34.0 · envio real: um pedido ao fornecedor, com a chave do servidor.
         Se correr mal, a mensagem fica «falhou» com o motivo e o botão passa a
         «Tentar outra vez» — não se marca como enviada o que não saiu. */
      try {
        toast('A enviar…');
        const r = await call(`/ops/messages/${encodeURIComponent(id)}/enviar`, 'POST', {});
        toast(`Enviada por ${r.canal} para ${r.para}${r.providerId ? ` · ${r.providerId}` : ''}${r.ms ? ` · ${r.ms} ms` : ''}.`);
      } catch (e) { toast(`Não saiu: ${e.message}`, true); }
      await boot();
      return;
    }

    if (name === 'abrir') {
      const m = S.leadMessages.find(x => x.id === id) || (S.today?.decidir || []).find(x => x.id === id);
      const lead = m?.lead || S.lead || {};
      const link = waLink(lead.phone, m?.body);
      if (!link) { toast('Este lead não tem telefone — não há link de WhatsApp.', true); return; }
      window.open(link, '_blank', 'noopener');
      toast('Link aberto. Depois de enviares, carrega em «Já enviei».');
      return;
    }

    if (name === 'confirmar') {
      await call(`/ops/messages/${encodeURIComponent(id)}/confirm`, 'POST', {});
      toast('Confirmado: contas como enviada.');
      await boot();
      return;
    }

    if (name === 'sinal') {
      await call(`/ops/messages/${encodeURIComponent(id)}/sinal`, 'POST', { kind: el.dataset.kind });
      toast('Sinal registado — a nota aprende com ele.');
      await boot();
      return;
    }

    if (name === 'estado') {
      const status = el.dataset.status;
      await call(`/ops/leads/${encodeURIComponent(id)}`, 'PATCH', { status });
      toast(`Marcado como ${statusLabel[status] || status}.`);
      await boot();
      return;
    }

    if (name === 'pesquisar' || name === 'escrever') {
      const leadId = S.lead?.id || id;
      if (!leadId) return;
      if (name === 'pesquisar') {
        setNote('a ler o site…');
        const r = await call(`/ops/leads/${encodeURIComponent(leadId)}/pesquisar`, 'POST', {});
        toast(r.dossier?.research?.status === 'ok' ? `Li o site: ${(r.dossier.evidence || []).length} factos.` : `Não consegui ler: ${r.dossier?.research?.reason || 'sem motivo'}`, r.dossier?.research?.status !== 'ok');
        await boot(false);
        await loadLead(leadId);
        paint();
      } else {
        setNote('a escrever…');
        const r = await call(`/ops/leads/${encodeURIComponent(leadId)}/rascunho`, 'POST', { channel: 'whatsapp' });
        toast(`Rascunho escrito (${r.message?.generated_by === 'modelo' ? 'modelo local' : r.message?.generated_by || 'sem motor'}).`);
        await boot(false);
        await loadLead(leadId);
        paint();
      }
      return;
    }

    if (name === 'novo-lead') { S.adding = !S.adding; paint(); return; }
    if (name === 'entrar' || name === 'criar-primeira-conta') {
      const email = String($('#lgEmail')?.value || '').trim();
      const pass = String($('#lgPass')?.value || '');
      if (!email || !pass) { toast('Diz o email e a palavra-passe.', true); return; }
      if (name === 'criar-primeira-conta') {
        if (pass !== String($('#lgPass2')?.value || '')) { toast('As palavras-passe não são iguais.', true); return; }
        await call('/auth/primeiro-dono', 'POST', { email, password: pass, name: String($('#lgNome')?.value || '').trim() });
        toast('Conta criada. Bem-vindo ao Órbita.');
      } else {
        await call('/auth/entrar', 'POST', { email, password: pass });
      }
      S.needLogin = false; S.primeiraConta = false;
      await boot(true);
      return;
    }
    if (name === 'voltar-modo-local') { S.needLogin = false; S.primeiraConta = false; await boot(true); return; }
    if (name === 'abrir-primeira-conta') { S.needLogin = true; S.primeiraConta = true; paint(); return; }
    if (name === 'abrir-contas') {
      if (S.eu?.user) { await call('/auth/sair', 'POST', {}).catch(() => {}); S.eu = null; S.needLogin = true; S.summary = null; paintNav(); paint(); toast('Sessão fechada.'); return; }
      if (may('admin')) { location.hash = '#/contas'; return; }
      S.needLogin = true; paint();
      return;
    }
    if (name === 'sair') {
      await call('/auth/sair', 'POST', {}).catch(() => {});
      S.eu = null; S.needLogin = true; S.summary = null; S.leads = []; S.projetos = [];
      paintNav(); paint();
      toast('Sessão fechada.');
      return;
    }
    if (name === 'criar-conta') {
      const email = String($('#ctEmail')?.value || '').trim();
      const pass = String($('#ctPass')?.value || '');
      const role = String($('#ctPapel')?.value || 'leitor');
      if (!email || !pass) { toast('Email e palavra-passe são precisos.', true); return; }
      const r = await call('/ops/utilizadores', 'POST', { email, password: pass, role, name: email.split('@')[0] });
      toast(`Conta de ${r.utilizador.email} criada como ${r.utilizador.roleLabel}.`);
      await loadContas(); paint();
      return;
    }
    if (name === 'desactivar-conta') {
      await call(`/ops/utilizadores/${encodeURIComponent(id)}/desactivar`, 'POST', {});
      toast('Conta desactivada e sessões fechadas.');
      await loadContas(); paint();
      return;
    }
    if (name === 'revogar-sessao') {
      await call(`/ops/sessoes/${encodeURIComponent(id)}`, 'DELETE', {});
      toast('Sessão fechada.');
      await loadContas(); paint();
      return;
    }
    if (name === 'nova-tarefa') { S.addingTask = !S.addingTask; paint(); return; }
    if (name === 'filtrar-tarefa') {
      S.tarefaFiltro[el.dataset.k] = el.dataset.v || null;
      await loadTarefas();
      paint();
      return;
    }
    if (name === 'criar-tarefa') {
      const tipo = $('#tfTipo')?.value || '';
      const ent = String($('#tfEnt')?.value || '').trim();
      const aprov = !!$('#tfAprov')?.checked;
      if (!tipo) { toast('Escolhe o tipo de tarefa.', true); return; }
      const meta = S.tiposTarefa.find(t => t.id === tipo) || {};
      const entidade = String(ent).startsWith('p_') ? 'projeto' : String(ent).startsWith('l_') ? 'lead' : '';
      const r = await call('/ops/tarefas', 'POST', { kind: tipo, entityId: ent, entidade, aprovacao: aprov, correr: true });
      const t = r.tarefa;
      toast(t.state === 'succeeded' ? `Tarefa concluída (${meta.label || tipo}).` : t.state === 'awaiting_approval' ? 'Tarefa à espera da tua aprovação.' : `A tarefa não passou: ${t.error || 'sem motivo'}`, t.state !== 'succeeded' && t.state !== 'awaiting_approval');
      S.addingTask = false;
      await loadTarefas();
      paint();
      return;
    }
    if (name === 'correr-tarefa') {
      const r = await call(`/ops/tarefas/${encodeURIComponent(id)}/correr`, 'POST', {});
      toast(r.ok ? 'Tarefa concluída.' : `Falhou: ${r.error || 'sem motivo'}`, !r.ok);
      await loadTarefas();
      paint();
      return;
    }
    if (name === 'aprovar-tarefa' || name === 'rejeitar-tarefa') {
      const r = await call(`/ops/tarefas/${encodeURIComponent(id)}/${name === 'aprovar-tarefa' ? 'aprovar' : 'rejeitar'}`, 'POST', { note: 'revisto na mesa' });
      toast(name === 'aprovar-tarefa' ? 'Aprovada e registada.' : 'Rejeitada.');
      await loadTarefas();
      paint();
      return;
    }
    if (name === 'novo-projeto') { S.addingProject = !S.addingProject; paint(); return; }
    if (name === 'ver-projeto') { location.hash = `#/projeto/${encodeURIComponent(id)}`; return; }

    if (name === 'guardar-projeto') {
      const v = k => String($('#' + k)?.value || '').trim();
      if (!v('pjNome')) { toast('O projeto precisa de um nome.', true); return; }
      const r = await call('/ops/projetos', 'POST', {
        name: v('pjNome'), client: v('pjCliente'), niche: v('pjNicho'), city: v('pjCidade'), kind: v('pjTipo') || 'landing',
      });
      toast('Projeto criado. O primeiro passo é gerar o código.');
      S.addingProject = false;
      location.hash = `#/projeto/${r.projeto.id}`;
      return;
    }

    if (name === 'criar-projeto') {
      const leadId = S.lead?.id || id;
      const r = await call(`/ops/leads/${encodeURIComponent(leadId)}/projeto`, 'POST', { kind: 'landing' });
      toast('Projeto criado a partir do lead.');
      await boot(false);
      location.hash = `#/projeto/${r.projeto.id}`;
      return;
    }

    if (name === 'gerar') {
      setNote('a escrever os ficheiros…');
      const r = await call(`/ops/projetos/${encodeURIComponent(S.projeto.project.id)}/gerar`, 'POST', {});
      toast(`${r.files.length} ficheiros escritos (${(r.bytes / 1024).toFixed(1)} KB). Corre o QA.`);
      await boot(false); await loadProjeto(S.projeto.project.id); paint();
      return;
    }

    if (name === 'qa') {
      setNote('a auditar…');
      const r = await call(`/ops/projetos/${encodeURIComponent(S.projeto.project.id)}/qa`, 'POST', {});
      toast(r.run.passed ? `QA passou: ${r.run.total} verificações.` : `QA falhou: ${r.run.critical} críticas, ${r.run.important} importantes.`, !r.run.passed);
      await boot(false); await loadProjeto(S.projeto.project.id); paint();
      return;
    }

    if (name === 'aprovar-projeto') {
      await call(`/ops/projetos/${encodeURIComponent(S.projeto.project.id)}/aprovar`, 'POST', { note: 'aprovado na mesa' });
      toast('Aprovado. A entrega já pode ser feita.');
      await boot(false); await loadProjeto(S.projeto.project.id); paint();
      return;
    }

    if (name === 'entregar' || name === 'entregar-vercel' || name === 'entregar-github') {
      const target = name === 'entregar' ? 'preview' : name === 'entregar-vercel' ? 'vercel' : 'github';
      const r = await call(`/ops/projetos/${encodeURIComponent(S.projeto.project.id)}/entregar`, 'POST', { target });
      toast(r.url ? `Entregue: ${r.url}` : (r.note || 'Pedido registado — confirma no serviço.'), !r.url);
      await boot(false); await loadProjeto(S.projeto.project.id); paint();
      return;
    }

    if (name === 'zip') {
      const pid = S.projeto?.project?.id;
      if (!pid) return;
      const headers = {};
      const token = adminToken();
      if (token) headers['x-orbita-admin'] = token;
      const res = await fetch(`/api/ops/projetos/${encodeURIComponent(pid)}/zip`, { headers });
      if (!res.ok) throw new Error(`não consegui preparar o .zip (HTTP ${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${pid}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Ficheiros prontos para levar para qualquer alojamento.');
      return;
    }

    if (name === 'procurar-leads') {
      const v = (id) => String($('#' + id)?.value || '').trim();
      const mais = el?.dataset?.mais === '1';
      const nicho = v('plNicho') || S.procura?.nicho || '';
      const cidade = v('plCidade') || S.procura?.cidade || '';
      if (!nicho || !cidade) { toast('Diz o nicho e a cidade — sem isso a pesquisa não sabe o que procurar.', true); return; }
      const limite = mais ? Math.min(100, Number(S.procura?.limite || 20) + 20) : Number(v('plQuantos')) || Number(S.procura?.limite) || 20;
      toast(mais ? `A procurar mais ${limite}…` : 'A procurar empresas reais…');
      let r;
      try {
        r = await call('/pesquisa/leads', 'POST', { oQue: nicho, onde: cidade, limite, guardar: true });
      } catch (e) {
        toast(`A pesquisa não correu: ${e.message}`, true);
        return;
      }
      S.procura = { nicho, cidade, limite, fonte: r.fonte === 'geoapify' ? 'Geoapify' : r.fonte };
      const g = r.guardados || { novos: 0, repetidos: 0 };
      toast(r.encontrados
        ? `${r.encontrados} encontrados · ${g.novos} novos · ${g.repetidos} já estavam`
        : (r.avisos?.[0] || 'O fornecedor não devolveu empresas para esse nicho e essa zona.'));
      try { S.leads = (await call('/ops/leads?limit=500')).leads || S.leads; } catch { await boot(); }
      paint();
      return;
    }

    if (name === 'actualizar-leads') {
      try {
        const r = await call('/ops/leads?limit=500');
        S.leads = r.leads || [];
        toast(`${S.leads.length} lead(s) lidos da base agora.`);
        paint();
      } catch (e) { toast(`Não consegui actualizar: ${e.message}`, true); }
      return;
    }

    /* 1.36.0 · a edição do lead (pedido 57e). Valida-se antes de enviar: um email
       sem @ ou um telefone com dois dígitos não vão para a base só para voltarem
       como erro genérico. O site aceita-se escrito à mão (`empresa.pt`) e é
       normalizado para https:// — o formulário não obriga a saber o protocolo. */
    if (name === 'editar-lead') {
      S.editandoLead = true;
      paint();
      setTimeout(() => $('#elTelefone')?.focus(), 30);
      return;
    }
    if (name === 'cancelar-edicao-lead') {
      S.editandoLead = false;
      paint();
      return;
    }
    if (name === 'guardar-edicao-lead') {
      const v = (k) => String($('#' + k)?.value || '').trim();
      /* o telefone guarda-se como a pessoa o escreveu (com espaços, +351 …): o que
         se valida são os dígitos, mas não se reescreve o número por ela */
      const telefone = v('elTelefone').replace(/(?!^)\+/g, '').replace(/\s+/g, ' ');
      const email = v('elEmail');
      const site = v('elSite');
      const digitos = telefone.replace(/\D/g, '');
      if (telefone && digitos.length < 6) { toast('Esse telefone tem poucos dígitos — confirma antes de guardar.', true); return; }
      if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email)) { toast('Esse email não parece um email (falta o @ ou o domínio).', true); return; }
      const siteLimpo = site
        ? (/^https?:\/\//i.test(site) ? site : `https://${site.replace(/^\/\//, '')}`)
        : '';
      if (siteLimpo && !/^https?:\/\/[^\s.]+\.[^\s]{2,}/i.test(siteLimpo)) { toast('Esse site não parece um endereço (ex.: empresa.pt).', true); return; }
      const corpoEdicao = {
        phone: telefone, email, website: siteLimpo,
        category: v('elNicho'), city: v('elCidade'), notes: v('elNotas'),
      };
      let r;
      try {
        r = await call(`/ops/leads/${encodeURIComponent(id)}`, 'PATCH', corpoEdicao);
      } catch (e) {
        toast(`A base recusou a alteração: ${e.message}`, true);
        return;
      }
      if (!r || r.ok === false || !r.lead) { toast('A alteração não ficou guardada.', true); return; }
      S.lead = r.lead;
      S.editandoLead = false;
      const i = S.leads.findIndex((x) => x.id === r.lead.id);
      if (i >= 0) S.leads[i] = r.lead;
      toast('Alterações guardadas.');
      paint();
      return;
    }

    if (name === 'guardar-lead') {
      const v = id => String($('#' + id)?.value || '').trim();
      if (!v('nlNome')) { toast('O lead precisa de um nome.', true); return; }
      const r = await call('/ops/leads', 'POST', { leads: [{
        name: v('nlNome'), category: v('nlNicho'), city: v('nlCidade'),
        phone: v('nlTelefone') || undefined, website: v('nlSite') || undefined, source: 'manual',
      }] });
      toast(r.created ? 'Lead guardado.' : r.updated ? 'Este lead já existia — atualizei os dados.' : 'Não entrou.', !r.created && !r.updated);
      S.adding = false;
      await boot();
      return;
    }

    /* 30 out 2026 · cópia de segurança do modo local: um browser não é uma base de dados */
    if (name === 'exportar-local') {
      const api = usarLocal();
      const blob = new Blob([api.exportar()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mesa-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Cópia guardada. É o ficheiro com tudo o que está aqui.');
      return;
    }
    if (name === 'importar-local') { $('#lbFile')?.click(); return; }
    if (name === 'para-a-base') {
      const copia = JSON.parse(usarLocal().exportar());
      let j;
      try {
        j = await call('/ops/importar', 'POST', {
          leads: copia.leads, projetos: copia.projetos, receitas: copia.receitas,
        });
      } catch (e) {
        toast(`A base recusou: ${e.message}`, true);
        return;
      }
      toast(`Enviado: ${j.leadsNovos} leads novos (${j.leadsRepetidos} já estavam), ${j.projetos} projetos, ${j.receitas} entradas.`);
      S.modoLocal = false; S.baseLigada = true;
      await boot();
      return;
    }

    if (name === 'receita') {
      const valor = Number(String($('#valor')?.value || '').replace(',', '.'));
      if (!valor) { toast('Diz o valor que entrou.', true); return; }
      await call('/ops/receita', 'POST', { euros: valor, campaign: $('#campanha')?.value || '' });
      toast('Entrada registada.');
      await boot();
      return;
    }

    if (name === 'apagar-receita') {
      await call(`/ops/receita/${encodeURIComponent(id)}`, 'DELETE');
      toast('Entrada apagada.');
      await boot();
    }
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------- arranque ---------------- */
function start() {
  S.route = parseHash();
  paintNav();
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.tagName === 'BUTTON') e.preventDefault();
    act(b.dataset.act, b, e);
  });
  document.addEventListener('change', async e => {
    const daIA = e.target.closest('[data-act="ia-preferido"]');
    if (daIA) { await accaoIA('ia-preferido', daIA, apiMesa); return; }
    const sel = e.target.closest('[data-act="papel"]');
    if (!sel) return;
    try {
      const r = await call(`/ops/utilizadores/${encodeURIComponent(sel.dataset.id)}/papel`, 'POST', { role: sel.value });
      toast(`Papel de ${r.utilizador.email} passou a ${r.utilizador.roleLabel}.`);
      await loadContas(); paint();
    } catch (err) { toast(err.message, true); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'gq') {
      S.gq = e.target.value;
      clearTimeout(start._gq);
      start._gq = setTimeout(async () => {
        if (String(S.gq || '').trim().length < 2) { S.results = null; paint(); return; }
        try { S.results = await call('/ops/pesquisa?q=' + encodeURIComponent(S.gq)); } catch { S.results = null; }
        paint();
        const inp = document.querySelector('#gq');
        if (inp) { inp.focus(); try { inp.setSelectionRange(S.gq.length, S.gq.length); } catch { /* ok */ } }
      }, 280);
      return;
    }
    if (e.target.id === 'iaObjetivo') { S.iaObjetivo = e.target.value; return; }
    if (e.target.id !== 'q') return;
    S.q = e.target.value;
    const at = e.target.selectionStart;
    paint();
    const q = document.querySelector('#q');
    if (q) { q.focus(); try { q.setSelectionRange(at, at); } catch { /* ok */ } }
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open'));
  });
  window.addEventListener('hashchange', async () => {
    S.route = parseHash();
    S.pick = null;
    if (S.route.name !== 'ia') pararSeguimento();
    if (S.route.name !== 'papel') fecharCamera();
    if (S.route.name === 'lead' && S.route.id) { try { await loadLead(S.route.id); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'projeto' && S.route.id) { try { await loadProjeto(S.route.id); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'papel' && !S.papelEstado) { try { await carregarPapel(apiMesa); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'tarefas') { try { await loadTarefas(); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'agentes') { try { await loadAgentes(); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'contas') { try { await loadContas(); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'leads' && !S.pipeline) { try { await loadPipeline(); } catch (e) { toast(e.message, true); } }
    paintNav();
    paint();
    main().scrollIntoView({ block: 'start' });
  });
  ligarImportacao();
  ligarPapel(apiMesa, { rota: () => S.route.name });
  boot(true);
}

start();
