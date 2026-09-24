# DSH 后端实施记录

状态：实施中，未声称真实 Provider 或 G1 通过。用户 2026-09-24 明确优先 DSH，取代旧 R/U 与条件 C1 前置；范围见 [原附件方案](DSH_IMPLEMENTATION_PLAN_2026-09-24.md)。

基线 `origin/main@8a83b032a8ee18097af62304d99df86f9a543489`，已 fetch。隔离工作树 `.worktrees/dsh-backend`，分支 `codex/dsh-backend`。原 main 的 `output/` 未跟踪内容保留；不合并或部署。

## D0

2026-09-24 19:49（Asia/Shanghai）开始独立 runtime 实施。核验官方固定提交 `46a7f68b0922371ce7144b668b90e377d8e799f4`；npm 的 DSH 核心实际发布 `0.1.7-rc.1`，Cordis `4.0.4`；本机 Node `22.21.0`。独立 package/lock 不改变前端依赖。

显式组合核心插件；不加载 sdk/sdk-minimal、用户 profile、shell、文件工具、Git、PTC、subagent、插件安装、session-log 或 inventory 上传。Session JSONL 是内部持久化，不是模型工具。插件和工具执行白名单由代码强制。

验证结果待填；未进行付费调用，本批当前费用 0。未取得本次明确金额/次数授权，历史额度不沿用。

D0 20:03 核心与独立 worker 两项测试通过（Node test 0.751s）：真正 AgentLoop 工具、followup、cancel、JSONL resume；worker private IPC、结果相关 ID 和模型调用数。最初两次分别暴露消息 id/source 缺失，已使用 createUserMessage 与 flightor-context 来源修正。无网络模型调用。
