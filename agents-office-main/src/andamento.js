/* ===========================================================================
   1.80.0 · O ANDAMENTO DOS AGENTES (9 nov 2026)

   Pedido do dono: «demora um pouco fazendo uma animação nos agentes, escrevendo,
   fazendo pergunta entre eles … adiciona animação de andamento nos agentes, de
   maneira bem inteligente e de forma natural e incrível».

   O que este ficheiro é: as CONTAS do andamento, puras e testáveis — que balão
   mostrar, quando, com que texto, e como se desenha o anel e o balão. Quem põe
   isto em cena (sprites, posições, câmara) é o `main.js`.

   Regras que não se quebram (herdadas da 26 out 2026, quando a demonstração saiu):
     · nenhuma percentagem inventada — o servidor não mede o trabalho, e um anel
       que finge 73% é uma mentira com agulha. O anel mostra ACTIVIDADE (um ciclo
       que respira) e o tempo decorrido, que é um facto;
     · nenhuma fala inventada sobre o trabalho: o balão diz o título real da
       tarefa, o estado real, a hora real do início e a tentativa real. A
       «pergunta entre eles» é encenação de um facto que já existe na base
       (o trabalho a correr), não um diálogo fabricado com conteúdo falso;
     · sem tarefa não há animação: quem não tem trabalho fica sentado e quieto.
   =========================================================================== */

export const RITMO = {
  /** quanto tempo o anel leva a dar uma volta (é actividade, não progresso) */
  cicloMs: 96000,
  /** de quanto em quanto tempo um posto a trabalhar diz uma frase */
  falaMs: 17000,
  /** uma pergunta do chefe ao posto que trabalha */
  perguntaMs: 41000,
  /** um balão vive isto e desaparece */
  vidaMs: 6200,
};

const dois = (n) => String(n).padStart(2, '0');

/** «02:13» — o tempo decorrido, que é o único número honesto que temos. */
export function decorrido(ms = 0) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const m = Math.floor(total / 60);
  if (m < 60) return `${dois(m)}:${dois(total % 60)}`;
  return `${Math.floor(m / 60)}h${dois(m % 60)}`;
}

/** Há quanto tempo começou, em minutos ditos («há 2 min»); «agora» abaixo de 45 s. */
export function desde(iso, agora = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const min = Math.round((agora - t) / 60000);
  if (min <= 0) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

/**
 * O estado de andamento de um posto, a partir do retrato do servidor.
 * Devolve `null` quando não há nada a animar — é assim que se evita o «ao vivo»
 * eterno que já nos custou uma versão.
 */
export function andamentoDoPosto(d, { agora = Date.now() } = {}) {
  if (!d || !d.state) return null;
  const task = d.task || null;
  if (d.state !== 'live' && d.state !== 'waiting') return null;
  const desdeMs = task?.started_at ? Math.max(0, agora - Date.parse(task.started_at)) : 0;
  const tentativa = task?.attempts ? `${task.attempts}/${task.maxAttempts || 1}` : '';
  return {
    estado: d.state,
    // a fracção do anel: um ciclo de actividade, não uma percentagem de trabalho
    fraccao: (agora % RITMO.cicloMs) / RITMO.cicloMs,
    color: d.state === 'waiting' ? '#B4830B' : '#1E9070',
    rotulo: decorrido(desdeMs),
    titulo: String(task?.title || task?.kind || ''),
    tentativa,
    desde: desde(task?.started_at, agora),
  };
}

/**
 * As frases de um posto, por ordem de importância. Todas saem de campos reais do
 * retrato; nenhuma inventa conteúdo do trabalho.
 */
export function linhasDoPosto(d, { agora = Date.now() } = {}) {
  if (!d) return [];
  const a = andamentoDoPosto(d, { agora });
  const out = [];
  if (!a) {
    if (d.last?.state === 'succeeded') out.push(`«${d.last.title || d.last.kind}» pronta às ${hora(d.last.finished_at)}`);
    else if (d.last?.state === 'failed') out.push(`falhou: ${String(d.last.error || d.last.title || '').slice(0, 60)}`);
    return out;
  }
  out.push(`«${a.titulo}»`);
  if (d.state === 'waiting') out.push('à espera do teu OK');
  else out.push(`a escrever · ${a.desde}${a.tentativa ? ` · tentativa ${a.tentativa}` : ''}`);
  return out;
}

/**
 * A pergunta do chefe ao posto que está a trabalhar.
 * É a única linha que «fala» em nome de alguém: diz o título real e pede o tempo
 * decorrido — nunca um resultado que ainda não existe.
 */
export function perguntaDoChefe(d, chefe = 'chefe', { agora = Date.now() } = {}) {
  const a = andamentoDoPosto(d, { agora });
  if (!a || a.estado !== 'live') return '';
  return `${chefe}: «${a.titulo}»?`;
}

export function respostaDoPosto(d, { agora = Date.now() } = {}) {
  const a = andamentoDoPosto(d, { agora });
  if (!a) return '';
  return a.estado === 'waiting' ? 'a acabar — preciso de uma decisão' : `a correr · ${a.desde}`;
}

function hora(iso) {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime())
    ? t.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';
}

