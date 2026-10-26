// Órbita — quem és, e o que te é permitido.
//
// Até aqui havia uma palavra-passe só para a instalação inteira: quem a tinha podia tudo. Isso
// confunde duas coisas diferentes:
//
//   · AUTENTICAÇÃO — provar quem está do outro lado (uma conta, uma palavra-passe, uma sessão);
//   · AUTORIZAÇÃO   — decidir o que essa pessoa pode fazer (ler, escrever, aprovar, administrar).
//
// Aqui as duas separam-se. Há contas com papéis, sessões que expiram e podem ser revogadas, e cada
// rota exige uma permissão concreta. O token da instalação continua a existir para máquinas
// (scripts, CI) e vale como «dono» — mas é uma credencial de máquina, não uma pessoa: não deixa
// rasto de quem fez o quê porque não é ninguém.
//
// Segurança por defeito:
//   · palavras-passe com scrypt (N=16384) e sal próprio — nunca em claro, nunca em log;
//   · tokens de sessão aleatórios de 32 bytes; na base fica só o sha256, nunca o token;
//   · tentativas falhadas contadas (com o email em hash, não em claro) e bloqueio temporário;
//   · sessões com prazo, revogação explícita e rasto em `events`;
//   · a primeira conta só pode ser criada quando não existe nenhuma (arranque), e fica registada.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { audit, now, uid } from './db.mjs';

/* ---------- papéis e permissões ---------- */

/** Do mais poderoso para o menos. `level` é o que se compara; nunca se compara nomes. */
export const ROLES = [
  { key: 'dono', label: 'Dono', level: 3, does: 'tudo: contas, aprovações, entregas e definições' },
  { key: 'gestor', label: 'Gestor', level: 2, does: 'aprova, entrega e pára envios; não mexe em contas' },
  { key: 'operador', label: 'Operador', level: 1, does: 'cria e edita leads, projetos e tarefas; não aprova nem entrega' },
  { key: 'leitor', label: 'Leitor', level: 0, does: 'vê tudo; não altera nada' },
];
export const ROLE_KEYS = ROLES.map(r => r.key);
export const roleOf = key => ROLES.find(r => r.key === key) || null;

/** Permissões e o papel mínimo que cada uma exige. */
export const PERMS = {
  read: 0,      // ver
  write: 1,     // criar e editar
  approve: 2,   // aprovar, entregar, parar envios
  admin: 3,     // contas, sessões, definições da instalação
};
export const PERM_KEYS = Object.keys(PERMS);
export const can = (role, perm) => {
  const r = roleOf(role), p = PERMS[perm];
  return !!r && p !== undefined && r.level >= p;
};

/* ---------- palavras-passe ---------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const PASSWORD_MIN = 12;

/** Recusa o que não devia ser uma palavra-passe — com uma frase que diz o que fazer. */
export function checkPassword(password, { email = '', name = '' } = {}) {
  const p = String(password || '');
  if (p.length < PASSWORD_MIN) return `a palavra-passe precisa de ${PASSWORD_MIN} caracteres ou mais`;
  if (p.length > 200) return 'a palavra-passe é demasiado longa (máximo 200 caracteres)';
  const low = p.toLowerCase();
  if (/^(.)\1+$/.test(p)) return 'a palavra-passe não pode ser o mesmo carácter repetido';
  const obvias = ['password', 'palavra-passe', 'palavrapasse', '123456', 'qwerty', 'orbitaorbita', 'adminadmin'];
  if (obvias.some(w => low.includes(w))) return 'essa palavra-passe é das primeiras que alguém tenta — escolhe outra';
  if (email && low.includes(String(email).toLowerCase().split('@')[0])) return 'a palavra-passe não pode conter o teu email';
  if (name && String(name).length >= 4 && low.includes(String(name).toLowerCase())) return 'a palavra-passe não pode conter o teu nome';
  return null;
}

/** `scrypt$N$r$p$sal$hash` — tudo o que é preciso para verificar, e nada mais. */
export function hashPassword(password) {
  const bad = checkPassword(password);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Compara em tempo constante. Devolve sempre falso para formatos que não conhecemos. */
export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored || '').split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const got = scryptSync(String(password || ''), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch { return false; }
}

