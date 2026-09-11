---
title: HashMap 入门：从 put 到扩容
date: 2025-02-16 20:30
categories: [技术笔记]
tags: [Java, 集合, HashMap]
description: 从 put 的链路讲到扩容时机，理清 HashMap 的数组、链表与红黑树
collection: java-basics
---

`map.put(key, value)` 这行代码写过太多次，顺手到从来没想过它内部发生了什么。直到面试里被问"HashMap 为什么快"，我才发现自己只能答出"因为它用了哈希"，再往下就说不清了。回来把 put 的链路从头走了一遍，这篇就是那次梳理的记录。

## 一次 put 的三步

**第一步是算 hash。** 不是直接用 `key.hashCode()`，而是先做一次扰动：

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

`hashCode()` 返回一个 32 位的 int，而下面定位时只用得到低位。如果不处理，高 16 位的信息就白白浪费了——两个高位不同、低位相同的 key 会算到同一个位置去。这里把高 16 位异或到低 16 位上，让高位也参与进来，撞车的概率就小很多。

**第二步是定位到桶。** 下标算的是 `(n - 1) & hash`，n 是数组容量。因为 n 是 2 的幂，这个按位与等价于 `hash % n`，但位运算快得多。这也解释了为什么 HashMap 的容量必须是 2 的幂——容量一旦不是 2 的幂，`(n-1) & hash` 和取模就不等价了，分布会出问题。

**第三步才是放进去。** 桶是空的就直接放；桶里已经有东西，说明发生了哈希冲突，得想办法处理。

## 冲突了怎么办

不同的 key 算到同一个下标是没法避免的，HashMap 的解法是拉链法：数组的每个位置挂一条链表，所有落在同一个桶里的节点串在这条链上。查找时先定位到桶，再沿着链表比 key，命中为止。

链表长了，查找就退化成 O(n)。所以 JDK 8 起加了一条规则：**链表长度到 8、并且数组容量到了 64 时，链表转成红黑树**，查找从 O(n) 变成 O(log n)。容量没到 64 的话优先扩容——因为数组太小本身就会导致冲突多，扩容比转树更划算。

这里最常见的一个追问是"为什么阈值偏偏是 8"。源码注释里用泊松分布算过一笔账，推导我不打算在这里展开，记住结论就够了：**正常散列下链表长度到 8 是一个概率极低的事件**，所以这个阈值不是为了日常优化，而是防极端情况的兜底——万一有人故意构造一堆 hash 相同的 key 塞进来，红黑树能把最坏情况从 O(n) 压到 O(log n)，不至于被一次查询拖垮。

## 什么时候扩容

HashMap 里有两个数字：容量（数组长度）和**负载因子**，默认 0.75。当元素个数超过 `容量 × 负载因子` 时触发扩容，新容量是原来的两倍。

0.75 这个值是个折中。调低了数组大量位置空着，浪费内存；调高了冲突变多，链表变长，查询变慢。0.75 算是空间和时间上比较平衡的一个点。

扩容的代价不小：要新建一个两倍大的数组，把旧数组里的元素重新分配到新数组——这一步是 O(n)。所以如果能预估元素数量，`new HashMap<>(expectedSize)` 给个初始容量，能省掉中间几次扩容的整体搬移。

JDK 8 在这一点上做过一个优化：因为容量永远是 2 的幂，元素的新位置只有两种可能——**要么留在原来的下标，要么移动到"原下标 + 旧容量"**。定位只看 hash 的低几位，容量翻倍相当于多看了一位，所以不必重新计算 hash。这个结论在写业务代码时用不到，但它解释了为什么扩容可以不用重头再散一遍。

## 打印一下扩容前后的容量

嘴上说过不如跑一遍。下面这段用反射读出 `table` 和 `threshold`，观察默认容量 16 时元素从第 12 个到第 13 个发生了什么（反射探私有字段只适合做实验，业务代码别这么写）：

```java
import java.lang.reflect.Field;
import java.util.HashMap;

public class MapGrowth {
    public static void main(String[] args) throws Exception {
        HashMap<String, Integer> map = new HashMap<>();
        for (int i = 1; i <= 13; i++) {
            map.put("key" + i, i);
            if (i == 12 || i == 13) print(map, "插入第 " + i + " 个元素后");
        }
    }

    static void print(HashMap<?, ?> map, String tag) throws Exception {
        Field table = HashMap.class.getDeclaredField("table");
        table.setAccessible(true);
        Field threshold = HashMap.class.getDeclaredField("threshold");
        threshold.setAccessible(true);
        Object[] arr = (Object[]) table.get(map);
        int capacity = (arr == null) ? 0 : arr.length;
        System.out.printf("%s: size=%d, capacity=%d, threshold=%d%n",
                tag, map.size(), capacity, threshold.getInt(map));
    }
}
```

输出是：

```
插入第 12 个元素后: size=12, capacity=16, threshold=12
插入第 13 个元素后: size=13, capacity=32, threshold=24
```

第 12 个元素放进去时 `size == threshold`，还没超过，数组保持 16；再放第 13 个，`size` 变成 13 超过阈值，扩容到 32，新阈值也随之变成 32 × 0.75 = 24。这就是那句"超过容量乘负载因子就扩容"的实际样子。

## 小结

一次 put 的链路：算 hash（带扰动）→ 按位与定位桶 → 冲突走链表 → 链表过长且容量够大时转红黑树；元素数超过容量乘 0.75 时容量翻倍并重新分配。把这条链路记住，HashMap 相关的多数问题都能顺着推出来。
