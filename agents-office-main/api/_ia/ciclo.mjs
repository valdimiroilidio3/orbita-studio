/* ===========================================================================
   1.67.0 · O CICLO — os agentes a trabalhar sem ninguém a carregar em nada
   (5 nov 2026)

   O que havia até aqui, dito sem rodeios: uma tarefa com `state: 'queued'` era
   uma linha esquecida. O resumo da mesa contava-a em «na fila», o escritório
   punha-a em «fila», e **nada neste produto alguma vez a ia buscar**. Só corria
   trabalho quando o pedido HTTP que o criava ainda estava vivo — e a função
   morre aos 60 s. «Os agentes trabalham sozinhos» era uma frase que o código não
   cumpria.

   Este ficheiro é o ciclo que faltava. Regras que não quebra:

     · **uma tarefa corre uma vez.** O `state` é o cadeado: a passagem de
       `queued` → `running` é condicional na base (`state=eq.queued`), por isso
       dois ciclos ao mesmo tempo não fazem o mesmo trabalho duas vezes nem
       pagam duas chamadas ao mesmo modelo;
     · **a autonomia decide, não o acaso.** Sem registo de autonomia para o tipo
       de trabalho, o ciclo **não gasta** — deixa a tarefa «à espera de
       aprovação» com a razão escrita. `proposto` corre e mostra o resultado;
       `autonomo` corre e fecha;
     · **o tempo é finito.** A função da Vercel tem 60 s: o ciclo para antes
       disso, deixa o resto na fila e diz quantas ficaram. Nunca finge que
       acabou;
     · **falhar é falhar.** Sem motor de IA, a tarefa fica `failed` com o motivo
       verdadeiro (`executarTarefa` já o sabe dizer). Nada de resultados
       inventados para a fila parecer vazia.
   =========================================================================== */
import { executarTarefa, registarDesfecho } from '../_tarefas.mjs';

/** Os três níveis que `api/_rotas.mjs` já usa em `/ops/autonomia`. */
export const NIVEIS = ['pedir_sempre', 'proposto', 'autonomo'];

/** O escopo de autonomia de um tipo de tarefa. Um só sítio o inventa. */
export const escopoDaTarefa = (kind) => `tarefa:${String(kind || '').trim()}`;

/**
 * O que fazer com uma tarefa em fila, dado o nível de autonomia. Puro.
 * Devolve `correr` (gastar uma chamada de IA agora) e `aprovar` (fechar o
 * trabalho como concluído sem passar por ti).
 */
export function decidir({ nivel, temMotor = true } = {}) {
  const n = NIVEIS.includes(nivel) ? nivel : 'pedir_sempre';
  if (!temMotor) {
    return {
      nivel: n, correr: false, aprovar: false, guardar: false,
      porque: 'não há motor de IA nesta instalação — a tarefa não corre até haver um (não se inventa um resultado)',
    };
  }
  if (n === 'autonomo') {
    return {
      nivel: n, correr: true, aprovar: true, guardar: true,
      porque: 'este tipo de trabalho está em «autónomo»: corre e fecha sozinho, e fica registado que foi a política que autorizou',
    };
  }
  if (n === 'proposto') {
    return {
      nivel: n, correr: true, aprovar: false, guardar: true,
      porque: 'este tipo está em «propõe e espera»: corre agora e fica à tua espera antes de contar como feito',
    };
  }
  return {
    nivel: n, correr: false, aprovar: false, guardar: true,
    porque: 'este tipo de trabalho pede a tua autorização antes de gastar uma chamada de IA — aprova a tarefa para ela correr',
  };
}

/** Há motor? A mesma pergunta que a prontidão faz, com a mesma resposta. */
export function haMotor({ env = {} } = {}) {
  /* a cadeia gratuita (LLM7 → OVH → OpenCode → Pollinations) não precisa de
     chave, por isso «não há chave» nunca é «não há motor». Só se a instalação
     disser explicitamente que não quer IA — `ORBITA_IA=desligada` — é que o
     ciclo se recusa a gastar. */
  return String(env.ORBITA_IA || '').toLowerCase() !== 'desligada';
}

const agoraIso = () => new Date().toISOString();

/**
 * Corre a fila. Devolve um retrato do que aconteceu — não uma promessa.
 *
 * `limite` é quantas tarefas tentar; `orcamentoMs` quando parar (medido do
 * início). Ambos são parâmetros para o teste poder provar a paragem a meio.
 */
