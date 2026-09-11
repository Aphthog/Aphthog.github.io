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
