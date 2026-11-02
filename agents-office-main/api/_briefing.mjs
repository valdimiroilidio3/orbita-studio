/* ===========================================================================
   1.54.2 · O BRIEFING DE UM PROJETO, O PROMPT MASTER E OS PROMPTS DE IMAGEM
   (2 nov 2026)

   O pedido do dono, por palavras dele: ao iniciar um projeto a partir de uma
   lead, poder gerar e editar um briefing, criar um Prompt Master próprio dessa
   lead, e obter os prompts de imagem do projeto — tudo ligado à lead e ao
   projeto.

   O que este ficheiro faz, e o que se recusa a fazer:

     · PREENCHE SÓ O QUE OS DADOS SUSTENTAM. Cada campo tem uma origem:
       `lead` (facto que veio da ficha), `ia` (sugestão do modelo) ou `manual`
       (escrito por uma pessoa). Um campo sem informação fica vazio — e a
       interface diz «não informado». Nunca se inventa setor, público ou preço.

     · O PROMPT MASTER SAI DO BRIEFING GUARDADO, não de uma conversa. A versão
       por regras (`montarPromptMaster`) é montada campo a campo e funciona sem
       nenhuma chave de IA; quando há motor, a IA escreve a versão final e ela
       fica marcada `via:'ia'`. Nunca se apresenta texto de regras como se
       fosse da IA — o `via` viaja sempre com o resultado.

     · OS PROMPTS DE IMAGEM SÃO PROMPTS: nada é gerado nesta etapa. Cada um
       diz a finalidade, onde se usa, o assunto, a composição, a direção de
       arte, o formato e as restrições («sem texto na imagem»). E diz também
       quando a imagem é um CONCEITO que tem de ser substituído por material
       da lead — uma foto de uma equipa que não existe não é registo real de
       nenhuma empresa.

     · O HISTÓRICO PRESERVA. Regenerar não apaga: a versão anterior fica em
       `masterHistorico`/`imagensHistorico` e pode ser consultada e reposta.

     · O BRIEFING SABE QUANDO MUDOU. `hashBriefing` viaja dentro do master e
       do conjunto de imagens; se o briefing guardado já não der o mesmo hash,
       `desactualizado` é verdadeiro e a interface diz que os prompts podem
       estar velhos.

   Onde fica guardado: no arquivo JSON de `orbita_ai_config` (chave `briefing`),
   o mesmo sítio onde o Cine guarda os projectos criativos desde a 1.48.0. É
   jsonb — não exige migração nova, não exige SQL à mão e não inventa tabelas.
   =========================================================================== */
import { createHash } from 'node:crypto';

export const CHAVE = 'briefing';
export const MAX_TEXTO = 4000;
export const MAX_PROMPT = 2400;
export const MAX_VERSOES = 6;
export const MAX_PROJETOS = 200;

const limpo = (s) => String(s ?? '').replace(/\u0000/g, '').trim();
const corta = (s, n) => limpo(s).slice(0, n);
const agoraIso = () => new Date().toISOString();
const idCurto = (p = 'b') => `${p}${Math.random().toString(36).slice(2, 9)}`;

/* ---------------------------------------------------------------------------
   1 · OS CAMPOS
   `de` diz quem os pode preencher sem perguntar a ninguém: `lead` = a ficha já
   o diz; `ia` = só um modelo ou uma pessoa; `manual` = só uma pessoa (é matéria
   do cliente — referências visuais e restrições não se adivinham).
   ------------------------------------------------------------------------ */
export const CAMPOS = [
  { id: 'empresa', label: 'Nome da empresa ou marca', tipo: 'curto', de: 'lead', ajuda: 'como aparece no site, nas redes e nas faturas' },
  { id: 'setor', label: 'Setor', tipo: 'curto', de: 'lead', ajuda: 'a atividade em duas ou três palavras' },
  { id: 'descricao', label: 'Descrição do negócio', tipo: 'longo', de: 'ia', ajuda: 'o que faz, para quem, e o que a distingue — em factos' },
  { id: 'produtos', label: 'Produtos ou serviços', tipo: 'longo', de: 'ia', ajuda: 'os principais, por ordem de importância comercial' },
  { id: 'publico', label: 'Público-alvo', tipo: 'longo', de: 'ia', ajuda: 'quem decide a compra e quem usa' },
  { id: 'objetivo', label: 'Objetivo do projeto', tipo: 'longo', de: 'ia', ajuda: 'o que tem de estar diferente no fim (marcações, chamadas, vendas)' },
  { id: 'valor', label: 'Proposta de valor e diferenciais', tipo: 'longo', de: 'ia', ajuda: 'porque escolher este negócio e não o do lado' },
  { id: 'tom', label: 'Tom de voz', tipo: 'curto', de: 'ia', ajuda: 'como fala: próximo, técnico, sóbrio, direto…' },
  { id: 'identidade', label: 'Identidade visual existente', tipo: 'longo', de: 'lead', ajuda: 'logo, cores, tipografia, fotografias — o que existe mesmo' },
  { id: 'direcaoVisual', label: 'Direção visual desejada', tipo: 'longo', de: 'ia', ajuda: 'o que se quer sentir ao abrir a página' },
  { id: 'referencias', label: 'Referências visuais', tipo: 'longo', de: 'manual', ajuda: 'sites, imagens ou marcas que o cliente mostrou' },
  { id: 'paginas', label: 'Páginas ou secções necessárias', tipo: 'longo', de: 'ia', ajuda: 'uma por linha, pela ordem em que devem aparecer' },
  { id: 'funcionalidades', label: 'Funcionalidades desejadas', tipo: 'longo', de: 'ia', ajuda: 'marcações, formulários, pagamentos, área de cliente…' },
  { id: 'cta', label: 'Chamada principal para ação', tipo: 'curto', de: 'ia', ajuda: 'a única ação que a página pede' },
  { id: 'restricoes', label: 'Restrições e observações', tipo: 'longo', de: 'manual', ajuda: 'o que não pode ser feito, prazos, aprovações, material em falta' },
];

export const CAMPO_IDS = CAMPOS.map((c) => c.id);
const CAMPO_POR_ID = new Map(CAMPOS.map((c) => [c.id, c]));

export const ORIGENS = ['lead', 'ia', 'manual'];
export const ETIQUETA_ORIGEM = {
  lead: 'da lead',
  ia: 'sugerido pela IA',
  manual: 'escrito por ti',
};

/** Um briefing vazio: nenhum campo preenchido, nenhuma origem inventada. */
export function briefingVazio() {
  const valores = {};
  for (const id of CAMPO_IDS) valores[id] = '';
  return { valores, origens: {} };
}

/* ---------------------------------------------------------------------------
   2 · O QUE A LEAD SUSTENTA
   Só se copia o que está escrito na ficha. Uma nota de oportunidade («sem site»)
   não é uma descrição do negócio: não se transforma em texto do briefing.
   ------------------------------------------------------------------------ */
export function daLead(lead = {}, projeto = null) {
  const b = briefingVazio();
  const poe = (id, valor, origem = 'lead') => {
    const v = corta(valor, MAX_TEXTO);
    if (!v) return;
    b.valores[id] = v;
    b.origens[id] = origem;
  };
  poe('empresa', lead.name);
  poe('setor', lead.category);
  /* o site é um facto; a identidade visual que lá está é uma avaliação que
     ninguém fez ainda — diz-se isso, em vez de a inventar */
  if (limpo(lead.website)) {
    poe('identidade', `Tem site em ${limpo(lead.website)}. A identidade visual (logo, cores, tipografia) tem de ser avaliada com o material do cliente.`);
  }
  /* o tipo de projeto não é um objetivo; é contexto. Fica no Prompt Master como
     tipo, e o objetivo continua vazio até alguém o dizer — a cidade também fica
     na ficha, não se copia para um campo que não existe. */
  return b;
}

