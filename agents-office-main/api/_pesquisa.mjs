/* ===========================================================================
   A pesquisa do escritório, do lado do servidor (1.25.0, 27 out 2026).

   Porquê este ficheiro: a pesquisa que existia vivia em `serve.mjs`, ou seja,
   só funcionava quando o escritório corria na máquina de quem o abria. Na
   versão publicada (o que o dono usa) os agentes não conseguiam procurar nada.
   Aqui a pesquisa passa a ser servida pela função da Vercel, ao lado do resto.

   Duas fontes, cada uma com o seu trabalho — e nenhuma delas inventada:

     · Tavily — A PESQUISA PRINCIPAL do escritório. Devolve resposta curta,
       excertos e links, com modo notícias e recorte temporal; e `extract` lê
       uma página inteira quando é preciso ir ao detalhe. É daqui que sai todo o
       contexto: mercado, concorrência, notícias, o que a empresa diz de si.
     · Geoapify — fichas de empresa reais (dados do OpenStreetMap) e
       geocodificação. É a fonte dos LEADS, porque é a única que dá telefone,
       morada estruturada e o sinal «não tem site» — e é esse sinal que faz um
       lead valer 80 em vez de 48.

   O Google saiu (1.29.0). Exigia chave com cartão ligado, duas APIs diferentes
   e duas contas de configuração; a Tavily faz o mesmo trabalho sem cartão e
   numa chave só. Manter o código do Google era manter uma promessa que ninguém
   tinha ligado — e um caminho a mais para explicar a quem usa o escritório.

   Regras:
     · As chaves vivem SÓ no ambiente (variáveis da Vercel, cifradas em repouso
       pela plataforma). Nunca são escritas em ficheiros, nunca voltam ao
       browser e nunca aparecem numa mensagem de erro — há `mascarar()` para
       isso e testes que o provam.
     · Sem chave, a resposta diz exactamente que variável falta.
     · Nada disto envia correio nem contacta ninguém: procurar não é falar.
   =========================================================================== */

const GEOCODE = 'https://api.geoapify.com/v1/geocode/search';
const PLACES = 'https://api.geoapify.com/v2/places';
const TAVILY = 'https://api.tavily.com';

/** Esconde um segredo para se poder falar dele sem o mostrar. */
export const mascarar = (s) => {
  const t = String(s || '');
  if (t.length < 8) return t ? '••••' : '';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
};

const tem = (env, ...nomes) => { for (const n of nomes) if (env?.[n]) return { valor: env[n], nome: n }; return null; };

/** O que está ligado, e porquê — em português, sem prometer o que não há. */
export function estado(env = process.env) {
  const tav = tem(env, 'TAVILY_API_KEY', 'TAVILY_KEY');
  const geo = tem(env, 'GEOAPIFY_API_KEY', 'GEOAPIFY_KEY');
  return {
    /* a ordem não é decorativa: a primeira linha é a pesquisa principal */
    principal: 'tavily',
    tavily: {
      disponivel: !!tav,
      papel: 'principal',
      env: tav?.nome || 'TAVILY_API_KEY',
      motivo: tav ? null : 'falta TAVILY_API_KEY no ambiente (cria a chave em app.tavily.com)',
      oQue: 'pesquisa web com excertos e resposta curta, notícias e leitura de páginas — é a pesquisa principal',
      docs: 'https://app.tavily.com',
    },
    geoapify: {
      disponivel: !!geo,
      papel: 'leads',
      env: geo?.nome || 'GEOAPIFY_API_KEY',
      motivo: geo ? null : 'falta GEOAPIFY_API_KEY no ambiente (cria a chave em myprojects.geoapify.com)',
      oQue: 'empresas reais por categoria e zona (OpenStreetMap) — é a fonte dos leads',
      docs: 'https://myprojects.geoapify.com',
    },
    qualquer: !!(tav || geo),
    nota: 'a Tavily é a pesquisa principal (contexto, notícias, páginas); o Geoapify dá as fichas de empresa. Procurar não contacta ninguém: enviar continua a exigir o teu OK.',
  };
}

/* ---------- categorias: a atividade dita em português → categoria Geoapify ----------
   A Places API do Geoapify procura por CATEGORIA + centro + raio, não por texto
   livre. Em vez de mandar o que o dono escreveu às cegas (e devolver restaurantes
   quando ele pediu dentistas), há uma tabela pequena e explícita. O que não está
   aqui não é adivinhado: diz-se que não está. */
