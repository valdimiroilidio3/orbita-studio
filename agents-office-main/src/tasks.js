// Órbita V3 — the work layer.
// V3.3 (AJ, 6 Sep 2026): a PERMANENT Task Status panel on the right — a one-line command bar
// (department dropdown + input, the office names the agent as you type) over a live feed of
// every task, newest change first, with status chips as filters. The flying tickets are gone:
// new work and handoffs simply appear in the feed (and a 📋 pops over the desk). Each status
// carries its own honest meta — backlog: how long it has waited · em curso: desde quando corre
// bar · waiting: minutes waiting for AJ's tick · done: the time it finished. Company-wide
// Kanban still lives on B. DOING / NEXT / DONE rows stay on every pod card.
// Session-only theatre — nothing persists (AJ's call: gauge interest first).
// V3.5 (AJ, 9 Sep 2026): ROUTINES — tasks on the office's own clock, Emails / Accounting / Sales
// only this release. Set one in the bar ("todos os dias úteis às 8h, …" or the REPEAT picker), by
// telling an agent in chat, or in <brain>/Órbita/routines.json. Live: the server keeps the
// clock, fires and runs them page or no page; this page polls and shows the card move
// SCHEDULED → BACKLOG → IN PROGRESS → (WAITING ON APPROVAL) → DONE. A draft that needs the owner's
// OK makes the agent stand and wave; APPROVE sends it, REJECT + a note reworks it. Demo (file://):
// session-only routines fired by this tick.
// V3.2 (16 Sep 2026): AGENT TEAMS — TEAM in the bar (or "em equipa" in the sentence) sends the task
// to the department lead, who splits it into pieces; the pieces appear as cards on the teammates'
// desks (↳), all IN PROGRESS at once, each teammate's finished piece lands in their own chat and
// walks back to the lead (📋), notes they leave each other pop as 💬, and the lead's card finishes
// with the combined deliverable. Live: the server does it (serve.mjs runTeam, one Claude process per
// desk); this page reads `task.team` off /api/tasks. Demo: the same theatre on a timer.
import { DEPTS, AGENTS, DEPT_KEYS } from './data.js';
import { SEAT } from './agentes.js';
import { parseWhen, describe, nextRun, fromPicker, untilText } from './when.js';
import { initCalendar } from './calendar.js'; // V3.2.1 (16 Sep 2026): the calendar on P
import { fmtTime, fmtDate, fmtDateTime, normaliseHour } from './time.js';
import { MODEL_KEYS, MODELS, DEFAULT_MODEL, modelName, normModel, FROM_TEXT , EFFORT_KEYS, EFFORT_NAME, normEffort, effortName, effortFor } from './models.js';

// palavras que encaminham uma tarefa escrita para o agente certo dentro da sala
const KEYS = {
  elead: ['prioridade', 'prazo', 'atraso', 'coordena', 'resumo', 'aprova'],
  imail: ['tarefa', 'distribui', 'calendário', 'agenda', 'prazo', 'responsável'],
  report: ['relatório', 'kpi', 'números', 'desempenho', 'produtividade'],
  dash: ['painel', 'gráfico', 'dashboard', 'indicador', 'bloco'],
  comply: ['consentimento', 'rgpd', 'privacidade', 'permissão', 'aprovação', 'limite'],
  pros: ['prospeção', 'leads', 'google maps', 'empresas', 'lista', 'icp', 'pontuar'],
  enzo: ['enriquecer', 'e-mail', 'contacto', 'telemóvel', 'decisor', 'dados'],
  ilm: ['pedido', 'site', 'qualificar', 'marcação', 'reunião', 'inbound'],
  riley: ['pesquisa', 'tendência', 'mercado', 'fontes', 'notícia'],
  scout: ['concorrente', 'rival', 'preços', 'concorrência', 'posicionamento'],
  vmail: ['site', 'diagnóstico', 'https', 'velocidade', 'formulário', 'auditoria'],
  olead: ['venda', 'fechar', 'negócio', 'objeção', 'reunião', 'abordagem', 'cliente'],
  piper: ['proposta', 'orçamento', 'âmbito', 'preçário', 'opções'],
  folo: ['seguimento', 'reativar', 'sem resposta', 'lembrete', 'segundo contacto'],
  ona: ['onboarding', 'arranque', 'acessos', 'boas-vindas', 'integração'],
  legal: ['contrato', 'termos', 'cláusula', 'jurídico', 'privacidade'],
  cmail: ['e-mail', 'cliente', 'resposta', 'dúvida', 'prazo'],
  gfx: ['briefing', 'estrutura', 'navegação', 'design system', 'conceito', 'identidade'],
  dasst: ['ecrã', 'componente', 'interface', 'responsivo', 'ui', 'mock'],
  alead: ['imagem', 'mockup', 'capa', 'visual', 'apresentação', 'arte'],
  invo: ['ux', 'fluxo', 'texto', 'utilizador', 'pesquisa', 'sessão'],
  dlead: ['construir', 'desenvolver', 'sistema', 'backend', 'frontend', 'arquitetura'],
  pco: ['projeto', 'marco', 'prazo', 'plano', 'horas', 'capacidade'],
  qa: ['teste', 'qa', 'erro', 'bug', 'verificação', 'regressão'],
  crep: ['frontend', 'página', 'componente', 'velocidade', 'html'],
  cass: ['integração', 'crm', 'pagamento', 'stripe', 'formulário', 'automação'],
  apay: ['deploy', 'publicar', 'domínio', 'alojamento', 'monitorização'],
  kmail: ['documentação', 'manual', 'notas', 'como funciona', 'arquivo'],
  mlead: ['marketing', 'plano editorial', 'campanha', 'orçamento', 'calendário'],
  newt: ['texto', 'legenda', 'newsletter', 'caso de estudo', 'publicação'],
  ada: ['anúncio', 'meta', 'campanha', 'cpa', 'público', 'orçamento'],
  iggy: ['instagram', 'linkedin', 'publicação', 'comentário', 'rede social', 'carrossel'],
  vid: ['vídeo', 'reel', 'corte', 'legendas', 'demonstração', 'exportar'],
  lexi: ['calendário editorial', 'aprovação', 'canal', 'fila', 'agendar'],
  recon: ['alcance', 'analytics', 'tráfego', 'leads', 'resultados', 'métricas'],
};