/* ---------------------------------------------------------------------------
   3 · VALIDAÇÃO
   O que vem do cliente nunca entra tal e qual: só campos conhecidos, só texto,
   com tecto de tamanho. O que não se conhece é contado e deitado fora — e quem
   chamou pode dizê-lo.
   ------------------------------------------------------------------------ */
export function normalizarValores(bruto = {}) {
  const valores = {};
  const ignorados = [];
  const fonte = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  for (const [k, v] of Object.entries(fonte)) {
    if (!CAMPO_POR_ID.has(k)) { ignorados.push(k); continue; }
    if (v === null || v === undefined) { valores[k] = ''; continue; }
    if (typeof v === 'object') { ignorados.push(k); continue; }
    valores[k] = corta(v, MAX_TEXTO);
  }
  for (const id of CAMPO_IDS) if (valores[id] === undefined) valores[id] = '';
  return { valores, ignorados };
}

export function normalizarOrigens(bruto = {}) {
  const origens = {};
  const fonte = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  for (const [k, v] of Object.entries(fonte)) {
    if (!CAMPO_POR_ID.has(k)) continue;
    if (!ORIGENS.includes(v)) continue;
    origens[k] = v;
  }
  return origens;
}

/**
 * Junta valores novos às origens certas: o que mudou é sempre `manual`. O que
 * não mudou mantém a origem que já tinha (um facto da lead continua a ser um
 * facto da lead depois de se gravar o resto).
 */
export function origensDe(valores = {}, anteriores = {}, pedidas = {}, origensAnteriores = {}) {
  const out = {};
  for (const id of CAMPO_IDS) {
    const v = limpo(valores[id]);
    if (!v) continue;
    const antes = limpo(anteriores?.[id]);
    if (v === antes) {
      const o = ORIGENS.includes(pedidas?.[id]) ? pedidas[id] : origensAnteriores?.[id];
      out[id] = ORIGENS.includes(o) ? o : 'manual';
      continue;
    }
    /* mudou agora: por muito que o cliente diga «foi a IA», foi uma pessoa */
    out[id] = 'manual';
  }
  return out;
}

export function contarPreenchidos(briefing = {}) {
  const valores = briefing.valores || {};
  return CAMPO_IDS.filter((id) => limpo(valores[id])).length;
}

export function camposEmFalta(briefing = {}) {
  const valores = briefing.valores || {};
  return CAMPO_IDS.filter((id) => !limpo(valores[id]));
}

/** O hash que viaja dentro do master e das imagens: é o que diz «desactualizado». */
export function hashBriefing(briefing = {}) {
  const valores = briefing.valores || {};
  const canonico = CAMPO_IDS.map((id) => `${id}=${limpo(valores[id])}`).join('\n');
  return createHash('sha256').update(canonico).digest('hex').slice(0, 16);
}

/* ---------------------------------------------------------------------------
   4 · O PROMPT MASTER POR REGRAS
   Montado campo a campo a partir do briefing GUARDADO. Não inventa: onde falta
   informação escreve «não informado» e manda perguntar. É a versão que fica
   quando não há motor de IA, e a base que a IA recebe quando há.
   ------------------------------------------------------------------------ */
const TIPO_PROJETO = {
  landing: 'página de conversão (uma página, uma ação)',
  site: 'site de empresa (várias páginas institucionais)',
  loja: 'loja online',
  app: 'aplicação web',
};

const SUGESTAO_ESTRUTURA = {
  landing: ['capa com a promessa e a ação principal', 'o problema que resolve', 'como funciona, em três passos', 'prova (resultados, testemunhos só se existirem)', 'oferta e preço, se for público', 'perguntas frequentes', 'contacto com a ação principal repetida'],
  site: ['capa', 'o que a empresa faz', 'serviços ou produtos', 'quem somos e equipa', 'prova', 'contactos e localização'],
  loja: ['capa com o produto em destaque', 'catálogo com filtros', 'página de produto', 'carrinho e pagamento', 'envios e devoluções', 'contacto'],
  app: ['entrada com a proposta de valor', 'funcionalidades principais', 'preços', 'documentação ou ajuda', 'entrar / criar conta'],
};

const NAO_INFORMADO = 'não informado — perguntar ao cliente antes de escrever texto';

const linha = (rotulo, valor) => `- ${rotulo}: ${limpo(valor) || NAO_INFORMADO}`;

function dataLegivel(iso) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return 'data desconhecida';
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * O texto que se copia para uma ferramenta de criação (ou se entrega a quem
 * escreve o site). Estruturado por secções, e sempre com as regras de
 * honestidade à frente — porque é isso que impede o texto inventado.
 */
/* As regras de honestidade que o Prompt Master tem SEMPRE. Vivem aqui porque são
   o mesmo bloco nos dois caminhos: o das regras e o da IA. Antes desta versão, o
   texto da IA substituía o documento inteiro e levava consigo estas quatro
   linhas — ou seja, a única defesa escrita contra inventar factos desaparecia
   exactamente quando era a IA a escrever. */
export const REGRAS_DO_MASTER = Object.freeze([
  '- Usa apenas os factos deste documento. Não inventes números, prémios, anos de atividade, certificações, testemunhos, avaliações, moradas nem preços.',
  '- Onde leres «não informado», escreve «[a confirmar]» no conteúdo final e devolve a lista do que falta ao cliente.',
  '- Não copies marcas, páginas, textos nem identidade visual de terceiros — incluindo a Apple. Podes seguir princípios de clareza, hierarquia e cuidado no detalhe; nunca a forma de outra marca.',
  '- Escreve em português de Portugal, com a grafia e as expressões do país do cliente.',
]);

export const CABECA_REGRAS = '## 0. Regras que não se negociam';

/** Texto das regras, pronto a prefixar a um documento escrito pela IA. */
export function blocoDeRegras() {
  return [CABECA_REGRAS, ...REGRAS_DO_MASTER].join('\n');
}

/**
 * O que a IA escreveu e o briefing não sustenta. Não é um detector de mentiras:
 * é a lista do que um humano tem de confirmar antes de o documento ser usado —
 * anos, dinheiro, prémios e números de clientes/anos que não constam do briefing.
 * Devolve excertos curtos (sem repetir), para a mesa os poder mostrar.
 */
export function factosSuspeitos(texto = '', briefing = {}) {
  const fonte = Object.values(briefing.valores || {}).join(' ').toLowerCase();
  const t = String(texto || '');
  const achados = [];
  const juntar = (frase) => {
    const f = String(frase).replace(/\s+/g, ' ').trim().slice(0, 110);
    if (f && !achados.some((a) => a.toLowerCase() === f.toLowerCase())) achados.push(f);
  };

  /* anos: «desde 1998», «em 2021» */
  for (const m of t.matchAll(/\b(19|20)\d{2}\b/g)) {
    if (!fonte.includes(m[0])) juntar(`o ano ${m[0]}`);
  }
  /* dinheiro: «30 €», «350 EUR», «R$ 120» */
  for (const m of t.matchAll(/\b(\d{1,6}(?:[.,]\d{1,2})?)\s*(€|eur\b|euros|r\$|\$|usd\b)/gi)) {
    if (!fonte.includes(m[1])) juntar(`o valor ${m[1]} ${m[2]}`);
  }
  /* afirmações com número que o briefing não tem */
  for (const m of t.matchAll(/\b(\d{2,6})\s*(clientes|anos|colaboradores|funcion[áa]rios|doentes|pacientes|m[ée]dicos|avalia[çc][õo]es|estrelas)\b/gi)) {
    if (!fonte.includes(m[1])) juntar(`«${m[1]} ${m[2]}»`);
  }
  /* títulos que ninguém provou */
  for (const m of t.matchAll(/\b(pr[ée]mio[s]?|premiad[oa]s?|certificad[oa]s?|n[ºo°]\s*1|n[úu]mero um|l[íi]der de mercado|reconhecid[oa]s?)[^.!?\n]{0,50}/gi)) {
    const trecho = m[0].replace(/\s+/g, ' ').trim();
    if (!fonte.includes(trecho.toLowerCase().slice(0, 10))) juntar(trecho);
  }
  return achados.slice(0, 8);
}

