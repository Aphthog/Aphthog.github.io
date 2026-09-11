# 博客扩容改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把博客从 16 篇一次性内容改造成 2025-01 起连续更新的 51 篇，并加上「合集」信息架构层级。

**Architecture:** 合集定义收敛到单一数据源 `source/_data/collections.yml`；文章用 front-matter 的 `collection: <id>` 显式声明归属；新增 `scripts/collections.js` generator 产出 `/collections/` 索引页和 11 个合集详情页。首页改造成落地页（合集卡片 + 最新文章）。三个自定义页面共用抽出的 EJS partials，避免 CSS 分叉。

**Tech Stack:** Hexo 8.1.2、hexo-renderer-ejs、NexT 8.27（Gemini scheme）、Stylus、js-yaml、hexo-front-matter

**Spec:** `docs/superpowers/specs/2026-09-11-blog-expansion-design.md`

## Global Constraints

- 运行环境：Windows。所有命令在 `C:\Users\Spring\Desktop\Camille-Blog` 下执行，不要用 WSL。
- **禁止**执行 `hexo deploy` 或 `npm run deploy` —— `_config.yml` 的 deploy 段指向 `main` 分支（即源码分支），误跑会用生成物覆盖源码。
- **禁止** `git push`。提交到本地 `main` 即可。
- `public/`、`db.json`、`node_modules/`、`.deploy_git/` 是生成物或依赖，`.gitignore` 已覆盖，**不得**出现在 `git status` 的待提交列表里。
- 合集 id 一律小写连字符（`java-basics`），与 `collections.yml` 中的 `id` 严格一致。
- 新增文章的 front-matter 必须含 `title` / `date` / `categories` / `tags` / `description` / `collection` 六个字段。
- 文章正文深度：本科毕业水平。`HashMap` 为例 —— 讲清数组 + 链表 + 红黑树的结构和扩容时机即可，不展开 treeify 阈值为 8 的推导。篇幅 800–1500 字。
- 正文用正常博客语气写，不复刻现有文章的句式。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `source/_data/collections.yml` | 合集与分组的定义，唯一数据源 |
| `tools/lib/excerpt.js` | Markdown 剥壳取纯文本摘要（从 `scripts/homepage.js` 抽出） |
| `tools/lib/posts.js` | `toPostView(post)` —— Hexo post → 模板用的扁平结构 |
| `tools/lib/collections.js` | `buildCollectionGroups(locals)` —— 按组组装合集及其文章 |
| `tools/verify-content.js` | 独立内容一致性检查脚本，`node` 直接跑 |
| `scripts/collections.js` | generator：`/collections/index.html` + 11 个详情页 |
| `scripts/homepage.js` | generator：`/index.html` 落地页（改造） |
| `templates/partials/head.ejs` | `<!DOCTYPE>` 到 `</head>`，含全部 CSS |
| `templates/partials/header.ejs` | 站名 + 导航 |
| `templates/partials/footer.ejs` | 页脚 |
| `templates/homepage.ejs` | 首页落地页 |
| `templates/collection-index.ejs` | 合集索引页 |
| `templates/collection-detail.ejs` | 单个合集的文章列表 |

**为什么 `tools/` 而不是 `scripts/`**：Hexo 会自动加载 `scripts/` 下的所有 JS 作为插件，把验证脚本和共享库放进去会被无谓地 require 甚至执行。`tools/` 不被扫描。

---

## Task 1: 合集数据源与内容校验脚本

先把"什么叫一个合集、一篇文章属于哪个合集"这件事用数据和校验固化下来，后面所有任务都依赖它。

**Files:**
- Create: `source/_data/collections.yml`
- Create: `tools/lib/excerpt.js`
- Create: `tools/lib/posts.js`
- Create: `tools/verify-content.js`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `collection` front-matter 字段的取值集合（11 个 id）
  - `tools/lib/excerpt.js` → `excerptOf(post): string`
  - `tools/lib/posts.js` → `toPostView(post): { title, date, dateISO, url, excerpt, collection }`
  - `node tools/verify-content.js [collectionId|--all]`，未知合集 id 时退出码 1

- [ ] **Step 1: 写 `source/_data/collections.yml`**

```yaml
# 合集定义 —— 首页卡片、/collections/ 页面和导航都读这一份。
# groups 决定首页与索引页的分节顺序，collections 的 order 决定组内顺序。

groups:
  - id: tech
    name: 技术主题线
    order: 1
  - id: project
    name: 项目实践
    order: 2
  - id: life
    name: 写作与摄影
    order: 3

collections:
  - id: java-basics
    name: Java 基础
    group: tech
    order: 1
    description: 集合、IO、异常，Java 语言层面的基本功
  - id: java-concurrency
    name: Java 并发
    group: tech
    order: 2
    description: 线程池、锁、并发容器与 CompletableFuture
  - id: jvm
    name: JVM
    group: tech
    order: 3
    description: 内存结构、垃圾回收、类加载，以及一次 OOM 排查
  - id: mysql
    name: MySQL
    group: tech
    order: 4
    description: 索引、事务、锁，以及一次慢查询优化
  - id: redis
    name: Redis
    group: tech
    order: 5
    description: 数据结构、缓存三大问题、持久化与分布式锁
  - id: llm-agent
    name: LLM 与 Agent
    group: tech
    order: 6
    description: 从 Token 到 RAG，从工具调用到 Agent 循环
  - id: rag-service
    name: RAG 服务
    group: project
    order: 1
    description: 混合检索加精排的语义搜索服务搭建记录
  - id: qq-bot
    name: QQ 群 AI 助手
    group: project
    order: 2
    description: Agent 架构、三层安全防御与三层记忆系统
  - id: group-buy
    name: 高并发拼团交易系统
    group: project
    order: 3
    description: DDD 分域、折扣试算、库存一致性与退款逆向
  - id: essay
    name: 随笔
    group: life
    order: 1
    description: 生活里的零散记录
  - id: photo
    name: 摄影
    group: life
    order: 2
    description: 按快门的时候在想什么
```

- [ ] **Step 2: 写 `tools/lib/excerpt.js`**

从 `scripts/homepage.js` 原样搬出 `excerptOf`，只改导出方式。

