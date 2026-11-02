// Testes de MOTORES, AUTONOMIA E SALDO — 1.60.0 (2 nov 2026).
//
// O dono pediu que se percebesse, num sítio: que motor está escolhido e o que ele
// sabe fazer (texto? mãos? ficheiros?), o estado das integrações e a última
// verificação, o consumo real com limites e custo, o nível de autonomia de cada
// tipo — e o que exige aprovação obrigatória. As contas vivem em
// `src/motores.js`, puras, e é isso que aqui se prova:
//
//   · «não declarado» não é «não tem» — e a diferença aparece escrita;
//   · um agente que pede ferramentas e um motor só de texto traz um AVISO antes
//     de a tarefa correr;
//   · o custo sem preço é «desconhecido», nunca 0 (que se lê como grátis);
//   · a autonomia sobe com casos, desce sem justificação, e uma acção sensível
//     exige sempre aprovação — em qualquer nível;
//   · a barra de uma mão mostra UMA decisão, com a acção certa.
//
//   node --test motores.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLASSES, CAPACIDADES, NIVEIS_AUTONOMIA, desde, classeDe, capacidadesDe, permissoesDe,
  estadoDoMotor, perfilDoMotor, perfis, escolhaDoAgente, nivelDeAutonomia, podeAgirSozinho,
  requerAprovacao, acoesSensiveis, consumoPorMotor, resumoDoConsumo, filaRapida,
  barraDeAprovacao, cartoesDoPainel, resumoDaAutonomia, movimentoReduzido,
} from './src/motores.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const AGORA = Date.parse('2026-11-02T12:00:00Z');
const H = 3600 * 1000;

const GROQ = {
  id: 'groq', nome: 'Groq', configurado: true, estado: 'funcional', classe: 'api',
  ferramentas: null, limites: '30 pedidos/min · 14 400/dia',
  ultimoTeste: { ok: true, ms: 210, quando: new Date(AGORA - 2 * H).toISOString() },
  modelosNoCatalogo: 4, variavel: 'GROQ_API_KEY', chaveMascarada: 'gsk_…9f2',
};
const OVH = { id: 'ovh', nome: 'OVH', configurado: true, estado: 'por_testar', classe: 'api', ferramentas: false, limites: 'sem limite declarado', ultimoTeste: null, modelosNoCatalogo: 3 };
const CLI = { id: 'claude-cli', nome: 'Claude Code', classe: 'cli', tools: true, configurado: true, estado: 'funcional', ultimoTeste: { ok: true, ms: 900, quando: new Date(AGORA - 30 * H).toISOString() } };

/* ---------- 1. as duas famílias ---------- */

test('1 · um motor sem classe declarada é uma API — não se lhe inventam mãos', () => {
  assert.equal(classeDe({ id: 'x' }), 'api');
  assert.equal(classeDe({ classe: 'cli' }), 'cli');
  assert.equal(classeDe({ kind: 'CLI' }), 'cli', 'aceita a forma antiga, sem distinguir maiúsculas');
  assert.equal(classeDe(null), 'api');
  assert.match(CLASSES.cli.porque, /máquina|ferramentas/);
  assert.match(CLASSES.api.porque, /texto/);
});

test('2 · as capacidades distinguem «não tem» de «não foi declarado»', () => {
  const semDeclaracao = capacidadesDe({ classe: 'api' });
  const ferr = semDeclaracao.find((c) => c.id === 'ferramentas');
  assert.equal(ferr.tem, null, 'não declarado é null, não false');
  assert.match(ferr.porque, /não declarou/);

  assert.equal(capacidadesDe({ classe: 'api', ferramentas: false }).find((c) => c.id === 'ferramentas').tem, false);
  assert.equal(capacidadesDe({ classe: 'api', ferramentas: true }).find((c) => c.id === 'ferramentas').tem, true);
  assert.equal(capacidadesDe({ classe: 'cli', tools: true }).find((c) => c.id === 'ferramentas').tem, true);
});

test('3 · só um CLI local pode escrever ficheiros; uma API não escreve no disco', () => {
  const cli = capacidadesDe(CLI);
  const api = capacidadesDe(GROQ);
  assert.equal(cli.find((c) => c.id === 'ficheiros').tem, true);
  assert.equal(api.find((c) => c.id === 'ficheiros').tem, false);
  assert.match(api.find((c) => c.id === 'ficheiros').porque, /servidor é quem guarda/);
  assert.equal(api.find((c) => c.id === 'texto').tem, true, 'texto responde sempre');
});

