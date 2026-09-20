> **历史研究组件实验：不代表当前完整 Planner 性能，旧批次预算不授权新调用。新评测见 [EVALUATION](../design/budget-travel-agent/EVALUATION.md)。**

# 模型对比与后端架构实验设计

状态：首轮真实研究组件实验已于 2026-09-13 执行，最新结果与完成范围见 [首轮结果](model-architecture-results-2026-09-13.md)。正式数据使用 v3；v2 运行记录保留为前序实验，不能与 v3 合并排名。完整 Planner 尚未验证。

正式协议为 `research-v3-aligned-contract-routing`：schema 同时序列化进提示和 `response_format`，类别和数量按案例限制；同一模型可在 Provider 间 fallback。旧 pilot/v2 样本保留。当前模型为 Qwen3.8 Flash、GLM5.3 Flash、Kimi K2.6、DeepSeek V4 Flash 0731；GLM 需要 low reasoning，其他模型的配置以 manifest 为准。本轮排除用户所在地区不可用的 Anthropic、Google、OpenAI 系列模型；MiniMax m3 的 probe 返回 403，也未进入正式批次。

首轮采用 96 格分层筛选：四模型各执行 `thin-web × 16`，另以 DeepSeek 执行 `direct-web × 16` 和 `current-system × 16`；每格一次，两个 worker，共用既有 5 美元实验额度及独立 SerpApi 次数上限。96 格是计划上限，预算或能力失败可能使部分格未运行。所有 16 案例均只测研究组件，本批不能估计所有模型与架构的交互效果。

目标是回答：活动研究为什么慢、不同模型在相同能力边界内怎样取舍，以及研究服务能否简化到足够小且仍有用。先评研究组件，再让胜出的方案进入完整 Planner 验证。研究成功不等于攻略交付成功。

## 1. 对照版本与隔离边界

当前系统对照来自 `D:/FunnyProject/flightor-repo` 的实际后端，包括未提交修改。审查时主仓 HEAD 为 `fb0a2dbf04ea11bff1bd1a7323b061d82ec055eb`；这个 SHA 本身不能表示完整对照。每次实验必须记录所读后端文件的摘要、工作区差异摘要及配置指纹，不记录密钥。并行 UI 开发位于独立工作区 `D:/FunnyProject/flightor-repo/.worktrees/ui-experience`，不在主仓进行；本实验不得修改主仓或该 UI 工作区。

实验目录为 `D:/FunnyProject/flightor-repo/.worktrees/model-architecture-lab`，从 `65679d0` 创建仅用于隔离。它不是生产回滚方案，也不能用该早期版本里的研究实现冒充当前系统。`current-system` 适配器必须读取或固定当前后端实现并保存来源指纹；若指纹改变，同一实验批次应停止混跑或另开批次。

案例唯一来源为 [cases.json](../../experiments/travel-research/cases.json)，候选模型唯一来源为 [models.json](../../experiments/travel-research/models.json)。文件中的模型 ID 是待核实配置，配置成功、模型目录可见、实际调用成功和支持指定联网方式是不同证据。不得在模型不可用时静默换成另一模型。

本设计不改变 ADR 0010 的 Planner 自主编排和领域验证原则、ADR 0012 的 Agent 编写攻略原则，以及 ADR 0015 的临时进度边界。旧基点可能没有这些后来文件；审查依据始终是主仓当前文件。

## 2. 当前后端实际在做什么

审查入口：

- [CloudPlannerService](D:/FunnyProject/flightor-repo/backend/src/agent/cloud/service.ts)、[生产依赖装配](D:/FunnyProject/flightor-repo/backend/src/routes/agent-cloud.ts)、[AgentRuntime](D:/FunnyProject/flightor-repo/backend/src/agent/runtime/runtime.ts)。
- [ProductionResearchAgent](D:/FunnyProject/flightor-repo/backend/src/research-agent/production.ts)、[研究工具](D:/FunnyProject/flightor-repo/backend/src/agent/tools/research.ts)、[研究落库](D:/FunnyProject/flightor-repo/backend/src/research-agent/workspace.ts)。
- [SerpApi 研究适配器](D:/FunnyProject/flightor-repo/backend/src/research-agent/providers/serpapi.ts)、[来源验证](D:/FunnyProject/flightor-repo/backend/src/research-agent/verification.ts)、[综合模型](D:/FunnyProject/flightor-repo/backend/src/providers/openrouter/research.ts)。

