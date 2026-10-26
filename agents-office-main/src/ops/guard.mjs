// Órbita — a guarda da porta.
//
// O Órbita é local-first: por omissão não há palavra-passe, porque só tu lhe tocas. Isso deixa de
// ser verdade no dia em que ele escuta numa rede — e é por isso que existe aqui uma segunda
// opção, explícita: define `ORBITA_ADMIN_TOKEN` (16+ caracteres) e todas as rotas `/api/ops`
// passam a exigi-lo. Sem essa variável, o servidor diz no arranque que está em modo local.
//
// Também há um limitador de pedidos por IP, para uma página aberta num separador não conseguir
// esgotar o processo com um ciclo de fetch.
import { timingSafeEqual } from 'node:crypto';

export const ADMIN_HEADER = 'x-orbita-admin';

/** Modo de autenticação: 'token' quando há um segredo configurado, 'local' quando não há. */
export function adminMode(env = process.env) {
  return String(env.ORBITA_ADMIN_TOKEN || '').length >= 16 ? 'token' : 'local';
}

const equal = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
};

function cookie(req, name) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

/** A credencial vem no cabeçalho, num Bearer, ou num cookie — a mesa usa o cabeçalho. */
export function presented(req) {
  const header = req.headers?.[ADMIN_HEADER] || '';
  if (header) return String(header);
  const auth = req.headers?.authorization || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '');
  return cookie(req, 'orbita_admin');
}

export function authorized(req, env = process.env) {
  if (adminMode(env) === 'local') return { ok: true, mode: 'local' };
  const token = String(env.ORBITA_ADMIN_TOKEN);
  const given = presented(req);
  if (given && equal(given, token)) return { ok: true, mode: 'token' };
  return {
    ok: false, mode: 'token',
    error: 'esta instalação está protegida: falta o token de administração (cabeçalho x-orbita-admin, ou Bearer)',
  };
}

/**
 * CSRF: se a credencial veio num cookie (o browser anexa-o sozinho a pedidos de outros sites) e o
 * pedido muda estado, exigimos a mesma origem. Com o cabeçalho ou o Bearer isto é irrelevante —
 * um site estranho não consegue pôr cabeçalhos no nosso domínio.
 */
export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export function sameOrigin(req, host = req.headers?.host || '') {
  const origin = req.headers?.origin;
  if (!origin) {
    // sem Origin: ou não é um browser, ou é um `fetch` da mesma origem antigo. Nesse caso olhamos
    // para o Referer; se também não houver, deixamos passar (não há cookie anexado por terceiros).
    const ref = req.headers?.referer;
    if (!ref) return { ok: true, reason: 'sem origem declarada' };
    try { return { ok: new URL(ref).host === host, reason: 'referer' }; } catch { return { ok: false, reason: 'referer inválido' }; }
  }
  try { return { ok: new URL(origin).host === host, reason: 'origin' }; } catch { return { ok: false, reason: 'origin inválido' }; }
}

/** Um pedido mutável autenticado por cookie tem de vir da nossa origem. */
export function csrfOk(req) {
  if (SAFE_METHODS.includes(req.method)) return { ok: true };
  if (!cookie(req, 'orbita_admin')) return { ok: true }; // sem cookie, não há CSRF por cookie
  const host = req.headers?.host || '';
  const r = sameOrigin(req, host);
  return r.ok ? r : { ok: false, error: 'pedido de outra origem com credencial em cookie recusado (CSRF)' };
}

/**
 * Limitador por chave (IP) numa janela deslizante simples. Devolve `{ ok, restantes, espera }`.
 * Em memória de propósito: se o processo reinicia, a contagem recomeça — não é um facto de
 * negócio, é uma protecção.
 */
export function createLimiter({ windowMs = 60000, max = 300, now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const t = now();
      const list = (hits.get(key) || []).filter(x => t - x < windowMs);
      if (list.length >= max) {
        const oldest = list[0];
        hits.set(key, list);
        return { ok: false, restantes: 0, espera: Math.ceil((windowMs - (t - oldest)) / 1000) };
      }
      list.push(t);
      hits.set(key, list);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
      return { ok: true, restantes: max - list.length, espera: 0 };
    },
    reset() { hits.clear(); },
    get size() { return hits.size; },
  };
}
