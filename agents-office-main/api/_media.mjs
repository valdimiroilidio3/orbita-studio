/* ===========================================================================
   1.54.3 · GERAR MÍDIA A SÉRIO — 2 nov 2026

   O passo que faltava: o briefing escreve-se, o Prompt Master diz o que fazer e
   os prompts de imagem descrevem a fotografia — mas nada era gerado. Aqui
   gera-se, guarda-se, cobra-se (ou não), acompanha-se e encontra-se depois.

   O que este ficheiro decide (e não o fornecedor):

     · QUEM PODE. A porta (`_porta.mjs`) exige sessão e `write`; aqui conta-se
       cada geração ao utilizador que a pediu, para os limites serem dele.

     · QUANTO CUSTA. Uma tabela de preços configurável (`ORBITA_PRECOS_MEDIA`),
       com os fornecedores gratuitos a 0 e o que não estiver na tabela marcado
       como DESCONHECIDO — que obriga a confirmação explícita, em vez de um
       número inventado.

     · QUANTAS. Limites por utilizador e por dia e um tecto de trabalhos
       simultâneos, verificados ANTES de falar com o fornecedor (o limite não
       pode ser ultrapassado por dois cliques ao mesmo tempo).

     · O ESTADO. `aguardando → em_processamento → concluida | falhou | cancelada`
       fica gravado na base (`orbita_geracoes`), com o prompt efetivamente
       enviado, as opções, o utilizador, a lead, o projeto, o fornecedor e o
       modelo. Recarregar a página não perde nada.

     · NADA DE COBRANÇAS DUPLICADAS. Cada pedido traz uma `chave` de
       idempotência: o segundo clique devolve o MESMO trabalho em vez de gerar
       outro. Repetir depois de uma falha é uma decisão explícita do dono.

   O que este ficheiro NÃO faz: falar com o fornecedor (isso é
   `_media/fornecedores.mjs`) nem guardar bytes (isso é `_armazem.mjs`).
   =========================================================================== */

import { criarArmazem, caminhoDe } from './_armazem.mjs';
import * as F from './_media/fornecedores.mjs';
import { lerBriefing } from './_briefing.mjs';

export const TIPOS = ['imagem', 'video'];
export const ESTADOS = ['aguardando', 'em_processamento', 'concluida', 'falhou', 'cancelada'];
export const CLASSIFICACOES = ['conceito', 'aprovado'];
export const MAX_PROMPT = 2400;
export const MAX_TENTATIVAS = 2;
export const MAX_GERACOES_PROJETO = 200;

export const ETIQUETA_ESTADO = {
  aguardando: { txt: 'à espera', cls: 'espera' },
  em_processamento: { txt: 'a gerar', cls: 'corre' },
  concluida: { txt: 'concluída', cls: 'ok' },
  falhou: { txt: 'falhou', cls: 'mau' },
  cancelada: { txt: 'cancelada', cls: 'quiet' },
};

export const ETIQUETA_CLASSIFICACAO = {
  conceito: { txt: 'conceito de IA', cls: 'conceito' },
  aprovado: { txt: 'aprovado para uso', cls: 'aprovado' },
};

const texto = (v) => String(v ?? '').trim();

/* ---------------------------------------------------------------------------
   1 · PREÇOS — configuráveis, sem inventar valores
   A tabela padrão tem os dois fornecedores que existem, e ambos a zero porque
   são de facto gratuitos hoje. Quem ligar um fornecedor pago (fal.ai, Veo…)
   acrescenta a entrada em ORBITA_PRECOS_MEDIA e a estimativa passa a ser feita
   por ela. O que não estiver na tabela fica «desconhecido».
   ------------------------------------------------------------------------ */
export const PRECOS_PADRAO = {
  pollinations: {
    imagem: {
      moeda: 'USD', base: 0, porImagem: 0, confiavel: true,
      nota: 'tier gratuito do fornecedor; com chave própria mantém-se sem custo por imagem na tabela do fornecedor',
    },
  },
  'orbita-render': {
    video: {
      moeda: 'USD', base: 0, porSegundo: 0, confiavel: true,
      nota: 'composto no browser: não há chamada paga a nenhum fornecedor',
    },
  },
};

export function tabelaDePrecos(env = {}) {
  const bruto = texto(env?.ORBITA_PRECOS_MEDIA);
  if (!bruto) return PRECOS_PADRAO;
  let extra = null;
  try { extra = JSON.parse(bruto); } catch { return PRECOS_PADRAO; }
  if (!extra || typeof extra !== 'object') return PRECOS_PADRAO;
  const out = JSON.parse(JSON.stringify(PRECOS_PADRAO));
  for (const [fornec, tipos] of Object.entries(extra)) {
    if (!tipos || typeof tipos !== 'object') continue;
    out[fornec] = { ...(out[fornec] || {}), ...tipos };
  }
  return out;
}

