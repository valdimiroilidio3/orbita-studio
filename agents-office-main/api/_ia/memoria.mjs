/* ===========================================================================
   1.19.0 · MEMÓRIA (dos plugins do Graft) — 27 out 2026

   O Graft (Apache-2.0, © AEndrix03) é «memória persistente para agentes»: um
   grafo de notas que o agente consulta antes de resolver e alimenta depois de
   resolver. O plugin dele tem seis skills: graft-init, graft, recall,
   memoryze, learn e memory-audit.

   O que está implementado aqui, e o que não está — sem eufemismos:

     recall          → `procurar()`: pontuação por palavras (título, texto,
                       etiquetas) sobre as notas guardadas. NÃO é embedding.
     memoryze        → `guardar()`: 1 nota por chamada, com fonte e etiquetas.
     graft-init      → o arranque: `estado()` diz o que há e o que falta.
     memory-audit    → `auditar()`: duplicados, notas vazias, sem fonte, paradas.
     learn           → `aprender()`: ingestão em lote a partir de texto já
                       recolhido (sem ler o disco: a função da Vercel não vê o
                       repositório). Diz-se no resultado.
     graft (o ciclo) → o orquestrador chama `procurar()` antes de planear e
                       `guardar()` no fim, quando o trabalho concluiu.

   O que NÃO existe: daemon, grafo de ligações, embeddings/modelo de 600 MB,
   perfis GRAFT_PROFILE. A busca é lexical e o resultado di-lo (`modo`).

   1.49.0 · MEM0 — a memória passou a ter duas camadas, e as duas dizem quem são:

     local (aqui)   → lexical, sempre disponível, sem rede. É a rede de segurança.
     Mem0 (mem0.mjs) → semântica, quando há `MEM0_API_KEY`. Procura por sentido,
                      não por palavras, e responde com `origem: 'mem0'`.

   As duas somam-se na leitura (`modo: 'mem0+lexical'`) e na escrita: a nota é
   guardada localmente primeiro e só depois empurrada para o Mem0. Se o Mem0
   estiver em baixo, a nota fica guardada e o resultado di-lo (`mem0.ok:false`)
   — uma memória remota em baixo não pode perder uma nota.
   =========================================================================== */
import * as mem0 from './mem0.mjs';

const MAX_NOTA = 8000;
const MAX_TITULO = 160;

/* palavras muito comuns que não ajudam a distinguir nada */
const VAZIAS = new Set(('a o as os um uma de do da das dos e ou que em no na nos nas por para com sem ao aos à às é são foi ser estar ' +
  'the of and or to in on for with is are was be this that it as at by from').split(' '));

function termos(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3 && !VAZIAS.has(t));
}

/** Pontuação de uma nota contra uma consulta. Devolve 0 quando não há nada em comum. */
export function pontuar(nota, consulta) {
  const q = termos(consulta);
  if (!q.length) return 0;
  const titulo = termos(nota.titulo).join(' ');
  const corpo = termos(nota.texto).join(' ');
  const etiquetas = (nota.etiquetas || []).map((e) => String(e).toLowerCase());
  let p = 0;
  const vistos = new Set();
  for (const t of q) {
    if (vistos.has(t)) continue;
    vistos.add(t);
    if (titulo.includes(t)) p += 6;
    if (etiquetas.some((e) => e.includes(t))) p += 4;
    if (corpo.includes(t)) p += 2;
  }
  return p;
}

export function normalizar({ titulo, texto, etiquetas, fonte, projeto }) {
  const t = String(titulo || '').trim().slice(0, MAX_TITULO);
  const x = String(texto || '').trim().slice(0, MAX_NOTA);
  if (t.length < 3) return { erro: 'o título precisa de pelo menos 3 caracteres' };
  if (x.length < 10) return { erro: 'a nota precisa de pelo menos 10 caracteres de texto' };
  const ets = (Array.isArray(etiquetas) ? etiquetas : String(etiquetas || '').split(','))
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => e.length >= 2 && e.length <= 40)
    .slice(0, 12);
  return {
    nota: {
      titulo: t,
      texto: x,
      etiquetas: [...new Set(ets)],
      fonte: String(fonte || 'conversa').slice(0, 200),
      projeto: String(projeto || 'orbita').slice(0, 80),
    },
  };
}

