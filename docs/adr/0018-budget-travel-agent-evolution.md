# ADR 0018：低预算航班与个性化旅行闭环演进

- 日期：2026-09-20
- 状态：Proposed，设计提案，未实施；不覆盖现有 Accepted ADR。
- 范围修订：完整旅行能力的后续方向；当前先执行 [ADR 0019](0019-lean-planner-evaluation.md) 的精简与评测，不把持久 Turn/visits v2 设为首轮前置。
- 需求：[RAS](../design/budget-travel-agent/RAS.md)
- 详细设计：[RDS](../design/budget-travel-agent/RDS.md)
- 实施依赖与验收：[DPS](../design/budget-travel-agent/DPS.md)

## 背景

当前 main 已有航班采用、revision 绑定、研究和攻略工具以及正式 UI。最新航班优先验收完成了真实航班选择与恢复，未交付攻略。现有粗粒度日程和单日单城市假设不足以承载到达最终目的地前的中转城市活动；临时进度存于单进程，真实活动缺景点坐标和素材。

## 拟议决策

1. 保留唯一自主 Planner、受限 Research、确定性领域服务与服务器 Goal 校验，不引入固定端到端业务 DAG，也不增加彼此重复的 Agent。
2. 复用现有 Workspace selectedFlight；所有新攻略绑定其 revision、来源 Artifact 和 Trip 版本。维持用户明确采用的默认产品行为。
3. 新建访问窗口领域，攻略 v2 使用每日多个 visits 区分 destination/stopover/airport，统一校验全部航段、城市活动、移动和返场约束。
4. 以已有短轮询 API 为兼容入口，扩展持久 Turn、幂等提交、可取消恢复、事件序号与阶段成果。新增状态不污染 Conversation/Memory。
5. 个性化与成本比较使用结构化 Trip 条件；报价与估计费用分开；只声称已检索范围内的相对低价。
6. 保留既有视觉，通过纯展示适配器接入地点、图文、时间窗口与来源；坐标和照片缺失不使用样例冒充。

## 影响与采用条件

涉及 ADR 0015 的单进程临时任务边界、ADR 0012 的攻略 v1 表达和现有 flight-first 时间校验，需要增量 schema/数据库迁移、v1/v2 reader 并存、旧客户端兼容及并发测试。采用本 ADR 时同步权威架构和工具清单；在此之前不能把拟议接口当作生产 API。

实施先后以当前 DPS 为唯一入口。持久执行、访问窗口与 UI 数据契约在核心交付和性能评估后按需求推进。往返、多目的地和拆票长停留搜索另立决策，不在本 ADR 下默认为已支持。
