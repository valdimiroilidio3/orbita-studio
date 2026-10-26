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

## As plantas (1.9.6, 26 out 2026)

Pedido do dono: *«melhorias nível Apple design 3D nas plantas, dando total realismo nelas»*.
O que havia era um vaso de tronco-de-cone com cinco esferas verdes — a peça que mais denunciava a
cena, ao lado de pessoas com pescoço e ombros.

| | `upright` (figueira/oliveira) | `broad` (monstera/filodendron) |
|---|---|---|
| Onde | emails, sales, fin (pods de 20×26/30) | delivery, marketing, ops, e o centro |
| Vaso | Ø 0,72 × 0,70 | Ø 0,84 × 0,62 |
| Folhas | 24, pequenas, em três andares | 15, grandes, em pecíolos que arqueiam |
| Altura final | ≈ 2,5 | ≈ 2,1 |

O que está desenhado, e porquê:

1. **A folha é uma superfície, não uma esfera.** `leafGeometry()` gera uma grelha paramétrica:
   estreita na base, larga a um terço, em bico no fim; **dobrada ao meio** (o nervo central é uma
   aresta, não uma linha pintada); bordo ondulado; e uma queda que cresce com o quadrado do
   comprimento — é assim que uma folha real pendura quando o pecíolo a larga.
2. **A cor varia onde a luz varia.** Cada vértice leva a sua cor (`color`): escuro na base e na
   nervura, claro a meio do limbo, e cada folha tem o seu desvio de matiz. O material é
   `vertexColors` — uma folha pintada de uma cor só parece plástico, mesmo com a melhor luz.
3. **O pecíolo é um tubo.** `stemGeometry()` segue uma Catmull-Rom (sai do tronco, arqueia,
   entrega a folha) e afina da base para a ponta. O caule principal é o mesmo tubo, inclinado.
4. **Filotaxia.** As folhas nascem em espiral de ângulo dourado (137,5°), com as velhas a pendurar
   (`pitchOld`) e as novas a abrir (`pitchNew`). É o que dá silhueta em vez de volume.
5. **O vaso é cerâmica torneada.** `LatheGeometry` com pé, pança e lábio virado para dentro; terra
   escura abaixo do lábio e umas pedras; e uma **sombra de contacto** (disco com gradiente em
   `MeshBasicMaterial`, `depthWrite: false`) a 0,010 do chão — sem ela o objeto flutua.
6. **Tudo determinístico.** `seededRandom()` (mulberry32) por planta; os testes comparam duas
   construções com a mesma semente e exigem vértices iguais. A cena não muda entre recarregamentos.
7. **Cabe no pod.** O lugar não é a olho: mede-se o raio da folhagem (`Box3`), afasta-se o vaso do
   canto o suficiente para nenhuma folha atravessar a parede de vidro (folga 0,45) e mede-se a
   distância à cadeira mais próxima. `window.CC.office.plants` publica `{dept, kind, seed, leaves,
   radius, top, inside, deskGap}` — e o teste de cena exige `inside: true` nas seis salas.

**Materiais:** `MeshStandardMaterial` simples (`roughness` 0,58 nas folhas, 0,58 no vaso, 0,98 na
terra). Não há environment map nem tone mapping: o brilho é o especular largo da luz-chave que já
existia — o polimento de 1.9.1 continua revertido, como o dono pediu. O realismo vem da forma e da
cor, não de um truque de render.

**Custo:** 5–6 malhas por planta (folhagem, caules, vaso, terra, pedras, sombra), 7 plantas, ~110 k
triângulos no total. As folhas e os caules são *merged* por geometria — não há 40 draw calls por
planta.

Retratos (rasterizados fora do browser, luz de estudo — servem para ver a forma, não para julgar a
luz da cena): `docs/planta-vertical.png`, `docs/planta-folha-larga.png`.

## As secretárias (1.9.8, 26 out 2026)

Pedido do dono: *«mesa moderna preta com LED, acessórios gamers, muito bonito e chamativo», com a
luz na cor da sala*.

Havia um tampo de madeira clara, dois armários brancos, um teclado branco e uma caneca. Agora é
uma secretária de gaming bem feita — e com **uma regra que atravessa tudo: a luz é da sala**.

