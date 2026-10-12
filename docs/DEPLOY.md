# 部署说明 · 《勇气之翼 Wings of Courage》

纯静态站点，无构建步骤（`index.html` + importmap + ES modules）。发布集总体积约 **77MB**（大头是 `model/` 36MB、`sound/` 31MB、`img/` 3.5MB）。

## 发布集清单

部署只需要项目根目录下这些内容：

| 路径 | 说明 |
| --- | --- |
| `index.html` | 入口（含内联开机画面与 meta） |
| `favicon.png` | 站点图标 |
| `js/` | 全部游戏代码（ES modules） |
| `vendor/` | three.js 本地拷贝 |
| `model/` | GLB 模型（**不含** `b17.original.glb` / `p51.original.glb` / `me_262_specgloss_backup.glb` 三个管线备份） |
| `sound/` | 音乐与音效 |
| `img/` | 界面与封面图 |
| `_headers` | Cloudflare Pages 缓存策略（见下） |

`node_modules/`、`scripts/`、`tests/`、`tools/`、`docs/`、`_archive/`、`package*.json`、`*.md`、`启动服务器.bat` 等仅本地使用，**绝不部署**。

## ⚠️ 关键坑：wrangler pages deploy 不读 .assetsignore

`.assetsignore` 是 **Workers 静态资产**特性，`wrangler pages deploy` 的上传路径根本不解析它（2026-10-12 实测：根目录直接部署导致 `node_modules/`、`tools/`、`tests/` 全部公开上线）。因此**必须先构建干净发布目录再部署**，一律走 `scripts/deploy_pages.sh`：

```bash
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account_id>
bash scripts/deploy_pages.sh   # 拷贝发布集到 _release/（已 gitignore）→ wrangler pages deploy _release
```

Pages 控制台手工上传同理：只挑上面"发布集清单"中的文件/目录打包上传。

## 必须根路径部署

全站资源一律用绝对路径引用（`/js/`、`/model/`、`/sound/`、`/vendor/`、`/img/`），**必须部署在域名根路径**。挂到子路径（如 `example.com/game/`）会导致所有资源 404。

## 缓存策略（`_headers`）

| 路径 | Cache-Control |
| --- | --- |
| `/model/*`、`/sound/*`、`/img/*`、`/vendor/*` | `public, max-age=604800`（一周） |
| `/js/*` | `public, max-age=3600`（一小时） |
| `/`、`/*.html` | `public, max-age=0, must-revalidate`（每次回源校验） |

注意：资产文件名不带 hash，**模型/音频/图片更新后最长一周才会对所有访客生效**（等旧缓存自然过期）。需要立刻生效时，到 Cloudflare 控制台 Purge Cache，或给文件改名并同步更新引用处。

## 本地预览

```bash
npx http-server -p 5173 -c-1 --cors
```

访问 <http://localhost:5173/>。`-c-1` 关闭缓存，避免改代码后看到旧文件；也可以直接用根目录的 `启动服务器.bat`（仅本地，不部署）。
