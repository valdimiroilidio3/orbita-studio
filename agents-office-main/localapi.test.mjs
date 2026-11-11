// Testes do MODO LOCAL da mesa (src/localapi.js) — 30 out 2026.
//
// Pedido do dono: «todas estas páginas já deram aceitar e estar muito bem funcionais, chega de
// demonstrações só». A mesa publicada não tem `/api` atrás; passa a trabalhar sobre o armazém do
// browser, com o MESMO contrato que o servidor. É isso que aqui se prova, contra um `localStorage`
// falso: escrever um lead e voltar a lê-lo, o dedupe, o dinheiro, os projetos, as tarefas (que
// falham por não haver motor — e dizem porquê), o vazio honesto e a cópia de segurança.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi, CHAVE } from './src/localapi.js';

/** o menor dos armazéns: um Map com a interface que o módulo usa */
function armazem() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _mapa: m,
  };
}

test('1 · começa vazio: nada de dados de demonstração', async () => {
  const api = createLocalApi({ storage: armazem() });
  const leads = await api.call('/ops/leads?limit=200');
  assert.deepEqual(leads.leads, []);
  const saldo = await api.call('/ops/saldo');
  assert.equal(saldo.receitaCentimos, 0);
  const proj = await api.call('/ops/projetos');
  assert.deepEqual(proj.projetos, []);
  assert.equal(api.estado().leads, 0);
});

test('2 · quem és tu: o dono deste browser, sem senha e sem fingir contas', async () => {
  const api = createLocalApi({ storage: armazem() });
  const eu = await api.call('/auth/eu');
  assert.equal(eu.modo, 'local');
  assert.equal(eu.user.role, 'owner');
  assert.equal(eu.perms.escrever, true);
  assert.deepEqual(await api.call('/auth/sair', 'POST', {}), { ok: true });
});

test('3 · um lead escrito fica escrito (e sobrevive a outra instância)', async () => {
  const storage = armazem();
  const api = createLocalApi({ storage });
  const r = await api.call('/ops/leads', 'POST', { leads: [{ name: 'Barbearia do Largo', city: 'Coimbra', phone: '912345678', source: 'manual' }] });
  assert.equal(r.created, 1);
  assert.equal(r.updated, 0);
  const lido = await createLocalApi({ storage }).call('/ops/leads');
  assert.equal(lido.leads.length, 1);
  assert.equal(lido.leads[0].name, 'Barbearia do Largo');
  assert.equal(lido.leads[0].status, 'novo');
  assert.ok(lido.leads[0].created_at, 'o lead tem de ter data de criação');
  assert.ok(storage.getItem(CHAVE), 'o armazém não recebeu nada');
});

test('4 · o mesmo lead não entra duas vezes: atualiza', async () => {
  const api = createLocalApi({ storage: armazem() });
  await api.call('/ops/leads', 'POST', { leads: [{ name: 'Café Central', city: 'Lisboa' }] });
  const r = await api.call('/ops/leads', 'POST', { leads: [{ name: 'café central', city: 'LISBOA', phone: '900000000' }] });
  assert.equal(r.created, 0);
  assert.equal(r.updated, 1);
  const leads = (await api.call('/ops/leads')).leads;
  assert.equal(leads.length, 1, 'ficaram dois leads iguais');
  assert.equal(leads[0].phone, '900000000', 'os dados novos não atualizaram o lead');
});

test('5 · sem nome não se inventa um lead', async () => {
  const api = createLocalApi({ storage: armazem() });
  await assert.rejects(() => api.call('/ops/leads', 'POST', { leads: [{ city: 'Porto' }] }), /nome/);
});

test('6 · o dinheiro: entra, soma e apaga — sem custos inventados', async () => {
  const api = createLocalApi({ storage: armazem() });
  await api.call('/ops/receita', 'POST', { euros: 250.5, campaign: 'Coimbra · barbearias' });
  await api.call('/ops/receita', 'POST', { euros: 100, campaign: 'Coimbra · barbearias' });
  const s = await api.call('/ops/saldo');
  assert.equal(s.receitaCentimos, 35050);
  assert.equal(s.custoCentimos, 0, 'custos de API não podem aparecer sem terem existido');
  assert.equal(s.margemCentimos, 35050);
  assert.equal(s.porCampanha[0].campanha, 'Coimbra · barbearias');
  assert.equal(s.porCampanha[0].cents, 35050);
  assert.equal(s.entradas.length, 2);
  const cem = s.entradas.find((e) => e.amount_cents === 10000);
  await api.call(`/ops/receita/${cem.id}`, 'DELETE');
  assert.equal((await api.call('/ops/saldo')).receitaCentimos, 25050);
  await assert.rejects(() => api.call(`/ops/receita/${cem.id}`, 'DELETE'), (e) => e.status === 404);
});

