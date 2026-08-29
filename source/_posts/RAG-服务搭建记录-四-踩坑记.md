---
title: RAG 服务搭建记录（四）：踩坑记
date: 2026-05-15 14:00
categories: [技术笔记]
tags: [RAG, debug, segfault, 踩坑, 故障排查]
description: 七个 bug 的排查过程，从 segfault 到分数越界
---

这个项目实际编码时间不算长，但排查各种奇怪问题的时间至少占了一半。这篇文章完整记录遇到的坑和排查思路。

## 坑一：L2 距离当相似度分数用

### 现象

第一次搜索完成后，感觉结果排序不对。"明显最相关的文档"排到了第 4、5 名，而不太相关的反而排前面。但也不是完全不相关——top-5 里的文档确实都和查询有关联。

这种"好像有点相关但排序不对"的现象最迷惑人：如果完全不相关问题反而好找，这种半对半错的状态最容易让人怀疑是模型效果差。

### 排查

加日志把 FAISS 返回的原始距离值打出来：

```
查询 "确定首句的方法有哪些"
候选 A（应该排第一）：距离 0.52
候选 B（应该排第二）：距离 0.78
候选 C（无关）：      距离 0.31  ← 排到了最前面
```

问题清楚了：FAISS 的 HNSW 索引用 L2 距离度量，返回的是**距离**——距离越小表示两个向量越接近。但代码里直接把距离当"相似度分数"排序，取最大值。距离最小的文档（最相似的）反而分数最低，排到末尾。

### 解决

加一个负号把 L2 距离反转，让距离越小分数越高：

```python
# 之前
scores = {cid: -dist for cid, dist in results}  # 等等，就算加负号...

# 实际上原始代码是：
scores = {cid: dist for cid, dist in results}
sorted(scores.items(), key=lambda x: x[1], reverse=True)  # 取最大距离 = 最不相似的排第一
```

修复后：

```python
scores = {cid: -dist for cid, dist in results}  # 距离负号 = 越小越相似分越高
sorted(scores.items(), key=lambda x: x[1], reverse=True)  # 取最大 = 最相似排第一
```

不过有一个微妙之处：FAISS 的 search 方法返回的 top-K 已经是按距离**从小到大**排列的。也就是说召回集合已经是距离最小的 K 个了。负号反转只改变了这 K 个内部的排序顺序，并不会把不在 top-K 里的文档拉进来。所以之前的情况是"召回对了，排序反了"。

更稳妥的做法是：召回 `k * 2` 个候选，然后统一反转分数重新排序——这样既修正排序，又把边缘候选纳入考量。

## 坑二：JSON 结构噪音

### 现象

索引构建完成后，搜一些简单的问题结果却不理想。比如搜"这段话意在说明什么"，返回的结果里混入了不少看起来无关的内容。

### 排查

回头检查索引里的原始文本，发现 chunks 里存的文本是这样的：

```
{"title": "这段话意在说明什么", "options": [{"text": "A. 强调...", "key": "A"}, {"text": "B. 指出...", "key": "B"}], "key": "B", "answer": "B", "knowledge_point": "确定首句"}
```

—— 整个 JSON 字符串被直接传给了嵌入模型。嵌入模型编码时，`"options": [`、`"key":"`、`"knowledge_point":"` 这些字段名和 JSON 语法符号也被当成自然语言编进了向量。整段文本大约 70% 是 JSON 结构，30% 才是实际的语义内容，信号被严重稀释。

之所以出现这个问题，是因为原始导入代码为了省事，把 JSON 序列化后的字符串直接当成文档内容塞进去了。反正模型会"理解"文本，JSON 也是文本嘛——这个想法太天真了。

### 解决

改为只提取纯文本字段拼接：

```python
parts = []
if title := item.get("title"):
    parts.append(title)
for opt in item.get("options", []):
    if text := opt.get("text"):
        parts.append(text)
if analysis := item.get("analysis"):
    parts.append(analysis)
text = " ".join(parts)
```

key、answer、knowledge_point、source 等结构化数据作为 metadata 保存，不参与编码但随搜索结果返回。做了一个 HTTP 导入脚本，每批 50 条通过 API 上传：
```
POST /tenants/{name}/index
{"texts": [...], "metadatas": [...]}
```