export const CATEGORIAS = [
  { id: 'dentista', categoria: 'healthcare.dentist', palavras: ['dentista', 'dentaria', 'dentárias', 'dentaria', 'ortodont', 'clinica dentaria', 'clínica dentária', 'dental'] },
  { id: 'clinica', categoria: 'healthcare.clinic_or_praxis', palavras: ['clinica', 'clínica', 'consultorio', 'consultório', 'medico', 'médico', 'fisioterapia', 'psicolog'] },
  { id: 'farmacia', categoria: 'healthcare.pharmacy', palavras: ['farmacia', 'farmácia'] },
  { id: 'veterinario', categoria: 'healthcare.veterinarian', palavras: ['veterinar', 'veterinário'] },
  { id: 'restaurante', categoria: 'catering.restaurant', palavras: ['restaurante', 'restaurant', 'tasca', 'marisqueira'] },
  { id: 'cafe', categoria: 'catering.cafe', palavras: ['cafe', 'café', 'cafetaria', 'pastelaria', 'padaria', 'bakery'] },
  { id: 'bar', categoria: 'catering.bar', palavras: ['bar', 'pub', 'cervejaria'] },
  { id: 'hotel', categoria: 'accommodation.hotel', palavras: ['hotel', 'pousada', 'alojamento', 'hostel', 'turismo rural'] },
  { id: 'ginasio', categoria: 'sport.fitness.fitness_centre', palavras: ['ginasio', 'ginásio', 'gym', 'fitness', 'crossfit', 'pilates'] },
  { id: 'cabeleireiro', categoria: 'service.beauty.hairdresser', palavras: ['cabeleireiro', 'cabeleireira', 'barbeiro', 'barbearia', 'estetica', 'estética', 'beleza', 'unhas'] },
  { id: 'advogado', categoria: 'office.lawyer', palavras: ['advogado', 'advogada', 'solicitador', 'juridico', 'jurídico'] },
  { id: 'contabilista', categoria: 'office.accountant', palavras: ['contabilista', 'contabilidade', 'contabil', 'contábil', 'fiscal'] },
  { id: 'arquiteto', categoria: 'office.architect', palavras: ['arquiteto', 'arquitecto', 'arquitetura', 'arquitectura'] },
  { id: 'imobiliaria', categoria: 'office.estate_agent', palavras: ['imobiliaria', 'imobiliária', 'mediação imobiliária', 'remax'] },
  { id: 'seguros', categoria: 'office.insurance', palavras: ['seguros', 'seguradora', 'corretor de seguros'] },
  { id: 'oficina', categoria: 'service.vehicle.repair.car', palavras: ['oficina', 'mecanico', 'mecânico', 'auto', 'pneus', 'carro'] },
  { id: 'construcao', categoria: 'building.construction', palavras: ['construcao', 'construção', 'obras', 'empreiteiro', 'remodela'] },
  { id: 'eletricista', categoria: 'service.electrician', palavras: ['eletricista', 'electricista'] },
  { id: 'canalizador', categoria: 'service.plumber', palavras: ['canalizador', 'picheleiro'] },
  { id: 'loja', categoria: 'commercial', palavras: ['loja', 'comercio', 'comércio', 'retalho'] },
  { id: 'supermercado', categoria: 'commercial.supermarket', palavras: ['supermercado', 'mercearia', 'minimercado'] },
  { id: 'florista', categoria: 'commercial.florist', palavras: ['florista', 'flores'] },
  { id: 'escola', categoria: 'education.school', palavras: ['escola', 'colegio', 'colégio', 'explicações', 'explicacoes', 'formacao', 'formação'] },
  { id: 'fotografo', categoria: 'service.photographer', palavras: ['fotografo', 'fotógrafo', 'fotografia'] },
  { id: 'lavandaria', categoria: 'service.laundry', palavras: ['lavandaria', 'lavagem'] },
];

const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/* Um sítio do OSM pode trazer dois números no mesmo campo («239…; 910…»).
   Ficamos com o primeiro: juntá-los dava um número que não existe. */
const primeiroTelefone = (s) => {
  const primeiro = String(s || '').split(/[;,/]|\bou\b/i)[0].trim();
  const so = primeiro.replace(/[^\d+]/g, '');
  return (so.startsWith('+') ? '+' : '') + so.replace(/\+/g, '');
};

