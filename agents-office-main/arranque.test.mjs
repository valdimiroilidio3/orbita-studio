/* ===========================================================================
   1.63.0 · O ARRANQUE, provado (4 nov 2026)

   `arranque-ui.test.mjs` prova o que se vê. Este prova as REGRAS de `src/arranque.js`,
   que são as que podem mentir:

     · sem leitura do servidor não há «está tudo bem» — há «não sei»;
     · o que falta aparece primeiro, e o crítico antes do essencial;
     · um opcional em falta não deixa a instalação «não pronta», mas também não
       desaparece da lista;
     · cada acção aponta a uma variável que EXISTE em `api/_prontidao.mjs` e a um
       ficheiro que EXISTE em `api/_esquema.mjs` — a lista não inventa nomes;
     · «nada mudou» é uma resposta, e diz o que fazer a seguir (o redeploy).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checklist, itensDeTabelas, itensDeProntidao, itensDoResumo, resumo, passoASeguir,
  comparar, fraseDaVerificacao, linhaDaPeca, NOTA_REDEPLOY,
  auditoriaLegivel, resultadoDaAplicacao, erroDoSetup,
  VARIAVEIS_CONHECIDAS, TABELAS_COM_FICHEIRO, ACOES_DOS_GRUPOS, itensDeNomesErrados,
} from './src/arranque.js';
import { GRUPOS } from './api/_prontidao.mjs';
import { FICHEIROS, TABELAS_DA_MESA } from './api/_esquema.mjs';

const HEALTH_QUEBRADO = {
  ok: false, modo: 'base', base: 'dpfqageawguekdjbdwyt', faltam: ['orbita_faturas'],
  versao: '1.62.0',
  prontidao: { pronto: false, criticasEmFalta: ['Acesso'], essenciaisEmFalta: ['Correio', 'WhatsApp'] },
};

const PRONTIDAO = {
  pronto: false,
  criticasEmFalta: ['Acesso'],
  essenciaisEmFalta: ['Correio'],
  grupos: [
    {
      id: 'acesso', nome: 'Acesso', critico: true, pronto: false,
      porque: 'sem isto, qualquer pessoa com o endereço manda no escritório e gasta as chaves',
      itens: [
        { nome: 'Token da API', pronto: false, variavel: 'ORBITA_API_TOKEN', porque: 'fecha `/api/*`: 32 caracteres ou mais', minimo: 32 },
        { nome: 'Token de administração', pronto: true, variavel: 'ORBITA_ADMIN_TOKEN', porque: 'protege a página e a mesa quando não há contas' },
      ],
    },
    {
      id: 'correio', nome: 'Correio', critico: false, pronto: false,
      porque: 'sem isto as mensagens ficam à espera na mesa e nunca saem',
      itens: [{ nome: 'Chave Resend', pronto: false, variavel: 'RESEND_API_KEY', porque: 'envio e recepção de email' }],
    },
    {
      id: 'ia', nome: 'Motor de IA', critico: false, pronto: true,
      porque: 'sem chave nenhuma o escritório arranca na cadeia gratuita',
      itens: [{ nome: 'Pollinations (gratuita, com chave)', pronto: false, opcional: true, variavel: 'POLLINATIONS_API_KEY', porque: 'tier Seed' }],
    },
  ],
};

test('sem leitura do servidor não se diz que está pronto — diz-se que não se sabe', () => {
  const c = checklist({ health: null });
  assert.equal(c.leitura, 'sem-leitura');
  assert.equal(c.itens.length, 0);
  const r = resumo(c);
  assert.equal(r.pronto, false);
  assert.match(r.frase, /não sei/i);
  assert.match(c.notas.join(' '), /não houve resposta/i);
});

test('uma tabela em falta é uma peça crítica com o ficheiro certo e a acção certa', () => {
  const [t] = itensDeTabelas(['orbita_faturas']);
  assert.equal(t.id, 'tabela:orbita_faturas');
  assert.equal(t.critico, true);
  assert.equal(t.estado, 'falta');
  /* 1.65.1 · a acção aponta para a página (com sessão); o endereço antigo
     passou para a nota, e o texto copiado já não leva um segredo dentro */
  assert.match(t.como.onde, /Página do arranque/);
  assert.match(t.como.texto, /Aplicar o esquema/);
  assert.match(t.como.texto, /orbita_1_56_0\.sql/);
  assert.doesNotMatch(t.como.texto, /\/api\/setup/, 'o texto da acção não é um URL com token');
  assert.match(t.como.nota, /\/api\/setup\?token=<SETUP_TOKEN>&so=orbita_1_56_0\.sql/);
  assert.match(t.como.nota, /ler=1/);
  assert.match(t.porque, /fatura/);
  /* e uma tabela sem mapeamento não inventa um ficheiro: manda o esquema todo */
  const [x] = itensDeTabelas(['orbita_inventada']);
  assert.match(x.como.texto, /não tens de escolher ficheiro/);
  assert.match(x.como.nota, /\/api\/setup\?token=<SETUP_TOKEN>, com/);
});

