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
};

/** O que esta arquitectura NÃO consegue fazer — dito por palavras, não fingido. */
export const INDISPONIVEIS = [
  { id: 'pesquisa_web', porque: 'não há fornecedor de pesquisa configurado (nem chave, nem serviço autorizado)' },
  { id: 'execucao_de_codigo', porque: 'as funções da Vercel não correm código arbitrário dos agentes; é preciso um executor à parte' },
  { id: 'ficheiros_do_workspace', porque: 'o sistema de ficheiros da função é temporário e não é o repositório' },
  { id: 'geracao_de_imagens', porque: 'nenhum fornecedor de imagem está configurado — o Creative Specialist não desenha nada até haver um' },
  { id: 'navegacao_de_sites', porque: 'não há browser controlado no servidor' },
];

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
  if (f.destrutivo && !ctx.aprovado) {
    return { ok: false, precisaAprovacao: true, erro: `«${nome}» é destrutiva e precisa de aprovação humana` };
  }
  const t0 = Date.now();
  try {
    const r = await f.executar(v.valor, ctx);
    return { ...r, ferramenta: nome, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, erro: e.message || 'falhou', ferramenta: nome, ms: Date.now() - t0 };
  }
}
