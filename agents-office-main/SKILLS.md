# Ensinar aos agentes como trabalhas

De fábrica, um agente sabe três coisas: a sua descrição de funções numa linha, as tuas notas e uma
regra da casa para entregar um trabalho acabado. Isso dá-te uma resposta genérica competente. Não
te dá *a tua* proposta, *a tua* resposta a um cliente, *o teu* relatório semanal. Para isso dizes
ao agente como se faz o trabalho, e há duas maneiras de o fazer.

| | Um briefing | Uma competência |
|---|---|---|
| O que é | Algumas frases permanentes sobre um agente | Uma pasta: como se faz um tipo de trabalho, mais modelos e exemplos |
| Onde vive | `office.agents.local.json`, ou `<cérebro>/Órbita/agents.json` | `<cérebro>/Órbita/skills/<nome>/` |
| Lido quando | Em cada tarefa e cada conversa desse agente | Em cada tarefa e cada conversa dos agentes a que está ligada |
| Serve para | Tom, linhas vermelhas, a quem escalar, uma ferramenta preferida | Um trabalho repetível com passos, uma forma, regras e um modelo |
| Tamanho | Até 2 000 caracteres | SKILL.md até 6 000 caracteres, mais até 8 000 nos ficheiros ao lado |

Usa um briefing quando cabe num parágrafo. Usa uma competência quando entregarias um documento a
alguém que acabou de chegar. Ambos podem ser escritos à mão ou pelo Claude Code nesta pasta (ver o
fim desta página).

## Briefings

Acrescenta um `brief` a qualquer agente. É lido antes de cada tarefa e de cada conversa.

```json
{ "agents": [
  { "id": "piper",
    "brief": "Todas as propostas têm três opções e recomendamos a do meio. Preços sem GST, por mês. Nunca dar desconto: uma opção mais barata é um âmbito menor. Se o cliente pedir algo que a escada de ofertas não tem, cota-o como (preço a confirmar) e assinala-mo." }
] }
```

Um briefing pode ser uma lista de linhas em vez de uma só string. Os briefings são relidos antes de
cada tarefa, por isso não há nada a reiniciar.

## Competências

Uma competência é uma pasta com um `SKILL.md` e tudo o que o agente precise ao lado. Tem a mesma
forma de uma competência do Claude Code, por isso se já escreveste uma, já sabes isto.

```
<cérebro>/Órbita/skills/
  proposta/
    SKILL.md          ← o quê, quando, os passos, as regras
    template.md       ← a forma da coisa acabada
    example.md        ← um exemplo real de que gostaste
```

O `SKILL.md` começa com um bloco de front matter, depois as instruções em Markdown simples:

```markdown
---
name: proposta
description: Como escrevemos uma proposta a um cliente
agents: [piper]
---
# Escrever uma proposta

Usa isto para qualquer pedido que termine num documento a que o cliente diz sim ou não.

## Antes de escrever
1. Encontra o cliente em `30-Clientes`. Se não estiver lá, di-lo no topo.
2. Tira pacotes e preços de `10-Negocio/escada-de-ofertas.md`. Nunca inventes um preço.

## A forma
Segue o `template.md` ao lado deste ficheiro, secção a secção.

## Regras
- Três opções, sempre. Recomenda a do meio.
- Uma página. Se não couber, corta no enquadramento, não no âmbito.
```

**Ligação.** `agents: [piper]` liga-a a um ou mais agentes por id (os ids estão em
`office.agents.json`). `departments: [emails]` liga-a a todos os agentes de um departamento. Nenhum
dos dois significa que todos os agentes a recebem, o que está certo para um estilo da casa e errado
para quase tudo o resto. Uma competência cujos agentes ou departamentos estejam todos mal escritos
é ignorada, e o `npm run check` di-lo.

**Ficheiros ao lado do SKILL.md.** Os agentes não têm ferramentas de ficheiros, por isso todos os
ficheiros legíveis na pasta (`.md`, `.txt`, `.csv`, `.json`, `.yaml`, `.html`) são colocados à
frente do agente com a competência. Os outros ficheiros são listados apenas pelo nome. Mantém a
pasta no que o agente precisa: um modelo, um ou dois exemplos, uma lista de verificação. Não o
arquivo inteiro.

