# ALVO 1.0 · o alvo de trabalho oficial

**Produto:** Órbita Studio · **Origem:** 1.53.2 (`6843eb8`, produção PROMOTED) ·
**Alvo:** `1.0.0` · **Escrito:** 29 out 2026 · **Dono:** valdimiroilidio3

> **Este documento é a ordem de trabalho.** Não é uma ideia nem um roadmap de
> gaveta: é a lista fechada do que falta, por ordem, com prova exigida em cada
> item. O `docs/PROMPT-1.0.md` diz *porquê*; **este diz *o quê e em que ordem***.
> A partir de agora, cada ciclo de trabalho começa por abrir este ficheiro,
> escolhe o primeiro item não-feito da vaga actual, e termina com o item marcado
> e a prova anexada.

---

## 1 · O alvo, numa frase

> Uma pessoa que nunca viu a Órbita entra, cria conta, liga uma chave, importa
> 50 leads, corre uma tarefa, faz o vídeo de um cliente, envia a mensagem e vê a
> receita entrar — **sozinha, em menos de 20 minutos, sem falar contigo** — e
> nada do que ela vê é inventado.

Enquanto isto não acontecer com alguém que não és tu, o número da versão é
cosmético.

---

## 2 · As regras (valem em todos os itens, sem excepção)

1. **PT-PT.** «tu», «estás», vírgula portuguesa. Nada de brasileiro.
2. **Proibido fingir.** Caminho que não existe: dizer com precisão **e** dar o que
   existe. Nunca um número, um resultado ou um player de exemplo.
3. **Botão que não faz nada é bug.** Cinzento só enquanto trabalha.
4. **A conversa nunca morre.** Qualquer pedido de conversa encontra motor.
5. **Só é «feito»** com: código + `node --test` verde + merge em `main` + deploy
   **READY/PROMOTED** + **a prova** (teste, `curl`, ou gravação).
6. **Uma versão por vaga**, changelog com as palavras do dono citadas.
7. **Limitações declaradas** na interface, no changelog e na conversa.
8. Para cada item: **o que passou a ser verdade** e **o que continua a não ser**.

**Ritual de fim de ciclo:** testes → `package.json` + `CHANGELOG.md` →
`node build.mjs` → commit na `arena/*` → PR (`--body-file`) → merge → confirmar
deploy READY → uma linha honesta na conversa.

---

## 3 · As doze frentes — mapa completo

| ID | Frente | Mata hoje | Versão | Impacto | Esforço |
|---|---|---|---|---|---|
| **A1** | A Porta (auth real, papéis, sessões) | qualquer visitante é dono | 1.54 | 🔴 crítico | 2 ciclos |
| **A2** | Dinheiro verdadeiro (custo por chamada) | `/ops/saldo` diz custo `0` | 1.55 | 🔴 alto | 1 ciclo |
| **A3** | Fatura (número, IVA, PDF, envio) | receita à mão, sem documento | 1.56 | 🟠 alto | 1–2 ciclos |
| **A4** | Primeiro cliente (onboarding, CSV, checklist) | não há «começar do zero» | 1.57 | 🟠 alto | 1 ciclo |
| **A5** | Fiabilidade (timeouts, falhas, restauro provado) | falha silenciosa, restauro nunca testado | 1.58 | 🟠 alto | 1 ciclo |
| **A6** | A Cara (nome, página, preço, vídeo, domínio) | produto sem porta de entrada pública | 1.59 | 🟡 médio | 1 ciclo |
| **A7** | Legal e RGPD | tratas dados de terceiros sem base escrita | 1.60 | 🟠 alto | 1 ciclo |
| **A8** | Conectar mesmo às apps (WhatsApp, email, Google) | catálogo de 53, envio real a zero | 1.56b | 🟠 alto | 2 ciclos |
| **A9** | Mais agentes e IAs (47 → 60+) com ofício próprio | salas cheias, nem todos com trabalho definido | 1.57b | 🟡 médio | 1 ciclo |
| **A10** | Liquid glass e polimento da cena/mesa | vidro só em 16 regras; inconsistente | 1.58b | 🟡 médio | 1 ciclo |
| **A11** | Mover/arrastar com scroll e ângulos de câmara | arrastar sem inércia; 4 vistas fixas | 1.59b | 🟢 baixo | 1 ciclo |
| **A12** | Publicação (`1.0.0`) | — | 1.60 → **1.0.0** | — | — |

