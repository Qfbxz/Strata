# Harness 改造路线图：落地 HARNESS_LESSONS（供智能体会话逐项执行）

> 定位：本文是**可执行计划**，把 [HARNESS_LESSONS.md](HARNESS_LESSONS.md) 的结论转为带责任方、落点与验收标准的工作包，供后续智能体会话执行。面向 agent 层（`apps/host/server/agent/`）、DeepSeek-Harness 集成（`integrations/harness/`）与引擎 API（`serve/`、`strata_cli/`）的开发者。
> 执行约束：所有条目在带着自己的实测数据落地前均属静态分析结论（见 [CONTRIBUTING.md](../CONTRIBUTING.md)）；每完成一个工作包独立提交，附前后测量；遵守仓库"新特性 opt-in、默认路径保持字节不变"规则。
> 测量公共基线：`strata_cli/launch/harness.py` 中 `TESTED_CONTEXT = 32768`、`OUTPUT_CAP = 4096`、`COMPACT_AT = 15000`。

## 责任划分（一个机制只有一个归属）

宿主侧兜底（backstop）是上游机制在宿主内的临时副本；上游落地后，对应 pinned 漂移测试会**故意失败**，提醒删除兜底——漂移测试就是删除清单。

| 层 | 归属 | 例 |
| --- | --- | --- |
| 上游机制 | DeepSeek-Harness 工作副本 | 提醒阶梯强终止、同 step 去重、turn 预算、子代理报告下限、截断诚实性、压缩契约与熔断、token 计数器、方法论段、MCP 接线、审批缓存 |
| 宿主算术守卫 | `apps/host/server/agent/` | turn-guard 计数、上下文预算校准、reply-cut、spill |
| 引擎面 | `serve/`、`strata_cli/` | count_tokens 端点、结构化输出解码、小模型路由、可复现采样 |

上游执行计划：DeepSeek-Harness 工作副本 `docs/research/HARNESS_IMPROVEMENT_ROADMAP.md`（WP1–WP8，2026-11-08），其决策记录在 `.agents/notes/proposed/feature/2026-11-08-cross-harness-parity-program.md`。

## 阶段一 —— 仅宿主侧，无上游依赖（立即开工）

| # | 工作包 | 落点 | 做什么 | 验收 |
| --- | --- | --- | --- | --- |
| H1 | 同参数强终止兜底 | `apps/host/server/agent/turn-guard.mjs` | 新增"会话内连续完全相同 tool call"计数（现有 turn-guard 只有搜索/计划类阈值），第 12 次终止该 turn 并出人话卡片（"助手在重复同一操作，已停止；可调整指令后继续"）；阈值做成设置项，默认 12 | 脚本化会话单调用循环以停止卡片结束而非挂死；正常连续读不同文件不误伤 |
| H2 | 压缩熔断 | `apps/host/server/agent/context-fit.mjs` | 连续 3 次摘要失败后停止自动压缩、出错误卡片、会话保持可用；阈值设置项默认 3 | 注入失败后恰在第 3 次尝试结束；失败后用户输入仍可用 |
| H3 | spill 附 token 计数 | `apps/host/server/agent/plugins/`（spill 插件） | spill 通知在"头尾 + 路径"之外，附引擎 tokenizer 实测的文件 token 数（有 count_tokens 可用时） | 通知报告实测 token 数；引擎不可用时优雅降级为字符数 |
| H4 | 上下文余量工具 | `apps/host/server/agent/custom-tools-mcp.mjs` | 把 `context-fit.mjs` 的当前预算暴露为模型可调用的自定义工具 `context_remaining`（返回剩余窗口、本轮输出预算、压缩头寸） | 工具返回值与宿主实际执行的预算一致；模型调用不产生额外审批 |

阶段一验收测量（每项落地时记录）：任务首次正确答案的轮数、每完成任务 token 数、每会话压缩失败次数、循环会话是否挂死。

## 阶段二 —— 上游落地协同（等 DSH WP1–WP8 完成后执行）

1. 升级 `integrations/harness/profile` pin 的 Harness 版本与 `BUNDLE.json` 记录。
2. 更新 pinned 漂移测试，确认上游新行为（强终止、报告下限、截断后缀、压缩契约、审批缓存）按预期到达宿主。
3. 删除被上游取代的宿主兜底：H1（上游 W1 强终止）、spill 后缀（上游 W4）、压缩失败处理（上游 W5）。每删一项跑一次阶段一验收测量，确认无回退。
4. 上游 W6（provider token 计数器）落地后，`context-budget.mjs` 的密度校准从"估算修正"降级为"仅无计数器引擎的兜底"。

## 阶段三 —— 引擎前置能力（harness 机制的地基，与阶段一并行排期）

| # | 条目 | harness 为什么需要 | 落点 |
| --- | --- | --- | --- |
| E1 | OpenAI 兼容侧 `count_tokens` 端点 | 宿主预算与上游 W6 目前只能走 Anthropic 端点；opencode/codex 等 OpenAI 协议 harness 拿不到真计数 | `serve/` |
| E2 | 语法约束的结构化输出 | 当前 JSON 模式与工具调用互斥；`tool_choice: required` 仅预写前缀、非硬保证——上游报告下限续写与结构化摘要都受益 | 引擎解码路径 |
| E3 | 标题/摘要小模型路由 | 会话标题等小任务不应消耗主模型 32K 窗口（当前单服务器单模型） | `serve/` + `strata_cli/` |
| E4 | 可复现采样模式 | harness 改造的效果需要可对比评测（当前默认 adaptive tier 不可复现） | 引擎采样 |

每项落地后 `strata connect --check` 增加一项对应检查（E1 查计数端点、E2 查结构化输出、E3 查路由、E4 查采样标志）。

## 明确不做

- 不在宿主侧重实现上游机制的全量逻辑（只做计数兜底，机制归上游）。
- 不触碰 vendored 插件行为（含 dsh-infinite-gen-4）。
- 不改默认路径行为：H1–H4 全部为新增设置项驱动，默认值即本表默认，但开关关闭时路径与上一版本字节一致。
