# Tri-Sites robots.txt Template
# 占位符：{{HOST}}、{{EXTRA_DISALLOW}}、{{EXTRA_LLMS}}
# 说明：禁止敏感路径；指向 sitemap 和 LLM/AI 元数据文件

User-agent: *
Allow: /
{{EXTRA_DISALLOW}}
# 阻止常见敏感文件
Disallow: /.git/
Disallow: /.env
Disallow: /*.json$

Sitemap: {{HOST}}/sitemap.xml
{{EXTRA_LLMS}}