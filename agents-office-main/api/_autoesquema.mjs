/* ===========================================================================
   1.76.0 · O ESQUEMA DA PORTA QUE SE APLICA A SI PRÓPRIO (6 nov 2026)

   O dono clicou «Continuar com GitHub», o GitHub deixou-o entrar, e a Órbita
   respondeu:

     a base de dados recusou a conta do dono: falta a tabela «orbita_contas»:
     o esquema não foi aplicado — a correcção está em supabase/orbita_mesa.sql

   Duas verdades nessa frase: o esquema da porta nunca foi aplicado à base, e a
   correcção apontada era o ficheiro errado (as contas nascem em
   `orbita_1_54_0.sql`, não na mesa).

   A terceira verdade é a que importa: **a entrada não pode depender de alguém
   correr SQL à mão**. Uma instalação de um dono só, com o `POSTGRES_URL` já na
   Vercel, tem tudo o que precisa para criar as duas tabelas que lhe faltam —
   e o SQL é idempotente (`create table if not exists` / `add column if not
   exists`), por isso aplicá-lo duas vezes não faz mal a ninguém.

   Aqui não se inventa esquema nenhum: aplicam-se os ficheiros versionados no
   repositório, os mesmos que o `/api/setup` aplica, um por transacção (ver
   `_esquema.mjs`). E só se aplicam quando a base diz, por palavras dela, que a
   tabela ou a coluna não existe (`semEsquema`).
   =========================================================================== */
import { aplicarEsquema } from './_esquema.mjs';

/** Os ficheiros que criam e completam a porta (contas + sessões). */
export const FICHEIROS_DA_PORTA = ['orbita_1_54_0.sql', 'orbita_1_54_1.sql', 'orbita_1_69_0.sql', 'orbita_1_77_0.sql'];

/** A porta vive nestas duas tabelas. Só se mexe no esquema por causa delas. */
export const TABELAS_DA_PORTA = new Set(['orbita_contas', 'orbita_sessoes']);

/**
 * Este erro é «falta o esquema da porta»?
 *
 * Aceita o erro já traduzido pelo `_repo.explificar` (com `semEsquema`) e o
 * erro cru do PostgREST. Sem esta distinção, uma base em baixo (rede, chave
 * errada) também dispararia DDL — e isso não se faz às cegas.
 */
export function faltaEsquemaDaPorta(erro) {
  if (!erro) return false;
  const texto = String(erro.message || erro.mensagem || erro || '');
  const tabela = String(erro.tabela || '');
  if (erro.semEsquema) return !tabela || TABELAS_DA_PORTA.has(tabela);
  /* 1.77.0 · a regra ANTIGA numa coluna que já existe. A sonda da 1.76.0 só via
     colunas que faltam, por isso um `hash not null` da 1.54.0 passava despercebido
     e só se descobria ao escrever — com o erro cru do Postgres no ecrã do dono.
     Este caso é esquema, não é dado: nenhum utilizador escreve `hash`. */
  if (/null value in column\s+"?([\w]+)"?/i.test(texto) && /violates not-null/i.test(texto)) {
    const coluna = (texto.match(/null value in column\s+"?([\w]+)"?/i) || [])[1] || '';
    const rel = (texto.match(/of relation\s+"?(?:public\.)?([\w]+)"?/i) || [])[1] || '';
    return coluna === 'hash' && (!rel || TABELAS_DA_PORTA.has(rel));
  }
  return /orbita_contas|orbita_sessoes/i.test(texto)
    && /does not exist|Could not find the table|não existe/i.test(texto);
}

/** Vai à base por `pg` (o `POSTGRES_URL` que a integração do Supabase já põe lá). */
export async function abrirLigacao(env = {}) {
  const bruto = env.DATABASE_URL || env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!bruto) throw new Error('falta DATABASE_URL/POSTGRES_URL no ambiente — sem isso não há como aplicar o esquema');
  /* a URL da Vercel traz `sslmode=…`, que exige verificação da cadeia e dá
     «self-signed certificate in certificate chain»: os parâmetros saem e a
     decisão de SSL fica explícita (é o mesmo que o `/api/setup` faz) */
  const u = new URL(bruto);
  for (const k of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey']) u.searchParams.delete(k);
  const { default: pg } = await import('pg');
  const cliente = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await cliente.connect();
  return cliente;
}