test('7 · projetos: criado à mão e a partir de um lead, com os tipos', async () => {
  const api = createLocalApi({ storage: armazem() });
  const { projeto } = await api.call('/ops/projetos', 'POST', { name: 'Site do Largo', client: 'Barbearia', kind: 'site', city: 'Coimbra' });
  assert.equal(projeto.status, 'rascunho');
  assert.equal(projeto.kind, 'site');
  const a = await api.call('/ops/leads', 'POST', { leads: [{ name: 'Óptica Nova', city: 'Braga', category: 'óptica' }] });
  const leadId = a.leads[0].id;
  const doLead = await api.call(`/ops/leads/${leadId}/projeto`, 'POST', { kind: 'landing' });
  assert.equal(doLead.projeto.lead_id, leadId);
  const lista = await api.call('/ops/projetos');
  assert.equal(lista.projetos.length, 2);
  assert.equal(lista.resumo.total, 2);
  assert.equal(lista.tipos.length, 4);
  const um = await api.call(`/ops/projetos/${projeto.id}`);
  assert.equal(um.project.name, 'Site do Largo');
});

/* 1.53.2 · o modo local deixou de ser uma lápide: entrega a tarefa ao servidor
   por `/api/rpc` e devolve o resultado real. Sem servidor, diz que não alcançou
   — não diz «sem motor de IA» como se o motor não existisse. */
test('8 · tarefas: o modo local entrega-as ao servidor; sem servidor, diz porquê', async () => {
  const api = createLocalApi({ storage: armazem() });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  try {
    const { tarefa } = await api.call('/ops/tarefas', 'POST', { kind: 'briefing', entityId: 'p_1', entidade: 'projeto', aprovacao: true, correr: true });
    assert.equal(tarefa.state, 'failed', 'sem servidor a tarefa não pode aparecer concluída');
    assert.match(tarefa.error, /não alcançou o servidor/);
    assert.match(tarefa.error, /orbita-agentes\.vercel\.app/, 'a frase diz onde as tarefas correm');
    const correr = await api.call(`/ops/tarefas/${tarefa.id}/correr`, 'POST', {});
    assert.equal(correr.ok, false);
  } finally { globalThis.fetch = original; }
  const lista = await api.call('/ops/tarefas?limit=100');
  assert.equal(lista.tarefas.length, 1);
  assert.ok(lista.tipos.briefing, 'os tipos de tarefa têm de estar na lista');
  assert.ok(lista.departamentos.length >= 6);
  await assert.rejects(() => api.call('/ops/tarefas', 'POST', { kind: 'inventado' }), /desconhecido/);
});

test('8b · com o servidor a responder, o modo local guarda a tarefa REAL, com resultado', async () => {
  const api = createLocalApi({ storage: armazem() });
  const original = globalThis.fetch;
  let pedido = null;
  globalThis.fetch = async (url, init) => {
    pedido = { url, corpo: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ tarefa: { state: 'succeeded', resultado: 'briefing escrito pelo modelo', modelo: 'groq/llama-3.3-70b-versatile' }, execucao: { ok: true, modelo: 'groq/llama-3.3-70b-versatile', ms: 800 } }) };
  };
  try {
    const { tarefa, execucao } = await api.call('/ops/tarefas', 'POST', { kind: 'briefing', entityId: 'p_1', entidade: 'projeto' });
    assert.equal(tarefa.state, 'succeeded');
    assert.match(tarefa.resultado, /briefing escrito/);
    assert.equal(execucao.ok, true);
    assert.equal(pedido.url, '/api/rpc');
    assert.equal(pedido.corpo.caminho, '/ops/tarefas');
    assert.equal(pedido.corpo.metodo, 'POST');
  } finally { globalThis.fetch = original; }
});

