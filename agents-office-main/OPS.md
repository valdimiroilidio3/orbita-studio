# Operação: a base de dados, a fila e o funil

Este documento descreve a camada que transforma o escritório de uma demonstração numa
operação: **os dados ficam guardados**, o trabalho que falha **volta a tentar**, nada sai
**sem o OK do dono**, e tudo deixa **rasto**.

Antes disto, o escritório vivia de ficheiros JSON (`data/leads.json`, `data/tasks.json`) e de
memória. Um reinício perdia trabalho a meio, uma mensagem podia sair sem ninguém a ter lido,
e não havia forma de responder a «quanto gastei este mês?» a não ser a olho.

## O que existe agora

| Peça | Onde | O que faz |
|---|---|---|
| Base de dados | `data/orbita.db` (SQLite, `src/ops/db.mjs`) | Tabelas `leads`, `messages`, `events`, `jobs`, `consents`, `usage`, `meta` |
| Leads | `src/ops/leads.mjs` | Entrada sem duplicados, pontuação com razões, funil, seguimentos, opt-out |
| Mensagens | `src/ops/messages.mjs` | `rascunho → aprovada → enviada`, aquecimento do canal, consumo |
| Fila | `src/ops/queue.mjs` | Trabalho persistente, tentativas com espera crescente, concorrência limitada |
| Métricas | `src/ops/metrics.mjs` | Funil, conversão, custos — com `null` e a razão quando não há dados |
| Gaveta | `src/ops.js` + `◉ OPERAÇÃO` na barra | Ver, aprovar, mudar de estado, ler o rasto |
| **Hoje** | `src/ops/today.mjs` + `src/today.js` + `HOJE` na barra | Um ecrã: decidir, o que aconteceu, o que vem |
| **Outbox** | `src/ops/outbox.mjs` | Envio escrito antes de sair, com chave de idempotência e aluguer |
| **Registo** | `src/ops/events.mjs` | Eventos encadeados por hash; `verify` denuncia a linha mexida |
| Provas | `ops.test.mjs` (`npm run test:ops`) | 17 testes, tudo em memória, sem tocar em serviços |

Não há dependências novas: usa-se o `node:sqlite` que vem com o Node 22.4+ (aparece um
`ExperimentalWarning` no arranque — é do Node, não do Órbita; silencia-se com
`NODE_OPTIONS=--no-warnings`).

## As regras que a camada faz cumprir

1. **Sem duplicados.** A chave é o domínio do site, senão os 9 dígitos finais do telefone,
   senão o email, senão nome+cidade. Um segundo contacto com os mesmos dados **atualiza**
   em vez de criar. O que o dono decidiu (estado, notas, consentimento, seguimento) nunca é
   apagado por uma atualização de dados.
2. **A nota explica-se.** `score` (0–100) vem sempre com `score_reasons`: «sem site (+25) ·
   telefone público (+15) · avaliação 3,8 (+10)». Se não conseguires ler a razão, é
   publicidade — por isso ela fica guardada.
3. **O funil não salta passos.** `novo → contactado → respondeu → reuniao → cliente`, com
   `perdido` em qualquer ponto e regresso a `novo`. De «novo» para «cliente» é recusado.
4. **Nada sai sem aprovação.** Uma mensagem nasce `rascunho`. `POST …/approve` é uma decisão
   do dono. Só uma mensagem `aprovada` pode ser enviada.
5. **O opt-out manda.** Quem pede para parar fica em `consents`; a partir daí qualquer
   mensagem para esse email/telefone fica `bloqueada` — e o lead passa a `perdido` se ainda
   não era cliente.
6. **Aquecimento do número.** O primeiro dia permite poucos envios (`warmup.<canal>.start`),
   a subir por dia (`step`) até um teto (`max`), com limite por minuto
   (`envio.por_minuto`, 6). O limite explica-se na recusa, não é um erro seco.
7. **A fila não perde trabalho.** Cada tarefa é uma linha em `jobs`. Falhou? Volta com espera
   crescente (15 s, 30 s, 1 min… até 1 h) e desiste ao fim de `max_attempts`, deixando o erro
   escrito. O servidor drena a fila sozinho a cada 2 segundos.
8. **Tudo deixa rasto.** Criar, atualizar, aprovar, bloquear, enviar, falhar, retentar — cada
   uma dessas ações escreve em `events` com quem, o quê, quando e sobre o quê. O registo é
   encadeado por hash: uma edição silenciosa denuncia-se.
