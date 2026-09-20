# ADR 0019：精简 Planner 协议后再评估 Harness

日期：2026-09-20。状态：**分阶段采用：B1/B3–B5 已实施；B2 在默认关闭的开关后实施；G1 待跑通**。B2 已通过专用 PostgreSQL 原子接受、并发和回滚验证；真实 Provider/平台验收待执行，未开启生产。精确契约见 [RUNTIME_PLAN §2–6](../design/budget-travel-agent/RUNTIME_PLAN.md) 与 [验证进度](../design/budget-travel-agent/progress.md)。

## 决策方向

1. 保留当前 runtime，先针对已采用航班的攻略生成精简状态准备、机械记账、候选引用与修复协议。
2. Planner 保持旅行决策权；服务端处理可机械推导的 Run 生命周期、来源映射、保存和完成，不恢复固定业务 DAG。
3. 预装有界有效证据；稳定候选引用替代数组位置；区分草案错误、证据缺失、Provider 故障和版本冲突。
4. 已落盘结果可先展示，最终文本不阻塞卡片；保留真实进度、取消/版本/owner 与部分交付语义。
5. 先跑通 B，再计时、固定多用户案例和质量评估；之后才决定是否试验 DSH C。不同模型/Provider/提示词变化不能混入 Harness 对照。

## 契约与兼容

精确拟议契约、修改围栏见 [RUNTIME_PLAN](../design/budget-travel-agent/RUNTIME_PLAN.md)。执行依赖见 [DPS](../design/budget-travel-agent/DPS.md)，门槛见 [EVALUATION](../design/budget-travel-agent/EVALUATION.md)。不复制协议以免多处漂移。

已同步 TOOLS、权威架构与领域测试。默认旧模式仍公开 Goal 控制工具；B2 显式开启后隐藏 declare/resume/finish，业务工具接受 intent/goalRef，服务端事务保证 Goal/Run 原子性，同轮约束固定。新旧路径共用同一 completion/verifier。B3 在两种模式均支持 candidateRef 和旧索引接口，独立 supportingRefs、服务端预算快照、分类修复与同轮 revision 草稿；持久 guide v1 增加可选 supportingEvidence/budget，历史 Artifact 可读，无数据库迁移。关闭 B2 开关仅回退 Goal 协议，不能去除新数据字段；旧二进制 reader 不保证接受新增字段。采用无状态摘要引用而非候选集合表，保持当前领域权威和 owner/version 检查。完整持久 Turn/攻略 visits v2 和航空范围扩展属于 ADR 0018 后续方向，不作为此次快速路径前置。

DSH 只可能替换通用 runtime 层，不接管 FlightOR 业务状态、用户采用授权或验收权威。未完成同口径评估前不安装生产依赖、不宣布迁移。

B4 扩展 ADR 0015 的临时 transport：领域提交回调发布紧凑引用，GET 投影负责当前版本过滤，客户端按作用域/revision 合并；取消等待服务端确认，已保存结果可浏览与恢复。保存和 Goal 验收仍分开标识，不能把提前可见称为 satisfied。保持原模型/Provider、数据库结构和 UI 视觉，无持久队列重构。

B5 采用服务端每轮 AsyncLocalStorage 诊断与客户端本地有界计时；观测不进入模型上下文、公共 turn 响应或聊天历史。模型/工具/HTTP 保留父子 span 并按区间并集去重；最终出站配置和去敏网关指纹支持后续同口径比较，未知账单不填零。客户端测 effect commit，服务端分别测保存与 satisfied 提交；不跨设备直接相减。失败输出的已知 native 搜索次数也保留，取消/替代后迟到事件不回写。无需新数据库/SDK 或额外模型调用。正式性能、真实 Provider 与 H5/真机体验仍待 G1 及后续批次验证。
