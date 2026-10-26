#!/usr/bin/env bash
#
# Deploy completo GestorVend (VPS): permissões, código main, dependências,
# migrations (central + tenant + todos), build API+web, PM2 e validação.
#
# Uso recomendado (como root, na raiz do repo ou com APP_DIR):
#   bash deploy/update.sh
# Como root NÃO usa sudo — troca de usuário via runuser/su (sem senha).
#
# Como usuário deploy (sem chown; só se o dono dos arquivos já for deploy):
#   bash deploy/update.sh --no-chown
#
# Opções:
#   --no-chown     não roda chown (obrigatório quando já é o usuário deploy)
#   --skip-nginx   não recarrega o Nginx ao final (só root)
#   --no-migrate   build/restart sem migrations
#   --skip-restart só build/migrate; o PM2 é reiniciado pelo wrapper root
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
do_git=1
do_restart=1
inner=0

for arg in "$@"; do
  case "$arg" in
    --no-chown) do_chown=0 ;;
    --skip-nginx) do_nginx=0 ;;
    --no-migrate) do_migrate=0 ;;
    --skip-git) do_git=0 ;;
    --skip-restart) do_restart=0 ;;
    --deploy-user) inner=1 ;;
    -h|--help)
      sed -n '3,24p' "${BASH_SOURCE[0]}"
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

home_of_user() {
  getent passwd "$1" | cut -d: -f6
}

# Troca de usuário sem sudo (sudo pede senha mesmo como root em várias VPS).
run_as_user() {
  local target="$1"
  shift
  if [ "$(id -un)" = "$target" ]; then
    env "$@"
    return
  fi
  if [ "$(id -u)" -ne 0 ]; then
    fail "não posso executar como $target sem senha (usuário atual: $(id -un)). Rode como root."
  fi
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$target" -- env "$@"
    return
  fi
  su -s /bin/bash "$target" -c "$(printf '%q ' env "$@")"
}

# Node/npm do nvm do usuário deploy (runuser/su não carregam .bashrc — caminho explícito).
detect_node_bin() {
  local user="$1" home cand
  home="$(home_of_user "$user")"
  if [ -n "$home" ]; then
    cand="$(ls -d "$home"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
    if [ -n "$cand" ] && [ -x "$cand/npm" ] && [ -x "$cand/node" ]; then
      echo "$cand"
      return
    fi
  fi
  if command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
    dirname "$(command -v npm)"
  fi
}

ensure_node_toolchain() {
  local detect_as="${1:-$(id -un)}"
  if [ -z "${NODE_BIN:-}" ]; then
    NODE_BIN="$(detect_node_bin "$detect_as" || true)"
  fi
  [ -n "${NODE_BIN:-}" ] || fail "Node/npm não encontrado (usuário $detect_as). Informe NODE_BIN=/home/deploy/.nvm/versions/node/vXX/bin"
  export NODE_BIN
  export PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
  command -v npm >/dev/null 2>&1 || fail "npm indisponível (NODE_BIN=$NODE_BIN). Verifique nvm do usuário $detect_as."
  log "Node $( "$NODE_BIN/node" -v ) | npm $( "$NODE_BIN/npm" -v ) | PATH=$NODE_BIN"
}

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

reexec_deploy_after_git() {
  local -a extra=(--deploy-user --no-chown --skip-git)
  [ "$do_migrate" -eq 0 ] && extra+=(--no-migrate)
  [ "$do_restart" -eq 0 ] && extra+=(--skip-restart)
  exec env \
    APP_DIR="$APP_DIR" \
    DEPLOY_USER="$DEPLOY_USER" \
    GIT_BRANCH="$GIT_BRANCH" \
    GIT_REMOTE="$GIT_REMOTE" \
    NODE_BIN="$NODE_BIN" \
    PATH="$PATH" \
    PM2_USER="${PM2_USER:-}" \
    PM2_APP="${PM2_APP:-}" \
    API_PORT="${API_PORT:-}" \
    bash "$APP_DIR/deploy/update.sh" "${extra[@]}"
}

