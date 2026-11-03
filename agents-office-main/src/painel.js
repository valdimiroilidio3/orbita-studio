/* ===========================================================================
   1.57.2 · A MESA COMO CENTRO DE COMANDO — as contas, num sítio só (2 nov 2026)

   A vista principal tem de responder a quatro perguntas sem ninguém abrir uma
   sala: o que está a acontecer, o que foi concluído, o que precisa da minha
   aprovação e o que está bloqueado. Nenhuma dessas respostas pode ser inventada
   — todas saem das tarefas, dos rascunhos e dos eventos que a base devolve.

   Por isso vivem aqui, em funções puras (sem DOM e sem rede):

     · `resumoOperacional()` — os quatro números do topo, mais a série dos
       últimos sete dias para o gráfico pequeno;
     · `filaDeAprovacao()` — o que espera por uma pessoa, com a urgência dita
       pelo que está guardado (e não por uma cor escolhida à mão);
     · `estadoAgentes()` — cada sala, com o estado tirado das tarefas reais:
       a trabalhar, bloqueada, em fila, em descanso ou sem trabalho nenhum;
     · `atividadeRecente()`, `proximosTrabalhos()`, `bloqueios()`.

   Regra que não se quebra: contagem sem dados é 0 com a razão escrita à frente;
   nunca um número de demonstração.
   =========================================================================== */

/** A mesma tabela do servidor (`DEPARTAMENTOS_POR_TIPO` em `api/_rotas.mjs`). */
export const DEPARTAMENTO_POR_TIPO = {
  investigar: 'prospeccao',
  mensagem: 'vendas',
  briefing: 'comando',
  codigo: 'engenharia',
  qa: 'engenharia',
};

export const DEPARTAMENTO_LABEL = {
  comando: 'Comando',
  prospeccao: 'Prospecção',
  vendas: 'Vendas',
  media: 'Media',
  design: 'Design',
  engenharia: 'Engenharia',
};

const MILISSEGUNDO = 1;
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

