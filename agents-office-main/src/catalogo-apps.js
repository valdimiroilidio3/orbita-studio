/* ===========================================================================
   1.53.0 · O CATÁLOGO DE APPS (29 out 2026)

   Pedido do dono: «faz os campos de conexão assim como as imagens … esse visual
   para conectar e deve conectar mesmo a todos esses apps aí», com quatro secções
   e a contagem ao lado do título, como na referência.

   Este ficheiro é a APRESENTAÇÃO e a verdade de cada app: o que é, em que secção
   vive, que variáveis de ambiente precisa e — o que interessa — se se liga com
   uma chave, com OAuth, por CLI, ou se não tem API nenhuma.

   Regra da casa: nenhum item diz «conectado» por existir nesta lista. Quem decide
   o estado é o servidor (`/api/platform/apis`), com uma sonda real. Aqui só se
   diz o que o botão pede — e o que ele NÃO consegue pedir (o Canva não aceita
   colar uma chave; o Obsidian é uma pasta).
   =========================================================================== */

/** A ordem das secções: a mesma da referência — o trabalho primeiro, as contas depois. */
export const SECOES = Object.freeze([
  'Programação',
  'Design',
  'Dados e análise',
  'Produtividade',
  'IA',
  'Mensagens',
  'Pagamentos e loja',
  'Infra e nuvem',
]);

/**
 * `tipo`:
 *   chave    — cola-se um token e o servidor testa-o a sério;
 *   oauth    — só por OAuth: exige uma app registada no serviço e um redireccionamento;
 *   cli      — vive na máquina (CLI, pasta, socket local): não há chave para colar;
 *   sem-api  — o serviço não publica API: a ligação é manual, e diz-se.
 */