deploy_as_user() {
  ensure_node_toolchain "${DEPLOY_USER:-$(id -un)}"
  log "Diretório: $APP_DIR | branch: $GIT_REMOTE/$GIT_BRANCH | usuário: $(id -un)"

  cd "$APP_DIR"

  if [ "$do_git" -eq 1 ]; then
    log "Atualizando código (origin/$GIT_BRANCH)"
    git fetch "$GIT_REMOTE" "$GIT_BRANCH"
    git checkout -- package-lock.json 2>/dev/null || true
    git reset --hard "$GIT_REMOTE/$GIT_BRANCH"
    echo "Commit: $(git log -1 --oneline)"
    # reset --hard troca deploy/update.sh no disco; recarrega o script antes do npm ci.
    reexec_deploy_after_git
  fi

  local ver
  ver="$(read_app_version)"
  echo "Versão esperada (version.ts): v$ver"

  log "Instalando dependências (npm ci)"
  "$NODE_BIN/npm" ci

  log "Build, migrations e restart (restart-api.sh)"
  local migrate_flag=()
  [ "$do_migrate" -eq 1 ] && migrate_flag=(--migrate)
  if [ "$do_restart" -eq 1 ]; then
    bash "$APP_DIR/deploy/restart-api.sh" "${migrate_flag[@]}"
  else
    bash "$APP_DIR/deploy/restart-api.sh" "${migrate_flag[@]}" --no-restart
  fi

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

ensure_nginx_upload_limit() {
  command -v nginx >/dev/null 2>&1 || return 0
  if [ ! -d /etc/nginx/conf.d ]; then
    echo "AVISO: /etc/nginx/conf.d ausente — defina client_max_body_size 20m no site do Nginx."
    return 0
  fi
  local snippet="/etc/nginx/conf.d/gestorvend-uploads.conf"
  if [ -f "$snippet" ] && grep -q 'client_max_body_size' "$snippet"; then
    return 0
  fi
  cat > "$snippet" <<'EOF'
# Uploads GestorVend (logo, certificado A1, XML, CSV). Padrão do Nginx é 1m (413).
client_max_body_size 20m;
EOF
  echo "Nginx: criado $snippet (client_max_body_size 20m)"
}

reload_nginx_root() {
  command -v nginx >/dev/null 2>&1 || return 0
  ensure_nginx_upload_limit
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
  NODE_BIN="${NODE_BIN:-$(detect_node_bin "$DEPLOY_USER" || true)}"
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

NODE_BIN="${NODE_BIN:-$(detect_node_bin "$DEPLOY_USER" || true)}"
[ -n "${NODE_BIN:-}" ] || fail "Node/npm do usuário $DEPLOY_USER não encontrado (nvm?). Ex.: NODE_BIN=/home/deploy/.nvm/versions/node/v20.20.2/bin"

log "Executando build como $DEPLOY_USER (NODE_BIN=$NODE_BIN, sem sudo)"
inner_args=(--deploy-user --no-chown --skip-restart)
[ "$do_migrate" -eq 0 ] && inner_args+=(--no-migrate)
run_as_user "$DEPLOY_USER" \
  APP_DIR="$APP_DIR" \
  DEPLOY_USER="$DEPLOY_USER" \
  GIT_BRANCH="$GIT_BRANCH" \
  GIT_REMOTE="$GIT_REMOTE" \
  PM2_USER="${PM2_USER:-}" \
  PM2_APP="${PM2_APP:-}" \
  API_PORT="${API_PORT:-}" \
  NODE_BIN="$NODE_BIN" \
  PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" \
  HOME="$(home_of_user "$DEPLOY_USER")" \
  bash "$APP_DIR/deploy/update.sh" "${inner_args[@]}"

log "Reiniciando a API no PM2 (como root, sem sudo)"
bash "$APP_DIR/deploy/restart-api.sh" --no-build

if [ "$do_nginx" -eq 1 ]; then
  reload_nginx_root
fi

log "Finalizado (root)."
