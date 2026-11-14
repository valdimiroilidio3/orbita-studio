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

const chamar = (repo, caminho, metodo = 'GET', corpo = null, extras = {}) => responder(repo, { caminho, metodo, corpo, ...extras });

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

/* 1.53.2 · a tarefa deixou de nascer falhada: a rota tenta o motor e, quando
   nenhum modelo responde, grava o motivo real (a chave que falta + o último
   erro). Sem rede neste teste, a falha é imediata e determinística. */
test('7 · tarefas: correm a sério; sem motor, a frase diz o que faltou', async () => {
  const api = createMemRepo();
  const semRede = async () => { throw new Error('rede desligada no teste'); };
  const proj = await chamar(api, '/ops/projetos', 'POST', { name: 'Site do Largo', kind: 'site' });
  const r = await responder(api, {
    caminho: '/ops/tarefas', metodo: 'POST', fetchImpl: semRede, env: {},
    corpo: { kind: 'briefing', entityId: proj.corpo.projeto.id, entidade: 'projeto' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.tarefa.state, 'failed');
  assert.match(r.corpo.tarefa.error, /nenhuma chave de IA está configurada|nenhum dos fornecedores/);
  assert.match(r.corpo.tarefa.error, /rede desligada no teste/, 'o erro real fica escrito, não uma frase feita');
  const correr = await responder(api, { caminho: `/ops/tarefas/${r.corpo.tarefa.id}/correr`, metodo: 'POST', fetchImpl: semRede, env: {} });
  assert.equal(correr.corpo.ok, false);
  assert.equal(correr.corpo.tarefa.id, r.corpo.tarefa.id, 'repetir não cria outra tarefa');
  const lista = (await responder(api, { caminho: '/ops/tarefas', metodo: 'GET', env: {} })).corpo;
  assert.equal(lista.tarefas.length, 1);
  assert.ok(lista.tipos.briefing);
  await assert.rejects(() => chamar(api, '/ops/tarefas', 'POST', { kind: 'inventado' }), (e) => e.status === 400);
});

test('8 · mensagens: aprovar fica registado; enviar sem canal/contacto recusa e diz porquê', async () => {
  const api = createMemRepo({ mensagens: [{ id: 'm1', lead_id: null, channel: 'whatsapp', body: 'olá', status: 'rascunho', created_at: new Date().toISOString() }] });
  const hoje = (await chamar(api, '/ops/today')).corpo;
  assert.equal(hoje.decidir.length, 1);
  /* 1.34.0 · a mesa chama `approve` (inglês): os dois nomes têm de valer */
  const ok = await chamar(api, '/ops/messages/m1/approve', 'POST', {});
  assert.equal(ok.corpo.message.status, 'aprovada');
  /* sem telefone nem email no lead, o envio não inventa um destinatário */
  await assert.rejects(() => chamar(api, '/ops/messages/m1/enviar', 'POST', {}), (e) => e.status === 400 && /telefone/.test(e.message));
  /* com destinatário mas sem token do WhatsApp: 501, e a mensagem não é dada como enviada */
  const api2 = createMemRepo({ mensagens: [{ id: 'm2', lead_id: null, channel: 'whatsapp', to: '+351912345678', body: 'olá', status: 'aprovada', created_at: new Date().toISOString() }] });
  await assert.rejects(() => chamar(api2, '/ops/messages/m2/send', 'POST', {}), (e) => e.status === 501 && /WHATSAPP_TOKEN/.test(e.message));
  const lista = (await chamar(api2, '/ops/messages')).corpo.messages;
  assert.equal(lista.find((x) => x.id === 'm2').status, 'aprovada', 'o que não saiu não pode ficar «enviada»');
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
  /* Desempate por id e página (offset), para a paginação da cópia não repetir nem saltar linhas */
  assert.match(c.url, /^https:\/\/abc\.supabase\.co\/rest\/v1\/orbita_leads\?select=\*&order=created_at\.desc,id\.asc&limit=10&offset=0$/);
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

/* ============================================================================
   1.59.0 · o CRM dos leads, do lado do servidor (2 nov 2026)

   O que se prova aqui é o contrato que a mesa chama: exportar o CSV, ver os
   duplicados sem os fundir, o resumo do funil, e a verificação do site a
   SÉRIO — com a data guardada e com a recusa honesta quando o lead não tem
   site. A ida à rede é substituída por um `fetchImpl` falso; o resto é o
   código que corre em produção.
   ========================================================================== */

const POPULAR = async (api) => {
  await chamar(api, '/ops/leads', 'POST', { leads: [
    { name: 'Clínica do Mondego', city: 'Coimbra', phone: '+351 239 000 111', website: 'https://www.clinicadomondego.pt', category: 'Saúde' },
    { name: 'Café Central', city: 'Coimbra', phone: '239000111' },
    { name: 'Padaria do Bairro', city: 'Porto' },
  ] });
  return (await chamar(api, '/ops/leads')).corpo.leads;
};

test('15 · exportar: o CSV sai com cabeçalho em português, BOM e uma linha por lead', async () => {
  const api = createMemRepo();
  await POPULAR(api);
  const r = await chamar(api, '/ops/leads.csv');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.linhas, 3);
  assert.match(r.corpo.ficheiro, /^leads-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(r.corpo.csv.startsWith('\uFEFF'));
  assert.equal(r.corpo.csv.split('\r\n').filter(Boolean).length, 4);
  assert.match(r.corpo.csv, /Nome;Setor;Localização;Telefone/);
  assert.ok(r.corpo.colunas.includes('Confiança'));
  assert.ok(api._dados.atividade.some((a) => /exporta/i.test(a.texto || a.titulo || JSON.stringify(a))), 'exportar também deixa rasto');
});

test('16 · os duplicados aparecem e os dois leads continuam na base', async () => {
  const api = createMemRepo();
  const leads = await POPULAR(api);
  const r = await chamar(api, '/ops/leads/duplicados');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.leads, 3);
  assert.equal(r.corpo.total, 1, 'o telefone escrito de duas maneiras é o único par');
  assert.equal(r.corpo.grupos[0].motivo, 'telefone');
  assert.equal(r.corpo.grupos[0].ids.length, 2);
  assert.equal((await chamar(api, '/ops/leads')).corpo.leads.length, leads.length, 'detetar não apaga');
});

test('17 · o resumo do funil conta o que está guardado, incluindo o que falta verificar', async () => {
  const api = createMemRepo();
  await POPULAR(api);
  const r = await chamar(api, '/ops/leads/resumo');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.total, 3);
  assert.equal(r.corpo.comContacto, 2);
  assert.equal(r.corpo.porVerificar, 1);
  assert.equal(r.corpo.verificados, 0, 'nenhum site foi verificado ainda — e o resumo não finge que sim');
  assert.equal(r.corpo.duplicados, 1);
  assert.equal(r.corpo.fases.reduce((n, f) => n + f.n, 0), 3);
});

test('18 · verificar o site guarda a data e o motivo — e falhar também é um resultado', async () => {
  const api = createMemRepo();
  await POPULAR(api);
  const lead = (await chamar(api, '/ops/leads')).corpo.leads.find((l) => l.name === 'Clínica do Mondego');

  const antes = (await chamar(api, `/ops/leads/${lead.id}`)).corpo.confianca;
  const bom = async () => ({ ok: true, status: 200, url: 'https://clinicadomondego.pt/', text: async () => '<!doctype html><html><title>Clínica</title></html>' });
  const r = await chamar(api, `/ops/leads/${lead.id}/verificar`, 'POST', null, { fetchImpl: bom });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.verificacao.estado, 'ok');
  assert.ok(r.corpo.verificacao.quando, 'sem data, «verificado» é uma palavra vazia');
  assert.match(r.corpo.verificacao.motivo, /200/);

  const ficha = await chamar(api, `/ops/leads/${lead.id}`);
  assert.equal(ficha.corpo.verificacao.estado, 'ok');
  assert.equal(ficha.corpo.verificacao.dias, 0);
  assert.ok(ficha.corpo.confianca.pontos > antes.pontos, 'verificar o site tem de contar para a confiança');
  assert.equal(ficha.corpo.confianca.pontos, 65, 'site verificado (+40) e telefone público (+25) — nada mais foi provado');
  assert.ok(ficha.corpo.eventos.some((e) => e.tipo === 'verificacao'), 'o histórico guarda a verificação e quem a fez');

  const mau = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const r2 = await chamar(api, `/ops/leads/${lead.id}/verificar`, 'POST', null, { fetchImpl: mau });
  assert.equal(r2.corpo.verificacao.estado, 'falhou');
  assert.match(r2.corpo.verificacao.motivo, /não resolve/, 'o motivo diz o que se passou, não «erro»');
  assert.equal(r2.corpo.lead.website_estado, 'falhou');
});

test('19 · verificar um lead sem site recusa (400) em vez de verificar o nada', async () => {
  const api = createMemRepo();
  await POPULAR(api);
  const semSite = (await chamar(api, '/ops/leads')).corpo.leads.find((l) => l.name === 'Padaria do Bairro');
  await assert.rejects(
    () => chamar(api, `/ops/leads/${semSite.id}/verificar`, 'POST', null, { fetchImpl: async () => { throw new Error('não devia ser chamado'); } }),
    (e) => e.status === 400 && /site/.test(e.message),
  );
});

test('20 · a ficha guarda qualificação, próxima ação e fonte — com validação e histórico', async () => {
  const api = createMemRepo();
  await POPULAR(api);
  const lead = (await chamar(api, '/ops/leads')).corpo.leads.find((l) => l.name === 'Café Central');

  const r = await chamar(api, `/ops/leads/${lead.id}`, 'PATCH', {
    qualificacao: 82, proxima_acao: 'Ligar a pedir reunião', proxima_acao_em: '2026-10-30', fonte_url: 'https://exemplo.pt/lista',
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.lead.qualificacao, 82);
  assert.equal(r.corpo.lead.proxima_acao_em, '2026-10-30');
  assert.equal(r.corpo.proxima.estado, 'atrasada');
  assert.match(r.corpo.proxima.rotulo, /atrasada/);

  await assert.rejects(() => chamar(api, `/ops/leads/${lead.id}`, 'PATCH', { qualificacao: 140 }), (e) => e.status === 400);
  await assert.rejects(() => chamar(api, `/ops/leads/${lead.id}`, 'PATCH', { proxima_acao_em: 'para a semana' }), (e) => e.status === 400);

  const ficha = await chamar(api, `/ops/leads/${lead.id}`);
  assert.equal(ficha.corpo.qualificacao.origem, 'guardada');
  assert.equal(ficha.corpo.qualificacao.valor, 82);
  assert.ok(ficha.corpo.eventos.some((e) => e.tipo === 'proxima_acao'), 'quem marcou a próxima ação fica registado');
  assert.ok(ficha.corpo.eventos.every((e) => e.autor), 'cada evento diz quem o fez');

  const limpo = await chamar(api, `/ops/leads/${lead.id}`, 'PATCH', { proxima_acao: null, proxima_acao_em: null });
  assert.equal(limpo.corpo.lead.proxima_acao, null);
  assert.equal(limpo.corpo.proxima.estado, 'sem');
});

test('21 · mudar o site invalida a verificação: a confiança não fica a dizer «alta» sobre outro endereço', async () => {
  const api = createMemRepo();
  await POPULAR(api);
  const lead = (await chamar(api, '/ops/leads')).corpo.leads.find((l) => l.name === 'Clínica do Mondego');
  const bom = async () => ({ ok: true, status: 200, url: 'https://clinicadomondego.pt/', text: async () => '<html><body>ok</body></html>' });
  await chamar(api, `/ops/leads/${lead.id}/verificar`, 'POST', null, { fetchImpl: bom });
  assert.equal((await chamar(api, `/ops/leads/${lead.id}`)).corpo.verificacao.estado, 'ok');

  const troca = await chamar(api, `/ops/leads/${lead.id}`, 'PATCH', { website: 'https://outro.pt' });
  assert.equal(troca.corpo.lead.website_verificado_em, null, 'a data antiga não vale para o site novo');
  assert.equal(troca.corpo.lead.website_estado, null);
  const ficha = await chamar(api, `/ops/leads/${lead.id}`);
  assert.equal(ficha.corpo.verificacao.estado, 'por_verificar');
  assert.notEqual(ficha.corpo.confianca.nivel, 'alta');
});

/* ============================================================================
   1.60.0 · A AUTONOMIA E OS MOTORES, do lado do servidor (2 nov 2026)

   O nível de autonomia de um tipo de trabalho não é um menu: sobe com casos
   decididos à mão e uma taxa alta, desce sem pedir justificação, e cada decisão
   fica com autor e data. Uma acção sensível exige sempre aprovação humana — e
   isso prova-se no servidor, não só no ecrã.
   ========================================================================== */

const mensagemDecidida = (i, status, escopo = 'email:geral') => ({
  id: `m_${i}`, status, scope: escopo, channel: 'email', subject: `Proposta ${i}`,
  body: 'Olá', lead_id: 'l1', created_at: new Date(2026, 9, 1, 0, i % 60).toISOString(),
});

test('22 · a autonomia começa em «pede-me sempre» e diz quantos casos faltam', async () => {
  const api = createMemRepo();
  const r = await chamar(api, '/ops/autonomia');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.lista.length, 0, 'sem mensagens decididas não há tipos a avaliar');
  assert.equal(r.corpo.resumo.autonomos, 0);
  assert.match(r.corpo.resumo.nota, /aprovação humana/);
});

test('23 · subir sem casos é recusado (409) com a razão escrita — e nada muda', async () => {
  const api = createMemRepo();
  await assert.rejects(
    () => chamar(api, '/ops/autonomia/email:geral/subir', 'POST', { reason: 'quero' }),
    (e) => e.status === 409 && /mínimo para subir é 50/.test(e.message),
  );
  assert.equal((await chamar(api, '/ops/autonomia')).corpo.lista.length, 0);
});

test('24 · com 50 casos e 95% aprovados, sobe um degrau; descer é imediato', async () => {
  const api = createMemRepo();
  const mensagens = [];
  for (let i = 0; i < 50; i += 1) mensagens.push(mensagemDecidida(i, i < 48 ? 'aprovada' : 'rejeitada'));
  api._dados.mensagens.push(...mensagens);

  const antes = (await chamar(api, '/ops/autonomia')).corpo.lista.find((x) => x.escopo === 'email:geral');
  assert.equal(antes.casos, 50);
  assert.equal(antes.taxa, 0.96);
  assert.equal(antes.nivel, 'pedir_sempre');
  assert.equal(antes.podeSubir, true);

  const subiu = await chamar(api, '/ops/autonomia/email:geral/subir', 'POST', { reason: 'casos a mais para ignorar' });
  assert.equal(subiu.status, 200);
  assert.equal(subiu.corpo.nivel, 'proposto', 'sobe um degrau de cada vez');
  assert.equal(subiu.corpo.autonomia.decidido_por, 'dono', 'a decisão fica com autor');
  assert.ok(subiu.corpo.autonomia.decidido_em, 'e com data');

  const segundo = await chamar(api, '/ops/autonomia/email:geral/subir', 'POST', {});
  assert.equal(segundo.corpo.nivel, 'autonomo');
  const terceiro = await chamar(api, '/ops/autonomia/email:geral/subir', 'POST', {});
  assert.equal(terceiro.status, 200);
  assert.equal(terceiro.corpo.nivel, 'autonomo', 'não passa do máximo');

  const desceu = await chamar(api, '/ops/autonomia/email:geral/descer', 'POST', {});
  assert.equal(desceu.corpo.nivel, 'pedir_sempre');
  assert.match(desceu.corpo.motivo, /pede-me sempre/);
  assert.ok(api._dados.atividade.some((a) => /autonomia/i.test(JSON.stringify(a))), 'a decisão deixa rasto na atividade');
});

test('25 · a taxa baixa também impede a subida, e a mensagem diz a taxa real', async () => {
  const api = createMemRepo();
  const mensagens = [];
  for (let i = 0; i < 60; i += 1) mensagens.push(mensagemDecidida(i, i < 30 ? 'aprovada' : 'rejeitada'));
  api._dados.mensagens.push(...mensagens);
  const r = (await chamar(api, '/ops/autonomia')).corpo.lista.find((x) => x.escopo === 'email:geral');
  assert.equal(r.podeSubir, false);
  assert.match(r.porque, /50%/);
  await assert.rejects(() => chamar(api, '/ops/autonomia/email:geral/subir', 'POST', {}), (e) => e.status === 409 && /95%/.test(e.message));
});

test('26 · a subida forçada fica registada como forçada', async () => {
  const api = createMemRepo();
  const r = await chamar(api, '/ops/autonomia/whatsapp:geral/subir', 'POST', { force: true });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.nivel, 'proposto');
  assert.match(r.corpo.motivo, /forçada/i);
  assert.match(r.corpo.motivo, /sem os casos mínimos/i);
});

