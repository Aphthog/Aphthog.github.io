'use strict';

const { toPostView } = require('./posts');

/**
 * 读 source/_data/collections.yml，把文章按 front-matter 的 collection 字段归入各合集。
 * 返回按组排好序的结构，空组合被过滤掉：
 *   [{ id, name, collections: [{ id, name, description, count, posts }] }]
 *
 * logger 用于报告未知的 collection id；Hexo 的 `hexo` 只是 scripts/*.js 的
 * 模块参数而非全局变量，所以这里由调用方注入（生成器传 hexo.log）。
 */
function buildCollectionGroups(locals, logger = console) {
  const data = (locals.data && locals.data.collections) || {};
  // 缺 id 的 YAML 条目直接跳过，否则会生成 collections/undefined/ 页面
  const defs = (data.collections || []).filter(d => d && d.id);
  const groupDefs = data.groups || [];

  const byCollection = {};
  defs.forEach(d => { byCollection[d.id] = []; });

  // 未知 id 不静默丢弃：逐个 id 警告一次（不是抛错，构建要继续）
  const unknown = {};

  locals.posts.sort('date', -1).toArray().forEach(post => {
    const id = post.collection;
    if (!id) return;
    if (byCollection[id]) {
      byCollection[id].push(toPostView(post));
    } else {
      unknown[id] = (unknown[id] || 0) + 1;
    }
  });

  Object.keys(unknown).forEach(id => {
    logger.warn(
      `合集页：文章引用了未知的 collection "${id}"（${unknown[id]} 篇），` +
      '这些文章不会出现在任何合集页；请检查 source/_data/collections.yml'
    );
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
