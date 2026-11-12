/* ===========================================================================
   1.87.1 · a saúde dos fornecedores (A5 do alvo 1.0: «alerta quando um
   fornecedor cai (heartbeat em `/ia/uso`)»).

   O heartbeat é o próprio uso: cada pedido a um modelo fica registado com
   `ok` e a hora. Daí sai, por fornecedor:
     · a última vez que respondeu bem (`ultimoOk`);
     · quantas falhas seguidas tem, da mais recente para trás (`falhasSeguidas`);
     · o último erro real.

   Regra do alerta: 3 ou mais falhas seguidas, com a última nas últimas 24 h.
   Um sucesso volta a pôr o fornecedor «ok» e o alerta sai sozinho — não fica
   a gritar para sempre.

   Puro: não lê a base nem o relógio, para o teste poder mentir sobre o tempo.
   =========================================================================== */

export const MINIMO_FALHAS_SEGUIDAS = 3;
export const JANELA_ALERTA_MS = 24 * 60 * 60 * 1000;

const tempo = (v) => { const ms = Date.parse(v); return Number.isFinite(ms) ? ms : null; };

/**
 * @param {Array} linhas as linhas de `orbita_ai_uso` (ou equivalente), em qualquer ordem
 * @returns {{ fornecedores: Array, alertas: Array }}
 */
export function saudeDosFornecedores(linhas = [], { agora = Date.now(), minimo = MINIMO_FALHAS_SEGUIDAS, janelaMs = JANELA_ALERTA_MS } = {}) {
  const porFornecedor = new Map();
  for (const l of (linhas || []).filter(Boolean)) {
    const k = l.fornecedor || '—';
    if (!porFornecedor.has(k)) porFornecedor.set(k, []);
    porFornecedor.get(k).push(l);
  }

  const fornecedores = [];
  for (const [fornecedor, lista] of porFornecedor) {
    /* mais recente primeiro; sem data, vai para o fim */
    const ord = [...lista].sort((a, b) => (tempo(b.criado) ?? -Infinity) - (tempo(a.criado) ?? -Infinity));
    let falhasSeguidas = 0;
    for (const l of ord) { if (l.ok) break; falhasSeguidas += 1; }
    const ultimoOk = ord.find((l) => l.ok) || null;
    const ultimaFalha = ord.find((l) => !l.ok) || null;
    const ultima = ord[0];
    const msUltima = tempo(ultima?.criado);
    const recente = msUltima != null && agora - msUltima <= janelaMs;

    let estado = 'ok';
    if (!recente) estado = 'parado';                  /* nada nas últimas 24 h: não há o que alertar */
    else if (ultima.ok) estado = 'ok';
    else if (falhasSeguidas >= minimo) estado = 'em-baixo';
    else estado = 'a-falhar';                         /* 1 ou 2 falhas: ainda não é alerta */

    fornecedores.push({
      fornecedor,
      estado,
      falhasSeguidas,
      ultimoOk: ultimoOk ? { quando: ultimoOk.criado || null, modelo: ultimoOk.modelo || null } : null,
      ultimoErro: ultimaFalha ? { quando: ultimaFalha.criado || null, modelo: ultimaFalha.modelo || null, erro: String(ultimaFalha.erro || 'sem motivo guardado').slice(0, 300) } : null,
    });
  }

  const alertas = fornecedores
    .filter((f) => f.estado === 'em-baixo')
    .map((f) => ({
      fornecedor: f.fornecedor,
      falhasSeguidas: f.falhasSeguidas,
      desde: f.ultimoOk?.quando || null,
      erro: f.ultimoErro?.erro || 'sem motivo guardado',
      mensagem: `${f.fornecedor} falhou ${f.falhasSeguidas} pedidos seguidos`
        + (f.ultimoOk?.quando ? ` (última resposta boa: ${f.ultimoOk.quando})` : ' (nunca respondeu bem nesta base)'),
    }));

  fornecedores.sort((a, b) => (a.estado === 'em-baixo' ? 0 : 1) - (b.estado === 'em-baixo' ? 0 : 1) || a.fornecedor.localeCompare(b.fornecedor));
  return { fornecedores, alertas };
}
