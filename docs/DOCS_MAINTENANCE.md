# 文档维护规则与本轮清理记录

2026-09-25：最小commit真实通过后，runner曾用API的`status=completed`覆盖probe的`status=passed`，导致浏览器写入gate错误关闭。现将API终态独立为`turnStatus`，probe状态最后写入；当前已验收commit回执按同一turn的satisfied、真实GET保存的accepted Artifact及GET账本不变证据修正状态，原attempt保留且追加纠正原因。不修改Artifact或publication，不重新收费跑已通过probe。

2026-09-25：H5 DSH验收脚本按正式workspace的`id desc`顺序取最新攻略，不再反转成最旧攻略；否则局部编辑/预算修改后的断言会错误检查旧版本。此为验收读取修正，未改正式前端或API排序。

## 2026-09-25 DSH 正式 H5 续验脚本

显式`--execute --media --case A|B --reopen-trip`是独立图片诊断模式：从真实My Trips打开当前accepted攻略，只点击一次既有“补全 / 重试图片”，保存media GET前后、唯一media POST状态/错误、图片解码尺寸及截图。严格检查Trip/攻略/路线/航班不变、无Agent turn且账本完全不变（含迟到事件），不用Planner或搜索Agent，不自动重试，不改用户冻结对话。接口拒绝记作`mediaDiagnosis.outcome=endpoint_rejected`，报告`observed`只代表诊断完成，不能据此声称图片成功；配置/网络修复需另次明确执行并保留前次。语法检查通过；真实响应后增量记既有DSH报告。

10:07图片真实按钮诊断：唯一media POST被隔离runner自身白名单返回403 `DSH_E2E_READ_ONLY`，未到媒体路由/Provider，0Agent且原账本SHA和内容不变；截图/原报告保留。最小runner配置修正仅在原`--serve --execute`与全部probe通过门禁内允许精确UUID artifact `/media` POST，并给本隔离进程缺省`MEDIA_USER_AGENT=FlightOR/0.1 (local DSH acceptance)`，原env显式值优先；不修改base env、产品UI、全局代理或自动触发补图。语法检查通过，修复后实测另记，不把该403解释为Wikimedia或图片解码失败。

10:11修复后同一正式B页面再显式点击一次：media POST 200，4个活动均empty，照片DOM与外部照片请求均0；只读DB原因是3项`source_identity_required`、1项`ambiguous_or_unsupported`，均在Wikimedia网络读取前返回，不是下载/解码错误。完整映射见[DSH发布说明](design/budget-travel-agent/DSH_PUBLICATION_2026-09-24.md)。正式API gate/config问题已修，但照片显示仍未成功；没有新增地点解析、猜测图片或绕过身份约束。两次动作各仅1个media POST，0Agent、0模型/搜索，Trip/guide/flight不变且账本完全相等。原10:07/10:11报告、截图与第二次DB原因文件均保留。

新公开产物出口的预算文案验收动态导入已构建后端`publicProseProblems`，仅取其`budget_guarantee`分类，不复制另一套语义正则、不宣称费用已验证。检查首轮/局部编辑的新publication.reply、overview、最终API答复及实际概览，预算确认的新reply和显式本地化后的英文；不对旧before基线新增门槛，允许以不合格旧稿为局部修复基线。15项离线断言通过，包含09:50真实漏检“整体预算仍在既定总额内”的reply/overview/额外公开文字反例、中英同义保证及谨慎预算说明正例；测试需先backend build。脚本语法通过。旧B1报告和accepted状态不改写，该历史文案不能据旧脚本成功声称已通过预算公开文字要求。

`--restore --case A|B --reopen-trip --restore-languages`用于当前攻略已含接纳英文时的纯读取验收：先完成既有刷新/回复/活动恢复，再GET确认同guideId/hash的en publication accepted及活动时段/来源一致；实际点击English，要求现有accepted正文和活动显示且没有生成按钮，再点击中文，逐项对比原中文概览、活动名称/身份/时间和详情，并保存三语言状态截图。整个模式保持零API mutation、零账本变化，绝不点击生成。预算派生攻略已按领域代码继承并重验accepted variants，因此09:30新版生成入口因当前v4已有accepted英文而发送前拒绝是正确防重，不需要新增收费生成。14项离线断言覆盖已有英文的身份/时段/来源/状态负例，语法/diff检查通过；此脚本批次不冒称真实语言恢复通过，实际运行由主验收单列。

