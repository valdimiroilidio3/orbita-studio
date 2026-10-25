// Órbita v2 — roster + design tokens (ported from v1 command-centre.html)
import { applyData } from './profile.js';

// Nominal.so tokens (locked design language, 30 Jul 2026)
export const TOKENS = {
  cream: '#FDFFF8',
  ink: '#151414',
  grey: '#5A5A5A',
  hairline: 'rgba(21,20,20,0.12)',
};

// Dept mapping: Support→mint, Sales→butter, Marketing→coral, Finance→periwinkle,
// Operations→violet, Brain→sage.
// NOTE (17 Aug 2026): the old 'ops' pod split in two. The accounting half kept the pod,
// the periwinkle palette and the key 'fin' (now FINANCE); Proposals + Intel moved out into
// a new 'ops' pod (OPERATIONS) alongside Legal Review, Compliance and Internal Reporting.
// V3.1 (5 Sep 2026, AJ): SUPPORT → EMAILS (same mint slot), new DELIVERY pod (sky) on the top axis.
export const DEPT_KEYS = ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery'];
export const DEPTS = {
  emails:    { name: 'COMANDO',           short: 'COMANDO',  chip: '#5ADEB7', ink: '#1E9070', floor: '#E9F6EF' },
  delivery:  { name: 'ENGENHARIA',         short: 'ENGENHARIA', chip: '#8FD3F4', ink: '#2E86AB', floor: '#E6F4FB' },
  sales:     { name: 'PROSPEÇÃO',            short: 'PROSPEÇÃO',   chip: '#EADC8F', ink: '#A08A1E', floor: '#F6F1DA' },
  marketing: { name: 'MEDIA',        short: 'MEDIA', chip: '#E69393', ink: '#C46060', floor: '#FAE9E7' },
  fin:       { name: 'DESIGN LAB',          short: 'DESIGN', chip: '#98A5EF', ink: '#5B66CE', floor: '#EAEDFA' },
  ops:       { name: 'VENDAS',       short: 'VENDAS', chip: '#BFA2E3', ink: '#7449A9', floor: '#F2ECFA' },
  brain:     { name: 'O CÉREBRO',        short: 'O CÉREBRO', chip: '#D1DECD', ink: '#4C7A57', floor: '#E9EFE4' },
};

