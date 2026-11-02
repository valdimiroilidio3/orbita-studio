/* ===========================================================================
   1.56.0 · A FATURA (2 nov 2026) — A3

   O que havia: a receita entrava à mão no saldo, sem documento. O que um negócio
   precisa de entregar a um cliente é uma fatura: número, data, NIF, base, IVA,
   total — e, quando corre mal, uma nota de crédito que não deixa buracos na
   numeração.

   Regras que este ficheiro cumpre:

     · **número sem buracos** — o número é `máximo + 1` dentro da série (ano) e a
       inserção tem uma chave única `(serie, numero, tipo)`. Dois pedidos ao mesmo
       tempo: um ganha, o outro recebe o conflito e tenta outra vez com o número
       seguinte. Não se apaga nem se reutiliza uma fatura anulada — o número dela
       fica gasto, e a nota de crédito leva o sufixo `-NC`.
     · **IVA configurável** — 23 % (normal), 13 % (intermédia), 6 % (reduzida) ou
       0 % (isento, com motivo escrito no documento). Tudo em cêntimos inteiros:
       arredonda-se uma vez, no IVA da fatura.
     · **o NIF é validado** (dígito de controlo incluído). Sem NIF só com
       `consumidorFinal: true`, e então o documento diz isso — não se inventa um
       número para o papel parecer completo.
     · **PDF gerado aqui** (`_pdf.mjs`), sem bibliotecas: o mesmo documento que a
       pessoa descarrega é o que fica guardado.
     · **enviar por email** só quando há `RESEND_API_KEY`; sem ela diz-se qual é a
       variável que falta, e a fatura não fica marcada como enviada.
   =========================================================================== */
import { randomUUID } from 'node:crypto';
import { novoDocumento, novaPagina, texto, linha, rectangulo, render, MEDIDAS } from './_pdf.mjs';
/* 1.56.0 · o euro com separador de milhares, como se escreve num documento:
   «1.107,00 €». A função do saldo (`eurosDeCentimos`) é para ecrã e não agrupa;
   num papel, «1107,00» lê-se mal. */