/** Traduz uma atividade escrita à mão para a categoria do Geoapify. */
export function acharCategoria(texto) {
  const t = semAcentos(texto);
  if (!t) return null;
  /* uma categoria já em formato Geoapify passa tal e qual (`catering.restaurant`) */
  if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(String(texto).trim())) {
    return { id: 'directo', categoria: String(texto).trim() };
  }
  let melhor = null;
  for (const c of CATEGORIAS) {
    for (const p of c.palavras) {
      const alvo = semAcentos(p);
      if (t.includes(alvo) && (!melhor || alvo.length > melhor.ganho)) melhor = { id: c.id, categoria: c.categoria, ganho: alvo.length };
    }
  }
  return melhor ? { id: melhor.id, categoria: melhor.categoria } : null;
}

/* ---------- rede: um pedido, com tempo limite e sem vazar a chave ---------- */
async function pedirJson(url, opcoes, fetchImpl, segundos = 20) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), segundos * 1000);
  try {
    return await fetchImpl(url, { ...opcoes, signal: ctl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`o serviço não respondeu em ${segundos} s`);
    throw new Error(`não consegui chegar ao serviço: ${String(e?.message || e).slice(0, 120)}`);
  } finally { clearTimeout(t); }
}

async function corpoDeErro(r) {
  try { const j = await r.json(); return j?.message || j?.detail || j?.error?.message || j?.error || ''; } catch { return ''; }
}

/** A chave nunca entra numa mensagem: só a fonte e o código HTTP. */
function erroHttp(quem, r, detalhe) {
  const d = typeof detalhe === 'string' ? detalhe.slice(0, 160) : '';
  if (r.status === 401 || r.status === 403) return new Error(`${quem} recusou a chave (HTTP ${r.status})${d ? ': ' + d : ''} — confirma a variável de ambiente`);
  if (r.status === 429) return new Error(`${quem} está a limitar os pedidos (HTTP 429) — espera um pouco ou sobe o plano`);
  return new Error(`${quem} respondeu HTTP ${r.status}${d ? ': ' + d : ''}`);
}

