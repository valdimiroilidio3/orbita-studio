// Órbita — a gaveta LEADS (25 out 2026).
//
// A pesquisa real da Google, à mão do proprietário: escrever «clínicas dentárias» e «Lisboa» e
// receber negócios verdadeiros — nome, morada, telefone, site, avaliação — com uma nota de
// oportunidade explicada (sem site pesa muito). O que aparece fica guardado no servidor
// (`data/leads.json`, sem duplicados) e é isso que a Prospeção e as Vendas leem em cada tarefa.
//
// Estado honesto: sem chave da Google, a gaveta diz exatamente qual variável de ambiente falta —
// não finge que procurou.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function initLeads({ api = '/api', onTask = null } = {}) {
  const btn = document.getElementById('topLeads');
  const panel = document.getElementById('leadsPanel');
  if (!btn || !panel) return null;

  const P = {
    what: panel.querySelector('.ld-what'), where: panel.querySelector('.ld-where'), go: panel.querySelector('.go'),
    list: panel.querySelector('.ld-list'), hint: panel.querySelector('.ld-row2 .hint'), cnt: panel.querySelector('.ld-h .cnt'),
    close: panel.querySelector('.ld-close'), refresh: panel.querySelector('.ld-refresh'), task: panel.querySelector('.ld-task'),
    segs: [...panel.querySelectorAll('.ld-seg .ld-m')],
  };
  const S = { state: null, results: [], busy: false, saved: 0, mode: 'places' };

  const open = () => { panel.hidden = false; btn.classList.add('on'); setMode(S.mode); load(true); P.what.focus(); };
  const close = () => { panel.hidden = true; btn.classList.remove('on'); };
  const toggle = () => (panel.hidden ? open() : close());

  const scoreTag = l => (l.website ? '' : '<span class="ld-tag hot">sem site</span>')
    + (l.phone ? '<span class="ld-tag ok">telefone</span>' : '')
    + (l.rating ? `<span class="ld-tag">${l.rating}★${l.reviews ? ' · ' + l.reviews : ''}</span>` : '');

  function leadHTML(l) {
    const site = l.website ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">${esc(String(l.website).replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>` : 'sem site';
    const maps = l.mapsUrl ? ` · <a href="${esc(l.mapsUrl)}" target="_blank" rel="noopener">mapa</a>` : '';
    return `<div class="ld-lead">
      <div><div class="ld-n">${esc(l.name)}</div>
      <div class="ld-m">${esc(l.city || l.address || '')}${l.phone ? ' · ' + esc(l.phone) : ''} · ${site}${maps}</div>
      <div class="ld-tags">${scoreTag(l)}<span class="ld-tag" title="${esc(l.why || '')}">${esc(l.why || '')}</span></div></div>
      <div class="ld-score">${l.score ?? '—'}<small>NOTA</small></div></div>`;
  }

  function webHTML(r) {
    const host = String(r.website || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    return `<div class="ld-web">
      <div class="ld-n"><a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(r.name || r.website)}</a></div>
      <div class="ld-m">${esc(host)}${r.type ? ' · ' + esc(r.type) : ''}</div>
      ${r.snippet ? `<div class="ld-m">${esc(r.snippet)}</div>` : ''}</div>`;
  }

  function paintHint() {
    const g = S.state;
    if (!g) { P.hint.textContent = 'a ler o estado da Google…'; P.hint.classList.remove('bad'); return; }
    const bits = [];
    if (!g.any) {
      P.hint.classList.add('bad');
      P.hint.innerHTML = `Sem chave da Google. <b>Places:</b> ${esc(g.places.reason)}. <b>Web:</b> ${esc(g.web.reason)}.`;
    } else {
      P.hint.classList.remove('bad');
      const web = S.mode === 'web';
      bits.push(web ? (g.web.available ? 'pesquisa web ligada' : 'pesquisa web sem chave') : (g.places.available ? 'Places ligado' : 'Places sem chave'));
      bits.push(web ? 'resultados da web: informação e contexto' : `${g.leads?.total || 0} leads guardados · ${g.leads?.noSite || 0} sem site`);
      P.hint.textContent = bits.join(' · ');
    }
    P.go.disabled = S.busy || !(S.mode === 'web' ? S.state?.web?.available : S.state?.places?.available);
  }

  function paintList() {
    P.cnt.textContent = S.state ? `${S.state.stats?.total || 0} GUARDADOS` : '—';
    const rows = S.results.length ? S.results : (S.state?.list || []);
    if (!rows.length) {
      const falta = S.mode === 'web' ? S.state?.web : S.state?.places;
      P.list.innerHTML = `<div class="ld-empty">${falta?.available
        ? (S.mode === 'web' ? 'Escreve o que queres saber e prime <b>PROCURAR</b> — devolvo resultados da web.' : 'Ainda não há leads. Escreve o que queres encontrar e prime <b>PROCURAR</b>.')
        : `Para procurar preciso de uma chave da Google.<br><b>1.</b> Cria uma chave em console.cloud.google.com e liga a <b>Places API (New)</b> (empresas) e/ou a <b>Custom Search API</b> (web).<br><b>2.</b> Põe <b>GOOGLE_MAPS_API_KEY</b> (e, para web, <b>GOOGLE_API_KEY</b> + <b>GOOGLE_CSE_ID</b>) no ambiente e reinicia o escritório.`}</div>`;
      return;
    }
    P.list.innerHTML = rows.map(S.mode === 'web' ? webHTML : leadHTML).join('');
  }

  async function load(alsoLeads = false) {
    try {
      const [g, l] = await Promise.all([
        fetch(`${api}/google`).then(r => r.json()),
        alsoLeads ? fetch(`${api}/leads?limit=30`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
      ]);
      S.state = { ...g, list: l?.leads || S.state?.list || [] };
      paintHint(); paintList();
    } catch (e) {
      P.hint.textContent = `não consegui falar com o servidor: ${e.message}`;
      P.hint.classList.add('bad');
    }
  }

  async function search() {
    const what = P.what.value.trim(), where = P.where.value.trim();
    if (!what) { P.hint.classList.add('bad'); P.hint.textContent = 'diz o que procurar — por exemplo «clínicas dentárias».'; P.what.focus(); return; }
    S.busy = true; P.go.disabled = true; P.go.textContent = 'A PROCURAR…';
    P.hint.classList.remove('bad');
    const web = S.mode === 'web';
    P.hint.textContent = web ? `a procurar «${[what, where].filter(Boolean).join(' ')}» na web…` : `a procurar «${what}${where ? ' em ' + where : ''}» na Google Places…`;
    try {
      const r = await fetch(`${api}/google/search`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(web
          ? { kind: 'web', q: [what, where].filter(Boolean).join(' '), limit: 10 }
          : { kind: 'places', what, where, limit: 20 }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `o servidor respondeu ${r.status}`);
      S.results = j.results || [];
      S.saved = j.added || 0;
      if (web) P.hint.innerHTML = `${j.found} resultados em ${(j.ms / 1000).toFixed(1)} s · nada disto é guardado como lead`;
      else P.hint.innerHTML = `${j.found} negócios encontrados em ${(j.ms / 1000).toFixed(1)} s · <b>+${j.added} novos</b> guardados (${j.total} na lista) · ${j.updated} já existiam`;
      if (!web) await load(true);
      P.list.innerHTML = S.results.length ? S.results.map(web ? webHTML : leadHTML).join('')
        : `<div class="ld-empty">${web ? 'A pesquisa não devolveu nada para esse pedido. Tenta outras palavras.' : 'A Google não devolveu negócios para esse pedido. Tenta uma atividade e um sítio mais concretos.'}</div>`;
    } catch (e) {
      P.hint.classList.add('bad');
      P.hint.textContent = e.message;
    } finally {
      S.busy = false; P.go.textContent = 'PROCURAR'; paintHint();
    }
  }

  function setMode(k) {
    S.mode = k === 'web' ? 'web' : 'places';
    S.results = [];
    for (const b of P.segs) b.classList.toggle('on', b.dataset.k === S.mode);
    P.what.placeholder = S.mode === 'web' ? 'quem lidera o mercado de clínicas em Lisboa' : 'clínicas dentárias';
    P.where.placeholder = S.mode === 'web' ? '(opcional)' : 'Lisboa';
    P.task.hidden = S.mode === 'web'; // nada de tarefas de abordagem a partir de resultados da web
    paintHint(); paintList();
  }
  for (const b of P.segs) b.addEventListener('click', () => setMode(b.dataset.k));

  btn.addEventListener('click', toggle);
  P.close.addEventListener('click', close);
  P.refresh.addEventListener('click', () => { S.results = []; load(true); });
  P.go.addEventListener('click', search);
  P.what.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  P.where.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  P.task.addEventListener('click', () => {
    const top = (S.results.length ? S.results : (S.state?.list || [])).slice(0, 6);
    if (!top.length) { P.hint.classList.add('bad'); P.hint.textContent = 'procura primeiro — depois disto escrevo a tarefa.'; return; }
    const text = `Abordar estes ${top.length} negócios reais, um a um, com uma mensagem própria (sem site = proposta de site, com site = melhoria): `
      + top.map(l => `${l.name}${l.city ? ' (' + l.city + ')' : ''}`).join('; ')
      + '. Escreve o email de cada um, o assunto e a razão de os escolher.';
    if (onTask) onTask(text); else {
      const box = document.querySelector('.tp-in');
      if (box) { box.value = text; box.focus(); box.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) close();
    if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !/input|textarea|select/i.test(e.target.tagName)) toggle();
  });

  // o botão nasce apagado quando não há chave nenhuma — a gaveta explica o resto
  fetch(`${api}/google`).then(r => r.json()).then(g => { btn.classList.toggle('off', !g.any); }).catch(() => {});
  return { open, close, toggle };
}
