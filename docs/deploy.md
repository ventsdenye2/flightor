# 本地双端开发环境

更新：2026-10-19。当前使用新增双 DSH Agent 后端，不启动旧后端或 Docker。

## 2026-10-26 机票浏览器Worker

先执行`npm --prefix trip-flight-tool run build`，再启动空闲后端`npm run backend:start`。后端自动启动随机本机端口的单并发浏览器Worker；手动API和DSH工具直连复用，不新增凭据文件。Worker连接地址和随机认证令牌仅在后端及其子进程环境中传递，不放进前端或日志。独立CLI未继承Worker环境时仍使用单次进程模式，不能用其详情耗时代表常驻路径。`FLIGHTOR_FLIGHT_WORKER=0`可关闭Worker做对照；性能开关和已验证范围见[航班选项](FLIGHT_OPTIONS.md)。正常退出后端会取消在途查询、保存有效登录状态并清理浏览器；空闲10分钟也释放浏览器。

本轮真实回归反复捕获Windows文件替换的瞬时`EPERM`，会影响对话/选票和提交状态保存。相关原子rename对Windows的EPERM/EACCES/EBUSY最多额外等待10/20/40/80ms后重试（累计150ms），只重试替换，不重复写入、模型或业务操作；持久权限/磁盘错误仍失败。聊天/审核结构化协议及补正次数不变。该修复范围由实测文件错误触发，不将失败测试直接忽略。

## 2026-10-25 微信适配入口

用户已选择“寰宇咨询” AppID `wxdf9ff3c30a1d9549`，根项目和 `config/project.ui-experience.json` 使用该值；独立产物配置由构建脚本沿用根项目 AppID，不再固定覆盖为游客。下文“游客 AppID”是历史记录。36556 为当前开发者工具 HTTP 服务端口，3000 才是业务 API。执行 `npm run build:weapp` 后导入本仓库根目录，或导入 `dist/weapp/`；默认进入正式规划入口，调试场景通过 `pages/index/index?preview=1` 开启。平台差异、请求域名和本次验证见 [微信适配](WECHAT_ADAPTATION.md)。

景点服务的离线数据下载/重建见 [PlaceResolver](PLACE_RESOLVER.md)。Enterprise 凭证仅放忽略的 `backend/.env`，`npm run backend:start` 自动读取；模板为 `backend/.env.example`。保存 username、access/id/refresh token，API 只使用 access token；到期前按需刷新并原子更新后端文件，不向前端/日志公开。环境修改后重启后端。没有 Enterprise 凭证也可使用离线坐标及公开 Wikimedia 接口。

## 2026-10-20 手动查询入口

规划页机票表单调用本地 `/api/flights/search`，需要重启空闲API以载入新路由，沿用3000端口和任务轮询/取消；H5仍为4178。后端先校验查询参数，再复用原CLI，不调用DSH或模型，不自动生成行程。两端调用均由createConversationClient提供，无新增前端环境变量或凭证。

## 2026-10-20 往返工具更新

更新后先执行 `npm --prefix trip-flight-tool run build` 生成新CLI，再启动/重启空闲的后端API。后端插件直接使用该CLI；仅重建H5不会更新工具。`npm run check` 和 `npm run build` 继续检查H5/微信共享卡片。独立MCP进程须重启以读取新tripType/returnDate schema；单程调用省略新字段保持兼容。启动不自动查询供应商或模型。

## 当前双 Agent 环境

原仓库目录 `D:\FunnyProject\flightor-repo`，分支 `backend-mvp`。前端/API使用现有Node22；DSH使用已复制桌面包0.2.1-rc.2及其配套Node24。安装桌面DSH且已登录后执行：

```powershell
npm run setup
npm run backend:setup
# 终端一
npm run backend:start
# 终端二
npm run dev:h5
# 需要微信时，另一个终端
npm run dev:weapp
```

`backend:setup`安装后端锁定依赖、首次复制桌面DSH完整分发包并生成隔离profile；已有副本不覆盖。API为127.0.0.1:3000，H5为127.0.0.1:4178。小程序storage的`flightor-api-base-url`可覆盖默认loopback；真机需可访问地址和合法域名，当前API仅loopback不开放公网。`npm run backend:live`运行真实两天样本，两个DSH各产出一次，无业务验收和自动返工；会使用当前DSH账户。

本地包、会话、原始工具证据和结果分别在忽略的backend/.dsh-runtime、.dsh-home和data中。凭证只引用原用户DSH凭证存储，不复制到项目。不要提交或分享本地会话、账户数据和trip-flight-tool/.auth。来源字段保持unverified，显示成功不升级为事实全验。

具体真实样本与失败见[DSH_MVP](DSH_MVP.md)。下面保留前端初始化时的历史记录，不能替代本轮后端/H5验收。

## 历史：前端基线初始化

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

## 景点补全预算

后台默认地点补全预算为首次批量调用的景点数×2000+5000毫秒，例如16景点37000毫秒；按活动ID计数，不按字段数计数。可选环境变量 `FLIGHTOR_PLACE_BUDGET_MS` 配置于被忽略的 `backend/.env`，用于显式覆盖为固定毫秒数（沿用原120000毫秒上限），未设置/无效时使用动态公式，动态公式不套用该固定覆盖上限。审核工具首次调用开始共享预算，后续修正/恢复账本不重置；预算到期携带已查到字段发布。旧行程不会自动补查。重启后端后生效。Enterprise 凭证仍仅在后端环境读取。详细链路与验收见 [批量补全](PLACE_LOOKUP_BATCH.md)。
