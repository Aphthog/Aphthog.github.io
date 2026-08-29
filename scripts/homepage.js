'use strict';

/**
 * 首页自动生成器
 * 从文章数据自动渲染首页（source/index.html 的替代方案），
 * 文章列表按分类分组：技术笔记 / 摄影 / 随笔，按日期倒序。
 * 摘要：front-matter 的 description 优先，没有则截取正文前 80 字。
 */

const path = require('path');
const fs = require('fs');

const TABS = [
  { category: '技术笔记', id: 'tech' },
  { category: '摄影', id: 'photo' },
  { category: '随笔', id: 'essay' },
];

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

hexo.extend.generator.register('homepage', function (locals) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'homepage.ejs'), 'utf8');

  const grouped = {};
  TABS.forEach(t => { grouped[t.id] = []; });
  const tabByCategory = {};
  TABS.forEach(t => { tabByCategory[t.category] = t.id; });

  locals.posts.sort('date', -1).toArray().forEach(post => {
    const cats = post.categories.toArray();
    const tabId = (cats.length && tabByCategory[cats[0].name]) || 'essay';
    grouped[tabId].push({
      title: post.title,
      date: post.date.clone().locale('en').format('MMM DD'),
      url: '/' + post.path,
      excerpt: excerptOf(post),
    });
  });

  const html = hexo.render.renderSync({ text: template, engine: 'ejs' }, { tabs: grouped });
  return { path: 'index.html', data: html };
});
