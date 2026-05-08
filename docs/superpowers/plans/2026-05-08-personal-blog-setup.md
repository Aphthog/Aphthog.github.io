# Camille 个人博客搭建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零搭建一个 Hexo + NexT 主题的个人博客，部署到 GitHub Pages

**架构:** Hexo 静态站点生成器 + NexT 主题，纯静态文件托管在 GitHub Pages，日常通过 Markdown 写文章

**技术栈:** Node.js v22, Hexo, NexT 主题, Git

---

### Task 1: 全局安装 Hexo CLI

**Files:** 无（全局安装）

- [ ] **Step 1: 安装 hexo-cli**

运行：
```bash
npm install -g hexo-cli
```
预期输出：显示已安装的版本号。

- [ ] **Step 2: 验证安装成功**

运行：
```bash
hexo --version
```
预期输出：显示 hexo-cli 版本号（如 `hexo-cli: 4.3.2`）和相关依赖版本。

---

### Task 2: 初始化 Hexo 项目

> 由于 `C:\Users\Camille\Desktop\Camille-Blog` 目录已存在（包含 CLAUDE.md 和 docs/），需临时移出再初始化。

**Files:**
- 创建目录: `Camille-Blog/`（Hexo 初始化生成的项目骨架）
- 移动: `Camille-Blog/CLAUDE.md`
- 移动: `Camille-Blog/docs/`

- [ ] **Step 1: 备份现有文件**

```bash
cd /c/Users/Camille/Desktop
mkdir -p /c/Users/Camille/Desktop/Camille-Blog-backup
cp /c/Users/Camille/Desktop/Camille-Blog/CLAUDE.md /c/Users/Camille/Desktop/Camille-Blog-backup/
cp -r /c/Users/Camille/Desktop/Camille-Blog/docs /c/Users/Camille/Desktop/Camille-Blog-backup/
```
预期输出：文件复制成功。

- [ ] **Step 2: 初始化 Hexo**

```bash
cd /c/Users/Camille/Desktop
rm -rf Camille-Blog
hexo init Camille-Blog
```
预期输出：Hexo 自动生成项目骨架，显示 `INFO  Start blogging with Hexo!`。

- [ ] **Step 3: 恢复备份文件**

```bash
cp /c/Users/Camille/Desktop/Camille-Blog-backup/CLAUDE.md /c/Users/Camille/Desktop/Camille-Blog/
cp -r /c/Users/Camille/Desktop/Camille-Blog-backup/docs /c/Users/Camille/Desktop/Camille-Blog/
rm -rf /c/Users/Camille/Desktop/Camille-Blog-backup
```
预期输出：文件恢复完成。项目目录下同时有 Hexo 骨架 + CLAUDE.md + docs 设计文档。

- [ ] **Step 4: 验证本地预览**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo server
```
预期输出：终端显示 `Hexo is running at http://localhost:4000`。在浏览器打开 http://localhost:4000 确认看到默认 Hello World 页面。

按 `Ctrl+C` 停止本地服务器。

- [ ] **Step 5: 安装项目依赖**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
npm install
```
预期输出：安装完成，无报错。

- [ ] **Step 6: Commit 初始化结果**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
git add .
git commit -m "chore: initialize Hexo blog project"
```

---

### Task 3: 安装和配置 NexT 主题

**Files:**
- 修改: `Camille-Blog/_config.yml`（主题配置）
- 修改: `Camille-Blog/_config.next.yml`（NexT 主题配置，新建）

- [ ] **Step 1: 安装 NexT 主题**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
npm install hexo-theme-next
```
预期输出：NexT 主题安装到 `node_modules/hexo-theme-next/`。

- [ ] **Step 2: 在 Hexo 配置中启用 NexT 主题**

打开 `Camille-Blog/_config.yml`，找到 `theme:` 行，修改为：

```yaml
theme: next
```

- [ ] **Step 3: 创建 NexT 主题配置文件**

Hexo 6+ 支持通过 `_config.next.yml` 覆盖主题默认配置。创建文件并添加基础配置：

```yaml
# _config.next.yml

# 主题风格: Muse（简洁）/ Mist（紧凑）/ Pisces（双栏）/ Gemini（扁平化）
scheme: Gemini

# 网站图标
favicon:
  small: /images/favicon-16x16.png
  medium: /images/favicon-32x32.png

# 社交链接
social:
  GitHub: https://github.com/camille || fab fa-github

# 侧边栏头像
avatar:
  url: # /images/avatar.png（后续可替换）
  rounded: true
  rotated: false

# 文章摘要（首页不显示全文，只显示到 <!-- more --> 标签为止的部分）
excerpt_description: true

# 返回顶部按钮
back2top:
  enable: true

# 页脚信息
footer:
  since: 2026
```

- [ ] **Step 4: 验证主题生效**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo clean
hexo server
```
预期输出：浏览器打开 http://localhost:4000，看到 NexT 主题的博客页面（不再是默认主题）。

按 `Ctrl+C` 停止。

- [ ] **Step 5: Commit NexT 配置**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
git add _config.yml _config.next.yml
git commit -m "feat: install and configure NexT theme"
```

---

### Task 4: 配置 GitHub Pages 部署

**Files:**
- 修改: `Camille-Blog/_config.yml`
- 创建: `Camille-Blog/.github/workflows/pages.yml`（可选）

- [ ] **Step 1: 安装 hexo-deployer-git**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
npm install hexo-deployer-git
```
预期输出：安装成功。

