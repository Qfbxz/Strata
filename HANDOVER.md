# Strata 项目交接文档

> 生成时间：2026-11-07 晚 · 由无人值守夜班+日班会话编写
> 修改主仓库=**本仓库**（/Users/boergege/compile/优秀仓库参考/strata，本地 main，**严禁推送远端**——用户 98bc625 约束）
> 配套资产在仓库外：`~/strata-setup/`（账本/评审/报告）、`~/gguf/`（模型本体）、`~/.local/share/strata/`（引擎与运行配置）

---

## 〇、全程需求与会话编年史（按序，从第一天到最后）

### 第一阶段：安装与合并（2026-11-02 ~ 11-05）
| 序 | 用户原话/需求 | 会话经过 | 结果 |
|---|---|---|---|
| 1 | Strata 五模型安装 | 官方安装器反复失败（网络/门禁） | IQ3_S/Q4/Q5 装+手写 run config 成功；DS 128K 越界失败（须 --model-path） |
| 2 | 神秘删除事件：430GB 模型消失 | 全链取证 | 破案 strata_remove 三缺陷叠加；批次1 删除安全五件套 TDD commit（10 契约测试） |
| 3 | 13 份深挖报告 TDD 落地（goal hook 全程在线） | 批次制推进 | 批次 1-4 全 commit（7 commits），host 218+ 测试绿 |
| 4 | 自定义 App 构建 | cargo 链接器/wheel/Rosetta 连环坑 | arm64 App+x86_64 DMG 留档 ~/strata-setup/app-versions/ |
| 5 | A2141 Intel Mac 适配 | Apple7+maxBufferLength 锁死 | 结论报告：唯一形态=流式/CPU，Q2_0 3-4 tok/s |
| 6 | 监测到官方引擎 17/Strata 更新，拉取合并 | 208 commits，3 冲突"谁完善谁上" | f0e9754f 合并完成；setup.py/strata_mcp.py 冲突解决 |

### 第二阶段：MLX+性能+GLM（2026-11-06 早）
| 序 | 需求 | 经过 | 结果 |
|---|---|---|---|
| 7 | MLX 一等公民（怎么调用进来） | 路线 A 落地 | mlx-bridge :8759+13 模型注册+launchd 自启+实弹 E2E |
| 8 | 16 模型战役榨干软硬件 | 战役 v2（走 bridge） | 7 模型实测入 MLX-MATRIX.md+7 参数卡 |
| 9 | GLM 1M 识别+第三方慢+思考灰菜单 | 三层根因 | modelsListPath/刷新 TTL/KNOWN_CONTEXTS+三协议 thinking 线格式 |
| 10 | 页面字体别扭 | GT Walsheim 无汉字 | CJK sans 显式入栈+行高 1.7+14px |
| 11 | kimi code 两轮独立验收 | -p 模式+deepseek flash | 第一轮抓 MLX 单位 bug+提交不自洽；第二轮 10🟢/2🔴→双红闭 |

### 第三阶段：四套模型+UX 深水区（2026-11-06 午）
| 序 | 需求 | 经过 | 结果 |
|---|---|---|---|
| 12 | UD-Q6/Q3KXL/IQ4XS-v31/IQ3XXS 全下载 | parallel-dl 七 worker | 全部 SHA 验收；共享 28.8GB 表一表三链 |
| 13 | 列表里不要下载按钮（识别已装） | 命名根因 | 离线装配保留下划线命名→Control 全 present |
| 14 | 拖文件/图片/文件夹进会话框 | 壳层翻转证伪→回滚+埋点 | 附件轨道（DeepSeek 式缩略图+删除叉）上线；**真实拖放待用户实测** |
| 15 | Enter 时机同其他 harness | IME commit 窗口 | commit 后再 Enter 才发送（50→200ms） |
| 16 | 子代理自动清理+会话查看 | watchdog+foldChildRecords | 完成 5 分钟折起；View log 读真转录 |
| 17 | 右侧工作区面板（codex/kimi 式） | WorkspacePanel | 文件树+代码查看+分支徽章→git log 图 |
| 18 | dsh 插件移植（自动回复/SSH/infinite-gen） | 真源考古 | 三落地（auto-continue v0.17.3/dsh-ssh v0.4.15/infinite-gen-4）；auto-memory 缓行 |

