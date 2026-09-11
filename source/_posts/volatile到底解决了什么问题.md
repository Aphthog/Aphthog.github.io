---
title: volatile 到底解决了什么问题
date: 2025-07-12 21:00
categories: [技术笔记]
tags: [Java, 并发, volatile]
description: volatile 的可见性与有序性保证、内存屏障直觉，以及它为什么替代不了锁
collection: java-concurrency
---

前阵子 review 代码，看到一个线程里用 `volatile` 修饰的循环开关，同事顺手把 `volatile` 删了，说"这个变量就一个线程写，加了浪费"。我当时说不上来为什么不能删，只记得书上看过。

后来回去补了下课，又写了个小实验才明白：那行 `volatile` 管的不是"谁写"，是"写了之后别人看不见怎么办"。这篇把当时想清楚的东西整理一下。

## 可见性：修改变量之后，别人什么时候能看到

上一篇里可见性只是一笔带过，这里单独展开——因为 `volatile` 最主要的作用就是解决它。

事情的本质是这样：JMM 里每个线程有自己的工作内存，读变量不一定去主内存。一个线程在循环里判断 `while (running) { ... }` 时，JIT 很可能把 `running` 的值缓存进寄存器——因为循环体里没有写操作，编译器认为读到的值不会变，就把读操作提到循环外面了。主线程那边把 `running` 改成 `false`，改的是主内存；工作线程还在读自己寄存器里的旧值，于是死循环。

加 `volatile` 之后，读操作被强制从主内存重新读，写操作也会立即刷回主内存，工作线程就能在下一轮循环看到变化。我照着写了个对照实验（JDK 17）：

```java
static volatile boolean running = true;
// 工作线程：while (running) { n++; }
// 主线程：睡 500ms，然后 running = false;
```

输出是：

```
main set running=false
worker stopped, looped 1712067363
```

worker 在几百毫秒内退出了循环，`join(3000)` 也顺利返回。

这里我得诚实一点：**把 `volatile` 去掉，这个实验未必每次都能复现死循环。** 这取决于 JIT 有没有真正把读操作提出去，跟运行时长、机器、循环体复杂程度都有关系。所以这个实验的正确结论不是"没有 volatile 就一定卡死"，而是"有 volatile 才有确定的可见性保证"。没复现不代表写对了，只是运气好。

## 内存屏障：volatile 靠什么保证可见性

`volatile` 靠的是**内存屏障**（memory barrier）。可以把它想象成一道栅栏：指令不能随意翻过它。

往 `volatile` 变量写之前，插入一道写屏障，把之前所有修改都刷回主内存；读之后插入一道读屏障，让之后的读都重新取。同时这些屏障也挡住了跨越它的指令重排，所以 `volatile` 顺带提供了**有序性**——这就是 DCL 单例里给 `instance` 加 `volatile` 能解决问题的原因。

不用去背屏障的具体类型（LoadLoad、StoreStore 那些），记住这个直觉就够了：**`volatile` 的写会"公开"之前的修改，`volatile` 的读会"作废"之后的缓存**。

## 一个看起来很别扭的例子

理解了可见性，就能明白为什么有些 `volatile` 看着多余。下面这个循环开关是经典写法：

```java
class Worker implements Runnable {
    private volatile boolean stopped = false;

    public void stop() {
        stopped = true;              // 另一个线程调用
    }

    public void run() {
        while (!stopped) {
            doSomething();           // 循环体里没有对 stopped 的写
        }
    }
}
```

从单线程视角看，`stopped` 只在 `stop()` 里被写、在 `run()` 里被读，加 `volatile` 好像什么也没改变。但正是"循环体里没有写"这件事，让编译器有充分理由把 `stopped` 的读取优化掉。这个 `volatile` 一点都不多余，它是在告诉 JVM：每次都老老实实去主内存读。

## volatile 替代不了锁

`volatile` 被说得最多的问题，是有人拿它当轻量级锁用。它保证可见性和有序性，**但不保证原子性**。用 `i++` 做个反例最直接。

我把上一篇文章里那个计数器换成 `volatile int` 再跑一遍——4 个线程、每个 10 万次自增，期望 400000：

```
volatile int   = 203828 (expect 400000)
volatile int   = 191091 (expect 400000)
```

还是丢更新。原因很简单：`volatile` 保证的是"每次读都拿到最新值、每次写都马上让别人看到"，可 `i++` 是**读-改-写**三步。两个线程完全可以都读到最新的 5，各自算出 6，各自写回 6——每一步都符合 `volatile` 的规则，合起来还是少加了一次。原子性的问题，`volatile` 管不着。

（对比一下同一份实验里的另外两行：普通 `int` 是 121418、120499，`AtomicInteger` 是稳定的 400000。`AtomicInteger` 用的是 CAS，那是它另一个话题。）

## 什么时候该用 volatile

我的经验是它只适合两种情况：**一个线程写、其他线程读的状态标志位**，以及**作为其他同步手段的辅助**（比如 DCL 里禁止重排）。一旦涉及"读出来算一下再写回去"，就该换成锁或原子类了。

判断标准其实一句话：变量本身是**独立的、自洽的**（写入的是最终值，不依赖旧值），`volatile` 够用；只要写之前需要先读旧值，它就不够。那个循环开关属于前者，`i++` 属于后者——同样是"多线程读写一个变量"，结论完全相反。
