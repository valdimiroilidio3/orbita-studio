/* ===========================================================================
   1.69.0 · A ENTRADA DO DONO (6 nov 2026)

   O dono pediu-o por palavras: «login por github ou por google ou por email e
   senha, onde mandaram um otp no email para confirmar o usuario, mas só deve
   aceitar a do chelton — quem será único usuário do projeto».

   Este ficheiro prova as três coisas que essa frase exige, e a quarta que ela
   implica (só uma pessoa entra):

     · o código de 6 dígitos: nasce, vale 10 minutos, serve uma vez, morre ao
       fim de 5 tentativas — e na base só fica o sha256;
     · com correio configurado, a palavra-passe certa NÃO abre sessão sozinha;
       sem correio, abre, e a resposta di-lo em voz alta;
     · GitHub e Google: o `state` tem de ser deste browser, o email tem de vir
       verificado pelo fornecedor, e a única conta aceite é a do dono;
     · qualquer outro email é recusado ANTES de se testar palavra-passe.

   Contra a porta fechada a sério (`seguranca: true`) e sem rede: o Resend, o
   GitHub e o Google são falsos, e o que se lê é o que eles devolveram.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { limitadorCodigo, limitador } from './api/_porta.mjs';
import { processarOAuth, COOKIE_ESTADO } from './api/_oauth.mjs';
import {
  DONO_PADRAO, donosDe, eODono, mascararEmail, codigoNovo, hashCodigo, codigoConfere,
  MINUTOS_CODIGO, TENTATIVAS_CODIGO, estadoDosFornecedores, urlDeAutorizacao,
  perfilDoFornecedor, opcoesDeEntrada, uriDeRetorno,
} from './api/_entrada.mjs';

const DONO = 'cheltonmahoze7@gmail.com';
const SENHA = 'uma-frase-bem-comprida-2026';
const ENV = { ORBITA_URL: 'https://orbita.exemplo.pt' };
const ENV_CORREIO = { ...ENV, RESEND_API_KEY: 're_teste_abcdefghij', ORBITA_EMAIL_FROM: 'Orbita <ola@orbita.pt>' };

const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: ENV, seguranca: true, ...extra,
});

/** Um Resend falso que guarda o que lhe mandaram. */
function correioFalso() {
  const enviados = [];
  const fetchImpl = async (url, opt = {}) => {
    if (String(url).includes('api.resend.com')) {
      enviados.push(JSON.parse(opt.body || '{}'));
      return { ok: true, status: 200, json: async () => ({ id: `re_${enviados.length}` }) };
    }
    throw new Error(`pedido inesperado: ${url}`);
  };
  const ultimoCodigo = () => {
    const t = enviados[enviados.length - 1]?.text || '';
    const m = t.match(/(\d{6})/);
    return m ? m[1] : null;
  };
  return { enviados, fetchImpl, ultimoCodigo };
}

/* ---------- 1 · quem entra ---------- */

test('1.69.0 · sem nada configurado, a instalação aceita uma conta: a do dono', () => {
  assert.deepEqual(donosDe({}), [DONO_PADRAO]);
  assert.equal(DONO_PADRAO, 'cheltonmahoze7@gmail.com', 'o dono é o dono, e está escrito');
  assert.equal(eODono('CheltonMahoze7@Gmail.com', {}), true, 'maiúsculas e espaços não são outra pessoa');
  assert.equal(eODono('  cheltonmahoze7@gmail.com  ', {}), true);
  assert.equal(eODono('outra.pessoa@gmail.com', {}), false);
  assert.equal(eODono('', {}), false);
  assert.equal(eODono('cheltonmahoze7@gmail.com.evil.pt', {}), false, 'um sufixo não é o mesmo email');
});

test('1.69.0 · a lista pode crescer, mas só por decisão de quem instala', () => {
  const env = { ORBITA_DONO_EMAIL: 'a@b.pt, c@d.pt;a@b.pt' };
  assert.deepEqual(donosDe(env), ['a@b.pt', 'c@d.pt'], 'sem repetidos, sem lixo');
  assert.equal(eODono('c@d.pt', env), true);
  assert.equal(eODono(DONO, env), false, 'mudar a lista muda quem entra — não soma');
});

test('1.69.0 · o ecrã mostra o email do dono mascarado, nunca inteiro', () => {
  assert.match(mascararEmail(DONO), /^che\*+@gmail\.com$/, 'as primeiras letras e o domínio chegam para reconhecer a conta');
  assert.ok(!mascararEmail(DONO).includes('mahoze'), 'o endereço não fica publicado na página');
  assert.equal(mascararEmail(''), '');
});

/* ---------- 2 · o código ---------- */

test('1.69.0 · o código tem 6 dígitos e na base só entra o hash', () => {
  const c = codigoNovo();
  assert.match(c, /^\d{6}$/);
  const h = hashCodigo(c, DONO);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, c, 'nunca o código em claro');
  assert.notEqual(hashCodigo(c, 'outro@exemplo.pt'), h, 'o mesmo código noutra conta não dá o mesmo hash');
  assert.equal(hashCodigo('123456', DONO), hashCodigo('123-456', DONO), 'quem cola o código com espaços entra');
});

