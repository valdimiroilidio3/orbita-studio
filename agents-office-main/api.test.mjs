// Testes do `/api` da base de dados (30 out 2026).
//
// Duas coisas que têm de ser verdade:
//   1. as ROTAS (api/_rotas.mjs) cumprem o contrato que a mesa já chama — provadas contra a
//      implementação em memória, sem rede;
//   2. o CLIENTE do Supabase (api/_repo.mjs) fala PostgREST como deve: cabeçalhos, upsert por
//      dedupe_key, e uma mensagem clara quando o esquema não foi aplicado.
//
// O que aqui NÃO se prova: a ligação real ao projeto Supabase — o sandbox não sai para
// supabase.co. Isso prova-se em produção, em /api/health, depois do deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responder } from './api/_rotas.mjs';
import { createMemRepo, createSupabaseRepo, envBase, chaveLead } from './api/_repo.mjs';

const chamar = (repo, caminho, metodo = 'GET', corpo = null) => responder(repo, { caminho, metodo, corpo });

test('1 · quem és tu e a prova de saúde', async () => {
  const api = createMemRepo();
  const eu = await chamar(api, '/auth/eu');
  assert.equal(eu.status, 200);
  assert.equal(eu.corpo.modo, 'base');
  assert.equal(eu.corpo.perms.admin, true);
  const h = await chamar(api, '/health');
  assert.equal(h.status, 200);
  assert.equal(h.corpo.ok, true);
});

test('2 · um lead escreve-se na base e volta na leitura', async () => {
  const api = createMemRepo();
  const r = await chamar(api, '/ops/leads', 'POST', { leads: [{ name: 'Barbearia do Largo', city: 'Coimbra', phone: '912345678' }] });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.created, 1);
  assert.equal(r.corpo.updated, 0);
  const lido = await chamar(api, '/ops/leads?limit=200');
  assert.equal(lido.corpo.leads.length, 1);
  assert.equal(lido.corpo.leads[0].status, 'novo');
  assert.equal(api._dados.atividade.length, 1, 'a escrita tem de deixar rasto na atividade');
});

test('3 · o mesmo lead não duplica: atualiza', async () => {
  const api = createMemRepo();
  await chamar(api, '/ops/leads', 'POST', { leads: [{ name: 'Café Central', city: 'Lisboa' }] });
  const r = await chamar(api, '/ops/leads', 'POST', { leads: [{ name: 'café central', city: 'LISBOA', phone: '900000000' }] });
  assert.equal(r.corpo.created, 0);
  assert.equal(r.corpo.updated, 1);
  const leads = (await chamar(api, '/ops/leads')).corpo.leads;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].phone, '900000000');
  assert.equal(chaveLead('Café Central', 'Lisboa'), 'cafe central|lisboa');
});

test('4 · sem nome não entra (400), com estado de lead inválido também não', async () => {
  const api = createMemRepo();
  await assert.rejects(() => chamar(api, '/ops/leads', 'POST', { leads: [{ city: 'Porto' }] }), (e) => e.status === 400);
});

test('5 · dinheiro: entra, soma, apaga e diz que não há custos', async () => {
  const api = createMemRepo();
  await chamar(api, '/ops/receita', 'POST', { euros: 250.5, campaign: 'Coimbra' });
  await chamar(api, '/ops/receita', 'POST', { euros: 100, campaign: 'Coimbra' });
  const s = (await chamar(api, '/ops/saldo')).corpo;
  assert.equal(s.receitaCentimos, 35050);
  assert.equal(s.custoCentimos, 0);
  assert.equal(s.porCampanha[0].cents, 35050);
  const cem = s.entradas.find((e) => e.amount_cents === 10000);
  assert.equal((await chamar(api, `/ops/receita/${cem.id}`, 'DELETE')).status, 200);
  assert.equal((await chamar(api, '/ops/saldo')).corpo.receitaCentimos, 25050);
  await assert.rejects(() => chamar(api, `/ops/receita/${cem.id}`, 'DELETE'), (e) => e.status === 404);
});

test('6 · projetos: à mão e a partir de um lead; tipos e resumo', async () => {
  const api = createMemRepo();
  const a = await chamar(api, '/ops/projetos', 'POST', { name: 'Site do Largo', kind: 'site' });
  assert.equal(a.status, 201);
  const lead = (await chamar(api, '/ops/leads', 'POST', { leads: [{ name: 'Óptica Nova', city: 'Braga' }] }));
  assert.equal(lead.corpo.created, 1);
  const id = api._dados.leads[0].id;
  const b = await chamar(api, `/ops/leads/${id}/projeto`, 'POST', { kind: 'landing' });
  assert.equal(b.status, 201);
  assert.equal(b.corpo.projeto.lead_id, id);
  const lista = (await chamar(api, '/ops/projetos')).corpo;
  assert.equal(lista.projetos.length, 2);
  assert.equal(lista.resumo.total, 2);
  assert.equal(lista.tipos.length, 4);
  const um = await chamar(api, `/ops/projetos/${a.corpo.projeto.id}`);
  assert.equal(um.corpo.project.name, 'Site do Largo');
});

