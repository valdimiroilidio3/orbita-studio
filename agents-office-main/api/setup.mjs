/* BOOTSTRAP TEMPORÁRIO (1.19.2) — cria as tabelas do esquema.
   GET /api/setup?token=<SETUP_TOKEN>   · apaga-se a seguir. */
import fs from 'node:fs';

export const config = { maxDuration: 60 };

async function ligar() {
  const bruto = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!bruto) throw new Error('falta DATABASE_URL/POSTGRES_URL');
  /* A URL da Vercel traz `sslmode=…`, que manda sobre o objecto `ssl` e exige
     verificação da cadeia — foi isso que deu «self-signed certificate in
     certificate chain». Tiram-se os parâmetros de SSL e decide-se aqui. */
  const u = new URL(bruto);
  for (const k of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey']) u.searchParams.delete(k);
  const { default: pg } = await import('pg');
  const cliente = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await cliente.connect();
  return cliente;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = new URL(String(req.url || '/'), 'http://x').searchParams;
  if (!process.env.SETUP_TOKEN || q.get('token') !== process.env.SETUP_TOKEN) { res.status(404).json({ error: 'não existe' }); return; }
  try {
    const sql = fs.readFileSync(new URL('../supabase/orbita_ia.sql', import.meta.url), 'utf8');
    const c = await ligar();
    await c.query(sql);
    const t = await c.query("select table_name from information_schema.tables where table_schema='public' and table_name like 'orbita_ai%' order by 1");
    await c.end();
    res.status(200).json({ ok: true, tabelas: t.rows.map((r) => r.table_name) });
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e).slice(0, 400) });
  }
}
