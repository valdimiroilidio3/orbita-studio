// Órbita — A PLATAFORMA: as APIs reais, a máquina, e o arranque sem configuração (28 out 2026).
//
// Pedido do dono: «implementa entrada de API real; assim que lançar o projecto, colocar a API já deve
// funcionar de forma automática; faz esse preparo agora, para todos os tipos de app; as APIs devem
// funcionar logo, instantaneamente.»
//
// A ideia, dita sem marketing:
//   1. Há UM catálogo de serviços (IA, pagamentos, correio, base de dados, deploy, mensagens, dados).
//   2. No arranque o servidor lê o `.env`, vê que chaves existem e SONDA cada serviço configurado —
//      uma chamada real, com prazo, sem nunca escrever a chave em lado nenhum.
//   3. Quando o `.env` muda, ninguém tem de reiniciar nada: o ficheiro é vigiado, as chaves entram a
//      quente e as sondas correm outra vez. É o «instantaneamente» do pedido.
//   4. `GET /api/platform` devolve o retrato — máquina, versões, o que está pronto, o que falta e
//      qual é o nome da variável que falta. Com CORS aberto, qualquer app (web, mobile, outro
//      servidor) consegue ler isto no arranque dela e saber com o que conta.
//
// O que este módulo NÃO faz: não inventa «pronto». Um serviço só é `ready` depois de uma sonda real
// ter respondido; quem não tem chave aparece como `configured:false` com a chave que falta escrita.
// Serviços que não têm sonda barata (AWS, contas de serviço Google) dizem-no (`verified:false`).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROBE_TIMEOUT_MS = 6000;
const PROBE_TTL_MS = 10 * 60 * 1000;      // uma sonda vale 10 minutos
const MACHINE_TTL_MS = 60 * 1000;
const TOOLS_TTL_MS = 5 * 60 * 1000;

/* ---------- o catálogo ----------
   `env`: TODAS as variáveis listadas têm de existir. `probe`: uma chamada barata e sem efeitos
   secundários (um GET de metadados). `headers(env)` devolve os cabeçalhos — a chave nunca sai daqui
   para fora do processo a não ser dentro do pedido ao serviço. */
/* 1.53.0 · O CATÁLOGO CRESCEU (pedido: «deve conectar mesmo a todos esses apps»).
   Cada entrada diz, além das chaves e da sonda: em que SECÇÃO da loja vive (`grupo`), o que é em
   uma linha (`desc`), e COMO se liga (`tipo`): `chave` (cola-se um token), `oauth` (só por
   redireccionamento), `cli` (vive nesta máquina) ou `sem-api` (o serviço não publica API).
   A sonda é sempre um pedido real e barato a um endpoint de identidade — sem efeitos secundários. */
