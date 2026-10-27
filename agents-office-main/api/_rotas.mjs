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
import { VERSAO } from './_versao.mjs';


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

/* ---------- os serviços que não são de IA, com uma sonda REAL cada ----------
   1.22.0: cada integração tem um botão «Testar ligação» que faz um pedido de
   verdade e guarda o resultado em `testes` (a mesma tabela que a IA usa). Um
   serviço sem token não é «testado»: é «falta a chave», e diz-se assim. */
/* 1.22.0: o catálogo não marca `tipo` nos fornecedores de chat — um filtro
   `f.tipo === 'chat'` excluía TODOS e a lista de IA vinha vazia. Só ficam de
   fora os que não conversam (pesquisa). */
const NAO_CHAT = new Set(['exa', 'linkup', 'firecrawl', 'brave', 'tavily', 'serper']);
const eChat = (id, f) => (f?.tipo ? f.tipo === 'chat' : !NAO_CHAT.has(id));

const SERVICOS = [
  {
    id: 'github', name: 'GitHub', kind: 'codigo', env: ['GITHUB_TOKEN'], docs: 'https://github.com/settings/tokens',
    sonda: 'https://api.github.com/user',
    cabecalhos: (e) => ({ Authorization: `Bearer ${e.GITHUB_TOKEN}`, 'User-Agent': 'orbita-studio', Accept: 'application/vnd.github+json' }),
    leitura: (j) => j?.login || j?.name || null,
  },
  {
    id: 'vercel', name: 'Vercel', kind: 'deploy', env: ['VERCEL_TOKEN'], docs: 'https://vercel.com/account/tokens',
    sonda: 'https://api.vercel.com/v2/user',
    cabecalhos: (e) => ({ Authorization: `Bearer ${e.VERCEL_TOKEN}` }),
    leitura: (j) => j?.user?.username || j?.user?.email || null,
  },
  {
    id: 'supabase', name: 'Supabase', kind: 'base-de-dados', env: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'], docs: 'https://supabase.com/dashboard',
    sonda: (e) => `${String(e.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/`,
    cabecalhos: (e) => ({ apikey: e.SUPABASE_SECRET_KEY, Authorization: `Bearer ${e.SUPABASE_SECRET_KEY}` }),
    leitura: () => 'REST respondeu',
  },
  {
    id: 'resend', name: 'Resend (email)', kind: 'correio', env: ['RESEND_API_KEY'], docs: 'https://resend.com/api-keys',
    sonda: 'https://api.resend.com/domains',
    cabecalhos: (e) => ({ Authorization: `Bearer ${e.RESEND_API_KEY}` }),
    leitura: (j) => (Array.isArray(j?.data) ? `${j.data.length} domínio(s)` : 'conta respondeu'),
  },
  /* 1.25.0: as duas fontes de pesquisa do escritório. A sonda é a mesma função
     que serve as rotas — um pedido real, não uma lista de boas intenções. */
  {
    id: 'geoapify', name: 'Geoapify (empresas)', kind: 'dados', env: ['GEOAPIFY_API_KEY'], docs: 'https://myprojects.geoapify.com',
    sondar: async ({ env, fetchImpl }) => (await import('./_pesquisa.mjs')).testarFonte('geoapify', { env, fetchImpl }),
  },
  {
    id: 'tavily', name: 'Tavily (pesquisa web)', kind: 'pesquisa', env: ['TAVILY_API_KEY'], docs: 'https://app.tavily.com',
    sondar: async ({ env, fetchImpl }) => (await import('./_pesquisa.mjs')).testarFonte('tavily', { env, fetchImpl }),
  },
];

