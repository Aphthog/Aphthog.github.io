---
title: QQ 群 AI 助手开发记录（三）：三层记忆系统
date: 2026-08-29 15:00
categories: [技术笔记]
tags: [Python, Agent, NoneBot2, 项目]
description: 系列第 3 篇：SQLite 工作记忆、ChromaDB 语义记忆、LLM 抽取的用户画像——三层各管什么、怎么组装进上下文、节流设计，以及 ChromaDB 替代 FAISS 的选型逻辑
---

群聊助手的灵魂在于"记得住"。用户昨天说过养了只猫，今天问"我家那只吃什么"，答不上来就露馅了。这个项目的记忆分三层，各管一件事：**工作记忆**管这个会话刚才说了什么，**语义记忆**管这个群历史上值得记住的事实，**用户画像**管每个群友是谁。这一篇拆这三层怎么落地、怎么组装进上下文、以及为什么是三层而不是一个向量库全解决。

> 系列目录见[第一篇](/2026/08/29/QQ群AI助手开发记录-一-Agent架构与工具框架/)。

## 三层总览

| 层 | 存储 | 粒度 | 写入时机 | 读取时机 |
|---|---|---|---|---|
| 工作记忆 | SQLite `sessions` 表 | 单条消息 | 每条消息实时写入 | 触发时拉最近 30 条 |
| 语义记忆 | ChromaDB `agent_memory` 集合 | 事实（一句话） | 对话结束后 LLM 抽取 | 触发时按语义召回 top5 |
| 用户画像 | SQLite `profiles` 表 | 每用户一份 traits JSON | 每 50 次互动 LLM 抽取一次 | 按需查询 |

三个 MemoryManager 之下的组件共享一个 SQLite 文件，`MemoryManager` 做统一门面。为什么是三层：**时间粒度不同**——秒级（刚才）、周级（这个群聊过什么）、长期（这个人是谁）；**读取方式也不同**——顺序窗口、语义相似、按人索引。一个向量库装所有东西，召回时群聊闲话和关键事实混在一起，反而稀释了精度。

## 工作记忆：倒序取再反转

SQLite 存每个会话的原始消息，建表时索引直接按查询模式建：

```python
# qq_bot/memory/store.py（节选）
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_key TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    timestamp INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_key_ts ON sessions(chat_key, timestamp DESC);
```

取上下文是个值得说的小技巧——**倒序取再反转**：

```python
# qq_bot/memory/store.py
async def get_messages(self, chat_key: str, limit: int = 30) -> list[dict]:
    cursor = await self._db.execute(
        "SELECT role, content, user_id, timestamp FROM sessions "
        "WHERE chat_key = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
        (chat_key, limit),
    )
    rows = await cursor.fetchall()
    msgs = [dict(r) for r in reversed(rows)]
    return msgs
```

`ORDER BY timestamp DESC ... LIMIT 30` 走 `(chat_key, timestamp DESC)` 索引，直接拿到"最近的 30 条"；如果写升序 `ORDER BY timestamp ASC LIMIT 30` 拿到的是**最早的** 30 条，要最近的就得排序全表。倒序索引 + 应用层 `reversed()` 恢复时间顺序，一行 Python 省一个排序需求。`id DESC` 做次级排序是处理同一秒多条消息的稳定性。

工作记忆解决的是**指代和话题延续**："他呢？""那第二个呢？"——没有前文这些问句无法回答。群聊拉 30 条、私聊 15 条注入 prompt，够模型理解话题，又不至于撑爆上下文。

## 语义记忆：ChromaDB + chat_key 过滤

语义记忆存的是 LLM 从对话里抽出来的**事实**（"小王下周要去成都出差"），用 ChromaDB 持久化：

