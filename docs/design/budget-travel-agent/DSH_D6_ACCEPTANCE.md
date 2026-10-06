# DSH D6 冻结验收与结果

标准 v1：2026-10-06（Asia/Shanghai），业务代码修改前冻结。状态：实施与迭代验证中，最终 UI 批次未运行；不能引用 D5/D4 的旧通过数替代。计划与当前授权见 [工程计划](DSH_D6_ENGINEERING_PLAN.md)。标准修订保留原版、理由和分母影响。

## A：确定性与真实持久化

八个测试族均必须覆盖，无失败删除、无内存替身替代 PostgreSQL：

| 族 | 冻结预期 |
| --- | --- |
| A1 Goal/适配 | 首次真实 intent；省略 goalRef/hash/version 正确提交；首次无 intent 拒绝；同轮修复复用固定 Goal，变更意图拒绝；跨消息编辑新 Goal |
| A2 引用 | 当前 candidate/source 短引用映射；伪造、跨 owner/Trip/generation、过期、重复候选拒绝；短引用不跨代重新指向 |
| A3 地点 | 唯一标准城市补齐；本地命中零外部调用；真实歧义返回候选；城市/机场/POI 不混淆、不猜机场、不硬编码案例 |
| A4 版本/CAS | 生成期间 Trip/flight/base guide 变化旧结果不覆盖；短事务条件写；受控同轮 Trip update 刷新快照且失效旧材料 |
| A5 编辑/去重 | 非目标 slot、预算语义、航班、来源保留；重复请求/工具消息不重复正式成果；基底绑定生成依据的真实 hash |
| A6 来源/公开内容 | 搜索失败/403/空正文/challenge/网页指令/错误引用正确处理；无证据精确事实和预算保证拒绝；合法预算目标和可信结构化航班显示不误杀 |
| A7 生命周期 | 取消/超时/迟到 IPC/重启/warm-cold/连续对话/Memory 变化保持隔离；取消确认后零迟到写；未完成历史任务不重放 |
| A8 D5 | 503/429/401 有界恢复、每次计量、独立修复额度保持；截断无半成品 accepted；完整 D5 10类×3次分母30 |

执行：实际 package.json 的 backend check/build/test/test:db；DSH runtime 独立测试及 D5 runner；前端 conversation-progress、session-recovery、artifacts、production-presentation；H5/weapp build；docs 检查和 diff --check。先审查出站边界，PostgreSQL 使用独立 loopback 数据库/schema，不访问 public 业务数据。每次命令/分母/结果及未运行边界追加到本报告。

## B：最终真实 UI 固定旅程

冻结日期使用 2026-11-03 至 2026-11-09 的未来窗口，不随运行日漂移。北京出发单程范围为 2026-11-03 至 2026-11-05；需要澄清时如实记录，禁止教产品工具协议。最终总分母12；生成样本与澄清/停止类分开统计。初始身份使用项目合法本地测试登录，其余创建行程/消息/采用航班/详情/停止/刷新/重进均 UI；不注入攻略，不 mock 最终真实 Provider。

冻结的自然语言输入和动作顺序见 [D6 UI journeys v1](d6-journeys.json)。执行合同为 `version: 1`、`journeys[].id` 和按序 `actions[]`；双语 `inputs` 仅是人工对照，不由runner执行。消息保持自然语言，不包含内部工具、intent、引用或版本字段。B09/B10 在生成中的取消使用 `send.awaitTerminal:false` 后立即 `stop`；B11/B12 的隔离后端冷重启是人工操作步骤，沿用同一隔离数据库、D6账本、身份密钥、构建与run目录。航班、澄清和发布均以实际页面结果为准，journey 文件不预置或伪造成功结果。

