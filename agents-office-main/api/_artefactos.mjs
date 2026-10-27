/* ===========================================================================
   Artefactos — o que uma sala entrega (27 out 2026 · 1.31.0)

   Pedido do dono: «quero que as salas comecem a trabalhar e que sejam capazes
   de criar um site». Até aqui os agentes só sabiam falar: o lançador desliga
   `Write`, `Edit` e `Bash` (ver `providers.mjs`), e com razão — um agente com
   disco e shell à solta é um acidente à espera de acontecer.

   A resposta não é dar-lhes o disco. É dar-lhes uma ferramenta com contorno:

     brief (dados que alguém confirmou)
        │
        ▼
     validação estrita  ← nome, contactos, serviços; nada inventado
        │
        ▼
     geração determinística  ← o MESMO brief dá o MESMO site, sempre
        │
        ▼
     rascunho  →  revisão humana  →  publicado (só com `aprovado: true`)

   Regras que não se negociam:
     · Telefone, email, morada e site só aparecem se vierem no brief. Campo
       ausente fica ausente — a página não inventa contactos para «parecer
       completa».
     · Todo o texto vindo do brief é escapado. Não há `javascript:` em link
       nenhum, nem script inline no HTML gerado.
     · O artefacto guarda o brief, não o HTML: o site é regenerado a partir do
       brief, por isso não há duas verdades sobre o que foi aprovado.
     · `inferido` diz a verdade: o que a casa escreveu (título de secção,
       chamada) é inferência; o que veio do brief é real.
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';

const LIMITE_TEXTO = 4200;          // o Supabase da memória corta aos 8000; folga para o JSON
const MAX_SERVICOS = 6;

const limpo = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* Paletas seguras: contraste suficiente sobre branco e sobre preto. Não é um
   campo livre de CSS — é uma escolha, para o resultado não ficar ilegível. */
export const PALETAS = {
  grafite: { acento: '#1d1d1f', suave: '#f5f5f7', escuro: '#0b0b0c' },
  oceano: { acento: '#0b6bcb', suave: '#eef5fd', escuro: '#071a2b' },
  oliva: { acento: '#3f6b3a', suave: '#f1f7ef', escuro: '#0d1a0c' },
  vinho: { acento: '#8c2f3c', suave: '#fbf0f1', escuro: '#1d0a0d' },
  areia: { acento: '#8a5a1e', suave: '#faf5ec', escuro: '#1b130a' },
};

const emailValido = (s) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
const telefoneValido = (s) => /^\+?[0-9 ().-]{6,20}$/.test(s) && (s.match(/\d/g) || []).length >= 6;

