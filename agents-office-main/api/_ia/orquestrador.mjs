/* ===========================================================================
   1.18.0 · O ORQUESTRADOR (30 out 2026)

   O fluxo de produção, por esta ordem:

     1. o dono descreve o trabalho            → `correr({objetivo})`
     2. o Orchestrator analisa e planeia      → passo com o modelo de raciocínio
     3. o plano fica gravado (runs.plano)     → a interface mostra-o a acontecer
     4. cada passo vai ao agente certo, com as SUAS ferramentas
     5. as ferramentas correm no servidor     → resultado real, registado
     6. o Reviewer lê tudo e decide           → aprovado / com ressalvas / rejeitado
     7. uma correcção, no máximo              → depois fecha
     8. o resultado, os passos e as limitações ficam na base

   O que este ficheiro não faz: fingir. Se não há fornecedor com chave, a
   execução nasce `falhou` com essa razão escrita; se o orçamento acaba, fecha
   `parcial` com o que ficou por fazer — nunca inventa um final feliz.
   =========================================================================== */
import { AGENTES, promptDe } from './agentes.mjs';
import { executar as executarFerramenta, paraModelo, INDISPONIVEIS, FERRAMENTAS } from './ferramentas.mjs';
import { orcamento } from './router.mjs';
import { tectoDeCusto } from '../_dinheiro.mjs';

const LIMITE_PASSOS = 6;
const MAX_RODADAS_FERRAMENTA = 3;

const cortar = (t, n = 2400) => {
  const s = String(t || '');
  return s.length > n ? `${s.slice(0, n)}\n[…cortado: ${s.length - n} caracteres]` : s;
};

/** Sacar o primeiro objecto JSON de um texto (os modelos embrulham-no em prosa). */
export function lerPlano(texto) {
  const s = String(texto || '');
  const i = s.indexOf('{');
  const f = s.lastIndexOf('}');
  if (i < 0 || f <= i) return null;
  let bruto = s.slice(i, f + 1);
  try { return JSON.parse(bruto); } catch { /* tenta limpar cercas */ }
  bruto = bruto.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(bruto); } catch { return null; }
}

export function normalizarPlano(obj) {
  const passos = Array.isArray(obj?.passos) ? obj.passos : Array.isArray(obj?.steps) ? obj.steps : null;
  if (!passos) return null;
  const limpos = passos.slice(0, LIMITE_PASSOS).map((p, i) => {
    const agente = String(p.agente || p.agent || '').toLowerCase().replace(/^agent\s*0?\d\s*[-—:]\s*/, '');
    const id = AGENTES[agente] ? agente
      : Object.keys(AGENTES).find((k) => AGENTES[k].nome.toLowerCase() === agente) || 'research';
    return {
      ordem: i + 1,
      agente: id,
      titulo: String(p.titulo || p.title || `passo ${i + 1}`).slice(0, 160),
      instrucao: String(p.instrucao || p.instruction || p.o_que || '').slice(0, 1200),
      criterio: String(p.criterio || p.criteria || 'resultado concreto e verificável').slice(0, 300),
    };
  }).filter((p) => p.instrucao);
  return limpos.length ? { passos: limpos, limites: Array.isArray(obj?.limites) ? obj.limites.map(String).slice(0, 6) : [] } : null;
}

/* Uma ronda de conversa com ferramentas: o modelo pede, o servidor executa,
   o resultado volta para o modelo. Máximo `MAX_RODADAS_FERRAMENTA` rondas. */
