# D5 — Reliable Planning & Budget Flight Routing

状态：实施中，未验收。工作分支 `codex/dsh-backend`；2026-09-27 fetch 后本地与远端基线均为 `a01d6e4cbc520aa181aadc4417ee03921f49765c`。保留既存未提交D4诊断与其他worktree，不修改main。D4限定A/B通过不等于一般规划可靠性通过；既有失败见[D4报告](DSH_LIVE_2026-09-24.md)。

## D5-A 根因与修改边界

当前已确认：Provider内建重试关闭；commit在schema校验前累加尝试；旧turn的原始来源引用与新turn作用域不兼容；长session重复累积领域快照、公开历史及完整工具正文；公开失败笼统归为model_failure。

用户本轮追加明确取消固定12次模型调用限制，要求逐次统计、以后自行决定总次数上限。不是把12改成更大的隐藏常数；仍保留整轮超时、AbortSignal、现有预算账本准入及各类有界恢复。Provider retry、参数纠正、内容修订分别计数，不能混用，也不能暗中绕过费用计量。

模型工作上下文使用官方Session的surface replacement公开能力：仅在新turn且Agent idle时，用父进程的当前Trip/flight/guide/Goal/有效候选快照替换旧模型可见消息；旧事件在append-only审计中完整保留。当前turn工具调用、证据和修复反馈不做中途裁剪。公开历史保留最近12条完整消息、最多12000字符；旧原始tool/evidenceRef不再因warm/cold恢复自动进入下一轮。没有另建Memory或重写AgentLoop。

## 验证记录

- 官方DSH runtime的working-context定向测试1/1通过：旧工具证据从下一轮模型输入移除、当前轮工具结果保留、审计前缀不变、冷resume后无旧副作用重放。直接执行 `node test/working-context.test.mjs`；0.225秒。首次 `node --test` 被沙箱spawn EPERM阻断，未执行用例，不算功能失败或通过。
- 其他D5-A定向、D5-B与代码冻结后的D5-C 10类×3次结果待实施后填写；不引用D4旧测试数充当本轮通过。

## D5-B 已核实的问题（待实施）

`route-generation/composition.ts`向LiveFareConnectionSearch传入不带fare service的拓扑服务；LiveFareConnectionSearch当前只为查询OD的整程报价保存immutable FlightSearchArtifact，附加拓扑边本身不会自动获得真实分段绑定。给拓扑服务简单传fare service也不够：它的报价富化不持久化Artifact，不能据此计算可验证总价。D5将复用持久fare搜索及既有planner/optimizer做有界baseline与单hub比较，保留每票段artifact/offer绑定。

optimizer当前在全部totalFare缺失时仍可能选出cheapest，须排除不可比较价格。搜索与采用继续分离；不自动更改selected flight。单程/单origin/destination、最多一个主动hub及两张票为本轮范围，往返及任意多城不包含。

## 验收、费用与回滚

尚无D5冻结batch成功率或真实Provider成功声明。将分列离线fixture、本地HTTP模拟、生产式持久测试与真实Provider，失败保留且代码变更后新建batch，不能混算。

D5回滚应逐项revert本轮提交并保留现有DSH引擎、预算、会话、数据和所有失败记录；本轮不通过切legacy回避问题。当前未提交实现不得以reset/clean覆盖用户内容。已知限制及下一阶段以最终验证更新，本页当前不构成验收放行。


## D5-A 当前实现与分层恢复

Provider 内建 retry 仍为 0，FlightOR 在公开 llm/stream 边界逐次准入和结算，最多两次额外重试，退避 250/750ms。仅对尚未输出内容的 TRANSPORT/TIMEOUT/RATE_LIMIT/SERVER 重试；auth、invalid、budget、cancel 等不重试。取消时已准入请求允许结算，但不允许新调用或领域写入。无固定总模型次数上限；次数记录在消息 metadata 和原账本中。详细本地 HTTP 证据见 [Provider 恢复测试](DSH_PROVIDER_RECOVERY_2026-09-27.md)。

commit 单轮总提交上限 6；参数纠正上限 3；可评估内容最多两次（一次修订）。缺字段/前置来源或地点问题不预占内容修订额度；仍不允许无限纠错。结构化反馈仅拣选服务端允许字段，并提供固定修复提示，不传 Provider body、异常原文或栈。当前轮有效候选与证据保留，跨 Trip version 拒绝复用。