只读`--restore --reopen-trip`及`--prepare --reopen-trip`进入正式My Trips后，等待实际`.pl-result`与`.pl-reply-copy`显示，保存`restoredPlannerReply`和截图。当前末条assistant为`completed/satisfied/trip_context_update`时，显示文字须与fresh workspace的当前content完全一致（只正规化Markdown粗体与空白），且两者不能等于旧publication.reply；历史接口若仍覆盖预算答复，验收明确失败，不通过延长等待或改断言绕过。保留零POST/零账本增量及迟到活动检查。显式`--execute --localize --case A|B --localize-new-version-after <原成功localize报告>`仅允许同Trip/会话的不同当前accepted guide且正式en GET未accepted；核验原独占attempt、原真实一次localization POST及中文恢复成功，记录原报告SHA，按当前guideId生成独占后继attempt。点击前核对浏览器打开的artifactId等于当前攻略，所有旧attempt保留；同artifact或已有accepted英文拒绝，不自动retry。13项离线断言含历史覆盖和新版本入口反例、语法检查通过；本批未运行浏览器或Provider，真实验收另记。

B首轮09:05真实失败的`completed/responded/not_requested`仅在回复精确为“本轮未能发布攻略，请确认当前条件后重试。”、全部交付产物/Goal数组为空、Trip/summary/refs/完整航班前后不变且没有攻略时，才进入幂等冲突核验。脚本读取原批次唯一同generation的真实observer，校验scope、连续sequence、终态completed及execution_closed，并要求两次commit（初次加同turn一次重试）均明确返回`GOAL_IDEMPOTENCY_CONFLICT`、无任何产物结果；将observer路径/SHA及两次尝试写入后继报告。原SHA谱系、重启404旧进程证明、fresh workspace/flight与无accepted门槛继续生效，没有通用not_requested首轮例外。11项离线断言及脚本语法/diff通过，真实保留observer零调用核验通过；`node --test`最初被沙箱spawn EPERM阻断后以`node scripts/test-dsh-h5-assertions.cjs`同一测试文件通过，未执行浏览器或Provider。

B1发生“trip_context_update子目标satisfied，主模型随后model_failure且无accepted攻略”的已观察故障时，原`--retry-terminal`只增加精确窄例外：失败断言为`Current authoritative guide is not accepted`、warnings同时有model_incomplete/reply_withheld、turn/response/delivery均无产物、采用航班及完整fixture前后不变。不能把子目标完成等同用户攻略交付；其他satisfied、其他case/round、已accepted或航班变化仍拒绝。重启证明及fresh Trip/summary/messages/refs/flight与最新失败after一致检查继续保留。10项离线正反例和脚本语法/diff通过，无真实调用。

B首轮已观察到的`completed/model_failure`且`partial/travel_guide`、missing精确为`accepted_publication`可通过原`--retry-terminal`显式续验；重启404分支仅为该B1组合增加窄入口。前驱与fresh GET不得有accepted攻略，Trip/summary/flight全部segments/messages/refs须与失败报告一致，继续要求SHA谱系、旧进程退出证明和原attempt保留。其他case/round、其他missing、运行中或已satisfied/accepted均不借此放行。9项离线断言覆盖组合正反例，语法/diff通过，未触发B重试。

预算确认入口还允许引用“现有accepted/1200攻略未变、同值确认被`dsh_reply_withheld`拦截”的后继报告；SHA链逐级回到原partial receipt、再到真实1500→1200更新，不删除任何失败。最终明确区分`setter_confirmed`（真实trip_context_update satisfied）与`no_op_confirmed`（真实not_requested/responded、无withheld、无Goal/产物、新旧Trip/summary/activities/route/flight/refs完全不变、当前accepted版本、0搜索）。后者要求真实DOM回复明确1200总预算且不重复旧publication回复，绝不伪造satisfied或强制增加版本。报告中的最初预算setter、派生攻略恢复及本次同值答复保留为不同真实运行，不能合并冒充一次成功。8项纯离线断言及语法检查覆盖该分支；真实运行另记。

若预算派生已生成当前版本accepted攻略，但正式turn仅为`partial/trip_context_update`且missing精确为`trip_field:budget`，必须使用独立的`--execute --case A --round 4 --retry-budget-confirm <partial-report.json>`，不能放宽旧blocked/stale恢复入口。新入口追溯并校验原1500→1200报告SHA链、accepted派生攻略对原稿的活动/时段/顺序/正文逐项继承、仅source artifact ID映射而原finding/公开证据不变、route/flight保持。发送前真实GET须仍为同Trip/当前accepted guide/hash/plan/sources；只允许显式本地化导致的publication元数据及updatedAt变化，不容许消息、偏好或其他产物变动。仍用原冻结预算句通过输入框单次发送、保留所有attempt，结果先要求delivery satisfied再读取正常回复，避免把partial页面缺少回复节点误诊成浏览器超时。本入口7项离线断言/反例、语法和已有真实报告零调用复核通过；不是新的真实验收结果。

