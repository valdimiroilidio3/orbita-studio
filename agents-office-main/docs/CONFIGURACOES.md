# Configurações — o que é real, onde fica, e o que não é

Tecla **`,`** (ou o botão **Config**, na barra de cima). Quatro secções: **Tema**, **APIs**, **Avisos**
e **Painéis**.

## Tema

| escolha | o que faz |
|---|---|
| Claro | o escritório em papel — é o desenho original |
| Escuro | a cena escurece (vidros mais fundos, luzes mais intensas, latão velho) e a interface segue |
| Automático | segue o sistema (`prefers-color-scheme`), e acompanha mudanças ao vivo |

Fica guardado no browser (`orbita.tema`). A tecla `D` continua a funcionar: agora escolhe **e guarda**.
O endereço `/dark` e `#dark=1` continuam a abrir forçado em escuro, sem mexer na preferência.

## APIs

O painel lê `GET /api/platform/apis` — o catálogo verdadeiro do servidor, com o estado de cada
serviço (**pronta** só depois de uma sonda responder; **com chave** quando há chave mas ainda não há
sonda; **sem chave** com o nome da variável que falta).

Para ligar um serviço:

1. cola a chave no campo com o nome da variável (`OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, …);
2. **Guardar e testar**.

O que acontece, por esta ordem: a variável é validada contra o serviço → é escrita no `.env` da
máquina (o resto do ficheiro fica intacto: comentários, ordem, outras chaves) → o `platform` relê o
`.env` sem reiniciar → faz a sonda real desse serviço → devolve **HTTP, latência e erro reais**.
Não há «guardado com sucesso»: há o que o serviço respondeu.

**Apagar chave** remove as variáveis desse serviço do `.env` (valor vazio = apagar).

### Segurança, dita sem rodeios

- `POST /api/platform/key` **só aceita pedidos de loopback** (`127.0.0.1` / `::1`) — ou com o
  `ORBITA_API_TOKEN`. Escrever chaves é um acto local: o site publicado não tem esta rota.
- A resposta **nunca** inclui o valor da chave. Os erros são limpos com o mesmo `redactValue` das
  sondas: se o serviço devolver a chave na mensagem de erro, ela sai como `***`.
- Uma variável que não pertença ao serviço é recusada (`STRIPE_SECRET_KEY não pertence a OpenRouter`).
- As chaves ficam no `.env` (fora do Git: `.gitignore` → `.env*`) e **nunca** no browser nem em
  `localStorage`.

## Avisos

Notificações do browser. A permissão pede-se **aqui**, num clique — nunca no arranque (pedir ao abrir
é a forma mais rápida de ficar bloqueado para sempre).

O que gera um aviso: um posto que fica **à espera do teu OK** (`waiting`) e um posto que **falhou**
(`error`) — lidos do mesmo SSE que acende os monitores. Regras:

- o primeiro retrato do servidor é o ponto de partida (não há avisos por trabalho já parado);
- só conta a **mudança** de estado, não o estado;
- o mesmo aviso não se repete dentro de **60 s**;
- no máximo **3** por cada actualização.

Sem servidor o interruptor aparece desligado e explica porquê: não há trabalho a acontecer, logo não
há nada para avisar. Nada é simulado.

## Painéis

- **Campo de IA recolhido** — a caixa de conversa fica numa linha («abrir campo ▴»); a conversa
  continua visível.
- **Estado das tarefas recolhido** — a coluna da direita passa a um botão no canto.

A escolha fica guardada (`orbita.paineis`). Num ecrã com menos de 640 px a coluna das tarefas nasce
recolhida — no telemóvel tapava meia cena — e todas as janelas (Leads, Operação, Configurações) passam
a ocupar o ecrã, com fechar de 44 px.

## Sem servidor (o site publicado)

O que é do browser funciona: **tema**, **painéis** e o interruptor dos avisos (que fica em baixo,
porque não há trabalho que os gere). O que precisa da máquina **não finge**: a secção das APIs diz que
as chaves vivem na máquina onde o Órbita corre e que é preciso `npm start` para as gravar e sondar.