const tempo = (iso) => {
  if (iso == null || iso === '') return null;
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** «1 rascunho» / «2 rascunhos» — os números escrevem-se por extenso em português. */
export const plural = (n, um, muitos) => `${n} ${Number(n) === 1 ? um : muitos}`;

/** «3 min», «2 h», «5 d» — a idade de uma coisa, em português curto. */
export function idade(iso, agora = Date.now()) {
  const t = tempo(iso);
  if (t == null) return null;
  const d = Math.max(0, agora - t);
  if (d < MINUTO) return 'agora';
  if (d < HORA) return `${Math.floor(d / MINUTO)} min`;
  if (d < DIA) return `${Math.floor(d / HORA)} h`;
  return `${Math.floor(d / DIA)} d`;
}

/** O que aconteceu nas últimas 24 horas conta como «agora» no resumo. */
const nasUltimas24 = (iso, agora) => {
  const t = tempo(iso);
  return t != null && agora - t <= DIA;
};

const quandoDaTarefa = (t) => t?.finished_at || t?.created_at || null;

/**
 * A série dos últimos dias: quantas tarefas ficaram concluídas em cada dia.
 * É a única série que a mesa pode desenhar sem inventar nada.
 */
export function serieConclusoes(tarefas = [], { dias = 7, agora = Date.now() } = {}) {
  const hoje0 = new Date(agora);
  hoje0.setHours(0, 0, 0, 0);
  const fim = hoje0.getTime();
  const out = [];
  for (let i = dias - 1; i >= 0; i -= 1) {
    const inicio = fim - i * DIA;
    const fimDoDia = inicio + DIA;
    const n = tarefas.filter((t) => {
      if (t?.state !== 'succeeded') return false;
      const q = tempo(quandoDaTarefa(t));
      return q != null && q >= inicio && q < fimDoDia;
    }).length;
    out.push({
      dia: new Date(inicio).toLocaleDateString('pt-PT', { weekday: 'short' }).replace('.', ''),
      n,
      inicio,
    });
  }
  return out;
}

/**
 * Os quatro números do topo. Cada cartão diz o que conta e o que não conta.
 */
export function resumoOperacional({ tarefas = [], hoje = null, projetos = [], agora = Date.now() } = {}) {
  const lista = Array.isArray(tarefas) ? tarefas.filter(Boolean) : [];
  const emCurso = lista.filter((t) => t.state === 'running');
  const naFila = lista.filter((t) => t.state === 'queued');
  const concluidas = lista.filter((t) => t.state === 'succeeded' && nasUltimas24(quandoDaTarefa(t), agora));
  const falhadas = lista.filter((t) => t.state === 'failed' && nasUltimas24(quandoDaTarefa(t), agora));
  const porAprovarTarefas = lista.filter((t) => t.state === 'awaiting_approval');
  const porAprovarMensagens = (hoje?.decidir || []).filter(Boolean);
  const projetosComQaFalhado = (projetos || []).filter((p) => p?.status === 'qa_falhou');
  const bloqueado = falhadas.length + projetosComQaFalhado.length;
  const aprovar = porAprovarMensagens.length + porAprovarTarefas.length;
  const serie = serieConclusoes(lista, { agora });

  return {
    cartoes: [
      {
        id: 'a-correr',
        label: 'A acontecer agora',
        valor: emCurso.length,
        nota: emCurso.length
          ? (naFila.length ? `${naFila.length} à espera na fila` : 'nenhuma à espera na fila')
          : (naFila.length ? `nada a correr · ${naFila.length} na fila` : 'nada a correr'),
        tom: emCurso.length ? 'blue' : 'neutro',
      },
      {
        id: 'concluido',
        label: 'Concluído (24 h)',
        valor: concluidas.length,
        nota: serie.reduce((n, d) => n + d.n, 0) ? `${plural(serie.reduce((n, d) => n + d.n, 0), 'tarefa', 'tarefas')} nos últimos 7 dias` : 'sem tarefas concluídas',
        tom: concluidas.length ? 'ok' : 'neutro',
        serie,
      },
      {
        id: 'aprovar',
        label: 'Precisa de ti',
        valor: aprovar,
        nota: aprovar
          ? [porAprovarMensagens.length ? plural(porAprovarMensagens.length, 'rascunho', 'rascunhos') : '', porAprovarTarefas.length ? plural(porAprovarTarefas.length, 'tarefa', 'tarefas') : ''].filter(Boolean).join(' · ')
          : 'nada à espera de ti',
        tom: aprovar ? 'warn' : 'neutro',
      },
      {
        id: 'bloqueado',
        label: 'Bloqueado',
        valor: bloqueado,
        nota: bloqueado
          ? [falhadas.length ? `${plural(falhadas.length, 'tarefa', 'tarefas')} ${falhadas.length === 1 ? 'falhada' : 'falhadas'}` : '', projetosComQaFalhado.length ? `${plural(projetosComQaFalhado.length, 'projeto', 'projetos')} sem QA` : ''].filter(Boolean).join(' · ')
          : 'nada bloqueado',
        tom: bloqueado ? 'risk' : 'neutro',
      },
    ],
    contagens: {
      aCorrer: emCurso.length,
      naFila: naFila.length,
      concluidas: concluidas.length,
      falhadas: falhadas.length,
      aprovar,
      bloqueado,
    },
  };
}

/**
 * O que espera por uma pessoa. A urgência vem do que está guardado:
 * uma mensagem para um lead com nota alta é alta; um pedido de autonomia é baixa.
 */
export function filaDeAprovacao({ hoje = null, tarefas = [], rotulos = {}, agora = Date.now() } = {}) {
  const out = [];
  for (const d of (hoje?.decidir || [])) {
    if (!d || !d.id) continue;
    if (d.kind === 'autonomia') {
      out.push({
        id: d.id, tipo: 'autonomia', titulo: d.lead?.name || 'Proposta de autonomia',
        detalhe: d.text || 'a IA pede para deixar de perguntar neste tipo de acção',
        quando: d.at || d.created_at || null, idade: idade(d.at || d.created_at, agora),
        urgencia: 'baixa', atalho: 'pick',
      });
      continue;
    }
    const nota = Number(d.lead?.score) || 0;
    out.push({
      id: d.id, tipo: 'mensagem', titulo: d.lead?.name || 'Rascunho de mensagem',
      detalhe: `${d.channel === 'email' ? 'Email' : 'WhatsApp'} · ${String(d.body || '').slice(0, 90)}${String(d.body || '').length > 90 ? '…' : ''}`,
      quando: d.at || d.created_at || null, idade: idade(d.at || d.created_at, agora),
      urgencia: d.status === 'aprovada' ? 'media' : (nota >= 75 ? 'alta' : 'media'),
      atalho: 'pick',
      leadId: d.lead?.id || null,
    });
  }
  for (const t of (Array.isArray(tarefas) ? tarefas : [])) {
    if (t?.state !== 'awaiting_approval') continue;
    out.push({
      id: t.id, tipo: 'tarefa', kind: t.kind,
      titulo: rotulos[t.kind] || t.kind || 'Tarefa',
      detalhe: t.resumo || t.titulo || t.entity_id ? `ligada a ${t.entity_id}` : 'acção externa à espera de OK',
      quando: quandoDaTarefa(t), idade: idade(quandoDaTarefa(t), agora),
      urgencia: 'alta', atalho: 'tarefa',
    });
  }
  const peso = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => (peso[a.urgencia] - peso[b.urgencia])
    || String(b.quando || '').localeCompare(String(a.quando || '')));
}

