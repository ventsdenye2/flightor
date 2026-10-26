# 新后端 MVP 分支文档

更新：2026-10-26。分支 `backend-mvp` 基于 `codex/ui-experience@060d0de` 的双端共享前端，现新增最小三角色 DSH Agent 后端；旧后端未沿用。

- [PROJECT_CONTEXT](PROJECT_CONTEXT.md)：当前实现、目录与验证边界。
- [FRONTEND_SYNC](FRONTEND_SYNC.md)：演示版前端迁移、Git 快照与双端验证。
- [FLIGHT_OPTIONS](FLIGHT_OPTIONS.md)：手动/对话机票查询、单程/往返卡片与交通确认后规划。
- [FLIGHT_QUERY_ACCEPTANCE](FLIGHT_QUERY_ACCEPTANCE.md)：城市/机场×单程/往返、1–9成人、调用入口与取消/异常的扩展验收。
- [FLIGHT_QUERY_PERFORMANCE](FLIGHT_QUERY_PERFORMANCE.md)：当前浏览器Worker、前三条摘要、原页详情核价、性能开关、连续对照及失败修正。
- [FLIGHT_STABILITY_20_CASES](FLIGHT_STABILITY_20_CASES.md)：优化后二十个真实接口/H5稳定性用例与当轮证据。
- [TRIP_CONTENT](TRIP_CONTENT.md)：Commons景点图片、介绍与推荐理由、审核精选概览。
- [PLACE_RESOLVER](PLACE_RESOLVER.md)：Wikimedia 离线索引、地点消歧、统一坐标与图片查询及实测边界。
- [PLACE_LOOKUP_BATCH](PLACE_LOOKUP_BATCH.md)：当前审核 Session 批量工具、Enterprise 优先回退、成功字段锁定、查询预算和后端合并。
- [deploy](deploy.md)：依赖、双端启动、构建及微信导入。
- [WECHAT_ADAPTATION](WECHAT_ADAPTATION.md)：H5 到小程序的平台适配、AppID 与模拟器验收。
- [WECHAT_MAP_INVESTIGATION](WECHAT_MAP_INVESTIGATION.md)：国内外与缩放级别对照，解释模拟器海外灰底及证据边界。
- [BACKEND_MVP](BACKEND_MVP.md)：后续接入位置和待开发事项。
- [DSH_MVP](DSH_MVP.md)：本轮三角色 DSH Agent 最小接入与实际验证。
- [CONVERSATION_PROTOCOL_ACCEPTANCE](CONVERSATION_PROTOCOL_ACCEPTANCE.md)：聊天结构化工具交付、一次补正及10月25日矩阵复测。
- [REVIEWER_STRUCTURED_PROTOCOL](REVIEWER_STRUCTURED_PROTOCOL.md)：审核 Agent 通过 `submit_itinerary` 提交结构化行程、补正、真实复测耗时与兼容边界。
- [AIRPORT_LOCATIONS](AIRPORT_LOCATIONS.md)：全球机场目录、中文别名、城市聚合、数据维护与验收边界。
- [DOCS_MAINTENANCE](DOCS_MAINTENANCE.md)：同步文档和校验要求。

旧 main 的 G1/DSH/DPS 计划不作为本分支开发顺序；文件和证据保留在原分支与历史中。本分支没有追认旧功能或验收完成。
