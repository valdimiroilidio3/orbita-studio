// Órbita — a base de dados de operação.
//
// Até aqui o escritório vivia de ficheiros JSON soltos: servem para uma demonstração, não para
// trabalho a sério. Isto é SQLite a sério — `node:sqlite`, sem dependências, sem servidor, um
// ficheiro que se copia e se guarda. Não há estado em memória que se perca num reinício.
//
// Regras desta camada:
//   · nada de dados inventados: se não está na tabela, não existe;
//   · tudo o que muda tem `updated_at` e deixa rasto em `events` (quem fez, o quê, quando);
//   · o esquema é versionado em `meta` — um dia migra para Postgres/Supabase sem reescrever a lógica.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node sem SQLite */ }

export const SCHEMA_VERSION = '6';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT NOT NULL DEFAULT '',
  rating REAL, reviews INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  score_reasons TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'novo',
  consent TEXT NOT NULL DEFAULT 'desconhecido',
  notes TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  contacted_at TEXT,
  responded_at TEXT,
  next_follow_up_at TEXT
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS leads_score ON leads(score DESC);
CREATE INDEX IF NOT EXISTS leads_follow ON leads(next_follow_up_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT,
  provider_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS messages_lead ON messages(lead_id);
CREATE INDEX IF NOT EXISTS messages_status ON messages(status);

-- O registo é uma cadeia: cada linha leva o hash da anterior. Se alguém apagar ou reescrever
-- uma linha, a cadeia parte-se e o npm run check (ou a gaveta) diz em que linha.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'sistema',
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);
CREATE INDEX IF NOT EXISTS events_entity ON events(entity, entity_id);

-- Outbox: o que tem de sair fica escrito ANTES de sair. Um envio nunca acontece duas vezes,
-- mesmo que o servidor caia a meio — a chave de idempotência é única e o aluguer (lease)
-- expira, para o trabalho preso voltar à fila em vez de ficar esquecido.
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  to_addr TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'fila',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  provider_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, next_attempt_at);

-- O que se encontrou ao olhar para o negócio antes de lhe escrever. Uma linha por lead e por
-- tipo; data guarda os factos e evidence as frases verdadeiras de onde saíram. Se a leitura
-- falhar, fica o motivo — nunca um dossiê inventado.
CREATE TABLE IF NOT EXISTS research (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'site',
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'por_fazer',
  reason TEXT NOT NULL DEFAULT '',
  fetched_at TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  evidence TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS research_lead_kind ON research(lead_id, kind);

-- O ciclo que fecha: o que o mundo respondeu. «respondeu», «interessado», «reuniao», «ignorou»,
-- «recusou», «pediu_parar». É daqui que saem os pesos da pontuação e as regras dos rascunhos.
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  attributes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS signals_lead ON signals(lead_id);
CREATE INDEX IF NOT EXISTS signals_kind ON signals(kind);

-- Autonomia graduada: por tipo de mensagem, quem decide é o dono — e a subida de nível tem de
-- ser ganha com casos. baseline guarda os números no momento da decisão, para não se dizer
-- depois «sempre foi assim».
CREATE TABLE IF NOT EXISTS autonomy (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pedir_sempre',
  decided_at TEXT,
  decided_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  baseline TEXT NOT NULL DEFAULT '{}'
);

-- O histórico das avaliações automáticas: cada corrida fica guardada, para se ver se a qualidade
-- desceu depois de uma mudança de prompt.
CREATE TABLE IF NOT EXISTS evals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  suite TEXT NOT NULL DEFAULT 'rascunho',
  prompt_version TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT '[]'
);