/* ---------- Geoapify: geocodificar ---------- */
export async function geocodificar({ texto, limite = 1, pais = null, lang = 'pt' } = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const k = tem(env, 'GEOAPIFY_API_KEY', 'GEOAPIFY_KEY');
  if (!k) throw new Error('falta GEOAPIFY_API_KEY no ambiente');
  if (!String(texto || '').trim()) throw new Error('diz o sítio a geocodificar (por exemplo «Coimbra, Portugal»)');
  const q = new URLSearchParams({ text: String(texto), limit: String(Math.max(1, Math.min(10, limite))), lang, format: 'json' });
  if (pais) q.set('filter', `countrycode:${String(pais).toLowerCase()}`);
  q.set('apiKey', k.valor);
  const r = await pedirJson(`${GEOCODE}?${q}`, { method: 'GET' }, fetchImpl, 15);
  if (!r.ok) throw erroHttp('o Geoapify', r, await corpoDeErro(r));
  const j = await r.json();
  const lista = Array.isArray(j?.results) ? j.results : [];
  return lista.map((p) => ({
    texto: p.formatted || p.address_line1 || String(texto),
    cidade: p.city || p.town || p.village || p.county || '',
    pais: p.country || '',
    codigoPais: String(p.country_code || '').toUpperCase(),
    lat: Number(p.lat), lon: Number(p.lon),
    tipo: p.result_type || '',
    bbox: Array.isArray(p.bbox) ? p.bbox : null,
  })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

/* ---------- Geoapify: empresas reais ---------- */
function leadDeSitio(f, alvo) {
  const p = f?.properties || {};
  const cru = p.datasource?.raw || {};
  const nome = String(p.name || cru.name || '').trim();
  if (!nome) return null;
  const telefone = primeiroTelefone(p.phone || cru.phone || cru['contact:phone'] || cru.mobile || '');
  const website = String(p.website || cru.website || cru['contact:website'] || '').trim();
  const email = String(p.email || cru.email || cru['contact:email'] || '').trim();
  const cidade = String(p.city || p.town || p.village || p.county || alvo?.cidade || '').trim();
  const morada = String(p.formatted || [p.street, p.housenumber, p.postcode, cidade].filter(Boolean).join(', ')).trim();
  const categorias = Array.isArray(p.categories) ? p.categories : [];
  /* A lista do OSM mistura a atividade com etiquetas (`wheelchair.yes`,
     `payment.cards`). A atividade é a mais específica que sobra depois de as
     tirar; se não sobrar nenhuma, vale a que foi pedida. */
  const TAGS = /^(wheelchair|access|payment|organic|vegetarian|vegan|smoking|internet_access|dog|fee|covered|surveillance|opening_hours|operator|brand|wikidata|wikipedia|no|yes)\b/i;
  const atividades = categorias.filter((c) => !TAGS.test(String(c)));
  const especifica = [...atividades].reverse().find((c) => String(c).includes('.'))
    || atividades[0] || p.category || alvo?.categoria || '';
  const { nota, porque } = notaDeLead({ website, telefone, email, categorias: especifica ? [especifica] : [] });
  return {
    fonte: 'geoapify',
    nome,
    categoria: especifica || alvo?.categoria || '',
    cidade,
    morada,
    telefone,
    website,
    email,
    lat: Number(p.lat), lon: Number(p.lon),
    distancia: p.distance == null ? null : Math.round(Number(p.distance)),
    sítioId: p.place_id || '',
    nota,
    porque,
  };
}

/** A nota de oportunidade — a mesma lógica do resto da casa, com a razão escrita. */
export function notaDeLead({ website, telefone, email, categorias = [] } = {}) {
  const bits = [];
  let nota = 40;
  if (!website) { nota += 40; bits.push('sem site'); } else bits.push('já tem site');
  if (telefone) { nota += 8; bits.push('telefone público'); } else bits.push('sem telefone público');
  if (email) { nota += 6; bits.push('email público'); }
  if (categorias.length) bits.push(categorias.slice(0, 2).join(' · '));
  return { nota: Math.max(0, Math.min(100, nota)), porque: bits.join(' · ') };
}

/** Procura empresas: geocodifica a zona, depois pede os sítios daquela categoria. */
export async function procurarLeads({ oQue, onde, categoria = null, limite = 20, raio = 12000, lang = 'pt', pais = null } = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const cat = categoria ? (acharCategoria(categoria) || { id: 'directo', categoria }) : acharCategoria(oQue);
  if (!cat) {
    throw new Error(`não sei que categoria procurar para «${oQue}» — diz uma atividade conhecida (${CATEGORIAS.slice(0, 10).map((c) => c.id).join(', ')}, …) ou a categoria do Geoapify (ex.: catering.restaurant)`);
  }
  if (!String(onde || '').trim()) throw new Error('diz a zona (por exemplo «Coimbra»)');
  const [centro] = await geocodificar({ texto: onde, limite: 1, pais, lang }, { env, fetchImpl });
  if (!centro) throw new Error(`não encontrei «${onde}» — tenta «cidade, país»`);
  const k = tem(env, 'GEOAPIFY_API_KEY', 'GEOAPIFY_KEY');
  const q = new URLSearchParams({
    categories: cat.categoria,
    filter: `circle:${centro.lon},${centro.lat},${Math.max(100, Math.min(50000, Number(raio) || 12000))}`,
    limit: String(Math.max(1, Math.min(50, Number(limite) || 20))),
    lang,
    apiKey: k.valor,
  });
  const r = await pedirJson(`${PLACES}?${q}`, { method: 'GET' }, fetchImpl, 20);
  if (!r.ok) throw erroHttp('o Geoapify', r, await corpoDeErro(r));
  const j = await r.json();
  const alvo = { cidade: centro.cidade, categoria: cat.categoria };
  const leads = (Array.isArray(j?.features) ? j.features : []).map((f) => leadDeSitio(f, alvo)).filter(Boolean);
  return { fonte: 'geoapify', categoria: cat.categoria, pedido: { oQue: String(oQue || ''), onde: String(onde), raio: Number(raio) || 12000 }, centro, encontrados: leads.length, leads };
}

/* ---------- Tavily: a web ---------- */
export async function pesquisarWeb({ consulta, q, limite = 8, profundidade = 'basic', resposta = true, topico = 'general', dias = null, dominios = null } = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const k = tem(env, 'TAVILY_API_KEY', 'TAVILY_KEY');
  if (!k) throw new Error('falta TAVILY_API_KEY no ambiente');
  const texto = String(consulta || q || '').trim();
  if (!texto) throw new Error('diz o que pesquisar');
  const noticias = String(topico || '').toLowerCase() === 'news' || String(topico || '').toLowerCase() === 'noticias';
  const corpo = {
    query: texto,
    max_results: Math.max(1, Math.min(20, Number(limite) || 8)),
    search_depth: profundidade === 'advanced' ? 'advanced' : 'basic',
    include_answer: !!resposta,
    topic: noticias ? 'news' : 'general',
  };
  /* Recorte temporal e domínios só existem no que a Tavily aceita: dias com notícias,
     domínios em qualquer modo. O que não faz sentido não é enviado — pedir `days` a
     uma pesquisa geral é um erro que a API devolve, não uma funcionalidade. */
  const janela = Number(dias);
  if (noticias && Number.isFinite(janela) && janela > 0) corpo.days = Math.max(1, Math.min(365, Math.round(janela)));
  if (Array.isArray(dominios) && dominios.length) corpo.include_domains = dominios.slice(0, 10).map(String);
  const r = await pedirJson(`${TAVILY}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${k.valor}` },
    body: JSON.stringify(corpo),
  }, fetchImpl, 25);
  if (!r.ok) throw erroHttp('a Tavily', r, await corpoDeErro(r));
  const j = await r.json();
  const resultados = (Array.isArray(j?.results) ? j.results : []).map((x) => ({
    titulo: String(x.title || ''),
    url: String(x.url || ''),
    excerto: String(x.content || '').slice(0, 1200),
    relevancia: typeof x.score === 'number' ? Math.round(x.score * 100) / 100 : null,
    publicado: x.published_date || null,
  }));
  return { fonte: 'tavily', consulta: texto, topico: noticias ? 'news' : 'general', respostaCurta: j?.answer || null, resultados, encontrados: resultados.length };
}