2026-10-06：在不变更12+4分母与冻结自然语言输入的前提下，将B11/B12详情验收步骤具体化为UI动作。B11从Planner结果及My Trips已保存攻略双入口进入详情，逐活动打开并记录详情sheet，返回概览退出并重进，同run冷重启后重读，然后显式切英文、点击首次本地化并要求单次`POST /v1/artifacts/:id/localization` 200，再切回中文。B12在航班UI采用后等待规划turn终态，并对实际攻略逐活动读详情、同样要求首次localization POST与中文返回、刷新及冷重启。journey与runner已表达这些条件，尚未真实运行；不能把动作配置计作通过。

| ID | 自然目标与必要步骤 | 通过预期 |
| --- | --- | --- |
| B01 | 自备票东京11/3–4，文化小吃，全程1200元；解释；仅改第二天下午；刷新 | 实际 accepted 两日；解释无新攻略；其他slot不变；恢复零生成 |
| B02 | 自备票东京11/5–6，全程1800元，安静文化体验；解释；仅改第二天下午；刷新 | 同上且偏好/预算口径准确 |
| B03 | 北京→葡萄牙单程11/3–5，省钱，明确允许独立出票自转机；UI采用真实结果后规划11/5–8 | 真实查票与采用，不保证全球最低；真实航班绑定，多日accepted |
| B04 | 北京→葡萄牙同窗口，省钱，不允许独立出票自转机；UI采用真实结果后规划11/5–9 | 合同内真实路线/采用；权限未放宽；实际交付 |
| B05 | 自备票京都11/3–7，文化饮食，之后只改一时段 | 五日完整accepted；地点准备及兼容资料复用；非目标保留 |
| B06 | 自备票里斯本及波尔图11/3–9，明确城市次序，之后减少购物偏好 | 支持范围内完整交付；不支持时昂贵执行前准确解释；不用于替代B01–04生成要求 |
| B07 | 问当前预算，设全程2000元，重复确认；未指定地区的“圣何塞”安排请求 | 问答只读，正确值无多余写；总额不变每天；真实歧义先澄清 |
| B08 | 问当前预算，明确每天500元并确认总额口径；未指定地区的“圣地亚哥”请求 | 不猜scope/地区，正确澄清；不承诺预算足够 |
| B09 | 东京两日生成中UI停止；改偏好再继续 | 确认停止、无迟到写/双活跃/busy；后续真实accepted |
| B10 | 京都多日生成中停止；改变预算再继续 | 同上，版本/材料更新准确 |
| B11 | 自备票东京生成后退出重进、刷新、隔离服务冷重启、显式英文再中文 | 可读accepted恢复；读缓存零模型/研究；首次本地化按原合同计量 |
| B12 | UI采用真实票后生成，另一入口详情/恢复/冷重启、中英操作 | 航班绑定与accepted持久恢复，缓存无重新规划 |

无票/网页不可读的真实结果保留，不能伪造或将API成功当交付。B03/04/12若真实外部能力无法满足，准确记录失败/硬阻塞，不换成 synthetic 通过。

## 探索：固定用户目标，分母4

E01 模糊但合理的“想找安静的文化城市”推荐与连续追问；E02 中途改变旅行主意和目的地；E03 陌生合理目的地塔林 2026-11-03 至 06 的四日需求；E04 推荐→只读解释→明确选择→规划的连续对话。开始前记录自然输入，探索与修复回归分开统计。要求没有未解决阻塞级问题，不能改测试提示词教 Agent 内部字段。

## C：判定、证据与平台

生成必须有实际可读、可恢复的 accepted 攻略，日期/航班/日程覆盖/预算/偏好/编辑范围符合要求；无错误日期、伪造来源、无依据价格或预算保证。全页面和详情人工评阅，保存截图/可见文字/network/console/只读DB/日志。API200、worker完成、delivery均不能单独判PASS。

最后冻结代码SHA、工作树及构建指纹、核心配置后完整B01–12；修改即新建最终批次完整重跑。保留累计失败、尝试与最终批次，严禁挑最佳12次。微信可用则真实正式构建验证发送/生成/编辑/双入口恢复/取消；H5、微信、真机分别判定，mock或构建不代表平台PASS。

