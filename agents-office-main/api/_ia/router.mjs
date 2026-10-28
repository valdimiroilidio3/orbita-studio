/* ===========================================================================
   1.18.0 · O MODEL ROUTER (30 out 2026)

   A pergunta que este ficheiro responde, por cada passo de trabalho:
   «qual é o modelo mais capaz que está disponível agora e que custa o que
   podemos gastar?»

   Como decide:
     1. cada TIPO de trabalho tem etiquetas exigidas e preferidas (plano pede
        raciocínio; código pede código; visão pede visão…);
     2. só entram modelos de fornecedores COM CHAVE no ambiente e que não
        estejam desligados no Control Center;
     3. o preferido do agente (se configurado) vai à frente;
     4. o resto ordena-se por: etiquetas exigidas, custo (gratuito primeiro),
        contexto, latência histórica (média real registada), nome;
     5. o resultado é uma CADEIA — o router tenta um, e se falhar passa ao
        seguinte, sem repetir o par (fornecedor, modelo) e sem repetir pedido
        quando o erro não é retentável (chave recusada, modelo inexistente).

   Limites: cada execução tem orçamento (chamadas e tokens). Esgotado, para —
   não continua a gastar para «parecer que trabalhou».
   =========================================================================== */
import { FORNECEDORES, MODELOS, SEM_CHAVE } from './catalogo.mjs';

export const TIPOS = {
  /* `exige` filtra (sem isso o modelo não serve); `gosta` só ordena. Misturar os
     dois foi o primeiro erro deste router: «revisão» exigia `contexto` e nenhum
     modelo gratuito do catálogo o declarava — a revisão nunca corria. */
  plano: { exige: ['raciocinio'], gosta: ['contexto', 'ferramentas'], nota: 'dividir o trabalho e decidir a ordem' },
  codigo: { exige: ['codigo'], gosta: ['ferramentas', 'contexto'], nota: 'escrever código que corra' },
  backend: { exige: ['codigo'], gosta: ['raciocinio', 'ferramentas'], nota: 'APIs, dados e permissões' },
  ui: { exige: ['texto'], gosta: ['codigo', 'ferramentas'], nota: 'estrutura de interface e design system' },
  auditoria: { exige: ['codigo'], gosta: ['raciocinio', 'contexto'], nota: 'ler código à procura de erros' },
  qa: { exige: ['codigo'], gosta: ['raciocinio'], nota: 'testes e regressões' },
  revisao: { exige: ['raciocinio'], gosta: ['contexto', 'ferramentas'], nota: 'verificar o resultado de outro agente' },
  texto: { exige: ['texto'], gosta: ['raciocinio'], nota: 'escrever para pessoas' },
  investigar: { exige: ['texto'], gosta: ['raciocinio', 'contexto'], nota: 'recolher e resumir fontes' },
  visao: { exige: ['visao'], gosta: ['texto'], nota: 'ler imagens e referências visuais' },
  rapido: { exige: ['rapido'], gosta: ['barato'], nota: 'passos curtos, baratos' },
};

const temEtiqueta = (m, r) => Array.isArray(m.etiquetas) && m.etiquetas.includes(r);
const precoDe = (m) => (Array.isArray(m.preco) ? (m.preco[0] + m.preco[1]) : 999);

/** Um modelo só entra se o fornecedor estiver utilizável e não desligado.
 *
 * «Utilizável» = tem chave no ambiente **ou** não precisa dela (keyless).
 * Esta segunda metade faltava: o Kilo e o OVH apareciam como configurados no
 * estado e nunca entravam numa cadeia — o orquestrador dizia «todos os modelos
 * falharam» tendo um fornecedor a responder. Visto em produção a 27 out 2026.
 */
export function fornecedorActivo(id, { chaves = {}, desligados = [] } = {}) {
  const prov = FORNECEDORES[id];
  if (!prov) return false;
  if (desligados.includes(id)) return false;
  if (chaves[id]) return true;
  /* 1.33.0 · chave publicada pelo próprio serviço (OpenCode Zen: `public`) */
  if (prov.chavePublica && prov.usavel !== false) return true;
  return !!prov.keyless && prov.usavel !== false;
}

