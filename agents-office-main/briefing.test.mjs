/* ===========================================================================
   1.54.2 · O BRIEFING DE UM PROJETO — os testes

   O que aqui se prova, e que é o pedido do dono:
     · iniciar um projeto a partir de uma lead NÃO duplica o projeto dela, e o
       briefing nasce com o que a ficha sustenta (e só isso);
     · cada campo diz a sua origem: da lead, sugerido pela IA, escrito por ti —
       e um campo sem informação fica «não informado», não inventado;
     · gravar volta a ler igual; gravar por cima de outra pessoa dá 409;
     · o Prompt Master e os prompts de imagem saem do briefing GUARDADO;
     · regenerar não apaga — a versão anterior fica no histórico e pode repor-se;
     · se o briefing mudar, os prompts ficam marcados como desactualizados;
     · sem IA, a versão por regras aparece COM o motivo (nunca a fingir de IA);
     · um leitor não escreve (o servidor recusa, não é só esconder o botão);
     · um projeto não vê o briefing de outro.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CAMPOS, CAMPO_IDS, CHAVE, MAX_TEXTO, briefingVazio, daLead, normalizarValores, normalizarOrigens,
  origensDe, hashBriefing, contarPreenchidos, camposEmFalta, montarPromptMaster, montarPromptsDeImagem,
  promptsEmTexto, lerJSON, rascunhoComIA, masterComIA, imagensComIA, lerArquivo,
} from './api/_briefing.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { limitador } from './api/_porta.mjs';
import { COOKIE } from './api/_conta.mjs';
import {
  estadoNovo, carregarBriefing, vistaBriefing, accaoBriefing, resumoOrigens, rotuloOrigem,
  podeGerar, podeSair,
} from './src/briefing.js';

/* 1.69.0 · a entrada passou a ser de um dono só. Estes testes provam papéis
   (leitor, operador…), por isso dizem qual é o dono e abrem o registo —
   o comportamento por omissão prova-se em `entrada.test.mjs`. */
const ENV = { SETUP_TOKEN: 'token-de-instalacao-para-teste', ORBITA_DONO_EMAIL: 'dono@orbita.pt', ORBITA_REGISTO: 'aberto' };
const SENHA = 'uma-frase-bem-comprida-2026';

/* rede fechada: nenhuma rota destes testes pode ir falar com um fornecedor de IA */
const semRede = () => { throw new Error('sem rede neste teste'); };

const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: ENV, fetchImpl: semRede, ...extra,
});

const comCookie = (token) => ({ headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } });

const CLINICA = {
  name: 'Clínica do Mondego', category: 'Clínica dentária', city: 'Coimbra',
  website: 'clinicadomondego.pt', phone: '239000000',
};
const OFICINA = { name: 'Oficina Alves', category: 'Oficina automóvel', city: 'Leiria' };

async function leadComProjeto(repo, dados = CLINICA, { kind = 'landing' } = {}) {
  await chamar(repo, '/ops/leads', 'POST', { leads: [dados] });
  const lead = repo._dados.leads[repo._dados.leads.length - 1];
  const r = await chamar(repo, `/ops/leads/${lead.id}/projeto`, 'POST', { kind });
  return { lead, projeto: r.corpo.projeto, resposta: r };
}

const guardar = (repo, projetoId, valores, base = null) => chamar(repo, `/ops/projetos/${projetoId}/briefing`, 'PUT', { valores, base });

/* ------------------------------------------------------------------ campos */

test('briefing: quinze campos, cada um com a sua origem declarada', () => {
  assert.equal(CAMPOS.length, 15);
  assert.equal(new Set(CAMPO_IDS).size, 15);
  for (const c of CAMPOS) {
    assert.ok(c.id && c.label && c.ajuda, `campo sem rótulo ou ajuda: ${c.id}`);
    assert.ok(['curto', 'longo'].includes(c.tipo), `tipo inválido em ${c.id}`);
    assert.ok(['lead', 'ia', 'manual'].includes(c.de), `origem inválida em ${c.id}`);
  }
  /* os nomes do pedido: empresa, setor, público, objetivo, tom, referências,
     páginas, funcionalidades, chamada à acção, restrições */
  for (const id of ['empresa', 'setor', 'descricao', 'produtos', 'publico', 'objetivo', 'valor', 'tom',
    'identidade', 'direcaoVisual', 'referencias', 'paginas', 'funcionalidades', 'cta', 'restricoes']) {
    assert.ok(CAMPO_IDS.includes(id), `falta o campo ${id}`);
  }
});

test('briefing: da lead só entra o que a ficha diz — e diz-se que a identidade não foi avaliada', () => {
  const b = daLead(CLINICA);
  assert.equal(b.valores.empresa, 'Clínica do Mondego');
  assert.equal(b.valores.setor, 'Clínica dentária');
  assert.equal(b.origens.empresa, 'lead');
  assert.match(b.valores.identidade, /clinicadomondego\.pt/);
  assert.match(b.valores.identidade, /tem de ser avaliada/, 'sem material não se afirma identidade visual');
  for (const vazio of ['descricao', 'produtos', 'publico', 'objetivo', 'valor', 'tom', 'direcaoVisual', 'referencias', 'paginas', 'funcionalidades', 'cta', 'restricoes']) {
    assert.equal(b.valores[vazio], '', `«${vazio}» foi inventado a partir da ficha`);
    assert.equal(b.origens[vazio], undefined);
  }
  const semSite = daLead(OFICINA);
  assert.equal(semSite.valores.identidade, '', 'sem site não há nada a dizer sobre a identidade');
});

