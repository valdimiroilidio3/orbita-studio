/* ===========================================================================
   1.67.0 · `GET|POST /api/ciclo` — o relógio que faltava (5 nov 2026)

   Esta é a ponta que uma máquina chama: o cron da Vercel, um ping de
   disponibilidade, um `curl`, ou o `POST /ops/ciclo` que a mesa usa com sessão.
   Faz uma coisa só — correr a fila de tarefas (`api/_ia/ciclo.mjs`) — e diz o
   que aconteceu.

   AUTENTICAÇÃO, sem invenções:
     · se `CRON_SECRET` estiver definido, é ele que manda: a Vercel envia
       `Authorization: Bearer $CRON_SECRET` sozinha quando essa variável existe;
     · senão, um dos nossos tokens (`ORBITA_ADMIN_TOKEN`, `ORBITA_API_TOKEN`) no
       cabeçalho serve — é o mesmo `api/_acesso.mjs` da 1.66.0;
     · sem nenhum dos dois configurados, o endpoint **recusa-se a correr**. Um
       endereço que gasta chamadas de IA e que qualquer pessoa pode chamar não é
       um atalho: é um problema de facturação à espera de acontecer.
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { envDoPedido } from './_env.mjs';
import { correrCiclo, resumoDoCiclo } from './_ia/ciclo.mjs';
import { quemPeloToken, iguais } from './_acesso.mjs';

export const config = { maxDuration: 60 };

const SEM_BASE = 'esta instalação não tem base de dados ligada (faltam SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel)';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'usa GET (ou POST para forçar)' });
    return;
  }

  const env = envDoPedido(req);
  const cabecalhos = req.headers || {};

  /* --- a chave desta porta --- */
  const segredo = String(env.CRON_SECRET || '');
  let autorizado = false;
  let via = null;
  if (segredo) {
    const autorizacao = String(cabecalhos.authorization || '');
    const m = /^Bearer\s+(.+)$/i.exec(autorizacao);
    if (m && iguais(m[1].trim(), segredo)) { autorizado = true; via = 'cron'; }
    /* quando CRON_SECRET existe, um token da Órbita também serve (o dono a
       testar do telemóvel não devia precisar de ir buscar o segredo do cron) */
  }
  if (!autorizado) {
    const quem = quemPeloToken({ headers: cabecalhos, env });
    if (quem) { autorizado = true; via = quem.variavel; }
  }
  if (!autorizado) {
    const temChave = !!segredo || !!(env.ORBITA_ADMIN_TOKEN || env.ORBITA_API_TOKEN);
    if (!temChave) {
      res.status(503).json({
        ok: false,
        error: 'o ciclo não corre sem chave: define CRON_SECRET (ou ORBITA_ADMIN_TOKEN) na Vercel',
        porque: 'este endereço gasta chamadas de IA; aberto, qualquer pessoa com o endereço o faria correr',
        como: 'Vercel → Settings → Environment Variables → CRON_SECRET (32+ caracteres, gerados à sorte) → Redeploy',
      });
      return;
    }
    res.status(401).json({
      ok: false,
      error: 'falta a chave do ciclo',
      como: 'Authorization: Bearer <CRON_SECRET ou ORBITA_ADMIN_TOKEN>',
    });
    return;
  }

  const base = envBase();
  if (!base.pronto) {
    res.status(503).json({ ok: false, modo: 'local', error: SEM_BASE });
    return;
  }

  let repo;
  try {
    repo = createSupabaseRepo(base);
  } catch (e) {
    res.status(503).json({ ok: false, modo: 'local', error: e.message });
    return;
  }

  try {
    const r = await correrCiclo({ repo, env });
    const resumo = resumoDoCiclo(r);
    res.status(200).json({ ...resumo, via, detalhe: { feitas: r.feitas, paradas: r.paradas } });
  } catch (e) {
    /* 503 quando falta o esquema é instrução, não avaria — 1.54.4 */
    if (e.semEsquema) {
      res.status(503).json({
        modo: 'local',
        error: e.message || 'falta o esquema da base',
        instrucao: 'aplica o esquema pela página do arranque (ou /api/setup?token=…&ler=1 para ver o que falta)',
      });
      return;
    }
    res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
}
