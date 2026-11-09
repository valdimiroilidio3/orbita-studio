/* ===========================================================================
   1.17.0 · A BASE DE DADOS A SÉRIO (30 out 2026)

   A mesa já falava `/api`; o que faltava era um `/api` que existisse em produção.
   Este módulo é a única porta para o Postgres do Supabase: fala REST (PostgREST)
   com a chave secreta, que vive só na Vercel — o browser nunca a vê.

   Porquê REST e não `pg`: a chave que existe é a secreta do Supabase (formato
   `sb_secret_…`), não uma password de Postgres. O PostgREST dá-nos o mesmo
   resultado sem abrir um socket, e a função da Vercel fica mais leve.

   Duas implementações da MESMA interface:
     · createSupabaseRepo — a base real;
     · createMemRepo      — memória, para os testes provarem as rotas sem rede.
   =========================================================================== */

import { camposDeCusto } from './_dinheiro.mjs';   // 1.55.0: o custo de cada chamada

const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const chaveLead = (nome, cidade) => `${semAcentos(nome)}|${semAcentos(cidade)}`;

export function envBase(env = process.env) {
  const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '');
  return { url, key, pronto: !!(url && key) };
}

/* ---------- o que o PostgREST quis dizer (1.44.6) ---------- */

/* As colunas que nasceram no 1.37.0. Em 28 out 2026, o `/api/health` dizia
   «falta o esquema (corre supabase/orbita_mesa.sql)» quando o que faltava era a
   coluna `subject` em `orbita_messages` — e a mesa não precisava de ser tocada.
   A mensagem mandava para o ficheiro errado, e custou uma sessão inteira a
   descobrir. Agora o erro nomeia a coluna, a tabela e o ficheiro certo. */
/* 1.69.0 · as colunas da entrada (código por email e o fornecedor de OAuth).
   Sem esta lista, o erro do PostgREST dizia «falta o esquema» sem nomear o
   ficheiro — e a resposta já sabe qual é. */
export const COLUNAS_DO_1_69 = new Set(['codigo_hash', 'codigo_expira', 'codigo_tentativas', 'oauth_fornecedor', 'oauth_id']);

const COLUNAS_DO_1_37 = new Set([
  'subject', 'to', 'from', 'provider', 'provider_id', 'enviada_at', 'recebida_at',
  'entregue_at', 'lido_at', 'rejeitada_at', 'erro', 'canal_confirmado', 'direction', 'id_externo',
  'responded_at', 'rating', 'reviews', 'score_reasons', 'consent',
]);

/** 1.76.0 · as tabelas da porta: contas e sessões nascem em `orbita_1_54_0.sql`.
 *  Antes desta lista, a falta de `orbita_contas` mandava para `orbita_mesa.sql`
 *  — o ficheiro errado, que não cria conta nenhuma. */
export const TABELAS_DA_PORTA = new Set(['orbita_contas', 'orbita_sessoes']);

/** E as colunas que chegaram depois: confirmação (1.54.1) e entrada (1.69.0). */
export const COLUNAS_DA_PORTA = {
  confirmado_em: 'orbita_1_54_1.sql', confirmar_hash: 'orbita_1_54_1.sql', confirmar_expira: 'orbita_1_54_1.sql',
  codigo_hash: 'orbita_1_69_0.sql', codigo_expira: 'orbita_1_69_0.sql', codigo_tentativas: 'orbita_1_69_0.sql',
  oauth_fornecedor: 'orbita_1_69_0.sql', oauth_id: 'orbita_1_69_0.sql',
  hash: 'orbita_1_54_0.sql', papel: 'orbita_1_54_0.sql', activo: 'orbita_1_54_0.sql',
  recuperar_hash: 'orbita_1_54_0.sql', recuperar_expira: 'orbita_1_54_0.sql',
  token_hash: 'orbita_1_54_0.sql', conta_id: 'orbita_1_54_0.sql', expira: 'orbita_1_54_0.sql', revogada: 'orbita_1_54_0.sql',
};

/** As tabelas que vivem no `orbita_ia.sql` (e não na mesa). */
export const TABELAS_DA_IA = new Set(['orbita_ai_config', 'orbita_ai_runs', 'orbita_ai_steps', 'orbita_ai_uso', 'orbita_ai_memoria', 'orbita_media_jobs']);

/**
 * Traduz um erro do PostgREST para uma frase que diz o que fazer.
 * Devolve sempre `{mensagem, semEsquema, tabela, coluna, ficheiro}`.
 */
