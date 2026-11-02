/* ===========================================================================
   1.54.3 · GERAR MÍDIA A SÉRIO — os testes

   O que aqui se prova, e que é o pedido do dono:

     · uma geração fica ligada à lead, ao projeto, a quem a pediu e ao prompt
       QUE FOI ENVIADO (não ao prompt que estava no ecrã);
     · nada é gerado sem confirmação explícita e sem passar os limites;
     · a estimativa diz o que se sabe (grátis = 0) e admite o que não se sabe
       («custo desconhecido»), em vez de inventar um número;
     · dois cliques com a mesma chave não geram (nem cobram) duas vezes;
     · o estado atravessa a base: aguardando → em_processamento → concluida,
       e uma falha transitória tem nova tentativa limitada;
     · a falha diz o motivo e permite repetir, avisando que pode custar;
     · cancelar só funciona antes de o pedido sair daqui — e diz-se porquê;
     · o vídeo compõe-se no browser e o ficheiro é verificado ao voltar;
     · os bytes ficam no armazém e só saem com sessão;
     · um leitor não gera (o servidor recusa, não é esconder o botão).

   Nenhum teste fala com o fornecedor: o `fetchImpl` é falso e os bytes são
   inventados de propósito. Zero cobranças, zero rede.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';
import { limitador } from './api/_porta.mjs';
import { COOKIE } from './api/_conta.mjs';
import * as MD from './api/_media.mjs';
import * as F from './api/_media/fornecedores.mjs';
import { limparMemoria, criarArmazem } from './api/_armazem.mjs';
import handlerFicheiro from './api/ficheiro.mjs';
import { estadoNovo, vistaMedia, accaoMedia, podeConfirmar, textoDaEstimativa } from './src/media.js';

const ENV = { SETUP_TOKEN: 'token-de-instalacao-para-teste' };
const SENHA = 'uma-frase-bem-comprida-2026';
const PROMPT = 'interior de clínica dentária ao amanhecer, luz de janela, sem texto na imagem';

/* ---------- a rede falsa: nada sai daqui ---------- */
const IMAGEM = Buffer.alloc(4096, 7);
const fetchImagem = async () => ({
  ok: true, status: 200,
  headers: { get: () => 'image/jpeg' },
  arrayBuffer: async () => IMAGEM,
  text: async () => '',
});
const fetchRecusa = async () => ({
  ok: false, status: 402,
  headers: { get: () => 'application/json' },
  text: async () => '{"error":"insufficient credits"}',
  arrayBuffer: async () => Buffer.alloc(0),
});
const fetchCai = async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); };
const semRede = () => { throw new Error('sem rede neste teste'); };

const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: ENV, fetchImpl: semRede, ...extra,
});
const comEnv = (repo, caminho, metodo, corpo, env, extra = {}) => responder(repo, {
  caminho, metodo, corpo, env: { ...ENV, ...env }, fetchImpl: semRede, ...extra,
});

const comCookie = (token) => ({ headers: { cookie: `${COOKIE}=${encodeURIComponent(token)}` } });

const CLINICA = { name: 'Clínica do Mondego', category: 'Clínica dentária', city: 'Coimbra', website: 'clinicadomondego.pt' };
const OFICINA = { name: 'Oficina Alves', category: 'Oficina automóvel', city: 'Leiria' };

async function leadComProjeto(repo, dados = CLINICA) {
  await chamar(repo, '/ops/leads', 'POST', { leads: [dados] });
  const lead = repo._dados.leads[repo._dados.leads.length - 1];
  const r = await chamar(repo, `/ops/leads/${lead.id}/projeto`, 'POST', { kind: 'landing' });
  return { lead, projeto: r.corpo.projeto };
}

const pedirImagem = (repo, projetoId, corpo = {}, extra = {}) => chamar(
  repo, `/ops/projetos/${projetoId}/media`, 'POST',
  { tipo: 'imagem', prompt: PROMPT, confirmado: true, ...corpo }, extra,
);

/* ------------------------------------------------------------------ fornecedor */

