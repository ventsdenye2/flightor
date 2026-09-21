# G1 publication v1 H5 fixture smoke — 2026-09-21

状态：双入口当前副本与旧原记录的真实 H5 显示/刷新均已执行。当前副本满足冻结 P5 最低引用参考范围；旧原记录仍 P5 失败，只通过有限降级恢复。逐项 P1–P6 见 [验收报告](G1_PUBLICATION_ACCEPTANCE_2026-09-21.md)。

投影由 tracked 原始 fixture 重建，使用合成 workspace 运输契约；当前副本有新的 guide/route/trip IDs，不读取未跟踪 `.demo` 数据库或 workspace。固定原出发日期及航班，航班也经过正式 `presentArtifact` 生成时间展示。只读 API 拦截及预置本地测试身份不等于真实登录/后端网络端到端。

## 范围

`scripts/prepare-g1-publication-fixture.mjs` 先对原始 guide payload 做生产 schema parse，再构建 publication v1 并投影完整 ArtifactEnvelope；它断言输出 publication `legacy=false` 的检查由 H5 runner 执行。`scripts/qa-g1-publication-h5.cjs` 使用真实构建的 Taro H5 生产组件，通过 Playwright 仅拦截认证后的 `/v1/artifacts/:id` 与 `/v1/trips/:id/workspace` 读取并提供冻结投影。它不发送模型、Provider 或写入请求。每个 fixture 入口打开实际攻略详情，进入每日行程、逐日读取活动详情，刷新后重复读取并记录性能导航计时、截图及 report。

运行：

```powershell
$env:FLIGHTOR_H5_URL='http://127.0.0.1:10086'
$env:FLIGHTOR_G1_PUBLICATION_FIXTURE='backend/.demo/g1-publication-current.json'
node scripts/qa-g1-publication-h5.cjs
```

先生成当前投影：

```powershell
node scripts/prepare-g1-publication-fixture.mjs
```

前提是已执行 `npm --prefix backend run build` 和 `npm run build:h5`，并用既有 `node scripts/serve-h5.cjs` 服务构建目录。旧版单独复现：

```powershell
node scripts/prepare-g1-publication-fixture.mjs --legacy
$env:FLIGHTOR_G1_PUBLICATION_FIXTURE='backend/.demo/g1-publication-legacy.json'
$env:FLIGHTOR_G1_PUBLICATION_OUTPUT='output/playwright/g1-publication-legacy'
node scripts/qa-g1-publication-h5.cjs
```

当前副本每例检查概览、两个日期选择项、全部四个活动详情，刷新后全文完全一致；selected-flight 另断言 08:00/12:30 和 PEK/NRT。0 控制台错误，14 个 GET。self 首次显示及操作 5.757s、刷新及操作 3.091s；selected 3.580s / 3.361s。这些时间含等待/操作/截图，不是 M1 的首 paint。旧版两例也完成同样恢复操作，但只能计作有限降级，不计 P5。

完整文字与截图分别保存在 `output/playwright/g1-publication/`、`output/playwright/g1-publication-legacy/`；失败尝试按时间保留 `report-failure-*.json`。本次实际运行只声明 390×844 Chromium 桌面浏览器，H5 真机未测；规划消息列表未做浏览器验收，其恢复由离线/数据库测试覆盖。

## 当前环境证据

2026-09-21 已运行 `npm run build:h5`，Webpack 成功，编译耗时 23.91s；首次受限进程环境运行出现 spawn EPERM，随后在允许本地构建的环境重跑成功。现有通用 `node scripts/qa-h5.cjs`：390×844 与 1440×900 首页检查通过、控制台 0 错误；这不是本任务的双入口攻略显示/刷新证据。`node scripts/test-route-ui-polish.cjs` 与 `node scripts/test-route-page-dispatch.cjs` 分别通过 18、20 项离线检查。

微信最终环境复核：`miniprogram-automator` 和 `C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat` 均存在。32348 服务监听，调用原 QA 同样的 `/auto` 得到 200，稍后 9432 监听；但 SDK 查询超时（`timeout waiting for automator response`）。官方 `cli.bat auto --project ... --auto-port 9432` 返回 `IDE service port disabled`，提示在设置→安全设置开启服务端口。故显示/恢复未测；此处取代早期“未找到 CLI/服务”的环境判断。已结束本轮超时客户端，未关闭用户开发者工具、未改安全配置。下一次只需修复该自动化环境再复用固定结果，不应重跑付费生成。

## 旁路审查边界

本次 travel guide 正式详情只读取 guide/route/workspace；公开 research 形状为 `research_references`，没有证据表明旧 `ResearchWorkspace` 路径可达，因此不将组件源码推断写成运行时旁路证据。