test('4 · nenhuma capacidade é inventada: cada uma diz a razão', () => {
  for (const c of capacidadesDe(CLI)) {
    assert.ok(CAPACIDADES.some((x) => x.id === c.id), `capacidade desconhecida: ${c.id}`);
    assert.ok(c.rotulo && c.porque, `${c.id} sem rótulo ou razão`);
  }
});

/* ---------- 5. permissões ---------- */

test('5 · as acções destrutivas nunca são permissão de um motor', () => {
  for (const f of [GROQ, CLI]) {
    const destrutivas = permissoesDe(f).find((p) => p.id === 'destrutivas');
    assert.equal(destrutivas.tem, false, `${f.nome} não pode ter direito a apagar sozinho`);
    assert.match(destrutivas.porque, /aprovação humana/);
  }
});

test('6 · um CLI tem permissão para correr comandos; uma API não a declara', () => {
  assert.equal(permissoesDe(CLI).find((p) => p.id === 'maquina').tem, true);
  assert.equal(permissoesDe(GROQ).find((p) => p.id === 'maquina'), undefined);
  assert.equal(permissoesDe(GROQ).find((p) => p.id === 'responder').tem, true);
});

/* ---------- 7. estado e última verificação ---------- */

test('7 · «verificado» só com resposta registada; sem teste é «por testar»', () => {
  assert.equal(estadoDoMotor(GROQ).rotulo, 'Verificado');
  assert.equal(estadoDoMotor(OVH).rotulo, 'Por testar');
  assert.equal(estadoDoMotor({ ...GROQ, estado: 'erro', ultimoTeste: { ok: false, erro: 'HTTP 401' } }).porque, 'HTTP 401');
  assert.equal(estadoDoMotor({ ...GROQ, desligado: true }).rotulo, 'Desligado por ti');
  assert.equal(estadoDoMotor({ ...GROQ, configurado: false, semChave: false }).rotulo, 'Sem chave');
});

test('8 · a última verificação diz há quanto tempo, e «nunca» quando não há', () => {
  assert.equal(desde(new Date(AGORA - 2 * H).toISOString(), AGORA).texto, 'há 2 h');
  assert.equal(desde(new Date(AGORA - 3 * 24 * H).toISOString(), AGORA).texto, 'há 3 dias');
  assert.equal(desde(null, AGORA).texto, 'nunca');
  const p = perfilDoMotor(OVH, { agora: AGORA });
  assert.equal(p.verificacao.rotulo, 'nunca verificado');
  assert.equal(perfilDoMotor(GROQ, { agora: AGORA }).verificacao.rotulo, 'verificado há 2 h');
});

test('9 · o perfil nunca leva o valor da chave — só o nome da variável e a máscara', () => {
  const p = perfilDoMotor(GROQ, { agora: AGORA });
  assert.equal(p.variavel, 'GROQ_API_KEY');
  assert.equal(p.chaveMascarada, 'gsk_…9f2');
  assert.ok(!JSON.stringify(p).includes('gsk_9'), 'a chave em claro não passa daqui');
});

test('10 · o resumo dos motores conta o que está provado, e a frase não promete mais', () => {
  const { lista, resumo } = perfis([GROQ, OVH, { ...CLI, desligado: false }], { agora: AGORA });
  assert.equal(lista.length, 3);
  assert.equal(resumo.prontos, 3);
  assert.equal(resumo.verificados, 2);
  assert.equal(resumo.porTestar, 1);
  assert.equal(resumo.comFerramentas, 1, 'só o CLI declara mãos');
  assert.equal(resumo.porDeclarar, 1, 'o Groq não declarou');
  assert.match(resumo.frase, /3 pronto\(s\)/);
  assert.match(perfis([], {}).resumo.frase, /Nenhum motor ligado/);
});

/* ---------- 11. o motor escolhido por agente ---------- */

test('11 · um agente que pede ferramentas e um motor só de texto traz aviso', () => {
  const { lista } = perfis([GROQ, OVH], { agora: AGORA });
  const e = escolhaDoAgente({ id: 'qa', numero: 4, nome: 'QA', ferramentas: ['ler', 'correr'], escolha: { fornecedor: 'ovh', modelo: 'qwen' } }, lista);
  assert.equal(e.motor, 'OVH');
  assert.equal(e.ferramentasDisponiveis, false);
  assert.match(e.aviso, /sem mãos/);
  assert.match(e.aviso, /ler, correr/, 'o aviso diz QUAIS ferramentas o agente pede');
});

