// Órbita — avaliações automáticas do rascunho.
//
// O problema que isto resolve: mudar uma palavra no prompt e não dar por ela até um cliente
// receber uma mensagem má. Aqui há um conjunto fixo de casos, com expectativas escritas, que
// corre sempre que se mexe no prompt — e o resultado fica guardado com a versão do prompt, para
// se ver a qualidade a descer em vez de a descobrir por acidente.
//
// Os casos não testam estilo: testam o que não pode falhar. Preço certo, pergunta no fim,
// nenhuma citação inventada, nenhuma promessa que não podemos fazer, objeções preparadas.
import { openDb } from './db.mjs';
import * as leads from './leads.mjs';
import * as research from './research.mjs';
import { compose, offerOf, setOffer, guardDraft } from './personalize.mjs';

/** Muda quando o prompt ou o modelo local mudam. É o que liga um resultado a uma versão. */
export const PROMPT_VERSION = 'rascunho-v1';

const OK = () => true;

/** Os casos. Cada um é um negócio verosímil com o que se teria lido no site. */
export const CASES = [
  {
    id: 'sem-site',
    nome: 'negócio sem site nenhum',
    lead: { name: 'Barbearia do Bairro', city: 'Coimbra', phone: '+351 913 222 333', category: 'barbearia', rating: 4.6, reviews: 40 },
    facts: null,
    channel: 'whatsapp',
    expect: {
      mentions: /sem site|não tem site|presença/i,
      price: true, question: true, minPredictions: 3,
    },
  },
  {
    id: 'site-abandonado',
    nome: 'site com rodapé de 2019',
    lead: { name: 'Salão Bela Vista', city: 'Lisboa', phone: '+351 210 001 122', website: 'https://belavista.pt', category: 'cabeleireiro', rating: 4.1, reviews: 10 },
    facts: {
      title: 'Salão Bela Vista — Lisboa',
      description: 'Cortes, coloração e tratamentos no coração de Alvalade, com marcação pelo telefone.',
      findings: [
        { key: 'desactualizado', label: 'o rodapé ainda diz 2019', quote: '© 2019', weight: 14 },
        { key: 'sem-mobile', label: 'a página não tem versão para telemóvel', quote: 'falta a meta viewport', weight: 18 },
        { key: 'descricao', label: 'a própria página diz o que faz', quote: 'Cortes, coloração e tratamentos no coração de Alvalade, com marcação pelo telefone.', weight: 3 },
      ],
    },
    channel: 'whatsapp',
    expect: { mentions: /2019|telemóvel/i, price: true, question: true, minPredictions: 3 },
  },
  {
    id: 'com-marcacao',
    nome: 'clínica com site moderno e sem marcação',
    lead: { name: 'Clínica Sorriso', city: 'Porto', phone: '+351 220 000 111', website: 'https://sorriso.pt', category: 'dentista', rating: 4.8, reviews: 220 },
    facts: {
      title: 'Clínica Sorriso',
      description: 'Medicina dentária no Porto, com uma equipa de seis profissionais.',
      findings: [
        { key: 'sem-marcacao', label: 'não tem marcação online', quote: 'não encontrei marcação nem reserva', weight: 10 },
        { key: 'sem-formulario', label: 'não tem formulário de contacto — só telefone ou email', quote: 'nenhum <form> na página', weight: 8 },
      ],
    },
    channel: 'email',
    expect: { mentions: /marcação|marcar|formulário|pedido/i, price: true, question: true, minPredictions: 3 },
  },
  {
    id: 'motor-inventa',
    nome: 'um motor que inventa uma citação tem de ser travado',
    lead: { name: 'Óptica Central', city: 'Porto', phone: '+351 913 000 000' },
    facts: null,
    channel: 'whatsapp',
    ask: async () => JSON.stringify({
      assunto: 'Ideia',
      corpo: 'Bom dia! Vi que «fazem entregas em 24 horas em todo o país» na vossa página. Posso ajudar?',
      facto_usado: 'entregas em 24 horas',
    }),
    expect: { generatedBy: 'modelo', noInvented: true, question: true, minPredictions: 3 },
  },
  {
    id: 'motor-honesto',
    nome: 'um motor que só usa factos verdadeiros passa',
    lead: { name: 'Padaria Nova', city: 'Coimbra', phone: '+351 912 333 444' },
    facts: null,
    channel: 'whatsapp',
    ask: async () => JSON.stringify({
      assunto: 'Uma ideia',
      corpo: 'Bom dia! Reparei que não têm site, e quem procura a Padaria Nova encontra só o mapa. Faço uma página simples por 350 €, pronta em 7 dias. Falamos 10 minutos?',
      facto_usado: 'não têm site',
    }),
    expect: { generatedBy: 'ia', price: true, question: true, minPredictions: 3 },
  },
];