```python
# qq_bot/memory/vector.py（节选）
self._client = chromadb.PersistentClient(
    path=self.path,
    settings=ChromaSettings(anonymized_telemetry=False),
)
self._collection = self._client.get_or_create_collection("agent_memory")

async def recall(self, query: str, chat_key: str = "", k: int = 5) -> list[str]:
    """Retrieve relevant memories by semantic similarity."""
    self._ensure_init()
    where = {"chat_key": chat_key} if chat_key else None
    results = self._collection.query(
        query_texts=[query],
        n_results=k,
        where=where,
    )
    docs = results.get("documents", [[]])[0]
    return [d for d in docs if d]
```

写入时每条事实的 metadata 都带 `chat_key`，召回时 `where={"chat_key": chat_key}` 过滤——**A 群的记忆不会召回给 B 群**。语义相似没有群隔离的话，不同群的"搬家""点外卖"互相污染，这是多群部署的第一个坑。

### 为什么是 ChromaDB 不是 FAISS

V1 的知识库用的是 bge-large-zh + FAISS HNSW，效果不错但要自己管三件事：embedding 模型加载（一个 GPU/CPU 推理进程）、索引持久化（增删后重建/落盘）、分块器。这套重量在 RAG 服务场景值得——那个场景有上万文档（搭建过程写过[一个系列](/2026/05/15/RAG-服务搭建记录-一-从零开始/)）。

而群聊语义记忆的量级是**一个群几千条事实**，ChromaDB 内置默认 embedding 开箱即用、PersistentClient 自动持久化、增删原生支持。**方案重量要匹配数据量级**——这个道理在 RAG 项目里悟过，这里又验证了一遍。如果哪天要跨几百个群，再考虑换回 FAISS + 独立 embedding 服务。

## 事实抽取：NONE 哨兵

把事实**写入**语义记忆的环节在每轮对话结束后台跑：

```python
# qq_bot/memory/manager.py — extract_and_remember（节选）
dialogs = "\n".join(
    f"{m['role']}: {m['content'][:300]}" for m in messages[-6:]
)
msgs = build_messages(
    system_prompt="从对话中提取值得记住的事实（人物信息、约定、偏好等）。每行一个事实。没有就输出 NONE。",
    user_text=dialogs,
)
raw = await self.profiles.llm.chat(msgs, max_tokens=200, temperature=0.1)
if raw.strip().upper() == "NONE":
    return
facts = [line.strip("- ").strip() for line in raw.split("\n") if line.strip() and "NONE" not in line]
if facts:
    await self.remember(chat_key, facts)
```

三个设计点：

1. **只看最近 6 条**。抽取的对象是"这一轮对话里新产生的信息"，窗口大了模型会把旧事实重复抽取，语义记忆里全是重复条目；
2. **NONE 哨兵**。闲聊占大多数（"哈哈哈""6"），要求模型"没有事实就输出 NONE"，避免硬抽——把"无事发生"变成一个可判断的显式信号，而不是让模型硬编；
3. **temperature 0.1 + max_tokens 200**。抽取是结构化任务不是创作，低温保稳定，200 token 封顶防跑飞。

这个抽取调用发生在回复已发出之后（`chat.py` 里 `memory.save` 之后），**不在用户等待路径上**——抽得慢一点也不影响体验。

## 用户画像：50 次的节流

画像比事实更进一步：每个用户一份结构化 traits（兴趣、所在地、职业、偏好），存 SQLite `profiles` 表的 JSON 字段。抽取用另一个 prompt，输出 JSON：

```python
# qq_bot/memory/profile.py（节选）
PROFILE_EXTRACT_PROMPT = """从对话中提取用户的特征标签。输出 JSON：{"traits": {"key": "value", ...}}

可提取的信息类型：
- interests: 兴趣爱好
- location: 所在地
- occupation: 职业/专业
- preferences: 偏好
- pets: 宠物
- other: 其他值得记录的信息

只输出 JSON。如果没有新发现，输出空的 traits。"""
```

关键在节流——**每 50 条消息才真正触发一次抽取**：

