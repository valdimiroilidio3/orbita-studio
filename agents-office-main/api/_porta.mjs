/* ===========================================================================
   1.54.0 · A PORTA, do lado das rotas.

   Este ficheiro faz duas coisas, e só duas:

     1. responde às rotas `/auth/*` (entrar, sair, quem sou eu, primeira conta,
        recuperar, redefinir) e às rotas de administração de contas e sessões;
     2. barra tudo o resto quando não há sessão válida — e barra com um corpo
        que a mesa sabe ler (`{ error: 'entra', mode: 'sessao', … }`).

   O que NÃO faz: decidir se a instalação é local ou não. Isso vem de fora
   (`seguranca` em `_rotas.mjs`): em memória — testes, browser, modo local — a
   porta fica dormente; com base de dados ligada, fecha. É uma decisão, e está
   dita em voz alta em vez de ser um efeito colateral.
   =========================================================================== */
import {
  ROLES, can, permisosDe, publico, normEmail, emailValido, checkPassword, hashPassword, verifyPassword,
  novoToken, hashToken, tokenDoPedido, cookieDeSessao, cookieParaApagar, sessaoValida,
  criarLimitador, estadoDaPorta, precisaRenovar, HORAS_SESSAO,
} from './_conta.mjs';
/* 1.66.0 · o caminho das máquinas: um token no cabeçalho vale como sessão para a
   API — sem nunca abrir contas nem palavras-passe. Ver `api/_acesso.mjs`. */
import { quemPeloToken, estadoDosTokens, EXPLICACAO, ADMINISTRACAO } from './_acesso.mjs';
/* 1.69.0 · a entrada: GitHub, Google e o código de uso único. As regras são
   puras e vivem em `_entrada.mjs`; aqui só se guarda e se abre a sessão. */
import {
  donosDe, eODono, mascararEmail, codigoNovo, hashCodigo, codigoConfere,
  MINUTOS_CODIGO, TENTATIVAS_CODIGO, opcoesDeEntrada,
} from './_entrada.mjs';

const agoraIso = () => new Date().toISOString();
export const limitador = criarLimitador({ janelaMs: 15 * 60 * 1000, max: 5 });
/* pedir códigos é mais barato do que adivinhar palavras-passe, mas também não é
   de graça: cada pedido manda um email e gasta a quota do Resend */
export const limitadorCodigo = criarLimitador({ janelaMs: 15 * 60 * 1000, max: 6 });

/* o número de contas é perguntado a cada pedido; 30 s de memória chegam e
   evitam uma ida à base por cada leitura da mesa */
const CACHE_CONTAS = new WeakMap();
async function temContas(repo, { forcar = false } = {}) {
  const t = Date.now();
  const c = CACHE_CONTAS.get(repo);
  if (!forcar && c && t - c.em < 30000) return c.n;
  let n = 0;
  try { n = await repo.contas.contar(); } catch { n = 0; }
  CACHE_CONTAS.set(repo, { n, em: t });
  return n;
}
export function esquecerContas(repo) { CACHE_CONTAS.delete(repo); }

/** Quem está deste lado: `{ sessao, conta }` ou null. Nunca lança. */
export async function lerSessao(repo, headers = {}) {
  const token = tokenDoPedido(headers);
  if (!token) return null;
  try {
    const sessao = await repo.sessoes.porHash(hashToken(token));
    if (!sessao || !sessaoValida(sessao)) return null;
    const conta = await repo.contas.porId(sessao.conta_id || sessao.conta);
    if (!conta || conta.activo === false) return null;
    return { sessao, conta };
  } catch { return null; }
}

function corpoDoErro({ estado, env }) {
  const tokens = estado && estado.tokens ? estado.tokens : null;
  const porToken = !!(tokens && (tokens.ORBITA_API_TOKEN?.configurado || tokens.ORBITA_ADMIN_TOKEN?.configurado));
  return {
    error: 'entra', mode: 'sessao',
    hint: 'esta instalação tem contas: sem sessão válida não se lê nem se escreve nada',
    /* 1.66.0 · quem chama isto de um script precisa de saber que há outro
       caminho — e de qual é, sem lhe darmos nenhum segredo */
    ...(porToken ? { tambemPorToken: EXPLICACAO.como } : {}),
    primeiraContaPossivel: !!estado.primeiraContaPossivel,
    estado,
  };
}

/* ---------- correio (só quando há chave) ----------
   1.54.1 · uma função só para os dois emails que a porta manda (confirmar a
   conta, recuperar a palavra-passe). Sem RESEND_API_KEY não há envio — e isso é
   dito a quem pediu, com o nome da variável, em vez de um silêncio. */

/* 1.56.0 · passou a exportada e a aceitar anexos: a fatura segue em PDF, e o
   mesmo caminho serve a porta e a mesa — uma só forma de mandar correio. */
export async function enviarEmail({ para, assunto, texto, env, fetchImpl = fetch, anexos = null, de = null }) {
  if (!env.RESEND_API_KEY) {
    return { enviado: false, motivo: 'falta RESEND_API_KEY no ambiente — o email não sai daqui sem essa chave' };
  }
  try {
    const corpo = {
      from: de || env.ORBITA_EMAIL_FROM || 'Orbita <onboarding@resend.dev>',
      to: [para], subject: assunto, text: texto,
    };
    if (Array.isArray(anexos) && anexos.length) {
      corpo.attachments = anexos.map((a) => ({ filename: a.filename, content: a.content }));
    }
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) {
      let detalhe = '';
      try { detalhe = String((await r.text()) || '').slice(0, 200); } catch { detalhe = ''; }
      return { enviado: false, motivo: `o Resend respondeu ${r.status}${detalhe ? `: ${detalhe}` : ''}` };
    }
    return { enviado: true, motivo: null };
  } catch (e) {
    return { enviado: false, motivo: `não consegui falar com o Resend: ${e.message}` };
  }
}

