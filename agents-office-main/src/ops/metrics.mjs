// Órbita — os números que interessam ao dono, e nada mais.
//
// Nada aqui é estimado «a olho»: cada valor sai de uma tabela. Se uma métrica não tem dados
// suficientes para ser dita, vem com `null` e a razão — em vez de um zero que parece bom.
import { getSetting } from './db.mjs';
import { usageSummary } from './messages.mjs';

export function summary(db) {
  const count = sql => db.prepare(sql).get().n;
  const leads = count('SELECT COUNT(*) AS n FROM leads');
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all().map(r => [r.status, r.n]));
  const contactados = (byStatus.contactado || 0) + (byStatus.respondeu || 0) + (byStatus.reuniao || 0) + (byStatus.cliente || 0);
  const responderam = (byStatus.respondeu || 0) + (byStatus.reuniao || 0) + (byStatus.cliente || 0);
  const clientes = byStatus.cliente || 0;
  const mensagens = {
    rascunhos: count("SELECT COUNT(*) AS n FROM messages WHERE status='rascunho'"),
    aprovadas: count("SELECT COUNT(*) AS n FROM messages WHERE status='aprovada'"),
    enviadas: count("SELECT COUNT(*) AS n FROM messages WHERE status='enviada'"),
    bloqueadas: count("SELECT COUNT(*) AS n FROM messages WHERE status='bloqueada'"),
    falhadas: count("SELECT COUNT(*) AS n FROM messages WHERE status='falhou'"),
  };
  const uso = usageSummary(db, 30);
  const receita = getSetting(db, 'receita_centimos', 0);
  const custoApiCents = uso.totalCents;
  const taxaResposta = contactados ? Math.round((responderam / contactados) * 1000) / 10 : null;
  const custoPorLead = leads ? Math.round(custoApiCents / leads) : null;
  const custoPorCliente = clientes ? Math.round(custoApiCents / clientes) : null;
  return {
    leads: { total: leads, porEstado: byStatus, comPontuacao: count('SELECT COUNT(*) AS n FROM leads WHERE score >= 60') },
    funil: { contactados, responderam, reunioes: byStatus.reuniao || 0, clientes },
    conversao: { taxaResposta, taxaCliente: contactados ? Math.round((clientes / contactados) * 1000) / 10 : null },
    mensagens,
    custos: { apiCentimos: custoApiCents, porLeadCentimos: custoPorLead, porClienteCentimos: custoPorCliente, receitaCentimos: receita, margemCentimos: receita - custoApiCents },
    uso30d: uso.providers,
    semDados: {
      taxaResposta: taxaResposta === null ? 'ainda não há leads contactados' : null,
      custoPorCliente: custoPorCliente === null && !clientes ? 'ainda não há clientes' : null,
    },
    geradoEm: new Date().toISOString(),
  };
}

/** O mesmo, em texto, para o dono ler numa linha. */
export function summaryLine(db) {
  const s = summary(db);
  const bits = [`${s.leads.total} leads`, `${s.funil.contactados} contactados`, `${s.funil.clientes} clientes`];
  if (s.conversao.taxaResposta !== null) bits.push(`${s.conversao.taxaResposta}% responderam`);
  bits.push(`${s.custos.apiCentimos} cêntimos gastos`);
  return bits.join(' · ');
}
