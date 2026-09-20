# 当前进度与验证

更新：2026-09-20。基线 main `9954c34`。当前阶段：按 DPS 完成 B0/B1，下一项 B2。B0/B1 与已有文档治理合并形成独立 Git 检查点；保留用户原有未跟踪 `docs/demo/DEMO_MASTER.md`，不纳入该批。模型/Provider/依赖配置没有修改。

## B0/B1 本批完成情况

- [BASELINE_A](BASELINE_A.md) 固定 B1 修改前 HEAD、文档脏树范围、10 个关键源码 SHA256 与历史返工分类；原始历史 `.demo` 文件仍缺失，未重算/新建付费基准。
- 新增 `backend/src/agent/cloud/planning-context.ts`，在首个模型请求前预装当前版本研究、未完成目标参数与攻略摘要；复用 owner-scoped repository、工作集引用和 Artifact 阅读投影，不激活 Goal/Run。
- 保留来源摘要/有效期、预算原始 scope 与未知 party basis，报告按日期、目的地、activity/practical 的预装缺口。新增上下文上限 24,000 字符，完整条目裁剪并告知省略，仍可按需读取。
- `service.ts` 接入预装，并记录准备阶段的耗时、字符数和条目数；不记录研究正文或 Memory 到指标。Goal 工具、保存索引输入和完成权威保持既有契约，B2/B3 尚未实现。
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

按 DPS 继续 **B2：领域边界接受紧凑语义目标并管理 Run**，完成兼容 flag、固定目标约束、跨 generation 隔离及单一 completion 权威；随后 B3 保存引用/错误分类、B4 已提交结果展示，B5 随之补齐观测。不要把本批局部准备计时称为 B5 完成。

G1 两条真实链路跑通后才启动正式时间测量与多案例批次。当前没有新的付费调用额度记录，旧演示额度不可沿用；尚未进入实际运行阶段，也没有据此阻止本批离线推进。

按用户要求自行管理 Git：每个通过验证的阶段单独提交，提交前检查实际暂存范围及 docs；不纳入无关文件。每一次后续修改同批更新负责该行为的 docs 及本进度，不新增竞争性的“最新交接”入口。
