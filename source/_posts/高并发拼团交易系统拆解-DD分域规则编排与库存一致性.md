---
title: 高并发拼团交易系统拆解：DDD 分域、规则编排与库存一致性
date: 2026-08-29 11:00
categories: [技术笔记]
tags: [Java, 高并发, DDD, Redis, 项目]
description: DDD 三域拆解、策略/责任链/规则树的落地位置、Redis INCR + SET NX + 条件更新的防超卖组合拳、事务性发件箱与退款状态机
---

上半年花了两三个月，完整实践了一个拼团营销交易系统：从营销活动、折扣试算、交易锁单，到结算回调、退款逆向的整条链路。这篇文章做一次系统性的拆解——架构怎么分层、设计模式各自落在哪、库存一致性用什么组合拳、回调可靠投递怎么保证。

先交代系统边界：它是一个**拼团营销侧系统**，不碰支付和商品库存，与上游交易商城通过 HTTP 回调和 MQ 解耦——商城负责下单支付，这边负责"拼团活动能不能参加、优惠多少钱、队伍满没满、成团了通知谁"。拆清楚边界之后，复杂性会小很多。

## DDD 分域：3 个域，各管一段生命周期

整个工程按 DDD 四层切 Maven 模块（`trigger` HTTP/job/listener、`domain` 领域、`infrastructure` 基础设施、`types` 通用），领域层再按业务拆成三个域：

| 业务域 | 职责 | 核心表 |
|---|---|---|
| `activity` 营销活动域 | 活动配置、折扣试算、规则编排 | group_buy_activity、group_buy_discount、sku |
| `tag` 人群标签域 | 人群圈选、标签打标 | crowd_tags 三件套 |
| `trade` 交易域 | 锁单、结算、退款逆向、回调补偿 | group_buy_order、group_buy_order_list、notify_task |

分域的依据是**生命周期**：活动域的东西在活动创建时就定了（几折、满减多少、限购几次）；标签域是运营侧的批量数据活；交易域处理用户实时的锁单-支付-退款流转。三个域之间只通过仓储接口和领域事件交互，`trade` 域锁单时要校验活动，调的是 `IActivityRepository` 接口，不直接碰活动域的表——这是后续拆微服务的伏笔。

## 折扣策略：策略模式 + Spring 的 Map 注入路由

四种折扣：直减（ZJ）、折扣（ZK）、满减（MJ）、N 元购（N）。设计上两件事值得说：

**路由不用工厂类**。四个实现类直接 `@Service("MJ")` 注册进 Spring，然后注入一个 Map：

```java
// MarketNode.java
@Resource
private Map<String, IDiscountCalculateService> discountCalculateServiceMap;

// 优惠试算——按配置里的 marketPlan 取策略
IDiscountCalculateService discountCalculateService =
        discountCalculateServiceMap.get(groupBuyDiscount.getMarketPlan());
if (null == discountCalculateService) {
    throw new AppException(ResponseCode.E0001.getCode(), ResponseCode.E0001.getInfo());
}
BigDecimal payPrice = discountCalculateService.calculate(
        requestParameter.getUserId(), skuVO.getOriginalPrice(), groupBuyDiscount);
```

Spring 会把所有 `IDiscountCalculateService` 实现按 bean name 收进这个 Map，新增一种折扣只要加一个 `@Service("XX")` 类，路由代码零改动。比手写 `if/else` 或工厂 switch 干净得多。

**模板方法收敛公共逻辑**。抽象父类 `AbstractDiscountCalculateService` 的 `calculate()` 固定两步：人群标签过滤 + 调钩子：

```java
// AbstractDiscountCalculateService.java
@Override
public BigDecimal calculate(String userId, BigDecimal originalPrice,
                            GroupBuyActivityDiscountVO.GroupBuyDiscount groupBuyDiscount) {
    // 1. 人群标签过滤——限定人群的优惠，不在范围内按原价
    if (DiscountTypeEnum.TAG.equals(groupBuyDiscount.getDiscountType())){
        boolean isCrowdRange = filterTagId(userId, groupBuyDiscount.getTagId());
        if (!isCrowdRange) {
            return originalPrice;
        }
    }
    // 2. 折扣优惠计算——子类各自实现
    return doCalculate(originalPrice, groupBuyDiscount);
}
```

