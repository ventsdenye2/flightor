# FlightOR

国际航线比价与多城路线规划微信小程序。Taro + React + MobX + 微信云函数。

## 快速开始

```bash
npm install
npm run build:weapp        # 产物输出到 dist/
# 或开发监听模式
npm run dev:weapp
```

微信开发者工具打开项目根目录（`miniprogramRoot` 已指向 `dist/`）。

## 密钥配置（不会进 git）

在项目根目录手动创建以下文件，向项目维护者索取内容：

| 文件 | 用途 | 缺失时行为 |
|---|---|---|
| `openrouter.txt` | OpenRouter API key（LLM 对话/解析） | 降级本地规则解析 |
| `serpapi.txt` | SerpApi key（真实机票报价） | 降级 mock/估算价 |
| `duffel.txt` | Duffel token（备用数据源） | 不用 |

构建时经 `config/index.js` 注入为编译期常量。**注意：key 会明文打进小程序包，上架前见 `docs/deploy.md` 第 1、6 节。**

## 目录结构

```
src/            小程序前端（pages 主包 / subpages 分包 / components / services / stores）
cloud/          微信云函数（routePlanner 多城规划 / searchProxy 搜索代理 / chatAgent / tripAgent / login ...）
scripts/        测试与工具脚本
docs/           设计文档（multi-city-plan.md 多城方案、deploy.md 部署清单）
```

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
- 云函数部署与环境变量：见 `docs/deploy.md`