/* 1.23.1 · o que o fornecedor já disse que não tem
   A 27 out 2026 o LLM7 respondeu «Model 'gpt-oss-20b' is currently unavailable»
   e o router insistiu nele em cada passo, gastando a cadeia toda. Aqui guarda-se
   o que foi recusado por não existir, com prazo (6 h), e a cadeia seguinte já
   não conta com isso. É memória curta e descartável — não vai para a base. */
const FORA = new Map();
const FORA_MS = 6 * 60 * 60 * 1000;
const chaveDe = (fornec, modelo) => `${fornec}\u0000${modelo}`;

export function marcarFora(fornec, modelo, motivo = '') {
  FORA.set(chaveDe(fornec, modelo), { at: Date.now(), motivo: String(motivo).slice(0, 120) });
}

export function foraDoAr(fornec, modelo, agora = Date.now()) {
  const r = FORA.get(chaveDe(fornec, modelo));
  if (!r) return false;
  if (agora - r.at > FORA_MS) { FORA.delete(chaveDe(fornec, modelo)); return false; }
  return true;
}

export function limparFora() { FORA.clear(); }

/* 1.32.0 · em serverless, a memória do processo morre a cada invocação — a lista
   de «este modelo não existe» perdia-se e o mesmo erro era pago outra vez. Isto
   permite ao motor guardá-la na base e recuperá-la no pedido seguinte. */
export function exportarFora(agora = Date.now()) {
  const saida = {};
  for (const [chave, r] of FORA) {
    if (agora - r.at > FORA_MS) continue;
    saida[chave.replace('\u0000', '/')] = { at: r.at, motivo: r.motivo };
  }
  return saida;
}

export function importarFora(mapa = {}, agora = Date.now()) {
  let n = 0;
  for (const [chave, r] of Object.entries(mapa || {})) {
    if (!r || !Number.isFinite(Number(r.at))) continue;
    if (agora - Number(r.at) > FORA_MS) continue;
    const [fornec, ...resto] = String(chave).split('/');
    const modelo = resto.join('/');
    if (!fornec || !modelo) continue;
    FORA.set(chaveDe(fornec, modelo), { at: Number(r.at), motivo: String(r.motivo || '').slice(0, 120) });
    n += 1;
  }
  return n;
}

/** A frase que os fornecedores usam quando o modelo não existe/está desligado. */
export const eModeloIndisponivel = (erro) =>
  /(unavailable|not found|does not exist|não existe|nao existe|decommission|descontinuad|no such model)/i.test(String(erro || ''));

/**
 * Cadeia ordenada de candidatos para um tipo de trabalho.
 * `chaves` = {openrouter:'OPENROUTER_API_KEY', …} (só ids, nunca segredos).
 */
