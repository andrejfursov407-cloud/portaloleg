#!/usr/bin/env bash
# Портал Олега Борисовского: установка на Ubuntu 24.04 одной командой.
# Ставит сайт, nginx, HTTPS (по желанию) и локальную нейросеть Ollama.
#
#   git clone https://github.com/ПОЛЬЗОВАТЕЛЬ/РЕПОЗИТОРИЙ.git && cd РЕПОЗИТОРИЙ
#   sudo DOMAIN=example.com EMAIL=you@example.com ADMIN_EMAIL=you@example.com bash install.sh
#
# или без клонирования:
#   curl -fsSL https://raw.githubusercontent.com/ПОЛЬЗОВАТЕЛЬ/РЕПОЗИТОРИЙ/main/install.sh | \
#     sudo REPO=ПОЛЬЗОВАТЕЛЬ/РЕПОЗИТОРИЙ DOMAIN=example.com EMAIL=you@example.com ADMIN_EMAIL=you@example.com bash
#
# Переменные (все необязательные):
#   ADMIN_EMAIL         почта администратора (иначе администратором станет первый зарегистрированный)
#   DOMAIN, EMAIL       домен и почта для HTTPS (Let's Encrypt)
#   AI_MODEL            модель Ollama (по умолчанию подбирается по объёму памяти, для 8 ГБ: qwen3.5:4b)
#   SKIP_AI=1           не устанавливать нейросеть
#   SWAP_GB             размер файла подкачки, если его нет (по умолчанию 4, 0 — не создавать)
#   ALLOW_REGISTRATION  1 (по умолчанию) или 0
#   MAX_UPLOAD_MB       максимальный размер одного загружаемого файла (по умолчанию 2048)
#   APP_DIR             каталог установки (по умолчанию /opt/portal)
#   REPO, BRANCH        откуда скачать код, если скрипт запущен не из клона (BRANCH по умолчанию main)
#
# Повторный запуск обновляет код и не трогает пользователей, файлы, новости и настройки.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/portal}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
ADMIN_EMAIL="$(echo "${ADMIN_EMAIL:-}" | tr '[:upper:]' '[:lower:]')"
ALLOW_REGISTRATION="${ALLOW_REGISTRATION:-1}"
MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-2048}"
AI_MODEL="${AI_MODEL:-}"
SKIP_AI="${SKIP_AI:-0}"
SWAP_GB="${SWAP_GB:-4}"
REPO="${REPO:-}"
BRANCH="${BRANCH:-main}"
APP_USER="portal"
PORT=3000

