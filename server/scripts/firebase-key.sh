#!/usr/bin/env bash
# Guarda a conta de serviço do Firebase (o JSON baixado no console do Firebase: Configurações
# do projeto → Contas de serviço → Gerar nova chave privada) como o secret FCM_SERVICE_ACCOUNT
# do Worker: é com ela que o servidor manda o push pro celular. O conteúdo vai direto do
# arquivo pro wrangler, sem aparecer na tela; depois o arquivo pode ser apagado.
#
# Uso: bash server/scripts/firebase-key.sh ~/Downloads/<projeto>-firebase-adminsdk-<...>.json
set -euo pipefail
cd "$(dirname "$0")/.."

file="${1:-}"
[ -f "$file" ] || { echo "Uso: bash server/scripts/firebase-key.sh <arquivo .json da conta de serviço>"; exit 1; }
jq -e '.type == "service_account" and (.project_id | length > 0) and (.private_key | startswith("-----BEGIN"))' "$file" > /dev/null \
  || { echo "Esse arquivo não parece a chave de uma conta de serviço do Firebase."; exit 1; }
echo "Projeto: $(jq -r .project_id "$file")"
jq -c . "$file" | npx wrangler secret put FCM_SERVICE_ACCOUNT
echo "Pronto. Pode apagar o $file (o Cloudflare guardou)."