test('o resumo curto do health vira peças com o peso certo (crítico antes de essencial)', () => {
  const c = checklist({ health: HEALTH_QUEBRADO });
  const ids = c.itens.map((i) => i.id);
  assert.deepEqual(ids, ['tabela:orbita_faturas', 'grupo:acesso', 'grupo:correio', 'grupo:whatsapp'], 'a tabela vem à frente: é um ficheiro a aplicar');
  assert.equal(c.itens[0].critico, true);
  assert.equal(c.itens[1].critico, true);
  assert.equal(c.itens[2].critico, false);
  assert.equal(c.versao, '1.62.0');
  const r = resumo(c);
  assert.equal(r.pronto, false);
  assert.equal(r.criticosEmFalta, 2);
  assert.equal(r.essenciaisEmFalta, 2);
  assert.match(r.frase, /4 peças|peças críticas/);
});

test('a lista completa substitui o resumo curto (não se contam as mesmas peças duas vezes)', () => {
  const c = checklist({ health: HEALTH_QUEBRADO, prontidao: PRONTIDAO });
  assert.equal(c.itens.filter((i) => i.tipo === 'grupo').length, 0);
  const acesso = c.itens.filter((i) => i.grupo === 'acesso').map((i) => i.variavel);
  assert.deepEqual(acesso, ['ORBITA_API_TOKEN', 'ORBITA_ADMIN_TOKEN']);
  const pronto_ = c.itens.find((i) => i.variavel === 'ORBITA_ADMIN_TOKEN');
  assert.equal(pronto_.estado, 'pronto');
  assert.equal(pronto_.como, null, 'uma peça pronta não pede acção');
  const falta = c.itens.find((i) => i.variavel === 'ORBITA_API_TOKEN');
  assert.equal(falta.estado, 'falta');
  assert.match(falta.como.onde, /Vercel/);
  assert.match(falta.como.texto, /ORBITA_API_TOKEN/);
  assert.match(falta.como.texto, /32/);
});

test('o opcional fica no fim, não conta como crítico e não impede «pronto»', () => {
  const c = checklist({
    health: { ok: true, modo: 'base', faltam: [], versao: '1.63.0', prontidao: { pronto: true, criticasEmFalta: [], essenciaisEmFalta: [] } },
    prontidao: PRONTIDAO,
  });
  const emFalta = c.itens.filter((i) => i.estado !== 'pronto');
  const ultimo = emFalta[emFalta.length - 1];
  assert.equal(ultimo.variavel, 'POLLINATIONS_API_KEY', 'o opcional fica atrás do essencial');
  assert.equal(ultimo.opcional, true);
  assert.equal(ultimo.critico, false);
  assert.equal(c.itens[c.itens.length - 1].estado, 'pronto', 'e o que já está resolvido fecha a lista');
  /* mas há uma peça em falta (ORBITA_API_TOKEN e RESEND_API_KEY), por isso não está pronto */
  const r = resumo(c);
  assert.equal(r.pronto, false);
  const soOpcional = resumo(checklist({
    health: { ok: true, modo: 'base', faltam: [], versao: '1.63.0', prontidao: { pronto: true, criticasEmFalta: [], essenciaisEmFalta: [] } },
    prontidao: { grupos: [{ id: 'ia', nome: 'Motor de IA', critico: false, pronto: true, itens: [{ nome: 'x', pronto: false, opcional: true, variavel: 'POLLINATIONS_API_KEY' }] }] },
  }));
  assert.equal(soOpcional.pronto, true);
  assert.equal(soOpcional.emFalta, 1, 'o opcional continua à vista, mesmo não travando nada');
});

