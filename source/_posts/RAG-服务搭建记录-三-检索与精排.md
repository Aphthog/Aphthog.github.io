---
title: RAG 服务搭建记录（三）：检索与精排
date: 2026-05-15 11:00
categories: [技术笔记]
tags: [RAG, 检索, reranker, 混合检索, 分数融合]
description: 混合检索分数融合、cross-encoder reranker、FP16 推理
---

## 混合检索：双通道并行召回

搜索时走两条独立的通道。假设索引里有 1000 个文档块，查询"确定首句的方法有哪些"：

**稠密通道**：把查询编码成 1024 维向量，在 FAISS HNSW 图里搜索最近邻的 top-100。这个通道捕捉的是语义相似度——即使结果里不包含"确定首句"这几个字，只要语义接近就能被召回。

**稀疏通道**：把查询编码成 65536 维稀疏向量（词汇级别的权重分布），算与所有文档稀疏向量的内积，取 top-100。这个通道做的是关键词匹配——结果里包含"确定""首句""方法"这些词的概率越高，分数就越高。即使语义上不太相关但如果关键词重叠多，也会被召回。

两条通道互补：

- 稠密能搜到"同义改写"的内容（比如"如何识别段落首句"）
- 稀疏能保证包含精确术语的结果不会漏掉
- 两者结合，漏召的概率比单一通道低很多

```python
# 双通道召回
dense_results = self._indexer.search_dense(emb.dense, k * 2)    # FAISS
sparse_results = self._indexer.search_sparse(emb.sparse, k * 2)  # 暴力内积

# 合并候选
all_ids = set(dense_scores.keys()) | set(sparse_scores.keys())
for cid in all_ids:
    d_score = dense_scores.get(cid, 0.0)
    s_score = sparse_scores.get(cid, 0.0)
    combined = self.DENSE_WEIGHT * d_score + self.SPARSE_WEIGHT * s_score
```

### 分数归一化的必要性

稠密距离和稀疏分数的尺度完全不同。FAISS 返回的 L2 距离经过负号反转后大约在 [-2, 0] 范围，而稀疏内积分数可能是 5 到 100+。如果不做归一化直接加权，稀疏分数会完全主导结果，稠密通道等于白跑了。

归一化方式：min-max 归一化，缩放到 [0, 1]。

实际上有一个边界情况需要处理——如果某个通道的所有分数都相等（比如索引只有一条数据，或者所有稀疏分数都一样），min-max 会得到 0/0。代码里对这种情况做了特殊处理，直接把所有分数置为 1.0：

```python
for scores in [dense_scores, sparse_scores]:
    if scores:
        max_val = max(scores.values())
        min_val = min(scores.values())
        if max_val != min_val:
            rng = max_val - min_val
            for cid in scores:
                scores[cid] = (scores[cid] - min_val) / rng
        else:
            # 所有分数相等，保留默认权重
            for cid in scores:
                scores[cid] = 1.0
```

这里还有一个细节：为什么要召回 `k * 2` 个候选？因为 FAISS 返回的前 K 个只是"距离最小的 K 个"，经过归一化和加权融合后，排序可能会变。多召回一些候选，给融合后的排序留出调整空间。

### 权重配比

dense 0.7、sparse 0.3 是实验定下来的配比。bge-m3 的稀疏向量质量很高，0.3 的权重已经能有效提升含关键词的结果。如果场景对精确匹配要求更高（比如代码搜索、术语搜索），可以调到 0.5/0.5 甚至更高。

## Cross-Encoder 精排

### 为什么双编码器不够

双编码器（bi-encoder）把查询和文档分别编码成向量，再算相似度。问题是查询和文档之间**没有交互**——编码查询时看不到文档，编码文档时也看不到查询。两个向量各自独立，信息被压缩成固定长度后再做比较，会丢失细粒度的匹配信号。

Cross-encoder 把查询和文档拼成一对文本一起送入模型，中间层的注意力可以在查询和文档的 token 之间交互，捕捉"文档里的这个词和查询里的这个词是对应关系"这类信号。打分精度明显更高。

代价是速度：bi-encoder 对 N 个文档只需要 1 次查询编码 + N 次文档编码（可缓存），而 cross-encoder 需要 N 次完整的 pair 编码，在量级上慢一个数量级。

### 实践方案

粗召回 + 精排，两阶段策略：

1. 混合检索召回 top-50（bi-encoder 级，速度快）
2. 对 top-5 做 cross-encoder 精排（精度高，但只对少量候选做）

```python
if self._enable_rerank and len(sorted_candidates) > top_k:
    rerank_input = sorted_candidates[:self._rerank_top_k]  # top-5
    reranked = self._rerank(query, rerank_input, top_k)
    # 精排结果插入头部，其余保持原序
    sorted_candidates = reranked + sorted_candidates[len(rerank_input):]
```

这里有一个细节：精排后的 top-5 和未精排的剩余候选拼接，取最终的 top-K。精排只调整了前 5 个的顺序，第 6 名之后的位置不变。

### Reranker 的模型推理

bge-reranker-v2-m3 和 bge-m3 一样基于 XLMRoberta，但做的是**序列分类**：

```python
pairs = [(query, doc_text) for doc_text in candidate_texts]
encoded = self._reranker_tokenizer(
    pairs, padding=True, truncation=True, return_tensors='pt', max_length=512,
)
encoded = {k: v.to(self._reranker_device) for k, v in encoded.items()}

with torch.no_grad():
    outputs = self._reranker_model(**encoded)
    logits = outputs.logits  # (batch, n_labels)

if logits.shape[1] == 1:
    scores = torch.sigmoid(logits.squeeze(-1)).cpu().numpy()
else:
    scores = torch.softmax(logits, dim=1)[:, 1].cpu().numpy()
```

模型的 `max_length=512` 意味着超长的文档会被截断。不过对大多数搜索场景来说，512 个 token 的上下文足以判断相关性。

bge-reranker-v2-m3 是单标签分类器（配置中只有一个 label），输出 1 个 logit。早期犯了个错——假设是二分类输出，用 softmax 取第二类的概率，结果越界了。单 logit 应该用 sigmoid 映射到 (0,1)，含义是"相关性概率"。

FP16 推理的配置：

```python
model = XLMRobertaForSequenceClassification(config)
model.load_state_dict(sd, strict=False)  # 从 safetensors 加载
model = model.half().to(device)          # FP16 + GPU
model.eval()
```

模型的 .half() 把所有权重转为 FP16，显存占用量减半，推理速度也有提升。对于检索排序任务来说，FP16 的精度损失几乎不可察觉。

## 搜索服务

所有的检索逻辑最终通过 service.py 对外暴露，通过 FastAPI 提供 HTTP 接口：

```python
# POST /tenants/{name}/search?q=...&top_k=5
@app.post("/tenants/{name}/search")
async def search_tenant(name: str, request: SearchRequest):
    results = rag_service.search(request.query, tenant=name, top_k=request.top_k)
    return {"results": [r.to_dict() for r in results]}
```

搜索时每次创建一个新的 Retriever 实例（因为要临时加载索引），模型本身是全局复用的：

```python
def search_sync(self, query, tenant, top_k=5):
    embedder = self._get_embedder()        # 复用已加载的模型
    indexer = self._get_indexer(tenant)    # 按租户加载索引
    retriever = Retriever(embedder, indexer, enable_rerank=...)
    return retriever.retrieve_sync(query, top_k=top_k)
```

这样做的好处是不用维护 Retriever 的生命周期，随用随建；坏处是每次搜索都要加载 FAISS 索引文件到内存。实际上索引加载是读文件映射，开销很小（毫秒级）。
