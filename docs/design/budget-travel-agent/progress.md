# 当前进度与验证

## 2026-09-22：a67ed77 终稿三项收尾

测试先行复现7个后端失败及前端blocked缓存失败后，修复显式有界技术重试/历史费用/迟到保护、practical日程角色和名称/部分占位检查。具体字段、红绿测与数据库证据见[收尾记录](FINALIZATION_FOLLOWUP_2026-09-22.md)及[ADR 0025](../../adr/0025-bounded-guide-finalization.md)。只提交本批修改；概览与景点卡片等待下一项需求，没有运行真实模型、模拟器或全量G1。

## 2026-09-21：测试环境调通与微信固定样本补验

主 agent 调试微信，Luna 只读诊断 Docker。微信自动化 9432 已可查询系统、页面、点击和截图；官方 CLI 仍读取缺失的 Local AppData .ide-status，不能据其提示否定已连通的 SDK，也未伪造该状态文件。用户已确认服务端口 32348 开启。

独立数据库定向 2 文件 4 项通过，6.96s；两入口领域 satisfied、保存/独立重读/workspace 恢复通过。Docker Windows named-pipe /_ping 5s 超时、docker ps 10s 超时，属于尚存管理接口问题；已运行 PostgreSQL 63432 正常。为保留 tmpfs 原实验库，没有重启 Docker/WSL/容器。

新增可复现脚本 scripts/qa-g1-publication-weapp.cjs，对真实 Taro 模拟器页面读取概览、两天及四个详情，重进页面后全文一致；当前副本 self 18.107/13.898s，selected 17.206/18.618s（显示检查/恢复检查，含操作截图）。测试使用保存的公开投影，全量拦截 wx.request；虚拟登录，不构成真实微信认证/后端网络/冷启动/真机证明。退出测试恢复原 storage、游客身份及页面并撤销 mock。详细边界与旧记录结果见 [平台报告](G1_PUBLICATION_H5_2026-09-21.md)。

本批没有产品源码改动，不重复冒称后端/前端全量；仅新增测试脚本、结果目录 ignore 和对应文档。原账本 SHA-256 不变，无付费请求。微信限定范围补验不改变旧记录 P5 失败与 G1 总门/M1 状态。以下表格为此前收尾时的历史状态。

## 2026-09-21：G1 发布合同 v1 验收收尾

以已 fetch 确认的 `main@99f2ed7` 为基线。完整用户可见结果、P1–P6、复现命令与失败记录见 [验收报告](G1_PUBLICATION_ACCEPTANCE_2026-09-21.md)，浏览器边界见 [H5 报告](G1_PUBLICATION_H5_2026-09-21.md)。

仅修来源名称/实用参考表达：无空格名称逐字匹配、坏正文 hash 不用于命名、无 claim 时显示已绑定来源的显式搜索摘要引用。原始散文不直出、预算仍未判定，没有新增架构/critic/城市特例。

| 阶段 | 结果 | 耗时 |
| --- | --- | --- |
| 后端全量离线 | 100 文件 804 项通过；之后的最终小修/断言再做下行定向，未冒称最终全量重跑 | 90.75s |
| 最终发布定向 | 6 文件 105 项；随后增强具体 P5 断言 4/4 | 7.59s / 1.29s |
| PostgreSQL 定向 | 2 文件 4 项；两原样本按原 Goal 参数领域 satisfied、发布写入、独立连接重读及 workspace 恢复一致、预算/flight revision 保留 | 7.58s；各阶段毫秒见报告 |
| 前端定向离线 | 展示28、回复6、library7、history20、Artifact25；dispatch20、UI polish18 | 前五组 8.67s；不是前端全量 |
| H5 构建 | 成功 | Webpack 23.91s |
| H5 当前副本 | 两例概览、2天及4活动详情，刷新全文一致；采用航班时刻正确显示，0控制台错误 | self 5.757/3.091s；selected 3.580/3.361s（显示检查/刷新检查） |
| H5 旧记录 | 两例有限降级及刷新一致；**P5仍失败**，不能以泛化占位通过 | self 3.634/2.984s；selected 3.596/2.781s |
| 微信构建 | exit 0，既有 CSS/体积警告 | 最终墙钟23.947s；日志 `backend/.demo/g1-publication-weapp-final.log` |
| 微信开发者工具、真机 | 显示/恢复未测；已装CLI，自动化启动后SDK超时，官方CLI提示安全服务端口关闭；未连真机 | 不以构建、离线组件或 H5 代替 |
| 新真实 Provider | 仅原 runner dry-run；无新增付费请求 | 原账本 hash 不变，33/48模型、24/24搜索，累计占用 US$1.233018 |

