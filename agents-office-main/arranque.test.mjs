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
  VARIAVEIS_CONHECIDAS, TABELAS_COM_FICHEIRO,
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
  assert.match(t.como.texto, /\/api\/setup\?token=/);
  assert.match(t.como.texto, /orbita_1_56_0\.sql/);
  assert.match(t.como.nota, /ler=1/);
  assert.match(t.porque, /fatura/);
  /* e uma tabela sem mapeamento não inventa um ficheiro: manda o esquema todo */
  const [x] = itensDeTabelas(['orbita_inventada']);
  assert.equal(x.como.texto, '/api/setup?token=<SETUP_TOKEN>');
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
  assert.match(l, /Abre no browser/);
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
    const f = itensDeTabelas([t])[0].como.texto.replace(/^.*so=/, '');
    assert.ok(FICHEIROS.includes(f), `${t} aponta para ${f}, que não está na ordem de aplicação`);
  }
});

test('itensDeProntidao aguenta um payload magro sem inventar itens', () => {
  assert.deepEqual(itensDeProntidao(null), []);
  assert.deepEqual(itensDeProntidao({}), []);
  assert.deepEqual(itensDoResumo(undefined), []);
  assert.deepEqual(itensDeProntidao({ grupos: [{ id: 'x', nome: 'X', itens: [{ nome: 'Sem variável', pronto: false }] }] }).map((i) => i.variavel), [null]);
});