预算修复续验如出现新的已结束`not_requested/responded`且`dsh_reply_withheld`、没有执行更新的真实失败，`--retry-budget-update`可显式引用这份最新前驱。脚本逐个验证保留报告的SHA链（最多16层、拒绝循环/改写），追溯原1500预算/accepted攻略的变更前快照；每次未执行更新的后继必须Trip/summary/攻略/route/flight/refs在自身前后完全不变，当前真实GET仍须等于最新前驱。最终1200及accepted断言始终相对原预算变更前基线，不把最近一次已1200的失败误当新原点。仅扩展该已观察到的withheld无动作失败，其他终态或状态变化拒绝；保留所有原attempt，不自动重复发送。纯离线6项中的新增正反例和语法通过，未触发调用。

预算第四轮存在“Trip已更新1200总额且trip_context_update satisfied，但旧攻略仅因context version变化blocked/stale”的已证实故障时，可用`--execute --case A --round 4 --retry-budget-update <failed-round-4-report.json>`显式续验，重启时沿用`--restart-evidence`。它只接受已结束的同scope冻结消息、1200 CNY/trip/两天、无新增artifact/路线/航班变化、原accepted攻略现在同ID blocked且含stale问题；当前权威GET快照必须与前驱终态完全一致，保留原attempt并产生SHA谱系后继。其他satisfied结果仍不能借此重发。预算notes检查动态导入已构建后端的纯`budgetNotesEquivalent`，仅按同一领域规则允许预算口径/谨慎说明，不复制另一套语义白名单；其他Trip字段保持严格。最终检查从原预算变更前快照对照新结果，仍要求当前攻略accepted与1200总额，不将重复更新API成功当修复通过。入口/反例6项离线断言及语法通过，尚不代表真实预算恢复成功。

B隔离已采用fixture入口可用`--prepare --case B --reopen-trip`，之后`--execute --case B --round 1 --reopen-trip`：直接打开正式“我的行程”列表，以真实workspace标题定位唯一卡片并点击“继续安排”，由正式`openCloudWorkspace`恢复已有Trip/会话/flight引用；入口阶段只允许GET，不注入虚构聊天或再创建会话。此前`--restore --reopen-trip`行为不变。B首轮及局部修改的权威断言比较采用选择/revision、完整flight artifact及全部segments，并核对guide引用同offer和抵达时间；按现有领域slot规则检查抵达前日期无活动、12:30抵达当天无morning安排，明确不据粗时段推断精确交通耗时。新增反例覆盖改revision、改segment、伪造guide抵达时间、提前上午活动及跨日提前安排；纯离线断言5/5与脚本语法通过。未执行B真实Provider或浏览器，不将fixture航班描述为真实票价。

已有正式H5发送且后端satisfied/accepted、但页面显示失败时，用`--restore --case A|B --reopen-trip --render-after <failed-ui-report.json>`只读复验同一攻略：原失败报告须包含真实POST和accepted权威产物，复验匹配guide ID/contentHash；从“我的行程”真实DOM中确认唯一同名Trip并点击“继续安排”，核实正式workspace GET回到同Trip/会话后再打开结果，避免修改或注入缓存来掩盖问题。权威攻略选择遵循公开workspace旧→新顺序与正式UI的last-wins规则。保留列表、概览、两天及全部详情截图，刷新比对并检查零API mutation/零账本增量。`originalClickToRecoveredGuideMs`由原报告UTC起点+点击偏移及本次可读DOM时间计算，明确包含排障、修复、重启和空闲时间，是恢复后首次观测的跨运行耗时估计，不能称为无中断首轮延迟；原失败报告不改写。入口仅完成语法和既有4项离线断言检查，真实恢复以运行证据为准。

终态恢复核验使用原报告保存的权威workspace assistant ID/正文，与fresh GET逐项比较；不把公开`terminal.response.reply`当作持久Conversation正文。未完成交付时这两者可采用不同安全投影，不能因此误判云历史变化。整份messages/artifactRefs/Trip一致性、已退出进程、已知终态及无accepted攻略的门槛不变；这项脚本纠正只消除发送前的错误拒绝，不删除真实失败记录或改业务发布规则。

明确诊断并修复后，可用`--execute --case A|B --round 1 --retry-terminal <failed-report.json>`重新从正式输入框发冻结首轮请求。入口拒绝运行中/模糊报告、已有satisfied交付或accepted攻略；检查原POST恰好一次、最终turn scope/status、保留attempt谱系，并真实GET旧turn和workspace中的全部攻略，再生成前驱SHA绑定的独占后继attempt，不删除失败或自动重发。若为加载修复而重启后端使内存turn GET404，仅可追加`--restart-evidence <json>`：含前驱报告SHA/turnId、已退出旧PID及旧lock已消失的实测证明和时间；脚本再次核验PID为ESRCH、仅允许原completed/not_requested/model_failure或completed/partial/goal_partial两种已知未交付结果，保留其真实research与隐藏draft记录；fresh workspace的完整messages（含末尾真实user/assistant ID/文字）、artifactRefs、Trip必须逐项等于原终态快照且无accepted攻略。其他404不放行；真实持久状态变化或旧进程仍在则拒绝。这是保留原会话的显式单次续验，不是持久TurnStore实现或生产自动重试。新增恢复入口已作语法检查，旧4项离线断言仍通过；真正发送/Provider结果另记D4证据。

