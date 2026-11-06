/* ===========================================================================
   1.54.4 · O QUE O TESTE MANUAL ENCONTROU — os testes

   Quatro correcções, cada uma com a sua prova. A regra deste ficheiro: o teste
   reproduz o que o dono viu no ecrã, não uma abstracção parecida.

   F1 · a IA a inventar — um Prompt Master da IA tem de levar SEMPRE as regras de
        honestidade à frente, e o que ela afirma sem apoio no briefing tem de
        ficar visível. Os prompts de imagem que pedem texto na imagem ou que
        apresentam a equipa como real são RECUSADOS (volta o das regras).
   F2 · as recusas perdem a frase — «Ainda não dá para gerar: HTTP 409» passa a
        trazer o motivo escrito pelo servidor.
   F3 · um projeto inexistente fazia a mesa anunciar «a base de dados não está a
        responder». Um 404 de rota ≠ um 404 de recurso.
   F4 · o servidor aceitava email/telefone/site impossíveis. Agora recusa com a
        frase que diz como corrigir.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  masterComIA, imagensComIA, montarPromptsDeImagem, montarPromptMaster,
  REGRAS_DO_MASTER, CABECA_REGRAS, blocoDeRegras, factosSuspeitos, violacoesDePrompt,
} from './api/_briefing.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { responder, validarContacto } from './api/_rotas.mjs';
import { limitador } from './api/_porta.mjs';
import { COOKIE } from './api/_conta.mjs';
import { decidirResposta, rotaAusente, mensagemDe } from './src/respostas.js';
import { vistaBriefing, estadoNovo as estadoBriefing } from './src/briefing.js';

/* 1.69.0 · a porta passou a ser de um dono só: o teste diz qual é (e abre o
   registo, porque prova papéis e não a política de entrada). */
const ENV = { SETUP_TOKEN: 'token-de-instalacao-para-teste', ORBITA_DONO_EMAIL: 'dono@orbita.pt', ORBITA_REGISTO: 'aberto' };
const SENHA = 'uma-frase-bem-comprida-2026';
const semRede = () => { throw new Error('sem rede neste teste'); };

const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: ENV, fetchImpl: semRede, ...extra,
});
const comCookie = (token) => ({ headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } });
const cookieDe = (r) => decodeURIComponent(r.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);

const CLINICA = { name: 'Clínica do Mondego', category: 'Clínica dentária', city: 'Coimbra', website: 'clinicadomondego.pt' };

const motorQueDevolve = (texto) => ({ async pedir() { return { texto, modelo: 'modelo-falso', fornec: 'falso' }; } });

const PROMPT_MASTER_INVENTADO = [
  CABECA_REGRAS.replace('Regras que não se negociam', 'Contexto da empresa'),
  'A clínica venceu o prémio nacional de clínicas dentárias em 2021 e tem 5000 clientes satisfeitos desde 1998.',
  '## Objetivo do projeto',
  'Encher a agenda com marcações por telefone, sem prometer resultados que não se possam provar.',
  '## Público-alvo',
  'Famílias de Coimbra entre os 30 e os 55 anos, que valorizam a mesma equipa de sempre.',
  '## Direção visual',
  'Clareza, hierarquia e tipografia refinada. Nada de cópia de marcas.',
  '## Quando está pronto',
  'Quando cada secção disser apenas o que o briefing sustenta.',
].join('\n\n');

/* ---------------------------------------------------------------- F1 · IA */