test('mídia: só se mostram as opções que o fornecedor tem (e os preços dizem-se grátis)', () => {
  const op = F.opcoesPublicas();
  /* o compositor grava 1280×720: só existe 16:9. Não se anuncia o que não há. */
  assert.deepEqual(op.video.formatos.map((f) => f.id), ['16:9']);
  assert.deepEqual(op.video.duracoes.map((d) => d.id), [4, 6, 8, 10]);
  assert.ok(op.imagem.formatos.length >= 4);
  assert.ok(op.imagem.resolucoes.some((r) => r.id === '1344'));

  /* a proporção vira pixels de verdade, e múltiplos de 64 */
  const d = F.dimensoes('16:9', '1024');
  assert.equal(d.largura % 64, 0);
  assert.equal(d.altura % 64, 0);
  assert.ok(d.largura > d.altura);

  /* o preço dos dois fornecedores gratuitos é zero — e sabe-se */
  const img = MD.estimar({ tipo: 'imagem', opcoes: { largura: 1024, altura: 1024 } }, ENV);
  assert.equal(img.valor, 0);
  assert.equal(img.confiavel, true);
  assert.match(img.rotulo, /gratuito/);
  const vid = MD.estimar({ tipo: 'video', opcoes: { duracao: 8 } }, ENV);
  assert.equal(vid.valor, 0);
});

test('mídia: o que não tem preço configurado é «custo desconhecido», não um número inventado', () => {
  const semTabela = MD.estimar({ tipo: 'video', fornecedor: 'fal-ai', opcoes: { duracao: 5 } }, ENV);
  assert.equal(semTabela.valor, null);
  assert.equal(semTabela.confiavel, false);
  assert.match(semTabela.rotulo, /desconhecido/);
  assert.match(semTabela.nota, /ORBITA_PRECOS_MEDIA/);

  /* com uma tabela configurada, a conta faz-se e os factores aparecem */
  const env = { ORBITA_PRECOS_MEDIA: JSON.stringify({ 'fal-ai': { video: { moeda: 'USD', base: 0.1, porSegundo: 0.05 } } }) };
  const comTabela = MD.estimar({ tipo: 'video', fornecedor: 'fal-ai', opcoes: { duracao: 6 } }, env);
  assert.equal(comTabela.valor, 0.4);
  assert.equal(comTabela.confiavel, true);
  assert.ok(comTabela.factores.some((f) => /6 s/.test(f)));
});

/* ------------------------------------------------------------------ confirmação */

test('mídia: sem confirmação explícita não se gera nada (e nada chega ao fornecedor)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const r = await pedirImagem(repo, projeto.id, { confirmado: false }, { fetchImpl: fetchImagem });
  assert.equal(r.status, 409);
  assert.match(r.corpo.error, /confirma/);
  assert.equal(repo._dados.geracoes.length, 0, 'não pode ter ficado um trabalho criado');

  /* a estimativa existe antes de confirmar, e é ela que autoriza o passo */
  const est = await chamar(repo, `/ops/projetos/${projeto.id}/media/estimativa`, 'POST', { tipo: 'imagem', formato: '4:5' });
  assert.equal(est.status, 200);
  assert.equal(est.corpo.custo.valor, 0);
  assert.equal(est.corpo.confirmar.obrigatoria, true);
  assert.ok(est.corpo.opcoes.largura > 0 && est.corpo.opcoes.altura > est.corpo.opcoes.largura);
});

test('mídia: parâmetros inválidos são recusados com o motivo, não corrigidos em silêncio', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const curto = await pedirImagem(repo, projeto.id, { prompt: 'oi' });
  assert.equal(curto.status, 400);
  assert.match(curto.corpo.error, /curto/);

  const tipoErrado = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'POST', { tipo: 'audio', prompt: PROMPT, confirmado: true });
  assert.equal(tipoErrado.status, 400);

  /* «9:16» é um formato de imagem e de outros fornecedores: neste compositor
     não existe, e diz-se em vez de gravar outra coisa em silêncio */
  const formatoErrado = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'POST', {
    tipo: 'video', prompt: PROMPT, confirmado: true, formato: '9:16',
  });
  assert.equal(formatoErrado.status, 400);
  assert.match(formatoErrado.corpo.error, /9:16/);

  await assert.rejects(() => pedirImagem(repo, 'p_nao_existe'), (e) => e.status === 404);
});

/* ------------------------------------------------------------------ o fluxo */

