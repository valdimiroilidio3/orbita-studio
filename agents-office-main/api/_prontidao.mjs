/* ===========================================================================
   1.41.0 · A PRONTIDÃO PARA LANÇAR (28 out 2026, pedido: «implementa 1+2+3+4»)

   O problema que este ficheiro resolve: até hoje, saber se a produção estava
   pronta era uma arqueologia. As chaves viviam espalhadas por seis módulos, cada
   um a testar o seu nome — e dois deles testavam nomes DIFERENTES para a mesma
   coisa (`ORBITA_FROM_EMAIL` a enviar, `ORBITA_EMAIL_FROM` a dizer que estava
   configurado). O resultado era o pior dos mundos: o painel a dizer «ligado» e o
   email a sair de `onboarding@resend.dev`, ou o inverso.

   Aqui a lista é uma só, com:
     · o NOME de cada variável (nunca o valor — nem um prefixo dele);
     · os nomes alternativos que o código já aceita (para não haver duas verdades);
     · o que se perde SEM ela, escrito em português e não em código;
     · se é CRÍTICA (sem isto não se lança) ou ESSENCIAL (sem isto uma função
       fica desligada, e o painel diz qual).

   É pura de propósito: não lê ficheiros, não faz rede, não conhece a Vercel.
   Recebe o ambiente e devolve um retrato. Assim prova-se em teste.
   =========================================================================== */

/** Um item = «basta UMA destas variáveis». A primeira é o nome recomendado. */
const item = (nome, porque, aliases, { minimo = 0, opcional = false } = {}) => ({ nome, porque, aliases, minimo, opcional });

