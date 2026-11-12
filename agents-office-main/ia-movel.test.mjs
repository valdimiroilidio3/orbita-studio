// 1.89.2 · a vista da IA no telemóvel (a «responsividade do espaço da IA»).
//
// O que o dono viu num ecrã de 390 px, e o que fica provado aqui:
//   · o traço verde dos modelos com teste caía sobre a primeira letra. Passa a
//     ser da linha (tr), não da célula, que no telemóvel não tem margem;
//   · os seletores da conversa tinham 165 px ao lado do resto. Ocupam a linha;
//   · o campo de escrever mostrava só duas linhas e cortava a ajuda. Tem altura;
//   · «Provar os por provar» e «Descobrir modelos» tinham menos de 44 px de toque.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MESA = fs.readFileSync(path.join(AQUI, 'src', 'mesa.html'), 'utf8');
const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** O bloco móvel da mesa (max-width: 640px), onde vivem as regras da tabela da IA. */
function blocoMovel() {
  const i = MESA.indexOf('/* --- tabelas da IA (4 colunas) --- */');
  assert.ok(i > 0, 'a secção das tabelas da IA tem de existir no bloco móvel');
  const ini = MESA.lastIndexOf('@media (max-width: 640px)', i);
  assert.ok(ini > 0, 'as tabelas da IA têm de estar num @media (max-width: 640px)');
  const fim = MESA.indexOf('</style>', i);
  return semComentarios(MESA.slice(ini, fim));
}

test('IA no telemóvel: o traço verde fica na linha, não sobre a primeira letra', () => {
  const css = blocoMovel();
  assert.match(css, /table\.ia-tab tr\.ia-ok\s*\{[^}]*box-shadow:\s*inset 3px 0 0 #2E9E63/);
  assert.match(css, /table\.ia-tab tr\.ia-ok td:first-child\s*\{\s*box-shadow:\s*none/);
});

test('IA no telemóvel: os seletores da conversa ocupam a linha toda', () => {
  const css = blocoMovel();
  assert.match(css, /\.ia-acts \.ia-select\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.ia-acts \.ia-select\s*\{[^}]*min-width:\s*0 !important/);
});

test('IA no telemóvel: o campo de escrever tem altura para a ajuda inteira', () => {
  const css = blocoMovel();
  assert.match(css, /#iaChatTexto\s*\{\s*min-height:\s*96px/);
});

test('IA no telemóvel: os botões do cabeçalho do cartão têm alvo de 44 px', () => {
  const css = blocoMovel();
  assert.match(css, /\.card h3 \.btn\.quiet\.small\s*\{\s*min-height:\s*44px/);
});
