/* ===========================================================================
   1.69.0 · A ENTRADA: GitHub, Google, ou email com código de uso único.

   Porque este ficheiro existe: a porta da 1.54.0 sabia entrar com email e
   palavra-passe — e mais nada. Faltavam as duas formas que as pessoas
   realmente usam: a conta que já têm (GitHub, Google) e o código que chega ao
   correio, que prova a caixa sem obrigar a inventar mais uma palavra-passe.

   E falta uma coisa mais simples ainda: **esta instalação é de uma pessoa só.**
   O dono disse-o por palavras («só deve aceitar a do chelton»), e um produto de
   um homem só não pode ter um registo aberto — qualquer visita criava conta e
   ficava com uma porta para os dados do dono. A lista de quem entra vive em
   `ORBITA_DONO_EMAIL` (uma, ou várias separadas por vírgulas); sem a variável,
   a lista é a do dono que criou isto.

   O que aqui NÃO se faz: falar com a base de dados (é `_porta.mjs`), guardar
   segredos em claro, ou inventar que um fornecedor está pronto quando lhe falta
   a chave. Sem `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` não há GitHub, e a
   resposta diz isso com o sítio exacto onde se cria a aplicação.
   =========================================================================== */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { normEmail, emailValido } from './_conta.mjs';

/* ---------- quem entra ---------- */

/** A conta do dono desta instalação. Muda-se com `ORBITA_DONO_EMAIL`. */
export const DONO_PADRAO = 'cheltonmahoze7@gmail.com';

/** A lista de emails que esta instalação aceita (normalizada, sem repetidos). */
export function donosDe(env = {}) {
  const bruto = env.ORBITA_DONO_EMAIL || env.ORBITA_DONOS || env.ORBITA_OWNER_EMAIL || '';
  const lista = String(bruto)
    .split(/[,;\s]+/)
    .map((e) => normEmail(e))
    .filter((e) => emailValido(e));
  const unicos = [...new Set(lista)];
  return unicos.length ? unicos : [DONO_PADRAO];
}

/**
 * 1.74.0 · A CONTA DO DONO, NÃO SÓ O EMAIL DELE.
 *
 * O GitHub devolve o email *primário* da conta — e o dono tem mais do que um
 * endereço. Ancorar a entrada só no email fazia o GitHub recusar a própria
 * conta do dono («a conta x não é a do dono») com uma frase que não tinha
 * solução do lado de quem estava a entrar.
 *
 * A conta GitHub tem um número que não muda e que ninguém reescreve: o `id`.
 * `ORBITA_DONO_GITHUB_ID` (e/ou `ORBITA_DONO_GITHUB`, o login) diz quais são as
 * contas do dono. Isto NÃO abre a porta a mais ninguém: o número é de uma conta
 * só, e o GitHub já provou que quem está a entrar é dela.
 */
