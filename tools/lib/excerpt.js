'use strict';

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

module.exports = { excerptOf, EXCERPT_LENGTH };
