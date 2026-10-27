/* ===========================================================================
   A lista local de leads (`data/leads.json`) — 27 out 2026 · 1.29.0.

   Porquê este ficheiro existir: até hoje estas funções viviam dentro de
   `google.mjs`, ao lado das chamadas à Places API e ao Programmable Search. Quando
   o Google saiu do produto (as pesquisas passaram a ser Tavily + Geoapify), a
   lista local ficou lá dentro por arrasto — e apagar o Google teria levado a lista
   com ele.

   Aqui só há armazenamento: ler, gravar, identificar sem duplicar, listar por
   estado e escrever o bloco que os agentes de prospeção leem no início da tarefa.
   Nenhuma chave, nenhuma chamada de rede, nenhuma dependência de fornecedor.
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const ficheiro = (dir) => path.join(dir || 'data', 'leads.json');

function ler(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(ficheiro(dir), 'utf8'));
    return { updated: j.updated || null, leads: Array.isArray(j.leads) ? j.leads : [] };
  } catch { return { updated: null, leads: [] }; }
}

function gravar(dir, dados) {
  fs.mkdirSync(dir || 'data', { recursive: true });
  fs.writeFileSync(ficheiro(dir), JSON.stringify(dados, null, 2));
  return dados;
}

/** O domínio de um site, sem `www.` e sem caminho. */
export const domainOf = (url) => {
  const cru = String(url || '').trim();
  if (!cru) return '';
  try {
    const host = new URL(/^https?:/i.test(cru) ? cru : `https://${cru}`).hostname.replace(/^www\./, '').toLowerCase();
    return host && host.includes('.') ? host : '';
  } catch { return ''; }
};

const digitos = (s) => String(s || '').replace(/\D+/g, '');
const slug = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Identidade de um lead: domínio, senão telefone, senão nome + zona. */
export function keyOf(l) {
  const d = domainOf(l.website);
  if (d && !/google\.|facebook\.|instagram\.|linkedin\./i.test(d)) return 'd:' + d;
  const tel = digitos(l.phone || l.telefone);
  if (tel.length >= 9) return 'p:' + tel.slice(-9);
  return 'n:' + slug(l.name || l.nome) + '|' + slug(l.city || l.cidade || l.address || l.morada).slice(0, 24);
}

/** Guarda sem duplicar. Devolve `{ added, updated, total, leads }`. */
export function saveAll(lista, dir) {
  const dados = ler(dir);
  const porChave = new Map(dados.leads.map((l) => [l.key || keyOf(l), l]));
  let added = 0, updated = 0;
  for (const bruto of lista || []) {
    const chave = keyOf(bruto);
    const antes = porChave.get(chave);
    const agora = { ...bruto, key: chave, foundAt: bruto.foundAt || new Date().toISOString() };
    if (antes) {
      /* o que já estava ganha em estado e notas; os factos vêm frescos */
      porChave.set(chave, { ...antes, ...agora, status: antes.status || 'novo', note: antes.note || '', id: antes.id, foundAt: antes.foundAt });
      updated++;
    } else {
      porChave.set(chave, { ...agora, id: 'l' + Math.random().toString(36).slice(2, 9), status: 'novo', note: '' });
      added++;
    }
  }
  const leads = [...porChave.values()].sort((a, b) => (b.score || b.nota || 0) - (a.score || a.nota || 0));
  gravar(dir, { updated: new Date().toISOString(), leads });
  return { added, updated, total: leads.length, leads };
}

export function list({ limit = 50, status = null } = {}, dir) {
  const leads = ler(dir).leads
    .filter((l) => (status ? l.status === status : true))
    .sort((a, b) => (b.score || b.nota || 0) - (a.score || a.nota || 0));
  return { total: leads.length, leads: leads.slice(0, limit) };
}

export function stats(dir) {
  const leads = ler(dir).leads;
  const porEstado = {};
  for (const l of leads) porEstado[l.status || 'novo'] = (porEstado[l.status || 'novo'] || 0) + 1;
  return {
    total: leads.length,
    byStatus: porEstado,
    noSite: leads.filter((l) => !l.website).length,
    withPhone: leads.filter((l) => l.phone || l.telefone).length,
  };
}

export function setStatus(id, status, dir) {
  const dados = ler(dir);
  const l = dados.leads.find((x) => x.id === id);
  if (!l) return null;
  l.status = status;
  l.touchedAt = new Date().toISOString();
  gravar(dir, dados);
  return l;
}

/**
 * O bloco que Prospeção e Vendas leem no início de cada tarefa.
 * A origem deixou de ser «pesquisa Google»: os leads vêm do Geoapify (OpenStreetMap)
 * quando a lista é guardada pela gaveta nova, e de `places` na lista antiga. O bloco
 * não promete origem nenhuma — descreve os dados que tem.
 */
export function contextForAgent({ limit = 8, dir, onlyNew = true } = {}) {
  const todos = ler(dir).leads;
  const leads = todos
    .filter((l) => (onlyNew ? (l.status || 'novo') === 'novo' : true))
    .sort((a, b) => (b.score || b.nota || 0) - (a.score || a.nota || 0))
    .slice(0, limit);
  if (!leads.length) return '';
  const linhas = leads.map((l) => {
    const nome = l.name || l.nome;
    const cidade = l.city || l.cidade;
    const tel = l.phone || l.telefone;
    const nota = l.score ?? l.nota;
    return `— ${nome}${cidade ? ' · ' + cidade : ''}${tel ? ' · ' + tel : ''}${l.website ? ' · ' + domainOf(l.website) : ' · sem site'}${nota != null ? ` · nota ${nota}` : ''}${l.why || l.notes ? ` (${l.why || l.notes})` : ''}`;
  });
  return `LEADS REAIS (${leads.length} de ${todos.length} guardados)\n${linhas.join('\n')}\n\nEscreve para estes negócios reais — usa o nome, a cidade e o que sabes deles. Não inventes contactos: se falta o email, diz que falta.`;
}
