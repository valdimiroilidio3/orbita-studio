/* ===========================================================================
   1.63.0 · O ARRANQUE (4 nov 2026)

   O problema, dito como ele é: a instalação dizia `{"ok":false}` a quem sabe ler
   JSON e «Criar a primeira conta» a quem só vê a página. Entre as duas coisas
   ficava o trabalho a sério — descobrir que faltava uma migração (`orbita_faturas`),
   que o grupo «Acesso» não tinha token nenhum, e que o correio e o WhatsApp
   estavam desligados por falta de chave. Nada disto se via dentro da aplicação.

   Este ficheiro é a lista: pega no que o servidor JÁ diz (`/api/health`, que é
   público, e `/sistema/prontidao`, que é a lista completa e só se lê com sessão)
   e transforma-o em peças com três coisas cada uma — **o que falta**, **porque
   é que isso trava o trabalho** e **a acção concreta** que o resolve.

   As regras que este módulo não quebra:

     · **nunca diz «pronto» sem leitura**. Sem resposta do servidor o estado é
       `sem-leitura` e a frase diz «não sei» — não há optimismo por omissão;
     · **nunca inventa variáveis**. A tabela de acções abaixo só tem nomes que
       existem em `api/_prontidao.mjs`; um teste compara as duas listas e falha
       se alguém inventar uma;
     · **o que está em falta aparece primeiro**, e dentro disso o que é crítico
       antes do que é essencial. A ordem é a ordem em que se resolve.
   =========================================================================== */

/* ---------- a acção concreta de cada variável ----------
   `onde` é o sítio (a página onde se cria), `texto` é o que se escreve, e
   `nota` é a parte que se esquece: uma variável nova na Vercel só conta no
   código que arranca DEPOIS de um deploy novo. Dizer isto evita a hora perdida
   a carregar em «Verificar» e a ver o mesmo resultado. */

const VERCEL = 'Vercel → Project → Settings → Environment Variables';
const REDEPLOY = 'depois disto, Deployments → o último → Redeploy: uma variável nova só entra no código que arranca a seguir';

const ACAO = {
  SUPABASE_URL: { onde: VERCEL, texto: 'SUPABASE_URL (Supabase → Project Settings → API → Project URL)' },
  SUPABASE_SECRET_KEY: { onde: VERCEL, texto: 'SUPABASE_SECRET_KEY (Supabase → API → a chave service_role / sb_secret_)' },
  ORBITA_API_TOKEN: { onde: VERCEL, texto: 'ORBITA_API_TOKEN — 32 caracteres ou mais, gerados à sorte (não é uma palavra)', nota: 'é o caminho das máquinas: `Authorization: Bearer …` lê e escreve na API sem sessão. A mesa em si é fechada pelas contas' },
  ORBITA_ADMIN_TOKEN: { onde: VERCEL, texto: 'ORBITA_ADMIN_TOKEN — 16 caracteres ou mais', nota: 'acesso total por token (aprova, entrega, pára envios); contas e palavras-passe continuam a pedir sessão' },
  SETUP_TOKEN: { onde: VERCEL, texto: 'SETUP_TOKEN — 12 caracteres ou mais', nota: 'é o `?token=` que autoriza aplicar o SQL por `/api/setup`; a primeira conta já não o pede (é o email do dono que fecha a porta)' },
  DATABASE_URL: { onde: VERCEL, texto: 'DATABASE_URL (Postgres → Connection string → URI)', nota: 'o `pg` precisa da ligação directa para criar as tabelas' },
  TAVILY_API_KEY: { onde: 'app.tavily.com', texto: 'TAVILY_API_KEY na Vercel', nota: 'sem ela não há pesquisa web nem leitura de páginas' },
  GEOAPIFY_API_KEY: { onde: 'myprojects.geoapify.com', texto: 'GEOAPIFY_API_KEY na Vercel', nota: 'sem ela não há empresas reais por actividade e cidade' },
  RESEND_API_KEY: { onde: 'resend.com → API Keys', texto: 'RESEND_API_KEY na Vercel', nota: 'sem ela as mensagens ficam à espera na mesa e nunca saem' },
  ORBITA_FROM_EMAIL: { onde: 'resend.com → Domains', texto: 'ORBITA_FROM_EMAIL na Vercel (o domínio tem de estar verificado)' },
  RESEND_WEBHOOK_SECRET: { onde: 'resend.com → Webhooks', texto: 'RESEND_WEBHOOK_SECRET na Vercel', nota: 'prova que uma resposta veio mesmo do Resend' },
  WHATSAPP_TOKEN: { onde: 'Meta for Developers → WhatsApp → API Setup', texto: 'WHATSAPP_TOKEN na Vercel' },
  WHATSAPP_PHONE_ID: { onde: 'Meta for Developers → WhatsApp → API Setup', texto: 'WHATSAPP_PHONE_ID na Vercel' },
  WHATSAPP_APP_SECRET: { onde: 'Meta for Developers → App settings → Basic', texto: 'WHATSAPP_APP_SECRET na Vercel' },
  WHATSAPP_VERIFY_TOKEN: { onde: 'Meta for Developers → WhatsApp → Configuration', texto: 'WHATSAPP_VERIFY_TOKEN na Vercel', nota: 'é o `hub.verify_token` que colas no painel da Meta' },
  POLLINATIONS_API_KEY: { onde: 'pollinations.ai', texto: 'POLLINATIONS_API_KEY na Vercel', nota: 'é opcional: sem chave o escritório arranca na cadeia gratuita' },
  OPENROUTER_API_KEY: { onde: 'openrouter.ai → Keys', texto: 'OPENROUTER_API_KEY (ou OUTRA chave de IA: GROQ_API_KEY, GOOGLE_AI_API_KEY…)', nota: 'só é preciso acima do gratuito' },
  ORBITA_OCR_URL: { onde: VERCEL, texto: 'ORBITA_OCR_URL (Tesseract ou PaddleOCR teu)', nota: 'é opcional: sem ele o papel é lido pelo motor de visão da casa' },
};