const dinheiro = (v, moeda) => {
  try {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: moeda || 'USD' }).format(Number(v) || 0);
  } catch { return `${(Number(v) || 0).toFixed(2)} ${moeda || 'USD'}`; }
};

/**
 * A estimativa de custo. Nunca se apresenta como valor garantido.
 * @returns {{valor:number|null, moeda:string, confiavel:boolean, rotulo:string, factores:string[], nota:string}}
 */
export function estimar({ tipo = 'imagem', fornecedor = null, opcoes = {} } = {}, env = {}) {
  const tab = tabelaDePrecos(env);
  const id = fornecedor || (tipo === 'video' ? F.FORNECEDOR_VIDEO : F.FORNECEDOR_IMAGEM);
  const regra = tab?.[id]?.[tipo] || null;
  const factores = [];
  if (tipo === 'imagem') {
    factores.push(`1 imagem · ${opcoes.largura || 1024}×${opcoes.altura || 1024} px`);
    if (opcoes.formato) factores.push(`proporção ${opcoes.formato}`);
  } else {
    factores.push(`1 vídeo · ${opcoes.duracao || 6} s · até ${opcoes.planos || 3} planos`);
    if (opcoes.formato) factores.push(`proporção ${opcoes.formato}`);
  }
  if (!regra) {
    return {
      valor: null, moeda: 'USD', confiavel: false, factores,
      rotulo: 'custo desconhecido',
      nota: `não há preço configurado para ${id} · ${tipo}: confirma sabendo que o custo real é desconhecido (define ORBITA_PRECOS_MEDIA para o estimar)`,
    };
  }
  const moeda = regra.moeda || 'USD';
  const quantidade = tipo === 'video' ? Number(opcoes.duracao || 0) : 1;
  const valor = Number(regra.base || 0) + (tipo === 'video'
    ? Number(regra.porSegundo || 0) * quantidade
    : Number(regra.porImagem || 0) * 1);
  const confiavel = regra.confiavel !== false;
  return {
    valor: +valor.toFixed(4),
    moeda,
    confiavel,
    factores,
    rotulo: valor === 0 ? `${dinheiro(0, moeda)} · gratuito` : `≈ ${dinheiro(valor, moeda)}`,
    nota: regra.nota || 'estimativa a partir da tabela de preços configurada; não é um valor garantido',
  };
}

/* ---------------------------------------------------------------------------
   2 · LIMITES — por utilizador, por dia, e simultâneos
   ------------------------------------------------------------------------ */
export function limitesDeUso(env = {}) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.trunc(Number(v)) : d);
  return {
    porDia: n(env?.ORBITA_MEDIA_LIMITE_DIA, 24),
    simultaneas: n(env?.ORBITA_MEDIA_SIMULTANEAS, 2),
    porProjetoDia: n(env?.ORBITA_MEDIA_LIMITE_PROJETO_DIA, 12),
    maxPrompt: MAX_PROMPT,
  };
}

export const inicioDoDia = (agora = Date.now()) => {
  const d = new Date(agora);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

const actorDe = (conta) => texto(conta?.id) || 'mesa';

export async function usoDe(repo, { conta = null, projetoId = null, env = {} } = {}) {
  const lim = limitesDeUso(env);
  const desde = inicioDoDia();
  const actor = actorDe(conta);
  const minhas = (await repo.geracoes.contarDesde(actor, desde).catch(() => 0)) || 0;
  const doProjeto = projetoId
    ? (await repo.geracoes.contarDoProjetoDesde(projetoId, desde).catch(() => 0)) || 0
    : 0;
  const activas = (await repo.geracoes.contarActivas(actor).catch(() => 0)) || 0;
  return {
    actor,
    hoje: minhas,
    porDia: lim.porDia,
    restantes: Math.max(0, lim.porDia - minhas),
    doProjeto,
    porProjetoDia: lim.porProjetoDia,
    activas,
    simultaneas: lim.simultaneas,
    motivo: minhas >= lim.porDia
      ? `chegaste ao limite de ${lim.porDia} gerações hoje (conta-se por utilizador e por dia, em UTC)`
      : doProjeto >= lim.porProjetoDia
        ? `este projeto já teve ${lim.porProjetoDia} gerações hoje: o limite protege-te de uma fatura inesperada`
        : activas >= lim.simultaneas
          ? `já tens ${lim.simultaneas} gerações em curso: espera que terminem (ou cancela as que estão à espera)`
          : null,
  };
}

/* ---------------------------------------------------------------------------
   3 · CRIAR — validação, idempotência, limites
   ------------------------------------------------------------------------ */
export const fornecedorDe = (tipo) => (tipo === 'video' ? F.FORNECEDOR_VIDEO : F.FORNECEDOR_IMAGEM);

function chaveLimpa(v) {
  return texto(v).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 80) || null;
}

