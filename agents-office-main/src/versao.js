// Órbita — A VERSÃO DA PÁGINA CONTRA A DO SERVIDOR (1.89.1)
//
// O dono viu a página no telemóvel e achou que estava atrasada. O único número de
// versão que a página mostrava era «Órbita Project 1.0.0», escrito à mão no rodapé
// da licença — nunca mudava, e não dizia de que build era a página.
//
// Agora o build (vindo do `package.json`, via `build.mjs`) aparece no rodapé, e a
// página pergunta ao servidor qual é a versão dele. Se forem diferentes, a página
// diz isso e pede para recarregar. Não recarrega sozinha: uma página de 3D a meio
// de uma conversa não se deita fora por um número.

/** Compara a versão desta página com a do servidor. Puro: não toca no DOM. */
export function avaliarVersao(build, servidor) {
  const b = String(build || '').trim();
  const s = String(servidor || '').trim();
  if (!b || b.startsWith('__')) return { estado: 'desconhecida', texto: `build ${b || '?'}` };
  if (!s) return { estado: 'desconhecida', texto: `build ${b}` };
  if (b === s) return { estado: 'igual', texto: `build ${b}` };
  return { estado: 'atrasada', texto: `build ${b} · o servidor está em ${s} — recarrega a página` };
}

/** Lê o build que o `build.mjs` escreveu no rodapé (`#lcBuild[data-versao]`). */
export function buildDaPagina(doc = globalThis.document) {
  const el = doc?.getElementById?.('lcBuild');
  return el?.dataset?.versao || '';
}

/** Pergunta ao servidor e escreve o resultado no rodapé. Nunca lança. */
export async function verificarVersao({ doc = globalThis.document, fetchImpl = globalThis.fetch } = {}) {
  const el = doc?.getElementById?.('lcBuild');
  if (!el || typeof fetchImpl !== 'function') return null;
  const build = buildDaPagina(doc);
  let servidor = '';
  try {
    const r = await fetchImpl('/api/health', { cache: 'no-store', headers: { accept: 'application/json' } });
    const j = await r.json().catch(() => null);
    servidor = String(j?.versao || j?.version || '');
  } catch { /* sem resposta: fica «desconhecida», que é o que é */ }
  const v = avaliarVersao(build, servidor);
  el.textContent = v.texto;
  el.dataset.estado = v.estado;
  el.classList.toggle('atras', v.estado === 'atrasada');
  return v;
}
