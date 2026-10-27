#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
state_dir="$HOME/Library/Application Support/CampusBalance"
mkdir -p "$state_dir"
secret_file="$state_dir/web-session-key"
if [ ! -f "$secret_file" ]; then
  node -e 'require("fs").writeFileSync(process.argv[1],require("crypto").randomBytes(32).toString("hex"),{mode:0o600,flag:"wx"})' "$secret_file"
fi
echo '校园余额本机 Web 版：http://127.0.0.1:4174'
echo '保持此窗口运行；按 Control-C 停止。'
export CAMPUS_WEB=1 NODE_ENV=local PORT=4174
exec node dev.js < "$secret_file"
