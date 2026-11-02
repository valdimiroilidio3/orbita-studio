/* ===========================================================================
   1.59.0 · LEADS COMO CRM — as contas que transformam uma lista em funil
   (2 nov 2026)

   O dono pediu que a prospecção valesse: dados verificáveis, contactos que
   avançam para oportunidade, e nada inventado. As regras que decidem isso
   vivem aqui, puras (sem DOM, sem rede), para poderem ser provadas:

     · `confianca()` — quanta fé merece o que está guardado, e PORQUÊ: um site
       verificado ontem vale mais do que um telefone escrito à mão;
     · `verificacao()` — em que estado está o site: nunca verificado, ok,
       falhou ou a verificação já é velha. Sem data, não se afirma nada;
     · `duplicados()` — pares reais (telefone, domínio, nome) que a base não
       juntou sozinha, para uma pessoa decidir — nunca para fundir em silêncio;
     · `proximaAccao()` — o que fazer a seguir e se está atrasado;
     · `qualificacao()` — diz se o número foi dado à mão ou vem da nota;
     · `csvDeLeads()` — a exportação, com aspas e acentos tratados.

   Regra que não se quebra: um campo sem prova diz «desconhecido». Nunca se
   escreve «verificado» sem data, nem «alta confiança» sobre um nome só.
   =========================================================================== */

/** As fases do funil comercial, na ordem em que se percorrem. */
export const FASES = [
  { id: 'novo', label: 'Por contactar', teste: (l) => l.status === 'novo' },
  { id: 'qualificado', label: 'Qualificados', teste: (l) => l.status === 'qualificado' },
  { id: 'contactado', label: 'Contactados', teste: (l) => l.status === 'contactado' },
  { id: 'respondeu', label: 'Responderam', teste: (l) => l.status === 'respondeu' },
  { id: 'em_negociacao', label: 'Em negociação', teste: (l) => l.status === 'em_negociacao' || l.status === 'reuniao' || l.status === 'proposta' },
  { id: 'cliente', label: 'Ganhos', teste: (l) => l.status === 'cliente' || l.status === 'ganho' },
  { id: 'perdido', label: 'Perdidos', teste: (l) => l.status === 'perdido' },
];

export const NIVEIS = {
  alta: { rotulo: 'Confiança alta', cor: '#1E9070' },
  media: { rotulo: 'Confiança média', cor: '#B4830B' },
  baixa: { rotulo: 'Confiança baixa', cor: '#8A8A8A' },
};

export const ESTADOS_SITE = {
  ok: { rotulo: 'Site verificado', cor: '#1E9070' },
  falhou: { rotulo: 'Site não respondeu', cor: '#B4391E' },
  antiga: { rotulo: 'Verificação antiga', cor: '#B4830B' },
  por_verificar: { rotulo: 'Site por verificar', cor: '#8A8A8A' },
  sem_site: { rotulo: 'Sem site', cor: '#8A8A8A' },
};