**Regra de ouro:** A1 **fecha** antes de qualquer frente nova. Um item de A8–A11
que apareça pelo caminho não salta a fila — entra numa vaga, com o seu ID.

---

## 4 · VAGA 0 — «já», esta semana

Nada disto é código novo de fundo: é fechar portas e confirmar verdades antes de
construir por cima.

### O que eu faço (código)

- **A0.1 · Provar se a porta está aberta.** Um teste/`curl` documentado a
  `/api/rpc?caminho=/auth/eu` **sem cookie**, dentro e fora da Deployment
  Protection. Resultado escrito no PR. *(Se estiver aberta → A1 sobe a hoje.)*
- **A0.2 · Aviso de chave exposta.** A `GROQ_API_KEY` foi colada em texto na
  conversa. Escrever no `docs/SEGREDOS.md` o procedimento de rotação e um
  checklist de 4 passos; a rotação em si é do dono (ver abaixo).
- **A0.3 · Fechar as frases mortas.** `grep` a `não há como`, `sem motor`,
  `indisponível`, `501`: cada linha ou é verdade acompanhada de alternativa, ou
  desaparece. Relatório com a lista final (hoje: 35 ocorrências a rever).
- **A0.4 · Provar o vídeo num browser real.** Documento `docs/PROVA-VIDEO.md`
  com: browser, formato obtido (MP4 ou WebM), tamanho, duração, e o passo a passo
  que o dono repete em 60 segundos. Sem isto, «o vídeo sai» é código, não facto.

### O que só tu podes fazer (e trava os itens abaixo)

| # | Acção | Trava |
|---|---|---|
| **D1** | **Rodar a chave da Groq** (revogar a que está na conversa, criar nova, colar na Vercel em Settings → Environment Variables) | nada, mas é urgente |
| **D2** | **Aplicar a migração** `supabase/orbita_1_53_2.sql` (ou `/api/setup?token=…`) e confirmar que `/api/setup?token=…&ler=1` devolve `faltamColunas` vazio | A3, A5 |
| **D3** | **Decidir o nome definitivo** (hoje: «Órbita Studio» provisório) | A6, A7 |
| **D4** | **Decidir o preço** (mensal? instalação? ambos?) | A3, A6 |
| **D5** | **Domínio próprio** (comprar/ligar) e dizer se a produção fica aberta ao mundo | A6, A7 |
| **D6** | **50 leads reais em CSV** (nomes + cidade + telefone/email) para provar o onboarding | A4 |
| **D7** | **WhatsApp Cloud API**: conta Meta, número verificado, `WHATSAPP_TOKEN` + `WHATSAPP_VERIFY_TOKEN` | A8 |

---

## 5 · As frentes, ao detalhe

### A1 · A Porta — `1.54.0` ✅ **FEITO** *(falta o que está no fim)*

**Estado (29 out 2026, 1.54.0):** `/auth/eu` deixou de responder «dono» a quem
pede. Contas, sessões, papéis verificados no servidor, 401 sem cookie, 403 por
papel, 429 às cinco tentativas, recuperação por email, cookies `HttpOnly`.
Migração `supabase/orbita_1_54_0.sql`. 23 testes novos em `conta.test.mjs`.

**O que falta para fechar o critério 2 (conta nasce sozinha com email de
confirmação):** confirmação de email no registo, 2FA opcional, renovação de
sessão por uso. É a vaga **1.54.1**.

**Problema medido.** `GET /api/rpc?caminho=/auth/eu` devolve
`role: 'owner'`, `admin: true`, todos os perms, **a quem pedir**.
`/auth/entrar` responde `{ok:true}` sem verificar nada. `/ops/utilizadores` e
`/ops/sessoes` devolvem listas vazias. Não há cookie, não há sessão, não há
verificação — a interface *parece* ter login.

