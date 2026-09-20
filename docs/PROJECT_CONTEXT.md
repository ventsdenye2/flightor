# FlightOR 当前项目上下文

更新：2026-09-20。B0/B1 已提交 `cabbf51`，B2 已提交 `d895d0e`、仍默认关闭，B3 已提交 `6649644`，B4 已提交 `1ce177b`；B5 已实施服务端模型/工具/HTTP 观测与客户端 UI commit 计时。性能数字与已运行结果必须引用具体日期证据，离线与数据库/live 的验证边界见当前 progress。

## 当前主链

`src/pages/plan/index.tsx` → `src/services/conversationService.ts` → 认证 `POST /v1/agent/turns` + GET 短轮询 → `backend/src/routes/agent-cloud.ts` → `CloudPlannerService` → `AgentRuntime` 的自主工具循环。同步 `POST /v1/agent/converse` 共用同一 Planner；旧 conversation-agent/cloud 代码不代表第二个当前主 Agent。

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

当前输出 delivery 由 completion/verifier 决定，工具正常返回或模型说完成不能代替 `satisfied`。用户明确要求才生成最终航线，内层路径搜索/优化工具不开放给会话 Planner 随意执行。默认旧模式仍公开 Goal 控制工具；`PLANNER_LEAN_GOALS_ENABLED=true` 启用 B2：业务工具携带 intent/goalRef，服务端原子接受 Goal/Run，固定本轮约束并自动验收，隐藏 declare/resume/finish。单一 completion 权威保持不变；详细公开面见 TOOLS。当前未修改运行环境来启用该开关，PG 接受事务尚缺实际集成验证。

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

9 月 13 日 HANDOFF 中“仍在集成工作区、未合并”描述的是当时状态，不能作为今天 main 的事实。旧演示额度、端口、服务状态也不自动延续。

当前任务顺序唯一依据：[DPS](design/budget-travel-agent/DPS.md)。B4 在现有短轮询上提前展示已保存结果，按作用域与 revision 合并，取消确认后再释放提交，保留浏览与未发送草稿。B5 已输出每轮有界服务端诊断，客户端在内存记录 accepted/首卡片/最终 UI commit；未知费用和缺失时钟保留 null，UI commit 不代表像素绘制。下一步 G1 跑通；保留 PG 集成验证缺口，不能据离线结果宣布生产路径跑通。[RUNTIME_PLAN](design/budget-travel-agent/RUNTIME_PLAN.md) 维护 B1–B5 精确契约。B3 草稿仅同 generation 有效，重启或换轮仍需从 Artifact 恢复；未实现散文预算语义自动判分。

## 续作入口

每次先检查 Git/当前任务和 progress，再读相关架构/工具/ADR。每次修改同批更新 docs，执行 [文档维护规则](DOCS_MAINTENANCE.md)。本地命令见 [部署与运行](deploy.md)，运行时配置不要抄旧交接中的密钥、额度或假定端口。
