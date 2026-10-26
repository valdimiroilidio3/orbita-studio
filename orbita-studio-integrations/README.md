# Órbita Studio — Integrações

A ponte entre o Órbita e os serviços de fora: leads reais do OpenStreetMap, email um-a-um,
WhatsApp, GitHub, Instagram, deploy na Vercel, assistência do Gemini e CRM em Supabase.

Uma API HTTP pequena e autenticada por token, sem dependências de produção. Tudo o que sai para o
mundo exige **aprovação humana explícita** (`approved: true`) — e o que não está configurado diz
que não está, em vez de fingir.

```bash
npm ci
cp .env.example .env                      # e põe o ORBITA_API_TOKEN
npm run build
npm run test:integrations
npm start                                 # http://localhost:4530
```

- Guia completo: **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)**
- Lógica dos providers: `integrations.mjs` (Node puro)
- Servidor: `src/server.mjs` (token, limites, aprovação)
- Testes: `test/integrations.test.mjs` (sem rede — OSM falso local)

Órbita — criado por **Chelton Mahoze**.