**O que fazer.**
1. Tabela `orbita_contas` (id, email único, `hash` argon2id, papel, criado,
   confirmado_em, ultimo_acesso) + `orbita_sessoes` (token com hash, expira,
   conta, ip, user-agent). Migração nova `orbita_1_54_0.sql`.
2. `POST /auth/registo` (email + palavra-passe ≥ 12), `POST /auth/entrar`,
   `POST /auth/sair`, `GET /auth/eu` (lê **só** o cookie), `POST /auth/recuperar`
   + `/auth/redefinir` (token de uso único, 30 min).
3. Cookie `HttpOnly; Secure; SameSite=Lax`, sessão de 30 dias, rotação no login.
4. **Guarda no servidor**, em `responder()`: sem sessão → 401 em todas as rotas
   `/ops/*` e `/ia/*`; papel `membro` não faz `DELETE` nem toca em contas.
5. Rate limit: 5 tentativas por email/IP por 15 min (já há `_limites.mjs`).
6. Interface: o login passa a dizer a verdade (erro real, conta por confirmar,
   sessão expirada), e `may('admin')` passa a ler o papel do servidor.

**Ficheiros:** `api/_rotas.mjs` (837–824), `api/_conta.mjs` *(novo)*,
`api/_repo.mjs` (repo + memória), `supabase/orbita_1_54_0.sql` *(novo)*,
`src/mesa.js` (login/`may`), `src/config.js`, `conta.test.mjs` *(novo)*.

**Prova:** `curl -i` sem cookie a `/api/rpc?caminho=/ops/leads` → **401**;
com cookie válido → 200; membro a `DELETE /ops/leads/x` → **403**; 6 tentativas
erradas → 429; e todos os 764 testes verdes **mais** os novos.

---

### A2 · Dinheiro verdadeiro — `1.55.0` 🔴

**Problema.** `/ops/saldo` devolve `custoCentimos: 0` e
`margemCentimos = receitaCentimos`. É falso por construção: o `/ia/uso` já
registou tokens e milissegundos de cada chamada, mas ninguém os converte em euros.

**O que fazer.** Tabela de preços por modelo (entrada/saída por 1M tokens, já há
`preco` em `FORNECEDORES`); custo calculado por chamada e gravado; custo por
tarefa (`/ops/tarefas` mostra `custo`); `/ops/saldo` derivado — receita, custo,
margem, custo por lead, custo por projeto; orçamento por execução visível e
respeitado (`orcamento()` já existe no router).

**Prova:** correr 10 tarefas e o saldo mostrar a soma com a conta à vista
(tokens × preço), sem um único fornecedor «a zero».

---

### A3 · Fatura — `1.56.0` 🟠

Número sequencial sem buracos (contador transaccional), IVA configurável
(23/6/isenção), PDF gerado no servidor (sem dependências pesadas: HTML → PDF com
`pdf-lib` ou impressão do browser como fallback declarado), envio por email
(A8), anulação com nota de crédito e motivo, listagem com totais por mês e por
cliente. Sem Stripe nesta vaga.

**Prova:** receita → fatura 2026/0001 → PDF com NIF, base, IVA, total →
anulada → nota de crédito 2026/0001-NC.

---

### A4 · Primeiro cliente — `1.57.0` 🟠

Ecra «Começar» com 4 passos: (1) dados de exemplo saem num clique, com
confirmação escrita do que vai ser apagado; (2) importar CSV de leads com pré-visualização
das colunas e relatório de erros linha a linha; (3) checklist de chaves lido do
ambiente real (`/api/setup?ler=1`, `chavesEmFalta`), com o **nome exacto** da
variável e onde a colar; (4) «estás pronto» só quando (1)–(3) estiverem verdes.

**Prova:** D6 (50 leads) importado em <2 min, zero linhas perdidas em silêncio, e
uma pessoa que não és tu a fazê-lo sozinha.

---

### A5 · Fiabilidade — `1.58.0` 🟠

Timeout explícito por chamada externa; retry com backoff só no que é retentável
(já há `e.retentavel`); tecto de orçamento por execução (a tarefa falha com
motivo, não com fatura); painel «Falhas» (o que falhou, quantas vezes, último
erro real — `src/falhas.js` já existe, ligá-lo ao servidor); alerta quando um
fornecedor cai (heartbeat em `/ia/uso`); **restauro provado**: copiar base →
apagar → restaurar → 50 leads lá.

