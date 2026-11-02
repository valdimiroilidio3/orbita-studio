/* ===========================================================================
   1.54.3 · OS FORNECEDORES DE MEDIA — a única parte que fala com o mundo

   Duas integrações, escolhidas por serem as que funcionam HOJE sem cartão:

   1 · IMAGEM — Pollinations (`image.pollinations.ai` / `gen.pollinations.ai`)
       É a mesma integração que o Cine já usa desde a 1.48 e está provada: devolve
       bytes de imagem, confere tipo e tamanho, e a chave (se existir) fica no
       servidor. O tier anónimo é gratuito e não pede chave; com
       POLLINATIONS_API_KEY passa a usar os modelos novos.
       Limitações reais: o tier anónimo ignora o nome do modelo (serve `flux`),
       não tem SLA, pode limitar pedidos por minuto, e o serviço pode recusar
       prompts por política. Tudo isso se diz na resposta em vez de se inventar
       um resultado.

   2 · VÍDEO — composição no browser («Órbita Render»)
       Não há, hoje, um fornecedor de vídeo generativo gratuito que corra numa
       função da Vercel: os modelos de vídeo do catálogo Pollinations são pagos
       (`paid_only`) e o OpenMontage precisa de Python + FFmpeg numa máquina.
       O que existe de graça é a composição em canvas + MediaRecorder
       (`src/estudio-video.js`, provada na 1.53.2): movimento lento sobre as
       imagens já geradas do projeto e um ficheiro MP4/WebM real. É vídeo, mas
       NÃO é vídeo de IA — e diz-se com essas palavras na interface.

   Nada aqui decide o que se guarda, quanto custa ou quem pode: isso é
   api/_media.mjs. Nada aqui conhece a base de dados.
   =========================================================================== */

import { MODELOS_IMAGEM, FORMATOS } from '../_cine.mjs';
import { gerarImagem as gerarComPollinations } from '../_cine.mjs';

export const PRECISA_IMAGEM = 'nada (tier gratuito)';

/** O catálogo do que está disponível neste ambiente, com os limites ditos. */
export const FORNECEDORES = [
  {
    id: 'pollinations',
    nome: 'Pollinations',
    tipos: ['imagem'],
    gratis: true,
    env: ['POLLINATIONS_API_KEY (opcional: muda para os modelos novos)'],
    precisa: PRECISA_IMAGEM,
    nota: 'imagem a sério, em segundos. O tier anónimo não garante disponibilidade nem ritmo; com chave, usa os modelos do catálogo.',
    limites: 'sem SLA no tier anónimo; pode haver limite de pedidos por minuto e recusa de prompts por política',
  },
  {
    id: 'orbita-render',
    nome: 'Órbita Render (composição no browser)',
    tipos: ['video'],
    gratis: true,
    env: [],
    precisa: 'um browser com MediaRecorder (o mesmo que a mesa usa desde a 1.53.2)',
    nota: 'vídeo composto com as imagens já geradas deste projeto: movimento lento, MP4 onde o browser o souber gravar e WebM onde não. Não é vídeo generativo.',
    limites: 'máx. 1280×720, até 6 planos, ~20 s; navegar para fora da página interrompe a composição (o trabalho fica à espera e pode retomar-se)',
  },
];

export const FORNECEDOR_IMAGEM = 'pollinations';
export const FORNECEDOR_VIDEO = 'orbita-render';

/* ---------- opções que o fornecedor REALMENTE tem ---------- */

export const RESOLUCOES = [
  { id: '768', rotulo: 'Rápida (768 px)', nota: 'a mais leve: serve para explorar' },
  { id: '1024', rotulo: 'Normal (1024 px)', nota: 'o tamanho de trabalho' },
  { id: '1344', rotulo: 'Detalhada (1344 px)', nota: 'peça final; demora mais' },
];

export const DURACOES = [
  { id: 4, rotulo: '4 s', nota: '2 planos' },
  { id: 6, rotulo: '6 s', nota: '3 planos' },
  { id: 8, rotulo: '8 s', nota: '4 planos' },
  { id: 10, rotulo: '10 s', nota: 'até 6 planos' },
];