test('12 · sem motor escolhido, o aviso diz que o router decide', () => {
  const e = escolhaDoAgente({ id: 'x', nome: 'X' }, []);
  assert.equal(e.motor, null);
  assert.match(e.aviso, /o router decide/);
});

test('13 · motor escolhido que não existe nesta instalação também é avisado', () => {
  const e = escolhaDoAgente({ id: 'x', nome: 'X', escolha: { fornecedor: 'anthropic', modelo: 'claude' } }, []);
  assert.match(e.aviso, /não está nesta instalação/);
});

test('14 · motor declarado sem ferramentas mas agente sem ferramentas: sem aviso', () => {
  const { lista } = perfis([GROQ], { agora: AGORA });
  const e = escolhaDoAgente({ id: 'x', nome: 'X', escolha: { fornecedor: 'groq', modelo: 'm' } }, lista);
  assert.equal(e.aviso, null);
});

/* ---------- 15. autonomia ---------- */

test('15 · a autonomia começa em «pede-me sempre» e diz de onde veio', () => {
  const n = nivelDeAutonomia({}, { agora: AGORA });
  assert.equal(n.nivel, 'pedir_sempre');
  assert.equal(n.rotulo, NIVEIS_AUTONOMIA.pedir_sempre.rotulo);
  const decidido = nivelDeAutonomia({ escopo: 'email:geral', nivel: 'autonomo', decidido_por: 'valdimiro@exemplo.pt', decidido_em: new Date(AGORA - H).toISOString(), casos: 64, taxa: 0.97 }, { agora: AGORA });
  assert.equal(decidido.nivel, 'autonomo');
  assert.equal(decidido.autor, 'valdimiro@exemplo.pt');
  assert.equal(decidido.quandoTexto, 'há 1 h');
  assert.equal(decidido.casos, 64);
  assert.equal(nivelDeAutonomia({ nivel: 'inventado' }).nivel, 'pedir_sempre', 'um nível desconhecido não passa');
});

test('16 · uma acção sensível nunca corre sozinha — nem em autónomo', () => {
  const autonomo = { nivel: 'autonomo' };
  assert.equal(podeAgirSozinho(autonomo).sim, true);
  const sensivel = podeAgirSozinho(autonomo, { sensivel: true });
  assert.equal(sensivel.sim, false);
  assert.match(sensivel.porque, /sensível/);
  assert.equal(podeAgirSozinho({ nivel: 'proposto' }).sim, false);
});

test('17 · a regra da aprovação: destrutiva manda sempre; o resto depende do nível', () => {
  assert.equal(requerAprovacao({ ferramenta: { nome: 'Apagar receita', destrutivo: true }, nivel: { nivel: 'autonomo' } }).exige, true);
  assert.equal(requerAprovacao({ ferramenta: { nome: 'Ler site' }, nivel: { nivel: 'autonomo' } }).exige, false);
  assert.equal(requerAprovacao({ ferramenta: { nome: 'Ler site' }, nivel: { nivel: 'proposto' } }).exige, true);
  assert.equal(requerAprovacao({ ferramenta: { nome: 'Ler site' } }).exige, true, 'sem nível, pede-se');
});

test('18 · as acções sensíveis listam-se com a razão escrita', () => {
  const lista = acoesSensiveis([
    { id: 'apagar-receita', nome: 'Apagar receita', descricao: 'Apaga uma entrada de dinheiro.', destrutiva: true },
    { id: 'ler-site', nome: 'Ler site', descricao: 'Abre uma página.' },
  ]);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nome, 'Apagar receita');
  assert.match(lista[0].porque, /aprovação humana/);
  assert.equal(acoesSensiveis([]).length, 0);
});

test('19 · o resumo da autonomia conta os três níveis e não inventa tipos', () => {
  const r = resumoDaAutonomia([{ nivel: 'autonomo' }, { nivel: 'proposto' }, { nivel: 'pedir_sempre' }, {}]);
  assert.equal(r.total, 4);
  assert.equal(r.autonomos, 1);
  assert.equal(r.propostos, 1);
  assert.equal(r.pedemSempre, 2);
  assert.match(r.frase, /1 autónomo/);
  assert.match(resumoDaAutonomia([]).frase, /tudo pede autorização/);
});