/* ---------- a acção concreta de cada tabela em falta ----------
   Cada tabela vem de UM ficheiro do repositório (ver `api/_esquema.mjs`). Dizer
   qual é poupa a quem tem de correr o SQL de o aplicar às cegas. */
const TABELA_FICHEIRO = {
  orbita_leads: 'orbita_mesa.sql',
  orbita_messages: 'orbita_mesa.sql',
  orbita_tasks: 'orbita_mesa.sql',
  orbita_projects: 'orbita_mesa.sql',
  orbita_atividade: 'orbita_mesa.sql',
  orbita_receitas: 'orbita_mesa.sql',
  orbita_contas: 'orbita_1_54_0.sql',
  orbita_sessoes: 'orbita_1_54_0.sql',
  orbita_geracoes: 'orbita_1_54_3.sql',
  orbita_ai_uso: 'orbita_1_55_0.sql',
  orbita_faturas: 'orbita_1_56_0.sql',
  orbita_ai_runs: 'orbita_1_61_0.sql',
};

const TABELA_PORQUE = {
  orbita_leads: 'sem ela não há leads: a mesa guardava só neste browser',
  orbita_messages: 'sem ela não há mensagens nem respostas guardadas',
  orbita_tasks: 'sem ela não há tarefas nem fila de aprovação',
  orbita_projects: 'sem ela não há projetos nem entregas',
  orbita_atividade: 'sem ela não há registo do que os agentes fizeram',
  orbita_receitas: 'sem ela o saldo não tem entradas, só custos',
  orbita_contas: 'sem ela não há contas: a porta fica aberta ou fechada a todos',
  orbita_sessoes: 'sem ela não há sessões: cada leitura pedia a palavra-passe outra vez',
  orbita_geracoes: 'sem ela uma geração de imagem perde o vínculo e o custo',
  orbita_ai_uso: 'sem ela o custo de cada chamada não fica gravado',
  orbita_faturas: 'sem ela não se emite fatura nem nota de crédito',
  orbita_ai_runs: 'sem ela a execução não guarda autorizações nem cancelamentos',
};

/* 1.65.1 · a acção de uma migração deixou de ser «abre este endereço com o
   segredo lá dentro». Quem tem sessão aplica-o no cartão da própria página; o
   endereço antigo fica escrito como alternativa para quem ainda não tem conta —
   na nota, não como o que se lê primeiro. */
const urlSetup = (ficheiro) => (ficheiro
  ? `/api/setup?token=<SETUP_TOKEN>&so=${ficheiro}`
  : '/api/setup?token=<SETUP_TOKEN>');

