// Órbita — mensagens: o agente escreve, o dono aprova, só depois sai.
//
// Três travões, porque um erro aqui é público e pode custar o número:
//   1. aprovação — um rascunho nunca sai sozinho; `approve` é do dono;
//   2. consentimento — quem pediu para parar fica bloqueado, e o bloqueio é registado;
//   3. aquecimento — poucos envios por dia no início, a subir devagar, com teto por minuto.
// O envio em si é injetado (`deliver`), para os testes não tocarem em nenhum serviço real.
import { audit, getSetting, now, setSetting, uid } from './db.mjs';
import { getLead, isBlocked } from './leads.mjs';
import * as outbox from './outbox.mjs';
import * as autonomy from './autonomy.mjs';

export const STATUS = ['rascunho', 'aprovada', 'enviada', 'falhou', 'bloqueada', 'rejeitada', 'ensaio', 'revisao'];
export const CHANNELS = ['email', 'whatsapp'];

/** Quantos envios este canal permite hoje, pela idade da operação (aquecimento). */
export function dailyCap(db, channel, at = new Date()) {
  const start = getSetting(db, `warmup.${channel}.start`, channel === 'email' ? 20 : 5);
  const step = getSetting(db, `warmup.${channel}.step`, channel === 'email' ? 10 : 3);
  const max = getSetting(db, `warmup.${channel}.max`, channel === 'email' ? 200 : 40);
  const first = db.prepare('SELECT MIN(sent_at) AS t FROM messages WHERE channel = ? AND status = ?').get(channel, 'enviada')?.t;
  const day = first ? Math.max(0, Math.floor((at - new Date(first)) / 86400000)) : 0;
  return { cap: Math.min(max, start + step * day), start, step, max, day };
}

export function sentToday(db, channel, at = new Date()) {
  const day = at.toISOString().slice(0, 10);
  return db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ? AND status = 'enviada' AND substr(sent_at,1,10) = ?")
    .get(channel, day).n;
}

export function sentLastMinute(db, channel, at = new Date()) {
  const from = new Date(at.getTime() - 60000).toISOString();
  return db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ? AND status = 'enviada' AND sent_at >= ?")
    .get(channel, from).n;
}

/** Cria um rascunho. Não envia nada e não fala com nenhum serviço. */
export function draftMessage(db, { leadId, channel = 'email', subject = '', body, predictions = [], evidenceUsed = [], generatedBy = '', why = '' }, actor = 'agente') {
  if (!CHANNELS.includes(channel)) throw Object.assign(new Error(`canal desconhecido: ${channel}`), { status: 400 });
  if (!String(body || '').trim()) throw Object.assign(new Error('a mensagem está vazia'), { status: 400 });
  const lead = getLead(db, leadId);
  if (!lead) throw Object.assign(new Error('lead não encontrado'), { status: 404 });
  const id = uid('m_');
  const scope = autonomy.scopeOf({ channel, evidenceUsed, body });
  // Modo ensaio: escreve-se tudo, não sai nada. É a semana de prova antes de pedir autonomia.
  const ensaio = autonomy.trial(db).activo;
  const status = ensaio ? 'ensaio' : 'rascunho';
  db.prepare(`INSERT INTO messages (id, lead_id, channel, subject, body, status, created_at, predictions, evidence_used, generated_by, why, scope)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, leadId, channel, subject, body, status, now(), JSON.stringify(predictions), JSON.stringify(evidenceUsed), generatedBy, why, scope);
  audit(db, { actor, action: ensaio ? 'mensagem.ensaio' : 'mensagem.rascunho', entity: 'mensagem', entityId: id, detail: { leadId, channel, scope } });

  // Autonomia ganha: este tipo de mensagem já não pede autorização. Os travões de baixo continuam
  // a mandar (opt-out, travão geral, aquecimento) — ser autónomo não é ser livre de tudo.
  if (!ensaio && autonomy.isAutonomous(db, scope) && !isBlocked(db, { email: lead.email, phone: lead.phone }) && !outbox.sendBlocked(db)) {
    const rec = autonomy.recommendation(db, scope);
    db.prepare("UPDATE messages SET status='aprovada', approved_at=?, reason=? WHERE id=?")
      .run(now(), `autonomia: ${rec.decididas} casos, ${rec.taxaPct}% aprovados`, id);
    audit(db, { actor: 'autonomia', action: 'mensagem.aprovada_sozinha', entity: 'mensagem', entityId: id, detail: { scope, casos: rec.decididas, taxa: rec.taxaPct } });
  }
  return getMessage(db, id);
}

export function getMessage(db, id) {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!row) return null;
  const lead = getLead(db, row.lead_id);
  const parse = v => { try { return JSON.parse(v || '[]'); } catch { return []; } };
  return {
    ...row, predictions: parse(row.predictions), evidence_used: parse(row.evidence_used),
    lead: lead ? { id: lead.id, name: lead.name, email: lead.email, phone: lead.phone, status: lead.status, city: lead.city, score: lead.score } : null,
  };
}

export function listMessages(db, { limit = 50, status = null, leadId = null } = {}) {
  const where = [], args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (leadId) { where.push('lead_id = ?'); args.push(leadId); }
  const sql = `SELECT * FROM messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...args, limit).map(r => getMessage(db, r.id));
}

