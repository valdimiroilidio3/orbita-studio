/* ===========================================================================
   1.18.0 · AS FERRAMENTAS (30 out 2026)

   O modelo PEDE; quem executa é este ficheiro, no servidor, com a chave secreta
   da base. Um texto do modelo nunca conta como prova de que algo aconteceu —
   a prova é `ok: true` do executor e a linha que ele escreveu na base.

   Regras:
     · lista fechada: o modelo só pode chamar o que está em FERRAMENTAS;
     · argumentos validados contra um esquema (tipo, obrigatório, enum, limites)
       antes de tocar em nada;
     · as destrutivas (`destrutivo: true`) exigem aprovação humana explícita no
       contexto da execução — sem isso devolvem `precisa_aprovacao`, não fazem;
     · tudo o que corre fica registado (nome, argumentos resumidos, resultado);
     · o que não existe nesta arquitectura está declarado em INDISPONIVEIS, para
       ninguém prometer pesquisa web ou execução de código que não há.
   =========================================================================== */
import { chaveLead } from '../_repo.mjs';

/* 1.85.0 · PESQUISA E IMAGEM SÃO FERRAMENTAS DE VERDADE (11 nov 2026).

   Antes desta versão, `INDISPONIVEIS` dizia que não havia fornecedor de pesquisa
   nem de imagem — falso: a Tavily está ligada em produção (é ela que dá os
   leads) e o Pollinations gera imagens dentro dos projetos. A verdade é outra:
   as capacidades existem, o que faltava era o agente poder chamá-las dentro de
   uma execução.

   Três novas ferramentas entram na lista fechada:

     · web_pesquisar — pesquisa web via Tavily (contexto, notícias, páginas)
     · web_ler — lê o texto de uma página já encontrada (Tavily /extract)
     · imagem_gerar — pede uma imagem ao pipeline de mídia do projeto (com OK humano)

   Cada agente só chama o que está na sua lista `ferramentas` em `agentes.mjs`.
   O servidor decide, não o modelo.
   */

const s = (descricao, extra = {}) => ({ type: 'string', description: descricao, ...extra });
const n = (descricao, extra = {}) => ({ type: 'number', description: descricao, ...extra });

