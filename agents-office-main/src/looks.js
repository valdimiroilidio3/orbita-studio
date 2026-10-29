// Órbita — OS AVATARES (27 out 2026, 1.10.0 · 47 em 1.53.0).
//
// Pedido 27+: «melhore o avatar, coloca uma vibe mais pessoa real com roupa formal, mas cada sala
// mantém a coloração da roupa; cabelo diferente para cada agente (35), alguns com chapéu, alguns
// serão mulheres».
//
// Este ficheiro decide QUEM é cada pessoa — e é puro (sem three, sem DOM), por isso a mesa de
// desenho (`src/avatar.js`) e os testes podem ler a mesma verdade.
//
// Regras:
//   · **35 assinaturas distintas.** Não 35 sortes: uma tabela escrita à mão, agente a agente, com
//     estilo e variante. O teste `office.test.mjs` recusa dois agentes com o mesmo par.
//   · **14 mulheres, 8 chapéus, 8 barbas, 7 óculos** — espalhados pelas seis salas, não todos na
//     mesma. Os testes verificam o equilíbrio, não só a existência.
//   · **A cor da roupa é a da sala.** O casaco é o `chip` do departamento escurecido e dessaturado
//     (um fato, não um bloco pastel); a gravata e o lenço são o `chip` vivo. Olhando a sala, lê-se
//     a cor; olhando a pessoa, lê-se um fato.
//   · O cabelo e a pele continuam a vir de `data.js` — são a identidade que já existia.

import { AGENTS, DEPTS } from './data.js';
import { mix, shade, tint } from './palette.js';

/** Estilos de cabelo que o construtor sabe desenhar. */
export const HAIR_STYLES = [
  'short', 'crop', 'sidepart', 'quiff', 'slick', 'curly', 'afro',
  'bald', 'ponytail', 'bun', 'bob', 'long', 'wavy', 'pixie', 'braids',
];
export const HATS = ['none', 'cap', 'fedora', 'beret', 'beanie'];
export const BEARDS = ['none', 'stubble', 'beard', 'moustache'];