test('7 · tarefas: registadas e honestas sobre a falta de motor', async () => {
  const api = createMemRepo();
  const r = await chamar(api, '/ops/tarefas', 'POST', { kind: 'briefing', entityId: 'p_1', entidade: 'projeto' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.tarefa.state, 'failed');
  assert.match(r.corpo.tarefa.error, /sem motor/);
  const correr = await chamar(api, `/ops/tarefas/${r.corpo.tarefa.id}/correr`, 'POST', {});
  assert.equal(correr.corpo.ok, false);
  const lista = (await chamar(api, '/ops/tarefas')).corpo;
  assert.equal(lista.tarefas.length, 1);
  assert.ok(lista.tipos.briefing);
  await assert.rejects(() => chamar(api, '/ops/tarefas', 'POST', { kind: 'inventado' }), (e) => e.status === 400);
});

test('8 · mensagens: aprovar fica registado; enviar diz que não há canal', async () => {
  const api = createMemRepo({ mensagens: [{ id: 'm1', lead_id: null, channel: 'whatsapp', body: 'olá', status: 'rascunho', created_at: new Date().toISOString() }] });
  const hoje = (await chamar(api, '/ops/today')).corpo;
  assert.equal(hoje.decidir.length, 1);
  const ok = await chamar(api, '/ops/messages/m1/aprovar', 'POST', {});
  assert.equal(ok.corpo.message.status, 'aprovada');
  await assert.rejects(() => chamar(api, '/ops/messages/m1/enviar', 'POST', {}), (e) => e.status === 501);
});

test('9 · o vazio honesto e o 404 do que não existe', async () => {
  const api = createMemRepo();
  assert.deepEqual((await chamar(api, '/ops/pesquisa?q=x')).corpo.grupos, []);
  assert.deepEqual((await chamar(api, '/ops/atividade')).corpo.eventos, []);
  assert.equal((await chamar(api, '/ops/pipeline')).corpo.totalLeads, 0);
  assert.equal((await chamar(api, '/ops/agentes')).corpo.resumo.running, 0);
  await assert.rejects(() => chamar(api, '/ops/nao-existe'), (e) => e.status === 404);
});

test('10 · importar a cópia do modo local para a base', async () => {
  const api = createMemRepo();
  const r = await chamar(api, '/ops/importar', 'POST', {
    leads: [{ name: 'Padaria Alfa', city: 'Faro' }, { name: 'Hotel Sul', city: 'Sines' }],
    receitas: [{ amount_cents: 4200, campaign: 'Faro' }],
    projetos: [{ name: 'Site da Padaria', city: 'Faro' }],
  });
  assert.equal(r.corpo.leadsNovos, 2);
  assert.equal(r.corpo.receitas, 1);
  assert.equal(api._dados.leads.length, 2);
  // e uma segunda importação não duplica leads
  const r2 = await chamar(api, '/ops/importar', 'POST', { leads: [{ name: 'Padaria Alfa', city: 'Faro' }] });
  assert.equal(r2.corpo.leadsNovos, 0);
  assert.equal(r2.corpo.leadsRepetidos, 1);
});

/* ---------- o cliente do Supabase ---------- */
test('11 · o cliente fala PostgREST com a chave certa e nunca a expõe na URL', async () => {
  const chamadas = [];
  const falso = async (url, opt) => {
    chamadas.push({ url, opt });
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'l1', name: 'X' }]) };
  };
  const repo = createSupabaseRepo({ url: 'https://abc.supabase.co', key: 'sb_secret_xyz', fetchImpl: falso });
  await repo.leads.list(10);
  const c = chamadas[0];
  assert.match(c.url, /^https:\/\/abc\.supabase\.co\/rest\/v1\/orbita_leads\?select=\*&order=created_at\.desc&limit=10$/);
  assert.equal(c.opt.headers.apikey, 'sb_secret_xyz');
  assert.equal(c.opt.headers.Authorization, 'Bearer sb_secret_xyz');
  assert.ok(!c.url.includes('sb_secret'), 'a chave não pode ir na URL');
});

test('12 · o upsert usa on_conflict pelo dedupe_key', async () => {
  const chamadas = [];
  const falso = async (url, opt) => { chamadas.push({ url, opt }); return { ok: true, status: 201, text: async () => '[]' }; };
  const repo = createSupabaseRepo({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: falso });
  await repo.leads.upsert([{ dedupe_key: 'a|b', name: 'A' }]);
  assert.match(chamadas[0].url, /on_conflict=dedupe_key/);
  assert.match(chamadas[0].opt.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(chamadas[0].opt.method, 'POST');
});

test('13 · tabela em falta não é «rede em baixo»: é «falta o esquema»', async () => {
  const falso = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ code: '42P01', message: 'relation "public.orbita_leads" does not exist' }) });
  const repo = createSupabaseRepo({ url: 'https://abc.supabase.co', key: 'k', fetchImpl: falso });
  await assert.rejects(() => repo.leads.list(10), (e) => e.semEsquema === true && e.status === 503 && /esquema/.test(e.message));
});

test('14 · sem URL/chave, o ambiente diz que não está pronto (e a mesa cai no local)', () => {
  assert.equal(envBase({}).pronto, false);
  assert.equal(envBase({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_a' }).pronto, true);
  assert.equal(envBase({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJ...' }).pronto, true, 'a chave antiga também serve');
});
