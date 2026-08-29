---
title: Java 泛型入门
date: 2026-05-09
categories: [技术笔记]
tags: [Java, 泛型]
description: 类型擦除、泛型类与方法，一篇搞懂
---

泛型是 Java 5 引入的重要特性，它允许在定义类、接口和方法时使用类型参数。

## 为什么需要泛型

在没有泛型之前，集合类存储元素时使用的是 `Object` 类型：

```java
List list = new ArrayList();
list.add("hello");
String str = (String) list.get(0); // 需要强制转型
```

这样写有两个问题：

1. **需要强制转型** — 每次取出都要手动转
2. **运行时可能出错** — 如果放入了不同类型的元素，转型会抛出 `ClassCastException`

## 泛型的基本使用

有了泛型后，上面的代码可以写成：

```java
List<String> list = new ArrayList<>();
list.add("hello");
String str = list.get(0); // 不需要转型
```

编译器会在编译期检查类型安全，运行时不再需要类型判断。

## 泛型类

```java
public class Box<T> {
    private T value;

    public void set(T value) {
        this.value = value;
    }

    public T get() {
        return value;
    }
}
```

使用时指定具体类型：

```java
Box<Integer> intBox = new Box<>();
intBox.set(42);
int value = intBox.get();
```

## 泛型方法

```java
public <T> T getMiddle(T... args) {
    return args[args.length / 2];
}
```

## 类型擦除

Java 的泛型是通过**类型擦除**实现的。在编译期，泛型信息会被擦除，只保留原始类型。这意味着运行时无法获取泛型的具体类型。

```java
List<String> strings = new ArrayList<>();
List<Integer> integers = new ArrayList<>();
System.out.println(strings.getClass() == integers.getClass()); // true
```

> 类型擦除是 Java 泛型与 C# 等语言泛型的最大区别。

## 总结

泛型提高了代码的**安全性和可读性**，是日常 Java 开发中最常用的语言特性之一。
