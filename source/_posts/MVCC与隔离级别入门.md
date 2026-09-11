---
title: MVCC 与隔离级别入门
date: 2026-04-25 21:00
categories: [技术笔记]
tags: [MySQL, 事务, MVCC]
description: 四种隔离级别与各自问题，MVCC三件套，RR下如何避免幻读，快照读vs当前读
collection: mysql
---

之前面试被问过一个问题："MySQL 默认隔离级别是什么？它怎么避免幻读的？"我答了 REPEATABLE READ、答了间隙锁，但面试官追问 MVCC 做了什么，我却没完全说清楚。回去翻了翻 MySQL 官方的文档和不少文章，才把 MVCC 和隔离级别的关系理清楚。

## 四种隔离级别

SQL 标准定义了四种隔离级别，每种对应不同的并发问题：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---------|------|-----------|------|
| READ UNCOMMITTED | 可能 | 可能 | 可能 |
| READ COMMITTED | 安全 | 可能 | 可能 |
| REPEATABLE READ | 安全 | 安全 | 可能（InnoDB 通过间隙锁解决） |
| SERIALIZABLE | 安全 | 安全 | 安全 |

- **脏读**：读到另一个事务未提交的数据。如果那个事务回滚了，读到的是不存在的。
- **不可重复读**：同一个事务里两次读同一行，结果不一样——被另一个已提交事务改了。
- **幻读**：同一个事务里两次范围查询，第二次多出了几行——被另一个事务插入的新行。

InnoDB 的默认隔离级别是 **REPEATABLE READ（RR）**。它用 MVCC 解决了不可重复读；用间隙锁解决了幻读（严格来说是大部分情况——后面解释）。

## MVCC 三件套

MVCC（Multi-Version Concurrency Control）让读操作不用加锁、不阻塞写操作。它的核心有三样东西。

**1. 隐藏字段**

InnoDB 聚簇索引的每行数据有三个隐藏列：
- `DB_TRX_ID`：最近一次修改这行的事务 ID
- `DB_ROLL_PTR`：指向 undo log 中该行上一个版本的指针（回滚指针）
- `DB_ROW_ID`：隐藏自增 ID（没有主键时才用到）

**2. undo log 版本链**

每次 `UPDATE`，InnoDB 不会直接覆盖旧数据，而是把旧版本写入 undo log，然后通过 `DB_ROLL_PTR` 把新版本和旧版本串成一条链表。新版本在最前面，旧版本在后面。

**3. ReadView**

事务执行快照读（`SELECT`）时，InnoDB 会生成一个 ReadView，记录当前活跃事务的 ID 列表。ReadView 的核心逻辑是：

- 如果数据行的 `DB_TRX_ID` 小于 ReadView 中最早活跃的 ID，说明这个版本在事务开始前已提交，可见。
- 如果 `DB_TRX_ID` 等于当前事务 ID，自己改的当然可见。
- 如果 `DB_TRX_ID` 大于 ReadView 中最晚的 ID，说明是在当前事务开始后才启动的事务，不可见。
- 如果 `DB_TRX_ID` 在最小和最大之间且在活跃列表里，说明还没提交，不可见；不在活跃列表里则可见。

不可见时，顺着 `DB_ROLL_PTR` 沿着 undo log 版本链往前找，直到找到一个可见的版本。

## RR 和 RC 的区别

RC（READ COMMITTED）和 RR 在 ReadView 上的行为不同：

- **RC**：每条 `SELECT` 语句都生成一个新的 ReadView。这意味着同一个事务里，两次 `SELECT` 可能看到不同的结果——解决了脏读，但不可重复读依然存在。
- **RR**：整个事务只生成一次 ReadView（在第一条 `SELECT` 时）。后续的所有 `SELECT` 都用同一个 ReadView，所以读到的一直是事务开始时的快照，不可重复读被解决了。

那幻读呢？MVCC 在 RR 下能防止大部分幻读：因为 ReadView 固定了，新插入的行对当前事务不可见。但有一个例外——**当前读**（`SELECT ... FOR UPDATE`、`UPDATE`、`DELETE`）会走最新数据，不受 ReadView 控制。纯靠 MVCC 解决不了这类幻读，所以 InnoDB 在 RR 下还用了间隙锁来阻挡新插入的数据。

## 一句话区分快照读和当前读

- **快照读**：普通的 `SELECT`，不加锁，从 ReadView 可见的版本读——MVCC 保证读到的是一致性的历史快照，不阻塞其他事务的写。
- **当前读**：`SELECT ... FOR UPDATE`、`SELECT ... LOCK IN SHARE MODE`、`UPDATE`、`DELETE`——读取最新已提交的数据，并加锁防止其他事务并发修改。

## 总结

MVCC 是 InnoDB 高并发读能力的核心。它通过隐藏字段 + undo log 版本链 + ReadView 这套机制，让读不阻塞写、写不阻塞读，同时保证每个事务看到一致的数据视图。理解 ReadView 的生成时机，就理解了 RR 和 RC 最本质的区别。面试被问到隔离级别，从 MVCC 的角度答往往比背定义更能让对方觉得你真的懂了。