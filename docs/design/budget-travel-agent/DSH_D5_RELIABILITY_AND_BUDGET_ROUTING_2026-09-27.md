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