export async function criar(repo, { projeto, lead = null, conta = null, pedido = {}, env = {} } = {}) {
  const tipo = texto(pedido.tipo || 'imagem');
  if (!TIPOS.includes(tipo)) {
    return { ok: false, codigo: 'tipo', status: 400, erro: 'só se geram imagens ou vídeos' };
  }
  if (pedido.confirmado !== true) {
    return {
      ok: false, codigo: 'confirmacao', status: 409,
      erro: 'falta a confirmação: a geração só começa quando o dono confirma, depois de ver a estimativa',
    };
  }
  const prompt = texto(pedido.prompt);
  if (prompt.length < 12) {
    return { ok: false, codigo: 'prompt', status: 400, erro: 'o prompt é curto demais: descreve a cena com pelo menos 12 caracteres' };
  }
  if (prompt.length > MAX_PROMPT) {
    return { ok: false, codigo: 'prompt', status: 400, erro: `o prompt tem ${prompt.length} caracteres (máx. ${MAX_PROMPT})` };
  }

  const fornecedor = fornecedorDe(tipo);
  const val = F.validarOpcoes({ tipo, formato: pedido.formato, resolucao: pedido.resolucao, duracao: pedido.duracao, movimento: pedido.movimento });
  if (!val.ok) {
    return { ok: false, codigo: 'opcoes', status: 400, erro: val.erros.join('; ') };
  }
  const opcoes = val.opcoes;

  const chave = chaveLimpa(pedido.chave);
  if (chave) {
    const existente = await repo.geracoes.porChave(chave).catch(() => null);
    if (existente) {
      return { ok: true, status: 200, repetido: true, geracao: existente, aviso: 'este pedido já existia: devolvi o mesmo trabalho em vez de gerar outro' };
    }
  }

  /* o prompt de vídeo não é uma chamada de IA: compõe-se no browser com as
     imagens deste projeto. Sem imagens, não há vídeo — e diz-se antes de criar
     um trabalho que ia ficar à espera para sempre. */
  let fontes = [];
  if (tipo === 'video') {
    const doProjeto = await repo.geracoes.listarPorProjeto(projeto.id, 60).catch(() => []);
    fontes = (doProjeto || [])
      .filter((g) => g.tipo === 'imagem' && g.estado === 'concluida' && g.ficheiro?.caminho)
      .slice(0, opcoes.planos || 4)
      .map((g) => ({ id: g.id, classificacao: g.classificacao || 'conceito' }));
    if (!fontes.length) {
      return {
        ok: false, codigo: 'semimagens', status: 409,
        erro: 'um vídeo compõe-se com imagens: gera pelo menos uma imagem deste projeto primeiro (ou liga o worker do OpenMontage)',
      };
    }
  }

  const uso = await usoDe(repo, { conta, projetoId: projeto.id, env });
  if (uso.motivo) {
    return { ok: false, codigo: 'limite', status: 429, erro: uso.motivo, uso };
  }

  const custo = estimar({ tipo, fornecedor, opcoes }, env);
  const modelo = tipo === 'imagem' ? texto(pedido.modelo) || null : null;
  const geracao = await repo.geracoes.criar({
    chave: chave || null,
    projeto_id: projeto.id,
    lead_id: projeto.lead_id || lead?.id || null,
    conta_id: actorDe(conta),
    tipo,
    fornecedor,
    modelo,
    prompt,
    opcoes,
    estado: 'aguardando',
    custo_estimado: custo.valor,
    custo_moeda: custo.moeda,
    custo_confiavel: custo.confiavel,
    custo_real: null,
    classificacao: 'conceito',
    ficheiro: null,
    fontes: fontes.length ? fontes : null,
    erro: null,
    tentativas: 0,
    anterior: null,
  });
  return { ok: true, status: 202, geracao, custo, uso };
}

/* ---------------------------------------------------------------------------
   4 · AVANÇAR — aqui acontece a chamada ao fornecedor
   O trabalho não fica preso numa única requisição HTTP longa: o pedido cria o
   registo, e quem o consulta (a mesa, de 2 em 2 segundos) faz avançar um passo.
   Quando ninguém está a olhar para a mesa, quem faz avançar é `avancarPendentes`
   (1.86.0), chamado pelo agendador de 30 em 30 minutos através de `/api/ciclo?so=midia`.
   Os dois caminhos chamam `avancar`, e a marca `em_processamento` evita que dois
   pedidos gerem a mesma imagem duas vezes.
   ------------------------------------------------------------------------ */
