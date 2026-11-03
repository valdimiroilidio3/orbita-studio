import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINIMO, CHAVE_RECENTES, MAX_RECENTES, semAcentos, limparConsulta, consultaValida,
  entidadeDaRota, agrupar, inferirTipo, tarefaDoResultado, estadoDaBusca,
  juntarRecente, lerRecentes, gravarRecentes, TIPOS,
} from './src/busca.js';

const RESPOSTA = {
  query: 'clínica',
  total: 3,
  nota: 'resultados reais, sem estimativas',
  grupos: [
    {
      label: 'Leads',
      itens: [
        { id: 'l1', name: 'Clínica Aurora', city: 'Coimbra · dentária', route: '#/lead/l1' },
        { id: 'l2', name: 'Clínica do Largo', city: 'Lisboa', route: '#/lead/l2' },
      ],
    },
    {
      label: 'Projetos',
      itens: [{ id: 'p1', name: 'Site da Clínica Aurora', client: 'Clínica Aurora · landing', route: '#/projeto/p1' }],
    },
    { label: 'Mensagens', itens: [] },
  ],
};

test('1 · a consulta é aparada e só vale com duas letras', () => {
  assert.equal(limparConsulta('   clínica   aurora '), 'clínica aurora');
  assert.equal(consultaValida('c'), false);
  assert.equal(consultaValida(' c '), false);
  assert.equal(consultaValida('cl'), true);
  assert.equal(MINIMO, 2);
});

test('2 · sem acentos e sem maiúsculas, como o servidor', () => {
  assert.equal(semAcentos('Clínica AURORA'), 'clinica aurora');
  assert.equal(semAcentos('ação'), 'acao');
});

test('3 · a rota diz de que entidade é o resultado', () => {
  assert.equal(entidadeDaRota('#/lead/l1'), 'lead');
  assert.equal(entidadeDaRota('#/projeto/p1'), 'projeto');
  assert.equal(entidadeDaRota('#/tarefas'), null);
  assert.equal(entidadeDaRota('#/conversas'), null);
  assert.equal(entidadeDaRota(null), null);
});

test('4 · os grupos arrumam-se em cartões e os vazios desaparecem', () => {
  const a = agrupar(RESPOSTA);
  assert.equal(a.total, 3);
  assert.deepEqual(a.grupos.map((g) => g.label), ['Leads', 'Projetos']);
  const lead = a.grupos[0].itens[0];
  assert.equal(lead.titulo, 'Clínica Aurora');
  assert.equal(lead.sub, 'Coimbra · dentária');
  assert.equal(lead.entidade, 'lead');
  assert.equal(lead.podeCriarTarefa, true);
  assert.equal(a.grupos[1].itens[0].entidade, 'projeto');
});

test('5 · um resultado de tarefa ou mensagem não aceita tarefa nova (não tem alvo)', () => {
  const a = agrupar({ grupos: [{ label: 'Tarefas', itens: [{ id: 't1', title: 'Fechar o site', route: '#/tarefas' }] }] });
  assert.equal(a.grupos[0].itens[0].podeCriarTarefa, false);
  const t = tarefaDoResultado({ consulta: 'fechar', item: a.grupos[0].itens[0] });
  assert.equal(t.ok, false);
  assert.match(t.sem, /precisa de um alvo real/);
});

test('6 · a resposta sem itens não inventa grupos', () => {
  const a = agrupar({ query: 'zzz', total: 0, grupos: [] });
  assert.equal(a.total, 0);
  assert.deepEqual(a.grupos, []);
  assert.match(a.nota, /nada corresponde/);
});

