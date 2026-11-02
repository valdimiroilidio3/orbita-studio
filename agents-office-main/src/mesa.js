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
/* 1.48.0 · Cine: um lead, um projecto criativo (Master Prompt + peças) */
import { vistaCine, carregarCine, accaoCine, ligarCine } from './cine.js';
/* 1.54.2 · Briefing do projeto: briefing editável, Prompt Master e prompts de
   imagem — as três coisas ligadas à lead e ao projeto. */
import { vistaBriefing, carregarBriefing, accaoBriefing, ligarBriefing, podeSair } from './briefing.js';
/* 1.54.3 · a mídia do projeto: gerar imagem e vídeo a partir do briefing,
   com estimativa antes de gastar e estado que sobrevive a um recarregar. */
import { vistaMedia, carregarMedia, accaoMedia, ligarMedia, iniciarCiclo, pararCiclo } from './media.js';
/* 1.54.4 · um 404 de rota ≠ um 404 de recurso (a decisão é pura e está testada) */
import { decidirResposta } from './respostas.js';
/* 1.57.0 · o progresso do projeto e o resumo da lead: contas puras, testáveis
   sem DOM (ver `src/projeto.js`) */
import { progresso as progressoDoProjeto, resumoLead, iniciais, ABAS_PROJETO, abaValida } from './projeto.js';
/* 1.57.2 · a mesa como centro de comando: as quatro perguntas do topo, a fila
   de aprovações, o estado das salas e o que está bloqueado — contas puras,
   testáveis sem DOM (ver `src/painel.js`) */
import { resumoOperacional, filaDeAprovacao, estadoAgentes, atividadeRecente, proximosTrabalhos, bloqueios, saudacao, fraseDoEstado, plural } from './painel.js';
/* 1.59.0 · o CRM. As mesmas contas puras que o servidor usa para exportar e
   verificar (`src/crm.js`) — a mesa desenha o que elas dizem, não uma versão
   paralela da mesma verdade. */
import { confianca as confiancaCRM, verificacao as verificacaoCRM, proximaAccao as proximaAccaoCRM,
  qualificacao as qualificacaoCRM, resumoDoFunil, fraseDaCarteira, FASES, ESTADOS_SITE } from './crm.js';

/* 1.60.0 · MOTORES, AUTONOMIA E SALDO (2 nov 2026). O dono pediu que se
   percebesse, num sítio só: que motor está escolhido e o que ele sabe fazer
   (texto? mãos? ficheiros?), o estado das integrações e a última verificação,
   o consumo real com limites e custo, o nível de autonomia e o que exige
   aprovação. As contas vivem em `src/motores.js` e são puras — aqui só se
   desenha o que elas dizem. */
import {
  perfis as perfisDeMotores, escolhaDoAgente, resumoDaAutonomia,
  resumoDoConsumo, acoesSensiveis, filaRapida, barraDeAprovacao,
  cartoesDoPainel, CLASSES, NIVEIS_AUTONOMIA,
} from './motores.js';

/* 1.61.0 · EXECUÇÃO TRANSPARENTE (2 nov 2026). Pedido do dono: ver o que o
   agente fez, com que dados, o que mudou — e poder parar, repetir em segurança e
   saber quem autorizou. As contas (estados, recuperação, repetição segura,
   autorizações) vivem em `src/execucao.js` e são as MESMAS que o servidor usa. */
import {
  estadoDoRun, cartaoDoRun, passosDoRun, registoDoRun, autorizacoesDoRun,
  cancelamentoDe, podeCancelar, podeRepetir, podeAprovar, recuperacao,
  resumoDoRun, filaDeExecucao, avisosDaLista, quandoDe, ORDEM_ESTADOS,
} from './execucao.js';

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
  cine: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M9 5v5M15 5v5"/><circle cx="12" cy="15" r="2"/></svg>',
  enviar: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 3 10.5l6.4 2.3L21 3Z"/><path d="m9.4 12.8 2.3 6.4L21 3"/></svg>',
  tick: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5 5L20 6.5"/></svg>',
  chev: '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 5 7 7-7 7"/></svg>',
  lupa: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  copiar: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15"/></svg>',
  pastas: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l2 2.5h8A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17Z"/></svg>',
  tarefa: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 5.6 8 8.5 5"/><path d="M4 12.5 5.6 14l2.9-3"/><path d="M4 18.5 5.6 20l2.9-3"/><path d="M11.5 6.5H20M11.5 12.5H20M11.5 18.5H20"/></svg>',
  motor: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3.5a4.5 4.5 0 0 0-5.9 5.9L3.5 14.5a2.1 2.1 0 0 0 3 3l5.1-5.1a4.5 4.5 0 0 0 5.9-5.9l-2.6 2.6-2.5-.1-.1-2.5Z"/></svg>',
  ia: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9.5 15.5h5"/></svg>',
  agentes: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.6"/><circle cx="17" cy="9.5" r="2.2"/><path d="M3 19c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6"/><path d="M14.8 14.7c2.6-.4 5.2 1.2 5.2 4.3"/></svg>',
  contas: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.4 3-5.6 7-5.6s7 2.2 7 5.6"/></svg>',
  vazio: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1-1.3 2.2-2 3.5-2s2.5.7 3.5 2"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
};

const NAV = [
  { k: 'hoje', label: 'Visão geral', ic: 'hoje' },
  { k: 'leads', label: 'Leads', ic: 'leads' },
  { k: 'papel', label: 'Papel', ic: 'papel' },
  { k: 'cine', label: 'Cine', ic: 'cine' },
  { k: 'projetos', label: 'Projetos', ic: 'pastas' },
  { k: 'tarefas', label: 'Tarefas', ic: 'tarefa' },
  { k: 'agentes', label: 'Agentes', ic: 'agentes' },
  { k: 'execucoes', label: 'Execuções', ic: 'ia' },
  { k: 'ia', label: 'IA', ic: 'ia' },
  { k: 'motores', label: 'Motores', ic: 'motor' },
  { k: 'contas', label: 'Contas', ic: 'contas' },
  { k: 'conversas', label: 'Conversas', ic: 'conversas' },
  { k: 'saldo', label: 'Saldo', ic: 'saldo' },
  { k: 'faturas', label: 'Faturas', ic: 'saldo' },
];