async function conversarComFerramentas({ motor, agente, tipo, mensagens, orc, ctx, maxTokens = 1400, cancelado = async () => false }) {
  const permitidas = AGENTES[agente].ferramentas.filter((f) => FERRAMENTAS[f]);
  const ferramentas = paraModelo(permitidas);
  const conversa = [...mensagens];
  const chamadasFeitas = [];
  let ultimo = null;

  for (let rodada = 0; rodada < MAX_RODADAS_FERRAMENTA; rodada += 1) {
    const r = await motor.pedir(tipo, conversa, { ferramentas, agente, maxTokens, orc });
    ultimo = r;
    if (!r.chamadas?.length) return { texto: r.texto, chamadas: chamadasFeitas, entrada: r.entrada, modelo: r.modelo, fornec: r.fornec, tentativas: r.tentativas };

    conversa.push({
      role: 'assistant',
      content: r.texto || '',
      tool_calls: r.chamadas.map((c) => ({ id: c.id, type: 'function', function: { name: c.nome, arguments: JSON.stringify(c.argumentos || {}) } })),
    });
    for (const c of r.chamadas) {
      /* 1.61.0 · cancelamento REAL: verifica-se antes de cada ferramenta, não
         só entre passos. Uma chamada já começada termina; a seguinte não começa. */
      if (await cancelado()) {
        return { texto: ultimo?.texto || '', chamadas: chamadasFeitas, cancelado: true, modelo: ultimo?.modelo, fornec: ultimo?.fornec };
      }
      const res = await executarFerramenta(c.nome, c.argumentos, { ...ctx, permitidas, agente });
      const chamada = { nome: c.nome, argumentos: c.argumentos, ok: !!res.ok, resumo: res.resumo || res.erro || '', precisaAprovacao: !!res.precisaAprovacao, ms: res.ms || 0 };
      chamadasFeitas.push(chamada);
      /* Uma acção destrutiva sem autorização não é um erro a repetir às cegas:
         é uma execução que pára à espera de uma pessoa. Devolve-se o pedido e o
         passo fica `aguarda_aprovacao` — nada mais corre até haver resposta. */
      if (res.precisaAprovacao) {
        return { texto: ultimo?.texto || '', chamadas: chamadasFeitas, pausa: chamada, modelo: ultimo?.modelo, fornec: ultimo?.fornec };
      }
      conversa.push({ role: 'tool', tool_call_id: c.id, name: c.nome, content: JSON.stringify(res.dados ?? { ok: res.ok, resumo: res.resumo, erro: res.erro }) });
    }
  }
  return { texto: ultimo?.texto || '', chamadas: chamadasFeitas, entrada: ultimo?.entrada, modelo: ultimo?.modelo, fornec: ultimo?.fornec, tentativas: ultimo?.tentativas, aviso: 'limite de rondas de ferramentas atingido' };
}

const blocoContexto = (resumos) => resumos.map((r, i) => `${i + 1}. [${r.agente}] ${r.titulo}\n${cortar(r.saida, 1200)}`).join('\n\n');

/**
 * Corre um trabalho de ponta a ponta. Devolve o run final (como está na base).
 * `aoMudar(run)` é chamado a cada passo — a interface lê da base, não disto.
 */
