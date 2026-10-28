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
import { FORNECEDORES, MODELOS } from './catalogo.mjs';

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

/**
 * Provas feitas pela própria app: `/ia/testar` guarda em
 * `cfg.testes[fornecedor].provados[modelo] = {ok, ms, quando}`. É a única lista
 * que cresce sozinha — e a única que pode promover um «por provar» a «provado».
 */
export function provasDe(cfg = {}) {
  const saida = [];
  for (const [fornec, teste] of Object.entries(cfg?.testes || {})) {
    const prov = FORNECEDORES[fornec];
    if (!prov || prov.usavel === false) continue;
    for (const [modelo, p] of Object.entries(teste?.provados || {})) {
      if (!modelo || !p || p.ok === false) continue;
      const ms = Number.isFinite(p.ms) ? p.ms : null;
      saida.push({
        fornec, modelo,
        etiquetas: etiquetasDoId(modelo),
        janela: 131072, preco: [0, 0],
        keyless: !!prov.keyless, chavePublica: !!prov.chavePublica,
        ms, ok: 1, erros: 0,
        medido: p.quando || null, fonte: '/ia/testar',
        nota: `Provado pela app${p.quando ? ` em ${String(p.quando).slice(0, 16).replace('T', ' ')}` : ''}${ms != null ? ` (${ms} ms)` : ''}: respondeu a um pedido curto.`,
      });
    }
  }
  return saida;
}

