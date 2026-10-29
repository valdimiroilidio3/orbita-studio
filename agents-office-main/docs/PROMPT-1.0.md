# PROMPT · Órbita Studio 1.0 — a publicação oficial

> Este é o documento a entregar a quem for fazer a 1.0 (eu, outro agente, ou o
> dono a trabalhar sozinho). Está escrito como um prompt: missão, regras, estado
> real, definição de pronto e frentes com critérios verificáveis.
> Escrito a 29 out 2026, quando a produção estava em **1.53.2** (`6843eb8`).

---

## MISSÃO

Levar a Órbita Studio da **1.53.2** (um sistema que funciona, privado, sem porta)
à **1.0.0** (um produto que um cliente real paga, usa e recomenda) — sem reescrever
o que já está provado, sem inventar um único resultado, e sem deixar nenhuma frase
de «não há como» onde exista caminho.

**A medição da 1.0 não é o número de funcionalidades.** É isto:

> Uma pessoa que nunca viu a Órbita entra, cria a conta, liga uma chave, importa
> 50 leads, cria e corre uma tarefa, gera e faz o vídeo de um cliente, envia a
> mensagem e vê a receita entrar — **sozinha, em menos de 20 minutos, sem falar
> contigo.**

Enquanto isto não acontecer com alguém que não és tu, não é 1.0. É a tua 1.53.

---

## REGRAS DO DONO (não são negociáveis, valem em todas as frentes)

1. **PT-PT**, sempre. Vírgulas, «tu», «estás», nada de brasileiro.
2. **Proibido fingir.** Se um caminho não existe, diz-se com precisão *e* dá-se o
   que existe. Nunca um resultado inventado, nunca um número de exemplo a passar
   por real, nunca um player vazio a fingir de vídeo.
3. **Um botão que não faz nada é um bug.** Botão cinzento só enquanto trabalha.
4. **A conversa nunca morre.** Qualquer pedido de conversa encontra motor.
5. **Só é «feito»** com merge em `main` + deploy **READY/PROMOTED** + a prova
   (teste, ou resposta real do serviço publicado).
6. **Testes antes de cada release.** Hoje: 764/764. Uma regressão é uma paragem.
7. **Limitações declaradas em voz alta** — na interface, no changelog e na
   conversa. «Não é um render de Veo/Kling» é o exemplo a repetir.
8. Commits e pushes só para a branch `arena/*` da sessão; PRs com `--body-file`.

---

## ESTADO REAL (não confiar na memória: verificar antes de mexer)

**O que existe e está provado**

| Peça | Estado |
|---|---|
| Escritório 3D | 6 salas, ~47 agentes, câmara por arrasto, liquid glass, monitores em direto |
| Mesa (2D) | 11 vistas: hoje, leads, papel, cine, conversas, saldo, projetos, tarefas, agentes, contas, ia |
| Motor de IA | cadeia com fallback, ~159 modelos, fornecedores sem chave, registo em `/ia/uso`, orçamento por chamada |
| Tarefas | correm a sério desde a 1.53.2 (5 rotinas, contexto real, resultado gravado) |
| Cine | Master Prompt, direcção de arte, imagens aprovadas, **vídeo composto no browser** (MP4/WebM) |
| Câmara | rodar no vazio, pan com Shift, clique abre ficha |
| Dados | Supabase (leads, projetos, tarefas, mensagens, receitas, atividade, IA, cine) |
| Rotas | ~140 (100 em `_rotas.mjs`, 40 em `_ia/rotas.mjs`) |
| Testes | 764, todos verdes |
| Deploy | `orbita-agentes.vercel.app`, READY/PROMOTED |

**O que NÃO existe (e a 1.0 precisa)**

- **A porta.** `/auth/eu` devolve sempre *Dono, owner, todos os perms*;
  `/auth/entrar` responde `{ok:true}` sem verificar nada; `/ops/utilizadores` e
  `/ops/sessoes` devolvem listas vazias. **Quem chega ao URL é dono.** É o único
  buraco que, sozinho, impede a palavra «publicação».
