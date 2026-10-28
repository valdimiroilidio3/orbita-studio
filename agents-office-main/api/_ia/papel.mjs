/* ===========================================================================
   1.46.0 · LER PAPEL COM O NOSSO PRÓPRIO MOTOR DE VISÃO (28 out 2026)

   Pedido do dono: «Digitalizar papel podes colocar». Até aqui a digitalização
   existia mas estava sempre «desligada»: exigia um `ORBITA_OCR_URL` — Tesseract
   numa máquina, um sidecar, um serviço pago. Nenhum existia, e o painel dizia
   «falta o serviço de OCR». Era verdade e não servia para nada.

   A partir daqui o OCR é nosso: uma fotografia do papel entra como mensagem com
   imagem e o modelo de visão da cadeia (`tipo: 'visao'`) devolve o texto. Em
   produção, a 28 out 2026, há pelo menos um modelo de visão **sem chave** já
   provado a responder: `ovh/Qwen2.5-VL-72B-Instruct` (413 ms medidos).

   Regras, para não se mentir a ler papel:
     · o modelo recebe ordem para transcrever e NÃO interpretar;
     · se não houver texto legível responde `[SEM TEXTO]` e nós dizemos isso —
       nunca se devolve um texto inventado com ar de leitura;
     · o texto sai com o modelo e o tempo que o leram (para se saber a fonte);
     · nenhuma imagem fica guardada: vai no pedido e morre com ele.
   =========================================================================== */

/** A ordem dada ao modelo. Curta, explícita e em português. */
export const PROMPT_PAPEL = [
  'És um digitalizador. Recebes a fotografia de um papel (factura, recibo, cartão de visita, ficha, carta, nota manuscrita).',
  'Transcreve LITERALMENTE todo o texto visível, mantendo as linhas como estão.',
  'Não traduzas, não resumas, não expliques, não completes o que está cortado e não inventes nada.',
  'Se houver texto manuscrito, transcreve-o como conseguires ler; onde não conseguires, escreve [ilegível].',
  'Se a imagem não tiver texto nenhum, responde exactamente: [SEM TEXTO]',
  'Devolve apenas a transcrição, sem comentários e sem blocos de código.',
].join('\n');

/** Palavras que o modelo usa quando se recusa ou quando a imagem não serve. */
const SEM_TEXTO = /^\s*\[?\s*(sem texto|no text|não há texto|imagem sem texto)\s*\]?\s*\.?\s*$/i;

/** Tira cercas de código e espaço a mais, sem estragar as linhas do papel. */
export function limparTranscricao(bruto) {
  let t = String(bruto || '').trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  return t
    .replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trimEnd()).join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** As mensagens que se mandam ao motor: a ordem + a imagem. */
export function mensagensDePapel({ base64, mime = 'image/jpeg', objetivo = null } = {}) {
  const extra = objetivo && String(objetivo).trim()
    ? `\nO dono diz que este papel é: ${String(objetivo).trim().slice(0, 120)}. Isso não te autoriza a inventar — transcreve o que está.`
    : '';
  return [{
    role: 'user',
    content: [
      { type: 'text', text: `${PROMPT_PAPEL}${extra}` },
      { type: 'image', mime, base64 },
    ],
  }];
}

/**
 * Lê um documento com o motor de visão.
 *
 * @param {object} args
 * @param {string} args.base64  a imagem, sem o prefixo data:
 * @param {string} [args.mime]
 * @param {object} args.motor   um motor de `criarMotor` (tem de ter `pedir`)
 * @returns {Promise<{ok:boolean, texto:string, modelo:string|null, fornec:string|null,
 *                    ms:number, codigo:string|null, erro:string|null}>}
 */
export async function lerPapel({ base64, mime = 'image/jpeg', objetivo = null, motor, limite = 3, maxTokens = 4000 } = {}) {
  const t0 = Date.now();
  if (!base64) return { ok: false, texto: '', modelo: null, fornec: null, ms: 0, codigo: 'parametros', erro: 'não recebi imagem nenhuma' };
  if (!motor || typeof motor.pedir !== 'function') {
    return { ok: false, texto: '', modelo: null, fornec: null, ms: 0, codigo: 'semmotor', erro: 'não há motor de IA ligado para ler imagens' };
  }
  try {
    const r = await motor.pedir('visao', mensagensDePapel({ base64, mime, objetivo }), {
      /* 4000 tokens: uma factura com muitas linhas não cabe em 1200, e o corte
         a meio de uma linha é pior do que demorar mais um segundo */
      maxTokens, temperatura: 0, limite, agente: 'digitalizar',
    });
    const texto = limparTranscricao(r?.texto);
    const meta = { modelo: r?.modelo || null, fornec: r?.fornec || null, ms: Date.now() - t0 };
    if (!texto) {
      return { ok: false, texto: '', ...meta, codigo: 'vazio', erro: 'o modelo de visão não devolveu texto — a imagem pode estar desfocada, torta ou vazia' };
    }
    if (SEM_TEXTO.test(texto)) {
      return { ok: false, texto: '', ...meta, codigo: 'vazio', erro: 'não há texto legível nesta imagem' };
    }
    return { ok: true, texto, ...meta, codigo: null, erro: null };
  } catch (e) {
    const codigo = e?.codigo === 'semchave' || e?.codigo === 'semmodelo' ? 'semmotor'
      : e?.codigo === 'limite' ? 'limite-fornecedor'
        : e?.codigo === 'tempo' || e?.name === 'AbortError' ? 'timeout' : 'falha';
    return { ok: false, texto: '', modelo: null, fornec: null, ms: Date.now() - t0, codigo, erro: String(e?.message || e).slice(0, 300) };
  }
}

/**
 * Há caminho para ler papel neste ambiente? Não olha à base nem à rede: só ao
 * catálogo, às chaves e a um `ORBITA_OCR_URL` opcional. É o que a prontidão e o
 * `/digitalizar/estado` mostram — quem diz «sim» tem de ser verdade.
 */
export function caminhoDeLeitura(env = {}) {
  return String(env?.ORBITA_OCR_URL || '').trim()
    ? { via: 'ocr', nome: 'serviço de OCR configurado', semChave: false }
    : { via: 'visao', nome: 'motor de visão da cadeia (sem serviço externo)', semChave: true };
}
