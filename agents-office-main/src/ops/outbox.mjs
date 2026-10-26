// Órbita — o outbox: o que tem de sair fica escrito antes de sair.
//
// O problema que isto resolve é o pior de todos: o servidor cai a meio de um envio. Sem outbox,
// ninguém sabe se a mensagem saiu — e a tentação é repetir, o que pode mandar a mesma mensagem
// duas vezes a um cliente. Aqui:
//
//   · enfileirar é idempotente — a chave nasce do id da mensagem e do conteúdo; pedir duas vezes
//     é pedir uma;
//   · quem pega num item faz um aluguer (lease) com prazo. Se o processo morrer, o aluguer
//     expira e o item volta; ninguém fica com trabalho preso para sempre;
//   · um email que já falhou uma vez não é reenviado às cegas: vai para `revisao` e espera por
//     uma pessoa. Preferimos um envio a menos a um cliente a receber duas vezes.
import { createHash } from 'node:crypto';
import { audit, getSetting, now, setSetting, uid } from './db.mjs';

export const STATUS = ['fila', 'em_voo', 'feito', 'falhou', 'revisao'];

/** A chave de idempotência: mensagem + conteúdo. Muda o texto, muda a chave — de propósito. */
export function keyFor(messageId, payload = {}) {
  const canon = JSON.stringify(payload, Object.keys(payload).sort());
  return messageId + ':' + createHash('sha256').update(canon).digest('hex').slice(0, 24);
}

export const sendBlocked = (db) => getSetting(db, 'envio.parado', false) === true;

export function setStop(db, stopped, actor = 'dono', why = '') {
  const value = !!stopped;
  const before = sendBlocked(db);
  if (before !== value) {
    setSetting(db, 'envio.parado', value);
    audit(db, { actor, action: value ? 'envio.parado' : 'envio.retomado', entity: 'sistema', entityId: 'envio', detail: why || '' });
  }
  return { parado: value };
}

export function get(db, id) {
  const row = db.prepare('SELECT * FROM outbox WHERE id = ?').get(id);
  return row ? { ...row, payload: JSON.parse(row.payload || '{}') } : null;
}

/** Enfileira um envio. Devolve `created: false` quando a mesma coisa já estava na fila. */
export function enqueue(db, { messageId, channel, to = '', payload = {}, maxAttempts = 3, actor = 'sistema' }) {
  if (!messageId) throw Object.assign(new Error('o outbox precisa do id da mensagem'), { status: 400 });
  const key = keyFor(messageId, payload);
  const existing = db.prepare('SELECT * FROM outbox WHERE idempotency_key = ?').get(key);
  if (existing) return { item: get(db, existing.id), created: false };
  const id = uid('o_');
  const at = now();
  db.prepare(`INSERT INTO outbox (id, message_id, channel, to_addr, payload, idempotency_key, status, attempts, max_attempts, next_attempt_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'fila', 0, ?, ?, ?)`)
    .run(id, messageId, channel, to, JSON.stringify(payload), key, maxAttempts, at, at);
  audit(db, { actor, action: 'outbox.enfileirado', entity: 'mensagem', entityId: messageId, detail: { chave: key, canal: channel } });
  return { item: get(db, id), created: true };
}

const backoffMs = attempts => Math.min(30 * 60000, 30000 * Math.pow(2, Math.max(0, attempts - 1)));

/**
 * Pega em trabalho devido. Um aluguer com prazo: se este processo morrer, o item volta.
 * Devolve os itens já marcados como `em_voo` — e cada um só pode estar num sítio.
 */
