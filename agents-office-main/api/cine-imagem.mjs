/* ===========================================================================
   1.48.2 · A IMAGEM DO CINE, SERVIDA COMO IMAGEM (28 out 2026)

   Porque é um ficheiro e não uma rota de `/api/rpc`: o envelope do rpc é JSON, e
   uma imagem dentro de JSON obriga a base64 (um terço a mais de bytes) e a
   nenhum browser a poder descarregá-la com «guardar como». Aqui os bytes saem
   como bytes, com o `content-type` verdadeiro que veio do fornecedor.

     GET /api/cine-imagem?leadId=<id>&imagemId=<id>     → image/jpeg
     GET /api/cine-imagem?leadId=<id>&imagemId=<id>&descarregar=1 → attachment

   Regras:
     · só serve imagens que ESTÃO no projecto (nada de proxy aberto para a
       internet — o parâmetro não é um URL);
     · se o projecto já não guarda os bytes daquela imagem (o arquivo só os
       mantém nas mais recentes e na aprovada), responde 410 a dizer isso e com a
       semente — a imagem volta a ser gerada igual;
     · sem base de dados, 503 com a razão de sempre.
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { lerArquivo } from './_cine.mjs';

export const config = { maxDuration: 20 };

const erro = (res, status, mensagem) => res.status(status).json({ ok: false, erro: mensagem });

const nomeDoFicheiro = (projeto, leadId, imagemId) => {
  const base = String(projeto?.lead?.name || leadId)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 40) || 'peca';
  return `orbita-${base}-${imagemId}.jpg`;
};

/**
 * A lógica, separada do `req`/`res`: assim prova-se em teste com um repositório
 * de memória, que é como o resto do projecto se testa.
 * @returns {Promise<{status:number, erro?:string, mime?:string, corpo?:Buffer, nome?:string, extra?:object}>}
 */
export async function imagemDoCine(repo, { leadId, imagemId } = {}) {
  const chave = String(leadId || '').trim();
  const idImg = String(imagemId || '').trim();
  if (!chave || !idImg) return { status: 400, erro: 'diz `leadId` e `imagemId`' };
  let projeto = null;
  try {
    const arquivo = await lerArquivo(repo);
    projeto = arquivo.projetos?.[chave] || null;
  } catch (e) {
    return { status: 500, erro: `não consegui ler o projecto: ${String(e.message || e).slice(0, 200)}` };
  }
  if (!projeto) return { status: 404, erro: 'esta lead não tem trabalho de Cine' };
  const img = (projeto.imagens || []).find((i) => i.id === idImg);
  if (!img) return { status: 404, erro: 'essa imagem não está neste projecto' };
  if (!img.dataUrl) {
    return {
      status: 410,
      erro: 'os bytes desta imagem já não estão guardados (o arquivo só os mantém nas duas mais recentes e na aprovada)',
      extra: {
        semente: img.seed ?? null, modelo: img.modelo || null,
        nota: 'com a mesma semente e o mesmo prompt, a imagem volta igual: gera outra vez no ecrã do Cine',
      },
    };
  }
  const m = String(img.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { status: 500, erro: 'os bytes guardados não têm o formato esperado' };
  return { status: 200, mime: m[1], corpo: Buffer.from(m[2], 'base64'), nome: nomeDoFicheiro(projeto, chave, idImg) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return erro(res, 405, 'só GET');
  }
  const q = new URL(String(req.url || '/'), 'http://local').searchParams;
  const env = envBase();
  if (!env.pronto) return erro(res, 503, 'esta instalação não tem base de dados ligada (faltam SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel)');
  let repo;
  try { repo = createSupabaseRepo(env); } catch (e) { return erro(res, 503, e.message); }

  const r = await imagemDoCine(repo, { leadId: q.get('leadId'), imagemId: q.get('imagemId') });
  if (r.status !== 200) return res.status(r.status).json({ ok: false, erro: r.erro, ...(r.extra || {}) });

  res.setHeader('Content-Type', r.mime);
  res.setHeader('Content-Length', String(r.corpo.length));
  /* a imagem de uma lead não é conteúdo público: cache curta e privada */
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', `${q.get('descarregar') === '1' ? 'attachment' : 'inline'}; filename="${r.nome}"`);
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(r.corpo);
}