test('F1: o Prompt Master da IA leva SEMPRE as regras de honestidade à frente (e não as duplica)', async () => {
  const briefing = { valores: { empresa: 'Clínica do Mondego', objetivo: 'Encher a agenda' } };

  /* um modelo que devolve só o corpo, sem regras (o caso perigoso) */
  const semRegras = await masterComIA({ briefing, lead: CLINICA, base: 'x', motor: motorQueDevolve(PROMPT_MASTER_INVENTADO) });
  assert.equal(semRegras.ok, true);
  assert.ok(semRegras.texto.startsWith(CABECA_REGRAS), 'as regras vão à frente, venha o que vier');
  for (const linha of REGRAS_DO_MASTER) assert.ok(semRegras.texto.includes(linha), `falta a regra: ${linha.slice(0, 40)}`);
  assert.ok(semRegras.texto.includes('prémio nacional'), 'o corpo da IA não é alterado');

  /* um modelo que já devolve as regras: não ficam duas vezes */
  const comRegras = await masterComIA({
    briefing, lead: CLINICA, base: 'x',
    motor: motorQueDevolve(`${blocoDeRegras()}\n\n${PROMPT_MASTER_INVENTADO}`),
  });
  assert.equal(comRegras.ok, true);
  const vezes = comRegras.texto.split(CABECA_REGRAS).length - 1;
  assert.equal(vezes, 1, 'as regras aparecem uma só vez');

  /* e o caminho por regras continua a tê-las */
  const porRegras = montarPromptMaster({ briefing, lead: CLINICA });
  assert.ok(porRegras.includes(CABECA_REGRAS));
});

test('F1: o que a IA afirma sem apoio no briefing fica marcado «por confirmar» (não apagado, não escondido)', async () => {
  const briefing = { valores: { empresa: 'Clínica do Mondego', objetivo: 'Encher a agenda', descricao: 'Clínica de bairro em Coimbra.' } };
  const r = await masterComIA({ briefing, lead: CLINICA, base: 'x', motor: motorQueDevolve(PROMPT_MASTER_INVENTADO) });

  assert.ok(r.avisos.length >= 3, `esperava vários avisos, veio ${JSON.stringify(r.avisos)}`);
  const tudo = r.avisos.join(' | ');
  assert.match(tudo, /2021/);
  assert.match(tudo, /1998/);
  assert.match(tudo, /5000 clientes/);
  assert.match(r.texto, /Antes de usar — por confirmar/);
  assert.match(r.texto, /não consta do briefing/);

  /* o que o briefing sustenta não é marcado */
  const honesto = await masterComIA({
    briefing, lead: CLINICA, base: 'x',
    motor: motorQueDevolve(`${'## Contexto\nClínica de bairro em Coimbra, com três cadeiras e marca própria. '.repeat(8)}`),
  });
  assert.equal(honesto.ok, true);
  assert.deepEqual(honesto.avisos, [], 'sem invenções, sem avisos');
  assert.doesNotMatch(honesto.texto, /Antes de usar/);
});

test('F1: factosSuspeitos apanha anos, dinheiro, títulos e números — e não inventa suspeitas', () => {
  const briefing = { valores: { objetivo: 'Marcações por telefone', descricao: 'Três cadeiras, desde 2012' } };
  const achados = factosSuspeitos('Prémio em 2021, implantes a 350 €, 5000 clientes, equipa desde 2012.', briefing);
  assert.ok(achados.some((x) => /2021/.test(x)));
  assert.ok(achados.some((x) => /350/.test(x)));
  assert.ok(achados.some((x) => /5000/.test(x)));
  assert.ok(achados.some((x) => /pr[ée]mio/i.test(x)));
  assert.ok(!achados.some((x) => /2012/.test(x)), 'o ano que está no briefing não é suspeito');

  assert.deepEqual(factosSuspeitos('Marcações por telefone, três cadeiras.', briefing), []);
  assert.deepEqual(factosSuspeitos('', briefing), []);
});

