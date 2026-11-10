/* ===========================================================================
   1.82.0 · «AINDA NÃO DÁ PARA GERAR» — O QUE ESTAVA POR TRÁS (9 nov 2026)

   O dono, com o ecrã à frente:

     «Ainda não dá para gerar: o briefing guardado ainda não chega para o Prompt
      Master: precisa do nome da empresa e de pelo menos o objetivo, a descrição,
      os produtos, o público ou a proposta de valor.»

   Ele tinha o briefing preenchido. O que faltava era o **nome da empresa** — e
   não por culpa dele: um projeto criado à mão (sem lead) nunca recebia esse
   campo, porque a semente do briefing só olhava para `lead.name`. O projeto
   chamava-se «Clínica do Bairro» e o campo dizia «não informado». O gerador
   recusava para sempre, e a frase listava cinco campos de uma vez, o que se lê
   como «falta tudo».

   Aqui prova-se, pela mão do cliente (as mesmas funções que o ecrã usa) e pela
   rota HTTP, que:
     · o nome do projeto É o nome da empresa (com origem «da lead», um facto);
     · um registo antigo é curado ao abrir E antes de gerar (e fica gravado);
     · a recusa diz SÓ o que falta e viaja em `emFalta`, campo a campo;
     · o ecrã transforma cada campo em falta num atalho que abre esse campo;
     · com o mínimo cumprido, o Prompt Master sai (por regras, sem IA).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { limitador } from './api/_porta.mjs';
import { lerArquivo, CHAVE } from './api/_briefing.mjs';
import {
  estadoNovo, carregarBriefing, accaoBriefing, vistaBriefing,
  faltaParaGerar, podeGerar,
} from './src/briefing.js';

const ENV = { SETUP_TOKEN: 'token-de-instalacao-para-teste', ORBITA_DONO_EMAIL: 'dono@orbita.pt', ORBITA_REGISTO: 'aberto' };
const SENHA = 'uma-frase-bem-comprida-2026';
const semRede = () => { throw new Error('sem rede neste teste'); };
const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: ENV, fetchImpl: semRede, ...extra,
});

async function donoE(repo) {
  limitador.limpar();
  const dono = await chamar(repo, '/auth/primeiro-dono', 'POST', {
    email: 'dono@orbita.pt', password: SENHA, name: 'Valdimiro', token: ENV.SETUP_TOKEN,
  }, { seguranca: true });
  const cookie = String(dono.cabecalhos?.['Set-Cookie'] || '').split(';')[0];
  return { seguranca: true, headers: { cookie } };
}

/** O mesmo `api` que a mesa passa às acções do briefing. */
function apiDaMesa(repo, autorizado, projetoId) {
  const S = { briefing: estadoNovo(projetoId), projetoTab: 'briefing' };
  return {
    S,
    paint() {},
    toasts: [],
    toast(msg, mau) { this.toasts.push({ msg: String(msg), mau: !!mau }); },
    async call(caminho, metodo = 'GET', corpo = null) {
      const r = await chamar(repo, String(caminho), metodo, corpo, autorizado);
      if (r.status >= 400) {
        const e = new Error(r.corpo?.error || r.corpo?.erro || `HTTP ${r.status}`);
        e.status = r.status; e.codigo = r.corpo?.codigo || null; e.body = r.corpo || null;
        throw e;
      }
      return r.corpo;
    },
  };
}

/* ---------------------------------------------------------------- 1 · a causa */

test('1.82.0 · um projeto criado à mão já abre com o nome dele no campo da empresa', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Clínica do Bairro', niche: 'Clínica dentária', kind: 'site' }, aut);
  const id = p.corpo.projeto.id;

  const b = await chamar(repo, `/ops/projetos/${id}/briefing`, 'GET', null, aut);
  assert.equal(b.status, 200);
  assert.equal(b.corpo.briefing.valores.empresa, 'Clínica do Bairro', 'o nome do projeto é um facto, não uma invenção');
  assert.equal(b.corpo.briefing.valores.setor, 'Clínica dentária');
  assert.equal(b.corpo.briefing.origens.empresa, 'lead', 'a origem continua a ser a ficha — não «escrito por ti»');
});

