# 景点图片与行程内容

更新：2026-10-19。适用于当前 `backend-mvp`，不沿用旧后端的媒体服务或发布流程。

## 内容分工与 JSON

规划 Agent 先搜集必要旅行资料，逐个景点提供介绍、推荐理由、游玩安排，以及能明确对应的英文/当地名称和所在城市。审核 Agent 只从草稿、用户需求和已有工具结果筛选有价值的信息，不重新查询、不拒绝输出、不要求返工。

- `overview`：约80至160字，提炼旅行体验、路线顺序和节奏；不复述聊天或堆砌航班与风险。
- `highlights: [{title, description}]`：少量具体、与用户需求相关的旅行亮点，信息不足可为空。
- `issues: [{detail}]`：重要待确认事项，映射为展示层 `travelNotes`，单独显示“出发前留意”，不再拼进概述。
- 景点的 `description` 映射日程列表 `summary`；`introduction`、`recommendationReason`、`visitNotes` 分别显示“关于这里”“为什么安排这里”“游玩提醒”，另有“怎么玩”。不编造用户兴趣、历史、价格和开放时间；无依据可留空。
- `imageQuery` 是明确单个景点的英文/当地名称，`city` 为其所在城市；组合活动选择其中一个代表，泛称、交通或自由时间设 `imageQuery: null`。审核结果不接受模型提供的图片URL。

旧行程不会因提示词变化自动改写文字。缺少新字段时继续显示旧摘要；若要新的介绍、推荐理由和概览，需要重新生成行程。旧景点仍会尝试以原名称查询照片，中文或多景点组合名称可能没有精确结果。

## Commons 图片链路

`POST /api/place-media` 接收 `{name, query?, city?}`，只向固定的 Commons Action API 发起名称搜索与 `imageinfo` 查询，返回 `{status: ready|not-found|unavailable, media: object|null}`。该接口不创建run、不调用DSH、不查询机票，不受规划单并发占用；错误输入返回400，过大输入返回413。图片匹配本身不是新的业务验收门槛。

展示字段包含 API 返回的缩略图 URL、景点名、作者、Commons 文件页、许可名称和链接。仅接收 Commons 的 HTTPS 缩略图主机 `upload.wikimedia.org` / `thumb.wikimedia.org`，与景点名称相符的足尺寸 JPEG/PNG/WebP，以及明确的 CC BY、CC BY-SA、CC0 或公有领域记录。缺许可、无作者、受限、模糊匹配或查询失败时留空，不借其他景点或样例照片。不能保证任意命名的景点都有图片，也不能把文件名匹配说成实地人工核对。

H5与微信在打开真实行程后独立异步请求，每个视图最多两条并行；文字先显示，图片补全不重置选中日期或打开的详情。首个取得图片的实际景点可作为概览配图，标注其名称。详情、概览及“图片与来源”提供作者、来源和许可入口；微信复制外链。图片文件由客户端直接从 Wikimedia 加载，后端仅缓存元数据。

成功记录在忽略的 `backend/data/place-media/` 缓存7天，无匹配结果缓存1小时，网络失败不缓存；同一名称/查询/城市的并发请求合并。重启后继续使用缓存，不改写历史run或原始证据。undici 读取现有 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，不修改系统代理。单次外部查询10秒超时；断网不影响文字和规划。

API与元数据依据：[Commons API](https://commons.wikimedia.org/wiki/Commons:API/MediaWiki)、[Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)、[undici 环境代理](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md)。

## 本批验证

- `npm run backend:test`：23/23通过，覆盖图片身份/许可/主机筛选、同景点请求合并、磁盘缓存与过期、失败可重试，以及介绍/推荐/亮点/提醒分开映射。原有对话与规划回归继续通过。
- `npm test`、`npm run check`、`npm run build`：通过；两端共用组件，微信仍有原有图片体积/分包建议。文档与diff检查通过。
- 免费真实Commons请求：查理大桥、布拉格城堡返回照片、作者、CC BY-SA 4.0和文件页，浏览器成功解码并展示；三个中文原名查询未取得精确结果，没有用无关图片补位。新提示词要求英文/当地检索名称，旧记录无法保证覆盖。
- Browser plugin not available，使用独立Chrome/Playwright CLI，页面`http://127.0.0.1:4178/`、标题与内容正常，无框架错误遮罩，控制台无应用错误/警告。文字与行程使用明确的结构样本，图片经过实际API。验证概览亮点/单列提醒、每日缩略图、详情介绍/推荐/玩法、作者许可列表、无图占位；延迟图片返回后D2与已打开详情保持不变。1440×1000、390×844截图已检查，320/390宽度无横向溢出。
- 后端已重启加载接口与提示词，H5代理健康接口`ready`。未调用付费模型、未重新查票、未做微信真机验收；真实模型在新提示词下的信息筛选与文风仍需用户下一次生成验证。旧行程正文及原始数据未改写，图片元数据独立缓存。

提示词结构与假Agent回归不等同于真实模型输出质量验收。
