# A cena — contrato e cores

Este documento existe porque a cena é feita de peças que não se vêem umas às outras: os dados
dizem as cores, a paleta deriva os tons, os builders desenham a geometria, o `main.js` monta o
escritório e o HUD escreve por cima. Quando uma dessas pontas muda sozinha, o sintoma aparece
longe da causa — foi exactamente o que aconteceu em 1.9.2, e é o que os testes abaixo evitam.

## Ficheiros e responsabilidades

| Ficheiro | Sabe | **Não** sabe |
|---|---|---|
| `src/data.js` | as 7 salas, os 35 agentes, o `LAYOUT`, as cores (`chip`, `ink`, `glass`) | desenhar, three, DOM |
| `src/palette.js` | derivar tons de uma cor (base, aresta, poça), nomear famílias de matiz | salas, three, DOM |
| `src/builders.js` | geometria procedural (pods, secretárias, paredes, pessoas) | que sala é qual |
| `src/main.js` | montar o escritório, câmara, LOD, modo escuro, cartões | derivar tons à mão |
| `src/brain.js` | o centro: orbe, notas, leituras | as salas |
| `src/mcp.js` · `src/live.js` | conectores · o trabalho real nos monitores | a geometria |

Regra: **os builders recebem cores, nunca salas.** Quem sabe que `sales` é a PROSPEÇÃO é o
`main.js`; quem sabe transformar `#E3B93A` em quatro tons é a `palette`.

## O contrato das peças (`userData`)

Toda a malha que a cena precisa de reconhecer depois leva etiqueta. Nada de índices mágicos
(`children[1]`), que foi como a primeira camada nova partiu o modo escuro.

| Chave | Significado | Quem lê |
|---|---|---|
| `userData.dept` | a sala a que a peça pertence (`emails`…`brain`) | foco/escurecer, clique, inspecção |
| `userData.part` | o papel da peça (tabela abaixo) | modo escuro, teste de cena |
| `userData.tint` | a cor de onde o tom foi derivado | modo escuro (re-tingir) |
| `userData.agentId` | o agente, nas peças de uma pessoa | clique no agente |

Peças do pod: `plinth` (o volume branco) · `floorBase` · `floorEdge` · `floorGlass` ·
`floorPool`. Paredes: `wall`, `wallTrim`, `wallGlass`, `wallCap`, `wallSign`. Pontes:
`walkway`.

## O chão de vidro (V7, 26 out 2026)

Pedido do dono: *«um chão da cor dos vidros — vermelho, verde, azul, roxo, amarelo e azul céu»*.
Um painel de vidro laminado, visto de cima, tem quatro camadas — e é isso que está desenhado:

1. **`floorBase`** — o tom fundo, opaco, 0.10 de altura. É o que dá profundidade ao vidro, o que
   garante a cor num ecrã sem transparência, e o que **recebe as sombras**: as sombras das
   secretárias vêem-se *através* do vidro, que é o que o faz parecer vidro.
2. **`floorEdge`** — a aresta polida, mais clara, 0.115. O vidro real apanha a luz na espessura;
   sem esta camada a laje lê-se como tinta.
3. **`floorGlass`** — a laje translúcida (opacidade 0.62, verniz `clearcoat: 1`), 0.12 — o nível
   exacto do chão, onde as secretárias pousam.
4. **`floorPool`** — a poça de luz do candeeiro, branca e suave, por cima de tudo.

As quatro saem de **uma** cor: `glassLayers()` em `src/palette.js`.

## As seis cores

| Sala | Família | Vidro | Porquê |
|---|---|---|---|
| `emails` COMANDO | verde | `#1FA36B` | a cor de marca é menta |
| `delivery` ENGENHARIA | azul céu | `#41AEE4` | a cor de marca é céu |
| `sales` PROSPEÇÃO | amarelo | `#E3B93A` | a cor de marca é manteiga |
| `marketing` MEDIA | vermelho | `#DC5348` | a cor de marca é coral |
| `fin` DESIGN LAB | azul | `#4A6DE0` | a cor de marca é pervinca |
| `ops` VENDAS | roxo | `#8B5AD6` | a cor de marca é violeta |
| `brain` O CÉREBRO | **neutro** | `#AEB6AB` | o centro não compete com as salas |

O `chip` (pastel) continua a ser a cor de marca — cartões, secretárias, avatares. O `glass`
(saturado) é a mesma família e pinta o chão e a banda de vidro das paredes.

**Para mudar uma cor**, muda-se uma linha em `src/data.js` (`glass` e `glassName`). Se a família
desaparecer, o teste di-lo pelo nome. Se a cor mudar de família, o teste di-lo também — não é
preciso ninguém se lembrar da regra.

## O que prova o quê

- `npm run test:office` — `office.test.mjs`, 17 testes puros: matemática de cor, famílias,
  derivação das camadas, e as invariantes dos dados (7 pods, 35 agentes, um chefe por sala,
  duas pessoas na mesma secretária, `officeProblems()` vazio).
- `npm run test:scene` — carrega o bundle num DOM com WebGL falso, corre o ciclo de desenho e
  **lê o material que ficou desenhado** (`window.CC.office.floors`): 7 pods, 4 camadas cada, a
  laje translúcida, e cada uma das seis famílias presente exactamente uma vez, com o centro em
  vidro fosco.
- `npm run check` — o servidor, as rotas, a sessão, o SSE.

## Código sem uso, declarado

`src/builders.js` é um catálogo e ainda tem peças que a cena actual não chama: `makeHolo`,
`makeServerRack`, `makeMeetingTable`, `makeNeuralBrain` e `makeFloorTitle` (os títulos de chão
saíram quando os cartões passaram a nomear as salas). Ficam no catálogo, não são chamadas, e o
teste de cena prova que nada por lá rebenta. Nada disto está importado no `main.js`.
