// Testes do Vercel Connect (1.27.0, 27 out 2026).
//
// O que se prova aqui, sem rede e sem tocar na Vercel:
//   · sem credencial (OIDC), diz exactamente o que falta — não finge que ligou;
//   · o pedido leva o conector certo, o sujeito certo e o token de chamada certo;
//   · o token é reaproveitado da cache e só se pede outro quando é forçado;
//   · cada erro tipado da SDK é traduzido para o que o dono tem de fazer
//     (autorizar, instalar, ligar o conector ao projecto, corrigir a credencial);
//   · o token EM CLARO nunca aparece numa resposta — só 4+4 caracteres;
//   · o botão «Testar ligação» guarda o resultado; o GET de diagnóstico não.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONECTOR_PADRAO, ID_PADRAO, assuntoDe, consentimento, credencialDe, estado,
  limparCache, mascarar, metadataDoConector, testar, tokenPara,
} from './api/_conect.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const TOKEN = 'connect-token-super-secreto-1234567890';
const OIDC = 'oidc-de-teste';

function sdkFalso({ token = TOKEN, expiraEm = Date.now() + 300000, erro = null, traco = [] } = {}) {
  return {
    getTokenResponse: async (conector, params, opcoes) => {
      traco.push({ conector, params, opcoes });
      if (erro) throw erro;
      return {
        token,
        tokenId: 'stk_abc123',
        expiresAt: expiraEm,
        connector: { id: ID_PADRAO, uid: conector, type: 'oauth' },
        name: 'Orbita Agentes',
      };
    },
    startAuthorization: async () => ({ url: 'https://vercel.com/connect/authorize?pedido=1', connector: { serviceName: 'OpenCode' } }),
  };
}
const importarCom = (sdk) => async (nome) => { assert.equal(nome, '@vercel/connect'); return sdk; };
const erroCom = (nome, extra = {}) => Object.assign(Object.create(Error.prototype), { name: nome, message: `${nome}: falhou`, ...extra });

/* ---------- 1 · estado ---------- */
test('connect: sem credencial diz o que falta, com o conector certo à frente', async () => {
  limparCache();
  const e = await estado({}, { importar: importarCom(sdkFalso()) });
  assert.equal(e.ok, false);
  assert.equal(e.conector, CONECTOR_PADRAO);
  assert.equal(e.id, ID_PADRAO);
  assert.equal(e.credencial.presente, false);
  assert.match(e.credencial.motivo, /token OIDC/);
  assert.equal(e.sdk.disponivel, true);
  assert.equal(JSON.stringify(e).includes(TOKEN), false);
});

test('connect: o sujeito é o dono quando há id; senão, a aplicação', () => {
  assert.deepEqual(assuntoDe({}, null), { type: 'app' });
  assert.deepEqual(assuntoDe({ ORBITA_DONO_ID: 'usr_123' }, null), { type: 'user', id: 'usr_123' });
  assert.deepEqual(assuntoDe({ ORBITA_DONO_ID: 'usr_123' }, { id: 'usr_999' }), { type: 'user', id: 'usr_999' });
});

/* ---------- 2 · o pedido ---------- */
test('connect: pede o token ao conector certo, com o sujeito e a credencial certos', async () => {
  limparCache();
  const traco = [];
  const t = await tokenPara({ pedido: { id: 'usr_123' }, escopos: ['repo:read'] }, { env: { VERCEL_OIDC_TOKEN: OIDC }, importar: importarCom(sdkFalso({ traco })) });
  assert.equal(t.token, TOKEN);
  assert.equal(t.conector.uid, CONECTOR_PADRAO);
  assert.equal(traco.length, 1);
  assert.equal(traco[0].conector, CONECTOR_PADRAO);
  assert.deepEqual(traco[0].params.subject, { type: 'user', id: 'usr_123' });
  assert.deepEqual(traco[0].params.scopes, ['repo:read']);
  /* com o OIDC do processo deixa-se a SDK ler o ambiente (é o caminho documentado) */
  assert.equal(traco[0].opcoes.vercelToken, undefined);
  assert.equal(t.credencial, undefined); // tokenPara não devolve credencial; testar() devolve
});

