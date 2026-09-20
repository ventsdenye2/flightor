# 当前进度与验证

更新：2026-09-20。B0/B1 已提交 main `cabbf51`，B2 已提交 `d895d0e`，B3 已提交 `6649644`，B4 已提交 `1ce177b`，B5 已提交 `2c2cb1d`。当前阶段：G1 数据库与确定性持久恢复验证；B2 仍默认关闭，真实 Planner/Provider 与平台验收待执行。保留用户原有未跟踪 `docs/demo/DEMO_MASTER.md`，不纳入提交。未修改运行模型/Provider 路由/依赖或现有环境文件。

## G1 数据库验证（2026-09-20）

- 用户启动 Docker 后，使用现有 `postgres:16-alpine` 镜像创建本批独立临时容器：仅 loopback 随机端口、tmpfs 数据目录、`--rm`。`TEST_DATABASE_URL` 只传给本批测试子进程，测试自行创建/清理 schema；没有迁移或改写业务数据库，没有重启现有 API/Worker。
- Goal 原子接受/竞争/回滚定向套件 11/11 通过，补齐 B2 当时未运行的实际 PG 证据。
- 新增 `backend/src/workspaces/postgres.integration.test.ts`：两条案例均经过真实 CloudPlannerService → AgentRuntime → lean 保存工具 → PostgreSQL Artifact/Goal/Run → 服务端写入对话 metadata → 新 repository 刷新恢复。模型回复、研究与航班明确为 fixture，没有外部调用；不手工写入 satisfied 历史。检查攻略同 ID 恢复、服务端 delivery、已采用航班的精确来源/航段时刻和跨 owner 拒绝，自备机票不生成 flightSelection。
- 完整 DB 首轮 34/35 通过，唯一失败为旧 route 重复采用断言。溯源 `614dff7` 的同选择幂等契约，并经独立审查确认：同选择重试应保持原 revision/contextVersion/selectedAt，不执行新写入。更新回归同时检查旧/当前 expectedVersion 的 no-op，以及改变中转偏好、清除后再次采用仍拒绝 stale；生产代码没有因此改变。对应 discovery 套件 8/8 通过。
- 新 fixture 初次暴露非 UUID payload ID、混用 context/workspace version 和缺少 route-generation 迁移，均在测试数据中修正后，两个目标案例通过。没有修改领域校验、扩大跨版本例外或改错误处理以通过测试。
- Luna 负责有界覆盖审计和 fixture 初稿，主 agent 集成真实 CloudPlanner 持久闭环并运行数据库验收；另一 Luna 独立审查幂等/版本边界。架构、部署说明及所有活跃计划入口同步；历史 B2/B5 表格保留当时的未执行状态，不改写旧证据。

### G1 本批验证证据

| 检查 | 本批结果与边界 |
| --- | --- |
| 完整 PostgreSQL | 最终 `npm --prefix backend run test:db`：7 文件、37 项通过；包含 Goal 11、Artifact 4、workspace guide 2、discovery 8、native ledger 5、route generation 6、cloud state 1。运行于专用 PostgreSQL 16，不是内存替身 |
| 类型检查 | `npm --prefix backend run check` 通过 |
| 变更范围 | 仅修改两份集成测试和对应 docs；未改生产代码/配置/依赖。未重复执行不受影响的前端构建/测试，不借用 B5 数字冒称新执行 |
| 文档/Git | 提交门禁检查同批 docs、相对链接与暂存空白；本批测试容器验证后停止删除，现有业务容器保持运行 |
| 仍未验证 | 真实模型/Provider、H5/微信平台与性能批次；fixture 的 verified 标记只属于测试资料，不能当成已获取的真实研究证据 |

真实模型/Provider 两条链路与 H5/微信平台仍未执行，B2 未在运行环境开启。当前主环境已有相关凭证（仅核对是否存在），不能据此推断可用余额或继承历史额度；后续 live 批次需要按 DPS 记录本批调用/费用边界。正式计时与多案例仍在 G1 之后。

## B5 已提交完成情况（历史批次）