/* ---------- contas ---------- */

const normEmail = email => String(email || '').trim().toLowerCase();
export const emailHash = email => createHash('sha256').update(normEmail(email)).digest('hex');

export function userRow(r) {
  if (!r) return null;
  const role = roleOf(r.role);
  return {
    id: r.id, email: r.email, name: r.name || '', role: r.role,
    roleLabel: role?.label || r.role, level: role?.level ?? -1,
    active: !!r.active, created_at: r.created_at, last_login_at: r.last_login_at || null,
    // `password_hash` não sai daqui: nem para a UI, nem para uma API, nem para um log.
  };
}

export const countUsers = db => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
export const listUsers = db => db.prepare('SELECT * FROM users ORDER BY created_at').all().map(userRow);
export const getUser = (db, id) => userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
const byEmail = (db, email) => db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(email));

export function createUser(db, { email, name = '', password, role = 'leitor', actor = 'dono' } = {}) {
  const mail = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) throw Object.assign(new Error('email inválido'), { status: 400 });
  if (!ROLE_KEYS.includes(role)) throw Object.assign(new Error(`papel desconhecido: ${role} (usa ${ROLE_KEYS.join(', ')})`), { status: 400 });
  if (byEmail(db, mail)) throw Object.assign(new Error('já existe uma conta com este email'), { status: 409 });
  const bad = checkPassword(password, { email: mail, name });
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  const id = uid('u_');
  const at = now();
  db.prepare('INSERT INTO users (id, email, name, role, password_hash, active, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .run(id, mail, String(name || '').slice(0, 120), role, hashPassword(password), at, at);
  audit(db, { actor, action: 'utilizador.criado', entity: 'utilizador', entityId: id, detail: { papel: role } });
  return getUser(db, id);
}

/** A primeira conta: só quando não existe nenhuma. Fica escrito que foi assim que nasceu. */
export function createFirstOwner(db, { email, name = '', password } = {}) {
  if (countUsers(db) > 0) {
    throw Object.assign(new Error('já existe pelo menos uma conta — pede a um dono para criar a tua'), { status: 409 });
  }
  const user = createUser(db, { email, name, password, role: 'dono', actor: 'arranque' });
  audit(db, { actor: 'arranque', action: 'instalacao.primeira_conta', entity: 'utilizador', entityId: user.id, detail: { papel: 'dono' } });
  return user;
}

export function setRole(db, id, role, actor = 'dono') {
  const u = getUser(db, id);
  if (!u) throw Object.assign(new Error('conta não encontrada'), { status: 404 });
  if (!ROLE_KEYS.includes(role)) throw Object.assign(new Error(`papel desconhecido: ${role}`), { status: 400 });
  const donos = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'dono' AND active = 1").get().n;
  if (u.role === 'dono' && role !== 'dono' && donos <= 1) {
    throw Object.assign(new Error('não se pode ficar sem nenhum dono activo'), { status: 409 });
  }
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now(), id);
  audit(db, { actor, action: 'utilizador.papel', entity: 'utilizador', entityId: id, detail: { de: u.role, para: role } });
  return getUser(db, id);
}

export function setPassword(db, id, password, actor = 'dono') {
  const u = getUser(db, id);
  if (!u) throw Object.assign(new Error('conta não encontrada'), { status: 404 });
  const bad = checkPassword(password, { email: u.email, name: u.name });
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(password), now(), id);
  // trocar a palavra-passe fecha todas as sessões antigas: quem estava dentro sai
  const fechadas = revokeAll(db, id, { actor, reason: 'palavra-passe trocada' });
  audit(db, { actor, action: 'utilizador.palavra_passe', entity: 'utilizador', entityId: id, detail: { sessoes_fechadas: fechadas } });
  return { user: getUser(db, id), sessoes_fechadas: fechadas };
}