export const APPS = Object.freeze([
  /* ---------- Programação ---------- */
  { id: 'github', nome: 'GitHub', grupo: 'Programação', desc: 'Repositórios, issues e pull requests', tipo: 'chave', env: ['GITHUB_TOKEN'], site: 'https://github.com/settings/tokens', cor: '#8B949E' },
  { id: 'sentry', nome: 'Sentry', grupo: 'Programação', desc: 'Erros e triagem de crashes', tipo: 'chave', env: ['SENTRY_AUTH_TOKEN'], site: 'https://sentry.io/settings/account/api/auth-tokens/', cor: '#8B5CF6' },
  { id: 'cloudflare', nome: 'Cloudflare', grupo: 'Programação', desc: 'Workers, DNS, armazenamento e logs', tipo: 'chave', env: ['CLOUDFLARE_API_TOKEN'], site: 'https://dash.cloudflare.com/profile/api-tokens', cor: '#F6821F' },
  { id: 'neon', nome: 'Neon', grupo: 'Programação', desc: 'Projetos, branches e migrações Postgres', tipo: 'chave', env: ['NEON_API_KEY'], site: 'https://console.neon.tech/app/settings/api-keys', cor: '#12C48B' },
  { id: 'netlify', nome: 'Netlify', grupo: 'Programação', desc: 'Projetos, deploys e logs de requisições', tipo: 'chave', env: ['NETLIFY_AUTH_TOKEN'], site: 'https://app.netlify.com/user/applications#personal-access-tokens', cor: '#32E6E2' },
  { id: 'render', nome: 'Render', grupo: 'Programação', desc: 'Serviços, deploys e logs', tipo: 'chave', env: ['RENDER_API_KEY'], site: 'https://dashboard.render.com/u/settings#api-keys', cor: '#8A05FF' },
  { id: 'linear', nome: 'Linear', grupo: 'Programação', desc: 'Issues e ciclo de trabalho do projeto', tipo: 'chave', env: ['LINEAR_API_KEY'], site: 'https://linear.app/settings/api', cor: '#5E6AD2' },
  { id: 'vercel', nome: 'Vercel', grupo: 'Programação', desc: 'Deploys, logs de build e projetos', tipo: 'chave', env: ['VERCEL_TOKEN'], site: 'https://vercel.com/account/tokens', cor: '#EDEDED' },
  { id: 'supabase', nome: 'Supabase', grupo: 'Programação', desc: 'Bancos de dados, auth e edge functions', tipo: 'chave', env: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], site: 'https://supabase.com/dashboard/project/_/settings/api', cor: '#3ECF8E' },
  { id: 'prisma', nome: 'Prisma', grupo: 'Programação', desc: 'Migrações e introspeção da base', tipo: 'cli', env: ['DATABASE_URL'], site: 'https://www.prisma.io/docs', cor: '#2D3748' },
  { id: 'railway', nome: 'Railway', grupo: 'Programação', desc: 'Serviços, deploys e variáveis', tipo: 'chave', env: ['RAILWAY_TOKEN'], site: 'https://railway.app/account/tokens', cor: '#9B8AFB' },

  /* ---------- Design ---------- */
  { id: 'figma', nome: 'Figma', grupo: 'Design', desc: 'Ficheiros, componentes e comentários', tipo: 'chave', env: ['FIGMA_TOKEN'], site: 'https://www.figma.com/developers/api#access-tokens', cor: '#F24E1E' },
  { id: 'canva', nome: 'Canva', grupo: 'Design', desc: 'Designs, assets e exportações', tipo: 'oauth', env: [], site: 'https://www.canva.com/developers', cor: '#00C4CC' },
  { id: 'paper', nome: 'Paper', grupo: 'Design', desc: 'Canvas de design em HTML', tipo: 'sem-api', env: [], site: 'https://paper.design', cor: '#7DD3FC' },

  /* ---------- Dados e análise ---------- */
  { id: 'posthog', nome: 'PostHog', grupo: 'Dados e análise', desc: 'Analytics de produto e flags', tipo: 'chave', env: ['POSTHOG_API_KEY', 'POSTHOG_HOST'], site: 'https://app.posthog.com/settings/user-api-keys', cor: '#F59E0B' },
  { id: 'airtable', nome: 'Airtable', grupo: 'Dados e análise', desc: 'Bases e registos', tipo: 'chave', env: ['AIRTABLE_TOKEN'], site: 'https://airtable.com/create/tokens', cor: '#FCB400' },
  { id: 'geoapify', nome: 'Geoapify', grupo: 'Dados e análise', desc: 'Empresas e geocodificação (leads)', tipo: 'chave', env: ['GEOAPIFY_API_KEY'], site: 'https://myprojects.geoapify.com', cor: '#5B8DEF' },
  { id: 'tavily', nome: 'Tavily', grupo: 'Dados e análise', desc: 'Pesquisa na web para os agentes', tipo: 'chave', env: ['TAVILY_API_KEY'], site: 'https://app.tavily.com', cor: '#22C55E' },
  { id: 'aave', nome: 'Aave', grupo: 'Dados e análise', desc: 'Dados e transações on-chain', tipo: 'sem-api', env: [], site: 'https://aave.com', cor: '#B6509E' },

  /* ---------- Produtividade ---------- */
  { id: 'slack', nome: 'Slack', grupo: 'Produtividade', desc: 'Menções e mensagens diretas nos canais', tipo: 'chave', env: ['SLACK_BOT_TOKEN'], site: 'https://api.slack.com/apps', cor: '#4A154B' },
  { id: 'discord', nome: 'Discord', grupo: 'Produtividade', desc: 'Menções e mensagens diretas nos servidores', tipo: 'chave', env: ['DISCORD_BOT_TOKEN'], site: 'https://discord.com/developers/applications', cor: '#5865F2' },
  { id: 'telegram', nome: 'Telegram', grupo: 'Produtividade', desc: 'Grupos e conversas diretas no Telegram', tipo: 'chave', env: ['TELEGRAM_BOT_TOKEN'], site: 'https://t.me/BotFather', cor: '#29A9EB' },
  { id: 'onepassword', nome: '1Password', grupo: 'Produtividade', desc: 'Ligações e segredos da equipa', tipo: 'cli', env: ['OP_SERVICE_ACCOUNT_TOKEN'], site: 'https://developer.1password.com/docs/service-accounts/', cor: '#0364D3' },
  { id: 'bitwarden', nome: 'Bitwarden', grupo: 'Produtividade', desc: 'Cofre de credenciais da equipa', tipo: 'cli', env: ['BW_CLIENTID', 'BW_CLIENTSECRET'], site: 'https://bitwarden.com/help/personal-api-key/', cor: '#175DDC' },
  { id: 'notion', nome: 'Notion', grupo: 'Produtividade', desc: 'Docs e base de conhecimento', tipo: 'chave', env: ['NOTION_TOKEN'], site: 'https://www.notion.so/my-integrations', cor: '#E5E5E5' },
  { id: 'obsidian', nome: 'Obsidian', grupo: 'Produtividade', desc: 'Notas do seu cofre (pasta local)', tipo: 'cli', env: ['OBSIDIAN_VAULT'], site: 'https://help.obsidian.md', cor: '#7C3AED' },
  { id: 'atlassian', nome: 'Atlassian', grupo: 'Produtividade', desc: 'Itens de trabalho do Jira e páginas do Confluence', tipo: 'chave', env: ['ATLASSIAN_SITE', 'ATLASSIAN_EMAIL', 'ATLASSIAN_TOKEN'], site: 'https://id.atlassian.com/manage-profile/security/api-tokens', cor: '#0052CC' },
  { id: 'todoist', nome: 'Todoist', grupo: 'Produtividade', desc: 'Tarefas, projetos e lembretes', tipo: 'chave', env: ['TODOIST_TOKEN'], site: 'https://todoist.com/app/settings/integrations/developer', cor: '#E44332' },
  { id: 'trello', nome: 'Trello', grupo: 'Produtividade', desc: 'Quadros, listas e cartões', tipo: 'chave', env: ['TRELLO_KEY', 'TRELLO_TOKEN'], site: 'https://trello.com/power-ups/admin', cor: '#0079BF' },
  { id: 'gdrive', nome: 'Google Drive', grupo: 'Produtividade', desc: 'Ficheiros e pastas partilhadas', tipo: 'oauth', env: [], site: 'https://console.cloud.google.com/apis/credentials', cor: '#4285F4' },
  { id: 'zapier', nome: 'Zapier', grupo: 'Produtividade', desc: 'Automações entre apps', tipo: 'oauth', env: [], site: 'https://zapier.com/app/settings', cor: '#FF4F00' },

  /* ---------- IA ---------- */
  /* Estas chaves não são «mais um serviço»: cada uma faz aparecer modelos novos no
     menu de modelo do painel de tarefas (`/ia/modelos`). É o «mais IAs» a sério. */
  { id: 'openai', nome: 'OpenAI', grupo: 'IA', desc: 'GPT — modelos de texto, visão e imagem', tipo: 'chave', env: ['OPENAI_API_KEY'], site: 'https://platform.openai.com/api-keys', cor: '#10A37F' },
  { id: 'anthropic', nome: 'Anthropic / Claude', grupo: 'IA', desc: 'Claude — texto longo e ferramentas', tipo: 'chave', env: ['ANTHROPIC_API_KEY'], site: 'https://console.anthropic.com/settings/keys', cor: '#D97757' },
  { id: 'gemini', nome: 'Google Gemini', grupo: 'IA', desc: 'Gemini — texto e visão', tipo: 'chave', env: ['GEMINI_API_KEY'], site: 'https://aistudio.google.com/apikey', cor: '#4285F4' },
  { id: 'openrouter', nome: 'OpenRouter', grupo: 'IA', desc: 'Uma chave, centenas de modelos', tipo: 'chave', env: ['OPENROUTER_API_KEY'], site: 'https://openrouter.ai/keys', cor: '#6467F2' },
  { id: 'groq', nome: 'Groq', grupo: 'IA', desc: 'Respostas muito rápidas (LPU)', tipo: 'chave', env: ['GROQ_API_KEY'], site: 'https://console.groq.com/keys', cor: '#F55036' },
  { id: 'mistral', nome: 'Mistral', grupo: 'IA', desc: 'Mistral — texto e código', tipo: 'chave', env: ['MISTRAL_API_KEY'], site: 'https://console.mistral.ai/api-keys', cor: '#FA520F' },
  { id: 'deepseek', nome: 'DeepSeek', grupo: 'IA', desc: 'Raciocínio e código a custo baixo', tipo: 'chave', env: ['DEEPSEEK_API_KEY'], site: 'https://platform.deepseek.com/api_keys', cor: '#4D6BFE' },
  { id: 'cerebras', nome: 'Cerebras', grupo: 'IA', desc: 'Inferência em wafer-scale', tipo: 'chave', env: ['CEREBRAS_API_KEY'], site: 'https://cloud.cerebras.ai', cor: '#F97316' },
  { id: 'nvidia', nome: 'NVIDIA NIM', grupo: 'IA', desc: 'Modelos abertos servidos pela NVIDIA', tipo: 'chave', env: ['NVIDIA_API_KEY'], site: 'https://build.nvidia.com', cor: '#76B900' },
  { id: 'huggingface', nome: 'Hugging Face', grupo: 'IA', desc: 'Modelos abertos e tarefas de inferência', tipo: 'chave', env: ['HF_TOKEN'], site: 'https://huggingface.co/settings/tokens', cor: '#FFD21E' },
  { id: 'replicate', nome: 'Replicate', grupo: 'IA', desc: 'Imagem, vídeo e áudio por API', tipo: 'chave', env: ['REPLICATE_API_TOKEN'], site: 'https://replicate.com/account/api-tokens', cor: '#111111' },
  { id: 'ollama', nome: 'Ollama', grupo: 'IA', desc: 'Modelos a correr nesta máquina', tipo: 'cli', env: [], site: 'https://ollama.com', cor: '#8B8B8B' },

  /* ---------- Mensagens ---------- */
  { id: 'resend', nome: 'Resend', grupo: 'Mensagens', desc: 'Correio transacional', tipo: 'chave', env: ['RESEND_API_KEY'], site: 'https://resend.com/api-keys', cor: '#F3F4F6' },
  { id: 'sendgrid', nome: 'SendGrid', grupo: 'Mensagens', desc: 'Correio em volume', tipo: 'chave', env: ['SENDGRID_API_KEY'], site: 'https://app.sendgrid.com/settings/api_keys', cor: '#1A82E2' },
  { id: 'twilio', nome: 'Twilio', grupo: 'Mensagens', desc: 'SMS e WhatsApp', tipo: 'chave', env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], site: 'https://console.twilio.com', cor: '#F22F46' },
  { id: 'elevenlabs', nome: 'ElevenLabs', grupo: 'Mensagens', desc: 'Voz sintética', tipo: 'chave', env: ['ELEVENLABS_API_KEY'], site: 'https://elevenlabs.io/app/settings/api-keys', cor: '#E9E9E9' },
  { id: 'meta', nome: 'Meta / Instagram', grupo: 'Mensagens', desc: 'Publicações e mensagens', tipo: 'chave', env: ['META_ACCESS_TOKEN'], site: 'https://developers.facebook.com/apps', cor: '#0866FF' },

  /* ---------- Pagamentos e loja ---------- */
  { id: 'stripe', nome: 'Stripe', grupo: 'Pagamentos e loja', desc: 'Cobranças, subscrições e faturas', tipo: 'chave', env: ['STRIPE_SECRET_KEY'], site: 'https://dashboard.stripe.com/apikeys', cor: '#635BFF' },
  { id: 'shopify', nome: 'Shopify', grupo: 'Pagamentos e loja', desc: 'Loja, produtos e encomendas', tipo: 'chave', env: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'], site: 'https://shopify.dev/docs/api/admin-rest', cor: '#95BF47' },

  /* ---------- Infra e nuvem ---------- */
  { id: 'aws', nome: 'Amazon Web Services', grupo: 'Infra e nuvem', desc: 'S3, Lambda e o resto da nuvem', tipo: 'chave', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], site: 'https://console.aws.amazon.com/iam', cor: '#FF9900' },
  { id: 'vercel-connect', nome: 'Vercel Connect', grupo: 'Infra e nuvem', desc: 'Credenciais ao minuto, sem segredos em repouso', tipo: 'cli', env: [], site: 'https://vercel.com/docs/connect', cor: '#EDEDED' },
]);

