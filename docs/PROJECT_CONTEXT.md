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

用户随后要求直接在原目录切换分支，并明确舍弃原 main 的未提交文件。本机开发目录改为 `D:\FunnyProject\flightor-repo`，当前分支为 `backend-mvp`。本轮临时工作树在切换后移除，不保留为开发入口；其他原有工作树不动。原 main 的两份微信配置改动与当前可见未跟踪目录按用户要求舍弃。忽略的本地依赖、密钥和构建缓存不视作可随意删除的未提交源码。未自动合并或推送。

原目录中旧 main 忽略的 backend/cloud/tools 和旧构建产物已收拢到忽略目录 `output/legacy-main-local-20261019/`，其中可能含旧本地配置与凭证，不要加入 Git 或分享。它不参与新前端运行，也不是新后端实现。

本轮环境和验证记录见 [deploy](deploy.md)。新后端尚未开发，构建与样例交互不能记为真实 MVP 闭环。