export const CATALOG = [
  /* ---------- Programação ---------- */
  { id: 'github', name: 'GitHub', grupo: 'Programação', desc: 'Repositórios, issues e pull requests', tipo: 'chave', kind: 'codigo', env: ['GITHUB_TOKEN'], docs: 'https://github.com/settings/tokens',
    probe: { url: 'https://api.github.com/rate_limit', headers: (e) => ({ authorization: `Bearer ${e.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' }) } },
  { id: 'sentry', name: 'Sentry', grupo: 'Programação', desc: 'Erros e triagem de crashes', tipo: 'chave', kind: 'codigo', env: ['SENTRY_AUTH_TOKEN'], docs: 'https://sentry.io/settings/account/api/auth-tokens/',
    probe: { url: 'https://sentry.io/api/0/organizations/', headers: (e) => ({ authorization: `Bearer ${e.SENTRY_AUTH_TOKEN}` }) } },
  { id: 'cloudflare', name: 'Cloudflare', grupo: 'Programação', desc: 'Workers, DNS, armazenamento e logs', tipo: 'chave', kind: 'deploy', env: ['CLOUDFLARE_API_TOKEN'], docs: 'https://dash.cloudflare.com/profile/api-tokens',
    probe: { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: (e) => ({ authorization: `Bearer ${e.CLOUDFLARE_API_TOKEN}` }) } },
  { id: 'neon', name: 'Neon', grupo: 'Programação', desc: 'Projetos, branches e migrações Postgres', tipo: 'chave', kind: 'base-de-dados', env: ['NEON_API_KEY'], docs: 'https://console.neon.tech/app/settings/api-keys',
    probe: { url: 'https://console.neon.tech/api/v2/projects', headers: (e) => ({ authorization: `Bearer ${e.NEON_API_KEY}`, accept: 'application/json' }) } },
  { id: 'netlify', name: 'Netlify', grupo: 'Programação', desc: 'Projetos, deploys e logs de requisições', tipo: 'chave', kind: 'deploy', env: ['NETLIFY_AUTH_TOKEN'], docs: 'https://app.netlify.com/user/applications#personal-access-tokens',
    probe: { url: 'https://api.netlify.com/api/v1/user', headers: (e) => ({ authorization: `Bearer ${e.NETLIFY_AUTH_TOKEN}` }) } },
  { id: 'render', name: 'Render', grupo: 'Programação', desc: 'Serviços, deploys e logs', tipo: 'chave', kind: 'deploy', env: ['RENDER_API_KEY'], docs: 'https://dashboard.render.com/u/settings#api-keys',
    probe: { url: 'https://api.render.com/v1/owners?limit=1', headers: (e) => ({ authorization: `Bearer ${e.RENDER_API_KEY}` }) } },
  { id: 'linear', name: 'Linear', grupo: 'Programação', desc: 'Issues e ciclo de trabalho do projeto', tipo: 'chave', kind: 'codigo', env: ['LINEAR_API_KEY'], docs: 'https://linear.app/settings/api',
    probe: { url: 'https://api.linear.app/graphql', method: 'POST', body: JSON.stringify({ query: 'query { viewer { id name } }' }),
      headers: (e) => ({ authorization: e.LINEAR_API_KEY, 'content-type': 'application/json' }) } },
  { id: 'vercel', name: 'Vercel', grupo: 'Programação', desc: 'Deploys, logs de build e projetos', tipo: 'chave', kind: 'deploy', env: ['VERCEL_TOKEN'], docs: 'https://vercel.com/account/tokens',
    probe: { url: 'https://api.vercel.com/v2/user', headers: (e) => ({ authorization: `Bearer ${e.VERCEL_TOKEN}` }) } },
  { id: 'supabase', name: 'Supabase', grupo: 'Programação', desc: 'Bancos de dados, auth e edge functions', tipo: 'chave', kind: 'base-de-dados', env: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], docs: 'https://supabase.com/dashboard/project/_/settings/api',
    probe: { url: (e) => `${String(e.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/`, headers: (e) => ({ apikey: e.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}` }) },
    note: 'A chave service-role é poder absoluto: fica só no servidor.' },
  { id: 'prisma', name: 'Prisma', grupo: 'Programação', desc: 'Migrações e introspeção da base', tipo: 'cli', kind: 'base-de-dados', env: ['DATABASE_URL'], docs: 'https://www.prisma.io/docs',
    probe: null, note: 'Não há API de conta: o Prisma é uma CLI que corre nesta máquina contra a DATABASE_URL.' },
  { id: 'railway', name: 'Railway', grupo: 'Programação', desc: 'Serviços, deploys e variáveis', tipo: 'chave', kind: 'deploy', env: ['RAILWAY_TOKEN'], docs: 'https://railway.app/account/tokens',
    probe: { url: 'https://backboard.railway.app/graphql/v2', method: 'POST', body: JSON.stringify({ query: '{ me { id } }' }),
      headers: (e) => ({ authorization: `Bearer ${e.RAILWAY_TOKEN}`, 'content-type': 'application/json' }) } },

  /* ---------- Design ---------- */
  { id: 'figma', name: 'Figma', grupo: 'Design', desc: 'Ficheiros, componentes e comentários', tipo: 'chave', kind: 'dados', env: ['FIGMA_TOKEN'], docs: 'https://www.figma.com/developers/api#access-tokens',
    probe: { url: 'https://api.figma.com/v1/me', headers: (e) => ({ 'x-figma-token': e.FIGMA_TOKEN }) } },
  { id: 'canva', name: 'Canva', grupo: 'Design', desc: 'Designs, assets e exportações', tipo: 'oauth', kind: 'dados', env: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'], docs: 'https://www.canva.com/developers',
    probe: null, note: 'Só OAuth: exige uma app registada na Canva e o redireccionamento. Não se cola uma chave aqui.' },
  { id: 'paper', name: 'Paper', grupo: 'Design', desc: 'Canvas de design em HTML', tipo: 'sem-api', kind: 'dados', env: ['PAPER_VAULT'], docs: 'https://paper.design',
    probe: null, note: 'A Paper não publica API: a ligação é por ficheiros (exportar/importar), não por chave.' },

  /* ---------- Dados e análise ---------- */
  { id: 'posthog', name: 'PostHog', grupo: 'Dados e análise', desc: 'Analytics de produto e flags', tipo: 'chave', kind: 'dados', env: ['POSTHOG_API_KEY', 'POSTHOG_HOST'], docs: 'https://app.posthog.com/settings/user-api-keys',
    probe: { url: (e) => `${String(e.POSTHOG_HOST || 'https://eu.posthog.com').replace(/\/$/, '')}/api/users/@me/`, headers: (e) => ({ authorization: `Bearer ${e.POSTHOG_API_KEY}` }) } },
  { id: 'airtable', name: 'Airtable', grupo: 'Dados e análise', desc: 'Bases e registos', tipo: 'chave', kind: 'base-de-dados', env: ['AIRTABLE_TOKEN'], docs: 'https://airtable.com/create/tokens',
    probe: { url: 'https://api.airtable.com/v0/meta/whoami', headers: (e) => ({ authorization: `Bearer ${e.AIRTABLE_TOKEN}` }) } },
  { id: 'geoapify', name: 'Geoapify', grupo: 'Dados e análise', desc: 'Empresas e geocodificação (leads)', tipo: 'chave', kind: 'dados', env: ['GEOAPIFY_API_KEY'], docs: 'https://myprojects.geoapify.com',
    probe: { url: (e) => `https://api.geoapify.com/v1/geocode/search?text=Coimbra&limit=1&apiKey=${encodeURIComponent(e.GEOAPIFY_API_KEY)}` } },
  { id: 'tavily', name: 'Tavily', grupo: 'Dados e análise', desc: 'Pesquisa na web para os agentes', tipo: 'chave', kind: 'dados', env: ['TAVILY_API_KEY'], docs: 'https://app.tavily.com',
    probe: null, note: 'É a pesquisa principal do escritório (contexto, notícias, leitura de páginas). Só responde a POST: confirma com «Testar».' },
  { id: 'aave', name: 'Aave', grupo: 'Dados e análise', desc: 'Dados e transações on-chain', tipo: 'sem-api', kind: 'dados', env: ['AAVE_RPC_URL'], docs: 'https://aave.com',
    probe: null, note: 'Lê-se por subgraph/RPC, sem chave de conta: não há token para colar.' },

  /* ---------- Produtividade ---------- */
  { id: 'slack', name: 'Slack', grupo: 'Produtividade', desc: 'Menções e mensagens diretas nos canais', tipo: 'chave', kind: 'mensagens', env: ['SLACK_BOT_TOKEN'], docs: 'https://api.slack.com/apps',
    probe: { url: 'https://slack.com/api/auth.test', method: 'POST', headers: (e) => ({ authorization: `Bearer ${e.SLACK_BOT_TOKEN}` }) },
    ok: (r, body) => body && body.ok === true },
  { id: 'discord', name: 'Discord', grupo: 'Produtividade', desc: 'Menções e mensagens diretas nos servidores', tipo: 'chave', kind: 'mensagens', env: ['DISCORD_BOT_TOKEN'], docs: 'https://discord.com/developers/applications',
    probe: { url: 'https://discord.com/api/v10/users/@me', headers: (e) => ({ authorization: `Bot ${e.DISCORD_BOT_TOKEN}` }) } },
  { id: 'telegram', name: 'Telegram', grupo: 'Produtividade', desc: 'Grupos e conversas diretas no Telegram', tipo: 'chave', kind: 'mensagens', env: ['TELEGRAM_BOT_TOKEN'], docs: 'https://core.telegram.org/bots/api',
    probe: { url: (e) => `https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/getMe` } },
  { id: 'onepassword', name: '1Password', grupo: 'Produtividade', desc: 'Ligações e segredos da equipa', tipo: 'cli', kind: 'credenciais', env: ['OP_SERVICE_ACCOUNT_TOKEN'], docs: 'https://developer.1password.com/docs/service-accounts/',
    probe: null, note: 'Corre pela CLI `op` desta máquina com uma conta de serviço; não é uma chave de API REST.' },
  { id: 'bitwarden', name: 'Bitwarden', grupo: 'Produtividade', desc: 'Cofre de credenciais da equipa', tipo: 'cli', kind: 'credenciais', env: ['BW_CLIENTID', 'BW_CLIENTSECRET'], docs: 'https://bitwarden.com/help/personal-api-key/',
    probe: null, note: 'A CLI `bw` faz o login; estas duas variáveis são o cliente OAuth da máquina.' },
  { id: 'notion', name: 'Notion', grupo: 'Produtividade', desc: 'Docs e base de conhecimento', tipo: 'chave', kind: 'base-de-dados', env: ['NOTION_TOKEN'], docs: 'https://www.notion.so/my-integrations',
    probe: { url: 'https://api.notion.com/v1/users/me', headers: (e) => ({ authorization: `Bearer ${e.NOTION_TOKEN}`, 'notion-version': '2022-06-28' }) } },
  { id: 'obsidian', name: 'Obsidian', grupo: 'Produtividade', desc: 'Notas do seu cofre (pasta local)', tipo: 'cli', kind: 'dados', env: ['OBSIDIAN_VAULT'], docs: 'https://help.obsidian.md',
    probe: null, note: 'É uma pasta de ficheiros nesta máquina. Sem API, sem chave: aponta-se o caminho.' },
  { id: 'atlassian', name: 'Atlassian', grupo: 'Produtividade', desc: 'Itens de trabalho do Jira e páginas do Confluence', tipo: 'chave', kind: 'codigo', env: ['ATLASSIAN_SITE', 'ATLASSIAN_EMAIL', 'ATLASSIAN_TOKEN'], docs: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    probe: { url: (e) => `https://${String(e.ATLASSIAN_SITE).replace(/^https?:\/\//, '').replace(/\/$/, '')}/rest/api/3/myself`,
      headers: (e) => ({ authorization: 'Basic ' + Buffer.from(`${e.ATLASSIAN_EMAIL}:${e.ATLASSIAN_TOKEN}`).toString('base64'), accept: 'application/json' }) } },
  { id: 'todoist', name: 'Todoist', grupo: 'Produtividade', desc: 'Tarefas, projetos e lembretes', tipo: 'chave', kind: 'dados', env: ['TODOIST_TOKEN'], docs: 'https://todoist.com/app/settings/integrations/developer',
    probe: { url: 'https://api.todoist.com/rest/v2/projects', headers: (e) => ({ authorization: `Bearer ${e.TODOIST_TOKEN}` }) } },
  { id: 'trello', name: 'Trello', grupo: 'Produtividade', desc: 'Quadros, listas e cartões', tipo: 'chave', kind: 'dados', env: ['TRELLO_KEY', 'TRELLO_TOKEN'], docs: 'https://trello.com/power-ups/admin',
    probe: { url: (e) => `https://api.trello.com/1/members/me?key=${encodeURIComponent(e.TRELLO_KEY)}&token=${encodeURIComponent(e.TRELLO_TOKEN)}` } },
  { id: 'gdrive', name: 'Google Drive', grupo: 'Produtividade', desc: 'Ficheiros e pastas partilhadas', tipo: 'oauth', kind: 'dados', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], docs: 'https://console.cloud.google.com/apis/credentials',
    probe: null, note: 'OAuth do Google: exige uma app registada e consentimento. Não se cola uma chave.' },
  { id: 'zapier', name: 'Zapier', grupo: 'Produtividade', desc: 'Automações entre apps', tipo: 'oauth', kind: 'dados', env: ['ZAPIER_CLIENT_ID', 'ZAPIER_CLIENT_SECRET'], docs: 'https://zapier.com/app/settings',
    probe: null, note: 'Só OAuth (e o plano certo): não há token pessoal para colar.' },

  /* ---------- IA ---------- */
  /* Cada chave aqui não é «mais um serviço»: é um fornecedor a mais no motor, logo modelos novos
     no menu de modelo do painel de tarefas (`/ia/modelos`). É o «mais IAs» a sério. */
  { id: 'openai', name: 'OpenAI', grupo: 'IA', desc: 'GPT — texto, visão e imagem', tipo: 'chave', kind: 'ia', env: ['OPENAI_API_KEY'], docs: 'https://platform.openai.com/api-keys',
    probe: { url: 'https://api.openai.com/v1/models', headers: (e) => ({ authorization: `Bearer ${e.OPENAI_API_KEY}` }) } },
  { id: 'anthropic', name: 'Anthropic / Claude', grupo: 'IA', desc: 'Claude — texto longo e ferramentas', tipo: 'chave', kind: 'ia', env: ['ANTHROPIC_API_KEY'], docs: 'https://console.anthropic.com/settings/keys',
    probe: { url: 'https://api.anthropic.com/v1/models', headers: (e) => ({ 'x-api-key': e.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }) } },
  { id: 'gemini', name: 'Google Gemini', grupo: 'IA', desc: 'Gemini — texto e visão', tipo: 'chave', kind: 'ia', env: ['GEMINI_API_KEY'], docs: 'https://aistudio.google.com/apikey',
    probe: { url: (e) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(e.GEMINI_API_KEY)}` } },
  { id: 'openrouter', name: 'OpenRouter', grupo: 'IA', desc: 'Uma chave, centenas de modelos', tipo: 'chave', kind: 'ia', env: ['OPENROUTER_API_KEY'], docs: 'https://openrouter.ai/keys',
    probe: { url: 'https://openrouter.ai/api/v1/key', headers: (e) => ({ authorization: `Bearer ${e.OPENROUTER_API_KEY}` }) } },
  { id: 'groq', name: 'Groq', grupo: 'IA', desc: 'Respostas muito rápidas (LPU)', tipo: 'chave', kind: 'ia', env: ['GROQ_API_KEY'], docs: 'https://console.groq.com/keys',
    probe: { url: 'https://api.groq.com/openai/v1/models', headers: (e) => ({ authorization: `Bearer ${e.GROQ_API_KEY}` }) } },
  { id: 'mistral', name: 'Mistral', grupo: 'IA', desc: 'Mistral — texto e código', tipo: 'chave', kind: 'ia', env: ['MISTRAL_API_KEY'], docs: 'https://console.mistral.ai/api-keys',
    probe: { url: 'https://api.mistral.ai/v1/models', headers: (e) => ({ authorization: `Bearer ${e.MISTRAL_API_KEY}` }) } },
  { id: 'deepseek', name: 'DeepSeek', grupo: 'IA', desc: 'Raciocínio e código a custo baixo', tipo: 'chave', kind: 'ia', env: ['DEEPSEEK_API_KEY'], docs: 'https://platform.deepseek.com/api_keys',
    probe: { url: 'https://api.deepseek.com/models', headers: (e) => ({ authorization: `Bearer ${e.DEEPSEEK_API_KEY}` }) } },
  { id: 'cerebras', name: 'Cerebras', grupo: 'IA', desc: 'Inferência em wafer-scale', tipo: 'chave', kind: 'ia', env: ['CEREBRAS_API_KEY'], docs: 'https://cloud.cerebras.ai',
    probe: { url: 'https://api.cerebras.ai/v1/models', headers: (e) => ({ authorization: `Bearer ${e.CEREBRAS_API_KEY}` }) } },
  { id: 'nvidia', name: 'NVIDIA NIM', grupo: 'IA', desc: 'Modelos abertos servidos pela NVIDIA', tipo: 'chave', kind: 'ia', env: ['NVIDIA_API_KEY'], docs: 'https://build.nvidia.com',
    probe: { url: 'https://integrate.api.nvidia.com/v1/models', headers: (e) => ({ authorization: `Bearer ${e.NVIDIA_API_KEY}` }) } },
  { id: 'huggingface', name: 'Hugging Face', grupo: 'IA', desc: 'Modelos abertos e inferência', tipo: 'chave', kind: 'ia', env: ['HF_TOKEN'], docs: 'https://huggingface.co/settings/tokens',
    probe: { url: 'https://huggingface.co/api/whoami-v2', headers: (e) => ({ authorization: `Bearer ${e.HF_TOKEN}` }) } },
  { id: 'replicate', name: 'Replicate', grupo: 'IA', desc: 'Imagem, vídeo e áudio por API', tipo: 'chave', kind: 'ia', env: ['REPLICATE_API_TOKEN'], docs: 'https://replicate.com/account/api-tokens',
    probe: { url: 'https://api.replicate.com/v1/account', headers: (e) => ({ authorization: `Bearer ${e.REPLICATE_API_TOKEN}` }) } },
  { id: 'ollama', name: 'Ollama', grupo: 'IA', desc: 'Modelos a correr nesta máquina', tipo: 'cli', kind: 'ia', env: ['OLLAMA_HOST'], docs: 'https://ollama.com',
    probe: { url: (e) => `${String(e.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/tags` } },

  /* ---------- Mensagens ---------- */
  { id: 'resend', name: 'Resend', grupo: 'Mensagens', desc: 'Correio transacional', tipo: 'chave', kind: 'mensagens', env: ['RESEND_API_KEY'], docs: 'https://resend.com/api-keys',
    probe: { url: 'https://api.resend.com/domains', headers: (e) => ({ authorization: `Bearer ${e.RESEND_API_KEY}` }) } },
  { id: 'sendgrid', name: 'SendGrid', grupo: 'Mensagens', desc: 'Correio em volume', tipo: 'chave', kind: 'mensagens', env: ['SENDGRID_API_KEY'], docs: 'https://app.sendgrid.com/settings/api_keys',
    probe: { url: 'https://api.sendgrid.com/v3/scopes', headers: (e) => ({ authorization: `Bearer ${e.SENDGRID_API_KEY}` }) } },
  { id: 'twilio', name: 'Twilio', grupo: 'Mensagens', desc: 'SMS e WhatsApp', tipo: 'chave', kind: 'mensagens', env: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], docs: 'https://console.twilio.com',
    probe: { url: (e) => `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(e.TWILIO_ACCOUNT_SID)}.json`, headers: (e) => ({ authorization: 'Basic ' + Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString('base64') }) } },
  { id: 'elevenlabs', name: 'ElevenLabs', grupo: 'Mensagens', desc: 'Voz sintética', tipo: 'chave', kind: 'voz', env: ['ELEVENLABS_API_KEY'], docs: 'https://elevenlabs.io/app/settings/api-keys',
    probe: { url: 'https://api.elevenlabs.io/v1/user', headers: (e) => ({ 'xi-api-key': e.ELEVENLABS_API_KEY }) } },
  { id: 'meta', name: 'Meta / Instagram', grupo: 'Mensagens', desc: 'Publicações e mensagens', tipo: 'chave', kind: 'redes', env: ['META_ACCESS_TOKEN'], docs: 'https://developers.facebook.com/apps',
    probe: { url: (e) => `https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(e.META_ACCESS_TOKEN)}` },
    note: 'Publicar exige conta profissional e permissões aprovadas.' },

  /* ---------- Pagamentos e loja ---------- */
  { id: 'stripe', name: 'Stripe', grupo: 'Pagamentos e loja', desc: 'Cobranças, subscrições e faturas', tipo: 'chave', kind: 'pagamentos', env: ['STRIPE_SECRET_KEY'], docs: 'https://dashboard.stripe.com/apikeys',
    probe: { url: 'https://api.stripe.com/v1/balance', headers: (e) => ({ authorization: `Bearer ${e.STRIPE_SECRET_KEY}` }) } },
  { id: 'shopify', name: 'Shopify', grupo: 'Pagamentos e loja', desc: 'Loja, produtos e encomendas', tipo: 'chave', kind: 'loja', env: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'], docs: 'https://shopify.dev/docs/api/admin-rest',
    probe: { url: (e) => `https://${String(e.SHOPIFY_STORE_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '')}/admin/api/2024-07/shop.json`, headers: (e) => ({ 'x-shopify-access-token': e.SHOPIFY_ADMIN_TOKEN }) } },

  /* ---------- Infra e nuvem ---------- */
  { id: 'aws', name: 'Amazon Web Services', grupo: 'Infra e nuvem', desc: 'S3, Lambda e o resto da nuvem', tipo: 'chave', kind: 'infra', env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'], docs: 'https://console.aws.amazon.com/iam',
    probe: null, note: 'Assinatura SigV4: não há sonda barata sem região. Configurado ≠ verificado.' },
];

const TOOL_NAMES = ['git', 'gh', 'node', 'npm', 'python3', 'docker', 'claude', 'codex', 'gemini', 'rg', 'curl', 'ffmpeg', 'sqlite3'];

const whichCmd = () => (process.platform === 'win32' ? 'where' : 'which');
const redactValue = (text, env) => {
  let out = String(text || '');
  for (const v of Object.values(env)) {
    const s = String(v || '');
    if (s.length >= 8) out = out.split(s).join('***');
  }
  return out;
};
const oneLine = (s, max = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

function execP(cmd, args, timeout = 1200) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
        if (err && !stdout && !stderr) return resolve(null);
        resolve(String(stdout || stderr || '').trim());
      });
    } catch { resolve(null); }
  });
}