test('1.69.0 · o código vale 10 minutos, uma vez, e morre às 5 tentativas', () => {
  const agora = Date.now();
  const base = { email: DONO, codigo_hash: hashCodigo('424242', DONO), codigo_expira: new Date(agora + 9 * 60000).toISOString(), codigo_tentativas: 0 };
  assert.equal(codigoConfere(base, '424242', { agora }).ok, true);
  assert.equal(codigoConfere(base, '000000', { agora }).estado, 'errado');
  assert.equal(codigoConfere(base, '424242', { agora: agora + 11 * 60000 }).estado, 'expirado');
  assert.equal(codigoConfere({ ...base, codigo_tentativas: TENTATIVAS_CODIGO }, '424242', { agora }).estado, 'bloqueado');
  assert.equal(codigoConfere({ email: DONO }, '424242', { agora }).estado, 'sem-codigo');
  assert.equal(MINUTOS_CODIGO, 10);
});

/* ---------- 3 · pedir o código, e a conta que nasce ---------- */

test('1.69.0 · um email que não é o do dono é recusado antes de qualquer palavra-passe', async () => {
  limitadorCodigo.limpar();
  const r = await chamar(createMemRepo(), '/auth/codigo', 'POST', { email: 'intruso@exemplo.pt' }, { env: ENV_CORREIO });
  assert.equal(r.status, 403);
  assert.equal(r.corpo.soDono, true);
  assert.match(r.corpo.error, /um dono só/);
  assert.match(r.corpo.error, /che\*+@gmail\.com/, 'diz qual é a conta, mascarada');
  assert.equal(r.corpo.variavel, 'ORBITA_DONO_EMAIL', 'e como se muda de dono');
});

test('1.69.0 · sem chave de correio o código não sai — e a resposta diz qual falta', async () => {
  limitadorCodigo.limpar();
  const r = await chamar(createMemRepo(), '/auth/codigo', 'POST', { email: DONO });
  assert.equal(r.status, 503);
  assert.deepEqual(r.corpo.falta, ['RESEND_API_KEY']);
  assert.match(r.corpo.como, /resend\.com/);
  assert.match(r.corpo.alternativa, /palavra-passe/, 'e qual é o caminho que existe hoje');
});

test('1.69.0 · o código vai para o email do dono e a conta nasce como dona', async () => {
  limitadorCodigo.limpar();
  const repo = createMemRepo();
  const correio = correioFalso();
  const r = await chamar(repo, '/auth/codigo', 'POST', { email: DONO }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.enviado, true);
  assert.equal(r.corpo.contaNova, true);
  assert.match(r.corpo.para, /^che\*+@gmail\.com$/, 'a resposta não devolve o endereço inteiro');
  assert.equal(correio.enviados.length, 1);
  assert.equal(correio.enviados[0].to[0], DONO, 'o email foi para o dono');
  const codigo = correio.ultimoCodigo();
  assert.match(codigo, /^\d{6}$/);

  const conta = await repo.contas.porEmail(DONO);
  assert.equal(conta.papel, 'dono');
  assert.equal(conta.activo, true);
  assert.equal(conta.confirmado_em, null, 'ainda não provou a caixa: sem código, não está confirmado');
  assert.equal(conta.codigo_hash, hashCodigo(codigo, DONO), 'na base fica o hash do código que saiu');
  assert.ok(!JSON.stringify(conta).includes(codigo), 'o código em claro não fica guardado em lado nenhum');
});

