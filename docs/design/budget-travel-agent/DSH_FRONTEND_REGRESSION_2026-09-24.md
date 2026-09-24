# DSH 后端更换：既有前端离线回归

2026-09-24；运行时工作树 HEAD 为 `b12e809aa3fd483f36be670bc16953cb059815af`，另有本轮后端并行未提交修改。本任务未改前端源码、页面、样式、交互或公开 API，也未改根 package/lock。`git diff --name-only origin/main -- src package.json package-lock.json` 无输出。

先读取根 package.json 的四个指定 script 及子脚本，确认它们通过实际 TypeScript/组件代码转译、VM、确定性 hooks、模拟 Taro/request 运输执行，未调用真实模型、搜索、登录、地图、图片 Provider 或生产 API。没有执行根 `npm test`（包含其他非本次范围脚本），没有安装依赖或构建页面。Node v22.21.0，TypeScript 5.9.3 由原仓库现有 `node_modules` 解析提供。

## 实际执行结果

四条命令按下表顺序单独执行，均首轮退出码 0，没有失败或重试。

| 命令 | 实际计数 | 墙钟耗时 |
| --- | --- | --- |
| `npm run test:conversation-progress` | 59 项通过：conversation progress 24、PlannerProgress 生命周期 6、publication 组件 9、Plan flight publication 12、telemetry 8 | 5.603 秒 |
| `npm run test:session-recovery` | 20 项通过 | 3.016 秒 |
| `npm run test:artifacts` | 33 项通过：Artifact 25、本地化客户端 8 | 2.943 秒 |
| `npm run test:production-presentation` | 49 个明确计数项通过：presentation 36、Planner reply 6、production library 7；另 2 组媒体断言脚本通过 | 6.023 秒 |

明确计数合计 **161 项**，另有两个脚本未给独立总数的媒体回归组，不把它们机械当作两个单独案例。`test-place-media-client.cjs` 检查地点/媒体不同完成顺序、旧 hash/artifact/locale 拒绝及当前浏览位置；`test-place-media-stale.cjs` 实际运行 owner、session、Trip、generation、content 五种迟到响应场景。

耗时由每条 npm 命令外的 Stopwatch 测量，含其子脚本及 npm 启动；四组累计 17.585 秒，不是模型延迟、页面绘制时间或性能对照。完整本地输出与精确毫秒 JSON 保留在忽略目录 `backend/.demo/dsh-frontend-regression-20260924/`。

conversation-progress 和 session-recovery 输出 Node `MODULE_TYPELESS_PACKAGE_JSON` 既有提示（含 ESM 语法的脚本重新按 ESM 解析）；测试正常通过，本任务未为消除提示更改 package 模块类型。

## 覆盖及限制

已验证既有客户端的 scope/owner 隔离、只提交一次与串行 GET、暂停/超时/网络错误区分、取消必须等待终态确认、已提交 Artifact 提前显示、迟到结果拒绝、会话凭证恢复、明确航班采用、按 locale 缓存和显式本地化重试、旧/未接纳终稿隐藏、GET-only 刷新及地点/图片回填边界。纯回复组件保留普通解释文字；这些是已有客户端合同回归，不声称实际模型已经回答了某条多轮问题。

这些脚本使用既有前端实际模块配合离线运输/组件桩，**不是 DSH 后端到浏览器的真实 E2E，不是 H5 页面绘制或微信开发者工具/真机验收**。没有启动浏览器、微信工具或新 Agent；地图底图不在本轮回归前置中。真实 DSH、多轮数据库及 Provider 证据分别由其他本轮报告负责，不能据本页放行整个 G1。

本轮真实外部调用 0，模型/搜索费用 0。
