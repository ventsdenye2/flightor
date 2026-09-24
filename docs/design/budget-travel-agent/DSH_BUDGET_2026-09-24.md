# DSH 本批调用预算账本（2026-09-24）

状态：`backend/src/agent/dsh/budget.ts` 与离线文件系统测试已实现。该模块不发网络请求，不读取 API Key，也不构成真实调用授权。配置凭证与用户明确授权的本批金额/次数是不同前置；历史额度不能作为本批授权。worker/service 的实际接线及真实调用结果由本轮总报告记录。

## 接口与预留

`new FileDshBudget({ path, authorizedUsd, maxModelCalls, maxSearchCalls, modelReserveUsd?, searchReserveUsd? })` 使用本批固定账本路径。默认单模型预留 US$0.04、单搜索预留 US$0.08，是调用前的预算预留，不是供应商报价或已知费用。金额以整数微美元存储，输入不足一微美元时向上取整；零金额授权可读取空账本但不能准入任何调用，预留必须为正。

执行器必须先 `await admit(kind, id, provider)` 成功，再发对应请求。kind 为 model/search，id 为稳定且有界的请求标识，provider 为声明的真实路由。官方联网固定名称 `deepseek-official`：search 准入同时消耗一次 model、一次 search，默认合计预留 US$0.12；任一次数或金额不足都在出站前拒绝。其他 search 消耗一次 search，普通 model 消耗一次 model。不得把其他搜索成功标成官方成功。

本批用户已明确授权 US$2、48 次模型与 12 次搜索（含失败）；达到任意一个正数次数上限后，两条付费路由均停止新准入，不继续耗用另一类剩余额度。通用配置的零搜索上限只禁用搜索，允许独立模型运行。worker 通过私有计量 IPC 在实际 HTTP 前准入，模型 usage 输入数包含 cache read/write，未知实际费用继续预留。

同 id、kind、provider 返回原始持久准入，不再重复记账；同 id 改种类或供应商被拒绝。此幂等仅适用于账本记录，执行器仍须保证请求重放不会再次实际出站。失败、取消、超时仍保留已准入的调用次数。模型和官方搜索的计数必须避免对同一次官方请求重复另记一个 model admission。

`settle(id, { durationMs, usage?, actualCostUsd?, errorCode? })` 仅接受结构化白名单：usage 的 promptTokens/completionTokens/totalTokens 为非负整数，errorCode 为有界大写错误码，不接受原始提示词、Key、错误消息、网页正文或供应商完整响应。只有真实货币回执才能填 actualCostUsd；仅有 token 用量不能按本地费率伪造已知账单。没有可靠货币回执时继续占用原预留，即使请求失败或 token 数为零也不会释放。已知费用按真实金额记录，包括超过预留或授权总額的回执，后续请求据实际累计占用拒绝。

settle 对完全相同的重复回执幂等，冲突回执拒绝覆盖。现阶段不提供事后替换未知回执的接口，未知预留保守保留；不能用新的零费用回执清空旧未知收费。

`readSnapshot()` 返回持久 entries、原始授权、modelCalls/searchCalls、knownCostUsdMicros、unknownReservedUsdMicros、consumedUsdMicros、remainingUsdMicros、unknownCostCalls、pendingCalls、overBudget。known 与 unknown 明确分列，未知不报告为零成本；日志和交付应直接使用此快照，不按本次进程重算零起点。

## 持久、并发与恢复边界

同实例的操作以 Promise 队列串行；每次文件事务还以 `<ledger>.lock` 的独占创建保护，锁包含版本、随机 token、PID、主机和时间。存在的有效锁、未写完或损坏的锁一律拒绝，不轮询重试、不猜测进程已死、不自动删除旧锁。结束时只删除仍带本事务 token 的锁。进程崩溃留下的锁需要操作者核对进程/主机后处理；这是单主机文件系统围栏，不宣称提供跨主机分布式租约。

账本先写同目录临时文件并 fsync，再 rename 替换，admit 仅在持久写成功后返回。坏 JSON、未知 schema、重复 id、与固定预留不符、缺失 receipt 对应时间或超调用数的历史都拒绝，不重置为空。重新构造相同路径实例读取累计记录。已存在账本的金额、次数和两个预留值必须与构造配置完全相同；新增或不同的授权配置不能覆盖旧批次，也不能回滚计数。此模块没有改变既有批次授权的操作。

账本路径是调用者可信配置：必须沿用本批路径，不能换路径、删除文件或新建目录以重置消费。文件模式请求0600，实际访问权限仍取决于主机文件系统/ACL。原子文件替换不等于数据库事务或磁盘硬件掉电保证；没有自动购买、续费、无限重试或清空历史功能。

## 本次验证

- `npm run check`：通过。
- `npm test -- src/agent/dsh/budget.test.ts`：17/17，通过，Vitest 1.60 秒。全部在系统临时目录使用隔离账本，测试后清理对应临时目录，没有外部请求。
- 覆盖预留先持久、reload 累计、token 不冒充确知费用、官方 model/search 双计数与双预留、金额/两类次数上限、失败保留次数/未知费、真实超额回执、同实例并发与 id/receipt 幂等、不同授权禁止覆盖、有效/损坏锁拒绝且保留、并发不同授权只有一个写入成功、损坏历史不重置、拒绝原始 prompt/Key 字段。

本子任务真实模型/搜索调用为0，不代表 DSH 真实链路已通过，也不改变 G1 状态。
