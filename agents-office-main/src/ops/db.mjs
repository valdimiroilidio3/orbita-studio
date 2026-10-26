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

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node sem SQLite */ }

export const SCHEMA_VERSION = '1';

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

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'sistema',
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);

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
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('schema');
  if (!row) db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema', SCHEMA_VERSION);
  return db;
}

/** Um evento de auditoria. Tudo o que mexe em dados passa por aqui. */
export function audit(db, { actor = 'sistema', action, entity = '', entityId = '', detail = '' }) {
  db.prepare('INSERT INTO events (at, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now(), actor, action, entity, String(entityId || ''), typeof detail === 'string' ? detail : JSON.stringify(detail));
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