const acaoDaTabela = (tabela) => {
  const ficheiro = TABELA_FICHEIRO[tabela];
  return {
    onde: 'Página do arranque, com sessão',
    texto: ficheiro
      ? `Aplicar o esquema (só ${ficheiro}, se for o caso)`
      : 'Aplicar o esquema (cria o que falta; não tens de escolher ficheiro)',
    nota: `o cartão lê primeiro e só aplica depois de confirmares. Sem conta ainda, o endereço antigo serve: ${urlSetup(ficheiro)}, com \`ler=1\` para não escrever nada`,
  };
};

const acaoDaVariavel = (variavel) => ACAO[variavel]
  || { onde: VERCEL, texto: `${variavel} na Vercel` };

/* a parte que se esquece, dita uma vez na vista em vez de repetida em cada peça */
export const NOTA_REDEPLOY = REDEPLOY;

/* ---------- peças ---------- */

const item = (o) => ({
  id: o.id,
  tipo: o.tipo,
  grupo: o.grupo,
  grupoNome: o.grupoNome,
  titulo: o.titulo,
  variavel: o.variavel || null,
  porque: o.porque || '',
  como: o.como || null,
  critico: !!o.critico,
  estado: o.estado || 'falta',
  opcional: !!o.opcional,
});

/**
 * 1.66.1 · os nomes quase certos.
 *
 * Um `ORBITA_APITOKEN` na Vercel é indistinguível, para a app, de uma variável
 * que não existe — e a lista ficava a dizer «Acesso por configurar» para sempre,
 * sem pista nenhuma. O `/api/health` passou a devolver esses nomes em
 * `acesso.nomesErrados`; aqui viram uma peça que diz qual é o nome certo.
 */
export function itensDeNomesErrados(health) {
  const achados = Array.isArray(health?.acesso?.nomesErrados) ? health.acesso.nomesErrados : [];
  return achados.filter((x) => x && x.encontrado && x.devia).map((x) => item({
    id: `nome:${x.encontrado}`,
    tipo: 'variavel',
    grupo: 'acesso',
    grupoNome: 'Acesso',
    titulo: `O nome «${x.encontrado}» não é o que a app lê`,
    variavel: x.devia,
    porque: `uma variável com outro nome é como se não existisse: a app lê «${x.devia}» e o valor que lá está nunca chega a ser usado`,
    critico: true,
    como: {
      onde: VERCEL,
      texto: `renomeia ${x.encontrado} → ${x.devia} (apagar e criar com o nome certo também serve)`,
      nota: REDEPLOY,
    },
    estado: 'falta',
  }));
}

/** As tabelas que a base não tem, uma peça por tabela. */
export function itensDeTabelas(faltam = []) {
  const lista = Array.isArray(faltam) ? faltam : [];
  return lista.map((t) => item({
    id: `tabela:${t}`,
    tipo: 'tabela',
    grupo: 'esquema',
    grupoNome: 'Esquema da base',
    titulo: `Falta a tabela ${t}`,
    porque: TABELA_PORQUE[t] || 'uma tabela da mesa não existe nesta base',
    como: acaoDaTabela(String(t)),
    critico: true,
    estado: 'falta',
  }));
}

/** A lista completa (variáveis), quando há sessão para a ler. */
export function itensDeProntidao(prontidao) {
  const grupos = Array.isArray(prontidao?.grupos) ? prontidao.grupos : [];
  const out = [];
  for (const g of grupos) {
    for (const i of g.itens || []) {
      const variavel = i.variavel || '';
      /* um item do catálogo (o motor de visão) não é uma variável: diz-se o que
         é, não se finge que há uma chave para colar */
      const deCatalogo = /catálogo|ou uma chave/.test(variavel);
      out.push(item({
        id: `var:${grupoId(g)}:${variavel || i.nome}`,
        tipo: 'variavel',
        grupo: grupoId(g),
        grupoNome: g.nome,
        titulo: i.nome,
        variavel: variavel || null,
        porque: i.porque || g.porque || '',
        como: i.pronto || deCatalogo ? null : acaoDaVariavel(variavel),
        critico: !!g.critico && !i.opcional,
        opcional: !!i.opcional,
        estado: i.pronto ? 'pronto' : 'falta',
      }));
    }
  }
  return out;
}

