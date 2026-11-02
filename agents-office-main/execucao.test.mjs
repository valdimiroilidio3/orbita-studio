import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADOS, ORDEM_ESTADOS, estadoDoRun, quandoDe, duracaoDe, passosDoRun, registoDoRun,
  autorizacoesDoRun, cancelamentoDe, podeCancelar, podeAprovar, podeRepetir,
  chaveDeRepeticao, recuperacao, resumoDoRun, cartaoDoRun, filaDeExecucao, avisosDaLista,
} from './src/execucao.js';

const AGORA = Date.parse('2026-11-02T12:00:00Z');
const run = (extra = {}) => ({
  id: 'a3f19c88-0000-4000-8000-000000000001',
  objetivo: 'Preparar a proposta para a Clínica Aurora',
  estado: 'concluido',
  criado: '2026-11-02T11:50:00Z',
  fim: '2026-11-02T11:58:00Z',
  tokens_in: 1200, tokens_out: 300, custo_centimos: 4,
  ...extra,
});
const step = (extra = {}) => ({
  id: 's1', ordem: 1, agente: 'research', titulo: 'Investigar a clínica',
  estado: 'concluido', entrada: 'Procura a clínica e o site', saida: 'Tem site de 2016.',
  duracao_ms: 4200, criado: '2026-11-02T11:51:00Z', ferramentas: [], ...extra,
});

test('1 · cinco estados por palavras, mais o cancelado', () => {
  assert.deepEqual(ORDEM_ESTADOS, ['em_fila', 'em_execucao', 'a_espera', 'falhou', 'concluido', 'cancelado']);
  assert.equal(ESTADOS.a_espera.rotulo, 'À espera de aprovação');
  assert.equal(ESTADOS.em_execucao.rotulo, 'Em execução');
  assert.equal(ESTADOS.falhou.rotulo, 'Falhou');
});

test('2 · cada estado técnico cai no estado que se mostra', () => {
  const mapa = { novo: 'em_fila', a_planear: 'em_execucao', a_executar: 'em_execucao', cancela_nao: 'em_fila', aguarda_aprovacao: 'a_espera', concluido: 'concluido', falhou: 'falhou', cancelado: 'cancelado' };
  for (const [tecnico, esperado] of Object.entries(mapa)) {
    const e = estadoDoRun({ estado: tecnico });
    assert.equal(e.id, esperado, `${tecnico} → ${e.id}`);
  }
});

test('3 · «parcial» não é «concluído» — fecha a meio e diz porquê', () => {
  const e = estadoDoRun({ estado: 'parcial' });
  assert.equal(e.id, 'falhou');
  assert.match(e.porque, /a meio/);
  assert.ok(!e.fechado || e.id === 'falhou');
});

test('4 · só fila, execução e espera contam como activas', () => {
  assert.equal(estadoDoRun({ estado: 'novo' }).activo, true);
  assert.equal(estadoDoRun({ estado: 'a_executar' }).activo, true);
  assert.equal(estadoDoRun({ estado: 'aguarda_aprovacao' }).activo, true);
  assert.equal(estadoDoRun({ estado: 'concluido' }).activo, false);
  assert.equal(estadoDoRun({ estado: 'falhou' }).fechado, true);
});

test('5 · a razão do estado vem do erro guardado, cortada', () => {
  const e = estadoDoRun({ estado: 'falhou', erro: 'nenhum fornecedor de IA configurado' });
  assert.match(e.porque, /nenhum fornecedor/);
});

test('6 · «concluído com ressalvas» não é «concluído sem nada a dizer»', () => {
  assert.match(estadoDoRun({ estado: 'concluido', revisao: { decisao: 'com_ressalvas' } }).porque, /ressalvas/);
  assert.match(estadoDoRun({ estado: 'concluido', revisao: { decisao: 'rejeitado' } }).porque, /rejeitou/);
});

