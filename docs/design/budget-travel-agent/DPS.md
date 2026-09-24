# DPS：当前授权工作按 DSH D0→D4 执行

2026-09-24：本次后端实施顺序以[DSH 实施方案](DSH_IMPLEMENTATION_PLAN_2026-09-24.md)的 D0→D4 为准。既有 B0–B5、G1、M1/M2、G2 与条件 C1 记录保留为历史实现、验收证据或先前决策背景；它们不构成本次 DSH 工作的前置门槛。G1 仍未通过，地图排查暂停。计划本身不代表阶段已实现或验证；阶段状态只按本次代码、测试和 progress/实施报告更新。

2026-09-22用户明确启动第四阶段真实景点图片，允许独立于地图故障/第三阶段全平台/G1验收开发。已实现Wikimedia显式补全、独立持久缓存、正式三处图片呈现；双景点H5及离线/DB验证通过，微信待服务端口恢复后实际验收。此次不进入M1、不改Planner，证据与限制见[图片报告](PLACE_MEDIA_2026-09-22.md)。地图暂停排查、仍未解决。

2026-09-22本轮用户追加发布末端终稿任务已实现，范围与[ADR 0025](../../adr/0025-bounded-guide-finalization.md)、[测试报告](FINALIZATION_2026-09-22.md)一致。不是主Planner重构，不自动进入M1；真实编辑中英三例通过不等于G1全链路放行。

2026-09-21 验收收尾状态见 [P1–P6 报告](G1_PUBLICATION_ACCEPTANCE_2026-09-21.md)：离线发布合同、双入口独立数据库、H5 固定结果详情/刷新在声明范围内完成。旧原记录 P5 仍失败，后续只处理明确的历史交付、新 live 授权及微信环境缺口。G1 总门未关闭，不进入 M1，不扩大架构或另加质量门槛。

2026-09-21 G1 收敛批次（用户已授权）：按 [ADR 0024](../../adr/0024-guide-publication-contract.md) 和 [冻结 rubric v1](G1_PUBLICATION_RUBRIC_V1.md) 执行。P1：在现有保存边界生成 publication/预算未知合同；P2：公开 Artifact、卡片、最终回复及历史统一投影；P3：旧样本与对抗回归，保留取消/版本/航班规则；P4：离线通过后另行有界真实及平台验收。前三项实现与证据见 progress；本批不新增 live，不提前启动正式 M1。

2026-09-20。**当前唯一实施顺序**，替代此前 T00–T12/M0–M4 和 UX_REVIEW 中的阶段顺序。B0–B5 已提交；B2 仍默认关闭。G1 数据库和修复后两条真实 Provider 保存/恢复契约通过，但内容价格时效问题阻止放行，平台仍未验收。逐阶段计时与质量见 [G1 报告](G1_LIVE_2026-09-20.md)，下一步见 [progress](progress.md)。 后续日期证据门槛与地点复用已实现，旧错误攻略在零付费快照复验中被拦截，正常航班攻略仍通过；已完成修复后 live 追加复验，最新结论见当前进度，见 [修复复验](G1_REPAIR_2026-09-20.md)。

架构：[RUNTIME_PLAN](RUNTIME_PLAN.md)。产品需求：[RAS](RAS.md)。测试协议：[EVALUATION](EVALUATION.md)。

