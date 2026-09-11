---
title: 异常处理入门：checked 和 unchecked 差在哪
date: 2025-04-12 22:00
categories: [技术笔记]
tags: [Java, 异常]
description: checked 与 unchecked 的区别、使用时机，以及三个常见的异常反模式
collection: java-basics
---

有一次看别人提交的代码，翻到一个 `catch (Exception e) { }`，里面空空如也。我随口问了一句，对方说"这里报错没关系，先抓掉"。那次之后我才意识到，异常处理不是"让代码通过编译"这么简单——写 `catch` 比写 `try` 难得多。

这篇把 checked 和 unchecked 的区别、什么时候该用哪种、以及几个我自己踩过的反模式捋一遍。

## 区别就在编译器管不管

Java 里所有能抛出的东西都继承自 `Throwable`，往下分两支：

- **Error**：JVM 层面的问题，比如 `OutOfMemoryError`、`StackOverflowError`。程序基本无能为力，也不该去 catch。
- **Exception**：程序层面的问题，再往下分成 checked 和 unchecked。

**checked 异常**是 `Exception` 里除去 `RuntimeException` 那一支剩下的部分，典型代表是 `IOException`、`SQLException`。编译器会盯着你：要么当场 catch，要么在方法签名上 `throws` 出去。不处理就编译不过。

**unchecked 异常**是 `RuntimeException` 及其子类，比如 `NullPointerException`、`IllegalArgumentException`、`IndexOutOfBoundsException`。编译器完全不干涉，写不写 `throws` 都能过。

```java
// 编译不过：未处理的 IOException
public void readFile() {
    FileInputStream in = new FileInputStream("a.txt");
}

// 写法一：往下抛，交给调用方
public void readFile() throws IOException {
    FileInputStream in = new FileInputStream("a.txt");
}

// 写法二：当场处理
public void readFile() {
    try (FileInputStream in = new FileInputStream("a.txt")) {
        // ...
    } catch (IOException e) {
        // 处理
    }
}
```

| | checked | unchecked |
|---|---|---|
| 继承关系 | Exception 中除去 RuntimeException 分支 | RuntimeException 及其子类 |
| 编译器 | 强制处理，不处理编译不过 | 不管 |
| 典型代表 | IOException、SQLException | NullPointerException、IllegalArgumentException |
| 常见成因 | 外部环境导致，可能失败 | 程序 bug 或参数不合法 |
| 该不该 catch | 调用方有能力恢复时才 catch | 一般不 catch，让它暴露出来 |

## 什么时候该用 checked

我的判断标准可以压成一句话：**调用方有没有可能做点有意义的事**。

读文件失败，调用方可以提示用户重试、换个路径、或者退回默认配置——这是可恢复的外部故障，适合 checked，因为它逼着调用方明确地做出选择。网络请求超时同理，可以重试也可以降级。

反过来，参数是 `null` 这种情况，调用方除了改代码没别的选择，这就是个 bug，用 unchecked（`IllegalArgumentException` 之类），让它尽早炸出来比层层向上抛好。

这里有个我自己踩过的坑：早先在项目里定义了一个 `OrderNotFoundException extends Exception`，结果每一个调用层都要写一遍 try-catch 或者 `throws`，检查了半天最后其实都是往上抛。这种"所有调用方都恢复不了"的异常，一开始就该设计成 unchecked。Spring 的 `DataAccessException` 整个体系都是 unchecked，也是这个道理——你让业务代码去恢复一个数据库连接失败，它通常什么也做不了。

## try-with-resources

Java 7 之前的资源关闭代码长这样：

```java
FileInputStream in = null;
try {
    in = new FileInputStream("a.txt");
    // 使用 in
} finally {
    if (in != null) {
        try {
            in.close();
        } catch (IOException e) {
            // close 本身也会抛异常，还得再处理一次
        }
    }
}
```

Java 7 之后：

```java
try (FileInputStream in = new FileInputStream("a.txt")) {
    // 使用 in，离开 try 块自动 close
} catch (IOException e) {
    // 统一处理
}
```

好处有三个：少写一大堆 finally 嵌套，读起来清爽；多个资源时按声明的反序关闭；如果 try 块和 `close()` 都抛了异常，`close()` 的异常会被标记成 suppressed 挂在主异常上，不会把真正的原因悄悄盖掉。凡是实现了 `AutoCloseable` 的资源——流、连接、锁——都值得用这个写法。

## 三个反模式

**一、吞异常。** `catch (Exception e) { }` 或者只调一句 `e.printStackTrace()`。异常被吃掉之后，线上出问题只能靠猜。真不打算处理，至少记一条日志，并在旁边写清楚为什么不处理——注释也算交代。

**二、`catch (Exception e)` 一把梭。** 一把抓会把 `NullPointerException`（自己的 bug）和 `IOException`（外部故障）混在一条路上，可这两类问题的处理方式完全不同；顺带还吞掉了本该暴露的 bug。按需要 catch 最具体的类型，让不同类型的异常走不同的分支。

**三、用异常控制流程。**

```java
// 反例：用异常判断"有没有"
try {
    list.get(index);
} catch (IndexOutOfBoundsException e) {
    // 越界了就说明没有
}
```

构造异常时 JVM 要填充栈帧（`fillInStackTrace`），代价比一次普通的 `if` 判断高得多；更要命的是语义——把正常的分支写成了异常，读代码的人会以为这里真的出了问题。边界判断老老实实用 `if` 就好。

## 小结

checked 和 unchecked 的分界线不在"严重程度"，在"编译器管不管"和"调用方能不能恢复"。设计异常类型时先问一句：拿到这个异常的人能做什么？能做的，用 checked 逼他面对；不能做的，用 unchecked 让它早点暴露。写 `catch` 之前也问同样的问题——如果答案是什么都做不了，那这个 catch 大概率不该存在。
