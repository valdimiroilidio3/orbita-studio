/* ===========================================================================
   Vercel Connect (1.27.0, 27 out 2026) — credenciais ao minuto, não segredos em repouso.

   O dono pediu para integrar o `getToken` da Vercel Connect. O que isto resolve,
   dito sem marketing: em vez de uma chave do fornecedor colada numa variável de
   ambiente (que vive meses e vale tudo), o escritório pede **um token curto** no
   momento em que precisa dele. Quem guarda o refresh token é a Vercel; nós nunca
   o vemos.

   Conector: `opencode/orbita-agentes` (id `scl_qldewGbrB7mPvtjEQXyVQ`).
   Autenticação da chamada: o token OIDC que a Vercel injecta na função. Sem ele
   (ou fora da Vercel) é preciso `VERCEL_OIDC_TOKEN`/`VERCEL_TOKEN` no ambiente, e
   a ligação do conector ao projecto.

   Regras da casa, aplicadas aqui:
     · O token **nunca** sai da função: as rotas devolvem só o retrato mascarado
       (tipo, expiração, quem é o sujeito). O token em claro só existe em memória
       no instante em que se chama o fornecedor.
     · Se faltar o pacote, a credencial ou a ligação ao projecto, diz-se qual é o
       problema — não se finge que está ligado.
     · Cache em memória até 30 s antes de expirar (a própria SDK também tem a
       sua): pedir um token por pedido não é pedir um token novo por pedido.
   =========================================================================== */

export const CONECTOR_PADRAO = 'opencode/orbita-agentes';
export const ID_PADRAO = 'scl_qldewGbrB7mPvtjEQXyVQ';

/** O que se pode mostrar de um segredo: o suficiente para reconhecer, nada mais. */
export const mascarar = (s) => {
  const t = String(s || '');
  if (!t) return '';
  if (t.length < 12) return '••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
};

const conectorDe = (env) => String(env?.VERCEL_CONECTOR || CONECTOR_PADRAO);
const idDe = (env) => String(env?.VERCEL_CONECTOR_ID || ID_PADRAO);

/**
 * A credencial da chamada à Vercel.
 *
 * Modos (o diagnóstico em produção precisa deles, porque o erro 401 pode vir de
 * qualquer um):
 *   · `auto`        — OIDC do ambiente, senão o OIDC do pedido, senão VERCEL_TOKEN
 *   · `oidc-env`    — só o `VERCEL_OIDC_TOKEN` que a Vercel põe no processo
 *   · `oidc-pedido` — só o token OIDC que chegou no cabeçalho do pedido
 *   · `chave`       — só `VERCEL_TOKEN`
 */
export function credencialDe(env, modo = 'auto') {
  const doAmbiente = env?.VERCEL_OIDC_TOKEN || null;
  const doPedido = env?.AI_GATEWAY_API_KEY || null;
  const chave = env?.VERCEL_TOKEN || null;
  const m = String(modo || 'auto');
  if (m === 'oidc-env') return doAmbiente ? { valor: doAmbiente, tipo: 'oidc-env', motivo: null } : { valor: null, tipo: null, motivo: 'não há VERCEL_OIDC_TOKEN no processo desta função' };
  if (m === 'oidc-pedido') return doPedido ? { valor: doPedido, tipo: 'oidc-pedido', motivo: null } : { valor: null, tipo: null, motivo: 'o pedido não trouxe x-vercel-oidc-token' };
  if (m === 'chave') return chave ? { valor: chave, tipo: 'chave', motivo: null } : { valor: null, tipo: null, motivo: 'não há VERCEL_TOKEN no ambiente' };
  if (doAmbiente) return { valor: doAmbiente, tipo: 'oidc-env', motivo: null };
  if (doPedido) return { valor: doPedido, tipo: 'oidc-pedido', motivo: null };
  if (chave) return { valor: chave, tipo: 'chave', motivo: null };
  return { valor: null, tipo: null, motivo: 'a função não recebeu token OIDC da Vercel (e não há VERCEL_TOKEN no ambiente)' };
}

/** Quem o token representa. Sem autenticação na aplicação, o sujeito é o dono. */
export function assuntoDe(env = process.env, pedido = null) {
  const id = String(pedido?.id || env?.ORBITA_DONO_ID || '').trim();
  if (id) return { type: 'user', id };
  return { type: 'app' };
}

async function carregarSdk(importar) {
  try {
    const m = importar ? await importar('@vercel/connect') : await import('@vercel/connect');
    if (typeof m?.getTokenResponse !== 'function') throw new Error('o pacote não expõe getTokenResponse');
    return m;
  } catch (e) {
    const erro = new Error(`o pacote @vercel/connect não está disponível nesta instalação (${String(e.message || e).slice(0, 120)})`);
    erro.codigo = 'sempacote';
    throw erro;
  }
}

