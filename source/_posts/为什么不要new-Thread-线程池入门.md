---
title: 为什么不要 new Thread：线程池入门
date: 2025-05-10 21:00
categories: [技术笔记]
tags: [Java, 并发, 线程池]
description: new Thread 的三个问题，线程池七个参数与任务提交后的流转顺序
collection: java-concurrency
---

实习第一周，mentor 让我写个脚本处理一批数据。我想都没想，在循环里 `new Thread` 起了几百个线程，本地跑得好好的，提到测试环境一跑，整个服务直接卡死，日志里全是 OOM。

排查出来的原因不复杂：那个循环处理的是一批十万级的记录，我等于要起十万个线程。这个教训让我第一次认真去看线程池这个东西。

## new Thread 的三个问题

现在回头看，`new Thread(runnable).start()` 的问题主要是三个：

**创建和销毁的开销。** 创建一个平台线程，JVM 要向操作系统申请内核线程、分配栈空间、注册到调度器，这些都不是免费的。单次开销看着不大，但如果是每个任务都新建一个，在 QPS 高的场景下光花在建线程上的时间就很可观了。

**数量没有上限。** 代码里写 `new Thread()` 时，你并没有在控制并发数——你是在说"有多少任务就起多少线程"。任务量是业务给的，可能是 100，也可能是 100 万。每个线程默认要预留几百 KB 到 1MB 的栈空间（栈是按需提交的，但地址空间要先占住），线程一多，内存和调度压力一起上来，这就是我那次 OOM 的来路。

**无法复用，也无法管理。** 线程跑完就没了，下一个任务得重新建。更麻烦的是你没有任何抓手去统一设置超时、统一命名、统一监控、在服务关闭时统一收敛——这些在线上都是刚需。

线程池就是来解决这三件事的：把线程创建一次、反复使用，同时用一个固定的规模把并发数压住。

## ThreadPoolExecutor 的七个参数

JDK 提供的核心类是 `ThreadPoolExecutor`，构造函数有七个参数：

| 参数 | 含义 |
|---|---|
| `corePoolSize` | 核心线程数，默认情况下会一直存活（除非开了 `allowCoreThreadTimeOut`） |
| `maximumPoolSize` | 线程总数的上限 |
| `keepAliveTime` | 超过核心数的那些线程空闲多久后被回收 |
| `unit` | `keepAliveTime` 的时间单位 |
| `workQueue` | 存放待执行任务的阻塞队列 |
| `threadFactory` | 创建线程的工厂，用来定制线程名、优先级、是否守护线程 |
| `handler` | 队列满且线程数到上限时的拒绝策略 |

`corePoolSize` 和 `maximumPoolSize` 一起定义了池子的容量区间，`workQueue` 决定了任务在"线程不够"时去哪里排队。这四个是理解线程池行为的关键，剩下三个是工程细节——但 `threadFactory` 特别值得认真设置：给线程起个有意义的名字（比如 `order-batch-1`），线上出问题时 jstack 里一眼就能认出来是谁，这个习惯能省很多排查时间。

## 任务提交后去了哪里

很多人（包括当时的我）以为提交任务会先往队列里放。实际顺序是：

1. 线程数没到 `corePoolSize`，直接创建一个核心线程执行；
2. 核心线程都忙，任务进 `workQueue` 排队；
3. 队列满了，但线程数没到 `maximumPoolSize`，创建新的非核心线程；
4. 队列满、线程数也到顶，交给拒绝策略。

**注意第 3 步是排在"队列满了"之后的。** 也就是说，只要队列没满，线程数就停在 `corePoolSize` 不再增长。这一点和直觉相反，也是后面那个坑的根源。

大意了容易翻车的正是这个顺序。我照着这个顺序做了个实验：核心 2、最大 4、队列容量 2，然后连着提交 9 个任务，打出来的线程名和拒绝计数是这样的：

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
        2, 4, 60, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(2),
        r -> new Thread(r, "worker-" + ...),
        (r, ex) -> rejected.incrementAndGet());
```

```
task 1 on worker-1     task 2 on worker-2
task 3 on worker-1     task 4 on worker-2      // 队列里的 2 个，被闲下来的线程取走
task 5 on worker-3     task 6 on worker-4      // 队列满了，才新建线程
rejected count = 3                             // 7、8、9 被拒
```

前 2 个进核心线程，3 和 4 进队列，到第 5 个队列满，才扩到 `maximumPoolSize`，第 7 个开始被拒。（这个输出我是在 JDK 17 上跑的；任务执行顺序、哪个线程抢到哪个任务本来就有随机性，别把线程名对号入座，看的是"什么时候扩线程、什么时候拒绝"。）

## 为什么不该用 Executors 的快捷方法

`Executors` 提供了一堆工厂方法：`newFixedThreadPool`、`newSingleThreadExecutor`、`newCachedThreadPool`……看起来省事，但它们的参数是写死的，而这个写死经常正好踩在上一节那个顺序的痛点上。

用反射把它们的 `workQueue` 打出来看看（同样 JDK 17）：

```
newFixedThreadPool(3):        core=3 max=3 queue=LinkedBlockingQueue
newCachedThreadPool():        core=0 max=2147483647 queue=SynchronousQueue
```

`newFixedThreadPool` 的队列是 `LinkedBlockingQueue`，默认容量是 `Integer.MAX_VALUE`——几乎等于无界。这意味着队列永远填不满，线程数就永远涨不到 `maximumPoolSize`，实际上池子退化成了"固定几个线程 + 无限堆积"。任务消费不过来时，堆内存被队列里的任务对象一点点吃光，最后 OOM 的还是你。`newCachedThreadPool` 的问题在另一头：最大线程数是 `Integer.MAX_VALUE`，等于"没有上限"，任务来得快就疯狂建线程，退化成我实习时那版代码的翻版。

所以现在的共识是：**用 `ThreadPoolExecutor` 的构造函数显式指定每个参数**，队列用有界队列（`ArrayBlockingQueue` 或指定容量的 `LinkedBlockingQueue`），拒绝策略按业务语义选。写起来多几行，但池子的行为是你自己定的，出事时也说得清。

至于队列容量该设多大、拒绝策略该用哪个，那要看任务是 CPU 密集还是 IO 密集、能不能容忍排队、被拒之后是重试还是直接失败。这些没有标准答案，得结合具体业务算，这篇先不展开。

## 一句话收尾

`new Thread` 把"并发多少"这个决定交给了任务量，线程池把它收回到你手里。七个参数里最值得琢磨的是队列——它的容量和类型，决定了一个线程池到底是不是真的在限流。