export function explificar(texto = '', dados = null) {
  const msg = String(texto || '');
  const codigo = String((dados && dados.code) || '');
  const coluna = (msg.match(/column\s+(?:"?[\w]+"?\.)?"?(\w+)"?\s+does not exist/i) || [])[1] || null;
  let tabela = (msg.match(/relation\s+"?(?:public\.)?(\w+)"?\s+does not exist/i) || [])[1]
    || (msg.match(/Could not find the table\s+'?(?:public\.)?(\w+)'?/i) || [])[1]
    || null;
  if (coluna) {
    /* «column orbita_messages.subject does not exist»: a tabela vem antes do ponto */
    tabela = tabela || (msg.match(/column\s+"?(?:public\.)?(\w+)"?\./i) || [])[1] || null;
  }
  const semColuna = codigo === '42703' || !!coluna;
  const semTabela = codigo === '42P01' || codigo === 'PGRST205' || (!!tabela && /does not exist|Could not find/i.test(msg));
  if (!semColuna && !semTabela) return { mensagem: msg, semEsquema: false, tabela: null, coluna: null, ficheiro: null };

  let ficheiro = null;
  if (semColuna && coluna && COLUNAS_DO_1_69.has(coluna)) ficheiro = 'orbita_1_69_0.sql';
  if (semColuna && coluna && COLUNAS_DO_1_37.has(coluna)) ficheiro = 'orbita_1_37_0.sql';
  if (semTabela && tabela && TABELAS_DA_PORTA.has(tabela)) ficheiro = 'orbita_1_54_0.sql';
  if (semColuna && coluna && COLUNAS_DA_PORTA[coluna]) ficheiro = COLUNAS_DA_PORTA[coluna];
  if (semTabela && tabela && TABELAS_DA_IA.has(tabela)) ficheiro = 'orbita_ia.sql';
  if (semTabela && tabela && !ficheiro) ficheiro = 'orbita_mesa.sql';
  const onde = tabela ? `«${tabela}»` : 'uma tabela da base';
  const dica = ficheiro ? ` — a correcção está em supabase/${ficheiro}` : ' — ver /api/setup?token=…&ler=1 para o esquema real';
  /* a palavra «esquema» fica na frase de propósito: é o que quem lê procura, e
     é o que o `/api/rpc` já mostra como «falta o esquema». O que muda é que
     agora diz QUAL peça e QUAL ficheiro. */
  return {
    mensagem: semColuna
      ? `falta a coluna «${coluna}» em ${onde}: o esquema está desactualizado${dica}`
      : `falta a tabela ${onde}: o esquema não foi aplicado${dica}`,
    semEsquema: true, tabela, coluna, ficheiro,
  };
}