/* ---------- 20. consumo e custo ---------- */

test('20 · o consumo real soma pedidos e tokens, e guarda a latência', () => {
  const linhas = consumoPorMotor({ resumo: [
    { fornecedor: 'groq', pedidos: 10, ok: 9, erros: 1, latenciaMediaMs: 320, tokens: 1200 },
    { fornecedor: 'ovh', pedidos: 4, ok: 4, erros: 0, latenciaMediaMs: 900, tokens: 300 },
  ] }, [GROQ]);
  assert.equal(linhas[0].id, 'groq');
  assert.equal(linhas[0].limites, GROQ.limites, 'os limites vêm do catálogo');
  assert.equal(linhas[1].limites, 'limites não declarados');
  assert.equal(linhas.reduce((n, l) => n + l.pedidos, 0), 14);
});

test('21 · sem preço, o custo é «desconhecido» — nunca zero', () => {
  const semSaldo = resumoDoConsumo({ uso: { resumo: [{ fornecedor: 'groq', pedidos: 1, tokens: 10 }] }, saldo: null });
  assert.equal(semSaldo.custoCentimos, null);
  assert.match(semSaldo.nota, /desconhecido, não zero/);

  const comDesconhecidas = resumoDoConsumo({ saldo: { custoCentimos: 1234, contaAVista: { desconhecidas: 3 } } });
  assert.equal(comDesconhecidas.custoCentimos, 1234);
  assert.equal(comDesconhecidas.semPreco, 3);
  assert.match(comDesconhecidas.nota, /fora da soma/);
});

test('22 · o custo conhecido é o do saldo, e o total de chamadas vem do uso', () => {
  const r = resumoDoConsumo({ uso: { resumo: [{ fornecedor: 'a', pedidos: 2, tokens: 5 }, { fornecedor: 'b', pedidos: 3, tokens: 7 }] }, saldo: { custoCentimos: 500, contaAVista: {} } });
  assert.equal(r.chamadas, 5);
  assert.equal(r.tokens, 12);
  assert.equal(r.custoCentimos, 500);
  assert.equal(r.semPreco, 0);
});

/* ---------- 23. a fila de uma mão ---------- */

test('23 · a fila rápida junta mensagens e tarefas, com uma acção por item', () => {
  const fila = filaRapida({
    mensagens: [
      { id: 'm1', status: 'rascunho', subject: 'Proposta', created_at: '2026-11-02T10:00:00Z' },
      { id: 'm2', status: 'enviada', subject: 'Já saiu' },
      { id: 'm3', status: 'aprovada', subject: 'Falta enviar', channel: 'whatsapp' },
    ],
    tarefas: [{ id: 't1', state: 'awaiting_approval', title: 'Auditoria' }, { id: 't2', state: 'succeeded' }],
  });
  assert.equal(fila.length, 3);
  assert.equal(fila.find((f) => f.id === 'm1').accao, 'aprovar');
  assert.equal(fila.find((f) => f.id === 'm3').accao, 'enviar');
  assert.equal(fila.find((f) => f.id === 't1').accao, 'aprovar-tarefa');
  assert.ok(fila.every((f) => f.sensivel), 'todas as decisões da fila são sensíveis');
  assert.equal(fila[0].quando, '2026-11-02T10:00:00Z', 'a mais recente primeiro');
});

test('24 · a barra de uma mão mostra uma decisão e diz quantas faltam', () => {
  const vazia = barraDeAprovacao([]);
  assert.equal(vazia.total, 0);
  assert.equal(vazia.principal, null);
  assert.match(vazia.frase, /Nada à tua espera/);

  const uma = barraDeAprovacao(filaRapida({ mensagens: [{ id: 'm1', status: 'rascunho', subject: 'Proposta' }] }));
  assert.equal(uma.total, 1);
  assert.equal(uma.principal.id, 'm1');
  assert.match(uma.frase, /1 decisão/);

  const duas = barraDeAprovacao(filaRapida({ mensagens: [{ id: 'm1', status: 'rascunho', subject: 'A' }, { id: 'm2', status: 'rascunho', subject: 'B' }] }));
  assert.equal(duas.total, 2);
  assert.match(duas.frase, /2 decisões/);
});