/* ---------- a cache: um token não se pede duas vezes no mesmo minuto ---------- */
const CACHE = new Map();
const MARGEM_MS = 30 * 1000;

const chaveCache = (conector, assunto, escopos, modo = 'auto') =>
  `${conector}|${assunto.type}:${assunto.id || ''}|${(escopos || []).slice().sort().join(',')}|${modo}`;

export function limparCache() { CACHE.clear(); }

/**
 * Pede um token ao Vercel Connect. Devolve o token EM CLARO — é para uso interno
 * (chamar o fornecedor), nunca para uma resposta HTTP.
 */
export async function tokenPara({ pedido = null, escopos = null, instalacao = null, audiencia = null, forcar = false, modoCredencial = 'auto' } = {}, { env = process.env, importar = null, agora = Date.now() } = {}) {
  const conector = conectorDe(env);
  const assunto = assuntoDe(env, pedido);
  const cred = credencialDe(env, modoCredencial);
  if (!cred.valor) {
    const e = new Error(cred.motivo);
    e.codigo = 'semcredencial';
    throw e;
  }
  const chave = chaveCache(conector, assunto, escopos, modoCredencial);
  const guardado = CACHE.get(chave);
  if (!forcar && guardado && guardado.expiresAt - MARGEM_MS > agora) {
    return { ...guardado, cache: true };
  }

  const sdk = await carregarSdk(importar);
  const params = { subject: assunto };
  if (escopos?.length) params.scopes = escopos;
  if (instalacao) params.installationId = instalacao;
  if (audiencia?.length) params.audience = audiencia;

  let r;
  try {
    /* a chave explícita passa sempre; o OIDC deixa a SDK ler o ambiente quando é
       o do processo (é o caminho que a Vercel documenta) */
    r = await sdk.getTokenResponse(conector, params, {
      ...(cred.tipo === 'chave' ? { vercelToken: cred.valor } : {}),
      ...(cred.tipo === 'oidc-pedido' ? { vercelToken: cred.valor } : {}),
      forceRefresh: !!forcar,
    });
  } catch (e) {
    throw traduzirErro(e, conector);
  }
  if (!r?.token) {
    const erro = new Error('o Vercel Connect respondeu sem token');
    erro.codigo = 'semtoken';
    throw erro;
  }
  const token = {
    token: String(r.token),
    expiresAt: Number(r.expiresAt) || (agora + 5 * 60 * 1000),
    tokenId: r.tokenId || null,
    conector: { uid: r.connector?.uid || conector, tipo: r.connector?.type || null, id: r.connector?.id || null },
    nome: r.name || null,
    assunto,
    cache: false,
  };
  CACHE.set(chave, token);
  return token;
}

/** Traduz os erros tipados da SDK para o que o dono precisa de ler. */
export function traduzirErro(e, conector) {
  const base = String(e?.message || e).slice(0, 200);
  const codigo = e?.code || (e?.name && e.name !== 'Error' ? e.name : 'erro');
  const erro = new Error(base);
  erro.codigo = 'connect';
  erro.detalhe = { codigo, status: e?.status ?? null, conector };
  if (/UserAuthorizationRequired|user_authorization_required/i.test(`${e?.name} ${codigo} ${base}`)) {
    erro.message = `o dono ainda não autorizou «${conector}» — é preciso abrir o link de consentimento uma vez`;
    erro.codigo = 'precisa-consentimento';
    erro.precisaConsentimento = true;
  } else if (/ConnectorInstallationRequired|installation_required/i.test(`${e?.name} ${codigo} ${base}`)) {
    erro.message = `o conector «${conector}» precisa de uma instalação (workspace/organização) — falta o installationId`;
    erro.codigo = 'precisa-instalacao';
  } else if (/not.?linked|not_linked|ClientNotLinked/i.test(`${e?.name} ${codigo} ${base}`)) {
    erro.message = `o conector «${conector}» não está ligado a este projecto/ambiente na Vercel`;
    erro.codigo = 'nao-ligado';
  } else if (/environment/i.test(base) && /not|enabled/i.test(base)) {
    erro.message = `o ambiente onde isto corre não está autorizado a pedir tokens para «${conector}»`;
    erro.codigo = 'ambiente';
  } else if (e?.status === 401 || e?.status === 403) {
    erro.message = `a Vercel recusou a credencial de chamada (HTTP ${e.status}) — confirma o OIDC do deployment`;
    erro.codigo = 'credencial';
  }
  return erro;
}

