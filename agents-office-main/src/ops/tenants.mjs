// Órbita — cada negócio com o seu espaço (o modo agência).
//
// A decisão que evita o pior erro possível numa agência: **cada cliente tem o seu ficheiro de
// base de dados**. Não é uma coluna `cliente_id` em cada tabela — é isolamento a sério: apagar o
// espaço de um cliente não toca nos outros, e um erro numa consulta não pode misturar leads de
// dois negócios. O preço: o resumo da agência tem de abrir cada ficheiro, e isso faz-se à vez.
//
// O registo vive em `data/clientes.db` (SQLite, o mesmo motor). O espaço activo fica guardado
// nas definições — um dono, um ecrã, um negócio de cada vez.
import fs from 'node:fs';
import path from 'node:path';
import { audit, getSetting, now, openDb, setSetting, uid } from './db.mjs';

const REG_SCHEMA = `
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  nicho TEXT NOT NULL DEFAULT '',
  cidade TEXT NOT NULL DEFAULT '',
  pasta TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  arquivado INTEGER NOT NULL DEFAULT 0
);
`;

export function openRegistry(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'clientes.db'));
  db.exec(REG_SCHEMA);
  return db;
}

const slug = s => String(s || 'cliente').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cliente';

export function list(reg) {
  return reg.prepare('SELECT * FROM clientes WHERE arquivado = 0 ORDER BY nome COLLATE NOCASE').all()
    .map(c => ({ ...c, dbFile: path.join(c.pasta, 'orbita.db'), activo: false }));
}

export function active(reg) {
  const id = getSetting(reg, 'cliente.activo', null);
  if (!id) return null;
  const row = reg.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  return row ? { ...row, dbFile: path.join(row.pasta, 'orbita.db') } : null;
}

export function setActive(reg, id) {
  const row = reg.prepare('SELECT * FROM clientes WHERE id = ? AND arquivado = 0').get(id);
  if (!row) throw Object.assign(new Error('cliente não encontrado'), { status: 404 });
  setSetting(reg, 'cliente.activo', id);
  return { ...row, dbFile: path.join(row.pasta, 'orbita.db') };
}

/**
 * Cria o espaço de um cliente: pasta própria, base de dados própria, oferta escrita.
 * Devolve também os próximos passos — o onboarding tem de acabar em algo concreto.
 */
export function create(reg, { nome, nicho = '', cidade = '', oferta = null, dadosDir }, actor = 'dono') {
  const name = String(nome || '').trim();
  if (!name) throw Object.assign(new Error('o cliente precisa de um nome'), { status: 400 });
  const jaExiste = reg.prepare('SELECT * FROM clientes WHERE nome = ? AND arquivado = 0').get(name);
  if (jaExiste) throw Object.assign(new Error(`já existe um espaço chamado «${name}»`), { status: 409 });
  const id = uid('c_');
  const pasta = path.join(dadosDir, 'clientes', `${slug(name)}-${id.slice(-4)}`);
  fs.mkdirSync(pasta, { recursive: true });
  const db = openDb(path.join(pasta, 'orbita.db'));
  db.close();
  reg.prepare('INSERT INTO clientes (id, nome, nicho, cidade, pasta, criado_em) VALUES (?,?,?,?,?,?)')
    .run(id, name, nicho, cidade, pasta, now());
  audit(reg, { actor, action: 'cliente.criado', entity: 'cliente', entityId: id, detail: { nome: name, nicho, cidade } });
  if (oferta) {
    // a oferta do cliente vive na base de dados dele — não numa folha partilhada
    const cdb = openDb(path.join(pasta, 'orbita.db'));
    try {
      cdb.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
        .run('setting:oferta', JSON.stringify(oferta));
    } finally { cdb.close(); }
  }
  return { ...reg.prepare('SELECT * FROM clientes WHERE id = ?').get(id), dbFile: path.join(pasta, 'orbita.db'), proximosPassos: nextSteps(nicho, cidade) };
}

/** O onboarding em três passos, ditos por palavras — e com o que falta dito sem rodeios. */
export function nextSteps(nicho, cidade) {
  const passos = [];
  if (nicho && cidade) {
    passos.push({ passo: 1, acao: 'procurar', texto: `Procurar ${nicho} em ${cidade}`, nota: 'precisa de GOOGLE_MAPS_API_KEY; sem chave, acrescenta leads à mão' });
  } else {
    passos.push({ passo: 1, acao: 'definir-nicho', texto: 'Dizer o nicho e a cidade deste cliente' });
  }
  passos.push({ passo: 2, acao: 'pesquisar', texto: 'Ler o site dos melhores leads e escrever com factos', nota: 'na gaveta OPERAÇÃO, botão PESQUISAR' });
  passos.push({ passo: 3, acao: 'aprovar', texto: 'Aprovar as primeiras mensagens em Hoje', nota: 'nada sai sem o teu OK' });
  return passos;
}

/** Soma de um cliente: o que gastou, o que entrou. Abre a base dele, lê e fecha. */
export function snapshot(reg, cliente) {
  const file = path.join(cliente.pasta, 'orbita.db');
  if (!fs.existsSync(file)) return { id: cliente.id, nome: cliente.nome, erro: 'base de dados em falta' };
  const db = openDb(file);
  try {
    const leads = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
    const clientes = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'cliente'").get().n;
    const enviadas = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE status = 'enviada'").get().n;
    const custos = db.prepare('SELECT COALESCE(SUM(cost_cents),0) AS c FROM usage').get().c;
    const receita = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS r FROM revenue').get().r;
    return {
      id: cliente.id, nome: cliente.nome, nicho: cliente.nicho, cidade: cliente.cidade,
      leads, clientes, enviadas, custosCentimos: custos, receitaCentimos: receita, margemCentimos: receita - custos,
    };
  } finally { db.close(); }
}

/** O painel da agência: todos os clientes, com o total em baixo. */
export function rollup(reg) {
  const todos = list(reg);
  const linhas = todos.map(c => snapshot(reg, c));
  const soma = k => linhas.reduce((a, l) => a + (l[k] || 0), 0);
  return {
    clientes: linhas,
    total: {
      clientes: linhas.length, leads: soma('leads'), clientesGanhos: soma('clientes'),
      enviadas: soma('enviadas'), custosCentimos: soma('custosCentimos'),
      receitaCentimos: soma('receitaCentimos'), margemCentimos: soma('margemCentimos'),
    },
  };
}