test('1.69.0 · verificar o código abre a sessão, confirma a conta e não serve duas vezes', async () => {
  limitadorCodigo.limpar();
  const repo = createMemRepo();
  const correio = correioFalso();
  await chamar(repo, '/auth/codigo', 'POST', { email: DONO }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  const codigo = correio.ultimoCodigo();

  const errado = await chamar(repo, '/auth/codigo/verificar', 'POST', { email: DONO, codigo: '000000' }, { env: ENV_CORREIO });
  assert.equal(errado.status, 401);
  assert.equal(errado.corpo.estado, 'errado');
  assert.equal(errado.corpo.restam, TENTATIVAS_CODIGO - 1, 'a tentativa fica contada, e o número é dito');

  const certo = await chamar(repo, '/auth/codigo/verificar', 'POST', { email: DONO, codigo }, { env: ENV_CORREIO });
  assert.equal(certo.status, 200);
  assert.equal(certo.corpo.entrouPorCodigo, true);
  assert.equal(certo.corpo.user.email, DONO);
  assert.equal(certo.corpo.perms.admin, true, 'o dono entra com tudo');
  assert.match(certo.cabecalhos['Set-Cookie'], /HttpOnly/);

  const conta = await repo.contas.porEmail(DONO);
  assert.ok(conta.confirmado_em, 'a conta ficou confirmada por ter provado a caixa');
  assert.equal(conta.codigo_hash, null, 'o código morreu ao ser usado');

  const outraVez = await chamar(repo, '/auth/codigo/verificar', 'POST', { email: DONO, codigo }, { env: ENV_CORREIO });
  assert.equal(outraVez.status, 401);
  assert.match(outraVez.corpo.error, /pede um/, 'um código que já serviu não serve outra vez');
});

test('1.69.0 · cinco códigos errados e o código deixa de servir', async () => {
  limitadorCodigo.limpar();
  const repo = createMemRepo();
  const correio = correioFalso();
  await chamar(repo, '/auth/codigo', 'POST', { email: DONO }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  const codigo = correio.ultimoCodigo();
  for (let i = 0; i < TENTATIVAS_CODIGO; i += 1) {
    const r = await chamar(repo, '/auth/codigo/verificar', 'POST', { email: DONO, codigo: '999999' }, { env: ENV_CORREIO });
    assert.equal(r.status, 401);
  }
  const certo = await chamar(repo, '/auth/codigo/verificar', 'POST', { email: DONO, codigo }, { env: ENV_CORREIO });
  assert.equal(certo.status, 401);
  assert.equal(certo.corpo.estado, 'bloqueado');
  assert.match(certo.corpo.error, /pede outro/);
});

test('1.69.0 · um código com menos de 6 dígitos não chega a ser testado', async () => {
  const r = await chamar(createMemRepo(), '/auth/codigo/verificar', 'POST', { email: DONO, codigo: '12' });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /6 dígitos/);
});

/* ---------- 4 · palavra-passe + código ---------- */

test('1.69.0 · com correio, a palavra-passe certa NÃO abre a sessão: manda o código', async () => {
  limitadorCodigo.limpar();
  const repo = createMemRepo();
  const correio = correioFalso();
  /* a conta nasce pelo código, e depois ganha palavra-passe pelo caminho normal */
  await chamar(repo, '/auth/codigo', 'POST', { email: DONO }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  const codigo = correio.ultimoCodigo();
  await chamar(repo, '/auth/codigo/verificar', 'POST', { email: DONO, codigo }, { env: ENV_CORREIO });
  const conta = await repo.contas.porEmail(DONO);
  const { hashPassword } = await import('./api/_conta.mjs');
  await repo.contas.actualizar(conta.id, { hash: hashPassword(SENHA) });

  const entrar = await chamar(repo, '/auth/entrar', 'POST', { email: DONO, password: SENHA }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  assert.equal(entrar.status, 200);
  assert.equal(entrar.corpo.precisaCodigo, true);
  assert.equal(entrar.corpo.naoEntrou, true, 'não se diz «entraste» a quem ainda não entrou');
  assert.equal(entrar.cabecalhos, undefined, 'e nenhum cookie de sessão é posto');
  assert.match(entrar.corpo.mensagem, /código/);
  const novo = correio.ultimoCodigo();
  assert.notEqual(novo, codigo, 'é outro código, não o que já foi usado');

  const fim = await chamar(repo, '/auth/codigo/verificar', 'POST', { email: DONO, codigo: novo }, { env: ENV_CORREIO });
  assert.equal(fim.status, 200);
  assert.ok(fim.cabecalhos['Set-Cookie']);
});

test('1.69.0 · sem correio, a palavra-passe entra — e a resposta diz que entrou assim', async () => {
  limitadorCodigo.limpar();
  const repo = createMemRepo();
  limitador.limpar();
  const primeira = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: DONO, password: SENHA, token: '' });
  assert.equal(primeira.status, 200, 'o dono pode criar a primeira conta com o email dele');
  const r = await chamar(repo, '/auth/entrar', 'POST', { email: DONO, password: SENHA });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.semCodigo, true);
  assert.match(r.corpo.nota, /RESEND_API_KEY/, 'a nota nomeia o que falta, não uma desculpa');
  assert.match(r.cabecalhos['Set-Cookie'], /HttpOnly/);
});

/* ---------- 5 · quem pode criar a conta ---------- */

test('1.69.0 · a primeira conta só nasce com o email do dono', async () => {
  const repo = createMemRepo();
  const outro = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'quem.chegou.primeiro@exemplo.pt', password: SENHA });
  assert.equal(outro.status, 403);
  assert.equal(outro.corpo.soDono, true);
  assert.equal((await repo.contas.contar()), 0, 'nada foi criado');

  const dele = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: DONO, password: SENHA });
  assert.equal(dele.status, 200);
  assert.equal(dele.corpo.user.role, 'dono');
});

/* 1.75.0 · O TOKEN NÃO É A FECHADURA; O EMAIL É.

   Em produção o `SETUP_TOKEN` está definido, e a página pedia-o para criar a
   primeira conta: o dono via um campo «Token de instalação» e não entrava em
   casa sem ir à Vercel copiar um segredo. Numa instalação de um dono só, a
   primeira conta já só pode ser a do `ORBITA_DONO_EMAIL` — o token não protegia
   mais nada. */