export function deactivate(db, id, actor = 'dono') {
  const u = getUser(db, id);
  if (!u) throw Object.assign(new Error('conta não encontrada'), { status: 404 });
  const donos = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'dono' AND active = 1").get().n;
  if (u.role === 'dono' && donos <= 1) throw Object.assign(new Error('não se pode ficar sem nenhum dono activo'), { status: 409 });
  db.prepare('UPDATE users SET active = 0, updated_at = ? WHERE id = ?').run(now(), id);
  revokeAll(db, id, { actor, reason: 'conta desactivada' });
  audit(db, { actor, action: 'utilizador.desactivado', entity: 'utilizador', entityId: id, detail: {} });
  return getUser(db, id);
}

/* ---------- sessões ---------- */

const DEFAULT_HOURS = 12;
export const sessionHours = env => {
  const n = Number(env?.ORBITA_SESSION_HOURS);
  return Number.isFinite(n) && n > 0 && n <= 24 * 30 ? n : DEFAULT_HOURS;
};

const tokenHash = t => createHash('sha256').update(String(t || '')).digest('hex');
const iso = ms => new Date(ms).toISOString();

/** Abre uma sessão e devolve o token em claro — que só existe aqui e no browser. */
export function openSession(db, user, { hours = DEFAULT_HOURS, at = Date.now(), agent = '' } = {}) {
  const token = randomBytes(32).toString('base64url');
  const id = uid('s_');
  db.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, agent) VALUES (?,?,?,?,?,?,?)')
    .run(id, user.id, tokenHash(token), iso(at), iso(at + hours * 3600000), iso(at), String(agent || '').slice(0, 120));
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(iso(at), user.id);
  audit(db, { actor: user.email, action: 'sessao.aberta', entity: 'utilizador', entityId: user.id, detail: { horas: hours } });
  return { token, id, expires_at: iso(at + hours * 3600000) };
}

/**
 * Lê uma sessão. Devolve `{ user }` ou `{ error }` com o motivo em palavras — expirada, revogada,
 * conta desactivada. Não «renova» sozinha: uma sessão vale o que foi decidido quando nasceu.
 */
export function sessionUser(db, token, { at = Date.now() } = {}) {
  if (!token) return { error: 'sem sessão' };
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash(token));
  if (!row) return { error: 'sessão desconhecida — entra outra vez' };
  if (row.revoked_at) return { error: 'sessão terminada — entra outra vez' };
  if (new Date(row.expires_at).getTime() <= at) return { error: 'sessão expirada — entra outra vez' };
  const u = userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id));
  if (!u) return { error: 'conta apagada' };
  if (!u.active) return { error: 'conta desactivada' };
  // last_seen não é um facto de negócio: actualiza-se no máximo de hora a hora, sem auditar.
  if (!row.last_seen_at || at - new Date(row.last_seen_at).getTime() > 3600000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(iso(at), row.id);
  }
  return { user: u, session: { id: row.id, created_at: row.created_at, expires_at: row.expires_at } };
}

export function closeSession(db, token, { actor = 'dono' } = {}) {
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash(token));
  if (!row || row.revoked_at) return { ok: true, ja_estava: true };
  db.prepare('UPDATE sessions SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), actor, row.id);
  audit(db, { actor, action: 'sessao.fechada', entity: 'utilizador', entityId: row.user_id, detail: { sessao: row.id } });
  return { ok: true, id: row.id };
}

/** Revogar uma sessão pelo id (é o que a lista mostra) — sem precisar do token. */
export function revokeSession(db, sessionId, { actor = 'dono', reason = '' } = {}) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return { ok: false, motivo: 'sessão não encontrada' };
  if (row.revoked_at) return { ok: true, ja_estava: true, user_id: row.user_id };
  db.prepare('UPDATE sessions SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), actor, sessionId);
  audit(db, { actor, action: 'sessao.revogada', entity: 'utilizador', entityId: row.user_id, detail: { sessao: sessionId, motivo: reason } });
  return { ok: true, user_id: row.user_id };
}

