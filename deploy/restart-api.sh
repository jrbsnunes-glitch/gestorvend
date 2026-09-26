#!/usr/bin/env bash
#
# Build + restart da API do GestorVend na instância PM2 correta, com validação.
#
# Por que existe: o PM2 é por usuário (cada um tem seu daemon e seu `pm2 list`).
# Reiniciar pela conta errada cria uma segunda instância que nunca consegue a porta
# (EADDRINUSE) enquanto a API real segue com o dist antigo — o deploy "passa" sem
# publicar nada. Este script descobre quem detém a porta e reinicia aquele processo.
#
# Uso (como root, na raiz do projeto):
#   bash deploy/restart-api.sh              # build + restart + validação
#   bash deploy/restart-api.sh --pull       # git pull + npm ci antes do build
#   bash deploy/restart-api.sh --migrate    # migrations (central + tenant + todos) antes do build
#   bash deploy/restart-api.sh --no-build   # só restart + validação
#
# Variáveis opcionais: APP_DIR, PM2_USER, PM2_APP, API_PORT, NODE_BIN

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PM2_APP="${PM2_APP:-gestorvend-api}"
API_PORT="${API_PORT:-3000}"

do_pull=0
do_migrate=0
do_build=1

for arg in "$@"; do
  case "$arg" in
    --pull) do_pull=1 ;;
    --migrate) do_migrate=1 ;;
    --no-build) do_build=0 ;;
    -h|--help) sed -n '3,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n== %s\n' "$*"; }
fail() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

port_owner_pid() {
  ss -ltnp 2>/dev/null | grep ":${API_PORT} " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
}

user_of_pid() {
  ps -o user= -p "$1" 2>/dev/null | tr -d ' '
}

home_of_user() {
  getent passwd "$1" | cut -d: -f6
}

# Usuário do PM2: quem detém a porta; se ninguém, o dono de um daemon PM2 ativo.
detect_pm2_user() {
  local pid user
  pid="$(port_owner_pid || true)"
  if [ -n "${pid:-}" ]; then
    user="$(user_of_pid "$pid")"
    [ -n "$user" ] && { echo "$user"; return; }
  fi
  pid="$(pgrep -f 'PM2 v[0-9].*God Daemon' 2>/dev/null | head -1 || true)"
  if [ -n "${pid:-}" ]; then
    user_of_pid "$pid"
  fi
}

# Diretório bin com node+pm2 do usuário (nvm) ou instalação global do sistema.
detect_node_bin() {
  local user="$1" home cand
  home="$(home_of_user "$user")"
  if [ -n "$home" ]; then
    cand="$(ls -d "$home"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
    if [ -n "$cand" ] && [ -x "$cand/pm2" ] && [ -x "$cand/node" ]; then
      echo "$cand"
      return
    fi
  fi
  if command -v pm2 >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    dirname "$(command -v pm2)"
  fi
}

PM2_USER="${PM2_USER:-$(detect_pm2_user || true)}"
[ -n "${PM2_USER:-}" ] || fail "não identifiquei o usuário do PM2. Informe: PM2_USER=deploy bash $0"

NODE_BIN="${NODE_BIN:-$(detect_node_bin "$PM2_USER" || true)}"
[ -n "${NODE_BIN:-}" ] || fail "não encontrei node+pm2 para o usuário $PM2_USER. Informe NODE_BIN=/caminho/bin"

PM2_USER_HOME="$(home_of_user "$PM2_USER")"

# O pm2 é chamado pelo node em caminho absoluto (o shebang `env node` falha quando o
# PATH herdado aponta para um nvm que o usuário não pode ler, ex.: /root/.nvm).
run_pm2() {
  if [ "$PM2_USER" = "$(id -un)" ]; then
    env PM2_HOME="$PM2_USER_HOME/.pm2" PATH="$NODE_BIN:$PATH" \
      "$NODE_BIN/node" "$NODE_BIN/pm2" "$@"
  else
    sudo -u "$PM2_USER" env \
      HOME="$PM2_USER_HOME" \
      PM2_HOME="$PM2_USER_HOME/.pm2" \
      PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" \
      "$NODE_BIN/node" "$NODE_BIN/pm2" "$@"
  fi
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${API_PORT}$1" || echo 000
}

log "Alvo: $APP_DIR | app PM2 '$PM2_APP' (usuário $PM2_USER) | porta $API_PORT"
echo "node/pm2: $NODE_BIN"

cd "$APP_DIR"

if [ "$do_pull" = 1 ]; then
  log "Atualizando código"
  git pull origin main
  npm ci
fi

if [ "$do_migrate" = 1 ]; then
  log "Migrations (central, template do tenant e todos os tenants)"
  npm run db:migrate:central
  npm run db:migrate:tenant
  npm run tenant:migrate-all -w @gestorvend/api
fi

if [ "$do_build" = 1 ]; then
  log "Build (API + web)"
  npm run build
fi

log "Reiniciando a API"
run_pm2 restart "$PM2_APP" --update-env
run_pm2 save

log "Aguardando a API responder"
health=000
for _ in $(seq 1 30); do
  health="$(http_code /api/health)"
  [ "$health" = "200" ] && break
  sleep 1
done
[ "$health" = "200" ] || fail "/api/health respondeu $health. Veja: run_pm2 logs $PM2_APP"

# 401 = rota existe e exige token; 404 = processo servindo dist antigo.
trend="$(http_code /api/dashboard/sales-trend-month)"

log "Resultado"
echo "health .................. $health"
echo "dashboard/sales-trend ... $trend (401 = ok, 404 = dist antigo no ar)"
run_pm2 list

strays="$(pgrep -fc 'apps/api/dist/src/main.js' 2>/dev/null || echo 0)"
if [ "$strays" -gt 1 ]; then
  echo
  echo "AVISO: $strays processos da API rodando — provável instância duplicada fora deste PM2:"
  pgrep -af 'apps/api/dist/src/main.js' || true
fi

[ "$trend" = "404" ] && fail "a API no ar não conhece rotas desta versão (dist antigo ou processo duplicado)."
exit 0