- 新增每轮有界服务端 recorder：上下文准备、Planner/研究模型、工具、实际 HTTP 和 Goal 验证 span，保留父子关系、并发区间去重及取消后 interrupted/迟到冻结。默认每轮只输出一条结构化日志，不向模型或公共 API 增加诊断内容。
- OpenRouter 记录实际出站配置、请求/返回模型、响应 Provider、tokens/费用、去敏入口指纹。未知账单保持 null，显式零保留；工具、HTTP 和 native 搜索分别计数。审查发现并修复了失败正文漏记已知搜索数，以及不同网关配置指纹碰撞的问题。
- 仓库提交后才记录航班/攻略首次保存，satisfied 持久提交后才记录 firstVerified。只读验证、失败保存/完成提交不会提前宣称交付；攻略保存/局部修订和分类修复反馈独立计数。
- 客户端保留默认 32 轮内存诊断：点击、有效 accepted、本轮可用结果分支的 effect commit 与最终 commit。旧选择、空结果、引用刚到达均不能冒充首结果；账号/会话/轮次变化拦截迟到污染，失败与取消保留已有首结果。缺失时钟或没有点击时相应指标 null，不以墙钟或终止时间填补完成时间。
- 同步架构、TOOLS、ADR 0019、RUNTIME_PLAN §6、EVALUATION §4.1、UI 所有者文档及入口；明确 effect commit 非 paint、模型费用非全部外部账单、埋点非性能成绩。未建设 M1 runner、自动上传、持久队列或 DSH。
- 继续按用户要求分工：Luna 负责 recorder/native 回归和适配器初稿，客户端 agent 完成 UI 计时与跨端只读审查；主 agent 整合模型适配器、领域埋点、修复审查问题、docs 和 Git。最终配置仍沿用原模型与路由。

### B5 验证（2026-09-20）

| 检查 | 本批结果与边界 |
| --- | --- |
| 完整离线后端 | 最终 `npm --prefix backend test`：94 文件、729 项通过；包含并发区间、迟到回调、未知账单、网关指纹、失败搜索回执及持久里程碑。离线 postgres 文件不等于实际数据库集成 |
| 类型检查 | 根 `npx tsc --noEmit --pretty false` 与 `npm --prefix backend run check` 均通过；修复 exactOptionalPropertyTypes 下 reasoning effort 类型后复验 |
| 定向客户端 | phase5 86、conversation progress 23、组件提交 9、Plan 页面 12、telemetry sink 8、session recovery 20 通过；使用确定性 hooks/stubs，不是平台 paint 验收 |
| 完整前端与构建 | 最终串行 `npm test` 全部通过（exit 0）；随后 `npm run build:weapp` exit 0，确认 app 与 Plan 页面产物。仍有既有 CSS 顺序警告，common.js 为 266 KiB，不能以构建代替真机体验验收 |
| 文档与 Git | 工作区 docs 检查：71 Markdown、281 相对链接及同批更新通过，`git diff --check` 通过；提交前另执行暂存门禁。仅暂存本批 39 文件，不纳入已有演示文档 |
| 未运行 | B2 PostgreSQL 新事务、G1 两条真实链路、付费 Provider、H5/微信真机、正式计时与 A/B。当前没有新付费额度记录；没有从离线回归推断提速比例 |

前端完整回归首轮在 Phase6 的两项精确源码字符串断言失败：send 增加点击元数据第三参，结果对象增加 guideId/verificationStatus。核实单 ChatStore 权威与成功分支清错未变后更新断言，定向 22/22 通过；没有放宽业务断言或修改运行行为来迁就测试。

## B4 本批完成情况