/* ---------- 25. os cartões do painel ---------- */

test('25 · os cartões móveis respondem com números que existem', () => {
  const cartoes = cartoesDoPainel({
    tarefas: [{ id: 't1', state: 'running' }, { id: 't2', state: 'running' }, { id: 't3', state: 'failed' }, { id: 't4', state: 'awaiting_approval' }],
    mensagens: [{ id: 'm1', status: 'rascunho' }],
    motores: { resumo: { prontos: 3, frase: '3 pronto(s)' } },
    autonomia: { autonomos: 1, total: 4 },
    consumo: { custoCentimos: 900, nota: 'preços do catálogo' },
  });
  const por = Object.fromEntries(cartoes.map((c) => [c.id, c]));
  assert.equal(por['a-correr'].valor, 2);
  assert.equal(por.espera.valor, 2);
  assert.equal(por.falhou.valor, 1);
  assert.equal(por.motores.valor, 3);
  assert.equal(por.autonomia.valor, 1);
  assert.equal(por.custo.valor, 900);
  assert.ok(cartoes.every((c) => c.ir.startsWith('#/')));
});

test('26 · sem leitura, o cartão diz «por ler» em vez de um zero inventado', () => {
  const cartoes = cartoesDoPainel({ tarefas: [] });
  const por = Object.fromEntries(cartoes.map((c) => [c.id, c]));
  assert.equal(por.motores.valor, null);
  assert.match(por.motores.nota, /por ler/);
  assert.equal(por.custo.valor, null);
});

test('27 · o movimento reduzido é respeitado a sério, e uma media query que rebenta não trava nada', () => {
  assert.equal(movimentoReduzido(() => ({ matches: true })), true);
  assert.equal(movimentoReduzido(() => ({ matches: false })), false);
  assert.equal(movimentoReduzido(() => { throw new Error('sem matchMedia'); }), false);
  assert.equal(movimentoReduzido(undefined), false);
});

/* ---------- 28. a ligação real ao servidor e ao ecrã ---------- */

test('28 · o servidor declara a classe e as capacidades, e guarda a autonomia com autor', () => {
  const motor = fs.readFileSync(path.join(ROOT, 'api/_ia/motor.mjs'), 'utf8');
  assert.match(motor, /classe: p\.classe === 'cli' \? 'cli' : 'api'/);
  assert.match(motor, /ferramentas: p\.ferramentas === true \? true : p\.ferramentas === false \? false : null/);

  const rotas = fs.readFileSync(path.join(ROOT, 'api/_rotas.mjs'), 'utf8');
  assert.match(rotas, /caminhoLimpo === '\/ops\/autonomia'/);
  assert.match(rotas, /decidido_por: autor/, 'a decisão fica com autor');
  assert.match(rotas, /falha\(409/, 'subir sem casos é recusado, com razão');
  assert.match(rotas, /MIN_CASOS = 50/);

  const repo = fs.readFileSync(path.join(ROOT, 'api/_repo.mjs'), 'utf8');
  assert.match(repo, /autonomia: \{/, 'há um repositório de autonomia');
  assert.match(repo, /orbita_autonomia/, 'a tabela tem nome');

  const sql = fs.readFileSync(path.join(ROOT, 'supabase/orbita_1_60_0.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.orbita_autonomia/);
  assert.match(sql, /check \(nivel in \('pedir_sempre', 'proposto', 'autonomo'\)\)/);
});

test('29 · a mesa usa estas contas e não uma segunda opinião', () => {
  const mesa = fs.readFileSync(path.join(ROOT, 'src/mesa.js'), 'utf8');
  assert.match(mesa, /from '\.\/motores\.js'/);
  assert.match(mesa, /function viewMotores\(\)/);
  assert.match(mesa, /S\.route\.name === 'motores'/);
  assert.match(mesa, /paintMobar\(\)/, 'a barra de uma mão é pintada');
  for (const act of ['auto-up', 'auto-down', 'tarefa-rapida']) assert.match(mesa, new RegExp(`'${act}'`), `falta a acção ${act}`);
  assert.ok(!/function filaRapida/.test(mesa), 'a fila não é reescrita na mesa');

  const shell = fs.readFileSync(path.join(ROOT, 'src/mesa.html'), 'utf8');
  assert.match(shell, /\.mobar/);
  assert.match(shell, /\.mo-cards/);
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shell, /id="mobar"/);
});
