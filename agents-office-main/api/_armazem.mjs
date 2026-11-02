/* ===========================================================================
   1.54.3 · O ARMAZÉM DOS FICHEIROS GERADOS — 2 nov 2026

   Uma imagem ou um vídeo gerado não pode viver numa URL do fornecedor: essas
   URLs expiram, mudam de nome ou deixam de responder no dia seguinte. Também
   não pode viver no jsonb do briefing: 8 MB de bytes numa linha de configuração
   é uma base de dados a rebentar devagar.

   Este ficheiro é a fronteira do armazenamento — quem gera (api/_media.mjs)
   não sabe onde os bytes ficam:

     · com SUPABASE_URL + SUPABASE_SECRET_KEY: Supabase Storage, no bucket
       `orbita-media` (privado). O ficheiro só sai por /api/ops/media/:id/ficheiro,
       com sessão, e o bucket não é público;
     · sem chaves (modo local, testes): memória do processo, com a limitação
       escrita na cara — sobrevive à página, não sobrevive a um arranque novo.

   Regras:
     · nenhuma chave sai daqui (só cabeçalhos de servidor);
     · o caminho é sempre `projetos/<projeto>/<geração>.<ext>` — legível, sem
       dados pessoais, e apagável por prefixo;
     · o tipo e o tamanho conferem-se ANTES de guardar (ver api/_media.mjs).
   =========================================================================== */

export const BUCKET = 'orbita-media';

/** Extensão e tipo a partir do mime, sem adivinhar formatos que não existem. */
export const EXTENSOES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'image/gif': 'gif',
});

export const mimesAceites = () => Object.keys(EXTENSOES);

export function caminhoDe({ projetoId, geracaoId, mime }) {
  const ext = EXTENSOES[mime] || 'bin';
  const proj = String(projetoId || 'sem-projeto').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'sem-projeto';
  const ger = String(geracaoId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  return `projetos/${proj}/${ger}.${ext}`;
}

/* ---------- memória (testes e modo local) ---------- */
const MEMORIA = new Map();

export function armazemEmMemoria() {
  return {
    tipo: 'memoria',
    pronto: true,
    porque: 'sem base de armazenamento ligada: os ficheiros ficam na memória deste processo e perdem-se num arranque novo',
    async put(caminho, { bytes, mime }) {
      MEMORIA.set(caminho, { bytes: Buffer.from(bytes), mime });
      return { ok: true, caminho };
    },
    async get(caminho) {
      return MEMORIA.get(caminho) || null;
    },
    async remove(caminho) {
      return MEMORIA.delete(caminho);
    },
    async removePrefixo(prefixo) {
      let n = 0;
      for (const k of [...MEMORIA.keys()]) if (k.startsWith(prefixo)) { MEMORIA.delete(k); n += 1; }
      return n;
    },
  };
}

/** Limpa a memória (testes). Não é chamado em produção. */
export function limparMemoria() { MEMORIA.clear(); }

/* ---------- Supabase Storage ---------- */
export function armazemSupabase({ url, key, bucket = BUCKET, fetchImpl = fetch } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const cab = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    tipo: 'supabase',
    bucket,
    pronto: true,
    async put(caminho, { bytes, mime }) {
      let r;
      try {
        r = await fetchImpl(`${base}/storage/v1/object/${bucket}/${caminho}`, {
          method: 'POST',
          headers: { ...cab, 'Content-Type': mime, 'cache-control': 'max-age=31536000', 'x-upsert': 'true' },
          body: bytes,
        });
      } catch (e) {
        return { ok: false, erro: `o armazém não respondeu: ${String(e?.message || e).slice(0, 160)}` };
      }
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        /* a mensagem do Storage pode dizer «Bucket not found» — é a migração que
           falta, e diz-se assim, sem inventar outro motivo */
        const faltaBucket = /bucket/i.test(t) || r.status === 404;
        return {
          ok: false,
          erro: faltaBucket
            ? `o bucket «${bucket}» não existe: aplica supabase/orbita_1_54_3.sql (ou cria o bucket privado à mão)`
            : `o armazém recusou o ficheiro (HTTP ${r.status})`,
        };
      }
      return { ok: true, caminho };
    },
    async get(caminho) {
      let r;
      try {
        r = await fetchImpl(`${base}/storage/v1/object/${bucket}/${caminho}`, { headers: cab });
      } catch { return null; }
      if (!r.ok) return null;
      const mime = String(r.headers?.get?.('content-type') || 'application/octet-stream').split(';')[0].trim();
      return { bytes: Buffer.from(await r.arrayBuffer()), mime };
    },
    async remove(caminho) {
      try {
        const r = await fetchImpl(`${base}/storage/v1/object/${bucket}`, {
          method: 'DELETE',
          headers: { ...cab, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [caminho] }),
        });
        return r.ok;
      } catch { return false; }
    },
    async removePrefixo(prefixo) {
      try {
        const lista = await (await fetchImpl(`${base}/storage/v1/object/list/${bucket}`, {
          method: 'POST',
          headers: { ...cab, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: prefixo, limit: 1000 }),
        })).json();
        const caminhos = (Array.isArray(lista) ? lista : []).map((o) => `${prefixo}/${o.name}`);
        if (!caminhos.length) return 0;
        const r = await fetchImpl(`${base}/storage/v1/object/${bucket}`, {
          method: 'DELETE',
          headers: { ...cab, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: caminhos }),
        });
        return r.ok ? caminhos.length : 0;
      } catch { return 0; }
    },
  };
}

/**
 * O armazém deste ambiente. Decide-se uma vez por pedido, sem estado escondido.
 * @returns {{tipo:string, pronto:boolean, porque?:string, put:Function, get:Function, remove:Function}}
 */
export function criarArmazem({ env = process.env, fetchImpl = fetch } = {}) {
  const url = String(env?.SUPABASE_URL || '').trim();
  const key = String(env?.SUPABASE_SECRET_KEY || env?.SUPABASE_SERVICE_KEY || '').trim();
  const bucket = String(env?.ORBITA_MEDIA_BUCKET || '').trim() || BUCKET;
  if (url && key) return armazemSupabase({ url, key, bucket, fetchImpl });
  const mem = armazemEmMemoria();
  return { ...mem, porque: 'sem SUPABASE_URL/SUPABASE_SECRET_KEY: os ficheiros ficam na memória deste processo' };
}