/**
 * O token interno da API (`ORBITA_API_TOKEN`), sem passos manuais.
 *
 * As rotas que escrevem para fora (enviar email, publicar, deploy, CRM) exigem este token com 32+
 * caracteres. Pedir ao dono «gera um token e mete no .env» é o passo manual que ele mandou acabar:
 * por isso, no arranque, se não houver token em lado nenhum, gera-se um (256 bits), escreve-se no
 * `.env` e usa-se. Se já existir um — no ambiente ou no ficheiro — não se toca em nada.
 */
export function ensureApiToken({ root = ROOT, env = process.env } = {}) {
  const file = path.join(root, '.env');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* primeiro arranque */ }
  const fromFile = parseEnvFile(text);
  const existing = String(env.ORBITA_API_TOKEN || fromFile.ORBITA_API_TOKEN || '').trim();
  if (existing.length >= 32) {
    if (!env.ORBITA_API_TOKEN) env.ORBITA_API_TOKEN = existing;
    return { created: false, source: env.ORBITA_API_TOKEN === existing && !fromFile.ORBITA_API_TOKEN ? 'ambiente' : '.env', length: existing.length };
  }
  const token = crypto.randomBytes(32).toString('base64url');    // 43 caracteres
  const line = `# gerado por Órbita no primeiro arranque (${new Date().toISOString().slice(0, 10)}): assina as rotas privadas\nORBITA_API_TOKEN=${token}\n`;
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  try {
    fs.appendFileSync(file, sep + (text ? '\n' : '') + line, { mode: 0o600 });
  } catch (e) {
    // sem permissão para escrever o .env: a API funciona na mesma nesta sessão, mas morre no reinício
    env.ORBITA_API_TOKEN = token;
    return { created: true, source: 'memória (não consegui escrever o .env)', length: token.length, warning: oneLine(e.message, 120) };
  }
  // uma linha antiga e curta (ex.: ORBITA_API_TOKEN=curto) fica lá e passaria à frente; o ambiente
  // manda sobre o ficheiro, por isso basta pôr a chave no ambiente.
  env.ORBITA_API_TOKEN = token;
  return { created: true, source: '.env', length: token.length };
}

