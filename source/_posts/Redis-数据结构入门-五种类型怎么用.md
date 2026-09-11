---
title: Redis 数据结构入门：五种类型怎么用
date: 2026-06-27 21:00
categories: [技术笔记]
tags: [Redis, 数据结构]
description: String/Hash/List/Set/ZSet的典型用途与选型建议
collection: redis
---

面试被问过一个问题：Redis 五种数据类型，你怎么选？

第一次用 Redis 的时候，我只知道 `SET` 和 `GET`，所有数据不管长什么样都序列化成 String 往里面塞。后来项目大了，出过几件事——一个用户信息缓存用 String 存 JSON，要改一个字段就得全量读写；一个排行榜需求让同事用 List 排序，性能惨不忍睹。这些坑告诉我，选对类型比用对命令重要得多。

## String —— 最通用但别乱用

String 是 Redis 最基础的类型，value 最大 512MB。典型场景：

- **缓存 HTML 片段**或序列化后的对象
- **计数器**：`INCR` 做文章阅读数、点赞数，一条命令搞定且是原子的
- **分布式 session**：`SET session:token user_id NX PX 3600`

底层的 SDS（Simple Dynamic String）存了一个长度字段，取长度是 O(1) 的。但把对象整个序列化存成 String，读出来反序列化、改一个字段再整个写回去，代价大而且容易出并发覆盖。

## Hash —— 存对象的更好选择

一个 Hash 相当于一个 field-value 的小字典：

```
HSET user:1001 name "张三" age 25 city "重庆"
HGET user:1001 name
HINCRBY user:1001 age 1
```

存用户信息、商品详情这种多个字段的对象，用 Hash 比用 String 存 JSON 灵活得多：只改一个字段只传输一个 field，不用全量读写。原子性也更好——`HINCRBY` 对计数器字段能直接操作。

**选型建议**：字段少且固定（比如配置项、地址簿），Hash 更合适。字段很多但每次都要读全量（比如文章正文），String 序列化反而省事，因为 Hash 的底层是哈希表，field 多了有内存开销。

## List —— 队列和栈

List 底层是双向链表或压缩列表（数据量小的时候），支持两端操作：

```
LPUSH queue task:1
RPOP queue
LLEN queue
```

可以用来实现简单的消息队列（LPUSH + BRPOP 做阻塞消费），或者时间线展示——比如用户的最近动态用 `LPUSH` 加到列表头，`LTRIM` 只保留最新的 100 条。

## Set —— 去重和集合运算

Set 存的是不重复的字符串，底层是哈希表：

```
SADD tags:post:1 "Java" "Redis" "缓存"
SMEMBERS tags:post:1
SISMEMBER tags:post:1 "Redis"  // O(1) 判断
```

集合运算对业务逻辑很有用——`SINTER` 取交集可以算"同时关注两个博主的用户"，`SUNION` 做并集可以合并两份黑名单。

## ZSet —— 有排序的集合

ZSet 每个元素带一个 score，按 score 排序。底层用跳表（多层索引，近似二分查找）和哈希表组合实现，兼顾排序和单点查询。

```redis
ZADD leaderboard 100 "user1"
ZADD leaderboard 200 "user2"
ZADD leaderboard 150 "user3"
ZREVRANGE leaderboard 0 2 WITHSCORES  // 取前三名
ZINCRBY leaderboard 10 "user2"        // 加分
```

排行榜是 ZSet 的杀手级场景：游戏积分榜、文章热度榜。`ZREVRANGE` 取 Top N，`ZRANK` 查自己的排名，全都能在 O(logN) 完成。用别的类型做这个功能基本都要配合外部排序，麻烦很多。

## 底层结构一句话

每种类型背后有对应的编码方式，不同数据量下自动切换：

| 类型 | 底层结构 | 一句话 |
|------|---------|--------|
| String | SDS | 存长度字段，取长度 O(1)，append 不每次都 realloc |
| Hash | 压缩列表 / 哈希表 | 小数据用连续内存块，大了转哈希表 |
| List | 压缩列表 / 双向链表 | 小数据压缩存储，大了转为链表 |
| Set | 整数集合 / 哈希表 | 全是整数时用紧凑的整数集合 |
| ZSet | 压缩列表 / 跳表 | 跳表多层索引，近似二分查找 |

> 底层结构可以在配置项里看到：`redis-cli OBJECT ENCODING <key>`。

## 总结

选 Redis 类型其实就是想清楚你的**数据结构**和**访问模式**。计数器用 String，对象用 Hash，队列用 List，标签去重用 Set，排行榜用 ZSet。面试答"我会先看数据的访问特征再选"比背八股管用得多。实际项目里，选错了类型最直接的后果就是内存多几百 MB，改起来倒也不难——但一开始选对，省掉后续优化成本。