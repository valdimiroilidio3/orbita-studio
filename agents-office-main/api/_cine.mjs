/* ===========================================================================
   1.48.0 · O CINE — um lead, um projecto criativo (28 out 2026)

   Pedido do dono: cada lead deve abrir um Master Prompt próprio, com direcção de
   arte, e a partir dele nascerem imagens (e vídeo, quando houver como), tudo
   guardado no projecto daquele lead.

   O que este módulo É:
     · a LEITURA do lead — o que se sabe, o que falta, e o que isso impede;
     · o MASTER PROMPT — primeiro pedido ao motor de IA (JSON validado), e só se
       ele não servir é que se monta por regras, dizendo que foi por regras;
     · a GERAÇÃO — um pedido HTTP verdadeiro ao Pollinations, com os bytes de
       volta conferidos (tipo e tamanho). Não há imagem de exemplo, nem
       marcador de posição a fazer de resultado;
     · o ARQUIVO — prompt, versões, imagens aprovadas e histórico, na base.

   O que este módulo NÃO faz, e diz porquê:
     · vídeo. Os modelos de vídeo do Pollinations são todos `paid_only` — precisam
       de créditos Pollen comprados. O outro caminho é o worker do OpenMontage,
       que precisa de uma máquina com Python e FFmpeg. Nenhum dos dois existe
       hoje neste ambiente; `gerarVideo` devolve a razão em vez de um ficheiro
       inventado. Se um deles passar a existir, a mesma chamada passa a produzir.

   Regras que valem a pena escrever:
     · nenhuma chave sai daqui para o browser — a imagem viaja em `data:` gerado
       no servidor;
     · o prompt nunca inventa factos sobre o lead (prémios, números, história):
       só usa os campos que existem e o universo visual do nicho;
     · uma falha do fornecedor chega à mesa com o código HTTP e a frase dele.
   =========================================================================== */
import { FORNECEDORES } from './_ia/catalogo.mjs';

/* ---------------------------------------------------------------------------
   1 · O QUE EXISTE PARA GERAR

   Esta lista foi lida do próprio fornecedor a 28 out 2026
   (`GET https://gen.pollinations.ai/image/models`) e só inclui modelos com
   `paid_only: false`. Os pagos ficam de fora de propósito: prometer um modelo
   que responde «sem créditos» é a mesma mentira de sempre.
   --------------------------------------------------------------------------- */
export const MODELOS_IMAGEM = [
  {
    id: 'tongyi-mai/z-image-turbo', rotulo: 'Z-Image Turbo', pago: false,
    nota: 'o mais rápido e barato: serve para explorar direcções antes de gastar tempo',
    bom: ['prova', 'carrossel', 'ideia'],
  },
  {
    id: 'black-forest-labs/flux.1.1-pro', rotulo: 'FLUX 1.1 Pro', pago: false,
    nota: 'fotografia de produto e retrato com grão fino; o melhor para peça final',
    bom: ['produto', 'retrato', 'campanha'],
  },
  {
    id: 'microsoft/mai-image-2.6', rotulo: 'MAI Image 2.6', pago: false,
    nota: 'hiper-realismo com boa leitura de instruções longas e texto na imagem',
    bom: ['campanha', 'editorial', 'interior'],
  },
  {
    id: 'microsoft/mai-image-2.6-flash', rotulo: 'MAI Image 2.6 Flash', pago: false,
    nota: 'a mesma família, mais depressa; bom para várias variações seguidas',
    bom: ['variacoes', 'prova'],
  },
];

/* Todos pagos (`paid_only: true`), e é isso que se diz à mesa. */
export const MODELOS_VIDEO = [
  { id: 'alibaba/wan-3.0', rotulo: 'Wan 3.0', nota: '5 s, 480p–1080p, com som opcional' },
  { id: 'kwaivgi/kling-v3.0-std', rotulo: 'Kling 3.0', nota: '3–15 s, 720p, cinematográfico' },
  { id: 'bytedance/seedance-2.0-fast', rotulo: 'Seedance 2.0 Fast', nota: '4–5 s, som sincronizado' },
  { id: 'minimax/minimax-h3-max', rotulo: 'MiniMax H3 Max', nota: '5–15 s, 480p–1080p, áudio' },
];

export const FORMATOS = [
  { id: '1:1', rotulo: 'Quadrado', largura: 1024, altura: 1024, uso: 'feed, catálogo, perfil' },
  { id: '4:5', rotulo: 'Retrato de feed', largura: 896, altura: 1120, uso: 'Instagram, Facebook' },
  { id: '16:9', rotulo: 'Cinema', largura: 1344, altura: 768, uso: 'site, YouTube, capa, apresentação' },
  { id: '9:16', rotulo: 'Vertical', largura: 768, altura: 1344, uso: 'reels, stories, TikTok' },
  { id: '3:2', rotulo: 'Editorial', largura: 1200, altura: 800, uso: 'imprensa, portefólio, folheto' },
];

/**
 * Seis direcções de arte. Cada uma é um mundo visual completo — paleta, luz,
 * lente, movimento — e não um adjectivo. `hash` do lead escolhe a de partida,
 * para dois leads seguidos não saírem iguais sem o dono pedir.
 */
export const ESTILOS = [
  {
    id: 'editorial', nome: 'Editorial premium',
    nota: 'revista de arquitectura: luz suave, espaço, nada a mais',
    paleta: ['#F2EFE9 osso', '#C8B49A areia', '#3A3A38 grafite', '#7C5B45 carvalho'],
    luz: 'luz de janela grande, difusa, sem sombra dura; um apontamento de contraluz',
    lente: '50 mm, f/2.8, profundidade curta mas honesta',
    movimento: 'travelling lateral lento, câmara à altura do olhar',
  },
  {
    id: 'noir', nome: 'Noir cinematográfico',
    nota: 'contraste alto, sombras longas, uma única fonte de luz',
    paleta: ['#0E1116 tinta', '#1F2933 azul-noite', '#D9C7A3 latão', '#F5F1E8 papel'],
    luz: 'uma fonte dura lateral a 45°, fumo fino no ar, negros profundos',
    lente: '35 mm, f/1.8, anamórfico, reflexos controlados',
    movimento: 'aproximação lenta em steadicam, respiração curta',
  },
  {
    id: 'documental', nome: 'Documental',
    nota: 'verdade à frente do brilho: pessoas a trabalhar, mãos, ferramentas',
    paleta: ['#EAE6DD cal', '#8A9A5B oliva', '#4B4237 terra', '#B4552D telha'],
    luz: 'luz natural de fim de tarde, sombras reais, poeira no ar',
    lente: '28 mm, f/4, tudo legível',
    movimento: 'câmara ao ombro, pequenas correcções, foco a seguir as mãos',
  },
  {
    id: 'estudio', nome: 'Estúdio minimal',
    nota: 'fundo infinito, um objecto, uma sombra — produto como escultura',
    paleta: ['#FFFFFF branco', '#EDEDF0 névoa', '#111114 grafite', '#2B3BF2 azul órbita'],
    luz: 'softbox grande a 45° e um rebordo frio por trás',
    lente: '85 mm macro, f/8, foco empilhado',
    movimento: 'órbita de 15° em torno do objecto, sempre sem cortar a sombra',
  },
  {
    id: 'noturno', nome: 'Cidade à noite',
    nota: 'néons, chuva fina, asfalto a brilhar — energia urbana',
    paleta: ['#0B1020 meia-noite', '#2A6FDB azul néon', '#E4572E âmbar', '#F2E9E4 vapor'],
    luz: 'prática de rua (montras e faróis), contraluz húmido, reflexos no chão',
    lente: '24 mm, f/2, estrelas nos pontos de luz',
    movimento: 'travelling baixo paralelo ao chão, 24 fps com arrasto leve',
  },
  {
    id: 'luznatural', nome: 'Claridade nórdica',
    nota: 'quase branco, texturas naturais, calma de manhã cedo',
    paleta: ['#F7F6F2 linho', '#D6D2C4 pedra', '#9FB3A8 eucalipto', '#2F3437 carvão'],
    luz: 'céu encoberto como softbox gigante, sombras quase ausentes',
    lente: '65 mm, f/2.8, cores dessaturadas',
    movimento: 'plano fixo com respiração, corte seco entre planos',
  },
];

