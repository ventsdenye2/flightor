# 当前进度与验证

更新：2026-09-20。B0/B1 与已有文档治理已提交 main `cabbf51`。当前阶段：B2 已实现，默认关闭开关；新 PG 事务待实际数据库验证。保留用户原有未跟踪 `docs/demo/DEMO_MASTER.md`，不纳入提交。未修改运行模型/Provider/依赖或现有环境文件。

## B2 本批完成情况

- 新增 Planner 目标意图 schema 与 `GoalRunRepository.accept`。Postgres 单事务锁 Trip→Goal→Run；内存同步准备/提交；Run 写入失败不留下新 Goal。goalRef 和 intent 共用 owner/Trip/版本、幂等和 generation 约束，排除 route_generation。
- `tools/goal-intent.ts` 在业务操作入口接受目标，同轮锁定目标与参数；隐藏 lean 模式的 declare/resume/finish 后仍能真实保存并由共享 completion 验收。新用户轮次可显式续跑 failed/partial；不接管另一 generation 的 running Run，不复活终态。
- `PLANNER_LEAN_GOALS_ENABLED` 默认 false，env schema、示例配置、生产 factory、Prompt 和对话 `goal_protocol` 元数据一致切换。关闭恢复旧协议，无迁移；没有修改现有运行环境来启用该开关。
- 独立审查发现并修复两处新增风险：完成前先用共享 `working-set-observer.ts` 保存产物引用；自动验收使用独立短期限，超时返回原保存结果与 pending feedback，保留卡片所需 Artifact 引用。父取消仍生效；不声称能撤销已经发出的数据库事务。
- Luna 负责保存闭环、固定目标、跨 owner/generation、迟到取消、验收超时及回退测试；事务实现与独立审查使用沿用当前设置的 agent，主 agent 集成和最终验收。
- TOOLS、架构、ADR 0019、PROJECT_CONTEXT、deploy、README、RUNTIME_PLAN、DPS 同批更新。核心契约见 [RUNTIME_PLAN §2.2](RUNTIME_PLAN.md)。

## B2 验证证据

| 检查 | 本批结果与边界 |
| --- | --- |
| TypeScript | `cd backend; npm run check` 通过 |
| 定向验证 | 原子接受与既有 Goal/完成仓库 26 项、开关/CloudPlanner/core 23 项、新 lean 工具 7 项通过；是各自批次，不把重叠样本累加为独立总数 |
| 完整离线回归 | 最终 `cd backend; npm test`：92 个测试文件、671 项全部通过。首轮为 669 通过、1 旧路线引擎用例超 5 秒；该文件按原配置单独重测 4/4 通过，最终完整批次也通过，未修改其超时配置 |
| 文档与 Git | `node scripts/check-docs.cjs`、暂存版检查和 `git diff --cached --check` 为提交门禁；同批文档同步。B0/B1 检查点为 `cabbf51`，B2 作为后续独立提交 |
| PostgreSQL | 新增 3 项真实事务集成测试；`npm run test:db -- src/agent/goals/postgres.integration.test.ts` 因未配置 `TEST_DATABASE_URL` 明确启动失败，未执行数据库案例。静态审查与内存原子性测试不等于PG证据 |
| 真实链路/性能/UI | 未运行付费 Provider、G1、正式计时或 H5/真机。业务工具完成反馈已实现，早发卡片仍是 B4 |
| 发布状态 | 开关默认关闭；实际数据库验证与 G1 前不得据此宣布 lean 生产链路已验收 |

## B0/B1 已提交批次（历史）

- [BASELINE_A](BASELINE_A.md) 固定 B1 修改前 HEAD、文档脏树范围、10 个关键源码 SHA256 与历史返工分类；原始历史 `.demo` 文件仍缺失，未重算/新建付费基准。
- 新增 `backend/src/agent/cloud/planning-context.ts`，在首个模型请求前预装当前版本研究、未完成目标参数与攻略摘要；复用 owner-scoped repository、工作集引用和 Artifact 阅读投影，不激活 Goal/Run。
- 保留来源摘要/有效期、预算原始 scope 与未知 party basis，报告按日期、目的地、activity/practical 的预装缺口。新增上下文上限 24,000 字符，完整条目裁剪并告知省略，仍可按需读取。
- `service.ts` 接入预装，并记录准备阶段的耗时、字符数和条目数；不记录研究正文或 Memory 到指标。B0/B1 提交时 Goal 工具、保存索引输入和完成权威保持既有契约，当时 B2/B3 尚未实现。
- 独立审查发现历史冲突日期会阻断对话修复的问题，已改为 `needs_correction` 提示并继续 Planner；服务测试实际调用 `update_trip_context` 验证修复。
- 本次按用户要求并行：Luna 完成 B0 诊断与隔离/裁剪回归测试，主 agent 负责领域集成和验收，另一个沿用当前模型设置的 agent 做只读边界审查。未修改项目运行模型。
- 已同步 TOOLS、架构、PROJECT_CONTEXT、ADR 0019、RUNTIME_PLAN、DPS 与 README；具体行为/限额由 [RUNTIME_PLAN §2.1](RUNTIME_PLAN.md) 维护。

