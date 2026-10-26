// Órbita — leads a sério: pontuação explicável, sem duplicados, com funil e seguimentos.
//
// A regra que interessa: a nota não é um número mágico. Cada ponto tem uma razão escrita, e é
// isso que se mostra ao dono — «sem site (+25) · telefone público (+15) · poucas avaliações (+10)».
// Sem razão, é publicidade; com razão, é uma decisão.
import { audit, now, uid } from './db.mjs';

export const STATUSES = ['novo', 'contactado', 'respondeu', 'reuniao', 'cliente', 'perdido'];
export const CONSENT = ['desconhecido', 'dado', 'retirado'];

const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const digits = s => String(s || '').replace(/\D+/g, '');
// O mesmo número aparece como «+351 912…», «00351 912…» ou «912…». Comparam-se os 9 dígitos
// nacionais significativos: é o que identifica a linha, e o número completo fica guardado.
export const phoneKey = s => { const d = digits(s).replace(/^00/, ''); return d.length >= 9 ? d.slice(-9) : d; };
export const domainOf = url => {
  const raw = String(url || '').trim();
  if (!raw) return '';                       // sem site, sem domínio — não «undefined»
  try {
    const host = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase();
    return host && host.includes('.') ? host : '';
  } catch { return ''; }
};

/** A chave de deduplicação: domínio, senão telefone, senão email, senão nome+cidade. */
export function dedupeKeyOf(lead) {
  const domain = lead.domain || domainOf(lead.website);
  if (domain) return 'dominio:' + domain;
  const phone = phoneKey(lead.phone);
  if (phone.length >= 7) return 'telefone:' + phone;
  if (lead.email) return 'email:' + String(lead.email).toLowerCase();
  return 'nome:' + slug(lead.name) + '|' + slug(lead.city);
}

// nichos onde um site/melhor presença costuma valer mais (a lista é do dono, editável em settings)
const HOT_CATEGORIES = ['dentista', 'clinica', 'restaurante', 'cabeleireiro', 'barbearia', 'hotel', 'ginasio', 'advogado'];

/** Pontuação 0–100 com as razões. Puro: não escreve em lado nenhum. */
export function scoreLead(lead) {
  const bits = [];
  let score = 30;
  const website = String(lead.website || '').trim();
  if (!website) { score += 25; bits.push('sem site (+25)'); }
  else {
    const domain = domainOf(website);
    if (/facebook\.com|instagram\.com|linktr\.ee|wixsite\.com|blogspot/.test(domain)) { score += 15; bits.push('site é só uma rede social (+15)'); }
    else bits.push('tem site próprio (+0)');
  }
  if (digits(lead.phone).length >= 9) { score += 15; bits.push('telefone público (+15)'); }
  else bits.push('sem telefone (-)');
  const rating = typeof lead.rating === 'number' ? lead.rating : null;
  if (rating !== null && rating < 4.2) { score += 10; bits.push(`avaliação ${rating.toFixed(1)} (+10)`); }
  const reviews = typeof lead.reviews === 'number' ? lead.reviews : null;
  if (reviews !== null && reviews < 25) { score += 10; bits.push(`poucas avaliações: ${reviews} (+10)`); }
  if (HOT_CATEGORIES.some(k => slug(lead.category).includes(k))) { score += 5; bits.push('nicho com procura (+5)'); }
  score = Math.max(0, Math.min(100, score));
  return { score, reasons: bits.join(' · ') };
}

function rowToLead(r) {
  return { ...r, score_reasons: r.score_reasons, reasons: r.score_reasons };
}