export async function avancar(repo, geracao, { env = {}, armazem = null, fetchImpl = fetch, agora = Date.now() } = {}) {
  if (!geracao || geracao.estado !== 'aguardando') return geracao;
  /* vídeo: quem compõe é o browser; o servidor não tem nada para fazer */
  if (geracao.tipo === 'video') return geracao;

  const arm = armazem || criarArmazem({ env, fetchImpl });

  /* A REIVINDICAÇÃO. Só um pedido passa de `aguardando` para `em_processamento`
     (na base é um PATCH condicionado; em memória é a mesma condição). Dois
     separadores abertos ao mesmo tempo não geram — nem cobram — a mesma imagem
     duas vezes: o segundo volta a ler e vê `em_processamento`. */
  const reivindicada = await repo.geracoes.reivindicar(geracao.id, new Date(agora).toISOString()).catch(() => null);
  if (!reivindicada) {
    return (await repo.geracoes.porId(geracao.id).catch(() => null)) || geracao;
  }
  geracao = reivindicada;
  const tentativas = Math.max(0, Number(geracao.tentativas || 1) - 1);

  let r;
  try {
    r = await F.gerarImagem({
      prompt: geracao.prompt,
      modelo: geracao.modelo,
      opcoes: geracao.opcoes || {},
      env, fetchImpl,
    });
  } catch (e) {
    r = { ok: false, codigo: 'fornecedor', erro: String(e?.message || e).slice(0, 240) };
  }

  if (!r.ok) {
    const transitorio = r.codigo === 'fornecedor' || /não respondeu|timeout|ECONN|ETIMEDOUT|sem tempo/i.test(r.erro || '');
    const podeTentar = transitorio && tentativas + 1 < MAX_TENTATIVAS;
    const campos = {
      estado: podeTentar ? 'aguardando' : 'falhou',
      erro: podeTentar
        ? `tentativa ${tentativas + 1} não deu: ${r.erro} — vou tentar outra vez`
        : (r.erro || 'a imagem não veio'),
      actualizado: new Date(agora).toISOString(),
    };
    const actualizada = await repo.geracoes.actualizar(geracao.id, campos).catch(() => null);
    return actualizada || { ...geracao, ...campos };
  }

  const caminho = caminhoDe({ projetoId: geracao.projeto_id, geracaoId: geracao.id, mime: r.mime });
  const guardado = await arm.put(caminho, { bytes: r.bytes, mime: r.mime });
  if (!guardado.ok) {
    const campos = {
      estado: 'falhou',
      erro: `a imagem veio mas não ficou guardada: ${guardado.erro}`,
      actualizado: new Date(agora).toISOString(),
    };
    return (await repo.geracoes.actualizar(geracao.id, campos).catch(() => null)) || { ...geracao, ...campos };
  }

  const campos = {
    estado: 'concluida',
    erro: null,
    actualizado: new Date(agora).toISOString(),
    ficheiro: {
      caminho,
      mime: r.mime,
      bytes: r.bytes.length,
      largura: r.meta?.largura || geracao.opcoes?.largura || null,
      altura: r.meta?.altura || geracao.opcoes?.altura || null,
      via: r.meta?.via || null,
      seed: r.meta?.seed ?? null,
      ms: r.meta?.ms || null,
      armazem: arm.tipo,
    },
    fornecedor: geracao.fornecedor || F.FORNECEDOR_IMAGEM,
  };
  return (await repo.geracoes.actualizar(geracao.id, campos).catch(() => null)) || { ...geracao, ...campos };
}

/* ---------------------------------------------------------------------------
   4b · O PUMP (1.86.0) — quem faz avançar a fila quando ninguém está a olhar

   Até à 1.85 este caminho existia só no papel: a mesa avançava as gerações ao
   consultá-las, e mais nada. Um pedido feito pelos agentes (`imagem_gerar`) ou
   por alguém que fechou o separador ficava «aguardando» para sempre.

   Regras que não quebra:
     · uma função da Vercel tem 60 s: o pump NÃO começa uma imagem depois do seu
       orçamento (por omissão 25 s), e uma imagem demora até ~26 s — por isso
       nunca passa de ~51 s no pior caso;
     · só imagens: o vídeo é composto no browser;
     · uma geração presa («a gerar» há mais de `limiarPresaMs`) é curada: a
       função morreu depois de reivindicar a linha, por isso PODE ter sido
       cobrada. Não se volta a gerar às cegas: fica `falhou` com essa razão
       escrita, e quem quiser refaz com «gerar outra vez».
   ------------------------------------------------------------------------ */
export const LIMIAR_PRESA_MS = 3 * 60 * 1000;

