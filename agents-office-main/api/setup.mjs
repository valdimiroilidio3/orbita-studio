/* ===========================================================================
   `/api/setup` — aplica o esquema à base (1.19.2 · revisto na 1.41.0 · POST na 1.64.0)

   Antes: só `orbita_ia.sql`, num único `query(sql)` sem transacção, e respondia
   «ok» mesmo quando metade das tabelas não existia. Agora aplica os três
   ficheiros do esquema, pela ordem certa (ver `_esquema.mjs`), um por
   transacção, e diz quantas tabelas da mesa ficaram a existir.

     GET  /api/setup?token=<SETUP_TOKEN>                     (aplica tudo)
     GET  /api/setup?token=<SETUP_TOKEN>&so=orbita_mesa.sql  (só um)
     GET  /api/setup?token=<SETUP_TOKEN>&ler=1               (SÓ LÊ: tabelas e
          colunas, e o que falta — não aplica nada. 1.44.6)
     POST /api/setup   corpo {token, so?, ler?}              (1.64.0)

   O `POST` existe por uma razão prática e não por gosto: a página do arranque
   passou a poder LER e APLICAR o esquema, e um token no endereço fica nos
   registos do servidor, no histórico do browser e no Referer. No `POST` o token
   vai no corpo do pedido. O `GET` fica como sempre foi — há quem o tenha
   guardado nos favoritos, e tirá-lo seria quebrar o que já funciona.

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

/* ---------- 1.64.0 · o pedido: método, corpo e token ---------- */

/** Lê o corpo de um `POST` (JSON), com tecto. Exportado para se provar sem rede. */
export async function lerCorpo(req, limite = 4096) {
  if (req && req.body && typeof req.body === 'object') return req.body;
  if (req && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return {};
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    const b = Buffer.isBuffer(parte) ? parte : Buffer.from(String(parte));
    total += b.length;
    /* um token não precisa de 4 KB: um corpo maior do que isto não é um pedido
       legítimo e não vale a pena ler até ao fim */
    if (total > limite) throw Object.assign(new Error('corpo do pedido grande demais'), { status: 413 });
    partes.push(b);
  }
  const bruto = Buffer.concat(partes).toString('utf8').trim();
  if (!bruto) return {};
  try { return JSON.parse(bruto); } catch { return {}; }
}

/** Compara o token sem sair à primeira letra diferente (e sem revelar o tamanho). */
export function tokenIgual(dado, esperado) {
  const a = String(dado || '');
  const b = String(esperado || '');
  if (!b || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i += 1) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** O que fazer, juntando o endereço (GET) e o corpo (POST). O corpo não ganha ao endereço. */
function opcoesDoPedido(q, corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  return {
    token: q.get('token') || (typeof c.token === 'string' ? c.token : ''),
    so: q.get('so') || (typeof c.so === 'string' && c.so ? c.so : null),
    ler: q.get('ler') === '1' || c.ler === true || c.ler === 1 || c.ler === '1',
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const metodo = String((req && req.method) || 'GET').toUpperCase();
  const q = new URL(String((req && req.url) || '/'), 'http://x').searchParams;

  let corpo = null;
  if (metodo === 'POST') {
    try { corpo = await lerCorpo(req); } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
      return;
    }
  } else if (metodo !== 'GET') {
    /* um método que não se serve diz-se, em vez de aplicar o esquema a quem
       carregou num `HEAD` com a sorte do lado dele */
    res.status(405).json({ error: 'só GET ou POST' });
    return;
  }

  const pedido = opcoesDoPedido(q, corpo);
  if (!tokenIgual(pedido.token, process.env.SETUP_TOKEN)) {
    res.status(404).json({ error: 'não existe' });
    return;
  }

  let c = null;
  try {
    c = await ligar();
    const so = pedido.so;
    /* 1.44.6 · auditoria sem escrever nada: é o que se corre ANTES de aplicar */
    if (pedido.ler) {
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