### 第四阶段：ACP 六智能体后端（2026-11-06 下午，用户称"最重要的功能"）
| 序 | 需求 | 经过 | 结果 |
|---|---|---|---|
| 19 | ACP/SDK 调用 claude/codex/kimi/zcode/opencode/deepseek 六 CLI | 协议逐个实证 | 六后端全实现+四实弹；权限默认拒绝纪律；聊天选择器"本机智能体"段 |
| 20 | 三方专家交叉评审（前/后端/安全） | 子代理并行 | 6 HIGH 全闭+i18n 13 键×9 语言 |

### 第五阶段：1M 上下文战役（2026-11-06 深夜~11-07 凌晨）
| 序 | 需求 | 经过 | 结果 |
|---|---|---|---|
| 21 | "如何提高上下文 1M、速度略降、智力不降" | kimi/codex/zcode 三方独立评审 | 阶梯制裁定：256K 原生/512K 零畸变/1M 锚定 YaRN 2×@524288（六 flag 显式）；Q6 禁上 1M；上限 1,010,000 |
| 22 | 五臂战役实测 | T1-T6 协议（kimi 设计） | R0=11.17/R1=11.25/R3=**11.82 PASS**/夜纯外推同分（旁证不发布）；R2 yarn4× GPU 僵死（定因=组合 bug）；洗牌指纹同分通过；temp0.7 冒烟过 |
| 23 | 1M 档发布 | kimi 发布清单 | 档C config 落盘+Control present+App 显示 986K |
| 24 | drafter MTP vs DFlash2 定夺 | 双工况（中文+代码） | MTP 全胜→四套切 mtp spec2 |
| 25 | Q6 四方案全试+partialpin 95/85 | 干净复审 exit 5 | 终判本机不可跑（114.8GB>96GB Metal 预算） |
| 26 | 120B 质疑"LM Studio 里很快" | 复测 | 120B×2 翻案可用；basalt 定罪（架构不支持） |
| 27 | CONTIG/batch 夜班欠账链 | 五连败 | 定论：白天 4K-prefill 必死；转夜间纯净窗口 |

### 第六阶段：0MiB 彻查+DS 家族（2026-11-07 白天）
| 序 | 需求 | 经过 | 结果 |
|---|---|---|---|
| 28 | "彻查 0MiB 根因并修复" | 四层深挖+自编引擎验证 | 双案定谳：小模型=Parallels 周三残留孤儿进程（sudo 清→0→20GB）；Q6=结构性超限；自编引擎已回滚，UMA patch 留档待报上游 |
| 29 | "为什么要自己编译引擎"（质疑） | 复盘 | 承认过度工程：真凶是 VM 残留；认知收益=Mac 分支缺校正+integrity 三层校验机制 |
| 30 | DeepSeek 2.0bpw 下载+128K 优化空间 | 用户自下+我评测 | 装好；实测 0.39-1.73 tok/s vs 官方 15-16 |
| 31 | "只消耗 CPU 和内存，GPU 始终为 0，这就是你测试的效果吗？"（质问） | 干净重启复现+日志 | 根因=dsv41 引擎把 10074 专家(86.6GB)布局 CPU lane（Mac 无 PCIe lane 概念） |
| 32 | das-coder 也下载+全家对比表（官方数据） | 分工：用户下 2.0，我下 2.25+Coder | 2.25 四片完（分片1 作者重传+928 已按新 pin 验）；Coder 5/6 片（Engram xet 403 卡） |
| 33 | 请 kimi 审 DS 处置决策 | 全案 brief | 改判"资源竞争"→"布局决策"；路线 c 报官方+b strings 旋钮+d 临时替代；反对标"不可用" |
| 34 | strings 枚举 DS4 旋钮 | 220+ 个旋钮出土 | DS4_UMA_GPU_RESERVE_GB=96 试验：布局微调（9622/82.8GB）未根治 |
| 35 | P1-1 F16 解堵 | quant_quality 失配考古 | 真凶=exe 组件引用不解析（非 GEN 协议）；质量门 96.16%/0.016 通过 |
| 36 | 引擎/App 更新分离+上下文梯阶预告+Legacy 入口 | TDD | 三 commits（95a99ca7/8e21c595/947d3c9b） |
| 37 | 多子智能体并行（所有模型，与本地/第三方无关） | --batch/--parallel 毒 flag 连环救火 | 五套 --batch 2；Q5/Q6 内存撤；教训入账 |
| 38 | 交接文档（本文件） | 全程按序编写 | 即此 |

