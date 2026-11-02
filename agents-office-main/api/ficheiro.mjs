/* ===========================================================================
   1.54.3 · O FICHEIRO GERADO, SERVIDO COM SESSÃO — 2 nov 2026

   Porque não é `/api/rpc`: aquele caminho devolve sempre JSON (é o contrato da
   mesa). Um JPEG de 400 KB dentro de JSON em base64 é 550 KB de texto, e um
   vídeo de 2 MB seriam 2,7 MB de string — não se faz.

   Porque não é uma URL pública do fornecedor: expira, muda e não está ligada a
   ninguém. O bucket `orbita-media` é PRIVADO e o ficheiro só sai daqui.

   Regras:
     · `GET /api/ficheiro?id=<geração>` — exige sessão (a porta decide);
     · `&d=1` → download (Content-Disposition: attachment);
     · `Cache-Control: private, no-store` — é conteúdo de um cliente, não é CDN;
     · `nosniff` e o tipo declarado apenas se for um dos que se aceitam;
     · sem chave, sem caminho interno e sem detalhe do fornecedor na resposta.
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { avaliarPorta } from './_porta.mjs';
import { criarArmazem } from './_armazem.mjs';
import { lerFicheiro } from './_media.mjs';
import { envDoPedido } from './_env.mjs';

export const config = { maxDuration: 30 };

const TIPOS_SEGUROS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'só GET' });
    return;
  }
  const q = new URL(String(req.url || '/'), 'http://local').searchParams;
  const id = String(q.get('id') || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!id) { res.status(400).json({ error: 'falta o id da geração' }); return; }

  const base = envBase();
  if (!base.pronto) { res.status(503).json({ modo: 'local', error: 'esta instalação não tem base de dados ligada' }); return; }
  const env = envDoPedido(req);
  let repo;
  try { repo = createSupabaseRepo(base); } catch (e) { res.status(503).json({ error: e.message }); return; }

  /* a mesma porta da mesa: sem sessão válida não sai um byte */
  const porta = await avaliarPorta(repo, {
    caminho: `/ops/media/${id}/ficheiro`, metodo: 'GET', headers: req.headers || {}, env,
    ip: String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '').split(',')[0].trim() || null,
  });
  if (porta.resposta) {
    const c = porta.resposta.cabecalhos && porta.resposta.cabecalhos['Set-Cookie'];
    if (c) res.setHeader('Set-Cookie', c);
    res.status(porta.resposta.status).json(porta.resposta.corpo || { error: 'sem autorização' });
    return;
  }

  let f;
  try {
    f = await lerFicheiro(repo, id, { env, armazem: criarArmazem({ env }) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e).slice(0, 200) });
    return;
  }
  if (!f.ok) { res.status(f.status || 404).json({ error: f.erro }); return; }

  const tipo = TIPOS_SEGUROS.includes(f.mime) ? f.mime : 'application/octet-stream';
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Length', String(f.bytes.length));
  const baixar = q.get('d') === '1';
  const nome = String(f.nome || `${id}`).replace(/["\\r\\n]/g, '');
  res.setHeader('Content-Disposition', `${baixar ? 'attachment' : 'inline'}; filename="${nome}"`);
  res.status(200).end(f.bytes);
}
