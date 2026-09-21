# 文档维护规则与本轮清理记录

生效：2026-09-20，来源：用户明确要求“之后的每一次修改都要同步修改 docs”。仓库入口 [AGENTS](../AGENTS.md) 引用本规则。这里是仓库规则，不写入个人全局记忆。

## 每次修改必须做什么

1. 修改前从 [README](README.md) 找到负责该行为的文档，检查代码/配置/证据；历史 handoff 不是当前授权。
2. 同一修改批次更新相关 docs：接口/工具变更改 TOOLS；跨域行为改架构和 ADR；配置/启动改 deploy；UI 数据和交互改设计；测试结果更新当前 progress/评测报告。只写一行“文档已同步”不合格。
3. 无公开行为变化的内部重构/测试/脚本也在当前进度记录目的、影响范围、执行验证和未验证项；纯文档改动更新其版本/状态即可，不机械创建新报告。
4. 状态严格区分：当前实现、拟议、历史、已实现未验证、已验证。测试通过、真实 Provider 成功、H5 成功、微信真机成功分别记录。
5. 验证后再提交；每次提交的暂存范围也包含对应文档。无法运行的检查说明原因，不能引用旧测试数量顶替新证据。

| 变更类型 | 必须同步的入口 |
| --- | --- |
| Planner/工具/schema/完成语义 | TOOLS + 相应 ADR/架构章节 + 当前进度 |
| Trip/Artifact/来源或迁移 | 架构 + ADR + 兼容/回滚/验证说明 |
| UI 交互/展示转换 | 当前视觉/交互文档 + 对应行为验收 |
| 运行配置/Provider/模型/网络 | deploy/PROJECT_CONTEXT + 配置指纹与实测边界 |
| 性能/评测 | EVALUATION 报告与 progress，不用日志片段代替全部失败样本 |
| 维护脚本 | 本规则中的用途、命令、限制与验证记录 |

## 检查入口

2026-09-21：新增 `scripts/qa-g1-publication-weapp.cjs` 复用已保存公开投影，在实际开发者工具检查双入口详情和页面 reLaunch 恢复。连接已启用的 9432，需未登录模拟器；登录和全部 wx.request 被 mock，不访问真实 Provider。保存文本/截图/阶段耗时，结束后退出合成身份、恢复原 storage/页面并撤销 mock。`output/weapp/` 与既有 Playwright 输出一样忽略提交。实际运行、两次保留失败和未测范围见 [平台报告](design/budget-travel-agent/G1_PUBLICATION_H5_2026-09-21.md)；本轮无产品功能/架构变更。

2026-09-21：G1 runner 保留历史 `status` 兼容字段，新增 `acceptance` 分列 `persistence`、`content=not_assessed`、`platform=not_assessed` 与 rubricVersion。脚本不能仅因保存/恢复成功推断内容或平台通过；此批仅离线语法检查，不触发新 live。

```powershell
node scripts/check-docs.cjs
git diff --check
# 准备提交后检查实际暂存批次
node scripts/check-docs.cjs --staged
```

新增脚本检查 docs Markdown 中可识别的本地相对链接，以及有非 docs 改动时是否同批有 docs 改动。默认检查工作区（包含未跟踪文件），`--staged` 检查暂存改动范围；链接均检查当前文件，不冒充读取暂存文件内容。

限制：不访问外链、不检查锚点/反引号路径、不证明语义正确，也不能判断某篇文档是否真正匹配代码改动；这些仍需人工/Agent 审查。未安装 Git Hook 或 CI 强制门禁，不能声称未来所有修改会被自动拦截。没有修改 package.json 或依赖。Windows 沙箱禁止 Node 启动 Git 子进程时，需要允许该只读检查运行，不应关闭检查伪装通过。

## 当前清理决策

### G1 单次验收辅助脚本

`backend/scripts/verify-g1-live.mjs` 默认只打印 dry-run 固定案例；`node --test backend/scripts/g1-budget.test.mjs` 使用假的网络响应验证付费准入边界。真实执行需先构建 backend、准备 loopback 专用 `flightor_g1_live` PostgreSQL，在 backend 目录给该进程传 `G1_DATABASE_URL` 与本批已确认的 `G1_AUTHORIZED_USD=2` 后运行 `node scripts/verify-g1-live.mjs --execute`。变量是执行围栏，不替代用户对新批次的授权。

脚本使用当前 `.env` 凭证但不修改文件，所有迁移/测试身份只进入专用数据库；输出留在忽略的 `backend/.demo/g1-live-*`。账本必须在请求前持久预留，不能删除账本或启动新目录来重置本批额度。实际结果与未知费用在 [EVALUATION](design/budget-travel-agent/EVALUATION.md) 和 [progress](design/budget-travel-agent/progress.md) 维护；当前脚本不承担正式 A/B 或真实平台绘制验收。

“清理”优先移出有效入口并纠正错误，不销毁有价值的来源/验收证据。不因为旧文档存在就恢复旧功能或执行旧任务。

