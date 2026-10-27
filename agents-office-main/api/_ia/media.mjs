/* ===========================================================================
   1.19.0 · ESTÚDIO DE MEDIA (OpenMontage) — 27 out 2026

   O OpenMontage (AGPL-3.0, © calesthio) é um sistema de produção de vídeo com
   agentes: pipelines para vídeo cinematográfico, documentário, animação,
   explicador, podcast, localização, falante (avatar), etc. Precisa de Python,
   FFmpeg, Node e — para a maior parte dos pipelines — chaves de fornecedores
   pagos (Veo, Kling via fal.ai, ElevenLabs, Lyria…).

   Isso não corre numa função da Vercel. Por isso o desenho é este:

     mesa (#/estudio)  ──POST /api/rpc /media/trabalhos──▶  orbita_media_jobs
                                                                    │
                                              (o worker puxa, com token)
                                                                    ▼
                       scripts/estudio-worker.mjs   ──▶   OpenMontage instalado
                       (numa máquina com Python/FFmpeg)      (venv + pipelines)

   Regras:
     · a licença é AGPL-3.0 → o OpenMontage NÃO é copiado para este repositório
       nem para o bundle; vive onde o worker corre e é chamado por fora;
     · sem worker vivo, um trabalho fica `indisponivel` com a razão escrita —
       não se finge um render;
     · nada de resultados inventados: o worker escreve o que o comando disse.
   =========================================================================== */

export const PIPELINES = [
  { id: 'cinematic', nome: 'Cinematográfico', tipo: 'video', precisa: ['veo/kling'], nota: 'trailer com planos gerados e banda sonora' },
  { id: 'documentary-montage', nome: 'Documentário', tipo: 'video', precisa: ['stock livre'], nota: 'corpus de arquivo + montagem' },
  { id: 'animated-explainer', nome: 'Explicador animado', tipo: 'animacao', precisa: ['remotion'], nota: 'zero-chave: só componentes Remotion' },
  { id: 'animation', nome: 'Animação', tipo: 'animacao', precisa: ['remotion'], nota: '' },
  { id: 'framework-smoke', nome: 'Smoke do framework', tipo: 'animacao', precisa: ['remotion'], nota: 'o mais leve; serve para provar a instalação' },
  { id: 'podcast-repurpose', nome: 'Podcast → vídeo', tipo: 'audio', precisa: ['transcrição'], nota: '' },
  { id: 'localization-dub', nome: 'Dobragem / localização', tipo: 'audio', precisa: ['elevenlabs/google'], nota: '' },
  { id: 'avatar-spokesperson', nome: 'Avatar falante', tipo: 'video', precisa: ['heygen/fal'], nota: '' },
  { id: 'talking-head', nome: 'Talking head', tipo: 'video', precisa: ['video do dono'], nota: '' },
  { id: 'character-animation', nome: 'Personagem animada', tipo: 'animacao', precisa: ['kling'], nota: '' },
  { id: 'clip-factory', nome: 'Fábrica de clips', tipo: 'video', precisa: ['stock'], nota: '' },
  { id: 'hybrid', nome: 'Híbrido', tipo: 'video', precisa: ['misto'], nota: '' },
  { id: 'screen-demo', nome: 'Demonstração de ecrã', tipo: 'video', precisa: ['captura'], nota: '' },
];

export const TIPOS = ['video', 'imagem', 'audio', 'animacao', '3d'];

const MAX_PEDIDO = 2000;

/** O worker está configurado neste ambiente? (token + heartbeat recente) */
export async function estado(repo, env = process.env) {
  const temToken = !!env.MEDIA_WORKER_TOKEN;
  let hb = null;
  try { hb = (await repo.ia.config.ler()).estudio || null; } catch { hb = null; }
  const quando = hb?.quando ? Date.parse(hb.quando) : 0;
  const minutos = quando ? Math.round((Date.now() - quando) / 60000) : null;
  const vivo = quando > 0 && (Date.now() - quando) < 1000 * 60 * 15;
  return {
    configurado: temToken,
    worker: { vivo, vistoHaMinutos: minutos, versao: hb?.versao || null, commit: hb?.commit || null, pipelines: hb?.pipelines || [], ferramentas: hb?.ferramentas || null },
    pipelines: PIPELINES,
    tipos: TIPOS,
    porque: !temToken
      ? 'falta MEDIA_WORKER_TOKEN na Vercel: sem isso a mesa não aceita trabalhos de media'
      : !vivo
        ? 'há token mas nenhum worker deu sinal nos últimos 15 minutos — é preciso correr scripts/estudio-worker.mjs numa máquina com Python, FFmpeg e Node'
        : null,
    nota: 'O OpenMontage é AGPL-3.0 e não é copiado para este repositório: corre onde o worker corre.',
  };
}