/** Extrai o texto limpo de um endereço já conhecido (Tavily /extract). */
export async function extrairPagina({ url } = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const k = tem(env, 'TAVILY_API_KEY', 'TAVILY_KEY');
  if (!k) throw new Error('falta TAVILY_API_KEY no ambiente');
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('passa um endereço http(s) completo');
  const r = await pedirJson(`${TAVILY}/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${k.valor}` },
    body: JSON.stringify({ urls: [String(url)] }),
  }, fetchImpl, 30);
  if (!r.ok) throw erroHttp('a Tavily', r, await corpoDeErro(r));
  const j = await r.json();
  const um = Array.isArray(j?.results) ? j.results[0] : null;
  return { fonte: 'tavily', url: String(url), titulo: um?.title || null, texto: String(um?.raw_content || um?.content || '').slice(0, 20000), falhou: Array.isArray(j?.failed_results) ? j.failed_results : [] };
}

/** Uma sonda de verdade para o botão «Testar ligação» do Centro de Controlo. */
export async function testarFonte(id, { env = process.env, fetchImpl = fetch } = {}) {
  const e = estado(env);
  if (id === 'geoapify') {
    if (!e.geoapify.disponivel) return { ok: false, erro: e.geoapify.motivo, codigo: 'semchave' };
    const t0 = Date.now();
    const [c] = await geocodificar({ texto: 'Coimbra, Portugal', limite: 1 }, { env, fetchImpl });
    if (!c) return { ok: false, ms: Date.now() - t0, erro: 'o Geoapify respondeu sem resultados para «Coimbra, Portugal»', codigo: 'vazio' };
    return { ok: true, ms: Date.now() - t0, status: 200, detalhe: `${c.cidade || c.texto} (${c.lat.toFixed(3)}, ${c.lon.toFixed(3)})`, quando: new Date().toISOString() };
  }
  if (id === 'tavily') {
    if (!e.tavily.disponivel) return { ok: false, erro: e.tavily.motivo, codigo: 'semchave' };
    const t0 = Date.now();
    const r = await pesquisarWeb({ consulta: 'Órbita Studio', limite: 2, resposta: false }, { env, fetchImpl });
    return { ok: true, ms: Date.now() - t0, status: 200, detalhe: `${r.encontrados} resultado(s) reais`, quando: new Date().toISOString() };
  }
  if (id === 'google-places' || id === 'google-search') {
    return { ok: false, erro: 'o Google saiu nesta versão: a pesquisa é Tavily (contexto) e Geoapify (empresas)', codigo: 'saiu' };
  }
  return { ok: false, erro: 'fonte desconhecida', codigo: 'desconhecida' };
}
