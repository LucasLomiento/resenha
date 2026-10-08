#!/usr/bin/env bash
# Guarda as chaves do Cloudflare Realtime (SFU e TURN) e o token de leitura das
# análises (pra conferir o consumo do mês) como secrets do Worker.
# As do SFU e o das análises também vão pro server/.dev.vars, pro e2e com RESENHA_E2E_SFU=1.
# Os valores são lidos sem aparecer na tela e só passam pro wrangler.
#
# Uso: bash server/scripts/realtime-keys.sh (de preferência numa janela própria).
# Com RESENHA_KEYS_LOG=<arquivo>, anota o resultado de cada passo (código e motivo
# do Cloudflare, nunca as chaves).
set -u
cd "$(dirname "$0")/.." || exit 1

log() {
  [ -n "${RESENHA_KEYS_LOG:-}" ] && printf '%s %s\n' "$(date +%T)" "$*" >> "$RESENHA_KEYS_LOG"
  return 0
}

ask() {
  local value
  read -rsp "$1: " value
  echo >&2
  # Sem espaços nem quebras de linha que vierem junto ao colar.
  printf '%s' "$value" | tr -d '[:space:]'
}

# Confere a chave: devolve o código HTTP e guarda a resposta (pra mostrar o motivo se recusar).
reply_file=$(mktemp)
trap 'rm -f "$reply_file"' EXIT
check() {
  if [ -n "${3:-}" ]; then
    curl -s -o "$reply_file" -w '%{http_code}' -X POST -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "$3" "$1"
  else
    curl -s -o "$reply_file" -w '%{http_code}' -X POST -H "Authorization: Bearer $2" "$1"
  fi
}

# O motivo que o Cloudflare deu (a mensagem dele, sem as chaves).
why() {
  jq -r '.errorDescription // .errors[0].message // .error // empty' "$reply_file" 2>/dev/null | head -c 300
}

put() {
  if printf '%s' "$2" | npx wrangler secret put "$1" >/dev/null 2>&1; then
    echo "  $1 guardado no Worker."
    log "$1 guardado"
  else
    echo "  $1: o wrangler falhou (rode de novo depois)."
    log "$1: wrangler falhou"
  fi
}

# Troca (ou acrescenta) linhas do .dev.vars sem mexer nas outras.
dev_vars() {
  local vars=.dev.vars
  touch "$vars"
  local keep=()
  for pair in "$@"; do keep+=(-e "^${pair%%=*}="); done
  grep -v "${keep[@]}" "$vars" > "$vars.tmp" || true
  for pair in "$@"; do printf '%s\n' "$pair" >> "$vars.tmp"; done
  mv "$vars.tmp" "$vars" && chmod 600 "$vars"
}

ok_code() { [ "$1" = 200 ] || [ "$1" = 201 ]; }

log 'janela aberta'
echo 'Chaves do Cloudflare Realtime pro Resenha'
echo 'Cole cada valor e aperte Enter (nada aparece na tela). Vazio pula o passo.'
echo

echo '1. Serverless SFU (Realtime → Serverless SFU → o app criado)'
while :; do
  app_id=$(ask '   App ID')
  [ -z "$app_id" ] && { echo '  Pulado.'; log 'sfu: pulado'; break; }
  app_secret=$(ask '   App Token')
  [ -z "$app_secret" ] && { echo '  Pulado.'; log 'sfu: pulado'; break; }
  code=$(check "https://rtc.live.cloudflare.com/v1/apps/$app_id/sessions/new" "$app_secret")
  if ok_code "$code"; then
    echo '  O Cloudflare aceitou a chave do SFU.'
    log "sfu: aceito (HTTP $code)"
    put REALTIME_APP_ID "$app_id"
    put REALTIME_APP_SECRET "$app_secret"
    dev_vars "REALTIME_APP_ID=$app_id" "REALTIME_APP_SECRET=$app_secret"
    echo '  Também no server/.dev.vars (pro e2e).'
    break
  fi
  reason=$(why)
  echo "  O Cloudflare recusou (HTTP $code): $reason"
  log "sfu: recusado HTTP $code: $reason (app id com ${#app_id} caracteres, token com ${#app_secret})"
  echo '  Tente de novo (ou Enter vazio pra pular).'
done
echo

echo '2. TURN (Realtime → TURN Server → a chave criada; se já guardou, Enter pula)'
while :; do
  turn_id=$(ask '   Key ID')
  [ -z "$turn_id" ] && { echo '  Pulado.'; log 'turn: pulado'; break; }
  turn_token=$(ask '   API Token')
  [ -z "$turn_token" ] && { echo '  Pulado.'; log 'turn: pulado'; break; }
  code=$(check "https://rtc.live.cloudflare.com/v1/turn/keys/$turn_id/credentials/generate-ice-servers" "$turn_token" '{"ttl":60}')
  if ok_code "$code"; then
    echo '  O Cloudflare aceitou a chave do TURN.'
    log "turn: aceito (HTTP $code)"
    put TURN_KEY_ID "$turn_id"
    put TURN_KEY_API_TOKEN "$turn_token"
    break
  fi
  reason=$(why)
  echo "  O Cloudflare recusou (HTTP $code): $reason"
  log "turn: recusado HTTP $code: $reason"
  echo '  Tente de novo (ou Enter vazio pra pular).'
done
echo

echo '3. Token só de leitura das análises (My Profile → API Tokens → Create Token →'
echo '   Custom token → Analytics & Logs → Account Analytics → Read)'
echo '   O servidor confere de hora em hora quanto o Cloudflare mediu e corta antes do grátis acabar.'
account=$(npx wrangler whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)
[ -z "$account" ] && { echo '  Não achei a conta pelo wrangler whoami.'; log 'analytics: sem conta no whoami'; }
while [ -n "$account" ]; do
  analytics=$(ask '   Token')
  [ -z "$analytics" ] && { echo '  Pulado.'; log 'analytics: pulado'; break; }
  today=$(date -u +%F)
  query=$(jq -cn --arg a "$account" --arg d "$today" \
    '{query: "{ viewer { accounts(filter: { accountTag: \"\($a)\" }) { callsTurnUsageAdaptiveGroups(limit: 1, filter: { date_geq: \"\($d)\", date_leq: \"\($d)\" }) { sum { egressBytes } } } } }"}')
  code=$(check https://api.cloudflare.com/client/v4/graphql "$analytics" "$query")
  if ok_code "$code" && jq -e '(.errors // []) == [] and (.data.viewer.accounts | length) == 1' "$reply_file" >/dev/null 2>&1; then
    echo '  O Cloudflare aceitou o token.'
    log "analytics: aceito (HTTP $code)"
    put CF_ACCOUNT_ID "$account"
    put CF_ANALYTICS_TOKEN "$analytics"
    dev_vars "CF_ACCOUNT_ID=$account" "CF_ANALYTICS_TOKEN=$analytics"
    break
  fi
  reason=$(why)
  echo "  O Cloudflare recusou (HTTP $code): $reason"
  log "analytics: recusado HTTP $code: $reason"
  echo '  Tente de novo (ou Enter vazio pra pular).'
done

log 'fim'
echo
read -rp 'Pronto. Enter pra fechar.' _
