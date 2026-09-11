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