2026-10-06 平台范围调整：用户明确“暂时不用验收微信小程序内的内容，先验证H5”。本轮真实交互验收只覆盖H5，不开启微信开发者工具CLI安全服务端口；保留weapp构建工程检查，但微信与真机均标记未验收。A族、H5的12固定+4探索分母、同版冻结及内容/持久化/费用标准保持不变。

## 批次及问题台账（追加）

当前基线 f2ec6c1；本轮已执行下述迭代测试，真实页面与最终冻结批次待运行。付费授权已明确：D6 DeepSeek API 金额不限，逐次计量；其他供应商不继承历史不限。无已完成PASS声明。

| 问题 | 复现/根因 | 预期修复/验证 | 状态 |
| --- | --- | --- | --- |
| D6-01 | withGoalIntent允许省略，commit schema/persona/说明却强制重复内部Goal字段 | 同步输入面与固定Goal测试 | 已实施，最终验收待运行 |
| D6-02 | 局部编辑要求模型传baseGuideId/hash；准备快照未集中冻结 | 服务端绑定初始base及Trip，冲突拒绝/CAS回归 | 已实施；PG发现的会话内部/公开ID映射已修复，完整真实PG51项通过；最终UI待验证 |
| D6-03 | 公开规则/修复提示禁预算目标金额 | 精确目标确认允许，预算保证继续拒绝 | 已实施，定向通过并继续检查边界 |
| D6-07 | `update_trip_context` 的空 patch 返回 `changed: false`，但仍重建同 scope 的 evidence store 并复位 source alias sequence；旧模型引用可能映射到后续不同证据 | 同 generation 在 setter 前后记录相同内容、不同 URL，要求 source alias 不重复，并断言 Trip version 与 accepted base 不变 | 修复及定向绿测通过；最终冻结验收待运行 |
| D6-10 | 准备阶段按当前语言选取任一旧 accepted guide，而发布 CAS 将同 conversation/version 最新任一语言 accepted guide 视为当前基底，可能错误允许回退到旧版或在提交时无故冲突 | 同作用域新英/旧中组合不得把旧中文 guide 当编辑基底；新guide补齐中文 accepted后必须绑定新guide | 准备规则已实施，定向7/7通过；最终冻结验收待运行 |
| D6-08 | 隔离运行守卫以独占新建模式打开固定审计路径，冷重启沿用同目录时会触发 EEXIST，无法恢复服务 | 同一文件追加带 guard-session UUID/PID 的审计；安装、关闭、再次安装保留原字节及各次计数 | 已修复，受控 probe 9 项通过（零网络/模型）；真实 B11/B12 仍待完整验收 |
| D6-09 | 同查询键并发返回不同 OSM city identities 时，后写缓存可能丢失仍有效的身份；空且 unverified 的有效旧缓存也会压过随后 verified 的身份，更新时间字段往返还可能损失 PostgreSQL 微秒精度 | 独立 PostgreSQL 覆盖同身份并发、异身份合并、旧身份/verification/TTL 保留、相同 OSM ID、过期替换、空未验证缓存被有效身份补齐，以及双连接单 HTTP/单 lease/缓存命中不新增 lease；有效行只更新 `result_json` 保留数据库 TTL 原值 | `postgres.integration.test.ts` 红测复现旧 verification 覆盖新结果；修复后专用 PG 5/5 通过。真实免费Provider smoke另见本报告本批证据，不替代冻结验收 |
| D6-13 | Nominatim jsonv2 可返回 `category` 而没有旧 `class` 字段；city parser 只读 `class`，将真实市级 administrative city 拒绝为空未验证 | `class` 存在时优先使用它，仅在缺失时回退到 `category`；category-only 行政城市可解析，冲突字段不得降级，已有名称/国家/类型与多身份歧义规则保持 | 离线红测复现，最小修复后 places+city-resolver 23/23、backend check/build通过。真实Kyoto再请求HTTP200解析为 `osm:relation:357794`、JP、35.0115754/135.7681441；PG缓存复查零HTTP/无新增lease。原安全摘要合并字段不能单独证明其因果字段，但后续诊断记录精确显示 category-only |

