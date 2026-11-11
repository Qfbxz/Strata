# Vendored 插件与 0.2.3 契约差异清单

> 定位：本文是**正式清单**，收敛宿主随带的所有 vendored 插件、注入插件与补丁对钉住 Harness（`apps/desktop/src-tauri/resources/harness`，版本与 commit 见其 `BUNDLE.json`，当前 0.2.3-rc.1 @ 095ae0ec）的契约差异：每一项写来源与版本、需要的契约变化、当前状态、复核方法。[HANDOVER.md](../HANDOVER.md) 的编年条目是过程记录；两者冲突时以本文与代码为准。
> 纪律：[HARNESS_ROADMAP.md](HARNESS_ROADMAP.md) 的"不触碰 vendored 插件行为"以本文登记的例外为准——**新增或修改任何 vendored 项，必须先在本文登记**；未登记的 vendored 差异按未迁移处理。

## 来源分层

| 层 | 位置 | 真源 | 挂载方式 |
| --- | --- | --- | --- |
| 仓库内 vendored | `apps/host/server/agent/plugins/` | 本仓库文件 | profile 按绝对路径 import（0.2.3 起插件行从 profile 目录导入，绝对路径携带整个插件） |
| bundle 注入（fleet plugins） | bundle `node_modules/<name>` | `~/strata-setup/harness-vendored/`（仓库外档案；bundle 内副本是仓库内证据） | `stage-harness.mjs --plugins` 复制进 deploy 闭包外，`stagedPluginEntry` 把包名解析为 staged 入口文件 |
| 上游依赖补丁 | bundle `node_modules/@earendil-works/pi-ai` | 上游 0.82.1 原件 + 本仓库补丁器 | `harness-budget.mjs` 在 staging 时重放，前后 SHA-256 记进 `BUNDLE.json` 的 `patches[]` |

## 清单

### 1. dsh-infinite-gen-4 v0.4.0 —— 已迁移（纪律例外登记）

仓库内 vendored：`apps/host/server/agent/plugins/dsh-infinite-gen-4/`，profile `INFINITE_GEN_PLUGIN` always-on 挂载。

- **0.2.3 契约变化**：session projection 注册契约改名——0.2.2 的 `stateSchema` 与 `wire.viewSchema` 字段被上游删除，注册表现在直接读 `schema`（要求带 `parse`）与 `view(state)`，并在每个 history 页与每次 push 上执行 `schema.parse(view(state))`（上游契约见 DeepSeek-Harness `packages/session/session-projection`）。缺 `schema` 的注册单元会让宿主的 history 读取崩溃。
- **纪律例外（本文登记的唯一直接触碰 vendored 行为的点）**：armor 会话投影单元改为 `schema: { parse: (v) => v }` + `view: (state) => state`（`index.js` 的 "0.2.3 projection contract" 注释块）。armor 状态本身原样往返，语义不变；改名只是补齐上游要求的字段名。
- **状态**：已迁移（随 0.2.3-rc.1 staging 落地）。
- **复核**：①`index.js` 的 armorDef 只带 `schema`/`view` 两个契约字段（全文 grep `stateSchema` 仅允许命中"0.2.3 projection contract"说明注释）；②对照上游 `session-projection` 的注册类型确认 `schema`/`view` 形状；③带 `STRATA_HARNESS_DIR` 跑 `tests/agent-context.test.mjs`（真实 Harness 的 history 分页投影即走这条注册表）。

### 2. dsh-client-auto-continue v0.17.3 —— 已迁移、已挂载

bundle 注入；真源 `~/strata-setup/harness-vendored/dsh-client-auto-continue/`。

- **契约变化**：①触发事件名改成本 harness 的事件词——vendored 副本监听 `agent/inbox/spliced`（移植时定名，跨 0.2.2→0.2.3 不变）；②同参循环阈值经 settings 用户层下发 `loopToolRepeat: 13`（`agent-bridge.mjs` startRuntime 的 `settingsSeed`），让上游 repeat-guard 阶梯（3/5/8 提醒、12 强停）先走，fleet 守卫退居"循环活过重启"的兜底。
- **状态**：已迁移、已挂载。
- **复核**：①`diff -r ~/strata-setup/harness-vendored/dsh-client-auto-continue <bundle>/node_modules/dsh-client-auto-continue` 逐字节一致（档案即真源，含 spliced 改名）；②`tests/agent-bridge.test.mjs` 的自动续接 notice 匹配用例。

