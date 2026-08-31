# FlightOR

国际航线比价与多城路线规划微信小程序。前端使用 Taro + React + MobX；`backend/` 为独立自部署后端，原微信云函数保留为迁移期代码。

后续开发开始前先阅读 [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)，其中集中记录当前 MVP 状态、仓库结构、启动方式、外部 API 状态、工程约束和下一步优先级。

## 快速开始

```bash
npm install
npm run build:weapp        # 产物输出到 dist/
# 或开发监听模式
npm run dev:weapp
```

微信开发者工具打开项目根目录（`miniprogramRoot` 已指向 `dist/`）。

## 连接自建后端

第三方密钥只配置在 `backend/.env`，不会再编译进小程序包。开发者工具连接本机后端：

```powershell
$env:FLIGHTOR_USE_MOCK='false'
$env:FLIGHTOR_API_BASE_URL='http://127.0.0.1:3000'
npm run dev:weapp
```

真机调试时把 `FLIGHTOR_API_BASE_URL` 换成手机可访问的 HTTPS 域名（或同一局域网测试地址），并在微信公众平台配置 request 合法域名。未设置 `FLIGHTOR_USE_MOCK=false` 时仍使用本地演示数据。

## 目录结构

```
src/            小程序前端（pages 主包 / subpages 分包 / components / services / stores）
cloud/          微信云函数（routePlanner 多城规划 / searchProxy 搜索代理 / chatAgent / tripAgent / login ...）
backend/        Fastify API / Worker / PostgreSQL 迁移 / Provider 适配器
scripts/        测试与工具脚本
docs/           设计文档（multi-city-plan.md 多城方案、deploy.md 部署清单）
```

后端启动和接口说明见 [`backend/README.md`](backend/README.md)，完整设计见 [`docs/backend-architecture.md`](docs/backend-architecture.md)。

## 测试

```bash
npm test                   # 全部（80 项断言，离线）
npm run test:route         # 多城引擎：解析/搜索/收敛/边界
npm run test:route-real    # 真实价格探测（离线部分）
npm run test:route-llm     # LLM 解析与降级
npm run test:route-cloud   # 云函数 handler 协议
```

提交前必须 `npm test` 全绿 + `npx tsc --noEmit` 通过。引擎改动必须同步加回归 case（参照 scripts/test-route.js 的 Case 编号格式）。

## 协作约定

- 分支：`master` 保持稳定，功能开发开 `feat/xxx` 分支，PR 合入
- 引擎与云函数同构：`cloud/routePlanner/` 为纯逻辑 + 薄封装，本地 node 可直接测
- 自建后端部署与环境变量：见 `backend/README.md`