test('7 · há quanto tempo, sem inventar datas', () => {
  assert.equal(quandoDe(null, AGORA), 'sem hora');
  assert.equal(quandoDe('2026-11-02T11:59:40Z', AGORA), 'agora mesmo');
  assert.equal(quandoDe('2026-11-02T11:30:00Z', AGORA), 'há 30 min');
  assert.equal(quandoDe('2026-11-02T09:00:00Z', AGORA), 'há 3 h');
  assert.equal(quandoDe('2026-10-20T09:00:00Z', AGORA), 'há 13 d');
});

test('8 · duração: sem medição é «—», nunca 0 a fingir', () => {
  assert.equal(duracaoDe(null), '—');
  assert.equal(duracaoDe(undefined), '—');
  assert.equal(duracaoDe(420), '420 ms');
  assert.equal(duracaoDe(4200), '4.2 s');
  assert.equal(duracaoDe(95000), '1 min 35 s');
});

test('9 · um passo mostra entrada, acções e resultado — os três', () => {
  const [p] = passosDoRun([step({ ferramentas: [{ nome: 'pesquisa_web', ok: true, resumo: '3 resultados', argumentos: { q: 'clínica' }, ms: 900 }] })]);
  assert.equal(p.temEntrada, true);
  assert.equal(p.temResultado, true);
  assert.equal(p.acoes.length, 1);
  assert.equal(p.acoes[0].nome, 'pesquisa_web');
  assert.equal(p.acoes[0].ok, true);
  assert.equal(p.acoes[0].argumentos.q, 'clínica');
  assert.equal(p.estado, 'concluido');
});

test('10 · uma ferramenta que pediu aprovação não conta como feita', () => {
  const [p] = passosDoRun([step({ estado: 'aguarda_aprovacao', ferramentas: [{ nome: 'apagar_receita', precisaAprovacao: true }] })]);
  assert.equal(p.acoes[0].ok, false);
  assert.equal(p.acoes[0].esperou, true);
  assert.match(p.acoes[0].resumo, /aprovação/);
  assert.equal(p.estado, 'a_espera');
});

test('11 · passo vazio é falha declarada, com a razão', () => {
  const [p] = passosDoRun([step({ estado: 'vazio', saida: '' })]);
  assert.equal(p.estado, 'falhou');
  assert.match(p.erro, /não devolveu texto/);
});

test('12 · os passos são lidos por ordem, mesmo chegando trocados', () => {
  const ps = passosDoRun([step({ id: 'b', ordem: 2 }), step({ id: 'a', ordem: 1 })]);
  assert.deepEqual(ps.map((p) => p.id), ['a', 'b']);
});

test('13 · o registo junta passos, acções e decisões por ordem de tempo', () => {
  const r = run({
    autorizacoes: [{ por: 'Dono', em: '2026-11-02T11:52:00Z', o_que: 'enviar email', decisao: 'aprovada' }],
    cancelamento: null,
  });
  const ev = registoDoRun(r, [step({ ferramentas: [{ nome: 'pesquisa_web', ok: true, resumo: '3 resultados' }] })]);
  const tipos = ev.map((e) => e.tipo);
  assert.equal(tipos[0], 'criado');
  assert.ok(tipos.includes('passo'));
  assert.ok(tipos.includes('accao'));
  assert.ok(tipos.includes('autorizacao'));
  assert.equal(ev[ev.length - 1].tipo, 'fim');
  const horas = ev.map((e) => new Date(e.em || 0).getTime());
  assert.deepEqual(horas, [...horas].sort((a, b) => a - b));
});

test('14 · quem autorizou fica com nome, hora e o que autorizou', () => {
  const a = autorizacoesDoRun(run({ autorizacoes: [{ por: 'Ana', em: '2026-11-02T11:55:00Z', o_que: 'apagar_receita', motivo: 'cliente pediu' }] }));
  assert.equal(a.length, 1);
  assert.equal(a[0].por, 'Ana');
  assert.equal(a[0].oQue, 'apagar_receita');
  assert.equal(a[0].decisao, 'aprovada');
  assert.equal(a[0].motivo, 'cliente pediu');
});

