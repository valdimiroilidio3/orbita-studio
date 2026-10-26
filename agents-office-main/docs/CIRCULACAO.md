# A circulação — como esta empresa se mexe

> Pedido do dono: *«cria corredores na direcção do Cérebro, que será onde as pessoas vão passar os
> projectos para a outra equipa pegar e continuar, ou um lugar onde vão partilhando ideias,
> ajudando-se para melhor entrega de trabalho. Então o Cérebro vira uma sala futurística, coisa de
> outro mundo, rodeada de LED. Mantém o globo em destaque, como um ponto onde cada chefe da
> equipa/grupo se reúne. Isso significa que deves criar movimentos para cada chefe do grupo: quando
> tiver dúvida ou quiser pedir ajuda, dirige-se à sala do Cérebro (sala master). Quando peço algo
> através do chat, o chefe deve estar na sala, depois vai à sala dele, explica ao grupo, criam — e
> vão-se ajudando. Agindo como 100% de pessoas normais numa empresa de engenharia informática.»*

A ideia, arrumada como uma equipa sénior a arrumaria: **um único circuito, duas regras, três gestos.**

## 1 · O circuito

```
        ┌──────────────┐          corredor          ┌───────────────────────────┐
        │   A SALA     │ ─────────────────────────► │        O CÉREBRO          │
        │ 35 secretárias│ ◄───────────────────────── │  praça + anel de LED      │
        │ chefe + grupo │     o mesmo corredor       │  6 púlpitos (1 por sala)  │
        └──────────────┘                            │  o orbe no centro         │
              ▲                                     └───────────────────────────┘
              │                                                ▲
              └──────────── os seis corredores chegam aqui ────┘
```

- **Cada sala tem uma porta** no MEIO do pano que dá para o Cérebro (1.13.1: era no canto, onde não
  cabe uma porta). Três salas têm-na num vão aberto na parede; as outras três, no bordo aberto. É por
  ali que se entra e se sai — não há paredes a atravessar.
- **O corredor** tem piso ao nível das salas, guardas de latão dos dois lados e **uma linha de LED
  na cor da sala**, com a luz a correr sempre **para o Cérebro**. Lê-se a direcção do trabalho.
- **O Cérebro é uma sala, não um objecto**: uma praça de latão, um aro de LED a fechar o perímetro,
  três colunas com colar de luz, e **seis púlpitos — um por sala — com a cor dessa sala** na aresta e
  no ecrã. O orbe continua a ser o centro: sobe-se para ele, não se passa por ele.

## 2 · As duas regras

**Regra 1 — ninguém se mexe sem trabalho real.** Os sinais vêm da base de dados, não de um relógio:

| o que acontece na base de dados | o que se vê na cena |
|---|---|
| uma tarefa **começa a correr** numa sala | o chefe levanta-se, vai ao Cérebro **buscar o pedido**, volta e explica ao grupo |
| alguém fica **à espera de uma decisão** | o chefe levanta-se, vai ao Cérebro **pedir ajuda**, volta e conta o que trouxe |
| uma tarefa **acaba de correr bem** | o chefe leva o trabalho ao Cérebro — é o **passar o projecto** — e volta ao posto sem discurso |
| nada acontece | ninguém anda. Ficam sentados, a trabalhar ou à espera |

Um sinal é identificado pelo **id do trabalho**: o mesmo pedido nunca manda o chefe andar duas vezes.
Sinais com mais de 25 s são descartados (já não interessam). Cada chefe tem 9 s de descanso entre
viagens — para não parecer um vaivém.

**Regra 2 — o gesto é a representação de um facto, não o facto.** A caminhada não muda o estado de
nenhuma tarefa, não inventa progresso, não escreve no registo do trabalho. Quem lê o terminal vê a
verdade; quem olha para a cena vê a verdade com pernas.

## 3 · Os três gestos

```
 ① BUSCAR (brief)          ② PEDIR AJUDA (help)      ③ ENTREGAR (handoff)
 tarefa nova na sala        alguém à espera de OK      tarefa acabada
 ─────────────────          ────────────────────       ───────────────────
 sala → Cérebro             sala → Cérebro             sala → Cérebro
 3,0 s no anel, virado      2,4 s no anel, virado      2,2 s no anel
   ao orbe                    ao orbe                  Cérebro → sala
 Cérebro → sala             Cérebro → sala             vai a pé até à cadeira
 topo da sala, 3,2 s        topo da sala, 2,0 s        (sem discurso)
 explica ao grupo           conta o que trouxe
 ─────────────────          ────────────────────       ───────────────────
 🧠 ao chegar               🤝 ao chegar               📦 ao sair · 🏁 ao chegar
 o GRUPO levanta-se         o GRUPO levanta-se         o grupo continua a
 e vira-se para ele         e vira-se para ele         trabalhar

 Em todos: o último troço é SEMPRE a pé até à secretária — nunca há teleporte.
```

