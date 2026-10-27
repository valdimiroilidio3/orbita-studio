/* ===========================================================================
   BOOTSTRAP TEMPORÁRIO — aplica os SQL do esquema (30 out 2026 · 1.18.0).

   Só existe porque as funções da Vercel não correm DDL pelo PostgREST e quem
   escreve este código não tem rede para o Postgres de onde trabalha. Aplica
   `supabase/orbita_mesa.sql` e `supabase/orbita_ia.sql` (idempotentes) e prova
   a escrita de ponta a ponta nas tabelas da IA.

     GET /api/setup?token=<SETUP_TOKEN>            → aplica e conta as tabelas
     GET /api/setup?token=<SETUP_TOKEN>&smoke=1    → + escreve, relê e apaga um run

   Regras: sem `SETUP_TOKEN` responde 404; token errado, 404; é para APAGAR
   (ficheiro + variável) assim que o esquema estiver aplicado.
   =========================================================================== */
import fs from 'node:fs';
import { Client } from 'pg';

const FICHEIROS = ['orbita_mesa.sql', 'orbita_ia.sql'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const esperado = process.env.SETUP_TOKEN;
  const q = new URL(String(req.url || '/'), 'http://local').searchParams;
  if (!esperado || q.get('token') !== esperado) { res.status(404).json({ error: 'não existe' }); return; }

  const ligacao = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!ligacao) { res.status(503).json({ error: 'falta DATABASE_URL/POSTGRES_URL no ambiente da Vercel' }); return; }

  /* o `pg` deixa a URL sobrepor-se às opções (Object.assign({}, config, parse(url))) e a
     cadeia de certificados do pooler não valida com o CA do runtime: campos à mão. */
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

  let sql = '';
  const aplicados = [];
  for (const nome of FICHEIROS) {
    try {
      sql += `\n-- >>> ${nome}\n` + fs.readFileSync(new URL(`../supabase/${nome}`, import.meta.url), 'utf8');
      aplicados.push(nome);
    } catch (e) {
      res.status(500).json({ ok: false, error: `não encontrei ${nome} no bundle: ${e.message}` });
      return;
    }
  }

  const saida = { ok: false, aplicados };
  const client = new Client({ ...campos, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name like 'orbita_%' order by table_name",
    );
    saida.ok = true;
    saida.tabelas = rows.map((r) => r.table_name);

    if (q.get('smoke') === '1') {
      const { createSupabaseRepo, envBase } = await import('./_repo.mjs');
      const env = envBase();
      if (!env.pronto) saida.smoke = { erro: 'faltam SUPABASE_URL/SUPABASE_SECRET_KEY' };
      else {
        const repo = createSupabaseRepo(env);
        const run = await repo.ia.runs.criar({ objetivo: 'prova de ligação da IA', estado: 'concluido' });
        const lido = run ? await repo.ia.runs.porId(run.id) : null;
        const step = run ? await repo.ia.steps.criar({ run_id: run.id, ordem: 1, agente: 'teste', titulo: 'prova', estado: 'concluido', saida: 'ok' }) : null;
        const passos = run ? await repo.ia.steps.porRun(run.id) : [];
        await repo.ia.uso.registar({ fornecedor: 'teste', modelo: 'teste', agente: 'teste', tipo: 'teste', ok: true, ms: 1, tokens_in: 0, tokens_out: 0 });
        const uso = await repo.ia.uso.recentes(5);
        const cfg = await repo.ia.config.ler();
        await repo.ia.config.gravar('prova', { quando: new Date().toISOString() });
        const cfg2 = await repo.ia.config.ler();
        const limpeza = await client.query('delete from public.orbita_ai_runs where id = $1', [run?.id || null]);
        await client.query("delete from public.orbita_ai_uso where agente = 'teste'");
        await client.query("delete from public.orbita_ai_config where chave = 'prova'");
        saida.smoke = {
          runCriado: !!run?.id, runRelido: !!lido && lido.objetivo === 'prova de ligação da IA',
          stepCriado: !!step?.id, passosLidos: passos.length, usoRegistado: uso.length > 0,
          configLida: typeof cfg === 'object', configGravada: !!cfg2.prova,
          limpeza: limpeza.rowCount === 1,
          restam: (await client.query('select count(*)::int as n from public.orbita_ai_runs')).rows[0].n,
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