去敏双入口 fixture 已纳入仓库，含原 research/route/flight/Goal 参数及原 SQL/guide SHA-256。原文件与账本最终 hash 校验不变。测试单独创建 `flightor_g1_publication_acceptance_20260921` 数据库与随机 schema；没有更改旧实验库。

本轮关闭离线发布合同、独立数据库和 H5 固定结果详情/刷新这三个声明范围。**G1 总门未关闭，M1 未启动**：仍需新授权的双例真实烟测、微信环境；旧原记录若要达到 P5，只可从绑定来源经现有保存边界重发新 Artifact，保留旧记录，不能自动追认或恢复模型散文。未新增隐含验收条件。

## 2026-09-21：独立诊断后的发布边界修正

用户已授权依据诊断实施。[ADR 0024](../../adr/0024-guide-publication-contract.md) 与 [G1 发布合同 v1](G1_PUBLICATION_RUBRIC_V1.md) 明确有限且可停止的验收范围；不是追认旧样本通过。主 agent 集成，Luna 分担前端及历史消息/独立审查。

本批实现：保存边界生成 server-owned publication，绑定 Artifact/Trip version/航班 revision/原始内容 hash；公开攻略复制不发布原始摘要、主题、备注。来源标题及有字面依据的条目摘录明确标注材料性质，quote/hash 检查不冒充语义/未来适用性验证。预算小计为 null、assessment=undetermined。新攻略成功回复来自保存结果；仅已提交且所有接触 Goal 都是已满足攻略的成功工具批次可省略最终模型复述。混合、部分、失败、取消/过期仍受原机制约束。

公开历史消息、workspace 恢复和本地旧缓存均处理攻略文字；用户消息不改。研究卡片改为来源引用而非模型摘要。旧攻略没有新字段时保守投影，原始记录不修改。runner 新增分层 acceptance，原 passed 只解释为持久链路。

验证记录（不含付费调用）：

| 阶段 | 本次结果 | 耗时/边界 |
| --- | --- | --- |
| 后端全量离线 | 100 文件、801 项通过 | 91.35 秒；后续内容哈希/条目引用小修再做下列定向回归 |
| 最终核心定向 | 6 文件、103 项通过 | 8.22 秒；含新增引用回归，不能写成重跑802项全量 |
| 收尾取消/研究 API 定向 | runtime 44项；Artifact/API 15项通过 | 2.31 / 3.12 秒；公开研究只保留来源标题/URL，内部 Agent 仍读取原材料 |
| TypeScript / backend build | 通过 | 未单独记录完整命令墙钟时间 |
| 正式展示/回复/library | 28 + 6 + 6 项通过 | Node 离线组件/适配检查，非设备 UI |
| 早期结果发布/航班发布/计时 | 通过 | 既有离线脚本；无真实 paint 结论 |
| 本地历史/Artifact | 20 + 25 项通过 | 包含嵌套 delivery、旧文字注入、来源卡片及实际组件文字树检查 |
| H5 最终构建 | 通过 | 最终 webpack 27.320 秒，有体积警告；不是浏览器验收 |
| 微信最终构建 | 通过 | 20.348 秒；样式顺序/体积警告，不是开发者工具/真机验收 |
| 旧 G1 原始样本离线重投影 | 通过本次检查 | 28.344 毫秒；不改原目录，不算新的真实执行 |

旧样本重投影仍保留 Sensoji Temple、Hoppy Street、Tsukiji Outer Market、Hamarikyu Gardens 的可追溯来源条目文字；不含旧无绑定票价区间，也不含“符合你1500元”的保证。1500 CNY 只作为目标保留，预算仍未知。这里只核对已保存材料的投影，不证明餐饮/交通实用信息足够、事实正确或完整 P5 已验收。本地重投影摘要在 `backend/.demo/g1-publication-replay.json`，脚本在同目录 `replay-guide-publication.mjs`；原实验快照不改写。