const grupoId = (g) => String(g.id || g.nome || '').toLowerCase();

/* ---------- 1.64.0 · a acção de um GRUPO ----------
   Antes de haver sessão só se conhecem os grupos (o `/api/health` não dá nomes de
   variáveis). Isso deixava o cartão da primeira conta a dizer «o que falta» sem
   dizer «o que fazer». Aqui está o que se faz — pelos mesmos nomes que o servidor
   usa em `api/_prontidao.mjs`, e com um teste que falha se um grupo inventado
   aparecer nesta tabela. */
const ACAO_DO_GRUPO = {
  'base de dados': {
    onde: VERCEL,
    texto: 'SUPABASE_URL e SUPABASE_SECRET_KEY (Supabase → Project Settings → API)',
    nota: 'sem elas a mesa guarda só neste browser',
  },
  'acesso': {
    onde: VERCEL,
    texto: 'ORBITA_API_TOKEN (32+ caracteres) e ORBITA_ADMIN_TOKEN (16+)',
    nota: 'é o caminho das máquinas para a API; a mesa e o `/api/*` já são fechados pela porta (contas e sessões)',
  },
  'esquema da base': {
    onde: 'Página do arranque, com sessão',
    texto: 'SETUP_TOKEN → «Ver o que falta na base» → «Aplicar o esquema»',
    nota: 'a página aplica o SQL por ti; o token vai no corpo do pedido, não no endereço',
  },
  'pesquisa': {
    onde: 'app.tavily.com e myprojects.geoapify.com',
    texto: 'TAVILY_API_KEY e GEOAPIFY_API_KEY na Vercel',
    nota: 'sem elas não há prospeção: nem pesquisa web, nem empresas reais',
  },
  'correio': {
    onde: 'resend.com',
    texto: 'RESEND_API_KEY, ORBITA_FROM_EMAIL e RESEND_WEBHOOK_SECRET na Vercel',
    nota: 'sem elas as mensagens ficam à espera e nunca saem',
  },
  'whatsapp': {
    onde: 'Meta for Developers → WhatsApp',
    texto: 'WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN',
    nota: 'sem elas o WhatsApp abre na app e confirma-se à mão',
  },
  'motor de ia': {
    onde: 'pollinations.ai ou o fornecedor que escolheres',
    texto: 'POLLINATIONS_API_KEY (opcional) ou uma chave de IA',
    nota: 'sem chave nenhuma o escritório arranca na cadeia gratuita',
  },
  'digitalizar papel': {
    onde: 'nada a fazer, na maioria dos casos',
    texto: 'ORBITA_OCR_URL (opcional) — sem ela lê o motor de visão da casa',
  },
};

/** O resumo curto que vem no `/api/health` (nomes de grupo, sem variáveis). */
export function itensDoResumo(prontidaoCurta) {
  const nomes = [
    ...(prontidaoCurta?.criticasEmFalta || []).map((n) => ({ n, critico: true })),
    ...(prontidaoCurta?.essenciaisEmFalta || []).map((n) => ({ n, critico: false })),
  ];
  return nomes.map(({ n, critico }) => item({
    id: `grupo:${String(n).toLowerCase()}`,
    tipo: 'grupo',
    grupo: String(n).toLowerCase(),
    grupoNome: n,
    titulo: `${n} por configurar`,
    porque: critico
      ? 'é um grupo crítico: sem ele não se lança'
      : 'é essencial: sem ele uma função fica desligada',
    /* 1.64.0 · sem sessão não se sabem os nomes das variáveis, mas sabe-se o que
       fazer: um grupo sem acção era meia resposta */
    como: ACAO_DO_GRUPO[String(n).toLowerCase()] || null,
    critico,
    estado: 'falta',
  }));
}

/**
 * A lista junta, pela ordem em que se resolve.
 * @param {{health?:object|null, prontidao?:object|null}} fontes
 *   `health` é o corpo do `/api/health` (ou null quando não houve leitura);
 *   `prontidao` é o corpo do `/sistema/prontidao` (só com sessão).
 * @returns {{leitura:string, versao:string, base:string, itens:Array, notas:Array}}
 */
