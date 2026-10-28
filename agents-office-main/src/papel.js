/* ===========================================================================
   1.47.0 · DIGITALIZAR PAPEL — A CARA DA FUNÇÃO (28 out 2026)

   Pedido do dono: «Digitalizar papel podes colocar». A 1.46.0 pôs a leitura a
   funcionar no servidor (o motor de visão transcreve a fotografia). Faltava o
   sítio onde se faz isso: aqui está.

   O que este ecrã faz, e o que não faz:
     · tira a fotografia (ou escolhe um ficheiro) e manda-a ao servidor;
     · mostra a transcrição LITERAL, os campos com a confiança de cada um, e o
       que não foi encontrado — por palavras, não a fingir que correu tudo bem;
     · diz quem leu (modelo e fornecedor) e quanto demorou;
     · prepara um lead e pede confirmação antes de o guardar no funil.

   Não guarda a fotografia em lado nenhum: ela vai no pedido e morre com ele.
   =========================================================================== */

/* 1.47.0 · as fotografias de telemóvel são grandes (4–8 MB) e o servidor aceita
   6 MB. Encolher no browser, antes de enviar, é mais rápido e evita recusas
   absurdas por 200 KB a mais. Sem canvas (ambiente de teste, browser antigo),
   envia-se o original: degradar a experiência é melhor do que não funcionar. */
export const MAX_LADO = 1800;

/** Lê um File do browser para data URL. */
export function lerFicheiro(ficheiro) {
  return new Promise((ok, falha) => {
    if (!ficheiro) { falha(new Error('não escolheste nenhuma fotografia')); return; }
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result || ''));
    leitor.onerror = () => falha(new Error('não consegui ler esse ficheiro'));
    leitor.readAsDataURL(ficheiro);
  });
}

/**
 * Encolhe de verdade, no browser: desenha a imagem num canvas com o lado maior
 * em `maxLado` e devolve JPEG. Devolve `{ base64, mime }`.
 */
export function encolherFoto(dataUrl, { maxLado = MAX_LADO, qualidade = 0.85 } = {}) {
  return new Promise((ok) => {
    const original = String(dataUrl || '');
    const base64 = original.replace(/^data:[^;]+;base64,/, '');
    const mimeOriginal = (original.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
    const desistir = () => ok({ base64, mime: mimeOriginal, encolhida: false });
    if (typeof document === 'undefined' || typeof Image === 'undefined') return desistir();
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const maior = Math.max(img.width || 0, img.height || 0);
          const escala = maior > maxLado ? maxLado / maior : 1;
          const largura = Math.max(1, Math.round((img.width || 1) * escala));
          const altura = Math.max(1, Math.round((img.height || 1) * escala));
          const canvas = document.createElement('canvas');
          canvas.width = largura; canvas.height = altura;
          const ctx = canvas.getContext('2d');
          if (!ctx) return desistir();
          ctx.drawImage(img, 0, 0, largura, altura);
          const saida = canvas.toDataURL('image/jpeg', qualidade);
          const b64 = String(saida).replace(/^data:[^;]+;base64,/, '');
          /* se o canvas falhar (imagem manhosa), o original é o plano B */
          ok(b64 && b64.length > 100 ? { base64: b64, mime: 'image/jpeg', encolhida: escala !== 1 } : desistir());
        } catch { desistir(); }
      };
      img.onerror = desistir;
      img.src = original;
    } catch { desistir(); }
  });
}

/* ---------- as acções do servidor ---------- */

export async function carregarPapel(api) {
  try {
    const e = await api.call('/digitalizar/estado');
    api.S.papelEstado = e || null;
    api.S.papelErro = null;
  } catch (erro) {
    /* o modo local não tem motor: dizer isso é a resposta certa, não um erro */
    api.S.papelEstado = null;
    api.S.papelErro = erro?.message || 'o servidor não respondeu';
  }
}

/**
 * Manda a fotografia. `ficheiro` é um File; também aceita `{ base64, mime }`.
 * O estado vai para `S.papelResultado` / `S.papelFalha` — a vista lê daqui.
 */
export async function digitalizarFoto(api, ficheiro) {
  api.S.papelOcupado = true;
  api.S.papelFalha = null;
  api.S.papelProposta = null;
  api.S.papelGuardado = null;
  api.paint();
  try {
    let base64; let mime;
    if (ficheiro && typeof ficheiro === 'object' && ficheiro.base64) {
      base64 = ficheiro.base64; mime = ficheiro.mime || 'image/jpeg';
    } else {
      const dataUrl = await lerFicheiro(ficheiro);
      const pequena = await encolherFoto(dataUrl);
      base64 = pequena.base64; mime = pequena.mime;
    }
    const r = await api.call('/digitalizar', 'POST', { imagem: base64, mime });
    api.S.papelResultado = r || null;
    if (r && r.ok === false) api.S.papelFalha = r.erro || 'não consegui ler o documento';
  } catch (e) {
    api.S.papelFalha = e?.message || 'não consegui ler o documento';
  } finally {
    api.S.papelOcupado = false;
    api.paint();
  }
}

