/* ===========================================================================
   Digitalizar — papel e imagem para dados, com revisão humana (27 out 2026 · 1.31.0)

   Pedido do dono: «que sejam capazes de … digitalizar qualquer coisa». Aqui
   «qualquer coisa» quer dizer: uma fotografia de uma factura, de um cartão de
   visita, de uma ficha de cliente ou de um documento em PDF.

   Como está feito, e porque não é magia:

      imagem / PDF  →  OCR (adaptador trocável)  →  texto
                                                        │
                                                        ▼
                                        regras determinísticas (NIF com
                                        dígito de controlo, telefone PT,
                                        email, código postal, IBAN, valores)
                                                        │
                                                        ▼
                                     campos com origem e confiança, e o que
                                     faltou dito por palavras
                                                        │
                                                        ▼
                                     revisão humana → lead no funil

   O que este módulo NÃO faz:
     · não adivinha o que o OCR não leu (campo ausente = ausente);
     · não manda documentos para fora sem um fornecedor configurado — sem
       `ORBITA_OCR_URL` a resposta diz exactamente o que falta;
     · não grava nada no funil sozinho. `paraLead` devolve uma proposta; quem
       grava é uma pessoa, com o texto à frente.
   =========================================================================== */

const MAX_BYTES = 6 * 1024 * 1024;              // 6 MB: uma foto de telemóvel cabe; um scan de 40 páginas não
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'application/pdf']);

const limpo = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/* No texto do OCR as quebras de linha são informação (a linha 1 é o cabeçalho,
   a última pode ser a morada). Aqui arruma-se o espaço sem as destruir. */
const arrumar = (s) => String(s ?? '')
  .replace(/\r\n?/g, '\n')
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
  .replace(/\n{3,}/g, '\n\n').trim();

/** O que está configurado, sem revelar chaves nem endereços privados. */
export function estado(env = process.env) {
  const url = limpo(env.ORBITA_OCR_URL);
  return {
    ocr: {
      disponivel: !!url,
      env: 'ORBITA_OCR_URL',
      motivo: url ? null : 'falta ORBITA_OCR_URL no ambiente — é o serviço que transforma a imagem em texto (Tesseract, PaddleOCR, um sidecar teu).',
      oQue: 'recebe a imagem em base64 e devolve { texto } ou { text }',
      limites: { bytesPorDocumento: MAX_BYTES, formatos: [...MIMES] },
      docs: 'https://github.com/tesseract-ocr/tesseract',
    },
    regras: {
      oQue: 'extrai NIF (com dígito de controlo), telefone português, email, código postal, IBAN, valores em euros e datas',
      precisaDe: 'nada — corre local, sem rede',
    },
    privacidade: 'o documento só sai da máquina se ORBITA_OCR_URL apontar para fora; os campos extraídos nunca entram no registo de actividade',
  };
}

/* ---------- leitura do pedido ---------- */

function descodificarBase64(bruto) {
  const t = String(bruto || '').trim();
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(t);
  if (m) return { mime: m[1].toLowerCase(), base64: m[2].replace(/\s/g, '') };
  return { mime: null, base64: t.replace(/^base64,/, '').replace(/\s/g, '') };
}

const bytesDe = (base64) => Math.floor((String(base64).length * 3) / 4) - (String(base64).match(/=+$/)?.[0].length || 0);

/**
 * Pede o texto ao serviço de OCR. Um pedido, com prazo, e nada do documento
 * fica em memória depois da resposta.
 */
