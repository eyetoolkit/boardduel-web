<!DOCTYPE html>
<html lang="zh-CN" data-site="{{SITE_KEY}}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>404 - 页面未找到 · {{NAME}}</title>
  <meta name="description" content="404 - 页面未找到">
  <link rel="icon" href="{{FAVICON}}" type="image/svg+xml">
  <link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="{{BRAND}}">
  <meta property="og:title" content="404 - 页面未找到 · {{NAME}}">
  <meta property="og:description" content="404 - 页面未找到">
  <meta property="og:locale" content="zh_CN">
  <link rel="canonical" href="{{HOST}}/">
  <style>
    :root { --p: {{BRAND}}; --bg: {{BG}}; --t: #1e1b4b; --m: #6b7280; --p-h: {{BRAND_DARK}}; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--t);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 20px;
    }
    .nf-emoji { font-size: 5rem; margin-bottom: 1rem; }
    .nf-code {
      font-size: clamp(4rem, 12vw, 8rem);
      font-weight: 900;
      line-height: 1;
      background: linear-gradient(135deg, var(--p), #9333ea);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      margin-bottom: 0.5rem;
    }
    .nf-title { font-size: 1.5rem; margin: 0.5rem 0; color: var(--t); }
    .nf-msg { color: var(--m); margin-bottom: 2rem; }
    .nf-actions { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; }
    .nf-btn {
      padding: 0.75rem 1.5rem;
      background: var(--p);
      color: #fff;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      transition: background 0.15s;
    }
    .nf-btn:hover { background: var(--p-h); }
    .nf-btn.secondary {
      background: transparent;
      color: var(--p);
      border: 1.5px solid var(--p);
    }
    .nf-btn.secondary:hover { background: var(--p); color: #fff; }
  </style>
</head>
<body>
  <div class="nf-emoji">{{EMOJI}}</div>
  <div class="nf-code">404</div>
  <h1 class="nf-title">页面走丢了</h1>
  <p class="nf-msg">您访问的页面不存在或已被移除。</p>
  <div class="nf-actions">
    <a href="/" class="nf-btn">← 返回首页</a>
    <a href="javascript:history.back()" class="nf-btn secondary">返回上一页</a>
  </div>
</body>
</html>