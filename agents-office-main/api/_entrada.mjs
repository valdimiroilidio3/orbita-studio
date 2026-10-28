/* ===========================================================================
   As respostas dos clientes — 1.37.0 (27 out 2026).

   Até aqui a mesa sabia mandar: aprovava, enviava pelo Resend ou pelo WhatsApp
   Cloud API, guardava o `provider_id`. Não sabia OUVIR. Um cliente que
   respondesse ficava para sempre «contactado», e o dono só descobria por acaso,
   no telemóvel. Isto fecha o círculo: um webhook entra, encontra a pessoa certa,
   escreve a resposta onde ela se lê e move o funil.

   Regras (todas por provar, sem inventar nada):
   · idempotente — o mesmo evento duas vezes (a Meta repete!) não duplica nada;
   · casa primeiro pelo `provider_id` (é a resposta àquela mensagem), depois pelo
     email/telefone do lead; sem correspondência grava a resposta com `lead: null`
     em vez de a deitar fora;
   · o funil só avança a partir de `novo`/`contactado`: um cliente que já é
     `ganho` não volta a `respondeu` por ter respondido;
   · sem segredo configurado, o webhook recusa (503). Nunca se aceita um POST
     anónimo a fingir de cliente.
   =========================================================================== */
import { createHmac, timingSafeEqual } from 'node:crypto';

const limpo = (v) => String(v ?? '').trim();
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/* 3 51 912 345 678 e +351912345678 são o mesmo número para quem responde */
export function telefoneCanonico(v) {
  const d = soDigitos(v);
  if (!d) return '';
  if (d.length > 9) return d.slice(-9);   // sem indicativo: comparam-se os 9 últimos
  return d;
}

export function emailCanonico(v) {
  const e = limpo(v).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) ? e : '';
}

/* ---------- assinaturas ---------- */

/** Resend usa Svix: HMAC-SHA256 de `${id}.${timestamp}.${corpo}`, em base64. */
export function assinaturaSvix({ segredo, id, timestamp, corpoBase, assinatura }) {
  const chave = limpo(segredo).replace(/^whsec_/, '');
  if (!chave || !id || !timestamp || !assinatura) return false;
  let esperado;
  try { esperado = createHmac('sha256', Buffer.from(chave, 'base64')).update(`${id}.${timestamp}.${corpoBase}`).digest(); } catch { return false; }
  const candidatas = String(assinatura).split(' ').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/^v\d+,/, ''));
  for (const c of candidatas) {
    let dada;
    try { dada = Buffer.from(c, 'base64'); } catch { continue; }
    if (dada.length === esperado.length && timingSafeEqual(dada, esperado)) return true;
  }
  return false;
}

/** Meta: `x-hub-signature-256: sha256=<hex>` sobre o corpo bruto, com o app secret. */
export function assinaturaMeta({ segredo, corpoBase, assinatura }) {
  const s = limpo(segredo);
  const a = limpo(assinatura).replace(/^sha256=/, '');
  if (!s || !a) return false;
  const esperado = createHmac('sha256', s).update(corpoBase).digest('hex');
  const dada = a.toLowerCase();
  if (dada.length !== esperado.length) return false;
  try { return timingSafeEqual(Buffer.from(dada, 'hex'), Buffer.from(esperado, 'hex')); } catch { return false; }
}

/* ---------- normalizar o que os fornecedores mandam ---------- */

/* Um email de entrada (Resend `email.received`). O texto pode vir em `text`,
   `plain` ou só em html: nesse caso tira-se o que se pode, sem fingir formato. */
export function normalizarEmail(evento) {
  const d = evento?.data || evento || {};
  const de = limpo(d.from?.email || d.from || d.sender || d.email);
  const para = limpo(Array.isArray(d.to) ? d.to[0]?.email || d.to[0] : d.to || d.recipient);
  const texto = limpo(d.text || d.plain || d.body || d.textBody)
    || String(d.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!de) return [];
  return [{
    canal: 'email',
    idExterno: limpo(d.email_id || d.id || evento?.id) || `email:${de}:${limpo(d.subject)}:${texto.slice(0, 40)}`,
    referencia: limpo(d.in_reply_to || d.headers?.['in-reply-to'] || d.reply_to) || null,
    de, para, assunto: limpo(d.subject), texto,
    quando: limpo(d.created_at || evento?.created_at) || new Date().toISOString(),
  }];
}

/* O webhook do WhatsApp traz lotes: mensagens (o que o cliente escreveu) e
   estados (entregue/lido). Tratam-se os dois — um «lido» também é informação. */
