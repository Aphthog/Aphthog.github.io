---
title: QQ 群 AI 助手开发记录（一）：Agent 架构与工具框架
date: 2026-08-29 13:00
categories: [技术笔记]
tags: [Python, Agent, NoneBot2, 项目]
description: 系列第 1 篇：从脚本式 V1 到 Agent V2 的重构——单循环替代五阶段设计、@tool 注册框架、并行执行器、LLM 网关与搜索降级
---

年初给自己加的 QQ 群写了一个 AI 助手，断断续续做到现在。中间经历了一次比较大的重构——从"关键词触发 + 手写工具字典"的脚本式 V1，重构成现在的 Agent 架构 V2。这个系列三篇文章记录现在的架构长什么样、为什么这么设计，以及重构路上踩的坑。这一篇讲骨架：Agent 循环和工具框架。

项目地址：[github.com/Aphthog/QQ-bot](https://github.com/Aphthog/QQ-bot)。

## 整体架构

技术栈：NoneBot2 + OneBot V11 协议接入，GLM 做大脑（原生 tool calling），SQLite 存会话，ChromaDB 存语义记忆。整个 `qq_bot` 包按职责分层：

```
bot.py              # 装配层：构建记忆栈、System Prompt、AgentLoop，注入插件
qq_bot/
├── plugins/        # NoneBot2 事件接入：触发规则、上下文组装、回复发送
├── access/         # 准入控制：superuser、封禁、滑动窗口限流
├── security/       # 输入侧注入拦截、URL/SSRF 校验
├── agent/          # AgentLoop：统一的工具调用循环
├── tools/          # @tool 装饰器注册框架 + 并行执行器
├── llm/            # LLM 网关：Provider Protocol + GLM 实现
├── memory/         # 三层记忆：SQLite 会话 + ChromaDB 语义 + 用户画像
└── services/       # 网页爬虫等业务服务
```

一条消息的完整链路（群聊）：

```
QQ 消息 → preprocessor（注入拦截/长度限制，见系列第二篇）
       → chat.py（@bot 触发判断 → 限流 → 拉上下文 → 语义召回）
       → AgentLoop.run（LLM ↔ 工具循环，最多 5 轮）
       → memory.save + 画像更新 + 事实抽取（见系列第三篇）
       → 回复发送
```

装配在 `bot.py` 里手工完成：构建 MemoryStore/VectorStore/ProfileManager/MemoryManager/AccessGuard，拼 System Prompt，new 一个 AgentLoop，然后在 `load_plugins()` **之后**把单例塞进 chat 插件的模块变量——顺序是个坑：`load_plugins` 会 import 插件模块，注入必须发生在那之后，不然插件拿到的是 None。

## 从五阶段设计简化成一个循环

V2 动工前我画过一张"标准 Agent 架构图"：Router 做意图分类，Planner 把任务分解成带依赖的步骤 JSON，Executor 按依赖并行执行，Reflector 拿着结果裁决 done/retry/replan，最后 Builder 合成回复。这套五件套我真实现了，每个组件都有单测。

然后上线前看了一眼，把它们全从生产路径上拿掉了。现在的核心循环长这样：

```python
# qq_bot/agent/core.py — AgentLoop._run_unified_loop（节选）
max_rounds = config.AGENT_MAX_PLAN_STEPS   # 5
for _ in range(max_rounds):
    result = await self.llm.chat_with_tools(
        messages, tools=tools, max_tokens=config.MAX_RESPONSE_TOKENS,
        enable_thinking=config.TASK_THINKING,
    )

    content = result.get("content")
    tool_calls = result.get("tool_calls")

    # LLM returned text content — check it's not a leaked tool call
    if content and tool_calls is None:
        stripped = content.strip()
        if stripped.startswith("<tool_call>") or stripped.startswith("{"):
            # Model emitted tool call as text — treat as tool call, don't show to user
            tool_calls = _parse_text_tool_call(stripped)
            content = None
        else:
            if _is_search_failure(stripped):
                fallback = await _fallback_web_search(text)
                # ...成功则把搜索结果塞回 messages，continue 续跑
                return content if not fallback else ...
            return content

    # Execute locally-registered tools (web_fetch, run_code)
    local_calls = [tc for tc in tool_calls if tc["name"] in ToolRegistry._tools]
    if not local_calls:
        continue  # LLM used built-in web_search, loop for final answer

    results = await ToolRegistry.execute_all(local_calls, ctx)
    # ...把 assistant 的 tool_calls 和执行结果 append 回 messages，继续下一轮
```

为什么砍掉五阶段？**群聊场景 90% 的请求是闲聊和单步查询**。为一句"今天天气怎样"走 Router → Planner → Executor → Reflector → Builder 全流程，意味着 3~5 次额外的 LLM 调用——延迟翻几倍，token 费用翻几倍，每个环节还各挂一个需要兜底的失败点。原生 tool calling 本身就是 ReAct：模型自己决定调不调工具、调几个、要不要续跑，**单循环 + 工具回填**就够了。五阶段只在真正的多步复杂任务上有收益，而那种请求在群里极少出现。

这算是我在这个项目里学到的最贵的一课：**架构服务于场景，不是服务于架构图**。Planner 那套代码还留在 `agent/` 里（有测试），哪天做需要确定性多步执行的场景可以捡回来。

循环里还有几个小防线：`COMMANDS` 前缀命令（/ping、/status 等）走快速路径不进 LLM；`_is_garbage` 把空消息和纯标点过滤掉，省 API 调用；5 轮打满返回固定兜底话术"想了半天还是没结果，换个问法试试？"。

### 泄漏的工具调用：_parse_text_tool_call

有些模型偶尔会把工具调用当正文吐出来，输出一段 `<tool_call>{...}</tool_call>` 文本。不兜住的话用户会直接看到一堆 JSON。解析函数很短：

```python
# qq_bot/agent/core.py
def _parse_text_tool_call(text: str) -> list[dict[str, Any]] | None:
    """Parse tool calls that the model emitted as text instead of native tool_calls."""
    # Try <tool_call>...</tool_call> wrapper first
    match = re.search(r"<tool_call>\s*(.*?)\s*</tool_call>", text, re.DOTALL)
    if match:
        text = match.group(1)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict) and "name" in data:
        return [{"id": "call_text_0", "name": data["name"], "arguments": data.get("arguments", {})}]
    ...
```

主循环检测到正文以 `<tool_call>` 或 `{` 开头就尝试解析回来，转成正常的 tool_calls 走执行流程。这一小段代码消灭了一整类"看不懂的回复"。

## @tool 装饰器：告别手写双字典

V1 注册一个工具要维护两个字典：`TOOL_SCHEMAS` 手写 JSON schema，`TOOL_HANDLERS` 放函数——改一个参数要同步改两处，漏一处就是线上事故。V2 换成装饰器注册：

```python
# qq_bot/tools/core.py
@tool(
    name="web_fetch",
    description="抓取网页正文内容。适用：打开搜索结果链接、读取文章全文。",
    params={"url": (str, "网页URL，必须以 https:// 开头")},
    category="core",
)
async def web_fetch(url: str) -> str:
    ...
```

schema 由 `ToolInfo.to_openai_schema()` 统一生成。这里说明一个精确的实现细节（面试被问过）：schema 的**参数类型来自 `params` 字典里显式声明的类型**，**required 列表则用 `inspect.signature` 推断**——签名里没有默认值的参数即 required：

```python
# qq_bot/tools/registry.py（节选）
def to_openai_schema(self) -> dict[str, Any]:
    sig = inspect.signature(self.handler)
    properties: dict[str, Any] = {}
    required: list[str] = []
    for pname, (ptype, pdesc) in self.params.items():
        json_type = "string" if ptype is str else "number" if ptype in (int, float) else "string"
        properties[pname] = {"type": json_type, "description": pdesc}
        param = sig.parameters.get(pname)
        if param is not None and param.default is inspect.Parameter.empty:
            required.append(pname)
    return {"type": "function", "function": {...}}
```

之所以不从 Python 类型注解全自动生成，是因为注解承载不了"参数描述"和可选性这些 schema 必需的信息——`params` 字典是"声明一次、描述齐全"的折中。工具写完函数、套个装饰器，注册和 schema 一次搞定。

注册时查重（重名直接 `raise ValueError`），`category="admin"` 的工具不会出现在发给模型的 schema 里（`get_all_schemas(for_user=True)` 过滤）——**管理员工具对模型不可见，是比"告诉模型别用"强得多的限制**。

## 执行器：错误变成工具结果，而不是让循环崩掉

工具执行层是统一的并行执行器：

```python
# qq_bot/tools/registry.py（节选）
@classmethod
async def execute(cls, name, arguments, ctx) -> str:
    ...
    try:
        result = await asyncio.wait_for(
            info.handler(**{k: v for k, v in merged.items() if k in info.params}),
            timeout=info.timeout or config.AGENT_TOOL_TIMEOUT,
        )
        return str(result) if result is not None else ""
    except asyncio.TimeoutError:
        return f"[工具 '{name}' 执行超时]"
    except Exception as e:
        return f"[工具 '{name}' 执行异常: {type(e).__name__}]"

# execute_all: asyncio.gather 并行跑所有 tool_calls
```

两个设计决定：每个工具包一层 `asyncio.wait_for` 超时（默认 15 秒）；超时和异常**都不抛出**，而是转成 `[工具 'x' 执行超时]` 这种字符串喂回给模型，让它自己决定换工具还是放弃。**把错误变成工具结果继续推理，而不是让整个循环崩掉**，这是 Agent 稳定性的一个关键技巧——模型拿到"超时"的信息后，往往会主动换一个参数重试或改用别的工具。

## LLM 网关与搜索降级

LLM 调用收敛在一个网关类里，GLM 实现统一拼 payload：

```python
# qq_bot/llm/glm_4v.py（节选）
if enable_search:
    all_tools.append({"type": "web_search", "web_search": {"enable": True}})
if all_tools:
    payload["tools"] = all_tools
    payload["tool_choice"] = tool_choice
```

GLM 内置的 `web_search` 一行配置就能开，模型自己决定什么时候搜。`thinking` 参数做成开关（`{"type": "enabled"}` / `{"type": "disabled"}`），闲聊关思考省 token、工具任务开思考提升准确率。

但上线后发现内置搜索时不时超时，然后模型会在正文里说"搜索超时，我无法回答"。观察一阵规律后加了个有点丑但管用的降级：检测回复里的失败话术，自动换 DuckDuckGo 的 HTML 版重搜一次：

```python
# qq_bot/agent/core.py
SEARCH_FAILURE_MARKERS = [
    "搜索工具超时", "搜索超时", "搜索失败", "无法搜索",
    "search timeout", "search failed",
]

async def _fallback_web_search(query: str) -> str | None:
    """Direct DuckDuckGo HTML search when Zhipu's built-in search fails."""
    ...
    resp = await client.get("https://html.duckduckgo.com/html/", params={"q": query}, ...)
    soup = BeautifulSoup(resp.text, "html.parser")
    results = [el.get_text(strip=True) for el in soup.select(".result__snippet")]
    return "\n".join(results[:5]) if results else None
```

靠话术匹配做故障检测确实不优雅，正经做法是服务商在响应里给结构化错误码——但等不到那一天，群友已经先被"我无法搜索"气走了。降级结果以 `[网络搜索结果]` 前缀塞回对话继续跑，用户无感。连降级都挂了才回兜底话术。

## 面试追问预演

**Q: 你的 Agent 循环和 ReAct 是什么关系？**
A: ReAct 的本质是"推理-行动-观察"交替，原生 tool calling 让模型在一轮里自己决定行动（tool_calls），我负责执行并回填结果（观察），循环直到模型给出纯文本回答。我的 `_run_unified_loop` 就是一个 ReAct 循环的工程化实现，只是"推理"由模型内置完成。

**Q: 为什么限制 5 轮？**
A: 防失控——模型陷入"调工具-失败-再调"循环时烧钱且用户无感等待。5 轮足够覆盖"搜索→打开网页→计算"这类复合任务，打满给兜底话术。

**Q: 工具执行失败怎么处理？**
A: 不抛异常中断循环，而是把错误字符串作为工具结果回填，让模型自己决定重试、换工具或放弃。这是把错误处理从"控制流"挪到"信息流"。

**Q: 工具 schema 是怎么生成的？**
A: @tool 装饰器注册，参数类型从 params 字典显式声明，required 用 inspect.signature 推断（无默认值即必填）。没做成"纯类型注解自动生成"是因为注解承载不了参数描述信息。

---

系列目录：
- [（一）Agent 架构与工具框架](/2026/08/29/QQ群AI助手开发记录-一-Agent架构与工具框架/)（本篇）
- [（二）三层安全防御](/2026/08/29/QQ群AI助手开发记录-二-三层安全防御/)
- [（三）三层记忆系统](/2026/08/29/QQ群AI助手开发记录-三-三层记忆系统/)