/** Faz o pedido de sonda a um serviço. Não inventa: sem chave, devolve o que falta. */
export async function sondarServico(id, { env = process.env, fetchImpl = fetch } = {}) {
  const s = SERVICOS.find((x) => x.id === id);
  if (!s) return { ok: false, erro: 'integração desconhecida', codigo: 'desconhecida' };
  const faltam = s.env.filter((v) => !env[v]);
  if (faltam.length) return { ok: false, erro: `falta ${faltam.join(' e ')} no ambiente`, codigo: 'semchave', faltam };
  /* 1.25.0: algumas fontes precisam de mais do que um GET (a Tavily é POST).
     Quem tem `sondar` trata do seu próprio pedido; as restantes seguem o caminho
     genérico abaixo. */
  if (typeof s.sondar === 'function') {
    const inicio = Date.now();
    try {
      const r = await s.sondar({ env, fetchImpl });
      return { ...r, quando: r.quando || new Date().toISOString(), ms: r.ms ?? (Date.now() - inicio) };
    } catch (e) {
      return { ok: false, ms: Date.now() - inicio, erro: String(e.message || e).slice(0, 200), codigo: e.codigo || 'erro' };
    }
  }
  const alvo = typeof s.sonda === 'function' ? s.sonda(env) : s.sonda;
  const inicio = Date.now();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    let r;
    try {
      r = await fetchImpl(alvo, { headers: s.cabecalhos(env), signal: ctl.signal });
    } finally { clearTimeout(t); }
    const ms = Date.now() - inicio;
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      return { ok: false, ms, status: r.status, erro: `${s.name} respondeu HTTP ${r.status}${corpo ? `: ${corpo.slice(0, 120)}` : ''}`, codigo: 'http' };
    }
    let detalhe = null;
    try { detalhe = s.leitura(await r.json()); } catch { detalhe = null; }
    return { ok: true, ms, status: r.status, detalhe, quando: new Date().toISOString() };
  } catch (e) {
    return { ok: false, ms: Date.now() - inicio, erro: String(e.message || e).slice(0, 200), codigo: e.name === 'AbortError' ? 'tempo' : 'rede' };
  }
}

/* ---------- o encaminhador ----------
   27 out 2026: esta marca existe para forçar um pacote de funções novo quando o
   build da Vercel reutiliza cache e continua a servir código antigo. */