test('15 · uma autorização recusada lê-se como recusada', () => {
  const [a] = autorizacoesDoRun(run({ autorizacoes: [{ por: 'Dono', decisao: 'recusada' }] }));
  assert.equal(a.decisao, 'recusada');
});

test('16 · execuções antigas (autorizado_por) continuam legíveis', () => {
  const a = autorizacoesDoRun(run({ autorizado_por: 'dono@exemplo.pt' }));
  assert.equal(a.length, 1);
  assert.equal(a[0].por, 'dono@exemplo.pt');
  assert.equal(a[0].legado, true);
});

test('17 · o cancelamento é um pedido datado, não um botão mágico', () => {
  const c = cancelamentoDe(run({ estado: 'cancelado', cancelamento: { por: 'Dono', em: '2026-11-02T11:57:00Z' } }));
  assert.equal(c.pedido, true);
  assert.equal(c.por, 'Dono');
  assert.equal(c.efectivo, true);
  assert.match(c.porque, /entre passos/);
});

test('18 · cancelar só se houver o que parar — e a razão é dita', () => {
  assert.equal(podeCancelar(run()).sim, false);
  assert.match(podeCancelar(run()).porque, /já fechou/);
  assert.equal(podeCancelar(run({ estado: 'a_executar' })).sim, true);
  assert.match(podeCancelar(run({ estado: 'a_executar', cancelamento: { pedido: true, em: '2026-11-02T11:57:00Z' } })).porque, /já foi pedido/);
  assert.equal(podeCancelar(null).sim, false);
});

test('19 · aprovar só quando está mesmo à espera', () => {
  assert.equal(podeAprovar(run({ estado: 'a_executar' })).sim, false);
  assert.match(podeAprovar(run({ estado: 'concluido' })).porque, /já fechou/);
  const espera = podeAprovar(run({ estado: 'aguarda_aprovacao', pendente: { resumo: 'apagar_receita pede autorização' } }));
  assert.equal(espera.sim, true);
  assert.match(espera.porque, /apagar_receita/);
});

test('20 · repetir por cima de uma execução a correr é recusado com a razão', () => {
  const r = podeRepetir(run({ estado: 'a_executar' }), []);
  assert.equal(r.sim, false);
  assert.match(r.porque, /ainda não fechou/);
});

test('21 · não se abre uma segunda repetição viva da mesma execução', () => {
  const original = run();
  const repeticao = run({ id: 'b', estado: 'a_executar', repeticao_de: original.id });
  const r = podeRepetir(original, [original, repeticao]);
  assert.equal(r.sim, false);
  assert.match(r.porque, /repetição desta execução a correr/);
});

test('22 · fechada e sem repetição viva, repetir é permitido com chave estável', () => {
  const original = run();
  const r = podeRepetir(original, [original]);
  assert.equal(r.sim, true);
  assert.equal(r.chave, chaveDeRepeticao(original));
  assert.equal(chaveDeRepeticao(original), chaveDeRepeticao(original));
});

test('23 · à espera de aprovação, a recuperação é aprovar ou recusar', () => {
  const r = recuperacao(run({ estado: 'aguarda_aprovacao', pendente: { resumo: 'enviar email pede autorização' } }), []);
  assert.equal(r.necessaria, true);
  assert.deepEqual(r.opcoes.map((o) => o.id), ['aprovar', 'recusar']);
  assert.match(r.porque, /enviar email/);
});

test('24 · concluído não tem nada a recuperar', () => {
  const r = recuperacao(run(), [step()]);
  assert.equal(r.necessaria, false);
  assert.deepEqual(r.opcoes, []);
});

test('25 · falha sem motor manda ligar o motor, não «tentar outra vez»', () => {
  const r = recuperacao(run({ estado: 'falhou', erro: 'nenhum fornecedor de IA configurado — mete as chaves' }), []);
  assert.equal(r.opcoes[0].accao, 'ir-motores');
  assert.match(r.opcoes[0].porque, /sem chave/);
});