export function checklist({ health = null, prontidao = null } = {}) {
  const notas = [];
  if (!health) {
    return {
      leitura: 'sem-leitura', fonte: 'nenhuma', versao: '', base: '', itens: [],
      notas: ['Não houve resposta do `/api/health` — sem essa leitura não sei dizer o que falta.'],
    };
  }
  const leitura = health.modo === 'local' || health.error === 'sem chaves' ? 'local' : 'base';
  /* 1.63.1 · Uma resposta com outra forma NÃO é um retrato. O servidor local
     (`npm start`) responde `{ok:true, version, backend,…}` — sem `modo`, sem
     `faltam`, sem `prontidao`. Ler isso como «está tudo bem» era exactamente a
     mentira que esta versão existe para não dizer. */
  const temRetrato = health.modo === 'base' || health.modo === 'local' || Array.isArray(health.faltam) || !!health.prontidao;
  if (!temRetrato) {
    return {
      leitura: 'parcial', fonte: 'nenhuma', versao: String(health.version || health.versao || ''), base: '', itens: [],
      notas: ['O `/api/health` respondeu, mas sem o retrato do esquema (não trouxe `modo`, `faltam` nem `prontidao`) — não sei dizer o que falta.'],
    };
  }
  let itens = [];

  /* a base não está ligada: não há tabelas para contar, e diz-se isso */
  if (leitura === 'local') {
    notas.push('Sem `SUPABASE_URL` e `SUPABASE_SECRET_KEY` a mesa guarda só neste browser: os leads e as mensagens desaparecem ao fechar o separador.');
  } else {
    itens = itensDeTabelas(health.faltam);
  }

  /* a lista completa manda; o resumo curto só serve quando ela não veio */
  const completa = Array.isArray(prontidao?.grupos) && prontidao.grupos.length
    ? itensDeProntidao(prontidao)
    : itensDoResumo(health.prontidao);
  itens = [...itens, ...completa];
  /* 1.66.1 · antes de «falta a variável», verificar se ela está lá com o nome
     trocado: a peça do nome errado poupa a procura toda */
  const nomesErrados = itensDeNomesErrados(health);
  if (nomesErrados.length) {
    /* o mesmo nome certo não aparece duas vezes na lista (a peça do grupo já lá
       está): manda a do nome errado, que diz o que corrigir */
    const certos = new Set(nomesErrados.map((i) => i.variavel));
    itens = itens.filter((i) => !(i.tipo === 'variavel' && i.estado !== 'pronto' && certos.has(i.variavel)));
    itens = [...itens, ...nomesErrados];
    notas.push('Há variáveis com o nome quase certo na Vercel: o valor existe, o nome não. A peça de cada uma diz o nome que a app lê.');
  }

  /* A ordem é a ordem em que se resolve: primeiro o que falta, depois o que já
     está; dentro do que falta, o crítico antes do essencial e o opcional no fim;
     e dentro do mesmo peso, a tabela (que é um ficheiro a aplicar) antes da
     variável (que é um campo a preencher) e antes do grupo sem nome próprio. */
  const ORDEM_TIPO = { tabela: 0, variavel: 1, grupo: 2 };
  const peso = (i) => (i.estado === 'pronto' ? 10 : 0) + (i.critico ? 0 : i.opcional ? 4 : 2);
  itens.sort((a, b) => peso(a) - peso(b)
    || (ORDEM_TIPO[a.tipo] ?? 9) - (ORDEM_TIPO[b.tipo] ?? 9)
    || a.id.localeCompare(b.id));

  /* Uma instalação com a base a responder e o esquema completo não tem peças
     em falta — e isso TEM de se poder dizer. Sem esta peça, a lista vazia
     confundia-se com «não sei» (e as duas coisas são o contrário uma da outra). */
  const semFalta = leitura === 'base' && health.ok === true
    && health.modo === 'base'
    && Array.isArray(health.faltam) && health.faltam.length === 0
    && !itens.some((i) => i.estado !== 'pronto');
  if (semFalta) {
    itens.push(item({
      id: 'leitura:base',
      tipo: 'grupo',
      grupo: 'base',
      grupoNome: 'Base de dados',
      titulo: 'A base respondeu e o esquema está completo',
      porque: 'é o que o `/api/health` respondeu nesta leitura',
      critico: false,
      estado: 'pronto',
    }));
  }

  return {
    leitura,
    fonte: Array.isArray(prontidao?.grupos) && prontidao.grupos.length ? 'completa' : 'curta',
    versao: String(health.versao || ''),
    base: String(health.base || ''),
    itens,
    notas,
  };
}