/** Os casos puros, sem rede nem base de dados: o pente de citações. */
export const GUARD_CASES = [
  {
    id: 'guarda-citacao-inventada',
    nome: 'uma citação que não está no que se leu é cortada',
    text: 'O rodapé diz 2019. «Somos a número um de Portugal em coloração». Falamos?',
    facts: ['o rodapé ainda diz 2019'],
    expect: { keeps: /rodapé/, drops: 1 },
  },
  {
    id: 'guarda-promessa',
    nome: 'uma promessa que não podemos fazer é cortada',
    text: 'Fazemos o site. Garantimos resultados em 24 horas. Interessa?',
    facts: ['fazemos o site'],
    expect: { keeps: /site/, drops: 1 },
  },
  {
    id: 'guarda-limpa',
    nome: 'um texto sem invenções passa inteiro',
    text: 'O rodapé ainda diz 2019. Faz sentido falarmos?',
    facts: ['o rodapé ainda diz 2019'],
    expect: { keeps: /2019/, drops: 0 },
  },
];

const fresh = () => openDb(':memory:');

/** Um resultado por caso: `{ id, nome, ok, falhas }`. */
export async function runCase(kase, { offer = null } = {}) {
  const db = fresh();
  try {
    if (offer) setOffer(db, offer, 'eval');
    const lead = leads.upsertLead(db, kase.lead, 'eval').lead;
    if (kase.facts) {
      research.save(db, {
        leadId: lead.id, url: lead.website || '', status: 'ok', data: { title: kase.facts.title, description: kase.facts.description },
        evidence: kase.facts.findings, actor: 'eval',
      });
    }
    const made = await compose(db, lead, { channel: kase.channel, ask: kase.ask || null });
    const falhas = [];
    const e = kase.expect || {};
    if (e.generatedBy && made.generatedBy !== e.generatedBy) falhas.push(`autor ${made.generatedBy} em vez de ${e.generatedBy}`);
    if (e.mentions && !e.mentions.test(made.body)) falhas.push(`a mensagem não fala do que interessa (${e.mentions})`);
    if (e.price) {
      const o = offerOf(db);
      if (!new RegExp(`${o.preco_eur}\\s*€`).test(made.body)) falhas.push(`sem o preço (${o.preco_eur} €) na mensagem`);
    }
    if (e.question && !/\?/.test(made.body)) falhas.push('a mensagem não faz uma pergunta');
    if (e.minPredictions && made.predictions.length < e.minPredictions) falhas.push(`só ${made.predictions.length} objeções previstas`);
    if (made.predictions.some(p => !p.if || !p.answer)) falhas.push('uma objeção sem resposta preparada');
    if (made.body.length > 700) falhas.push(`mensagem longa demais (${made.body.length} caracteres)`);
    if (/\b(garantimos|100%|o melhor do mercado)\b/i.test(made.body)) falhas.push('promete o que não pode');
    if (e.noInvented) {
      const quoted = [...made.body.matchAll(/[«"“]([^»"”]{12,})[»"”]/g)].map(m => m[1]);
      const hay = [lead.website || '', ...(research.latest(db, lead.id)?.evidence || []).map(x => x.quote)].join(' ');
      for (const q of quoted) if (!hay.toLowerCase().includes(q.toLowerCase())) falhas.push(`citação inventada: «${q.slice(0, 40)}…»`);
    }
    return { id: kase.id, nome: kase.nome, ok: falhas.length === 0, falhas };
  } finally { db.close(); }
}

export function runGuardCase(kase) {
  const out = guardDraft(kase.text, kase.facts, { channel: 'whatsapp' });
  const falhas = [];
  if (kase.expect.keeps && !kase.expect.keeps.test(out.text)) falhas.push('cortou o que era verdadeiro');
  if (out.dropped.length !== kase.expect.drops) falhas.push(`cortou ${out.dropped.length} frases, esperava ${kase.expect.drops}`);
  return { id: kase.id, nome: kase.nome, ok: falhas.length === 0, falhas };
}

/** Corre tudo e guarda o resultado. Passa um `ask` para avaliar um motor a sério. */
export async function runAll(db, { ask = null, offer = null } = {}) {
  const results = [];
  for (const k of CASES) results.push(await runCase(k, { offer }));
  for (const k of GUARD_CASES) results.push(runGuardCase(k));
  const passou = results.filter(r => r.ok).length;
  const falhou = results.length - passou;
  const anterior = db.prepare('SELECT * FROM evals ORDER BY id DESC LIMIT 1').get();
  db.prepare('INSERT INTO evals (at, suite, prompt_version, total, passed, failed, detail) VALUES (?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), 'rascunho', PROMPT_VERSION, results.length, passou, falhou,
      JSON.stringify(results.filter(r => !r.ok)));
  const regressao = anterior && anterior.prompt_version === PROMPT_VERSION && passou < anterior.passed;
  return {
    promptVersion: PROMPT_VERSION,
    total: results.length, passou, falhou,
    resultados: results,
    anterior: anterior ? { em: anterior.at, versao: anterior.prompt_version, passou: anterior.passed, total: anterior.total } : null,
    regressao: !!regressao,
    aviso: regressao ? `a qualidade desceu: ${anterior.passed}/${anterior.total} antes, ${passou}/${results.length} agora` : null,
  };
}

/** O histórico, para a gaveta poder mostrar a curva. */
export function history(db, limit = 12) {
  return db.prepare('SELECT id, at, suite, prompt_version, total, passed, failed FROM evals ORDER BY id DESC LIMIT ?').all(limit);
}
