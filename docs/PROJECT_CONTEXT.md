# 当前上下文：前端基线

更新：2026-10-19。

## 当前实现

- 小程序入口：`apps/ui-preview/taro-entry/`，Taro 3.6 / React。
- H5 入口：`apps/ui-preview/src/main.tsx`，Vite / React。
- 共享 UI、展示类型和样例：`src/features/ui-experience/`。
- 图片、图标和来源记录：`src/assets/ui-experience/`。
- 样例覆盖规划、航班搜索、探索、行程、收藏、提醒与个人页。业务状态仅在内存，刷新重置，不是服务端持久化。

## 边界

没有旧 API、数据库、Worker、云函数、管理后台或 Provider 凭证。没有真实登录、AI 规划、航班查询或自动价格监控。规划页约 1.1 秒延时只打开固定样例，不是任务进度。

默认不调用业务 API；H5 地图会请求 OpenStreetMap 瓦片，小程序使用微信地图组件。地图网络、登录和真机表现需单独验收。

## 分支与工作区

`backend-mvp` 从 `codex/ui-experience@060d0de` 创建。只清理新分支代码树，Git 祖先仍含旧实现。

本机目录为 `D:\FunnyProject\flightor-repo\.worktrees\backend-mvp`。原根目录 main 的两份微信 project 配置及未跟踪文件不属于本批，继续保留。未自动合并或推送。

本轮环境和验证记录见 [deploy](deploy.md)。新后端尚未开发，构建与样例交互不能记为真实 MVP 闭环。