test('9 · o vazio honesto: agentes, atividade e pesquisa não inventam nada', async () => {
  const api = createLocalApi({ storage: armazem() });
  const ag = await api.call('/ops/agentes');
  assert.equal(ag.resumo.running, 0);
  /* 1.84.0 · o elenco não é mais vazio: as seis salas somam 47 lugares, 5 dos quais com trabalho próprio. */
  assert.equal(ag.departamentos.reduce((n, d) => n + d.agentes.length, 0), 47);
  const comRotina = ag.departamentos.flatMap((d) => d.agentes).filter((a) => a.temRotina);
  assert.equal(comRotina.length, 5);
  for (const d of ag.departamentos) assert.ok(Array.isArray(d.agentes) && d.agentes.length > 0);
  assert.deepEqual((await api.call('/ops/atividade')).eventos, []);
  assert.deepEqual((await api.call('/ops/pesquisa?q=teste')).grupos, []);
  assert.deepEqual((await api.call('/ops/utilizadores')).utilizadores, []);
  const hoje = await api.call('/ops/today');
  assert.deepEqual(hoje.decidir, []);
  assert.equal(hoje.presenca.parado, false);
});

test('10 · o que ainda não existe diz que não existe (501), em vez de inventar', async () => {
  const api = createLocalApi({ storage: armazem() });
  await assert.rejects(() => api.call('/ops/qualquer-coisa'), (e) => e.status === 501 && /não faz/.test(e.message));
  await assert.rejects(() => api.call('/ops/leads/l_inexistente'), (e) => e.status === 404);
});

test('11 · a cópia de segurança: exportar e voltar a ler', async () => {
  const api = createLocalApi({ storage: armazem() });
  await api.call('/ops/leads', 'POST', { leads: [{ name: 'Padaria Alfa', city: 'Faro' }] });
  await api.call('/ops/receita', 'POST', { euros: 42 });
  const copia = api.exportar();
  const outro = createLocalApi({ storage: armazem() });
  const r = outro.importar(copia);
  assert.equal(r.leads, 1);
  assert.equal((await outro.call('/ops/saldo')).receitaCentimos, 4200);
  assert.throws(() => outro.importar('{"nada":true}'), /não é uma cópia/);
});

test('12 · o resumo e o funil contam o que existe, e só isso', async () => {
  const api = createLocalApi({ storage: armazem() });
  await api.call('/ops/leads', 'POST', { leads: [{ name: 'A', city: 'X' }, { name: 'B', city: 'Y', phone: '1' }] });
  const s = await api.call('/ops/summary');
  assert.equal(s.leads.total, 2);
  assert.equal(s.leads.comContacto, 1);
  assert.equal(s.custos.apiCentimos, 0);
  const p = await api.call('/ops/pipeline');
  assert.equal(p.totalLeads, 2);
  assert.equal(p.fases.find((f) => f.id === 'novo').leads, 2);
  assert.deepEqual(p.porOrigem, [{ origem: 'manual', total: 2, ganhos: 0, taxa: 0 }]);
});

test('13 · o armazém é um só: cada escrita atualiza a atividade', async () => {
  const api = createLocalApi({ storage: armazem() });
  await api.call('/ops/leads', 'POST', { leads: [{ name: 'Hotel Sul', city: 'Sines' }] });
  await api.call('/ops/receita', 'POST', { euros: 10 });
  const at = (await api.call('/ops/atividade?limit=20')).eventos;
  assert.equal(at.length, 2);
  assert.match(at[0].texto, /entrada/);
  assert.match(at[1].texto, /lead/);
  assert.ok(at.every((e) => e.at), 'cada evento tem de ter data');
});

