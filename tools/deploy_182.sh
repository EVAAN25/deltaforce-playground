#!/usr/bin/env bash
# 部署三角洲行动游乐场到 182（https://komozyw.com/df/；2026-08-11 起 nginx 由同事配了 HTTPS，
# IP 直连 http://182.254.155.14/df/ 已 404 失效，自检走 komozyw 域名）
# 用法：bash tools/deploy_182.sh
# 前置（已配好，一次性的）：
#   - 182 /var/www/df/ 属主 ubuntu（sudo mkdir + chown）
#   - nginx sites-enabled/zgy-demo 已加 location /df/ → /var/www/df/（备份在 182 ~/zgy-demo.bak_20260807）
# 同步口径：GitHub 仓库 = 全量（含 tools/test.js）；.io = Pages 自动；182 = 本脚本（排除 .git/_wip_raid/tools/test.js/task.md）
set -euo pipefail
cd "$(dirname "$0")/.."
KEY="$HOME/Documents/tasks_cc/服务器密钥/wzy.pem"
HOST="ubuntu@182.254.155.14"
rsync -az --delete -e "ssh -i $KEY" \
  --exclude=.git --exclude=_wip_raid --exclude=tools --exclude=test.js --exclude=task.md \
  ./ "$HOST:/var/www/df/"
curl -sf -o /dev/null -w "komozyw /df/ 自检 HTTP %{http_code}\n" "https://komozyw.com/df/"
curl -sf -o /dev/null -w "komozyw /df/ 贴图自检 HTTP %{http_code}\n" "https://komozyw.com/df/assets/props/p_15080040001.png"
echo "部署完成：https://komozyw.com/df/"
