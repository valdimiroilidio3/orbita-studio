/* ===========================================================================
   A camada de ferramentas da pesquisa (1.30.0, 27 out 2026).

   O problema que resolve: as rotas chamavam `_pesquisa.mjs` directamente. Isso
   funciona enquanto só a interface pesquisa — mas os agentes também precisam de
   procurar, e um agente não pode chamar um módulo: precisa de uma **ferramenta**
   com nome, contrato, limite, cache e registo do que aconteceu.

   Aqui cada ferramenta tem sempre a mesma forma de resposta, seja qual for o
   fornecedor por trás:

     { ok, ferramenta, fornecedor, ms, cache, avisos[], fontes[], dados,
       erro, codigo, real, inferido }

   `real: true, inferido: false` quer dizer: tudo o que vem em `dados` foi
   devolvido por uma API, com o endereço da fonte. Se um dia uma ferramenta
   resumir com um modelo, marca `inferido: true` e diz que modelo foi — um agente
   que não sabe distinguir facto de redacção inventa com muita segurança.

   Trocar de fornecedor é mudar uma variável de ambiente (`ORBITA_FONTE_WEB`,
   `ORBITA_FONTE_EMPRESAS`): os adaptadores vivem em `ADAPTADORES`, e nem os
   agentes nem as rotas sabem qual está ligado.
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import * as pesquisa from './_pesquisa.mjs';
import { consumir, lerCache, guardarCache, registarFim, limitesDe } from './_limites.mjs';

/* ---------- o catálogo: o que existe, para quem, e a que custa ---------- */
export const FERRAMENTAS = [
  {
    nome: 'pesquisar_empresas',
    titulo: 'Pesquisar empresas',
    dominio: 'empresas',
    oQue: 'Empresas reais por atividade e zona (OpenStreetMap via Geoapify): nome, morada, coordenadas, categoria, telefone e site quando existem. É a fonte dos leads.',
    para: ['sales', 'ops', 'brain'],
    custoAproximado: '1 crédito Geoapify por cada 20 empresas',
  },
  {
    nome: 'pesquisar_web',
    titulo: 'Pesquisar na web',
    dominio: 'web',
    oQue: 'Pesquisa web em tempo real com resposta curta, excertos e o endereço de cada fonte; modo notícias com recorte temporal.',
    para: ['marketing', 'sales', 'delivery', 'brain'],
    custoAproximado: '1 crédito Tavily (2 em profundidade avançada)',
  },
  {
    nome: 'ler_pagina',
    titulo: 'Ler uma página',
    dominio: 'web',
    oQue: 'Extrai o texto limpo de um endereço já conhecido — para ir ao detalhe sem adivinhar a partir do excerto.',
    para: ['marketing', 'delivery', 'brain'],
    custoAproximado: '1 crédito Tavily por página',
  },
];

const porNome = new Map(FERRAMENTAS.map((f) => [f.nome, f]));
export const ferramenta = (nome) => porNome.get(nome) || null;

/* ---------- adaptadores: um por fornecedor, todos com a mesma boca ---------- */
const ADAPTADORES = {
  empresas: {
    geoapify: {
      nome: 'geoapify',
      custo: (args) => 1 + Math.ceil(Math.max(0, (Number(args.limite) || 20) - 20) / 20),
      async correr(args, { env, fetchImpl }) {
        return pesquisa.procurarLeads({
          oQue: args.oQue, onde: args.onde, categoria: args.categoria || null,
          limite: args.limite, raio: args.raio, pais: args.pais || null, lang: args.lang || 'pt',
        }, { env, fetchImpl });
      },
    },
  },
  web: {
    tavily: {
      nome: 'tavily',
      custo: (args) => (args.profundidade === 'advanced' ? 2 : 1),
      async correr(args, { env, fetchImpl }) {
        return pesquisa.pesquisarWeb({
          consulta: args.consulta, limite: args.limite, profundidade: args.profundidade,
          topico: args.topico || 'general', dias: args.dias || null, dominios: args.dominios || null,
          minRelevancia: args.minRelevancia,
        }, { env, fetchImpl });
      },
      async ler(url, { env, fetchImpl }) {
        return pesquisa.extrairPagina({ url }, { env, fetchImpl });
      },
    },
  },
};

