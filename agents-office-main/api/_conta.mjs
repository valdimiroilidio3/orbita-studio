/* ===========================================================================
   1.54.0 · A PORTA.

   O que havia até aqui, e que o dono via todos os dias sem saber:
   `GET /auth/eu` respondia **sempre** `{ role: 'owner', perms: todos }`, a quem
   pedisse. `/auth/entrar` respondia `{ok:true}` sem olhar a nada. Não havia
   conta, não havia sessão, não havia verificação — havia um ecrã de entrada a
   fingir. Quem chegasse ao URL era dono.

   Este ficheiro é a fechadura. É a mesma ideia que já estava provada no Órbita
   local (`src/ops/auth.mjs`): papéis com níveis, scrypt com sal próprio, tokens
   de sessão aleatórios dos quais a base só guarda o sha256, tentativas contadas.
   O que muda é o sítio: passa a valer na Vercel, contra a base de dados, e não
   só na máquina do dono.

   Regras que este ficheiro NÃO quebra:
     · a palavra-passe nunca é guardada nem devolvida em claro (nem em log);
     · um token de sessão nunca é guardado em claro (só o sha256);
     · o papel é verificado NO SERVIDOR; a interface esconder botões é cortesia;
     · sem contas na base, a instalação diz isso e deixa criar a primeira — uma
       vez só, e com o SETUP_TOKEN quando ele existir;
     · o modo local (testes, browser) continua a funcionar sem contas: a porta
       só fecha onde há base de dados. Isto está dito em voz alta porque é uma
       decisão, não um esquecimento.
   =========================================================================== */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/* ---------- papéis e permissões ---------- */

/** Do mais poderoso para o menos. Compara-se `level`; nunca o nome. */
export const ROLES = [
  { key: 'dono', label: 'Dono', level: 3, does: 'tudo: contas, aprovações, envios e definições da instalação' },
  { key: 'gestor', label: 'Gestor', level: 2, does: 'aprova, entrega e pára envios; não mexe em contas' },
  { key: 'operador', label: 'Operador', level: 1, does: 'cria e edita leads, projetos e tarefas; não aprova nem entrega' },
  { key: 'leitor', label: 'Leitor', level: 0, does: 'vê tudo; não altera nada' },
];
export const ROLE_KEYS = ROLES.map((r) => r.key);
export const roleOf = (key) => ROLES.find((r) => r.key === key) || null;

/** Permissão → nível mínimo. */
export const PERMS = { read: 0, write: 1, approve: 2, admin: 3 };
export const PERM_KEYS = Object.keys(PERMS);
export const can = (role, perm) => {
  const r = roleOf(role);
  const p = PERMS[perm];
  return !!r && p !== undefined && r.level >= p;
};

/** O que a mesa lê em `S.eu.perms`. Os dois nomes valem (inglês e português). */
export function permisosDe(role) {
  const ler = can(role, 'read');
  const escrever = can(role, 'write');
  const aprovar = can(role, 'approve');
  const admin = can(role, 'admin');
  return {
    read: ler, write: escrever, approve: aprovar, admin,
    ver: ler, escrever, aprovar, ler: ler,
    /* a mesa pergunta por estes três em `may()` */
    ...(escrever ? {} : { write: false }),
  };
}

/* ---------- palavras-passe ---------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const PASSWORD_MIN = 12;

/** Recusa o que não devia ser uma palavra-passe — e diz o que fazer. */
export function checkPassword(password, { email = '', name = '' } = {}) {
  const p = String(password || '');
  if (p.length < PASSWORD_MIN) return `a palavra-passe precisa de ${PASSWORD_MIN} caracteres ou mais`;
  if (p.length > 200) return 'a palavra-passe é demasiado longa (máximo 200 caracteres)';
  const low = p.toLowerCase();
  if (/^(.)\1+$/.test(p)) return 'a palavra-passe não pode ser o mesmo carácter repetido';
  const obvias = ['password', 'palavra-passe', 'palavrapasse', '123456', 'qwerty', 'orbitaorbita', 'adminadmin'];
  if (obvias.some((w) => low.includes(w))) return 'essa palavra-passe é das primeiras que alguém tenta — escolhe outra';
  /* só se a parte antes do @ for uma palavra (4+ letras): com «a@b.pt» a regra
     recusava qualquer palavra-passe que tivesse um «a» — foi um teste que o viu */
  const local = String(email).toLowerCase().split('@')[0] || '';
  if (local.length >= 4 && low.includes(local)) return 'a palavra-passe não pode conter o teu email';
  if (name && String(name).length >= 4 && low.includes(String(name).toLowerCase())) return 'a palavra-passe não pode conter o teu nome';
  return null;
}

