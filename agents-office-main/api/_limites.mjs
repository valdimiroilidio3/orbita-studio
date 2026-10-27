/* ===========================================================================
   Limites, cache e consumo da pesquisa (1.30.0, 27 out 2026).

   Porquê este ficheiro: até aqui cada clique na gaveta era um pedido novo à API
   do fornecedor — sem cache, sem contagem, sem travão. Num plano gratuito isso
   é uma conta que se paga sozinha: a Tavily dá 1 000 créditos por mês e o
   Geoapify 3 000 por dia (5 pedidos/s). Um agente em ciclo esgota qualquer um
   dos dois numa tarde — e o pior nem é o dinheiro, é a pesquisa deixar de
   funcionar sem ninguém perceber porquê.

   Três coisas, e nenhuma é decorativa:

     · CACHE — a mesma pergunta dentro de 5 minutos não volta a sair do
       computador. É a defesa mais barata e a que mais se nota.
     · LIMITES — janela deslizante por minuto e orçamento por dia/mês, com os
       números reais do plano gratuito. Quando estoura, a resposta diz «limite»
       ou «quota» com o tempo de espera — não se insiste em ciclo.
     · CONSUMO — quantas chamadas, quantos créditos, quantas foram servidas pela
       cache e quantas foram recusadas. É isto que `/pesquisa/uso` mostra.

   Honestidade sobre o alcance: a função da Vercel é sem estado, por isso estes
   contadores vivem **por instância** e podem reiniciar. São um travão de
   segurança, não um medidor de facturação. O número que conta para a factura
   está no painel do fornecedor, e é lá que se confirma.
   =========================================================================== */

/** O que o plano gratuito dá, com a fonte. Números lidos da documentação, não inventados. */
export const PLANOS = {
  tavily: {
    nome: 'Tavily',
    credito: 'crédito',
    mes: 1000,               // docs.tavily.com: Free = 1 000 créditos/mês
    porDia: 60,              // travão nosso: não queimar o mês numa tarde
    porMinuto: 20,
    custoPorCredito: 0.008,  // pay-as-you-go, se o plano gratuito acabar
    moeda: 'USD',
    fonte: 'https://docs.tavily.com/documentation/api-credits',
  },
  geoapify: {
    nome: 'Geoapify',
    credito: 'crédito',
    dia: 3000,               // geoapify.com/pricing: Free = 3 000 créditos/dia
    porSegundo: 5,
    porMinuto: 60,
    custoPorCredito: 59 / 10000, // plano API 10: 10 000/dia por 59 USD
    moeda: 'USD',
    fonte: 'https://www.geoapify.com/pricing/',
  },
};

const numero = (v, defeito) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : defeito);

/** Limites efectivos de um fornecedor: o plano, corrigido pelo ambiente quando o dono sobe de plano. */
export function limitesDe(id, env = process.env) {
  const base = PLANOS[id];
  if (!base) return null;
  const maiusculas = String(id).toUpperCase();
  return {
    ...base,
    mes: base.mes ? numero(env[`ORBITA_LIMITE_${maiusculas}_MES`], base.mes) : null,
    dia: base.dia ? numero(env[`ORBITA_LIMITE_${maiusculas}_DIA`], base.dia) : null,
    porDia: base.porDia ? numero(env[`ORBITA_LIMITE_${maiusculas}_DIA`], base.porDia) : null,
    porMinuto: numero(env[`ORBITA_LIMITE_${maiusculas}_MIN`], base.porMinuto),
  };
}

/* ---------- o estado em memória ---------- */
const vazio = () => ({ minutos: [], dia: null, diaN: 0, mes: null, mesN: 0, chamadas: 0, cacheHits: 0, recusas: 0, creditos: 0, erros: 0, ultimoErro: null, ultimaChamada: null });
const ESTADO = new Map();
const CACHE = new Map();
const CACHE_MAX = 250;
export const CACHE_TTL_MS = 5 * 60 * 1000;

const de = (id) => {
  if (!ESTADO.has(id)) ESTADO.set(id, vazio());
  return ESTADO.get(id);
};
const hoje = (agora = Date.now()) => new Date(agora).toISOString().slice(0, 10);
const mesDe = (agora = Date.now()) => new Date(agora).toISOString().slice(0, 7);

/**
 * Pede autorização para gastar `custo` créditos deste fornecedor.
 * Devolve `{ ok, codigo, esperarMs, estado }` — nunca lança.
 */
