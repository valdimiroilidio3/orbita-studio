/* ===========================================================================
   1.54.0 · A PORTA — os testes que provam que ela fecha.

   O que aqui se prova, e que era falso até hoje:
     · sem cookie/sessão, /ops/* NÃO devolve dados (401);
     · uma conta nasce, entra, e o servidor diz quem é;
     · a palavra-passe não sai em claro nem em hash; o token só existe em hash;
     · um leitor não escreve; um operador não aprova; só o dono administra;
     · cinco tentativas falhadas fecham a porta 15 minutos (429);
     · sair revoga a sessão no servidor, não só no browser.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { limitador } from './api/_porta.mjs';
import {
  ROLES, can, permisosDe, checkPassword, hashPassword, verifyPassword, publico,
  novoToken, hashToken, sessaoValida, criarLimitador, estadoDaPorta, lerCookies, tokenDoPedido,
  cookieDeSessao, COOKIE,
} from './api/_conta.mjs';

const ENV = { SETUP_TOKEN: 'token-de-instalacao-para-teste' };
const SENHA = 'uma-frase-bem-comprida-2026';

/* a porta activa-se à mão nos testes: em memória ela fica dormente por desenho */
const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: ENV, seguranca: true, ...extra,
});

const comCookie = (token) => ({ headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } });

