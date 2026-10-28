/* ===========================================================================
   1.18.0 · O CLIENTE (30 out 2026)

   Uma função só — `falar()` — e três dialetos: `openai`, `anthropic`, `google`.
   É o que permite trocar de fornecedor sem tocar nos agentes.

   Contrato de saída (o mesmo para todos):

     { texto, chamadas: [{ id, nome, argumentos }], uso: { entrada, saida },
       fornec, modelo, ms, bruto }

   Regras:
     · a chave viaja só neste processo, em cabeçalho — nunca em URL, nunca em log;
     · toda a chamada tem tempo limite (AbortController) — sem isso um fornecedor
       lento pendura a função da Vercel;
     · erros são classificados (`ErroIA`): 401/403 chave recusada, 402 sem
       crédito, 429 limite, 5xx avaria, tempo esgotado. Só os dois últimos e o
       limite são `retentavel` — repetir uma chave recusada só gasta tempo.
   =========================================================================== */

export class ErroIA extends Error {
  constructor(mensagem, { status = 0, fornec = '', modelo = '', codigo = '', retentavel = false, detalhe = null } = {}) {
    super(mensagem);
    this.name = 'ErroIA';
    this.status = status;
    this.fornec = fornec;
    this.modelo = modelo;
    this.codigo = codigo;
    this.retentavel = retentavel;
    this.detalhe = detalhe;
  }
}

const SEM_APELIDO = (t) => String(t || '').slice(0, 300);

function classificar(status, corpao, { fornec, modelo }) {
  const detalhe = corpao?.error?.message || corpao?.message || corpao?.error?.type || '';
  const base = SEM_APELIDO(detalhe);
  if (status === 401 || status === 403) return new ErroIA(`chave recusada por ${fornec}${base ? `: ${base}` : ''}`, { status, fornec, modelo, codigo: 'chave', detalhe: corpao });
  /* 402 é «este fornecedor não dá mais hoje» — o Pollinations usa-o para o
     limite por IP. Retentável, mas noutro fornecedor: o router passa ao seguinte. */
  if (status === 402) return new ErroIA(`sem crédito em ${fornec}${base ? `: ${base}` : ''}`, { status, fornec, modelo, codigo: 'credito', retentavel: true, detalhe: corpao });
  if (status === 404) return new ErroIA(`modelo «${modelo}» não existe em ${fornec}${base ? `: ${base}` : ''}`, { status, fornec, modelo, codigo: 'modelo', detalhe: corpao });
  if (status === 429) return new ErroIA(`limite de utilização em ${fornec}${base ? `: ${base}` : ''}`, { status, fornec, modelo, codigo: 'limite', retentavel: true, detalhe: corpao });
  if (status >= 500) return new ErroIA(`${fornec} avariou (HTTP ${status})${base ? `: ${base}` : ''}`, { status, fornec, modelo, codigo: 'avaria', retentavel: true, detalhe: corpao });
  return new ErroIA(`${fornec} recusou o pedido (HTTP ${status})${base ? `: ${base}` : ''}`, { status, fornec, modelo, codigo: 'pedido', detalhe: corpao });
}

/* ---------- tradução de cabeçalhos ---------- */
function cabecalhos(prov, chave) {
  const h = { 'content-type': 'application/json' };
  if (prov.keyless && !chave) return h;         // anónimo: nem um Bearer vazio se manda
  if (prov.estilo === 'anthropic') {
    h['x-api-key'] = chave;
    h['anthropic-version'] = '2023-06-01';
  } else if (prov.estilo === 'google') {
    h['x-goog-api-key'] = chave;          // cabeçalho, não `?key=` — não fica em logs de URL
  } else {
    h.authorization = `Bearer ${chave}`;
    Object.assign(h, prov.cabecalhos || {});
  }
  return h;
}

/* ---------- tradução de mensagens ---------- */

/* 1.46.0 · uma mensagem pode ter mais do que texto: uma fotografia de papel.
   O formato interno é `content: [{ type:'text', text }, { type:'image', mime, base64 }]`
   e cada dialeto recebe o que sabe ler — imagem em data-URL no OpenAI, `inline_data`
   no Google, `source.base64` no Anthropic. Um `content` em texto continua a ser
   texto: nada muda para quem nunca manda imagens. */
