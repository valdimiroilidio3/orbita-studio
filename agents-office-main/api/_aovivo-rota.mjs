/* ===========================================================================
   1.77.0 · `/api/ops/aovivo` e `/api/ops/aovivo/stream` NA VERCEL

   O escritório 3D dizia, por cima da cena:

     A ligação ao vivo não está de pé (stale). O que está acima pode estar
     desactualizado.

   A frase era verdadeira e a culpa era nossa: os dois caminhos ao vivo viviam
   **só** no `serve.mjs`, o servidor local. Em produção o `EventSource` batia num
   404, o `refresh()` batia noutro 404, e o ecrã ficava «desactualizado» para
   sempre — com um ciclo de reconexões a martelar a função.

   Esta é a mesma verdade, lida da base de dados do Supabase:

     GET /api/ops/aovivo                  → o retrato em JSON (o que o painel lê)
     GET /api/ops/aovivo/stream           → text/event-stream (hello/update/ping)
     GET /api/ops/aovivo?fluxo=stream     → o mesmo fluxo (é o que a reescrita
                                            do `vercel.json` entrega aqui)

   Sem sessão não há retrato: 401 e o cliente sabe que tem de entrar. Não há
   dados inventados — `api/_aovivo.mjs` só traduz o que está escrito nas tarefas
   e na atividade.

   O fluxo é CURTO de propósito (fecha em ~25 s e o `EventSource` religa): uma
   função na Vercel tem um tecto de duração, e um fluxo que promete durar para
   sempre é a mentira seguinte. Entre ligações, o cliente faz uma leitura a cada
   poucos segundos — é a mesma base, com a mesma frescura declarada.
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { lerSessao } from './_porta.mjs';
import { retratoDaBase } from './_aovivo.mjs';

/* 30 s: o fluxo fecha-se sozinho antes disto (ver `DURACAO_MS`) */
export const config = { maxDuration: 30 };

const DURACAO_MS = 25000;     // quanto tempo uma ligação SSE vive
const PASSO_MS = 4000;        // de quanto em quanto se volta a ler a base
const PING_MS = 10000;        // um sinal de vida mesmo quando nada muda

const lerAgentes = (url) => {
  const bruto = url.searchParams.get('agentes') || '';
  return [...new Set(String(bruto).split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9_-]{1,32}$/i.test(s)))].slice(0, 40);
};

/* a impressão digital que decide «mudou» — sem horas relativas, para não haver
   um evento por segundo */
const digital = (r) => JSON.stringify([
  Object.entries(r.agents || {}).map(([id, a]) => [id, a.state, a.task?.id || '', a.task?.state || '', a.last?.id || '', a.last?.state || '']),
  r.abertas.map((t) => [t.id, t.state]),
]);

/**
 * O tratamento, com a base e o ambiente injectáveis: é assim que o teste prova o
 * `hello` do fluxo sem rede. O `handler` por omissão lê-os do ambiente.
 */
export async function servirAoVivo(req, res, { repo: repoDado = null, env: envDado = null } = {}) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'só GET' });
    return;
  }

  const url = new URL(String(req.url || '/'), 'http://local');
  /* a reescrita do `vercel.json` entrega `?aovivo=stream`; o `serve.mjs` local
     serve `/api/ops/aovivo/stream` directamente — os dois caminhos valem */
  const fluxo = url.searchParams.get('aovivo') === 'stream'
    || url.searchParams.get('fluxo') === 'stream'
    || /\/stream\/?$/.test(url.pathname);
  const agentes = lerAgentes(url);

  const env = envDado || envBase();
  if (!repoDado && !env.pronto) {
    res.status(503).json({ modo: 'local', erro: 'esta instalação não tem base de dados ligada (faltam SUPABASE_URL e SUPABASE_SECRET_KEY)' });
    return;
  }

  let repo = repoDado;
  if (!repo) {
    try { repo = createSupabaseRepo(env); } catch (e) { res.status(503).json({ modo: 'local', erro: String(e.message || e) }); return; }
  }

  /* sem sessão, o escritório não mostra trabalho nenhum a estranhos — mas diz
     PORQUE, para o painel poder pedir a entrada em vez de «sem ligação» */
  const quem = await lerSessao(repo, req.headers);
  if (!quem) {
    res.status(401).json({ error: 'entra', modo: 'sessao', hint: 'o retrato ao vivo só se lê com sessão válida' });
    return;
  }

  if (!fluxo) {
    const r = await retratoDaBase(repo, { agentes });
    res.status(200).json({ ...r, leitor: quem.conta?.email ? 'sessão' : 'sessão' });
    return;
  }

  /* ---- o fluxo ---- */
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let vivo = true;
  let timer = null;
  let pings = null;
  const escrever = (texto) => { if (!vivo) return; try { res.write(texto); } catch { vivo = false; } };
  const evento = (nome, dados) => escrever(`event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`);

  const fechar = (porque = 'fim') => {
    if (!vivo) return;
    vivo = false;
    if (timer) clearTimeout(timer);
    if (pings) clearInterval(pings);
    evento('fim', { porque, at: new Date().toISOString() });
    try { res.end(); } catch { /* já fechado do outro lado */ }
  };
  req.on && req.on('close', () => { vivo = false; if (timer) clearTimeout(timer); if (pings) clearInterval(pings); });

  /* O `retry` é o intervalo que o browser espera antes de religar. 4 s é o
     suficiente para o fluxo voltar depressa sem transformar isto numa
     tempestade de pedidos. */
  escrever('retry: 4000\n\n');

  let ultimo = '';
  let comeca = Date.now();

  const passo = async () => {
    if (!vivo) return;
    try {
      const r = await retratoDaBase(repo, { agentes });
      const d = digital(r);
      const primeira = ultimo === '';
      if (primeira) evento('hello', r);
      else if (d !== ultimo) evento('update', r);
      else evento('ping', { at: new Date().toISOString() });
      ultimo = d;
    } catch (e) {
      evento('erro', { erro: String(e.message || e).slice(0, 160), at: new Date().toISOString() });
    }
    if (Date.now() - comeca >= DURACAO_MS) { fechar('fim-do-turno'); return; }
    timer = setTimeout(passo, PASSO_MS);
    /* não segura o processo: um fluxo esquecido não pode prender o servidor (nem
       os testes) depois de a ligação morrer */
    if (timer.unref) timer.unref();
  };

  /* um sinal de vida mais espaçado, para um proxy não cortar a ligação calada */
  pings = setInterval(() => escrever(`: vivo ${Date.now()}\n\n`), PING_MS);
  if (pings.unref) pings.unref();

  await passo();
}

export default async function handler(req, res) {
  return servirAoVivo(req, res);
}