H5 首轮在会话 bootstrap 之前失败时，`--hydrate-existing --execute --case A --round 1 --retry-before-turn <closed-failed-report.json>` 是单独显式恢复入口：必须读取原批次已结束的失败报告，核对同Trip/会话/原消息、`postCount=0`且网络事件中没有Agent turn POST或turnId，保留原attempt并用前驱SHA生成独占后继attempt。只允许真实workspace GET中的唯一一对“读取当前目的地和日期、不修改/搜索/保存”的已完成准备对话，无产物/路线生成；按现有`openCloudWorkspace`的messages/timeline映射缓存，并备份原私有storage，不注入虚构回复/攻略或替代正式发送。准备对话是单列真实API准备步骤，不能作为正式H5闭环证据；运行中的报告、曾发Agent请求或其他云对话均拒绝重试。本批只作脚本语法与既有离线断言检查，真实恢复效果以随后报告为准。bootstrap API明确报错时脚本立即记录失败，不继续空等整轮超时。

`qa-dsh-e2e-h5.cjs --execute --localize --case A|B` 在同一真实浏览器会话内先留存中文概览、活动名称/身份/时间及简介/推荐理由，再显式生成英文，随后点击现有“中文”切换按钮。恢复后逐项比对原中文文字和权威攻略/Trip/route/flight快照，检查切回期间零API写入、零模型和搜索调用，保留中文恢复截图；不新增前端代码或自动重试。此脚本增量只完成语法与既有4项离线断言验证，实际中英切换结果须由真实执行另行记录。`clickToReadableGuideMs` 当前在终态API和权威GET后打开攻略才观测，是包含这些检查及打开动作的可读内容耗时上界，不代表最早渲染/paint时刻；报告中显式标注该限制。

2026-09-25新增明确不限预算授权：`verify-dsh-e2e.mjs`仍要求原batch、零pending及配置/账本模式一致；仅原账本已追加`authorizeUnlimited`审计grant且显式`DSH_BUDGET_UNLIMITED=true`时跳过累计capacity判断。dry-run持续显示完整历史次数/费用及`remainingUsdMicros=null`，不能以空值当零费用；旧数字上限和失败记录保留为历史。单次显式probe、顺序门禁和单轮限制不变。预算与配置离线测试32/32通过（3.91s），覆盖环境变量单独切换被拒、grant前后历史一致、超旧上限仍逐调用计账、重启恢复及pending/replay保护；backend build、runner语法与diff检查通过。初次测试仅因沙箱拒绝esbuild子进程而未启动，授权重跑通过；这不构成真实Provider或H5通过。

续验runner逐启动写入`server-<uuid>.jsonl`：实际安装的legacy/Research/首次Finalizer/票价守卫、HTTP路径/方法/状态/时间及关闭时违规调用计数。缺失待守卫方法时启动失败，不能静默跳过。审计不含请求头、Key、正文或查询参数，失败/进程中断前的已写记录保留；未来H5 PASS须同时检查该审计和worker observer，不能用静态代码断言代替实际路径证据。

预算管理的显式grant允许`additionalModelCalls=0`，以便模型次数仍充足时只按用户新授权追加金额/搜索，不擅自提高模型上限。没有新的明确授权时不得调用该管理方法；旧entries、batch及未知预留仍完全保留。该能力本身不代表额度已经增加。

四次失败后收紧最小commit probe：新的显式重试创建保留的`COMMIT-<attempt>`独立测试Trip/会话，只含文化兴趣和“一处景点、另一天自由休息”的冻结请求，避免旧失败Goal及原A用例的小吃兴趣污染最小提交测试。仍使用原目录、schema、预算batch和所有旧attempt，不删除/改写旧Goal或费用；这仅验证冷启动最小发布，不能替代正式A会话的warm followup/局部编辑。任何付费重试仍须原账本存在足够且当前明确授权的额度；probe绝不注入网页URL、正文、证据或固定攻略。

`backend/scripts/verify-dsh-e2e.mjs` 默认/`--dry-run`只读核对原账本；通过显式`--execute --model|--search|--commit`按顺序运行独立真实probe，失败保留且重试必须显式`--retry-failed`。三项通过后`--serve --execute`才开放3025正式认证写API。所有数据仅进入保留的`dsh_e2e_20260924`隔离schema，沿用原`.dsh-data/budget.json`，不重置旧失败、未知费用或预算批次。用户两次新增US$3/48模型/12搜索及US$2/32模型/8搜索授权均以追加grant记录，当前累计上限US$7/128模型/32搜索；上限不是未来授权。

