# ADR 0028：Planner 执行接口与共享领域边界

日期：2026-09-24。状态：已实现接口抽取；DSH 执行实现与验收另行记录，不据此宣称 DSH 已运行。

Agent API 的服务工厂改为返回 `PlannerServicePort`，公开 HTTP schema、认证、短轮询、取消与版本协调保持原合同。该接口只有 `validateTurn`、`publicationContext`、`localizeGuide` 和 `runTurn`：前三者分别返回 owner-scoped Trip、当前 Trip/已选航班 revision、明确本地化命令的 Artifact；最后一项接收请求/generation/signal/activity observer 并返回原 Planner 结果。请求/结果类型定义在 `backend/src/agent/planner-service.ts`；legacy 导出旧名称别名以保持调用方兼容。

`PlannerDomainService` 共享 owner-scoped Trip/Conversation/Artifact 仓库校验、发布版本读取和显式本地化操作，不依赖或构造 `AgentRuntime`。它要求调用方显式注入懒加载 `createFinalizer`，仅在本地化 POST 时访问，构造服务、验证请求和轮询 GET 均不创建模型编辑器、不执行主 Agent。注入契约仅为 `generate`，不绑定 Finalizer 的私有实现。共享 `finalizeGuide` 保留接纳终稿翻译、缓存、去重、有界重试和写入前后版本校验。

`CloudPlannerService` 实现该接口并将三个领域操作委托给共享服务；legacy `runTurn`、工具循环和首次攻略 Finalizer 策略未改变。其注入的 Finalizer 仍使用 legacy runtime 的原模型/client。新执行引擎可以直接组合共享服务；不能通过创建 legacy 服务或调用其 `runTurn` 来替代 DSH 执行。

回滚：此抽取本身不切换引擎，保留旧类型别名与 legacy 默认装配。未来切换应由后端配置控制，不更改前端或公开 API。

验证：`npm run check` 通过；定向 `npm test -- src/agent/planner-domain-service.test.ts src/agent/cloud/service.test.ts src/routes/agent-cloud.test.ts src/travel-guides/finalization.test.ts` 4 文件 57 项通过（含同批 integrated publication 增量）。新增共享服务回归覆盖 owner/Trip/Conversation、取消、Trip/航班版本、本地化过期拒绝和只读路径零模型调用；独立 port 注入 API 回归覆盖一次执行后多次 GET 不再启动 Agent。首次执行缺工作树依赖；复用现有 backend 安装后，Vitest 沙箱子进程被拒，允许 scoped 测试后正常运行。新 API fixture 初次遗漏 delivery.missing，修正后通过；非业务合同变化。未执行真实模型、数据库、平台或完整 G1 验收。