实际链路如下；箭头表示依赖，不表示要求所有用户请求都执行同一流程：

```text
CloudPlannerService：读取 Trip / Conversation / Memory，保存用户消息
  → AgentRuntime：Planner 模型决定工具，接收工具结果，再决定下一步
      → research_destination 或 web_research
          → 校验 Location / Trip / 当前 Goal 与运行范围
          → ProductionResearchAgent
              → 最多 8 次 SerpApi Organic 搜索，2 个滚动 worker
              → 清洗、去重、限量的来源摘要
              → 1 次 Research 模型综合（没有来源时跳过）
              → 来源引用、结果范围和证据状态验证
          → 保存 Research Artifact，并返回候选 findings
      → Planner 选择每日安排并调用 save_travel_guide
          → 领域服务恢复来源事实、验证、保存
      → finish_goal / Runtime 最终校验
  → 保存回复、返回持久化结果引用和 delivery
```

| 边界 | 当前事实 | 测量时的含义 |
| --- | --- | --- |
| Planner 模型 | OpenRouter 普通 JSON HTTP 调用；`toolChoice: auto`；最多 10 个工具步骤；单调用 60 秒，输出上限 4096 token，请求关闭 reasoning | 多轮模型调用均计入完整 Planner；10 个工具步骤不等于只会有 10 次模型请求 |
| Planner 总预算 | 当前生产 300 秒，临时任务外层 315 秒；ADR 0015 已更新 ADR 0012 中的旧 150 秒描述 | 150 秒是需复现的历史问题和可比较的时间门槛，不能写成当前总超时配置 |
| 查询规划模型 | 对话入口没有注入 `queryPlanner`；另一个 Discovery 入口仍注入它 | 当前对话基线不能增加这一调用后再宣称删掉它带来加速 |
| 搜索 | 最多 8 个目的地/问题组合；2 个滚动 worker；每次 SerpApi Organic 调用 30 秒超时 | 一次研究工具不等于一次搜索；累计搜索耗时也不等于搜索阶段墙钟时间 |
| 来源读取 | 取搜索结果标题、URL、摘要、可能的发布时间，没有继续抓取页面正文 | 官方域名和引用存在不证明正文支持具体断言；来源核验必须标记证据深度 |
| 搜索策略 | 服务端构造查询，使用规范城市及国家；默认 `hl=en`；注入的来源策略目前有 TYO 官方旅游域名数据 | 城市策略、语言及检索引擎会影响覆盖，不能与模型能力混为一谈 |
| 综合 | 所有搜索结束后才综合；最多 50 个来源；源索引约束；单调用 60 秒、4000 token；没有来源时不调用 | 综合位于搜索之后的关键路径；来源多并不代表更快或更高质量 |
| 失败回退 | 综合失败可返回原始来源候选，标记 `raw_source_requires_synthesis` 和 unverified；搜索可部分失败 | HTTP 成功或有候选不等于可用研究成功；回退比例单列 |
| 研究工具总时限 | `research_destination` / `web_research` 各 95 秒，取消向下传播 | 直接调用研究 class 没有这一独立总时限；组件 runner 统一 95 秒才保留该对照条件 |
| 并行 | 一批工具仅当全部获准工具均为无状态且 `parallelSafe` 时才并行；研究与机票结果工具会写状态 | 同一步包含此类工具时串行；不能简单把保存 Artifact 的工具改成无状态来提速 |
| 网络重试 | 现有 `fetchJson` 不自动重试；Planner 可决定另一次工具调用 | 区分 Provider HTTP 次数、模型决策重试和 JSON 修复请求；不能遗漏后两者成本 |
| 完成 | Runtime 即使未收到显式 `finish_goal`，最终也对 touched Goals 调用同一完成服务 | `stopReason=completed` 只对应 `delivery.status=satisfied`；研究组件不能报告这个业务结论 |

一次有来源的研究通常产生 `N 次搜索 + 1 次综合` 外部请求，`N ≤ 8`。完整 Planner 还包含它前后的模型回合、可能的其他工具、数据库工作与完成验证。模型内置联网的一次上层 HTTP 请求可能在服务商内部执行多次搜索；无法观察的内部次数记为 unknown，不能记成一次检索。

当前 Research v2 的来源验证是 snippet-only；即使官方旅游来源或多个独立来源，也至多得到 `partially_verified`。完整证据验证状态与业务允许部分资料时的 Goal 完成状态保持独立。