[ "$(id -u)" -eq 0 ] || { echo "Запустите от root: sudo bash install.sh"; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "Внимание: скрипт рассчитан на Ubuntu 24.04, у вас ${PRETTY_NAME:-неизвестная система}."

# ---------- проверка параметров ----------
MAILRE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
if [ -n "$ADMIN_EMAIL" ] && ! [[ "$ADMIN_EMAIL" =~ $MAILRE ]]; then echo "ADMIN_EMAIL указан неверно: $ADMIN_EMAIL"; exit 1; fi
if [ -n "$EMAIL" ] && ! [[ "$EMAIL" =~ $MAILRE ]]; then echo "EMAIL указан неверно: $EMAIL"; exit 1; fi
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then echo "DOMAIN указан неверно: $DOMAIN"; exit 1; fi
[[ "$MAX_UPLOAD_MB" =~ ^[1-9][0-9]{0,5}$ ]] || { echo "MAX_UPLOAD_MB должно быть целым числом"; exit 1; }
[[ "$ALLOW_REGISTRATION" =~ ^[01]$ ]] || { echo "ALLOW_REGISTRATION должно быть 0 или 1"; exit 1; }
[[ "$SWAP_GB" =~ ^[0-9]{1,2}$ ]] || { echo "SWAP_GB должно быть числом"; exit 1; }
[[ "$APP_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "APP_DIR указан неверно"; exit 1; }
if [ -n "$AI_MODEL" ] && ! [[ "$AI_MODEL" =~ ^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$ ]]; then echo "AI_MODEL указан неверно"; exit 1; fi
case "$APP_DIR" in /home/*|/root/*) echo "APP_DIR не должен быть в /home или /root (сервис изолирован от них)"; exit 1;; esac

# ---------- откуда брать файлы ----------
SELF="${BASH_SOURCE[0]:-}"
HERE=""
[ -n "$SELF" ] && [ -f "$SELF" ] && HERE="$(cd "$(dirname "$SELF")" && pwd)"
if [ -n "$HERE" ] && [ -f "$HERE/app/server.js" ]; then
  SRC="$HERE"
else
  [ -n "$REPO" ] || { echo "Скрипт запущен не из клона репозитория. Укажите REPO=пользователь/репозиторий"; exit 1; }
  [[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "REPO должен иметь вид пользователь/репозиторий"; exit 1; }
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  echo "==> Скачиваю $REPO ($BRANCH)"
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP" --strip-components=1
  SRC="$TMP"
fi
[ -f "$SRC/app/server.js" ] || { echo "Не найден app/server.js в $SRC"; exit 1; }

# ---------- сведения о сервере ----------
RAM_MB="$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)"
CPUS="$(nproc)"
FREE_GB="$(df -BG --output=avail / | tail -1 | tr -dc '0-9')"
echo "==> Сервер: ядер $CPUS, память ${RAM_MB} МБ, свободно на диске ${FREE_GB} ГБ"
if [ "$SKIP_AI" != "1" ] && [ "$FREE_GB" -lt 10 ]; then echo "Мало места на диске для нейросети (нужно от 10 ГБ). Освободите место или запустите с SKIP_AI=1."; exit 1; fi

echo "==> Установка пакетов"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
PKGS=(nodejs nginx ufw curl ca-certificates zstd)
[ -n "$DOMAIN" ] && PKGS+=(certbot python3-certbot-nginx)
apt-get install -y "${PKGS[@]}"
NODE_BIN="$(command -v node)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "Нужен Node.js 18 или новее (сейчас $NODE_MAJOR)"; exit 1; }

# ---------- файл подкачки: страховка для 8 ГБ памяти ----------
if [ "$SWAP_GB" != "0" ] && [ -z "$(swapon --show --noheadings 2>/dev/null)" ]; then
  echo "==> Создаю файл подкачки ${SWAP_GB} ГБ"
  if { fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB * 1024)); } \
     && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-portal.conf
    sysctl -q -p /etc/sysctl.d/99-portal.conf || true
  else
    echo "Не удалось включить подкачку (возможно, виртуализация не позволяет). Продолжаю без неё."
    rm -f /swapfile
  fi
fi

# ---------- пользователь и каталоги ----------
echo "==> Пользователь и каталоги"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"/{data,media/video,media/photo,media/music,media/site}

# ---------- нейросеть (Ollama) ----------
AI_ENABLED=false
MODEL_USED=""
if [ "$SKIP_AI" != "1" ]; then
  echo "==> Установка Ollama"
  command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh
  mkdir -p /etc/systemd/system/ollama.service.d
  cp "$SRC/deploy/ollama-override.conf" /etc/systemd/system/ollama.service.d/override.conf
  systemctl daemon-reload
  systemctl enable ollama >/dev/null 2>&1 || true
  systemctl restart ollama
  for _ in $(seq 1 60); do curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break; sleep 2; done
  if curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    if [ -n "$AI_MODEL" ]; then CANDIDATES=("$AI_MODEL")
    elif [ "$RAM_MB" -lt 3500 ]; then CANDIDATES=(qwen3.5:0.8b qwen3:1.7b llama3.2:1b)
    elif [ "$RAM_MB" -lt 6500 ]; then CANDIDATES=(qwen3.5:2b llama3.2:3b)
    elif [ "$RAM_MB" -lt 12000 ]; then CANDIDATES=(qwen3.5:4b qwen3:4b gemma3:4b llama3.2:3b)
    else CANDIDATES=(qwen3.5:9b qwen3.5:4b qwen3:8b)
    fi
    for m in "${CANDIDATES[@]}"; do
      echo "==> Скачиваю модель $m (несколько ГБ, это может занять время)"
      if ollama pull "$m"; then MODEL_USED="$m"; AI_ENABLED=true; break; fi
      echo "Не удалось скачать $m"
    done
    [ "$AI_ENABLED" = true ] || echo "Модель не скачалась. Скачайте её позже в админ-панели, вкладка «Нейросеть»."
  else
    echo "Ollama не запустилась. Проверьте: systemctl status ollama. Сайт будет работать без нейросети."
  fi
fi

# ---------- код приложения ----------
echo "==> Копирую приложение"
rm -rf "$APP_DIR/public" "$APP_DIR/private"
cp -r "$SRC/app/server.js" "$SRC/app/public" "$SRC/app/private" "$APP_DIR/"
if [ ! -f "$APP_DIR/data/news.json" ]; then
  printf '[{"id":"welcome","title":"Портал запущен","date":"%s","text":"Здесь будут новости, фото, видео и музыка. Материалы добавляются в админ-панели."}]\n' "$(date +%F)" > "$APP_DIR/data/news.json"
fi
if [ ! -f "$APP_DIR/data/ai.json" ]; then
  printf '{"enabled":%s,"model":"%s"}\n' "$AI_ENABLED" "${MODEL_USED:-qwen3.5:4b}" > "$APP_DIR/data/ai.json"
fi

echo "==> Настройка сервиса"
cat > /etc/portal.env <<ENV
PORT=$PORT
ALLOW_REGISTRATION=$ALLOW_REGISTRATION
ADMIN_EMAIL=$ADMIN_EMAIL
MAX_UPLOAD_MB=$MAX_UPLOAD_MB
OLLAMA_URL=http://127.0.0.1:11434
AI_MAX_PARALLEL=1
COOKIE_SECURE=0
ENV
chmod 600 /etc/portal.env
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"

sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_USER@|$APP_USER|g" -e "s|@NODE_BIN@|$NODE_BIN|g" \
  "$SRC/deploy/portal.service.in" > /etc/systemd/system/portal.service
systemctl daemon-reload
systemctl enable portal >/dev/null
systemctl restart portal

echo "==> Настройка nginx"
sed -e "s|@DOMAIN@|${DOMAIN:-_}|g" -e "s|@PORT@|$PORT|g" -e "s|@MAX_UPLOAD_MB@|$MAX_UPLOAD_MB|g" \
  "$SRC/deploy/nginx.conf.in" > /etc/nginx/sites-available/portal
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/portal
nginx -t
systemctl enable nginx >/dev/null
systemctl reload nginx

echo "==> Файрвол"
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

PROTO="http"
if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  echo "==> HTTPS (Let's Encrypt)"
  if certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect -n; then
    sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=1/' /etc/portal.env
    systemctl restart portal
    PROTO="https"
  else
    echo "Не удалось получить сертификат. Проверьте, что DNS домена указывает на этот сервер, и запустите скрипт снова."
  fi
elif [ -n "$DOMAIN" ]; then
  echo "Укажите EMAIL, чтобы получить HTTPS-сертификат."
fi

HOST="${DOMAIN:-$(curl -s4 --max-time 5 https://ifconfig.me || hostname -I | awk '{print $1}')}"
if [ -n "$ADMIN_EMAIL" ]; then
  ADMIN_NOTE="Администратор: зарегистрируйтесь на сайте с почтой $ADMIN_EMAIL"
else
  ADMIN_NOTE="Администратор: первый зарегистрированный пользователь. Зарегистрируйтесь сами сразу после установки."
fi
if [ "$AI_ENABLED" = true ]; then AI_NOTE="Олег AI: включён, модель $MODEL_USED (локально, Ollama)"
elif [ "$SKIP_AI" = "1" ]; then AI_NOTE="Олег AI: не устанавливался (SKIP_AI=1)"
else AI_NOTE="Олег AI: модель не скачана, скачайте её в админ-панели, вкладка «Нейросеть»"; fi

cat <<DONE

Готово. Портал: $PROTO://$HOST
$ADMIN_NOTE
$AI_NOTE

Админ-панель: дизайн, главное фото, файлы, новости, отчёт и история посещений, нейросеть.
Настройки:    /etc/portal.env (после правки: systemctl restart portal)
Данные:       $APP_DIR/data (пользователи, новости, тексты), $APP_DIR/media (файлы)
Модели:       /usr/share/ollama/.ollama/models
Логи:         journalctl -u portal -f     и     journalctl -u ollama -f

Восстановление доступа (после команды: systemctl restart portal):
  sudo -u $APP_USER node $APP_DIR/server.js --admin user@example.com
  sudo -u $APP_USER node $APP_DIR/server.js --passwd user@example.com НОВЫЙ_ПАРОЛЬ
DONE