/** O que o botão diz em cada tipo — sem prometer o que o serviço não permite. */
export const PEDIDO = Object.freeze({
  chave: { verbo: 'Conectar', titulo: 'Ligar {nome}', nota: 'A chave fica no servidor desta máquina, no ficheiro .env, e nunca volta a sair numa resposta.' },
  oauth: { verbo: 'Ligar', titulo: 'Ligar {nome}', nota: 'Este serviço só aceita OAuth: é preciso uma app registada no {nome} e o redireccionamento. Colar uma chave aqui não funcionaria, e não se finge que funciona.' },
  cli: { verbo: 'Ver como', titulo: '{nome} nesta máquina', nota: 'Isto não é uma chave: vive na máquina onde o Órbita corre (CLI, pasta ou socket local). O botão explica o que instalar, não pede um token falso.' },
  'sem-api': { verbo: 'Porquê?', titulo: '{nome}', nota: 'O {nome} não publica uma API pública. A ligação é manual — exportar e importar ficheiros — e é isso que aqui se diz.' },
});

/** Agrupa por secção, pela ordem de `SECOES`, e diz quantos ficaram em cada uma. */
export function agrupar(apps = APPS) {
  const porSecao = new Map(SECOES.map((s) => [s, []]));
  for (const app of apps) {
    const s = porSecao.has(app.grupo) ? app.grupo : 'Infra e nuvem';
    porSecao.get(s).push(app);
  }
  return SECOES.map((s) => ({ nome: s, itens: porSecao.get(s) })).filter((g) => g.itens.length);
}

