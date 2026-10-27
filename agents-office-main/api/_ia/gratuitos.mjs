/* ===========================================================================
   Motores gratuitos — a cadeia que já respondeu de verdade (27 out 2026 · 1.32.0)

   Pedido do dono: «implementa uma IA para começar os trabalhos, implementa todas
   gratuitas».

   A auditoria de produção (27 out 2026, `/ia/uso`) mostrou o problema exacto:
   havia 62 pedidos ao LLM7 com 46 erros, porque a cadeia tentava modelos que o
   fornecedor não tem (`gpt-oss-20b`, `ministral-8b-2512`, `GLM-4.6V-Flash`,
   `Meta-Llama-3.1-8B-Instruct-Turbo`), todos recusados com «currently
   unavailable». O único modelo do LLM7 que respondeu 16 vezes foi o
   `codestral-latest` — e **não estava no catálogo para o LLM7**, por isso o
   router nunca o escolhia.

   O OVH respondia (`gpt-oss-120b`, `Qwen3.5-397B-A17B`) mas em 13–45 s, e o
   router só espera 45 s. O Vercel recusou 55 de 55 pedidos (exige cartão).

   Este ficheiro é a resposta: uma lista **curada**, com o que foi medido em
   produção, que entra na cadeia antes do catálogo. Não substitui o catálogo —
   só diz «estes já responderam, tenta primeiro».

   Regras:
     · só entra o que foi observado a responder (com data e latência);
     · `keyless: true` significa que não precisa de chave — é a IA gratuita que
       está disponível mesmo sem configurar nada;
     · se um destes deixar de responder, o router marca-o de parte 6 h e a
       cadeia segue; a lista não é uma promessa, é uma vantagem de partida;
     · nada aqui inventa quotas nem preços: `medido` diz quando e onde.
   =========================================================================== */
import { FORNECEDORES } from './catalogo.mjs';

/* Formato igual ao das entradas da cadeia (`fornec`, `modelo`, `etiquetas`) para
   o router poder ordenar as duas origens juntas, sem código especial. */
export const PROVADOS = [
  {
    fornec: 'llm7', modelo: 'codestral-latest',
    etiquetas: ['codigo', 'texto', 'rapido', 'barato'],
    janela: 32000, preco: [0, 0], keyless: true,
    ms: 1500, ok: 16, erros: 0,
    medido: '2026-10-27T19:59Z', fonte: '/ia/uso',
    nota: 'O único do LLM7 que respondeu sempre: 0,9–3,4 s. Serve para código, texto, planos curtos e revisão.',
  },
  {
    fornec: 'ovh', modelo: 'Qwen3.5-397B-A17B',
    etiquetas: ['raciocinio', 'texto', 'contexto'],
    janela: 130000, preco: [0, 0], keyless: true,
    ms: 13190, ok: 1, erros: 0,
    medido: '2026-10-27T18:44Z', fonte: '/ia/uso',
    nota: 'Respondeu em 13 s. É o que dá raciocínio quando o codestral não chega.',
  },
  {
    fornec: 'ovh', modelo: 'gpt-oss-120b',
    etiquetas: ['raciocinio', 'codigo', 'texto', 'ferramentas'],
    janela: 131000, preco: [0, 0], keyless: true,
    ms: 32144, ok: 2, erros: 1,
    medido: '2026-10-27T18:44Z', fonte: '/ia/uso',
    nota: 'Responde, mas em 13–45 s: fica para último recurso e nunca para passos rápidos.',
  },
];

/** Os pares curados cujo fornecedor está utilizável agora (chave ou keyless). */
export function provadosActivos({ chaves = {}, desligados = [] } = {}) {
  return PROVADOS.filter((p) => {
    const prov = FORNECEDORES[p.fornec];
    if (!prov || prov.usavel === false) return false;
    if (desligados.includes(p.fornec)) return false;
    return !!chaves[p.fornec] || !!prov.keyless;
  });
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Ordem dentro dos curados: primeiro o que responde depressa. */
export const porVelocidade = (a, b) => (a.ms || 0) - (b.ms || 0);

/**
 * O que está disponível **sem pagar nada**, com o estado honesto.
 * `pronto` só é verdadeiro se houver pelo menos um curado activo — não basta
 * haver fornecedores no catálogo.
 */
export function resumo({ chaves = {}, desligados = [], latencias = {} } = {}) {
  const activos = provadosActivos({ chaves, desligados });
  const medidos = activos.map((p) => {
    const real = latencias[`${p.fornec}\u0000${p.modelo}`];
    return {
      fornec: p.fornec,
      fornecedor: FORNECEDORES[p.fornec]?.nome || p.fornec,
      modelo: p.modelo,
      keyless: !!p.keyless,
      etiquetas: p.etiquetas,
      medidoMs: p.ms,
      latenciaActualMs: Number.isFinite(real) ? Math.round(real) : null,
      nota: p.nota,
    };
  });
  const keyless = medidos.filter((m) => m.keyless);
  return {
    ok: true,
    pronto: medidos.length > 0,
    total: medidos.length,
    semChaveNecessaria: keyless.length,
    modelos: medidos,
    nota: medidos.length
      ? 'lista curada: o que respondeu em produção, do mais rápido para o mais lento. Não é promessa de quota — o router marca de parte o que falhar.'
      : 'nenhum modelo gratuito activo: configura um fornecedor no Control Center ou liga o que não precisa de chave (LLM7, OVH).',
    medidoEm: '2026-10-27',
    fonte: '/ia/uso (produção)',
  };
}

/** O que a interface deve dizer quando alguém pergunta «há IA a funcionar?». */
export function estadoCurto(opcoes = {}) {
  const r = resumo(opcoes);
  if (!r.pronto) return { pronto: false, frase: 'nenhum motor gratuito activo' };
  const primeiro = [...r.modelos].sort(porVelocidade)[0];
  return {
    pronto: true,
    frase: `${r.total} modelo(s) gratuitos, o mais rápido ${primeiro.fornecedor} · ${primeiro.modelo} (${primeiro.medidoMs} ms medidos)`,
    semChave: primeiro.keyless,
  };
}

/** Só para testes: encontrar um curado por nome. */
export const curado = (fornec, modelo) => PROVADOS.find((p) => semAcento(p.fornec) === semAcento(fornec) && p.modelo === modelo) || null;
