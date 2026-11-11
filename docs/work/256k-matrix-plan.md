# 256K 档优化实验矩阵（设计稿，未执行）

日期：2026-11-11。机器：Apple M3 Max，128 GB，macOS。引擎：0.1.59-macos-arm64-metal。
模型：Qwen3.8-Flash-Next IQ3_S（GSQ-RCO，两分片）。目标：prefill ≥1500 tok/s、decode ≥100 tok/s。
裁决：上下文 256K（262144）是底线，可从 512K 让步换速度。本文只设计，不执行。

## 0. 事实基础（每条带出处）

1. **Metal 只有 int8 KV 存储。** `metal/src/engine/window.cpp:2014`（bind_qsa）硬编码
   `kv_int8 = true; kv_q4 = false; kv_hybrid = false`。`--kv fp16/q4_0/k8v4` 不改变 Metal 的 KV 存储
   （q4_0/k8v4 在 Metal 无 kernel）。白天 kv 量化 A/B（int8 51.4 / k8v4 52.7 / q4_0 51.6 对 baseline
   56-64）与 KV 精度无关，按噪声或次要路径效应处理。**矩阵里不再设 kv 量化臂。**（源码确认；白天
   数据的因果归因未测，标注为静态分析。）
2. **KV 大小（Metal，int8 + fp16 scale）。** 每 cell 每层：K 512 B + V 512 B + scales 32 B
   （window.cpp:780-783），索引器 pooled 512 B / 4 cell（window.cpp:786，`pooled_`）。QSA 层 12 个
   （GGUF `full_attention_interval = 4`，48 层）。合计 ≈ 14,208 B/token。
   锚点：`--batch 2` 日志 "each slot 1.99 GB @131072 ctx" = KV 1.86 GB + GDN state 0.12 GB，吻合。
3. **上下文头数（GGUF 元数据，实测读取）。** 24 query 头 / 2 KV 头，K/V 各 256 维；512 专家选 10；
   训练上下文 262144；`rope.freq_base 1e7`，无 scaling 键。**当前 512K 是训练外推；256K 在训练内**，
   这本身是 256K 档的质量理由。
4. **探针实测 @256K（2026-11-11，token_chain）。** 单流 35.8 tok/s（27.97 ms/token，带宽
   191.7/400 GB/s = 48%）；ntok8 窗口 64.8 tok/s；+graph 66.3。每 8 行窗口字节：gdn proj 1551 MB +
   hc 1279 MB + lm head 521 MB + qsa proj 477 MB（dense 合计 3828 MB，71%）+ experts 982 MB +
   qsa attn 50 MB。**结论：decode 的主瓶颈是 dense 投影的字节，不是注意力，不是 experts。**
5. **decode 100 的主通路 = dense 投影 Q4 化。** `gemv.metal` / `dense_mm.metal` 已有 Q4_0/IQ4_NL
   dense kernel；改档在 pack 生成侧（`tools/strata_pack.py` 组 dense.bin，IQ4NL 码本在
   canonical_xcheck 的 KV_IQ4NL）。这是 pack 变体，不是引擎 flag。
6. **expert-cache 单位。** `--expert-cache N` = N × 最大 blob（IQ3_S 实测 2.66 MB）的字节预算；
   IQ3_S 共 24576 blob（48 层 × 512），均值 ≈2.1 MB。当前 `--expert-cache 64` 实得 **82 槽 /
   0.16 GiB**（启动日志）。`--expert-cache-per-layer` 把预算均分到 48 层：3072 → 64/层；CUDA 实测
   64/层命中 70.4%，共享计数策略 256 槽只有 2.97%（engine help 引 bench 数据）。命中臂四舍五入
   不同但质量等价（bench/results/2026-09-27-cache-parity：top-1 95-98%，ppl 差 ±0.005）。
7. **prefill chunk 旋钮是环境变量。** Metal 从 `STRATA_METAL_PROMPT_CHUNK` 读，resident 默认
   2048、streaming 大 Mac（≥96 GB）默认 4096（window.cpp:2708-2715）。当前 config 有
   `STRATA_METAL_STREAM=0` → wrapped 模式 → 默认 2048（日志 "chunks of 2048 rows"）。
   streaming 实测：1024/2048/4096 → 700/920/1100 tok/s（M5 Max UD-Q5）；resident 4096 vs 2048
   只有 +2-4%（Q2_0）。wrapped 介于两者之间，**未测**。
8. **缓冲借用。** 槽太少时 prompt 路径自备缓冲（当前日志 "the prompt path allocates its own buffers
   (too few cache slots to borrow)"）；槽多了才能借、`--prefill auto` 才能把 chunk 抬上去。
   `--prefill auto:16384` 把 auto 上限从 8192 抬到 16384。Metal 上 chunk 的最终裁定以日志
   "prompt kernels … for chunks of N rows" 为准（`--prefill` 与 env 的优先级属静态分析，未测）。