/** Cria ou atualiza um lead (sem duplicar). Devolve { lead, created }. */
export function upsertLead(db, input, actor = 'sistema') {
  const name = String(input.name || '').trim();
  if (!name) throw Object.assign(new Error('o lead precisa de um nome'), { status: 400 });
  const domain = input.domain || domainOf(input.website);
  const key = input.dedupe_key || dedupeKeyOf({ ...input, domain });
  const existing = db.prepare('SELECT * FROM leads WHERE dedupe_key = ?').get(key);
  const at = now();
  if (existing) {
    // os dados factuais vêm frescos; o que o dono decidiu (estado, notas, consentimento) fica
    const next = {
      name, city: input.city ?? existing.city, address: input.address ?? existing.address,
      phone: input.phone ?? existing.phone, email: input.email ?? existing.email,
      website: input.website ?? existing.website, domain, category: input.category ?? existing.category,
      source: input.source || existing.source, source_url: input.source_url ?? existing.source_url,
      rating: input.rating ?? existing.rating, reviews: input.reviews ?? existing.reviews,
    };
    // a nota é recalculada sobre o lead completo (o que já se sabia + o que chegou agora),
    // senão um segundo contacto sem telefone «apagava» o telefone que já estava guardado
    const scored = scoreLead(next);
    db.prepare(`UPDATE leads SET name=?, city=?, address=?, phone=?, email=?, website=?, domain=?, category=?,
      source=?, source_url=?, rating=?, reviews=?, score=?, score_reasons=?, updated_at=? WHERE id=?`)
      .run(next.name, next.city, next.address, next.phone, next.email, next.website, next.domain, next.category,
        next.source, next.source_url, next.rating, next.reviews, scored.score, scored.reasons, at, existing.id);
    audit(db, { actor, action: 'lead.atualizado', entity: 'lead', entityId: existing.id, detail: { name, score: scored.score } });
    return { lead: rowToLead(db.prepare('SELECT * FROM leads WHERE id = ?').get(existing.id)), created: false };
  }
  const scored = scoreLead(input);
  const id = uid('l_');
  db.prepare(`INSERT INTO leads (id, name, city, address, phone, email, website, domain, category, source, source_url,
      rating, reviews, score, score_reasons, status, consent, notes, dedupe_key, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'novo','desconhecido','',?,?,?)`)
    .run(id, name, input.city || '', input.address || '', input.phone || '', input.email || '', input.website || '', domain,
      input.category || '', input.source || 'manual', input.source_url || '', input.rating ?? null, input.reviews ?? null,
      scored.score, scored.reasons, key, at, at);
  audit(db, { actor, action: 'lead.criado', entity: 'lead', entityId: id, detail: { name, score: scored.score, key } });
  return { lead: rowToLead(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)), created: true };
}

/** Importa uma lista (resultados do Google, CSV, etc.). Devolve contagens honestas. */
export function importLeads(db, list, actor = 'sistema', source = 'import') {
  let created = 0, updated = 0, refused = 0;
  for (const raw of list || []) {
    try {
      const { created: c } = upsertLead(db, { ...raw, source: raw.source || source }, actor);
      c ? created++ : updated++;
    } catch { refused++; }
  }
  return { created, updated, refused, total: created + updated };
}

export function listLeads(db, { limit = 50, status = null, order = 'score' } = {}) {
  const by = order === 'recent' ? 'updated_at DESC' : 'score DESC, updated_at DESC';
  const rows = status
    ? db.prepare(`SELECT * FROM leads WHERE status = ? ORDER BY ${by} LIMIT ?`).all(status, limit)
    : db.prepare(`SELECT * FROM leads ORDER BY ${by} LIMIT ?`).all(limit);
  return rows.map(rowToLead);
}

export function getLead(db, id) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  return row ? rowToLead(row) : null;
}

const TRANSITIONS = {
  novo: ['contactado', 'perdido'],
  contactado: ['respondeu', 'perdido'],
  respondeu: ['reuniao', 'perdido'],
  reuniao: ['cliente', 'perdido'],
  cliente: [],
  perdido: ['novo'],
};

/** Muda o estado do funil, recusando saltos que não existem (não se ganha um cliente sem falar). */
export function setStatus(db, id, status, actor = 'sistema', note = '') {
  const lead = getLead(db, id);
  if (!lead) throw Object.assign(new Error('lead não encontrado'), { status: 404 });
  if (!STATUSES.includes(status)) throw Object.assign(new Error(`estado desconhecido: ${status}`), { status: 400 });
  if (!TRANSITIONS[lead.status].includes(status)) {
    throw Object.assign(new Error(`de «${lead.status}» não se passa a «${status}» — segue o funil (${TRANSITIONS[lead.status].join(', ') || 'fim'})`), { status: 409 });
  }
  const at = now();
  const stamp = status === 'contactado' ? 'contacted_at' : status === 'respondeu' ? 'responded_at' : null;
  db.prepare(`UPDATE leads SET status=?, updated_at=?${stamp ? `, ${stamp}=COALESCE(${stamp}, ?)` : ''} WHERE id=?`)
    .run(...(stamp ? [status, at, at, id] : [status, at, id]));
  if (note) db.prepare('UPDATE leads SET notes = ? WHERE id = ?').run([lead.notes, note].filter(Boolean).join('\n'), id);
  audit(db, { actor, action: 'lead.estado', entity: 'lead', entityId: id, detail: { de: lead.status, para: status, note } });
  return getLead(db, id);
}