const DIA = 24 * 3600 * 1000;
const texto = (v) => (v == null ? '' : String(v).trim());
const semAcentos = (s) => texto(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const data = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Os 9 dígitos que identificam uma linha em Portugal. */
export function telefoneCurto(v) {
  const d = texto(v).replace(/\D+/g, '').replace(/^00/, '');
  return d.length >= 9 ? d.slice(-9) : d;
}

/** O domínio de um site, sem `www.` e sem caminho. */
export function dominioDe(v) {
  const cru = texto(v);
  if (!cru) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(cru) ? cru : `https://${cru}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase() || '';
  } catch { return ''; }
}

/** Há quanto tempo, em dias — ou `null` quando não se sabe. */
export function diasDesde(v, agora = Date.now()) {
  const t = data(v);
  return t == null ? null : Math.max(0, Math.floor((agora - t) / DIA));
}

/**
 * A verificação do site. Devolve sempre um estado — e, quando não há dados,
 * diz precisamente qual falta («sem site guardado», «nunca verificado»).
 */
export function verificacao(lead, { agora = Date.now(), validaPorDias = 180 } = {}) {
  const site = texto(lead && lead.website);
  if (!site) {
    return { estado: 'sem_site', rotulo: ESTADOS_SITE.sem_site.rotulo, cor: ESTADOS_SITE.sem_site.cor, quando: null, dias: null, motivo: 'este lead não tem site guardado' };
  }
  const quando = lead.website_verificado_em || null;
  const dias = diasDesde(quando, agora);
  const estadoGuardado = texto(lead.website_estado);
  if (!quando) {
    return { estado: 'por_verificar', rotulo: ESTADOS_SITE.por_verificar.rotulo, cor: ESTADOS_SITE.por_verificar.cor, quando: null, dias: null, motivo: 'nunca foi verificado' };
  }
  if (estadoGuardado === 'falhou') {
    return {
      estado: 'falhou', rotulo: ESTADOS_SITE.falhou.rotulo, cor: ESTADOS_SITE.falhou.cor,
      quando, dias, motivo: texto(lead.website_motivo) || 'o site não respondeu',
    };
  }
  if (dias != null && dias > validaPorDias) {
    return {
      estado: 'antiga', rotulo: ESTADOS_SITE.antiga.rotulo, cor: ESTADOS_SITE.antiga.cor,
      quando, dias, motivo: `verificado há ${dias} dias — volta a verificar antes de confiar`,
    };
  }
  return {
    estado: 'ok', rotulo: ESTADOS_SITE.ok.rotulo, cor: ESTADOS_SITE.ok.cor,
    quando, dias, motivo: texto(lead.website_motivo) || 'o site respondeu',
  };
}

/**
 * A confiança nos dados deste lead, com as razões escritas. 0–100, como a nota
 * — mas não é a nota: a nota diz «vale a pena contactar», a confiança diz
 * «o que está guardado é de fiar».
 */
export function confianca(lead, { agora = Date.now() } = {}) {
  const l = lead || {};
  const razoes = [];
  let pontos = 0;
  const v = verificacao(l, { agora });
  if (v.estado === 'ok') { pontos += 40; razoes.push('site verificado e a responder (+40)'); }
  else if (v.estado === 'antiga') { pontos += 20; razoes.push(`site verificado há ${v.dias} dias (+20)`); }
  else if (v.estado === 'falhou') { pontos += 0; razoes.push('site guardado mas não responde (0)'); }
  else if (v.estado === 'por_verificar') { pontos += 10; razoes.push('site guardado, por verificar (+10)'); }
  else { razoes.push('sem site (0)'); }

  if (telefoneCurto(l.phone).length >= 9) { pontos += 25; razoes.push('telefone público (+25)'); }
  else razoes.push('sem telefone (0)');
  if (texto(l.email) && /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(texto(l.email))) { pontos += 15; razoes.push('email com forma válida (+15)'); }
  else razoes.push('sem email (0)');

  const fonte = semAcentos(l.source);
  if (fonte && fonte !== 'manual') { pontos += 10; razoes.push(`veio de ${texto(l.source)} (+10)`); }
  else if (fonte === 'manual') { razoes.push('escrito à mão (0)'); }
  else { razoes.push('sem fonte registada (0)'); }

  if (l.fonte_url) { pontos += 5; razoes.push('a fonte tem endereço (+5)'); }

  pontos = Math.max(0, Math.min(100, pontos));
  const nivel = pontos >= 70 ? 'alta' : pontos >= 40 ? 'media' : 'baixa';
  return { pontos, nivel, rotulo: NIVEIS[nivel].rotulo, cor: NIVEIS[nivel].cor, razoes };
}

/**
 * Duplicados que a base não juntou: o mesmo telefone, o mesmo domínio ou o mesmo
 * nome escrito de outra maneira. Não funde nada — só mostra, para uma pessoa
 * decidir (fundir em silêncio é a forma mais rápida de perder dados).
 */
export function duplicados(leads = []) {
  const lista = (Array.isArray(leads) ? leads : []).filter((l) => l && l.id);
  const grupos = [];
  const vistos = new Set(); // pares já agrupados por sinal mais forte

  const agrupar = (chaveDe, motivo, rotuloDe) => {
    const mapa = new Map();
    for (const l of lista) {
      const k = chaveDe(l);
      if (!k) continue;
      if (!mapa.has(k)) mapa.set(k, []);
      if (!mapa.get(k).some((x) => x.id === l.id)) mapa.get(k).push(l);
    }
    for (const [k, membros] of mapa) {
      if (membros.length < 2) continue;
      const assinatura = membros.map((m) => m.id).sort().join('|');
      if (vistos.has(assinatura)) continue; // já apareceu por um sinal mais forte
      vistos.add(assinatura);
      grupos.push({
        chave: `${motivo}:${k}`,
        motivo,
        rotulo: rotuloDe(k, membros),
        ids: membros.map((m) => m.id),
        leads: membros.map((m) => ({ id: m.id, name: m.name, city: m.city, phone: m.phone, website: m.website, status: m.status })),
      });
    }
  };

  agrupar((l) => (telefoneCurto(l.phone).length >= 9 ? telefoneCurto(l.phone) : ''), 'telefone',
    (k) => 'mesmo telefone');
  agrupar((l) => dominioDe(l.website), 'dominio', (k) => `mesmo site (${k})`);
  agrupar((l) => (semAcentos(l.name).replace(/[^a-z0-9]+/g, ' ').trim() ? semAcentos(l.name).replace(/[^a-z0-9]+/g, ' ').trim() : ''),
    'nome', (k) => 'mesmo nome');

  return grupos.sort((a, b) => b.ids.length - a.ids.length || a.motivo.localeCompare(b.motivo));
}

/**
 * A próxima acção comercial: o que foi escrito, para quando, e se está atrasada.
 * Sem acção marcada, di-lo — não inventa um passo «genérico».
 */
export function proximaAccao(lead, { agora = Date.now() } = {}) {
  const l = lead || {};
  const acao = texto(l.proxima_acao);
  const quando = data(l.proxima_acao_em);
  if (!acao && quando == null) return { estado: 'sem', texto: null, quando: null, dias: null, rotulo: 'sem próxima ação marcada' };
  if (!acao && quando != null) {
    return { estado: 'sem_texto', texto: null, quando: new Date(quando).toISOString(), dias: Math.ceil((quando - agora) / DIA), rotulo: 'há uma data marcada mas nenhuma ação escrita' };
  }
  if (quando == null) return { estado: 'sem_data', texto: acao, quando: null, dias: null, rotulo: 'ação escrita, sem data' };
  const inicioDeHoje = new Date(agora); inicioDeHoje.setHours(0, 0, 0, 0);
  const inicioDoDia = new Date(quando); inicioDoDia.setHours(0, 0, 0, 0);
  const dias = Math.round((inicioDoDia.getTime() - inicioDeHoje.getTime()) / DIA);
  const estado = dias < 0 ? 'atrasada' : dias === 0 ? 'hoje' : 'futura';
  const rotulo = estado === 'atrasada' ? `atrasada há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}`
    : estado === 'hoje' ? 'para hoje' : `para daqui a ${dias} dia${dias === 1 ? '' : 's'}`;
  return { estado, texto: acao, quando: new Date(quando).toISOString(), dias, rotulo };
}

/**
 * A qualificação (0–100) e a sua ORIGEM: guardada à mão, calculada da nota, ou
 * sem dados. Um número sem origem é um número inventado.
 */
export function qualificacao(lead) {
  const l = lead || {};
  if (l.qualificacao != null && Number.isFinite(Number(l.qualificacao))) {
    return { valor: Math.max(0, Math.min(100, Number(l.qualificacao))), origem: 'guardada', rotulo: 'definida à mão' };
  }
  if (l.score != null && Number.isFinite(Number(l.score))) {
    return { valor: Math.max(0, Math.min(100, Number(l.score))), origem: 'nota', rotulo: 'da nota do lead' };
  }
  return { valor: null, origem: 'sem-dados', rotulo: 'sem dados para qualificar' };
}

/** Os números do topo do CRM — todos contados, nenhum estimado. */
export function resumoDoFunil(leads = []) {
  const lista = (Array.isArray(leads) ? leads : []).filter(Boolean);
  const total = lista.length;
  const fases = FASES.map((f) => {
    const n = lista.filter((l) => f.teste(l)).length;
    return { id: f.id, label: f.label, n, percentagem: total ? Math.round((n / total) * 100) : 0 };
  });
  const comContacto = lista.filter((l) => telefoneCurto(l.phone).length >= 9 || texto(l.email)).length;
  const verificados = lista.filter((l) => verificacao(l).estado === 'ok').length;
  const porVerificar = lista.filter((l) => verificacao(l).estado === 'por_verificar').length;
  const atrasadas = lista.filter((l) => proximaAccao(l).estado === 'atrasada').length;
  const dup = duplicados(lista);
  return {
    total, fases, comContacto, verificados, porVerificar, atrasadas,
    duplicados: dup.length,
    contactaveis: total ? Math.round((comContacto / total) * 100) : 0,
  };
}

/* ---------- exportação ---------- */

const COLUNAS = [
  ['name', 'Nome'],
  ['category', 'Setor'],
  ['city', 'Localização'],
  ['phone', 'Telefone'],
  ['email', 'Email'],
  ['website', 'Site'],
  ['website_verificado_em', 'Site verificado em'],
  ['status', 'Estado comercial'],
  ['proxima_acao', 'Próxima ação'],
  ['proxima_acao_em', 'Próxima ação em'],
  ['source', 'Fonte'],
  ['fonte_url', 'Endereço da fonte'],
];

/** Um campo de CSV: aspas duplicadas, e aspas só quando são precisas. */
export function campoCSV(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * O CSV dos leads. Separador `;` e BOM porque é o que o Excel em português abre
 * sem partir acentos; fim de linha CRLF pela mesma razão. A confiança e a
 * verificação vão como TEXTO (a razão escrita), não só como número.
 */
export function csvDeLeads(leads = [], { agora = Date.now(), separador = ';' } = {}) {
  const lista = (Array.isArray(leads) ? leads : []).filter(Boolean);
  const cabecalho = [...COLUNAS.map(([, rotulo]) => rotulo), 'Confiança', 'Porquê a confiança', 'Verificação'];
  const linhas = lista.map((l) => {
    const c = confianca(l, { agora });
    const v = verificacao(l, { agora });
    const base = COLUNAS.map(([k]) => {
      const valor = l[k];
      if (k === 'status') return FASE_LABEL[l.status] || l.status || '';
      return valor == null ? '' : String(valor);
    });
    return [...base, `${c.pontos}/100 (${c.nivel})`, c.razoes.join(' · '), v.rotulo + (v.motivo ? ` — ${v.motivo}` : '')];
  });
  const juntar = (cols) => cols.map(campoCSV).join(separador);
  return '\uFEFF' + [juntar(cabecalho), ...linhas.map(juntar)].join('\r\n') + '\r\n';
}

const FASE_LABEL = {
  novo: 'Por contactar', qualificado: 'Qualificado', contactado: 'Contactado', respondeu: 'Respondeu',
  reuniao: 'Reunião', em_negociacao: 'Em negociação', proposta: 'Proposta enviada', cliente: 'Ganho',
  ganho: 'Ganho', perdido: 'Perdido',
};

/** O nome do ficheiro, com a data do dia (a mesma que os dados mostram). */
export function nomeDoFicheiro(agora = Date.now()) {
  const d = new Date(agora);
  const dois = (n) => String(n).padStart(2, '0');
  return `leads-${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}.csv`;
}

/** Uma frase só, para o cartão do CRM dizer o estado da carteira. */
export function fraseDaCarteira(resumo, { max = 3 } = {}) {
  if (!resumo || !resumo.total) return 'Ainda não há leads guardados — o CRM começa no primeiro.';
  const partes = [`${resumo.total} lead${resumo.total === 1 ? '' : 's'}`];
  if (resumo.comContacto) partes.push(`${resumo.comContacto} com contacto`);
  if (resumo.verificados) partes.push(`${resumo.verificados} com site verificado`);
  if (resumo.porVerificar) partes.push(`${resumo.porVerificar} por verificar`);
  if (resumo.atrasadas) partes.push(`${resumo.atrasadas} com ação atrasada`);
  if (resumo.duplicados) partes.push(`${resumo.duplicados} par${resumo.duplicados === 1 ? '' : 'es'} duplicado${resumo.duplicados === 1 ? '' : 's'}`);
  return partes.slice(0, max + 1).join(' · ');
}