test('mídia: o pedido nasce «à espera», liga-se à lead/projeto/quem pediu e o prompt guardado é o enviado', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { lead, projeto } = await leadComProjeto(repo);

  const r = await pedirImagem(repo, projeto.id, { chave: 'k-1', prompt: `${PROMPT} (confirmado pelo dono)` }, { fetchImpl: fetchImagem });
  assert.equal(r.status, 202, JSON.stringify(r.corpo));
  assert.equal(r.corpo.geracao.estado, 'aguardando');
  assert.equal(r.corpo.geracao.prompt, `${PROMPT} (confirmado pelo dono)`);
  assert.equal(r.corpo.geracao.leadId, lead.id);
  assert.equal(r.corpo.geracao.projetoId, projeto.id);
  assert.equal(r.corpo.geracao.fornecedor, 'pollinations');
  assert.equal(r.corpo.geracao.classificacao, 'conceito', 'mídia de IA nasce como conceito');

  const g = repo._dados.geracoes[0];
  assert.equal(g.conta_id, 'mesa', 'sem contas, o responsável é a mesa — e fica escrito');
  assert.equal(g.custo_estimado, 0);
  assert.equal(g.custo_real, null, 'o custo real não se inventa');
  assert.ok(g.opcoes.largura > 0);
});

test('mídia: dois cliques com a mesma chave devolvem o MESMO trabalho (nada de cobrar duas vezes)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const a = await pedirImagem(repo, projeto.id, { chave: 'mesmo-pedido' });
  const b = await pedirImagem(repo, projeto.id, { chave: 'mesmo-pedido' });
  assert.equal(a.status, 202);
  assert.equal(b.corpo.repetido, true);
  assert.equal(b.corpo.geracao.id, a.corpo.geracao.id);
  assert.equal(repo._dados.geracoes.length, 1);
});

test('mídia: gerar, guardar no armazém e voltar a ler o estado depois de «actualizar a página»', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const criada = await pedirImagem(repo, projeto.id, { chave: 'gerar-1' });
  const id = criada.corpo.geracao.id;

  /* o avanço faz-se no servidor; a mesa só consulta (e a página pôde ser fechada) */
  const g = await repo.geracoes.porId(id);
  const depois = await MD.avancar(repo, g, { env: ENV, fetchImpl: fetchImagem });
  assert.equal(depois.estado, 'concluida');
  assert.match(depois.ficheiro.mime, /^image\//);
  assert.equal(depois.ficheiro.armazem, 'memoria');
  assert.ok(depois.ficheiro.bytes > 2000);

  /* um pedido novo (outra «visita») lê o estado da base, não da memória do browser */
  const lido = await chamar(repo, `/ops/media/${id}`);
  assert.equal(lido.status, 200);
  assert.equal(lido.corpo.geracao.estado, 'concluida');
  assert.match(lido.corpo.geracao.ficheiro.ver, new RegExp(`/api/ficheiro\\?id=${id}`));

  const f = await MD.lerFicheiro(repo, id, { env: ENV });
  assert.equal(f.ok, true);
  assert.equal(f.bytes.length, IMAGEM.length);
  assert.equal(f.mime, 'image/jpeg');
});

test('mídia: consultar o trabalho faz avançar um passo (sem depender de uma requisição longa)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const criada = await pedirImagem(repo, projeto.id);
  const id = criada.corpo.geracao.id;

  /* o registo acabou de nascer: o passo é ligeiramente adiado para dois pedidos
     simultâneos não gerarem a mesma imagem */
  await new Promise((r) => setTimeout(r, 1600));
  const lido = await chamar(repo, `/ops/media/${id}`, 'GET', null, { fetchImpl: fetchImagem });
  assert.equal(lido.corpo.geracao.estado, 'concluida');
  assert.ok(lido.corpo.geracao.ficheiro);
});

test('mídia: falha do fornecedor fica escrita, com motivo — e repetir avisa do custo', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const criada = await pedirImagem(repo, projeto.id, { chave: 'falha-1' });
  const id = criada.corpo.geracao.id;

  const g = await repo.geracoes.porId(id);
  const falhada = await MD.avancar(repo, g, { env: ENV, fetchImpl: fetchRecusa });
  assert.equal(falhada.estado, 'falhou');
  assert.match(falhada.erro, /crédito|credit|não veio|402/i);
  assert.equal(falhada.ficheiro, null, 'uma falha não pode deixar um ficheiro falso');

  const repetir = await chamar(repo, `/ops/media/${id}/repetir`, 'POST');
  assert.equal(repetir.status, 202);
  assert.equal(repetir.corpo.geracao.estado, 'aguardando');
  assert.match(repetir.corpo.aviso, /gratuito|novo custo/);
  assert.equal(repo._dados.geracoes.filter((x) => x.anterior === id).length, 1);
});

