#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "${0:A:h}"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print 'Node.js 22.12以降をインストールしてから、もう一度起動してください。'
  read '?Enterで終了'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci --ignore-scripts
fi
npm run build
if curl --silent --fail --max-time 2 http://127.0.0.1:4173/ | grep -q '<title>Nano Banana Studio</title>'; then
  print '起動済みのBanana Studioを開きます。'
  [[ "${NO_BROWSER:-0}" == 1 ]] || open http://127.0.0.1:4173/
  exit 0
fi
HOST=127.0.0.1 PORT=4173 node server.mjs &
studio_pid=$!
cleanup() { kill "$studio_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
studio_ready=0
for attempt in {1..30}; do
  if curl --silent --fail --max-time 1 http://127.0.0.1:4173/ | grep -q '<title>Nano Banana Studio</title>'; then
    studio_ready=1
    break
  fi
  kill -0 "$studio_pid" 2>/dev/null || break
  sleep 0.2
done
if [[ "$studio_ready" != 1 ]]; then
  print '起動できませんでした。ポート4173が別のアプリで使われていないか確認してください。'
  read '?Enterで終了'
  exit 1
fi
[[ "${NO_BROWSER:-0}" == 1 ]] || open http://127.0.0.1:4173/
print 'Banana Studioが起動しました。終了するときはこのウィンドウでCtrl+Cを押してください。'
wait "$studio_pid"
