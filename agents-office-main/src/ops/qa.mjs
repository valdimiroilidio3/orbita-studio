// Órbita — a auditoria de qualidade.
//
// Uma entrega não se aprova por estar bonita: aprova-se por passar em coisas que se podem
// verificar. Aqui há três famílias de provas:
//
//   1. estrutura — os ficheiros obrigatórios existem, as páginas abrem, os links internos
//      apontam para ficheiros que existem, os formulários têm rótulos;
//   2. código — o JavaScript compila (vm.Script), o CSS tem as chaves fechadas, o JSON dos dados
//      é válido, não há recursos externos que quebrem offline;
//   3. honestidade — não há lorem ipsum, «TODO», placeholders por preencher, e o README diz o
//      que ainda não está feito.
//
// O manifesto (sha256 por ficheiro) fica guardado em cada corrida. Se um ficheiro mudar depois
// da auditoria, a entrega é bloqueada — é a diferença entre «testei» e «testei isto».
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { currentManifest } from './generate.mjs';

const REQUIRED = ['index.html', 'styles.css', 'app.js', 'README.md'];
const DATA_FILES = { loja: 'data/products.json', dashboard: 'data/dataset.json' };

const htmlPages = files => Object.keys(files).filter(f => f.endsWith('.html'));

/** Um item do relatório. `critico` bloqueia; `importante` bloqueia; `menor` só informa. */
const item = (level, code, message, file = '') => ({ level, code, message, file });

