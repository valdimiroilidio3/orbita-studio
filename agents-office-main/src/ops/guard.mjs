// Órbita — a guarda da porta.
//
// O Órbita é local-first: por omissão não há palavra-passe, porque só tu lhe tocas. Isso deixa de
// ser verdade no dia em que ele escuta numa rede — e é por isso que existe aqui uma segunda
// opção, explícita: define `ORBITA_ADMIN_TOKEN` (16+ caracteres) e todas as rotas `/api/ops`
// passam a exigi-lo. Sem essa variável, o servidor diz no arranque que está em modo local.
//
// Também há um limitador de pedidos por IP, para uma página aberta num separador não conseguir
// esgotar o processo com um ciclo de fetch.
//
// E há contas (src/ops/auth.mjs): quem entra tem um papel, e o papel decide o que pode fazer.
// Autenticar não é autorizar — esta guarda separa as duas coisas e devolve as duas.
import { timingSafeEqual } from 'node:crypto';
import { authState, can, countUsers, sessionUser } from './auth.mjs';

export const ADMIN_HEADER = 'x-orbita-admin';
export const SESSION_COOKIE = 'orbita_sessao';
export const SESSION_HEADER = 'x-orbita-session';

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

/** O token de sessão vem no cookie (browser) ou num cabeçalho (scripts e testes). */
export function sessionToken(req) {
  return req.headers?.[SESSION_HEADER] || cookie(req, SESSION_COOKIE);
}

/**
 * Quem está do outro lado — e o que pode fazer.
 *
 * Ordem: 1) sessão de utilizador (pessoa, com papel); 2) token da instalação (máquina, vale como
 * dono, sem rasto de «quem»); 3) modo local, só quando não há contas nem token.
 */
export function authenticate(req, { env = process.env, db = null } = {}) {
  const state = authState(db, env);
  const token = sessionToken(req);
  if (db && token) {
    const found = sessionUser(db, token);
    if (found.user) return result({ mode: 'sessao', user: found.user, role: found.user.role });
    if (state.modo === 'sessao') {
      return { ok: false, mode: 'sessao', hint: 'sessao', error: found.error || 'entra com a tua conta' };
    }
  }

  const machineToken = adminMode(env) === 'token';
  if (machineToken && !state.soSessoes) {
    const given = presented(req);
    if (given && equal(given, String(env.ORBITA_ADMIN_TOKEN))) {
      return result({ mode: 'token', user: null, role: 'dono', machine: true });
    }
  }

  if (state.modo === 'sessao') {
    const contas = db ? countUsers(db) : 0;
    return {
      ok: false, mode: 'sessao', hint: contas ? 'sessao' : 'primeira-conta',
      error: contas
        ? 'esta instalação tem contas: entra com email e palavra-passe'
        : 'esta instalação ainda não tem contas: cria a primeira (só é possível uma vez)',
    };
  }
  if (machineToken) {
    return { ok: false, mode: 'token', error: 'esta instalação está protegida: falta o token de administração (cabeçalho x-orbita-admin, ou Bearer)' };
  }
  // modo local: só quando não há contas nem token — e o arranque di-lo em voz alta
  return result({ mode: 'local', user: null, role: 'dono', local: true });
}

function result({ mode, user = null, role, machine = false, local = false }) {
  return {
    ok: true, mode, user, role, machine, local,
    roleLabel: (role || '').charAt(0).toUpperCase() + (role || '').slice(1),
    can: perm => can(role, perm),
    perms: { read: can(role, 'read'), write: can(role, 'write'), approve: can(role, 'approve'), admin: can(role, 'admin') },
  };
}

/** O cookie da sessão: HttpOnly (o JavaScript não o lê), SameSite=Strict, Secure em https. */
export function sessionCookie(token, { maxAgeSeconds = 12 * 3600, secure = false } = {}) {
  const bits = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export function clearSessionCookie({ secure = false } = {}) {
  const bits = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** Só em https (directo ou atrás de um proxy que o diga) é que o cookie leva `Secure`. */
export function wantsSecureCookie(req, env = process.env) {
  if (String(env.ORBITA_SECURE_COOKIE || '') === '1') return true;
  if (String(env.ORBITA_SECURE_COOKIE || '') === '0') return false;
  return String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
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
  if (!cookie(req, 'orbita_admin') && !cookie(req, SESSION_COOKIE)) return { ok: true }; // sem cookie, não há CSRF por cookie
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
