// Órbita — a pesquisa real (Google), 25 out 2026.
//
// O escritório sabia falar; não sabia procurar. Este módulo liga duas APIs da Google que dão
// matéria-prima verdadeira à prospeção:
//
//   · Google Places API (New) — `places:searchText`. Empresas reais: nome, morada, telefone,
//     site, avaliação, número de avaliações e link do Maps. É isto que faz um lead a sério.
//   · Programmable Search (Custom Search JSON API) — pesquisa web com resultados e excertos.
//     Serve para contexto: notícias, sites, concorrência, o que a empresa diz de si.
//
// Regras, as mesmas da camada de IA:
//   · Nada é inventado. Sem chave, o serviço diz exatamente que variável de ambiente falta.
//   · As chaves vivem SÓ no ambiente — nunca em ficheiros versionados.
//   · O que se encontra é gravado em `data/leads.json`, sem duplicados (domínio → telefone → nome).
//   · Só se escreve a quem está na lista. Enviar, contactar ou pagar continua a exigir o OK do
//     proprietário — a pesquisa não muda isso.
import fs from 'node:fs';
import path from 'node:path';

// Os endereços podem ser trocados por ambiente: serve para proxies empresariais e para testar o
// caminho inteiro contra um servidor local (é assim que esta camada é verificada sem chave).
const PLACES_URL = process.env.GOOGLE_PLACES_URL || 'https://places.googleapis.com/v1/places:searchText';
const CSE_URL = process.env.GOOGLE_CSE_URL || 'https://www.googleapis.com/customsearch/v1';
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.internationalPhoneNumber', 'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.googleMapsUri', 'places.primaryTypeDisplayName', 'places.businessStatus', 'places.addressComponents',
].join(',');

/* ---------- quem está ligado ---------- */
const env = (...names) => { for (const n of names) if (process.env[n]) return { key: process.env[n], env: n }; return null; };

/** O estado das duas APIs, com a razão em português quando falta alguma coisa. */
export function state() {
  const placesKey = env('GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_API_KEY');
  const cseKey = env('GOOGLE_API_KEY', 'GOOGLE_CSE_KEY');
  const cseId = env('GOOGLE_CSE_ID', 'GOOGLE_SEARCH_ENGINE_ID');
  return {
    places: {
      available: !!placesKey,
      env: placesKey?.env || 'GOOGLE_MAPS_API_KEY',
      reason: placesKey ? null : 'falta a chave da Places API — põe GOOGLE_MAPS_API_KEY no ambiente (e liga "Places API (New)" no projeto da Google Cloud)',
      what: 'empresas reais: nome, morada, telefone, site, avaliação',
    },
    web: {
      available: !!(cseKey && cseId),
      env: cseKey ? `${cseKey.env} + ${cseId?.env || 'GOOGLE_CSE_ID'}` : 'GOOGLE_API_KEY + GOOGLE_CSE_ID',
      reason: !cseKey ? 'falta a chave — põe GOOGLE_API_KEY no ambiente'
        : !cseId ? 'falta o identificador do motor — cria um Programmable Search Engine e põe GOOGLE_CSE_ID'
          : null,
      what: 'pesquisa web: resultados, excertos e links',
    },
    any: !!(placesKey || (cseKey && cseId)),
    note: 'o Places dá leads; o Programmable Search dá contexto. Nenhum dos dois envia nada a ninguém — isso continua a exigir o teu OK.',
  };
}

/* ---------- as chamadas ---------- */
const timeout = (ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };

async function googleError(r) {
  let detail = '';
  try {
    const j = await r.json();
    detail = j?.error?.message || j?.error?.errors?.[0]?.message || '';
  } catch { /* sem corpo JSON */ }
  if (r.status === 403 || r.status === 400) return new Error(`a Google recusou (${r.status})${detail ? ': ' + detail : ''} — confirma que a API está ligada no projeto e que a chave não tem restrições de IP`);
  if (r.status === 429) return new Error('a Google está a limitar os pedidos (429) — espera um pouco ou sobe a quota');
  if (r.status === 401) return new Error('a chave da Google não é aceite (401) — confirma a variável de ambiente');
  return new Error(`a Google respondeu ${r.status}${detail ? ': ' + detail : ''}`);
}

