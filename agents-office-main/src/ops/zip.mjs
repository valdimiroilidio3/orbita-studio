// Órbita — um ZIP mínimo (método «store», sem compressão), sem dependências.
//
// Existe por uma razão prática: uma entrega tem de sair do servidor. Com isto, o dono leva os
// ficheiros gerados para qualquer alojamento sem instalar nada. As entradas são escritas à mão
// segundo a especificação PKZIP (APPNOTE 6.3): cabeçalho local, directório central e EOCD. O
// bit 11 do campo de flags marca os nomes como UTF-8, para os acentos não se perderem.
import { createHash } from 'node:crypto';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

/** Data/hora no formato MS-DOS (2 s de resolução). */
function dosTime(date = new Date()) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xFFFF;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
  return { time, day };
}

/**
 * Constrói o ZIP. `entries` é uma lista de `{ name, data }` (Buffer ou string).
 * Devolve um Buffer — sem escrever no disco, para se poder testar.
 */
export function zipBuffer(entries, { at = new Date() } = {}) {
  const { time, day } = dosTime(at);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/^\/+/, ''), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // versão necessária
    local.writeUInt16LE(0x0800, 6);      // UTF-8
    local.writeUInt16LE(0, 8);           // store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // versão que criou
    central.writeUInt16LE(20, 6);        // versão necessária
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);        // extra
    central.writeUInt16LE(0, 32);        // comentário
    central.writeUInt16LE(0, 34);        // disco
    central.writeUInt16LE(0, 36);        // atributos internos
    central.writeUInt32LE(0, 38);        // atributos externos
    central.writeUInt32LE(offset, 42);   // offset do cabeçalho local
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const out = Buffer.concat([...locals, centralBuf, end]);
  return { buffer: out, sha256: createHash('sha256').update(out).digest('hex') };
}