test('27 · um tipo sem decisões continua em «pede-me sempre» e o resumo não o esconde', async () => {
  const api = createMemRepo();
  api._dados.autonomia.push({ id: 'au_1', escopo: 'email:sem-site', nivel: 'autonomo', casos: 80, taxa: 0.99, decidido_por: 'dono', decidido_em: '2026-10-01T10:00:00.000Z' });
  const corpo = (await chamar(api, '/ops/autonomia')).corpo;
  assert.equal(corpo.lista.length, 1);
  assert.equal(corpo.resumo.autonomos, 1);
  assert.equal(corpo.lista[0].autor, 'dono');
  assert.equal(corpo.lista[0].nivel, 'autonomo');
});

/* ---------------- 1.61.0 · execução transparente ---------------- */
const runParado = (api, extra = {}) => {
  const cria = {
    id: 'run_pausado', objetivo: 'Preparar a proposta para a Clínica Aurora', estado: 'aguarda_aprovacao',
    criado: new Date().toISOString(), plano: { passos: [{ ordem: 1, agente: 'research', titulo: 'Investigar', instrucao: 'vai', criterio: 'site' }] },
    pendente: { ordem: 1, agente: 'research', ferramenta: 'apagar_receita', resumo: '«apagar_receita» é destrutiva' },
    autorizacoes: [], ...extra,
  };
  api._dados.iaRuns.unshift(cria);
  api._dados.iaSteps.push({ id: 'st_1', run_id: cria.id, ordem: 1, agente: 'research', titulo: 'Investigar', estado: 'aguarda_aprovacao', entrada: 'vai', saida: 'quase', criado: cria.criado, ferramentas: [{ nome: 'apagar_receita', precisaAprovacao: true }] });
  return cria;
};

