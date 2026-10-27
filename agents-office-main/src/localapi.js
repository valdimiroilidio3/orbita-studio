/* ===========================================================================
   1.16.0 · A MESA SEM SERVIDOR (30 out 2026)

   Pedido do dono: «todas estas páginas já deram aceitar e estar muito bem
   funcionais, chega de demonstrações só».

   O que estava mal: publicada na Vercel, a mesa não tem `/api` atrás (a Vercel
   só serve ficheiros estáticos) e mostrava um cartão a dizer «precisa do Órbita
   a correr na tua máquina». Para quem abre o site, isso é uma demonstração.

   O que este módulo faz: implementa **os mesmos endpoints** que a mesa já
   chamava (`/auth/*`, `/ops/*`), mas contra um armazém no próprio browser
   (`localStorage`). A mesa não sabe a diferença — continua a chamar `call()`,
   continua a ler as mesmas formas — mas o que ela escreve FICA.

   Regras deste armazém, iguais às do servidor:
   · nada de dados de demonstração: começa vazio e só tem o que for escrito;
   · o que não sabe fazer, diz que não sabe (uma tarefa sem motor termina
     «falhou — sem motor», não «concluída»);
   · o que ainda não existe (pesquisa Google, agentes a correr, contas com
     palavra-passe) responde com o vazio honesto, nunca inventado.

   Limite declarado: um browser não é uma base de dados. Os dados vivem neste
   aparelho e neste browser; limpar os dados do site apaga-os. Por isso há
   exportar/importar (`guardar cópia`), e a porta aberta para a base a sério:
   quando existir `/api` (Vercel + base de dados), a mesa usa-a e este módulo
   fica só como recurso.
   =========================================================================== */

export const CHAVE = 'orbita.mesa.v1';

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
  { id: 'comando', nome: 'Comando' },
  { id: 'prospeccao', nome: 'Prospecção' },
  { id: 'vendas', nome: 'Vendas' },
  { id: 'media', nome: 'Media' },
  { id: 'design', nome: 'Design' },
  { id: 'engenharia', nome: 'Engenharia' },
];

const vazio = () => ({
  v: 1,
  criado: new Date().toISOString(),
  leads: [],
  projetos: [],
  tarefas: [],
  receitas: [],
  mensagens: [],
  atividade: [],
});

const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const limpo = (s) => String(s || '').trim();
const novoId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* o erro que a mesa já sabe mostrar: `status` e `message` */
function falha(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, body: { error: message, ...extra } });
}

