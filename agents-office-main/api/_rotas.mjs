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
import { remetente } from './_prontidao.mjs';   // 1.41.0: o «from» do correio, com um nome só
import { criarECorrer, correrDeNovo } from './_tarefas.mjs';   // 1.53.2: as tarefas correm a sério
import { avaliarPorta } from './_porta.mjs';   // 1.54.0: a porta (contas, sessões, papéis)


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
/** A que sala cada tipo de tarefa pertence — para o filtro da mesa não mentir. */
const DEPARTAMENTOS_POR_TIPO = {
  investigar: 'prospeccao', mensagem: 'vendas', briefing: 'comando', codigo: 'engenharia', qa: 'engenharia',
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

export const SERVICOS = [
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
  /* 1.53.0 · as apps da loja, também do lado de produção. Aqui não se escrevem chaves (as
     variáveis da Vercel são só de leitura), mas TESTAR tem de funcionar: é a mesma sonda real
     que a máquina faz, com o token que estiver no ambiente. Sem chave, diz qual falta. */
  { id: 'sentry', name: 'Sentry', kind: 'codigo', env: ['SENTRY_AUTH_TOKEN'], docs: 'https://sentry.io/settings/account/api/auth-tokens/',
    sonda: 'https://sentry.io/api/0/organizations/', cabecalhos: (e) => ({ Authorization: `Bearer ${e.SENTRY_AUTH_TOKEN}` }) },
  { id: 'neon', name: 'Neon', kind: 'base-de-dados', env: ['NEON_API_KEY'], docs: 'https://console.neon.tech/app/settings/api-keys',
    sonda: 'https://console.neon.tech/api/v2/projects', cabecalhos: (e) => ({ Authorization: `Bearer ${e.NEON_API_KEY}`, Accept: 'application/json' }) },
  { id: 'netlify', name: 'Netlify', kind: 'deploy', env: ['NETLIFY_AUTH_TOKEN'], docs: 'https://app.netlify.com/user/applications#personal-access-tokens',
    sonda: 'https://api.netlify.com/api/v1/user', cabecalhos: (e) => ({ Authorization: `Bearer ${e.NETLIFY_AUTH_TOKEN}` }) },
  { id: 'render', name: 'Render', kind: 'deploy', env: ['RENDER_API_KEY'], docs: 'https://dashboard.render.com/u/settings#api-keys',
    sonda: 'https://api.render.com/v1/owners?limit=1', cabecalhos: (e) => ({ Authorization: `Bearer ${e.RENDER_API_KEY}` }) },
  { id: 'linear', name: 'Linear', kind: 'codigo', env: ['LINEAR_API_KEY'], docs: 'https://linear.app/settings/api',
    sonda: 'https://api.linear.app/graphql',
    cabecalhos: (e) => ({ Authorization: e.LINEAR_API_KEY, 'Content-Type': 'application/json' }) },
  { id: 'figma', name: 'Figma', kind: 'design', env: ['FIGMA_TOKEN'], docs: 'https://www.figma.com/developers/api#access-tokens',
    sonda: 'https://api.figma.com/v1/me', cabecalhos: (e) => ({ 'X-Figma-Token': e.FIGMA_TOKEN }) },
  { id: 'posthog', name: 'PostHog', kind: 'dados', env: ['POSTHOG_API_KEY'], docs: 'https://app.posthog.com/settings/user-api-keys',
    sonda: (e) => `${String(e.POSTHOG_HOST || 'https://eu.posthog.com').replace(/\/+$/, '')}/api/users/@me/`,
    cabecalhos: (e) => ({ Authorization: `Bearer ${e.POSTHOG_API_KEY}` }) },
  { id: 'todoist', name: 'Todoist', kind: 'dados', env: ['TODOIST_TOKEN'], docs: 'https://todoist.com/app/settings/integrations/developer',
    sonda: 'https://api.todoist.com/rest/v2/projects', cabecalhos: (e) => ({ Authorization: `Bearer ${e.TODOIST_TOKEN}` }) },
  { id: 'trello', name: 'Trello', kind: 'dados', env: ['TRELLO_KEY', 'TRELLO_TOKEN'], docs: 'https://trello.com/power-ups/admin',
    sonda: (e) => `https://api.trello.com/1/members/me?key=${encodeURIComponent(e.TRELLO_KEY)}&token=${encodeURIComponent(e.TRELLO_TOKEN)}` },
  { id: 'notion', name: 'Notion', kind: 'base-de-dados', env: ['NOTION_TOKEN'], docs: 'https://www.notion.so/my-integrations',
    sonda: 'https://api.notion.com/v1/users/me', cabecalhos: (e) => ({ Authorization: `Bearer ${e.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }) },
  { id: 'airtable', name: 'Airtable', kind: 'base-de-dados', env: ['AIRTABLE_TOKEN'], docs: 'https://airtable.com/create/tokens',
    sonda: 'https://api.airtable.com/v0/meta/whoami', cabecalhos: (e) => ({ Authorization: `Bearer ${e.AIRTABLE_TOKEN}` }) },
  { id: 'slack', name: 'Slack', kind: 'mensagens', env: ['SLACK_BOT_TOKEN'], docs: 'https://api.slack.com/apps',
    sonda: 'https://slack.com/api/auth.test', cabecalhos: (e) => ({ Authorization: `Bearer ${e.SLACK_BOT_TOKEN}` }) },
  { id: 'discord', name: 'Discord', kind: 'mensagens', env: ['DISCORD_BOT_TOKEN'], docs: 'https://discord.com/developers/applications',
    sonda: 'https://discord.com/api/v10/users/@me', cabecalhos: (e) => ({ Authorization: `Bot ${e.DISCORD_BOT_TOKEN}` }) },
  { id: 'telegram', name: 'Telegram', kind: 'mensagens', env: ['TELEGRAM_BOT_TOKEN'], docs: 'https://core.telegram.org/bots/api',
    sonda: (e) => `https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/getMe` },
  { id: 'gemini', name: 'Google Gemini', kind: 'ia', env: ['GEMINI_API_KEY'], docs: 'https://aistudio.google.com/apikey',
    sonda: (e) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(e.GEMINI_API_KEY)}` },
  /* 1.27.0: credenciais ao minuto. Não há chave para listar: o que existe (ou
     não) é o token OIDC que a Vercel injecta na função. */
  {
    id: 'vercel-connect', name: 'Vercel Connect', kind: 'credenciais', env: [], docs: 'https://vercel.com/docs/connect',
    configurado: (env) => !!(env.VERCEL_OIDC_TOKEN || env.AI_GATEWAY_API_KEY || env.VERCEL_TOKEN),
    sondar: async ({ env, importarConect }) => (await import('./_conect.mjs')).testar({}, { env, importar: importarConect }),
  },
];

/** Faz o pedido de sonda a um serviço. Não inventa: sem chave, devolve o que falta. */
export async function sondarServico(id, { env = process.env, fetchImpl = fetch, importarConect = null } = {}) {
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
      const r = await s.sondar({ env, fetchImpl, importarConect });
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

/**
 * 1.46.0 · O LEITOR DE PAPEL DESTE PEDIDO.
 *
 * Antes disto, digitalizar exigia `ORBITA_OCR_URL` — um Tesseract numa máquina
 * qualquer. Nunca existiu em lado nenhum, e por isso a função estava desligada
 * desde a 1.31.0 (o `/api/health` dizia «falta Digitalizar papel» e era verdade).
 * Agora lê o motor de visão que já cá está: `cadeiaPara('visao')` escolhe os
 * modelos que leem imagens, ordenados pelas provas reais que já temos na base —
 * em produção isso inclui `ovh/Qwen2.5-VL-72B-Instruct`, sem chave nenhuma.
 *
 * Não gasta pedido: só lê catálogo, chaves e provas. Quem chama decide se usa.
 */
export async function visaoDoPedido({ repo, env = process.env, fetchImpl = fetch } = {}) {
  const semNada = {
    disponivel: false,
    motivo: 'nenhum modelo de visão com acesso neste ambiente — o catálogo tem OVH Qwen2.5-VL-72B e Qwen3-VL (sem chave), Pollinations, Google, OpenRouter e OpenAI (com chave)',
    cadeia: [],
    lerComIA: null,
  };
  let motor = null;
  try {
    const { criarMotor } = await import('./_ia/motor.mjs');
    motor = criarMotor({ repo, env, fetchImpl });
  } catch { return semNada; }
  let fila = [];
  try { fila = await motor.cadeiaPara('visao'); } catch { fila = []; }
  if (!Array.isArray(fila) || !fila.length) return semNada;
  const { lerPapel } = await import('./_ia/papel.mjs');
  return {
    disponivel: true,
    motivo: null,
    /* o que a interface pode mostrar: quem vai ler, por esta ordem */
    cadeia: fila.slice(0, 3).map((x) => ({ fornec: x.fornec, modelo: x.modelo })),
    lerComIA: ({ base64, mime }) => lerPapel({ base64, mime, motor, limite: 3 }),
  };
}

/* ---------- o encaminhador ----------
   27 out 2026: esta marca existe para forçar um pacote de funções novo quando o
   build da Vercel reutiliza cache e continua a servir código antigo. */
const MARCA_FUNCOES = 'rpc-1.23.0';
export const marcaDasFuncoes = () => MARCA_FUNCOES;
export async function responder(repo, {
  caminho, metodo = 'GET', corpo = null, env = process.env, fetchImpl = fetch,
  importarConect = null, headers = {}, corpoBruto = null,
  /* 1.54.0 · a porta. `null` = decide-se sozinha: dormente em memória (testes e
     modo local), fechada quando há base de dados ligada. */
  seguranca = null, ip = null,
}) {
  const caminhoLimpo = '/' + String(caminho || '').replace(/^\/+/, '').split('?')[0];

  /* ---- 1.54.0 · A PORTA, antes de tudo o resto ----
     Sem sessão válida não se lê nem se escreve nada; `/auth/*` é público, e o
     worker de media usa o seu próprio token. Ver `_porta.mjs`. */
  const porta = await avaliarPorta(repo, {
    caminho, metodo, corpo, env, headers, fetchImpl, seguranca,
    ip: ip || String(headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
  });
  if (porta.resposta) return porta.resposta;
  const conta = porta.conta || null;

  /* ---- 1.18.0 · tudo o que é IA vive em api/_ia (fornecedores, router, agentes)
         e, desde 1.19.0, também a memória e o estúdio de media ---- */
  if (caminhoLimpo === '/ia' || caminhoLimpo.startsWith('/ia/') || caminhoLimpo.startsWith('/media')) {
    const { rotasIA } = await import('./_ia/rotas.mjs');
    return rotasIA(repo, { caminho, metodo, corpo, env, fetchImpl });
  }

  const seg = caminhoLimpo.split('/').filter(Boolean);
  const qs = new URLSearchParams(String(caminho).split('?')[1] || '');
  const m = String(metodo || 'GET').toUpperCase();

  /* ---- 1.41.0 · A PRONTIDÃO PARA LANÇAR ------------------------------------
     O que falta à instalação para servir a sério, por NOME de variável (nunca por
     valor). É a mesma lista que o `/api/health` resume e que o `npm run prontidao`
     imprime: uma verdade, três sítios onde se lê. Só leitura. */
  if (caminhoLimpo === '/sistema/prontidao' && m === 'GET') {
    const { avaliarProntidao } = await import('./_prontidao.mjs');
    return { status: 200, corpo: { ok: true, versao: VERSAO, ...avaliarProntidao(env) } };
  }

  /* ---- 1.37.0 · as respostas dos clientes (o lado que faltava) -------------
     A mesa mandava e ficava à espera. Estes dois caminhos são os que os
     fornecedores chamam quando o cliente responde: assinatura obrigatória (nunca
     se aceita um POST anónimo a fingir de cliente), gravação idempotente e o
     funil a andar. Ver api/_entrada.mjs. */
  if (caminhoLimpo === '/webhooks/whatsapp' || caminhoLimpo === '/webhooks/resend') {
    const e = await import('./_entrada.mjs');
    const canal = caminhoLimpo.endsWith('whatsapp') ? 'whatsapp' : 'email';

    if (canal === 'whatsapp' && m === 'GET') {
      /* a Meta pede isto uma vez, ao ligar o webhook ao número */
      const modo = qs.get('hub.mode');
      const dado = qs.get('hub.verify_token');
      const desafio = qs.get('hub.challenge');
      const esperado = limpo(env.WHATSAPP_VERIFY_TOKEN);
      if (modo !== 'subscribe') return { status: 400, corpo: { error: 'verificação do WhatsApp: falta hub.mode=subscribe' } };
      if (!esperado) return { status: 501, corpo: { error: 'falta WHATSAPP_VERIFY_TOKEN no ambiente (inventa uma frase e cola-a no painel da Meta)' } };
      if (String(dado || '') !== esperado) return { status: 403, corpo: { error: 'token de verificação errado' } };
      return { status: 200, corpo: String(desafio || '') };   // texto puro, é o que a Meta lê
    }

    if (m !== 'POST') return { status: 405, corpo: { error: 'este webhook só aceita POST' } };

    const bruto = typeof corpoBruto === 'string' ? corpoBruto : JSON.stringify(corpo ?? {});
    if (canal === 'whatsapp') {
      const segredo = limpo(env.WHATSAPP_APP_SECRET);
      if (!segredo) return { status: 503, corpo: { error: 'falta WHATSAPP_APP_SECRET no ambiente: sem ele não se distingue um cliente de um desconhecido' } };
      if (!e.assinaturaMeta({ segredo, corpoBase: bruto, assinatura: headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'] })) {
        return { status: 401, corpo: { error: 'assinatura inválida' } };
      }
    } else {
      const segredo = limpo(env.RESEND_WEBHOOK_SECRET);
      if (!segredo) return { status: 503, corpo: { error: 'falta RESEND_WEBHOOK_SECRET no ambiente: sem ele não se distingue um cliente de um desconhecido' } };
      const ok = e.assinaturaSvix({
        segredo,
        id: headers['svix-id'] || headers['Svix-Id'],
        timestamp: headers['svix-timestamp'] || headers['Svix-Timestamp'],
        assinatura: headers['svix-signature'] || headers['Svix-Signature'],
        corpoBase: bruto,
      });
      if (!ok) return { status: 401, corpo: { error: 'assinatura inválida' } };
    }

    const eventos = canal === 'whatsapp' ? e.normalizarWhatsapp(corpo) : e.normalizarEmail(corpo);
    if (!eventos.length) {
      /* não é erro: a Meta manda eventos que não interessam (leitura de recibos,
         números a mudar de estado) e o Resend manda entregas e aberturas */
      return { status: 200, corpo: { ok: true, ignorado: 'nada para guardar neste evento', canal } };
    }
    const feitos = [];
    for (const ev of eventos) {
      try { feitos.push(await e.registarResposta(repo, ev)); } catch (err) {
        feitos.push({ ok: false, erro: String(err.message || err) });
      }
    }
    const respostas = feitos.filter((x) => x.ok && !x.duplicado && !x.ignorado).length;
    const duplicadas = feitos.filter((x) => x.duplicado).length;
    const semLead = feitos.filter((x) => x.ok && !x.duplicado && x.casou === false).length;
    return {
      status: 200,
      corpo: {
        ok: feitos.every((x) => x.ok !== false),
        canal, recebidas: respostas, duplicadas, semLead,
        eventos: feitos.map((x) => ({
          ok: x.ok !== false, duplicado: !!x.duplicado, ignorado: x.ignorado || null,
          erro: x.erro || null, lead: x.lead ? { id: x.lead.id, name: x.lead.name, status: x.lead.status } : null,
        })),
        /* a Meta repete quando não recebe 200: responder 200 é o que trava a
           repetição, e a idempotência cobre o caso de ela insistir de qualquer forma */
        nota: respostas ? `${respostas} resposta(s) guardada(s)` : (duplicadas ? 'evento repetido — nada foi duplicado' : 'nada de novo'),
      },
    };
  }

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
        configured: s.configurado ? !!s.configurado(env) : (tem.length === s.env.length || porConector),
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

  /* ---- 1.27.0 · Vercel Connect: pedir credenciais em vez de as guardar ----
     O token em claro nunca sai daqui. O que sai é o retrato: conector, sujeito,
     validade e um valor mascarado. */
  if (caminhoLimpo === '/conectar/estado' && m === 'GET') {
    const c = await import('./_conect.mjs');
    return { status: 200, corpo: await c.estado(env, { importar: importarConect }) };
  }

  if (caminhoLimpo === '/conectar/conector' && m === 'GET') {
    const c = await import('./_conect.mjs');
    const r = await c.metadataDoConector({ modoCredencial: limpo(qs.get('credencial')) || 'auto' }, { env, importar: importarConect });
    return { status: 200, corpo: r };
  }

  if (caminhoLimpo === '/conectar/teste' && (m === 'POST' || m === 'GET')) {
    const c = await import('./_conect.mjs');
    const fonte = m === 'POST' ? corpo : Object.fromEntries(qs.entries());
    const pedido = limpo(fonte?.sujeito || fonte?.subject || fonte?.id) || null;
    const escopos = limpo(fonte?.escopos || fonte?.scopes);
    const r = await c.testar(
      {
        pedido: pedido ? { id: pedido } : null,
        escopos: escopos ? escopos.split(',').map((x) => x.trim()).filter(Boolean) : null,
        forcar: m === 'GET' ? true : fonte?.forcar !== false,
        /* diagnóstico: auto | oidc-env | oidc-pedido | chave */
        modoCredencial: limpo(fonte?.credencial) || 'auto',
      },
      { env, importar: importarConect },
    );
    /* o botão do Centro de Controlo grava o resultado; um GET de diagnóstico não */
    if (m === 'POST') {
      const cfg = await repo.ia.config.ler().catch(() => ({}));
      await repo.ia.config.gravar('testes', { ...(cfg.testes || {}), 'vercel-connect': { ok: r.ok, ms: r.ms, erro: r.ok ? null : r.erro, quando: r.quando, detalhe: r.ok ? `${r.conector} · expira ${r.expiraEm}` : null } }).catch(() => {});
      await repo.atividade.add('config', `teste de vercel-connect: ${r.ok ? 'token recebido' : `falhou (${String(r.erro).slice(0, 80)})`}`).catch(() => {});
    }
    return { status: 200, corpo: { id: 'vercel-connect', ...r } };
  }

  if (caminhoLimpo === '/conectar/consentimento' && (m === 'POST' || m === 'GET')) {
    const c = await import('./_conect.mjs');
    const fonte = m === 'POST' ? corpo : Object.fromEntries(qs.entries());
    try {
      const r = await c.consentimento(
        {
          pedido: fonte?.sujeito ? { id: limpo(fonte.sujeito) } : null,
          escopos: fonte?.escopos ? String(fonte.escopos).split(',').map((x) => x.trim()).filter(Boolean) : null,
          voltarPara: fonte?.voltarPara || null,
        },
        { env, importar: importarConect },
      );
      return { status: 200, corpo: r };
    } catch (e) {
      throw falha(e.codigo === 'consentimento-desligado' ? 409 : 503, String(e.message || e));
    }
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

  if (caminhoLimpo === '/pesquisa/teste' && m === 'GET') {
    /* diagnóstico: um pedido real a uma fonte, sem escrever nada */
    const p = await import('./_pesquisa.mjs');
    const fonte = limpo(qs.get('fonte')) || 'geoapify';
    const r = await p.testarFonte(fonte, { env, fetchImpl });
    return { status: r.codigo === 'desconhecida' ? 404 : 200, corpo: { ...r, fonte } };
  }

  /* ---- 1.30.0 · as mesmas rotas, agora pela camada de ferramentas ----
     A pesquisa passa toda por `_ferramentas.mjs`: validação de parâmetros antes de
     gastar um crédito, cache de 5 minutos, tecto por minuto e por dia, e uma linha
     de registo por execução (ferramenta, estado, fontes, erro). As respostas mantêm
     os campos que a interface já conhece e ganham os novos — nada foi partido. */
  if (caminhoLimpo === '/pesquisa/leads' && (m === 'POST' || m === 'GET')) {
    const f = await import('./_ferramentas.mjs');
    /* por GET é só leitura: nunca escreve no funil (mas fica no registo da pesquisa) */
    const fonte = m === 'POST' ? corpo : Object.fromEntries(qs.entries());
    const oQue = limpo(fonte?.oQue || fonte?.what || fonte?.atividade);
    const onde = limpo(fonte?.onde || fonte?.where || fonte?.zona);
    const r = await f.executar('pesquisar_empresas', {
      oQue, onde,
      categoria: limpo(fonte?.categoria) || null,
      limite: Number(fonte?.limite || fonte?.limit) || 20,
      raio: Number(fonte?.raio) || 12000,
      pais: limpo(fonte?.pais) || null,
      lang: limpo(fonte?.lang) || null,
    }, { env, fetchImpl, repo });

    const emprestado = {
      ok: r.ok,
      fonte: r.fornecedor,
      categoria: r.dados?.categoria || null,
      pedido: r.dados?.pedido || { oQue, onde },
      centro: r.dados?.centro || null,
      encontrados: r.dados?.empresas?.length || 0,
      leads: r.dados?.empresas || [],
      avisoZona: r.avisos.find((a) => /resolveu|pediste/.test(a)) || null,
      avisos: r.avisos,
      repetidos: r.dados?.repetidos || 0,
      ferramenta: r.ferramenta, ms: r.ms, cache: r.cache,
      codigo: r.codigo, erro: r.erro,
    };

    if (!r.ok) {
      /* 400 para parâmetros, 429 para limite/quota, 502 para o resto — o código diz qual */
      const status = r.codigo === 'parametros' ? 400
        : r.codigo === 'limite' || r.codigo === 'quota' ? 429
          : 502;
      return { status, corpo: { ...emprestado, erro: r.erro, esperarMs: r.esperarMs || null, guardados: null } };
    }

    let guardados = null;
    const podeGuardar = m === 'POST' && fonte?.guardar !== false;
    if (podeGuardar && emprestado.leads.length) {
      const linhas = emprestado.leads.map((l) => ({
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
    }
    return { status: 200, corpo: { ...emprestado, guardados } };
  }

  if (caminhoLimpo === '/pesquisa/web' && (m === 'POST' || m === 'GET')) {
    const f = await import('./_ferramentas.mjs');
    const fonte = m === 'POST' ? corpo : Object.fromEntries(qs.entries());
    const r = await f.executar('pesquisar_web', {
      consulta: limpo(fonte?.consulta || fonte?.q || fonte?.query),
      limite: Number(fonte?.limite || fonte?.limit) || 8,
      profundidade: limpo(fonte?.profundidade) || 'basic',
      /* 1.29.0: notícias com recorte temporal — a Tavily é a pesquisa principal */
      topico: limpo(fonte?.topico || fonte?.topic) || 'general',
      dias: Number(fonte?.dias || fonte?.days) || null,
      dominios: limpo(fonte?.dominios || fonte?.domains)
        ? String(fonte.dominios || fonte.domains).split(',').map((x) => x.trim()).filter(Boolean)
        : null,
      minRelevancia: fonte?.minRelevancia == null ? undefined : Number(fonte.minRelevancia),
    }, { env, fetchImpl, repo });

    const corpoWeb = {
      ok: r.ok,
      fonte: r.fornecedor,
      consulta: r.pedido?.consulta || limpo(fonte?.consulta || fonte?.q || fonte?.query),
      topico: r.dados?.topico || r.pedido?.topico || 'general',
      respostaCurta: r.dados?.respostaCurta || null,
      resultados: r.dados?.resultados || [],
      encontrados: r.dados?.resultados?.length || 0,
      descartados: r.dados?.descartados || 0,
      limiar: r.dados?.limiar ?? null,
      fontes: r.fontes || [],
      avisos: r.avisos || [],
      ferramenta: r.ferramenta, ms: r.ms, cache: r.cache, codigo: r.codigo, erro: r.erro,
      /* resultados da web não são empresas: não entram no funil sem alguém os ler */
      guardados: null,
      nota: 'a web dá contexto, não leads — nada foi escrito no funil',
    };
    if (!r.ok) {
      const status = r.codigo === 'parametros' ? 400
        : r.codigo === 'limite' || r.codigo === 'quota' ? 429
          : r.codigo === 'vazio' ? 200 : 502;
      return { status, corpo: corpoWeb };
    }
    return { status: 200, corpo: corpoWeb };
  }

  if (caminhoLimpo === '/pesquisa/pagina' && m === 'POST') {
    const f = await import('./_ferramentas.mjs');
    const r = await f.executar('ler_pagina', { url: limpo(corpo?.url) }, { env, fetchImpl, repo });
    const corpoPagina = {
      ok: r.ok, fonte: r.fornecedor, url: r.dados?.url || limpo(corpo?.url),
      titulo: r.dados?.titulo || null, texto: r.dados?.texto || '',
      caracteres: r.dados?.caracteres || 0, ms: r.ms, cache: r.cache,
      erro: r.erro, codigo: r.codigo,
    };
    const status = r.ok ? 200 : r.codigo === 'parametros' ? 400 : r.codigo === 'limite' || r.codigo === 'quota' ? 429 : 502;
    return { status, corpo: corpoPagina };
  }

  /* ---- 1.30.0 · o consumo e o que os agentes têm ----
     Duas rotas de leitura: quanto se gastou hoje (por fornecedor, com o tecto e o
     que resta) e quais são as ferramentas que os agentes podem chamar. Nenhuma
     devolve chaves — só nomes, contadores e o endereço da documentação do plano. */
  if (caminhoLimpo === '/pesquisa/uso' && m === 'GET') {
    const lim = await import('./_limites.mjs');
    const f = await import('./_ferramentas.mjs');
    const janela = Number(qs.get('execucoes')) || 20;
    return {
      status: 200,
      corpo: {
        ok: true,
        ...lim.uso(env),
        execucoes: f.execucoes(janela),
        nota: 'o consumo é medido por instância da função; a factura real está no painel do fornecedor.',
      },
    };
  }

  if (caminhoLimpo === '/pesquisa/ferramentas' && m === 'GET') {
    const f = await import('./_ferramentas.mjs');
    return { status: 200, corpo: { ok: true, ...f.estadoFerramentas(env) } };
  }

  /* ---- 1.25.0 · a cópia que sai do servidor pode sair cifrada ---- */
  if (caminhoLimpo === '/backup/cifrado' && (m === 'POST' || m === 'GET')) {
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

  if (caminhoLimpo === '/backup/teste' && (m === 'POST' || m === 'GET')) {
    const { testar } = await import('./_backup.mjs');
    const r = await testar(repo);
    /* por GET é diagnóstico: faz o ensaio todo mas não assina o registo */
    if (m === 'POST') await repo.atividade.add('config', `cópia de segurança testada: ${r.ok ? `ok, ${r.total} linhas` : `falhou (${r.problemas[0] || 'sem razão'})`}`).catch(() => {});
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

    const r = await sondarServico(id, { env, fetchImpl, importarConect });
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

  /* ---- 1.54.0 · quem és tu: o que restou depois da porta ----
     Os `/auth/*` são servidos em `_porta.mjs` (antes daqui). Uma sessão válida
     chega nesta linha com `conta` preenchida; o modo local chega com `null`. */

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
    /* 1.34.0 · os nomes das acções: a mesa sempre chamou `approve/reject/send…`
       (é o que está no src/mesa.js desde a 1.21) e a API só tinha `aprovar/
       rejeitar`. Tudo o que a mesa mandava caía em 404 — e o dono via «não
       funciona» sem saber porquê. Aceitam-se os dois nomes: o português é o
       canónico e o inglês é o que está publicado nos clientes. */
    const acao = { aprovar: 'aprovar', approve: 'aprovar', rejeitar: 'rejeitar', reject: 'rejeitar',
      enviar: 'enviar', send: 'enviar', confirmar: 'confirmar', confirm: 'confirmar',
      promover: 'promover', promote: 'promover', sinal: 'sinal', signal: 'sinal' }[seg[3]];
    if (!acao) throw falha(404, `acção desconhecida numa mensagem: ${seg[3]}`);
    if (acao === 'aprovar') {
      if (msg.status === 'enviada') throw falha(409, 'esta mensagem já foi enviada');
      const m2 = await repo.mensagens.patch(msg.id, { status: 'aprovada', aprovada_at: agoraIso() });
      await repo.atividade.add('mensagem', 'mensagem aprovada');
      return { status: 200, corpo: { ok: true, message: m2 } };
    }
    if (acao === 'rejeitar') {
      const m2 = await repo.mensagens.patch(msg.id, { status: 'rejeitada', motivo: limpo(corpo?.reason || corpo?.motivo) || null });
      await repo.atividade.add('mensagem', 'mensagem rejeitada');
      return { status: 200, corpo: { ok: true, message: m2 } };
    }
    if (acao === 'promover') {
      if (msg.status !== 'ensaio') throw falha(409, 'só uma mensagem em ensaio pode ser promovida');
      const m2 = await repo.mensagens.patch(msg.id, { status: 'rascunho' });
      return { status: 200, corpo: { ok: true, message: m2 } };
    }
    if (acao === 'confirmar') {
      /* o WhatsApp não tem envio automático nesta instalação: a pessoa abre a
         app, envia, e confirma aqui. Fica registado que foi um humano. */
      if (msg.status === 'enviada') throw falha(409, 'já estava enviada');
      const m2 = await repo.mensagens.patch(msg.id, { status: 'enviada', enviada_at: agoraIso(), confirmada: 'humano' });
      await repo.atividade.add('mensagem', 'mensagem confirmada como enviada (à mão)');
      return { status: 200, corpo: { ok: true, message: m2, enviada: true, canal: msg.channel } };
    }
    if (acao === 'sinal') {
      const kind = String(corpo?.kind || '').toLowerCase();
      if (!['respondeu', 'recusou'].includes(kind)) throw falha(400, 'sinal tem de ser «respondeu» ou «recusou»');
      const lead = msg.lead_id ? await repo.leads.byId(msg.lead_id) : null;
      if (lead) await repo.leads.patch(lead.id, { status: kind === 'respondeu' ? 'respondeu' : 'perdido', updated_at: agoraIso() });
      await repo.atividade.add('mensagem', kind === 'respondeu' ? 'o lead respondeu' : 'o lead recusou');
      return { status: 200, corpo: { ok: true, sinal: kind, lead: lead ? { id: lead.id, status: lead.status } : null } };
    }
    /* ---- enviar: um pedido real, com a chave que estiver no ambiente ----
       Email pela Resend; WhatsApp pela Cloud API (se houver número e token). Sem
       chave não se finge: 501/503 com o nome da variável que falta. O estado só
       passa a `enviada` quando o fornecedor devolve um id. */
    if (acao === 'enviar') {
      if (msg.status === 'enviada') throw falha(409, 'esta mensagem já foi enviada');
      if (msg.status !== 'aprovada' && msg.status !== 'falhou') throw falha(409, 'aprova a mensagem antes de enviar');
      const lead = msg.lead_id ? await repo.leads.byId(msg.lead_id) : null;
      const canal = msg.channel === 'email' ? 'email' : 'whatsapp';
      const para = limpo(msg.to) || (canal === 'email' ? limpo(lead?.email) : limpo(lead?.phone));
      if (!para) throw falha(400, canal === 'email' ? 'o lead não tem email' : 'o lead não tem telefone');
      const corpoTexto = String(msg.body || '').trim();
      if (!corpoTexto) throw falha(400, 'a mensagem está vazia');

      let pedido = null;
      if (canal === 'email') {
        if (!env.RESEND_API_KEY) {
          throw falha(503, 'falta RESEND_API_KEY no ambiente: o email não sai daqui sem essa chave (o WhatsApp não precisa dela, mas exige WHATSAPP_TOKEN)');
        }
        pedido = {
          url: 'https://api.resend.com/emails',
          opt: {
            method: 'POST',
            headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              from: remetente(env) || 'onboarding@resend.dev',
              to: [para], subject: limpo(msg.subject) || 'Olá', text: corpoTexto,
            }),
          },
          ler: (j) => j?.id || null,
        };
      } else {
        if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
          throw falha(501, 'o WhatsApp abre na app e confirma-se à mão (é o que a mesa faz). Para envio automático faltam WHATSAPP_TOKEN e WHATSAPP_PHONE_ID no ambiente');
        }
        pedido = {
          url: `https://graph.facebook.com/v20.0/${encodeURIComponent(env.WHATSAPP_PHONE_ID)}/messages`,
          opt: {
            method: 'POST',
            headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: String(para).replace(/[^0-9]/g, ''), type: 'text', text: { body: corpoTexto } }),
          },
          ler: (j) => j?.messages?.[0]?.id || null,
        };
      }
      const inicio = Date.now();
      let r;
      try { r = await fetchImpl(pedido.url, pedido.opt); } catch (e) {
        await repo.mensagens.patch(msg.id, { status: 'falhou', erro: `rede: ${e.message}`.slice(0, 300) });
        throw falha(502, `não consegui falar com o fornecedor de ${canal}: ${e.message}`);
      }
      let devolvido = null;
      try { devolvido = await r.json(); } catch { devolvido = null; }
      if (!r.ok) {
        const motivo = String(devolvido?.message || devolvido?.error?.message || devolvido?.error || `HTTP ${r.status}`).slice(0, 300);
        await repo.mensagens.patch(msg.id, { status: 'falhou', erro: motivo });
        await repo.atividade.add('mensagem', `o envio por ${canal} falhou: ${motivo}`);
        throw falha(502, `o fornecedor recusou o envio: ${motivo}`);
      }
      const providerId = pedido.ler(devolvido);
      const m2 = await repo.mensagens.patch(msg.id, {
        status: 'enviada', enviada_at: agoraIso(), canal_confirmado: canal,
        provider: canal === 'email' ? 'resend' : 'whatsapp-cloud', provider_id: providerId || null, erro: null,
      });
      /* 1.38.0 · mandar não é responder: quem estava «novo» passa a «contactado».
         Não se mexe em quem já respondeu, é reunião, cliente ou perdido — o funil
         só anda para a frente, e quem o faz andar é o cliente, não um envio. */
      if (lead && lead.status === 'novo') {
        try { await repo.leads.patch(lead.id, { status: 'contactado', updated_at: agoraIso() }); } catch { /* o envio já aconteceu */ }
      }
      await repo.atividade.add('mensagem', `mensagem enviada por ${canal}${providerId ? ` (${providerId})` : ''}`);
      return { status: 200, corpo: { ok: true, enviada: true, canal, para, providerId, ms: Date.now() - inicio, message: m2 } };
    }
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

  /* ---- tarefas: criam-se E correm (1.53.2) ----------------------------------
     O que aqui estava: `state: 'failed'` à nascença, com a frase «sem motor de
     IA ligado a esta base». O dono leu-a e respondeu «nas tarefas nada
     funciona» — com razão. Agora o trabalho é feito: ver `_tarefas.mjs`. */
  if (caminhoLimpo === '/ops/tarefas' && m === 'GET') {
    const todas = await repo.tarefas.list(100);
    const fdept = limpo(qs.get('departamento'));
    const festado = limpo(qs.get('estado'));
    return { status: 200, corpo: {
      tarefas: todas.filter((t) => (!festado || t.state === festado) && (!fdept || (DEPARTAMENTOS_POR_TIPO[t.kind] || 'comando') === fdept)),
      tipos: TIPOS_TAREFA, departamentos: DEPARTAMENTOS,
    } };
  }
  if (caminhoLimpo === '/ops/tarefas' && m === 'POST') {
    if (!TIPOS_TAREFA[limpo(corpo?.kind)]) throw falha(400, 'tipo de tarefa desconhecido');
    return criarECorrer({ repo, corpo, env, fetchImpl, TIPOS: TIPOS_TAREFA });
  }
  if (seg[0] === 'ops' && seg[1] === 'tarefas' && seg.length === 4 && m === 'POST') {
    const t = await repo.tarefas.byId(seg[2]);
    if (!t) throw falha(404, 'tarefa não encontrada');
    if (seg[3] === 'correr') return correrDeNovo({ repo, tarefa: t, env, fetchImpl });
    if (seg[3] === 'aprovar' || seg[3] === 'rejeitar') {
      /* aprovar uma tarefa à espera fecha-a como feita; rejeitar fecha-a como
         cancelada. Uma tarefa que ainda não tem resultado não pode ser aprovada
         em nome de um trabalho que não aconteceu. */
      if (seg[3] === 'aprovar' && t.state === 'awaiting_approval' && !t.resultado) {
        return correrDeNovo({ repo, tarefa: t, env, fetchImpl });
      }
      const t2 = await repo.tarefas.patch(t.id, { state: seg[3] === 'aprovar' ? 'succeeded' : 'cancelled', finished_at: agoraIso() });
      await repo.atividade.add('tarefa', `${TIPOS_TAREFA[t.kind]?.label || t.kind}: ${seg[3] === 'aprovar' ? 'aprovada' : 'rejeitada'} por ti`).catch(() => null);
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
  /* 1.54.0 · utilizadores, papéis e sessões são servidos em `_porta.mjs`, com a
     sessão do dono na mão. Aqui já não há lista vazia a fingir de resposta. */
  if (caminhoLimpo === '/ops/stop') return { status: 200, corpo: { ok: true, parado: !!corpo?.stop } };
  /* ---- 1.29.0 · a pesquisa global da mesa, a sério ----
     Antes esta rota devolvia sempre `{ query, grupos: [] }`: a caixa «Pesquisar
     leads, projetos e tarefas…» escrevia e não encontrava nada, nem quando o
     nome estava à frente. Agora procura nas quatro tabelas que a mesa mostra,
     sem acentos e sem maiúsculas, e devolve só os grupos com resultados. */
  if (caminhoLimpo === '/ops/pesquisa') {
    const bruto = limpo(qs.get('q'));
    const semAcentos = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const q = semAcentos(bruto).trim();
    if (q.length < 2) return { status: 200, corpo: { query: bruto, total: 0, grupos: [], nota: 'escreve pelo menos duas letras' } };
    const contem = (...campos) => semAcentos(campos.filter(Boolean).join(' ')).includes(q);
    const [leads, projetos, tarefas, mensagens] = await Promise.all([
      repo.leads.list(500).catch(() => []),
      repo.projetos.list().catch(() => []),
      repo.tarefas.list(500).catch(() => []),
      repo.mensagens.list(300).catch(() => []),
    ]);
    const grupos = [
      {
        label: 'Leads', rota: '#/lead',
        itens: leads.filter((l) => contem(l.name, l.city, l.category, l.email, l.phone, l.website, l.notes))
          .slice(0, 8)
          .map((l) => ({ id: l.id, name: l.name, city: [l.category, l.city].filter(Boolean).join(' · '), route: `#/lead/${encodeURIComponent(l.id)}` })),
      },
      {
        label: 'Projetos', rota: '#/projeto',
        itens: projetos.filter((p2) => contem(p2.name, p2.client, p2.niche, p2.city, p2.status))
          .slice(0, 8)
          .map((p2) => ({ id: p2.id, name: p2.name, client: [p2.client, p2.kindLabel || p2.kind].filter(Boolean).join(' · '), route: `#/projeto/${encodeURIComponent(p2.id)}` })),
      },
      {
        label: 'Tarefas', rota: '#/tarefas',
        itens: tarefas.filter((t) => contem(t.title, t.text, t.status, t.dept, t.agent))
          .slice(0, 8)
          .map((t) => ({ id: t.id, title: t.title || String(t.text || '').slice(0, 80), kindLabel: [t.dept, t.status].filter(Boolean).join(' · '), route: '#/tarefas' })),
      },
      {
        label: 'Mensagens', rota: '#/conversas',
        itens: mensagens.filter((m) => contem(m.subject, m.body, m.to, m.lead_name, m.status))
          .slice(0, 8)
          .map((m) => ({ id: m.id, title: m.subject || String(m.body || '').slice(0, 80), kindLabel: m.status || '', route: '#/conversas' })),
      },
    ].filter((g) => g.itens.length);
    const total = grupos.reduce((n, g) => n + g.itens.length, 0);
    return { status: 200, corpo: { query: bruto, total, grupos, nota: total ? 'resultados reais, sem estimativas' : 'nada corresponde — nem leads, nem projetos, nem tarefas, nem mensagens' } };
  }

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

  /* ---- 1.31.0 · artefactos: o que uma sala entrega ----
     Um site nasce como rascunho, é revisto por uma pessoa e só fica aprovado com
     `aprovado: true` e o nome de quem aprovou. O HTML não é guardado: guarda-se
     o brief e o site é regenerado — uma aprovação, uma verdade. */
  if (caminhoLimpo === '/artefactos' && m === 'GET') {
    const a = await import('./_artefactos.mjs');
    const lista = await a.listar({ repo, limite: Number(qs.get('limite')) || 50 });
    return { status: 200, corpo: { ok: true, total: lista.length, artefactos: lista } };
  }

  if (caminhoLimpo === '/artefactos/site' && m === 'POST') {
    const a = await import('./_artefactos.mjs');
    const r = await a.criarSite(corpo || {}, { repo });
    if (!r.ok) return { status: r.codigo === 'parametros' ? 400 : 502, corpo: r };
    return { status: 201, corpo: r };
  }

  if (seg[0] === 'artefactos' && seg[1] && seg[2] === 'preview' && m === 'GET') {
    const a = await import('./_artefactos.mjs');
    const p = await a.preview(seg[1], { repo });
    if (!p) return { status: 404, corpo: { ok: false, erro: `não há artefacto «${seg[1]}»` } };
    return { status: 200, corpo: { ok: true, ...p } };
  }

  if (seg[0] === 'artefactos' && seg[1] && seg[2] === 'publicar' && m === 'POST') {
    const a = await import('./_artefactos.mjs');
    const r = await a.publicar(seg[1], { repo, aprovado: corpo?.aprovado === true, por: corpo?.por || null });
    const status = r.ok ? 200 : r.codigo === 'nao-existe' ? 404 : r.codigo === 'aprovacao' ? 409 : 400;
    return { status, corpo: r };
  }

  if (seg[0] === 'artefactos' && seg[1] && !seg[2] && m === 'GET') {
    const a = await import('./_artefactos.mjs');
    const art = await a.obter(seg[1], { repo });
    if (!art) return { status: 404, corpo: { ok: false, erro: `não há artefacto «${seg[1]}»` } };
    return { status: 200, corpo: { ok: true, artefacto: art, url: `/artefactos/${art.id}/preview` } };
  }

  /* ---- 1.31.0 · digitalizar papel e imagem ----
     A imagem entra, o texto sai de um OCR configurado, os campos saem de regras
     determinísticas. Nada é gravado no funil aqui: `/digitalizar/lead` devolve a
     proposta, e quem a aceitar guarda-a pelas rotas normais de leads. */
  /* 1.46.0 · quem lê o papel: o motor de visão da casa (não há serviço de OCR
     configurado em nenhum sítio, e exigir um era o mesmo que não ter a função).
     O leitor é montado uma vez por pedido e diz de antemão se há cadeia de visão:
     `cadeiaPara('visao')` não gasta pedido nenhum — só lê o catálogo, as chaves e
     as provas que já existem na base. */
  if (caminhoLimpo === '/digitalizar/estado' && m === 'GET') {
    const d = await import('./_digitalizar.mjs');
    const visao = await visaoDoPedido({ repo, env, fetchImpl });
    return { status: 200, corpo: { ok: true, ...d.estado(env, { visao }) } };
  }

  if (caminhoLimpo === '/digitalizar' && (m === 'POST' || m === 'GET')) {
    const d = await import('./_digitalizar.mjs');
    const fonte = m === 'POST' ? (corpo || {}) : Object.fromEntries(qs.entries());
    const visao = await visaoDoPedido({ repo, env, fetchImpl });
    const r = await d.digitalizar(fonte, { env, fetchImpl, repo, lerComIA: visao.lerComIA });
    const status = r.ok ? 200
      : r.codigo === 'parametros' ? 400
        : r.codigo === 'semchave' ? 503
          : r.codigo === 'limite-fornecedor' ? 429
            : r.codigo === 'vazio' ? 200 : 502;
    return { status, corpo: r };
  }

  if (caminhoLimpo === '/digitalizar/lead' && m === 'POST') {
    const d = await import('./_digitalizar.mjs');
    const campos = Array.isArray(corpo?.campos) ? corpo.campos : null;
    if (!campos) return { status: 400, corpo: { ok: false, erro: 'envia `campos` como vieram do /digitalizar' } };
    const proposta = d.paraLead(campos, { nome: corpo?.nome || null });
    /* guardar continua a ser um gesto separado: aqui só se prepara */
    return { status: 200, corpo: { ok: true, ...proposta, nota: 'proposta — para entrar no funil, confirma o nome e grava com POST /ops/leads' } };
  }

  /* ---- 1.48.0 · O CINE: um lead, um projecto criativo ----------------------

     O pedido: ao abrir uma lead nasce um Master Prompt dela, e dele uma peça
     visual. O motor está em `_cine.mjs`; aqui só se decide quem pode ver o quê e
     qual é o código HTTP de cada falha — para a mesa poder dizer a verdade em
     vez de um «erro» cinzento.

     Nota sobre o que se devolve: as imagens viajam em `data:` dentro do JSON.
     Não há chave nenhuma nesta resposta, e o browser não fala com o fornecedor.
     ------------------------------------------------------------------------- */
  const leadDoCine = async (pedido) => {
    const id = limpo(pedido?.leadId || seg[2]);
    if (id) {
      const l = await repo.leads.byId(id).catch(() => null);
      if (l) return { lead: l };
    }
    /* sem base, aceita-se a ficha que a mesa já tem à mão — mas só para desenhar
       o plano; gerar continua a precisar de um projecto guardado */
    const daMesa = pedido?.lead && typeof pedido.lead === 'object' ? pedido.lead : null;
    if (daMesa && limpo(daMesa.name)) return { lead: { ...daMesa, id: limpo(daMesa.id) || null } };
    return {
      erro: {
        status: 404,
        corpo: {
          ok: false, codigo: 'semlead',
          erro: id ? `não encontrei a lead «${id}» no funil` : 'diz qual é a lead (leadId) ou manda a ficha em `lead`',
        },
      },
    };
  };

  if (caminhoLimpo === '/cine/estado' && m === 'GET') {
    const cine = await import('./_cine.mjs');
    return { status: 200, corpo: await cine.estadoCine({ repo, env }) };
  }

  if (caminhoLimpo === '/cine/projetos' && m === 'GET') {
    const cine = await import('./_cine.mjs');
    return { status: 200, corpo: { ok: true, projetos: await cine.listarProjectos(repo) } };
  }

  if (caminhoLimpo === '/cine/projeto' && m === 'GET') {
    const cine = await import('./_cine.mjs');
    const chave = limpo(qs.get('leadId')) || limpo(qs.get('chave'));
    if (!chave) return { status: 400, corpo: { ok: false, erro: 'diz qual a lead (leadId)' } };
    const arquivo = await cine.lerArquivo(repo);
    const projeto = arquivo.projetos[chave];
    if (!projeto) return { status: 404, corpo: { ok: false, erro: 'esta lead ainda não tem trabalho de Cine' } };
    return { status: 200, corpo: { ok: true, projeto } };
  }

  if (caminhoLimpo === '/cine/abrir' && m === 'POST') {
    const cine = await import('./_cine.mjs');
    const r = await leadDoCine(corpo);
    if (r.erro) return r.erro;
    const ab = await cine.abrirProjecto(repo, r.lead);
    if (!ab.ok) return { status: 400, corpo: ab };
    return {
      status: 200,
      corpo: {
        ok: true, chave: ab.chave, criado: ab.criado, projeto: ab.projeto,
        analise: cine.analisarLead(r.lead),
        estilos: cine.ESTILOS, formatos: cine.FORMATOS, modelos: cine.MODELOS_IMAGEM,
      },
    };
  }

  /* 1.48.1 · `GET /cine/preparar?leadId=…` existe para uma verificação externa
     poder ver o plano que a produção escreve — sem browser e sem sessão de
     escrita. Escreve o plano no projecto (é o mesmo que o botão faz), e é por
     isso que a geração, essa, exige `confirmar=1` no GET. A decisão é a mesma
     que a 1.44.0 tomou para `/ia/provar-modelos`: aceitar GET onde o efeito é
     idempotente e verificável, recusar onde custa dinheiro sem intenção. */
  if (caminhoLimpo === '/cine/preparar' && (m === 'POST' || m === 'GET')) {
    const cine = await import('./_cine.mjs');
    const pedido = m === 'GET' ? Object.fromEntries(qs.entries()) : corpo;
    const r = await leadDoCine(pedido);
    if (r.erro) return r.erro;
    let motor = null;
    try {
      const { criarMotor } = await import('./_ia/motor.mjs');
      motor = criarMotor({ repo, env, fetchImpl });
    } catch { motor = null; }
    const brief = m === 'GET'
      ? Object.fromEntries(['objetivo', 'formato', 'estilo', 'plataforma', 'tom'].filter((k) => qs.get(k)).map((k) => [k, qs.get(k)]))
      : (corpo?.brief || {});
    const out = await cine.prepararCine(repo, r.lead, brief, { motor });
    if (!out.ok) return { status: 400, corpo: out };
    return { status: 200, corpo: out };
  }

  if (caminhoLimpo === '/cine/gerar' && (m === 'POST' || m === 'GET')) {
    const cine = await import('./_cine.mjs');
    if (m === 'GET' && qs.get('confirmar') !== '1') {
      return {
        status: 400,
        corpo: {
          ok: false, codigo: 'confirmar',
          erro: 'gerar por GET só com `confirmar=1`: cada imagem é um pedido real a um serviço alheio. Sem bytes na resposta (`semBytes=1`), o resto vem igual.',
        },
      };
    }
    const pedido = m === 'POST' ? (corpo || {}) : {
      leadId: qs.get('leadId'), quantidade: qs.get('quantidade'), modelo: qs.get('modelo'), seed: qs.get('seed'),
      prompt: qs.get('prompt'), lead: null,
    };
    const r = await leadDoCine(pedido);
    if (r.erro) return r.erro;
    const chave = limpo(r.lead.id) || limpo(r.lead.name);
    const quantas = Math.max(1, Math.min(4, Number(corpo?.quantidade) || 1));
    const travessao = cine.travessaoGeracao({ quantas });
    if (!travessao.ok) return { status: 429, corpo: { ok: false, codigo: 'travessao', erro: travessao.erro } };
    const out = await cine.gerarCine(repo, chave, {
      quantidade: quantas, modelo: pedido?.modelo || null,
      seed: pedido?.seed ?? null, prompt: pedido?.prompt || null, env, fetchImpl,
    });
    /* verificação externa: o base64 de uma imagem não pode ir num `fetch_page`
       nem num registo — a prova fica nos metadados (bytes, mime, ms, semente) */
    if (m === 'GET' && qs.get('semBytes') === '1') {
      out.imagens = (out.imagens || []).map((i) => ({ ...i, dataUrl: i.dataUrl ? `[${i.bytes || 0} bytes ${i.mime || ''}]`.trim() : null }));
      if (out.projeto) {
        out.projeto = {
          ...out.projeto,
          imagens: (out.projeto.imagens || []).map((i) => ({ ...i, dataUrl: i.dataUrl ? `[${i.bytes || 0} bytes]` : null })),
        };
      }
    }
    const status = out.ok ? 200
      : out.codigo === 'semprojecto' || out.codigo === 'semmaster' || out.codigo === 'semprompt' ? 409
        : out.codigo === 'semcreditos' ? 402
          : out.codigo === 'parametros' ? 400 : 502;
    return { status, corpo: out };
  }

  if (caminhoLimpo === '/cine/aprovar' && m === 'POST') {
    const cine = await import('./_cine.mjs');
    const r = await leadDoCine(corpo);
    if (r.erro) return r.erro;
    const chave = limpo(r.lead.id) || limpo(r.lead.name);
    const out = await cine.aprovarImagem(repo, chave, limpo(corpo?.imagemId));
    return { status: out.ok ? 200 : 400, corpo: out };
  }

  if (caminhoLimpo === '/cine/apagar' && m === 'POST') {
    const cine = await import('./_cine.mjs');
    const r = await leadDoCine(corpo);
    if (r.erro) return r.erro;
    const chave = limpo(r.lead.id) || limpo(r.lead.name);
    const imagemId = limpo(corpo?.imagemId);
    const out = imagemId ? await cine.apagarImagem(repo, chave, imagemId) : await cine.apagarProjecto(repo, chave);
    return { status: out.ok ? 200 : 400, corpo: out };
  }

  if (caminhoLimpo === '/cine/video' && m === 'POST') {
    const cine = await import('./_cine.mjs');
    const r = await leadDoCine(corpo);
    if (r.erro) return r.erro;
    const chave = limpo(r.lead.id) || limpo(r.lead.name);
    const arquivo = await cine.lerArquivo(repo);
    const projeto = arquivo.projetos[chave];
    if (!projeto?.master) {
      return { status: 409, corpo: { ok: false, codigo: 'semmaster', erro: 'sem Master Prompt não há vídeo: gera o plano primeiro' } };
    }
    const out = await cine.gerarVideo({
      repo, env, pedido: projeto.master.prompts?.video || projeto.master.seccoes?.conceito || '',
      pipeline: corpo?.pipeline || 'cinematic', tipo: 'video', leadId: chave,
    });
    return { status: out.ok ? 202 : 503, corpo: out };
  }

  throw falha(404, `a base ainda não serve «${caminhoLimpo}»`);
}
