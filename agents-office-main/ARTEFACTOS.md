# Artefactos: o que as salas entregam

> 1.31.0 · 27 out 2026. Pedido do dono: *«já quero que as salas comecem a trabalhar e
> que sejam capazes de criar um site ou de digitalizar qualquer coisa»*.

Os agentes deste escritório **não têm disco nem shell**: o lançador arranca-os com
`--disallowedTools Bash,Edit,Write,Read,Glob,Grep,Agent,NotebookEdit,Task`
(`providers.mjs`). Isso não é um defeito — é o que impede um agente de apagar um
ficheiro por engano. Mas durante muito tempo também quis dizer que uma sala não
conseguia entregar nada além de texto.

Esta versão muda isso sem abrir a caixa: o que a sala entrega passa a sair de
**ferramentas com contorno**, e o que é publicado tem sempre uma assinatura humana.

---

## 1 · Um site, a partir de dados que alguém confirmou

```
sala (ou tu, pela rota)
   │  nome, atividade, cidade, contactos, serviços
   ▼
validarBrief()          ← recusa nome vazio, telefone e email malformados,
   │                      `javascript:` em links, mais de 6 serviços
   ▼
criarSite()             ← index.html + estilo.css + LEIA-ME.md
   │                      (determinístico: o mesmo brief, o mesmo site)
   ▼
RASCUNHO                ← guarda o brief, não o HTML
   │
   ▼  publicar(id, { aprovado: true, por: 'quem autorizou' })
APROVADO                ← recusa sem OK, sem nome, ou sem um único contacto
```

| Ferramenta MCP | Rota | O que faz |
|---|---|---|
| `orbita_site_create` | `POST /artefactos/site` | cria o rascunho e devolve os ficheiros |
| `orbita_site_list` | `GET /artefactos` | lista rascunhos e aprovados |
| — | `GET /artefactos/:id` | o artefacto (brief + estado) |
| — | `GET /artefactos/:id/preview` | o HTML e o CSS, para ver antes de aprovar |
| `orbita_site_publicar` | `POST /artefactos/:id/publicar` | aprova, com nome e OK |

**O que nunca acontece:** a página inventar um telefone para «parecer completa». Se o
brief não trouxer contactos, a secção diz que ainda não estão confirmados — e a
aprovação é recusada com `sem-contactos`.

**O que é real e o que é inferência:** a resposta traz `real` (campos que vieram do
brief) e `inferido` (título, chamada e «sobre» escritos pela casa). Se um agente
escrever os textos e os passar em `textos`, deixam de ser inferência — mas continuam a
ser texto de modelo, não facto.

**Segurança do que é gerado:** todo o campo é escapado; não há `<script>`, não há
dependências externas (uma folha de estilo, tipografia do sistema), há `lang="pt-PT"`,
`skip link`, foco visível, contraste e `prefers-reduced-motion`.

## 2 · Digitalizar papel e imagem

```
imagem/PDF ──► OCR (ORBITA_OCR_URL) ──► texto ──► regras ──► campos + faltam
```

|  |  |
|---|---|
| entrada | base64 (`imagem`) ou `url` http(s); até **6 MB**; png, jpeg, webp, tiff, pdf |
| OCR | `ORBITA_OCR_URL` — um serviço teu que recebe `{ imagem: { base64, mime } }` e devolve `{ texto }` |
| regras | NIF **com dígito de controlo (módulo 11)**, telefone PT normalizado para `+351…`, email, código postal `dddd-ddd`, IBAN **mascarado**, valor em €, data |
| saída | `campos[]` com `origem` e `confianca`, `texto`, `faltam[]`, `revisao: 'pendente'` |
| lead | `POST /digitalizar/lead` devolve a **proposta** — quem grava é uma pessoa |

Sem `ORBITA_OCR_URL` a resposta é **503** com o nome da variável (nunca texto inventado).
O texto do documento **não entra no registo de actividade**: fica registado só o estado e
quantos campos saíram.

### Ligar um OCR

Qualquer serviço que fale este contrato serve. Exemplo mínimo com Tesseract num
contentor à parte:

```bash
# POST http://ocr:8080/  { "imagem": { "base64": "...", "mime": "image/jpeg" } }
# → 200 { "texto": "Clínica do Mondego Lda\nNIF 123456789\n…" }
ORBITA_OCR_URL=http://ocr:8080/
```

## 3 · Onde ficam os rascunhos

| situação | onde |
|---|---|
| com base (produção) | `orbita_ai_memoria`, `projeto: 'artefactos'`, `titulo: 'site:<id>'` |
| sem base (servidor local, MCP) | `data/artefactos/<id>.json` (fora do git) |
| sem uma nem outra (Vercel sem base) | memória do processo, e a resposta diz `guardado: 'sessao'` |

Não foi preciso criar tabelas: a memória do escritório já existia e aceita o brief em
JSON. O HTML nunca é guardado — é regenerado a partir do brief.

## 4 · Limites, ditos sem rodeios

- **Não faz deploy.** Aprovar marca o artefacto como pronto e entrega os ficheiros;
  publicá-los no alojamento é um passo à parte (e é o próximo trabalho).
- **Não há OCR incluído.** É um adaptador: sem serviço configurado, a digitalização
  recusa e diz porquê.
- **A heurística do nome** (primeira linha com aspecto de nome, confiança 0,55) pode
  apanhar a morada em vez do nome. É por isso que existe revisão humana e o campo diz a
  confiança.
- **O site é de uma página.** Landing, não loja: sem formulários, sem pagamentos.
- **A leitura de PDF depende do OCR** — não há extração nativa de texto de PDF.

## 5 · Provar sem publicar

```bash
node serve.mjs                     # servidor local
curl -s -X POST localhost:3000/api/artefactos/site \
  -H 'content-type: application/json' \
  -d '{"nome":"Estúdio Aurora","atividade":"fotografia","email":"ola@aurora.pt"}'
# → 201 { artefacto: { id: "estudio-aurora-…", estado: "rascunho" }, ficheiros: {…} }

curl -s localhost:3000/api/artefactos/<id>/preview      # ver o HTML
curl -s -X POST localhost:3000/api/artefactos/<id>/publicar \
  -H 'content-type: application/json' -d '{"aprovado":true,"por":"Dono"}'
```

`node --test artefactos.test.mjs` faz o mesmo ciclo por dentro, mais a digitalização
contra um OCR de mentira com HTTP a sério.
