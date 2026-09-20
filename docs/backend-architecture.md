# 当前后端架构导航

更新：2026-09-20。旧稿中“没有独立后端”“默认 mock/前端直连”等描述已经过时，已移至 [历史原稿](archive/legacy/backend-architecture.md)，不能继续作为开发依据。

当前为 Fastify + TypeScript 模块化后端，PostgreSQL/Kysely 持久化、Redis 与独立 Worker；入口 `backend/src/app.ts`、`routes/agent-cloud.ts`、`app/context.ts`、`worker.ts`。

- Planner 自主理解和选择工具；领域服务负责报价、身份、约束、来源、保存与完成。
- 已选航班由 Workspace 管理，攻略与其 revision 和 Artifact 来源绑定。
- route-generation 已有持久后台 run；对话 turn 仍是单进程临时轮询，两者不可混称。
- 航空/票价/研究 Provider 可替换，但所有业务调用经过服务端；前端不持有供应商密钥。
- OAG 可选；不能将旧 route-plans/云函数链路当作新 Planner 主路径。

完整当前边界见 [权威架构](FLIGHTOR_ARCHITECTURE.md)、[工具表](TOOLS.md)、[项目上下文](PROJECT_CONTEXT.md)。后续精简方案见 [RUNTIME_PLAN](design/budget-travel-agent/RUNTIME_PLAN.md)。本页只维护导航，避免复制一套互相冲突的架构。