/** A aprovação do dono. Sem isto, nada sai. */
export function approveMessage(db, id, actor = 'dono') {
  const m = getMessage(db, id);
  if (!m) throw Object.assign(new Error('mensagem não encontrada'), { status: 404 });
  if (m.status !== 'rascunho') throw Object.assign(new Error(`só se aprova um rascunho (está «${m.status}»)`), { status: 409 });
  if (isBlocked(db, { email: m.lead?.email, phone: m.lead?.phone })) {
    db.prepare("UPDATE messages SET status='bloqueada', reason='o destinatário pediu para não ser contactado' WHERE id=?").run(id);
    audit(db, { actor, action: 'mensagem.bloqueada', entity: 'mensagem', entityId: id, detail: 'opt-out' });
    return getMessage(db, id);
  }
  db.prepare("UPDATE messages SET status='aprovada', approved_at=?, reason='' WHERE id=?").run(now(), id);
  audit(db, { actor, action: 'mensagem.aprovada', entity: 'mensagem', entityId: id });
  return getMessage(db, id);
}

export function rejectMessage(db, id, reason = '', actor = 'dono') {
  const m = getMessage(db, id);
  if (!m) throw Object.assign(new Error('mensagem não encontrada'), { status: 404 });
  if (m.status !== 'rascunho' && m.status !== 'ensaio') throw Object.assign(new Error(`só se rejeita um rascunho (está «${m.status}»)`), { status: 409 });
  db.prepare("UPDATE messages SET status='rejeitada', error=? WHERE id=?").run(reason || 'rejeitada pelo dono', id);
  audit(db, { actor, action: 'mensagem.rejeitada', entity: 'mensagem', entityId: id, detail: reason });
  return getMessage(db, id);
}

/** Sai do ensaio: a mensagem passa a rascunho e segue o caminho normal (com o teu OK). */
export function promoteFromTrial(db, id, actor = 'dono') {
  const m = getMessage(db, id);
  if (!m) throw Object.assign(new Error('mensagem não encontrada'), { status: 404 });
  if (m.status !== 'ensaio') throw Object.assign(new Error(`só se promove uma mensagem em ensaio (está «${m.status}»)`), { status: 409 });
  db.prepare("UPDATE messages SET status='rascunho' WHERE id=?").run(id);
  audit(db, { actor, action: 'mensagem.promovida', entity: 'mensagem', entityId: id });
  return getMessage(db, id);
}

/**
 * Envia uma mensagem aprovada. `deliver(msg, lead)` faz o trabalho — e pode não haver nenhum.
 *
 * O envio passa sempre pelo **outbox**: fica escrito antes de sair, com uma chave de
 * idempotência. Pedir duas vezes o mesmo envio não manda duas mensagens.
 */
