# DSH 私有 worker 会话边界

2026-09-24，实现于 `backend/src/agent/dsh/session-manager.ts`。这是单主机、单 API 实例下的私有 IPC 会话管理，不是分布式持久运行队列，也不自动恢复中断的业务操作。

每个 owner/Trip/conversation 组合用 SHA-256 文件名持久映射到随机 sessionId、配置 profile hash 与 Memory epoch hash；不把身份或 Memory 正文写入映射。persona、模型路由、工具 schema 或 Memory epoch 变化会退休旧 worker 并创建新 session，旧数据不被删除。进程重启/空闲回收后通过 DSH 官方 resume 重新打开相同 session；若映射/会话不可读则明确失败，不能静默替换成新历史。

目录使用 `manager.lock`、独占创建与进程 PID/token；已存活 PID、无法核实或损坏的锁拒绝启动，只有确认 PID 退出后才尝试回收。不能在网络文件系统或多主机共享此目录。模型 key 只进入当前 fork 的私有环境；不继承 HOME、全局 DSH 配置、PATH、代理、其他 Provider 凭证或模型配置。环境仅保留 Windows/SystemRoot、临时目录与明确 DSH key；fixture 只有显式测试路由才启用。

同 scope 并发在任何 await 前拒绝；容量包含正在 open 的 worker，已空闲 worker 可回收。`onAdmitted` 在获得 scope 锁且 worker open 成功后、发出 turn 前执行，供服务恰好一次写入本轮用户消息；它不是数据库幂等请求的替代。公开 GET/刷新不进入 run。消息有严格 Zod envelope、1 MB 上限、开会话/轮次/取消超时、工具白名单、generation fencing 与同 IPC tool id 去重。

取消先退休 generation，再中止父端领域工具 signal 并发出官方 cancel；2 秒内 worker 不响应时只终止该 worker。无论 worker 是否退出，run 都等待父端实际工具 Promise 完成后才 settle，不用 2 秒竞赛提前宣布业务写已停止。迟到工具 IPC 与结果不能继续执行或回填新 generation。close 同样取消、等待并释放独占锁。领域工具自身仍须在每个写边界检查传入 signal；manager 不替代 owner/version/Goal 校验。

验证用真实官方 worker 与确定性模型 fixture，覆盖暖会话 followup、冷 resume、Memory 变更、owner 隔离、并发拒绝、cancel/drain、目录互斥与容量；受控 fake worker 仅验证重复 IPC/旧 generation，不能冒充真实 DSH 行为证据。执行结果待本批测试完成后补充。

数据库条件只读检查：读取原 backend `.env`/`.env.demo` 的连接配置而不输出凭证，localhost:5432、127.0.0.1:55439 与历史独立 63432 均 ECONNREFUSED。既有 `places-test-support.mjs` 使用 loopback URL、独立随机 schema 与 `search_path`，运行迁移后只清理自身 schema；当前未连接成功，未修改/启动任何数据库，不能据历史地址宣布可用。
