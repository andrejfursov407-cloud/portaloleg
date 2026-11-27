#!/usr/bin/env bash
# Установка Олег AI на Ubuntu/Debian: sudo ./install.sh
set -euo pipefail
[ "$EUID" -eq 0 ] || { echo "Запусти через sudo"; exit 1; }
APP=/opt/oleg-ai; SRC="$(cd "$(dirname "$0")" && pwd)"; PORT="${PORT:-3000}"
echo "==> Пакеты"; apt-get update -y; apt-get install -y curl rsync python3 python3-venv ca-certificates tar
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; apt-get install -y nodejs; fi
echo "==> Ollama (лёгкие модели)"; command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
echo "==> Файлы приложения"; id oleg >/dev/null 2>&1 || useradd -r -m -d "$APP" -s /usr/sbin/nologin oleg
mkdir -p "$APP"; rsync -a --exclude .git --exclude data --exclude dist "$SRC"/ "$APP"/; mkdir -p "$APP/data"
echo "==> Голос (Piper)"; [ -d "$APP/venv" ] || python3 -m venv "$APP/venv"; "$APP/venv/bin/pip" install -q piper-tts || echo "Piper не поставился — будет голос браузера"
V="$APP/data/voices"; mkdir -p "$V"; B=https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/denis/medium
[ -f "$V/ru_RU-denis-medium.onnx" ] || { curl -fsSL -o "$V/ru_RU-denis-medium.onnx" "$B/ru_RU-denis-medium.onnx" && curl -fsSL -o "$V/ru_RU-denis-medium.onnx.json" "$B/ru_RU-denis-medium.onnx.json" || echo "Голос не скачался — добавишь в админ-панели"; }
chown -R oleg:oleg "$APP"
[ -f "$APP/.env" ] || printf 'PORT=%s\nPIPER_BIN=%s/venv/bin/piper\nOLLAMA_URL=http://127.0.0.1:11434\n# COOKIE_SECURE=1   # включи, если сайт открыт по https\n' "$PORT" "$APP" > "$APP/.env"
cat > /etc/systemd/system/oleg-ai.service <<UNIT
[Unit]
Description=Oleg AI
After=network.target ollama.service
[Service]
User=oleg
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload; systemctl enable --now oleg-ai ollama 2>/dev/null || systemctl enable --now oleg-ai
echo; echo "Готово: http://<IP-сервера>:$PORT  — первый зарегистрированный пользователь станет админом."
echo "Дальше: ⚙ Админ-панель → Модели → установить (например qwen2.5:3b) → Выбрать."