test('mídia: falha transitória tem uma nova tentativa — mas limitada', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const criada = await pedirImagem(repo, projeto.id);
  const id = criada.corpo.geracao.id;

  const g1 = await repo.geracoes.porId(id);
  const t1 = await MD.avancar(repo, g1, { env: ENV, fetchImpl: fetchCai });
  assert.equal(t1.estado, 'aguardando', 'uma queda de rede não mata o trabalho à primeira');
  assert.equal(t1.tentativas, 1);
  assert.match(t1.erro, /tentar outra vez/);

  const g2 = await repo.geracoes.porId(id);
  const t2 = await MD.avancar(repo, g2, { env: ENV, fetchImpl: fetchCai, agora: Date.now() + 5000 });
  assert.equal(t2.estado, 'falhou', 'as tentativas têm tecto: não é um ciclo sem fim');
  assert.equal(t2.tentativas, 2);
});

test('mídia: cancelar só antes de o pedido sair daqui — e o ecrã sabe dizê-lo', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const criada = await pedirImagem(repo, projeto.id);
  const cancelar = await chamar(repo, `/ops/media/${criada.corpo.geracao.id}/cancelar`, 'POST');
  assert.equal(cancelar.status, 200);
  assert.equal(cancelar.corpo.geracao.estado, 'cancelada');
  assert.match(cancelar.corpo.nota, /nada foi cobrado/);

  /* um trabalho já enviado não se cancela: o pedido saiu e pode ser cobrado */
  const outra = await pedirImagem(repo, projeto.id);
  await repo.geracoes.actualizar(outra.corpo.geracao.id, { estado: 'em_processamento' });
  const tarde = await chamar(repo, `/ops/media/${outra.corpo.geracao.id}/cancelar`, 'POST');
  assert.equal(tarde.status, 409);
  assert.match(tarde.corpo.error, /já saiu daqui/);
});

test('mídia: classificar conceito ↔ aprovado para uso, só quando há ficheiro', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const criada = await pedirImagem(repo, projeto.id);
  const id = criada.corpo.geracao.id;

  const cedo = await chamar(repo, `/ops/media/${id}/classificar`, 'POST', { classificacao: 'aprovado' });
  assert.equal(cedo.status, 409, 'sem ficheiro não há nada para aprovar');

  await MD.avancar(repo, await repo.geracoes.porId(id), { env: ENV, fetchImpl: fetchImagem });
  const ok = await chamar(repo, `/ops/media/${id}/classificar`, 'POST', { classificacao: 'aprovado' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.geracao.classificacao, 'aprovado');
  assert.match(ok.corpo.geracao.classificacaoTxt, /aprovado/);

  const invalida = await chamar(repo, `/ops/media/${id}/classificar`, 'POST', { classificacao: 'final' });
  assert.equal(invalida.status, 400);
});

/* ------------------------------------------------------------------ limites */

test('mídia: o limite diário corta a geração antes de falar com o fornecedor', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const env = { ORBITA_MEDIA_LIMITE_DIA: '2' };

  let chamadas = 0;
  const fetchContado = async (...a) => { chamadas += 1; return fetchImagem(...a); };

  const um = await comEnv(repo, `/ops/projetos/${projeto.id}/media`, 'POST', { tipo: 'imagem', prompt: PROMPT, confirmado: true }, env);
  const dois = await comEnv(repo, `/ops/projetos/${projeto.id}/media`, 'POST', { tipo: 'imagem', prompt: PROMPT, confirmado: true }, env);
  assert.equal(um.status, 202);
  assert.equal(dois.status, 202);

  const tres = await comEnv(repo, `/ops/projetos/${projeto.id}/media`, 'POST', { tipo: 'imagem', prompt: PROMPT, confirmado: true }, env, { fetchImpl: fetchContado });
  assert.equal(tres.status, 429);
  assert.match(tres.corpo.error, /limite de 2/);
  assert.equal(chamadas, 0, 'o limite tem de ser validado ANTES do fornecedor');
  assert.equal(repo._dados.geracoes.length, 2);
});

