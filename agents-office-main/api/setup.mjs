/* ===========================================================================
   BOOTSTRAP TEMPORÁRIO — aplica supabase/orbita_mesa.sql uma vez (30 out 2026).

   Porque existe: as funções da Vercel não conseguem correr DDL pelo PostgREST, e
   o agente que escreveu isto não tem rede para o Supabase a partir do sítio onde
   trabalha. Este endereço existe só para aplicar o esquema, uma vez:

     GET /api/setup?token=<SETUP_TOKEN>   → cria as tabelas (idempotente) e conta-as

   Regras:
     · sem `SETUP_TOKEN` no ambiente, responde 404 (não existe);
     · token errado, 404 (não confirma que existe);
     · GET, para poder ser chamado de onde só há leitura de URLs;
     · é para APAGAR (ficheiro + variável) assim que o esquema estiver aplicado.
   =========================================================================== */
import fs from 'node:fs';
import { Client } from 'pg';

export default async function handler(req, res) {
  const esperado = process.env.SETUP_TOKEN;
  const dado = new URL(String(req.url || '/'), 'http://local').searchParams.get('token');
  if (!esperado || dado !== esperado) { res.status(404).json({ error: 'não existe' }); return; }

  const ligacao = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!ligacao) { res.status(503).json({ error: 'falta DATABASE_URL no ambiente da Vercel' }); return; }

  let sql;
  try {
    sql = fs.readFileSync(new URL('../supabase/orbita_mesa.sql', import.meta.url), 'utf8');
  } catch (e) {
    res.status(500).json({ error: `não encontrei o esquema no bundle: ${e.message}` });
    return;
  }

  const client = new Client({ connectionString: ligacao, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name like 'orbita_%' order by table_name",
    );
    res.status(200).json({ ok: true, tabelas: rows.map((r) => r.table_name) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    try { await client.end(); } catch { /* já fechado */ }
  }
}
