# 对话规划 MVP 验收状态

更新时间：2026-09-08。当前代码基于 `9670ca9`，本轮改动尚未提交。

## 当前实现

- Planner 自主选择、跳过、重排和复用领域工具；没有规定 discovery → research → guide 的固定流程。
- `get_active_goal` 只读，`resume_goal` 显式继续旧目标；地点输入由服务端根据可信 ID 恢复权威字段。
- `finish_goal`、回合收尾和后台任务共用领域校验。`completed` 只对应服务端 `delivery.satisfied`；普通回应为 `responded`。机票日期、逐日覆盖、地点、来源、版本和证据有效期均参与判定。
- Goal/Goal run 原子提交。后台 job 终态可重放 Goal 协调，供应商工作不因该协调重试而重复。
- Artifact workspace 冻结当前版本并校验来源；运行期间改条件或取消会阻止后续写入。旧产物保留历史读取能力。
- 小程序保留登录前草稿，统一刷新 token 和一次 401 重试；对话启动路线后通过 workspace GET 接入现有轮询。客户端只采纳服务端 delivery。
- 首次登录的发送占用与会话展示状态分离，避免重复 bootstrap；机场时间使用服务端统一投影并标明时区。
- 研究增加有界短检索词规划，最多 8 次检索、并发 2；规划、检索与综合共享取消信号。

## 本轮证据

| 范围 | 已观察结果 |
| --- | --- |
| 后端 | 最终普通回归 81 suites / 514 tests 通过；5 suites / 26 项 PostgreSQL 集成测试单独通过，合计 540 项；TypeScript 构建通过 |
| 前端 | 最终完整 npm test、TypeScript 通过；真实模式 weapp 构建已通过。最后的登录发送占用修复通过测试和类型检查，未再次构建 |
| 数据库 | PostgreSQL 16.15 独立临时实例，127.0.0.1:55439；flightor_demo/test 已创建，demo 的 001–011 迁移全部成功 |
| API / Worker | 本地 API health/ready 返回 postgres=ok、redis=disabled_local；Worker 已启动 |
| 真实对话与机票 | 地点 ID 边界修复后，新会话 5.9 秒记录条件；真实航班搜索 11.3 秒完成并保存 flight_search，13 个报价，服务端 delivery=satisfied |
| 真实路线与恢复 | 对话触发去程路线生成成功，保存 2 个有价比较方案；选择保存、workspace 恢复及服务端 delivery 校验通过。报价为本轮 02:18 UTC 的快照 |
| 完整攻略 | 尚未通过。最新研究实际成功耗时约 80 秒；TravelGuide 已保存，但混入无旅行日期的旧研究且超过 Goal.maxResults，delivery=partial；整轮 150 秒超时。未降低验收条件或把 partial 当成功 |
| 微信登录 / 真机 | 未验收：WX_SECRET 未配置；测试脚本使用独立数据库中的随机开发身份，不覆盖微信 code 交换 |

用户于本轮要求总结并结束，实施与后续诊断已停止，未提交 Git。完整攻略必须实际保存 TravelGuide，五天均有符合来源和约束的内容，服务端交付状态为 satisfied。

下一步应统一攻略组合与 Goal 的日期、研究类别及条目上限契约，使 builder 能在既有证据中选择合适条目，然后再跑真实验收。该方案尚未实施；研究耗时和整轮预算也需要验证。关键交付路径已收敛，本轮未进行全仓历史补丁清理。

保留证据：`backend/.demo/e2e-guide-pending-20260908.json` 含真实机票/路线通过与首次攻略失败；`e2e-guide-before-query-planner-20260908.json` 保留上轮部分结果；`e2e-evidence.json` 为最终 partial/timeout 结果。文件均在忽略目录，session 文件含 token，不提交。

## 本地运行

数据库需先监听 `backend/.env.demo` 中的地址。该文件已忽略，密钥不写入验收记录。当前独立 PostgreSQL 位于系统临时目录，未安装系统服务；主机重启后需重新启动。

```powershell
npm --prefix backend run build
# backend 目录内，应用演示数据库迁移
cd backend
node --env-file=.env.demo dist/db/migrate.js
cd ..
npm --prefix backend run demo:api
# 第二终端
npm --prefix backend run demo:worker
# 第三终端
Invoke-RestMethod http://127.0.0.1:3000/health/ready
npm --prefix backend run demo:e2e -- --with-guide --conversational-route
```

E2E 写入独立 flightor_demo，结果为 `backend/.demo/e2e-evidence.json`；session 文件含开发 token，不提交。重复启动服务前检查已有进程。

```powershell
$env:FLIGHTOR_USE_MOCK = 'false'
$env:FLIGHTOR_API_BASE_URL = 'http://127.0.0.1:3000'
npm run build:weapp
```

开发者工具导入仓库 `project.config.json`。真实微信登录需要在 `backend/.env` 或演示环境覆盖中配置 `WX_SECRET` 并重启 API；手机访问还需要可达 HTTPS API。构建通过不代表微信运行验收通过。本轮未部署公网服务。

## 范围与限制

当前最终航线引擎支持单起点、单目的地、去程；多城市、往返和地面交通组合仍明确不支持。攻略验证器覆盖结构化约束及来源，不能证明任意自由文本问题的全部语义均已回答。过期或无版本来源不作为当前交付成功证据。
