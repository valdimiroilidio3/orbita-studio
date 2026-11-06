/* ===========================================================================
   1.69.0 · /api/oauth — o regresso do GitHub e do Google (6 nov 2026)

   Porque é `_oauth.mjs` e não `oauth.mjs`: o plano Hobby da Vercel recusa mais
   de 12 funções por deploy («exceeded_serverless_functions_per_deployment», e
   o build falhou de verdade na primeira tentativa desta versão). O endereço
   público continua a ser `/api/oauth` — chega lá por uma reescrita em
   `vercel.json` para `/api/rpc`, que é a porta que já existe. Ficheiros com `_`
   à frente não contam como função.

   `_porta.mjs` responde por JSON porque a mesa fala por `/api/rpc`. OAuth não
   cabe nisso: o browser tem de SAIR para o fornecedor e VOLTAR a um endereço
   que a Vercel serve. É esta função.

     GET /api/oauth?fornecedor=github&iniciar=1
       → 302 para o GitHub/Google, com um `state` aleatório num cookie HttpOnly

     GET /api/oauth?fornecedor=github&code=…&state=…
       → confere o `state`, troca o `code`, lê o email, confirma que é o do dono,
         abre sessão e volta para /app

   A decisão vive em `processarOAuth` (recebe repo, ambiente e um `fetch` — por
   isso se prova em teste, com um GitHub falso e sem rede). O `handler` só a
   traduz para o `req`/`res` da Vercel.

   O que NÃO se faz aqui: aceitar outra pessoa que não o dono (a lista é a de
   `_entrada.mjs`), abrir sessão sem o email verificado pelo fornecedor, ou
   deixar o `code` e o `state` em claro num log.

   Sem `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (ou as do Google) a resposta é
   um 503 com o nome exacto do que falta e onde se cria — nunca um botão morto.
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { abrirSessao } from './_porta.mjs';
import {
  fornecedorPorId, estadoDosFornecedores, urlDeAutorizacao, perfilDoFornecedor,
  uriDeRetorno, eODono, donosDe, mascararEmail,
} from './_entrada.mjs';
import { randomBytes } from 'node:crypto';

export const config = { maxDuration: 30 };

export const COOKIE_ESTADO = 'orbita_oauth';
const MINUTOS_ESTADO = 10;
const agoraIso = () => new Date().toISOString();

export function cookieDeEstado(valor, { segundos = MINUTOS_ESTADO * 60 } = {}) {
  return [
    `${COOKIE_ESTADO}=${encodeURIComponent(valor)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', `Max-Age=${segundos}`,
  ].join('; ');
}

export function lerCookies(cru = '') {
  const out = {};
  for (const p of String(cru || '').split(';')) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}

const voltar = (motivo, extra = {}) => ({
  status: 302,
  location: `/app?${new URLSearchParams({ erroEntrada: String(motivo || 'não consegui entrar').slice(0, 300), ...extra }).toString()}`,
  cabecalhos: {},
});

/**
 * O coração do OAuth, sem `req` nem `res` à vista.
 *
 * @returns {{status:number, location?:string, cabecalhos?:object, corpo?:any, tipo?:string}}
 */
