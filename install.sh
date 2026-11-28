#!/usr/bin/env bash
# Установка Олег AI на Ubuntu/Debian: sudo ./install.sh
set -euo pipefail
[ "$EUID" -eq 0 ] || { echo "Запусти через sudo"; exit 1; }
APP=/opt/oleg-ai; SRC="$(cd "$(dirname "$0")" && pwd)"; PORT="${PORT:-3000}"
echo "==> Пакеты"; apt-get update -y; apt-get install -y curl rsync python3 python3-venv ca-certificates tar unzip poppler-utils
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; apt-get install -y nodejs; fi
echo "==> Ollama (лёгкие модели)"; command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
RAM=$(awk '/MemTotal/{printf "%d",$2/1024}' /proc/meminfo); echo "==> Профиль сервера: $(nproc) яд., ${RAM} МБ RAM"
if [ "$RAM" -lt 3300 ] && [ -z "$(swapon --show --noheadings)" ]; then echo "Мало RAM — создаю swap 2 ГБ"; fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
PAR=1; [ "$RAM" -ge 6500 ] && PAR=2
if [ "$RAM" -lt 3300 ]; then HEAP=160; MODEL=qwen2.5:1.5b; elif [ "$RAM" -lt 6500 ]; then HEAP=320; MODEL=qwen2.5:3b; else HEAP=512; MODEL=qwen2.5:7b; fi; mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_MAX_LOADED_MODELS=1"\nEnvironment="OLLAMA_NUM_PARALLEL=%s"\nEnvironment="OLLAMA_FLASH_ATTENTION=1"\nEnvironment="OLLAMA_KV_CACHE_TYPE=q8_0"\n' "$PAR" > /etc/systemd/system/ollama.service.d/oleg.conf; systemctl daemon-reload || true
echo "==> Файлы приложения"; id oleg >/dev/null 2>&1 || useradd -r -m -d "$APP" -s /usr/sbin/nologin oleg
mkdir -p "$APP"; rsync -a --exclude .git --exclude data --exclude dist "$SRC"/ "$APP"/; mkdir -p "$APP/data"
echo "==> Голос (Piper)"; [ -d "$APP/venv" ] || python3 -m venv "$APP/venv"; "$APP/venv/bin/pip" install -q piper-tts || echo "Piper не поставился — будет голос браузера"
V="$APP/data/voices"; mkdir -p "$V"; B=https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/denis/medium
[ -f "$V/ru_RU-denis-medium.onnx" ] || { curl -fsSL -o "$V/ru_RU-denis-medium.onnx" "$B/ru_RU-denis-medium.onnx" && curl -fsSL -o "$V/ru_RU-denis-medium.onnx.json" "$B/ru_RU-denis-medium.onnx.json" || echo "Голос не скачался — добавишь в админ-панели"; }
chown -R oleg:oleg "$APP"
[ -f "$APP/.env" ] || printf 'PORT=%s\nPIPER_BIN=%s/venv/bin/piper\nOLLAMA_URL=http://127.0.0.1:11434\nDEFAULT_MODEL=%s\n# TRUST_PROXY=1   # включи за nginx/Caddy\n# COOKIE_SECURE=1   # включи, если сайт открыт по https\n' "$PORT" "$APP" "$MODEL" > "$APP/.env"
cat > /etc/systemd/system/oleg-ai.service <<UNIT
[Unit]
Description=Oleg AI
After=network.target ollama.service
[Service]
User=oleg
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
ExecStart=$(command -v node) --max-old-space-size=$HEAP server.js
Nice=5
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload; systemctl enable --now oleg-ai ollama 2>/dev/null || systemctl enable --now oleg-ai
echo "==> Скачиваю модель $MODEL (это может занять несколько минут)"; sleep 3; ollama pull "$MODEL" || echo "Модель не скачалась — установи её в админ-панели"
systemctl restart oleg-ai || true
echo; echo "Готово: http://<IP-сервера>:$PORT  — первый зарегистрированный пользователь станет админом."
echo "Дальше: ⚙ Админ-панель → Модели → установить (например qwen2.5:3b) → Выбрать."
