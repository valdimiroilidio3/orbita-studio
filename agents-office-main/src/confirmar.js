/* ===========================================================================
   3 nov 2026 · A PERGUNTA ANTES DE ESTRAGAR ALGO

   Havia quatro sítios que perguntavam com o `window.confirm` do browser:
   descartar o briefing por gravar, repor uma versão, gerar com custo
   desconhecido e importar uma cópia por cima do que está aqui. Funcionava,
   mas o diálogo do sistema bloqueia a página toda (a cena pára, o `rAF`
   pára), não se veste — é uma caixa cinzenta no meio de um escritório creme —
   e há contextos em que nem aparece (alguns webviews devolvem sempre `false`,
   outros ignoram-no por completo).

   Aqui há um diálogo da casa, com as mesmas três regras do resto:
   · nunca apaga nada sem dizer o que se perde e o que fica;
   · o botão que estraga é o segundo, não tem foco por omissão e é o único
     colorido;
   · Esc, o véu e o `Cancelar` fazem todos a mesma coisa: não fazer nada.

   Devolve sempre uma promessa com `true`/`false`. Sem DOM (um script, um
   teste de Node) cai no `confirm` nativo, que é o comportamento antigo.
   =========================================================================== */

const ESCAPAR = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* O diálogo veste-se sozinho: a mesa e o escritório são dois bundles e dois
   HTML diferentes, e um `<style>` no `shell.html` só servia um deles. */
const CSS = `
.cf-berma {
  position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center;
  box-sizing: border-box; padding: 20px; background: rgba(21,20,20,.34);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  animation: cf-entra .16s ease-out both;
}
.cf-caixa {
  /* border-box: sem isto o padding somava à largura e no telemóvel a caixa ia de bordo a bordo */
  box-sizing: border-box; width: min(420px, 100%); background: #FBF9F4; color: #151414;
  border-radius: 18px; padding: 22px 22px 18px;
  box-shadow: 0 30px 80px -20px rgba(21,20,20,.5), inset 0 0 0 1px rgba(21,20,20,.08);
  font-family: var(--sf, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
}
.cf-t {
  margin: 0 0 8px; font-family: var(--serif, Georgia, 'Times New Roman', serif);
  font-size: 21px; font-weight: 600; letter-spacing: -.01em; line-height: 1.25;
}
.cf-d { margin: 0 0 18px; font-size: 13px; line-height: 1.5; color: #4A4744; }
.cf-ac { display: flex; justify-content: flex-end; gap: 8px; }
.cf-btn {
  appearance: none; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 600;
  padding: 9px 16px; border-radius: 99px; border: 1px solid transparent;
}
.cf-cancelar { background: transparent; border-color: rgba(21,20,20,.18); color: #151414; }
.cf-cancelar:hover { background: rgba(21,20,20,.05); }
.cf-ok { background: #151414; color: #FBF9F4; }
.cf-ok:hover { background: #000; }
.cf-perigo .cf-ok { background: #A8201A; color: #FFF6F4; }
.cf-perigo .cf-ok:hover { background: #8E1B16; }
.cf-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .cf-berma { animation: none; } }
@keyframes cf-entra { from { opacity: 0; } }
body.dark .cf-caixa { background: #1E1D1B; color: #F2EFE9; box-shadow: 0 30px 80px -20px rgba(0,0,0,.7), inset 0 0 0 1px rgba(255,255,255,.10); }
body.dark .cf-d { color: #BDB8AF; }
body.dark .cf-cancelar { color: #F2EFE9; border-color: rgba(255,255,255,.20); }
body.dark .cf-cancelar:hover { background: rgba(255,255,255,.07); }
body.dark .cf-ok { background: #F2EFE9; color: #151414; }
body.dark .cf-perigo .cf-ok { background: #C8362C; color: #FFF6F4; }
`;

function garantirEstilo(doc) {
  if (doc.getElementById('cf-estilo')) return;
  const st = doc.createElement('style');
  st.id = 'cf-estilo';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

/** O HTML do diálogo, à parte da montagem — para se poder ler nos testes. */
export function htmlDaConfirmacao({
  titulo = 'Tens a certeza?', texto = '', confirmar = 'Continuar', cancelar = 'Cancelar', perigo = false,
} = {}) {
  return `<div class="cf-caixa${perigo ? ' cf-perigo' : ''}" role="alertdialog" aria-modal="true"
         aria-labelledby="cf-t" aria-describedby="cf-d" tabindex="-1">
      <h2 class="cf-t" id="cf-t">${ESCAPAR(titulo)}</h2>
      <p class="cf-d" id="cf-d">${ESCAPAR(texto)}</p>
      <div class="cf-ac">
        <button class="cf-btn cf-cancelar" type="button" data-cf-nao>${ESCAPAR(cancelar)}</button>
        <button class="cf-btn cf-ok" type="button" data-cf-sim>${ESCAPAR(confirmar)}</button>
      </div>
    </div>`;
}

/**
 * Pergunta e espera. `true` = seguir com a acção, `false` = não fazer nada.
 * A pergunta não vive no `window.confirm`: nada fica bloqueado por trás dela.
 */
export function confirmar(opcoes = {}) {
  const doc = globalThis.document;
  if (!doc || !doc.body) {
    /* sem DOM: o antigo comportamento, para nenhum chamador ficar pendurado */
    const pergunta = [opcoes.titulo, opcoes.texto].filter(Boolean).join('\n\n');
    return Promise.resolve(globalThis.confirm ? !!globalThis.confirm(pergunta) : true);
  }
  garantirEstilo(doc);

  const antes = doc.activeElement;
  const berma = doc.createElement('div');
  berma.className = 'cf-berma';
  berma.innerHTML = htmlDaConfirmacao(opcoes);
  doc.body.appendChild(berma);

  const caixa = berma.querySelector('.cf-caixa');
  const sim = berma.querySelector('[data-cf-sim]');
  const nao = berma.querySelector('[data-cf-nao]');

  return new Promise((resolve) => {
    let resolvido = false;
    const fim = (valor) => {
      if (resolvido) return;
      resolvido = true;
      doc.removeEventListener('keydown', tecla, true);
      berma.remove();
      try { if (antes && antes.isConnected && antes.focus) antes.focus(); } catch { /* o foco já não existe */ }
      resolve(valor);
    };
    /* Esc é «não»; Tab anda só entre os dois botões (o resto da página está por trás do véu) */
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim(false); return; }
      if (e.key !== 'Tab') return;
      const focados = [nao, sim];
      const i = focados.indexOf(doc.activeElement);
      e.preventDefault();
      const proximo = e.shiftKey
        ? focados[(i <= 0 ? focados.length : i) - 1]
        : focados[(i + 1) % focados.length];
      proximo.focus();
    };
    nao.addEventListener('click', () => fim(false));
    sim.addEventListener('click', () => fim(true));
    /* clicar no véu (o que não é a caixa) é desistir. O `target` tem de ser o próprio
       véu: um clique num botão não pode ser contado como clique fora. */
    berma.addEventListener('click', (e) => { if (e.target === berma) fim(false); });
    doc.addEventListener('keydown', tecla, true);
    /* o foco começa no botão que não estraga nada — quem pediu a pergunta não a responde por engano */
    (opcoes.perigo ? nao : sim).focus();
    if (caixa && !berma.contains(doc.activeElement)) caixa.focus();
  });
}
