// Órbita — ver o negócio antes de lhe escrever.
//
// A diferença entre «vi que não tem site» (que já toda a gente manda) e «vi na vossa página que
// abrem às 9h e fecham às 19h, e que o formulário de marcação não funciona no telemóvel» é a
// única personalização que ninguém copia depressa. Para isso é preciso ir ver.
//
// Regras desta camada:
//   · só se lê o que é público, uma vez, devagar, e com um nome que diz quem somos;
//   · o robots.txt manda — se o site não permite, não se lê e diz-se porquê;
//   · nada de sítios privados (o servidor podia ser usado para entrar na rede de casa: SSRF);
//   · tudo o que se conclui fica com a frase exacta de onde saiu, para poder ser citada;
//   · se a leitura falhar, fica o motivo escrito. Nunca um dossiê inventado.
import { audit, now, uid } from './db.mjs';

const UA = 'OrbitaBot/1.0 (+pesquisa de contacto comercial; respeita robots.txt)';
const MAX_BYTES = 400_000;
const MAX_TEXT = 60_000;
const TIMEOUT_MS = 12_000;

export const STATUS = ['por_fazer', 'ok', 'sem_site', 'bloqueado', 'falhou'];

/* ---------- guardas de rede ---------- */

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$)/i;
const PRIVATE_IPV4 = /^(172\.(1[6-9]|2\d|3[01])\.)/;

/** Um endereço que não seja público não se lê. Devolve o motivo, ou '' se for seguro. */
export function unsafeTarget(raw) {
  let u;
  try { u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); } catch { return 'endereço inválido'; }
  if (!/^https?:$/.test(u.protocol)) return 'só http e https';
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(host)) return 'endereço privado — não leio a rede de casa';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)) return 'endereço privado';
  }
  if (!host.includes('.') && !host.startsWith('[')) return 'endereço sem domínio';
  return '';
}

/** O robots.txt do site manda. Sem robots, assume-se permitido (o padrão). */
export async function robotsAllows(baseUrl, pathname, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const u = new URL('/robots.txt', baseUrl);
  let text = '';
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetchImpl(u.toString(), { signal: ctl.signal, headers: { 'user-agent': UA } });
    clearTimeout(t);
    if (!r.ok) return { allowed: true, note: `sem robots.txt (HTTP ${r.status})` };
    text = (await r.text()).slice(0, MAX_TEXT);
  } catch { return { allowed: true, note: 'robots.txt não respondeu — tratado como permitido' }; }

  // procura o grupo que nos interessa: o nosso nome, senão o genérico
  const lines = text.split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const groups = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'disallow' || key === 'allow') && cur) {
      cur.rules.push({ type: key, path: val });
    }
  }
  const mine = groups.filter(g => g.agents.some(a => a.includes('orbitabot') || a === '*'));
  const rules = mine.flatMap(g => g.rules).filter(r => r.path);
  if (!rules.length) return { allowed: true, note: 'robots.txt sem regras para nós' };
  // a regra mais específica ganha
  let best = null;
  for (const r of rules) {
    const key = r.path.replace(/\*/g, '');
    if (pathname.startsWith(key) || key === '') {
      if (!best || key.length > best.key.length) best = { ...r, key };
    }
  }
  if (best && best.type === 'disallow' && best.key !== '') return { allowed: false, note: `robots.txt não permite ${best.key}` };
  return { allowed: true, note: 'robots.txt permite' };
}

/* ---------- leitura ---------- */

const decode = s => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x27;/g, "'")
  .replace(/&euro;/g, '€').replace(/&hellip;/g, '…')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

