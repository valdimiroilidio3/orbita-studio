/* ===========================================================================
   As rotas da mesa, uma vez só.

   Este ficheiro não sabe se a base é o Supabase ou a memória: recebe um `repo`
   com a interface de `_repo.mjs`. É por isso que as mesmas rotas podem ser
   provadas em teste (memória) e servidas em produção (Supabase) sem duas
   verdades diferentes.

   O contrato é o MESMO que a mesa já chamava em `src/mesa.js` e que o modo
   local (`src/localapi.js`) implementou: mudar de um para o outro não muda
   nada na interface.
   =========================================================================== */

const TIPOS_PROJETO = [
  { id: 'landing', label: 'Página de conversão' },
  { id: 'site', label: 'Site de empresa' },
  { id: 'loja', label: 'Loja online' },
  { id: 'app', label: 'Aplicação web' },
];
const TIPOS_TAREFA = {
  investigar: { label: 'Investigar o lead' },
  mensagem: { label: 'Escrever uma mensagem' },
  briefing: { label: 'Escrever o briefing' },
  codigo: { label: 'Gerar o código' },
  qa: { label: 'Auditoria de qualidade' },
};
const DEPARTAMENTOS = [
  { id: 'comando', nome: 'Comando' }, { id: 'prospeccao', nome: 'Prospecção' },
  { id: 'vendas', nome: 'Vendas' }, { id: 'media', nome: 'Media' },
  { id: 'design', nome: 'Design' }, { id: 'engenharia', nome: 'Engenharia' },
];

const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const dedupe = (nome, cidade) => `${semAcentos(nome)}|${semAcentos(cidade)}`;
const limpo = (s) => String(s ?? '').trim();
const cents = (eur) => Math.round((Number(eur) || 0) * 100);
const agoraIso = () => new Date().toISOString();

/** a mesa conhece os campos em camelCase/inglês; a base guarda-os em inglês também */
function leadDoCliente(l) {
  const nome = limpo(l?.name);
  if (!nome) return null;
  return {
    dedupe_key: dedupe(nome, l.city),
    name: nome,
    category: limpo(l.category) || null,
    city: limpo(l.city) || null,
    phone: limpo(l.phone) || null,
    email: limpo(l.email) || null,
    website: limpo(l.website) || null,
    source: limpo(l.source) || 'manual',
    status: 'novo',
    notes: limpo(l.notes) || null,
  };
}

function falha(status, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { status, corpo: { error: mensagem, ...extra } });
}

/* ---------- contas derivadas (as mesmas do servidor local) ---------- */
function resumoSaldo(receitas, janelaDias = 90) {
  const desde = new Date(Date.now() - janelaDias * 86400000).toISOString();
  const dentro = receitas.filter((r) => r.at >= desde);
  const receitaCentimos = dentro.reduce((n, r) => n + (r.amount_cents || 0), 0);
  const mapa = new Map();
  for (const r of dentro) {
    const k = r.campaign || 'sem campanha';
    mapa.set(k, (mapa.get(k) || 0) + (r.amount_cents || 0));
  }
  return {
    janela: { dias: janelaDias },
    receitaCentimos, custoCentimos: 0, margemCentimos: receitaCentimos,
    porCampanha: [...mapa.entries()].map(([campanha, c]) => ({ campanha, cents: c })).sort((a, b) => b.cents - a.cents),
    custosPorFornecedor: [], unitarios: {},
    entradas: dentro.slice(0, 40),
    semDados: {
      custo: 'Sem custos de API registados neste período.',
      receita: dentro.length ? null : 'Ainda não há entradas registadas. Uma fatura emitida fora do Órbita só entra se a escreveres aqui.',
    },
  };
}

function resumoPipeline(leads) {
  const fases = [
    { id: 'novo', label: 'Novos', teste: (l) => l.status === 'novo' },
    { id: 'contactado', label: 'Contactados', teste: (l) => l.status === 'contactado' },
    { id: 'respondeu', label: 'Responderam', teste: (l) => l.status === 'respondeu' },
    { id: 'ganho', label: 'Ganhos', teste: (l) => l.status === 'ganho' },
  ];
  const total = leads.length;
  const ganhos = leads.filter((l) => l.status === 'ganho').length;
  const origens = new Map();
  for (const l of leads) {
    const k = l.source || 'manual';
    const o = origens.get(k) || { total: 0, ganhos: 0 };
    o.total++; if (l.status === 'ganho') o.ganhos++;
    origens.set(k, o);
  }
  return {
    totalLeads: total,
    conversaoTotal: total ? Math.round((ganhos / total) * 100) : null,
    fases: fases.map((f) => { const n = leads.filter(f.teste).length; return { id: f.id, label: f.label, leads: n, conversao: total ? Math.round((n / total) * 100) : null }; }),
    porOrigem: [...origens.entries()].map(([origem, o]) => ({ origem, total: o.total, ganhos: o.ganhos, taxa: o.total ? Math.round((o.ganhos / o.total) * 100) : null })),
    paradas: { dias: 14, lista: [] },
    perdidos: leads.filter((l) => l.status === 'perdido').length,
  };
}