const basePublica = (env = {}) => String(env.ORBITA_URL || env.ORBITA_URLAR || 'https://orbita-agentes.vercel.app').replace(/\/$/, '');

/** O link de confirmação, ou o de recuperação — ambos com o token no fragmento
 *  (o fragmento não vai para os registos do servidor nem para o Referer). */
export const linkDeConfirmacao = (token, env = {}) => `${basePublica(env)}/app/#/confirmar?t=${encodeURIComponent(token)}`;
export const linkDeRecuperacao = (token, env = {}) => `${basePublica(env)}/app/#/redefinir?t=${encodeURIComponent(token)}`;

/* ---------- criar sessão ---------- */

export async function abrirSessao(repo, conta, { headers = {}, secure = true } = {}) {
  const token = novoToken();
  const horas = HORAS_SESSAO;
  const expira = new Date(Date.now() + horas * 3600 * 1000).toISOString();
  await repo.sessoes.criar({
    conta_id: conta.id,
    token_hash: hashToken(token),
    criado: agoraIso(),
    expira,
    ip: String(headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
    agente: String(headers['user-agent'] || '').slice(0, 200) || null,
  });
  await repo.contas.actualizar(conta.id, { ultimo_acesso: agoraIso() }).catch(() => null);
  return { token, expira, horas, cabecalho: cookieDeSessao(token, { horas, secure }) };
}

function respostaDeEntrada(conta, sessao, extra = {}) {
  return {
    status: 200,
    corpo: {
      ok: true,
      user: publico(conta),
      perms: permisosDe(conta.papel),
      horasSessao: HORAS_SESSAO,
      expira: sessao?.expira || null,
      modo: 'base',
      ...extra,
    },
    cabecalhos: sessao?.cabecalho ? { 'Set-Cookie': sessao.cabecalho } : undefined,
  };
}

/** A resposta de quem tentou entrar com um email que não é o do dono. */
function recusaDeDono(env = {}) {
  const dono = mascararEmail(donosDe(env)[0]);
  return {
    status: 403,
    corpo: {
      error: `esta instalação é de um dono só — só a conta ${dono} entra`,
      soDono: true,
      dono,
      variavel: 'ORBITA_DONO_EMAIL',
      hint: 'para mudar de dono, muda ORBITA_DONO_EMAIL na Vercel (uma lista separada por vírgulas) e faz redeploy',
    },
  };
}

/** O código precisa de correio; sem chave, isto é o que falta — com o nome. */
function semCorreioParaCodigo(env = {}) {
  return {
    status: 503,
    corpo: {
      error: 'não há correio configurado: o código não pode sair daqui',
      falta: ['RESEND_API_KEY'],
      como: 'resend.com → API Keys → Create API Key; depois RESEND_API_KEY e ORBITA_EMAIL_FROM na Vercel',
      alternativa: 'entra com o email e a palavra-passe — sem correio, é o caminho que existe',
      dono: mascararEmail(donosDe(env)[0]),
    },
  };
}

/**
 * Avalia a porta. Devolve:
 *   · `{ resposta }` — já há resposta (entrar/sair/401/…); `_rotas.mjs` devolve-a;
 *   · `{ conta, sessao }` — segue para as rotas normais (conta null se aberta).
 */
export async function avaliarPorta(repo, {
  caminho, metodo = 'GET', corpo = null, env = process.env, headers = {},
  fetchImpl = fetch, seguranca = null, ip = null,
} = {}) {
  const limpo = '/' + String(caminho || '').replace(/^\/+/, '').split('?')[0];
  const qs = new URLSearchParams(String(caminho || '').split('?')[1] || '');
  const m = String(metodo || 'GET').toUpperCase();
  const seguro = !!headers['x-forwarded-proto'] ? String(headers['x-forwarded-proto']) === 'https' : true;
  /* o retrato da porta inclui os tokens: a mesa e o erro dizem se há caminho de
     máquina, sem nunca mostrar o valor de nenhum */
  const estadoDe = (temContas) => ({
    ...estadoDaPorta({ temContas, env }),
    tokens: estadoDosTokens(env),
    /* 1.69.0 · o ecrã de entrada sabe o que oferecer sem uma segunda chamada —
       e sabe o que falta a cada caminho, para o dizer em vez de falhar */
    entrada: opcoesDeEntrada(env),
  });

  /* a porta está dormente? (memória/testes, `seguranca:false`, ou decisão explícita) */
  let dormente = seguranca === false;
  if (seguranca === null || seguranca === undefined) dormente = repo.tipo === 'memoria';

  /* ---------- /auth/* : público, sempre ---------- */
  if (limpo === '/auth/eu' && m === 'GET') {
    const n = dormente ? 0 : await temContas(repo);
    const estado = estadoDe(n > 0);
    const s = await lerSessao(repo, headers);
    if (s) {
      /* 1.54.1 · renovação com o uso: quem abre a Órbita a meio do prazo ganha
         mais 12 h. A extensão é gravada na base E o cookie é reenviado — sem as
         duas coisas, o browser fechava a porta antes do servidor. */
      let expira = s.sessao.expira || null;
      let cabecalhos;
      if (precisaRenovar(s.sessao)) {
        const nova = new Date(Date.now() + HORAS_SESSAO * 3600 * 1000).toISOString();
        await repo.sessoes.actualizar(s.sessao.id, { expira: nova }).catch(() => null);
        expira = nova;
        const token = tokenDoPedido(headers);
        if (token) cabecalhos = { 'Set-Cookie': cookieDeSessao(token, { horas: HORAS_SESSAO, secure: seguro }) };
      }
      return { resposta: {
        status: 200,
        corpo: {
          user: publico(s.conta), perms: permisosDe(s.conta.papel), horasSessao: HORAS_SESSAO,
          expira, modo: 'base', estado, renovada: !!cabecalhos,
        },
        ...(cabecalhos ? { cabecalhos } : {}),
      } };
    }
    /* sem sessão: se a porta está dormente (modo local) dizemo-lo em vez de 401 */
    if (dormente || String(env.ORBITA_AUTH || '').toLowerCase() === 'aberta') {
      return { resposta: {
        status: 200,
        corpo: {
          user: { id: 'base', name: 'Dono', email: '', role: 'dono', roleLabel: 'base de dados' },
          perms: permisosDe('dono'), horasSessao: HORAS_SESSAO, modo: 'base',
          /* a porta não está fechada aqui, e diz-se: sem contas nesta instalação */
          estado, semContas: true,
        },
      } };
    }
    if (n === 0) {
      return { resposta: { status: 401, corpo: {
        error: 'entra', mode: 'sessao',
        hint: 'esta instalação ainda não tem contas: cria a primeira (fica dona)',
        primeiraContaPossivel: true, estado,
      } } };
    }
    return { resposta: { status: 401, corpo: corpoDoErro({ estado, env }) } };
  }

  /* =========================================================================
     1.69.0 · A ENTRADA DO DONO (6 nov 2026)

     Três portas, uma pessoa. O dono pediu-o por palavras: GitHub, Google, ou
     email com um código de uso único — e só a conta dele entra. Um produto de
     um homem só não pode ter registo aberto: cada visita criava conta e ficava
     com uma porta para os dados do dono.

     O que aqui se garante, e não é retórica:
       · a lista de quem entra é `ORBITA_DONO_EMAIL` (padrão: a conta do dono);
       · o código tem 6 dígitos, vale 10 minutos, serve uma vez e morre ao fim
         de 5 tentativas — e na base só fica o sha256, nunca o código;
       · sem `RESEND_API_KEY` o código NÃO sai, e a resposta diz o nome da
         variável em vez de ficar um ecrã à espera de um email que não existe;
       · nenhuma destas rotas abre sessão sem o email certo.
     ========================================================================= */

  if (limpo === '/auth/opcoes' && (m === 'GET' || m === 'POST')) {
    return { resposta: { status: 200, corpo: { ok: true, ...opcoesDeEntrada(env) } } };
  }

  if (limpo === '/auth/codigo' && m === 'POST') {
    const email = normEmail(corpo?.email);
    if (!emailValido(email)) return { resposta: { status: 400, corpo: { error: 'email inválido' } } };
    const chave = `codigo|${email}|${ip || String(headers['x-forwarded-for'] || '').split(',')[0].trim()}`;
    const ritmo = limitadorCodigo.ver(chave);
    if (!ritmo.ok) {
      return { resposta: { status: 429, corpo: {
        error: `pediste demasiados códigos — espera ${Math.ceil(ritmo.esperaMs / 60000)} min`,
        esperaMs: ritmo.esperaMs,
      } } };
    }
    if (!eODono(email, env)) {
      limitadorCodigo.falhou(chave);
      return { resposta: recusaDeDono(env) };
    }
    if (!String(env.RESEND_API_KEY || '').trim()) {
      return { resposta: semCorreioParaCodigo(env) };
    }
    /* a conta do dono nasce no primeiro código: não há registo separado, e
       pedir uma palavra-passe antes de provar o email é trabalho a mais */
    let conta = await repo.contas.porEmail(email).catch(() => null);
    let contaNova = false;
    if (!conta) {
      try {
        conta = await repo.contas.criar({
          email, nome: String(corpo?.name || '').trim().slice(0, 120) || email.split('@')[0],
          papel: 'dono', activo: true, criado: agoraIso(), confirmado_em: null, hash: null,
        });
        contaNova = true;
      } catch (e) {
        return { resposta: { status: 503, corpo: {
          error: 'a base de dados não deixou criar a conta do dono',
          instrucao: 'aplica supabase/orbita_1_54_0.sql (contas) e supabase/orbita_1_69_0.sql (códigos)',
          detalhe: String(e.message || e).slice(0, 200),
        } } };
      }
      CACHE_CONTAS.delete(repo);
    }
    const codigo = codigoNovo();
    const expira = new Date(Date.now() + MINUTOS_CODIGO * 60000).toISOString();
    try {
      await repo.contas.actualizar(conta.id, {
        codigo_hash: hashCodigo(codigo, email), codigo_expira: expira, codigo_tentativas: 0,
      });
    } catch (e) {
      /* a tabela existe mas não tem as colunas novas: é uma migração por
         aplicar, e a frase diz o ficheiro — não é uma avaria misteriosa */
      return { resposta: { status: 503, corpo: {
        error: 'a base de dados ainda não tem as colunas do código de entrada',
        instrucao: 'aplica supabase/orbita_1_69_0.sql no Supabase (ou /api/setup?token=…&so=orbita_1_69_0.sql)',
        detalhe: String(e.message || e).slice(0, 200),
      } } };
    }
    const envio = await enviarEmail({
      para: email,
      assunto: `O teu código de entrada na Órbita: ${codigo}`,
      texto: `O teu código é ${codigo}\n\nVale ${MINUTOS_CODIGO} minutos e serve uma vez. Se não foste tu a pedir, ignora este email: sem o código ninguém entra.`,
      env, fetchImpl,
    });
    if (!envio.enviado) {
      /* o código existe na base, mas ninguém o recebeu: dizer «enviado» seria
         a mentira mais fácil deste ficheiro */
      return { resposta: { status: 502, corpo: {
        error: 'o código foi gerado mas o correio não saiu',
        motivo: envio.motivo,
        como: 'confirma RESEND_API_KEY e ORBITA_EMAIL_FROM (o domínio tem de estar verificado no Resend)',
      } } };
    }
    limitadorCodigo.acertou(chave);
    await repo.atividade.add('conta', `código de entrada pedido para ${email}${contaNova ? ' (conta do dono criada)' : ''}`).catch(() => null);
    return { resposta: { status: 200, corpo: {
      ok: true, enviado: true, para: mascararEmail(email), minutos: MINUTOS_CODIGO,
      tentativas: TENTATIVAS_CODIGO, ...(contaNova ? { contaNova: true } : {}),
      mensagem: `o código foi para ${mascararEmail(email)} — vale ${MINUTOS_CODIGO} minutos`,
    } } };
  }

  if (limpo === '/auth/codigo/verificar' && m === 'POST') {
    const email = normEmail(corpo?.email);
    const codigo = String(corpo?.codigo || '').replace(/\D/g, '');
    if (!emailValido(email)) return { resposta: { status: 400, corpo: { error: 'email inválido' } } };
    if (codigo.length !== 6) return { resposta: { status: 400, corpo: { error: 'o código tem 6 dígitos' } } };
    const conta = await repo.contas.porEmail(email).catch(() => null);
    /* a mesma frase para «não há conta» e «não há código»: o email é o do dono,
       mas não há razão para dizer a um estranho em que passo está */
    if (!conta) return { resposta: { status: 400, corpo: { error: 'não há um código à espera deste email — pede um' } } };
    const conf = codigoConfere(conta, codigo);
    if (!conf.ok) {
      const tentativas = Number(conta.codigo_tentativas || 0) + 1;
      await repo.contas.actualizar(conta.id, { codigo_tentativas: tentativas }).catch(() => null);
      return { resposta: { status: 401, corpo: {
        error: conf.motivo,
        estado: conf.estado,
        ...(conf.restam !== undefined ? { restam: conf.restam } : {}),
      } } };
    }
    const confirmada = await repo.contas.actualizar(conta.id, {
      codigo_hash: null, codigo_expira: null, codigo_tentativas: 0,
      confirmado_em: conta.confirmado_em || agoraIso(),
    });
    const s = await abrirSessao(repo, confirmada || conta, { headers, secure: seguro });
    await repo.atividade.add('conta', `entrou com código de email ${email}`).catch(() => null);
    return { resposta: respostaDeEntrada(confirmada || conta, s, { entrouPorCodigo: true }) };
  }

  if (limpo === '/auth/primeiro-dono' && m === 'POST') {
    const n = await temContas(repo, { forcar: true });
    if (n > 0) return { resposta: { status: 409, corpo: { error: 'esta instalação já tem contas — entra, ou pede a um dono que crie a tua' } } };
    const estado = estadoDaPorta({ temContas: false, env });
    const token = String(corpo?.token || qs.get('token') || '').trim();
    /* 1.75.0 · o token só se pede quando o registo está aberto (ver
       `estadoDaPorta`): numa instalação de um dono só quem fecha a porta é o
       email, e pedir um segredo da Vercel além disso só travava o dono. */
    if (estado.exigeToken && token !== String(env.SETUP_TOKEN || env.PROVA_TOKEN || '')) {
      return { resposta: { status: 403, corpo: {
        error: 'falta o token de instalação', precisaToken: true,
        hint: 'esta instalação pede o SETUP_TOKEN para criar a primeira conta — cola-o no campo do token',
      } } };
    }
    const email = normEmail(corpo?.email);
    if (!emailValido(email)) return { resposta: { status: 400, corpo: { error: 'email inválido' } } };
    /* 1.69.0 · a primeira conta é a do dono, e é a que está na lista. Sem isto,
       quem chegasse primeiro ao URL ficava com a instalação — a 1.54.0 já o
       impedia por ordem de chegada, não por identidade. */
    if (String(env.ORBITA_REGISTO || '').toLowerCase() !== 'aberto' && !eODono(email, env)) {
      return { resposta: recusaDeDono(env) };
    }
    const nome = String(corpo?.name || '').trim().slice(0, 120);
    const mau = checkPassword(corpo?.password, { email, name: nome });
    if (mau) return { resposta: { status: 400, corpo: { error: mau } } };
    let conta;
    try {
      conta = await repo.contas.criar({
        email, nome, papel: 'dono', hash: hashPassword(corpo.password), activo: true, criado: agoraIso(),
        /* a primeira conta nasce confirmada: o email é o do dono (ou o token
           foi apresentado), não é uma caixa por provar */
        confirmado_em: agoraIso(),
      });
    } catch (e) {
      /* a tabela ainda não existe: isto é uma migração por aplicar, não uma
         avaria — e a frase tem de dizer isso com o ficheiro certo */
      return { resposta: { status: 503, corpo: {
        error: 'a base de dados ainda não tem as tabelas da porta (orbita_contas, orbita_sessoes)',
        instrucao: 'aplica supabase/orbita_1_54_0.sql no Supabase, ou corre /api/setup?token=…&so=orbita_1_54_0.sql',
        detalhe: String(e.message || e).slice(0, 200),
      } } };
    }
    CACHE_CONTAS.delete(repo);
    const s = await abrirSessao(repo, conta, { headers, secure: seguro });
    await repo.atividade.add('conta', `primeira conta criada (${email}) — é a dona desta instalação`).catch(() => null);
    return { resposta: respostaDeEntrada(conta, s, { primeiraConta: true }) };
  }

  /* ---------- 1.54.1 · a conta nasce sozinha ----------
     Registo aberto (fecha-se com `ORBITA_REGISTO=fechado`), papel mínimo — quem
     se inscreve entra como `leitor` e um dono sobe o papel. A conta fica por
     confirmar até o email provar que a caixa existe; sem `RESEND_API_KEY` o
     link não sai e a conta é confirmada por um dono em Contas (e isso é dito,
     com o nome da variável). */
  if (limpo === '/auth/registo' && m === 'POST') {
    if (String(env.ORBITA_REGISTO || '').toLowerCase() === 'fechado') {
      return { resposta: { status: 403, corpo: {
        error: 'esta instalação não aceita contas novas pelo site',
        hint: 'pede a um dono que crie a tua conta em Contas',
      } } };
    }
    const email = normEmail(corpo?.email);
    if (!emailValido(email)) return { resposta: { status: 400, corpo: { error: 'email inválido' } } };
    /* 1.69.0 · por omissão o registo está fechado a todos menos ao dono. Abrir a
       instalação a mais alguém é uma decisão explícita (`ORBITA_REGISTO=aberto`),
       não o que acontece a quem não fez nada. */
    if (String(env.ORBITA_REGISTO || '').toLowerCase() !== 'aberto' && !eODono(email, env)) {
      return { resposta: recusaDeDono(env) };
    }
    const nome = String(corpo?.name || '').trim().slice(0, 120) || email.split('@')[0];
    const mau = checkPassword(corpo?.password, { email, name: nome });
    if (mau) return { resposta: { status: 400, corpo: { error: mau } } };
    if (await repo.contas.porEmail(email).catch(() => null)) {
      return { resposta: { status: 409, corpo: {
        error: 'já existe uma conta com este email',
        hint: 'entra, ou pede a recuperação da palavra-passe se te esqueceste',
      } } };
    }
    const token = novoToken();
    let conta;
    try {
      conta = await repo.contas.criar({
        email, nome, papel: 'leitor', hash: hashPassword(corpo.password), activo: true,
        criado: agoraIso(), confirmado_em: null,
        confirmar_hash: hashToken(token), confirmar_expira: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      });
    } catch (e) {
      return { resposta: { status: 503, corpo: {
        error: 'a base de dados ainda não tem as colunas da confirmação',
        instrucao: 'aplica supabase/orbita_1_54_1.sql (ou corre /api/setup?token=…&so=orbita_1_54_1.sql)',
        detalhe: String(e.message || e).slice(0, 200),
      } } };
    }
    CACHE_CONTAS.delete(repo);
    const envio = await enviarEmail({
      para: email,
      assunto: 'Confirma a tua conta na Órbita',
      texto: `Falta um passo: abrir este link (vale 24 horas, uma vez só).\n\n${linkDeConfirmacao(token, env)}\n\nSe não foste tu a criar a conta, ignora este email.`,
      env, fetchImpl,
    });
    await repo.atividade.add('conta', `registo de ${email} (por confirmar${envio.enviado ? ', email enviado' : ', sem email'})`).catch(() => null);
    return { resposta: { status: 201, corpo: {
      ok: true,
      contaCriada: true,
      porConfirmar: true,
      emailEnviado: envio.enviado,
      /* sem chave de correio, o link SÓ se mostra aqui uma vez — é o único
         caminho honesto para o dono confirmar sem inventar um email */
      ...(envio.enviado ? {} : {
        nota: envio.motivo,
        instrucao: 'um dono confirma esta conta em Contas → «confirmar»; ou define RESEND_API_KEY e repete o registo noutro email',
      }),
      mensagem: envio.enviado
        ? 'conta criada — abre o link que foi para o teu email (vale 24 horas)'
        : 'conta criada e POR CONFIRMAR: não há correio configurado nesta instalação',
    } } };
  }

  if ((limpo === '/auth/confirmar' || limpo === '/auth/reenviar') && m === 'POST') {
    const token = String(corpo?.token || '').trim();
    if (limpo === '/auth/reenviar') {
      /* reenviar é pedido por email: a resposta não diz se a conta existe */
      const email = normEmail(corpo?.email);
      const conta = email ? await repo.contas.porEmail(email).catch(() => null) : null;
      let envio = { enviado: false, motivo: 'sem conta para esse email' };
      if (conta && !conta.confirmado_em) {
        const novo = novoToken();
        await repo.contas.actualizar(conta.id, {
          confirmar_hash: hashToken(novo), confirmar_expira: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }).catch(() => null);
        envio = await enviarEmail({
          para: conta.email, assunto: 'Confirma a tua conta na Órbita',
          texto: `Aqui vai outro link de confirmação (vale 24 horas, uma vez só):\n\n${linkDeConfirmacao(novo, env)}`,
          env, fetchImpl,
        });
      }
      return { resposta: { status: 200, corpo: {
        ok: true,
        mensagem: 'se houver uma conta por confirmar com esse email, o link segue para lá',
        emailConfigurado: !!env.RESEND_API_KEY,
        ...(conta && !conta.confirmado_em && !envio.enviado ? { nota: envio.motivo } : {}),
      } } };
    }
    if (!token) return { resposta: { status: 400, corpo: { error: 'falta o token do link' } } };
    const h = hashToken(token);
    let alvo = null;
    for (const c of await repo.contas.listar().catch(() => [])) {
      const inteira = await repo.contas.porId(c.id).catch(() => null);
      if (inteira?.confirmar_hash === h) { alvo = inteira; break; }
    }
    if (!alvo) return { resposta: { status: 400, corpo: { error: 'este link não serve (já foi usado) — pede outro' } } };
    if (new Date(alvo.confirmar_expira || 0).getTime() < Date.now()) {
      return { resposta: { status: 400, corpo: { error: 'este link passou das 24 horas — pede outro' } } };
    }
    const confirmada = await repo.contas.actualizar(alvo.id, {
      confirmado_em: agoraIso(), confirmar_hash: null, confirmar_expira: null,
    });
    const s = await abrirSessao(repo, confirmada, { headers, secure: seguro });
    await repo.atividade.add('conta', `${alvo.email} confirmou a conta`).catch(() => null);
    return { resposta: respostaDeEntrada(confirmada, s, { confirmadaAgora: true }) };
  }

  if (limpo === '/auth/entrar' && m === 'POST') {
    const email = normEmail(corpo?.email);
    const chave = `${email}|${ip || String(headers['x-forwarded-for'] || '').split(',')[0].trim()}`;
    const ritmo = limitador.ver(chave);
    if (!ritmo.ok) {
      return { resposta: { status: 429, corpo: {
        error: `demasiadas tentativas — espera ${Math.ceil(ritmo.esperaMs / 60000)} min`,
        esperaMs: ritmo.esperaMs,
      } } };
    }
    const conta = email ? await repo.contas.porEmail(email).catch(() => null) : null;
    const certa = conta && conta.activo !== false && verifyPassword(corpo?.password, conta.hash);
    if (!certa) {
      limitador.falhou(chave);
      /* a mesma frase para «não existe» e «palavra-passe errada»: não se diz a
         um estranho quais dos emails existem nesta instalação */
      return { resposta: { status: 401, corpo: { error: 'email ou palavra-passe não conferem', restam: Math.max(0, ritmo.restam - 1) } } };
    }
    limitador.acertou(chave);
    /* 1.54.1 · a palavra-passe está certa, mas a conta ainda não foi confirmada:
       isto não é uma falha de credenciais, é um passo em falta — e diz-se qual. */
    if (!conta.confirmado_em) {
      return { resposta: { status: 403, corpo: {
        error: 'a tua conta ainda não está confirmada',
        naoConfirmada: true,
        hint: 'abre o link que foi para o teu email; se não chegou, pede outro',
        podeReenviar: true,
      } } };
    }
    /* 1.69.0 · com correio configurado, a palavra-passe sozinha NÃO abre a
       sessão: manda-se um código de 6 dígitos e é ele que abre. Sem correio
       configurado não há como mandar o código — e nesse caso entra-se com a
       palavra-passe, dizendo em voz alta que o segundo passo não aconteceu. */
    if (String(env.RESEND_API_KEY || '').trim()) {
      const codigo = codigoNovo();
      const expira = new Date(Date.now() + MINUTOS_CODIGO * 60000).toISOString();
      try {
        await repo.contas.actualizar(conta.id, {
          codigo_hash: hashCodigo(codigo, email), codigo_expira: expira, codigo_tentativas: 0,
        });
      } catch (e) {
        return { resposta: { status: 503, corpo: {
          error: 'a base de dados ainda não tem as colunas do código de entrada',
          instrucao: 'aplica supabase/orbita_1_69_0.sql no Supabase',
          detalhe: String(e.message || e).slice(0, 200),
        } } };
      }
      const envio = await enviarEmail({
        para: email,
        assunto: `O teu código de entrada na Órbita: ${codigo}`,
        texto: `O teu código é ${codigo}\n\nVale ${MINUTOS_CODIGO} minutos e serve uma vez. A palavra-passe já estava certa — falta este passo.`,
        env, fetchImpl,
      });
      if (!envio.enviado) {
        return { resposta: { status: 502, corpo: {
          error: 'a palavra-passe está certa, mas o código não saiu',
          motivo: envio.motivo,
          como: 'confirma RESEND_API_KEY e ORBITA_EMAIL_FROM',
        } } };
      }
      await repo.atividade.add('conta', `palavra-passe certa para ${email} — código enviado`).catch(() => null);
      return { resposta: { status: 200, corpo: {
        ok: true, precisaCodigo: true, naoEntrou: true,
        para: mascararEmail(email), minutos: MINUTOS_CODIGO, tentativas: TENTATIVAS_CODIGO,
        mensagem: `falta o código: foi para ${mascararEmail(email)} e vale ${MINUTOS_CODIGO} minutos`,
      } } };
    }
    const s = await abrirSessao(repo, conta, { headers, secure: seguro });
    await repo.atividade.add('conta', `entrou ${email}`).catch(() => null);
    return { resposta: respostaDeEntrada(conta, s, {
      semCodigo: true,
      nota: 'entrou com a palavra-passe: não há RESEND_API_KEY nesta instalação, por isso o código de email não pôde ser pedido',
    }) };
  }

  if (limpo === '/auth/sair' && m === 'POST') {
    const token = tokenDoPedido(headers);
    if (token) {
      const s = await repo.sessoes.porHash(hashToken(token)).catch(() => null);
      if (s) await repo.sessoes.revogar(s.id).catch(() => null);
    }
    return { resposta: { status: 200, corpo: { ok: true }, cabecalhos: { 'Set-Cookie': cookieParaApagar({ secure: seguro }) } } };
  }

  if (limpo === '/auth/recuperar' && m === 'POST') {
    const email = normEmail(corpo?.email);
    const conta = email ? await repo.contas.porEmail(email).catch(() => null) : null;
    let entrega = { enviado: false, motivo: 'sem conta para esse email' };
    if (conta && conta.activo !== false) {
      const token = novoToken();
      const expira = new Date(Date.now() + 30 * 60000).toISOString();
      await repo.contas.actualizar(conta.id, { recuperar_hash: hashToken(token), recuperar_expira: expira });
      entrega = await enviarEmail({
        para: conta.email,
        assunto: 'Recuperar a palavra-passe da Órbita',
        texto: `Pede-se uma palavra-passe nova com este link (vale 30 minutos, uma vez só):\n\n${linkDeRecuperacao(token, env)}\n\nSe não foste tu, ignora este email.`,
        env, fetchImpl,
      });
    }
    /* a resposta é a mesma exista ou não a conta: não se enumeram emails */
    return { resposta: { status: 200, corpo: {
      ok: true,
      mensagem: 'se houver uma conta com esse email, o link de recuperação segue para lá (vale 30 minutos)',
      emailConfigurado: !!env.RESEND_API_KEY,
      ...(conta && !entrega.enviado ? { nota: entrega.motivo } : {}),
    } } };
  }

  if (limpo === '/auth/redefinir' && m === 'POST') {
    const token = String(corpo?.token || '').trim();
    if (!token) return { resposta: { status: 400, corpo: { error: 'falta o token do link' } } };
    const h = hashToken(token);
    const contas = await repo.contas.listar().catch(() => []);
    let alvo = null;
    for (const c of contas) {
      const inteira = await repo.contas.porId(c.id).catch(() => null);
      if (inteira?.recuperar_hash === h) { alvo = inteira; break; }
    }
    if (!alvo) return { resposta: { status: 400, corpo: { error: 'este link não serve (já foi usado, ou passou dos 30 minutos) — pede outro' } } };
    if (new Date(alvo.recuperar_expira || 0).getTime() < Date.now()) {
      return { resposta: { status: 400, corpo: { error: 'este link passou dos 30 minutos — pede outro' } } };
    }
    const mau = checkPassword(corpo?.password, { email: alvo.email, name: alvo.nome || '' });
    if (mau) return { resposta: { status: 400, corpo: { error: mau } } };
    const actualizada = await repo.contas.actualizar(alvo.id, {
      hash: hashPassword(corpo.password), recuperar_hash: null, recuperar_expira: null,
    });
    /* uma palavra-passe nova fecha as sessões antigas: é o que se espera de
       quem recupera uma conta precisamente porque a perdeu */
    for (const s of await repo.sessoes.listar(200).catch(() => [])) {
      if ((s.conta_id || s.conta) === alvo.id && !s.revogada) await repo.sessoes.revogar(s.id).catch(() => null);
    }
    const sessao = await abrirSessao(repo, actualizada, { headers, secure: seguro });
    return { resposta: respostaDeEntrada(actualizada, sessao, { palavraPasseNova: true }) };
  }

  /* ---------- a partir daqui: a porta ---------- */
  if (limpo === '/health') return { conta: null };
  if (limpo === '/media' || limpo.startsWith('/media/')) return { conta: null };   // token de worker
  /* os webhooks têm o seu próprio segredo (Meta, Resend) e são chamados por
     máquinas que não têm sessão: fechá-los aqui só os partiria */
  if (limpo.startsWith('/webhooks')) return { conta: null };

  if (dormente) return { conta: null };

  const n = await temContas(repo);
  const estado = estadoDe(n > 0);
  if (estado.modo === 'aberta') return { conta: null };

  let s = await lerSessao(repo, headers);
  if (!s) {
    /* 1.66.0 · sem sessão, ainda pode ser uma máquina com o token certo. Isto é
       o que os `ORBITA_*_TOKEN` sempre disseram fazer — e agora fazem.
       O token entra como QUEM É (operador ou dono) e passa pelo MESMO teste de
       papel que uma conta: um operador por token também não aprova. Devolver
       cedo daqui era dar acesso total a um token de operador — o teste 10 desta
       versão existe precisamente por causa disso. */
    const quem = quemPeloToken({ headers, corpo, env });
    if (!quem) return { resposta: { status: 401, corpo: corpoDoErro({ estado, env }) } };
    const segT = limpo.split('/').filter(Boolean);
    if (segT[0] === 'ops' && ADMINISTRACAO.includes(segT[1])) {
      return { resposta: { status: 403, corpo: {
        error: 'contas e palavras-passe não se abrem com token',
        hint: EXPLICACAO.contas, via: 'token', variavel: quem.variavel,
      } } };
    }
    s = { sessao: null, conta: { id: quem.id, nome: quem.nome, email: '', papel: quem.papel, via: 'token', variavel: quem.variavel } };
  }

  const papel = s.conta.papel;
  const seg = limpo.split('/').filter(Boolean);
  const admin = (seg[0] === 'ops' && ['utilizadores', 'sessoes', 'contas'].includes(seg[1]));
  const escreve = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m);
  const aprova = /\/(aprovar|aprova|concluir|entregar|enviar|publicar|desactivar)$/.test(limpo);

  let exige = 'read';
  if (admin) exige = 'admin';
  else if (aprova) exige = 'approve';
  else if (escreve) exige = 'write';

  if (!can(papel, exige)) {
    return { resposta: { status: 403, corpo: {
      error: `o teu papel (${papel}) não permite ${exige}`,
      exige, papel,
      hint: 'pede a um dono que te suba o papel em Contas, ou usa uma conta com mais poderes',
    } } };
  }

  /* ---------- administração de contas e sessões (aqui, com a sessão na mão) ---------- */
  if (limpo === '/ops/utilizadores' && m === 'GET') {
    const lista = await repo.contas.listar();
    return { resposta: { status: 200, corpo: {
      utilizadores: lista.map(publico),
      papeis: ROLES.map((r) => ({ key: r.key, label: r.label, level: r.level, does: r.does })),
      /* nunca a palavra-passe, nem o hash, nem o token */
      nota: 'as palavras-passe não saem daqui: nem o hash',
    } } };
  }

  if (limpo === '/ops/utilizadores' && m === 'POST') {
    const email = normEmail(corpo?.email);
    if (!emailValido(email)) return { resposta: { status: 400, corpo: { error: 'email inválido' } } };
    if (await repo.contas.porEmail(email).catch(() => null)) return { resposta: { status: 409, corpo: { error: 'já existe uma conta com este email' } } };
    const papel = String(corpo?.role || 'leitor');
    if (!ROLES.some((r) => r.key === papel)) return { resposta: { status: 400, corpo: { error: `papel desconhecido: ${papel}` } } };
    if (papel === 'dono' && s.conta.papel !== 'dono') return { resposta: { status: 403, corpo: { error: 'só um dono cria outro dono' } } };
    const nome = String(corpo?.name || '').trim().slice(0, 120) || email.split('@')[0];
    const mau = checkPassword(corpo?.password, { email, name: nome });
    if (mau) return { resposta: { status: 400, corpo: { error: mau } } };
    const conta = await repo.contas.criar({
      email, nome, papel, hash: hashPassword(corpo.password), activo: true, criado: agoraIso(),
      /* criada por um dono: o email já é do conhecimento dele, não fica pendente */
      confirmado_em: agoraIso(),
    });
    CACHE_CONTAS.delete(repo);
    await repo.atividade.add('conta', `conta criada para ${email} (${papel}) por ${s.conta.email}`).catch(() => null);
    return { resposta: { status: 201, corpo: { ok: true, utilizador: publico(conta) } } };
  }

  if (seg[0] === 'ops' && seg[1] === 'utilizadores' && seg.length === 4 && m === 'POST') {
    const alvo = await repo.contas.porId(seg[2]).catch(() => null);
    if (!alvo) return { resposta: { status: 404, corpo: { error: 'conta não encontrada' } } };
    if (seg[3] === 'desactivar') {
      if (alvo.id === s.conta.id) return { resposta: { status: 400, corpo: { error: 'não podes desactivar a tua própria conta' } } };
      if (alvo.papel === 'dono') {
        const donos = (await repo.contas.listar()).filter((c) => c.papel === 'dono' && c.activo !== false);
        if (donos.length <= 1) return { resposta: { status: 400, corpo: { error: 'esta é a última conta de dono — a instalação ficaria sem ninguém que a administre' } } };
      }
      const c = await repo.contas.actualizar(alvo.id, { activo: false });
      await repo.atividade.add('conta', `conta ${alvo.email} desactivada por ${s.conta.email}`).catch(() => null);
      return { resposta: { status: 200, corpo: { ok: true, utilizador: publico(c) } } };
    }
    if (seg[3] === 'confirmar') {
      const c = await repo.contas.actualizar(alvo.id, { confirmado_em: agoraIso(), confirmar_hash: null, confirmar_expira: null });
      await repo.atividade.add('conta', `${alvo.email} confirmada à mão por ${s.conta.email}`).catch(() => null);
      return { resposta: { status: 200, corpo: { ok: true, utilizador: publico(c) } } };
    }
    if (seg[3] === 'reenviar-confirmacao') {
      const novo = novoToken();
      await repo.contas.actualizar(alvo.id, {
        confirmar_hash: hashToken(novo), confirmar_expira: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      }).catch(() => null);
      const envio = await enviarEmail({
        para: alvo.email, assunto: 'Confirma a tua conta na Órbita',
        texto: `Aqui vai o link de confirmação (vale 24 horas, uma vez só):\n\n${linkDeConfirmacao(novo, env)}`,
        env, fetchImpl,
      });
      return { resposta: { status: 200, corpo: { ok: true, enviado: envio.enviado, nota: envio.motivo } } };
    }
    if (seg[3] === 'papel') {
      const papel = String(corpo?.role || '');
      if (!ROLES.some((r) => r.key === papel)) return { resposta: { status: 400, corpo: { error: `papel desconhecido: ${papel}` } } };
      if (alvo.id === s.conta.id && papel !== 'dono') return { resposta: { status: 400, corpo: { error: 'não podes tirar-te os poderes a ti próprio' } } };
      const c = await repo.contas.actualizar(alvo.id, { papel });
      await repo.atividade.add('conta', `${alvo.email} passou a ${papel} (por ${s.conta.email})`).catch(() => null);
      return { resposta: { status: 200, corpo: { ok: true, utilizador: publico(c) } } };
    }
  }

  if (limpo === '/ops/sessoes' && m === 'GET') {
    const lista = await repo.sessoes.listar(60);
    const contas = new Map((await repo.contas.listar()).map((c) => [c.id, c]));
    return { resposta: { status: 200, corpo: { sessoes: lista.map((x) => ({
      id: x.id,
      user: contas.get(x.conta_id || x.conta)?.email || '(conta apagada)',
      state: x.revogada ? 'fechada' : (new Date(x.expira || 0).getTime() > Date.now() ? 'activa' : 'expirada'),
      created_at: x.criado || x.created_at || null,
      expires_at: x.expira || x.expires_at || null,
      ip: x.ip || null,
      actual: x.id === (s.sessao?.id || null),
    })) } } };
  }

  if (seg[0] === 'ops' && seg[1] === 'sessoes' && seg.length === 3 && m === 'DELETE') {
    const feita = await repo.sessoes.revogar(seg[2]).catch(() => null);
    if (!feita) return { resposta: { status: 404, corpo: { error: 'sessão não encontrada' } } };
    await repo.atividade.add('conta', `sessão fechada à mão por ${s.conta.email}`).catch(() => null);
    return { resposta: { status: 200, corpo: { ok: true } } };
  }

  return { conta: publico(s.conta), sessao: s.sessao, sessaoCrua: s };
}