export const GRUPOS = [
  {
    id: 'base',
    nome: 'Base de dados',
    critico: true,
    porque: 'sem ela a mesa guarda no browser: os leads e as mensagens desaparecem ao fechar o separador',
    itens: [
      item('URL do projeto', 'o endereço do Supabase (Project Settings → API)', ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']),
      item('Chave secreta', 'a chave que só o servidor vê (service_role ou sb_secret_)', ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']),
    ],
  },
  {
    id: 'acesso',
    nome: 'Acesso',
    critico: true,
    porque: 'sem isto, qualquer pessoa com o endereço manda no escritório e gasta as chaves',
    itens: [
      item('Token da API', 'fecha `/api/*`: 32 caracteres ou mais', ['ORBITA_API_TOKEN'], { minimo: 32 }),
      item('Token de administração', 'protege a página e a mesa quando não há contas', ['ORBITA_ADMIN_TOKEN'], { minimo: 16 }),
    ],
  },
  {
    id: 'esquema',
    nome: 'Esquema da base',
    critico: true,
    porque: 'a base existe mas não tem as tabelas: `/api/health` responde 503 até isto correr',
    itens: [
      item('Token do setup', 'o `?token=` que autoriza aplicar o SQL por `/api/setup`', ['SETUP_TOKEN'], { minimo: 12 }),
      item('Ligação Postgres', 'o `pg` precisa da URL directa para criar as tabelas', ['DATABASE_URL', 'POSTGRES_URL']),
    ],
  },
  {
    id: 'pesquisa',
    nome: 'Pesquisa',
    critico: false,
    porque: 'sem estas duas não há prospeção nem leads reais: é o motor do primeiro trabalho',
    itens: [
      item('Tavily', 'pesquisa web e leitura de páginas (app.tavily.com)', ['TAVILY_API_KEY', 'TAVILY_KEY']),
      item('Geoapify', 'empresas reais por actividade e cidade (myprojects.geoapify.com)', ['GEOAPIFY_API_KEY', 'GEOAPIFY_KEY']),
    ],
  },
  {
    id: 'correio',
    nome: 'Correio',
    critico: false,
    porque: 'sem isto as mensagens ficam à espera na mesa e nunca saem',
    itens: [
      item('Chave Resend', 'envio e recepção de email (resend.com)', ['RESEND_API_KEY']),
      item('Remetente verificado', 'o `from` dos teus emails — o domínio tem de estar verificado no Resend', ['ORBITA_FROM_EMAIL', 'ORBITA_EMAIL_FROM']),
      item('Segredo do webhook', 'prova que uma resposta veio mesmo do Resend', ['RESEND_WEBHOOK_SECRET']),
    ],
  },
  {
    id: 'whatsapp',
    nome: 'WhatsApp',
    critico: false,
    porque: 'sem isto o WhatsApp abre na app e confirma-se à mão — funciona, mas não sozinho',
    itens: [
      item('Token da Meta', 'envio pela Cloud API', ['WHATSAPP_TOKEN']),
      item('ID do número', 'o número emissor da Cloud API', ['WHATSAPP_PHONE_ID']),
      item('Segredo da app', 'valida a assinatura das respostas', ['WHATSAPP_APP_SECRET']),
      item('Token de verificação', 'o `hub.verify_token` que colas no painel da Meta', ['WHATSAPP_VERIFY_TOKEN']),
    ],
  },
  {
    id: 'ia',
    nome: 'Motor de IA',
    critico: false,
    porque: 'sem chave nenhuma o escritório arranca na cadeia gratuita (LLM7, OVH, Pollinations)',
    itens: [
      /* 1.42.0 · o padrão passou a ser uma gratuita com chave: o Pollinations
         (tier Seed) responde a sério e é o que o dono ligou. Continua a não ser
         crítica — sem ela, a cadeia anónima (LLM7 → OVH → OpenCode) arranca. */
      item('Pollinations (gratuita, com chave)', 'tier Seed: mais modelos e mais pedidos do que o anónimo; é o motor de partida quando existe',
        ['POLLINATIONS_API_KEY', 'POLLINATIONS_TOKEN'], { opcional: true }),
      item('Uma chave de IA paga (opcional)', 'só se quiseres acima do gratuito',
        ['OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GOOGLE_AI_API_KEY', 'CEREBRAS_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_API_KEY', 'AI_GATEWAY_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], { opcional: true }),
    ],
  },
  {
    id: 'ocr',
    nome: 'Digitalizar papel',
    critico: false,
    porque: 'sem isto a digitalização diz que falta o serviço, em vez de inventar campos',
    itens: [item('Serviço de OCR', 'um endpoint que devolve o texto da imagem', ['ORBITA_OCR_URL'])],
  },
];

const valor = (env, nome) => String((env && env[nome]) || '').trim();

/** O primeiro alias que tem valor — e só o NOME, nunca o conteúdo. */
function primeiro(env, aliases, minimo = 0) {
  for (const a of aliases) {
    const v = valor(env, a);
    if (v && v.length >= minimo) return a;
  }
  return null;
}

/**
 * O retrato da prontidão.
 * @param {object} env  o ambiente (process.env, ou um objecto em teste)
 * @returns {{ pronto:boolean, grupos:Array, criticasEmFalta:string[], essenciaisEmFalta:string[], resumo:string }}
 */
export function avaliarProntidao(env = {}) {
  const grupos = GRUPOS.map((g) => {
    const itens = g.itens.map((i) => {
      const presente = primeiro(env, i.aliases, i.minimo);
      return {
        nome: i.nome,
        opcional: !!i.opcional,
        pronto: !!presente,
        /* o nome que está lá (ou o recomendado, quando não está nenhum) */
        variavel: presente || i.aliases[0],
        alternativas: i.aliases.slice(1),
        porque: i.porque,
        minimo: i.minimo || 0,
      };
    });
    const prontos = itens.filter((i) => i.pronto).length;
    /* 1.42.0 · um item `opcional` em falta não deixa o grupo «desligado»: o
       grupo diz se a FUNÇÃO está ligada, não se o extra está preenchido. */
    const exigidos = itens.filter((i) => !i.opcional);
    const prontoGrupo = exigidos.length ? exigidos.every((i) => i.pronto) : prontos > 0;
    return {
      id: g.id, nome: g.nome, critico: !!g.critico, porque: g.porque,
      pronto: prontoGrupo,
      parcial: prontos > 0 && !prontoGrupo,
      itens,
    };
  });

  const criticasEmFalta = grupos.filter((g) => g.critico && !g.pronto).map((g) => g.nome);
  const essenciaisEmFalta = grupos.filter((g) => !g.critico && !g.pronto).map((g) => g.nome);
  const pronto = criticasEmFalta.length === 0;

  const resumo = pronto
    ? (essenciaisEmFalta.length
      ? `pronto para lançar · ${essenciaisEmFalta.length} função(ões) ainda desligada(s): ${essenciaisEmFalta.join(', ')}`
      : 'pronto para lançar · tudo ligado')
    : `não lançar ainda · falta ${criticasEmFalta.join(', ')}`;

  return { pronto, grupos, criticasEmFalta, essenciaisEmFalta, resumo };
}

/** A versão curta, para caber no `/api/health` sem o tornar ilegível. */
export function prontidaoCurta(env = {}) {
  const r = avaliarProntidao(env);
  return {
    pronto: r.pronto,
    criticasEmFalta: r.criticasEmFalta,
    essenciaisEmFalta: r.essenciaisEmFalta,
    resumo: r.resumo,
  };
}

/** Só os nomes de variáveis em falta — para o `npm run prontidao` dizer o que colar onde. */
export function variaveisEmFalta(env = {}) {
  const nomes = [];
  for (const g of avaliarProntidao(env).grupos) {
    for (const i of g.itens) if (!i.pronto) nomes.push(i.variavel);
  }
  return [...new Set(nomes)];
}

/**
 * O remetente do correio, com os DOIS nomes que já se usaram.
 * Antes: `integrations.mjs` exigia `ORBITA_EMAIL_FROM` e `api/_rotas.mjs` enviava
 * com `ORBITA_FROM_EMAIL`, caindo em `onboarding@resend.dev` quando só o
 * primeiro existia. Agora há uma resposta só, e é esta função.
 */
export function remetente(env = process.env) {
  return String(env.ORBITA_FROM_EMAIL || env.ORBITA_EMAIL_FROM || '').trim();
}
