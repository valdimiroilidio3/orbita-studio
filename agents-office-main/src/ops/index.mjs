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

export function openOps({ dataDir, concurrency = 2, pollMs = 1500, autostart = true } = {}) {
  const file = process.env.ORBITA_DB || path.join(dataDir, 'orbita.db');
  const db = openDb(file);
  const queue = createQueue(db, { concurrency, pollMs });
  const { leads, messages, metrics, audit: log } = { leads: leadsModule, messages: messagesModule, metrics: metricsModule, audit };

  // trabalho que a fila sabe fazer — nomes explícitos, sem `eval` nem magia
  queue.register('leads.importar', async (p) => leads.importLeads(db, p.leads || [], p.actor || 'fila', p.source || 'import'));
  queue.register('seguimento.verificar', async () => {
    const due = leads.dueFollowUps(db);
    for (const l of due) audit(db, { actor: 'fila', action: 'seguimento.devido', entity: 'lead', entityId: l.id, detail: { nome: l.name, quando: l.next_follow_up_at } });
    return { devidos: due.length };
  });
  queue.register('mensagem.enviar', async (p, job) => {
    if (!globalThis.__orbitaDeliver) throw new Error('não há serviço de envio configurado');
    const out = await messages.sendMessage(db, p.messageId, { deliver: globalThis.__orbitaDeliver, actor: 'fila' });
    if (!out.delivered && !out.manual) throw new Error(out.reason || 'não saiu');
    return out;
  });

  if (autostart) queue.start();
  setSetting(db, 'ops.iniciado_em', getSetting(db, 'ops.iniciado_em', now()));

  return {
    db, queue, leads, messages, metrics,
    audit: (event) => audit(db, event),
    close: () => { queue.stop(); try { db.close(); } catch { /* já fechada */ } },
  };
}

export { openDb, audit, getSetting, setSetting } from './db.mjs';