test('briefing: validar o que vem do cliente — só campos conhecidos, texto, com tecto', () => {
  const { valores, ignorados } = normalizarValores({
    empresa: '  Nova Marca  ', objetivo: 'x'.repeat(MAX_TEXTO + 500), intruso: 'não entra',
    produtos: { mau: 'objeto' }, cta: null, paginas: 'a\nb',
  });
  assert.equal(valores.empresa, 'Nova Marca');
  assert.equal(valores.objetivo.length, MAX_TEXTO);
  assert.equal(valores.produtos, '');
  assert.equal(valores.cta, '');
  assert.equal(valores.paginas, 'a\nb');
  assert.deepEqual(ignorados.sort(), ['intruso', 'produtos']);
  assert.deepEqual(normalizarOrigens({ empresa: 'lead', setor: 'inventado' }), { empresa: 'lead' });
});

test('briefing: o que uma pessoa mudou é sempre «manual», mesmo que a IA o tivesse escrito', () => {
  const antes = { empresa: 'Clínica do Mondego', tom: 'próximo' };
  const origens = origensDe({ empresa: 'Clínica do Mondego', tom: 'sóbrio' }, antes, {}, { empresa: 'lead', tom: 'ia' });
  assert.equal(origens.empresa, 'lead', 'o que não mudou mantém a origem');
  assert.equal(origens.tom, 'manual', 'o que mudou agora foi uma pessoa');
  assert.equal(origensDe({ empresa: 'X' }, { empresa: 'X' }, { empresa: 'ia' }).empresa, 'ia');
});

test('briefing: o hash muda com o conteúdo — é ele que avisa «desactualizado»', () => {
  const a = { valores: { empresa: 'A', objetivo: 'encher a agenda' } };
  const b = { valores: { empresa: 'A', objetivo: 'encher a agenda de setembro' } };
  assert.equal(hashBriefing(a), hashBriefing({ valores: { ...a.valores } }));
  assert.notEqual(hashBriefing(a), hashBriefing(b));
  assert.equal(hashBriefing(briefingVazio()), hashBriefing(briefingVazio()));
  assert.equal(contarPreenchidos(a), 2);
  assert.ok(camposEmFalta(a).includes('publico'));
});

/* -------------------------------------------------- iniciar projeto (rota) */

test('iniciar projeto: cria, abre o briefing com a ficha, e não duplica o projeto da lead', async () => {
  const repo = createMemRepo();
  const { lead, projeto, resposta } = await leadComProjeto(repo);
  assert.equal(resposta.status, 201);
  assert.equal(resposta.corpo.existente, false);
  assert.equal(projeto.lead_id, lead.id);
  assert.equal(projeto.name, 'Clínica do Mondego');
  assert.equal(resposta.corpo.briefing.briefing.valores.empresa, 'Clínica do Mondego');
  assert.equal(resposta.corpo.briefing.briefing.valores.setor, 'Clínica dentária');

  /* segunda vez: abre o mesmo */
  const outra = await chamar(repo, `/ops/leads/${lead.id}/projeto`, 'POST', { kind: 'landing' });
  assert.equal(outra.status, 200);
  assert.equal(outra.corpo.existente, true);
  assert.equal(outra.corpo.projeto.id, projeto.id);
  assert.equal(repo._dados.projetos.length, 1, 'uma lead, um projeto');

  /* e só quem pede explicitamente um segundo é que o tem */
  const segundo = await chamar(repo, `/ops/leads/${lead.id}/projeto`, 'POST', { kind: 'site', novo: true });
  assert.equal(segundo.status, 201);
  assert.equal(repo._dados.projetos.length, 2);
});

test('briefing guardado na base: ler, gravar, e gravar por cima de outra pessoa dá 409', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  assert.equal(lido.status, 200);
  assert.equal(lido.corpo.ok, true);
  assert.equal(lido.corpo.campos.length, 15);
  assert.equal(lido.corpo.preenchidos, 3, 'empresa, setor e a nota do site');
  assert.ok(lido.corpo.emFalta.includes('objetivo'));
  assert.equal(lido.corpo.master, null);
  assert.equal(lido.corpo.desactualizado.master, false);

  const valores = { ...lido.corpo.briefing.valores, objetivo: 'Encher a agenda de Setembro', cta: 'Marcar consulta' };
  const g = await guardar(repo, projeto.id, valores, lido.corpo.briefing.hash);
  assert.equal(g.status, 200);
  assert.equal(g.corpo.briefing.valores.objetivo, 'Encher a agenda de Setembro');
  assert.equal(g.corpo.briefing.origens.objetivo, 'manual');
  assert.equal(g.corpo.briefing.origens.empresa, 'lead');

  /* o hash antigo já não vale: alguém gravou entretanto */
  const velho = await guardar(repo, projeto.id, { empresa: 'Outra Coisa' }, lido.corpo.briefing.hash);
  assert.equal(velho.status, 409);
  assert.equal(velho.corpo.codigo, 'conflito');
  assert.match(velho.corpo.erro, /mudou desde que o abriste/);
  assert.equal((await chamar(repo, `/ops/projetos/${projeto.id}/briefing`)).corpo.briefing.valores.empresa, 'Clínica do Mondego');

  /* projeto que não existe: 404, não um briefing vazio */
  await assert.rejects(() => chamar(repo, '/ops/projetos/p_inexistente/briefing'), (e) => e.status === 404);
});

