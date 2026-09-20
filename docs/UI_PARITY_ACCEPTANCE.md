> **历史记录（2026-09-20 归类）：下文工作区、命令、进度、费用和验收只适用于记录当时；不作为当前执行入口。现状见 [PROJECT_CONTEXT](PROJECT_CONTEXT.md)，当前计划见 [DPS](design/budget-travel-agent/DPS.md)。**

# FlightOR UI 同构验收

核查日期：2026-09-14。恢复分支：`codex/ui-parity-recovery`。

## 1. 冻结基线

| 用途 | 提交 |
| --- | --- |
| 用户认可的 UI 参考 | `060d0debe08e121e22a88695a31aa67ad1929af5` |
| 模型实验归档 | `2dc88414c32e4030f1f2447877c2a60b63bd150e` |
| 上午生产集成 | `9bf8da678f52897db30f82f7aab0f0edaa09cacc` |
| main 重放状态 | `c681c63d54e4364b2a824ee6202fd21507b80c41` |
| 恢复分支起点 | `6fe612056c29eaf3d2ce2d6b109d8b31fcb1c549` |

已复核：`9bf8da6` 与 `c681c63` 的完整 tree 相同；`2dc8841` 与 `6fe6120` 的 `experiments/` 相同；`9bf8da6` 与 `6fe6120` 的 `backend/` 相同。恢复期间没有再次整体合并旧分支，也没有覆盖 backend 或 experiments。

工作区边界：

- 原始脏 main：`D:\FunnyProject\flightor-repo`，保留不动。
- 恢复实现：`D:\FunnyProject\flightor-repo\.worktrees\ui-parity-recovery`。
- 只读 UI 参考：`D:\FunnyProject\flightor-repo\.worktrees\ui-reference`。

## 2. 修复前触发链

冻结 main 中，仅成功组合出 presentation 的 `route` / `travel_guide` 进入白色 `TripExperience`。以下状态会进入旧 `route-detail-page`，继承全局黑底、深灰卡片和白字变量：

| URL / 状态 | artifact.type | 修复前渲染器 |
| --- | --- | --- |
| 未登录、缺 ID、加载、失败 | 无或未就绪 | 旧 route 状态容器 |
| route 详情已组合 | `route` / `travel_guide` | `TripExperience` |
| 路线方案 | `route_set` | `RouteWorkspace` |
| 航班列表 / 详情 | `flight_search` | `FlightSearchCard` / `FlightDetail` |
| 研究 / 目的地 | `research` / `destination_set` | `ResearchWorkspace` |
| 未知或不支持 | 其他 | 旧 fallback |

这是确定的源码分支，不是 Git 随机覆盖。`6fe6120` 的 Plan 已没有 AgentChat，不能将两类问题混为一谈。

## 3. 修复后分发覆盖

所有 route 成功、空态和错误态共用 `ux-app production-detail-page route-production`，保留业务语义，不把 `route_set` 伪装成 `route`。

| 输入 | 结果 |
| --- | --- |
| guest | 新版登录空态 |
| 缺 artifact ID | 新版失效链接空态 |
| loading | 新版白色加载态 |
| error | 新版错误态和重试 |
| route / travel_guide + presentation | `TripExperience` |
| route_set | `RouteWorkspace` |
| flight_search 列表 / 详情 | `FlightSearchCard` / `FlightDetail` |
| research | `ResearchWorkspace` |
| destination_set | 独立 destination 分派后由 `ResearchWorkspace` 展示 |
| 不支持 schema / kind / type | 新版 unavailable 空态 |
| route / guide 缺 presentation | 明确 `presentation_unavailable`，不回退旧壳 |

自动测试是 14 个分派 case 加 3 个壳层不变量，共 17 条；不是 17 个不同渲染器。

## 4. 视觉与交互

通过：