export async function correrCiclo({
  repo, env = {}, fetchImpl = fetch, motor = null,
  limite = 2, orcamentoMs = 45000, agora = () => Date.now(),
} = {}) {
  const t0 = agora();
  const feitas = [];
  const paradas = [];
  let restantes = 0;

  let fila = [];
  try {
    fila = await repo.tarefas.emFila(Math.max(1, limite + 1));
  } catch (e) {
    return {
      ok: false, motivo: 'fila', frase: `não consegui ler a fila de tarefas: ${String(e?.message || e).slice(0, 160)}`,
      feitas, paradas, restantes: 0, gastouMs: 0,
    };
  }
  fila = Array.isArray(fila) ? fila : [];
  if (!fila.length) {
    return { ok: true, feitas, paradas, restantes: 0, gastouMs: agora() - t0, frase: 'a fila está vazia: não há trabalho pendente' };
  }

  const motorLigado = haMotor({ env });

  for (let i = 0; i < fila.length; i += 1) {
    const t = fila[i];
    if (feitas.length >= limite) { restantes = 1; paradas.push({ id: t.id, motivo: 'limite' }); break; }
    if (agora() - t0 > orcamentoMs) { restantes = 1; paradas.push({ id: t.id, motivo: 'tempo' }); break; }

    /* o cadeado: só corre se ESTE ciclo conseguiu levar a tarefa de `queued`
       para `running`. Devolver `null` significa que outro ciclo a levou. */
    let presa = null;
    try {
      presa = await repo.tarefas.reclamar(t.id);
    } catch (e) {
      paradas.push({ id: t.id, motivo: 'cadeado', erro: String(e?.message || e).slice(0, 160) });
      continue;
    }
    if (!presa) { paradas.push({ id: t.id, motivo: 'outro ciclo' }); continue; }

    const nivel = await lerNivel(repo, presa.kind);
    const d = decidir({ nivel, temMotor: motorLigado });

    if (!d.correr) {
      /* não se gasta nada: a tarefa fica à espera, e a razão vai para a Atividade
         porque a tabela das tarefas não tem (nem deve ter) um campo «porquê». */
      let guardada = presa;
      try {
        guardada = await repo.tarefas.patch(presa.id, { state: 'awaiting_approval', finished_at: null, error: null });
      } catch { /* a base pode não aceitar: a tarefa fica `running` e o ciclo diz */ }
      await repo.atividade.add('tarefa', `«${presa.kind}» ficou à espera: ${d.porque}`).catch(() => null);
      feitas.push({ id: presa.id, kind: presa.kind, acao: 'a_espera', nivel: d.nivel, porque: d.porque, tarefa: guardada });
      continue;
    }

    const r = await executarTarefa({ repo, tarefa: presa, env, fetchImpl, motor });
    const final = await registarDesfecho(repo, presa, r, { aprovacao: !d.aprovar && r.ok });
    await repo.atividade.add('tarefa', r.ok
      ? `«${presa.kind}» correu no ciclo com ${r.modelo || 'um modelo'}${d.aprovar ? '' : ' — à espera da tua aprovação'}`
      : `«${presa.kind}» não passou no ciclo — ${String(r.erro || 'sem motivo').slice(0, 200)}`).catch(() => null);
    feitas.push({
      id: presa.id, kind: presa.kind, acao: r.ok ? (d.aprovar ? 'concluida' : 'proposta') : 'falhou',
      nivel: d.nivel, porque: d.porque, ok: r.ok, modelo: r.modelo || null, ms: r.ms || 0,
      erro: r.ok ? null : String(r.erro || '').slice(0, 300), tarefa: final,
    });
  }

  if (restantes === 0 && fila.length > feitas.length + paradas.length) restantes = fila.length - feitas.length - paradas.length;

  return {
    ok: true, feitas, paradas, restantes,
    gastouMs: agora() - t0,
    frase: fraseDoCiclo({ feitas, paradas, restantes }),
  };
}

/** Lê o nível de autonomia do tipo; qualquer falha vale «pedir sempre». */
async function lerNivel(repo, kind) {
  try {
    const r = await repo.autonomia.porEscopo(escopoDaTarefa(kind));
    const n = r && NIVEIS.includes(r.nivel) ? r.nivel : 'pedir_sempre';
    return n;
  } catch { return 'pedir_sempre'; }
}

/** A frase que a mesa mostra. Diz o que aconteceu; não adivinha o que faltou. */
export function fraseDoCiclo({ feitas = [], paradas = [], restantes = 0 } = {}) {
  if (!feitas.length && !paradas.length) return 'não havia nada para correr';
  const cont = (acao) => feitas.filter((f) => f.acao === acao).length;
  const partes = [];
  if (cont('concluida')) partes.push(`${cont('concluida')} concluída(s)`);
  if (cont('proposta')) partes.push(`${cont('proposta')} à tua espera`);
  if (cont('a_espera')) partes.push(`${cont('a_espera')} à espera de autorização`);
  if (cont('falhou')) partes.push(`${cont('falhou')} não passaram`);
  const outros = paradas.filter((p) => p.motivo === 'outro ciclo').length;
  if (outros) partes.push(`${outros} já estavam a ser levadas por outro ciclo`);
  const base = partes.length ? `corri ${partes.join(' · ')}` : 'não corri nada';
  if (restantes) return `${base}. Ficaram ${restantes} na fila (o ciclo parou para não passar do tempo da função).`;
  return `${base}.`;
}

/** O retrato para o painel: quantas, e porquê. Nunca inventa uma estimativa. */
export function resumoDoCiclo(r) {
  const feitas = Array.isArray(r?.feitas) ? r.feitas : [];
  return {
    ok: !!r?.ok,
    frase: r?.frase || 'o ciclo ainda não correu',
    corridas: feitas.length,
    concluidas: feitas.filter((f) => f.acao === 'concluida').length,
    propostas: feitas.filter((f) => f.acao === 'proposta').length,
    emEspera: feitas.filter((f) => f.acao === 'a_espera').length,
    falhadas: feitas.filter((f) => f.acao === 'falhou').length,
    restantes: r?.restantes || 0,
    gastouMs: r?.gastouMs || 0,
    quando: agoraIso(),
  };
}
