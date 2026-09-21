# ADR 0024：攻略公开结果与预算判断归服务端

2026-09-21，Accepted（用户要求依据独立诊断修正）；实现与验证状态见 [progress](../design/budget-travel-agent/progress.md)。不追认任何旧 G1 样本通过。

## 问题与决定

研究摘要/标题、Planner theme/notes/planningNote 和最终回复均可以绕过可选 claimEvidence。预算约束守恒不能证明预算可行性。保留单一 Planner、引用编排、领域 Goal/verifier 和原始审计记录；增加服务端 `publication.version=1`，统一公开攻略、成功回复和历史恢复。

发布结构在 `saveWorkspaceArtifact` 的 owner/version/source/checkpoint 边界内构建，绑定 artifactId、Trip contextVersion、航班 selection revision，跟原始攻略同次写入。模型不能提交或决定 publication。旧记录缺字段时只读生成保守投影，不回填 verified，不改写原始实验。

发布快照另绑定原始攻略的 SHA-256（排除 publication 自身）；读时错配降级，避免原始条目变更后继续使用旧投影。这是完整性检查，不是数字签名或来源真值证明。

## G1 默认有限展示合同

- Planner 继续决定选择、顺序、时段和研究工具。原始 title/summary/theme/notes/planningNote 留作内部研究与审计，不能直接成为产品说明。
- 显示来源资料标题时明确标作“资料标题”，它是来源引用，不是已核实的场馆身份。引用使用已绑定 finding 的 provider source，不采纳模型生成的 finding.title。
- 为保留可识别去处，可用 finding.title 的有界前缀定位来源 title/正文/搜索摘要中完全相同的文字，显示为“来源条目摘录”，同时注明材料类型和身份未独立核实。算法仅做字面检索，不识别实体、不判断事实真伪；未匹配部分绝不发布，不将搜索摘要冒充正文。无匹配则退到资料标题。来源自己含错误时仍是明确引用，不能转成已验证陈述。
- 有原文快照且 quote/hash/value 匹配、没有当前可识别冲突的 claim，只能作为注明读取时间的来源原文摘录；主体、条件及出行日适用性仍未审查。无证据时显示待核实，不用数字正则判断真值。
- 没有成本账本时 `budgetAssessment.status=undetermined`、小计 null、范围覆盖 incomplete；服务端按保存的预算口径说明目标，不表示费用在预算内。此批不实现完整成本优化器、外汇或人数推断。
- `contentContract=limited` 与 `evidenceCoverage=partial/unknown` 不等于最低有用性已经验收。资料标题可能过于宽泛，必须在冻结案例和后续真实烟测中单独检查；不能将只剩通用占位的攻略计作 G1 成功。
- 新的完整攻略目标可在同批工具结束、所有接触目标都是 travel_guide 且权威完成验证 satisfied 后直接返回服务端确认。混合目标、部分结果、失败、取消或过期不能由保存事件自动结束。
- 历史 assistant 攻略消息读时投影；用户文字原样保留。新前端缺有效发布合同则降级，不回退显示旧自由文本。

## 范围与兼容

v1 Artifact 可选新增 publication，无数据库迁移；原始领域验证依然读取原始攻略，公开 API 返回另一个只读投影。原始材料仍供 Agent 研究，不能将 public 投影误作新的事实证据。航班结构、选择、取消、owner 和 Trip 版本规则不变。来源标题/摘录明确引用允许保留原文，不被宣传为自然语言真值证明。

公开 research Artifact 同样只投影资料标题/安全 URL，不返回模型摘要、原始搜索摘要或正文快照。内部 `artifactReadingContent` 保留完整材料用于研究和审计；不将内部工具响应原样显示为产品卡片。

不增加 critic 或自主 Agent，不换 harness，不增加城市/票价特例。历史未关联 Artifact/Goal 的一般聊天无法可靠按主题分类，不用关键字删除；其范围限制必须在验收报告明确。外部分享/导出若后续新增，必须使用同一公开投影。

## 验证与停止条件

冻结 [G1 发布合同 v1](../design/budget-travel-agent/G1_PUBLICATION_RUBRIC_V1.md)。必须检查用户可见文字，不只断言数据库 satisfied。离线、真实 Provider、H5、微信分别记录；当前搜索额度已满，不由此 ADR 授权新 live。回滚不得恢复无约束模型文字的公开发布，可退到有限旧版提示。
