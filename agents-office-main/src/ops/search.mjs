// Órbita — procurar e ver o que se passou.
//
// Duas coisas pequenas que fazem um produto parecer sério:
//   · `search`: uma pergunta, resultados de leads, projetos e tarefas — com o caminho para abrir;
//   · `activity`: o que correu, o que falhou e quem o fez, lido de `jobs` e `events`.
//
// Nada aqui inventa: cada linha sai de uma tabela e traz o identificador do que encontrou.
import { KINDS, deptOf } from './tasks.mjs';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** Pesquisa global. Devolve grupos com resultados e o caminho (`route`) para abrir cada um. */
export function search(db, query, { limit = 6 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { query: q, grupos: [], total: 0, nota: 'escreve pelo menos duas letras' };
  // O `LIKE` do SQLite não vê acentos («clinica» não encontra «Clínica»), por isso a decisão é
  // tomada aqui: traz-se um conjunto de candidatos e filtra-se pela forma normalizada. Nesta
  // escala (milhares de linhas, não milhões) é rápido e é correto.
  const hit = s => norm(s).includes(norm(q));
  const leads = db.prepare(`SELECT id, name, city, category, phone, email, status, score FROM leads
    ORDER BY updated_at DESC LIMIT 500`).all()
    .filter(l => hit(l.name) || hit(l.city) || hit(l.category) || hit(l.phone) || hit(l.email))
    .slice(0, limit)
    .map(r => ({ ...r, route: '#/lead/' + r.id }));
  const projetos = db.prepare(`SELECT id, name, client, city, kind, status, brief FROM projects
    ORDER BY updated_at DESC LIMIT 300`).all()
    .filter(p => hit(p.name) || hit(p.client) || hit(p.brief))
    .slice(0, limit)
    .map(({ brief, ...r }) => ({ ...r, route: '#/projeto/' + r.id }));
  const tarefas = db.prepare(`SELECT id, kind, title, dept, state, entity, entity_id, error FROM tasks
    ORDER BY created_at DESC LIMIT 300`).all()
    .filter(t => hit(t.title) || hit(t.kind) || hit(t.error))
    .slice(0, limit)
    .map(r => ({ ...r, route: '#/tarefas', deptName: deptOf(r.dept)?.name || r.dept, kindLabel: KINDS[r.kind]?.label || r.kind }));

  const groups = [
    { grupo: 'leads', label: 'Leads', itens: leads },
    { grupo: 'projetos', label: 'Projetos', itens: projetos },
    { grupo: 'tarefas', label: 'Tarefas', itens: tarefas },
  ].filter(g => g.itens.length);
  return { query: q, grupos: groups, total: groups.reduce((a, g) => a + g.itens.length, 0), nota: null };
}

/** O painel de atividade: o que correu e o que falhou, sem dados pessoais desnecessários. */
export function activity(db, { limit = 25 } = {}) {
  const jobs = db.prepare(`SELECT id, kind, status, attempts, started_at, finished_at, error,
      CAST((julianday(finished_at) - julianday(started_at)) * 86400000 AS INTEGER) AS ms
    FROM jobs ORDER BY COALESCE(finished_at, started_at, created_at) DESC LIMIT ?`).all(limit)
    .map(j => ({ ...j, origem: 'fila' }));
  const eventos = db.prepare("SELECT at, actor, action, entity, entity_id, detail FROM events ORDER BY id DESC LIMIT ?").all(limit)
    .map(e => ({ ...e, origem: 'registo' }));
  const tarefas = db.prepare(`SELECT id, kind, title, dept, state, attempts, max_attempts, error, started_at, finished_at,
      CAST((julianday(finished_at) - julianday(started_at)) * 86400000 AS INTEGER) AS ms
    FROM tasks ORDER BY created_at DESC LIMIT ?`).all(limit)
    .map(t => ({ ...t, origem: 'tarefa', deptName: deptOf(t.dept)?.name || t.dept }));
  const falhas = jobs.filter(j => j.status === 'falhou');
  const falhasTarefas = tarefas.filter(t => t.state === 'failed');
  const contas = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
  return {
    jobs, eventos, tarefas,
    resumo: {
      porEstado: Object.fromEntries(contas.map(r => [r.status, r.n])),
      tarefasPorEstado: Object.fromEntries(db.prepare('SELECT state, COUNT(*) AS n FROM tasks GROUP BY state').all().map(r => [r.state, r.n])),
      falhasRecentes: falhas.length + falhasTarefas.length,
      ultimaFalha: falhas[0] || falhasTarefas[0] || null,
    },
    geradoEm: new Date().toISOString(),
  };
}