续作：完成隔离PG复验、全量冻结回归及真实基线/完整页面旅程；这些迭代结果不能提前宣称通过。

### 第一批实现与保留失败

2026-10-06 新的原 B01 真实 H5 迭代首轮没有 accepted 攻略，后续动作按前置失败阻塞，没有盲发解释/编辑。页面登录/规划可见，提交到受理87ms、终态56779ms；15模型/5搜索均结算，费用回执仍未知。六个安全正文fetch提供有效当前证据。保留会话工具记录确认首commit及后一次修复都把IC卡资料的网页URL写入 `supportingRefs`，同时已通过 `supportingCandidateKeys` 选择相应practical候选；服务端正确拒绝URL，但将 `DSH_CANDIDATE_REFERENCE_UNAVAILABLE` 归为system且反馈没有字段纠正，模型未修正该字段。问题 D6-12：收敛DSH引用schema、说明和安全有界反馈，保留拒绝规则、不删掉错误字段；先加离线失败回归再修复。本次报告 `backend/.demo/dsh-d6-runtime/d6-iteration-b01/evidence/B01-2026-10-06T05-17-53-059Z.json` 与旧失败都保留，不是最终批次。

D6-12 首轮离线回归取得2失败/13通过：schema允许URL、引用不可用被归system。修复仅在DSH紧凑schema限定返回的candidate locator，明确 sourceRefs/candidateKey/supportingCandidateKeys 的关系，并由service提供受控字段路径；不可用引用按prerequisite计数，反馈说明正确字段和首次/已接受Goal区别，不转发URL或原始异常。不自动删除字段、不升级scope、不减弱任何原领域校验。现有官方fixture worker/no-op alias集成用例增加“URL误填→具体字段反馈→保留同份资料正确重提→只一份Goal/accepted攻略”验证，后续定向结果追加。

原始会话进一步确认7项new candidates的 `sourceRefs` 也全是URL，而不是已返回的UUID或 `s1.*` receipt；第二组离线红测2失败/15通过后，DSH source schema排除URL，仍保留既有短receipt和UUID兼容，领域证据层继续核验完整作用域、内容及状态。Zod字段反馈增加受控纠正提示，要求复用当前有效receipt、不重复研究；不猜测URL所对应的事实、不自动挑来源。第一组绿测曾因旧纯schema fixture使用非法 `gc1.example` 失败2/22；将fixture改成合法locator形状后，4文件/23项通过（含官方worker同材料纠正和Goal唯一性）。后续完整定向结果追加。

D6-12 追加完整定向5文件/28项通过（`output/d6/source-reference-green.log`），覆盖引用反馈、紧凑提交、官方worker服务、空patch alias和受控setter。真实B01复跑及最终冻结全批仍未通过。当前iteration服务已停止；该非TTY进程被终端Ctrl-C直接终止，实测原PID64332不存在且两端口关闭，但未执行finally、原锁文件和审计没有closing事件，原件保留。本次不作冷重启通过证据；最终同run重启需使用可验证的正常停止路径并核对身份/账本/guard追加。

2026-10-06 r7 工程回归：引用字段反馈与JSONv2修复后的后端全量133文件/1211项通过（185.28秒，`output/d6/backend-unit-r7.log`），真实专用PostgreSQL 11文件/51项通过（52.70秒，`output/d6/postgres-r7.log`），官方runtime14/14通过（9.42秒，`output/d6/runtime-r7.log`）。均为工程验证，不能替代最终H5批次。B01 r7报告 `backend/.demo/dsh-d6-runtime/d6-iteration-b01-r7/evidence/B01-2026-10-06T05-49-13-863Z.json` 在登录后进入规划页时输入框隐藏，全部旅程动作阻塞，model/search/fare零调用；单次零turn复现可正常进入，间歇导航问题仍在定位，不宣称根因或修复完成。原工作区仅保留用户两份配置修改，历史账本SHA256仍为 `3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`。