test('1.63.1 · uma resposta do servidor local (outra forma) não vira «está tudo bem»', () => {
  /* o `npm start` responde {ok:true, version, backend, …}: nenhum `modo`, nenhum `faltam` */
  const c = checklist({ health: { ok: true, version: '1.63.1', backend: 'local', ai: [], leads: {} } });
  assert.equal(c.leitura, 'parcial');
  assert.equal(c.itens.length, 0);
  assert.equal(c.versao, '1.63.1', 'a versão do servidor local usa outro nome e é lida na mesma');
  const r = resumo(c);
  assert.equal(r.pronto, false);
  assert.match(r.frase, /não sei dizer o que falta/);
  assert.doesNotMatch(r.frase, /tudo no sítio/);
  assert.match(c.notas.join(' '), /sem o retrato do esquema/);
});

test('1.63.1 · «está tudo no sítio» só com prova: ok, modo base e faltam vazio', () => {
  const semProva = resumo(checklist({ health: { ok: true } }));
  assert.equal(semProva.pronto, false);
  const comProva = resumo(checklist({ health: { ok: true, modo: 'base', faltam: [], prontidao: { criticasEmFalta: [], essenciaisEmFalta: [] } } }));
  assert.equal(comProva.pronto, true);
});

test('sem base ligada o arranque não avalia tabelas e diz o que se perde', () => {
  const c = checklist({ health: { ok: false, modo: 'local', error: 'sem SUPABASE_URL/SUPABASE_SECRET_KEY na Vercel', versao: '1.63.0', prontidao: { criticasEmFalta: ['Base de dados'], essenciaisEmFalta: [] } } });
  assert.equal(c.leitura, 'local');
  assert.equal(c.itens.filter((i) => i.tipo === 'tabela').length, 0);
  assert.match(c.notas.join(' '), /browser/);
  const r = resumo(c);
  assert.equal(r.pronto, false);
  assert.match(r.frase, /base não está ligada/);
});

test('o passo a seguir é o crítico que já se sabe como resolver', () => {
  const c = checklist({ health: HEALTH_QUEBRADO, prontidao: PRONTIDAO });
  const p = passoASeguir(c);
  assert.equal(p.critico, true);
  assert.ok(p.como, 'o passo a seguir traz a acção, não só o nome do problema');
  assert.equal(p.id, 'tabela:orbita_faturas', 'a migração vem antes da variável: é ela que está a fazer o health dizer ok:false');
  /* sem tabelas, a variável crítica é o passo */
  const soVars = passoASeguir(checklist({ health: { ok: true, modo: 'base', faltam: [] }, prontidao: PRONTIDAO }));
  assert.equal(soVars.variavel, 'ORBITA_API_TOKEN');
  assert.equal(passoASeguir({ itens: [] }), null);
  assert.equal(passoASeguir(null), null);
});

test('comparar diz o que ficou resolvido, o que apareceu de novo e o que continua igual', () => {
  const antes = checklist({ health: HEALTH_QUEBRADO, prontidao: PRONTIDAO });
  const depois = checklist({
    health: { ok: false, modo: 'base', faltam: ['orbita_ai_runs'], versao: '1.62.0', prontidao: { pronto: false, criticasEmFalta: ['Acesso'], essenciaisEmFalta: ['Correio'] } },
    prontidao: {
      ...PRONTIDAO,
      grupos: [
        { ...PRONTIDAO.grupos[0], itens: [{ ...PRONTIDAO.grupos[0].itens[0], pronto: true }] },
        PRONTIDAO.grupos[1],
      ],
    },
  });
  const c = comparar(antes, depois);
  assert.equal(c.mudou, true);
  /* a tabela deixou de aparecer (foi criada) e a variável mudou de estado: as
     duas contam como resolvidas */
  assert.deepEqual(c.resolvidos.map((i) => i.id), ['tabela:orbita_faturas', 'var:acesso:ORBITA_API_TOKEN']);
  assert.deepEqual(c.resolvidos.map((i) => i.estado), ['pronto', 'pronto']);
  /* o opcional que saiu da lista NÃO é progresso: só um `faltam` é prova */
  assert.deepEqual(c.desaparecidos.map((i) => i.variavel), ['POLLINATIONS_API_KEY']);
  assert.deepEqual(c.novos.map((i) => i.id), ['tabela:orbita_ai_runs']);
  assert.deepEqual(c.iguais.map((i) => i.variavel), ['RESEND_API_KEY']);
  assert.match(fraseDaVerificacao(antes, depois), /Resolvido: Falta a tabela orbita_faturas, Token da API\./);
});