**Prova:** 7 dias sem tarefa pendurada, e o restauro escrito com data e hora.

---

### A6 · A Cara — `1.59.0` 🟡

Nome definitivo (D3), uma frase, página de venda (o que é, para quem, 3 provas
reais, preço, botão), vídeo de 3 min do fluxo completo (o mesmo de A12.5),
domínio próprio (D5), OG image, e o escritório 3D como **demo pública sem dados
reais** (um modo `demo` que serve só dados de exemplo marcados como tal).

**Prova:** página no domínio do dono, sem Deployment Protection, Lighthouse ≥ 90
em acessibilidade, e um estranho a entender o produto em 30 segundos.

---

### A7 · Legal e RGPD — `1.60.0` 🟠

Política de privacidade e termos (texto próprio, sem copiar); base legal,
retenção (quanto tempo guardas um lead que não respondeu), direito a apagar
(`DELETE /ops/leads/:id/definitivo` com prova), subcontratantes declarados
(Supabase, Vercel, Groq, Resend, Meta, Tavily) com o que cada um vê; aviso de
cookies (só o essencial de sessão).

**Prova:** páginas publicadas, `/ops/privacidade` a devolver o texto, e o botão
«apagar tudo o que é meu» a funcionar de verdade.

---

### A8 · Conectar mesmo às apps — `1.56b` 🟠

**Estado real:** o catálogo tem **53 apps** e `api/_conect.mjs` já pede credencial
por instalação (OpenCode/`org:…`); o email sai com `RESEND_API_KEY`; o WhatsApp
exige `WHATSAPP_TOKEN` + `WHATSAPP_VERIFY_TOKEN` e número verificado; o webhook
de respostas já é idempotente. **Falta:** provar cada um com uma mensagem real,
mostrar por app «ligado · provado às HH:MM · por este método», e um botão
«provar agora» que faz o pedido a sério e mostra o resultado cru.

**Prova:** uma mensagem WhatsApp real recebida e respondida a partir da mesa; um
email real entregue; o estado de cada app dito com data e hora.

---

### A9 · Mais agentes e IAs — `1.57b` 🟡

Há **47 agentes** com papel escrito. O que falta não é quantidade: é **ofício
verificável** — cada agente com (a) uma rotina de tarefa real (como as 5 de
`api/_tarefas.mjs`), (b) a sala e o departamento certos, (c) uma frase de «o que
faz» que não seja decoração. Meta: 47 → **60**, todos com rotina ou declarados
como consultivos (sem tarefa).

**Prova:** `GET /ops/agentes` devolve, por agente, `temRotina: true|false`; e não
há dois agentes com a mesma rotina.

---

### A10 · Liquid glass e polimento — `1.58b` 🟡

O vidro existe em 16 regras (`shell.html`) e 3 (`mesa.html`): é inconsistente.
Unificar tokens (raio, blur, borda, sombra, contraste), garantir AA em texto
sobre vidro nos dois temas, e um teste que falhe se aparecer um `backdrop-filter`
fora do token.

**Prova:** teste de tokens; contraste medido; zero `backdrop-filter` solto.

---

### A11 · Mover/arrastar com scroll e ângulos — `1.59b` 🟢

Arrastar com inércia (o chão continua a deslizar e assenta), roda do rato a
**afastar/aproximar** com o cursor como âncora (zoom para onde aponta), e
**rotação contínua** com o arrasto no vazio (já roda, mas pára em seco): suavizar
com amortecimento. Ângulos: as 4 vistas + aérea já existem (`src/camera.js`) —
falta a rotação de 15° para 15° presa ao gesto, e `1`…`5` no teclado.

**Prova:** teste de `gestoDaRoda` e da inércia; e um GIF/vídeo de 10 s.

---

### A12 · Publicação — `1.60.0` → **`1.0.0`**

Os **10 critérios** de `docs/PROMPT-1.0.md` (porta fechada, conta nasce sozinha,
dois papéis, primeiro minuto, cliente de ponta a ponta gravado, custo real, uma
fatura, restauro provado, página + domínio, zero frases mortas) — todos verdes
**sete dias seguidos** com o dono a usar a Órbita todos os dias. Ao oitavo:
`1.0.0`, tag `v1.0.0`, changelog, anúncio.