const partesDe = (content) => (Array.isArray(content)
  ? content.map((p) => (p?.type === 'image'
    ? { tipo: 'imagem', mime: String(p.mime || 'image/jpeg'), base64: String(p.base64 || '') }
    : { tipo: 'texto', texto: String(p?.text ?? p?.content ?? '') }))
  : null);

function paraOpenAI(mensagens) {
  return mensagens.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, name: m.name, content: String(m.content ?? '') };
    if (m.role === 'assistant' && m.tool_calls) return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls };
    const partes = partesDe(m.content);
    if (partes) {
      return {
        role: m.role,
        content: partes.map((x) => (x.tipo === 'imagem'
          ? { type: 'image_url', image_url: { url: `data:${x.mime};base64,${x.base64}` } }
          : { type: 'text', text: x.texto })),
      };
    }
    return { role: m.role, content: String(m.content ?? '') };
  });
}

function paraAnthropic(mensagens) {
  const sistema = mensagens.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n\n');
  const resto = [];
  for (const m of mensagens) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const bloco = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') };
      const ultima = resto[resto.length - 1];
      if (ultima && ultima.role === 'user' && Array.isArray(ultima.content)) ultima.content.push(bloco);
      else resto.push({ role: 'user', content: [bloco] });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: String(m.content) });
      for (const c of m.tool_calls) {
        let entrada = {};
        try { entrada = JSON.parse(c.function?.arguments || '{}'); } catch { entrada = {}; }
        content.push({ type: 'tool_use', id: c.id, name: c.function?.name, input: entrada });
      }
      resto.push({ role: 'assistant', content });
      continue;
    }
    const partes = partesDe(m.content);
    if (partes) {
      resto.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: partes.map((x) => (x.tipo === 'imagem'
        ? { type: 'image', source: { type: 'base64', media_type: x.mime, data: x.base64 } }
        : { type: 'text', text: x.texto })) });
      continue;
    }
    resto.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: [{ type: 'text', text: String(m.content ?? '') }] });
  }
  return { sistema, resto };
}

function paraGoogle(mensagens) {
  const sistema = mensagens.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n\n');
  const contents = [];
  for (const m of mensagens) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      contents.push({ role: 'user', parts: [{ functionResponse: { name: m.name || 'ferramenta', response: { resultado: String(m.content ?? '') } } }] });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const parts = [];
      if (m.content) parts.push({ text: String(m.content) });
      for (const c of m.tool_calls) {
        let args = {};
        try { args = JSON.parse(c.function?.arguments || '{}'); } catch { args = {}; }
        parts.push({ functionCall: { name: c.function?.name, args } });
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    const partes = partesDe(m.content);
    if (partes) {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: partes.map((x) => (x.tipo === 'imagem'
        ? { inline_data: { mime_type: x.mime, data: x.base64 } }
        : { text: x.texto })) });
      continue;
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content ?? '') }] });
  }
  return { sistema, contents };
}

function esquemaFerramentas(ferramentas = []) {
  return ferramentas.map((f) => ({ name: f.nome, description: f.descricao, parameters: f.parametros }));
}

/* ---------- a chamada ---------- */
/* 1.45.2 · o tier anónimo do Pollinations tem DUAS portas, e elas não caem
   juntas. A 28 out 2026 (11h UTC) a porta OpenAI (`POST text.pollinations.ai/openai`)
   respondia 502 «Chat Completions provider returned an empty response» a todos os
   modelos, enquanto `GET text.pollinations.ai/<prompt>?model=openai` respondia
   «orbita» em menos de 1 s. O código só conhecia a primeira. Aqui a segunda passa
   a ser o recurso quando a primeira avaria — mas só para os nomes que a rota GET
   honra de facto (`GET_POLLINATIONS`): um `community/…` qualquer nunca provaria
   por esta porta, porque o GET devolveria o modelo por omissão e isso seria mentir
   na lista dos provados. Sem ferramentas: o GET é só texto. */
const GET_POLLINATIONS = new Set(['openai-fast', 'openai', 'openai-large']);

function urlGetPollinations(prov, modelo, mensagens) {
  const sistema = mensagens.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n').trim();
  const ultima = [...mensagens].reverse().find((m) => m.role === 'user');
  const params = new URLSearchParams({ model: modelo, referrer: 'orbita-studio' });
  if (sistema) params.set('system', sistema.slice(0, 3000));
  const prompt = encodeURIComponent(String(ultima?.content || '').slice(0, 6000));
  return `${prov.base}/${prompt}?${params}`;
}