// A tabela, na ordem de `AGENTS` em data.js. `hair` e `skin` NÃO estão aqui: vêm de data.js.
// style · variant (0–3) · female · hat · beard · glasses
const TABLE = {
  // ── COMANDO (emails) ──────────────────────────────────────────────────────
  elead:  { style: 'slick',    variant: 0, female: false, hat: 'none',   beard: 'none',      glasses: false },
  imail:  { style: 'short',    variant: 0, female: false, hat: 'fedora', beard: 'none',      glasses: false },
  report: { style: 'bob',      variant: 0, female: true,  hat: 'none',   beard: 'none',      glasses: true },
  dash:   { style: 'pixie',    variant: 0, female: true,  hat: 'cap',    beard: 'none',      glasses: false },
  comply: { style: 'bun',      variant: 0, female: true,  hat: 'none',   beard: 'none',      glasses: true },
  atend:  { style: 'bob',      variant: 3, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  plan:   { style: 'sidepart', variant: 2, female: false, hat: 'none',   beard: 'none',      glasses: false },
  // ── PROSPEÇÃO (sales) ─────────────────────────────────────────────────────
  pros:   { style: 'quiff',    variant: 0, female: false, hat: 'none',   beard: 'stubble',   glasses: false },
  enzo:   { style: 'curly',    variant: 0, female: false, hat: 'none',   beard: 'beard',     glasses: false },
  ilm:    { style: 'short',    variant: 1, female: false, hat: 'none',   beard: 'none',      glasses: false },
  riley:  { style: 'ponytail', variant: 0, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  scout:  { style: 'crop',     variant: 0, female: false, hat: 'beanie', beard: 'stubble',   glasses: false },
  vmail:  { style: 'long',     variant: 0, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  radar:  { style: 'afro',     variant: 2, female: false, hat: 'none',   beard: 'stubble',   glasses: false },
  partners: { style: 'braids', variant: 1, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  // ── VENDAS (ops) ──────────────────────────────────────────────────────────
  olead:  { style: 'sidepart', variant: 0, female: false, hat: 'none',   beard: 'none',      glasses: true },
  piper:  { style: 'wavy',     variant: 0, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  folo:   { style: 'bald',     variant: 0, female: false, hat: 'beret',  beard: 'beard',     glasses: false },
  ona:    { style: 'braids',   variant: 0, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  legal:  { style: 'bun',      variant: 1, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  cmail:  { style: 'crop',     variant: 1, female: false, hat: 'none',   beard: 'stubble',   glasses: false },
  renew:  { style: 'bald',     variant: 1, female: false, hat: 'beanie', beard: 'none',      glasses: false },
  upsell: { style: 'wavy',     variant: 2, female: true,  hat: 'none',   beard: 'none',      glasses: true },
  // ── DESIGN LAB (fin) ──────────────────────────────────────────────────────
  gfx:    { style: 'slick',    variant: 1, female: false, hat: 'cap',    beard: 'stubble',   glasses: false },
  dasst:  { style: 'afro',     variant: 0, female: false, hat: 'none',   beard: 'beard',     glasses: false },
  alead:  { style: 'bob',      variant: 1, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  invo:   { style: 'ponytail', variant: 1, female: true,  hat: 'none',   beard: 'none',      glasses: true },
  motion: { style: 'quiff',    variant: 2, female: false, hat: 'cap',    beard: 'stubble',   glasses: false },
  brand:  { style: 'pixie',    variant: 2, female: true,  hat: 'none',   beard: 'none',      glasses: true },
  // ── ENGENHARIA (delivery) ─────────────────────────────────────────────────
  dlead:  { style: 'sidepart', variant: 1, female: false, hat: 'none',   beard: 'stubble',   glasses: false },
  pco:    { style: 'short',    variant: 2, female: false, hat: 'none',   beard: 'none',      glasses: false },
  qa:     { style: 'pixie',    variant: 1, female: true,  hat: 'none',   beard: 'none',      glasses: true },
  crep:   { style: 'curly',    variant: 1, female: false, hat: 'none',   beard: 'beard',     glasses: false },
  cass:   { style: 'bob',      variant: 2, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  apay:   { style: 'crop',     variant: 2, female: false, hat: 'beanie', beard: 'none',      glasses: false },
  kmail:  { style: 'quiff',    variant: 1, female: false, hat: 'none',   beard: 'moustache', glasses: false },
  sec:    { style: 'slick',    variant: 3, female: false, hat: 'none',   beard: 'beard',     glasses: true },
  perf:   { style: 'ponytail', variant: 2, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  // ── MEDIA (marketing) ─────────────────────────────────────────────────────
  mlead:  { style: 'slick',    variant: 2, female: false, hat: 'none',   beard: 'beard',     glasses: false },
  newt:   { style: 'short',    variant: 3, female: false, hat: 'none',   beard: 'none',      glasses: false },
  ada:    { style: 'wavy',     variant: 1, female: true,  hat: 'none',   beard: 'none',      glasses: true },
  iggy:   { style: 'curly',    variant: 2, female: false, hat: 'fedora', beard: 'none',      glasses: false },
  vid:    { style: 'crop',     variant: 3, female: false, hat: 'beret',  beard: 'none',      glasses: false },
  lexi:   { style: 'long',     variant: 1, female: true,  hat: 'none',   beard: 'none',      glasses: false },
  recon:  { style: 'afro',     variant: 1, female: false, hat: 'none',   beard: 'none',      glasses: true },
  seo:    { style: 'quiff',    variant: 3, female: false, hat: 'none',   beard: 'moustache', glasses: false },
  mailmkt: { style: 'long',    variant: 2, female: true,  hat: 'none',   beard: 'none',      glasses: false },
};

/** A aparência de um agente: o que está na tabela + o que a cena deriva da cor da sala. */
export function lookFor(agent, deptKey = agent?.dept) {
  if (!agent || !agent.id) throw new Error('lookFor precisa de um agente');
  const base = TABLE[agent.id];
  if (!base) throw new Error(`sem aparência para o agente «${agent.id}» — a tabela de looks está incompleta`);
  return buildLook(agent, base, deptKey || agent.dept);
}

function buildLook(agent, base, deptKey) {
  const dept = DEPTS[deptKey];
  if (!dept) throw new Error(`departamento desconhecido: ${deptKey}`);
  const chip = dept.chip, glass = dept.glass;
  // Fato: a cor da sala, mas assente. Escurecer em direcção à tinta conserva o matiz (é o que
  // permite ler «verde», «amarelo», «roxo» em vez de seis cinzentos); o toque de carvão tira-lhe o
  // brilho de pastel. O que não se faz é clarear: um fato é roupa de trabalho, não um cartaz.
  const suit = mix(shade(chip, 0.46), '#22242A', 0.14);
  const suitDark = shade(suit, 0.22);
  return {
    ...base,
    id: agent.id,
    dept: deptKey,
    female: !!base.female,
    // o corte: fato para eles; blazer ou vestido para elas, alternado pela variante (é a variante
    // que já distingue o penteado, por isso a mesma pessoa não muda de estilo de um dia para o outro)
    outfit: base.female ? (base.variant % 2 === 0 ? 'dress' : 'blazer') : 'suit',
    lead: !!agent.lead,
    hair: agent.hair,
    skin: agent.skin,
    // roupa formal — a sala manda na cor, o corte é de escritório
    suit,
    suitDark,
    shirt: base.female ? '#F4EFE3' : '#EFEADB',
    tie: base.female ? glass : chip,
    accent: chip,
    trousers: mix('#2C2E35', suit, 0.34),
    shoes: '#191A1E',
    hatColor: base.hat === 'fedora' ? '#2A2B31' : (base.hat === 'beret' ? mix(shade(chip, 0.42), '#1E1F24', 0.3) : shade(chip, 0.58)),
    // `null` para quem não usa óculos. Isto já foi `'#2B2C31'` para todos e a cena desenhava uma
    // armação em cada um dos 35 — o teste contava 7 na tabela e passava, porque contava a tabela.
    glasses: base.glasses ? '#2B2C31' : null,
    lip: base.female ? '#B0574F' : '#8A5750',
    signature: `${base.style}.${base.variant}${base.hat !== 'none' ? '+' + base.hat : ''}`,
  };
}

/** Contagens para documentação e testes: nada aqui é aleatório. */
export const LOOK_STATS = (() => {
  const list = Object.entries(TABLE).map(([id, v]) => ({ id, ...v }));
  const depts = [...new Set(AGENTS.map((a) => a.dept))];
  const perDept = (fn) => Object.fromEntries(depts.map((d) => [d, list.filter((x) => fn(x) && AGENTS.find((a) => a.id === x.id)?.dept === d).length]));
  return {
    total: list.length,
    women: list.filter((x) => x.female).length,
    men: list.filter((x) => !x.female).length,
    hats: list.filter((x) => x.hat !== 'none').length,
    beards: list.filter((x) => x.beard !== 'none').length,
    glasses: list.filter((x) => x.glasses).length,
    styles: [...new Set(list.map((x) => x.style))].length,
    signatures: list.map((x) => `${x.style}.${x.variant}${x.hat !== 'none' ? '+' + x.hat : ''}`),
    womenPerDept: perDept((x) => x.female),
    hatsPerDept: perDept((x) => x.hat !== 'none'),
  };
})();

/** A tabela tal como está — para o teste comparar com a lista de agentes. */
export const LOOK_TABLE = Object.freeze(Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, { ...v }])));

/**
 * Problemas de coerência entre `AGENTS` e a tabela. Devolve [] quando está tudo bem.
 * Chamado pelos testes e pelo `officeProblems()` na sua forma longa.
 */
export function lookProblems(agents = AGENTS) {
  const out = [];
  const seen = new Map();
  for (const a of agents) {
    const t = TABLE[a.id];
    if (!t) { out.push(`«${a.name}» (${a.id}) não tem aparência definida`); continue; }
    if (!HAIR_STYLES.includes(t.style)) out.push(`${a.id}: estilo «${t.style}» desconhecido`);
    if (!HATS.includes(t.hat)) out.push(`${a.id}: chapéu «${t.hat}» desconhecido`);
    if (!BEARDS.includes(t.beard)) out.push(`${a.id}: barba «${t.beard}» desconhecida`);
    if (!Number.isInteger(t.variant) || t.variant < 0 || t.variant > 3) out.push(`${a.id}: variante inválida (${t.variant})`);
    const sig = `${t.style}.${t.variant}${t.hat !== 'none' ? '+' + t.hat : ''}`;
    if (seen.has(sig)) out.push(`${a.id} e ${seen.get(sig)} têm a mesma aparência (${sig})`);
    seen.set(sig, a.id);
  }
  for (const id of Object.keys(TABLE)) if (!agents.some((a) => a.id === id)) out.push(`a tabela tem «${id}», que não é agente`);
  if (out.length === 0) {
    if (LOOK_STATS.women < 6) out.push(`só ${LOOK_STATS.women} mulheres — o dono pediu «alguns serão mulheres»`);
    if (LOOK_STATS.hats < 5) out.push(`só ${LOOK_STATS.hats} chapéus — o dono pediu «alguns com chapéu»`);
    if (LOOK_STATS.styles < 10) out.push(`só ${LOOK_STATS.styles} estilos de cabelo`);
  }
  return out;
}