/* ---------- a base real ---------- */
export function createSupabaseRepo({ url, key, fetchImpl = fetch } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!base || !key) throw new Error('faltam SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente');

  async function pedir(caminho, { method = 'GET', body, prefer, head = false } = {}) {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    let r;
    try {
      r = await fetchImpl(`${base}/rest/v1/${caminho}`, {
        method: head ? 'HEAD' : method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw Object.assign(new Error(`sem ligação à base: ${e.message}`), { status: 503 });
    }
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
    if (!r.ok) {
      const msg = (dados && (dados.message || dados.hint || dados.error)) || texto || `HTTP ${r.status}`;
      const explicado = explificar(msg, dados);
      throw Object.assign(new Error(explicado.mensagem), {
        status: explicado.semEsquema ? 503 : r.status,
        semEsquema: explicado.semEsquema,
        coluna: explicado.coluna, tabela: explicado.tabela, ficheiro: explicado.ficheiro,
        detalhe: dados,
      });
    }
    return dados;
  }
  const q = (v) => encodeURIComponent(v);
  const um = (linhas) => (Array.isArray(linhas) ? linhas[0] || null : linhas || null);

  return {
    tipo: 'supabase',
    async health() {
      /* 1.56.0 · orbita_faturas entra na lista: sem ela o health não a via e a
         fatura falhava só à primeira emissão. */
      /* 1.76.0 · `orbita_contas` e `orbita_sessoes` entram na lista. Sem elas o
         health dizia «falta orbita_faturas» com a ENTRADA partida — e foi assim
         que o dono descobriu, pelo login e não pelo health, que a base não
         tinha contas. A prova pública tem de olhar para a porta também. */
      const tabelas = ['orbita_leads', 'orbita_projects', 'orbita_tasks', 'orbita_messages', 'orbita_receitas', 'orbita_atividade', 'orbita_faturas', 'orbita_contas', 'orbita_sessoes'];
      const faltam = [];
      for (const t of tabelas) {
        try { await pedir(`${t}?select=id&limit=1`, { head: false }); }
        catch (e) { if (e.semEsquema) faltam.push(t); else throw e; }
      }
      /* 1.41.0 · a saúde passou a olhar para as COLUNAS do envio, não só para as tabelas.
         O `1.37.0` acrescentou `subject`, `to`, `from`, `provider` e as datas a
         `orbita_messages`; sem elas o SELECT `*` responde 200 e o INSERT rebenta com 400
         («column does not exist») — foi o que aconteceu em produção. Um `select` das
         colunas certas prova o esquema inteiro sem escrever nada. */
      let mensagensProntas = null, mensagensErro = null;
      try {
        await pedir('orbita_messages?select=id,subject,%22to%22,%22from%22,provider,enviada_at,recebida_at&limit=1');
        mensagensProntas = true;
      } catch (e) {
        if (e.semEsquema) { mensagensProntas = false; mensagensErro = e.message; }
        else throw e;
      }
      return {
        ok: faltam.length === 0 && mensagensProntas !== false,
        base: base.replace(/^https?:\/\//, '').split('.')[0],
        faltam,
        mensagensProntas,
        ...(mensagensErro ? { mensagensErro } : {}),
      };
    },

    /* ---- 1.54.0 · a porta: contas e sessões ----
       `hash` só sai daqui por `porEmail`/`porId`, que o login usa; nenhuma rota
       pública os devolve (ver `publico()` em `_conta.mjs`). */
    contas: {
      async listar() {
        return (await pedir('orbita_contas?select=id,email,nome,papel,activo,criado,ultimo_acesso&order=criado.asc&limit=200')) || [];
      },
      async contar() {
        const r = await pedir('orbita_contas?select=id&limit=1');
        return (Array.isArray(r) ? r.length : 0);
      },
      async porEmail(email) {
        return um(await pedir(`orbita_contas?select=*&email=eq.${q(String(email || '').trim().toLowerCase())}&limit=1`));
      },
      async porId(id) { return um(await pedir(`orbita_contas?select=*&id=eq.${q(id)}&limit=1`)); },
      /* 1.76.0 · a sonda da porta: pede À BASE as colunas que o código usa.
         Uma tabela em falta ou uma coluna por migrar aparecem aqui como
         `semEsquema` — e é isso que autoriza aplicar o esquema (ver
         `_autoesquema.mjs`). Um `select=*` não servia: não falta uma coluna que
         ninguém pede. */
      async sonda() {
        const colunas = [
          'id', 'email', 'nome', 'papel', 'hash', 'activo',
          'recuperar_hash', 'recuperar_expira',
          'confirmado_em', 'confirmar_hash', 'confirmar_expira',
          'codigo_hash', 'codigo_expira', 'codigo_tentativas', 'oauth_fornecedor', 'oauth_id',
        ].join(',');
        await pedir(`orbita_contas?select=${colunas}&limit=1`);
        await pedir('orbita_sessoes?select=id,conta_id,token_hash,expira,revogada&limit=1');
        return true;
      },
      async criar(c) { return um(await pedir('orbita_contas', { method: 'POST', body: c, prefer: 'return=representation' })); },
      async actualizar(id, campos) {
        return um(await pedir(`orbita_contas?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' }));
      },
    },
    sessoes: {
      async criar(s) { return um(await pedir('orbita_sessoes', { method: 'POST', body: s, prefer: 'return=representation' })); },
      async porHash(h) {
        return um(await pedir(`orbita_sessoes?select=*&token_hash=eq.${q(h)}&limit=1`));
      },
      async listar(limite = 50) {
        return (await pedir(`orbita_sessoes?select=*&order=criado.desc&limit=${Math.min(200, limite)}`)) || [];
      },
      async actualizar(id, campos) {
        return um(await pedir(`orbita_sessoes?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' }));
      },
      async revogar(id) {
        return um(await pedir(`orbita_sessoes?id=eq.${q(id)}`, {
          method: 'PATCH', body: { revogada: new Date().toISOString() }, prefer: 'return=representation',
        }));
      },
    },

    leads: {
      async list(limit = 200) {
        return (await pedir(`orbita_leads?select=*&order=created_at.desc&limit=${Math.min(500, limit)}`)) || [];
      },
      async byId(id) { return um(await pedir(`orbita_leads?select=*&id=eq.${q(id)}&limit=1`)); },
      async existentes(chaves) {
        if (!chaves.length) return [];
        const lista = chaves.map((k) => `"${k.replace(/"/g, '')}"`).join(',');
        const linhas = await pedir(`orbita_leads?select=id,dedupe_key&dedupe_key=in.(${encodeURIComponent(lista)})`);
        return linhas || [];
      },
      async inserir(muitos) {
        if (!muitos.length) return [];
        return (await pedir('orbita_leads', { method: 'POST', body: muitos, prefer: 'return=representation' })) || [];
      },
      async upsert(muitos) {
        if (!muitos.length) return [];
        return (await pedir('orbita_leads?on_conflict=dedupe_key', {
          method: 'POST', body: muitos, prefer: 'return=representation,resolution=merge-duplicates',
        })) || [];
      },
      async patch(id, campos) {
        const r = await pedir(`orbita_leads?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
        return um(r);
      },
      /* 1.59.0 · o rasto do lead. A tabela só existe depois de a migração ser
         aplicada — quem chama trata a falha (uma instalação antiga não pode
         deixar de guardar um lead por causa do histórico). */
      async eventos(leadId, limit = 40) {
        return (await pedir(`orbita_lead_eventos?select=*&lead_id=eq.${q(leadId)}&order=criado.desc&limit=${Math.min(200, limit)}`)) || [];
      },
      async evento({ lead_id, tipo = 'nota', texto, autor = 'sistema', detalhe = null }) {
        return um(await pedir('orbita_lead_eventos', {
          method: 'POST',
          body: { lead_id, tipo, texto, autor, detalhe },
          prefer: 'return=representation',
        }));
      },
    },

    /* 1.60.0 · A AUTONOMIA, numa tabela. O nível de cada tipo de trabalho é uma
       decisão do dono, com autor e data — não um valor escondido no código. */
    autonomia: {
      async list() { return (await pedir('orbita_autonomia?select=*&order=escopo.asc&limit=200')) || []; },
      async porEscopo(escopo) { return um(await pedir(`orbita_autonomia?select=*&escopo=eq.${q(escopo)}&limit=1`)); },
      async guardar(registo) {
        const r = await pedir('orbita_autonomia?on_conflict=escopo', {
          method: 'POST', body: registo,
          prefer: 'return=representation,resolution=merge-duplicates',
        });
        return um(r);
      },
    },

    projetos: {
      async list() { return (await pedir('orbita_projects?select=*&order=updated_at.desc&limit=200')) || []; },
      async byId(id) { return um(await pedir(`orbita_projects?select=*&id=eq.${q(id)}&limit=1`)); },
      async insert(p) { return um(await pedir('orbita_projects', { method: 'POST', body: p, prefer: 'return=representation' })); },
    },

    tarefas: {
      async list(limit = 100) { return (await pedir(`orbita_tasks?select=*&order=created_at.desc&limit=${Math.min(300, limit)}`)) || []; },
      async byId(id) { return um(await pedir(`orbita_tasks?select=*&id=eq.${q(id)}&limit=1`)); },
      async insert(t) { return um(await pedir('orbita_tasks', { method: 'POST', body: t, prefer: 'return=representation' })); },
      /* 1.67.0 · a fila e o cadeado do ciclo. `reclamar` é condicional no
         `state=eq.queued`: duas invocações ao mesmo tempo, só uma leva a linha
         (zero linhas devolvidas = outro ciclo já a levou). */
      async emFila(limit = 10) {
        return (await pedir(`orbita_tasks?select=*&state=eq.queued&order=created_at.asc&limit=${Math.min(50, Math.max(1, limit))}`)) || [];
      },
      async reclamar(id) {
        const r = await pedir(`orbita_tasks?id=eq.${q(id)}&state=eq.queued`, {
          method: 'PATCH', body: { state: 'running', error: null, finished_at: null }, prefer: 'return=representation',
        });
        return um(r);
      },
      async patch(id, campos) {
        const r = await pedir(`orbita_tasks?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
        return um(r);
      },
    },

    mensagens: {
      async list(limit = 100) { return (await pedir(`orbita_messages?select=*&order=created_at.desc&limit=${Math.min(300, limit)}`)) || []; },
      async byId(id) { return um(await pedir(`orbita_messages?select=*&id=eq.${q(id)}&limit=1`)); },
      async rascunhos() { return (await pedir('orbita_messages?select=*&status=eq.rascunho&order=created_at.desc&limit=50')) || []; },
      async inserir(m) { return um(await pedir('orbita_messages', { method: 'POST', body: m, prefer: 'return=representation' })); },
      /* 1.37.0 · a Meta repete o webhook: o id lá de fora é a chave que impede a
         mesma resposta de aparecer duas vezes na mesa */
      async porExterno(x) { return um(await pedir(`orbita_messages?select=*&id_externo=eq.${q(x)}&limit=1`)); },
      async patch(id, campos) {
        const r = await pedir(`orbita_messages?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
        return um(r);
      },
    },

    receitas: {
      async desde(iso, limite = 200) {
        return (await pedir(`orbita_receitas?select=*&at=gte.${q(iso)}&order=at.desc&limit=${limite}`)) || [];
      },
      async insert(r) { return um(await pedir('orbita_receitas', { method: 'POST', body: r, prefer: 'return=representation' })); },
      async remove(id) {
        const r = await pedir(`orbita_receitas?id=eq.${q(id)}`, { method: 'DELETE', prefer: 'return=representation' });
        return Array.isArray(r) ? r.length > 0 : !!r;
      },
    },

    /* ---- 1.56.0 · as faturas: documentos com número, não totais soltos ---- */
    faturas: {
      async listar(limite = 500) {
        return (await pedir(`orbita_faturas?select=*&order=emitida_em.desc&limit=${Math.min(5000, Math.max(1, limite))}`)) || [];
      },
      async porId(i) { return um(await pedir(`orbita_faturas?id=eq.${q(i)}&limit=1`)); },
      /* a chave única (serie, numero, tipo) é o que impede dois números iguais */
      async inserir(f) { return um(await pedir('orbita_faturas', { method: 'POST', body: f, prefer: 'return=representation' })); },
      async patch(i, campos) { return um(await pedir(`orbita_faturas?id=eq.${q(i)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' })); },
    },

    atividade: {
      async list(limit = 20) { return (await pedir(`orbita_atividade?select=*&order=at.desc&limit=${Math.min(200, limit)}`)) || []; },
      async add(tipo, texto) { return um(await pedir('orbita_atividade', { method: 'POST', body: { tipo, texto }, prefer: 'return=minimal' })); },
    },

    /* ---- 1.18.0 · a memória da IA: execuções, passos, uso e configuração ---- */
    ia: {
      config: {
        async ler() {
          const linhas = (await pedir('orbita_ai_config?select=chave,valor')) || [];
          return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
        },
        async gravar(chave, valor) {
          await pedir('orbita_ai_config?on_conflict=chave', {
            method: 'POST', body: { chave, valor, actualizado: new Date().toISOString() },
            prefer: 'resolution=merge-duplicates,return=minimal',
          });
          return true;
        },
      },
      runs: {
        /* 1.61.0 · as colunas novas (autorizações, cancelamento, pendente,
           repetição, chave) só existem depois de `orbita_1_61_0.sql`. Numa base
           por migrar, a escrita não pode falhar: tenta-se de novo sem elas e
           diz-se que ficaram por guardar — em vez de perder a execução inteira. */
        async criar(r) {
          try {
            return um(await pedir('orbita_ai_runs', { method: 'POST', body: r, prefer: 'return=representation' }));
          } catch (e) {
            if (!e.semEsquema) throw e;
            const { autorizacoes, cancelamento, pendente, repeticao_de, chave, ...antigo } = r;
            void autorizacoes; void cancelamento; void pendente; void repeticao_de; void chave;
            const linha = um(await pedir('orbita_ai_runs', { method: 'POST', body: antigo, prefer: 'return=representation' }));
            return linha ? { ...linha, migracaoEmFalta: 'orbita_1_61_0' } : linha;
          }
        },
        async actualizar(id, campos) {
          try {
            const r = await pedir(`orbita_ai_runs?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
            return um(r);
          } catch (e) {
            if (!e.semEsquema) throw e;
            const { autorizacoes, cancelamento, pendente, repeticao_de, chave, ...antigo } = campos;
            void autorizacoes; void cancelamento; void pendente; void repeticao_de; void chave;
            const r = await pedir(`orbita_ai_runs?id=eq.${q(id)}`, { method: 'PATCH', body: antigo, prefer: 'return=representation' });
            const linha = um(r);
            return linha ? { ...linha, migracaoEmFalta: 'orbita_1_61_0' } : linha;
          }
        },
        async porId(id) { return um(await pedir(`orbita_ai_runs?select=*&id=eq.${q(id)}&limit=1`)); },
        async listar(limit = 30) { return (await pedir(`orbita_ai_runs?select=*&order=criado.desc&limit=${Math.min(100, limit)}`)) || []; },
      },
      steps: {
        async criar(s) { return um(await pedir('orbita_ai_steps', { method: 'POST', body: s, prefer: 'return=representation' })); },
        async actualizar(id, campos) {
          const r = await pedir(`orbita_ai_steps?id=eq.${q(id)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' });
          return um(r);
        },
        async porRun(runId) { return (await pedir(`orbita_ai_steps?select=*&run_id=eq.${q(runId)}&order=ordem.asc`)) || []; },
      },
      uso: {
        async registar(u) {
          /* 1.55.0 · o custo fica GRAVADO com a chamada (preço da altura, não o
             de amanhã). Se o motor já o calculou com as regras dele, respeita-se. */
          const linha = u?.custo_micro_usd !== undefined || u?.custo_desconhecido !== undefined
            ? u
            : { ...u, ...camposDeCusto(u) };
          try {
            return um(await pedir('orbita_ai_uso', { method: 'POST', body: linha, prefer: 'return=minimal' }));
          } catch (e) {
            /* A migração 1.55.0 ainda não foi aplicada nesta base? O PostgREST
               recusa a LINHA INTEIRA por causa das colunas do custo — e sem este
               recuo perdia-se também o uso (tokens, latência, erro), que existia
               antes. Grava-se o que a base aceita e diz-se que o custo ficou de
               fora, em vez de perder a chamada em silêncio. */
            if (!/custo_|preco_|column .* does not exist|PGRST204/i.test(String(e?.message || e))) throw e;
            const base = {
              fornecedor: linha.fornecedor, modelo: linha.modelo, agente: linha.agente,
              tipo: linha.tipo, ok: linha.ok, ms: linha.ms,
              tokens_in: linha.tokens_in, tokens_out: linha.tokens_out, erro: linha.erro,
            };
            const r = um(await pedir('orbita_ai_uso', { method: 'POST', body: base, prefer: 'return=minimal' }));
            if (r && typeof r === 'object') r.custo_perdido = true;
            return r;
          }
        },
        async latencias() {
          const linhas = (await pedir('orbita_ai_uso?select=fornecedor,modelo,ms&ok=eq.true&order=criado.desc&limit=300')) || [];
          const soma = new Map();
          for (const l of linhas) {
            const k = `${l.fornecedor}\u0000${l.modelo}`;
            const a = soma.get(k) || { n: 0, ms: 0 };
            soma.set(k, { n: a.n + 1, ms: a.ms + (l.ms || 0) });
          }
          const out = {};
          for (const [k, a] of soma) out[k] = Math.round(a.ms / a.n);
          return out;
        },
        async recentes(limit = 200) {
          return (await pedir(`orbita_ai_uso?select=*&order=criado.desc&limit=${Math.min(500, limit)}`)) || [];
        },
        /* o período inteiro, para o saldo somar o que aconteceu e não os últimos 500 */
        async porPeriodo(desde, limit = 5000) {
          const q = desde ? `&criado=gte.${encodeURIComponent(desde)}` : '';
          return (await pedir(`orbita_ai_uso?select=*${q}&order=criado.desc&limit=${Math.min(5000, limit)}`)) || [];
        },
      },
      /* 1.19.0 · memória (plugins do Graft) e trabalhos de media (OpenMontage) */
      memoria: {
        async listar({ projeto = null, limite = 500 } = {}) {
          const filtro = projeto ? `projeto=eq.${q(projeto)}&` : '';
          return (await pedir(`orbita_ai_memoria?select=*&${filtro}order=actualizado.desc&limit=${Math.min(500, limite)}`)) || [];
        },
        async criar(nota) {
          return um(await pedir('orbita_ai_memoria', { method: 'POST', body: { ...nota, usos: 0 }, prefer: 'return=representation' }));
        },
        async usar(idNota) {
          await pedir(`orbita_ai_memoria?id=eq.${q(idNota)}`, {
            method: 'PATCH', body: { ultimo_uso: new Date().toISOString() },
            prefer: 'return=minimal',
          }).catch(() => {});
          return true;
        },
        async apagar(idNota) {
          await pedir(`orbita_ai_memoria?id=eq.${q(idNota)}`, { method: 'DELETE', prefer: 'return=minimal' });
          return true;
        },
      },
      media: {
        async criar(job) { return um(await pedir('orbita_media_jobs', { method: 'POST', body: job, prefer: 'return=representation' })); },
        async actualizar(idJob, campos) {
          return um(await pedir(`orbita_media_jobs?id=eq.${q(idJob)}`, { method: 'PATCH', body: campos, prefer: 'return=representation' }));
        },
        async porId(idJob) { return um(await pedir(`orbita_media_jobs?select=*&id=eq.${q(idJob)}&limit=1`)); },
        async listar(limit = 30) { return (await pedir(`orbita_media_jobs?select=*&order=criado.desc&limit=${Math.min(100, limit)}`)) || []; },
      },
    },

    /* ---- 1.54.3 · as gerações de mídia (imagem e vídeo) ----
       Cada linha é um pedido: o prompt QUE FOI ENVIADO, as opções, quem pediu,
       a lead, o projeto, o fornecedor, o modelo, o estado e o custo. A `chave`
       é única e é o que impede um duplo clique de gerar (e cobrar) duas vezes. */
    geracoes: {
      async criar(g) {
        return um(await pedir('orbita_geracoes', { method: 'POST', body: g, prefer: 'return=representation' }));
      },
      async actualizar(id, campos) {
        const r = await pedir(`orbita_geracoes?id=eq.${q(id)}`, {
          method: 'PATCH', body: { ...campos, actualizado: campos.actualizado || new Date().toISOString() },
          prefer: 'return=representation',
        });
        return um(r);
      },
      async porId(id) { return um(await pedir(`orbita_geracoes?select=*&id=eq.${q(id)}&limit=1`)); },
      async porChave(chave) {
        if (!chave) return null;
        return um(await pedir(`orbita_geracoes?select=*&chave=eq.${q(chave)}&limit=1`));
      },
      async listarPorProjeto(projetoId, limite = 60) {
        return (await pedir(`orbita_geracoes?select=*&projeto_id=eq.${q(projetoId)}&order=criado.desc&limit=${Math.min(200, limite)}`)) || [];
      },
      /* 1.55.0 · o que se gerou no período, para o saldo contar o custo da mídia */
      async porPeriodo(desde, limite = 5000) {
        const q = desde ? `&criado=gte.${encodeURIComponent(desde)}` : '';
        return (await pedir(`orbita_geracoes?select=*${q}&order=criado.desc&limit=${Math.min(5000, limite)}`)) || [];
      },
      async contarDesde(contaId, iso) {
        const l = await pedir(`orbita_geracoes?select=id&conta_id=eq.${q(contaId)}&criado=gte.${q(iso)}&limit=500`);
        return Array.isArray(l) ? l.length : 0;
      },
      async contarDoProjetoDesde(projetoId, iso) {
        const l = await pedir(`orbita_geracoes?select=id&projeto_id=eq.${q(projetoId)}&criado=gte.${q(iso)}&limit=500`);
        return Array.isArray(l) ? l.length : 0;
      },
      async contarActivas(contaId) {
        const l = await pedir(`orbita_geracoes?select=id&conta_id=eq.${q(contaId)}&estado=in.(aguardando,em_processamento)&limit=100`);
        return Array.isArray(l) ? l.length : 0;
      },
      async apagarDoProjeto(projetoId) {
        const r = await pedir(`orbita_geracoes?projeto_id=eq.${q(projetoId)}`, { method: 'DELETE', prefer: 'return=representation' });
        return Array.isArray(r) ? r.length : 0;
      },
      /* a reivindicação atómica: só UM pedido consegue passar este `estado=eq.aguardando`
         para `em_processamento`. É o que impede duas chamadas simultâneas de
         gerarem (e cobrarem) a mesma imagem duas vezes. */
      async reivindicar(id, agora = new Date().toISOString()) {
        const r = await pedir(`orbita_geracoes?id=eq.${q(id)}&estado=eq.aguardando`, {
          method: 'PATCH',
          body: { estado: 'em_processamento', actualizado: agora },
          prefer: 'return=representation',
        });
        const linha = um(r);
        if (!linha) return null;
        const tentativas = Number(linha.tentativas || 0) + 1;
        return um(await pedir(`orbita_geracoes?id=eq.${q(id)}`, {
          method: 'PATCH', body: { tentativas }, prefer: 'return=representation',
        })) || linha;
      },
      /* o «pump»: quem faz avançar os trabalhos que ninguém está a olhar */
      async listarPendentes(limite = 5) {
        return (await pedir(`orbita_geracoes?select=*&estado=eq.aguardando&order=criado.asc&limit=${Math.min(20, limite)}`)) || [];
      },
    },
  };
}

/* ---------- a mesma interface, em memória (testes) ---------- */
const agoraDe = () => new Date().toISOString();

export function createMemRepo(seed = {}) {
  const d = {
    leads: [], projetos: [], tarefas: [], mensagens: [], receitas: [], atividade: [], faturas: [],
    leadEventos: [], contas: [], sessoes: [], autonomia: [],
    iaRuns: [], iaSteps: [], iaUso: [], iaConfig: {}, iaMemoria: [], mediaJobs: [], geracoes: [],
    ...JSON.parse(JSON.stringify(seed)),
  };
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  const agora = agoraDe;
  return {
    tipo: 'memoria',
    _dados: d,
    async health() { return { ok: true, base: 'memoria', faltam: [], mensagensProntas: true }; },
    contas: {
      async listar() { return [...d.contas]; },
      async contar() { return d.contas.length; },
      async porEmail(email) { return d.contas.find((c) => c.email === String(email || '').trim().toLowerCase()) || null; },
      async porId(i) { return d.contas.find((c) => c.id === i) || null; },
      async sonda() { return true; },
      async criar(c) { const nova = { id: id('u'), criado: agora(), activo: true, ultimo_acesso: null, ...c }; d.contas.push(nova); return nova; },
      async actualizar(i, campos) { const c = d.contas.find((x) => x.id === i); if (!c) return null; Object.assign(c, campos); return c; },
    },
    sessoes: {
      async criar(x) { const nova = { id: id('ss'), criado: agora(), revogada: null, ...x }; d.sessoes.push(nova); return nova; },
      async porHash(h) { return d.sessoes.find((x) => x.token_hash === h) || null; },
      async listar(limite = 50) { return [...d.sessoes].sort((a, b) => String(b.criado).localeCompare(String(a.criado))).slice(0, limite); },
      async actualizar(i, campos) { const x = d.sessoes.find((y) => y.id === i); if (!x) return null; Object.assign(x, campos); return x; },
      async revogar(i) { const x = d.sessoes.find((y) => y.id === i); if (!x) return null; x.revogada = agora(); return x; },
    },
    leads: {
      async list(limit = 200) { return [...d.leads].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); },
      async byId(i) { return d.leads.find((l) => l.id === i) || null; },
      async existentes(chaves) { return d.leads.filter((l) => chaves.includes(l.dedupe_key)).map((l) => ({ id: l.id, dedupe_key: l.dedupe_key })); },
      // na base o `id` e o `created_at` nascem do Postgres; aqui nascem daqui
      async inserir(muitos) {
        const novos = muitos.map((l) => ({ id: id('l'), created_at: agora(), ...l }));
        d.leads.push(...novos);
        return novos;
      },
      async upsert(muitos) {
        const out = [];
        for (const m of muitos) {
          const i = d.leads.findIndex((l) => l.dedupe_key === m.dedupe_key);
          if (i >= 0) { d.leads[i] = { ...d.leads[i], ...m, id: d.leads[i].id }; out.push(d.leads[i]); }
          else { d.leads.push(m); out.push(m); }
        }
        return out;
      },
      async patch(i, campos) {
        const l = d.leads.find((x) => x.id === i);
        if (!l) return null;
        Object.assign(l, campos, { updated_at: agora() });
        return l;
      },
      async eventos(leadId, limit = 40) {
        return (d.leadEventos || []).filter((e) => e.lead_id === leadId)
          .sort((a, b) => String(b.criado).localeCompare(String(a.criado))).slice(0, limit);
      },
      async evento({ lead_id, tipo = 'nota', texto, autor = 'sistema', detalhe = null }) {
        d.leadEventos = d.leadEventos || [];
        const novo = { id: id('le'), lead_id, tipo, texto, autor, detalhe, criado: agora() };
        d.leadEventos.push(novo);
        return novo;
      },
    },
    autonomia: {
      async list() { return [...(d.autonomia || [])].sort((a, b) => String(a.escopo).localeCompare(String(b.escopo))); },
      async porEscopo(escopo) { return (d.autonomia || []).find((x) => x.escopo === escopo) || null; },
      async guardar(registo) {
        d.autonomia = d.autonomia || [];
        const i = d.autonomia.findIndex((x) => x.escopo === registo.escopo);
        if (i >= 0) d.autonomia[i] = { ...d.autonomia[i], ...registo };
        else d.autonomia.push({ id: id('au'), criado: agora(), ...registo });
        return d.autonomia.find((x) => x.escopo === registo.escopo);
      },
    },
    projetos: {
      async list() { return [...d.projetos].sort((a, b) => b.updated_at.localeCompare(a.updated_at)); },
      async byId(i) { return d.projetos.find((p) => p.id === i) || null; },
      async insert(p) { const novo = { id: id('p'), created_at: agora(), updated_at: agora(), ...p }; d.projetos.push(novo); return novo; },
    },
    tarefas: {
      async list(limit = 100) { return [...d.tarefas].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); },
      async byId(i) { return d.tarefas.find((t) => t.id === i) || null; },
      async insert(t) { const novo = { id: id('t'), created_at: agora(), ...t }; d.tarefas.push(novo); return novo; },
      async patch(i, campos) { const t = d.tarefas.find((x) => x.id === i); if (!t) return null; Object.assign(t, campos); return t; },
      /* 1.67.0 · a mesma fila e o mesmo cadeado do Supabase, em memória */
      async emFila(limit = 10) {
        return [...d.tarefas].filter((t) => t.state === 'queued')
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .slice(0, Math.min(50, Math.max(1, limit)));
      },
      async reclamar(i) {
        const t = d.tarefas.find((x) => x.id === i);
        if (!t || t.state !== 'queued') return null;   // outro ciclo levou-a
        t.state = 'running'; t.error = null; t.finished_at = null;
        return t;
      },
    },
    mensagens: {
      async list(limit = 100) { return [...d.mensagens].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit); },
      async byId(i) { return d.mensagens.find((m) => m.id === i) || null; },
      async rascunhos() { return d.mensagens.filter((m) => m.status === 'rascunho'); },
      async inserir(m) { const novo = { id: id('m'), created_at: agora(), status: 'rascunho', ...m }; d.mensagens.push(novo); return novo; },
      async porExterno(x) { return d.mensagens.find((m) => m.id_externo === x) || null; },
      async patch(i, campos) { const m = d.mensagens.find((x) => x.id === i); if (!m) return null; Object.assign(m, campos); return m; },
    },
    receitas: {
      async desde(iso, limite = 200) { return d.receitas.filter((r) => r.at >= iso).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limite); },
      async insert(r) { const novo = { id: id('r'), at: agora(), ...r }; d.receitas.push(novo); return novo; },
      async remove(i) { const antes = d.receitas.length; d.receitas = d.receitas.filter((r) => r.id !== i); return d.receitas.length < antes; },
    },
    faturas: {
      async listar(limite = 500) { return [...d.faturas].sort((a, b) => String(b.emitida_em || '').localeCompare(String(a.emitida_em || ''))).slice(0, limite); },
      async porId(i) { return d.faturas.find((f) => f.id === i) || null; },
      async inserir(f) {
        /* a mesma regra da base: (serie, numero, tipo) não se repete */
        if (d.faturas.some((x) => x.serie === f.serie && x.numero === f.numero && x.tipo === f.tipo)) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "orbita_faturas_serie_numero_tipo_key"'), { status: 409 });
        }
        const nova = { ...f };
        d.faturas.push(nova);
        return nova;
      },
      async patch(i, campos) { const f = d.faturas.find((x) => x.id === i); if (!f) return null; Object.assign(f, campos); return f; },
    },
    atividade: {
      async list(limit = 20) { return [...d.atividade].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit); },
      async add(tipo, texto) { d.atividade.unshift({ id: id('a'), tipo, texto, at: agora() }); },
    },

    /* mesma interface que o Supabase, para os testes provarem o orquestrador sem rede */
    ia: {
      config: {
        async ler() { return { ...d.iaConfig }; },
        async gravar(chave, valor) { d.iaConfig[chave] = valor; return true; },
      },
      runs: {
        async criar(r) { const novo = { id: id('run'), criado: agora(), estado: 'novo', ...r }; d.iaRuns.unshift(novo); return novo; },
        async actualizar(i, campos) { const r = d.iaRuns.find((x) => x.id === i); if (!r) return null; Object.assign(r, campos); return r; },
        async porId(i) { return d.iaRuns.find((x) => x.id === i) || null; },
        async listar(limit = 30) { return [...d.iaRuns].slice(0, limit); },
      },
      steps: {
        async criar(s) { const novo = { id: id('st'), criado: agora(), ...s }; d.iaSteps.push(novo); return novo; },
        async actualizar(i, campos) { const s = d.iaSteps.find((x) => x.id === i); if (!s) return null; Object.assign(s, campos); return s; },
        async porRun(runId) { return d.iaSteps.filter((s) => s.run_id === runId).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)); },
      },
      uso: {
        async registar(u) {
          const linha = u?.custo_micro_usd !== undefined || u?.custo_desconhecido !== undefined
            ? u : { ...u, ...camposDeCusto(u) };
          d.iaUso.unshift({ id: id('u'), criado: agora(), ...linha });
          return true;
        },
        async porPeriodo(desde, limit = 5000) {
          const linhas = desde ? d.iaUso.filter((x) => String(x.criado || '') >= desde) : d.iaUso;
          return linhas.slice(0, Math.min(5000, limit));
        },
        async latencias() {
          const soma = new Map();
          for (const l of d.iaUso.filter((u) => u.ok)) {
            const k = `${l.fornecedor}\u0000${l.modelo}`;
            const a = soma.get(k) || { n: 0, ms: 0 };
            soma.set(k, { n: a.n + 1, ms: a.ms + (l.ms || 0) });
          }
          return Object.fromEntries([...soma].map(([k, a]) => [k, Math.round(a.ms / a.n)]));
        },
        async recentes(limit = 200) { return d.iaUso.slice(0, limit); },
      },
      memoria: {
        async listar({ projeto = null, limite = 500 } = {}) {
          const lista = projeto ? d.iaMemoria.filter((n) => n.projeto === projeto) : d.iaMemoria;
          return [...lista].sort((a, b) => String(b.actualizado || '').localeCompare(String(a.actualizado || ''))).slice(0, limite);
        },
        async criar(nota) {
          const nova = { id: id('mem'), criado: agora(), actualizado: agora(), usos: 0, ...nota };
          d.iaMemoria.unshift(nova);
          return nova;
        },
        async usar(idNota) {
          const n = d.iaMemoria.find((x) => x.id === idNota);
          if (n) { n.usos = Number(n.usos || 0) + 1; n.ultimo_uso = agora(); }
          return true;
        },
        async apagar(idNota) {
          const i = d.iaMemoria.findIndex((x) => x.id === idNota);
          if (i >= 0) d.iaMemoria.splice(i, 1);
          return true;
        },
      },
      media: {
        async criar(job) { const novo = { id: id('mjob'), criado: agora(), estado: 'pedido', ...job }; d.mediaJobs.unshift(novo); return novo; },
        async actualizar(i, campos) { const j = d.mediaJobs.find((x) => x.id === i); if (!j) return null; Object.assign(j, campos); return j; },
        async porId(i) { return d.mediaJobs.find((x) => x.id === i) || null; },
        async listar(limit = 30) { return d.mediaJobs.slice(0, limit); },
      },
    },

    /* 1.54.3 · as gerações de mídia, com a mesma interface do Supabase */
    geracoes: {
      async criar(g) {
        if (g.chave && d.geracoes.some((x) => x.chave === g.chave)) {
          throw Object.assign(new Error('chave de geração repetida'), { status: 409 });
        }
        const nova = { id: id('g'), criado: agora(), actualizado: agora(), estado: 'aguardando', tentativas: 0, ...g };
        d.geracoes.unshift(nova);
        return nova;
      },
      async actualizar(i, campos) {
        const g = d.geracoes.find((x) => x.id === i);
        if (!g) return null;
        Object.assign(g, campos, { actualizado: campos.actualizado || agora() });
        return g;
      },
      async porId(i) { return d.geracoes.find((x) => x.id === i) || null; },
      async porChave(chave) { return chave ? (d.geracoes.find((x) => x.chave === chave) || null) : null; },
      async listarPorProjeto(projetoId, limite = 60) {
        return d.geracoes.filter((g) => g.projeto_id === projetoId).slice(0, limite);
      },
      async porPeriodo(desde, limite = 5000) {
        return d.geracoes.filter((g) => !desde || String(g.criado || '') >= desde).slice(0, limite);
      },
      async contarDesde(contaId, iso) { return d.geracoes.filter((g) => g.conta_id === contaId && String(g.criado) >= iso).length; },
      async contarDoProjetoDesde(projetoId, iso) { return d.geracoes.filter((g) => g.projeto_id === projetoId && String(g.criado) >= iso).length; },
      async contarActivas(contaId) {
        return d.geracoes.filter((g) => g.conta_id === contaId && ['aguardando', 'em_processamento'].includes(g.estado)).length;
      },
      async apagarDoProjeto(projetoId) {
        const antes = d.geracoes.length;
        d.geracoes = d.geracoes.filter((g) => g.projeto_id !== projetoId);
        return antes - d.geracoes.length;
      },
      async reivindicar(i, agora = agoraDe()) {
        const g = d.geracoes.find((x) => x.id === i);
        if (!g || g.estado !== 'aguardando') return null;
        g.estado = 'em_processamento';
        g.tentativas = Number(g.tentativas || 0) + 1;
        g.actualizado = agora;
        return g;
      },
      async listarPendentes(limite = 5) {
        return [...d.geracoes].filter((g) => g.estado === 'aguardando').reverse().slice(0, limite);
      },
    },
  };
}