已实现准备快照、模型单项文字输入、绑定base/hash、同轮Goal省略、scoped C/source引用、单一已选城市补齐，以及发布短事务的基底条件。实际状态由本轮测试决定；协议见 [ADR0029](../../adr/0029-dsh-prepared-submission.md)。

service 级回归 `backend/src/agent/dsh/d6-controlled-update.test.ts` 使用官方 fixture worker，在同一用户请求中先以真实 `trip_context_update` intent 更新全程预算并得到 `satisfied`，再用真实 `travel_guide` intent 提交 compact 攻略。初始故障是在首个攻略提交的 alias/evidence 检查之前返回 `GOAL_INTENT_CONFLICT`：Trip update adapter 更新快照与 evidence scope 后仍保留已满足的 Goal binding。修复后，已确认 setter 保存其 delivery 并结束活动绑定，再按同一可信 scope/generation 和已确认准备版本派生独立尝试身份；后续攻略仍须提供真实 intent。回归 3/3 通过：独立 Goal/request identity 与 context version、旧 source alias 拒绝而新 alias 接受、缺 intent 拒绝、pending setter 不推进、日期冲突导致的失败 setter 不推进均有断言；不重贴 base id/hash/slot-edit字段，不调用付费 Provider。验证命令 `backend npm test -- src/agent/dsh/d6-controlled-update.test.ts`。

| 检查/尝试 | 实际结果 | 处理 |
| --- | --- | --- |
| 首次 Vitest | esbuild spawn EPERM，未执行案例 | 允许已授权本地测试子进程后重跑，未降低测试 |
| 第一领域批57 | 54通过/3失败：旧description断言强制EVERY提交 | 更新协议断言，Goal修复本身已通过 |
| 第二批90 | 81通过/9失败：runtime依赖缺失4、准备测试fixture3、错误分类2 | D6目录按原lockfile离线安装runtime；修fixture及分类；保留原失败 |
| 第三批57 | 55通过/2失败：准备fixture缺checkedAt、旧service anyOf断言 | 补合法fixture；验证新schema无需内部base/hash/goalRef |
| TypeScript初批 | 可选字段exactOptionalPropertyTypes错误 | 修可选条件赋值/预算null；继续复验 |

上述为迭代检查，不是冻结最终全量。初始页面基线尚不可运行：已有独立PG端口58789不监听；Docker只读查询无返回；正在准备隔离替代数据库，不以普通环境问题停工。旧账本984条、1 pending保持不变；新D6授权账本独立并记录历史指纹，不清空/沿用旧权限。

### 隔离数据库与第二批全量迭代

使用官方 PostgreSQL 16.4 Windows binaries，在忽略目录 `backend/.demo/d6-postgres/data` 初始化全新数据库，只监听 `127.0.0.1:58896`，库名 `flightor_d6_validation`。没有创建系统服务、修改旧58789数据或重启Docker。

| 检查 | 实际结果 | 后续 |
| --- | --- | --- |
| backend check/build/test | check/build通过；130文件、1179测试全部通过，190.65秒 | 后续修改使其成为迭代证据，最终完整重跑 |
| DSH runtime | 14/14通过 | 最终版本再核对 |
| 前端session/artifacts | 20项、25项及8项本地化断言通过 | 同最终版本复验 |
| 前端production-presentation | 第9项失败：生产分支缺重新规划按钮 | 补生产按钮，并模拟父组件真实同步busy状态后复验 |
| public error helper | 34项通过 | 已接入conversation-progress |
| test:db第一轮 | 8/10文件、44/46测试通过 | D6 fixture误传Trip record而非context、重复关闭pool；旧DSH局改真实拒绝，继续修复 |
| D5第一轮 | 30/30案例成功，codeUnchanged=false，整批退出1 | 新脚本/测试并行改动使指纹失效；保留 [首轮报告](evidence/d5-2026-10-06T03-19-41-594Z.json)，稳定后全30重跑 |
| 固定材料回放 | baseline/D6各10/10接受；零新增模型/外部请求；trips.get 20→18；组装total P50 11.855→12.027ms | 内存回放基本持平，不宣称真实用户提速；完整样本见证据/地点行为文档 |