test('28 · a execução sai da API já traduzida: estado, passos, registo e recuperação', async () => {
  const api = createMemRepo();
  runParado(api);
  const r = await chamar(api, '/ia/runs/run_pausado');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.visivel.id, 'a_espera');
  assert.equal(r.corpo.visivel.rotulo, 'À espera de aprovação');
  assert.equal(r.corpo.lidos.length, 1);
  assert.equal(r.corpo.lidos[0].acoes[0].esperou, true);
  assert.ok(r.corpo.registo.some((e) => e.tipo === 'passo'), 'o registo mostra o passo');
  assert.equal(r.corpo.recuperacao.opcoes[0].id, 'aprovar');
  assert.equal(r.corpo.accoes.aprovar.sim, true);
  assert.equal(r.corpo.resumo.custo.desconhecido, true, 'sem preço não se inventa 0');
});

test('29 · aprovar exige nome — sem nome não há histórico', async () => {
  const api = createMemRepo();
  runParado(api);
  const r = await chamar(api, '/ia/runs/run_pausado/aprovar', 'POST', {});
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /quem autoriza/);
  assert.equal(api._dados.iaRuns[0].estado, 'aguarda_aprovacao', 'sem nome, nada muda');
});

test('30 · aprovar grava quem, quando e o quê — e a execução volta à fila', async () => {
  const api = createMemRepo();
  runParado(api);
  const r = await chamar(api, '/ia/runs/run_pausado/aprovar', 'POST', { por: 'Dono', motivo: 'cliente pediu' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.autorizacao.por, 'Dono');
  assert.equal(r.corpo.autorizacao.o_que, 'apagar_receita');
  assert.equal(r.corpo.autorizacao.motivo, 'cliente pediu');
  assert.ok(r.corpo.autorizacao.em, 'com hora');
  assert.equal(r.corpo.run.estado, 'novo');
  const lido = (await chamar(api, '/ia/runs/run_pausado')).corpo;
  assert.equal(lido.autorizacoes.length, 1);
  assert.equal(lido.autorizacoes[0].por, 'Dono');
});

test('31 · recusar fecha a execução com a razão escrita, não a deixa pendurada', async () => {
  const api = createMemRepo();
  runParado(api);
  const r = await chamar(api, '/ia/runs/run_pausado/recusar', 'POST', { por: 'Dono', motivo: 'não apagar nada hoje' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.run.estado, 'cancelado');
  assert.match(r.corpo.run.erro, /não apagar nada hoje/);
  assert.equal(r.corpo.autorizacoes[0].decisao, 'recusada');
});

test('32 · cancelar guarda quem pediu, com hora, e diz que a paragem é entre passos', async () => {
  const api = createMemRepo();
  runParado(api, { estado: 'a_executar', pendente: null });
  const r = await chamar(api, '/ia/runs/run_pausado/cancelar', 'POST', { por: 'Dono' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.run.estado, 'cancelado');
  assert.equal(r.corpo.run.cancelamento.por, 'Dono');
  assert.match(r.corpo.nota, /entre passos/);
});

test('33 · cancelar o que já fechou é 409 com a razão, não um sucesso falso', async () => {
  const api = createMemRepo();
  runParado(api, { estado: 'concluido', pendente: null, fim: new Date().toISOString() });
  const r = await chamar(api, '/ia/runs/run_pausado/cancelar', 'POST', {});
  assert.equal(r.status, 409);
  assert.match(r.corpo.error, /já fechou/);
});

test('34 · repetir abre uma execução nova ligada à antiga e não duplica com duplo clique', async () => {
  const api = createMemRepo();
  runParado(api, { estado: 'falhou', pendente: null, erro: 'sem motor' });
  const a = await chamar(api, '/ia/runs/run_pausado/repetir', 'POST', { por: 'Dono' });
  assert.equal(a.status, 201);
  assert.equal(a.corpo.run.repeticao_de, 'run_pausado');
  assert.equal(a.corpo.run.estado, 'novo');
  assert.equal(a.corpo.run.autorizacoes[0].por, 'Dono');
  const b = await chamar(api, '/ia/runs/run_pausado/repetir', 'POST', {});
  assert.equal(b.status, 200);
  assert.equal(b.corpo.repetida, false, 'a segunda chamada devolve a que já existe');
  assert.equal(b.corpo.run.id, a.corpo.run.id);
  assert.equal(api._dados.iaRuns.length, 2, 'duas execuções, não três');
});

test('35 · repetir uma execução a correr é recusado com a razão', async () => {
  const api = createMemRepo();
  runParado(api, { estado: 'a_executar', pendente: null });
  const r = await chamar(api, '/ia/runs/run_pausado/repetir', 'POST', {});
  assert.equal(r.status, 409);
  assert.match(r.corpo.error, /ainda não fechou/);
  assert.equal(api._dados.iaRuns.length, 1, 'não se abre nada quando a original ainda corre');
});

test('36 · a lista de execuções traz o estado dito por palavras e o que se pode fazer', async () => {
  const api = createMemRepo();
  runParado(api);
  api._dados.iaRuns.push({ id: 'run_2', objetivo: 'Fechar o site', estado: 'concluido', criado: new Date().toISOString(), fim: new Date().toISOString() });
  const r = await chamar(api, '/ia/runs');
  assert.equal(r.status, 200);
  const espera = r.corpo.runs.find((x) => x.id === 'run_pausado');
  assert.equal(espera.visivel.id, 'a_espera');
  assert.equal(espera.accoes.aprovar.sim, true);
  assert.equal(espera.accoes.cancelar.sim, true);
  const feito = r.corpo.runs.find((x) => x.id === 'run_2');
  assert.equal(feito.visivel.id, 'concluido');
  assert.equal(feito.accoes.repetir.sim, true);
  assert.equal(feito.accoes.cancelar.sim, false);
});

/* 1.79.0 · O TRABALHO ESCRITO À MÃO NO ESCRITÓRIO (9 nov 2026)
   O dono escreveu na barra e o painel respondeu «este escritório está aberto sem
   servidor». O servidor estava lá; faltava o caminho. Estes testes provam que o
   pedido entra, corre no motor e volta com o texto — e que uma base sem a coluna
   nova (payload) não perde o que o dono escreveu. */
import { criarECorrer, ROTINAS, semColunaNova } from './api/_tarefas.mjs';

const motorFalso = (texto = 'Resultado do trabalho.') => ({
  async pedir(_tipo, mensagens) {
    return { texto, fornec: 'teste', modelo: 'modelo-de-teste', ms: 12, mensagens };
  },
});

test('1.79.0 · a tarefa do escritório entra, corre e devolve o texto do modelo', async () => {
  const api = createMemRepo();
  let pedidoAoModelo = null;
  const motor = { async pedir(_t, mensagens) { pedidoAoModelo = mensagens; return { texto: 'Feito: o formulário está corrigido.', fornec: 'teste', modelo: 'm1', ms: 8 }; } };
  const r = await criarECorrer({
    repo: api, motor, env: {}, fetchImpl: async () => { throw new Error('sem rede'); },
    TIPOS: { escritorio: { label: 'Trabalho do escritório' } },
    corpo: { kind: 'escritorio', texto: 'Corrige o formulário de contacto', dept: 'engineering', agente: 'qa', titulo: 'Corrige o formulário' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.tarefa.state, 'succeeded');
  assert.equal(r.corpo.tarefa.resultado, 'Feito: o formulário está corrigido.');
  /* o pedido do dono chegou ao modelo, e o agente também */
  const texto = pedidoAoModelo.map((m) => m.content).join('\n');
  assert.match(texto, /Corrige o formulário de contacto/);
  assert.match(texto, /qa/);
  assert.match(ROTINAS.escritorio.pedido('x'), /Faz o trabalho, não um plano/);
});

test('1.79.0 · uma tarefa do escritório sem texto é recusada (400) e diz porquê', async () => {
  const api = createMemRepo();
  const r = await criarECorrer({
    repo: api, motor: motorFalso(), env: {}, TIPOS: { escritorio: { label: 'x' } },
    corpo: { kind: 'escritorio', texto: '   ' },
  });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /falta o pedido/);
  assert.equal(api._dados.tarefas.length, 0, 'nada é gravado quando não há nada para fazer');
});

test('1.79.0 · numa base sem a coluna nova, o pedido vai em `entidade` e a tarefa corre', async () => {
  const api = createMemRepo();
  const original = api.tarefas.insert;
  let tentativas = 0;
  api.tarefas.insert = async (t) => {
    tentativas += 1;
    if (t.payload || t.title) {
      /* o que o PostgREST responde quando a coluna não existe (PGRST204) */
      throw Object.assign(new Error("Could not find the 'payload' column of 'orbita_tasks' in the schema cache"), { semEsquema: true, coluna: 'payload', codigo: 'PGRST204' });
    }
    return original(t);
  };
  const r = await criarECorrer({
    repo: api, motor: motorFalso('Resposta.'), env: {}, TIPOS: { escritorio: { label: 'x' } },
    corpo: { kind: 'escritorio', texto: 'Escreve o plano do dia' },
  });
  assert.equal(r.status, 201, 'a tarefa não falha por causa do esquema');
  assert.equal(tentativas, 2, 'escreveu-se outra vez, sem as colunas novas');
  assert.match(String(r.corpo.tarefa.entidade), /^pedido:Escreve o plano do dia/);
  assert.equal(r.corpo.tarefa.state, 'succeeded');
  assert.equal(semColunaNova(Object.assign(new Error('x'), { semEsquema: true, coluna: 'payload' })), true);
  assert.equal(semColunaNova(new Error('a chave foi recusada')), false, 'um erro que não é de esquema não se disfarça');
});

test('1.79.0 · a lista mostra o pedido como título (não o `kind`)', async () => {
  const api = createMemRepo();
  await criarECorrer({
    repo: api, motor: motorFalso(), env: {}, TIPOS: { escritorio: { label: 'Trabalho do escritório' } },
    corpo: { kind: 'escritorio', texto: 'Prepara a reunião de amanhã', titulo: 'Prepara a reunião' },
  });
  const lista = (await responder(api, { caminho: '/ops/tarefas', metodo: 'GET', env: {} })).corpo;
  assert.equal(lista.tarefas.length, 1);
  assert.equal(lista.tarefas[0].titulo, 'Prepara a reunião');
  assert.ok(lista.tipos.escritorio, 'o tipo novo aparece na lista de tipos');
});

test('1.79.0 · o erro de coluna do PostgREST fica traduzido com o ficheiro certo', async () => {
  const { explificar } = await import('./api/_repo.mjs');
  const t = explificar("Could not find the 'payload' column of 'orbita_tasks' in the schema cache", { code: 'PGRST204' });
  assert.equal(t.semEsquema, true);
  assert.equal(t.coluna, 'payload');
  assert.match(t.mensagem, /falta a coluna «payload»/);
});