- [ ] **Step 2: 修改 Hexo 配置中的部署设置**

在 `_config.yml` 底部找到 `deploy:` 部分，配置如下：

```yaml
deploy:
  type: git
  repo: https://github.com/camille/camille.github.io.git
  branch: main
```

> 注意：你需要先将 GitHub 用户名 `camille` 替换为你的实际 GitHub 用户名。如果你尚未创建 `camille.github.io` 仓库，需先在 GitHub 上创建。

- [ ] **Step 3: 配置网站 URL**

在 `_config.yml` 中修改：

```yaml
url: https://camille.github.io
root: /
```

- [ ] **Step 4: Commit 部署配置**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
git add _config.yml
git commit -m "chore: configure GitHub Pages deployment"
```

---

### Task 5: 创建 GitHub 仓库并首次部署

> 需要 GitHub 账号和 GitHub CLI (`gh`) 进行此任务。如果没有安装 `gh`，可以手动在 GitHub 网站上创建仓库。

**Files:** 无

- [ ] **Step 1: 检查 GitHub CLI 是否可用**

```bash
gh auth status 2>&1
```
如果未安装或未登录，打开 https://github.com/new 手动创建仓库（仓库名：`camille.github.io`）。

- [ ] **Step 2: 创建 GitHub 仓库**

使用 GitHub CLI:

```bash
gh repo create camille/camille.github.io --public --description "个人博客" --remote
```
预期输出：仓库创建成功，并添加为本地 git remote。

- [ ] **Step 3: 生成静态文件并部署**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo clean
hexo generate
hexo deploy
```
预期输出：Hexo 生成静态文件并推送到 GitHub Pages 仓库。

- [ ] **Step 4: 验证线上访问**

打开浏览器访问 `https://camille.github.io`，确认博客正常显示。

- [ ] **Step 5: 记录部署完成**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
git push origin main
```
预期输出：代码推送到 GitHub 仓库。

---

### Task 6: 撰写第一篇博客文章

**Files:**
- 创建: `Camille-Blog/source/_posts/我的第一篇文章.md`

- [ ] **Step 1: 创建新文章**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo new post "我的第一篇文章"
```
预期输出：在 `source/_posts/我的第一篇文章.md` 生成模板文件。

- [ ] **Step 2: 编辑文章内容**

打开 `source/_posts/我的第一篇文章.md`，写入内容：

```markdown
---
title: 我的第一篇文章
date: 2026-05-08
tags: [随笔]
---

这是我的个人博客的第一篇文章。

用 Markdown 写文章，保持简单。

<!-- more -->

## 关于这个博客

这里会分享技术、生活、和各种杂七杂八的东西。

后续会慢慢补充更多内容。
```

> `<!-- more -->` 标签用于控制首页只显示摘要，之后的全文在文章页展示。

- [ ] **Step 3: 本地预览**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo clean && hexo generate && hexo server
```
预期输出：打开 http://localhost:4000 确认文章显示正常，排版和样式没问题。

按 `Ctrl+C` 停止。

- [ ] **Step 4: 部署到线上**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo deploy
```

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
git add source/_posts/
git commit -m "feat: first blog post"
```

---

### Task 7: 创建"关于"页面

**Files:**
- 创建: `Camille-Blog/source/about/index.md`

- [ ] **Step 1: 创建关于页面**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo new page about
```
预期输出：在 `source/about/index.md` 生成模板文件。

- [ ] **Step 2: 编辑内容**

编辑 `source/about/index.md`：

```markdown
---
title: 关于
date: 2026-05-08
---

## 关于我

一名大三学生，目前主要学习 Java 和 Python。

这个博客用来记录学习和生活中的点点滴滴。

## 联系方式

- GitHub: [github.com/camille](https://github.com/camille)
```

- [ ] **Step 3: 部署并提交**

```bash
cd /c/Users/Camille/Desktop/Camille-Blog
hexo clean && hexo generate && hexo deploy
git add source/about/
git commit -m "feat: add about page"
```

---

## 完成清单

- [ ] Hexo CLI 安装完成
- [ ] 项目初始化，`hexo server` 本地可预览
- [ ] NexT 主题安装并配置 `Gemini` 风格
- [ ] GitHub Pages 部署配置完成
- [ ] GitHub 仓库创建
- [ ] `hexo deploy` 成功，线上可访问
- [ ] 第一篇博客文章已发布
- [ ] 关于页面已创建

## 后续可自行探索的配置

- **绑定自定义域名** — 在 `source/CNAME` 文件中写入域名，同时在域名 DNS 设置 CNAME 到 `camille.github.io`
- **更换主题** — 修改 `_config.yml` 的 `theme:` 字段，或安装新主题
- **开启搜索** — 安装 `hexo-generator-search` 插件，在 `_config.next.yml` 中启用本地搜索
- **开启评论** — 安装评论插件（如 Gitalk），在 `_config.next.yml` 中配置
- **文章分类/标签** — 在 Markdown front-matter 中添加 `categories:` 和 `tags:`