export async function curarPresas(repo, { agora = Date.now(), limiarMs = LIMIAR_PRESA_MS } = {}) {
  const antes = new Date(agora - limiarMs).toISOString();
  const presas = await repo.geracoes.listarPresas(antes, 20).catch(() => []);
  const curadas = [];
  for (const g of presas || []) {
    const campos = {
      estado: 'falhou',
      erro: 'a geração ficou presa a meio (a função parou antes de acabar) — pode ter sido cobrada; se a queres, usa «gerar outra vez»',
      actualizado: new Date(agora).toISOString(),
    };
    const nova = await repo.geracoes.actualizar(g.id, campos).catch(() => null);
    curadas.push({ id: g.id, estado: 'falhou' });
    if (!nova) curadas[curadas.length - 1].erro = 'não consegui atualizar a linha';
  }
  return curadas;
}

/**
 * Faz avançar as imagens pendentes dentro de um orçamento de tempo.
 * Devolve o que aconteceu — nunca finge que acabou quando parou no orçamento.
 */
export async function avancarPendentes(repo, { env = {}, fetchImpl = fetch, limite = 5, orcamentoMs = 25000, agora = () => Date.now() } = {}) {
  const t0 = agora();
  const curadas = await curarPresas(repo, { agora: t0 });
  let pendentes = [];
  try {
    pendentes = (await repo.geracoes.listarPendentes(Math.max(1, Math.min(20, Number(limite) || 5)))) || [];
  } catch (e) {
    return { ok: false, erro: `não consegui ler a fila de mídia: ${String(e?.message || e).slice(0, 160)}`, avancadas: [], curadas, restantes: 0, gastouMs: agora() - t0 };
  }
  const arm = criarArmazem({ env, fetchImpl });
  const avancadas = [];
  let parou = false;
  for (const g of pendentes) {
    if (g.tipo !== 'imagem') continue;
    if (agora() - t0 > orcamentoMs) { parou = true; break; }
    const depois = await avancar(repo, g, { env, armazem: arm, fetchImpl });
    avancadas.push({ id: g.id, estado: depois?.estado || null, erro: depois?.erro || null });
  }
  const restantes = Math.max(0, pendentes.filter((g) => g.tipo === 'imagem').length - avancadas.length);
  return {
    ok: true, avancadas, curadas, restantes, parou,
    gastouMs: agora() - t0,
    frase: !pendentes.length && !curadas.length
      ? 'a fila de imagens está vazia'
      : `avancei ${avancadas.length} imagem(ns)${curadas.length ? ` · curei ${curadas.length} presa(s)` : ''}${restantes ? ` · ficaram ${restantes} para a próxima volta` : ''}`,
  };
}

/* ---------------------------------------------------------------------------
   5 · LER — devolve o estado e, se for caso disso, faz avançar
   ------------------------------------------------------------------------ */
export async function ler(repo, id, { env = {}, armazem = null, fetchImpl = fetch, avancarAuto = true, agora = Date.now() } = {}) {
  let g = await repo.geracoes.porId(id).catch(() => null);
  if (!g) return { ok: false, codigo: 'nao-encontrada', status: 404, erro: 'geração não encontrada' };
  if (avancarAuto && g.estado === 'aguardando' && g.tipo === 'imagem') {
    g = await avancar(repo, g, { env, armazem, fetchImpl, agora });
  }
  return { ok: true, geracao: g };
}