test('7 · o tipo de tarefa vem do verbo escrito — e diz porquê', () => {
  assert.equal(inferirTipo('testa o formulário do site').tipo, 'qa');
  assert.equal(inferirTipo('corrigir o css do cabeçalho').tipo, 'codigo');
  assert.equal(inferirTipo('escrever a proposta para a clínica').tipo, 'briefing');
  assert.equal(inferirTipo('responder ao email do cliente').tipo, 'mensagem');
  assert.equal(inferirTipo('investigar a clínica Aurora').tipo, 'investigar');
  const semVerbo = inferirTipo('clínica aurora');
  assert.equal(semVerbo.tipo, 'investigar');
  assert.equal(semVerbo.certo, false);
  assert.match(semVerbo.porque, /sem verbo claro/);
});

test('8 · todos os tipos inferidos são tipos que o servidor aceita', () => {
  const aceites = ['investigar', 'mensagem', 'briefing', 'codigo', 'qa'];
  for (const frase of ['testa', 'corrige', 'briefing', 'email', 'olá', 'clínica']) {
    assert.ok(aceites.includes(inferirTipo(frase).tipo), `${frase} → ${inferirTipo(frase).tipo}`);
  }
  assert.deepEqual(Object.keys(TIPOS).sort(), [...aceites].sort());
});

test('9 · uma tarefa a partir de um lead leva o alvo e fica à espera de aprovação', () => {
  const item = agrupar(RESPOSTA).grupos[0].itens[0];
  const t = tarefaDoResultado({ consulta: 'investigar a clínica', item });
  assert.equal(t.ok, true);
  assert.deepEqual(t.corpo, { kind: 'investigar', entityId: 'l1', entidade: 'lead', aprovacao: true, correr: true });
  assert.equal(t.alvo, 'Clínica Aurora');
  assert.match(t.titulo, /Investigar/);
});

test('10 · sem resultado escolhido, a tarefa não nasce', () => {
  const t = tarefaDoResultado({ consulta: 'clínica', item: null });
  assert.equal(t.ok, false);
  assert.match(t.sem, /escolhe primeiro/);
});

test('11 · a folha de busca sabe em que momento está', () => {
  assert.equal(estadoDaBusca({ consulta: 'c' }).modo, 'curta');
  assert.match(estadoDaBusca({ consulta: 'c' }).nota, /pelo menos 2 letras/);
  assert.equal(estadoDaBusca({ consulta: 'clínica', aCarregar: true }).modo, 'a-carregar');
  assert.equal(estadoDaBusca({ consulta: 'clínica' }).modo, 'a-carregar', 'sem resposta ainda, procura-se');
  assert.equal(estadoDaBusca({ consulta: 'clínica', resultado: RESPOSTA }).modo, 'lista');
  assert.equal(estadoDaBusca({ consulta: 'zzz', resultado: { grupos: [] } }).modo, 'vazio');
  assert.equal(estadoDaBusca({ consulta: 'clínica', erro: 'o servidor não respondeu' }).modo, 'erro');
  assert.match(estadoDaBusca({ consulta: 'clínica', erro: 'sem rede' }).nota, /sem rede/);
});

test('12 · os recentes não repetem e ficam limitados a seis', () => {
  let l = [];
  for (const q of ['um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete']) l = juntarRecente(l, q);
  assert.equal(l.length, MAX_RECENTES);
  assert.equal(l[0], 'sete');
  l = juntarRecente(l, 'cinco');
  assert.equal(l[0], 'cinco');
  assert.equal(l.filter((x) => x === 'cinco').length, 1);
  assert.ok(!l.includes('um'));
});

test('13 · recentes ignoram consultas curtas e aguentam um armazém avariado', () => {
  assert.deepEqual(juntarRecente(['a'], 'x'), ['a']);
  const avariado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.deepEqual(lerRecentes(avariado), []);
  assert.equal(gravarRecentes(avariado, ['x']), false);
  const mem = new Map();
  const bom = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(gravarRecentes(bom, ['clínica', 42, '']), true);
  assert.deepEqual(lerRecentes(bom), ['clínica', '']);
  assert.equal(CHAVE_RECENTES, 'orbita.busca.recentes');
});
