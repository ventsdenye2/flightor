# DSH 私有 worker 会话边界

## 本轮补充：计量 IPC、回执重传与锁竞争

计量内部 IPC 精确允许 `__model_admit`、`__model_receipt`、`__search_admit`、`__search_receipt`，且仅 `metered=true` 才进入父端执行。各自 args 使用严格独立 schema：admission opaque id、非负有限 duration、布尔 failed、DSH 官方 TokenUsage 的 input/output/total/cacheRead/cacheWrite/reasoning 计数（或缺失 usage 的 null）；拒绝额外字段、负值和未知内部命令。metered 参与 profile hash，切换策略会退休旧会话，避免暖恢复绕过准入。

同 IPC tool id 的相同 name/args 只执行一次；执行中与已完成后的重复消息都复用同一结果并重发 tool_result。相同 id 携带不同参数使该 worker 失败，不复用旧结果或重复业务写。generation 退休后仍不重发回执。

目录锁所有取得、陈旧 PID 回收和正常释放统一经过短暂独占 `manager.lock.guard`，避免多个恢复者同时在 read/check/unlink 之间误删新 owner 锁。只有证实旧 PID 已退出才回收 manager.lock。若进程恰在更改锁时崩溃留下 guard，则保守拒绝并要求检查；不自动递归回收 guard，从而避免再次引入同类竞态。仍仅支持同主机、本地文件系统、单持久目录 owner。

worker 的 tool_start/tool_end activity 有严格 toolName/toolCallId 分支；`web_search`、`web_fetch` 显示 researching，`commit_travel_guide` 显示 building_itinerary，不改变公开状态枚举。验证覆盖真实官方 worker 的 fixture 模型/搜索计量、严格坏消息拒绝、计量策略会话退休、重复回执、并发陈旧锁恢复；没有真实付费请求。

本次串行验证：`npm test -- src/agent/dsh/session-manager.test.ts` 15/15 通过（20.05 秒），随后 `npm test -- src/routes/agent-cloud.test.ts src/agent/cloud/turns.test.ts` 15/15 通过（9.00 秒）。此前联合运行中曾超时的取消 API 用例单独复验 881ms 通过，未放宽其 5 秒测试限制。`npm run check` 通过。后文 32 项为此前阶段证据，不能替代此批新增计量与锁回归。

2026-09-24，实现于 `backend/src/agent/dsh/session-manager.ts`。这是单主机、单 API 实例下的私有 IPC 会话管理，不是分布式持久运行队列，也不自动恢复中断的业务操作。

每个 owner/Trip/conversation 组合用 SHA-256 文件名持久映射到随机 sessionId、配置 profile hash 与 Memory epoch hash；不把身份或 Memory 正文写入映射。persona、模型路由、工具 schema 或 Memory epoch 变化会退休旧 worker 并创建新 session，旧数据不被删除。进程重启/空闲回收后通过 DSH 官方 resume 重新打开相同 session；若映射/会话不可读则明确失败，不能静默替换成新历史。

目录使用 `manager.lock`、独占创建与进程 PID/token；已存活 PID、无法核实或损坏的锁拒绝启动，只有确认 PID 退出后才尝试回收。不能在网络文件系统或多主机共享此目录。模型 key 只进入当前 fork 的私有环境；不继承 HOME、全局 DSH 配置、PATH、代理、其他 Provider 凭证或模型配置。环境仅保留 Windows/SystemRoot、临时目录与明确 DSH key；fixture 只有显式测试路由才启用。

同 scope 并发在任何 await 前拒绝；容量包含正在 open 的 worker，已空闲 worker 可回收。`onAdmitted` 在获得 scope 锁且 worker open 成功后、发出 turn 前执行，供服务恰好一次写入本轮用户消息；它不是数据库幂等请求的替代。公开 GET/刷新不进入 run。消息有严格 Zod envelope、1 MB 上限、开会话/轮次/取消超时、工具白名单、generation fencing 与同 IPC tool id 去重。

取消先退休 generation，再中止父端领域工具 signal 并发出官方 cancel；2 秒内 worker 不响应时只终止该 worker。无论 worker 是否退出，run 都等待父端实际工具 Promise 完成后才 settle，不用 2 秒竞赛提前宣布业务写已停止。迟到工具 IPC 与结果不能继续执行或回填新 generation。close 同样取消、等待并释放独占锁。领域工具自身仍须在每个写边界检查传入 signal；manager 不替代 owner/version/Goal 校验。

显式 web 配置支持 `serpapi-raw` / `deepseek-official`，参与 profile hash；搜索 key 仅透过 `FLIGHTOR_DSH_SEARCH_KEY` 传给子进程。内部 `__web_search`、`__web_fetch`、`__record_web` 只有配置 web 时允许桥接，不向模型公开 schema；普通工具仍严格匹配本轮 allowlist。除上述 web 桥接与本文四个显式计量命令外，其他双下划线 IPC 名称拒绝。

取消 POST 使用 `PlannerTurnStore.cancelAndWait`。DSH 在实际父领域调用 drain 前保持 running（既有状态合同），owner 取消重复请求共等同一执行 Promise；同 scope 新轮次明确拒绝。315 秒外层超时仍生效并返回 timeout 状态，但取消 POST 不把 timeout 当已停止写入的确认。已 terminal 但未 drain 的资源不能为容量/过期清理而丢弃。legacy store 的同步取消行为保留，HTTP 等待 legacy service settle；不据此夸大 legacy 不响应取消的 Provider 副作用已停止。

验证用真实官方 worker 与确定性模型 fixture，覆盖暖会话 followup、冷 resume、Memory 变更、owner 隔离、并发拒绝、cancel/drain、目录互斥与容量；受控 fake worker 仅验证重复 IPC/旧 generation、无响应取消和环境键白名单，不能冒充真实 DSH 行为证据。追加传输层取消保存竞争/超时及认证 API 等待测试后，`npm test -- src/agent/cloud/turns.test.ts src/routes/agent-cloud.test.ts src/agent/dsh/session-manager.test.ts src/agent/cloud/service.test.ts src/agent/planner-domain-service.test.ts` 共 5 文件 32 项通过（15.08 秒）；`npm run check` 与 `git diff --check` 通过。无新增真实模型/搜索/数据库调用费用，测试模型是确定性 fixture。

首次数据库条件只读检查：读取原 backend `.env`/`.env.demo` 的连接配置而不输出凭证，localhost:5432、127.0.0.1:55439 与历史独立 63432 均 ECONNREFUSED。此为环境准备前的历史状态；随后已经建立本轮独立持久 PostgreSQL，实际地址、基础测试失败和资产保留说明见 [数据库报告](DSH_DATABASE_2026-09-24.md)。不能据旧地址或本地 fixture 宣称真实 Provider/G1 通过。
