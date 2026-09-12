# ADR 0016: 可选择的原生联网研究与真实界面集成

Status: accepted for implementation, 2026-09-13. 用户确认继续接口联调与真实行程闭环；实验结论不直接构成生产切换验收。

## Decision

1. 保留唯一 Planner 编排层及现有 Goal/Trip/Artifact 事实与完成边界。cloud Planner 的 ResearchAgent 可通过明确配置选择既有 SerpApi 综合或原生联网 Provider；默认保持既有实现。Discovery 及机票引擎不在本次替换范围。
2. Research 只接收目标、日期、问题与必要偏好，不继承完整 Conversation。现有 v2 研究 artifact 增加可选 typed disposition/uncertainties 与审计引用；旧 artifact 可读。澄清不变成推荐，片段不能升级 verified，来源资格和完成要求不放宽。
3. 原生研究 transport 单次请求，明确模型、工具/token 上限和取消信号，完整保留 annotations、finishReason、搜索次数与计费回执；未知字段不按零推断，不增加模型格式修复重试。首批候选为已实测可用的 Qwen/GLM，不推导 Planner 模型排名。
4. 审计与货币准入属于服务端基础设施。每次研究分配独立 generation ID（同一 request 可有多次研究），按 owner/request/Trip/Goal/Run 记录；调用前在独立预算记录原子预留，已知费用结算，未知/超时费用保留预留，默认未配置预算禁止原生调用。Runtime costUnits 不是美元预算。预算记录不得由切换用户或重复请求重置。
5. Provider 不保存业务 artifact。来源研究通过现有 workspace 保存时，在同一数据库事务关联最终 artifact 与生成审计，核验 owner/请求/Trip/Goal/Run/版本；取消或版本变化不得留下已交付审计假象。原始审计即使没有成功交付也保留。
6. 新 UI 通过纯转换函数消费真实 Workspace/Artifact，再使用现有认证、会话、轮询和保存服务。样例入口独立保留；真实页面不使用样例活动、照片、票价或本地计时器模拟成功。首轮日程详情只读，调整入口返回同一 Trip 的真实规划记录；直接局部调整和通用对话取消仍待实现/验收。后续活动调整须通过真实命令并用新的领域快照更新，未知值、来源和部分状态保持可见。

## Acceptance

先检查领域/转换/取消测试及独立 PostgreSQL 实测，再在当前授权费用剩余额度内进行少量真实 Planner 请求。必须区分从空白对话的真实交付、预置条件脚本、离线录制回放和合成测试。重新打开应恢复同一已保存结果；修改/取消/换账号不得接收过期写入。

本次完成标志是经过服务端确认、可保存恢复的真实规划界面链路；数据库跳过、模拟器事件映射、原生地图空白或模型文字不能替代对应验收。真实微信登录、手机可达 API、底图/图钉点按与真机键盘/安全区分别记录证据；尚未取得的设备证据保持未验收。