/** Um endereço só é aceite se for http(s) — o resto (javascript:, data:) não entra. */
export function urlSegura(bruto) {
  const t = limpo(bruto);
  if (!t) return null;
  const comEsquema = /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
  try {
    const u = new URL(comEsquema);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') || /\s/.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

/**
 * Valida o pedido de um site. Devolve `{ valor }` ou `{ erro }` — nunca lança.
 * A validação existe para não se gastar uma revisão humana num brief vazio.
 */
export function validarBrief(args = {}) {
  const nome = limpo(args.nome || args.name || args.empresa);
  if (nome.length < 2) return { erro: 'diz o nome do negócio (2 a 80 caracteres)' };
  if (nome.length > 80) return { erro: 'o nome do negócio não pode passar de 80 caracteres' };

  const atividade = limpo(args.atividade || args.activity || args.ramo);
  const cidade = limpo(args.cidade || args.city || args.local);
  const sobre = limpo(args.sobre || args.about || args.descricao);

  let telefone = limpo(args.telefone || args.phone);
  if (telefone && !telefoneValido(telefone)) return { erro: 'o telefone tem de ter entre 6 e 20 dígitos (podes usar +351)' };
  telefone = telefone.replace(/[^\d+]/g, '');

  const email = limpo(args.email);
  if (email && !emailValido(email)) return { erro: 'o email não parece um email válido' };

  const website = args.website ? urlSegura(args.website) : null;
  if (args.website && !website) return { erro: 'o site tem de ser um endereço http(s) válido' };
  const morada = limpo(args.morada || args.address);
  const horario = limpo(args.horario || args.hours);

  const servicosBrutos = Array.isArray(args.servicos || args.services) ? (args.servicos || args.services) : [];
  const servicos = servicosBrutos.map((s) => limpo(typeof s === 'string' ? s : s?.nome)).filter(Boolean);
  if (servicos.length > MAX_SERVICOS) return { erro: `no máximo ${MAX_SERVICOS} serviços` };
  if (servicos.some((s) => s.length > 80)) return { erro: 'cada serviço tem no máximo 80 caracteres' };

  const pedida = String(args.paleta || args.palette || 'grafite').toLowerCase();
  const paleta = PALETAS[pedida] ? pedida : 'grafite';
  /* textos vindos de fora (um agente ou um modelo) são opcionais e auditáveis */
  const textos = args.textos && typeof args.textos === 'object' ? {
    titulo: limpo(args.textos.titulo).slice(0, 90) || null,
    chamada: limpo(args.textos.chamada).slice(0, 200) || null,
    sobre: limpo(args.textos.sobre).slice(0, 900) || null,
  } : null;

  return {
    valor: {
      nome, atividade, cidade, sobre, telefone, email, website, morada, horario,
      servicos, paleta, textos,
      idioma: 'pt',
    },
  };
}

/* ---------- o sítio, a partir do brief ---------- */

/** O texto que a casa escreve quando ninguém escreveu por nós. Marcado como inferido. */
export function textosDeCasa(bruto) {
  const { nome, atividade, cidade, servicos } = bruto;
  const oQue = atividade || 'o que fazemos';
  const onde = cidade ? ` em ${cidade}` : '';
  return {
    titulo: bruto.textos?.titulo || (atividade ? `${atividade[0].toUpperCase() + atividade.slice(1)}${onde}` : nome),
    chamada: bruto.textos?.chamada || (atividade
      ? `${nome} — ${oQue}${onde}. Fala connosco: respondemos no mesmo dia.`
      : `${nome}${onde}. Fala connosco: respondemos no mesmo dia.`),
    sobre: bruto.textos?.sobre || bruto.sobre || (servicos.length
      ? `${nome} trabalha${onde} com ${servicos.slice(0, 3).join(', ')}${servicos.length > 3 ? ' e mais' : ''}. Cada pedido é tratado por quem o vai fazer, sem intermediários.`
      : `${nome}${onde}. Trabalhamos de forma directa: um pedido, uma resposta clara, um prazo que se cumpre.`),
  };
}

/**
 * Constrói as páginas a partir do brief. Função pura: o mesmo brief dá o mesmo
 * site — é isto que permite guardar o brief em vez do HTML.
 */
export function construirSite(bruto, { textos = null, ano = new Date().getFullYear() } = {}) {
  const t = textos || textosDeCasa(bruto);
  const cor = PALETAS[bruto.paleta] || PALETAS.grafite;
  const nome = esc(bruto.nome);
  const temas = [bruto.atividade, bruto.cidade].filter(Boolean).map((x) => esc(x));

  const contactos = [
    bruto.telefone ? `<li><span>Telefone</span><a href="tel:${esc(bruto.telefone)}">${esc(bruto.telefone)}</a></li>` : '',
    bruto.email ? `<li><span>Email</span><a href="mailto:${esc(bruto.email)}">${esc(bruto.email)}</a></li>` : '',
    bruto.morada ? `<li><span>Morada</span><address>${esc(bruto.morada)}</address></li>` : '',
    bruto.horario ? `<li><span>Horário</span>${esc(bruto.horario)}</li>` : '',
    bruto.website ? `<li><span>Site</span><a href="${esc(bruto.website)}" rel="noopener">${esc(bruto.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></li>` : '',
  ].filter(Boolean).join('\n          ');

  const servicosHtml = bruto.servicos.length
    ? `<section id="servicos" aria-labelledby="t-servicos">
      <h2 id="t-servicos">O que fazemos</h2>
      <ul class="cartoes">
        ${bruto.servicos.map((s) => `<li class="cartao"><h3>${esc(s)}</h3></li>`).join('\n        ')}
      </ul>
    </section>`
    : '';

  const contactoHtml = contactos
    ? `<section id="contactos" aria-labelledby="t-contactos">
      <h2 id="t-contactos">Contactos</h2>
      <ul class="contactos">
          ${contactos}
      </ul>
    </section>`
    : `<section id="contactos" aria-labelledby="t-contactos">
      <h2 id="t-contactos">Contactos</h2>
      <p class="nota">Os contactos ainda não estão confirmados. Antes de publicar, acrescenta telefone, email ou morada ao brief.</p>
    </section>`;

  const index = `<!doctype html>
<html lang="pt-PT">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${nome}${temas.length ? ` — ${temas.join(' · ')}` : ''}</title>
  <meta name="description" content="${esc(t.chamada).slice(0, 160)}">
  <link rel="stylesheet" href="estilo.css">
</head>
<body>
  <a class="saltar" href="#conteudo">Saltar para o conteúdo</a>
  <header class="topo">
    <p class="marca">${nome}</p>
    <nav aria-label="Principal">
      <a href="#sobre">Sobre</a>
      ${bruto.servicos.length ? '<a href="#servicos">Serviços</a>' : ''}
      <a href="#contactos">Contactos</a>
    </nav>
  </header>

  <main id="conteudo">
    <section class="hero" aria-labelledby="t-hero">
      <h1 id="t-hero">${esc(t.titulo)}</h1>
      <p class="chamada">${esc(t.chamada)}</p>
      ${bruto.telefone ? `<p><a class="botao" href="tel:${esc(bruto.telefone)}">Ligar agora</a></p>` : `<p><a class="botao" href="#contactos">Falar connosco</a></p>`}
    </section>

    <section id="sobre" aria-labelledby="t-sobre">
      <h2 id="t-sobre">Sobre</h2>
      <p>${esc(t.sobre)}</p>
    </section>

    ${servicosHtml}

    ${contactoHtml}
  </main>

  <footer>
    <p>© ${ano} ${nome}</p>
    <p class="fino">Página preparada no Órbita Studio.</p>
  </footer>
</body>
</html>
`;

  const css = `/* ${bruto.nome} — folha única, sem dependências */
:root {
  --acento: ${cor.acento};
  --suave: ${cor.suave};
  --tinta: #1d1d1f;
  --papel: #ffffff;
  --linha: rgba(0, 0, 0, .12);
  --raio: 18px;
}
@media (prefers-color-scheme: dark) {
  :root { --tinta: #f5f5f7; --papel: ${cor.escuro}; --suave: rgba(255,255,255,.06); --linha: rgba(255,255,255,.16); }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--papel); color: var(--tinta);
  font: 17px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--acento); }
a:focus-visible, .botao:focus-visible { outline: 3px solid var(--acento); outline-offset: 3px; border-radius: 6px; }
.saltar { position: absolute; left: -999px; }
.saltar:focus { left: 12px; top: 12px; background: var(--papel); padding: 8px 12px; z-index: 10; }
.topo {
  display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: baseline; justify-content: space-between;
  max-width: 960px; margin: 0 auto; padding: 24px 24px 8px;
}
.marca { margin: 0; font-weight: 650; letter-spacing: -.01em; }
.topo nav { display: flex; gap: 18px; }
.topo nav a { text-decoration: none; color: inherit; opacity: .72; }
.topo nav a:hover { opacity: 1; }
main { max-width: 960px; margin: 0 auto; padding: 0 24px 64px; }
.hero { padding: 64px 0 32px; }
.hero h1 { font-size: clamp(2rem, 6vw, 3.4rem); line-height: 1.05; letter-spacing: -.03em; margin: 0 0 16px; }
.chamada { font-size: clamp(1.05rem, 2.4vw, 1.3rem); opacity: .8; max-width: 44ch; margin: 0 0 28px; }
.botao {
  display: inline-block; background: var(--acento); color: #fff; text-decoration: none;
  padding: 13px 22px; border-radius: 999px; font-weight: 600;
}
section { padding: 40px 0; border-top: 1px solid var(--linha); }
section h2 { font-size: 1.4rem; letter-spacing: -.015em; margin: 0 0 12px; }
section p { max-width: 62ch; opacity: .86; }
.cartoes { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.cartao { background: var(--suave); border-radius: var(--raio); padding: 20px; }
.cartao h3 { margin: 0; font-size: 1.02rem; font-weight: 600; }
.contactos { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.contactos li { display: grid; gap: 2px; }
.contactos span { font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; opacity: .6; }
.contactos address { font-style: normal; }
.nota { background: var(--suave); border-radius: var(--raio); padding: 16px 18px; }
footer { border-top: 1px solid var(--linha); padding: 24px; text-align: center; opacity: .7; font-size: .9rem; }
footer .fino { font-size: .8rem; opacity: .8; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`;

  const leiaMe = `# ${bruto.nome} — site

Gerado no Órbita Studio a partir de um brief revisto por uma pessoa.

- \`index.html\` — a página
- \`estilo.css\` — a folha única (sem dependências, sem scripts)

**Antes de publicar:** confirma telefone, email e morada. O que não está no brief
não aparece na página — de propósito.

Para publicar, copia os dois ficheiros para qualquer alojamento estático
(Vercel, Netlify, Cloudflare Pages) ou aprova o artefacto no Órbita.
`;

  /* o que é real (veio no brief) e o que é escrita da casa */
  const reais = [
    bruto.nome && 'nome', bruto.atividade && 'atividade', bruto.cidade && 'cidade',
    bruto.telefone && 'telefone', bruto.email && 'email', bruto.website && 'site',
    bruto.morada && 'morada', bruto.horario && 'horário',
    bruto.servicos.length && 'serviços',
  ].filter(Boolean);

  return {
    ficheiros: {
      'index.html': index,
      'estilo.css': css,
      'LEIA-ME.md': leiaMe,
    },
    textos: t,
    real: reais,
    inferido: ['textos.titulo', 'textos.chamada', 'textos.sobre'].filter((k) => {
      const caminho = k.split('.')[1];
      return !bruto.textos?.[caminho] && !(caminho === 'sobre' && bruto.sobre);
    }),
  };
}

/* ---------- o arquivo: memória, com a base do escritório por baixo ----------
   O Supabase da Vercel não tem disco. O artefacto vive em `orbita_ai_memoria`
   (tabela que já existe) como uma nota com `projeto: 'artefactos'` e o brief em
   JSON. Não é preciso migração nova, e o HTML nunca é a fonte da verdade. */

const PROJETO = 'artefactos';
const SESSOES = new Map();   // o que ainda não foi gravado (sem base, ou se a gravação falhar)

/* Sem base (o servidor MCP ao lado do agente, a máquina do dono), o rascunho
   fica em `data/artefactos/<id>.json` — a mesma pasta de dados que já está
   fora do git. Na Vercel isto é só leitura e falha em silêncio: aí manda a base. */
const pasta = () => path.join(process.env.ORBITA_DATA_DIR || path.join(process.cwd(), 'data'), 'artefactos');

function paraDisco(art) {
  try {
    fs.mkdirSync(pasta(), { recursive: true });
    fs.writeFileSync(path.join(pasta(), `${art.id}.json`), JSON.stringify({ brief: art.brief, textos: art.textos, meta: art.meta }, null, 1));
    return true;
  } catch { return false; }
}

function deDisco(id) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(pasta(), `${id}.json`), 'utf8'));
    if (!j?.brief?.nome) return null;
    return { id, tipo: 'site', brief: j.brief, textos: j.textos, meta: j.meta || {} };
  } catch { return null; }
}

