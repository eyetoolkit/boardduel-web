/* ═══════════════════════════════════════════════════════════════════════════
   scripts/i18n/lib.mjs — 三语化预渲染的共用底座
   ───────────────────────────────────────────────────────────────────────────
   设计要点（为什么这么做）：
   1. 不改动源码 HTML、不加 data-i18n 埋点。以「英文原文」本身作为翻译记忆键，
      构建期对 dist 的成品 HTML 做文本级替换，产出 dist/<lang>/... 静态页。
      → 21 个页面 × 6 语 = 126 个产物，全部由构建生成，源码零侵入。
   2. 抽取（scan）与替换（prerender）复用同一个 tokenizer。
      → 键的切分方式永远一致，内联标签（"Five board games, <em>one ladder</em>"）
        被切成两段这件事，两边看到的是同一把尺子。
   3. 缺译不报错、不留占位符：保留英文原文并计入报告，页面按覆盖率门禁发布。
      → 半中半英的页面宁可不出，也不给用户看。
   4. 本文件零依赖：只有 node 内置模块。
   ═══════════════════════════════════════════════════════════════════════════ */

export const LANGS = ['en', 'zh', 'ja', 'de', 'es', 'fr'];
export const ORIGIN = 'https://boardduel.com';

/** 归一化成键：压缩空白、去首尾。保留大小写与标点（译文需要原样语境）。 */
export function norm(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** 是否需要翻译：过短、纯符号、纯数字、纯实体、纯小写标识符都不算文案。 */
export function isProse(s) {
  const t = norm(s);
  if (t.length < 2) return false;
  if (!/[\p{L}]/u.test(t)) return false;              // 没有任何字母 → 符号/数字
  if (/^&[a-z#0-9]+;$/i.test(t)) return false;         // 单个 HTML 实体（&laquo;）
  if (/^%%[A-Z_]+%%$/.test(t)) return false;           // 模板占位 %%TITLE%%
  if (/^[a-z0-9][a-z0-9._@:/-]*$/.test(t)) return false; // 像 class / path / email / id
  if (/^(https?|mailto|tel|\/|#)\b/.test(t)) return false;
  return true;
}

/* ─── 极简 HTML 分词：只区分「标签 / 文本 / 注释」，不建 DOM ─── */
const RAW_TEXT = new Set(['script', 'style', 'svg', 'textarea', 'noscript', 'template']);
const SKIP_ATTR_TEXT = /(^|[\s])(class|id|href|src|rel|type|charset|content|name|property|as|crossorigin|sizes|media|role|tabindex|aria-[a-z-]+|data-[a-z0-9-]+|viewbox|d|fill|stroke|width|height|x|y|cx|cy|r|points|preserveaspectratio|colspan|rowspan|start|value|max|min|step|for|lang|dir|itemtype|itemprop|itemref)\b/i;

/**
 * tokenize(html) → [{k:'text'|'tag'|'comment', v:'原文'}]
 * 标签内的引号包裹内容不会被误当作标签边界。
 */
export function tokenize(html) {
  const out = [];
  let i = 0, buf = '';
  const flush = () => { if (buf) { out.push({ k: 'text', v: buf }); buf = ''; } };
  while (i < html.length) {
    const c = html[i];
    if (c === '<') {
      if (html.startsWith('<!--', i)) {
        flush(); const e = html.indexOf('-->', i); const end = e < 0 ? html.length : e + 3;
        out.push({ k: 'comment', v: html.slice(i, end) }); i = end; continue;
      }
      // 找标签结束：跳过引号内的 '>'
      let j = i + 1, q = '';
      while (j < html.length) {
        const ch = html[j];
        if (q) { if (ch === q) q = ''; }
        else if (ch === '"' || ch === "'") q = ch;
        else if (ch === '>') break;
        j++;
      }
      if (j >= html.length) { buf += html.slice(i); break; }   // 残缺标签，当文本
      flush();
      out.push({ k: 'tag', v: html.slice(i, j + 1) });
      i = j + 1; continue;
    }
    buf += c; i++;
  }
  flush();
  return out;
}

/** 从标签串取属性值（大小写不敏感），无则 null。 */
export function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? (m[1] ?? m[2]) : null;
}

/** 需要翻译的属性白名单（纯文本属性） */
export const TRANSLATABLE_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];

/**
 * 遍历一个 HTML 文档里所有「可翻译单元」。
 * cb(unit)  —— unit.text 原文；unit.replaceWith(s) 交回译文。
 * 由 scan 与 prerender 共用，保证切分一致。
 */
export function walkDocument(html, cb) {
  const toks = tokenize(html);
  let rawDepth = 0;              // 位于 script/style/svg 等原始文本元素内的深度
  const stack = [];
  let inTitle = false;
  let out = null;

  const metaNames = new Set(['description']);
  const metaProps = new Set(['og:title', 'og:description', 'twitter:title', 'twitter:description']);

  for (let n = 0; n < toks.length; n++) {
    const tk = toks[n];

    if (tk.k === 'comment') continue;

    if (tk.k === 'tag') {
      const inner = tk.v.replace(/^<\/?\s*([a-zA-Z0-9-]+)/, '$1').replace(/\/?>$/, '').trim().toLowerCase();
      const tagName = (tk.v.match(/^<\/?\s*([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase() || '';
      const closing = tk.v.startsWith('</');

      if (RAW_TEXT.has(tagName)) {
        if (!closing && !/\/>$/.test(tk.v)) { rawDepth++; stack.push(tagName); }
        else if (closing) { rawDepth = Math.max(0, rawDepth - 1); stack.pop(); }
        continue;
      }
      if (tagName === 'title') { inTitle = !closing; continue; }
      // <meta name="description" content="..."> / og:title 等
      if (tagName === 'meta' && !closing) {
        const nm = (attr(tk.v, 'name') || '').toLowerCase();
        const pr = (attr(tk.v, 'property') || '').toLowerCase();
        if (metaNames.has(nm) || metaProps.has(pr)) {
          const cur = attr(tk.v, 'content');
          if (cur != null && isProse(cur)) {
            let nv = cur;
            cb({ text: norm(cur), scope: 'meta:' + (nm || pr), get: () => nv, set: v => { nv = v; } });
            if (nv !== cur) {
              out = (out ?? toks.map(t => t.v));
              out[n] = tk.v.replace(/(\bcontent\s*=\s*")([^"]*)(")/i, `$1${escAttr(nv)}$3`);
              tk.v = out[n];
            }
          }
        }
        continue;
      }
      // 普通标签上的可翻译属性
      if (!closing) {
        for (const a of TRANSLATABLE_ATTRS) {
          const cur = attr(tk.v, a);
          if (cur == null || !isProse(cur)) continue;
          let nv = cur;
          cb({ text: norm(cur), scope: 'attr:' + a, get: () => nv, set: v => { nv = v; } });
          if (nv !== cur) {
            out = (out ?? toks.map(t => t.v));
            out[n] = tk.v.replace(new RegExp(`(\\b${a}\\s*=\\s*")([^"]*)(")`, 'i'), `$1${escAttr(nv)}$3`);
            tk.v = out[n];
          }
        }
      }
      continue;
    }

    // 文本 token
    if (rawDepth > 0) continue;
    if (!isProse(tk.v)) continue;
    const cur = tk.v;
    let nv = cur;
    cb({ text: norm(cur), scope: inTitle ? 'title' : 'text', get: () => nv, set: v => { nv = v; } });
    if (nv !== cur) {
      out = (out ?? toks.map(t => t.v));
      out[n] = keepGap(cur, nv);
    }
  }

  if (!out) return html;
  return out.join('');
}

/** 保留原文前后空白，只换掉中间的可翻译部分。 */
function keepGap(orig, next) {
  const lead = (orig.match(/^\s*/) || [''])[0];
  const trail = (orig.match(/\s*$/) || [''])[0];
  return lead + norm(next) + trail;
}
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 内部链接是否要加语言前缀 */
export function localizeHref(href, lang) {
  if (!href) return href;
  if (/^(https?:|mailto:|tel:|data:|#|\/\/)/i.test(href)) return href;
  if (/^\/(assets|fonts|icons|img|images|api|ws|favicon|manifest|robots|sitemap|sw\.js)/.test(href)) return href;
  if (/\.(css|js|svg|png|jpg|jpeg|webp|woff2?|ico|json|webmanifest|txt|xml)$/i.test(href.split('?')[0])) return href;
  const prefix = '/' + lang;
  if (lang === 'en') return href;
  if (href === '/' || href === '') return prefix + '/';
  if (href.startsWith(prefix + '/')) return href;
  return prefix + (href.startsWith('/') ? href : '/' + href);
}
