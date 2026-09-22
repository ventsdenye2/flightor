# 第四阶段：真实景点图片

2026-09-22。实现与H5限定闭环完成；微信页面/真机未验收。地图暂停排查、仍未解决，G1未放行。

## Git与保护边界

开始时本地与远端main均为`52cb1c315edae5a69e679d9ee36d55bc2cf92991`，`git ls-remote`未见远端map-closeout/place-media；`git merge-base main a980882`等于main。新`codex/place-media`从`a9808829da738eb39614a7bfc50d7784a578dafe`建立独立工作树。相对main继承这一个地图收尾提交，再叠加本阶段图片改动；不自动合并main。

主工作区现存Planner/研究/账本等未提交修改、地图工作树提交后的直连记录原样保留，没有reset/clean、强制合并或抄入它们。图片任务不依赖地图可见性，不调用Planner、Research或Nominatim；不切模型。

## 实际链路

[ADR0027](../../adr/0027-place-media.md)定义媒体API、绑定、缓存、安全、版本/并发保护和许可。正常页面先呈现accepted文字，再独立GET媒体；显式补全/重试才POST。概览取首张活动实景并标明景点名，每日缩略图与详情使用同一活动媒体。中文/英文共用真实照片，alt使用接纳的当前语言标题。读媒体不改正文/hash、业务版本或地点记录。

两张实际取得、GET图片字节验证且H5解码通过的照片：

