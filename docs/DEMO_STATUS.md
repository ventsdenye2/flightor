# 今晚微信 Agent 演示状态

更新时间：2026-09-07 22:03（北京时间），真实链路验收中。

22:07 用户要求改用 DeepSeek V4 Flash：已核验 OpenRouter 在线目录，选定 `deepseek/deepseek-v4-flash-0731`，更新默认值、示例及已忽略的 `.env` / `.env.demo` 三个模型字段（OPENROUTER_MODEL / PLANNER_MODEL / RESEARCH_MODEL），API 已重启，正在验证 Flash 完整攻略链路。旧 Pro 的计时和结果仅作历史对比。

目标：微信端登录 → 多轮对话补齐条件 → 用户明确点击生成 → 实际 Worker/供应商生成路线 → 查看与保存 → 回到对话继续追问。遵守架构的明确生成动作；不以假登录、假航班或 Mock 数据作为真实链路验收。

## 正在处理

| 环节 | 状态 | 证据 / 下一步 |
| --- | --- | --- |
| 本地 API / Worker | 运行中 | 127.0.0.1:3000，独立 flightor_demo 数据库；真实 PostgreSQL Worker；Redis 明确 disabled_local |
| 微信登录 | 等待 AppSecret | 已从项目配置同步 WX_APPID，WX_SECRET 仍未配置 |
| 前端构建 | 真实模式构建通过 | 默认关闭 Mock；本次显式 false，API 指向 http://127.0.0.1:3000，Webpack 成功；根 npm test 通过 |
| 多轮 Planner | 修复后从新会话重跑 | 首轮 19 秒成功持久化 v1，未调用搜索；早先首轮只承诺未落库的问题已在新会话复测修正 |
| 路线生成 | 真实 Worker 已成功 | 修复非空 warnings 写入 PostgreSQL JSONB 的数组序列化；真实报价生成两条路线，1002 / 1007 CNY，云端恢复 succeeded |
| 生成后追问 | 真实在线通过 | 19.5 秒；读取已存报价回答 9C 6217、14:55→19:00、1002 CNY，未重新搜索 |
| 逐日攻略 | 保存与跨轮续接通过，内容仍不足 | 研究落库后单轮150秒超时；下一轮54秒成功保存并读取5天攻略，但仅第1天有部分核实条目，其余空白；正在修正研究合成延迟并重跑 |
| 微信开发者工具运行 | 待验证 | 本机工具进程存在，正在检查 CLI 与自动化入口 |

## 已有基线

提交 b2dbe74；后端全量 314 测试通过，AeroDataBox 后续回归 9/9；根测试和生产构建通过。机场/航线/时刻、真实票价及 Research 曾分别在线实测成功，尚不等价于本次完整演示链路。

本轮后端全量 68 suites / 325 tests 通过，包含全部 13 项 PostgreSQL 集成测试（无 skip）。随后目的地/研究衔接修复单独回归。演示脚本身份是独立数据库中的随机开发测试用户，东京日期、预算、偏好均为合成测试输入；它不替代小程序微信 code 交换验收。用户已明确授权该合成行程的 OpenRouter/SerpApi 在线验证。

模型兼容：线上探针 `reasoning.enabled=false` 返回 HTTP 200、1.17 秒、reasoning_tokens=0。Planner 和 Research 明确关闭推理，V4 的旧 `effort=none` 转换为该参数；相关 18 项回归通过。研究使用一次合并检索后先保存攻略，避免重复检索耗尽单轮；截断 completion 不再标记 completed。前端对话超时180秒，高于后端150秒。

## 当前最短启动方式

依赖：本地 PostgreSQL 容器须运行；`backend/.env.demo` 已配置独立 `flightor_demo` 数据库与服务密钥，文件被 Git 忽略。所有 9 个迁移已应用。Redis 仅开发模式可显式关闭，生产仍强制启用。

```powershell
npm --prefix backend run build
npm --prefix backend run demo:api
# 第二终端
npm --prefix backend run demo:worker
# 第三终端，仓库根目录
$env:FLIGHTOR_USE_MOCK = 'false'
$env:FLIGHTOR_API_BASE_URL = 'http://127.0.0.1:3000'
npm run build:weapp
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

当前 API/Worker 已启动，无需重复启动。开发者工具导入仓库的 `project.config.json`（miniprogramRoot 为 dist），本地调试关闭合法域名校验。实际手机不能访问电脑的 127.0.0.1，需要可达的 HTTPS API 后重建；目前未部署公网服务。

`WX_SECRET` 仍须配置到 `backend/.env.demo` 并重启 API 才能验收微信登录。开发者工具进程存在，但 CLI 当前登录配置路径不匹配，自动化入口未就绪；不绕过工具认证。

验收对话：先发送“上海浦东到东京成田，5天，美术馆和日料，机票预算5000元，先记录不要搜索”；再发送“2026年10月10日出发，去程直飞优先，查真实机票”；点击“生成路线”，查看报价；追问最便宜航班详情；请求只在东京的五日逐日攻略。保存/恢复需在微信端实际点击核验。

## 更新规则

每个阻塞修复、运行验证、失败和阶段提交立即更新本文件，并同步 PROJECT_CONTEXT / PHASE789_ACCEPTANCE 中影响运行方式的条目。验收只写实际观测，不把静态测试等同于微信运行结果。

