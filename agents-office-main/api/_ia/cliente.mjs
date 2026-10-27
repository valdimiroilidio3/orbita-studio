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
  if (status === 402) return new ErroIA(`sem crédito em ${fornec}${base ? `: ${base}` : ''}`, { status, fornec, modelo, codigo: 'credito', detalhe: corpao });
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
function paraOpenAI(mensagens) {
  return mensagens.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, name: m.name, content: String(m.content ?? '') };
    if (m.role === 'assistant' && m.tool_calls) return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls };
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
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content ?? '') }] });
  }
  return { sistema, contents };
}

function esquemaFerramentas(ferramentas = []) {
  return ferramentas.map((f) => ({ name: f.nome, description: f.descricao, parameters: f.parametros }));
}

/* ---------- a chamada ---------- */
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
    r = await fetchImpl(url, { method: 'POST', headers: cabecalhos(prov, chave), body: JSON.stringify(corpo), signal: ctl.signal });
  } catch (e) {
    clearTimeout(relogio);
    const abortado = e?.name === 'AbortError';
    throw new ErroIA(abortado ? `${fornec} não respondeu em ${Math.round(timeoutMs / 1000)} s` : `sem ligação a ${fornec}: ${e.message}`, {
      fornec, modelo, codigo: abortado ? 'tempo' : 'rede', retentavel: true,
    });
  }
  clearTimeout(relogio);

  const texto = await r.text();
  let j = null;
  try { j = texto ? JSON.parse(texto) : null; } catch { j = null; }
  if (!r.ok) throw classificar(r.status, j || { message: SEM_APELIDO(texto) }, { fornec, modelo });

  const ms = Date.now() - inicio;
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
export async function listarModelos({ fornec, prov, chave, timeoutMs = 15000, fetchImpl = fetch }) {
  if (!chave && !prov.keyless) throw new ErroIA(`falta a chave de ${fornec}`, { fornec, codigo: 'semchave' });
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), timeoutMs);
  const url = prov.estilo === 'anthropic' ? `${prov.base}/v1/models` : `${prov.base}/models`;
  try {
    const r = await fetchImpl(url, { headers: cabecalhos(prov, chave), signal: ctl.signal });
    const texto = await r.text();
    let j = null;
    try { j = texto ? JSON.parse(texto) : null; } catch { j = null; }
    if (!r.ok) throw classificar(r.status, j || {}, { fornec, modelo: '(lista)' });
    const lista = (j?.data || j?.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
    return lista.slice(0, 200);
  } catch (e) {
    if (e instanceof ErroIA) throw e;
    throw new ErroIA(`sem ligação a ${fornec}: ${e.message}`, { fornec, codigo: e?.name === 'AbortError' ? 'tempo' : 'rede', retentavel: true });
  } finally {
    clearTimeout(relogio);
  }
}