export function donosGithubDe(env = {}) {
  const ids = String(env.ORBITA_DONO_GITHUB_ID || '')
    .split(/[,;\s]+/).map((n) => String(n).trim()).filter((n) => /^\d+$/.test(n));
  const logins = String(env.ORBITA_DONO_GITHUB || '')
    .split(/[,;\s]+/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  return { ids, logins };
}

/** O perfil de um fornecedor é a conta do dono? Email, ou (GitHub) id/login. */
export function donoDoPerfil(perfil = {}, env = {}) {
  if (eODono(perfil.email, env)) return true;
  if (String(perfil.fornecedor || '') !== 'github') return false;
  const { ids, logins } = donosGithubDe(env);
  if (!ids.length && !logins.length) return false;
  if (perfil.id && ids.includes(String(perfil.id))) return true;
  return !!perfil.login && logins.includes(String(perfil.login).toLowerCase());
}

/** Este email pode entrar por uma porta pública (OAuth, código, primeira conta)? */
export function eODono(email, env = {}) {
  const e = normEmail(email);
  return !!e && donosDe(env).includes(e);
}

/** «che***@gmail.com» — o ecrã de entrada diz que há um dono, sem publicar o
 *  endereço inteiro para quem passa. Quem precisa do endereço já o sabe. */
export function mascararEmail(email) {
  const e = normEmail(email);
  if (!e || !e.includes('@')) return '';
  const [local, dominio] = e.split('@');
  const visivel = local.slice(0, Math.min(3, Math.max(1, local.length - 1)));
  return `${visivel}${'*'.repeat(Math.max(2, Math.min(6, local.length - visivel.length)))}@${dominio}`;
}

/* ---------- o código de uso único ---------- */

export const MINUTOS_CODIGO = 10;
export const TENTATIVAS_CODIGO = 5;
export const CODIGO_DIGITOS = 6;

/** Um código de 6 dígitos, de uma fonte criptográfica. */
export function codigoNovo() {
  return String(randomInt(0, 10 ** CODIGO_DIGITOS)).padStart(CODIGO_DIGITOS, '0');
}

/** O que fica na base: nunca o código, só o sha256 com o email e um prefixo
 *  fixo — dois códigos iguais em contas diferentes não dão o mesmo hash. */
export function hashCodigo(codigo, email) {
  return createHash('sha256').update(`orbita-codigo:${normEmail(email)}:${String(codigo || '').replace(/\D/g, '')}`).digest('hex');
}

export function codigoConfere(conta, codigo, { agora = Date.now() } = {}) {
  const guardado = String(conta?.codigo_hash || '');
  if (!guardado) return { estado: 'sem-codigo', ok: false, motivo: 'não há código pedido para esta conta — pede um' };
  if (Number(conta.codigo_tentativas || 0) >= TENTATIVAS_CODIGO) {
    return { estado: 'bloqueado', ok: false, motivo: `demasiadas tentativas com este código — pede outro` };
  }
  const expira = new Date(conta.codigo_expira || 0).getTime();
  if (!expira || expira < agora) return { estado: 'expirado', ok: false, motivo: `o código passou dos ${MINUTOS_CODIGO} minutos — pede outro` };
  const dado = hashCodigo(codigo, conta.email);
  const a = Buffer.from(dado, 'hex');
  const b = Buffer.from(guardado, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { estado: 'errado', ok: false, restam: Math.max(0, TENTATIVAS_CODIGO - Number(conta.codigo_tentativas || 0) - 1) };
  }
  return { estado: 'ok', ok: true };
}

/* ---------- os fornecedores de identidade ---------- */

export const REDIRECAO = '/api/oauth';

/** O endereço público desta instalação (para onde o fornecedor devolve a pessoa). */
export const basePublica = (env = {}) =>
  String(env.ORBITA_URL || env.ORBITA_URLAR || 'https://orbita-agentes.vercel.app').replace(/\/+$/, '');

/* 1.72.0 · PORQUE O GOOGLE VOLTA À RAIZ

   O Google não aceita um `redirect_uri` que não esteja registado ao carácter na
   Cloud Console. O dono registou `https://orbita-agentes.vercel.app/` (a raiz) e
   não `…/api/oauth?fornecedor=google` — e o Google respondeu
   «Error 400: redirect_uri_mismatch» sem nunca chegar aqui.

   Duas saídas possíveis: pedir-lhe para registar o endereço certo (mais um
   passo manual, e ele já tinha dito que queria isto a funcionar), ou usar o
   endereço que **já está** registado. Ficou a segunda: o Google devolve a
   pessoa à raiz com `?code=…&state=…`, e a raiz (`src/shell.html`) encaminha-a
   para `/api/oauth?fornecedor=google&…`, que é quem sabe trocar o código.

   O endereço continua a poder ser trocado sem tocar no código:
   `ORBITA_OAUTH_RETORNO_GOOGLE` manda sobre isto. No dia em que registares
   `/api/oauth?fornecedor=google` lá, basta pôr essa variável.
   O GitHub não muda: o endereço dele é o canónico. */
export const retornoNaRaiz = (env = {}) => `${basePublica(env)}/`;

export const uriDeRetorno = (fornecedor, env = {}) => {
  if (String(fornecedor || '').toLowerCase() === 'google') {
    const escolhido = String(env.ORBITA_OAUTH_RETORNO_GOOGLE || '').trim();
    if (escolhido) return escolhido;
    return retornoNaRaiz(env);
  }
  return `${basePublica(env)}${REDIRECAO}?fornecedor=${encodeURIComponent(fornecedor)}`;
};

/** O que falta para cada um. `falta` são NOMES de variáveis, nunca valores. */
export const FORNECEDORES = [
  {
    id: 'github',
    nome: 'GitHub',
    vars: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    como: {
      onde: 'GitHub → Settings → Developer settings → OAuth Apps → New OAuth App',
      nota: 'Authorization callback URL tem de ser exactamente o endereço de retorno que aparece em baixo.',
    },
  },
  {
    id: 'google',
    nome: 'Google',
    vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    como: {
      onde: 'Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID (Web application)',
      nota: 'Em «Authorized redirect URIs» cola o endereço de retorno que aparece em baixo.',
    },
  },
];

export function fornecedorPorId(id) {
  const k = String(id || '').toLowerCase();
  return FORNECEDORES.find((f) => f.id === k) || null;
}

/** O estado de cada fornecedor, para o ecrã e para o `/api/health`. */
export function estadoDosFornecedores(env = {}) {
  return FORNECEDORES.map((f) => {
    const falta = f.vars.filter((v) => !String(env[v] || '').trim());
    return {
      id: f.id,
      nome: f.nome,
      pronto: falta.length === 0,
      falta,
      reusa: false,
      retorno: uriDeRetorno(f.id, env),
      como: { ...f.como, texto: `${f.vars.join(' e ')} na Vercel` },
    };
  });
}

/** O endereço do fornecedor, com o `state` (anti-CSRF) e o pedido de email. */
export function urlDeAutorizacao(fornecedor, { env = {}, state, retorno = null } = {}) {
  const f = fornecedorPorId(fornecedor);
  if (!f) return null;
  const volta = retorno || uriDeRetorno(f.id, env);
  if (f.id === 'github') {
    const q = new URLSearchParams({
      client_id: String(env.GITHUB_CLIENT_ID || ''),
      redirect_uri: volta,
      /* `user:email` é o mínimo para ler o email verificado — nada de repos */
      scope: 'read:user user:email',
      state,
      allow_signup: 'false',
    });
    return `https://github.com/login/oauth/authorize?${q.toString()}`;
  }
  const q = new URLSearchParams({
    client_id: String(env.GOOGLE_CLIENT_ID || ''),
    redirect_uri: volta,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** Troca o `code` por um token e lê o email. Nunca devolve segredos. */
export async function perfilDoFornecedor(fornecedor, { code, env = {}, fetchImpl = fetch, retorno = null } = {}) {
  const f = fornecedorPorId(fornecedor);
  if (!f) return { ok: false, motivo: 'fornecedor desconhecido' };
  const volta = retorno || uriDeRetorno(f.id, env);
  const json = async (r) => {
    try { return await r.json(); } catch { return null; }
  };
  try {
    if (f.id === 'github') {
      const tr = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: volta,
        }),
      });
      const t = await json(tr);
      if (!tr.ok || !t || !t.access_token) {
        return { ok: false, motivo: `o GitHub recusou a troca do código${t?.error ? `: ${t.error}` : ` (HTTP ${tr.status})`}` };
      }
      const h = { authorization: `Bearer ${t.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'orbita' };
      const em = await json(await fetchImpl('https://api.github.com/user/emails', { headers: h }));
      const lista = Array.isArray(em) ? em : [];
      /* o email TEM de ser verificado pelo GitHub e primário: um email público
         qualquer não prova que a caixa é de quem está a entrar */
      const bom = lista.find((e) => e.primary && e.verified) || lista.find((e) => e.verified);
      if (!bom) return { ok: false, motivo: 'o GitHub não devolveu nenhum email verificado nesta conta' };
      const perfil = await json(await fetchImpl('https://api.github.com/user', { headers: h }));
      /* 1.74.0 · o login e o número vêm também: são eles que dizem se esta é a
         conta do dono quando o email primário dela é outro endereço */
      return {
        ok: true, fornecedor: 'github',
        email: normEmail(bom.email),
        nome: String(perfil?.name || perfil?.login || '').slice(0, 120),
        id: String(perfil?.id || ''), login: String(perfil?.login || ''),
      };
    }
    const tr = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: volta, grant_type: 'authorization_code',
      }).toString(),
    });
    const t = await json(tr);
    if (!tr.ok || !t || !t.access_token) {
      return { ok: false, motivo: `o Google recusou a troca do código${t?.error ? `: ${t.error}` : ` (HTTP ${tr.status})`}` };
    }
    const p = await json(await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${t.access_token}` },
    }));
    if (!p || !p.email) return { ok: false, motivo: 'o Google não devolveu um email nesta conta' };
    if (p.email_verified === false) return { ok: false, motivo: 'o Google diz que este email não está verificado' };
    return { ok: true, fornecedor: 'google', email: normEmail(p.email), nome: String(p.name || '').slice(0, 120), id: String(p.sub || '') };
  } catch (e) {
    return { ok: false, motivo: `não consegui falar com o ${f.nome}: ${e.message}` };
  }
}

