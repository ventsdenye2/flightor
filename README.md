# FlightOR 双 DSH Agent MVP

本分支 `backend-mvp` 基于 `codex/ui-experience@060d0de` 的微信/H5共享UI，新增最小 Node 后端：两个独立的完整 DSH 分别规划、审核整理，然后直接映射到现有行程页。MVP不设业务验收门槛或审核否决。未恢复旧 API、数据库、Worker、云函数或管理后台。

规划输入现在连接本机真实后端；航班需求由 DSH 调用 `trip-flight-tool` CLI。探索、独立航班搜索页、收藏和提醒仍为前端样例/内存交互，不代表全部业务已实现。

## 开始开发

直接在原仓库目录开发，当前分支应为 `backend-mvp`。

```powershell
cd D:\FunnyProject\flightor-repo
git branch --show-current
npm run setup
npm run backend:setup
# 终端一
npm run backend:start
# 终端二
npm run dev:h5
```

前端及API使用 Node 22.21.x、npm 10.x；DSH子进程使用复制的桌面配套 Node 24。`backend:setup` 从本机已安装桌面 DSH 提取副本并生成隔离 profile；不修改原安装和默认插件。不复制密钥，凭证插件引用原 `~/.dsh/.credentials.yaml`，沿用桌面 deepseek-account / deepseek-flash 路由。H5：http://127.0.0.1:4178；API：http://127.0.0.1:3000。

另一个终端启动小程序监听：

```powershell
npm run dev:weapp
```

微信开发者工具导入**本工作区根目录**，`miniprogramRoot` 已指向 `dist/weapp/`；也可先 `npm run build:weapp` 再直接导入产物目录。游客 AppID 只供前端预览，登录和真机需后续配置自己的 AppID。

```powershell
npm run check
npm test
npm run backend:test
npm run build
npm run check:docs
git diff --check
```

H5 产物为 `apps/ui-preview/dist/`，微信产物为 `dist/weapp/`。两端共用 `src/features/ui-experience/`。

架构、失败记录和真实验证见 [DSH_MVP](docs/DSH_MVP.md)，命令及环境见 [deploy](docs/deploy.md)。本地MVP尚无业务登录与多用户隔离，API仅绑定loopback；不等于生产部署或微信真机验收。