## 3. 最可能的耗时来源：需要逐项验证

以下是代码支持的假设，并非本轮实测结论。主仓 `docs/链路探讨.md` 保存过一次伦敦请求的旧日志摘要：多轮 Planner 与两轮研究叠加至 150 秒，尚未保存攻略。该记录不能拆出搜索与综合占比，也不是当前 300 秒版本的验收结果。

| 假设 | 为什么值得先测 | 证实或排除它的数据 |
| --- | --- | --- |
| Planner 的串行模型往返占比高 | 每批工具后再次调用模型，可能先做航班、再做研究、再补研究 | 每轮模型耗时、输入输出 token、工具决策、从首次研究返回到保存攻略的时间 |
| 搜索慢尾吞掉研究预算 | 两路并发执行至全部 settle；8 个慢搜索可以超过 95 秒预算，甚至尚未开始综合 | 每个搜索的开始/结束/状态、最大实际并发、队列等待、搜索阶段墙钟时间 |
| 来源综合占用关键路径 | 综合在搜索之后串行，最多 60 秒；输出或证据不合格还可能引发下一轮研究 | 综合耗时、输入来源量、有效候选数、解析失败、回退和补研究率 |
| 研究过碎或需求覆盖不足造成返工 | 问题×目的地有上限；召回失败、重复或不适用来源会减少可用候选 | 每请求的研究次数、重复 query / URL / 候选比例、题材和日期覆盖、缺口原因 |
| 有状态工具的保守串行扩大总时长 | 机票查询与研究都保存 Artifact，不能按现有规则并行 | 同轮可独立 I/O 的重叠机会，以及重构前后的取消、版本冲突、写入一致性 |
| 上下文与校验成本被忽视 | Cloud 最多读取 100 条历史消息；Runtime 不断追加工具结果；还有工作集及落库 | 模型输入大小、数据库 spans、落库/校验耗时；与短历史对照，不能预判数据库就是瓶颈 |

进度轮询改善“现在发生什么”的可见性，不缩短实际研究或最终交付时间。首次状态可见、首次可用研究、首次持久化结果和最终交付应有各自的时间戳。

## 4. 三种实验方案与最小轻服务契约

| 架构 ID | 实验行为 | 当前阶段的输出地位 |
| --- | --- | --- |
| `direct-web` | 一次可联网模型请求，自然语言列表和引用，尽量接近直接询问模型的体验 | 人读研究答案；保留原文，不因没有应用 JSON 而判质量失败 |
| `thin-web` | 同类联网请求，输出结构化候选，由普通函数进行解析、来源绑定和范围校验 | 可供应用消费的研究候选；不是第二个 Planner，不自行写 Trip / Goal |
| `current-system` | 当前 `ProductionResearchAgent`、SerpApi 搜索、source-bound 综合与验证；候选模型替换研究综合模型 | 真实研究组件对照；尚未运行 CloudPlannerService、完整工具循环或生产数据库交付 |

轻服务只需要一项能力：`research(brief, signal) → result`。先用现有 TypeScript 类型、一个 Provider 适配函数和验证函数完成实验，不引入通用 Agent framework、任务总线或新领域模型。

最小逻辑契约如下；这是边界设计，具体实验 JSON 字段以 runner schema 为准，不在这里另建一个生产 Artifact 版本。

```text
输入
  brief：目的地选择、旅行窗口、兴趣、具体问题、类别、maxResults
  signal / deadline：宿主控制；不是模型可改的参数

输出
  candidates[]：候选标题、摘要、类别、目的地引用、sourceIds[]
  sources[]：稳定引用、URL、标题、可用证据片段、证据类型
  uncertainties[]：缺失日期、只有摘要、来源冲突、无匹配候选、部分检索失败等
  outcome：可用 / 部分 / 空 / 错误，以及可诊断原因
```

契约应满足：