export function cadeia(tipo, {
  chaves = {}, desligados = [], preferido = null, catalogo = MODELOS,
  latencias = {}, tentados = [], limite = 4, semRepetir = true,
  usados = {},          // `${fornec}/${modelo}` que já responderam num teste real
  provados = [],        // lista curada (medida em produção) — ver _ia/gratuitos.mjs
  agora = Date.now(),
} = {}) {
  /* `chaves` traz SEM_CHAVE para os keyless: isso não é uma chave, é a marca de
     «não precisa». Contar isso como «tem chave» fazia os gratuitos passarem à
     frente de quem tinha uma chave paga — o contrário do que se quer. */
  const chaveReal = (id) => !!chaves?.[id] && !String(chaves[id]).startsWith('\u0000');
  const haChaves = Object.keys(chaves || {}).some(chaveReal);
  const alvo = TIPOS[tipo] || TIPOS.texto;
  const exigidas = alvo.exige;
  const desejadas = alvo.gosta || [];
  const jaTentados = new Set(tentados.map((t) => `${t.fornec}\u0000${t.modelo}`));

  const disponiveis = catalogo
    .filter((m) => fornecedorActivo(m.fornecedor, { chaves, desligados }))
    /* 1.42.0 · um modelo que só existe no tier com chave não entra na cadeia
       anónima (o `openai` do Pollinations): seria uma tentativa perdida. */
    .filter((m) => !(m.soComChave && !chaveReal(m.fornecedor)))
    .filter((m) => !(semRepetir && jaTentados.has(`${m.fornecedor}\u0000${m.modelo}`)))
    .filter((m) => !foraDoAr(m.fornecedor, m.modelo, agora));

  /* 1.32.0 · o que já respondeu de verdade entra na lista, mesmo que o catálogo
     não tenha esse par. Foi exactamente o que faltou ao LLM7: o `codestral-latest`
     respondeu 16 vezes em produção e nunca era escolhido, porque o catálogo só
     o registava para a Mistral. Sem isto, a cadeia insistia em modelos que o
     fornecedor diz não ter. */
  /* 1.32.0 · o que já respondeu de verdade entra na lista — e, se o catálogo já
     tinha o par, fica com as etiquetas dos dois. Foi exactamente o que faltou ao
     LLM7: o `codestral-latest` respondeu 16 vezes em produção, o catálogo
     conhecia-o mas sem `rapido`/`codigo`, e a cadeia preferia modelos que o
     fornecedor diz não ter. */
  const chaveDoPar = (fornec, modelo) => `${fornec}\u0000${modelo}`;
  const juntos = new Map(disponiveis.map((m) => [chaveDoPar(m.fornecedor, m.modelo), { ...m, etiquetas: [...(m.etiquetas || [])] }]));

  for (const p of (provados || [])) {
    if (!p?.fornec || !p?.modelo) continue;
    if (!fornecedorActivo(p.fornec, { chaves, desligados })) continue;
    if (semRepetir && jaTentados.has(chaveDoPar(p.fornec, p.modelo))) continue;
    if (foraDoAr(p.fornec, p.modelo, agora)) continue;
    const chave = chaveDoPar(p.fornec, p.modelo);
    const existente = juntos.get(chave);
    if (existente) {
      existente.etiquetas = [...new Set([...existente.etiquetas, ...(p.etiquetas || [])])];
      existente.curado = true;
    } else {
      juntos.set(chave, {
        fornecedor: p.fornec, modelo: p.modelo,
        etiquetas: p.etiquetas || ['texto'],
        janela: p.janela || 0, preco: p.preco || [0, 0], curado: true, ms: p.ms || 0,
      });
    }
  }

  const comCurados = [...juntos.values()];
  /* o bónus é pelo PAR, não por ter entrado pela lista: um modelo do catálogo que
     também está medido em produção tem o mesmo direito à frente. */
  const chavesCuradas = new Map((provados || []).map((p) => [chaveDoPar(p.fornec, p.modelo), p]));

  /* Exigir a etiqueta é a regra; mas se o único fornecedor disponível não a
     declarar, é melhor tentar do que responder «todos os modelos falharam»
     sem ter chamado ninguém. A cadeia leva `relaxado: true` e o uso fica
     registado com essa marca — não se esconde a diferença.
     (Visto a 27 out 2026: só o LLM7 respondia e nenhum modelo dele declara
     `raciocinio`, por isso o passo «plano» ficava sem candidatos.) */
  let relaxado = false;
  let candidatos = comCurados.filter((m) => exigidas.every((r) => temEtiqueta(m, r)));
  if (!candidatos.length && !exigidas.includes('visao')) {
    /* Visão não se relaxa: um modelo sem olhos não lê uma imagem. Mais vale
       dizer que não há, do que aceitar um trabalho que não sabe fazer. */
    relaxado = true;
    candidatos = comCurados.filter((m) => temEtiqueta(m, 'texto'));
  }

  const pontos = (m) => {
    let p = 0;
    /* 1.42.0 · o preferido pode ser um FORNECEDOR (modelo nulo): assim o melhor
       modelo desse fornecedor para cada tipo vai à frente. Era o que faltava ao
       Pollinations com chave — fixar o `openai` deixava os tipos que ele não
       declara (raciocínio, código) a cair noutro fornecedor sem necessidade. */
    if (preferido && preferido.fornecedor === m.fornecedor && (!preferido.modelo || preferido.modelo === m.modelo)) p += 1000;
    /* 1.32.0 · medido a responder em produção: parte à frente do catálogo.
       O `ms` medido desempata — o mais rápido primeiro. */
    const medido = chavesCuradas.get(`${m.fornecedor}\u0000${m.modelo}`);
    /* 1.32.0 · quem configura uma chave quer usá-la: nesse caso o bónus do
       «medido em produção» só conta para quem tem chave, e os keyless recuam
       (mas ficam na cadeia — são o fallback). Sem chave nenhuma, os gratuitos
       mandam: é o estado normal deste escritório. */
    const semChavePropria = !chaveReal(m.fornecedor) && FORNECEDORES[m.fornecedor]?.keyless;
    if (medido && !(haChaves && semChavePropria)) p += 2000 - Math.min(40, (medido.ms || 0) / 1000);
    if (haChaves && semChavePropria) p -= 900;
    /* quem já passou num teste REAL deste fornecedor vem à frente */
    if (usados[`${m.fornecedor}/${m.modelo}`] || usados[`${m.fornecedor}\u0000${m.modelo}`]) p += 320;
    p += exigidas.filter((r) => temEtiqueta(m, r)).length * 10;
    p += desejadas.filter((r) => temEtiqueta(m, r)).length * 4;
    p += (m.etiquetas || []).filter((r) => r === 'ferramentas').length * 6;   // quem tem mãos serve mais
    p -= precoDe(m) / 10;                                                     // barato primeiro
    /* 1.44.9 · um modelo descoberto que nunca respondeu não é igual a um
       declarado: é uma aposta. Não se proíbe — é assim que se descobrem
       modelos novos — mas não passa à frente de quem já respondeu. */
    if (m.descoberto && !medido) p -= 120;
    p += Math.min(6, (m.janela || 0) / 50000);                                // contexto ajuda
    const lat = latencias[`${m.fornecedor}\u0000${m.modelo}`];
    if (Number.isFinite(lat)) p -= Math.min(8, lat / 800);                    // o que já foi rápido, primeiro
    return p;
  };

  const ordenado = [...candidatos].sort((a, b) => pontos(b) - pontos(a) || String(a.modelo).localeCompare(String(b.modelo)));
  return ordenado
    .slice(0, limite)
    .map((m) => ({ fornec: m.fornecedor, modelo: m.modelo, etiquetas: m.etiquetas || [], janela: m.janela || 0, preco: m.preco || [0, 0], relaxado }));
}

