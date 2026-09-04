# FlightOR

国际航线比价与多城路线规划微信小程序。前端使用 Taro + React + MobX；`backend/` 为独立自部署后端。原微信云函数仅保留为迁移期兼容/测试资产，当前规划对话统一走自建后端的 `POST /v1/agent/converse`。

后续开发开始前先阅读 [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)，其中集中记录当前 MVP 状态、仓库结构、启动方式、外部 API 状态、工程约束和下一步优先级。

## 快速开始

先启动自建后端（需要 Docker Desktop）：

```powershell
docker compose up -d --build
Invoke-RestMethod http://localhost:3000/health/ready
```

默认 Mock 模式可离线启动小程序：

```bash
npm install
npm run build:weapp        # 产物输出到 dist/
# 或开发监听模式
npm run dev:weapp
```

微信开发者工具中导入项目根目录，或直接打开构建后的 `dist/`（`project.config.json` 的 `miniprogramRoot` 已指向 `dist/`）。

## 连接自建后端

第三方密钥只配置在 `backend/.env`，不会编译进小程序包。开发者工具连接本机后端：

```powershell
$env:FLIGHTOR_USE_MOCK='false'
$env:FLIGHTOR_API_BASE_URL='http://127.0.0.1:3000'
npm run dev:weapp
```

