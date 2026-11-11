/* ===========================================================================
   1.84.0 · O ELENCO, EM DADOS PUROS (11 nov 2026)

   Este ficheiro é a parte que o browser também consegue ler: as 47 identidades
   do escritório (`src/data.js` + `src/agentes.js`, ambos puros) e a tabela que
   liga os tipos de trabalho do motor aos postos da cena.

   A outra metade — os 8 motores do Orchestrator e os títulos dos tipos de
   trabalho — vive em `api/_elenco.mjs`, porque depende de código do servidor.
   A tabela `ROTINA` é UMA só, e é aqui que está: o servidor lê-a daqui, para não
   haver duas cópias a divergir (o teste `elenco.test.mjs` compara-a com os tipos
   que o motor de tarefas realmente produz).
   =========================================================================== */
import { AGENTS as LUGARES } from './data.js';
import { IDENTITY } from './agentes.js';

/* ⚠️ Duas línguas para o mesmo sítio.
   O motor de tarefas e o escritório ao vivo falam o departamento em INGLÊS
   (`command`, `prospect`, `sales`, `design`, `engineering`, `media`); a mesa
   fala-o em PORTUGUÊS (`comando`, `prospeccao`, `vendas`, `design`,
   `engenharia`, `media`). Confundir as duas já deixou três salas com
   `agentes: []` e postos sem tarefas. A tabela abaixo é a única que sabe as
   duas, e a partir dela saem os dois mapas — não há uma terceira cópia. */
export const ROTINA = {
  escritorio: { posto: null, dept: 'command', deptPt: 'comando', titulo: 'Trabalho do escritório' },
  investigar: { posto: 'vmail', dept: 'prospect', deptPt: 'prospeccao', titulo: 'Investigar o lead' },
  mensagem: { posto: 'folo', dept: 'sales', deptPt: 'vendas', titulo: 'Escrever uma mensagem' },
  briefing: { posto: 'dasst', dept: 'design', deptPt: 'design', titulo: 'Escrever o briefing' },
  codigo: { posto: 'crep', dept: 'engineering', deptPt: 'engenharia', titulo: 'Código do projeto' },
  qa: { posto: 'qa', dept: 'engineering', deptPt: 'engenharia', titulo: 'Auditoria de qualidade' },
};

/** O tipo de trabalho → o posto que o trata (sem `escritorio`: vai para o agente pedido). */
export const POSTO_DA_ROTINA = Object.fromEntries(
  Object.entries(ROTINA).filter(([, r]) => r.posto).map(([kind, r]) => [kind, r.posto]),
);

/** O departamento da mesa (português) de cada tipo de trabalho. */
export const DEPARTAMENTO_DA_ROTINA = Object.fromEntries(
  Object.entries(ROTINA).map(([kind, r]) => [kind, r.deptPt]),
);

/** O departamento em inglês (o que o escritório ao vivo e os eventos usam). */
export const DEPARTAMENTO_EN_DA_ROTINA = Object.fromEntries(
  Object.entries(ROTINA).map(([kind, r]) => [kind, r.dept]),
);

/** O nome de cada sala da cena, em português. */
export const SALAS = {
  emails: 'Comando', sales: 'Prospecção', ops: 'Vendas',
  marketing: 'Marketing', fin: 'Design', delivery: 'Entrega',
};

/** Departamento da MESA (`api/_rotas.mjs`, em português) → sala da cena.
 *  Os dois mapas usam nomes diferentes para o mesmo sítio: `comando`≠`command`,
 *  `prospeccao`≠`prospect`, `engenharia`≠`engineering`. */
export const SALA_DO_DEPARTAMENTO_PT = {
  comando: 'emails', prospeccao: 'sales', vendas: 'ops',
  media: 'marketing', design: 'fin', engenharia: 'delivery',
};

/** Os tipos de trabalho que caem num posto (vazio = posto sem rotina própria). */
export function rotinasDoPosto(id) {
  return Object.entries(POSTO_DA_ROTINA).filter(([, posto]) => posto === id).map(([kind]) => kind);
}

/** O elenco inteiro, sem os motores (essa parte é do servidor). Puro. */
export function elencoBase() {
  const agentes = LUGARES.map((l) => {
    const id = IDENTITY[l.id] || {};
    const rotinas = rotinasDoPosto(l.id);
    return {
      id: l.id,
      nome: l.name,
      sala: l.dept,
      salaNome: SALAS[l.dept] || l.dept,
      papel: id.role || '',
      faz: id.does || '',
      rotinas,
      temRotina: rotinas.length > 0,
      consultivo: rotinas.length === 0,
      lead: !!l.lead,
    };
  });
  const porSala = {};
  for (const a of agentes) {
    const s = (porSala[a.sala] = porSala[a.sala] || { id: a.sala, nome: a.salaNome, agentes: [], comRotina: 0, consultivos: 0 });
    s.agentes.push(a.id);
    if (a.temRotina) s.comRotina += 1; else s.consultivos += 1;
  }
  const comRotina = agentes.filter((a) => a.temRotina).length;
  return {
    total: agentes.length,
    comRotina,
    consultivos: agentes.length - comRotina,
    resumo: `${agentes.length} lugares no escritório · ${comRotina} com trabalho próprio · ${agentes.length - comRotina} consultivos (não têm tarefa atribuída)`,
    porSala: Object.values(porSala),
    agentes,
  };
}

/** O elenco de uma sala, para o `/ops/agentes` preencher `agentes` (era `[]`). */
export function agentesDaSala(sala, todos = elencoBase()) {
  return todos.agentes.filter((a) => a.sala === sala);
}
