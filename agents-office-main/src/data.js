// Órbita — o elenco fixo (35 lugares, 6 salas), o chão de cada sala e os tokens de design.
// Os textos de exemplo (WORKLINES), os pedidos de aprovação fictícios (APPROVAL_ASKS) e as linhas
// de demonstração por indústria (profile.js) saíram em 26 out 2026: o escritório passou a mostrar
// o trabalho que está na base de dados, por isso já não precisa de conteúdo de exemplo.

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
