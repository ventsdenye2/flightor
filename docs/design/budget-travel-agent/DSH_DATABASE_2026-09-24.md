# DSH 独立持久 PostgreSQL 验证环境

2026-09-24。本轮用户已要求离线及数据库测试；这里只描述新建的测试环境与真实运行证据，不是生产迁移或 G1 放行。

## 诊断与替代路径

- 原 backend `.env`、`.env.demo` 和历史验收端口的 loopback 5432、55439、63432 均 ECONNREFUSED。
- Docker Desktop 与 `com.docker.backend` 已有进程；`com.docker.service` 为 Stopped。只执行一次 `docker info`，20 秒超时。未重启 Docker/WSL、未启动第二个 Desktop、未停止任何旧进程，也未创建/删除旧容器或卷。
- PATH 与常见 Program Files/LocalAppData 安装位置没有独立 PostgreSQL。查询 npm 小型元数据确认有 Windows x64 二进制，随后只安装一次精确 `@embedded-postgres/windows-x64@18.4.0-beta.17`，包展开 109,333,174 字节；`--ignore-scripts --fetch-retries=0 --fetch-timeout=30000 --no-audit --no-fund`，29 秒完成。只改忽略的测试目录，不改产品依赖或系统安装。

## 已创建的本轮资产

| 项目 | 实际值 |
| --- | --- |
| 数据库 | PostgreSQL 18.4，Windows x64，非 mock |
| 监听 | `127.0.0.1:58789`，新建时通过 loopback 临时 socket 选空闲端口 |
| 独立 database | `flightor_dsh_validation` |
| 二进制/manifest | `backend/.demo/dsh-postgres-20260924/` |
| 持久 PGDATA | `backend/.demo/dsh-postgres-20260924/data/`；普通磁盘目录，不使用 tmpfs |
| 日志 | `backend/.demo/dsh-postgres-20260924/postgres.log` |
| 凭证交接 | 忽略的 `backend/.demo/dsh-db-env.json`，含 `TEST_DATABASE_URL`、`PLACES_TEST_DATABASE_URL`；不得提交或输出其内容 |
| 初始进程 | postmaster PID 33724，实际运行时以本轮 PGDATA 的 `postmaster.pid` 为准 |
| 认证 | 随机独立密码，全部有效 pg_hba 规则为 `scram-sha-256` |
| 权限 | 真实连接查询确认可创建隔离 schema |
| Docker 资产 | 无新建 container/volume；没有触碰既有资产 |

`initdb` 与 `pg_ctl start` 只执行一次。日志在 20:30:08 CST 确认服务可接受连接，但 Node `execFileSync` 启动包装器因 Windows 后代继承管道而在 30 秒报 ETIMEDOUT（捕获的 pg_ctl exit status 为 0，stdout 为 server started）。没有据此再次启动。因包装器异常发生在凭证交接前，只对新建空测试集群短暂增加限定 postgres database、专用 role 与 127.0.0.1/32 的 bootstrap 规则，更新随机密码并创建独立 database；finally 恢复原 pg_hba、reload，之后以新密码实际连接成功。复查全部 6 条有效规则均 SCRAM，无 trust 残留。后续控制命令应使用无继承管道的隐藏进程，避免重复此包装器问题。

## 使用与验收隔离

从 backend 目录将 JSON 的 `TEST_DATABASE_URL` 仅赋给当前进程环境再运行 `npm run test:db`。URL 指向本轮 base database，没有固定 search_path。既有 Vitest DB 套件每项新建自己的随机 schema，并只删除自己创建的 schema；`maxWorkers: 1`、`fileParallelism: false`，不并行迁移共享表。

DSH 实测可以在同一新库建立独立 `dsh_live_20260924` schema 并保留，使用 PostgreSQL connection options 的 `search_path` 限定范围；不能重用或覆盖历史业务/验收库。真实模型调用仍需另外满足本轮预算和凭证准入，拥有数据库不代表获得新的调用额度。

本轮基础 `npm run test:db` 实际执行：8 文件 39 项，37 通过、2 失败，40.27 秒。通过 cloud-state、publication 原样本副本、discovery、Goal、route-generation、native research ledger、artifacts 的真实 PostgreSQL 套件。`workspaces/postgres.integration.test.ts` 两个 legacy 攻略 fixture 在第132行断言 `model.complete` 一次，实际两次（自备机票/已选航班相同）；保留失败，不因环境已可用而宣布所有数据库回归通过。环境任务不修改该业务测试，交给发布/legacy 对照回归处理。

