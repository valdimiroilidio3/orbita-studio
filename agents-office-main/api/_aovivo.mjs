/* ===========================================================================
   1.78.0 · O RETRATO AO VIVO NA BASE DE DADOS (6 nov 2026)

   O escritório 3D mostrava, por cima da cena:

     A ligação ao vivo não está de pé (stale). O que está acima pode estar
     desactualizado.

   E era verdade — mas não por a ligação ter caído: **ela nunca existiu em
   produção**. O `/api/ops/aovivo` e o `/api/ops/aovivo/stream` vivem no
   `serve.mjs` (o servidor local). Na Vercel não há nenhum dos dois, por isso o
   `EventSource` batia num 404 e o ecrã punha-se «desactualizado» para sempre.

   Aqui está o retrato, do lado da base (Supabase), com a MESMA forma que o
   cliente já conhece (`src/live.js`): `agents[id]` com estado, tarefa aberta,
   última tarefa, linhas do monitor e a hora do servidor.

   Regras herdadas, e são o motivo de este ficheiro existir:
     · `live` só com trabalho a correr (ou evento recente) — nada de «ao vivo»
       com dados velhos;
     · sem tarefas, `idle` — o monitor di-lo por palavras, não inventa;
     · `error` só com uma falha registada e ainda fresca;
     · nada de percentagens: tentativa, horas e resultado, como estão na base.
   =========================================================================== */

/** O posto 3D que trata de cada tipo de tarefa (`src/ops/seat.mjs`). */
export const SEAT = {
  'lead.pesquisar': 'vmail',
  'lead.qualificar': 'ilm',
  'proposta.preparar': 'piper',
  'mensagem.redigir': 'folo',
  'projeto.briefing': 'dasst',
  'projeto.gerar': 'crep',
  'projeto.qa': 'qa',
  'projeto.corrigir': 'cass',
  'projeto.entregar': 'apay',
  'conteudo.rascunho': 'newt',
  'command.revisao': 'elead',
};

/** Departamento de operação → sala do escritório. */
export const DEPT_BRIDGE = {
  command: 'emails', prospect: 'sales', sales: 'ops', design: 'fin', engineering: 'delivery', media: 'marketing',
};

/** O departamento que trata de cada tipo de trabalho (o mesmo mapa de `tasks.mjs`). */
export const DEPT_DO_KIND = {
  'lead.pesquisar': 'prospect', 'lead.qualificar': 'prospect',
  'proposta.preparar': 'sales', 'mensagem.redigir': 'sales',
  'projeto.briefing': 'design', 'projeto.gerar': 'engineering', 'projeto.qa': 'engineering',
  'projeto.corrigir': 'engineering', 'projeto.entregar': 'engineering',
  'conteudo.rascunho': 'media', 'command.revisao': 'command',
};

const FRESCO_MS = 2 * 60 * 1000;    // «a trabalhar» = trabalho aberto, ou evento neste intervalo
const ERRO_MS = 30 * 60 * 1000;     // uma falha antiga não pinta o posto de vermelho para sempre
const ABERTAS = new Set(['queued', 'running', 'awaiting_approval']);
const ESTADOS = {
  queued: 'à espera', running: 'a correr', succeeded: 'concluída', failed: 'falhou',
  awaiting_approval: 'espera aprovação', cancelled: 'cancelada',
};

const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

