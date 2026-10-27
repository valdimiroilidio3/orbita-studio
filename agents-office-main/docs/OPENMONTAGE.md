# OpenMontage no Órbita — o estúdio de media

O **OpenMontage** (AGPL-3.0, © calesthio) é um sistema de produção de vídeo com agentes:
cinematográfico, documentário, explicador animado, animação, podcast, dobragem, avatar,
talking head, personagem animada, clips, híbrido, demonstração de ecrã. Faz vídeo, imagem,
áudio, animação e conteúdo 3D.

## Porque não corre na Vercel

| precisa | porquê |
|---|---|
| Python 3.10+ | é o motor dos pipelines |
| **FFmpeg** | corta, mistura, codifica — sem ele não há ficheiro final |
| Node 18+ | Remotion/HyperFrames compõem as cenas |
| chaves pagas | Veo, Kling (via fal.ai), ElevenLabs, Lyria, HeyGen… nos pipelines que as usam |

Uma função da Vercel não tem FFmpeg, não corre renders de 20 minutos e não guarda
ficheiros. Portanto o desenho é **fila na nuvem + worker onde há máquina**:

```
Mesa → Estúdio          POST /api/rpc  { caminho: "/media/trabalhos" }
                              │
                              ▼
                    orbita_media_jobs  (Supabase, RLS fechado)
                              │  o worker puxa com o próprio token
                              ▼
   scripts/estudio-worker.mjs ──▶ OpenMontage instalado (venv, ffmpeg, node)
                              │
                              ▼
        POST /media/:id/concluir  { url, resposta }  ou  /falhar { motivo }
```

## Instalar (numa máquina tua, não na Vercel)

```bash
./scripts/instalar-openmontage.sh              # instala em ~/OpenMontage
# ou
./scripts/instalar-openmontage.sh /opt/OpenMontage
```

O script clona o repositório oficial, cria a `venv`, instala `requirements.txt` e mostra o
diagnóstico (`python render_demo.py --list`). **A licença AGPL-3.0 é a razão de o
OpenMontage não estar copiado para dentro deste repositório**: ele vive onde o worker corre
e é chamado por fora.

## Ligar o worker à mesa

1. Na Vercel → Settings → Environment Variables, cria:
   - `MEDIA_WORKER_TOKEN` — um segredo teu, com 16+ caracteres (Production e Preview).
2. Na máquina com o OpenMontage:

```bash
ORBITA_URL=https://orbita-agentes.vercel.app \
MEDIA_WORKER_TOKEN=<o mesmo segredo> \
OPENMONTAGE_DIR=$HOME/OpenMontage \
node scripts/estudio-worker.mjs
```

3. Abre `Mesa → IA → Estúdio de media`. A faixa passa a «Worker vivo» e mostra a versão, o
   commit e se o FFmpeg está lá.

Modos úteis:

```bash
node scripts/estudio-worker.mjs --doutor    # imprime o que está instalado e sai
node scripts/estudio-worker.mjs --uma-vez   # processa no máximo um trabalho
```

## O que o worker faz — e o que não faz

Está implementado, e foi provado nesta máquina:

- detecta o OpenMontage e corre `python render_demo.py --list` → demos disponíveis;
- envia um **sinal** a cada ciclo (versão, commit, demos, `python`/`ffmpeg`/`node`/`git`);
- pega um trabalho da fila, marca `a_correr` do lado do servidor e corre
  `python render_demo.py <demo>` com tempo limite de 20 minutos;
- devolve o caminho do `.mp4` produzido, ou a **saída real** do comando quando falha.

Não faz (e diz-se na interface):

- não conduz os pipelines criativos que precisam de um agente a escrever guião e planos —
  esses vivem no fluxo do OpenMontage com um assistente de código dentro do projecto;
- não publica o ficheiro: o `.mp4` fica no disco do worker; a mesa mostra o caminho;
- não inventa um resultado quando o FFmpeg falta — devolve `falhou` com a razão.

## Diagnóstico feito aqui (27 out 2026)

```
$ OPENMONTAGE_DIR=… node scripts/estudio-worker.mjs --doutor
{
  "versao": "0.1.0",
  "pipelines": ["code-to-screen", "focusflow-pitch", "world-in-numbers"],
  "ferramentas": { "python": true, "ffmpeg": false, "node": true, "git": true },
  "erroDemos": null
}
```

Conclusão honesta: o OpenMontage **instala e responde** (venv + `requirements.txt`,
`render_demo.py --list` a listar três demos zero-chave). Nesta máquina **não há FFmpeg**,
por isso nenhum `.mp4` foi produzido aqui — e é exactamente isso que o worker reporta.

## Alternativa: Backlot

O OpenMontage traz o **Backlot**, o storyboard local (`python -m backlot serve`), útil para
ver o trabalho a acontecer enquanto o worker corre. Não é necessário para a fila funcionar.
