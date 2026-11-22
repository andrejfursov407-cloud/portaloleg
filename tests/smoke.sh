#!/usr/bin/env bash
# Быстрая проверка: вход, права, загрузка, перемотка, защита файлов.
set -u
cd "$(dirname "$0")/.."
T="$(mktemp -d)"; PORT=3199; B="http://127.0.0.1:$PORT"; J='Content-Type: application/json'
DATA_DIR="$T/data" MEDIA_DIR="$T/media" PORT=$PORT OLLAMA_URL=http://127.0.0.1:9 node app/server.js >"$T/log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$T"' EXIT
sleep 1
FAIL=0
t() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (ожидали $2, получили $3)"; FAIL=1; fi; }
t "главная без входа перенаправляет" 302 "$(curl -s -o /dev/null -w '%{http_code}' $B/)"
t "API без входа закрыт" 401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/media/video)"
curl -s -c "$T/a" -H "$J" -d '{"name":"Админ","email":"a@x.ru","password":"password123"}' $B/api/register >/dev/null
curl -s -c "$T/u" -H "$J" -d '{"name":"Гость","email":"u@x.ru","password":"password123"}' $B/api/register >/dev/null
t "первый пользователь администратор" true "$(curl -s -b "$T/a" $B/api/me | node -pe 'JSON.parse(require("fs").readFileSync(0)).admin')"
t "второй пользователь не администратор" false "$(curl -s -b "$T/u" $B/api/me | node -pe 'JSON.parse(require("fs").readFileSync(0)).admin')"
t "неверный пароль" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H "$J" -d '{"email":"u@x.ru","password":"wrongwrong"}' $B/api/login)"
head -c 200000 /dev/urandom > "$T/f.mp4"
UP=(-H 'X-Requested-With: portal' -H 'Content-Type: application/octet-stream' --data-binary "@$T/f.mp4")
t "загрузка: обычному нельзя" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/u" "${UP[@]}" "$B/api/admin/upload?type=video&name=f.mp4")"
t "загрузка: админу можно" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/a" "${UP[@]}" "$B/api/admin/upload?type=video&name=f.mp4")"
t "запрещённый формат" 400 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/a" "${UP[@]}" "$B/api/admin/upload?type=video&name=evil.exe")"
t "перемотка (Range)" 206 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/u" -H 'Range: bytes=0-99' $B/media/video/f.mp4)"
t "файл без входа закрыт" 401 "$(curl -s -o /dev/null -w '%{http_code}' $B/media/video/f.mp4)"
t "обход каталогов" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/u" "$B/media/video/..%2F..%2Fapp%2Fserver.js")"
t "отчёт закрыт для обычного" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/u" $B/api/admin/report)"
t "отчёт открыт админу" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/a" $B/api/admin/report)"
t "Олег AI выключен по умолчанию" 503 "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/u" -H "$J" -d '{"messages":[{"role":"user","content":"привет"}]}' $B/api/ai/chat)"
exit $FAIL
