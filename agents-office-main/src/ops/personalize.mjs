// Órbita — escrever a cada negócio como se tivesse estado lá.
//
// Três peças, por esta ordem:
//   1. o dossiê — o que se viu (com a frase exacta de onde saiu);
//   2. a mensagem — construída sobre o dossiê, com o motor de IA se houver e com um modelo
//      escrito à mão se não houver; em ambos os casos, uma citação só entra se existir mesmo no
//      que foi lido (um modelo de linguagem inventa com toda a confiança — testemunhei-o);
//   3. o ciclo que fecha — o que o mundo respondeu volta como peso na pontuação e como regra
//      no próximo rascunho.
import { audit, getSetting, now, setSetting } from './db.mjs';
import { getLead, scoreLead } from './leads.mjs';
import { dossier, latest } from './research.mjs';

/* ---------- memória do negócio (a oferta do dono) ---------- */

export const OFFER_DEFAULTS = {
  nome: 'uma página simples com o essencial e o botão de contacto',
  preco_eur: 350,
  prazo_dias: 7,
  garantia: 'se não gostar do primeiro esboço, não paga',
  assinatura: '',
};

export function offerOf(db) {
  const saved = getSetting(db, 'oferta', {}) || {};
  return { ...OFFER_DEFAULTS, ...saved };
}

export function setOffer(db, patch, actor = 'dono') {
  const next = { ...offerOf(db), ...(patch || {}) };
  setSetting(db, 'oferta', next);
  audit(db, { actor, action: 'oferta.actualizada', entity: 'sistema', entityId: 'oferta', detail: next });
  return next;
}

/* ---------- 1. o dossiê ---------- */

const NICHE_TALK = {
  dentista: 'consultório', clinica: 'clínica', restaurante: 'restaurante', cabeleireiro: 'salão',
  barbearia: 'barbearia', hotel: 'alojamento', ginasio: 'ginásio', advogado: 'escritório',
};