/** O retrato público de uma geração — sem caminhos internos, com URL autenticado. */
export function vista(geracao) {
  if (!geracao) return null;
  const f = geracao.ficheiro || null;
  const est = ETIQUETA_ESTADO[geracao.estado] || { txt: geracao.estado, cls: 'quiet' };
  const cls = ETIQUETA_CLASSIFICACAO[geracao.classificacao] || ETIQUETA_CLASSIFICACAO.conceito;
  return {
    id: geracao.id,
    tipo: geracao.tipo,
    estado: geracao.estado,
    estadoTxt: est.txt,
    estadoCls: est.cls,
    fornecedor: geracao.fornecedor,
    modelo: geracao.modelo || null,
    prompt: geracao.prompt,
    opcoes: geracao.opcoes || {},
    projetoId: geracao.projeto_id,
    leadId: geracao.lead_id || null,
    por: geracao.conta_id || null,
    criado: geracao.criado || null,
    actualizado: geracao.actualizado || null,
    tentativas: Number(geracao.tentativas || 0),
    erro: geracao.erro || null,
    precisaBrowser: geracao.tipo === 'video' && geracao.estado === 'aguardando',
    fontes: geracao.fontes || null,
    classificacao: geracao.classificacao || 'conceito',
    classificacaoTxt: cls.txt,
    classificacaoCls: cls.cls,
    podeCancelar: geracao.estado === 'aguardando',
    podeRepetir: ['falhou', 'cancelada', 'concluida'].includes(geracao.estado),
    custo: {
      estimado: geracao.custo_estimado === null || geracao.custo_estimado === undefined ? null : Number(geracao.custo_estimado),
      moeda: geracao.custo_moeda || 'USD',
      confiavel: geracao.custo_confiavel !== false,
      real: geracao.custo_real === null || geracao.custo_real === undefined ? null : Number(geracao.custo_real),
      nota: geracao.custo_real === null || geracao.custo_real === undefined
        ? 'custo estimado; o fornecedor não devolveu um valor definitivo'
        : null,
    },
    ficheiro: f ? {
      mime: f.mime,
      bytes: f.bytes || 0,
      largura: f.largura || null,
      altura: f.altura || null,
      /* o binário sai por uma função própria (o /api/rpc só devolve JSON) e
         sempre com sessão — nunca por uma URL do fornecedor nem pública */
      descarregar: `/api/ficheiro?id=${encodeURIComponent(geracao.id)}&d=1`,
      ver: `/api/ficheiro?id=${encodeURIComponent(geracao.id)}`,
      nome: `${String(geracao.projeto_id || 'projeto').slice(0, 24)}-${geracao.tipo}-${String(geracao.id).slice(-6)}.${(f.mime || '').includes('mp4') ? 'mp4' : (f.mime || '').includes('webm') ? 'webm' : (f.mime || '').includes('png') ? 'png' : (f.mime || '').includes('webp') ? 'webp' : 'jpg'}`,
    } : null,
  };
}

/* ---------------------------------------------------------------------------
   6 · CANCELAR, REPETIR, CLASSIFICAR
   ------------------------------------------------------------------------ */
export async function cancelar(repo, id, { agora = Date.now() } = {}) {
  const g = await repo.geracoes.porId(id).catch(() => null);
  if (!g) return { ok: false, codigo: 'nao-encontrada', status: 404, erro: 'geração não encontrada' };
  if (g.estado === 'aguardando') {
    const feita = await repo.geracoes.actualizar(id, { estado: 'cancelada', actualizado: new Date(agora).toISOString() });
    return { ok: true, geracao: feita || g, nota: 'cancelada antes de falar com o fornecedor: nada foi cobrado' };
  }
  if (g.estado === 'concluida') {
    return { ok: false, codigo: 'concluida', status: 409, erro: 'esta geração já terminou: para a refazer, usa «gerar outra vez»' };
  }
  if (g.estado === 'em_processamento') {
    return {
      ok: false, codigo: 'a_correr', status: 409,
      erro: 'esta geração já foi enviada ao fornecedor e não se pode cancelar: o pedido já saiu daqui e pode ainda ser cobrado',
    };
  }
  return { ok: false, codigo: g.estado, status: 409, erro: `não há nada para cancelar (estado: ${g.estado})` };
}

export async function repetir(repo, id, { env = {}, agora = Date.now() } = {}) {
  const g = await repo.geracoes.porId(id).catch(() => null);
  if (!g) return { ok: false, codigo: 'nao-encontrada', status: 404, erro: 'geração não encontrada' };
  const custo = estimar({ tipo: g.tipo, fornecedor: g.fornecedor, opcoes: g.opcoes || {} }, env);
  const nova = await repo.geracoes.criar({
    chave: `r:${id}:${agora}`.slice(0, 80),
    projeto_id: g.projeto_id,
    lead_id: g.lead_id || null,
    conta_id: g.conta_id || 'mesa',
    tipo: g.tipo,
    fornecedor: g.fornecedor,
    modelo: g.modelo || null,
    prompt: g.prompt,
    opcoes: g.opcoes || {},
    estado: 'aguardando',
    custo_estimado: custo.valor,
    custo_moeda: custo.moeda,
    custo_confiavel: custo.confiavel,
    custo_real: null,
    classificacao: 'conceito',
    ficheiro: null,
    fontes: g.fontes || null,
    erro: null,
    tentativas: 0,
    anterior: id,
  });
  return {
    ok: true, status: 202, geracao: nova, custo,
    aviso: custo.valor === 0
      ? 'nova tentativa criada · este fornecedor é gratuito, por isso não há custo'
      : `nova tentativa criada · uma nova tentativa pode gerar novo custo (${custo.rotulo})`,
  };
}

