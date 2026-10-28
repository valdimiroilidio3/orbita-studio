// Órbita — a gaveta OPERAÇÃO (26 out 2026).
//
// O que antes não tinha sítio nenhum: os leads que ficam guardados a sério (com a nota e as razões
// dela), as mensagens à espera do OK do dono, a fila de trabalho e o rasto do que aconteceu.
// Nada aqui inventa: se a base de dados não responde, a gaveta diz isso em vez de mostrar zeros.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = c => (c / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
const hhmm = iso => (iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');

export function initOps({ api = '/api' } = {}) {
  const btn = document.getElementById('topOps');
  const panel = document.getElementById('opsPanel');
  if (!btn || !panel) return null;

  const P = {
    sum: panel.querySelector('.op-sum'), tabs: [...panel.querySelectorAll('.op-tab')],
    body: panel.querySelector('.op-body'), close: panel.querySelector('.op-close'),
    refresh: panel.querySelector('.op-refresh'), note: panel.querySelector('.op-note'),
    client: panel.querySelector('.op-client'), newClient: panel.querySelector('[data-act="new-client"]'),
    /* 1.40.0: o pulso da leitura (ver «op-live» no shell) */
    live: panel.querySelector('.op-live'), liveT: panel.querySelector('.op-live-t'),
  };
  const S = { data: null, leads: [], messages: [], queue: null, events: [], tab: 'leads', busy: false, error: '',
    adding: false, composing: null, dossier: {}, learning: null, auto: null, saldo: null, clientes: null, novos: false,
    lastOk: 0, sig: '' };

  const open = () => { panel.hidden = false; btn.classList.add('on'); load({ forcar: true }); };
  const close = () => { panel.hidden = true; btn.classList.remove('on'); };
  const toggle = () => (panel.hidden ? open() : close());

  async function get(path) { const r = await fetch(api + path); return r.json(); }
  async function post(path, payload) {
    const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }

  /* 1.40.0 · O QUE ESTÁS A ESCREVER NÃO SE APAGA.
     A leitura de fundo repintava a gaveta de 15 em 15 segundos — e levava consigo um lead
     meio escrito, ou o cursor de quem estava a mudar a fase. Agora a leitura automática espera
     enquanto houver um formulário aberto ou o foco dentro de um campo; o «Atualizar» e as
     acções continuam a ler sempre. */
  function ocupadoAEscrever() {
    if (S.adding || S.composing || S.novos) return true;
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (!a || !panel.contains(a)) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable === true;
  }
  const semMovimento = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  function bater() {
    const ponto = P.live && P.live.querySelector('i');
    if (!ponto || semMovimento() || typeof ponto.animate !== 'function') return;
    try { ponto.animate([{ transform: 'scale(1)' }, { transform: 'scale(2.4)' }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch { /* sem WAAPI */ }
  }
  /* o rótulo ao lado do ponto: «ao vivo», «há 12 s», «sem servidor» — nunca um número inventado */
  function tickVivo() {
    if (!P.liveT || !P.live) return;
    const parado = Date.now() - (S.lastOk || 0);
    P.live.classList.toggle('bad', !!S.error);
    P.live.classList.toggle('stale', !S.error && S.lastOk > 0 && parado > 30000);
    let t;
    if (S.error) t = 'sem servidor';
    else if (!S.lastOk) t = 'a ligar…';
    else if (parado < 3000) t = 'ao vivo';
    else if (parado < 60000) t = `há ${Math.round(parado / 1000)} s`;
    else t = `há ${Math.round(parado / 60000)} min`;
    if (P.liveT.textContent !== t) P.liveT.textContent = t;
  }

  async function load({ forcar = false } = {}) {
    if (!forcar && ocupadoAEscrever()) { tickVivo(); return; }
    try {
      const [s, l, m, q, e, a, au, sa, cl, en, ev] = await Promise.all([
        get('/ops/summary'), get('/ops/leads?limit=40'), get('/ops/messages?limit=40'), get('/ops/queue'), get('/ops/events?limit=25'),
        get('/ops/aprendizagem'), get('/ops/autonomia'), get('/ops/saldo'), get('/ops/clientes'), get('/ops/ensaio'), get('/ops/evals'),
      ]);
      if (s.error) throw new Error(s.error);
      /* só se repinta o que MUDOU: um repaint sem novidade custa o foco e o texto a quem trabalha */
      const sig = JSON.stringify([s, l, m, q, e, a, au, sa, cl, en, ev]);
      const mudou = sig !== S.sig;
      Object.assign(S, { data: s, leads: l.leads || [], messages: m.messages || [], queue: q, events: e.events || [], learning: a, auto: au, saldo: sa, clientes: cl, ensaio: en, evals: ev, error: '', sig, lastOk: Date.now() });
      if (!mudou) { tickVivo(); return; }
      paintClients();
    } catch (err) {
      S.error = err.message === 'Failed to fetch' ? 'o servidor não respondeu — a gaveta não inventa números' : err.message;
    }
    tickVivo();
    paint();
    if (!S.error) bater();
  }

  function paintClients() {
    if (!P.client || !S.clientes) return;
    const lista = S.clientes.clientes || [];
    const activo = S.clientes.activo?.id || '';
    P.client.innerHTML = (lista.length ? '' : '<option value="">sem cliente — espaço principal</option>')
      + lista.map(c => `<option value="${esc(c.id)}"${c.id === activo ? ' selected' : ''}>${esc(c.nome)}${c.cidade ? ' · ' + esc(c.cidade) : ''}</option>`).join('');
    P.client.disabled = !lista.length;
  }

  function newClientForm() {
    return `<div class="op-form" role="group" aria-label="novo cliente">
      <input class="op-in" data-f="nome" placeholder="Nome do cliente" aria-label="nome do cliente">
      <div class="op-form-row">
        <input class="op-in" data-f="nicho" placeholder="Nicho (ex.: barbearias)" aria-label="nicho">
        <input class="op-in" data-f="cidade" placeholder="Cidade" aria-label="cidade">
      </div>
      <div class="op-form-row">
        <input class="op-in" data-f="preco" placeholder="Preço (€)" aria-label="preço" value="350">
        <input class="op-in" data-f="prazo" placeholder="Prazo (dias)" aria-label="prazo" value="7">
      </div>
      <div class="op-form-acts">
        <button class="op-b good" data-act="save-client">CRIAR ESPAÇO</button>
        <button class="op-b" data-act="cancel-client">CANCELAR</button>
        <span class="op-hint">Cada cliente tem a sua própria base de dados. Nada se mistura.</span>
      </div>
    </div>`;
  }

  function paintSummary() {
    const d = S.data;
    if (!d) { P.sum.textContent = S.error || 'a ler…'; P.sum.classList.toggle('bad', !!S.error); return; }
    P.sum.classList.remove('bad');
    const t = d.conversao.taxaResposta;
    P.sum.innerHTML = `<b>${d.leads.total}</b> leads · <b>${d.funil.contactados}</b> contactados · <b>${d.funil.clientes}</b> clientes`
      + (t === null ? ' · resposta: sem dados' : ` · resposta <b>${t}%</b>`)
      + ` · gasto <b>${money(d.custos.apiCentimos)}</b>`;
  }

  const STATUS_PT = { novo: 'novo', contactado: 'contactado', respondeu: 'respondeu', reuniao: 'reunião', cliente: 'cliente', perdido: 'perdido' };
  const NEXT = { novo: ['contactado', 'perdido'], contactado: ['respondeu', 'perdido'], respondeu: ['reuniao', 'perdido'], reuniao: ['cliente', 'perdido'], cliente: [], perdido: ['novo'] };

  function newLeadForm() {
    return `<div class="op-form" role="group" aria-label="novo lead">
      <input class="op-in" data-f="name" placeholder="Nome do negócio" aria-label="nome">
      <input class="op-in" data-f="city" placeholder="Cidade" aria-label="cidade">
      <input class="op-in" data-f="phone" placeholder="Telefone" aria-label="telefone">
      <input class="op-in" data-f="email" placeholder="Email" aria-label="email">
      <input class="op-in" data-f="website" placeholder="Site (se tiver)" aria-label="site">
      <div class="op-form-acts">
        <button class="op-b good" data-act="save-lead">GUARDAR LEAD</button>
        <button class="op-b" data-act="cancel-lead">CANCELAR</button>
        <span class="op-hint">A nota é calculada do que escreveres — sem site, telefone público e avaliação contam.</span>
      </div>
    </div>`;
  }

  function dossierBlock(l) {
    const d = S.dossier[l.id];
    const r = d.research || {};
    const status = r.status === 'ok'
      ? `${d.evidence.length} factos · oportunidade ${d.opportunity}/100`
      : r.status === 'sem_site' ? 'sem site — é a oportunidade' : `${r.status}${r.reason ? ': ' + r.reason : ''}`;
    const facts = (d.evidence || []).map(e => `<li><b>${esc(e.label)}</b>${e.quote ? `<q>${esc(e.quote)}</q>` : ''}</li>`).join('');
    return `<div class="op-dossier">
      <div class="op-dossier-h"><b>Dossiê</b><span class="op-m">${esc(status)}</span></div>
      ${facts ? `<ul class="op-facts">${facts}</ul>` : `<div class="op-hint">${esc(r.reason || 'Ainda não li o site deste lead.')}</div>`}
      <div class="op-form-acts">
        <button class="op-b good" data-act="draft" data-id="${esc(l.id)}">ESCREVER COM OS FACTOS</button>
        <button class="op-b" data-act="close-dossier" data-id="${esc(l.id)}">FECHAR</button>
      </div>
    </div>`;
  }

  function composer(l) {
    const ch = l.phone ? 'whatsapp' : 'email';
    return `<div class="op-form" role="group" aria-label="escrever mensagem a ${esc(l.name)}">
      <div class="op-form-row">
        <select class="op-in" data-f="channel" aria-label="canal">
          <option value="whatsapp"${ch === 'whatsapp' ? ' selected' : ''}${l.phone ? '' : ' disabled'}>WhatsApp${l.phone ? '' : ' (sem número)'}</option>
          <option value="email"${ch === 'email' ? ' selected' : ''}${l.email ? '' : ' disabled'}>Email${l.email ? '' : ' (sem endereço)'}</option>
        </select>
        <input class="op-in" data-f="subject" placeholder="Assunto (email)" aria-label="assunto" value="${esc(l.website ? 'O site de ' + l.name : 'Uma ideia para ' + l.name)}">
      </div>
      <textarea class="op-in" data-f="body" rows="3" aria-label="mensagem" placeholder="Escreve a mensagem. Nada sai daqui sem o teu OK em Hoje.">${esc(
        l.website ? `Bom dia, vi que o ${l.name} tem presença em ${String(l.website).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}${l.city ? ' em ' + l.city : ''} e reparei numa coisa que se resolve depressa: uma página simples, com o essencial e o botão de contacto. Faço isto por um valor fechado, sem mensalidade. Faz sentido falarmos 10 minutos esta semana?` : `Bom dia, encontrei o ${l.name}${l.city ? ' em ' + l.city : ''} e reparei que ainda não tem site — só o que aparece nas redes. Faço uma página simples, com o essencial e o botão de contacto, por um valor fechado. Faz sentido falarmos 10 minutos esta semana?`,
      )}</textarea>
      <div class="op-form-acts">
        <button class="op-b good" data-act="save-msg" data-id="${esc(l.id)}">GUARDAR RASCUNHO</button>
        <button class="op-b" data-act="cancel-msg">CANCELAR</button>
        <span class="op-hint">Fica à espera de aprovação. ${
          l.email || l.phone ? '' : 'Este lead não tem contacto — acrescenta um telefone ou email primeiro.'
        }</span>
      </div>
    </div>`;
  }

  function paintLeads() {
    const add = S.adding ? newLeadForm() : `<button class="op-b good" data-act="new-lead">+ NOVO LEAD</button>`;
    if (!S.leads.length) return `<div class="op-empty">Ainda não há leads na base de dados. Acrescenta um à mão, ou pesquisa na gaveta <b>LEADS</b> (◈) — o que encontra entra aqui, com nota e razões.</div><div class="op-form-acts">${add}</div>`;
    return S.leads.map(l => {
      const opts = [l.status, ...NEXT[l.status]].map(s => `<option value="${s}"${s === l.status ? ' selected' : ''}>${STATUS_PT[s]}</option>`).join('');
      return `<div class="op-row">
        <div class="op-main">
          <div class="op-n">${esc(l.name)}${l.consent === 'retirado' ? ' <span class="op-tag bad">opt-out</span>' : ''}</div>
          <div class="op-m">${esc(l.city || '')}${l.phone ? ' · ' + esc(l.phone) : ''}${l.email ? ' · ' + esc(l.email) : ''}${l.website ? ' · ' + esc(String(l.website).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]) : ' · sem site'}</div>
          <div class="op-reasons">${esc(l.score_reasons || '')}</div>
        </div>
        <div class="op-side">
          <div class="op-score">${l.score ?? '—'}<small>NOTA</small></div>
          <select class="op-stage" data-id="${esc(l.id)}" title="mudar de estado no funil">${opts}</select>
          <button class="op-b" data-act="compose" data-id="${esc(l.id)}">ESCREVER</button>
          <button class="op-b" data-act="research" data-id="${esc(l.id)}" title="ver o site e o que se pode citar">${S.dossier[l.id]?.research?.status === 'ok' ? 'VER FACTOS' : 'PESQUISAR'}</button>
        </div>
      </div>${S.composing === l.id ? composer(l) : ''}${S.dossier[l.id] ? dossierBlock(l) : ''}`;
    }).join('') + `<div class="op-form-acts">${add}</div>`;
  }

  function paintMessages() {
    const waiting = S.messages.filter(m => m.status === 'rascunho' || m.status === 'aprovada');
    const rest = S.messages.filter(m => !waiting.includes(m));
    const row = (m, acts) => `<div class="op-row">
      <div class="op-main"><div class="op-n">${esc(m.lead?.name || m.lead_id)} <span class="op-tag ${m.channel === 'whatsapp' ? 'ok' : ''}">${m.channel}</span> <span class="op-tag ${m.status === 'bloqueada' || m.status === 'falhou' ? 'bad' : ''}">${m.status}</span></div>
        <div class="op-m">${esc(m.subject || '')}</div><div class="op-reasons">${esc(String(m.body || '').slice(0, 140))}${m.reason ? ' — ' + esc(m.reason) : ''}</div></div>
      <div class="op-side op-acts">${acts}</div></div>`;
    const w = waiting.map(m => row(m, (m.status === 'rascunho'
      ? `<button class="op-b good" data-act="approve" data-id="${esc(m.id)}">APROVAR</button><button class="op-b" data-act="reject" data-id="${esc(m.id)}">REJEITAR</button>`
      : `<button class="op-b" data-act="send" data-id="${esc(m.id)}" data-ch="${esc(m.channel)}">${m.channel === 'whatsapp' ? 'ABRIR WHATSAPP' : 'ENVIAR'}</button>`
        + (m.channel === 'whatsapp' ? `<button class="op-b good" data-confirm="${esc(m.id)}" title="marcar como enviada depois de enviares no WhatsApp">JÁ ENVIEI</button>` : '')))).join('');
    const r = rest.length ? `<div class="op-sec">HISTÓRICO — diz o que responderam, e a nota aprende</div>${rest.slice(0, 12).map(m => row(m, m.status === 'enviada'
      ? `<button class="op-b good" data-act="signal" data-id="${esc(m.id)}" data-kind="respondeu">RESPONDEU</button>
         <button class="op-b" data-act="signal" data-id="${esc(m.id)}" data-kind="interessado">QUER FALAR</button>
         <button class="op-b" data-act="signal" data-id="${esc(m.id)}" data-kind="ignorou">IGNOROU</button>
         <button class="op-b" data-act="signal" data-id="${esc(m.id)}" data-kind="recusou">RECUSOU</button>`
      : '')).join('')}` : '';
    if (!waiting.length && !rest.length) return `<div class="op-empty">Nenhuma mensagem. Escreve uma a um lead (a partir da conversa de um agente) e ela aparece aqui para aprovares.</div>`;
    return (waiting.length ? `<div class="op-sec">À ESPERA DO TEU OK (${waiting.length})</div>${w}` : '<div class="op-empty">Nada à espera de aprovação.</div>') + r;
  }

  const LEVEL = { pedir_sempre: 'PEDE-ME SEMPRE', proposto: 'PROPOSTO', autonomo: 'ENVIA SOZINHO' };

  function paintAuto() {
    const a = S.auto;
    if (!a) return '<div class="op-empty">a ler…</div>';
    const lim = a.limiar || {};
    const tipos = a.tipos || [];
    const rows = tipos.length ? tipos.map(t => `<div class="op-row">
      <div class="op-main">
        <div class="op-n">${esc(t.scope)} <span class="op-tag ${t.status === 'autonomo' ? 'ok' : ''}">${LEVEL[t.status] || t.status}</span></div>
        <div class="op-m">${t.decididas} casos decididos · ${t.taxaPct === null ? 'sem taxa' : t.taxaPct + '% aprovados'} · ${t.rejeitadas} rejeitadas</div>
        <div class="op-reasons">${esc(t.text)}</div>
      </div>
      <div class="op-side op-acts">
        ${t.status === 'autonomo'
          ? `<button class="op-b" data-act="auto-down" data-scope="${esc(t.scope)}">REVOGAR</button>`
          : `<button class="op-b good" data-act="auto-up" data-scope="${esc(t.scope)}"${t.elegivel ? '' : ' disabled title="preciso de ' + esc(String(lim.minCasos)) + ' casos e ' + esc(String(Math.round((lim.minTaxa || 0.95) * 100))) + '%"'}>DAR AUTONOMIA</button>`}
      </div></div>`).join('') : '<div class="op-empty">Ainda não há tipos de mensagem. Escreve um rascunho e decide alguns casos.</div>';
    return `<div class="op-sec">NÍVEL POR TIPO DE MENSAGEM</div>
      <div class="op-hint" style="margin-bottom:var(--s2)">Sobe-se com ${esc(String(lim.minCasos))} casos decididos e ${esc(String(Math.round((lim.minTaxa || 0.95) * 100)))}% de aprovações; desce-se com um toque, sempre.</div>
      ${rows}
      <div class="op-sec">MODO ENSAIO</div>
      <div class="op-row"><div class="op-main"><div class="op-n">Escrever sem enviar</div>
        <div class="op-m">${S.ensaio?.activo ? `ligado desde ${esc(String(S.ensaio.desde || '').slice(0, 16).replace('T', ' '))} · ${S.ensaio.total} mensagens em ensaio` : 'desligado'}</div>
        <div class="op-reasons">Uma semana a ver o que teria saído, antes de dar autonomia a alguém.</div></div>
        <div class="op-side op-acts"><button class="op-b ${S.ensaio?.activo ? 'good' : ''}" data-act="toggle-trial">${S.ensaio?.activo ? 'DESLIGAR' : 'LIGAR'}</button></div></div>
      <div class="op-sec">AVALIAÇÕES</div>
      <div class="op-row"><div class="op-main"><div class="op-n">Casos fixos do rascunho</div>
        <div class="op-m">${S.evals?.ultimo ? `${S.evals.ultimo.passed}/${S.evals.ultimo.total} · ${esc(S.evals.ultimo.prompt_version)} · ${esc(String(S.evals.ultimo.at).slice(0, 16).replace('T', ' '))}` : 'nunca corriram'}</div>
        <div class="op-reasons">Correm sempre que se mexe no prompt; o resultado fica guardado para se ver a qualidade a descer.</div></div>
        <div class="op-side op-acts"><button class="op-b" data-act="run-evals">CORRER</button></div></div>`;
  }

  function paintSaldo() {
    const b = S.saldo;
    if (!b) return '<div class="op-empty">a ler…</div>';
    const eur = c => (c / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
    const campanhas = (b.porCampanha || []).length
      ? b.porCampanha.map(c => `<tr><td>${esc(c.campanha)}</td><td class="n">${eur(c.cents)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="op-hint">Sem entradas registadas.</td></tr>';
    const custos = (b.custosPorFornecedor || []).length
      ? b.custosPorFornecedor.map(c => `<tr><td>${esc(c.provider)}</td><td class="n">${eur(c.cents)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="op-hint">Sem custos de API neste período.</td></tr>';
    const u = b.unitarios || {};
    return `<div class="op-money">
        <div class="op-money-box good"><b>${eur(b.receitaCentimos)}</b><small>entrou</small></div>
        <div class="op-money-box ${b.custoCentimos ? '' : 'good'}"><b>${eur(b.custoCentimos)}</b><small>gastou</small></div>
        <div class="op-money-box ${b.margemCentimos < 0 ? 'bad' : 'good'}"><b>${eur(b.margemCentimos)}</b><small>margem</small></div>
      </div>
      ${b.semDados?.receita ? `<div class="op-hint" style="margin-bottom:var(--s2)">${esc(b.semDados.receita)}</div>` : ''}
      <div class="op-form" role="group" aria-label="registar entrada">
        <div class="op-form-row">
          <input class="op-in" data-f="euros" placeholder="Valor (€)" aria-label="valor em euros">
          <input class="op-in" data-f="campanha" placeholder="Campanha (ex.: Lisboa · barbearias)" aria-label="campanha">
        </div>
        <div class="op-form-acts"><button class="op-b good" data-act="save-revenue">REGISTAR ENTRADA</button>
          <span class="op-hint">Só entra o que escreveres. Nada é adivinhado.</span></div>
      </div>
      <div class="op-sec">RECEITA POR CAMPANHA</div><table class="op-table"><tbody>${campanhas}</tbody></table>
      <div class="op-sec">CUSTOS DE API (${b.janela?.dias || 90} dias)</div><table class="op-table"><tbody>${custos}</tbody></table>
      <div class="op-sec">POR UNIDADE</div>
      <div class="op-hint">${[
        u.custoPorLead !== null ? `custo por lead: ${eur(u.custoPorLead)}` : '',
        u.custoPorContactado !== null ? `por contactado: ${eur(u.custoPorContactado)}` : '',
        u.custoPorCliente !== null ? `por cliente: ${eur(u.custoPorCliente)}` : '',
        u.receitaPorCliente !== null ? `receita por cliente: ${eur(u.receitaPorCliente)}` : '',
      ].filter(Boolean).join(' · ') || 'sem dados suficientes para custos unitários'}</div>`;
  }

  function paintQueue() {
    const q = S.queue || {};
    const L = S.learning;
    const learning = L && L.totalSinais
      ? `<div class="op-sec">O QUE APRENDI COM AS RESPOSTAS</div>
         <div class="op-learn">${L.aprendido.length
           ? L.aprendido.map(x => `<span class="op-tag ${/\+/.test(x) ? 'ok' : 'bad'}">${esc(x)}</span>`).join('')
           : `<span class="op-hint">Ainda não há sinais suficientes. ${L.aEsperar.length ? 'A esperar: ' + esc(L.aEsperar.join(' · ')) : ''}</span>`}
         </div>`
      : `<div class="op-sec">O QUE APRENDI COM AS RESPOSTAS</div><div class="op-hint">Ainda não há respostas registadas. Quando marcarem «respondeu» ou «ignorou» numa mensagem, a pontuação dos leads parecidos ajusta-se — com a razão escrita.</div>`;
    const box = ['fila', 'feito', 'falhou', 'a_correr'].map(k => `<div class="op-stat"><b>${q[k] || 0}</b><small>${k.replace('_', ' ')}</small></div>`).join('');
    const ev = S.events.map(e => `<div class="op-ev"><span class="op-evt">${hhmm(e.at)}</span> <b>${esc(e.action)}</b> <span class="op-m">${esc(e.actor)}${e.entity_id ? ' · ' + esc(String(e.entity_id).slice(0, 14)) : ''}</span></div>`).join('');
    return `<div class="op-stats">${box}</div>${learning}
      <div class="op-sec">O QUE ACONTECEU (auditoria)</div>${ev || '<div class="op-empty">Sem eventos ainda.</div>'}`;
  }

  function paint() {
    paintSummary();
    P.note.textContent = S.error || '';
    P.note.classList.toggle('bad', !!S.error);
    P.body.innerHTML = S.error ? `<div class="op-empty bad">${esc(S.error)}</div>`
      : S.tab === 'leads' ? paintLeads() + (S.novos ? newClientForm() : '')
        : S.tab === 'messages' ? paintMessages()
          : S.tab === 'auto' ? paintAuto()
            : S.tab === 'saldo' ? paintSaldo()
              : paintQueue();
  }

  function tab(k) { S.tab = k; for (const t of P.tabs) t.classList.toggle('on', t.dataset.k === k); paint(); }

  // ---- ações ----
  async function act(a, id, extra) {
    if (S.busy) return;
    S.busy = true; P.note.classList.remove('bad');
    try {
      if (a === 'approve') { const r = await post(`/ops/messages/${id}/approve`); if (r.error) throw new Error(r.error); P.note.textContent = r.message?.status === 'bloqueada' ? 'bloqueada: ' + r.message.reason : 'aprovada — o envio continua a ser teu.'; }
      if (a === 'reject') { const r = await post(`/ops/messages/${id}/reject`, { reason: 'rejeitada na gaveta' }); if (r.error) throw new Error(r.error); P.note.textContent = 'rejeitada.'; }
      if (a === 'send') {
        const r = await post(`/ops/messages/${id}/send`);
        if (r.error) throw new Error(r.error);
        if (r.manual && r.url) { window.open(r.url, '_blank', 'noopener'); P.note.textContent = 'link aberto — depois confirma aqui que enviaste.'; }
        else if (r.delivered) P.note.textContent = 'enviada.';
        else P.note.textContent = r.reason || 'não saiu.';
      }
      if (a === 'confirm') { const r = await post(`/ops/messages/${id}/confirm`); if (r.error) throw new Error(r.error); P.note.textContent = 'confirmada como enviada.'; }
      if (a === 'auto-up' || a === 'auto-down') {
        const scope = btnScope(b);
        const r = await post(`/ops/autonomia/${encodeURIComponent(scope)}/${a === 'auto-up' ? 'subir' : 'descer'}`, { reason: 'decisão na gaveta' });
        if (r.error) throw new Error(r.error);
        P.note.textContent = a === 'auto-up' ? 'este tipo passa a enviar sozinho. Os travões continuam.' : 'revogado: volta a pedir-te autorização.';
      }
      if (a === 'toggle-trial') {
        const r = await post('/ops/ensaio', { activo: !S.ensaio?.activo });
        if (r.error) throw new Error(r.error);
        P.note.textContent = r.activo ? 'ensaio ligado: escrevo tudo, não sai nada.' : 'ensaio desligado.';
      }
      if (a === 'run-evals') {
        P.note.textContent = 'a correr os casos…';
        const r = await post('/ops/evals/correr');
        if (r.error) throw new Error(r.error);
        P.note.textContent = `${r.passou}/${r.total} casos · ${r.aviso || 'sem regressão'}`;
        P.note.classList.toggle('bad', !!r.falhou);
      }
      if (a === 'save-revenue') {
        const f = P.body.querySelector('.op-form');
        const val = k => String(f?.querySelector(`[data-f="${k}"]`)?.value || '').trim();
        if (!val('euros')) throw new Error('diz o valor');
        const r = await post('/ops/receita', { euros: Number(val('euros').replace(',', '.')), campaign: val('campanha') });
        if (r.error) throw new Error(r.error);
        P.note.textContent = 'entrada registada.';
      }
      if (a === 'save-client') {
        const f = P.body.querySelector('.op-form');
        const val = k => String(f?.querySelector(`[data-f="${k}"]`)?.value || '').trim();
        if (!val('nome')) throw new Error('o cliente precisa de um nome');
        const r = await post('/ops/clientes', {
          nome: val('nome'), nicho: val('nicho'), cidade: val('cidade'),
          oferta: { preco_eur: Number(val('preco') || 350), prazo_dias: Number(val('prazo') || 7) },
        });
        if (r.error) throw new Error(r.error);
        S.novos = false;
        P.note.textContent = `espaço «${val('nome')}» criado. Próximo passo: procurar leads.`;
      }
      if (a === 'signal') {
        if (!extra) throw new Error('sinal sem tipo');
        const r = await post(`/ops/messages/${id}/sinal`, { kind: extra, note: '' });
        if (r.error) throw new Error(r.error);
        P.note.textContent = `registado: ${r.signal.kind}. A nota dos leads parecidos ajustou-se.`;
      }
      if (a === 'save-lead') {
        const f = P.body.querySelector('.op-form');
        if (!f) return;
        const val = k => String(f.querySelector(`[data-f="${k}"]`)?.value || '').trim();
        if (!val('name')) throw new Error('o lead precisa de um nome');
        const r = await post('/ops/leads', { leads: [{ name: val('name'), city: val('city'), phone: val('phone'), email: val('email'), website: val('website'), source: 'manual' }] });
        if (r.error) throw new Error(r.error);
        S.adding = false;
        P.note.textContent = r.created ? 'lead guardado e pontuado.' : 'já existia — atualizei os dados.';
      }
      if (a === 'research') {
        P.note.textContent = 'a ler o site…';
        const r = await post(`/ops/leads/${id}/pesquisar`);
        if (r.error) throw new Error(r.error);
        S.dossier[id] = r;
        P.note.textContent = r.research?.status === 'ok' ? `li ${r.evidence.length} factos no site.` : (r.research?.reason || 'sem site.');
        return paint();
      }
      if (a === 'close-dossier') { delete S.dossier[id]; return paint(); }
      if (a === 'draft') {
        P.note.textContent = 'a escrever com o que li…';
        const r = await post(`/ops/leads/${id}/rascunho`, {});
        if (r.error) throw new Error(r.error);
        S.dossier[id] = null;
        P.note.textContent = `rascunho ${r.generatedBy === 'ia' ? 'pelo motor' : 'pelo modelo local'} — está à tua espera em Hoje.`;
      }
      if (a === 'save-msg') {
        const f = P.body.querySelector('.op-form');
        if (!f) return;
        const val = k => String(f.querySelector(`[data-f="${k}"]`)?.value || '').trim();
        if (!val('body')) throw new Error('a mensagem está vazia');
        const r = await post('/ops/messages', { leadId: id, channel: val('channel') || 'whatsapp', subject: val('subject'), body: val('body') });
        if (r.error) throw new Error(r.error);
        S.composing = null;
        P.note.textContent = 'rascunho guardado — está à tua espera em Hoje.';
      }
    } catch (e) { P.note.textContent = e.message; P.note.classList.add('bad'); }
    finally { S.busy = false; await load(); }
  }

  P.body.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) {
      const a = b.dataset.act;
      if (a === 'new-client') { S.novos = !S.novos; S.tab = 'leads'; for (const t of P.tabs) t.classList.toggle('on', t.dataset.k === 'leads'); return paint(); }
      if (a === 'cancel-client') { S.novos = false; return paint(); }
      if (a === 'auto-up' || a === 'auto-down' || a === 'toggle-trial' || a === 'run-evals' || a === 'save-revenue' || a === 'save-client') return act(a, null, null);
      if (a === 'new-lead') { S.adding = true; S.composing = null; return paint(); }
      if (a === 'cancel-lead') { S.adding = false; return paint(); }
      if (a === 'compose') { S.composing = S.composing === b.dataset.id ? null : b.dataset.id; S.adding = false; return paint(); }
      if (a === 'cancel-msg') { S.composing = null; return paint(); }
      return act(a, b.dataset.id, b.dataset.kind || b.dataset.ch);
    }
    const c = e.target.closest('button[data-confirm]');
    if (c) act('confirm', c.dataset.confirm);
  });
  P.body.addEventListener('change', async e => {
    const sel = e.target.closest('.op-stage');
    if (!sel) return;
    const r = await fetch(`${api}/ops/leads/${sel.dataset.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: sel.value }) });
    const j = await r.json().catch(() => ({}));
    if (j.error) { P.note.textContent = j.error; P.note.classList.add('bad'); } else { P.note.textContent = `«${j.lead?.name}» → ${STATUS_PT[j.lead?.status] || j.lead?.status}`; P.note.classList.remove('bad'); }
    await load();
  });

  const btnScope = (b) => b.dataset.scope || '';
  if (P.newClient) P.newClient.addEventListener('click', () => {
    S.novos = !S.novos; S.tab = 'leads';
    for (const t of P.tabs) t.classList.toggle('on', t.dataset.k === 'leads');
    paint();
  });
  if (P.client) P.client.addEventListener('change', async () => {
    const id = P.client.value;
    if (!id) return;
    P.note.textContent = 'a abrir o espaço…';
    const r = await post(`/ops/clientes/${encodeURIComponent(id)}/entrar`);
    if (r.error) { P.note.textContent = r.error; P.note.classList.add('bad'); return; }
    P.note.textContent = `agora em «${r.cliente.nome}». Cada cliente tem a sua base de dados.`;
    await load();
  });
  btn.addEventListener('click', toggle);
  P.close.addEventListener('click', close);
  P.refresh.addEventListener('click', () => load({ forcar: true }));
  for (const t of P.tabs) t.addEventListener('click', () => tab(t.dataset.k));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
  /* 12 s: rápido o bastante para se sentir «ao vivo», discreto o bastante para não pesar.
     `unref` só existe no Node: nos testes o sinal não fica a segurar o processo aberto. */
  const relogios = [
    setInterval(() => { if (!panel.hidden) load(); }, 12000),
    setInterval(() => { if (!panel.hidden) tickVivo(); }, 1000),
  ];
  for (const r of relogios) { if (r && typeof r.unref === 'function') r.unref(); }

  /* `parar` existe para quem monta e desmonta a gaveta (testes, e uma página que a destrua) */
  const parar = () => { for (const r of relogios) clearInterval(r); };
  return { open, close, reload: load, parar };
}
