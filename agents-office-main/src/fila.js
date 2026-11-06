/* ===========================================================================
   1.68.0 · A FILA DIZ A VERDADE (5 nov 2026)

   Depois da 1.67.0 a fila mexe — o ciclo leva as tarefas `queued`. Mas um ecrã
   que só diz «2 à espera» continua a esconder as duas perguntas que importam:

     · **quando é que esta corre?** (no próximo ciclo, se o tipo estiver em
       «autónomo»; nunca, até tu aprovares, se estiver em «pede-me sempre»)
     · **há quanto tempo está aqui?** (com um agendador diário, uma tarefa à
       espera há dois dias é uma tarefa que o ciclo não apanhou — e isso vê-se)

   Este ficheiro responde às duas, com contas puras: sem DOM, sem rede, sem
   relógio escondido (`agora` entra por parâmetro). Regras que não quebra:

   · o nível de autonomia vem de fora — se não vier, é «pede-me sempre», que é o
     mais seguro e o que o servidor também assume;
   · «há quanto tempo» é medido a partir de `created_at`; sem data, diz-se que
     não se sabe, em vez de zero;
   · o próximo ciclo é calculado (diário às 07:00 UTC), não prometido: se o
     agendador não estiver configurado, o texto di-lo e o cálculo é omitido.
   =========================================================================== */
import { idade } from './painel.js';

/** Os mesmos três níveis de `api/_ia/ciclo.mjs` e `/ops/autonomia`. */
export const NIVEIS = ['pedir_sempre', 'proposto', 'autonomo'];

/** O escopo de autonomia de um tipo. O mesmo formato do servidor. */
export const escopoDaTarefa = (kind) => `tarefa:${String(kind || '').trim()}`;

const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

const tempo = (x) => {
  if (!x) return null;
  const t = new Date(x).getTime();
  return Number.isNaN(t) ? null : t;
};

/** O que vai acontecer a uma tarefa na fila, e porquê. Decisão só, sem ecrã. */
export function promessaDaTarefa({ nivel = 'pedir_sempre', agendador = true } = {}) {
  const n = NIVEIS.includes(nivel) ? nivel : 'pedir_sempre';
  if (n === 'autonomo') {
    return {
      nivel: n, correSozinha: true, quando: agendador ? 'proximo-ciclo' : 'quando-correres',
      rotulo: agendador ? 'corre no próximo ciclo' : 'corre quando carregares em «Correr a fila agora»',
      porque: 'este tipo está em «autónomo»: o ciclo leva-a e fecha-a sozinho quando passar',
    };
  }
  if (n === 'proposto') {
    return {
      nivel: n, correSozinha: true, quando: agendador ? 'proximo-ciclo' : 'quando-correres',
      rotulo: agendador ? 'corre no próximo ciclo, e espera por ti' : 'corre quando carregares, e espera por ti',
      porque: 'este tipo está em «propõe e espera»: o resultado aparece, mas só conta como feito quando o aprovares',
    };
  }
  return {
    nivel: n, correSozinha: false, quando: 'a-tua-decisao',
    rotulo: 'espera pela tua autorização',
    porque: 'este tipo de trabalho está em «pede-me sempre»: o ciclo não gasta uma chamada de IA sem a tua autorização — aprova a tarefa para ela correr',
  };
}

/**
 * O próximo ciclo, calculado a partir da hora do agendamento (UTC).
 * Devolve `{ quando, emMs }` ou `null` quando não há agendador configurado —
 * `null` é «não sei», não é «daqui a nada».
 */
export function proximoCiclo({ agora = Date.now(), horaUTC = 7, agendador = true } = {}) {
  if (!agendador) return null;
  const h = Number(horaUTC);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  const d = new Date(agora);
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(h), 0, 0, 0));
  if (alvo.getTime() <= agora) alvo.setUTCDate(alvo.getUTCDate() + 1);
  return { quando: alvo.toISOString(), emMs: alvo.getTime() - agora };
}

const plural = (n, um, muitos) => `${n} ${Number(n) === 1 ? um : muitos}`;