| Peça | Material | Detalhe |
|---|---|---|
| Tampo + pernas | `#1C1E23`, metalness 0.28 | pernas em lâmina de grafite `#33363E` com sapata de metal |
| Fita LED | emissivo **`dept.glass`** | aresta da frente, as duas laterais, as pernas e a base da torre |
| Monitor | moldura preta + tela AO VIVO | luz de trás (halo) e **barra de luz Aukora** no cimo |
| Teclado | textura de teclas × cor da sala | teclado retroiluminado, sem uma luz por tecla |
| Tapete do rato | contorno aceso | textura própria × cor da sala |
| Torre | `#1C1E23` + vidro lateral | três ventoinhas com anel aceso |
| Cadeira | preta | costura do encosto e do assento na cor da sala |

- **Sete luzes, uma cor.** LED do tampo, halo do monitor, barra Aukora, teclado, tapete, anéis das
  colunas, ventoinhas da torre, costura da cadeira — todas em `dept.glass`, a mesma cor do chão de
  vidro. É o que faz o conjunto ler como sistema e não como sete objetos.
- **Sem post-processing.** O polimento de 1.9.1 continua revertido (sem PMREM, sem tone mapping):
  o brilho é **material emissivo** mais **quês aditivos** (`glowDisc`), que são geometria com alfa
  por vértice — o truque de sempre dos jogos e não mexe no pipeline de render.
- **Determinístico e variado.** `makeDesk(chip, live, { glass, seed })`: a semente escolhe uma de
  três variantes de acessório (comando, telemóvel em suporte, mini barra Aukora) e decide se há
  papéis. Posto 0 comando, posto 1 telemóvel, posto 2 barra; a mesma semente dá sempre a mesma mesa.
- **Fundido por material.** Cada secretária são ≤ 12 malhas (corpo, aresta, mate, metal, LED,
  acento, vidro, halo, tela, moldura, teclado, tapete) — e não as ~30 peças que a constroem.
- **Modo escuro.** Uma mesa preta sobre fundo escuro desaparece: no escuro o corpo sobe para
  grafite (`#2E3138`), o mate para `#23252A` e o LED sobe 45 % de intensidade. O `dimTwin` do foco
  também passou a escurecer a **emissão** — antes a sala apagava-se e a luz ficava acesa.
- Retratos (rasterizados fora do browser, luz de estudo; a tela aparece preta porque o conteúdo é
  desenhado em canvas no browser): `docs/secretarias-3-variantes.png`, `docs/secretaria-detalhe.png`.

## As salas — paredes, chão e adereço (1.10.3)

Cada sala é um **pod de vidro com uma parede em L** (os dois lados virados para longe da câmara).
Depois de 1.10.3 a parede tem, de baixo para cima: rodapé de **latão** de 0,20 → pano branco com
**ripaado vertical** a cada 0,92 → filete de latão → **banda de vidro** de 1,9 com três **montantes**
de latão por pano → **remate de latão** à cabeça. Nos cantos há pilares brancos com capitel de tinta.
A **cova de luz** (`base − 0,26`, emissiva na cor do vidro da sala) corre encostada ao rodapé do pano
e é o que dá a sensação de parede lavada por baixo. A placa da sala é latão `#8A6F45` a 2,36.

O **chão** são as quatro camadas de vidro de 1.9.x (0,10 / 0,115 / 0,12 + poça de luz), agora com um
**vinco de sombra** perimetral (`#26272B`) que separa a laje do volume branco, e um **filé de latão**
de 0,035 na aresta.

**Onde assenta cada secretária** (1.10.4). A grelha vive em `src/data.js`:
`stationSpot(dept, [coluna, fila])` devolve a posição local e `deskFront(dept)` o z mais à frente que
as secretárias ocupam. As filas encostam à **parede de fundo** (`SEAT_GRID.wallGap = 3,9`), e a
**faixa da frente** (`SEAT_GRID.entryBand = 6,0`) fica reservada à entrada. Salas de quatro filas
(sales, ops, delivery, marketing — sete agentes nas duas últimas) são mais fundas, `d = 34`; as de
três, `d = 26`. Medido: 6,7 m de entrada nas de 26 e 8,3 m nas de 34. Antes desta regra a conta era
`(fila − 1) × 6,4 − 1`, independente do tamanho da sala, e nas salas de sete punha a última fila
**em cima do salão**.

O **adereço** (`makeRoomDressing(w, d, glass, chip, ink, { seed, front })`) assenta na faixa da frente —
a única área grande que a câmara vê livre, porque as secretárias ocupam `z ∈ [−7,4, +8,4]` e
`x ∈ [−5,5, +5,5]`:

| peça | medida / sítio | porquê |
|---|---|---|
| tapete do salão | 8,0 × 3,4, centro `x = min(w/2 − rw/2 − 1,5, 2,8)`, `z = min(d/2 − rw/2 − 0,9, max(front + 1,2 + rd/2, d/2 − 3,4))` | campo escuro + moldura de marfim + filete de latão: o marfim das poltronas e o latão precisam de fundo |
| soleira | do lado de fora do tapete | o gesto de entrada |
| 2 poltronas | `x = rx ± 2,35`, viradas umas para as outras | assento 0,42, encosto 1,15 — altura de gente |
| mesa redonda | centro do tapete, tampo de latão a 0,60 | |
| candeeiro de braço | fuste 2,46 no bordo do tapete, cúpula sobre a mesa | **é a peça que se vê por cima das secretárias** |
| 2 candeeiros de pé | `x = ±(w/2 − 1,8)`, `z = rz − 2,4`, 1,90 | luz nos corredores |
| aparadora | `x = −(w/2 − 0,95)`, `len = min(d·0,42, 7,5)` | o corredor esquerdo |
| árvore | canto `(w/2 − 2,1, d/2 − 2,2)`, `scale 1,12` | o canto que a câmara vê, e não é a planta da sala |

**Porque não há quadros nem galerias.** A câmara vê a sala pela diagonal `(+x, +z)`; as duas paredes
fechadas ficam **atrás** das secretárias. Um quadro a 2,35 numa parede a `z = −d/2 + 0,62` fica
escondido pelos monitores — a primeira tentativa (rev. 1 do adereço) pôs lá uma galeria e o render
mostrou o problema. O que se investe é o **chão**, o **remate das paredes** e o que é **alto** nos
corredores.

**Modo escuro.** `setDark()` trata os part novos: `wallTrim`/`dressMetal`/`wallSign`/`floorInlay` vão
para latão velho `#7A6242`, `wallCap` para `#2B2C2A`, o vidro escurece sobre a própria cor,
`dressRug` → `#2C2C31`, `dressIvory` → `#6F6C63`, `dress` → `#26272C`, e a cova/cúpula sobem 50–60 %
de emissão.

**Retratos do processo.** `docs/salas-antes.png` e `docs/salas-depois.png` — a mesma sala (MEDIA),
antes e depois, **rasterizados em node** (`tools/room.mjs` + `tools/raster.mjs`, câmara ortográfica
igual à da app). Não são capturas do browser: o Chromium não corre neste ambiente. Servem para
comparar composição, não para julgar luz, vidro ou sombras — isso só no browser.

**Inspecção.** `window.CC.office.dressing` devolve, por sala, `rug`, `lamps`, `table`, `console`,
`pendant` e `tree` — é o que o `test:scene` lê para provar que o adereço está lá e que não estorva.

## O que prova o quê

- `npm run test:office` — `office.test.mjs`, 31 testes puros: matemática de cor, famílias,
  derivação das camadas, as invariantes dos dados (7 pods, 35 agentes, um chefe por sala,
  duas pessoas na mesma secretária, `officeProblems()` vazio) e **a forma das plantas**: a folha
  estreita-engorda-acaba-em-bico, a dobra e a queda, a cor variável, o pecíolo que afina, a
  planta leve e determinística, e as duas espécies distintas — e **a secretária**: a tela e a
  moldura que o `main.js` espera, o LED na cor da sala (em três salas diferentes), o halo aditivo
  sem escrita de profundidade, o corpo preto, as três variantes determinísticas e o limite de
  malhas por posto.
- `npm run test:scene` — carrega o bundle num DOM com WebGL falso, corre o ciclo de desenho e
  **lê o material que ficou desenhado** (`window.CC.office.floors`): 7 pods, 4 camadas cada, a
  laje translúcida, e cada uma das seis famílias presente exactamente uma vez, com o centro em
  vidro fosco. Também as **7 plantas** (duas espécies, altura razoável, nenhuma folhagem a sair do
  pod) e as **35 secretárias**: cada uma com LED na cor emissiva exacta do vidro da sua sala, corpo
  preto, halo, e a costura da cadeira na mesma cor.
- `npm run check` — o servidor, as rotas, a sessão, o SSE.

## Código sem uso, declarado

`src/builders.js` é um catálogo e ainda tem peças que a cena actual não chama: `makeHolo`,
`makeServerRack`, `makeMeetingTable`, `makeNeuralBrain` e `makeFloorTitle` (os títulos de chão
saíram quando os cartões passaram a nomear as salas). Ficam no catálogo, não são chamadas, e o
teste de cena prova que nada por lá rebenta. Nada disto está importado no `main.js`.