非 Mock 规划流程由小程序统一请求 `POST /v1/agent/converse`；前端不再按“多城/几个城市”等关键词分流。小程序不直连 OpenRouter、SerpApi 或微信云函数；多轮补充、请求代次保护、按单卡确认和结果合并均在当前前端链路中生效。路线卡的实时报价确认仍由后端确认接口处理；明确请求“每天怎么玩/景点”等攻略时，响应中的 `travelGuide` 会作为对应 assistant 轮次附件展示。2026-09-04 的 Provider/服务函数直连验证见下文；Docker 仍不可访问：`docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接，因此最终 compose 镜像和微信开发者工具 UI 尚未实测。

后端正式默认通过 OpenRouter 使用精确模型 `deepseek/deepseek-v4-pro-0813`（可由部署环境或 `backend/.env` 的 `OPENROUTER_MODEL` 替换），并集中在统一 client 中配置，不写入前端或业务模块。该付费模型需要有效 `OPENROUTER_API_KEY`、账户余额和可用配额；未配置 key、余额不足、Provider 请求失败或模型输出不合规时，会继续返回确定性规则结果并标记相应 fallback warning。当前业务请求以 `reasoning=none` 关闭推理，V4 Pro 适配器会安全省略该字段；未来显式 `high`/`xhigh` 才会转发，其他模型保持各自兼容行为，不会自动为所有请求开启高推理。自动化测试使用 stub，不发起真实付费调用。此前 DeepSeek V3 与 V4 Flash 的直连结果仅作历史样本，不代表当前默认模型。

预算口语金额由前后端各自的无依赖规则解析器统一处理：`一万五`/`一万五千`/`1万5`/`1万5千`均为 15000，`两万三`为 23000，`1.5万`为 15000，`一万零五百`为 10500；不完整或有歧义的表达不会猜测，确定性值也不会被模型的粗粒度预算覆盖。

真机调试时把 `FLIGHTOR_API_BASE_URL` 换成手机可访问的 HTTPS 域名（或同一局域网测试地址），并在微信公众平台配置 request 合法域名。未设置 `FLIGHTOR_USE_MOCK=false` 时仍使用本地演示数据。

## 目录结构

```
src/            小程序前端（pages 主包 / subpages 分包 / components / services / stores）
cloud/          遗留微信云函数兼容/测试资产（非当前小程序运行链路）
backend/        Fastify API / Worker / PostgreSQL 迁移 / Provider 适配器
scripts/        测试与工具脚本
docs/           设计文档（multi-city-plan.md 多城方案、deploy.md 部署清单）
```

后端启动和接口说明见 [`backend/README.md`](backend/README.md)，完整设计见 [`docs/backend-architecture.md`](docs/backend-architecture.md)。

## 规划页交互

“当前理解”位于对话区上方、输入栏上方，独立于聊天 `ScrollView` 且默认折叠；展开后查看出发地、日期、天数、预算、区域、兴趣、必去/排除城市和 Agent 推荐模式，并可开始“新行程”。推荐、快捷动作、warnings、路线卡和攻略卡以 `chatStore.timeline` 中对应 assistant 轮次的结构化快照渲染，按 `user → assistant → attachments → next user` 顺序保留在原位置；攻略默认显示双语摘要，天列表可按 turn 临时展开，来源显示标题/域名，只有 `web` 来源提供“复制链接”（不跳转 web-view），catalog/rules 来源不可点击。只有最新轮附件可操作，历史攻略仍可查看/复制，历史推荐/快捷动作和路线报价确认均禁用。`reset`/“新行程”会清空时间线和会话状态。

规划页是启动页和首个 tab，tab 顺序为“规划 → 搜索 → 探索 → 我的”；原搜索、探索和我的页面均保留，搜索结果/路线详情仍按原页面打开。会话历史保存在本机 Taro storage，游客可用，不依赖登录、云函数或后端会话；`chat-history-v1` 只保留最多 20 个会话，每会话最多 24 条 API messages、12 轮 timeline、3 个推荐/快捷动作/路线和每条路线 8 个航段。攻略也只挂在产生它的 assistant turn 上，rehydrate 仅接受 `web/catalog/rules` 来源，限制天数、每天条目、来源数和聚合文本长度；网页来源只允许无凭据的 `http/https`，复制链接不打开网页。缓存 rehydrate 有版本与字段校验，损坏数据安全忽略；切换/删除/新建会话会使在途请求失效，loading 和报价中的瞬态不会写入历史。需要跨设备同步时再接入服务端能力。

## 测试

```bash
npm test                   # 根项目全套 140/140（含预算纯函数 12/12、会话缓存 17/17，离线）
npm run test:budget        # 前端 Mock 预算口语金额纯函数 12/12
npm run test:chat-history  # 会话缓存版本/限长/瞬态回归
npm run test:route         # 遗留多城规则引擎兼容测试
npm run test:route-real    # 遗留报价映射/探测兼容测试（离线部分）
npm run test:route-llm     # 遗留解析归一化与降级兼容测试
npm run test:route-cloud   # 遗留云函数 handler 协议测试
npm --prefix backend test  # 后端 20 个测试文件 / 121 项
```

提交前必须 `npm test` 全绿、`npm --prefix backend test` 全绿、`npx tsc --noEmit` 和 `npm run build:weapp` 通过。遗留引擎或协议资产改动需同步加回归 case（参照 `scripts/test-route.js` 的 Case 编号格式）。

## 最终验证记录（2026-09-04）

2026-09-04 将 `backend/dist` 直接调用的 Provider/服务函数验证与 Docker HTTP/UI 验证分开记录；当前默认 V4 Pro 已完成一次付费 Provider 直连验证，旧模型样本另作历史记录。直连验证未输出或记录任何 key，且不依赖数据库：

1. 模型切换前的历史 OpenRouter 样本使用 `deepseek/deepseek-chat`；最小“仅回复 OK”请求返回 `success=true`、`content=OK`，仅作旧模型历史样本，不作为当前 V4 Pro 验证依据。
2. 当前默认模型付费直连验证：从 `backend/dist` 使用 `.env` 默认值调用，调用处未显式提供 model override；请求带业务现有 `reasoning:{effort:'none',exclude:true}`，由适配器省略该字段。`configuredModel=deepseek/deepseek-v4-pro-0813`、`responseModel=deepseek/deepseek-v4-pro-0813`、`success=true`、`content=V4 Pro 配置验证成功。`、`promptTokens=97`、`completionTokens=60`、`totalTokens=157`、`cost=$0.00036564`。这证明当前 key、余额、模型 ID 和默认适配路径可用，但不代表 Docker HTTP/UI 已验证。
3. 模型切换前的历史核心 Agent 样本：原文“我从北京出发，10月1日去日本玩7天，预算一万五，喜欢文化和美食，你帮我选择城市并规划路线”返回 `source=llm`、`phase=plan`、`origin=PEK`、`travel_days=7`、`budget_max=15000`、`destination_mode=recommend`、推荐 `[KIX,NRT]`、`routes=2`、`warnings=[]`。这覆盖了此前预算被解析为 10000 的回归，但不代表当前 V4 Pro 的 Agent 端到端质量。
4. 模型切换前的历史攻略调用首次组合请求出现瞬时 `search_failed`，安全降级为 catalog；同一 SerpApi Google Search 直接重试成功并返回 3 条结果。完整 SerpApi + 旧 DeepSeek 模型重试结果为 `source=web`、`days=3`、`sources=4`、`webDomains=[www.facebook.com, mercure.accor.com, janicerohrssen.com]`、`warnings=[travel_guide_llm_fallback]`。编辑输出未通过严格 grounding，因此保留网页摘要驱动的确定性日程；这证明带来源攻略链路可用，但不是当前 V4 Pro、也不是无 warning 的理想 LLM 攻略质量。
5. Docker HTTP/UI 仍未完成：`docker compose ps` 无法连接 `dockerDesktopLinuxEngine`，`localhost:3000` 拒绝连接，故最终 compose 镜像和微信开发者工具交互尚未实测。
6. 自动验证结果：根项目 `npm test` 为 140/140（含预算纯函数 12/12、会话缓存 17/17）；后端为 20 个 test files / 121 tests；root/backend typecheck、backend build、weapp build、`git diff --check` 均通过。

## 协作约定

- 分支：`master` 保持稳定，功能开发开 `feat/xxx` 分支，PR 合入
- `cloud/routePlanner/` 仅作为遗留兼容/测试资产，本地 Node 可直接测；当前非 Mock 多城运行链路不依赖它
- 自建后端部署与环境变量：见 `backend/README.md`
