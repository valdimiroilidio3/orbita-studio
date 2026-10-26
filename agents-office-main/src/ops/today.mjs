// Órbita — o ecrã «Hoje»: três perguntas, e mais nada.
//
//   · o que precisa da tua decisão   (decidir)
//   · o que aconteceu enquanto dormias (aconteceu)
//   · o que vai acontecer            (a seguir)
//
// A regra editorial: cada cartão traz uma linha de **porquê** feita só com dados guardados. Se
// não houver dados que cheguem para justificar, o cartão não aparece — não se inventa contexto
// para parecer inteligente.
import { feed } from './events.mjs';
import { getLead } from './leads.mjs';
import { getMessage } from './messages.mjs';

const WHY_LEAD = (l) => {
  const bits = [];
  if (l.score_reasons) bits.push(l.score_reasons);
  if (l.status === 'contactado' && l.next_follow_up_at) bits.push('fica sem resposta há uns dias');
  return bits.join(' · ');
};

function messageCard(db, m) {
  // o porquê tem de sair dos dados guardados: a nota do lead vem da base de dados, não do resumo
  const lead = { ...(m.lead || {}), ...(getLead(db, m.lead_id) || {}) };
  const why = [
    WHY_LEAD(lead),
    m.channel === 'whatsapp' ? 'WhatsApp: o envio é teu, eu preparo o link' : 'email: precisa de consentimento registado',
  ].filter(Boolean).join(' · ');
  return {
    id: m.id, kind: 'mensagem', status: m.status, channel: m.channel,
    lead: { id: lead.id, name: lead.name || '', city: lead.city || '', phone: lead.phone || '', email: lead.email || '' },
    subject: m.subject || '', body: m.body || '', why, at: m.created_at,
    actions: m.status === 'rascunho' ? ['aprovar', 'rejeitar', 'editar'] : m.status === 'aprovada' ? ['enviar', 'rejeitar'] : ['abrir'],
  };
}

/** O que espera uma decisão humana. */
export function decisions(db, limit = 20) {
  const rows = db.prepare("SELECT id FROM messages WHERE status IN ('rascunho','aprovada','revisao') ORDER BY CASE status WHEN 'revisao' THEN 0 WHEN 'aprovada' THEN 1 ELSE 2 END, created_at DESC LIMIT ?").all(limit);
  return rows.map(r => messageCard(db, getMessage(db, r.id))).filter(Boolean);
}

/** Seguimentos que estão a chegar (ou já passaram) — trabalho que não se deve esquecer. */
export function followups(db, { withinDays = 7, at = new Date() } = {}) {
  const until = new Date(at.getTime() + withinDays * 86400000).toISOString();
  // um seguimento marcado conta sempre — menos para quem já é cliente ou pediu para sair
  return db.prepare("SELECT * FROM leads WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= ? AND status NOT IN ('cliente','perdido') ORDER BY next_follow_up_at LIMIT 20")
    .all(until)
    .map(l => ({ kind: 'seguimento', id: l.id, at: l.next_follow_up_at, name: l.name, status: l.status, phone: l.phone, email: l.email, overdue: l.next_follow_up_at <= at.toISOString() }));
}

/** O que aconteceu desde a última visita (ou nas últimas 24 horas, na primeira vez). */
export function happened(db, { since = null, limit = 40 } = {}) {
  const from = since || new Date(Date.now() - 24 * 3600000).toISOString();
  return feed(db, { limit, since: from });
}

/**
 * O ecrã inteiro. `office` traz o que vive fora da base de dados: tarefas e rotinas do escritório.
 * Nada é somado duas vezes: as decisões de mensagens vêm da base de dados, as de tarefas do
 * ficheiro de tarefas, e cada uma diz de onde vem (`fonte`).
 */
export function screen(db, { office = {}, since = null, at = new Date() } = {}) {
  const tasks = office.tasks || [];
  const routines = office.routines || [];
  const decidir = [
    ...decisions(db),
    ...tasks
      .filter(t => t && t.state === 'done' && t.draft && !t.approved)
      .map(t => ({
        id: t.id, kind: 'tarefa', fonte: 'escritório', status: 'à espera', channel: 'escritório',
        lead: { name: t.agentName || t.agent || 'agente' },
        subject: t.title || t.text || 'Trabalho pronto',
        body: String(t.result || t.draft || '').slice(0, 600),
        why: t.why || 'o agente terminou e não envia sem o teu OK',
        at: new Date(t.doneAt || Date.now()).toISOString(), actions: ['aprovar', 'rejeitar', 'abrir'],
      })),
  ];
  const aSeguir = [
    ...followups(db, { at }),
    ...routines
      .filter(r => r && r.nextAt)
      .sort((a, b) => new Date(a.nextAt) - new Date(b.nextAt))
      .slice(0, 8)
      .map(r => ({ kind: 'rotina', id: r.id, at: r.nextAt, name: r.title || r.desc || 'rotina', agent: r.agent })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all();
  const leads = { total: counts.reduce((a, r) => a + r.n, 0), porEstado: Object.fromEntries(counts.map(r => [r.status, r.n])) };
  const lastSend = db.prepare("SELECT MAX(sent_at) AS t FROM messages WHERE status = 'enviada'").get()?.t || null;

  return {
    decidir, aconteceu: happened(db, { since }), aSeguir,
    presenca: {
      agentes: tasks.filter(t => t && t.state === 'doing').length,
      escrevendo: tasks.filter(t => t && (t.state === 'doing' || t.state === 'queued')).map(t => t.agentName || t.agent).slice(0, 6),
      fila: db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'fila'").get().n,
      envios: db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status IN ('fila','em_voo')").get().n,
      parado: db.prepare("SELECT v FROM meta WHERE k = 'setting:envio.parado'").get()?.v === 'true',
    },
    resumo: { leads, ultimoEnvio: lastSend, decidir: decidir.length, aSeguir: aSeguir.length },
    geradoEm: at.toISOString(),
  };
}
