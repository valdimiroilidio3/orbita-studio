# Órbita Studio — repositório

Uma aplicação, três camadas dentro da mesma pasta:

| Caminho | O que é |
|---|---|
| **`agents-office-main/`** | o escritório 3D: seis salas, 35 agentes, o Cérebro em 3D e os motores de IA. `npm ci && npm start` → http://localhost:4520 |
| **`agents-office-main/integrations.mjs` + `docs/INTEGRATIONS.md`** | a ponte autenticada para fora: leads OSM, Gemini, Supabase, Resend, GitHub, Instagram, Vercel, fila de conteúdo, WhatsApp por link |
| **`agents-office-main/mcp-servers/`** | dois servidores MCP locais: `orbita-integrations` (as integrações como ferramentas dos 35 agentes) e `view-image-mcp` (dá olhos aos agentes: qualquer URL pública) |

Arranque, do zero:

```bash
cd agents-office-main
npm ci
cp .env.example .env          # ORBITA_API_TOKEN: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm run test:integrations     # 13 testes, com um OSM falso local
npm start                     # http://localhost:4520
```

`.env` é lido no arranque (sem dependências). O servidor MCP `orbita_integrations` é
arrancado e testado a sério ao iniciar; o estado real aparece em `GET /api/mcp`.

Guias: `agents-office-main/README.md`, `agents-office-main/AI.md` (motores de IA),
`agents-office-main/PESQUISA.md` (leads Google), `agents-office-main/docs/INTEGRATIONS.md`
(integrações, rotas e limites).

Órbita — criado por **Chelton Mahoze**.