export async function falar({
  fornec, prov, chave, modelo, mensagens, ferramentas = [],
  maxTokens = 1200, temperatura = 0.3, timeoutMs = 45000, fetchImpl = fetch,
}) {
  if (!chave && !prov.keyless) throw new ErroIA(`falta a chave de ${fornec} no ambiente`, { fornec, modelo, codigo: 'semchave' });
  if (!modelo) throw new ErroIA(`falta o modelo para ${fornec}`, { fornec, codigo: 'semmodelo' });

  const inicio = Date.now();
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), timeoutMs);
  let url;
  let corpo;

  if (prov.estilo === 'anthropic') {
    const { sistema, resto } = paraAnthropic(mensagens);
    url = `${prov.base}/v1/messages`;
    corpo = {
      model: modelo, max_tokens: maxTokens, temperature: temperatura,
      messages: resto,
      ...(sistema ? { system: sistema } : {}),
      ...(ferramentas.length ? { tools: ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.parametros })) } : {}),
    };
  } else if (prov.estilo === 'google') {
    const { sistema, contents } = paraGoogle(mensagens);
    url = `${prov.base}/models/${encodeURIComponent(modelo)}:generateContent`;
    corpo = {
      contents,
      ...(sistema ? { systemInstruction: { parts: [{ text: sistema }] } } : {}),
      ...(ferramentas.length ? { tools: [{ functionDeclarations: esquemaFerramentas(ferramentas) }] } : {}),
      generationConfig: { maxOutputTokens: maxTokens, temperature: temperatura },
    };
  } else if (prov.estilo === 'pollinations') {
    /* 1.42.0 · o Pollinations, a sério.
       Antes disto era sempre o tier anónimo por GET — um prompt no caminho,
       resposta em texto, sem ferramentas e 1 pedido a cada 15 s. Agora:
         · com chave (`POLLINATIONS_API_KEY`): `gen.pollinations.ai/v1`, que é
           OpenAI-compatível, com os modelos do tier e Bearer no cabeçalho;
         · sem chave: `POST text.pollinations.ai/openai` — também OpenAI-
           compatível, com o modelo anónimo (`openai-fast`) e ferramentas.
       O GET antigo fica só como último recurso, para o caso de a rota /openai
       desaparecer. */
    const comChave = !!chave && !!prov.baseChave;
    const pedido = {
      model: modelo,
      messages: paraOpenAI(mensagens),
      max_tokens: maxTokens,
      temperature: temperatura,
      ...(ferramentas.length ? { tools: ferramentas.map((f) => ({ type: 'function', function: { name: f.nome, description: f.descricao, parameters: f.parametros } })) } : {}),
    };
    if (comChave) {
      url = `${prov.baseChave}/chat/completions`;
      corpo = pedido;
    } else if (!prov.semRotaOpenAI) {
      url = `${prov.base}/openai`;
      corpo = { ...pedido, model: modelo || 'openai-fast', referrer: 'orbita-studio' };
    } else {
      url = urlGetPollinations(prov, modelo, mensagens);
      corpo = null;
    }
  } else {
    url = `${prov.base}/chat/completions`;
    corpo = {
      model: modelo,
      messages: paraOpenAI(mensagens),
      max_tokens: maxTokens,
      temperature: temperatura,
      ...(ferramentas.length ? { tools: ferramentas.map((f) => ({ type: 'function', function: { name: f.nome, description: f.descricao, parameters: f.parametros } })) } : {}),
    };
  }

  let r;
  try {
    r = await fetchImpl(url, {
      method: corpo ? 'POST' : 'GET',
      headers: cabecalhos(prov, chave),
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(relogio);
    const abortado = e?.name === 'AbortError';
    throw new ErroIA(abortado ? `${fornec} não respondeu em ${Math.round(timeoutMs / 1000)} s` : `sem ligação a ${fornec}: ${e.message}`, {
      fornec, modelo, codigo: abortado ? 'tempo' : 'rede', retentavel: true,
    });
  }
  clearTimeout(relogio);

  let texto = await r.text();
  let j = null;
  try { j = texto ? JSON.parse(texto) : null; } catch { j = null; }

  /* 1.45.2 · a porta /openai do tier anónimo caiu (502 em todos os modelos) e a
     porta GET continuava a responder. Antes de declarar a avaria, tenta-se a
     outra porta do MESMO serviço — uma vez. */
  const podeRecurso = prov.estilo === 'pollinations' && !chave && !prov.semRotaOpenAI
    && GET_POLLINATIONS.has(String(modelo));
  const avariou = !r.ok
    ? r.status >= 500
    : (prov.estilo === 'pollinations' && (!j || !j.choices) && !String(texto || '').trim());
  if (podeRecurso && avariou) {
    const ctl2 = new AbortController();
    const relogio2 = setTimeout(() => ctl2.abort(), Math.min(timeoutMs, 20000));
    try {
      const r2 = await fetchImpl(urlGetPollinations(prov, modelo, mensagens), {
        headers: cabecalhos(prov, chave), signal: ctl2.signal,
      });
      const texto2 = await r2.text();
      if (r2.ok && String(texto2 || '').trim()) {
        r = r2; texto = texto2; j = null;
        try { j = texto2 ? JSON.parse(texto2) : null; } catch { j = null; }
      }
    } catch { /* a segunda porta também não deu: fica o erro da primeira */ }
    finally { clearTimeout(relogio2); }
  }
  if (!r.ok) throw classificar(r.status, j || { message: SEM_APELIDO(texto) }, { fornec, modelo });

  const ms = Date.now() - inicio;
  /* o Pollinations responde texto simples; um JSON sem `choices` também não é
     um envelope OpenAI — nos dois casos o texto é a resposta. */
  if (prov.estilo === 'pollinations' && (!j || !j.choices)) {
    const limpo = String(j?.text || j?.content || texto || '').trim();
    if (!limpo) throw new ErroIA(`${fornec} devolveu uma resposta vazia`, { fornec, modelo, codigo: 'vazio', retentavel: true });
    return { texto: limpo, chamadas: [], uso: { entrada: 0, saida: 0 }, fornec, modelo, ms, bruto: j || { texto: limpo } };
  }
  if (!j) throw new ErroIA(`${fornec} devolveu algo que não é JSON`, { fornec, modelo, codigo: 'resposta' });

  /* --- desembrulhar, por dialeto --- */
  if (prov.estilo === 'anthropic') {
    const blocos = j.content || [];
    const txt = blocos.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const chamadas = blocos.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, nome: b.name, argumentos: b.input || {} }));
    return { texto: txt, chamadas, uso: { entrada: j.usage?.input_tokens || 0, saida: j.usage?.output_tokens || 0 }, fornec, modelo: j.model || modelo, ms, bruto: j };
  }
  if (prov.estilo === 'google') {
    const partes = j.candidates?.[0]?.content?.parts || [];
    const txt = partes.filter((p) => p.text).map((p) => p.text).join('\n').trim();
    const chamadas = partes.filter((p) => p.functionCall).map((p, i) => ({ id: `g_${Date.now()}_${i}`, nome: p.functionCall.name, argumentos: p.functionCall.args || {} }));
    return { texto: txt, chamadas, uso: { entrada: j.usageMetadata?.promptTokenCount || 0, saida: j.usageMetadata?.candidatesTokenCount || 0 }, fornec, modelo, ms, bruto: j };
  }

  const m = j.choices?.[0]?.message || {};
  const chamadas = (m.tool_calls || []).map((c, i) => {
    let argumentos = {};
    try { argumentos = JSON.parse(c.function?.arguments || '{}'); } catch { argumentos = { _bruto: c.function?.arguments }; }
    return { id: c.id || `c_${Date.now()}_${i}`, nome: c.function?.name, argumentos };
  });
  return { texto: String(m.content || '').trim(), chamadas, uso: { entrada: j.usage?.prompt_tokens || 0, saida: j.usage?.completion_tokens || 0 }, fornec, modelo: j.model || modelo, ms, bruto: j };
}