export function montarPromptMaster({ briefing = {}, lead = {}, projeto = null, versao = null } = {}) {
  const v = briefing.valores || {};
  const empresa = limpo(v.empresa) || limpo(lead.name) || 'o projeto';
  const kind = limpo(projeto?.kind) || 'landing';
  const tipo = TIPO_PROJETO[kind] || kind;
  const estrutura = limpo(v.paginas)
    ? limpo(v.paginas).split(/\n|;|·/).map((x) => limpo(x)).filter(Boolean)
    : SUGESTAO_ESTRUTURA[kind] || SUGESTAO_ESTRUTURA.landing;
  const estruturaVeioDoBriefing = !!limpo(v.paginas);

  return [
    `PROMPT MASTER — ${empresa}`,
    versao ? `versão ${versao} · ${dataLegivel()} · briefing ${hashBriefing(briefing)}` : `briefing ${hashBriefing(briefing)} · ${dataLegivel()}`,
    '',
    CABECA_REGRAS,
    ...REGRAS_DO_MASTER,
    '',
    '## 1. Contexto da empresa',
    linha('Empresa ou marca', empresa),
    linha('Setor', v.setor),
    linha('Descrição do negócio', v.descricao),
    linha('Produtos ou serviços', v.produtos),
    linha('Tipo de projeto', tipo),
    projeto?.city ? `- Cidade: ${limpo(projeto.city)}` : '',
    lead?.website ? `- Site atual: ${limpo(lead.website)}` : '',
    '',
    '## 2. Objetivo do projeto',
    linha('Objetivo', v.objetivo),
    '- O sucesso mede-se pela ação principal descrita na secção 7, não pelo número de páginas.',
    '',
    '## 3. Público-alvo',
    linha('Quem serve', v.publico),
    '- Escreve para essa pessoa em concreto: o que ela já sabe, o que teme e o que precisa de ver antes de agir.',
    '',
    '## 4. Proposta de valor e diferenciais',
    linha('Proposta de valor', v.valor),
    '- Se não houver diferenciais escritos, não os inventes: usa o que o briefing disser sobre o serviço e deixa a comparação de fora.',
    '',
    '## 5. Tom de comunicação',
    linha('Tom de voz', v.tom),
    '- Frases curtas, voz ativa, zero jargão de agência. Nada de superlativos que ninguém possa provar.',
    '',
    '## 6. Estrutura de páginas e secções',
    ...(estruturaVeioDoBriefing
      ? estrutura.map((s, i) => `${i + 1}. ${s}`)
      : [`Sugestão do estúdio para ${tipo} (não é um facto do cliente — confirmar):`, ...estrutura.map((s, i) => `${i + 1}. ${s}`)]),
    '',
    '## 7. Conteúdo e chamadas para ação',
    linha('Ação principal', v.cta),
    '- Cada secção termina num passo concreto em direção a essa ação; um só verbo por botão.',
    '- Não escrevas testemunhos, casos de estudo nem números que não estejam no briefing.',
    '',
    '## 8. Direção visual e princípios de design',
    linha('Identidade visual existente', v.identidade),
    linha('Direção visual desejada', v.direcaoVisual),
    linha('Referências visuais', v.referencias),
    'Princípios a aplicar (inspirados na clareza do design contemporâneo, não copiados de nenhuma marca):',
    '- Clareza antes de decoração: uma ideia por ecrã, uma ação por secção.',
    '- Hierarquia visível: tamanho, peso e espaço a dizerem o que se lê primeiro.',
    '- Tipografia refinada: uma família, poucos tamanhos, entrelinha generosa.',
    '- Atenção ao detalhe: cantos, alinhamentos e estados de foco iguais em todo o lado.',
    '- Espaço e movimento com propósito: transições curtas (120–240 ms), nada que distraia da leitura.',
    '- Contraste e legibilidade acima do gosto: texto a 4.5:1 no mínimo.',
    '',
    '## 9. Imagens e outros media',
    '- Usa os prompts de imagem deste projeto, um por finalidade (principal, produto ou serviço, institucional e apoio).',
    '- Nenhuma imagem gerada por IA pode ser apresentada como fotografia real da empresa, das instalações ou da equipa: marca-se como conceito ou substitui-se por material fornecido pela lead.',
    '- Sem texto, logótipos ou marcas de água dentro das imagens.',
    '',
    '## 10. Responsividade, acessibilidade e desempenho',
    '- Desenha primeiro para 360 px de largura; a mesma página serve telemóvel, tablet e computador.',
    '- Navegação completa por teclado, foco visível, `alt` descritivo em todas as imagens, formulários com rótulos.',
    '- Alvos de toque com 44 px no mínimo; nada dependente só de cor.',
    '- Orçamento: página inicial abaixo de 1 MB, maior bloco de conteúdo abaixo de 2.5 s em 4G, sem dependências que bloqueiem a primeira pintura.',
    '- Respeita `prefers-reduced-motion`.',
    '',
    '## 11. Funcionalidades',
    linha('Funcionalidades desejadas', v.funcionalidades),
    '- O que não estiver aqui não se constrói nesta fase: propõe-se por escrito.',
    '',
    '## 12. Restrições e observações',
    linha('Restrições', v.restricoes),
    '',
    '## 13. Quando está pronto',
    '- A ação principal funciona no telemóvel e no computador.',
    '- Todo o texto visível tem origem no briefing ou está marcado «[a confirmar]».',
    '- Nenhuma imagem é apresentada como registo real sem o ser.',
    '- A página abre em menos de 2.5 s e passa num teste de teclado.',
    '',
    `— fim do prompt master de ${empresa}`,
  ].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ---------------------------------------------------------------------------
   5 · OS PROMPTS DE IMAGEM POR REGRAS
   Um conjunto coerente com o briefing: quatro finalidades, cada uma com o seu
   lugar na página, o seu formato e as suas restrições. Em português para se
   perceber, com o prompt em inglês (que é o que os modelos entendem) montado a
   partir dos mesmos factos — e a dizer quando é conceito.
   ------------------------------------------------------------------------ */
const FORMATOS = {
  principal: '16:9 · 1920×1080',
  produto: '4:5 · 1200×1500',
  institucional: '3:2 · 1800×1200',
  apoio: '1:1 · 1200×1200',
};

const NAO_INVENTAR = 'sem texto, letras, logótipos ou marcas de água na imagem';

function assuntoDe(id, v, lead) {
  const empresa = limpo(v.empresa) || limpo(lead?.name) || 'a empresa';
  const setor = limpo(v.setor) || limpo(lead?.category) || '';
  const produtos = limpo(v.produtos);
  const publico = limpo(v.publico);
  if (id === 'principal') {
    return `Cena que resume ${empresa}${setor ? ` (${setor})` : ''}: ${produtos || 'o serviço principal'} em uso, no lugar onde acontece${publico ? `, com ${publico} como figura` : ''}.`;
  }
  if (id === 'produto') {
    return `Detalhe do produto ou do resultado do serviço de ${empresa}: ${produtos || 'o que o cliente leva para casa'}.`;
  }
  if (id === 'institucional') {
    return `Retrato do ambiente de trabalho de ${empresa}: o espaço e as pessoas que ali trabalham${setor ? `, no contexto de ${setor.toLowerCase()}` : ''}.`;
  }
  return `Imagem de apoio para a secção de prova de ${empresa}: um gesto concreto do ofício${setor ? ` de ${setor.toLowerCase()}` : ''}, sem encenação.`;
}

function direcaoDe(id, v, lead) {
  const desejada = limpo(v.direcaoVisual);
  const identidade = limpo(v.identidade);
  const tom = limpo(v.tom);
  const base = desejada || (identidade && !/^tem site em/i.test(identidade) ? identidade : '');
  const luz = id === 'institucional'
    ? 'luz natural de janela, sombras suaves, sem flash direto'
    : id === 'produto'
      ? 'luz lateral controlada, fundo simples, textura visível'
      : 'luz natural direcional, hora dourada evitada, contraste cuidado';
  return [
    base || 'direção sóbria e editorial, longe da estética de banco de imagens',
    luz,
    tom ? `tom ${tom.toLowerCase()}` : 'tom próximo e honesto',
    'cores da marca quando existirem; sem filtros saturados',
  ].join(' · ');
}

function promptIngles(id, v, lead) {
  const empresa = limpo(v.empresa) || limpo(lead?.name) || 'the business';
  const setor = limpo(v.setor) || limpo(lead?.category) || '';
  const assunto = id === 'principal' ? 'the core service in use, in the place where it happens'
    : id === 'produto' ? 'a close detail of the product or of the result the customer takes home'
      : id === 'institucional' ? 'the real working environment and the people who work there'
        : 'a candid gesture of the craft, an in-between moment, no posing';
  const publico = limpo(v.publico);
  return [
    `Editorial photograph for the ${id === 'principal' ? 'hero' : id} section of a website.`,
    `Business: "${empresa}"${setor ? ` — ${setor}` : ''}.`,
    `Subject: ${assunto}${publico ? `, with ${publico}` : ''}.`,
    limpo(v.produtos) ? `Products or services to suggest: ${limpo(v.produtos).slice(0, 240)}.` : '',
    `Composition: ${id === 'principal' ? 'wide, subject slightly off-centre, room for a headline on one side' : id === 'produto' ? 'tight crop, single object, generous negative space' : id === 'institucional' ? 'medium-wide, eye level, natural depth' : 'square framing, hands and tools in focus'}.`,
    `Art direction: ${limpo(v.direcaoVisual) ? limpo(v.direcaoVisual).slice(0, 240) : 'restrained, editorial, not stock-photo'}.`,
    'Natural light, honest textures, real materials.',
    `${NAO_INVENTAR}. No recognisable real person presented as a testimonial. No fake location signage.`,
  ].filter(Boolean).join(' ');
}

export function montarPromptsDeImagem({ briefing = {}, lead = {}, projeto = null } = {}) {
  const v = briefing.valores || {};
  const base = [
    {
      id: 'principal', finalidade: 'Imagem principal da página',
      local: 'topo da página inicial, ao lado do título e da ação principal',
      conceito: true,
      nota: 'Conceito visual. Se a lead fornecer fotografia real do negócio, usa-se a dela — nunca se apresenta esta como registo real.',
    },
    {
      id: 'produto', finalidade: 'Imagem de produto, serviço ou ambiente',
      local: 'secção que explica o que se vende',
      conceito: true,
      nota: 'Conceito visual. Produtos e instalações reais substituem este prompt assim que houver fotografia da lead.',
    },
    {
      id: 'institucional', finalidade: 'Imagem institucional ou de equipa',
      local: 'secção «quem somos»',
      conceito: true,
      nota: 'NÃO usar como fotografia da equipa. Pessoas de uma imagem gerada não são os trabalhadores desta empresa: sem material da lead, apresenta-se como ilustração de conceito ou não se usa.',
    },
    {
      id: 'apoio', finalidade: 'Imagem de apoio para uma secção específica',
      local: 'secção de prova ou de perguntas frequentes',
      conceito: true,
      nota: 'Conceito visual de apoio; pode ser substituída por um detalhe fotográfico do cliente.',
    },
  ];
  return base.map((b) => ({
    ...b,
    assunto: assuntoDe(b.id, v, lead),
    composicao: b.id === 'principal'
      ? 'plano aberto com espaço limpo para o título; sujeito ligeiramente fora do centro'
      : b.id === 'produto'
        ? 'plano fechado, um só objeto, muito espaço vazio à volta'
        : b.id === 'institucional'
          ? 'plano médio-largo à altura dos olhos, profundidade natural'
          : 'enquadramento quadrado, mãos e ferramentas em foco',
    direcaoArte: direcaoDe(b.id, v, lead),
    formato: FORMATOS[b.id],
    restricoes: [
      NAO_INVENTAR,
      'sem pessoas reconhecíveis a fazer de testemunho',
      'sem placas, moradas ou logótipos de terceiros',
    ].join('; '),
    prompt: promptIngles(b.id, v, lead),
    idioma: 'prompt em inglês (é o que os modelos de imagem entendem); descrição em português',
  }));
}

/** O conjunto todo num texto que se copia de uma vez. */
export function promptsEmTexto(prompts = [], { empresa = '', projeto = null } = {}) {
  const cabeca = `PROMPTS DE IMAGEM — ${empresa || 'projeto'}${projeto?.kind ? ` · ${projeto.kind}` : ''}`;
  return [cabeca, '', ...prompts.map((p, i) => [
    `${i + 1}. ${p.finalidade}`,
    `   Onde: ${p.local}`,
    `   Assunto: ${p.assunto}`,
    `   Composição: ${p.composicao}`,
    `   Direção de arte: ${p.direcaoArte}`,
    `   Formato: ${p.formato}`,
    `   Restrições: ${p.restricoes}`,
    `   Prompt: ${p.prompt}`,
    `   Nota: ${p.nota}`,
    '',
  ].join('\n'))].join('\n');
}

/* ---------------------------------------------------------------------------
   6 · A IA (quando há motor)
   Tudo o que vem do modelo é validado antes de se guardar: campos conhecidos,
   texto, tectos de tamanho, e a marca `via:'ia'`. Se a resposta não servir,
   devolve-se `ok:false` com o motivo — quem chama mostra a versão por regras e
   a razão, em vez de fingir que a IA escreveu.
   ------------------------------------------------------------------------ */
export function lerJSON(bruto) {
  const t = String(bruto || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  const inicio = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) return null;
  try { return JSON.parse(t.slice(inicio, fim + 1)); } catch { return null; }
}

const NAO_INVENTAR_INSTRUCAO = [
  'Regras absolutas:',
  '- Usa apenas factos que estejam na ficha da lead ou no briefing. Não inventes números, datas, prémios, certificações, preços, moradas, testemunhos nem avaliações.',
  '- Se um campo não puder ser sustentado, devolve string vazia para esse campo.',
  '- Português de Portugal, direto, sem linguagem de agência.',
  '- Responde APENAS com JSON válido, sem blocos de código e sem comentários.',
].join('\n');

function fichaDaLead(lead = {}) {
  return JSON.stringify({
    nome: limpo(lead.name) || null,
    setor: limpo(lead.category) || null,
    cidade: limpo(lead.city) || null,
    site: limpo(lead.website) || null,
    telefone: limpo(lead.phone) || null,
    notas: limpo(lead.notes).slice(0, 300) || null,
  }, null, 2);
}

/**
 * O primeiro rascunho do briefing. Só preenche os campos pedidos (por omissão,
 * os que estão vazios) e só com o que a ficha sustenta.
 */
export async function rascunhoComIA({ lead = {}, projeto = null, briefing = {}, motor = null, campos = null } = {}) {
  if (!motor || typeof motor.pedir !== 'function') {
    return { ok: false, codigo: 'semmotor', motivo: 'não há motor de IA ligado neste pedido' };
  }
  const alvo = (Array.isArray(campos) && campos.length ? campos.filter((c) => CAMPO_POR_ID.has(c)) : camposEmFalta(briefing));
  if (!alvo.length) return { ok: false, codigo: 'completo', motivo: 'o briefing já tem todos os campos preenchidos — escreve tu o que faltar ou gera o Prompt Master' };
  const pedido = [
    'És o responsável de descoberta de um estúdio que faz sites. Vais escrever o primeiro rascunho do briefing de um projeto.',
    'Tens a ficha real do negócio e, por vezes, o que uma pessoa já escreveu no briefing (isso manda: não o contradigas).',
    NAO_INVENTAR_INSTRUCAO,
    `Devolve um objeto JSON com exactamente estas chaves, todas string: ${JSON.stringify(alvo)}.`,
    'Cada valor: 1 a 3 frases (ou uma lista separada por «;» quando for o caso). Se não souberes, "" na mesma.',
    '',
    `FICHA DA LEAD:\n${fichaDaLead(lead)}`,
    projeto ? `\nPROJETO: ${JSON.stringify({ tipo: projeto.kind || 'landing', cidade: projeto.city || null })}` : '',
    `\nBRIEFING JÁ ESCRITO (não mexer):\n${JSON.stringify(briefing.valores || {}, null, 2)}`,
  ].join('\n');

  const t0 = Date.now();
  try {
    const r = await motor.pedir('texto', [
      { role: 'system', content: 'Trabalhas com factos. O que não souberes, deixas vazio. Escreves em português de Portugal.' },
      { role: 'user', content: pedido },
    ], { agente: 'briefing', maxTokens: 1100, temperatura: 0.4, limite: 3 });
    const j = lerJSON(r?.texto);
    if (!j) return { ok: false, codigo: 'resposta-invalida', motivo: 'o modelo não devolveu JSON legível', ms: Date.now() - t0, texto: corta(r?.texto, 300) };
    const valores = {};
    for (const id of alvo) {
      const v = limpo(typeof j[id] === 'string' ? j[id] : '');
      if (v) valores[id] = corta(v, MAX_TEXTO);
    }
    if (!Object.keys(valores).length) {
      return { ok: false, codigo: 'vazio', motivo: 'o modelo não sustentou nenhum dos campos em falta com os dados da lead', ms: Date.now() - t0 };
    }
    return { ok: true, via: 'ia', valores, modelo: r?.modelo || null, fornec: r?.fornec || null, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, codigo: 'falha', motivo: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 };
  }
}

/**
 * O Prompt Master escrito pela IA, a partir do briefing GUARDADO (que vai
 * inteiro no pedido). O texto dela substitui o das regras, mas as regras de
 * honestidade continuam lá — e o tamanho é limitado antes de se guardar.
 */
export async function masterComIA({ briefing = {}, lead = {}, projeto = null, base = '', motor = null, instrucao = '' } = {}) {
  if (!motor || typeof motor.pedir !== 'function') {
    return { ok: false, codigo: 'semmotor', motivo: 'não há motor de IA ligado neste pedido' };
  }
  const pedido = [
    'És o director de projeto de um estúdio que faz sites. Escreves o Prompt Master de um projeto — o documento que uma equipa (ou uma ferramenta de geração) segue para construir o site.',
    'O briefing abaixo é a única fonte de factos. Não acrescentes factos que não estejam nele: o que faltar recebe «[a confirmar]».',
    'Estrutura obrigatória, com estes títulos: Contexto da empresa · Objetivo do projeto · Público-alvo · Proposta de valor e tom · Estrutura de páginas e secções · Conteúdo e chamadas à ação · Direção visual e princípios de design · Imagens e media · Responsividade, acessibilidade e desempenho · Funcionalidades · Restrições · Quando está pronto.',
    'Direção visual: podes seguir princípios de clareza, hierarquia, tipografia refinada, atenção ao detalhe e uso cuidadoso de espaço e movimento. NÃO copies marcas, páginas, textos nem a identidade visual da Apple ou de outra marca.',
    'Não escrevas em markdown de código, não uses tabelas. Texto corrido com títulos em «##». Entre 700 e 1400 palavras.',
    'Responde só com o documento, sem comentários antes ou depois.',
    instrucao ? `INDICAÇÃO EXTRA DE QUEM PEDIU: ${corta(instrucao, 400)}` : '',
    '',
    `BRIEFING GUARDADO (hash ${hashBriefing(briefing)}):\n${JSON.stringify(briefing.valores || {}, null, 2)}`,
    lead?.name ? `\nLEAD: ${limpo(lead.name)}${lead.category ? ` · ${limpo(lead.category)}` : ''}${lead.city ? ` · ${limpo(lead.city)}` : ''}` : '',
    projeto?.kind ? `\nTIPO DE PROJETO: ${limpo(projeto.kind)}` : '',
    base ? `\nDOCUMENTO POR REGRAS (podes melhorá-lo, mas não contradigas as regras 0):\n${base.slice(0, 3000)}` : '',
  ].filter((x) => x !== '').join('\n');

  const t0 = Date.now();
  try {
    const r = await motor.pedir('texto', [
      { role: 'system', content: 'Escreves documentos de projeto em português de Portugal. Não inventas factos.' },
      { role: 'user', content: pedido },
    ], { agente: 'briefing', maxTokens: 2000, temperatura: 0.55, limite: 3 });
    /* O modelo pode devolver o bloco de regras (pediu-se-lhe que não contradiga a
       secção 0). Se devolveu, tira-se para não ficar duas vezes; se não devolveu,
       é acrescentado aqui. As regras deixam de depender da boa vontade do modelo. */
    let corpo = limpo(r?.texto).replace(/^\s*PROMPT MASTER[^\n]*\n/i, '');
    if (corpo.includes(CABECA_REGRAS)) {
      corpo = corpo.slice(corpo.indexOf(CABECA_REGRAS)).replace(CABECA_REGRAS, '').trim();
    }
    if (corpo.length < 400) {
      return { ok: false, codigo: 'resposta-curta', motivo: `o modelo devolveu ${corpo.length} caracteres — não chega para um Prompt Master`, ms: Date.now() - t0 };
    }

    /* o que a IA afirmou e o briefing não sustenta: não se apaga (pode ser
       verdade que ainda ninguém escreveu), marca-se e diz-se — quem usa decide */
    const suspeitos = factosSuspeitos(corpo, briefing);
    const aviso = suspeitos.length
      ? ['## ⚠ Antes de usar — por confirmar', ...suspeitos.map((x) => `- ${x}: não consta do briefing. Confirma com o cliente ou retira antes de usar.`), '']
      : [];
    const texto = [blocoDeRegras(), '', ...aviso, corpo].join('\n').slice(0, 24000);
    return {
      ok: true, via: 'ia', texto,
      avisos: suspeitos.map((x) => `${x} — não consta do briefing`),
      modelo: r?.modelo || null, fornec: r?.fornec || null, ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, codigo: 'falha', motivo: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 };
  }
}

/**
 * O que um prompt de imagem não pode pedir, venha de onde vier.
 *
 * O caminho por regras já impõe isto (`montarPromptsDeImagem`): sem texto na
 * imagem, sem pessoas reconhecíveis a fazer de testemunho, nada apresentado como
 * fotografia real da empresa. A versão da IA tem de obedecer ao mesmo — senão o
 * prompt segue para a área de mídia e produz a imagem que o produto prometeu
 * nunca produzir.
 */
export function violacoesDePrompt(p = {}) {
  const texto = [p.prompt, p.assunto, p.composicao, p.direcaoArte].filter(Boolean).join(' \n ');
  const out = [];

  /* Olha-se cláusula a cláusula, porque «no text in the image» é uma defesa e
     «include a bold logo» é um pedido — a mesma palavra, sentidos opostos. */
  const clausulas = String(texto).split(/[.;\n]|,\s|\band\b|\bwith\b/i).map((c) => c.trim()).filter(Boolean);
  const NEGACAO = /\b(no|not|never|without|avoid|free of|sem|nunca|evitar|isento)\b/i;
  const PEDE_TEXTO = /\b(texto|text|lettering|letters|words?|typography|titles?|captions?|logo|logos|log[óo]tipo|watermark|signage|wordmark|letterhead|marca de [áa]gua)\b/i;
  const pedidoDeTexto = clausulas.some((c) => PEDE_TEXTO.test(c) && !NEGACAO.test(c))
    || /text\s+on\s+(the\s+)?image|overlay(ed)?\s+text|\bwordmark\b/i.test(texto);
  if (pedidoDeTexto) out.push('pede texto, letras ou logótipos dentro da imagem');

  /* apresentar pessoas ou instalações como as reais da empresa */
  if (/(real|actual|genuine|true)\s+(team|staff|employees|workers|doctors|dentists|crew|clinic|shop|store|office|premises|interior)/i.test(texto)
    || /(equipa|equipe)\s+real|noss[ao]s?\s+(equipa|equipe|funcion[áa]rios|colaboradores)|verdadeir[ao]s?\s+(funcion[áa]rios|colaboradores)/i.test(texto)) {
    out.push('apresenta pessoas ou instalações como sendo as reais da empresa');
  }
  return out;
}

/** Os prompts de imagem escritos pela IA — validados contra o conjunto das regras. */
export async function imagensComIA({ briefing = {}, lead = {}, projeto = null, base = [], motor = null } = {}) {
  if (!motor || typeof motor.pedir !== 'function') {
    return { ok: false, codigo: 'semmotor', motivo: 'não há motor de IA ligado neste pedido' };
  }
  const pedido = [
    'És director de arte. Escreves os prompts de imagem de um site, coerentes com o briefing e com o Prompt Master.',
    'Devolve APENAS JSON: {"prompts":[{"finalidade":"","local":"","assunto":"","composicao":"","direcaoArte":"","formato":"","restricoes":"","prompt":""}]}',
    `Devolve ${base.length} prompts, um por cada finalidade pedida, pela mesma ordem: ${JSON.stringify(base.map((b) => b.finalidade))}.`,
    'O campo "prompt" é em inglês, denso, pronto a colar num modelo de imagem, e NUNCA pede texto, letras, logótipos ou marcas de água dentro da imagem.',
    'Os outros campos são em português de Portugal. Não descrevas pessoas reais identificáveis nem apresentes nada como fotografia real da empresa.',
    NAO_INVENTAR_INSTRUCAO,
    '',
    `BRIEFING:\n${JSON.stringify(briefing.valores || {}, null, 2)}`,
    lead?.name ? `\nLEAD: ${limpo(lead.name)}${lead.city ? ` · ${limpo(lead.city)}` : ''}` : '',
    `\nFINALIDADES E FORMATOS:\n${JSON.stringify(base.map((b) => ({ finalidade: b.finalidade, local: b.local, formato: b.formato })), null, 2)}`,
  ].filter((x) => x !== '').join('\n');

  const t0 = Date.now();
  try {
    const r = await motor.pedir('texto', [
      { role: 'system', content: 'Escreves direção de arte para fotografia editorial. Sem factos inventados.' },
      { role: 'user', content: pedido },
    ], { agente: 'briefing', maxTokens: 1800, temperatura: 0.6, limite: 3 });
    const j = lerJSON(r?.texto);
    const lista = Array.isArray(j?.prompts) ? j.prompts : [];
    if (lista.length < Math.min(3, base.length)) {
      return { ok: false, codigo: 'resposta-incompleta', motivo: `o modelo devolveu ${lista.length} prompt(s) — o conjunto precisa de ${base.length}`, ms: Date.now() - t0 };
    }
    const prompts = base.map((b, i) => {
      const x = lista[i] && typeof lista[i] === 'object' ? lista[i] : {};
      return {
        ...b,
        finalidade: corta(x.finalidade, 120) || b.finalidade,
        local: corta(x.local, 160) || b.local,
        assunto: corta(x.assunto, 600) || b.assunto,
        composicao: corta(x.composicao, 400) || b.composicao,
        direcaoArte: corta(x.direcaoArte, 600) || b.direcaoArte,
        formato: corta(x.formato, 60) || b.formato,
        /* as restrições do caminho por regras NUNCA se perdem: se a IA escrever
           «nenhuma», passa a «nenhuma; <as que o projeto exige>» */
        restricoes: [corta(x.restricoes, 300), b.restricoes].filter(Boolean).join('; '),
        prompt: corta(x.prompt, MAX_PROMPT) || b.prompt,
        idioma: 'prompt em inglês; descrição em português',
      };
    });

    /* A IA não fica dispensada das regras que o caminho por regras cumpre. Se ela
       pedir texto na imagem, imitar a equipa real ou reivindicar material que
       ninguém entregou, o conjunto dela é RECUSADO (e usa-se o das regras, com o
       motivo escrito) — em vez de entrar em silêncio na área de mídia. */
    const violacoes = [];
    for (const p of prompts) {
      for (const v of violacoesDePrompt(p)) violacoes.push(`${p.finalidade}: ${v}`);
    }
    if (violacoes.length) {
      return {
        ok: false, codigo: 'regra',
        motivo: `a versão da IA quebrava as regras de imagem — ${violacoes.slice(0, 3).join('; ')}`,
        violacoes, ms: Date.now() - t0,
      };
    }
    return { ok: true, via: 'ia', prompts, modelo: r?.modelo || null, fornec: r?.fornec || null, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, codigo: 'falha', motivo: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 };
  }
}

/* ---------------------------------------------------------------------------
   7 · O ARQUIVO (o mesmo esquema do Cine: jsonb em `orbita_ai_config`)
   ------------------------------------------------------------------------ */
export async function lerArquivo(repo) {
  try {
    const cfg = await repo.ia.config.ler();
    const c = cfg?.[CHAVE];
    if (!c || typeof c !== 'object') return { versao: 1, projetos: {} };
    return { versao: c.versao || 1, projetos: c.projetos || {}, actualizado: c.actualizado || null };
  } catch {
    return { versao: 1, projetos: {}, erroLeitura: true };
  }
}

export async function gravarArquivo(repo, dados) {
  const projetos = dados.projetos || {};
  const chaves = Object.keys(projetos);
  if (chaves.length > MAX_PROJETOS) {
    const ordenados = chaves
      .sort((a, b) => String(projetos[a].actualizado || '').localeCompare(String(projetos[b].actualizado || '')));
    for (const k of ordenados.slice(0, chaves.length - MAX_PROJETOS)) delete projetos[k];
  }
  const saida = { versao: 1, actualizado: agoraIso(), projetos };
  try {
    await repo.ia.config.gravar(CHAVE, saida);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: `a base não guardou o briefing: ${String(e?.message || e).slice(0, 200)}` };
  }
}