test('F1: prompts de imagem que pedem texto na imagem ou a equipa «real» são RECUSADOS (volta o das regras)', async () => {
  const briefing = { valores: { empresa: 'Clínica do Mondego', setor: 'Clínica dentária', objetivo: 'Encher a agenda' } };
  const base = montarPromptsDeImagem({ briefing, lead: CLINICA });

  const comTexto = base.map((b) => ({
    finalidade: b.finalidade, local: b.local, assunto: b.assunto, composicao: b.composicao,
    direcaoArte: b.direcaoArte, formato: b.formato, restricoes: 'nenhuma',
    prompt: 'photograph of a dental clinic, with visible text on image saying PREMIADOS',
  }));
  const r1 = await imagensComIA({ briefing, lead: CLINICA, base, motor: motorQueDevolve(JSON.stringify({ prompts: comTexto })) });
  assert.equal(r1.ok, false);
  assert.equal(r1.codigo, 'regra');
  assert.match(r1.motivo, /texto/i);
  assert.ok(r1.violacoes.length >= 1);

  const equipaFalsa = base.map((b) => ({
    finalidade: b.finalidade, local: b.local,
    assunto: 'the real team of fourteen doctors of the clinic', composicao: b.composicao,
    direcaoArte: b.direcaoArte, formato: b.formato, restricoes: 'nenhuma',
    prompt: 'photograph of the real team of doctors, natural light',
  }));
  const r2 = await imagensComIA({ briefing, lead: CLINICA, base, motor: motorQueDevolve(JSON.stringify({ prompts: equipaFalsa })) });
  assert.equal(r2.ok, false);
  assert.match(r2.motivo, /reais da empresa/);

  /* um conjunto limpo passa, e as restrições do projeto não se perdem */
  const limpo = base.map((b) => ({
    finalidade: b.finalidade, local: b.local, assunto: b.assunto, composicao: b.composicao,
    direcaoArte: b.direcaoArte, formato: b.formato, restricoes: 'nenhuma',
    prompt: 'interior of a dental clinic at dawn, window light, shallow depth of field, no text in image',
  }));
  const r3 = await imagensComIA({ briefing, lead: CLINICA, base, motor: motorQueDevolve(JSON.stringify({ prompts: limpo })) });
  assert.equal(r3.ok, true);
  assert.equal(r3.prompts.length, base.length);
  assert.match(r3.prompts[0].restricoes, /sem texto na imagem|sem pessoas/i, 'as restrições do projeto sobrevivem a um «nenhuma» da IA');

  /* e a função usada por dentro diz o que está mal, com precisão */
  assert.deepEqual(violacoesDePrompt({ prompt: 'clinic interior, no text in image' }), []);
  assert.equal(violacoesDePrompt({ prompt: 'include a bold logo and lettering' }).length, 1);
});