test('uma variável que desapareceu não se anuncia como resolvida', () => {
  const antes = checklist({ health: HEALTH_QUEBRADO, prontidao: PRONTIDAO });
  const depois = checklist({ health: HEALTH_QUEBRADO, prontidao: { grupos: [PRONTIDAO.grupos[0], PRONTIDAO.grupos[1]] } });
  const c = comparar(antes, depois);
  assert.deepEqual(c.resolvidos, []);
  assert.equal(c.desaparecidos.length, 1);
  const f = fraseDaVerificacao(antes, depois);
  assert.match(f, /Deixou de aparecer/);
  assert.match(f, /não prova/);
});

test('«nada mudou» é uma resposta e manda fazer o redeploy', () => {
  const a = checklist({ health: HEALTH_QUEBRADO });
  const b = checklist({ health: HEALTH_QUEBRADO });
  const c = comparar(a, b);
  assert.equal(c.mudou, false);
  const f = fraseDaVerificacao(a, b);
  assert.match(f, /Nada mudou/);
  assert.match(f, /Redeploy/);
  assert.equal(fraseDaVerificacao(null, b), 'Primeira leitura desta instalação.');
  assert.match(NOTA_REDEPLOY, /Redeploy/);
});

test('a versão mudou mas as peças não: diz-se isso, sem fingir progresso', () => {
  const a = checklist({ health: { ...HEALTH_QUEBRADO, versao: '1.62.0' } });
  const b = checklist({ health: { ...HEALTH_QUEBRADO, versao: '1.63.0' } });
  assert.match(fraseDaVerificacao(a, b), /A versão mudou de 1\.62\.0 para 1\.63\.0/);
});

test('uma peça escreve-se numa linha: título, porquê e acção', () => {
  const [t] = itensDeTabelas(['orbita_faturas']);
  const l = linhaDaPeca(t);
  assert.match(l, /Falta a tabela orbita_faturas/);
  assert.match(l, /fatura/);
  assert.match(l, /Página do arranque/);
  assert.equal(linhaDaPeca({}), '');
});

/* ---------- a lista não inventa nomes ---------- */

test('todas as variáveis com acção existem em api/_prontidao.mjs', () => {
  const reais = new Set();
  for (const g of GRUPOS) for (const i of g.itens) for (const a of i.aliases) reais.add(a);
  assert.ok(VARIAVEIS_CONHECIDAS.length > 10, 'a tabela de acções não está vazia');
  for (const v of VARIAVEIS_CONHECIDAS) {
    assert.ok(reais.has(v), `${v} não existe em _prontidao.mjs — a acção estaria a mandar criar uma variável inventada`);
  }
});

test('todas as tabelas da mesa têm um ficheiro do esquema conhecido', () => {
  for (const t of TABELAS_DA_MESA) {
    assert.ok(TABELAS_COM_FICHEIRO.includes(t), `${t} não tem ficheiro mapeado em src/arranque.js`);
  }
  for (const t of TABELAS_COM_FICHEIRO) {
    const f = (itensDeTabelas([t])[0].como.texto.match(/orbita_[\w.]+\.sql/) || [''])[0];
    assert.ok(FICHEIROS.includes(f), `${t} aponta para ${f}, que não está na ordem de aplicação`);
  }
});

test('itensDeProntidao aguenta um payload magro sem inventar itens', () => {
  assert.deepEqual(itensDeProntidao(null), []);
  assert.deepEqual(itensDeProntidao({}), []);
  assert.deepEqual(itensDoResumo(undefined), []);
  assert.deepEqual(itensDeProntidao({ grupos: [{ id: 'x', nome: 'X', itens: [{ nome: 'Sem variável', pronto: false }] }] }).map((i) => i.variavel), [null]);
});