1. 可作为已检索证据消费的候选，其来源引用必须能指向本次实际返回的来源。模型写出的 URL 与 Provider 返回的 citation / source 是不同证据，分别保留；没有 Provider 引用的链接可以留在原始输出与诊断中，但不能伪装成已检索来源或合格的持久化证据。
2. 来源明确区分 `url_only`、`search_snippet`、`page_excerpt` 或 Provider 可证明的证据模式。抓取时间由宿主记录；发布时间和活动日期只有证据支持时才填。不得从 URL 年份、模型自信程度或“有引用”推导已核实。
3. 候选与事实不同。推荐理由、顺序和建议时间可以由模型创作；具体营业时间、票价、交通时长和活动日期需要对应证据。缺失就写明不确定，不补造数字。
4. 请求范围、数组上限、合法 URL、来源映射、重复项和显式取消由普通确定性函数检查。严格 JSON 合格只说明结构能读取；语义支持度仍需独立评分。
5. 空结果是合法业务输出；区分没有找到和 Provider 失败。解析失败、截断、取消、超时必须保留为原始结果，默认不增加第二次模型修复请求。若测试修复策略，单列架构变体并计入请求、时间、费用。
6. 研究服务没有用户身份、数据库凭据、Trip 修改、持久化 Artifact 或完成 Goal 的权限。后续接入由现有领域入口验证 canonical location、保存 Research 并建立 lineage。
7. 原生联网若提供更深的证据，也不能直接提升现有 snippet-only 验证器的结论。需要明确的证据模式与对应验证后才能改变该判断；本轮优先报告差异，不修改生产验证标准。

`thin-web` 的价值假设是：把检索与初步整理交给一个联网能力，把应用需要的约束留在少量普通函数中。它是否比现有搜索加综合更快、更稳定，必须用相同案例证明。

## 5. 公平比较矩阵

16 个案例使用同一份 manifest，涵盖的目的地、窗口、限制条件、题材及期望证据写在案例中。每例最多 6 个候选、最多 2 个研究问题，具体澄清与部分结果标准见 [rubric.md](../../experiments/travel-research/rubric.md)。案例 LocationRef 是组件测试 fixture，未经过生产地点 Provider 或授权验证；`current-system` 直接执行研究组件不会证明这些 ID 可用于生产工具。`expected` 只供评审，不能进入模型输入。

直接回答与 JSON 输出可以不同，但需要提供相同数量范围、同样有用程度的候选和来源。自然语言方案的缺失结构不应被包装成语义失败；另外评估其转换为可落库结构的成本。冲突澄清、无可靠资料时允许零候选，不能把返回 6 项作为所有案例的统一成功条件。

| 比较 | 固定项 | 变化项 | 能回答的问题 |
| --- | --- | --- | --- |
| 同架构控模型 | 案例、架构、Provider 检索方式、输出上限、截止时间和评分口径 | `models.json` 中的模型 | 该架构下哪个模型更快、更有用、更可靠 |
| 同模型控架构 | 案例、模型 ID、时间和产出约束 | 三种系统方案 | 同一模型在不同系统方案的总体取舍 |
| 联网两方案控结构 | 案例、模型、同一个联网 engine、源配额与截止时间 | `direct-web` vs `thin-web` | JSON 与本地验证带来的适配收益、耗时和失败率 |
| 固定证据回放消融 | 同一来源集合、顺序、时间戳、原始问题与模型 | 保留综合、简化综合、直接消费候选 | 更纯粹地判断是否需要独立综合阶段；不测实时检索召回 |
| 完整 Planner 后验 | Planner 模型、相同 Trip / Conversation / Goal 起点、领域验证器与生产时限 | 胜出研究适配器 | 组件收益能否转化为持久化攻略交付收益 |

完整候选矩阵是 `16 案例 × 4 模型 × 3 架构 = 192 格`，不含重复；当前已启动的首轮是前述 96 格分层筛选，不是完整矩阵。完整矩阵仅是后续可选覆盖计划，不能因为有计划就一次跑满。实际候选数以配置为准。默认 `--engine exa` 固定联网两方案的 engine；`--engine preferred` 使用各模型配置的原生/Exa 偏好，作为另一组“模型加联网能力”的产品方案比较，不能混入固定 engine 的模型排名。

关键混杂项：`current-system` 保持 SerpApi + snippets + 当前来源策略；`--engine exa` 不会把它自动变成 Exa。因此同模型三方案的结果是系统整体比较，不是仅改变代码层数的严格因果实验。若要归因于架构，追加固定证据回放；若要归因于检索，追加相同 SearchProvider 的小规模消融。两者都不应替换或悄悄改名当前基线。

每批固定并记录：

