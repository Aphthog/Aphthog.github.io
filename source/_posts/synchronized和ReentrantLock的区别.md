---
title: synchronized 和 ReentrantLock 的区别
date: 2025-08-16 21:00
categories: [技术笔记]
tags: [Java, 并发, 锁]
description: 用法对比、锁升级，以及 ReentrantLock 多出的几项能力
collection: java-concurrency
---

有次处理线上问题，一个改库存的接口卡住了。堆栈打出来，几个线程停在同一个 `ReentrantLock` 上，另一个线程很久没动——它中间抛了异常，绕过了 `unlock`。那次之后我才真正记住：`synchronized` 的锁是 JVM 自动放的，`ReentrantLock` 的锁得自己放，而且必须放在 `finally` 里。

这篇把这两把锁的差别理一理。它们都能做到"同一时刻只有一个线程进临界区"，但用起来和能给的东西差不少。

## 用法：一个靠关键字，一个靠 API

`synchronized` 是语言层面的，能修饰方法，也能修饰代码块：

```java
// 修饰实例方法：锁的是 this
public synchronized void add() { count++; }

// 修饰静态方法：锁的是 Class 对象
public static synchronized void stat() { ... }

// 修饰代码块：锁的是括号里那个对象
synchronized (lock) {
    count++;
}
```

`ReentrantLock` 是 JDK 5 引入的一个类，加锁解锁都是显式方法：

```java
private final ReentrantLock lock = new ReentrantLock();

public void add() {
    lock.lock();
    try {
        count++;
    } finally {
        lock.unlock();     // 必须放在 finally
    }
}
```

两者都是**可重入**的：同一个线程重复进入自己已持有的锁，计数会累加，不会把自己锁死。这一点上它们没有差别。

## 对照表

| 维度 | synchronized | ReentrantLock |
|---|---|---|
| 加锁方式 | 关键字，JVM 管理 | `lock()` / `unlock()` 显式调用 |
| 释放锁 | 出临界区或抛异常时自动释放 | 必须手写 `unlock()`，通常配 `finally` |
| 能否中断等待 | 加锁等待不可中断（`Object.wait()` 可以） | 可以，`lockInterruptibly()` |
| 能否超时 | 不能 | 可以，`tryLock(timeout, unit)` |
| 公平锁 | 不支持 | 支持，构造时传 `true` |
| 条件等待 | 只有一个等待集（`wait` / `notify`） | 可以 `newCondition()` 分出多个 |
| 性能 | JDK 6 之后优化明显，无竞争时开销很低 | 相近；竞争激烈时可选公平策略 |

先说一件容易搞错的事：**`ReentrantLock` 不实现 `AutoCloseable`，不能写在 try-with-resources 里**（`try (lock)` 编译不过），必须老老实实 `try/finally`。我见过有人想当然这么写，编译器直接就给拒了。

## synchronized 的锁升级

`ReentrantLock` 的定位常被当成"synchronized 的加强版"，但要理解为什么日常大多数场景 `synchronized` 就够了，得知道 JVM 在它身上做了什么。

`synchronized` 在 JVM 里并不是一上来就找操作系统。它有个逐步升级的过程，通常叫**锁升级**：

- **偏向锁**：如果从头到尾只有一个线程来来回回进这个锁，JVM 干脆不真加锁，只是在对象头里记下这个线程。这段代码看起来比无锁代码多写了 `synchronized`，实际开销几乎为零。
- **轻量级锁**：有第二个线程来竞争时，偏向失效，升级为轻量级锁——用 CAS 尝试把锁的标记指向自己的栈帧，竞争不激烈时不阻塞线程，靠自旋等一会儿。
- **重量级锁**：自旋还拿不到（竞争时间长、线程多），才升级到重量级锁，此时线程会被挂起，交给操作系统调度。这一步开销最大，因为涉及用户态和内核态的切换。

升级是单向的，升上去不会退回来。这个机制解释了一个反直觉的现象：**`synchronized` 慢只慢在"真的有竞争"的时候**，没人竞争时它非常便宜。

要提醒的是，偏向锁是 HotSpot 的具体实现，不是 Java 语言规范的一部分：它在 JDK 15 起默认被禁用（更早的版本默认开启），之后被从 HotSpot 里移除。所以"锁升级三阶段"更适合当作理解"无竞争时为什么便宜"的模型，不必当成每个 JVM 上都成立的定律。

## ReentrantLock 多出来的能力

那什么时候值得用 `ReentrantLock`？它比 `synchronized` 多出的，主要是四项控制能力：

**可中断。** 用 `lockInterruptibly()` 等锁时，线程可以被 `interrupt()` 打断，不至于死等。

**可超时。** `tryLock(300, TimeUnit.MILLISECONDS)` 试一下，拿不到就返回 `false`，可以走降级逻辑。我把一个线程先拿到锁、sleep 2 秒，主线程再试着拿，输出是：

```
tryLock(300ms) = false          // 300ms 内没拿到，主动放弃
after release, tryLock = true   // 原持有者释放后，再试就拿到了
```

这种"拿不到就放弃"的语义，`synchronized` 是没有的。

**公平锁。** 构造函数传 `true`，等待最久的线程优先拿锁。代价是吞吐会降，因为要维护等待队列的顺序，所以默认是 `false`（非公平）。只有确实需要防止某些线程被反复插队饿死时才开。

**多个 Condition。** `synchronized` 只有一个等待集，`notify()` 唤醒的是谁不确定，只能靠 `while` 循环重新判断条件。`ReentrantLock` 可以 `newCondition()` 分出多个等待队列，把生产者和消费者分开关——比如队列满时唤醒消费者、队列空时唤醒生产者，各睡各的，不用全体"惊群"。

## 怎么选

我现在的默认选择是 `synchronized`：写起来短，不会忘了解锁，而且大多数临界区本来就只是几个自增或几行赋值，没有"中断""超时"这些需求，升级机制也把无竞争时的开销压得很低。

真正值得换成 `ReentrantLock` 的场景，是有明确理由用到上面那四项之一的：需要超时避免请求被拖住、需要在关服时中断等锁的线程、需要公平性、或者需要多个条件队列做精确唤醒。如果只是"听说 ReentrantLock 更灵活"就换过去，得到的是一个必须在 `finally` 里手动释放的锁，出错概率反而更高。

另外，如果只是想控制"同时最多几个线程访问"这种并发量，`Semaphore` 比这两把锁都合适——锁管的是互斥，信号量管的是配额，这两件事容易混。这个下次单独说。