function validar({ pedido, tipo, pipeline }) {
  const p = String(pedido || '').trim();
  if (p.length < 10) return { erro: 'descreve o que queres produzir (mínimo 10 caracteres)' };
  if (p.length > MAX_PEDIDO) return { erro: `pedido demasiado longo (máx. ${MAX_PEDIDO})` };
  const t = TIPOS.includes(tipo) ? tipo : 'video';
  if (pipeline && !PIPELINES.some((x) => x.id === pipeline)) return { erro: `pipeline desconhecida: ${pipeline}` };
  return { pedido: p, tipo: t, pipeline: pipeline || null };
}

/** Cria um trabalho. Sem worker configurado, nasce `indisponivel` e diz porquê. */
export async function criar(repo, dados, env = process.env) {
  const v = validar(dados || {});
  if (v.erro) return { status: 400, corpo: { error: v.erro } };
  const est = await estado(repo, env);
  const job = await repo.ia.media.criar({
    pedido: v.pedido, tipo: v.tipo, pipeline: v.pipeline,
    estado: est.configurado ? 'pedido' : 'indisponivel',
    erro: est.configurado ? null : est.porque,
  });
  return { status: 201, corpo: { trabalho: job, estudio: { configurado: est.configurado, workerVivo: est.worker.vivo } } };
}

export async function listar(repo, limite = 30) {
  const jobs = await repo.ia.media.listar(limite);
  return { status: 200, corpo: { trabalhos: jobs } };
}

/* ---------- lado do worker (token próprio, nunca a chave da base) ---------- */

export function tokenOk(env, recebido) {
  const esperado = String(env.MEDIA_WORKER_TOKEN || '');
  if (!esperado || esperado.length < 16) return false;
  return String(recebido || '') === esperado;
}

/** O worker pede o próximo trabalho: assume-o e recebe o pedido. */
export async function assumir(repo, env = process.env) {
  const livres = (await repo.ia.media.listar(20)).filter((j) => j.estado === 'pedido');
  const job = livres[livres.length - 1] || null;   // o mais antigo dos 20
  if (!job) return { status: 200, corpo: { trabalho: null, nota: 'nada na fila' } };
  const tomado = await repo.ia.media.actualizar(job.id, { estado: 'a_correr', fornecedor: 'openmontage', actualizado: new Date().toISOString() });
  return { status: 200, corpo: { trabalho: tomado } };
}

export async function concluir(repo, id, { url, resposta, pipeline } = {}) {
  const job = await repo.ia.media.porId(id);
  if (!job) return { status: 404, corpo: { error: 'trabalho não encontrado' } };
  const r = await repo.ia.media.actualizar(id, {
    estado: 'concluido', url_resultado: url ? String(url).slice(0, 500) : null,
    resposta: resposta || null, pipeline: pipeline || job.pipeline, erro: null,
    actualizado: new Date().toISOString(),
  });
  return { status: 200, corpo: { trabalho: r } };
}

export async function falhar(repo, id, motivo) {
  const job = await repo.ia.media.porId(id);
  if (!job) return { status: 404, corpo: { error: 'trabalho não encontrado' } };
  const r = await repo.ia.media.actualizar(id, {
    estado: 'falhou', erro: String(motivo || 'sem motivo indicado').slice(0, 800),
    actualizado: new Date().toISOString(),
  });
  return { status: 200, corpo: { trabalho: r } };
}

/** Heartbeat do worker: o que está instalado, do lado de lá, dito por ele. */
export async function sinal(repo, corpo = {}) {
  const hb = {
    quando: new Date().toISOString(),
    versao: corpo.versao ? String(corpo.versao).slice(0, 60) : null,
    commit: corpo.commit ? String(corpo.commit).slice(0, 40) : null,
    pipelines: Array.isArray(corpo.pipelines) ? corpo.pipelines.map(String).slice(0, 60) : [],
    ferramentas: corpo.ferramentas && typeof corpo.ferramentas === 'object'
      ? Object.fromEntries(Object.entries(corpo.ferramentas).slice(0, 12).map(([k, v]) => [String(k).slice(0, 30), !!v]))
      : null,
  };
  try { await repo.ia.config.gravar('estudio', hb); } catch { /* sem base, sem sinal */ }
  return { status: 200, corpo: { ok: true, recebido: hb } };
}