/**
 * O estado de cada sala, tirado das tarefas — não de um campo escrito à mão.
 * Aceita as duas formas: as contagens que o servidor já juntou (`tarefas`) ou a
 * lista crua, que é somada aqui pelo tipo.
 */
export function estadoAgentes({ departamentos = [], tarefas = [], rotulos = {}, agora = Date.now() } = {}) {
  const lista = Array.isArray(tarefas) ? tarefas.filter(Boolean) : [];
  const porDept = new Map();
  for (const t of lista) {
    const d = DEPARTAMENTO_POR_TIPO[t.kind] || 'comando';
    if (!porDept.has(d)) porDept.set(d, []);
    porDept.get(d).push(t);
  }

  const linhas = (Array.isArray(departamentos) ? departamentos : []).filter(Boolean).map((d) => {
    const id = d.id;
    const minhas = porDept.get(id) || [];
    const doServidor = d.tarefas && typeof d.tarefas === 'object' ? d.tarefas : null;
    const contar = (estado) => (doServidor && Number.isFinite(Number(doServidor[estado]))
      ? Number(doServidor[estado])
      : minhas.filter((t) => t.state === estado).length);

    const aCorrer = contar('aCorrer') || contar('running');
    const naFila = contar('naFila') || contar('queued');
    const porAprovar = contar('porAprovar') || contar('awaiting_approval');
    const concluidas = contar('concluidas') || contar('succeeded');
    const falhadas = contar('falhadas') || contar('failed');

    const ultimaTarefa = minhas
      .slice()
      .sort((a, b) => String(quandoDaTarefa(b) || '').localeCompare(String(quandoDaTarefa(a) || '')))[0] || null;
    /* 3 nov 2026 · o dono pediu o estado dos agentes «sem obrigar a abrir cada sala». Uma
       contagem («1 a correr») não diz o que se passa lá dentro: a sala passa a dizer QUE
       trabalho é esse — o que está a correr agora ou, se está quieta, o último que fez. */
    const agoraNaSala = minhas.filter((t) => t.state === 'running')
      .sort((a, b) => String(quandoDaTarefa(b) || '').localeCompare(String(quandoDaTarefa(a) || '')))[0] || null;
    const referencia = agoraNaSala || ultimaTarefa;
    const rotuloDa = (t) => (t ? (rotulos[t.kind] || t.kind || 'Tarefa') : null);

    let estado = 'sem-trabalho';
    if (aCorrer > 0) estado = 'a-trabalhar';
    else if (falhadas > 0) estado = 'bloqueado';
    else if (porAprovar > 0) estado = 'espera-ti';
    else if (naFila > 0) estado = 'na-fila';
    else if (concluidas > 0) estado = 'em-descanso';

    return {
      id,
      nome: d.nome || d.name || DEPARTAMENTO_LABEL[id] || id,
      estado,
      aCorrer, naFila, porAprovar, concluidas, falhadas,
      ultima: quandoDaTarefa(ultimaTarefa) || d.ultima || null,
      titulo: rotuloDa(referencia),
      aCorrerAgora: !!agoraNaSala,
      erro: referencia && referencia.state === 'failed' ? String(referencia.error || '').slice(0, 140) || null : null,
      ultimaIdade: idade(quandoDaTarefa(ultimaTarefa) || d.ultima, agora),
      ultimaFalha: d.ultimaFalha?.error || d.ultimaFalha || null,
    };
  });

  const resumo = {
    total: linhas.length,
    aTrabalhar: linhas.filter((l) => l.estado === 'a-trabalhar').length,
    bloqueados: linhas.filter((l) => l.estado === 'bloqueado').length,
    aEspera: linhas.filter((l) => l.estado === 'espera-ti' || l.estado === 'na-fila').length,
    descanso: linhas.filter((l) => l.estado === 'em-descanso' || l.estado === 'sem-trabalho').length,
  };
  return { linhas, resumo };
}