/** Os pares curados cujo fornecedor está utilizável agora (chave, chave pública ou keyless). */
export function provadosActivos({ chaves = {}, desligados = [], cfg = null } = {}) {
  const vistos = new Set();
  return [...PROVADOS, ...provasDe(cfg || {})].filter((p) => {
    const prov = FORNECEDORES[p.fornec];
    if (!prov || prov.usavel === false) return false;
    if (desligados.includes(p.fornec)) return false;
    if (!(!!chaves[p.fornec] || !!prov.keyless || !!prov.chavePublica)) return false;
    const k = `${p.fornec}\u0000${p.modelo}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Etiquetas prováveis de um id de modelo. É inferência, não prova: serve para o
 * modelo entrar na cadeia certa até um teste real dizer outra coisa. Sem isto,
 * os modelos `-free` descobertos ficavam com «texto» só, e um modelo de código
 * nunca era escolhido para código.
 */
export function etiquetasDoId(id) {
  const n = semAcento(id);
  const t = new Set(['texto']);
  if (/(^|[-_/])(vl|vision|vlm)([-_/]|$)|vision/.test(n)) t.add('visao');
  if (/cod(e|er)|pickle|deepseek|glm|qwen|kimi|minimax|codex|coder/.test(n)) t.add('codigo');
  if (/think|reason|nemotron|deepseek|glm|r1|thinking|super/.test(n)) t.add('raciocinio');
  if (/flash|lightning|mini|nano|fast|small|spark/.test(n)) t.add('rapido');
  if (/tool|pickle|glm|qwen|nemotron/.test(n)) t.add('ferramentas');
  return [...t];
}

/** Um fornecedor sem custo: não precisa de chave, publica a sua, ou é gratuito. */
const semCusto = (prov) => !!prov && prov.usavel !== false && (!!prov.keyless || !!prov.chavePublica || prov.gratuito === true);

/** Um fornecedor cujo **serviço inteiro** é gratuito (não é um gateway misto). */
const servicoGratuito = (prov) => !!prov && (!!prov.keyless || !!prov.chavePublica);

/** O id diz que é gratuito? (`x:free`, `y-free`, `free-z`) */
export const pareceGratuito = (id) => /(^|[-:/_])free($|[-:/_])/i.test(String(id || ''));

/**
 * Modelos que o fornecedor **disse** ter (lista de `/models` guardada no teste),
 * prontos para entrar na cadeia. Só de fornecedores sem custo: um modelo pago
 * descoberto nunca é escolhido por acidente. Continuam por provar — quem prova
 * é o primeiro pedido real, e o router marca de parte o que falhar.
 */
export function descobertosGratuitos(cfg = {}) {
  const saida = [];
  const vistos = new Set();
  for (const [fornec, teste] of Object.entries(cfg.testes || {})) {
    const prov = FORNECEDORES[fornec];
    if (!semCusto(prov) || !Array.isArray(teste?.lista)) continue;
    for (const modelo of teste.lista) {
      const id = String(modelo || '');
      if (!id || vistos.has(`${fornec}\u0000${id}`)) continue;
      /* Num gateway misto (OpenRouter, Requesty…) a lista traz modelos pagos:
         só entram os que se anunciam como gratuitos. Num serviço gratuito
         (LLM7, OVH, OpenCode Zen, Pollinations) a lista é toda dela. */
      if (!servicoGratuito(prov) && !pareceGratuito(id)) continue;
      vistos.add(`${fornec}\u0000${id}`);
      saida.push({
        fornecedor: fornec, modelo: id,
        etiquetas: etiquetasDoId(id),
        janela: 131072, preco: [0, 0], gratuito: true, descoberto: true,
        rotulo: `${id} (${prov.nome}, descoberto)`,
      });
    }
  }
  return saida;
}

/** O catálogo que a cadeia usa: o de sempre + o que a descoberta encontrou. */
export function catalogoDaCadeia(cfg = {}, base = MODELOS) {
  const extra = descobertosGratuitos(cfg).filter((d) => !base.some((m) => m.fornecedor === d.fornecedor && m.modelo === d.modelo));
  return [...base, ...extra];
}

/**
 * Gratuitos **por provar**: estão prontos no catálogo (sem chave, chave pública
 * ou chave do dono) mas ainda não há resposta registada. É a lista honesta do
 * «existe, falta provar» — a interface não deve chamar-lhes funcionais.
 */
export function porProvar({ chaves = {}, desligados = [], base = MODELOS, provados: provas = [] } = {}) {
  const provados = new Set([...PROVADOS, ...provas].map((p) => `${p.fornec}\u0000${p.modelo}`));
  return base
    .filter((m) => !provados.has(`${m.fornecedor}\u0000${m.modelo}`))
    .filter((m) => !desligados.includes(m.fornecedor))
    .filter((m) => {
      const prov = FORNECEDORES[m.fornecedor];
      if (!semCusto(prov)) return false;
      return !!chaves[m.fornecedor] || !!prov.keyless || !!prov.chavePublica;
    })
    .map((m) => ({
      fornec: m.fornecedor,
      fornecedor: FORNECEDORES[m.fornecedor]?.nome || m.fornecedor,
      modelo: m.modelo,
      etiquetas: m.etiquetas || [],
      semChave: !chaves[m.fornecedor] || String(chaves[m.fornecedor]).startsWith('\u0000'),
      descoberto: !!m.descoberto,
    }))
    .slice(0, 60);
}

/**
 * 1.42.0 · QUAL É O PADRÃO (28 out 2026, pedido: «padrão será uma gratuita»).
 *
 * A regra, em três linhas: se o dono deu uma chave de um fornecedor que é
 * gratuito por desenho (Pollinations), esse é o motor de partida — ele escolheu-o
 * ao criar a chave. Sem chave, o padrão é a cadeia anónima já medida (LLM7 →
 * OVH → OpenCode → Pollinations anónimo). Em nenhum dos casos se escolhe um
 * modelo pago por omissão.
 *
 * Devolve `{ fornec, modelo }` ou `null`, no formato que o router entende.
 */
export function preferidoDoAmbiente(chaves = {}) {
  const temChave = (id) => !!chaves[id] && !String(chaves[id]).startsWith('\u0000');
  /* 1.42.0 · o padrão é uma gratuita: com a chave do Pollinations, o motor
     começa por ele. `modelo: null` = «o melhor deste fornecedor para o tipo de
     trabalho» — o router escolhe (`openai` para texto/visão, `openai-large`
     para raciocínio). Fixar um só modelo deixava os outros tipos a fugir. */
  if (temChave('pollinations')) return { fornecedor: 'pollinations', modelo: null };
  return null;
}

/** Ordem dentro dos curados: primeiro o que responde depressa. */
export const porVelocidade = (a, b) => (a.ms || 0) - (b.ms || 0);

/**
 * O que está disponível **sem pagar nada**, com o estado honesto.
 * `pronto` só é verdadeiro se houver pelo menos um curado activo — não basta
 * haver fornecedores no catálogo.
 */
export function resumo({ chaves = {}, desligados = [], latencias = {}, cfg = null } = {}) {
  const provas = provasDe(cfg || {});
  const activos = provadosActivos({ chaves, desligados, cfg });
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
  const base = cfg ? catalogoDaCadeia(cfg) : MODELOS;
  const falta = porProvar({ chaves, desligados, base, provados: provas });
  return {
    ok: true,
    pronto: medidos.length > 0,
    total: medidos.length,
    semChaveNecessaria: keyless.length,
    modelos: medidos,
    porProvar: falta,
    totalPorProvar: falta.length,
    nota: medidos.length
      ? 'lista curada: o que respondeu em produção, do mais rápido para o mais lento. Não é promessa de quota — o router marca de parte o que falhar. Os «por provar» existem e estão prontos, mas ainda não há resposta registada deles.'
      : 'nenhum modelo gratuito activo: configura um fornecedor no Control Center ou liga o que não precisa de chave (LLM7, OVH, OpenCode Zen, Pollinations).',
    medidoEm: '2026-10-27',
    fonte: '/ia/uso (produção)',
  };
}

/** O que a interface deve dizer quando alguém pergunta «há IA a funcionar?». */
export function estadoCurto(opcoes = {}) {
  const r = resumo(opcoes);
  if (!r.pronto) return { pronto: false, frase: 'nenhum motor gratuito activo' };
  const primeiro = [...r.modelos].sort(porVelocidade)[0];
  const resto = r.totalPorProvar ? ` · ${r.totalPorProvar} por provar` : '';
  return {
    pronto: true,
    frase: `${r.total} gratuitos provados${resto} — o mais rápido é ${primeiro.fornecedor} · ${primeiro.modelo} (${primeiro.medidoMs} ms)`,
    semChave: primeiro.keyless,
  };
}

/** Só para testes: encontrar um curado por nome. */
export const curado = (fornec, modelo) => PROVADOS.find((p) => semAcento(p.fornec) === semAcento(fornec) && p.modelo === modelo) || null;