export async function lerTexto({ base64, mime, env = process.env, fetchImpl = fetch, segundos = 45 }) {
  const url = limpo(env.ORBITA_OCR_URL);
  if (!url) {
    const e = new Error(estado(env).ocr.motivo);
    e.codigo = 'semchave';
    throw e;
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), segundos * 1000);
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ imagem: { base64, mime }, idioma: 'pt', saida: 'texto' }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const e = new Error(`o serviço de OCR respondeu HTTP ${r.status}`);
      e.codigo = r.status === 429 ? 'limite-fornecedor' : 'falha';
      throw e;
    }
    const j = await r.json();
    const texto = arrumar(j?.texto || j?.text || j?.data?.texto || '');
    /* alguns serviços devolvem páginas: junta-se pela ordem, sem inventar quebras */
    const paginas = Array.isArray(j?.paginas) ? j.paginas.map((p) => arrumar(p?.texto || p)).filter(Boolean) : null;
    const final = texto || (paginas ? paginas.join('\n\n') : '');
    return { texto: final, paginas: paginas ? paginas.length : null, confianca: Number.isFinite(j?.confianca) ? j.confianca : null };
  } catch (e) {
    if (e?.name === 'AbortError') {
      const tempo = new Error(`o OCR não respondeu em ${segundos} s`);
      tempo.codigo = 'timeout';
      throw tempo;
    }
    throw e;
  } finally { clearTimeout(t); }
}

/* ---------- as regras: determinísticas, testáveis, sem rede ---------- */

/** Dígito de controlo do NIF/NIPC português (módulo 11). */
export function nifValido(n) {
  const s = String(n || '').replace(/\D/g, '');
  if (s.length !== 9) return false;
  if (/^0/.test(s)) return false;
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(s[i]) * (9 - i);
  const resto = soma % 11;
  const digito = resto < 2 ? 0 : 11 - resto;
  return digito === Number(s[8]);
}

const telefoneValido = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 9 && d.length <= 15;
};

const normalizarTelefone = (s) => {
  const bruto = String(s || '').replace(/[^\d+]/g, '');
  const d = bruto.replace(/\D/g, '');
  if (d.length === 9 && /^[239]/.test(d)) return `+351${d}`;
  if (d.length === 12 && d.startsWith('351')) return `+${d}`;
  return bruto.startsWith('+') ? `+${d}` : d;
};

/**
 * Extrai campos do texto. Nada é inventado: cada campo diz de onde veio
 * (`origem: 'texto'`) e com que confiança, e o que não aparece fica de fora.
 */
export function extrairCampos(textoBruto) {
  const texto = String(textoBruto || '');
  const campos = [];
  const juntar = (campo, valor, confianca, extra = {}) => {
    if (!valor) return;
    if (campos.some((c) => c.campo === campo && c.valor === valor)) return;
    campos.push({ campo, valor, origem: 'texto', confianca, ...extra });
  };

  /* NIF: nove dígitos isolados, validados pelo dígito de controlo */
  const nifs = [...texto.matchAll(/(?<![\d.])(\d{9})(?![\d.])/g)].map((m) => m[1]).filter(nifValido);
  if (nifs.length) juntar('nif', nifs[0], 0.95, { controlo: 'digito-mod11' });

  const email = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/i.exec(texto)?.[0];
  if (email) juntar('email', email.toLowerCase(), 0.95);

  /* IBAN antes do telefone: senão os dígitos do IBAN entram como telefone */
  const iban = /PT50[\s\d]{21,30}/i.exec(texto)?.[0]?.replace(/\s/g, '').toUpperCase();
  if (iban && /^PT50\d{21}$/.test(iban)) {
    juntar('iban', `${iban.slice(0, 4)} ${iban.slice(4, 8)} •••• ${iban.slice(-4)}`, 0.9, { mascarado: true });
  }

  const semNif = nifs.reduce((t, n) => t.replace(n, ' '), texto)
    .replace(/PT50[\s\d]{21,30}/gi, ' ');

  const telefones = [...semNif.matchAll(/(?:\+?351[\s.-]?)?([239]\d{2}[\s.-]?\d{3}[\s.-]?\d{3})\b/g)]
    .map((m) => normalizarTelefone(m[1]))
    .filter(telefoneValido);
  if (telefones.length) juntar('telefone', telefones[0], 0.9, { normalizado: true });
  if (telefones.length > 1) juntar('telefone_alternativo', telefones[1], 0.75);

  const internacional = /(\+\d{2}[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{2,4})/.exec(semNif)?.[1];
  if (internacional && !telefones.length) juntar('telefone', normalizarTelefone(internacional), 0.8);

  const postal = /\b(\d{4}-\d{3})\b/.exec(texto)?.[1];
  if (postal) juntar('codigo_postal', postal, 0.9);

  const valor = /(\d{1,3}(?:[ .]\d{3})*[.,]\d{2})\s*(?:€|EUR)/i.exec(texto)?.[1];
  if (valor) juntar('valor', valor.replace(/\s/g, '').replace(',', '.'), 0.85, { moeda: 'EUR' });

  const data = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/.exec(texto)?.[1];
  if (data) juntar('data', data, 0.8);

  /* o nome: a primeira linha com duas palavras e sem dígitos, quando existe */
  const linhas = texto.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  /* sem pontuação final e sem dígitos: uma frase não é um nome de empresa */
  const nome = linhas.find((l) => /^[A-ZÀ-Ý][\p{L}'´-]+(\s+[\p{L}'´-]+){1,4}$/u.test(l) && !/\d/.test(l) && l.length <= 60);
  if (nome) juntar('nome', nome, 0.55, { heuristica: 'primeira linha com aspecto de nome' });

  return campos;
}

