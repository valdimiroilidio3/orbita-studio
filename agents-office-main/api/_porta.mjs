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

const agoraIso = () => new Date().toISOString();
export const limitador = criarLimitador({ janelaMs: 15 * 60 * 1000, max: 5 });

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
  return {
    error: 'entra', mode: 'sessao',
    hint: 'esta instalação tem contas: sem sessão válida não se lê nem se escreve nada',
    primeiraContaPossivel: !!estado.primeiraContaPossivel,
    estado,
  };
}

/* ---------- correio (só quando há chave) ----------
   1.54.1 · uma função só para os dois emails que a porta manda (confirmar a
   conta, recuperar a palavra-passe). Sem RESEND_API_KEY não há envio — e isso é
   dito a quem pediu, com o nome da variável, em vez de um silêncio. */

async function enviarEmail({ para, assunto, texto, env, fetchImpl }) {
  if (!env.RESEND_API_KEY) {
    return { enviado: false, motivo: 'falta RESEND_API_KEY no ambiente — o email não sai daqui sem essa chave' };
  }
  try {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.ORBITA_EMAIL_FROM || 'Orbita <onboarding@resend.dev>',
        to: [para], subject: assunto, text: texto,
      }),
    });
    if (!r.ok) return { enviado: false, motivo: `o Resend respondeu ${r.status}` };
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

async function abrirSessao(repo, conta, { headers = {}, secure = true } = {}) {
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

  /* a porta está dormente? (memória/testes, `seguranca:false`, ou decisão explícita) */
  let dormente = seguranca === false;
  if (seguranca === null || seguranca === undefined) dormente = repo.tipo === 'memoria';

  /* ---------- /auth/* : público, sempre ---------- */
  if (limpo === '/auth/eu' && m === 'GET') {
    const n = dormente ? 0 : await temContas(repo);
    const estado = estadoDaPorta({ temContas: n > 0, env });
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

  if (limpo === '/auth/primeiro-dono' && m === 'POST') {
    const n = await temContas(repo, { forcar: true });
    if (n > 0) return { resposta: { status: 409, corpo: { error: 'esta instalação já tem contas — entra, ou pede a um dono que crie a tua' } } };
    const estado = estadoDaPorta({ temContas: false, env });
    const token = String(corpo?.token || qs.get('token') || '').trim();
    if (estado.exigeToken && token !== String(env.SETUP_TOKEN || env.PROVA_TOKEN || '')) {
      return { resposta: { status: 403, corpo: {
        error: 'falta o token de instalação', precisaToken: true,
        hint: 'esta instalação pede o SETUP_TOKEN para criar a primeira conta — cola-o no campo do token',
      } } };
    }
    const email = normEmail(corpo?.email);
    if (!emailValido(email)) return { resposta: { status: 400, corpo: { error: 'email inválido' } } };
    const nome = String(corpo?.name || '').trim().slice(0, 120);
    const mau = checkPassword(corpo?.password, { email, name: nome });
    if (mau) return { resposta: { status: 400, corpo: { error: mau } } };
    let conta;
    try {
      conta = await repo.contas.criar({
        email, nome, papel: 'dono', hash: hashPassword(corpo.password), activo: true, criado: agoraIso(),
        /* a primeira conta nasce confirmada: quem a cria tem o SETUP_TOKEN na mão */
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
    const s = await abrirSessao(repo, conta, { headers, secure: seguro });
    await repo.atividade.add('conta', `entrou ${email}`).catch(() => null);
    return { resposta: respostaDeEntrada(conta, s) };
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
  const estado = estadoDaPorta({ temContas: n > 0, env });
  if (estado.modo === 'aberta') return { conta: null };

  const s = await lerSessao(repo, headers);
  if (!s) return { resposta: { status: 401, corpo: corpoDoErro({ estado, env }) } };

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