/**
 * Guarda uma nota — e recusa duplicados exactos (mesmo título, mesmo texto).
 * Grava localmente primeiro; depois empurra para o Mem0 se houver chave. O
 * resultado diz o que aconteceu nas duas camadas, sem esconder falhas.
 */
export async function guardar(repo, dados, { env = process.env, fetchImpl = fetch, paraMem0 = true } = {}) {
  const { nota, erro } = normalizar(dados);
  if (erro) return { ok: false, erro };
  const existentes = await repo.ia.memoria.listar({ projeto: nota.projeto, limite: 500 });
  const igual = existentes.find((n) => n.titulo === nota.titulo && n.texto === nota.texto);
  const cfg = mem0.config(env);
  let remoto = { configurada: mem0.configurada(cfg), ok: false, motivo: null };
  if (igual) {
    remoto.motivo = remoto.configurada ? 'a nota já existia; não voltei a enviá-la' : 'falta MEM0_API_KEY';
    return { ok: true, criada: false, nota: igual, resumo: `já estava guardada (#${igual.id})`, mem0: remoto };
  }
  const criada = await repo.ia.memoria.criar(nota);
  if (paraMem0 && remoto.configurada) {
    const envio = await mem0.adicionar(cfg, {
      texto: `${nota.titulo}\n\n${nota.texto}`,
      titulo: nota.titulo,
      metadados: { fonte: nota.fonte, projeto: nota.projeto, etiquetas: nota.etiquetas, notaLocal: criada.id },
      fetchImpl,
    });
    remoto = { configurada: true, ok: envio.ok, id: envio.id || null, motivo: envio.motivo || null, ms: envio.ms };
  } else if (!remoto.configurada) {
    remoto.motivo = 'falta MEM0_API_KEY — a nota ficou só na memória local';
  }
  return { ok: true, criada: true, nota: criada, resumo: `guardada: «${nota.titulo}»`, mem0: remoto };
}

/**
 * Procura notas nas duas camadas. `modo` diz exactamente como se procurou:
 * `'lexical'` (só palavras), `'mem0+lexical'` (semântica em cima da lexical) ou
 * `'recente'` (sem consulta). Os achados trazem `origem: 'local' | 'mem0'`.
 */
export async function procurar(repo, { consulta, projeto = null, limite = 8, env = process.env, fetchImpl = fetch } = {}) {
  const notas = await repo.ia.memoria.listar({ projeto, limite: 500 });
  const q = String(consulta || '').trim();
  const cfg = mem0.config(env);
  const remoto = { configurada: mem0.configurada(cfg), ligada: false, motivo: null, achados: [], ms: null };

  if (!q) {
    return { ok: true, modo: 'recente', achados: notas.slice(0, limite).map((n) => ({ ...n, origem: 'local' })), mem0: remoto };
  }

  const pontuadas = notas
    .map((n) => ({ nota: n, pontos: pontuar(n, q) }))
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || String(b.nota.actualizado || '').localeCompare(String(a.nota.actualizado || '')))
    .slice(0, limite);
  for (const { nota } of pontuadas) {
    try { await repo.ia.memoria.usar(nota.id); } catch { /* contar usos não pode falhar a procura */ }
  }
  const locais = pontuadas.map((x) => ({ ...x.nota, pontos: x.pontos, origem: 'local' }));

  if (remoto.configurada) {
    const r = await mem0.pesquisar(cfg, { consulta: q, limite, fetchImpl });
    remoto.ligada = r.ok;
    remoto.motivo = r.ok ? null : r.motivo;
    remoto.ms = r.ms ?? null;
    remoto.achados = r.ok ? r.achados.length : 0;
    if (r.ok) {
      /* juntar sem repetir: uma nota que veio nas duas camadas fica uma vez,
         com a origem semântica (foi essa que a encontrou por sentido). */
      const chave = (n) => String(n.texto || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160);
      const vistos = new Set(r.achados.map(chave));
      const juntos = [...r.achados, ...locais.filter((n) => !vistos.has(chave(n)))];
      return {
        ok: true,
        modo: 'mem0+lexical',
        consulta: q,
        achados: juntos.slice(0, Math.max(limite, r.achados.length)),
        mem0: remoto,
      };
    }
  } else {
    remoto.motivo = 'falta MEM0_API_KEY — procurei só por palavras';
  }

  return { ok: true, modo: 'lexical', consulta: q, achados: locais, mem0: remoto };
}