### 第七阶段：夜班前场收口 + App 双特性（2026-11-07 晚，goal 会话）
| 序 | 需求/发现 | 经过 | 结果 |
|---|---|---|---|
| 39 | 下载终局裁决 | 全量 SHA 终验 | Coder 5 分片全对 pin（**shard 6 不存在，of-00006 是作者笔误**，Coder 收口）；Engram=eb19f30d 双 pin 白名单之二不重下；dspark .part 哈希不符（预分配假完整）弃之夜间重下；UD-Q8_K_XL 506GB 暂停待裁决 |
| 40 | 版本勘误 | 二进制指纹考古 | DS 引擎=**0.1.57-metal build 3e0210663 官方签名件**（HANDOVER 的 0.1.55 过时，feed-mirror 停更所致）；用户确认 0.1.57 即最新 |
| 41 | 引擎包落位 | setup 原文支持仓库目录 | `engine-dsv41/` 放入 0.1.55+0.1.57 目录与官方 tar.gz，setup Step 4 本地自足，2.25 安装不再被墙 |
| 42 | 上游报告两份 | log 实证+静态旋钮 | `ds4-mac-lane-issue-report.md`（官方 13-15 tok/s 自证对照+RAM-cap 误判+四点 ask）；yarn4x 报告勘误（**M3 Max**/macOS 27.2）+补 yarn4×@256K 交叉定因；`ds4-knobs-mac.md` 289+48 旋钮目录与夜间六臂矩阵 |
| 43 | 夜间欠账脚本重建 | /tmp 被重启清空的教训 | `~/strata-setup/night/{bench_night.py,final-debts.sh}`：预检四门槛+幂等+单相失败不断链+现场恢复；七相序列含 DS 六旋钮臂与 2.25 安装冒烟；cron 23:37 点火 |
| 44 | 技能批量导入（用户当面需求） | TDD 全绿 bf83e05f | /api/skills/scan+import 端点+Skills 页勾选对话框+9 语言；单目录 Add 字节不动 |
| 45 | auto-memory 移植收口 | 勘误+真加载 80bbde0a | 实为 dsh-auto-memory **1.3.0**；"双缺口"不成立（bundle 内依赖全在，**无需 harness 升级**）；双端放置+profile 注册+真加载测试通过；已装 App 无需重建即得插件本体 |
| 46 | 遗留套件九连败全修复 | worktree 基线裁决+f276ceac | 9 个失败在合并基线分毫不差复现=官方合并债；**真实产品 bug 修复：思考菜单 Off 现在显式送达 `reasoning_effort:'none'`**（此前推理模型照样思考）+守卫收紧正向已知+macOS /var/folders 误拒+remote 上下文不继承引擎读数+三处过期测试跟进；账本 §三十四 |
| 47 | Claude 式 agents/+hooks/ 目录 + Codex/harness 式 UI 三件 | 用户当面需求 bf83e05f 后续 | **agents/ 目录**：`<slug>.md`/`<slug>/AGENT.md`（frontmatter name/description/tools/model+正文指令），App 与工作区双源；`agentId` 贯通直聊三路 systemPrompt（目录+人设）；**hooks/ 目录**：`<event>/` 脚本 stdin 收 JSON、pre-turn 非零即否决（stderr 为理由）、post-turn 观测；/api/agents、/api/hooks；**UI**：composer 行 ⑂ 分支芯片（Codex 式）+顶部子智能体 Dock（点击定向 composer→steer/queue、⌂ 进工作区面板）；harness 子代理描述符原生 persona/toolFilter/model——agents 目录的 harness 侧人设留待 strata-persona 插件切片 |
| 48 | 追加批次：②续接徽章 ③自动记忆界面（①压缩裁决原生已有） | 用户当面需求 5c1ceb11+6ab925dd+d97e2ded | **②**：`isAutoContinueSplice` 精确匹配器+桥内 notice 帧（"Continue" 精确值/两条中文文本；长句不误触）；**①裁决**：harness 已原生自动压缩（~60% 启动+/compact），差可视化排后续；**③**：/api/memory 只读读层（限根/markdown-only/3 测试）+MemoryPanel（工具栏记忆钮→最新在先列表+查看器）；账本 §三十六 |
| 49 | 设置页管理批次（用户当面需求"新功能要有设置页可视化+持久化"）+ Claude 约定四连 | 55199a03+50dfe315 | **feature-flags 六旗**（agents/hooks/memory/projectInstructions/skillsNative/branchChip，默认全开=文件面自身 opt-in）存 app-settings.json、PUT/GET /api/features、宿主全门控、Settings 新 Assistant 面板六开关；**软链**两扫描器 symlink-aware；**CLAUDE.md/AGENTS.md** 加载器（优先级/向上 6 层/双份/有界）；**原生技能三源**（kimi-code/agents/cc-switch，只读去重）；记忆适时使用+五技能包移植（§三十八）；账本 §三十九/四十 |
| 50 | strata-persona 施工（设计契约兑现 758cc03e） | spawn 时 persona 按名解析：pre-execute 拦截 subagent/subagent_fork，命中 agents/ 注册 id 即注入完整指令（有界 64K/斜杠拒收/未注册直通/空配置不注册）；agentsDirs 经 bridge→buildProfile→config 双目录；agents 人设同时物化为技能（双通道可见）；3 测试；§四十一 |
| 51 | UMA 内存修正 + B3 恢复点选择器 + 欠账收尾 | 4f220315+7f0139fe+c8727bf4：Metal mem_get_info 以 host available-6GiB 封顶（STRATA_UMA_HEADROOM_GIB 旋钮，#5488 根因面，编译验证未实测）；composer ⟲ 恢复点芯片（每条已发送消息=检查点，40 条新先旧后，fork+回填输入框，checkpoints 旗+九语言）；office 文档补提交。借鉴目录 A 级四项+B3 全落，B1/B2 裁决关闭。build-11=-75-g7f0139fe 已留档待 23:37 夜班装入；调度链 PID 复用死等教训在案（链式触发改用产物存在性）。§四十四/四十五 |