/** Empresas reais. `what` = atividade ("clínicas dentárias"), `where` = sítio ("Lisboa"). */
export async function searchPlaces({ what, where, limit = 20, lang = 'pt-PT', region = 'PT' } = {}) {
  const s = state().places;
  if (!s.available) throw new Error(s.reason);
  const key = env('GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_API_KEY').key;
  const textQuery = [what, where].filter(Boolean).join(' em ') || what || where;
  if (!textQuery) throw new Error('diz o que procurar — por exemplo «clínicas dentárias em Lisboa»');
  const t = timeout(20000);
  let r;
  try {
    r = await fetch(PLACES_URL, {
      method: 'POST', signal: t.signal,
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify({ textQuery, languageCode: lang, regionCode: region, maxResultCount: Math.max(1, Math.min(20, limit)) }),
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'o Places não respondeu em 20 s' : `não consegui chegar ao Places: ${e.message}`);
  } finally { t.done(); }
  if (!r.ok) throw await googleError(r);
  const j = await r.json();
  return (j.places || []).map(toLead).filter(Boolean);
}

function toLead(p) {
  const name = p.displayName?.text || '';
  if (!name) return null;
  const city = (p.addressComponents || []).find(c => (c.types || []).includes('locality'))?.longText
    || (p.formattedAddress || '').split(',').slice(-2, -1)[0]?.trim() || '';
  const website = p.websiteUri || '';
  const phone = p.nationalPhoneNumber || p.internationalPhoneNumber || '';
  const rating = typeof p.rating === 'number' ? p.rating : null;
  const reviews = typeof p.userRatingCount === 'number' ? p.userRatingCount : null;
  const { score, why } = scoreLead({ website, rating, reviews, phone });
  return {
    source: 'places', name, city, address: p.formattedAddress || '', phone, website,
    rating, reviews, mapsUrl: p.googleMapsUri || '', type: p.primaryTypeDisplayName?.text || '',
    score, why, placeId: p.id || '',
  };
}

/** A nota de oportunidade, com a razão escrita — nada de números mágicos. */
export function scoreLead({ website, rating, reviews, phone }) {
  const bits = [];
  let score = 40;
  if (!website) { score += 40; bits.push('sem site'); } else bits.push('já tem site');
  if (phone) { score += 8; bits.push('telefone público'); } else bits.push('sem telefone público');
  if (rating != null && rating < 4.2) { score += 8; bits.push(`avaliação ${rating.toFixed(1)}`); }
  else if (rating != null && rating >= 4.6) { score += 4; bits.push(`avaliação ${rating.toFixed(1)} (bom sinal)`); }
  if ((reviews || 0) >= 50) { score += 4; bits.push(`${reviews} avaliações`); }
  return { score: Math.max(0, Math.min(100, score)), why: bits.join(' · ') };
}

/** Pesquisa web (Programmable Search). Serve para contexto, não para leads. */
export async function searchWeb({ q, limit = 10, lang = 'pt' } = {}) {
  const s = state().web;
  if (!s.available) throw new Error(s.reason);
  if (!q) throw new Error('diz o que pesquisar');
  const key = env('GOOGLE_API_KEY', 'GOOGLE_CSE_KEY').key;
  const cx = env('GOOGLE_CSE_ID', 'GOOGLE_SEARCH_ENGINE_ID').key;
  const url = `${process.env.GOOGLE_CSE_URL || CSE_URL}?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=${Math.max(1, Math.min(10, limit))}&hl=${lang}`;
  const t = timeout(15000);
  let r;
  try { r = await fetch(url, { signal: t.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'a pesquisa não respondeu em 15 s' : `não consegui chegar à Google: ${e.message}`); }
  finally { t.done(); }
  if (!r.ok) throw await googleError(r);
  const j = await r.json();
  return (j.items || []).map(it => ({
    source: 'web', name: it.title || '', website: it.link || '', snippet: it.snippet || '',
    address: '', phone: '', rating: null, reviews: null, mapsUrl: '', type: it.displayLink || '',
    ...scoreLead({ website: it.link, rating: null, reviews: null, phone: '' }),
  }));
}

/* ---------- a lista de leads (data/leads.json) ---------- */
const file_ = dir => path.join(dir || 'data', 'leads.json');
function read(dir) { try { return JSON.parse(fs.readFileSync(file_(dir), 'utf8')); } catch { return { updated: null, leads: [] }; } }
function write(dir, data) { fs.mkdirSync(dir || 'data', { recursive: true }); fs.writeFileSync(file_(dir), JSON.stringify(data, null, 2)); return data; }

export const domainOf = url => {
  try { return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};
const digits = s => String(s || '').replace(/\D+/g, '');
const sluggy = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A chave de identidade de um lead: domínio, senão telefone, senão nome+morada. */
export function keyOf(l) {
  const d = domainOf(l.website);
  if (d && !/google\.|facebook\.|instagram\.|linkedin\./i.test(d)) return 'd:' + d;
  const ph = digits(l.phone);
  if (ph.length >= 9) return 'p:' + ph.slice(-9);
  return 'n:' + sluggy(l.name) + '|' + sluggy(l.city || l.address).slice(0, 24);
}

/** Guarda sem duplicar. Devolve { added, updated, total, leads }. */
export function saveAll(list, dir) {
  const data = read(dir);
  const byKey = new Map(data.leads.map(l => [l.key || keyOf(l), l]));
  let added = 0, updated = 0;
  for (const raw of list) {
    const k = keyOf(raw);
    const prev = byKey.get(k);
    const now = { ...raw, key: k, foundAt: raw.foundAt || new Date().toISOString() };
    if (prev) {
      // o que já estava guardado ganha em estado e notas; os dados factuais vêm frescos
      byKey.set(k, { ...prev, ...now, status: prev.status || 'novo', note: prev.note || '', id: prev.id, foundAt: prev.foundAt });
      updated++;
    } else {
      byKey.set(k, { ...now, id: 'l' + Math.random().toString(36).slice(2, 9), status: 'novo', note: '' });
      added++;
    }
  }
  const leads = [...byKey.values()].sort((a, b) => b.score - a.score);
  write(dir, { updated: new Date().toISOString(), leads });
  return { added, updated, total: leads.length, leads };
}

export function list({ limit = 50, status = null } = {}, dir) {
  const leads = read(dir).leads
    .filter(l => (status ? l.status === status : true))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  return { total: leads.length, leads: leads.slice(0, limit) };
}

export function stats(dir) {
  const leads = read(dir).leads;
  const by = {};
  for (const l of leads) by[l.status || 'novo'] = (by[l.status || 'novo'] || 0) + 1;
  return { total: leads.length, byStatus: by, noSite: leads.filter(l => !l.website).length, withPhone: leads.filter(l => l.phone).length };
}

export function setStatus(id, status, dir) {
  const data = read(dir);
  const l = data.leads.find(x => x.id === id);
  if (!l) return null;
  l.status = status; l.touchedAt = new Date().toISOString();
  write(dir, data);
  return l;
}

/** O bloco que os agentes de prospeção e vendas leem no início de cada tarefa. */
export function contextForAgent({ limit = 8, dir, onlyNew = true } = {}) {
  const leads = read(dir).leads
    .filter(l => (onlyNew ? (l.status || 'novo') === 'novo' : true) && l.source === 'places')
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
  if (!leads.length) return '';
  const lines = leads.map(l => `— ${l.name}${l.city ? ' · ' + l.city : ''}${l.phone ? ' · ' + l.phone : ''}${l.website ? ' · ' + domainOf(l.website) : ' · sem site'}${l.rating ? ` · ${l.rating}★ (${l.reviews || 0})` : ''} · nota ${l.score} (${l.why})`);
  return `LEADS REAIS (pesquisa Google Places, ${leads.length} de ${stats(dir).total} guardados)\n${lines.join('\n')}\n\nEscreve para estes negócios reais — usa o nome, a cidade e o que sabes deles. Não inventes contactos: se falta o email, diz que falta.`;
}