test('F1: a rota do Prompt Master devolve os avisos para o ecrã poder mostrá-los', async () => {
  const repo = createMemRepo();
  limitador.limpar();
  const dono = await chamar(repo, '/auth/primeiro-dono', 'POST', {
    email: 'dono@orbita.pt', password: SENHA, name: 'Valdimiro', token: ENV.SETUP_TOKEN,
  }, { seguranca: true });
  const s = cookieDe(dono);
  const autorizado = { seguranca: true, ...comCookie(s) };

  await chamar(repo, '/ops/leads', 'POST', { leads: [CLINICA] }, autorizado);
  const lead = repo._dados.leads[0];
  const p = await chamar(repo, `/ops/leads/${lead.id}/projeto`, 'POST', { kind: 'landing' }, autorizado);
  const projeto = p.corpo.projeto;
  const b0 = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`, 'GET', null, autorizado);
  await chamar(repo, `/ops/projetos/${projeto.id}/briefing`, 'PUT', {
    base: b0.corpo.briefing.hash,
    valores: { ...b0.corpo.briefing.valores, objetivo: 'Encher a agenda', descricao: 'Clínica de bairro.' },
  }, autorizado);

  /* sem rede, a rota usa as regras — e a vista do ecrã mostra o Prompt Master */
  const m = await chamar(repo, `/ops/projetos/${projeto.id}/master`, 'POST', {}, autorizado);
  assert.equal(m.status, 200, JSON.stringify(m.corpo));
  assert.equal(m.corpo.via, 'regras');
  assert.deepEqual(m.corpo.avisos, [], 'o caminho por regras não tem nada por confirmar');

  const B = { ...estadoBriefing(projeto.id), aba: 'master', dados: { ...m.corpo, master: m.corpo.master } };
  /* com avisos (como se a IA tivesse escrito), o ecrã mostra o alerta */
  B.dados = { ...B.dados, master: { ...m.corpo.master, via: 'ia', avisos: ['o ano 2021 — não consta do briefing'] } };
  const html = vistaBriefing({ briefing: B }, { projeto: { name: projeto.name } });
  assert.match(html, /Por confirmar antes de usar/);
  assert.match(html, /2021/);
});

/* ---------------------------------------------------------------- F2 · frases */

test('F2: uma recusa do briefing chega ao ecrã com o motivo escrito, não com «HTTP 409»', async () => {
  const repo = createMemRepo();
  limitador.limpar();
  const dono = await chamar(repo, '/auth/primeiro-dono', 'POST', {
    email: 'dono@orbita.pt', password: SENHA, name: 'Valdimiro', token: ENV.SETUP_TOKEN,
  }, { seguranca: true });
  const autorizado = { seguranca: true, ...comCookie(cookieDe(dono)) };

  await chamar(repo, '/ops/leads', 'POST', { leads: [CLINICA] }, autorizado);
  const lead = repo._dados.leads[0];
  const p = await chamar(repo, `/ops/leads/${lead.id}/projeto`, 'POST', { kind: 'landing' }, autorizado);
  const projeto = p.corpo.projeto;

  /* briefing só com o que a ficha sustenta: não chega para o Prompt Master */
  const m = await chamar(repo, `/ops/projetos/${projeto.id}/master`, 'POST', {}, autorizado);
  assert.equal(m.status, 409);
  assert.ok(m.corpo.erro && m.corpo.error, 'a frase vem nas duas chaves (a mesa lê `error`)');
  assert.equal(m.corpo.erro, m.corpo.error);
  assert.match(m.corpo.error, /briefing guardado ainda não chega/);

  /* o que a mesa faz com este corpo, passo a passo */
  const d = decidirResposta({ httpOk: true, httpStatus: 200, envelope: { status: 409, corpo: m.corpo } });
  assert.equal(d.tipo, 'erro');
  assert.equal(d.estado, 409);
  assert.match(d.mensagem, /briefing guardado ainda não chega/);
  assert.doesNotMatch(d.mensagem, /^HTTP/);

  /* e o rascunho sem IA também traz o porquê */
  const r = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/rascunho`, 'POST', {}, autorizado);
  assert.equal(r.status, 502);
  assert.ok(r.corpo.error);
  assert.ok(!/^HTTP/.test(mensagemDe(r.corpo)));
});

/* ---------------------------------------------------------------- F3 · 404 */

test('F3: um 404 de rota cai no armazém do browser; um 404 de recurso mostra o motivo', () => {
  /* instalação antiga: a rota não existe */
  assert.equal(rotaAusente({ error: 'a base ainda não serve «/ops/projetos/p1/media»' }), true);
  assert.equal(decidirResposta({ httpOk: false, httpStatus: 404, envelope: { error: 'a base ainda não serve «/ops/x»' } }).tipo, 'local');
  assert.equal(decidirResposta({ httpOk: true, httpStatus: 200, envelope: { status: 404, corpo: { error: 'a base ainda não serve «/ops/x»' } } }).tipo, 'local');
  assert.equal(decidirResposta({ httpOk: true, httpStatus: 200, envelope: { status: 404, corpo: { rota: true, error: 'seja o que for' } } }).tipo, 'local', 'a marca `rota` chega; a frase não precisa de ser adivinhada');
  assert.equal(decidirResposta({ httpOk: false, httpStatus: 404, envelope: null }).tipo, 'local', 'sem corpo: comportamento antigo');

  /* o projeto não existe: é um erro com a frase do servidor, não um modo local */
  const d = decidirResposta({ httpOk: false, httpStatus: 404, envelope: { error: 'projeto não encontrado' } });
  assert.equal(d.tipo, 'erro');
  assert.equal(d.estado, 404);
  assert.equal(d.mensagem, 'projeto não encontrado');
  const e = decidirResposta({ httpOk: true, httpStatus: 200, envelope: { status: 404, corpo: { error: 'geração não encontrada' } } });
  assert.equal(e.tipo, 'erro');
  assert.equal(e.mensagem, 'geração não encontrada');
});

