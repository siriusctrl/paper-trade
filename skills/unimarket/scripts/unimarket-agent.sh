#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3100}"
API_BASE="${BASE_URL%/}/api"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing dependency: $1" >&2
    exit 1
  }
}

need curl
need jq

auth_arg() {
  if [[ -z "${API_KEY:-}" ]]; then
    echo "API_KEY is required for this command" >&2
    exit 1
  fi
  printf "Authorization: Bearer %s" "$API_KEY"
}

json_get() {
  local path="${1:?path required}"
  curl -sS "${API_BASE}${path}" -H "$(auth_arg)" | jq .
}

json_post() {
  local path="${1:?path required}"
  local payload="${2:?payload required}"
  local idem_key="${3:-}"
  if [[ -n "$idem_key" ]]; then
    curl -sS -X POST "${API_BASE}${path}" \
      -H "$(auth_arg)" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: ${idem_key}" \
      -d "$payload" | jq .
    return
  fi
  curl -sS -X POST "${API_BASE}${path}" \
    -H "$(auth_arg)" \
    -H "Content-Type: application/json" \
    -d "$payload" | jq .
}

json_delete() {
  local path="${1:?path required}"
  local payload="${2:?payload required}"
  local idem_key="${3:-}"
  if [[ -n "$idem_key" ]]; then
    curl -sS -X DELETE "${API_BASE}${path}" \
      -H "$(auth_arg)" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: ${idem_key}" \
      -d "$payload" | jq .
    return
  fi
  curl -sS -X DELETE "${API_BASE}${path}" \
    -H "$(auth_arg)" \
    -H "Content-Type: application/json" \
    -d "$payload" | jq .
}

usage() {
  cat <<'EOF'
unimarket-agent.sh - endpoint helper for agents

Environment:
  BASE_URL   default: http://localhost:3100
  API_KEY    required for authenticated commands

Commands:
  register [user_name]
  markets
  search <market> [query] [limit] [offset]
  quote <market> <symbol>
  quotes <market> <symbols_csv>
  orderbook <market> <symbol>
  orderbooks <market> <symbols_csv>
  resolve <market> <symbol>
  buy <market> <symbol> <quantity> <reasoning> [limit_price] [idempotency_key]
  sell <market> <symbol> <quantity> <reasoning> [limit_price] [idempotency_key]
  cancel <order_id> <reasoning> [idempotency_key]
  orders [query_string]
  account
  portfolio
  positions [query_string]
  timeline [limit] [offset]
  journal-add <content> [tags_csv] [idempotency_key]
  journal-list [query_string]
  reconcile <reasoning>
  events [since_event_id]
EOF
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  register)
    user_name="${1:-agent-$(date +%s)}"
    payload="$(jq -nc --arg userName "$user_name" '{userName: $userName}')"
    response="$(curl -sS -X POST "${API_BASE}/auth/register" -H "Content-Type: application/json" -d "$payload")"
    echo "$response" | jq .

    api_key="$(echo "$response" | jq -r '.apiKey // empty')"
    user_id="$(echo "$response" | jq -r '.userId // empty')"
    account_id="$(echo "$response" | jq -r '.account.id // empty')"
    if [[ -n "$api_key" ]]; then
      cat <<EOF

