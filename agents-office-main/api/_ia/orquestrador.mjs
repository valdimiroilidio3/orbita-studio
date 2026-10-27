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
async function conversarComFerramentas({ motor, agente, tipo, mensagens, orc, ctx, maxTokens = 1400 }) {
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
      const res = await executarFerramenta(c.nome, c.argumentos, { ...ctx, permitidas, agente });
      chamadasFeitas.push({ nome: c.nome, argumentos: c.argumentos, ok: !!res.ok, resumo: res.resumo || res.erro || '', precisaAprovacao: !!res.precisaAprovacao, ms: res.ms || 0 });
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
export async function correr({ repo, motor, objetivo, runId = null, aoMudar = () => {}, aprovado = false, limites = {}, env = process.env }) {
  const orc = orcamento({ maxChamadas: limites.maxChamadas || 16, maxTokens: limites.maxTokens || 160000 });
  const ctx = { repo, aprovado, allowFerramentas: true };

  const run = runId
    ? await repo.ia.runs.porId(runId)
    : await repo.ia.runs.criar({ objetivo: String(objetivo || '').slice(0, 2000), estado: 'a_planear', plano: null, agente: 'orchestrator' });
  if (!run) throw new Error('execução não encontrada');
  if (run.estado === 'cancelado') return run;   // cancelada antes de começar: não se começa
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

    /* --- 2/3 · planear --- */
    const contextoMesa = await executarFerramenta('mesa_resumo', {}, ctx);
    const planoR = await motor.pedir('plano', [
      { role: 'system', content: `${promptDe('orchestrator')}

Responde SÓ com um objecto JSON, sem prosa, neste formato:
{"passos":[{"agente":"research|design|frontend|backend|qa|creative|reviewer","titulo":"...","instrucao":"...","criterio":"..."}],"limites":["o que não é possível nesta instalação"]}` },
      { role: 'user', content: `Objectivo do dono:\n${objetivo}\n\nContexto real da mesa agora: ${JSON.stringify(contextoMesa.dados || {})}\n\nFerramentas que existem: ${Object.keys(FERRAMENTAS).join(', ')}.\nNÃO existem: ${INDISPONIVEIS.map((i) => i.id).join(', ')}.` },
    ], { agente: 'orchestrator', maxTokens: 1400, orc });

    const plano = normalizarPlano(lerPlano(planoR.texto));
    if (!plano) {
      return await mudar({
        estado: 'falhou', modelo: planoR.modelo, fornecedor: planoR.fornec,
        erro: `o modelo não devolveu um plano legível (${String(planoR.texto || '').slice(0, 200)})`,
        fim: new Date().toISOString(),
      });
    }
    await mudar({ estado: 'a_executar', plano, modelo: planoR.modelo, fornecedor: planoR.fornec });

    /* --- 4/5 · executar --- */
    const resumos = [];
    let ordem = 0;
    for (const passo of plano.passos) {
      const actual = await repo.ia.runs.porId(run.id);
      if (actual?.estado === 'cancelado') return mudar({ estado: 'cancelado', fim: new Date().toISOString() });

      ordem += 1;
      const step = await repo.ia.steps.criar({
        run_id: run.id, ordem, agente: passo.agente, titulo: passo.titulo,
        estado: 'a_correr', entrada: passo.instrucao,
      });
      await mudar({ agente: passo.agente, estado: 'a_executar' });

      const inicio = Date.now();
      try {
        const anterior = resumos.length ? `\n\nO que os passos anteriores produziram:\n${blocoContexto(resumos)}` : '';
        const r = await conversarComFerramentas({
          motor, agente: passo.agente, tipo: (AGENTES[passo.agente].tipos || ['texto'])[0], orc, ctx,
          mensagens: [
            { role: 'system', content: promptDe(passo.agente) },
            { role: 'user', content: `Passo ${ordem} de ${plano.passos.length}: ${passo.titulo}\n\nO que fazer: ${passo.instrucao}\nComo se sabe que ficou bem: ${passo.criterio}${anterior}` },
          ],
        });
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
        run_id: run.id, ordem: ordem + 1, agente: 'reviewer', titulo: 'Revisão final',
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
    return await mudar({
      estado: 'concluido', resultado, artefactos, revisao,
      tokens_in: orc.tokens, tokens_out: 0, custo_centimos: orc.custoCentimos,
      fim: new Date().toISOString(),
    });
  } catch (e) {
    return await mudar({ estado: 'falhou', erro: String(e.message || e).slice(0, 500), fim: new Date().toISOString() });
  }
}