function checkHtml(file, html, files, out) {
  const add = (level, code, msg) => out.push(item(level, code, msg, file));
  if (!/^<!DOCTYPE html>/i.test(html.trim())) add('critico', 'doctype', 'Falta o <!DOCTYPE html>.');
  if (!/<html[^>]+lang="[a-z-]+"/i.test(html)) add('critico', 'lang', 'Falta o atributo lang no <html> (leitores de ecrã precisam dele).');
  if (!/<meta[^>]+name="viewport"/i.test(html)) add('critico', 'viewport', 'Falta a meta viewport — a página não é responsiva.');
  if (!/<title>[^<]{3,}<\/title>/i.test(html)) add('importante', 'title', 'Falta um <title> com conteúdo.');
  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) add('critico', 'h1', 'Não há nenhum <h1>.');
  if (h1s.length > 1) add('importante', 'h1-muitos', `Há ${h1s.length} <h1> — só deve haver um por página.`);

  // links internos: cada href local tem de existir
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  for (const href of hrefs) {
    if (/^(https?:|mailto:|tel:|#|data:)/i.test(href)) {
      if (/^https?:/i.test(href)) add('critico', 'externo', `Referência externa «${href}» — a página deixa de abrir offline.`);
      continue;
    }
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    if (!files[clean]) add('critico', 'link-partido', `O link «${href}» aponta para um ficheiro que não existe.`);
  }
  for (const m of html.matchAll(/src="([^"]+)"/g)) {
    const src = m[1];
    if (/^https?:/i.test(src)) add('critico', 'externo', `Recurso externo «${src}».`);
    else if (!files[src]) add('critico', 'asset-em-falta', `O recurso «${src}» não existe no projeto.`);
  }

  // formulários
  const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/gi)].map(m => m[0]);
  for (const form of forms) {
    if (!/aria-label=|<legend>|<h[23]/.test(form)) add('menor', 'form-nome', 'O formulário não tem nome acessível (aria-label/legend).');
    const fields = [...form.matchAll(/<(input|textarea|select)([^>]*)>/gi)];
    for (const [, tag, attrs] of fields) {
      if (/type="(submit|button|hidden)"/i.test(attrs)) continue;
      const id = (attrs.match(/id="([^"]+)"/) || [])[1];
      const labelled = id && new RegExp(`<label[^>]+for="${id}"`, 'i').test(form);
      if (!labelled && !/aria-label=/.test(attrs)) add('importante', 'label', `Um campo <${tag}> não tem rótulo associado.`);
    }
    const buttons = [...form.matchAll(/<button([^>]*)>/gi)];
    for (const [, attrs] of buttons) if (!/type="/i.test(attrs)) add('menor', 'button-type', 'Um botão não declara type (dentro de um form, o default é submit).');
  }

  // imagens
  for (const m of html.matchAll(/<img([^>]*)>/gi)) {
    if (!/alt="/i.test(m[1])) add('critico', 'alt', 'Uma imagem não tem texto alternativo.');
  }
  // placeholders
  if (/lorem ipsum/i.test(html)) add('critico', 'lorem', 'Há «lorem ipsum» na página.');
  if (/\bTODO\b|\[(nome|cliente|empresa|preencher)\]/i.test(html)) add('importante', 'placeholder', 'Há um texto por preencher (TODO/placeholder).');
}

function checkCss(file, css, out) {
  const add = (level, code, msg) => out.push(item(level, code, msg, file));
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  if (open !== close) add('critico', 'css-chaves', `Chaves desequilibradas no CSS (${open} abre, ${close} fecha).`);
  if (!/@media/.test(css)) add('importante', 'css-responsivo', 'Não há nenhuma @media — a página não adapta ao telemóvel.');
  if (/@import\s+url\(/i.test(css)) add('critico', 'css-import', 'O CSS importa um recurso externo.');
  if (/(^|[\s}])body\s*{[^}]*overflow-x:\s*hidden/.test(css)) add('menor', 'css-overflow', 'overflow-x:hidden pode esconder conteúdo em vez de o resolver.');
}

function checkJs(file, js, out) {
  const add = (level, code, msg) => out.push(item(level, code, msg, file));
  try { new vm.Script(js, { filename: file }); } catch (e) { add('critico', 'js-sintaxe', `O JavaScript não compila: ${e.message}`); }
  if (/\beval\s*\(/.test(js)) add('critico', 'js-eval', 'Uso de eval().');
  if (/document\.write\s*\(/.test(js)) add('importante', 'js-write', 'Uso de document.write().');
  if (/javascript:/.test(js)) add('importante', 'js-protocolo', 'Há um link javascript:.');
  if (/innerHTML\s*=/.test(js) && !/esc|escape/.test(js)) add('menor', 'js-innerhtml', 'innerHTML sem escape à vista — confirmar que não recebe dados de fora.');
}

function checkReadme(file, md, out) {
  const add = (level, code, msg) => out.push(item(level, code, msg, file));
  if (!/O que ainda não está/i.test(md)) add('importante', 'readme-limites', 'O README não diz o que ainda não está feito.');
  if (!/Como abrir/i.test(md)) add('menor', 'readme-abrir', 'O README não explica como abrir o projeto.');
  if (md.length < 300) add('menor', 'readme-curto', 'O README é muito curto para servir de entrega.');
}

/**
 * Audita uma pasta de projeto. Devolve o relatório e o manifesto do que foi visto.
 * Puro quanto ao disco: só lê.
 */
export function auditDir(dir, { kind = 'landing' } = {}) {
  const items = [];
  const files = {};
  const walk = (rel = '') => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) {
        try { files[r] = fs.readFileSync(path.join(dir, r), 'utf8'); } catch { items.push(item('critico', 'ilegivel', `Não consegui ler «${r}».`, r)); }
      }
    }
  };
  walk();

  for (const req of REQUIRED) if (!files[req]) items.push(item('critico', 'em-falta', `Falta o ficheiro obrigatório ${req}.`, req));
  const dataFile = DATA_FILES[kind];
  if (dataFile) {
    if (!files[dataFile]) items.push(item('critico', 'dados-em-falta', `Falta ${dataFile}.`, dataFile));
    else {
      try {
        const parsed = JSON.parse(files[dataFile]);
        if (!Array.isArray(parsed)) items.push(item('importante', 'dados-forma', `${dataFile} devia ser uma lista.`, dataFile));
      } catch (e) { items.push(item('critico', 'dados-json', `${dataFile} não é JSON válido: ${e.message}`, dataFile)); }
    }
  }

  for (const page of htmlPages(files)) checkHtml(page, files[page], files, items);
  if (files['styles.css']) checkCss('styles.css', files['styles.css'], items);
  if (files['app.js']) checkJs('app.js', files['app.js'], items);
  if (files['README.md']) checkReadme('README.md', files['README.md'], items);

  // páginas declaradas para este tipo
  const expected = { landing: ['index.html'], institucional: ['index.html', 'sobre.html', 'servicos.html', 'contacto.html'], loja: ['index.html'], dashboard: ['index.html'] }[kind] || ['index.html'];
  for (const p of expected) if (!files[p]) items.push(item('critico', 'pagina-em-falta', `Falta a página ${p}.`, p));
  if (!htmlPages(files).length) items.push(item('critico', 'sem-html', 'O projeto não tem nenhuma página HTML.'));

  const weight = { critico: 0, importante: 0, menor: 0 };
  for (const i of items) weight[i.level === 'critico' ? 'critico' : i.level === 'importante' ? 'importante' : 'menor'] += 1;
  const manifest = currentManifest(dir);
  return {
    at: new Date().toISOString(),
    dir,
    files: Object.keys(files).sort(),
    manifest,
    items,
    total: items.length,
    critical: weight.critico,
    important: weight.importante,
    minor: weight.menor,
    passed: weight.critico === 0 && weight.importante === 0,
  };
}

/** Compara o manifesto guardado com o disco: o que mudou depois da auditoria. */
export function changesSince(manifest, dir) {
  const now = currentManifest(dir);
  const changed = [];
  for (const [file, hash] of Object.entries(now)) {
    if (!(file in (manifest || {}))) changed.push({ file, change: 'novo' });
    else if (manifest[file] !== hash) changed.push({ file, change: 'alterado' });
  }
  for (const file of Object.keys(manifest || {})) if (!(file in now)) changed.push({ file, change: 'apagado' });
  return changed;
}
