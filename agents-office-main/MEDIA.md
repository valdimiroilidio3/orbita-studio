# Mídia gerada — imagens e vídeos do projeto

> 1.54.3 · 2 nov 2026. O que faltava a seguir ao briefing: o Prompt Master dizia
> o que fazer, os prompts de imagem descreviam a fotografia, e nada era gerado.
> Agora gera-se, com o custo à vista, guardado e ligado à lead e ao projeto.

## O que é

Dentro de cada projeto (que nasce de uma lead) há uma área **Mídia do projeto**
com duas coisas:

- **imagem** — gerada no servidor, em segundos, por **Pollinations**;
- **vídeo** — **composto no browser** com as imagens já geradas do projeto
  (movimento lento tipo *Ken Burns*, um MP4 ou WebM real).

Tudo o que sai daqui nasce marcado como **conteúdo de IA**. Só o dono o passa a
«aprovado para uso»; até lá é **conceito visual** — não é registo real da
empresa, nem da equipa, nem das instalações.

## O fluxo, passo a passo

1. Abrir o projeto (`#/projeto/:id`) → cartão **Mídia do projeto**.
2. Escolher um **prompt do briefing** (os quatro prompts de imagem da aba
   *Imagens*) ou escrever um. O prompt é editável e é **este** que é enviado.
3. Escolher o tipo (imagem/vídeo) e as opções **que o fornecedor tem**:
   - imagem: proporção (1:1, 4:5, 16:9, 9:16, 3:2) e resolução (768 / 1024 /
     1344 px no lado maior, arredondado a múltiplos de 64);
   - vídeo: 16:9 (é o que o compositor grava) e duração (4/6/8/10 s), câmara
     lenta ou firme.
4. **Ver estimativa.** Só depois de a estimativa existir é que o botão de
   confirmar abre.
5. **Confirmar e gerar** — o pedido leva `confirmado: true` e uma chave de
   idempotência.
6. **Acompanhar**: o trabalho fica `aguardando → em_processamento → concluida`
   (ou `falhou`, ou `cancelada`). O ecrã pergunta de 2,5 em 2,5 segundos;
   recarregar a página ou sair não perde nada.
7. **Encontrar depois**: galeria do projeto, com pré-visualização, download,
   detalhe (prompt enviado, opções, fornecedor, quem pediu, custo) e
   «gerar outra vez».

## Provedores (e porquê estes)

| Tipo | Provedor | Custo | Chave | O que é |
|---|---|---|---|---|
| imagem | **Pollinations** (`image.pollinations.ai`, `gen.pollinations.ai`) | 0 (tier gratuito) | `POLLINATIONS_API_KEY` **opcional** | Imagem real a partir de um prompt. Sem chave usa o tier anónimo (modelo `flux`); com chave usa os modelos do catálogo. |
| vídeo | **Órbita Render** (canvas + `MediaRecorder`, `src/estudio-video.js`) | 0 | nenhuma | Composição local das imagens do projeto. **Não é vídeo generativo.** |

**Porque não há vídeo generativo grátis:** os modelos de vídeo do catálogo
Pollinations são pagos (`paid_only`) e o OpenMontage precisa de Python + FFmpeg
numa máquina. Num plano gratuito de funções serverless não há render de vídeo.
Em vez de fingir, o vídeo é composto no browser — e a interface diz isso na cara.

**Limitações declaradas:**
- tier anónimo da Pollinations: sem SLA, pode limitar o ritmo e recusar prompts
  por política; o nome do modelo é ignorado (serve `flux`);
- compositor de vídeo: máx. 1280×720, 16:9, até 6 planos, ~20 s; navegar para
  fora interrompe a composição (o trabalho fica «à espera» e retoma-se);
- não há legendas, voz nem música no vídeo composto.

## Variáveis de ambiente

| Nome | Obrigatória | Para quê |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | sim (produção) | a base **e** o armazenamento dos ficheiros |
| `POLLINATIONS_API_KEY` | não | passa a imagem para os modelos do catálogo (sem ela, tier anónimo) |
| `ORBITA_MEDIA_BUCKET` | não | nome do bucket (por omissão `orbita-media`) |
| `ORBITA_MEDIA_LIMITE_DIA` | não | gerações por utilizador e por dia (omissão **24**) |
| `ORBITA_MEDIA_SIMULTANEAS` | não | trabalhos em curso ao mesmo tempo, por utilizador (omissão **2**) |
| `ORBITA_MEDIA_LIMITE_PROJETO_DIA` | não | gerações por projeto e por dia (omissão **12**) |
| `ORBITA_PRECOS_MEDIA` | não | tabela de preços em JSON para estimativas (ver abaixo) |
| `MEDIA_WORKER_TOKEN` | não | token do *pump* de fundo (`POST /api/rpc` → `/media/geracoes/avancar`) |

Nenhuma chave chega ao browser. Nenhum erro devolve chaves: o que sai é o motivo.

## Custos

- A estimativa é calculada a partir de uma **tabela configurável**
  (`ORBITA_PRECOS_MEDIA`), com os dois fornecedores gratuitos a **0**.
- O preço não é garantido: a interface chama-lhe «estimativa».
- Fornecedor sem entrada na tabela → **«custo desconhecido»** e a confirmação
  passa a pedir aceitação explícita (`confirm()` no browser e `confirmado:true`
  no corpo).
- `custo_real` fica **null** quando o fornecedor não devolve um valor definitivo —
  não se apresenta um estimado como definitivo.
