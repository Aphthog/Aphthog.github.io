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
