---
title: Java IO 与 NIO：两种读写模型的区别
date: 2025-03-15 21:00
categories: [技术笔记]
tags: [Java, IO, NIO]
description: BIO 的流与阻塞、NIO 的 Channel 与 Selector，以及各自的适用场景
collection: java-basics
---

大二写过一个很小的 Socket 服务端，用 `ServerSocket` 收连接、收数据、回一句话。本地测试只开一个客户端时一切正常，同时开两个浏览器窗口去连，第二个请求就一直转圈，得等第一个处理完才有响应。当时以为是代码写漏了什么，翻来覆去改了半天才对上号——这不是 bug，是 BIO 这个模型本来的样子。

这篇把两种模型放在一起对照一下，只说读写模型本身的区别，不碰 Netty。

## 最朴素的写法长什么样

先看那段让我困惑的代码：

```java
try (ServerSocket server = new ServerSocket(8080)) {
    while (true) {
        Socket socket = server.accept();          // 卡在这里，直到有连接进来
        InputStream in = socket.getInputStream();
        byte[] buf = new byte[1024];
        int n = in.read(buf);                     // 再卡在这里，直到有数据可读
        // ...处理并写回
    }
}
```

`accept()` 会一直阻塞，直到真的有客户端连上来；`read()` 也会一直阻塞，直到对端把数据发过来。也就是说，这个循环同一时刻只服务一个连接，第二个连接只能排在后面等。这就是「阻塞」两个字的实际含义。

## BIO：流 + 阻塞 + 一连接一线程

BIO 的数据载体是**流**（`InputStream` / `OutputStream`）。流是单向的，要么只能读，要么只能写；数据像水流一样顺序过来，读完就过去了。

要让多个连接同时被服务，最直接的办法是每个连接开一个线程：

```java
while (true) {
    Socket socket = server.accept();
    new Thread(() -> handle(socket)).start();   // 一个连接一个线程
}
```

这样确实能并发了，但线程是有成本的。每个线程默认要占几百 KB 到 1MB 的栈空间，一万个连接就是几 GB 内存；更亏的是，这些线程绝大多数时间都阻塞在 `read()` 上，什么也不干，只是在占着内存陪着连接等数据。连接数一上去，瓶颈不在 CPU，在内存和线程调度上。这就是当年 C10K 问题要解决的事情。

## NIO：Channel + Buffer + Selector

Java 1.4 引入了 NIO，换了一套模型。核心是三个概念：

- **Channel**：双向的，既能读也能写（对比流的单向）。
- **Buffer**：读写的中转站。数据不是直接从 Channel 拿出来，而是先读进 Buffer，再从 Buffer 里取；写的时候反过来，先写进 Buffer，再从 Buffer 送进 Channel。Buffer 靠 `position`、`limit`、`capacity` 三个位置指针协作，所以读写切换时要 `flip()` 一下。
- **Selector**：多路复用器，是 NIO 的关键。把多个 Channel 注册到同一个 Selector 上，一个线程调一次 `select()`，就能等到"哪些 Channel 有事件就绪"。

```java
Selector selector = Selector.open();
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.bind(new InetSocketAddress(8080));
serverChannel.configureBlocking(false);                  // 不阻塞才能注册进 Selector
serverChannel.register(selector, SelectionKey.OP_ACCEPT);

while (true) {
    selector.select();                                   // 阻塞，直到至少一个 Channel 就绪
    for (SelectionKey key : selector.selectedKeys()) {
        if (key.isAcceptable()) {
            SocketChannel client = serverChannel.accept();
            client.configureBlocking(false);
            client.register(selector, SelectionKey.OP_READ);
        } else if (key.isReadable()) {
            // 把数据读进 Buffer，flip 之后再取出来处理
        }
    }
}
```

关键在于线程不再"陪"某个连接等数据了。它等的是 Selector 的一句通知：谁准备好了告诉我。底层靠的是操作系统的多路复用（select / poll / epoll），这块不展开。于是一个线程就能照看成千上万个连接。

## 怎么选

| | BIO | NIO |
|---|---|---|
| 数据载体 | 流，单向 | Channel + Buffer，双向 |
| 阻塞行为 | accept / read 会阻塞 | 可设为非阻塞，交给 Selector 统一等 |
| 线程模型 | 一连接一线程 | 一个线程管多个连接 |
| 编程难度 | 直观，接近人的思维 | 复杂，要自己处理半包粘包和 Buffer 状态 |
| 适用场景 | 连接数少、连接存活时间长 | 连接数多、单连接数据量小或活跃度低 |

我的判断标准很简单：

- 连接数在几十到几百、逻辑不复杂，那 BIO 完全够用，代码直白，出问题好查。
- 连接数上万而且大部分时间是空闲的——比如长连接推送、IM、网关——NIO 的多路复用才有意义。

有个误区值得说清楚：**NIO 不等于更快**。连接少的时候它甚至可能比 BIO 慢，因为多了 Selector 事件分发和 Buffer 拷贝的开销。它解决的是"连接很多但大部分没数据"时的可扩展性，不是单连接的吞吐。选型要看场景，不是看谁更新。

## 一个容易混的概念

最后补一个面试常问的点。阻塞 / 非阻塞说的是**一次调用的行为**：没数据时调用方是干等，还是立刻返回。同步 / 异步说的是**数据就绪后由谁来完成读写**：应用自己读，还是内核读完再通知你。

按这个划分，NIO 严格说是"同步非阻塞"——它只是不再阻塞等待，数据还是要应用自己从 Channel 读进 Buffer。真正的异步 IO 是 Java 7 才加的 AIO（NIO.2），由内核把数据读完再回调。日常说的"NIO 是异步的"其实是把这两件事混在了一起。