export async function correr({
  repo, motor, objetivo, runId = null, aoMudar = () => {}, aprovado = false,
  limites = {}, env = process.env, retomar = false,
}) {
  /* o teto de custo (ORBITA_ORCAMENTO_CENTIMOS) vale aqui também: o motor só o
     põe por omissão quando não recebe um orçamento, e este caminho recebe. */
  const orc = orcamento({
    maxChamadas: limites.maxChamadas || 16, maxTokens: limites.maxTokens || 160000,
    maxCustoMicroUsd: tectoDeCusto(env),
  });
  /* 1.61.0 · o que uma pessoa autorizou, ferramenta a ferramenta, com nome e
     hora. Sem isto, uma acção destrutiva fica parada — não corre «porque sim». */
  const aprovadasDe = (registo) => (Array.isArray(registo?.autorizacoes) ? registo.autorizacoes : [])
    .filter((a) => a && a.decisao === 'aprovada' && a.o_que)
    .map((a) => String(a.o_que));
  const ctx = { repo, aprovado, allowFerramentas: true, aprovadas: [] };

  const run = runId
    ? await repo.ia.runs.porId(runId)
    : await repo.ia.runs.criar({ objetivo: String(objetivo || '').slice(0, 2000), estado: 'a_planear', plano: null, agente: 'orchestrator' });
  if (!run) throw new Error('execução não encontrada');
  /* retomar = continuar de um plano já gravado, sem repetir os passos que já
     ficaram concluídos. Sem plano (ou sem pedido de retomar), é começar do zero. */
  const retomando = !!(runId && retomar && run.plano && Array.isArray(run.plano.passos) && run.plano.passos.length);
  ctx.aprovadas = aprovadasDe(run);
  /* O cancelamento é lido da base (não de memória): o pedido pode chegar de
     outro separador ou do telemóvel enquanto esta execução corre. */
  let cancelamentoEfectivo = false;
  const cancelado = async () => {
    const agora = await repo.ia.runs.porId(run.id);
    if (agora?.estado !== 'cancelado' && !agora?.cancelamento?.pedido) return false;
    cancelamentoEfectivo = true;
    return true;
  };
  if (run.estado === 'cancelado' && !retomando) return run;   // cancelada antes de começar: não se começa
  const mudar = async (campos) => {
    const r = await repo.ia.runs.actualizar(run.id, campos);
    try { aoMudar(r); } catch { /* quem escuta não pode partir a execução */ }
    return r;
  };

  try {
    const servico = (await motor.estado()).diagnostico;
    if (!servico.pronto) {
      const erro = 'nenhum fornecedor de IA configurado — mete as chaves no ambiente da Vercel (ver AI Control Center)';
      return await mudar({ estado: 'falhou', erro, fim: new Date().toISOString() });
    }

    /* --- 2/3 · planear (ou reaproveitar o plano de uma execução anterior) --- */
    let plano;
    if (retomando) {
      plano = run.plano;
      await mudar({ estado: 'a_executar', erro: null, plano });
    } else {
      const contextoMesa = await executarFerramenta('mesa_resumo', {}, ctx);
      /* 1.19.0 · antes de planear, ouvir a memória (plugins do Graft): notas
         parecidas poupam raciocínio e evitam repetir decisões antigas. */
      let notas = [];
      let comoProcurou = 'lexical';
      try {
        const { procurar } = await import('./memoria.mjs');
        const r = await procurar(repo, { consulta: objetivo, limite: 5, env });
        notas = r.achados || [];
        comoProcurou = r.modo || 'lexical';
      } catch { notas = []; }
      /* 1.49.0 · com Mem0 configurado a procura é semântica e o prompt di-lo —
         o modelo merece saber se o que recebe é «por sentido» ou «por palavras». */
      const deOnde = comoProcurou === 'mem0+lexical' ? 'procura semântica (Mem0) sobre a lexical' : 'procura lexical, por palavras';
      const blocoMemoria = notas.length
        ? `\n\nNotas da memória que podem ser próximas (${deOnde}; confirma antes de usar):\n${notas.map((n) => `- ${n.titulo}: ${String(n.texto).slice(0, 300)}`).join('\n')}`
        : `\n\nA memória não tem nada parecido com este objectivo (${deOnde}).`;
      const planoR = await motor.pedir('plano', [
        { role: 'system', content: `${promptDe('orchestrator')}\n\nResponde SÓ com um objecto JSON, sem prosa, neste formato:\n{\"passos\":[{\"agente\":\"research|design|frontend|backend|qa|creative|reviewer\",\"titulo\":\"...\",\"instrucao\":\"...\",\"criterio\":\"...\"}],\"limites\":[\"o que não é possível nesta instalação\"]}` },
        { role: 'user', content: `Objectivo do dono:\n${objetivo}\n\nContexto real da mesa agora: ${JSON.stringify(contextoMesa.dados || {})}${blocoMemoria}\n\nFerramentas que existem: ${Object.keys(FERRAMENTAS).join(', ')}.\nNÃO existem: ${INDISPONIVEIS.map((i) => i.id).join(', ')}.` },
      ], { agente: 'orchestrator', maxTokens: 1400, orc });

      plano = normalizarPlano(lerPlano(planoR.texto));
      if (!plano) {
        return await mudar({
          estado: 'falhou', modelo: planoR.modelo, fornecedor: planoR.fornec,
          erro: `o modelo não devolveu um plano legível (${String(planoR.texto || '').slice(0, 200)})`,
          fim: new Date().toISOString(),
        });
      }
      await mudar({ estado: 'a_executar', plano, modelo: planoR.modelo, fornecedor: planoR.fornec });
    }

    /* --- 4/5 · executar (e, ao retomar, saltar o que já está concluído) --- */
    const anteriores = await repo.ia.steps.porRun(run.id);
    const existentes = new Map(anteriores.map((s) => [s.ordem, s]));
    const jaFeitos = anteriores
      .filter((x) => x.estado === 'concluido' && x.agente !== 'reviewer')
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    const feitos = new Set(jaFeitos.map((x) => x.ordem));
    const resumos = jaFeitos.map((x) => ({ agente: x.agente, titulo: x.titulo, saida: x.saida || '(vazio)', ferramentas: x.ferramentas || [] }));
    for (const [indice, passo] of plano.passos.entries()) {
      const ordem = indice + 1;
      const actual = await repo.ia.runs.porId(run.id);
      /* 1.61.0 · parar é parar: basta o PEDIDO, não é preciso o estado final. E o
         registo diz que a paragem foi efectiva (o passo anterior já tinha fim). */
      if (actual?.estado === 'cancelado' || actual?.cancelamento?.pedido) {
        return await mudar({
          estado: 'cancelado', fim: new Date().toISOString(),
          cancelamento: {
            ...(actual.cancelamento || {}), pedido: true, efectivo: true,
            em: actual.cancelamento?.em || new Date().toISOString(),
            porque: 'parada verificada entre passos',
          },
        });
      }
      if (feitos.has(ordem)) continue;   // retomada: não se repete trabalho já feito

      /* Retomar depois de uma pausa não deixa dois passos com o mesmo número:
         reaproveita-se a linha que já existe (a que ficou à espera ou falhou). */
      const anteriorLinha = retomando ? existentes.get(ordem) : null;
      const step = anteriorLinha && anteriorLinha.estado !== 'concluido'
        ? await repo.ia.steps.actualizar(anteriorLinha.id, {
          estado: 'a_correr', entrada: passo.instrucao, saida: null, erro: null,
          ferramentas: [], duracao_ms: null, agente: passo.agente, titulo: passo.titulo,
        })
        : await repo.ia.steps.criar({
          run_id: run.id, ordem, agente: passo.agente, titulo: passo.titulo,
          estado: 'a_correr', entrada: passo.instrucao,
        });
      await mudar({ agente: passo.agente, estado: 'a_executar' });

      const inicio = Date.now();
      try {
        const anterior = resumos.length ? `\n\nO que os passos anteriores produziram:\n${blocoContexto(resumos)}` : '';
        const r = await conversarComFerramentas({
          motor, agente: passo.agente, tipo: (AGENTES[passo.agente].tipos || ['texto'])[0], orc, ctx,
          cancelado,
          mensagens: [
            { role: 'system', content: promptDe(passo.agente) },
            { role: 'user', content: `Passo ${ordem} de ${plano.passos.length}: ${passo.titulo}\n\nO que fazer: ${passo.instrucao}\nComo se sabe que ficou bem: ${passo.criterio}${anterior}` },
          ],
        });
        /* 1.61.0 · parou porque alguém mandou parar. O passo fica `cancelado` e
           o registo da execução diz que a paragem foi efectiva (não «pedida»). */
        if (r.cancelado) {
          await repo.ia.steps.actualizar(step.id, {
            estado: 'cancelado', ferramentas: r.chamadas, duracao_ms: Date.now() - inicio,
            saida: r.texto || null, erro: 'cancelada a pedido antes da próxima ferramenta',
          });
          return await mudar({
            estado: 'cancelado', fim: new Date().toISOString(),
            cancelamento: { ...(run.cancelamento || {}), pedido: true, efectivo: true, em: run.cancelamento?.em || new Date().toISOString(), porque: 'parada verificada entre ferramentas' },
          });
        }
        /* 1.61.0 · uma acção destrutiva sem autorização pára a execução. Não se
           marca como falha: fica à espera de uma pessoa, com o pedido escrito. */
        if (r.pausa) {
          await repo.ia.steps.actualizar(step.id, {
            estado: 'aguarda_aprovacao', ferramentas: r.chamadas, duracao_ms: Date.now() - inicio,
            saida: r.texto || null, erro: `«${r.pausa.nome}» precisa de aprovação humana`,
          });
          return await mudar({
            estado: 'aguarda_aprovacao',
            agente: passo.agente,
            pendente: {
              ordem, agente: passo.agente, ferramenta: r.pausa.nome, argumentos: r.pausa.argumentos || null,
              resumo: `«${r.pausa.nome}» é destrutiva e pede a tua autorização antes de correr`,
              desde: new Date().toISOString(),
            },
            erro: null, fim: null,
          });
        }
        const saida = String(r.texto || '').trim();
        const estado = saida ? 'concluido' : 'vazio';
        const s2 = await repo.ia.steps.actualizar(step.id, {
          estado, saida, modelo: r.modelo, fornecedor: r.fornec,
          ferramentas: r.chamadas, duracao_ms: Date.now() - inicio,
          erro: saida ? null : 'o agente não devolveu texto',
        });
        resumos.push({ agente: passo.agente, titulo: passo.titulo, saida: saida || '(vazio)', ferramentas: r.chamadas });
        await mudar({ modelo: r.modelo, fornecedor: r.fornec });
        try { await repo.atividade.add('ia', `${AGENTES[passo.agente].numero} ${AGENTES[passo.agente].nome}: ${passo.titulo}`); } catch { /* opcional */ }
        void s2;
      } catch (e) {
        await repo.ia.steps.actualizar(step.id, { estado: 'falhou', erro: String(e.message || e).slice(0, 400), duracao_ms: Date.now() - inicio });
        if (e.codigo === 'orcamento' || e.codigo === 'todosfalharam') {
          return await mudar({ estado: 'parcial', erro: String(e.message).slice(0, 400), resultado: resumos.map((r) => `[${r.agente}] ${r.saida}`).join('\n\n'), fim: new Date().toISOString() });
        }
        resumos.push({ agente: passo.agente, titulo: passo.titulo, saida: `falhou: ${e.message}` });
      }
    }

    /* 1.61.0 · pediram para parar enquanto corria o último passo: não se gasta
       uma chamada de revisão para fechar um trabalho que já não se quer. */
    if (await cancelado()) {
      return await mudar({
        estado: 'cancelado', fim: new Date().toISOString(),
        cancelamento: { ...(run.cancelamento || {}), pedido: true, efectivo: true, em: run.cancelamento?.em || new Date().toISOString(), porque: 'parada verificada antes da revisão' },
      });
    }

    /* --- 6 · revisão (agente independente) --- */
    let revisao = null;
    try {
      const rv = await motor.pedir('revisao', [
        { role: 'system', content: `${promptDe('reviewer')}

Responde SÓ com JSON: {"decisao":"aprovado|com_ressalvas|rejeitado","justificacao":"...","corrigir":["..."]}` },
        { role: 'user', content: `Objectivo: ${objetivo}\n\nTrabalho feito:\n${blocoContexto(resumos)}\n\nCritérios do plano:\n${plano.passos.map((p) => `- ${p.titulo}: ${p.criterio}`).join('\n')}` },
      ], { agente: 'reviewer', maxTokens: 900, orc });
      const obj = lerPlano(rv.texto) || {};
      revisao = {
        decisao: ['aprovado', 'com_ressalvas', 'rejeitado'].includes(obj.decisao) ? obj.decisao : 'com_ressalvas',
        justificacao: String(obj.justificacao || rv.texto || '').slice(0, 1200),
        corrigir: Array.isArray(obj.corrigir) ? obj.corrigir.map(String).slice(0, 6) : [],
        modelo: rv.modelo, fornecedor: rv.fornec,
      };
      revisao.fornecedor = rv.fornec;
      await repo.ia.steps.criar({
        run_id: run.id, ordem: plano.passos.length + 1, agente: 'reviewer', titulo: 'Revisão final',
        estado: 'concluido', saida: revisao.justificacao, modelo: revisao.modelo, fornecedor: revisao.fornecedor,
      });
    } catch (e) {
      revisao = { decisao: 'com_ressalvas', justificacao: `a revisão não correu: ${e.message}`, corrigir: [], modelo: null, fornecedor: null };
    }

    const resultado = resumos.map((r) => `### ${AGENTES[r.agente]?.nome || r.agente} — ${r.titulo}\n${r.saida}`).join('\n\n');
    const artefactos = {
      ferramentasUsadas: resumos.flatMap((r) => (r.ferramentas || []).map((f) => ({ nome: f.nome, ok: f.ok, resumo: f.resumo }))),
      limites: plano.limites?.length ? plano.limites : INDISPONIVEIS.filter((i) => /pesquisa|imagem|codigo|ficheiros/.test(i.id)).map((i) => `${i.id}: ${i.porque}`),
      orcamento: orc.resumo(),
      indisponiveis: INDISPONIVEIS,
    };
    const fim = await mudar({
      estado: 'concluido', resultado, artefactos, revisao,
      tokens_in: orc.tokens, tokens_out: 0, custo_centimos: orc.custoCentimos,
      fim: new Date().toISOString(),
    });

    /* 1.19.0 · escrever na memória no fim, como o `memoryze` do Graft: uma
       nota por execução concluída, com a decisão do Reviewer. Se falhar, a
       execução não falha por isso. */
    try {
      const { guardar } = await import('./memoria.mjs');
      const agentesUsados = [...new Set(resumos.map((r) => r.agente))];
      await guardar(repo, {
        titulo: String(objetivo).slice(0, 140),
        texto: `Objectivo: ${objetivo}\n\nO que foi feito:\n${resumos.map((r) => `- [${r.agente}] ${r.titulo}: ${String(r.saida).slice(0, 400)}`).join('\n')}\n\nRevisão (${revisao?.decisao}): ${revisao?.justificacao || ''}\n\nFerramentas usadas: ${(artefactos.ferramentasUsadas || []).map((f) => `${f.nome}${f.ok ? '' : '(falhou)'}`).join(', ') || 'nenhuma'}`,
        etiquetas: ['execucao', ...agentesUsados],
        fonte: `execução ${run.id}`,
        projeto: 'orbita',
      }, { env });
    } catch { /* memória é um extra: não parte o trabalho */ }

    return fim;
  } catch (e) {
    return await mudar({ estado: 'falhou', erro: String(e.message || e).slice(0, 500), fim: new Date().toISOString() });
  }
}
