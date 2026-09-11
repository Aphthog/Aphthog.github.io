'use strict';

/**
 * 首页生成器：简洁落地页，带打字机入场动画。
 */

const path = require('path');
const fs = require('fs');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'homepage.ejs');

hexo.extend.generator.register('homepage', function (locals) {
  const html = hexo.render.renderSync(
    { text: fs.readFileSync(TEMPLATE, 'utf8'), engine: 'ejs', path: TEMPLATE },
    {}
  );
  return { path: 'index.html', data: html };
});
