/* ===========================================================================
   1.53.2 · O VÍDEO QUE SAI MESMO — o render no browser.

   O botão «Enviar ao estúdio» estava cinzento porque o worker do OpenMontage
   (Python + FFmpeg + AGPL) não corre na Vercel. O dono: «ativa já isto, deixa
   bem funcional».

   A resposta tem dois motores, e este é o que funciona sempre:

     · OpenMontage (worker) — qualidade máxima, precisa de uma máquina tua;
     · este ficheiro         — compõe um vídeo REAL no browser, com as peças
                               aprovadas do projecto: movimento lento sobre cada
                               imagem, o conceito por cima, e um ficheiro que se
                               descarrega (MP4 onde o browser o souber gravar,
                               WebM onde não).

   O que aqui se garante:
     · é um ficheiro a sério — bytes, duração, mime — não um player decorativo;
     · só entram peças aprovadas (ou, na falta delas, as que têm bytes): nada se
       inventa;
     · sem peças, diz-se o que falta em vez de gravar um ecrã vazio;
     · a conta do plano (quais peças, por que ordem, quanto tempo) é pura e está
       provada em `estudio-video.test.mjs`; quem desenha é o browser.
   =========================================================================== */

export const LIMITES = Object.freeze({
  largura: 1280,
  altura: 720,
  maxPlanos: 6,
  segundosPorPlano: 2.6,
  maxSegundos: 20,
});

/** Os contentores que valem a pena, do melhor para o mais compatível. */
export const MIMES = Object.freeze([
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]);

/**
 * O primeiro contentor que este browser sabe gravar. `suporta` é
 * `MediaRecorder.isTypeSupported` (injectado para se poder provar).
 */
export function escolherMime(suporta = () => false) {
  for (const m of MIMES) {
    try { if (suporta(m)) return m; } catch { /* um browser estranho não decide nada */ }
  }
  return null;
}

/** O nome do ficheiro que o dono descarrega. */
export function nomeDoFicheiro({ lead = '', mime = 'video/webm', quando = new Date() } = {}) {
  const slug = String(lead || 'projeto').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projeto';
  const d = quando instanceof Date && !Number.isNaN(quando.getTime()) ? quando : new Date();
  const iso = d.toISOString().slice(0, 10);
  const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
  return `${slug}-${iso}.${ext}`;
}

/**
 * Que peças entram, por que ordem e durante quanto tempo.
 *
 * Regra das peças: primeiro as APROVADAS com bytes, depois as que têm bytes.
 * Uma peça sem `dataUrl` não entra (não há nada para desenhar) e é contada.
 */
export function planoDoVideo({ imagens = [], conceito = '', titulo = '', maxPlanos = LIMITES.maxPlanos, segundosPorPlano = LIMITES.segundosPorPlano } = {}) {
  const lista = Array.isArray(imagens) ? imagens : [];
  const comBytes = lista.filter((i) => i && typeof i.dataUrl === 'string' && i.dataUrl.startsWith('data:image/'));
  const aprovadas = comBytes.filter((i) => i.aprovada);
  const resto = comBytes.filter((i) => !i.aprovada);
  const escolhidas = [...aprovadas, ...resto].slice(0, Math.max(1, Number(maxPlanos) || LIMITES.maxPlanos));
  const semBytes = lista.length - comBytes.length;

  if (!escolhidas.length) {
    return {
      ok: false,
      planos: [], duracao: 0, largura: LIMITES.largura, altura: LIMITES.altura,
      motivo: lista.length
        ? 'as peças deste projecto não têm bytes guardados (foram geradas e limpas): gera outra peça antes de fazer vídeo'
        : 'ainda não há peças aprovadas: gera e aprova pelo menos uma imagem antes de fazer vídeo',
      semBytes,
    };
  }

  const porPlano = Math.min(4, Math.max(1.2, Number(segundosPorPlano) || LIMITES.segundosPorPlano));
  const duracao = Math.min(LIMITES.maxSegundos, +(porPlano * escolhidas.length).toFixed(2));
  return {
    ok: true,
    planos: escolhidas.map((i, k) => ({
      id: i.id || `peca-${k + 1}`,
      dataUrl: i.dataUrl,
      modelo: i.modelo || null,
      aprovada: !!i.aprovada,
      segundos: porPlano,
      /* o movimento alterna: entrar a aproximar, sair a afastar — dá ritmo e
         evita que seis planos pareçam o mesmo plano seis vezes */
      movimento: k % 2 === 0 ? 'aproximar' : 'afastar',
    })),
    duracao,
    largura: LIMITES.largura,
    altura: LIMITES.altura,
    conceito: String(conceito || '').trim().slice(0, 220),
    titulo: String(titulo || '').trim().slice(0, 80),
    larguraLegenda: true,
    semBytes,
    mime: null, // preenchido por quem grava (depende do browser)
  };
}

/** Carrega um `data:` numa imagem que o canvas aceita. */
function carregarImagem(doc, dataUrl) {
  return new Promise((resolve, reject) => {
    /* o construtor vem do documento quando ele tem janela; num documento
       solto (jsdom, iframe já fechado) vale a `Image` global */
    const Construtor = (doc && doc.defaultView && doc.defaultView.Image)
      || (typeof Image !== 'undefined' ? Image : null);
    if (!Construtor) { reject(new Error('este ambiente não sabe carregar imagens')); return; }
    const img = new Construtor();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('uma das peças não abriu no canvas'));
    img.src = dataUrl;
  });
}

/**
 * Desenha um plano no canvas (Ken Burns + legenda). Separado para poder ser
 * olhado sem gravar nada.
 * `p` vai de 0 a 1 ao longo do plano.
 */