### 贯穿性指令（全程有效）
- 无人值守模式（driver 脚本+幂等+终验三门槛+账本落盘）
- 白天睡觉晚上干活→后改白天跑晚上停
- kimi code 独立验收两轮制
- 全部 commits 本地不推远端
- 用户日常负载=中文办公+大项目前后端算法编译（双工况验证纪律）
- monitor 分层：脚本守夜+我做决策+kimi 出分析（晨报）

---


## 一、你的全部需求与完成状态

### A. 模型与引擎（全部完成，除 Q6 本机不可跑 + DS 大杯待官方）

| 需求 | 状态 | 证据/位置 |
|---|---|---|
| 四套 UD 模型离线装机（IQ3_XXS/Q3_K_XL/IQ4_XS-v31/Q6_K_XL） | ✅ 完成 | `~/gguf/models/`（平铺，6 分片 SHA 全验）；模型列表显示"已下载"无下载按钮 |
| 1M 上下文支持 | ✅ 完成并发布 | 五臂战役 R3 锚定 YaRN 2×@524288 总分 11.82 > 基线 11.17；配置 `strata-unsloth-ud-iq4_xs-v31-1m.json`（App 显示 986K）；IQ3_XXS@1M 也通过（11.37） |
| drafter 裁定（MTP vs DFlash2） | ✅ 双工况实测 | 中文 MTP 50.8(+8%) vs DF2 40.2(−14%)；代码 MTP 53.0(+6%) vs DF2 45.9(−8%) → **四套 config 均已切 mtp spec2**，DF2 包保留可手选 |
| 多子智能体并行（所有模型） | ✅ | IQ3_XXS/Q3/IQ4_XS/Q4/iq3_s config 加 `--batch 2`（双请求槽）；Q5/Q6 因内存撤；API 8 并发；ACP 每 turn 独立进程。**batch=1 vs 2 对照冒烟未跑**（白天环境不可测，见未完成） |
| F16 实验（P1-1） | ✅ 质量门通过 | top-1 96.16% ≥95%、KL 0.01602 ≤0.02（4995 位五段）；`STRATA_METAL_F16=1` 已写入 iq3_s config；速度收益（+9-12%）待夜间复测 |
| DeepSeek 2.0bpw 下载+128K 试用 | ⚠️ 装好但引擎慢 | 用户自装成功（run config present）；实测 0.39-1.73 tok/s vs 官方 15-16——**dsv41 0.1.57 引擎把 9335-9622 专家(80-83GB)布局到 CPU lane**（勘误：0.1.55 系 feed-mirror 停更误记，实装为官方 0.1.57 签名件）（Mac 无 PCIe lane 概念，lane 启发式失效），kimi 审查确认为平台适配缺口非配置错误；建议报官方+等引擎更新 |
| DeepSeek 2.25bpw 下载 | ✅ 分片全下完 | 4/4 SHA 验收（分片1 作者重传 +928 字节已按新 pin 4c6530 验证）；**pack 已打好（18:41）**，引擎已落仓库 `engine-dsv41/0.1.57`（setup Step 4 本地自足），安装冒烟排夜间脚本 |
| das-coder 下载 | 🔄 5/6 分片完 | Engram 110.6GB 在 xet 重建阶段 403（HF CDN 对代理 CAS 请求拒），分片 1-5 完成在 `~/gguf/deepseek/coder/IQ2_XXS/`；下载脚本模式见下"未完成" |
| Q6_K_XL 运行 | ❌ 本机不可跑（终审） | 114.8GB 自身分配吃满 ~96GB Metal 预算的结构性超限；四次 OOM+partialpin 95/85 双败+干净复审 exit 5；config 留档可复活（未来引擎/换机） |
| 官方更新检查 | ✅ 无需合并 | 3 commits 全非代码（README 赞助×2+Docker 修） |