export const FERRAMENTAS = {
  mesa_resumo: {
    descricao: 'Números reais da mesa agora: leads por estado, projetos, entradas de dinheiro.',
    parametros: { type: 'object', properties: {}, additionalProperties: false },
    async executar(_args, ctx) {
      const [leads, projetos] = await Promise.all([ctx.repo.leads.list(500), ctx.repo.projetos.list()]);
      const porEstado = {};
      for (const l of leads) porEstado[l.status] = (porEstado[l.status] || 0) + 1;
      return { ok: true, resumo: `${leads.length} leads, ${projetos.length} projetos`, dados: { leads: leads.length, porEstado, projetos: projetos.length } };
    },
  },

  leads_listar: {
    descricao: 'Lista os leads guardados (nome, cidade, estado, contacto). Usa antes de criar, para não duplicar.',
    parametros: {
      type: 'object',
      properties: {
        limite: n('quantos devolver (1–100)', { minimum: 1, maximum: 100 }),
        estado: s('filtrar por estado', { enum: ['novo', 'contactado', 'respondeu', 'ganho', 'perdido'] }),
      },
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const limite = Math.min(100, Math.max(1, Number(args.limite) || 25));
      const lista = (await ctx.repo.leads.list(200)).filter((l) => !args.estado || l.status === args.estado).slice(0, limite);
      return {
        ok: true,
        resumo: `${lista.length} leads`,
        dados: lista.map((l) => ({ id: l.id, nome: l.name, cidade: l.city, estado: l.status, telefone: l.phone, email: l.email })),
      };
    },
  },

  lead_criar: {
    descricao: 'Cria um lead na base. Não duplica: nome+cidade iguais devolvem o lead que já existe.',
    parametros: {
      type: 'object',
      properties: {
        nome: s('nome do negócio (obrigatório)', { minLength: 2, maxLength: 120 }),
        cidade: s('cidade', { maxLength: 80 }),
        telefone: s('telefone', { maxLength: 40 }),
        email: s('email', { maxLength: 120 }),
        notas: s('porquê ou contexto', { maxLength: 600 }),
        origem: s('de onde veio', { maxLength: 40 }),
      },
      required: ['nome'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const nome = String(args.nome).trim();
      const cidade = String(args.cidade || '').trim();
      const chave = chaveLead(nome, cidade);
      const existentes = await ctx.repo.leads.existentes([chave]);
      if (existentes.length) return { ok: true, resumo: `já existia: ${nome}`, dados: { id: existentes[0].id, duplicado: true } };
      const [novo] = await ctx.repo.leads.inserir([{
        dedupe_key: chave, name: nome, city: cidade || null,
        phone: String(args.telefone || '').trim() || null,
        email: String(args.email || '').trim() || null,
        notes: String(args.notas || '').trim() || null,
        source: String(args.origem || 'ia').trim() || 'ia',
        status: 'novo',
      }]);
      return { ok: true, resumo: `criado: ${nome}`, dados: { id: novo?.id || null } };
    },
  },

  lead_actualizar: {
    descricao: 'Muda o estado ou as notas de um lead existente.',
    parametros: {
      type: 'object',
      properties: {
        id: s('id do lead', { format: 'uuid' }),
        estado: s('novo estado', { enum: ['novo', 'contactado', 'respondeu', 'ganho', 'perdido'] }),
        notas: s('notas novas (substitui)', { maxLength: 600 }),
      },
      required: ['id'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const campos = {};
      if (args.estado) campos.status = args.estado;
      if (args.notas !== undefined) campos.notes = String(args.notas).slice(0, 600);
      if (!Object.keys(campos).length) return { ok: false, resumo: 'nada para mudar' };
      const l = await ctx.repo.leads.patch(args.id, campos);
      if (!l) return { ok: false, resumo: 'lead não encontrado' };
      return { ok: true, resumo: `actualizado: ${l.name}`, dados: { id: l.id, estado: l.status } };
    },
  },

  projetos_listar: {
    descricao: 'Lista os projetos do workspace.',
    parametros: { type: 'object', properties: { limite: n('quantos (1–100)', { minimum: 1, maximum: 100 }) }, additionalProperties: false },
    async executar(args, ctx) {
      const lista = (await ctx.repo.projetos.list()).slice(0, Math.min(100, Number(args.limite) || 25));
      return { ok: true, resumo: `${lista.length} projetos`, dados: lista.map((p) => ({ id: p.id, nome: p.name, cliente: p.client, estado: p.status })) };
    },
  },

  projeto_criar: {
    descricao: 'Abre um projeto novo no workspace (estado rascunho).',
    parametros: {
      type: 'object',
      properties: {
        nome: s('nome do projeto', { minLength: 2, maxLength: 120 }),
        cliente: s('cliente', { maxLength: 120 }),
        cidade: s('cidade', { maxLength: 80 }),
        tipo: s('tipo', { enum: ['landing', 'site', 'loja', 'app'] }),
      },
      required: ['nome'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const p = await ctx.repo.projetos.insert({
        name: String(args.nome).trim(), client: String(args.cliente || '').trim() || null,
        city: String(args.cidade || '').trim() || null, kind: args.tipo || 'landing', status: 'rascunho',
      });
      return { ok: true, resumo: `projeto criado: ${p?.name || args.nome}`, dados: { id: p?.id || null } };
    },
  },

  mensagem_rascunhar: {
    descricao: 'Guarda um rascunho de mensagem para um lead. Não envia nada — fica à espera de aprovação humana.',
    parametros: {
      type: 'object',
      properties: {
        lead_id: s('id do lead', { format: 'uuid' }),
        canal: s('canal', { enum: ['whatsapp', 'email', 'telefone'] }),
        texto: s('texto da mensagem', { minLength: 10, maxLength: 1500 }),
      },
      required: ['lead_id', 'canal', 'texto'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const l = await ctx.repo.leads.byId(args.lead_id);
      if (!l) return { ok: false, resumo: 'lead não encontrado' };
      const m = await ctx.repo.mensagens.inserir({
        lead_id: l.id, channel: args.canal, body: String(args.texto).slice(0, 1500),
        status: 'rascunho', generated_by: 'modelo',
      });
      return { ok: true, resumo: `rascunho guardado para ${l.name}`, dados: { id: m?.id || null, enviado: false } };
    },
  },

  receita_registar: {
    descricao: 'Regista uma entrada de dinheiro (valor em euros). Só com o valor real recebido.',
    parametros: {
      type: 'object',
      properties: {
        valor_eur: n('valor em euros', { minimum: 0.01, maximum: 1000000 }),
        campanha: s('a que campanha/projeto pertence', { maxLength: 120 }),
      },
      required: ['valor_eur'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const cents = Math.round(Number(args.valor_eur) * 100);
      const r = await ctx.repo.receitas.insert({ amount_cents: cents, campaign: String(args.campanha || '').trim() || null, at: new Date().toISOString() });
      return { ok: true, resumo: `entrada de ${(cents / 100).toFixed(2)} €`, dados: { id: r?.id || null } };
    },
  },

  receita_apagar: {
    descricao: 'Apaga uma entrada de dinheiro. Acção destrutiva: exige aprovação humana.',
    destrutivo: true,
    parametros: { type: 'object', properties: { id: s('id da entrada') }, required: ['id'], additionalProperties: false },
    async executar(args, ctx) {
      const apagou = await ctx.repo.receitas.remove(args.id);
      return { ok: apagou, resumo: apagou ? 'entrada apagada' : 'não encontrei essa entrada' };
    },
  },

  /* ---------------- 1.85.0 · pesquisa web (Tavily) ---------------- */

  web_pesquisar: {
    descricao: 'Pesquisa na web (Tavily) e devolve resultados reais com excerto, URL e relevância. Usa quando precisas de contexto externo: mercado, concorrência, notícias, o que uma empresa diz de si.',
    parametros: {
      type: 'object',
      properties: {
        consulta: s('o que pesquisar (obrigatório)', { minLength: 3, maxLength: 500 }),
        limite: n('quantos resultados (1–20)', { minimum: 1, maximum: 20 }),
        profundidade: s('basic ou advanced', { enum: ['basic', 'advanced'] }),
        resposta: s('se quer resposta curta da IA (true/false)', { enum: ['true', 'false'] }),
        topico: s('general ou news', { enum: ['general', 'news'] }),
        dias: n('dias de recorte (só faz sentido com news)', { minimum: 1, maximum: 365 }),
      },
      required: ['consulta'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const { pesquisarWeb } = await import('../_pesquisa.mjs');
      const r = await pesquisarWeb({
        consulta: args.consulta,
        limite: args.limite || 8,
        profundidade: args.profundidade || 'basic',
        resposta: args.resposta !== 'false',
        topico: args.topico || 'general',
        dias: args.dias,
      }, { env: ctx.env, fetchImpl: ctx.fetchImpl });
      return { ok: true, resumo: `${r.encontrados} resultado(s) reais`, dados: r };
    },
  },

  web_ler: {
    descricao: 'Lê o texto de uma página web (Tavily /extract). Usa depois de web_pesquisar para ir ao detalhe de um resultado.',
    parametros: {
      type: 'object',
      properties: {
        url: s('endereço http(s) completo (obrigatório)', { minLength: 8, maxLength: 2000 }),
      },
      required: ['url'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const { extrairPagina } = await import('../_pesquisa.mjs');
      const r = await extrairPagina({ url: args.url }, { env: ctx.env, fetchImpl: ctx.fetchImpl });
      const texto = String(r.texto || '');
      return { ok: true, resumo: texto ? `página lida (${texto.length} car.)` : 'sem conteúdo', dados: r };
    },
  },

  /* ---------------- 1.85.0 · geração de imagem (Pollinations) ---------------- */

  imagem_gerar: {
    descricao: 'Pede uma imagem para um projeto. Não gera às escondidas: cria o pedido na aba Mídia do projeto, que é onde a geração, o custo e o ficheiro vivem. Precisa de aprovação humana em cada chamada.',
    /* 1.85.0 · gasta o fornecedor e ocupa a fila de mídia: é uma acção com custo,
       por isso pede o mesmo OK humano que uma destrutiva (ver `executar`). */
    aprovacao: true,
    parametros: {
      type: 'object',
      properties: {
        projeto_id: s('id do projeto a que a imagem pertence (obrigatório)', { maxLength: 80 }),
        prompt: s('a cena a gerar, com pelo menos 12 caracteres (obrigatório)', { minLength: 12, maxLength: 2000 }),
        formato: s('proporção', { enum: ['1:1', '4:3', '16:9', '3:4'] }),
        resolucao: s('tamanho', { enum: ['768', '1024', '1344'] }),
      },
      required: ['projeto_id', 'prompt'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const MD = await import('../_media.mjs');
      const projeto = await ctx.repo.projetos.byId(args.projeto_id);
      if (!projeto) return { ok: false, resumo: 'projeto não encontrado' };
      const r = await MD.criar(ctx.repo, {
        projeto, lead: null, conta: null, env: ctx.env,
        /* a aprovação humana desta chamada É a confirmação que a mídia exige */
        pedido: { tipo: 'imagem', prompt: args.prompt, formato: args.formato, resolucao: args.resolucao, confirmado: true },
      });
      if (!r.ok) return { ok: false, resumo: r.erro || 'o pedido de imagem não foi aceite' };
      /* o pedido fica «aguardando»: a imagem só existe quando a geração acaba.
         O resumo diz isso, para que ninguém conte uma imagem que não está lá. */
      return {
        ok: true,
        resumo: r.repetido ? 'este pedido já existia no projeto' : `pedido de imagem criado em «${projeto.name}» (ainda a aguardar geração)`,
        dados: { geracao_id: r.geracao?.id || null, estado: r.geracao?.estado || 'aguardando', projeto: projeto.name, repetido: !!r.repetido },
      };
    },
  },
};

/** O que esta arquitectura NÃO consegue fazer — dito por palavras, não fingido. */
export const INDISPONIVEIS = [
  { id: 'execucao_de_codigo', porque: 'as funções da Vercel não correm código arbitrário dos agentes; é preciso um executor à parte' },
  { id: 'ficheiros_do_workspace', porque: 'o sistema de ficheiros da função é temporário e não é o repositório' },
  { id: 'navegacao_de_sites', porque: 'não há browser controlado no servidor (web_ler lê uma página via Tavily, não navega por si)' },
];

/** O que falta como ferramenta — cada uma com o porquê, sem fingir. */
export function indisponiveisComAmbiente(env = {}) {
  return INDISPONIVEIS.map((i) => ({ ...i, existe: false, onde: null }));
}

const TIPO_DE = { string: 'string', number: 'number', boolean: 'boolean', object: 'object', array: 'array' };

/** Validador mínimo de JSON Schema — o suficiente para não aceitar lixo. */
export function validar(esquema, args) {
  const erros = [];
  const v = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (esquema.type === 'object') {
    for (const campo of esquema.required || []) {
      if (v[campo] === undefined || v[campo] === null || v[campo] === '') erros.push(`falta «${campo}»`);
    }
    for (const [campo, def] of Object.entries(esquema.properties || {})) {
      const valor = v[campo];
      if (valor === undefined || valor === null) continue;
      if (def.type && TIPO_DE[def.type] && typeof valor !== def.type) { erros.push(`«${campo}» devia ser ${def.type}`); continue; }
      if (def.enum && !def.enum.includes(valor)) erros.push(`«${campo}» tem de ser um de: ${def.enum.join(', ')}`);
      if (def.type === 'string') {
        if (def.minLength && String(valor).length < def.minLength) erros.push(`«${campo}» é curto demais (mínimo ${def.minLength})`);
        if (def.maxLength && String(valor).length > def.maxLength) erros.push(`«${campo}» é longo demais (máximo ${def.maxLength})`);
      }
      if (def.type === 'number') {
        if (def.minimum !== undefined && Number(valor) < def.minimum) erros.push(`«${campo}» abaixo do mínimo (${def.minimum})`);
        if (def.maximum !== undefined && Number(valor) > def.maximum) erros.push(`«${campo}» acima do máximo (${def.maximum})`);
      }
    }
    if (esquema.additionalProperties === false) {
      for (const campo of Object.keys(v)) if (!esquema.properties?.[campo]) erros.push(`«${campo}» não é um argumento desta ferramenta`);
    }
  }
  return { ok: erros.length === 0, erros, valor: v };
}

/** A lista que se entrega ao modelo — só o que ele pode mesmo chamar. */
export function paraModelo(permitidas) {
  return permitidas.filter((id) => FERRAMENTAS[id]).map((id) => ({
    nome: id, descricao: FERRAMENTAS[id].descricao, parametros: FERRAMENTAS[id].parametros,
  }));
}

/**
 * Executa uma chamada pedida pelo modelo. Nunca lança para o orquestrador:
 * devolve sempre um resultado que ele possa contar ao modelo.
 */
/* ---------------- 1.19.0 · memória (os plugins do Graft, como ferramentas) ---------------- */
Object.assign(FERRAMENTAS, {
  memoria_procurar: {
    descricao: 'Procura nas notas guardadas (memória do projecto) antes de resolveres algo que pode já ter sido resolvido.',
    parametros: {
      type: 'object',
      properties: { consulta: s('o que procuras (obrigatório)', { minLength: 3, maxLength: 300 }), limite: n('quantas notas (1–20)', { minimum: 1, maximum: 20 }) },
      required: ['consulta'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const { procurar } = await import('./memoria.mjs');
      const r = await procurar(ctx.repo, { consulta: args.consulta, limite: Number(args.limite) || 6 });
      return {
        ok: true,
        resumo: `${r.achados.length} notas (procura ${r.modo})`,
        dados: { modo: r.modo, achados: r.achados.map((x) => ({ id: x.id, titulo: x.titulo, texto: String(x.texto || '').slice(0, 400), etiquetas: x.etiquetas, pontos: x.pontos || null })) },
      };
    },
  },

  memoria_guardar: {
    descricao: 'Guarda uma nota no fim: a decisão, o que se aprendeu, o que falhou e porquê. Uma nota por chamada.',
    parametros: {
      type: 'object',
      properties: {
        titulo: s('título curto (obrigatório)', { minLength: 3, maxLength: 160 }),
        texto: s('a nota, com o contexto suficiente para servir da próxima vez', { minLength: 10, maxLength: 8000 }),
        etiquetas: s('etiquetas separadas por vírgulas', { maxLength: 200 }),
        fonte: s('de onde veio (execução, conversa, documento)', { maxLength: 200 }),
      },
      required: ['titulo', 'texto'],
      additionalProperties: false,
    },
    async executar(args, ctx) {
      const { guardar } = await import('./memoria.mjs');
      const r = await guardar(ctx.repo, { ...args, projeto: 'orbita' });
      if (!r.ok) return { ok: false, erro: r.erro };
      return { ok: true, resumo: r.resumo, dados: { id: r.nota.id, criada: r.criada } };
    },
  },
});

export async function executar(nome, args, ctx = {}) {
  const f = FERRAMENTAS[nome];
  if (!f) return { ok: false, erro: `ferramenta desconhecida: ${nome}` };
  if (ctx.permitidas && !ctx.permitidas.includes(nome)) return { ok: false, erro: `o agente ${ctx.agente || ''} não tem permissão para «${nome}»` };
  const v = validar(f.parametros, args);
  if (!v.ok) return { ok: false, erro: `argumentos inválidos: ${v.erros.join('; ')}` };
  /* 1.61.0 · a aprovação é POR FERRAMENTA, com nome e hora no histórico da
     execução. `ctx.aprovado` continua a valer (aprovou-se a execução à
     partida); `ctx.aprovadas` é a lista do que uma pessoa autorizou uma a uma.
     Uma acção destrutiva que não esteja em nenhuma das duas não corre. */
  const autorizada = ctx.aprovado || (Array.isArray(ctx.aprovadas) && ctx.aprovadas.includes(nome));
  if ((f.destrutivo || f.aprovacao) && !autorizada) {
    return { ok: false, precisaAprovacao: true, erro: `«${nome}» ${f.destrutivo ? 'é destrutiva' : 'gasta recursos'} e precisa de aprovação humana` };
  }
  const t0 = Date.now();
  try {
    /* 1.85.0 · as ferramentas de rede precisam do ambiente e do fetch; quem chama
       pode trocá-los (testes), mas por omissão é o do servidor. */
    const r = await f.executar(v.valor, { env: process.env, fetchImpl: fetch, ...ctx });
    return { ...r, ferramenta: nome, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, erro: e.message || 'falhou', ferramenta: nome, ms: Date.now() - t0 };
  }
}