test('23 · editar um lead no modo local: corrige o campo e não mexe no resto (1.36.0)', async () => {
  const storage = armazem();
  const api = createLocalApi({ storage });
  await api.call('/ops/leads', 'POST', { leads: [{ name: 'Padaria do Bairro', city: 'Coimbra', phone: '911111111', notes: 'falar com a dona' }] });
  const id = (await api.call('/ops/leads')).leads[0].id;

  const r = await api.call(`/ops/leads/${id}`, 'PATCH', { phone: ' 239 000 111 ', email: 'geral@padaria.pt', city: 'Coimbra' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.id, id);
  assert.equal(r.lead.phone, '239 000 111', 'o telefone tem de ficar sem espaços nas pontas');
  assert.equal(r.lead.email, 'geral@padaria.pt');
  assert.equal(r.lead.notes, 'falar com a dona', 'o que não veio no PATCH não pode ser apagado');

  /* apagar um campo é enviar vazio, e o silêncio também se guarda */
  const limpo = await api.call(`/ops/leads/${id}`, 'PATCH', { phone: '' });
  assert.equal(limpo.lead.phone, '');
  assert.equal(limpo.lead.email, 'geral@padaria.pt');

  /* e sobrevive a outra instância: ficou no armazém, não só na memória */
  const relido = await createLocalApi({ storage }).call(`/ops/leads/${id}`);
  assert.equal(relido.lead.email, 'geral@padaria.pt');

  await assert.rejects(() => api.call(`/ops/leads/${id}`, 'PATCH', {}), /nada para alterar/);
  await assert.rejects(() => api.call('/ops/leads/l_nao_existe', 'PATCH', { city: 'Porto' }), (e) => e.status === 404);
});

test('faturas no modo local: o documento existe e o número não salta — o PDF é que precisa de servidor', async () => {
  const api = createLocalApi({ storage: armazem() });
  const pedido = {
    cliente: { nome: 'Clínica do Mondego', nif: '509442013' },
    linhas: [{ descricao: 'Site institucional', quantidade: 1, precoEuros: 900 }],
    ivaTaxa: 23,
  };
  const a = await api.call('/ops/faturas', 'POST', pedido);
  assert.equal(a.fatura.codigo, '2026/0001');
  assert.equal(a.fatura.iva_centimos, 20700);
  assert.equal(a.fatura.total_centimos, 110700);
  assert.match(a.aviso, /PDF é gerado no servidor/, 'diz o que falta, em vez de um botão morto');

  const b = await api.call('/ops/faturas', 'POST', pedido);
  assert.equal(b.fatura.codigo, '2026/0002');
  await api.call(`/ops/faturas/${b.fatura.id}/anular`, 'POST', { motivo: 'duplicado' });
  const c = await api.call('/ops/faturas', 'POST', pedido);
  assert.equal(c.fatura.codigo, '2026/0003', 'a anulada não devolve o número');

  const lista = await api.call('/ops/faturas');
  assert.equal(lista.faturas.length, 4, 'três faturas e uma nota de crédito');
  assert.equal(lista.resumo.emitidas, 2);
  assert.equal(lista.resumo.anuladas, 1);
  assert.equal(lista.resumo.notasCredito, 1);
  assert.equal(lista.resumo.totalCentimos, 110700, 'duas faturas de 1 107 € menos a nota de crédito de 1 107 €');

  const envio = await api.call(`/ops/faturas/${a.fatura.id}/enviar`, 'POST', {});
  assert.equal(envio.enviado, false);
  assert.match(envio.motivo, /não há servidor de correio/i);

  await assert.rejects(() => api.call('/ops/faturas', 'POST', { cliente: { nome: 'X' }, linhas: [] }), /NIF do cliente|linha/);
  const saldo = await api.call('/ops/saldo');
  assert.equal(saldo.faturacao.totalCentimos, 110700, 'o saldo mostra o faturado à parte');
});

/* 1.60.0 · a autonomia no modo local: mesmas regras, guardada neste browser */
test('a autonomia local começa em «pede-me sempre» e recusa subir sem casos', async () => {
  const api = createLocalApi({ storage: armazem() });
  const inicio = await api.call('/ops/autonomia');
  assert.deepEqual(inicio.lista, []);
  assert.match(inicio.resumo.nota, /aprovação humana/);
  await assert.rejects(() => api.call('/ops/autonomia/email:geral/subir', 'POST', {}), (e) => e.status === 409);
});

test('a autonomia local guarda a decisão e sobrevive a outra instância', async () => {
  const storage = armazem();
  const api = createLocalApi({ storage });
  const subiu = await api.call('/ops/autonomia/email:geral/subir', 'POST', { force: true, motivo: 'decisão minha' });
  assert.equal(subiu.nivel, 'proposto');
  assert.equal(subiu.autonomia.decidido_por, 'dono (modo local)');
  const outra = await createLocalApi({ storage });
  const depois = await outra.call('/ops/autonomia');
  assert.equal(depois.lista.find((x) => x.escopo === 'email:geral').nivel, 'proposto');
  const desceu = await outra.call('/ops/autonomia/email:geral/descer', 'POST', {});
  assert.equal(desceu.nivel, 'pedir_sempre');
});

/* 1.61.0 · execuções no modo local: lista vazia com a razão, nunca um ecrã partido */
test('as execuções locais são vazias e dizem porquê', async () => {
  const api = createLocalApi({ storage: armazem() });
  const r = await api.call('/ia/runs');
  assert.deepEqual(r.runs, []);
  assert.equal(r.modo, 'local');
  assert.match(r.nota, /não corre nenhum agente/);
  await assert.rejects(() => api.call('/ia/runs/abc'), (e) => e.status === 503 && /vive no servidor/.test(e.message));
});