test('mídia: com trabalhos em curso, o pedido seguinte espera (o limite não é ultrapassado por dois cliques)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const env = { ORBITA_MEDIA_SIMULTANEAS: '1' };

  const um = await comEnv(repo, `/ops/projetos/${projeto.id}/media`, 'POST', { tipo: 'imagem', prompt: PROMPT, confirmado: true }, env);
  assert.equal(um.status, 202);
  const dois = await comEnv(repo, `/ops/projetos/${projeto.id}/media`, 'POST', { tipo: 'imagem', prompt: PROMPT, confirmado: true, chave: 'outro' }, env);
  assert.equal(dois.status, 429);
  assert.match(dois.corpo.error, /em curso/);

  const uso = await chamar(repo, `/ops/projetos/${projeto.id}/media`);
  assert.equal(uso.corpo.uso.activas, 1);
  assert.equal(uso.corpo.uso.simultaneas, 2, 'o valor por omissão é 2');
});

/* ------------------------------------------------------------------ vídeo */

test('mídia: um vídeo precisa de imagens deste projeto — e diz isso em vez de ficar à espera para sempre', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const semImagens = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'POST', {
    tipo: 'video', prompt: PROMPT, confirmado: true,
  });
  assert.equal(semImagens.status, 409);
  assert.match(semImagens.corpo.error, /imagem/);
});

test('mídia: o vídeo composto no browser é recebido, verificado e guardado — uma vez só', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);

  const img = await pedirImagem(repo, projeto.id);
  await MD.avancar(repo, await repo.geracoes.porId(img.corpo.geracao.id), { env: ENV, fetchImpl: fetchImagem });

  const video = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'POST', {
    tipo: 'video', prompt: PROMPT, confirmado: true, duracao: 4, formato: '16:9',
  });
  assert.equal(video.status, 202, JSON.stringify(video.corpo));
  assert.equal(video.corpo.geracao.precisaBrowser, true);
  assert.ok(video.corpo.geracao.fontes.length >= 1, 'diz de que imagens o plano é feito');

  const id = video.corpo.geracao.id;
  const bytes = Buffer.alloc(60_000, 3);
  const envio = await chamar(repo, `/ops/media/${id}/ficheiro`, 'POST', {
    ficheiro: { dataUrl: `data:video/webm;base64,${bytes.toString('base64')}`, mime: 'video/webm' },
    duracao: 4,
  });
  assert.equal(envio.status, 200, JSON.stringify(envio.corpo));
  assert.equal(envio.corpo.geracao.estado, 'concluida');
  assert.equal(envio.corpo.geracao.ficheiro.mime, 'video/webm');

  /* o mesmo envio repetido (a rede repetiu o pedido) não guarda duas vezes */
  const outra = await chamar(repo, `/ops/media/${id}/ficheiro`, 'POST', {
    ficheiro: { base64: bytes.toString('base64'), mime: 'video/webm' },
  });
  assert.equal(outra.corpo.repetido, true);

  /* num trabalho NOVO, um ficheiro que não é ficheiro é recusado */
  const outro = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'POST', {
    tipo: 'video', prompt: PROMPT, confirmado: true, duracao: 4,
  });
  const pequeno = await chamar(repo, `/ops/media/${outro.corpo.geracao.id}/ficheiro`, 'POST', {
    ficheiro: { base64: 'AAAA', mime: 'video/webm' },
  });
  assert.equal(pequeno.status, 400);
  assert.match(pequeno.corpo.error, /bytes|ficheiro/);

  const f = await MD.lerFicheiro(repo, id, { env: ENV });
  assert.equal(f.ok, true);
  assert.equal(f.mime, 'video/webm');
});

test('mídia: o que não é vídeo é recusado antes de tocar no armazém', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const img = await pedirImagem(repo, projeto.id);
  await MD.avancar(repo, await repo.geracoes.porId(img.corpo.geracao.id), { env: ENV, fetchImpl: fetchImagem });
  const video = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'POST', { tipo: 'video', prompt: PROMPT, confirmado: true });
  const id = video.corpo.geracao.id;

  const errado = await chamar(repo, `/ops/media/${id}/ficheiro`, 'POST', {
    ficheiro: { base64: Buffer.alloc(60_000, 1).toString('base64'), mime: 'image/jpeg' },
  });
  assert.equal(errado.status, 400);
  assert.match(errado.corpo.error, /MP4|WebM/);

  /* a uma imagem não se envia ficheiro nenhum: ela é gerada no servidor */
  const imagemDireta = await chamar(repo, `/ops/media/${img.corpo.geracao.id}/ficheiro`, 'POST', {
    ficheiro: { base64: Buffer.alloc(60_000, 1).toString('base64'), mime: 'video/webm' },
  });
  assert.equal(imagemDireta.status, 409);
});

