# Main UI 清理与同构恢复交接（更新于 2026-09-14）

## 当前结论

旧交接将“删除 AgentChat”和“所有旧视觉已清除”混为一谈。冻结 main `6fe6120` 的 Plan 确实只挂载生产 `PlannerPage`，但 route 的非攻略分支、加载和错误态仍会进入旧暗色容器。问题是生产适配没有收敛，不是 Git 随机覆盖。

恢复实现位于 `codex/ui-parity-recovery`，以 `codex/ui-experience@060d0de` 为只读视觉与交互基准。没有再次整体 merge 原 UI、模型实验或 production-integration，也没有用旧 `src/` 覆盖生产目录。

## 正确工作区与端口

- 恢复工作区：`D:\FunnyProject\flightor-repo\.worktrees\ui-parity-recovery`
- UI 参考工作区：`D:\FunnyProject\flightor-repo\.worktrees\ui-reference`
- 原始脏 main：`D:\FunnyProject\flightor-repo`，不得清理或覆盖
- 微信开发者工具服务端口：`32348`
- `miniprogramRoot`：`dist/`
- 正式构建：`npm run build:weapp`
- 本地后端联调构建：`npm run build:weapp:local`，要求本工作区已有合法的 `backend/.env.demo`
- 微信 UI 证据：`npm run qa:weapp-ui -- <证据目录> 32348`

`32348` 是微信开发者工具服务端口，不是 FlightOR API 端口。正式构建 manifest 当前记录 loopback API，仅适用于本机模拟器诊断，不能证明真机可访问。

## 已完成的有限修复

- route / travel_guide / route_set / flight_search / research / destination 和所有状态统一进入白底、深墨绿、海洋青产品壳，保留各自语义渲染器。
- route 交互改为原生 Button，补齐 44px 触控区、按压反馈、中文文案和来源复制失败反馈。
- productionPresentation 只接入精确保存、精确 context 和精确 routeId 的真实航班；未核验金额不显示。
- Plan 不再把缺图的生产空壳渲染成样例灵感卡。
- Explore 增加横向分类和骨架加载，不使用里斯本图片兜底。
- 登录抽屉、四栏 tab 图标和失败反馈按原 UI 视觉规范收敛。
- 固定里斯本样例资产已退出生产树，在 `060d0de` 参考工作区中仍完整保留。
- 正式构建增加 `dist/build-info.json`，可识别 SHA、dirty 状态和源码指纹。

## 数据边界

活动照片、真实 POI 坐标、结束时间、行程封面、人数和 alternatives 仍缺少正式契约，继续显示同风格空态。不得使用城市中心、固定照片、样例票价或固定人数伪造完整行程。

backend、experiments、认证、存储、版本校验和审计规则均保留。没有重跑付费模型排名或改写生产后端框架。

## 验证与证据

完整矩阵、命令退出码和截图路径见 `docs/UI_PARITY_ACCEPTANCE.md`。

已通过 TypeScript、全套 `npm test`、正式微信构建，以及原 UI 参考、修复前生产基线和修复后生产页面的微信模拟器截图。最终查看时必须核对 `production-after-report.json` 中的 project、build、`miniprogramRoot` 和 failures，不能只看开发者工具标题或旧 dist 时间。

仍未完成微信真机、真实微信登录、横屏 / 平板 / 最大字号 / 屏幕阅读器，以及本轮真实付费规划和航班闭环。不要把模拟器通过写成真机通过。

## 后续合入规则

恢复分支验收前不合入 main。需要合入时使用普通可回滚提交 / PR；不再从三个旧分支整体 merge，不 force push，不删除原脏工作区，不清理 node_modules 目录联接。
