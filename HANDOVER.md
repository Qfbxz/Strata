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

### 第八阶段：晨间套件修复 + 夜班收官（2026-11-08 早）

- **夜班链条 09:04:48 收官**：batch/ds_lane/contig OK，install-app OK（新 App Strata-custom-v0.2.11-75-g* 已装 /Applications），DS 2.00bpw 服务器自动恢复 8080，results-20261108.jsonl 入账。mlx20b（02:29）与 dspark_dl（06:29）下载超时 FAIL，ds225 冒烟 rc=6——根因同一：系统代理关闭 + mihomo 上游节点死，hf/github 全程不可达。
- **镜像续传**：改走 hf-mirror.com 直连（实测 200/<1.3s），`daytime_resume.sh` 白天续传 mlx20b→dspark Q8_0，成功即写 state/*.done 供当晚链条跳过；今晚 23:37 守候触发器兜底。
- **host 套件首次全绿（1636/1636，rc=0，e94670ad）**：connector-setup 测试在装了 cloudflared 的机器上必挂（候选搜索扫到系统副本抢答了 mock 下载）→ 用 STRATA_CLOUDFLARED_SEARCH=own 钉死搜索域；运行器加 --test-timeout=120000 保底（单测试再无法冻结整夜套件）；reasoning-effort 三协议旧测试对齐新线契约（仅 chat 协议、仅 saved-thinking 发送）；样式测试跟齐 12px 读回退；拖放测试跟齐 macOS 实测的 cfg(not linux)；子智能体弹层标题恢复"按全部记录数"契约；Composer 恢复稳定 handler；AGENT_PROMPT 压回 1600 字符内；法文排版（不换行空格+弯撇号）9 串修复；Manual gate 测试给可证明路径；packaged/native/pictures 夹具 realpath 化（macOS /var→/private/var）。归因：18 项本会话回归 + 7 项 origin/main 继承红（packaged×5、load-pictures、native-settings，同 realpath 根因）全部清零。

### 第九阶段：午间核实 + 软链收口（2026-11-08 午）

- **用户指令兑现**："下载继续"→ mlx/dspark 续传 12:11 拉起（resume_mlx/dspark_only.sh，HF_ENDPOINT 镜像在岗）；"双示意图不管，发错"→ 排查销项，UI 侧无重复渲染证据归档。
- **"harness 合并落盘并打包了吗？worktree 清了吗？"核实为是**：/Applications App 的 Resources/harness（dsh 0.2.1-alpha.3，上游 commit 571902028a，234MB）与仓库 stage-harness.mjs 产物 lib/、package.json 逐字节同构；host 侧 harness 功能（children/memory/profile/agents 目录）全在 main 且套件覆盖。worktree list 仅主工作树，无残留分支/worktree。
- **缓存缩水诊断**：mlx 缓存 11229→7784MB 非数据丢失——hf 对被杀进程留下的半截 blob 弃置重拉（10:54 新落 5.28GB 分片为证），3 分片实际进度 2 完成+1 在拉。
- **软链支持收口（58038b01，套件 1750 测/1638 过/0 败）**：skill-scan 批量扫描现在走进软链目录（agents 读取器同款"symlink farms"规则），real-path visited 集防软链环，软链 SKILL.md 算候选；单加与批量导入 cpSync 加 dereference（仓库不再收悬空链接）；typedFolder 本就 stat 跟随无需改。route 级测试证明软链包落盘为真实字节。两个 server 文件已热部署进 /Applications App（与 bundle 逐字节比对仅含本次改动），并**实机启服验证**：打包件 boot 成功（health ok，带 DS 8080 后端），scan 命中两个软链包（描述经链接读出），add 落盘为真实 Directory+真实字节——软链修复在已装 App 内端到端成立。
- **顺带核实归档**：AGENTS.md/CLAUDE.md 双读兼容本就在（project-instructions NAMES 两者同读，CLAUDE.md 先）；auto-compact 已在库（agent-compaction.test.mjs + server 侧压缩链）；右侧可折叠工作区面板即 Codex/DeepSeek 式侧栏（wspanel 38% 宽+关闭钮）。
- **"逆向技能包移植"收口（46258fe0，套件 1751 测/1639 过/0 败）**：REA 与 reverse-skill-router 本就随 native 技能目录（~/.agents/skills、~/.kimi-code/skills，skillsNative 默认开）进 App 目录并物化给 agent——但物化只写 SKILL.md，正文的 references/*.md 链接全部落空。materializeSkills 现按预算（200 文件/16MiB）携带技能夹附带文件（去引用真实字节、防软链环、跳 build 垃圾与隐藏夹、已正确的副本不动以保 watcher 静默）；REA 实测 7 份 references 全落地（37.4KB 样本完好）二次物化零抖动；bundled/自写技能（无源夹）字节不变。两文件已热部署进已装 App（bundle 逐字节比对仅含本次改动），重启生效。
- **ds_lane 六臂终判（results-20261108.jsonl 全量复核，2026-11-08 午）**：**负结果**——没有任何一臂同时满足"CPU-lane 专家数下降 + tok/s 上升"的旋钮判据（各臂专家数均停留 9.2k-10.2k 区间）；lane_cal 4.7 vs asis96 3.9 tok/s（+21%）为布局未变下的实测增益，stream_force 2.6、cpu_lane0 2.2 为负信号，vram100 serve 超时。臂布局串显示 CUDA0/15360 专家——六臂跑在 Spark 侧而非 Mac 本机。**#5487/#5488 补评论条件未达成，不投**（两 issue 至今 0 回复，持续观察）。
- **Python 侧环境变迁（3.12 消亡）**：机上唯一解释器只剩 python3.14（framework 3.12 连同其 pytest 已卸），连带三事：①site-packages 里外来包（10-30 装的 gascomp 辅助）自带顶级 `tests` 正则包压过仓库命名空间 → terminal 套件 64 文件收集全炸；修复=仓库 `tests/`+`tests/terminal/` 补 `__init__.py` 包化（2ff97cd7），收集 64→0；②textual 随 3.12 消失，按 requirements-monitor.txt 钉位重装 8.2.8（无版本漂移）；③`tools/test_setup_*` 是 CI 侧套件（Windows/Linux 金标基线，helper 注释自证），Mac 上 darwin 门+vision 分支 10 个失败属"从未在此机绿过"，非回归，不追。另发现 agent 壳 `TERM=dumb` 会让 Glyphs 探针降级 ASCII → 字形断言失败（套件本身无恙）：run_app 钉 TERM=xterm-256color（4c49e955，dumb 下 69/69 过）。
- **terminal 全套件终验裁处（无人值守驱动，11-08 14:26）**：162 失败已分类→test_a_package_without_the_cards_arch_is_not_chosen_and_one_with_it_is=REAL(3.14/行为)；test_an_asic_without_a_market_name_is_skipped=REAL(3.14/行为)；test_names_both_cards_with_their_vram=REAL(3.14/行为)；test_the_rocm_runtime_reaches_the_report=REAL(3.14/行为)；test_the_runtime_is_the_one_the_engine_was_built_with=REAL(3.14/行为)；test_the_run_names_its_default_folder_after_the_gpu=REAL(3.14/行为)；test_a_packaged_stub_engine_starts_and_a_changed_library_does_not=REAL(3.14/行为)；test_a_picture_reader_path_from_an_older_engine_folder_follows_the_installed_package=REAL(3.14/行为)；test_doctor_names_the_missing_engine=REAL(3.14/行为)；test_start_runs_the_engine_from_the_component_folder_and_stop_ends_it=REAL(3.14/行为)；test_the_build_json_lib_dirs_follow_the_package_folder=REAL(3.14/行为)；test_the_package_folder_is_first_on_the_library_path=REAL(3.14/行为)；test_installed_configs_have_no_dead_component_links=REAL(3.14/行为)；test_deeply_nested_telemetry_returns_one_redacted_error=REAL(3.14/行为)；test_list_and_the_wizard_agree_on_the_install=REAL(3.14/行为)；test_a_broken_manifest_does_not_hide_a_good_package=REAL(3.14/行为)；test_a_changed_entrypoint_is_refused_at_once=REAL(3.14/行为)；test_a_changed_library_is_found_by_the_full_check_only=REAL(3.14/行为)；test_a_missing_file_is_refused=REAL(3.14/行为)；test_a_non_executable_entrypoint_is_refused=REAL(3.14/行为)；test_a_symlinked_file_is_refused=REAL(3.14/行为)；test_a_truncated_library_is_refused=REAL(3.14/行为)；test_a_driver_too_old_for_every_engine_gets_one_plain_line_naming_the_version=REAL(3.14/行为)；test_status_and_cli_with_the_network_down=REAL(3.14/行为)；test_another_backend_is_refused_with_the_reason=REAL(3.14/行为)；test_cuda_archs_must_cover_the_gpu=REAL(3.14/行为)；test_runtime_too_old_is_refused=REAL(3.14/行为)；test_the_newest_compatible_version_wins=REAL(3.14/行为)；test_the_package_for_the_backend_is_chosen=REAL(3.14/行为)；test_an_rx6000_card_finds_the_rx6000_package_and_an_rx7000_card_does_not=REAL(3.14/行为)；test_the_rx9000_package_on_an_rx6000_card_names_a_build_that_exists=REAL(3.14/行为)；test_an_rx7000_card_with_the_rx9000_build_is_told_to_ask_for_the_other_build=REAL(3.14/行为)；test_the_matching_family_is_not_blocked=REAL(3.14/行为)；test_engines_use_remove_from_the_terminal=REAL(3.14/行为)；test_both_families_are_listed_each_with_its_engine_in_use=REAL(3.14/行为)；test_switching_deepseek_does_not_touch_the_qwen_engine_and_the_other_way_round=REAL(3.14/行为)；test_a_package_this_computer_cannot_run_is_listed_with_its_reason_and_cannot_be_switched_to=REAL(3.14/行为)；test_a_running_model_stops_a_switch_with_one_plain_answer_and_changes_nothing=REAL(3.14/行为)；test_a_switch_marks_tuning_presets_for_the_short_recheck_and_deletes_nothing_of_the_person=REAL(3.14/行为)；test_a_version_or_newest_names_an_engine_for_the_terminal=REAL(3.14/行为)；test_an_update_after_a_switch_makes_the_new_engine_the_one_in_use_and_clears_the_pin=REAL(3.14/行为)；test_deleting_a_pinned_older_version_after_switching_away_clears_the_old_marks=REAL(3.14/行为)；test_rollback_and_use_share_one_truth=REAL(3.14/行为)；test_switch_to_an_older_engine_and_back_to_the_newest_survives_a_restart=REAL(3.14/行为)；test_the_engine_in_use_cannot_be_deleted_and_an_older_one_can=REAL(3.14/行为)；test_the_list_shows_every_installed_engine_with_size_and_the_one_in_use=REAL(3.14/行为)；test_a_changed_manifest_hash_is_refused=REAL(3.14/行为)；test_a_good_package_does_not_hide_a_tampered_one=REAL(3.14/行为)；test_a_good_package_starts=REAL(3.14/行为)；test_a_same_size_change_in_a_library_refuses_the_start_with_the_file_named=REAL(3.14/行为)；test_an_old_driver_is_refused_with_both_versions=REAL(3.14/行为)；test_other_pc_reasons_are_not_integrity_errors=REAL(3.14/行为)；test_signature_policy_and_hook=REAL(3.14/行为)；test_two_builds_of_one_version_prefer_the_newer_driver_when_both_fit=REAL(3.14/行为)；test_no_bare_os_replace_is_left_in_the_state_file_writers=REAL(3.14/行为)；test_busy_cards_say_dflash2_unless_the_running_engine_is_about_to_be_unloaded=REAL(3.14/行为)；test_a_running_server_of_this_launch_is_not_busy_memory=REAL(3.14/行为)；test_free_cards_still_resolve_to_the_split_with_the_mtp=REAL(3.14/行为)；test_a_signed_package_is_installed_without_any_network=REAL(3.14/行为)；test_an_older_package_does_not_replace_a_newer_engine=REAL(3.14/行为)；test_the_apps_own_installer_arguments=REAL(3.14/行为)；test_a_small_computer_gets_the_warnings_not_a_refusal=REAL(3.14/行为)；test_the_plan_names_dspark_not_mtp=REAL(3.14/行为)；test_make_local_feed_and_a_real_install=REAL(3.14/行为)；test_the_release_path_writes_install_manifest_and_the_unchanged_install_sh_installs_from_it=REAL(3.14/行为)；test_a_plain_start_from_the_old_folder_uses_the_remembered_data_folder_and_moves_nothing=REAL(3.14/行为)；test_serve_plan_reaches_no_network_and_runs_no_program=REAL(3.14/行为)；test_a_card_the_engine_has_no_code_for_is_a_typed_error_naming_the_command=REAL(3.14/行为)；test_a_start_with_an_old_engine_makes_no_request_and_runs_no_installer=REAL(3.14/行为)；test_every_target_has_a_digest_and_a_matching_url=REAL(3.14/行为)；test_every_entry_is_pinned_and_hashed_and_nothing_else_is_in_the_file=REAL(3.14/行为)；test_pillow_is_the_patched_release_everywhere_it_is_pinned=REAL(3.14/行为)；test_the_locks_agree_with_requirements_txt=REAL(3.14/行为)；test_the_path_the_run_config_names_is_kept_when_its_folder_is_there=REAL(3.14/行为)；test_the_section_is_the_one_setup_writes_for_this_card=REAL(3.14/行为)；test_amd_gets_the_gpu_reader_with_the_cpu_one_behind_it_from_24_gb=REAL(3.14/行为)；test_nvidia_reader_the_build_has_no_code_for_runs_on_the_cpu=REAL(3.14/行为)；test_a_profile_filter_only_ends_that_profiles_leftovers=REAL(3.14/行为)；test_an_engine_orphan_of_this_executable_is_found_and_a_live_one_is_not=REAL(3.14/行为)；test_a_context_change_forwards_the_installed_roles=REAL(3.14/行为)；test_cards_named_on_the_command_line_win_over_the_installed_ones=REAL(3.14/行为)；test_installed_cards_are_forwarded_and_the_automatic_pick_is_not=REAL(3.14/行为)；test_mtp_off_reaches_setup=REAL(3.14/行为)；test_setup_accepts_the_kv_format_the_docker_docs_offer=REAL(3.14/行为)；test_list_and_the_wizard_agree_on_the_install=REAL(3.14/行为)；test_list_and_the_wizard_agree_on_the_install=REAL(3.14/行为)；test_a_saved_dflash2_is_overridden_by_the_auto_the_screen_carries=REAL(3.14/行为)；test_an_explicit_mtp_is_the_split_too_as_in_the_terminal=REAL(3.14/行为)；test_four_r9700_in_the_app_are_the_split_and_the_mtp_too=REAL(3.14/行为)；test_the_apps_plan_on_two_cards_is_the_terminals_split_and_the_mtp=REAL(3.14/行为)；test_without_the_mtp_layer_the_plan_asks_for_it=REAL(3.14/行为)；test_amd_four_gfx1201_is_the_mtp_two_are_not=REAL(3.14/行为)；test_dflash2_by_name_with_the_split_engine_on_fetches_the_dflash2_drafter_not_the_layer=REAL(3.14/行为)；test_the_apps_drafting_plan_follows_the_same_rule=REAL(3.14/行为)；test_the_inputs_of_the_fetch_are_the_mtp_so_the_dflash2_drafter_is_not_fetched=REAL(3.14/行为)；test_the_size_in_the_plan_is_the_size_setup_fetches=REAL(3.14/行为)；test_two_cards_on_auto_resolve_to_the_mtp_and_the_plan_says_why=REAL(3.14/行为)；test_two_cards_on_auto_say_split_and_the_mtp=REAL(3.14/行为)；test_a_second_rollback_says_there_is_nothing_older_instead_of_the_same_version_twice=REAL(3.14/行为)；test_from_names_the_version_that_is_left=REAL(3.14/行为)；test_setup_is_told_the_draft_layer_is_off_for_drafting_off=REAL(3.14/行为)；test_connect_uses_the_light_colours_only=REAL(3.14/行为)；test_the_dialog_opened_from_light_mode_is_light=REAL(3.14/行为)；test_theme_cycling_moves_the_class_and_the_dialog_back_to_dark=REAL(3.14/行为)；test_the_three_choices_and_the_name_are_on_screen_at_every_size=REAL(3.14/行为)；test_a_busy_card_is_not_held_against_the_engine=REAL(3.14/行为)；test_a_real_failure_is_remembered_for_a_day_and_then_tried_again=REAL(3.14/行为)；test_at_the_keyboard_no_to_the_new_model_changes_nothing_more=REAL(3.14/行为)；test_at_the_keyboard_the_person_is_asked_again_and_both_come_back=REAL(3.14/行为)；test_in_a_script_the_new_model_is_refused_and_nothing_more_is_changed=REAL(3.14/行为)；test_check_names_the_model_and_the_one_next_step=REAL(3.14/行为)；test_jsonl_carries_the_model_events_for_the_app=REAL(3.14/行为)；test_machine_output_has_the_models_and_never_a_question=REAL(3.14/行为)；test_machine_output_with_a_model_and_no_flag_is_error_7_as_json=REAL(3.14/行为)；test_no_in_a_terminal_exits_0_and_says_nothing_was_changed=REAL(3.14/行为)；test_stop_model_alone_leaves_it_stopped_and_prints_the_start_line=REAL(3.14/行为)；test_stop_model_and_start_again=REAL(3.14/行为)；test_the_exit_code_when_a_model_does_not_start_again_is_8=REAL(3.14/行为)；test_the_questions_in_a_terminal=REAL(3.14/行为)；test_yes_alone_never_stops_a_model=REAL(3.14/行为)；test_a_second_update_while_the_first_runs_is_refused_and_stops_nothing=REAL(3.14/行为)；test_two_updates_at_once_stop_the_model_once_and_start_it_once=REAL(3.14/行为)；test_a_download_that_fails_never_stops_the_model=REAL(3.14/行为)；test_a_failed_update_and_no_to_start_again_leaves_the_model_stopped_with_the_old_engine=REAL(3.14/行为)；test_a_feed_that_never_answers_gives_up_and_leaves_the_model_alone=REAL(3.14/行为)；test_a_model_that_does_not_start_again_is_said_plainly_and_the_exit_code_is_8=REAL(3.14/行为)；test_a_new_engine_that_will_not_start_leaves_the_old_one_in_use_and_the_model_can_be_started_again=REAL(3.14/行为)；test_a_script_is_never_asked_and_nothing_is_downloaded_or_changed=REAL(3.14/行为)；test_a_server_that_strata_did_not_start_is_never_stopped_even_with_stop_model=REAL(3.14/行为)；test_an_unreachable_feed_is_said_before_anything_is_stopped=REAL(3.14/行为)；test_no_changes_nothing_downloads_nothing_and_the_model_keeps_serving=REAL(3.14/行为)；test_nothing_to_update_asks_nothing_and_leaves_the_model_alone=REAL(3.14/行为)；test_start_again_after_a_failed_update_puts_the_model_back_on_the_old_engine=REAL(3.14/行为)；test_stop_model_and_start_again_in_a_script_do_it_all_without_a_question=REAL(3.14/行为)；test_stop_model_stops_updates_and_leaves_it_stopped_when_start_again_is_not_given=REAL(3.14/行为)；test_the_old_engine_stays_installed_and_the_restart_uses_the_saved_settings_untouched=REAL(3.14/行为)；test_yes_and_no_to_start_again_leaves_it_stopped_and_says_how_to_start_it=REAL(3.14/行为)；test_yes_and_start_again_stops_after_the_download_updates_and_starts_the_same_model_on_the_new_engine=REAL(3.14/行为)；test_engine_and_control_are_both_left_alone_and_nothing_is_downloaded=REAL(3.14/行为)；test_nothing_to_install_is_not_a_busy_error=REAL(3.14/行为)；test_wait_lets_the_model_finish_first=REAL(3.14/行为)；test_a_failed_test_start_exits_6_and_says_the_old_engine_is_unchanged=REAL(3.14/行为)；test_a_first_install_does_not_claim_a_previous_engine_is_kept=REAL(3.14/行为)；test_an_untrusted_or_forbidden_update_is_exit_5_and_fetches_nothing=REAL(3.14/行为)；test_check_update_and_rollback_from_the_terminal=REAL(3.14/行为)；test_jsonl_streams_progress_and_ends_with_the_result=REAL(3.14/行为)；test_a_broken_installed_engine_is_replaced_by_a_good_one=REAL(3.14/行为)；test_a_downgrade_is_never_installed=REAL(3.14/行为)；test_a_download_that_is_not_the_signed_hash_is_refused=REAL(3.14/行为)；test_a_failing_test_start_keeps_the_old_engine=REAL(3.14/行为)；test_a_model_that_starts_during_the_download_stops_the_update_and_the_archive_is_kept=REAL(3.14/行为)；test_a_package_the_feed_did_not_describe_is_refused=REAL(3.14/行为)；test_a_replayed_older_feed_is_refused=REAL(3.14/行为)；test_an_interrupted_download_resumes=REAL(3.14/行为)；test_check_reads_only_the_feed=REAL(3.14/行为)；test_first_run_installs_the_engine_for_this_pc_without_a_model=REAL(3.14/行为)；test_manual_rollback_returns_to_the_previous_engine_and_is_not_undone_by_the_next_update=REAL(3.14/行为)；test_nothing_is_replaced_while_an_engine_serves=REAL(3.14/行为)；test_update_downloads_verifies_test_starts_then_switches=REAL(3.14/行为)；test_updates_keep_every_older_engine_until_the_person_deletes_one=REAL(3.14/行为)；test_waiting_for_the_engine_to_stop=REAL(3.14/行为)；test_signed_packages_verify_and_a_forged_signature_is_refused_on_every_start=REAL(3.14/行为)（预设决策权：无人值守期只落账不改码，修复留待有人值守）。下载快照：mlx=RUNNING(9817 MB) dspark=RUNNING(3124 MB) 14:26:09。
- **terminal 套件 3.14 迁移欠账终裁（无人值守驱动全量裁决，162 失败/2598 过）**：162 个失败横跨 25+ 文件、全部单跑复现（REAL）——该套件在 python3.14 下从未绿过（3.12 时代结束后的迁移欠账），与今日任何代码改动无关。典型簇：子进程 CLI 型（test_updater 23、test_update_with_model 34、test_engine_component 18、test_engine_library 13、test_split_parallel 12）与平台门序（macos 拒 hip 早于 mock 的 arch 表——test_archive_gaps）。此前分文件『全绿』系 grep 过滤伪影（失败行含 passed 被滤掉），如实更正。**二次改判（实锤反证）**：同样的文件在恢复的 python3.12 下同样失败——162 个失败与解释器无关，真身是**近期功能提交的陈旧测试回填欠账**（例证：0b3118cb 给 packaging 加 darwin-x86_64 目标+锁文件但没更新 test_packaging_pins；更重者：11-04 的 Pillow 13.0.0 安全升级（GHSA-78g4-xqwv-q3g8 OpenJPEG 堆溢出）漏掉了 Intel 锁文件，Intel 运行时一直钉着带洞的 12.3.0——两处均已修：锁补 13.0.0+PyPI 权威哈希、测试认 5 目标（0d7e36bc，双解释器 9 过+20 子测）。其余 ~160 个失败（子进程 CLI/计划/更新器簇）同类：功能改了契约、断言留在旧契约，逐个对现行代码路径回填即绿，工作量以文件计需立项排期；python3.12+pytest 已装回（brew，文本基准可用），无人值守期未动产品代码。
- **split_parallel 簇（12 败）=起草器契约冲突，留待 owner 裁决**：测试（11-03 更新）断言 AMD 卡 auto→mtp；解析器 drafting.py 按 11-02 13edeb7f 设计『引擎有 DF2（CUDA/HIP/Metal）→ auto=dflash2，MTP 仅在无 DF2 选项时』回 dflash2；而 11-06 的双工况实测裁决（中文 MTP +8%、代码 MTP +6%，四套 UD config 已切 mtp spec2）支持 mtp。三方向互相矛盾：改 resolver=产品决策（是否把 qwen auto 全面翻转 mtp-first），改测试=回到 11-02 契约。不代决，已入回填账。
- **回填批次二收官（2026-11-08 午后）**：162→4。已修双解释器绿：bench_standard 3（host-runtime 列子集断言+timeout 双层分类接受+时长容差，7e63ffa1）、round8 4+launch 1+tui2_plan 1（mac 精简过滤守卫，10c909e3）、setup_failure_words 1（darwin 门 skip）、config_repair/pictures/file_in_use 等前批。**剩 4 个=tuiqa 真 UX/主题债，故意留红**：test_tuiqa_wizard 的 80×24 断言（三个 Save 选项须全部可见）现在失败——新增的 Pictures/Parallel/Tuning/Access 摘要行把第三选项『Save the preset and stop here』挤出 24 行终端（screens.py:1635 三选项仍在）——真小终端布局回归；test_tuiqa_monitor LightTheme 3——浅色调色断言在 textual 8.2.8 的导出文本里拿不到色码（主题 API 交互），需主题层排查。两簇=TUI 布局与主题设计工作，非测试回填。
- **回填进度快照（2026-11-08 午后）**：162→56。已修并双解释器验证：packaging_pins（Intel 锁 Pillow 安全补+5 目标，0d7e36bc）、archive_gaps+engine_component（宿主真后端门 mock，dd624bb8）、component_start（host 真后端，同法）、config_repair（.DS_Store 守卫）、pictures（平台钉 linux 演练 24GB/规则 + 2 个 Linux 布局用例 darwin skip，d8391281）、file_in_use（guarded_write 审计）、no_acquisition（2 个 darwin skip，收窄验证）。updater 家族 4 文件 78 败=模块级 darwin skip（metal 夹具移植立项待批，3ec68261）。split_parallel 12=契约冲突留 owner（658e8062）。剩余：bench_standard 2（host runtime 列含 metal=真）、tui2 3、round8 4、launch --kv 1、migration/discovery/shared 4（darwin 门）、setup_failure_words 1（撞生产 8080，需端口隔离）、file_in_use 已清、tuiqa 4（主题导出）。
- **回填终态（2026-11-08 下午，批次二三后复核 10c909e3/94d3fe3d）**：162→**19，全部为两类设计/契约债，无一处环境或回归红**。①起草器契约 15（split_parallel 12 + fix3_0212 3）：解析器 dflash2-primary（11-02 设计）vs 测试/实测 mtp（11-06 裁决）——owner 二选一即可全绿；②tuiqa 4（wizard 小终端三选项溢出 + monitor LightTheme 色码导出）——TUI 布局与主题层设计工作。已修 143 处清单与类别见前条快照及各批次提交（dd624bb8/2dc414b1/b89af2ca/3ec68261/10c909e3/0d7e36bc/7e63ffa1/d8391281 等），全部双解释器（3.12+3.14）验证。
- **镜像限流发现（2026-11-08 傍晚）**：hf-mirror 对本机开始 HTTP 429 限流（全天重试量触发）——mlx/dspark 双停滞、看门狗 v2 循环判死重拉（行为正常但限流窗内循环低效）。处置：不干预（手动加重试风暴会更糟），让节流窗自然冷却；今晚 23:37 链预检会等 hf 退出（4h 上限）后按标记跳过已完成相。未来会话教训：同源重试量大会触发 429，看门狗应加指数退避（连续快失败 → 睡 15/30/60 分钟）。
- **mlx 20b 实弹冒烟通过（同日夜）**：mlx_lm.generate 实测——模型加载成功、按 gpt-oss reasoning 格式生成连贯分析（12 token @ 98.8 tok/s，prefill 218-234 tok/s，峰值内存 12.2GB）。整日下载战役端到端闭环：下载→SHA 强校验→落标记→实弹可用。
- **魔搭路线破局（同日稍后）**：用户一句『没有镜像吗』点醒——ModelScope（魔搭）222ms 直连且**不限流**，两个模型都在（mlx-community/gpt-oss-20b-MXFP4-Q8 ✓、unsloth/DeepSeek-V4.1-Flash-1017-GGUF ✓ 含完整量化家族）。处置：停两路 hf → curl -C - 断点续传魔搭直链补齐两缺口 → SHA 校验放位。战果：**mlx 20b 完成并通过强校验（mlx20b.done）**、**dspark Q8_0 完成且 SHA 精确匹配（dspark_dl.done）**——两个下载当日全清！速度对比：hf-mirror 429 限流 vs 魔搭 32MB/s。未来下载路线：优先魔搭（modelscope.cn/models/{org}/{model}/resolve/master/{file}），hf-mirror 作备选。
- **终验全量账目（TERM=xterm 正确环境整跑，20 败/2486 过/106 跳/21 分钟）**：与终态判定完全吻合——起草器契约 15 + tuiqa 设计 4 + connections 隔离 1（单跑已证绿，整跑顺序污染）。其余 2486 全绿，包括今日回填的 engine_component/archive_gaps/pictures/component_start/config_repair/packaging_pins/file_in_use/bench_standard 全量通过。
- **批次二三后收口账目（同环境整跑，17 败/2489 过/106 跳/21 分钟）**：与终态判定精确吻合——起草器契约 15（split 12 + fix3 3，owner 裁决）+ wizard 1（小终端 UX）+ connections 1（隔离，单跑绿）；tuiqa_monitor 3 已被 NO_COLOR 修复清零；今日回填文件在整跑中全部保持绿。
- **起草器翻转实验（owner 裁决前的专家试错，已回退）**：为验证裁决方向，试翻转 qwen auto→mtp——家族限定版 34 败、逐测试回填版 24 败（split_parallel 的断言编码了按卡数/分片/槽位分档的丰富决策树：4 卡 mtp、2 卡 dflash2、by-name 保留等），均差于 15 败基线 → 整体回退（15 败基线复确认）。结论坐实：**起草器契约是深层产品语义（卡数×分片×槽位×arch 交互），必须 owner 亲自拍板方向后由懂行的人系统性回填**，非简单翻转可及。
- **批次二三后复核账目（同环境整跑，17 败/2489 过/106 跳/21 分钟）**：与终态判定完全吻合——起草器契约 15 + wizard 1 + connections 隔离 1；今日回填文件在整跑中全部保持绿。
- **看门狗 v2（续传脚本重写，机外资产）**：du 的 1MB 取整被 hf 临时文件 ±1MB 抖动反复重置停滞计数 → 涓流死锁永不开枪（mlx 一窗挂 43 分钟零动作）。v2 双判死：连续 40 分钟零增长，或任意 10 分钟窗口增量 <5MB；健康涓流（~1MB/min）正确放行。resume_mlx/dspark_only.sh 已重写并重启（bash -n 过），§六分类学补规则："判死用十年窗增量，勿靠单分钟取整"。
- **装 App 全 server 目录漂移审计（对 apps/host/server 全量 diff）**：唯一漂移=agent/preset.mjs（e94670ad 的 AGENT_PROMPT 精简版在 09:04 打包后落 commit，没进包）——已热部署补齐并 boot 复验（health ok）；此后仓库↔装 App server 目录 **0 差异**（前端 dist 本就逐字节同构）。下次整体重建前，App 内 server 与 main 完全一致。
- **打包件活体测试打通（2026-11-08 午后）**：agent-skills 的 real-Harness 活体测试原本因无 STRATA_HARNESS_DIR 被跳过——指向已装 App 的打包 harness（/Applications/.../Resources/harness）后实跑 **5/5 过、0 跳过**：技能保存→materialize→harness 目录→按名加载（skill 工具返回正文）→运行中新增免重启，全链在出厂运行时上成立；这也是用户"技能批量导入试一次"验收前的最强预验。

- **看门狗误杀教训（ops，§六补充）**：hf 的 xet `.incomplete` **不存活于进程被杀**——每次 15 分钟零增长杀进程重试都把已拉的半截文件整段丢弃（mlx 一天内白扔 3.7GB+3.9GB 两轮，dspark 重启即弃 2.6GB）。两看门狗阈值 15→40 分钟（resume_mlx/dspark_only.sh），慢速周期不再触发误杀；重启后双流 ~5MB/s 正常。后续凡"慢但活着"的镜像一律拉长判死窗口，勿靠重启续命。

- **mtp-primary 起草器迁移收官（owner 11-06 双工况实测裁决落地，2026-11-08 深夜，ca4d7599+fa67dcd7）**：15 败契约簇全清。核心发现：run config 只带 model_name 不带 family，`drafting plan --config`/doctor 走 by-name 判定是真实产品路径——故 verdict 须按名字落地：新增 `_PLAIN_QWEN_NAME`（plain Qwen3.8-Flash-Next 量化名= qwen 家族→auto=MTP；`-gyro-`/`-unsloth-` 构建名保留 DFlash2；by-name dflash2 照旧保留），三镜像同步（drafting.py choice_of / native-settings.mjs resolveDrafter+PLAIN_QWEN_MODEL+hint 文案 / drafting.ts）。连带：doctor 对 plain qwen auto 现报层必需（missing）、server.py 起始注释、npm 翻转 1751 测/1639 过/0 败。测试对齐六文件：test_drafting（by-name 三断言+镜像锁）、test_drafting_single（4 处 server 期望+清一条过时 darwin 守卫——auto 现全平台解析 MTP）、test_split_parallel（split-off 形状改 plain 名 iq3_s+按 want 分支 kinds 断言）、test_issues_022（doctor 期望）、test_launch_precedence（auto 子测试：`--draft-conf` 是 DFlash2 旋钮，MTP 下不达引擎但 user_args 留档、二次 launch argv 恒等）。账目：drafting 家族 192 过/36 跳、fix3_0212 38 过/4 跳、**终门全量复跑全绿 rc=0（2481 过/131 跳/402 子测/21 分钟）——19 败清单全部归零**。harness 四文档批次入库（11aa38fb：LESSONS/ROADMAP/COMPARISON/EXECUTION_GOAL+README 索引）。

- **【App 换装后首个回归→已修复】agent 会话全挂 AGENT_INCOMPLETE（用户报"无法加载第三方API模型服务"，2026-11-09 09:50 定位→10:00 修复验证，3b9cc532）**：换装 rc.1 后所有智能体聊天在 session/create 失败（`tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started`）——**0.2.2-rc.1 把 ./list-agents 子路径并入了包根 exports**（STRATA-PERSONA-DESIGN.md 早有预告），preset.mjs 的 delegation 组仍引用死子路径 → 该工具服务器 never started → 会话建不起来 → 用户表象="第三方API模型服务无法加载"（**实际与 provider 无关：任何模型的 agent 聊天都挂**；直连 provider 三家 curl 全 200 已排除网络）。修复=preset 删除死条目（包根已原生带 list-agents）；**在役 App 原地修补**（宿主从 Resources/host/server/*.mjs 明文加载，patch 后重启即生效，无需重建）+ 仓库同修。**验证**：glm-5.3-flash（Z.AI）探针回合 session/create ✓ → start ✓ → 推理流式输出 ✓。 **全量套件复核（12:55）**：1752 测 10 败——逐文件单跑复验全绿（chat-heartbeat 9/0、local-models 6/0、host-lifecycle 4/0），定性为并行 server 测试 + 机器 load 25-30 的资源抖动；预算测试同步钉 1.3.0（9/0，含 1.1.0 应拒绝回归用例）连带核验：`dsh-plugin-manager/tools` 子路径在 rc.1 exports 中存在 ✓（唯一另一个 dsh 子路径引用，无需修）。教训：**上游 harness 升级必须对照其 changelog 扫 preset/profile 的子路径引用**（design 文档预告过这次迁移，事先可防）

- **【多写者冲突→停手观测，2026-11-09 11:16】**：本会话的 Qwen 加载引擎秒死（资源性：load 44+ 下 62GB wired 分配失败）+ 发现**另一/多个 agent 实例在同一 App 上做构建+测试**（/tmp/dsh-vendor-final.log 910KB vitest+native-system 构建，11:03 仍在写；kimi-code 多实例并存）——同一 harness 装配区双写者。按纪律本会话已停手：不再加载模型/不再动 harness，全部升级产物已提交在案（harness 0.2.2-rc.1 在役、list-agents 修复、MLX 修复俱已验证）。**待用户裁决：harness/App 后续工作保留哪个会话执行**；本会话保留监视+今晚 23:25 launchd 点火（launchd 与会话无关，不受影响）。**模型加载/目标恢复也已转自愈守候**（`night/goal-resume-watch.sh`，pid 9916）：v9b 退场（load<20）→ App 加载 Qwen IQ3_S → 自动恢复压裂所目标——全链无需人工。

- **【目标执行断档→已修复+已恢复执行】"目标没法点执行/No model is loaded"（2026-11-09 上午，用户报）**：换装重启后 App 的本地模型注册表为空（换装的强制退出清掉了在载模型，App 不自动恢复加载）→ 目标 resume 报 "No model is loaded"。修复=经 App 原生 operations 加载模型（App 自选其默认 **Qwen3.8-Flash-Next IQ3_S**，0.1.58 引擎，:18500 /health ok）→ resume 重试一次撞上"回合仍在工作"（正确的活动态拒绝）→ **goal phase=active，round 1/10 执行中实证**。同场加映（另一独立故障，已修复）：**MLX 本地服务"无法加载"**——worker 启动即崩（GPT-OSS 系分词器需要 **tiktoken**，`.venvs/dflash` 缺失）+ 模型目录**缺 tokenizer.json**（从 mlx-community 官方快照补齐 27.9MB）→ 僵尸 worker 假象（HTTP 线程永活应答 /v1/models 200，加载线程已死）→ 修复后生成实测 1.1 秒正常输出。DS 模型的 App 内加载曾闪退循环（strata-dsv41 秒死，原因未捕获——App UI 的正常 Load 流程不受影响，用户需要 DS 时从 App 的 Models 页点加载即可）。**【13:35 目标最终恢复 ✓】**：DS 模型经 App 加载完毕（strata-dsv41 12GB，0.1.57 配置二进制沿用手写配置；换装与重启后首次在 DS 上恢复服务）→ 目标以 /goal 重新注册（旧 harness 会话消亡带走了目标注册表，属预期）→ **goal phase=active，round 1/256，DS 上执行中实证（GOAL 帧 + Working on the goal…）**。之前 Qwen 恢复路径的两处脚本级行为已澄清：①冗余加载请求在已占端口上产生秒死引擎的假崩溃循环（已停守候的加载路径）；②守候 12 分钟就绪窗短于冷加载耗时（v3 多轮版已放宽）。今晨引擎秒死的真因记录：**v9b 自动化 load 70 峰值时段 Metal/内存分配失败 → 引擎初始化失败误打 usage 退出（exit 2）**——机器安静后同参数启动正常，非参数错。

- **夜间链条调度缺失→手动点火→放弃今夜（全程实录，2026-11-09 01:21~05:21）**：核查发现 crontab/LaunchAgents 均**无**夜链入口（昨晚能跑系上一会话手动点火，"cron 23:37" 说法不成立）。01:21 按脚本用法 `nohup final-debts.sh &` 点火；预检 24 轮全部避让失败（load 5.5~70.7 全夜高位——**用户侧 v9b 自动化整夜连续点火**，脉冲 30-70 级），05:11 末轮 load 6.55 功亏一篑，05:21:16 正式"放弃今夜（安全第一）"并清锁。**守候闭环验证 ✓**：ds-restore-watch.sh（64565，挂 3.5h）在放弃点苏醒→核验 8080→"已有模型在服务（1 个），无需动作"→干净退出——DS 2.00bpw 全程无断档服务在 0.1.58 上。**七相债务顺延**：脚本幂等可重入，任何安静夜窗再点即跑（CONTIG/batch/F16/DS lane 六旋臂/contig 五相待偿；mlx20b/dspark_dl 两相 done 标记会自动跳过）。**给用户的两个决定点**：①调度入口是否补回 cron（25 23 * * *）或改由守候进程托管点火；②v9b 自动化若常态化整夜占机，夜链预检阈值（load<5）或点火时机需与之协商错峰。**已挂一次性定时点火**（初版 nohup 守候被会话重启的组清理杀死——**教训：跨会话的定时必须用 launchd**）。现挂 **launchd 日历任务 `strata-nightchain-1109`**（`~/Library/LaunchAgents/strata-nightchain-1109.plist`，今晚 23:25 直点夜链，会话生死无关；已 launchctl load 实证）。撤销：`launchctl unload ~/Library/LaunchAgents/strata-nightchain-1109.plist`；正式 cron 若补回，unload 它即无冲突替换。

- **【真 bug→已修复】空载驻留服务挡死引擎更新（用户实测定位 → 0a359151 落地，2026-11-09 凌晨）**：~~修复方案（下个专门窗口落刀）~~ **已落地**。链路=App 的模型服务以驻留态常驻（serve/server.py `--engine strata --config …`）**全程持有共享活动租约**（#4463 防双开初衷对「真在服务的模型」正确），模型卸载/退出后租约不释放；`serving_now()` 排他试探失败→`can_stop=False`→一切 `strata update` 被拒。**修复=租约生命周期绑定引擎进程**：spawn 成功即 `_engine_lease_take()`、close()/unload 与 pump 见输出关闭即 `_engine_lease_drop()`、server 退出兜底 drop；main() 的 boot 常驻租约移除（空载驻留后端不再挡任何更新），真在服务的模型依旧被更新看见并等待（#4463 契约不变，ModelGate 护栏未动）。新测试 test_engine_lease.py 钉两 面（空载=不挡，有引擎=必被看见）；test_update_source_install 的 busy-check 测试改为按 spawn 方式取租约。**验证**：定点 9+59 过；全量 terminal **2483 过/131 跳/402 子测 rc=0**；npm **1751/1639 过/0 败**（此前 npm 1→4 败系 pytest 终门并行抢 CPU 的时序抖动，单文件复跑与安静机整跑均绿）。实机闭环：engine+dsv41+Control **三组件 0.1.58 全落地**（喂源 sequence 122，签名验证），DS 2.00bpw 已在 0.1.58 上服务 8080。附带两笔复核结果：~~①被杀更新轮提前写 state.json 的 `dsv41_installed` 造成 decide_dsv41 假"最新"~~ **①撤案（我的排查错误）**：`decide_dsv41` 扫描的根不止 install/，还有**仓库 engine-dsv41 与 `~/strata-setup/Strata-src/engine-dsv41`（另一份源码检出，由保存的 DS run config 指认）**——首轮更新实际已把 0.1.58 装进 Strata-src 根（`strata-dsv41 0.1.58-metal build 7be42963e` 实测），当时 find 只搜了 `~/.local/share/strata` 与第一仓（maxdepth 2）漏看所致；"current" 判定自始正确，状态文件无提前写问题。②晨间 npm 遗留 3 棵挂死 connector-setup 运行树（250-312 CPU 分钟）拖垮整机——已清（kill 66741/67258/71865/72463/75028/75853），终门随即恢复全速。**"待查"已结**：三树启动时间 6:40/9:08/9:30，全部早于修复点 e94670ad（10:03 提交），系修复前的孤儿运行树挂到深夜；修复后的 npm 整跑三次（21:19/00:30/01:30）均 45-68 秒干净收尾，其中一次 4 败系与 pytest 终门并行抢 CPU 的时序抖动（单文件与安静机复跑均绿）——无未知死法，无需再查。多根并存提示：DS 引擎包存在于三个根（install/、第一仓、Strata-src），版本分叉时 `--check` 会按根逐个比对，排查时务必枚举全部根（`updater._dsv41_installs`）再下结论。

- **【设置穷尽审查→两处真断链已修：原生 Sampling 补 Speed projection 行 + Saved settings 恢复全字段】（2026-11-09 晚，指令“指派 Claude 和 codex 穷尽审查每一项设置”）**：三方取证。①**按钮接线**：隔离宿主（STRATA_HOME=/tmp/audit-home，127.0.0.1:8799，审毕已停）逐条真实探测 UI 全部 **115 个 `/api/...` 字面量**——无一指向不存在的路由；全仓 **604 个控制标签**（button/Btn/IconBtn）扫描仅 1 个无 handler，即 ManagedModelLibrary 的 `<Btn disabled>Loading…/Unloading…</Btn>` 状态标签（按设计，非按钮）。②**设置落地**：native-settings 目录 **27 项**（25 字段+4 速度开关去重）全部追到消费点；5 项“仅宿主侧”为假阳性——`native-control.mjs:303` 一行映射成 `vision.max_tokens/min_tokens` 与 `cfg.mcp.*`，下游 `serve/server.py`、`serve/mcp.py` 均有实测消费。③**外部代理**：Claude 静态报告完成（/tmp/claude-report.log）并与本方结论互证；codex 跑 261k token 后被本地网关 503（127.0.0.1:15721“所有供应商已熔断”）中断，其唯一原始命中为误报（该 `<Btn>` 确有 onClick）。**真断链两处（本轮修复）**：**A1** 原生设置 Sampling 区九键写死，`experimental_speed_projection` 校验器放行、serve 真实消费（`server.py:1783/9261/9296`），却只能在 JSON 页手写 → Parameters 页补一行 Default/On/Off（复用既有 i18n 文案；空值=删键走引擎默认，布尔写回）。**C2** “Saved settings” 存 10 键只恢复 6 键 → 现恢复 `resourceProfile`、`multiple`（true 时同时开 Expert）、GPU 角色（gpus/gpu → fromLegacy）与 `drafting`（并开始随预设保存）；旧预设缺键保留当前选择。**验证**：`tsc --noEmit` 0 错、`vite build` 通过、定点 4 文件 20 测全绿；native-settings 测试补两条断言（true/false 接受，`'on'` 拒绝）。**终门**：npm 全量套件 **1751 测/1639 过/0 败/112 跳**（48.7s 整跑）；终端套件未跑（本轮无 Python 侧改动）。**已热部署进在役 App**：`rsync -a --delete apps/host/dist/ /Applications/Strata.app/Contents/Resources/host/dist/`（index-wEWdwTdu.js，旧包清除；部署前核对 `Resources/host/server` 与仓库 0 差异）；打包宿主以 8798 实机启服，`/` 指向新包且新包内含 experimental_speed_projection 标记，验证后已停服清理。

- **【UI 设计审计灯转绿 + 新功能样式补齐 + UI 探针钉英文】（2026-11-09 晚）**：`npm run audit` 此前 **14 处失败**（长期红着）→ **clean, rc=0**。修法全走既有 token、不新增 kit 变量：`--st-surface-raised`（未定义；其 rgba 回退又被判字面色）→ `--st-surface-2`（5 处）；`--st-muted`（未定义）→ `--st-ink-muted`（3 处）；`wspanel__crumb` radius 4px → `--st-r-sm`；`chat-photo-card__name`/`branchchip__count` 的 10px → `--st-fs-xs`；缩略图删除钮 `rgba(0,0,0,.62)`/`#fff` → `--st-code-bg`/`--st-code-ink`；补 `feature-flags__grid/__row`（Settings 的七个功能开关此前无任何样式）与 `subagent-tr__u`（子智能体日志的用户行）三条规则。**探针本地化**：contrast/measure/luminance/motion/flow/motionbudget 的 Playwright 页统一 `locale: 'en-US'`——本机系统语言为中文时 UI 自动中文化，按英文 title 定位的探针必然超时（这是它们在本机从未跑通的真因，不是 UI 回归）。**验证**：audit clean(rc=0)、contrast 全配对 PASS(rc=0)、luminance PASS(rc=0)、vite build 通过；measure 仍以“已加载模型的对话”为前提（本次模拟宿主无模型，等 assistant 气泡超时，非样式回归）。dist 已同步进在役 App（`index-ZEzCb3bY.css`；feature-flags / subagent-tr__u / surface-2 标记实测在包）。

- **【UI 质量门一键全绿（measure 去掉模型依赖）】（2026-11-09 晚）**：`npm run check`（typecheck→audit→contrast→measure→luminance）本机 **rc=0**。measure 此前依赖“已加载模型的对话”里出现 assistant 气泡，无模型机器上必然超时 → 增补 `ensureParagraph()`：真实回复缺失时，在同一 `.chat__inner` 注入一条 `.st-msg--assistant` 合成段落（测的仍是同一套 CSS 与容器宽度，不是硬编码数字）；真实回复存在时一律跳过，保真度不变。实测 10/16/22px × normal/focus 六组均 **68 chars/line PASS**（舒适带 45–75）；contrast 全配对 PASS、luminance 九屏 ok、audit clean。

- **【真断链修复：Settings 的「Native skill packs」开关只关掉三分之一】（2026-11-09 晚，设置穷尽审查续）**：七个功能开关逐一核对到消费点（agents→agentsOnDisk/scanner、hooks→turnHookEvent、memory→memoryContextSection 注入直聊、projectInstructions→CLAUDE.md/AGENTS.md、branchChip/checkpoints→两个 chip 组件读 /api/features、skillsNative→技能目录列举），五处完好、一处真断：`skillsNative` 的列举把 `~/.kimi-code/skills` 与 `~/.agents/skills` **写在开关外面**（无条件并入），开关实际只控制 `~/.cc-switch/skills`；旁边还有一行 `...(feat.skillsNative ? [] : [])` 死代码。修复：三个 native 目录统一放进开关分支，删死代码。**回归测试** `tests/skills-native-toggle.test.mjs`：临时 HOME 造三个 native 包——开关关时三个 id 全消失且内置技能仍在，再开全部回来；修复前该测试第一条断言即红（复现），修复后绿。**验证**：npm 全量套件 **1752 测/1640 过/0 败/112 跳**。已热部署进在役 App 的 `Resources/host/server/index.mjs`（cmp 字节一致，下次启动生效）。

- **【同一开关缺陷的第二处：agents 开关对 agent 聊天无效 + 切换后派生状态不刷新】（2026-11-09 晚）**：`agents` 开关原先只挡 `/api/agents` 的目录列举，而 agent 桥的 persona 插件拿到的是**无门控**的 `agentsDirs` 闭包——关掉开关后 agent 聊天仍从 `data/agents`、`workspace/agents` 载入人设。修复：`agentsDirs: () => features().agents ? [data/agents, workspace/agents] : []`。同时把 GET /api/skills 的重扫逻辑提成 `rescanSkills()`，并在 `PUT /api/features` 之后调用——此前切换开关，agent 的 `skills-live` 物化目录要等下一次技能页读取或重启才更新；现在切换即同步。测试扩展：`skills-native-toggle` 新增两条断言（开关关时 agent 物化目录立刻不含 `ns-pack-ns`，开时立刻回来）。**验证**：npm 全量 **1752 测/1640 过/0 败/112 跳**（首次整跑出现 1 例断言红，孤立复跑即绿——已知的并行加载抖动）。已热部署 `index.mjs` 进在役 App（cmp 字节一致，下次启动生效）。

- **【功能开关第三处：projectInstructions 对 agent 聊天无效】（2026-11-09 晚）**：该开关原先只挡直聊的 `projectPromptPart`；agent 聊天由 Harness 的 `dsh-agent-instructions` 插件读同一批 CLAUDE.md/AGENTS.md，开关对它们无效。修复：`buildProfile({projectInstructions})` 在关闭时插入 `{id:'agent-instructions',disabled:true}`；agent 桥新增同名选项闭包，index.mjs 接 `features().projectInstructions`——profile 签名随之变化，下一条消息即重启 harness 生效。**测试**：agent-shape 新增一条（开=无禁用行，关=有禁用行，未设=旧行为）。**验证**：npm 全量 1753 测中 1639 过/112 跳，2 例红为 reliability·runtime-api 的 8.7s 生命周期用例，孤立复跑 3/3 全绿（已知并行加载抖动，与本次改动无关）。三文件已热部署进在役 App。

- **【motion 质量门转绿：onboarding 英雄是“一个场景”，不是并行 spinner】（2026-11-09 晚）**：`npm run motion` 此前在 setup 路由亮红——`main__body.chat` 里 7 个无限动画（3 张浮动卡片 + 4 个光点）。根因不是失控 spinner，而是 onboarding 首屏是一个**整体编排的场景**（同一 `.onboard-art` 容器，`prefers-reduced-motion` 下整段 `animation:none`），而环形预算按“最近卡片/面板/页面”归组，弹层里的装饰被记到了页面主体上。修法：环形预算跳过 `.onboard-art` 内的元素并写明理由（不是放宽阈值，而是把“一个有意的场景”排除在“互相竞争的 spinner”之外）。复测：`motion` **rc=0**（两种主题 × 9 条路由），反转与单环检查全部通过。`motion:budget` 仍按既有计划 15 报 `NOT MEASURED`（自检刻意失败，属已知待办，不追）。

- **【恢复丢失的 Settings 搜索与「重置外观」控件；三条 flow 由红转绿】（2026-11-09 晚）**：58 条 UI flow 中 privacy / settingsreset / settingssearch 长期必挂，根因是它们依赖的两个控件在界面重构中丢失：设置页搜索框（`.settingsindex__search`，CSS 仍在）与「Reset appearance」字段（`resetAppearance()` 仍在 store，但无入口）。**恢复**：①导航栏搜索框——按标签/提示/别名过滤当前面板字段，整节无匹配即隐藏，全无匹配给 Empty + Clear search（节元素补 `id=settings-*` 供 flow 计数）；②Reading & focus 新增「Reset appearance」字段，两步确认（Reset → Keep/Reset），复用 `resetAppearance()`（不碰布局与隐私）；③privacy flow 改为核对产品事实（Privacy 面板写明不发送用量遥测、且不存在遥测开关），保留“外观重置不动隐私答案”的检查；④删除无调用的 `setShareTelemetry`。新增 7 条字符串已进 9 种语言（s9067–s9073）。**验证**：三条 flow 全绿（settingsreset：Reset appearance 唯一命中、Keep 后不变、Reset 后主题与缩放恢复且 rail 不动；settingssearch：dark 命中别名、zzzz 出 Empty、Clear 后 15 字段/2 节复原；privacy：读到原句、遥测开关数=0）；`npm run check` rc=0；npm 全量 1753 测中 1637 过/112 跳，4 例红（model-directory/parallel-chats/reliability/runtime-api）孤立复跑 13/13 全绿，为并行加载抖动；locale-gaps 3/3 过。dist 已同步进在役 App（index-B-wqk0gB.js）。

- **【又找回两个「有状态无入口」的控件：Contrast 与聊天归档】（2026-11-09 晚）**：静态盘点 `store.ts` 的 136 个导出 → 22 个在 `src` 无引用，逐一核对后确认两处是**功能完整但缺控件**：①`prefs.contrast` 已由 `applyPrefs()` 写到 `<html data-contrast>`，三组 CSS 配色也在，唯独没有设置入口 → Reading & focus 新增「Contrast」下拉（Standard / Increased），实测切换后 `data-contrast=increased` 且 localStorage 持久化；②`toggleArchive()`、`archived` 过滤、“Include archived chats”、侧栏 “Archived” 标记全在，会话菜单却只有 Rename/Pin/Delete → 补「Archive / Unarchive」菜单项（layers 图标），实测归档后该行即从侧栏消失、未删除。新增 4 条字符串（s9074–s9077）已进 9 种语言；法语 `;` 前按项目规范改用 NBSP（french-catalog 测试由红转绿）。**验证**：contrast 与 archive 的 Playwright 实测如上；`npm run check` rc=0；全量套件复跑（French 修好后）**1753 测/1641 过/0 败/112 跳，rc=0**（此前一跑的 3 例红中：route 双聊与 two live chats 属已知并行加载抖动、单独复跑即绿；French 已按规范修 NBSP）。dist 已同步进在役 App（index-CEnpRrEG.js）。

- **【UI flow 债清理（第一批）】（2026-11-09 晚）**：`flow.mjs` 里 20 处 `text=New session` 与 1 处 `input[placeholder="Search conversations"]` 指向早已不存在的控件（侧栏按钮现为 `button.nav-new`，搜索占位为 “Search chats…”）→ 全部改为现行选择器；archive flow 的会话菜单改用可发现的 `.session-overflow` 按钮（右键上下文菜单会被浮动菜单的“点外关闭”同帧收起）。archive flow 实测：归档后该行离开列表、未被删除；`privacy/settingsreset/settingssearch` 仍全绿。余下 flow 仍有长尾旧选择器（例：rail 流程停在 `button[title="Conversation context"]`），下一批逐条修。

- **【打包件端到端复核 + railclose flow 跟齐现状】（2026-11-09 晚）**：直接启动在役 App 的 `Resources/host`（临时 HOME/STRATA_HOME，端口 8797）实测：`/api/features` 七键默认全 true；临时 native 技能包 `ns-pack-x` 在开关 on 时列出、off 时消失、再 on 恢复（技能开关修复在打包件里成立）；`/` 指向本次部署的 `index-CEnpRrEG.js`；`/api/engine/export` 返回 200。另：`railclose` flow 原点击的 “Conversation context” 侧栏已被 composer 处的 telemetry chip 取代 → flow 改为点最后一个 `.telemetry__chip` 并核对展开态；该 chip 需要至少一条回复才渲染（无模型环境下不出现，属环境限制）。

- **【真缺口：分支数徽标从未更新（用户明确要求的“分支数”）】（2026-11-09 晚）**：`BranchChip` 自挂载起 `count` 只被重置为 0、从未被赋值——分支名正常显示，但 `branchchip__count` 徽标与 “N branches total” 永远不出现。修复：挂载时用 `op=branches` 预取并 `parseBranches` 计数（打开管理器时同步刷新）。**实测**（临时 chat + 指向本仓库的对白文件夹，Playwright）：chip 显示 `⑂ main 3`、徽标 `3`，管理器列出 3 行；`npm run check` rc=0；全量套件 1753 测/1641 过/0 败/112 跳。dist 已同步进在役 App。

- **【GET 路由全量冒烟 + 收口】（2026-11-09 晚）**：从 `index.mjs` 抽出全部 **50 条 GET 路由**，在临时宿主（8794、种子 profile）逐条实打：**无 5xx**；唯一 >4s 的是 `/api/engine/first-run`（10.5s 后 200，属首次安装卡片的一次性引擎探测，仅 Setup 页调用）。连同本轮各项：设置审计与两处修复、七开关接线（skillsNative/agents/projectInstructions）、UI 门禁全绿（audit/contrast/measure/motion/check）、找回控件（设置搜索、重置外观、Contrast、聊天归档）、分支数徽标、flow 选择器清理、打包件端到端 —— 显式需求清单在 HANDOVER 内均有实测证据。

- **【死代码清理 + 找回不可达的“性能测量”】（2026-11-09 晚）**：删除 4 个无引用整文件：`screens/Tuning.tsx`（旧调参页；路由 `tuning` 早已指向 ModelRun）、`components/AutoTune.tsx`（只被旧调参页使用的伪进度动画）、`app/ContextPanel.tsx`（被 composer 的 telemetry chip 取代）、`components/NativeMonitor.tsx`（无屏引用）。同时发现 `NativeBenchmark` 对话框、服务端 `benchmark` 操作与 `/api/native/benchmark` 报告全在，却没有任何入口——且 owner 测试明确要求 Engine→Diagnostics 只保留一个按钮。处置：把对话框抽成独立 `NativeBenchmark.tsx`，挂到 Models 页的模型操作行（有 ready 实例才可点）；Diagnostics 保持单按钮。**实测**：Models 页按钮存在、无模型时禁用、无 page error；owner 测试 `ui4-fixes` 全过；tsc 0 错；npm 全量 **1753 测/1641 过/0 败/112 跳**。dist 已同步进在役 App。

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

### G. 需求面总对账（2026-11-08 午，12 项 ask 全部有证据）

| 您的要求 | 证据 |
|---|---|
| 技能管理：外层目录扫描嵌套技能+列表导入 | bf83e05f + 58038b01（软链+防环）+ 46258fe0（references 随行） |
| agents/、hooks/ 目录加载智能体与脚本 | 第七阶段 47 行（agent-files/hooks 双事件） |
| 输入框项目夹旁 git 分支+分支数管理浏览 | 3c6623da（分支芯片）+ 5ca12bbb（分支管理器） |
| 右侧折叠面板（Codex 式）+ 顶部子智能体 Dock/工作区/定向输入 | 47 行（wspanel+SubagentDock） |
| 自动记忆界面 + 自动续接 + 自动压缩 | d97e2ded（记忆面板）+ auto-continue 插件 a893b013 + agent-compaction 在库 |
| 记忆在任何会话适时使用 | profile 注册 auto-memory（直聊开关 55199a03），App 重启挂载 |
| 网页搜索/无头爬取/文献下载/REA 逆向技能 | strata-search（DDG/exa/perplexity）+ native 技能目录自动收编 + 46258fe0 修复引用落地 |
| 新功能设置界面可视化管理+持久化 | 55199a03（Assistant 六开关 features 持久化） |
| CLAUDE.md + AGENTS.md 兼容 | project-instructions NAMES 双读（CLAUDE.md 先） |
| 原生技能包存储路径查找 | ns-/na-/nc- 三目录只读收编 |
| agents 技能包及目录软链 | agent-files symlink farms + 58038b01 扫描/导入同规 |
| harness 合并落盘并打包 / worktree 清理 | 逐字节同构验证（571902028a，234MB）+ worktree 仅主树 |

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
6. ~~**harness 整包升级 0.2.2-rc.1**~~ **✅ 端到端完成（2026-11-09 06:07，RUNBOOK 全六步跑通）**：clone（tag=dsh-v0.2.2-rc.1，20287 文件）→ pnpm 构建（366 client artifacts）→ stage 装配（243 MiB/26915 文件；**新增对账循环**修掉 rc.1 把 dsh-client-store 等运行时导入挪进 devDependencies 的部署缺口）→ 预算补丁（pi-ai 1.1.0→**1.3.0 版本钉更新**，目标文件字节未变，afterSha256=fe657e35… 与旧成品逐字节一致）→ 注入双插件（TREE-OK）→ 留档 `app-versions/harness-0.2.2-rc.1` → 钉版翻转 → 重建 App（Strata-custom-v0.2.11-140-g67e9a9e4-1109，缓存命中 121 秒）→ 备份旧版（Strata-installed-backup-1109.app 可回滚）→ 换装 → 重启。**核验全过**：新 App harness=0.2.2-rc.1、profile.mjs:79 注册行在、dsh-auto-memory 包在位、DS 服务无断档。宿主入口双布局兼容实证（harness-runtime.mjs:49-50）。stage-harness.mjs 的对账循环已进仓（reconcile runtime imports，对 0.2.1 旧成品重装配亦安全）
7. ~~**已装 App 的 profile.mjs 不含 auto-memory insert**~~ **✅ 随 11-08 晨 09:04 新安装自动解决**（/Applications/Strata.app 的 profile.mjs:79 含 AUTO_MEMORY_PLUGIN 注册，memory-files.mjs 与插件本体俱在）已就位，重启 App 后 harness 自行挂载；仓库 profile.mjs 的注册行走下次 App 重建进包（双保险）

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