test('1.75.0 · com SETUP_TOKEN definido, o dono cria a primeira conta SEM token', async () => {
  const env = { ...ENV, SETUP_TOKEN: 'um-token-que-esta-na-vercel', ORBITA_DONO_EMAIL: DONO };
  const repo = createMemRepo();
  limitador.limpar();

  const eu = await chamar(repo, '/auth/eu', 'GET', null, { env });
  assert.equal(eu.status, 401);
  assert.equal(eu.corpo.primeiraContaPossivel, true);
  assert.equal(eu.corpo.estado.exigeToken, false, 'a página não pede token a quem é o dono');

  const r = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: DONO, password: SENHA }, { env });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.user.role, 'dono');
  assert.match(r.cabecalhos['Set-Cookie'], /HttpOnly/, 'e sai de lá com sessão');
  assert.equal(await repo.contas.contar(), 1);

  const entra = await chamar(repo, '/auth/entrar', 'POST', { email: DONO, password: SENHA }, { env });
  assert.equal(entra.status, 200, 'e volta a entrar com a mesma palavra-passe');
});

test('1.75.0 · sem token, quem não é o dono continua de fora (o email é a fechadura)', async () => {
  const env = { ...ENV, SETUP_TOKEN: 'um-token-que-esta-na-vercel', ORBITA_DONO_EMAIL: DONO };
  const repo = createMemRepo();
  const r = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'estranho@exemplo.pt', password: SENHA }, { env });
  assert.equal(r.status, 403);
  assert.equal(await repo.contas.contar(), 0);
});

test('1.75.0 · com o registo ABERTO, o token continua a ser exigido (aí não há identidade a valer)', async () => {
  const env = { ...ENV, SETUP_TOKEN: 'um-token-que-esta-na-vercel', ORBITA_REGISTO: 'aberto' };
  const repo = createMemRepo();
  const eu = await chamar(repo, '/auth/eu', 'GET', null, { env });
  assert.equal(eu.corpo.estado.exigeToken, true);
  const sem = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'quem.quer.seja@exemplo.pt', password: SENHA }, { env });
  assert.equal(sem.status, 403);
  assert.equal(sem.corpo.precisaToken, true);
  const com = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'quem.quer.seja@exemplo.pt', password: SENHA, token: env.SETUP_TOKEN }, { env });
  assert.equal(com.status, 200);
});

test('1.69.0 · o registo público está fechado a quem não é o dono', async () => {
  const repo = createMemRepo();
  const r = await chamar(repo, '/auth/registo', 'POST', { email: 'alguem@exemplo.pt', password: SENHA });
  assert.equal(r.status, 403);
  assert.match(r.corpo.error, /um dono só/);
  assert.equal((await repo.contas.contar()), 0);

  const aberto = await chamar(repo, '/auth/registo', 'POST', { email: 'alguem@exemplo.pt', password: SENHA }, { env: { ...ENV, ORBITA_REGISTO: 'aberto' } });
  assert.equal(aberto.status, 201, 'com ORBITA_REGISTO=aberto o registo volta — é uma decisão, não um acidente');
});

/* ---------- 6 · GitHub e Google ---------- */

