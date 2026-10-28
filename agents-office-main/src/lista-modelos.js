/* ===========================================================================
   1.52.0 · A LISTA DE MODELOS DO PAINEL DE TAREFAS

   O que estava: o painel de tarefas oferecia três nomes — Sonnet · Opus · Fable
   (`src/models.js`) — porque esses eram os únicos que o motor do CLI local sabia
   correr. O dono apontou-o: «essa lista deve aumentar colocando todas as ias que
   aceitaram responder».

   O que passa a haver: os três da casa **e** todos os pares fornecedor·modelo da
   IA da Órbita que podem responder agora. A regra é a mesma que já governa a
   cadeia (`api/_ia/router.mjs`): um modelo entra na lista se o fornecedor tem
   chave (ou não precisa dela), não está desligado, e — à frente dos outros —
   pesa o que a Órbita já **provou**: uma resposta real medida vale mais do que a
   promessa do catálogo. O que fica de fora é contado, nunca escondido.

   Este ficheiro é puro de propósito (sem DOM, sem fetch): é ele que o teste
   discute, e é ele que o painel, o servidor e o rótulo das tarefas usam — uma
   só verdade sobre «o que é um modelo».
   =========================================================================== */

/** O separador da escolha. O mesmo da conversa (`src/composer.js`): `fornecedor|modelo`. */
export const PAR_SEP = '|';

/** Os três da casa, com o nome que o painel sempre mostrou. */
export const DA_CASA = [
  { valor: 'sonnet', etiqueta: 'Sonnet', nota: 'padrão do escritório' },
  { valor: 'opus', etiqueta: 'Opus', nota: 'raciocínio (Alto)' },
  { valor: 'fable', etiqueta: 'Fable', nota: 'texto longo' },
];

export const chaveDoPar = (fornecedor, modelo) => `${String(fornecedor || '')}${PAR_SEP}${String(modelo || '')}`;

/** `openrouter|qwen/qwen3-coder:free` → { fornecedor, modelo }; qualquer outra coisa → null.
    Um nome do CLI («sonnet») nunca é confundido com um par. */
export function parDeModelo(valor) {
  const s = String(valor || '');
  const i = s.indexOf(PAR_SEP);
  if (i <= 0 || i === s.length - 1) return null;
  const fornecedor = s.slice(0, i);
  const modelo = s.slice(i + 1);
  return fornecedor && modelo ? { fornecedor, modelo } : null;
}

/** O nome curto de um modelo da Órbita: o que vem depois da última barra. */
export const nomeCurto = (modelo) => {
  const s = String(modelo || '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
};

/* Os nomes dos fornecedores que interessam ao rótulo de uma tarefa. É uma cópia
   curta do catálogo (api/_ia/catalogo.mjs) para o rótulo não depender de uma
   chamada de rede: um cartão já desenhado tem de dizer quem trabalhou. */
export const NOMES_FORNECEDOR = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google AI Studio', groq: 'Groq',
  cerebras: 'Cerebras', mistral: 'Mistral', huggingface: 'Hugging Face', nvidia: 'NVIDIA NIM',
  deepseek: 'DeepSeek', openrouter: 'OpenRouter', vercel: 'Vercel AI Gateway',
  pollinations: 'Pollinations', llm7: 'LLM7', ovh: 'OVH AI Endpoints', opencode: 'OpenCode Zen',
  tavily: 'Tavily', fireworks: 'Fireworks', cloudflare: 'Cloudflare',
};

/** O rótulo de uma escolha: «Sonnet» · «Qwen3.5-9B · OVH AI Endpoints».
    É o que o cartão da tarefa escreve em «feito com …». */
export function etiquetaDoModelo(valor, nomes = {}) {
  const par = parDeModelo(valor);
  if (par) return `${nomeCurto(par.modelo)} · ${nomes[par.fornecedor] || NOMES_FORNECEDOR[par.fornecedor] || par.fornecedor}`;
  const daCasa = DA_CASA.find((m) => m.valor === String(valor || '').toLowerCase());
  return daCasa ? daCasa.etiqueta : String(valor || '');
}

