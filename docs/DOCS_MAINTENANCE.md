# 文档维护规则与本轮清理记录

## 2026-09-25 DSH 正式 H5 续验脚本

续验runner逐启动写入`server-<uuid>.jsonl`：实际安装的legacy/Research/首次Finalizer/票价守卫、HTTP路径/方法/状态/时间及关闭时违规调用计数。缺失待守卫方法时启动失败，不能静默跳过。审计不含请求头、Key、正文或查询参数，失败/进程中断前的已写记录保留；未来H5 PASS须同时检查该审计和worker observer，不能用静态代码断言代替实际路径证据。

预算管理的显式grant允许`additionalModelCalls=0`，以便模型次数仍充足时只按用户新授权追加金额/搜索，不擅自提高模型上限。没有新的明确授权时不得调用该管理方法；旧entries、batch及未知预留仍完全保留。该能力本身不代表额度已经增加。

四次失败后收紧最小commit probe：新的显式重试创建保留的`COMMIT-<attempt>`独立测试Trip/会话，只含文化兴趣和“一处景点、另一天自由休息”的冻结请求，避免旧失败Goal及原A用例的小吃兴趣污染最小提交测试。仍使用原目录、schema、预算batch和所有旧attempt，不删除/改写旧Goal或费用；这仅验证冷启动最小发布，不能替代正式A会话的warm followup/局部编辑。任何付费重试仍须原账本存在足够且当前明确授权的额度；probe绝不注入网页URL、正文、证据或固定攻略。

`backend/scripts/verify-dsh-e2e.mjs` 默认/`--dry-run`只读核对原账本；通过显式`--execute --model|--search|--commit`按顺序运行独立真实probe，失败保留且重试必须显式`--retry-failed`。三项通过后`--serve --execute`才开放3025正式认证写API。所有数据仅进入保留的`dsh_e2e_20260924`隔离schema，沿用原`.dsh-data/budget.json`，不重置旧失败、未知费用或预算批次。用户两次新增US$3/48模型/12搜索及US$2/32模型/8搜索授权均以追加grant记录，当前累计上限US$7/128模型/32搜索；上限不是未来授权。

`scripts/qa-dsh-e2e-h5.cjs`使用已安装Chrome和正式H5；`--prepare --case A`只读检查，`--execute --case A --round 1`起通过真实输入框发送，`--restore`检查恢复，`--execute --localize`执行现有显式语言生成。只装载隔离用户的真实token和会话存储，不拦截API、不mock模型；每次发送保留独占attempt文件，失败后先核查已有turn，不能删除文件来盲目重发。私有transport/browser storage含token，禁止提交。脱敏报告和截图留在`output/playwright/dsh-e2e-20260924`，可分享证据选择性归入现有DSH报告目录。

