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

/* ---------- o funil como processo: onde estão, quanto convertem, o que parou ---------- */

/** A ordem real do processo comercial. `respondeu` e `reuniao` contam na fase em que cabem. */
export const PIPELINE = [
  { key: 'novo', label: 'Novo' },
  { key: 'qualificado', label: 'Qualificado' },
  { key: 'contactado', label: 'Contactado' },
  { key: 'em_negociacao', label: 'Em negociação' },
  { key: 'proposta', label: 'Proposta enviada' },
  { key: 'cliente', label: 'Ganho' },
];
const RANK = { novo: 0, qualificado: 1, contactado: 2, respondeu: 2, reuniao: 3, em_negociacao: 3, proposta: 4, cliente: 5 };

/**
 * Quantos leads chegaram a cada fase — não só onde estão agora. A fonte é a base: o estado atual
 * mais o histórico de mudanças em `events` (que já era guardado antes de isto existir).
 */
export function pipeline(db) {
  const reached = PIPELINE.map(() => new Set());
  const reach = (leadId, status) => {
    const r = RANK[status];
    if (r === undefined) return;
    for (let i = 0; i <= r; i++) reached[i].add(leadId);
  };
  for (const row of db.prepare('SELECT id, status FROM leads').all()) reach(row.id, row.status);
  for (const row of db.prepare("SELECT entity_id, detail FROM events WHERE action = 'lead.estado'").all()) {
    try { reach(row.entity_id, JSON.parse(row.detail).para); } catch { /* detalhe antigo */ }
  }
  const fases = PIPELINE.map((s, i) => ({
    ...s,
    leads: reached[i].size,
    conversao: i === 0 ? null : (reached[i - 1].size ? Math.round((reached[i].size / reached[i - 1].size) * 1000) / 10 : null),
  }));

  const perdidos = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'perdido'").get().n;
  const porOrigem = db.prepare(`SELECT COALESCE(NULLIF(source, ''), 'manual') AS origem, COUNT(*) AS total,
      SUM(CASE WHEN status = 'cliente' THEN 1 ELSE 0 END) AS ganhos,
      SUM(CASE WHEN status = 'perdido' THEN 1 ELSE 0 END) AS perdidos,
      MIN(created_at) AS primeira, MAX(created_at) AS ultima
    FROM leads GROUP BY origem ORDER BY total DESC`).all()
    .map(r => ({ ...r, taxa: r.total ? Math.round((r.ganhos / r.total) * 1000) / 10 : null }));

  const porMes = db.prepare(`SELECT substr(created_at, 1, 7) AS mes, COUNT(*) AS total,
      SUM(CASE WHEN status = 'cliente' THEN 1 ELSE 0 END) AS ganhos
    FROM leads GROUP BY mes ORDER BY mes DESC LIMIT 12`).all();

  // oportunidade parada: aberta, com contacto dado, sem nada escrito há N dias
  const dias = 14;
  const corte = new Date(Date.now() - dias * 86400000).toISOString();
  const paradas = db.prepare(`SELECT id, name, status, updated_at, next_follow_up_at,
      CAST((julianday(?) - julianday(updated_at)) AS INTEGER) AS dias_parado
    FROM leads WHERE status IN ('qualificado','contactado','respondeu','em_negociacao','proposta') AND updated_at < ?
    ORDER BY updated_at ASC LIMIT 20`).all(new Date().toISOString(), corte);

  const ganhos = fases[5].leads;
  return {
    fases, perdidos, porOrigem, porMes, paradas: { dias, lista: paradas },
    totalLeads: db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,
    conversaoTotal: fases[0].leads ? Math.round((ganhos / fases[0].leads) * 1000) / 10 : null,
    geradoEm: new Date().toISOString(),
  };
}
