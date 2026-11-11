/* ===========================================================================
   1.84.0 · O ELENCO DO LADO DO SERVIDOR (11 nov 2026)

   A parte pura está em `src/elenco.js` (as 47 identidades e a tabela que liga os
   tipos de trabalho aos postos) e o browser lê-a também. Aqui fica o que só o
   servidor sabe: os 8 motores do Orchestrator e a verificação de que cada tipo
   de trabalho da tabela existe REALMENTE no motor de tarefas.

   O problema que isto resolve, e que se via no Control Center:

     · o escritório tem **47 lugares** na cena, cada um com nome e papel;
     · o Orchestrator corre **8 motores** com instruções, ferramentas e critérios;
     · o motor de tarefas produz **6 tipos de trabalho**;
     · e o mapa de postos falava uma **quarta** língua — `lead.pesquisar`,
       `projeto.gerar` — que o motor de produção nunca escreve.

   Resultado medido: no escritório ao vivo, NENHUMA tarefa caía no seu posto (o
   `retrato` procurava `lead.pesquisar` e a base tinha `investigar`), por isso
   todos os postos apareciam «sem tarefas registadas»; e o `/ops/agentes`
   devolvia `agentes: []` em cada departamento.
   =========================================================================== */
import { AGENTES as MOTORES } from './_ia/agentes.mjs';
import { ROTINAS } from './_tarefas.mjs';
import { ROTINA, elencoBase, rotinasDoPosto } from '../src/elenco.js';

export {
  ROTINA, POSTO_DA_ROTINA, DEPARTAMENTO_DA_ROTINA, DEPARTAMENTO_EN_DA_ROTINA,
  SALAS, SALA_DO_DEPARTAMENTO_PT, rotinasDoPosto, agentesDaSala,
} from '../src/elenco.js';

/** A inversa, para o Control Center agrupar por sala. */
export const DEPARTAMENTOS_DA_SALA = Object.fromEntries(
  Object.entries({ comando: 'emails', prospeccao: 'sales', vendas: 'ops', media: 'marketing', design: 'fin', engenharia: 'delivery' })
    .map(([dep, sala]) => [sala, dep]),
);

/** Os motores do Orchestrator, na forma curta (é a segunda camada, não os 47). */
export function motores() {
  const lugares = new Set(elencoBase().agentes.map((a) => a.id));
  return Object.entries(MOTORES).map(([id, a]) => ({
    id, numero: a.numero, nome: a.nome, papel: a.papel,
    ferramentas: a.ferramentas, tipos: a.tipos, criterios: a.criterios,
    /* 1.84.0 · o único caso em que as duas camadas partilham nome é o QA: o
       motor «qa» e o posto «qa» da cena. Não se esconde — diz-se, para quem lê
       saber que são a mesma função em dois sítios. */
    postoDaCena: lugares.has(id) ? id : null,
  }));
}

/** O elenco completo: os 47 lugares + os 8 motores + os tipos de trabalho. */
export function elenco() {
  const base = elencoBase();
  const m = motores();
  return {
    ...base,
    motores: m,
    motoresNota: `${m.length} motores com instruções, ferramentas e critérios: é o Orchestrator que os chama. Os ${base.total} lugares são o escritório onde o trabalho assenta.`,
    /* o mapa de tipos de trabalho, com o título do motor (uma só fonte) */
    tiposDeTrabalho: Object.entries(ROTINAS).map(([kind, r]) => ({
      kind, titulo: r.titulo || ROTINA[kind]?.titulo || kind,
      posto: ROTINA[kind]?.posto || null,
      departamento: ROTINA[kind]?.deptPt || null,
    })),
    /* a prova de que a tabela não inventou tipos: o que o motor não conhece fica de fora */
    tiposSemMotor: Object.keys(ROTINA).filter((k) => !ROTINAS[k]),
    tiposSemPosto: Object.keys(ROTINAS).filter((k) => !ROTINA[k]),
  };
}
