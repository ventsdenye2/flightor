# 本地双端开发环境

更新：2026-10-19。本分支只准备前端环境，不启动旧后端或 Docker。

## 安装与启动

本机使用 Node 22.21.0、npm 10.9.4。`.nvmrc` 提示 22.21.0，package engines 与 `.npmrc` 要求 Node >=22.21.0 <23、npm 10.x；不会自动切换系统 Node。

```powershell
cd D:\FunnyProject\flightor-repo
npm run setup
npm run dev:h5
```

根目录与 H5 各有 lockfile 和独立 node_modules，不借用其他工作区依赖。不需要业务 `.env` 或数据库。H5 固定 loopback http://127.0.0.1:4178，strictPort 使端口占用明确失败。样例切换面板用于检查多种展示状态。

```powershell
npm run build:h5
npm run build:weapp
npm run dev:weapp
```

H5 输出 `apps/ui-preview/dist/`，微信输出 `dist/weapp/`。微信开发者工具导入 `D:\FunnyProject\flightor-repo` 或微信产物目录；两处 project.config 使用游客 AppID。不要导入旧 main 的 dist 根产物。

真实微信登录需自己的 AppID，业务 API 后续配置可从设备访问的地址与 request 合法域名。手机上的 127.0.0.1 指手机自身。当前未配置认证或关闭域名校验。

## 验证

```powershell
npm run check
npm test
npm run build
npm run check:docs
git diff --check
```

## 2026-10-19 本机验证结果

| 检查 | 结果与边界 |
| --- | --- |
| 依赖安装 | 两份 lockfile 的 npm ci 均成功；根目录 1386 包、H5 28 包，各自独立安装 |
| 类型 | `npm run check` 双端通过 |
| 展示数据回归 | `npm test`：12 项行程边界、14 项航班/探索检查，共 26 项通过；无业务网络 |
| H5 构建 | `npm run build:h5` 通过，Vite 8.3.0；保留原 lockfile 版本，没有升级框架 |
| 微信构建 | `npm run build:weapp` 通过，Taro 3.6.40；产物 AppID 为 touristappid，根配置指向 dist/weapp，产物配置指向 ./ |
| H5 浏览器 | Chrome，http://127.0.0.1:4178/，标题 FlightOR · 界面预览；1440×1000 首屏和 390×844 行程详情均有实际内容，无框架错误遮罩 |
| 交互 | 输入“北京出发，想去京都玩三天” → 查看行程示例 → 明确标注的里斯本固定参考 → 打开行程详情。页面保留输入并说明未按输入生成，没有伪装真实规划 |
| 控制台 | 初次发现 favicon.ico 404，补充本地 SVG favicon 后重载；最终错误 0、警告 0 |
| 文档/Git | 相对链接、同批 docs 同步与 diff 空白检查通过；提交前另检查暂存批次 |
| 未验证 | 微信模拟器/真机、地图瓦片、认证、业务 API、真实规划、持久化及线上部署 |

浏览器自动化使用 Playwright CLI；当前会话未提供 Browser plugin。沙箱内 Chrome 因 crashpad 退出，在隔离的沙箱外浏览器中完成上述检查。截图保存在本机 Codex visualization 目录（desktop.png、mobile-trip.png），不提交进产品代码。

保留的工具链警告：Taro 缺少可选全局配置提示；两张原有图片超过 webpack 建议的 244 KiB、无异步分包建议；npm 提示部分旧 Taro 间接依赖已弃用。这些不影响本次构建，不代表已完成依赖安全审计。未为本次拆分升级 Taro 或改写 UI。

后续修改仍须重新执行与改动相关的验证；前端检查通过不等于后端 MVP 或小程序真机通过。

## 改用原仓库目录

用户要求取消本轮临时工作树，直接在 `D:\FunnyProject\flightor-repo` 切换到 `backend-mvp`，并明确舍弃旧 main 的未提交文件。依赖与产物需要在原目录重新安装/生成，不能继续引用已移除工作树中的 node_modules。原目录第一次沙箱内 `npm run setup` 遇到既有 node_modules 的 EPERM；后续安装和复验结果在本段追加，不把迁移前的构建冒充原目录复验。

原目录最终复验：沙箱外重跑 `npm run setup` 成功；`npm run check`、26 项 `npm test`、docs 校验再次通过。`npm run build` 两端均成功（H5 1.07 秒、微信 11.96 秒），完整日志在忽略的 `output/backend-mvp-root-build.log`。从原目录执行 `npm run dev:h5`，4178 服务启动成功；独立 Chrome 再次打开正确标题/规划首屏，控制台错误与警告均为 0。迁移前 1440×1000 / 390×844 的交互与截图证据仍对应相同前端源码；没有据此追认微信模拟器/真机或真实后端能力。

本轮临时工作树已注销且目录已删除；保留其他原有工作树。原 main 的两份配置改动和当时可见的 `.claude/`、`docs/releases/`、`output/packages/` 已按用户要求舍弃，未创建 stash。旧 main 原本忽略的本地后端配置/凭证、依赖和旧构建产物另收拢在 `output/legacy-main-local-20261019/`，不参与当前运行，不提交。