// 35 agents (V3.4, 7 Sep 2026: every department has a lead). grid = [col,row] desk slot on the department plinth.
export const AGENTS = [
  // COMANDO (5)
  { id: 'elead', name: 'ORBITA DIRECTOR',            dept: 'emails',   lead: true,  grid: [0.5, 0], hair: '#2b2b2b', skin: '#E8B98E' },
  { id: 'imail', name: 'CHEFE DE GABINETE',          dept: 'emails',   grid: [0, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'report', name: 'ANALISTA DE RESULTADOS',     dept: 'emails',   grid: [1, 1], hair: '#2e2118', skin: '#E8B98E' },
  { id: 'dash', name: 'PAINEL CENTRAL',             dept: 'emails',   grid: [0, 2], hair: '#0d0d0d', skin: '#9C6B43' },
  { id: 'comply', name: 'PERMISSÕES E CONFORMIDADE',  dept: 'emails',   grid: [1, 2], hair: '#5a3a1a', skin: '#C68B59' },
  // PROSPEÇÃO (6)
  { id: 'pros', name: 'LEAD HUNTER',                dept: 'sales',    lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E8B98E' },
  { id: 'enzo', name: 'ENRIQUECEDOR',               dept: 'sales',    grid: [0, 1], hair: '#1c1c2e', skin: '#E0A878' },
  { id: 'ilm',  name: 'QUALIFICADOR',               dept: 'sales',    grid: [1, 1], hair: '#26140a', skin: '#F5D5B0' },
  { id: 'riley', name: 'INTELIGÊNCIA DE MERCADO',    dept: 'sales',    grid: [0, 2], hair: '#8a4a1f', skin: '#F5D5B0' },
  { id: 'scout', name: 'ANÁLISE COMPETITIVA',        dept: 'sales',    grid: [1, 2], hair: '#101820', skin: '#B07850' },
  { id: 'vmail', name: 'AUDITOR DE WEBSITES',        dept: 'sales',    grid: [0, 3], hair: '#7a3b12', skin: '#F5D5B0' },
  // VENDAS (6)
  { id: 'olead', name: 'SALES CLOSER',               dept: 'ops',      lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'piper', name: 'PROPOSTAS',                  dept: 'ops',      grid: [0, 1], hair: '#2d1a0a', skin: '#F0C9A0' },
  { id: 'folo', name: 'SEGUIMENTOS',                dept: 'ops',      grid: [1, 1], hair: '#171717', skin: '#F5D5B0' },
  { id: 'ona',  name: 'RECEÇÃO DE CLIENTES',        dept: 'ops',      grid: [0, 2], hair: '#0d0d0d', skin: '#9C6B43' },
  { id: 'legal', name: 'CONTRATOS',                  dept: 'ops',      grid: [1, 2], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'cmail', name: 'COMUNICAÇÃO COM CLIENTES',   dept: 'ops',      grid: [0, 3], hair: '#3b2b1d', skin: '#F0C9A0' },
  // DESIGN LAB (4)
  { id: 'gfx',  name: 'CREATIVE ARCHITECT',         dept: 'fin',      lead: true,  grid: [0.5, 0], hair: '#141414', skin: '#F0C9A0' },
  { id: 'dasst', name: 'UI E DESIGN SYSTEM',         dept: 'fin',      grid: [0, 1], hair: '#552200', skin: '#F0C9A0' },
  { id: 'alead', name: 'DIREÇÃO DE ARTE',            dept: 'fin',      grid: [1, 1], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'invo', name: 'PESQUISA UX',                dept: 'fin',      grid: [0, 2], hair: '#4a2a10', skin: '#F5D5B0' },
  // ENGENHARIA (7)
  { id: 'dlead', name: 'SYSTEMS ENGINEER',           dept: 'delivery', lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0' },
  { id: 'pco',  name: 'GESTOR DE PROJETOS',         dept: 'delivery', grid: [0, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'qa',   name: 'QA E TESTES',                dept: 'delivery', grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'crep', name: 'FRONTEND',                   dept: 'delivery', grid: [0, 2], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'cass', name: 'BACKEND E INTEGRAÇÕES',      dept: 'delivery', grid: [1, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'apay', name: 'DEPLOYS E INFRA',            dept: 'delivery', grid: [0, 3], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'kmail', name: 'DOCUMENTAÇÃO TÉCNICA',       dept: 'delivery', grid: [1, 3], hair: '#4a2a10', skin: '#D89F70' },
  // MEDIA (7)
  { id: 'mlead', name: 'GROWTH PUBLISHER',           dept: 'marketing', lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E0A878' },
  { id: 'newt', name: 'CONTEÚDO E NEWSLETTER',      dept: 'marketing', grid: [0, 1], hair: '#26140a', skin: '#D89F70' },
  { id: 'ada',  name: 'ANÚNCIOS META',              dept: 'marketing', grid: [1, 1], hair: '#3d2814', skin: '#C68B59' },
  { id: 'iggy', name: 'REDES SOCIAIS',              dept: 'marketing', grid: [0, 2], hair: '#552200', skin: '#E8B98E' },
  { id: 'vid',  name: 'VÍDEO',                      dept: 'marketing', grid: [1, 2], hair: '#1b1b24', skin: '#D9A97E' },
  { id: 'lexi', name: 'CALENDÁRIO EDITORIAL',       dept: 'marketing', grid: [0, 3], hair: '#5a2d0c', skin: '#F0C9A0' },
  { id: 'recon', name: 'ANALYTICS DE CONTEÚDO',      dept: 'marketing', grid: [1, 3], hair: '#33221a', skin: '#E8B98E' },
];

// Plinth placement in world XZ. Brain central; departments well separated (AJ: not too close at zoom-out).
export const LAYOUT = {
  brain:     { pos: [0, 0],     w: 16, d: 16 },
  emails:    { pos: [-30, -23], w: 20, d: 26 },
  delivery:  { pos: [0, -48],   w: 20, d: 30 },   // 6th pod mirrors ops on the top axis
  sales:     { pos: [30, -23],  w: 20, d: 30 },
  marketing: { pos: [-30, 23],  w: 20, d: 30 },
  fin:       { pos: [30, 23],   w: 20, d: 26 },
  ops:       { pos: [0, 48],    w: 20, d: 30 },   // the 5th pod fills the empty bottom-left gap
};

// Department billboard metrics (v1 rule #5: live metrics float above each dept,
// values tick green on change, "À espera de aprovação" pulses amber when > 0).
export const BILLBOARDS = {
  emails:    [{ id: 'tarefas',     label: 'TAREFAS ATRIBUÍDAS',      val: 128 }],
  sales:     [{ id: 'leads',       label: 'LEADS QUALIFICADOS',      val: 47 },
              { id: 'sites',       label: 'SITES DIAGNOSTICADOS',    val: 31 }],
  ops:       [{ id: 'propostas',   label: 'PROPOSTAS ENVIADAS',      val: 6 }],
  fin:       [{ id: 'ecras',       label: 'ECRÃS DESENHADOS',        val: 23 }],
  delivery:  [{ id: 'projetos',    label: 'PROJETOS NO AR',          val: 9 }],
  marketing: [{ id: 'publicacoes', label: 'PUBLICAÇÕES APROVADAS',   val: 14 }],
  brain:     [{ id: 'notes',       label: 'NOTAS INDEXADAS',         val: 1204, fmt: v => Math.round(v).toLocaleString('pt-PT') }],
};

// Approval asks (agent requests → AJ decides; v1 flavour).
// Per-agent first so the ask matches who's asking; dept pool is the fallback.
export const APPROVAL_ASKS = {
  emails:    ['Enviar o resumo semanal da empresa a toda a equipa — rascunho em anexo', 'Dar OK aos 4 envios que ficaram retidos hoje'],
  sales:     ['Enviar a lista de 40 leads ao Sales Closer — pontuação em anexo', 'Autorizar a compra de 500 créditos de enriquecimento'],
  ops:       ['Enviar a proposta em PDF à Ridgeline Property Group', 'Aprovar o contrato revisto da Kea Logistics — 2 cláusulas assinaladas'],
  fin:       ['Fechar o design system da Ridgeline — 4 ecrãs em revisão', 'Aprovar os mockups para a apresentação de amanhã'],
  delivery:  ['Publicar o site da Kea Logistics no domínio do cliente', 'Aprovar a entrega — 2 notas menores por resolver'],
  marketing: ['Publicar 4 peças no Instagram e LinkedIn esta semana', 'Lançar 4 variantes de anúncios Meta — orçamento de 120 $/dia'],
};
export const APPROVAL_BY_AGENT = {
  cmail: 'Responder à Kea Logistics sobre o novo prazo — rascunho em anexo',
  olead: 'Enviar a proposta à Ridgeline Property Group — 12 páginas, plano Growth',
  piper: 'Enviar a proposta à Ridgeline Property Group — 3 opções, a do meio recomendada',
  folo:  'Enviar o segundo contacto a 8 propostas sem resposta — texto único, personalizado',
  ona:   'Dar as boas-vindas à Summit HVAC com acessos e datas — mensagem em anexo',
  legal: 'Aceitar os termos revistos da Kea Logistics — 2 cláusulas assinaladas',
  pros:  'Entregar a lista de 40 leads ao Sales Closer — diagnóstico de site incluído',
  vmail: 'Enviar o diagnóstico dos 15 sites ao Sales Closer — 6 sem HTTPS',
  ilm:   'Marcar 3 reuniões de descoberta — horários propostos em anexo',
  enzo:  'Comprar 500 créditos de enriquecimento — o lote atual acaba amanhã',
  qa:    'Aprovar a entrega do site — 2 notas menores anotadas',
  dlead: 'Prolongar o projeto Ridgeline por uma semana — o cliente pediu',
  apay:  'Publicar a versão aprovada no domínio do cliente',
  kmail: 'Arquivar a documentação do projeto no Cérebro — 2 ficheiros',
  cass:  'Ligar os pagamentos Stripe ao projeto da Kea Logistics',
  gfx:   'Fechar a direção visual do site da Ridgeline — 3 conceitos em anexo',
  iggy:  'Publicar o vídeo de demonstração no Instagram — legendas incluídas',
  vid:   'Entregar o corte de demonstração de 45 s — legendas gravadas, v2 em anexo',
  ada:   'Escalar o anúncio vencedor para 180 $/dia — CPA 29 $',
  mlead: 'Aprovar o plano editorial de outubro — 12 publicações, 2 newsletters',
  newt:  'Enviar a newsletter do mês a 3 400 subscritores — rascunho v3 em anexo',
  scout: 'Dar luz verde à comparação pública com a CallForge — memorando em anexo',
  recon: 'Publicar o relatório de conteúdo do mês — 12 leads atribuídos',
  comply:'Autorizar os 4 envios retidos — consentimento verificado em 3 de 4',
};

// Fake terminal lines for the desk screens (per-dept flavour), matching v1's chat voice.
export const WORKLINES = {
  emails: [
    '▸ a rever prioridades — 3 tarefas atrasadas',
    '▸ painel central atualizado · 5 blocos ligados ao Cérebro',
    '▸ 4 entregas à espera do OK do proprietário',
    '▸ relatório de estado: números consolidados',
  ],
  sales: [
    '▸ a varrer o Google Maps — 22 empresas sem site',
    '▸ presença digital analisada · 6 sites sem HTTPS',
    '▸ 40 leads pontuados face ao ICP · 12 duplicados removidos',
    '▸ lista entregue ao Sales Closer',
  ],
  ops: [
    '▸ a preparar abordagem — Ridgeline Property Group',
    '▸ objeção respondida: prazo e âmbito',
    '▸ 2 reuniões marcadas para quinta',
    '▸ proposta em PDF criada — 3 opções',
  ],
  fin: [
    '▸ briefing lido — problema, público e ação',
    '▸ estrutura e navegação definidas · 5 ecrãs',
    '▸ design system: 12 componentes fechados',
    '▸ especificações entregues à Engenharia',
  ],
  delivery: [
    '▸ a construir a página inicial — fiel ao design',
    '▸ formulário ligado ao CRM · teste a passar',
    '▸ QA: telemóvel e computador · 4 notas',
    '▸ a publicar no domínio do cliente',
  ],
  marketing: [
    '▸ calendário editorial da semana fechado',
    '▸ caso de estudo escrito com números reais',
    '▸ vídeo montado · legendas gravadas',
    '▸ alcance e leads do mês medidos',
  ],
  brain: [
    '▸ a indexar o Cérebro — 1 204 notas',
    '▸ a responder à ANÁLISE — nota de mercado',
    '▸ reunião registada: LEAD HUNTER × SALES CLOSER',
  ],
};

// INDUSTRY PROFILE (12 Sep 2026): a per-industry demo file rewrites pods, seats, rows, asks and screen lines in place. No-op without window.PROFILE.
applyData({ DEPTS, AGENTS, BILLBOARDS, APPROVAL_ASKS, APPROVAL_BY_AGENT, WORKLINES });
