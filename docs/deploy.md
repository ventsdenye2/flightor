# FlightOR 部署与运行边界

更新：2026-09-20，依据当前 compose、backend README 和构建配置整理。本轮未执行部署。原先云函数优先、前端注入 Provider key 和失败回退假数据的指南已废弃，原稿仅留 [历史记录](archive/legacy/deploy.md)。

## 当前拓扑

小程序/H5 → 自建 Fastify API → PostgreSQL、Redis、航空/票价/研究 Provider；Worker 执行持久 jobs。对话 turn 的进程内状态不支持可靠跨实例恢复，不能据此宣布可直接多实例生产部署。

运行命令与完整环境变量以 [backend README](../backend/README.md)、[env 示例](../backend/.env.example)、[compose](../compose.yaml) 为准。现有环境文件不要覆盖，密钥只进服务端环境或 Secret 管理，不能注入小程序。

## 本地

在根目录：
```powershell
docker compose up -d --build
```

compose 使用开发配置，暴露的数据库/Redis 端口和示例凭据不能原样作为互联网部署设置。

宿主开发分别执行：
```powershell
docker compose up -d postgres redis
npm --prefix backend install
npm --prefix backend run migrate
npm --prefix backend run dev
```

另开终端运行 `npm --prefix backend run dev:worker`。API 默认 3000，但以实际环境为准。GET `/health/live`、`/health/ready`、`/health/providers` 分别为进程、依赖、配置检查；都不能证明付费模型或票价 Provider 实际可用。

## 小程序与发布检查

- `FLIGHTOR_API_BASE_URL` 指向对应后端；Mock 只在显式演示模式启用，失败不自动改成假报价。
- 构建入口 `npm run build:weapp`；本地专用入口 `build:weapp:local` 不作为生产登录配置。真实微信 auth 与本地测试 auth 分开，生产禁止 local_test。
- 手机访问的地址不能是电脑的 127.0.0.1；生产网络/域名/HTTPS 配置须在目标环境按微信平台要求实测。
- 发布前验证认证、owner 隔离、数据库迁移/备份恢复、Worker 心跳、真实 Provider、取消与过期结果、目标设备地图/键盘/安全区。此处是项目验收项，不表示已经通过。
- 本轮不更新或推导外部平台规则；正式发布时重新核对官方要求。
- 不再上传云函数作为核心路径，不把 `cloud/` 遗留工具测试当作自建后端运行证明。

当前证据：[航班优先验收](FLIGHT_FIRST_ACCEPTANCE.md)。每次配置、命令或部署能力变更同批更新本页及相关 docs。

## Planner B2 兼容开关（2026-09-20）

新增 `PLANNER_LEAN_GOALS_ENABLED`，只接受 `true` / `false`，默认 `false`；示例配置同样关闭。`true` 让业务工具携带 intent/goalRef 并由服务端原子接受 Goal/Run、自动完成校验；同时隐藏 Planner 的 declare/resume/finish 工具。不会改变运行模型、Provider、研究预算或数据库 schema，已有 `.env` 未修改。

在两轮执行之间修改后端配置并重启 API 生效；回退为 `false` 恢复旧工具与提示协议。不要把进程重启宣称为持久 turn 恢复；正在运行的临时 turn 仍受既有进程生命周期限制。

本批完成离线验证，新 PostgreSQL 接受事务的集成用例已增加，但 `npm --prefix backend run test:db -- src/agent/goals/postgres.integration.test.ts` 因缺少显式 `TEST_DATABASE_URL` 启动失败。数据库事务/竞争验证及 G1 的真实链路验证完成前保持默认关闭；离线成功不等于生产开启已验收。新上下文元数据记录 `goal_protocol: lean|legacy`，不记录敏感配置。