const S = {
  route: { name: 'hoje', id: null },
  summary: null, today: null, leads: [], messages: [], saldo: null, clientes: null,
  lead: null, leadMessages: [], dossier: null, editandoLead: false,
  /* 1.59.0 · o CRM: o histórico do lead, os duplicados e o estado de exportação */
  leadEventos: [], duplicados: null, mostrarDuplicados: false, aExportar: false,
  /* 1.60.0 · a autonomia por tipo (lida da base) — o resto dos motores vem de S.ia */
  autonomia: null, autonomiaErro: '',
  /* 1.61.0 · as execuções: a lista, a execução aberta e o filtro escolhido */
  execucoes: [], execucao: null, execucaoErro: '', execucaoFiltro: 'todas',
  execucoesRecentes: [],
  pick: null, filter: 'todos', q: '', busy: false, error: '', adding: false,
  projetos: [], projeto: null, tipos: [], token: null, addingProject: false,
  /* 1.57.0 · a aba aberta na página do projeto (Briefing por omissão) */
  projetoTab: 'briefing',
  tarefas: [], agentes: null, tiposTarefa: [], deptos: [], tarefaFiltro: { dept: null, state: null },
  pipeline: null, atividade: null, addingTask: false, searching: false, results: null,
  eu: null, needLogin: false, authEstado: null, primeiraConta: false, aRecuperar: false, aRegistar: false, aConfirmar: null, contas: null, sessoes: [],
  /* 1.18.0 · Control Center da IA */
  ia: null, iaUso: null, iaRuns: [], iaRun: null, iaObjetivo: '',
  /* 1.54.2 · briefing do projeto (briefing, Prompt Master, prompts de imagem) */
  briefing: null,
  /* 1.54.3 · a mídia gerada (imagem e vídeo) do projeto aberto */
  media: null,
  /* 1.54.4 · o projeto que o endereço pede e a base não tem (link antigo,
     projeto apagado): mostra-se isso, em vez de «modo local» com a base viva */
  projetoErro: null,
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
  let j = {};
  try { j = await r.json(); } catch { /* resposta vazia */ }

  /* 1.54.4 · uma resposta, uma decisão (ver `src/respostas.js`). A diferença que
     se corrigiu: um 404 de ROTA continua a cair no armazém do browser (a
     instalação é antiga, e a mesa não fica em branco), mas um 404 de RECURSO
     («projeto não encontrado») passa a ser um erro com a frase do servidor —
     antes anunciava «a base de dados não está a responder» com a base viva. */
  const d = decidirResposta({ httpOk: r.ok, httpStatus: r.status, envelope: j });
  if (d.tipo === 'local') return usarLocal().call(path, method, body);
  if (d.tipo === 'base') {
    S.baseMotivo = d.motivo || 'a base de dados não respondeu';
    return usarLocal().call(path, method, body);
  }
  if (d.tipo === 'login') {
    S.baseLigada = true;
    const c = d.corpo || {};
    if (c.hint || c.mode === 'sessao' || c.error === 'entra' || /entra/i.test(d.mensagem || '')) {
      // instalação com contas: mostra o ecrã de entrada (não um prompt do browser)
      S.needLogin = true;
      throw Object.assign(new Error(d.mensagem || 'entra para continuar'), { login: true, body: c });
    }
    // token de máquina (instalação sem contas): pede uma vez e guarda no browser
    const given = prompt('Este Órbita está protegido. Cola o ORBITA_ADMIN_TOKEN:');
    S.tokenPrompted = true;
    if (given) {
      S.token = given;
      try { localStorage.setItem(TOKEN_KEY, given); } catch { /* sem storage */ }
      return call(path, method, body);
    }
    throw Object.assign(new Error(d.mensagem || 'entra para continuar'), { status: 401, body: c });
  }
  if (d.tipo === 'erro') {
    const e = new Error(d.mensagem || `HTTP ${d.estado}`);
    e.status = d.estado;
    e.codigo = d.codigo || null;
    e.body = d.corpo || null;
    throw e;
  }
  S.baseLigada = true;
  return d.corpo;
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
  const cru = (location.hash || '#/hoje').replace(/^#\/?/, '');
  /* 1.54.1 · o link do email é `/app/#/confirmar?t=…` (ou `#/redefinir?t=…`).
     Sem esta leitura, o link abria a mesa em «Hoje» e ninguém confirmava nada. */
  const [caminho, query] = cru.split('?');
  if (caminho === 'confirmar' || caminho === 'redefinir') {
    const t = new URLSearchParams(query || '').get('t') || '';
    S.aConfirmar = caminho === 'confirmar' ? t : null;
    S.aRecuperar = caminho === 'redefinir';
    S.tokenDoLink = caminho === 'redefinir' ? t : null;
    S.needLogin = true;
    return { name: 'hoje', id: null };
  }
  const [name, id] = cru.split('/');
  /* 1.61.0 · `execucoes` e `execucao/:id` entram na lista de rotas conhecidas. */
  const known = ['hoje', 'leads', 'papel', 'cine', 'conversas', 'saldo', 'faturas', 'lead', 'projetos', 'projeto', 'tarefas', 'agentes', 'contas', 'ia', 'motores', 'execucoes', 'execucao'];
  return { name: known.includes(name) ? name : 'hoje', id: id ? decodeURIComponent(id) : null };
}

function paintNav() {
  if (S.needLogin) { $('#nav').innerHTML = ''; $('#tabbar').innerHTML = ''; return; }
  const cur = S.route.name === 'lead' ? 'leads' : S.route.name;
  const pend = S.today?.decidir?.length || 0;
  const nav = NAV.filter(n => n.k !== 'contas' || may('admin')).map(n => `<a href="#/${n.k}" class="${cur === n.k ? 'on' : ''}"${cur === n.k ? ' aria-current="page"' : ''}>${IC[n.ic]}<span>${n.label}</span>${n.k === 'hoje' && pend ? `<span class="n">${pend}</span>` : ''}</a>`).join('');
  $('#nav').innerHTML = nav;
  // No telemóvel cabem seis: o resto (Conversas) fica a um toque a partir de Hoje.
  /* 1.60.0: no telemóvel, «Motores» entra na barra (é onde se vê o que corre e
     com que permissões); «Agentes» continua a um toque a partir de Hoje. */
  const TABS = ['hoje', 'leads', 'projetos', 'tarefas', 'motores', 'saldo'];
  $('#tabbar').innerHTML = NAV.filter(n => TABS.includes(n.k) && (n.k !== 'contas' || may('admin')))
    .map(n => `<a href="#/${n.k}" class="${cur === n.k ? 'on' : ''}"${cur === n.k ? ' aria-current="page"' : ''}>${IC[n.ic]}<span>${n.label}</span></a>`).join('');
}

/* 1.60.0 · O PAINEL MÓVEL. No telemóvel o escritório não se comprime: mostra-se
   o que está a acontecer em cartões — um número por pergunta, e cada cartão
   leva ao sítio onde se age. É o mesmo `cartoesDoPainel` que os testes provam. */
function cartoesMoveis({ tarefas = [], mensagens = [] } = {}) {
  const cartoes = cartoesDoPainel({ tarefas, mensagens }).filter((c) => ['a-correr', 'espera', 'falhou', 'custo'].includes(c.id));
  if (!cartoes.length) return '';
  return `<div class="mo-cards" aria-label="painel rápido">
    ${cartoes.map((c) => `<a class="mo-card${c.destaque ? ' hot' : ''}" href="${esc(c.ir)}">
      <span class="mo-card-k">${esc(c.rotulo)}</span>
      <b>${c.valor == null ? '—' : c.tipo === 'centimos' ? money(c.valor) : esc(String(c.valor))}</b>
      <span class="mo-card-n">${esc(c.nota)}</span>
    </a>`).join('')}
  </div>`;
}

/* A barra de uma mão: a primeira decisão à espera, com a acção principal. Fica
   acima da barra de separadores, dentro do alcance do polegar, e não aparece
   quando não há nada para decidir (um aviso permanente deixa de ser um aviso). */
function paintMobar() {
  const el = document.getElementById('mobar');
  if (!el) return;
  if (S.needLogin) { el.innerHTML = ''; el.hidden = true; return; }
  /* 1.61.0 · uma execução parada à espera de aprovação é uma decisão como as
     outras — e no telemóvel tem de caber no polegar. */
  const pedidos = (S.execucoesRecentes || [])
    .filter((r) => estadoDoRun(r).id === 'a_espera')
    .slice(0, 3)
    .map((r) => ({ id: r.id, titulo: String(r.objetivo || 'execução').slice(0, 70), detalhe: 'execução parada à espera de aprovação', accao: 'abrir', quando: r.criado }));
  const fila = filaRapida({ mensagens: S.messages || [], tarefas: S.tarefas || [], pedidos });
  const b = barraDeAprovacao(fila);
  if (!b.principal) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const p = b.principal;
  const act = p.tipo === 'pedido' ? 'run-abrir'
    : p.tipo === 'tarefa' ? 'aprovar-tarefa'
      : (p.accao === 'enviar' ? 'enviar' : 'aprovar');
  el.hidden = false;
  el.innerHTML = `
    <div class="mobar-txt">
      <b>${b.total === 1 ? '1 decisão à tua espera' : `${b.total} decisões à tua espera`}</b>
      <span>${esc(p.titulo)} · ${esc(p.detalhe)}</span>
    </div>
    <div class="mobar-acts">
      <button class="btn ghost small" data-act="tarefa-rapida" title="criar uma tarefa">+ Tarefa</button>
      <button class="btn primary" data-act="${esc(act)}" data-id="${esc(p.id)}">${esc(p.rotuloAccao)}</button>
    </div>`;
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
    </div>
    <!-- 1.57.0 · o cartão do fundo: só números que existem (o custo das APIs na
         janela de 30 dias). Não há aqui planos nem quotas inventadas. -->
    <div class="plan">
      <div class="plan-t">Consumo de APIs</div>
      <div class="plan-v">${s ? money(s.custos?.apiCentimos) : '—'}</div>
      <div class="plan-s">últimos 30 dias · ${clientes.length ? esc(clientes.find(c => c.id === activo)?.nome || 'sem espaço') : 'sem espaço de cliente'}</div>
      <a class="plan-b" href="#/saldo">Ver consumo ${IC.chev}</a>
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
  const [summary, today, leads, messages, saldo, clientes, projetos, execucoes] = await Promise.all([
    call('/ops/summary').catch(() => null),
    call('/ops/today').catch(() => null),
    call('/ops/leads?limit=200').catch(() => ({ leads: [] })),
    call('/ops/messages?limit=100').catch(() => ({ messages: [] })),
    call('/ops/saldo').catch(() => null),
    call('/ops/clientes').catch(() => null),
    call('/ops/projetos').catch(() => ({ projetos: [], resumo: null, tipos: [] })),
    /* 1.61.0 · as últimas execuções servem a barra de uma mão: uma execução
       parada à espera de aprovação tem de estar ao alcance do polegar. */
    call('/ia/runs?limite=12').catch(() => null),
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
  S.execucoesRecentes = execucoes?.runs || [];
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
  try {
    const r = await call(`/ops/projetos/${encodeURIComponent(id)}`);
    /* 1.57.0 · o painel lateral mostra a lead; sem ela, diz que não há. A
       falha desta leitura não pode derrubar o projeto inteiro. */
    const leadId = r?.project?.lead_id;
    const lead = leadId ? await call(`/ops/leads/${encodeURIComponent(leadId)}`).then((x) => x?.lead || null).catch(() => null) : null;
    S.projeto = { ...r, lead };
    S.projetoErro = null;
  } catch (e) {
    /* 404 = este projeto não existe (ou foi apagado). Dizer a verdade, com um
       caminho de saída — não deixar o ecrã no esqueleto de «a abrir o projeto…». */
    S.projeto = null;
    S.projetoErro = e?.status === 404
      ? { id, naoExiste: true, texto: `Este projeto não existe nesta instalação (ou foi apagado). O endereço aponta para «${id}».` }
      : { id, naoExiste: false, texto: e?.message || 'não consegui abrir o projeto' };
    throw e;
  }
}

async function loadLead(id) {
  const r = await call(`/ops/leads/${encodeURIComponent(id)}`);
  S.lead = r.lead;
  S.editandoLead = false;   // abrir outro lead nunca herda o formulário do anterior
  S.dossier = r.dossier || null;
  S.leadMessages = r.messages || [];
  /* 1.59.0 · o rasto: quem mudou o quê, e quando. Sem a migração aplicada o
     servidor devolve uma lista vazia — e a mesa di-lo, em vez de fingir história. */
  S.leadEventos = r.eventos || [];
}

async function boot(full = true) {
  try {
    if (full) {
      if (!(await loadEu())) { paintNav(); paint(); return; }
      await loadCommon();
    }
    if (S.route.name === 'lead' && S.route.id) await loadLead(S.route.id);
    if (S.route.name === 'projeto' && S.route.id) {
      await loadProjeto(S.route.id);
      /* o briefing vive no projeto: lê-se com ele, e uma falha aqui não tapa a
         página (a vista do briefing mostra a razão e um botão para tentar) */
      await carregarBriefing(apiMesa, S.route.id).catch(() => null);
      /* 1.54.3 · a mídia lê-se com o projeto; se houver trabalhos a decorrer,
         o ciclo retoma sozinho — recarregar a página não perde o estado */
      const M = await carregarMedia(apiMesa, S.route.id).catch(() => null);
      if (M && (M.dados?.geracoes || []).some((g) => ['aguardando', 'em_processamento'].includes(g.estado))) {
        iniciarCiclo(apiMesa);
      }
    }
    /* 1.57.2 · o centro de comando responde com as tarefas, o registo e as
       salas na mão. É a mesma leitura da página de tarefas — não uma nova. */
    if (S.route.name === 'hoje') {
      await Promise.all([loadTarefas().catch(() => null), loadAgentes().catch(() => null)]);
    }
    if (S.route.name === 'tarefas') await loadTarefas();
    if (S.route.name === 'agentes') await loadAgentes();
    if (S.route.name === 'contas') await loadContas();
    if (S.route.name === 'ia') await carregarIA(apiMesa);
    /* 1.60.0 · os motores leem o estado da IA, o uso e a autonomia de uma vez */
    if (S.route.name === 'motores') await carregarMotores();
    /* 1.61.0 · as execuções: a lista, ou uma execução e os seus passos */
    if (S.route.name === 'execucoes') await carregarExecucoes();
    if (S.route.name === 'execucao' && S.route.id) await carregarExecucao(S.route.id);
    if (S.route.name === 'papel' && !S.papelEstado) await carregarPapel(apiMesa);
    if (S.route.name === 'cine') await carregarCine(apiMesa, S.route.id);
    if (S.route.name === 'leads' && !S.pipeline) await loadPipeline();
    /* 1.56.0 · as faturas só se lêem quando a página as mostra */
    if (S.route.name === 'faturas') await loadFaturas();
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

/* ---------------- Visão geral: o centro de comando ---------------- */
/*
   1.57.2 · Quatro perguntas, quatro respostas na primeira dobra:

     1. o que está a acontecer  → o cartão «A acontecer agora» e «A seguir»;
     2. o que foi concluído     → «Concluído (24 h)» com a série de 7 dias;
     3. o que precisa de ti     → a fila de aprovações, com Aprovar/Rejeitar;
     4. o que está bloqueado    → tarefas falhadas e projetos sem QA.

   O estado das salas aparece aqui, sem abrir o escritório: sai das tarefas
   reais (`src/painel.js`), não de um campo decorativo. Tudo o que existia
   antes continua: escolher um rascunho (`pick`), o cartão da decisão com
   Aprovar/Rejeitar/Abrir, a pastilha de envios e as contas de leads.
*/

const ROTULO_TAREFA = {
  investigar: 'Investigar o lead', mensagem: 'Escrever uma mensagem',
  briefing: 'Escrever o briefing', codigo: 'Gerar o código', qa: 'Auditoria de qualidade',
};

const ESTADO_SALA = {
  'a-trabalhar': 'A trabalhar',
  bloqueado: 'Bloqueado',
  'espera-ti': 'Espera por ti',
  'na-fila': 'Na fila',
  'em-descanso': 'Em descanso',
  'sem-trabalho': 'Sem trabalho',
};

/** As barras pequenas do cartão «Concluído»: só contagens reais, um dia por barra. */
function ccSpark(serie = []) {
  if (!serie.length) return '';
  const maior = Math.max(1, ...serie.map((d) => d.n));
  return `<span class="cc-spark" aria-hidden="true" title="${esc(serie.map((d) => `${d.dia} ${d.n}`).join(' · '))}">
    ${serie.map((d) => `<i style="height:${Math.max(12, Math.round((d.n / maior) * 100))}%" class="${d.n ? '' : 'vazio'}"></i>`).join('')}
  </span>`;
}

function ccKpis(cc) {
  return `<div class="cc-kpis">
    ${cc.cartoes.map((c) => `<article class="cc-kpi ${c.tom}" aria-label="${esc(c.label)}: ${c.valor}">
      <div class="cc-kpi-h"><span>${esc(c.label)}</span>${c.serie ? ccSpark(c.serie) : ''}</div>
      <b>${c.valor}</b>
      <div class="cc-kpi-n">${esc(c.nota)}</div>
    </article>`).join('')}
  </div>`;
}

function ccFila(fila, pick) {
  if (!fila.length) {
    return `<div class="cc-vazio">${IC.tick}
      <div><b>Nada à espera de ti</b><span>Quando houver um rascunho ou uma tarefa que exija o teu OK, aparece aqui — com o texto pronto e os botões certos.</span></div>
    </div>`;
  }
  return `<ul class="cc-rows">${fila.map((i) => {
    const urg = `<span class="cc-urg ${i.urgencia}">${i.urgencia === 'alta' ? 'alta' : i.urgencia === 'media' ? 'média' : 'baixa'}</span>`;
    const quando = i.idade ? `<span class="cc-quando">há ${esc(i.idade)}</span>` : '';
    if (i.tipo === 'tarefa') {
      return `<li class="cc-row">
        <span class="cc-ic">${IC.tarefa}</span>
        <div class="cc-row-t"><b>${esc(i.titulo)}</b><span>${esc(i.detalhe)} ${quando}</span></div>
        ${urg}
        <div class="cc-row-a">
          <button class="btn ghost small" data-act="rejeitar-tarefa" data-id="${esc(i.id)}">Rejeitar</button>
          <button class="btn primary small" data-act="aprovar-tarefa" data-id="${esc(i.id)}">Aprovar</button>
        </div>
      </li>`;
    }
    const on = pick && pick.id === i.id;
    return `<li class="cc-row ${on ? 'on' : ''}">
      <button class="cc-row-pick" data-act="pick" data-id="${esc(i.id)}" aria-pressed="${on}">
        <span class="cc-ic">${i.tipo === 'autonomia' ? IC.ia : IC.enviar}</span>
        <div class="cc-row-t"><b>${esc(i.titulo)}</b><span>${esc(i.detalhe)} ${quando}</span></div>
        ${urg}
        <span class="cc-open">${on ? 'Aberto' : 'Ver'}</span>
      </button>
    </li>`;
  }).join('')}</ul>`;
}

function ccAgentes(ag) {
  if (!ag.linhas.length) {
    return `<div class="cc-vazio">${IC.agentes}
      <div><b>Sem salas ligadas</b><span>O estado dos agentes vem das tarefas. Assim que houver uma tarefa, a sala dela aparece aqui.</span></div>
    </div>`;
  }
  return `<ul class="cc-ags">
    ${ag.linhas.map((l) => `<li class="cc-ag">
      <span class="cc-dot ${esc(l.estado)}" aria-hidden="true"></span>
      <div class="cc-ag-t"><b>${esc(l.nome)}</b>
        <span>${esc(ESTADO_SALA[l.estado] || l.estado)}${l.ultimaIdade ? ` · há ${esc(l.ultimaIdade)}` : ''}</span></div>
      <span class="cc-ag-c">${l.aCorrer ? `${l.aCorrer} a correr` : l.falhadas ? plural(l.falhadas, 'falha', 'falhas') : l.naFila ? `${l.naFila} na fila` : l.concluidas ? plural(l.concluidas, 'feita', 'feitas') : '—'}</span>
    </li>`).join('')}
  </ul>
  <div class="cc-foot">${ag.resumo.aTrabalhar} a trabalhar · ${plural(ag.resumo.bloqueados, 'sala bloqueada', 'salas bloqueadas')} · ${ag.resumo.descanso} em descanso
    <a href="#/agentes">ver todas as salas</a></div>`;
}

function ccTimeline(itens) {
  if (!itens.length) {
    return `<div class="cc-vazio">${IC.hoje}
      <div><b>Ainda sem atividade</b><span>O que as salas fizerem aparece aqui por ordem: tarefas concluídas, falhas e registos da operação.</span></div>
    </div>`;
  }
  return `<ul class="cc-tl">${itens.map((i) => `<li class="cc-tl-i ${esc(i.tom)}">
    <span class="cc-tl-q">${esc(hhmm(i.quando))}</span>
    <div><b>${esc(i.titulo)}</b>${i.detalhe ? `<span>${esc(i.detalhe)}</span>` : ''}</div>
  </li>`).join('')}</ul>`;
}

function ccProximos(lista) {
  if (!lista.length) {
    return `<div class="cc-vazio">${IC.tarefa}
      <div><b>Nada marcado</b><span>Sem tarefas a correr nem na fila. Uma tarefa nova nasce num lead ou na página de tarefas.</span></div>
    </div>`;
  }
  return `<ul class="cc-rows">${lista.map((t) => `<li class="cc-row cc-row-simples">
    <span class="cc-ic">${IC.tarefa}</span>
    <div class="cc-row-t"><b>${esc(t.titulo)}</b><span>${[t.entidade ? `ligada a ${esc(t.entidade)}` : '', t.idade ? `há ${esc(t.idade)}` : ''].filter(Boolean).join(' · ') || esc(TASK_LABEL[t.estado] || t.estado)}</span></div>
    <span class="tag ${TASK_TAG[t.estado] || ''}">${esc(TASK_LABEL[t.estado] || t.estado)}</span>
  </li>`).join('')}</ul>`;
}

function ccBloqueios(lista) {
  if (!lista.length) {
    return `<div class="cc-vazio ok">${IC.tick}
      <div><b>Nada bloqueado</b><span>Sem tarefas falhadas nem projetos à espera de QA.</span></div>
    </div>`;
  }
  return `<ul class="cc-rows">${lista.map((b) => `<li class="cc-row cc-row-simples risco">
    <span class="cc-ic">${IC.vazio}</span>
    <div class="cc-row-t"><b>${esc(b.titulo)}</b><span>${esc(b.motivo)}${b.idade ? ` · há ${esc(b.idade)}` : ''}</span></div>
    ${b.rota ? `<a class="cc-open" href="${esc(b.rota)}">Abrir</a>` : `<a class="cc-open" href="#/tarefas">Abrir</a>`}
  </li>`).join('')}</ul>`;
}

function viewHoje() {
  const pick = pickDecision();
  const agora = Date.now();
  const tarefas = Array.isArray(S.tarefas) ? S.tarefas : [];
  const rotulos = { ...ROTULO_TAREFA, ...Object.fromEntries((S.tiposTarefa || []).map((t) => [t.id, t.label])) };
  const cc = resumoOperacional({ tarefas, hoje: S.today, projetos: S.projetos || [], agora });
  const ag = estadoAgentes({ departamentos: S.agentes?.departamentos || [], tarefas, agora });
  const fila = filaDeAprovacao({ hoje: S.today, tarefas, rotulos, agora });
  const timeline = atividadeRecente({ eventos: S.atividade?.eventos || [], tarefas, rotulos, limite: 8 });
  const proximos = proximosTrabalhos({ tarefas, rotulos, limite: 6, agora });
  const presos = bloqueios({ tarefas, projetos: S.projetos || [], rotulos, agora, limite: 5 });
  const primeiro = String(S.eu?.user?.name || '').split(/\s+/)[0] || '';
  /* instalação mesmo vazia: em vez de quatro zeros sem saída, três caminhos
     reais (leads, tarefa, projeto) e a frase que diz o que acontece a seguir */
  const vazio = !tarefas.length && !(S.today?.decidir || []).length
    && !(S.leads || []).length && !(S.projetos || []).length;
  const quem = primeiro ? `, ${primeiro}` : '';

  return `<div class="wrap cc">
    ${headHTML({
      title: 'Visão geral',
      sub: `${esc(saudacao(agora))}${esc(quem)} · ${esc(fraseDoEstado(cc))} · <span class="count">${esc(LONG_DATE)}</span>`,
      right: `<button class="btn ghost small" data-act="reload" title="voltar a ler tarefas, atividade e decisões">↻ Actualizar</button>${stopPill()}`,
    })}
    ${ccKpis(cc)}
    ${cartoesMoveis({ tarefas, mensagens: S.messages || [] })}
    ${vazio ? `<section class="card cc-card cc-start" aria-labelledby="ccStart">
      <div class="sec-h"><h2 id="ccStart">Por onde começar</h2><span class="count">a mesa está vazia</span></div>
      <p class="hint" style="margin-top:0">Ainda não há leads, tarefas nem projetos guardados. Nada aqui é simulado: os números ficam a zero até existir trabalho a sério.</p>
      <div class="cc-start-l">
        <a class="cc-start-i" href="#/leads"><b>1 · Trazer leads</b><span>Pesquisar empresas por cidade e nicho, ou escrever um lead à mão.</span></a>
        <a class="cc-start-i" href="#/tarefas"><b>2 · Pedir trabalho</b><span>Criar uma tarefa (investigar, mensagem, briefing, código, QA) e vê-la correr.</span></a>
        <a class="cc-start-i" href="#/projetos"><b>3 · Abrir um projeto</b><span>Um projeto nasce de um lead e leva o briefing até à entrega.</span></a>
      </div>
    </section>` : ''}
    <div class="cc-grid">
      <div class="cc-col">
        <section class="card cc-card" aria-labelledby="ccAprov">
          <div class="sec-h"><h2 id="ccAprov">Aprovações pendentes</h2>
            <span class="count">${fila.length ? `${fila.length} à espera` : 'em dia'}</span></div>
          ${ccFila(fila, pick)}
        </section>
        ${pick ? decisionCard() : ''}
        <section class="card cc-card" aria-labelledby="ccAtiv">
          <div class="sec-h"><h2 id="ccAtiv">Atividade recente</h2><span class="count">últimos registos</span></div>
          ${ccTimeline(timeline)}
        </section>
      </div>
      <aside class="cc-side">
        <section class="card cc-card" aria-labelledby="ccSalas">
          <div class="sec-h"><h2 id="ccSalas">Estado dos agentes</h2>
            <span class="count">${ag.resumo.aTrabalhar ? `${ag.resumo.aTrabalhar} a trabalhar` : 'sem trabalho em curso'}</span></div>
          ${ccAgentes(ag)}
        </section>
        <section class="card cc-card" aria-labelledby="ccProx">
          <div class="sec-h"><h2 id="ccProx">A seguir</h2><span class="count">${proximos.length ? `${proximos.length} em aberto` : 'em dia'}</span></div>
          ${ccProximos(proximos)}
        </section>
        <section class="card cc-card" aria-labelledby="ccBloq">
          <div class="sec-h"><h2 id="ccBloq">Bloqueado</h2><span class="count">${presos.length ? plural(presos.length, 'preso', 'presos') : 'nada'}</span></div>
          ${ccBloqueios(presos)}
        </section>
      </aside>
    </div>
    <section class="cc-leads" aria-labelledby="ccLeads">
      <div class="sec-h"><h2 id="ccLeads">Leads e custos</h2><span class="count">os mesmos números de sempre</span></div>
      ${statsHTML()}
    </section>
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

/* 1.57.0 · a pesquisa global mudou-se para o cabeçalho (é a mesma em todas as
   páginas). Aqui só se desenha a lista de resultados; a caixa e o atalho Ctrl+K
   vivem no cabeçalho. */
function resultadosBusca() {
  const r = S.results;
  if (!S.gq || String(S.gq).trim().length < 2) return '';
  if (!r) return `<div class="hres" hidden></div>`;
  if (!r.total) return `<div class="hres"><div class="vazio">Nada encontrado para «${esc(r.query)}» — nem leads, nem projetos, nem tarefas.</div></div>`;
  return `<div class="hres" role="listbox" aria-label="resultados da pesquisa">
    ${r.grupos.filter(g => g.itens.length).map(g => `<div class="sec-h"><h3>${esc(g.label)}</h3><span class="count">${g.itens.length}</span></div>
      ${g.itens.map(i => `<a role="option" href="${esc(i.route)}"><b>${esc(i.name || i.title || i.id)}</b>${(i.city || i.client || i.kindLabel) ? ` <span class="count">${esc(i.city || i.client || i.kindLabel)}</span>` : ''}</a>`).join('')}`).join('')}
  </div>`;
}

/* 1.57.0 · o cabeçalho da aplicação: pesquisa global com Ctrl+K, o número de
   decisões à espera, e a conta (nome, espaço, papel) com menu. Tudo com dados
   que existem — sem avatar inventado, sem quota fictícia. */
function paintHead() {
  const el = $('#appHead');
  if (!el) return;
  /* no ecrã de entrada não há cabeçalho: não há sessão para pesquisar nem conta
     para mostrar (uma barra vazia de 76 px só roubava altura ao formulário) */
  el.hidden = !!S.needLogin;
  if (S.needLogin) { el.innerHTML = ''; return; }
  const user = S.eu?.user || null;
  const nome = user?.name || user?.email || 'modo local';
  const org = S.clientes?.activo?.nome || user?.organizacao || (S.eu?.local ? 'neste browser' : 'Órbita');
  const espera = S.today?.decidir?.length || 0;
  el.innerHTML = `
    <div class="hsearch">
      ${IC.lupa}
      <input id="gq" type="search" placeholder="Pesquisar leads, projetos e tarefas…" value="${esc(S.gq || '')}"
        aria-label="pesquisa global" aria-keyshortcuts="Control+K" autocomplete="off">
      <kbd>Ctrl K</kbd>
      ${resultadosBusca()}
    </div>
    <div class="hacts">
      <a class="hicon" href="#/hoje" title="${espera ? espera + ' decisão(ões) à espera' : 'sem decisões à espera'}" aria-label="${espera ? espera + ' decisões à espera' : 'nenhuma decisão à espera'}">
        ${IC.hoje}${espera ? `<span class="ndot">${espera > 9 ? '9+' : espera}</span>` : ''}
      </a>
      <details class="hmenu huser">
        <summary aria-label="conta de ${esc(nome)}">
          <span class="av">${esc(iniciais(nome))}</span>
          <span class="who"><b>${esc(nome)}</b><span>${esc(org)}</span></span>
          ${IC.chev}
        </summary>
        <div class="hmenu-l">
          <div style="padding:8px 10px 6px"><b style="font-size:13.5px;display:block">${esc(nome)}</b><span class="count">${esc(papelLabel() || 'sem papel definido')}</span></div>
          <div class="sep"></div>
          ${may('admin') ? '<a href="#/contas">Contas e acessos</a>' : ''}
          <a href="#/saldo">Consumo e saldo</a>
          <a href="#/faturas">Faturas</a>
          <div class="sep"></div>
          <button type="button" data-act="sair">Sair</button>
        </div>
      </details>
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

/* ===========================================================================
   1.59.0 · O CRM (2 nov 2026)

   O dono pediu que a prospecção valesse: dados verificáveis, contactos que
   avançam para oportunidade, e nada inventado. O que muda na página:

     · um cartão com os números da carteira (fases do funil, contactáveis, sites
       verificados, ações atrasadas, duplicados) e os dois gestos que faltavam —
       exportar em CSV e ver os duplicados;
     · cada linha diz a confiança nos dados, o estado da verificação do site e a
       próxima ação (com «atrasada» quando está);
     · a ficha do lead ganha proveniência, verificação a sério (com data), a
       próxima ação editável e o histórico de quem fez o quê.
   =========================================================================== */

/** O estado da verificação do site, em pequeno: a cor e a data, ou a falta dela. */
function chipDoSite(l) {
  const v = verificacaoCRM(l);
  const quando = v.quando ? ` em ${esc(String(v.quando).slice(0, 10))}` : '';
  return `<span class="crm-chip" style="--c:${v.cor}" title="${esc(v.rotulo)}${v.motivo ? ` — ${esc(v.motivo)}` : ''}">${esc(v.rotulo)}${quando}</span>`;
}

/** A confiança nos dados, com as razões no `title` (não se afirma sem dizer porquê). */
function chipDaConfianca(l) {
  const c = confiancaCRM(l);
  return `<span class="crm-chip" style="--c:${c.cor}" title="${esc(c.razoes.join(' · '))}">${c.pontos}/100 · ${esc(c.nivel)}</span>`;
}

/** A próxima ação: o texto, quando, e se está atrasada. */
function linhaDaProxima(l) {
  const p = proximaAccaoCRM(l);
  if (p.estado === 'sem') return '';
  const cor = p.estado === 'atrasada' ? 'var(--risk)' : p.estado === 'hoje' ? 'var(--warn)' : 'var(--muted)';
  return `<div class="crm-prox" style="color:${cor}">→ ${esc(p.texto || 'sem texto')} · ${esc(p.rotulo)}</div>`;
}

function crmCard() {
  const r = resumoDoFunil(S.leads);
  if (!r.total) return '';
  return `<div class="card crm-card" style="margin-bottom:var(--s4)">
    <div class="sec-h">
      <h3>Carteira</h3>
      <span class="count">${esc(fraseDaCarteira(r))}</span>
      <span class="sp" style="flex:1"></span>
      ${may('read') ? `<button class="btn small ghost" data-act="csv-leads" title="descarregar todos os leads em CSV (abre no Excel)">↓ CSV</button>` : ''}
      ${r.duplicados ? `<button class="btn small ghost" data-act="ver-duplicados" aria-expanded="${S.mostrarDuplicados ? 'true' : 'false'}">⚠ ${r.duplicados} duplicado${r.duplicados === 1 ? '' : 's'}</button>` : ''}
    </div>
    <div class="stats" style="margin-bottom:var(--s3)">
      ${r.fases.map(f => `<div class="stat crm-fase" data-fase="${esc(f.id)}"><b>${f.n}</b><span>${esc(f.label)}${f.n ? ` · ${f.percentagem}%` : ''}</span></div>`).join('')}
    </div>
    <div class="crm-sinais">
      <span class="crm-sinal"><b>${r.comContacto}</b> com contacto${r.total ? ` (${r.contactaveis}%)` : ''}</span>
      <span class="crm-sinal"><b>${r.verificados}</b> com site verificado</span>
      <span class="crm-sinal"><b>${r.porVerificar}</b> por verificar</span>
      <span class="crm-sinal ${r.atrasadas ? 'bad' : ''}"><b>${r.atrasadas}</b> com ação atrasada</span>
    </div>
    ${S.mostrarDuplicados ? duplicadosCard() : ''}
    <div class="hint">A confiança não é a nota: a nota diz «vale a pena contactar»; a confiança diz «o que está guardado é de fiar» — e cada ponto tem a razão escrita ao lado (passa o rato por cima).</div>
  </div>`;
}

/** Os duplicados que a base não juntou. Mostrar, nunca fundir sozinho. */
function duplicadosCard() {
  if (!S.duplicados) return `<div class="crm-dup"><div class="hint" style="margin:0">a procurar duplicados…</div></div>`;
  if (S.duplicados.erro) return `<div class="crm-dup"><div class="hint bad" style="margin:0">Não consegui analisar os duplicados: ${esc(S.duplicados.erro)}. Nada foi alterado.</div></div>`;
  const g = S.duplicados.grupos || [];
  if (!g.length) return `<div class="crm-dup"><div class="hint" style="margin:0">Nenhum duplicado: nenhum par de leads partilha telefone, site ou nome.</div></div>`;
  return `<div class="crm-dup">
    <div class="crm-dup-h"><b>${g.length} grupo${g.length === 1 ? '' : 's'} parecido${g.length === 1 ? '' : 's'}</b>
      <span>${esc(String(S.duplicados.leads ?? S.leads.length))} leads analisados · nada foi fundido</span></div>
    ${g.map(x => `<div class="crm-dup-g">
      <div class="crm-dup-m">${esc(x.rotulo)}</div>
      <div class="crm-dup-l">${x.leads.map(m => `<button class="crm-dup-i" data-act="ver-lead" data-id="${esc(m.id)}" title="abrir «${esc(m.name)}» para decidir">
        <b>${esc(m.name)}</b><span>${esc([m.city, m.phone, (m.website || '').replace(/^https?:\/\//, '')].filter(Boolean).join(' · ') || 'sem contacto')}</span>
        <em>${esc(statusLabel[m.status] || m.status || '—')}</em></button>`).join('')}</div>
    </div>`).join('')}
    <div class="hint" style="margin:0">Fundir dois leads apaga um deles. O Órbita mostra o par e deixa a decisão a quem conhece o negócio — abrir cada um e corrigir o que está errado é sempre seguro.</div>
  </div>`;
}

function viewLeads() {
  const list = filteredLeads();
  const total = S.leads.length;
  const alta = S.leads.filter(l => (l.score || 0) >= 60).length;
  const chips = [['todos', 'Todos'], ['novo', 'Por contactar'], ['sem-site', 'Sem site'], ['responderam', 'Responderam']];
  const carteira = resumoDoFunil(S.leads);
  return `<div class="wrap">
    ${headHTML({
      title: 'Leads',
      sub: total ? esc(fraseDaCarteira(carteira)) : 'ainda não há nenhum lead guardado',
      right: `${may('write') ? '<button class="btn small ghost" data-act="actualizar-leads" title="voltar a ler os leads da base">↻ Actualizar</button><button class="btn small ghost" data-act="novo-lead">+ Lead</button>' : ''}${stopPill()}`,
    })}
    ${procurarLeadsForm()}
    ${S.adding ? novoLeadForm() : ''}
    ${crmCard()}
    ${pipelineCard()}
    <div class="tools">
      <div class="search">${IC.lupa}<input id="q" type="search" placeholder="Procurar por nome, cidade, nicho…" value="${esc(S.q)}" aria-label="procurar leads"></div>
      ${chips.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`).join('')}
    </div>
    ${list.length ? `<div class="rows">${list.map(l => `<button class="row crm" data-act="ver-lead" data-id="${esc(l.id)}">
      <div><div class="nm">${esc(l.name)}</div><div class="mt">${esc([l.category, l.city].filter(Boolean).join(' · ') || 'sem nicho nem cidade')}</div>${linhaDaProxima(l)}</div>
      <div class="cell hide-m">${esc(l.website ? l.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : (l.phone || l.email || 'sem contacto'))}${chipDoSite(l)}</div>
      <div class="cell hide-m crm-conf">${chipDaConfianca(l)}</div>
      <div class="cell tag-cell"><span class="tag ${esc(l.status)}">${esc(statusLabel[l.status] || l.status)}</span></div>
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

/* 1.59.0 · PROVENIÊNCIA E CONFIANÇA. De onde veio este contacto, se o site foi
   mesmo verificado (e quando), e quanta fé merecem os dados — com as razões.
   O botão «verificar» pede o site a sério: o servidor diz o código HTTP, se
   devolveu uma página e quanto tempo levou. Sem isso, uma data de verificação
   seria uma frase inventada. */
function leadProvaCard(l) {
  const v = verificacaoCRM(l);
  const c = confiancaCRM(l);
  const q = qualificacaoCRM(l);
  const linha = (rotulo, valor, extra = '') => `<tr><td style="color:var(--muted);white-space:nowrap">${esc(rotulo)}</td><td>${valor}${extra}</td></tr>`;
  return `<div class="card crm-prova">
    <div class="sec-h"><h3>Proveniência e confiança</h3>
      <span class="count">${c.pontos}/100 · ${esc(c.nivel)}</span></div>
    <div class="crm-bar" role="img" aria-label="confiança ${c.pontos} de 100"><i style="width:${c.pontos}%;background:${c.cor}"></i></div>
    <table><tbody>
      ${linha('Fonte', esc(l.source || 'não registada'))}
      ${linha('Endereço da fonte', l.fonte_url ? `<a href="${esc(l.fonte_url)}" target="_blank" rel="noreferrer noopener">${esc(String(l.fonte_url).replace(/^https?:\/\//, '').slice(0, 48))}</a>` : '<span style="color:var(--muted)">não guardado</span>')}
      ${linha('Site', l.website ? `<a href="${esc(/^https?:\/\//i.test(l.website) ? l.website : `https://${l.website}`)}" target="_blank" rel="noreferrer noopener">${esc(l.website.replace(/^https?:\/\//, ''))}</a>` : '<span style="color:var(--muted)">sem site</span>')}
      ${linha('Verificação', `<span class="crm-chip" style="--c:${v.cor}">${esc(v.rotulo)}</span>${v.quando ? `<span class="count"> · ${esc(String(v.quando).slice(0, 10))}</span>` : ''}${v.motivo ? `<div class="hint" style="margin:4px 0 0">${esc(v.motivo)}</div>` : ''}`)}
      ${linha('Qualificação', q.valor == null ? '<span style="color:var(--muted)">sem dados para qualificar</span>' : `<b>${q.valor}</b> <span class="count">· ${esc(q.rotulo)}</span>`)}
    </tbody></table>
    <details class="why-box"><summary><span>Porquê esta confiança<small>${c.razoes.length} razões · abre para ver</small></span>${IC.chev}</summary>
      <div class="why-grid">${c.razoes.map(x => `<div class="why"><span class="tick">${IC.tick}</span><span>${esc(x)}</span></div>`).join('')}</div>
    </details>
    <div class="acts" style="margin-top:var(--s3)">
      ${l.website
        ? `<button class="btn ghost small" data-act="verificar-site" data-id="${esc(l.id)}" title="pedir o site agora e guardar a data e o resultado">Verificar site agora</button>`
        : '<span class="hint" style="margin:0">Sem site guardado não há nada para verificar — acrescenta o endereço em «Editar».</span>'}
    </div>
  </div>`;
}

/* 1.59.0 · A PRÓXIMA AÇÃO. Um lead sem próximo passo é uma linha numa lista.
   A data é opcional (uma ação escrita sem data continua a valer), mas quando
   há data a mesa diz se está atrasada — e não esconde isso numa nota. */
function leadProximaCard(l) {
  const p = proximaAccaoCRM(l);
  const quando = p.quando ? String(p.quando).slice(0, 10) : '';
  const cor = p.estado === 'atrasada' ? 'var(--risk)' : p.estado === 'hoje' ? 'var(--warn)' : 'var(--muted)';
  return `<div class="card">
    <div class="sec-h"><h3>Próxima ação</h3>
      <span class="count" style="color:${cor}">${esc(p.rotulo)}</span></div>
    <div class="form two pares">
      <label class="fld"><span>O que fazer</span>
        <input class="in" id="proxAcao" placeholder="ex.: ligar e confirmar o horário" value="${esc(l.proxima_acao || '')}" autocomplete="off"></label>
      <label class="fld"><span>Quando (opcional)</span>
        <input class="in" id="proxAcaoEm" type="date" value="${esc(quando)}"></label>
    </div>
    <div class="acts" style="margin-top:var(--s3)">
      <button class="btn primary small" data-act="guardar-proxima" data-id="${esc(l.id)}">Guardar próxima ação</button>
      ${l.proxima_acao || l.proxima_acao_em ? `<button class="btn ghost small" data-act="limpar-proxima" data-id="${esc(l.id)}">Limpar</button>` : ''}
    </div>
    <div class="hint">O que fica escrito aqui é o que a lista mostra em cada linha — e o que conta como «atrasada» quando o dia passa.</div>
  </div>`;
}

/* 1.59.0 · QUEM FEZ O QUÊ. Uma linha por alteração, com o autor. É o que faltava
   para se poder responder a «quem marcou isto como ganho?» sem adivinhar. */
const TIPO_EVENTO = {
  criado: 'criado', estado: 'estado comercial', verificacao: 'verificação do site', edicao: 'edição',
  proxima_acao: 'próxima ação', qualificacao: 'qualificação', nota: 'nota', projeto: 'projeto', mensagem: 'mensagem',
};
function leadEventosCard() {
  const ev = S.leadEventos || [];
  return `<div class="card">
    <div class="sec-h"><h3>Quem fez o quê</h3><span class="count">${ev.length ? `${ev.length} registo(s)` : 'sem registos'}</span></div>
    ${ev.length ? `<table><tbody>${ev.slice(0, 20).map(e => `<tr>
      <td style="color:var(--muted);white-space:nowrap">${esc(hhmm(e.criado))} · ${esc(when(e.criado))}</td>
      <td><b>${esc(TIPO_EVENTO[e.tipo] || e.tipo)}</b> — ${esc(e.texto)}</td>
      <td class="n" style="color:var(--muted)">${esc(e.autor || 'sem autor')}</td>
    </tr>`).join('')}</tbody></table>`
      : `<p class="hint" style="margin:0">Ainda não há registos deste lead. O histórico começa na primeira alteração — e a tabela do servidor tem de estar criada (migração <code>orbita_1_59_0.sql</code>). Até lá, nada é inventado.</p>`}
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
    <div class="form two pares" style="margin-top:var(--s2)">
      ${campo('elCidade', 'Cidade', l.city, 'text', 'placeholder="Coimbra"')}
      ${campo('elQualificacao', 'Qualificação (0–100)', l.qualificacao, 'number', 'min="0" max="100" step="1" placeholder="sem valor"')}
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

/* 1.48.0 · o Cine começa aqui: um lead aberto é um projecto criativo à espera
   de plano. O cartão é uma porta, não um formulário — o trabalho faz-se lá. */
function cineDoLead(l) {
  return `<div class="card cine-entrada">
    <div class="sec-h"><h3>Peça cinematográfica</h3><span class="count">Master Prompt próprio desta lead</span></div>
    <p class="hint" style="margin-top:0">O sistema lê o que se sabe deste negócio, escolhe a direcção de arte e escreve o conceito, a narrativa e o prompt de imagem — e depois gera as peças a sério, com o histórico guardado aqui.</p>
    <div class="acts" style="margin-top:var(--s3)">
      <a class="btn primary small" href="#/cine/${esc(l.id)}">Abrir no Cine</a>
      <a class="btn ghost small" href="#/cine">Ver os projectos</a>
    </div>
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
    ${cineDoLead(l)}
    <div style="display:grid;gap:var(--s4);margin-top:var(--s4)">
      ${leadProvaCard(l)}
      ${leadProximaCard(l)}
      ${S.editandoLead ? leadEditForm() : leadFacts()}
      ${projetoDoLead
        ? `<div class="card"><div class="sec-h"><h3>Projeto</h3><span class="tag ${PROJ_TAG[projetoDoLead.status]}">${esc(PROJ_LABEL[projetoDoLead.status] || projetoDoLead.status)}</span></div>
            <p class="hint" style="margin-top:0">${esc(projetoDoLead.name)}</p>
            <div class="acts" style="margin-top:var(--s3)"><a class="btn primary small" href="#/projeto/${esc(projetoDoLead.id)}">Abrir briefing e projeto</a></div></div>`
        : `<div class="card"><div class="sec-h"><h3>Projeto</h3><span class="count">ainda não existe</span></div>
            <p class="hint" style="margin-top:0">Iniciar o projeto abre o briefing já preenchido com o que a ficha desta lead sustenta. Depois: Prompt Master, prompts de imagem e o código — um negócio, um projeto.</p>
            <div class="acts" style="margin-top:var(--s3)"><button class="btn primary small" data-act="criar-projeto" data-id="${esc(l.id)}">Iniciar projeto</button></div></div>`}
      ${leadEventosCard()}
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

/* 1.54.2 · o briefing vive dentro do projeto: uma aba para o briefing editável,
   outra para o Prompt Master, outra para os prompts de imagem. */
function briefingDoProjeto(p) {
  if (!S.briefing || S.briefing.projetoId !== p.id) {
    return `<div class="card" style="margin-top:var(--s4)"><div class="skeleton">a abrir o briefing…</div></div>`;
  }
  return vistaBriefing(S, { projeto: p });
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

/* ---------------- 1.57.0 · a página do projeto ----------------
   O que mudou, e porquê: o projeto tinha o briefing, a mídia e a construção
   empilhados na mesma coluna, cada um com a sua cabeça e as suas abas. A pessoa
   não sabia onde estava. Agora há um sítio só, com o caminho (Projetos / nome),
   as quatro abas e duas colunas: o trabalho à esquerda, o acompanhamento à
   direita.

   Regras que se mantêm: nada é inventado (o progresso vem das etapas reais, o
   resumo da lead dos campos guardados), nenhuma acção existente desapareceu
   (construção, QA, ficheiros, entregas e histórico continuam abaixo, com os
   mesmos `data-act`), e o formulário do briefing continua a ser o mesmo —
   `vistaBriefing` só deixou de desenhar as abas dele, que passaram a ser as
   desta página. */

const ICONE_ABA = {
  briefing: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></svg>',
  master: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z"/><path d="M18 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"/></svg>',
  imagens: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 16 4.5-4.5 3.5 3.5 3-3L20 16"/><circle cx="9" cy="9.5" r="1.3"/></svg>',
  video: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 11 5-3v8l-5-3z"/></svg>',
};

/** «26 out 2026» — a data que se lê numa etapa concluída. */
function dataCurta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }).replace('.', '');
}

function cartaoProgresso(pr) {
  const rotulo = { feito: 'Concluído', activo: 'Em andamento', pendente: 'Pendente' };
  return `<section class="card pj-panel" aria-labelledby="pjProgresso">
    <header class="pj-panel-h">
      <h2 id="pjProgresso">Progresso do projeto</h2>
      <span class="pj-pct" title="média das cinco etapas: concluída = 1, em andamento = 0,5">${pr.pct}%</span>
    </header>
    <div class="pj-bar" role="progressbar" aria-valuenow="${pr.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="progresso do projeto"><i style="width:${pr.pct}%"></i></div>
    <ol class="pj-steps">
      ${pr.etapas.map((e) => `<li class="pj-step ${e.estado}">
        <span class="pj-dot" aria-hidden="true">${e.estado === 'feito' ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>' : ''}</span>
        <span class="pj-step-nm">${esc(e.nome)}</span>
        <span class="pj-step-st">${esc(e.nota || rotulo[e.estado])}</span>
      </li>`).join('')}
    </ol>
    <p class="pj-note">${pr.feitas} de ${pr.etapas.length} etapas concluídas. A percentagem sai do estado real de cada uma — não é um número escrito à mão.</p>
  </section>`;
}

function cartaoLead(lead) {
  return `<section class="card pj-panel" aria-labelledby="pjLead">
    <header class="pj-panel-h">
      <h2 id="pjLead">Resumo da lead</h2>
      ${lead.existe && lead.linhas.some((l) => l.chave === 'contacto' && l.copiavel)
        ? `<button class="pj-copy" data-act="proj-copiar" data-valor="${esc(lead.linhas.find((l) => l.chave === 'contacto').valor)}" aria-label="copiar o contacto da lead" title="copiar o contacto">${IC.copiar}</button>`
        : ''}
    </header>
    ${lead.existe ? `<dl class="pj-lead">
      ${lead.linhas.map((l) => `<div class="pj-lead-row">
        <dt>${esc(l.label)}</dt>
        <dd>${l.href
          ? `<a href="${esc(l.href)}">${esc(l.valor)}</a>`
          : esc(l.valor)}</dd>
      </div>`).join('')}
    </dl>
    <a class="pj-lead-link" href="#/lead/${esc(S.projeto?.lead?.id || '')}">Abrir a lead completa</a>`
      : `<p class="pj-note">${esc(lead.nota)}</p>`}
  </section>`;
}

function viewProjeto() {
  const d = S.projeto;
  if (!d) {
    const erro = S.projetoErro;
    if (!erro) return `<div class="wrap"><div class="skeleton">a abrir o projeto…</div></div>`;
    return `<div class="wrap">
      <div style="margin-bottom:var(--s3)"><a href="#/projetos" class="btn quiet small">‹ Projetos</a></div>
      <div class="card" style="margin-top:var(--s3)">
        <div class="sec-h"><h3>${erro.naoExiste ? 'Projeto não encontrado' : 'Não consegui abrir o projeto'}</h3></div>
        <p class="hint" style="margin-top:0" role="alert">${esc(erro.texto)}</p>
        <div class="acts" style="margin-top:var(--s4)">
          <a class="btn primary" href="#/projetos">Ver todos os projetos</a>
          <button class="btn ghost" data-act="reload">Tentar outra vez</button>
        </div>
        ${erro.naoExiste ? '<div class="hint">Se o projeto devia existir, confirma a ligação à base em Definições. Um projeto apagado não volta com «Tentar outra vez».</div>' : ''}
      </div>
    </div>`;
  }

  const p = d.project;
  const qa = d.qa;
  const aba = abaValida(S.projetoTab);
  const podeGerar = ['rascunho', 'gerado', 'qa_falhou', 'qa_passou', 'aprovado', 'entregue'].includes(p.status);
  const podeQa = ['gerado', 'qa_falhou', 'qa_passou', 'aprovado', 'entregue'].includes(p.status);
  const podeAprovar = p.status === 'qa_passou' && qa?.passed;
  const podeEntregar = ['aprovado', 'entregue'].includes(p.status) && qa?.passed;

  /* as abas «Imagens» e «Vídeo» são a mesma vista com o tipo fixo: quem manda o
     tipo é `vistaMedia` (tipoFixo), não uma escrita lateral a meio do render */

  const pr = progressoDoProjeto({ projeto: p, briefing: S.briefing, media: S.media });
  const lead = resumoLead(d.lead || null);
  const sub = [p.niche, p.client, p.city].filter(Boolean).join(' · ') || 'sem nicho nem cliente';
  const painel = aba === 'briefing'
    ? vistaBriefing(S, { projeto: p, painel: 'briefing', semAbas: true })
    : aba === 'master'
      ? vistaBriefing(S, { projeto: p, painel: 'master', semAbas: true })
      : vistaMedia(S, { projeto: p, tipoFixo: aba === 'imagens' ? 'imagem' : 'video', semCabeca: true });

  return `<div class="wrap pj">
    <nav class="pj-crumbs" aria-label="caminho">
      <a href="#/projetos">Projetos</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.name)}</span>
    </nav>

    <header class="pj-head">
      <div class="pj-id">
        <span class="pj-ic" aria-hidden="true">${esc(iniciais(p.name))}</span>
        <div class="pj-id-t">
          <h1>${esc(p.name)}</h1>
          <p class="pj-sub">${esc(sub)}</p>
        </div>
      </div>
      <div class="pj-head-acts">
        <span class="tag pj-status ${PROJ_TAG[p.status] || ''}">${esc(PROJ_LABEL[p.status] || p.status)}</span>
        <details class="pj-menu">
          <summary class="pj-menu-b" aria-label="mais acções do projeto" title="mais acções">⋯</summary>
          <div class="pj-menu-l" role="menu">
            ${p.lead_id ? `<a role="menuitem" href="#/lead/${esc(p.lead_id)}">Ver a lead</a>` : ''}
            ${p.preview_url ? `<a role="menuitem" href="${esc(p.preview_url)}" target="_blank" rel="noopener">Abrir preview</a>` : ''}
            ${(d.files || []).length ? `<button role="menuitem" data-act="zip">Obter .zip</button>` : ''}
            <button class="pj-menu-i" role="menuitem" data-act="reload">Actualizar</button>
          </div>
        </details>
      </div>
    </header>

    <div class="pj-tabs-bar">
      <div class="pj-tabs" role="tablist" aria-label="secções do projeto">
        ${ABAS_PROJETO.map((a) => `<button class="pj-tab${aba === a.id ? ' on' : ''}" role="tab" aria-selected="${aba === a.id}" id="pjTab-${a.id}" aria-controls="pjPainel" data-act="proj-tab" data-tab="${a.id}">
          ${ICONE_ABA[a.id] || ''}<span>${esc(a.label)}</span>
        </button>`).join('')}
      </div>
    </div>

    <div class="pj-grid" id="pjPainel" role="tabpanel" aria-labelledby="pjTab-${aba}">
      <div class="pj-main">
        ${painel || `<div class="card"><div class="skeleton">a abrir esta secção…</div></div>`}
      </div>
      <aside class="pj-aside">
        ${cartaoProgresso(pr)}
        ${cartaoLead(lead)}
      </aside>
    </div>

    <section class="pj-more" aria-label="construção e entrega">
      <div class="card" style="margin-top:var(--s4)">
        <div class="sec-h"><h3>Construção</h3><span class="count">${esc(p.kind || 'landing')} · código, qualidade e entrega</span></div>
        <p class="hint" style="margin-top:0">${esc(p.brief || 'O código nasce do briefing guardado: gera-se a partir do que está escrito e confirmado, não do que se imagina.')}</p>
        ${(p.goals || []).length ? `<div class="why-grid" style="margin-top:var(--s3)">${p.goals.slice(0, 6).map(g => `<div class="why"><span class="tick">${IC.tick}</span><span>${esc(g)}</span></div>`).join('')}</div>` : ''}
        ${(p.acceptance || []).length ? `<div class="hint">Critérios de aceitação: ${p.acceptance.map(a => esc(a)).join(' · ')}</div>` : ''}
        <div class="acts" style="margin-top:var(--s4)">
          ${podeGerar && may('write') ? `<button class="btn ${p.status === 'rascunho' ? 'primary' : 'ghost'}" data-act="gerar">${p.status === 'rascunho' ? 'Gerar o código' : 'Gerar outra vez'}</button>` : ''}
          ${podeQa && may('write') ? `<button class="btn ${['gerado', 'qa_falhou'].includes(p.status) ? 'primary' : 'ghost'}" data-act="qa">Correr o QA</button>` : ''}
          ${podeAprovar && may('approve') ? `<button class="btn primary" data-act="aprovar-projeto"${qa?.passed ? '' : ' disabled'}>Aprovar</button>` : ''}
          ${podeEntregar && qa?.passed && may('approve') ? `<button class="btn ${p.status === 'aprovado' ? 'primary' : 'ghost'}" data-act="entregar">Entregar preview</button>` : ''}
          ${p.preview_url ? `<a class="btn ghost" href="${esc(p.preview_url)}" target="_blank" rel="noopener">Abrir preview</a>` : ''}
          ${(d.files || []).length ? `<button class="btn ghost" data-act="zip">Obter .zip</button>` : ''}
        </div>
        <div class="hint" id="leadNote">${p.status === 'rascunho' ? 'O primeiro passo escreve os ficheiros no disco — nada é publicado.' : 'A entrega só passa com QA aprovado e ficheiros iguais aos auditados.'}</div>
      </div>
      <div class="cards2" style="margin-top:var(--s4)">
        <div class="card">
          <div class="sec-h"><h3>Qualidade</h3><span class="count">${qa ? esc(hhmm(qa.at)) + ' · ' + esc(when(qa.at)) : 'nunca correu'}</span></div>
          ${qaReport(qa)}
          ${(d.changes || []).length ? `<div class="hint bad">Ficheiros alterados depois do QA: ${d.changes.map(c => esc(c.file)).join(', ')}. Corre o QA outra vez.</div>` : ''}
        </div>
        <div class="card">
          <div class="sec-h"><h3>Ficheiros</h3><span class="count">${(d.files || []).length}</span></div>
          ${(d.files || []).length ? `<table><tbody>${d.files.map(f => `<tr><td>${esc(f.file)}${f.changed ? ' <span class="tag perdido">alterado</span>' : ''}</td><td class="n">${(f.size / 1024).toFixed(1)} KB</td></tr>`).join('')}</tbody></table>`
            : '<div class="hint">Ainda não há ficheiros. Gera o código para os escrever.</div>'}
        </div>
      </div>
      <div class="cards2" style="margin-top:var(--s4)">
        <div class="card">
          <div class="sec-h"><h3>Entregas</h3><span class="count">preview · Vercel · GitHub</span></div>
          ${(d.deliveries || []).length ? `<table><tbody>${d.deliveries.map(x => `<tr><td>${esc(x.target)}</td><td><span class="tag ${x.status === 'concluido' ? 'respondeu' : 'perdido'}">${esc(x.status)}</span></td><td class="n">${esc(when(x.at))}</td></tr>`).join('')}</tbody></table>`
            : '<div class="hint">Nada entregue ainda.</div>'}
          <div class="acts" style="margin-top:var(--s3)">
            <button class="btn ghost small" data-act="entregar-vercel">Vercel</button>
            <button class="btn ghost small" data-act="entregar-github">GitHub</button>
          </div>
          <div class="hint">Vercel e GitHub só avançam com credenciais no .env — e uma recusa diz exactamente o que falta.</div>
        </div>
        <div class="card">
          <div class="sec-h"><h3>Histórico</h3><span class="count">${(d.events || []).length}</span></div>
          <ul class="feed">${(d.events || []).slice(0, 12).map(e => `<li><b>${esc(e.action.replace('projeto.', ''))}</b> <span class="count">${esc(when(e.at))}</span><br><span class="hint">${esc(String(e.detail || '').slice(0, 120))}</span></li>`).join('') || '<li class="hint">Sem eventos.</li>'}</ul>
        </div>
      </div>
    </section>
  </div>`;
}

/* ---------------- entrar ---------------- */
function viewLogin() {
  const primeira = S.primeiraConta;
  const estado = S.authEstado || {};
  /* 1.54.0 · a porta: se a instalação pede o token de criação, o campo aparece
     (e diz onde está), em vez de o botão falhar sem explicação. */
  const exigeToken = !!(primeira && estado.exigeToken);
  const aRecuperar = !!S.aRecuperar;
  /* 1.54.1 · quem chega de um link de confirmação vê o passo em que está */
  const aConfirmar = !!S.aConfirmar;
  /* registo aberto: a instalação diz se aceita contas novas (ORBITA_REGISTO) */
  const aRegistar = !!S.aRegistar && !primeira && !aRecuperar && !aConfirmar;
  if (aConfirmar) {
    return `<div class="wrap" style="max-width:520px;margin:8vh auto 0">
      <div class="brand" style="padding:0 0 var(--s5)"><span class="mark" aria-hidden="true"></span> Órbita</div>
      <div class="card">
        <h1 style="font-size:28px;margin-bottom:var(--s2)">Confirmar a conta</h1>
        <p class="hint" style="margin-top:0">Este é o passo que prova que o email é teu. O link vale 24 horas e serve uma vez.</p>
        <div class="form" style="grid-template-columns:1fr">
          <input class="in" id="cfToken" placeholder="cola aqui o token do email" aria-label="token de confirmação" value="${esc(S.aConfirmar || '')}">
          <button class="btn primary" data-act="confirmar-conta">Confirmar e entrar</button>
          <button class="btn quiet small" data-act="fechar-confirmar">Voltar</button>
        </div>
      </div>
    </div>`;
  }
  return `<div class="wrap" style="max-width:520px;margin:8vh auto 0">
    <div class="brand" style="padding:0 0 var(--s5)"><span class="mark" aria-hidden="true"></span> Órbita</div>
    <div class="card">
      <h1 style="font-size:28px;margin-bottom:var(--s2)">${primeira ? 'Criar a primeira conta' : aRegistar ? 'Criar conta' : 'Entrar'}</h1>
      <p class="hint" style="margin-top:0">${primeira
        ? 'Esta instalação ainda não tem contas. A primeira é a do dono — e só pode ser criada uma vez.'
        : aRegistar
          ? 'A tua conta entra como leitora: vês tudo, não alteras nada até um dono te subir o papel.'
          : 'Entra com o email e a palavra-passe que um dono te deu.'}</p>
      <div class="form" style="grid-template-columns:1fr">
        ${primeira || aRegistar ? '<input class="in" id="lgNome" placeholder="O teu nome" aria-label="nome" autocomplete="name">' : ''}
        <input class="in" id="lgEmail" type="email" placeholder="Email" aria-label="email" autocomplete="username" value="">
        ${aRecuperar ? `<input class="in" id="rgToken" placeholder="cola aqui o token do email" aria-label="token de recuperação" value="${esc(S.tokenDoLink || '')}"><input class="in" id="lgPass" type="password" placeholder="Palavra-passe nova (12+)" aria-label="palavra-passe nova" autocomplete="new-password"><input class="in" id="lgPass2" type="password" placeholder="Repetir a palavra-passe nova" aria-label="repetir palavra-passe nova">` : ''}
        ${!aRecuperar ? `<input class="in" id="lgPass" type="password" placeholder="${primeira || aRegistar ? 'Palavra-passe (12+ caracteres)' : 'Palavra-passe'}" aria-label="palavra-passe" autocomplete="${primeira || aRegistar ? 'new-password' : 'current-password'}">` : ''}
        ${(primeira || aRegistar) && !aRecuperar ? '<input class="in" id="lgPass2" type="password" placeholder="Repetir a palavra-passe" aria-label="repetir palavra-passe">' : ''}
        ${exigeToken ? '<input class="in" id="lgToken" type="password" placeholder="SETUP_TOKEN da instalação" aria-label="token de instalação">' : ''}
        <button class="btn primary" data-act="${aRecuperar ? 'redefinir-palavra' : primeira ? 'criar-primeira-conta' : aRegistar ? 'registar' : 'entrar'}">${aRecuperar ? 'Guardar a palavra-passe nova' : primeira ? 'Criar conta e entrar' : aRegistar ? 'Criar conta e confirmar por email' : 'Entrar'}</button>
        ${!primeira && !aRecuperar && !aRegistar ? '<div class="hint" style="display:flex;gap:var(--s2);flex-wrap:wrap"><button class="btn quiet small" data-act="abrir-recuperar">Esqueci-me da palavra-passe</button><button class="btn quiet small" data-act="abrir-registo">Criar conta</button></div>' : ''}
        ${aRegistar ? '<button class="btn quiet small" data-act="voltar-entrar">Já tenho conta</button>' : ''}
      </div>
      <div class="hint" id="leadNote">${aRecuperar
        ? 'O link vale 30 minutos e uma vez só. Ao guardar, todas as sessões antigas desta conta fecham.'
        : primeira || aRegistar
          ? 'A palavra-passe é guardada com scrypt e sal próprio — nunca em claro, nunca em log.' + (exigeToken ? ' Esta instalação pede também o <b>SETUP_TOKEN</b> (Vercel → Settings → Environment Variables) para criar a primeira conta.' : '') + (aRegistar ? ' A conta fica <b>por confirmar</b> até abrires o link que vai para o teu email.' : '')
          : 'Sem conta, cria uma aqui, ou pede a um dono que te crie em Contas. A sessão dura ' + (S.horasSessao || 12) + ' h e renova-se enquanto a usares.'}</div>
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
        <td>${u.active ? '' : '<span class="tag perdido">inactiva</span>'}${u.confirmado === false ? ` <span class="tag">por confirmar</span> <button class="btn quiet small" data-act="confirmar-conta-admin" data-id="${esc(u.id)}">confirmar</button>` : ''}</td>
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

/* 1.53.2 · o cartão da tarefa lia uma forma que a base não devolve.
   O que chega do Supabase é `{ kind, entity_id, entidade, state, error,
   resultado, created_at, finished_at }`; o cartão pedia `title`, `dept`,
   `attempts`, `result`… e escrevia títulos vazios. Isto aceita as duas formas,
   para que «nada funciona» deixe de ser verdade por um campo mal lido. */
const DEPTO_DA_TAREFA = { investigar: 'prospeccao', mensagem: 'vendas', briefing: 'comando', codigo: 'engenharia', qa: 'engenharia' };

/* 1.55.0 · números grandes sem separadores de milhar confundem («1234567
   micro-USD»). O custo é sempre do servidor: aqui só se formata. */
const fmtNum = n => Number(n || 0).toLocaleString('pt-PT');
const tokensDaTarefa = t => t.custo?.tokens ?? t.tokens ?? 0;

function normalizarTarefa(t = {}) {
  const tipo = S.tiposTarefa.find(x => x.id === t.kind) || {};
  const deptId = t.dept || DEPTO_DA_TAREFA[t.kind] || 'comando';
  const dept = (S.deptos || []).find(x => x.id === deptId || x.key === deptId) || { nome: deptId, name: deptId, role: '' };
  return {
    ...t,
    titulo: t.title || tipo.label || t.kind || 'Tarefa',
    deptId,
    deptNome: dept.nome || dept.name || deptId,
    deptPapel: dept.role || '',
    entidade: t.entity || t.entidade || '',
    alvoId: t.entityId || t.entity_id || '',
    // o resultado vem em texto na base de produção e em objecto no esquema antigo
    textoResultado: typeof t.resultado === 'string' ? t.resultado : (t.result?.texto || ''),
    objectoResultado: t.result && typeof t.result === 'object' ? t.result : null,
    tentativas: Number.isFinite(t.attempts) ? t.attempts : null,
    maxTentativas: Number.isFinite(t.max_attempts) ? t.max_attempts : null,
  };
}

function tarefaCard(tarefaCrua) {
  const t = normalizarTarefa(tarefaCrua);
  const podeCorrer = ['queued', 'failed', 'cancelled'].includes(t.state);
  const ev = t.evidence || [];
  const ligacao = t.alvoId
    ? `<a href="${t.entidade === 'projeto' ? '#/projeto/' + esc(t.alvoId) : t.entidade === 'lead' ? '#/lead/' + esc(t.alvoId) : '#'}" style="text-decoration:underline">${esc(t.alvoId)}</a>`
    : '';
  return `<div class="card" style="margin-bottom:var(--s3)">
    <div class="detail-top">
      <div><h3 style="font-size:var(--t-m)">${esc(t.titulo)}</h3>
        <div class="mt">${esc(t.deptNome)}${t.deptPapel ? ` · ${esc(t.deptPapel)}` : ''}${ligacao ? ` · ${ligacao}` : ''}</div></div>
      <span class="tag ${TASK_TAG[t.state] || ''}">${esc(TASK_LABEL[t.state] || t.state)}</span>
    </div>
    <div class="mt" style="margin-top:var(--s2)">
      ${t.tentativas != null ? `${t.tentativas}/${t.maxTentativas ?? '—'} tentativa(s) · ` : ''}${t.modelo ? `${esc(t.modelo)} · ` : ''}${t.finished_at ? `terminou ${esc(hhmm(t.finished_at))}` : t.created_at ? `criada ${esc(hhmm(t.created_at))}` : ''}
      ${t.needsApproval ? ' · acção externa: exige aprovação' : ''}
    </div>
    ${t.custo ? `<div class="mt" style="margin-top:var(--s2)">${t.custo.desconhecido
      ? `<span class="hint">custo desconhecido — ${esc(t.custo.nota || 'o motor não devolveu uso')}</span>`
      : `custou <b>${money(t.custo.centimos)}</b>${t.custo.microUsd ? ` <span class="count">(${fmtNum(t.custo.microUsd)} micro-USD · ${fmtNum(tokensDaTarefa(t))} tokens)</span>` : ''}`}</div>` : ''}
    ${t.error ? `<div class="hint bad" style="margin-top:var(--s2)">${esc(t.error)}</div>` : ''}
    ${t.textoResultado ? `<details class="why-box" style="margin-top:var(--s2)"><summary><span>Resultado<small>${esc(String(t.textoResultado).split('\n')[0].slice(0, 60))}</small></span>${IC.chev}</summary>
      <pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);margin:0">${esc(String(t.textoResultado).slice(0, 4000))}</pre></details>` : ''}
    ${t.objectoResultado && Object.keys(t.objectoResultado).length ? `<details class="why-box" style="margin-top:var(--s2)"><summary><span>Resultado<small>${esc(Object.keys(t.objectoResultado).slice(0, 4).join(', '))}</small></span>${IC.chev}</summary>
      <pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);margin:0">${esc(JSON.stringify(t.objectoResultado, null, 2).slice(0, 1600))}</pre>
      ${ev.length ? `<div class="hint">Evidência: ${ev.slice(0, 6).map(e => esc(e.label)).join(' · ')}</div>` : ''}</details>` : ''}
    ${ev.length && !t.textoResultado && !t.objectoResultado ? `<div class="hint">Evidência: ${ev.slice(0, 4).map(e => esc(e.label)).join(' · ')}</div>` : ''}
    <div class="acts" style="margin-top:var(--s3)">
      ${podeCorrer && may('write') ? `<button class="btn ${t.state === 'failed' ? 'ghost' : 'primary'} small" data-act="correr-tarefa" data-id="${esc(t.id)}">${t.state === 'failed' ? 'Repetir' : 'Correr'}</button>` : ''}
      ${t.state === 'awaiting_approval' && may('approve') ? `<button class="btn ghost small" data-act="rejeitar-tarefa" data-id="${esc(t.id)}">Rejeitar</button><button class="btn primary small" data-act="aprovar-tarefa" data-id="${esc(t.id)}">Aprovar</button>` : ''}
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
        <b>${esc(d.name || d.nome || d.id)}</b>
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

/* ---------------- Faturas (1.56.0) ----------------
   O que aqui está e porquê: um documento fiscal é o único sítio do produto onde
   um número errado custa dinheiro a sério. Por isso a lista mostra sempre o
   número e o estado, a fatura anulada continua visível (riscada, com a nota de
   crédito ao lado) e nada é calculado só no browser — os totais vêm do servidor,
   que os gravou. O PDF é gerado lá; aqui só há um link para ele. */

async function loadFaturas() {
  const f = await call('/ops/faturas');
  S.faturas = f;
  return f;
}

const faturasDe = () => S.faturas || { faturas: [], resumo: {}, emitente: {}, correio: {} };

function eurosTexto(c) {
  return (Math.round(Number(c) || 0) / 100)
    .toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function linhasDaNovaFatura() {
  if (!S.novaFatura) S.novaFatura = { linhas: [{ descricao: '', quantidade: '1', preco: '' }], iva: 23 };
  return S.novaFatura;
}

function formFatura() {
  const n = linhasDaNovaFatura();
  const isento = Number(n.iva) === 0;
  const opcoes = (faturasDe().taxasIva || [23, 13, 6, 0]);
  return `<div class="card" style="margin-bottom:var(--s4)">
    <div class="sec-h"><h3>Emitir uma fatura</h3><span class="count">o número é atribuído pelo servidor</span></div>
    <div class="form" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s3)">
      <label class="hint" for="fNome">Cliente<input class="in" id="fNome" placeholder="Clínica do Mondego"></label>
      <label class="hint" for="fNif">NIF (9 dígitos)<input class="in" id="fNif" inputmode="numeric" placeholder="509442013"></label>
      <label class="hint" for="fEmail">Email do cliente<input class="in" id="fEmail" type="email" placeholder="geral@cliente.pt"></label>
      <label class="hint" for="fMorada">Morada (opcional)<input class="in" id="fMorada" placeholder="Rua, código postal, cidade"></label>
    </div>
    <div id="faturaLinhas" style="margin-top:var(--s3)">
      ${n.linhas.map((l, i) => `<div class="form fatura-linha" style="display:grid;grid-template-columns:1fr 90px 130px 36px;gap:var(--s2);align-items:end;margin-bottom:var(--s2)">
        <label class="hint">O que foi vendido<input class="in" data-campo="descricao" data-idx="${i}" value="${esc(l.descricao)}" placeholder="Site institucional — 4 páginas"></label>
        <label class="hint">Qtd.<input class="in" data-campo="quantidade" data-idx="${i}" inputmode="decimal" value="${esc(l.quantidade)}"></label>
        <label class="hint">Preço unit. (€)<input class="in" data-campo="preco" data-idx="${i}" inputmode="decimal" value="${esc(l.preco)}" placeholder="900,00"></label>
        <button class="btn quiet" data-act="fatura-linha-menos" data-idx="${i}" title="remover esta linha" ${n.linhas.length === 1 ? 'disabled' : ''}>✕</button>
      </div>`).join('')}
      <button class="btn quiet small" data-act="fatura-linha-mais">+ Linha</button>
    </div>
    <div class="form" style="display:grid;grid-template-columns:140px 1fr;gap:var(--s3);margin-top:var(--s3)">
      <label class="hint">IVA<select class="in" id="fIva">${opcoes.map(t => `<option value="${t}"${Number(n.iva) === t ? ' selected' : ''}>${t} %${t === 0 ? ' (isento)' : ''}</option>`).join('')}</select></label>
      ${isento ? `<label class="hint">Motivo da isenção<input class="in" id="fIsencao" placeholder="Isento — artigo 9.º do CIVA"></label>` : '<span></span>'}
    </div>
    <label class="hint" style="display:block;margin-top:var(--s3)">Nota no documento (opcional)<input class="in" id="fNota" placeholder="Pagamento a 30 dias por transferência"></label>
    <label class="hint" style="display:flex;gap:var(--s2);align-items:center;margin-top:var(--s3)">
      <input type="checkbox" id="fConsumidor" ${n.consumidor ? 'checked' : ''}> Consumidor final (sem NIF — o documento di-lo)
    </label>
    <div class="acts" style="margin-top:var(--s4)">
      <button class="btn primary small" data-act="fatura-criar">Emitir fatura</button>
      <button class="btn quiet small" data-act="fatura-cancelar">Cancelar</button>
    </div>
    <div class="hint">A data vem do servidor. O número não salta: a fatura seguinte é sempre a última + 1, e uma anulada não devolve o número.</div>
  </div>`;
}


/* lê o formulário da fatura para o estado (o repintar não pode perder o que está escrito) */
function lerFormularioFatura() {
  const n = linhasDaNovaFatura();
  document.querySelectorAll('#faturaLinhas [data-campo]').forEach((el) => {
    const i = Number(el.dataset.idx);
    if (n.linhas[i]) n.linhas[i][el.dataset.campo] = el.value;
  });
  const iva = document.querySelector('#fIva');
  if (iva) n.iva = Number(iva.value);
  const cf = document.querySelector('#fConsumidor');
  if (cf) n.consumidor = cf.checked;
  return n;
}

/* o pedido da fatura a partir do que está no ecrã — sem inventar números */
function pedidoDaFatura() {
  const n = lerFormularioFatura();
  const num = (v) => Number(String(v || '').replace(/\s/g, '').replace(',', '.'));
  const linhas = n.linhas
    .filter((l) => String(l.descricao || '').trim())
    .map((l) => ({ descricao: String(l.descricao).trim(), quantidade: num(l.quantidade) || 0, precoEuros: num(l.preco) || 0 }));
  return {
    cliente: {
      nome: $('#fNome')?.value || '',
      nif: $('#fNif')?.value || '',
      email: $('#fEmail')?.value || '',
      morada: $('#fMorada')?.value || '',
    },
    consumidorFinal: !!n.consumidor,
    ivaTaxa: Number(n.iva),
    motivoIsencao: $('#fIsencao')?.value || '',
    linhas,
    nota: $('#fNota')?.value || '',
  };
}

function viewFaturas() {
  const d = faturasDe();
  const lista = d.faturas || [];
  const r = d.resumo || {};
  const em = d.emitente || {};
  const correio = d.correio || {};
  const podeEscrever = may('write');
  const data = (f) => String(f.emitida_em || f.criado || '').slice(0, 10).split('-').reverse().join('/');
  const total = (f) => `<span class="${Number(f.total_centimos) < 0 ? 'bad' : ''}">${eurosTexto(f.total_centimos)}</span>`;
  return `<div class="wrap">
    ${headHTML({
      title: 'Faturas',
      sub: lista.length ? `${r.emitidas || 0} emitida(s) · ${r.anuladas || 0} anulada(s)${r.notasCredito ? ` · ${r.notasCredito} nota(s) de crédito` : ''} · ${eurosTexto(r.totalCentimos)}` : 'ainda não há faturas',
      right: `${podeEscrever ? '<button class="btn small ghost" data-act="fatura-nova">+ Fatura</button>' : ''}${stopPill()}`,
    })}
    ${d.avisoBase ? `<div class="bf-aviso mau" role="status"><b>A tabela das faturas ainda não existe nesta base.</b><span>${esc(d.avisoBase)}</span></div>` : ''}
    ${em.aviso ? `<div class="bf-aviso${S.modoLocal ? '' : ' mau'}" role="status"><b>${S.modoLocal ? 'Sem PDF no modo local.' : 'O emitente está incompleto.'}</b><span>${esc(em.aviso)}</span></div>` : ''}
    ${S.modoLocal ? '<div class="localbar" role="status"><span>As faturas ficam registadas neste browser, com número e totais. O PDF e o email precisam da base de dados ligada: um documento fiscal não vive numa aba do browser.</span></div>' : ''}
    ${correio.configurado === false ? `<div class="hint" style="margin-bottom:var(--s3)">${esc(correio.aviso || 'sem RESEND_API_KEY o email não sai')}</div>` : ''}
    ${S.addingFatura ? formFatura() : ''}
    ${lista.length ? `<div class="card"><table>
      <thead><tr><th>número</th><th>cliente</th><th class="n">total</th><th class="n">ações</th></tr></thead>
      <tbody>${lista.map(f => {
        const anulada = f.estado === 'anulada';
        const nc = f.tipo === 'nota_credito';
        return `<tr${anulada ? ' style="opacity:.65"' : ''}>
          <td><b>${esc(f.codigo)}</b><div class="count">${esc(data(f))}${nc ? ' · nota de crédito' : ''}${anulada ? ' · <span class="bad">anulada</span>' : ''}</div></td>
          <td>${esc(f.cliente_nome)}<div class="count">${f.cliente_nif ? `NIF ${esc(f.cliente_nif)}` : 'consumidor final'}${f.enviada_em ? ` · enviada para ${esc(f.enviada_para || '')}` : ''}</div></td>
          <td class="n">${total(f)}<div class="count">base ${eurosTexto(f.base_centimos)} · IVA ${Number(f.iva_taxa) === 0 ? 'isento' : `${esc(f.iva_taxa)} %`}</div></td>
          <td class="n" style="white-space:nowrap">
            ${S.modoLocal ? '' : `<a class="btn quiet small" href="/api/fatura-pdf?id=${encodeURIComponent(f.id)}&d=1" target="_blank" rel="noopener">PDF</a>`}
            ${podeEscrever && !nc && !anulada ? `<button class="btn quiet small" data-act="fatura-enviar" data-id="${esc(f.id)}">Enviar</button>
            <button class="btn quiet small" data-act="fatura-anular" data-id="${esc(f.id)}" title="anular e emitir a nota de crédito">Anular</button>` : ''}
          </td></tr>`;
      }).join('')}</tbody></table></div>`
    : `<div class="card empty">${IC.vazio}<h3>Sem faturas</h3>
        <p>Uma fatura nasce das linhas que escreveres — o que foi vendido, quanto, com que IVA. Nada é inferido do saldo: o que entrou em dinheiro e o que foi faturado são coisas diferentes, e a mesa mostra as duas separadas.</p>
        ${podeEscrever ? '<button class="btn primary small" data-act="fatura-nova" style="margin-top:var(--s3)">Emitir a primeira</button>' : ''}</div>`}
    ${r.semDados ? `<div class="hint" style="margin-top:var(--s3)">${esc(r.semDados)}</div>` : ''}
    ${Number(r.documentos) > 1 ? `<div class="cards2" style="margin-top:var(--s4)">
      <div class="card"><div class="sec-h"><h3>Por mês</h3></div><table><tbody>${r.porMes.map(m => `<tr><td>${esc(m.mes)}<div class="count">${m.documentos} documento(s)</div></td><td class="n">${eurosTexto(m.totalCentimos)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><div class="sec-h"><h3>Por cliente</h3></div><table><tbody>${r.porCliente.slice(0, 8).map(c => `<tr><td>${esc(c.cliente)}<div class="count">${c.documentos} documento(s)</div></td><td class="n">${eurosTexto(c.totalCentimos)}</td></tr>`).join('')}</tbody></table></div>
    </div>` : ''}
    <div class="hint" style="margin-top:var(--s4)">${esc(d.nota || 'O total faturado não é receita.')}</div>
  </div>`;
}

/* =========================================================================
   1.60.0 · MOTORES, AUTONOMIA E SALDO (2 nov 2026)

   O dono pediu que se percebesse, sem abrir três ecrãs: o motor escolhido, o
   que ele sabe fazer e com que permissões; o estado de cada integração e a
   última verificação; o consumo real, os limites e o custo; e o nível de
   autonomia de cada tipo de trabalho — com as acções sensíveis que NUNCA
   correm sozinhas.

   A regra que atravessa o ecrã: onde não há prova, escreve-se «desconhecido»
   ou «nunca», nunca um zero ou um verde. A autonomia sobe com casos e é
   sempre uma decisão com autor e data; descer é imediato.
   ========================================================================= */
async function carregarMotores() {
  const [ia, uso, autonomia] = await Promise.all([
    call('/ia/estado').catch(() => null),
    call('/ia/uso').catch(() => null),
    call('/ops/autonomia').catch((e) => ({ ok: false, lista: [], resumo: null, erro: e.message })),
  ]);
  if (ia) S.ia = ia;
  if (uso) S.iaUso = uso;
  S.autonomia = autonomia;
  S.autonomiaErro = autonomia?.erro || '';
}

function viewMotores() {
  const ia = S.ia || {};
  const { lista: motores, resumo: rm } = perfisDeMotores(ia.fornecedores || []);
  const escolhas = (ia.agentes || []).map((a) => escolhaDoAgente(a, motores));
  const comAviso = escolhas.filter((e) => e.aviso);
  const auto = resumoDaAutonomia(S.autonomia?.lista || []);
  const consumo = resumoDoConsumo({ uso: S.iaUso, saldo: S.saldo });
  const sensiveis = acoesSensiveis(ia.ferramentas || []);
  const naoTestados = motores.filter((m) => m.configurado && !m.teste);
  const semMotor = !motores.length;

  const faixa = semMotor
    ? `<div class="ia-faixa ${ia.modo === 'local' ? 'bad' : 'warn'}"><b>${ia.modo === 'local' ? 'Modo local.' : 'Sem motor ligado.'}</b>
        ${esc(ia.motivo || ia.instalacao || 'nenhum fornecedor com chave nesta instalação')} —
        as chaves vivem no servidor, nunca neste browser. O que está abaixo é o retrato real: zero motores.</div>`
    : `<div class="ia-faixa ok"><b>${esc(rm.frase)}</b>
        ${naoTestados.length ? ` ${naoTestados.length} com chave mas sem prova: um teste é um pedido real, e só isso conta.` : ''}
        ${ia.jaTestado || ''}</div>`;

  const cartao = (titulo, conta, itens) => `<div class="mo-kpi">
      <span class="mo-kpi-t">${esc(titulo)}</span>
      <b>${esc(conta)}</b>
      <span class="mo-kpi-n">${esc(itens)}</span>
    </div>`;

  const linhaMotor = (m) => {
    const caps = m.capacidades.filter((c) => c.tem === true).map((c) => c.rotulo);
    const porDeclarar = m.capacidades.filter((c) => c.tem === null).map((c) => c.rotulo);
    const testar = `<button class="btn quiet small" data-act="ia-testar" data-id="${esc(m.id)}" ${!m.configurado || m.desligado ? 'disabled title="sem chave ou desligado"' : 'title="faz um pedido real e registra a resposta"'}>Testar</button>`;
    return `<tr class="${m.estado.id === 'funcional' ? 'ia-ok' : ''}">
      <td><b>${esc(m.nome)}</b>
        <div class="ia-sub"><span class="mo-classe ${m.classe}">${esc(CLASSES[m.classe].curto)}</span>
          ${esc(m.classe === 'cli' ? 'corre nesta máquina' : 'API de texto')}
          ${m.chaveMascarada ? `· ${esc(m.variavel || 'chave')} ${esc(m.chaveMascarada)}` : (m.configurado ? '· sem chave por desenho' : '· falta a chave')}</div>
      </td>
      <td><span class="mo-chip" style="--c:${m.estado.cor}">${esc(m.estado.rotulo)}</span>
        <div class="ia-sub">${esc(m.estado.porque)}</div></td>
      <td>${esc(m.verificacao.rotulo)}${m.teste?.ms != null ? `<div class="ia-sub">${m.teste.ms} ms</div>` : ''}</td>
      <td>${caps.length ? caps.map((c) => `<span class="mo-cap">${esc(c)}</span>`).join(' ') : '<span class="ia-sub">só texto</span>'}
        ${porDeclarar.length ? `<div class="ia-sub">por declarar: ${esc(porDeclarar.join(', '))}</div>` : ''}</td>
      <td class="ia-sub">${esc(m.limites)}</td>
      <td class="ia-acts">${testar}</td>
    </tr>`;
  };

  const linhaAgente = (e) => `<tr>
      <td><b>${e.numero ? `${esc(e.numero)} ` : ''}${esc(e.nome)}</b><div class="ia-sub">${esc(e.papel || 'sem papel declarado')}</div></td>
      <td>${e.motor ? `<b>${esc(e.motor)}</b>${e.classe ? ` <span class="mo-classe ${e.classe}">${esc(CLASSES[e.classe].curto)}</span>` : ''}<div class="ia-sub">${esc(e.modelo || 'modelo por omissão do fornecedor')}</div>` : '<span class="ia-sub">automático (o router decide)</span>'}</td>
      <td>${e.ferramentasPedidas.length ? e.ferramentasPedidas.map((f) => `<span class="mo-cap">${esc(f)}</span>`).join(' ') : '<span class="ia-sub">nenhuma</span>'}
        <div class="ia-sub">${e.ferramentasDisponiveis === true ? 'o motor aceita ferramentas' : e.ferramentasDisponiveis === false ? 'o motor não recebe ferramentas' : 'não declarado pelo fornecedor'}</div></td>
      <td>${e.aviso ? `<span class="mo-alerta">${esc(e.aviso)}</span>` : '<span class="ia-sub">sem avisos</span>'}</td>
    </tr>`;

  const linhaAuto = (a) => {
    const n = NIVEIS_AUTONOMIA[a.nivel];
    const autor = a.autor ? `${esc(a.autor)}${a.quando ? ` · ${esc(String(a.quando).slice(0, 16).replace('T', ' '))}` : ''}` : 'sem decisão registada';
    return `<tr>
      <td><b>${esc(a.escopo)}</b><div class="ia-sub">${a.casos} caso(s) decididos${a.taxa != null ? ` · ${Math.round(a.taxa * 100)}% aprovados` : ' · sem casos'}</div></td>
      <td><span class="mo-chip" style="--c:${n.cor}">${esc(n.rotulo)}</span><div class="ia-sub">${esc(n.porque)}</div></td>
      <td class="ia-sub">${autor}${a.motivo ? `<div>${esc(a.motivo)}</div>` : ''}</td>
      <td>${a.podeSubir
        ? `<button class="btn primary small" data-act="auto-up" data-scope="${esc(a.escopo)}">Subir</button>`
        : `<button class="btn ghost small" data-act="auto-up" data-scope="${esc(a.escopo)}" aria-disabled="true" title="${esc(a.porque)}">Subir</button>`}
        ${a.nivel !== 'pedir_sempre' ? `<button class="btn ghost small" data-act="auto-down" data-scope="${esc(a.escopo)}">Voltar a pedir</button>` : ''}
        <div class="ia-sub">${esc(a.porque)}</div></td>
    </tr>`;
  };

  return `<div class="wrap mo">
    ${headHTML({
      title: 'Motores',
      sub: `${esc(rm.frase)} · autonomia: ${esc(auto.frase)}`,
      right: `<button class="btn small ghost" data-act="reload" title="voltar a ler motores, uso e autonomia">↻ Actualizar</button>${stopPill()}`,
    })}
    ${faixa}

    <div class="mo-kpis">
      ${cartao('Prontos', rm.prontos, `de ${rm.total} motores`)}
      ${cartao('Verificados', rm.verificados, 'com resposta registada')}
      ${cartao('Por testar', rm.porTestar, 'têm chave, falta a prova')}
      ${cartao('Com mãos', rm.comFerramentas, rm.porDeclarar ? `${rm.porDeclarar} por declarar` : 'aceitam ferramentas')}
      ${cartao('Gasto em APIs', consumo.custoCentimos == null ? 'desconhecido' : money(consumo.custoCentimos), consumo.semPreco ? `${consumo.semPreco} sem preço` : 'últimos 90 dias')}
    </div>

    <section class="card" aria-labelledby="moMotores">
      <div class="sec-h"><h2 id="moMotores">Integrações e última verificação</h2>
        <span class="count">${motores.length} motor(es) no catálogo</span></div>
      <p class="hint" style="margin-top:0">«Verificado» quer dizer que houve uma resposta registada — não que a chave é válida para sempre. «Nunca verificado» é dito assim, sem verde. As chaves aparecem pelo NOME da variável e mascaradas; o valor nunca chega a este ecrã.</p>
      ${motores.length ? `<div class="mo-tabwrap"><table class="mo-tab">
        <thead><tr><th>Motor</th><th>Estado</th><th>Última verificação</th><th>Capacidades</th><th>Limites</th><th></th></tr></thead>
        <tbody>${motores.map(linhaMotor).join('')}</tbody></table></div>`
        : `<div class="hint">Nenhum fornecedor neste servidor. A página <a href="#/ia">IA</a> mostra o catálogo completo e o que falta em cada chave.</div>`}
    </section>

    <section class="card" style="margin-top:var(--s4)" aria-labelledby="moAgentes">
      <div class="sec-h"><h2 id="moAgentes">O motor escolhido, por agente</h2>
        <span class="count">${comAviso.length ? `${comAviso.length} com aviso` : 'sem avisos'}</span></div>
      <p class="hint" style="margin-top:0">Um agente que pede ferramentas e um motor que só dá texto é uma promessa que não se cumpre — e está escrita aqui antes de a tarefa correr. A escolha faz-se na página <a href="#/ia">IA</a>.</p>
      ${escolhas.length ? `<div class="mo-tabwrap"><table class="mo-tab">
        <thead><tr><th>Agente</th><th>Motor</th><th>Ferramentas</th><th>Antes de correr</th></tr></thead>
        <tbody>${escolhas.map(linhaAgente).join('')}</tbody></table></div>`
        : '<div class="hint">O servidor não devolveu a lista de agentes da IA.</div>'}
    </section>

    <section class="card" style="margin-top:var(--s4)" aria-labelledby="moAuto">
      <div class="sec-h"><h2 id="moAuto">Autonomia por tipo de trabalho</h2>
        <span class="count">${esc(auto.frase)}</span></div>
      <p class="hint" style="margin-top:0">O nível não é um menu: sobe com <b>50 casos decididos à mão e 95% aprovados</b>. Subir sem esses números é recusado com a razão escrita; descer é imediato e não pede justificação. Cada decisão fica com autor e data.</p>
      ${S.autonomiaErro ? `<div class="ia-faixa bad">Não consegui ler a autonomia: ${esc(S.autonomiaErro)}. Nada foi alterado — e nenhum tipo subiu por engano.</div>` : ''}
      ${(S.autonomia?.lista || []).length ? `<div class="mo-tabwrap"><table class="mo-tab">
        <thead><tr><th>Tipo</th><th>Nível</th><th>Quem decidiu</th><th>Decidir</th></tr></thead>
        <tbody>${(S.autonomia?.lista || []).map(linhaAuto).join('')}</tbody></table></div>`
        : `<div class="hint">Nenhum tipo avaliado ainda: tudo pede autorização. O primeiro tipo aparece quando houver mensagens decididas à mão (é esse histórico que justifica a confiança).</div>`}
    </section>

    <section class="card" style="margin-top:var(--s4)" aria-labelledby="moSensiveis">
      <div class="sec-h"><h2 id="moSensiveis">Aprovação obrigatória</h2>
        <span class="count">${sensiveis.length} acção(ões) sensível(is)</span></div>
      <p class="hint" style="margin-top:0">Estas acções <b>nunca correm sozinhas</b>, seja qual for o nível de autonomia: o servidor recusa-as sem aprovação humana explícita na própria execução. A regra está no servidor, não só neste ecrã.</p>
      ${sensiveis.length ? `<div class="mo-sens">${sensiveis.map((a) => `<div class="mo-sens-i">
        <b>${esc(a.nome)}</b><span>${esc(a.descricao)}</span><em>${esc(a.porque)}</em></div>`).join('')}</div>`
        : `<div class="hint">O servidor não declarou ferramentas destrutivas. Se alguma aparecer, fica nesta lista — e continua a exigir aprovação.</div>`}
    </section>

    <section class="card" style="margin-top:var(--s4)" aria-labelledby="moCusto">
      <div class="sec-h"><h2 id="moCusto">Consumo real, limites e custo</h2>
        <span class="count">${fmtNum(consumo.chamadas)} chamada(s) · ${fmtNum(consumo.tokens)} tokens</span></div>
      <div class="mo-custo">
        <div><span>Gasto conhecido</span><b>${consumo.custoCentimos == null ? '<span class="bad">desconhecido</span>' : money(consumo.custoCentimos)}</b></div>
        <div><span>Chamadas sem preço</span><b class="${consumo.semPreco ? 'bad' : ''}">${fmtNum(consumo.semPreco)}</b></div>
        <div><span>Latência média</span><b>${(() => { const l = (S.iaUso?.resumo || []).map((u) => u.latenciaMediaMs).filter((x) => x != null); return l.length ? `${Math.round(l.reduce((a, b) => a + b, 0) / l.length)} ms` : '—'; })()}</b></div>
      </div>
      <div class="hint">${esc(consumo.nota)}</div>
      ${consumo.limites.length ? `<table class="mo-tab" style="margin-top:var(--s3)"><thead><tr><th>Motor</th><th>Limite declarado</th></tr></thead>
        <tbody>${consumo.limites.map((l) => `<tr><td><b>${esc(l.nome)}</b></td><td class="ia-sub">${esc(l.limites)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${(S.iaUso?.resumo || []).length ? `<table class="mo-tab" style="margin-top:var(--s3)"><thead><tr><th>Fornecedor</th><th>Pedidos</th><th>OK</th><th>Erros</th><th>Latência</th><th>Tokens</th></tr></thead>
        <tbody>${consumoPorMotorHTML()}</tbody></table>` : ''}
      <div class="acts" style="margin-top:var(--s3)"><a class="btn ghost small" href="#/saldo">Ver o saldo completo</a><a class="btn ghost small" href="#/ia">Configurar na IA</a></div>
    </section>
  </div>`;
}

/** As linhas de consumo — pequenas, e sem esconder os erros. */
function consumoPorMotorHTML() {
  const resumo = (S.iaUso?.resumo || []).map((u) => `<tr>
    <td><b>${esc(u.fornecedor)}</b></td>
    <td class="n">${fmtNum(u.pedidos)}</td><td class="n">${fmtNum(u.ok)}</td>
    <td class="n ${u.erros ? 'bad' : ''}">${fmtNum(u.erros)}</td>
    <td class="n">${u.latenciaMediaMs != null ? `${u.latenciaMediaMs} ms` : '—'}</td>
    <td class="n">${fmtNum(u.tokens)}</td>
  </tr>`).join('');
  return resumo;
}

function viewSaldo() {
  const b = S.saldo;
  if (!b) return `<div class="wrap"><div class="skeleton">a ler o saldo…</div></div>`;
  const u = b.unitarios || {};
  const conta = b.contaAVista || {};
  const cambio = conta.cambio || {};
  const uni = [
    u.custoPorLead != null ? `custo por lead ${money(u.custoPorLead)}` : '',
    u.custoPorContactado != null ? `por contactado ${money(u.custoPorContactado)}` : '',
    u.custoPorCliente != null ? `por cliente ${money(u.custoPorCliente)}` : '',
    u.receitaPorCliente != null ? `receita por cliente ${money(u.receitaPorCliente)}` : '',
  ].filter(Boolean).join(' · ') || 'sem dados suficientes para custos unitários';
  const linhasConta = conta.linhas || [];
  const desconhecidas = conta.desconhecidas || 0;
  const precoTexto = (p) => (Array.isArray(p) ? `${p[0]} / ${p[1]} USD por 1M tokens` : 'preço desconhecido');
  return `<div class="wrap">
    ${headHTML({ title: 'Saldo', sub: `os últimos ${b.janela?.dias || 90} dias · só o que está registado`, right: stopPill() })}
    <div class="money">
      <div class="card"><b class="ok">${money(b.receitaCentimos)}</b><small>entrou</small></div>
      <div class="card"><b>${money(b.custoCentimos)}</b><small>gastou em APIs</small></div>
      <div class="card"><b class="${b.margemCentimos < 0 ? 'bad' : 'ok'}">${money(b.margemCentimos)}</b><small>margem</small></div>
    </div>
    ${b.semDados?.receita ? `<div class="hint" style="margin-bottom:var(--s3)">${esc(b.semDados.receita)}</div>` : ''}
    ${b.semDados?.custo ? `<div class="bf-aviso${desconhecidas ? ' mau' : ''}" role="status"><b>Como se chegou ao custo.</b><span>${esc(b.semDados.custo)}</span></div>` : ''}

    <div class="card" style="margin-bottom:var(--s4)">
      <div class="sec-h"><h3>A conta à vista</h3><span class="count">${fmtNum(conta.chamadas || 0)} chamada(s) · ${fmtNum((conta.linhas || []).reduce((n, l) => n + (l.tokensIn || 0) + (l.tokensOut || 0), 0))} tokens</span></div>
      ${linhasConta.length ? `<table><thead><tr><th>modelo</th><th class="n">tokens</th><th class="n">preço</th><th class="n">custo</th></tr></thead><tbody>
        ${linhasConta.map(l => `<tr>
          <td>${esc(l.fornecedorNome || l.fornecedor)}<div class="count">${esc(l.modelo)}${l.fonte === 'ambiente' ? ' · preço declarado por ti' : l.fonte === 'catalogo-gratuito' ? ' · gratuito no catálogo' : ' · preço do catálogo'}</div></td>
          <td class="n">${fmtNum(l.tokensIn)} → ${fmtNum(l.tokensOut)}${l.desconhecidas ? `<div class="count bad">${l.desconhecidas} sem preço</div>` : ''}</td>
          <td class="n">${esc(precoTexto(l.preco))}</td>
          <td class="n">${l.microUsd == null && l.desconhecidas ? '<span class="bad">desconhecido</span>' : money(centimosDeEuro(l))}</td>
        </tr>`).join('')}
      </tbody></table>` : `<div class="hint">Sem chamadas de IA neste período. O custo é 0 porque não houve consumo — o saldo não inventa um número para parecer medido.</div>`}
      <div class="hint" style="margin-top:var(--s3)">
        ${desconhecidas ? `<b class="bad">${desconhecidas} chamada(s) sem preço conhecido não entram na soma.</b> ` : ''}
        ${esc(conta.nota || 'preços do catálogo — é uma conta, não uma fatura')}.
        ${cambio.taxa ? ` Câmbio: 1 USD = ${String(cambio.taxa).replace('.', ',')} € (${esc(cambio.fonte === 'ambiente' ? 'declarado por ti' : 'valor de referência')}).` : ''}
        ${cambio.fonte === 'padrao' ? ' Declara <code>ORBITA_CAMBIO_USD_EUR</code> para usar a taxa real.' : ''}
      </div>
    </div>

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
          ? b.custosPorFornecedor.map(c => `<tr>
              <td>${esc(c.fornecedorNome || c.provider)}<div class="count">${fmtNum(c.chamadas)} chamadas · ${fmtNum(c.tokens)} tokens${c.desconhecido ? ' · <span class="bad">algumas sem preço</span>' : ''}</div></td>
              <td class="n">${money(c.cents)}</td></tr>`).join('')
          : '<tr><td class="hint">Sem custos de API neste período.</td></tr>'}</tbody></table>
        ${(b.tarefas?.total || 0) ? `<div class="hint" style="margin-top:var(--s3)">${b.tarefas.total} tarefa(s) guardada(s)${b.tarefas.semCusto ? `, ${b.tarefas.semCusto} sem custo registado` : ''} · ${money(b.tarefas.custoCentimos || 0)} atribuídos a trabalho</div>` : ''}
      </div>
    </div>

    ${(b.midia?.geracoes || 0) ? `<div class="card" style="margin-top:var(--s4)"><div class="sec-h"><h3>Mídia gerada</h3><span class="count">${b.midia.geracoes} peça(s) · ${money(b.midia.centimos || 0)}</span></div>
      <table><tbody>${(b.midia.porFornecedor || []).map(m => `<tr><td>${esc(m.fornecedorNome || m.fornecedor)}<div class="count">${m.geracoes} peça(s)${m.desconhecido ? ' · <span class="bad">algumas sem custo fiável</span>' : ''}</div></td><td class="n">${money(m.centimos || 0)}</td></tr>`).join('')}</tbody></table>
      <div class="hint">${esc(b.midia.nota)}</div></div>` : ''}
    ${b.faturacao ? `<div class="card" style="margin-top:var(--s4)"><div class="sec-h"><h3>Faturado</h3><span class="count">não é receita — é o que foi cobrado</span></div>
      <div class="money" style="margin-bottom:var(--s3)">
        <div class="card"><b>${money(b.faturacao.totalCentimos || 0)}</b><small>${b.faturacao.emitidas || 0} fatura(s)${b.faturacao.notasCredito ? ` · ${b.faturacao.notasCredito} nota(s) de crédito` : ''}</small></div>
        <div class="card"><b>${money(b.faturacao.ivaCentimos || 0)}</b><small>IVA liquidado</small></div>
        <div class="card"><b>${b.faturacao.anuladas || 0}</b><small>anulada(s)</small></div>
      </div>
      ${b.faturacao.avisoEmitente ? `<div class="hint bad" style="margin-bottom:var(--s3)">${esc(b.faturacao.avisoEmitente)}</div>` : ''}
      <div class="hint">O total faturado não entra na receita: uma fatura é o que se cobrou, a receita é o dinheiro que entrou. <a href="#/faturas">Ver as faturas</a></div>
    </div>` : ''}
    ${(b.custosPorProjeto || []).length ? `<div class="card" style="margin-top:var(--s4)"><div class="sec-h"><h3>Custo por projeto</h3><span class="count">das tarefas ligadas</span></div>
      <table><tbody>${b.custosPorProjeto.map(p => `<tr><td>${esc(p.nome)}<div class="count">${p.tarefas} tarefa(s)</div></td><td class="n">${p.centimos != null ? money(p.centimos) : '<span class="bad">desconhecido</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${(b.custosPorLead || []).length ? `<div class="card" style="margin-top:var(--s4)"><div class="sec-h"><h3>Custo por lead</h3><span class="count">das tarefas ligadas</span></div>
      <table><tbody>${b.custosPorLead.map(p => `<tr><td>${esc(p.nome)}<div class="count">${p.tarefas} tarefa(s)</div></td><td class="n">${p.centimos != null ? money(p.centimos) : '<span class="bad">desconhecido</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}

    <div class="hint" style="margin-top:var(--s4)">${esc(uni)}</div>
    ${(b.entradas || []).length ? `<div class="card" style="margin-top:var(--s4)"><div class="sec-h"><h3>Entradas</h3><span class="count">${b.entradas.length}</span></div>
      <table><tbody>${b.entradas.map(e => `<tr><td style="white-space:nowrap;color:var(--muted)">${esc(when(e.at))}</td><td>${esc(e.campaign || 'sem campanha')}</td><td class="n">${money(e.amount_cents)}</td>
        <td class="n"><button class="btn quiet" data-act="apagar-receita" data-id="${esc(e.id)}" title="apagar">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}

/* cêntimos de uma linha da conta à vista: o servidor já os manda; sem eles,
   calcula-se dos micro-USD com o câmbio que ele indicou (nunca a esconder) */
function centimosDeEuro(linha) {
  if (linha.centimos != null) return linha.centimos;
  const taxa = Number(S.saldo?.contaAVista?.cambio?.taxa) || 0.92;
  if (linha.microUsd == null) return 0;
  return Math.round((linha.microUsd * taxa) / 1e4);
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


/* ===========================================================================
   1.61.0 · AS EXECUÇÕES (2 nov 2026)

   A pergunta do dono: «o que fez o agente, com que dados, o que mudou — e quem
   autorizou?». A página responde com os cinco estados por palavras, os passos
   com entradas → acções → resultados, o que fazer quando corre mal, o histórico
   de autorizações e os botões que só aparecem quando são verdadeiros
   (cancelar/repetir/aprovar). Nada aqui recalcula a verdade: usa `src/execucao.js`.
   =========================================================================== */
/* Um estado técnico representativo por estado visível — para os filtros. */
const ESTADOS_TECNICO = {
  em_fila: 'novo', em_execucao: 'a_executar', a_espera: 'aguarda_aprovacao',
  falhou: 'falhou', concluido: 'concluido', cancelado: 'cancelado',
};

async function carregarExecucoes() {
  const r = await call(`/ia/runs?limite=${Number(S.execucaoLimite) || 40}`).catch((e) => ({ __erro: e.message }));
  if (r?.__erro) { S.execucoes = []; S.execucaoErro = r.__erro; return; }
  S.execucoes = r?.runs || [];
  S.execucaoErro = '';
}

async function carregarExecucao(id) {
  try {
    S.execucao = await call(`/ia/runs/${encodeURIComponent(id)}`);
  } catch (e) {
    S.execucao = null;
    S.execucaoErro = e.message;
  }
}

const runChip = (e) => `<span class="mo-chip run-chip" style="--c:${e.cor}" title="${esc(e.tecnico)}"><i class="dot"></i>${esc(e.rotulo)}</span>`;

/* A lista: cartões, um por execução, com o número curto (o início real do id). */
function viewExecucoes() {
  const runs = S.execucoes || [];
  const avisos = avisosDaLista({ runs, modoLocal: S.modoLocal });
  const fila = filaDeExecucao(runs);
  const filtro = S.execucaoFiltro || 'todas';
  const cartoes = fila.cartoes.filter((c) => filtro === 'todas' || c.estado.id === filtro);
  const contagem = (id) => fila.cartoes.filter((c) => c.estado.id === id).length;
  const chips = [['todas', `Todas (${fila.total})`], ...ORDEM_ESTADOS.map((id) => [id, `${estadoDoRun({ estado: ESTADOS_TECNICO[id] }).rotulo} (${contagem(id)})`])];

  const linha = (c) => `<a class="run-card" href="#/execucao/${esc(c.id)}" data-act="run-abrir" data-id="${esc(c.id)}">
    <div class="run-top">
      <span class="run-num">#${esc(c.numero)}</span>
      ${runChip(c.estado)}
      ${c.repeticaoDe ? '<span class="run-tag">repetição</span>' : ''}
      <span class="run-when">${esc(c.quando)}</span>
    </div>
    <div class="run-tit">${esc(c.titulo)}</div>
    ${c.nota ? `<div class="run-nota bad">${esc(c.nota)}</div>` : ''}
    <div class="run-meta">
      <span>${c.passos} passo${c.passos === 1 ? '' : 's'}</span>
      <span>${c.acoes} acção${c.acoes === 1 ? '' : 'ões'}</span>
      <span>${esc(c.duracao)}</span>
      <span>${c.custo.desconhecido ? 'custo desconhecido' : money(c.custo.centimos)}</span>
    </div>
  </a>`;

  return `<div class="wrap mo">
    ${headHTML({
      title: 'Execuções',
      sub: `${esc(fila.frase)} · cada passo mostra o que recebeu, o que fez e o que voltou`,
      right: `<a class="btn small ghost" href="#/ia" title="abrir o Control Center da IA">Nova execução</a>
        <button class="btn small ghost" data-act="reload" title="voltar a ler as execuções">↻ Actualizar</button>${stopPill()}`,
    })}
    ${avisos.map((a) => `<div class="ia-faixa ${a.tipo === 'espera' ? 'warn' : a.tipo === 'local' ? 'bad' : ''}"><b>${esc(a.tipo === 'espera' ? 'Parado à tua espera' : a.tipo === 'local' ? 'Modo local' : 'Sem execuções')}</b> ${esc(a.texto)}</div>`).join('')}
    ${S.execucaoErro ? `<div class="ia-faixa bad"><b>Não consegui ler as execuções.</b> ${esc(S.execucaoErro)}</div>` : ''}
    <div class="mo-filtros" role="tablist" aria-label="filtrar execuções">
      ${chips.map(([id, rotulo]) => `<button class="mo-tab${filtro === id ? ' on' : ''}" role="tab" aria-selected="${filtro === id}" data-act="run-filtrar" data-id="${esc(id)}">${esc(rotulo)}</button>`).join('')}
    </div>
    ${cartoes.length ? `<div class="run-list">${cartoes.map(linha).join('')}</div>`
      : `<div class="card empty"><h3>${runs.length ? 'Nada neste filtro' : 'Ainda não houve execuções'}</h3>
          <p>${runs.length
            ? 'Nenhuma execução está neste estado agora. Muda o filtro para ver as outras.'
            : 'Uma execução nasce quando pedes trabalho a um agente no Control Center da IA. Quando houver, aparece aqui com passos, acções, custo e quem autorizou.'}</p>
          <div class="acts" style="justify-content:center"><a class="btn primary" href="#/ia">Pedir trabalho a um agente</a></div></div>`}
  </div>`;
}

/* O detalhe: «Execução #a3f19c» — o que recebeu, o que fez, o que voltou. */
function viewExecucao() {
  const d = S.execucao;
  const id = S.route.id || '';
  if (!d) {
    return `<div class="wrap mo">${headHTML({ title: 'Execução', sub: 'não consegui abrir', right: '<a class="btn small ghost" href="#/execucoes">Voltar</a>' })}
      <div class="card empty"><h3>Esta execução não abriu</h3>
        <p>${esc(S.execucaoErro || 'a base não devolveu esta execução')}</p>
        <div class="acts" style="justify-content:center"><a class="btn primary" href="#/execucoes">Ver todas as execuções</a></div></div></div>`;
  }
  const run = d.run || {};
  const passos = (d.lidos && d.lidos.length) ? d.lidos : passosDoRun(d.passos || []);
  const e = d.visivel?.id ? d.visivel : estadoDoRun(run);
  /* o servidor manda o resumo já feito; se vier incompleto (versão antiga da
     base), calcula-se aqui com as mesmas contas — nunca se mostra um zero */
  const r = d.resumo?.custo ? d.resumo : resumoDoRun(run, d.passos || []);
  const rec = d.recuperacao || recuperacao(run, d.passos || []);
  const auts = (d.autorizacoes && d.autorizacoes.length) ? d.autorizacoes : autorizacoesDoRun(run);
  const cancel = cancelamentoDe(run);
  const podeC = d.accoes?.cancelar || podeCancelar(run);
  const podeR = d.accoes?.repetir || podeRepetir(run, S.execucoes || []);
  const podeA = d.accoes?.aprovar || podeAprovar(run);
  const reg = (d.registo && d.registo.length) ? d.registo : registoDoRun(run, d.passos || []);

  const acaoDoBotao = (o) => {
    const classes = o.id === 'aprovar' ? 'btn primary' : o.id === 'recusar' ? 'btn ghost bad' : 'btn ghost';
    const alvo = ['run-aprovar', 'run-recusar', 'run-retomar', 'run-repetir', 'run-cancelar'].includes(o.accao) ? ` data-id="${esc(run.id || id)}"` : '';
    return `<button class="${classes}" data-act="${esc(o.accao)}"${alvo} title="${esc(o.porque)}">${esc(o.rotulo)}</button>`;
  };

  const passoHTML = (p) => `<article class="run-step" data-estado="${esc(p.estado)}">
    <header class="run-step-h">
      <span class="run-step-n">${p.ordem}</span>
      <div><b>${esc(p.titulo)}</b>
        <div class="ia-sub">${esc(p.agente || 'agente')}${p.modelo ? ` · ${esc(p.modelo)}` : ''} · ${esc(p.duracao)}</div></div>
      <span class="mo-chip" style="--c:${estadoDoRun({ estado: p.estado === 'a_espera' ? 'aguarda_aprovacao' : p.estado === 'em_execucao' ? 'a_correr' : p.estado === 'falhou' ? 'falhou' : p.estado }).cor}">${esc(p.estado === 'a_espera' ? 'à espera' : p.estado === 'em_execucao' ? 'a correr' : p.estado === 'falhou' ? 'falhou' : p.estado === 'cancelado' ? 'cancelado' : 'concluído')}</span>
    </header>
    ${p.temEntrada ? `<div class="run-bloco"><span class="run-k">Entrada · o que lhe foi pedido</span><div class="run-v">${esc(p.entrada)}</div></div>` : '<div class="run-bloco"><span class="run-k">Entrada</span><div class="run-v ia-sub">não ficou registada</div></div>'}
    <div class="run-bloco"><span class="run-k">Acções · o que correu no servidor</span>
      ${p.acoes.length ? `<ul class="run-acoes">${p.acoes.map((a) => `<li class="${a.ok ? 'ok' : 'bad'}">
          <b>${esc(a.nome)}</b>
          <span>${a.esperou ? 'pediu aprovação humana — não correu' : esc(a.resumo || (a.ok ? 'correu' : 'falhou'))}</span>
          ${a.argumentos ? `<code>${esc(JSON.stringify(a.argumentos).slice(0, 160))}</code>` : ''}
        </li>`).join('')}</ul>`
        : '<div class="run-v ia-sub">nenhuma — este passo só escreveu texto</div>'}
    </div>
    <div class="run-bloco"><span class="run-k">Resultado · o que voltou</span>
      <div class="run-v${p.temResultado ? '' : ' ia-sub'}">${p.temResultado ? esc(p.resultado).slice(0, 4000) : 'sem resultado'}</div>
    </div>
    ${p.erro ? `<div class="run-erro"><b>Falhou:</b> ${esc(p.erro)}</div>` : ''}
  </article>`;

  return `<div class="wrap mo">
    ${headHTML({
      title: `Execução #${String(run.id || id).replace(/-/g, '').slice(0, 6)}`,
      sub: `${esc(e.rotulo)} · ${esc(quandoDe(run.criado))}${run.fim ? ` · fechou ${esc(quandoDe(run.fim))}` : ''}`,
      right: `<a class="btn small ghost" href="#/execucoes">← Todas</a>
        <button class="btn small ghost" data-act="reload" title="voltar a ler esta execução">↻</button>${stopPill()}`,
    })}

    <section class="card run-cabeca">
      <div class="run-titulo">${esc(String(run.objetivo || ''))}</div>
      <div class="run-estado-linha">${runChip(e)}<span class="run-porque">${esc(e.porque)}</span></div>
      <div class="run-ficha">
        <div><span>Passos</span><b>${r.concluidos}/${r.passos}</b></div>
        <div><span>Acções</span><b>${r.acoes}${r.acoesFalhadas ? ` · ${r.acoesFalhadas} falharam` : ''}</b></div>
        <div><span>Tokens</span><b>${fmtNum(r.tokens)}</b></div>
        <div><span>Custo</span><b class="${r.custo.desconhecido ? 'bad' : ''}">${r.custo.desconhecido ? 'desconhecido' : money(r.custo.centimos)}</b></div>
        <div><span>Duração</span><b>${esc(r.duracao)}</b></div>
        <div><span>Modelo</span><b>${esc(r.modelo || 'não registado')}</b></div>
      </div>
      ${r.custo.desconhecido ? '<div class="hint">Custo desconhecido: o fornecedor usado não tem preço declarado. Zero seria uma mentira — não é grátis, é não medido.</div>' : ''}
      ${cancel.pedido ? `<div class="ia-faixa ${cancel.efectivo ? 'bad' : 'warn'}"><b>${cancel.efectivo ? 'Paragem efectiva' : 'Cancelamento pedido'}.</b>
        ${esc(cancel.por || 'sem nome')} · ${esc(quandoDe(cancel.em))} — ${esc(cancel.porque || 'verificado entre passos')}.</div>` : ''}

      ${rec.necessaria || rec.opcoes.length ? `<div class="run-recuperacao${e.id === 'a_espera' ? ' hot' : ''}" role="group" aria-label="o que fazer a seguir">
        <div class="run-rec-txt"><b>${e.id === 'a_espera' ? 'Precisa da tua decisão' : 'O que fazer a seguir'}</b><span>${esc(rec.porque)}</span></div>
        <div class="acts">${rec.opcoes.map(acaoDoBotao).join('')}</div>
      </div>` : ''}

      <div class="acts run-acts">
        ${podeA.sim ? '' : `<button class="btn ghost small" data-act="run-aprovar" data-id="${esc(run.id || id)}" aria-disabled="true" title="${esc(podeA.porque)}">Aprovar</button>`}
        ${podeC.sim ? `<button class="btn ghost small" data-act="run-cancelar" data-id="${esc(run.id || id)}" title="${esc(podeC.porque)}">Parar</button>`
          : `<button class="btn ghost small" aria-disabled="true" title="${esc(podeC.porque)}">Parar</button>`}
        ${podeR.sim ? `<button class="btn ghost small" data-act="run-repetir" data-id="${esc(run.id || id)}" title="${esc(podeR.porque)}">Repetir</button>`
          : `<button class="btn ghost small" aria-disabled="true" title="${esc(podeR.porque)}">Repetir</button>`}
        <a class="btn ghost small" href="#/ia">Abrir na IA</a>
      </div>
      <div class="hint">A paragem é verificada entre passos e entre ferramentas: uma chamada já começada termina. Repetir abre uma execução nova ligada a esta — a antiga fica no histórico.</div>
    </section>

    <section class="card" aria-labelledby="runSteps">
      <div class="sec-h"><h2 id="runSteps">Passos</h2><span class="count">${passos.length} registado(s)</span></div>
      ${passos.length ? passos.map(passoHTML).join('') : '<div class="hint">Esta execução ainda não tem passos gravados. Uma execução em fila ganha passos quando começa a correr.</div>'}
    </section>

    <section class="card" style="margin-top:var(--s4)" aria-labelledby="runAuth">
      <div class="sec-h"><h2 id="runAuth">Quem autorizou</h2><span class="count">${auts.length} autorização(ões)</span></div>
      ${auts.length ? `<table class="mo-tab"><thead><tr><th>Quem</th><th>O quê</th><th>Quando</th><th>Decisão</th></tr></thead><tbody>
        ${auts.map((a) => `<tr><td><b>${esc(a.por)}</b>${a.legado ? ' <span class="ia-sub">(aprovação à partida)</span>' : ''}</td>
          <td>${esc(a.oQue)}${a.motivo ? `<div class="ia-sub">${esc(a.motivo)}</div>` : ''}</td>
          <td class="ia-sub">${esc(quandoDe(a.em))}</td>
          <td><span class="mo-chip" style="--c:${a.decisao === 'recusada' ? '#b3261e' : '#1f7a4d'}">${esc(a.decisao)}</span></td></tr>`).join('')}
        </tbody></table>`
        : '<div class="hint">Ninguém autorizou nada nesta execução. As acções destrutivas ficam paradas até haver um nome — não correm «por omissão».</div>'}
    </section>

    <section class="card" style="margin-top:var(--s4)" aria-labelledby="runReg">
      <div class="sec-h"><h2 id="runReg">Registo</h2><span class="count">${reg.length} evento(s)</span></div>
      <ol class="run-registo">
        ${reg.map((ev) => `<li data-estado="${esc(ev.estado || '')}">
          <span class="run-reg-em">${esc(quandoDe(ev.em))}</span>
          <span class="run-reg-t"><b>${esc(ev.titulo)}</b><span>${esc(ev.detalhe || '')}</span></span>
        </li>`).join('')}
      </ol>
    </section>
  </div>`;
}

function paint() {
  paintHead();
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
  paintMobar();
  pintar(S.route.name === 'hoje' ? viewHoje()
    : S.route.name === 'papel' ? vistaPapel(S, { esc })
    : S.route.name === 'cine' ? vistaCine(S, { esc, leadId: S.route.id })
    : S.route.name === 'leads' ? viewLeads()
      : S.route.name === 'lead' ? viewLead()
        : S.route.name === 'projetos' ? viewProjetos()
          : S.route.name === 'projeto' ? viewProjeto()
            : S.route.name === 'tarefas' ? viewTarefas()
              : S.route.name === 'agentes' ? viewAgentes()
              : S.route.name === 'contas' ? viewContas()
              : S.route.name === 'ia' ? vistaIA(S, { esc, hhmm, when })
              : S.route.name === 'motores' ? viewMotores()
              : S.route.name === 'execucoes' ? viewExecucoes()
              : S.route.name === 'execucao' ? viewExecucao()
            : S.route.name === 'conversas' ? viewConversas()
              : S.route.name === 'faturas' ? viewFaturas()
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
  /* 1.48.0 · cine: escrever o plano, gerar, aprovar, apagar */
  if (String(name).startsWith('cine-') && await accaoCine(name, el, apiMesa)) return;
  /* 1.54.2 · briefing: abas, gravar, rascunho da IA, Prompt Master, imagens */
  if (String(name).startsWith('bf-') && await accaoBriefing(name, el, apiMesa)) return;
  /* 1.54.3 · mídia: tipo, opções, estimativa, gerar, cancelar, repetir, compor */
  if (String(name).startsWith('md-') && await accaoMedia(name, el, apiMesa)) return;
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
      const r = await call(`/ops/autonomia/${encodeURIComponent(scope)}/${name === 'auto-up' ? 'subir' : 'descer'}`, 'POST', { reason: 'decisão na mesa' });
      toast(name === 'auto-up'
        ? `${scope}: agora «${r.rotulo || 'propõe e espera'}». As acções sensíveis continuam a pedir aprovação.`
        : `${scope}: volta a pedir-te autorização.`);
      S.pick = null;
      await boot();
      return;
    }

    /* ---------------- 1.61.0 · execuções ---------------- */
    if (name === 'run-filtrar') {
      S.execucaoFiltro = id || 'todas';
      paint();
      return;
    }
    if (name === 'run-abrir') {
      if (id) location.hash = `#/execucao/${encodeURIComponent(id)}`;
      return;
    }
    if (name === 'ir-motores') {
      location.hash = '#/motores';
      return;
    }
    if (name.startsWith('run-') && ['run-cancelar', 'run-repetir', 'run-retomar', 'run-aprovar', 'run-recusar'].includes(name)) {
      const alvo = id || S.route.id;
      const quem = S.eu?.user?.name || S.eu?.user?.email || 'dono';
      const depois = async (extra) => {
        toast(extra);
        if (S.route.name === 'execucao') await carregarExecucao(alvo);
        else await carregarExecucoes();
        await boot(false);
      };
      try {
        if (name === 'run-cancelar') {
          const r = await call(`/ia/runs/${encodeURIComponent(alvo)}/cancelar`, 'POST', { por: quem });
          await depois(r.nota || 'Cancelamento pedido. A paragem é verificada entre passos.');
          return;
        }
        if (name === 'run-repetir') {
          const r = await call(`/ia/runs/${encodeURIComponent(alvo)}/repetir`, 'POST', { por: quem });
          const novo = r.run?.id || alvo;
          await depois(r.repetida === false ? 'Esta repetição já estava aberta — não se criaram duas.' : 'Execução nova aberta. A antiga fica no histórico.');
          location.hash = `#/execucao/${encodeURIComponent(novo)}`;
          if (r.repetida !== false) {
            /* a repetição nova é uma execução em fila: corre-a, sem bloquear a mesa */
            call(`/ia/runs/${encodeURIComponent(novo)}/correr`, 'POST', {}).then(() => {
              if (S.route.id === novo) boot(false);
            }).catch(() => null);
          }
          return;
        }
        if (name === 'run-aprovar' || name === 'run-recusar') {
          const motivo = name === 'run-recusar'
            ? (typeof window !== 'undefined' && typeof window.prompt === 'function'
              ? (window.prompt('Porque recusas? Fica escrito no histórico.', '') || '').trim() : '')
            : 'aprovado na mesa';
          const r = await call(`/ia/runs/${encodeURIComponent(alvo)}/${name === 'run-recusar' ? 'recusar' : 'aprovar'}`, 'POST', { por: quem, motivo });
          await depois(r.nota || (name === 'run-recusar' ? 'Recusada. A execução fecha com a razão escrita.' : `Aprovada por ${quem}. O trabalho continua.`));
          if (name === 'run-aprovar') {
            call(`/ia/runs/${encodeURIComponent(alvo)}/correr`, 'POST', { retomar: true }).then(() => {
              if (S.route.id === alvo) boot(false);
            }).catch((e) => toast(`Aprovada, mas não conseguia continuar: ${e.message}`, true));
          }
          return;
        }
        if (name === 'run-retomar') {
          await call(`/ia/runs/${encodeURIComponent(alvo)}/correr`, 'POST', { retomar: true });
          await depois('Retomada: os passos concluídos não se repetem.');
          return;
        }
      } catch (e) {
        toast(e.message, true);
        return;
      }
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

    /* ---- 1.59.0 · o CRM: exportar, duplicados, verificar o site, próxima ação ---- */
    if (name === 'csv-leads') {
      if (S.aExportar) return;                       // um clique, um ficheiro
      S.aExportar = true;
      try {
        const r = await call('/ops/leads.csv');
        const csv = String(r.csv || '');
        if (!csv) { toast('O servidor não devolveu o CSV — nada foi exportado.', true); return; }
        const nome = r.ficheiro || 'leads.csv';
        try {
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = nome; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* já revogado */ } }, 4000);
          toast(`${r.linhas ?? '—'} lead(s) exportados para ${nome}.`);
        } catch {
          toast('Este browser não deixa descarregar ficheiros — o CSV ficou na consola.', true);
          console.log(csv);
        }
      } catch (e) {
        toast(`Não consegui exportar: ${e.message}`, true);
      } finally { S.aExportar = false; }
      return;
    }

    if (name === 'ver-duplicados') {
      S.mostrarDuplicados = !S.mostrarDuplicados;
      if (S.mostrarDuplicados && !S.duplicados) {
        S.duplicados = null;
        paint();
        const r = await call('/ops/leads/duplicados').catch((e) => ({ grupos: [], erro: e.message }));
        S.duplicados = r || { grupos: [], erro: 'o servidor não respondeu' };
      }
      paint();
      return;
    }

    if (name === 'verificar-site') {
      const leadId = id || S.lead?.id;
      if (!leadId) return;
      setNote('a pedir o site…');
      try {
        const r = await call(`/ops/leads/${encodeURIComponent(leadId)}/verificar`, 'POST', {});
        const v = r.verificacao || {};
        toast(v.estado === 'ok' ? `Site verificado: ${v.motivo || 'respondeu'}` : `O site não respondeu: ${v.motivo || 'sem motivo'}`, v.estado !== 'ok');
        await loadLead(leadId);
        const i = S.leads.findIndex((x) => x.id === leadId);
        if (i >= 0 && S.lead) S.leads[i] = S.lead;
        paint();
      } catch (e) {
        toast(`Não consegui verificar: ${e.message}`, true);
      }
      return;
    }

    if (name === 'guardar-proxima' || name === 'limpar-proxima') {
      const leadId = id || S.lead?.id;
      if (!leadId) return;
      const corpoProx = name === 'limpar-proxima'
        ? { proxima_acao: null, proxima_acao_em: null }
        : { proxima_acao: String($('#proxAcao')?.value || '').trim() || null,
            proxima_acao_em: String($('#proxAcaoEm')?.value || '').trim() || null };
      try {
        const r = await call(`/ops/leads/${encodeURIComponent(leadId)}`, 'PATCH', corpoProx);
        S.lead = r.lead || S.lead;
        toast(name === 'limpar-proxima' ? 'Próxima ação limpa.' : 'Próxima ação guardada.');
        await loadLead(leadId);
        const i = S.leads.findIndex((x) => x.id === leadId);
        if (i >= 0 && S.lead) S.leads[i] = S.lead;
        paint();
      } catch (e) {
        toast(`Não ficou guardada: ${e.message}`, true);
      }
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
        await call('/auth/primeiro-dono', 'POST', {
          email, password: pass, name: String($('#lgNome')?.value || '').trim(),
          token: String($('#lgToken')?.value || '').trim(),
        });
        toast('Conta criada. Bem-vindo ao Órbita.');
      } else {
        try {
          await call('/auth/entrar', 'POST', { email, password: pass });
        } catch (e) {
          /* 1.54.1 · palavra-passe certa, conta por confirmar: não é «credenciais
             erradas» — é um passo em falta, e a mesa leva-te ao sítio certo. */
          if (e.body && e.body.naoConfirmada) {
            S.aConfirmar = '';
            toast('A conta ainda não está confirmada — cola o token do email.', true);
            paint();
            return;
          }
          throw e;
        }
      }
      S.needLogin = false; S.primeiraConta = false; S.aRegistar = false; S.aConfirmar = null;
      await boot(true);
      return;
    }
    /* 1.54.1 · registo e confirmação: quem não tem conta cria a sua, e quem tem
       por confirmar abre o link. Ambos falam com o servidor; nada disto é local. */
    if (name === 'abrir-registo') { S.aRegistar = true; paint(); return; }
    if (name === 'voltar-entrar') { S.aRegistar = false; paint(); return; }
    if (name === 'registar') {
      const email = String($('#lgEmail')?.value || '').trim();
      const pass = String($('#lgPass')?.value || '');
      const nome = String($('#lgNome')?.value || '').trim();
      if (!email || !pass) { toast('Diz o email e a palavra-passe.', true); return; }
      if (pass !== String($('#lgPass2')?.value || '')) { toast('As palavras-passe não são iguais.', true); return; }
      try {
        const r = await call('/auth/registo', 'POST', { email, password: pass, name: nome });
        S.aRegistar = false;
        if (r.emailEnviado) {
          S.aConfirmar = null;
          toast('Conta criada. Abre o link que foi para o teu email (24 horas).');
          paint();
        } else {
          /* sem correio configurado, o caminho honesto é o dono confirmar */
          S.aConfirmar = null;
          S.avisoAuth = `${r.mensagem}. ${r.instrucao || ''}`.trim();
          toast('Conta criada e por confirmar — fala com o dono da instalação.', true);
          paint();
        }
      } catch (e) { toast(e.message, true); }
      return;
    }
    if (name === 'confirmar-conta') {
      const token = String($('#cfToken')?.value || '').trim();
      if (!token) { toast('Cola o token que veio no link.', true); return; }
      try {
        await call('/auth/confirmar', 'POST', { token });
        S.aConfirmar = null; S.needLogin = false; S.primeiraConta = false;
        toast('Conta confirmada. Entraste.');
        await boot(true);
      } catch (e) { toast(e.message, true); }
      return;
    }
    if (name === 'fechar-confirmar') { S.aConfirmar = null; paint(); return; }
    if (name === 'abrir-recuperar') {
      const email = String($('#lgEmail')?.value || '').trim();
      if (!email) { toast('Escreve primeiro o teu email no campo de cima.', true); return; }
      try {
        const r = await call('/auth/recuperar', 'POST', { email });
        toast(r.nota ? `Pedido registado, mas ${r.nota}` : 'Se houver conta com esse email, o link de recuperação segue para lá.', !!r.nota);
        S.aRecuperar = true; paint();
      } catch (e) { toast(e.message, true); }
      return;
    }
    if (name === 'redefinir-palavra') {
      const token = String($('#rgToken')?.value || '').trim();
      const nova = String($('#lgPass')?.value || '');
      if (!token) { toast('Cola o token que veio no email.', true); return; }
      if (nova !== String($('#lgPass2')?.value || '')) { toast('As palavras-passe não são iguais.', true); return; }
      try {
        await call('/auth/redefinir', 'POST', { token, password: nova });
        S.aRecuperar = false; S.needLogin = false; S.primeiraConta = false;
        toast('Palavra-passe nova guardada. Entraste.');
        await boot(true);
      } catch (e) { toast(e.message, true); }
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
    if (name === 'confirmar-conta-admin') {
      const r = await call(`/ops/utilizadores/${encodeURIComponent(id)}/confirmar`, 'POST', {});
      toast(`Conta confirmada${r?.utilizador?.email ? `: ${r.utilizador.email}` : ''}.`);
      await loadContas(); paint();
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
    /* 1.60.0 · criar trabalho depressa a partir do telemóvel: muda de página e
       abre o formulário, em vez de deixar o botão a piscar noutro ecrã */
    if (name === 'tarefa-rapida') {
      S.route = { name: 'tarefas', id: null };
      S.addingTask = true;
      location.hash = '#/tarefas';
      await boot();
      document.querySelector('#tarefa-titulo, #tTitulo, .nova-tarefa input, input#tTitulo')?.focus?.();
      return;
    }
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
      await loadAgentes().catch(() => null);
      paint();
      return;
    }
    if (name === 'novo-projeto') { S.addingProject = !S.addingProject; paint(); return; }
    if (name === 'ver-projeto') { S.projetoTab = 'briefing'; location.hash = `#/projeto/${encodeURIComponent(id)}`; return; }
    /* 1.57.0 · as abas do projeto: só mudam o que se vê, o estado do projeto
       (briefing por gravar, mídia em curso) atravessa-as inteiro */
    if (name === 'proj-tab') {
      S.projetoTab = abaValida(el?.dataset?.tab);
      paint();
      return;
    }
    if (name === 'proj-copiar') {
      const valor = el?.dataset?.valor || '';
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(valor);
        else throw new Error('sem área de transferência');
        toast(`Copiado: ${valor}`);
      } catch {
        toast(`Não consegui copiar. O contacto é ${valor}`, true);
      }
      return;
    }

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
      /* 1.54.2 · «iniciar projeto»: cria o projeto e ABRE o briefing, com o que a
         ficha da lead sustenta. Se o projeto já existir, abre-se esse — uma lead,
         um projeto. O rascunho da IA é um pedido à parte (o projeto não espera
         por um modelo para ficar acessível). */
      const r = await call(`/ops/leads/${encodeURIComponent(leadId)}/projeto`, 'POST', { kind: 'landing' });
      toast(r.existente ? 'Este lead já tinha projeto — abri o que existe.' : 'Projeto iniciado a partir do lead.');
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
      const qualificacao = v('elQualificacao');
      if (qualificacao && !(Number(qualificacao) >= 0 && Number(qualificacao) <= 100)) {
        toast('A qualificação é um número de 0 a 100 — ou fica vazia.', true); return;
      }
      const corpoEdicao = {
        phone: telefone, email, website: siteLimpo,
        category: v('elNicho'), city: v('elCidade'), notes: v('elNotas'),
        qualificacao: qualificacao === '' ? null : Number(qualificacao),
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


    /* ---- 1.56.0 · faturas ---- */
    if (name === 'fatura-nova') { S.addingFatura = true; S.novaFatura = null; paint(); return; }
    if (name === 'fatura-cancelar') { S.addingFatura = false; S.novaFatura = null; paint(); return; }
    if (name === 'fatura-linha-mais') {
      const n = lerFormularioFatura();
      n.linhas.push({ descricao: '', quantidade: '1', preco: '' });
      paint();
      return;
    }
    if (name === 'fatura-linha-menos') {
      const n = lerFormularioFatura();
      const i = Number(el.dataset.idx);
      if (n.linhas.length > 1) n.linhas.splice(i, 1);
      paint();
      return;
    }
    if (name === 'fatura-criar') {
      if (!$('#fNome')?.value?.trim()) { toast('Falta o nome do cliente.', true); return; }
      const pedido = pedidoDaFatura();
      if (!pedido.linhas.length) { toast('Escreve pelo menos uma linha: o que foi vendido e quanto.', true); return; }
      if (Number(pedido.ivaTaxa) === 0 && !String(pedido.motivoIsencao).trim()) { toast('Uma fatura isenta tem de dizer o motivo (ex.: «Isento — artigo 9.º do CIVA»).', true); return; }
      const r = await call('/ops/faturas', 'POST', pedido);
      S.addingFatura = false;
      S.novaFatura = null;
      await loadFaturas().catch(() => null);
      paint();
      toast(`Fatura ${r.fatura?.codigo || ''} emitida — o PDF está na lista.`);
      return;
    }
    if (name === 'fatura-enviar') {
      const r = await call(`/ops/faturas/${encodeURIComponent(id)}/enviar`, 'POST', {});
      if (!r.enviado) { toast(`Não saiu: ${r.motivo}`, true); return; }
      await loadFaturas().catch(() => null);
      paint();
      toast(`Fatura enviada para ${r.para}.`);
      return;
    }
    if (name === 'fatura-anular') {
      const motivo = prompt('Porquê anular? (fica escrito na nota de crédito)');
      if (!motivo) return;
      const r = await call(`/ops/faturas/${encodeURIComponent(id)}/anular`, 'POST', { motivo });
      await loadFaturas().catch(() => null);
      paint();
      toast(`Fatura anulada. Nota de crédito ${r.notaCredito?.codigo || ''} emitida.`);
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
    const daIA = e.target.closest('[data-act="ia-preferido"],[data-act="ia-chat-mudar"]');
    if (daIA) { await accaoIA(daIA.dataset.act, daIA, apiMesa); return; }
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
    const destino = parseHash();
    /* 1.54.2 · alterações no briefing por gravar pedem confirmação antes de
       serem substituídas por outra página (o texto escrito vive no estado, por
       isso um repintar não o perde — sair da página sim) */
    if (!podeSair(apiMesa, destino)) {
      if (S.briefing?.projetoId) location.hash = `#/projeto/${encodeURIComponent(S.briefing.projetoId)}`;
      return;
    }
    S.route = destino;
    S.pick = null;
    /* o ciclo da mídia é do projeto aberto: fora dele não há nada para seguir */
    if (destino.name !== 'projeto') pararCiclo(apiMesa);
    if (S.route.name !== 'ia') pararSeguimento();
    if (S.route.name !== 'papel') fecharCamera();
    if (S.route.name === 'lead' && S.route.id) { try { await loadLead(S.route.id); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'projeto' && S.route.id) {
      try { await loadProjeto(S.route.id); } catch (e) { toast(e.message, true); }
      /* 1.54.2/1.54.3 · o briefing e a mídia vivem no projeto: ao mudar de projeto
         por hash têm de ser lidos OUTRA VEZ. Sem isto, a mesa mostrava «a abrir o
         briefing…» para sempre ao saltar de um projeto para outro. */
      await carregarBriefing(apiMesa, S.route.id, { forcar: true }).catch(() => null);
      const M = await carregarMedia(apiMesa, S.route.id, { forcar: true }).catch(() => null);
      if (M && (M.dados?.geracoes || []).some((g) => ['aguardando', 'em_processamento'].includes(g.estado))) iniciarCiclo(apiMesa);
      else pararCiclo(apiMesa);
    }
    if (S.route.name === 'papel' && !S.papelEstado) { try { await carregarPapel(apiMesa); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'cine') { try { S.cine = null; await carregarCine(apiMesa, S.route.id); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'tarefas') { try { await loadTarefas(); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'faturas') { try { await loadFaturas(); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'agentes') { try { await loadAgentes(); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'contas') { try { await loadContas(); } catch (e) { toast(e.message, true); } }
    if (S.route.name === 'leads' && !S.pipeline) { try { await loadPipeline(); } catch (e) { toast(e.message, true); } }
    paintNav();
    paint();
    main().scrollIntoView({ block: 'start' });
  });
  /* 1.57.0 · Ctrl+K / Cmd+K põe o cursor na pesquisa global; Esc tira-o */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
      const i = document.querySelector('#gq');
      if (i) { e.preventDefault(); i.focus(); i.select?.(); }
    }
    if (e.key === 'Escape') {
      const i = document.activeElement;
      if (i && i.id === 'gq') { i.blur(); S.gq = ''; S.results = null; paint(); }
    }
  });
  /* os menus de detalhes fecham-se ao clicar fora deles */
  document.addEventListener('click', e => {
    document.querySelectorAll('details[open]').forEach(d => {
      if ((d.classList.contains('pj-menu') || d.classList.contains('hmenu')) && !d.contains(e.target)) d.open = false;
    });
  });
  ligarImportacao();
  ligarPapel(apiMesa, { rota: () => S.route.name });
  ligarCine(apiMesa, { rota: () => S.route.name });
  ligarBriefing(apiMesa);
  ligarMedia(apiMesa);
  boot(true);
}

start();
