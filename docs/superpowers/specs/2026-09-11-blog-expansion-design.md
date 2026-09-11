# 博客扩容改版设计

日期：2026-09-11
状态：待评审
关联：[2026-05-08 个人博客设计](2026-05-08-personal-blog-design.md)

## 背景与目标

现有博客（Hexo 8 + NexT 8 Gemini 风格）上线于 2026-05，共 16 篇文章，全部集中在 2026-05 至 2026-09。两个问题：

1. **内容量偏少** —— 时间线只有一个密集的 5 月和一个 8 月，看起来像"一次性补的"，不像长期写作的博客。
2. **信息架构缺一层** —— 只有「分类」和「归档」，没有把同一主题下的多篇文章组织起来的「合集」概念。已有的 RAG / 拼团 / QQ-bot 三个系列，现在只能靠 tag 和日期找。

本次要达成：

- 时间线铺开到 2025-01，形成"大二寒假起步 → 大三打基础 → 大四求职"的连续弧线
- 站点信息架构增加「合集」层级，首页改为落地页
- 新增 35 篇技术文章，覆盖 Java / MySQL / Redis / LLM 与 Agent

**非目标**：不改现有文章的正文（除下述两处接缝）；不动 `_config.yml` 的 deploy 配置；不做评论、搜索、统计等新功能。

## 一、合集模型

合集定义收敛到单一数据源 `_data/collections.yml`，由 generator 读取并渲染页面。文章通过 front-matter 的 `collection: <id>` 字段**显式**声明归属 —— 不用 tag 匹配，避免将来 tag 命名漂移导致静默归类错误。

合集分三组，共 11 个：

### 技术主题线

| id | 名称 | 篇数 |
|---|---|---|
| `java-basics` | Java 基础 | 5 |
| `java-concurrency` | Java 并发 | 6 |
| `jvm` | JVM | 4 |
| `mysql` | MySQL | 7 |
| `redis` | Redis | 6 |
| `llm-agent` | LLM 与 Agent | 8 |

### 项目实践

| id | 名称 | 篇数 |
|---|---|---|
| `rag-service` | RAG 服务 | 4 |
| `qq-bot` | QQ 群 AI 助手 | 3 |
| `group-buy` | 高并发拼团交易系统 | 4 |

### 写作与摄影

| id | 名称 | 篇数 |
|---|---|---|
| `essay` | 随笔 | 2 |
| `photo` | 摄影 | 1 |

`essay` / `photo` 两个合集各自只有个位数文章，进合集的目的是保住「写代码 · 按快门」的站点定位 —— 否则首页会变成纯技术卡片墙。

`_data/collections.yml` 结构：

```yaml
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
    description: 从集合、IO 到异常，Java 语言层面的基本功
  # ... 其余同构
```

`order` 用于首页卡片和导航内的排序；`description` 直接渲染到合集详情页顶部和首页卡片。合集页内的文章按日期倒序，不引入人工序号（同合集文章之间是并列关系，不是严格递进的系列）。

## 二、文章清单

### 新增 35 篇

每篇 800–1500 字。日期即 front-matter 的 `date`，同时决定归档分组和合集页排序。

#### 2025 年（14 篇）

| 日期 | 标题 | 合集 |
|---|---|---|
| 2025-01-12 | Java 集合入门：ArrayList 和 LinkedList 该怎么选 | `java-basics` |
| 2025-02-16 | HashMap 入门：从 put 到扩容 | `java-basics` |
| 2025-03-15 | Java IO 与 NIO：两种读写模型的区别 | `java-basics` |
| 2025-04-12 | 异常处理入门：checked 和 unchecked 差在哪 | `java-basics` |
| 2025-05-10 | 为什么不要 new Thread：线程池入门 | `java-concurrency` |
| 2025-06-14 | 线程安全的三类问题：原子性、可见性、有序性 | `java-concurrency` |
| 2025-07-12 | volatile 到底解决了什么问题 | `java-concurrency` |
| 2025-08-16 | synchronized 和 ReentrantLock 的区别 | `java-concurrency` |
| 2025-09-13 | 并发容器入门：ConcurrentHashMap | `java-concurrency` |
| 2025-10-18 | CompletableFuture 入门：把串行调用并行起来 | `java-concurrency` |
| 2025-11-08 | 什么是 Token：模型是怎么读你的话的 | `llm-agent` |
| 2025-11-22 | JVM 内存结构入门 | `jvm` |
| 2025-12-06 | 从 Prompt 到 RAG：为什么模型需要外部知识 | `llm-agent` |
| 2025-12-20 | 垃圾回收入门：从 GC Roots 说起 | `jvm` |

