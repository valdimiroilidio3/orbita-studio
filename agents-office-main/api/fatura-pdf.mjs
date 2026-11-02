/* ===========================================================================
   1.56.0 · O PDF DA FATURA, SERVIDO COM SESSÃO (2 nov 2026)

   Mesmo desenho do `/api/ficheiro`: um PDF não é JSON, por isso não passa pelo
   `/api/rpc`. A porta decide primeiro (sem sessão não sai um byte), o documento
   é gerado na hora a partir dos dados guardados — o que se descarrega é sempre
   o que está na base, incluindo a marca de «ANULADA» e a nota de crédito.

   `?d=1` descarrega; sem isso serve `inline` (abre no separador em vez de
   obrigar a guardar).
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { avaliarPorta } from './_porta.mjs';
import { envDoPedido } from './_env.mjs';
import { documentoDaFatura, emitenteDoAmbiente } from './_faturas.mjs';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'só GET' });
    return;
  }
  const q = new URL(String(req.url || '/'), 'http://local').searchParams;
  const id = String(q.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) { res.status(400).json({ error: 'falta o id da fatura' }); return; }

  const base = envBase();
  if (!base.pronto) { res.status(503).json({ modo: 'local', error: 'esta instalação não tem base de dados ligada — a fatura vive na base' }); return; }
  const env = envDoPedido(req);
  let repo;
  try { repo = createSupabaseRepo(base); } catch (e) { res.status(503).json({ error: e.message }); return; }

  const porta = await avaliarPorta(repo, {
    caminho: `/ops/faturas/${id}`, metodo: 'GET', headers: req.headers || {}, env,
    ip: String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '').split(',')[0].trim() || null,
  });
  if (porta.resposta) {
    const c = porta.resposta.cabecalhos && porta.resposta.cabecalhos['Set-Cookie'];
    if (c) res.setHeader('Set-Cookie', c);
    res.status(porta.resposta.status).json(porta.resposta.corpo || { error: 'sem autorização' });
    return;
  }

  let f;
  try { f = await repo.faturas.porId(id); } catch (e) { res.status(500).json({ error: String(e?.message || e).slice(0, 200) }); return; }
  if (!f) { res.status(404).json({ error: 'fatura não encontrada' }); return; }

  let pdf;
  try {
    pdf = documentoDaFatura(f, { emitente: emitenteDoAmbiente(env), agora: () => new Date() });
  } catch (e) {
    res.status(500).json({ error: `não consegui gerar o PDF: ${String(e?.message || e).slice(0, 160)}` });
    return;
  }

  const nome = `${String(f.codigo || f.id).replace(/[^0-9A-Za-z-]/g, '-')}.pdf`;
  const baixar = q.get('d') === '1';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('Content-Disposition', `${baixar ? 'attachment' : 'inline'}; filename="${nome}"`);
  res.status(200).end(pdf);
}
