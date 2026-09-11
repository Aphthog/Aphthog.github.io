---
title: 一次 OOM 排查记录
date: 2026-02-14 21:00
categories: [技术笔记]
tags: [Java, JVM, 排查, OOM]
description: 服务跑一夜 OOM 的排查：dump、MAT 支配树定位、本地缓存淘汰缺失修复
collection: jvm
---

周一早上到工位，钉钉群里在 @我：凌晨三点线上服务挂了。第一件事查日志——`java.lang.OutOfMemoryError: Java heap space`，堆内存溢出。

看监控面板，堆使用量在每次重启后从基线稳步往上爬，到凌晨三点左右冲到峰值然后 OOM——典型的**内存泄漏**形态，不是流量突增导致的瞬时 OOM。瞬时高峰的话，堆用完会跌回来，重启后不会每周重复同样趋势的上涨曲线。

## 加 HeapDumpOnOutOfMemoryError

之前已经加过 `-XX:+HeapDumpOnOutOfMemoryError` 参数，所以 OOM 时 JVM 自动生成了一份 heap dump 文件。如果你的线上服务还没加这个参数，建议加上——它在 OOM 时自动打出堆快照，不需要人工介入：

```
-Xmx2g -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dumps/
```

有了 dump，排查就可以重现现场了。

## MAT 支配树定位

把 dump 拉到 MAT（Memory Analyzer Tool）里打开。先看概览：堆一共 2GB，有一个 `java.util.concurrent.ConcurrentHashMap` 的实例占了几百 MB，加上它相关的内部对象，总保留大小接近 1.5GB。直觉告诉我这个 Map 有问题。

在 MAT 里打开**支配树（Dominator Tree）** 视图。支配树是 MAT 最常用的功能：它计算每个对象"如果回收它，最多能释放多少内存"，然后按保留大小从大到小排序。排第一的就是上面那个 ConcurrentHashMap，它的 `table` 数组里装了几十万个 entry。

## 定位到只增不减的 Map

回到代码搜这个 Map 的引用，发现是一个**本地缓存**——逻辑是从数据库加载配置数据，为了避免每次都查 DB，用 `ConcurrentHashMap` 缓存起来：

```java
public class ConfigCache {
    // 本地缓存，只 put，没有淘汰
    private static final Map<String, Config> cache = new ConcurrentHashMap<>();

    public Config get(String key) {
        return cache.computeIfAbsent(key, this::loadFromDb);
    }
}
```

问题很清楚：`computeIfAbsent` 保证每个 key 只加载一次、加载过就不重复查 DB，但**缓存容量没有上限**。如果 key 的基数没有上限——比如每次请求都会带上用户 ID 相关的唯一键——这个 Map 会一直增长。线上跑了十几个小时，几百万个不同的 key 把堆塞满了。

## 根因：本地缓存没做淘汰

这就是典型的"缓存但没做淘汰策略"——以为放个 Map 就完事了，忘了考虑它会一直往里加东西。我犯的错是把缓存理解成了"前一次查询结果的复用"，没有问自己：这些数据真的需要一直留着吗？

修复方案我选用了 Caffeine 做本地缓存：

```java
Cache<String, Config> cache = Caffeine.newBuilder()
    .maximumSize(10_000)                // 最多存 1 万条
    .expireAfterWrite(30, TimeUnit.MINUTES)  // 写入 30 分钟后过期
    .recordStats()                      // 记录命中率，方便调优
    .build();
```

Caffeine 用 W-TinyLFU 淘汰算法，比 LRU 更能区分"真正常用的 key"和"仅仅是最近上过热门、以后不会再来"的 key。

如果你不想引入第三方依赖，也可以用 `LinkedHashMap` 手写一个简单的 LRU 缓存：

```java
class LruCache<K, V> extends LinkedHashMap<K, V> {
    private final int maxSize;

    LruCache(int maxSize) {
        super(16, 0.75f, true);  // access-order = true
        this.maxSize = maxSize;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > maxSize;
    }
}
```

核心思路一样：**给缓存一个上限，超了就淘汰最不常用的**。

## 复盘

这次 OOM 排查让我养成了三个习惯：

1. **生产环境提前加 HeapDumpOnOutOfMemoryError**——没有 dump，排查 OOM 基本靠猜。这个参数应该在每个 Java 应用的启动脚本里默认加上。
2. **写缓存之前先想淘汰策略**——不加淘汰策略的本地缓存不是一个缓存，是一个泄洪的内存漏洞。`ConcurrentHashMap` 用 `computeIfAbsent` 太顺手了，顺手到容易忘了加上限。
3. **MAT 支配树是 OOM 排查的第一选择**——不用人肉翻代码猜哪个对象大，支配树直接告诉你"回收谁释放最多"，顺着排序找对应的业务代码就行。

这次的问题本质上是一个低级错误：用了 Map 做缓存但没设上限。写出来不觉得高明，但犯错的过程挺值得记——以后再写本地缓存，写之前会先问自己一句"满了怎么办"。