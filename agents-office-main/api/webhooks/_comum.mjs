/* O que os dois webhooks partilham (1.37.0): ler o corpo BRUTO — a assinatura é
   calculada sobre os bytes que chegaram, não sobre o JSON reserializado — e
   devolver a resposta que a rota pediu. */
import { createSupabaseRepo } from '../_repo.mjs';
import { envDoPedido } from '../_env.mjs';
import { responder } from '../_rotas.mjs';

export const config = { api: { bodyParser: false } };

export async function lerBruto(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const partes = [];
  for await (const p of req) partes.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
  return Buffer.concat(partes).toString('utf8');
}

export async function tratarWebhook(req, res, caminho) {
  const bruto = await lerBruto(req);
  let corpo = {};
  try { corpo = bruto ? JSON.parse(bruto) : {}; } catch { return res.status(400).json({ error: 'corpo que não é JSON' }); }

  let repo;
  try {
    repo = createSupabaseRepo(envDoPedido(req));
  } catch (e) {
    return res.status(503).json({ modo: 'local', error: e.message });
  }

  try {
    const r = await responder(repo, {
      caminho,
      metodo: req.method,
      corpo,
      corpoBruto: bruto,
      headers: req.headers || {},
      env: envDoPedido(req),
    });
    /* o desafio do WhatsApp tem de voltar como texto puro, não como JSON */
    if (typeof r.corpo === 'string') return res.status(r.status).send(r.corpo);
    return res.status(r.status).json(r.corpo);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || 'erro a tratar o webhook' });
  }
}