test('connect: o OIDC que chega no pedido é passado à SDK como token de chamada', async () => {
  limparCache();
  const traco = [];
  await tokenPara({}, { env: { AI_GATEWAY_API_KEY: 'oidc-do-cabecalho' }, importar: importarCom(sdkFalso({ traco })) });
  assert.equal(traco[0].opcoes.vercelToken, 'oidc-do-cabecalho');
});

test('connect: os quatro modos de credencial são distinguidos, e cada um sabe o que falta', () => {
  assert.equal(credencialDe({ VERCEL_OIDC_TOKEN: 'a' }).tipo, 'oidc-env');
  assert.equal(credencialDe({ AI_GATEWAY_API_KEY: 'b' }).tipo, 'oidc-pedido');
  assert.equal(credencialDe({ VERCEL_TOKEN: 'c' }).tipo, 'chave');
  assert.equal(credencialDe({ VERCEL_OIDC_TOKEN: 'a' }, 'chave').valor, null);
  assert.match(credencialDe({}, 'oidc-env').motivo, /VERCEL_OIDC_TOKEN/);
  assert.match(credencialDe({}, 'oidc-pedido').motivo, /x-vercel-oidc-token/);
  assert.match(credencialDe({}, 'chave').motivo, /VERCEL_TOKEN/);
});

test('connect: o segundo pedido vem da cache; forçar pede outro', async () => {
  limparCache();
  const traco = [];
  const deps = { env: { VERCEL_OIDC_TOKEN: OIDC }, importar: importarCom(sdkFalso({ traco })) };
  const a = await tokenPara({ pedido: { id: 'usr_1' } }, deps);
  const b = await tokenPara({ pedido: { id: 'usr_1' } }, deps);
  assert.equal(a.cache, false);
  assert.equal(b.cache, true);
  assert.equal(traco.length, 1, 'não se pede um token novo por pedido');
  const c = await tokenPara({ pedido: { id: 'usr_1' }, forcar: true }, deps);
  assert.equal(c.cache, false);
  assert.equal(traco.length, 2);
  /* outro sujeito = outra entrada de cache */
  await tokenPara({ pedido: { id: 'usr_2' } }, deps);
  assert.equal(traco.length, 3);
});

test('connect: sem credencial, tokenPara recusa com a razão (nunca um token vazio)', async () => {
  await assert.rejects(() => tokenPara({}, { env: {}, importar: importarCom(sdkFalso()) }), (e) => {
    assert.equal(e.codigo, 'semcredencial');
    assert.match(e.message, /OIDC/);
    return true;
  });
});

test('connect: sem o pacote instalado, diz isso em vez de rebentar', async () => {
  const importarMau = async () => { throw new Error('Cannot find package'); };
  const e = await estado({ VERCEL_OIDC_TOKEN: OIDC }, { importar: importarMau });
  assert.equal(e.sdk.disponivel, false);
  assert.match(e.sdk.motivo, /@vercel\/connect não está disponível/);
  assert.equal(e.ok, false);
});

/* ---------- 3 · os erros que o dono tem de resolver ---------- */
test('connect: cada erro da SDK vira uma instrução em português', async () => {
  const casos = [
    ['UserAuthorizationRequiredError', 'precisa-consentimento', /ainda não autorizou/],
    ['ConnectorInstallationRequiredError', 'precisa-instalacao', /precisa de uma instalação/],
    ['ClientNotLinkedToProjectError', 'nao-ligado', /não está ligado a este projecto/],
  ];
  for (const [nome, codigo, texto] of casos) {
    limparCache();
    const r = await testar({ forcar: true }, { env: { VERCEL_OIDC_TOKEN: OIDC }, importar: importarCom(sdkFalso({ erro: erroCom(nome) })) });
    assert.equal(r.ok, false);
    assert.equal(r.codigo, codigo, `${nome} devia dar ${codigo}`);
    assert.match(r.erro, texto);
  }
  limparCache();
  const cred = await testar({ forcar: true }, { env: { VERCEL_OIDC_TOKEN: OIDC }, importar: importarCom(sdkFalso({ erro: erroCom('ConnectError', { status: 401 }) })) });
  assert.equal(cred.codigo, 'credencial');
  assert.equal(cred.precisaConsentimento, false);
});