真实PG发现 D6-04：`saveFinalVariant` 的事务内原始 Artifact 行保留内部 conversation_id，而基底查询返回公开 conversationId，作用域比较错误拒绝合法局改。修复在既有 Trip 锁查询中同时取得 owner-scoped conversation public ID，不增加数据库往返、不放宽CAS；原真实DSH多轮PG回归负责验证。发布竞争、Trip/flight冲突仍需全套真实PG通过。

修复身份映射后的原DSH PG第二轮，局部编辑已成功，随后暴露历史测试断言仍要求预算更新后只有两份攻略。现有预算限定派生合同本来会保留两份旧稿并新增一份当前版本攻略；改为严格断言3份、当前1200全程预算、所有活动内容与时段继承（只允许source Artifact映射）、accepted英文，以及两份旧稿原样保留。不修改预算派生实现或放宽跨版本来源规则，继续复验余下恢复断言。

原DSH PG第三轮1/1通过（9.64秒），完整发布→只读解释→局改→预算派生→冷会话恢复→旧版本隔离通过。前端第二轮session/artifacts/production-presentation/types通过，conversation-progress在取消失败显示断言失败：组件改用 `PlannerReply` 渲染安全错误，而离线stub只读children，漏掉content属性。补stub的公开文本投影后继续跑完整复合命令，原“未确认停止仍busy、不能显示已停止”断言保留。

conversation-progress第三轮通过取消及发布检查后，在聊天错误文本检查遇到相同stub投影缺口；`nodes` 已执行函数子组件，`text` 却未执行。补齐文本遍历以观察实际stub子组件输出，保留错误可读、历史顺序、停止和新旅行原断言，不放宽产品检查。

新增 D6-05 已有官方 fixture worker 离线红绿证据：显式 Trip setter 带语义 intent 且持久 `satisfied` 后，独立 `travel_guide` Goal 会推进；只清绑定会撞同 generation 请求幂等键，因此实现绑定可信 scope/generation 与已确认准备版本。费用、会话与原 Goal 保留，旧 evidence、候选 alias 和 base 继续失效；失败/pending setter 不推进。`d6-controlled-update.test.ts` 3/3、`service.test.ts` 6/6、`public-errors.test.ts` 14/14 通过，`backend npm run check` 通过；浏览器/真实 Provider 与更广真实 PostgreSQL 发布竞争复验仍未由这些定向检查证明。前端 `node scripts/test-public-planner-errors.cjs` 的 40 项检查通过。首次沙箱运行 Vitest 遇 esbuild `spawn EPERM` 未启动；获准本地测试子进程后测试原样重跑通过。

2026-10-06 D6-06：冻结适配协议后发现 `safeCommitFeedback` 仍要求缺意图与参数纠正重复“同一accepted intent”，首次并未存在accepted Goal。红测1失败/5通过确认这一说明冲突；修复只收敛DSH反馈，首次要求真实新intent，已有Goal的修复省略重复字段且保持不可变约束。schema、persona、snapshot同时说明已满足且推进版本的显式setter边界，legacy合同不变。

D6-06定向修复后，commit反馈与受控setter批次2文件/9项通过（`output/d6/controlled-update-green.log`），包括旧alias拒绝、新Goal身份、新版本资料提交，以及pending/failed setter不推进。完整真实隔离PostgreSQL第二轮10文件/46项通过（harness记录），仍是迭代证据；未知城市实现及后续冻结变更需要最终完整重跑。