export function eurosPT(centimos) {
  const c = Math.round(Number(centimos) || 0);
  const negativo = c < 0;
  const inteiro = Math.floor(Math.abs(c) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(Math.abs(c) % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}${inteiro},${dec} €`;
}

export const TAXAS_IVA = [23, 13, 6, 0];

export const MOTIVOS_ISENCAO = [
  'Isento — artigo 9.º do CIVA',
  'Isento — artigo 14.º do CIVA',
  'Não sujeito — regime especial de isenção',
];

/** Dígito de controlo do NIF português (módulo 11). */
export function nifValido(nif) {
  const s = String(nif || '').replace(/\s+/g, '');
  if (!/^\d{9}$/.test(s)) return false;
  if (!'12356789'.includes(s[0])) return false;
  let soma = 0;
  for (let i = 0; i < 8; i += 1) soma += Number(s[i]) * (9 - i);
  const resto = soma % 11;
  const check = resto < 2 ? 0 : 11 - resto;
  return check === Number(s[8]);
}

/** «2026/0001» */
export const codigoDe = (serie, numero) => `${serie}/${String(numero).padStart(4, '0')}`;

/** Base + IVA + total em cêntimos inteiros. Arredonda uma vez, no IVA. */
export function calcularTotais(baseCentimos, taxa = 23) {
  const base = Math.round(Number(baseCentimos) || 0);
  const t = Number(taxa);
  const iva = Math.round((base * t) / 100);
  return { baseCentimos: base, ivaTaxa: t, ivaCentimos: iva, totalCentimos: base + iva };
}

const falhaFatura = (status, mensagem, extra = {}) => Object.assign(new Error(mensagem), { status, corpo: { error: mensagem, ...extra } });

/** Normaliza as linhas do pedido e devolve a base em cêntimos. */
function linhasValidadas(brutas = []) {
  const lista = Array.isArray(brutas) ? brutas : [];
  if (!lista.length) throw falhaFatura(400, 'a fatura precisa de pelo menos uma linha (o que foi vendido)');
  const linhas = lista.map((l, i) => {
    const descricao = String(l?.descricao || l?.descricao || '').trim();
    if (!descricao) throw falhaFatura(400, `linha ${i + 1}: falta a descrição do que foi vendido`);
    const quantidade = l?.quantidade == null ? 1 : Number(l.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) throw falhaFatura(400, `linha ${i + 1}: a quantidade tem de ser maior do que zero`);
    const preco = l?.precoCentimos != null
      ? Math.round(Number(l.precoCentimos))
      : Math.round((Number(l?.precoEuros ?? l?.valorEuros ?? 0)) * 100);
    if (!Number.isFinite(preco) || preco < 0) throw falhaFatura(400, `linha ${i + 1}: o preço não pode ser negativo`);
    return { descricao, quantidade, precoCentimos: preco, totalCentimos: Math.round(quantidade * preco) };
  });
  const base = linhas.reduce((n, l) => n + l.totalCentimos, 0);
  if (base <= 0) throw falhaFatura(400, 'o total da fatura tem de ser maior do que zero');
  return { linhas, baseCentimos: base };
}

/**
 * Emite uma fatura. Devolve `{ ok, fatura }`; lança com `status`/`corpo` em erro.
 *
 * `repo.faturas.inserir` pode falhar com conflito de número (dois pedidos ao
 * mesmo tempo): nesse caso lê-se outra vez o máximo e tenta-se o número seguinte,
 * até cinco vezes — sem isso, um número repetido ou um buraco.
 */
export async function criarFatura(repo, dados = {}, { agora = () => new Date() } = {}) {
  const nome = String(dados?.cliente?.nome || dados?.clienteNome || '').trim();
  if (!nome) throw falhaFatura(400, 'a fatura precisa do nome do cliente');
  const nif = String(dados?.cliente?.nif || dados?.clienteNif || '').replace(/\s+/g, '');
  const consumidorFinal = !!dados?.consumidorFinal;
  if (nif && !nifValido(nif)) throw falhaFatura(400, `o NIF «${nif}» não tem um dígito de controlo válido`);
  if (!nif && !consumidorFinal) throw falhaFatura(400, 'falta o NIF do cliente — ou marca «consumidor final» para emitir sem NIF');
  const email = String(dados?.cliente?.email || dados?.clienteEmail || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw falhaFatura(400, `o email «${email}» não parece um email`);

  const taxa = Number(dados?.ivaTaxa ?? dados?.iva ?? 23);
  if (!TAXAS_IVA.includes(taxa)) throw falhaFatura(400, `o IVA tem de ser um destes: ${TAXAS_IVA.join(' %, ')} %`);
  if (taxa === 0 && !String(dados?.motivoIsencao || '').trim()) {
    throw falhaFatura(400, 'uma fatura isenta tem de dizer o motivo (ex.: «Isento — artigo 9.º do CIVA»)');
  }

  const { linhas, baseCentimos } = linhasValidadas(dados?.linhas);
  const totais = calcularTotais(baseCentimos, taxa);
  const data = agora();
  const serie = String(dados?.serie || data.getUTCFullYear());
  if (!/^\d{4}$/.test(serie)) throw falhaFatura(400, 'a série é o ano, com quatro dígitos (ex.: 2026)');

  const emitente = dados?.emitente || {};
  const nota = String(dados?.nota || '').trim();

  for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
    /* sem `catch`: se a tabela não existir, isto tem de rebentar com o nome do
       SQL em falta. Tratar a falha como «lista vazia» daria o número 1 outra vez
       e esconderia a causa atrás de um conflito de numeração. */
    const existentes = await repo.faturas.listar(5000);
    const daSerie = existentes.filter((f) => String(f.serie) === serie && f.tipo !== 'nota_credito');
    const numero = daSerie.reduce((n, f) => Math.max(n, Number(f.numero) || 0), 0) + 1;
    const fatura = {
      id: `f_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      serie, numero, codigo: codigoDe(serie, numero), tipo: 'fatura',
      estado: 'emitida',
      cliente_nome: nome, cliente_nif: nif || null, cliente_email: email || null,
      cliente_morada: String(dados?.cliente?.morada || dados?.clienteMorada || '').trim() || null,
      consumidor_final: !nif,
      linhas,
      iva_taxa: taxa,
      motivo_isencao: taxa === 0 ? String(dados.motivoIsencao).trim() : null,
      base_centimos: totais.baseCentimos,
      iva_centimos: totais.ivaCentimos,
      total_centimos: totais.totalCentimos,
      moeda: 'EUR',
      nota: nota || null,
      emitente_nome: String(emitente.nome || '').trim() || null,
      emitente_nif: String(emitente.nif || '').trim() || null,
      emitente_morada: String(emitente.morada || '').trim() || null,
      emitida_em: data.toISOString(),
      criado: data.toISOString(),
      enviada_em: null, enviada_para: null,
      fatura_origem: null,
    };
    try {
      const guardada = await repo.faturas.inserir(fatura);
      return { ok: true, fatura: guardada || fatura };
    } catch (e) {
      const conflito = e?.status === 409 || /duplicate|unique|23505/i.test(String(e?.message || ''));
      if (!conflito) throw e;
      /* outro pedido levou este número: lê outra vez e tenta o seguinte */
    }
  }
  throw falhaFatura(409, 'não consegui reservar um número de fatura depois de cinco tentativas — tenta outra vez');
}