# export for current shell:
export API_KEY=${api_key}
export USER_ID=${user_id}
export ACCOUNT_ID=${account_id}
EOF
    fi
    ;;
  markets)
    json_get "/markets"
    ;;
  search)
    market="${1:?market required}"
    query="${2:-}"
    limit="${3:-20}"
    offset="${4:-0}"
    if [[ -n "$query" ]]; then
      json_get "/markets/${market}/search?q=$(printf '%s' "$query" | jq -sRr @uri)&limit=${limit}&offset=${offset}"
    else
      json_get "/markets/${market}/search?limit=${limit}&offset=${offset}"
    fi
    ;;
  quote)
    market="${1:?market required}"
    symbol="${2:?symbol required}"
    json_get "/markets/${market}/quote?symbol=${symbol}"
    ;;
  quotes)
    market="${1:?market required}"
    symbols="${2:?symbols csv required}"
    json_get "/markets/${market}/quotes?symbols=${symbols}"
    ;;
  orderbook)
    market="${1:?market required}"
    symbol="${2:?symbol required}"
    json_get "/markets/${market}/orderbook?symbol=${symbol}"
    ;;
  orderbooks)
    market="${1:?market required}"
    symbols="${2:?symbols csv required}"
    json_get "/markets/${market}/orderbooks?symbols=${symbols}"
    ;;
  resolve)
    market="${1:?market required}"
    symbol="${2:?symbol required}"
    json_get "/markets/${market}/resolve?symbol=${symbol}"
    ;;
  buy|sell)
    market="${1:?market required}"
    symbol="${2:?symbol required}"
    quantity="${3:?quantity required}"
    reasoning="${4:?reasoning required}"
    limit_price="${5:-}"
    idem_key="${6:-}"
    side="$cmd"
    if [[ -n "$limit_price" ]]; then
      payload="$(jq -nc \
        --arg market "$market" \
        --arg symbol "$symbol" \
        --arg side "$side" \
        --arg reasoning "$reasoning" \
        --argjson quantity "$quantity" \
        --argjson limitPrice "$limit_price" \
        '{market:$market,symbol:$symbol,side:$side,type:"limit",quantity:$quantity,limitPrice:$limitPrice,reasoning:$reasoning}')"
    else
      payload="$(jq -nc \
        --arg market "$market" \
        --arg symbol "$symbol" \
        --arg side "$side" \
        --arg reasoning "$reasoning" \
        --argjson quantity "$quantity" \
        '{market:$market,symbol:$symbol,side:$side,type:"market",quantity:$quantity,reasoning:$reasoning}')"
    fi
    json_post "/orders" "$payload" "$idem_key"
    ;;
  cancel)
    order_id="${1:?order id required}"
    reasoning="${2:?reasoning required}"
    idem_key="${3:-}"
    payload="$(jq -nc --arg reasoning "$reasoning" '{reasoning:$reasoning}')"
    json_delete "/orders/${order_id}" "$payload" "$idem_key"
    ;;
  orders)
    query_string="${1:-}"
    if [[ -n "$query_string" ]]; then
      json_get "/orders?${query_string}"
    else
      json_get "/orders"
    fi
    ;;
  account)
    json_get "/account"
    ;;
  portfolio)
    json_get "/account/portfolio"
    ;;
  positions)
    query_string="${1:-}"
    if [[ -n "$query_string" ]]; then
      json_get "/positions?${query_string}"
    else
      json_get "/positions"
    fi
    ;;
  timeline)
    limit="${1:-20}"
    offset="${2:-0}"
    json_get "/account/timeline?limit=${limit}&offset=${offset}"
    ;;
  journal-add)
    content="${1:?content required}"
    tags_csv="${2:-}"
    idem_key="${3:-}"
    if [[ -n "$tags_csv" ]]; then
      tags_json="$(printf '%s' "$tags_csv" | jq -R 'split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0))')"
      payload="$(jq -nc --arg content "$content" --argjson tags "$tags_json" '{content:$content,tags:$tags}')"
    else
      payload="$(jq -nc --arg content "$content" '{content:$content}')"
    fi
    json_post "/journal" "$payload" "$idem_key"
    ;;
  journal-list)
    query_string="${1:-limit=20&offset=0}"
    json_get "/journal?${query_string}"
    ;;
  reconcile)
    reasoning="${1:?reasoning required}"
    payload="$(jq -nc --arg reasoning "$reasoning" '{reasoning:$reasoning}')"
    json_post "/orders/reconcile" "$payload"
    ;;
  events)
    since="${1:-}"
    if [[ -n "$since" ]]; then
      curl -sS -N "${API_BASE}/events?since=${since}" -H "$(auth_arg)"
    else
      curl -sS -N "${API_BASE}/events" -H "$(auth_arg)"
    fi
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "unknown command: ${cmd}" >&2
    usage
    exit 1
    ;;
esac