2026-10-06 D6-07 离线红绿测 `backend/src/agent/dsh/d6-noop-alias.test.ts` 使用官方 fixture worker：同一 generation 先搜索来源A，再执行空 patch setter（`changed: false`, `completion: pending`），随后搜索同文本的来源B。红测确认两个 source alias 均为 `s1.eae144b183.1e8e6fab48.1`，尽管 URL 分别为 `https://example.test/source-a` 与 `https://example.test/source-b`，因此空 patch 重置 alias sequence 会让旧引用静默指向另一证据。修复后仅在 Trip context version 前进时刷新准备快照、引用和 evidence store；空 patch 保持当前 generation 的引用映射。回归断言 alias 不重复、`changed: false`、pending delivery、Trip version 不变和既有攻略/研究Artifact仍可读取。合并运行 `d6-noop-alias.test.ts`、`d6-controlled-update.test.ts`、`service.test.ts` 共3文件/10项通过。未调用付费 Provider。首次沙箱运行受 esbuild `spawn EPERM` 阻止；获准启动测试子进程后先取得红测、再以相同命令取得绿测。冻结完整回归仍待运行。

2026-10-06 D6-10 只读审查发现准备与写入CAS对“当前accepted攻略”的定义不一致：准备挑选当前locale accepted攻略，CAS则要求它仍是任意locale accepted攻略中最新者。源码构造的复现为同Trip/conversation/version/flight scope下旧攻略仅中文accepted、新攻略仅英文accepted：旧准备会回退绑定旧中文攻略，而CAS最终以更新英文攻略为最新基底并拒绝提交。为防止旧中文攻略覆盖更新的英文accepted基底，准备先锁定同scope最新的任一locale accepted攻略；若它缺少请求locale，不回退到更旧攻略，应阻止slot edit并要求当前版本先获得该locale。`preparation.test.ts` 定向7/7通过，覆盖倒序记录、不回退、较新攻略补齐中文后绑定它，以及生成期间新英文accepted攻略出现时CAS仍拒绝旧中文基底。该测试在准备逻辑修改同步到工作树后才执行，未取得修改前红测结果；问题依据源码路径复现记录。未执行真实发布或PostgreSQL写入，冻结完整回归待运行。

### r6 收敛后的工程回归与当前页面问题

2026-10-06 12:52 Asia/Shanghai 开始的后端全量回归：133文件/1206项全部通过，188.11秒（`output/d6/backend-unit-r6.log`）；完整真实隔离PostgreSQL：11文件/51项全部通过，49.92秒（`output/d6/postgres-r6.log`）。backend check/build均通过，独立官方DSH runtime 14/14通过（`runtime-r6.log`）；正式weapp构建通过（`weapp-build-r5.log`），不代表微信平台验收。此前完整PG49/50的TTL微秒丢失失败保留在私有harness日志，精确TTL断言没有放宽，已由D6-09只更新结果列修复。

当前D6真实页面迭代 `backend/.demo/dsh-d6-runtime/d6-iteration-b01` 已完成可见本地登录，但点击规划后页面只有tab bar，composer仍隐藏30秒；首次自然消息尚未发送，账本0条，没有accepted成果。失败JSON及截图保留为 `B01-2026-10-06T04-56-37-537Z`。正在定位正常导航/恢复问题，不能把它当作供应商失败或PASS。私有B01动作副本只增加可见成果前置断言，原自然输入及动作顺序未改；无攻略时后续解释/局改被标记依赖阻塞，而非继续盲发模型请求。

上述结果是当前工程里程碑，不是最终冻结验收；最终12固定+4探索仍全部待完成。后续产品修改应按影响验证，并使最终批次完整重跑。