/* ---------- o que a página precisa de saber ---------- */

/** As opções de entrada, sem um único segredo. É o que `/auth/opcoes` devolve. */
export function opcoesDeEntrada(env = {}) {
  const donos = donosDe(env);
  const temCorreio = !!String(env.RESEND_API_KEY || '').trim();
  return {
    soDono: true,
    donos: donos.map(mascararEmail),
    /* para quem tem de configurar isto: o nome da variável, não o endereço */
    variavelDoDono: 'ORBITA_DONO_EMAIL',
    /* 1.74.0 · há contas GitHub do dono configuradas? (só o facto, não o número) */
    donoGithub: (() => { const g = donosGithubDe(env); return g.ids.length + g.logins.length > 0; })(),
    fornecedores: estadoDosFornecedores(env).map((f) => ({
      id: f.id, nome: f.nome, pronto: f.pronto, falta: f.falta, retorno: f.retorno, como: f.como,
    })),
    codigo: {
      pronto: temCorreio,
      falta: temCorreio ? [] : ['RESEND_API_KEY'],
      minutos: MINUTOS_CODIGO,
      como: {
        onde: 'resend.com → API Keys → Create API Key',
        texto: 'RESEND_API_KEY (e ORBITA_EMAIL_FROM, com um domínio verificado) na Vercel',
        nota: temCorreio
          ? `o código segue para o email do dono e vale ${MINUTOS_CODIGO} minutos`
          : 'sem chave de correio não há código: o email não sai daqui, e dizê-lo é melhor do que um ecrã à espera',
      },
    },
    palavraPasse: { pronto: true, comCodigo: temCorreio },
  };
}

