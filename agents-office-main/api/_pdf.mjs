/* ===========================================================================
   1.56.0 · UM PDF PEQUENO, SEM DEPENDÊNCIAS (2 nov 2026)

   A fatura tem de sair em PDF. As opções usuais eram: uma biblioteca de 2 MB no
   bundle de uma função serverless, ou «imprime no browser» — que não é um
   ficheiro e depende de quem está a olhar.

   Um PDF de texto é simples: objectos, um catálogo, páginas, um stream de
   conteúdo e uma tabela xref com os deslocamentos. É isso que está aqui — 200
   linhas, zero kilobytes de dependências, e o suficiente para uma fatura:
   Helvetica normal e negrito, texto posicionado, linhas e caixas.

   Limitações declaradas: só texto (sem imagens), uma fonte de cada peso, e o
   texto em WinAnsi (o que cobre o português: ã, ç, õ, €). Não é um motor de
   layout — é um gerador de documentos simples, e é usado só para isto.
   =========================================================================== */

const LARGURA = 595.28;   // A4 em pontos
const ALTURA = 841.89;

/** Escapa o texto para uma string literal de PDF (e codifica em WinAnsi). */
function literal(texto) {
  const limpo = String(texto ?? '')
    /* o euro, as aspas curvas e o travessão não existem em Latin-1 */
    .replace(/\u20ac/g, '\u0080')   // € em WinAnsi
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u00a0/g, ' ');
  return limpo.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Cria um documento vazio (uma página A4 por omissão). */
export function novoDocumento({ largura = LARGURA, altura = ALTURA, titulo = '', autor = '' } = {}) {
  return { largura, altura, titulo, autor, paginas: [[]], _pagina: 0 };
}

function paginaActual(doc) {
  if (!doc.paginas[doc._pagina]) doc.paginas[doc._pagina] = [];
  return doc.paginas[doc._pagina];
}

export function novaPagina(doc) {
  doc.paginas.push([]);
  doc._pagina = doc.paginas.length - 1;
  return doc;
}

/** Texto numa posição (origem no canto inferior esquerdo, como no PDF). */
export function texto(doc, { x = 50, y = 800, texto: t = '', tamanho = 10, negrito = false, cinza = null } = {}) {
  paginaActual(doc).push({
    tipo: 'texto', x, y, tamanho, negrito, cinza,
    texto: String(t ?? ''),
  });
  return doc;
}

/** Linha horizontal ou vertical. */
export function linha(doc, { x1 = 50, y1 = 800, x2 = 545, y2 = 800, espessura = 0.5, cinza = 0.6 } = {}) {
  paginaActual(doc).push({ tipo: 'linha', x1, y1, x2, y2, espessura, cinza });
  return doc;
}

/** Rectângulo (contorno ou preenchido). */
export function rectangulo(doc, { x = 50, y = 700, w = 495, h = 40, espessura = 0.7, preenchido = false, cinza = 0.92 } = {}) {
  paginaActual(doc).push({ tipo: 'rect', x, y, w, h, espessura, preenchido, cinza });
  return doc;
}

/** Converte um documento em bytes de PDF. */
export function render(doc) {
  const objectos = [];   // 1-based: objectos[n-1] é o objecto n
  const conteudos = doc.paginas.map((comandos) => {
    const partes = [];
    for (const c of comandos) {
      if (c.tipo === 'texto') {
        const fonte = c.negrito ? '/F2' : '/F1';
        const cinza = c.cinza == null ? '' : `${c.cinza} g `;
        partes.push(`BT ${cinza}${fonte} ${c.tamanho} Tf 1 0 0 1 ${c.x.toFixed(2)} ${c.y.toFixed(2)} Tm (${literal(c.texto)}) Tj ET`);
      } else if (c.tipo === 'linha') {
        partes.push(`q ${c.cinza} G ${c.espessura} w ${c.x1.toFixed(2)} ${c.y1.toFixed(2)} m ${c.x2.toFixed(2)} ${c.y2.toFixed(2)} l S Q`);
      } else if (c.tipo === 'rect') {
        const op = c.preenchido ? 'f' : 'S';
        partes.push(`q ${c.cinza} ${c.preenchido ? 'g' : 'G'} ${c.espessura} w ${c.x.toFixed(2)} ${c.y.toFixed(2)} ${c.w.toFixed(2)} ${c.h.toFixed(2)} re ${op} Q`);
      }
    }
    return partes.join('\n');
  });

  const nPaginas = conteudos.length;
  const idCatalogo = 1;
  const idInfo = 2;
  const idFonte1 = 3;
  const idFonte2 = 4;
  const idPrimeiraPagina = 5;
  const idPrimeiroConteudo = idPrimeiraPagina + nPaginas;
  const idPages = idPrimeiroConteudo + nPaginas;

  const idsPaginas = [];
  for (let i = 0; i < nPaginas; i += 1) idsPaginas.push(idPrimeiraPagina + i);

  const agora = new Date();
  const pdfData = `D:${agora.getUTCFullYear()}${String(agora.getUTCMonth() + 1).padStart(2, '0')}${String(agora.getUTCDate()).padStart(2, '0')}${String(agora.getUTCHours()).padStart(2, '0')}${String(agora.getUTCMinutes()).padStart(2, '0')}00Z`;

  objectos[idCatalogo] = `<< /Type /Catalog /Pages ${idPages} 0 R >>`;
  objectos[idInfo] = `<< /Title (${literal(doc.titulo)}) /Author (${literal(doc.autor)}) /Creator (Orbita) /CreationDate (${pdfData}) >>`;
  objectos[idFonte1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objectos[idFonte2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  for (let i = 0; i < nPaginas; i += 1) {
    const pageId = idPrimeiraPagina + i;
    const contId = idPrimeiroConteudo + i;
    objectos[pageId] = `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${doc.largura.toFixed(2)} ${doc.altura.toFixed(2)}] `
      + `/Resources << /Font << /F1 ${idFonte1} 0 R /F2 ${idFonte2} 0 R >> >> /Contents ${contId} 0 R >>`;
    const fluxo = conteudos[i];
    objectos[contId] = `<< /Length ${Buffer.byteLength(fluxo, 'latin1')} >>\nstream\n${fluxo}\nendstream`;
  }

  objectos[idPages] = `<< /Type /Pages /Count ${nPaginas} /Kids [${idsPaginas.map((n) => `${n} 0 R`).join(' ')}] >>`;

  /* monta o ficheiro, guardando o deslocamento de cada objecto para a xref */
  let saida = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const deslocamentos = [];
  for (let i = 1; i < objectos.length; i += 1) {
    deslocamentos[i] = Buffer.byteLength(saida, 'latin1');
    saida += `${i} 0 obj\n${objectos[i]}\nendobj\n`;
  }
  const inicioXref = Buffer.byteLength(saida, 'latin1');
  const total = objectos.length;   // inclui o objecto 0 (livre)
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < objectos.length; i += 1) {
    xref += `${String(deslocamentos[i]).padStart(10, '0')} 00000 n \n`;
  }
  saida += xref;
  saida += `trailer\n<< /Size ${total} /Root ${idCatalogo} 0 R /Info ${idInfo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(saida, 'latin1');
}

export const MEDIDAS = { LARGURA, ALTURA };