/** O retrato: quantas peças, quantas em falta, e se se pode dizer «pronto». */
export function resumo(lista) {
  const itens = Array.isArray(lista?.itens) ? lista.itens : (Array.isArray(lista) ? lista : []);
  const leitura = lista?.leitura || (itens.length ? 'base' : 'sem-leitura');
  const emFalta = itens.filter((i) => i.estado !== 'pronto');
  const criticos = emFalta.filter((i) => i.critico && !i.opcional);
  const essenciais = emFalta.filter((i) => !i.critico && !i.opcional);
  const pronto = leitura === 'base' && itens.length > 0 && emFalta.filter((i) => !i.opcional).length === 0;
  return {
    leitura,
    total: itens.length,
    prontos: itens.length - emFalta.length,
    emFalta: emFalta.length,
    criticosEmFalta: criticos.length,
    essenciaisEmFalta: essenciais.length,
    pronto,
    frase: fraseDoResumo({ leitura, itens, emFalta, criticos, essenciais, pronto }),
  };
}

function fraseDoResumo({ leitura, itens, emFalta, criticos, essenciais, pronto }) {
  if (leitura === 'sem-leitura') return 'Não consegui ler a saúde desta instalação: não sei dizer o que falta.';
  if (leitura === 'parcial') return 'O servidor respondeu, mas não com o retrato do esquema — não sei dizer o que falta.';
  if (leitura === 'local') return 'A base não está ligada — o resto do arranque não se pode avaliar até isto.';
  if (!itens.length) return 'A instalação não deu nenhuma peça para avaliar: não é a mesma coisa que estar pronta.';
  if (pronto) return 'Está tudo no sítio: nenhuma peça obrigatória em falta.';
  const partes = [];
  if (criticos.length) partes.push(criticos.length === 1 ? '1 peça crítica em falta' : `${criticos.length} peças críticas em falta`);
  if (essenciais.length) partes.push(`${essenciais.length} função${essenciais.length === 1 ? '' : 's'} a funcionar em modo reduzido`);
  const primeira = emFalta.find((i) => i.critico) || emFalta[0];
  return `${partes.join(' · ')}. A começar por: ${primeira.titulo}.`;
}

/** A peça que se resolve a seguir — a crítica, e entre elas a primeira da lista. */
export function passoASeguir(lista) {
  const itens = Array.isArray(lista?.itens) ? lista.itens : (Array.isArray(lista) ? lista : []);
  const falta = itens.filter((i) => i.estado !== 'pronto');
  /* primeiro uma peça que já se sabe COMO resolver (tem acção); um grupo sem
     nome de variável (o resumo curto do health) só serve quando não há melhor */
  return falta.find((i) => i.critico && !i.opcional && i.como)
    || falta.find((i) => i.critico && !i.opcional)
    || falta.find((i) => !i.opcional && i.como)
    || falta.find((i) => !i.opcional)
    || falta[0]
    || null;
}

/** O que mudou entre duas leituras. Sem invenções: o que não está nas duas é «novo». */
export function comparar(antes, depois) {
  const velhos = new Map((antes?.itens || []).map((i) => [i.id, i]));
  const novos = new Map((depois?.itens || []).map((i) => [i.id, i]));
  const resolvidos = [];
  const novos_ = [];
  const iguais = [];
  const desaparecidos = [];
  /* Uma TABELA que deixou de aparecer está resolvida: o `faltam` do `/api/health`
     é uma lista explícita, e uma tabela que já lá está sai dela. Uma VARIÁVEL
     que deixou de aparecer não prova nada (pode ter mudado de nome, ou a lista
     ter mudado de forma) — vai para `desaparecidos`, e a frase diz isso em vez
     de apontar progresso que não houve. */
  if (antes && depois && antes.fonte && depois.fonte && antes.fonte === depois.fonte) {
    for (const [id, i] of velhos) {
      if (novos.has(id) || i.estado === 'pronto') continue;
      /* o item sintético da base sã não é uma peça resolvida: é a própria declaração */
      if (id === 'leitura:base') continue;
      if (i.tipo === 'tabela') resolvidos.push({ ...i, estado: 'pronto' });
      else desaparecidos.push(i);
    }
  }
  for (const [id, i] of novos) {
    const v = velhos.get(id);
    if (!v) { novos_.push(i); continue; }
    if (v.estado !== 'pronto' && i.estado === 'pronto') resolvidos.push(i);
    else if (i.estado !== 'pronto') iguais.push(i);
  }
  const mudou = resolvidos.length > 0 || novos_.length > 0
    || (antes?.leitura !== depois?.leitura)
    || (antes?.versao !== depois?.versao);
  return { mudou, resolvidos, novos: novos_, iguais, desaparecidos };
}

