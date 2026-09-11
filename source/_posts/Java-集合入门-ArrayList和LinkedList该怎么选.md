---
title: Java 集合入门：ArrayList 和 LinkedList 该怎么选
date: 2025-01-12 21:00
categories: [技术笔记]
tags: [Java, 集合]
description: 结合底层结构对比 ArrayList 与 LinkedList 的操作代价与选择依据
collection: java-basics
---

刚开始写 Java 的时候，存一批数据我只会用数组。数组有两个绕不过去的限制：长度在创建时就定死，而且实际要存多少个元素往往事先并不知道。于是代码里经常出现「先声明 100 个，不够再改」这种写法，很难看。

集合解决的就是这个问题。但 `List` 底下最常用的两个实现——`ArrayList` 和 `LinkedList`——名字看着都像列表，API 也几乎一样，选哪个好像都行。真去看一眼它们的底层结构，会发现性能上的差别不是一点点。

## 底层结构决定了操作代价

`ArrayList` 底层就是一个 `Object[]` 数组，所有元素挨着放。`LinkedList` 底层是双向链表，每个节点除了存数据，还存着指向前后节点的两个引用。

结构不同，各类操作的代价就完全不同：

- **随机访问**：`ArrayList` 直接按数组下标定位，O(1)；`LinkedList` 没有下标，只能从头（或从尾，看哪个近）沿着引用一步步走，O(n)。
- **尾部追加**：`ArrayList` 直接放到第一个空位，均摊 O(1)——之所以是"均摊"，是因为数组满了要扩容，这一步是新建一个 1.5 倍大小的数组再整体复制，O(n)，只是摊到每次 add 上还能接受。`LinkedList` 记着尾节点，同样 O(1)。
- **中间插入和删除**：`ArrayList` 要把后面的元素整体挪一位，O(n)。`LinkedList` 如果已经拿到了那个位置的节点，改两个引用就行，O(1)——可问题恰恰在于"拿到那个节点"本身要 O(n)。

| 操作 | ArrayList | LinkedList |
|---|---|---|
| get(i) 随机访问 | O(1) | O(n) |
| 尾部 add | 均摊 O(1) | O(1) |
| 头部 add | O(n) | O(1) |
| 中间 insert / remove | O(n) | O(n) 找位置 + O(1) 改指针 |
| 每个元素的内存开销 | 只有元素本身 | 元素 + 两个引用 |
| 缓存友好性 | 好 | 差 |

## 一个朴素的对比实验

下面这段代码做的事情一样，都是顺序遍历十万个元素求和，写的也是同一个 API，但两者背后的代价完全不同：

```java
List<Integer> arrayList = new ArrayList<>();
List<Integer> linkedList = new LinkedList<>();
for (int i = 0; i < 100_000; i++) {
    arrayList.add(i);
    linkedList.add(i);
}

long sum = 0;
long t1 = System.nanoTime();
for (int i = 0; i < arrayList.size(); i++) {
    sum += arrayList.get(i);      // O(1)，直接取下标
}
long t2 = System.nanoTime();
for (int i = 0; i < linkedList.size(); i++) {
    sum += linkedList.get(i);     // 每次都要从头走 i 步
}
long t3 = System.nanoTime();

System.out.printf("ArrayList: %d ms, LinkedList: %d ms%n",
        (t2 - t1) / 1_000_000, (t3 - t2) / 1_000_000);
```

在我的机器上，`ArrayList` 那一段是个位数毫秒，`LinkedList` 要几秒。差别就在于第二段循环里的每次 `get(i)` 都是一次 O(n) 的链表遍历，整个循环被放大成了 O(n²)。

## 为什么大多数场景还是选 ArrayList

实际业务里的 List 操作，绝大多数是遍历和尾部追加。这两件事 `ArrayList` 都不吃亏，遍历还更快，所以默认选它基本不会错。

即使是在中间频繁插入的场景，链表也不一定赢。找位置本来就是 O(n)，省下来的只是移动元素那部分开销。更关键的是内存访问模式：`ArrayList` 的元素在内存里连续排布，CPU 读一条 cache line 会把后面几个元素顺带读进来，遍历时绝大部分访问都命中缓存；`LinkedList` 的节点是散落在堆上的，走一次指针基本就是一次 cache miss，这个差距在现代 CPU 上比渐近复杂度还明显。

另外 `LinkedList` 每个元素要多背两个引用，内存占用明显更高。它真正的强项其实是当双端队列用，但这件事 `ArrayDeque` 一般做得更好（不用每个节点挂指针、不用为每个元素分配对象），所以日常代码里 `LinkedList` 出现的频率其实很低。

## 一个实用的小建议

`new ArrayList<>()` 默认容量是 10，而且是第一次 add 时才真正分配数组。如果事先能估出大概数量，直接 `new ArrayList<>(expectedSize)`，能省掉中间几次扩容和整体复制。这是很便宜的一个优化，只是经常被忘掉。
