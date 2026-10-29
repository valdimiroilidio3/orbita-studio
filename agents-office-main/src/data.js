// Órbita — o elenco fixo (35 lugares, 6 salas), a cor de cada sala e os tokens de design.
// Os textos de exemplo (WORKLINES), os pedidos de aprovação fictícios (APPROVAL_ASKS) e as linhas
// de demonstração por indústria (profile.js) saíram em 26 out 2026: o escritório passou a mostrar
// o trabalho que está na base de dados, por isso já não precisa de conteúdo de exemplo.
//
// Este ficheiro é PURO (sem three, sem DOM): o servidor também o lê (`serve.mjs`, `roster.mjs`).
// Quem deriva tons a partir destas cores é `src/palette.js`; quem desenha é `src/builders.js`.
// `officeProblems()`/`assertOffice()` dizem se alguma coisa aqui ficou incoerente — o escritório
// valida-se no arranque em vez de descobrir o erro a meio de um desenho.

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
// V7 (26 out 2026): o chão de cada sala é VIDRO — e o vidro tem a cor que o dono pediu.
// `chip` continua a ser a cor de marca (pastel: cartões, secretárias, avatares); `glass` é a
// mesma família, saturada, e é ela que pinta o chão e a banda de vidro das paredes. As seis
// famílias pedidas — vermelho, verde, azul, roxo, amarelo e azul céu — ficam assim repartidas
// uma por sala (o teste `office.test.mjs` verifica-o, matiz a matiz):
//
//   emails    COMANDO      verde     #1FA36B        ops     VENDAS   roxo     #8B5AD6
//   delivery  ENGENHARIA   azul céu  #41AEE4        fin     DESIGN   azul     #4A6DE0
//   sales     PROSPEÇÃO    amarelo   #E3B93A        marketing MEDIA  vermelho #DC5348
//
// O Cérebro fica com vidro fosco (neutro, de propósito): é o centro, e o centro não compete
// com as seis salas que o rodeiam.
export const DEPTS = {
  emails:    { name: 'COMANDO',           short: 'COMANDO',  chip: '#5ADEB7', ink: '#1E9070', glass: '#1FA36B', glassName: 'verde' },
  delivery:  { name: 'ENGENHARIA',         short: 'ENGENHARIA', chip: '#8FD3F4', ink: '#2E86AB', glass: '#41AEE4', glassName: 'azul céu' },
  sales:     { name: 'PROSPEÇÃO',            short: 'PROSPEÇÃO',   chip: '#EADC8F', ink: '#A08A1E', glass: '#E3B93A', glassName: 'amarelo' },
  marketing: { name: 'MEDIA',        short: 'MEDIA', chip: '#E69393', ink: '#C46060', glass: '#DC5348', glassName: 'vermelho' },
  fin:       { name: 'DESIGN LAB',          short: 'DESIGN', chip: '#98A5EF', ink: '#5B66CE', glass: '#4A6DE0', glassName: 'azul' },
  ops:       { name: 'VENDAS',       short: 'VENDAS', chip: '#BFA2E3', ink: '#7449A9', glass: '#8B5AD6', glassName: 'roxo' },
  brain:     { name: 'O CÉREBRO',        short: 'O CÉREBRO', chip: '#D1DECD', ink: '#4C7A57', glass: '#AEB6AB', glassName: 'neutro' },
};

