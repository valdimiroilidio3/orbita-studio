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
  emails:    { name: 'E-MAILS',           short: 'E-MAILS',  chip: '#5ADEB7', ink: '#1E9070', floor: '#E9F6EF' },
  delivery:  { name: 'ENTREGAS',         short: 'ENTREGAS', chip: '#8FD3F4', ink: '#2E86AB', floor: '#E6F4FB' },
  sales:     { name: 'VENDAS',            short: 'VENDAS',   chip: '#EADC8F', ink: '#A08A1E', floor: '#F6F1DA' },
  marketing: { name: 'MARKETING',        short: 'MARKETING', chip: '#E69393', ink: '#C46060', floor: '#FAE9E7' },
  fin:       { name: 'FINANÇAS',          short: 'FINANÇAS', chip: '#98A5EF', ink: '#5B66CE', floor: '#EAEDFA' },
  ops:       { name: 'OPERAÇÕES',       short: 'OPERAÇÕES', chip: '#BFA2E3', ink: '#7449A9', floor: '#F2ECFA' },
  brain:     { name: 'O CÉREBRO',        short: 'O CÉREBRO', chip: '#D1DECD', ink: '#4C7A57', floor: '#E9EFE4' },
};

// 35 agents (V3.4, 7 Sep 2026: every department has a lead). grid = [col,row] desk slot on the department plinth.
export const AGENTS = [
  // EMAILS (5) — replaced Customer Support, 5 Sep 2026
  { id: 'elead', name: 'LÍDER DE E-MAILS',         dept: 'emails',    lead: true,  grid: [0.5, 0], hair: '#2b2b2b', skin: '#E8B98E' },
  { id: 'cmail', name: 'E-MAILS DE CLIENTES',       dept: 'emails',    grid: [0, 1], hair: '#3b2b1d', skin: '#F0C9A0' },
  { id: 'imail', name: 'E-MAILS INTERNOS',     dept: 'emails',    grid: [1, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'vmail', name: 'E-MAILS DE FORNECEDORES',       dept: 'emails',    grid: [0, 2], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'kmail', name: 'E-MAILS DE FREELANCERS',   dept: 'emails',    grid: [1, 2], hair: '#4a2a10', skin: '#D89F70' },
  // SALES (6) — Sales Lead at the head; Proposals moved in from Operations, Outreach retired
  { id: 'lexi',  name: 'LÍDER DE VENDAS',          dept: 'sales',     lead: true,  grid: [0.5, 0], hair: '#5a2d0c', skin: '#F0C9A0' },
  { id: 'enzo',  name: 'ENRIQUECEDOR DE LEADS',       dept: 'sales',     grid: [0, 1], hair: '#1c1c2e', skin: '#E0A878' },
  { id: 'ilm',   name: 'GESTOR DE LEADS RECEBIDOS', dept: 'sales',   grid: [1, 1], hair: '#26140a', skin: '#F5D5B0' },
  { id: 'pros',  name: 'PROSPETOR',          dept: 'sales',     grid: [0, 2], hair: '#2a1a0e', skin: '#E8B98E' },
  { id: 'piper', name: 'PROPOSTAS',           dept: 'sales',     grid: [1, 2], hair: '#2d1a0a', skin: '#F0C9A0' },
  { id: 'folo',  name: 'SEGUIMENTOS',          dept: 'sales',     grid: [0.5, 3], hair: '#171717', skin: '#F5D5B0' },
  // MARKETING (7) — Marketing Lead at the head since 7 Sep 2026
  { id: 'mlead', name: 'LÍDER DE MARKETING',      dept: 'marketing', lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E0A878' },
  { id: 'riley', name: 'INVESTIGAÇÃO',            dept: 'marketing', grid: [0, 1], hair: '#8a4a1f', skin: '#F5D5B0' },
  { id: 'newt',  name: 'NEWSLETTER',          dept: 'marketing', grid: [1, 1], hair: '#26140a', skin: '#D89F70' },
  { id: 'gfx',   name: 'DESIGNER GRÁFICO',   dept: 'marketing', grid: [0, 2], hair: '#141414', skin: '#F0C9A0' },
  { id: 'ada',   name: 'ANÚNCIOS META',            dept: 'marketing', grid: [1, 2], hair: '#3d2814', skin: '#C68B59' },
  { id: 'iggy',  name: 'INSTAGRAM ORGÂNICO',   dept: 'marketing', grid: [0, 3], hair: '#552200', skin: '#E8B98E' },
  { id: 'vid',   name: 'EDITOR DE VÍDEO',        dept: 'marketing', grid: [1, 3], hair: '#1b1b24', skin: '#D9A97E' },
  // OPERATIONS (6) — Operations Lead at the head since 7 Sep 2026; Internal Dashboards joins; Proposals moved to Sales
  { id: 'olead', name: 'LÍDER DE OPERAÇÕES',     dept: 'ops',       lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'scout', name: 'ANÁLISE',               dept: 'ops',       grid: [0, 1], hair: '#101820', skin: '#B07850' },
  { id: 'legal', name: 'REVISÃO JURÍDICA',        dept: 'ops',       grid: [1, 1], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'comply', name: 'VERIFICADOR DE CONFORMIDADE', dept: 'ops',       grid: [0, 2], hair: '#5a3a1a', skin: '#C68B59' },
  { id: 'report', name: 'RELATÓRIOS INTERNOS', dept: 'ops',       grid: [1, 2], hair: '#2e2118', skin: '#E8B98E' },
  { id: 'dash',  name: 'PAINÉIS INTERNOS', dept: 'ops',       grid: [0.5, 3], hair: '#0d0d0d', skin: '#9C6B43' },
  // FINANCE (4) — the accounting team; Accounting Lead at the head
  { id: 'alead', name: 'LÍDER DE CONTABILIDADE',     dept: 'fin',       lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'invo',  name: 'FATURAÇÃO',           dept: 'fin',       grid: [0, 1], hair: '#4a2a10', skin: '#F5D5B0' },
  { id: 'apay',  name: 'CONTAS A PAGAR',    dept: 'fin',       grid: [1, 1], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'recon', name: 'RECONCILIAÇÃO',      dept: 'fin',       grid: [0.5, 2], hair: '#33221a', skin: '#E8B98E' },
  // DELIVERY (7) — new pod, 5 Sep 2026; Onboarder moved in from Sales
  { id: 'dlead', name: 'LÍDER DE ENTREGAS',       dept: 'delivery',  lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0' },
  { id: 'pco',   name: 'COORDENADOR DE PROJETOS', dept: 'delivery', grid: [0, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'qa',    name: 'VERIFICADOR DE QUALIDADE', dept: 'delivery', grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'crep',  name: 'RELATÓRIOS DE CLIENTES',      dept: 'delivery',  grid: [0, 2], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'cass',  name: 'RECURSOS DE CLIENTES',       dept: 'delivery',  grid: [1, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'dasst', name: 'ASSISTENTE DE DESIGN',  dept: 'delivery',  grid: [0, 3], hair: '#552200', skin: '#F0C9A0' },
  { id: 'ona',   name: 'RECEÇÃO DE CLIENTES',           dept: 'delivery',  grid: [1, 3], hair: '#0d0d0d', skin: '#9C6B43' },
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
  emails:    [{ id: 'emails',    label: 'E-MAILS ENVIADOS',      val: 128 }],
  delivery:  [{ id: 'reports',   label: 'RELATÓRIOS ENVIADOS',     val: 9 }],
  sales:     [{ id: 'leads',     label: 'LEADS ENRIQUECIDOS',   val: 47 },
              { id: 'callhrs',   label: 'HORAS DE CHAMADA ROTEADAS',  val: 9.5, fmt: v => v.toFixed(1) + 'h', step: 0.4 }],
  marketing: [{ id: 'adspend',   label: 'GASTO EM ANÚNCIOS HOJE',   val: 684, fmt: v => '$' + Math.round(v).toLocaleString('en-NZ'), step: 12 }],
  ops:       [{ id: 'proposals', label: 'PROPOSTAS ENVIADAS',   val: 6 }],
  fin:       [{ id: 'invoices',  label: 'FATURAS EMITIDAS', val: 23 }],
  brain:     [{ id: 'notes',     label: 'NOTAS INDEXADAS',    val: 1204, fmt: v => Math.round(v).toLocaleString('en-NZ') }],
};

// Approval asks (agent requests → AJ decides; v1 flavour).
// Per-agent first so the ask matches who's asking; dept pool is the fallback.
export const APPROVAL_ASKS = {
  emails:    ['Enviar o aviso de aumento de preços a 120 clientes — rascunho em anexo', 'Responder ao caso do freelancer — rascunho em anexo'],
  delivery:  ['Enviar o pacote de relatórios de setembro a 14 clientes', 'Libertar os recursos de marca para o portal do cliente'],
  sales:     ['Enviar SMS de reativação a 214 leads frios', 'Passar 8 leads empresariais para a fila do SPENCER'],
  marketing: ['Lançar 4 variantes de anúncios Meta — orçamento de 120 $/dia', 'Publicar o reel «a matemática da chamada fria» no Instagram'],
  ops:       ['Enviar a proposta em PDF à Ridgeline Property Group', 'Aprovar o contrato revisto da Kea Logistics — 2 cláusulas assinaladas'],
  fin:       ['A fatura n.º 218 não bate com o contrato — segurar para revisão?', 'Anular 180 $ de taxas de cartão não conciliadas'],
};
export const APPROVAL_BY_AGENT = {
  cmail: 'Enviar o aviso de aumento de preços a 120 clientes — rascunho em anexo',
  vmail: 'Aceitar o SLA revisto do fornecedor — 2 alterações assinaladas',
  crep:  'Enviar o pacote de setembro a 14 clientes — 2 assinalados para chamada',
  qa:    'Aprovar a entrega do site — 2 problemas menores anotados',
  dlead: 'Prolongar o projeto Ridgeline por uma semana — o cliente pediu',
  apay:  'A fatura do freelancer n.º 218 está 350 $ acima do contrato — segurar o pagamento e questionar?',
  piper: 'Enviar a proposta à Ridgeline Property Group — 12 licenças, plano Growth',
  iggy:  'Publicar o reel «a regra das 10h» no Instagram — guião em anexo',
  vid:   'Entregar o corte de demonstração de 45 s — legendas gravadas, v2 em anexo',
  ada:   'Escalar o criativo «ansiedade da chamada fria» para 180 $/dia — CPA 29 $',
  mlead: 'Aprovar o plano de conteúdo de outubro — 12 reels, 2 newsletters, 1 renovação de anúncios',
  olead: 'Aprovar a lista de operações do 4.º trimestre — 3 renovações de fornecedores dentro',
  newt:  'Enviar a newsletter de agosto a 3 400 subscritores — rascunho v3 em anexo',
  scout: 'Dar luz verde à jogada de comparação com a CallForge — memorando em anexo',
  enzo:  'Comprar 500 créditos FullEnrich — o lote atual acaba amanhã',
};

// Fake terminal lines for the desk screens (per-dept flavour), matching v1's chat voice.
export const WORKLINES = {
  emails: [
    '▸ a escrever resposta — dúvida de âmbito do cliente',
    '▸ conversa com fornecedor: revisão do SLA resumida',
    '▸ 14 e-mails internos triados · 3 para o AJ',
    '▸ dúvida da fatura do freelancer respondida',
  ],
  delivery: [
    '▸ relatório de cliente: pacote de setembro 9/14',
    '▸ controlo de qualidade: entrega do site · 2 notas',
    '▸ biblioteca de recursos sincronizada → portal do cliente',
    '▸ plano do projeto: 3 marcos movidos',
  ],
  sales: [
    '▸ a enriquecer contacto — Summit HVAC',
    '▸ 6 leads encaminhados → ARWIN (4,2 h em fila)',
    '▸ 32 potenciais clientes verificados · 91% válidos',
    '▸ mensagem de boas-vindas enviada — Bay Plumbing',
  ],
  marketing: [
    '▸ drafting reel hook v3 — "cold call maths"',
    '▸ anúncios Meta: 4 variantes → revisão',
    '▸ bloco 2/5 da newsletter escrito',
    '▸ exportação do kit de marca: story + quadrado',
    '▸ a renderizar o reel v2 — legendas + b-roll',
  ],
  ops: [
    '▸ proposta em PDF criada — Ridgeline Group',
    '▸ varrimento da concorrência: página de preços da DialAxis',
    '▸ cláusula 7.2 do contrato assinalada — limite de responsabilidade',
    '▸ página do WorkSafe AU mudou · a comparar',
    '▸ relatório semanal: 4/6 secções prontas',
  ],
  fin: [
    '▸ a reconciliar 14 pagamentos · 2 assinalados',
    '▸ fatura n.º 218 vs contrato — desvio de valor assinalado',
    '▸ fatura emitida — Summit HVAC 840 $',
    '▸ lembrete 2/3 enviado — Alpine Freight',
  ],
  brain: [
    '▸ a indexar o cofre — 1 204 notas',
    '▸ a responder à ANÁLISE — coorte de churn',
    '▸ reunião marcada: enzo × tess',
  ],
};

// INDUSTRY PROFILE (12 Sep 2026): a per-industry demo file rewrites pods, seats, rows, asks and screen lines in place. No-op without window.PROFILE.
applyData({ DEPTS, AGENTS, BILLBOARDS, APPROVAL_ASKS, APPROVAL_BY_AGENT, WORKLINES });