test('o Prompt Master sai do briefing GUARDADO — não do que está a ser escrito', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  const guardado = await guardar(repo, projeto.id, {
    ...lido.corpo.briefing.valores,
    objetivo: 'Encher a agenda de Setembro',
    publico: 'famílias de Coimbra',
    cta: 'Marcar consulta',
  });

  const m = await chamar(repo, `/ops/projetos/${projeto.id}/master`, 'POST', {});
  assert.equal(m.status, 200);
  assert.equal(m.corpo.ok, true);
  assert.equal(m.corpo.via, 'regras', 'sem rede não há IA — e o servidor diz isso');
  assert.ok(m.corpo.motivo && m.corpo.motivo.length > 10, 'o motivo da falta de IA tem de vir escrito');
  const texto = m.corpo.master.texto;
  assert.match(texto, /Encher a agenda de Setembro/);
  assert.match(texto, /famílias de Coimbra/);
  assert.match(texto, /Marcar consulta/);
  assert.match(texto, /não informado/, 'o que falta diz-se que falta');
  assert.match(texto, /não inventes/i);
  assert.match(texto, /Apple/, 'a inspiração é declarada, e a cópia é proibida');
  assert.equal(m.corpo.master.base, guardado.corpo.briefing.hash);

  /* um briefing vazio não gera um prompt master de coisa nenhuma */
  const repo2 = createMemRepo();
  await chamar(repo2, '/ops/projetos', 'POST', { name: 'Sem dados' });
  const vazio = await chamar(repo2, `/ops/projetos/${repo2._dados.projetos[0].id}/master`, 'POST', {});
  assert.equal(vazio.status, 409);
  assert.equal(vazio.corpo.codigo, 'briefing-vazio');
});

