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

```powershell
node scripts/check-docs.cjs
git diff --check
# 准备提交后检查实际暂存批次
node scripts/check-docs.cjs --staged
```

新增脚本检查 docs Markdown 中可识别的本地相对链接，以及有非 docs 改动时是否同批有 docs 改动。默认检查工作区（包含未跟踪文件），`--staged` 检查暂存改动范围；链接均检查当前文件，不冒充读取暂存文件内容。

限制：不访问外链、不检查锚点/反引号路径、不证明语义正确，也不能判断某篇文档是否真正匹配代码改动；这些仍需人工/Agent 审查。未安装 Git Hook 或 CI 强制门禁，不能声称未来所有修改会被自动拦截。没有修改 package.json 或依赖。Windows 沙箱禁止 Node 启动 Git 子进程时，需要允许该只读检查运行，不应关闭检查伪装通过。

## 当前清理决策

“清理”优先移出有效入口并纠正错误，不销毁有价值的来源/验收证据。不因为旧文档存在就恢复旧功能或执行旧任务。

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

东京分析末尾的 4 个 `.demo` 本地诊断文件当前不在本工作区，已将失效链接改为历史路径并明确缺失；内嵌历史统计保留。本轮没有重新获取原始账本，因而只能核对报告内部与源码，不声称重算原始耗时。

UI 文档引用的 `UI_PHASE_HANDOFF.md` 不存在，改为实际存在的 UI 清理交接和航班优先验收，明确哪些仅为当时样稿状态。

最终检查结果集中在 [progress](design/budget-travel-agent/progress.md)。