/* ---------- 1.64.0 · aplicar o esquema: as duas leituras ---------- */

test('a auditoria com tabelas em falta diz quantas e quais, e que nada se apaga', () => {
  const a = auditoriaLegivel({
    ok: false, modo: 'leitura', tabelas: ['orbita_leads', 'orbita_contas'],
    faltamTabelas: ['orbita_faturas'], faltamColunas: {},
  });
  assert.equal(a.estado, 'faltam-tabelas');
  assert.equal(a.ok, false);
  assert.match(a.frase, /Faltam 1 tabela da mesa \(orbita_faturas\)/);
  assert.match(a.frase, /não é apagado/);
  assert.equal(a.colunasEmFalta, 0);
});

test('a auditoria com a base sã só o diz porque a resposta lista as tabelas', () => {
  const comLista = auditoriaLegivel({ ok: true, tabelas: ['a', 'b'], faltamTabelas: [], faltamColunas: {} });
  assert.equal(comLista.estado, 'pronta');
  assert.equal(comLista.ok, true);
  assert.match(comLista.frase, /2 tabelas/);
  /* `{}` não é uma base sã: é uma resposta que não olhou para nada */
  const vazia = auditoriaLegivel({});
  assert.equal(vazia.estado, 'sem-resposta');
  assert.equal(vazia.ok, false);
  assert.match(vazia.frase, /não sei/);
  assert.equal(auditoriaLegivel(null).estado, 'sem-resposta');
  assert.equal(auditoriaLegivel([]).estado, 'sem-resposta');
});

test('as colunas em falta contam-se e nomeiam-se por tabela', () => {
  const a = auditoriaLegivel({ tabelas: ['orbita_faturas'], faltamTabelas: [], faltamColunas: { orbita_faturas: ['serie', 'numero'] } });
  assert.equal(a.estado, 'faltam-colunas');
  assert.equal(a.colunasEmFalta, 2);
  assert.match(a.frase, /2 colunas/);
  assert.match(a.frase, /orbita_faturas: serie, numero/);
});

test('aplicar: o que passou fica aplicado e o que falhou diz onde parou', () => {
  const bem = resultadoDaAplicacao({ ok: true, aplicados: ['orbita_mesa.sql', 'orbita_1_56_0.sql'], faltam: [] });
  assert.equal(bem.estado, 'aplicado');
  assert.match(bem.frase, /2 ficheiros/);
  assert.match(bem.frase, /todas as tabelas/);

  const parcial = resultadoDaAplicacao({ ok: true, aplicados: ['orbita_mesa.sql'], faltam: ['orbita_faturas'] });
  assert.equal(parcial.ok, true);
  assert.match(parcial.frase, /ainda faltam 1 tabela/);

  const mal = resultadoDaAplicacao({ ok: false, aplicados: ['orbita_mesa.sql'], erro: 'orbita_1_56_0.sql: relation "x" already exists' });
  assert.equal(mal.estado, 'parou');
  assert.match(mal.frase, /Parou depois de orbita_mesa.sql/);
  assert.match(mal.frase, /transacção/);

  /* uma resposta sem razão não pode inventar uma */
  const mudo = resultadoDaAplicacao({ ok: false });
  assert.match(mudo.frase, /não sei se a base ficou a meio/);
  assert.equal(resultadoDaAplicacao(null).estado, 'sem-resposta');
  assert.match(resultadoDaAplicacao(null).frase, /não sei/);
});

test('os erros do /api/setup dizem o que aconteceu, sem repetir o token', () => {
  assert.match(erroDoSetup(404, { error: 'não existe' }), /token/);
  /* um 404 de rota (servidor sem `/api`) não é um token errado */
  assert.match(erroDoSetup(404, { error: 'não encontrado' }), /não tem o .\/api\/setup./);
  assert.doesNotMatch(erroDoSetup(404, { error: 'não encontrado' }), /token não é/);
  assert.match(erroDoSetup(405, {}), /GET ou POST/);
  assert.match(erroDoSetup(413, {}), /grande demais/);
  assert.match(erroDoSetup(500, { erro: 'falta DATABASE_URL' }), /DATABASE_URL/);
  assert.match(erroDoSetup(500, {}), /respondeu 500 sem dizer porquê/);
  assert.equal(erroDoSetup(500, { erro: 'segredo-123' }).includes('segredo-123'), true, 'o erro do servidor não é escondido');
});

