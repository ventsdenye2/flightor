# Codex 续作入口

先读 [文档索引](README.md)、[项目现状](PROJECT_CONTEXT.md)、[文档维护规则](DOCS_MAINTENANCE.md) 和当前 [progress](design/budget-travel-agent/progress.md)。本轮顺序以 [DPS](design/budget-travel-agent/DPS.md) 为准：精简现有流程 → 跑通 → 测量 → 多用户案例 → 评估 → 决定是否试验 DSH。

改架构前读 FLIGHTOR_ARCHITECTURE、相关 Accepted ADR 与 TOOLS；Proposed 不代表当前实现。每次修改都在同批更新 docs 中对应行为、状态和验证证据；不能只加“已同步”而保留错误内容。

沿用用户当前选择的模型与推理设置，不能由旧文档固定 Codex 模型。默认一个主执行者，只有用户或适用指令明确要求才启用子代理。“多用户案例”不是多 Agent 授权。

保留无关工作区改动。不自行提交、推送、发布。真实 Provider 调用记录额度、配置指纹与失败，不假造价格或把历史回放说成实时数据。区分静态检查、数据库、模型、H5、微信模拟器和真机证据。Memory/Conversation/Trip/Artifact 及用户采用授权不得合并或绕过。
