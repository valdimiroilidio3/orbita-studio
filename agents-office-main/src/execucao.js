/* ===========================================================================
   1.61.0 · A EXECUÇÃO TRANSPARENTE (2 nov 2026)

   Pedido do dono: «quero ver o que o agente fez, com que dados, o que mudou,
   e poder parar, repetir em segurança e saber quem autorizou».

   O servidor já gravava execuções (`orbita_ai_runs`) e passos
   (`orbita_ai_steps`) desde a 1.18.0, mas o vocabulário era técnico e havia
   buracos: `a_planear`, `a_executar`, `a_correr`, `parcial`… e nenhum sítio
   dizia, em português, em que estado está a coisa nem o que fazer quando corre
   mal. Este ficheiro é a única tradução entre o que a base guarda e o que a
   mesa mostra. Contas puras: sem DOM, sem rede, sem relógio escondido.

   Regras que este ficheiro não quebra:
   · cinco estados, ditos por palavras — em fila · em execução · à espera de
     aprovação · concluído · falhado (cancelado é um sexto, não um sinónimo);
   · `parcial` NÃO é «concluído»: é trabalho que fechou a meio, e diz-se;
   · custo sem número é «desconhecido», nunca 0 (0 lê-se como grátis);
   · repetir só quando a execução anterior fechou — repetir por cima de uma
     execução a correr é duplicar trabalho e efeitos;
   · quem autorizou fica escrito com nome e hora; sem autorização, uma acção
     destrutiva não corre (a regra vive no servidor, não neste ecrã).
   =========================================================================== */

/* Os cinco estados do pedido. `tecnico` lista o que a base pode ter dentro. */
export const ESTADOS = {
  em_fila: {
    id: 'em_fila', rotulo: 'Em fila', curto: 'em fila', cor: '#8a8f98',
    porque: 'criada e à espera de começar — ainda não correu nada',
    tecnico: ['novo'],
  },
  em_execucao: {
    id: 'em_execucao', rotulo: 'Em execução', curto: 'a correr', cor: '#2f6fed',
    porque: 'um agente está a trabalhar nisto agora',
    tecnico: ['a_planear', 'a_executar', 'a_correr'],
  },
  a_espera: {
    id: 'a_espera', rotulo: 'À espera de aprovação', curto: 'à espera', cor: '#b26a00',
    porque: 'parou porque precisa de uma decisão tua antes de continuar',
    tecnico: ['aguarda_aprovacao'],
  },
  concluido: {
    id: 'concluido', rotulo: 'Concluído', curto: 'concluído', cor: '#1f7a4d',
    porque: 'chegou ao fim com resultado escrito',
    tecnico: ['concluido'],
  },
  falhou: {
    id: 'falhou', rotulo: 'Falhou', curto: 'falhou', cor: '#b3261e',
    porque: 'não chegou ao fim — a razão está escrita, não escondida',
    tecnico: ['falhou', 'parcial'],
  },
  cancelado: {
    id: 'cancelado', rotulo: 'Cancelado', curto: 'cancelado', cor: '#6b6f76',
    porque: 'parou porque alguém mandou parar',
    tecnico: ['cancelado'],
  },
};

export const ORDEM_ESTADOS = ['em_fila', 'em_execucao', 'a_espera', 'falhou', 'concluido', 'cancelado'];

const tecnicoDe = (run) => String(run?.estado || 'novo');

