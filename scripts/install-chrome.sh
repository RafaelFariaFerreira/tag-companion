#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="/usr/share/google-chrome/extensions"
EXT_ID="egmjankingjjgmejioahbceegfpdoife"
CRX_SRC="$ROOT_DIR/release/tag-companion.crx"
CRX_DEST="$EXT_DIR/tag-companion.crx"

if [[ ! -f "$CRX_SRC" ]]; then
  echo "Arquivo $CRX_SRC não encontrado. Rode pnpm build primeiro." >&2
  exit 1
fi

mkdir -p "$EXT_DIR"
cp "$CRX_SRC" "$CRX_DEST"
chmod 644 "$CRX_DEST"

cat > "$EXT_DIR/$EXT_ID.json" <<EOF
{
  "external_crx": "$CRX_DEST",
  "external_version": "0.1.0"
}
EOF
chmod 644 "$EXT_DIR/$EXT_ID.json"

echo "Tag Companion ($EXT_ID) instalado em $EXT_DIR."
echo "Reinicie o Google Chrome para a extensão aparecer automaticamente."