- case / prompt / schema / adapter / 当前后端摘要，UTC 执行时间，冻结的旅行日期与窗口。
- 请求模型、实际返回模型、实际 Provider 路由和联网 engine；未知值明确 unknown。Provider 路由或模型版本变化的结果分组。
- temperature、reasoning、最大输出 token、单模型/搜索/研究截止时间、源数与搜索次数上限。API 实际不支持某参数时说明差异，不能声称已完全控制。
- 无历史/缓存复用的冷启动组，与允许复用的暖启动组分开；对实时联网无法冻结的变化，按同案例交错运行并记录顺序。
- 默认统一研究总截止 95 秒；`current-system` 综合仍为 60 秒。超时是失败/删失观察，不写成恰好 95 秒的成功样本。
- 随机或平衡交错顺序，记录实际并发以辨别限流影响。当前首轮两个 worker；后续若改单 worker 应分组，不能当作相同运行条件。实验重试、人工修复和刷新来源另列，原失败记录不覆盖。

先对少数代表性案例做 smoke，确认模型可用、引用可读、账单可追踪和取消有效。再根据预算覆盖 16 案例。对优胜方案做至少三次交错重复只在剩余预算允许且授权范围覆盖时执行。16 个异质案例的 p95 仅为描述性值，应同时给样本数、成功率与最慢案例，不声称已经得到稳定的生产尾延迟。

## 6. 研究指标与完整 Planner 指标分开

### 研究组件

计时起点是组件接受同一 brief，终点是返回已解析的研究结果或终止。记录：

| 指标 | 口径 |
| --- | --- |
| 组件墙钟时间 | 包含 Provider 等待、解析与本地验证；报告 p50/p95、成功与失败分布 |
| 搜索/综合阶段 | 每次开始、结束、HTTP 状态/稳定错误码；搜索累计耗时与并发墙钟耗时分列 |
| 完成率 | 结构成功、可用研究成功、空结果、部分结果、无来源、超时、取消分别计数 |
| 候选质量 | 请求相关性、具体可行动性、题材/目的地/日期覆盖、去重后有效候选数 |
| 来源质量 | 有引用比例、Provider 实际引用比例、可访问性、正文/摘要支持度、官方来源比例 |
| 不确定性 | 对缺日期、过期活动、冲突来源和无法证实数字是否明确标注；不以语言自信评分 |
| 成本 | 实际模型/联网账单、token、SerpApi 调用次数、保留未结算费用；同时给每个有效结果成本 |
| 可接入性 | 机器可读率、来源可映射率、人工清理时间；与内容质量单列 |

盲评隐藏模型和架构名、随机输出顺序，统一使用 [rubric.md](../../experiments/travel-research/rubric.md) 的 100 分人工尺度：意图与约束理解 25、事实证据与来源支撑 30、候选适配与实用性 20、时效与不确定性处理 15、范围与下一步表达 10。报告分项与总分，不用单一总分掩盖来源失败；无法评分写 N/A。伪造来源、无证据的精确活动日期/价格、明显越出地点或日期范围列为严重错误。链接数、JSON 合法率不能自动换算成人工质量分。

URL 格式有效不等于可访问，可访问不等于支持断言；自动检查和人工打开来源分别标注。网页抽查消耗的额外网络/服务费用归为评审成本，不能藏入某个模型的研究延迟。若用另一个 LLM 评审，单列评审配置和费用，严重错误仍需证据核查。

当前 `OpenRouterClient.complete()` 只返回 message 与 finishReason，未暴露 usage / cost。实验适配器需要从安全的原始响应或 Provider 账单记录费用；字段缺失时不能记作 0。已有 runtime modelTrace、toolTrace 是阶段观测基础，但不能替代搜索/综合内部 spans，也不能把 UI “思考中”当作首 token 时间。

### 完整 Planner 后验

研究胜出后，在独立测试数据库或已获授权的测试账号中，以相同初始 Trip、Conversation、Memory、Goal 运行实际 `CloudPlannerService → AgentRuntime`。Planner 模型先固定；只替换研究服务。不得把研究综合模型排名直接当作 Planner 工具决策排名。

完整链路额外报告：首次服务端活动可见时间、首次持久化 Research、首次持久化攻略、最终响应；Planner 模型回合数与耗时；工具调用和重复研究次数；保存修订次数；数据库/验证耗时；最终 `delivery.status`；覆盖天数；拒收原因；取消后迟到写入数；Trip 变更和跨 owner 验证结果。

完整交付以服务端读取的持久化 Artifact 和 `delivery.status=satisfied` 为准。若只运行内存 repository 或 direct class，则分别标注为逻辑验证或组件实验；都不能声称 PostgreSQL、临时任务轮询、WeChat 或生产完成率已通过。当前 Planner 300 秒总时限下同时报告“150 秒内完成比例”，以保留用户关心的速度门槛。

