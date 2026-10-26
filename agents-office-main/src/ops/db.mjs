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

export const SCHEMA_VERSION = '3';

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
  // v3: a nota passa a ter uma parte de base e uma parte aprendida (as duas visíveis)
  // v3: a mensagem passa a dizer de onde veio e o que se prevê que respondam
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  for (const c of ['predictions', 'evidence_used']) {
    if (!msgCols.includes(c)) db.exec(`ALTER TABLE messages ADD COLUMN ${c} TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!msgCols.includes('generated_by')) db.exec("ALTER TABLE messages ADD COLUMN generated_by TEXT NOT NULL DEFAULT ''");
  if (!msgCols.includes('why')) db.exec("ALTER TABLE messages ADD COLUMN why TEXT NOT NULL DEFAULT ''");

  const leadCols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name);
  if (!leadCols.includes('score_base')) db.exec('ALTER TABLE leads ADD COLUMN score_base INTEGER NOT NULL DEFAULT 0');
  if (!leadCols.includes('score_learned')) db.exec('ALTER TABLE leads ADD COLUMN score_learned INTEGER NOT NULL DEFAULT 0');

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