```js
'use strict';

const EXCERPT_LENGTH = 80;

/** 剥掉 Markdown 语法，取纯文本前 N 字作为摘要 */
function excerptOf(post) {
  if (post.description) return post.description;

  let text = post._content || '';
  text = text
    .replace(/<!--\s*more\s*-->/g, '')   // 摘要分隔符
    .replace(/```[\s\S]*?```/g, '')      // 代码块
    .replace(/`([^`]*)`/g, '$1')         // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
    .replace(/^#{1,6}\s+/gm, '')         // 标题
    .replace(/^>\s?/gm, '')              // 引用
    .replace(/^(\s*)([-*+]|\d+\.)\s+/gm, '') // 列表
    .replace(/[*_~]/g, '')               // 强调
    .replace(/<[^>]+>/g, '')             // 残留 HTML 标签
    .replace(/\s+/g, ' ')                // 压缩空白
    .trim();

  return text.length > EXCERPT_LENGTH ? text.slice(0, EXCERPT_LENGTH) + '…' : text;
}

module.exports = { excerptOf, EXCERPT_LENGTH };
```

- [ ] **Step 3: 写 `tools/lib/posts.js`**

```js
'use strict';

const { excerptOf } = require('./excerpt');

/** 把 Hexo post 文档转成模板需要的扁平结构 */
function toPostView(post) {
  return {
    title: post.title,
    date: post.date.clone().locale('en').format('MMM DD'),
    dateISO: post.date.format('YYYY-MM-DD'),
    url: '/' + post.path,
    excerpt: excerptOf(post),
    collection: post.collection || ''
  };
}

module.exports = { toPostView };
```

- [ ] **Step 4: 写 `tools/verify-content.js`**

```js
'use strict';

/**
 * 内容一致性检查。
 *
 *   node tools/verify-content.js           只校验 collection 字段合法 + 打印篇数
 *   node tools/verify-content.js mysql     严格校验 mysql 的篇数是否符合预期
 *   node tools/verify-content.js --all     严格校验全部合集
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const fm = require('hexo-front-matter');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'source', '_posts');
const COLLECTIONS_YML = path.join(ROOT, 'source', '_data', 'collections.yml');

// 各合集的目标篇数，与 spec 第二节的表格一致
const EXPECTED = {
  'java-basics': 5,
  'java-concurrency': 6,
  jvm: 4,
  mysql: 7,
  redis: 6,
  'llm-agent': 8,
  'rag-service': 4,
  'qq-bot': 3,
  'group-buy': 4,
  essay: 2,
  photo: 1
};

function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const only = args.filter(a => !a.startsWith('--'));

  const def = yaml.load(fs.readFileSync(COLLECTIONS_YML, 'utf8'));
  const known = new Set((def.collections || []).map(c => c.id));
  const errors = [];
  const counts = {};

  fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md'))
    .forEach(f => {
      const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
      const data = fm.parse(raw);
      const id = data.collection;
      if (!id) return;
      if (!known.has(id)) {
        errors.push(`${f}: 未知的 collection "${id}"`);
        return;
      }
      counts[id] = (counts[id] || 0) + 1;
    });

  Object.keys(EXPECTED).forEach(id => {
    const actual = counts[id] || 0;
    const strict = all || only.includes(id);
    const ok = actual === EXPECTED[id];
    const mark = strict ? (ok ? '✓' : '✗') : '·';
    console.log(`  ${mark} ${id.padEnd(18)} ${actual} / ${EXPECTED[id]}`);
    if (strict && !ok) errors.push(`${id}: 期望 ${EXPECTED[id]} 篇，实际 ${actual} 篇`);
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n合计 ${total} 篇带 collection 字段的文章`);

  if (errors.length) {
    console.error('\n失败：');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  console.log('\n通过');
}

main();
```

- [ ] **Step 5: 跑脚本，确认当前 0 篇（应当通过，因为还没有未知 id）**

Run: `node tools/verify-content.js`
Expected: 11 行 `·` 标记，全部 `0 / N`，最后打印 `通过`

- [ ] **Step 6: 给现有文章补 `collection` 字段（面经除外，共 15 篇）**

在每篇 front-matter 的 `description` 行后加一行 `collection: <id>`：

| 文件 | collection |
|---|---|
| `Java-泛型入门.md` | `java-basics` |
| `RAG-服务搭建记录-一-从零开始.md` | `rag-service` |
| `RAG-服务搭建记录-二-嵌入与索引.md` | `rag-service` |
| `RAG-服务搭建记录-三-检索与精排.md` | `rag-service` |
| `RAG-服务搭建记录-四-踩坑记.md` | `rag-service` |
| `QQ群AI助手开发记录-一-Agent架构与工具框架.md` | `qq-bot` |
| `QQ群AI助手开发记录-二-三层安全防御.md` | `qq-bot` |
| `QQ群AI助手开发记录-三-三层记忆系统.md` | `qq-bot` |
| `高并发拼团交易系统拆解-一-架构总览与领域分域.md` | `group-buy` |
| `高并发拼团交易系统拆解-二-折扣试算与规则编排.md` | `group-buy` |
| `高并发拼团交易系统拆解-三-库存一致性与幂等.md` | `group-buy` |
| `高并发拼团交易系统拆解-四-结算回调与退款逆向.md` | `group-buy` |
| `五月记.md` | `essay` |
| `我的第一篇文章.md` | `essay` |
| `街角.md` | `photo` |
| `面经-只看简历的模拟一面复盘-拼团与QQ群AI助手.md` | 不加（跨项目，留在分类里） |

- [ ] **Step 7: 跑脚本校验回填结果**

Run: `node tools/verify-content.js --all`
Expected: `rag-service 4 / 4`、`qq-bot 3 / 3`、`group-buy 4 / 4`、`essay 2 / 2`、`photo 1 / 1` 打 `✓`；`java-basics 1 / 5`、`java-concurrency 0 / 6`、`jvm 0 / 4`、`mysql 0 / 7`、`redis 0 / 6`、`llm-agent 0 / 8` 打 `✗`（这些要等后续任务补）。脚本退出码 1 —— **这是预期的**，说明回填生效了且校验真的在起作用。

- [ ] **Step 8: Commit**

```bash
git add source/_data/collections.yml tools/ source/_posts/
git commit -m "feat(collections): 合集数据源 + 内容校验脚本，现有 15 篇补 collection 归属"
```

---

## Task 2: 抽出公共模板 partials

纯重构，不改任何页面行为。目的是让后面三个自定义页面共用一份 CSS 和头尾，否则必然分叉。

**Files:**
- Create: `templates/partials/head.ejs`
- Create: `templates/partials/header.ejs`
- Create: `templates/partials/footer.ejs`
- Modify: `templates/homepage.ejs`（整体重写，视觉内容不变）
- Modify: `scripts/homepage.js:43-64`（传 `path` 给 renderSync，改用共享的 `toPostView`）

**Interfaces:**
- Consumes: Task 1 的 `tools/lib/posts.js`
- Produces:
  - `templates/partials/head.ejs` —— 接收 `<%= pageTitle %>`
  - `templates/partials/header.ejs` —— 无参数
  - `templates/partials/footer.ejs` —— 无参数
  - 三个 partial 必须通过 `include('partials/xxx')` 引用，且 renderSync 必须带 `path` 才能解析

- [ ] **Step 1: 建 `templates/partials/head.ejs`**

把 `templates/homepage.ejs` 第 1–178 行（`<!DOCTYPE html>` 到 `</head>`）整体搬过来，`<title>` 改成变量，并在 `</style>` 前追加四个后面要用的类。

EJS `include` 的路径解析依赖 `filename`，而 `filename` 来自 `renderSync` 的 `path` —— 这一步只是建文件，Step 6 才验证。

```ejs
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><%= pageTitle %></title>
<style>
/* ↓↓↓ 以下 CSS 与 templates/homepage.ejs 第 8–177 行完全一致，原样搬过来 ↓↓↓ */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { font-size: 16px; }
body {
  font-family: -apple-system, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f5f1ea;
  color: #3a3028;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  -webkit-font-smoothing: antialiased;
  line-height: 1.6;
}

.container {
  width: 100%;
  max-width: 780px;
  padding: 0 24px;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0 48px;
}
.site-name {
  font-size: 14px;
  font-weight: 500;
  color: #d4783e;
  text-decoration: none;
  letter-spacing: 1.5px;
}
.header-nav { display: flex; gap: 20px; }
.header-nav a {
  font-size: 13px;
  color: #9a8a78;
  text-decoration: none;
  transition: color 200ms;
}
.header-nav a:hover { color: #d4783e; }

/* Hero */
.hero {
  text-align: center;
  margin-bottom: 44px;
  padding: 40px 0 32px;
  border-bottom: 1px solid #e0d6c6;
}
.hero-title {
  font-family: Georgia, 'Noto Serif SC', serif;
  font-size: 24px;
  font-weight: 400;
  color: #3a3028;
  line-height: 1.5;
  letter-spacing: 0.5px;
}
.hero-sub {
  margin-top: 8px;
  font-size: 13px;
  color: #b0a090;
  letter-spacing: 0.3px;
}

/* Tabs */
.tabs {
  display: flex;
  justify-content: center;
  gap: 28px;
  margin-bottom: 28px;
}
.tab {
  font-size: 13px;
  color: #9a8a78;
  background: none;
  border: none;
  padding: 0 0 4px;
  cursor: pointer;
  font-family: inherit;
  transition: color 200ms;
}
.tab:hover { color: #d4783e; }
.tab.active { color: #d4783e; font-weight: 500; border-bottom: 1.5px solid #d4783e; }

/* Article list */
.section-content { display: none; }
.section-content.active { display: block; }

.article-item {
  display: block;
  padding: 20px 0;
  text-decoration: none;
  border-bottom: 1px solid #e0d6c6;
}
.article-item:last-child { border-bottom: none; }
.article-date {
  font-size: 12px;
  color: #b0a090;
  margin-bottom: 3px;
  letter-spacing: 0.3px;
}
.article-title {
  font-size: 16px;
  font-weight: 500;
  color: #3a3028;
  margin-bottom: 3px;
  transition: color 200ms;
}
.article-item:hover .article-title { color: #d4783e; }
.article-excerpt {
  font-size: 13px;
  color: #9a8a78;
  line-height: 1.5;
}

.empty-state {
  padding: 40px 0;
  color: #b0a090;
  font-size: 14px;
  text-align: center;
}

/* Footer */
.footer {
  text-align: center;
  padding: 48px 0 24px;
  font-size: 12px;
  color: #c0b8a8;
}

@media (max-width: 600px) {
  .header { padding: 14px 0 28px; }
  .hero { padding: 24px 0 20px; }
  .hero-title { font-size: 20px; }
  .tabs { gap: 16px; }
  .article-item { padding: 16px 0; }
}

/* Interaction effects */
html { scroll-behavior: smooth; }

.header-nav a {
  position: relative;
  transition: color 200ms ease;
}
.header-nav a::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 0;
  height: 1px;
  background: #d4783e;
  transition: width 250ms ease;
}
.header-nav a:hover::after {
  width: 100%;
}

.article-item {
  transition: all 250ms ease;
}
.article-item:hover {
  padding-left: 8px;
}
.article-title { transition: color 200ms ease; }

.tab { transition: all 250ms ease; }

/* ↓↓↓ 本次新增：合集卡片与合集详情页 ↓↓↓ */

/* 区块标题 */
.section { margin-bottom: 44px; }
.section-title {
  font-family: Georgia, 'Noto Serif SC', serif;
  font-weight: 400;
  font-size: 18px;
  color: #3a3028;
  margin-bottom: 20px;
  letter-spacing: 0.5px;
}

/* 合集分组 */
.collection-group { margin-bottom: 28px; }
.collection-group:last-child { margin-bottom: 0; }
.group-title {
  font-size: 12px;
  color: #b0a090;
  letter-spacing: 1.2px;
  margin-bottom: 14px;
}
.collection-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.collection-card {
  display: block;
  padding: 16px 18px;
  background: #fbf8f3;
  border: 1px solid #e0d6c6;
  border-radius: 6px;
  text-decoration: none;
  transition: all 250ms ease;
}
.collection-card:hover {
  border-color: #d4783e;
  transform: translateY(-2px);
}
.collection-name {
  font-size: 15px;
  color: #3a3028;
  margin-bottom: 4px;
}
.collection-desc {
  font-size: 12px;
  color: #9a8a78;
  line-height: 1.5;
  min-height: 36px;
}
.collection-count {
  font-size: 12px;
  color: #d4783e;
  margin-top: 8px;
}
@media (max-width: 600px) {
  .collection-grid { grid-template-columns: 1fr 1fr; }
}

/* 合集详情页 */
.back-link {
  display: inline-block;
  font-size: 13px;
  color: #9a8a78;
  text-decoration: none;
  margin-bottom: 18px;
  transition: color 200ms;
}
.back-link:hover { color: #d4783e; }
.collection-head {
  padding: 4px 0 26px;
  border-bottom: 1px solid #e0d6c6;
  margin-bottom: 4px;
}
.collection-head h1 {
  font-family: Georgia, 'Noto Serif SC', serif;
  font-weight: 400;
  font-size: 22px;
  color: #3a3028;
}
.collection-head p {
  font-size: 13px;
  color: #9a8a78;
  margin-top: 6px;
}
</style>
</head>
```

- [ ] **Step 2: 建 `templates/partials/header.ejs`**

```ejs
<header class="header">
  <a href="/" class="site-name">Camille</a>
  <nav class="header-nav">
    <a href="/">首页</a>
    <a href="/collections/">合集</a>
    <a href="/categories/">分类</a>
    <a href="/archives/">归档</a>
    <a href="/about/">关于</a>
  </nav>
</header>
```

- [ ] **Step 3: 建 `templates/partials/footer.ejs`**

```ejs
<div class="footer">© 2026 Camille</div>
```

- [ ] **Step 4: 重写 `templates/homepage.ejs` 为 partial 版本**

保留当前的 tab 结构（内容一字不改），只把 head/header/footer 换成 include。

```ejs
<%- include('partials/head', { pageTitle: 'Camille' }) %>
<body>

<div class="container">

  <%- include('partials/header') %>

  <div class="hero">
    <div class="hero-title">写代码，按快门，偶尔写点东西</div>
    <div class="hero-sub">技术笔记 · 摄影 · 随笔</div>
  </div>

  <div class="tabs">
    <button class="tab active" data-section="tech">技术笔记</button>
    <button class="tab" data-section="photo">摄影</button>
    <button class="tab" data-section="essay">随笔</button>
  </div>

  <% ['tech', 'photo', 'essay'].forEach(function (id) { %>
  <div class="section-content<%- id === 'tech' ? ' active' : '' %>" id="<%- id %>">
    <% tabs[id].forEach(function (p) { %>
    <a class="article-item" href="<%- p.url %>">
      <div class="article-date"><%- p.date %></div>
      <div class="article-title"><%- p.title %></div>
      <div class="article-excerpt"><%- p.excerpt %></div>
    </a>
    <% }); %>
    <% if (!tabs[id].length) { %>
    <div class="empty-state">这里还没有文章</div>
    <% } %>
  </div>
  <% }); %>

  <%- include('partials/footer') %>

</div>

<script>
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    document.getElementById(tab.dataset.section).classList.add('active');
  });
});
</script>

</body>
</html>
```

- [ ] **Step 5: 改 `scripts/homepage.js`**

整体替换成下面这版：删掉本地的 `excerptOf` 和 `EXCERPT_LENGTH`（已搬到 `tools/lib/excerpt.js`），改用 `toPostView`，并给 `renderSync` 加上 `path`。

**关键**：`path` 必须传，否则 EJS 拿不到 `filename`，`include()` 会解析失败。

```js
'use strict';

/**
 * 首页生成器。
 * 从文章数据渲染替换掉 source/index.html 的首页，
 * 文章按分类分组：技术笔记 / 摄影 / 随笔，按日期倒序。
 */

const path = require('path');
const fs = require('fs');
const { toPostView } = require('../tools/lib/posts');

const TABS = [
  { category: '技术笔记', id: 'tech' },
  { category: '摄影', id: 'photo' },
  { category: '随笔', id: 'essay' }
];

const TEMPLATE = path.join(__dirname, '..', 'templates', 'homepage.ejs');

hexo.extend.generator.register('homepage', function (locals) {
  const grouped = {};
  TABS.forEach(t => { grouped[t.id] = []; });
  const tabByCategory = {};
  TABS.forEach(t => { tabByCategory[t.category] = t.id; });

  locals.posts.sort('date', -1).toArray().forEach(post => {
    const cats = post.categories.toArray();
    const tabId = (cats.length && tabByCategory[cats[0].name]) || 'essay';
    grouped[tabId].push(toPostView(post));
  });

  const html = hexo.render.renderSync(
    { text: fs.readFileSync(TEMPLATE, 'utf8'), engine: 'ejs', path: TEMPLATE },
    { tabs: grouped }
  );
  return { path: 'index.html', data: html };
});
```

- [ ] **Step 6: 生成并验证 include 解析成功**

Run: `npx hexo clean && npx hexo generate`
Expected: 无报错。若 EJS 报 `Could not find the include file`，说明 `path` 没传对，回到 Step 5 检查。

- [ ] **Step 7: 验证首页视觉与改版前一致**

Run: `node -e 'const h=require("fs").readFileSync("public/index.html","utf8");const must=["写代码，按快门","data-section","技术笔记","摄影","随笔","© 2026 Camille"];must.forEach(s=>{if(h.indexOf(s)<0)throw new Error("缺少: "+s)});console.log("首页内容 OK, 长度",h.length)'`
Expected: 打印 `首页内容 OK, 长度 <数字>`，无异常

- [ ] **Step 8: Commit**

```bash
git add templates/ scripts/homepage.js
git commit -m "refactor(templates): 抽出 head/header/footer partials，首页改为 include 组装"
```

---

## Task 3: 合集 generator 与两个合集页面

**Files:**
- Create: `tools/lib/collections.js`
- Create: `scripts/collections.js`
- Create: `templates/collection-index.ejs`
- Create: `templates/collection-detail.ejs`

**Interfaces:**
- Consumes: Task 1 的 `tools/lib/posts.js`、Task 2 的 `templates/partials/*`
- Produces:
  - `tools/lib/collections.js` → `buildCollectionGroups(locals): [{ id, name, collections: [{ id, name, description, count, posts }] }]`
  - 生成路径 `/collections/index.html` 与 `/collections/<id>/index.html`

- [ ] **Step 1: 写 `tools/lib/collections.js`**

```js
'use strict';

const { toPostView } = require('./posts');

/**
 * 读 source/_data/collections.yml，把文章按 front-matter 的 collection 字段归入各合集。
 * 返回按组排好序的结构，空组合被过滤掉：
 *   [{ id, name, collections: [{ id, name, description, count, posts }] }]
 */
function buildCollectionGroups(locals) {
  const data = (locals.data && locals.data.collections) || {};
  const defs = data.collections || [];
  const groupDefs = data.groups || [];

  const byCollection = {};
  defs.forEach(d => { byCollection[d.id] = []; });

  locals.posts.sort('date', -1).toArray().forEach(post => {
    const id = post.collection;
    if (id && byCollection[id]) byCollection[id].push(toPostView(post));
  });

  const ordered = defs
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(d => ({
      id: d.id,
      name: d.name,
      group: d.group,
      description: d.description || '',
      count: byCollection[d.id].length,
      posts: byCollection[d.id]
    }));

  return groupDefs
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(g => ({
      id: g.id,
      name: g.name,
      collections: ordered.filter(c => c.group === g.id)
    }))
    .filter(g => g.collections.length > 0);
}

module.exports = { buildCollectionGroups };
```

- [ ] **Step 2: 写 `templates/collection-index.ejs`**

```ejs
<%- include('partials/head', { pageTitle: '合集 · Camille' }) %>
<body>

<div class="container">

  <%- include('partials/header') %>

  <div class="hero">
    <div class="hero-title">合集</div>
    <div class="hero-sub">按主题和项目整理的文章</div>
  </div>

  <% groups.forEach(function (g) { %>
  <div class="collection-group">
    <div class="group-title"><%= g.name %></div>
    <div class="collection-grid">
      <% g.collections.forEach(function (c) { %>
      <a class="collection-card" href="/collections/<%= c.id %>/">
        <div class="collection-name"><%= c.name %></div>
        <div class="collection-desc"><%= c.description %></div>
        <div class="collection-count"><%= c.count %> 篇</div>
      </a>
      <% }); %>
    </div>
  </div>
  <% }); %>

  <%- include('partials/footer') %>

</div>

</body>
</html>
```

- [ ] **Step 3: 写 `templates/collection-detail.ejs`**

```ejs
<%- include('partials/head', { pageTitle: collection.name + ' · Camille' }) %>
<body>

<div class="container">

  <%- include('partials/header') %>

  <a class="back-link" href="/collections/">← 全部合集</a>

  <div class="collection-head">
    <h1><%= collection.name %></h1>
    <p><%= collection.description %>（共 <%= collection.count %> 篇）</p>
  </div>

  <% collection.posts.forEach(function (p) { %>
  <a class="article-item" href="<%= p.url %>">
    <div class="article-date"><%= p.date %></div>
    <div class="article-title"><%= p.title %></div>
    <div class="article-excerpt"><%= p.excerpt %></div>
  </a>
  <% }); %>

  <%- include('partials/footer') %>

</div>

</body>
</html>
```

- [ ] **Step 4: 写 `scripts/collections.js`**

```js
'use strict';

/**
 * 合集页生成器。
 * 产出 /collections/index.html 以及每个合集的 /collections/<id>/index.html。
 * 合集与分组的定义在 source/_data/collections.yml。
 */

const path = require('path');
const fs = require('fs');
const { buildCollectionGroups } = require('../tools/lib/collections');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

function render(templateName, locals) {
  const templatePath = path.join(TEMPLATE_DIR, templateName);
  return hexo.render.renderSync(
    { text: fs.readFileSync(templatePath, 'utf8'), engine: 'ejs', path: templatePath },
    locals
  );
}

hexo.extend.generator.register('collections', function (locals) {
  const groups = buildCollectionGroups(locals);
  const flat = groups.reduce((acc, g) => acc.concat(g.collections), []);

  const pages = [{
    path: 'collections/index.html',
    data: render('collection-index.ejs', { groups })
  }];

  flat.forEach(c => {
    pages.push({
      path: `collections/${c.id}/index.html`,
      data: render('collection-detail.ejs', { collection: c })
    });
  });

  return pages;
});
```

- [ ] **Step 5: 生成并确认 12 个页面文件存在**

Run: `npx hexo clean && npx hexo generate && ls public/collections/ && ls public/collections/*/ -d`
Expected: `public/collections/` 下有 `index.html` 和 11 个目录；每个目录内有 `index.html`

- [ ] **Step 6: 断言 11 个详情页都生成且各自含正确篇数**

Run:
```bash
node -e '
const fs=require("fs");
const exp={"java-basics":1,"java-concurrency":0,"jvm":0,"mysql":0,"redis":0,"llm-agent":0,"rag-service":4,"qq-bot":3,"group-buy":4,"essay":2,"photo":1};
let bad=0;
Object.keys(exp).forEach(id=>{
  const p="public/collections/"+id+"/index.html";
  if(!fs.existsSync(p)){console.error("缺失页面 "+p);bad++;return;}
  const n=(fs.readFileSync(p,"utf8").match(/class="article-item"/g)||[]).length;
  if(n!==exp[id])bad++;
  console.log((n===exp[id]?"ok  ":"BAD ")+id.padEnd(18)+n+" / "+exp[id]);
});
if(bad)throw new Error(bad+" 个合集页不符合预期");
console.log("合集页全部 OK");
'
```
Expected: 每个 id 后跟 `n / 期望值`，最后 `合集页全部 OK`。此时期望：`java-basics 1`、`rag-service 4`、`qq-bot 3`、`group-buy 4`、`essay 2`、`photo 1`，其余为 0。

- [ ] **Step 7: Commit**

```bash
git add tools/lib/collections.js scripts/collections.js templates/collection-index.ejs templates/collection-detail.ejs
git commit -m "feat(collections): 合集 generator 与索引页/详情页"
```

---

## Task 4: 首页改造成落地页 + 导航

**Files:**
- Modify: `templates/homepage.ejs`（整体重写）
- Modify: `scripts/homepage.js`（整体重写）
- Modify: `_config.next.yml:43-47`（menu 加「合集」）
- Modify: `source/_data/styles.styl`（追加合集卡片样式，供 NexT 页面侧保持一致）

**Interfaces:**
- Consumes: Task 3 的 `buildCollectionGroups`、Task 2 的 partials
- Produces: `/index.html` 含 `.collection-card` 与 `.article-item` 两种区块

- [ ] **Step 1: 重写 `templates/homepage.ejs` 为落地页**

```ejs
<%- include('partials/head', { pageTitle: 'Camille' }) %>
<body>

<div class="container">

  <%- include('partials/header') %>

  <div class="hero">
    <div class="hero-title">写代码，按快门，偶尔写点东西</div>
    <div class="hero-sub">技术笔记 · 摄影 · 随笔</div>
  </div>

  <section class="section">
    <h2 class="section-title">合集</h2>
    <% groups.forEach(function (g) { %>
    <div class="collection-group">
      <div class="group-title"><%= g.name %></div>
      <div class="collection-grid">
        <% g.collections.forEach(function (c) { %>
        <a class="collection-card" href="/collections/<%= c.id %>/">
          <div class="collection-name"><%= c.name %></div>
          <div class="collection-desc"><%= c.description %></div>
          <div class="collection-count"><%= c.count %> 篇</div>
        </a>
        <% }); %>
      </div>
    </div>
    <% }); %>
  </section>

  <section class="section">
    <h2 class="section-title">最新</h2>
    <% latest.forEach(function (p) { %>
    <a class="article-item" href="<%= p.url %>">
      <div class="article-date"><%= p.date %></div>
      <div class="article-title"><%= p.title %></div>
      <div class="article-excerpt"><%= p.excerpt %></div>
    </a>
    <% }); %>
  </section>

  <%- include('partials/footer') %>

</div>

</body>
</html>
```

- [ ] **Step 2: 重写 `scripts/homepage.js`**

```js
'use strict';

/**
 * 首页生成器：落地页。
 * 上半部分是合集卡片（来自 source/_data/collections.yml），
 * 下半部分是最新的 N 篇文章。
 */

const path = require('path');
const fs = require('fs');
const { toPostView } = require('../tools/lib/posts');
const { buildCollectionGroups } = require('../tools/lib/collections');

const LATEST_COUNT = 8;
const TEMPLATE = path.join(__dirname, '..', 'templates', 'homepage.ejs');

hexo.extend.generator.register('homepage', function (locals) {
  const groups = buildCollectionGroups(locals);
  const latest = locals.posts
    .sort('date', -1)
    .limit(LATEST_COUNT)
    .toArray()
    .map(toPostView);

  const html = hexo.render.renderSync(
    { text: fs.readFileSync(TEMPLATE, 'utf8'), engine: 'ejs', path: TEMPLATE },
    { groups, latest }
  );
  return { path: 'index.html', data: html };
});
```

- [ ] **Step 3: 生成并断言首页两个区块都有内容**

Run: `npx hexo clean && npx hexo generate && node -e 'const h=require("fs").readFileSync("public/index.html","utf8");const cards=(h.match(/class="collection-card"/g)||[]).length;const items=(h.match(/class="article-item"/g)||[]).length;console.log("合集卡片",cards,"最新文章",items);if(cards!==11)throw new Error("期望 11 个合集卡片");if(items!==8)throw new Error("期望 8 篇最新文章")'`
Expected: `合集卡片 11 最新文章 8`

- [ ] **Step 4: 改 `_config.next.yml` 的 menu**

把 `_config.next.yml` 第 43–47 行替换成下面这版。

**为什么用中文 key 而不是 `collections:`**：NexT 的 `layout/_partials/header/menu-item.njk:8` 是这么取显示名的 ——

```njk
{%- set menuText = __('menu.' + node.name) | replace('menu.', '') %}
```

而 `hexo-i18n`（`dist/i18n.js:56`）在查不到翻译时返回 key 本身：`const str = data[key] || key;`。

所以 `collections: /collections/` → `__('menu.collections')` 查不到 → 返回 `'menu.collections'` → 剥前缀 → 显示英文 **`collections`**。
而 `合集: /collections/` → 返回 `'menu.合集'` → 剥前缀 → 显示 **`合集`**。中文 key 才是确定能出中文的写法。

```yaml
# ---------- 菜单 ----------
menu:
  首页: / || fa fa-home
  合集: /collections/ || fa fa-book
  分类: /categories/ || fa fa-folder-open
  归档: /archives/ || fa fa-archive
  关于: /about/ || fa fa-user
```

注：NexT 自带的 zh-CN 语言包里只有 `home`/`archives`/`categories`/`tags`/`about` 等 key，没有 `collections`，所以这里统一改用中文 key。图标只用 Font Awesome 5 免费版确定存在的（`fa-book` / `fa-folder-open` / `fa-archive` / `fa-user` / `fa-home`）。

- [ ] **Step 5: 给 `source/_data/styles.styl` 末尾追加合集卡片样式**

NexT 页面（分类/归档/关于）本身没有卡片，这里只补一条，让 NexT 侧的分隔线和自定义页面保持一致：

```stylus
// ======== 合集入口（导航） ========
.menu .menu-item a[href="/collections/"] {
  color: #9a8a78;
}
.menu .menu-item a[href="/collections/"]:hover {
  color: #d4783e;
}
```

- [ ] **Step 6: 生成并验证导航**

Run: `npx hexo clean && npx hexo generate && node -e 'const fs=require("fs");["public/index.html","public/archives/index.html"].forEach(f=>{const h=fs.readFileSync(f,"utf8");if(h.indexOf("/collections/")<0)throw new Error(f+" 缺少合集链接");if(h.indexOf("合集")<0)throw new Error(f+" 合集菜单项没显示中文");});console.log("导航 OK：首页与归档页均含中文合集入口")'`
Expected: `导航 OK：首页与归档页均含中文合集入口`。若报 `合集菜单项没显示中文`，说明 key 没按 Step 4 写，回去检查 `_config.next.yml`。

- [ ] **Step 7: Commit**

```bash
git add templates/homepage.ejs scripts/homepage.js _config.next.yml source/_data/styles.styl
git commit -m "feat(home): 首页改为落地页（合集卡片 + 最新文章），导航增加合集入口"
```

---

## Task 5: 现有文章的三处接缝处理

时间线前移到 2025-01 后，三处现有内容与新时间线冲突。

**Files:**
- Modify: `source/_posts/我的第一篇文章.md`（改日期 + 扩写正文）
- Modify: `source/_posts/Java-泛型入门.md`（改日期）
- Modify: `source/about/index.md`（大三 → 大四）

**Interfaces:**
- Consumes: 无
- Produces: 无（纯内容调整）

- [ ] **Step 1: 改 `source/_posts/我的第一篇文章.md`**

front-matter 的 `date` 改为 `2025-01-05 20:00`，正文替换为：

```markdown
这是我的个人博客的第一篇文章。

之前的学习笔记都散在本地的一个 Markdown 文件夹里，时间一长自己都不记得写过什么。索性搭个博客，把学过的东西整理出来 —— 写一遍和看一遍，记得住的量差得挺多。

用 Markdown 写文章，保持简单。
```

- [ ] **Step 2: 改 `source/_posts/Java-泛型入门.md` 的日期**

`date: 2026-05-09` → `date: 2025-04-26 10:00`。正文不动。

- [ ] **Step 3: 改 `source/about/index.md`**

`一名大三学生` → `一名大四学生`。

- [ ] **Step 4: 生成并确认这三篇的日期已生效**

Run: `npx hexo clean && npx hexo generate && ls -d public/2025/01/05/*/ public/2025/04/26/*/ && grep -c "大四学生" public/about/index.html`
Expected: `ls` 列出两篇的新路径各一个目录；`grep -c` 输出 ≥ 1

- [ ] **Step 5: Commit**

```bash
git add source/_posts/我的第一篇文章.md source/_posts/Java-泛型入门.md source/about/index.md
git commit -m "fix(content): 开篇与泛型文前移对齐新时间线，about 更新年级"
```

---

## 内容任务通用规范（Task 6–11 均适用）

每个内容任务的执行方式相同：

1. 按给出的**日期 / 标题 / 合集 / tags / 要点**逐篇写 `source/_posts/<文件名>.md`
2. 文件名：标题去掉标点，冒号换成 `-`，与现有文章风格一致（如 `MySQL-索引入门-B+树为什么快.md`）
3. front-matter 模板：

```markdown
---
title: <标题>
date: <YYYY-MM-DD HH:mm>
categories: [技术笔记]
tags: [<tag1>, <tag2>]
description: <一句话摘要，25–40 字>
collection: <合集 id>
---
```

4. 正文 800–1500 字。深度以本科毕业为准 —— 概念讲清楚，不追源码实现。
5. 每篇至少有一处代码示例或对比表格。
6. 写完该任务的全部文章后，跑 `node tools/verify-content.js <合集id>`，确认篇数打 `✓`。
7. 生成并确认新文章可访问：`npx hexo clean && npx hexo generate`，然后检查 `public/<年>/<月>/<日>/` 下出现对应目录。
8. Commit。

**Task 6: Java 基础（4 篇，合集 `java-basics`）**

| 日期 | 标题 | tags | 要点 |
|---|---|---|---|
| 2025-01-12 | Java 集合入门：ArrayList 和 LinkedList 该怎么选 | Java, 集合 | 从"存一批数据用数组还是集合"切入；ArrayList 底层数组，随机访问 O(1)、中间插入 O(n)；LinkedList 底层双向链表，头尾操作 O(1)、随机访问 O(n)；一张对比表；结论是绝大多数场景选 ArrayList，提一句 CPU 缓存友好性 |
| 2025-02-16 | HashMap 入门：从 put 到扩容 | Java, 集合, HashMap | put 的完整链路：hash → 扰动函数 → 定位桶；哈希冲突用链表，超阈值转红黑树（只说 8 是经验值，不推泊松分布）；扩容条件、负载因子 0.75、容量翻倍与 rehash；一段代码打印扩容前后的容量 |
| 2025-03-15 | Java IO 与 NIO：两种读写模型的区别 | Java, IO, NIO | 从最朴素的 FileInputStream 读文件讲起；BIO 是流 + 阻塞 + 一连接一线程；NIO 是 Channel + Buffer + Selector，非阻塞多路复用；各自适用场景；明确说明本文只讲模型差别，不展开 Netty |
| 2025-04-12 | 异常处理入门：checked 和 unchecked 差在哪 | Java, 异常 | 两类异常的定义差别在编译器管不管；什么时候该用 checked（可恢复的外部故障），什么时候不该；try-with-resources 的写法与好处；三个常见反模式：吞异常、捕获 Exception 一把梭、用异常控制流程 |

**Task 7: Java 并发（6 篇，合集 `java-concurrency`）**

| 日期 | 标题 | tags | 要点 |
|---|---|---|---|
| 2025-05-10 | 为什么不要 new Thread：线程池入门 | Java, 并发, 线程池 | new Thread 的三个问题：创建销毁开销、数量无上限、无法复用；ThreadPoolExecutor 七个参数逐个说明；任务提交后的流转顺序：核心线程 → 队列 → 最大线程 → 拒绝策略；为什么不该用 Executors 的快捷工厂方法 |
| 2025-06-14 | 线程安全的三类问题：原子性、可见性、有序性 | Java, 并发, JMM | 用 `i++` 在多线程下少加开场；原子性：i++ 实际是读-改-写三步；可见性：CPU 缓存与 JMM 主内存模型；有序性：指令重排，用 DCL 单例作例子；一张三类问题与对策的对照表 |
| 2025-07-12 | volatile 到底解决了什么问题 | Java, 并发, volatile | 保证可见性和有序性，不保证原子性；内存屏障的直觉解释；一个"看起来多余其实必要"的循环开关变量例子；重点反驳"volatile 能替代锁"—— 用 i++ 反例说明 |
| 2025-08-16 | synchronized 和 ReentrantLock 的区别 | Java, 并发, 锁 | 用法对比（修饰方法/代码块 vs 显式 lock/unlock）；synchronized 的锁升级：偏向 → 轻量 → 重量，点到为止；ReentrantLock 多出来的能力：可中断、可超时、公平锁、多个 Condition；选型建议 |
| 2025-09-13 | 并发容器入门：ConcurrentHashMap | Java, 并发, ConcurrentHashMap | 先讲 HashMap 为什么线程不安全（JDK7 扩容死循环、JDK8 数据覆盖）；ConcurrentHashMap 的分段锁思路；JDK8 改成 CAS + 头结点 synchronized；复合操作用 putIfAbsent / computeIfAbsent 而不是先 get 再 put |
| 2025-10-18 | CompletableFuture 入门：把串行调用并行起来 | Java, 并发, CompletableFuture | 从"三个互不依赖的接口串行调，耗时相加"切入；创建任务、组合（thenCombine / allOf）、异常处理；必须显式指定线程池，不要用默认 ForkJoinPool；一个聚合 5 个下游接口的例子，耗时从 500ms 降到 200ms |

**Task 8: JVM（4 篇，合集 `jvm`）**

| 日期 | 标题 | tags | 要点 |
|---|---|---|---|
| 2025-11-22 | JVM 内存结构入门 | Java, JVM, 内存 | 运行时数据区五块：程序计数器、虚拟机栈、本地方法栈、堆、方法区；哪些线程私有、哪些共享；堆的分代：Eden + 两个 Survivor + 老年代；一张结构示意图（用表格或 ASCII 画） |
| 2025-12-20 | 垃圾回收入门：从 GC Roots 说起 | Java, JVM, GC | 判断对象存活：引用计数法的缺陷 vs 可达性分析；哪些对象是 GC Roots（栈中引用、静态变量、常量、JNI 引用）；分代回收的基本假设"大部分对象朝生夕死"；Serial / Parallel / CMS / G1 各一句话定位，不展开 |
| 2026-01-17 | 类加载机制入门 | Java, JVM, 类加载 | 生命周期七步，重点讲加载、验证、准备、解析、初始化；准备阶段赋零值与初始化阶段赋真值的区别（一个 static 变量的例子）；双亲委派模型，以及它为什么能防止核心类被替换；一句话带过打破双亲委派的场景 |
| 2026-02-14 | 一次 OOM 排查记录 | Java, JVM, 排查, OOM | 现象：服务跑一晚上内存涨满 OOM；加 `-XX:+HeapDumpOnOutOfMemoryError` 拿到 dump；用 MAT 看支配树，定位到一个只增不减的 Map；根因是本地缓存没做淘汰；修复方式与复盘 |

**Task 9: MySQL（7 篇，合集 `mysql`）**

| 日期 | 标题 | tags | 要点 |
|---|---|---|---|
| 2026-02-28 | MySQL 索引入门：B+ 树为什么快 | MySQL, 索引 | 从"数据多了查询就慢"切入；没有索引时是全表扫描；为什么选 B+ 树而不是二叉树或哈希 —— 磁盘 IO 次数、范围查询友好、非叶子节点不存数据所以扇出大；带一句聚簇索引和二级索引的区别，展开留给后面 |
| 2026-03-14 | 联合索引与最左前缀原则 | MySQL, 索引 | 什么是联合索引；`(a,b,c)` 为什么能用 a、a+b、a+b+c，而单独查 b 用不上；用 explain 验证三种写法的对比表；索引列顺序怎么定（区分度 + 实际查询模式） |
| 2026-03-28 | explain 怎么看：一次慢查询分析 | MySQL, explain, 索引 | explain 各列含义，重点 type / key / rows / Extra；type 取值从好到坏（system > const > eq_ref > ref > range > index > ALL）；Extra 里 Using filesort / Using temporary 意味着什么；拿一条真实慢 SQL 完整走一遍 |
| 2026-04-11 | 事务与 ACID：从一次转账说起 | MySQL, 事务 | 转账例子：扣款和入账必须一起成功；ACID 各自靠什么机制实现 —— 原子性靠 undo log、持久性靠 redo log、隔离性靠锁和 MVCC、一致性是目的而非手段；开启事务的写法；长事务的危害 |
| 2026-04-25 | MVCC 与隔离级别入门 | MySQL, 事务, MVCC | 四种隔离级别与各自的问题（脏读 / 不可重复读 / 幻读），一张表；MVCC 三件套：隐藏字段 + undo log 版本链 + ReadView；为什么 RR 下大部分情况能避免幻读；一句话区分快照读与当前读 |
| 2026-05-16 | 加锁分析：间隙锁与死锁 | MySQL, 锁, 死锁 | 行锁、间隙锁、临键锁的区别；间隙锁在 RR 下用来解决幻读；两条 UPDATE 加锁顺序相反导致死锁的实例（给 SQL 和报错）；减少死锁的几条实践：固定加锁顺序、缩短事务、避免无索引更新 |
| 2026-06-13 | 一次慢查询优化实践 | MySQL, 优化, 索引 | 现象：列表接口 P99 从 200ms 涨到 2s；定位：慢查询日志 + explain；根因是深分页 `LIMIT 100000, 20` 没走索引；优化：加联合索引 + 延迟关联改写；优化前后 explain 与耗时对比 |

**Task 10: Redis（6 篇，合集 `redis`）**

| 日期 | 标题 | tags | 要点 |
|---|---|---|---|
| 2026-06-27 | Redis 数据结构入门：五种类型怎么用 | Redis, 数据结构 | String / Hash / List / Set / ZSet 各自的典型用途；底层结构一句话（SDS、跳表、压缩列表），不展开；选型问题：存一个对象用 Hash 还是序列化成 String；用 ZSet 做排行榜的小例子 |
| 2026-07-11 | 缓存穿透、击穿、雪崩：三个常被念错的名词 | Redis, 缓存 | 三个词各自的准确含义（容易混，要讲清区别）；对策分别是什么 —— 穿透用空值缓存 / 布隆过滤器，击穿用互斥锁 / 逻辑过期，雪崩用过期时间加随机 + 多级缓存；一张对照表；点出一个常见误答"加随机过期就能解决穿透" |
| 2026-07-25 | Redis 持久化：RDB 与 AOF | Redis, 持久化 | RDB：快照、fork 子进程、二进制紧凑、恢复快，但可能丢一段数据；AOF：命令追加、appendfsync 三种刷盘策略的取舍、AOF 重写；混合持久化怎么开；生产环境怎么选 |
| 2026-08-08 | 分布式锁入门：从 SETNX 说起 | Redis, 分布式锁 | 为什么单机锁在多实例下失效；`SETNX` + `EXPIRE` 分开写的两个问题（非原子、误删别人的锁）；正确写法 `SET key value NX PX`，value 存唯一标识，释放用 Lua 脚本比对；老实交代：主从切换下仍有锁失效窗口，Redlock 也有争议 |
| 2026-08-22 | Redis 过期策略与内存淘汰 | Redis, 内存 | 惰性删除 + 定期删除的组合及其各自的取舍；八种 maxmemory-policy，重点讲 allkeys-lru 和 volatile-lru 的差别；maxmemory 该怎么配；一个"内存莫名满了"的排查思路（bigkeys / memory usage） |
| 2026-09-05 | 缓存与数据库的一致性入门 | Redis, 缓存, 一致性 | 四种更新组合为什么都有坑 —— 先删缓存再更新库、先更新库再删缓存各自的并发问题；为什么最终推荐 Cache Aside（先更新库、再删缓存）；延迟双删补的是什么；老实说：并发下没有完美方案，只能把不一致窗口缩小 |

**Task 11: LLM 与 Agent（8 篇，合集 `llm-agent`）**

| 日期 | 标题 | tags | 要点 |
|---|---|---|---|
| 2025-11-08 | 什么是 Token：模型是怎么读你的话的 | LLM, Token | 模型看不见字，只看得见 token；BPE 的直觉：常见词一个 token，生僻词被拆开；中文为什么普遍比英文费 token；上下文窗口和计费都按 token 算，用一句话对比例子 |
| 2025-12-06 | 从 Prompt 到 RAG：为什么模型需要外部知识 | LLM, RAG | 模型的知识停在训练截止时间；三种补知识的方式：塞进 prompt、微调、RAG，各自成本与适用面；RAG 的基本流程：切块 → 嵌入 → 检索 → 拼进上下文；什么情况下 RAG 反而是过度设计 |
| 2026-01-10 | 向量与相似度：余弦相似度入门 | LLM, 向量, 相似度 | 嵌入把文本变成一串浮点数；余弦相似度的几何直觉 —— 看夹角，与向量长度无关；为什么文本检索里通常不用欧氏距离；用几个句子算一遍相似度并排序 |
| 2026-02-07 | Function Calling：让模型学会调用工具 | LLM, Agent, 工具调用 | 模型本身查不了天气，但它能"说"要调哪个函数、传什么参数；一次完整往返：定义 tools → 模型返回 tool_calls → 本地执行 → 回填结果 → 模型总结；参数 schema 由谁校验；两个常见坑：模型编造参数、陷入循环调用 |
| 2026-03-07 | Agent 的基本循环：感知、决策、执行 | LLM, Agent | 从"一问一答"到"多轮自主"的差别；ReAct 的思路：想一步、做一步、看结果；循环的终止条件与最大轮数上限；什么时候该用 Agent，什么时候一个固定 workflow 就够了（大多数场景是后者） |
| 2026-04-04 | 什么是 MCP | LLM, MCP | 问题背景：每个工具都要为每个模型接一遍；MCP 想做的事 —— 把工具和资源的接入方式标准化；三个角色 host / client / server 各负责什么；老实说：这层协议解决的是工程重复，不解决模型能力 |
| 2026-05-23 | 上下文工程入门：Agent 的记忆该怎么设计 | LLM, Agent, 上下文 | 上下文窗口是稀缺资源；三层划分：会话历史（短期）、检索出来的事实（长期）、摘要压缩；什么时候该截断、什么时候该总结；一个多轮对话上下文爆炸的例子与处理方式 |
| 2026-07-18 | LLM 应用的成本与延迟：一次权衡记录 | LLM, 工程 | token 成本怎么算（输入和输出定价不同，输出通常更贵）；延迟的三个来源：首 token 时间、生成速度、串行调用次数；常见的省法：结果缓存、小模型路由、并行工具调用、流式输出；老实说：多数场景延迟比成本更影响体验 |

---

## Task 12: 全量验收

**Files:** 无新增；只做校验

- [ ] **Step 1: 严格校验全部合集篇数**

Run: `node tools/verify-content.js --all`
Expected: 11 行全部打 `✓`，`合计 50 篇带 collection 字段的文章`，退出码 0

- [ ] **Step 2: 全新生成并断言页面数量**

Run: `npx hexo clean && npx hexo generate && node -e 'const fs=require("fs");const exp={"java-basics":5,"java-concurrency":6,jvm:4,mysql:7,redis:6,"llm-agent":8,"rag-service":4,"qq-bot":3,"group-buy":4,essay:2,photo:1};let bad=0;Object.keys(exp).forEach(id=>{const p="public/collections/"+id+"/index.html";if(!fs.existsSync(p)){console.error("缺页面 "+id);bad++;return;}const n=(fs.readFileSync(p,"utf8").match(/class="article-item"/g)||[]).length;if(n!==exp[id]){console.error("BAD "+id+" "+n+" != "+exp[id]);bad++;}});if(bad)process.exit(1);console.log("11 个合集页全部符合预期")'`
Expected: `11 个合集页全部符合预期`

- [ ] **Step 3: 断言首页**

Run: `node -e 'const h=require("fs").readFileSync("public/index.html","utf8");const c=(h.match(/class="collection-card"/g)||[]).length;const i=(h.match(/class="article-item"/g)||[]).length;if(c!==11)throw new Error("合集卡片 "+c);if(i!==8)throw new Error("最新文章 "+i);console.log("首页 OK：11 合集卡片 + 8 最新文章")'`
Expected: `首页 OK：11 合集卡片 + 8 最新文章`

- [ ] **Step 4: 确认归档时间线连续**

Run: `ls public/2025/ public/2026/ && ls public/2025/ | wc -l && ls public/2026/ | wc -l`
Expected: `public/2025/` 下有 `01 02 03 04 05 06 07 08 09 10 11 12` 共 12 个月目录；`public/2026/` 下有 `01` 到 `09` 共 9 个。若某月缺失说明该月文章没排上，回对应内容任务补。

- [ ] **Step 5: 抽样通读 6 篇新文章**

逐个打开确认深度和篇幅符合要求（800–1500 字、无源码级展开）：

- `source/_posts/Java-集合入门-ArrayList和LinkedList该怎么选.md`
- `source/_posts/线程安全的三类问题-原子性可见性有序性.md`
- `source/_posts/MySQL-索引入门-B+树为什么快.md`
- `source/_posts/Redis-数据结构入门-五种类型怎么用.md`
- `source/_posts/什么是Token-模型是怎么读你的话的.md`
- `source/_posts/Agent的基本循环-感知决策执行.md`

- [ ] **Step 6: 本地起服务目视检查**

Run: `npx hexo server`（后台跑，检查完 Ctrl-C）
人工打开确认：
- `http://localhost:4000/` —— 首页三组合集卡片 + 最新文章，点击卡片可跳转
- `http://localhost:4000/collections/` —— 11 个卡片按三组分节
- `http://localhost:4000/collections/mysql/` —— 7 篇按日期倒序
- `http://localhost:4000/archives/` —— 时间线从 2025-01 开始
- 中文导航项显示正常（不是 `collections` 字面量）

- [ ] **Step 7: 确认没有生成物混进待提交列表**

Run: `git status --short`
Expected: 只有 `source/_posts/` 下的新增 `.md`、以及被修改的模板/脚本/配置。**不得**出现 `public/`、`db.json`、`node_modules/`、`.deploy_git/`。

- [ ] **Step 8: 最终提交**

```bash
git add -A
git commit -m "feat(content): 新增 35 篇文章铺满 2025-01 起的时间线"
```

---

## 完成标准

- `node tools/verify-content.js --all` 退出码 0，11 个合集篇数为 5/6/4/7/6/8/4/3/4/2/1
- `npx hexo generate` 无报错，`public/collections/` 下有 11 个详情页
- 首页显示 11 个合集卡片（三组分节）+ 8 篇最新文章
- 归档时间线覆盖 2025-01 到 2026-09，无空月
- `git status` 干净，生成物未入库
- 全部改动只在本地 `main`，未 push、未 deploy