export function createLocalApi({ storage, agora = () => Date.now() } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) throw new Error('modo local sem armazém: este ambiente não tem localStorage');

  function ler() {
    try {
      const cru = store.getItem(CHAVE);
      if (!cru) return vazio();
      const d = JSON.parse(cru);
      return { ...vazio(), ...d };
    } catch { return vazio(); }
  }
  function gravar(d) { store.setItem(CHAVE, JSON.stringify(d)); return d; }
  function escrever(d, tipo, texto) {
    d.atividade.unshift({ id: novoId('a'), tipo, texto, at: new Date(agora()).toISOString() });
    d.atividade = d.atividade.slice(0, 200);
  }

  /* ---------- leituras derivadas (as mesmas contas do servidor) ---------- */
  const cents = (eur) => Math.round((Number(eur) || 0) * 100);
  const dinheiro = (c) => (Number(c) || 0) / 100;

  function saldo(d) {
    const janela = 90, desde = agora() - janela * 86400000;
    const dentro = d.receitas.filter((r) => new Date(r.at).getTime() >= desde);
    const receitaCentimos = dentro.reduce((n, r) => n + (r.amount_cents || 0), 0);
    const porCampanha = Object.entries(dentro.reduce((m, r) => {
      const k = r.campaign || 'sem campanha';
      m[k] = (m[k] || 0) + (r.amount_cents || 0);
      return m;
    }, {})).map(([campanha, c]) => ({ campanha, cents: c })).sort((a, b) => b.cents - a.cents);
    return {
      janela: { dias: janela },
      receitaCentimos, custoCentimos: 0, margemCentimos: receitaCentimos,
      porCampanha, custosPorFornecedor: [], unitarios: {},
      entradas: dentro.slice(0, 40),
      semDados: {
        custo: 'Sem custos de API registados: nenhuma chave foi usada a partir daqui.',
        receita: dentro.length ? null : 'Ainda não há entradas registadas. Uma fatura emitida fora do Órbita só entra se a escreveres aqui.',
      },
    };
  }

  function pipeline(d) {
    const fases = [
      { id: 'novo', label: 'Novos', teste: (l) => !l.status || l.status === 'novo' },
      { id: 'contactado', label: 'Contactados', teste: (l) => l.status === 'contactado' },
      { id: 'respondeu', label: 'Responderam', teste: (l) => l.status === 'respondeu' },
      { id: 'ganho', label: 'Ganhos', teste: (l) => l.status === 'ganho' },
    ];
    const total = d.leads.length;
    const contagem = fases.map((f) => ({ id: f.id, label: f.label, leads: d.leads.filter(f.teste).length }));
    const ganhos = d.leads.filter((l) => l.status === 'ganho').length;
    return {
      totalLeads: total,
      conversaoTotal: total ? Math.round((ganhos / total) * 100) : null,
      fases: contagem.map((f) => ({ ...f, conversao: total ? Math.round((f.leads / total) * 100) : null })),
      porOrigem: Object.entries(d.leads.reduce((m, l) => {
        const k = l.source || 'manual';
        m[k] = m[k] || { total: 0, ganhos: 0 };
        m[k].total++; if (l.status === 'ganho') m[k].ganhos++;
        return m;
      }, {})).map(([origem, o]) => ({ origem, total: o.total, ganhos: o.ganhos, taxa: o.total ? Math.round((o.ganhos / o.total) * 100) : null })),
      paradas: { dias: 14, lista: [] },
      perdidos: d.leads.filter((l) => l.status === 'perdido').length,
    };
  }

  function resumoProjetos(d) {
    const por = (s) => d.projetos.filter((p) => p.status === s).length;
    return { total: d.projetos.length, emQa: por('em_qa'), aprovados: por('aprovado'), entregues: por('entregue') };
  }

  /* ---------- endpoints ---------- */
  function rota(caminho, metodo, corpo) {
    const d = ler();
    const [, ...resto] = caminho.replace(/^\/+/, '').split('/');
    const seg = resto.map((x) => decodeURIComponent(x)); // os pedaços já descodificados
    const parte = seg.join('/');
    const qs = new URLSearchParams(caminho.split('?')[1] || '');
    const caminhoLimpo = '/' + caminho.replace(/^\/+/, '').split('?')[0];

    /* --- quem és tu: no modo local és o dono deste browser, e não há senha --- */
    if (caminhoLimpo === '/auth/eu') {
      return { user: { id: 'local', name: 'Dono deste browser', email: '', role: 'owner', roleLabel: 'modo local' },
        modo: 'local', local: true, perms: { ver: true, escrever: true, aprovar: true, admin: true, write: true, approve: true } };
    }
    if (caminhoLimpo === '/auth/entrar' || caminhoLimpo === '/auth/primeiro-dono') return { ok: true, modo: 'local' };
    if (caminhoLimpo === '/auth/sair') return { ok: true };

    /* --- 1.18.0 · a IA no modo local: não há motor, e isso é dito com clareza ---
       As chaves vivem no servidor; neste browser não há como falar com fornecedores
       sem as expor. Por isso a vista mostra o Control Center vazio e a razão, em vez
       de fingir um motor ou rebentar com 404. */
    if (caminhoLimpo === '/ia/estado') {
      return {
        pronto: false, modo: 'local',
        motivo: 'a IA corre no servidor: as chaves dos fornecedores vivem no ambiente da Vercel e nunca neste browser',
        fornecedores: [], agentes: [], ferramentas: [], indisponiveis: [],
        memoria: { total: 0, usos: 0, etiquetas: [], recentes: [] },
        estudio: { configurado: false, porque: 'o estúdio (OpenMontage) precisa do servidor e de um worker' },
        diagnostico: { fornecedoresActivos: [], pronto: false },
        versaoCatalogo: { fornecedores: 0, modelos: 0 },
        instalacao: 'modo local — sem motor de IA',
      };
    }
    if (caminhoLimpo === '/ia/uso') return { resumo: [], ultimos: [], errosRecentes: [], modo: 'local' };
    if (caminhoLimpo === '/ia/runs') return { runs: [], modo: 'local' };
    if (caminhoLimpo.startsWith('/ia')) throw falha(404, 'a IA precisa do servidor (modo local não tem motor)');

    /* --- 1.19.0 · memória e estúdio no modo local: dizem que precisam do servidor --- */
    if (caminhoLimpo === '/media/trabalhos') return { trabalhos: [], modo: 'local' };
    if (caminhoLimpo === '/media/estado') {
      return { configurado: false, modo: 'local', pipelines: [], tipos: ['video', 'imagem', 'audio', 'animacao', '3d'],
        porque: 'o estúdio vive no servidor: a fila fica na base e o worker corre numa máquina com OpenMontage' };
    }
    if (caminhoLimpo.startsWith('/media')) throw falha(404, 'o estúdio precisa do servidor (modo local não tem fila)');

    /* --- Hoje --- */
    if (caminhoLimpo === '/ops/summary') {
      return {
        leads: { total: d.leads.length, comContacto: d.leads.filter((l) => l.phone || l.email).length },
        projetos: { total: d.projetos.length },
        tarefas: { total: d.tarefas.length },
        custos: { apiCentimos: 0 },
        modo: 'local',
      };
    }
    if (caminhoLimpo === '/ops/today') {
      const decidir = d.mensagens.filter((m) => m.status === 'rascunho')
        .map((m) => ({ id: m.id, kind: 'mensagem', channel: m.channel, lead: d.leads.find((l) => l.id === m.lead_id) || null, body: m.body }));
      return { decidir, presenca: { parado: false }, modo: 'local' };
    }

    /* --- leads --- */
    if (caminhoLimpo === '/ops/leads' && metodo === 'GET') {
      const lim = Math.min(500, Number(qs.get('limit')) || 200);
      return { leads: [...d.leads].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, lim) };
    }
    if (caminhoLimpo === '/ops/leads' && metodo === 'POST') {
      const lista = Array.isArray(corpo?.leads) ? corpo.leads : [corpo].filter(Boolean);
      let created = 0, updated = 0;
      for (const entrada of lista) {
        const nome = limpo(entrada?.name);
        if (!nome) continue;
        const chave = `${semAcentos(nome)}|${semAcentos(entrada.city)}`;
        const existente = d.leads.find((l) => `${semAcentos(l.name)}|${semAcentos(l.city)}` === chave);
        if (existente) {
          for (const k of ['phone', 'email', 'website', 'category', 'city', 'score']) if (entrada[k] != null && entrada[k] !== '') existente[k] = entrada[k];
          existente.updated_at = new Date(agora()).toISOString();
          updated++;
        } else {
          d.leads.push({
            id: novoId('l'), name: nome, category: limpo(entrada.category), city: limpo(entrada.city),
            phone: limpo(entrada.phone), email: limpo(entrada.email), website: limpo(entrada.website),
            source: limpo(entrada.source) || 'manual', status: 'novo', score: Number(entrada.score) || null,
            notes: limpo(entrada.notes), created_at: new Date(agora()).toISOString(), updated_at: new Date(agora()).toISOString(),
          });
          created++;
        }
      }
      if (!created && !updated) throw falha(400, 'o lead precisa de um nome');
      escrever(d, 'lead', `${created} lead(s) novo(s), ${updated} atualizado(s)`);
      gravar(d);
      return { created, updated, leads: d.leads };
    }
    if (/^\/ops\/leads\/[^/]+$/.test(caminhoLimpo) && metodo === 'GET') {
      const lead = d.leads.find((l) => l.id === seg[1]);
      if (!lead) throw falha(404, 'lead não encontrado');
      return { lead, dossier: null, messages: d.mensagens.filter((m) => m.lead_id === lead.id) };
    }
    if (/^\/ops\/leads\/[^/]+\/projeto$/.test(caminhoLimpo) && metodo === 'POST') {
      const id = seg[seg.length - 2];
      const lead = d.leads.find((l) => l.id === id);
      if (!lead) throw falha(404, 'lead não encontrado');
      const projeto = { id: novoId('p'), name: lead.name, client: lead.name, niche: lead.category, city: lead.city,
        kind: corpo?.kind || 'landing', status: 'rascunho', lead_id: lead.id, files: [],
        created_at: new Date(agora()).toISOString(), updated_at: new Date(agora()).toISOString() };
      d.projetos.push(projeto); escrever(d, 'projeto', `projeto «${projeto.name}» a partir do lead`); gravar(d);
      return { projeto };
    }

    /* --- mensagens (o que espera o teu OK) --- */
    if (caminhoLimpo === '/ops/messages' && metodo === 'GET') return { messages: d.mensagens.slice(0, Number(qs.get('limit')) || 100) };
    if (/^\/ops\/messages\/[^/]+\/(aprovar|rejeitar|enviar)$/.test(caminhoLimpo) && metodo === 'POST') {
      const acao = seg[seg.length - 1], id = seg[seg.length - 2];
      const m = d.mensagens.find((x) => x.id === id);
      if (!m) throw falha(404, 'mensagem não encontrada');
      if (acao === 'aprovar') { m.status = 'aprovada'; m.aprovada_at = new Date(agora()).toISOString(); }
      else if (acao === 'rejeitar') { m.status = 'rejeitada'; }
      else throw falha(501, 'no modo local não há canal de envio: aprovar não envia nada');
      escrever(d, 'mensagem', `${acao} uma mensagem`); gravar(d);
      return { ok: true, message: m };
    }

    /* --- projetos --- */
    if (caminhoLimpo === '/ops/projetos' && metodo === 'GET') {
      return { projetos: [...d.projetos].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
        resumo: resumoProjetos(d), tipos: TIPOS_PROJETO };
    }
    if (caminhoLimpo === '/ops/projetos' && metodo === 'POST') {
      const nome = limpo(corpo?.name);
      if (!nome) throw falha(400, 'o projeto precisa de um nome');
      const projeto = { id: novoId('p'), name: nome, client: limpo(corpo.client), niche: limpo(corpo.niche),
        city: limpo(corpo.city), kind: limpo(corpo.kind) || 'landing', status: 'rascunho', lead_id: null, files: [],
        created_at: new Date(agora()).toISOString(), updated_at: new Date(agora()).toISOString() };
      d.projetos.push(projeto); escrever(d, 'projeto', `projeto «${nome}» criado`); gravar(d);
      return { projeto };
    }
    if (/^\/ops\/projetos\/[^/]+$/.test(caminhoLimpo) && metodo === 'GET') {
      const project = d.projetos.find((p) => p.id === seg[1]);
      if (!project) throw falha(404, 'projeto não encontrado');
      return { project, qa: null, files: [], historico: [] };
    }

    /* --- tarefas: criadas, mas sem motor não se inventa um resultado --- */
    if (caminhoLimpo === '/ops/tarefas' && metodo === 'GET') {
      return { tarefas: [...d.tarefas].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100),
        tipos: TIPOS_TAREFA, departamentos: DEPARTAMENTOS };
    }
    if (caminhoLimpo === '/ops/tarefas' && metodo === 'POST') {
      const tipo = limpo(corpo?.kind);
      if (!TIPOS_TAREFA[tipo]) throw falha(400, 'tipo de tarefa desconhecido');
      const tarefa = { id: novoId('t'), kind: tipo, entityId: limpo(corpo.entityId), entidade: limpo(corpo.entidade),
        state: 'failed', error: 'sem motor de IA ligado a este browser — a tarefa fica registada, mas não foi executada',
        created_at: new Date(agora()).toISOString(), finished_at: new Date(agora()).toISOString() };
      d.tarefas.push(tarefa); escrever(d, 'tarefa', `${TIPOS_TAREFA[tipo].label}: sem motor`); gravar(d);
      return { tarefa };
    }
    if (/^\/ops\/tarefas\/[^/]+\/correr$/.test(caminhoLimpo) && metodo === 'POST') {
      const id = seg[seg.length - 2];
      const t = d.tarefas.find((x) => x.id === id);
      if (!t) throw falha(404, 'tarefa não encontrada');
      return { ok: false, error: 'sem motor de IA ligado a este browser' };
    }
    if (/^\/ops\/tarefas\/[^/]+\/(aprovar|rejeitar)$/.test(caminhoLimpo) && metodo === 'POST') {
      const id = seg[seg.length - 2];
      const t = d.tarefas.find((x) => x.id === id);
      if (!t) throw falha(404, 'tarefa não encontrada');
      t.state = seg[seg.length - 1] === 'aprovar' ? 'succeeded' : 'cancelled';
      gravar(d);
      return { ok: true, tarefa: t };
    }

    /* --- dinheiro --- */
    if (caminhoLimpo === '/ops/saldo') return { ...saldo(d), presenca: { parado: false } };
    if (caminhoLimpo === '/ops/receita' && metodo === 'POST') {
      const centimos = cents(corpo?.euros);
      if (!centimos) throw falha(400, 'diz o valor que entrou');
      d.receitas.push({ id: novoId('r'), amount_cents: centimos, campaign: limpo(corpo.campaign),
        at: new Date(agora()).toISOString(), origem: 'escrita na mesa' });
      escrever(d, 'receita', `entrada de ${dinheiro(centimos).toFixed(2)} €`); gravar(d);
      return { ok: true, euro: dinheiro(centimos) };
    }
    if (/^\/ops\/receita\/[^/]+$/.test(caminhoLimpo) && metodo === 'DELETE') {
      const antes = d.receitas.length;
      d.receitas = d.receitas.filter((r) => r.id !== seg[1]);
      if (d.receitas.length === antes) throw falha(404, 'entrada não encontrada');
      gravar(d);
      return { ok: true };
    }

    /* --- o resto: o vazio honesto (nunca dados inventados) --- */
    if (caminhoLimpo === '/ops/clientes') return { clientes: [{ id: 'local', nome: 'Este browser', ativo: true }], activo: { id: 'local', nome: 'Este browser' } };
    if (caminhoLimpo === '/ops/pipeline') return pipeline(d);
    if (caminhoLimpo === '/ops/atividade') return { eventos: d.atividade.slice(0, Number(qs.get('limit')) || 20) };
    if (caminhoLimpo === '/ops/agentes') return { departamentos: DEPARTAMENTOS.map((x) => ({ ...x, agentes: [] })), resumo: { total: d.tarefas.length, running: 0, awaiting: 0 }, modo: 'local' };
    if (caminhoLimpo === '/ops/utilizadores') return { utilizadores: [], papeis: [] };
    if (caminhoLimpo === '/ops/sessoes') return { sessoes: [] };
    if (caminhoLimpo === '/ops/stop') return { ok: true, parado: !!corpo?.stop };
    if (caminhoLimpo === '/ops/pesquisa') return { query: qs.get('q') || '', grupos: [] };

    throw falha(501, `o modo local ainda não faz «${caminhoLimpo}»`);
  }

  return {
    modo: 'local',
    async call(caminho, metodo = 'GET', corpo) {
      // igual ao servidor: a resposta é JSON e o erro traz o estado HTTP
      try { return rota(caminho, metodo, corpo); }
      catch (e) { throw Object.assign(e, { local: true }); }
    },
    /* cópia de segurança: um browser não é uma base de dados */
    exportar: () => JSON.stringify(ler(), null, 2),
    importar(texto) {
      const d = JSON.parse(texto);
      if (!d || typeof d !== 'object' || !Array.isArray(d.leads)) throw new Error('isto não é uma cópia da mesa');
      gravar({ ...vazio(), ...d });
      return { leads: d.leads.length, projetos: (d.projetos || []).length };
    },
    apagarTudo() { gravar(vazio()); },
    estado: () => {
      const d = ler();
      return { leads: d.leads.length, projetos: d.projetos.length, tarefas: d.tarefas.length, receitas: d.receitas.length, criado: d.criado };
    },
  };
}