test('1.82.0 · o ecrã do projeto à mão: preencher, gravar e gerar — de ponta a ponta', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Clínica do Bairro', niche: 'Clínica dentária' }, aut);
  const id = p.corpo.projeto.id;
  const api = apiDaMesa(repo, aut, id);

  await carregarBriefing(api, id, { forcar: true });
  const B = api.S.briefing;
  assert.equal(B.valores.empresa, 'Clínica do Bairro');

  /* o dono escreve a matéria (uma frase chega) e grava */
  B.valores = { ...B.valores, objetivo: 'Encher a agenda de marcações' };
  B.sujo = true;
  await accaoBriefing('bf-guardar', null, api);
  assert.equal(B.sujo, false);
  assert.equal(B.dados.briefing.valores.objetivo, 'Encher a agenda de marcações');

  /* e gera: o Prompt Master sai por regras, com o nome da empresa lá dentro */
  await accaoBriefing('bf-master', null, api);
  assert.ok(B.dados.master, `sem Prompt Master: ${JSON.stringify(B.aviso)}`);
  assert.equal(B.dados.master.via, 'regras');
  assert.match(B.dados.master.texto, /Clínica do Bairro/);
  assert.deepEqual(B.emFalta, [], 'o ecrã limpa a lista do que falta quando consegue');
});

/* ------------------------------------------------------- 2 · o registo antigo */

test('1.82.0 · um briefing gravado vazio (dados antigos) é curado antes de gerar', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Oficina Alves', niche: 'Oficina automóvel' }, aut);
  const id = p.corpo.projeto.id;

  /* o estado em que o dono está: um registo já gravado, com empresa e setor vazios */
  await repo.ia.config.gravar(CHAVE, {
    versao: 1,
    projetos: {
      [id]: {
        projetoId: id, leadId: null, leadNome: 'Oficina Alves', criado: '2026-11-01T10:00:00.000Z', actualizado: '2026-11-01T10:00:00.000Z',
        briefing: { valores: { empresa: '', setor: '', objetivo: 'Receber pedidos de orçamento' }, origens: {}, gravadoEm: '2026-11-01T10:00:00.000Z', por: 'mesa' },
        master: null, masterHistorico: [], imagens: null, imagensHistorico: [], historico: [],
      },
    },
  });

  /* a leitura mostra o nome do projeto (sem escrever nada) */
  const antes = await lerArquivo(repo);
  assert.equal(antes.projetos[id].briefing.valores.empresa, '', 'o arquivo em si ainda não foi tocado');
  const b = await chamar(repo, `/ops/projetos/${id}/briefing`, 'GET', null, aut);
  assert.equal(b.corpo.briefing.valores.empresa, 'Oficina Alves');

  /* e gerar funciona — e o registo fica curado na base, não só no ecrã */
  const m = await chamar(repo, `/ops/projetos/${id}/master`, 'POST', {}, aut);
  assert.equal(m.status, 200, JSON.stringify(m.corpo));
  assert.match(m.corpo.master.texto, /Oficina Alves/);
  const depois = await lerArquivo(repo);
  assert.equal(depois.projetos[id].briefing.valores.empresa, 'Oficina Alves');
  assert.equal(depois.projetos[id].briefing.origens.empresa, 'lead', 'a cura não inventa autoria');
  assert.equal(depois.projetos[id].briefing.valores.objetivo, 'Receber pedidos de orçamento', 'o que a pessoa escreveu não é tocado');
});

/* ------------------------------------------------- 3 · a recusa, campo a campo */

test('1.82.0 · sem nome nenhum, a recusa fala SÓ do nome (e diz onde está o campo)', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  /* um projeto a que ninguém deu nome — a rota recusa criar um, por isso simula-se
     aqui uma linha antiga (o caso em que a frase do servidor é o único caminho) */
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Sem nome', kind: 'site' }, aut);
  const id = p.corpo.projeto.id;
  const linha = repo._dados.projetos.find((x) => x.id === id);
  linha.name = ''; linha.client = ''; linha.niche = '';
  await chamar(repo, `/ops/projetos/${id}/briefing`, 'PUT', { valores: { objetivo: 'Vender mais' } }, aut);

  const m = await chamar(repo, `/ops/projetos/${id}/master`, 'POST', {}, aut);
  assert.equal(m.status, 409);
  assert.deepEqual(m.corpo.faltaParaGerar, ['empresa']);
  assert.match(m.corpo.error, /briefing guardado ainda não chega para o Prompt Master/);
  assert.match(m.corpo.error, /falta o nome da empresa \(campo «Nome da empresa ou marca»\)/);
  assert.doesNotMatch(m.corpo.error, /objetivo, descrição, produtos/, 'não se pede matéria que já está lá');

  /* com o nome escrito à mão, o mesmo pedido passa */
  await chamar(repo, `/ops/projetos/${id}/briefing`, 'PUT', { valores: { empresa: 'Marca Nova', objetivo: 'Vender mais' } }, aut);
  const ok = await chamar(repo, `/ops/projetos/${id}/master`, 'POST', {}, aut);
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
});