/** Prepara o lead a partir dos campos lidos. Não grava nada. */
export async function proporLead(api) {
  const campos = api.S.papelResultado?.campos || [];
  if (!campos.length) { api.toast?.('não há campos para propor', true); return; }
  try {
    api.S.papelProposta = await api.call('/digitalizar/lead', 'POST', { campos });
    api.paint();
  } catch (e) { api.toast?.(e.message, true); }
}

/** Guarda no funil — só depois de a pessoa ter o nome à frente e confirmar. */
export async function guardarLead(api) {
  const p = api.S.papelProposta;
  if (!p?.lead?.name) { api.toast?.('falta o nome — escreve-o antes de guardar', true); return; }
  const campo = (id) => String((typeof document !== 'undefined' ? document.getElementById(id)?.value : '') || '').trim();
  const nome = campo('papelNome') || p.lead.name;
  if (!nome) { api.toast?.('falta o nome — escreve-o antes de guardar', true); return; }
  try {
    const r = await api.call('/ops/leads', 'POST', {
      leads: [{
        name: nome,
        phone: p.lead.phone || undefined,
        email: p.lead.email || undefined,
        notes: p.lead.notes || undefined,
        source: 'digitalizacao',
      }],
    });
    api.S.papelGuardado = r?.created ? 'guardado' : r?.updated ? 'actualizado' : 'não entrou';
    api.S.papelProposta = null;
    api.paint();
  } catch (e) { api.toast?.(e.message, true); }
}

export function limparPapel(api) {
  api.S.papelResultado = null;
  api.S.papelProposta = null;
  api.S.papelFalha = null;
  api.S.papelGuardado = null;
  api.paint();
}

/* ---------- a vista ---------- */

const pct = (n) => (Number.isFinite(Number(n)) ? `${Math.round(Number(n) * 100)}%` : '—');