test('reescrever as sugestões da IA não toca no que uma pessoa escreveu', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  /* a empresa veio da lead; o objetivo foi escrito por uma pessoa */
  await guardar(repo, projeto.id, { ...lido.corpo.briefing.valores, objetivo: 'Escrito à mão, fica' });

  /* a rota pede a IA: aqui não há rede, e é o servidor que decide o que fazer */
  const r = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/rascunho`, 'POST', { substituir: true });
  assert.equal(r.status, 502);
  const depois = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  assert.equal(depois.corpo.briefing.valores.objetivo, 'Escrito à mão, fica');
  assert.equal(depois.corpo.briefing.origens.objetivo, 'manual');
});

test('regenerar não apaga: a versão anterior fica no histórico e pode ser reposta', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  await guardar(repo, projeto.id, { ...lido.corpo.briefing.valores, objetivo: 'Primeira versão do objetivo' });

  const um = await chamar(repo, `/ops/projetos/${projeto.id}/master`, 'POST', {});
  const dois = await chamar(repo, `/ops/projetos/${projeto.id}/master`, 'POST', {});
  assert.equal(dois.corpo.versoes.master, 1, 'a versão anterior fica guardada');
  assert.equal(um.corpo.master.id === dois.corpo.master.id, false);

  const versoes = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/versoes`);
  assert.equal(versoes.status, 200);
  assert.equal(versoes.corpo.master.length, 1);
  assert.ok(versoes.corpo.master[0].texto.includes('Primeira versão do objetivo'));
  assert.equal(versoes.corpo.nota.includes('nunca são apagadas'), true);

  const reposto = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/restaurar`, 'POST', {
    tipo: 'master', id: versoes.corpo.master[0].id,
  });
  assert.equal(reposto.status, 200);
  assert.equal(reposto.corpo.master.id, versoes.corpo.master[0].id);
  /* a que estava no lugar não desapareceu: passou para o histórico */
  const depois = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/versoes`);
  assert.equal(depois.corpo.master.length, 1);
  assert.equal(depois.corpo.master[0].id, dois.corpo.master.id);
  const inexistente = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/restaurar`, 'POST', { tipo: 'master', id: 'm_nao_existe' });
  assert.equal(inexistente.status, 404);
});

test('editar o briefing depois de gerar marca o Prompt Master e as imagens como desactualizados', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  await guardar(repo, projeto.id, { ...lido.corpo.briefing.valores, objetivo: 'Encher a agenda' });
  await chamar(repo, `/ops/projetos/${projeto.id}/master`, 'POST', {});
  await chamar(repo, `/ops/projetos/${projeto.id}/imagens`, 'POST', {});

  const antes = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  assert.deepEqual(antes.corpo.desactualizado, { master: false, imagens: false });

  await guardar(repo, projeto.id, { ...antes.corpo.briefing.valores, objetivo: 'Vender limpezas dentárias' });
  const depois = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  assert.deepEqual(depois.corpo.desactualizado, { master: true, imagens: true },
    'o briefing mudou: os prompts podem estar velhos, e a interface tem de o poder dizer');
});

test('prompts de imagem: quatro finalidades, forma de uso, formato e a nota de «conceito»', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  await guardar(repo, projeto.id, { ...lido.corpo.briefing.valores, objetivo: 'Encher a agenda', produtos: 'limpezas e implantes', publico: 'famílias' });

  const r = await chamar(repo, `/ops/projetos/${projeto.id}/imagens`, 'POST', {});
  assert.equal(r.status, 200);
  assert.equal(r.corpo.via, 'regras');
  const prompts = r.corpo.imagens.prompts;
  assert.equal(prompts.length, 4);
  assert.deepEqual(prompts.map((p) => p.id), ['principal', 'produto', 'institucional', 'apoio']);
  for (const p of prompts) {
    assert.ok(p.finalidade && p.local, `${p.id}: falta finalidade ou local`);
    assert.ok(p.assunto && p.composicao && p.direcaoArte, `${p.id}: falta assunto/composição/direção`);
    assert.match(p.formato, /\d+:\d+/, `${p.id}: falta proporção`);
    assert.match(p.restricoes, /sem texto/, `${p.id}: a ausência de texto tem de estar escrita`);
    assert.ok(p.prompt.length > 60, `${p.id}: prompt curto demais`);
    assert.equal(p.dataUrl, undefined, 'não se geram imagens nesta etapa');
  }
  const institucional = prompts.find((p) => p.id === 'institucional');
  assert.match(institucional.nota, /NÃO usar como fotografia da equipa/);
  assert.match(institucional.nota, /conceito/);
  assert.equal(r.corpo.imagens.nota, 'estes são prompts; nenhuma imagem é gerada nesta etapa');

  const texto = promptsEmTexto(prompts, { empresa: 'Clínica do Mondego' });
  assert.match(texto, /PROMPTS DE IMAGEM — Clínica do Mondego/);
  assert.equal(texto.split('Prompt:').length - 1, 4);

  /* regenerar sem mudar o briefing: mesmo conteúdo, versão nova guardada */
  const outra = await chamar(repo, `/ops/projetos/${projeto.id}/imagens`, 'POST', {});
  assert.equal(outra.corpo.versoes.imagens, 1, 'a geração anterior fica no histórico');
  assert.equal(outra.corpo.imagens.prompts[0].prompt, prompts[0].prompt);
});

test('a IA não respondeu: o projeto continua acessível, o motivo é dito, e a nova tentativa é possível', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  await guardar(repo, projeto.id, { ...lido.corpo.briefing.valores, objetivo: 'Encher a agenda' });

  const r = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/rascunho`, 'POST', {});
  assert.equal(r.status, 502, 'sem IA, o rascunho não se finge');
  assert.equal(r.corpo.ok, false);
  assert.match(r.corpo.dica, /escrever o briefing à mão/);

  /* o briefing e o projeto continuam lá */
  const continua = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`);
  assert.equal(continua.status, 200);
  assert.equal(continua.corpo.briefing.valores.objetivo, 'Encher a agenda');

  /* a segunda tentativa é um pedido novo, não um estado perdido */
  const outra = await chamar(repo, `/ops/projetos/${projeto.id}/briefing/rascunho`, 'POST', {});
  assert.equal(outra.status, 502);
});

/* -------------------------------------------------------------------- IA */

const motorFalso = (resposta) => ({
  pedir: async (tipo, mensagens, opcoes) => {
    motorFalso.ultimo = { tipo, mensagens, opcoes };
    if (typeof resposta === 'function') return resposta(tipo, mensagens, opcoes);
    return resposta;
  },
});

test('rascunho da IA: só campos pedidos, só texto, e «vazio» quando não sabe', async () => {
  const briefing = { valores: { empresa: 'Clínica do Mondego', objetivo: '' }, origens: { empresa: 'lead' } };
  const motor = motorFalso({
    texto: '```json\n{"objetivo":"Encher a agenda de Setembro","publico":"","intruso":"não entra","tom":{"mau":1}}\n```',
    modelo: 'modelo-de-teste', fornec: 'stub',
  });
  const r = await rascunhoComIA({ lead: CLINICA, briefing, motor, campos: ['objetivo', 'publico'] });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'ia');
  assert.deepEqual(Object.keys(r.valores), ['objetivo'], 'campos vazios e desconhecidos não entram');
  assert.equal(r.valores.objetivo, 'Encher a agenda de Setembro');
  assert.equal(r.modelo, 'modelo-de-teste');
  /* a ficha da lead vai no pedido, e as regras de honestidade também */
  const pedido = motorFalso.ultimo.mensagens.map((m) => m.content).join('\n');
  assert.match(pedido, /Clínica do Mondego/);
  assert.match(pedido, /Não inventes números/);
  assert.match(pedido, /"objetivo"/);
});

test('rascunho da IA: resposta ilegível ou toda vazia não passa por rascunho', async () => {
  const mal = await rascunhoComIA({ lead: CLINICA, briefing: briefingVazio(), motor: motorFalso({ texto: 'desculpa, não sei' }), campos: ['objetivo'] });
  assert.equal(mal.ok, false);
  assert.equal(mal.codigo, 'resposta-invalida');
  const nada = await rascunhoComIA({ lead: CLINICA, briefing: briefingVazio(), motor: motorFalso({ texto: '{"objetivo":""}' }), campos: ['objetivo'] });
  assert.equal(nada.ok, false);
  assert.equal(nada.codigo, 'vazio');
  const semMotor = await rascunhoComIA({ lead: CLINICA, briefing: briefingVazio(), motor: null });
  assert.equal(semMotor.ok, false);
  assert.equal(semMotor.codigo, 'semmotor');
});

test('Prompt Master pela IA: texto curto ou vazio é recusado, e a razão vem escrita', async () => {
  const briefing = { valores: { empresa: 'Clínica do Mondego', objetivo: 'Encher a agenda' } };
  const curto = await masterComIA({ briefing, lead: CLINICA, base: 'x', motor: motorFalso({ texto: 'muito curto', modelo: 'm' }) });
  assert.equal(curto.ok, false);
  assert.equal(curto.codigo, 'resposta-curta');
  const bom = await masterComIA({ briefing, lead: CLINICA, base: 'x', motor: motorFalso({ texto: 'A'.repeat(900), modelo: 'm', fornec: 'stub' }) });
  assert.equal(bom.ok, true);
  /* 1.54.4 · o texto da IA passa a levar SEMPRE as regras de honestidade à
     frente: antes, o documento da IA substituía o das regras e levava consigo a
     única defesa escrita contra factos inventados */
  assert.ok(bom.texto.startsWith('## 0. Regras que não se negociam'), 'as regras têm de ir à frente');
  assert.ok(bom.texto.includes('A'.repeat(900)), 'o texto da IA fica inteiro');
  assert.ok(bom.texto.length > 900);
  const semMotor = await masterComIA({ briefing, motor: null });
  assert.equal(semMotor.codigo, 'semmotor');
});

test('prompts de imagem pela IA: o formato é validado contra o conjunto das regras', async () => {
  const briefing = { valores: { empresa: 'Clínica do Mondego', setor: 'Clínica dentária', objetivo: 'Encher a agenda' } };
  const base = montarPromptsDeImagem({ briefing, lead: CLINICA });
  const json = JSON.stringify({
    prompts: base.map((b, i) => ({
      finalidade: b.finalidade, local: b.local,
      assunto: `assunto ${i}`, composicao: 'composição', direcaoArte: 'direção', formato: b.formato,
      restricoes: 'sem texto na imagem', prompt: `Editorial photograph number ${i}, natural light, no text in the image.`,
    })),
  });
  const ok = await imagensComIA({ briefing, base, motor: motorFalso({ texto: json, modelo: 'visao' }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.prompts.length, 4);
  assert.equal(ok.prompts[0].assunto, 'assunto 0');
  assert.match(ok.prompts[1].prompt, /number 1/);
  /* a nota de conceito das regras não é substituída pela IA */
  assert.match(ok.prompts[2].nota, /NÃO usar como fotografia da equipa/);

  const incompleto = await imagensComIA({ briefing, base, motor: motorFalso({ texto: JSON.stringify({ prompts: [{ prompt: 'só um' }] }) }) });
  assert.equal(incompleto.ok, false);
  assert.equal(incompleto.codigo, 'resposta-incompleta');
});

/* --------------------------------------------------------------- arquivo */

test('arquivo: um projeto não vê o briefing de outro, e o arquivo fica numa chave só', async () => {
  const repo = createMemRepo();
  const a = await leadComProjeto(repo, CLINICA);
  const b = await leadComProjeto(repo, OFICINA, { kind: 'site' });

  const la = await chamar(repo, `/ops/projetos/${a.projeto.id}/briefing`);
  const lb = await chamar(repo, `/ops/projetos/${b.projeto.id}/briefing`);
  assert.equal(la.corpo.briefing.valores.empresa, 'Clínica do Mondego');
  assert.equal(lb.corpo.briefing.valores.empresa, 'Oficina Alves');
  assert.equal(la.corpo.leadId, a.lead.id);
  assert.equal(lb.corpo.leadId, b.lead.id);

  await guardar(repo, a.projeto.id, { ...la.corpo.briefing.valores, objetivo: 'Plano da clínica' });
  const master = await chamar(repo, `/ops/projetos/${a.projeto.id}/master`, 'POST', {});
  assert.match(master.corpo.master.texto, /Plano da clínica/);
  const doB = await chamar(repo, `/ops/projetos/${b.projeto.id}/briefing`);
  assert.equal(doB.corpo.master, null, 'o Prompt Master de A não aparece em B');
  assert.equal(doB.corpo.briefing.valores.objetivo, '', 'nem o objetivo');

  const arquivo = await lerArquivo(repo);
  assert.ok(arquivo.projetos[a.projeto.id]);
  assert.ok(arquivo.projetos[b.projeto.id]);
  assert.equal(Object.keys(repo._dados.iaConfig).includes(CHAVE), true);
});

/* ---------------------------------------------------------- permissões */

async function comDono(repo) {
  limitador.limpar();
  const r = await chamar(repo, '/auth/primeiro-dono', 'POST', {
    email: 'dono@orbita.pt', password: SENHA, name: 'Valdimiro', token: ENV.SETUP_TOKEN,
  }, { seguranca: true });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  return decodeURIComponent(r.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);
}

async function entrarComo(repo, email, password) {
  limitador.limpar();
  const r = await chamar(repo, '/auth/entrar', 'POST', { email, password }, { seguranca: true });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  return decodeURIComponent(r.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);
}

test('papéis: um leitor vê o briefing e não o altera — o servidor recusa, não é só o botão', async () => {
  const repo = createMemRepo();
  const dono = await comDono(repo);
  const autorizado = { seguranca: true };
  const { projeto } = await leadComProjeto(repo);
  await chamar(repo, '/ops/utilizadores', 'POST', {
    email: 'leitor@orbita.pt', password: SENHA, name: 'Leitora', role: 'leitor',
  }, { ...autorizado, ...comCookie(dono) });
  const leitor = await entrarComo(repo, 'leitor@orbita.pt', SENHA);

  const lido = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`, 'GET', null, { ...autorizado, ...comCookie(leitor) });
  assert.equal(lido.status, 200, 'ler é permitido a quem tem sessão');

  const escrever = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`, 'PUT', { valores: { empresa: 'X' } }, { ...autorizado, ...comCookie(leitor) });
  assert.equal(escrever.status, 403);
  assert.match(escrever.corpo.error, /papel/);

  const gerar = await chamar(repo, `/ops/projetos/${projeto.id}/master`, 'POST', {}, { ...autorizado, ...comCookie(leitor) });
  assert.equal(gerar.status, 403);

  /* e sem sessão não se lê nada disto */
  const semSessao = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`, 'GET', null, autorizado);
  assert.equal(semSessao.status, 401);
});