/** Universo visual por sector: o que existe NAQUELE negócio (nada de inventar). */
const SETORES = [
  {
    id: 'saude', teste: /cl[ií]nica|dent|m[eé]dic|sa[uú]de|fisio|farm[aá]c|optometr|veterin|psic/i,
    universo: 'material clínico limpo, superfícies laváveis, plantas verdes discretas',
    gestos: 'mãos com luvas a preparar instrumentos, um sorriso genuíno a receber',
    texturas: 'aço escovado, vidro, linho lavado',
  },
  {
    id: 'restauracao', teste: /restaurante|caf[eé]|padaria|pastelaria|bar\b|pizz|cantina|cozinha|gelat|tasca/i,
    universo: 'matéria-prima fresca, louça simples, madeira gasta pelo uso',
    gestos: 'mãos a empratar, vapor a subir, café a cair na chávena',
    texturas: 'grão de madeira, cerâmica, farinha no mármore',
  },
  {
    id: 'beleza', teste: /cabeleir|barbear|beleza|est[eé]tica|spa|nail|maquilh|depila/i,
    universo: 'espelhos, toalhas dobradas, ferramentas alinhadas como instrumentos',
    gestos: 'uma mecha a cair, um pincel a encostar, olhar ao espelho',
    texturas: 'cabelo com brilho, metal polido, água',
  },
  {
    id: 'imobiliario', teste: /imobili|media[cç][aã]o|arquitet|arquitect|constru|casa|apartament/i,
    universo: 'volumes, vãos de luz, materiais nobres ainda por estrear',
    gestos: 'uma porta que se abre, chaves na mão, passos num chão vazio',
    texturas: 'betão à vista, madeira clara, pedra natural',
  },
  {
    id: 'automovel', teste: /oficina|autom[oó]vel|pneu|garagem|carro|mec[aâ]nic|stand/i,
    universo: 'elevador, ferramenta arrumada, capô aberto, chão limpo de oficina',
    gestos: 'mãos com massa negra, diagnóstico no ecrã, aperto de chave',
    texturas: 'metal, borracha, óleo, luz fria de lâmpada industrial',
  },
  {
    id: 'servicos', teste: /advogad|contabil|consult|seguros|jur[ií]dic|escrit[oó]rio|financ/i,
    universo: 'mesa de trabalho, papelagens, vidro e madeira escura',
    gestos: 'assinatura, aperto de mão firme, documento a ser lido',
    texturas: 'papel algodão, couro, latão',
  },
  {
    id: 'desporto', teste: /gin[aá]sio|gin[aá]s|fitness|crossfit|padel|treino|desport|yoga|pilates/i,
    universo: 'piso de borracha, pesos alinhados, suor e luz lateral',
    gestos: 'última repetição, corda a bater no chão, respiração visível',
    texturas: 'borracha, aço, tecido técnico',
  },
  {
    id: 'comercio', teste: /loja|com[eé]rcio|boutique|mercearia|florista|livraria|papelaria|supermercado/i,
    universo: 'montra, prateleiras cheias, sacos de papel com o logótipo',
    gestos: 'mãos a embrulhar, um cliente a escolher, porta com sino',
    texturas: 'cartão, tecido, madeira encerada',
  },
  {
    id: 'hotelaria', teste: /hotel|alojament|turismo|quinta|casa de f[eé]rias|hostel|pousada/i,
    universo: 'lençóis brancos, pedra, vista de janela, pequeno-almoço posto',
    gestos: 'cortinas a abrir, chá a servir, chave sobre a mesa',
    texturas: 'linho, pedra, luz de manhã',
  },
  {
    id: 'tecnologia', teste: /software|ag[eê]ncia|digital|tecnolog|startup|marketing|design|web/i,
    universo: 'ecrãs, cabos organizados, superfícies mates, luz de estúdio',
    gestos: 'uma interface a acender, duas pessoas a discutir um esboço',
    texturas: 'alumínio, vidro fosco, papel de esboço',
  },
];

const SETOR_GENERICO = {
  id: 'generico', teste: /$^/,
  universo: 'ferramentas reais do ofício, arrumadas com cuidado, nada decorativo',
  gestos: 'alguém a trabalhar no que sabe fazer',
  texturas: 'materiais honestos: madeira, metal, tecido, pedra',
};

const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const limpo = (s) => String(s ?? '').trim();
const tem = (s) => limpo(s).length > 0;