export async function classificar(repo, id, { classificacao, agora = Date.now() } = {}) {
  if (!CLASSIFICACOES.includes(classificacao)) {
    return { ok: false, codigo: 'classificacao', status: 400, erro: 'a classificação é «conceito» (mídia gerada) ou «aprovado» (podes usar)' };
  }
  const g = await repo.geracoes.porId(id).catch(() => null);
  if (!g) return { ok: false, codigo: 'nao-encontrada', status: 404, erro: 'geração não encontrada' };
  if (!g.ficheiro) {
    return { ok: false, codigo: 'semficheiro', status: 409, erro: 'ainda não há ficheiro para classificar' };
  }
  const feita = await repo.geracoes.actualizar(id, { classificacao, actualizado: new Date(agora).toISOString() });
  return { ok: true, geracao: feita || g };
}

/* ---------------------------------------------------------------------------
   7 · O FICHEIRO DO VÍDEO — composto no browser, recebido e verificado aqui
   ------------------------------------------------------------------------ */
const MAX_PEDIDO = F.MAX_PEDIDO_BYTES;

function bytesDoCorpo(corpo = {}) {
  const f = corpo.ficheiro || corpo;
  const dataUrl = texto(f.dataUrl || f.data);
  const b64 = texto(f.base64) || (dataUrl.includes(',') ? dataUrl.split(',')[1] : '');
  const mime = texto(f.mime) || (/^data:([^;]+)/.exec(dataUrl) || [])[1] || '';
  if (!b64) return { ok: false, erro: 'o pedido não traz o ficheiro (dataUrl ou base64)' };
  if (b64.length > MAX_PEDIDO) return { ok: false, erro: 'o ficheiro é grande demais para este caminho (máx. ~2,5 MB de vídeo)' };
  return { ok: true, bytes: Buffer.from(b64, 'base64'), mime };
}

export async function guardarFicheiro(repo, id, { corpo = {}, env = {}, armazem = null, agora = Date.now() } = {}) {
  const g = await repo.geracoes.porId(id).catch(() => null);
  if (!g) return { ok: false, codigo: 'nao-encontrada', status: 404, erro: 'geração não encontrada' };
  if (g.tipo !== 'video') {
    return { ok: false, codigo: 'tipo', status: 409, erro: 'só o vídeo é enviado pelo browser; as imagens são geradas no servidor' };
  }
  if (g.estado === 'cancelada') {
    return { ok: false, codigo: 'cancelada', status: 409, erro: 'esta geração foi cancelada: cria outra antes de enviar o ficheiro' };
  }
  if (g.estado === 'concluida' && g.ficheiro) {
    /* idempotência do upload: o mesmo pedido repetido não guarda duas vezes */
    return { ok: true, repetido: true, geracao: g, aviso: 'este vídeo já estava guardado: não guardei outra vez' };
  }
  const lido = bytesDoCorpo(corpo);
  if (!lido.ok) return { ok: false, codigo: 'ficheiro', status: 400, erro: lido.erro };
  const aceite = F.aceitarVideo({ mime: lido.mime, bytes: lido.bytes, duracao: corpo.duracao ?? g.opcoes?.duracao });
  if (!aceite.ok) return { ok: false, codigo: 'ficheiro', status: 400, erro: aceite.erro };

  const arm = armazem || criarArmazem({ env });
  const caminho = caminhoDe({ projetoId: g.projeto_id, geracaoId: g.id, mime: aceite.mime });
  const guardado = await arm.put(caminho, { bytes: lido.bytes, mime: aceite.mime });
  if (!guardado.ok) {
    const campos = { estado: 'falhou', erro: `o vídeo não ficou guardado: ${guardado.erro}`, actualizado: new Date(agora).toISOString() };
    const falhada = await repo.geracoes.actualizar(id, campos).catch(() => null);
    return { ok: false, codigo: 'armazem', status: 503, erro: campos.erro, geracao: falhada || { ...g, ...campos } };
  }
  const campos = {
    estado: 'concluida', erro: null, actualizado: new Date(agora).toISOString(),
    ficheiro: {
      caminho, mime: aceite.mime, bytes: aceite.bytes,
      largura: corpo.largura || null, altura: corpo.altura || null,
      duracao: aceite.duracao, via: 'browser', armazem: arm.tipo,
    },
  };
  const feita = await repo.geracoes.actualizar(id, campos).catch(() => null);
  return { ok: true, geracao: feita || { ...g, ...campos }, nota: 'vídeo composto no browser e guardado no servidor' };
}