/** Lê um `.env` sem dependências. Devolve os pares e não toca no ambiente. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v.replace(/\\n/g, '\n');
  }
  return out;
}

/** Escreve pares num `.env` SEM perder o resto: comentários, ordem e as outras chaves ficam onde
 *  estão. Um valor vazio APAGA a chave (é assim que se remove uma chave pela interface). */
export function upsertEnv(text, writes = {}) {
  const keys = Object.keys(writes);
  const done = new Set();
  const quote = (v) => (/^[A-Za-z0-9_./:@+=\-]*$/.test(v) ? v : `"${String(v).replace(/"/g, '\\"')}"`);
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m || !keys.includes(m[1])) { out.push(line); continue; }
    const k = m[1];
    if (done.has(k)) continue;                       // uma chave, uma linha
    done.add(k);
    const v = String(writes[k] ?? '');
    if (!v.length) continue;                         // valor vazio = apagar
    out.push(`${k}=${quote(v)}`);
  }
  const faltam = keys.filter((k) => !done.has(k) && String(writes[k] ?? '').length);
  if (faltam.length) {
    if (out.length && out[out.length - 1].trim()) out.push('');
    for (const k of faltam) out.push(`${k}=${quote(String(writes[k]))}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function createPlatform({
  root = ROOT,
  env = process.env,
  fetchImpl = globalThis.fetch,
  dataDir = path.join(root, 'data'),
  now = () => Date.now(),
} = {}) {
  const envFile = path.join(root, '.env');
  const customFile = path.join(dataDir, 'api', 'providers.json');
  const cache = new Map();          // id → { at, ok, status, ms, error }
  const fromFile = new Set();       // chaves que vieram do .env (o ambiente real manda sempre)
  let machineAt = 0, machineData = null, toolsAt = 0, toolsData = null;
  let reloads = 0, lastReloadAt = null;

  /* ---------- serviços personalizados ----------
     Qualquer serviço que não esteja no catálogo entra por `data/api/providers.json`:
       [{ "id":"meu", "name":"Meu Serviço", "kind":"api", "env":["MEU_TOKEN"],
          "probe": { "url":"https://api.exemplo.com/health", "header":"Authorization", "prefix":"Bearer " } }]
     É isto que faz o «para todos os tipos de app»: não é preciso tocar em código para acrescentar
     um serviço — é preciso um ficheiro. Entradas inválidas são ignoradas com um aviso, nunca rebentam. */
  function customProviders() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(customFile, 'utf8')); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const p of raw.slice(0, 60)) {
      if (!p || typeof p !== 'object') continue;
      const id = oneLine(p.id, 40).toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      const name = oneLine(p.name || id, 60);
      const envKeys = Array.isArray(p.env) ? p.env.filter((k) => /^[A-Z_][A-Z0-9_]*$/i.test(String(k))) : [];
      if (!id || !name || !envKeys.length) continue;
      const probe = p.probe && typeof p.probe.url === 'string'
        ? {
          url: p.probe.url,
          method: /^POST$/i.test(p.probe.method || '') ? 'POST' : 'GET',
          headers: p.probe.header ? (e) => ({ [p.probe.header]: `${p.probe.prefix || ''}${e[envKeys[0]] || ''}`.trim() }) : () => ({}),
        }
        : null;
      out.push({ id, name, kind: oneLine(p.kind || 'api', 24), env: envKeys, docs: oneLine(p.docs || '', 200), probe, custom: true, note: oneLine(p.note || 'Serviço declarado em data/api/providers.json.', 160) });
    }
    return out;
  }

  const all = () => [...CATALOG, ...customProviders()];
  const filled = (k) => String(env[k] ?? '').trim().length > 0;

  function describe(p) {
    const configured = p.env.every(filled);
    const missing = p.env.filter((k) => !filled(k));
    const c = cache.get(p.id);
    const fresh = c && now() - c.at < PROBE_TTL_MS;
    const verified = !!(c && fresh && c.ok);
    return {
      id: p.id, name: p.name, kind: p.kind, docs: p.docs || '',
      grupo: p.grupo || 'Infra e nuvem', desc: p.desc || '', tipo: p.tipo || 'chave',
      // os NOMES das variáveis (nunca os valores): é o que a interface mostra e o que ela apaga
      env: p.env.slice(), configured, missing,
      ready: verified || (configured && !p.probe),
      verified,
      checkedAt: c ? new Date(c.at).toISOString() : null,
      latencyMs: c && fresh ? c.ms : null,
      status: c && fresh ? c.status : null,
      error: c && fresh && !c.ok ? c.error : null,
      note: p.note || '',
      custom: !!p.custom,
    };
  }

  async function probeOne(p) {
    if (!p.probe || !fetchImpl) return { id: p.id, skipped: true };
    const at = now();
    const started = at;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    try {
      const url = typeof p.probe.url === 'function' ? p.probe.url(env) : p.probe.url;
      const headers = p.probe.headers ? p.probe.headers(env) : {};
      const res = await fetchImpl(url, {
        method: p.probe.method || 'GET', headers, signal: ctl.signal, redirect: 'follow',
        // 1.53.0: o Linear e o Railway só respondem a POST GraphQL — a sonda leva o corpo
        ...(p.probe.body ? { body: p.probe.body } : {}),
      });
      let body = null;
      try { body = await res.clone().json(); } catch { /* muitos serviços não devolvem JSON */ }
      const ok = p.ok ? !!p.ok(res, body) : res.status < 400;
      const entry = { at, ok, status: res.status, ms: now() - started, error: ok ? null : oneLine(redactValue(`HTTP ${res.status} ${res.statusText}`, env), 140) };
      cache.set(p.id, entry);
      return { id: p.id, ...entry };
    } catch (e) {
      const ms = now() - started;
      const aborted = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
      // `fetch failed` sozinho não diz nada a quem tem de resolver o problema: o código da causa
      // (DNS, TLS, recusa de ligação) é o que muda o próximo passo.
      const causa = e && e.cause && (e.cause.code || e.cause.message);
      const texto = e && e.message ? e.message + (causa && !e.message.includes(causa) ? `: ${causa}` : '') : 'falhou';
      const entry = { at, ok: false, status: 0, ms, error: aborted ? `sem resposta em ${PROBE_TIMEOUT_MS / 1000} s` : oneLine(redactValue(texto, env), 160) };
      cache.set(p.id, entry);
      return { id: p.id, ...entry };
    } finally { clearTimeout(timer); }
  }

  /** Sonda todos os serviços configurados (em paralelo, 4 de cada vez). Só corre com os que têm chave. */
  async function probeAll({ force = false } = {}) {
    const targets = all().filter((p) => p.probe && p.env.every(filled))
      .filter((p) => force || !cache.has(p.id) || now() - cache.get(p.id).at >= PROBE_TTL_MS);
    const results = [];
    const queue = [...targets];
    const worker = async () => { while (queue.length) results.push(await probeOne(queue.shift())); };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return results;
  }

  function status() {
    const list = all().map(describe);
    return {
      list,
      summary: {
        total: list.length,
        configured: list.filter((p) => p.configured).length,
        ready: list.filter((p) => p.ready).length,
        pending: list.filter((p) => p.configured && p.ready === false && p.verified === false && p.missing.length === 0).length,
        missingKeys: [...new Set(list.flatMap((p) => p.missing))].sort(),
      },
      checkedAt: new Date(now()).toISOString(),
    };
  }

  function reloadEnv() {
    reloads += 1; lastReloadAt = new Date(now()).toISOString();
    let text = '';
    try { text = fs.readFileSync(envFile, 'utf8'); } catch { return { changed: [], count: 0 }; }
    const parsed = parseEnvFile(text);
    const changed = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (!fromFile.has(k) && env[k] !== undefined) continue;   // o ambiente real manda
      if (String(env[k] ?? '') !== v) changed.push(k);
      env[k] = v; fromFile.add(k);
    }
    // uma chave apagada do .env tem de desaparecer (senão a sonda continuaria a mentir)
    for (const k of [...fromFile]) {
      if (!(k in parsed)) { delete env[k]; fromFile.delete(k); changed.push(k); }
    }
    if (changed.length) cache.clear();
    return { changed, count: changed.length };
  }

  /** Vigia o `.env`: mudar uma chave no ficheiro e gravar é o mesmo que reiniciar o servidor. */
  function watchEnv(onChange = () => {}) {
    if (!fs.existsSync(envFile)) return () => {};
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = reloadEnv();
        if (!r.count) return;
        await probeAll({ force: true });
        onChange(r);
      }, 400);
    };
    try { fs.watchFile(envFile, { interval: 1000 }, handler); } catch { return () => {}; }
    return () => { try { fs.unwatchFile(envFile, handler); } catch { /* já não estava */ } };
  }

  /* ---------- a máquina ----------
     O terminal e a API dizem em que máquina o escritório foi aberto: sistema, versão, arquitectura,
     memória, e que ferramentas existem no PATH (com versão, quando a dizem depressa). É isto que faz
     o terminal «funcionar de acordo com a máquina» em vez de fingir que todas são iguais. */
  async function tools() {
    if (toolsData && now() - toolsAt < TOOLS_TTL_MS) return toolsData;
    const which = whichCmd();
    const found = await Promise.all(TOOL_NAMES.map(async (name) => {
      const p = await execP(which, [name], 800);
      if (!p) return { name, found: false, path: null, version: null };
      const bin = p.split(/\r?\n/)[0].trim();
      let version = null;
      for (const flag of ['--version', '-v']) {
        const v = await execP(bin, [flag], 1200);
        if (v) { version = oneLine(v.split(/\r?\n/)[0], 60); break; }
      }
      return { name, found: true, path: bin, version };
    }));
    toolsData = found; toolsAt = now();
    return found;
  }

  async function machine() {
    if (machineData && now() - machineAt < MACHINE_TTL_MS) return machineData;
    const cpus = os.cpus() || [];
    machineData = {
      host: os.hostname(),
      platform: process.platform,
      os: `${os.type()} ${os.release()}`,
      arch: process.arch,
      cpu: cpus[0] ? oneLine(cpus[0].model, 80) : 'desconhecido',
      cores: cpus.length,
      memoryGB: Math.round((os.totalmem() / 1e9) * 10) / 10,
      freeGB: Math.round((os.freemem() / 1e9) * 10) / 10,
      uptimeH: Math.round((os.uptime() / 3600) * 10) / 10,
      node: process.version,
      shell: process.platform === 'win32' ? (env.ComSpec || 'cmd.exe') : (env.SHELL || '/bin/sh'),
      home: os.homedir(),
      cwd: process.cwd(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      pid: process.pid,
      tools: await tools(),
      at: new Date(now()).toISOString(),
    };
    machineAt = now();
    return machineData;
  }

  /** O documento de descoberta: o que qualquer app pode chamar, e com que autenticação. */
  function endpoints(version = '') {
    return {
      version,
      openapiish: 'não é OpenAPI: é a lista curta e verdadeira das rotas que existem',
      cors: 'estas rotas respondem com Access-Control-Allow-Origin: *',
      routes: [
        { method: 'GET', path: '/api/platform', auth: 'nenhuma', why: 'o retrato: máquina, versões e APIs prontas' },
        { method: 'GET', path: '/api/health', auth: 'nenhuma', why: 'estado do escritório, modelos, integrações' },
        { method: 'GET', path: '/api/agents', auth: 'nenhuma', why: 'os 35 agentes, funções e ferramentas' },
        { method: 'GET', path: '/api/brain', auth: 'nenhuma', why: 'o grafo de notas do cérebro' },
        { method: 'GET', path: '/api/forge', auth: 'nenhuma', why: 'a oficina: ferramentas por sala' },
        { method: 'GET', path: '/api/forge/stream', auth: 'nenhuma', why: 'SSE: o terminal da oficina ao vivo' },
        { method: 'POST', path: '/api/forge/draft', auth: 'nenhuma (local)', why: 'forjar, provar e activar uma ferramenta' },
        { method: 'GET', path: '/api/tasks', auth: 'nenhuma (local)', why: 'tarefas e o seu estado real' },
        { method: 'POST', path: '/api/tasks', auth: 'nenhuma (local)', why: 'entregar trabalho a uma sala' },
        { method: 'POST', path: '/api/platform/reload', auth: 'Bearer ORBITA_API_TOKEN', why: 'reler o .env e sondar outra vez' },
        { method: 'POST', path: '/api/platform/probe', auth: 'Bearer ORBITA_API_TOKEN', why: 'forçar uma sonda a todos os serviços' },
      ],
    };
  }

  /** Arranque: uma sonda em segundo plano (não trava o servidor) e o vigia do `.env`. */
  function start({ onChange } = {}) {
    reloadEnv();
    setTimeout(() => { probeAll().catch(() => {}); }, 60);
    const unwatch = watchEnv(onChange);
    return { unwatch, stop: unwatch };
  }

  /* ---------- escrever uma chave pelo browser ----------
     Pedido do dono (29 out 2026): «cria um campo para implementação de APIs, configurações reais».
     O que isto faz, dito sem marketing: valida que a variável pertence MESMO ao serviço, grava no
     `.env` do projecto, relê o ficheiro (sem reiniciar nada) e SONDA o serviço — o resultado que
     volta é o da sonda real, com HTTP e latência, não um «guardado com sucesso» vazio.
     O que NÃO faz: nunca devolve o valor da chave (só o nome da variável), e nunca aceita uma
     variável que não esteja declarada no serviço. */
  async function saveKey({ id, values = {} } = {}) {
    const p = all().find((x) => x.id === String(id || '').trim().toLowerCase());
    if (!p) return { ok: false, error: 'serviço desconhecido', known: all().map((x) => x.id) };
    const allowed = new Set(p.env);
    const writes = {};
    for (const [k, raw] of Object.entries(values || {})) {
      if (!allowed.has(k)) return { ok: false, error: `${k} não pertence a ${p.name}`, env: p.env };
      const v = String(raw ?? '').trim();
      if (v.length > 4096) return { ok: false, error: 'o valor é longo demais (máx. 4096)', env: p.env };
      if (/[\r\n]/.test(v)) return { ok: false, error: 'o valor tem uma mudança de linha', env: p.env };
      writes[k] = v;
    }
    if (!Object.keys(writes).length) return { ok: false, error: 'sem valores — nada a guardar', env: p.env };
    let text = '';
    try { text = fs.readFileSync(envFile, 'utf8'); } catch { /* primeiro arranque */ }
    const next = upsertEnv(text, writes);
    try {
      fs.mkdirSync(path.dirname(envFile), { recursive: true });
      const mode = fs.existsSync(envFile) ? (fs.statSync(envFile).mode & 0o777) : 0o600;
      fs.writeFileSync(envFile, next.endsWith('\n') || !next.length ? next : next + '\n', { mode });
    } catch (e) {
      return { ok: false, error: 'não consegui escrever o .env: ' + oneLine(e.message, 120), env: p.env };
    }
    reloadEnv();
    const saved = Object.keys(writes);
    const cleared = saved.filter((k) => !writes[k].length);
    const complete = p.env.every(filled);
    const probe = complete && p.probe ? await probeOne(p) : null;
    return {
      ok: true, id: p.id, name: p.name, saved, cleared, configured: complete,
      missing: p.env.filter((k) => !filled(k)),
      probe, apis: status(),
    };
  }

  /* ---------- 1.53.0 · «+ Adicionar personalizado» ----------
     Um serviço que não está no catálogo entra por um ficheiro (`data/api/providers.json`), sem tocar
     em código. O que se valida aqui: nome, um endereço https/http de sonda, e o NOME da variável da
     chave. Nada de valores: a chave grava-se depois pelo caminho normal (`saveKey`), que escreve no
     `.env` e sonda. Um endereço inválido é recusado por palavras, não com um stack trace. */
  async function saveCustom({ name, url, env: chave, header, kind } = {}) {
    const nome = oneLine(name, 60);
    const endereco = oneLine(url, 400);
    const varName = oneLine(chave, 60).toUpperCase();
    if (!nome) return { ok: false, error: 'falta o nome do serviço' };
    if (!/^https?:\/\/[^\s]+$/i.test(endereco)) return { ok: false, error: 'o endereço de sonda tem de começar por https:// ou http://' };
    if (!/^[A-Z][A-Z0-9_]*$/.test(varName)) return { ok: false, error: 'a variável da chave tem de ser MAIÚSCULAS_COM_SUBlinhados' };
    let lista = [];
    try { const raw = JSON.parse(fs.readFileSync(customFile, 'utf8')); if (Array.isArray(raw)) lista = raw; } catch { /* primeiro serviço */ }
    const id = nome.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'servico';
    if (lista.some((x) => x && x.id === id)) return { ok: false, error: `já existe um serviço com o id «${id}»` };
    lista.push({ id, name: nome, kind: oneLine(kind || 'api', 24), env: [varName], docs: '', note: 'adicionado na loja de apps',
      probe: { url: endereco, header: oneLine(header || 'Authorization', 40), prefix: '' } });
    try {
      fs.mkdirSync(path.dirname(customFile), { recursive: true });
      fs.writeFileSync(customFile, JSON.stringify(lista.slice(0, 60), null, 2) + '\n');
    } catch (e) {
      return { ok: false, error: 'não consegui gravar o ficheiro: ' + oneLine(e.message, 120) };
    }
    cache.clear();
    return { ok: true, id, name: nome, env: [varName], custom: true, providers: customProviders().map((p) => p.id), apis: status() };
  }

  /* 1.53.0 · o botão «Testar» da loja. Uma sonda REAL a um serviço, por id, com o que estiver
     no ambiente. Sem chave diz qual falta (não finge que testou); sem sonda diz porquê. */
  async function probeId(id) {
    const p = all().find((x) => x.id === String(id || ''));
    if (!p) return { ok: false, id: String(id || ''), error: `não conheço o serviço «${id}»` };
    const missing = p.env.filter((k) => !filled(k));
    if (missing.length) return { ok: false, id: p.id, name: p.name, missing, error: `falta ${missing.join(', ')} no ambiente` };
    if (!p.probe) return { ok: false, id: p.id, name: p.name, noProbe: true, error: `${p.name}: sem sonda automática — ${p.note || 'liga-se por OAuth, no sítio do serviço'}` };
    const r = await probeOne(p);
    return { ok: !!r.ok, id: p.id, name: p.name, status: r.status, ms: r.ms, error: r.error || null };
  }

  return {
    machine, tools, status, probeAll, probeId, reloadEnv, watchEnv, endpoints, start, saveKey, saveCustom,
    get envFile() { return envFile; },
    get meta() { return { reloads, lastReloadAt, fromFileKeys: [...fromFile] }; },
    _cache: cache,   // para os testes poderem olhar para o que foi sondado, sem esperar
  };
}