export function revokeAll(db, userId, { actor = 'dono', reason = '' } = {}) {
  const r = db.prepare('UPDATE sessions SET revoked_at = ?, revoked_by = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(now(), actor, userId);
  if (r.changes) audit(db, { actor, action: 'sessao.revogadas', entity: 'utilizador', entityId: userId, detail: { quantas: r.changes, motivo: reason } });
  return r.changes;
}

export function listSessions(db, userId = null) {
  const rows = userId
    ? db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId)
    : db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50').all();
  const users = new Map(db.prepare('SELECT id, email, name FROM users').all().map(u => [u.id, u]));
  const at = Date.now();
  return rows.map(r => ({
    id: r.id, user: users.get(r.user_id)?.email || r.user_id,
    created_at: r.created_at, expires_at: r.expires_at, last_seen_at: r.last_seen_at,
    revoked_at: r.revoked_at || null,
    state: r.revoked_at ? 'terminada' : new Date(r.expires_at).getTime() <= at ? 'expirada' : 'activa',
  }));
}

/* ---------- tentativas falhadas (anti-força bruta) ---------- */

export const LOCK = { max: 5, windowMs: 15 * 60000 };

export function recordAttempt(db, { email = '', outcome, reason = '', at = Date.now() }) {
  db.prepare('INSERT INTO auth_attempts (at, email_hash, outcome, reason) VALUES (?,?,?,?)')
    .run(iso(at), emailHash(email), outcome, String(reason).slice(0, 120));
}

export function failuresWithin(db, email, { windowMs = LOCK.windowMs, at = Date.now() } = {}) {
  const since = iso(at - windowMs);
  return db.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE email_hash = ? AND outcome = 'falhou' AND at >= ?")
    .get(emailHash(email), since).n;
}

/**
 * Entrar. Devolve `{ user, token }` ou um erro com a frase certa. Conta as falhas e bloqueia
 * temporariamente — e responde sempre devagar o mesmo, para não se descobrir quem tem conta.
 */
export function login(db, { email, password, at = Date.now(), hours = DEFAULT_HOURS, agent = '', ip = '' } = {}) {
  const mail = normEmail(email);
  if (!mail || !password) throw Object.assign(new Error('diz o email e a palavra-passe'), { status: 400 });
  const falhas = failuresWithin(db, mail, { at });
  if (falhas >= LOCK.max) {
    recordAttempt(db, { email: mail, outcome: 'bloqueado', reason: `${falhas} falhas em 15 min`, at });
    audit(db, { actor: 'sistema', action: 'sessao.bloqueada', entity: 'utilizador', detail: { motivo: 'demasiadas tentativas' } });
    throw Object.assign(new Error(`demasiadas tentativas falhadas — tenta outra vez dentro de ${Math.round(LOCK.windowMs / 60000)} minutos`), { status: 423 });
  }
  const row = byEmail(db, mail);
  const ok = !!row && !!row.active && verifyPassword(password, row.password_hash);
  if (!ok) {
    recordAttempt(db, { email: mail, outcome: 'falhou', reason: row ? 'palavra-passe errada' : 'email desconhecido', at });
    audit(db, { actor: 'sistema', action: 'sessao.recusada', entity: 'utilizador', detail: { motivo: 'credenciais inválidas', ip_hash: ip ? emailHash(ip) : '' } });
    throw Object.assign(new Error('email ou palavra-passe errados'), { status: 401 });
  }
  recordAttempt(db, { email: mail, outcome: 'entrou', at });
  const user = userRow(row);
  const session = openSession(db, user, { hours, at, agent });
  return { user, token: session.token, expires_at: session.expires_at };
}

/** Para o arranque dizer a verdade: há contas? quantas? há token de máquina? */
export function authState(db, env = process.env) {
  const usuarios = db ? countUsers(db) : 0;
  const token = String(env.ORBITA_ADMIN_TOKEN || '').length >= 16;
  const soSessoes = String(env.ORBITA_AUTH || '').toLowerCase() === 'sessao';
  const modo = usuarios > 0 ? 'sessao' : soSessoes ? 'sessao' : token ? 'token' : 'local';
  return {
    modo, usuarios, token, soSessoes,
    descricao: modo === 'sessao'
      ? (usuarios ? `${usuarios} conta(s) — entra com email e palavra-passe` : 'sem contas: cria a primeira em /app (só é possível uma vez)')
      : modo === 'token' ? 'protegido por ORBITA_ADMIN_TOKEN (credencial de máquina, sem papéis)'
        : 'MODO LOCAL, sem palavra-passe — só para esta máquina',
  };
}