export async function lerFicheiro(repo, id, { armazem = null, env = {} } = {}) {
  const g = await repo.geracoes.porId(id).catch(() => null);
  if (!g) return { ok: false, status: 404, erro: 'geração não encontrada' };
  if (!g.ficheiro?.caminho) return { ok: false, status: 404, erro: 'ainda não há ficheiro nesta geração' };
  const arm = armazem || criarArmazem({ env });
  const f = await arm.get(g.ficheiro.caminho);
  if (!f) {
    return {
      ok: false, status: 404,
      erro: arm.tipo === 'memoria'
        ? 'o ficheiro já não está na memória deste processo (sem armazenamento ligado, os ficheiros perdem-se num arranque)'
        : 'o ficheiro não está no armazém: foi apagado ou o caminho mudou',
    };
  }
  return {
    ok: true, bytes: f.bytes, mime: f.mime || g.ficheiro.mime || 'application/octet-stream',
    nome: vista(g)?.ficheiro?.nome || `${id}`, geracao: g,
  };
}

/* ---------------------------------------------------------------------------
   8 · APAGAR (quando um projeto for apagado)
   Hoje não há rota que apague um projeto; quando houver, é este o passo que
   resolve a pergunta «e os ficheiros?»: bytes fora do armazém, registos fora da
   base, na mesma ordem que a regra existente usa (primeiro o que se pode
   reconstruir; o resto depois).
   ------------------------------------------------------------------------ */
export async function apagarDoProjeto(repo, projetoId, { armazem = null, env = {} } = {}) {
  const arm = armazem || criarArmazem({ env });
  const apagados = await repo.geracoes.apagarDoProjeto(projetoId).catch(() => 0);
  const bytes = await arm.removePrefixo(`projetos/${String(projetoId).replace(/[^a-zA-Z0-9_-]/g, '')}/`).catch(() => 0);
  return { ok: true, registos: apagados || 0, ficheiros: bytes || 0 };
}

/* ---------------------------------------------------------------------------
   9 · A VISTA DO PROJETO — tudo o que a área de mídia precisa
   ------------------------------------------------------------------------ */
export async function vistaDoProjeto(repo, { projeto, lead = null, conta = null, env = {}, armazem = null, fetchImpl = fetch, avancarAuto = true } = {}) {
  const arm = armazem || criarArmazem({ env, fetchImpl });
  let geracoes = await repo.geracoes.listarPorProjeto(projeto.id, MAX_GERACOES_PROJETO).catch(() => []);

  /* O «avanço ao consultar»: a mesa pergunta de 2,5 em 2,5 segundos; cada
     pergunta faz avançar UM trabalho de imagem que esteja à espera. É assim que
     um trabalho continua sem ninguém a olhar e sem uma requisição longa: cada
     pedido leva um passo, e o estado fica na base entre passos. */
  if (avancarAuto) {
    const pendente = (geracoes || []).find((g) => g.tipo === 'imagem' && g.estado === 'aguardando');
    if (pendente) {
      await avancar(repo, pendente, { env, armazem: arm, fetchImpl }).catch(() => null);
      geracoes = await repo.geracoes.listarPorProjeto(projeto.id, MAX_GERACOES_PROJETO).catch(() => []);
    }
  }
  const lista = (geracoes || []).map(vista);

  /* os prompts do briefing, para se escolher um em vez de escrever de raiz */
  let prompts = [];
  let briefingHash = null;
  try {
    const b = await lerBriefing(repo, { projeto, lead });
    prompts = (b?.vista?.imagens?.prompts || []).map((p) => ({ id: p.id, finalidade: p.finalidade, prompt: p.prompt, nota: p.nota || null }));
    briefingHash = b?.vista?.briefing?.hash || null;
  } catch { prompts = []; }

  const uso = await usoDe(repo, { conta, projetoId: projeto.id, env });
  const fornecedores = F.disponibilidade(env).map((f) => {
    const exemplo = tipoDe(f) ? estimar({ tipo: tipoDe(f), fornecedor: f.id, opcoes: {} }, env) : null;
    return { ...f, estimativaTipo: exemplo };
  });
  return {
    ok: true,
    projeto: { id: projeto.id, nome: projeto.name, leadId: projeto.lead_id || null },
    fornecedores,
    opcoes: F.opcoesPublicas(),
    prompts,
    promptsBase: briefingHash,
    geracoes: lista,
    uso,
    limites: limitesDeUso(env),
    precos: { moeda: 'USD', tabela: Object.fromEntries(Object.entries(tabelaDePrecos(env)).map(([k, v]) => [k, Object.keys(v)])) },
    armazem: { tipo: arm.tipo, pronto: !!arm.pronto, porque: arm.porque || null },
    avisoIA: 'tudo o que sai daqui é conteúdo gerado por IA: nasce como «conceito» e só passa a «aprovado para uso» quando o dono o disser',
    estados: ESTADOS,
  };
}

function tipoDe(f) {
  if (Array.isArray(f?.tipos) && f.tipos.length) return f.tipos[0];
  return null;
}

export const _interno = { bytesDoCorpo, actorDe, chaveLimpa, dinheiro, MAX_PEDIDO };