- Exemplo de tabela para um fornecedor pago futuro:

```json
{
  "fal-ai": { "video": { "moeda": "USD", "base": 0.10, "porSegundo": 0.05, "confiavel": true } }
}
```

## Limites

Contados **por utilizador** (`conta_id`) e por dia UTC, e por projeto; e um tecto
de trabalhos simultâneos. Tudo verificado **antes** de falar com o fornecedor.
Ultrapassar devolve `429` com a frase que diz qual limite foi atingido.

## Como corre sem bloquear a interface

Não há uma requisição longa nem dependência de um worker externo:

1. `POST …/media` **cria** a linha na base e responde `202` com o estado
   `aguardando`;
2. a mesa pergunta `GET /ops/projetos/:id/media` a cada 2,5 s, e **cada
   pergunta faz avançar um passo** de um trabalho pendente (é o executor);
3. a **reivindicação** é atómica (`PATCH … where estado = 'aguardando'`): dois
   separadores abertos ao mesmo tempo não geram — nem cobram — a mesma imagem;
4. um cron ou máquina tua pode chamar `POST /api/rpc` →
   `/media/geracoes/avancar` com `MEDIA_WORKER_TOKEN` (máx. 5 por chamada) para
   avançar trabalhos quando ninguém tem a página aberta;
5. falhas transitórias têm **até 2 tentativas**; depois ficam `falhou`, com o
   motivo escrito, e o dono decide se tenta outra vez (sabendo que pode custar).

**Cancelar** só é possível antes de o pedido sair daqui (`aguardando`). Um
trabalho já enviado não se cancela: o pedido saiu e pode ser cobrado — e o ecrã
diz exactamente isso.

## Onde ficam os ficheiros

- **Supabase Storage**, bucket **privado** `orbita-media`, caminho
  `projetos/<projeto>/<geração>.<ext>`.
- Sem `SUPABASE_URL`/`SUPABASE_SECRET_KEY`: memória do processo (a interface
  avisa que os ficheiros se perdem num arranque).
- **Nunca** se guarda uma URL do fornecedor: ela expira e não está ligada a
  ninguém.
- Saída só por `GET /api/ficheiro?id=<geração>` (`&d=1` para download), com
  sessão; `Cache-Control: private, no-store`; tipo conferido contra uma lista
  fechada; `nosniff`.
- Validação à entrada: mime aceite, mínimo 10 000 bytes, máximo 2,5 MB de vídeo
  (cabe no limite de corpo da Vercel), duração ≤ 20 s.
- **Apagar um projeto:** não há ainda rota que o faça. A regra já está escrita e
  implementada em `apagarDoProjeto()` (`api/_media.mjs`): primeiro os registos,
  depois o prefixo dos bytes no armazém. Quando a rota de apagar existir, é esta
  função que se chama.

## Rotas

| Método | Rota | Para quê |
|---|---|---|
| GET | `/api/ops/projetos/:id/media` | fornecedores, opções, prompts do briefing, galeria, limites, uso |
| POST | `/api/ops/projetos/:id/media/estimativa` | estimativa para uma configuração (não cria nada) |
| POST | `/api/ops/projetos/:id/media` | criar a geração (`confirmado:true`, `chave`) |
| GET | `/api/ops/media/:id` | estado (e um passo de avanço) |
| POST | `/api/ops/media/:id/cancelar` | cancelar antes de sair daqui |
| POST | `/api/ops/media/:id/repetir` | nova tentativa (avisa do custo) |
| POST | `/api/ops/media/:id/classificar` | `conceito` ↔ `aprovado` |
| POST | `/api/ops/media/:id/ficheiro` | receber o vídeo composto no browser |
| GET | `/api/ficheiro?id=…` | o ficheiro, com sessão |
| POST | `/api/rpc` → `/media/geracoes/avancar` | *pump* de fundo (token do worker) |

Todos os `POST` são escrita: a porta (`api/_porta.mjs`) exige `write` antes de cá
chegar — um `leitor` recebe `403`, e há teste.

## Base de dados

Uma migração: **`supabase/orbita_1_54_3.sql`** — tabela `orbita_geracoes` (prompt
enviado, opções, tipo, fornecedor, modelo, estado, custos, classificação,
ficheiro, fontes do vídeo, tentativas, chave única de idempotência) e o bucket
privado `orbita-media`. Idempotente.

Aplicar: `/api/setup?token=…` (aplica tudo) ou
`/api/setup?token=…&so=orbita_1_54_3.sql`.

## O que é real e o que não é

**Real (provado em `media.test.mjs` e num percurso em jsdom sobre o bundle):**
estimativa antes de confirmar; confirmação obrigatória; limites antes do
fornecedor; idempotência por chave; estados persistidos; falha com motivo e nova
tentativa; cancelamento só enquanto faz sentido; classificação de IA; vídeo
composto e verificado; ficheiro servido com sessão; isolamento entre projetos;
`403` para leitor; galeria que sobrevive a recarregar.

**Não real (dito, não escondido):** geração de vídeo por IA (não há caminho
gratuito); progresso percentual vindo do fornecedor (não existe — o que se mostra
a 100% é o progresso da composição no browser); custo real quando o fornecedor
não o devolve; isolamento por organização (a Órbita é uma instalação, uma
organização).

## Testes

`node --test media.test.mjs` → 25 testes (fornecedor falso, bytes inventados,
zero rede, zero cobranças). Suite completa: **851**.