/** O registo e as tarefas fechadas, numa lista só, do mais recente para o antigo. */
export function atividadeRecente({ eventos = [], tarefas = [], rotulos = {}, limite = 8 } = {}) {
  const itens = [];
  for (const e of (Array.isArray(eventos) ? eventos : [])) {
    if (!e) continue;
    itens.push({
      tipo: 'evento',
      titulo: e.action || e.kind || 'registo',
      detalhe: String(e.detail || e.actor || '').slice(0, 120),
      quando: e.at || e.created_at || null,
      tom: 'neutro',
    });
  }
  for (const t of (Array.isArray(tarefas) ? tarefas : [])) {
    if (!t || (t.state !== 'succeeded' && t.state !== 'failed')) continue;
    itens.push({
      tipo: 'tarefa',
      titulo: `${rotulos[t.kind] || t.kind || 'Tarefa'} — ${t.state === 'succeeded' ? 'concluída' : 'falhou'}`,
      detalhe: t.state === 'failed' ? String(t.error || '').slice(0, 120) : String(t.resumo || '').slice(0, 120),
      quando: quandoDaTarefa(t),
      tom: t.state === 'failed' ? 'risk' : 'ok',
    });
  }
  return itens
    .filter((i) => i.quando)
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
    .slice(0, limite);
}

/** O que está para acontecer: a correr primeiro, depois a fila, por ordem de entrada. */
export function proximosTrabalhos({ tarefas = [], rotulos = {}, limite = 6, agora = Date.now() } = {}) {
  const abertas = (Array.isArray(tarefas) ? tarefas : [])
    .filter((t) => t && (t.state === 'running' || t.state === 'queued' || t.state === 'awaiting_approval'));
  const peso = { running: 0, awaiting_approval: 1, queued: 2 };
  return abertas
    .sort((a, b) => (peso[a.state] - peso[b.state]) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(0, limite)
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      titulo: rotulos[t.kind] || t.kind || 'Tarefa',
      estado: t.state,
      quando: quandoDaTarefa(t),
      idade: idade(quandoDaTarefa(t), agora),
      entidade: t.entity_id || null,
    }));
}

/** O que está preso: tarefas falhadas e projetos que não passaram o QA. */
export function bloqueios({ tarefas = [], projetos = [], rotulos = {}, agora = Date.now(), limite = 6 } = {}) {
  const out = [];
  for (const t of (Array.isArray(tarefas) ? tarefas : [])) {
    if (!t || t.state !== 'failed') continue;
    out.push({
      id: t.id, tipo: 'tarefa',
      titulo: rotulos[t.kind] || t.kind || 'Tarefa',
      motivo: String(t.error || 'falhou sem mensagem registada').slice(0, 140),
      quando: quandoDaTarefa(t), idade: idade(quandoDaTarefa(t), agora),
    });
  }
  for (const p of (projetos || [])) {
    if (!p || p.status !== 'qa_falhou') continue;
    out.push({
      id: p.id, tipo: 'projeto',
      titulo: p.name || 'Projeto',
      motivo: 'o QA não passou — corrigir e correr outra vez',
      quando: p.updated_at || p.created_at || null,
      idade: idade(p.updated_at || p.created_at, agora),
      rota: `#/projeto/${encodeURIComponent(p.id)}`,
    });
  }
  return out
    .sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')))
    .slice(0, limite);
}

/** «Bom dia» / «Boa tarde» / «Boa noite», pela hora do relógio de quem olha. */
export function saudacao(agora = Date.now()) {
  const h = new Date(agora).getHours();
  if (h < 6) return 'Boa noite';
  if (h < 13) return 'Bom dia';
  if (h < 20) return 'Boa tarde';
  return 'Boa noite';
}

/** Uma frase que diz o estado da operação sem enfeitar: o que precisa de ti. */
export function fraseDoEstado({ contagens } = {}) {
  const c = contagens || {};
  if (c.bloqueado) return `${c.bloqueado} ${c.bloqueado === 1 ? 'coisa está bloqueada' : 'coisas estão bloqueadas'} e ${c.aprovar || 0} à espera de ti.`;
  if (c.aprovar) return `${c.aprovar} ${c.aprovar === 1 ? 'acção precisa' : 'acções precisam'} da tua aprovação.`;
  if (c.aCorrer) return `${c.aCorrer} ${c.aCorrer === 1 ? 'tarefa a correr' : 'tarefas a correr'}; nada bloqueado.`;
  return 'Nada à espera de ti neste momento.';
}