## 7. 可以实验删除的链路与必须保留的事实边界

| 可实验的简化 | 决策证据 | 仍保留的边界 |
| --- | --- | --- |
| 用一次联网研究替代 SerpApi + 独立综合 | 相同案例下的召回、来源支持、延迟、失败率、总费用 | 来源归属、结果范围、取消、落库验证 |
| 减少搜索任务、输入来源量或综合输出长度 | 有效候选与覆盖不显著下降，慢尾改善 | 显式 maxResults、预算、未覆盖问题说明 |
| 去掉重复查询规划 | 对话入口已经去掉；Discovery 若实验需另列，不套用对话收益 | 地点规范化、查询范围和来源数据策略 |
| 调整 curated 来源限制 | 多城市来源多样性、无结果率和错误率对照 | 通用 URL/输入校验，不能转成模型任意写搜索操作符 |
| 直接由 Planner 消费已有候选，减少综合或补研究 | 固定证据回放和完整 Planner 的保存通过率、总回合数 | 来源事实与创作建议分离，现有攻略验证 |
| 合并纯状态记账或缩小上下文 | 独立服务能力能减少模型往返，短历史/长历史结果一致 | Agent 仍可选择、跳过和重排能力；不加固定业务 DAG |
| 并行独立远程读取，再分别提交 | 实际可重叠 I/O、取消及版本冲突测试通过 | 每次持久化前 fresh checkpoint 与既有事务；不能只改 `parallelSafe` 标志 |

下列能力不因研究方案更快而删除：

- **身份与事实**：owner/Trip/Conversation 归属；Location Identity、机场时区、航班与票价来自权威目录或真实 Provider；模型建议不能改写这些事实。
- **用户意图**：Trip 版本、接受的条件、Memory 与本轮上下文分离；研究候选不自动升级为 required destination 或 required event。
- **持久化与来源**：Artifact schema、原始来源、Goal/run、TripContextVersion、sourceArtifactIds，以及保存前的范围/版本/取消检查；历史结果不会仅因被提及就成为当前 run 的证据。
- **取消与恢复**：caller signal 向 Provider 传播；超时/取消后的迟到结果不得完成新 run 或覆盖取消；部分结果可审计；`get_active_goal` 只读，恢复须走明确的 `resume_goal`。
- **业务完成**：`completeGoal` 与 `GoalRunRepository.commitCompletion` 的范围、修订和原子完成边界；`responded`、`partial`、`satisfied` 保持区分，模型说“完成”无权改变结论。
- **路线授权与计算**：最终航线生成需要用户按钮或明确当前指令的持久化授权；航线路径计算、票价与确定性引擎继续由领域服务负责。
- **真实进度**：ADR 0015 的临时活动不进入对话、Memory、Trip 或 Artifact；更换研究 Provider 不把进度缓存改造成持久化任务真相。

## 8. 执行与结论门槛

本阶段先完成可审查的 cases、config、dry-run、费用预留和离线契约检查；不能用 mock 分数替代真实 Provider 排名。付费运行在用户允许的范围内执行。默认本地 5 美元 reserve 准入只是调度保护，不是服务商强制账单上限；未知或未结算费用保留预留，不能当作免费继续无限调用。SerpApi 独立计数并设上限；模型、联网搜索、SerpApi、评审各自记录成本来源。

smoke 出现模型不存在、指定 engine 不可用、引用不可读取或无法追踪关键费用时，记录 blocked / unsupported 并停止该组合；不要静默替换模型、联网方式或输出合同。192 格全部执行并非默认预算承诺。

组件阶段只作以下结论：某组合在已执行案例与预算内具有更好的质量、速度或接入性；同时列出未运行、失败、来源证据不足与费用未知项。不能据此删除当前生产链路。

进入集成前，先登记取舍门槛，例如：严重来源错误为零、相关性/覆盖没有实质下降，且 p50 明显改善或每个有效结果成本下降。具体改善阈值应在看到完整结果前确定。若差异主要来自检索引擎、证据深度或模型路由，结论应明确指出。

最终取舍由完整 Planner 的持久化交付通过率和耗时决定。更快地产出空列表、更早返回没有来源的自然语言、或延长超时使任务勉强结束，都不能单独证明架构更好。
