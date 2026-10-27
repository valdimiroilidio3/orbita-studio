/* ===========================================================================
   O cofre (1.25.0, 27 out 2026) — cifrar o que sai do servidor.

   O dono pediu: «depois criptografa tudo». Traduzido para o que aqui se pode
   fazer sem mentir:

     1. As chaves das APIs NÃO se guardam em ficheiros: vivem nas variáveis de
        ambiente da Vercel, que a plataforma guarda cifradas em repouso e nunca
        devolve ao browser. Este módulo não as toca.
     2. Uma cópia dos dados (leads, mensagens, receitas) pode agora sair do
        servidor CIFRADA — AES-256-GCM, com IV novo em cada cópia e etiqueta de
        autenticação. Quem não tiver a chave não lê nada, e uma cópia alterada
        não decifra.
     3. O que aparece em ecrãs e registos é sempre a versão mascarada.

   De onde vem a chave:
     · `ORBITA_CHAVE` (32 bytes em base64 ou hex), se existir; senão
     · derivada de `SUPABASE_SECRET_KEY` com HKDF-SHA256 (a chave que a base já
       usa). Isto evita inventar mais um segredo para o dono copiar, mas tem um
       custo dito em voz alta: se rodar a chave da base, as cópias antigas
       deixam de abrir. Se quiseres independência, define `ORBITA_CHAVE`.

   Sem chave nenhuma, isto não inventa: diz que não dá (`motivo`).
   =========================================================================== */
import crypto from 'node:crypto';

const FORMATO = 'orbita-cifrado/1';
const ALG = 'aes-256-gcm';

/** A chave mestra, ou a razão honesta de não haver. */
export function chaveMestre(env = process.env) {
  const crua = env.ORBITA_CHAVE || env.ORBITA_KEY;
  if (crua) {
    const t = String(crua).trim();
    let b = null;
    if (/^[0-9a-fA-F]{64}$/.test(t)) b = Buffer.from(t, 'hex');
    else {
      try { b = Buffer.from(t, 'base64'); } catch { b = null; }
      if (!b || b.length < 16) b = Buffer.from(t, 'utf8');
    }
    if (b && b.length >= 24) return { chave: crypto.createHash('sha256').update(b).digest(), fonte: 'ORBITA_CHAVE', motivo: null };
    return { chave: null, fonte: null, motivo: 'ORBITA_CHAVE existe mas não serve: usa 32 bytes em base64 ou 64 caracteres hexadecimais' };
  }
  const base = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (base) {
    const chave = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(base), 'utf8'), Buffer.from('orbita-cofre'), Buffer.from('orbita-cofre-v1'), 32));
    return { chave, fonte: 'derivada de SUPABASE_SECRET_KEY', motivo: null };
  }
  return { chave: null, fonte: null, motivo: 'não há chave: define ORBITA_CHAVE (32 bytes em base64) ou liga a base (SUPABASE_SECRET_KEY)' };
}

const b64 = (b) => Buffer.from(b).toString('base64');
const deB64 = (s) => Buffer.from(String(s || ''), 'base64');

/** Cifra um objecto JSON. Devolve um pacote que se pode guardar ou enviar. */
export function cifrar(dados, chave) {
  if (!chave) throw new Error('não há chave para cifrar');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALG, chave, iv);
  const claro = Buffer.from(JSON.stringify(dados), 'utf8');
  const partes = Buffer.concat([c.update(claro), c.final()]);
  return {
    formato: FORMATO,
    alg: ALG,
    iv: b64(iv),
    etiqueta: b64(c.getAuthTag()),
    bytes: partes.length,
    dados: b64(partes),
  };
}

/** Abre um pacote cifrado. Lança se a chave estiver errada ou algo foi alterado. */
export function decifrar(pacote, chave) {
  if (!chave) throw new Error('não há chave para decifrar');
  if (!pacote || pacote.formato !== FORMATO) throw new Error(`formato desconhecido (esperava ${FORMATO})`);
  if (pacote.alg !== ALG) throw new Error(`algoritmo desconhecido (esperava ${ALG})`);
  const d = crypto.createDecipheriv(ALG, chave, deB64(pacote.iv));
  d.setAuthTag(deB64(pacote.etiqueta));
  try {
    const claro = Buffer.concat([d.update(deB64(pacote.dados)), d.final()]);
    return JSON.parse(claro.toString('utf8'));
  } catch {
    throw new Error('não consegui abrir: a chave está errada ou a cópia foi alterada');
  }
}

/** Um resumo que permite comparar duas cópias sem as abrir. */
export const impressao = (pacote) => crypto.createHash('sha256').update(String(pacote?.dados || '')).digest('hex').slice(0, 16);

/** Mostra um segredo sem o revelar. */
export function mascarar(s) {
  const t = String(s || '');
  if (!t) return '';
  if (t.length < 8) return '••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}
