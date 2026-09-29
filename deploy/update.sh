#!/usr/bin/env bash
#
# Deploy completo GestorVend (VPS): permissões, código main, dependências,
# migrations (central + tenant + todos), build API+web, PM2 e validação.
#
# Uso recomendado (como root, na raiz do repo ou com APP_DIR):
#   bash deploy/update.sh
#
# Como usuário deploy (sem chown; só se o dono dos arquivos já for deploy):
#   bash deploy/update.sh --no-chown
#
# Opções:
#   --no-chown     não roda chown (obrigatório quando já é o usuário deploy)
#   --skip-nginx   não recarrega o Nginx ao final (só root)
#   --no-migrate   build/restart sem migrations
#   -h, --help     ajuda
#
# Variáveis de ambiente:
#   APP_DIR=/var/www/gestorvend
#   DEPLOY_USER=deploy
#   GIT_BRANCH=main
#   PM2_USER, PM2_APP, API_PORT  (repasse para restart-api.sh)

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
GIT_BRANCH="${GIT_BRANCH:-main}"
GIT_REMOTE="${GIT_REMOTE:-origin}"

do_chown=1
do_nginx=1
do_migrate=1
inner=0

for arg in "$@"; do
  case "$arg" in
    --no-chown) do_chown=0 ;;
    --skip-nginx) do_nginx=0 ;;
    --no-migrate) do_migrate=0 ;;
    --deploy-user) inner=1 ;;
    -h|--help)
      sed -n '3,22p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Argumento desconhecido: $arg (use -h)" >&2
      exit 2
      ;;
  esac
done

log() { printf '\n== %s\n' "$*"; }
fail() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

read_app_version() {
  local f="$APP_DIR/apps/web/src/version.ts"
  [ -f "$f" ] || fail "Arquivo ausente: $f"
  sed -n "s/.*APP_VERSION = '\\([^']*\\)'.*/\\1/p" "$f" | head -1
}

verify_web_dist_version() {
  local ver="$1"
  local found=0
  local js
  for js in "$APP_DIR"/apps/web/dist/assets/*.js; do
    [ -f "$js" ] || continue
    if grep -q "$ver" "$js" 2>/dev/null; then
      found=1
      break
    fi
  done
  [ "$found" -eq 1 ] || fail "apps/web/dist não contém a versão $ver — build do front falhou ou dist antigo."
}

deploy_as_user() {
  log "Diretório: $APP_DIR | branch: $GIT_REMOTE/$GIT_BRANCH | usuário: $(id -un)"

  cd "$APP_DIR"

  log "Atualizando código (origin/$GIT_BRANCH)"
  git fetch "$GIT_REMOTE" "$GIT_BRANCH"
  # Descarta lock local do servidor (npm ci regenera a partir do repo).
  git checkout -- package-lock.json 2>/dev/null || true
  git reset --hard "$GIT_REMOTE/$GIT_BRANCH"
  echo "Commit: $(git log -1 --oneline)"

  local ver
  ver="$(read_app_version)"
  echo "Versão esperada (version.ts): v$ver"

  log "Instalando dependências (npm ci)"
  npm ci

  log "Build, migrations e restart (restart-api.sh)"
  local migrate_flag=()
  [ "$do_migrate" -eq 1 ] && migrate_flag=(--migrate)
  bash "$APP_DIR/deploy/restart-api.sh" "${migrate_flag[@]}"

  log "Validando front compilado"
  verify_web_dist_version "$ver"
  echo "Front OK: v$ver presente em apps/web/dist/assets"

  echo
  echo "Deploy concluído. Confira no navegador (aba anônima se necessário): sidebar v$ver"
}

fix_permissions_root() {
  log "Permissões: chown -R $DEPLOY_USER:$DEPLOY_USER $APP_DIR"
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

  # dist da API criado como root quebra prisma:generate (EACCES).
  if [ -d "$APP_DIR/apps/api/dist" ]; then
    log "Removendo apps/api/dist (rebuild limpo)"
    rm -rf "$APP_DIR/apps/api/dist"
  fi
}

reload_nginx_root() {
  command -v nginx >/dev/null 2>&1 || return 0
  if nginx -t 2>/dev/null; then
    log "Recarregando Nginx"
    systemctl reload nginx
  else
    echo "AVISO: nginx -t falhou — recarregue manualmente após corrigir a config."
  fi
}

# --- Entrada ---

current_user="$(id -un)"

if [ "$inner" -eq 1 ]; then
  deploy_as_user
  exit 0
fi

if [ "$current_user" = "$DEPLOY_USER" ]; then
  [ "$do_chown" -eq 1 ] && echo "Nota: rodando como $DEPLOY_USER (--no-chown implícito)." >&2
  deploy_as_user
  exit 0
fi

if [ "$current_user" != "root" ]; then
  fail "Execute como root (recomendado) ou como $DEPLOY_USER com --no-chown. Usuário atual: $current_user"
fi

[ -d "$APP_DIR" ] || fail "APP_DIR inexistente: $APP_DIR"
id "$DEPLOY_USER" >/dev/null 2>&1 || fail "Usuário $DEPLOY_USER não existe."

if [ "$do_chown" -eq 1 ]; then
  fix_permissions_root
fi

log "Executando deploy como $DEPLOY_USER"
inner_args=(--deploy-user --no-chown)
[ "$do_migrate" -eq 0 ] && inner_args+=(--no-migrate)
sudo -u "$DEPLOY_USER" env \
  APP_DIR="$APP_DIR" \
  DEPLOY_USER="$DEPLOY_USER" \
  GIT_BRANCH="$GIT_BRANCH" \
  GIT_REMOTE="$GIT_REMOTE" \
  PM2_USER="${PM2_USER:-}" \
  PM2_APP="${PM2_APP:-}" \
  API_PORT="${API_PORT:-}" \
  NODE_BIN="${NODE_BIN:-}" \
  bash "$APP_DIR/deploy/update.sh" "${inner_args[@]}"

if [ "$do_nginx" -eq 1 ]; then
  reload_nginx_root
fi

log "Finalizado (root)."