每个子类只关心自己的数学。比如满减：

```java
// MJCalculateService.java
// 折扣表达式 - "100,10" 即满100减10元
String[] split = marketExpr.split(Constants.SPLIT);
BigDecimal x = new BigDecimal(split[0].trim());
BigDecimal y = new BigDecimal(split[1].trim());

if (originalPrice.compareTo(x) < 0) {
    return originalPrice;                      // 不满足满减门槛，按原价
}
BigDecimal deductionPrice = originalPrice.subtract(y);
if (deductionPrice.compareTo(BigDecimal.ZERO) <= 0) {
    return new BigDecimal("0.01");             // 最低支付1分钱
}
return deductionPrice;
```

所有金额计算用 `BigDecimal` 且最后 `setScale(0, RoundingMode.DOWN)` 向下取整——营销系统的钱算错一分都是事故，这类细节值得形成肌肉记忆。

## 试算：规则树 + 线程池异步装配

首页的"XX 元拼团结算"试算接口是全系统流量最大的入口。它的编排是一棵规则树：`RootNode`（参数校验）→ `SwitchNode`（降级/切量开关）→ `MarketNode`(异步装配数据 + 算折扣) → `TagNode`（人群可见/可参与）→ `EndNode`，任何节点发现无配置就走旁路 `ErrorNode` 兜底。

SwitchNode 里那两个开关是**动态配置中心（DCC）**驱动的——`@DCCValue` 注解把配置挂到 Redis，运营改一个值就能秒级把整个试算接口降级掉，不用重新发布。大促场景的保命符。

性能的关键在 MarketNode 的异步装配。活动配置和商品信息是两路独立查询，串行就是两次 RTT 叠加；这里用线程池并行发起，一次性 `get`：

```java
// MarketNode.multiThread —— 两路查询并行，再统一写入上下文
QueryGroupBuyActivityDiscountVOThreadTask queryTask =
        new QueryGroupBuyActivityDiscountVOThreadTask(..., repository);
FutureTask<GroupBuyActivityDiscountVO> activityTask = new FutureTask<>(queryTask);
threadPoolExecutor.execute(activityTask);

QuerySkuVOFromDBThreadTask skuTask = new QuerySkuVOFromDBThreadTask(goodsId, repository);
FutureTask<SkuVO> skuVOFutureTask = new FutureTask<>(skuTask);
threadPoolExecutor.execute(skuVOFutureTask);

// 写入上下文——前置查询数据，供后续节点直接取用
dynamicContext.setGroupBuyActivityDiscountVO(activityTask.get(timeout, TimeUnit.MILLISECONDS));
dynamicContext.setSkuVO(skuVOFutureTask.get(timeout, TimeUnit.MILLISECONDS));
```

接口响应时间从约 500ms 降到 200ms，主要就来自这步并行化 + 责任链校验的并发化。代码里还留了一个 CompletableFuture 的备选实现和一张对比表（FutureTask 简单场景够用，CompletableFuture 赢在编排和异常处理），切换实现只需换 `@Service` 注解——树框架把节点隔离得足够好，换内核不动外壳。

## 责任链：锁单前的三道关卡

交易锁单走一条责任链：**活动可用性 → 用户参与上限 → 组队库存抢占**，每个节点只做一件事，`return next(...)` 透传：

```java
// TeamStockOccupyRuleFilter.java
// 1. teamId 为空，则为首次开团，不做拼团组队目标量库存限制
if (StringUtils.isBlank(teamId)) {
    return TradeLockRuleFilterBackEntity.builder()
            .userTakeOrderCount(dynamicContext.getUserTakeOrderCount())
            .build();
}

// 2. 抢占库存；通过抢占 Redis 缓存库存，来降低对数据库的操作压力。
boolean status = repository.occupyTeamStock(teamStockKey, recoveryTeamStockKey, target, validTime);
if (!status) {
    throw new AppException(ResponseCode.E0008);   // 缓存库存不足
}
```