/* ------------------------------------------------------------------ limites entre projetos */

test('mídia: um projeto não vê as gerações de outro (isolamento)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const a = await leadComProjeto(repo, CLINICA);
  const b = await leadComProjeto(repo, OFICINA);

  await pedirImagem(repo, a.projeto.id, { chave: 'a-1' });
  const vistaB = await chamar(repo, `/ops/projetos/${b.projeto.id}/media`);
  assert.equal(vistaB.status, 200);
  assert.equal(vistaB.corpo.geracoes.length, 0);

  const vistaA = await chamar(repo, `/ops/projetos/${a.projeto.id}/media`);
  assert.equal(vistaA.corpo.geracoes.length, 1);
  assert.equal(vistaA.corpo.projeto.leadId, a.lead.id);
});

test('mídia: um leitor não gera — o servidor recusa, não é só esconder o botão', async () => {
  limparMemoria();
  const repo = createMemRepo();
  limitador.limpar();
  const primeiro = await responder(repo, {
    caminho: '/auth/primeiro-dono', metodo: 'POST', env: ENV, fetchImpl: semRede, seguranca: true,
    corpo: { email: 'dono@orbita.pt', password: SENHA, name: 'Valdimiro', token: ENV.SETUP_TOKEN },
  });
  assert.equal(primeiro.status, 200);
  const dono = decodeURIComponent(primeiro.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);
  const autorizado = { seguranca: true };

  await chamar(repo, '/ops/leads', 'POST', { leads: [CLINICA] }, { ...autorizado, ...comCookie(dono) });
  const lead = repo._dados.leads[0];
  const p = await chamar(repo, `/ops/leads/${lead.id}/projeto`, 'POST', { kind: 'landing' }, { ...autorizado, ...comCookie(dono) });
  const projeto = p.corpo.projeto;

  await chamar(repo, '/ops/utilizadores', 'POST', {
    email: 'leitor@orbita.pt', password: SENHA, name: 'Leitora', role: 'leitor',
  }, { ...autorizado, ...comCookie(dono) });
  limitador.limpar();
  const entrar = await chamar(repo, '/auth/entrar', 'POST', { email: 'leitor@orbita.pt', password: SENHA }, autorizado);
  const leitor = decodeURIComponent(entrar.cabecalhos['Set-Cookie'].split(';')[0].split('=')[1]);

  const ler = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'GET', null, { ...autorizado, ...comCookie(leitor) });
  assert.equal(ler.status, 200, 'quem tem sessão pode ver a galeria');

  const gerar = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'POST',
    { tipo: 'imagem', prompt: PROMPT, confirmado: true }, { ...autorizado, ...comCookie(leitor) });
  assert.equal(gerar.status, 403);
  assert.match(gerar.corpo.error, /papel/);
  assert.equal(repo._dados.geracoes.length, 0);

  const semSessao = await chamar(repo, `/ops/projetos/${projeto.id}/media`, 'GET', null, autorizado);
  assert.equal(semSessao.status, 401);
});

/* ------------------------------------------------------------------ ficheiro servido */

const respostaFalsa = () => ({
  cabecalhos: {}, tipo: null, corpo: null, estado: null,
  setHeader(k, v) { this.cabecalhos[k] = v; },
  status(n) { this.estado = n; return this; },
  json(o) { this.corpo = o; return this; },
  end(b) { this.corpo = b; return this; },
});

test('mídia: o ficheiro só sai com sessão e com o tipo certo (endpoint binário)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const criada = await pedirImagem(repo, projeto.id);
  const id = criada.corpo.geracao.id;
  await MD.avancar(repo, await repo.geracoes.porId(id), { env: ENV, fetchImpl: fetchImagem });

  /* sem base ligada, o endpoint diz que não há base — nunca serve bytes a ninguém */
  const semBase = respostaFalsa();
  await handlerFicheiro({ method: 'GET', url: `/api/ficheiro?id=${id}`, headers: {} }, semBase);
  assert.equal(semBase.estado, 503);

  const soGet = respostaFalsa();
  await handlerFicheiro({ method: 'POST', url: `/api/ficheiro?id=${id}`, headers: {} }, soGet);
  assert.equal(soGet.estado, 405);

  /* o ficheiro, lido do armazém com o tipo e o nome certos */
  const f = await MD.lerFicheiro(repo, id, { env: ENV });
  assert.equal(f.mime, 'image/jpeg');
  assert.match(f.nome, /\.jpg$/);
  const arm = criarArmazem({ env: ENV });
  assert.equal(arm.tipo, 'memoria');
});