D5-B 接线复用现有 route-generation Goal/Run、artifact、planner 和 optimizer。新增服务器内部 inline dispatch（不另排后台 job），使 budget search 与当前 Agent turn 共用取消信号；原 queued 入口保持。搜索不产生 selected flight。inline 模式的进程中断不自动启动后台写入；已 running 的失联执行报告冲突，不并行重放。

D5-A 定向集成已完成 10 文件 129 项（36.49 秒），含实际 worker、metering、取消、多轮、commit、Goal/API polling；不是线上成功率。Provider 账本拒绝归类 BUDGET，不再与模型输出失败混淆。


## D5-B 当前合同

`BoundedBudgetConnectionSearch` 先搜索整程 baseline，再在用户允许独立票自转机时查询至多 3 个中转机场、2 个出发日期样本、14 次 fare lookup、100 条候选边。偏好城市优先通过航空解析器获得机场；拓扑不足时依次尝试配置的 ICN/HKG/SIN，并通过 getAirport 确認；航空查找最多 3 次。该有限覆盖不宣称全网最低。每个 OD/date 仅查询一次，第二段使用第一段实际抵达日期，允许长中转时可采样次日，后续 planner 继续校验时间/机场/自转机安全余量。

叶搜索统一使用 LiveFareConnectionSearch → executeFlightSearch，先存不可变 FlightSearchArtifact 再创建商业报价边。不能把一个整程报价拆分价格贴到物理航段。只纳入 OD/date 匹配且不含 excluded 地点、具备 fareArtifactId/fareOfferId 的报价；缺报价绑定可以保留审计，不能计算可比较价格。optimizer 的 cheapest 要求每段具备绑定、币种一致、总和匹配；全无价或多币种不可比较时没有 cheapest。most_fun 只在存在已知 10–24 小时中转时考虑，同一路线用多badge而不复制卡片；出境/签证/行李信息未知仍须确认，badge不等于准许进城。

D5-C runner `backend/scripts/d5-acceptance.mjs` 运行 10 类×3 独立实例，冻结源码及dist/runtime/scripts指纹，边运行边保存独立JSON批次。case1–6/10通过本地HTTP协议模拟+真正官方worker和真实领域校验；case7–9走真实持久化fare service与fixture票价。没有外部Provider调用，不可解释为真实模型成功率。任何改代码均需新batch，旧失败保留。


## 本轮调试与数据库记录

D5-B 接线编辑中间态曾出现 6 个 tool 测试失败（缺失测试 import/未完成注册），完成接线后 3 文件 17 项通过（5.24秒）；未将中间态当冻结batch。数据库首次因原本地实例已停止而 ECONNREFUSED，未执行7个case；启动原数据目录后隔离schema的7项全部通过（3.28秒），含inline无后台job、并发claim/取消/版本一致性。

受控 budget route 公开说明直接读取持久化optimized route artifact，检查cheapest及逐段绑定和币种总和，价格不会作为无来源自由文字通过。明确分别出票、自转机、保障/行李未知以及需显式采用，不替换guide publication的accepted回复。无前端代码改动。

真实调用前dry-run核对原账本：batch d1a2aef6-d04d-4c44-9d22-6b1892226f95，354模型准入（含官方搜索计量）、92搜索，unknown/reserved US$21.52，pending0，unlimited授权延续用户本会话明确指示。保留原失败、未新建或清空真实账本；不是实付金额。D5 local simulation另外隔离账本不与真实费用混算。

D5-C 场景实现已完成并进入冻结验证：1普通发布、2首次503、3schema错误、4重复候选内容修订、5 503+内容修订、6cold resume、7 1500对900独立票、8禁止self-transfer、9缺不可变绑定、10查票/显式校验采用/攻略/单slot修改/只读恢复。case10保留非目标slot，刷新比较账本和Artifact计数不变。所有模型协议测试使用本地HTTP；synthetic token量是协议fixture估算，不是官方计费。

全量离线第一轮 126 文件1132项中1131通过、1失败：旧Core vocabulary断言尚未包含新增search_budget_routes。已补齐预期名单，未删测试/降validator；该修订后新建冻结batch，不混用原30次结果。
