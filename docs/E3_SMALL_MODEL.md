# E3 小模型路由：多模态双目标选型

> HARNESS_ROADMAP.md 阶段三 E3。serve 跑第二个小模型实例（llama-server 子进程），双目标：
> **A 小任务路由**——标题/摘要等短任务不消耗主模型 32K 窗口；**B 视觉文本化网关**——主模型
> 不带视觉 tower 时（DS 文本包、vision off、其他家族），带多模态的小模型先看图说话，
> 把结构化描述注入主模型 prompt，任何主模型都能"看见"图片。

## 现状考古（2026-11-10 确认）

| 事实 | 出处 |
|---|---|
| Strata 引擎（DS/Qwen3.8）不含 LLM_ARCH_QWEN2VL，不能加载 Qwen2.5-VL | `src/` 全量 grep 无 QWEN2VL；`third_party/llama.cpp/src/llama-arch.cpp:35` 有 |
| llama.cpp 子模块完整：mtmd + server 工具 + QWEN2VL | `third_party/llama.cpp/tools/{mtmd,server}/` |
| 已有视觉路径是 **embeddings 网关**（strata-vision，mtmd+mmproj → SVE1 记录 → 引擎），只对 Qwen 同族有效 | `serve/server.py:3227` Vision 类；`src/program/generate.cpp:13831` |
| DS 引擎自带 tower（引擎内编码）；Qwen 引擎走 strata-vision | `serve/ds_pictures.py`、`serve/server.py:14` |
| 常驻子进程 + 空闲卸载 + VRAM 弹性模式已成熟 | Vision 类 elastic（`serve/server.py`）、images.py gpu_policy |

**结论**：embeddings 网关只服务 Qwen 同族；文本化网关（小模型看图→文字）才是通用方案。
小模型进程用 llama-server（同一 llama.cpp 源码构建，Metal 后端一致），Python 侧代理路由。

## 小模型选型（多模态档）

| 模型 | 参数量 | Q8_0 | +mmproj | 视觉 | 中文 | 许可 |
|---|---|---|---|---|---|---|
| **Qwen2.5-VL-3B-Instruct**（首选） | 3 B | ~3.6 GB | ~0.6 GB | ★★★（原生多模态） | ★★★ | Apache 2.0 |
| Qwen2-VL-2B-Instruct（轻量档，16 GB 机器） | 2 B | ~2.4 GB | ~0.6 GB | ★★ | ★★★ | Apache 2.0 |
| Qwen2.5-0.5B-Instruct（纯文本档，标题专用） | 0.5 B | ~0.5 GB | — | — | ★★★ | Apache 2.0 |

VRAM 预算（主模型 DS 2.00bpw ~12 GB 之外）：128 GB 机器无压力；16 GB 机器用 2B 档。
短上下文（8K）KV cache 很小。一个 llama-server 进程只跑一个模型；VL 驻留后标题/摘要
直接复用它，不必再开 0.5B 进程。

## 下载（镜像优先，HF 直连曾一晚下载缓慢）

```bash
# ModelScope（国内直连，实测最快：3.1 GB 用时 95 s ≈ 33 MB/s）
modelscope download --model ggml-org/Qwen2.5-VL-3B-Instruct-GGUF \
  Qwen2.5-VL-3B-Instruct-Q8_0.gguf --local_dir ~/.strata/models/small-model

# 备选：HF 镜像（hf-mirror.com；断点续传在进程被杀时会丢失）
HF_ENDPOINT=https://hf-mirror.com hf download ggml-org/Qwen2.5-VL-3B-Instruct-GGUF \
  Qwen2.5-VL-3B-Instruct-Q8_0.gguf mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf \
  --local-dir ~/.strata/models/small-model
```

## 实测（2026-11-10，M3 Max 128 GB，Metal 全层 offload，llama-server 0.4.1-dev）

| 项 | 数字 |
|---|---|
| 加载（Q8_0 + mmproj f16, -ngl 99） | **1.5 s** |
| 中文会话标题（≤8 字） | **0.4 s**，"Mac Metal 显存溢出排查"（合规、贴切） |
| 小图描述（64×64 PNG） | **0.4 s**，正确回答 "Red" |
| 真实截图描述（IDE 截图，~300 tok 输出） | **10.4 s ≈ 30 tok/s**，正确识别 IDE、项目名、侧栏结构 |
| 注意 | Qwen-VL 最少 1024 image tokens（grounding 任务）；`--image-min-tokens 1024` 可加 |

## 意图整理器（prompt rewriter，2026-11-10 增补设计）

> 用户方向：他发的消息可能不好理解，先让小模型整理成大模型高效理解的提示词，再交给主模型——
> 但**整理器的思考能力不能弱，否则误解意图比省窗口更伤**。

### 选型升级：Qwen3-VL-4B-Instruct（Q8_0，4.1 GB + mmproj 0.4 GB）

一个模型全包三任务（视觉 + 强推理 + 短文本生成），替代 Qwen2.5-VL-3B 做整理任务：
- 本仓 llama.cpp 已含 `LLM_ARCH_QWEN3VL`（llama-arch.cpp:39），直接可跑
- Qwen3 代际文本推理显著强于 Qwen2.5（用户点名的核心约束：整理质量优先）
- 旧 Qwen2.5-VL-3B 保留做标题/摘要（更快）；整理走 4B

### 防误解机制（实现必须全部满足）

