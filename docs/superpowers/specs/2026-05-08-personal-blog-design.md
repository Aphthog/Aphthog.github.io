# 个人博客设计方案

## 概述

综合性个人博客，支持技术文章、生活随笔、作品展示等多种内容类型。目标是让博主只需要关心写 Markdown 文章，零服务器维护成本。

## 技术选型

| 维度 | 选择 | 理由 |
|---|---|---|
| 框架 | **Hexo** | 专为博客设计，上手快，生态成熟 |
| 主题 | **NexT（极简风格）** | Hexo 生态最流行的主题，文档完善 |
| 部署 | **GitHub Pages** | 免费托管，`hexo deploy` 一键部署 |
| 域名 | `camille.github.io`（免费） | 后续可随时绑定自定义域名 |

## 不纳入范围（后续可加）

- 评论系统 — 不需要，后续可接入 Gitalk / Waline
- 站内搜索 — 暂不需要，NexT 支持本地搜索可后期开启
- 访问统计 — 暂不需要
- 用户注册/登录 — 个人博客，不需要
- 后端服务器 — 纯静态，不涉及

## 项目结构

```
Camille-Blog/
├── source/
│   ├── _posts/          # Markdown 文章目录
│   │   └── hello-world.md
│   └── about/
│       └── index.md     # 关于页面
├── themes/
│   └── next/            # NexT 主题
├── scaffolds/           # 文章模板
├── _config.yml          # Hexo 主配置
└── package.json
```

## 日常使用流程

```
1. hexo new post "文章标题"   → 生成 Markdown 文件
2. 编辑 Markdown 文件         → 用任何编辑器写内容
3. hexo server               → 本地预览
4. hexo deploy               → 部署到 GitHub Pages
```

博主只需要关心第 2 步写文章。

## 部署架构

```
本地 (hexo generate)
  │ hexo deploy
  ▼
GitHub 仓库 (camille/camille.github.io)
  │
  ▼
GitHub Pages (https://camille.github.io)
```

## 设计原则

- **写作为中心**：所有配置一次性完成，日常只操作 Markdown 文件
- **关注点分离**：内容（Markdown）与展示（主题/配置）互不干扰
- **渐进增强**：评论、搜索、统计等功能在设计上留出接入点，但不提前实现
- **低成本迁移**：所有源文件为纯文本，可随时切换主题、部署平台或生成器