/* ------------------------------------------------------------------ vista */

const fakeApi = (dados = {}) => {
  const S = { briefing: null };
  const chamadas = [];
  const api = {
    S,
    chamadas,
    pintou: 0,
    ultimoToast: null,
    paint() { api.pintou += 1; },
    toast(msg, bad = false) { api.ultimoToast = { msg, bad }; },
    call: async (caminho, metodo = 'GET', corpo = null) => {
      chamadas.push({ caminho, metodo, corpo });
      const f = dados[caminho];
      if (typeof f === 'function') return f({ caminho, metodo, corpo });
      if (f) return f;
      throw Object.assign(new Error('sem essa rota no teste'), { status: 404 });
    },
  };
  return api;
};

const vistaExemplo = (extra = {}) => ({
  ok: true,
  projetoId: 'p1',
  leadId: 'l1',
  leadNome: 'Clínica do Mondego',
  briefing: {
    valores: { empresa: 'Clínica do Mondego', setor: 'Clínica dentária', objetivo: 'Encher a agenda', publico: '' },
    origens: { empresa: 'lead', setor: 'lead', objetivo: 'ia' },
    gravadoEm: '2026-11-02T10:00:00.000Z',
    hash: 'abc123',
  },
  master: null,
  imagens: null,
  desactualizado: { master: false, imagens: false },
  versoes: { master: 0, imagens: 0 },
  historico: [],
  preenchidos: 3,
  emFalta: ['publico'],
  campos: CAMPOS,
  ...extra,
});

