/* ===========================================================================
   1.55.0 · DINHEIRO VERDADEIRO (2 nov 2026)

   O que havia: `/ops/saldo` devolvia `custoCentimos: 0` e
   `margemCentimos = receitaCentimos`. Era falso por construção — o `/ia/uso`
   registava tokens de cada chamada e ninguém os multiplicava por um preço.

   O que este ficheiro faz, e as regras que não quebra:

     · o preço vem do catálogo (`preco`: USD por milhão de tokens, entrada/saída)
       e pode ser corrigido por `ORBITA_PRECOS_IA` sem tocar no código;
     · a conta é inteira: guarda-se **micro-USD** (`tokens × preço`), não euros
       arredondados. Uma tarefa de 900 tokens custa 0,06 cêntimos; arredondar por
       chamada dava zero e mil chamadas gratuitas;
     · sem preço conhecido o custo é `null` — **nunca zero**. Uma chamada sem
       preço aparece como «desconhecida» e a soma diz quantas ficaram de fora;
     · os preços do catálogo são **indicativos** (é o que o próprio catálogo diz).
       O saldo chama-lhes «calculado», não «faturado», e diz de onde veio o preço;
     · câmbio: `ORBITA_CAMBIO_USD_EUR` manda; sem ela usa-se um valor de
       referência escrito aqui, e o saldo mostra qual foi usado. Nenhum ecrã
       apresenta um número destes como se fosse uma fatura.
   =========================================================================== */
import { MODELOS, FORNECEDORES } from './_ia/catalogo.mjs';

/** 1 USD = 0,92 € é um valor de REFERÊNCIA, não uma cotação consultada. */
export const CAMBIO_PADRAO = 0.92;
export const MOEDA = 'EUR';

/* índice fornecedor/modelo -> preço, construído uma vez */
const INDICE = new Map();
for (const m of MODELOS) {
  if (!Array.isArray(m.preco)) continue;
  const k = `${m.fornecedor}\u0000${m.modelo}`.toLowerCase();
  const preco = [Number(m.preco[0]) || 0, Number(m.preco[1]) || 0];
  const antes = INDICE.get(k);
  /* O catálogo repete pares: as entradas do freellmapi dizem `preco: [0, 0]`
     («o plano é gratuito, o custo real só o fornecedor sabe») e tapavam o preço
     declarado do mesmo modelo. Um preço conhecido ganha a um zero; dois zeros
     continuam gratuitos, mas ditos como tal. */
  if (antes) {
    const antesZero = antes.preco[0] === 0 && antes.preco[1] === 0;
    const agoraZero = preco[0] === 0 && preco[1] === 0;
    if (antesZero && !agoraZero) INDICE.set(k, { preco, gratuito: !!m.gratuito });
    else if (!antesZero && agoraZero) { /* fica o preço conhecido */ }
    else INDICE.set(k, { preco, gratuito: antes.gratuito && !!m.gratuito });
  } else {
    INDICE.set(k, { preco, gratuito: !!m.gratuito });
  }
}