#### 2026 年（21 篇）

| 日期 | 标题 | 合集 |
|---|---|---|
| 2026-01-10 | 向量与相似度：余弦相似度入门 | `llm-agent` |
| 2026-01-17 | 类加载机制入门 | `jvm` |
| 2026-02-07 | Function Calling：让模型学会调用工具 | `llm-agent` |
| 2026-02-14 | 一次 OOM 排查记录 | `jvm` |
| 2026-02-28 | MySQL 索引入门：B+ 树为什么快 | `mysql` |
| 2026-03-07 | Agent 的基本循环：感知、决策、执行 | `llm-agent` |
| 2026-03-14 | 联合索引与最左前缀原则 | `mysql` |
| 2026-03-28 | explain 怎么看：一次慢查询分析 | `mysql` |
| 2026-04-04 | 什么是 MCP | `llm-agent` |
| 2026-04-11 | 事务与 ACID：从一次转账说起 | `mysql` |
| 2026-04-25 | MVCC 与隔离级别入门 | `mysql` |
| 2026-05-16 | 加锁分析：间隙锁与死锁 | `mysql` |
| 2026-05-23 | 上下文工程入门：Agent 的记忆该怎么设计 | `llm-agent` |
| 2026-06-13 | 一次慢查询优化实践 | `mysql` |
| 2026-06-27 | Redis 数据结构入门：五种类型怎么用 | `redis` |
| 2026-07-11 | 缓存穿透、击穿、雪崩：三个常被念错的名词 | `redis` |
| 2026-07-18 | LLM 应用的成本与延迟：一次权衡记录 | `llm-agent` |
| 2026-07-25 | Redis 持久化：RDB 与 AOF | `redis` |
| 2026-08-08 | 分布式锁入门：从 SETNX 说起 | `redis` |
| 2026-08-22 | Redis 过期策略与内存淘汰 | `redis` |
| 2026-09-05 | 缓存与数据库的一致性入门 | `redis` |

密度约每月 1.75 篇，没有连续三个月空档。

### 已有 16 篇的归属

正文全部保留，只补 `collection` 字段：

| 文章 | 归属 |
|---|---|
| RAG 服务搭建记录 ×4 | `rag-service` |
| 高并发拼团交易系统拆解 ×4 | `group-buy` |
| QQ 群 AI 助手开发记录 ×3 | `qq-bot` |
| 面经：一场只看简历的模拟一面 | 无合集（跨项目，留在分类/标签里） |
| Java 泛型入门 | `java-basics` |
| 五月记 / 街角 / 我的第一篇文章 | `essay` / `photo` / `essay` |

## 三、站点结构与实现

### 导航

顶部导航（含 NexT 页面和自定义页面）统一为：**首页 · 合集 · 分类 · 归档 · 关于**

### 文件改动

**新增**

| 文件 | 作用 |
|---|---|
| `_data/collections.yml` | 合集定义，唯一数据源 |
| `scripts/collections.js` | generator：`/collections/` 索引页 + `/collections/<id>/` 详情页 |
| `templates/partials/head.ejs` | `<head>` + 全部 CSS（单一真相） |
| `templates/partials/header.ejs` | 站名 + 导航 |
| `templates/partials/footer.ejs` | 页脚 + 内联脚本位 |
| `templates/collection-index.ejs` | 合集索引页（三组分组展示） |
| `templates/collection-detail.ejs` | 单个合集的文章列表 |
| `source/_posts/*.md` × 35 | 新文章 |