test('1.69.0 · cada fornecedor diz o que lhe falta, sem um único segredo', () => {
  const semNada = estadoDosFornecedores({});
  assert.deepEqual(semNada.map((f) => f.id), ['github', 'google']);
  assert.ok(semNada.every((f) => f.pronto === false));
  assert.deepEqual(semNada[0].falta, ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']);
  assert.match(semNada[0].retorno, /\/api\/oauth\?fornecedor=github$/);
  const opcoes = opcoesDeEntrada({ GITHUB_CLIENT_ID: 'abc123', GITHUB_CLIENT_SECRET: 'segredo-que-nao-sai' });
  assert.equal(opcoes.fornecedores[0].pronto, true);
  assert.ok(!JSON.stringify(opcoes).includes('segredo-que-nao-sai'), 'nenhum valor de chave sai na resposta');
  const meia = opcoesDeEntrada({ GITHUB_CLIENT_ID: 'abc123' });
  assert.equal(meia.fornecedores[0].pronto, false, 'meia chave não é um fornecedor pronto');
  assert.deepEqual(meia.fornecedores[0].falta, ['GITHUB_CLIENT_SECRET']);
  const completas = estadoDosFornecedores({ GITHUB_CLIENT_ID: 'abc123', GITHUB_CLIENT_SECRET: 's' });
  assert.equal(completas[0].pronto, true);
  assert.equal(completas[1].pronto, false, 'um pronto não torna o outro pronto');
});

test('1.69.0 · o endereço de autorização pede o mínimo e leva o state', () => {
  const env = { GITHUB_CLIENT_ID: 'id-do-github', ORBITA_URL: 'https://orbita.exemplo.pt' };
  const u = new URL(urlDeAutorizacao('github', { env, state: 'xyz' }));
  assert.equal(u.origin, 'https://github.com');
  assert.equal(u.searchParams.get('client_id'), 'id-do-github');
  assert.equal(u.searchParams.get('state'), 'xyz');
  assert.equal(u.searchParams.get('scope'), 'read:user user:email', 'ler o email — e nada dos repositórios');
  assert.equal(u.searchParams.get('redirect_uri'), uriDeRetorno('github', env));

  const g = new URL(urlDeAutorizacao('google', { env: { GOOGLE_CLIENT_ID: 'gid', ORBITA_URL: 'https://orbita.exemplo.pt' }, state: 'xyz' }));
  assert.equal(g.searchParams.get('redirect_uri'), 'https://orbita.exemplo.pt/',
    '1.72.0 · o Google volta à raiz — é o endereço que está registado na Cloud Console');
  assert.equal(g.origin, 'https://accounts.google.com');
  assert.equal(g.searchParams.get('scope'), 'openid email profile');
  assert.equal(urlDeAutorizacao('myspace', { env, state: 'x' }), null);
});

test('1.69.0 · o GitHub só vale com email verificado; o Google também', async () => {
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'segredo', ORBITA_URL: 'https://orbita.exemplo.pt' };

  const semVerificado = async (url) => {
    if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email: DONO, primary: true, verified: false }]) };
    return { ok: true, status: 200, json: async () => ({ id: 1, login: 'x' }) };
  };
  const recusado = await perfilDoFornecedor('github', { code: 'c', env, fetchImpl: semVerificado });
  assert.equal(recusado.ok, false);
  assert.match(recusado.motivo, /verificado/);

  const bom = async (url) => {
    if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    /* um email secundário verificado serve (é o que o GitHub devolve a quem tem
       o email do trabalho como primário) — o que não serve é um por verificar */
    if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email: 'outro@x.pt', primary: true, verified: false }, { email: DONO, primary: false, verified: true }]) };
    return { ok: true, status: 200, json: async () => ({ id: 7, name: 'Chelton' }) };
  };
  const aceite = await perfilDoFornecedor('github', { code: 'c', env, fetchImpl: bom });
  assert.equal(aceite.ok, true);
  assert.equal(aceite.email, DONO);
  assert.equal(aceite.nome, 'Chelton');

  const googleNaoVerificado = async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    return { ok: true, status: 200, json: async () => ({ email: DONO, email_verified: false }) };
  };
  const g = await perfilDoFornecedor('google', { code: 'c', env: { ...env, GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' }, fetchImpl: googleNaoVerificado });
  assert.equal(g.ok, false);
  assert.match(g.motivo, /não está verificado/);

  const tokenRecusado = async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad_verification_code' }) });
  const t = await perfilDoFornecedor('github', { code: 'c', env, fetchImpl: tokenRecusado });
  assert.equal(t.ok, false);
  assert.match(t.motivo, /bad_verification_code/, 'o motivo do fornecedor atravessa, em vez de virar «erro»');
});

/* ---------- 7 · o /api/oauth de ponta a ponta (sem rede) ---------- */

const COOKIE = (state) => ({ [COOKIE_ESTADO]: state });
/* o `Location` viaja com `+` no lugar dos espaços: lê-se como uma pessoa lê */
const descodificar = (u) => decodeURIComponent(String(u || '').replace(/\+/g, ' '));

test('1.69.0 · sem chaves, o /api/oauth diz o que falta em vez de falhar em silêncio', async () => {
  const r = await processarOAuth({ repo: createMemRepo(), env: {}, query: 'fornecedor=github&iniciar=1' });
  assert.equal(r.status, 503);
  assert.equal(r.tipo, 'html');
  assert.match(r.corpo, /GITHUB_CLIENT_ID/, 'a página diz o nome da variável');
  assert.match(r.corpo, /OAuth Apps/, 'e o sítio onde se cria');
  assert.match(r.corpo, /\/api\/oauth\?fornecedor=github/, 'e o endereço de retorno, à mão de copiar');
});

test('1.69.0 · «iniciar» sai para o fornecedor com um state num cookie HttpOnly', async () => {
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt' };
  const r = await processarOAuth({ repo: createMemRepo(), env, query: 'fornecedor=github&iniciar=1' });
  assert.equal(r.status, 302);
  assert.match(r.location, /^https:\/\/github\.com\/login\/oauth\/authorize/);
  const cookie = r.cabecalhos['Set-Cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const state = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
  assert.ok(state.length >= 32, 'um state a sério, não uma palavra');
  assert.ok(r.location.includes(`state=${state}`), 'e o mesmo state vai no endereço');
});

test('1.69.0 · a volta sem o cookie deste browser não abre sessão nenhuma', async () => {
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt' };
  const r = await processarOAuth({ repo: createMemRepo(), env, query: 'fornecedor=github&code=abc&state=xyz', cookies: {} });
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/app\?erroEntrada=/);
  /* 1.73.0 · a frase que a página mostra é curta: o ecrã de entrada não leva
     «state inválido» nem vocabulário de OAuth (o dono leu-a e disse basta) */
  const saida = descodificar(r.location);
  assert.match(saida, /a volta expirou/);
  assert.doesNotMatch(saida, /state/i);
});

test('1.69.0 · a volta com o state certo abre a sessão do dono e volta à app', async () => {
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt' };
  const repo = createMemRepo();
  const github = async (url) => {
    if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email: DONO, primary: true, verified: true }]) };
    return { ok: true, status: 200, json: async () => ({ id: 7, name: 'Chelton' }) };
  };
  const r = await processarOAuth({ repo, env, fetchImpl: github, query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz') });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/app?entrou=github');
  const cookies = r.cabecalhos['Set-Cookie'];
  assert.ok(cookies.some((c) => /orbita_sessao|sessao/.test(c)), 'a sessão nasce aqui');
  assert.ok(cookies.some((c) => /Max-Age=0/.test(c)), 'e o state morre no mesmo gesto');
  const conta = await repo.contas.porEmail(DONO);
  assert.equal(conta.papel, 'dono');
  assert.equal(conta.oauth_fornecedor, 'github');
  assert.ok(conta.confirmado_em, 'o email já foi verificado pelo GitHub');
});

