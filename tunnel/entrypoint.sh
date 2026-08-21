#!/bin/sh
set -eu

cloudflared "$@" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"

  case "$line" in
    *trycloudflare.com*)
      url=$(printf '%s\n' "$line" | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | head -n 1 || true)
      if [ -n "$url" ]; then
        printf '\n============================================================\n'
        printf ' URL PÚBLICA DO JOGO\n\n %s\n' "$url"
        printf ' Compartilhe este link com os jogadores.\n'
        printf '============================================================\n\n'
      fi
      ;;
  esac
done