/** Traduz o estado técnico no estado que se mostra, com a razão dele. */
export function estadoDoRun(run) {
  const tecnico = tecnicoDe(run);
  const chave = Object.keys(ESTADOS).find((k) => ESTADOS[k].tecnico.includes(tecnico)) || 'em_fila';
  const base = ESTADOS[chave];
  let porque = base.porque;
  if (tecnico === 'parcial') porque = 'fechou a meio: parte do trabalho ficou por fazer (a razão está em baixo)';
  if (chave === 'falhou' && run?.erro) porque = String(run.erro).slice(0, 400);
  if (chave === 'a_espera' && run?.pendente?.resumo) porque = String(run.pendente.resumo).slice(0, 300);
  if (chave === 'concluido' && run?.revisao?.decisao === 'com_ressalvas') porque = 'chegou ao fim, com ressalvas do revisor';
  if (chave === 'concluido' && run?.revisao?.decisao === 'rejeitado') porque = 'chegou ao fim, mas o revisor rejeitou o trabalho';
  return {
    id: base.id, rotulo: base.rotulo, curto: base.curto, cor: base.cor, porque,
    tecnico, activo: ['em_fila', 'em_execucao', 'a_espera'].includes(base.id),
    fechado: ['concluido', 'falhou', 'cancelado'].includes(base.id),
  };
}