test('mídia: apagar o projeto leva os ficheiros e os registos (a regra, escrita)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  const criada = await pedirImagem(repo, projeto.id);
  const id = criada.corpo.geracao.id;
  await MD.avancar(repo, await repo.geracoes.porId(id), { env: ENV, fetchImpl: fetchImagem });
  const caminho = repo._dados.geracoes[0].ficheiro.caminho;

  const r = await MD.apagarDoProjeto(repo, projeto.id, { env: ENV });
  assert.equal(r.ok, true);
  assert.equal(r.registos, 1);
  assert.ok(r.ficheiros >= 1);
  assert.equal(repo._dados.geracoes.length, 0);
  assert.equal(await (await criarArmazem({ env: ENV })).get(caminho), null, 'os bytes não podem ficar órfãos');
});

/* ------------------------------------------------------------------ o pump */

test('mídia: o «pump» de fundo exige o token do worker (e avança o que ficou à espera)', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const { projeto } = await leadComProjeto(repo);
  await pedirImagem(repo, projeto.id, { chave: 'pump-1' });

  const semToken = await chamar(repo, '/media/geracoes/avancar', 'POST', {});
  assert.equal(semToken.status, 401);

  const comToken = await responder(repo, {
    caminho: '/media/geracoes/avancar', metodo: 'POST',
    corpo: { token: 'token-do-worker-1', } , env: { ...ENV, MEDIA_WORKER_TOKEN: 'token-do-worker-1' }, fetchImpl: semRede,
  });
  /* sem rede o fornecedor não responde, mas o pedido é aceite e o estado é escrito */
  assert.equal(comToken.status, 200);
  assert.equal(comToken.corpo.ok, true);
  const g = repo._dados.geracoes[0];
  assert.ok(['aguardando', 'falhou'].includes(g.estado), `estado inesperado: ${g.estado}`);
  assert.ok(g.tentativas >= 1, 'o pump tem de ter tentado');
});

/* ------------------------------------------------------------------ o ecrã */

const fakeApi = (dados = {}) => {
  const S = { media: null };
  const chamadas = [];
  const api = {
    S, chamadas, pintou: 0, avisos: [],
    async call(caminho, metodo = 'GET', corpo = null) {
      chamadas.push({ caminho, metodo, corpo });
      if (dados[caminho]) return typeof dados[caminho] === 'function' ? dados[caminho]({ caminho, metodo, corpo }) : dados[caminho];
      throw new Error(`sem resposta falsa para ${metodo} ${caminho}`);
    },
    paint() { this.pintou += 1; },
    toast(t, mau) { this.avisos.push({ t, mau }); },
  };
  return api;
};

const vistaExemplo = () => ({
  ok: true,
  projeto: { id: 'p_1', nome: 'Clínica do Mondego', leadId: 'l_1' },
  fornecedores: [],
  opcoes: {
    imagem: { formatos: [{ id: '1:1', rotulo: 'Quadrado' }, { id: '16:9', rotulo: 'Cinema' }], resolucoes: [{ id: '1024', rotulo: 'Normal' }] },
    video: { formatos: [{ id: '16:9', rotulo: 'Cinema' }], duracoes: [{ id: 6, rotulo: '6 s', nota: '3 planos' }], movimentos: [{ id: 'kenburns', rotulo: 'Movimento lento' }] },
  },
  prompts: [{ id: 'principal', finalidade: 'Imagem principal da página', prompt: 'clinica ao amanhecer, luz de janela' }],
  geracoes: [],
  uso: { hoje: 0, porDia: 24, activas: 0, simultaneas: 2 },
  limites: { porDia: 24, porProjetoDia: 12 },
  armazem: { tipo: 'supabase', pronto: true },
  avisoIA: 'tudo o que sai daqui é conteúdo gerado por IA',
  estados: MD.ESTADOS,
});

