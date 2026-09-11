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
