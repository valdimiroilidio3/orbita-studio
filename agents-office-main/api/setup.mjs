/* ===========================================================================
   BOOTSTRAP TEMPORÁRIO — aplica supabase/orbita_mesa.sql uma vez (30 out 2026).

   Porque existe: as funções da Vercel não conseguem correr DDL pelo PostgREST, e
   o agente que escreveu isto não tem rede para o Supabase de onde trabalha. Este
   endereço existe só para (1) criar as tabelas e (2) provar a escrita de ponta a
   ponta, uma vez:

     GET /api/setup?token=<SETUP_TOKEN>            → cria as tabelas (idempotente)
     GET /api/setup?token=<SETUP_TOKEN>&smoke=1    → + escreve, relê e apaga um lead

   O `smoke` não deixa dados: escreve um lead de prova, relê-o pelo `/api`, apaga-o
   de seguida. É um teste ao caminho real, não dados de demonstração.

   Regras:
     · sem `SETUP_TOKEN` no ambiente, responde 404 (não existe);
     · token errado, 404 (não confirma que existe);
     · GET, para poder ser chamado de onde só há leitura de URLs;
     · é para APAGAR (ficheiro + variável) assim que o esquema estiver aplicado.
   =========================================================================== */
import fs from 'node:fs';
import { Client } from 'pg';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const esperado = process.env.SETUP_TOKEN;
  const q = new URL(String(req.url || '/'), 'http://local').searchParams;
  if (!esperado || q.get('token') !== esperado) { res.status(404).json({ error: 'não existe' }); return; }

  const ligacao = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!ligacao) { res.status(503).json({ error: 'falta DATABASE_URL/POSTGRES_URL no ambiente da Vercel' }); return; }

  let sql;
  try {
    sql = fs.readFileSync(new URL('../supabase/orbita_mesa.sql', import.meta.url), 'utf8');
  } catch (e) {
    res.status(500).json({ error: `não encontrei o esquema no bundle: ${e.message}` });
    return;
  }

  /* O `pg` deixa a URL sobrepor-se às opções (`Object.assign({}, config, parse(url))`),
     e a cadeia de certificados do pooler do Supabase não valida com o CA do runtime.
     Por isso não se passa `connectionString`: montam-se os campos à mão e diz-se
     explicitamente para não verificar — só neste bootstrap temporário. O `/api`
     não abre socket para o Postgres: fala por HTTPS com a chave secreta. */
  let campos;
  try {
    const u = new URL(ligacao);
    campos = {
      host: u.hostname,
      port: Number(u.port) || 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: (u.pathname || '/postgres').replace(/^\//, '') || 'postgres',
    };
  } catch (e) {
    res.status(500).json({ ok: false, error: `URL de base inválida: ${e.message}` });
    return;
  }

  const saida = { ok: false };
  const client = new Client({ ...campos, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name like 'orbita_%' order by table_name",
    );
    saida.ok = true;
    saida.tabelas = rows.map((r) => r.table_name);

    /* --- de ponta a ponta, com o MESMO cliente que o /api usa --- */
    if (q.get('smoke') === '1') {
      const { createSupabaseRepo, envBase, chaveLead } = await import('./_repo.mjs');
      const env = envBase();
      if (!env.pronto) saida.smoke = { erro: 'faltam SUPABASE_URL/SUPABASE_SECRET_KEY' };
      else {
        const repo = createSupabaseRepo(env);
        const marca = `prova ${Date.now()}`;
        const [lead] = await repo.leads.inserir([{
          dedupe_key: chaveLead(marca, 'prova'), name: marca, city: 'prova', source: 'prova', status: 'novo',
        }]);
        const lido = lead ? await repo.leads.byId(lead.id) : null;
        let apagou = false;
        if (lead) {
          const r = await client.query('delete from public.orbita_leads where id = $1', [lead.id]);
          apagou = r.rowCount === 1;
        }
        saida.smoke = {
          escreveu: !!lead?.id, releu: !!lido && lido.name === marca, apagou,
          restam: (await client.query('select count(*)::int as n from public.orbita_leads')).rows[0].n,
        };
      }
    }
  } catch (e) {
    saida.error = e.message;
    saida.codigo = e.code || null;
    saida.onde = campos ? `${campos.host}:${campos.port}` : null;
    res.status(500).json(saida);
    return;
  } finally {
    try { await client.end(); } catch { /* já fechado */ }
  }

  res.status(200).json(saida);
}
