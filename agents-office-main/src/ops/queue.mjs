// Órbita — a fila de trabalho.
//
// Antes disto, um erro a meio de uma tarefa perdia-a; e trinta pedidos seguidos às APIs da Google
// apanhavam o limite e derrubavam o resto. A fila resolve as duas coisas: o trabalho espera numa
// tabela (sobrevive a reinícios), tenta outra vez com espera crescente, e nunca corre mais do que
// N ao mesmo tempo.
import { audit, now, uid } from './db.mjs';

const backoffMs = attempts => Math.min(60 * 60000, 15000 * Math.pow(2, Math.max(0, attempts - 1)));

export function createQueue(db, { concurrency = 2, pollMs = 1500, logger = console } = {}) {
  const handlers = new Map();
  let running = 0;
  let timer = null;
  let stopped = true;

  const register = (kind, handler) => { handlers.set(kind, handler); return api; };

  function enqueue(kind, payload = {}, { runAt = null, maxAttempts = 5 } = {}) {
    if (!handlers.has(kind)) throw Object.assign(new Error(`tipo de trabalho desconhecido: ${kind}`), { status: 400 });
    const id = uid('j_');
    db.prepare('INSERT INTO jobs (id, kind, payload, status, attempts, max_attempts, run_at, created_at) VALUES (?,?,?,?,0,?,?,?)')
      .run(id, kind, JSON.stringify(payload), 'fila', maxAttempts, runAt || now(), now());
    audit(db, { actor: 'sistema', action: 'fila.criada', entity: 'job', entityId: id, detail: { kind } });
    return get(id);
  }

  const get = id => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? { ...row, payload: JSON.parse(row.payload || '{}') } : null;
  };

  const due = (limit) => db.prepare("SELECT * FROM jobs WHERE status = 'fila' AND run_at <= ? ORDER BY run_at LIMIT ?")
    .all(now(), limit).map(r => ({ ...r, payload: JSON.parse(r.payload || '{}') }));

  async function runOne(job) {
    db.prepare("UPDATE jobs SET status='a_correr', started_at=?, attempts=attempts+1 WHERE id=?").run(now(), job.id);
    running++;
    try {
      const handler = handlers.get(job.kind);
      if (!handler) throw new Error(`sem tratador para «${job.kind}»`);
      await handler(job.payload, job);
      db.prepare("UPDATE jobs SET status='feito', finished_at=?, error='' WHERE id=?").run(now(), job.id);
      return { id: job.id, ok: true };
    } catch (e) {
      const attempts = job.attempts + 1;
      if (attempts >= job.max_attempts) {
        db.prepare("UPDATE jobs SET status='falhou', finished_at=?, error=? WHERE id=?").run(now(), String(e.message).slice(0, 500), job.id);
        audit(db, { actor: 'sistema', action: 'fila.desistiu', entity: 'job', entityId: job.id, detail: { attempts, error: e.message } });
      } else {
        const at = new Date(Date.now() + backoffMs(attempts)).toISOString();
        db.prepare("UPDATE jobs SET status='fila', run_at=?, error=? WHERE id=?").run(at, String(e.message).slice(0, 500), job.id);
        audit(db, { actor: 'sistema', action: 'fila.retentativa', entity: 'job', entityId: job.id, detail: { attempts, em: at, error: e.message } });
      }
      return { id: job.id, ok: false, error: e.message };
    } finally { running--; }
  }

  /** Corre o que está devido, até `concurrency` de cada vez. Devolve o que aconteceu. */
  async function tick({ max = 10 } = {}) {
    const slots = Math.max(0, concurrency - running);
    if (!slots) return [];
    const jobs = due(Math.min(max, slots));
    return Promise.all(jobs.map(runOne));
  }

  function start() {
    if (!stopped) return api;
    stopped = false;
    timer = setInterval(() => { tick().catch(e => logger.warn?.('fila:', e.message)); }, pollMs);
    if (timer.unref) timer.unref();
    tick().catch(() => {});
    return api;
  }

  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; return api; }

  function stats() {
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
    const by = Object.fromEntries(rows.map(r => [r.status, r.n]));
    const next = db.prepare("SELECT run_at FROM jobs WHERE status='fila' ORDER BY run_at LIMIT 1").get();
    return { ...by, em_curso: running, proximo: next?.run_at || null, concorrencia: concurrency };
  }

  function list({ limit = 50, status = null } = {}) {
    const rows = status
      ? db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
      : db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
  }

  const api = { register, enqueue, tick, start, stop, stats, list, get, concurrency, pollMs };
  return api;
}
