# Órbita Studio — repositório

Órbita é um escritório isométrico 3D onde agentes de IA fazem trabalho real. Este repositório
junta quatro partes na mesma pasta. A versão atual está em `agents-office-main/package.json`
(fonte única) e aparece em `/api/health` e no rodapé da página.

| Caminho | O que é |
|---|---|
| **`agents-office-main/`** | o escritório 3D: seis salas, 49 agentes, o Cérebro em 3D (as tuas notas), a mesa de trabalho e os motores de IA. `npm ci && npm start` → http://localhost:4520 |
| **`agents-office-main/integrations.mjs` + `docs/INTEGRATIONS.md`** | a ponte autenticada para fora: leads, Gemini, Supabase, Resend, GitHub, Instagram, Vercel, fila de conteúdo e WhatsApp por link |
| **`agents-office-main/mcp-servers/`** | dois servidores MCP locais: `orbita-integrations` (as integrações como ferramentas dos agentes) e `view-image-mcp` (dá olhos aos agentes: qualquer URL pública) |
| **`orbita-core/`** | a base de uma empresa de agentes, escrita de raiz e separada do escritório. Primeira entrega: 14 agentes em Produto, Design e Programação, com um fluxo de etapas que só conta como feito quando as entregas existem em disco. Ver `orbita-core/README.md` |
| **`mem0-import/`** | utilitários de memória (Mem0) para correr no host do OpenClaw, fora deste repositório. Ver `mem0-import/README.md` |

**Publicado:** <https://orbita-agentes.vercel.app>. A versão publicada aparece em
`/api/health` → `versao`. O histórico de lançamentos e o que falta está em
`agents-office-main/docs/LANCAMENTO.md`.

## O que precisas

- Node.js **22.5 ou superior** (o `package.json` do escritório exige `>=22.5`) — https://nodejs.org
- git
- Uma chave de IA. Qualquer uma destas serve:
  - `GEMINI_API_KEY` do Google AI Studio (aistudio.google.com/apikey): não instala nada e fala
    direto com a API do Google;
  - Claude Code com sessão iniciada, ou uma `ANTHROPIC_API_KEY`.

Para Chrome, ficheiros e conectores MCP é preciso o Claude Code (uma API dá voz, não mãos).
Ver `agents-office-main/AI.md`.

## Arranque, do zero

```bash
cd agents-office-main
npm ci
cp .env.example .env          # ORBITA_API_TOKEN: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build                 # gera dist/command-centre-v2.html (o escritório num único ficheiro)
npm run test:integrations     # 13 testes, com um OSM falso local
npm start                     # http://localhost:4520
```

O `.env` é lido no arranque, sem dependências, e nunca vai para o git. Sem chave nenhuma, o
escritório abre e diz, em cada sítio, o que falta; não finge que trabalha. O servidor MCP
`orbita_integrations` é arrancado e testado ao iniciar; o estado real aparece em `GET /api/mcp`.

## Testes

- Escritório, suíte completa: `cd agents-office-main && node --test *.test.mjs` (1662 testes na 1.90.0).
- Escritório, por área: `npm run test:integrations`, `npm run test:ops`, `npm run test:ia`, `npm run test:backup`, entre outros em `agents-office-main/package.json`.
- Empresa de agentes: `cd orbita-core && npm test`.

## Guias

- `agents-office-main/README.md`: o escritório, passo a passo.
- `agents-office-main/AI.md`: motores de IA.
- `agents-office-main/PESQUISA.md`: leads do Google.
- `agents-office-main/docs/INTEGRATIONS.md`: integrações, rotas e limites.
- `agents-office-main/docs/LANCAMENTO.md`: publicação e prova de versão.
- `orbita-core/README.md`: a base de agentes da empresa.

Órbita — criado por **Chelton Mahoze**. Licença do escritório: PolyForm Noncommercial 1.0.0
(`agents-office-main/LICENSE`). A pasta `orbita-core/` declara MIT no `package.json` e tem os
avisos de terceiros em `orbita-core/NOTICE.md`.
