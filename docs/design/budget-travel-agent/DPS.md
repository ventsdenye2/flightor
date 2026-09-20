# DPS：精简流程 → 跑通 → 测量 → 案例评估 → DSH 决策

2026-09-20。**当前唯一实施顺序**，替代此前 T00–T12/M0–M4 和 UX_REVIEW 中的阶段顺序。B0–B2 已提交，B2 仍默认关闭/待 PG 集成验证；B3 已实施，B4 起待推进。验证及未运行边界见 [progress](progress.md)。

架构：[RUNTIME_PLAN](RUNTIME_PLAN.md)。产品需求：[RAS](RAS.md)。测试协议：[EVALUATION](EVALUATION.md)。

| ID | 需求 | 改动位置（相对仓库根） | 意图与依赖 | 验收出口 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B0 | R03 R09 | `backend/src/agent/cloud/service.ts`、`agent/goals/working-set.ts`、历史调用分析 | 固定 A 的 SHA/diff/资料；诊断已知返工；不先进行大量新付费基准 | 能区分模型判断、工具执行、保存拒绝和研究缺口 | 完成，见 [BASELINE_A](BASELINE_A.md) |
| B1 | R01 R05 R09 | `backend/src/agent/cloud/service.ts`；`agent/cloud/planning-context.ts` | B0；预装有界有效研究、目标摘要、预算和选择；不自动激活旧目标 | 无重复 list/read 才能规划的前置；Memory 禁用及 owner/version 测试通过 | 已实现、离线验证通过；真实模型收益未测 |
| B2 | R01 R03 R08 R09 | `backend/src/agent/tools/goal-intent.ts`、`core.ts`、`agent/goals/repository.ts`/`postgres.ts`、`completion.ts`、`agent/cloud/service.ts` | B1；业务操作携带紧凑意图，领域边界接受目标和管理 Run；省去机械 finish 往返 | 目标不偷换、跨 generation 不接管、保存与完成同一权威；兼容 flag 可回退 | 已实现，默认关闭；离线回归与PG缺口见 progress |
| B3 | R04 R05 R09 | `backend/src/agent/tools/authored-travel-guide.ts`、`guide-draft.ts`、`travel-guides/candidates.ts`、`authored.ts`、`validation.ts`、正式 UI adapters | B1/B2；稳定候选引用、supportingRefs、错误分类、局部修订；沿用可表达的 v1 | 现有 practical 可直接补选；无自动研究修复；结构化预算守恒；取消/来源/版本校验保留 | 已实施，离线验证见 progress；真实模型文字质量留 G1/M2 |
| B4 | R06 R07 R08 | `backend/src/agent/runtime/activity.ts`、`agent/cloud/turns.ts`、`src/services/conversationService.ts`、`src/stores/chatStore.ts`、正式 UI adapter | B3；已提交结果立即进入现有轮询，浏览与输入草稿不全局锁死 | 卡片先于最终复述可见；不发布未提交结果；切账号/修改无迟到污染 | 待做 |
| B5 | R06 R09 | `backend/src/agent/runtime/model.ts`、`runtime.ts`、`providers/openrouter/client.ts`、客户端渲染点 | 随 B1–B4 增量实现基本测量；不改变模型/路由 | 关联 usage/模型/配置/阶段时间；嵌套 span 不重复计时；未知费用 null | 未完成；B1 仅增加上下文准备耗时/大小/数量 |
| G1 跑通 | R03 R09 | 既有 backend tests、PG suites、UI tests；`progress.md` | B1–B5；先离线，再两条有界真实链路 | 已选航班攻略及自备机票攻略保存、领域验收、刷新恢复；真实费用/失败明确 | 待做 |
| M1 运行测量 | R06 | 拟建 `backend/benchmarks/planner/runner.ts`、manifest/results | G1；实现 EVALUATION 的计时与固定输入 | 端到端与后端耗时区分；A/B 相同配置；先单请求，不混负载 | 待做 |
| M2 多案例 | 全部 | 拟建 `backend/benchmarks/planner/cases.json` 与 fixtures；EVALUATION | M1；16 案例及 U12 三子案例；冻结事实与小批 live 分开 | 每例有预期、实际、错误、费用和证据；失败/超时入分母 | 待做 |
| G2 评估 | 全部 | EVALUATION 的批次报告与 progress | M2；按预注册门槛评价性能/质量/返工/维护 | 明确保留 B、继续业务优化或试验 C；不默认接 DSH | 待做 |
| C1 条件试验 | R06 R09 | 拟建隔离 `backend/benchmarks/planner/adapters/dsh.ts`，必要时 runtime adapter | 仅 G2 决定值得试验时执行；锁定 DSH commit | 同模型/资料/工具/verifier 的 B/C 对照，隔离/取消/回滚全部通过 | 未启动，条件任务 |
| G3 迁移决策 | 全部 | 新 runtime ADR、架构/工具文档 | C1 结果支持时才进行 | 收益与迁移成本明确；接受后才实施生产替换 | 未启动，条件任务 |

表中以 `agent/`、`travel-guides/` 等开头的后端简写均相对 `backend/src/`。每项完成时同步更新实际文档和 progress，不能只勾状态。

## 首轮不做

完整持久 Planner 队列、全量攻略 visits v2、新地图供应商、多城市/往返优化、全量模型横评、微服务拆分、视频制作，均不作为 B/G1 的前置。[RDS](RDS.md) 的相关内容保留为后续能力设计。开放后台持续运行/多实例前仍必须解决持久恢复，不能把本轮临时轮询升级冒充该能力。

## 回归与运行要求

按改动选择 backend check/test、独立 test:db、前端 conversation-progress/production-presentation、weapp 构建与真机验收；命令以 package.json 为准。无 TEST_DATABASE_URL 的数据库命令明确失败，不写成通过。未经执行不能引用旧测试数验收新改动。

真实调用使用有效凭证和当前明确额度；旧实验授权不能自动沿用。首轮修改可先完成全部离线验证。测量正式批次必须在 G1 跑通后启动；埋点随开发加入不等于提前进行性能试验。
