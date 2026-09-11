'use strict';

/**
 * 内容一致性检查。
 *
 *   node tools/verify-content.js           只校验 collection 字段合法 + 打印篇数
 *   node tools/verify-content.js mysql     严格校验 mysql 的篇数是否符合预期
 *   node tools/verify-content.js --all     严格校验全部合集
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const fm = require('hexo-front-matter');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'source', '_posts');
const COLLECTIONS_YML = path.join(ROOT, 'source', '_data', 'collections.yml');

// 各合集的目标篇数，与 spec 第二节的表格一致
const EXPECTED = {
  'java-basics': 5,
  'java-concurrency': 6,
  jvm: 4,
  mysql: 7,
  redis: 6,
  'llm-agent': 8,
  'rag-service': 4,
  'qq-bot': 3,
  'group-buy': 4,
  essay: 2,
  photo: 1
};

function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const only = args.filter(a => !a.startsWith('--'));

  const def = yaml.load(fs.readFileSync(COLLECTIONS_YML, 'utf8'));
  const known = new Set((def.collections || []).map(c => c.id));
  const errors = [];
  const counts = {};

  // 未知的 CLI 合集 id：不静默忽略，否则 `mysq`（mysql 的手误）会被放行
  const expectedIds = Object.keys(EXPECTED);
  const expectedSet = new Set(expectedIds);
  only.filter(id => !expectedSet.has(id)).forEach(id => {
    errors.push(`未知的合集 id "${id}"`);
  });

  // EXPECTED 与 collections.yml 的 id 集合必须一致，
  // 否则新增的合集会被合法性检查放行却永远不参与计数校验
  const onlyInYml = [...known].filter(id => !expectedSet.has(id));
  const onlyInExpected = expectedIds.filter(id => !known.has(id));
  if (onlyInYml.length || onlyInExpected.length) {
    errors.push(
      'EXPECTED 与 collections.yml 的合集 id 不一致：' +
      `collections.yml 独有 [${onlyInYml.join(', ')}]，` +
      `EXPECTED 独有 [${onlyInExpected.join(', ')}]`
    );
  }

  fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md'))
    .forEach(f => {
      const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
      const data = fm.parse(raw);
      const id = data.collection;
      if (!id) return;
      if (!known.has(id)) {
        errors.push(`${f}: 未知的 collection "${id}"`);
        return;
      }
      counts[id] = (counts[id] || 0) + 1;
    });

  Object.keys(EXPECTED).forEach(id => {
    const actual = counts[id] || 0;
    const strict = all || only.includes(id);
    const ok = actual === EXPECTED[id];
    const mark = strict ? (ok ? '✓' : '✗') : '·';
    console.log(`  ${mark} ${id.padEnd(18)} ${actual} / ${EXPECTED[id]}`);
    if (strict && !ok) errors.push(`${id}: 期望 ${EXPECTED[id]} 篇，实际 ${actual} 篇`);
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n合计 ${total} 篇带 collection 字段的文章`);

  if (errors.length) {
    console.error('\n失败：');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  console.log('\n通过');
}

main();