/** Sem caminhos absolutos nem segredos por descuido — a mesma regra do local. */
export function redigir(texto) {
  return String(texto == null ? '' : texto)
    .replace(/\/home\/[^\s"']+/g, (m) => `…/${m.split('/').slice(-2).join('/')}`)
    .replace(/\/(?:Users|root|var|tmp)\/[^\s"']+/g, (m) => `…/${m.split('/').slice(-2).join('/')}`)
    .replace(/\b(re_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9]{8,}|sb_secret_[A-Za-z0-9_-]{6,})\b/g, '«segredo»')
    .slice(0, 400);
}

/** A tarefa, no formato que o monitor desenha (sem payloads nem segredos). */
export function tarefaParaMonitor(t) {
  if (!t) return null;
  return {
    id: t.id, kind: t.kind, dept: t.dept,
    title: t.title || t.kind, state: t.state, stateLabel: ESTADOS[t.state] || t.state,
    entity: t.entity || '', entityId: t.entity_id || '',
    attempts: t.attempts, maxAttempts: t.max_attempts,
    created_at: t.created_at, started_at: t.started_at, finished_at: t.finished_at,
    duration_ms: t.started_at && t.finished_at ? Math.max(0, ms(t.finished_at) - ms(t.started_at)) : null,
    error: redigir(t.error || ''),
    needsApproval: !!t.needs_approval,
    resultado: t.resultado ? redigir(typeof t.resultado === 'string' ? t.resultado : JSON.stringify(t.resultado)).slice(0, 240) : '',
  };
}

/**
 * O estado de um posto, a partir das tarefas dele.
 *
 * `agora` entra por parâmetro (e não de `Date.now()` escondido) para o teste
 * poder dizer «são 10:00» e provar o resultado.
 */
export function estadoDoPosto(tarefas = [], { agora = Date.now(), eventos = [] } = {}) {
  const abertas = tarefas.filter((t) => ABERTAS.has(t.state));
  const aberta = abertas.find((t) => t.state === 'running') || abertas[0] || null;
  const ultima = tarefas[0] || null;
  const falhada = tarefas.find((t) => t.state === 'failed' && agora - ms(t.finished_at || t.created_at) < ERRO_MS) || null;
  const ultimoEvento = eventos
    .map((e) => ms(e.at || e.criado))
    .filter((n) => n > 0)
    .sort((a, b) => b - a)[0] || 0;

  let estado = 'idle';
  if (aberta) estado = aberta.state === 'running' ? 'live' : 'waiting';
  else if (falhada) estado = 'error';
  else if (ultimoEvento && agora - ultimoEvento < FRESCO_MS) estado = 'live';

  const linhas = [];
  if (aberta) {
    linhas.push({ k: 'start', text: `▸ ${aberta.title || aberta.kind}` });
    if (aberta.started_at) linhas.push({ k: 'tool', text: `começou ${hora(aberta.started_at)} · tentativa ${aberta.attempts || 1}/${aberta.max_attempts || 1}` });
    if (aberta.state === 'awaiting_approval') linhas.push({ k: 'wait', text: 'à espera da tua aprovação' });
    if (aberta.state === 'queued') linhas.push({ k: 'wait', text: 'na fila, ainda não começou' });
  } else if (ultima) {
    linhas.push({ k: 'start', text: `▸ ${ultima.title || ultima.kind} · ${ESTADOS[ultima.state] || ultima.state}` });
    if (ultima.state === 'failed') linhas.push({ k: 'error', text: `✕ ${redigir(ultima.error || 'falhou sem motivo escrito')}` });
    else if (ultima.finished_at) linhas.push({ k: 'done', text: `concluída às ${hora(ultima.finished_at)}` });
  } else {
    linhas.push({ k: 'idle', text: 'sem tarefas registadas para este posto' });
  }

  return {
    state: estado,
    stateLabel: { live: 'a trabalhar', waiting: 'à espera', error: 'falhou', idle: 'sem tarefa' }[estado],
    aberta, ultima, falhada, linhas,
    lastEventAt: ultimoEvento ? new Date(ultimoEvento).toISOString() : null,
    since: aberta?.started_at || ultima?.finished_at || (ultimoEvento ? new Date(ultimoEvento).toISOString() : null),
  };
}

/**
 * O retrato inteiro. Recebe listas já lidas da base (`tarefas`, `eventos`) para
 * ser uma função pura e testável — quem lê a base é a rota.
 */
export function retrato({ agentes = [], tarefas = [], eventos = [], agora = Date.now(), fonte = 'tarefas e atividade da base de dados' } = {}) {
  const lista = agentes.length ? agentes : [...new Set(Object.values(SEAT))];
  const porAgente = {};
  for (const id of new Set(lista)) {
    const kinds = Object.entries(SEAT).filter(([, posto]) => posto === id).map(([kind]) => kind);
    const minhas = kinds.length
      ? tarefas.filter((t) => kinds.includes(t.kind)).sort((a, b) => ms(b.created_at) - ms(a.created_at))
      : [];
    const meusEventos = eventos.filter((e) => (e.texto || '').toLowerCase().includes(id));
    const e = estadoDoPosto(minhas, { agora, eventos: meusEventos });
    const dept = kinds.length ? DEPT_DO_KIND[kinds[0]] : null;
    porAgente[id] = {
      id,
      dept: dept ? DEPT_BRIDGE[dept] || dept : null,
      kinds,
      state: e.state,
      stateLabel: e.stateLabel,
      since: e.since,
      lastEventAt: e.lastEventAt,
      task: tarefaParaMonitor(e.aberta || e.falhada || null),
      last: tarefaParaMonitor(e.ultima),
      lines: e.linhas.slice(0, 8),
      artifacts: [],
      verification: null,
      project: null,
      history: minhas.slice(0, 12).map((t) => ({
        id: t.id, title: t.title || t.kind, state: t.state, stateLabel: ESTADOS[t.state] || t.state,
        at: t.finished_at || t.started_at || t.created_at,
        ms: t.started_at && t.finished_at ? Math.max(0, ms(t.finished_at) - ms(t.started_at)) : null,
        error: redigir(t.error || ''),
      })),
      events: meusEventos.map((x) => ({ at: x.at || x.criado, actor: x.tipo || '', action: '', detail: redigir(x.texto || '').slice(0, 160) })),
      jobs: [],
      hasData: minhas.length > 0,
      deptActivity: null,
      role: '',
      deptName: dept || '',
    };
  }

  const contar = (estado) => tarefas.filter((t) => t.state === estado).length;
  const abertas = tarefas
    .filter((t) => ABERTAS.has(t.state))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at))
    .map((t) => ({ id: t.id, kind: t.kind, dept: t.dept, title: t.title || t.kind, state: t.state, entityId: t.entity_id || '' }));

  return {
    ok: true,
    at: new Date(agora).toISOString(),
    serverTime: agora,
    agents: porAgente,
    totais: {
      live: Object.values(porAgente).filter((a) => a.state === 'live').length,
      waiting: contar('awaiting_approval'),
      queued: contar('queued'),
      running: contar('running'),
      failed: contar('failed'),
      succeeded: contar('succeeded'),
    },
    abertas,
    fonte,
  };
}

/** Lê a base e devolve o retrato. As leituras que falham não inventam dados. */
export async function retratoDaBase(repo, { agentes = [], agora = Date.now() } = {}) {
  if (!repo) return { ok: false, erro: 'sem base de dados ligada', agents: {}, totais: {}, abertas: [], fonte: 'sem base' };
  const [tarefas, atividade] = await Promise.all([
    repo.tarefas.list(200).catch(() => []),
    repo.atividade?.list ? repo.atividade.list(60).catch(() => []) : Promise.resolve([]),
  ]);
  return retrato({
    agentes, tarefas, eventos: atividade, agora,
    fonte: 'tarefas e atividade da base de dados do Órbita (Supabase)',
  });
}