/** Seguimento: quando é que se volta a falar com esta pessoa. */
export function scheduleFollowUp(db, id, when, actor = 'sistema') {
  const lead = getLead(db, id);
  if (!lead) throw Object.assign(new Error('lead não encontrado'), { status: 404 });
  const at = new Date(when).toISOString();
  db.prepare('UPDATE leads SET next_follow_up_at=?, updated_at=? WHERE id=?').run(at, now(), id);
  audit(db, { actor, action: 'lead.seguimento', entity: 'lead', entityId: id, detail: at });
  return getLead(db, id);
}

export function dueFollowUps(db, at = now()) {
  return db.prepare("SELECT * FROM leads WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= ? AND status IN ('contactado','respondeu') ORDER BY next_follow_up_at")
    .all(at).map(rowToLead);
}

/** Opt-out: quem diz «pára» não recebe mais nada, em nenhum canal com esse endereço. */
export function optOut(db, { email, phone } = {}, reason = 'pedido do destinatário', actor = 'dono') {
  const addresses = [email && String(email).toLowerCase(), phone && phoneKey(phone)].filter(Boolean);
  if (!addresses.length) throw Object.assign(new Error('diz o email ou o telefone'), { status: 400 });
  for (const address of addresses) {
    db.prepare('INSERT INTO consents (at, channel, address, action, reason) VALUES (?,?,?,?,?)')
      .run(now(), address.includes('@') ? 'email' : 'telefone', address, 'opt_out', reason);
    db.prepare(`UPDATE leads SET consent='retirado', status=CASE WHEN status IN ('novo','contactado') THEN 'perdido' ELSE status END, updated_at=?
      WHERE ${address.includes('@') ? 'lower(email)' : "replace(replace(replace(phone,' ',''),'-',''),'.','')"} LIKE ?`).run(now(), address.includes('@') ? address : '%' + address);
  }
  audit(db, { actor, action: 'consentimento.opt_out', entity: 'lead', detail: { addresses, reason } });
  return { ok: true, blocked: addresses };
}

/** Consentimento registado: sem isto, email não sai. `retirado` bloqueia tudo. */
export function setConsent(db, id, consent, actor = 'dono', reference = '') {
  if (!CONSENT.includes(consent)) throw Object.assign(new Error(`consentimento inválido: ${consent}`), { status: 400 });
  const lead = getLead(db, id);
  if (!lead) throw Object.assign(new Error('lead não encontrado'), { status: 404 });
  db.prepare('UPDATE leads SET consent=?, updated_at=? WHERE id=?').run(consent, now(), id);
  if (consent === 'retirado') {
    for (const address of [lead.email && String(lead.email).toLowerCase(), lead.phone && phoneKey(lead.phone)].filter(Boolean)) {
      db.prepare('INSERT INTO consents (at, channel, address, action, reason) VALUES (?,?,?,?,?)')
        .run(now(), address.includes('@') ? 'email' : 'telefone', address, 'opt_out', reference || 'consentimento retirado');
    }
  }
  audit(db, { actor, action: 'lead.consentimento', entity: 'lead', entityId: id, detail: { consent, reference } });
  return getLead(db, id);
}

export function isBlocked(db, { email, phone } = {}) {
  const list = [email && String(email).toLowerCase(), phone && phoneKey(phone)].filter(Boolean);
  for (const address of list) {
    const hit = db.prepare("SELECT 1 FROM consents WHERE address = ? AND action = 'opt_out' LIMIT 1").get(address);
    if (hit) return true;
    if (hit) return true;
    if (!address.includes('@')) {
      // o número pode ter sido registado com outro prefixo; compara os 9 dígitos finais
      const any = db.prepare("SELECT address FROM consents WHERE action = 'opt_out' AND address NOT LIKE '%@%'").all();
      if (any.some(r => phoneKey(r.address) === address)) return true;
    }
  }
  return false;
}
