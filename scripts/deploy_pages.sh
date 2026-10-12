#!/usr/bin/env bash
# 构建干净发布目录并部署到 Cloudflare Pages。
# 原因：`wrangler pages deploy` 不读取 .assetsignore（Workers 静态资产特性，Pages 上传路径不解析），
# 所以必须只把发布集拷进 _release/ 再部署。
# 用法（Git Bash）：
#   export CLOUDFLARE_API_TOKEN=<token>
#   export CLOUDFLARE_ACCOUNT_ID=1e1af621cf7127963ffcf66e18280188
#   bash scripts/deploy_pages.sh
set -e
cd "$(dirname "$0")/.."

RELEASE=_release
rm -rf "$RELEASE"
mkdir -p "$RELEASE"

cp index.html favicon.png _headers "$RELEASE/"
cp -r js vendor model sound img "$RELEASE/"

# 模型管线原始备份：保留在 git，不部署
rm -f "$RELEASE/model/b17.original.glb" \
      "$RELEASE/model/p51.original.glb" \
      "$RELEASE/model/me_262_specgloss_backup.glb"

echo "发布集大小：$(du -sm "$RELEASE" | cut -f1) MB，文件数：$(find "$RELEASE" -type f | wc -l)"

npx wrangler pages deploy "$RELEASE" --project-name=wings-courage --branch=main --commit-dirty=true