export function claim(db, { limit = 5, leaseMs = 60000, only = null } = {}) {
  const at = new Date();
  const atIso = at.toISOString();
  const lease = new Date(at.getTime() + leaseMs).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const fresh = only
      ? db.prepare("SELECT id FROM outbox WHERE id = ? AND status = 'fila'").all(only).map(r => r.id)
      : db.prepare("SELECT id FROM outbox WHERE status = 'fila' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?").all(atIso, limit).map(r => r.id);
    // trabalho que ficou preso num processo que morreu: volta, mas marcado como resgatado
    const stuck = only
      ? db.prepare("SELECT id FROM outbox WHERE id = ? AND status = 'em_voo' AND (lease_until IS NULL OR lease_until < ?)").all(only, atIso).map(r => r.id)
      : db.prepare("SELECT id FROM outbox WHERE status = 'em_voo' AND (lease_until IS NULL OR lease_until < ?) LIMIT ?").all(atIso, limit).map(r => r.id);
    for (const id of [...fresh, ...stuck]) {
      db.prepare("UPDATE outbox SET status = 'em_voo', attempts = attempts + 1, lease_until = ?, error = '' WHERE id = ?").run(lease, id);
    }
    db.exec('COMMIT');
    return [...fresh.map(id => ({ ...get(db, id), reclaimed: false })), ...stuck.map(id => ({ ...get(db, id), reclaimed: true }))];
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* já desfez */ } throw e; }
}

export function complete(db, id, { providerId = '', actor = 'sistema' } = {}) {
  db.prepare("UPDATE outbox SET status = 'feito', provider_id = ?, sent_at = ?, lease_until = NULL, error = '' WHERE id = ?")
    .run(String(providerId || ''), now(), id);
  audit(db, { actor, action: 'outbox.enviado', entity: 'mensagem', entityId: get(db, id)?.message_id || '', detail: { outbox: id, providerId } });
  return get(db, id);
}

export function fail(db, id, error, { actor = 'sistema' } = {}) {
  const item = get(db, id);
  if (!item) return null;
  const msg = String(error && error.message ? error.message : error).slice(0, 500);
  const retryable = item.status !== 'revisao' && item.attempts < item.max_attempts;
  // um email que já saiu uma vez e falhou não volta a sair sozinho: fica para uma pessoa ver
  const cautious = item.channel === 'email' && item.attempts >= 1;
  let status = 'falhou';
  if (retryable && !cautious) status = 'fila';
  else if (retryable && cautious) status = 'revisao';
  const next = status === 'fila' ? new Date(Date.now() + backoffMs(item.attempts)).toISOString() : item.next_attempt_at;
  db.prepare("UPDATE outbox SET status = ?, next_attempt_at = ?, lease_until = NULL, error = ? WHERE id = ?").run(status, next, msg, id);
  audit(db, {
    actor, action: status === 'fila' ? 'outbox.retentativa' : status === 'revisao' ? 'outbox.revisao' : 'outbox.desistiu',
    entity: 'mensagem', entityId: item.message_id, detail: { outbox: id, tentativa: item.attempts, erro: msg },
  });
  return get(db, id);
}

/**
 * Corre o que está devido. `deliver(item)` faz o envio e devolve o que o serviço devolveu.
 * Devolve uma linha por item: `{ id, ok, result, error }`.
 */
export async function drain(db, { deliver, limit = 5, leaseMs = 60000, only = null, actor = 'sistema' } = {}) {
  if (sendBlocked(db)) return [];
  const items = claim(db, { limit, leaseMs, only });
  const out = [];
  for (const item of items) {
    try {
      // Um email resgatado pode já ter saído antes de o processo morrer. Não se repete às cegas:
      // vai para revisão, e é uma pessoa que decide. Um envio a menos é melhor que dois iguais.
      if (item.reclaimed && item.channel === 'email' && item.attempts > 1) {
        throw new Error('o processo caiu a meio deste envio — pode ter saído; confirma antes de repetir');
      }
      if (typeof deliver !== 'function') throw new Error('não há forma de enviar configurada');
      const result = await deliver(item);
      complete(db, item.id, { providerId: result?.id || result?.url || '', actor });
      out.push({ id: item.id, ok: true, result });
    } catch (e) {
      fail(db, item.id, e, { actor });
      out.push({ id: item.id, ok: false, error: e.message });
    }
  }
  return out;
}

export function stats(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status').all();
  const by = Object.fromEntries(rows.map(r => [r.status, r.n]));
  return { fila: by.fila || 0, em_voo: by.em_voo || 0, feito: by.feito || 0, falhou: by.falhou || 0, revisao: by.revisao || 0, parado: sendBlocked(db) };
}

export function list(db, { status = null, limit = 25 } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM outbox WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map(r => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
}