/* ---------- descoberta de modelos (a verdade, não o catálogo) ---------- */
/**
 * 1.43.0 · a lista COM o que o fornecedor diz de cada modelo.
 *
 * `listarModelos` devolve só ids porque é disso que o teste precisa. Mas o
 * catálogo do Pollinations traz `paid_only`, `tools`, `reasoning` e o contexto
 * — sem isso não se distingue um modelo do tier gratuito de um que só existe
 * para quem paga, e a descoberta enchia a cadeia com modelos impossíveis.
 * Aqui fica tudo o que se sabe ler, sem inventar: o que o fornecedor não disser
 * vem `null`.
 */
export async function listarModelosDetalhados({ fornec, prov, chave, timeoutMs = 15000, fetchImpl = fetch }) {
  if (!chave && !prov.keyless) throw new ErroIA(`falta a chave de ${fornec}`, { fornec, codigo: 'semchave' });
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), timeoutMs);
  const baseLista = prov.estilo === 'pollinations' && chave && prov.baseChave ? prov.baseChave : prov.base;
  const url = prov.estilo === 'anthropic' ? `${prov.base}/v1/models` : `${baseLista}/models`;
  try {
    const r = await fetchImpl(url, { headers: cabecalhos(prov, chave), signal: ctl.signal });
    const texto = await r.text();
    let j = null;
    try { j = texto ? JSON.parse(texto) : null; } catch { j = null; }
    if (!r.ok) throw classificar(r.status, j || {}, { fornec, modelo: '(lista)' });
    const cru = Array.isArray(j) ? j : (j?.data || j?.models || []);
    return cru.map((m) => {
      const id = String(m?.id || m?.name || '').replace(/^models\//, '');
      if (!id) return null;
      return {
        id,
        /* `paid_only` só existe onde o fornecedor o declara (Pollinations). Em
           todos os outros `pago: null` = «não se sabe», e não se presume nada.
           1.45.1 · mas há fornecedores que dizem o mesmo com outras palavras:
           o LLM7 marca os modelos que só existem com conta paga com
           `tier: "pro"` e `usage_based_only: true`. Em produção (28 out 2026)
           isso deu 46 erros em 63 pedidos — todos «Model ... is currently
           unavailable» — e seis modelos pagos a ocupar a lista dos gratuitos.
           Um preço declarado NÃO serve para isto: o OVH publica preços em
           todos os modelos que serve de graça a pedidos anónimos. */
        pago: typeof m?.paid_only === 'boolean'
          ? m.paid_only
          : (m?.usage_based_only === true || String(m?.tier || '').toLowerCase() === 'pro' ? true : null),
        ferramentas: typeof m?.tools === 'boolean' ? m.tools : null,
        raciocinio: typeof m?.reasoning === 'boolean' ? m.reasoning : null,
        janela: Number(m?.context_length) || null,
        visao: Array.isArray(m?.input_modalities) ? m.input_modalities.includes('image') : null,
      };
    }).filter(Boolean).slice(0, 400);
  } catch (e) {
    if (e instanceof ErroIA) throw e;
    throw new ErroIA(`sem ligação a ${fornec}: ${e.message}`, { fornec, codigo: e?.name === 'AbortError' ? 'tempo' : 'rede', retentavel: true });
  } finally {
    clearTimeout(relogio);
  }
}