/* ---------------------------------------------------------------- a lista
   `catalogo` = o corpo de GET /ia/modelos
   `estado`   = o corpo de GET /ia/estado (opcional: sem ele vale o catálogo)
   `provas`   = { provados: [{fornec,modelo}], ms: {'fornec\u0000modelo': 1500} }
                (o que /ia/estado e /ia/uso já sabem; o servidor local passa-o)
   Devolve { grupos, contagem } — grupos prontos a desenhar num <select>. */
export function opcoesDoCatalogo(catalogo, estado = {}, provas = {}) {
  const lista = Array.isArray(catalogo?.fornecedores) ? catalogo.fornecedores : [];
  const st = new Map(((estado && estado.fornecedores) || []).filter(Boolean).map((f) => [f.id, f]));
  const provados = new Set((provas.provados || []).map((p) => `${p.fornec}\u0000${p.modelo}`));
  const ms = provas.ms || {};

  const opcoes = [];
  const vistos = new Set();
  let semChave = 0, desligados = 0, inuteis = 0;
  const nomes = {};

  for (const f of lista) {
    if (!f || !f.id) continue;
    nomes[f.id] = f.nome || f.id;
    const s = st.get(f.id) || {};
    if (f.desligado === true || s.desligado === true || s.estado === 'desligado') { desligados += 1; continue; }
    if (s.estado === 'inutilizavel' || f.estado === 'inutilizavel') { inuteis += 1; continue; }
    const pode = f.comChave === true || s.configurado === true || s.comChaveAgora === true;
    if (!pode) { semChave += 1; continue; }
    for (const x of f.catalogo || []) {
      const modelo = typeof x === 'string' ? x : (x && x.modelo);
      if (!modelo) continue;
      const chave = chaveDoPar(f.id, modelo);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const latencia = Number(ms[`${f.id}\u0000${modelo}`]) || null;
      opcoes.push({
        valor: chave,
        etiqueta: `${nomeCurto(modelo)} · ${f.nome || f.id}`,
        fornecedor: f.id,
        modelo,
        gratis: !!(x && typeof x === 'object' ? x.gratuito : f.gratuito),
        provado: provados.has(`${f.id}\u0000${modelo}`),
        latencia,
      });
    }
  }

  /* A ordem é a da evidência, e é dita:
     1) resposta real medida (mais depressa primeiro) — quem já respondeu;
     2) provado sem latência guardada;
     3) gratuito;
     4) nome. */
  const peso = (m) => [m.latencia ? 0 : m.provado ? 1 : 2, m.latencia || 1e9, m.gratis ? 0 : 1, m.etiqueta.toLowerCase()];
  opcoes.sort((a, b) => {
    const pa = peso(a), pb = peso(b);
    for (let i = 0; i < pa.length; i += 1) {
      if (pa[i] < pb[i]) return -1;
      if (pa[i] > pb[i]) return 1;
    }
    return 0;
  });

  const grupos = [{ rotulo: 'Nesta máquina', opcoes: DA_CASA.map((m) => ({ ...m })) }];
  if (opcoes.length) {
    const provadosN = opcoes.filter((m) => m.provado || m.latencia).length;
    grupos.push({
      rotulo: `IA da Órbita — ${opcoes.length} modelo(s)${provadosN ? `, ${provadosN} já responderam` : ''}`,
      opcoes: opcoes.map((m) => ({
        valor: m.valor,
        etiqueta: m.etiqueta + (m.provado || m.latencia ? ' · provado' : m.gratis ? ' · grátis' : ''),
      })),
    });
  }
  return { grupos, contagem: { casa: DA_CASA.length, orbita: opcoes.length, semChave, desligados, inuteis }, nomes };
}

/** A frase que o painel mostra por baixo da lista — o que ficou de fora e porquê. */
export function notaDaLista(contagem = {}) {
  const fora = [];
  if (contagem.semChave) fora.push(`${contagem.semChave} fornecedor(es) sem chave`);
  if (contagem.desligados) fora.push(`${contagem.desligados} desligado(s)`);
  if (contagem.inuteis) fora.push(`${contagem.inuteis} inutilizável(is)`);
  const orbita = Number(contagem.orbita) || 0;
  if (!orbita) return 'A IA da Órbita não tem, agora, nenhum modelo com chave: a lista fica nos três desta máquina. Liga uma chave no Control Center (Mesa → IA).';
  return `${orbita} modelo(s) da IA da Órbita${fora.length ? ` · fora da lista: ${fora.join(', ')}` : ''}`;
}