---

## 6 · Encomendas antigas — onde cada uma ficou

| Encomenda | Estado | Onde |
|---|---|---|
| «as IAs devem responder a tudo» | ✅ feito | 1.53.1 (`src/rota.js`) |
| «nas tarefas nada funciona» | ✅ feito | 1.53.2 (`api/_tarefas.mjs`) |
| rodar a câmara pelo rato, não por botões | ✅ feito | 1.53.2 (`gestoDoArrasto`) |
| vídeo do Cine (opção C: dois motores) | ✅ feito | 1.53.2 (`src/estudio-video.js`) |
| mais agentes / IAs | ⏳ pendente | **A9** |
| liquid glass | ⏳ parcial | **A10** |
| conectar mesmo a todas as apps | ⏳ parcial | **A8** |
| mover/arrastar com scroll | ⏳ pendente | **A11** |
| ângulos de câmara alternativos | 🟡 4 vistas + aérea existem | **A11** |
| publicar de verdade | ⏳ | **A1 → A12** |
| worker OpenMontage vivo | 🟡 opcional (vídeo já sai no browser) | `docs/OPENMONTAGE.md` |
| migração do resultado das tarefas | ⏳ só tu | **D2** |

---

## 7 · O que NÃO fazer (para não perder a 1.0)

- **Não reescrever** o escritório, a mesa nem o motor. Está provado; reescrever é
  a forma mais rápida de perder o que existe.
- **Não abrir vistas novas** antes de A1–A4.
- **Não integrar pagamentos** antes da fatura própria (A3).
- **Não prometer** equipas, multi-empresa ou API pública: isso é 2.0.
- **Não usar dados reais** de clientes em demo pública ou em conversa.
- **Não aceitar** «está feito» sem READY + prova.
- **Nunca** `pkill -f`, nunca chaves em texto, nunca commits fora da `arena/*`.

**Dívida que a 1.0 tolera** (e não se toca agora): `src/main.js` com 128 KB, o
bundle de 1,6 MB num só HTML, `dist/` no git, 45 ficheiros de teste planos, dois
caminhos (local e publicado). São costuras para a 2.0.

---

## 8 · Decisões que faltam do dono (bloqueiam itens)

- **D3 · Nome** definitivo → bloqueia A6, A7.
- **D4 · Preço** e modelo de cobrança → bloqueia A3, A6.
- **D5 · Domínio** e se a produção passa a estar aberta → bloqueia A6, A7.
- **D6 · 50 leads reais** → bloqueia A4.
- **D7 · WhatsApp Cloud API** (Meta, número verificado) → bloqueia A8.

Sem estas cinco respostas, A1, A2, A5 e A10 avançam na mesma. As outras esperam.

---

## 8b · PRIMEIRO PASSO DEPOIS DE CADA DEPLOY DA PORTA

A 1.54.0 fecha a produção **até existir uma conta**. Depois do deploy:

1. Aplicar a migração (`/api/setup?token=…&so=orbita_1_54_0.sql` ou SQL Editor).
2. Abrir `/app` → o ecrã diz «Criar a primeira conta».
3. Preencher nome, email, palavra-passe (12+) e **colar o `SETUP_TOKEN`** no
   campo que apareceu.
4. A partir daí, `/api/rpc?caminho=/ops/leads` responde **401** sem cookie.
   É essa a prova do critério 1.

Se algo correr mal, `ORBITA_AUTH=aberta` na Vercel reabre a porta com aviso à
vista — e a interface diz que está aberta. Não é uma solução, é uma saída.

## 9 · Primeira coisa a fazer, agora

Um `curl` **sem cookie**:

```
curl -i "https://orbita-agentes.vercel.app/api/rpc?caminho=/auth/eu"
```

- **401/403/HTML da Vercel** → a produção está protegida pela Deployment
  Protection. A1 é o próximo ciclo, com calma.
- **JSON com `"role":"owner"`** → **a Órbita está aberta ao mundo.** Não é
  roadmap: é o primeiro commit da 1.0, hoje.
