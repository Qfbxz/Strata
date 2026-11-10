# E3 小模型路由：选型报告

> HARNESS_ROADMAP.md 阶段三 E3。目标：serve 跑第二个小模型实例，标题/摘要等小任务路由到它，不消耗主模型 32K 窗口。

## 约束

| 维度 | 值 |
|---|---|
| 机器 | M3 Max, 128 GB unified, Metal |
| 主模型 | DS V4.1 Flash IST-DAS-2.00bpw IQ3_S ~12 GB VRAM |
| 小模型 VRAM 预算 | ≤ 2 GB（不挤主模型） |
| 语言 | 中文 + 英文 双语 |
| 引擎 | Strata (llama.cpp 3cf03257)，支持 LLM_ARCH_QWEN2 |
| 用途 | 会话标题（输入 < 2K → 输出 < 50 tok）、短摘要（输入 < 8K → 输出 < 500 tok） |

## 候选评估

| 模型 | 参数量 | Q8_0 大小 | VRAM @32K | 中文质量 | 英文质量 | 标题/摘要适配 | 许可 |
|---|---|---|---|---|---|---|---|
| **Qwen2.5-0.5B-Instruct** | 0.5 B | ~530 MB | ~600 MB | ★★★（原生中文训练） | ★★ | ★★★（短文本生成是其强项） | Apache 2.0 |
| **Qwen2.5-1.5B-Instruct** | 1.5 B | ~1.6 GB | ~1.8 GB | ★★★ | ★★★ | ★★★ | Apache 2.0 |
| SmolLM2-1.7B-Instruct | 1.7 B | ~1.8 GB | ~2.0 GB | ★（无中文训练） | ★★★ | ★★ | Apache 2.0 |
| Llama-3.2-1B-Instruct | 1.3 B | ~1.3 GB | ~1.5 GB | ★★ | ★★★ | ★★ | Llama 3.2 Community |
| Llama-3.2-3B-Instruct | 3.2 B | ~3.4 GB | ~3.7 GB | ★★ | ★★★ | ★★★ | Llama 3.2 Community |
| Gemma-2-2b-it | 2.6 B | ~2.7 GB | ~3.0 GB | ★★ | ★★★ | ★★ | Gemma Terms |
| Phi-3.5-mini-instruct | 3.8 B | ~4.0 GB | ~4.3 GB | ★★ | ★★★ | ★★ | MIT |

## 推荐

**首选：Qwen2.5-0.5B-Instruct（Q8_0）**

理由：
1. **VRAM 占用 ~600 MB**——DS 2.00bpw 之外的增加量可忽略（128 GB 机器余量充足；16 GB 机器也放得下）
2. **中文原生**——Qwen 系列的中文能力在所有同尺寸模型中最强（用户双语工作流核心需求）
3. **标题/摘要够用**——短文本 → 短标签是 0.5B 模型的甜区，>1B 的收益递减
4. **Apache 2.0**——无许可顾虑
5. **llama.cpp Qwen2 架构**——Strata 引擎直接支持，无需额外适配

**备选：Qwen2.5-1.5B-Instruct（Q8_0）**——如果 0.5B 的标题质量不够（摘要任务更复杂时），切到 1.5B，VRAM 增加 ~1.2 GB，仍可接受。

**不推荐**：
- SmolLM2：无中文训练，双语场景不合格
- Llama-3.2：许可有使用限制，中文弱于 Qwen
- Gemma-2/Phi-3.5：>2 GB VRAM，收益不如 Qwen

## 下载

```bash
# Qwen2.5-0.5B-Instruct Q8_0 GGUF (llama.cpp 格式)
huggingface-cli download Qwen/Qwen2.5-0.5B-Instruct-GGUF \
  qwen2.5-0.5b-instruct-q8_0.gguf --local-dir ~/.strata/small-model

# 或从 ModelScope（国内快）
# modelscope download Qwen/Qwen2.5-0.5B-Instruct-GGUF ...
```

## 实现草案（serve 侧最小改动）

1. `serve/server.py` 新增 `--small-model <path>` 参数（可选，默认无）
2. 有此参数时，serve 在同一引擎进程里加载第二个轻量实例（或按需加载：首次标题请求时加载，空闲 5 分钟后卸载）
3. `POST /v1/chat/completions` 请求体里 `"model": "small"` 路由到小模型实例
4. Harness 的 title 生成 prompt 加 `"model": "small"` 标记
5. `strata connect --check` 增加 E3 检查项：发一个标题请求到小模型路由，验证返回非空

## 不做的

- 不在同进程跑两个大模型（VRAM 竞争）
- 不改 DSH harness 的 title 逻辑（上游的事，等 WP 系列落地后统一接）
- 不加 UI 开关（小模型路由是 serve 内部优化，对用户透明）
