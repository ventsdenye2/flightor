# 多城路线历史方案与当前支持范围

更新：2026-09-20。原估算引擎/规则解析方案已归档至 [历史原稿](archive/legacy/multi-city-plan.md)，不是当前自然语言 Planner 的产品架构。

当前航线生成只支持一个出发机场、一个最终目的地、单程和有界出发窗口。普通机票搜索可支持的往返查询，不代表自建路线引擎已支持多城往返组合。旅游活动覆盖多个停留城市，也不等于航空组合能力已上线。

旧 `/v1/route-plans` 等兼容代码的存在不能用来宣称当前 Planner 多城航空闭环可用；不得恢复 regex 作为主语义解释器。

多城/往返优化保留为后续方向。当前首先解决 [精简 Planner 的交付与耗时](design/budget-travel-agent/RUNTIME_PLAN.md)；产品支持范围以 [架构](FLIGHTOR_ARCHITECTURE.md) 与真实验收为准。