test('26 · plano ilegível: repetir é seguro porque nada correu', () => {
  const r = recuperacao(run({ estado: 'falhou', erro: 'o modelo não devolveu um plano legível' }), []);
  assert.equal(r.opcoes[0].accao, 'run-repetir');
  assert.match(r.opcoes[0].porque, /nenhum passo correu/);
});

test('27 · orçamento esgotado oferece continuar de onde parou', () => {
  const r = recuperacao(run({ estado: 'parcial', erro: 'orçamento esgotado' }), [step()]);
  assert.deepEqual(r.opcoes.map((o) => o.id), ['retomar', 'repetir']);
});

test('28 · passo falhado é recuperado do passo, não do início', () => {
  const r = recuperacao(run({ estado: 'falhou' }), [step(), step({ id: 's2', ordem: 2, estado: 'falhou', erro: 'timeout', titulo: 'Escrever' })]);
  assert.match(r.porque, /passo 2/);
  assert.equal(r.opcoes[0].accao, 'run-retomar');
  assert.match(r.opcoes[0].porque, /não se repetem/);
});

test('29 · cancelada não se retoma sozinha: só correr outra vez', () => {
  const r = recuperacao(run({ estado: 'cancelado' }), []);
  assert.equal(r.necessaria, false);
  assert.deepEqual(r.opcoes.map((o) => o.id), ['repetir']);
});

test('30 · o resumo conta passos, acções e tokens — e o custo é «desconhecido» sem preço', () => {
  const s = resumoDoRun(run({ custo_centimos: 0 }), [step({ ferramentas: [{ nome: 'pesquisa_web', ok: true }] }), step({ id: 's2', ordem: 2, estado: 'falhou' })]);
  assert.equal(s.passos, 2);
  assert.equal(s.concluidos, 1);
  assert.equal(s.falhados, 1);
  assert.equal(s.acoes, 1);
  assert.equal(s.tokens, 1500);
  assert.equal(s.custo.desconhecido, true);
  assert.equal(s.custo.centimos, null);
});

test('31 · com custo medido, o número aparece', () => {
  const s = resumoDoRun(run(), [step()]);
  assert.equal(s.custo.desconhecido, false);
  assert.equal(s.custo.centimos, 4);
  assert.equal(s.duracao, '8 min 0 s');
});

test('32 · o cartão de lista tem número real do id e a nota da falha', () => {
  const c = cartaoDoRun(run({ estado: 'falhou', erro: 'sem motor' }), [], { agora: AGORA });
  assert.equal(c.numero, 'a3f19c');
  assert.equal(c.estado.id, 'falhou');
  assert.match(c.nota, /sem motor/);
  assert.equal(c.quando, 'há 10 min');
});

test('33 · fila de execução: conta o que está a correr e o que espera por ti', () => {
  const f = filaDeExecucao([
    run({ id: 'r1', estado: 'a_executar' }),
    run({ id: 'r2', estado: 'aguarda_aprovacao' }),
    run({ id: 'r3', estado: 'novo' }),
    run({ id: 'r4', estado: 'concluido' }),
    run({ id: 'r5', estado: 'falhou' }),
  ]);
  assert.equal(f.total, 5);
  assert.equal(f.aCorrer.length, 1);
  assert.equal(f.aEspera.length, 1);
  assert.equal(f.fila.length, 1);
  assert.equal(f.algumaActiva, true);
  assert.match(f.frase, /1 à espera de aprovação/);
});

test('34 · sem execuções, a frase não inventa actividade', () => {
  const f = filaDeExecucao([]);
  assert.equal(f.total, 0);
  assert.equal(f.algumaActiva, false);
  assert.match(f.frase, /ainda não houve execuções/);
});

test('35 · a lista avisa quando está em modo local e quando há decisões paradas', () => {
  const local = avisosDaLista({ runs: [], modoLocal: true });
  assert.equal(local[0].tipo, 'local');
  assert.match(local[0].texto, /não corre nenhum agente/);
  const paradas = avisosDaLista({ runs: [run({ estado: 'aguarda_aprovacao' })] });
  assert.equal(paradas[0].tipo, 'espera');
  assert.match(paradas[0].texto, /não avançam/);
});