/** A entrada de um projeto, criada à primeira vista. Nunca apaga trabalho existente. */
export function registoVazio(projeto = {}, lead = null) {
  return {
    projetoId: projeto.id || null,
    leadId: projeto.lead_id || lead?.id || null,
    leadNome: limpo(lead?.name) || limpo(projeto.client) || limpo(projeto.name) || null,
    criado: agoraIso(),
    actualizado: agoraIso(),
    briefing: { valores: briefingVazio().valores, origens: {}, gravadoEm: null, por: null },
    master: null,
    masterHistorico: [],
    imagens: null,
    imagensHistorico: [],
    historico: [],
  };
}

function evento(registo, texto, por = null) {
  registo.historico = [{ id: idCurto('h'), quando: agoraIso(), texto, por: por || null }, ...(registo.historico || [])].slice(0, 40);
  registo.actualizado = agoraIso();
}

/** Abre (ou cria) o registo do projeto e devolve o arquivo para se poder gravar. */
export async function abrirRegisto(repo, { projeto, lead = null }) {
  const id = limpo(projeto?.id);
  if (!id) return { ok: false, codigo: 'semprejeto', erro: 'sem projeto não há briefing' };
  const arquivo = await lerArquivo(repo);
  let registo = arquivo.projetos[id] || null;
  let criado = false;
  if (!registo) {
    registo = registoVazio(projeto, lead);
    /* os factos da ficha entram já: empresa e setor nunca ficam vazios por
       distração de quem abre o projeto */
    const semente = daLead(lead || {}, projeto);
    registo.briefing = { valores: semente.valores, origens: semente.origens, gravadoEm: agoraIso(), por: 'ficha da lead' };
    evento(registo, 'briefing aberto com o que a ficha da lead sustentava');
    arquivo.projetos[id] = registo;
    criado = true;
  } else {
    /* a lead mudou de nome ou de setor? actualiza-se só o que ninguém escreveu */
    const semente = daLead(lead || {}, projeto);
    for (const campo of ['empresa', 'setor']) {
      if (limpo(semente.valores[campo]) && !limpo(registo.briefing.valores?.[campo])) {
        registo.briefing.valores[campo] = semente.valores[campo];
        registo.briefing.origens[campo] = 'lead';
      }
    }
    registo.leadId = registo.leadId || projeto.lead_id || lead?.id || null;
  }
  return { ok: true, arquivo, registo, criado };
}