const campo = (campos, nome) => campos.find((c) => c.campo === nome)?.valor || null;

/* ---------- a operação ---------- */

let contador = 0;
const novoId = () => {
  contador += 1;
  return `doc_${Date.now().toString(36)}_${contador.toString(36)}`;
};

/**
 * Digitaliza um documento. Aceita base64 (`imagem`) ou um `url` http(s).
 * Devolve sempre o mesmo envelope, mesmo quando falha — a interface não tem
 * de adivinhar o que aconteceu.
 */
export async function digitalizar(args = {}, { env = process.env, fetchImpl = fetch, repo = null, agora = new Date() } = {}) {
  const base = { ok: false, id: null, tipo: 'documento', texto: '', caracteres: 0, campos: [], faltam: [], avisos: [], ms: 0, erro: null, codigo: null, real: true, inferido: false };
  const t0 = Date.now();
  const fim = (extra) => {
    const r = { ...base, ...extra, ms: Date.now() - t0 };
    if (repo?.atividade?.add) {
      /* sem o texto e sem os campos: o registo diz o que aconteceu, não o que estava no papel */
      repo.atividade.add('digitalizacao', `documento ${r.id || '—'}: ${r.ok ? `${r.campos.length} campo(s)` : `falhou (${r.codigo})`}`).catch(() => {});
    }
    return r;
  };

  const fonte = args.imagem || args.base64 || args.file || null;
  const url = limpo(args.url || args.link);
  if (!fonte && !url) return fim({ codigo: 'parametros', erro: 'envia a imagem em base64 (`imagem`) ou um `url` http(s)' });

  let base64 = null;
  let mime = limpo(args.mime || args.tipo).toLowerCase() || null;

  try {
    if (fonte) {
      const d = descodificarBase64(fonte);
      base64 = d.base64;
      mime = mime || d.mime;
      if (!/^[A-Za-z0-9+/=]+$/.test(base64.slice(0, 200))) {
        return fim({ codigo: 'parametros', erro: 'o `imagem` não parece base64 válido' });
      }
    } else {
      let u;
      try { u = new URL(url); } catch { return fim({ codigo: 'parametros', erro: 'o `url` não é um endereço válido' }); }
      if (!/^https?:$/.test(u.protocol)) return fim({ codigo: 'parametros', erro: 'só se lê documentos por http(s)' });
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20_000);
      let r;
      try {
        r = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'image/*,application/pdf' } });
      } finally { clearTimeout(t); }
      if (!r.ok) return fim({ codigo: 'falha', erro: `não consegui descarregar o documento (HTTP ${r.status})` });
      const buf = typeof r.arrayBuffer === 'function' ? new Uint8Array(await r.arrayBuffer()) : null;
      if (!buf) return fim({ codigo: 'falha', erro: 'o servidor não devolveu bytes legíveis' });
      if (buf.length > MAX_BYTES) return fim({ codigo: 'parametros', erro: `o documento tem ${Math.round(buf.length / 1024 / 1024)} MB — o máximo é 6 MB` });
      base64 = Buffer.from(buf).toString('base64');
      mime = mime || (r.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase() || null;
    }

    if (!base64) return fim({ codigo: 'parametros', erro: 'documento vazio' });
    const tamanho = bytesDe(base64);
    if (tamanho > MAX_BYTES) return fim({ codigo: 'parametros', erro: `o documento tem ${Math.round(tamanho / 1024 / 1024)} MB — o máximo é 6 MB` });
    if (mime && !MIMES.has(mime)) return fim({ codigo: 'parametros', erro: `formato não suportado (${mime}) — aceito ${[...MIMES].join(', ')}` });

    const lido = await lerTexto({ base64, mime: mime || 'image/jpeg', env, fetchImpl });
    if (!limpo(lido.texto)) {
      return fim({ codigo: 'vazio', erro: 'o OCR não encontrou texto — a imagem pode estar desfocada, torta ou vazia' });
    }

    const campos = extrairCampos(lido.texto);
    const essenciais = ['nome', 'telefone', 'email'];
    const faltam = essenciais.filter((c) => !campo(campos, c));
    const id = novoId();

    return fim({
      ok: true,
      id,
      texto: lido.texto.slice(0, 20_000),
      caracteres: lido.texto.length,
      paginas: lido.paginas,
      confiancaOcr: lido.confianca,
      campos,
      faltam,
      tamanhoBytes: tamanho,
      mime: mime || null,
      revisao: 'pendente',
      quando: agora.toISOString(),
      avisos: [
        ...(faltam.length ? [`não encontrei ${faltam.join(', ')} no documento — confirma à mão`] : []),
        ...(lido.texto.length > 20_000 ? ['o texto foi cortado aos primeiros 20 000 caracteres'] : []),
        'cada campo vem do texto lido; nada foi completado por inferência',
      ],
    });
  } catch (e) {
    const codigo = e?.codigo === 'semchave' ? 'semchave'
      : e?.codigo === 'timeout' || e?.name === 'AbortError' ? 'timeout'
        : e?.codigo === 'limite-fornecedor' ? 'limite-fornecedor' : 'falha';
    return fim({ codigo, erro: String(e?.message || e).slice(0, 300) });
  }
}