test('vista: três abas, origem em cada campo e «não informado» onde não há nada', () => {
  const api = fakeApi();
  api.S.briefing = { ...estadoNovo('p1'), dados: vistaExemplo(), campos: CAMPOS, valores: vistaExemplo().briefing.valores, origens: vistaExemplo().briefing.origens };
  const html = vistaBriefing(api.S, { projeto: { id: 'p1', name: 'Site da Clínica', kind: 'landing' } });
  assert.match(html, /role="tablist"/);
  for (const aba of ['Briefing', 'Prompt Master', 'Imagens']) assert.match(html, new RegExp(aba));
  assert.match(html, /data-act="bf-aba" data-aba="master"/);
  assert.match(html, /Clínica do Mondego/);
  assert.match(html, /da lead/);
  assert.match(html, /sugerido pela IA/);
  assert.match(html, /não informado — escreve aqui ou pede à IA um rascunho/);
  assert.match(html, /data-campo="objetivo"/);
  /* conta de origens: o que vem de onde */
  assert.deepEqual(resumoOrigens({ a: 'x', b: '', c: 'y', d: 'z' }, { a: 'lead', c: 'ia' }), { lead: 1, ia: 1, manual: 1, vazios: 1 });
  assert.deepEqual(rotuloOrigem('b', { b: '' }, {}), { txt: 'não informado', cls: 'vazio' });
  assert.equal(podeGerar({ empresa: 'X', objetivo: 'Y' }), true);
  assert.equal(podeGerar({ empresa: 'X' }), false);
});