export async function gravarRegisto(repo, arquivo, registo) {
  arquivo.projetos[registo.projetoId] = registo;
  const g = await gravarArquivo(repo, arquivo);
  return g.ok ? { ok: true, registo } : { ok: false, erro: g.erro, registo };
}

/* ---------------------------------------------------------------------------
   8 · AS OPERAÇÕES
   Cada uma devolve `{ ok, ... }` — nunca lança pelo caminho feliz; o erro vai
   escrito em `erro` e o HTTP decide-se na camada das rotas.
   ------------------------------------------------------------------------ */

const minimoParaGerar = (briefing) => {
  const v = briefing?.valores || {};
  const preenchidos = CAMPO_IDS.filter((id) => limpo(v[id]));
  const temEmpresa = !!limpo(v.empresa);
  const temMateria = ['objetivo', 'descricao', 'produtos', 'publico', 'valor'].some((id) => limpo(v[id]));
  return { ok: temEmpresa && temMateria, preenchidos };
};

export function vistaDoRegisto(registo, { projeto = null } = {}) {
  if (!registo) return null;
  const briefing = registo.briefing || briefingVazio();
  const hash = hashBriefing(briefing);
  return {
    projetoId: registo.projetoId,
    leadId: registo.leadId,
    leadNome: registo.leadNome,
    briefing: {
      valores: briefing.valores || {},
      origens: briefing.origens || {},
      gravadoEm: briefing.gravadoEm || null,
      por: briefing.por || null,
      hash,
    },
    master: registo.master || null,
    imagens: registo.imagens || null,
    desactualizado: {
      master: !!registo.master && registo.master.base !== hash,
      imagens: !!registo.imagens && registo.imagens.base !== hash,
    },
    versoes: {
      master: (registo.masterHistorico || []).length,
      imagens: (registo.imagensHistorico || []).length,
    },
    historico: registo.historico || [],
    preenchidos: contarPreenchidos(briefing),
    emFalta: camposEmFalta(briefing),
    actualizado: registo.actualizado || null,
    projecto: projeto ? { id: projeto.id, name: projeto.name, kind: projeto.kind } : null,
  };
}

