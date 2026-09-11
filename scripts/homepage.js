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