function todosDeDisco() {
  try {
    return fs.readdirSync(pasta()).filter((f) => f.endsWith('.json')).map((f) => deDisco(f.replace(/\.json$/, ''))).filter(Boolean);
  } catch { return []; }
}

const idDoSite = (nome) => {
  const base = semAcentos(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site';
  let h = 0;
  for (const c of String(nome)) h = (h * 31 + c.charCodeAt(0)) % 1679616;
  return `${base}-${h.toString(36).padStart(4, '0')}`;
};

const paraNota = (art) => ({
  projeto: PROJETO,
  titulo: `site:${art.id}`.slice(0, 160),
  texto: JSON.stringify({ brief: art.brief, textos: art.textos, meta: art.meta }),
  etiquetas: ['artefacto', 'site'],
  fonte: 'artefactos',
});

function deNota(nota) {
  try {
    const j = JSON.parse(nota.texto);
    if (!j?.brief?.nome) return null;
    return {
      id: String(nota.titulo || '').replace(/^site:/, ''),
      tipo: 'site',
      notaId: nota.id,
      brief: j.brief,
      textos: j.textos,
      meta: j.meta || {},
      estado: j.meta?.estado || 'rascunho',
      criadoEm: j.meta?.criadoEm || nota.criado || null,
      actualizadoEm: nota.actualizado || null,
    };
  } catch { return null; }
}

/** Cria um rascunho de site. Nada é publicado aqui. */
export async function criarSite(args = {}, { repo = null, agora = new Date() } = {}) {
  const v = validarBrief(args);
  if (v.erro) return { ok: false, codigo: 'parametros', erro: v.erro };
  const brief = v.valor;
  const montado = construirSite(brief, { ano: agora.getFullYear() });
  const json = JSON.stringify({ brief, textos: montado.textos, meta: {} });
  if (json.length > LIMITE_TEXTO) {
    return { ok: false, codigo: 'parametros', erro: 'o brief é demasiado longo — encurta a descrição e os serviços' };
  }

  const id = idDoSite(brief.nome);
  const meta = {
    estado: 'rascunho',
    criadoEm: agora.toISOString(),
    actualizadoEm: agora.toISOString(),
    por: limpo(args.por) || 'sala',
    aprovadoPor: null,
    publicadoEm: null,
    ficheiros: Object.keys(montado.ficheiros),
    caracteres: montado.ficheiros['index.html'].length + montado.ficheiros['estilo.css'].length,
  };
  const artefacto = { id, tipo: 'site', brief, textos: montado.textos, meta };
  SESSOES.set(id, artefacto);

  let guardado = 'sessao';
  if (repo?.ia?.memoria?.criar) {
    try {
      const nota = await repo.ia.memoria.criar(paraNota(artefacto));
      if (nota?.id) { guardado = 'base'; artefacto.notaId = nota.id; }
    } catch { guardado = 'sessao'; }
  }
  if (guardado === 'sessao' && paraDisco(artefacto)) guardado = 'ficheiro';
  if (repo?.atividade?.add) {
    await repo.atividade.add('artefacto', `site «${brief.nome}» criado em rascunho (${id})`).catch(() => {});
  }

  return {
    ok: true,
    artefacto: publico(artefacto),
    ficheiros: montado.ficheiros,
    real: montado.real,
    inferido: montado.inferido,
    guardado,
    nota: guardado === 'base'
      ? 'rascunho guardado na base — não está publicado'
      : guardado === 'ficheiro'
        ? 'rascunho guardado em data/artefactos — não está publicado'
        : 'rascunho só nesta sessão (sem base): aprova e copia os ficheiros antes de fechar',
  };
}

/** O que sai para fora: sem `notaId`, sem lixo interno. */
function publico(art) {
  return {
    id: art.id,
    tipo: 'site',
    nome: art.brief.nome,
    estado: art.meta?.estado || art.estado || 'rascunho',
    brief: art.brief,
    textos: art.textos,
    criadoEm: art.meta?.criadoEm || art.criadoEm || null,
    actualizadoEm: art.meta?.actualizadoEm || art.actualizadoEm || null,
    aprovadoPor: art.meta?.aprovadoPor || null,
    publicadoEm: art.meta?.publicadoEm || null,
    ficheiros: art.meta?.ficheiros || ['index.html', 'estilo.css', 'LEIA-ME.md'],
    caracteres: art.meta?.caracteres || null,
    url: `/artefactos/${art.id}/preview`,
  };
}

/** Vai buscar à base primeiro; a sessão é a rede de segurança. */
export async function obter(id, { repo = null } = {}) {
  const chave = limpo(id);
  if (!chave) return null;
  if (repo?.ia?.memoria?.listar) {
    try {
      const notas = await repo.ia.memoria.listar({ projeto: PROJETO, limite: 500 });
      const nota = (notas || []).find((n) => String(n.titulo || '') === `site:${chave}`);
      const art = nota ? deNota(nota) : null;
      if (art) { SESSOES.set(art.id, art); return art; }
    } catch { /* cai para a sessão */ }
  }
  const emDisco = deDisco(chave) || null;
  if (emDisco) { SESSOES.set(chave, emDisco); return emDisco; }
  return SESSOES.get(chave) || null;
}

export async function listar({ repo = null, limite = 50 } = {}) {
  const porId = new Map();
  if (repo?.ia?.memoria?.listar) {
    try {
      const notas = await repo.ia.memoria.listar({ projeto: PROJETO, limite: 500 });
      for (const n of notas || []) {
        const art = deNota(n);
        if (art) porId.set(art.id, art);
      }
    } catch { /* fica só a sessão */ }
  }
  for (const art of todosDeDisco()) if (!porId.has(art.id)) porId.set(art.id, art);
  for (const [k, v] of SESSOES) if (!porId.has(k)) porId.set(k, v);
  return [...porId.values()]
    .sort((a, b) => String(b.meta?.criadoEm || '').localeCompare(String(a.meta?.criadoEm || '')))
    .slice(0, Math.max(1, Math.min(200, Number(limite) || 50)))
    .map(publico);
}

/** A pré-visualização: devolve as páginas, não um servidor. */
export async function preview(id, { repo = null } = {}) {
  const art = await obter(id, { repo });
  if (!art) return null;
  const montado = construirSite(art.brief, { textos: art.textos });
  return { id: art.id, estado: art.meta?.estado || 'rascunho', ...montado.ficheiros };
}

/**
 * Publicar é um acto humano. `aprovado` tem de ser `true` e `por` tem de vir
 * identificado — sem isso a resposta é `aprovacao` e nada muda de estado.
 */
export async function publicar(id, { repo = null, aprovado = false, por = null, agora = new Date() } = {}) {
  const art = await obter(id, { repo });
  if (!art) return { ok: false, codigo: 'nao-existe', erro: `não há artefacto «${id}»` };
  const quem = limpo(por);
  if (aprovado !== true) {
    return { ok: false, codigo: 'aprovacao', erro: 'publicar exige aprovação explícita (`aprovado: true`) e quem aprova', artefacto: publico(art) };
  }
  if (quem.length < 2) {
    return { ok: false, codigo: 'aprovacao', erro: 'diz quem aprova (`por`) — a aprovação não é anónima', artefacto: publico(art) };
  }
  if (!art.brief.telefone && !art.brief.email && !art.brief.morada && !art.brief.website) {
    return { ok: false, codigo: 'sem-contactos', erro: 'a página não tem um único contacto confirmado — completa o brief antes de publicar', artefacto: publico(art) };
  }

  art.meta = {
    ...(art.meta || {}),
    estado: 'aprovado',
    aprovadoPor: quem,
    publicadoEm: agora.toISOString(),
    actualizadoEm: agora.toISOString(),
  };
  SESSOES.set(art.id, art);

  let guardado = 'sessao';
  if (repo?.ia?.memoria?.criar) {
    try {
      const nota = await repo.ia.memoria.criar(paraNota(art));
      if (nota?.id) {
        art.notaId = nota.id;
        guardado = 'base';
        if (art.notaId && repo.ia.memoria.apagar) {
          /* a versão anterior deixa de valer: uma aprovação, um registo */
          const antigas = (await repo.ia.memoria.listar({ projeto: PROJETO, limite: 500 }).catch(() => [])) || [];
          const repetidas = antigas.filter((n) => String(n.titulo || '') === `site:${art.id}` && n.id !== nota.id);
          for (const r of repetidas) await repo.ia.memoria.apagar(r.id).catch(() => {});
        }
      }
    } catch { guardado = 'sessao'; }
  }
  if (guardado === 'sessao' && paraDisco(art)) guardado = 'ficheiro';
  if (repo?.atividade?.add) {
    await repo.atividade.add('artefacto', `site «${art.brief.nome}» aprovado por ${quem}`).catch(() => {});
  }
  return { ok: true, artefacto: publico(art), guardado, nota: 'aprovado — os ficheiros podem ser publicados no alojamento' };
}

/** Só para testes. */
export function reiniciar() { SESSOES.clear(); }

/** Onde ficam os rascunhos, para o operador saber o que procurar. */
export const ondeGuarda = () => ({ base: 'orbita_ai_memoria (projeto «artefactos»)', ficheiro: pasta(), sessao: 'memória do processo' });