test('1.82.0 · com nome e sem matéria, a recusa pede UMA das cinco — não as cinco', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Casa Verde', kind: 'site' }, aut);
  const id = p.corpo.projeto.id;

  const m = await chamar(repo, `/ops/projetos/${id}/master`, 'POST', {}, aut);
  assert.equal(m.status, 409);
  assert.deepEqual(m.corpo.faltaParaGerar, ['objetivo', 'descricao', 'produtos', 'publico', 'valor']);
  assert.match(m.corpo.error, /falta pelo menos um destes/);
  assert.doesNotMatch(m.corpo.error, /nome da empresa/, 'o nome já está no briefing: não se pede duas vezes');

  /* uma frase num só campo desbloqueia tudo */
  await chamar(repo, `/ops/projetos/${id}/briefing`, 'PUT', { valores: { empresa: 'Casa Verde', valor: 'Obras com preço fechado' } }, aut);
  const ok = await chamar(repo, `/ops/projetos/${id}/master`, 'POST', {}, aut);
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
});

test('1.82.0 · o ecrã marca no formulário os campos que o servidor disse faltarem', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Casa Verde' }, aut);
  const id = p.corpo.projeto.id;
  const api = apiDaMesa(repo, aut, id);
  await carregarBriefing(api, id, { forcar: true });

  await accaoBriefing('bf-master', null, api);
  const B = api.S.briefing;
  assert.equal(B.dados?.master, null, 'não inventou um Prompt Master');
  assert.deepEqual(B.emFalta, ['objetivo', 'descricao', 'produtos', 'publico', 'valor']);
  assert.match(B.aviso.texto, /Ainda não dá para gerar: /);

  const html = vistaBriefing({ briefing: B }, { projeto: { name: 'Casa Verde' } });
  assert.match(html, /Ainda não dá para gerar o Prompt Master/);
  assert.match(html, /data-act="bf-ir" data-campo="objetivo"/, 'cada campo em falta é um atalho');
  assert.match(html, /uma só<\/b> destas cinco/, 'a regra dita em português');
  assert.doesNotMatch(html, /data-act="bf-ir" data-campo="empresa"/, 'o nome já está: não se pede outra vez (o campo do formulário continua lá, o atalho é que não)');

  /* o atalho abre o formulário (e no projeto, muda a aba dele) */
  api.S.projetoTab = 'master';
  await accaoBriefing('bf-ir', { dataset: { campo: 'objetivo' } }, api);
  assert.equal(api.S.briefing.aba, 'briefing');
  assert.equal(api.S.projetoTab, 'briefing', 'o atalho muda a aba da página do projeto, não só o estado interno');
});

test('1.82.0 · a regra do ecrã é a mesma do servidor (nome + uma matéria)', () => {
  assert.deepEqual(faltaParaGerar({}), ['empresa', 'objetivo', 'descricao', 'produtos', 'publico', 'valor']);
  assert.deepEqual(faltaParaGerar({ empresa: 'X' }), ['objetivo', 'descricao', 'produtos', 'publico', 'valor']);
  assert.deepEqual(faltaParaGerar({ objetivo: 'Y' }), ['empresa']);
  assert.equal(podeGerar({ empresa: 'X', produtos: 'Z' }), true);
  assert.equal(podeGerar({ empresa: '   ', produtos: 'Z' }), false, 'espaços não são um nome');
});

/* -------------------------------------------------------- 4 · as imagens também */

test('1.82.0 · os prompts de imagem dizem o que falta com as palavras deles', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Casa Verde' }, aut);
  const id = p.corpo.projeto.id;
  const m = await chamar(repo, `/ops/projetos/${id}/imagens`, 'POST', {}, aut);
  assert.equal(m.status, 409);
  assert.deepEqual(m.corpo.faltaParaGerar, ['objetivo', 'descricao', 'produtos', 'publico', 'valor']);
  assert.match(m.corpo.error, /uma frase sobre o que ela vende/);
});

test('1.82.0 · carregar em «Gerar» com o briefing por gravar não é um ecrã parado', async () => {
  const repo = createMemRepo();
  const aut = await donoE(repo);
  const p = await chamar(repo, '/ops/projetos', 'POST', { name: 'Casa Verde' }, aut);
  const id = p.corpo.projeto.id;
  const api = apiDaMesa(repo, aut, id);
  await carregarBriefing(api, id, { forcar: true });
  const B = api.S.briefing;

  B.valores = { ...B.valores, objetivo: 'Vender mais' };
  B.sujo = true;
  await accaoBriefing('bf-master', null, api);

  assert.equal(B.dados?.master, null, 'não gerou a partir de texto que ninguém confirmou');
  assert.match(B.aviso.texto, /alterações por gravar/);
  assert.match(B.aviso.texto, /«Salvar»/, 'diz onde está a saída');
  assert.equal(B.aviso.mau, true);
});