剩余：新的双入口有界 live、真实 H5/微信显示/刷新以及最低有用性验收未做；本批未重跑 PostgreSQL 集成。60秒配置/99.7秒旧请求异常未定位，不与本次发布修复混为一谈。一般聊天若没有 Goal/Artifact 关联，无法可靠识别为旧攻略回复，不做关键词删文；未支持的分享/导出不得自行读取原始文字当已审查结果。新搜索调用仍需新额度，原24/24保持不变。

文档工作区检查通过：84 份 Markdown、366 个相对链接；diff 空白与 runner 语法检查通过。提交前另检查暂存范围。未改生产 `.env`、模型、Provider 路由或依赖；未推送，保留 `docs/demo/DEMO_MASTER.md`。

H5 收尾补充：计时包装直接调用 Taro 的一次构建在 loader 阶段停滞，164.505 秒后仅停止已确认父子关系的本次构建子进程，日志保留为 `backend/.demo/publication-h5-build.log`。该次不是成功，未定位原因；随后使用此前成功的 `npm run build:h5` 入口复验最终代码成功（webpack 27.320 秒），未改依赖或配置。微信完整日志在 `backend/.demo/publication-weapp-build.log`。

更新：2026-09-21。B0/B1 已提交 main `cabbf51`，B2 已提交 `d895d0e`，B3 已提交 `6649644`，B4 已提交 `1ce177b`，B5 已提交 `2c2cb1d`，G1 数据库验证已提交 `ee631a4`。当前阶段：G1 修复后两条真实 Provider 追加复验已完成，保存/恢复契约2/2通过，但第一例内容价格时效有误，完整G1不放行。B2 仍默认关闭，平台验收未执行。保留用户原有未跟踪 `docs/demo/DEMO_MASTER.md`，不纳入提交。未修改运行模型/Provider 路由/依赖或现有环境文件。

## G1 自备机票真实单例续验（2026-09-21）

- `fe48d84` 上原固定案例已实际跑完：保存/satisfied/恢复通过，首保存176.148秒、首完成176.230秒、最终186.964秒、恢复0.143秒；完整阶段见 [单例报告](G1_SOURCE_RETEST_2026-09-21.md)。5模型/5搜索、1保存0修复，正文4页2成功2失败。
- **内容仍失败**：具体票价散文没有提交claimEvidence；预算未计算却声称符合1500元，英文元叙述仍出现。独立审查一致，不把durable satisfied冒充质量通过。已选航班/H5/微信本次未复验。
- 原累计账本33/48模型、**24/24搜索已满**；占用US$1.233018（含未知搜索预留1.20），美元剩余0.766982不能绕过搜索次数限制。未额外重跑或重置额度。
- 收尾：Docker API卡住；通过PG直连归档3份Artifact完整记录，完整SQL未取得。唯一临时容器停止请求超时，清理未确认，准确名称/ID/端口见单例报告；未重启或修改业务容器。
- 后续方向明确为用户可见事实/预算结论的结构化输出约束，消除省略claimEvidence却保留具体事实的自由文本旁路；不是继续堆提示词或换城市数字。运行后reader公网范围小修定向10项/0.653秒通过，未重新付费验收。

## G1 正文与声明证据（2026-09-21）

- 已实现有界正文读取、原文 claimEvidence 绑定、同一对象冲突拦截及新旧攻略传递，见 [ADR 0023](../../adr/0023-source-pages-and-quoted-claims.md)。Luna 分工实现 reader、证据测试及只读审查；主 agent 集成研究/攻略并核实边界。
- 审查建议只读官方来源；主 agent 采用“官方优先、其余明确标注”的有界策略，符合用户优先官方而非禁止其他资料的要求。未知来源不会因读取成功获得官方身份；安全读取检查对全部域名一致执行。
- 定向原链路 70 项通过（4.71 秒）；新增 reader/证据 18 项通过（2.55 秒）；最终完整后端 **99 文件 / 783 项通过，87.00 秒**。TypeScript 9.594 秒通过，最终 build 通过。JSON schema 与现有调用回归均未退化；没有新增依赖或修改模型。
- 真实 reader 独立检查：明治神宫成功（1.748 秒，1186 字符）；东京地铁 HTTP 403（0.790 秒）。只读代码路径得到的正文，不冒用 web 工具结果；403 仍视为未知。
- 已准备原 self-ticket 固定输入单例续验，dry-run 核对原账本 **28/48 模型、19/24 搜索、US$0.976748**；临时独立数据库与业务服务隔离。新结果另行记录，未执行前不声明通过。