Enquanto o chefe explica, **o grupo levanta-se** — os agentes daquela sala põem-se de pé, viram-se
para ele e ouvem (pose `listen`: braços ao lado do corpo, cabeça voltada a quem fala). Depois cada um
volta ao seu posto. É o «vai à sala dele e explica ao grupo» do pedido: o grupo existe, e ouve.

Dois chefes de salas diferentes podem estar no anel ao mesmo tempo — o `crew` não bloqueia um chefe
porque outro está ocupado. É assim que duas equipas se cruzam no Cérebro.

## 4 · O percurso, ao pormenor

```
   secretária do chefe (fundo da sala)
        │  sobe pelo eixo central entre as duas colunas de secretárias
        ▼
   topo da sala  ──  o sítio de quem fala para o grupo (x = 0, 1,35 m à frente das secretárias)
        │
        ▼
   porta (o meio do pano virado ao Cérebro: um vão na parede, ou o bordo aberto)
        │  corredor: piso, guardas de latão, LED a correr
        ▼
   chegada ao Cérebro  (aro de latão no fim do corredor)
        │
        ▼
   o púlpito da sala, no anel, virado ao orbe
```

O eixo central é escolhido porque é o único corredor da sala que não atravessa uma secretária: as
duas colunas ficam a ±4,3 m. O chefe nunca «passa por cima» de uma mesa.

## 5 · Onde vive cada coisa

| ficheiro | o que faz |
|---|---|
| `src/crew.js` | a coreografia: sinais, percursos, fases, tempos, o grupo a ouvir |
| `src/builders.js` → `makeMasterHall` | a praça, o aro de LED, as colunas e os seis púlpitos |
| `src/builders.js` → `makeWalkway` | o corredor: **passadeira preta rolante**, guardas de latão, LED e aro de chegada |
| `src/builders.js` → `makeRoomEntrance` | a porta de cada sala (aro, folhas, placa, luz), na cor daquele vidro |
| `src/builders.js` → `makeRoomWalls` | a calha de LED e a luz que corre no vidro |
| `src/main.js` | liga os sinais reais (`syncFromLive`) ao `crew`; anima as faixas de LED |
| `src/avatar.js` | a pose `listen` (o grupo a ouvir) |

O `crew` recebe os sinais **do main**, que é quem fala com a base de dados. A regra é essa: o `crew`
não sabe o que é uma tarefa; sabe andar, parar, virar-se e explicar.

## 6 · Limites declarados

- **Não há procura de caminho.** Os percursos são rectas entre pontos fixos (eixo central, porta,
  corredor, anel). Funciona porque a sala tem um corredor central livre; não é um motor de navegação
  e não serve para uma planta arbitrária.
- **Não há colisões entre pessoas.** Dois agentes podem cruzar-se. Só há um caso tratado: o chefe que
  está no púlpito fica lá até acabar o tempo dele.
- **O grupo levanta-se e ouve; não fala.** Não há conversa entre agentes (não há motor de IA ligado
  nesta máquina). O que existe é a postura — e a postura não finge conteúdo.
- **O LED acelera com trabalho real** (`deptCount('live') + deptCount('waiting')`). Sem trabalho, a
  luz continua a passar devagar: é ambiente, não é telemetria.
- **A coreografia é entre o chefe e a sala dele.** A passagem de um projecto *de* uma equipa *para*
  outra acontece no Cérebro (é lá que os chefes se cruzam), mas não há um estado «entregue a outrem»
  inventado no registo do trabalho: quando existir essa informação na base de dados, ela entra aqui.

## 7 · Como se prova

`node scene.smoke.mjs` — o teste de cena monta o escritório num DOM com WebGL falso, dispara um
sinal **real** de trabalho e acompanha o ciclo completo com `CC.stepSim`:

```
✓ 18 faixas de LED (3 por sala) · corredores com guardas em 6 salas
✓ sala-mestre com 6 lugares de chefe e um aro de 7,1 de raio
✓ o chefe levanta-se, chega ao Cérebro, volta, explica, o grupo levanta-se
✓ entrega o trabalho acabado ao Cérebro e volta a pé para o lugar
✓ o mesmo trabalho não o manda andar duas vezes
```

E `node tools/master.mjs` desenha a sala-mestre com o rasterizador caseiro (sem browser):
`docs/cerebro-sala.png`.

## 8 · As passadeiras e as entradas (1.13.0)

O dono pediu duas coisas que se vêem de longe: *«passadeiras rolantes no corredor, preta»* e
*«entradas na sala (roxa, azul e amarela)»*.

### A passadeira

