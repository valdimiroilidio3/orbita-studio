# O lançamento — o que está publicado, e o que isso quer dizer

**Endereço:** <https://orbita-agentes.vercel.app>
**Projeto Vercel:** `orbita-agentes` (equipa `orbita-projetos`) · **repositório:** `valdimiroilidio3/orbita-studio`
**Versão publicada:** 1.14.0 · **construção:** `npm ci` → `node build.mjs` → publica `dist/`

## O que o endereço é

É o **escritório a sério** — a mesma cena, o mesmo painel, o mesmo Cérebro — servido como site estático:
`agents-office-main` no Vercel tem por *root* esta pasta, o *build* é o `build.mjs` e o *output* é `dist/`.

| caminho | o que é |
|---|---|
| `/` | o escritório (o mesmo `dist/index.html`, um ficheiro só com o three lá dentro) |
| `/app` | a mesa de trabalho (leads, aprovações, fila) |
| `/og.png` | a imagem de partilha 1200×630 |
| `/icon.svg`, `/apple-touch-icon.png`, `/icon-512.png` | a marca |
| `/manifest.webmanifest` | para guardar no ecrã inicial |
| `/404.html` | o que não existe, dito com palavras |

## O que o endereço NÃO é

O Órbita faz trabalho real com a **base de dados local**, os **motores de IA** e os **conectores MCP da
máquina de quem o usa** (`data/`, `office.config.json`, `claude mcp list`). Nada disso existe num
servidor estático. Por isso, na vista publicada:

- a cena, as salas, os 35 agentes e a circulação dos chefes **funcionam** (é desenho e geometria);
- os monitores dizem **«sem tarefa registada»** — porque não há nenhuma;
- a barra diz **«SÓ VISUALIZAÇÃO»** e os conectores dizem **«sem servidor»**;
- a barra de tarefas responde com o que falta em vez de inventar uma tarefa.

Isto é uma decisão, não uma falha: a regra do projeto é que **nada mostra estado que não aconteceu**.
Uma demo que finge trabalho é pior do que uma demo que diz que está em casa.

## Para trabalhar a sério (na tua máquina)

```bash
cd agents-office-main
npm ci
cp .env.example .env     # põe uma chave (GEMINI_API_KEY serve) ou entra no Claude Code
npm run release          # marca + build  (ou: node tools/brand.mjs && node build.mjs)
npm start                # http://localhost:4520
```

Aí a barra fica **AO VIVO**, os motores aparecem, os conectores são os que tiveres, as tarefas vivem em
`data/` e o Cérebro lê as tuas notas.

## Como se volta a publicar

1. `git push` para `main` — a integração do Vercel constrói e promove a produção (≈6 s de build).
2. Ou, sem `main`: o mesmo projeto aceita *deployments* de qualquer ramo; o ramo fica com um
   endereço próprio (`orbita-agentes-git-<ramo>-orbita-projetos.vercel.app`).
3. A marca muda-se num sítio só: `node tools/brand.mjs` (lê a paleta de `src/data.js`).

## Limites declarados

- **Sem domínio próprio.** O endereço é `…vercel.app`. Um domínio à escolha precisa de DNS (A/CNAME)
  configurado pelo dono; a partir daí é um clique em *Domains*.
- **Sem contas nem base de dados na nuvem.** O `/api/*` não existe no estático — é por isso que a
  página diz «só visualização». Levar o escritório inteiro para a nuvem é outro trabalho (servidor,
  sessões, base de dados, motores) e não foi feito por baixo de um lançamento.
- **A imagem de partilha é desenhada pelo rasterizador do repositório**: plana, sem sombras nem LED.
  Mostra a planta real (é o que interessa a 1200×630), não um render de marketing.
- **`prefers-reduced-motion`**: a cena abranda, não pára — a luz das salas é a vida do escritório.