export function vistaPapel(S, { esc = String } = {}) {
  const e = S.papelEstado;
  const r = S.papelResultado;
  const ocupado = !!S.papelOcupado;
  const leitor = e?.ocr;
  const cadeia = e?.visao?.cadeia || [];

  const estadoLeitor = !e
    ? `<div class="ia-faixa bad"><b>Sem leitor.</b> ${esc(S.papelErro || 'o servidor não respondeu — no modo local não há motor para ler imagens')}.
        A função existe: abre a mesa publicada, que tem o motor atrás.</div>`
    : `<div class="ia-faixa ${leitor?.disponivel ? 'ok' : 'bad'}">
        ${leitor?.disponivel
    ? `<b>Leitor pronto.</b> ${leitor.via === 'ocr' ? 'serviço de OCR configurado' : 'motor de visão da casa'}${cadeia.length ? ` · ${cadeia.map((m) => `${esc(m.fornec)}/${esc(m.modelo)}`).join(' → ')}` : ''}`
    : `<b>Sem leitor.</b> ${esc(leitor?.motivo || 'não há modelo de visão com acesso')}`}
      </div>`;

  const resultado = !r ? '' : `
    <div class="card" style="margin-top:var(--s4)">
      <h3 style="margin-top:0">O que está escrito
        <span class="ia-sub">· ${r.caracteres || 0} caracteres${r.via ? ` · lido por ${esc(r.via === 'ocr' ? 'OCR configurado' : 'motor de visão')}` : ''}${r.leitor?.modelo ? ` (${esc(r.leitor.modelo)}, ${esc(r.leitor.fornecedor)}, ${r.leitor.ms} ms)` : ''}</span></h3>
      <pre class="ia-mono" style="white-space:pre-wrap;background:rgba(0,0,0,.03);padding:var(--s4);border-radius:10px;max-height:280px;overflow:auto">${esc(r.texto || '(vazio)')}</pre>

      ${(r.campos || []).length ? `<table class="ia-tab" style="margin-top:var(--s4)">
        <thead><tr><th>Campo</th><th>Valor</th><th>Confiança</th><th>Como</th></tr></thead>
        <tbody>${r.campos.map((c) => `<tr>
          <td>${esc(c.campo)}</td>
          <td class="ia-mono"><b>${esc(c.valor)}</b></td>
          <td>${esc(pct(c.confianca))}</td>
          <td class="ia-sub">${esc(c.controlo || c.heuristica || (c.normalizado ? 'normalizado' : c.mascarado ? 'mascarado' : 'do texto'))}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="ia-faixa warn">Nenhum campo reconhecido. O texto está acima — lê-o e escreve o que falta à mão.</div>'}

      ${(r.faltam || []).length ? `<p class="ia-sub" style="margin-top:var(--s3)">Não encontrei: <b>${r.faltam.map(esc).join(', ')}</b>. ${esc((r.avisos || [])[0] || '')}</p>` : ''}

      <div class="acts" style="margin-top:var(--s4)">
        <button class="btn primary" data-act="papel-propor"${(r.campos || []).length ? '' : ' disabled'}>Preparar lead</button>
        <button class="btn ghost" data-act="papel-limpar">Digitalizar outro</button>
      </div>
      ${S.papelGuardado ? `<div class="ia-faixa ok" style="margin-top:var(--s3)">Lead ${esc(S.papelGuardado)} no funil.</div>` : ''}
    </div>`;

  const proposta = S.papelProposta ? (() => {
    const p = S.papelProposta;
    return `<div class="card" style="margin-top:var(--s4)">
      <h3 style="margin-top:0">Lead proposto <span class="ia-sub">· ainda não está guardado</span></h3>
      ${p.faltaNome ? `<div class="ia-faixa warn">${esc(p.aviso || 'o documento não deixou um nome legível — escreve-o')}</div>` : ''}
      <div style="display:grid;gap:var(--s3);max-width:420px;margin-top:var(--s3)">
        <label for="papelNome">Nome</label>
        <input id="papelNome" value="${esc(p.lead?.name || '')}" placeholder="nome da empresa ou da pessoa">
        <label>Telefone</label><div class="ia-mono">${esc(p.lead?.phone || '—')}</div>
        <label>Email</label><div class="ia-mono">${esc(p.lead?.email || '—')}</div>
        <label>Notas</label><div class="ia-sub">${esc(p.lead?.notes || '—')}</div>
      </div>
      <div class="acts" style="margin-top:var(--s4)">
        <button class="btn primary" data-act="papel-guardar">Guardar no funil</button>
        <button class="btn ghost" data-act="papel-limpar">Descartar</button>
      </div>
      <p class="hint" style="margin-top:var(--s3)">Só o nome, o telefone e o email vêm do papel; o resto é escrito por ti. Nada entra no funil sem este clique.</p>
    </div>`;
  })() : '';

  const falha = S.papelFalha
    ? `<div class="ia-faixa bad" style="margin-top:var(--s3)">${esc(S.papelFalha)}</div>`
    : '';

  return `<div class="wrap">
    <div class="head"><div><h1>Papel</h1>
      <p class="sub">Uma fotografia de uma factura, de um cartão de visita ou de uma ficha — e os campos saem daqui.</p></div></div>
    ${estadoLeitor}
    <div class="card" style="margin-top:var(--s4)">
      <h3 style="margin-top:0">${ocupado ? 'A ler o documento…' : 'Tirar fotografia ou escolher ficheiro'}</h3>
      <p class="ia-sub" style="margin-top:0">Fotografa o papel de frente, com luz, sem sombras por cima do texto. Aceito imagem (PNG, JPEG, WebP, TIFF) e PDF até 6 MB.</p>
      <input type="file" id="papelFoto" accept="image/*,application/pdf" capture="environment" hidden>
      <div class="acts" style="margin-top:var(--s3)">
        <button class="btn primary" data-act="papel-escolher"${ocupado ? ' disabled' : ''}>${ocupado ? 'A ler…' : 'Abrir câmara'}</button>
        <label class="btn ghost" for="papelFoto" style="cursor:pointer">Escolher ficheiro</label>
      </div>
      ${falha}
    </div>
    ${resultado}
    ${proposta}
  </div>`;
}

/* ---------- as acções que a mesa chama ---------- */

export async function accaoPapel(nome, el, api) {
  if (nome === 'papel-escolher') {
    const input = typeof document !== 'undefined' ? document.getElementById('papelFoto') : null;
    if (input) input.click();
    return true;
  }
  if (nome === 'papel-propor') { await proporLead(api); return true; }
  if (nome === 'papel-guardar') { await guardarLead(api); return true; }
  if (nome === 'papel-limpar') { limparPapel(api); return true; }
  return false;
}

/** Liga o input da fotografia. Chamado uma vez, no arranque da mesa. */
export function ligarPapel(api) {
  if (typeof document === 'undefined') return;
  document.addEventListener('change', async (e) => {
    if (!e.target || e.target.id !== 'papelFoto') return;
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    await digitalizarFoto(api, f);
  });
}