O corredor deixou de ter uma linha de luz por cima de uma laje. É agora uma passadeira de aeroporto
com quatro peças:

| peça | o que é |
|---|---|
| tapete | laje preta `#23252B` com uma **textura de ripas** (64×64, gerada uma vez e clonada por corredor) |
| guardas | dois perfis de latão em cada lado, com folga para o pé |
| LED | um canal aceso no centro, na cor da sala, com a luz a percorrer para o Cérebro |
| chegada | um aro de latão fundido nas guardas, no extremo do Cérebro |

**O movimento é real**: o `offset.x` da textura de ripas desloca-se a cada frame
(`ledSpeed = −0,62`), com `repeat.x = comprimento / 1,15` para as ripas ficarem à escala de um
corredor de 2 a 10 m. A sala com trabalho (`live` + `waiting`) anda 2,6× mais depressa — as faixas de
LED e os tapetes partilham a lista `ledRT` do `main`.

Como a passadeira é feita num grupo rodado (`−atan2(dz, dx)`), o tapete rola sempre **no sentido do
Cérebro**, seja qual for a sala.

### A entrada (redesenhada em 1.13.1)

A primeira porta tinha dois defeitos que se viam de longe: o `rboxGeo` cresce a partir da BASE e os
montantes foram colocados a meia altura (a porta flutuava), e o pórtico estava 1,1 m à frente da
parede, num canto onde não cabe uma porta. O que está agora:

| peça | medida | para quê |
|---|---|---|
| aro de latão | 2,84 × 2,64, perfil 0,12 × **0,24 de fundo** | a espessura é o que faz ler «porta» e não «moldura» |
| vão livre | **2,60 × 2,18** | passa uma pessoa com folga; a altura é de porta, não de portal |
| folhas | 2 × 1,35 de vidro fosco (opacidade 0,26) | abrem **ao meio**, 0,45 cada, como uma porta automática |
| puxadores | barra vertical de latão, 0,94 | no bordo de ataque das duas folhas |
| carril + bolsos | 0,11 de altura, 2 postes nas pontas | a folha deslizada recolhe no bolso, não fica pendurada |
| placa | 1,12 × 0,26, duas faces | o **nome da sala**, desenhado em canvas na cor do vidro |
| luz | cova sob a padieira (2 lados + vão), 2 filetes no piso, mancha no corredor | a entrada acende o chão à frente |
| barra de topo | na cor da sala | é o que se vê da câmara isométrica, que olha o escritório de cima |

**A parede abre-se para a porta.** `makeRoomWalls` recebe `opening: {x, w, h}` e parte o pano de fundo
(-z) em dois troços, com verga por cima, rodapé partido e ripaado que não atravessa o vão. O `main`
decide: se o corredor sai pelo pano de fundo (`sz > 0`), a sala ganha vão e a porta assenta na face
interior da parede, com um aro de latão na face do corredor; se sai pelo bordo aberto, a porta fica de
pé nesse bordo. As medidas da parede e da porta vivem em `WALL` e `DOOR`, em `src/builders.js` — os
dois ficheiros que as usam não se falam, e foi por isso que a primeira versão ficou 10 cm ao lado.

O pórtico fica em `deptRT[k].entrance` e em `entranceRT`, e é clicável (foca a sala).

### Provas

`node scene.smoke.mjs` verifica, sem olhos:

```
✓ 6 passadeiras rolantes pretas nos corredores (#23252b)
✓ o offset do tapete muda entre dois passos da simulação (rola mesmo)
✓ 6 entradas de sala na cor da sala (verde · amarelo · vermelho · roxo · azul · azul-céu)
✓ contorno de 2,7–3,2 m, vão livre ≥ 2,4 × 2,0, duas folhas abertas > 0,3
✓ a placa de cada porta diz o nome da sala (DEPTS[k].short)
✓ 3 salas com vão na parede (≥ 2,8 × 2,2) e 3 com a porta no bordo aberto
```

Os desenhos do rascunho (sem emissão — o rasterizador caseiro não faz luz) estão em
`docs/porta-sala.png`, `docs/porta-corredor.png` e `docs/porta-na-sala.png`.

A cor de cada entrada é comparada com `DEPTS[k].glass` — se alguém pintar um pórtico à mão, o teste
falha.

### Limites

- **Não há textura normal-mapped**: as ripas são cor, não relevo verdadeiro. À distância lê-se; ao
  lado, é um tapete com riscas.
- **O tapete não move ninguém.** Os chefes andam a pé pelo corredor; a passadeira é cenário animado,
  como num aeroporto onde alguém prefere andar.
- O rasterizador caseiro (`tools/raster.mjs`) não tem emissão nem texturas: serve para ver a
  geometria do pórtico, não o LED.