export function desenharPlano(ctx, img, { largura, altura, p = 0, movimento = 'aproximar', conceito = '', indice = 0, total = 1 } = {}) {
  const escalaBase = Math.max(largura / img.width, altura / img.height);
  const zoom = movimento === 'afastar' ? 1.12 - 0.12 * p : 1 + 0.12 * p;
  const w = img.width * escalaBase * zoom;
  const h = img.height * escalaBase * zoom;
  const x = (largura - w) / 2 + (movimento === 'afastar' ? (p - 0.5) * 30 : -(p - 0.5) * 30);
  const y = (altura - h) / 2 + (p - 0.5) * 18;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(img, x, y, w, h);

  // véu em baixo, para o texto ler-se sobre qualquer imagem
  const grad = ctx.createLinearGradient(0, altura * 0.55, 0, altura);
  grad.addColorStop(0, 'rgba(6,8,11,0)');
  grad.addColorStop(1, 'rgba(6,8,11,0.86)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, altura * 0.55, largura, altura * 0.45);

  if (conceito) {
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.font = '600 34px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const max = largura - 120;
    const palavras = conceito.split(/\s+/);
    const linhas = [];
    let linha = '';
    for (const palavra of palavras) {
      const teste = linha ? `${linha} ${palavra}` : palavra;
      if (ctx.measureText(teste).width > max && linha) { linhas.push(linha); linha = palavra; } else { linha = teste; }
      if (linhas.length === 2) break;
    }
    if (linha && linhas.length < 3) linhas.push(linha);
    linhas.slice(0, 3).forEach((l, k) => ctx.fillText(l, 60, altura - 96 + k * 40));
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 16px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`${indice + 1} / ${total}`, 60, 52);
}

/**
 * Grava o plano num ficheiro.
 *
 * Injeções (para o teste poder correr sem GPU e sem browser):
 *   `doc`      — o `document`; `Grabador` — a classe MediaRecorder;
 *   `agora`    — relógio (ms); `espera` — `(ms) => Promise`.
 *
 * Devolve `{ ok, blob, mime, bytes, duracao, ms }` ou `{ ok:false, motivo }`.
 */
export async function renderizarVideo({
  plano, doc = (typeof document !== 'undefined' ? document : null), Grabador = (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null),
  agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  espera = (ms) => new Promise((r) => setTimeout(r, ms)), fps = 30,
} = {}) {
  if (!plano || !plano.ok) return { ok: false, motivo: (plano && plano.motivo) || 'não há plano para gravar' };
  if (!doc) return { ok: false, motivo: 'este ambiente não tem canvas: o vídeo faz-se no browser' };
  if (!Grabador) return { ok: false, motivo: 'este browser não sabe gravar vídeo (MediaRecorder ausente)' };
  const mime = escolherMime((m) => (Grabador.isTypeSupported ? Grabador.isTypeSupported(m) : false));
  if (!mime) return { ok: false, motivo: 'este browser não tem nenhum contentor de vídeo que saiba gravar' };

  const { largura, altura, planos, duracao } = plano;
  const canvas = doc.createElement('canvas');
  canvas.width = largura; canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, motivo: 'o canvas não abriu neste browser' };

  const inicio = agora();
  const fluxo = canvas.captureStream ? canvas.captureStream(fps) : null;
  if (!fluxo) return { ok: false, motivo: 'o canvas não deixa capturar imagem neste browser' };
  const grabador = new Grabador(fluxo, { mimeType: mime, videoBitsPerSecond: 3_500_000 });
  const pedacos = [];
  grabador.ondataavailable = (e) => { if (e && e.data && e.data.size) pedacos.push(e.data); };
  const parado = new Promise((resolve) => { grabador.onstop = () => resolve(); });

  try {
    grabador.start(250);
    for (let k = 0; k < planos.length; k++) {
      const p = planos[k];
      const img = await carregarImagem(doc, p.dataUrl);
      const t0 = agora();
      const durMs = p.segundos * 1000;
      /* ~24 imagens por segundo de plano: suave e leve. O tecto de fotogramas é a
         rede de segurança: um relógio que não anda (aba em segundo plano, browser
         estranho) não pode transformar isto num ciclo infinito. */
      const maxFrames = Math.ceil(p.segundos * 30) + 5;
      for (let frame = 0; frame < maxFrames; frame++) {
        const t = (agora() - t0) / durMs;
        if (t >= 1) break;
        desenharPlano(ctx, img, {
          largura, altura, p: t, movimento: p.movimento,
          conceito: plano.conceito, indice: k, total: planos.length,
        });
        await espera(1000 / 24);
      }
    }
    await espera(120); // o último fotograma tem de entrar no ficheiro
  } finally {
    try { grabador.stop(); } catch { /* já parado */ }
  }
  await parado;
  const blob = new Blob(pedacos, { type: mime.split(';')[0] });
  if (!blob.size) return { ok: false, motivo: 'o browser não devolveu bytes: nada foi gravado' };
  return { ok: true, blob, mime, bytes: blob.size, duracao, ms: Math.round(agora() - inicio) };
}

/** Uma frase honesta sobre o que saiu: motor, formato, tamanho e duração. */
export function resumoDoVideo({ mime = '', bytes = 0, duracao = 0, ms = 0, planos = 0 } = {}) {
  const mb = bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '—';
  const seg = duracao ? `${duracao.toFixed(1)} s` : '—';
  const formato = /mp4/.test(mime) ? 'MP4' : /webm/.test(mime) ? 'WebM' : (mime || '—');
  return `${formato} · ${mb} · ${seg} · ${planos} plano(s)${ms ? ` · ${(ms / 1000).toFixed(1)} s a compor` : ''}`;
}