G1 续跑：设置 `G1_RESUME_LEDGER_DIRECTORY` 指向本仓库 `backend/.demo/g1-live-*` 的既有账本。dry-run 只读显示累计占用及剩余次数；真实执行使用原账本，保留全部历史调用和未知费用预留，新的报告/回执另存目录并记录 startingBudget。meter 对原账本加独占锁并校验版本、金额/模型/调用记录；缺失或损坏账本不能视作零消费。进程正常退出释放锁，异常残留锁需先核对持有进程，不盲删。此改动不增加原 US$2、24 模型、12 搜索上限，不构成新的调用授权。后续次数调整须记录明确许可，不能通过新目录绕过限额。

| 文档/类别 | 处理 | 原因 |
| --- | --- | --- |
| README、PROJECT_CONTEXT、CODEX_KICKOFF_PROMPT | 重写当前入口；旧 PROJECT_CONTEXT 归档 | 修正过期工作区、旧模型设置、缺 DB 配置 skip、没有跨版本例外等错误 |
| backend-architecture、deploy、multi-city-plan | 4 份归档中的另外 3 份；原路径改当前简明指南/范围入口 | 清除无后端、前端 key、Mock 自动降级、旧多城主链等误导 |
| FLIGHTOR_ARCHITECTURE、TOOLS | 保留权威，补当前 checkpoint 与拟议边界；修迁移现状和 docs 位置 | 不把目标状态冒充实现，不在清理时删除业务不变量 |
| ADR 0001–0017 | 保留已接受历史决策 | 后续 ADR 可以细化，不篡改旧决策当时的验证记录 |
| ADR 0018 | 保留 Proposed 后续能力方向 | 明确完整队列/visits v2 非本轮前置 |
| ADR 0019、RUNTIME_PLAN、DPS、EVALUATION | 当前拟议实施与测试入口 | 单一顺序：精简、跑通、测量、案例、评估、条件 DSH |
| RAS、RDS、UX_REVIEW、progress | 保留需求/能力全景/诊断；删除重复阶段顺序，进度集中 | 避免多份“唯一计划”竞争 |
| 6 份 HANDOFF、DEMO_STATUS、PHASE789_ACCEPTANCE、UI_PARITY_ACCEPTANCE | 原位标历史，不改原始结果 | 分支、端口、调用额度和设备证据只适用于记录当时 |
| FLIGHT_FIRST_TASK、local-wechat-integration、链路探讨 | 原位标历史，链接当前入口 | 历史任务/讨论不等于当前执行授权或链路 |
| FLIGHT_FIRST_ACCEPTANCE、CALL_ANALYSIS | 保留具体日期的实测证据 | 一份为航班优先失败，一份为自备机票成功但质量有问题；不能混称端到端成功 |
| docs/experiments 的 4 份报告 | 标记研究组件历史实验，保留原结果和案例引用 | 不作为完整 Planner/Harness 排名；旧额度不沿用 |
| design/ui-experience-v1、phase6-design-system | 统一当前蓝色与历史参考，修坏链接 | 不再出现顶部要求蓝色、正文指导海洋青的当前规范冲突 |
| design/travel-guide-mvp、admin-design-system、概念 PNG | 保留，说明作用范围 | 前者为阶段 MVP，后者独立后台视觉/设计参考；非无用素材 |
| local-test-login、oag-integration | 保留专题说明并从当前索引导航 | OAG 可选；本地身份不等于真微信登录 |
| demo/ | 新增暂停入口，保留制作说明与文案证据 | 不执行录制；已有未跟踪 DEMO_MASTER 内容未动 |
| archive/legacy/ | 加历史警示并修相对链接 | 保留可追溯原稿，禁止当当前运行手册 |

本轮不删除证据、图片、旧 ADR 或用户未跟踪文件；从活跃指南清除了重复/错误的大段内容，归档可追溯。没有为每份文档新建副本，仅归档被整体重写的 4 份旧稿。

## 已发现的证据缺口

2026-09-20 追加复验：用户明确“确认，完整复验”，允许累计 48 模型/24 搜索，共用原 US$2。验收进程设置 `G1_AUTHORIZED_CALL_LIMITS=48/24` 并必须指定原 `G1_RESUME_LEDGER_DIRECTORY`；缺省仍为 24/12，参数不代表未来新授权。新增用例验证续跑累计计数和费用不清零，最终 12/12 通过（0.810 秒）。真实结果继续记录在 G1 报告与 progress。

东京分析末尾的 4 个 `.demo` 本地诊断文件当前不在本工作区，已将失效链接改为历史路径并明确缺失；内嵌历史统计保留。本轮没有重新获取原始账本，因而只能核对报告内部与源码，不声称重算原始耗时。

UI 文档引用的 `UI_PHASE_HANDOFF.md` 不存在，改为实际存在的 UI 清理交接和航班优先验收，明确哪些仅为当时样稿状态。

最终检查结果集中在 [progress](design/budget-travel-agent/progress.md)。

2026-09-21：runner 支持 `G1_CASE=self-ticket` 或 `selected-flight` 选择原有固定案例；不传仍运行两例，其他值拒绝。单例续验也必须沿用原账本/次数限制，不能当作完整两例验收。新增 source reader 公共网页 HTTP 有独立 span，与收费模型/搜索计数分开。
