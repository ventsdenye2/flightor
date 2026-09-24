# FlightOR 文档入口

2026-09-22：[第四阶段真实图片](design/budget-travel-agent/PLACE_MEDIA_2026-09-22.md)、[媒体ADR0027](adr/0027-place-media.md)：Wikimedia媒体持久链路及双景点H5实景通过；微信构建完成但照片页面未验收。地图暂停排查、仍未解决，未合并main、未放行G1。以下第三阶段“未开展图片任务”为当时记录。

2026-09-22：[地点身份与地图 ADR 0026](adr/0026-place-identity-and-maps.md) 与[第三阶段验证](design/budget-travel-agent/PLACES_MAP_2026-09-22.md)：真实 Nominatim、持久缓存和 H5 地图已接入；微信底图验证单独记录，未开展图片任务或全量 G1。

2026-09-22：[有界终稿 ADR 0025](adr/0025-bounded-guide-finalization.md) 已实现；[本轮验证及费用](design/budget-travel-agent/FINALIZATION_2026-09-22.md) 含真实中英终稿示例。新 Planner 攻略先保存隐藏草稿，接纳后按 locale 展示；未部署、未追认完整 G1 验收。

2026-09-24：当前授权后端工作按 [DSH 实施方案](design/budget-travel-agent/DSH_IMPLEMENTATION_PLAN_2026-09-24.md) D0→D4 顺序推进；此前 R/U 与条件 C1 的评估顺序保留为历史决策，不构成本次前置。当前 G1 仍未通过，地图排查暂停。各阶段须以实际实现与验证记录为准，不能据计划声称完成。

更新：2026-09-20。文档的“当前实现”“待实现方案”“历史证据”分开维护，不再以旧交接文件充当最新状态。

## 从这里开始

- [G1 发布合同 v1 验收收尾](design/budget-travel-agent/G1_PUBLICATION_ACCEPTANCE_2026-09-21.md)：离线、独立数据库和 H5 固定结果详情/刷新已验证；旧记录 P5 失败，新 live 与微信环境仍未测，G1 总门未关闭。

- [攻略发布合同 ADR 0024](adr/0024-guide-publication-contract.md) 与 [G1 冻结验收 v1](design/budget-travel-agent/G1_PUBLICATION_RUBRIC_V1.md)：9月21日独立诊断后的修正范围，验证见 progress。

- [当前项目上下文](PROJECT_CONTEXT.md)：代码现状与已知边界。
- [当前架构修改方案](design/budget-travel-agent/RUNTIME_PLAN.md)：当前 DSH 后端实施的状态入口；执行顺序见 DSH 实施方案及 DPS。
- [唯一开发计划](design/budget-travel-agent/DPS.md)、[测试与评估协议](design/budget-travel-agent/EVALUATION.md)、[进度](design/budget-travel-agent/progress.md)。
- [文档维护规则与清理记录](DOCS_MAINTENANCE.md)：每一次修改必须同步 docs；清理分类与历史入口。
- [开发续作规则](CODEX_KICKOFF_PROMPT.md)。

## 权威与状态

当前行为的权威顺序：用户本次要求 → [架构](FLIGHTOR_ARCHITECTURE.md) → 已接受 [ADR](adr/) → [工具表](TOOLS.md) → PROJECT_CONTEXT → 领域/运行说明。若源码与文档不一致，先记录并核实差异，不根据文档虚构实现。

Proposed ADR 和本轮方案描述目标，不代表当前代码已生效。ADR 0018/0019 见下表。