- 领域提交后通知 runtime，再投影到现有 turn 短轮询；仅真实保存的航班/攻略引用可以早于最终模型文本出现。新增作用域及单调 artifactRevision、最多 24 引用，模型返回值与研究卡不能冒充已保存成果。
- GET 重新验证 Trip/选择版本；并发读取期间若发布 revision 或终态发生变化，最多重读 3 次，持续变化返回可重试 503 而不破坏引用。过期结果与迟到最终文本不能复活已失效引用。取消/版本变化发生在提交后时，不发布迟到引用，也不宣称撤销已完成事务。
- 新增 owner-scoped 取消端点，传递 abort、忽略迟到事件并保留已保存结果；同作用域新 generation 替代旧执行。客户端等待取消确认，失败仍占用提交入口；完成已抢先发生则继续读取真实最终响应。
- 客户端按账号/auth revision/会话/request/turn/generation 隔离合并，失败与取消保留引用；无 assistant 文本但已有保存结果的历史也能恢复。正式 UI 在等待阶段显示已保存攻略与航班，允许只读航段浏览与编辑未发送草稿，完成后保留草稿；采用、更换、再提交仍受当前执行约束。
- runtime/transport/repository 权威分工不变；没有持久队列、visits v2、模型/Provider 替换、新地图或视觉重做。精确接口及兼容归属 [RUNTIME_PLAN §5](RUNTIME_PLAN.md)、TOOLS、架构、ADR 0015/0019 与 UI 文档。
- 按用户要求分工：Luna 处理有界 UI 和接口测试，客户端 agent 接入 transport/store 并交叉审查后端，主 agent 负责领域提交/投影、集成、docs 与 Git。审查发现的异步 reconcile 竞态和等待分支漏卡片均纳入修复。

### B4 验证（2026-09-20）

| 检查 | 本批结果与边界 |
| --- | --- |
| 完整离线后端 | `npm --prefix backend test`：93 文件、708 tests 全部通过；覆盖提交门槛、错误/伪造引用、取消/替代、版本移除、异步读取竞态与有界重试 |
| 前端 transport/store/history | `test:phase5-client` 78、`test:conversation-progress` 22 + progress component 6、`test:chat-history` 17 通过；包括提前引用持久化、失败/取消保留、乱序去重、失效移除和账号/会话切换 |
| B4 组件与页面 | `npm run test:planner-publication`：7 项真实组件 hook 检查 + 11 项 Plan 页面 hook 集成通过；覆盖已选 A 与新候选 B 共存、身份切换、旧提交错误、首次 bootstrap、草稿与取消反馈。已接入默认 `npm test`；不是浏览器/真实 React renderer/设备验收 |
| 既有测试维护 | 修复 session-recovery 的 i18n/MobX stub 和空 Artifact fixture，20 项通过；Phase 6 旧“最终响应独占引用”源码断言更新为 B4 当轮发布与最终响应合并，运行语义由 phase5 回归承担 |
| 类型检查 | 根 `npx tsc --noEmit --pretty false` 与 `npm --prefix backend run check` 通过 |
| 完整前端与构建 | 最终串行 `npm test` 全部通过（exit 0）；最终源码 `npm run build:weapp` exit 0，生成 app/Plan 页面产物。保留既有 CSS 顺序与 common.js 260 KiB 警告；不等于平台视觉/输入验收 |
| 文档与 Git | `node scripts/check-docs.cjs --staged`：71 Markdown、275 相对链接及同批 docs 检查通过，`git diff --cached --check` 通过；暂存 36 个 B4 文件，用户未跟踪演示文档保持不动 |
| 未运行 | PostgreSQL 新事务、付费 Provider、G1、H5/微信真机和正式性能测量。B2 仍默认关闭，不将构建/离线结果视为生产链路验收 |

完整前端初次执行暴露旧 harness 漏 stub 和前 B4 断言，均已修复。并发构建期间一次测试临时目录清理遇到 Windows EBUSY；改为串行并清理本次遗留目录，没有修改业务重试逻辑或放宽测试要求。

## B3 已提交完成情况

