// Órbita — a camada de operação, num sítio só.
//
// Abre a base de dados, liga a fila aos trabalhos que o escritório sabe fazer, e devolve tudo o que
// o servidor precisa. Sem estado escondido: `db`, `queue` e as funções são o que se vê.
import path from 'node:path';
import { openDb, audit, getSetting, setSetting, now } from './db.mjs';
import { createQueue } from './queue.mjs';
import * as leadsModule from './leads.mjs';
import * as messagesModule from './messages.mjs';
import * as metricsModule from './metrics.mjs';
import * as outboxModule from './outbox.mjs';
import * as eventsModule from './events.mjs';
import * as todayModule from './today.mjs';
import * as researchModule from './research.mjs';
import * as personalizeModule from './personalize.mjs';
import * as autonomyModule from './autonomy.mjs';
import * as evalsModule from './evals.mjs';
import * as moneyModule from './money.mjs';
import * as tenantsModule from './tenants.mjs';

export function openOps({ dataDir, dbFile = null, concurrency = 2, pollMs = 1500, autostart = true } = {}) {
  const file = dbFile || process.env.ORBITA_DB || path.join(dataDir, 'orbita.db');
  const db = openDb(file);
  const queue = createQueue(db, { concurrency, pollMs });
  const leads = leadsModule, messages = messagesModule, metrics = metricsModule;
  const outbox = outboxModule, events = eventsModule, today = todayModule;
  const research = researchModule, personalize = personalizeModule;
  const autonomy = autonomyModule, evals = evalsModule, money = moneyModule, tenants = tenantsModule;

  // trabalho que a fila sabe fazer — nomes explícitos, sem `eval` nem magia
  queue.register('leads.importar', async (p) => leads.importLeads(db, p.leads || [], p.actor || 'fila', p.source || 'import'));
  queue.register('seguimento.verificar', async () => {
    const due = leads.dueFollowUps(db);
    for (const l of due) audit(db, { actor: 'fila', action: 'seguimento.devido', entity: 'lead', entityId: l.id, detail: { nome: l.name, quando: l.next_follow_up_at } });
    return { devidos: due.length };
  });
  // Pesquisar o site de um lead é trabalho de rede: vai para a fila, com tentativas, para não
  // prender um pedido HTTP do dono enquanto se lê meia dúzia de páginas.
  queue.register('lead.pesquisar', async (p) => {
    const lead = leads.getLead(db, p.leadId);
    if (!lead) throw new Error('lead não encontrado');
    const r = await research.researchSite(db, lead, { actor: 'fila' });
    if (r.status === 'falhou') throw new Error(r.reason); // o backoff trata do resto
    return { status: r.status, evidencia: r.evidence.length };
  });
  // Correr as avaliações é trabalho de fila: não prende o ecrã e o resultado fica guardado.
  queue.register('evals.correr', async (p) => evalsModule.runAll(db, { ask: p.ask ? globalThis.__orbitaAsk : null }));
  queue.register('mensagem.enviar', async (p, job) => {
    if (!globalThis.__orbitaDeliver) throw new Error('não há serviço de envio configurado');
    const out = await messages.sendMessage(db, p.messageId, { deliver: globalThis.__orbitaDeliver, actor: 'fila' });
    if (!out.delivered && !out.manual) throw new Error(out.reason || 'não saiu');
    return out;
  });

  if (autostart) queue.start();

  // ---- o outbox drena sozinho ----
  // O que ficou escrito para sair tenta sair aqui, a cada 3 s, com o mesmo `deliver` do servidor.
  // Se o processo morrer, o aluguer expira e o item volta — ninguém fica com trabalho preso.
  let outboxTimer = null;
  const drainOutbox = async () => {
    if (!globalThis.__orbitaDeliver) return [];
    try { return await outboxModule.drain(db, { deliver: globalThis.__orbitaDeliver, limit: 5 }); }
    catch (e) { console.warn('outbox:', e.message); return []; }
  };
  if (autostart) {
    outboxTimer = setInterval(() => { drainOutbox(); }, 3000);
    if (outboxTimer.unref) outboxTimer.unref();
  }
  setSetting(db, 'ops.iniciado_em', getSetting(db, 'ops.iniciado_em', now()));

  return {
    db, queue, leads, messages, metrics, outbox, events, today, research, personalize, autonomy, evals, money, tenants,
    drainOutbox,
    audit: (event) => audit(db, event),
    close: () => {
      queue.stop();
      if (outboxTimer) clearInterval(outboxTimer);
      try { db.close(); } catch { /* já fechada */ }
    },
  };
}

export { openDb, audit, getSetting, setSetting } from './db.mjs';
// O registo de clientes é do processo, não de uma base: vive aqui e não dentro de cada `openOps`.
export * as tenants from './tenants.mjs';