后续诊断确认这两项是9月22日有界终稿引入后遗留的陈旧fixture/断言，不是此次DSH回归：`origin/main`已经在领域保存后调用GuideFinalizer，但测试仍期望只有Planner一次工具决策，并把第二个mock写成runtime自然语言recap；该mock读取不存在的data.completion而在终稿阶段抛错。经主任务授权，测试第二个mock改为根据固定攻略身份返回合法FinalText，并验证无工具权限、JSON schema、无tool对话recap；总调用严格为Planner一次+有界编辑一次，publication必须accepted，回复来自接纳终稿。没有改变legacy产品逻辑或降低断言。

修正后执行 `npm run test:db -- src/workspaces/postgres.integration.test.ts`：1文件2项通过，12.90秒（测试体2.606秒，自备机票840ms、已选航班422ms）；验证真实PG保存、owner隔离、workspace独立重读、航班绑定、publication accepted。此为最终代码的定向重跑，不能冒称全量8文件39项已重新执行；上面的37/39初次失败证据保留。没有真实模型/搜索调用。

## DSH 官方 worker 的持久多轮回归

新增 `backend/src/agent/dsh/postgres.integration.test.ts`，调用真实 `DshPlannerService`、官方核心 worker/AgentLoop 与 PostgreSQL Trip、Conversation、Artifact、Memory、Goal、Run、Workspace repositories。每次新建 `dsh_dialogue_<pid>_<timestamp>` 隔离 schema，finally 只删除本测试 schema，worker session 写入本测试临时目录；不触碰 `dsh_live_20260924`。模型输出为明确本地 fixture，来源为标记的研究 fixture，不是官方联网成功或内容真实性证明。

五个阶段覆盖：两天自备机票攻略一轮组合发布；解释第二天上午且 Trip/Artifact/Goal/Run 深比较零写入；关闭并重建 worker 后只替换第二天下午，逐项断言第一天、第二天上午及接纳展示文字不变；两天合计预算从1500改1200且 Trip version 递增；再次冷恢复读取当前预算，并对真实 JWT `GET /v1/artifacts/:id`、`GET /v1/trips/:id` 及独立 Workspace repository 刷新进行只读检查。两个 Goal Run 必须由真实领域 verifier 达到 satisfied，首次发布 variant 必须 accepted 且 finalizer observation.calls=0。硬 spy 验证旧 CloudPlannerService.runTurn、旧 AgentRuntime.run、独立 ResearchAgent 与独立 Finalizer 均未调用。

旧版本攻略和研究不能作为当前 workspace 输入复用，必须抛 `ARTIFACT_CONTEXT_VERSION_MISMATCH`；旧攻略 HTTP GET 必须投影为 blocked/stale。历史 Goal satisfied 快照保留历史语义，但历史攻略消息正文替换为当前语言的 pending 提示，不能继续展示旧版本接纳回复。GET/刷新前后领域状态不变且没有 sessions.run 调用；非 owner 无法读取攻略或 workspace。

实际定向执行 `npm run test:db -- src/agent/dsh/postgres.integration.test.ts`：1文件1项（五阶段多轮及读写边界）通过，9.20秒，测试体3.357秒，含迁移/收尾4.428秒。前两次本测试开发运行失败分别为测试 fixture 误用 contentHash 字段、把历史 Goal 状态误当当前 publication 状态；仅修正测试后通过，没有修改产品逻辑。此为新增 DSH 套件的定向验证，不能替代全量数据库重跑。

模型均为本地测试 fixture；创建环境与数据库测试没有真实模型/搜索调用，已知费用 0。此结果不替代真实 Provider 或 G1 内容验收。

## 停止和保留数据

当前保持数据库运行供本轮后续测试使用，不自动删除数据目录、安装目录或凭证。需要停止时先从本轮 manifest 确认 pgCtl 路径、PGDATA 及 `postmaster.pid`，再只停止此集群；不得用 `Stop-Process postgres` 或 Docker 全局清理。

```powershell
# 在本工作树 backend 目录执行；不会输出密码。
$dshDb = Get-Content .demo/dsh-db-env.json -Raw | ConvertFrom-Json
$dshData = [IO.Path]::GetFullPath($dshDb.dataDirectory)
$dshExpected = [IO.Path]::GetFullPath((Join-Path $PWD '.demo/dsh-postgres-20260924/data'))
if ($dshData -ne $dshExpected) { throw 'Unexpected PGDATA; stop and inspect' }
Get-Content (Join-Path $dshData 'postmaster.pid') -TotalCount 1
Start-Process -FilePath $dshDb.pgCtl -ArgumentList @('-D', ('"{0}"' -f $dshData), '-m', 'fast', '-w', '-t', '20', 'stop') -WindowStyle Hidden -Wait
```

停止命令未在本次交付前执行。它保留磁盘数据；本轮不提供或执行递归删除命令。机器重启后此进程不会自动作为系统服务启动，持久数据仍留在明确目录。