/** O «memory-audit»: o que está duplicado, vazio, sem fonte ou parado. */
export async function auditar(repo, { projeto = null } = {}) {
  const notas = await repo.ia.memoria.listar({ projeto, limite: 500 });
  const porTitulo = new Map();
  for (const n of notas) {
    const k = String(n.titulo || '').trim().toLowerCase();
    porTitulo.set(k, [...(porTitulo.get(k) || []), n]);
  }
  const duplicados = [...porTitulo.entries()].filter(([, v]) => v.length > 1)
    .map(([titulo, v]) => ({ titulo, ids: v.map((x) => x.id) }));
  const semFonte = notas.filter((n) => !n.fonte || n.fonte === 'conversa').map((n) => n.id);
  const curtas = notas.filter((n) => String(n.texto || '').length < 40).map((n) => n.id);
  const agora = Date.now();
  const paradas = notas.filter((n) => {
    const usos = Number(n.usos || 0);
    const quando = Date.parse(n.actualizado || n.criado || '') || agora;
    return usos === 0 && (agora - quando) > 1000 * 60 * 60 * 24 * 60;
  }).map((n) => ({ id: n.id, titulo: n.titulo }));

  return {
    ok: true,
    modo: 'lexical',
    total: notas.length,
    duplicados,
    semFonte,
    curtas,
    paradas,
    recomendacao: duplicados.length || curtas.length
      ? 'há notas a juntar ou a completar antes de a memória crescer'
      : 'nada urgente; a memória está pequena e coerente',
    naoFaz: [
      'não funde notas sozinho (juntar texto é uma decisão, não uma limpeza)',
      'não apaga nada: as notas paradas ficam listadas para decidires',
      'não usa embeddings — a procura é por palavras',
    ],
  };
}

/**
 * «learn»: ingestão em lote de texto já recolhido. Divide por blocos marcados
 * (`## título`) ou, se não houver, por parágrafos de 400+ caracteres.
 * Devolve o plano e só grava com `confirmar: true` — o plugin também tem um
 * portão de aprovação antes de escrever.
 */