责任链的价值在**可插拔**：营销侧以后要加"黑名单过滤""渠道限制"，加一个节点类、在工厂 `@Bean` 里添一个参数就行。节点间数据用 `DynamicContext` 传递（比如第一关查到的活动实体、第二关查到的参与次数），避免重复查库。

库存抢占失败抛异常，但注意——**前面关卡已经过了、库存抢占也成功了，最后落库如果失败，占掉的库存要还回去**。锁单服务里补了这个逆操作：

```java
// TradeLockOrderService.java
try {
    return repository.lockMarketPayOrder(groupBuyOrderAggregate);
} catch (Exception e) {
    // 记录失败恢复量
    repository.recoveryTeamStock(tradeLockRuleFilterBackEntity.getRecoveryTeamStockKey(),
                                 payActivityEntity.getValidTime());
    throw e;
}
```

这个 `recoveryTeamStockKey`（恢复量）是防超卖设计里很妙的一笔，下一节展开。

## 防超卖三板斧：INCR 快拒、SET NX 兜底、条件更新封盘

拼团组队库存是典型的热点计数场景。系统的防线分三层，核心思想是**让越便宜的层挡掉越多的流量**。

**第一层：Controller 预检**。锁单入口先查拼团进度，`targetCount == lockCount` 直接拒绝，请求根本不进领域逻辑。挡掉的是"队伍已满还在疯狂重试"的流量。

**第二层：Redis INCR 原子抢占**。真正的主力，完整看这段：

```java
// TradeRepository.occupyTeamStock
@Override
public boolean occupyTeamStock(String teamStockKey, String recoveryTeamStockKey,
                               Integer target, Integer validTime) {
    // 失败恢复量
    Long recoveryCount = redisService.getAtomicLong(recoveryTeamStockKey);
    recoveryCount = null == recoveryCount ? 0 : recoveryCount;

    // 1. incr 得到值，与总量和恢复量做对比。恢复量为系统失败时候记录的量。
    // 2. 从有组队量开始，相当于已经有了一个占用量，所以要 +1
    long occupy = redisService.incr(teamStockKey) + 1;

    if (occupy > target + recoveryCount) {
        // 超出库存限制时，需要将已经增加的库存减回去，避免库存泄漏
        redisService.decr(teamStockKey);
        return false;
    }

    // 1. 给每个产生的值加锁为兜底设计，虽然incr操作是原子的，基本不会产生一样的值。
    //    但在实际生产中，遇到过集群的运维配置问题，以及业务运营配置数据问题，导致incr得到的值相同。
    // 2. validTime + 60分钟，是一个延后时间的设计，让数据保留时间稍微长一些，便于排查问题。
    String lockKey = teamStockKey + Constants.UNDERLINE + occupy;
    Boolean lock = redisService.setNx(lockKey, validTime + 60, TimeUnit.MINUTES);

    if (!lock) {
        log.info("组队库存加锁失败 {}", lockKey);
    }
    return lock;
}
```

三个细节值得咀嚼：

1. **INCR 返回值即"排队号"**。每次 INCR 拿到全局唯一的递增值，`occupy > target + recoveryCount` 一比对就知道超没超。超了立刻 DECR 回补——这比 SETNX 抢名额再回滚的做法少一次网络往返判断。
2. **恢复量 key 的意义**：上一节那个"落库失败还库存"没有直接 DECR 占用 key，而是 INCR 一个独立的 recovery key，判断阈值变成 `target + recoveryCount`。为什么？因为占用计数里的值可能已经有主（SET NX 锁着），直接减会把别人的名额减掉；恢复量单独记账，让"失败退回的名额"可以被重新占用，账目不混。
3. **SET NX 兜底锁的来源**是真实生产事故——INCR 理论上原子且不重复，但注释写明"遇到过集群的运维配置问题、业务运营配置数据问题，导致 incr 得到的值相同"。给每个排队号再配把锁，重复值就能被识别出来。**理论原子性和工程现实之间的差距，靠防御性设计来填**。