### B. 六 ACP 智能体后端（全部完成）

| 后端 | 传输 | 实测 |
|---|---|---|
| kimi | ACP stdio（`kimi acp`） | ✅ 8.9s 实弹+全链路（/api/chat→帧回流） |
| claude | `-p --output-format stream-json --verbose` | ✅ 实弹 |
| codex | `exec --json --skip-git-repo-check` | ✅ 实弹 |
| zcode | zcode-acp-server 0.11.9 stdio | ✅ 实弹 |
| opencode | ACP stdio | 协议通；卡它家免费额度（上游不回错，我们 30min 楔子兜底） |
| dsh（DeepSeek harness） | `headless --json` | 协议通；等 DEEPSEEK_API_KEY（错误原文直达聊天） |

代码：`apps/host/server/agent/acp/{transport,backends,turns,claude-stream,codex-exec,dsh-headless}.mjs` + 聊天选择器"本机智能体"段（Native+Legacy 两版 picker 都有）。权限纪律：**默认拒绝** CLI 越权请求。

### C. UX 与界面（全部完成）

- ✅ 拖拽：附件轨道（DeepSeek 式缩略图卡+删除叉+文件夹芯片）+macOS 壳层埋点（**真实拖放验证仍待用户一次实测**）
- ✅ CJK 排版（PingFang SC 入栈+行高 1.7+14px）
- ✅ 子代理自动清理（完成 5 分钟折起/卡死中断释放槽位）
- ✅ 子代理会话查看（UX-7：/api/chat/helper-transcript+View log 全状态）
- ✅ 工作区面板（文件树+代码查看+Git 分支徽章→点击进 log 图）
- ✅ Enter/IME 时机（commit 后再 Enter 才发送）
- ✅ 流式文字/思考按 Claude/Codex/DeepSeek 式样
- ✅ 第三方模型真实上下文+思考菜单（GLM-5.3=1M；anthropic 裸 base 走 /v1/models）
- ✅ 上下文梯阶预告（kimi 必改④：tight>90%/超窗响亮建议切档，server/context-tiers.mjs+6 测试）
- ✅ 引擎独立更新侦测（/api/updates/engine+启动查+每日查，与 App 更新分离）
- ✅ i18n 纪律（locale-gaps 抓漏 s9053-s9066 ×9 语言）

