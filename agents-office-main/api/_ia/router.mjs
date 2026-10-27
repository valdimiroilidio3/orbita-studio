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
import { FORNECEDORES, MODELOS } from './catalogo.mjs';

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
  return !!prov.keyless && prov.usavel !== false;
}

/**
 * Cadeia ordenada de candidatos para um tipo de trabalho.
 * `chaves` = {openrouter:'OPENROUTER_API_KEY', …} (só ids, nunca segredos).
 */
export function cadeia(tipo, {
  chaves = {}, desligados = [], preferido = null, catalogo = MODELOS,
  latencias = {}, tentados = [], limite = 4, semRepetir = true,
} = {}) {
  const alvo = TIPOS[tipo] || TIPOS.texto;
  const exigidas = alvo.exige;
  const desejadas = alvo.gosta || [];
  const jaTentados = new Set(tentados.map((t) => `${t.fornec}\u0000${t.modelo}`));

  const disponiveis = catalogo
    .filter((m) => fornecedorActivo(m.fornecedor, { chaves, desligados }))
    .filter((m) => !(semRepetir && jaTentados.has(`${m.fornecedor}\u0000${m.modelo}`)));

  /* Exigir a etiqueta é a regra; mas se o único fornecedor disponível não a
     declarar, é melhor tentar do que responder «todos os modelos falharam»
     sem ter chamado ninguém. A cadeia leva `relaxado: true` e o uso fica
     registado com essa marca — não se esconde a diferença.
     (Visto a 27 out 2026: só o LLM7 respondia e nenhum modelo dele declara
     `raciocinio`, por isso o passo «plano» ficava sem candidatos.) */
  let relaxado = false;
  let candidatos = disponiveis.filter((m) => exigidas.every((r) => temEtiqueta(m, r)));
  if (!candidatos.length && !exigidas.includes('visao')) {
    /* Visão não se relaxa: um modelo sem olhos não lê uma imagem. Mais vale
       dizer que não há, do que aceitar um trabalho que não sabe fazer. */
    relaxado = true;
    candidatos = disponiveis.filter((m) => temEtiqueta(m, 'texto'));
  }

  const pontos = (m) => {
    let p = 0;
    if (preferido && preferido.fornecedor === m.fornecedor && preferido.modelo === m.modelo) p += 1000;
    p += exigidas.filter((r) => temEtiqueta(m, r)).length * 10;
    p += desejadas.filter((r) => temEtiqueta(m, r)).length * 4;
    p += (m.etiquetas || []).filter((r) => r === 'ferramentas').length * 6;   // quem tem mãos serve mais
    p -= precoDe(m) / 10;                                                     // barato primeiro
    p += Math.min(6, (m.janela || 0) / 50000);                                // contexto ajuda
    const lat = latencias[`${m.fornecedor}\u0000${m.modelo}`];
    if (Number.isFinite(lat)) p -= Math.min(8, lat / 800);                    // o que já foi rápido, primeiro
    return p;
  };

  return [...candidatos]
    .sort((a, b) => pontos(b) - pontos(a) || String(a.modelo).localeCompare(String(b.modelo)))
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
} = {}) {
  const fila = cadeiaFixa || cadeia(tipo, { chaves, desligados, preferido, latencias, catalogo, limite });
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
      const valeTentarOutro = e.retentavel || ['limite', 'avaria', 'tempo', 'rede', 'modelo', 'credito'].includes(e.codigo);
      if (!valeTentarOutro && i === fila.length - 1) break;
      if (!valeTentarOutro) continue;   // chave recusada / pedido inválido: passa ao próximo modelo
    }
  }
  const e = new Error(`todos os modelos falharam para «${tipo}»: ${erros.map((x) => `${x.fornec}/${x.modelo} — ${x.erro}`).join(' · ')}`);
  e.codigo = 'todosfalharam';
  e.erros = erros;
  throw e;
}
