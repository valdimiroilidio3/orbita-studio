/* ===========================================================================
   `/api/setup` — aplica o esquema à base (1.19.2 · revisto na 1.41.0)

   Antes: só `orbita_ia.sql`, num único `query(sql)` sem transacção, e respondia
   «ok» mesmo quando metade das tabelas não existia. Agora aplica os três
   ficheiros do esquema, pela ordem certa (ver `_esquema.mjs`), um por
   transacção, e diz quantas tabelas da mesa ficaram a existir.

     GET /api/setup?token=<SETUP_TOKEN>                      (aplica tudo)
     GET /api/setup?token=<SETUP_TOKEN>&so=orbita_mesa.sql   (só um)
     GET /api/setup?token=<SETUP_TOKEN>&ler=1                (SÓ LÊ: tabelas e
          colunas, e o que falta — não aplica nada. 1.44.6)

   O `ler=1` existe por um motivo concreto: em 28 out 2026 era preciso «ler as
   tabelas existentes antes de correr SQL» e não havia como. A rota aplicava
   primeiro e só depois mostrava o que existia.

   Sem `SETUP_TOKEN` definido, ou com o token errado, responde 404 — não 401:
   uma rota de bootstrap não deve confirmar que existe a quem não sabe o token.
   =========================================================================== */
import { aplicarEsquema, COLUNAS_EXIGIDAS, NAO_APLICADOS, TABELAS_DA_MESA, colunasEmFalta, colunasExistentes, tabelasExistentes, tabelasEmFalta } from './_esquema.mjs';
import { VERSAO } from './_versao.mjs';

export const config = { maxDuration: 60 };

async function ligar() {
  const bruto = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!bruto) throw new Error('falta DATABASE_URL/POSTGRES_URL (Database → Connection string → URI)');
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
  if (!process.env.SETUP_TOKEN || q.get('token') !== process.env.SETUP_TOKEN) {
    res.status(404).json({ error: 'não existe' });
    return;
  }

  let c = null;
  try {
    c = await ligar();
    const so = q.get('so') || null;
    /* 1.44.6 · auditoria sem escrever nada: é o que se corre ANTES de aplicar */
    if (q.get('ler') === '1') {
      const tabelas = await tabelasExistentes(c);
      const colunas = await colunasExistentes(c, tabelas);
      const faltamTabelas = tabelasEmFalta(tabelas);
      const faltamColunas = colunasEmFalta(colunas);
      await c.end();
      res.status(200).json({
        ok: !faltamTabelas.length && !Object.keys(faltamColunas).length,
        modo: 'leitura',                                  // nada foi aplicado
        versao: VERSAO,
        tabelas,
        faltamTabelas,
        colunas,
        exigidas: TABELAS_DA_MESA,
        colunasExigidas: COLUNAS_EXIGIDAS,
        faltamColunas,
        naoAplicados: NAO_APLICADOS,
      });
      return;
    }
    const r = await aplicarEsquema(c, { so, log: (t) => console.log(t) });
    const tabelas = await tabelasExistentes(c);
    const faltam = tabelasEmFalta(tabelas);
    await c.end();
    res.status(r.ok && !faltam.length ? 200 : 500).json({
      ok: r.ok && !faltam.length,
      versao: VERSAO,
      aplicados: r.aplicados.map((a) => a.ficheiro),
      erro: r.erro,
      tabelas,
      faltam,
      exigidas: TABELAS_DA_MESA,
      /* a lista do que está no repositório e não se aplica — com a razão */
      naoAplicados: NAO_APLICADOS,
    });
  } catch (e) {
    if (c) { try { await c.end(); } catch { /* já fechado */ } }
    res.status(500).json({ ok: false, versao: VERSAO, erro: String(e.message || e).slice(0, 400) });
  }
}