/** Grava o briefing editado. `base` (hash) evita pisar o trabalho de outra pessoa. */
export async function guardarBriefing(repo, { projeto, lead = null, valores = {}, origens = {}, base = null, por = null } = {}) {
  const ab = await abrirRegisto(repo, { projeto, lead });
  if (!ab.ok) return ab;
  const { registo, arquivo } = ab;
  const actual = registo.briefing || { valores: {}, origens: {} };
  if (base && limpo(base) !== hashBriefing(actual)) {
    return {
      ok: false, codigo: 'conflito',
      erro: 'o briefing mudou desde que o abriste — recarrega para ver a versão guardada antes de gravares por cima',
      vista: vistaDoRegisto(registo, { projeto }),
    };
  }
  const { valores: novos, ignorados } = normalizarValores(valores);
  const pedidas = normalizarOrigens(origens);
  const mudou = CAMPO_IDS.some((id) => limpo(novos[id]) !== limpo(actual.valores?.[id]));
  registo.briefing = {
    valores: novos,
    origens: origensDe(novos, actual.valores || {}, pedidas, actual.origens || {}),
    gravadoEm: agoraIso(),
    por: por || null,
  };
  if (mudou) evento(registo, 'briefing gravado à mão', por);
  const g = await gravarRegisto(repo, arquivo, registo);
  if (!g.ok) return g;
  return { ok: true, vista: vistaDoRegisto(registo, { projeto }), ignorados, mudou };
}