9. **`STRATA_METAL_PROMPT_QSA=flash`。** 默认跟随 COOP_K4 探针（window.cpp:2726
   `p.flash = eq ? eq=="flash" : p.k4`）；M3 Max 探针不过 → 现在跑旧 kernel。env 可强开，
   **未测，正确性未知**。同族 `STRATA_METAL_PROMPT_EXPERTS=v3`（M5 布局）在 M1 Max 上会挂，M3 未测。
10. **`--kv-grow` 前置条件（generate.cpp:6659-6672）。** 单卡 + 有 expert-profile + KV 全 VRAM +
    无 kv-resident / resident-cpu-experts / batch / vram-elastic / peer + expert_cache ≠ 0 +
    VMM 可用。不满足时启动日志打印 "--kv-grow is off (...)"。Metal 上 VMM 是否可用**未确认**
    （静态分析）；该臂零风险，开了就有，不开打印原因。
11. **内存现状。** 启动 footprint ~65 GiB（memory guard 行：limit 128.0，current 65.2，available
    62.8）；分片 1 = 54.8 GB（51.05 GiB，experts ≈50 GiB + dense + embedding）、分片 2 = 28.8 GB
    PLE 表（--ple-io 默认 direct，不进页缓存）；MTP 层 0.89 GB；vision GPU ≈1.18 GB；HC Q8_0
    拷贝 680 MB。resident arena 有 70% RAM 上限的教训（MAC.md：超限会压缩+watchdog panic）。
12. **测速工具。** `strata bench run`（strata_cli/bench_standard.py）走标准协议，性能相含
    short / prompt-4k / prompt-16k ×3，读引擎 timings，写 strata-standard-benchmark 结果。

## 1. 内存账（256K 对 512K）

KV/会话按事实 2 的公式（262,272 / 524,416 cells，日志格式）：

| 项 | 512K（现配置） | 256K（目标档） | 差 |
| --- | ---: | ---: | ---: |
| KV（12 QSA 层，int8+pooled） | 7.45 GB | 3.73 GB | **-3.73 GB** |
| GDN state（36 层，不随上下文） | 0.12 GB | 0.12 GB | 0 |
| rope 表（≈256 B/token） | 0.13 GB | 0.07 GB | -0.07 GB |
| 权重+HC 拷贝+MTP+vision+缓冲 | ≈57 GB | ≈57 GB | 0 |
| 合计（近似） | ≈65 GB | ≈61 GB | **≈-3.8 GB** |

expert-cache 每单位 2.66 MB（事实 6），256K 腾出的 ≈3.8 GB ≈ **+1400 单位**；再压
`--vram-reserve-mib` 2048→1024 可再 +380 单位。档位预算：

- 1500 单位 ≈ 4.0 GB（≈1900 槽）——正好吃掉让步腾出的空间；
- 3072 单位 + per-layer ≈ 8.2 GB（≈3900 槽，64/层）——需要 256K 让步 + reserve 减半才稳；
- 512K 的 KV + 3072 单位同开 = 15.7 GB 级增量，超出让步空间，不设此臂。

RAM（非 wired）侧：PLE 表 direct I/O 不占 RAM；页缓存可整片装下分片 1（54.8 GB < 可用 ~60 GB），
expert-cache 命中臂不会把页缓存挤出 SSD 的工作集。

## 2. A) 三档配置

**不变式（opt-in 原则）**：以下参数三档都不动——`--pack`、`--native`、`--ple-gguf`、
`--expert-profile`、`--spec 3`、`--spec-min-p 0.5`、`--mtp rt`、`--mmap-experts`、`--vision`；
env `STRATA_METAL_STREAM=0`、`STRATA_METAL_F16=1`。每档只列**改动**，其余原样保留。

### 保守（decode-only，白天可跑）

```
--max-context 262144
--expert-cache 1500
```

### 平衡（decode-safe 为主 + 一个窗口期 chunk 步）

```
--max-context 262144
--expert-cache 2048
--kv-grow
--prefill auto:16384
env STRATA_METAL_PROMPT_CHUNK=4096
```

### 激进（pack 变体 + 强开 kernel，全部窗口期）

```
# 平衡档的全部改动，另加：
--expert-cache 3072
--expert-cache-per-layer
--vram-reserve-mib 1024
pack 变体：dense 投影（gdn proj / hc / qsa proj / lm head）重建为 Q4_0 或 IQ4_NL
env STRATA_METAL_PROMPT_QSA=flash
env STRATA_METAL_PROMPT_EXPERTS=v3     # 可选步；失败先回退默认 v2
```

