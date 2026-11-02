/* ===========================================================================
   1.57.0 · A PÁGINA DO PROJETO — o que se pode calcular, num sítio só (2 nov 2026)

   O redesenho da página do projeto tem duas partes que NÃO são desenho: o
   progresso e o resumo da lead. Ambas têm de dizer a verdade do que está
   guardado. Por isso vivem aqui, em funções puras, e não no meio do HTML:

     · `progresso()` — as cinco etapas lidas do estado real (briefing gravado,
       Prompt Master escrito, peças de imagem e de vídeo concluídas, entrega).
       Uma etapa concluída vale 1, uma em andamento vale 0,5, pendente vale 0 —
       e a percentagem é a média, arredondada. Nada é fixo nem decorativo;

     · `resumoLead()` — origem, contacto, localização e data, com os valores
       que existem. O que falta fica «não informado», nunca inventado;

     · `iniciais()` — a marca do projeto (duas letras do nome), para o cabeçalho
       não depender de uma imagem que ninguém carregou.

   Nada aqui fala com a rede: é testável em Node e no browser sem duplos.
   =========================================================================== */

const limpo = (v) => String(v ?? '').trim();

/** Estados da mídia que contam como «feito» (ver `ESTADOS` em api/_media.mjs). */
const MEDIA_FEITA = ['concluida'];
const MEDIA_EM_CURSO = ['aguardando', 'em_processamento'];

const fmtData = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/\./g, '')
    .replace(/\s+de\s+/g, ' ');
};

/** As peças de um tipo, do mais recente para o mais antigo. */
const pecasDe = (media, tipo) => (media?.dados?.geracoes || []).filter((g) => g.tipo === tipo);

/**
 * O progresso do projeto, calculado a partir do que está guardado.
 *
 * `briefing` é o estado de `src/briefing.js` (B.dados.briefing.gravadoEm,
 * B.dados.master), `media` o de `src/media.js`. Quando ainda não chegaram, a
 * etapa diz «pendente» — não se assume progresso que ninguém provou.
 */
export function progresso({ projeto = null, briefing = null, media = null } = {}) {
  const d = briefing?.dados || null;
  const gravadoEm = d?.briefing?.gravadoEm || null;
  const master = d?.master || null;

  const imagem = pecasDe(media, 'imagem');
  const video = pecasDe(media, 'video');

  const estadoDePecas = (lista) => {
    if (lista.some((g) => MEDIA_FEITA.includes(g.estado))) return 'feito';
    if (lista.some((g) => MEDIA_EM_CURSO.includes(g.estado))) return 'activo';
    if (lista.length) return 'activo';
    return 'pendente';
  };

  const statusProjeto = limpo(projeto?.status);
  const entrega = statusProjeto === 'entregue' ? 'feito'
    : ['aprovado', 'qa_passou', 'aprovado_qa'].includes(statusProjeto) ? 'activo'
      : 'pendente';

  const etapas = [
    {
      id: 'briefing', nome: 'Briefing',
      estado: gravadoEm ? 'feito' : (Object.values(briefing?.valores || {}).some((v) => limpo(v)) ? 'activo' : 'pendente'),
      nota: gravadoEm ? fmtData(gravadoEm) : (briefing?.sujo ? 'alterações por gravar' : null),
    },
    {
      id: 'master', nome: 'Prompt Master',
      estado: master ? 'feito' : (gravadoEm ? 'activo' : 'pendente'),
      nota: master ? `versão ${master.versao || 1}` : (gravadoEm ? 'à espera de ser escrito' : null),
    },
    { id: 'imagens', nome: 'Imagens (IA)', estado: estadoDePecas(imagem), nota: imagem.length ? `${imagem.length} peça(s)` : null },
    { id: 'video', nome: 'Vídeo (cinemático)', estado: estadoDePecas(video), nota: video.length ? `${video.length} peça(s)` : null },
    {
      id: 'entrega', nome: 'Entrega final', estado: entrega,
      nota: statusProjeto === 'entregue' ? 'entregue' : entrega === 'activo' ? 'aprovado, por entregar' : null,
    },
  ];

  const pontos = etapas.reduce((n, e) => n + (e.estado === 'feito' ? 1 : e.estado === 'activo' ? 0.5 : 0), 0);
  const pct = Math.round((pontos / etapas.length) * 100);
  return { pct, feitas: etapas.filter((e) => e.estado === 'feito').length, etapas };
}

/** A origem da lead como se lê, sem inventar um fornecedor que não está escrito. */
export function origemLegivel(source) {
  const s = limpo(source).toLowerCase();
  if (!s) return 'não informada';
  const mapa = {
    geoapify: 'Geoapify (pesquisa de empresas)',
    google: 'Google Maps',
    google_maps: 'Google Maps',
    tavily: 'Tavily',
    manual: 'escrita à mão',
    csv: 'importada de CSV',
    site: 'formulário do site',
  };
  return mapa[s] || limpo(source);
}

/**
 * O resumo da lead, linha a linha. Cada valor vem do que está guardado; os
 * links (`tel:`, `mailto:`) só existem quando o valor serve para ligar.
 */
export function resumoLead(lead = null) {
  if (!lead) {
    return {
      existe: false,
      linhas: [],
      nota: 'Este projeto não tem lead ligada. O briefing começa em branco e nada é copiado de outro sítio.',
    };
  }
  const telefone = limpo(lead.phone);
  const email = limpo(lead.email);
  const nome = limpo(lead.name) || 'sem nome';
  const cidade = limpo(lead.city);
  const categoria = limpo(lead.category);

  const linhas = [
    { chave: 'origem', label: 'Origem', valor: origemLegivel(lead.source), copiavel: false },
    {
      chave: 'contacto', label: 'Contacto',
      valor: telefone || email || 'não informado',
      href: telefone ? `tel:${telefone.replace(/[^\d+]/g, '')}` : (email ? `mailto:${email}` : null),
      copiavel: !!(telefone || email),
    },
    ...(telefone && email ? [{ chave: 'email', label: 'Email', valor: email, href: `mailto:${email}`, copiavel: true }] : []),
    { chave: 'local', label: 'Localização', valor: [cidade, categoria].filter(Boolean).join(' · ') || 'não informada', copiavel: false },
    { chave: 'data', label: 'Data da lead', valor: fmtData(lead.created_at) || 'não informada', copiavel: false },
  ];

  return { existe: true, nome, linhas, nota: null };
}

/** Duas letras para a marca do projeto — «Clínica Aurora» → «CA». */
export function iniciais(nome) {
  const palavras = limpo(nome).split(/\s+/).filter((p) => p.length > 1);
  if (!palavras.length) return '?';
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase();
}

/** As abas do projeto, na ordem. `master` e `imagens` são do briefing; `video` é mídia. */
export const ABAS_PROJETO = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'master', label: 'Prompt Master' },
  { id: 'imagens', label: 'Imagens' },
  { id: 'video', label: 'Vídeo' },
];

export const abaValida = (id) => ABAS_PROJETO.some((a) => a.id === id) ? id : 'briefing';