### D. 插件移植（完成 3，缓行 1）

- ✅ dsh-infinite-gen-4 v0.4.0（da64f60b）
- ✅ dsh-client-auto-continue v0.17.3（自动回复，a893b013）
- ✅ dsh-ssh v0.4.15（harness node_modules 放置+真加载验证）
- ✅ auto-memory 移植收口（dsh-auto-memory **1.3.0**，非 3.3.17；'双缺口'对 1.3.0 不成立，bundle 依赖全在）：双端 node_modules 放置+profile.mjs 注册+~/.dsh/cordis.patch.yml 用户层，真加载测试通过（80bbde0a）；App 重启即生效

### E. MLX 一等公民（完成）

- ✅ mlx-bridge 控制面 :8759（tools/mlx_bridge.py：registry 13 模型、单 worker 端口池、id→path 改写、include_usage 注入）+ launchd 自启
- ✅ 13 模型注册进生产 App（"MLX on this Mac"连接）
- ✅ 战役矩阵 7 模型实测+7 张参数卡（~/strata-setup/mlx-configs/）
- ✅ 120B×2 翻案可用（战役 409=桥调度误判）；basalt 永久不可（mlx_lm 无 qwen4_exp 架构）；20b=HF 缓存损坏（tokenizer.json 补齐过但 worker 仍挂，建议删缓存重下或不修）

### F. 13 份深挖报告 TDD 落地（批次制，已完成）

批次 1-4（删除安全/写者与数据根/安全双修/构建基建）全部 commit+测试绿；MLX P0=批次 6 ✅；批次 7 的 UX 三项/lint/A2141 ✅。P1 系终态：P1-1✅/P1-2 关闭（本机不适用）/P1-3+P1-7 被 1M 战役覆盖/P1-4 下载 SHA 体系实证/P1-5✅/P1-6 意外达成/P1-8 用户关闭/P1-9 早已修/P1-10✅。

---

## 二、全部代码修改都在本仓库（36 commits，本地 main）

关键提交链（新→旧）：
```
392e76a3 P1-1 F16 解堵+质量门（quant_quality 引擎引用解析）
947d3c9b Legacy picker 的 Agents 段（入口不再依赖已加载模型）
95a99ca7 引擎独立更新侦测
8e21c595 上下文梯阶响亮预告
f578096c 六后端收尾（zcode+dsh）
00d00896 claude stream-json 后端
927e7ce1 ACP 传输层+六后端基座
95566d77/2a6786ab i18n 十二键/子代理转录
a15cbcdd/ac6886f9 分支徽章/子代理自动清理
a893b013/da64f60b 自动回复/infinite-gen 插件
79fbd03c 拖拽回滚+埋点
be9a7939 附件轨道  f457e377 IME Enter  889611bd CJK 排版
8913aa96/b00bee5d/5184edbe 第三方上下文三连
4f7fa6a0/c2221a95/2612ebf0/f783f42b/97f37461 跨评审批+GLM 1M
c2cfab03/f7c21253/3bc21f39 MLX 三连（预算规则/E2E/桥）
164eb87b F5 Storage  6d5cdc95 MCP 预设  3bfa52af stage-control
a46aa9c0 契约测试  f0e9754f v0.2.11 合并（3 冲突谁完善谁上）
（更早：批次 1-4 的 7 commits+拖拽翻转 7634b266 等）
```

**未提交的工作区改动**（有意保留，见"未完成"）：
- `metal/src/gpu/runtime.cpp`——Mac UMA 余量校正 patch（编译验证过但 SIGSEGV 嫌疑+非本机症状根因，已回滚二进制、源码留档待报上游）
- `apps/desktop/package-lock.json`（构建噪声）、`engine-dsv41/`（空目录）、杂项 untracked

## 三、仓库外的关键资产