/**
 * Quando é a próxima fala deste posto. Determinístico (semente = o id), para dois
 * agentes não falarem ao mesmo tempo e para o teste poder prever o instante.
 */
export function proximaFala(id = '', agora = Date.now(), tipo = 'fala') {
  const semente = [...String(id)].reduce((h, c) => (h * 33 + c.charCodeAt(0)) % 971, 7);
  const base = tipo === 'pergunta' ? RITMO.perguntaMs : RITMO.falaMs;
  return agora + base + (semente % 7) * 900;
}

/** Quebra o texto em linhas que caibam numa largura, com uma fonte de 13 px. */
export function quebrar(texto, { largura = 260, medir = null, tamanho = 13 } = {}) {
  const medirReal = medir || ((s) => String(s).length * tamanho * 0.54);
  const palavras = String(texto || '').split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (medirReal(tentativa) > largura && atual) { linhas.push(atual); atual = p; }
    else atual = tentativa;
    // uma palavra sozinha maior do que a caixa: corta-a em pedaços
    while (medirReal(atual) > largura && atual.length > 1) {
      let corte = atual.length - 1;
      while (corte > 1 && medirReal(atual.slice(0, corte)) > largura) corte--;
      linhas.push(atual.slice(0, corte));
      atual = atual.slice(corte);
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

/**
 * Desenha o balão. Recebe um contexto 2D (o do `<canvas>` ou um duplo nos testes)
 * e devolve as medidas usadas — quem chama precisa delas para o sprite.
 */
export function desenharBalao(ctx, texto, {
  largura = 300, fonte = '600 22px -apple-system, "Helvetica Neue", Arial, sans-serif',
  fundo = 'rgba(253,255,248,.97)', tinta = '#151414', borda = 'rgba(21,20,20,.28)',
  medir = null, linhaAltura = 28, padding = 18, raio = 18,
} = {}) {
  const medidas = medir || ((s) => String(s).length * 11);
  const linhas = quebrar(texto, { largura: largura - padding * 2, medir: medidas });
  const altura = linhas.length * linhaAltura + padding * 2;
  const w = largura;
  // caixa arredondada + bico
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, w, altura, raio);
  else ctx.rect(0, 0, w, altura);
  ctx.fillStyle = fundo; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = borda; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 - 12, altura - 1); ctx.lineTo(w / 2, altura + 16); ctx.lineTo(w / 2 + 12, altura - 1);
  ctx.closePath(); ctx.fillStyle = fundo; ctx.fill();
  // texto
  ctx.font = fonte; ctx.fillStyle = tinta; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  linhas.forEach((l, i) => ctx.fillText(l, w / 2, padding + linhaAltura * (i + 0.5)));
  return { largura: w, altura: altura + 16, linhas: linhas.length, texto: linhas.join(' ') };
}

/**
 * Desenha o anel de andamento: um arco que percorre uma volta a cada `cicloMs`
 * (actividade, não progresso), com o tempo decorrido ao centro.
 */
export function desenharAnel(ctx, { fraccao = 0, rotulo = '', cor = '#1E9070', tamanho = 128 } = {}) {
  const c = tamanho / 2, r = c - 10;
  ctx.clearRect(0, 0, tamanho, tamanho);
  ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(21,20,20,.16)'; ctx.stroke();
  ctx.beginPath();
  const fim = -Math.PI / 2 + Math.max(0, Math.min(1, fraccao)) * Math.PI * 2;
  ctx.arc(c, c, r, -Math.PI / 2, fim);
  ctx.lineWidth = 8; ctx.strokeStyle = cor; ctx.lineCap = 'round'; ctx.stroke();
  // três pontos a orbitar: «há trabalho a acontecer», sem prometer um fim
  for (let i = 0; i < 3; i++) {
    const ang = -Math.PI / 2 + ((fraccao + i / 3) % 1) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(ang) * r, c + Math.sin(ang) * r, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = cor; ctx.fill();
  }
  if (rotulo) {
    ctx.font = '600 26px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = '#151414'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(rotulo, c, c);
  }
  return { tamanho, fraccao, rotulo };
}