/** A frase da verificação — o que mudou, ou «nada mudou» (que também é resposta). */
export function fraseDaVerificacao(antes, depois) {
  if (!antes) return 'Primeira leitura desta instalação.';
  const c = comparar(antes, depois);
  const nomes = (xs) => xs.map((i) => i.titulo).slice(0, 3).join(', ');
  if (c.resolvidos.length) {
    return `Resolvido: ${nomes(c.resolvidos)}${c.resolvidos.length > 3 ? ` e mais ${c.resolvidos.length - 3}` : ''}.`;
  }
  if (c.desaparecidos.length) {
    return `Deixou de aparecer: ${nomes(c.desaparecidos)} — pode ter mudado de nome ou ter saído da lista; esta leitura não prova que ficou resolvido.`;
  }
  if (antes.versao !== depois?.versao && depois?.versao) {
    return `A versão mudou de ${antes.versao || '?'} para ${depois.versao} — mas nada do que faltava ficou resolvido.`;
  }
  return 'Nada mudou desde a última leitura. Se acabaste de pôr uma variável na Vercel, falta o Redeploy: as variáveis só entram no código que arranca depois.';
}

/** Tudo o que a vista precisa de escrever sobre uma peça, numa frase. */
export function linhaDaPeca(i) {
  const acao = i?.como ? `${i.como.onde}: ${i.como.texto}` : '';
  return [i?.titulo, i?.porque, acao].filter(Boolean).join(' · ');
}

/* ===========================================================================
   1.64.0 · APLICAR O ESQUEMA A PARTIR DA APP

   A lista do arranque dizia «falta a tabela orbita_faturas → abre este endereço
   com o token». Isso é melhor do que nada, mas continua a pedir à pessoa que
   construa um URL com um segredo dentro. A página passou a ter uma caixa onde se
   cola o `SETUP_TOKEN` e dois botões: **ver o que falta** (auditoria, não escreve
   nada) e **aplicar** (com confirmação). Estas duas funções são a leitura dessas
   duas respostas — puras, para se poderem provar sem base nenhuma.
   =========================================================================== */

/** A resposta do `/api/setup?ler=1` (ou do `POST {ler:true}`), escrita para gente. */
export function auditoriaLegivel(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    return {
      estado: 'sem-resposta', ok: false, frase: 'Não houve resposta da auditoria — não sei o que falta na base.',
      faltamTabelas: [], faltamColunas: {}, tabelas: [], colunasEmFalta: 0,
    };
  }
  const faltamTabelas = Array.isArray(a.faltamTabelas) ? a.faltamTabelas.map(String) : [];
  const faltamColunas = (a.faltamColunas && typeof a.faltamColunas === 'object' && !Array.isArray(a.faltamColunas))
    ? a.faltamColunas : {};
  const colunasEmFalta = Object.values(faltamColunas)
    .reduce((n, lista) => n + (Array.isArray(lista) ? lista.length : 0), 0);
  const tabelas = Array.isArray(a.tabelas) ? a.tabelas.map(String) : [];
  const lista = (xs) => xs.slice(0, 4).join(', ') + (xs.length > 4 ? ` e mais ${xs.length - 4}` : '');
  const colunas = Object.entries(faltamColunas)
    .map(([t, cs]) => `${t}: ${(Array.isArray(cs) ? cs : []).join(', ')}`);

  if (faltamTabelas.length) {
    return {
      estado: 'faltam-tabelas', ok: false, faltamTabelas, faltamColunas, tabelas, colunasEmFalta,
      frase: `Faltam ${faltamTabelas.length} tabela${faltamTabelas.length === 1 ? '' : 's'} da mesa (${lista(faltamTabelas)}). Aplicar o esquema cria-as; o que já existe não é apagado.`,
    };
  }
  if (colunasEmFalta) {
    return {
      estado: 'faltam-colunas', ok: false, faltamTabelas, faltamColunas, tabelas, colunasEmFalta,
      frase: `As tabelas existem, mas faltam ${colunasEmFalta} coluna${colunasEmFalta === 1 ? '' : 's'} que o código usa — ${lista(colunas)}.`,
    };
  }
  /* só se pode dizer «pronta» quando a resposta DIZ que as tabelas foram lidas:
     um `{}` não é uma base sã, é uma resposta que não olhou para nada */
  if (Array.isArray(a.tabelas)) {
    return {
      estado: 'pronta', ok: true, faltamTabelas, faltamColunas, tabelas, colunasEmFalta,
      frase: `A base tem as ${tabelas.length} tabelas que a mesa usa e as colunas exigidas. Não há nada a aplicar.`,
    };
  }
  return {
    estado: 'sem-resposta', ok: false, faltamTabelas, faltamColunas, tabelas, colunasEmFalta,
    frase: 'A auditoria respondeu, mas sem a lista de tabelas — não sei dizer se a base serve.',
  };
}