export const MOVIMENTOS = [
  { id: 'kenburns', rotulo: 'Movimento lento', nota: 'aproximar e afastar, como um plano de cinema' },
  { id: 'firme', rotulo: 'Câmara firme', nota: 'sem zoom: só cortes entre planos' },
];

/** A proporção em pixels, arredondada a múltiplos de 64 (é o que os modelos esperam). */
export function dimensoes(formatoId = '1:1', resolucao = '1024') {
  const f = FORMATOS.find((x) => x.id === formatoId) || FORMATOS[0];
  const maior = Math.max(f.largura, f.altura);
  const lado = Number(resolucao) || maior;
  const escala = lado / maior;
  const r = (v) => Math.max(256, Math.round((v * escala) / 64) * 64);
  return { largura: r(f.largura), altura: r(f.altura) };
}

/** O que a interface pode mostrar como opção — e só isso. */
export function opcoesPublicas() {
  return {
    imagem: {
      formatos: FORMATOS.map((f) => ({ id: f.id, rotulo: f.rotulo, uso: f.uso })),
      resolucoes: RESOLUCOES,
      modelos: MODELOS_IMAGEM.map((m) => ({ id: m.id, rotulo: m.rotulo, nota: m.nota, pago: !!m.pago })),
    },
    video: {
      /* o compositor do browser grava 1280×720: só 16:9. Não se mostra 9:16
         porque não é uma opção que exista — e uma opção que não existe é uma
         promessa falsa. */
      formatos: FORMATOS.filter((f) => f.id === '16:9').map((f) => ({ id: f.id, rotulo: f.rotulo, uso: f.uso })),
      duracoes: DURACOES,
      movimentos: MOVIMENTOS,
      maxLargura: 1280,
      maxAltura: 720,
      maxPlanos: 6,
    },
  };
}

/** Este ambiente consegue mesmo gerar? (é a interface que mostra isto) */
export function disponibilidade(env = {}) {
  const comChave = !!(String(env?.POLLINATIONS_API_KEY || env?.POLLINATIONS_TOKEN || '').trim());
  return FORNECEDORES.map((f) => ({
    ...f,
    disponivel: true,
    viaChave: f.id === 'pollinations' ? comChave : null,
    porque: f.id === 'pollinations'
      ? (comChave
        ? 'com POLLINATIONS_API_KEY: usa os modelos do catálogo'
        : 'sem chave: usa o tier anónimo (modelo flux), que é gratuito e pode limitar o ritmo')
      : 'não precisa de chave: compõe-se no browser com as imagens deste projeto',
  }));
}

/* ---------- validação de parâmetros (o servidor não confia no cliente) ---------- */

const texto = (v) => String(v ?? '').trim();

export function validarOpcoes({ tipo, formato = null, resolucao = null, duracao = null, movimento = null }) {
  const erros = [];
  const opcoes = {};
  const formatosValidos = tipo === 'video' ? ['16:9'] : FORMATOS.map((f) => f.id);
  opcoes.formato = formatosValidos.includes(formato) ? formato : (tipo === 'video' ? '16:9' : '1:1');
  if (formato && !formatosValidos.includes(formato)) {
    erros.push(tipo === 'video'
      ? `formato «${formato}» não existe em vídeo: o compositor grava 16:9 (1280×720)`
      : `formato «${formato}» não existe para ${tipo}`);
  }

  if (tipo === 'imagem') {
    const r = RESOLUCOES.some((x) => x.id === String(resolucao)) ? String(resolucao) : '1024';
    if (resolucao && r !== String(resolucao)) erros.push(`resolução «${resolucao}» não existe (768, 1024 ou 1344)`);
    opcoes.resolucao = r;
    const d = dimensoes(opcoes.formato, r);
    opcoes.largura = d.largura;
    opcoes.altura = d.altura;
  } else {
    const d = Number(duracao);
    const dv = DURACOES.find((x) => x.id === d) ? d : 6;
    if (duracao !== null && duracao !== undefined && !DURACOES.some((x) => x.id === d)) erros.push(`duração «${duracao}» não existe (4, 6, 8 ou 10 s)`);
    opcoes.duracao = dv;
    opcoes.movimento = MOVIMENTOS.some((x) => x.id === movimento) ? movimento : 'kenburns';
    opcoes.planos = Math.min(6, Math.max(2, Math.round(dv / 2)));
  }
  return { ok: erros.length === 0, erros, opcoes };
}

