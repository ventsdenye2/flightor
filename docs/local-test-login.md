# 本地测试登录

2026-09-08：开发者工具的登录请求已到达本地 API。AppID 一致，但后端 `WX_SECRET` 为空，微信接口连续返回 `503 WECHAT_NOT_CONFIGURED`。现在登录弹窗会保留明确错误，不再同时弹出泛化的网络异常提示。

用户已选择先使用本地测试账号连接真实后端。当前本地 API 已按新配置重启，小程序 `dist/` 已完成专用构建。

## 现在使用

在微信开发者工具重新「编译」，打开「规划」或「我的」中的登录弹窗，点击 **本地测试登录**。头像昵称可以留空。登录后「我的」会标注本地测试账号；可以继续对话、创建行程、保存攻略和读取云端记录。关闭弹窗仍会取消自动续办；退出登录仍会清除本地凭据。

该账号固定复用当前数据库的 `local_test` 身份。数据位于真实开发后端，`FLIGHTOR_USE_MOCK=false`；研究、Agent 和机票查询继续使用已有真实 Provider 配置与额度。本地账号的数据与真实微信账号分开。

## 重新启动和构建

从仓库根目录执行。数据库必须已经启动；本机 `flightor_demo` 目前在 `127.0.0.1:55439`。

```powershell
# 第一次配置；重复执行保留原测试密钥
npm --prefix backend run local-login:setup
npm --prefix backend run build
npm --prefix backend run demo:api
# 另一终端：生成带本地入口的小程序
npm run build:weapp:local
Invoke-RestMethod http://127.0.0.1:3000/health/ready
npm --prefix backend run local-login:verify
```

已有 API 运行时不必重复启动。配置脚本仅修改忽略的 `backend/.env.demo` 中 `HOST`、`LOCAL_LOGIN_ENABLED`、`LOCAL_LOGIN_KEY`；只允许本机开发用 `flightor_demo`。构建脚本从同一文件读取本地密钥，不修改系统环境变量，也不把微信或其他 Provider 密钥写入小程序。

`build:weapp:local` 支持 `-- --watch`。普通 `build:weapp` 默认不含本地登录配置；若重新使用普通构建，本地按钮会消失。当前进程记录和日志为忽略目录 `backend/.demo/api-local-login.*`。

## 访问范围与正式微信登录

后端默认关闭本地登录；启用时必须是非生产环境、监听 loopback、使用至少 32 字符的本地密钥。请求还需来自真实本机 socket，不能通过 `X-Forwarded-For` 伪装。请求不接受 `user_id` 或自选身份。生产环境启用会在启动时直接报错；普通客户端构建默认不含该入口。本地 Access Token 带独立标记，Refresh Token 根据真实身份类型检查；关闭本地登录或进入生产环境后，这两种测试凭据都会被拒绝。具体决策见 [ADR 0013](adr/0013-local-test-authentication.md)。

这个入口供本机开发者工具使用。恢复真实微信登录时，在 `backend/.env` 中补齐与根目录 `project.config.json` 同一 AppID 的 `WX_SECRET`，将 `backend/.env.demo` 的 `LOCAL_LOGIN_ENABLED=false`，重启后端并运行普通 `build:weapp`。`WX_SECRET` 只保存在后端。手机测试还需要手机可达的 API 配置。

## 验证证据

- 14 项后端配置、socket/key 授权、身份隔离和测试 Token 停用检查通过。
- 客户端 Session recovery 24、Artifact 19、Phase 6 18，共 61 项检查通过；包含本地按钮事件、登录续办、关闭/退出竞争、错误提示及无自动身份回退。
- 前后端 TypeScript 检查通过；带本地入口的 weapp 构建通过。核对产物已包含本地端点和本地密钥，未包含微信、SerpApi、OpenRouter 或 JWT 签名密钥。
- 本地真实 HTTP / PostgreSQL 验证通过：错误或缺失密钥拒绝、自选用户 ID 拒绝、JWT 会话签发、Refresh Token 轮换及旧 Token 拒绝、重复登录同一账号、创建 Trip/Conversation 并恢复 workspace。也使用同一数据库验证关闭入口/生产配置时测试凭据不能使用或续期，不修改正在运行的 API 配置。验证脚本只清理本次创建的临时 Trip 和会话。
- 证据位于忽略目录 `backend/.demo/local-login-*.json`，不保存 access/refresh token。微信 code 交换和开发者工具实机画面尚未验收。