### 3. dsh-auto-memory v1.3.0 —— 已迁移、已挂载、未改动

bundle 注入；真源同上档案目录。除 harness 外的依赖（`@deepseek-ai/schemastery`、`yaml`）都在 bundle 闭包内，0.2.2→0.2.3 迁移零变化。

- **状态**：已挂载，与档案逐字节一致。
- **复核**：`diff -r` 同上；profile `AUTO_MEMORY_PLUGIN` 行；记忆注入的功能测试（`tests/auto-memory.test.mjs`）。

### 4. @linxin666/dsh-ssh v0.4.15 —— 未迁移（挂载阻塞）

仓库外档案 `~/strata-setup/harness-vendored/incomplete/dsh-ssh/`：装配不完整（`ssh2` 自身的依赖树缺失，包无法加载）。

- **0.2.3 契约变化**：无插件自身变化；0.2.3 的 profile 行需从包名改为 `stagedPluginEntry(harnessDir, SSH_PLUGIN)` 解析出的入口文件（0.2.3 起插件行从 profile 目录导入，bundle 包名不再解析——profile.mjs 注释与解析器已备好）。
- **状态**：未挂载（0.2.2 bundle 里它也是死行）。宿主侧一半（host store、ssh2 连接池、/api/dsh-ssh 路由、六工具）完整在库。
- **复核**：补齐 ssh2 依赖树 → bundle `node_modules` 落位 → profile 插入挂载行 → 启动；缺件时 boot 会点名缺失插件（失败响亮，不静默）。

### 5. 上游 0.2.3 交付差异（非 vendored，同属契约面）

| 上游变化 | 宿主处置 | 复核 |
| --- | --- | --- |
| `dsh-tool-present`、`dsh-plugin-manager` 包删除 | preset.mjs 移除两行；App 侧 present 卡片渲染保留。恢复内联"展示结果"工具属 vendoring 决策（走 dsh-infinite-gen-4 的路子），不是 profile 编辑 | `tests/agent-tools.test.mjs`「每个插件名存在于钉住 bundle」 |
| `tool-subagent-control` 的 `./list-agents` 子路径并入包根 | preset.mjs delegation 组禁止再引用 `./list-agents` 子路径（2026-11-09 事故：死子路径让工具服务器 never started，所有 agent 聊天挂起） | 同上，外加对照 bundle `exports` |
| 0.2.3 不默认带 fetch provider（部署自担 SSRF 面） | profile web 行挂 `@deepseek-ai/dsh-web-fetch-http` 并 `fetchProvider: 'http'` | profile 测试与 web 行断言 |
| subagent 工具 per-call `model`/`provider` 参数与 `list_subagent_models` 删除；子代理会话被 `session.selectModel` 以 `agent-busy` 拒绝 | strata-models 插件卸载删除；"按名选模型"在 `session.selectModel` 缝上重建为宿主侧选择器（`server/agent/model-routes.mjs` + `POST /api/agent/model-by-name`，`modelByName` 开关默认关） | `tests/agent-subagent-models.test.mjs`（两条原 skip 已转实证） |
| 0.2.2 jobs 层助手并发帽删除 | profile 的 `subagent.maxActiveSubagents` 死配置行随批删除（helper 并发归 Harness 运行时自管） | profile 测试断言无该行、signature 不随 slots 变化 |

### 6. @earendil-works/pi-ai 0.82.1 上下文安全补丁 —— 已迁移（依赖补丁）

非插件，是 staging 时重放到 bundle 依赖上的字节补丁：`harness-budget.mjs` 的 `strata-pi-ai-context-safety-v2`，小窗口的安全边距按比例收敛（>=64K 维持旧值），前后 SHA-256 记进 `BUNDLE.json` 的 `patches[]`；重复应用或未知原件大声失败，绝不写第二遍。

- **复核**：`STRATA_TEST_PI_AI_DIR=<bundle> node --test apps/host/tests/harness-budget.test.mjs`（含"原始安装件哈希不变"用例）；或直接 `shasum -a 256` 比对 `BUNDLE.json` 的 after 值。