export async function aprender(repo, { texto, projeto = 'orbita', fonte = 'documento', etiquetas = [], confirmar = false } = {}) {
  const bruto = String(texto || '');
  if (bruto.length < 40) return { ok: false, erro: 'texto demasiado curto para aprender alguma coisa' };
  const blocos = [];
  const porTitulo = bruto.split(/^#{1,3}\s+/m).filter((b) => b.trim());
  if (porTitulo.length > 1) {
    for (const b of porTitulo) {
      const [primeira, ...resto] = b.split('\n');
      blocos.push({ titulo: primeira.trim().slice(0, 140), texto: resto.join('\n').trim() });
    }
  } else {
    for (const p of bruto.split(/\n{2,}/)) if (p.trim().length >= 120) blocos.push({ titulo: p.trim().split(/[.\n]/)[0].slice(0, 140), texto: p.trim() });
  }
  const plano = blocos.slice(0, 40).filter((b) => b.titulo.length >= 3 && b.texto.length >= 20);
  if (!plano.length) return { ok: false, erro: 'não encontrei blocos com título e texto suficientes' };
  if (!confirmar) {
    return { ok: true, confirmado: false, plano: plano.map((b) => ({ titulo: b.titulo, caracteres: b.texto.length })), quantos: plano.length,
      nota: 'nada foi gravado: chama outra vez com confirmar=true depois de veres o plano' };
  }
  let criadas = 0;
  let repetidas = 0;
  for (const b of plano) {
    const r = await guardar(repo, { ...b, fonte, projeto, etiquetas });
    if (r.ok && r.criada) criadas += 1;
    else repetidas += 1;
  }
  return { ok: true, confirmado: true, criadas, repetidas, quantos: plano.length };
}

/** O que a memória tem, para o Control Center (e para o `/ia/memoria`). */

/* O ping ao Mem0 não pode acontecer a cada desenho do painel: 60 s de validade
   por chave. Um painel que abre depressa é parte de «funcionar». */
let cacheSaude = { chave: null, quando: 0, valor: null };
const TTL_SAUDE = 60000;

async function saudeComCache(cfg, fetchImpl) {
  const agora = Date.now();
  if (cacheSaude.chave === cfg.chave && agora - cacheSaude.quando < TTL_SAUDE && cacheSaude.valor) {
    return { ...cacheSaude.valor, cache: true };
  }
  const valor = await mem0.saude(cfg, { fetchImpl });
  cacheSaude = { chave: cfg.chave, quando: agora, valor };
  return valor;
}

export async function estado(repo, { env = process.env, fetchImpl = fetch } = {}) {
  const notas = await repo.ia.memoria.listar({ limite: 500 });
  const etiquetas = new Map();
  for (const n of notas) for (const e of n.etiquetas || []) etiquetas.set(e, (etiquetas.get(e) || 0) + 1);
  const cfg = mem0.config(env);
  const saude = await saudeComCache(cfg, fetchImpl);
  return {
    total: notas.length,
    recentes: notas.slice(0, 8),
    etiquetas: [...etiquetas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([e, n]) => ({ etiqueta: e, notas: n })),
    usos: notas.reduce((s, n) => s + Number(n.usos || 0), 0),
    modo: saude.ligada ? 'mem0+lexical' : 'lexical',
    camadas: { local: 'lexical', mem0: saude.ligada ? 'semântica' : null },
    mem0: saude,
    origem: 'plugins do Graft (Apache-2.0) — recall, memoryze, learn, memory-audit, graft-init · Mem0 (memória semântica)',
  };
}

/**
 * Importa um lote para o Mem0. Aceita o mesmo formato do OpenClaw
 * (`[{ memory, metadata }]`) ou, com `origem:'locais'`, tudo o que já está na
 * memória local — é o botão «enviar as notas para o Mem0».
 * Sem `confirmar: true` devolve só o plano: nada sai daqui.
 */
export async function importar(repo, { itens = null, origem = null, confirmar = false, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = mem0.config(env);
  if (!mem0.configurada(cfg)) {
    return { ok: false, erro: 'falta MEM0_API_KEY no ambiente — sem chave não há para onde importar', mem0: { configurada: false } };
  }

  let lista = Array.isArray(itens) ? itens : [];
  if (!lista.length && origem === 'locais') {
    const notas = await repo.ia.memoria.listar({ limite: 500 });
    lista = notas.map((n) => ({
      memory: `${n.titulo}\n\n${n.texto}`,
      metadata: { fonte: n.fonte, projeto: n.projeto, etiquetas: n.etiquetas, notaLocal: n.id },
    }));
  }

  const limpos = lista
    .map((i) => ({
      memory: String((i && (i.memory ?? i.text ?? i.content)) || '').trim(),
      metadata: (i && i.metadata) || {},
    }))
    .filter((i) => i.memory.length >= 10);

  if (!limpos.length) return { ok: false, erro: 'não há itens com texto suficiente para importar', mem0: { configurada: true } };

  if (!confirmar) {
    return {
      ok: true,
      confirmado: false,
      quantos: limpos.length,
      plano: limpos.slice(0, 10).map((i) => ({
        fonte: i.metadata.fonte || '(sem fonte)',
        titulo: String(i.memory.split('\n')[0]).replace(/^#+\s*/, '').slice(0, 90),
        caracteres: i.memory.length,
      })),
      nota: 'nada foi enviado: chama outra vez com confirmar=true depois de veres o plano',
      mem0: { configurada: true },
    };
  }

  const r = await mem0.importar(cfg, limpos, { fetchImpl });
  return {
    ok: r.ok,
    confirmado: true,
    total: r.total,
    importados: r.importados,
    falhados: r.falhados,
    erros: r.erros,
    mem0: { configurada: true },
    nota: r.importados ? `${r.importados} memória(s) semântica(s) guardadas no Mem0` : 'o Mem0 não aceitou nenhum item — vê `erros`',
  };
}