## G1 引用适用性边界（2026-09-21）

- 服务端为新攻略每条日程/补充资料写入 reference_only 固定说明，保存与完成共享校验；不把刚检索、来源 verified 或缓存未过期当作票价/营业时间当日有效。新 builder v3，旧 v1/v2 可读且保持旧持久合同，不追认旧内容质量。详见 [ADR 0022](../../adr/0022-guide-source-applicability.md)。
- 预装上下文及 read_artifact 旧攻略投影保留同一边界；只读投影不改历史证据。Planner 指令同步要求最终复述保留限制、直接用用户语言答复。前端逐条相邻展示，不只给攻略顶部加全局警告。
- 最终后端完整离线 **96 文件 / 762 项通过，80.43 秒**；类型检查 **9.883 秒**及 build 通过。先期定向 **114 项 / 6.51 秒**；首次新支持资料测试用了未经过 schema 规范化的 fixture，修正后通过，未放宽生产规则。首次 esbuild 受沙箱阻止，审批服务一度容量不足；同一审批重试获准后执行。
- 两份原始 G1 文件仅做新读投影：已选航班 6 条引用 **5.213 ms**，自备机票 6 条 **3.186 ms**，逐项正文与原文件逐字保持不变且均有 reference_only。此数是文件读取/投影/断言耗时，不是模型、数据库或 UI 响应时间；没有改写旧失败样本。
- Luna 分别负责客户端适配/测试与只读独立审查，主 agent 负责后端和集成。审查未发现当前后端阻断项；确定性 builder 将来若写错字段，仍需 completion 拒绝，不能把所有保存路径称为事先做了完整内容校验。
- 前端最终集成复验：`test:artifacts` **22/22，2.258 秒**；`test:production-presentation` 含 production **27**、reply **6**、library **7** 项全部通过，合计 **3.858 秒**。前端 TypeScript 通过（未单独记录耗时），文档检查 **77 份 / 329 相对链接**通过。编译/适配测试不等于平台可视验收。
- **本批新增付费调用 0；G1 仍未通过。** 尚未新增运营方正文核实、来源冲突发现或逐项时效证明；reference_only 防止伪装当前已知，不是改正旧事实的证据。未运行 PostgreSQL 集成、真实模型重跑、H5/微信可视验收。原账本累计 28/48 模型、19/24 搜索、US$0.976748 占用保留；不得重置额度，也不把仅余 5 次搜索视作保证能完成两例完整重跑。

## G1 修复后真实追加复验（2026-09-20）

- 用户已明确批准完整复验，累计上限 48 模型/24 搜索，共用原 US$2。**已实际跑完两例，保存、satisfied、刷新恢复均通过；内容质量仍不放行**。本轮没有继续停留在离线准备，也没有改提示词或手工修样本。
- 每例 3 Planner+1Research、1次保存、0次修复，无重复地点解析或额外event要求。首保存 **73.265 / 131.629 秒**，首satisfied **73.366 / 131.848 秒**，最终API **93.999 / 148.815 秒**，恢复 **0.038 / 0.048 秒**。完整阶段与全部35span见 [追加复验报告](G1_RETEST_2026-09-20.md)。单样本不作为稳定提速或A/B结论。
- 本次新增8模型/9搜索，累计28/48模型、19/24搜索。1次搜索超时保留未知费用，累计占用 **US$0.976748 / US$2**，剩余 **US$1.023252**；模型实际已知与搜索预留分开记录。
- 新内容问题：自备攻略引用JNTO旧900日元联票，运营方当前1100日元；全局部分核实标签不能替代具体价格时效声明。明治神宫开放描述有来源歧义，两例最终回复带英文元叙述。航班案例有来源的NEX参考时长不因出现数字就判硬失败，主agent核对正文后保留精度风险。旧电影节误排未复现，原日期/地点/目标修复不能覆盖全部事实新鲜度。
- 预算准入12/12（0.810秒）、build与runner语法通过；Luna独立审计原始内容，主agent核对官方正文并作最终判断。专用数据库SQL、原始回执/攻略/workspace及portable metrics均归档；业务配置未改，平台H5/微信未执行。
- 下一步针对研究事实的价格/开放时间时效与不确定性传递修复，再有界复验；不能把本次2/2持久契约成绩等同完整G1内容通过。

## G1 修复后真实续验准备（2026-09-20，历史批次）