/**
 * Aplica os ficheiros da porta. Devolve sempre um resultado — nunca lança — para
 * que quem chama possa continuar e mostrar o erro original se isto falhar.
 */
export async function aplicarEsquemaDaPorta(env = {}, { ligar = abrirLigacao, aplicar = aplicarEsquema, log = () => {} } = {}) {
  let cliente = null;
  try {
    cliente = await ligar(env);
  } catch (e) {
    return { ok: false, aplicados: [], erro: `não consegui ligar à base: ${e.message}`, fase: 'ligação' };
  }
  try {
    const r = await aplicar(cliente, { ficheiros: FICHEIROS_DA_PORTA, log });
    return { ...r, fase: r.ok ? 'aplicado' : 'sql' };
  } catch (e) {
    return { ok: false, aplicados: [], erro: String(e.message || e), fase: 'sql' };
  } finally {
    try { await cliente.end?.(); } catch { /* a ligação já pode estar morta */ }
  }
}

/**
 * O curador: garante, no máximo uma vez por processo (e por janela), que a base
 * tem as tabelas e as colunas da porta — e, se não tiver, aplica-as.
 *
 * - `sonda()` pergunta à base pelas colunas que o código usa; se a tabela ou a
 *   coluna faltar, o erro diz isso (`semEsquema`).
 * - Uma promessa partilhada evita que dez pedidos ao mesmo tempo corram o DDL
 *   dez vezes.
 * - O resultado bom fica em memória `ttl` ms: uma ida à base por processo, não
 *   por pedido.
 */
export function criarCurador({
  env = () => process.env, ligar = abrirLigacao, aplicar = aplicarEsquema, log = () => {}, ttl = 5 * 60 * 1000, agora = Date.now,
} = {}) {
  let emCurso = null;
  let bomAte = 0;

  async function garantir(repo, envDoPedido = null) {
    if (!repo) return { ok: false, motivo: 'sem repositório' };
    /* a memória (testes, modo local) nunca precisa de esquema */
    if (repo.tipo === 'memoria') return { ok: true, memoria: true };
    if (agora() < bomAte) return { ok: true, emCache: true };
    if (emCurso) return emCurso;

    const e = envDoPedido || env() || {};
    emCurso = (async () => {
      /* a sonda pode não existir num repositório antigo: nesse caso conta */
      const sonda = typeof repo.contas?.sonda === 'function'
        ? () => repo.contas.sonda()
        : () => repo.contas.contar();
      try {
        await sonda();
        bomAte = agora() + ttl;
        return { ok: true, jaEstava: true };
      } catch (erro) {
        if (!faltaEsquemaDaPorta(erro)) {
          return { ok: false, motivo: String(erro.message || erro), semEsquema: false };
        }
        log(`esquema da porta em falta (${erro.tabela || 'contas'}) — a aplicar ${FICHEIROS_DA_PORTA.join(', ')}`);
        const r = await aplicarEsquemaDaPorta(e, { ligar, aplicar, log });
        if (!r.ok) return { ...r, semEsquema: true, erroOriginal: String(erro.message || erro) };
        /* e confirma-se: aplicar sem verificar seria outra promessa vazia */
        try {
          await sonda();
          bomAte = agora() + ttl;
          return { ...r, aplicadoAgora: true };
        } catch (ainda) {
          return { ...r, ok: false, erro: `apliquei o esquema mas a base continua a recusar: ${ainda.message}`, fase: 'verificação' };
        }
      }
    })().finally(() => { emCurso = null; });

    return emCurso;
  }

  garantir.esquecer = () => { bomAte = 0; emCurso = null; };
  return garantir;
}

/** O curador de produção: um por processo da função. */
export const garantirEsquemaDaPorta = criarCurador({});