/** O rascunho da IA: só os campos vazios (ou todos, com `substituir`). */
export async function rascunharBriefing(repo, { projeto, lead = null, motor = null, substituir = false, por = null } = {}) {
  const ab = await abrirRegisto(repo, { projeto, lead });
  if (!ab.ok) return ab;
  const { registo, arquivo } = ab;
  const actual = registo.briefing || { valores: {}, origens: {} };
  const emFalta = camposEmFalta(actual);
  /* «reescrever» toca só no que a IA tinha sugerido (ou no que está vazio): o que
     uma pessoa escreveu à mão não é reescrito por um modelo, nem a pedido */
  const alvo = substituir
    ? CAMPO_IDS.filter((id) => !limpo(actual.valores?.[id]) || actual.origens?.[id] === 'ia')
    : emFalta;
  if (!alvo.length) {
    return { ok: true, via: 'nenhuma', vista: vistaDoRegisto(registo, { projeto }), motivo: 'o briefing já tem todos os campos preenchidos — escreve tu o que faltar ou gera o Prompt Master' };
  }
  const r = await rascunhoComIA({ lead, projeto, briefing: actual, motor, campos: alvo });
  if (!r.ok) {
    return {
      ok: false, codigo: r.codigo, erro: r.motivo,
      vista: vistaDoRegisto(registo, { projeto }),
      dica: 'podes escrever o briefing à mão — o projeto continua acessível',
    };
  }
  const valores = { ...(actual.valores || {}) };
  const origensNovas = { ...(actual.origens || {}) };
  for (const [k, v] of Object.entries(r.valores)) {
    if (!CAMPO_POR_ID.has(k)) continue;
    /* um facto nunca é substituído por uma sugestão */
    if (!substituir && origensNovas[k] === 'lead' && limpo(valores[k])) continue;
    valores[k] = v;
    origensNovas[k] = 'ia';
  }
  registo.briefing = { valores, origens: origensNovas, gravadoEm: agoraIso(), por: por || 'IA' };
  evento(registo, `rascunho do briefing escrito por ${r.fornec || 'IA'}/${r.modelo || '—'} (${Object.keys(r.valores).length} campo(s))`, por);
  const g = await gravarRegisto(repo, arquivo, registo);
  if (!g.ok) return g;
  return { ok: true, via: 'ia', modelo: r.modelo || null, fornec: r.fornec || null, ms: r.ms || 0, vista: vistaDoRegisto(registo, { projeto }) };
}