## 3. B) 每档预期机制与风险

### 保守

- **机制**：命中槽 82 → ~1900（预算 4.0 GB ≈ 256K 让步腾出的空间）。未命中读映射文件（页缓存），
  命中在 GPU 直接算。CUDA 锚点：4096 槽命中率 54.4%，CPU pool drain 19.1→10.3 ms/token，
  端到端 -2.7 ms/token。 experts 每窗口 982 MB → 命中臂直接削减这部分页缓存读。
- **预期**：decode +5~15%（56-64 → 60-72 区间；探针口径 ntok8 64.8 → ~70）。prefill 不变（chunk 仍 2048）。
- **风险**：wired +4 GB → macOS 内存压力（盯 memory guard 行与 MemAvailable ≥2560 MiB 底线）；
  命中臂舍入差异（已测等质量，2026-09-27-cache-parity）。回退：`--expert-cache 64`。

### 平衡

- **机制**：保守档全部 + chunk 2048→4096（wrapped 模式收益介于 resident +2-4% 与 streaming +20%
  之间，未测）；`--prefill auto:16384` 抬 auto 上限，槽到位后 prompt 缓冲从自备转为借用，
  auto 可选 4096-8192 chunk；`--kv-grow` 让 KV 只按到达的 cell 占 VRAM、槽随上下文还给缓存。
- **预期**：decode 同保守（kv-grow 若开，长会话中段更稳）；prefill +5~15%（估），256K 长文档
  prefill 的 KV 按页读，QSA indexer top_k 2048 使注意力读不随上下文线性涨。
- **风险**：`--kv-grow` 在 Metal 可能不开（VMM 未确认）——零损失，日志给原因；chunk 4096 的
  prompt 缓冲若仍借不到则自备（GB 级），以日志 "chunks of N rows" 和 memory guard 为准；
  PROMPT_CHUNK 碰 prompt 路径 → **必须窗口期测**。回退：逐项摘除 env / flag。

### 激进

- **机制**：平衡档全部 + ①dense Q4 化：dense 字节 3828 → ~1914 MB/窗口（8 行），是 71% 字节项的
  减半；prefill 的 prompt GEMM 同样吃 dense 字节，同向受益。②per-layer 缓存 64/层：命中率锚点
  70.4%（共享策略同预算只有个位数）。③flash QSA prompt kernel：COOP_K4 探针在 M3 拒绝后的强开。
- **预期**：decode ntok8 窗口 64.8 → ~85-100 tok/s（带宽 48%→~65% 的线性外推，**估计值**；
  单流 35.8 受发射/延迟限制，字节只解释 ~3 ms/28 ms，增益小）。prefill 是唯一可能摸到 1500 的档。
- **风险**：三处都无 M3 先例——Q4 dense 的质量（KL/needle 必测，IQ4NL 码本与 Q4_0 档位选择要
  分别过门）；flash QSA 在探针不过的设备上的正确性与性能未知；v3 布局在 M1 Max 挂过。
  8.2 GB 缓存 + vision 1.18 GB + reserve 1 GB：离 70% RAM 上限（89.6 GB）有余量，
  但须盯 footprint cap（压缩 + watchdog panic 的教训）。回退：任意子项独立摘除；
  pack 变体保留原 IQ3_S 路径不动（新 pack 目录，不覆盖）。

### 为什么没有 kv 量化臂（对照旧假设的修正）

Metal 的 KV 存储已是 int8 codes + fp16 scales（事实 1）；q4_0/k8v4 无 Metal kernel。理论收益表
（fp16 24.6 KB/token → int8 12.7 KB/token 等）只适用于 CUDA/HIP 路径，与本机无关。白天
kv A/B 的 -5~-9 tok/s 差异应重跑确认是否为噪声；**不再为 KV 精度-速度权衡设计实验**。

## 4. C) 验证步骤

白天 decode-only（不碰 prompt 路径；改动即重启即可，预热一轮后测；greedy、200 token、
固定 prompt 集，答案应逐 token 一致——MTP 输出与无 MTP 逐 token 相同是既测规则，任何不一致即停）：

1. **256K 基线（第一件事）**：现配置只把 `--max-context` 改 262144，其余不动，跑一天。
   记录：short+story decode tok/s、32K prompt 读速、"expert cache N slots" 与 "expert tiers"
   日志行、memory guard 行。**当前所有白天数据都是小上下文的，256K 基线不存在，先补。**
