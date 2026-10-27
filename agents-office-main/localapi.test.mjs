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

test('8 · tarefas: registadas, mas sem motor dizem que não correram', async () => {
  const api = createLocalApi({ storage: armazem() });
  const { tarefa } = await api.call('/ops/tarefas', 'POST', { kind: 'briefing', entityId: 'p_1', entidade: 'projeto', aprovacao: true, correr: true });
  assert.equal(tarefa.state, 'failed', 'uma tarefa sem motor não pode aparecer concluída');
  assert.match(tarefa.error, /sem motor/);
  const correr = await api.call(`/ops/tarefas/${tarefa.id}/correr`, 'POST', {});
  assert.equal(correr.ok, false);
  const lista = await api.call('/ops/tarefas?limit=100');
  assert.equal(lista.tarefas.length, 1);
  assert.ok(lista.tipos.briefing, 'os tipos de tarefa têm de estar na lista');
  assert.ok(lista.departamentos.length >= 6);
  await assert.rejects(() => api.call('/ops/tarefas', 'POST', { kind: 'inventado' }), /desconhecido/);
});

test('9 · o vazio honesto: agentes, atividade e pesquisa não inventam nada', async () => {
  const api = createLocalApi({ storage: armazem() });
  const ag = await api.call('/ops/agentes');
  assert.equal(ag.resumo.running, 0);
  assert.deepEqual(ag.departamentos.map((d) => d.agentes), [[], [], [], [], [], []]);
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