test('ecrã: o botão de gerar só abre depois da estimativa, e o custo está à vista', async () => {
  const api = fakeApi();
  api.S.media = { ...estadoNovo('p_1'), dados: vistaExemplo() };
  const html = vistaMedia(api.S, { projeto: { name: 'Clínica do Mondego' } });
  assert.match(html, /Mídia do projeto/);
  assert.match(html, /conteúdo de IA/, 'a peça diz que é de IA');
  assert.match(html, /data-act="md-gerar"[^>]*disabled/, 'sem estimativa não há confirmação');
  assert.match(html, /Ver estimativa/);
  assert.match(html, /Ainda sem estimativa/);

  api.S.media.estimativa = { valor: 0, moeda: 'USD', confiavel: true, rotulo: '0,00 US$ · gratuito', factores: ['1 imagem · 1024×1024 px'] };
  api.S.media.prompt = 'clinica ao amanhecer, luz de janela';
  const depois = vistaMedia(api.S, { projeto: { name: 'Clínica do Mondego' } });
  assert.doesNotMatch(depois, /data-act="md-gerar"[^>]*disabled/);
  assert.match(depois, /gratuito/);
});

test('ecrã: estimar → confirmar manda o pedido com confirmação e a mesma chave em dois cliques', async () => {
  const api = fakeApi({
    '/ops/projetos/p_1/media/estimativa': () => ({ ok: true, custo: { valor: 0, moeda: 'USD', confiavel: true, rotulo: '0,00 US$ · gratuito' }, opcoes: {} }),
    '/ops/projetos/p_1/media': ({ metodo }) => (metodo === 'POST'
      ? { ok: true, geracao: { id: 'g_9', tipo: 'imagem', estado: 'aguardando', estadoTxt: 'à espera', estadoCls: 'espera', prompt: 'x', opcoes: {}, custo: { estimado: 0, moeda: 'USD', confiavel: true } } }
      : vistaExemplo()),
  });
  api.S.media = { ...estadoNovo('p_1'), dados: vistaExemplo(), prompt: 'clinica ao amanhecer, luz de janela' };

  const semEstimar = await accaoMedia('md-gerar', null, api);
  assert.equal(semEstimar, true);
  assert.equal(api.avisos.at(-1).mau, true, 'sem estimativa, gerar é travado com uma frase');

  await accaoMedia('md-estimar', null, api);
  assert.equal(api.S.media.estimativa.valor, 0);

  await accaoMedia('md-gerar', null, api);
  const envio = api.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/ops/projetos/p_1/media');
  assert.equal(envio.length, 1);
  assert.equal(envio[0].corpo.confirmado, true, 'a confirmação vai explícita no corpo');
  assert.ok(envio[0].corpo.chave, 'cada pedido leva chave de idempotência');

  /* a chave é do pedido: o segundo clique antes da resposta leva a MESMA chave */
  const primeiraChave = envio[0].corpo.chave;
  api.S.media.chave = primeiraChave;
  await accaoMedia('md-gerar', null, api);
  const segundo = api.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/ops/projetos/p_1/media').at(-1);
  assert.equal(segundo.corpo.chave, primeiraChave);
});

test('ecrã: uma geração guardada mostra-se com pré-visualização, download e classificação', () => {
  const dados = vistaExemplo();
  dados.geracoes = [{
    id: 'g_1', tipo: 'imagem', estado: 'concluida', estadoTxt: 'concluída', estadoCls: 'ok',
    fornecedor: 'pollinations', modelo: null, prompt: 'interior de clínica', opcoes: { largura: 1024, altura: 1024 },
    projetoId: 'p_1', leadId: 'l_1', por: 'mesa', criado: new Date().toISOString(), actualizado: null, tentativas: 0, erro: null,
    precisaBrowser: false, fontes: null, classificacao: 'conceito', classificacaoTxt: 'conceito de IA', classificacaoCls: 'conceito',
    podeCancelar: false, podeRepetir: true,
    custo: { estimado: 0, moeda: 'USD', confiavel: true, real: null, nota: 'custo estimado' },
    ficheiro: { mime: 'image/jpeg', bytes: 240000, largura: 1024, altura: 1024, ver: '/api/ficheiro?id=g_1', descarregar: '/api/ficheiro?id=g_1&d=1', nome: 'p-1-imagem-g_1.jpg' },
  }];
  const api = fakeApi();
  api.S.media = { ...estadoNovo('p_1'), dados };
  const html = vistaMedia(api.S, { projeto: { name: 'Clínica do Mondego' } });

  assert.match(html, /<img[^>]+src="\/api\/ficheiro\?id=g_1"/, 'a pré-visualização vem do servidor, com sessão');
  assert.match(html, /conceito de IA/);
  assert.match(html, /Descarregar/);
  assert.match(html, /Aprovar para uso/);
  assert.match(html, /gratuito/);
  assert.match(html, /Gerar outra vez/);
});
