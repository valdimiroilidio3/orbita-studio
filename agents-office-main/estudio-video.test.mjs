/* ===========================================================================
   1.53.2 · O VÍDEO QUE SAI MESMO — a prova.

   O botão «Enviar ao estúdio» estava cinzento: o worker do OpenMontage precisa de
   Python + FFmpeg numa máquina que não é a Vercel. O dono pediu-o funcional.

   Aqui prova-se o motor que funciona sempre (a composição no browser), sem GPU,
   sem browser e sem rede:
     · o plano escolhe as peças APROVADAS primeiro, e ignora as que não têm bytes;
     · sem peças, não se grava nada — diz-se o que falta;
     · o contentor é o melhor que o browser souber (MP4 antes de WebM);
     · a gravação devolve um ficheiro com bytes, mime e duração verdadeiros;
     · um browser sem MediaRecorder/canvas é dito por palavras, não rebenta;
     · o cartão deixa de ter o botão morto (grep ao `src/cine.js`).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LIMITES, MIMES, escolherMime, nomeDoFicheiro, planoDoVideo,
  desenharPlano, renderizarVideo, resumoDoVideo,
} from './src/estudio-video.js';

const PECA = (n, extra = {}) => ({ id: `p${n}`, dataUrl: `data:image/png;base64,AAA${n}`, modelo: 'flux', ...extra });

/* ---------- o plano ---------- */

test('o plano entra com as peças aprovadas primeiro e só com as que têm bytes', () => {
  const plano = planoDoVideo({
    imagens: [
      PECA(1), PECA(2, { aprovada: true }), { id: 'vazia', dataUrl: null }, PECA(3, { aprovada: true }), { id: 'x', falhou: true },
    ],
    conceito: 'Uma cidade que respira devagar ao fim do dia.',
  });
  assert.equal(plano.ok, true);
  assert.deepEqual(plano.planos.map((p) => p.id), ['p2', 'p3', 'p1'], 'aprovadas à frente, depois o resto');
  assert.equal(plano.semBytes, 2, 'as peças sem bytes são contadas, não usadas');
  assert.equal(plano.largura, LIMITES.largura);
  assert.equal(plano.altura, LIMITES.altura);
  assert.ok(plano.duracao > 0);
  // o movimento alterna, para não parecer o mesmo plano repetido
  assert.deepEqual([...new Set(plano.planos.map((p) => p.movimento))], ['aproximar', 'afastar']);
});

test('sem peças não há plano — e a frase diz o que fazer', () => {
  const vazio = planoDoVideo({ imagens: [] });
  assert.equal(vazio.ok, false);
  assert.match(vazio.motivo, /ainda não há peças aprovadas/i);
  assert.equal(vazio.planos.length, 0);

  const semBytes = planoDoVideo({ imagens: [{ id: 'a', dataUrl: null }, { id: 'b' }] });
  assert.equal(semBytes.ok, false);
  assert.match(semBytes.motivo, /não têm bytes guardados/i);
});

test('o plano tem tecto: no máximo 6 planos e 20 segundos', () => {
  const muitas = Array.from({ length: 12 }, (_, i) => PECA(i + 1, { aprovada: true }));
  const plano = planoDoVideo({ imagens: muitas, segundosPorPlano: 9 });
  assert.equal(plano.planos.length, LIMITES.maxPlanos);
  assert.ok(plano.duracao <= LIMITES.maxSegundos, `duração ${plano.duracao} passou do tecto`);
});

/* ---------- o contentor ---------- */

test('o contentor é o melhor que o browser souber: MP4 antes de WebM', () => {
  assert.equal(escolherMime((m) => m === 'video/webm;codecs=vp8'), 'video/webm;codecs=vp8');
  assert.equal(escolherMime((m) => /mp4/.test(m)), MIMES[0], 'o MP4 com avc1 é a primeira escolha');
  assert.equal(escolherMime((m) => m === 'video/webm'), 'video/webm');
  assert.equal(escolherMime(() => false), null, 'sem nenhum suportado, não se inventa um');
  // um browser que rebenta ao responder não pode derrubar a escolha
  assert.equal(escolherMime(() => { throw new Error('nope'); }), null);
});

test('o nome do ficheiro segue a lead, a data e o contentor', () => {
  assert.equal(nomeDoFicheiro({ lead: 'Câmara Municipal de Coimbra', mime: 'video/mp4', quando: new Date('2026-10-29T10:00:00Z') }), 'camara-municipal-de-coimbra-2026-10-29.mp4');
  assert.equal(nomeDoFicheiro({ lead: '', mime: 'video/webm', quando: new Date('2026-01-02T00:00:00Z') }), 'projeto-2026-01-02.webm');
});

/* ---------- a gravação ---------- */

/** Um browser falso: canvas que conta fotogramas, MediaRecorder que junta pedaços. */
function browserFalso({ suporta = ['video/mp4'] } = {}) {
  const traco = { fotogramas: 0, start: 0, stop: 0, desenhos: [], mimeType: null, bitrate: null };
  class Grabador {
    static isTypeSupported(m) { return suporta.includes(m); }
    constructor(fluxo, opts = {}) { traco.mimeType = opts.mimeType; traco.bitrate = opts.videoBitsPerSecond; this.fluxo = fluxo; }
    start(ms) { traco.start = ms; setTimeout(() => this.ondataavailable?.({ data: new Blob(['a'.repeat(1234)]) }), 0); }
    stop() { traco.stop += 1; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['b'.repeat(5678)]) }); this.onstop?.(); }, 0); }
  }
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => { if (k === 'drawImage') traco.desenhos.push(args.slice(1)); };
    },
    set: () => true,
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx, captureStream: () => ({}) };
  const doc = {
    defaultView: { Image: class { set src(v) { this._src = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._src; } get width() { return 1600; } get height() { return 900; } } },
    createElement: () => canvas,
  };
  return { doc, Grabador, traco, canvas };
}