```python
# qq_bot/memory/profile.py（节选）
async def update_profile(self, user_id, nickname, messages, force=False):
    self._update_counters[user_id] = self._update_counters.get(user_id, 0) + 1
    if not force and self._update_counters[user_id] < 50:
        return          # 计数没到，直接跳过——一次 LLM 调用都不花
    self._update_counters[user_id] = 0
    dialogs_text = "\n".join(
        f"{m['role']}: {m['content'][:200]}" for m in messages[-20:]
    )
    raw = await self.llm.chat(msgs, max_tokens=200, temperature=0.1)
    ...
    if traits:
        await self.store.upsert_profile(user_id, nickname, traits)
```

不节流的后果可以直接算账：活跃群友一天说 200 句，每句跑一次抽取 LLM，一个月 6000 次调用——**画像抽取的成本会超过聊天本身**。50 次的窗口攒够 20 条最近的对话再抽，信息密度高、调用次数降两个数量级。`upsert_profile` 做 traits 合并（新 traits update 进旧 dict），画像只增不减——这是个已知取舍，噪声标签会累积，清理留给以后的管理命令。

## 组装：三层怎么进一次回答

`chat.py` 里一次触发回答前的组装：

```python
# qq_bot/plugins/chat.py（节选）
ctx_msgs = await memory.get_context(chat_key, limit=30)      # 工作记忆
ctx_text = _format_context(ctx_msgs)

mem_text = await memory.recall(text, chat_key)               # 语义记忆（带群过滤）

combined_context = ctx_text
if mem_text:
    combined_context += f"\n[相关记忆]\n{mem_text}"

response = await agent.run(
    text,
    image_urls=image_urls if image_urls else None,
    memory_context=combined_context,
    user_id=user_id,
    group_id=group_id,
)
```

回答之后回写：`memory.save` 存双方消息 → `update_profile`（计数节流）→ `extract_and_remember`（后台抽事实）。一轮对话完成"读三层 → 回答 → 写三层"的闭环。

上下文的经济学是这套设计的隐含主线：**30 条窗口 + 5 条召回 + 画像**，一次回答的上下文成本是可预算的常数；不设记忆的方案要么答非所问，要么把全部历史塞进 prompt——后者 token 成本随时间线性增长，很快就不可持续。

## 待办与展望

下一步想让画像系统接入回复风格——对不同熟悉度的群友用不同的语气说话（画像里有 `interaction_count` 和兴趣标签，素材是现成的）。另一个想做的方向是遗忘机制：语义记忆按时间衰减权重，或对低频召回的记忆做定期归档。做了再记录。

## 面试追问预演

**Q: 为什么三层而不是一个向量库全解决？**
A: 时间粒度（秒/周/长期）和读取方式（顺序窗口/语义相似/按人索引）都不同。全塞一个向量库，闲聊和事实混召，精度稀释；且"最近 30 条"这种查询用向量库反而是绕路。

**Q: 多群记忆怎么隔离？**
A: 每条记忆的 metadata 带 chat_key，召回时 where 过滤。粒度是群级——同群用户共享语义记忆，这是刻意设计（群聊本来就是公共语境）；用户画像才是按 user_id 隔离的。

**Q: 记忆抽取会出错（抽了无关信息/漏抽）怎么办？**
A: 抽取用低温 + 明确的 NONE 哨兵降低硬编；存储是增删接口齐全的 ChromaDB，管理命令可以删。已知取舍是 traits 只增不减，清理机制在待办里。更系统的做法是给记忆加置信度和召回反馈（被引用过的记忆加权），列入计划。

**Q: 工作记忆为什么 SQLite 不用 Redis？**
A: 查询模式是"按会话取最近 N 条"，SQLite 一个复合索引完美覆盖，且要持久化；Redis 做这个还得自己处理持久化和分页。单机部署下 SQLite 是零运维的最优解。

---

系列目录：
- [（一）Agent 架构与工具框架](/2026/08/29/QQ群AI助手开发记录-一-Agent架构与工具框架/)
- [（二）三层安全防御](/2026/08/29/QQ群AI助手开发记录-二-三层安全防御/)
- [（三）三层记忆系统](/2026/08/29/QQ群AI助手开发记录-三-三层记忆系统/)（本篇）