/** `ORBITA_PRECOS_IA` — {"groq/llama-3.3-70b-versatile":[0.59,0.79],"groq":[0.6,0.8]} */
export function precosDoAmbiente(env = {}) {
  const bruto = env?.ORBITA_PRECOS_IA;
  if (!bruto) return {};
  try {
    const j = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    if (!j || typeof j !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (!Array.isArray(v) || v.length !== 2) continue;
      const entrada = Number(v[0]);
      const saida = Number(v[1]);
      if (!Number.isFinite(entrada) || !Number.isFinite(saida) || entrada < 0 || saida < 0) continue;
      out[String(k).toLowerCase()] = [entrada, saida];
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * O preço de um par fornecedor/modelo.
 * Devolve `null` quando não se sabe — e isso é uma informação, não um zero.
 */
export function precoDe(fornec, modelo, env = {}) {
  const f = String(fornec || '').toLowerCase();
  const m = String(modelo || '').toLowerCase();
  if (!f) return null;
  const amb = precosDoAmbiente(env);
  /* o dono manda: par exacto, depois o fornecedor todo */
  if (amb[`${f}/${m}`]) return { preco: amb[`${f}/${m}`], fonte: 'ambiente', gratuito: false };
  if (amb[f]) return { preco: amb[f], fonte: 'ambiente', gratuito: false };
  const cat = INDICE.get(`${f}\u0000${m}`);
  if (cat) {
    const zero = cat.preco[0] === 0 && cat.preco[1] === 0;
    return { preco: cat.preco, fonte: zero ? 'catalogo-gratuito' : 'catalogo', gratuito: zero || cat.gratuito };
  }
  return null;
}

/** O câmbio usado, com a fonte à vista. */
export function cambioDe(env = {}) {
  const bruto = Number(env?.ORBITA_CAMBIO_USD_EUR);
  if (Number.isFinite(bruto) && bruto > 0) {
    return { taxa: bruto, fonte: 'ambiente', nota: 'taxa declarada em ORBITA_CAMBIO_USD_EUR' };
  }
  return {
    taxa: CAMBIO_PADRAO, fonte: 'padrao',
    nota: `1 USD = ${String(CAMBIO_PADRAO).replace('.', ',')} € é um valor de referência escrito no código; declara ORBITA_CAMBIO_USD_EUR para usar a taxa que usares mesmo`,
  };
}

/** «0,09 €» a partir de micro-USD — para mensagens de orçamento e de tarefa. */
export function eurosDeMicro(microUsd, taxa = CAMBIO_PADRAO) {
  const c = centimosDeMicro(microUsd, taxa);
  if (c == null) return 'custo desconhecido';
  return `${(c / 100).toFixed(2).replace('.', ',')} €`;
}

/** cêntimos -> «0,09 €». */
export const eurosDeCentimos = (cents) => `${((Number(cents) || 0) / 100).toFixed(2).replace('.', ',')} €`;

/** micro-USD -> cêntimos de euro (inteiro). `null` fica `null`. */
export function centimosDeMicro(microUsd, taxa = CAMBIO_PADRAO) {
  if (microUsd == null || !Number.isFinite(Number(microUsd))) return null;
  return Math.round((Number(microUsd) * Number(taxa)) / 1e4);
}

/**
 * O custo de UMA chamada, em micro-USD inteiros.
 *
 * `tokens × preço` dá micro-USD exactamente porque `preco` é USD por milhão de
 * tokens: 900 × 0,15 = 135 micro-USD = 0,000135 USD.
 */
export function custoDeUso({ fornec, modelo, entrada = 0, saida = 0, env = {} } = {}) {
  const p = precoDe(fornec, modelo, env);
  const tokensIn = Math.max(0, Math.round(Number(entrada) || 0));
  const tokensOut = Math.max(0, Math.round(Number(saida) || 0));
  if (!p) {
    return {
      microUsd: null, desconhecido: true, preco: null, fonte: 'ausente',
      tokensIn, tokensOut, fornecedor: fornec || null, modelo: modelo || null,
      nota: `sem preço para ${fornec || '?'}/${modelo || '?'} — declara-o em ORBITA_PRECOS_IA`,
    };
  }
  const microUsd = Math.round(tokensIn * p.preco[0] + tokensOut * p.preco[1]);
  return {
    microUsd, desconhecido: false, preco: p.preco, fonte: p.fonte,
    gratuito: !!p.gratuito, tokensIn, tokensOut,
    fornecedor: fornec || null, modelo: modelo || null,
  };
}

/**
 * O tecto de custo de UMA execução, em micro-USD (`ORBITA_ORCAMENTO_CENTIMOS`).
 * Sem a variável, não há tecto — e o saldo diz que não há.
 */
export function tectoDeCusto(env = {}) {
  const cents = Number(env?.ORBITA_ORCAMENTO_CENTIMOS);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  const { taxa } = cambioDe(env);
  return Math.round((cents * 1e4) / taxa);
}

/** As colunas que uma linha de `orbita_ai_uso` leva para o custo ficar gravado. */
export function camposDeCusto(linha = {}, env = {}) {
  const c = custoDeUso({
    fornec: linha.fornecedor, modelo: linha.modelo,
    entrada: linha.tokens_in, saida: linha.tokens_out, env,
  });
  return {
    custo_micro_usd: c.microUsd,
    custo_moeda: 'USD',
    custo_desconhecido: c.desconhecido,
    preco_entrada: c.preco ? c.preco[0] : null,
    preco_saida: c.preco ? c.preco[1] : null,
    preco_fonte: c.fonte,
  };
}

/** Nome legível do fornecedor. */
export const nomeDoFornecedor = (id) => FORNECEDORES[id]?.nome || id || '—';

const listaOr = (xs) => xs.filter(Boolean).join(' · ');

/**
 * Agrega linhas de uso (com o custo já gravado ou recalculado dos tokens).
 *
 * Devolve por par fornecedor/modelo o que é preciso para a «conta à vista»:
 * chamadas, tokens de entrada e saída, preço, e o custo em micro-USD. Nada é
 * somado com preços diferentes na mesma linha.
 */
export function agregarUso(linhas = [], env = {}) {
  const porChave = new Map();
  let desconhecidas = 0;
  for (const l of linhas) {
    const fornec = l.fornecedor || '—';
    const modelo = l.modelo || '(sem modelo)';
    const k = `${fornec}\u0000${modelo}`;
    const a = porChave.get(k) || {
      fornecedor: fornec, fornecedorNome: nomeDoFornecedor(fornec), modelo,
      chamadas: 0, ok: 0, erros: 0, tokensIn: 0, tokensOut: 0,
      microUsd: 0, desconhecidas: 0, preco: null, fonte: null,
    };
    a.chamadas += 1;
    if (l.ok) a.ok += 1; else a.erros += 1;
    a.tokensIn += Number(l.tokens_in) || 0;
    a.tokensOut += Number(l.tokens_out) || 0;

    /* o custo gravado é a verdade (foi calculado com o preço da altura); se a
       linha for antiga e não o tiver, recalcula-se dos tokens */
    let micro = l.custo_micro_usd;
    let preco = Array.isArray(l.preco_entrada) || l.preco_entrada != null
      ? [Number(l.preco_entrada), Number(l.preco_saida)]
      : null;
    let fonte = l.preco_fonte || null;
    if (micro == null) {
      const c = custoDeUso({ fornec, modelo, entrada: l.tokens_in, saida: l.tokens_out, env });
      micro = c.microUsd;
      preco = c.preco;
      fonte = c.fonte;
    }
    if (micro == null) {
      a.desconhecidas += 1;
      desconhecidas += 1;
    } else {
      a.microUsd += Number(micro) || 0;
      if (preco && !a.preco) a.preco = preco;
      if (fonte && !a.fonte) a.fonte = fonte;
    }
    porChave.set(k, a);
  }
  const linhasConta = [...porChave.values()]
    .map((a) => ({ ...a, preco: a.preco || null }))
    .sort((x, y) => (y.microUsd || 0) - (x.microUsd || 0) || x.fornecedor.localeCompare(y.fornecedor));
  const microTotal = linhasConta.reduce((n, a) => n + (a.microUsd || 0), 0);
  return { linhas: linhasConta, microUsd: microTotal, desconhecidas, chamadas: linhas.length };
}

/**
 * O saldo derivado: receita escrita pelo dono, custo medido das chamadas,
 * margem, custo por lead e por projeto. Os mesmos números que a mesa mostra.
 */
export function saldo({
  receitas = [], uso = [], tarefas = [], leads = [], projetos = [], geracoes = [],
  env = {}, janelaDias = 90, agora = Date.now(),
} = {}) {
  const cambio = cambioDe(env);
  const desde = new Date(agora - janelaDias * 86400000).toISOString();
  const dentro = receitas.filter((r) => String(r.at || '') >= desde);
  const receitaCentimos = dentro.reduce((n, r) => n + (Number(r.amount_cents) || 0), 0);

  const mapaCampanha = new Map();
  for (const r of dentro) {
    const k = r.campaign || 'sem campanha';
    mapaCampanha.set(k, (mapaCampanha.get(k) || 0) + (Number(r.amount_cents) || 0));
  }

  const conta = agregarUso(uso.filter((l) => String(l.criado || '') >= desde), env);

  /* custo por fornecedor: uma linha por fornecedor, com os tokens e o preço à
     vista. Um fornecedor sem preço aparece com `desconhecido: true` — não a zero */
  const porFornecedor = new Map();
  for (const l of conta.linhas) {
    const a = porFornecedor.get(l.fornecedor) || {
      provider: l.fornecedor, fornecedor: l.fornecedor, fornecedorNome: l.fornecedorNome,
      chamadas: 0, tokensIn: 0, tokensOut: 0, microUsd: 0, desconhecidas: 0, precos: [],
    };
    a.chamadas += l.chamadas;
    a.tokensIn += l.tokensIn;
    a.tokensOut += l.tokensOut;
    a.microUsd += l.microUsd || 0;
    a.desconhecidas += l.desconhecidas || 0;
    if (l.preco) a.precos.push(l.preco);
    porFornecedor.set(l.fornecedor, a);
  }
  const custosPorFornecedor = [...porFornecedor.values()].map((a) => ({
    ...a,
    centimos: centimosDeMicro(a.microUsd, cambio.taxa),
    cents: centimosDeMicro(a.microUsd, cambio.taxa),   // o nome que a vista já lê
    tokens: a.tokensIn + a.tokensOut,
    desconhecido: a.desconhecidas > 0,
    preco: a.precos.length === 1 ? a.precos[0] : (a.precos.length ? 'vários' : null),
    precos: undefined,
  }));

  /* 1.55.0 · a mídia gerada também custa (quando custa). O valor está em USD na
     linha da geração; entra em micro-USD, e o que não tem preço é contado à parte
     — o saldo não pode chamar «gastou em APIs» a uma soma que ignora uma imagem
     paga. */
  const midiaPorFornecedor = new Map();
  let midiaMicro = 0;
  let midiaDesconhecidas = 0;
  for (const g of geracoes) {
    const bruto = g.custo_real != null ? g.custo_real : g.custo_estimado;
    const usd = Number(bruto);
    /* a linha diz em que moeda está; só se soma o que é USD — uma geração em
       euros somada como dólares era um erro de 8 % que ninguém veria */
    const moeda = String(g.custo_moeda || 'USD').toUpperCase();
    const k = g.fornecedor || '—';
    const a = midiaPorFornecedor.get(k) || { fornecedor: k, fornecedorNome: nomeDoFornecedor(k), geracoes: 0, microUsd: 0, desconhecidas: 0 };
    a.geracoes += 1;
    if (bruto == null || !Number.isFinite(usd) || g.custo_confiavel === false || moeda !== 'USD') {
      a.desconhecidas += 1;
      midiaDesconhecidas += 1;
    } else {
      const micro = Math.round(usd * 1e6);
      a.microUsd += micro;
      midiaMicro += micro;
    }
    midiaPorFornecedor.set(k, a);
  }
  const midia = {
    geracoes: geracoes.length,
    microUsd: midiaMicro,
    centimos: centimosDeMicro(midiaMicro, cambio.taxa),
    desconhecidas: midiaDesconhecidas,
    porFornecedor: [...midiaPorFornecedor.values()]
      .map((a) => ({ ...a, centimos: centimosDeMicro(a.microUsd, cambio.taxa), desconhecido: a.desconhecidas > 0 }))
      .sort((x, y) => y.microUsd - x.microUsd),
    nota: 'custo da mídia gerada: usa-se o valor real quando o fornecedor o devolve; senão a estimativa, marcada como tal',
  };

  const custoCentimos = centimosDeMicro(conta.microUsd + midiaMicro, cambio.taxa) || 0;
  const margemCentimos = receitaCentimos - custoCentimos;

  /* custo por tarefa — a mesma conta, mas ligada ao lead ou ao projeto */
  const custoDaTarefa = (t) => (t.custo_micro_usd == null ? null : Number(t.custo_micro_usd) || 0);
  const tarefasDentro = tarefas.filter((t) => !t.created_at || String(t.created_at) >= desde);
  const custoTarefas = tarefasDentro.reduce((n, t) => n + (custoDaTarefa(t) || 0), 0);
  const tarefasSemCusto = tarefasDentro.filter((t) => custoDaTarefa(t) == null).length;

  const porEntidade = (entidade) => {
    const mapa = new Map();
    for (const t of tarefasDentro) {
      if (t.entidade !== entidade || !t.entity_id) continue;
      if (custoDaTarefa(t) == null) continue;
      const a = mapa.get(t.entity_id) || { id: t.entity_id, tarefas: 0, microUsd: 0 };
      a.tarefas += 1;
      a.microUsd += custoDaTarefa(t);
      mapa.set(t.entity_id, a);
    }
    const nome = new Map((entidade === 'projeto' ? projetos : leads).map((x) => [x.id, x.name || x.nome || x.id]));
    return [...mapa.values()]
      .map((a) => ({
        ...a, nome: nome.get(a.id) || a.id,
        centimos: centimosDeMicro(a.microUsd, cambio.taxa),
      }))
      .sort((x, y) => y.microUsd - x.microUsd);
  };

  const contactados = leads.filter((l) => ['contactado', 'respondeu', 'ganho', 'cliente', 'reuniao'].includes(l.status)).length;
  const clientes = leads.filter((l) => ['ganho', 'cliente'].includes(l.status)).length;
  const unitarios = {
    custoPorLead: leads.length ? Math.round(custoCentimos / leads.length) : null,
    custoPorContactado: contactados ? Math.round(custoCentimos / contactados) : null,
    custoPorCliente: clientes ? Math.round(custoCentimos / clientes) : null,
    receitaPorCliente: clientes ? Math.round(receitaCentimos / clientes) : null,
  };

  /* o que não se sabe tem de ser dito — nunca transformado em zero */
  const semDados = {
    custo: null,
    receita: dentro.length ? null : 'Ainda não há entradas registadas. Uma fatura emitida fora do Órbita só entra se a escreveres aqui.',
    cambio: cambio.fonte === 'padrao' ? cambio.nota : null,
  };
  const avisosCusto = [];
  if (midiaDesconhecidas > 0) {
    avisosCusto.push(`${midiaDesconhecidas === 1 ? 'Uma geração de mídia ficou' : `${midiaDesconhecidas} gerações de mídia ficaram`} fora da soma: o fornecedor não devolveu custo e a estimativa não é fiável.`);
  }
  if (uso.length === 0) {
    avisosCusto.push('Sem chamadas de IA registadas neste período: a parte da IA é 0 porque não houve consumo, não porque não se mede.');
  } else if (conta.desconhecidas > 0) {
    const semPreco = listaOr([...new Set(conta.linhas.filter((l) => l.desconhecidas).map((l) => `${l.fornecedor}/${l.modelo}`))].slice(0, 4));
    avisosCusto.push(`${conta.desconhecidas === 1 ? 'Uma chamada ficou' : `${conta.desconhecidas} chamadas ficaram`} fora da soma: não há preço conhecido para ${semPreco}. Declara-o em ORBITA_PRECOS_IA e o saldo passa a incluí-lo.`);
  } else if (conta.linhas.every((l) => l.microUsd === 0) && midiaMicro === 0) {
    avisosCusto.push('Todas as chamadas deste período foram a modelos gratuitos do catálogo — o custo é 0 e está medido.');
  }
  semDados.custo = avisosCusto.length ? avisosCusto.join(' ') : null;

  return {
    janela: { dias: janelaDias, desde },
    receitaCentimos,
    custoCentimos,
    margemCentimos,
    porCampanha: [...mapaCampanha.entries()].map(([campanha, cents]) => ({ campanha, cents })).sort((a, b) => b.cents - a.cents),
    custosPorFornecedor: custosPorFornecedor.sort((a, b) => b.microUsd - a.microUsd),
    unitarios,
    midia,
    custosPorProjeto: porEntidade('projeto').slice(0, 12),
    custosPorLead: porEntidade('lead').slice(0, 12),
    tarefas: {
      total: tarefasDentro.length,
      custoCentimos: centimosDeMicro(custoTarefas, cambio.taxa),
      semCusto: tarefasSemCusto,
    },
    contaAVista: {
      linhas: conta.linhas,
      microUsd: conta.microUsd,
      centimos: custoCentimos,
      desconhecidas: conta.desconhecidas,
      cambio,
      moeda: MOEDA,
      nota: 'preços por milhão de tokens, do catálogo do Órbita ou de ORBITA_PRECOS_IA — é uma conta, não uma fatura do fornecedor',
    },
    semDados,
    entradas: dentro.slice(-40).reverse(),
  };
}
