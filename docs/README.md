# 新后端 MVP 分支文档

更新：2026-10-19。分支 `backend-mvp` 基于 `codex/ui-experience@060d0de` 的双端共享前端，现新增最小双 DSH Agent 后端；旧后端未沿用。

- [PROJECT_CONTEXT](PROJECT_CONTEXT.md)：当前实现、目录与验证边界。
- [FRONTEND_SYNC](FRONTEND_SYNC.md)：演示版前端迁移、Git 快照与双端验证。
- [FLIGHT_OPTIONS](FLIGHT_OPTIONS.md)：对话航班选项、推荐理由与选择后规划。
- [TRIP_CONTENT](TRIP_CONTENT.md)：Commons景点图片、介绍与推荐理由、审核精选概览。
- [PLACE_RESOLVER](PLACE_RESOLVER.md)：Wikimedia 离线索引、地点消歧、统一坐标与图片查询及实测边界。
- [deploy](deploy.md)：依赖、双端启动、构建及微信导入。
- [BACKEND_MVP](BACKEND_MVP.md)：后续接入位置和待开发事项。
- [DSH_MVP](DSH_MVP.md)：本轮双 DSH Agent 最小接入与实际验证。
- [AIRPORT_LOCATIONS](AIRPORT_LOCATIONS.md)：全球机场目录、中文别名、城市聚合、数据维护与验收边界。
- [DOCS_MAINTENANCE](DOCS_MAINTENANCE.md)：同步文档和校验要求。

旧 main 的 G1/DSH/DPS 计划不作为本分支开发顺序；文件和证据保留在原分支与历史中。本分支没有追认旧功能或验收完成。
