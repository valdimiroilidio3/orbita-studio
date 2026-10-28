# Cine — um lead, um projecto criativo

> 1.48.0 · 28 out 2026. Pedido do dono: *«cada lead deve ser um ponto de partida para
> uma experiência criativa, com Master Prompt próprio e imagens e vídeos
> cinematográficos, num produto premium e não num CRM com IA colada»*.

O Cine vive num ecrã só, `#/cine` (lista) e `#/cine/<leadId>` (o estúdio de uma
lead). Está ligado ao funil: abre-se a partir do cartão **Peça cinematográfica**
dentro do lead.

## O fluxo, e onde cada passo acontece

| passo | o que acontece | onde está o código |
|---|---|---|
| 1 · abrir a lead | o servidor lê a ficha e devolve o que se sabe e o que falta | `analisarLead` (`api/_cine.mjs`) |
| 2 · Master Prompt | o motor de IA escreve o plano em JSON; se não servir, monta-se por regras | `masterPromptComIA` + `construirMasterPrompt` |
| 3 · direcção visual | estilo, paleta, luz, lente, composição e restrições entram no prompt | `ESTILOS` + `SETORES` |
| 4 · gerar | pedido HTTP verdadeiro ao Pollinations; os bytes são conferidos | `gerarImagem` |
| 5 · pré-visualizar | a imagem chega ao browser em `data:` — nenhuma chave sai do servidor | rota `/cine/gerar` |
| 6 · editar/regenerar | prompt editável à mão, modelo, formato e semente reprodutível | `src/cine.js` |
| 7 · aprovar | uma imagem aprovada por lead, com histórico | `aprovarImagem` |
| 8 · guardar | prompt, versões, imagens e histórico no projecto da lead | `orbita_ai_config` chave `cine` |

## O que é real e o que não é — dito sem rodeios

**Imagens: reais.** Quatro modelos com `paid_only: false`, lidos do fornecedor a
28 out 2026 (`GET https://gen.pollinations.ai/image/models`):

- `tongyi-mai/z-image-turbo` — rápido e barato;
- `black-forest-labs/flux.1.1-pro` — produto e retrato;
- `microsoft/mai-image-2.6` — hiper-realismo e texto na imagem;
- `microsoft/mai-image-2.6-flash` — a mesma família, mais depressa.

Duas rotas, por esta ordem: `gen.pollinations.ai/image/…` com a chave do dono
(`POLLINATIONS_API_KEY` ou `POLLINATIONS_TOKEN`); sem chave,
`image.pollinations.ai/prompt/…` no tier anónimo — que só conhece o `flux`, e é
isso que a resposta diz.

**Vídeo: ainda não.** Todos os modelos de vídeo do fornecedor são `paid_only`
(créditos Pollen): Wan 3.0, Kling 3.0, Seedance 2.0 Fast, MiniMax H3 Max. O outro
caminho é o worker do OpenMontage, que precisa de uma máquina com Python e FFmpeg.
`/cine/video` devolve a razão e os modelos, e o botão do ecrã fica desactivado
enquanto não houver caminho. O prompt de vídeo do Master Prompt fica guardado e
pronto — no dia em que houver créditos ou worker, é a mesma chamada que produz.

## Rotas

| método | caminho | devolve |
|---|---|---|
| GET | `/cine/estado` | modelos, formatos, estilos, se há chave, se há worker, arquivo |
| GET | `/cine/projetos` | lista de projectos com miniatura da peça aprovada |
| GET | `/cine/projeto?leadId=` | um projecto inteiro |
| POST | `/cine/abrir` | projecto + leitura da lead (sem gastar pedido de IA) |
| POST | `/cine/preparar` | Master Prompt novo (IA, senão regras) + versão guardada |
| POST | `/cine/gerar` | imagens geradas (1–4), guardadas no projecto |
| POST | `/cine/aprovar` | marca uma imagem como aprovada |
| POST | `/cine/apagar` | apaga uma imagem, ou o projecto |
| POST | `/cine/video` | enfileira no worker, ou explica o que falta |

Códigos: `404` sem lead, `409` sem Master Prompt (não há geração sem plano),
`402` quando o fornecedor pede créditos, `429` quando o travessão de geração
trava, `502` quando o fornecedor falha. Todos chegam à mesa com o motivo escrito.

## Acrescentar coisas sem reconstruir nada

- **modelo de imagem** → uma entrada em `MODELOS_IMAGEM` (`id`, `rotulo`, `nota`,
  `pago`). O ecrã desenha o select a partir daí;
- **estilo** → uma entrada em `ESTILOS` com `paleta`, `luz`, `lente` e `movimento`;
  entra nas pílulas de direcção de arte e no prompt;
- **sector/universo visual** → uma entrada em `SETORES` com uma expressão regular
  que apanhe o nicho; a leitura passa a escolher esse universo;
- **formato** → `FORMATOS` (proporção, pixels, uso);
- **modelo de vídeo** → `MODELOS_VIDEO`; quando um deles deixar de ser pago, é o
  `estadoDoVideo` que muda, não a interface.

## Regras que os testes seguem a cada alteração

`node --test cine.test.mjs` prova, entre outras coisas: dois negócios diferentes
não dão o mesmo prompt; uma resposta incompleta da IA é recusada e o plano sai
por regras **com o motivo**; um HTML de erro não passa por imagem; a chave nunca
aparece num URL; a mesma semente dá o mesmo pedido; quatro imagens não guardam
quatro base64; o botão de vídeo está desactivado quando não há caminho.
