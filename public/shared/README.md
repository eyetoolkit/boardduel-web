# Tri-Sites 共享资源模板

本目录存放三站可共用的元文件/HTML/JS 模板。每个站点根 `public/` 下的同名文件
(`robots.txt`、`ai.txt`、`404.html`、`manifest.webmanifest`)
应保持与本站模板的"占位符替换"同步。

## 当前可用模板

| 文件 | 用途 | 三站位置 |
|------|------|---------|
| `robots.txt.tpl` | 搜索引擎爬虫规则 | 各站 `robots.txt` |
| `ai.txt.tpl` | AI 爬虫说明 | 各站 `ai.txt`（MemoryDuel 暂无） |
| `llms.txt.tpl` | LLM 描述（可选） | 各站 `llms.txt`（NumeriDuel 才有） |
| `404.html.tpl` | 错误页模板 | 各站 `404.html` |
| `manifest.webmanifest.tpl` | PWA manifest 模板 | 各站 `manifest.webmanifest` |

（2026-10-21：原 `sw-helpers.js` + 各站 `service-worker.js` 双 SW 并存，其中
`service-worker.js` 从未被注册（各站 `js/sw-register.js` 注册的是 `/sw.js`），
测试长期保护死文件。已删除这两个文件，线上 SW 策略以各站 `sw.js` 为唯一真相源。）

## 维护流程

1. 修改 `*.tpl` 文件
2. 用 sed 或本地脚本替换占位符（{{HOST}}、{{NAME}} 等）
3. 生成各站点的实际文件并推 GitHub
4. 清 Cloudflare 缓存

## 占位符约定

| 占位符 | 说明 |
|--------|------|
| `{{HOST}}` | 站点主域（含协议），如 `https://boardduel.com` |
| `{{SHORT_HOST}}` | 站点主域（裸域），如 `boardduel.com` |
| `{{NAME}}` | 站点中文名，如 `棋盘对决` |
| `{{NAME_EN}}` | 站点英文名，如 `Board Duel` |
| `{{BRAND}}` | 品牌主色（hex），如 `#4f46e5` |
| `{{BG}}` | 背景色（hex），如 `#faf9ff` |
| `{{EMOJI}}` | 站点 emoji 图标 |
| `{{DESCRIPTION}}` | 站点描述 |