**第三层：MySQL 条件更新，最终一致性边界**。Redis 挡了 99% 的流量，但 Redis 不是账本。落库时用条件更新做最终裁决：

```xml
<update id="updateAddLockCount" parameterType="java.lang.String">
    update group_buy_order
    set lock_count = lock_count + 1, update_time= now()
    where team_id = #{teamId} and lock_count &lt; target_count
</update>
```

`where lock_count < target_count` 让数据库自己保证不超卖——并发下这一句的更新是串行化的，影响行数不等于 1 就说明拼团已满，抛异常回滚整个事务。**Redis 是性能优化，DB 的条件更新才是正确性边界**，这个主次关系在很多"Redis 库存"方案里被搞反了。

## 幂等：四处各有一把锁

交易系统里，重复请求不是异常而是常态（用户重复点击、MQ 重试、定时任务重跑）。这个系统四处幂等各有各的打法：

1. **锁单幂等**：外部交易单号 `out_trade_no` 贯穿全链路，锁单先按它查已有记录，存在且未完成直接返回原结果；插入时靠唯一索引兜底，`DuplicateKeyException` 转成业务异常。
2. **结算幂等**：状态机流转全走条件更新（`where status = 0`），重复结算影响行数为 0，天然幂等。
3. **退款幂等**：责任链里专门有一个 `UniqueRefundNodeFilter`，查到订单已 CLOSE 就返回 `REPEAT` 行为枚举，不重复执行退款。
4. **库存恢复幂等**：MQ 消费退单消息恢复库存时，`SET NX("refund_lock_" + orderId)` 防重复消费——同一订单的消息来两次，第二次拿不到锁直接跳过；消费抛异常则主动删锁，让 MQ 下次重试还能进来。

顺带记录一个我在代码评审式阅读中发现的真实缺陷：恢复库存这处 `redisService.setNx(lockKey, 30 * 24 * 60 * 60 * 1000L, TimeUnit.MINUTES)`，注释想设 30 天过期，但把**毫秒值传进了"分钟"单位参数**——实际过期时间约 5 万天。幂等锁永久不失效在这个场景里"歪打正着"地安全（锁越久越不会重复恢复），但如果这个订单要重新参与拼团就出问题了。**过期时间的单位和数值要当公式对待，不能心算**。

## 事务性发件箱：回调可靠投递

拼团成团后要回调上游商城（HTTP 或 MQ）。朴素做法是在结算事务里直接发 HTTP——事务里掺网络 IO 本来就是反模式，而且发完消息事务回滚的话，对方收到了"幽灵通知"；反过来事务提交后应用崩溃，通知就丢了。

这里的方案是**本地消息表（事务性发件箱）**：`notify_task` 表，消息写入和业务变更在**同一个数据库事务**里，要么一起成功要么一起失败：

```java
// TradeRepository.settlementMarketPayOrder —— 结算事务内
// 拼团完成写入回调任务记录
NotifyTask notifyTask = new NotifyTask();
notifyTask.setTeamId(groupBuyTeamEntity.getTeamId());
notifyTask.setNotifyCount(0);
notifyTask.setNotifyStatus(0);          // 0初始、1完成、2重试、3失败
notifyTask.setUuid(teamId + "_" + category + "_" + outTradeNo);   // 幂等键
notifyTask.setParameterJson(JSON.toJSONString(...));
notifyTaskDao.insert(notifyTask);       // 与结算更新同一事务
```

投递走"即时 + 补偿"双通道：结算事务一提交就扔线程池**先试一把即时回调**（提高时效性），失败了也不怕——定时任务 `GroupBuyNotifyJob` 兜底扫描 `notify_status in (0,2)` 的记录重新投递。重试有上限：`notifyCount > 4` 就标记彻底失败，防止死循环打爆下游。

