/* ===========================================================================
   1.17.0 · A BASE DE DADOS A SÉRIO (30 out 2026)

   A mesa já falava `/api`; o que faltava era um `/api` que existisse em produção.
   Este módulo é a única porta para o Postgres do Supabase: fala REST (PostgREST)
   com a chave secreta, que vive só na Vercel — o browser nunca a vê.

   Porquê REST e não `pg`: a chave que existe é a secreta do Supabase (formato
   `sb_secret_…`), não uma password de Postgres. O PostgREST dá-nos o mesmo
   resultado sem abrir um socket, e a função da Vercel fica mais leve.

   Duas implementações da MESMA interface:
     · createSupabaseRepo — a base real;
     · createMemRepo      — memória, para os testes provarem as rotas sem rede.
   =========================================================================== */

const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const chaveLead = (nome, cidade) => `${semAcentos(nome)}|${semAcentos(cidade)}`;

export function envBase(env = process.env) {
  const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '');
  return { url, key, pronto: !!(url && key) };
}

/* ---------- a base real ---------- */
export function createSupabaseRepo({ url, key, fetchImpl = fetch } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base || !key) throw new Error('faltam SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente');

  async function pedir(caminho, { method = 'GET', body, prefer, head = false } = {}) {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    let r;
    try {
      r = await fetchImpl(`${base}/rest/v1/${caminho}`, {
        method: head ? 'HEAD' : method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw Object.assign(new Error(`sem ligação à base: ${e.message}`), { status: 503 });
    }
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    if (!r.ok) {
      const msg = (dados && (dados.message || dados.hint || dados.error)) || texto || `HTTP ${r.status}`;
      // 42P01 = tabela que não existe: é o sinal de que o SQL do esquema não foi aplicado
      const semTabela = /does not exist|42P01|Could not find the table/i.test(msg);
      throw Object.assign(new Error(semTabela ? 'a base existe mas falta o esquema (corre supabase/orbita_mesa.sql)' : msg), {
        status: semTabela ? 503 : r.status, semEsquema: semTabela, detalhe: dados,
      });
    }
    return dados;
  }
  const q = (v) => encodeURIComponent(v);
  const um = (linhas) => (Array.isArray(linhas) ? linhas[0] || null : linhas || null);

  return {
    tipo: 'supabase',
    async health() {
      const tabelas = ['orbita_leads', 'orbita_projects', 'orbita_tasks', 'orbita_messages', 'orbita_receitas', 'orbita_atividade'];
      const faltam = [];
      for (const t of tabelas) {
        try { await pedir(`${t}?select=id&limit=1`, { head: false }); }
        catch (e) { if (e.semEsquema) faltam.push(t); else throw e; }
      }
      return { ok: faltam.length === 0, base: base.replace(/^https?:\/\//, '').split('.')[0], faltam };
    },

    leads: {
      async list(limit = 200) {
        return (await pedir(`orbita_leads?select=*&order=created_at.desc&limit=${Math.min(500, limit)}`)) || [];
      },
      async byId(id) { return um(await pedir(`orbita_leads?select=*&id=eq.${q(id)}&limit=1`)); },
      async existentes(chaves) {
        if (!chaves.length) return [];
        const lista = chaves.map((k) => `"${k.replace(/"/g, '')}"`).join(',');
        const linhas = await pedir(`orbita_leads?select=id,dedupe_key&dedupe_key=in.(${encodeURIComponent(lista)})`);
        return linhas || [];
      },
      async inserir(muitos) {
        if (!muitos.length) return [];
        return (await pedir('orbita_leads', { method: 'POST', body: muitos, prefer: 'return=representation' })) || [];
      },
      async upsert(muitos) {
        if (!muitos.length) return [];
        return (await pedir('orbita_leads?on_conflict=dedupe_key', {
          method: 'POST', body: muitos, prefer: 'return=representation,resolution=merge-duplicates',
        })) || [];
      },
      async patch(id, campos) {
        const r = await pedir(`orbita_leads?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
        return um(r);
      },
    },

    projetos: {
      async list() { return (await pedir('orbita_projects?select=*&order=updated_at.desc&limit=200')) || []; },
      async byId(id) { return um(await pedir(`orbita_projects?select=*&id=eq.${q(id)}&limit=1`)); },
      async insert(p) { return um(await pedir('orbita_projects', { method: 'POST', body: p, prefer: 'return=representation' })); },
    },

    tarefas: {
      async list(limit = 100) { return (await pedir(`orbita_tasks?select=*&order=created_at.desc&limit=${Math.min(300, limit)}`)) || []; },
      async byId(id) { return um(await pedir(`orbita_tasks?select=*&id=eq.${q(id)}&limit=1`)); },
      async insert(t) { return um(await pedir('orbita_tasks', { method: 'POST', body: t, prefer: 'return=representation' })); },
      async patch(id, campos) {
        const r = await pedir(`orbita_tasks?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
        return um(r);
      },
    },

    mensagens: {
      async list(limit = 100) { return (await pedir(`orbita_messages?select=*&order=created_at.desc&limit=${Math.min(300, limit)}`)) || []; },
      async byId(id) { return um(await pedir(`orbita_messages?select=*&id=eq.${q(id)}&limit=1`)); },
      async rascunhos() { return (await pedir('orbita_messages?select=*&status=eq.rascunho&order=created_at.desc&limit=50')) || []; },
      async inserir(m) { return um(await pedir('orbita_messages', { method: 'POST', body: m, prefer: 'return=representation' })); },
      /* 1.37.0 · a Meta repete o webhook: o id lá de fora é a chave que impede a
         mesma resposta de aparecer duas vezes na mesa */
      async porExterno(x) { return um(await pedir(`orbita_messages?select=*&id_externo=eq.${q(x)}&limit=1`)); },
      async patch(id, campos) {
        const r = await pedir(`orbita_messages?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
        return um(r);
      },
    },

    receitas: {
      async desde(iso, limite = 200) {
        return (await pedir(`orbita_receitas?select=*&at=gte.${q(iso)}&order=at.desc&limit=${limite}`)) || [];
      },
      async insert(r) { return um(await pedir('orbita_receitas', { method: 'POST', body: r, prefer: 'return=representation' })); },
      async remove(id) {
        const r = await pedir(`orbita_receitas?id=eq.${q(id)}`, { method: 'DELETE', prefer: 'return=representation' });
        return Array.isArray(r) ? r.length > 0 : !!r;
      },
    },

    atividade: {
      async list(limit = 20) { return (await pedir(`orbita_atividade?select=*&order=at.desc&limit=${Math.min(200, limit)}`)) || []; },
      async add(tipo, texto) { return um(await pedir('orbita_atividade', { method: 'POST', body: { tipo, texto }, prefer: 'return=minimal' })); },
    },

    /* ---- 1.18.0 · a memória da IA: execuções, passos, uso e configuração ---- */
    ia: {
      config: {
        async ler() {
          const linhas = (await pedir('orbita_ai_config?select=chave,valor')) || [];
          return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
        },
        async gravar(chave, valor) {
          await pedir('orbita_ai_config?on_conflict=chave', {
            method: 'POST', body: { chave, valor, actualizado: new Date().toISOString() },
            prefer: 'resolution=merge-duplicates,return=minimal',
          });
          return true;
        },
      },
      runs: {
        async criar(r) { return um(await pedir('orbita_ai_runs', { method: 'POST', body: r, prefer: 'return=representation' })); },
        async actualizar(id, campos) {
          const r = await pedir(`orbita_ai_runs?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
          return um(r);
        },
        async porId(id) { return um(await pedir(`orbita_ai_runs?select=*&id=eq.${q(id)}&limit=1`)); },
        async listar(limit = 30) { return (await pedir(`orbita_ai_runs?select=*&order=criado.desc&limit=${Math.min(100, limit)}`)) || []; },
      },
      steps: {
        async criar(s) { return um(await pedir('orbita_ai_steps', { method: 'POST', body: s, prefer: 'return=representation' })); },
        async actualizar(id, campos) {
          const r = await pedir(`orbita_ai_steps?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
          return um(r);
        },
        async porRun(runId) { return (await pedir(`orbita_ai_steps?select=*&run_id=eq.${q(runId)}&order=ordem.asc`)) || []; },
      },
      uso: {
        async registar(u) {
          return um(await pedir('orbita_ai_uso', { method: 'POST', body: u, prefer: 'return=minimal' }));
        },
        async latencias() {
          const linhas = (await pedir('orbita_ai_uso?select=fornecedor,modelo,ms&ok=eq.true&order=criado.desc&limit=300')) || [];
          const soma = new Map();
          for (const l of linhas) {
            const k = `${l.fornecedor}\u0000${l.modelo}`;
            const a = soma.get(k) || { n: 0, ms: 0 };
            soma.set(k, { n: a.n + 1, ms: a.ms + (l.ms || 0) });
          }
          const out = {};
          for (const [k, a] of soma) out[k] = Math.round(a.ms / a.n);
          return out;
        },
        async recentes(limit = 200) {
          return (await pedir(`orbita_ai_uso?select=*&order=criado.desc&limit=${Math.min(500, limit)}`)) || [];
        },
      },
      /* 1.19.0 · memória (plugins do Graft) e trabalhos de media (OpenMontage) */
      memoria: {
        async listar({ projeto = null, limite = 500 } = {}) {
          const filtro = projeto ? `projeto=eq.${q(projeto)}&` : '';
          return (await pedir(`orbita_ai_memoria?select=*&${filtro}order=actualizado.desc&limit=${Math.min(500, limite)}`)) || [];
        },
        async criar(nota) {
          return um(await pedir('orbita_ai_memoria', { method: 'POST', body: { ...nota, usos: 0 }, prefer: 'return=representation' }));
        },
        async usar(idNota) {
          await pedir(`orbita_ai_memoria?id=eq.${q(idNota)}`, {
            method: 'PATCH', body: { ultimo_uso: new Date().toISOString() },
            prefer: 'return=minimal',
          }).catch(() => {});
          return true;
        },
        async apagar(idNota) {
          await pedir(`orbita_ai_memoria?id=eq.${q(idNota)}`, { method: 'DELETE', prefer: 'return=minimal' });
          return true;
        },
      },
      media: {
        async criar(job) { return um(await pedir('orbita_media_jobs', { method: 'POST', body: job, prefer: 'return=representation' })); },
        async actualizar(idJob, campos) {
          return um(await pedir(`orbita_media_jobs?id=eq.${q(idJob)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' }));
        },
        async porId(idJob) { return um(await pedir(`orbita_media_jobs?select=*&id=eq.${q(idJob)}&limit=1`)); },
        async listar(limit = 30) { return (await pedir(`orbita_media_jobs?select=*&order=criado.desc&limit=${Math.min(100, limit)}`)) || []; },
      },
    },
  };
}

/* ---------- a mesma interface, em memória (testes) ---------- */
export function createMemRepo(seed = {}) {
  const d = {
    leads: [], projetos: [], tarefas: [], mensagens: [], receitas: [], atividade: [],
    iaRuns: [], iaSteps: [], iaUso: [], iaConfig: {}, iaMemoria: [], mediaJobs: [],
    ...JSON.parse(JSON.stringify(seed)),
  };
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  const agora = () => new Date().toISOString();
  return {
    tipo: 'memoria',
    _dados: d,
    async health() { return { ok: true, base: 'memoria', faltam: [] }; },
    leads: {
      async list(limit = 200) { return [...d.leads].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); },
      async byId(i) { return d.leads.find((l) => l.id === i) || null; },
      async existentes(chaves) { return d.leads.filter((l) => chaves.includes(l.dedupe_key)).map((l) => ({ id: l.id, dedupe_key: l.dedupe_key })); },
      // na base o `id` e o `created_at` nascem do Postgres; aqui nascem daqui
      async inserir(muitos) {
        const novos = muitos.map((l) => ({ id: id('l'), created_at: agora(), ...l }));
        d.leads.push(...novos);
        return novos;
      },
      async upsert(muitos) {
        const out = [];
        for (const m of muitos) {
          const i = d.leads.findIndex((l) => l.dedupe_key === m.dedupe_key);
          if (i >= 0) { d.leads[i] = { ...d.leads[i], ...m, id: d.leads[i].id }; out.push(d.leads[i]); }
          else { d.leads.push(m); out.push(m); }
        }
        return out;
      },
      async patch(i, campos) {
        const l = d.leads.find((x) => x.id === i);
        if (!l) return null;
        Object.assign(l, campos, { updated_at: agora() });
        return l;
      },
    },
    projetos: {
      async list() { return [...d.projetos].sort((a, b) => b.updated_at.localeCompare(a.updated_at)); },
      async byId(i) { return d.projetos.find((p) => p.id === i) || null; },
      async insert(p) { const novo = { id: id('p'), created_at: agora(), updated_at: agora(), ...p }; d.projetos.push(novo); return novo; },
    },
    tarefas: {
      async list(limit = 100) { return [...d.tarefas].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); },
      async byId(i) { return d.tarefas.find((t) => t.id === i) || null; },
      async insert(t) { const novo = { id: id('t'), created_at: agora(), ...t }; d.tarefas.push(novo); return novo; },
      async patch(i, campos) { const t = d.tarefas.find((x) => x.id === i); if (!t) return null; Object.assign(t, campos); return t; },
    },
    mensagens: {
      async list(limit = 100) { return [...d.mensagens].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); },
      async byId(i) { return d.mensagens.find((m) => m.id === i) || null; },
      async rascunhos() { return d.mensagens.filter((m) => m.status === 'rascunho'); },
      async inserir(m) { const novo = { id: id('m'), created_at: agora(), status: 'rascunho', ...m }; d.mensagens.push(novo); return novo; },
      async porExterno(x) { return d.mensagens.find((m) => m.id_externo === x) || null; },
      async patch(i, campos) { const m = d.mensagens.find((x) => x.id === i); if (!m) return null; Object.assign(m, campos); return m; },
    },
    receitas: {
      async desde(iso, limite = 200) { return d.receitas.filter((r) => r.at >= iso).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limite); },
      async insert(r) { const novo = { id: id('r'), at: agora(), ...r }; d.receitas.push(novo); return novo; },
      async remove(i) { const antes = d.receitas.length; d.receitas = d.receitas.filter((r) => r.id !== i); return d.receitas.length < antes; },
    },
    atividade: {
      async list(limit = 20) { return [...d.atividade].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit); },
      async add(tipo, texto) { d.atividade.unshift({ id: id('a'), tipo, texto, at: agora() }); },
    },

    /* mesma interface que o Supabase, para os testes provarem o orquestrador sem rede */
    ia: {
      config: {
        async ler() { return { ...d.iaConfig }; },
        async gravar(chave, valor) { d.iaConfig[chave] = valor; return true; },
      },
      runs: {
        async criar(r) { const novo = { id: id('run'), criado: agora(), estado: 'novo', ...r }; d.iaRuns.unshift(novo); return novo; },
        async actualizar(i, campos) { const r = d.iaRuns.find((x) => x.id === i); if (!r) return null; Object.assign(r, campos); return r; },
        async porId(i) { return d.iaRuns.find((x) => x.id === i) || null; },
        async listar(limit = 30) { return [...d.iaRuns].slice(0, limit); },
      },
      steps: {
        async criar(s) { const novo = { id: id('st'), criado: agora(), ...s }; d.iaSteps.push(novo); return novo; },
        async actualizar(i, campos) { const s = d.iaSteps.find((x) => x.id === i); if (!s) return null; Object.assign(s, campos); return s; },
        async porRun(runId) { return d.iaSteps.filter((s) => s.run_id === runId).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)); },
      },
      uso: {
        async registar(u) { d.iaUso.unshift({ id: id('u'), criado: agora(), ...u }); return true; },
        async latencias() {
          const soma = new Map();
          for (const l of d.iaUso.filter((u) => u.ok)) {
            const k = `${l.fornecedor}\u0000${l.modelo}`;
            const a = soma.get(k) || { n: 0, ms: 0 };
            soma.set(k, { n: a.n + 1, ms: a.ms + (l.ms || 0) });
          }
          return Object.fromEntries([...soma].map(([k, a]) => [k, Math.round(a.ms / a.n)]));
        },
        async recentes(limit = 200) { return d.iaUso.slice(0, limit); },
      },
      memoria: {
        async listar({ projeto = null, limite = 500 } = {}) {
          const lista = projeto ? d.iaMemoria.filter((n) => n.projeto === projeto) : d.iaMemoria;
          return [...lista].sort((a, b) => String(b.actualizado || '').localeCompare(String(a.actualizado || ''))).slice(0, limite);
        },
        async criar(nota) {
          const nova = { id: id('mem'), criado: agora(), actualizado: agora(), usos: 0, ...nota };
          d.iaMemoria.unshift(nova);
          return nova;
        },
        async usar(idNota) {
          const n = d.iaMemoria.find((x) => x.id === idNota);
          if (n) { n.usos = Number(n.usos || 0) + 1; n.ultimo_uso = agora(); }
          return true;
        },
        async apagar(idNota) {
          const i = d.iaMemoria.findIndex((x) => x.id === idNota);
          if (i >= 0) d.iaMemoria.splice(i, 1);
          return true;
        },
      },
      media: {
        async criar(job) { const novo = { id: id('mjob'), criado: agora(), estado: 'pedido', ...job }; d.mediaJobs.unshift(novo); return novo; },
        async actualizar(i, campos) { const j = d.mediaJobs.find((x) => x.id === i); if (!j) return null; Object.assign(j, campos); return j; },
        async porId(i) { return d.mediaJobs.find((x) => x.id === i) || null; },
        async listar(limit = 30) { return d.mediaJobs.slice(0, limit); },
      },
    },
  };
}