test('vista: o Prompt Master mostra a via, o motivo e o aviso de desactualizado', () => {
  const api = fakeApi();
  const dados = vistaExemplo({
    master: { id: 'm1', texto: 'PROMPT MASTER — Clínica', via: 'regras', motivo: 'não há motor de IA ligado', criado: '2026-11-02T11:00:00.000Z', versao: 2, base: 'velho' },
    desactualizado: { master: true, imagens: false },
    versoes: { master: 2, imagens: 0 },
  });
  api.S.briefing = { ...estadoNovo('p1'), aba: 'master', dados, campos: CAMPOS, valores: dados.briefing.valores, origens: dados.briefing.origens };
  const html = vistaBriefing(api.S, { projeto: { id: 'p1', name: 'Site' } });
  assert.match(html, /montado por regras/);
  assert.match(html, /não há motor de IA ligado/);
  assert.match(html, /O briefing mudou depois de isto ter sido escrito/);
  assert.match(html, /Versões anteriores/);
  assert.match(html, /data-act="bf-copiar-master"/);
  assert.match(html, /PROMPT MASTER — Clínica/);

  /* e no estado «ainda não há»: diz o que é e como nasce */
  api.S.briefing = { ...estadoNovo('p1'), aba: 'master', dados: vistaExemplo(), campos: CAMPOS, valores: {}, origens: {} };
  const vazio = vistaBriefing(api.S, { projeto: { id: 'p1', name: 'Site' } });
  assert.match(vazio, /Ainda não há Prompt Master/);
  assert.match(vazio, /briefing guardado/);
  assert.match(vazio, /data-act="bf-master"/);
});

test('vista: os prompts de imagem mostram a nota de conceito e não prometem imagens', () => {
  const api = fakeApi();
  const prompts = montarPromptsDeImagem({ briefing: vistaExemplo().briefing, lead: CLINICA });
  const dados = vistaExemplo({
    imagens: { id: 'i1', prompts, via: 'regras', motivo: 'sem chave', criado: '2026-11-02T11:00:00.000Z', nota: 'estes são prompts; nenhuma imagem é gerada nesta etapa' },
    desactualizado: { master: false, imagens: true },
  });
  api.S.briefing = { ...estadoNovo('p1'), aba: 'imagens', dados, campos: CAMPOS, valores: dados.briefing.valores, origens: {} };
  const html = vistaBriefing(api.S, { projeto: { id: 'p1', name: 'Site' } });
  assert.equal(html.split('data-act="bf-copiar-prompt"').length - 1, 4);
  assert.match(html, /nenhuma imagem é gerada nesta etapa/);
  assert.match(html, /NÃO usar como fotografia da equipa/);
  assert.match(html, /data-act="bf-copiar-imagens"/);
  assert.match(html, /podem estar desactualizados/);
  assert.doesNotMatch(html, /<img /, 'nenhuma imagem de exemplo a fazer de resultado');
});

test('vista: falha ao abrir não deixa o ecrã em branco — diz porquê e dá para tentar', async () => {
  const api = fakeApi({});
  await carregarBriefing(api, 'p1');
  assert.ok(api.S.briefing.erro);
  const html = vistaBriefing(api.S, { projeto: { id: 'p1', name: 'Site' } });
  assert.match(html, /Não consegui abrir o briefing/);
  assert.match(html, /data-act="bf-recarregar"/);
  assert.match(html, /Voltar ao projeto/);

  /* modo local: a frase é a limitação, não uma avaria */
  const local = fakeApi({ '/ops/projetos/p2/briefing': () => { throw Object.assign(new Error('o modo local ainda não faz «/ops/projetos/p2/briefing»'), { local: true }); } });
  await carregarBriefing(local, 'p2');
  const htmlLocal = vistaBriefing(local.S, { projeto: { id: 'p2', name: 'Site' } });
  assert.match(htmlLocal, /modo local/);
});

test('acções: gravar chama a rota com a base certa, limpa o «por gravar» e repinta', async () => {
  const resposta = vistaExemplo({ briefing: { ...vistaExemplo().briefing, valores: { empresa: 'Clínica do Mondego', objetivo: 'Novo objetivo' }, hash: 'novo' } });
  const api = fakeApi({ '/ops/projetos/p1/briefing': resposta });
  api.S.briefing = {
    ...estadoNovo('p1'),
    dados: vistaExemplo(), campos: CAMPOS,
    valores: { empresa: 'Clínica do Mondego', objetivo: 'Novo objetivo' },
    origens: { empresa: 'lead' }, base: 'abc123', sujo: true,
  };
  const tratou = await accaoBriefing('bf-guardar', null, api);
  assert.equal(tratou, true);
  const chamada = api.chamadas[0];
  assert.equal(chamada.metodo, 'PUT');
  assert.equal(chamada.corpo.base, 'abc123');
  assert.equal(chamada.corpo.valores.objetivo, 'Novo objetivo');
  assert.equal(api.S.briefing.sujo, false);
  assert.equal(api.S.briefing.base, 'novo');
  assert.ok(api.pintou >= 1);
  assert.match(api.S.briefing.aviso.texto, /desactualizados/);

  /* conflito de versões: recarrega em vez de gravar por cima */
  const conflito = fakeApi({ '/ops/projetos/p1/briefing': () => { throw Object.assign(new Error('o briefing mudou desde que o abriste'), { status: 409 }); } });
  conflito.S.briefing = { ...estadoNovo('p1'), dados: vistaExemplo(), campos: CAMPOS, valores: {}, base: 'velho', sujo: true };
  await accaoBriefing('bf-guardar', null, conflito);
  assert.match(conflito.S.briefing.aviso.texto, /Outra pessoa gravou o briefing/);
  assert.equal(conflito.S.briefing.aviso.mau, true);
});