| 位置 | 内容 |
|---|---|
| `~/strata-setup/ACCEPTANCE-LEDGER.md` | **§一~§三十一全程验收账本**（每项的证据/数字/教训） |
| `~/strata-setup/`（根） | kimi/codex/zcode 三方评审原文+1M 定夺书+R2 GPU 挂死官方报告素材（engine-issue-yarn4x-gpu-freeze.md+采样栈）+DS 引擎布局问题审查+App 留档 4 版+离线装配工具包（offline-assembly/） |
| `~/gguf/models/` | 七套 Qwen UD 模型（平铺）+mmproj |
| `~/gguf/metal/` | 四套 repacked native（*.done 标记） |
| `~/gguf/deepseek/` | 2.25bpw 四分片全（含作者重传新 pin）+ coder 5/6 分片（Engram 未完） |
| `~/.local/share/strata/install/` | 全部 run config（含 iq4_xs-v31-1m.json 1M 档；iq3_s 带 F16=1；五套带 --batch 2）+ strata-dsv41 0.1.57 引擎（官方签名件，勘误后） |
| `/Applications/Strata.app` | v0.2.11-46-g95a99ca7 定制版（含全部夜班功能） |

## 四、未完成与下一步（按优先级，2026-11-07 晚刷新）

1. **夜间纯净窗口七相**（脚本就绪 `~/strata-setup/night/final-debts.sh`，cron 23:37 点火）：CONTIG A/B + batch 1v2 + F16 复测 + **DS lane 六旋钮臂（本夜最高价值：asis96/noenv/lane_cal/stream_force/cpu_lane0/vram100，任一臂让 CPU-lane 专家数下降+tok/s 上升即为 Mac 修复旋钮）** + 20b MLX 重下 + dspark Q8_0 重下验 SHA + 2.25bpw 安装冒烟（引擎本地 0.1.57）。跑完按 results-YYYYMMDD.jsonl 入账本
2. ~~DS 大杯上游报告投递~~ **✅ 已投 [#5488](https://github.com/Niko1221/Strata/issues/5488)**
3. ~~yarn4× 报告投递~~ **✅ 已投 [#5487](https://github.com/Niko1221/Strata/issues/5487)**（同批：夜间旋钮臂若找到可用旋钮，以评论补充）
4. **UD-Q8_K_XL（506GB）**——仅 shard1 完，本机无运行目标；是否续传（SSD 流式实验？）等用户裁决
5. **用户验证项**——真实拖放一次（埋点在岗）、UX-8 分支徽章、1M 档日常使用反馈、**技能批量导入与 auto-memory 记忆注入各试一次**（App 重启后生效）
6. **harness 整包升级 0.2.2-rc.1**——npm 已发 latest；非必需（auto-memory 已在 0.2.1-alpha.3 落地），升级需 pnpm deploy 重建 234MB bundle+重打 pi-ai patch，另立夜建窗口
7. **已装 App 的 profile.mjs 不含 auto-memory insert**——插件本体已放入（真加载验证过）+ `~/.dsh/cordis.patch.yml` 用户层注册行已就位，重启 App 后 harness 自行挂载；仓库 profile.mjs 的注册行走下次 App 重建进包（双保险）

## 五、铁律（勿违反）

- **所有 commits 仅本地 main，绝不推远端**（用户 98bc625 约束）
- App 数据目录必须 Strata* 命名；模型目录=~/.strata/data/state.json 的 modelsDir
- 白天环境（用户在用机器）只跑 decode-only 实验；prefill 类必须夜间
- 大流量下载与引擎试验**不得同机同时段**（页缓存互杀，§二十七教训）
- Parallels 后台进程可常驻多日——排内存问题先 `ps aux | grep -iE "prl_|Virtualization"`
- 离线装配产物命名保留 `q.lower()` 下划线（连字符=installed/catalog 永不匹配）
- aria2 未退出/SHA 未终验前不 repack；引擎运行时不 repack

## 六、机器实验分类学（血泪沉淀）

| 类型 | 白天可跑 | 例子 |
|---|---|---|
| decode-only（无大 prefill） | ✅ | quant_quality、短 prompt 冒烟 |
| 大 prefill/长生成 | ❌ 必夜间 | 1M 战役、CONTIG A/B、drafter 对照 |
| 纯 IO（下载/pack 转换） | ✅ 但与引擎互斥 | DS 下载、2.25 转换 |
| 引擎+下载并行 | ❌ 页缓存互杀 | §二十七/欠账链五连败的根因之一 |

——交接完毕。账本（~/strata-setup/ACCEPTANCE-LEDGER.md §一~§三十三）是唯一权威过程记录。