/** Cria o dono pela rota e devolve o token da sessão (do Set-Cookie). */
async function comDono(repo = createMemRepo()) {
  limitador.limpar();   // o limitador vive no processo: cada teste começa limpo
  const r = await chamar(repo, '/auth/primeiro-dono', 'POST', {
    email: 'dono@orbita.pt', password: SENHA, name: 'Valdimiro', token: ENV.SETUP_TOKEN,
  });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const cookie = r.cabecalhos['Set-Cookie'];
  assert.match(cookie, new RegExp(`${COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const token = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
  return { repo, token, resposta: r };
}

/* ---------- 1 · a fechadura ---------- */

test('sem sessão, /ops/* devolve 401 — e diz que há uma porta', async () => {
  const { repo } = await comDono();
  for (const caminho of ['/ops/summary', '/ops/leads', '/ops/tarefas', '/ops/saldo', '/ia/estado']) {
    const r = await chamar(repo, caminho);
    assert.equal(r.status, 401, `${caminho} respondeu ${r.status} sem sessão`);
    assert.equal(r.corpo.error, 'entra');
    assert.equal(r.corpo.mode, 'sessao');
    assert.equal(r.corpo.primeiraContaPossivel, false);
  }
  /* o worker de media usa o seu próprio token, a saúde é pública e os webhooks
     trazem o segredo deles: nada disto passa pela porta da sessão */
  assert.notEqual((await chamar(repo, '/health')).status, 401);
  assert.notEqual((await chamar(repo, '/media/estado')).status, 401);
  assert.notEqual((await chamar(repo, '/webhooks/whatsapp', 'POST', {})).status, 401,
    'a Meta não tem conta na Órbita: o webhook verifica o próprio segredo');
});

test('com cookie válido, a mesma rota responde', async () => {
  const { repo, token } = await comDono();
  const r = await chamar(repo, '/ops/summary', 'GET', null, comCookie(token));
  assert.equal(r.status, 200);
  assert.ok(r.corpo.leads);
});

test('instalação sem contas: 401 mas diz que se pode criar a primeira, com token', async () => {
  const repo = createMemRepo();
  const eu = await chamar(repo, '/auth/eu');
  assert.equal(eu.status, 401);
  assert.equal(eu.corpo.primeiraContaPossivel, true);
  assert.equal(eu.corpo.estado.exigeToken, true, 'com SETUP_TOKEN no ambiente, a primeira conta exige-o');

  const semToken = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'a@b.pt', password: SENHA });
  assert.equal(semToken.status, 403);
  assert.equal(semToken.corpo.precisaToken, true);

  const fraca = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'a@b.pt', password: 'curta', token: ENV.SETUP_TOKEN });
  assert.equal(fraca.status, 400);
  assert.match(fraca.corpo.error, /12 caracteres/);

  const feita = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'a@b.pt', password: SENHA, token: ENV.SETUP_TOKEN });
  assert.equal(feita.status, 200);
  assert.equal(feita.corpo.user.role, 'dono', 'a primeira conta é a dona');

  const segunda = await chamar(repo, '/auth/primeiro-dono', 'POST', { email: 'x@y.pt', password: SENHA, token: ENV.SETUP_TOKEN });
  assert.equal(segunda.status, 409, 'só se cria a primeira conta uma vez');
});

test('entrar: certo devolve sessão; errado devolve a MESMA frase (não enumera emails)', async () => {
  const { repo } = await comDono();
  limitador.limpar();
  const certa = await chamar(repo, '/auth/entrar', 'POST', { email: 'dono@orbita.pt', password: SENHA });
  assert.equal(certa.status, 200);
  assert.equal(certa.corpo.user.email, 'dono@orbita.pt');
  assert.equal(certa.corpo.perms.admin, true);
  assert.match(certa.cabecalhos['Set-Cookie'], /HttpOnly/);

  const errada = await chamar(repo, '/auth/entrar', 'POST', { email: 'dono@orbita.pt', password: 'outra-coisa-qualquer-1' });
  const inexistente = await chamar(repo, '/auth/entrar', 'POST', { email: 'ninguem@orbita.pt', password: 'outra-coisa-qualquer-1' });
  assert.equal(errada.status, 401);
  assert.equal(inexistente.status, 401);
  assert.equal(errada.corpo.error, inexistente.corpo.error, 'a frase não pode revelar se o email existe');
});

test('cinco tentativas falhadas fecham a porta 15 minutos (429)', async () => {
  const { repo } = await comDono();
  limitador.limpar();
  for (let i = 0; i < 5; i += 1) {
    const r = await chamar(repo, '/auth/entrar', 'POST', { email: 'dono@orbita.pt', password: `errada-${i}-bem-grande` });
    assert.equal(r.status, 401);
  }
  const sexta = await chamar(repo, '/auth/entrar', 'POST', { email: 'dono@orbita.pt', password: SENHA });
  assert.equal(sexta.status, 429, 'mesmo a palavra-passe certa espera');
  assert.match(sexta.corpo.error, /demasiadas tentativas/);
});

test('sair revoga no SERVIDOR: o mesmo cookie deixa de valer', async () => {
  const { repo, token } = await comDono();
  assert.equal((await chamar(repo, '/ops/summary', 'GET', null, comCookie(token))).status, 200);
  const saiu = await chamar(repo, '/auth/sair', 'POST', {}, comCookie(token));
  assert.equal(saiu.status, 200);
  assert.match(saiu.cabecalhos['Set-Cookie'], /Max-Age=0/);
  assert.equal((await chamar(repo, '/ops/summary', 'GET', null, comCookie(token))).status, 401);
});

test('sessão expirada não vale, mesmo com o token certo', async () => {
  const { repo, token } = await comDono();
  const s = repo._dados.sessoes[0];
  s.expira = new Date(Date.now() - 1000).toISOString();
  assert.equal((await chamar(repo, '/ops/summary', 'GET', null, comCookie(token))).status, 401);
});

/* ---------- 2 · papéis (a autorização é do servidor) ---------- */

test('leitor vê mas não escreve; operador escreve mas não aprova; só o dono administra', async () => {
  const { repo, token } = await comDono();
  limitador.limpar();
  const dono = comCookie(token);

  const cria = async (email, role) => {
    const r = await chamar(repo, '/ops/utilizadores', 'POST', { email, password: SENHA, role, name: email.split('@')[0] }, dono);
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const e = await chamar(repo, '/auth/entrar', 'POST', { email, password: SENHA });
    return decodeURIComponent(e.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);
  };
  const leitor = comCookie(await cria('leitor@orbita.pt', 'leitor'));
  const operador = comCookie(await cria('operador@orbita.pt', 'operador'));

  assert.equal((await chamar(repo, '/ops/leads', 'GET', null, leitor)).status, 200, 'ler é permitido ao leitor');
  const escreve = await chamar(repo, '/ops/leads', 'POST', { leads: [{ name: 'Padaria Nova', city: 'Coimbra' }] }, leitor);
  assert.equal(escreve.status, 403);
  assert.match(escreve.corpo.error, /leitor/);
  assert.equal(escreve.corpo.exige, 'write');

  const op = await chamar(repo, '/ops/leads', 'POST', { leads: [{ name: 'Padaria Nova', city: 'Coimbra' }] }, operador);
  assert.ok([200, 201].includes(op.status), `o operador cria leads (veio ${op.status})`);
  assert.equal(repo._dados.leads.length, 1, 'o lead entrou mesmo');

  const aprova = await chamar(repo, '/ops/messages/m1/aprovar', 'POST', {}, operador);
  assert.equal(aprova.status, 403, 'aprovar não é para operador');
  assert.equal(aprova.corpo.exige, 'approve');

  const admin = await chamar(repo, '/ops/utilizadores', 'GET', null, leitor);
  assert.equal(admin.status, 403);
  assert.equal(admin.corpo.exige, 'admin');
});

test('a lista de contas não mostra o hash nem o token de ninguém', async () => {
  const { repo, token } = await comDono();
  await chamar(repo, '/ops/utilizadores', 'POST', { email: 'outra@orbita.pt', password: SENHA, role: 'gestor' }, comCookie(token));
  const lista = await chamar(repo, '/ops/utilizadores', 'GET', null, comCookie(token));
  assert.equal(lista.status, 200);
  const texto = JSON.stringify(lista.corpo);
  assert.doesNotMatch(texto, /scrypt\$/, 'o hash não pode sair daqui');
  assert.doesNotMatch(texto, /token_hash/);
  assert.equal(lista.corpo.utilizadores.length, 2);
  assert.equal(lista.corpo.utilizadores[1].roleLabel, 'Gestor');
  assert.ok(lista.corpo.papeis.find((p) => p.key === 'dono' && p.does));
});

test('um dono não se desactiva a si próprio, nem deixa a instalação sem donos', async () => {
  const { repo, token } = await comDono();
  const dono = comCookie(token);
  const id = repo._dados.contas[0].id;
  const si = await chamar(repo, `/ops/utilizadores/${id}/desactivar`, 'POST', {}, dono);
  assert.equal(si.status, 400);
  assert.match(si.corpo.error, /tua própria/);
  const papel = await chamar(repo, `/ops/utilizadores/${id}/papel`, 'POST', { role: 'leitor' }, dono);
  assert.equal(papel.status, 400, 'tirar-se os poderes a si próprio é deixar a casa sem chave');
});

/* ---------- 3 · sessões à vista ---------- */

test('o dono vê e fecha sessões; a lista diz qual é a actual', async () => {
  const { repo, token } = await comDono();
  limitador.limpar();
  const outra = await chamar(repo, '/auth/entrar', 'POST', { email: 'dono@orbita.pt', password: SENHA });
  const s2 = decodeURIComponent(outra.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);
  const lista = await chamar(repo, '/ops/sessoes', 'GET', null, comCookie(token));
  assert.equal(lista.status, 200);
  assert.equal(lista.corpo.sessoes.length, 2);
  assert.equal(lista.corpo.sessoes.filter((s) => s.state === 'activa').length, 2);
  const alvo = lista.corpo.sessoes.find((s) => !s.actual);
  const fecha = await chamar(repo, `/ops/sessoes/${alvo.id}`, 'DELETE', null, comCookie(token));
  assert.equal(fecha.status, 200);
  assert.equal((await chamar(repo, '/ops/summary', 'GET', null, comCookie(s2))).status, 401, 'a sessão fechada não volta a entrar');
});

/* ---------- 4 · as peças, isoladas ---------- */

test('palavra-passe: scrypt com sal próprio, nunca em claro, e recusa as óbvias', () => {
  const a = hashPassword(SENHA);
  const b = hashPassword(SENHA);
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a, b, 'dois hashes da mesma frase não podem ser iguais (sal novo em cada um)');
  assert.ok(!a.includes(SENHA));
  assert.equal(verifyPassword(SENHA, a), true);
  assert.equal(verifyPassword('outra-coisa-qualquer-1', a), false);
  assert.equal(verifyPassword(SENHA, 'lixo'), false, 'formato desconhecido devolve falso, não rebenta');
  for (const ma of ['curta', 'aaaaaaaaaaaaaa', 'password1234567', 'qwerty-qwerty-1']) {
    assert.ok(checkPassword(ma), `«${ma}» devia ser recusada`);
  }
  assert.match(checkPassword('uma-senha-com-o-email-dono-2026', { email: 'dono@orbita.pt' }), /email/);
});

test('o formato da palavra-passe é o mesmo do Órbita local (uma senha, dois sítios)', async () => {
  const { verifyPassword: verLocal, hashPassword: hashearLocal } = await import('./src/ops/auth.mjs');
  const nossa = hashPassword('uma-frase-bem-comprida-2026');
  assert.equal(verLocal('uma-frase-bem-comprida-2026', nossa), true, 'o hash daqui tem de abrir no guarda local');
  const deles = hashearLocal('uma-frase-bem-comprida-2026');
  assert.equal(verifyPassword('uma-frase-bem-comprida-2026', deles), true, 'e o contrário também');
});

test('papéis: níveis e permissões coerentes; `publico` nunca devolve o hash', () => {
  assert.deepEqual(ROLES.map((r) => r.key), ['dono', 'gestor', 'operador', 'leitor']);
  assert.equal(can('dono', 'admin'), true);
  assert.equal(can('gestor', 'approve'), true);
  assert.equal(can('gestor', 'admin'), false);
  assert.equal(can('operador', 'write'), true);
  assert.equal(can('operador', 'approve'), false);
  assert.equal(can('leitor', 'write'), false);
  assert.equal(can('inventado', 'read'), false);
  const p = permisosDe('leitor');
  assert.equal(p.write, false);
  assert.equal(p.ver, true);
  const u = publico({ id: 'u1', email: 'a@b.pt', nome: 'A', papel: 'gestor', hash: 'scrypt$segredo' });
  assert.equal(JSON.stringify(u).includes('scrypt'), false);
  assert.equal(u.roleLabel, 'Gestor');
});

test('tokens: aleatórios, e na base fica só o sha256', async () => {
  const t1 = novoToken();
  const t2 = novoToken();
  assert.notEqual(t1, t2);
  assert.ok(t1.length >= 40);
  const { repo } = await comDono();
  assert.ok(repo._dados.sessoes.length >= 1);
  const guardado = JSON.stringify(repo._dados.sessoes);
  assert.match(guardado, /[0-9a-f]{64}/, 'o token_hash é sha256');
  assert.equal(hashToken(t1).length, 64);
  assert.notEqual(hashToken(t1), hashToken(t2));
});

test('cookies: lidos de várias formas, e a sessão morre com o prazo', () => {
  assert.deepEqual(lerCookies(`a=1; ${COOKIE}=xyz%2F123; b=2`), { a: '1', b: '2', [COOKIE]: 'xyz/123' });
  assert.equal(tokenDoPedido({ cookie: `${COOKIE}=abc` }), 'abc');
  assert.equal(tokenDoPedido({ 'x-orbita-session': 'def' }), 'def');
  assert.equal(tokenDoPedido({ authorization: 'Bearer ghi' }), 'ghi');
  assert.equal(tokenDoPedido({}), null);
  assert.match(cookieDeSessao('t'), /Secure/);
  assert.doesNotMatch(cookieDeSessao('t', { secure: false }), /Secure/);
  assert.equal(sessaoValida({ expira: new Date(Date.now() + 60000).toISOString() }), true);
  assert.equal(sessaoValida({ expira: new Date(Date.now() - 60000).toISOString() }), false);
  assert.equal(sessaoValida({ expira: new Date(Date.now() + 60000).toISOString(), revogada: 'agora' }), false);
  assert.equal(sessaoValida(null), false);
});

test('o limitador conta, espera e esquece quando alguém acerta', () => {
  let t = 0;
  const l = criarLimitador({ janelaMs: 1000, max: 3, agora: () => t });
  assert.equal(l.ver('a').ok, true);
  l.falhou('a'); l.falhou('a'); l.falhou('a');
  assert.equal(l.ver('a').ok, false);
  t = 1200;
  assert.equal(l.ver('a').ok, true, 'a janela passou');
  l.falhou('b'); l.acertou('b');
  assert.equal(l.ver('b').restam, 3, 'acertar limpa a contagem');
});

test('estado da porta: sem contas, com sessão, e a excepção declarada', () => {
  assert.equal(estadoDaPorta({ temContas: false, env: {} }).modo, 'sem-contas');
  assert.equal(estadoDaPorta({ temContas: false, env: {} }).primeiraContaPossivel, true);
  assert.equal(estadoDaPorta({ temContas: true, env: {} }).modo, 'sessao');
  const aberta = estadoDaPorta({ temContas: true, env: { ORBITA_AUTH: 'aberta' } });
  assert.equal(aberta.modo, 'aberta');
  assert.match(aberta.aviso, /aberta/i, 'a excepção tem de trazer o aviso');
});

/* ---------- 5 · modos: nada disto parte o que já existia ---------- */

test('sem base de dados (memória) a porta fica dormente — está dito, não é esquecimento', async () => {
  const repo = createMemRepo();
  const r = await responder(repo, { caminho: '/ops/leads', env: {} });
  assert.equal(r.status, 200, 'o modo local/teste continua a trabalhar sem contas');
  const eu = await responder(repo, { caminho: '/auth/eu', env: {} });
  assert.equal(eu.status, 200);
  assert.equal(eu.corpo.semContas, true);
});

test('`ORBITA_AUTH=aberta` abre a porta e di-lo — mas só se alguém o decidir', async () => {
  const { repo } = await comDono();
  const aberta = await responder(repo, { caminho: '/ops/summary', env: { ...ENV, ORBITA_AUTH: 'aberta' }, seguranca: true });
  assert.equal(aberta.status, 200);
  const eu = await responder(repo, { caminho: '/auth/eu', env: { ...ENV, ORBITA_AUTH: 'aberta' }, seguranca: true });
  assert.equal(eu.corpo.estado.modo, 'aberta');
  assert.match(eu.corpo.estado.aviso, /aberta/);
});

/* ---------- 6 · as costuras: o que liga a porta à Vercel e à mesa ---------- */

test('a função da Vercel passa os cabeçalhos e devolve o Set-Cookie', () => {
  const rpc = readFileSync(new URL('./api/rpc.mjs', import.meta.url), 'utf8');
  assert.match(rpc, /headers: req\.headers/, 'sem os cabeçalhos o cookie nunca chega à porta');
  assert.match(rpc, /Set-Cookie/, 'sem Set-Cookie o browser nunca guarda a sessão');
});

test('a mesa tem ecrã de entrada, campo de token e o caminho de recuperação', () => {
  const mesa = readFileSync(new URL('./src/mesa.js', import.meta.url), 'utf8');
  assert.match(mesa, /function viewLogin/);
  assert.match(mesa, /primeiraConta/);
  assert.match(mesa, /primeiraContaPossivel/);
  assert.match(mesa, /\/auth\/entrar/);
  assert.match(mesa, /\/auth\/primeiro-dono/);
  assert.match(mesa, /\/auth\/sair/);
});

test('a migração da porta existe, é idempotente e não guarda segredos em claro', () => {
  const sql = readFileSync(new URL('./supabase/orbita_1_54_0.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.orbita_contas/);
  assert.match(sql, /create table if not exists public\.orbita_sessoes/);
  assert.match(sql, /token_hash text not null unique/);
  assert.match(sql, /recuperar_hash/);
  assert.doesNotMatch(sql, /password text/i, 'a palavra-passe nunca tem coluna própria em claro');
  assert.match(sql, /enable row level security/);
});

/* ===========================================================================
   1.54.1 · A CONTA NASCE SOZINHA
   O que aqui se prova: alguém que nunca falou com o dono cria a sua conta,
   recebe um link, confirma, e entra — como leitor. E a sessão de quem trabalha
   todos os dias não morre a meio do trabalho.
   =========================================================================== */

/** Um `fetch` falso só para o Resend: guarda o que foi enviado. */
function correioFalso({ falhar = false } = {}) {
  const enviados = [];
  const fetchImpl = async (url, init) => {
    const corpo = JSON.parse(init.body);
    enviados.push({ url, ...corpo });
    return { ok: !falhar, status: falhar ? 500 : 200, json: async () => ({ id: 'mail_1' }) };
  };
  return { enviados, fetchImpl };
}

const ENV_CORREIO = { ...ENV, RESEND_API_KEY: 're_teste_abcdefghij', ORBITA_URL: 'https://orbita.exemplo.pt' };

test('registo: cria a conta por confirmar e manda o link por email', async () => {
  const { repo } = await comDono();
  const correio = correioFalso();
  const r = await chamar(repo, '/auth/registo', 'POST', {
    email: 'nova@orbita.pt', password: SENHA, name: 'Nova Pessoa',
  }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.emailEnviado, true);
  assert.equal(r.corpo.porConfirmar, true);
  assert.equal(correio.enviados.length, 1);
  assert.match(correio.enviados[0].subject, /Confirma a tua conta/);
  assert.match(correio.enviados[0].text, /https:\/\/orbita\.exemplo\.pt\/app\/#\/confirmar\?t=/);
  assert.equal(correio.enviados[0].to[0], 'nova@orbita.pt');

  /* a conta existe, é leitora, e não tem o token em claro */
  const conta = repo._dados.contas.find((c) => c.email === 'nova@orbita.pt');
  assert.equal(conta.papel, 'leitor');
  assert.equal(conta.confirmado_em, null);
  assert.match(conta.confirmar_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(conta), /[?&]t=[A-Za-z0-9_-]{20,}/, 'o token não fica guardado em claro');
});

test('registo sem RESEND_API_KEY: a conta nasce e diz-se que falta a chave', async () => {
  const { repo } = await comDono();
  const r = await chamar(repo, '/auth/registo', 'POST', { email: 'semcorreio@orbita.pt', password: SENHA });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.emailEnviado, false);
  assert.match(r.corpo.nota, /RESEND_API_KEY/);
  assert.match(r.corpo.instrucao, /confirm/i);
  assert.match(r.corpo.mensagem, /POR CONFIRMAR/);
});

test('a conta por confirmar não entra — e o 403 diz que é isso, não credenciais', async () => {
  const { repo } = await comDono();
  await chamar(repo, '/auth/registo', 'POST', { email: 'espera@orbita.pt', password: SENHA }, { env: ENV_CORREIO, fetchImpl: correioFalso().fetchImpl });
  limitador.limpar();
  const r = await chamar(repo, '/auth/entrar', 'POST', { email: 'espera@orbita.pt', password: SENHA });
  assert.equal(r.status, 403);
  assert.equal(r.corpo.naoConfirmada, true);
  assert.match(r.corpo.error, /ainda não está confirmada/);
  assert.equal(r.corpo.podeReenviar, true);
});

test('o link confirma a conta e entra: a pessoa passa a poder trabalhar', async () => {
  const { repo } = await comDono();
  const correio = correioFalso();
  await chamar(repo, '/auth/registo', 'POST', { email: 'confirma@orbita.pt', password: SENHA }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  const link = /\?t=([A-Za-z0-9_-]+)/.exec(correio.enviados[0].text)[1];

  const mal = await chamar(repo, '/auth/confirmar', 'POST', { token: 'inventado-mas-comprido' });
  assert.equal(mal.status, 400);

  const bem = await chamar(repo, '/auth/confirmar', 'POST', { token: link });
  assert.equal(bem.status, 200, JSON.stringify(bem.corpo));
  assert.equal(bem.corpo.user.email, 'confirma@orbita.pt');
  assert.equal(bem.corpo.user.confirmado, true);
  assert.equal(bem.corpo.user.role, 'leitor', 'quem se inscreve sozinho entra como leitor, não como dono');
  assert.equal(bem.corpo.perms.write, false, 'e não pode escrever até um dono subir o papel');
  const token = decodeURIComponent(bem.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);
  assert.equal((await chamar(repo, '/ops/summary', 'GET', null, comCookie(token))).status, 200, 'confirma e entra');

  /* o link é de uso único */
  const outra = await chamar(repo, '/auth/confirmar', 'POST', { token: link });
  assert.equal(outra.status, 400);
});

test('um dono confirma à mão e a conta entra (é o caminho quando não há correio)', async () => {
  const { repo, token } = await comDono();
  await chamar(repo, '/auth/registo', 'POST', { email: 'manual@orbita.pt', password: SENHA });
  const conta = repo._dados.contas.find((c) => c.email === 'manual@orbita.pt');
  const feito = await chamar(repo, `/ops/utilizadores/${conta.id}/confirmar`, 'POST', {}, comCookie(token));
  assert.equal(feito.status, 200);
  assert.equal(feito.corpo.utilizador.confirmado, true);
  limitador.limpar();
  const entra = await chamar(repo, '/auth/entrar', 'POST', { email: 'manual@orbita.pt', password: SENHA });
  assert.equal(entra.status, 200);
});

test('reviar o link não diz se o email existe; com correio, manda outro', async () => {
  const { repo } = await comDono();
  const correio = correioFalso();
  const r = await chamar(repo, '/auth/reenviar', 'POST', { email: 'nao-existe@orbita.pt' }, { env: ENV_CORREIO, fetchImpl: correio.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(correio.enviados.length, 0);
  assert.match(r.corpo.mensagem, /se houver uma conta por confirmar/);
});

test('o registo fecha-se com ORBITA_REGISTO=fechado, e diz onde pedir conta', async () => {
  const { repo } = await comDono();
  const r = await chamar(repo, '/auth/registo', 'POST', { email: 'x@y.pt', password: SENHA }, { env: { ...ENV, ORBITA_REGISTO: 'fechado' } });
  assert.equal(r.status, 403);
  assert.match(r.corpo.hint, /dono/);
});

test('a sessão renova-se com o uso — e o cookie novo vai na resposta', async () => {
  const { repo, token } = await comDono();
  /* a sessão está a 1 hora do fim: quem abre a Órbita hoje ganha mais 12 h */
  const sessao = repo._dados.sessoes[0];
  const quase = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  sessao.expira = quase;
  const eu = await chamar(repo, '/auth/eu', 'GET', null, comCookie(token));
  assert.equal(eu.status, 200);
  assert.equal(eu.corpo.renovada, true);
  assert.ok(new Date(eu.corpo.expira).getTime() > new Date(quase).getTime() + 6 * 3600 * 1000, 'ganhou horas, não minutos');
  assert.match(eu.cabecalhos['Set-Cookie'], /Max-Age=43200/, 'o browser tem de receber o cookie novo, senão fecha sozinho');
  /* e a base concorda com o cookie */
  assert.equal(repo._dados.sessoes[0].expira, eu.corpo.expira);

  /* uma sessão acabada de abrir NÃO é renovada em cada pedido (nada de sessões eternas) */
  const outra = await chamar(repo, '/auth/entrar', 'POST', { email: 'dono@orbita.pt', password: SENHA });
  limitador.limpar();
  const t2 = decodeURIComponent(outra.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);
  const eu2 = await chamar(repo, '/auth/eu', 'GET', null, comCookie(t2));
  assert.equal(eu2.corpo.renovada, false);
});

test('o link do email leva ao ecrã certo (a rota #/confirmar?t=… é lida)', () => {
  const mesa = readFileSync(new URL('./src/mesa.js', import.meta.url), 'utf8');
  assert.match(mesa, /caminho === 'confirmar'/, 'sem isto o link abria a mesa em «Hoje»');
  assert.match(mesa, /S\.aConfirmar = caminho === 'confirmar' \? t : null/);
  assert.match(mesa, /data-act="confirmar-conta"/);
  assert.match(mesa, /aRegistar \? 'registar'/, 'o botão do registo tem de existir no ecrã de entrada');
  assert.match(mesa, /data-act="abrir-registo"/);
  assert.match(mesa, /data-act="confirmar-conta-admin"/);
});

test('a migração da confirmação existe e não tranca os donos antigos fora', () => {
  const sql = readFileSync(new URL('./supabase/orbita_1_54_1.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists confirmado_em/);
  assert.match(sql, /add column if not exists confirmar_hash/);
  assert.match(sql, /update public\.orbita_contas[\s\S]*confirmado_em = coalesce/, 'as contas antigas têm de continuar a entrar');
});