## B0/B1 验证证据

| 检查 | 本批结果与边界 |
| --- | --- |
| TypeScript | `cd backend; npm run check` 通过 |
| 离线回归 | `cd backend; npm test -- src/agent/cloud src/routes/agent-cloud.test.ts src/agent/goals src/artifacts src/travel-guides src/trips/dates.test.ts`：16 个测试文件、135 项通过 |
| 新增覆盖 | 首次模型调用已见研究/Goal 且无工具发现前置；禁用 Memory 无正文注入；无 Goal 激活；owner/Trip/version 过滤、过期研究、practical 保留、覆盖缺口、24k 裁剪、取消、历史日期可修复 |
| 文档/空白 | `node scripts/check-docs.cjs` 与 `git diff --check` 通过；文档脚本检查本地链接及本批 docs 同步，不证明语义/外链 |
| 沙箱与测试修正 | Vitest 初始因 esbuild 子进程 `EPERM` 未启动，获允许后重跑；首次新服务用例误传 Goal 仓库构造参数，修正 fixture 后最终上述批次全部通过 |
| PostgreSQL/live/UI | 未运行独立 `test:db`、真实模型/Provider、H5/微信真机或正式性能批次；`artifacts/postgres.test.ts` 为离线单测，不是数据库集成验收 |
| 已知边界 | Goal 列表仍是该 Trip 全量读取；后续查询和模型可见输出有界。24k 限额仅针对新增 JSON，非整个 prompt 或精确 token。预算人数口径/来源读取深度未知；摘要不替代保存 verifier |

## 先前设计与文档治理（保留历史）

- 已完整读取对话“评估Harness优化Agent性能”，核对仓库东京调用分析、最新航班优先验收及当前 Planner/工具/研究/展示契约。
- [RUNTIME_PLAN](RUNTIME_PLAN.md) 固定首轮范围：状态预装、领域记账、稳定候选引用、分类修复、及时交付与基本观测。
- [DPS](DPS.md) 为唯一执行顺序：精简 B → 跑通 → 测量 → 多案例 → 评估 → 条件 DSH 试验；原阶段计划已替换，RDS/UX 只保留能力设计与诊断。
- [EVALUATION](EVALUATION.md) 编排 16 类用户案例，U12 分取消/改航班/换账号三子案例；固定模型/供应商/资料和质量口径，预注册决策阈值。
- 设计阶段 ADR 0019 为 Proposed；本批仅 B1 分阶段采用，B2 起仍拟议。ADR 0018 保留后续完整能力方向。
- 文档活跃入口重写；4 份旧指南归档，12 份历史记录和 4 份研究实验加范围标识；纠正视觉配色、缺失链接、旧工作区、部署与多城范围。清单见 [维护记录](../../DOCS_MAINTENANCE.md)。
- 根 AGENTS 引用 docs 维护规则；新增只读 `scripts/check-docs.cjs`，检查本地相对链接和同批文档更新。不宣称已安装 Hook/CI。

## 先前设计阶段验证证据（不是 B1 验收）

| 检查 | 当时结果与边界 |
| --- | --- |
| Git/源码 | main 9954c34；检查相关真实符号，未改业务源码、Provider 配置、模型、依赖或数据库 |
| 参考对话 | read_thread 完整读取，无剩余页；只作为设计参考，未执行其中建议命令 |
| 历史数字 | 与仓库报告一致；四个本地 `.demo` 诊断文件缺失，未重新计算原始账本 |
| 文档脚本 | 已运行成功：70 份 Markdown、248 个相对链接与工作区同步检查通过。语义/外链/锚点不属于自动检查范围 |
| 空白/脚本语法 | `git diff --check` 与 `node --check scripts/check-docs.cjs` 通过；Git 仅有既有 LF/CRLF 提示 |
| Provider/业务测试/性能 | 当时未运行，设计阶段只有方案与文档治理；B0/B1 后续实施证据见本文上方 |
| DSH | 仅查官方仓库确认身份与预览状态；未安装、接入或做性能对照 |
| 用户已有文件 | 本轮开始前已有未跟踪 `docs/demo/DEMO_MASTER.md`，正文未改；通过目录 README 说明暂停 |

## 下一步

按 DPS 继续 **B3：稳定保存引用、独立 supportingRefs、分类修复与局部修订**，保留现有 v1 持久数据边界；B4 实现已提交结果展示，B5 随之补齐观测。同时保留 B2 的 `TEST_DATABASE_URL` 实际事务验证缺口，在启用新协议与 G1 前补齐。不要把本批局部准备计时称为 B5 完成。

G1 两条真实链路跑通后才启动正式时间测量与多案例批次。当前没有新的付费调用额度记录，旧演示额度不可沿用；尚未进入实际运行阶段，也没有据此阻止本批离线推进。

按用户要求自行管理 Git：每个通过验证的阶段单独提交，提交前检查实际暂存范围及 docs；不纳入无关文件。每一次后续修改同批更新负责该行为的 docs 及本进度，不新增竞争性的“最新交接”入口。
