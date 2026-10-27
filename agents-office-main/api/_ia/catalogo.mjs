/* ===========================================================================
   1.18.0 · O CATÁLOGO (30 out 2026)

   Quem oferece quê. Este ficheiro é a única tabela de fornecedores e modelos do
   projecto: acrescentar um fornecedor é acrescentar uma entrada aqui, não mexer
   nos agentes nem no router.

   Regras que este catálogo respeita:
     · `chave` são NOMES de variáveis de ambiente, nunca valores. As chaves vivem
       no ambiente da Vercel e não entram no repositório nem no bundle.
     · `preco` é indicativo (USD por milhão de tokens, entrada/saída), para o
       router poder ordenar. `gratuito: true` significa que o plano gratuito
       existe — não que seja ilimitado. Os limites são os do README de
       `free-llm-api-resources` (abril 2026) e mudam: o estado real de um
       fornecedor só se sabe com um teste, e é isso que o Control Center mostra.
     · `visao`, `ferramentas` e `codigo` são capacidades declaradas. Um modelo
       sem `ferramentas: true` nunca recebe ferramentas — a mesa não inventa
       mãos a quem não as tem.
     · id de modelo é sugestão: `/ia/modelos` descobre a lista verdadeira do
       fornecedor quando há chave, e o Control Center deixa fixar outro.
   =========================================================================== */

export const FORNECEDORES = {
  openrouter: {
    nome: 'OpenRouter',
    site: 'https://openrouter.ai',
    docs: 'https://openrouter.ai/docs',
    estilo: 'openai',
    base: 'https://openrouter.ai/api/v1',
    chave: ['OPENROUTER_API_KEY'],
    gratuito: true,
    limites: '20 pedidos/min · 50/dia (até 1000/dia com $10 de crédito)',
    nota: 'Uma porta para muitos modelos, incluindo os `:free`. Bom primeiro fornecedor.',
    cabecalhos: { 'HTTP-Referer': 'https://orbita-agentes.vercel.app', 'X-Title': 'Orbita Agentes' },
  },
  google: {
    nome: 'Google AI Studio',
    site: 'https://aistudio.google.com',
    docs: 'https://ai.google.dev/gemini-api/docs',
    estilo: 'google',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    chave: ['GOOGLE_AI_API_KEY', 'GEMINI_API_KEY'],
    gratuito: true,
    limites: 'por modelo: 5–15 pedidos/min, 20–500 pedidos/dia',
    nota: 'Fora do Reino Unido/Suíça/EEE a UE os dados podem ser usados para treino — ler antes de usar com dados de clientes.',
  },
  groq: {
    nome: 'Groq',
    site: 'https://console.groq.com',
    docs: 'https://console.groq.com/docs',
    estilo: 'openai',
    base: 'https://api.groq.com/openai/v1',
    chave: ['GROQ_API_KEY'],
    gratuito: true,
    limites: 'por modelo: ~1000 pedidos/dia, 6–30 mil tokens/min',
    nota: 'Latência muito baixa. Bom para passos curtos e para o router.',
  },
  cerebras: {
    nome: 'Cerebras',
    site: 'https://cloud.cerebras.ai',
    docs: 'https://inference-docs.cerebras.ai',
    estilo: 'openai',
    base: 'https://api.cerebras.ai/v1',
    chave: ['CEREBRAS_API_KEY'],
    gratuito: true,
    limites: '30 pedidos/min · 1 milhão de tokens/dia',
    nota: 'Modelos abertos de grande porte a correr depressa.',
  },
  mistral: {
    nome: 'Mistral',
    site: 'https://console.mistral.ai',
    docs: 'https://docs.mistral.ai',
    estilo: 'openai',
    base: 'https://api.mistral.ai/v1',
    chave: ['MISTRAL_API_KEY'],
    gratuito: true,
    limites: 'plano gratuito: 1 pedido/s, 500 mil tokens/min (exige opt-in de treino)',
    nota: '`codestral` é o modelo de código; o plano gratuito exige verificação por telefone.',
  },
  huggingface: {
    nome: 'Hugging Face',
    site: 'https://huggingface.co',
    docs: 'https://huggingface.co/docs/inference-providers',
    estilo: 'openai',
    base: 'https://router.huggingface.co/v1',
    chave: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
    gratuito: true,
    limites: '$0,10/mês de crédito incluído',
    nota: 'Roteia para vários fornecedores por trás; o crédito gratuito acaba depressa.',
  },
  nvidia: {
    nome: 'NVIDIA NIM',
    site: 'https://build.nvidia.com',
    docs: 'https://docs.nvidia.com/nim',
    estilo: 'openai',
    base: 'https://integrate.api.nvidia.com/v1',
    chave: ['NVIDIA_API_KEY'],
    gratuito: true,
    limites: '40 pedidos/min',
    nota: 'Exige verificação por telefone. Contextos pequenos em vários modelos.',
  },
  vercel: {
    nome: 'Vercel AI Gateway',
    site: 'https://vercel.com/ai-gateway',
    docs: 'https://vercel.com/docs/ai-gateway',
    estilo: 'openai',
    base: 'https://ai-gateway.vercel.sh/v1',
    chave: ['AI_GATEWAY_API_KEY'],
    gratuito: true,
    limites: '$5/mês de crédito',
    nota: 'Encaminha para vários fornecedores; útil quando a conta da Vercel já existe.',
  },
  anthropic: {
    nome: 'Anthropic',
    site: 'https://console.anthropic.com',
    docs: 'https://docs.anthropic.com',
    estilo: 'anthropic',
    base: 'https://api.anthropic.com',
    chave: ['ANTHROPIC_API_KEY'],
    gratuito: false,
    limites: 'por conta (pago ao token)',
    nota: 'Bom em raciocínio e em ferramentas; o dialeto não é OpenAI.',
  },
  openai: {
    nome: 'OpenAI',
    site: 'https://platform.openai.com',
    docs: 'https://platform.openai.com/docs',
    estilo: 'openai',
    base: 'https://api.openai.com/v1',
    chave: ['OPENAI_API_KEY'],
    gratuito: false,
    limites: 'por conta (pago ao token)',
    nota: 'Referência do dialeto. Sem crédito não responde.',
  },
  deepseek: {
    nome: 'DeepSeek',
    site: 'https://platform.deepseek.com',
    docs: 'https://api-docs.deepseek.com',
    estilo: 'openai',
    base: 'https://api.deepseek.com/v1',
    chave: ['DEEPSEEK_API_KEY'],
    gratuito: false,
    limites: 'pago ao token (muito barato)',
    nota: 'Barato para código; sem plano gratuito permanente.',
  },
};