const MARCA_FUNCOES = 'rpc-1.23.0';
export const marcaDasFuncoes = () => MARCA_FUNCOES;
export async function responder(repo, { caminho, metodo = 'GET', corpo = null, env = process.env, fetchImpl = fetch }) {
  const caminhoLimpo = '/' + String(caminho || '').replace(/^\/+/, '').split('?')[0];

  /* ---- 1.18.0 · tudo o que é IA vive em api/_ia (fornecedores, router, agentes)
         e, desde 1.19.0, também a memória e o estúdio de media ---- */
  if (caminhoLimpo === '/ia' || caminhoLimpo.startsWith('/ia/') || caminhoLimpo.startsWith('/media')) {
    const { rotasIA } = await import('./_ia/rotas.mjs');
    return rotasIA(repo, { caminho, metodo, corpo, env, fetchImpl });
  }

  const seg = caminhoLimpo.split('/').filter(Boolean);
  const qs = new URLSearchParams(String(caminho).split('?')[1] || '');
  const m = String(metodo || 'GET').toUpperCase();

  /* ---- 1.20.0 · o Centro de Controlo: salas, estados, segurança ----
     As três marcas de cada linha (configurado / ligado / a funcionar) vêm todas
     daqui — a interface não as inventa. */
  if (caminhoLimpo === '/controlo/estado' && m === 'GET') {
    const { retrato } = await import('./_controlo.mjs');
    let motor = null;
    try {
      const { criarMotor } = await import('./_ia/motor.mjs');
      motor = criarMotor({ repo, env, fetchImpl });
    } catch { motor = null; }
    return { status: 200, corpo: await retrato({ repo, motor, env }) };
  }

  if (caminhoLimpo === '/controlo/salas' && m === 'POST') {
    const { limparAjustes } = await import('./_controlo.mjs');
    const ajustes = limparAjustes(corpo);
    await repo.ia.config.gravar('salas', ajustes);
    await repo.atividade.add('config', `configuração das salas substituída (${Object.keys(ajustes.cores).length} cores, ${ajustes.agentes.length} agentes novos)`).catch(() => {});
    return { status: 200, corpo: { ok: true, ajustes } };
  }

  if (seg[0] === 'controlo' && seg[1] === 'salas' && seg[3] === 'cor' && m === 'POST') {
    const { limparAjustes, comCor } = await import('./_controlo.mjs');
    const cfg = await repo.ia.config.ler().catch(() => ({}));
    const r = comCor(limparAjustes(cfg.salas), seg[2], corpo?.cor);
    if (r.erro) throw falha(400, r.erro);
    await repo.ia.config.gravar('salas', r.ajustes);
    await repo.atividade.add('config', `sala ${seg[2]}: cor ${corpo?.cor}`).catch(() => {});
    return { status: 200, corpo: { ok: true, ajustes: r.ajustes } };
  }

  if (seg[0] === 'controlo' && seg[1] === 'salas' && seg[3] === 'tamanho' && m === 'POST') {
    const { limparAjustes, comTamanho } = await import('./_controlo.mjs');
    const cfg = await repo.ia.config.ler().catch(() => ({}));
    const r = comTamanho(limparAjustes(cfg.salas), seg[2], corpo || {}, {
      minimo: Number(corpo?.minimo) || 8, base: Number(corpo?.base) || 8,
    });
    if (r.erro) throw falha(400, r.erro);
    await repo.ia.config.gravar('salas', r.ajustes);
    await repo.atividade.add('config', `sala ${seg[2]}: tamanho ${r.tamanho.w ? `${r.tamanho.w} m × ${r.tamanho.d} m` : `${r.tamanho.d} m de fundo`}`).catch(() => {});
    return { status: 200, corpo: { ok: true, tamanho: r.tamanho, ajustes: r.ajustes } };
  }

  if (caminhoLimpo === '/controlo/registo' && m === 'GET') {
    const linhas = await repo.atividade.list(Number(qs.get('limit')) || 60);
    return { status: 200, corpo: {
      /* quem mudou o quê: não há login nesta instalação, o autor é o dono */
      registo: linhas.filter((a) => a.tipo === 'config').slice(0, 40).map((a) => ({ quando: a.at, quem: 'dono', o_que: a.texto })),
    } };
  }

  if (caminhoLimpo === '/controlo/agentes' && m === 'POST') {
    const { limparAjustes, comAgente } = await import('./_controlo.mjs');
    const cfg = await repo.ia.config.ler().catch(() => ({}));
    const ajustes = limparAjustes(cfg.salas);
    /* quantos já existem na sala: os acrescentados por nós + os que a cena tem
       (o cliente diz quantos são — é ele que conhece os agentes de origem) */
    const porSala = ajustes.agentes.filter((a) => a.dept === corpo?.dept).length + (Number(corpo?.existentesNaSala) || 0);
    const r = comAgente(ajustes, corpo, porSala);
    if (r.erro) throw falha(400, r.erro);
    await repo.ia.config.gravar('salas', r.ajustes);
    await repo.atividade.add('config', `sala ${r.agente.dept}: entrou ${r.agente.nome} (${r.agente.funcao})`).catch(() => {});
    return { status: 201, corpo: { ok: true, agente: r.agente, ajustes: r.ajustes } };
  }

  if (seg[0] === 'controlo' && seg[1] === 'agentes' && seg.length === 3 && m === 'DELETE') {
    const { limparAjustes, semAgente } = await import('./_controlo.mjs');
    const cfg = await repo.ia.config.ler().catch(() => ({}));
    const r = semAgente(limparAjustes(cfg.salas), seg[2]);
    if (r.erro) throw falha(404, r.erro);
    await repo.ia.config.gravar('salas', r.ajustes);
    await repo.atividade.add('config', `saiu o agente ${seg[2]}`).catch(() => {});
    return { status: 200, corpo: { ok: true, ajustes: r.ajustes } };
  }

  /* ---- o catálogo de integrações que a aba de Configurações mostra ----
     Antes esta rota não existia no modo base: o painel pedia e recebia 404, e o
     dono ficava sem saber o que faltava. Agora responde com o que é verdade:
     que variáveis existem, quais faltam, e o último teste REAL de cada uma. */
  if (caminhoLimpo === '/platform/apis' && m === 'GET') {
    const { FORNECEDORES } = await import('./_ia/catalogo.mjs');
    const cfg = await repo.ia.config.ler().catch(() => ({}));
    const testes = cfg.testes || {};
    const ia = Object.entries(FORNECEDORES)
      .filter(([id, f]) => eChat(id, f))
      .map(([id, f]) => {
        const vars = f.chave || [];
        const env2 = vars.filter((v) => !!env[v]);
        const t = testes[id];
        return {
          /* nomes únicos: o serviço «Vercel» e o fornecedor «Vercel AI Gateway»
             chamam-se os dois `vercel`; o de IA leva prefixo `ia:` */
          id: SERVICOS.some((x) => x.id === id) ? `ia:${id}` : id,
          name: f.nome, kind: 'ia', docs: f.docs || f.site || null,
          env: env2, missing: vars.filter((v) => !env[v]),
          configured: env2.length > 0 || !!f.keyless,
          verified: !!t?.ok, status: t?.ok ? 200 : null, latencyMs: t?.ms ?? null,
          checkedAt: t?.quando || null, error: t?.ok ? null : (t?.erro || null),
          note: f.nota || null,
        };
      });
    const conectores = String(env.CONECTORES || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const servicos = SERVICOS.map((s) => {
      const tem = s.env.filter((v) => !!env[v]);
      const t = testes[s.id];
      const porConector = conectores.includes(s.id);
      return {
        id: s.id, name: s.name, kind: s.kind, docs: s.docs,
        env: tem, missing: s.env.filter((v) => !env[v]),
        conector: porConector,
        via: porConector && tem.length === s.env.length ? 'conector+chave' : porConector ? 'conector' : (tem.length ? 'chave' : null),
        configured: tem.length === s.env.length || porConector,
        verified: !!t?.ok, status: t?.status ?? null, latencyMs: t?.ms ?? null,
        checkedAt: t?.quando || null, error: t?.ok ? null : (t?.erro || null),
        detalhe: t?.ok ? (t.detalhe || null) : null, note: null,
      };
    });
    const list = [...servicos, ...ia];
    return { status: 200, corpo: {
      list,
      summary: {
        total: list.length,
        configuradas: list.filter((x) => x.configured).length,
        verificadas: list.filter((x) => x.verified).length,
        porConector: list.filter((x) => x.conector).length,
      },
    } };
  }

  /* ---- 1.25.0 · a pesquisa, servida pela função e não só pela máquina do dono ----
     Antes disto, procurar leads só acontecia em `serve.mjs`: na aplicação
     publicada não havia pesquisa nenhuma. Aqui há três rotas, todas com chave
     no servidor e nenhuma a inventar resultados. */
  if (caminhoLimpo === '/pesquisa/estado' && m === 'GET') {
    const p = await import('./_pesquisa.mjs');
    const c = await import('./_cripto.mjs');
    const k = c.chaveMestre(env);
    return { status: 200, corpo: { ok: true, fontes: p.estado(env), cifra: { disponivel: !!k.chave, fonte: k.fonte, motivo: k.motivo } } };
  }

  if (caminhoLimpo === '/pesquisa/categorias' && m === 'GET') {
    const { CATEGORIAS } = await import('./_pesquisa.mjs');
    return { status: 200, corpo: { total: CATEGORIAS.length, categorias: CATEGORIAS.map((x) => ({ id: x.id, categoria: x.categoria })) } };
  }

  if (caminhoLimpo === '/pesquisa/leads' && m === 'POST') {
    const p = await import('./_pesquisa.mjs');
    const oQue = limpo(corpo?.oQue || corpo?.what || corpo?.atividade);
    const onde = limpo(corpo?.onde || corpo?.where || corpo?.zona);
    try {
      const r = await p.procurarLeads({
        oQue, onde,
        categoria: limpo(corpo?.categoria) || null,
        limite: Number(corpo?.limite || corpo?.limit) || 20,
        raio: Number(corpo?.raio) || 12000,
        pais: limpo(corpo?.pais) || null,
        lang: limpo(corpo?.lang) || 'pt',
      }, { env, fetchImpl });
      let guardados = null;
      if (corpo?.guardar !== false && r.leads.length) {
        const linhas = r.leads.map((l) => ({
          dedupe_key: dedupe(l.nome, l.cidade), name: l.nome, category: l.categoria || null,
          city: l.cidade || null, phone: l.telefone || null, email: l.email || null,
          website: l.website || null, source: 'geoapify', status: 'novo',
          notes: `nota ${l.nota} · ${l.porque}`,
        }));
        const existentes = await repo.leads.existentes(linhas.map((l) => l.dedupe_key));
        const chaves = new Set(existentes.map((e) => e.dedupe_key));
        const novos = linhas.filter((l) => !chaves.has(l.dedupe_key));
        if (novos.length) await repo.leads.inserir(novos);
        guardados = { novos: novos.length, repetidos: linhas.length - novos.length, total: linhas.length };
        await repo.atividade.add('pesquisa', `${oQue || r.categoria} em ${onde}: ${r.encontrados} encontrados, ${novos.length} novos`).catch(() => {});
      }
      return { status: 200, corpo: { ok: true, ...r, guardados } };
    } catch (e) {
      return { status: 502, corpo: { ok: false, erro: String(e.message || e).slice(0, 400) } };
    }
  }

  if (caminhoLimpo === '/pesquisa/web' && m === 'POST') {
    const p = await import('./_pesquisa.mjs');
    try {
      const r = await p.pesquisarWeb({
        consulta: limpo(corpo?.consulta || corpo?.q || corpo?.query),
        limite: Number(corpo?.limite || corpo?.limit) || 8,
        profundidade: limpo(corpo?.profundidade) || 'basic',
      }, { env, fetchImpl });
      /* resultados da web não são empresas: não entram no funil sem alguém os ler */
      return { status: 200, corpo: { ok: true, ...r, guardados: null, nota: 'a web dá contexto, não leads — nada foi escrito no funil' } };
    } catch (e) {
      return { status: 502, corpo: { ok: false, erro: String(e.message || e).slice(0, 400) } };
    }
  }

  if (caminhoLimpo === '/pesquisa/pagina' && m === 'POST') {
    const p = await import('./_pesquisa.mjs');
    try {
      const r = await p.extrairPagina({ url: limpo(corpo?.url) }, { env, fetchImpl });
      return { status: 200, corpo: { ok: true, ...r } };
    } catch (e) {
      return { status: 502, corpo: { ok: false, erro: String(e.message || e).slice(0, 400) } };
    }
  }

  /* ---- 1.25.0 · a cópia que sai do servidor pode sair cifrada ---- */
  if (caminhoLimpo === '/backup/cifrado' && m === 'POST') {
    const { exportar } = await import('./_backup.mjs');
    const c = await import('./_cripto.mjs');
    const k = c.chaveMestre(env);
    if (!k.chave) throw falha(503, `não posso cifrar: ${k.motivo}`);
    const copia = await exportar(repo);
    const pacote = c.cifrar(copia, k.chave);
    return { status: 200, corpo: {
      ok: true, formato: pacote.formato, alg: pacote.alg, bytes: pacote.bytes,
      impressao: c.impressao(pacote), chaveDe: k.fonte, quando: new Date().toISOString(),
      /* só o retrato da cópia: os dados vão cifrados, não ao lado deles */
      copia: { quando: copia.quando, tabelas: Object.keys(copia.tabelas || {}), total: copia.total },
      pacote,
    } };
  }

  if (caminhoLimpo === '/backup/decifrar' && m === 'POST') {
    const c = await import('./_cripto.mjs');
    const k = c.chaveMestre(env);
    if (!k.chave) throw falha(503, `não posso decifrar: ${k.motivo}`);
    if (!corpo?.pacote) throw falha(400, 'falta o pacote cifrado');
    try {
      const aberto = c.decifrar(corpo.pacote, k.chave);
      /* devolve só o retrato da cópia; os dados não voltam ao browser por esta rota */
      return { status: 200, corpo: { ok: true, quando: aberto.quando, tabelas: Object.keys(aberto.tabelas || {}), total: aberto.total, contagens: aberto.contagens, marca: aberto.marca || null } };
    } catch (e) {
      throw falha(400, String(e.message || e));
    }
  }

  /* ---- 1.23.0 · cópia de segurança que se pode testar ---- */
  if (caminhoLimpo === '/backup' && m === 'GET') {
    const { exportar } = await import('./_backup.mjs');
    const copia = await exportar(repo);
    return { status: 200, corpo: { ok: true, copia } };
  }

  if (caminhoLimpo === '/backup/teste' && m === 'POST') {
    const { testar } = await import('./_backup.mjs');
    const r = await testar(repo);
    await repo.atividade.add('config', `cópia de segurança testada: ${r.ok ? `ok, ${r.total} linhas` : `falhou (${r.problemas[0] || 'sem razão'})`}`).catch(() => {});
    return { status: 200, corpo: r };
  }

  /* ---- 1.22.0 · testar uma integração, uma de cada vez, a sério ----
     É o botão que faltava: sem ele, «testar» só existia ao guardar a chave. */
  if (caminhoLimpo === '/platform/testar' && m === 'POST') {
    const cru = String(corpo?.id || '');
    const id = cru.startsWith('ia:') ? cru.slice(3) : cru;
    const soIA = cru.startsWith('ia:');
    const { FORNECEDORES } = await import('./_ia/catalogo.mjs');
    const cfg = await repo.ia.config.ler().catch(() => ({}));
    const testes = { ...(cfg.testes || {}) };

    if (FORNECEDORES[id] && eChat(id, FORNECEDORES[id]) && (soIA || !SERVICOS.some((x) => x.id === id))) {
      const { criarMotor } = await import('./_ia/motor.mjs');
      const motor = criarMotor({ repo, env, fetchImpl });
      try {
        const r = await motor.testar(id);
        return { status: 200, corpo: { ok: true, id, nome: FORNECEDORES[id].nome, ...r, prova: 'pedido real a este fornecedor, agora' } };
      } catch (e) {
        return { status: 200, corpo: { ok: false, id, nome: FORNECEDORES[id].nome, erro: String(e.message || e).slice(0, 300), codigo: e.codigo || 'erro', quando: new Date().toISOString() } };
      }
    }

    const r = await sondarServico(id, { env, fetchImpl });
    if (r.codigo === 'desconhecida') throw falha(404, r.erro);
    testes[id] = { ...r, quando: r.quando || new Date().toISOString() };
    await repo.ia.config.gravar('testes', testes).catch(() => {});
    await repo.atividade.add('config', `teste de ${id}: ${r.ok ? 'ligou' : `falhou (${String(r.erro).slice(0, 80)})`}`).catch(() => {});
    return { status: 200, corpo: { ...r, id, prova: 'pedido real, agora' } };
  }

  if (caminhoLimpo === '/platform/key' && m === 'POST') {
    /* Em produção as variáveis de ambiente são só de leitura: escrever chaves
       pela interface é a mentira mais fácil de contar aqui. Diz-se em vez disso. */
    throw falha(501, 'as chaves vivem nas variáveis de ambiente da Vercel (Settings → Environment Variables): esta instalação não as pode escrever pela interface');
  }

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
    return { status: h.ok ? 200 : 503, corpo: { ...h, modo: 'base', versao: VERSAO } };
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
