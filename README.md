# FlightOR 前端 / 新后端 MVP 起点

本分支 `backend-mvp` 从 `codex/ui-experience@060d0de` 提取共享 UI，仅保留微信小程序和 H5 前端、示例数据、资源及本地工具。旧 API、数据库、Worker、云函数和管理后台已移出当前代码树，原件仍在其他分支与 Git 历史中。

这里是可运行的前端交互样稿。规划回复、行程、机票、收藏和提醒使用固定样例或内存状态，不代表真实后端已经跑通。

## 开始开发

本机独立工作区如下；原根目录仍是 main，不要在原目录运行本分支命令。

```powershell
cd D:\FunnyProject\flightor-repo\.worktrees\backend-mvp
git branch --show-current
npm run setup
npm run dev:h5
```

要求 Node 22.21.x、npm 10.x。本机依赖已安装，首次换机器或更新 lockfile 后运行 `npm run setup`，它对根目录和 H5 分别执行 `npm ci`。H5 地址为 http://127.0.0.1:4178，Ctrl+C 结束服务。

另一个终端启动小程序监听：

```powershell
npm run dev:weapp
```

微信开发者工具导入**本工作区根目录**，`miniprogramRoot` 已指向 `dist/weapp/`；也可先 `npm run build:weapp` 再直接导入产物目录。游客 AppID 只供前端预览，登录和真机需后续配置自己的 AppID。

```powershell
npm run check
npm test
npm run build
npm run check:docs
git diff --check
```

H5 产物为 `apps/ui-preview/dist/`，微信产物为 `dist/weapp/`。两端共用 `src/features/ui-experience/`。

环境及验证见 [deploy](docs/deploy.md)，后端接入位置见 [BACKEND_MVP](docs/BACKEND_MVP.md)，开发约定见 [文档入口](docs/README.md)。