/**
 * O estado de um app na interface: o que o servidor sabe, dito em três palavras.
 * `servidor` é a entrada de `/platform/apis` com o mesmo id (ou undefined).
 */
export function estadoDoApp(app, servidor) {
  const s = servidor || null;
  if (s && (s.ready === true || s.verified === true)) {
    return { tom: 'ok', rotulo: 'Conectado', detalhe: s.latencyMs ? `${s.status} · ${s.latencyMs} ms` : 'respondeu agora' };
  }
  if (s && s.configured) {
    return { tom: 'prova', rotulo: 'Por provar', detalhe: s.error || 'chave guardada, ainda sem resposta' };
  }
  if (app.tipo === 'oauth') return { tom: 'outro', rotulo: 'OAuth', detalhe: 'exige app registada' };
  if (app.tipo === 'cli') return { tom: 'outro', rotulo: 'Local', detalhe: 'corre nesta máquina' };
  if (app.tipo === 'sem-api') return { tom: 'outro', rotulo: 'Sem API', detalhe: 'ligação manual' };
  return { tom: 'off', rotulo: 'Conectar', detalhe: 'falta a chave' };
}

/** Junta o catálogo da interface com a lista do servidor (por id). */
export function juntarComServidor(lista, servidor) {
  const porId = new Map((servidor || []).map((s) => [String(s.id), s]));
  const vistos = new Set();
  const juntos = APPS.map((app) => {
    const s = porId.get(app.id) || null;
    vistos.add(app.id);
    return { ...app, servidor: s };
  });
  /* o que o servidor conhece e a interface não (serviços personalizados, por exemplo)
     também tem de aparecer — senão ligava-se e não se via. */
  for (const s of servidor || []) {
    if (vistos.has(String(s.id))) continue;
    juntos.push({
      id: String(s.id), nome: s.name || s.id, grupo: 'Infra e nuvem',
      desc: s.note || 'serviço declarado no servidor', tipo: 'chave',
      env: Array.isArray(s.env) ? s.env : [], site: s.docs || '', servidor: s, extra: true,
    });
  }
  return lista === APPS ? juntos : juntos.filter((a) => lista.some((x) => x.id === a.id));
}

/** Um nome curto para o azulejo do logo: «PostHog» → «PH». */
export function iniciais(nome) {
  const t = String(nome || '').replace(/[^A-Za-z0-9À-ÿ ]/g, ' ').trim();
  if (!t) return '?';
  // «PostHog» e «1Password» são duas palavras escritas juntas: separa-se a maiúscula
  const palavras = t.replace(/([a-zà-ÿ0-9])([A-ZÀ-Þ])/g, '$1 $2').split(/\s+/).filter(Boolean);
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}