/** Os ganchos: frases nossas, cada uma amarrada a um facto lido. */
export function hooks(lead, ev, offer) {
  const out = [];
  const by = k => ev.find(e => e.key === k);
  const site = String(lead.website || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

  if (!lead.website) {
    out.push({
      key: 'sem-site', strength: 3,
      text: `não tem site — quem procura «${lead.name}${lead.city ? ' ' + lead.city : ''}» no Google encontra só o perfil do mapa`,
      source: 'base de dados: sem site',
    });
  }
  if (by('desactualizado')) out.push({ key: 'desactualizado', strength: 2, text: `o site ainda tem o rodapé de ${by('desactualizado').quote.replace(/\D+/g, '')}`, source: by('desactualizado').quote });
  if (by('sem-mobile')) out.push({ key: 'sem-mobile', strength: 3, text: 'a página não se adapta ao telemóvel, e é no telemóvel que quase todos a vão abrir', source: by('sem-mobile').quote });
  if (by('sem-formulario')) out.push({ key: 'sem-formulario', strength: 1, text: 'não há forma de deixar um pedido no site, só telefone', source: by('sem-formulario').quote });
  if (by('sem-marcacao')) out.push({ key: 'sem-marcacao', strength: 2, text: 'não se pode marcar nada pelo site', source: by('sem-marcacao').quote });
  if (by('sem-precos')) out.push({ key: 'sem-precos', strength: 1, text: 'não se vê um único preço', source: by('sem-precos').quote });
  if (by('sem-https')) out.push({ key: 'sem-https', strength: 2, text: 'o site não tem cadeado, e o browser avisa quem entra', source: by('sem-https').quote });

  // a frase da própria casa é o melhor gancho: é dela, não nossa
  const desc = by('descricao');
  if (desc && desc.quote) out.push({ key: 'voz-do-negocio', strength: 3, text: `na vossa página: «${desc.quote}»`, source: desc.quote });

  if (lead.rating != null && lead.reviews != null) {
    out.push({
      key: 'avaliacoes', strength: lead.rating >= 4.5 ? 2 : 1,
      text: `${lead.rating.toFixed(1)}★ em ${lead.reviews} avaliações${lead.rating >= 4.5 ? ' — quem entra confia antes de vos conhecer' : ''}`,
      source: 'Google Places',
    });
  }
  if (site) out.push({ key: 'dominio', strength: 1, text: `o domínio ${site}`, source: site });
  out.push({ key: 'oferta', strength: 1, text: `${offer.nome}, ${offer.preco_eur} € fechados, pronta em ${offer.prazo_dias} dias`, source: 'a tua oferta' });
  return out.sort((a, b) => b.strength - a.strength);
}

/* ---------- 2. a mensagem ---------- */

/** Modelo escrito à mão: curto, com um facto e uma pergunta. Não finge ser outra coisa. */
export function templateDraft(db, lead, { channel = 'whatsapp' } = {}) {
  const offer = offerOf(db);
  const h = new Date().getHours();
  const hello = h < 12 ? 'Bom dia' : h < 20 ? 'Boa tarde' : 'Boa noite';
  const d = dossier(db, lead);
  const hs = hooks(lead, d.evidence, offer);
  const main = hs.find(x => ['voz-do-negocio', 'desactualizado', 'sem-mobile', 'sem-site'].includes(x.key)) || hs[0];
  const fact = main ? main.text : `${lead.name}${lead.city ? ', em ' + lead.city : ''}`;
  const what = channel === 'email' ? `${lead.name}` : lead.name;
  const body = `${hello}! Falo do ${what}${lead.city ? ' (' + lead.city + ')' : ''} — reparei que ${fact}. `
    + `Faço ${offer.nome} por ${offer.preco_eur} €, pronta em ${offer.prazo_dias} dias${offer.garantia ? '; ' + offer.garantia : ''}. `
    + `Faz sentido falarmos 10 minutos esta semana?`;
  const subject = main && main.key === 'voz-do-negocio'
    ? `Uma ideia a partir do que escrevem no site`
    : `${lead.name}: uma ideia rápida para o site`;
  return { subject, body, hook: main ? main.text : '', usedEngine: 'modelo', source: 'modelo local' };
}

const PROMPT_SYSTEM = `Escreves mensagens curtas de prospecção em português europeu, para o dono de um negócio local.
Regras absolutas:
- Só podes citar factos que estejam na lista FACTOS. Se um facto não está na lista, não existe.
- Uma mensagem, no máximo 90 palavras. Sem introduções de vendedor, sem "espero que esteja bem".
- Abre com o facto mais concreto e mais específico. Uma pergunta no fim.
- Trata o dono por "você". Nada de emojis.
Devolve APENAS JSON: {"assunto": "...", "corpo": "...", "facto_usado": "<cópia exacta de um facto da lista>"}`;

/** Passa o texto por um pente: sem citações inventadas, sem promessas que não fizemos. */
export function guardDraft(text, facts, { channel }) {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const haystack = norm(facts.join(' '));
  const sentences = String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = [];
  const dropped = [];
  for (const s of sentences) {
    // o que está entre aspas tem de existir no material lido
    const quoted = [...s.matchAll(/[«"“]([^»"”]{12,})[»"”]/g)].map(m => m[1]);
    const invented = quoted.find(q => !haystack.includes(norm(q)));
    if (invented) { dropped.push({ sentence: s, reason: `cita «${invented.slice(0, 60)}…», que não está no que li` }); continue; }
    if (/(garantimos|100%|o melhor do mercado|nº ?1|número um)/i.test(s)) { dropped.push({ sentence: s, reason: 'promessa que não posso fazer' }); continue; }
    kept.push(s.trim());
  }
  return { text: kept.join(' ').trim(), dropped };
}

/**
 * Escreve o rascunho. Com motor de IA (`ask`) ou sem ele — e diz sempre qual foi.
 * Devolve também o que se prevê que respondam, com a resposta já preparada.
 */
export async function compose(db, lead, { channel = null, ask = null, actor = 'agente' } = {}) {
  const offer = offerOf(db);
  const d = dossier(db, lead);
  const ch = channel || (lead.phone ? 'whatsapp' : lead.email ? 'email' : 'whatsapp');
  const hs = hooks(lead, d.evidence, offer);
  const facts = hs.filter(h => h.key !== 'oferta').map(h => h.text);

  let draft = null;
  let rejected = null;
  if (typeof ask === 'function' && facts.length) {
    try {
      const user = [
        `NEGÓCIO: ${lead.name}${lead.city ? ' — ' + lead.city : ''}${lead.category ? ' (' + lead.category + ')' : ''}`,
        `CANAL: ${ch === 'email' ? 'email' : 'WhatsApp'}`,
        `A MINHA OFERTA: ${offer.nome}, ${offer.preco_eur} €, ${offer.prazo_dias} dias${offer.garantia ? ', ' + offer.garantia : ''}`,
        'FACTOS (só estes podem ser citados):',
        ...facts.map((f, i) => `${i + 1}. ${f}`),
      ].join('\n');
      const raw = await ask(PROMPT_SYSTEM, user, { maxTokens: 600, timeout: 60000 });
      const json = JSON.parse(String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
      const body = String(json.corpo || '').trim();
      const subject = String(json.assunto || '').trim();
      if (!body) throw new Error('o motor devolveu uma mensagem vazia');
      const guarded = guardDraft(body, facts, { channel: ch });
      // Se o motor inventou uma citação ou prometeu o que não podemos, a mensagem inteira cai.
      // Cortar só a frase deixaria um texto mutilado — e um modelo que inventa uma vez inventa
      // outra. Volta-se ao modelo local, que é chato mas é verdadeiro.
      if (guarded.dropped.length) {
        throw new Error('a mensagem citava coisas que não li — recusada: ' + guarded.dropped.map(d => d.reason).join('; '));
      }
      if (!guarded.text) throw new Error('a mensagem ficou vazia depois do pente');
      draft = { subject, body: guarded.text, hook: json.facto_usado || '', usedEngine: 'ia', source: 'motor de IA', dropped: guarded.dropped };
    } catch (e) {
      rejected = e.message;
    }
  }
  if (!draft) draft = templateDraft(db, lead, { channel: ch });

  const predicted = objections(lead, d, offer, ch);
  const why = [
    draft.hook ? `abri por: ${draft.hook}` : '',
    draft.usedEngine === 'ia' ? 'escrita pelo motor, presa aos factos que li' : 'escrita pelo modelo local (não há motor ligado)',
    d.research.status === 'ok' ? `vi o site (${d.evidence.length} factos)` : `sem leitura do site: ${d.research.status}`,
  ].filter(Boolean).join(' · ');

  return {
    subject: draft.subject,
    body: draft.body,
    channel: ch,
    generatedBy: draft.usedEngine,
    why,
    hook: draft.hook,
    evidenceUsed: d.evidence.map(e => ({ key: e.key, label: e.label, quote: e.quote })),
    predictions: predicted,
    rejectedReason: rejected,
  };
}

/* ---------- 3. simulação de resposta ---------- */

const PRICE_FMT = n => `${n} €`;

/** As objeções prováveis, com a resposta já preparada. Regras do negócio, não do modelo. */
export function objections(lead, d, offer, channel) {
  const by = k => (d.evidence || []).find(e => e.key === k);
  const out = [];
  const add = (ifSays, answer, when) => out.push({ if: ifSays, answer, when });

  if (!lead.website) {
    add('Já tenho Instagram e chega.', `O Instagram é a montra; a página é a loja: aparece no Google quando alguém procura «${lead.name}${lead.city ? ' ' + lead.city : ''}», e tem o botão para vos contactarem. ${PRICE_FMT(offer.preco_eur)}, uma vez.`);
  }
  if (by('sem-mobile')) {
    add('O site está bom, não preciso de outro.', 'No telemóvel a vossa página obriga a fazer zoom para ler — e é no telemóvel que mais de metade das visitas acontece. Isso não é opinião, é o que se vê ao abrir.');
  }
  if (by('desactualizado')) {
    add('Já tenho site.', `Têm — mas o rodapé ainda diz ${String(by('desactualizado').quote).replace(/\D+/g, '')}. Quem repara nisso pensa que o negócio fechou. Uma página nova resolve isso e o resto.`);
  }
  add('Quanto custa?', `${PRICE_FMT(offer.preco_eur)} fechados, sem mensalidade${offer.garantia ? ', e ' + offer.garantia : ''}.`);
  add('Não tenho tempo para isto.', `Não precisa de tempo: eu escrevo, monto e mostro. Só me dá o OK no fim — ${offer.prazo_dias} dias, e a partir daí é vosso.`);
  add('Já tenho quem faça isso.', 'Perfeito. Se um dia quiserem uma segunda opinião sem compromisso, digo-vos em duas linhas o que mudaria. Sem custo.');
  if (/restaurant|clinic|dent|sal|barbearia|gin[aá]sio|hotel|spa/i.test(lead.category || '') && by('sem-marcacao')) {
    add('As marcações são por telefone.', 'Funciona — até ao dia em que ninguém atende. Uma marcação no site não tira o telefone, só apanha quem liga fora de horas.');
  }
  if (channel === 'whatsapp') add('Isto é spam?', 'Não. Vi o vosso negócio publicamente e escrevo uma vez. Se preferir, digo já que não volto a contactar.');
  return out;
}

/* ---------- o ciclo que fecha ---------- */

const KIND = {
  respondeu: 1, interessado: 1, reuniao: 1, cliente: 1,
  ignorou: -1, recusou: -1, pediu_parar: -2,
};
export const SIGNAL_KINDS = Object.keys(KIND);

/** Os atributos de um lead que podem explicar uma resposta. É por eles que se aprende. */
export function attributesOf(lead, evidence = null) {
  const out = [];
  const site = String(lead.website || '');
  if (!site) out.push('sem-site');
  else if (/facebook\.com|instagram\.com|linktr\.ee|wixsite\.com/i.test(site)) out.push('so-rede-social');
  else out.push('tem-site');
  if (lead.phone) out.push('tem-telefone');
  if (lead.rating != null && lead.rating < 4.2) out.push('avaliacao-baixa');
  if (lead.reviews != null && lead.reviews < 25) out.push('poucas-avaliacoes');
  if (/dentista|clinica|restaurante|cabeleireiro|barbearia|hotel|ginasio|advogado/i.test(lead.category || '')) out.push('nicho');
  // o que se viu no site também pesa: é o que distinguia esta abordagem das outras
  const keys = new Set((evidence || []).map(e => e.key));
  for (const k of ['desactualizado', 'sem-mobile', 'sem-formulario', 'sem-marcacao', 'plataforma-fechada']) if (keys.has(k)) out.push(k);
  return out;
}

/** Lê a evidência guardada do lead, para os atributos poderem incluí-la. */
const evidenceOf = (db, leadId) => latest(db, leadId)?.evidence || [];

export function recordSignal(db, { leadId, messageId = '', kind, note = '', actor = 'dono' }) {
  if (!KIND[kind]) throw Object.assign(new Error(`sinal desconhecido: ${kind} (usa ${SIGNAL_KINDS.join(', ')})`), { status: 400 });
  const lead = getLead(db, leadId);
  if (!lead) throw Object.assign(new Error('lead não encontrado'), { status: 404 });
  const attrs = attributesOf(lead, evidenceOf(db, leadId));
  db.prepare('INSERT INTO signals (at, lead_id, message_id, kind, note, attributes) VALUES (?,?,?,?,?,?)')
    .run(now(), leadId, messageId, kind, note, attrs.join(','));
  // um sinal forte mexe no funil: quem respondeu, respondeu
  if (kind === 'respondeu' && lead.status === 'contactado') {
    db.prepare("UPDATE leads SET status='respondeu', responded_at=COALESCE(responded_at, ?), updated_at=? WHERE id=?").run(now(), now(), leadId);
  }
  if (kind === 'interessado' || kind === 'reuniao') {
    db.prepare("UPDATE leads SET status=CASE WHEN status IN ('novo','contactado','respondeu') THEN 'reuniao' ELSE status END, updated_at=? WHERE id=?").run(now(), leadId);
  }
  if (kind === 'cliente') {
    db.prepare("UPDATE leads SET status='cliente', updated_at=? WHERE id=?").run(now(), leadId);
  }
  if (kind === 'recusou' && lead.status !== 'cliente') {
    db.prepare("UPDATE leads SET status='perdido', updated_at=? WHERE id=?").run(now(), leadId);
  }
  audit(db, { actor, action: `sinal.${kind}`, entity: 'lead', entityId: leadId, detail: { messageId, note, attrs } });
  const learned = learn(db);
  return { signal: { leadId, kind, attributes: attrs }, learned };
}

/**
 * Aprende com os sinais: cada atributo ganha um peso, com amortecimento para não passar de
 * opinião a fé. Amostra mínima de 3 — abaixo disso é coincidência, e coincidências não se
 * escrevem na pontuação dos outros.
 */
export function learn(db, { minSample = 3, cap = 8 } = {}) {
  const rows = db.prepare('SELECT kind, attributes FROM signals').all();
  const stats = {};
  for (const r of rows) {
    const w = KIND[r.kind] || 0;
    for (const a of String(r.attributes || '').split(',').filter(Boolean)) {
      stats[a] = stats[a] || { n: 0, soma: 0 };
      stats[a].n++;
      stats[a].soma += w;
    }
  }
  const weights = {};
  for (const [a, s] of Object.entries(stats)) {
    const peso = Math.round((s.soma / Math.max(6, s.n)) * 12);
    weights[a] = { n: s.n, soma: s.soma, peso: s.n >= minSample ? Math.max(-cap, Math.min(cap, peso)) : 0, amostra: s.n >= minSample };
  }
  setSetting(db, 'aprendizagem.pesos', weights);
  return { weights, total: rows.length };
}

export function learnedWeights(db) {
  return getSetting(db, 'aprendizagem.pesos', {}) || {};
}

/** A parte aprendida da nota, com a razão em português. */
export function scoreAdjustment(db, lead, weights = learnedWeights(db)) {
  const attrs = attributesOf(lead, evidenceOf(db, lead.id));
  let sum = 0;
  const bits = [];
  for (const a of attrs) {
    const w = weights[a];
    if (!w || !w.peso) continue;
    sum += w.peso;
    bits.push(`${w.peso > 0 ? '+' : ''}${w.peso} aprendido: ${a} (${w.n} ${w.n === 1 ? 'sinal' : 'sinais'})`);
  }
  return { delta: Math.max(-12, Math.min(12, sum)), reasons: bits.join(' · ') };
}

/** Recalcula a nota de todos os leads: base + aprendido, com as duas partes escritas. */
export function recalibrate(db) {
  const weights = learnedWeights(db);
  const rows = db.prepare('SELECT * FROM leads').all();
  let changed = 0;
  for (const l of rows) {
    const base = scoreLead(l);
    const adj = scoreAdjustment(db, l, weights);
    const score = Math.max(0, Math.min(100, base.score + adj.delta));
    const reasons = [base.reasons, adj.reasons].filter(Boolean).join(' · ');
    if (score !== l.score || reasons !== l.score_reasons || base.score !== l.score_base) {
      db.prepare('UPDATE leads SET score=?, score_base=?, score_learned=?, score_reasons=?, updated_at=? WHERE id=?')
        .run(score, base.score, adj.delta, reasons, now(), l.id);
      changed++;
    }
  }
  return { changed, total: rows.length };
}

/** O que se aprendeu, em texto — para o dono ler na gaveta. */
export function learningSummary(db) {
  const weights = learnedWeights(db);
  const rows = db.prepare('SELECT kind, COUNT(*) AS n FROM signals GROUP BY kind').all();
  const usable = Object.entries(weights).filter(([, w]) => w.amostra && w.peso)
    .sort((a, b) => Math.abs(b[1].peso) - Math.abs(a[1].peso));
  return {
    sinais: Object.fromEntries(rows.map(r => [r.kind, r.n])),
    totalSinais: rows.reduce((a, r) => a + r.n, 0),
    aprendido: usable.map(([k, w]) => `${k}: ${w.peso > 0 ? '+' : ''}${w.peso} (${w.n} sinais)`),
    aEsperar: Object.entries(weights).filter(([, w]) => !w.amostra).map(([k, w]) => `${k} (${w.n}/3)`),
  };
}