export async function sendMessage(db, id, { deliver = null, actor = 'dono', channel } = {}) {
  const m = getMessage(db, id);
  if (!m) throw Object.assign(new Error('mensagem não encontrada'), { status: 404 });
  if (m.status !== 'aprovada') throw Object.assign(new Error(`só se envia uma mensagem aprovada (está «${m.status}»)`), { status: 409 });
  if (outbox.sendBlocked(db)) {
    audit(db, { actor, action: 'envio.recusado_parado', entity: 'mensagem', entityId: id });
    return { message: m, delivered: false, reason: 'os envios estão parados (interruptor de emergência). Retoma em «Retomar envios».' };
  }

  const lead = getLead(db, m.lead_id);
  if (isBlocked(db, { email: lead.email, phone: lead.phone })) {
    db.prepare("UPDATE messages SET status='bloqueada', reason='opt-out' WHERE id=?").run(id);
    audit(db, { actor, action: 'mensagem.bloqueada', entity: 'mensagem', entityId: id });
    return { message: getMessage(db, id), delivered: false, reason: 'o destinatário pediu para não ser contactado' };
  }
  const ch = channel || m.channel;
  if (ch === 'email' && !lead.email) return fail(db, id, 'o lead não tem email', actor);
  if (ch === 'whatsapp' && !lead.phone) return fail(db, id, 'o lead não tem telefone', actor);

  const rate = getSetting(db, 'envio.por_minuto', 6);
  if (sentLastMinute(db, ch) >= rate) {
    return { message: getMessage(db, id), delivered: false, reason: `limite de ${rate} envios por minuto — tenta daqui a pouco` };
  }
  const { cap, day } = dailyCap(db, ch);
  if (sentToday(db, ch) >= cap) {
    return { message: getMessage(db, id), delivered: false, reason: `aquecimento do canal: ${cap} por dia (dia ${day + 1}). Sobe com «envio.aquecimento» nas definições quando o número estiver quente.` };
  }
  if (typeof deliver !== 'function') {
    return { message: getMessage(db, id), delivered: false, reason: 'não há forma de enviar configurada (falta a chave do serviço)' };
  }

  // 1. fica escrito antes de sair (idempotente: a mesma mensagem duas vezes = uma linha)
  const queued = outbox.enqueue(db, {
    messageId: id, channel: ch, to: lead.email || lead.phone,
    payload: { to: lead.email || lead.phone, subject: m.subject || '', body: m.body },
    actor,
  });

  // 2. e agora tenta sair, uma vez
  const [res] = await outbox.drain(db, { only: queued.item.id, actor, deliver });
  if (!res) return { message: getMessage(db, id), delivered: false, reason: 'ficou na fila de envio' };
  if (!res.ok) {
    const item = outbox.get(db, queued.item.id);
    return fail(db, id, res.error || 'não saiu', actor, item?.status === 'revisao');
  }
  const out = res.result || {};
  if (out.doesNotSend) {
    // link wa.me: o dono ainda tem de carregar em enviar; não se marca como enviada
    db.prepare("UPDATE messages SET provider_id=?, reason=? WHERE id=?").run(out.url || '', out.note || 'envio manual no WhatsApp', id);
    audit(db, { actor, action: 'mensagem.link', entity: 'mensagem', entityId: id, detail: out.url });
    return { message: getMessage(db, id), delivered: false, manual: true, url: out.url, reason: out.note || 'link pronto: o dono revê e envia' };
  }
  db.prepare("UPDATE messages SET status='enviada', sent_at=?, provider_id=?, error='' WHERE id=?")
    .run(now(), out?.id || '', id);
  db.prepare("UPDATE leads SET status=CASE WHEN status='novo' THEN 'contactado' ELSE status END, contacted_at=COALESCE(contacted_at, ?), updated_at=? WHERE id=?")
    .run(now(), now(), lead.id);
  recordUsage(db, { provider: ch === 'email' ? 'resend' : 'whatsapp', units: 1, note: `mensagem ${id}`, costCents: getSetting(db, `custo.${ch}_centimos`, ch === 'email' ? 1 : 0) });
  audit(db, { actor, action: 'mensagem.enviada', entity: 'mensagem', entityId: id, detail: { to: lead.email || lead.phone } });
  return { message: getMessage(db, id), delivered: true };
}

/** O dono confirma que enviou à mão (WhatsApp). Aí sim conta como contactado. */
export function confirmSent(db, id, actor = 'dono') {
  const m = getMessage(db, id);
  if (!m) throw Object.assign(new Error('mensagem não encontrada'), { status: 404 });
  if (m.status === 'enviada') return m;
  db.prepare("UPDATE messages SET status='enviada', sent_at=? WHERE id=?").run(now(), id);
  db.prepare("UPDATE leads SET status=CASE WHEN status='novo' THEN 'contactado' ELSE status END, contacted_at=COALESCE(contacted_at, ?), updated_at=? WHERE id=?")
    .run(now(), now(), m.lead_id);
  recordUsage(db, { provider: 'whatsapp', units: 1, note: `mensagem ${id} (manual)`, costCents: 0 });
  audit(db, { actor, action: 'mensagem.enviada_manual', entity: 'mensagem', entityId: id });
  return getMessage(db, id);
}

function fail(db, id, error, actor, needsReview = false) {
  db.prepare("UPDATE messages SET status=?, error=? WHERE id=?").run(needsReview ? 'revisao' : 'falhou', String(error).slice(0, 500), id);
  audit(db, { actor, action: needsReview ? 'mensagem.revisao' : 'mensagem.falhou', entity: 'mensagem', entityId: id, detail: String(error).slice(0, 300) });
  return {
    message: getMessage(db, id), delivered: false, needsReview,
    reason: String(error) + (needsReview ? ' — já tinha saído uma vez; não repito sozinho, confirma na gaveta' : ''),
  };
}

/** Consumo das APIs, para o medidor de saldo não ser uma surpresa no fim do mês. */
export function recordUsage(db, { provider, units = 0, note = '', costCents = 0 }) {
  db.prepare('INSERT INTO usage (at, provider, units, note, cost_cents) VALUES (?,?,?,?,?)')
    .run(now(), provider, units, note, costCents);
}

export function usageSummary(db, days = 30) {
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db.prepare('SELECT provider, SUM(units) AS units, SUM(cost_cents) AS cents, COUNT(*) AS calls FROM usage WHERE at >= ? GROUP BY provider ORDER BY cents DESC')
    .all(from);
  return { days, providers: rows, totalCents: rows.reduce((a, r) => a + r.cents, 0) };
}

export function setWarmup(db, channel, { start, step, max } = {}) {
  if (start !== undefined) setSetting(db, `warmup.${channel}.start`, start);
  if (step !== undefined) setSetting(db, `warmup.${channel}.step`, step);
  if (max !== undefined) setSetting(db, `warmup.${channel}.max`, max);
  return dailyCap(db, channel);
}