test('1.69.0 · o GitHub de outra pessoa não entra, mesmo com chaves boas', async () => {
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt' };
  const repo = createMemRepo();
  const github = async (url) => {
    if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email: 'amigo@exemplo.pt', primary: true, verified: true }]) };
    return { ok: true, status: 200, json: async () => ({ id: 9 }) };
  };
  const r = await processarOAuth({ repo, env, fetchImpl: github, query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz') });
  assert.equal(r.status, 302);
  assert.match(descodificar(r.location), /não é a do dono/);
  assert.equal(r.cabecalhos['Set-Cookie'], undefined, 'nem um cookie de sessão');
  assert.equal(await repo.contas.contar(), 0, 'e nenhuma conta criada');
});

/* 1.74.0 · O DONO TEM MAIS DO QUE UM EMAIL.

   O GitHub devolve o email *primário* da conta. Se esse email não for o que está
   em `ORBITA_DONO_EMAIL`, a entrada recusava a própria conta do dono — e a frase
   não tinha solução do lado de quem estava a entrar. A conta passa a ser
   reconhecida pelo `id` do GitHub (e pelo login), que não muda. */
test('1.74.0 · a conta GitHub do dono entra mesmo quando o email primário é outro', async () => {
  const env = {
    GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt',
    ORBITA_DONO_GITHUB_ID: '239872116',
  };
  const repo = createMemRepo();
  const github = async (url) => {
    if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email: 'outro-endereco@exemplo.pt', primary: true, verified: true }]) };
    return { ok: true, status: 200, json: async () => ({ id: 239872116, login: 'valdimiroilidio3', name: 'Chelton Mahoze' }) };
  };
  const r = await processarOAuth({ repo, env, fetchImpl: github, query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz') });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/app?entrou=github', 'a conta do dono entra — o número é dela');
  assert.ok(r.cabecalhos['Set-Cookie'].some((c) => /orbita_sessao|sessao/.test(c)), 'com sessão');
  const conta = await repo.contas.porEmail('outro-endereco@exemplo.pt');
  assert.equal(conta.papel, 'dono');
});

test('1.74.0 · o login do dono também serve de âncora, e um id estranho continua de fora', async () => {
  const repo = createMemRepo();
  const perfil = (id, login, email) => async (url) => {
    if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email, primary: true, verified: true }]) };
    return { ok: true, status: 200, json: async () => ({ id, login }) };
  };
  const base = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt' };

  const peloLogin = await processarOAuth({
    repo, env: { ...base, ORBITA_DONO_GITHUB: 'valdimiroilidio3' }, fetchImpl: perfil(999, 'ValdimiroIlidio3', 'x@exemplo.pt'),
    query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz'),
  });
  assert.equal(peloLogin.location, '/app?entrou=github', 'o login compara-se sem distinguir maiúsculas');

  const estranho = await processarOAuth({
    repo, env: { ...base, ORBITA_DONO_GITHUB_ID: '239872116' }, fetchImpl: perfil(1234, 'intruso', 'y@exemplo.pt'),
    query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz'),
  });
  assert.match(descodificar(estranho.location), /não é a do dono/);
  const frase = descodificar(estranho.location);
  assert.match(frase, /intruso/, 'diz QUAL conta tentou entrar (o login)');
  assert.match(frase, /Entra com che/, 'e com que conta se entra');
});

