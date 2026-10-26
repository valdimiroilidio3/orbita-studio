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
| Provas | `ops.test.mjs` (`npm run test:ops`) | 12 testes, tudo em memória, sem tocar em serviços |

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
   uma dessas ações escreve em `events` com quem, o quê, quando e sobre o quê.

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
- **Testes A/B de mensagem.** A tabela `messages` já tem tudo o que é preciso (`subject`,
  `body`, `status`, `sent_at`); o que falta é o campo de variante e a escolha da vencedora.
- **Regras aprendidas com correções.** O `learn.mjs` já guarda lições e regras; ligá-las às
  aprovações (rejeitar uma mensagem e a razão virar regra) é o passo seguinte.

## Verificar sem estragar nada

```bash
npm run test:ops     # 12 testes, SQLite em memória, nenhum serviço externo
npm run check        # inclui os testes da operação e um servidor isolado que prova as rotas
```

O `check.mjs` arranca um servidor à parte com `ORBITA_DATA_DIR` e `ORBITA_DB` temporários:
prova as rotas de ponta a ponta **sem tocar nos dados do dono**, e apaga a pasta no fim.

---

*Órbita — criado por Chelton Mahoze.*