**Onde.** As tuas competências vão para `<cérebro>/Órbita/skills/` (o cérebro é a pasta indicada em
`office.config.json`). Vivem com as tuas notas, são guardadas com as tuas notas, e um `git pull`
nunca lhes toca. A pasta `skills/` do repositório guarda três exemplos para o estúdio de
demonstração; uma competência com o mesmo nome no teu cérebro substitui a incluída.

**Quando entra em vigor.** Imediatamente. As competências são relidas do disco antes de cada tarefa
e de cada conversa. O `npm run check` valida-as; http://localhost:4520/api/skills mostra o que está
carregado e quem tem o quê.

## Deixa o líder entrevistar-te

A via mais rápida para um primeiro briefing e competência é o líder do departamento perguntar-te.
Clica num líder (a secretária com estrela em cada grupo; onde um departamento não tem líder, o seu
primeiro agente faz isto) e diz **configurar**. Cinco perguntas, uma de cada vez:

1. O que faz este departamento aqui, nas tuas palavras? O que entra, o que sai, para quem?
2. O trabalho que fazes mais vezes, do princípio ao fim.
3. Como é um bom resultado. Cola um de que gostaste, ou descreve as secções.
4. O que nunca pode acontecer. Linhas vermelhas, coisas que esperam sempre por ti.
5. Que ferramentas e pessoas estão envolvidas.

Responde por palavras simples. «saltar» salta uma pergunta, «terminar» acaba mais cedo, «cancelar»
deita fora as respostas. Nada é escrito até à última resposta. Depois o líder escreve:

- um **briefing** para cada agente da sua equipa que as respostas tocaram, em
  `<cérebro>/Órbita/agents.json`, juntando ao que já lá está;
- uma **competência** para o trabalho que descreveste, em `<cérebro>/Órbita/skills/<nome>/`, com um
  `template.md` se lhe deste uma forma;

e responde com o que escreveu, onde, e uma tarefa para escrever e experimentar. Tudo o que escreve
é um ficheiro normal que podes editar. Corre-o outra vez quando quiseres; os briefings são
substituídos e uma competência existente com o mesmo nome fica ao lado da nova como cópia de
segurança. Um líder cujo departamento ainda não tem nada teu diz isso na saudação e oferece a
entrevista.

## Eles aprendem com as tuas correções

Quando devolves um trabalho com `revise: …` na conversa, o agente revê-o e a correção é escrita em
`<cérebro>/Órbita/feedback/<id-do-agente>.md`. O Claude classifica cada uma:

- uma **pontual**: sobre aquela tarefa, aquele cliente, aquele rascunho («acrescenta a integração de
  reservas»);
- uma **regra permanente**: algo que vais querer sempre («demasiado longo, as propostas são uma
  página» torna-se *Mantém todas as propostas numa página*).

As regras permanentes são lidas por esse agente antes de cada tarefa e de cada conversa, as mais
recentes por último, no máximo as quinze mais recentes. O ficheiro é Markdown simples com duas
secções, «Regras permanentes» e «Pontuais», uma linha cada. É teu: reescreve uma regra, apaga uma
linha para a desaprender, sobe uma pontual para a promover. http://localhost:4520/api/lessons mostra
o que cada agente aprendeu.

As lições servem para preferências. Quando uma regra se torna um processo com passos e uma forma,
pertence a uma competência: abre o Claude Code nesta pasta e diz «incorpora as lições do agente de
Propostas na competência de proposta».

## O que o agente vê

Para uma tarefa, as instruções do agente são montadas por esta ordem:

1. Quem é: nome, função, o que faz.
2. O seu briefing, se tiver um.
3. Todas as competências ligadas a ele, por inteiro, com os ficheiros ao lado de cada uma.
4. As suas regras permanentes saídas das tuas correções.
5. As ferramentas que pode chamar.
6. O `CLAUDE.md`, `index.md`, `business-model.md` e `voice.md` do teu cérebro, se existirem.
7. As notas que escolheu para esta tarefa.

