# 从本分支开始开发后端

更新：2026-10-19。状态：前端基线，新后端未实现。不预先选择框架、数据库、模型或供应商。

| 位置 | 后续接入点 |
| --- | --- |
| `src/features/ui-experience/presentation.ts` | 行程、报价、活动的展示模型，不是已定的服务端协议 |
| `src/features/ui-experience/AppExperience.tsx` | 共享页面编排，内存收藏/提醒可改为持久状态 |
| `src/features/ui-experience/PlannerPage.tsx` | `start` 的本地计时器可替换为真实规划请求和状态 |
| `src/features/ui-experience/flightSamples.ts` | 当前对注入样例做本地筛选，不查询供应商 |
| `src/features/ui-experience/experienceSamples.ts` | 双端固定展示数据注入点 |
| `apps/ui-preview/src/main.tsx` | H5 入口和样例面板 |
| `apps/ui-preview/taro-entry/pages/index/index.tsx` | 微信入口与平台能力 |

建议集中维护服务端响应到展示模型的适配，业务状态双端共享，运输层分别适配 H5 fetch / Taro.request。当前没有预设 URL、API 合同或伪装可用的环境变量。

后续由用户开发的最小闭环：确定技术栈并创建全新 `backend/`，实现真实规划请求 → 结果 → 保存 → 刷新读取，再替换固定样例；按需接认证、真实航班和地图。Provider key 只存服务端。

分别验收 H5、小程序模拟器和真机。旧后端/设计可从其他分支查阅，不自动复制旧运行配置、密钥、合同或付费调用授权。本次准备没有调用付费模型或航空 API。
