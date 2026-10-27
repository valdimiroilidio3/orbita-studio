/* BOOTSTRAP TEMPORÁRIO (1.19.0) — aplica o SQL do esquema.
   GET /api/setup?token=<SETUP_TOKEN>[&ia=1]
   Sem token válido: 404. Apaga-se a seguir. */
import fs from 'node:fs';
import { Client } from 'pg';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = new URL(String(req.url || '/'), 'http://x').searchParams;
  if (!process.env.SETUP_TOKEN || q.get('token') !== process.env.SETUP_TOKEN) { res.status(404).json({ error: 'não existe' }); return; }

  const ligacao = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!ligacao) { res.status(503).json({ error: 'falta DATABASE_URL/POSTGRES_URL' }); return; }
  const u = new URL(ligacao);
  const campos = {
    host: u.hostname, port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: (u.pathname || '/postgres').replace(/^\//, '') || 'postgres',
  };

  let sql = '';
  for (const nome of ['orbita_mesa.sql', 'orbita_ia.sql']) {
    sql += `\n-- >>> ${nome}\n` + fs.readFileSync(new URL(`../supabase/${nome}`, import.meta.url), 'utf8');
  }

  const saida = { ok: false };
  const client = new Client({ ...campos, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name like 'orbita%' order by table_name");
    saida.ok = true;
    saida.tabelas = rows.map((r) => r.table_name);

    if (q.get('ia') === '1') {
      const { createSupabaseRepo, envBase } = await import('./_repo.mjs');
      const { criarMotor } = await import('./_ia/motor.mjs');
      const { correr } = await import('./_ia/orquestrador.mjs');
      const { envDoPedido } = await import('./_env.mjs');
      const env = envDoPedido(req);
      const base = envBase();
      if (!base.pronto) { saida.ia = { erro: 'base não configurada' }; }
      else {
        const repo = createSupabaseRepo(base);
        const motor = criarMotor({ repo, env });
        const est = await motor.estado();
        saida.ia = {
          fornecedoresConfigurados: est.fornecedores.filter((f) => f.configurado).map((f) => `${f.id}${f.configurado && !f.variavel ? ' (sem chave)' : ''}`),
          testes: {},
        };
        for (const f of est.fornecedores.filter((x) => x.configurado)) {
          try { saida.ia.testes[f.id] = await motor.testar(f.id); } catch (e) { saida.ia.testes[f.id] = { ok: false, erro: String(e.message).slice(0, 200) }; }
          if (Object.keys(saida.ia.testes).length >= 3) break;   // não varrer 76 fornecedores
        }
        const algumOk = Object.values(saida.ia.testes).some((t) => t.ok);
        if (algumOk) {
          const run = await correr({ repo, motor, objetivo: 'Dizer ao dono quantos leads existem agora, com o número real, e registar o resultado numa nota de memória.', orc: null });
          const passos = await repo.ia.steps.porRun(run.id);
          saida.ia.run = {
            id: run.id, estado: run.estado, modelo: run.modelo, fornecedor: run.fornecedor,
            passos: passos.map((p) => ({ ordem: p.ordem, agente: p.agente, titulo: p.titulo, estado: p.estado, modelo: p.modelo, ferramentas: (p.ferramentas || []).map((f) => `${f.nome}:${f.ok}`) })),
            revisao: run.revisao, erro: run.erro || null, resultado: String(run.resultado || '').slice(0, 1200),
            artefactos: run.artefactos, tokens: run.tokens_in, custo: run.custo_centimos,
          };
          const mem = await repo.ia.memoria.listar({ limite: 5 });
          saida.ia.memoria = { notas: mem.length, ultima: mem[0] ? { titulo: mem[0].titulo, etiquetas: mem[0].etiquetas, fonte: mem[0].fonte } : null };
        }
      }
    }
  } catch (e) {
    saida.error = e.message; saida.codigo = e.code || null; saida.onde = campos.host;
    res.status(500).json(saida); return;
  } finally {
    try { await client.end(); } catch { /* já fechado */ }
  }
  res.status(200).json(saida);
}