- 新增固定长度 candidateRef，无数组位置依赖；研究返回、B1 上下文和 read_artifact 产出相同引用。无候选表/缓存依赖，绑定 owner/Trip/version/完整证据内容，重新解析仍检查权限、来源身份和有效期；旧索引输入保留。
- supportingRefs 单独选实用或其它支撑资料，保存为 v1 可选 supportingEvidence；共享验收包含其来源、城市、日期、类别、过期与重复检查。交通提示无需伪装成日程景点，空白日不能靠 supportingEvidence 满足活动覆盖。Goal 上限和要求不降低。
- 新版 authored guide 从 Trip 保存结构化 budget，总额/币种/范围保持一致，人数口径未指定。攻略卡和正式概览分别展示预算约束与补充信息，资料过期时显示过期。未实现模型散文预算语义自动评分，真实文字质量仍属 G1/M2。
- 分类反馈、字段路径和 blockedChecks；既有 practical 候选优先返回；反馈和查询数量有界、非穷尽明确。Provider 故障保留安全冷却字段和共享适配器冷却，不新增自动重试。取消仍维持原边界。
- 同 generation 最后一份失败草稿支持 draftRef/revision + replacementDays/supportingRefs；仅替换指定已有日期，整稿重验，保存成功后清除。换上下文或重启要重新提交完整输入，跨轮从持久 Artifact 恢复。
- 用户授权下按难度分派：Luna 实现 UI 适配/错误 envelope，沿用当前主模型的 agent 负责领域验证和独立审查；主 agent 完成引用/草稿协议、集成和文档/Git。审查发现的 Unicode 引用长度、反馈上限、历史日期冲突和过期资料展示已修复并有回归覆盖。
- TOOLS、架构、ADR 0019、RUNTIME_PLAN、DPS、PROJECT_CONTEXT、README 与 UI 所有者文档同步。没有更改研究 v2 schema，也没有实现 visits v2、B4 提前发布、B5 完整计时或 DSH。

## B3 验证证据

| 检查 | 本批结果与边界 |
| --- | --- |
| Backend TypeScript | `npm --prefix backend run check` 通过 |
| 完整离线后端 | `npm test`：93 文件、694 tests 全部通过；包括来源/取消/版本、lean 与旧协议、原 Research 限流回归；未改测试超时配置 |
| 最后定向补验 | 完整回归之后新增预装/read_artifact/重新执行上下文同引用测试，并对超过 400 个紧凑引用错误补 feedbackTruncated；`npm test -- src/agent/tools/authored-travel-guide.test.ts` 28/28 通过，不将其冒称又跑了一轮完整 suite |
| Frontend | `test:artifacts` 19/19；`test:production-presentation` 26 项及附带 planner/library 检查通过；根 `npx tsc --noEmit` 通过；含过期资料和错误预算格式回归 |
| 微信小程序编译 | `npm run build:weapp` exit 0，生成本批 app 与页面产物；构建输出含 CSS 顺序冲突及 common.js 253 KiB 体积警告，未进行设备或可视交互验收 |
| 文档 | `node scripts/check-docs.cjs`：71 份 Markdown、269 个本地相对链接及同批文档检查通过；暂存检查在提交前执行 |
| 独立审查 | 来源与修订不变量交叉审查完成；发现并修复的边界见上；不等同实际数据库或端上交互验收 |
| PostgreSQL/模型/端上 | 本批未运行 PG 集成、真实模型/Provider、H5 可视交互或微信真机。B2 缺少 TEST_DATABASE_URL 的原缺口仍在，flag 仍 false；无新的付费调用 |
| 已知边界 | 草稿不持久化；可用候选窗口非穷尽；旧字段保持兼容但旧二进制严格 reader 不保证读取新增字段；自由文本质量仍需评估 |

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

按 DPS 继续 **G1 后半：已选航班与自备机票两条真实 Planner/Provider 攻略链路的保存、验收和刷新恢复，以及平台展示验收**。本批 PG 事务及确定性持久恢复已验证；测试用 scripted model 不证明真实模型能正确决策，也不证明 Provider 当前可用。B4 提前发布与 B5 埋点不能替代平台体验或性能成绩，不从离线样本宣称速度提升。

G1 两条真实链路跑通后才启动正式时间测量与多案例批次。当前没有新的付费调用额度记录，旧演示额度不可沿用；尚未进入实际运行阶段，也没有据此阻止本批离线推进。

按用户要求自行管理 Git：每个通过验证的阶段单独提交，提交前检查实际暂存范围及 docs；不纳入无关文件。每一次后续修改同批更新负责该行为的 docs 及本进度，不新增竞争性的“最新交接”入口。