Uma competência ou um briefing substitui a forma por omissão (curta, menos de 260 palavras). O
trabalho termina com uma linha que nomeia a competência seguida, e a nota guardada no teu cérebro
regista-a no seu front matter, para veres mais tarde que trabalho foi feito segundo que competência.

O encaminhador também vê os nomes das competências de cada agente, por isso uma tarefa que diga
«escreve a proposta para a Harbourside» acaba no agente que é dono da competência de propostas.

## Escrever bem uma

- **Diz quando.** A primeira linha depois do título é o gatilho: «Usa isto para qualquer pedido que
  termine num documento a que o cliente diz sim ou não.» O agente faz corresponder tarefas a
  competências por isto.
- **Passos, depois a forma, depois as regras.** O que ler primeiro, como é a coisa acabada, o que
  nunca é permitido. Um ficheiro modelo vale mais do que a descrição de um modelo.
- **Aponta as notas pelo nome.** «Os preços vêm de `10-Negocio/escada-de-ofertas.md`» faz o agente ir
  lê-lo. «Usa o nosso preçário» não.
- **Um exemplo real.** Um `example.md` de um de que gostaste faz mais do que uma página de
  adjetivos.
- **Mantém as linhas vermelhas curtas e absolutas.** «Sem descontos.» «Nada para fora sem o
  proprietário.»
- **Uma competência por tipo de trabalho.** Uma competência de propostas, uma de resposta a
  clientes, uma de relatório semanal. Não uma competência gigante de «vendas».

## Transformar o que já tens numa competência

A maioria das empresas já tem o material: um procedimento num documento Word, um e-mail que andas
sempre a copiar, um relatório que fizeste no trimestre passado, uma lista de verificação na parede.
O caminho mais rápido é dar isso ao Claude Code nesta pasta e deixá-lo escrever a competência.

```
claude
> Aqui está a proposta que enviei à Harbourside e de que gostei (cola, ou aponta o ficheiro).
  Transforma-a numa competência para o agente de Propostas: a forma como modelo, as regras que
  sigo, e mantém esta como exemplo.

> As nossas regras de resposta a clientes estão em ~/Documentos/procedimento-apoio.docx. Faz delas
  uma competência para todo o departamento de E-mails.

> Todas as segundas quero um relatório de operações de uma página: as entregas da semana passada,
  o que está atrasado, os riscos desta semana. Faz uma competência de Relatório Interno que produza
  exatamente isso.
```

O Claude lê o `CLAUDE.md`, pergunta o que não sabe, escreve a pasta em `Órbita/skills/` do teu
cérebro, liga-a ao agente certo e corre o `npm run check`. Depois dá a tarefa ao agente e lê o
resultado. Devolve-o com `revise: …` na conversa e, quando a correção for algo que vais querer
sempre, incorpora-a na competência.

## Verificar que funcionou

- O `npm run check` lista todas as competências, a quem estão ligadas e todos os problemas em frases
  simples.
- O `npm start` imprime a contagem no arranque e que departamentos estão configurados;
  http://localhost:4520/api/skills mostra o detalhe, `/api/lessons` as correções.
- Dá ao agente uma tarefa que a competência cubra. O trabalho termina com `Skill: <nome>`.
- Abre a nota guardada em `<cérebro>/Órbita/`. O front matter tem `skills:`.

## Limites e regras

- Um `SKILL.md` acima de 6 000 caracteres é cortado; ficheiros acima de 4 000 caracteres cada ou
  8 000 no total por competência são cortados ou listados pelo nome. Material longo pertence às
  tuas notas, onde o agente o lê quando a tarefa o pede.
- As competências são instruções, não ferramentas. Um agente com uma competência de Gmail ainda
  precisa do Gmail ligado no Claude Code e autorizado em `office.config.json`.
- As competências não podem acrescentar agentes, mudar departamentos ou atribuir ferramentas. Dizem
  como, não quem.
- Uma competência não se sobrepõe à regra permanente: ler livremente; enviar, publicar, pagar,
  apagar ou alterar qualquer coisa fora desta máquina só quando a tarefa pedir explicitamente essa
  ação exata.
