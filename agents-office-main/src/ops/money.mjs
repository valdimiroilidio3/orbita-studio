// Órbita — o saldo: custos de um lado, dinheiro do outro, margem no fim.
//
// A regra: só se soma o que está na tabela. A receita é escrita pelo dono (ninguém adivinha quanto
// é que um cliente pagou); o custo vem do consumo real das APIs. Se não houver receita, a margem
// é negativa e diz-se — não se arredonda para zero para parecer bem.
import { audit, now, uid } from './db.mjs';

export function record(db, { amountCents, campaign = '', leadId = '', note = '', at = null }, actor = 'dono') {
  const cents = Math.round(+amountCents);
  if (!Number.isFinite(cents) || cents === 0) throw Object.assign(new Error('diz o valor em cêntimos (positivo para entrada, negativo para devolução)'), { status: 400 });
  const id = uid('r_');
  db.prepare('INSERT INTO revenue (id, at, amount_cents, campaign, lead_id, note) VALUES (?,?,?,?,?,?)')
    .run(id, at || now(), cents, campaign, leadId, note);
  audit(db, { actor, action: 'receita.registada', entity: 'receita', entityId: id, detail: { cents, campaign, note } });
  return db.prepare('SELECT * FROM revenue WHERE id = ?').get(id);
}

export function remove(db, id, actor = 'dono') {
  const row = db.prepare('SELECT * FROM revenue WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('receita não encontrada'), { status: 404 });
  db.prepare('DELETE FROM revenue WHERE id = ?').run(id);
  audit(db, { actor, action: 'receita.apagada', entity: 'receita', entityId: id, detail: { cents: row.amount_cents } });
  return { ok: true };
}

export function listRevenue(db, { limit = 50 } = {}) {
  return db.prepare('SELECT * FROM revenue ORDER BY at DESC LIMIT ?').all(limit);
}

/** O saldo: por campanha, por fornecedor de custo e no total. */
export function balance(db, { days = 90 } = {}) {
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const receita = db.prepare('SELECT * FROM revenue WHERE at >= ?').all(from);
  const entradas = receita.reduce((a, r) => a + r.amount_cents, 0);

  const custos = db.prepare('SELECT provider, SUM(cost_cents) AS cents, SUM(units) AS units, COUNT(*) AS chamadas FROM usage WHERE at >= ? GROUP BY provider ORDER BY cents DESC').all(from);
  const custoTotal = custos.reduce((a, c) => a + c.cents, 0);

  const porCampanha = {};
  for (const r of receita) {
    const k = r.campaign || '(sem campanha)';
    porCampanha[k] = (porCampanha[k] || 0) + r.amount_cents;
  }
  const leads = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  const contactados = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status IN ('contactado','respondeu','reuniao','cliente')").get().n;
  const clientes = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'cliente'").get().n;

  return {
    janela: { dias: days, desde: from },
    receitaCentimos: entradas,
    custoCentimos: custoTotal,
    margemCentimos: entradas - custoTotal,
    porCampanha: Object.entries(porCampanha).sort((a, b) => b[1] - a[1]).map(([campanha, cents]) => ({ campanha, cents })),
    custosPorFornecedor: custos,
    unitarios: {
      custoPorLead: leads ? Math.round(custoTotal / leads) : null,
      custoPorContactado: contactados ? Math.round(custoTotal / contactados) : null,
      custoPorCliente: clientes ? Math.round(custoTotal / clientes) : null,
      receitaPorCliente: clientes ? Math.round(entradas / clientes) : null,
    },
    semDados: {
      receita: entradas === 0 ? 'ainda não registaste nenhuma entrada — o saldo mostra o que pagaste e mais nada' : null,
      clientes: clientes === 0 ? 'ainda não há um lead marcado como cliente' : null,
    },
    entradas: listRevenue(db, { limit: 20 }),
  };
}

/** Quanto é que já se gastou hoje — o travão diário usa isto. */
export function spentToday(db) {
  const day = new Date().toISOString().slice(0, 10);
  return db.prepare('SELECT COALESCE(SUM(cost_cents),0) AS c FROM usage WHERE substr(at,1,10) = ?').get(day).c;
}