/* ---------- 4 · o retrato ---------- */
test('connect: o teste devolve o retrato e NUNCA o token', async () => {
  limparCache();
  const r = await testar({}, { env: { VERCEL_OIDC_TOKEN: OIDC }, importar: importarCom(sdkFalso()) });
  assert.equal(r.ok, true);
  assert.equal(r.conector, CONECTOR_PADRAO);
  assert.equal(r.tipoDeConector, 'oauth');
  assert.equal(r.tokenMascarado, mascarar(TOKEN));
  assert.equal(r.tokenMascarado.startsWith('conn'), true);
  assert.equal(r.tokenMascarado.endsWith('7890'), true);
  assert.equal(JSON.stringify(r).includes(TOKEN), false, 'o token em claro não pode sair na resposta');
  assert.ok(r.faltamSegundos > 0);
  assert.ok(r.expiradoEm || r.expiraEm);
});

test('connect: um token curto demais é mascarado por completo', () => {
  assert.equal(mascarar('abc'), '••••');
  assert.equal(mascarar(''), '');
});

test('rotas: o link de consentimento sai por GET quando o dono o permite', async () => {
  const repo = createMemRepo();
  const r = await chamar(repo, '/conectar/consentimento', 'GET', null, { AI_GATEWAY_API_KEY: 'oidc', ORBITA_PERMITIR_CONSENTIMENTO: '1' }, importarCom(sdkFalso()));
  assert.equal(r.status, 200);
  assert.match(r.corpo.url, /^https:\/\//);
});

test('connect: o link de consentimento está desligado por omissão', async () => {
  await assert.rejects(() => consentimento({}, { env: { VERCEL_OIDC_TOKEN: OIDC }, importar: importarCom(sdkFalso()) }), (e) => {
    assert.equal(e.codigo, 'consentimento-desligado');
    return true;
  });
  const com = await consentimento({}, { env: { VERCEL_OIDC_TOKEN: OIDC, ORBITA_PERMITIR_CONSENTIMENTO: '1' }, importar: importarCom(sdkFalso()) });
  assert.match(com.url, /^https:\/\//);
  assert.equal(com.servico, 'OpenCode');
});

/* ---------- 4b · o conector existe? ---------- */
test('connect: a metadata do conector separa «não existe/ligado» de «credencial má»', async () => {
  const sdk = {
    getTokenResponse: async () => ({ token: 'x', expiresAt: Date.now() + 1000, connector: { uid: CONECTOR_PADRAO } }),
    getConnectorMetadata: async (conector, opcoes) => ({ uid: conector, type: 'oauth', supportedSubjectTypes: ['user'], ligado: opcoes?.vercelToken ? 'com-token' : 'sem-token' }),
  };
  const bom = await metadataDoConector({}, { env: { AI_GATEWAY_API_KEY: 'oidc' }, importar: importarCom(sdk) });
  assert.equal(bom.ok, true);
  assert.equal(bom.metadata.uid, CONECTOR_PADRAO);
  assert.deepEqual(bom.metadata.supportedSubjectTypes, ['user']);
  assert.equal(bom.metadata.ligado, 'com-token');

  const sem = await metadataDoConector({}, { env: {}, importar: importarCom(sdk) });
  assert.equal(sem.ok, false);
  assert.equal(sem.codigo, 'semcredencial');
});

/* ---------- 4c · o sujeito certo para o tipo de conector ---------- */
test('connect: se o conector só aceita utilizadores, o erro diz isso (e não culpa a rede)', async () => {
  limparCache();
  const sdk = {
    getTokenResponse: async () => { throw erroCom('ConnectError', { status: 401, code: 'unresolved_token' }); },
    getConnectorMetadata: async () => ({ uid: CONECTOR_PADRAO, type: 'api-key', service: 'opencode', supportedSubjectTypes: ['user'] }),
  };
  const r = await testar({ forcar: true }, { env: { AI_GATEWAY_API_KEY: 'oidc' }, importar: importarCom(sdk) });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'precisa-sujeito');
  assert.match(r.erro, /só emite tokens do tipo «user»/);
  assert.match(r.erro, /ORBITA_DONO_ID/);
  assert.deepEqual(r.podeSerSujeito, { suportados: ['user'], usado: 'app' });
});

test('connect: com ORBITA_DONO_ID o sujeito passa a ser esse utilizador', async () => {
  limparCache();
  const traco = [];
  await tokenPara({}, { env: { AI_GATEWAY_API_KEY: 'oidc', ORBITA_DONO_ID: 'usr_123' }, importar: importarCom(sdkFalso({ traco })) });
  assert.deepEqual(traco[0].params.subject, { type: 'user', id: 'usr_123' });
});

test('connect: o estado mostra o tipo de conector e os sujeitos que aceita', async () => {
  limparCache();
  const sdk = {
    getTokenResponse: async () => ({ token: 't', expiresAt: Date.now() + 60000, connector: { uid: CONECTOR_PADRAO } }),
    getConnectorMetadata: async () => ({ uid: CONECTOR_PADRAO, type: 'api-key', service: 'opencode', supportedSubjectTypes: ['user'] }),
  };
  const e = await estado({ AI_GATEWAY_API_KEY: 'oidc' }, { importar: importarCom(sdk) });
  assert.deepEqual(e.conectorTipo, { tipo: 'api-key', sujeitos: ['user'], servico: 'opencode' });
});

/* ---------- 5 · as rotas ---------- */
const chamar = (repo, caminho, metodo = 'GET', corpo = null, env = {}, importarConect = null) =>
  responder(repo, { caminho, metodo, corpo, env, ...(importarConect ? { importarConect } : {}) });

test('rotas: /conectar/estado diz o conector e o que falta', async () => {
  const repo = createMemRepo();
  const r = await chamar(repo, '/conectar/estado');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.conector, CONECTOR_PADRAO);
  assert.equal(r.corpo.id, ID_PADRAO);
  assert.equal(r.corpo.ok, false);
  assert.match(r.corpo.credencial.motivo, /OIDC/);
});