function timeStr(ts) {
  return fmtTime(ts); // 24 horas, sempre (src/time.js)
}
function span(ms) { // "4 min" · "1 h 12 m" · "3 h"
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'agora mesmo';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} m` : `${h} h`;
}
const agentOf = id => AGENTS.find(a => a.id === id);
const STATE_LABEL = { next: 'Em fila', doing: 'Em curso', waiting: 'À espera', done: 'Concluída', sched: 'Agendada', scheduled: 'Agendada' }; // scheduled (V3.2.1): a task with a date, not yet fired

export function initTasks(ctx) {
  const { R, deptRT, spawnEmote, chatPush, chatHist, feedPush, zoomToApproval, enterFocus, openAgent,
          getFocused, esc, brainWrite, brain, onLive, onTools, requestApproval, setStuck, onUsage } = ctx;
  // LIVE mode (served by serve.mjs): the bar routes through Claude, agents produce real
  // deliverables saved as notes in the brain, and tasks persist. Opened as a file it stays demo.
  let live = false;
  const API = '/api';
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

  const tasks = [];
  let seq = 1;
  // V3.5 routines. Live: the server's list (polled). Demo: session-only, fired by this tick.
  const routines = []; let rseq = 1, polling = false, railAgent = null, railExp = false;
  const RT_DEPTS = ['emails', 'fin', 'sales'];
  const RT_NAMES = { emails: 'COMANDO', fin: 'DESIGN LAB', sales: 'PROSPEÇÃO', marketing: 'MEDIA', ops: 'VENDAS', delivery: 'ENGENHARIA' };
  const rtRefuse = k => `As rotinas chegam a ${RT_NAMES[k] || k} numa versão futura. Nesta versão: E-mails, Contabilidade e Vendas.`;
  const deptRoutines = k => routines.filter(r => r.dept === k);
  const agentRoutines = id => routines.filter(r => r.agent === id);
  const nextOf = list => list.filter(r => !r.paused && r.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0];
  const byNext = (a, b) => (a.paused ? Infinity : a.nextAt || Infinity) - (b.paused ? Infinity : b.nextAt || Infinity);
  const doneCount = Object.fromEntries(DEPT_KEYS.map(k => [k, 0]));
  const board = { open: false };
  let dirty = false, lastBadge = 0, lastAgo = 0, lastOps = 0;

  /* ---------- model ---------- */
  function mk(o) {
    const a = agentOf(o.agent);
    const now = Date.now();
    const t = { id: seq++, dept: a.dept, state: 'next', progress: 0, addedAt: now, changedAt: now, ...o };
    tasks.push(t);
    return t;
  }
  const touch = (t, ev) => { t.changedAt = Date.now(); t.last = ev; dirty = true; };
  const agentTasks = (id, st) => tasks.filter(t => t.agent === id && t.state === st);
  const deptTasks = (k, st) => tasks.filter(t => t.dept === k && t.state === st);
  function visibleTitles(id) { return new Set(tasks.filter(t => t.agent === id && t.state !== 'done').map(t => t.title)); }
  function start(t, now) { // uma tarefa que o servidor mandou começar
    t.state = 'doing'; t.startedAt = now; t.progress = 0; t.running = !!t.srv; t.ready = false;
    t.pausedAt = null;
    touch(t, 'started');
  }
  function prune(k) {
    const done = tasks.filter(t => t.dept === k && t.state === 'done' && !t.live).sort((a, b) => b.doneAt - a.doneAt);
    for (const t of done.slice(14)) tasks.splice(tasks.indexOf(t), 1);
  }
  function complete(t) {
    t.state = 'done'; t.doneAt = Date.now(); t.progress = 1;
    doneCount[t.dept]++;
    const r = R[t.agent];
    spawnEmote(r, '✓');
    feedPush(r, '✓', 'Done: ' + t.title);
    if (chatHist[t.agent]) chatPush(t.agent, { who: 'work', i: '✓', text: 'done — ' + t.title });
    if (t.live) deliver(t); // o resultado real entra na conversa; a nota no Cérebro já foi escrita pelo servidor
    touch(t, 'done');
    prune(t.dept);
  }
  function deliver(t) {
    const a = agentOf(t.agent);
    if (t.piece) { // V3.2 (16 Sep): a teammate's piece — in their own chat, then it walks back to the lead
      const L = agentOf(t.leadId), parent = tasks.find(x => x.id === t.parent);
      chatPush(t.agent, { who: 'file', icon: t.error ? '⚠' : '📄', name: slug(t.title) + '.md', meta: `a minha parte · passada a ${L ? L.name : 'the lead'} · ${timeStr(t.doneAt)} · clica para ver`, content: t.result });
      if (!t.error) chatPush(t.agent, { who: 'agent', text: `A minha parte de «${parent ? parent.title : t.title}» está pronta e entregue a ${L ? L.name : 'the lead'}${t.used && t.used.length ? `. Usei ${t.used.join(', ')}` : ''}.` });
      feedPush(R[t.agent], '📄', `Parte concluída → ${L ? L.name : 'lead'}: ${t.title}`);
      if (L && R[L.id]) { spawnEmote(R[L.id], '📋'); feedPush(R[L.id], '📋', `Parte recebida de ${a.name}: ${t.title}`); }
      return;
    }
    chatPush(t.agent, { who: 'file', icon: t.error ? '⚠' : '📄', name: (t.note || slug(t.title)) + '.md',
      meta: `${t.error ? 'could not complete' : t.approved ? 'enviado após o teu OK · guardado no teu cérebro' : 'entregue · guardado no teu cérebro'} · ${timeStr(t.doneAt)} · clica para ver`, content: t.result });
    if (!t.error) chatPush(t.agent, { who: 'agent', text: `Concluído — «${t.title}»${t.routine ? ` (rotina, ${t.when}${t.late ? ', correu tarde' : ''})` : ''} está pronto acima${t.team?.members?.length ? ` — a equipa foi ${membersText(t)} e eu` : ''}${t.read && t.read.length ? ` (li ${t.read.slice(0, 3).join(', ')})` : ''}${t.used && t.used.length ? `. Usei ${t.used.join(', ')}` : ''}. Say "revise: …" and altero-a.` });
    feedPush(R[t.agent], '📄', `Delivered: ${t.title}`);
    if (brain && t.read) for (const n of t.read.slice(0, 2)) brain.readNote(t.agent, n);
  }
  /* ---------- a única fonte de tarefas: a base de dados da operação ----------
     26 out 2026. Antes: 35 agentes "a meio de uma tarefa" no arranque, filas sorteadas e 40 tarefas
     concluídas inventadas por dia. Isso mudava o estado das tarefas sem haver trabalho nenhum. Agora
     o painel lê `GET /api/ops/tarefas` e mostra o que existe — se não existir nada, diz «sem tarefas».
     As tarefas do motor de IA (`/api/tasks`, o painel antigo) continuam a entrar pelo `reconcile`. */
  let opsSig = '';
  async function loadOps() {
    if (!live || polling) return;
    try {
      const d = await fetch(API + '/ops/tarefas?limit=120').then(r => r.json());
      const list = Array.isArray(d.tarefas) ? d.tarefas : [];
      const sig = list.map(t => `${t.id}:${t.state}:${t.attempts || 0}`).join('|');
      if (sig === opsSig) return;
      opsSig = sig;
      const seen = new Set();
      for (const st of list) {
        const agent = SEAT[st.kind] || st.agent || '';
        if (!agentOf(agent)) continue;
        seen.add(st.id);
        const state = st.state === 'running' ? 'doing'
          : st.state === 'awaiting_approval' ? 'waiting'
          : st.state === 'queued' ? 'next' : 'done';
        let t = tasks.find(x => x.ops && x.sid === st.id);
        if (!t) {
          t = mk({ agent, title: st.title || st.kind, ops: true, sid: st.id, state: 'next', changedAt: new Date(st.created_at).getTime() || Date.now(), addedAt: new Date(st.created_at).getTime() || Date.now() });
          t.state = state;
          if (state === 'doing') { t.state = 'doing'; t.startedAt = new Date(st.started_at || st.created_at).getTime(); spawnEmote(R[agent], '▸'); feedPush(R[agent], '▸', `Tarefa real em curso: ${t.title}`); }
          if (state === 'done') { t.state = 'done'; t.doneAt = new Date(st.finished_at || Date.now()).getTime(); t.error = st.state === 'failed'; if (t.error) t.result = st.error || 'falhou sem motivo escrito'; t.changedAt = t.doneAt; if (t.error) feedPush(R[agent], '✕', `Falhou: ${t.error}`); else feedPush(R[agent], '✓', `Concluída: ${t.title}`); }
          if (state === 'waiting') t.ask = `«${t.title}» está à espera da tua aprovação`;
          touch(t, state);
        } else if (t.state !== state) {
          // mudança real de estado: o cartão move-se agora, não a cada segundo
          const startedAt = new Date(st.started_at || st.created_at).getTime();
          t.state = state; t.changedAt = Date.now();
          if (state === 'doing') { t.startedAt = startedAt; spawnEmote(R[agent], '▸'); }
          if (state === 'done') { t.doneAt = new Date(st.finished_at || Date.now()).getTime(); t.error = st.state === 'failed'; t.result = st.error ? (st.error || 'falhou sem motivo escrito') : (t.result || ''); touch(t, 'done'); }
          if (state === 'waiting') t.ask = `«${t.title}» está à espera da tua aprovação`;
          touch(t, state);
        }
      }
      // o que saiu da base de dados sai do painel (as tarefas do motor de IA ficam com o reconcile)
      for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].ops && !seen.has(tasks[i].sid)) tasks.splice(i, 1);
      dirty = true;
    } catch (e) { /* o servidor pode estar a arrancar — a próxima consulta tenta outra vez */ }
  }
  setInterval(loadOps, 4000);
  loadOps();

  /* ---------- badge rows (far-zoom layer): DOING · NEXT · DONE per pod ---------- */
  function rowHTML(k) {
    return `<div class="b-tasks" data-tkrow="${k}" title="mostrar ${DEPTS[k].short} no painel de tarefas">
      <span>A FAZER<b data-tk="${k}-doing">${deptTasks(k, 'doing').length}</b></span>
      <span>SEGUINTE<b data-tk="${k}-next">${deptTasks(k, 'next').length}</b></span>
      <span>CONCLUÍDO<b data-tk="${k}-done">${doneCount[k]}</b></span></div>`;
  }
  for (const k of DEPT_KEYS) deptRT[k].apprRow.insertAdjacentHTML('beforebegin', rowHTML(k));
  function syncBadges() {
    for (const k of DEPT_KEYS) {
      const vals = { doing: deptTasks(k, 'doing').length, next: deptTasks(k, 'next').length, done: doneCount[k] };
      for (const [s, n] of Object.entries(vals)) {
        document.querySelectorAll(`[data-tk="${k}-${s}"]`).forEach(b => {
          if (b.textContent !== String(n)) {
            b.textContent = n;
            b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
          }
        });
      }
    }
  }

  /* ---------- the TASK STATUS panel (always on, right side) ---------- */
  const panel = document.getElementById('tpanel');
  const P_ = {
    dd: panel.querySelector('.tp-dd'), ddName: panel.querySelector('.tp-dd .tp-ddn'), ddDot: panel.querySelector('.tp-dd .dot'),
    menu: panel.querySelector('.tp-menu'), input: panel.querySelector('.tp-in'), add: panel.querySelector('.tp-add'),
    hint: panel.querySelector('.tp-hint'), chips: panel.querySelector('.tp-chips'), rows: panel.querySelector('.tp-rows'),
    scope: panel.querySelector('.tp-scope'),
    rep: panel.querySelector('.tp-rep'), repRow: panel.querySelector('.tp-rep-row'), cad: panel.querySelector('.tp-cad'), at: panel.querySelector('.tp-at'), okc: panel.querySelector('.tp-okc'), next: panel.querySelector('.tp-next'),
    model: panel.querySelector('.tp-model'), effort: panel.querySelector('.tp-effort'),
    bigBtn: panel.querySelector('.tp-big-btn'), team: panel.querySelector('.tp-team'),
    ai: panel.querySelector('.tp-ai'),
    aiPop: document.getElementById('aiPop'),
  };
  // V3.7: the box grows with the text (one line at rest, six at most) and the big editor mirrors it
  const big = document.getElementById('tpBig');
  const B_ = { in: big.querySelector('.tb-in'), dept: big.querySelector('.tb-dept'), dot: big.querySelector('.tb-head .dot'), hint: big.querySelector('.tb-hint'), add: big.querySelector('.tb-add'), close: big.querySelector('.tb-close') };
  function grow() { P_.input.style.height = '30px'; P_.input.style.height = Math.min(118, Math.max(30, P_.input.scrollHeight)) + 'px'; }
  function openBig() { B_.in.value = P_.input.value; B_.in.placeholder = P_.input.placeholder; big.classList.add('on'); mirrorHint(); B_.in.focus(); B_.in.setSelectionRange(B_.in.value.length, B_.in.value.length); }
  function closeBig() { if (!big.classList.contains('on')) return; big.classList.remove('on'); grow(); if (P_.input.value) P_.input.focus(); }
  function mirrorHint() { B_.hint.innerHTML = P_.hint.innerHTML; B_.hint.className = P_.hint.className.replace('tp-hint', 'tp-hint tb-hint'); }
  // V3.6 (D2): the model menu — Sonnet · Opus · Fable. Shows the office default; change it and it applies to this task (or this routine, with REPEAT on)
  let officeModel = DEFAULT_MODEL, modelTouched = false;
  P_.model.innerHTML = MODEL_KEYS.map(k => `<option value="${k}">${MODELS[k].name.toUpperCase()}</option>`).join('');
  P_.model.value = officeModel;
  P_.model.addEventListener('change', () => { modelTouched = P_.model.value !== officeModel; P_.model.classList.toggle('set', modelTouched); updateHint(); });
  P_.model.addEventListener('keydown', e => e.stopPropagation());
  function setOfficeModel(k) { officeModel = normModel(k) || DEFAULT_MODEL; if (!modelTouched) P_.model.value = officeModel; }
  const chosenModel = () => (modelTouched ? P_.model.value : null);
  function resetModel() { modelTouched = false; P_.model.value = officeModel; P_.model.classList.remove('set'); resetEffort(); }
  const modelBit = t => t.modelUsed ? ` · ${modelName(t.modelUsed)}${t.effortUsed ? ' ' + t.effortUsed : ''}${t.modelFrom && t.modelFrom !== 'office' ? ' (' + FROM_TEXT[t.modelFrom] + ')' : ''}` : '';
  // V3.6.1: the EFFORT menu beside the model — AUTO (the model's own; Opus = high) · Low · Medium · High · Extra high · Max. Same precedence as the model.
  let officeEffort = '', effortTouched = false;
  P_.effort.innerHTML = `<option value="">AUTOMÁTICO</option>` + EFFORT_KEYS.map(k => `<option value="${k}">${EFFORT_NAME[k].toUpperCase()}</option>`).join('');
  P_.effort.value = officeEffort;
  P_.effort.addEventListener('change', () => { effortTouched = P_.effort.value !== officeEffort; P_.effort.classList.toggle('set', effortTouched); updateHint(); });
  P_.effort.addEventListener('keydown', e => e.stopPropagation());
  function setOfficeEffort(k) { officeEffort = normEffort(k) || ''; if (!effortTouched) P_.effort.value = officeEffort; }
  const chosenEffort = () => (effortTouched ? (P_.effort.value || 'auto') : null); // 'auto' = o proprietário escolheu o do modelo em vez do do escritório
  const effortSend = () => { const e = chosenEffort(); return e && e !== 'auto' ? e : undefined; };
  function resetEffort() { effortTouched = false; P_.effort.value = officeEffort; P_.effort.classList.remove('set'); }
  const effortUsedFor = (mdl) => effortFor({ task: effortSend(), office: chosenEffort() === 'auto' ? '' : officeEffort, model: mdl }); // what a demo card will show
  const pickBit = (forWhat) => { // the hint's "Opus · Alto para esta tarefa"
    const bits = []; if (modelTouched) bits.push(modelName(P_.model.value)); if (effortTouched) bits.push(effortName(P_.effort.value || ''));
    return bits.length ? ` · <b>${bits.join(' · ')}</b> para esta ${forWhat}` : '';
  };
  // the REPEAT picker (B1): cadence + time; "precisa do meu OK" defaults on (D1)
  let repeat = false;
  P_.cad.innerHTML = [['weekdays', 'Todos os dias úteis'], ['daily', 'todos os dias'], ['mon', 'Mondays'], ['tue', 'Tuesdays'], ['wed', 'Wednesdays'], ['thu', 'Thursdays'], ['fri', 'Fridays'], ['sat', 'Saturdays'], ['sun', 'Sundays'], ['hourly', 'De hora a hora, 9h–17h, dias úteis']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  P_.at.addEventListener('blur', () => { const h = normaliseHour(P_.at.value); if (h) P_.at.value = h; }); // 9:5 → 09:05
  P_.rep.addEventListener('click', () => { repeat = !repeat; P_.rep.classList.toggle('on', repeat); P_.repRow.hidden = !repeat; updateHint(); if (repeat) P_.input.focus(); });
  P_.cad.addEventListener('change', () => { P_.at.disabled = P_.cad.value === 'hourly'; updateHint(); });
  P_.at.addEventListener('change', updateHint);
  [P_.cad, P_.at, P_.okc].forEach(el => el.addEventListener('keydown', e => e.stopPropagation()));
  const routineIntent = text => repeat ? { when: fromPicker(P_.cad.value, normaliseHour(P_.at.value) || '08:00'), text, picker: true } : parseWhen(text);
  // V3.2 (16 Sep) Agent Teams: the TEAM toggle — the department lead splits the task across its desks, they work at once, the lead writes the final
  let teamOn = false, teamsCfg = { enabled: true, max: 4 };
  const teamIntent = text => /\b(em equipa|team up|team this|get the (whole )?team|the (whole )?team (on|to|should|can)|with the team|(spawn|use|get) (\d+|two|three|four|five|a few|some) teammates?|\d+ teammates|split (it|this|the work) (up|across|between)|teammates|team:|whole department)\b/i.test(text);
  const asTeam = text => teamsCfg.enabled && (teamOn || teamIntent(text));
  const leadOf = k => AGENTS.find(x => x.dept === k && x.lead) || AGENTS.filter(x => x.dept === k)[0];
  P_.team.addEventListener('click', () => { teamOn = !teamOn; P_.team.classList.toggle('on', teamOn); updateHint(); if (teamOn) P_.input.focus(); });
  /* ---------- V4 (25 out 2026) o motor de IA ----------
     O escritório não está preso a um fornecedor: GET /api/ai diz o que está realmente instalado
     nesta máquina (CLIs no PATH, chaves no ambiente, servidores locais a responder), o que falta e
     porquê. Aqui vê-se, testa-se com um turno a sério, e troca-se a quente (POST /api/ai/switch). */
  const AI_ = { state: null, busy: false };
  const aiLabel = () => {
    const a = AI_.state?.active;
    if (!a) return { text: 'SEM IA', dead: true, title: 'Nenhum motor de IA disponível — clica para ver o que falta' };
    return { text: String(a.label || a.id).toUpperCase(), dead: false,
      title: `${a.label} (${a.id}) · ${a.tools ? 'com ferramentas' : 'só texto'} — clica para ver, testar ou trocar de motor` };
  };
  function paintAiButton() {
    if (!P_.ai) return;
    const l = aiLabel();
    P_.ai.textContent = l.text; P_.ai.title = l.title;
    P_.ai.classList.toggle('dead', l.dead);
  }
  function aiRowHTML(p) {
    const act = AI_.state?.active?.id === p.id;
    const ok = p.available && !p.pending;
    const why = p.reason && !ok ? `<div class="ai-why ${p.pending ? '' : 'bad'}">${esc(p.reason)}</div>` : '';
    const kind = p.kind === 'cli' ? 'CLI' : 'API';
    const bit = p.tools ? `<span class="ai-k" title="o agente recebe ferramentas MCP e o Chrome">FERRAMENTAS</span>` : `<span class="ai-k" title="responde texto: sem ferramentas nem Chrome">SÓ TEXTO</span>`;
    const res = AI_.state?.tested?.[p.id];
    const resBit = res ? `<span class="res ${res.ok ? '' : 'bad'}" title="${esc(res.text || res.error || '')}">${res.ok ? 'OK · ' + res.ms + 'ms' : 'FALHOU'}</span>` : '';
    return `<div class="ai-row ${ok ? 'ok' : 'dead'}${act ? ' act' : ''}" data-prov="${p.id}">
      <span class="ai-dot"></span>
      <div><div class="ai-n">${esc(p.label)}<span class="ai-k">${kind}</span>${bit}${act ? '<span class="ai-k">A RESPONDER</span>' : ''}</div>
      <div class="ai-why">${esc(p.model || 'modelo por omissão')}${p.keyEnv ? ' · ' + esc(p.keyEnv) : ''}${p.baseUrl ? ' · ' + esc(p.baseUrl) : ''}</div>${why}</div>
      <div class="ai-bt">${resBit}<button data-ai="test" ${ok ? '' : 'disabled'}>TESTAR</button><button class="use" data-ai="use" ${ok && !act ? '' : 'disabled'}>USAR</button></div>
    </div>`;
  }
  function paintAiPop() {
    if (!P_.aiPop) return;
    const st = AI_.state;
    const now = P_.aiPop.querySelector('.now');
    if (!st) { now.textContent = 'A LER…'; now.classList.remove('dead'); P_.aiPop.querySelector('.ai-list').innerHTML = `<div class="ai-more">a perguntar ao servidor…</div>`; return; }
    const a = st.active;
    now.textContent = a ? `AGORA · ${String(a.label).toUpperCase()}${a.tools ? '' : ' · SÓ TEXTO'}` : 'NENHUM MOTOR DISPONÍVEL';
    now.classList.toggle('dead', !a);
    P_.aiPop.querySelector('.ai-list').innerHTML = st.providers.map(aiRowHTML).join('');
  }
  async function loadAi(refresh = false) {
    try {
      const r = await fetch(`${API}/ai${refresh ? '?refresh=1' : ''}`);
      AI_.state = await r.json();
      if (AI_.state) AI_.state.tested = AI_.state.tested || {};
      paintAiButton(); paintAiPop();
    } catch { AI_.state = null; paintAiButton(); }
  }
  async function testAi(id) {
    AI_.state.tested = { ...(AI_.state?.tested || {}), [id]: { ok: false, ms: 0, text: 'a testar…' } };
    paintAiPop();
    const row = P_.aiPop.querySelector(`[data-prov="${id}"] .res`);
    if (row) row.textContent = 'A TESTAR…';
    try {
      const r = await fetch(`${API}/ai/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: id }) });
      const j = await r.json();
      AI_.state.tested[id] = { ok: !!j.ok, ms: j.ms || 0, text: j.text || '', error: j.error || '' };
    } catch (e) { AI_.state.tested[id] = { ok: false, ms: 0, error: e.message }; }
    paintAiPop();
  }
  async function useAi(id) {
    AI_.state.tested = AI_.state.tested || {};
    try {
      const r = await fetch(`${API}/ai/switch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: id }) });
      const j = await r.json();
      if (!r.ok || j.error) { say(`Não troquei: ${esc(j.error || r.status)}`, 'err'); return; }
      AI_.state.active = j.active;
      const full = await (await fetch(`${API}/ai`)).json();
      full.tested = AI_.state.tested;
      AI_.state = full;
      paintAiButton(); paintAiPop();
      const mode = panel.querySelector('.tp-mode');
      if (mode && j.active) { mode.textContent = 'AO VIVO · ' + String(j.active.label).toUpperCase(); mode.classList.add('live'); mode.classList.remove('off'); }
      say(`Motor trocado: <b>${esc(j.active?.label || id)}</b>${j.active?.tools ? ' · com ferramentas' : ' · só texto'}. As próximas tarefas correm aqui.`);
    } catch (e) { say(`Não troquei: ${esc(e.message)}`, 'err'); }
  }
  if (P_.ai) {
    P_.ai.addEventListener('click', () => {
      const show = P_.aiPop.hasAttribute('hidden');
      P_.aiPop.toggleAttribute('hidden', !show);
      P_.ai.classList.toggle('on', show);
      if (show) loadAi(true);
    });
    P_.aiPop.querySelector('.ai-close').addEventListener('click', () => { P_.aiPop.hidden = true; P_.ai.classList.remove('on'); });
    P_.aiPop.querySelector('.ai-refresh').addEventListener('click', () => loadAi(true));
    P_.aiPop.addEventListener('click', e => {
      const b = e.target.closest('button[data-ai]'); if (!b) return;
      const id = b.closest('[data-prov]')?.dataset.prov;
      if (!id) return;
      b.dataset.ai === 'test' ? testAi(id) : useAi(id);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !P_.aiPop.hidden) { P_.aiPop.hidden = true; P_.ai.classList.remove('on'); } });
    loadAi();
  }
  function resetTeam() { teamOn = false; P_.team.classList.remove('on'); }
  const teamBit = t => t.team?.members?.length ? ` · <span class="tp-team-chip">TEAM ${t.team.members.length + 1}</span>` : t.piece ? ' · <span class="tp-team-chip">PIECE</span>' : '';
  const membersText = t => (t.team?.members || []).map(id => agentOf(id)?.name || id).join(', ');
  let dept = 'marketing', filter = 'all';
  P_.menu.innerHTML = DEPT_KEYS.map(k => `<button data-k="${k}"><span class="dot" style="background:${DEPTS[k].chip}"></span>${DEPTS[k].name}</button>`).join('');
  P_.menu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { setDept(b.dataset.k); P_.menu.classList.remove('on'); P_.input.focus(); }));
  P_.dd.addEventListener('click', (e) => { e.stopPropagation(); P_.menu.classList.toggle('on'); });
  document.addEventListener('click', () => P_.menu.classList.remove('on'));
  function setDept(k) {
    dept = k;
    P_.ddName.textContent = DEPTS[k].short;
    P_.ddDot.style.background = DEPTS[k].chip;
    B_.dept.textContent = DEPTS[k].name.toUpperCase(); B_.dot.style.background = DEPTS[k].chip;
    P_.input.placeholder = `Escreve uma tarefa para ${DEPTS[k].name.toLowerCase()}…`;
    updateHint();
  }
  // routing: keywords → the right agent in the chosen dept; fallback = the dept lead (or first agent)
  function route(k, title) {
    const low = title.toLowerCase();
    const pool = AGENTS.filter(x => x.dept === k);
    let best = pool.find(x => x.lead) || pool[0], bestN = 0;
    for (const a of pool) {
      const n = (KEYS[a.id] || []).filter(w => low.includes(w)).length;
      if (n > bestN) { bestN = n; best = a; }
    }
    return { agent: best, matched: bestN > 0 };
  }
  function updateHint() {
    grow();
    const text = P_.input.value.trim();
    if (!text) { P_.hint.innerHTML = ''; P_.hint.classList.remove('on'); return; }
    const rt = routineIntent(text);
    if (rt) { // a routine in the making: say the schedule back before Add is pressed
      if (!RT_DEPTS.includes(dept)) { P_.hint.innerHTML = `<span class="tp-amber">${esc(rtRefuse(dept))}</span>`; P_.hint.className = 'tp-hint on'; return; }
      const { agent: ra } = route(dept, rt.text || text);
      const need = rt.needsDay ? 'que dia? diz "todas as segundas …"' : rt.needsTime ? 'que horas? acrescenta "às 8h"' : null;
      P_.hint.innerHTML = `<span class="tp-av" style="border-color:${DEPTS[ra.dept].chip};background:${DEPTS[ra.dept].chip}55">⏱</span>Routine · <b>${esc(describe(rt.when) || 'every week')}</b>` +
        (need ? ` · <span class="tp-amber">${need}</span>` : live ? ' · o Claude nomeia o agente quando primes Adicionar' : ` · vai para <b>${ra.name}</b>`) + (rt.guessed ? ` · "${esc(rt.guessWord)}" taken as ${rt.when.at}` : '');
      P_.hint.innerHTML += pickBit('routine');
      P_.hint.className = 'tp-hint on'; return;
    }
    if (asTeam(text)) { // a team in the making: the lead, and how many desks
      const L = leadOf(dept), chip = DEPTS[dept].chip;
      P_.hint.innerHTML = `<span class="tp-av" style="border-color:${chip};background:${chip}55">⚑</span>Equipa · <b>${L.name}</b> divide-a por até ${teamsCfg.max} secretárias, trabalham ao mesmo tempo e o líder escreve a versão final` + pickBit('task');
      P_.hint.className = 'tp-hint on'; return;
    }
    const { agent: a, matched } = route(dept, text);
    const busy = agentTasks(a.id, 'doing').length > 0 || R[a.id].state === 'stuck';
    const chip = DEPTS[a.dept].chip;
    P_.hint.innerHTML = `<span class="tp-av" style="border-color:${chip};background:${chip}55">${a.name[0]}</span>` +
      (live ? `Provavelmente <b>${a.name}</b> · o Claude confirma quando primes Adicionar`
            : `Vai para <b>${a.name}</b> · ${busy ? 'starts after their current job' : 'starts straight away'}${matched ? '' : ' · diz mais e escolho um especialista'}`) +
      pickBit('task');
    P_.hint.className = 'tp-hint on';
  }
  P_.input.addEventListener('input', () => { panel.querySelector('.tp-cmd').classList.toggle('typing', !!P_.input.value); grow(); updateHint(); });
  P_.input.addEventListener('blur', () => { if (!P_.input.value) panel.querySelector('.tp-cmd').classList.remove('typing'); });
  P_.input.addEventListener('keydown', (e) => { // Enter adds, Shift+Enter is a new line, ⌘⇧E opens the big editor
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') P_.input.blur();
    else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); openBig(); }
  });
  P_.add.addEventListener('click', submit);
  P_.bigBtn.addEventListener('click', openBig);
  B_.in.addEventListener('input', () => { P_.input.value = B_.in.value; P_.input.dispatchEvent(new Event('input', { bubbles: true })); mirrorHint(); });
  B_.in.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } else if (e.key === 'Escape') closeBig(); });
  B_.add.addEventListener('click', submit);
  B_.close.addEventListener('click', closeBig);
  big.addEventListener('click', (e) => { if (e.target === big) closeBig(); });
  function say(html, cls) { P_.hint.innerHTML = html; P_.hint.className = 'tp-hint on' + (cls ? ' ' + cls : ''); grow(); if (big.classList.contains('on')) mirrorHint(); }
  async function submit() {
    let title = P_.input.value.trim().replace(/[.!]+$/, '');
    if (!title) return;
    big.classList.remove('on');
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const rt = routineIntent(title);
    if (rt) { await submitRoutine(rt, title); return; }
    if (live) {
      const text = title, k = dept;
      P_.input.value = ''; P_.input.disabled = true; P_.add.disabled = true;
      const team = asTeam(text);
      say(team ? `A encaminhar pelo Claude — <b>${leadOf(k).name}</b> está a lê-la para a equipa…` : `A encaminhar pelo Claude — ${DEPTS[k].name.toLowerCase()} está a lê-la…`, 'busy');
      try {
        const mdl = chosenModel();
        const r = await fetch(API + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: k, text, model: mdl || undefined, effort: effortSend(), team: team || undefined }) });
        if (!r.ok) throw new Error((await r.json()).error || r.statusText);
        const st = await r.json();
        const t = mk({ agent: st.agent, title: st.title, text: st.text, plan: st.plan, why: st.why, by: 'you', live: true, sid: st.id, model: st.model, modelUsed: st.model || officeModel, modelFrom: st.model ? 'task' : 'office', effort: st.effort,
          team: st.team ? { lead: st.team.lead, members: [] } : undefined });
        resetModel(); resetTeam();
        touch(t, 'added'); spawnEmote(R[t.agent], st.team ? '⚑' : '📋');
        say(st.team ? `Added — <b>${agentOf(t.agent).name}</b> ficou com ela e está a dividi-la pela equipa` : `Added — <b>${agentOf(t.agent).name}</b> ficou com ela${st.why ? ' · ' + esc(st.why) : ''}`);
        setTimeout(() => { if (!P_.input.value) P_.hint.classList.remove('on'); }, 7000);
      } catch (e) {
        // sem motor de IA a tarefa não é inventada localmente: fica dito o que falta
        say(`Não foi criada: ${esc(e.message)}. Sem um motor de IA ligado, o escritório não finge que a tarefa existe.`, 'err');
      }
      P_.input.disabled = false; P_.add.disabled = false; P_.input.blur(); // hand the keys back to the office
      return;
    }
    // sem servidor não há tarefa: uma tarefa local seria ficção (e mudava o estado sem trabalho)
    say('Este escritório está aberto sem servidor. As tarefas vivem na base de dados do Órbita — arranca-o com <b>npm start</b> e esta barra cria trabalho a sério.', 'err');
  }
  /* ---------- V3.5 routines: set one from the bar ---------- */
  async function submitRoutine(rt, raw) {
    const k = dept;
    if (!RT_DEPTS.includes(k)) { say(`<span class="tp-amber">${esc(rtRefuse(k))}</span>`, 'err'); return; }
    if (rt.needsDay) { say('Que dia? Diz "todas as segundas …" or "Seg e Qui …".', 'err'); return; }
    if (rt.needsTime) { say('Que horas? Acrescenta "às 8h" or "às 17:30", ou carrega em REPETIR e escolhe uma.', 'err'); return; }
    const text = (rt.text || raw).trim().replace(/[.!]+$/, '');
    if (!text) { say('O que deve acontecer? A frase tem uma hora mas não tem tarefa.', 'err'); return; }
    if (live) {
      P_.input.disabled = true; P_.add.disabled = true;
      say('A preparar a rotina — o Claude está a nomear o agente…', 'busy');
      try {
        const r = await fetch(API + '/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: k, text, when: rt.when, needsOk: rt.picker ? P_.okc.checked : undefined, model: chosenModel() || undefined, effort: effortSend() }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
        setRoutines([...routines.filter(x => x.id !== j.routine.id), j.routine]);
        const a = agentOf(j.routine.agent);
        say(`Rotina criada — <b>${a.name}</b> · ${esc(j.routine.desc)} · próxima ${esc(untilText(j.routine.nextAt))}${j.routine.needsOk ? ' · espera pelo teu OK' : ' · só leitura, não precisa de OK'}${j.guessed ? ` · "${esc(j.guessed)}" taken as ${j.routine.when.at}` : ''}`);
        P_.input.value = ''; resetModel(); spawnEmote(R[a.id], '⏱'); feedPush(R[a.id], '⏱', `Nova rotina: ${j.routine.title} (${j.routine.desc})`);
        filter = 'sched'; render(true); poll();
      } catch (e) { say(`Claude couldn't set it (${esc(e.message)}).`, 'err'); }
      P_.input.disabled = false; P_.add.disabled = false; P_.input.blur();
      return;
    }
    const { agent: a } = route(k, text);
    const r = addRoutine(k, a.id, text, rt.when, rt.picker ? P_.okc.checked : guessOk(text));
    r.model = chosenModel() || undefined; r.effort = effortSend(); resetModel();
    P_.input.value = ''; say(`Rotina criada — <b>${a.name}</b> · ${esc(r.desc)} · próxima ${esc(untilText(r.nextAt))}${r.needsOk ? ' · espera pelo teu OK' : ' · só leitura'}`);
    spawnEmote(R[a.id], '⏱'); feedPush(R[a.id], '⏱', `Nova rotina: ${r.title} (${r.desc})`); filter = 'sched'; render(true); P_.input.blur(); setTimeout(updateHint, 5000);
  }
  function guessOk(text) { const t = text.toLowerCase(); return /\b(send|reply|chase|nudge|remind|post|publish|pay|book|draft|message|email)\b/.test(t) || !/\b(list|summari[sz]e|triage|tell me|what|report|match|reconcile|qualify|review|check|read|find|flag|count)\b/.test(t); }
  function addRoutine(k, agentId, text, when, needsOk) { // demo: session-only
    const title = (text.charAt(0).toUpperCase() + text.slice(1)).replace(/[.!]+$/, '').slice(0, 90);
    const r = { id: 'r' + rseq++, dept: k, agent: agentId, title, text, when, desc: describe(when), needsOk: !!needsOk, paused: false, nextAt: nextRun(when), lastAt: null, runs: 0, live: false };
    routines.push(r); syncPills(); dirty = true; if (railAgent === agentId) railFor(agentId);
    return r;
  }
  function setRoutines(list) { routines.length = 0; for (const r of list) routines.push({ ...r, live: true }); syncPills(); dirty = true; if (railAgent) railFor(railAgent); }
  function fireDemo(r, manual) {
    // Sem servidor não há tarefa para criar: a rotina só existe na sessão, e o trabalho tem de vir
    // da base de dados. Diz-se isso em vez de fabricar um cartão que ninguém pediu.
    say(`Sem servidor ligado, <b>${esc(r.title)}</b> não cria trabalho — liga o Órbita para a rotina correr.`, 'err');
    spawnEmote(R[r.agent], '⏱');
    feedPush(R[r.agent], '⏱', `Rotina ${manual ? '(executar agora)' : ''}sem servidor: ${r.title}`);
    if (manual) { r.lastAt = Date.now(); r.runs++; r.nextAt = nextRun(r.when); }
    syncPills(); dirty = true; if (railAgent === r.agent) railFor(r.agent);
    return null;
  }
  async function rtAct(rid, act) { // RUN NOW · PAUSAR · RETOMAR · DELETE — from a SCHEDULED row, a board card or the rail strip
    const r = routines.find(x => x.id === rid); if (!r) return;
    if (live) {
      if (act === 'delete') await fetch(`${API}/routines/${rid}`, { method: 'APAGAR' }).catch(() => {});
      else { const j = await post(`/routines/${rid}/${act}`); if (act === 'run' && j && j.task) reconcile(j.task); }
      if (act === 'run') { spawnEmote(R[r.agent], '⏱'); feedPush(R[r.agent], '⏱', `Executar agora: ${r.title}`); }
      await poll(); return;
    }
    if (act === 'delete') routines.splice(routines.indexOf(r), 1);
    else if (act === 'pause') { r.paused = true; r.nextAt = null; }
    else if (act === 'resume') { r.paused = false; r.nextAt = nextRun(r.when); }
    else if (act === 'run') fireDemo(r, true);
    syncPills(); dirty = true; if (railAgent) railFor(railAgent);
  }
  const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json()).catch(e => { console.warn('office:', e.message); return null; });
  function syncPills() { // C2: the clock chip on the desk
    for (const id in R) {
      const n = agentRoutines(id).length, pill = R[id].pill; let s = pill.querySelector('.rt');
      if (!n) { if (s) s.remove(); continue; }
      if (!s) { s = document.createElement('span'); s.className = 'rt'; pill.appendChild(s); }
      s.textContent = '⏱ ' + n;
    }
  }
  function railFor(id) { // C2: the ROUTINES strip in the agent's rail — click to open, RUN NOW / PAUSAR / DELETE per routine
    railAgent = id;
    const el = document.getElementById('mRt'); if (!el) return;
    const mine = agentRoutines(id).sort(byNext);
    el.hidden = !mine.length; if (!mine.length) { el.innerHTML = ''; return; }
    const n = nextOf(mine);
    el.className = 'mrt' + (railExp ? ' exp' : '');
    el.innerHTML = `<div class="mrt-h"><span>⏱ ${mine.length} routine${mine.length > 1 ? 's' : ''}${n ? ' · next <b>' + esc(untilText(n.nextAt)) + '</b>' : ' · all paused'}</span><span class="car">▸</span></div>
      <div class="mrt-l">${mine.map(r => `<div class="mrt-r" data-rid="${r.id}"><span>${esc(r.title)}</span><small>${esc(r.desc)} · ${modelName(r.model || officeModel)} · ${r.paused ? 'paused' : 'next ' + esc(untilText(r.nextAt))} · ${r.needsOk ? 'espera pelo teu OK' : 'só leitura'}</small>
        <div class="tp-act"><button class="run" data-act="run">EXECUTAR AGORA</button><button data-act="${r.paused ? 'resume' : 'pause'}">${r.paused ? 'RETOMAR' : 'PAUSAR'}</button><button data-act="delete">APAGAR</button></div></div>`).join('')}</div>`;
    el.querySelector('.mrt-h').addEventListener('click', () => { railExp = !railExp; el.classList.toggle('exp', railExp); });
    el.querySelectorAll('.tp-act button').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); rtAct(b.closest('[data-rid]').dataset.rid, b.dataset.act); }));
  }
  /* ---------- V3.5 live: the page keeps up with a server that runs things on its own ---------- */
  let pollN = 0, usageDue = true;
  async function pollUsage(force) { // V3.6: the plan's gauge — every 30 s, and after every run
    try { const u = await fetch(API + '/usage' + (force ? '?refresh=1' : '')).then(r => r.json()); if (onUsage) onUsage(u); } catch {}
  }
  async function poll() {
    if (!live || polling) return; polling = true;
    if (usageDue || ++pollN % 5 === 0) { usageDue = false; pollUsage(); }
    try {
      const [rl, tl] = await Promise.all([fetch(API + '/routines').then(r => r.json()), fetch(API + '/tasks').then(r => r.json())]);
      if (Array.isArray(rl.routines)) setRoutines(rl.routines);
      if (Array.isArray(tl)) for (const st of tl) reconcile(st);
      if (calendar) calendar.refresh();
    } catch (e) { console.warn('consulta ao escritório:', e.message); }
    polling = false;
  }
  function reconcile(st) { // a server task the page did not start (a routine firing, a catch-up, an approval finishing) → the same cards, the same moves
    if (!agentOf(st.agent)) return;
    let t = tasks.find(x => x.live && x.sid === st.id);
    if (!t) {
      t = mk({ agent: st.agent, title: st.title, text: st.text, plan: st.plan, by: st.by === 'routine' ? 'routine' : 'you', live: true, srv: !!st.routine, sid: st.id,
        routine: st.routine, when: st.when, late: !!st.late, due: st.due, needsOk: !!st.needsOk, addedAt: st.addedAt, changedAt: st.addedAt, last: 'added',
        model: st.model, modelUsed: st.modelUsed || st.model || undefined, modelFrom: st.modelFrom || (st.model ? 'task' : undefined), effort: st.effort, effortUsed: st.effortUsed, effortFrom: st.effortFrom });
      if (st.state === 'scheduled') { t.state = 'scheduled'; t.dueAt = st.dueAt; t.needsOk = !!st.needsOk; }
      else if (st.state !== 'done') { spawnEmote(R[t.agent], st.routine ? '⏱' : st.dueAt ? '⏱' : '📋'); if (st.routine) feedPush(R[t.agent], '⏱', `Routine fired: ${t.title}${t.late ? ' (atrasada — era para ' + timeStr(t.due) + ')' : ''}`); else if (st.dueAt) feedPush(R[t.agent], '⏱', `Tarefa agendada disparou: ${t.title}`); }
      touch(t, 'added');
    }
    apply(t, st);
  }
  function copyResult(t, st) { t.result = st.result; t.error = !!st.error; t.read = st.read || []; t.note = st.note; t.tools = st.tools || []; t.used = st.used || []; t.draft = st.draft; t.approved = !!st.approved; if (st.modelUsed) { t.modelUsed = st.modelUsed; t.modelFrom = st.modelFrom; t.effortUsed = st.effortUsed || ''; t.effortFrom = st.effortFrom; } }
  // V3.2 (16 Sep): the server's team state → piece cards on the teammates' desks, notes as 💬, the lead's members list
  const seenNotes = new Set();
  function syncTeam(t, st, quiet) {
    const tm = st.team; if (!tm) return;
    const pieces = tm.pieces || [];
    t.team = { lead: tm.lead, members: pieces.map(p => p.agent).filter(id => id !== tm.lead), why: tm.why };
    for (const p of pieces) {
      if (!agentOf(p.agent)) continue;
      const sid = `${st.id}:${p.agent}`;
      let c = tasks.find(x => x.live && x.sid === sid);
      if (!c) {
        c = mk({ agent: p.agent, title: p.title, text: p.text, by: 'team', live: true, srv: true, sid, piece: true, parent: t.id, leadId: tm.lead, from: tm.lead, addedAt: tm.plannedAt || Date.now(), changedAt: tm.plannedAt || Date.now(), last: 'handoff', running: true });
        if (!quiet) { spawnEmote(R[p.agent], '📋'); feedPush(R[p.agent], '📋', `Parte da equipa de ${agentOf(tm.lead).name}: ${p.title}`); }
        touch(c, 'handoff');
      }
      if (p.state === 'doing' && c.state !== 'doing') { c.state = 'doing'; c.startedAt = performance.now() - Math.max(0, Date.now() - (p.startedAt || Date.now())); c.progress = 0; c.running = true; c.ready = false; c.changedAt = p.startedAt || Date.now(); touch(c, 'started'); }
      else if (p.state === 'done' && c.state !== 'done') {
        c.result = p.result; c.error = !!p.error; c.tools = p.tools || []; c.used = p.used || []; c.read = p.read || []; c.ready = true; c.running = true;
        if (quiet) { c.state = 'done'; c.doneAt = p.doneAt || Date.now(); c.changedAt = c.doneAt; c.progress = 1; c.last = 'done'; }
        else { complete(c); c.doneAt = p.doneAt || c.doneAt; c.changedAt = c.doneAt; if (c.tools.length && onTools) onTools(c.agent, c.tools); }
      }
    }
    for (const m of tm.messages || []) { // a note one teammate left another (or the lead)
      const key = `${st.id}:${m.from}:${m.to}:${m.at}`; if (seenNotes.has(key)) continue; seenNotes.add(key);
      if (quiet) continue;
      const to = m.to === 'lead' ? tm.lead : m.to, toName = agentOf(to)?.name || m.to;
      if (R[m.from]) { spawnEmote(R[m.from], '💬'); feedPush(R[m.from], '💬', `Nota para ${toName}: ${m.text}`); chatPush(m.from, { who: 'work', i: '💬', text: `nota para ${toName}: ${m.text}` }); }
      if (R[to]) { feedPush(R[to], '📨', `Nota de ${agentOf(m.from)?.name || m.from}: ${m.text}`); chatPush(to, { who: 'work', i: '📨', text: `nota de ${agentOf(m.from)?.name || m.from}: ${m.text}` }); }
    }
  }
  function apply(t, st) {
    if (st.team) syncTeam(t, st);
    if (st.state === 'scheduled') { if (t.state !== 'scheduled') { t.state = 'scheduled'; t.dueAt = st.dueAt; touch(t, 'scheduled'); } else if (t.dueAt !== st.dueAt) { t.dueAt = st.dueAt; dirty = true; } return; }
    if (t.state === 'scheduled' && st.state !== 'scheduled') { t.state = 'next'; t.addedAt = st.addedAt || Date.now(); t.late = !!st.late; t.due = st.due; touch(t, 'added'); spawnEmote(R[t.agent], '⏱'); feedPush(R[t.agent], '⏱', `Tarefa agendada disparou: ${t.title}${t.late ? ' (atrasada)' : ''}`); if (calendar) calendar.refresh(); }
    if (st.state === 'doing' && t.state !== 'doing') {
      t.state = 'doing'; t.startedAt = performance.now() - Math.max(0, Date.now() - (st.startedAt || Date.now())); t.progress = 0; t.pausedAt = null; t.running = true; t.ready = false; t.srv = true; t.changedAt = st.startedAt || Date.now(); touch(t, 'started');
    } else if (st.state === 'waiting' && t.draftAt !== st.waitingAt) { // a new draft is waiting for the OK (the first, or a rework after REJECT)
      copyResult(t, st); t.state = 'waiting'; t.draftAt = st.waitingAt; t.ask = st.ask; t.changedAt = st.waitingAt || Date.now(); t.running = true; touch(t, 'waiting');
      askApproval(t);
    } else if (st.state === 'done' && t.state !== 'done') {
      copyResult(t, st); t.ready = true; t.running = true; usageDue = true;
      complete(t); t.doneAt = st.doneAt || t.doneAt; t.changedAt = t.doneAt; // straight to done here (the tick skips a stuck agent): the chat card, the note, the graph
      if (t.tools.length && onTools) onTools(t.agent, t.tools);
      if (brain && !t.error) fetch(API + '/brain').then(r => r.json()).then(g => brain.setGraph(g)).catch(() => {});
    }
  }
  function askApproval(t) { // D1: the draft lands in the chat with APPROVE / REJECT and the agent stands and waves
    chatPush(t.agent, { who: 'file', icon: '📝', name: slug(t.title) + '.md', meta: `draft · à espera do teu OK · ${timeStr(t.changedAt)} · clica para ver`, content: t.draft || t.result });
    chatPush(t.agent, { who: 'appr', text: t.ask || `«${t.title}» está pronto — aprova para enviar, rejeita para me dizeres o que mudar.`, pending: true, live: true });
    feedPush(R[t.agent], '⏸', `À espera do teu OK: ${t.title}`);
    if (setStuck) setStuck(t.agent, t.ask, t.sid);
  }
  const pendingFeedback = {}; // agentId → sid after REJECT: the owner's next chat line is the note
  function resolveLive(agentId, approved) { // APPROVE / REJECT on a live draft (main.js calls this instead of the demo onResolve)
    const t = tasks.find(x => x.live && x.agent === agentId && x.state === 'waiting'); if (!t) return false;
    if (approved) { post(`/tasks/${t.sid}/approve`); toDoing(t); chatPush(agentId, { who: 'agent', text: '✓ Aprovado — a enviar agora. Aparece aqui quando terminar.' }); }
    else { pendingFeedback[agentId] = t.sid; chatPush(agentId, { who: 'agent', text: 'Entendido. O que deve mudar? Diz-me aqui e refaço — volta para o teu OK.' }); }
    return true;
  }
  const pendingReject = agentId => !!pendingFeedback[agentId];
  function rejectLive(agentId, feedback) {
    const sid = pendingFeedback[agentId]; delete pendingFeedback[agentId];
    const t = tasks.find(x => x.live && x.sid === sid); if (!t) return false;
    post(`/tasks/${sid}/reject`, { feedback }); toDoing(t); chatPush(agentId, { who: 'agent', text: 'Já vou — a refazer com a tua nota. Volta aqui para o teu OK.' });
    return true;
  }
  function toDoing(t) { t.state = 'doing'; t.startedAt = performance.now(); t.progress = 0; t.pausedAt = null; t.running = true; t.ready = false; t.srv = true; touch(t, 'started'); }
  // LIVE: the agent picks the task up → Claude does it on the server → the result lands in the chat
  async function runLive(t, feedback) {
    t.running = true; t.ready = false;
    try {
      const r = await fetch(`${API}/tasks/${t.sid}/${feedback ? 'revise' : 'run'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(feedback ? { feedback } : {}) });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const st = await r.json();
      t.result = st.result; t.error = !!st.error; t.read = st.read || []; t.note = st.note; t.tools = st.tools || []; t.used = st.used || []; if (st.modelUsed) { t.modelUsed = st.modelUsed; t.modelFrom = st.modelFrom; t.effortUsed = st.effortUsed || ''; t.effortFrom = st.effortFrom; }
      usageDue = true;
      if (t.tools.length && onTools) onTools(t.agent, t.tools); // the connectors the agent really pulled on light up
      if (brain && !t.error) fetch(API + '/brain').then(r => r.json()).then(g => brain.setGraph(g)).catch(() => {}); // the new note joins the graph
    } catch (e) { t.result = 'Não foi possível concluir esta tarefa: ' + e.message; t.error = true; }
    t.ready = true;
  }
  function revise(agentId, feedback) { // "revise: …" in chat re-runs that agent's last live deliverable
    const t = [...tasks].reverse().find(x => x.live && x.agent === agentId && x.state === 'done' && !x.error);
    if (!t) return false;
    t.state = 'doing'; t.startedAt = performance.now(); t.progress = 0; t.pausedAt = null; touch(t, 'started');
    runLive(t, feedback);
    return true;
  }
  async function connect() {
    if (!location.protocol.startsWith('http')) return;
    try {
      const h = await (await fetch(API + '/health')).json();
      if (!h.ok) return;
      live = true; setOfficeModel(h.model); setOfficeEffort(h.effort);
      if (h.teams) { teamsCfg = { enabled: h.teams.enabled !== false, max: h.teams.max || 4 }; P_.team.hidden = !teamsCfg.enabled; }
      const mode = panel.querySelector('.tp-mode');
      // o selo diz o motor que está mesmo a responder — e se não houver nenhum, diz isso
      if (mode) {
        const a = h.ai || null;
        const name = a ? String(a.label || a.id).toUpperCase() : 'SEM MOTOR';
        mode.hidden = false;
        mode.textContent = a ? 'AO VIVO · ' + name : 'SEM MOTOR DE IA';
        mode.classList.toggle('live', !!a);
        mode.classList.toggle('off', !a);
        mode.title = a
          ? `${h.name} · ${a.label} (${a.id})${a.tools ? ' · com ferramentas' : ' · só texto'} · ${modelName(h.model)} por omissão · brain: ${h.brain}`
          : `${h.name} · nenhum motor de IA disponível nesta máquina — vê o painel de motores (AI.md)`;
      }
      if (brain) { try { brain.setGraph(await (await fetch(API + '/brain')).json()); } catch {} }
      const list = await (await fetch(API + '/tasks')).json();
      for (const st of list) {
        if (!agentOf(st.agent)) continue;
        if (st.state === 'done') {
          const t = mk({ agent: st.agent, title: st.title, text: st.text, plan: st.plan, by: 'you', live: true, sid: st.id, state: 'done',
            doneAt: st.doneAt, changedAt: st.doneAt, addedAt: st.addedAt, result: st.result, read: st.read, note: st.note, tools: st.tools || [], used: st.used || [], error: !!st.error, last: 'done' });
          if (st.team) syncTeam(t, st, true);
          deliver(t);
        } else reconcile(st); // next, doing (the server may be running it), à espera do teu OK, scheduled for a date — pick it up again
      }
      dirty = true;
      if (onLive) onLive(h);
      await poll(); setInterval(poll, 6000); // V3.5: routines fire on the server's clock — the page keeps up
    } catch (e) { console.warn('servidor do escritório inacessível — a correr offline:', e.message); }
  }
  connect();
  // chips: filters with live counts
  const CHIPS = [['all', 'All'], ['sched', 'Scheduled'], ['next', 'Backlog'], ['doing', 'em curso'], ['waiting', 'Waiting'], ['done', 'Done']];
  function chipsHTML() {
    const scope = scoped();
    const cnt = st => st === 'all' ? scope.length : st === 'sched' ? scopedRoutines().length + scope.filter(t => t.state === 'scheduled').length : scope.filter(t => t.state === st).length;
    return CHIPS.map(([st, lab]) => `<button class="tp-chip${filter === st ? ' on' : ''}${st === 'waiting' ? ' w' : ''}" data-f="${st}">${lab}<b>${cnt(st)}</b></button>`).join('');
  }
  P_.chips.addEventListener('click', (e) => { const b = e.target.closest('.tp-chip'); if (!b) return; filter = b.dataset.f; render(true); });
  function scoped() {
    const f = getFocused();
    return (f && f !== 'brain') ? tasks.filter(t => t.dept === f) : tasks;
  }
  function scopedRoutines() { const f = getFocused(); return (f && f !== 'brain') ? deptRoutines(f) : routines.slice(); }
  function metaFor(t) {
    const a = agentOf(t.agent), now = Date.now();
    const f = getFocused();
    const who = (f && f !== 'brain') ? a.name : `${a.name} · ${DEPTS[t.dept].short}`;
    switch (t.state) {
      case 'next': {
        const src = t.piece ? `parte da equipa de ${agentOf(t.leadId)?.name || 'o líder'}` : t.routine ? `rotina · ${t.when}${t.late ? ' · <span class="tp-late">atrasada · era devida a ' + timeStr(t.due) + '</span>' : ''}` : t.by === 'you' ? (t.live ? 'adicionado por ti · em direto' : 'adicionada por ti') : t.last === 'handoff' && t.from ? `de ${agentOf(t.from).name}` : t.revised ? 'devolvida para revisão' : 'a partir do Cérebro';
        const w = now - t.addedAt;
        return `${who} · ${w < 60000 ? 'just added' : 'waiting ' + span(w)} · ${src}${teamBit(t)}${modelBit(t)}`;
      }
      case 'doing': return `${who}${t.live ? (t.approved === undefined && t.draftAt ? ' · a enviar com Claude' : t.team?.members?.length ? ' · a liderar a equipa com Claude' : ' · a trabalhar com Claude') : t.agent === 'vid' ? ' · rendering' : t.teamHold ? ' · à espera das partes' : ''}${t.routine ? ' · routine' : ''}${teamBit(t)}${modelBit(t)}`;
      case 'waiting': return `<span class="tp-amber">à espera há ${span(now - t.changedAt)} do teu OK</span> · ${who}${t.routine ? ' · rascunho de rotina' : ''}${teamBit(t)}${modelBit(t)}`;
      case 'scheduled': return `${who} · corre ${esc(untilText(t.dueAt))} · ${fmtDate(t.dueAt, { weekday: 'short' })} ${timeStr(t.dueAt)}${t.needsOk ? ' · espera pelo teu OK' : ''}${teamBit(t)}${modelBit(t)}`;
      case 'done': return `${who} · concluída ${timeStr(t.doneAt)}${t.approved ? (t.live ? ' · enviado após o teu OK' : ' · aprovado') : ''}${t.late ? ' · <span class="tp-late">atrasada</span>' : ''}${teamBit(t)}${modelBit(t)}${t.live ? (t.error ? ' · <span class="tp-amber">falhou</span>' : ' · <span class="tp-res">resultado pronto →</span>') : ''}`;
    }
    return who;
  }
  function rowHTMLp(t) {
    // 26 out 2026: não há percentagem. Uma tarefa está num estado e tem uma hora de início; o resto
    // seria um número escolhido por nós, e o painel não inventa números.
    const chip = `<span class="tp-st ${t.state}">${t.state === 'scheduled' ? '◷' : STATE_LABEL[t.state]}</span>`;
    const bar = t.state === 'doing' ? `<div class="tp-bar run"><i></i></div>` : t.state === 'scheduled' ? `<div class="tp-act"><button data-act="cancel">CANCELAR</button><button data-act="calendar">CALENDÁRIO</button></div>` : '';
    return `<div class="tp-row ${t.state}${t.last === 'handoff' ? ' handoff' : ''}${t.live ? ' live' : ''}${t.piece ? ' piece' : ''}" data-id="${t.id}" data-dept="${t.dept}" data-agent="${t.agent}">
      ${chip}<div class="tp-body"><div class="tp-t">${t.routine || t.state === 'scheduled' ? '⏱ ' : ''}${t.team?.members?.length ? '⚑ ' : ''}${esc(t.title)}</div><div class="tp-m">${metaFor(t)}</div>${bar}</div>
      <span class="tp-ago" data-ago="${t.id}">${span(Date.now() - t.changedAt)}</span></div>`;
  }
  function rowHTMLr(r) { // a SCHEDULED row: the routine itself, with its countdown and its buttons
    const a = agentOf(r.agent);
    return `<div class="tp-row sched${r.paused ? ' paused' : ''}" data-id="r:${r.id}" data-rid="${r.id}" data-dept="${r.dept}" data-agent="${r.agent}">
      <span class="tp-st sched">⏱</span>
      <div class="tp-body"><div class="tp-t">${esc(r.title)}</div><div class="tp-m">${esc(r.desc)} · ${a.name} · ${modelName(r.model || officeModel)}${r.needsOk ? ' · espera pelo teu OK' : ' · só leitura'}${r.lastAt ? ' · last ' + timeStr(r.lastAt) + (r.lastLate ? ' <span class="tp-late">late</span>' : '') : ''}</div>
      <div class="tp-act"><button class="run" data-act="run">EXECUTAR AGORA</button><button data-act="${r.paused ? 'resume' : 'pause'}">${r.paused ? 'RETOMAR' : 'PAUSAR'}</button><button data-act="delete">APAGAR</button></div></div>
      <span class="tp-ago" data-rago="${r.id}">${r.paused ? 'PAUSARD' : esc(untilText(r.nextAt))}</span></div>`;
  }
  function renderNext() { // C1: the next-up strip under the chips
    const n = nextOf(scopedRoutines());
    P_.next.hidden = !n;
    if (n) P_.next.innerHTML = `<span class="lab">NEXT ⏱</span><span class="nx">${esc(untilText(n.nextAt))}</span><span class="tt">${esc(n.title)} · ${agentOf(n.agent).name}</span>`;
  }
  function rects() {
    const m = {};
    P_.rows.querySelectorAll('.tp-row').forEach(n => { m[n.dataset.id] = n.getBoundingClientRect(); });
    return m;
  }
  function flip(before) {
    P_.rows.querySelectorAll('.tp-row').forEach(n => {
      const b = before[n.dataset.id];
      if (!b) { n.classList.add('tp-new'); return; }
      const a = n.getBoundingClientRect();
      const dy = b.top - a.top;
      if (Math.abs(dy) < 1) return;
      n.style.transition = 'none'; n.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { n.style.transition = 'transform .65s var(--ease)'; n.style.transform = ''; }));
    });
  }
  function render(structural) {
    const f = getFocused();
    P_.scope.textContent = (f && f !== 'brain') ? DEPTS[f].name : 'TODO O ESCRITÓRIO';
    P_.chips.innerHTML = chipsHTML();
    const list = scoped().filter(t => filter === 'all' || t.state === filter)
      .sort((a, b) => b.changedAt - a.changedAt).slice(0, 60);
    const before = structural ? {} : rects();
    P_.rows.innerHTML = filter === 'sched'
      ? ((scopedRoutines().sort(byNext).map(rowHTMLr).join('') + scoped().filter(t => t.state === 'scheduled').sort((a, b) => a.dueAt - b.dueAt).map(rowHTMLp).join('')) || `<div class="tp-empty">Ainda não há rotinas. Escreve uma com uma hora dentro — «todos os dias úteis às 8h, …» — ou prime REPETIR. Prime <b>P</b> para o calendário agendar uma tarefa numa data.${RT_DEPTS.includes(dept) ? '' : ' Rotinas: E-mails, Contabilidade e Vendas nesta versão.'}</div>`)
      : (list.map(rowHTMLp).join('') || `<div class="tp-empty">Nada aqui neste momento.</div>`);
    renderNext();
    P_.rows.querySelectorAll('.tp-act button').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const row = b.closest('.tp-row'); if (row.dataset.rid) rtAct(row.dataset.rid, b.dataset.act); else if (b.dataset.act === 'cancel') cancelScheduled(tasks.find(t => String(t.id) === row.dataset.id)); else if (b.dataset.act === 'calendar' && calendar) calendar.open(); }));
    P_.rows.querySelectorAll('.tp-row.waiting').forEach(n => n.addEventListener('click', () => zoomToApproval(n.dataset.dept)));
    P_.rows.querySelectorAll('.tp-row.live.done').forEach(n => n.addEventListener('click', () => openAgent && openAgent(n.dataset.agent, 'chat')));
    if (!structural) flip(before);
  }
  function refreshAgo() {
    const now = Date.now();
    for (const t of tasks) {
      const el = P_.rows.querySelector(`[data-ago="${t.id}"]`);
      if (el) el.textContent = span(now - t.changedAt);
    }
    for (const r of routines) { const el = P_.rows.querySelector(`[data-rago="${r.id}"]`); if (el) el.textContent = r.paused ? 'PAUSARD' : untilText(r.nextAt, now); }
    renderNext();
    // waiting / backlog metas carry a duration too — cheap to re-render those lines
    P_.rows.querySelectorAll('.tp-row.waiting .tp-m, .tp-row.next .tp-m').forEach(m => {
      const t = tasks.find(x => x.id === +m.closest('.tp-row').dataset.id);
      if (t) m.innerHTML = metaFor(t);
    });
  }
  setDept('marketing');
  render(true);

  /* ---------- the company board (B) ---------- */
  const el = document.createElement('div'); el.id = 'board'; document.body.appendChild(el);
  const dim = document.createElement('div'); dim.id = 'boardDim'; document.body.appendChild(dim);
  dim.addEventListener('click', close);
  function cardHTML(t) {
    const a = agentOf(t.agent), chip = DEPTS[t.dept].chip;
    const av = `<span class="tk-av" style="border-color:${chip};background:${chip}55">${a.name[0]}</span>`;
    let meta;
    if (t.state === 'done') meta = `<span class="tk-tick">✓</span><span>${a.name}</span><span class="tk-pct">${t.approved ? 'APROVADO · ' : ''}${t.modelUsed ? modelName(t.modelUsed).toUpperCase() + ' · ' : ''}${timeStr(t.doneAt)}</span>`;
    else if (t.state === 'waiting') meta = `${av}<span>${a.name}</span><span class="tk-chip">WAITING ${span(Date.now() - t.changedAt).toUpperCase()}</span>`;
    else if (t.state === 'doing') meta = `${av}<span>${a.name}</span><span class="tk-pct">EM CURSO · ${span(Date.now() - (t.startedAt || t.changedAt)).toUpperCase()}</span>`;
    else if (t.state === 'scheduled') meta = `${av}<span>${a.name}</span><span class="tk-pct">${esc(untilText(t.dueAt).toUpperCase())}</span>`;
    else meta = `${av}<span>${a.name}</span><span class="tk-pct">${span(Date.now() - t.addedAt).toUpperCase()} NA FILA</span>`;
    return `<div class="tk ${t.state === 'scheduled' ? 'sched scheduled' : t.state}${t.revised ? ' rev' : ''}" data-id="${t.id}" data-dept="${t.dept}">
      <div class="tk-t">${t.routine || t.state === 'scheduled' ? '⏱ ' : ''}${t.team?.members?.length ? '⚑ ' : t.piece ? '↳ ' : ''}${esc(t.title)}</div><div class="tk-m">${meta}</div>
      ${t.state === 'doing' ? `<div class="tk-bar run"><i></i></div>` : ''}</div>`;
  }
  const byState = (k, st) => {
    const l = deptTasks(k, st);
    if (st === 'doing') l.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    else if (st === 'done') l.sort((a, b) => b.doneAt - a.doneAt);
    else l.sort((a, b) => a.id - b.id);
    return l;
  };
  function cardHTMLr(r) { // C1: a SCHEDULED card on the company board
    const a = agentOf(r.agent), chip = DEPTS[r.dept].chip;
    return `<div class="tk sched${r.paused ? ' paused' : ''}" data-rid="${r.id}" data-dept="${r.dept}"><div class="tk-t">⏱ ${esc(r.title)}</div>
      <div class="tk-m"><span class="tk-av" style="border-color:${chip};background:${chip}55">${a.name[0]}</span><span>${a.name} · ${modelName(r.model || officeModel).toUpperCase()}</span><span class="tk-pct">${r.paused ? 'PAUSARD' : esc(untilText(r.nextAt).toUpperCase())}</span></div></div>`;
  }
  const COLS = [['sched', 'SCHEDULED'], ['next', 'EM ESPERA'], ['doing', 'EM CURSO'], ['waiting', 'À ESPERA DE APROVAÇÃO'], ['done', 'CONCLUÍDO']];
  function companyHTML() {
    const tot = st => DEPT_KEYS.reduce((s, k) => s + deptTasks(k, st).length, 0);
    const doneAll = DEPT_KEYS.reduce((s, k) => s + doneCount[k], 0);
    return `<div class="bd-head">
        <span class="b-name"><span class="bd-title">Órbita</span>Quadro de hoje</span>
        <span class="bd-stats"><span>AGENDADAS<b>${routines.length + tot('scheduled')}</b></span><span>EM CURSO<b>${tot('doing')}</b></span><span>EM ESPERA<b>${tot('next')}</b></span><span>EM APROVAÇÃO<b>${tot('waiting')}</b></span><span>CONCLUÍDO<b>${doneAll}</b></span></span></div>
      <div class="bd-lanes"><div class="lh"></div>${COLS.map(([, lab]) => `<div class="lh">${lab}</div>`).join('')}
      ${DEPT_KEYS.map(k => {
        const d = DEPTS[k], n = AGENTS.filter(a => a.dept === k).length;
        return `<div class="ld"><span><span class="dot" style="background:${d.chip}"></span>${d.short}</span><b>${n} agents</b></div>` +
          COLS.map(([st]) => {
            const list = st === 'sched' ? [...deptRoutines(k).sort(byNext), ...byState(k, 'scheduled').sort((a, b) => a.dueAt - b.dueAt)] : byState(k, st), show = list.slice(0, 2);
            return `<div class="lc">${show.map(x => x.state ? cardHTML(x) : cardHTMLr(x)).join('')}${list.length > 2 ? `<div class="more">+${list.length - 2} mais</div>` : ''}</div>`;
          }).join('');
      }).join('')}</div>`;
  }
  function renderBoard() {
    if (!board.open) return;
    el.innerHTML = companyHTML();
    el.querySelectorAll('.tk.waiting').forEach(n => n.addEventListener('click', () => { close(); zoomToApproval(n.dataset.dept); }));
    el.querySelectorAll('.tk.sched').forEach(n => n.addEventListener('click', () => { close(); filter = 'sched'; openFor(n.dataset.dept); render(true); }));
  }
  function open() {
    board.open = true;
    el.className = 'company';
    renderBoard();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!board.open) return; el.classList.add('on'); dim.classList.add('on'); })); // a close before this frame must win, or the board sits open with nothing to close it
  }
  function close() { if (!board.open) return; board.open = false; el.classList.remove('on'); dim.classList.remove('on'); }
  function toggle() { board.open ? close() : open(); }
  const isOpen = () => board.open;
  const boardWidth = () => 0; // the dept-side board is retired — the panel is the department view
  function openFor(k) { if (getFocused() !== k) enterFocus(k); }
  function onFocusChange(k) { if (board.open) close(); if (k && k !== 'brain') setDept(k); render(true); }

  /* ---------- approvals feed the WAITING state ---------- */
  function onStuck(id, ask) {
    const d = agentTasks(id, 'doing')[0];
    if (d) d.pausedAt = performance.now();
    const w = mk({ agent: id, title: ask, state: 'waiting', isAsk: true });
    touch(w, 'waiting');
  }
  function onResolve(id, approved) {
    const d = agentTasks(id, 'doing')[0];
    if (d && d.pausedAt) { d.startedAt += performance.now() - d.pausedAt; d.pausedAt = null; }
    const w = tasks.find(t => t.agent === id && t.state === 'waiting');
    if (w) {
      if (approved) { w.state = 'done'; w.approved = true; w.doneAt = Date.now(); doneCount[w.dept]++; touch(w, 'done'); prune(w.dept); }
      else { w.state = 'next'; w.revised = true; w.addedAt = Date.now(); touch(w, 'added'); }
    }
  }

  /* ---------- chat intake still works: "adicionar tarefa: …" in any agent's rail ---------- */
  function handleChat(agentId, text) {
    if (!live) { // demo: "todos os dias úteis às 8h, …" · "routines" (live: the server handles these, so fall through)
      const k0 = R[agentId].a.dept, a0 = R[agentId].a;
      if (/^\s*(routines?|schedule|timetable)\s*\??\s*$/i.test(text)) {
        if (!RT_DEPTS.includes(k0)) return rtRefuse(k0);
        const mine = deptRoutines(k0).sort(byNext);
        return mine.length ? `${RT_NAMES[k0]} routines:\n` + mine.map(r => `• ${r.title} — ${r.desc} · ${agentOf(r.agent).name}${r.paused ? ' · PAUSARD' : ''}`).join('\n') : `Ainda nada no horário de ${RT_NAMES[k0]}. Dá-me uma com uma hora dentro — «todos os dias úteis às 8h, …».`;
      }
      const p = parseWhen(text);
      if (p) {
        if (!RT_DEPTS.includes(k0)) return rtRefuse(k0);
        if (p.needsDay) return 'Que dia? Diz outra vez com o dia: "todas as segundas às 9h, …".';
        if (p.needsTime) return 'Que horas? Diz outra vez com a hora, p. ex. "todos os dias úteis às 8h, …".';
        if (!p.text) return 'Tenho a hora mas não a tarefa. Diz outra vez com o que deve acontecer.';
        const to = a0.lead ? route(k0, p.text).agent.id : agentId;
        const r = addRoutine(k0, to, p.text, p.when, guessOk(p.text));
        return `Pronto. ${r.desc.charAt(0).toUpperCase() + r.desc.slice(1)}, ${to === agentId ? 'Já tenho' : agentOf(to).name + ' ficou com ela'}. ${r.needsOk ? 'Tudo o que sai espera pelo teu OK primeiro.' : 'Só lê, por isso não fica à tua espera.'} Próxima execução ${untilText(r.nextAt)}. Say "routines" para veres a lista.`;
      }
    }
    const k = R[agentId].a.dept;
    if (/^\s*(?:add\s+(?:a\s+)?(?:new\s+)?task|new\s+task|task|todo)\s*[:\-–—]/i.test(text)) {
      // não há atalho: uma tarefa nasce na base de dados, pela barra ou pela operação
      return 'Escreve-a na barra TAREFAS à direita: é o servidor que a cria, a atribui e a corre. Nada aqui é criado só no ecrã.';
    }
    if (/\b(board|what'?s next|next up|what are (you|we) (all )?(doing|working))\b/i.test(text)) {
      const list = st => byState(k, st).slice(0, 3).map(t => `• ${t.title} (${agentOf(t.agent).name})`).join('\n');
      const doing = list('doing'), next = list('next'), waiting = list('waiting');
      return `${DEPTS[k].name} neste momento:\n\nEM CURSO\n${doing || '—'}\n\nEM ESPERA\n${next || '—'}` +
        (waiting ? `\n\nÀ TUA ESPERA\n${waiting}` : '') + `\n\nConcluídas hoje: ${doneCount[k]}. Diz «adicionar tarefa: …» para pôr algo na lista.`;
    }
    return null;
  }

  /* ---------- per-frame: só desenha o que a base de dados disse (nada de progresso inventado) ---------- */
  function tick(now) {
    if (live && now - lastOps > 4000) { lastOps = now; loadOps(); }
    for (const id in R) {
      const r = R[id];
      const d = agentTasks(id, 'doing')[0];
      if (d && d.live && !d.running) runLive(d);           // trabalho real do motor de IA
      if (d && d.live && d.ready) { d.progress = 1; complete(d); }
    }
    if (now - lastBadge > 400) { syncBadges(); lastBadge = now; }
    if (dirty) { render(false); renderBoard(); dirty = false; }
    else if (now - lastAgo > 15000) { refreshAgo(); lastAgo = now; }
  }

  /* ---------- V3.2.1 (16 Sep 2026): the CALENDAR (P) — tasks and routines on their days; click a day to schedule ---------- */
  async function createScheduled({ dept: k, text, at, model }) { // a task for a date: live → the server routes it now and runs it then; demo → session-only
    if (!(at > Date.now())) return { ok: false, error: 'Escolhe uma hora que ainda esteja à frente.' };
    if (live) {
      try {
        const r = await fetch(API + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: k, text, at, model: normModel(model) || undefined, team: asTeam(text) || undefined }) });
        const st = await r.json(); if (!r.ok) throw new Error(st.error || r.statusText);
        const t = mk({ agent: st.agent, title: st.title, text: st.text, plan: st.plan, why: st.why, by: 'you', live: true, sid: st.id, state: 'scheduled', dueAt: st.dueAt, needsOk: !!st.needsOk, model: st.model, modelUsed: st.model || officeModel, modelFrom: st.model ? 'task' : 'office', team: st.team ? { lead: st.team.lead, members: [] } : undefined });
        touch(t, 'scheduled'); spawnEmote(R[t.agent], '⏱'); feedPush(R[t.agent], '⏱', `Agendada para ${fmtDateTime(at)}: ${t.title}`);
        return { ok: true, task: t };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    const { agent: a } = route(k, text);
    const title = (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 90);
    const t = mk({ agent: a.id, title, text, by: 'you', state: 'scheduled', dueAt: at, needsOk: guessOk(text), modelUsed: normModel(model) || officeModel, modelFrom: model ? 'task' : 'office' });
    touch(t, 'scheduled'); spawnEmote(R[a.id], '⏱'); feedPush(R[a.id], '⏱', `Agendada para ${fmtDateTime(at)}: ${title}`);
    return { ok: true, task: t };
  }
  async function createRoutineAt({ dept: k, text, when, needsOk, model }) { // a routine from a date (when.start)
    if (!RT_DEPTS.includes(k)) return { ok: false, error: rtRefuse(k) };
    if (live) {
      try {
        const r = await fetch(API + '/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: k, text, when, needsOk, model: normModel(model) || undefined }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
        setRoutines([...routines.filter(x => x.id !== j.routine.id), j.routine]);
        const a = agentOf(j.routine.agent); spawnEmote(R[a.id], '⏱'); feedPush(R[a.id], '⏱', `Nova rotina: ${j.routine.title} (${j.routine.desc})`);
        return { ok: true, routine: routines.find(x => x.id === j.routine.id) };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    const { agent: a } = route(k, text);
    const r = addRoutine(k, a.id, text, when, needsOk); r.model = normModel(model) || undefined;
    spawnEmote(R[a.id], '⏱'); feedPush(R[a.id], '⏱', `Nova rotina: ${r.title} (${r.desc})`);
    return { ok: true, routine: r };
  }
  async function cancelScheduled(t) {
    if (!t || t.state !== 'scheduled') return false;
    if (live && t.sid) await fetch(`${API}/tasks/${t.sid}`, { method: 'APAGAR' }).catch(() => {});
    tasks.splice(tasks.indexOf(t), 1); dirty = true; feedPush(R[t.agent], '✕', `Cancelada: ${t.title}`);
    return true;
  }
  const calendar = initCalendar({ tasks, routines, agentOf, DEPTS, DEPT_KEYS, RT_DEPTS, rtRefuse, create: createScheduled, createRoutine: createRoutineAt, cancelTask: cancelScheduled, rtAct, openAgent: (id, tab) => openAgent && openAgent(id, tab), esc, isLive: () => live, officeModel: () => officeModel, MODEL_KEYS, modelName, business: () => document.title.replace(/ — Órbita$/, ''), currentDept: () => dept });
  return { tick, toggle, open, close, openFor, isOpen, boardWidth, onFocusChange, onStuck, onResolve, calendar, createScheduled, cancelScheduled,
           handleChat, revise, rowHTML, setDept, tasks, panelWidth: () => panel.offsetWidth, isLive: () => live,
           routines, addRoutine, rtAct, railFor, syncPills, refresh: poll, resolveLive, pendingReject, rejectLive, officeModel: () => officeModel, chosenModel, chosenEffort };
}