/** A resposta de aplicar o esquema, escrita para gente. */
export function resultadoDaAplicacao(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return { estado: 'sem-resposta', ok: false, frase: 'Não houve resposta ao aplicar — não sei se ficou aplicado.', aplicados: [], faltam: [] };
  }
  const aplicados = Array.isArray(r.aplicados) ? r.aplicados.map(String) : [];
  const faltam = Array.isArray(r.faltam) ? r.faltam.map(String) : [];
  if (r.ok === true) {
    return {
      estado: 'aplicado', ok: true, aplicados, faltam,
      frase: faltam.length
        ? `Aplicado ${aplicados.join(', ') || 'o esquema'}, mas ainda faltam ${faltam.length} tabela(s): ${faltam.join(', ')}.`
        : `Aplicado ${aplicados.length ? `${aplicados.length} ficheiro${aplicados.length === 1 ? '' : 's'} (${aplicados.join(', ')})` : 'o esquema'} — a base ficou com todas as tabelas da mesa.`,
    };
  }
  const erro = String(r.erro || r.error || '').trim();
  return {
    estado: 'parou', ok: false, aplicados, faltam,
    frase: erro
      ? `Parou${aplicados.length ? ` depois de ${aplicados.join(', ')}` : ''}: ${erro}. Cada ficheiro corre numa transacção — o que passou ficou aplicado, o resto não.`
      : 'A resposta diz que não ficou aplicado, mas não diz porquê — não sei se a base ficou a meio.',
  };
}

/** O erro de um pedido ao `/api/setup` (404 = token errado, 500 = a base). */
export function erroDoSetup(estado, corpo) {
  const j = corpo && typeof corpo === 'object' ? corpo : {};
  const frase = String(j.erro || j.error || '').trim();
  if (estado === 404) {
    /* o `/api/setup` responde 404 «não existe» quando o token não serve — mas uma
       instalação servida sem `/api` também dá 404, com outra frase. Não se
       confunde uma coisa com a outra: quem lê merece saber qual é. */
    return /não existe/i.test(frase)
      ? 'O token não é o desta instalação (ou o `SETUP_TOKEN` não está definido na Vercel).'
      : 'Esta instalação não tem o `/api/setup` a responder (servida sem `/api`?): o esquema aplica-se pelo servidor local ou pelo endereço antigo com o token.';
  }
  if (estado === 405) return 'Esta versão do `/api/setup` só aceita GET ou POST.';
  if (estado === 413) return 'O pedido era grande demais.';
  if (frase) return frase;
  return `O \`/api/setup\` respondeu ${estado || '?'} sem dizer porquê.`;
}

export const ESTADOS = ['pronto', 'falta'];

/* Exportados para o teste poder confrontá-los com a verdade do servidor
   (`api/_prontidao.mjs` e `api/_esquema.mjs`): uma variável que aqui não exista
   não pode aparecer numa acção, e uma tabela do esquema tem de ter ficheiro. */
export const VARIAVEIS_CONHECIDAS = Object.keys(ACAO);
export const ACOES_DOS_GRUPOS = Object.keys(ACAO_DO_GRUPO);
export const TABELAS_COM_FICHEIRO = Object.keys(TABELA_FICHEIRO);