/**
 * Propõe um lead a partir dos campos. NÃO grava: devolve o que daria um lead,
 * com as lacunas à vista, para alguém confirmar antes de entrar no funil.
 */
export function paraLead(campos = [], { nome = null } = {}) {
  const lista = Array.isArray(campos) ? campos : [];
  const nomeFinal = limpo(nome) || campo(lista, 'nome') || null;
  const telefone = campo(lista, 'telefone');
  const email = campo(lista, 'email');
  const zona = campo(lista, 'codigo_postal');
  const notas = [
    campo(lista, 'nif') && `NIF ${campo(lista, 'nif')}`,
    campo(lista, 'valor') && `valor ${campo(lista, 'valor')} €`,
    campo(lista, 'data') && `data ${campo(lista, 'data')}`,
    campo(lista, 'iban') && `IBAN ${campo(lista, 'iban')}`,
    zona && `CP ${zona}`,
    'vindo de documento digitalizado',
  ].filter(Boolean).join(' · ');

  return {
    lead: { name: nomeFinal, phone: telefone, email, city: null, notes: notas },
    pronto: !!nomeFinal,
    faltaNome: !nomeFinal,
    fonte: 'digitalizacao',
    aviso: nomeFinal ? null : 'o documento não deixou um nome legível — escreve o nome antes de guardar',
  };
}