- 当前基线 `0f2852a`。原账本只读核对：累计占用 US$0.517287，余额 US$1.482713；20/24 模型、10/12 搜索，仅余 4/2 次。原协议次数不足以稳妥执行完整两例，未浪费剩余调用做预计会被截断的批次。
- 补充原账本恢复、独占锁及新报告关联，保持旧消费与未知预留、累计次数限制；dry-run 已显示上述余额和固定两例输入。未修改模型、业务环境、案例或已接受目标。
- 最终预算离线回归 **11/11 通过，0.931 秒**，runner 语法/dry-run 通过。原真实账本零网络恢复读出 30 次调用与 US$0.517287，逐字比对原文件未变化且锁已释放。初始化失败释放锁，未完成网络请求期间拒绝 close；异常残留锁不自动回收。首轮旧重启测试未先 close、随后关闭后 fetch 测试误用同步断言，均修正测试后通过；未放宽限额。此批只改验收脚本，未重复运行无关业务套件。
- 已请求只增加累计调用次数至 48 模型/24 搜索，继续共用原 US$2 总额；尚未获得答复时不执行依赖该调整的付费请求。此处是复验准备，不是 G1 新通过结果。

## G1 探索范围与必需证据分离（2026-09-20，历史批次）

- 基线 `c61be99` 后，Goal 新增可选 `requiredEvidenceTypes`：显式时只要求该子集，缺失时仍要求全部旧 `researchTypes`，不设空默认、不迁移旧目标、不在保存失败后删要求。共享 helper 统一保存、持久完成、工具反馈及只读上下文；参数整体仍参与 fingerprint。合同见 [ADR 0021](../../adr/0021-guide-required-evidence.md)。
- 已覆盖探索 event 非必需时可保存/完成、旧及显式必需 event 缺失仍失败、空类别不能保存空行程、选入的可选 event 仍须日期证据、同轮降低必需项仍冲突。专用 PostgreSQL 两例保存/恢复保留两个字段，完整数据库 **7 文件 / 37 项通过，20.65 秒**；没有使用真实模型或新鲜 Provider 数据。
- 类型检查与 build 通过。离线首轮 **755 通过 / 1 失败，81.38 秒**：新增空行程测试预期为每日覆盖错误，实际先返回 `guide_no_selected_findings`，修正测试以匹配正确的前置拒绝，没有放宽实现；新增新旧 Goal 只读摘要回归后，最终完整后端 **96 文件 / 758 项通过，83.19 秒**。类型检查/build/人工审查未单独计时，不估算为零或合并成 Agent 性能成绩。
- Luna 完成参数/helper 回归与独立审查、对应文档维护；主 agent 集成共享验收/反馈/上下文、完整测试及 Git。没有新增 Agent 架构、关键词推断或自动研究修复。新增付费调用 0，旧账本额度与调用次数不重置；业务服务未重启部署。本批临时 PostgreSQL 已核对名称/标签后停止并自动移除。
- **G1 仍不放行**：结构化参数已能区分探索与必需项，但 Planner 是否正确理解用户要求尚需修复后的真实链路验证；旧失败样本未被改成新参数冒充通过。下一步是保持原预算总账的可续验收准备，再按真实链路及平台门槛执行，不能直接进入正式性能对比。

## G1 修复与零付费复验（2026-09-20，历史批次）

- canonical Trip 地点已可复用；研究 finding 新增可选源文日期证据，保存与持久完成共用门槛，拒绝缺失或不匹配的 event 日期。Luna 负责地点复用、适配器回归和独立审查；主 agent 负责领域约束、集成与真实快照复验。
- 完整后端 **95 文件 / 745 项通过（79.75 秒）**，完整 PostgreSQL **7 文件 / 37 项通过（23.76 秒）**，类型检查与 build 通过。
- 将上批真实 SQL 恢复到本批独立 PG 后只读调用当前 verifier：错误电影节攻略由旧 satisfied 变为 failed，航班攻略仍 satisfied。恢复 **1.523 秒**，两例加载 **0.100 / 0.075 秒**、验证 **0.212 / 0.170 秒**。记录见 [修复报告](G1_REPAIR_2026-09-20.md)；这些不是模型端到端耗时。
- **G1 仍不放行**：目标研究范围与用户必需类别尚未分离，修复后实时链路和平台验收未执行。ISO 源文日期支持及 native 限制见报告；没有把拦住错误当成已能生成正确完整攻略。新增付费调用 0，原账本不重置；业务容器未重启部署。