`backend/scripts/dsh-e2e-observation.mjs`仅观察实际DSH运行，逐执行保留JSONL时间、工具名、调用回执和session/profile；不记录Key、模型推理或网页正文，不改变执行结果。真实结果、失败原因、调用总量和平台验收结论增量维护在[既有DSH D4报告](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。只读页面、probe和正式H5多轮验收分开认定。

## 2026-09-24 DSH 真实双对话 runner

`backend/scripts/verify-dsh-live.mjs` 默认/`--dry-run` 只解析配置和保留账本，不连接数据库、不发模型/搜索请求。显式 `FLIGHTOR_BASE_ENV_PATH` 指定基础配置，叠加 `.env.dsh.local`；`--execute --case A|B` 才在本批2美元/48模型/12搜索围栏下执行附件§13.2冻结用例。连接从忽略的 `.demo/dsh-db-env.json` 读取，迁移只进固定 `dsh_live_20260924`（共享pg_trgm扩展沿用既有迁移），保留schema、state、同一`.dsh-data/budget.json`与失败。B为明确标注的合成航班，使用真实采用API，不查实时票价。正式认证API和真实DB保存/读取，GET不能增加账本；显式本地化单列耗时/费用。`--serve`保留loopback3024供H5只读，无harness nonce的写请求拒绝；`transport.private.json`含合成测试身份token，禁止提交/分享。失败/中断case不自动重新发首轮或改措辞；凭证、账本、操作方式与实测边界见[DSH live操作说明](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。本条仅记录新脚本职责，不能据dry-run认定真实Provider或G1通过。

2026-09-22媒体维护脚本：`backend/scripts/media-validation.mjs`复用地点fixture helper，在独立loopback schema创建新的fixture攻略，正式媒体路由与真实PostgreSQL执行；默认禁新增出站，`--execute`才有界允许免费Wikimedia请求，不绕过旧账本/生产底稿保护。保留累计validation.json及失败，不写public。`test-media-postgres.mjs`使用唯一临时schema验证并发和版本保护，仅清理该schema。`qa-place-media-h5.cjs`用独立Chrome、3014真实媒体API、10087正式H5和明确fixture文字，检查真实原链解码/图像错误/版本产物并截图；需要代理时仅该浏览器配置，不改系统。`test-place-media-client.cjs`为离线并发合并与浏览状态回归。命令、失败和未测边界见[报告](design/budget-travel-agent/PLACE_MEDIA_2026-09-22.md)。

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
| ADR 0019、RUNTIME_PLAN、DPS、EVALUATION | 当前拟议实施与测试入口 | 2026-09-24 起，本次授权的 DSH 工作以 D0→D4 为执行顺序；既有 R/U 与条件 C1 评估顺序保留为历史依据，不作前置 |
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

## 2026-09-22 正式终稿 UI 验证脚本

`node scripts/qa-publication-ui-h5.cjs` 在已构建且由 `node scripts/serve-h5.cjs` 提供的10086 H5上使用已安装 Chrome，拦截 API 运输为冻结 fixture；`node scripts/qa-publication-ui-weapp.cjs` 使用既有9432 SDK与已登录模拟器，只替换 wx.request，finally 撤销 mock、恢复原语言/页面，不替换登录身份。脚本各自保留失败 JSON，成功报告/截图在忽略的 output/playwright/publication-ui 和 output/weapp/publication-ui。固定材料来自上一任务终稿示例与旧双入口 fixture，不调用模型/研究，不证明真实 API或真机验收。不要并发运行两个微信 fixture 脚本或在真实付费规划运行时替换 request。实际结果与失败经过见 [报告](design/budget-travel-agent/PUBLICATION_UI_2026-09-22.md)。


## 2026-09-22 地点验证脚本

`test-places-postgres.mjs` 仅使用 loopback DB 的新 `places_test_<timestamp>` schema，测试后删除该隔离schema；不操作生产业务。`places-live-server.mjs` 使用保留的 `places_map_20260922` schema及独占账本锁，只有 `--execute` 允许最多24次已授权Nominatim调用；`--acceptance` 保留原调试攻略并建最终验收副本，`--refresh-token` 仅更新隔离验收身份。`reparse-places-validation.mjs` 仅对隔离调试记录利用保留response作离线诊断，保存修改前后记录，不重置账本、不作为真实端到端证据。

`qa-places-h5.cjs` 验证正式H5、真实地点API和真实OSM瓦片；`qa-places-weapp.cjs` 使用现有SDK与真实持久地点的fixture transport，合成登录后恢复guest/storage/locale/mocks。严格检查认证GET、标记数量和稳定ID；SDK回调不认证底图。真实调用15/24、独立测试、截图及微信空白底图缺口见 [地图报告](design/budget-travel-agent/PLACES_MAP_2026-09-22.md)。output保留所有失败，本轮可分享报告/代表截图另存docs；不提交token、guest存储备份或transport文件。

## 固定版本地图观察脚本（2026-09-22）

`node scripts/prepare-fixed-map-observation.cjs` 要求52cb1c3干净dist，复制到忽略目录并增加诊断宿主页；不修改正式桥接、不查询POI。生成manifest记录app/route/bridge字节SHA，SDK同时读取运行中桥接方法，避免只认入口指纹。固定窗口截图须OS与SDK成对，updated不认证底图。

`backend/scripts/probe-place-egress.mjs --execute --request-proxy` 使用服务端PLACES_PROXY_URL和原账本独占锁；PLACES_PROBE_LEDGER_DIRECTORY可指向原目录。一次执行仅一次解析，TLS正常。旧24次账本兼容，用户明确取消次数后才使用limit=null且unlimitedPlaceCalls=true；不是自动无限重试。places-live-server同样读取此授权标识，未启动新的harness。用户要求重置USD2后采用有哈希链接的历史归档，新批次费用0，未删除旧记录。具体验证见[报告](design/budget-travel-agent/MAP_CLOSEOUT_2026-09-22.md)。
`test-place-media-stale.cjs` 使用延迟媒体 Promise 驱动实际 RoutePage hooks，离线验证账号、会话、行程、请求代次和内容版本切换后旧结果被忽略；与 media-client 一并纳入 `npm run test:production-presentation`，不发外部请求。

2026-09-25 H5 DSH 单轮验收脚本增加权威 GET 快照与 `scripts/dsh-h5-assertions.cjs` 断言辅助：同一 session、局部修改不变区域、权威总预算、英文仅本地化调用及恢复零付费副作用。`node scripts/test-dsh-h5-assertions.cjs` 为纯离线断言/反例测试，不启动浏览器或供应商；3/3 通过。真实执行仍只由 `qa-dsh-e2e-h5.cjs --execute` 显式单次触发并受后端 gate 约束；离线通过不代表当前 commit probe 或真实多轮通过。具体边界见 [DSH live记录](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。

2026-09-25：DSH H5 harness 兼容正式前端省略完全空会话的缓存行为；仅在保留原私有状态备份且真实 GET 确认同 scope 云端消息/产物全空后恢复原空身份壳。新增反例后离线4/4通过，真实headed Chrome `--prepare --case A`只读通过、账本哈希和调用数不变；不改前端，不覆盖已有对话，不推断付费验收通过。
