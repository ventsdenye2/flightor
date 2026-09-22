# ADR 0027：独立景点媒体补全

2026-09-22，Accepted，已实现；服务端和 H5 限定验收通过，微信页面/真机未验收。基线 `a9808829da738eb39614a7bfc50d7784a578dafe`，独立 `codex/place-media` 工作树。地图底图暂停排查、仍未解决。证据见[第四阶段报告](../design/budget-travel-agent/PLACE_MEDIA_2026-09-22.md)。

## 范围与来源

单一 Wikimedia 路径：Wikipedia 条目的自由图片，经 Commons Imageinfo 返回真实 URL、作者、许可与来源页。只接受 CC0、Public domain、CC BY / CC BY-SA 的明确许可。源条目必须与原活动来源绑定，或与 resolved 地点原名/别名及坐标一致；不凭城市搜索填图，不调用 Nominatim、LLM 或研究工具。缺图保持文字可用。不新建对象存储，使用 API 返回的 HTTPS 缩略图。

已读取官方 [复用条件](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) 与 [Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)：每张文件许可单独判断，保留作者、许可链接与文件页；显示裁切会明确标注。不把可访问等同商业许可。

## 当前合同

显式 POST `/v1/artifacts/:id/media` 按当前 accepted guideContentHash 补全，GET 同路径只读；无自动付费或后台 Planner 调用。独立绑定与缓存表，复用地点 snapshot 的 owner、活动、Trip/航班及内容校验；不修改原攻略及 publication hash。活动媒体与地点分别保存并按字段合并，封面确定性选择首张景点实景，不冒充城市全景。失败短期缓存，查询串行、有界、固定供应商 HTTPS 白名单，无通用 URL 代理。

前端先显示文字，再独立读取图片；刷新不搜索。账号/会话/请求代次/内容版本检查必须覆盖异步结果；媒体到达不得重置日期、详情及选择。最终实测结果另行补充，不以构建或 URL 非空宣称验收。

迁移 014 新增 `guide_media_bindings`（owner/artifact/hash/activity 主键）、`media_query_cache`。活动扩展为 `activities[id].media={src,title,width,height,source,entityUrl,placeId?,association,retrievedAt,candidates}` 或 null，另有 mediaStatus。source 保留作者原名、许可名/链接、文件页；无 POI 的明确源条目使用 source_activity，不制造 placeId。已有 ambiguous/conflict、主题美食、多地点组合、城市级输入不取景点图。无 Wikipedia 源且无 resolved POI 时保守留空。

resolved POI 只查原名/别名对应的精确 Wikipedia 条目（每语言一次，en/ja/zh，最多6个名称），与条目坐标相距小于1.5km才使用该条目的自由图片；不搜索整个城市，不选搜索首条。原来源路径也要求条目名匹配；多个匹配或消歧页拒绝。当前一张图片/景点，不做图库。实体确认只是限定名称/位置/来源匹配，不宣称照片拍摄日期或当前季节。

缓存键含供应商/版本、用途 entity-photo、960尺寸；resolved 用 placeId，无POI用原名/地区/来源。ready 30天、empty 1天、技术失败5分钟；同进程动作/查询去重与全服务串行；没有跨实例任务去重承诺。一次动作最多12个缺缓存目标、总窗口24秒、单景点18秒、每HTTP8秒；已缓存目标不占12个搜索名额，后续显式操作可以继续。只有POST可能获取媒体。当前没有合适的发布后持久异步hook，按本轮授权采用显式补图最小链路；新攻略同样点击补图，文字发布不等待图片。

每活动保存事务锁定原Artifact/Trip并复查内容、活动、owner、Trip版本及航班revision；旧checkedAt不能盖新媒体行，地点行不被触碰。客户端按 media/place字段分别合并，每次 GET 绕过 accepted Artifact 旧缓存；图片失败与地点GET失败独立。详情存活动ID，通过当前列表取新图片；只在行程/内容版本变化时复位。

## 安全、部署与回滚

`MEDIA_USER_AGENT` 含实际应用/联系方式，空则POST503、GET仍读缓存。`MEDIA_PROXY_URL` 可选，独立 Node HTTPS Agent，要求Node22.21+/24.5+，不改变Planner/系统出口。只允许固定 en/ja/zh.wikipedia.org、commons.wikimedia.org 的JSON及 upload/ thumb.wikimedia.org 的图片；HTTPS443、无URL凭证、不跟重定向。直连复用公网IPv4检查并固定DNS地址；显式可信CONNECT代理负责固定供应商域名的解析，不能当任意URL代理。JSON256k、图片2.5MB、MIME与JPEG/PNG/WebP签名校验，前端再实际解码。TLS验证正常开启，无图片字节/凭证进入模型。

使用API返回的远程原链，不下载转存到自有存储；展示采用固定高度、aspectFill和lazyLoad，标注裁切。CC BY-SA照片及其裁切保持相同许可，文件页/作者/许可在来源入口与详情提供；UI源码许可不因此自动改写。客户端支持最多两张已接纳备用候选，但当前Provider只返回一张；失败收起，不反复访问新图片搜索。

微信使用 Image 的 HTTPS src（JPG/PNG/WebP）；官方[组件](https://developers.weixin.qq.com/miniprogram/dev/component/image.html)及[网络要求](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)已核对。生产后端request域名需配置HTTPS；若后续使用downloadFile还须配置对应downloadFile域名。本版直接Image加载，不使用下载/通用图片代理。Commons缩略图目前由thumb.wikimedia.org返回，部署网络需允许它与upload.wikimedia.org；不同平台证书与网络可达性仍需实测。仓库已有开发urlCheck=false未改，不能据此声称生产域名通过。

回滚可清空MEDIA_USER_AGENT停止新增查询、保留绑定与缓存表；不删攻略或重新生成终稿。仅测试schema实际执行迁移，正式库未迁移；down会删除媒体表，需先备份，本轮未在正式库执行。