/** O que este router sabe sobre o mundo, para a interface poder ser honesta. */
export function diagnostico({ chaves = {}, desligados = [] } = {}) {
  const activos = Object.keys(FORNECEDORES).filter((id) => fornecedorActivo(id, { chaves, desligados }));
  const comModelos = activos.filter((id) => MODELOS.some((m) => m.fornecedor === id));
  const semModelo = activos.filter((id) => !MODELOS.some((m) => m.fornecedor === id));
  return {
    fornecedoresActivos: activos,
    fornecedoresComCatalogo: comModelos,
    fornecedoresSemCatalogo: semModelo,
    pronto: comModelos.length > 0,
    tipos: Object.keys(TIPOS),
  };
}

/**
 * Orçamento de uma execução. Não é decoração: é o que impede um agente de
 * correr em círculos a gastar quota.
 */
export function orcamento({ maxChamadas = 14, maxTokens = 120000 } = {}) {
  return {
    maxChamadas, maxTokens, chamadas: 0, tokens: 0, custoCentimos: 0,
    gastar(uso = {}, ms = 0, modelo = null) {
      this.chamadas += 1;
      this.tokens += (uso.entrada || 0) + (uso.saida || 0);
      if (modelo && Array.isArray(modelo.preco)) {
        const entrada = (uso.entrada || 0) / 1e6 * modelo.preco[0];
        const saida = (uso.saida || 0) / 1e6 * modelo.preco[1];
        this.custoCentimos += Math.round((entrada + saida) * 100);
      }
      this.ultimaMs = ms;
      if (this.chamadas > this.maxChamadas) throw Object.assign(new Error(`orçamento de chamadas esgotado (${this.maxChamadas})`), { codigo: 'orcamento' });
      if (this.tokens > this.maxTokens) throw Object.assign(new Error(`orçamento de tokens esgotado (${this.maxTokens})`), { codigo: 'orcamento' });
    },
    resumo() {
      return { chamadas: this.chamadas, tokens: this.tokens, custoCentimos: this.custoCentimos, maxChamadas: this.maxChamadas, maxTokens: this.maxTokens };
    },
  };
}

