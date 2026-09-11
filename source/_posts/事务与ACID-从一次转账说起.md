---
title: 事务与 ACID：从一次转账说起
date: 2026-04-11 21:00
categories: [技术笔记]
tags: [MySQL, 事务]
description: ACID：undo log/redo log/锁+MVCC保证什么，长事务危害
collection: mysql
---

好友借钱，我在手机银行上点转账。扣款成功、余额减少了，但对方说没收到。这种场景在程序里对应的是：扣款 `UPDATE` 执行成功，入账的 `UPDATE` 没执行——数据不一致了。事务就是用来解决这个问题的。

最简单的写法：

```sql
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE user_id = 1;
UPDATE accounts SET balance = balance + 100 WHERE user_id = 2;
COMMIT;
```

两个 `UPDATE` 被包在同一个事务里，要么都成功（COMMIT），要么都失败（ROLLBACK）。这就是 ACID 的基本形态。

## ACID 各自靠什么

A（原子性）、C（一致性）、I（隔离性）、D（持久性）不是平行机制——C 是目的，A、I、D 是手段。

**原子性 —— undo log。** 如果第二个 `UPDATE` 执行失败，MySQL 需要把第一个 `UPDATE` 的效果撤回来。undo log 记录的是"修改之前的值"：对每一行修改，undo log 里存着该行修改前的旧版本。ROLLBACK 时，InnoDB 用 undo log 把数据恢复到事务开始前的状态。这就是原子性——要么不做，要么做完，不会停在中间。

**持久性 —— redo log。** `COMMIT` 之后，数据真的写死了吗？不一定。InnoDB 有 buffer pool，数据修改先在内存里进行，然后不定期刷盘。如果刚 `COMMIT` 还没刷盘就宕机了，数据就丢了。redo log 解决这个问题：事务提交时，先把修改记录写到 redo log（顺序写，很快），再慢慢刷数据页。宕机重启后，InnoDB 重放 redo log，保证已提交事务的修改不丢失。这就是 WAL（Write-Ahead Logging）策略——先写日志、再写数据。

**隔离性 —— 锁 + MVCC。** 两个事务同时转账到同一个账户，不加控制的话余额会出错。InnoDB 用行锁防止并发写冲突，用 MVCC（多版本并发控制）让读操作不阻塞写操作。这部分细节比较多，下一篇单独展开。

**一致性是目的，不是具体机制。** 一致性是说数据在任何时刻都符合业务规则——比如转账前后总余额不变。原子性保证不中途中断，持久性保证不丢，隔离性保证并发不搞乱。三者配合，最终达成数据一致性。靠的是应用层写对逻辑，不是数据库单方面能保证的。

## 开启事务的正确写法

显式事务：

```sql
START TRANSACTION;
-- 业务逻辑
COMMIT;     -- 或者 ROLLBACK;
```

常见坑：在 `START TRANSACTION` 之后执行了 DDL（CREATE TABLE、ALTER TABLE 等），MySQL 会**隐式提交**当前事务。`INSERT`、`UPDATE`、`DELETE` 每条语句其实也是隐式事务——如果你没有手动 `START TRANSACTION`，每条语句自带一个事务。

## 长事务的危害

刚接手项目的时候，数据库监控面板上显示一个活跃事务持续了十多分钟。查下来是代码里开了事务之后做了一个外部 HTTP 调用。长事务的危害有几层：

- **锁不释放**：改过的行一直持有行锁，其他事务要改同一行就得等，直接拖慢整个系统。锁等待超时还会抛 `Lock wait timeout exceeded`。
- **undo log 膨胀**：事务不结束，undo log 就不能清理。长时间不提交的事务会让 undo log 越积越多，甚至撑爆 undo 表空间。
- **MVCC 版本链拉长**：后面的事务读数据时要沿着 undo log 版本链往前找，性能受影响。

所以事务的原则是：**短、快、不要再事务里做外部调用**。读多写少或者纯查询不需要开事务，默认的自动提交就够了。

## 总结

ACID 四个特性不是理论概念——`START TRANSACTION` 之后的每一行代码都在和 undo log、redo log、锁打交道。写 SQL 事务的时候多想想：如果这一步挂了怎么办？如果两个事务同时改同一行怎么办？理解了背后的机制，写出来的事务代码会更稳当。