**修改**

| 文件 | 改动 |
|---|---|
| `templates/homepage.ejs` | 重写为落地页，改为引用 partials |
| `scripts/homepage.js` | 读 `collections.yml`，向模板传合集分组 + 最新文章 |
| `_config.next.yml` | menu 增加「合集」 |
| `source/_data/styles.styl` | 补合集卡片与合集页的 NexT 侧样式 |
| 现有 16 篇 × 1 行 | 补 `collection:` |
| `source/about/index.md` | 「大三学生」→「大四学生」 |

### 模板组织

当前 `templates/homepage.ejs` 是一个 234 行、CSS 全内联的独立 HTML。本次页面数从 1 个增加到 3 个（首页 / 合集索引 / 合集详情），若继续各写一份独立 HTML，CSS 必然分叉。

因此抽出 `templates/partials/{head,header,footer}.ejs`，三个自定义页面通过 EJS 的 `include` 复用。

`scripts/homepage.js` 里现有的 `excerptOf()` 摘要清洗函数（剥离 Markdown 语法取前 80 字）会被合集详情页复用 —— 提取到 `scripts/lib/excerpt.js`，供两个 generator 共享。

### 已知接缝

自定义页面（首页 / 合集）和 NexT 原生页面（归档 / 分类 / 关于 / 文章详情）的 header 是**两处独立实现**：前者来自 `templates/partials/header.ejs`，后者由 NexT 主题渲染。

两边视觉一致是靠 `source/_data/styles.styl` 把 NexT 的 header 调成同一套暖色变量实现的，已经是现状。本次不消除这个接缝（消除它意味着要么全站自定义、要么放弃自定义首页），但把「改动 header 时要同时看两处」记在这里。

## 四、现有文章的接缝处理

时间线前移到 2025-01 后，三处现有内容与新时间线冲突，逐项处理：

| 问题 | 处理 | 影响面 |
|---|---|---|
| 「我的第一篇文章」写于 2026-05-08，正文写"这是我的个人博客的第一篇文章"，但新时间线从 2025-01 开始 | 日期前移到 **2025-01-05**；正文略作扩写，让它真正承担开篇的作用 | 正文约 100 字 |
| 「Java 泛型入门」日期 2026-05-09，但同合集的其余 4 篇在 2025-01~04，时间上倒挂 | 日期前移到 **2025-04-26** | 仅日期 |
| `about` 页写「一名大三学生」，2026-09 已是大四上 | 改为「一名大四学生」 | 一行 |

以下**不在本次范围内**：

- `_config.yml` 的 `deploy` 段指向 `main` 分支，而源码就在 `main` —— 本地误跑 `hexo deploy` 会用生成物覆盖源码分支。这是真实隐患但与本需求无关，单独处理。
- `source/404.html` 和 `source/about/index.md` 的样式细节。

## 五、写作要求

正常博客语气，正常写。

唯一的硬约束是**深度**：本科毕业水平，点到为止，以「HashMap」为例 —— 讲清数组 + 链表 + 红黑树的结构和扩容时机即可，不展开 treeify 阈值为 8 的泊松分布推导。

篇幅 800–1500 字，宁短勿注水。

## 六、验收标准

1. `npx hexo generate` 无报错，`public/` 下生成 `/index.html`、`/collections/index.html` 及 11 个 `/collections/<id>/index.html`
2. 首页列出 11 个合集卡片（按三组分节）和最新文章
3. 每个合集详情页列出该合集下全部文章，数量与第一节表格一致
4. 11 个合集的文章总数 = 新增 35 + 已有 15（面经无归属）= 50
5. 10 篇抽样文章（每个技术合集各 1–2 篇）人工通读，深度符合第五节
6. 本地 `npx hexo server` 目视检查首页、合集索引页、2 个合集详情页
7. `git status` 中不出现 `public/`、`db.json` 等生成物