清洗后的文本在导入时自动做语义切分，切成 300~1000 字符的 chunk，每个 chunk 携带原始 metadata 用于结果展示和过滤。

## 坑三：sentence-transformers segfault

### 现象

用 sentence-transformers 加载 bge-m3：

```python
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("BAAI/bge-m3")
```

运行到第二次编码时，进程突然消失——没有 traceback、没有异常、没有日志。Windows 的事件查看器里也没有有用信息。直接人间蒸发。

### 排查

这不是 Python 层面的异常——如果是 Python 异常一定能捕获到。整个 Python 解释器被操作系统强制终止，说明是 C 层面的段错误（segfault）。sentence-transformers 内部使用了多线程来加载模型和探测硬件，在某些 Windows 环境下，这些线程在访问 C 扩展的共享资源时会出现竞争条件，触发访问违例。

尝试过的一些方法：
- 升级/降级 sentence-transformers 版本 → 无效
- 设置环境变量控制线程数 → 无效
- 换用不同 Python 版本 → 无效

### 解决

放弃 sentence-transformers，改用 transformers 库直连 XLMRobertaModel：

```python
from transformers import XLMRobertaModel, AutoTokenizer

self._tokenizer = AutoTokenizer.from_pretrained(snapshot_path)
self._base_model = XLMRobertaModel.from_pretrained(snapshot_path)
self._base_model = self._base_model.to(self._device)
self._base_model.eval()

# 手动编码
encoded = self._tokenizer(texts, padding=True, truncation=True, return_tensors='pt', max_length=8192)
encoded = {k: v.to(self._device) for k, v in encoded.items()}
with torch.no_grad():
    outputs = self._base_model(**encoded)
dense_vec = outputs.last_hidden_state[:, 0]
dense_vec = dense_vec / dense_vec.norm(dim=1, keepdim=True).clamp(min=1e-12)
```

代码量从两行变成了约 30 行，但完全规避了 sentence-transformers 的多线程崩溃问题。之后再也没有出现过无故崩溃的情况。

代价是手动处理了一些 sentence-transformers 自动完成的事情：L2 归一化、稀疏线性层的加载、设备管理等。但也正因为自己管理这些，后面迁移到 CUDA 和 FP16 变得更可控了。

## 坑四：Reranker 也 segfault

### 现象

解决了编码器的 segfault 后，加载 reranker（bge-reranker-v2-m3）时又崩了。同样的问题——进程消失，没有错误信息。

### 排查

分析显存和内存占用：

| 组件 | FP32 占用 | FP16 占用 |
|------|----------|----------|
| bge-m3 权重 | ~4.2GB | ~2.1GB |
| bge-reranker-v2-m3 权重 | ~4.2GB | ~2.1GB |
| 总计 | ~8.4GB | ~4.2GB |

RTX 4060 Laptop 有 8GB 显存，FP32 两个模型加起来 8.4GB——超了。但为什么在 CPU 上也崩？CPU 上两个 FP32 模型大约 8.4GB，加上中间激活值，可能突破物理内存限制或者触发了 Windows 的某个进程内存限制。

### 解决

FP16 加载：

```python
model = model.half().to(device)  # 转为 FP16 再送到 GPU
```

两个模型加起来 4.2GB，在 8GB 显存上绰绰有余。同时也加了保护逻辑：如果当前设备是 CPU（没有 GPU 可用），跳过 reranker 加载，不影响主检索流程：

```python
if device == 'cpu':
    logger.warning("CPU 模式下跳过 reranker")
    self._reranker_pipeline = False
    return
```

事后反思，之前尝试的 FlagReranker 库 segfault 很可能也是同样的问题——FP32 超显存，而不是库本身不能工作。

## 坑五：从 CPU 换到 GPU 后 reranker 在 CPU 又崩

### 现象

重启机器后 GPU 驱动需要重新初始化，在 CPU 模式下测试 reranker，结果再次 segfault。

### 排查

这和前一个坑不同——这次是确实没有 GPU 可用，硬要在 CPU 上加载。CPU 上加载 2GB+ 的模型在 Windows 下可能遇到内存分配的问题。在 Linux 上同样的操作是正常的，怀疑是 Windows 的内存分配策略和某些 C 扩展的兼容性问题。

### 解决