/* ---------- o retrato para a interface ---------- */

/** Tudo o que se pode dizer sem mostrar o token. */
export async function estado(env = process.env, { importar = null } = {}) {
  const conector = conectorDe(env);
  const id = idDe(env);
  const assunto = assuntoDe(env);
  const cred = credencialDe(env);
  let sdk = { disponivel: false, motivo: null };
  try {
    const m = await carregarSdk(importar);
    sdk = { disponivel: true, motivo: null, exporta: Object.keys(m).filter((k) => /^(getToken|getTokenResponse|startAuthorization)$/.test(k)) };
  } catch (e) {
    sdk = { disponivel: false, motivo: e.message };
  }
  const guardado = [...CACHE.values()].find((t) => t.conector?.uid === conector) || null;
  return {
    ok: sdk.disponivel && !!cred.valor,
    conector,
    id,
    sdk,
    credencial: {
      tipo: cred.tipo, presente: !!cred.valor, motivo: cred.motivo,
      /** o que existe, sem mostrar nenhum dos valores */
      fontes: { oidcNoProcesso: !!env?.VERCEL_OIDC_TOKEN, oidcNoPedido: !!env?.AI_GATEWAY_API_KEY, chaveVercel: !!env?.VERCEL_TOKEN },
    },
    assunto,
    cache: guardado ? { presente: true, expiraEm: new Date(guardado.expiresAt).toISOString(), emCache: true } : { presente: false },
    nota: 'o token nunca sai da função: só o tipo, a validade e o sujeito. Quem guarda o refresh token é a Vercel.',
  };
}

/** Um pedido a sério, com o token mascarado na resposta. */
export async function testar({ pedido = null, escopos = null, forcar = true, modoCredencial = 'auto' } = {}, { env = process.env, importar = null, agora = Date.now() } = {}) {
  const t0 = agora;
  try {
    const t = await tokenPara({ pedido, escopos, forcar, modoCredencial }, { env, importar, agora });
    return {
      ok: true,
      ms: Date.now() - t0,
      conector: t.conector.uid,
      tipoDeConector: t.conector.tipo,
      nome: t.nome,
      assunto: t.assunto,
      tokenMascarado: mascarar(t.token),
      tokenId: t.tokenId,
      expiraEm: new Date(t.expiresAt).toISOString(),
      faltamSegundos: Math.max(0, Math.round((t.expiresAt - Date.now()) / 1000)),
      emCache: !!t.cache,
      credencial: credencialDe(env, modoCredencial).tipo,
      quando: new Date().toISOString(),
      prova: 'token pedido agora ao Vercel Connect (o valor não sai daqui)',
    };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - t0,
      conector: conectorDe(env),
      credencial: credencialDe(env, modoCredencial).tipo,
      codigo: e.codigo || 'erro',
      erro: String(e.message || e).slice(0, 300),
      detalhe: e.detalhe || null,
      precisaConsentimento: !!e.precisaConsentimento,
      quando: new Date().toISOString(),
    };
  }
}

/**
 * O link de consentimento (uma vez por utilizador). Só corre se o dono pedir:
 * a aplicação ainda não tem autenticação, e um link destes não se serve a
 * qualquer visitante.
 */
export async function consentimento({ pedido = null, escopos = null, voltarPara = null } = {}, { env = process.env, importar = null } = {}) {
  if (String(env?.ORBITA_PERMITIR_CONSENTIMENTO || '') !== '1') {
    const e = new Error('o consentimento está desligado: define ORBITA_PERMITIR_CONSENTIMENTO=1 para gerar o link (a aplicação ainda não tem autenticação)');
    e.codigo = 'consentimento-desligado';
    throw e;
  }
  const cred = credencialDe(env);
  if (!cred.valor) { const e = new Error(cred.motivo); e.codigo = 'semcredencial'; throw e; }
  const sdk = await carregarSdk(importar);
  if (typeof sdk.startAuthorization !== 'function') { const e = new Error('esta versão do SDK não expõe startAuthorization'); e.codigo = 'sempacote'; throw e; }
  const params = { subject: assuntoDe(env, pedido) };
  if (escopos?.length) params.scopes = escopos;
  const r = await sdk.startAuthorization(conectorDe(env), params, {
    ...(cred.tipo === 'oidc' ? { vercelToken: cred.valor } : {}),
    ...(voltarPara ? { callbackUrl: String(voltarPara) } : {}),
  });
  return { ok: true, conector: conectorDe(env), url: r?.url || null, deviceCode: r?.deviceCode || null, expiraEm: r?.expiresAt ? new Date(r.expiresAt).toISOString() : null, servico: r?.connector?.serviceName || r?.connector?.name || null };
}
