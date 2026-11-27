#!/usr/bin/env bash
# Обновление с GitHub: из папки клона выполни  sudo ./update.sh
set -euo pipefail
[ "$EUID" -eq 0 ] || { echo "Запусти через sudo"; exit 1; }
APP=/opt/oleg-ai; cd "$(dirname "$0")"
git pull --ff-only
tar czf "$APP/data/backups/before-script-$(date +%s).tgz" -C "$APP" --exclude=./data --exclude=./venv .
rsync -a --exclude .git --exclude data --exclude dist --exclude .env ./ "$APP"/
chown -R oleg:oleg "$APP"; systemctl restart oleg-ai
echo "Обновлено до $(node -p "require('$APP/package.json').version")"