GPU 驱动加载完成后（RTX 4060 可用），一切正常。最终结论：
- CPU 模式跳过 reranker（避免崩溃）
- GPU 模式用 FP16 加载 reranker（正常运行）
- 模型的设备选择和嵌入器一致（都是 CUDA 或都是 CPU）

## 坑六：transformers 新版联网检查

### 现象

bge-m3 和 reranker 明明已经在 HuggingFace 缓存目录里了，但 `from_pretrained` 还是报错——连接 `hf-mirror.com` 失败。

```
requests.exceptions.ProxyError: Cannot connect to proxy.
  Connecting to hf-mirror.com:443 failed
```

### 排查

报错堆栈显示，问题出在 transformers 的 `_patch_mistral_regex` 这个函数：

```python
# transformers/tokenization_utils_base.py:2442
_is_local or (not _is_local and is_base_mistral(pretrained_model_name_or_path))
```

这个函数在 `from_pretrained` 中被调用，它先检查路径是不是本地路径。如果传的是模型名（如 `"BAAI/bge-m3"`），它会调用 `model_info()` API 去 HuggingFace 服务器查询模型信息，确认是不是 Mistral 模型。即使传了 `local_files_only=True` 也绕不过这个检查——因为它发生得更早，在 `local_files_only` 逻辑被执行之前。

### 解决

改用本地缓存快照路径直接加载：

```python
cache_dir = os.environ.get('TRANSFORMERS_CACHE')
model_cache = os.path.join(cache_dir, 'models--BAAI--bge-m3')
snaps = os.path.join(model_cache, 'snapshots')
snapshot_path = next(
    os.path.join(snaps, d) for d in os.listdir(snaps)
    if os.path.isdir(os.path.join(snaps, d))
)

self._tokenizer = AutoTokenizer.from_pretrained(snapshot_path)
self._base_model = XLMRobertaModel.from_pretrained(snapshot_path)
```

由于传的是本地路径（以 `E:\\` 开头），`_is_local` 为 True，`model_info()` 调用被跳过，完全离线加载。而且速度更快——省掉了网络请求和模型信息解析的开销。

## 坑七：Reranker 分数计算

### 现象

reranker 第一次推理时报 `IndexError: index 1 is out of bounds for dimension 1 with size 1`。

### 排查

代码原来是这样写的：

```python
logits = outputs.logits  # 假设 shape 是 (batch, 2)
scores = torch.softmax(logits, dim=1)[:, 1].cpu().numpy()
```

假设模型输出两个 logit（不相关、相关），用 softmax 归一化后取"相关"类的概率。但 bge-reranker-v2-m3 的配置文件里只有一个 label：

```json
{
  "id2label": {"0": "LABEL_0"},
  "label2id": {"LABEL_0": 0}
}
```

说明是单标签分类，输出 shape 是 `(batch, 1)` 而不是 `(batch, 2)`。`[:, 1]` 自然就越界了。

### 解决

根据输出维度动态选择分数计算方式：

```python
if logits.shape[1] == 1:
    # 单标签：sigmoid 映射到 (0, 1)
    scores = torch.sigmoid(logits.squeeze(-1)).cpu().numpy()
else:
    # 二分类：softmax 取正类概率
    scores = torch.softmax(logits, dim=1)[:, 1].cpu().numpy()
```

## 总结

| 坑 | 根因 | 修复 |
|----|------|------|
| 排序反了 | L2 距离直接当分数 | 负号反转 |
| 搜索噪音 | JSON 结构混入编码 | 只传纯文本 |
| sentence-transformers segfault | 多线程 C 级崩溃 | transformers 直连 |
| reranker segfault (GPU) | FP32 超显存 | FP16 加载 |
| reranker segfault (CPU) | Windows 内存分配问题 | CPU 模式跳过 |
| 模型加载失败 | transformers 联网检查 | 本地 snapshot 路径 |
| reranker 分数越界 | 假设二分类输出 | sigmoid 适配单 label |

几个教训：

1. **不要假设库的行为**——sentence-transformers 在 Linux 上很好，在 Windows 上会崩。不知道的事情，需要提前验证。
2. **注意数据类型的内存占用**——FP32 到 FP16 不止是精度问题，可能直接决定程序能不能跑。
3. **不要信"名字叫距离就不是分数"这种直觉**——API 的返回值语义一定要读文档确认。
4. **国产网络环境下，离线加载永远比在线加载靠谱**——用本地路径，不依赖镜像。