1. **原文保底**：整理结果绝不裸交主模型。格式固定
   `[消息，重述]\n…\n[原话]\n…`——主模型始终看得到原话，纠偏有据。
2. **消歧标记**：整理器判定有实质歧义时输出 `<ambiguous>追问</ambiguous>`，
   host 直接把追问返回用户，不猜。
3. **上下文进料**：整理器输入 = 最近 3-5 轮对话 + 当前消息。短依赖消息
   （"继续""修复"）靠上下文展开，而不是瞎猜。
4. **per-task 思考开关**：整理走思考（enable_thinking，延迟 1-3 s 可接受）；
   标题/摘要不开（速度优先）。
5. **评测集**：含糊消息 → 期望重述的固定样例进单测，防换模型/改提示词时退化。
6. **默认关**：feature flag `promptRewrite`（opt-in，默认路径字节一致）。

### 意图整理器实测（2026-11-10，Qwen3-VL-4B-Instruct Q8_0，Metal）

| 案例（真实含糊消息） | 结果 | 用时 |
|---|---|---|
| "继续" + 历史（nightchain 下载修复） | ✅ 展开为完整请求，细节全保留 | 1.6 s |
| "那个问题修了吗" + 历史 | ✅ 锁定"设置保存按钮"，正确附加强化确认 | 1.1 s |
| "帮我改一下"（无上下文无宾语） | ✅ 给最可能理解 + AMBIGUOUS 追问 | 1.0 s |
| "把那个文件改好然后跑一遍测试再更新文档" | ✅ 三步细节全保留 + 对"完整的测试"追问 | 1.7 s |

实测发现的坑（已修）：模型会在 AMBIGUOUS 行前复述格式说明
（"（仅在有歧义时另起一行）AMBIGUOUS: …"），行首锚定的解析会丢标记——
解析改为全文检索标记（2bedd38a），prompt 同时禁止复述格式。

### 流水线位置

host 的 agent 入口（消息进 harness 前）→ 调 serve 的 small 通道
（`/v1/chat/completions {"model": "small"}`，serve 侧零改动）→ 重述结果
拼进发给主模型的消息。

## 实现状态（2026-11-10）

| 件 | 状态 |
|---|---|
| `serve/small_model.py`（sidecar 管理：lazy 启动、健康轮询、空闲卸载、chat/describe_image） | ✅ 已提交 |
| serve 路由（`"model": "small"` → 代理，OpenAI/Anthropic 双形状） | ✅ 已提交 |
| 视觉文本化网关（`textualize_images`：主模型无 tower 时图片→文字） | ✅ 已提交 |
| `strata connect --check` 第 4 项（off=状态不算失败） | ✅ 已提交 |
| runconfig（`small_model.enabled/idle_unload_s/exe/model/mmproj` 五个 leaf，嵌套 section 支持） | ✅ 已提交 |
| host 设置 UI（`/api/small-model` GET/PUT + FeatureFlags 面板 + 9 语言 + dist 重建） | ✅ 已提交 |
| llama-server 构建（`build-small/bin/llama-server`，Metal；fork 缺 ui/ 树用 ui-stub 兜底） | ✅ 已提交 |
| Metal 实测 | ✅ 上表 |

未做（下一步候选）：Harness 标题/摘要 prompt 带 `"model": "small"` 的接线（serve 侧路由已就绪，
等 WP 系列统一接）；`--image-min-tokens 1024` 默认化验证。

## 实现架构（serve 侧）

1. `serve/small_model.py`：SmallModel 常驻子进程管理（llama-server `--host 127.0.0.1 --port <auto>`
   `--model <gguf> --mmproj <gguf> -c 8192 -ngl 99`），借 Vision 类模式：lazy 启动、空闲卸载
   （`idle_unload_s`，默认 300）、READY 行监听、崩溃重启、健康检查 `/health`。
2. `serve/server.py` 路由：
   - 请求体 `"model": "small"`（或别名 "small"/"small-model"）→ 代理到小模型实例
     （OpenAI/Anthropic 两侧同名路由；响应原样透传流式/非流式）。
   - 主模型 `vision is None` 且消息带图片 → 先发小模型做视觉文本化
     （固定 prompt："describe this image for another model"，输出截断 ≤1K tok），
     把描述作为文本段替换图片占位，再走主模型；响应里标注 `via: "small-vision"`。
3. 配置（run config 的 `"small_model"` 段，全部可视化设置）：
   `{"enabled": false, "exe": <llama-server>, "model": <gguf>, "mmproj": <gguf>,
   "ctx": 8192, "ngl": 99, "idle_unload_s": 300, "mode": "resident"|"on-demand"}`
   默认 **off**——opt-in，默认路径字节一致（CONTRIBUTING 规则）。
4. Harness 标题/摘要请求带 `"model": "small"`；主模型带 tower 时图片仍走原路径（优先级：
   tower > 小模型文本化 > 400 拒绝）。
5. `strata connect --check` 增加 E3 检查项：小任务路由回非空 + 图片文本化回非空。
6. 设置界面：小模型管理页（开关/模型选择/状态/空闲卸载时长/下载入口），持久化到 run config。

## 不做的

- 不改 C++ 引擎（Qwen2VL 不进 Strata 引擎；两个大模型不共进程）
- 不动现有 strata-vision embeddings 路径（Qwen 同族仍走 embeddings，质量更好）
- 不在无 mmproj 时伪装多模态（文本档只接小任务路由）
