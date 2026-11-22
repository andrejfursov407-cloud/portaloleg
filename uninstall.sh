#!/usr/bin/env bash
# Удаление портала. Данные и файлы сохраняются, если не указан --purge.
#   sudo bash uninstall.sh            убрать сервис и настройки nginx
#   sudo bash uninstall.sh --purge    дополнительно удалить /opt/portal (пользователи, файлы!)
#   sudo bash uninstall.sh --with-ollama   дополнительно удалить Ollama и скачанные модели
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/portal}"
[ "$(id -u)" -eq 0 ] || { echo "Запустите от root"; exit 1; }
systemctl disable --now portal 2>/dev/null || true
rm -f /etc/systemd/system/portal.service /etc/portal.env /etc/nginx/sites-enabled/portal /etc/nginx/sites-available/portal
systemctl daemon-reload
nginx -t 2>/dev/null && systemctl reload nginx || true
for a in "$@"; do
  case "$a" in
    --purge) rm -rf "$APP_DIR"; userdel portal 2>/dev/null || true; echo "Каталог $APP_DIR удалён";;
    --with-ollama)
      systemctl disable --now ollama 2>/dev/null || true
      rm -f /etc/systemd/system/ollama.service /usr/local/bin/ollama
      rm -rf /etc/systemd/system/ollama.service.d /usr/local/lib/ollama /usr/share/ollama
      userdel ollama 2>/dev/null || true
      systemctl daemon-reload; echo "Ollama удалена";;
  esac
done
echo "Готово."