/**
 * Fala com o primeiro modelo da cadeia que responder, e cai para o seguinte
 * quando o erro é do tipo que se resolve a tentar outro.
 *
 * `executar(entrada, tentativa)` faz a chamada verdadeira e devolve o resultado
 * do cliente; `registar(evento)` guarda uso/erro (nunca a chave).
 */
export async function falarComFallback(tipo, {
  chaves = {}, desligados = [], preferido = null, latencias = {},
  cadeiaFixa = null, executar, registar = () => {}, orc = orcamento(), catalogo = MODELOS, limite = 4,
  usados = {}, provados = [],
} = {}) {
  const fila = cadeiaFixa || cadeia(tipo, { chaves, desligados, preferido, latencias, catalogo, limite, usados, provados });
  if (!fila.length) {
    const e = new Error(`nenhum modelo disponível para «${tipo}» — falta configurar um fornecedor no Control Center`);
    e.codigo = 'semmotor';
    throw e;
  }
  const erros = [];
  for (let i = 0; i < fila.length; i += 1) {
    const entrada = fila[i];
    const t0 = Date.now();
    try {
      const r = await executar(entrada, { tentativa: i + 1, ultima: i === fila.length - 1 });
      orc.gastar(r?.uso, r?.ms, { preco: entrada.preco });
      registar({ ok: true, ...entrada, ms: r?.ms ?? Date.now() - t0, uso: r?.uso });
      return { ...r, entrada, tentativas: i + 1, erros };
    } catch (e) {
      const ms = Date.now() - t0;
      erros.push({ fornec: entrada.fornec, modelo: entrada.modelo, erro: e.message, codigo: e.codigo || '' });
      registar({ ok: false, ...entrada, ms, erro: e.message, codigo: e.codigo || '' });
      if (e.codigo === 'orcamento') throw e;
      /* o fornecedor disse que este modelo não existe: não vale a pena insistir
         nas próximas chamadas (a cadeia seguinte já o deixa de fora) */
      if (eModeloIndisponivel(e.message)) marcarFora(entrada.fornec, entrada.modelo, e.message);
      const valeTentarOutro = e.retentavel || ['limite', 'avaria', 'tempo', 'rede', 'modelo', 'credito'].includes(e.codigo);
      if (!valeTentarOutro && i === fila.length - 1) break;
      if (!valeTentarOutro) continue;   // chave recusada / pedido inválido: passa ao próximo modelo
    }
  }
  /* 1.52.0 · quando a cadeia tem uma entrada só, a frase não pode dizer «todos os
     modelos falharam»: o dono escolheu UM, e é esse que não respondeu. */
  const e = new Error(fila.length === 1
    ? `o modelo escolhido não respondeu — ${erros.map((x) => `${x.fornec}/${x.modelo}: ${x.erro}`).join(' · ')}`
    : `todos os modelos falharam para «${tipo}»: ${erros.map((x) => `${x.fornec}/${x.modelo} — ${x.erro}`).join(' · ')}`);
  e.codigo = 'todosfalharam';
  e.erros = erros;
  throw e;
}