/** O Prompt Master a partir do briefing GUARDADO. A IA refina; as regras nunca faltam. */
export async function gerarMaster(repo, { projeto, lead = null, motor = null, instrucao = '', por = null } = {}) {
  const ab = await abrirRegisto(repo, { projeto, lead });
  if (!ab.ok) return ab;
  const { registo, arquivo } = ab;
  const briefing = registo.briefing || briefingVazio();
  const minimo = minimoParaGerar(briefing);
  if (!minimo.ok) {
    return {
      ok: false, codigo: 'briefing-vazio',
      erro: 'o briefing guardado ainda não chega para o Prompt Master: precisa do nome da empresa e de pelo menos o objetivo, a descrição, os produtos, o público ou a proposta de valor',
      vista: vistaDoRegisto(registo, { projeto }),
    };
  }
  const versao = (registo.masterHistorico || []).length + 1;
  const base = montarPromptMaster({ briefing, lead, projeto, versao });
  const ia = await masterComIA({ briefing, lead, projeto, base, motor, instrucao });
  const texto = ia.ok ? ia.texto : base;
  const novo = {
    id: idCurto('m'),
    texto,
    /* 1.54.4 · o que a IA afirmou sem apoio no briefing (vazio no caminho por regras) */
    avisos: ia.ok ? (ia.avisos || []) : [],
    via: ia.ok ? 'ia' : 'regras',
    modelo: ia.ok ? (ia.modelo || null) : null,
    fornec: ia.ok ? (ia.fornec || null) : null,
    motivo: ia.ok ? null : (ia.motivo || 'sem motor de IA'),
    ms: ia.ok ? ia.ms || 0 : 0,
    criado: agoraIso(),
    por: por || null,
    base: hashBriefing(briefing),
    versao,
    instrucao: limpo(instrucao).slice(0, 400) || null,
  };
  atrasarMaster(registo);
  registo.master = novo;
  evento(registo, `Prompt Master v${versao} ${ia.ok ? `escrito por ${ia.fornec || 'IA'}/${ia.modelo || '—'}` : `montado por regras (${novo.motivo})`}`, por);
  const g = await gravarRegisto(repo, arquivo, registo);
  if (!g.ok) return g;
  return { ok: true, master: novo, via: novo.via, motivo: novo.motivo, avisos: novo.avisos, vista: vistaDoRegisto(registo, { projeto }) };
}

function atrasarMaster(registo) {
  if (!registo.master) return;
  registo.masterHistorico = [
    { ...registo.master, substituidoEm: agoraIso() },
    ...(registo.masterHistorico || []).filter((m) => m.id !== registo.master.id),
  ].slice(0, MAX_VERSOES);
}

/** Os prompts de imagem a partir do briefing e do Prompt Master. */
export async function gerarImagens(repo, { projeto, lead = null, motor = null, por = null } = {}) {
  const ab = await abrirRegisto(repo, { projeto, lead });
  if (!ab.ok) return ab;
  const { registo, arquivo } = ab;
  const briefing = registo.briefing || briefingVazio();
  const minimo = minimoParaGerar(briefing);
  if (!minimo.ok) {
    return {
      ok: false, codigo: 'briefing-vazio',
      erro: 'os prompts de imagem precisam de um briefing com o nome da empresa e o que ela vende',
      vista: vistaDoRegisto(registo, { projeto }),
    };
  }
  const base = montarPromptsDeImagem({ briefing, lead, projeto });
  const ia = await imagensComIA({ briefing, lead, projeto, base, motor });
  const prompts = ia.ok ? ia.prompts : base;
  const novo = {
    id: idCurto('i'),
    prompts,
    via: ia.ok ? 'ia' : 'regras',
    modelo: ia.ok ? (ia.modelo || null) : null,
    fornec: ia.ok ? (ia.fornec || null) : null,
    motivo: ia.ok ? null : (ia.motivo || 'sem motor de IA'),
    criado: agoraIso(),
    por: por || null,
    base: hashBriefing(briefing),
    masterBase: registo.master?.id || null,
    nota: 'estes são prompts; nenhuma imagem é gerada nesta etapa',
  };
  if (registo.imagens) {
    registo.imagensHistorico = [
      { ...registo.imagens, substituidoEm: agoraIso() },
      ...(registo.imagensHistorico || []).filter((x) => x.id !== registo.imagens.id),
    ].slice(0, MAX_VERSOES);
  }
  registo.imagens = novo;
  evento(registo, `prompts de imagem ${ia.ok ? `escritos por ${ia.fornec || 'IA'}/${ia.modelo || '—'}` : `montados por regras (${novo.motivo})`}`, por);
  const g = await gravarRegisto(repo, arquivo, registo);
  if (!g.ok) return g;
  return { ok: true, imagens: novo, via: novo.via, motivo: novo.motivo, vista: vistaDoRegisto(registo, { projeto }) };
}

/** Põe uma versão anterior de volta no lugar da actual (sem apagar nada). */
export async function restaurarVersao(repo, { projeto, lead = null, tipo = 'master', id = '', por = null } = {}) {
  const ab = await abrirRegisto(repo, { projeto, lead });
  if (!ab.ok) return ab;
  const { registo, arquivo } = ab;
  const chaveHist = tipo === 'imagens' ? 'imagensHistorico' : 'masterHistorico';
  const achado = (registo[chaveHist] || []).find((x) => x.id === id);
  if (!achado) return { ok: false, codigo: 'semversao', erro: `não há essa versão em ${tipo} — vê as versões guardadas antes de repor` };
  const actual = tipo === 'imagens' ? registo.imagens : registo.master;
  const reposto = { ...achado, repostoEm: agoraIso(), repostoPor: por || null };
  /* a versão reposta deixa de ser «anterior» (passa a ser a actual) e a que
     estava no lugar entra no histórico: nenhuma das duas se perde */
  const restantes = (registo[chaveHist] || []).filter((x) => x.id !== achado.id && x.id !== actual?.id);
  registo[chaveHist] = (actual ? [{ ...actual, substituidoEm: agoraIso() }, ...restantes] : restantes).slice(0, MAX_VERSOES);
  if (tipo === 'imagens') registo.imagens = reposto;
  else registo.master = reposto;
  evento(registo, `versão anterior de ${tipo} reposta`, por);
  const g = await gravarRegisto(repo, arquivo, registo);
  if (!g.ok) return g;
  return { ok: true, vista: vistaDoRegisto(registo, { projeto }) };
}

/** A vista guardada, sem tocar em nada (leitura pura). */
export async function lerBriefing(repo, { projeto, lead = null } = {}) {
  const id = limpo(projeto?.id);
  if (!id) return { ok: false, codigo: 'semprejeto', erro: 'sem projeto não há briefing' };
  const arquivo = await lerArquivo(repo);
  const registo = arquivo.projetos[id] || null;
  if (!registo) {
    /* ainda não há registo: mostra o que a ficha sustenta, sem gravar nada */
    const semente = daLead(lead || {}, projeto);
    return {
      ok: true,
      vista: vistaDoRegisto({
        ...registoVazio(projeto, lead),
        briefing: { valores: semente.valores, origens: semente.origens, gravadoEm: null, por: null },
      }, { projeto }),
      semRegisto: true,
    };
  }
  return { ok: true, vista: vistaDoRegisto(registo, { projeto }) };
}