/* ---------- imagem: a chamada real ao fornecedor ---------- */

/**
 * Gera uma imagem e devolve os BYTES (nunca um data: para o cliente — o cliente
 * recebe um caminho da API e um URL autenticado).
 * @returns {Promise<{ok:boolean, bytes?:Buffer, mime?:string, meta?:object, codigo?:string, erro?:string}>}
 */
export async function gerarImagem({ prompt, modelo = null, opcoes = {}, env = {}, fetchImpl = fetch } = {}) {
  const { largura, altura } = opcoes;
  const r = await gerarComPollinations({
    prompt,
    modelo: modelo || MODELOS_IMAGEM[0].id,
    largura: largura || 1024,
    altura: altura || 1024,
    env,
    fetchImpl,
    timeoutMs: 25000,
    orcamentoMs: 26000,
  });
  if (!r.ok) {
    return {
      ok: false,
      codigo: r.codigo || 'fornecedor',
      erro: r.erro || 'a imagem não veio',
      /* as tentativas dizem o que aconteceu sem expor chaves */
      tentativas: (r.tentativas || []).map((t) => ({ via: t.via, ok: !!t.ok, status: t.status || null, erro: t.erro || null })),
      ms: r.ms || 0,
    };
  }
  const base64 = String(r.dataUrl || '').split(',')[1] || '';
  const bytes = Buffer.from(base64, 'base64');
  return {
    ok: true,
    bytes,
    mime: r.mime || 'image/jpeg',
    meta: { via: r.via, modelo: r.modelo, seed: r.seed, largura: r.largura, altura: r.altura, bytes: bytes.length, ms: r.ms },
  };
}

/* ---------- vídeo: o que o servidor aceita de volta ---------- */

export const MAX_VIDEO_BYTES = 2_500_000;

/** O ficheiro que o browser compôs: confere-se tipo, tamanho e duração declarada. */
export function aceitarVideo({ mime, bytes, duracao = null } = {}) {
  const tipo = String(mime || '').split(';')[0].trim().toLowerCase();
  if (!['video/mp4', 'video/webm'].includes(tipo)) {
    return { ok: false, erro: `o ficheiro não é vídeo MP4 nem WebM (veio «${tipo || 'sem tipo'}»)` };
  }
  const tamanho = bytes?.length || 0;
  if (tamanho < 10_000) return { ok: false, erro: `o vídeo veio com ${tamanho} bytes — não é um ficheiro` };
  if (tamanho > MAX_VIDEO_BYTES) {
    return { ok: false, erro: `o vídeo veio com ${(tamanho / 1048576).toFixed(1)} MB (máx. ${(MAX_VIDEO_BYTES / 1048576).toFixed(1)} MB): grava mais curto ou em 720p` };
  }
  const d = Number(duracao);
  if (duracao !== null && duracao !== undefined && (!Number.isFinite(d) || d <= 0 || d > 20)) {
    return { ok: false, erro: `duração inválida (${duracao}) — o máximo composto é 20 s` };
  }
  return { ok: true, mime: tipo, bytes: bytes.length, duracao: Number.isFinite(d) && d > 0 ? +d.toFixed(2) : null };
}

/** O limite de bytes que o pedido pode ter (base64 cresce ~33%). */
export const MAX_PEDIDO_BYTES = Math.ceil(MAX_VIDEO_BYTES * 1.4) + 100_000;

export const _interno = { texto, MAX_VIDEO_BYTES };