2. expert-cache 阶梯：64 → 1500（保守档）→ 2048（平衡档），每步一次重启 ×2 prompt ×200 token。
3. `--expert-cache-per-layer` 单独 A/B（在 3072 上，与不开 per-layer 对比）。
4. `--kv-grow` 验证：只看启动日志（"K/V grown to N cells" 或 "--kv-grow is off (...)"），
   加一次长会话第二请求的 ttft。零风险。
5. 质量 sentinel：10 条固定 prompt 的 greedy 前缀对基线逐 token 比对；32K needle
   10/50/90% 深度 9/9。

窗口期 prefill 项（逐项单独改；冷/热各测，首个 prompt 页缓存冷是已知现象——IQ3_S 冷启动
4K prompt 实测 413 tok/s，热后再取中位）：

6. `STRATA_METAL_PROMPT_CHUNK=4096`：32K 与 256K 两种 prompt ×3 取中位；日志确认
   "chunks of 4096 rows"。
7. `--prefill auto:16384`（在 chunk 4096 之上）：确认日志不再出现 "allocates its own buffers"。
8. `STRATA_METAL_PROMPT_QSA=flash`：先正确性（与默认 kernel 的 greedy 输出/KL 对比），后测速；
   失败立即回退。
9. `STRATA_METAL_PROMPT_EXPERTS=v3`：同 8 的流程。
10. dense-Q4 pack 变体：新 pack 目录重建 → 先质量门（KL / top-1 / needle 对原 dense），再
    prefill + decode 全测；原 IQ3_S 路径全程保留可回退。
11. 256K needle（10/50/90% 深度）在最终候选档上跑——256K 在训练内但 needle 从未测过。

每步记录字段：引擎版本（0.1.59）、机器（M3 Max 128 GB）、macOS 版本、greedy、token 数、
 MemAvailable、完整启动日志。数字必须带测量条件（CONTRIBUTING 规则）。

## 5. D) 判定标准（对照 1500 / 100）

**decode ≥100 tok/s**（测法：标准协议 decode_tps 长生成 + 探针 ntok8 窗口口径，两者都报）：

| 档 | 判定线 | 依据 |
| --- | --- | --- |
| 保守 | ≥70（基线 +10%） | 命中臂 -2.7 ms/token 锚点的保守外推 |
| 平衡 | ≥75 | 保守 + kv-grow 弹性 |
| 激进 | ≥100 | dense 字节 71% 减半，8 行窗口 66.3 → 估 85-105；**只有此档有理论通路** |

激进档 <100 时：拆分归因（dense-Q4 实得字节降幅对预期 50% 的偏差、flash QSA 单项贡献），
报实测值，不凑结论。

**prefill ≥1500 tok/s**（测法：32K 与 256K 两种 prompt 的 prompt_tps 中位数；**目标必须在 256K
工作点验证**，4K/32K 数字不算数）：

| 档 | 判定线 | 依据 |
| --- | --- | --- |
| 保守 | = 基线（不动 prompt 路径） | 该档不碰 prefill |
| 平衡 | ≥ 基线 ×1.05 | chunk 4096 的 wrapped 收益未测，resident 锚点只有 +2-4% |
| 激进 | ≥1500 | dense-Q4 prefill GEMM + flash QSA + 4096 chunk 三项同时生效 |

诚实声明：1500 在 M3 Max 上没有已测先例——M5 Max（更快）IQ3_S 32K 也只有 1140-1190 tok/s
（MAC.md，2048 chunk）。激进档三项全中才可能摸到；达不到就报实测值与差距归因。

**硬性门（任一失败即回退该臂，不进入下一档）**：

- greedy 前缀与基线逐 token 一致（cache / PROMPT_QSA / v3 臂）；
- KL / top-1 / needle 不劣化（dense-Q4 臂的质量门在测速之前）；
- MemAvailable ≥2560 MiB 底线，memory guard 不告警，无内存压缩 / panic（footprint cap 教训）；
- 256K needle 9/9；
- 512K→256K 的让步被接受为既定裁决，256K 档的一切对比只对 256K 基线做。

## 6. 未纳入矩阵的候选（记录在案，不排期）

- `--ple-io mmap|ram`：PLE 表 28.8 GB，ram 档 mlock 进 RAM 可把 SSD 读移出 token 路径，
  但 RAM 代价 26.8 GiB；探针字节分解里 PLE 不显眼，先不做。
- `--spec` / `--suffix-draft` / `--lookup-*` 阶梯：MAC.md 实测 spec 2-3 附近最优，当前 spec 3
  已在区间内；留给 decode 微调轮。
- `--batch` / `--parallel`：提升总吞吐但单流变慢（MAC.md 实测），与单流 100 目标相反方向。
- kv 量化全部臂：Metal 无对应 kernel（事实 1），永久出清。