`scripts/qa-dsh-e2e-h5.cjs`使用已安装Chrome和正式H5；`--prepare --case A`只读检查，`--execute --case A --round 1`起通过真实输入框发送，`--restore`检查恢复，`--execute --localize`执行现有显式语言生成。只装载隔离用户的真实token和会话存储，不拦截API、不mock模型；每次发送保留独占attempt文件，失败后先核查已有turn，不能删除文件来盲目重发。私有transport/browser storage含token，禁止提交。脱敏报告和截图留在`output/playwright/dsh-e2e-20260924`，可分享证据选择性归入现有DSH报告目录。

`backend/scripts/dsh-e2e-observation.mjs`仅观察实际DSH运行，逐执行保留JSONL时间、工具名、调用回执和session/profile；不记录Key、模型推理或网页正文，不改变执行结果。真实结果、失败原因、调用总量和平台验收结论增量维护在[既有DSH D4报告](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。只读页面、probe和正式H5多轮验收分开认定。

## 2026-09-24 DSH 真实双对话 runner

`backend/scripts/verify-dsh-live.mjs` 默认/`--dry-run` 只解析配置和保留账本，不连接数据库、不发模型/搜索请求。显式 `FLIGHTOR_BASE_ENV_PATH` 指定基础配置，叠加 `.env.dsh.local`；`--execute --case A|B` 才在本批2美元/48模型/12搜索围栏下执行附件§13.2冻结用例。连接从忽略的 `.demo/dsh-db-env.json` 读取，迁移只进固定 `dsh_live_20260924`（共享pg_trgm扩展沿用既有迁移），保留schema、state、同一`.dsh-data/budget.json`与失败。B为明确标注的合成航班，使用真实采用API，不查实时票价。正式认证API和真实DB保存/读取，GET不能增加账本；显式本地化单列耗时/费用。`--serve`保留loopback3024供H5只读，无harness nonce的写请求拒绝；`transport.private.json`含合成测试身份token，禁止提交/分享。失败/中断case不自动重新发首轮或改措辞；凭证、账本、操作方式与实测边界见[DSH live操作说明](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。本条仅记录新脚本职责，不能据dry-run认定真实Provider或G1通过。

2026-09-22媒体维护脚本：`backend/scripts/media-validation.mjs`复用地点fixture helper，在独立loopback schema创建新的fixture攻略，正式媒体路由与真实PostgreSQL执行；默认禁新增出站，`--execute`才有界允许免费Wikimedia请求，不绕过旧账本/生产底稿保护。保留累计validation.json及失败，不写public。`test-media-postgres.mjs`使用唯一临时schema验证并发和版本保护，仅清理该schema。`qa-place-media-h5.cjs`用独立Chrome、3014真实媒体API、10087正式H5和明确fixture文字，检查真实原链解码/图像错误/版本产物并截图；需要代理时仅该浏览器配置，不改系统。`test-place-media-client.cjs`为离线并发合并与浏览状态回归。命令、失败和未测边界见[报告](design/budget-travel-agent/PLACE_MEDIA_2026-09-22.md)。

生效：2026-09-20，来源：用户明确要求“之后的每一次修改都要同步修改 docs”。仓库入口 [AGENTS](../AGENTS.md) 引用本规则。这里是仓库规则，不写入个人全局记忆。

## 每次修改必须做什么

1. 修改前从 [README](README.md) 找到负责该行为的文档，检查代码/配置/证据；历史 handoff 不是当前授权。
2. 同一修改批次更新相关 docs：接口/工具变更改 TOOLS；跨域行为改架构和 ADR；配置/启动改 deploy；UI 数据和交互改设计；测试结果更新当前 progress/评测报告。只写一行“文档已同步”不合格。
3. 无公开行为变化的内部重构/测试/脚本也在当前进度记录目的、影响范围、执行验证和未验证项；纯文档改动更新其版本/状态即可，不机械创建新报告。
4. 状态严格区分：当前实现、拟议、历史、已实现未验证、已验证。测试通过、真实 Provider 成功、H5 成功、微信真机成功分别记录。
5. 验证后再提交；每次提交的暂存范围也包含对应文档。无法运行的检查说明原因，不能引用旧测试数量顶替新证据。

| 变更类型 | 必须同步的入口 |
| --- | --- |
| Planner/工具/schema/完成语义 | TOOLS + 相应 ADR/架构章节 + 当前进度 |
| Trip/Artifact/来源或迁移 | 架构 + ADR + 兼容/回滚/验证说明 |
| UI 交互/展示转换 | 当前视觉/交互文档 + 对应行为验收 |
| 运行配置/Provider/模型/网络 | deploy/PROJECT_CONTEXT + 配置指纹与实测边界 |
| 性能/评测 | EVALUATION 报告与 progress，不用日志片段代替全部失败样本 |
| 维护脚本 | 本规则中的用途、命令、限制与验证记录 |

## 检查入口

2026-09-21：新增 `scripts/qa-g1-publication-weapp.cjs` 复用已保存公开投影，在实际开发者工具检查双入口详情和页面 reLaunch 恢复。连接已启用的 9432，需未登录模拟器；登录和全部 wx.request 被 mock，不访问真实 Provider。保存文本/截图/阶段耗时，结束后退出合成身份、恢复原 storage/页面并撤销 mock。`output/weapp/` 与既有 Playwright 输出一样忽略提交。实际运行、两次保留失败和未测范围见 [平台报告](design/budget-travel-agent/G1_PUBLICATION_H5_2026-09-21.md)；本轮无产品功能/架构变更。

2026-09-21：G1 runner 保留历史 `status` 兼容字段，新增 `acceptance` 分列 `persistence`、`content=not_assessed`、`platform=not_assessed` 与 rubricVersion。脚本不能仅因保存/恢复成功推断内容或平台通过；此批仅离线语法检查，不触发新 live。

```powershell
node scripts/check-docs.cjs
git diff --check
# 准备提交后检查实际暂存批次
node scripts/check-docs.cjs --staged
```

新增脚本检查 docs Markdown 中可识别的本地相对链接，以及有非 docs 改动时是否同批有 docs 改动。默认检查工作区（包含未跟踪文件），`--staged` 检查暂存改动范围；链接均检查当前文件，不冒充读取暂存文件内容。

限制：不访问外链、不检查锚点/反引号路径、不证明语义正确，也不能判断某篇文档是否真正匹配代码改动；这些仍需人工/Agent 审查。未安装 Git Hook 或 CI 强制门禁，不能声称未来所有修改会被自动拦截。没有修改 package.json 或依赖。Windows 沙箱禁止 Node 启动 Git 子进程时，需要允许该只读检查运行，不应关闭检查伪装通过。

## 当前清理决策

### G1 单次验收辅助脚本

`backend/scripts/verify-g1-live.mjs` 默认只打印 dry-run 固定案例；`node --test backend/scripts/g1-budget.test.mjs` 使用假的网络响应验证付费准入边界。真实执行需先构建 backend、准备 loopback 专用 `flightor_g1_live` PostgreSQL，在 backend 目录给该进程传 `G1_DATABASE_URL` 与本批已确认的 `G1_AUTHORIZED_USD=2` 后运行 `node scripts/verify-g1-live.mjs --execute`。变量是执行围栏，不替代用户对新批次的授权。

脚本使用当前 `.env` 凭证但不修改文件，所有迁移/测试身份只进入专用数据库；输出留在忽略的 `backend/.demo/g1-live-*`。账本必须在请求前持久预留，不能删除账本或启动新目录来重置本批额度。实际结果与未知费用在 [EVALUATION](design/budget-travel-agent/EVALUATION.md) 和 [progress](design/budget-travel-agent/progress.md) 维护；当前脚本不承担正式 A/B 或真实平台绘制验收。

“清理”优先移出有效入口并纠正错误，不销毁有价值的来源/验收证据。不因为旧文档存在就恢复旧功能或执行旧任务。

G1 续跑：设置 `G1_RESUME_LEDGER_DIRECTORY` 指向本仓库 `backend/.demo/g1-live-*` 的既有账本。dry-run 只读显示累计占用及剩余次数；真实执行使用原账本，保留全部历史调用和未知费用预留，新的报告/回执另存目录并记录 startingBudget。meter 对原账本加独占锁并校验版本、金额/模型/调用记录；缺失或损坏账本不能视作零消费。进程正常退出释放锁，异常残留锁需先核对持有进程，不盲删。此改动不增加原 US$2、24 模型、12 搜索上限，不构成新的调用授权。后续次数调整须记录明确许可，不能通过新目录绕过限额。

| 文档/类别 | 处理 | 原因 |
| --- | --- | --- |
| README、PROJECT_CONTEXT、CODEX_KICKOFF_PROMPT | 重写当前入口；旧 PROJECT_CONTEXT 归档 | 修正过期工作区、旧模型设置、缺 DB 配置 skip、没有跨版本例外等错误 |
| backend-architecture、deploy、multi-city-plan | 4 份归档中的另外 3 份；原路径改当前简明指南/范围入口 | 清除无后端、前端 key、Mock 自动降级、旧多城主链等误导 |
| FLIGHTOR_ARCHITECTURE、TOOLS | 保留权威，补当前 checkpoint 与拟议边界；修迁移现状和 docs 位置 | 不把目标状态冒充实现，不在清理时删除业务不变量 |
| ADR 0001–0017 | 保留已接受历史决策 | 后续 ADR 可以细化，不篡改旧决策当时的验证记录 |
| ADR 0018 | 保留 Proposed 后续能力方向 | 明确完整队列/visits v2 非本轮前置 |
| ADR 0019、RUNTIME_PLAN、DPS、EVALUATION | 当前拟议实施与测试入口 | 2026-09-24 起，本次授权的 DSH 工作以 D0→D4 为执行顺序；既有 R/U 与条件 C1 评估顺序保留为历史依据，不作前置 |
| RAS、RDS、UX_REVIEW、progress | 保留需求/能力全景/诊断；删除重复阶段顺序，进度集中 | 避免多份“唯一计划”竞争 |
| 6 份 HANDOFF、DEMO_STATUS、PHASE789_ACCEPTANCE、UI_PARITY_ACCEPTANCE | 原位标历史，不改原始结果 | 分支、端口、调用额度和设备证据只适用于记录当时 |
| FLIGHT_FIRST_TASK、local-wechat-integration、链路探讨 | 原位标历史，链接当前入口 | 历史任务/讨论不等于当前执行授权或链路 |
| FLIGHT_FIRST_ACCEPTANCE、CALL_ANALYSIS | 保留具体日期的实测证据 | 一份为航班优先失败，一份为自备机票成功但质量有问题；不能混称端到端成功 |
| docs/experiments 的 4 份报告 | 标记研究组件历史实验，保留原结果和案例引用 | 不作为完整 Planner/Harness 排名；旧额度不沿用 |
| design/ui-experience-v1、phase6-design-system | 统一当前蓝色与历史参考，修坏链接 | 不再出现顶部要求蓝色、正文指导海洋青的当前规范冲突 |
| design/travel-guide-mvp、admin-design-system、概念 PNG | 保留，说明作用范围 | 前者为阶段 MVP，后者独立后台视觉/设计参考；非无用素材 |
| local-test-login、oag-integration | 保留专题说明并从当前索引导航 | OAG 可选；本地身份不等于真微信登录 |
| demo/ | 新增暂停入口，保留制作说明与文案证据 | 不执行录制；已有未跟踪 DEMO_MASTER 内容未动 |
| archive/legacy/ | 加历史警示并修相对链接 | 保留可追溯原稿，禁止当当前运行手册 |

本轮不删除证据、图片、旧 ADR 或用户未跟踪文件；从活跃指南清除了重复/错误的大段内容，归档可追溯。没有为每份文档新建副本，仅归档被整体重写的 4 份旧稿。

## 已发现的证据缺口

2026-09-20 追加复验：用户明确“确认，完整复验”，允许累计 48 模型/24 搜索，共用原 US$2。验收进程设置 `G1_AUTHORIZED_CALL_LIMITS=48/24` 并必须指定原 `G1_RESUME_LEDGER_DIRECTORY`；缺省仍为 24/12，参数不代表未来新授权。新增用例验证续跑累计计数和费用不清零，最终 12/12 通过（0.810 秒）。真实结果继续记录在 G1 报告与 progress。

东京分析末尾的 4 个 `.demo` 本地诊断文件当前不在本工作区，已将失效链接改为历史路径并明确缺失；内嵌历史统计保留。本轮没有重新获取原始账本，因而只能核对报告内部与源码，不声称重算原始耗时。

UI 文档引用的 `UI_PHASE_HANDOFF.md` 不存在，改为实际存在的 UI 清理交接和航班优先验收，明确哪些仅为当时样稿状态。

最终检查结果集中在 [progress](design/budget-travel-agent/progress.md)。

2026-09-21：runner 支持 `G1_CASE=self-ticket` 或 `selected-flight` 选择原有固定案例；不传仍运行两例，其他值拒绝。单例续验也必须沿用原账本/次数限制，不能当作完整两例验收。新增 source reader 公共网页 HTTP 有独立 span，与收费模型/搜索计数分开。

## 2026-09-22 正式终稿 UI 验证脚本

`node scripts/qa-publication-ui-h5.cjs` 在已构建且由 `node scripts/serve-h5.cjs` 提供的10086 H5上使用已安装 Chrome，拦截 API 运输为冻结 fixture；`node scripts/qa-publication-ui-weapp.cjs` 使用既有9432 SDK与已登录模拟器，只替换 wx.request，finally 撤销 mock、恢复原语言/页面，不替换登录身份。脚本各自保留失败 JSON，成功报告/截图在忽略的 output/playwright/publication-ui 和 output/weapp/publication-ui。固定材料来自上一任务终稿示例与旧双入口 fixture，不调用模型/研究，不证明真实 API或真机验收。不要并发运行两个微信 fixture 脚本或在真实付费规划运行时替换 request。实际结果与失败经过见 [报告](design/budget-travel-agent/PUBLICATION_UI_2026-09-22.md)。


## 2026-09-22 地点验证脚本

`test-places-postgres.mjs` 仅使用 loopback DB 的新 `places_test_<timestamp>` schema，测试后删除该隔离schema；不操作生产业务。`places-live-server.mjs` 使用保留的 `places_map_20260922` schema及独占账本锁，只有 `--execute` 允许最多24次已授权Nominatim调用；`--acceptance` 保留原调试攻略并建最终验收副本，`--refresh-token` 仅更新隔离验收身份。`reparse-places-validation.mjs` 仅对隔离调试记录利用保留response作离线诊断，保存修改前后记录，不重置账本、不作为真实端到端证据。

`qa-places-h5.cjs` 验证正式H5、真实地点API和真实OSM瓦片；`qa-places-weapp.cjs` 使用现有SDK与真实持久地点的fixture transport，合成登录后恢复guest/storage/locale/mocks。严格检查认证GET、标记数量和稳定ID；SDK回调不认证底图。真实调用15/24、独立测试、截图及微信空白底图缺口见 [地图报告](design/budget-travel-agent/PLACES_MAP_2026-09-22.md)。output保留所有失败，本轮可分享报告/代表截图另存docs；不提交token、guest存储备份或transport文件。

## 固定版本地图观察脚本（2026-09-22）

`node scripts/prepare-fixed-map-observation.cjs` 要求52cb1c3干净dist，复制到忽略目录并增加诊断宿主页；不修改正式桥接、不查询POI。生成manifest记录app/route/bridge字节SHA，SDK同时读取运行中桥接方法，避免只认入口指纹。固定窗口截图须OS与SDK成对，updated不认证底图。

`backend/scripts/probe-place-egress.mjs --execute --request-proxy` 使用服务端PLACES_PROXY_URL和原账本独占锁；PLACES_PROBE_LEDGER_DIRECTORY可指向原目录。一次执行仅一次解析，TLS正常。旧24次账本兼容，用户明确取消次数后才使用limit=null且unlimitedPlaceCalls=true；不是自动无限重试。places-live-server同样读取此授权标识，未启动新的harness。用户要求重置USD2后采用有哈希链接的历史归档，新批次费用0，未删除旧记录。具体验证见[报告](design/budget-travel-agent/MAP_CLOSEOUT_2026-09-22.md)。
`test-place-media-stale.cjs` 使用延迟媒体 Promise 驱动实际 RoutePage hooks，离线验证账号、会话、行程、请求代次和内容版本切换后旧结果被忽略；与 media-client 一并纳入 `npm run test:production-presentation`，不发外部请求。

2026-09-25 H5 DSH 单轮验收脚本增加权威 GET 快照与 `scripts/dsh-h5-assertions.cjs` 断言辅助：同一 session、局部修改不变区域、权威总预算、英文仅本地化调用及恢复零付费副作用。`node scripts/test-dsh-h5-assertions.cjs` 为纯离线断言/反例测试，不启动浏览器或供应商；3/3 通过。真实执行仍只由 `qa-dsh-e2e-h5.cjs --execute` 显式单次触发并受后端 gate 约束；离线通过不代表当前 commit probe 或真实多轮通过。具体边界见 [DSH live记录](design/budget-travel-agent/DSH_LIVE_2026-09-24.md)。

2026-09-25：DSH H5 harness 兼容正式前端省略完全空会话的缓存行为；仅在保留原私有状态备份且真实 GET 确认同 scope 云端消息/产物全空后恢复原空身份壳。新增反例后离线4/4通过，真实headed Chrome `--prepare --case A`只读通过、账本哈希和调用数不变；不改前端，不覆盖已有对话，不推断付费验收通过。

2026-09-26真实多轮故障后，显式retry-terminal扩展到第2/3轮：只允许已结束失败验收且原正式API未satisfied，原前后accepted攻略及Trip逐项不变，fresh恢复时再次检查同一base。第3轮持久消息必须完全不变；解释重测允许后续追加消息但旧前缀不可变。重启404还须原PID退出/hash绑定证明，增加已知not_requested/responded终态支持。保留旧attempt并独占新前驱SHA文件，不自动重发。该恢复脚本不放宽领域validator或付费单轮次数。
多轮显式重测可在原历史后追加完整只解释对话；每一对均须user/assistant、responded/not_requested且artifactRefs空，原历史前缀、完整Trip、accepted base及所有引用必须不变。未完成或有写入的插入回合拒绝。

2026-09-26 B航班入口准备：verify-dsh-e2e --prepare-b检查同A的首轮真实satisfied/accepted及解释、局改、预算、恢复、英文各已有成功H5证据才创建B。只在原schema和账本，隔离身份/Trip，航班明确synthetic，去掉bookingURL，通过正式PATCH采用及独立GET核对revision。setup门禁仅临时允许该Trip PATCH；启动保留B后只读恢复既有选择，不能改选。夹具创建意图先写本地状态，重启按固定artifactID恢复，不再次搜索票价；网页规划仍须正式输入框。未实际运行前不能宣称B已验收。