/** Hora curta e legível; o que não tem data diz «sem hora», não uma inventada. */
export function quandoDe(quando, agora = Date.now()) {
  if (!quando) return 'sem hora';
  const t = new Date(quando).getTime();
  if (!Number.isFinite(t)) return String(quando).slice(0, 16);
  const dif = Math.max(0, agora - t);
  const min = Math.round(dif / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} d`;
  return new Date(t).toISOString().slice(0, 10);
}

/** Duração em palavras. Sem medição, «—»; nunca 0 s a fingir de conta. */
export function duracaoDe(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const n = Number(ms);
  if (n < 1000) return `${Math.max(1, Math.round(n))} ms`;
  const s = n / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
}

const lista = (v) => (Array.isArray(v) ? v : []);

/* ---------------------------------------------------------------------------
   Passos: entradas → acções → resultados.
   Um passo é uma pergunta feita a um agente. As acções são as ferramentas que
   ele mandou correr no servidor; o resultado é o texto que voltou. Se alguma
   coisa falhou, o erro fica ao lado — não no lugar do resultado.
   ------------------------------------------------------------------------- */
export function passosDoRun(steps = []) {
  return lista(steps)
    .slice()
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .map((s) => {
      const acoes = lista(s.ferramentas).map((f) => ({
        nome: String(f?.nome || 'ferramenta'),
        argumentos: f?.argumentos || null,
        ok: f?.ok !== false && !f?.precisaAprovacao,
        precisaAprovacao: !!f?.precisaAprovacao,
        resumo: String(f?.resumo || (f?.precisaAprovacao ? 'precisa de aprovação humana' : '') || '').slice(0, 400),
        ms: Number(f?.ms) || 0,
        esperou: !!f?.precisaAprovacao,
      }));
      const estado = String(s.estado || 'a_correr');
      const entrada = String(s.entrada || '').trim();
      const resultado = String(s.saida || '').trim();
      let visivel = 'em_execucao';
      if (estado === 'concluido') visivel = 'concluido';
      else if (estado === 'falhou') visivel = 'falhou';
      else if (estado === 'aguarda_aprovacao') visivel = 'a_espera';
      else if (estado === 'cancelado') visivel = 'cancelado';
      else if (estado === 'vazio') visivel = 'falhou';
      return {
        id: s.id, ordem: s.ordem || 0, agente: String(s.agente || ''), titulo: String(s.titulo || `passo ${s.ordem || ''}`),
        estado: visivel, tecnico: estado, entrada, resultado,
        temEntrada: !!entrada, temResultado: !!resultado,
        acoes, ferramentas: acoes.length,
        falhouFerramenta: acoes.some((a) => !a.ok),
        erro: s.erro ? String(s.erro).slice(0, 600) : (estado === 'vazio' ? 'o agente não devolveu texto' : null),
        modelo: s.modelo || null, fornecedor: s.fornecedor || null,
        duracao: duracaoDe(s.duracao_ms), ms: Number(s.duracao_ms) || null,
        quando: s.criado || null,
      };
    });
}

/** O que aconteceu, por ordem: passos e decisões, com hora. Não é um log técnico. */
export function registoDoRun(run, steps = []) {
  const eventos = [];
  if (run?.criado) eventos.push({ em: run.criado, tipo: 'criado', titulo: 'Execução aberta', detalhe: String(run.objetivo || '').slice(0, 300) });
  for (const p of passosDoRun(steps)) {
    eventos.push({
      em: p.quando, tipo: 'passo', titulo: `Passo ${p.ordem} · ${p.titulo}`,
      detalhe: `${p.agente || 'agente'} · ${p.estado}${p.acoes.length ? ` · ${p.acoes.length} acção(ões)` : ' · sem acções'}`,
      estado: p.estado, ordem: p.ordem,
    });
    for (const a of p.acoes) {
      eventos.push({
        em: p.quando, tipo: 'accao', ordem: p.ordem,
        titulo: a.nome, detalhe: a.esperou ? 'pediu aprovação humana' : a.resumo || (a.ok ? 'correu' : 'falhou'),
        estado: a.ok ? 'concluido' : 'falhou',
      });
    }
  }
  for (const a of autorizacoesDoRun(run)) {
    eventos.push({
      em: a.em, tipo: 'autorizacao',
      titulo: a.decisao === 'recusada' ? 'Aprovação recusada' : 'Aprovado por uma pessoa',
      detalhe: `${a.por || 'sem nome'}${a.oQue ? ` · ${a.oQue}` : ''}${a.motivo ? ` · ${a.motivo}` : ''}`,
      estado: a.decisao === 'recusada' ? 'falhou' : 'concluido',
    });
  }
  const c = cancelamentoDe(run);
  if (c.pedido) eventos.push({ em: c.em, tipo: 'cancelamento', titulo: 'Cancelamento pedido', detalhe: `${c.por || 'sem nome'}${c.efectivo ? ' · parou de facto' : ' · a parar entre passos'}`, estado: c.efectivo ? 'cancelado' : 'a_espera' });
  if (run?.repeticao_de) eventos.push({ em: run.criado, tipo: 'repeticao', titulo: 'Repetição de outra execução', detalhe: String(run.repeticao_de).slice(0, 40), estado: 'em_fila' });
  if (run?.fim) eventos.push({ em: run.fim, tipo: 'fim', titulo: `Fecho: ${estadoDoRun(run).rotulo}`, detalhe: estadoDoRun(run).porque, estado: estadoDoRun(run).id });
  const comHora = eventos.map((e, i) => ({ ...e, _i: i }));
  comHora.sort((a, b) => {
    const ta = new Date(a.em || 0).getTime() || 0;
    const tb = new Date(b.em || 0).getTime() || 0;
    return ta - tb || a._i - b._i;
  });
  return comHora.map(({ _i, ...e }) => e);
}

/* ---------------------------------------------------------------------------
   Quem autorizou.
   A base guarda `autorizacoes` (lista) desde a 1.61.0; execuções antigas podem
   ter só `autorizado_por`. As duas formas são lidas; nenhuma é inventada.
   ------------------------------------------------------------------------- */
export function autorizacoesDoRun(run) {
  const saida = [];
  if (run?.autorizado_por) {
    saida.push({ por: String(run.autorizado_por), em: run.criado || null, oQue: 'execução aprovada à partida', motivo: null, decisao: 'aprovada', legado: true });
  }
  for (const a of lista(run?.autorizacoes)) {
    if (!a) continue;
    saida.push({
      por: String(a.por || a.autor || 'sem nome'),
      em: a.em || a.quando || null,
      oQue: a.o_que || a.oQue || a.para || 'execução',
      motivo: a.motivo || null,
      decisao: a.decisao === 'recusada' ? 'recusada' : 'aprovada',
      legado: false,
    });
  }
  return saida;
}

/** O cancelamento é um pedido datado; «efectivo» só quando o motor parou. */
export function cancelamentoDe(run) {
  const c = run?.cancelamento || null;
  const pedido = !!(c && (c.pedido || c.em));
  return {
    pedido,
    por: c?.por || null,
    em: c?.em || null,
    efectivo: !!(c?.efectivo || (pedido && String(run?.estado) === 'cancelado')),
    porque: c?.porque || (pedido ? 'a parar entre passos — uma chamada já começada termina' : null),
  };
}

/* ---------------------------------------------------------------------------
   O que se pode fazer.
   Cada botão diz «sim» ou «não» e, quando é «não», a razão escrita. A interface
   desenha o botão a partir disto — não decide sozinha.
   ------------------------------------------------------------------------- */
const activo = (run) => estadoDoRun(run).activo;

export function podeCancelar(run) {
  const e = estadoDoRun(run);
  if (!run) return { sim: false, porque: 'execução não encontrada' };
  if (e.id === 'cancelado') return { sim: false, porque: 'já está cancelada' };
  if (e.fechado) return { sim: false, porque: `já fechou (${e.rotulo.toLowerCase()}) — não há nada para parar` };
  if (cancelamentoDe(run).pedido) return { sim: false, porque: 'o cancelamento já foi pedido; falta o motor chegar ao fim do passo' };
  return { sim: true, porque: 'o motor verifica entre passos e entre ferramentas' };
}

export function podeAprovar(run) {
  const e = estadoDoRun(run);
  if (!run) return { sim: false, porque: 'execução não encontrada' };
  if (e.id !== 'a_espera') return { sim: false, porque: e.activo ? 'está a correr: não há nada à espera de decisão' : `já fechou (${e.rotulo.toLowerCase()})` };
  return { sim: true, porque: run?.pendente?.resumo || 'há uma acção sensível parada à espera de resposta' };
}

export function podeRepetir(run, runs = [], { agora = Date.now() } = {}) {
  if (!run) return { sim: false, porque: 'execução não encontrada' };
  const e = estadoDoRun(run);
  if (e.activo) return { sim: false, porque: 'esta execução ainda não fechou — repetir agora duplicava trabalho e efeitos' };
  const vivo = lista(runs).find((r) => r && r.repeticao_de === run.id && activo(r));
  if (vivo) return { sim: false, porque: `já há uma repetição desta execução a correr (#${String(vivo.id).slice(0, 6)})` };
  void agora;
  return { sim: true, porque: 'abre uma execução nova, ligada a esta; a antiga fica no histórico', chave: chaveDeRepeticao(run) };
}

/** Repetir é criar outra execução. A chave impede o duplo clique de criar duas. */
export function chaveDeRepeticao(run) {
  return run?.id ? `repetir:${run.id}` : null;
}

/* ---------------------------------------------------------------------------
   Erros com recuperação: o que fazer a seguir, em palavras e em acções.
   ------------------------------------------------------------------------- */
export function recuperacao(run, steps = []) {
  const e = estadoDoRun(run);
  const passos = passosDoRun(steps);
  const falhado = passos.filter((p) => p.estado === 'falhou');
  const erro = String(run?.erro || falhado[0]?.erro || '').toLowerCase();
  const opcoes = [];

  if (e.id === 'a_espera') {
    return {
      necessaria: true,
      porque: run?.pendente?.resumo || 'há uma decisão à tua espera',
      opcoes: [
        { id: 'aprovar', rotulo: 'Aprovar e continuar', accao: 'run-aprovar', porque: 'a acção corre com o teu nome no registo' },
        { id: 'recusar', rotulo: 'Recusar', accao: 'run-recusar', porque: 'a execução fecha cancelada, com a razão escrita' },
      ],
    };
  }
  if (e.id === 'concluido') return { necessaria: false, porque: 'nada a recuperar — fechou com resultado', opcoes: [] };
  if (e.id === 'cancelado') {
    return {
      necessaria: false, porque: 'foi cancelada a pedido — não se retoma sozinha',
      opcoes: [{ id: 'repetir', rotulo: 'Correr outra vez', accao: 'run-repetir', porque: 'os passos já feitos não se repetem sem tu mandares' }],
    };
  }
  if (e.id === 'em_fila' || e.id === 'em_execucao') {
    return { necessaria: false, porque: 'ainda está a decorrer', opcoes: [{ id: 'cancelar', rotulo: 'Parar', accao: 'run-cancelar', porque: 'pára entre passos' }] };
  }

  /* falhou: escolher a recuperação pela causa, não por um genérico «tenta outra vez» */
  if (/nenhum fornecedor|sem chave|api key|no key|chave/.test(erro) && !passos.length) {
    return {
      necessaria: true, porque: 'não há motor configurado com chave para começar',
      opcoes: [
        { id: 'motores', rotulo: 'Ver motores e chaves', accao: 'ir-motores', porque: 'sem chave nenhuma execução começa — é a única coisa que resolve' },
        { id: 'repetir', rotulo: 'Repetir depois de ligar', accao: 'run-repetir', porque: 'abre uma execução nova com o mesmo objectivo' },
      ],
    };
  }
  if (/plano/.test(erro)) {
    return {
      necessaria: true, porque: 'o modelo não devolveu um plano legível e nada chegou a correr',
      opcoes: [{ id: 'repetir', rotulo: 'Tentar outra vez', accao: 'run-repetir', porque: 'nenhum passo correu: repetir não duplica efeitos' }],
    };
  }
  if (/or[çc]amento|tokens|limite/.test(erro)) {
    return {
      necessaria: true, porque: 'o orçamento desta execução acabou a meio',
      opcoes: [
        { id: 'retomar', rotulo: 'Continuar de onde parou', accao: 'run-retomar', porque: 'reaproveita o plano e salta os passos já concluídos' },
        { id: 'repetir', rotulo: 'Começar de novo', accao: 'run-repetir', porque: 'repete tudo, incluindo o que já estava feito' },
      ],
    };
  }
  if (falhado.length) {
    return {
      necessaria: true,
      porque: `o passo ${falhado[0].ordem} («${falhado[0].titulo}») falhou: ${falhado[0].erro || 'sem mensagem'}`,
      opcoes: [
        { id: 'retomar', rotulo: 'Continuar do passo falhado', accao: 'run-retomar', porque: 'os passos concluídos não se repetem' },
        { id: 'repetir', rotulo: 'Correr tudo outra vez', accao: 'run-repetir', porque: 'para quando o problema é o plano, não o passo' },
      ],
    };
  }
  return {
    necessaria: true, porque: run?.erro ? String(run.erro).slice(0, 300) : 'fechou sem resultado',
    opcoes: [
      { id: 'retomar', rotulo: 'Continuar', accao: 'run-retomar', porque: 'reaproveita o que já está feito' },
      { id: 'repetir', rotulo: 'Repetir', accao: 'run-repetir', porque: 'abre uma execução nova' },
    ],
  };
}

/* ---------------------------------------------------------------------------
   Contas da execução: passos, acções, tokens, custo, tempo.
   ------------------------------------------------------------------------- */
export function resumoDoRun(run, steps = []) {
  const passos = passosDoRun(steps);
  const acoes = passos.flatMap((p) => p.acoes);
  const centimos = Number(run?.custo_centimos);
  const temCusto = Number.isFinite(centimos) && centimos > 0;
  const inicio = run?.criado ? new Date(run.criado).getTime() : null;
  const fim = run?.fim ? new Date(run.fim).getTime() : null;
  const ms = inicio && fim && fim >= inicio ? fim - inicio : passos.reduce((s, p) => s + (p.ms || 0), 0) || null;
  return {
    passos: passos.length,
    concluidos: passos.filter((p) => p.estado === 'concluido').length,
    falhados: passos.filter((p) => p.estado === 'falhou').length,
    aEspera: passos.filter((p) => p.estado === 'a_espera').length,
    acoes: acoes.length,
    acoesFalhadas: acoes.filter((a) => !a.ok).length,
    ferramentas: [...new Set(acoes.map((a) => a.nome))],
    tokens: Number(run?.tokens_in || 0) + Number(run?.tokens_out || 0),
    custo: temCusto ? { centimos, desconhecido: false } : { centimos: null, desconhecido: true },
    duracao: duracaoDe(ms),
    ms,
    modelo: run?.modelo || passos.find((p) => p.modelo)?.modelo || null,
    fornecedor: run?.fornecedor || passos.find((p) => p.fornecedor)?.fornecedor || null,
    autorizacoes: autorizacoesDoRun(run).length,
    repeticaoDe: run?.repeticao_de || null,
  };
}

/** Uma linha por execução para listas. `numero` é o inicio do id — é real. */
export function cartaoDoRun(run, steps = [], { agora = Date.now() } = {}) {
  const e = estadoDoRun(run);
  const r = resumoDoRun(run, steps);
  return {
    id: run?.id || null,
    numero: run?.id ? String(run.id).replace(/-/g, '').slice(0, 6) : '—',
    titulo: String(run?.objetivo || 'sem objectivo escrito').slice(0, 160),
    estado: e,
    quando: quandoDe(run?.criado, agora),
    fim: run?.fim ? quandoDe(run.fim, agora) : null,
    passos: r.passos,
    acoes: r.acoes,
    custo: r.custo,
    duracao: r.duracao,
    nota: e.id === 'falhou' ? (run?.erro ? String(run.erro).slice(0, 180) : null) : null,
    repeticaoDe: r.repeticaoDe,
  };
}

/** As execuções que pedem atenção agora — para a mesa e para o telemóvel. */
export function filaDeExecucao(runs = []) {
  const cartoes = lista(runs).map((r) => cartaoDoRun(r, r?.passos || []));
  const por = (id) => cartoes.filter((c) => c.estado.id === id);
  const aCorrer = por('em_execucao');
  const aEspera = por('a_espera');
  const fila = por('em_fila');
  const falharam = por('falhou');
  const partes = [];
  if (aEspera.length) partes.push(`${aEspera.length} à espera de aprovação`);
  if (aCorrer.length) partes.push(`${aCorrer.length} a correr`);
  if (fila.length) partes.push(`${fila.length} em fila`);
  if (!partes.length && falharam.length) partes.push(`${falharam.length} falhada${falharam.length === 1 ? '' : 's'}`);
  return {
    total: cartoes.length, aCorrer, aEspera, fila, falharam, cartoes,
    algumaActiva: aCorrer.length + aEspera.length + fila.length > 0,
    frase: partes.length ? partes.join(' · ') : (cartoes.length ? 'nada a correr neste momento' : 'ainda não houve execuções'),
  };
}

/* ---------------------------------------------------------------------------
   Avisos honestos que a página tem de dizer por cima da lista.
   ------------------------------------------------------------------------- */
export function avisosDaLista({ runs = [], modoLocal = false } = {}) {
  const avisos = [];
  if (modoLocal) {
    avisos.push({
      tipo: 'local',
      texto: 'Neste browser não corre nenhum agente: a mesa local não tem motor nem chaves. As execuções acontecem no servidor, e só lá ficam registadas.',
    });
  }
  const f = filaDeExecucao(runs);
  if (f.aEspera.length) avisos.push({ tipo: 'espera', texto: `${f.aEspera.length} execução(ões) parada(s) à espera de uma decisão tua — sem resposta, não avançam.` });
  if (!runs.length && !modoLocal) avisos.push({ tipo: 'vazio', texto: 'Ainda não houve execuções nesta instalação. Quando houver, aparecem aqui com passos, acções e custo.' });
  return avisos;
}