/** `scrypt$N$r$p$sal$hash` — o mesmo formato que o Órbita local já usa. */
export function hashPassword(password) {
  const bad = checkPassword(password);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Compara em tempo constante. Formato desconhecido → falso (nunca lança). */
export function verifyPassword(password, guardado) {
  try {
    const [algo, N, r, p, salt, hash] = String(guardado || '').split('$');
    if (algo !== 'scrypt') return false;
    const esperado = Buffer.from(hash, 'base64');
    const obtido = scryptSync(String(password || ''), Buffer.from(salt, 'base64'), esperado.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
  } catch { return false; }
}

/* ---------- contas ---------- */

export const normEmail = (email) => String(email || '').trim().toLowerCase();
export const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(email));
export const emailHash = (email) => createHash('sha256').update(normEmail(email)).digest('hex');

/** A conta como pode sair daqui. `hash` fica sempre dentro. */
export function publico(r) {
  if (!r) return null;
  const role = roleOf(r.papel || r.role);
  return {
    id: r.id,
    email: r.email,
    name: r.nome ?? r.name ?? '',
    role: r.papel || r.role,
    roleLabel: role?.label || r.papel || r.role,
    level: role?.level ?? -1,
    active: r.activo !== false,
    created_at: r.criado || r.created_at || null,
    last_login_at: r.ultimo_acesso || r.last_login_at || null,
  };
}

/* ---------- sessões ---------- */

export const COOKIE = 'orbita_sessao';
export const HORAS_SESSAO = 12;

/** 32 bytes aleatórios em base64url — o que vai para o cookie. */
export const novoToken = () => randomBytes(32).toString('base64url');
/** O que fica na base: o sha256. Quem ler a base não consegue entrar. */
export const hashToken = (t) => createHash('sha256').update(String(t || '')).digest('hex');

export function lerCookies(header = '') {
  const out = {};
  for (const parte of String(header || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 1) continue;
    const k = parte.slice(0, i).trim();
    const v = parte.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** O token que este pedido apresenta: cookie, cabeçalho próprio, ou Bearer. */
export function tokenDoPedido(headers = {}) {
  const h = headers || {};
  const cookie = lerCookies(h.cookie || h.Cookie || '');
  if (cookie[COOKIE]) return cookie[COOKIE];
  const proprio = h['x-orbita-session'];
  if (proprio) return String(proprio);
  const auth = String(h.authorization || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

export function cookieDeSessao(token, { horas = HORAS_SESSAO, secure = true } = {}) {
  const max = Math.round(horas * 3600);
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${max}${secure ? '; Secure' : ''}`;
}

export function cookieParaApagar({ secure = true } = {}) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/** Uma sessão vale se não está revogada e ainda não expirou. */
export function sessaoValida(sessao, agora = Date.now()) {
  if (!sessao) return false;
  if (sessao.revogada || sessao.revogada_em) return false;
  const fim = new Date(sessao.expira || sessao.expires_at || 0).getTime();
  return Number.isFinite(fim) && fim > agora;
}

/* ---------- tentativas falhadas ---------- */

/**
 * Cinco falhas por chave (email+ip) em quinze minutos. Vive neste processo — a
 * função da Vercel não guarda estado, e isto é um travão, não um registo: um
 * arranque a frio esquece. A defesa que não se perde é o scrypt (lento) e o
 * tamanho mínimo da palavra-passe.
 */
export function criarLimitador({ janelaMs = 15 * 60 * 1000, max = 5, agora = () => Date.now() } = {}) {
  const mapa = new Map();
  const limpar = (t) => {
    for (const [k, v] of mapa) if (v.ate <= t) mapa.delete(k);
  };
  return {
    ver(chave) {
      const t = agora();
      limpar(t);
      const v = mapa.get(chave);
      if (!v) return { ok: true, restam: max };
      if (v.n >= max) return { ok: false, esperaMs: Math.max(0, v.ate - t), restam: 0 };
      return { ok: true, restam: max - v.n };
    },
    falhou(chave) {
      const t = agora();
      const v = mapa.get(chave) || { n: 0, ate: t + janelaMs };
      mapa.set(chave, { n: v.n + 1, ate: t + janelaMs });
    },
    acertou(chave) { mapa.delete(chave); },
    limpar() { mapa.clear(); },
    tamanho: () => mapa.size,
  };
}

/* ---------- o estado da porta, para a interface ---------- */

/**
 * O que a mesa mostra antes de alguém entrar.
 *   · `sessao`     — há contas: sem sessão, 401 e o ecrã de entrada;
 *   · `sem-contas` — a instalação é nova: deixa criar a primeira conta (uma vez);
 *   · `aberta`     — decisão explícita (`ORBITA_AUTH=aberta`), com o aviso à vista.
 */
export function estadoDaPorta({ temContas = false, env = {} } = {}) {
  if (String(env.ORBITA_AUTH || '').toLowerCase() === 'aberta') {
    return {
      modo: 'aberta', descricao: 'a porta está aberta por decisão (ORBITA_AUTH=aberta) — qualquer pessoa que tenha o endereço entra',
      aviso: 'esta instalação está aberta: tira ORBITA_AUTH da Vercel para a fechar',
    };
  }
  if (!temContas) {
    return {
      modo: 'sem-contas',
      descricao: 'esta instalação ainda não tem contas — cria a primeira, que fica dona',
      primeiraContaPossivel: true,
      exigeToken: !!(env.SETUP_TOKEN || env.PROVA_TOKEN),
    };
  }
  return { modo: 'sessao', descricao: `entra com a tua conta · a sessão dura ${HORAS_SESSAO} h`, primeiraContaPossivel: false };
}