## G1 实时链路与阶段计时（2026-09-20，历史批次）

- 用户明确确认本批两条真实链路共 US$2，并要求各阶段耗时。新增单次 `verify-g1-live.mjs` 和持久预算拦截及回归；使用正式默认 Planner 组装、独立身份/Trip/临时 PostgreSQL 16，仅验收进程启用 lean。未手工重试整例、未重写提示词或绕过 verifier。
- 两例均保存攻略、持久 `delivery=satisfied` 并通过新请求 workspace 恢复。自备机票 / 已采用航班：首次 satisfied **234.881 / 184.234 秒**，最终 API **253.694 / 213.958 秒**；后者预先查票及采用 **1.846 秒**。这是服务端/API 证据，不是 H5/微信渲染时间。完整逐阶段表、全部 74 个 span 和成本见 [G1 报告](G1_LIVE_2026-09-20.md)。
- 每例 10 次模型，总计 20 模型 + 10 SerpApi 请求。模型账本已知费用 US$0.017287（逐调用向上取整），搜索实际 USD 未知，保留 US$0.50；总准入占用 **US$0.517287 / US$2**。全部 30 次网络尝试 HTTP 200，领域错误、返工、内容失败仍完整记录；HTTP 成功不能代替质量。
- **第一例内容硬失败**：自行追加 event 必需类别后补查并安排 10 月 21 日电影节；官方日期实际为 10 月 26 日起。预算总额守恒通过，但来源日期推断不通过。第二例航班绑定/抵达后活动/4000 全程预算/每天一个主景点等关键硬约束通过；主 agent 打开官方正文，排除了 Luna 基于页面名提出的 Skyliner/交通来源误报，仍保留通用参考时间与本次实际未知的表述问题。独立人工软评分和真实平台展示未运行。
- Luna 分别负责付费拦截与契约/领域审计、输出质量独立审查；主 agent 修复准入兼容细节、执行真实批次、核实官方来源、记录计时及维护文档。未实施领域修复；定位到目标研究范围被升级为必需约束、时间敏感活动证据门槛、已知 canonical 地点未复用，以及模型意图冲突/草稿修复导致的额外回合。
- backend build、runner 语法/dry-run 通过；预算离线测试 **6/6**。原始证据和数据库快照留在忽略的 `.demo`；28 份 JSON/SQL 未匹配到当前 Provider 凭据。没有重跑不受影响的前端或全量业务测试，也不引用此前数量作为新验收。文档工作区/暂存检查 **72 份 Markdown / 295 个相对链接通过**，diff 空白检查无错误；74 个 span、调用/费用/持久结果的 JSON 一致性检查及独立交叉审查通过。本批临时 PostgreSQL 已停止并自动移除，既有 API/Worker 保持运行。

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

按 DPS 与发布合同 v1 继续 G1：本批发布边界离线修复已完成，下一步是核验最低有用性和真实平台展示/恢复，再在新的明确额度内执行固定双入口 live。价格/时间未知允许交付，不因查不到而无限研究；旧24次搜索额度已耗尽，不继续沿用余额发起搜索，也不进入正式 M1。保留全部旧样本及账本。

按用户要求自行管理 Git：每个通过验证的阶段单独提交，提交前检查实际暂存范围及 docs；不纳入无关文件。每一次后续修改同批更新负责该行为的 docs 及本进度，不新增竞争性的“最新交接”入口。
# 2026-09-22 有界终稿生成

实现新Planner攻略隐藏草稿→独立终稿→目标语言持久投影；同client/model、无工具、一次调用最多修复一次。中英切换基于接纳终稿本地化，不改Trip/活动/航班/预算；GET和verifier不调用模型。完整字段、版本与素材扩展接口见[ADR 0025](../../adr/0025-bounded-guide-finalization.md)。

[本轮报告](FINALIZATION_2026-09-22.md)记录最终103文件826项完整离线回归、16项终稿接点测试、PostgreSQL双入口恢复、前端语言缓存/请求及微信构建。真实模型最终zh/en/localization各一次接纳；累计9次（含失败），已知US$0.006764+未知预留US$0.20，总占用US$0.206764/2；搜索0，旧账本不变。真实微信端到端与多实例去重未测，不宣称部署/提速/G1放行。原未提交改动保留，本任务独立提交终稿增量。