/* ---------- 1.90 · assinaturas dos webhooks (WhatsApp e Resend) ----------
   Sem assinatura válida, um evento não é uma resposta de cliente: é alguém a
   fingir ser a Meta ou o Resend. Estas duas funções provam a assinatura; quem
   as chama responde 401 quando dão falso e 503 quando falta o segredo.
   Limite: a assinatura é sobre o corpo BRUTO do pedido. Até a rota receber esse
   corpo (ver `corpoBruto` em `_rotas.mjs`), um JSON re-serializado pode não
   bater certo com o que a Meta assinou — e isso falha fechado (401), nunca
   aceita à sorte. */
const iguaisBytes = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Meta (WhatsApp Cloud API): `X-Hub-Signature-256: sha256=<hex>`, HMAC do corpo com o segredo da app. */
export function assinaturaMeta({ segredo, corpoBase, assinatura } = {}) {
  if (!segredo || !assinatura) return false;
  const esperado = `sha256=${createHmac('sha256', String(segredo)).update(String(corpoBase ?? '')).digest('hex')}`;
  return iguaisBytes(esperado, assinatura);
}

/**
 * Svix (Resend): `svix-id`, `svix-timestamp` e `svix-signature` = `v1,<base64>` (pode haver várias).
 * A chave é o segredo `whsec_<base64>` sem o prefixo; assina-se `id.timestamp.corpo`.
 * Recusa-se um timestamp fora de 5 minutos (repetir um pedido antigo não passa).
 */
export function assinaturaSvix({ segredo, id, timestamp, assinatura, corpoBase, agora = Date.now(), tolerancia = 300 } = {}) {
  if (!segredo || !id || !timestamp || !assinatura) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(agora / 1000 - ts) > tolerancia) return false;
  const chave = Buffer.from(String(segredo).replace(/^whsec_/, ''), 'base64');
  if (!chave.length) return false;
  const esperado = createHmac('sha256', chave).update(`${id}.${timestamp}.${corpoBase ?? ''}`).digest('base64');
  return String(assinatura).split(' ').some((parte) => {
    const [versao, sinal] = parte.split(',');
    return versao === 'v1' && Boolean(sinal) && iguaisBytes(sinal, esperado);
  });
}