| 景点 | 已保存身份 | 作者/许可 | 原文件页 |
| --- | --- | --- | --- |
| 上野公园 | osm:relation:18158889 | Bernard Gagnon，CC BY-SA 3.0 | [Ueno park.jpg](https://commons.wikimedia.org/wiki/File:Ueno_park.jpg) |
| 竹下通 | osm:way:26604007 | Intforce，CC BY-SA 4.0 | [Takeshita Street in December 2018.jpg](https://commons.wikimedia.org/wiki/File:Takeshita_Street_in_December_2018.jpg) |

上野照片是樱花季照片，不是fixture旅行日期（10月）的现场/季节证据。照片仅说明实体外观，界面没有声称实时照片。浅草寺＋仲见世组合、美食主题、没有明确匹配图的藏前留空。明治神宫调试请求获得许可元数据，但其活动图片没有完成持久闭环，不计成功样本。

## 测试与真实运行范围

| 验证 | 当前结果 |
| --- | --- |
| 后端媒体/地点/公网读取回归 | 6文件42项通过，包括非图片、重定向、字节限额、取消、无结果、歧义、错误许可、错误owner/hash、迟到结果、缓存/复用 |
| 前端 | 36项production-presentation通过；新增media-client验证两种返回顺序不丢字段、错hash/artifact/locale忽略、图片到达保持第2天和详情、内容变化复位；media-stale运行实际RoutePage回调，owner/session/trip/请求代次/content变化均忽略迟到媒体结果。两脚本纳入npm run test:production-presentation |
| PostgreSQL | 独立临时schema验证实际并发place/media写入、正文完全不变、缓存恢复、owner/activity/hash/context围栏及旧checkedAt被忽略；结束仅删除该临时测试schema |
| 类型/构建 | backend tsc、前端ES2020/DOM/node类型检查通过；H5/微信构建通过，保留既有体积与CSS顺序警告 |
| H5 | 正式route页面/适配器，390×844，两个景点原链实际解码；概览/缩略图/详情截图；慢媒体到达不关闭详情或改变第2天；中英切换/刷新只GET且服务端调用数不变；HTTP200 HTML响应收起图片、文字可用 |
| 地图独立性 | 验收地点GET故意返回503、map-config关闭；照片与accepted文字仍显示。没有诊断或修复底图 |
| 微信 | 正式构建完成；开发者工具CLI报告服务端口关闭，正常项目打开尝试未成功、界面操作未生效。已请用户手动开启服务端口。无本轮照片页面截图/真机证据，不引用旧地图或UI截图代替 |

持久验收schema=`places_test_1790087145949`；端口3014媒体为正式认证路由+真实PostgreSQL+真实Wikimedia，文本/route/workspace运输来自明确标注的accepted fixture。全新隔离Artifact经既有repository正常保存，不把正式旧攻略改成accepted；历史POI从原隔离schema只读复用。正式public库旧攻略缺接纳底稿的问题未解除，PLACE_BASE_UNAVAILABLE保留。

H5端口10087，使用Chrome、请求级浏览器代理访问真实CDN；fixture登录/文字运输，不是真实微信身份或正式public库验收。API bearer仅存忽略目录，不进入报告。H5运行资产与磁盘构建文件逐字节比较并记录SHA256，见[报告](place-media-evidence/h5-report.json)；运行来自a980882加本轮未提交源码，不能伪称干净最终SHA运行。微信构建指纹`fdd0eec40b293c6e3682f6fbc13c060a78bdd3956e2565426588517195384ddd`，构建时间2026-09-22T15:20:26.676Z，API3000，尚未打开实际页面。

失败均保留：初始直连lookup回调不兼容Node all选项（3次无HTTP响应，已修复）；Commons本地DNS不可用，改为明确可信代理解析固定供应商域名；新API实际thumb域名最初被保守白名单拒绝，按真实返回扩展；Vitest一次worker加载超时，单worker42项通过；H5初次浏览器临时目录权限/一次服务未启动/一个多元素选择器错误已修正；PostgreSQL测试首次把public UUID用于内部bigint查询，修正测试后通过。没有重装环境、关闭TLS或改生产校验。

## 截图及许可

[概览封面](place-media-evidence/overview-cover.png) · [每日缩略图](place-media-evidence/day2-thumbnails.png) · [上野详情](place-media-evidence/ueno-detail.png) · [竹下通详情](place-media-evidence/takeshita-detail.png) · [英文](place-media-evidence/english-cover.png) · [图片之前文字](place-media-evidence/text-before-media.png) · [非图片降级](place-media-evidence/nonimage-text-usable.png)。均为正式H5组件，文字/行程是fixture，照片是真实互联网素材。截图照片裁切遵循上述CC BY-SA许可；作者与来源也显示在页面。

## 调用与费用

服务账本14次HTTP尝试（3次未取得响应、11次200；其中2次为实际图片GET），另有记录的3次JSON探测及工具输出可核实的2次JSON探测，共19次服务端尝试、16次200。2次早期探测未纳入机器账本，单独说明而非抹去；详见[去凭证账本](place-media-evidence/requests.json)。官方许可/API/微信文档读取4次，单列不当成景点查询。所有这些Wikimedia公共接口无需Key，本轮已知服务费用US$0，无新增付费授权/订购。模型、SerpApi、Nominatim调用均0。

浏览器还会读取CDN原链；H5报告记录响应（包括浏览器缓存和故障注入），不等于源站实际网络计数。各次成功重跑的旧report会被覆盖，失败报告仍留忽略目录，因此不能宣称掌握累计浏览器CDN请求总数。没有自有存储费；旧地图/研究账本未重置。此次验证脚本36次仅是本脚本的免费图片流量护栏，不恢复旧地点24次限制，也不改变用户地点授权。

## 重现与剩余条件

`node --env-file=<现有后端env> backend/scripts/test-media-postgres.mjs`：loopback独立schema，先backend build。`media-validation.mjs`默认禁新增出站、复用既有schema和账本；`--execute`才允许有界免费媒体请求，选配MEDIA_PROXY_URL。`node scripts/qa-place-media-h5.cjs`使用已构建10087 H5及3014隔离服务，只GET已存媒体，独立浏览器内mock非图片失败，不碰正式账号。fixture helper原样复用第三阶段，不作为生产发布配置。

上线前须迁移014及已有013、配置MEDIA_USER_AGENT/需要时的独立代理，并完成微信正常项目照片加载/合法域名与真机证书验证。生产适配链路已实现，但正式public库端到端和微信仍未验收；不把这些缺口说成已通过，也不把地图修复、全城市/全活动图片或全量G1列为本阶段开发前置。