- 四个正式 tab 使用同一套深墨绿 / 海洋青 SVG 图标，并区分激活态。
- Plan 不再将 `cover: null` 当成可点击灵感卡，也不展示无实现的生产取消动作。
- Explore 六分类使用横向滚动，首次加载显示稳定骨架；真实条目无媒体时继续显示明确占位。
- 登录抽屉使用白色产品样式、44px 控件和正确按钮语义；打开时同时隐藏原生与自定义 tabBar，关闭后恢复自定义 tabBar，隐私说明及底部安全区不再被遮挡。
- route 详情的英文遗留文案、旧蓝色和点击型 View 已收敛为中文、海洋青和原生 Button。
- 固定里斯本照片、硬编码航线 SVG、无引用图钉和样例 sources 已退出生产树，只保留在 UI 参考提交。

微信证据目录：

- 原 UI 参考：`C:\Users\VENTSDENYE5\.codex\visualizations\2026\09\13\01a09a6a-7318-7343-b808-15ccc16b56ce\flightor-reference-qa`
- 修复前生产基线：`C:\Users\VENTSDENYE5\.codex\visualizations\2026\09\13\01a09a6a-7318-7343-b808-15ccc16b56ce\flightor-parity-qa`
- 首轮修复后生产截图（登录弹层仍露出自定义 tabBar，已被取代）：`C:\Users\VENTSDENYE5\.codex\visualizations\2026\09\13\01a09a6a-7318-7343-b808-15ccc16b56ce\flightor-parity-after`
- 最终修复后生产截图：`C:\Users\VENTSDENYE5\.codex\visualizations\2026\09\13\01a09a6a-7318-7343-b808-15ccc16b56ce\flightor-parity-final`

参考和生产截图均以微信模拟器证据为准，不能用 H5 预览代替。修复后报告必须同时记录恢复 worktree 路径、`miniprogramRoot: dist/`、构建 manifest 和模拟器信息。

最终微信报告硬性核对自定义 tabBar 在登录弹层打开前可见、打开后从真实 custom-tab-bar 渲染树消失、关闭后恢复；三项均为 true，且 `failures` 为空。登录截图还人工确认隐私说明、面板底部和 iPhone 安全区完整可见。

## 5. 真实数据边界

已接入：当前 route/guide 的 trip、route 和 context 精确绑定；日期、天数、城市、每日主题、活动描述与来源状态；只有 workspace 明确保存且 context、artifact、trip、`route_set v1`、`optimized_routes` 和 routeId 全部匹配时，才展示保存的航班路线。航段、机场、服务端时间、航司、换机场、中转、告警、来源与核验状态均来自已保存结果；未核验总价隐藏。

仍保持空态：活动媒体、POI 坐标、结束时间，行程封面、人数和 alternatives。不得用里斯本样例、城市中心或样例票价补齐这些字段。

## 6. 自动验证

| 命令 | 结果 |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过，退出码 0 |
| `npm run test:weapp-build-info` | 11 条通过 |
| `npm run test:session-recovery` | 20 条通过 |
| `npm run test:route-page-dispatch` | 17 条通过 |
| `npm run test:route-ui-polish` | 18 条通过 |
| `npm run test:artifacts` | 19 条通过 |
| `npm run test:phase6-client` | 22 条通过 |
| `npm run test:production-presentation` | 24 + 6 + 7 条通过 |
| `npm test` | 全套通过，退出码 0 |
| `git diff --check` | 通过，退出码 0 |
| `npm run build:weapp` | 连续两次通过，正式产物为 `dist/` |

最终构建身份以 `dist/build-info.json` 及修复后 `production-after-report.json` 为准。manifest 只包含提交 SHA、dirty 状态、源码指纹、构建时间、模式与 API 地址，不记录登录 key、token 或 provider 密钥。

## 7. 验收结论

通过：冻结 UI 参考复现、正式四主页面、route 全状态统一外壳、登录弹层完整遮蔽自定义导航并在关闭后恢复、真实保存航班适配、固定样例退出生产、TypeScript、全套离线测试、连续正式微信构建和微信模拟器截图。

未验收：微信真机、真实微信登录、横屏 / 平板 / 最大系统字号 / 屏幕阅读器焦点；新一次付费模型请求；媒体与 POI 新契约；真实航班查询、修改后恢复和失败 / 部分完成的本轮端到端重跑。正式构建仍指向 loopback API，只能证明本机模拟器路径，不能证明手机可访问后端。

恢复分支验收前不合入 main，不推送，不改写远端历史。