/* ---------- o encaminhador ---------- */
export async function responder(repo, { caminho, metodo = 'GET', corpo = null, env = process.env, fetchImpl = fetch }) {
  const caminhoLimpo = '/' + String(caminho || '').replace(/^\/+/, '').split('?')[0];

  /* ---- 1.18.0 · tudo o que é IA vive em api/_ia (fornecedores, router, agentes) ---- */
  if (caminhoLimpo === '/ia' || caminhoLimpo.startsWith('/ia/')) {
    const { rotasIA } = await import('./_ia/rotas.mjs');
    return rotasIA(repo, { caminho, metodo, corpo, env, fetchImpl });
  }

  const seg = caminhoLimpo.split('/').filter(Boolean);
  const qs = new URLSearchParams(String(caminho).split('?')[1] || '');
  const m = String(metodo || 'GET').toUpperCase();

  /* ---- quem és tu ---- */
  if (caminhoLimpo === '/auth/eu') {
    return { status: 200, corpo: {
      user: { id: 'base', name: 'Dono', email: '', role: 'owner', roleLabel: 'base de dados' },
      modo: 'base', perms: { ver: true, escrever: true, aprovar: true, admin: true, write: true, approve: true },
    } };
  }
  if (caminhoLimpo === '/auth/entrar' || caminhoLimpo === '/auth/sair' || caminhoLimpo === '/auth/primeiro-dono') {
    return { status: 200, corpo: { ok: true, modo: 'base' } };
  }

  /* ---- health: a prova de que a base responde ---- */
  if (caminhoLimpo === '/health') {
    const h = await repo.health();
    return { status: h.ok ? 200 : 503, corpo: { ...h, modo: 'base', versao: '1.17.0' } };
  }

  /* ---- Hoje ---- */
  if (caminhoLimpo === '/ops/summary') {
    const [leads, projetos] = await Promise.all([repo.leads.list(500), repo.projetos.list()]);
    return { status: 200, corpo: {
      leads: { total: leads.length, comContacto: leads.filter((l) => l.phone || l.email).length },
      projetos: { total: projetos.length },
      custos: { apiCentimos: 0 }, modo: 'base',
    } };
  }
  if (caminhoLimpo === '/ops/today') {
    const [rascunhos, leads] = await Promise.all([repo.mensagens.rascunhos(), repo.leads.list(500)]);
    const porId = new Map(leads.map((l) => [l.id, l]));
    return { status: 200, corpo: {
      decidir: rascunhos.map((x) => ({ id: x.id, kind: 'mensagem', channel: x.channel, lead: porId.get(x.lead_id) || null, body: x.body })),
      presenca: { parado: false }, modo: 'base',
    } };
  }

  /* ---- leads ---- */
  if (caminhoLimpo === '/ops/leads' && m === 'GET') {
    return { status: 200, corpo: { leads: await repo.leads.list(Number(qs.get('limit')) || 200) } };
  }
  if (caminhoLimpo === '/ops/leads' && m === 'POST') {
    const lista = (Array.isArray(corpo?.leads) ? corpo.leads : [corpo]).map(leadDoCliente).filter(Boolean);
    if (!lista.length) throw falha(400, 'o lead precisa de um nome');
    // quem já existe por dedupe_key é atualizado; quem não existe entra
    const existentes = await repo.leads.existentes(lista.map((l) => l.dedupe_key));
    const porChave = new Set(existentes.map((e) => e.dedupe_key));
    const novos = lista.filter((l) => !porChave.has(l.dedupe_key));
    const repetidos = lista.filter((l) => porChave.has(l.dedupe_key));
    if (novos.length) await repo.leads.inserir(novos);
    if (repetidos.length) await repo.leads.upsert(repetidos.map((l) => ({ ...l, updated_at: agoraIso() })));
    await repo.atividade.add('lead', `${novos.length} lead(s) novo(s), ${repetidos.length} atualizado(s)`);
    return { status: 200, corpo: { created: novos.length, updated: repetidos.length } };
  }
  if (seg[0] === 'ops' && seg[1] === 'leads' && seg.length === 3) {
    const lead = await repo.leads.byId(seg[2]);
    if (!lead) throw falha(404, 'lead não encontrado');
    if (m === 'GET') return { status: 200, corpo: { lead, dossier: null, messages: (await repo.mensagens.list(100)).filter((x) => x.lead_id === lead.id) } };
    if (m === 'PATCH') {
      const campos = {};
      for (const k of ['status', 'notes', 'phone', 'email', 'website', 'category', 'city', 'score']) if (corpo?.[k] !== undefined) campos[k] = corpo[k];
      const atualizado = await repo.leads.patch(lead.id, { ...campos, updated_at: agoraIso() });
      return { status: 200, corpo: { ok: true, lead: atualizado } };
    }
  }
  if (seg[0] === 'ops' && seg[1] === 'leads' && seg.length === 4 && seg[3] === 'projeto' && m === 'POST') {
    const lead = await repo.leads.byId(seg[2]);
    if (!lead) throw falha(404, 'lead não encontrado');
    const projeto = await repo.projetos.insert({
      name: lead.name, client: lead.name, niche: lead.category, city: lead.city,
      kind: limpo(corpo?.kind) || 'landing', status: 'rascunho', lead_id: lead.id,
    });
    await repo.atividade.add('projeto', `projeto «${projeto.name}» a partir do lead`);
    return { status: 201, corpo: { projeto } };
  }

  /* ---- mensagens ---- */
  if (caminhoLimpo === '/ops/messages' && m === 'GET') {
    return { status: 200, corpo: { messages: await repo.mensagens.list(Number(qs.get('limit')) || 100) } };
  }
  if (seg[0] === 'ops' && seg[1] === 'messages' && seg.length === 4 && m === 'POST') {
    const msg = await repo.mensagens.byId(seg[2]);
    if (!msg) throw falha(404, 'mensagem não encontrada');
    if (seg[3] === 'aprovar') {
      const m2 = await repo.mensagens.patch(msg.id, { status: 'aprovada', aprovada_at: agoraIso() });
      await repo.atividade.add('mensagem', 'mensagem aprovada');
      return { status: 200, corpo: { ok: true, message: m2 } };
    }
    if (seg[3] === 'rejeitar') {
      const m2 = await repo.mensagens.patch(msg.id, { status: 'rejeitada' });
      await repo.atividade.add('mensagem', 'mensagem rejeitada');
      return { status: 200, corpo: { ok: true, message: m2 } };
    }
    if (seg[3] === 'enviar') throw falha(501, 'não há canal de envio configurado (WhatsApp/email): aprovar não envia nada');
  }

  /* ---- projetos ---- */
  if (caminhoLimpo === '/ops/projetos' && m === 'GET') {
    const projetos = await repo.projetos.list();
    const por = (s) => projetos.filter((p) => p.status === s).length;
    return { status: 200, corpo: { projetos, resumo: { total: projetos.length, emQa: por('em_qa'), aprovados: por('aprovado'), entregues: por('entregue') }, tipos: TIPOS_PROJETO } };
  }
  if (caminhoLimpo === '/ops/projetos' && m === 'POST') {
    const nome = limpo(corpo?.name);
    if (!nome) throw falha(400, 'o projeto precisa de um nome');
    const projeto = await repo.projetos.insert({
      name: nome, client: limpo(corpo.client), niche: limpo(corpo.niche), city: limpo(corpo.city),
      kind: limpo(corpo.kind) || 'landing', status: 'rascunho', lead_id: null,
    });
    await repo.atividade.add('projeto', `projeto «${nome}» criado`);
    return { status: 201, corpo: { projeto } };
  }
  if (seg[0] === 'ops' && seg[1] === 'projetos' && seg.length === 3 && m === 'GET') {
    const projeto = await repo.projetos.byId(seg[2]);
    if (!projeto) throw falha(404, 'projeto não encontrado');
    return { status: 200, corpo: { project: projeto, qa: null, files: [], historico: [] } };
  }

  /* ---- tarefas: sem motor, dizem que não correram ---- */
  if (caminhoLimpo === '/ops/tarefas' && m === 'GET') {
    return { status: 200, corpo: {
      tarefas: await repo.tarefas.list(100), tipos: TIPOS_TAREFA, departamentos: DEPARTAMENTOS,
    } };
  }
  if (caminhoLimpo === '/ops/tarefas' && m === 'POST') {
    const tipo = limpo(corpo?.kind);
    if (!TIPOS_TAREFA[tipo]) throw falha(400, 'tipo de tarefa desconhecido');
    const tarefa = await repo.tarefas.insert({
      kind: tipo, entity_id: limpo(corpo.entityId) || null, entidade: limpo(corpo.entidade) || null,
      state: 'failed', error: 'sem motor de IA ligado a esta base — a tarefa fica registada, mas não foi executada',
      finished_at: agoraIso(),
    });
    await repo.atividade.add('tarefa', `${TIPOS_TAREFA[tipo].label}: sem motor`);
    return { status: 201, corpo: { tarefa } };
  }
  if (seg[0] === 'ops' && seg[1] === 'tarefas' && seg.length === 4 && m === 'POST') {
    const t = await repo.tarefas.byId(seg[2]);
    if (!t) throw falha(404, 'tarefa não encontrada');
    if (seg[3] === 'correr') return { status: 200, corpo: { ok: false, error: 'sem motor de IA ligado a esta base' } };
    if (seg[3] === 'aprovar' || seg[3] === 'rejeitar') {
      const t2 = await repo.tarefas.patch(t.id, { state: seg[3] === 'aprovar' ? 'succeeded' : 'cancelled' });
      return { status: 200, corpo: { ok: true, tarefa: t2 } };
    }
  }

  /* ---- dinheiro ---- */
  if (caminhoLimpo === '/ops/saldo') {
    const desde = new Date(Date.now() - 90 * 86400000).toISOString();
    return { status: 200, corpo: { ...resumoSaldo(await repo.receitas.desde(desde)), presenca: { parado: false } } };
  }
  if (caminhoLimpo === '/ops/receita' && m === 'POST') {
    const c = cents(corpo?.euros);
    if (!c) throw falha(400, 'diz o valor que entrou');
    const r = await repo.receitas.insert({ amount_cents: c, campaign: limpo(corpo.campaign) || null });
    await repo.atividade.add('receita', `entrada de ${(c / 100).toFixed(2)} €`);
    return { status: 201, corpo: { ok: true, euro: c / 100, entrada: r } };
  }
  if (seg[0] === 'ops' && seg[1] === 'receita' && seg.length === 3 && m === 'DELETE') {
    const apagou = await repo.receitas.remove(seg[2]);
    if (!apagou) throw falha(404, 'entrada não encontrada');
    return { status: 200, corpo: { ok: true } };
  }

  /* ---- o resto: o vazio honesto ---- */
  if (caminhoLimpo === '/ops/clientes') return { status: 200, corpo: { clientes: [{ id: 'base', nome: 'Órbita Studio', ativo: true }], activo: { id: 'base', nome: 'Órbita Studio' } } };
  if (caminhoLimpo === '/ops/pipeline') return { status: 200, corpo: resumoPipeline(await repo.leads.list(500)) };
  if (caminhoLimpo === '/ops/atividade') return { status: 200, corpo: { eventos: await repo.atividade.list(Number(qs.get('limit')) || 20) } };
  if (caminhoLimpo === '/ops/agentes') {
    const tarefas = await repo.tarefas.list(100);
    return { status: 200, corpo: {
      departamentos: DEPARTAMENTOS.map((x) => ({ ...x, agentes: [] })),
      resumo: { total: tarefas.length, running: 0, awaiting: tarefas.filter((t) => t.state === 'awaiting_approval').length },
      modo: 'base',
    } };
  }
  if (caminhoLimpo === '/ops/utilizadores') return { status: 200, corpo: { utilizadores: [], papeis: [] } };
  if (caminhoLimpo === '/ops/sessoes') return { status: 200, corpo: { sessoes: [] } };
  if (caminhoLimpo === '/ops/stop') return { status: 200, corpo: { ok: true, parado: !!corpo?.stop } };
  if (caminhoLimpo === '/ops/pesquisa') return { status: 200, corpo: { query: qs.get('q') || '', grupos: [] } };

  /* ---- trazer para a base uma cópia do modo local ---- */
  if (caminhoLimpo === '/ops/importar' && m === 'POST') {
    const leads = (corpo?.leads || []).map(leadDoCliente).filter(Boolean);
    const receitas = (corpo?.receitas || []).map((r) => ({ amount_cents: Number(r.amount_cents) || 0, campaign: limpo(r.campaign) || null, at: r.at || agoraIso() })).filter((r) => r.amount_cents > 0);
    const projetos = (corpo?.projetos || []).map((p) => ({ name: limpo(p.name), client: limpo(p.client) || null, niche: limpo(p.niche) || null, city: limpo(p.city) || null, kind: limpo(p.kind) || 'landing', status: 'rascunho', lead_id: null })).filter((p) => p.name);
    let leadsNovos = 0, leadsRepetidos = 0;
    if (leads.length) {
      const existentes = await repo.leads.existentes(leads.map((l) => l.dedupe_key));
      const chaves = new Set(existentes.map((e) => e.dedupe_key));
      const novos = leads.filter((l) => !chaves.has(l.dedupe_key));
      leadsNovos = novos.length; leadsRepetidos = leads.length - novos.length;
      if (novos.length) await repo.leads.inserir(novos);
    }
    for (const p of projetos) await repo.projetos.insert(p);
    for (const r of receitas) await repo.receitas.insert(r);
    await repo.atividade.add('importacao', `${leadsNovos} leads, ${projetos.length} projetos, ${receitas.length} entradas`);
    return { status: 200, corpo: { ok: true, leadsNovos, leadsRepetidos, projetos: projetos.length, receitas: receitas.length } };
  }

  throw falha(404, `a base ainda não serve «${caminhoLimpo}»`);
}
