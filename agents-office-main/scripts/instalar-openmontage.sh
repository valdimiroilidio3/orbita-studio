#!/usr/bin/env bash
# ===========================================================================
# 1.19.0 · instalar o OpenMontage (AGPL-3.0) como sidecar do estúdio
#
#   ./scripts/instalar-openmontage.sh [destino]
#
# Instala FORA deste repositório (por omissão ~/OpenMontage) porque a licença
# dele é AGPL-3.0: chamamos por fora, não copiamos para dentro do Órbita.
# Requer: git, python3 (3.10+), node 18+, ffmpeg.
# ===========================================================================
set -euo pipefail

DESTINO="${1:-$HOME/OpenMontage}"

echo "==> destino: $DESTINO"
for c in git python3 node; do
  command -v "$c" >/dev/null || { echo "falta $c"; exit 1; }
done
if ! command -v ffmpeg >/dev/null; then
  echo "!! falta ffmpeg — sem ele os renders falham."
  echo "   Debian/Ubuntu: sudo apt install ffmpeg    macOS: brew install ffmpeg"
fi

if [ ! -d "$DESTINO/.git" ]; then
  git clone https://github.com/calesthio/OpenMontage.git "$DESTINO"
else
  echo "==> já existe; a actualizar"
  git -C "$DESTINO" pull --ff-only || echo "!! não actualizei (alterações locais?)"
fi

cd "$DESTINO"
python3 -m venv .venv
. .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo "==> diagnóstico (é isto que o worker envia para a mesa)"
python render_demo.py --list || echo "!! render_demo.py --list falhou"

cat <<TXT

==> pronto. Agora arranca o worker, nesta máquina:

  ORBITA_URL=https://orbita-agentes.vercel.app \\
  MEDIA_WORKER_TOKEN=<o mesmo valor da variável na Vercel> \\
  OPENMONTAGE_DIR=$DESTINO \\
  node $PWD/../agents-office-main/scripts/estudio-worker.mjs

  (o caminho do worker é o deste repositório; ajusta ao teu)

  Ele envia um sinal de vida a cada 20 s, pega trabalhos da fila e devolve o
  resultado real. Sem ffmpeg ou sem chaves dos fornecedores pagos, os
  pipelines que precisam deles falham — e a falha aparece escrita na mesa.
TXT