export async function listarModelos({ fornec, prov, chave, timeoutMs = 15000, fetchImpl = fetch }) {
  if (!chave && !prov.keyless) throw new ErroIA(`falta a chave de ${fornec}`, { fornec, codigo: 'semchave' });
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), timeoutMs);
  /* 1.42.0 · no Pollinations a lista muda com o tier: com chave a verdade está
     em `gen.pollinations.ai/v1/models` (traz `paid_only`, `tools`, contexto). */
  const baseLista = prov.estilo === 'pollinations' && chave && prov.baseChave ? prov.baseChave : prov.base;
  const url = prov.estilo === 'anthropic' ? `${prov.base}/v1/models` : `${baseLista}/models`;
  try {
    const r = await fetchImpl(url, { headers: cabecalhos(prov, chave), signal: ctl.signal });
    const texto = await r.text();
    let j = null;
    try { j = texto ? JSON.parse(texto) : null; } catch { j = null; }
    if (!r.ok) throw classificar(r.status, j || {}, { fornec, modelo: '(lista)' });
    /* 1.33.0 · o Pollinations devolve um array na raiz ([{name, description…}]) */
    const cru = Array.isArray(j) ? j : (j?.data || j?.models || []);
    const lista = cru.map((m) => String(m?.id || m?.name || '').replace(/^models\//, '')).filter(Boolean);
    return lista.slice(0, 200);
  } catch (e) {
    if (e instanceof ErroIA) throw e;
    throw new ErroIA(`sem ligação a ${fornec}: ${e.message}`, { fornec, codigo: e?.name === 'AbortError' ? 'tempo' : 'rede', retentavel: true });
  } finally {
    clearTimeout(relogio);
  }
}