test('rotas: /conectar/teste por GET faz o pedido e não escreve no registo', async () => {
  const repo = createMemRepo();
  limparCache();
  const r = await chamar(repo, '/conectar/teste', 'GET', null, { VERCEL_OIDC_TOKEN: OIDC }, importarCom(sdkFalso()));
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.id, 'vercel-connect');
  assert.equal(JSON.stringify(r.corpo).includes(TOKEN), false);
  assert.equal(repo._dados.atividade.length, 0);
});

test('rotas: o botão «Testar ligação» grava o resultado do Connect', async () => {
  const repo = createMemRepo();
  limparCache();
  const r = await chamar(repo, '/platform/testar', 'POST', { id: 'vercel-connect' }, { VERCEL_OIDC_TOKEN: OIDC }, importarCom(sdkFalso()));
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.prova, 'pedido real, agora');
  const cfg = repo._dados.iaConfig.testes || {};
  assert.equal(cfg['vercel-connect'].ok, true);
  const lista = await chamar(repo, '/platform/apis', 'GET', null, { VERCEL_OIDC_TOKEN: OIDC });
  const servico = lista.corpo.list.find((x) => x.id === 'vercel-connect');
  assert.ok(servico, 'o Connect tem de aparecer no inventário do Centro de Controlo');
  assert.equal(servico.verified, true);
  assert.equal(servico.configured, true);
});

test('rotas: sem OIDC, o inventário diz que o Connect não está configurado', async () => {
  const repo = createMemRepo();
  const lista = await chamar(repo, '/platform/apis');
  const servico = lista.corpo.list.find((x) => x.id === 'vercel-connect');
  assert.equal(servico.configured, false);
  assert.equal(servico.verified, false);
});

test('rotas: consentimento desligado é 409, não um 500', async () => {
  const repo = createMemRepo();
  await assert.rejects(
    () => chamar(repo, '/conectar/consentimento', 'POST', {}, { VERCEL_OIDC_TOKEN: OIDC }, importarCom(sdkFalso())),
    (e) => { assert.equal(e.status, 409); assert.match(e.message, /ORBITA_PERMITIR_CONSENTIMENTO/); return true; },
  );
});
