// Prova do restauro com o repositório de PRODUÇÃO (createSupabaseRepo), não o
// de memória. O `fetch` é falso mas aplica `limit` e `offset` como o PostgREST.
//
// Porque existe: o repositório de memória não tem os limites do Supabase
// (leads.list corta em 500, projetos.list em 200). Com ele, uma cópia de uma
// base grande saía truncada e o ensaio dizia «ok» — o teste de memória não
// conseguia ver isto.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { exportar, testar } from './api/_backup.mjs';
import { createSupabaseRepo, createMemRepo } from './api/_repo.mjs';

const N = {
  orbita_leads: 1200,
  orbita_projects: 250,
  orbita_tasks: 350,
  orbita_messages: 320,
  orbita_receitas: 5200,
};

function dadosDeTeste() {
  const d = {};
  const iso = (i) => new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
  d.orbita_leads = Array.from({ length: N.orbita_leads }, (_, i) => ({
    id: `lead-${i}`, dedupe_key: `k${i}|coimbra`, name: `Clínica ${i}`, city: 'Coimbra',
    status: 'novo', source: 'geoapify', notes: null, created_at: iso(i), updated_at: iso(i),
  }));
  d.orbita_projects = Array.from({ length: N.orbita_projects }, (_, i) => ({
    id: `proj-${i}`, name: `Projeto ${i}`, kind: 'landing', status: 'rascunho', updated_at: iso(i), created_at: iso(i),
  }));
  d.orbita_tasks = Array.from({ length: N.orbita_tasks }, (_, i) => ({
    id: `task-${i}`, title: `Tarefa ${i}`, state: 'done', created_at: iso(i),
  }));
  d.orbita_messages = Array.from({ length: N.orbita_messages }, (_, i) => ({
    id: `msg-${i}`, body: `Mensagem ${i}`, status: 'enviada', created_at: iso(i),
  }));
  d.orbita_receitas = Array.from({ length: N.orbita_receitas }, (_, i) => ({
    id: `rec-${i}`, at: iso(i), valor: 10, descricao: `Receita ${i}`,
  }));
  return d;
}

/* PostgREST em miniatura: só lê `limit` e `offset` (é o que a cópia usa). */
function postgrest(dados) {
  const pedidos = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const tabela = u.pathname.split('/rest/v1/')[1];
    pedidos.push(u.search);
    const off = Number(u.searchParams.get('offset') || 0);
    const lim = u.searchParams.has('limit') ? Number(u.searchParams.get('limit')) : Infinity;
    const linhas = (dados[tabela] || []).slice(off, off + lim);
    return { ok: true, status: 200, text: async () => JSON.stringify(linhas) };
  };
  return { fetchImpl, pedidos };
}

const repoProducao = (dados) => {
  const { fetchImpl } = postgrest(dados);
  return createSupabaseRepo({ url: 'https://base.teste.invalid', key: 'chave-de-teste', fetchImpl });
};

test('cópia de produção: exporta TODAS as linhas, não só a primeira página', async () => {
  const repo = repoProducao(dadosDeTeste());
  const copia = await exportar(repo, { agora: new Date('2026-10-25T00:00:00Z') });
  assert.deepEqual(copia.falhas, [], `leituras com falha: ${copia.falhas.join(' · ')}`);
  assert.equal(copia.contagens.leads, N.orbita_leads, 'leads truncados');
  assert.equal(copia.contagens.projetos, N.orbita_projects, 'projetos truncados');
  assert.equal(copia.contagens.tarefas, N.orbita_tasks, 'tarefas truncadas');
  assert.equal(copia.contagens.mensagens, N.orbita_messages, 'mensagens truncadas');
  assert.equal(copia.contagens.receitas, N.orbita_receitas, 'receitas truncadas');
});

test('ensaio de restauro com produção: restaura tudo e confere linha a linha', async () => {
  const repo = repoProducao(dadosDeTeste());
  const r = await testar(repo, { criarDestino: () => createMemRepo() });
  assert.equal(r.ok, true, (r.problemas || []).join(' · '));
  assert.equal(r.restaurado.leads, N.orbita_leads);
  assert.equal(r.restaurado.projetos, N.orbita_projects);
  assert.equal(r.restaurado.tarefas, N.orbita_tasks);
  assert.equal(r.restaurado.mensagens, N.orbita_messages);
  assert.equal(r.restaurado.receitas, N.orbita_receitas);
});

test('a cópia não pede mais do que o Supabase aceita numa só página (≤ 1000)', async () => {
  const { fetchImpl, pedidos } = postgrest(dadosDeTeste());
  const repo = createSupabaseRepo({ url: 'https://base.teste.invalid', key: 'k', fetchImpl });
  await exportar(repo);
  for (const s of pedidos) {
    const lim = new URLSearchParams(s).get('limit');
    if (lim !== null) assert.ok(Number(lim) <= 1000, `pedido com limit=${lim}: ${s}`);
  }
});
