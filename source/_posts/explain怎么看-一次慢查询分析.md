---
title: explain 怎么看：一次慢查询分析
date: 2026-03-28 21:00
categories: [技术笔记]
tags: [MySQL, explain, 索引]
description: explain各列、type排名、filesort含义，一条真实慢SQL走一遍
collection: mysql
---

去年年中，线上一个订单查询接口响应偶尔飙到五秒以上。慢查询日志里抓到一条 SQL，一眼看去就是 `filesort` 和全表扫描。MySQL 的 `EXPLAIN` 命令就是干这个的——它告诉你一条 SQL 的执行计划，哪个索引都没走、哪里做了文件排序、预估扫描多少行，全写在输出里。

## 各列含义

直接在 SQL 前面加 `EXPLAIN` 就行了。输出结果十几列，日常最关注的是这四个：

| 列名 | 含义 |
|------|------|
| `type` | 访问方式，效率从高到低排 |
| `possible_keys` | 理论上可能用到的索引 |
| `key` | 实际用到的索引 |
| `key_len` | 用到的索引长度（字节），可以判断联合索引用了几列 |
| `rows` | MySQL 预估扫描的行数 |
| `Extra` | 附加信息，通常藏着性能杀手 |

需要特别说说 `key_len`。如果联合索引 `(a, b)` 且 a 和 b 都是 int（4 字节，NOT NULL），`WHERE a = 1 AND b = 2` 的 key_len = 8，说明两列都用了；`WHERE a = 1` 的 key_len = 4，说明只用了一列。这是判断联合索引"到底用了几列"最直观的方法。

## type 排名

`type` 是执行计划里最重要的字段，从好到坏的常见取值：

- **system**：表只有一行（系统表），最快，实际业务里几乎见不到。
- **const**：主键或唯一索引等值查询，最多匹配一行。比如 `WHERE id = 1`。
- **eq_ref**：关联查询中，被驱动表用主键或唯一索引等值匹配。`JOIN ... ON t1.id = t2.user_id` 常见。
- **ref**：普通索引等值查询，匹配多行。`WHERE status = 1` 如果 `status` 有索引，就是 ref。
- **range**：索引上的范围查询。`WHERE id > 100`、`BETWEEN`、`IN` 等等。
- **index**：扫描了整棵索引树，但没扫表。比 ALL 好一点，但还是要遍历大部分数据。
- **ALL**：全表扫描。大表上出现 ALL 基本意味着这条 SQL 该优化了。

## Extra 里两个重要信号

**`Using filesort`**：MySQL 需要对结果做额外的排序。如果排序字段没走索引，就会在内存或磁盘上做文件排序。数据量一大，filesort 就是性能杀手——排序 10 万行和扫 10 万行不是一回事。

**`Using temporary`**：需要临时表来辅助查询，常见于 `GROUP BY` 和 `DISTINCT` 没有走索引时。临时表可能要写到磁盘，比 filesort 更重。

这两条出现在 Extra 里，就说明 SQL 或者索引设计有问题。

## 拿一条真实慢 SQL 走一遍

当时线上抓到的是这条：

```sql
SELECT order_id, status, total_amount, create_time
FROM orders
WHERE status = 0
ORDER BY create_time DESC
LIMIT 100;
```

EXPLAIN 输出：

| id | select_type | table | type | key | rows | Extra |
|----|-------------|-------|------|-----|------|-------|
| 1 | SIMPLE | orders | ALL | NULL | 50万 | Using where; Using filesort |

一眼看出两个问题：

1. **type = ALL：** 全表扫描，扫描 50 万行。因为 `status` 没有索引。
2. **Extra 里有 `Using filesort`：** `ORDER BY create_time` 也没走索引。

优化方案很简单：建一个 `(status, create_time)` 的联合索引。`status` 筛选出目标行，`create_time` 的排序直接在索引上完成，不用额外排序。加完索引再 EXPLAIN：

| id | select_type | table | type | key | rows | Extra |
|----|-------------|-------|------|-----|------|-------|
| 1 | SIMPLE | orders | ref | idx_status_create_time | 800 | Using where; Using index condition |

type 从 ALL 变成 ref，rows 从 50 万降到 800，Extra 里的 filesort 消失了。这条查询从一秒多降到了十几毫秒。

建索引之前还有个小细节：`SELECT` 子句里选的字段能否被索引覆盖。如果索引包含所有需要的字段（覆盖索引），Extra 里会出现 `Using index`，这时候连回表都省了，进一步加速。本例中如果 `LIMIT` 很大，可以改写成 `SELECT id` 做延迟关联——那是深分页优化的话题了，这里先留个印象。

## 用 explain 的时机

不一定要等慢查询出现才用 EXPLAIN。写复杂 SQL 的时候，先跑一遍 EXPLAIN 确认 type 不是 ALL、Extra 没有 filesort 或 temporary。养成这个习惯之后，慢查询的数量会肉眼可见地减少。EXPLAIN 的输出毕竟是预估，但它已经能覆盖 80% 的性能问题判断了。