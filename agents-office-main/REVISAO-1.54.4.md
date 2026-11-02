# Revisão do fluxo principal · 1.54.4 (2 nov 2026)

Este documento responde ao pedido: **percorrer o fluxo como um dono o percorre**,
com leads representativos, no computador e no telemóvel, e dizer — com provas —
onde ele fica **sem saber o que fazer**, onde a **IA inventa** e onde uma **falta
obrigatória bloqueia sem saída**. Não é uma lista de funcionalidades: é o que
correu bem, o que estava mal e o que **não** foi possível provar aqui.

---

## 1 · Como foi feito (e o que isso limita)

| Meio | O que permite provar | O que **não** permite |
|---|---|---|
| `node --test` (864 testes, zero rede) | regras do servidor, validações, estados, custos, limites, idempotência | nada sobre o ecrã |
| `dist/mesa.html` a correr em `jsdom`, com `/api/rpc` falso | o texto que o dono lê, a navegação, os cliques | layout real, toques, câmara, ficheiros |
| `createMemRepo` (base em memória, mesmo contrato) | o percurso ponta a ponta do servidor | Supabase a sério, Storage, latência |
| revisão de código das rotas e das vistas | coerência entre o que o servidor diz e o que o ecrã mostra | comportamento em produção |

**Não havia**: Chrome/Playwright (logo, nada de pixéis medidos), rede para
fornecedores (logo, nenhuma imagem ou vídeo real gerado), telemóvel físico.

Tudo o que se segue distingue **provado** de **lido no código**.

---

## 2 · O percurso, passo a passo

### 1) Encontrar / cadastrar a lead — ✅ funciona
- Criar à mão, importar da pesquisa de empresas (Geoapify) e digitalizar papel
  são caminhos separados, e todos acabam na mesma ficha.
- A pesquisa diz **porque** cada empresa aparece (nota), e não inventa site
  quando não há.
- Deduplicação por nome + cidade: importar duas vezes não duplica.

**Estava mal e foi corrigido (F4):** o servidor aceitava `email: "nao-e-email"`,
`phone: "abc"` e `website: "isto não é um site"` — e só três passos depois, ao
enviar, é que o problema aparecia sem se saber qual campo era. Agora
`validarContacto` corre em `PATCH /ops/leads/:id` **e** em `POST /ops/leads`
(criação e importação), devolve **400** com a frase (««Oficina Alves: o telefone
tem letras»»), e normaliza o que é válido (email minúsculo, `https://` no site).
Vazio continua permitido — uma lead sem contactos é uma lead por completar, não
um erro. **Provado** em `revisao.test.mjs`.

### 2) Consultar e corrigir os dados — ✅ funciona
- A ficha mostra o que veio de onde, e o que está por confirmar.
- Gravar campos vazios não apaga o resto; o histórico fica.

### 3) Iniciar o projeto sem duplicados — ✅ funciona
- **Uma lead, um projeto**: «Iniciar projeto» reabre o que já existe. Para criar
  outro de propósito é preciso pedi-lo (`corpo.novo: true`), e a interface não
  oferece esse atalho por acidente.
- O briefing nasce no mesmo instante, **só** com o que a ficha sustenta.

### 4) Briefing: gerar, editar, guardar — ✅ funciona
- 15 campos editáveis, gravação com versão (conflito de edição devolve **409** e
  a frase «o briefing mudou noutro sítio»), rascunho da IA que só preenche campos
  vazios.
- **Provado** no percurso: guardar → recarregar → os valores estão lá.

**Estava mal e foi corrigido (F2):** quando o servidor **recusava** (409 do
briefing, 502 do rascunho), a mesa perdia a frase e mostrava só «HTTP 409». As
seis respostas de erro passaram a trazer `error` **e** `erro`; o `/api/rpc`
devolve o corpo; e a decisão de o que mostrar vive em `src/respostas.js`.
Hoje o dono lê **porque** falhou.

### 5) Prompt Master: gerar e copiar — ✅ funciona, com uma ressalva fechada
- Caminho por regras: sempre disponível, sem rede, com os factos do briefing.
- Caminho pela IA: diz qual foi usado (`via`), o modelo, e **porque não** foi a
  IA quando não foi.
- Copiar funciona (com alternativa quando o browser não dá permissão).

**Estava mal e foi corrigido (F1):** o texto da IA **substituía** o documento
das regras de honestidade — a única defesa escrita contra factos inventados. Um
modelo que escrevesse «prémio nacional em 2021, 5000 clientes desde 1998»
entregava-o pronto a copiar. Agora:
- as regras vão **sempre à frente** (sem duplicar, se o modelo as trouxer);
- o que a IA afirma sem apoio no briefing fica numa secção **«⚠ Antes de usar —
  por confirmar»** e num alerta por cima do texto na mesa;