```java
// TradeTaskService.execNotifyJob（节选）
String response = port.groupBuyNotify(notifyTask);
if (NotifyTaskHTTPEnumVO.SUCCESS.getCode().equals(response)) {
    repository.updateNotifyTaskStatusSuccess(notifyTask);
} else if (NotifyTaskHTTPEnumVO.ERROR.getCode().equals(response)) {
    if (notifyTask.getNotifyCount() > 4) {
        repository.updateNotifyTaskStatusError(notifyTask);    // 彻底失败
    } else {
        repository.updateNotifyTaskStatusRetry(notifyTask);    // 继续重试
    }
}
```

系统多实例部署时，定时任务和投递动作都加了 Redisson 抢占锁（`tryLock(3, 0, SECONDS)`，抢不到直接返回）：**谁抢到谁执行，防的就是"N 台机器把同一份通知发 N 遍"**。整套设计与 Transactional Outbox 模式完全同构——不引入额外中间件（没有 Canal、没有 Kafka 事务消息），用一张表 + 一个定时任务就换来了至少一次投递保证。

## 退款状态机：枚举里藏着策略路由

退款是逆向流程，难点在状态组合的爆炸：拼团单有（拼单中/完成/失败/完成含退单），交易单有（锁定/完成/退单），两两组合共有九种，但合法的退款路径只有三种。系统的处理方式是把**状态机直接写进枚举**：

```java
// RefundTypeEnumVO.java
UNPAID_UNLOCK("unpaid_unlock", "unpaid2RefundStrategy", "未支付，未成团") {
    @Override
    public boolean matches(GroupBuyOrderEnumVO groupBuyOrderEnumVO,
                           TradeOrderStatusEnumVO tradeOrderStatusEnumVO) {
        return GroupBuyOrderEnumVO.PROGRESS.equals(groupBuyOrderEnumVO)
                && TradeOrderStatusEnumVO.CREATE.equals(tradeOrderStatusEnumVO);
    }
},
PAID_UNFORMED("paid_unformed", "paid2RefundStrategy", "已支付，未成团") { ... },
PAID_FORMED("paid_formed", "paidTeam2RefundStrategy", "已支付，已成团") { ... };

public static RefundTypeEnumVO getRefundStrategy(GroupBuyOrderEnumVO group, TradeOrderStatusEnumVO trade) {
    return Arrays.stream(values())
            .filter(refundType -> refundType.matches(group, trade))
            .findFirst()
            .orElseThrow(() -> new RuntimeException("不支持的退款状态组合: ..."));
}
```

每个枚举值自带 `matches()` 匹配自己的状态组合，非法组合在路由处就抛异常，不会漏到执行层。三种退款策略的差异用代码表达得非常清楚：

- **未支付退单**：锁单量 -1，队伍还能继续加人；
- **已支付未成团**：锁单量、完成量都 -1，队伍人数缺口重新打开；
- **已成团退款**：最微妙——锁单库存**不恢复**（队伍已经成交给上游，动了会影响已达成的交易），只把单状态改成"完成含退单"；如果团队只剩这一个人，状态直接转失败。

所有状态流转依然走条件更新（`where status = 0`、`where (status = 1 or status = 3) and complete_count = 1`），并发退款、重复退单在 DB 层被最后拦截。退单成功后通过 MQ 异步恢复 Redis 库存，消费端注释里写着完整的三段式推理：本地消息表保证消息一定发出、分布式锁保证不重复消费、MQ 重试保证失败必达——**最终一致性的每个环节都有明确的角色**。

## 写在最后

这个项目给我的最大收获不是"会用 Redis 和 MQ"，而是三个设计观的校准：

1. **正确性放 DB，性能放 Redis**。INCR 和条件更新各司其职，别让缓存承担账本的职责；
2. **幂等不是功能，是纪律**。四处幂等四处打法，但原则统一：唯一键 + 状态条件更新 + 抢占锁；
3. **失败路径先于成功路径设计**。恢复量 key、notify_task 重试上限、退款策略的库存不恢复——这些"失败了怎么办"的代码量一点都不比正常流程少，而这正是交易系统和 CRUD 的分水岭。

> 说明：工程基于小傅哥（bugstack.cn）开源的 DDD 拼团营销项目实践搭建，本文中的源码分析与踩坑总结来自我对整个工程的逐行阅读、本地调试与复盘。