test('F3: o servidor marca o 404 de rota (e o de recurso não fica marcado)', async () => {
  const repo = createMemRepo();
  await assert.rejects(
    () => chamar(repo, '/ops/nao-existe-nada'),
    (e) => {
      assert.equal(e.status, 404);
      assert.equal(e.corpo.rota, true, 'a rota leva a marca');
      assert.match(e.corpo.error, /ainda não serve/);
      return true;
    },
  );
  await assert.rejects(
    () => chamar(repo, '/ops/projetos/p_fantasma/briefing'),
    (e) => {
      assert.equal(e.status, 404);
      assert.equal(e.corpo.rota, undefined, 'um projeto inexistente NÃO é uma rota inexistente');
      assert.equal(e.corpo.error, 'projeto não encontrado');
      return true;
    },
  );
});

/* ---------------------------------------------------------------- F4 · dados */

test('F4: o servidor recusa um contacto impossível, com a frase que diz como corrigir', () => {
  assert.deepEqual(validarContacto({}).erros, []);
  assert.deepEqual(validarContacto({ email: '', phone: '', website: '' }).limpos, { email: null, phone: null, website: null });

  assert.match(validarContacto({ email: 'nao-e-email' }).erros[0], /não parece um email/);
  assert.match(validarContacto({ phone: 'abc' }).erros[0], /letras/);
  assert.match(validarContacto({ phone: '12' }).erros[0], /6/);
  assert.match(validarContacto({ website: 'isto não é um site' }).erros[0], /espaços|não parece/);

  assert.deepEqual(validarContacto({ email: 'Geral@Clinica.pt' }).limpos, { email: 'geral@clinica.pt' });
  assert.deepEqual(validarContacto({ phone: '+351 239 111 222' }).limpos, { phone: '+351 239 111 222' });
  assert.deepEqual(validarContacto({ website: 'clinicadomondego.pt' }).limpos, { website: 'https://clinicadomondego.pt' });
  assert.deepEqual(validarContacto({ website: 'https://clinicadomondego.pt/contactos' }).limpos, { website: 'https://clinicadomondego.pt/contactos' });
});

test('F4: a rota do lead recusa o lixo e guarda o que é válido (o browser não é a única porta)', async () => {
  const repo = createMemRepo();
  await chamar(repo, '/ops/leads', 'POST', { leads: [CLINICA] });
  const lead = repo._dados.leads[0];

  for (const [campo, valor, esperado] of [
    ['email', 'nao-e-email', /não parece um email/],
    ['phone', 'abc', /letras/],
    ['website', 'isto não é um site', /espaços|não parece/],
  ]) {
    await assert.rejects(
      () => chamar(repo, `/ops/leads/${lead.id}`, 'PATCH', { [campo]: valor }),
      (e) => {
        assert.equal(e.status, 400, `${campo} devia ser recusado`);
        assert.match(e.corpo.error, esperado);
        return true;
      },
    );
    assert.notEqual(repo._dados.leads[0][campo], valor, `${campo} não pode ter ficado guardado`);
  }

  const ok = await chamar(repo, `/ops/leads/${lead.id}`, 'PATCH', { phone: '239 111 222', email: 'Geral@Clinica.pt', website: 'clinicadomondego.pt' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.lead.phone, '239 111 222');
  assert.equal(ok.corpo.lead.email, 'geral@clinica.pt');
  assert.equal(ok.corpo.lead.website, 'https://clinicadomondego.pt');

  /* e criar de raiz também passa pela mesma porta */
  await assert.rejects(
    () => chamar(repo, '/ops/leads', 'POST', { leads: [{ name: 'Oficina Alves', city: 'Leiria', phone: 'telefone da oficina' }] }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.corpo.error, /Oficina Alves: .*letras/);
      return true;
    },
  );
  assert.equal(repo._dados.leads.length, 1, 'o lead inválido não pode ter entrado');
});
