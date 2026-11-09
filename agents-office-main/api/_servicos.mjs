/* ===========================================================================
   1.79.2 · O CATÁLOGO DE SERVIÇOS — uma lista, dois leitores (9 nov 2026)

   Saía de `_rotas.mjs`, onde a mesa o lia para a aba de Configurações. Mas há um
   segundo leitor legítimo: o `/api/health`, que é **público** e é a única coisa
   que uma página publicada consegue ler sem sessão. A barra de conectores do
   escritório dizia «os conectores vêm do `claude mcp list` desta máquina» — e na
   publicação não há máquina nenhuma. Passa a dizer o que o SERVIDOR tem ligado.

   Aqui só há nomes, categorias e variáveis de ambiente (nunca valores), mais a
   sonda real de cada um (que o `_rotas` continua a usar quando o dono carrega em
   «testar»). Nada disto faz pedidos por si.
   =========================================================================== */

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

/**
 * 1.79.2 · o retrato PÚBLICO dos conectores: quais estão ligados no ambiente do
 * servidor e quais faltam. Só nomes de serviços e de variáveis — nunca valores,
 * nunca um pedido a nenhum fornecedor. É o que o `/api/health` publica e o que a
 * barra de conectores do escritório mostra sem sessão aberta.
 */
export function resumoDosConectores(env = {}) {
  const de = SERVICOS.map((s) => {
    const ligado = typeof s.configurado === 'function'
      ? !!s.configurado(env)
      : (s.env.length > 0 && s.env.every((v) => !!env[v]));
    return {
      id: s.id, nome: s.name, tipo: s.kind, ligado,
      falta: s.env.filter((v) => !env[v]),
    };
  });
  return {
    total: de.length,
    ligados: de.filter((x) => x.ligado).map((x) => ({ id: x.id, nome: x.nome, tipo: x.tipo })),
    porLigar: de.filter((x) => !x.ligado).map((x) => x.id),
    de,
  };
}
