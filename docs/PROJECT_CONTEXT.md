# FlightOR 当前项目上下文

2026-09-26 18:04最终功能验收：**DSH正式H5 E2E PASS（限定本次后端替换，G1仍未放行）**。A自备机票的解释/局部修改/全程1200预算/刷新/显式官方英文与恢复已验；B先通过正式API采用synthetic fixture航班，再真实H5规划、解释、slot修改和刷新通过。B最新修改5主模型/1官方搜索/2fetch/2commit，一次修复后accepted+satisfied并可读，点击→UI26.115s，第一天/其他slot/航班revision不变；刷新零调用。B初版预算保证错误与全部失败不追认，最新公开文字无该保证；人流推论/事实时效仍有内容质量限制。实际官方DeepSeek模型及搜索，不是mock攻略；原账本258模型准入/68搜索、US$15.76未知预留、pending0/unlimited，不是实际支出。27份运行日志违规旧Planner/Runtime/Research/非本地化Finalizer调用0（23份有guard，其余无HTTP）。后端代码commit bf42bf80283ba39f062c37db79d9d0a92bd20f32；前端授权最小修复8233a84/8626876；runner/harness代码commit be8b8937a1e787ca79012bf8c92495f5ac3f4d6b；报告与证据由包含本记录的后续docs提交交付，最终交付SHA见任务最终回复/远端分支HEAD。原工作区main=8a83b03及未提交内容保留。证据见[现有D4报告](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。以下带日期段落保留为历史快照。

2026-09-26 17:51 DSH验收快照：A自备机票完整能力经真实失败/修复/恢复已验收。B先正式采用synthetic fixture机票，再真实H5官方链路，第七次发送首次accepted/satisfied并显示两天5项活动，点击→可读27.713s；4主模型0搜索0fetch，复用09:31同B会话真实官方搜索/正文研究，不冒称成功轮新搜索。当前accepted reply仍有“整体预算仍在既定总额内”的无依据预算保证（budgetAssessment undetermined），已发现并继续修复；B后续解释/slot修改/恢复尚待完成，因此整体E2E仍FAIL。Artifact/source/evidence谱系与前六次失败保留。独立codex/dsh-backend、前端最小扩展commit8626876，其余后端修复未提交；main/用户原工作区保留。原账本251模型准入/67搜索、US$15.40未知预留、pending0/unlimited，不是实付账单。地图不阻塞、G1未放行。证据见[现有D4报告](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。

2026-09-24 当前后端任务：按[DSH 实施方案](design/budget-travel-agent/DSH_IMPLEMENTATION_PLAN_2026-09-24.md)推进，旧 R/U 与条件 C1 是历史规划/证据，不是本次前置。DSH 已有 opt-in 后端路径，默认 `FLIGHTOR_AGENT_ENGINE=legacy`；在隔离分支实现受控 DSH worker、领域工具、combined guide commit、可选 web adapters 和持久预算。当前 DSH 阶段及离线、数据库、HTTP mock 与后续 live 验证边界见[实施报告](design/budget-travel-agent/DSH_IMPLEMENTATION_REPORT_2026-09-24.md)。这不代表已部署或真实 Provider 已验收。当前 G1 仍未通过，地图排查暂停。

2026-09-22第四阶段：[真实景点图片](design/budget-travel-agent/PLACE_MEDIA_2026-09-22.md)已接独立Wikimedia媒体API、迁移014、版本绑定缓存和正式封面/缩略图/详情；两景点H5真实照片闭环，微信页面/真机及正式public库未验收。显式补图，不改Planner/研究/终稿、不调用Nominatim。地图底图暂停排查、仍未解决。下文各阶段“图片未接”保留历史时点，当前合同以[ADR0027](adr/0027-place-media.md)为准。

2026-09-22终稿增量：主 Planner 发布末端复用实际模型/client，直接一次结构化编辑调用（最多一次格式/语言修复），不启动新Agent。新攻略草稿隐藏自由文本，publication按zh/en持久保存接纳文本/问题/调用观测，语言切换不改Trip版本；GET只读，首次另一语言通过显式本地化POST使用接纳终稿。详见[ADR 0025](adr/0025-bounded-guide-finalization.md)及[验证/费用](design/budget-travel-agent/FINALIZATION_2026-09-22.md)。下文旧publication来源摘录规则仅适用于旧记录，当前领域satisfied与内容accepted分离。

2026-09-21 验收收尾：[报告](design/budget-travel-agent/G1_PUBLICATION_ACCEPTANCE_2026-09-21.md) 记录当前源码的双样本独立 PostgreSQL、P1–P6 与实际 H5 详情/刷新。仅增加来源绑定名称/实用引文的最小表达修正；旧原记录 P5 仍失败，当前写入副本通过最低参考范围。微信开发者工具已补测固定结果的页面显示及 reLaunch 恢复（合成登录/只读请求拦截）；新 Provider、冷启动和真机未测，G1 总门不关闭、M1 未开始。环境状态见 [H5/微信报告](design/budget-travel-agent/G1_PUBLICATION_H5_2026-09-21.md)。下文同日“最新修正”的离线边界为本次验收之前的实施记录。

2026-09-21 最新修正：[ADR 0024](adr/0024-guide-publication-contract.md) 将攻略公开投影、预算未知判断、成功确认和历史恢复统一到服务端 publication v1。原始摘要/规划备注不再直接作为公开攻略文字；有界来源摘录不冒充独立核实。G1 按 [冻结合同 v1](design/budget-travel-agent/G1_PUBLICATION_RUBRIC_V1.md) 区分持久、不可变约束、发布及最低有用性。此次离线验证不构成新 live 或平台通过；搜索额度仍24/24用满。

更新：2026-09-20。B0/B1 已提交 `cabbf51`，B2 已提交 `d895d0e`、仍默认关闭，B3 已提交 `6649644`，B4 已提交 `1ce177b`；B5 和 G1 数据库验证已提交。G1 修复后两条真实 Provider 保存/恢复契约通过，但内容价格时效问题阻止放行；逐阶段耗时与费用见 [9 月 20 日报告](design/budget-travel-agent/G1_LIVE_2026-09-20.md)。平台与正式 A/B 批次仍未验证。 后续日期证据门槛与地点复用已实现，旧错误攻略在零付费快照复验中被拦截，正常航班攻略仍通过；已完成修复后 live 追加复验，最新结论见当前进度，见 [修复复验](design/budget-travel-agent/G1_REPAIR_2026-09-20.md)。

G1 后续合同修复已增加可选 `requiredEvidenceTypes`，显式区分探索范围与必需覆盖；省略字段仍沿用旧严格语义。保存、完成与反馈共享解释函数，已接受参数不可降低；见 [ADR 0021](adr/0021-guide-required-evidence.md) 及 [当前验证](design/budget-travel-agent/progress.md)。修复后 live 已完成，内容时效门槛与平台验收仍未通过。

## 当前主链

`src/pages/plan/index.tsx` → `src/services/conversationService.ts` → 认证 `POST /v1/agent/turns` + GET 短轮询 → `backend/src/routes/agent-cloud.ts` → `PlannerServicePort`。默认 legacy 路径为 `CloudPlannerService` → `AgentRuntime`；显式配置 `FLIGHTOR_AGENT_ENGINE=dsh` 时选用官方 DSH worker。同步 `POST /v1/agent/converse` 使用相同服务选择；客户端不能选择引擎。旧 conversation-agent/cloud 代码不代表第二个当前主 Agent。

前端 Taro + React + MobX；后端 Fastify + TypeScript，PostgreSQL/Kysely、Redis 和 Worker。AeroDataBox 为航空主能力，SerpApi 提供票价；Research 按明确配置选择既有搜索综合或原生联网适配器。OAG 可选。中国 LLM 约束继续有效，实际模型/路由以脱敏运行配置为准，不能仅据默认值声称正在使用某模型。

## 已有能力与限制

| 范围 | 当前实现 |
| --- | --- |
| 状态 | Memory、Conversation、Trip Context、Artifacts 分离；Goal/Run 持久记录交付；服务端 owner/version 校验 |
| 航班选择 | Workspace selectedFlight 支持报价/路线与 revision；查看不等于采用，采用不等于锁价/购票 |
| 来源兼容 | 默认同 owner/Trip/version；已采用 offer 有受限跨偏好版本复用例外，见 `workspaces/flight-selection.ts`；不是任意跨版本通行 |
| 攻略 | Planner 用 candidateRef 编写每日内容，兼容 researchIndex/findingId；supportingRefs 独立保存实用资料；save_travel_guide 返回分类反馈和同轮 draft 修订引用。预算原样来自 Trip，v1 可选扩展字段及正式 UI 展示已实现 |
| 研究 | 配置为原生联网时走 NativeResearchAgent，否则按配置用 SerpApi + synthesis；缺少配置显式不可用，不伪造结果 |
| 航线引擎 | 当前最终生成只支持单出发机场、单最终目的地、单程、有界出发日期；不支持完整往返、多目的地或必需地面段组合 |
| 进度 | 临时内存 turn，300 秒整轮/315 秒外层、前端 330 秒等待；短轮询阶段反馈与提交后航班/攻略引用，owner-scoped 取消确认；未实现通用持久 Planner 续跑 |
| UI | 蓝色正式页面已有部分真实接入；航班采用恢复已具历史证据；活动展示转换仍缺景点坐标与素材 |
| 测试 | 默认离线与 PostgreSQL suites 分离；`test:db` 缺少 TEST_DATABASE_URL 明确失败；build 不等于真机验收 |

当前输出 delivery 由 completion/verifier 决定，工具正常返回或模型说完成不能代替 `satisfied`，而 `satisfied` 也不保证散文事实和活动日期正确。用户明确要求才生成最终航线，内层路径搜索/优化工具不开放给会话 Planner 随意执行。默认旧模式仍公开 Goal 控制工具；`PLANNER_LEAN_GOALS_ENABLED=true` 启用 B2：业务工具携带 intent/goalRef，服务端原子接受 Goal/Run，固定本轮约束并自动验收，隐藏 declare/resume/finish。单一 completion 权威保持不变；详细公开面见 TOOLS。当前仅在 G1 独立测试进程启用该开关，未改 `.env` 或业务服务。临时 PostgreSQL 事务与真实 Provider 持久闭环已验证，内容质量和平台门槛仍未通过。

首次模型调用前已增加 `planning-context.ts`：预装当前兼容研究 finding、未完成目标参数和已保存攻略摘要，显式给出日期/城市/类别覆盖与省略项，不自动接受旧目标。新增上下文最多 24,000 字符，Memory 禁用不注入；原 Trip、航班选择和历史消息仍按既有方式提供。详细限额与历史日期修复策略见 [RUNTIME_PLAN §2.1](design/budget-travel-agent/RUNTIME_PLAN.md)。局部准备耗时已写入对话元数据，尚未形成真实性能/费用评估。

## 目录

- `src/pages`、`src/features/ui-experience`：正式交互与视觉；`src/services`、`src/stores`：认证、数据适配和状态。
- `backend/src/agent`：Planner、runtime、tools、goals；`fares`、`flight-routing`、`route-generation`：航空报价与显式后台生成。
- `backend/src/research-agent`、`travel-guides`：证据与攻略；`workspaces`、`artifacts`、`trips`：选择、版本与持久化。
- `apps/admin`：内容管理；`cloud`：历史兼容/算法资产，不是新业务默认入口。
- `experiments`：实验脚本与资料；`docs/experiments`：有日期的实验设计和结果，不能替代完整 Planner 评测。
- `docs`：规范、当前计划、验收与已标注历史；`backend/.demo`、`output`：本地证据，不保证在其他机器存在。

## 最近证据与当前任务

[9 月 14 日航班优先验收](FLIGHT_FIRST_ACCEPTANCE.md) 完成真实查询/比较/采用/恢复，但未生成攻略；[东京历史调用分析](CALL_ANALYSIS_2026-09-13_TOKYO.md) 是另一条自备机票攻略样本，129.758 秒且有预算偏差。不得合并为完整产品已成功。

[9 月 20 日 G1](design/budget-travel-agent/G1_LIVE_2026-09-20.md) 是本轮新实测：自备机票与已采用航班攻略均持久保存并新请求恢复，首次 satisfied 234.881 / 184.234 秒，最终 API 253.694 / 213.958 秒。第一例安排了不在旅行日期内的电影节，故 G1 不放行。模型共 20 次、SerpApi 10 次，总账本占用 US$0.517287，包含搜索未知费用预留 US$0.50。下一步修目标约束与日期证据、减少实际返工，不能把小样本与历史不同案例直接作提速比较。

9 月 13 日 HANDOFF 中“仍在集成工作区、未合并”描述的是当时状态，不能作为今天 main 的事实。旧演示额度、端口、服务状态也不自动延续。

当前任务顺序唯一依据：[DPS](design/budget-travel-agent/DPS.md)。B4 在现有短轮询上提前展示已保存结果，按作用域与 revision 合并，取消确认后再释放提交，保留浏览与未发送草稿。B5 已输出每轮有界服务端诊断，客户端在内存记录 accepted/首卡片/最终 UI commit；未知费用和缺失时钟保留 null，UI commit 不代表像素绘制。当前推进 G1；数据库及确定性模型/证据 fixture 验证独立于真实 Provider/平台验收，不能宣布生产路径已跑通。[RUNTIME_PLAN](design/budget-travel-agent/RUNTIME_PLAN.md) 维护 B1–B5 精确契约。B3 草稿仅同 generation 有效，重启或换轮仍需从 Artifact 恢复；未实现散文预算语义自动判分。

## 续作入口

每次先检查 Git/当前任务和 progress，再读相关架构/工具/ADR。每次修改同批更新 docs，执行 [文档维护规则](DOCS_MAINTENANCE.md)。本地命令见 [部署与运行](deploy.md)，运行时配置不要抄旧交接中的密钥、额度或假定端口。

2026-09-21：新攻略日程/补充引用携带 reference_only 适用性说明，来源 verification 与价格/营业时间的当前适用性分离；旧记录保守展示。详见 [ADR 0022](adr/0022-guide-source-applicability.md)。代码修复不追认 G1 内容通过，实测边界见 progress。


2026-09-21：SerpApi 主研究路径增加有界正文读取及 `claimEvidence` 原文绑定，读到正文不升级为当前/未来事实已核实。攻略共享 validator 拒绝声明出处错误和同对象冲突；保持 reference_only。接入、限制与兼容见 [ADR 0023](adr/0023-source-pages-and-quoted-claims.md)。

最新[9月21日单例](design/budget-travel-agent/G1_SOURCE_RETEST_2026-09-21.md)实际保存/恢复通过但内容未过；具体票价可以省略claimEvidence出现在散文中，预算结论缺计算，英文元叙述仍存在。搜索累计24/24已满。Docker异常导致专用临时容器清理未确认，见报告准确标识。


## 2026-09-22 第三阶段地点扩展

发布后的显式地点补全已接入 Nominatim、独立 PostgreSQL 缓存/绑定和正式地图；不会进入 Planner 工具循环。只有当前 accepted 内容 hash 和 activityId 对应的 resolved 实体能显示景点坐标；语言切换/刷新只读，图片未接。H5 真实底图与双入口恢复通过，微信标记/联动已验证但东京底图仍空白，不能宣称全平台地图完成。配置、15/24 次真实调用及截图见 [第三阶段记录](design/budget-travel-agent/PLACES_MAP_2026-09-22.md)。上文“活动缺坐标”以此增量为准；媒体仍待后续任务。

## 2026-09-22 固定版本地图收尾

地点请求新增可选服务端 PLACES_PROXY_URL，专用 HTTPS Agent，未改 Planner 出口。Node22.21.0 实际请求约1288ms解析明治神宫；正式3000真实微信认证/旧攻略读取200，地点409 PLACE_BASE_UNAVAILABLE（旧攻略无接纳终稿，public 地点表亦未迁移）。52cb1c3干净微信产物在同一东京窗口5/15/30秒均有标记、无可见底图，OS与SDK一致，无可归因的原生网络错误。此轮不宣称微信地图可用；H5沿用历史实测、不重复认证。见[独立收尾报告](design/budget-travel-agent/MAP_CLOSEOUT_2026-09-22.md)。