test('1.64.0 · sem sessão, cada grupo em falta traz a acção (não só o nome)', () => {
  const c = checklist({ health: HEALTH_QUEBRADO });
  const grupos = c.itens.filter((i) => i.tipo === 'grupo');
  assert.ok(grupos.length >= 3);
  const acesso = grupos.find((i) => i.grupo === 'acesso');
  assert.ok(acesso.como, 'o grupo «Acesso» sem sessão tem de dizer o que fazer');
  assert.match(acesso.como.texto, /ORBITA_API_TOKEN/);
  assert.match(acesso.como.texto, /ORBITA_ADMIN_TOKEN/);
  for (const g of grupos) assert.ok(g.como && g.como.texto, `${g.titulo} ficou sem acção`);
});

test('1.64.0 · nenhum grupo inventado na tabela de acções', () => {
  const reais = new Set(GRUPOS.map((g) => String(g.nome).toLowerCase()));
  assert.ok(ACOES_DOS_GRUPOS.length >= 6, 'a tabela não está vazia');
  for (const chave of ACOES_DOS_GRUPOS) {
    assert.ok(reais.has(chave), `«${chave}» não é um grupo de api/_prontidao.mjs`);
  }
  /* 1.79.3 · e o contrário: um grupo novo sem acção era meia resposta — «falta X» e
     nenhum sítio onde o resolver. Apanhou-se ao juntar «Correio — respostas». */
  for (const g of GRUPOS) {
    assert.ok(ACOES_DOS_GRUPOS.includes(String(g.nome).toLowerCase()),
      `o grupo «${g.nome}» não tem acção em ACAO_DO_GRUPO (src/arranque.js)`);
  }
});

test('1.66.1 · um nome quase certo vira uma peça que diz o nome certo (e manda a outra embora)', () => {
  const health = {
    ...HEALTH_QUEBRADO,
    acesso: { ORBITA_API_TOKEN: { configurado: false, curto: false }, nomesErrados: [{ encontrado: 'ORBITA_APITOKEN', devia: 'ORBITA_API_TOKEN' }] },
  };
  const c = checklist({ health });
  const peca = c.itens.find((i) => i.id === 'nome:ORBITA_APITOKEN');
  assert.ok(peca, 'a peça do nome errado tem de aparecer');
  assert.match(peca.titulo, /ORBITA_APITOKEN/);
  assert.match(peca.como.texto, /ORBITA_API_TOKEN/);
  assert.match(peca.como.nota, /Redeploy/);
  assert.equal(peca.critico, true);
  /* a peça do nome certo (a que dizia «Acesso por configurar») sai — fica a que
     explica o que corrigir; e a do nome errado vem primeiro */
  const generica = c.itens.find((i) => i.tipo === 'grupo' && i.grupo === 'acesso');
  const posNome = c.itens.findIndex((i) => i.id === 'nome:ORBITA_APITOKEN');
  if (generica) assert.ok(posNome < c.itens.indexOf(generica), 'o que corrigir vem antes do resumo do grupo');
  const doToken = c.itens.filter((i) => i.tipo === 'variavel' && i.variavel === 'ORBITA_API_TOKEN');
  assert.deepEqual(doToken.map((i) => i.id), ['nome:ORBITA_APITOKEN'],
    'a variável certa aparece uma vez, e na peça que diz o que corrigir');
  assert.ok(c.notas.some((n) => /nome quase certo/.test(n)));
});

test('1.66.1 · sem nomes errados nada muda na lista', () => {
  const a = checklist({ health: HEALTH_QUEBRADO });
  const b = checklist({ health: { ...HEALTH_QUEBRADO, acesso: { nomesErrados: [] } } });
  assert.deepEqual(a.itens.map((i) => i.id), b.itens.map((i) => i.id));
  assert.equal(itensDeNomesErrados(HEALTH_QUEBRADO).length, 0);
  assert.equal(itensDeNomesErrados(null).length, 0);
});