/** Anula uma fatura e emite a nota de crédito (números negativos, mesmo número). */
export async function anularFatura(repo, id, motivo, { agora = () => new Date(), emitente = {} } = {}) {
  const f = await repo.faturas.porId(id);
  if (!f) throw falhaFatura(404, 'fatura não encontrada');
  if (f.tipo === 'nota_credito') throw falhaFatura(400, 'uma nota de crédito não se anula — emite-se outra fatura');
  if (f.estado === 'anulada') throw falhaFatura(409, 'esta fatura já foi anulada');
  const razao = String(motivo || '').trim();
  if (razao.length < 3) throw falhaFatura(400, 'diz o motivo da anulação (fica escrito na nota de crédito)');

  const data = agora();
  const original = await repo.faturas.patch(f.id, { estado: 'anulada', motivo_anulacao: razao, anulada_em: data.toISOString() });
  const nc = {
    ...f,
    id: `f_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
    tipo: 'nota_credito',
    estado: 'emitida',
    codigo: `${f.codigo}-NC`,
    base_centimos: -Math.abs(f.base_centimos),
    iva_centimos: -Math.abs(f.iva_centimos),
    total_centimos: -Math.abs(f.total_centimos),
    motivo_anulacao: razao,
    fatura_origem: f.id,
    emitida_em: data.toISOString(),
    criado: data.toISOString(),
    enviada_em: null, enviada_para: null,
    emitente_nome: String(emitente.nome || f.emitente_nome || '').trim() || null,
    emitente_nif: String(emitente.nif || f.emitente_nif || '').trim() || null,
    emitente_morada: String(emitente.morada || f.emitente_morada || '').trim() || null,
  };
  const guardada = await repo.faturas.inserir(nc);
  return { ok: true, fatura: original, notaCredito: guardada || nc };
}

/** Totais por mês e por cliente — o que o dono olha no fim do mês. */
export function resumoFaturas(lista = []) {
  const emitidas = lista.filter((f) => f.tipo !== 'nota_credito' && f.estado !== 'anulada');
  const anuladas = lista.filter((f) => f.tipo !== 'nota_credito' && f.estado === 'anulada');
  const notas = lista.filter((f) => f.tipo === 'nota_credito');
  const soma = (xs, campo) => xs.reduce((n, x) => n + (Number(x[campo]) || 0), 0);

  const porMes = new Map();
  const porCliente = new Map();
  for (const f of [...emitidas, ...notas]) {
    const mes = String(f.emitida_em || f.criado || '').slice(0, 7) || 'sem data';
    const m = porMes.get(mes) || { mes, baseCentimos: 0, ivaCentimos: 0, totalCentimos: 0, documentos: 0 };
    m.baseCentimos += Number(f.base_centimos) || 0;
    m.ivaCentimos += Number(f.iva_centimos) || 0;
    m.totalCentimos += Number(f.total_centimos) || 0;
    m.documentos += 1;
    porMes.set(mes, m);

    const c = porCliente.get(f.cliente_nome) || { cliente: f.cliente_nome, totalCentimos: 0, documentos: 0 };
    c.totalCentimos += Number(f.total_centimos) || 0;
    c.documentos += 1;
    porCliente.set(f.cliente_nome, c);
  }

  return {
    documentos: lista.length,
    emitidas: emitidas.length,
    anuladas: anuladas.length,
    notasCredito: notas.length,
    baseCentimos: soma(emitidas, 'base_centimos') + soma(notas, 'base_centimos'),
    ivaCentimos: soma(emitidas, 'iva_centimos') + soma(notas, 'iva_centimos'),
    totalCentimos: soma(emitidas, 'total_centimos') + soma(notas, 'total_centimos'),
    porMes: [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes)),
    porCliente: [...porCliente.values()].sort((a, b) => b.totalCentimos - a.totalCentimos),
    semDados: lista.length ? null : 'Ainda não há faturas emitidas. Uma fatura nasce de linhas escritas por ti — nada é inferido das entradas do saldo.',
  };
}

const linhaDeTexto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * O PDF da fatura. `emitente` vem do ambiente do pedido; sem NIF do emitente o
 * documento di-lo na cara («emitente por configurar») em vez de parecer válido.
 */
export function documentoDaFatura(f, { emitente = {}, agora = () => new Date() } = {}) {
  const doc = novoDocumento({ titulo: `${f.tipo === 'nota_credito' ? 'Nota de crédito' : 'Fatura'} ${f.codigo}`, autor: 'Órbita' });
  const L = MEDIDAS.LARGURA;
  const margem = 50;
  const direita = L - margem;
  let y = MEDIDAS.ALTURA - 60;

  const titulo = f.tipo === 'nota_credito' ? 'NOTA DE CRÉDITO' : 'FATURA';
  texto(doc, { x: margem, y, texto: titulo, tamanho: 20, negrito: true });
  texto(doc, { x: direita - 150, y, texto: f.codigo, tamanho: 16, negrito: true });
  y -= 18;
  texto(doc, { x: direita - 150, y, texto: `Emitida em ${String(f.emitida_em || '').slice(0, 10)}`, tamanho: 9, cinza: 0.35 });
  y -= 26;

  /* emitente */
  const em = {
    nome: linhaDeTexto(emitente.nome || f.emitente_nome || 'Emitente por configurar'),
    nif: linhaDeTexto(emitente.nif || f.emitente_nif || ''),
    morada: linhaDeTexto(emitente.morada || f.emitente_morada || ''),
    email: linhaDeTexto(emitente.email || ''),
  };
  texto(doc, { x: margem, y, texto: em.nome, tamanho: 11, negrito: true });
  y -= 13;
  if (em.nif) { texto(doc, { x: margem, y, texto: `NIF ${em.nif}`, tamanho: 9 }); y -= 12; }
  if (em.morada) { texto(doc, { x: margem, y, texto: em.morada, tamanho: 9 }); y -= 12; }
  if (em.email) { texto(doc, { x: margem, y, texto: em.email, tamanho: 9 }); y -= 12; }
  if (!em.nif) {
    texto(doc, { x: margem, y, texto: 'ATENÇÃO: falta ORBITA_EMITENTE_NIF no ambiente — este documento não identifica o emitente.', tamanho: 8, cinza: 0.2 });
    y -= 12;
  }

  /* cliente */
  y -= 12;
  rectangulo(doc, { x: margem, y: y - 46, w: direita - margem, h: 52, cinza: 0.85 });
  texto(doc, { x: margem + 10, y: y - 8, texto: 'Cliente', tamanho: 8, cinza: 0.4 });
  texto(doc, { x: margem + 10, y: y - 22, texto: f.cliente_nome, tamanho: 11, negrito: true });
  const linhaCliente = [
    f.cliente_nif ? `NIF ${f.cliente_nif}` : 'Consumidor final (sem NIF)',
    f.cliente_morada || '',
    f.cliente_email || '',
  ].filter(Boolean).join(' · ');
  texto(doc, { x: margem + 10, y: y - 36, texto: linhaCliente, tamanho: 9 });
  y -= 66;

  /* tabela */
  const colDesc = margem + 6;
  const colQtd = 380;
  const colPreco = 450;
  const colTotal = direita - 6;
  texto(doc, { x: colDesc, y, texto: 'Descrição', tamanho: 8, negrito: true, cinza: 0.3 });
  texto(doc, { x: colQtd - 20, y, texto: 'Qtd.', tamanho: 8, negrito: true, cinza: 0.3 });
  texto(doc, { x: colPreco - 30, y, texto: 'Preço', tamanho: 8, negrito: true, cinza: 0.3 });
  texto(doc, { x: colTotal - 45, y, texto: 'Total', tamanho: 8, negrito: true, cinza: 0.3 });
  y -= 6;
  linha(doc, { x1: margem, y1: y, x2: direita, y2: y });
  y -= 16;

  const euros = (c) => eurosPT(c);
  for (const l of f.linhas || []) {
    if (y < 160) { novaPagina(doc); y = MEDIDAS.ALTURA - 60; }
    texto(doc, { x: colDesc, y, texto: String(l.descricao).slice(0, 70), tamanho: 9 });
    texto(doc, { x: colQtd, y, texto: String(l.quantidade), tamanho: 9 });
    texto(doc, { x: colPreco - 30, y, texto: euros(l.precoCentimos), tamanho: 9 });
    texto(doc, { x: colTotal - 45, y, texto: euros(l.totalCentimos), tamanho: 9 });
    y -= 14;
  }

  /* totais */
  y -= 4;
  linha(doc, { x1: margem, y1: y, x2: direita, y2: y });
  y -= 18;
  const rotulo = (r, v, negrito = false) => {
    texto(doc, { x: 360, y, texto: r, tamanho: 9, negrito, cinza: negrito ? null : 0.35 });
    texto(doc, { x: colTotal - 45, y, texto: v, tamanho: 9, negrito });
    y -= 14;
  };
  rotulo('Base tributável', euros(f.base_centimos));
  if (Number(f.iva_taxa) === 0) {
    rotulo('IVA', 'Isento');
    if (f.motivo_isencao) { texto(doc, { x: 360, y, texto: String(f.motivo_isencao).slice(0, 48), tamanho: 8, cinza: 0.35 }); y -= 12; }
  } else {
    rotulo(`IVA (${f.iva_taxa} %)`, euros(f.iva_centimos));
  }
  y -= 2;
  rotulo('Total', euros(f.total_centimos), true);

  /* a razão da anulação, na fatura anulada e na nota de crédito */
  if (f.estado === 'anulada' || f.tipo === 'nota_credito') {
    y -= 10;
    const frase = f.tipo === 'nota_credito'
      ? `Anula a fatura ${String(f.codigo).replace(/-NC$/, '')}. Motivo: ${f.motivo_anulacao || '—'}`
      : `Fatura ANULADA. Motivo: ${f.motivo_anulacao || '—'}`;
    texto(doc, { x: margem, y, texto: frase.slice(0, 120), tamanho: 9, negrito: f.tipo !== 'nota_credito' });
    y -= 14;
  }

  if (f.nota) {
    y -= 10;
    texto(doc, { x: margem, y, texto: String(f.nota).slice(0, 110), tamanho: 8, cinza: 0.35 });
  }

  /* rodapé */
  texto(doc, { x: margem, y: 50, texto: `Documento emitido no Órbita · ${f.moeda || 'EUR'} · ${agora().toISOString().slice(0, 10)}`, tamanho: 7, cinza: 0.45 });
  texto(doc, { x: margem, y: 40, texto: 'Processado por programa. O IVA é calculado sobre a base tributável e arredondado ao cêntimo.', tamanho: 7, cinza: 0.45 });

  return render(doc);
}

/** O emitente, lido do ambiente (nunca do browser). */
export function emitenteDoAmbiente(env = {}) {
  return {
    nome: env.ORBITA_EMITENTE_NOME || env.ORBITA_NOME || '',
    nif: env.ORBITA_EMITENTE_NIF || '',
    morada: env.ORBITA_EMITENTE_MORADA || '',
    email: env.ORBITA_EMITENTE_EMAIL || '',
  };
}

/** Aviso honesto quando o emitente não está configurado. */
export function avisoEmitente(emitente = {}) {
  const faltam = ['nome', 'nif'].filter((k) => !String(emitente[k] || '').trim());
  if (!faltam.length) return null;
  const vars = { nome: 'ORBITA_EMITENTE_NOME', nif: 'ORBITA_EMITENTE_NIF', morada: 'ORBITA_EMITENTE_MORADA' };
  return `O emitente da fatura está incompleto: falta ${faltam.map((k) => vars[k]).join(' e ')} no ambiente. O PDF sai, mas sem esses dados não serve como documento fiscal.`;
}