| ID | 需求 | 改动位置（相对仓库根） | 意图与依赖 | 验收出口 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B0 | R03 R09 | `backend/src/agent/cloud/service.ts`、`agent/goals/working-set.ts`、历史调用分析 | 固定 A 的 SHA/diff/资料；诊断已知返工；不先进行大量新付费基准 | 能区分模型判断、工具执行、保存拒绝和研究缺口 | 完成，见 [BASELINE_A](BASELINE_A.md) |
| B1 | R01 R05 R09 | `backend/src/agent/cloud/service.ts`；`agent/cloud/planning-context.ts` | B0；预装有界有效研究、目标摘要、预算和选择；不自动激活旧目标 | 无重复 list/read 才能规划的前置；Memory 禁用及 owner/version 测试通过 | 已实现、离线验证通过；真实模型收益未测 |
| B2 | R01 R03 R08 R09 | `backend/src/agent/tools/goal-intent.ts`、`core.ts`、`agent/goals/repository.ts`/`postgres.ts`、`completion.ts`、`agent/cloud/service.ts` | B1；业务操作携带紧凑意图，领域边界接受目标和管理 Run；省去机械 finish 往返 | 目标不偷换、跨 generation 不接管、保存与完成同一权威；兼容 flag 可回退 | 已实现，默认关闭；离线与专用 PostgreSQL 验证见 progress |
| B3 | R04 R05 R09 | `backend/src/agent/tools/authored-travel-guide.ts`、`guide-draft.ts`、`travel-guides/candidates.ts`、`authored.ts`、`validation.ts`、正式 UI adapters | B1/B2；稳定候选引用、supportingRefs、错误分类、局部修订；沿用可表达的 v1 | 现有 practical 可直接补选；无自动研究修复；结构化预算守恒；取消/来源/版本校验保留 | 已实施，离线验证见 progress；真实模型文字质量留 G1/M2 |
| B4 | R06 R07 R08 | `backend/src/agent/runtime/activity.ts`、`agent/cloud/turns.ts`、`src/services/conversationService.ts`、`src/stores/chatStore.ts`、正式 UI adapter | B3；已提交结果立即进入现有轮询，浏览与输入草稿不全局锁死 | 卡片先于最终复述可见；不发布未提交结果；切账号/修改无迟到污染 | 已实施；离线证据与真实 UI 验收边界见 progress |
| B5 | R06 R09 | `backend/src/lib/planner-observation.ts`、`agent/runtime`、`providers/openrouter`、`src/services/plannerTelemetry.ts`、客户端渲染点 | B1–B4；基本测量不改变模型/路由 | usage/配置/路由指纹、保存/验收/首结果时刻；嵌套区间去重，未知费用 null | 已实施；离线证据见 progress，正式测量与平台 paint 未验收 |
| G1 跑通 | R03 R09 | 既有 backend tests、PG suites、UI tests；单次 `backend/scripts/verify-g1-live.mjs`；`progress.md` | B1–B5；先离线，再两条有界真实链路 | 已选航班攻略及自备机票攻略保存、领域验收、刷新恢复；真实费用/失败明确 | 进行中：真实持久契约 2/2；旧日期问题已修复，最新价格时效质量未过，平台待验收 |
| M1 运行测量 | R06 | 拟建 `backend/benchmarks/planner/runner.ts`、manifest/results | 旧计划要求 G1；仅为先前评估路线 | 端到端与后端耗时区分；A/B 相同配置；先单请求，不混负载 | 旧路线待做；不是本次 DSH 前置 |
| M2 多案例 | 全部 | 拟建 `backend/benchmarks/planner/cases.json` 与 fixtures；EVALUATION | 旧路线要求 M1；16 案例及 U12 三子案例 | 每例有预期、实际、错误、费用和证据；失败/超时入分母 | 旧路线待做；不是本次 DSH 前置 |
| G2 评估 | 全部 | EVALUATION 的批次报告与 progress | 旧路线要求 M2 | 按预注册门槛评价性能/质量/返工/维护 | 旧路线待做；不是本次 DSH 前置 |
| C1 条件试验 | R06 R09 | 拟建隔离 `backend/benchmarks/planner/adapters/dsh.ts`，必要时 runtime adapter | 旧路线要求 G2 决定后才试验 | 同模型/资料/工具/verifier 的 B/C 对照，隔离/取消/回滚全部通过 | 旧条件路线未启动；本次 D0→D4 由新授权覆盖其前置逻辑 |
| G3 迁移决策 | 全部 | 新 runtime ADR、架构/工具文档 | C1 结果支持时才进行 | 收益与迁移成本明确；生产替换另需决定 | 旧路线未启动；本次实现不自动授权合并 main 或切默认 |

表中以 `agent/`、`travel-guides/` 等开头的后端简写均相对 `backend/src/`。每项完成时同步更新实际文档和 progress，不能只勾状态。

G1 后续修复：已增加显式必需证据类别，保留旧目标语义与不可变约束，见 [ADR 0021](../../adr/0021-guide-required-evidence.md)。离线与数据库记录在 [progress](progress.md)，修复后 live 和平台门槛仍未通过；该既有状态不阻止本次按新授权执行 D0→D4，也不代表 G1 通过。

## 首轮不做

完整持久 Planner 队列、全量攻略 visits v2、新地图供应商、多城市/往返优化、全量模型横评、微服务拆分、视频制作，均不作为 B/G1 的前置。[RDS](RDS.md) 的相关内容保留为后续能力设计。开放后台持续运行/多实例前仍必须解决持久恢复，不能把本轮临时轮询升级冒充该能力。

## 回归与运行要求

按改动选择 backend check/test、独立 test:db、前端 conversation-progress/production-presentation、weapp 构建与真机验收；命令以 package.json 为准。无 TEST_DATABASE_URL 的数据库命令明确失败，不写成通过。未经执行不能引用旧测试数验收新改动。

真实调用使用有效凭证和当前明确额度；旧实验授权不能自动沿用。首轮修改可先完成全部离线验证。测量正式批次必须在 G1 跑通后启动；埋点随开发加入不等于提前进行性能试验。

2026-09-21：推进 G1 引用适用性边界，见 [ADR 0022](../../adr/0022-guide-source-applicability.md)。当前保守标注未知，不等于已完成逐项时效核实；不进入 M1。

2026-09-21：继续 G1 正文与声明证据绑定，见 [ADR 0023](../../adr/0023-source-pages-and-quoted-claims.md)。先离线、安全读取，再原固定自备机票单例真实续验；不跳入 M1。

2026-09-22 第二项：按用户单独授权接续 main@8b51c99 的“概览与景点卡片”，沿用终稿字段/缓存/重试，完成正式 UI 与限定平台验证，见 [报告](PUBLICATION_UI_2026-09-22.md)。不扩大到地图/图片 Provider、全量 G1 或主 Planner 架构。