9. **Um envio nunca acontece duas vezes.** Passa pelo outbox, com chave de idempotência e
   aluguer. Email resgatado depois de um crash não se repete sozinho — vai para revisão.
10. **Há um travão.** O interruptor de emergência pára todos os envios a partir de qualquer
   caminho, e a recusa diz o motivo.

## Eventos, outbox e idempotência (a base que não se vê)

**Eventos em vez de estado.** Cada coisa que acontece é uma linha em `events` — lead encontrado,
mensagem aprovada, resposta recebida, envio recusado. O estado atual (o lead, a mensagem) é o
resumo; o registo é a história, e é ela que dá auditoria e permite refazer análises.

O registo é uma **cadeia**: cada linha leva `prev_hash` e `hash`, calculados sobre os campos e
sobre a linha anterior. Editar uma linha à socapa parte a cadeia, e `GET /api/ops/events/verify`
diz exatamente em que `id` partiu. Não protege de quem reescreva o ficheiro todo — protege de
edições silenciosas, que é o problema real.

**Outbox: o envio é escrito antes de sair.** Uma linha em `outbox` com uma **chave de
idempotência** (id da mensagem + hash do conteúdo). Pedir o mesmo envio duas vezes é pedir uma:
a segunda chamada encontra a chave e não cria nada.

Quem pega num item faz um **aluguer** com prazo (`lease_until`). Se o processo morrer, o aluguer
expira e o item volta a ser pego — trabalho não fica preso para sempre. E há uma regra dura: se
o item for um **email** e tiver sido resgatado depois de um crash, **não é reenviado às cegas** —
vai para `revisao` e espera por uma pessoa. Um envio a menos é melhor do que um cliente a receber
duas vezes. (O link do WhatsApp não tem esse risco: não sai nada da máquina.)

**Interruptor de emergência.** `POST /api/ops/stop` com `{ "stop": true }` e não sai mais nada:
o envio imediato recusa com a frase certa, o outbox drena zero, a gaveta e o `Hoje` mostram o
estado. `{ "stop": false }` retoma. Não apaga nada — só pára.

## Hoje: um ecrã, três perguntas

`GET /api/ops/today` compõe três listas e um estado de presença:

| Bloco | De onde vem | O que responde |
|---|---|---|
| `decidir` | mensagens em `rascunho`/`aprovada`/`revisao` + tarefas prontas sem OK | «o que precisa de ti» |
| `aconteceu` | `events` desde a última visita (24 h na primeira) | «o que aconteceu enquanto dormias» |
| `a seguir` | seguimentos marcados + rotinas do escritório | «o que vai acontecer» |
| `presenca` | tarefas a correr, fila, outbox, interruptor | «quem está a trabalhar» |

Cada cartão traz uma linha **porquê** feita só com dados guardados (as razões da nota do lead, o
canal, o estado). Se não houver dados que cheguem para justificar, o cartão não aparece.

No ecrã (`src/today.js`): deslizar aprova/rejeita, toque longo abre o porquê, `←`/`→` fazem o
mesmo pelo teclado, `Esc` fecha e `H` abre. As decisões são **otimistas** — o cartão sai no
instante e a lista confirma a seguir; se o servidor recusar, o cartão volta com a razão escrita.
Estados vazios ensinam o próximo passo (procurar leads, voltar a ver) em vez de dizer «sem
resultados». Os tokens de design (espaçamento em múltiplos de 4, escala tipográfica, cores
semânticas `--ok/--warn/--risk`, modo escuro e `prefers-reduced-motion`) estão no `:root` do
`src/shell.html`.

## Sem chave nenhuma, já dá para trabalhar

A gaveta **◉ OPERAÇÃO** tem `+ NOVO LEAD` (nome, cidade, telefone, email, site) e, em cada lead,
`ESCREVER` — que abre um compositor com o canal, o assunto e um texto de partida escrito a partir
do que se sabe do negócio (tem site? que cidade?). O rascunho aparece de imediato em **Hoje**, à
espera do teu OK. É o ciclo inteiro sem depender da Google nem de nenhum motor de IA.

## Caixa de entrada e envio

- **Email** exige `RESEND_API_KEY` **e** consentimento registado no lead (`consent: 'dado'`).
  Sem um dos dois, a resposta é uma frase que diz o que falta — não um envio silencioso.