- **O dinheiro verdadeiro.** `/ops/saldo` devolve `custoCentimos: 0` e
  `margemCentimos = receita` — estruturalmente falso. O `/ia/uso` já sabe quantos
  tokens cada chamada gastou; ninguém os transforma em euros.
- **A fatura.** Há registo de receita à mão, não há documento, não há IVA, não há
  número de fatura, não há envio por email.
- **O onboarding.** Não há «começar do zero»: apagar dados de exemplo, importar
  CSV, ligar chaves guiado por um checklist que olha para o ambiente real.
- **A cara.** Não há nome de produto definitivo, preço, página de venda, vídeo de
  demonstração, nem domínio próprio (produção vive num alias `.vercel.app`).
- **O legal.** Sem política de privacidade, termos, RGPD (tratas dados de
  contactos de terceiros — nome, telefone, email: é tratamento de dados).
- **Restauro provado.** `_backup.mjs` existe; nunca se restaurou a sério.

**Dívida que a 1.0 pode (e deve) tolerar**
`src/main.js` tem 128 KB e o bundle 1.6 MB num só HTML; os testes são 45 ficheiros
planos; `dist/` vive no git; o «modo local» e o publicado são dois caminhos. Nada
disto impede a 1.0 — **não é altura de reescrever.** É altura de pôr costuras onde
doem (ver F1 e F4).

---

## DEFINIÇÃO DE PRONTO — os 10 critérios da 1.0.0

Todos binários. Todos com prova anexada ao PR da release.

1. **Porta fechada.** Sem sessão válida, nenhuma rota `/ops/*` devolve dados
   (401), e `/api/rpc` não é uma porta aberta. Provado com `curl` sem cookie.
2. **Uma conta nasce sozinha.** Registo → email de confirmação → primeira sessão,
   sem intervenção tua. Palavra-passe com hash (argon2/bcrypt), nunca em claro.
3. **Dois papéis a sério.** `dono` e `membro` (mínimo). Um membro não apaga
   dados nem muda contas — e o servidor recusa, não é só a interface a esconder.
4. **O primeiro minuto.** Um ecrã «Começar» que: apaga os dados de exemplo,
   importa um CSV de leads, mostra o checklist das chaves em falta (com o nome
   exato da variável) e diz «estás pronto» só quando estiver.
5. **Um cliente de ponta a ponta, gravado.** Vídeo de 3 minutos, sem cortes, do
   lead ao dinheiro: lead → projeto → código gerado → QA → mensagem aprovada e
   enviada → resposta do cliente entra → receita registada.
6. **Custo real.** `/ops/saldo` mostra o que a IA gastou (tokens × preço do
   fornecedor) e a margem verdadeira. Zero fornecedores ficam «a zero».
7. **Uma fatura.** Receita → documento com número sequencial, IVA à taxa certa,
   PDF, envio por email. Anular também.
8. **Restauro provado.** Copiar a base, apagá-la, restaurar, e os 50 leads estão
   lá. Escrito no changelog com a hora.
9. **Página de venda + domínio próprio.** Nome, uma frase, três provas, preço,
   botão. Serve-se no domínio do dono, sem Deployment Protection.
10. **Zero frases mortas.** `grep -rn "não há como\|sem motor\|indisponível"` só
    devolve linhas onde a frase é *verdadeira e acompanhada da alternativa*.

**Regra dos 7 dias:** os 10 critérios têm de se manter verdes **sete dias
seguidos** em produção, com o dono a usar a Órbita todos os dias. Ao oitavo dia,
`1.0.0`, tag `v1.0.0`, changelog, anúncio.

---

## AS SETE FRENTES (ordem obrigatória — cada uma fecha antes da seguinte)