export const textOf = html => decode(String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const firstOf = (html, re) => { const m = String(html || '').match(re); return m ? decode(String(m[1]).replace(/<[^>]+>/g, '')).trim() : ''; };

/** Tira do HTML os factos que se podem citar. Puro: devolve dados, não escreve nada. */
export function parseHtml(html, url, { today = new Date() } = {}) {
  const h = String(html || '');
  const title = firstOf(h, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = firstOf(h, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || firstOf(h, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)
    || firstOf(h, /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const h1 = firstOf(h, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h2 = [...h.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, '')).trim()).filter(Boolean).slice(0, 8);
  const text = textOf(h).slice(0, MAX_TEXT);
  const links = [...h.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
  const socials = {};
  for (const l of links) {
    if (/instagram\.com\//i.test(l) && !socials.instagram) socials.instagram = l;
    if (/facebook\.com\//i.test(l) && !socials.facebook) socials.facebook = l;
    if (/wa\.me\/|api\.whatsapp\.com/i.test(l) && !socials.whatsapp) socials.whatsapp = l;
  }
  const email = (h.match(/mailto:([^"'?>\s]+)/i) || [])[1] || '';
  const phones = [...new Set((text.match(/(?:\+351|00351)?[\s.-]?(?:2\d{2}|9[1236]\d)[\s.-]?\d{3}[\s.-]?\d{3}/g) || []).map(s => s.trim()))].slice(0, 4);
  const platform =
    /wp-content|wp-includes/i.test(h) ? 'WordPress' :
    /wixstatic|wix\.com/i.test(h) ? 'Wix' :
    /squarespace/i.test(h) ? 'Squarespace' :
    /shopify/i.test(h) ? 'Shopify' :
    /joomla/i.test(h) ? 'Joomla' :
    /webflow/i.test(h) ? 'Webflow' : '';
  const copyright = (text.match(/(?:©|copyright)\s*(?:20)?(\d{2})/i) || [])[1];
  const copyrightYear = copyright ? (copyright.length === 2 ? 2000 + +copyright : +copyright) : null;
  const facts = {
    title, description, h1, h2, platform, socials, email, phones,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(h),
    https: /^https:/i.test(url),
    hasForm: /<form[\s>]/i.test(h),
    hasBooking: /marc(a|á)(ç|c)(ão|ao|ões|oes)|agend|booking|reserv/i.test(text),
    hasPrices: /(€|eur|preç|precio|price)/i.test(text),
    hasMenu: /menu|ementa|carta/i.test(text),
    copyrightYear,
    language: firstOf(h, /<html[^>]+lang=["']([^"']+)["']/i) || '',
    wordCount: text ? text.split(/\s+/).length : 0,
    text,
  };
  return facts;
}

/**
 * As conclusões que interessam a quem vai escrever — cada uma com a frase de onde saiu.
 * Um facto sem fonte não entra: é a regra que impede um rascunho de citar coisas que não existem.
 */
export function conclusions(facts, { today = new Date() } = {}) {
  const out = [];
  const add = (key, label, quote = '', weight = 0) => out.push({ key, label, quote: String(quote || '').slice(0, 220), weight });
  const year = today.getFullYear();

  if (!facts.hasViewport) add('sem-mobile', 'a página não tem versão para telemóvel', 'falta a meta viewport', 18);
  else add('com-mobile', 'a página adapta-se ao telemóvel', 'meta viewport presente', 0);

  if (!facts.https) add('sem-https', 'o site não tem cadeado (http, não https)', 'o endereço não é seguro', 12);

  if (facts.copyrightYear && facts.copyrightYear <= year - 2) {
    add('desactualizado', `o rodapé ainda diz ${facts.copyrightYear}`, `© ${facts.copyrightYear}`, 14);
  }

  if (facts.platform === 'Wix' || facts.platform === 'Squarespace') {
    add('plataforma-fechada', `o site está numa plataforma fechada (${facts.platform})`, facts.platform, 6);
  }

  if (!facts.hasForm) add('sem-formulario', 'não tem formulário de contacto — só telefone ou email', 'nenhum <form> na página', 8);
  if (!facts.hasBooking && /restaurant|clinic|dent|sal[aã]o|barbearia|gin[aá]sio|hotel|spa/i.test(facts.category || '')) {
    add('sem-marcacao', 'não tem marcação online', 'não encontrei marcação nem reserva', 10);
  }
  if (!facts.hasPrices) add('sem-precos', 'não mostra preços em lado nenhum', 'nenhum valor na página', 5);

  if (facts.socials?.instagram) add('instagram', 'tem Instagram ligado ao site', facts.socials.instagram, 2);
  else if (facts.socials?.facebook) add('facebook', 'tem Facebook ligado ao site', facts.socials.facebook, 1);

  if (facts.description && facts.description.length >= 40) add('descricao', 'a própria página diz o que faz', facts.description, 3);
  if (facts.title) add('titulo', 'o título da página', facts.title, 1);

  return out.filter(c => c.key !== 'com-mobile');
}

/* ---------- gravação ---------- */

export function latest(db, leadId, kind = 'site') {
  const row = db.prepare('SELECT * FROM research WHERE lead_id = ? AND kind = ?').get(leadId, kind);
  if (!row) return null;
  return { ...row, data: safeJSON(row.data, {}), evidence: safeJSON(row.evidence, []) };
}

const safeJSON = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

export function save(db, { leadId, kind = 'site', url, status, reason = '', data = {}, evidence = [], actor = 'agente' }) {
  const existing = db.prepare('SELECT id FROM research WHERE lead_id = ? AND kind = ?').get(leadId, kind);
  const ad = safeJSON(JSON.stringify(data), {}), ev = evidence;
  if (existing) {
    db.prepare('UPDATE research SET url=?, status=?, reason=?, fetched_at=?, data=?, evidence=? WHERE id=?')
      .run(url || '', status, reason, now(), JSON.stringify(ad), JSON.stringify(ev), existing.id);
  } else {
    db.prepare('INSERT INTO research (id, lead_id, kind, url, status, reason, fetched_at, data, evidence) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(uid('r_'), leadId, kind, url || '', status, reason, now(), JSON.stringify(ad), JSON.stringify(ev));
  }
  audit(db, { actor, action: `pesquisa.${status}`, entity: 'lead', entityId: leadId, detail: { kind, url, reason: reason.slice(0, 120) } });
  return latest(db, leadId, kind);
}

/**
 * Vai ver o site do lead e guarda o que encontrou. `fetchImpl` existe para os testes poderem
 * servir uma página local sem sair da máquina — em produção é o `fetch` do Node.
 */
export async function researchSite(db, lead, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, actor = 'agente', allowPrivate = null } = {}) {
  // O guarda SSRF está sempre ligado, excepto quando alguém o desliga de propósito e por escrito
  // (ORBITA_PESQUISA_PERMITIR_PRIVADO=1). Os testes usam-no para ler um servidor local; numa
  // instalação normal não se toca.
  const permissive = allowPrivate === null ? process.env.ORBITA_PESQUISA_PERMITIR_PRIVADO === '1' : allowPrivate;
  const raw = String(lead.website || '').trim();
  if (!raw) {
    return save(db, { leadId: lead.id, url: '', status: 'sem_site', reason: 'este lead não tem site — é precisamente a oportunidade', actor });
  }
  const url = /^https?:/i.test(raw) ? raw : `https://${raw}`;
  const bad = permissive ? '' : unsafeTarget(url);
  if (bad) return save(db, { leadId: lead.id, url, status: 'bloqueado', reason: bad, actor });

  const pathname = new URL(url).pathname || '/';
  const robots = await robotsAllows(url, pathname, { fetchImpl, timeoutMs });
  if (!robots.allowed) return save(db, { leadId: lead.id, url, status: 'bloqueado', reason: robots.note, actor });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) {
      const reason = res.status === 404 ? 'a página não existe (404)' : res.status === 403 ? 'o site recusa leituras automáticas (403)' : `o site respondeu ${res.status}`;
      return save(db, { leadId: lead.id, url, status: 'falhou', reason, actor });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return save(db, { leadId: lead.id, url, status: 'falhou', reason: `a página é enorme (${Math.round(buf.byteLength / 1024)} KB) — não vale a pena ler`, actor });
    }
    const html = new TextDecoder('utf-8').decode(buf);
    if (!/<html|<!doctype/i.test(html.slice(0, 2000))) {
      return save(db, { leadId: lead.id, url, status: 'falhou', reason: 'o que veio não era uma página', actor });
    }
    const facts = parseHtml(html, res.url || url);
    const ev = conclusions({ ...facts, category: lead.category });
    const { text, ...small } = facts; // o texto inteiro não fica guardado: só o que se prova
    const data = { ...small, bytes: buf.byteLength, finalUrl: res.url || url, robots: robots.note };
    return save(db, { leadId: lead.id, url, status: 'ok', data, evidence: ev, actor });
  } catch (e) {
    // o fetch do Node esconde a causa: «fetch failed» não diz nada a ninguém. Vai-se ao cause.
    const code = e.cause?.code || e.code || '';
    const all = `${e.message} ${e.cause?.message || ''}`;
    const reason = e.name === 'AbortError'
      ? `o site não respondeu em ${Math.round(timeoutMs / 1000)} s`
      : /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(code + all) ? 'o domínio não existe (ou não tem DNS)'
        : /ECONNREFUSED/i.test(code + all) ? 'o servidor do site recusou a ligação'
          : /ECONNRESET|socket hang up/i.test(code + all) ? 'o site cortou a ligação a meio'
            : /CERT|SSL|TLS/i.test(code + all) ? 'o certificado do site está inválido'
              : /ETIMEDOUT/i.test(code + all) ? 'o site demorou demasiado a responder'
                : `não consegui ler: ${e.cause?.message || e.message}`;
    return save(db, { leadId: lead.id, url, status: 'falhou', reason, actor });
  } finally { clearTimeout(timer); }
}

/** O dossiê: o que sabemos, o que nos falta, e o que isso muda na nota. */
export function dossier(db, lead) {
  const r = latest(db, lead.id);
  const facts = r?.data || {};
  const evidence = r?.evidence || [];
  const score = evidence.reduce((a, c) => a + (c.weight || 0), 0);
  return {
    lead: { id: lead.id, name: lead.name, city: lead.city, website: lead.website, phone: lead.phone, email: lead.email, category: lead.category, rating: lead.rating, reviews: lead.reviews },
    research: r ? { status: r.status, reason: r.reason, url: r.url, fetchedAt: r.fetched_at, facts } : { status: 'por_fazer' },
    evidence,
    opportunity: Math.max(0, Math.min(100, score)),
    quotes: evidence.filter(e => /descricao|titulo|desactualizado|plataforma/.test(e.key) && e.quote).map(e => e.quote),
  };
}
