# FlightOR 文档入口

更新：2026-09-20。文档的“当前实现”“待实现方案”“历史证据”分开维护，不再以旧交接文件充当最新状态。

## 从这里开始

- [当前项目上下文](PROJECT_CONTEXT.md)：代码现状与已知边界。
- [当前架构修改方案](design/budget-travel-agent/RUNTIME_PLAN.md)：先精简现有流程，再跑通、测量、案例评估，最后决定是否试验 DSH。
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
| 首轮运行优化决策 | [ADR 0019](adr/0019-lean-planner-evaluation.md)，B1/B3–B5 已实施，B2 默认关闭/待 PG 集成验证，下一步 G1 跑通 |
| 完整旅行能力方向 | [ADR 0018](adr/0018-budget-travel-agent-evolution.md)，Proposed、后续方向 |
| 当前后端地图 | [backend-architecture](backend-architecture.md) |
| 部署与本地联调 | [deploy](deploy.md)、[本地登录](local-test-login.md)、[微信接入记录](local-wechat-integration.md) |
| 当前视觉基线 | [蓝色 UI Experience](design/ui-experience-v1.md)；Phase 6 tokens 仅历史参考 |
| 当前真实验收的最近记录 | [9 月 14 日航班优先验收](FLIGHT_FIRST_ACCEPTANCE.md)：航班成功、攻略未完成，非本轮新实测 |
| 性能诊断证据 | [9 月 13 日东京调用分析](CALL_ANALYSIS_2026-09-13_TOKYO.md)，单次自备机票攻略 |
| 可选航空供应商 | [OAG](oag-integration.md)，不是核心必需依赖 |

## 已接受 ADR 导航

- [0001 Runtime](adr/0001-agent-runtime-phase-0-1.md)、[0002 云状态](adr/0002-cloud-state-phase-2.md)、[0003 工具](adr/0003-core-tools-phase-3.md)。
- [0004 路线引擎](adr/0004-production-route-engine-phase-4.md)、[0005 研究和攻略](adr/0005-core-tools-and-production-research-phase-4b.md)。
- [0006 Agent API](adr/0006-agent-api-and-route-generation-phase-5.md)、[0007 工作区](adr/0007-plan-and-flight-workspace-phase-6.md)、[0008 发现与云行程](adr/0008-route-discovery-and-cloud-workspaces.md)。
- [0009 运行边界](adr/0009-live-demo-route-generation.md)、[0010 自主编排](adr/0010-domain-owned-planning-workflows.md)、[0011 交付一致性](adr/0011-verified-delivery-and-workspace-consistency.md)。
- [0012 Agent 编写攻略](adr/0012-agent-authored-itineraries.md)、[0013 本地登录](adr/0013-local-test-authentication.md)、[0014 联程票价](adr/0014-provider-connecting-fares.md)。
- [0015 临时进度](adr/0015-transient-planner-progress.md)、[0016 原生研究](adr/0016-native-research-production-integration.md)、[0017 日期](adr/0017-inclusive-trip-dates.md)。

## 历史资料

HANDOFF 文件、DEMO_STATUS、PHASE789/UI_PARITY 验收和 experiments 是各自日期的记录，不是最新生产承诺。索引与处置见 [文档清理记录](DOCS_MAINTENANCE.md)。旧后端、旧部署及多城方案保存在 [archive](archive/README.md)，原路径已纠正或改为兼容入口。演示视频暂停，demo 文档不能触发新执行任务。