- o que o briefing sustenta **não** é marcado (não se cria ruído);
- **nada é apagado** — o dono vê o texto inteiro e decide.

Ressalva honesta: `factosSuspeitos` apanha anos, valores em euros, «N clientes»,
prémios e certificados. **Não apanha tudo** — uma frase inventada sem números
(«a equipa mais premiada da região») pode passar. É uma rede, não uma garantia.

### 6) Mídia: criar e acompanhar — ✅ funciona com fornecedor falso
- Estimativa **antes** de confirmar, custo real vs estimado vs desconhecido,
  estados persistidos, download, detalhe, repetir, cancelar, classificação
  «conteúdo de IA» ↔ «aprovado para uso».
- Limites por utilizador/projeto validados **antes** do fornecedor; idempotência
  por chave; ficheiros em bucket privado servidos só com sessão.

**Estava mal e foi corrigido (F1b):** a IA podia escrever prompts a pedir texto
dentro da imagem («include a bold logo and lettering») ou a apresentar a equipa
como **real** — precisamente o que as regras proíbem. Agora esses conjuntos são
**recusados** (`codigo: 'regra'`, motivo escrito) e volta o conjunto das regras;
as restrições do projeto e as da regra passam a ser **acumuladas**.
O detector olha **cláusula a cláusula**, para não confundir «no text in the
image» (defesa) com «include a logo» (pedido) — o primeiro teste ingénuo fazia
exactamente essa confusão.

**Não provado aqui:** nenhuma imagem ou vídeo real gerado — o ambiente não tem
rede para o fornecedor. O que está provado é o contrato, com fornecedor falso.

### 7) Sair, entrar e recuperar tudo — ✅ funciona
- «Sair» limpa a sessão e volta ao ecrã de entrada; entrar com a mesma conta
  devolve leads, projetos, briefing e Prompt Master **guardados**.
- No ensaio, a mídia não voltou porque o harness não a recriou — não é um
  defeito do produto; é limite do ensaio, e fica dito.

**Estava mal e foi corrigido (F3):** abrir `#/projeto/p_fantasma` (link antigo,
projeto apagado) anunciava **«Modo local · 0 leads»** com a base viva, e ficava
ali. Havia dois `404` com sentidos opostos tratados da mesma maneira. Agora:
- **404 de rota** (instalação antiga) → armazém do browser;
- **404 de recurso** → ecrã próprio: «Projeto não encontrado», o endereço que
  falhou, «Ver todos os projetos» e «Tentar outra vez», com a nota de que um
  projeto apagado não volta por tentar outra vez.
A decisão é uma função pura (`src/respostas.js`), e há prova **no DOM**: o teste
abre o `dist/mesa.html` e lê o ecrã.

---

## 3 · Telemóvel — o que foi preparado e o que **não** foi medido

Preparado nesta versão (F5):
- a caixa de pré-visualização da mídia segue a proporção do ficheiro (16:9, 4:5,
  1:1) com `object-fit: contain` — antes era 4:3 com `cover`, que **cortava** um
  vídeo 16:9;
- botões da mídia com **44 px** de altura mínima; campos com **16 px** de letra
  (evita o zoom automático do iOS).

**Isto está escrito na CSS e o teste verifica que está escrito. Não foi medido.**
Falta: medir em pixéis num Chrome com emulação de telemóvel, e provar a
composição de vídeo com `MediaRecorder` num telemóvel real (a 1.54.3 só a provou
no servidor, com bytes falsos). Fica declarado como **por validar**, não como
feito.

---

## 4 · Veredicto

| Área | Estado | Prova |
|---|---|---|
| Encontrar / cadastrar lead | ✅ | testes + revisão de rotas |
| Corrigir dados da lead | ✅ (era F4) | `revisao.test.mjs` |
| Projeto sem duplicados | ✅ | testes de rota |
| Briefing gerar/editar/guardar | ✅ (era F2) | percurso + testes |
| Prompt Master gerar/copiar | ✅ com ressalva (era F1) | testes + vista |
| Mídia criar/acompanhar | ✅ com fornecedor falso | `media.test.mjs` |
| Sair/entrar/recuperar | ✅ (era F3) | percurso jsdom |
| Telemóvel | ⚠️ preparado, não medido | CSS estática |
| Fornecedor real de imagem/vídeo | ⚠️ não provado aqui | — |

Cinco defeitos encontrados, cinco corrigidos com o teste que os apanha. O que
**continua** por provar está escrito na tabela: prefiro entregar uma linha
«não medido» do que uma linha verde sem prova.

**Próximo passo do plano:** A2 · Dinheiro verdadeiro (1.55).