2026-10-06 D6-11 发现缺少当前locale accepted基底时会返回 `DSH_GUIDE_BASE_UNAVAILABLE`，此前按 `context_conflict` 文案告知用户“行程或航班处理期间变化”。后端保留既有8类分类，通过可选白名单 cause code 将该情况改为准确的双语局部修改提示；服务层仅保存受控分类输入，Provider终态仍优先。`public-errors.test.ts`、`service.test.ts`、`preparation.test.ts` 合计3文件/29项通过，service离线回归确认最新无当前locale基底时显示指定提示且不含内部码/异常细节。整个D6冻结回归仍待运行。

### 微信平台准备实测（不阻止其余工作）

2026-10-06 r6 完整 D5 回归已结束：30/30，`codeUnchanged: true`，21个规划场景首次完成率9/21、自动恢复后21/21；Provider retry 6、schema repair 3、semantic repair 6。P50终态1503ms、P95 2546ms仅描述本地HTTP/持久票价fixture批次，不是用户页面或真实Provider性能。完整脱敏报告见 [r6 D5](evidence/d5-2026-10-06T05-03-34-922Z.json)。此前源码变化导致无效的首批报告继续保留；后续产品变更需要最终版本完整回归。

同次固定材料回放再次获得baseline/D6各10/10 accepted及逐样本语义一致，零模型/外部调用；baseline total P50 10.395ms，D6 adapter P50 0.394ms、total P50 9.933ms。全部逐样本及指纹保留于忽略目录 `backend/.demo/d6-fixed-replay/fixed-replay-2026-10-06T05-10-41.010Z.json`。仅验证适配/domain内存开销未见明显退化，不作为真实页面提速结论，最终源码/构建冻结后复测。

2026-10-06 继续审查的 r5 迭代：backend check/build 均通过（`output/d6/backend-check-r5.log`、`backend-build-r5.log`）；前端 session-recovery、artifacts、production-presentation、conversation-progress 全部 exit 0（同目录 `session-r5.log`、`artifacts-r5.log`、`presentation-r5.log`、`conversation-r5.log`）。来源空 patch 回归、受控 setter 与 service 共 3 文件/10 项通过。D6-08 guard probe 9 项通过，原审计前缀保留、两次安装分配不同 session UUID，关闭计数为受控负面 probe 的 4 与第二次 0；不计入真实批次零违规证据。上述仍为迭代证据，城市缓存修复和完整页面批次待完成。

2026-10-06 已发现 `C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat`。官方CLI `--help` 可运行；`islogin` 首次沙箱不能写IDE自己的连接文件，允许本地CLI后复验明确返回“IDE service port disabled / 工具的服务端口已关闭”，未取得登录状态或9432自动化连接。开启属于IDE安全设置变更，已向用户单独请求本轮许可；许可未到不执行开启。H5、代码与数据库测试继续，不能以weapp构建或mock代替实际平台运行。

2026-10-06 用户明确回复“暂时不用验收微信小程序内的内容，先验证H5”。本轮平台验收范围调整为H5；原v1微信条件和CLI关闭实测保留，微信页面不执行、不宣布PASS，也不开服务端口。A八类、PG、D5分母30、H5固定12+探索4与内容/恢复标准不变，weapp构建只列工程验证。此为用户范围指令，不是因测试失败降低H5标准。

2026-10-06 B01 官方 web_search evidence 合同只读核查：5次搜索均成功，但5个 `__record_web` 回执均为空。私有 evidence 目录36行中，30条搜索来源为29 `no_body`（安全 URL、无 snippet）和1 `invalid_url`（非 HTTP(S) 地址）；其余6条来自web_fetch，均为 `available/fetched_body` 并返回 refs。锁定 DSH 工具将官方结构化 sources 保留在 canonical `value.sources`，运行时已将该值传给记录器；DeepSeek 官方 provider 可在缺少 text citation 时返回 URL/title 而没有 snippet。零搜索 refs 符合“无可引用正文不成为证据”的合同，不是当前B01未接纳的根因修复或验收通过；需按证据/地点文档所述尽早fetch正文、被阻则换来源。运行材料仍只保留在私有 `backend/.demo/dsh-d6-runtime/d6-iteration-b01`，未复制或提交原始记录。