test('gravar devolve um ficheiro com bytes, mime e duração — não um player vazio', async () => {
  const { doc, Grabador, traco, canvas } = browserFalso({ suporta: ['video/mp4', 'video/webm'] });
  const plano = planoDoVideo({ imagens: [PECA(1, { aprovada: true }), PECA(2, { aprovada: true })], conceito: 'Luz de fim de tarde.' });
  let t = 0;
  const r = await renderizarVideo({
    plano, doc, Grabador,
    agora: () => (t += 40),
    espera: async () => {},
  });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.mime, 'video/mp4');
  assert.ok(r.bytes >= 1234 + 5678, `bytes inesperados: ${r.bytes}`);
  assert.equal(r.duracao, plano.duracao);
  assert.equal(canvas.width, LIMITES.largura);
  assert.equal(canvas.height, LIMITES.altura);
  assert.equal(traco.mimeType, 'video/mp4');
  assert.ok(traco.desenhos.length > 0, 'não desenhou plano nenhum');
  assert.equal(traco.stop, 1, 'a gravação tem de ser fechada');
});

test('um browser sem MediaRecorder diz porquê, em vez de rebentar', async () => {
  const { doc } = browserFalso();
  const plano = planoDoVideo({ imagens: [PECA(1)] });
  const r = await renderizarVideo({ plano, doc, Grabador: null });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /MediaRecorder/);

  const r2 = await renderizarVideo({ plano, doc, Grabador: class { static isTypeSupported() { return false; } } });
  assert.equal(r2.ok, false);
  assert.match(r2.motivo, /contentor/i);

  const r3 = await renderizarVideo({ plano: { ok: false, motivo: 'sem peças' }, doc });
  assert.equal(r3.ok, false);
  assert.match(r3.motivo, /sem peças/);
});

test('sem bytes gravados, o resultado é um erro dito — nunca um vídeo de zero', async () => {
  const { doc } = browserFalso();
  class SemBytes {
    static isTypeSupported() { return true; }
    start() {}
    stop() { setTimeout(() => this.onstop?.(), 0); }
  }
  const plano = planoDoVideo({ imagens: [PECA(1)] });
  /* o relógio TEM de andar: um relógio parado faria o plano nunca acabar (foi um
     OOM a sério neste teste, e a lição fica escrita) */
  let t = 0;
  const r = await renderizarVideo({ plano, doc, Grabador: SemBytes, agora: () => (t += 200), espera: async () => {} });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /não devolveu bytes/);
});

test('o resumo diz o que saiu, sem adjectivos', () => {
  const t = resumoDoVideo({ mime: 'video/mp4', bytes: 2 * 1024 * 1024, duracao: 5.2, ms: 4200, planos: 2 });
  assert.match(t, /MP4 · 2\.0 MB · 5\.2 s · 2 plano\(s\) · 4\.2 s a compor/);
});

test('desenharPlano põe a imagem em movimento e escreve o conceito', () => {
  const chamadas = [];
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...a) => chamadas.push([k, ...a]);
    },
    set: () => true,
  });
  const img = { width: 1600, height: 900 };
  desenharPlano(ctx, img, { largura: 1280, altura: 720, p: 0.5, movimento: 'aproximar', conceito: 'Uma cidade que respira', indice: 0, total: 2 });
  const desenhos = chamadas.filter((c) => c[0] === 'drawImage');
  assert.equal(desenhos.length, 1);
  const [, , x, y, w, h] = desenhos[0];
  assert.ok(w > 1280 && h > 720, 'o plano tem de estar ampliado para poder mover-se');
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
  assert.ok(chamadas.some((c) => c[0] === 'fillText'), 'o conceito tem de aparecer no fotograma');
});

/* ---------- o fio na interface ---------- */

test('cine.js: o botão do vídeo já não está morto nem chama só o worker', () => {
  const src = readFileSync(new URL('./src/cine.js', import.meta.url), 'utf8');
  assert.equal(/Enviar ao estúdio \(indisponível\)/.test(src), false, 'o rótulo do botão morto não pode voltar');
  assert.equal(/data-act="cine-video" \$\{v\.worker\?\.vivo \? '' : 'disabled'\}/.test(src), false, 'o botão já não depende do worker');
  assert.match(src, /accaoVideoCine/, 'tem de haver o despacho entre worker e composição local');
  const despacho = /export async function accaoVideoCine[\s\S]*?\n\}/.exec(src);
  assert.ok(despacho);
  assert.match(despacho[0], /v\?\.worker\?\.vivo/, 'com worker vai ao OpenMontage');
  assert.match(despacho[0], /renderizarVideoCine/, 'sem worker compõe aqui');
  // e o cartão mostra o leitor e a descarga quando há ficheiro
  const cartao = /function cartaoVideo\(S\)[\s\S]*?\n\}/.exec(src);
  assert.ok(cartao);
  assert.match(cartao[0], /<video src=/, 'o vídeo composto tem de aparecer no cartão');
  assert.match(cartao[0], /download=/, 'e tem de se poder descarregar');
});