test('acções: gerar com alterações por gravar pede para gravar primeiro', async () => {
  const api = fakeApi({});
  api.S.briefing = { ...estadoNovo('p1'), dados: vistaExemplo(), campos: CAMPOS, valores: {}, sujo: true };
  await accaoBriefing('bf-master', null, api);
  assert.equal(api.chamadas.length, 0, 'não se gera a partir de texto não confirmado');
  assert.match(api.ultimoToast.msg, /grava primeiro/);

  /* sem alterações, gera e mostra a via */
  const resposta = {
    ...vistaExemplo({
      master: { id: 'm1', texto: 'PROMPT', via: 'ia', criado: '2026-11-02T11:00:00.000Z', versao: 1, base: 'abc123' },
      versoes: { master: 1, imagens: 0 },
    }),
    ok: true, via: 'ia', motivo: null,
  };
  const ok = fakeApi({ '/ops/projetos/p1/master': resposta });
  ok.S.briefing = { ...estadoNovo('p1'), dados: vistaExemplo(), campos: CAMPOS, valores: {}, sujo: false };
  await accaoBriefing('bf-master', null, ok);
  assert.equal(ok.chamadas[0].caminho, '/ops/projetos/p1/master');
  assert.equal(ok.S.briefing.dados.master.via, 'ia');
  assert.match(ok.S.briefing.aviso.texto, /escrito pela IA/);
  assert.equal(ok.S.briefing.aGerar, null);
});

test('acções: copiar usa a área de transferência quando existe, e diz quando não conseguiu', async () => {
  const guardado = globalThis.navigator;
  let copiado = null;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { copiado = t; } } }, configurable: true });
  try {
    const api = fakeApi({});
    api.S.briefing = {
      ...estadoNovo('p1'), dados: vistaExemplo({ master: { texto: 'PROMPT MASTER INTEIRO' } }),
      campos: CAMPOS, valores: {}, aba: 'master',
    };
    await accaoBriefing('bf-copiar-master', null, api);
    assert.equal(copiado, 'PROMPT MASTER INTEIRO');
    assert.equal(api.ultimoToast.msg, 'Prompt Master copiado');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: guardado, configurable: true });
  }
});

test('acções: sair com alterações por gravar pede confirmação e respeita o «não»', async () => {
  const api = fakeApi({});
  api.S.briefing = { ...estadoNovo('p1'), valores: { empresa: 'editado' }, sujo: true, dados: vistaExemplo() };
  const antes = globalThis.confirm;
  try {
    globalThis.confirm = () => false;
    assert.equal(await podeSair(api, { name: 'hoje', id: null }), false);
    assert.equal(api.S.briefing.sujo, true, 'com «não», o trabalho fica onde está');
    globalThis.confirm = () => true;
    assert.equal(await podeSair(api, { name: 'hoje', id: null }), true);
    assert.equal(api.S.briefing.sujo, false);
    /* mudar de aba dentro do mesmo projeto não pede nada */
    api.S.briefing.sujo = true;
    assert.equal(await podeSair(api, { name: 'projeto', id: 'p1' }), true);
  } finally { globalThis.confirm = antes; }
});

test('o ecrã está ligado ao projeto: a mesa carrega e mostra o briefing', () => {
  const mesa = readFileSync(new URL('./src/mesa.js', import.meta.url), 'utf8');
  assert.match(mesa, /import \{[^}]*vistaBriefing[^}]*\} from '\.\/briefing\.js'/);
  assert.match(mesa, /carregarBriefing\(apiMesa, S\.route\.id\)/);
  assert.match(mesa, /briefingDoProjeto/);
  assert.match(mesa, /name\)\.startsWith\('bf-'\)/);
  assert.match(mesa, /ligarBriefing\(apiMesa\)/);
  assert.match(mesa, /podeSair\(apiMesa, destino\)/);
  assert.match(mesa, /Iniciar projeto/);
  const css = readFileSync(new URL('./src/mesa.html', import.meta.url), 'utf8');
  assert.match(css, /\.bf-abas/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.bf-dl > div/);
});

test('o contrato do pedido: a rota recusa um briefing que não é objeto e devolve os campos', async () => {
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const g = await chamar(repo, `/ops/projetos/${projeto.id}/briefing`, 'PUT', { valores: ['empresa'] });
  assert.equal(g.status, 200, 'uma lista não é um briefing: fica vazio, mas não explode');
  assert.equal(g.corpo.briefing.valores.empresa, '');
  assert.ok(Array.isArray(g.corpo.campos));
  assert.equal(g.corpo.campos[0].id, 'empresa');
  assert.ok(g.corpo.etiquetas.lead);
  await assert.rejects(() => chamar(repo, `/ops/projetos/${projeto.id}/briefing`, 'DELETE', null),
    (e) => e.status === 404, 'um método que não existe na rota diz 404, não finge que fez');
});