/* Etiquetas usadas pelo router e pelos agentes:
   raciocinio · codigo · texto · rapido · barato · visao · ferramentas · contexto */
export const MODELOS = [
  /* OpenRouter — os `:free` do README (abril 2026) */
  { fornecedor: 'openrouter', modelo: 'qwen/qwen3-coder:free', etiquetas: ['codigo', 'ferramentas', 'barato'], janela: 262000, preco: [0, 0], gratuito: true },
  { fornecedor: 'openrouter', modelo: 'openai/gpt-oss-120b:free', etiquetas: ['raciocinio', 'codigo', 'ferramentas'], janela: 131000, preco: [0, 0], gratuito: true },
  { fornecedor: 'openrouter', modelo: 'meta-llama/llama-3.3-70b-instruct:free', etiquetas: ['texto', 'raciocinio'], janela: 131000, preco: [0, 0], gratuito: true },
  { fornecedor: 'openrouter', modelo: 'google/gemma-3-27b-it:free', etiquetas: ['texto', 'rapido'], janela: 96000, preco: [0, 0], gratuito: true },
  { fornecedor: 'openrouter', modelo: 'nvidia/nemotron-nano-12b-v2-vl:free', etiquetas: ['visao', 'texto'], janela: 128000, preco: [0, 0], gratuito: true },
  { fornecedor: 'openrouter', modelo: 'minimax/minimax-m2.5:free', etiquetas: ['raciocinio', 'texto'], janela: 200000, preco: [0, 0], gratuito: true },
  /* Google */
  { fornecedor: 'google', modelo: 'gemini-2.5-flash', etiquetas: ['rapido', 'texto', 'visao', 'ferramentas'], janela: 1000000, preco: [0.3, 2.5], gratuito: true },
  { fornecedor: 'google', modelo: 'gemini-2.5-pro', etiquetas: ['raciocinio', 'codigo', 'visao', 'ferramentas', 'contexto'], janela: 1000000, preco: [1.25, 10], gratuito: true },
  { fornecedor: 'google', modelo: 'gemini-2.5-flash-lite', etiquetas: ['rapido', 'barato', 'texto'], janela: 1000000, preco: [0.1, 0.4], gratuito: true },
  /* Groq */
  { fornecedor: 'groq', modelo: 'openai/gpt-oss-120b', etiquetas: ['rapido', 'raciocinio', 'ferramentas', 'codigo'], janela: 131000, preco: [0.15, 0.75], gratuito: true },
  { fornecedor: 'groq', modelo: 'llama-3.3-70b-versatile', etiquetas: ['texto', 'rapido'], janela: 131000, preco: [0.59, 0.79], gratuito: true },
  { fornecedor: 'groq', modelo: 'llama-3.1-8b-instant', etiquetas: ['rapido', 'barato', 'texto'], janela: 131000, preco: [0.05, 0.08], gratuito: true },
  { fornecedor: 'groq', modelo: 'qwen/qwen3-32b', etiquetas: ['codigo', 'raciocinio'], janela: 131000, preco: [0.29, 0.59], gratuito: true },
  /* Cerebras */
  { fornecedor: 'cerebras', modelo: 'gpt-oss-120b', etiquetas: ['rapido', 'raciocinio', 'ferramentas'], janela: 131000, preco: [0.35, 0.69], gratuito: true },
  { fornecedor: 'cerebras', modelo: 'llama3.1-8b', etiquetas: ['rapido', 'barato', 'texto'], janela: 32000, preco: [0.1, 0.1], gratuito: true },
  /* Mistral */
  { fornecedor: 'mistral', modelo: 'mistral-medium-latest', etiquetas: ['raciocinio', 'texto', 'ferramentas'], janela: 131000, preco: [0.4, 2], gratuito: true },
  { fornecedor: 'mistral', modelo: 'mistral-small-latest', etiquetas: ['rapido', 'texto', 'ferramentas'], janela: 131000, preco: [0.1, 0.3], gratuito: true },
  { fornecedor: 'mistral', modelo: 'codestral-latest', etiquetas: ['codigo'], janela: 256000, preco: [0.3, 0.9], gratuito: true },
  /* Hugging Face */
  { fornecedor: 'huggingface', modelo: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', etiquetas: ['codigo'], janela: 262000, preco: [0.3, 1.2], gratuito: true },
  { fornecedor: 'huggingface', modelo: 'meta-llama/Llama-3.3-70B-Instruct', etiquetas: ['texto', 'raciocinio'], janela: 131000, preco: [0.3, 0.6], gratuito: true },
  /* NVIDIA */
  { fornecedor: 'nvidia', modelo: 'meta/llama-3.3-70b-instruct', etiquetas: ['texto', 'raciocinio'], janela: 131000, preco: [0, 0], gratuito: true },
  { fornecedor: 'nvidia', modelo: 'qwen/qwen3-coder-480b-a35b-instruct', etiquetas: ['codigo'], janela: 262000, preco: [0, 0], gratuito: true },
  { fornecedor: 'nvidia', modelo: 'nvidia/nemotron-3-nano-30b-a3b', etiquetas: ['rapido', 'texto'], janela: 131000, preco: [0, 0], gratuito: true },
  /* Vercel AI Gateway */
  { fornecedor: 'vercel', modelo: 'openai/gpt-5-mini', etiquetas: ['raciocinio', 'codigo', 'ferramentas'], janela: 400000, preco: [0.25, 2], gratuito: true },
  { fornecedor: 'vercel', modelo: 'anthropic/claude-sonnet-4.5', etiquetas: ['raciocinio', 'codigo', 'ferramentas', 'contexto'], janela: 200000, preco: [3, 15], gratuito: true },
  /* Pagos, com chave própria */
  { fornecedor: 'anthropic', modelo: 'claude-sonnet-5', etiquetas: ['raciocinio', 'codigo', 'ferramentas', 'contexto'], janela: 200000, preco: [3, 15] },
  { fornecedor: 'anthropic', modelo: 'claude-opus-5', etiquetas: ['raciocinio', 'codigo', 'contexto'], janela: 200000, preco: [15, 75] },
  { fornecedor: 'openai', modelo: 'gpt-5-mini', etiquetas: ['raciocinio', 'codigo', 'ferramentas'], janela: 400000, preco: [0.25, 2] },
  { fornecedor: 'openai', modelo: 'gpt-5', etiquetas: ['raciocinio', 'codigo', 'ferramentas', 'visao'], janela: 400000, preco: [1.25, 10] },
  { fornecedor: 'deepseek', modelo: 'deepseek-chat', etiquetas: ['codigo', 'barato', 'texto'], janela: 131000, preco: [0.27, 1.1] },
];

/** Todos os modelos de um fornecedor, do catálogo. */
export function modelosDe(fornecedor) {
  return MODELOS.filter((m) => m.fornecedor === fornecedor);
}

/** Que fornecedores têm chave no ambiente (nomes mascarados; nunca valores). */
export function comChave(env = process.env) {
  const out = [];
  for (const [id, f] of Object.entries(FORNECEDORES)) {
    const nome = f.chave.find((k) => env[k] && String(env[k]).trim().length >= 8);
    if (nome) out.push({ id, variavel: nome });
  }
  return out;
}

/** Uma chave mascarada, para a interface: `sk-or-v1-…a1b2`. */
export function mascarar(valor) {
  const s = String(valor || '');
  if (!s) return '';
  if (s.length <= 10) return '••••';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