/** «daqui a 3 h» — para o próximo ciclo. */
export function faltaPara(ms) {
  if (ms == null) return null;
  if (ms <= 0) return 'agora';
  if (ms < HORA) return `daqui a ${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DIA) return `daqui a ${Math.round(ms / HORA)} h`;
  return `daqui a ${Math.round(ms / DIA)} d`;
}

/**
 * A fila toda, com a razão de cada uma. `tarefas` pode ser a lista completa: só
 * as `queued` entram.
 */
export function analisarFila({ tarefas = [], autonomia = {}, agora = Date.now(), agendador = true, horaUTC = 7 } = {}) {
  const lista = (Array.isArray(tarefas) ? tarefas : [])
    .filter((t) => t && t.state === 'queued');
  const nivelDe = (kind) => {
    const chave = escopoDaTarefa(kind);
    const v = autonomia && (autonomia[chave] || autonomia[String(kind)]);
    return NIVEIS.includes(v) ? v : 'pedir_sempre';
  };

  const itens = lista.map((t) => {
    const nivel = nivelDe(t.kind);
    const p = promessaDaTarefa({ nivel, agendador });
    const criada = tempo(t.created_at);
    const esperaMs = criada == null ? null : Math.max(0, agora - criada);
    return {
      id: t.id,
      kind: t.kind || null,
      espera: idade(t.created_at, agora),
      esperaMs,
      esperaDesconhecida: esperaMs == null,
      /* mais de um dia à espera com um agendador diário = o ciclo não a apanhou */
      perdida: esperaMs != null && esperaMs > DIA + HORA,
      nivel,
      ...p,
    };
  }).sort((a, b) => (b.esperaMs ?? -1) - (a.esperaMs ?? -1));   // a mais antiga primeiro

  const proximo = proximoCiclo({ agora, horaUTC, agendador });
  const contagem = { autonomo: 0, proposto: 0, pedir_sempre: 0 };
  for (const i of itens) contagem[i.nivel] += 1;
  const maisAntiga = itens.find((i) => i.esperaMs != null) || null;

  return {
    itens,
    naFila: itens.length,
    contagem,
    maisAntiga: maisAntiga ? { id: maisAntiga.id, kind: maisAntiga.kind, espera: maisAntiga.espera, esperaMs: maisAntiga.esperaMs } : null,
    perdidas: itens.filter((i) => i.perdida).length,
    proximo,
    agendador: !!agendador,
    frase: fraseDaFila({ itens, contagem, proximo, agendador }),
  };
}

/** A frase do cartão. Diz o número, a idade e o que falta — nunca só «2 à espera». */
export function fraseDaFila({ itens = [], contagem = { autonomo: 0, proposto: 0, pedir_sempre: 0 }, proximo = null, agendador = true } = {}) {
  if (!itens.length) return 'A fila está vazia: não há trabalho pendente.';
  const partes = [plural(itens.length, 'tarefa na fila', 'tarefas na fila')];
  const antiga = itens.find((i) => i.espera && i.espera !== 'agora');
  if (antiga) partes.push(`a mais antiga há ${antiga.espera}`);
  const sozinhas = contagem.autonomo + contagem.proposto;
  if (sozinhas) partes.push(`${plural(sozinhas, 'corre sozinha', 'correm sozinhas')}${proximo ? ` ${faltaPara(proximo.emMs)}` : ' quando correres o ciclo'}`);
  if (contagem.pedir_sempre) partes.push(`${plural(contagem.pedir_sempre, 'espera', 'esperam')} por ti`);
  const perdidas = itens.filter((i) => i.perdida).length;
  let s = `${partes.join(' · ')}.`;
  if (perdidas) {
    s += perdidas === 1
      ? ' Uma está aqui há mais de um dia — o ciclo diário não a apanhou; corre a fila à mão ou verifica o CRON_SECRET.'
      : ` ${perdidas} estão aqui há mais de um dia — o ciclo diário não as apanhou; corre a fila à mão ou verifica o CRON_SECRET.`;
  }
  if (!agendador) s += ' Sem agendador configurado, a fila só anda quando carregares no botão.';
  return s;
}
