// Órbita — o registo de eventos: a memória de tudo o que aconteceu.
//
// Cada linha leva o hash da anterior (`prev_hash`), por isso o registo não é «uma tabela que se
// pode editar»: é uma cadeia. Apagar ou reescrever uma linha parte a cadeia, e `verify` diz
// exatamente em que linha. Não é à prova de quem tenha o ficheiro e o queira reescrever todo —
// é à prova de edições silenciosas, que é o problema real.
import { chainHash } from './db.mjs';

/** Verifica a cadeia inteira. Devolve `{ ok, count, brokenAt }`. */
export function verify(db) {
  let prev = '';
  let count = 0;
  const rows = db.prepare('SELECT * FROM events ORDER BY id').all();
  for (const row of rows) {
    count++;
    const expected = chainHash(row.prev_hash || '', row);
    if (row.prev_hash !== prev || row.hash !== expected) {
      return { ok: false, count, brokenAt: row.id, total: rows.length };
    }
    prev = row.hash;
  }
  return { ok: true, count, brokenAt: null, total: rows.length, lastHash: prev };
}

/** Os eventos, do mais recente para o mais antigo. */
export function timeline(db, { limit = 50, since = null, entity = null, entityId = null, actor = null } = {}) {
  const where = [], args = [];
  if (since) { where.push('at > ?'); args.push(since); }
  if (entity) { where.push('entity = ?'); args.push(entity); }
  if (entityId) { where.push('entity_id = ?'); args.push(entityId); }
  if (actor) { where.push('actor = ?'); args.push(actor); }
  const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, limit).map(r => ({ ...r, detail: safeParse(r.detail) }));
}

export function countSince(db, since) {
  return db.prepare('SELECT COUNT(*) AS n FROM events WHERE at > ?').get(since).n;
}

const safeParse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return v; } };

const nameOf = (d) => d?.nome || d?.name || d?.lead || d?.para || '';

/** Uma frase simples para cada evento — o que o dono lê no «aconteceu». */
export function sentence(e) {
  const d = e.detail || {};
  switch (e.action) {
    case 'lead.criado': return `Lead novo: ${nameOf(d)}${d.score != null ? ` (nota ${d.score})` : ''}`;
    case 'lead.atualizado': return `Dados renovados: ${nameOf(d)}`;
    case 'lead.estado': return `${nameOf(d) || 'Um lead'} passou de ${d.de || '?'} para ${d.para || '?'}`;
    case 'lead.seguimento': return `Seguimento marcado para ${String(d).slice(0, 16).replace('T', ' ')}`;
    case 'lead.consentimento': return `Consentimento de ${nameOf(d) || 'um lead'}: ${d.consent || ''}`;
    case 'mensagem.rascunho': return 'Rascunho escrito e à espera de aprovação';
    case 'mensagem.aprovada': return 'Aprovaste uma mensagem';
    case 'mensagem.rejeitada': return 'Rejeitaste uma mensagem';
    case 'mensagem.enviada': return `Mensagem enviada${d.to ? ' a ' + d.to : ''}`;
    case 'mensagem.enviada_manual': return 'Confirmaste um envio feito à mão';
    case 'mensagem.bloqueada': return 'Mensagem bloqueada: o destinatário pediu para parar';
    case 'mensagem.falhou': return `Uma mensagem falhou: ${String(d).slice(0, 80)}`;
    case 'mensagem.revisao': return 'Uma mensagem precisa da tua revisão (já tinha saído uma vez)';
    case 'consentimento.opt_out': return 'Registado um pedido para não ser contactado';
    case 'outbox.enfileirado': return 'Envio guardado na fila de saída';
    case 'outbox.enviado': return 'Envio confirmado pelo serviço';
    case 'outbox.retentativa': return 'Um envio falhou e vai tentar outra vez';
    case 'outbox.desistiu': return 'Um envio desistiu depois das tentativas';
    case 'outbox.revisao': return 'Um envio ficou para revisão — não repito sozinho';
    case 'envio.parado': return 'Paraste todos os envios';
    case 'envio.retomado': return 'Envios retomados';
    case 'envio.recusado_parado': return 'Um envio foi recusado porque está tudo parado';
    case 'fila.criada': return 'Trabalho novo na fila';
    case 'fila.retentativa': return `Um trabalho falhou e vai tentar outra vez (${d.attempts || '?'}ª)`;
    case 'fila.desistiu': return `Um trabalho desistiu: ${String(d.error || '').slice(0, 70)}`;
    case 'ops.importou_gravados': return `Importaste ${d.created || 0} leads guardados`;
    default: return e.action.replace(/\./g, ' · ');
  }
}

/** O feed do «aconteceu», já em frases e agrupado por horas. */
export function feed(db, { limit = 40, since = null } = {}) {
  return timeline(db, { limit, since }).map(e => ({
    id: e.id, at: e.at, actor: e.actor, action: e.action,
    text: sentence(e), entity: e.entity, entityId: e.entity_id,
  }));
}
