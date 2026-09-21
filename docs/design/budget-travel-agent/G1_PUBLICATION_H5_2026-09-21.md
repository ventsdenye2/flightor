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

此前收尾时的微信环境复核（历史失败，已由下述补验更新）：`miniprogram-automator` 和 `C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat` 均存在。32348 服务监听，调用原 QA 同样的 `/auto` 得到 200，稍后 9432 监听；但 SDK 查询超时（`timeout waiting for automator response`）。官方 `cli.bat auto --project ... --auto-port 9432` 返回 `IDE service port disabled`，提示在设置→安全设置开启服务端口。故显示/恢复未测；此处取代早期“未找到 CLI/服务”的环境判断。已结束本轮超时客户端，未关闭用户开发者工具、未改安全配置。下一次只需修复该自动化环境再复用固定结果，不应重跑付费生成。

## 旁路审查边界

本次 travel guide 正式详情只读取 guide/route/workspace；公开 research 形状为 `research_references`，没有证据表明旧 `ResearchWorkspace` 路径可达，因此不将组件源码推断写成运行时旁路证据。


## 同日补验：用户启动开发者工具和 Docker 后

SDK ws://127.0.0.1:9432 已能调用 systemInfo/currentPage、点击与截图；模拟器 iPhone 15 Pro Max，窗口 430×834，基础库 3.17.0。用户确认服务端口 32348 开启。官方 CLI 仍提示关闭，实际 CLI 读取的 Local AppData 哈希目录下 .ide-status 不存在；没有伪造该文件或修改已安装工具。已连通 SDK 可直接用于验收，CLI 自动发现问题仍保留，不要求用户重复开启。

新增 scripts/qa-g1-publication-weapp.cjs：复用本报告同一份当前/legacy 投影，操作正式路由详情、每日行程、全部四个详情。逐项断言预算未知提示、来源实用引文、建议时段、原出发日期和已采用航班时刻；页面 reLaunch 后全文一致。保存概览、第二天列表、每日首个详情截图。文本断言读取渲染元素全文（包含屏幕外内容），截图只记录当时视口，不宣称整页所有内容已人工滚动目检。P2/P3/P4/P5 的原有内容判断不因平台改变，旧记录依旧不能按 P5 通过；P1/P6 在本次范围是页面重建恢复。

| 固定样本 | 首次显示/检查 | reLaunch/检查 | 结果 |
| --- | --- | --- | --- |
| 当前 selfTicket | 18.107s | 13.898s | 全文一致 |
| 当前 selectedFlight | 17.206s | 18.618s | 全文一致，PEK/NRT、08:00/12:30 保留 |
| legacy selfTicket | 15.529s | 18.250s | 有限降级一致，P5 失败 |
| legacy selectedFlight | 18.952s | 15.005s | 有限降级一致，P5 失败 |

时长包含页面等待、点击与截图，不是 M1 paint。复用前轮构建，未重新构建产品：build-info 为 99f2ed7 dirty，构建时间 2026-09-21T03:24:32.970Z，指纹 87d6419a5b57662b639e64ed386731dcbe3e99c81549bb217084dadc07027b8c（前轮提交前构建）；本轮无产品源码修改。开发者工具不是手机，reLaunch 不是进程冷启动。

所有 wx.request 都由 SDK mock 拦截，没有真实认证/API/Provider 请求。登录走真实 UI，wx.login 与身份交换返回合成身份；/v1/memory 非本例所需，明确返回 409 并记录，未绕过请求至服务端。测试结束已恢复原 storage、游客身份和原页面，并撤销 mock。两次早期登录 mock 回调契约错误的失败报告保留；纠正为 SDK 返回响应对象后通过，不是产品登录故障。

复现需开启本项目并启用自动化端口（现有 scripts/qa-weapp-ui.cjs 使用 32348 /auto 启动 9432），模拟器处于未登录状态：

```powershell
node scripts/prepare-g1-publication-fixture.mjs
node scripts/qa-g1-publication-weapp.cjs
# 单独检查旧版：
node scripts/prepare-g1-publication-fixture.mjs --legacy
$env:FLIGHTOR_G1_PUBLICATION_FIXTURE='backend/.demo/g1-publication-legacy.json'
$env:FLIGHTOR_G1_PUBLICATION_OUTPUT='output/weapp/g1-publication-legacy'
node scripts/qa-g1-publication-weapp.cjs
```

报告和截图：output/weapp/g1-publication/、output/weapp/g1-publication-legacy/。输出目录忽略提交，脚本及输入 fixture 纳入版本管理。微信声明范围仅固定结果详情/页面恢复；消息列表、冷启动、真实登录/API、微信与 H5 真机仍未测，G1 总门与 M1 状态不变。

### 独立测试数据库及 Docker 状态

PostgreSQL 16.15、127.0.0.1:63432、专用数据库 flightor_g1_publication_acceptance_20260921 可用。定向 publication-postgres 与 workspaces/postgres 两文件四项重新通过，Vitest 6.96s；本轮未运行全量。阶段毫秒：self setup44.31/save56.67/domain6.36/independent reread19.71/workspace45.71；selected90.88/40.70/1.95/6.83/31.44。

Docker Desktop 进程存在，但宿主 docker ps 10s 超时、两个命名管道 /_ping 5s 超时；Luna 日志诊断发现 WSL 初始化网络失败后引擎又报告 running，未确定管理接口的最终根因。现存 PostgreSQL 访问正常，不应把管理接口失败写成数据库不可用。未重启 Docker/WSL/容器，避免丢失原 tmpfs 实验库；需要修管理接口时先单独备份该库，再安排维护。原账本 SHA-256 仍为 af9b37f56d2285599a4fe2f1b7163947ac0d974bcd50d36ebd4513bf1b035442。