test('1.74.0 · sem âncora GitHub configurada, a regra velha continua: só o email do dono', async () => {
  const env = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt' };
  const r = await processarOAuth({
    repo: createMemRepo(), env,
    fetchImpl: async (url) => {
      if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
      if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email: 'amigo@exemplo.pt', primary: true, verified: true }]) };
      return { ok: true, status: 200, json: async () => ({ id: 239872116, login: 'valdimiroilidio3' }) };
    },
    query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz'),
  });
  assert.match(descodificar(r.location), /não é a do dono/, 'um id não configurado não abre nada');
});

/* ---------- 8 · as costuras (o que liga isto à Vercel e à mesa) ---------- */

test('1.69.0 · a Vercel serve /api/oauth e o ficheiro sabe redireccionar', () => {
  const f = readFileSync(new URL('./api/_oauth.mjs', import.meta.url), 'utf8');
  assert.match(f, /res\.setHeader\('Location'/);
  assert.match(f, /301|302/);
  assert.match(f, /HttpOnly/);
  const mesa = readFileSync(new URL('./src/mesa.js', import.meta.url), 'utf8');
  assert.match(mesa, /data-act="oauth"/, 'a mesa tem os botões dos fornecedores');
  assert.match(mesa, /data-act="pedir-codigo"/, 'e o caminho do código');
  assert.match(mesa, /data-act="verificar-codigo"/);
  assert.doesNotMatch(mesa, /data-act="oauth"[^>]*disabled/, 'o botão nunca aparece morto: o clique é que explica');
  assert.match(mesa, /location\.href = `\/api\/oauth\?fornecedor=/, 'e manda o browser ao sítio certo');
  /* 1.69.0 · o plano Hobby recusa mais de 12 funções por deploy: o `/api/oauth`
     é uma reescrita para o `/api/rpc`, não um ficheiro novo em `api/`. */
  const conf = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(conf.rewrites.find((r) => r.source === '/api/oauth'), { source: '/api/oauth', destination: '/api/rpc' });
});

test('1.69.0 · a migração existe, é idempotente e não guarda segredos', () => {
  const sql = readFileSync(new URL('./supabase/orbita_1_69_0.sql', import.meta.url), 'utf8');
  for (const c of ['codigo_hash', 'codigo_expira', 'codigo_tentativas', 'oauth_fornecedor', 'oauth_id']) {
    assert.match(sql, new RegExp(`add column if not exists ${c}`));
  }
  assert.match(sql, /sha256 do código/, 'e explica que o que fica é o hash');
  assert.doesNotMatch(sql, /drop table|delete from/i, 'uma migração não apaga dados de ninguém');
});


/* ===========================================================================
   1.72.0 · o Google volta à raiz (o endereço que já está registado)
   =========================================================================== */

test('1.72.0 · o Google volta à raiz; o GitHub continua no endereço canónico', () => {
  const env = { ORBITA_URL: 'https://orbita.exemplo.pt' };
  assert.equal(uriDeRetorno('google', env), 'https://orbita.exemplo.pt/');
  assert.equal(uriDeRetorno('github', env), 'https://orbita.exemplo.pt/api/oauth?fornecedor=github');
  assert.equal(uriDeRetorno('google', {}), 'https://orbita-agentes.vercel.app/', 'sem ORBITA_URL, o endereço de produção');
});

test('1.72.0 · ORBITA_OAUTH_RETORNO_GOOGLE manda sobre a raiz (para o dia em que se registe o endereço certo)', () => {
  const env = {
    ORBITA_URL: 'https://orbita.exemplo.pt',
    ORBITA_OAUTH_RETORNO_GOOGLE: 'https://orbita.exemplo.pt/api/oauth?fornecedor=google',
  };
  assert.equal(uriDeRetorno('google', env), 'https://orbita.exemplo.pt/api/oauth?fornecedor=google');
  const u = new URL(urlDeAutorizacao('google', { env, state: 'x' }));
  assert.equal(u.searchParams.get('redirect_uri'), 'https://orbita.exemplo.pt/api/oauth?fornecedor=google');
});

test('1.72.0 · a troca do código usa o MESMO endereço com que se pediu (senão o Google recusa)', async () => {
  const env = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'seg', ORBITA_URL: 'https://orbita.exemplo.pt' };
  let enviado = null;
  const fetchImpl = async (url, opt = {}) => {
    if (String(url).includes('oauth2.googleapis.com/token')) enviado = new URLSearchParams(String(opt.body || ''));
    return {
      ok: true,
      json: async () => (String(url).includes('userinfo') ? { email: 'che@gmail.com', email_verified: true, sub: '1' } : { access_token: 't' }),
      text: async () => '',
    };
  };
  await perfilDoFornecedor('google', { code: 'c', env, fetchImpl });
  assert.equal(enviado.get('redirect_uri'), uriDeRetorno('google', env),
    'pedir e trocar têm de levar o mesmo redirect_uri');
  assert.equal(enviado.get('redirect_uri'), 'https://orbita.exemplo.pt/');
});

/* ===========================================================================
   1.77.0 · A CONTA QUE NASCE DE UM FORNECEDOR NÃO TEM PALAVRA-PASSE

   O dono entrou pelo GitHub e leu, no ecrã:

     a base de dados recusou a conta do dono: null value in column "hash" of
     relation "orbita_contas" violates not-null constraint

   A tabela da 1.54.0 exigia `hash` porque só havia uma porta (email + palavra-
   passe). O GitHub não traz palavra-passe nenhuma — e inventar uma seria pior:
   uma conta com um hash falso é uma porta que ninguém conhece.

   O que se prova aqui:
     · a primeira escrita que falha por `hash` não termina a entrada: tenta-se
       outra vez depois da migração, e o dono entra;
     · se a segunda também falhar, a frase nomeia o ficheiro certo;
     · quem tem conta só de fornecedor e tenta email+palavra-passe não lê «não
       conferem» — lê por onde entra.
   =========================================================================== */

/** Um repositório em memória cuja tabela ainda exige `hash` — uma vez. */
function repoTabelaAntiga({ falharSempre = false, erro = 'null value in column "hash" of relation "orbita_contas" violates not-null constraint' } = {}) {
  const repo = createMemRepo();
  const criar = repo.contas.criar.bind(repo.contas);
  let vezes = 0;
  repo.contas.criar = async (dados) => {
    vezes += 1;
    if (vezes === 1 || falharSempre) {
      throw Object.assign(new Error(erro), { code: '23502', status: 400 });
    }
    return criar(dados);
  };
  repo.contas.vezesQueFalhou = () => vezes;
  return repo;
}

const GITHUB_DONO = async (url) => {
  if (String(url).includes('login/oauth/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
  if (String(url).endsWith('/user/emails')) return { ok: true, status: 200, json: async () => ([{ email: DONO, primary: true, verified: true }]) };
  return { ok: true, status: 200, json: async () => ({ id: 239872116, login: 'valdimiroilidio3', name: 'Chelton' }) };
};
const ENV_GH = { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', ORBITA_URL: 'https://orbita.exemplo.pt', ORBITA_DONO_GITHUB_ID: '239872116' };

test('1.77.0 · a escrita que a base recusou por `hash` é repetida — e o dono entra', async () => {
  const repo = repoTabelaAntiga();
  const r = await processarOAuth({ repo, env: ENV_GH, fetchImpl: GITHUB_DONO, query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz') });
  assert.equal(r.status, 302, 'a entrada não morre no primeiro erro da base');
  assert.equal(r.location, '/app?entrou=github');
  assert.ok(r.cabecalhos['Set-Cookie'].some((c) => /orbita_sessao|sessao/.test(c)), 'com sessão');
  const conta = await repo.contas.porEmail(DONO);
  assert.equal(conta.hash, null, 'a conta guardada NÃO leva uma palavra-passe inventada');
  assert.equal(conta.oauth_fornecedor, 'github');
});

test('1.77.0 · se a base continuar a recusar, a frase nomeia o ficheiro certo — não o erro cru', async () => {
  const repo = repoTabelaAntiga({ falharSempre: true });
  const r = await processarOAuth({ repo, env: ENV_GH, fetchImpl: GITHUB_DONO, query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz') });
  assert.equal(r.status, 302);
  assert.match(r.location, /^\/app\?erroEntrada=/);
  const texto = descodificar(r.location);
  assert.doesNotMatch(texto, /violates not-null/, 'o dono não volta a ler o erro do Postgres');
  assert.match(texto, /orbita_1_77_0\.sql/, 'e sabe qual é o ficheiro');
});

test('1.77.0 · quem entra por um fornecedor não lê «email ou palavra-passe não conferem»', async () => {
  const repo = createMemRepo();
  await processarOAuth({ repo, env: ENV_GH, fetchImpl: GITHUB_DONO, query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz') });
  const r = await chamar(repo, '/auth/entrar', 'POST', { email: DONO, password: 'qualquer-coisa-longa' });
  assert.equal(r.status, 409, 'não é credenciais erradas: é uma conta sem palavra-passe');
  assert.match(r.corpo.error, /entra pelo GitHub/);
  assert.equal(r.corpo.entraPorFornecedor, 'github');
  assert.ok(r.corpo.hint, 'e diz o que fazer a seguir');
});

test('1.77.0 · «hash» nulo continua a não abrir sessão por palavra-passe (nenhuma palavra-passe serve)', async () => {
  const repo = createMemRepo();
  await processarOAuth({ repo, env: ENV_GH, fetchImpl: GITHUB_DONO, query: 'fornecedor=github&code=abc&state=xyz', cookies: COOKIE('xyz') });
  for (const tentativa of ['', '1234', DONO]) {
    const r = await chamar(repo, '/auth/entrar', 'POST', { email: DONO, password: tentativa });
    assert.notEqual(r.status, 200, `«${tentativa}» não pode abrir a conta`);
    assert.equal(r.corpo?.token, undefined);
  }
});