// 35 agents (V3.4, 7 Sep 2026: every department has a lead). grid = [col,row] desk slot on the department plinth.
export const AGENTS = [
  // COMANDO (5)
  { id: 'elead', name: 'ORBITA DIRECTOR',            dept: 'emails',   lead: true,  grid: [0.5, 0], hair: '#2b2b2b', skin: '#E8B98E' },
  { id: 'imail', name: 'CHEFE DE GABINETE',          dept: 'emails',   grid: [0, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'report', name: 'ANALISTA DE RESULTADOS',     dept: 'emails',   grid: [1, 1], hair: '#2e2118', skin: '#E8B98E' },
  { id: 'dash', name: 'PAINEL CENTRAL',             dept: 'emails',   grid: [0, 2], hair: '#0d0d0d', skin: '#9C6B43' },
  { id: 'comply', name: 'PERMISSÕES E CONFORMIDADE',  dept: 'emails',   grid: [1, 2], hair: '#5a3a1a', skin: '#C68B59' },
  /* 1.53.0 · a sala cresceu uma fila: um lugar para o que chega e outro para o dia. */
  { id: 'atend',  name: 'ATENDIMENTO E TRIAGEM',        dept: 'emails',   grid: [0, 3], hair: '#2a1d14', skin: '#D89F70' },
  { id: 'plan',   name: 'PLANEAMENTO DO DIA',           dept: 'emails',   grid: [1, 3], hair: '#12100e', skin: '#F0C9A0' },
  // PROSPEÇÃO (6)
  { id: 'pros', name: 'LEAD HUNTER',                dept: 'sales',    lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E8B98E' },
  { id: 'enzo', name: 'ENRIQUECEDOR',               dept: 'sales',    grid: [0, 1], hair: '#1c1c2e', skin: '#E0A878' },
  { id: 'ilm',  name: 'QUALIFICADOR',               dept: 'sales',    grid: [1, 1], hair: '#26140a', skin: '#F5D5B0' },
  { id: 'riley', name: 'INTELIGÊNCIA DE MERCADO',    dept: 'sales',    grid: [0, 2], hair: '#8a4a1f', skin: '#F5D5B0' },
  { id: 'scout', name: 'ANÁLISE COMPETITIVA',        dept: 'sales',    grid: [1, 2], hair: '#101820', skin: '#B07850' },
  { id: 'vmail', name: 'AUDITOR DE WEBSITES',        dept: 'sales',    grid: [0, 3], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'radar', name: 'RADAR DE OPORTUNIDADES',      dept: 'sales',    grid: [1, 3], hair: '#1a1208', skin: '#C68B59' },
  { id: 'partners', name: 'PARCEIROS E ALIANÇAS',     dept: 'sales',    grid: [0.5, 4], hair: '#3a2a1c', skin: '#E8B98E' },
  // VENDAS (6)
  { id: 'olead', name: 'SALES CLOSER',               dept: 'ops',      lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'piper', name: 'PROPOSTAS',                  dept: 'ops',      grid: [0, 1], hair: '#2d1a0a', skin: '#F0C9A0' },
  { id: 'folo', name: 'SEGUIMENTOS',                dept: 'ops',      grid: [1, 1], hair: '#171717', skin: '#F5D5B0' },
  { id: 'ona',  name: 'RECEÇÃO DE CLIENTES',        dept: 'ops',      grid: [0, 2], hair: '#0d0d0d', skin: '#9C6B43' },
  { id: 'legal', name: 'CONTRATOS',                  dept: 'ops',      grid: [1, 2], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'cmail', name: 'COMUNICAÇÃO COM CLIENTES',   dept: 'ops',      grid: [0, 3], hair: '#3b2b1d', skin: '#F0C9A0' },
  { id: 'renew', name: 'RENOVAÇÕES',                  dept: 'ops',      grid: [1, 3], hair: '#1b1b24', skin: '#D9A97E' },
  { id: 'upsell', name: 'PACOTES E UPSELL',           dept: 'ops',      grid: [0.5, 4], hair: '#4a2a10', skin: '#F5D5B0' },
  // DESIGN LAB (4)
  { id: 'gfx',  name: 'CREATIVE ARCHITECT',         dept: 'fin',      lead: true,  grid: [0.5, 0], hair: '#141414', skin: '#F0C9A0' },
  { id: 'dasst', name: 'UI E DESIGN SYSTEM',         dept: 'fin',      grid: [0, 1], hair: '#552200', skin: '#F0C9A0' },
  { id: 'alead', name: 'DIREÇÃO DE ARTE',            dept: 'fin',      grid: [1, 1], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'invo', name: 'PESQUISA UX',                dept: 'fin',      grid: [0, 2], hair: '#4a2a10', skin: '#F5D5B0' },
  { id: 'motion', name: 'MOTION E ANIMAÇÃO',          dept: 'fin',      grid: [1, 2], hair: '#101820', skin: '#E0A878' },
  { id: 'brand', name: 'IDENTIDADE E MARCA',          dept: 'fin',      grid: [0.5, 3], hair: '#2b1a0c', skin: '#F5D5B0' },
  // ENGENHARIA (7)
  { id: 'dlead', name: 'SYSTEMS ENGINEER',           dept: 'delivery', lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0' },
  { id: 'pco',  name: 'GESTOR DE PROJETOS',         dept: 'delivery', grid: [0, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'qa',   name: 'QA E TESTES',                dept: 'delivery', grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'crep', name: 'FRONTEND',                   dept: 'delivery', grid: [0, 2], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'cass', name: 'BACKEND E INTEGRAÇÕES',      dept: 'delivery', grid: [1, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'apay', name: 'DEPLOYS E INFRA',            dept: 'delivery', grid: [0, 3], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'kmail', name: 'DOCUMENTAÇÃO TÉCNICA',       dept: 'delivery', grid: [1, 3], hair: '#4a2a10', skin: '#D89F70' },
  { id: 'sec',   name: 'SEGURANÇA E ACESSOS',         dept: 'delivery', grid: [0, 4], hair: '#0a0a0a', skin: '#C68B59' },
  { id: 'perf',  name: 'DESEMPENHO E CUSTOS',         dept: 'delivery', grid: [1, 4], hair: '#33221a', skin: '#F0C9A0' },
  // MEDIA (7)
  { id: 'mlead', name: 'GROWTH PUBLISHER',           dept: 'marketing', lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E0A878' },
  { id: 'newt', name: 'CONTEÚDO E NEWSLETTER',      dept: 'marketing', grid: [0, 1], hair: '#26140a', skin: '#D89F70' },
  { id: 'ada',  name: 'ANÚNCIOS META',              dept: 'marketing', grid: [1, 1], hair: '#3d2814', skin: '#C68B59' },
  { id: 'iggy', name: 'REDES SOCIAIS',              dept: 'marketing', grid: [0, 2], hair: '#552200', skin: '#E8B98E' },
  { id: 'vid',  name: 'VÍDEO',                      dept: 'marketing', grid: [1, 2], hair: '#1b1b24', skin: '#D9A97E' },
  { id: 'lexi', name: 'CALENDÁRIO EDITORIAL',       dept: 'marketing', grid: [0, 3], hair: '#5a2d0c', skin: '#F0C9A0' },
  { id: 'recon', name: 'ANALYTICS DE CONTEÚDO',      dept: 'marketing', grid: [1, 3], hair: '#33221a', skin: '#E8B98E' },
  { id: 'seo',   name: 'SEO E PESQUISA',              dept: 'marketing', grid: [0, 4], hair: '#1c1c2e', skin: '#D9A97E' },
  { id: 'mailmkt', name: 'EMAIL MARKETING',           dept: 'marketing', grid: [1, 4], hair: '#5a2d0c', skin: '#F5D5B0' },
];

// Plinth placement in world XZ. Brain central; departments well separated (AJ: not too close at zoom-out).
export const LAYOUT = {
  brain:     { pos: [0, 0],     w: 16, d: 16 },
  emails:    { pos: [-30, -23], w: 20, d: 32 },   // 1.53.0: 4 filas (entrou o atendimento e o plano do dia)
  delivery:  { pos: [0, -48],   w: 20, d: 40 },   // 1.53.0: 5 filas (segurança e desempenho)
  sales:     { pos: [30, -23],  w: 20, d: 40 },   // 1.53.0: 5 filas (radar e parceiros)
  marketing: { pos: [-30, 23],  w: 20, d: 40 },   // 1.53.0: 5 filas (SEO e email marketing)
  fin:       { pos: [30, 23],   w: 20, d: 32 },   // 1.53.0: 4 filas (motion e marca)
  ops:       { pos: [0, 48],    w: 20, d: 40 },   // 1.53.0: 5 filas (renovações e upsell)
};

/* ---------- onde assenta cada secretária (27 out 2026, 1.10.4) ----------
   Antes: `gz = (row-1)*6.4 - 1` — um número que não sabia o tamanho da sala. Funcionava nas salas
   de três filas; nas de QUATRO (marketing, delivery, e sales/ops que usam a linha 3) empurrava a
   última fila até ao bordo da frente, e a mesa do salão do adereço ficava debaixo das secretárias.
   O dono viu-o: «nas salas com 7 agentes a mesa no fim da sala ficou com uma apresentação feia».

   Agora as filas encostam à PAREDE DE FUNDO (`wallGap` da parede ao centro da primeira fila) e a
   FAIXA DA FRENTE fica reservada — é a área que a câmara vê e onde vive a entrada. A conta vive
   num sítio só porque a cena (`src/main.js`) e o revelador de salas (`tools/room.mjs`) têm de
   concordar; e `officeProblems()` passa a provar que sobra entrada em todas as salas. */
export const SEAT_GRID = {
  cols: 2,          // duas secretárias por fila
  colStep: 8.6,     // afastamento entre colunas
  rowStep: 6.4,     // afastamento entre filas (secretária 2,4 + cadeira + corredor)
  wallGap: 3.9,     // da parede de fundo ao centro da fila 0
  depth: 2.6,       // quanto uma fila ocupa para a frente (secretária + cadeira)
  entryBand: 6.0,   // faixa da frente que nenhuma fila pode comer
};
/** posição local (dentro do pod) de uma secretária: `grid` = [coluna, fila]. */
export function stationSpot(dept, grid) {
  const L = LAYOUT[dept];
  const x = (grid[0] - (SEAT_GRID.cols - 1) / 2) * SEAT_GRID.colStep;
  const z = -L.d / 2 + SEAT_GRID.wallGap + grid[1] * SEAT_GRID.rowStep;
  return { x, z };
}
/** z local mais à frente ocupado por uma secretária (com a cadeira) numa sala. */
export function deskFront(dept) {
  const L = LAYOUT[dept];
  let z = -L.d / 2;
  for (const a of AGENTS) if (a.dept === dept) z = Math.max(z, stationSpot(dept, a.grid).z + SEAT_GRID.depth);
  return z;
}

// Department billboard metrics (v1 rule #5: live metrics float above each dept,
// values tick green on change, "À espera de aprovação" pulses amber when > 0).

/* ---------- o escritório valida-se ----------
   A lição de 26 out 2026 (1.9.2): um erro num sítio pequeno apagou a cena inteira e o sintoma
   apareceu longe da causa. Esta função não desenha nada — só responde «os dados fazem sentido?»
   e diz o problema por palavras. O main.js chama-a no arranque e escreve o resultado na consola;
   `office.test.mjs` exige a lista vazia. */
const isHex = (c) => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

export function officeProblems() {
  const p = [];
  const keys = Object.keys(DEPTS);
  const pods = Object.keys(LAYOUT);

  for (const k of keys) {
    const d = DEPTS[k];
    if (!d.name || !d.short) p.push(`${k}: sem nome ou sem nome curto`);
    for (const f of ['chip', 'ink', 'glass']) if (!isHex(d[f])) p.push(`${k}: ${f} não é uma cor (#rgb/#rrggbb)`);
  }
  for (const k of pods) if (!DEPTS[k]) p.push(`LAYOUT tem ${k} e DEPTS não`);
  for (const k of keys) if (!LAYOUT[k]) p.push(`DEPTS tem ${k} e LAYOUT não`);
  if (pods.length !== keys.length) p.push(`LAYOUT tem ${pods.length} pods e DEPTS tem ${keys.length} salas`);

  const keSet = [...DEPT_KEYS].sort().join(',');
  const expect = pods.filter((k) => k !== 'brain').sort().join(',');
  if (keSet !== expect) p.push(`DEPT_KEYS (${keSet}) não é o LAYOUT sem o brain (${expect})`);

  const glasses = keys.map((k) => String(DEPTS[k].glass).toLowerCase());
  if (new Set(glasses).size !== glasses.length) p.push('duas salas com a mesma cor de vidro');

  const pos = new Set();
  for (const [k, L] of Object.entries(LAYOUT)) {
    if (!(L.w > 0 && L.d > 0)) p.push(`${k}: pod sem largura ou profundidade`);
    const at = L.pos.join(',');
    if (pos.has(at)) p.push(`${k}: dois pods no mesmo sítio (${at})`);
    pos.add(at);
  }

  const ids = new Set(), slots = new Map();
  for (const a of AGENTS) {
    if (ids.has(a.id)) p.push(`agente repetido: ${a.id}`);
    ids.add(a.id);
    if (!DEPTS[a.dept]) p.push(`${a.id}: sala desconhecida (${a.dept})`);
    if (a.dept === 'brain') p.push(`${a.id}: o Cérebro não tem secretárias`);
    const slot = `${a.dept}|${a.grid && a.grid.join(',')}`;
    if (slots.has(slot)) p.push(`${a.id}: a mesma secretária que ${slots.get(slot)} (${slot})`);
    slots.set(slot, a.id);
  }
  for (const k of DEPT_KEYS) {
    const here = AGENTS.filter((a) => a.dept === k);
    if (!here.length) p.push(`${k}: sala sem agentes`);
    if (here.filter((a) => a.lead).length !== 1) p.push(`${k}: tem de haver exactamente um chefe de sala`);
    // 1.10.4: as secretárias cabem na sala E deixam a faixa da frente para a entrada
    const L = LAYOUT[k];
    for (const a of here) {
      const at = stationSpot(k, a.grid);
      if (Math.abs(at.x) + 1.7 > L.w / 2) p.push(`${a.id}: a secretária sai pela parede lateral (${at.x})`);
      if (at.z + SEAT_GRID.depth > L.d / 2 - 0.6) p.push(`${a.id}: a secretária encosta ao bordo da frente (${at.z})`);
      if (at.z - SEAT_GRID.depth < -L.d / 2 + 0.4) p.push(`${a.id}: a secretária atravessa a parede de fundo (${at.z})`);
    }
    const front = deskFront(k);
    if (L.d / 2 - front < SEAT_GRID.entryBand) {
      p.push(`${k}: a última fila come a entrada (${(L.d / 2 - front).toFixed(1)} m livres, mínimo ${SEAT_GRID.entryBand})`);
    }
  }
  return p;
}

export function assertOffice() {
  const p = officeProblems();
  if (p.length) throw new Error('escritório inconsistente:\n  · ' + p.join('\n  · '));
  return true;
}