| 类别 | 入口 |
| --- | --- |
| 产品目标 | [RAS](design/budget-travel-agent/RAS.md) |
| 后续能力全景 | [RDS](design/budget-travel-agent/RDS.md)，非本轮全部施工范围 |
| 交互复审 | [UX_REVIEW](design/budget-travel-agent/UX_REVIEW.md)，执行顺序以 DPS 为准 |
| 首轮运行优化决策 | [ADR 0019](adr/0019-lean-planner-evaluation.md)，B1–B5 已实施，B2 默认关闭；G1 真实保存/恢复 2/2，内容质量未过门槛，平台待验收 |
| 完整旅行能力方向 | [ADR 0018](adr/0018-budget-travel-agent-evolution.md)，Proposed、后续方向 |
| 当前后端地图 | [backend-architecture](backend-architecture.md) |
| 部署与本地联调 | [deploy](deploy.md)、[本地登录](local-test-login.md)、[微信接入记录](local-wechat-integration.md) |
| 当前视觉基线 | [蓝色 UI Experience](design/ui-experience-v1.md)；Phase 6 tokens 仅历史参考 |
| 当前真实验收的最近记录 | [9 月 20 日 G1 报告](design/budget-travel-agent/G1_LIVE_2026-09-20.md)：两例持久契约通过、第一例日期硬失败、完整阶段计时及费用；[9 月 14 日记录](FLIGHT_FIRST_ACCEPTANCE.md) 保留为历史 |
| 性能诊断证据 | [9 月 13 日东京调用分析](CALL_ANALYSIS_2026-09-13_TOKYO.md)，单次自备机票攻略 |
| 可选航空供应商 | [OAG](oag-integration.md)，不是核心必需依赖 |

最新 G1 [修复后追加复验](design/budget-travel-agent/G1_RETEST_2026-09-20.md)：两例真实持久链路通过，价格时效质量仍未通过；含完整阶段耗时与累计费用。

## 已接受 ADR 导航

- [0001 Runtime](adr/0001-agent-runtime-phase-0-1.md)、[0002 云状态](adr/0002-cloud-state-phase-2.md)、[0003 工具](adr/0003-core-tools-phase-3.md)。
- [0004 路线引擎](adr/0004-production-route-engine-phase-4.md)、[0005 研究和攻略](adr/0005-core-tools-and-production-research-phase-4b.md)。
- [0006 Agent API](adr/0006-agent-api-and-route-generation-phase-5.md)、[0007 工作区](adr/0007-plan-and-flight-workspace-phase-6.md)、[0008 发现与云行程](adr/0008-route-discovery-and-cloud-workspaces.md)。
- [0009 运行边界](adr/0009-live-demo-route-generation.md)、[0010 自主编排](adr/0010-domain-owned-planning-workflows.md)、[0011 交付一致性](adr/0011-verified-delivery-and-workspace-consistency.md)。
- [0012 Agent 编写攻略](adr/0012-agent-authored-itineraries.md)、[0013 本地登录](adr/0013-local-test-authentication.md)、[0014 联程票价](adr/0014-provider-connecting-fares.md)。
- [0015 临时进度](adr/0015-transient-planner-progress.md)、[0016 原生研究](adr/0016-native-research-production-integration.md)、[0017 日期](adr/0017-inclusive-trip-dates.md)、[0020 地点复用与日期证据](adr/0020-canonical-trip-locations-and-temporal-evidence.md)、[0021 探索范围与必需证据](adr/0021-guide-required-evidence.md)。

## 历史资料

HANDOFF 文件、DEMO_STATUS、PHASE789/UI_PARITY 验收和 experiments 是各自日期的记录，不是最新生产承诺。索引与处置见 [文档清理记录](DOCS_MAINTENANCE.md)。旧后端、旧部署及多城方案保存在 [archive](archive/README.md)，原路径已纠正或改为兼容入口。演示视频暂停，demo 文档不能触发新执行任务。

2026-09-21：新增 [攻略引用适用性 ADR 0022](adr/0022-guide-source-applicability.md)，当前事实有效性仍需核实，G1 未放行。

最近实测：[9月21日正文接入单例复验](design/budget-travel-agent/G1_SOURCE_RETEST_2026-09-21.md)，持久通过但内容仍失败，搜索累计额度已满。

问题咨询：[G1 阻塞说明与 GPT-6 Pro 咨询材料（9月21日）](design/budget-travel-agent/G1_PROBLEM_BRIEF_FOR_GPT6PRO_2026-09-21.md)，汇总真实失败、合同缺口、阶段耗时与待决策问题；不是新实施方案或验收放行。

2026-09-22：[正式概览与景点卡片](design/budget-travel-agent/PUBLICATION_UI_2026-09-22.md) 接续有界终稿，记录正式页面字段映射、显式本地化动作、H5/微信模拟器 fixture 验证与截图；不是全量 G1 或真实 Provider 验收。

2026-09-22 限定收尾：[固定版本、请求级代理、正式API与微信截图对照](design/budget-travel-agent/MAP_CLOSEOUT_2026-09-22.md)。微信底图仍未通过，不将地点解析成功当底图成功。