export function normalizarWhatsapp(corpo) {
  const saida = [];
  const entradas = Array.isArray(corpo?.entry) ? corpo.entry : [];
  for (const e of entradas) {
    for (const c of (Array.isArray(e?.changes) ? e.changes : [])) {
      const v = c?.value || {};
      const nomes = new Map((Array.isArray(v.contacts) ? v.contacts : []).map((x) => [x.wa_id, x.profile?.name]));
      for (const msg of (Array.isArray(v.messages) ? v.messages : [])) {
        const texto = limpo(msg.text?.body)
          || limpo(msg.button?.text)
          || limpo(msg.interactive?.button_reply?.title)
          || limpo(msg.interactive?.list_reply?.title)
          || (msg.type === 'audio' ? '(mensagem de voz)' : `(${limpo(msg.type) || 'mensagem'} sem texto)`);
        saida.push({
          canal: 'whatsapp',
          tipo: 'mensagem',
          /* a Meta repete o webhook quando não recebe 200: o id da mensagem é a
             única coisa que impede a mesma resposta de aparecer duas vezes */
          idExterno: `wa:${limpo(msg.id) || `${limpo(msg.from)}:${limpo(msg.timestamp)}`}`,
          referencia: limpo(msg.context?.id) || null,
          de: limpo(msg.from), para: limpo(v.metadata?.display_phone_number),
          nome: limpo(nomes.get(msg.from)) || null,
          texto,
          quando: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
      for (const st of (Array.isArray(v.statuses) ? v.statuses : [])) {
        saida.push({
          canal: 'whatsapp', tipo: 'estado',
          idExterno: `wa:st:${limpo(st.id)}:${limpo(st.status)}`,
          referencia: limpo(st.id) || null,
          de: limpo(v.metadata?.display_phone_number), para: limpo(st.recipient_id),
          estado: limpo(st.status),   // sent | delivered | read | failed
          quando: st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return saida;
}

/* ---------- gravar ---------- */

const AVANCA = { novo: 'respondeu', contactado: 'respondeu' };   // e só estes

async function acharLead(repo, evento) {
  /* 1.º pela mensagem a que se responde: é a prova, não uma semelhança */
  if (evento.referencia) {
    const todas = await repo.mensagens.list(300);
    const mae = todas.find((m) => m.provider_id === evento.referencia);
    if (mae?.lead_id) {
      const l = await repo.leads.byId(mae.lead_id);
      if (l) return l;
    }
  }
  const leads = await repo.leads.list(500);
  if (evento.canal === 'email') {
    const e = emailCanonico(evento.de);
    if (e) { const l = leads.find((x) => emailCanonico(x.email) === e); if (l) return l; }
  } else {
    const t = telefoneCanonico(evento.de);
    if (t) { const l = leads.find((x) => telefoneCanonico(x.phone) === t); if (l) return l; }
  }
  return null;
}

/**
 * Grava uma resposta (ou um estado de entrega) e devolve o que mudou.
 * Idempotente por `id_externo`. Nunca atira por falta de lead: uma resposta de
 * quem não está no funil é informação, não erro — fica com `lead: null`.
 */
export async function registarResposta(repo, evento, { agora = () => new Date().toISOString() } = {}) {
  const idExterno = limpo(evento.idExterno);
  if (!idExterno) throw new Error('evento sem identificador: não se pode garantir que não duplica');
  const antes = await repo.mensagens.porExterno?.(idExterno);
  if (antes) return { ok: true, duplicado: true, mensagem: antes, lead: antes.lead_id ? await repo.leads.byId(antes.lead_id) : null };

  const lead = await acharLead(repo, evento);

  /* estados (entregue/lido) não criam mensagem: actualizam a que saiu */
  if (evento.tipo === 'estado') {
    const todas = await repo.mensagens.list(300);
    const mae = evento.referencia ? todas.find((m) => m.provider_id === evento.referencia) : null;
    if (!mae) return { ok: true, ignorado: 'sem mensagem para este estado', estado: evento.estado };
    const campo = { delivered: 'entregue_at', read: 'lido_at' }[evento.estado];
    if (!campo) return { ok: true, ignorado: `estado «${evento.estado}» não altera nada` };
    const m = await repo.mensagens.patch(mae.id, { [campo]: agora() });
    return { ok: true, estado: evento.estado, mensagem: m, lead };
  }

  const mensagem = await repo.mensagens.inserir({
    lead_id: lead?.id || null,
    channel: evento.canal,
    body: String(evento.texto || '').slice(0, 8000) || '(sem texto)',
    subject: evento.assunto || null,
    status: 'recebida',
    direction: 'in',
    from: evento.de || null,
    to: evento.para || null,
    provider: evento.canal === 'email' ? 'resend' : 'whatsapp-cloud',
    provider_id: null,
    id_externo: idExterno,
    recebida_at: agora(),
  });

  let leadAtualizado = lead;
  if (lead && AVANCA[lead.status]) {
    leadAtualizado = await repo.leads.patch(lead.id, {
      status: AVANCA[lead.status], responded_at: agora(), updated_at: agora(),
    });
  } else if (lead && !lead.responded_at) {
    leadAtualizado = await repo.leads.patch(lead.id, { responded_at: agora(), updated_at: agora() });
  }

  try {
    await repo.atividade.add('mensagem', lead
      ? `${lead.name || 'um lead'} respondeu por ${evento.canal}`
      : `resposta por ${evento.canal} de quem não está no funil (${evento.de || 'sem remetente'})`);
  } catch { /* o rasto não pode partir a recepção */ }

  return { ok: true, duplicado: false, mensagem, lead: leadAtualizado, casou: !!lead };
}
