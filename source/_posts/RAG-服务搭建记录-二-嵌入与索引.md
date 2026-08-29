---
title: RAG 服务搭建记录（二）：嵌入与索引
date: 2026-05-15 10:00
categories: [技术笔记]
tags: [RAG, 嵌入, FAISS, 索引, bge-m3]
description: bge-m3 双通道编码、FAISS HNSW 构建、多租户持久化
---

## 从句子嵌入到双通道编码

bge-m3 基于 XLMRoberta，这是一个跨语言的 transformer 模型。标准的嵌入做法是取最后一层 CLS token 的输出作为句子的表示向量，bge-m3 在此基础上加了一条稀疏编码的支路，形成双通道输出。

### 稠密向量

取 XLMRoberta 最后一层输出的 CLS token 向量（维度 1024），做 L2 归一化。这是嵌入模型的"标准做法"——把整个句子的语义压缩到一个固定长度的稠密向量里。两个句子语义越接近，它们的向量在空间中的距离就越近。

代码实现很直接：

```python
outputs = self._base_model(**encoded)           # XLMRoberta 前向
dense_vec = outputs.last_hidden_state[:, 0]     # CLS token
dense_vec = dense_vec / dense_vec.norm(dim=1, keepdim=True).clamp(min=1e-12)
```

`clamp(min=1e-12)` 防止除零——虽然实际中几乎不会发生，但安全处理是个好习惯。

### 稀疏向量

bge-m3 在 transformer 之上加了一个 `sparse_linear` 线性层，作用是把每个 token 位置的隐层向量（1024 维）映射成一个标量分数，代表这个 token 对句子语义的重要程度。

具体做法是每个 token 的隐层经过 `nn.Linear(1024, 1)` 变成 1 个分数，经过 ReLU 激活去掉负值（负的贡献度没有意义），然后对同一个 token ID（同一个词）的所有出现位置取 max-pool：

```python
sparse_scores = torch.relu(self._sparse_linear(hidden).squeeze(-1))
# sparse_scores: (batch, seq_len) — 每个 token 一个分数
# input_ids:    (batch, seq_len) — 每个位置的 token ID

for b in range(sparse_scores.shape[0]):
    row_scores = sparse_scores[b]
    row_ids = input_ids[b]
    mask = row_scores > 0
    if mask.any():
        tok_ids = row_ids[mask].tolist()
        weights = row_scores[mask].tolist()
        # max-pool 去重
        vec = {}
        for tid, w in zip(tok_ids, weights):
            if w > vec.get(tid, 0):
                vec[tid] = w
```

最终得到的稀疏向量维度是词汇表大小（bge-m3 的词表是 250002，但源码里 sparse_dim 设了 65536，这是因为做了 hash 压缩），其中只有少数位置有非零值。

两种向量的性质对比：

| 特性 | 稠密向量 | 稀疏向量 |
|------|---------|---------|
| 维度 | 1024 | 65536 |
| 非零元素 | 全部 1024 个 | 通常 20~200 个 |
| 空间占用 | 4KB | ~1KB（稀疏存储） |
| 编码内容 | 整体语义 | 关键词权重分布 |
| 相似度含义 | 语义接近程度 | 词汇重叠程度 |
| 检索方式 | FAISS HNSW 近似搜索 | 暴力内积精确搜索 |

### sparse_linear 权重的加载

sparse_linear 是 bge-m3 专有的结构，标准的 XLMRoberta 没有这个头。它的权重存储在模型的 `sparse_linear.pt` 文件中，需要手动从 HuggingFace 缓存中找到并加载：

```python
hidden_size = self._base_model.config.hidden_size  # 1024
self._sparse_linear = nn.Linear(hidden_size, 1)

sl_path = os.path.join(snapshot_path, 'sparse_linear.pt')
sd = torch.load(sl_path, map_location='cpu', weights_only=True)
self._sparse_linear.weight.data = sd['weight'].float()
if 'bias' in sd:
    self._sparse_linear.bias.data = sd['bias'].float()
```

`weights_only=True` 是 PyTorch 的安全建议——防止 pickle 执行的漏洞。

## FAISS 索引构建

### HNSW 图索引

IndexHNSWFlat 的参数配置：

```python
dense_index = faiss.IndexHNSWFlat(d, 32)      # d=1024, M=32
dense_index.hnsw.efConstruction = 200          # 建图搜索宽度
dense_index.hnsw.efSearch = 512               # 搜索宽度
```

M=32 意味着每个节点最多连接 32 个邻居。M 越大图连接越密、召回越高，但内存占用和建图时间也增加。

efConstruction=200 在建图时控制候选邻居的搜索池大小。值越大建的图质量越高（更接近真实的 KNN 图），但建图时间线性增长。对于几千到几万条数据，200 是一个合理的值。

efSearch=512 在搜索时控制候选集大小。值越大搜索越精确，但单次查询时间增加。

### L2 归一化

FAISS 的 IndexHNSWFlat 用 L2 距离做度量。如果向量做过 L2 归一化（每个向量的模长为 1），L2 距离和余弦相似度是等价的。所以代码里每次添加向量和查询向量之前都做归一化：

```python
faiss.normalize_L2(emb.dense)       # 添加索引前
dense_index.add(emb.dense)

# 搜索时
faiss.normalize_L2(query_dense)     # 查询前
distances, indices = dense_index.search(query_dense, k)
```

### 稀疏矩阵的存储

稀疏向量用 scipy.sparse.csr_matrix 存储。CSR（Compressed Sparse Row）是稀疏矩阵的标准存储格式，只存非零元素的值、列索引和行偏移，适合维度极高但极稀疏的场景（65536 维中只有几十个非零值）。

```python
from scipy.sparse import save_npz, load_npz
save_npz(sparse_path, sparse_matrix)
# 加载时
sparse_matrix = load_npz(sparse_path)
```

搜索时用矩阵乘法算查询稀疏向量和所有文档稀疏向量的内积：

```python
scores = query_sparse @ self._sparse_matrix.T
# query_sparse:    (1, 65536)  的 CSR 矩阵
# self._sparse_matrix: (n_chunks, 65536) 的 CSR 矩阵
# 结果: (1, n_chunks) — 每个文档的稀疏相似度分数
```

CSR 矩阵乘法在底层自动跳过零元素，效率很高。

## 多租户和索引持久化

每个租户的数据独立存储。以"租户名"作为目录名：

```
data/rag_indexes/
├── demo/
│   ├── dense.faiss      # FAISS 索引
│   ├── sparse.npz       # 稀疏矩阵
│   ├── chunks.jsonl     # 文本块数据
│   └── .lock            # 文件锁
└── qa-main/
    └── ...
```

chunks.jsonl 每行是一个 JSON 对象，包含文本内容和自定义 metadata，搜索时返回给调用方：

```json
{"text": "...", "metadata": {"key": "B", "knowledge_point": "确定首句"}, "chunk_index": 0}
```

使用 filelock 做进程间互斥，防止多个进程同时写一个租户的索引：

```python
from filelock import FileLock
lock = FileLock(os.path.join(tenant_dir, '.lock'), timeout=5)
with lock:
    # 构建/更新索引
```

索引构建后持久化到磁盘，下次服务启动不需要重新编码，直接从磁盘加载：

```python
def load(self):
    self._dense_index = faiss.read_index(self._dense_path)
    self._sparse_matrix = load_npz(self._sparse_path)
    self._chunks = self._read_chunks()
```

实际上线时，预热时间是秒级的——读三个文件、加载到内存而已。