export function consumir(id, { custo = 1, env = process.env, agora = Date.now() } = {}) {
  const lim = limitesDe(id, env);
  if (!lim) return { ok: false, codigo: 'fornecedor-desconhecido', esperarMs: 0, estado: null };
  const e = de(id);

  /* janela de um minuto, deslizante: só conta o que aconteceu no último minuto */
  e.minutos = e.minutos.filter((t) => agora - t < 60_000);
  if (e.minutos.length + custo > lim.porMinuto) {
    const esperar = e.minutos.length ? 60_000 - (agora - e.minutos[0]) : 1000;
    e.recusas++;
    return { ok: false, codigo: 'limite', esperarMs: Math.max(500, esperar), estado: e, limite: lim, motivo: `limite de ${lim.porMinuto} pedidos por minuto` };
  }

  if (lim.dia) {
    const d = hoje(agora);
    if (e.dia !== d) { e.dia = d; e.diaN = 0; }
    if (e.diaN + custo > lim.dia) {
      e.recusas++;
      return { ok: false, codigo: 'quota', esperarMs: msAteAmanha(agora), estado: e, limite: lim, motivo: `quota de ${lim.dia} créditos por dia` };
    }
  }
  if (lim.mes) {
    const m = mesDe(agora);
    if (e.mes !== m) { e.mes = m; e.mesN = 0; }
    if (e.mesN + custo > lim.mes) {
      e.recusas++;
      return { ok: false, codigo: 'quota', esperarMs: msAteProximoMes(agora), estado: e, limite: lim, motivo: `quota de ${lim.mes} créditos por mês` };
    }
  }
  if (lim.porDia && !lim.dia) {
    const d = hoje(agora);
    if (e.dia !== d) { e.dia = d; e.diaN = 0; }
    if (e.diaN + custo > lim.porDia) {
      e.recusas++;
      return { ok: false, codigo: 'quota', esperarMs: msAteAmanha(agora), estado: e, limite: lim, motivo: `travão diário de ${lim.porDia} créditos` };
    }
  }

  e.minutos.push(agora);
  e.diaN += custo;
  e.mesN += custo;
  e.chamadas++;
  e.creditos += custo;
  e.ultimaChamada = new Date(agora).toISOString();
  return { ok: true, codigo: null, esperarMs: 0, estado: e, limite: lim };
}

const msAteAmanha = (agora) => {
  const d = new Date(agora);
  const amanha = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(60_000, amanha - agora);
};
const msAteProximoMes = (agora) => {
  const d = new Date(agora);
  return Math.max(60_000, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - agora);
};

/** Regista o desfecho de uma chamada que já aconteceu. */
export function registarFim(id, { ok = true, cache = false, erro = null, custo = 1 } = {}) {
  const e = de(id);
  if (cache) e.cacheHits++;
  if (!ok) { e.erros++; e.ultimoErro = erro ? String(erro).slice(0, 200) : 'erro sem mensagem'; }
  if (ok && cache) e.creditos = Math.max(0, e.creditos - custo);
  return e;
}

/* ---------- a cache ---------- */
const chaveCache = (id, chave) => `${id}|${chave}`;

export function lerCache(id, chave, agora = Date.now()) {
  const k = chaveCache(id, chave);
  const guardado = CACHE.get(k);
  if (!guardado) return null;
  if (guardado.expira <= agora) { CACHE.delete(k); return null; }
  CACHE.delete(k); CACHE.set(k, guardado);        // LRU: o que se usa fica no fim
  return { valor: guardado.valor, expiraEm: new Date(guardado.expira).toISOString(), idadeMs: agora - guardado.criado };
}

export function guardarCache(id, chave, valor, { ttlMs = CACHE_TTL_MS, agora = Date.now() } = {}) {
  const k = chaveCache(id, chave);
  CACHE.set(k, { valor, criado: agora, expira: agora + ttlMs });
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return true;
}

export function limparCache(id = null) {
  if (!id) return CACHE.clear();
  for (const k of [...CACHE.keys()]) if (k.startsWith(`${id}|`)) CACHE.delete(k);
  return true;
}

/* ---------- o retrato do consumo ---------- */
export function uso(env = process.env, agora = Date.now()) {
  const hojeStr = hoje(agora);
  const linhas = Object.keys(PLANOS).map((id) => {
    const lim = limitesDe(id, env);
    const e = de(id);
    const minutos = e.minutos.filter((t) => agora - t < 60_000).length;
    const diaN = e.dia === hojeStr ? e.diaN : 0;
    const mesN = e.mes === mesDe(agora) ? e.mesN : 0;
    const tetoDia = lim.dia || lim.porDia || null;
    return {
      fornecedor: id,
      nome: lim.nome,
      chamadas: e.chamadas,
      cacheHits: e.cacheHits,
      recusas: e.recusas,
      erros: e.erros,
      ultimoErro: e.ultimoErro,
      ultimaChamada: e.ultimaChamada,
      creditos: {
        hoje: diaN,
        mes: mesN,
        tetoDia,
        tetoMes: lim.mes,
        restanteDia: tetoDia == null ? null : Math.max(0, tetoDia - diaN),
        restanteMes: lim.mes == null ? null : Math.max(0, lim.mes - mesN),
      },
      janela: { porMinuto: lim.porMinuto, usadoNoMinuto: minutos },
    };
  });
  const porMinutoTotal = linhas.reduce((n, l) => n + l.janela.usadoNoMinuto, 0);
  return {
    fornecedores: linhas,
    cache: { entradas: CACHE.size, maximo: CACHE_MAX, ttlSegundos: Math.round(CACHE_TTL_MS / 1000) },
    janela: { pedidosNoUltimoMinuto: porMinutoTotal },
    quando: new Date(agora).toISOString(),
    nota: 'contadores por instância da função: servem de travão, não de factura. O número que conta está no painel do fornecedor.',
  };
}

/** Só para testes e para o botão «limpar» do Centro de Controlo. */
export function reiniciar() {
  ESTADO.clear();
  CACHE.clear();
}
