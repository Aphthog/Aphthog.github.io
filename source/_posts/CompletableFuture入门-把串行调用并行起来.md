---
title: CompletableFuture 入门：把串行调用并行起来
date: 2025-10-18 21:00
categories: [技术笔记]
tags: [Java, 并发, CompletableFuture]
description: 从串行调接口的耗时切入，讲任务创建、组合、异常处理与线程池选择
collection: java-concurrency
---

订单详情页要展示五块数据，分别来自库存、价格、优惠券、物流、推荐五个下游接口。我写的第一个版本是老老实实一串 `get` 调下来，本地自测还行，压测时 P99 直接爆表——页面等五个接口一个接一个，等于把延迟全加在了一起。

改成并行之后，接口耗时大约降了一半。这篇记录一下 `CompletableFuture` 的用法，都是当时踩过的点。

## 串行调用的问题

先看问题本身有多直观。假设三个互不依赖的接口，分别耗时 200ms、150ms、100ms：

```java
long t0 = System.currentTimeMillis();
String a = call("stock", 200);
String b = call("price", 150);
String c = call("coupon", 100);
long t1 = System.currentTimeMillis();
System.out.printf("serial: %d ms%n", t1 - t0);
```

我本机跑出来是 `serial: 456 ms`——接近三个数之和。它们之间没有任何依赖，本可以同时进行，却因为代码是顺序写的被硬生生串起来。这就是问题所在：**代码的书写顺序，决定了调用的时序**，而这五个接口本来没有先后关系。

## 用 supplyAsync 并行起来

`CompletableFuture` 把"提交任务"和"拿结果"拆开了。提交时返回一个凭证（`CompletableFuture` 对象），需要结果时再 `get`：

```java
ExecutorService pool = Executors.newFixedThreadPool(5);   // 下面再解释为什么必须自己给

long t2 = System.currentTimeMillis();
CompletableFuture<String> fa = CompletableFuture.supplyAsync(() -> call("stock", 200), pool);
CompletableFuture<String> fb = CompletableFuture.supplyAsync(() -> call("price", 150), pool);
CompletableFuture<String> fc = CompletableFuture.supplyAsync(() -> call("coupon", 100), pool);

String r = fa.thenCombine(fb, (x, y) -> x + "+" + y)
             .thenCombine(fc, (xy, z) -> xy + "+" + z)
             .get();
long t3 = System.currentTimeMillis();
System.out.printf("parallel: %d ms -> %s%n", t3 - t2, r);
```

实测输出：

```
serial:   456 ms
parallel: 213 ms -> stock-ok+price-ok+coupon-ok
```

213ms 接近三个里最慢的那个（200ms）再加上调度开销，而不是三者之和。这是本机单次运行的数字，不是基准测试——并行收益随下游延迟和机器波动，看数量级就行。

注意这里有个不显眼的细节：**池子不能小于"同一时刻要跑的任务数"。** 三个任务用 3 线程当然也够；我这里写 5，是因为真实场景里订单详情页要调的是 5 个下游。如果池子比并发任务数还小，`supplyAsync` 提交的任务一样会排队，那就白并行了——所以指定池子的时候，容量要按"能同时进行的任务数"来估。

## 组合：thenCombine、thenApply、allOf

上面的例子用了 `thenCombine`，把两个 future 的结果合并成一个。常用的还有几个：

| 方法 | 作用 |
|---|---|
| `thenApply` | 对结果做转换，返回新的值（同步式的 `map`） |
| `thenCompose` | 拿上一个结果去发起下一个异步任务（避免嵌套 `CompletableFuture`） |
| `thenCombine` | 等两个都完成，把两个结果合并 |
| `thenAccept` | 只要结果，不要返回值 |
| `allOf` | 等一批任务全部完成（本身返回 `CompletableFuture<Void>`） |
| `anyOf` | 等其中任意一个完成 |

五个下游接口这种场景，`allOf` 最顺手：

```java
CompletableFuture<Void> all = CompletableFuture.allOf(fa, fb, fc);
all.join();          // 等全部完成；join 不抛受检异常
// 再各自 .join() 或 .get() 取结果
```

`allOf` 的好处是它把这一组任务变成一个 future，一个 `join` 就能等齐。缺点是它返回的 `Void` 不带结果，取每个结果还是得回到各自的 future 上。

## 异常处理

异步链条里抛异常有个陷阱：**如果不处理，异常不会在提交的那行代码处冒出来**，它被包在 future 里，直到你 `get` 的时候才以 `ExecutionException` 的形式抛出——有时候甚至永远不会被 `get` 到，异常就静默消失了。所以异常处理是必须显式写的。

两种常用写法：

```java
// 1. exceptionally：兜底，把异常转成一个默认结果
CompletableFuture<String> f = CompletableFuture.<String>supplyAsync(
        () -> { throw new RuntimeException("downstream 500"); }, pool)
    .exceptionally(ex -> "fallback: " + ex.getCause().getMessage());

// 2. handle：无论成功失败都进，能同时拿到结果和异常
CompletableFuture<String> g = CompletableFuture.supplyAsync(() -> "ok", pool)
    .handle((res, ex) -> ex != null ? "fallback" : res);
```

前者的实测输出是 `exceptionally: fallback: downstream 500`。五块数据聚合时，更实用的做法是给每个下游单独挂 `exceptionally`，某一块挂了就降级成默认值，而不是让整页 500——**并行调用放大了"单点失败拖垮整体"的风险**，这一点比串行时要更小心。

## 必须显式指定线程池

这是最容易被忽略、也最容易被 review 拦下来的一处。

`supplyAsync` 不传 `Executor` 时，用的是 `ForkJoinPool.commonPool()`。这个池子是 JVM 全局共享的，**并行度默认是 CPU 核数减一**（我本机 20 核，实测 `commonPool` 并行度是 19）。两个问题：

1. 你的下游接口调用是 IO 密集的，线程大部分时间在等网络返回。用"CPU 核数"这种为计算任务设计的池子去跑 IO，池子很快被占满，而且抢的是**全应用共用**的那个池——你这边堵住，会影响其他所有也在用默认池的代码。
2. 排查问题时，线程名是 `ForkJoinPool.commonPool-worker-*`，根本认不出是哪个业务发起的。用自己命名的线程池，jstack 一看就知道。

所以：**`supplyAsync` / `runAsync` 一律显式传线程池**。池子大小按下游的并发能力估，IO 密集可以适当放大，但同时要留给下游一点活路——五个接口并行打过去，跟你自己串行调五次，对下游的压力完全不是一个量级，别把人家打挂了。

## 收个尾

`CompletableFuture` 真正改变的是写代码的思维方式：把"这一段要等结果"变成"先记下凭证，该汇合的时候再汇合"。从串行改并行之后，耗时从 456ms 降到 213ms，代码也确实复杂了一点——多了线程池要管、多了异常要兜。

所以我的判断标准是：**只有当调用之间确实没有依赖、并且延迟占比明显时，才值得并行**。如果接口本身只有几毫秒，或者调用之间必须按顺序，那串行的代码更好读也更好排查——并行是把顺序的确定性换成了时间，这笔账要算清楚再换。
