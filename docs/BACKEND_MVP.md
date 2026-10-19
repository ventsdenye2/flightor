# 从本分支开始开发后端

2026-10-19新增对话执行器：普通消息交DSH旅行助手结合完整记录自然交流；只有明确制作行程的意图或用户点击生成行程才调用原规划与审核链路。完整带角色的对话作为规划输入，按用户最新修正理解需求；不要求补齐资料才输出。对话保存到本地忽略目录backend/data/conversations，接口、双端交互和验证正在同批接入。

回归覆盖普通对话不调用规划、第二轮保留首轮和修正、明确意图后将全部上下文交规划、刷新恢复、显式按钮、不规范意图回退聊天、取消后不发布迟到结果。意图语义由DSH判断，尚需真实模型样本验证；不是前端关键词开关。

聊天查询的原始工具结果独立存conversation-evidence，不放入公开消息；后续聊天及规划/审核均接收这些证据，沿用真实机票快照而不凭助手摘要重造。规划收到先机票后安排的顺序提示；工具失败不阻止输出但必须说明未知。H5基础View支持ref以滚动最新消息，不改对话框焦点逻辑。

`POST /api/conversations/turns`接受message、可选conversationId和action(chat/plan)，返回202及任务id，沿用GET/DELETE /api/runs/:id轮询与取消。普通发送的chat由DSH理解是否用户明确要求现在规划；显式plan仅用于用户点击“生成行程”。GET /api/conversations/:id恢复可见消息，不返回内部推理；每次DSH对话均重放服务器保存的完整上下文，不依赖前端拼接历史。仍为本地单并发。

更新：2026-10-19。状态：最小双 DSH Agent 后端已实现，实际验收见 [DSH_MVP](DSH_MVP.md)。使用 Node 内置 HTTP 和本地 JSON 文件，不引入数据库/队列/微服务。模型和工具运行由完整 DSH 负责。

| 位置 | 后续接入点 |
| --- | --- |
| `src/features/ui-experience/presentation.ts` | 行程、报价、活动的展示模型，不是已定的服务端协议 |
| `src/features/ui-experience/AppExperience.tsx` | 共享页面编排和本次真实行程；收藏/提醒仍为内存状态 |
| `src/features/ui-experience/PlannerPage.tsx` | `start` 默认连接真实生成器，显示阶段、失败与取消，迟到结果忽略 |
| `src/features/ui-experience/backendClient.ts` | 双端共享的提交、轮询、取消与成功结果恢复；取消信号不依赖微信缺失的浏览器全局 |
| `src/features/ui-experience/flightSamples.ts` | 当前对注入样例做本地筛选，不查询供应商 |
| `src/features/ui-experience/experienceSamples.ts` | 双端固定展示数据注入点 |
| `apps/ui-preview/src/main.tsx` | H5 入口和样例面板 |
| `apps/ui-preview/taro-entry/pages/index/index.tsx` | 微信入口与平台能力 |

服务端 `backend/src/contract.mjs` 只做JSON读取与展示适配，不设业务验收门槛；字段缺失用空值，非JSON原文保留为可读概述。H5 fetch和Taro.request分别提供运输适配。POST /api/runs接收prompt和可选补充constraints，GET /api/runs/:id读取状态/结果，DELETE取消并等待本次清理；POST单并发，忙时409。API仅绑定本机，不提供业务身份认证。

已接真实规划 → 独立审核整理 → 展示映射 → JSON保存。按用户最新要求，删除业务校验、审核否决、自动返工以及任意天数/人数/活动数量上限。资料不足、来源缺口、旧报价或审核疑问都不阻止输出；来源保持unverified。航班候选的价格和时刻直接从CLI快照映射；找不到快照时仍显示行程，只不生成不存在的航班卡片。不保证结构适配等于需求符合或事实验证。

分别验收H5、小程序模拟器和真机。旧后端/设计只作历史参考，不复制旧运行配置、密钥、合同或授权。新一轮真实调用由本次用户要求的接入验证授权，不沿用旧G1/D6账本。本轮失败和成功均保留在本地数据目录。
