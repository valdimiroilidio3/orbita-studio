# Briefing do projeto — briefing, Prompt Master e prompts de imagem

> **1.54.3:** a geração de mídia já existe — mas noutra área, e a partir daqui.
> Esta aba continua a dar **prompts**; quem os transforma em imagem e vídeo é o
> cartão **Mídia do projeto** (ver `MEDIA.md`). O Prompt Master e os prompts de
> imagem continuam a não ser gerados no servidor como ficheiros.
>
> 1.54.2 · 2 nov 2026. Pedido do dono: *«ao iniciar um projeto a partir de uma
> lead, permitir que o usuário gere e edite um briefing, crie um Prompt Master
> personalizado e obtenha prompts de imagem relacionados ao projeto. Tudo deve
> ficar vinculado à lead e ao projeto correspondente.»*

Entrou antes do A2 (que mantém a 1.55, como o `ALVO-1.0.md` diz) porque é o fecho
do fluxo que o A1 abriu: a porta e o projeto já existiam — faltava o sítio onde o
trabalho de um projeto começa.

## Onde vive

| peça | ficheiro |
|---|---|
| campos, origens, validação, prompt por regras, IA, arquivo | `api/_briefing.mjs` |
| rotas `/ops/projetos/:id/briefing`, `/master`, `/imagens` | `api/_rotas.mjs` |
| ecrã (três abas dentro do projeto) | `src/briefing.js` |
| ligação à mesa (rota, acções, teclado, saída) | `src/mesa.js` |
| estilos | `src/mesa.html` (bloco `.bf-*`) |
| testes | `briefing.test.mjs` |

## O fluxo

| passo | o que acontece | código |
|---|---|---|
| 1 · iniciar | o lead abre «Iniciar projeto»; se já houver projeto, abre-se esse | `POST /ops/leads/:id/projeto` |
| 2 · semente | o briefing nasce com nome, setor e a nota do site — só factos da ficha | `daLead` |
| 3 · rascunho | a IA preenche **só campos vazios**, validada antes de gravar | `POST …/briefing/rascunho` |
| 4 · editar e gravar | 15 campos; cada um com a origem; 409 se outra pessoa gravou | `PUT …/briefing` |
| 5 · Prompt Master | do briefing **guardado**; IA quando há motor, regras quando não há | `POST …/master` |
| 6 · prompts de imagem | quatro finalidades, com nota de conceito | `POST …/imagens` |
| 7 · regenerar | a versão anterior vai para o histórico, nunca é apagada | `…/briefing/versoes`, `…/briefing/restaurar` |

## As origens de cada campo

Não é decoração: é a diferença entre um facto e uma sugestão.

- **`lead`** — está escrito na ficha (nome, setor, site). Não muda sozinho.
- **`ia`** — o modelo sugeriu, a partir da ficha. Aparece a laranja na mesa.
- **`manual`** — uma pessoa escreveu ou corrigiu. Passa a `manual` sempre que o
  valor muda, mesmo que o campo tivesse sido preenchido pela IA.
- **vazio** — a mesa escreve **«não informado»** e o Prompt Master manda
  perguntar ao cliente. Nunca se enche para parecer completo.

## Rotas

| método | caminho | devolve |
|---|---|---|
| POST | `/ops/leads/:id/projeto` | `{ projeto, existente, briefing }` — 201 na criação, 200 quando já existia |
| GET | `/ops/projetos/:id/briefing` | `{ briefing:{valores,origens,hash}, master, imagens, desactualizado, versoes, campos }` |
| PUT | `/ops/projetos/:id/briefing` | `{ ok, ...vista, ignorados }` — **409** se `base` já não for o hash actual |
| POST | `/ops/projetos/:id/briefing/rascunho` | `{ ok, via:'ia', ...vista }` — **502** com o motivo quando a IA não responde |
| POST | `/ops/projetos/:id/briefing/restaurar` | `{ ok, ...vista }` — repõe uma versão anterior |
| GET | `/ops/projetos/:id/briefing/versoes` | as versões anteriores, com o texto |
| POST | `/ops/projetos/:id/master` | `{ ok, master:{texto,via,base,...} }` — **409** se o briefing não chega |
| POST | `/ops/projetos/:id/imagens` | `{ ok, imagens:{prompts:[…],via} }` — **409** se o briefing não chega |

Escrita (`PUT`/`POST`) exige papel `write` (operador ou acima); leitura exige
sessão. Sem conta — testes e modo local — não há papel a verificar.

## O que é real e o que não é

**Real:** o briefing gravado e relido, o hash que detecta alterações, o Prompt
Master montado a partir do texto guardado, a validação das respostas da IA, o
histórico de versões, e o 403 do servidor para um `leitor`.

**IA depende do ambiente:** com uma chave no ambiente (`GROQ_API_KEY`, `OVH_*`,
etc.) o motor escreve o rascunho e o Prompt Master em inglês/português; sem
chave, a versão por regras fica no lugar **e o motivo vem escrito** — nunca se
apresenta texto de regras como se fosse da IA.

**Não existe nesta etapa:** geração de imagens ou vídeo (o que sai são *prompts*),
editor rico (texto simples), e isolamento por cliente/organização — a instalação
é uma só, como no resto da mesa.

## Onde fica guardado, e porque não há migração

`orbita_ai_config`, chave `briefing` — a mesma linha jsonb onde o Cine guarda os
projetos desde a 1.48.0. Guarda até 200 projetos e 6 versões por projeto. Não há
tabela nova, nem coluna nova, nem SQL para correr à mão: se o Cine funciona nesta
instalação, o briefing também funciona.

## Limitações declaradas

- O arquivo é uma linha jsonb partilhada com o Cine: muitos projetos grandes
  aproximam-se do tecto. No dia em que doer, passa a tabela própria
  (`orbita_briefings`) com uma migração — não é agora.
- O Prompt Master por regras é longo e estruturado, não é prosa criativa: é o
  documento de trabalho. A versão da IA é a que se lê melhor.
- Uma imagem gerada a partir do prompt «institucional» **não é** a equipa da
  empresa; a mesa diz isso em cada conjunto.
