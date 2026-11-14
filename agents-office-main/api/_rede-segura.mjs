/* ===========================================================================
   1.90 · REDE SEGURA — o servidor não lê endereços internos (SSRF)

   Onde se usa: a verificação de site de um lead e a leitura de documentos por
   URL. Ambas recebem um endereço escrito por uma pessoa e fariam o servidor
   pedir o que ela quisesse — incluindo a rede interna e o endereço de metadados
   da cloud (169.254.169.254).

   O que se verifica, por esta ordem:
     · só http e https;
     · o nome não é localhost, não é .local/.internal e não é de uma só palavra;
     · se o nome é um endereço IP, esse IP não é privado, reservado ou de loopback
       (IPv4 e IPv6, incluindo ::ffff:a.b.c.d);
     · se é um nome de domínio, TODOS os endereços a que ele resolve têm de ser
       públicos (um domínio público que aponte para 10.x é recusado);
     · cada redireccionamento volta a passar por tudo isto (até 3), porque um
       site público pode redireccionar para a rede de casa.

   Limite declarado: entre a verificação e o pedido há uma janela (DNS rebinding).
   Fecha-se por completo só com um agente de saída; aqui fica a verificação
   antes de cada salto.
   =========================================================================== */
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const NOMES_INTERNOS = /(^localhost$|\.localhost$|\.local$|\.localdomain$|\.internal$|\.lan$)/i;

/** IPv4 que não é público: rede privada, partilhada, loopback, link-local, reservado, multicast. */
export function ipv4Privado(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return true;          // 0/8, 10/8, 127/8
  if (a === 100 && b >= 64 && b <= 127) return true;          // 100.64/10 (partilhada)
  if (a === 169 && b === 254) return true;                    // link-local e metadados da cloud
  if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0/24 e 192.0.2/24
  if (a === 192 && b === 168) return true;                    // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true;       // 198.18/15 (testes)
  if (a === 198 && b === 51 && c === 100) return true;        // 198.51.100/24 (documentação)
  if (a === 203 && b === 0 && c === 113) return true;         // 203.0.113/24 (documentação)
  if (a >= 224) return true;                                  // multicast e reservado
  return false;
}

/** IPv6 que não é público. */
export function ipv6Privado(ip) {
  const x = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  if (x.startsWith('::ffff:')) {
    const resto = x.slice(7);
    if (isIP(resto) === 4) return ipv4Privado(resto);
    return true;
  }
  if (x === '::' || x === '::1') return true;
  const primeiro = parseInt(x.split(':')[0] || '0', 16);
  if (Number.isNaN(primeiro)) return true;
  if (primeiro >= 0xfc00 && primeiro <= 0xfdff) return true; // unique local (fc00::/7)
  if (primeiro >= 0xfe80 && primeiro <= 0xfebf) return true; // link-local (fe80::/10)
  if (primeiro >= 0xff00) return true;                       // multicast
  if (x.startsWith('2001:db8') || x.startsWith('2001:0db8')) return true; // documentação
  if (x.startsWith('64:ff9b:')) return true;                 // NAT64 (pode levar a IPv4 privado)
  return false;
}

export function ipPrivado(ip) {
  const v = isIP(String(ip));
  if (v === 4) return ipv4Privado(ip);
  if (v === 6) return ipv6Privado(ip);
  return true; // o que não é IP válido não se confia
}

/** Os endereços a que um nome resolve (todos). O teste injeta o seu próprio. */
export async function resolverPadrao(nome) {
  const linhas = await lookup(nome, { all: true, verbatim: true });
  return linhas.map((l) => l.address);
}

/**
 * Diz se um endereço pode ser lido pelo servidor. Devolve { ok, url, motivo }.
 * Nunca lança: um endereço mau é uma resposta, não uma avaria.
 */
export async function destinoSeguro(bruto, { resolver = resolverPadrao } = {}) {
  let u;
  try {
    u = new URL(/^https?:/i.test(String(bruto || '')) ? String(bruto) : `https://${String(bruto || '')}`);
  } catch {
    return { ok: false, motivo: 'endereço inválido' };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, motivo: 'só se lê por http ou https' };
  if (u.username || u.password) return { ok: false, motivo: 'endereço com credenciais — não se lê' };
  const nome = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!nome) return { ok: false, motivo: 'endereço sem domínio' };
  if (NOMES_INTERNOS.test(nome)) return { ok: false, motivo: 'endereço interno — não se lê a rede de casa' };
  if (isIP(nome)) {
    if (ipPrivado(nome)) return { ok: false, motivo: 'endereço privado ou reservado — não se lê' };
    return { ok: true, url: u };
  }
  if (!nome.includes('.')) return { ok: false, motivo: 'endereço sem domínio' };
  let enderecos;
  try {
    enderecos = await resolver(nome);
  } catch {
    return { ok: false, motivo: 'o endereço não resolve (o domínio pode ter acabado)' };
  }
  if (!Array.isArray(enderecos) || enderecos.length === 0) return { ok: false, motivo: 'o endereço não resolve' };
  if (enderecos.some((ip) => ipPrivado(ip))) {
    return { ok: false, motivo: 'o domínio aponta para um endereço privado — não se lê' };
  }
  return { ok: true, url: u };
}

/** Um erro que diz «bloqueado» e porquê — para a rota pôr a razão na ficha. */
function bloqueado(motivo) {
  return Object.assign(new Error(motivo), { bloqueado: true, motivo });
}

/**
 * Pede um endereço seguro, saltando redireccionamentos à mão para verificar cada um.
 * Lança com `bloqueado: true` quando um salto não pode ser lido.
 */
export async function buscarSeguro(bruto, {
  fetchImpl = fetch, resolver = resolverPadrao, maxRedirecionamentos = 3, ...opcoes
} = {}) {
  let atual = bruto;
  for (let salto = 0; ; salto += 1) {
    const d = await destinoSeguro(atual, { resolver });
    if (!d.ok) throw bloqueado(d.motivo);
    const r = await fetchImpl(d.url.toString(), { ...opcoes, redirect: 'manual' });
    const local = r && r.headers && typeof r.headers.get === 'function' ? r.headers.get('location') : null;
    if (r && r.status >= 300 && r.status < 400 && local) {
      if (salto >= maxRedirecionamentos) throw bloqueado('demasiados redireccionamentos');
      atual = new URL(local, d.url).toString();
      continue;
    }
    return r;
  }
}