/** Um número estável a partir de texto: a mesma lead dá sempre a mesma peça. */
export function hashDe(texto) {
  let h = 2166136261;
  const s = String(texto || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function setorDe(lead = {}) {
  const alvo = `${lead.category || ''} ${lead.name || ''} ${lead.notes || ''}`;
  return SETORES.find((s) => s.teste.test(alvo)) || SETOR_GENERICO;
}

/**
 * A LEITURA DE UMA LEAD — sem rede e sem IA.
 *
 * Devolve o que se sabe, o que falta e o que isso obriga a evitar. É a base do
 * prompt e é o que a mesa mostra antes de gerar: o dono vê o que o sistema viu.
 */
export function analisarLead(lead = {}) {
  const setor = setorDe(lead);
  const fortes = [];
  const faltam = [];
  if (tem(lead.name)) fortes.push('nome'); else faltam.push('nome');
  if (lead.category) fortes.push('nicho'); else faltam.push('nicho');
  if (lead.city) fortes.push('cidade'); else faltam.push('cidade');
  if (lead.website) fortes.push('site'); else faltam.push('site');
  if (lead.phone || lead.email) fortes.push('contacto'); else faltam.push('contacto');
  if (lead.rating) fortes.push('avaliação pública'); else faltam.push('avaliação');
  if (lead.notes) fortes.push('notas do dono');
  const avaliacao = Number(lead.rating) || 0;
  const opinioes = Number(lead.reviews) || 0;
  return {
    setor: setor.id,
    universo: setor.universo,
    gestos: setor.gestos,
    texturas: setor.texturas,
    fortes,
    faltam,
    /* nem tudo o que falta estraga a peça: só o que impediria a mensagem */
    impeditivo: faltam.includes('nome') ? 'sem nome não há peça' : null,
    sinais: {
      avaliacao: avaliacao || null,
      opinioes: opinioes || null,
      qualidade: avaliacao >= 4.5 ? 'excelente' : avaliacao >= 4 ? 'boa' : avaliacao > 0 ? 'a melhorar' : null,
      zona: tem(lead.city) ? `em ${limpo(lead.city)}` : 'sem cidade — a peça fica sem geografia',
      origem: limpo(lead.source) || null,
    },
    /* o que NÃO se pode afirmar por não estar nos dados */
    proibido: [
      'inventar prémios, certificações, anos de existência ou números de clientes',
      faltam.includes('avaliação') ? 'citar avaliações que não existem' : null,
      faltam.includes('site') ? 'descrever um site ou loja online que não está registado' : null,
      'escrever texto legível na imagem sem o dono o ter pedido',
    ].filter(Boolean),
  };
}

/** A brief que entra: o dono pode mudar tudo, e o que não disser tem omissão. */
export function briefNormalizada(brief = {}) {
  const formato = FORMATOS.find((f) => f.id === brief.formato) || FORMATOS[2];
  const estilo = ESTILOS.find((e) => e.id === brief.estilo) || null;
  return {
    objetivo: limpo(brief.objetivo).slice(0, 400) || 'dar a conhecer o negócio a quem ainda não o conhece',
    publico: limpo(brief.publico).slice(0, 200) || '',
    plataforma: limpo(brief.plataforma).slice(0, 120) || formato.uso,
    tom: limpo(brief.tom).slice(0, 120) || 'confiante, sem gritar',
    estilo: estilo ? estilo.id : null,
    formato: formato.id,
    largura: formato.largura,
    altura: formato.altura,
    quantidade: Math.max(1, Math.min(4, Number(brief.quantidade) || 1)),
  };
}

/**
 * O MASTER PROMPT POR REGRAS.
 *
 * Não é um plano B envergonhado: é determinístico, usa só o que se sabe da lead e
 * diz que foi assim feito. A IA, quando responde, melhora-o — não o substitui por
 * texto genérico.
 */
export function construirMasterPrompt(lead = {}, briefCru = {}) {
  const b = briefNormalizada(briefCru);
  const a = analisarLead(lead);
  const setor = SETORES.find((s) => s.id === a.setor) || SETOR_GENERICO;
  const h = hashDe(`${lead.id || lead.name}|${a.setor}|${b.objetivo}`);
  const estilo = ESTILOS.find((e) => e.id === b.estilo) || ESTILOS[h % ESTILOS.length];
  const cidade = limpo(lead.city);
  const nicho = limpo(lead.category) || setor.id;
  const nome = limpo(lead.name) || 'o negócio';
  const avaliacao = Number(lead.rating) || 0;
  const opinioes = Number(lead.reviews) || 0;
  const prova = avaliacao >= 4.5 && opinioes >= 10
    ? `A nota pública (${avaliacao.toFixed(1)} ★ em ${opinioes} opiniões) autoriza mostrar orgulho — mas na imagem, não em texto.`
    : 'Sem prova pública suficiente: nada de números, selos ou classificações na peça.';

  const conceito = `${nome}${cidade ? `, ${cidade}` : ''} — ${setor.universo}. A peça mostra o ofício a acontecer: ${setor.gestos}.`;
  const direcaoArte = [
    `Direcção: ${estilo.nome} — ${estilo.nota}.`,
    `Paleta: ${estilo.paleta.join(' · ')}.`,
    `Texturas do sector: ${setor.texturas}.`,
    'Composição assimétrica com um terço de respiro; o sujeito nunca centrado por acaso.',
  ].join(' ');
  const fotografia = {
    estilo: `${estilo.nome}, fotografia publicitária com grão fino e cor tratada`,
    lente: estilo.lente,
    luz: estilo.luz,
    profundidade: 'plano médio com fundo legível mas desfocado — o contexto importa',
  };
  const narrativa = `Começa no detalhe (${setor.texturas.split(',')[0]}), abre para o gesto (${setor.gestos.split(',')[0]}) e fecha no rosto ou no resultado do trabalho. ${b.tom}.`;
  const restricoes = [
    'nada de texto, logótipos ou marcas de água dentro da imagem',
    'nada de pessoas a olhar para a câmara em pose de banco de imagens',
    'nada de stock genérico: cada objecto tem de pertencer a este ofício',
    ...a.proibido,
  ];

  const promptImagem = [
    `Fotografia publicitária ${estilo.nome.toLowerCase()} para ${nome}${cidade ? `, ${cidade}` : ''} (${nicho}).`,
    `Cena: ${setor.gestos}.`,
    `Universo: ${setor.universo}.`,
    `Luz: ${estilo.luz}.`,
    `Câmara: ${estilo.lente}, ${fotografia.profundidade}.`,
    `Paleta: ${estilo.paleta.join(', ')}.`,
    `Composição: ${b.formato}, ${b.plataforma}.`,
    `Tom: ${b.tom}.`,
    'Sem texto na imagem, sem logótipos, sem marcas de água. Fotografia real, não ilustração.',
  ].join(' ');

  const promptVideo = [
    `Plano cinematográfico de 5 s para ${nome}${cidade ? `, ${cidade}` : ''} (${nicho}), formato ${b.formato}, ${b.plataforma}.`,
    `Movimento: ${estilo.movimento}.`,
    `Luz: ${estilo.luz}.`,
    `Cena: ${setor.gestos}.`,
    `Paleta: ${estilo.paleta.join(', ')}.`,
    'Ritmo contido, profundidade de campo curta, sem cortes dentro do plano, sem texto.',
  ].join(' ');

  return {
    ok: true,
    via: 'regra',
    motivo: null,
    estilo: estilo.id,
    estiloNome: estilo.nome,
    formato: b.formato,
    seccoes: {
      contexto: `${nome}${nicho ? ` — ${nicho}` : ''}${cidade ? `, ${cidade}` : ''}. ${
        tem(lead.website) ? `Tem site (${limpo(lead.website)}).` : 'Sem site registado.'} ${
        tem(lead.phone) || tem(lead.email) ? 'Há contacto directo.' : 'Sem contacto directo.'} ${prova}`,
      objetivo: b.objetivo,
      conceito,
      direcaoArte,
      fotografia,
      composicao: `${b.formato} (${b.largura}×${b.altura}) para ${b.plataforma}; sujeito em terço, respiro em cima.`,
      narrativa,
      emocao: `${b.tom}; a peça deve dar vontade de entrar, não de comprar já`,
      restricoes,
      evitar: ['estética de banco de imagens', 'saturação exagerada', 'HDR sujo', 'texto gerado pelo modelo'],
    },
    prompts: { imagem: promptImagem, video: promptVideo },
    analise: a,
  };
}

/* ---------------------------------------------------------------------------
   2 · O MASTER PROMPT PELA IA

   O motor escreve o que as regras não conseguem: conceito, narrativa e um
   prompt de imagem com intenção. Exige-se JSON com chaves fixas — o que não
   vier completo não é aceite, e a mesa fica com a versão por regras e o motivo
   escrito. Nunca se apresenta texto de regras como se fosse da IA.
   --------------------------------------------------------------------------- */
export const INSTRUCAO_CINE = [
  'És o director criativo de um estúdio de publicidade.',
  'Recebes a ficha de um negócio real e devolves um plano criativo para UMA peça visual.',
  'Responde APENAS com JSON válido, sem blocos de código e sem comentários, com estas chaves:',
  '{"conceito":"1 a 3 frases","direcaoArte":"3 a 5 frases com paleta e materiais","narrativa":"2 a 4 frases, do detalhe ao gesto",',
  '"emocao":"uma frase","promptImagem":"um parágrafo denso em inglês, sem texto na imagem","promptVideo":"um parágrafo curto em inglês com movimento de câmara","restricoes":["3 a 5 frases curtas"]}',
  'Regras: usa apenas factos da ficha; não inventes prémios, números, anos, certificados nem avaliações.',
  'Nada de texto dentro da imagem. Nada de estética de banco de imagens.',
].join('\n');

export function mensagensCine(lead = {}, brief = {}, analise = null) {
  const a = analise || analisarLead(lead);
  const ficha = {
    nome: limpo(lead.name),
    nicho: limpo(lead.category) || null,
    cidade: limpo(lead.city) || null,
    site: limpo(lead.website) || null,
    avaliacao: Number(lead.rating) || null,
    opinioes: Number(lead.reviews) || null,
    notas: limpo(lead.notes).slice(0, 400) || null,
    universoVisual: a.universo,
    gestosDoOficio: a.gestos,
    proibido: a.proibido,
  };
  return [{
    role: 'user',
    content: `${INSTRUCAO_CINE}\n\nFICHA DO NEGÓCIO:\n${JSON.stringify(ficha, null, 2)}\n\nPEDIDO DO DONO:\n${JSON.stringify(brief, null, 2)}`,
  }];
}

/** Tira cercas e apanha o primeiro objecto JSON de uma resposta. */
export function lerJSON(bruto) {
  const t = String(bruto || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  const inicio = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try { return JSON.parse(t.slice(inicio, fim + 1)); } catch { return null; }
}

const CHAVES_IA = ['conceito', 'direcaoArte', 'narrativa', 'emocao', 'promptImagem', 'promptVideo'];

/**
 * Pede o plano à IA e valida-o. Não lança: devolve `ok:false` com o motivo, e
 * quem chama decide o que mostrar (na mesa, a versão por regras + a razão).
 */
export async function masterPromptComIA({ lead = {}, brief = {}, motor = null, analise = null } = {}) {
  const base = construirMasterPrompt(lead, brief);
  if (!motor || typeof motor.pedir !== 'function') {
    return { ok: false, codigo: 'semmotor', motivo: 'não há motor de IA ligado neste pedido', base };
  }
  const t0 = Date.now();
  try {
    const r = await motor.pedir('texto', mensagensCine(lead, briefNormalizada(brief), analise), {
      maxTokens: 1400, temperatura: 0.7, agente: 'cine', limite: 3,
    });
    const ms = Date.now() - t0;
    const j = lerJSON(r?.texto);
    if (!j) return { ok: false, codigo: 'resposta-invalida', motivo: 'o modelo não devolveu JSON legível', ms, texto: String(r?.texto || '').slice(0, 300), base };
    const faltam = CHAVES_IA.filter((k) => !tem(j[k]));
    if (faltam.length) {
      return { ok: false, codigo: 'resposta-incompleta', motivo: `o modelo deixou de fora: ${faltam.join(', ')}`, ms, base };
    }
    return {
      ok: true,
      via: 'ia',
      ms,
      modelo: r?.modelo || null,
      fornec: r?.fornec || null,
      plano: {
        conceito: limpo(j.conceito),
        direcaoArte: limpo(j.direcaoArte),
        narrativa: limpo(j.narrativa),
        emocao: limpo(j.emocao),
        promptImagem: limpo(j.promptImagem),
        promptVideo: limpo(j.promptVideo),
        restricoes: Array.isArray(j.restricoes) ? j.restricoes.map(limpo).filter(Boolean).slice(0, 6) : [],
      },
      base,
    };
  } catch (e) {
    return {
      ok: false,
      codigo: e?.codigo === 'limite' ? 'limite-fornecedor' : 'falha',
      motivo: String(e?.message || e).slice(0, 300),
      ms: Date.now() - t0,
      base,
    };
  }
}

/**
 * Junta o que a IA disse ao esqueleto das regras: a IA manda no conceito, na
 * narrativa e nos prompt(s); as regras garantem os factos, o formato e as
 * restrições que não podem faltar.
 */
export function juntarPlano(base, ia = null) {
  if (!ia?.ok) return base;
  const p = ia.plano;
  return {
    ...base,
    via: 'ia',
    motivo: null,
    modelo: ia.modelo || null,
    fornec: ia.fornec || null,
    ms: ia.ms || null,
    seccoes: {
      ...base.seccoes,
      conceito: p.conceito,
      direcaoArte: p.direcaoArte,
      narrativa: p.narrativa,
      emocao: p.emocao,
      restricoes: [...new Set([...base.seccoes.restricoes, ...p.restricoes])].slice(0, 10),
    },
    prompts: {
      imagem: `${p.promptImagem} ${base.seccoes.fotografia.luz} ${base.seccoes.composicao} Sem texto na imagem.`,
      video: p.promptVideo,
    },
  };
}

/** O prompt que se leva à mesa, em texto corrido, para se poder copiar. */
export function masterEmTexto(mp = {}) {
  const s = mp.seccoes || {};
  const f = s.fotografia || {};
  return [
    `# Master Prompt — ${mp.leadNome || 'peça'}`,
    '',
    `Conceito: ${s.conceito || '—'}`,
    `Objectivo: ${s.objetivo || '—'}`,
    `Direcção de arte: ${s.direcaoArte || '—'}`,
    `Fotografia: ${f.estilo || '—'} · ${f.lente || '—'} · ${f.luz || '—'}`,
    `Composição: ${s.composicao || '—'}`,
    `Narrativa: ${s.narrativa || '—'}`,
    `Tom emocional: ${s.emocao || '—'}`,
    '',
    'Restrições:',
    ...(s.restricoes || []).map((r) => `· ${r}`),
    '',
    `Prompt de imagem: ${(mp.prompts || {}).imagem || '—'}`,
    `Prompt de vídeo: ${(mp.prompts || {}).video || '—'}`,
  ].join('\n');
}

/* ---------------------------------------------------------------------------
   3 · GERAR A IMAGEM — a sério

   Duas rotas, por esta ordem:
     A. `gen.pollinations.ai/image/…` com a chave do dono (`POLLINATIONS_API_KEY`
        ou `POLLINATIONS_TOKEN`) — é o tier com conta;
     B. `image.pollinations.ai/prompt/…` sem chave — o tier anónimo.

   Em ambas se conferem os bytes: `content-type` tem de ser imagem e o corpo tem
   de ter tamanho de imagem. Um HTML de erro com 200 não passa por imagem.
   --------------------------------------------------------------------------- */
const MAX_BYTES = 8 * 1024 * 1024;

export function urlDeImagem({ prompt, modelo = MODELOS_IMAGEM[0].id, largura = 1024, altura = 1024, seed = 0, chave = null }) {
  const enc = encodeURIComponent(String(prompt).slice(0, 1800));
  if (chave) {
    const q = `width=${largura}&height=${altura}&seed=${seed}&model=${encodeURIComponent(modelo)}&nologo=true`;
    return { url: `https://gen.pollinations.ai/image/${enc}?${q}`, cabecalhos: { Authorization: `Bearer ${chave}`, accept: 'image/*' }, via: 'chave', modeloTentado: modelo };
  }
  /* O tier anónimo (legado) não conhece os nomes novos: a lista dele responde
     `["sana"]`. Pede-se `flux`, que é o modelo livre do tier anónimo, e diz-se
     que foi assim — em vez de mandar um nome que ele vai recusar. */
  const q = `width=${largura}&height=${altura}&seed=${seed}&model=flux`;
  return { url: `https://image.pollinations.ai/prompt/${enc}?${q}`, cabecalhos: { accept: 'image/*' }, via: 'anonimo', modeloTentado: 'flux' };
}

const chavePollinations = (env = {}) => limpo(env.POLLINATIONS_API_KEY) || limpo(env.POLLINATIONS_TOKEN) || null;

/**
 * Gera uma imagem e devolve os bytes em `data:` (nunca a chave).
 * @returns {Promise<{ok:boolean, dataUrl?:string, mime?:string, bytes?:number, ms:number,
 *                    via?:string, modelo?:string, seed?:number, tentativas:Array,
 *                    codigo?:string|null, erro?:string|null}>}
 */
export async function gerarImagem({
  prompt, modelo = MODELOS_IMAGEM[0].id, largura = 1024, altura = 1024, seed = null,
  env = {}, fetchImpl = fetch, timeoutMs = 30000, orcamentoMs = 52000,
} = {}) {
  const t0 = Date.now();
  const p = limpo(prompt);
  if (p.length < 12) return { ok: false, codigo: 'parametros', erro: 'o prompt é curto demais: descreve a cena com pelo menos 12 caracteres', ms: 0, tentativas: [] };
  const semente = Number.isFinite(Number(seed)) ? Math.abs(Math.trunc(Number(seed))) : hashDe(p) % 1000000;
  const chave = chavePollinations(env);
  const tentativas = [];
  const rotas = [];
  if (chave) rotas.push(urlDeImagem({ prompt: p, modelo, largura, altura, seed: semente, chave }));
  rotas.push(urlDeImagem({ prompt: p, modelo, largura, altura, seed: semente, chave: null }));

  for (const rota of rotas) {
    const inicio = Date.now();
    /* duas rotas têm de caber nos 60 s da função: cada uma leva o que resta do
       orçamento, para a segunda nunca arrancar já sem tempo */
    const resta = orcamentoMs - (inicio - t0);
    if (resta < 3000) {
      tentativas.push({ via: rota.via, ok: false, ms: 0, erro: 'sem tempo no pedido para tentar outra rota' });
      continue;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), Math.min(timeoutMs, resta));
    try {
      let r;
      try {
        r = await fetchImpl(rota.url, { headers: rota.cabecalhos, signal: ctl.signal });
      } finally { clearTimeout(t); }
      const ms = Date.now() - inicio;
      if (!r.ok) {
        const corpo = await r.text().catch(() => '');
        tentativas.push({ via: rota.via, ok: false, ms, status: r.status, erro: `HTTP ${r.status}${corpo ? `: ${corpo.replace(/\s+/g, ' ').slice(0, 160)}` : ''}` });
        continue;
      }
      const mime = String(r.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!mime.startsWith('image/')) {
        const corpo = await r.text().catch(() => '');
        tentativas.push({ via: rota.via, ok: false, ms, status: r.status, erro: `respondeu «${mime || 'sem tipo'}» em vez de imagem: ${String(corpo).replace(/\s+/g, ' ').slice(0, 120)}` });
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) {
        tentativas.push({ via: rota.via, ok: false, ms, status: r.status, erro: `a imagem veio com ${buf.length} bytes — não é uma imagem` });
        continue;
      }
      if (buf.length > MAX_BYTES) {
        tentativas.push({ via: rota.via, ok: false, ms, status: r.status, erro: `a imagem veio com ${(buf.length / 1048576).toFixed(1)} MB (máx. 8)` });
        continue;
      }
      tentativas.push({ via: rota.via, ok: true, ms, status: r.status, bytes: buf.length });
      return {
        ok: true, mime, bytes: buf.length, ms: Date.now() - t0, via: rota.via, modelo: rota.modeloTentado || modelo,
        seed: semente, largura, altura, url: rota.url,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        tentativas, codigo: null, erro: null,
      };
    } catch (e) {
      clearTimeout(t);
      tentativas.push({ via: rota.via, ok: false, ms: Date.now() - inicio, erro: e?.name === 'AbortError' ? `não respondeu em ${Math.round(timeoutMs / 1000)} s` : String(e?.message || e).slice(0, 200) });
    }
  }
  const primeiro = tentativas[0];
  return {
    ok: false, ms: Date.now() - t0, seed: semente, tentativas,
    codigo: tentativas.some((x) => x.status === 402 || /pollen|credit|insufficient/i.test(x.erro || '')) ? 'semcreditos' : 'fornecedor',
    erro: primeiro?.erro ? `a imagem não veio: ${primeiro.erro}` : 'a imagem não veio e o fornecedor não explicou porquê',
  };
}

/**
 * VÍDEO — o caminho honesto.
 *
 * Existem dois caminhos reais e nenhum está aberto hoje: os créditos Pollen
 * (todos os modelos de vídeo são `paid_only`) e o worker do OpenMontage (precisa
 * de uma máquina com Python e FFmpeg). Devolve qual falta, com os modelos e os
 * preços que o fornecedor publica. Quando um deles abrir, é aqui que se liga.
 */
export async function estadoDoVideo({ repo = null, env = {} } = {}) {
  const modelos = MODELOS_VIDEO;
  let worker = { configurado: false, vivo: false, porque: null, pipelines: [] };
  try {
    const m = await import('./_ia/media.mjs');
    const e = await m.estado(repo, env);
    worker = { configurado: !!e.configurado, vivo: !!e.worker?.vivo, porque: e.porque || null, pipelines: e.pipelines || [] };
  } catch { /* sem módulo de media, fica indisponível e diz-se */ }
  const temChave = !!chavePollinations(env);
  return {
    disponivel: false,
    modelos,
    worker,
    credito: { chavePollinations: temChave },
    motivo: worker.vivo
      ? null
      : `vídeo precisa de uma de duas coisas: créditos Pollen (os ${modelos.length} modelos de vídeo do Pollinations são pagos) ou o worker do OpenMontage a correr numa máquina com Python e FFmpeg`,
  };
}

/** Tenta mesmo assim: o worker, se estiver vivo. Sem worker, não há ficheiro. */
export async function gerarVideo({ repo = null, env = {}, pedido, pipeline = 'cinematic', tipo = 'video', leadId = null } = {}) {
  const est = await estadoDoVideo({ repo, env });
  if (!est.worker.vivo) {
    return { ok: false, codigo: 'semvideo', motivo: est.motivo, modelos: est.modelos, worker: est.worker };
  }
  try {
    const m = await import('./_ia/media.mjs');
    const trabalho = await m.criar(repo, { pedido, tipo, pipeline }, env);
    return { ok: true, estado: trabalho?.estado || 'pedido', trabalho, leadId, nota: 'trabalho enviado ao worker; o ficheiro aparece quando ele renderizar' };
  } catch (e) {
    return { ok: false, codigo: 'falha', motivo: String(e?.message || e).slice(0, 300), worker: est.worker };
  }
}

/* ---------------------------------------------------------------------------
   4 · O ARQUIVO — projecto por lead, na base que já existe

   Guarda-se em `orbita_ai_config` com a chave `cine` (jsonb). Não é preciso
   migração nem tabela nova: o mesmo `config.ler/gravar` que a IA já usa, o que
   também significa que o modo local e os testes usam exactamente o mesmo
   caminho. As imagens viajam em `data:` e por isso há um tecto: os bytes ficam
   nas duas mais recentes e na aprovada; as restantes guardam o prompt, o modelo
   e a semente — com isso a imagem volta a ser gerada igual.
   --------------------------------------------------------------------------- */
export const CHAVE = 'cine';
export const MAX_IMAGENS = 12;
export const MAX_HISTORICO = 40;
export const MAX_PROJETOS = 60;

const agoraIso = () => new Date().toISOString();
const idCurto = (p = 'c') => `${p}${Math.random().toString(36).slice(2, 9)}`;

export async function lerArquivo(repo) {
  try {
    const cfg = await repo.ia.config.ler();
    const c = cfg?.[CHAVE];
    if (!c || typeof c !== 'object') return { versao: 1, provas: {}, projetos: {} };
    return { versao: c.versao || 1, provas: c.provas || {}, projetos: c.projetos || {}, actualizado: c.actualizado || null };
  } catch {
    return { versao: 1, provas: {}, projetos: {}, erroLeitura: true };
  }
}

export async function gravarArquivo(repo, dados) {
  const projetos = dados.projetos || {};
  const chaves = Object.keys(projetos);
  /* tecto de projectos: sai o mais antigo que não tenha nada aprovado */
  if (chaves.length > MAX_PROJETOS) {
    const ordenados = chaves
      .filter((k) => !projetos[k].aprovada)
      .sort((a, b) => String(projetos[a].actualizado || '').localeCompare(String(projetos[b].actualizado || '')));
    for (const k of ordenados.slice(0, chaves.length - MAX_PROJETOS)) delete projetos[k];
  }
  const saida = { versao: 1, actualizado: agoraIso(), provas: dados.provas || {}, projetos };
  try {
    await repo.ia.config.gravar(CHAVE, saida);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: `a base não guardou o projecto: ${String(e?.message || e).slice(0, 200)}` };
  }
}

/** Quantos `data:` ficam guardados por projecto (bytes a mais estragam a linha jsonb). */
function aliviarImagens(projeto) {
  const lista = projeto.imagens || [];
  const manter = new Set([projeto.aprovada, ...lista.slice(0, 2).map((i) => i.id)].filter(Boolean));
  projeto.imagens = lista.slice(0, MAX_IMAGENS).map((i) => (manter.has(i.id) ? i : { ...i, dataUrl: null }));
  return projeto;
}

export function projectoVazio(lead = {}, brief = null) {
  return {
    leadId: lead.id || null,
    lead: {
      id: lead.id || null, name: limpo(lead.name), category: limpo(lead.category) || null,
      city: limpo(lead.city) || null, website: limpo(lead.website) || null,
      phone: limpo(lead.phone) || null, email: limpo(lead.email) || null,
      rating: Number(lead.rating) || null, reviews: Number(lead.reviews) || null,
      notes: limpo(lead.notes).slice(0, 600) || null, status: limpo(lead.status) || null,
      source: limpo(lead.source) || null,
    },
    criado: agoraIso(), actualizado: agoraIso(),
    brief: brief || null,
    master: null,
    versoes: [],
    imagens: [],
    aprovada: null,
    video: null,
    historico: [],
  };
}

function empurrarHistorico(projeto, evento) {
  projeto.historico = [{ id: idCurto('h'), quando: agoraIso(), ...evento }, ...(projeto.historico || [])].slice(0, MAX_HISTORICO);
  projeto.actualizado = agoraIso();
  return projeto;
}

/** Cria ou abre o projecto de uma lead — sem tocar em nada se já existir. */
export async function abrirProjecto(repo, lead = {}) {
  const arquivo = await lerArquivo(repo);
  const chave = limpo(lead.id) || limpo(lead.name);
  if (!chave) return { ok: false, codigo: 'parametros', erro: 'sem lead não há projecto' };
  let projeto = arquivo.projetos[chave] || null;
  let criado = false;
  if (!projeto) {
    projeto = projectoVazio(lead);
    arquivo.projetos[chave] = projeto;
    criado = true;
  } else {
    /* os factos do lead actualizam-se; o trabalho criativo não se toca */
    projeto.lead = { ...projeto.lead, ...projectoVazio(lead).lead };
  }
  if (criado) {
    await gravarArquivo(repo, arquivo);
    const lido = await lerArquivo(repo);
    projeto = lido.projetos[chave] || projeto;
  }
  return { ok: true, chave, projeto, criado, arquivo };
}

/**
 * O passo completo de uma lead: leitura → Master Prompt (IA, senão regras) →
 * guardado com versão. Devolve tudo o que a mesa precisa para desenhar o ecrã.
 */
export async function prepararCine(repo, lead, brief = {}, { motor = null } = {}) {
  const ab = await abrirProjecto(repo, lead);
  if (!ab.ok) return ab;
  const analise = analisarLead(lead);
  const ia = await masterPromptComIA({ lead, brief, motor, analise });
  const mp = juntarPlano(construirMasterPrompt(lead, brief), ia);
  const a = ia.ok ? analise : { ...analise, motivoIA: ia.motivo, codigoIA: ia.codigo };

  const arquivo = await lerArquivo(repo);
  const projeto = arquivo.projetos[ab.chave] || ab.projeto;
  const versao = {
    id: idCurto('v'), quando: agoraIso(), via: mp.via, modelo: mp.modelo || null, fornec: mp.fornec || null,
    ms: mp.ms || null, motivo: ia.ok ? null : (ia.motivo || null), brief: briefNormalizada(brief),
    seccoes: mp.seccoes, prompts: mp.prompts, estilo: mp.estilo, formato: mp.formato, analise: a,
  };
  projeto.brief = versao.brief;
  projeto.master = versao;
  projeto.versoes = [versao, ...(projeto.versoes || [])].slice(0, 10);
  empurrarHistorico(projeto, { tipo: 'master', via: mp.via, resumo: mp.via === 'ia' ? `Master Prompt escrito por ${mp.fornec || 'IA'}/${mp.modelo || '—'}` : 'Master Prompt montado por regras' });
  const guardado = await gravarArquivo(repo, arquivo);
  return {
    ok: true, chave: ab.chave, projeto, versao, analise: a, guardado,
    aviso: guardado.ok ? null : guardado.erro,
    ia: ia.ok ? { ok: true, modelo: ia.modelo, fornec: ia.fornec, ms: ia.ms } : { ok: false, codigo: ia.codigo, motivo: ia.motivo },
    texto: masterEmTexto({ ...versao, leadNome: projeto.lead?.name }),
  };
}

/** Gera N imagens para a versão actual e guarda-as no projecto. */
export async function gerarCine(repo, chaveOuLead, { quantidade = 1, modelo = null, seed = null, prompt = null, env = {}, fetchImpl = fetch } = {}) {
  const arquivo = await lerArquivo(repo);
  const chave = typeof chaveOuLead === 'string' ? chaveOuLead : (limpo(chaveOuLead?.id) || limpo(chaveOuLead?.name));
  const projeto = arquivo.projetos[chave];
  if (!projeto) return { ok: false, codigo: 'semprojecto', erro: 'esta lead ainda não tem Master Prompt — abre o Cine primeiro' };
  const master = projeto.master;
  if (!master) return { ok: false, codigo: 'semmaster', erro: 'sem Master Prompt não há imagem: gera o plano primeiro' };
  const usarPrompt = limpo(prompt) || master.prompts?.imagem;
  if (!usarPrompt) return { ok: false, codigo: 'semprompt', erro: 'o Master Prompt não tem prompt de imagem' };
  const m = MODELOS_IMAGEM.find((x) => x.id === modelo) || MODELOS_IMAGEM[0];
  const quantos = Math.max(1, Math.min(4, Number(quantidade) || 1));
  const baseSeed = seed === null || seed === undefined || seed === '' ? hashDe(`${chave}|${master.id}`) % 1000000 : Math.abs(Math.trunc(Number(seed)));

  const feitas = [];
  for (let i = 0; i < quantos; i += 1) {
    const r = await gerarImagem({
      prompt: usarPrompt, modelo: m.id, largura: master.formato ? (FORMATOS.find((f) => f.id === master.formato) || FORMATOS[2]).largura : 1024,
      altura: master.formato ? (FORMATOS.find((f) => f.id === master.formato) || FORMATOS[2]).altura : 1024,
      seed: baseSeed + i, env, fetchImpl,
    });
    if (r.ok) {
      feitas.push({
        id: idCurto('i'), quando: agoraIso(), prompt: usarPrompt, modelo: r.modelo, via: r.via,
        seed: r.seed, largura: r.largura, altura: r.altura, ms: r.ms, bytes: r.bytes, mime: r.mime,
        dataUrl: r.dataUrl, aprovada: false, masterId: master.id,
      });
    } else {
      feitas.push({ id: idCurto('x'), quando: agoraIso(), falhou: true, codigo: r.codigo, erro: r.erro, tentativas: r.tentativas, prompt: usarPrompt, modelo: m.id, seed: r.seed });
    }
  }

  const relido = await lerArquivo(repo);
  const p = relido.projetos[chave] || projeto;
  const boas = feitas.filter((x) => !x.falhou);
  p.imagens = [...boas, ...(p.imagens || [])];
  aliviarImagens(p);
  if (boas.length) {
    empurrarHistorico(p, { tipo: 'imagem', resumo: `${boas.length} imagem(ns) por ${m.rotulo}`, ms: boas[0].ms, via: boas[0].via });
    relido.provas = { ...(relido.provas || {}), imagem: { quando: agoraIso(), ms: boas[0].ms, modelo: m.id, via: boas[0].via, bytes: boas[0].bytes } };
  } else {
    empurrarHistorico(p, { tipo: 'falha', resumo: `a geração falhou: ${feitas[0]?.erro || 'sem motivo'}` });
  }
  const g = await gravarArquivo(repo, relido);
  return {
    ok: boas.length > 0, chave, projeto: p, imagens: feitas, geradas: boas.length, falhadas: feitas.length - boas.length,
    guardado: g.ok, aviso: g.ok ? null : g.erro,
    erro: boas.length ? null : (feitas[0]?.erro || 'a imagem não veio'),
    codigo: boas.length ? null : (feitas[0]?.codigo || 'falha'),
    tentativas: boas.length ? null : (feitas[0]?.tentativas || []),
  };
}

export async function aprovarImagem(repo, chave, imagemId) {
  const arquivo = await lerArquivo(repo);
  const p = arquivo.projetos[chave];
  if (!p) return { ok: false, codigo: 'semprojecto', erro: 'não há projecto para esta lead' };
  const img = (p.imagens || []).find((i) => i.id === imagemId);
  if (!img) return { ok: false, codigo: 'semimagem', erro: 'essa imagem não está no projecto' };
  p.imagens = (p.imagens || []).map((i) => ({ ...i, aprovada: i.id === imagemId }));
  p.aprovada = imagemId;
  empurrarHistorico(p, { tipo: 'aprovacao', resumo: `imagem ${imagemId} aprovada` });
  aliviarImagens(p);
  const g = await gravarArquivo(repo, arquivo);
  return { ok: g.ok, projeto: p, aviso: g.ok ? null : g.erro };
}

export async function apagarImagem(repo, chave, imagemId) {
  const arquivo = await lerArquivo(repo);
  const p = arquivo.projetos[chave];
  if (!p) return { ok: false, codigo: 'semprojecto', erro: 'não há projecto para esta lead' };
  p.imagens = (p.imagens || []).filter((i) => i.id !== imagemId);
  if (p.aprovada === imagemId) p.aprovada = null;
  empurrarHistorico(p, { tipo: 'apagar', resumo: `imagem ${imagemId} apagada` });
  const g = await gravarArquivo(repo, arquivo);
  return { ok: g.ok, projeto: p, aviso: g.ok ? null : g.erro };
}

/* ---------------------------------------------------------------------------
   5 · ESTADO — o que a mesa pode prometer hoje
   --------------------------------------------------------------------------- */
export async function estadoCine({ repo = null, env = {} } = {}) {
  const arquivo = await lerArquivo(repo || { ia: { config: { ler: async () => ({}), gravar: async () => true } } });
  const projetos = Object.values(arquivo.projetos || {});
  const chave = chavePollinations(env);
  const video = await estadoDoVideo({ repo, env });
  return {
    ok: true,
    imagem: {
      via: 'pollinations',
      comChave: !!chave,
      /* não se diz «funciona» sem uma prova registada — a primeira geração é a prova */
      provado: arquivo.provas?.imagem || null,
      modelos: MODELOS_IMAGEM,
      motivoSemChave: !chave ? 'sem POLLINATIONS_API_KEY: a geração usa o tier anónimo, que pode recusar modelos' : null,
      limiteBytes: MAX_BYTES,
    },
    video,
    formatos: FORMATOS,
    estilos: ESTILOS,
    arquivo: {
      projetos: projetos.length,
      imagens: projetos.reduce((n, p) => n + (p.imagens || []).filter((i) => !i.falhou).length, 0),
      aprovadas: projetos.filter((p) => p.aprovada).length,
      comMaster: projetos.filter((p) => p.master).length,
    },
    fornecedores: {
      pollinations: FORNECEDORES.pollinations ? {
        nome: FORNECEDORES.pollinations.nome,
        variaveis: FORNECEDORES.pollinations.chave || [],
        temChave: !!chave,
      } : null,
    },
  };
}

/** A lista de projectos, para o ecrã de entrada do Cine. */
export async function listarProjectos(repo) {
  const arquivo = await lerArquivo(repo);
  return Object.entries(arquivo.projetos || {})
    .map(([chave, p]) => ({
      chave,
      lead: p.lead,
      criado: p.criado,
      actualizado: p.actualizado,
      via: p.master?.via || null,
      formato: p.master?.formato || null,
      conceito: p.master?.seccoes?.conceito || null,
      imagens: (p.imagens || []).filter((i) => !i.falhou).length,
      aprovada: p.aprovada ? ((p.imagens || []).find((i) => i.id === p.aprovada) || null) : null,
      /* 1.48.3 · a capa da lista: a aprovada se houver; senão a mais recente.
         Antes, um projecto com peças mas sem aprovação aparecia como «sem peça
         aprovada» — verdade literal e má informação: havia uma peça ali. */
      capa: (p.aprovada ? (p.imagens || []).find((i) => i.id === p.aprovada) : (p.imagens || []).find((i) => !i.falhou && i.dataUrl)) || null,
      temMaster: !!p.master,
    }))
    .sort((a, b) => String(b.actualizado || '').localeCompare(String(a.actualizado || '')))
    .map((p) => ({
      ...p,
      capa: p.capa ? { id: p.capa.id, dataUrl: p.capa.dataUrl || null, modelo: p.capa.modelo } : null,
      aprovada: p.aprovada ? { id: p.aprovada.id, dataUrl: p.aprovada.dataUrl || null, modelo: p.aprovada.modelo } : null,
    }));
}

export const _interno = { chavePollinations, aliviarImagens, SETORES, SETOR_GENERICO, MAX_BYTES };

/* ---------------------------------------------------------------------------
   6 · O TRAVÃO

   Cada imagem é um pedido real a um serviço alheio. Uma mesa com um botão preso
   não pode transformar-se numa fábrica. O contador vive na instância (é um
   travão, não uma factura) — e quando trava, diz quanto falta esperar.
   --------------------------------------------------------------------------- */
const GERACOES = [];
export const TECTO_GERACAO = { max: 12, janelaMs: 10 * 60 * 1000 };

export function travessaoGeracao({ max = TECTO_GERACAO.max, janelaMs = TECTO_GERACAO.janelaMs, agora = Date.now(), quantas = 1 } = {}) {
  while (GERACOES.length && agora - GERACOES[0] > janelaMs) GERACOES.shift();
  const restantes = Math.max(0, max - GERACOES.length);
  if (quantas > restantes) {
    const espera = GERACOES.length ? Math.ceil((janelaMs - (agora - GERACOES[0])) / 1000) : 0;
    return {
      ok: false, restantes,
      erro: `já se geraram ${GERACOES.length} imagens nos últimos ${Math.round(janelaMs / 60000)} minutos (tecto ${max}). Tenta outra vez em ${espera} s.`,
    };
  }
  for (let i = 0; i < quantas; i += 1) GERACOES.push(agora);
  return { ok: true, restantes: max - GERACOES.length };
}

export function limparTravessao() { GERACOES.length = 0; }

/** Apaga o projecto criativo de uma lead (o lead em si não é tocado). */
export async function apagarProjecto(repo, chave) {
  const arquivo = await lerArquivo(repo);
  if (!arquivo.projetos?.[chave]) return { ok: false, codigo: 'semprojecto', erro: 'não há projecto para esta lead' };
  delete arquivo.projetos[chave];
  const g = await gravarArquivo(repo, arquivo);
  return { ok: g.ok, apagado: chave, aviso: g.ok ? null : g.erro };
}