export const fornecedorDe = (dominio, env = process.env) => {
  const pedido = String(
    dominio === 'empresas' ? env.ORBITA_FONTE_EMPRESAS || 'geoapify' : env.ORBITA_FONTE_WEB || 'tavily',
  ).toLowerCase();
  const escolhido = ADAPTADORES[dominio]?.[pedido];
  return escolhido ? { ok: true, id: pedido, adaptador: escolhido } : { ok: false, id: pedido, disponiveis: Object.keys(ADAPTADORES[dominio] || {}) };
};

/* ---------- validação de parâmetros, antes de gastar um crédito ---------- */
const texto = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const inteiro = (v, defeito, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defeito;
};

function validar(nome, args = {}) {
  if (nome === 'pesquisar_empresas') {
    const onde = texto(args.onde || args.cidade || args.local, 120);
    const oQue = texto(args.categoria || args.oQue || args.atividade, 80);
    if (onde.length < 2) return { erro: 'diz a zona — cidade ou região (por exemplo «Coimbra»)' };
    if (!oQue) return { erro: 'diz a atividade — por exemplo «dentistas»' };
    return {
      valor: {
        onde, oQue,
        limite: inteiro(args.limite || args.limit, 20, 1, 50),
        raio: inteiro(args.raio || args.radiusMeters || args.radius, 12000, 100, 50000),
        pais: texto(args.pais || args.country, 2).toLowerCase() || null,
        lang: texto(args.lang, 5) || 'pt',
      },
    };
  }
  if (nome === 'pesquisar_web') {
    const consulta = texto(args.consulta || args.q || args.query, 400);
    if (consulta.length < 2) return { erro: 'diz o que pesquisar' };
    const topico = String(args.topico || args.topic || 'general').toLowerCase() === 'news' ? 'news' : 'general';
    return {
      valor: {
        consulta,
        limite: inteiro(args.limite || args.limit, 8, 1, 20),
        topico,
        dias: topico === 'news' ? inteiro(args.dias || args.days, 0, 0, 365) || null : null,
        dominios: Array.isArray(args.dominios || args.domains) ? (args.dominios || args.domains).slice(0, 10).map((d) => texto(d, 120)) : null,
        profundidade: args.profundidade === 'advanced' ? 'advanced' : 'basic',
        minRelevancia: args.minRelevancia == null ? undefined : Number(args.minRelevancia),
      },
    };
  }
  if (nome === 'ler_pagina') {
    const url = texto(args.url || args.endereco, 2000);
    if (!/^https?:\/\//i.test(url)) return { erro: 'passa um endereço http(s) completo' };
    return { valor: { url } };
  }
  return { erro: `ferramenta desconhecida: ${nome}` };
}

/* ---------- o registo de execuções ---------- */
const REGISTO = [];
const REGISTO_MAX = 200;

export function execucoes(limite = 30) {
  return REGISTO.slice(0, Math.max(1, limite));
}

export function limparExecucoes() {
  REGISTO.length = 0;
}

function anotar(registo) {
  REGISTO.unshift(registo);
  while (REGISTO.length > REGISTO_MAX) REGISTO.pop();
}

/* Quando não há base (o servidor MCP corre sozinho, ao lado do agente), o rasto
   fica num ficheiro de dados — que já está fora do git. Nada de chaves aqui: só
   ferramenta, estado, tempo, fontes e erro. */
const ficheiroDoRegisto = () => path.join(process.env.ORBITA_DATA_DIR || path.join(process.cwd(), 'data'), 'pesquisa-log.json');

function anotarEmFicheiro(registo) {
  try {
    const f = ficheiroDoRegisto();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let lista = [];
    try { lista = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { lista = []; }
    if (!Array.isArray(lista)) lista = [];
    lista.unshift({
      quando: registo.quando, ferramenta: registo.ferramenta, fornecedor: registo.fornecedor,
      ok: registo.ok, codigo: registo.codigo, ms: registo.ms, cache: registo.cache,
      fontes: registo.fontes.slice(0, 10), erro: registo.erro,
      pedido: registo.pedido ? JSON.parse(JSON.stringify(registo.pedido, (k, v) => (k === 'minRelevancia' ? undefined : v))) : null,
    });
    fs.writeFileSync(f, JSON.stringify(lista.slice(0, 300), null, 1));
  } catch { /* o registo nunca derruba a pesquisa */ }
}

/** O rasto em ficheiro, quando existe (execuções feitas pelo servidor MCP). */
export function execucoesEmFicheiro(limite = 20) {
  try {
    const lista = JSON.parse(fs.readFileSync(ficheiroDoRegisto(), 'utf8'));
    return Array.isArray(lista) ? lista.slice(0, Math.max(1, limite)) : [];
  } catch { return []; }
}

/** Uma linha de texto legível, do género que se lê no registo de alterações. */
function linhaDoRegisto(r) {
  const oQue = r.ferramenta === 'pesquisar_web' ? `«${r.pedido.consulta}»`
    : r.ferramenta === 'pesquisar_empresas' ? `«${r.pedido.oQue}» em ${r.pedido.onde}`
      : r.pedido.url;
  if (!r.ok) return `pesquisa · ${r.ferramenta} · ${r.fornecedor} · falhou (${r.codigo || 'erro'}) · ${oQue} · ${r.erro}`;
  const fontes = r.fontes.length ? ` · ${r.fontes.length} fonte(s)` : '';
  return `pesquisa · ${r.ferramenta} · ${r.fornecedor} · ok${r.cache ? ' (cache)' : ''} · ${r.ms} ms${fontes} · ${oQue}`;
}

/**
 * Executa uma ferramenta. Nunca lança: devolve sempre o envelope, com `ok:false`
 * e um `codigo` quando algo falha. É o que permite a um agente decidir o passo
 * seguinte em vez de rebentar a tarefa.
 */
export async function executar(nome, args = {}, { env = process.env, fetchImpl = fetch, repo = null, agora = Date.now() } = {}) {
  const t0 = Date.now();
  const def = ferramenta(nome);
  const base = { ok: false, ferramenta: nome, fornecedor: null, ms: 0, cache: false, fontes: [], avisos: [], dados: null, erro: null, codigo: null, real: true, inferido: false };

  if (!def) return concluir({ ...base, erro: `não conheço a ferramenta «${nome}»`, codigo: 'ferramenta-desconhecida', pedido: args }, t0, repo, env);

  const v = validar(nome, args);
  if (v.erro) return concluir({ ...base, erro: v.erro, codigo: 'parametros', pedido: args }, t0, repo, env);

  const escolha = fornecedorDe(def.dominio, env);
  if (!escolha.ok) {
    return concluir({ ...base, fornecedor: escolha.id, erro: `o fornecedor «${escolha.id}» não existe para ${def.dominio} (há: ${escolha.disponiveis.join(', ')})`, codigo: 'fornecedor-desconhecido', pedido: v.valor }, t0, repo, env);
  }
  const fornecedor = escolha.id;
  const adaptador = escolha.adaptador;
  const pedido = v.valor;

  /* Sem chave não se serve da cache: uma instalação mal configurada tem de dizer
     que está mal configurada, não fingir que respondeu. */
  const fontes = pesquisa.estado(env);
  const configurado = def.dominio === 'web' ? !!fontes.tavily?.disponivel : !!fontes.geoapify?.disponivel;
  if (!configurado) {
    const motivo = def.dominio === 'web' ? fontes.tavily?.motivo : fontes.geoapify?.motivo;
    return concluir({ ...base, fornecedor, pedido, erro: motivo || 'a fonte não está configurada', codigo: 'semchave' }, t0, repo, env);
  }

  /* cache primeiro: uma pergunta repetida não deve custar nada */
  const chave = JSON.stringify(Object.keys(pedido).sort().map((k) => [k, pedido[k]]));
  const guardado = lerCache(fornecedor, `${nome}:${chave}`, t0);
  if (guardado) {
    registarFim(fornecedor, { ok: true, cache: true });
    return concluir({ ...base, ...guardado.valor, ok: true, fornecedor, cache: true, ms: 0, pedido }, t0, repo, env);
  }

  const custo = adaptador.custo ? adaptador.custo(pedido) : 1;
  const autorizacao = consumir(fornecedor, { custo, env, agora: t0 });
  if (!autorizacao.ok) {
    return concluir({
      ...base, fornecedor, pedido,
      erro: `${autorizacao.motivo || 'limite atingido'} — ${espera(autorizacao.esperarMs)}`,
      codigo: autorizacao.codigo, esperarMs: autorizacao.esperarMs,
    }, t0, repo, env);
  }

  try {
    let bruto;
    if (nome === 'ler_pagina') bruto = await adaptador.ler(pedido.url, { env, fetchImpl });
    else bruto = await adaptador.correr(pedido, { env, fetchImpl });

    const normalizado = normalizar(nome, bruto, pedido);
    if (!normalizado.ok) {
      registarFim(fornecedor, { ok: false, erro: normalizado.erro });
      return concluir({ ...base, fornecedor, pedido, erro: normalizado.erro, codigo: normalizado.codigo || 'vazio', dados: normalizado.dados || null, avisos: normalizado.avisos || [] }, t0, repo, env);
    }
    const envelope = { ...base, ok: true, fornecedor, pedido, ...normalizado };
    const paraCache = { ...envelope };
    delete paraCache.ms;
    delete paraCache.pedido;
    guardarCache(fornecedor, `${nome}:${chave}`, paraCache, { agora: t0 });
    registarFim(fornecedor, { ok: true });
    return concluir(envelope, t0, repo, env);
  } catch (e) {
    registarFim(fornecedor, { ok: false, erro: e?.message });
    const codigo = e?.codigo === 'timeout' || e?.name === 'AbortError' ? 'timeout'
      : /429|limitar/.test(String(e?.message)) ? 'limite-fornecedor' : 'falha';
    return concluir({ ...base, fornecedor, pedido, erro: String(e?.message || e).slice(0, 300), codigo }, t0, repo, env);
  }
}

const espera = (ms) => {
  const s = Math.ceil((ms || 0) / 1000);
  if (s <= 1) return 'tenta outra vez daqui a um segundo';
  if (s < 90) return `tenta outra vez daqui a ${s} segundos`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `tenta outra vez daqui a ${m} minutos`;
  return `tenta outra vez amanhã (ou sobe de plano e ajusta ORBITA_LIMITE_*)`;
};

function normalizar(nome, bruto, pedido) {
  if (nome === 'pesquisar_empresas') {
    const empresas = Array.isArray(bruto?.leads) ? bruto.leads : [];
    const { unicos, repetidos } = semDuplicados(empresas);
    const avisos = [];
    if (bruto?.avisoZona) avisos.push(bruto.avisoZona);
    if (!unicos.length) {
      return {
        ok: false, codigo: 'vazio',
        erro: `nenhuma empresa encontrada para «${pedido.oQue}» em ${pedido.onde}`,
        dados: { empresas: [], centro: bruto?.centro || null, encontrados: 0 }, fontes: [], avisos,
      };
    }
    return {
      ok: true,
      dados: {
        empresas: unicos,
        centro: bruto?.centro || null,
        encontrados: unicos.length,
        repetidos,
        categoria: bruto?.categoria || null,
        pedido: bruto?.pedido || pedido,
      },
      fontes: unicos.filter((l) => l.website).map((l) => l.website).slice(0, 20),
      avisos,
    };
  }
  if (nome === 'pesquisar_web') {
    const resultados = Array.isArray(bruto?.resultados) ? bruto.resultados : [];
    const avisos = [];
    if (bruto?.descartados) avisos.push(`${bruto.descartados} resultado(s) ficaram abaixo do limiar de relevância (${bruto.limiar}) e não são apresentados`);
    if (!resultados.length) {
      return {
        ok: false, codigo: 'vazio',
        erro: bruto?.descartados
          ? `nada com relevância suficiente para «${pedido.consulta}» — a pesquisa devolveu ${bruto.descartados} resultado(s) fracos`
          : `a pesquisa não devolveu nada para «${pedido.consulta}»`,
        dados: { resultados: [], respostaCurta: null }, fontes: [], avisos,
      };
    }
    return {
      ok: true,
      dados: { resultados, respostaCurta: bruto?.respostaCurta || null, encontrados: resultados.length, descartados: bruto?.descartados || 0, limiar: bruto?.limiar ?? null, topico: bruto?.topico || pedido.topico },
      fontes: resultados.map((r) => r.url).filter(Boolean),
      avisos,
    };
  }
  if (nome === 'ler_pagina') {
    const textoLimpo = String(bruto?.texto || '').trim();
    if (!textoLimpo) {
      return { ok: false, codigo: 'vazio', erro: 'a página não devolveu texto legível (pode ser um PDF, um vídeo ou estar bloqueada)', dados: { url: bruto?.url || pedido.url, texto: '' }, fontes: [], avisos: [] };
    }
    return { ok: true, dados: { url: bruto?.url || pedido.url, titulo: bruto?.titulo || null, texto: textoLimpo, caracteres: textoLimpo.length }, fontes: [bruto?.url || pedido.url], avisos: [] };
  }
  return { ok: false, codigo: 'ferramenta-desconhecida', erro: 'sem normalizador' };
}

/** Elimina repetidos por identificador e por nome+morada; conta os que caíram. */
export function semDuplicados(empresas = []) {
  const vistos = new Set();
  const unicos = [];
  let repetidos = 0;
  for (const l of empresas) {
    const id = l['sítioId'] || l.sitioId || l.place_id || '';
    const nomeMorada = `${norm(l.nome || l.name)}|${norm(l.morada || l.address)}`;
    if ((id && vistos.has(`id:${id}`)) || vistos.has(`nm:${nomeMorada}`)) { repetidos++; continue; }
    if (id) vistos.add(`id:${id}`);
    vistos.add(`nm:${nomeMorada}`);
    unicos.push(l);
  }
  return { unicos, repetidos };
}
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Fecha o envelope: mede o tempo e escreve no registo (memória + base, se houver). */
async function concluir(envelope, t0, repo, env) {
  const registo = {
    ...envelope,
    ms: Date.now() - t0,
    quando: new Date().toISOString(),
    fontes: envelope.fontes || [],
    avisos: envelope.avisos || [],
  };
  anotar(registo);
  if (repo?.atividade?.add) {
    try { await repo.atividade.add('pesquisa', linhaDoRegisto(registo)); } catch { /* o registo nunca derruba a pesquisa */ }
  } else {
    anotarEmFicheiro(registo);
  }
  return registo;
}

/** O que se pode dizer a um agente sobre o estado das ferramentas — sem chaves. */
export function estadoFerramentas(env = process.env) {
  const web = fornecedorDe('web', env);
  const empresas = fornecedorDe('empresas', env);
  const fontes = pesquisa.estado(env);
  return {
    ferramentas: FERRAMENTAS.map((f) => ({
      ...f,
      fornecedor: f.dominio === 'web' ? web.id : empresas.id,
      disponivel: f.dominio === 'web' ? !!fontes.tavily?.disponivel : !!fontes.geoapify?.disponivel,
    })),
    fornecedores: {
      web: { escolhido: web.id, disponiveis: Object.keys(ADAPTADORES.web) },
      empresas: { escolhido: empresas.id, disponiveis: Object.keys(ADAPTADORES.empresas) },
    },
    limites: Object.fromEntries(Object.keys(ADAPTADORES).flatMap((d) => Object.keys(ADAPTADORES[d])).filter((v, i, a) => a.indexOf(v) === i).map((id) => [id, limitesDe(id, env)])),
    nota: 'as ferramentas estão disponíveis para os agentes; as chaves nunca saem do servidor.',
  };
}