### F1 · A Porta — `1.54.0`
Sessões reais, palavras-passe com hash, papéis verificados no servidor,
recuperação por email, rate limit no login, `HttpOnly` + `SameSite` nos cookies.
**Critério:** os critérios 1, 2 e 3 acima, com `curl` sem cookie a devolver 401.

### F2 · O Dinheiro Verdadeiro — `1.55.0`
Preços por modelo no catálogo (já há `preco` em `FORNECEDORES`), custo por
chamada gravado em `/ia/uso`, custo por tarefa, `/ops/saldo` derivado — nunca
`0` fixo. Orçamento por execução visível na interface.
**Critério:** criar 10 tarefas, e o saldo mostrar o custo somado com a conta à vista.

### F3 · A Fatura — `1.56.0`
Numeração sequencial sem buracos, IVA configurável, PDF, envio, anulação com
nota de crédito. Sem integração obrigatória: primeiro o documento, depois o
InvoiceXpress/Stripe se fizer falta.
**Critério:** critério 7.

### F4 · O Primeiro Cliente (onboarding) — `1.57.0`
O ecrã «Começar», CSV, checklist de chaves lido do ambiente, dados de exemplo
que saem num clique, e um estado de prontidão honesto (`/api/setup?ler=1` já
sabe a verdade sobre a base).
**Critério:** critério 4 + uma pessoa que não és tu a fazê-lo sozinha.

### F5 · Fiabilidade — `1.58.0`
Timeout e retry em cada chamada externa, tecto de orçamento por execução,
painel de falhas (o que falhou, porquê, quantas vezes), alerta quando um
fornecedor cai, e o restauro provado.
**Critério:** critério 8 + 7 dias sem uma tarefa pendurada.

### F6 · A Cara — `1.59.0`
Nome definitivo, uma frase, página de venda, preço (sugestão: mensal, com
instalação paga), vídeo de 3 min, domínio próprio, OG image, e o escritório 3D
como demo público sem dados reais.
**Critério:** critério 9 + o vídeo publicado.

### F7 · O Legal e o Anúncio — `1.60.0` → **1.0.0**
Privacidade, termos, RGPD (base legal, retenção, direito a apagar), e o texto de
anúncio: uma página, um email, três posts. Depois: os 7 dias, a tag, o deploy.

---

## O QUE NÃO FAZER

- **Não reescrever** o escritório, a mesa ou o motor. Está provado; reescrever é
  a forma mais rápida de perder a 1.0.
- **Não acrescentar vistas novas** antes de F1–F4. Cada vista nova é uma porta
  aberta a mais.
- **Não integrar pagamentos** antes de haver fatura própria.
- **Não prometer** «multi-empresa», «equipa», «API pública» na 1.0. Isso é 2.0.
- **Não usar dados reais de clientes** na demo pública, nem na conversa.
- **Não aceitar** «está feito» sem deploy READY e prova.

---

## COMO CADA CICLO ACABA (o ritual, igual todas as vezes)

1. `node --test` → verde, e o número novo escrito no changelog.
2. `package.json` + `CHANGELOG.md` com a versão e *o problema que resolveu*, com
   as palavras do dono citadas.
3. `node build.mjs`.
4. Commit na branch `arena/*`, push, PR com `--body-file`, merge em `main`.
5. Deploy **READY/PROMOTED** confirmado pela API da Vercel.
6. Uma linha na conversa: **o que passou a ser verdade**, e o que continua a não
   ser. Sem adjetivos.

---

## A PRIMEIRA COISA A FAZER, HOJE

`GET /api/rpc?caminho=/auth/eu` em produção devolve `owner` com todos os poderes
a quem pedir. Antes de qualquer outra frente, responder a uma pergunta:

> **A Órbita publicada está protegida por Deployment Protection ou está aberta?**

Se está aberta, isso não é uma tarefa para a 1.54 — é o primeiro commit da 1.0.
Se está protegida, a 1.54 é o dia em que a proteção deixa de ser a Vercel e passa
a ser a Órbita.