export async function processarOAuth({
  repo, env = {}, query, cookies = {}, fetchImpl = fetch,
} = {}) {
  const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || '');
  const id = q.get('fornecedor') || '';
  const f = fornecedorPorId(id);
  if (!f) return voltar(`não conheço o fornecedor «${id || '(nenhum)'}» — os que existem: github, google`);

  const estado = estadoDosFornecedores(env).find((x) => x.id === f.id);
  if (!estado.pronto) {
    /* o browser chegou aqui por um clique: a resposta é legível, com o nome da
       variável e o sítio — não um JSON para programadores */
    return {
      status: 503,
      tipo: 'html',
      corpo: `<!doctype html><meta charset="utf-8"><title>Falta configurar o ${f.nome}</title>
<body style="font-family:system-ui;max-width:640px;margin:10vh auto;line-height:1.5">
<h1 style="font-size:22px">O ${f.nome} ainda não está ligado</h1>
<p>Falta <b>${estado.falta.join(' e ')}</b> na Vercel (Project → Settings → Environment Variables).</p>
<p>Onde se cria: <b>${f.como.onde}</b>.</p>
<p>Endereço de retorno, para colar lá: <code>${uriDeRetorno(f.id, env)}</code></p>
<p><a href="/app">Voltar à Órbita</a> — com o email do dono e a palavra-passe também se entra.</p>
</body>`,
    };
  }

  /* ---------- 1.º passo: sair para o fornecedor ---------- */
  if (q.get('iniciar')) {
    const state = randomBytes(24).toString('hex');
    const destino = urlDeAutorizacao(f.id, { env, state });
    if (!destino) return voltar('não consegui construir o endereço do fornecedor');
    return { status: 302, location: destino, cabecalhos: { 'Set-Cookie': [cookieDeEstado(state)] } };
  }

  /* ---------- 2.º passo: a volta ---------- */
  const code = q.get('code') || '';
  const state = q.get('state') || '';
  const erroDoFornecedor = q.get('error_description') || q.get('error') || '';
  if (erroDoFornecedor) return voltar(`o ${f.nome} recusou: ${erroDoFornecedor}`);
  if (!code || !state) return voltar('a volta do fornecedor veio sem código — tenta outra vez');
  const guardado = cookies[COOKIE_ESTADO] || '';
  if (!guardado || guardado !== state) {
    /* sem o cookie não sabemos que foi este browser a pedir: um link montado por
       outra pessoa não pode abrir sessão nenhuma */
    return voltar('este regresso não é deste browser (state inválido) — começa a entrada outra vez');
  }

  if (!repo) return voltar('esta instalação não tem base de dados ligada');

  const perfil = await perfilDoFornecedor(f.id, { code, env, fetchImpl, retorno: uriDeRetorno(f.id, env) });
  if (!perfil.ok) return voltar(perfil.motivo);
  if (!eODono(perfil.email, env)) {
    await repo.atividade.add('conta', `entrada recusada pelo ${f.nome}: ${perfil.email} não é o dono`).catch(() => null);
    return voltar(`a conta ${mascararEmail(perfil.email)} não é a do dono desta instalação (${mascararEmail(donosDe(env)[0])})`);
  }

  let conta = await repo.contas.porEmail(perfil.email).catch(() => null);
  try {
    if (!conta) {
      conta = await repo.contas.criar({
        email: perfil.email, nome: perfil.nome || perfil.email.split('@')[0], papel: 'dono',
        activo: true, criado: agoraIso(), confirmado_em: agoraIso(), hash: null,
        oauth_fornecedor: f.id, oauth_id: perfil.id || null,
      });
    } else {
      conta = await repo.contas.actualizar(conta.id, {
        oauth_fornecedor: f.id, oauth_id: perfil.id || null,
        confirmado_em: conta.confirmado_em || agoraIso(),
        activo: true,
      });
    }
  } catch (e) {
    return voltar(`a base de dados recusou a conta do dono: ${String(e.message || e).slice(0, 160)}`);
  }
  if (!conta) return voltar('não consegui guardar a conta do dono');

  const sessao = await abrirSessao(repo, conta, { headers: {}, secure: true });
  await repo.atividade.add('conta', `entrou pelo ${f.nome}: ${perfil.email}`).catch(() => null);

  /* dois cabeçalhos: a sessão nasce e o `state` morre */
  return {
    status: 302,
    location: `/app?entrou=${encodeURIComponent(f.id)}`,
    cabecalhos: { 'Set-Cookie': [sessao.cabecalho, cookieDeEstado('', { segundos: 0 })] },
  };
}

/** O `handler` de `/api/oauth`, chamado pelo `/api/rpc` (ver `vercel.json`). */
export default async function tratarOAuth(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.json({ error: 'usa GET — este endereço é para o browser, não para a API' });
    return;
  }
  const url = new URL(String(req.url || '/'), 'http://local');
  const env = process.env;
  let repo = null;
  const base = envBase(env);
  if (base.pronto) {
    try { repo = createSupabaseRepo(base); } catch { repo = null; }
  }

  const r = await processarOAuth({
    repo, env, query: url.searchParams,
    cookies: lerCookies((req.headers && req.headers.cookie) || ''),
  });

  if (r.cabecalhos) for (const [k, v] of Object.entries(r.cabecalhos)) res.setHeader(k, v);
  if (r.location) res.setHeader('Location', r.location);
  res.statusCode = r.status;
  if (r.tipo === 'html') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(r.corpo); return; }
  res.end();
}