- **WhatsApp** não tem envio automático nesta versão: o servidor prepara o link `wa.me` com
  o texto, o dono revê e envia à mão, e só depois carrega em **JÁ ENVIEI** (`…/confirm`). O
  Órbita não finge que enviou.
- As rotas que escrevem para fora exigem `ORBITA_API_TOKEN` (32+ caracteres) no `.env`.

## Endpoints

Todos devolvem JSON `{ ok, … }`. Os erros trazem uma frase em português.

| Método | Rota | Para quê |
|---|---|---|
| GET | `/api/ops/summary` | Leads, funil, conversão, mensagens, custos, estado da fila |
| GET | `/api/ops/leads?limit=&status=` | A lista, ordenada por nota |
| POST | `/api/ops/leads` | Um lead (`{…}`) ou vários (`{ leads: [...] }`) |
| PATCH | `/api/ops/leads/:id` | Mudar de estado no funil (`{ status, note }`) |
| POST | `/api/ops/leads/:id/consent` | Registar consentimento (`{ consent, reference }`) |
| POST | `/api/ops/leads/:id/follow-up` | Marcar quando voltar a falar (`{ when }`) |
| POST | `/api/ops/leads/importar-gravados` | Trazer para a base de dados o que está em `data/leads.json` |
| GET | `/api/ops/messages?status=` | Mensagens com o lead |
| POST | `/api/ops/messages` | Criar rascunho (`{ leadId, channel, subject, body }`) |
| POST | `/api/ops/messages/:id/approve` · `/reject` | A decisão do dono |
| POST | `/api/ops/messages/:id/send` · `/confirm` | Enviar (email, com token) · confirmar envio manual (WhatsApp) |
| POST | `/api/ops/consent/opt-out` | `{ email }` ou `{ phone }` — bloqueia para sempre |
| GET | `/api/ops/queue` | Estado da fila e os últimos trabalhos |
| POST | `/api/ops/queue/tick` | Correr agora o que está devido |
| GET | `/api/ops/events?limit=` | A auditoria |
| GET | `/api/ops/usage?days=` | Consumo e custo por fornecedor |
| GET | `/api/ops/today` | O ecrã Hoje: decidir, aconteceu, a seguir, presença |
| POST | `/api/ops/stop` | Interruptor de emergência (`{ "stop": true \| false }`) |
| GET | `/api/ops/outbox` | Fila de saída com tentativas, alugueres e revisões |
| GET | `/api/ops/events/verify` | Verifica a cadeia de hashes do registo |

A pesquisa da Google (`/api/google/search`) continua a guardar na gaveta e **passa a gravar
também na base de dados**, já pontuado e sem duplicados. A resposta traz `baseDeDados` com
`{ created, updated, refused }`.

## O que ainda não está — dito por palavras

- **Servidor de base de dados em rede.** Isto é SQLite num ficheiro: um servidor, um dono.
  Para várias máquinas o caminho é Postgres/Supabase — o esquema está versionado em
  `meta.schema_version` (`SCHEMA_VERSION` em `src/ops/db.mjs`), para a migração ser escrita,
  não adivinhada.
- **Cobranças.** Não há Stripe nesta versão. `receita_centimos` é um número que o dono
  escreve; a margem é receita menos custo de API, e é isso que a gaveta mostra.
- **Envio real de WhatsApp Business.** Falta a conta Meta, o número aprovado e o token.
  Enquanto não existir, o caminho é o link revisto à mão.
- **Testes A/B de mensagem.** (por fazer) A tabela `messages` já tem tudo o que é preciso (`subject`,
  `body`, `status`, `sent_at`); o que falta é o campo de variante e a escolha da vencedora.
- **Regras aprendidas com correções.** O `learn.mjs` já guarda lições e regras; ligá-las às
  aprovações (rejeitar uma mensagem e a razão virar regra) é o passo seguinte.

## Verificar sem estragar nada

```bash
npm run test:ops     # 17 testes, SQLite em memória, nenhum serviço externo
npm run check        # inclui os testes da operação e um servidor isolado que prova as rotas
```

O `check.mjs` arranca um servidor à parte com `ORBITA_DATA_DIR` e `ORBITA_DB` temporários:
prova as rotas de ponta a ponta **sem tocar nos dados do dono**, e apaga a pasta no fim.

---

*Órbita — criado por Chelton Mahoze.*