-- Dinheiro que entrou, ligado à campanha e (quando se sabe) ao lead. É isto que faz o saldo ser
-- real: custos de um lado, receita do outro, margem no fim.
CREATE TABLE IF NOT EXISTS revenue (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS revenue_at ON revenue(at DESC);

-- Projetos: o que a Órbita produz. Um projeto nasce de uma oportunidade (lead), tem briefing,
-- páginas, critérios de aceitação, e um estado que só avança com provas: gerado → QA → aprovado
-- → entregue. O índice único em lead_id impede dois projetos para o mesmo negócio.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  niche TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'landing',
  stack TEXT NOT NULL DEFAULT 'html',
  brief TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '[]',
  pages TEXT NOT NULL DEFAULT '[]',
  features TEXT NOT NULL DEFAULT '[]',
  acceptance TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'rascunho',
  dir TEXT NOT NULL,
  preview_url TEXT NOT NULL DEFAULT '',
  production_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_lead ON projects(lead_id) WHERE lead_id != '';
CREATE INDEX IF NOT EXISTS projects_status ON projects(status);

-- Cada auditoria de qualidade fica guardada com o manifesto dos ficheiros que foram vistos.
-- É por comparação com este manifesto que a entrega é bloqueada se algo mudar depois do QA.
CREATE TABLE IF NOT EXISTS qa_runs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  critical INTEGER NOT NULL DEFAULT 0,
  important INTEGER NOT NULL DEFAULT 0,
  minor INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  manifest TEXT NOT NULL DEFAULT '{}',
  report TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS qa_project ON qa_runs(project_id, at DESC);

-- Entregas: pedir não é ter. O estado guarda o que se sabe (pedido, em curso, falhado,
-- concluído) e o URL só aparece quando existe mesmo.
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS deliveries_project ON deliveries(project_id, at DESC);

-- Tarefas dos departamentos: trabalho que se pode verificar. Uma máquina de estados guardada
-- (queued → running → succeeded | failed | awaiting_approval), com tentativas limitadas, prazo,
-- resultado e evidência. UMA tarefa aberta por chave e departamento — o índice parcial impede
-- execuções duplicadas mesmo que dois pedidos cheguem ao mesmo tempo.
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  dept TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'queued',
  result TEXT NOT NULL DEFAULT '{}',
  evidence TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 300000,
  needs_approval INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  dedupe TEXT NOT NULL DEFAULT '',
  parent_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_dept ON tasks(dept, state);
CREATE INDEX IF NOT EXISTS tasks_entity ON tasks(entity_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_open ON tasks(dedupe) WHERE state IN ('queued','running','awaiting_approval');

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'fila',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS consents_addr ON consents(address);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  cost_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_at ON usage(at DESC);
`;

export const now = () => new Date().toISOString();
export const uid = (prefix = '') => prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Abre (ou cria) a base de dados. `file` pode ser ':memory:' nos testes. */
export function openDb(file) {
  if (!DatabaseSync) {
    throw new Error('Esta versão do Node não traz node:sqlite. Usa Node 22.4+ (node -v) — ou define ORBITA_DB="json" para o modo antigo.');
  }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('schema');
  if (!row) db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema', SCHEMA_VERSION);
  else if (row.v !== SCHEMA_VERSION) db.prepare('UPDATE meta SET v = ? WHERE k = ?').run(SCHEMA_VERSION, 'schema');
  return db;
}

/** Migrações: cada versão nova só acrescenta — nada de deitar dados fora. */
function migrate(db) {
  // v3: a mensagem passa a dizer de onde veio e o que se prevê que respondam
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  // v4: o tipo de mensagem (é por ele que a autonomia sobe) e o modo ensaio
  if (!msgCols.includes('scope')) db.exec("ALTER TABLE messages ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
  for (const c of ['predictions', 'evidence_used']) {
    if (!msgCols.includes(c)) db.exec(`ALTER TABLE messages ADD COLUMN ${c} TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!msgCols.includes('generated_by')) db.exec("ALTER TABLE messages ADD COLUMN generated_by TEXT NOT NULL DEFAULT ''");
  if (!msgCols.includes('why')) db.exec("ALTER TABLE messages ADD COLUMN why TEXT NOT NULL DEFAULT ''");

  const leadCols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name);
  if (!leadCols.includes('score_base')) db.exec('ALTER TABLE leads ADD COLUMN score_base INTEGER NOT NULL DEFAULT 0');
  if (!leadCols.includes('score_learned')) db.exec('ALTER TABLE leads ADD COLUMN score_learned INTEGER NOT NULL DEFAULT 0');

  // v5: a tarefa guarda o que produziu (evidência), não só que correu
  const jobCols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  if (!jobCols.includes('result')) db.exec("ALTER TABLE jobs ADD COLUMN result TEXT NOT NULL DEFAULT ''");

  const cols = db.prepare('PRAGMA table_info(events)').all().map(c => c.name);
  for (const c of ['prev_hash', 'hash']) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE events ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`);
  }
  // preenche a cadeia das linhas antigas (v1 não tinha hashes), pela ordem em que aconteceram
  const pending = db.prepare("SELECT * FROM events WHERE hash = '' ORDER BY id").all();
  if (pending.length) {
    let prev = db.prepare("SELECT hash FROM events WHERE hash != '' ORDER BY id DESC LIMIT 1").get()?.hash || '';
    for (const row of pending) {
      const hash = chainHash(prev, row);
      db.prepare('UPDATE events SET prev_hash = ?, hash = ? WHERE id = ?').run(prev, hash, row.id);
      prev = hash;
    }
  }
}

/** O hash de uma linha: os campos + o hash da anterior. Muda uma vírgula, muda a cadeia toda. */
export function chainHash(prev, { at, actor = 'sistema', action, entity = '', entity_id = '', entityId = '', detail = '' }) {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return createHash('sha256').update([prev, at, actor, action, entity, entity_id || entityId, d].join('|')).digest('hex');
}

/** Um evento de auditoria. Tudo o que mexe em dados passa por aqui — e fica encadeado. */
export function audit(db, { actor = 'sistema', action, entity = '', entityId = '', detail = '', at = null }) {
  const at2 = at || now();
  const prev = db.prepare("SELECT hash FROM events ORDER BY id DESC LIMIT 1").get()?.hash || '';
  const row = { at: at2, actor, action, entity, entity_id: String(entityId || ''), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
  db.prepare('INSERT INTO events (at, actor, action, entity, entity_id, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.at, row.actor, row.action, row.entity, row.entity_id, row.detail, prev, chainHash(prev, row));
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('setting:' + key);
  if (!row) return fallback;
  try { return JSON.parse(row.v); } catch { return row.v; }
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .run('setting:' + key, JSON.stringify(value));
  return value;
}
