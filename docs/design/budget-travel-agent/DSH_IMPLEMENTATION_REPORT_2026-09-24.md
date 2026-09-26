# DSH 后端实施记录

2026-09-26 18:04最终功能验收：**DSH正式H5 E2E PASS（限定本次后端替换，G1仍未放行）**。A自备机票的解释/局部修改/全程1200预算/刷新/显式官方英文与恢复已验；B先通过正式API采用synthetic fixture航班，再真实H5规划、解释、slot修改和刷新通过。B最新修改5主模型/1官方搜索/2fetch/2commit，一次修复后accepted+satisfied并可读，点击→UI26.115s，第一天/其他slot/航班revision不变；刷新零调用。B初版预算保证错误与全部失败不追认，最新公开文字无该保证；人流推论/事实时效仍有内容质量限制。实际官方DeepSeek模型及搜索，不是mock攻略；原账本258模型准入/68搜索、US$15.76未知预留、pending0/unlimited，不是实际支出。27份运行日志违规旧Planner/Runtime/Research/非本地化Finalizer调用0（23份有guard，其余无HTTP）。后端代码commit bf42bf80283ba39f062c37db79d9d0a92bd20f32；前端授权最小修复8233a84/8626876；runner/harness代码commit be8b8937a1e787ca79012bf8c92495f5ac3f4d6b；报告与证据由包含本记录的后续docs提交交付，最终交付SHA见任务最终回复/远端分支HEAD。原工作区main=8a83b03及未提交内容保留。完整17项映射、两例公开文字、逐阶段时间、配置指纹及已知限制见[现有D4报告](DSH_LIVE_2026-09-24.md)。

2026-09-26 18:13图片附加诊断：隔离runner media路由403已修，真实POST200后4活动仍empty；3个source_identity_required、浅草寺与雷门为ambiguous_or_unsupported，均在Wikimedia出站前返回。照片尚未显示，不称下载失败/图片PASS；0Agent/模型/搜索及账本不变。详情与截图见[D4报告](DSH_LIVE_2026-09-24.md)。

2026-09-26 17:57：B第2轮真实解释同session resumed=true、1模型0搜索0新攻略，点击→UI6.874s通过；09:55浏览器spawn EPERM零POST/调用的旧失败保留。回答夜间人少反推上午人流可控的推论薄弱，明确不是事实已核实/G1通过。预算保证检查新增13个反例后131项及build通过，B局部修改/恢复与修正后真实publication待证据。媒体GET200/activities为空说明未补全，不虚称下载失败。闭合账本252模型/67搜索、US$15.44未知预留，整体仍FAIL；全文和截图见[现有D4报告](DSH_LIVE_2026-09-24.md)。

2026-09-26 17:51：B第七次真实H5发送首次accepted/satisfied且概览/两天5项活动可读，click→UI27.713s；4主模型0搜索0fetch、一次修复后commit接纳。来源复用09:31同B会话真实官方搜索/正文形成的持久research，不能冒称成功轮新搜索。Artifact/hash/session/完整公开文字、源evidenceRef谱系和截图在[现有D4报告](DSH_LIVE_2026-09-24.md)。accepted reply中“整体预算仍在既定总额内”与undetermined预算冲突，内容验收缺口保留并继续修复；B解释/编辑/恢复仍待运行，整体E2E仍FAIL。原账本251模型/67搜索、US$15.40未知预留、pending0，不是实付；所有失败不删改。

2026-09-26 17:41：B第六次真实H5规划5主模型/0搜索/2fetch/3commit失败，依次为GOAL_INTENT_REQUIRED、candidate_evidence_unavailable及DSH_REPAIR_LIMIT，无accepted。首调用在intent准入处消耗尝试，未进入此前组合领域反馈修复，不误归Provider或金额问题。DSH raw schema/turn边界提示修复待正式复验；[既有D4报告](DSH_LIVE_2026-09-24.md)保留失败原文、截图和阶段耗时。只读账本247模型/67搜索、US$15.24未知预留、pending0；A能力通过，B待验，整体仍FAIL。

2026-09-26 17:36：A所要求能力经保留失败/修复/恢复后均已真实验收（不是首次请求连续成功）。09:28正式H5正确显示预算确认并刷新零调用，09:36当前v4英文/中文/预算/全部活动恢复一致零调用；英文来自08:24那次真实官方生成，09:30生成入口因已accepted而前置拒绝零调用，不能误记Provider失败。用户授权的前端预算字段最小扩展单独commit8626876（3files），其余后端根因修复仍未提交。B09:31第五次真实规划9模型/3搜索/5fetch/3commit仍因重复candidate、精确声明及修复限制失败，无accepted；反馈修复31/31 3.62s与build通过，真实续验待结果。闭合快照242模型/67搜索、US$15.04未知预留，完整E2E仍FAIL；证据在[既有D4报告](DSH_LIVE_2026-09-24.md)与[多轮索引](dsh-e2e-evidence/h5-multiturn-attempts.json)。

2026-09-26 17:28快照：B09:19第四次实际规划失败，8主模型/1搜索/3fetch、3次commit依次遭旧版本引用、重复candidate、修复次数限制，accepted0。当前候选/历史研究提示和主Agent选择约束已修，未降低保存validator或加循环；正式续验待结果。后端全量120文件1070项通过152.70s（17:24:14启动日志保留）；全量启动后新增研究读取测试另跑77/77 8.37s及tsc通过，不将后加用例算入先前全量。前端14/14/build31.335s、history19/19、PG4/4各自通过，A预算真实读回及当前版本英文待新证据。闭合失败账本230模型/64搜索、US$14.32未知预留、pending0；[D4报告](DSH_LIVE_2026-09-24.md)与[多轮索引](dsh-e2e-evidence/h5-multiturn-attempts.json)保留失败原文/截图/计时，整体仍FAIL。

2026-09-26 17:14：B09:05真实H5第三次首轮失败，5模型0搜索，2commit均Goal幂等冲突，无accepted。只读PG证据确认跨重启两代HTTP `req-i`重复；持久身份修复已离线通过，真实续验待结果。用户明确批准预算回合同一前端字段选择最小扩展，14/14回归与H5构建31.335s通过；A09:14只读准备零调用但只捕获landing，不能作为预算回复UI通过证据，后端history覆盖预算文字问题仍待修复/读回。完整原文、截图、请求身份证据与阶段时间见[现有D4报告](DSH_LIVE_2026-09-24.md)。此时累计221模型/63搜索、US$13.88未知预留，不是实付；整体仍FAIL。

2026-09-26 16:52快照：A08:41真实setter已获trip_context_update satisfied、1200总额/当前accepted攻略保持，但H5显示旧局部修改reply，本轮预算回复显示仍未通过（runner observed不覆盖该缺口）。B已正式采用明确标记的synthetic机票fixture；08:44真实前端准备0POST，08:45真实官方规划12主模型/8搜索/10fetch/2commit失败于发布format及候选修复；08:52续验3模型0搜索后在下一模型准入遭本地文件EPERM，仍无accepted攻略。两次失败及截图、全文、时间、usage保存在[现有D4报告](DSH_LIVE_2026-09-24.md)与[多轮证据](dsh-e2e-evidence/h5-multiturn-attempts.json)。累计216模型/63搜索、US$13.68未知预留、pending0，不代表实付；HEAD8233a84，后端修复待真实续验，完整E2E仍FAIL。

2026-09-26 16:32：真实预算确认仍失败，1模型0搜索0工具，当前预算/accepted攻略未变；“不是每天1200元”被公开文本检查误拦，脚本另将无操作确认错误要求为新写入satisfied。原报告/截图保留于[现有D4记录](DSH_LIVE_2026-09-24.md)。公开边界36/36（0.935s）、真实setter回执72项（9.52s）及TypeScript检查通过；下一次H5应验证合法no-op确认的not_requested/responded，不追认新写入。累计188模型/55搜索、US$11.92未知预留；实际确认复验和航班先行B尚未执行，完整E2E仍FAIL。

2026-09-26 16:24增量快照：A正式H5已验证accepted攻略显示、解释、指定slot修改、1200元全程预算后的攻略恢复、显式官方DeepSeek英文及切回原中文。08:10预算续验未执行工具、08:16服务不可达零POST、08:19新v3攻略accepted但父trip_context_update仍partial且页面回复等待超时，三次失败均保留，**完整E2E仍FAIL**；父Goal同值budget写入判定及先采用航班B仍待后续复验。08:23恢复0调用，08:24显式英文只调用1次官方本地化、0主Agent/搜索、切回中文零调用且内容一致。该点累计187模型/55搜索、US$11.88未知预留，实际账单unknown；主Agent4096与本地化8000为不同既有配置，不是主模型升档。用户批准的唯一前端回复字段修复已提交`8233a84`。完整公共文字、Artifact/hash、计时、token回执和截图在[现有D4报告](DSH_LIVE_2026-09-24.md)及[多轮证据索引](dsh-e2e-evidence/h5-multiturn-attempts.json)。新增离线55/55 DSH回归39.02s、预算helper17/17 6.00s、H5断言7/7；不据离线结果宣布真实父Goal或B通过。

2026-09-26 15:50增量：真实H5从原Trip重开并刷新，accepted概览、两天7项活动和详情已实际显示，0新Agent/model/search。原点击到此次恢复含过夜中断及修复63,363,467ms，不称连续首轮成功。第2轮首次后端解释正确但UI失败，获用户前端最小例外授权后修复公开字段选择（13/13回归、H5 build62.721s），07:48重试页面解释通过，1模型0搜索0保存。第3轮首次Goal intent失败保留，07:49重试accepted＋实际页面通过，第一天/第二天上午/航班不变，仅下午换室内资料馆，点击→可读32.911s。第4轮预算已更新1200 CNY/trip、2模型0搜索，但notes断言及旧guide版本失效仍阻碍后续恢复/英文；**完整E2E仍FAIL**。该点累计182模型/55搜索、US$11.68未知预留；完整公共对话、截图、session/hash与逐阶段证据增量保存在[现有D4报告](DSH_LIVE_2026-09-24.md)及[多轮脱敏记录](dsh-e2e-evidence/h5-multiturn-attempts.json)。前端原零改动承诺已由用户明确最小例外覆盖，未重做UI。

2026-09-25 22:00 H5最新证据：正式前端三次真实发送冻结A首轮；13:37/13:45 UTC分别因研究上限、重复candidate及错误修复失败。13:59 UTC一轮已真实生成中文accepted攻略并返回satisfied，Artifact `01a0d8de-2690-7589-b437-e2adc39ad11a`、hash `a9f02e69a8306bea5055e181176be83be65683f239d4e5c1c276fbb62cc68ed0`；9主模型/3官方搜索/5fetch、一次format修复，点击→API终态65.785s。但正式详情打开旧失败草稿，显示“当前语言生成未完成”，没有可读accepted概览/活动，因此**完整DSH E2E仍FAIL**。实际失败截图、公开全文与逐阶段证据见[既有D4报告](DSH_LIVE_2026-09-24.md)和[H5脱敏尝试记录](dsh-e2e-evidence/h5-round1-attempts.json)。截至该点累计163模型/53搜索、US$10.76未知费用预留；不限预算授权继续有效，未宣称actual cost。首次可读UI、解释、局部修改、刷新、英文及B均仍待后续验收，前端源码未改。

2026-09-25 本次继续基线 `d669629d2273ce6343d9d2174f07c51b2c86d63d`。用户明确取消本任务累计预算限制，已在原账本追加可审计 unlimited 授权，91 条旧记录及 US$6.20 未知预留保持原样；默认生产配置仍有限额，逐调用记账和每轮停止限制不变。详情及本次真实验收结果在[现有 D4 报告](DSH_LIVE_2026-09-24.md)增量维护，不能据授权或离线通过宣布 H5 已通过。

2026-09-25已推送代码checkpoint：`babf6c7c55161f75be0f61145e58c71b0beab79e`（续作基线`765f3acf65faf5aa23f5c0029f123b02018aee59`，main仍`8a83b032a8ee18097af62304d99df86f9a543489`）。该提交是已验证修复与失败证据交付，不是D4完成提交；后续报告记录可单独提交，不改变该代码SHA。保留主工作区配置/output修改，不强推、不合并。部署回滚仅需设置`FLIGHTOR_AGENT_ENGINE=legacy`并重启后端，DSH测试账本/会话保留；本轮验证从未执行此回退。

状态（2026-09-25 21:28探针证据点）：D0–D3后端实现与离线/数据库回归完成。D4原始A/B首轮及前六次commit探针均失败；第七次最小commit现已通过真实官方模型、官方搜索、正文证据、accepted中文发布与独立GET恢复。正式H5多轮验收正在继续，本探针不证明前端已显示或多轮已通过，**D4仍未通过**。未部署、未关闭G1。用户2026-09-24明确优先DSH，取代旧R/U与条件C1前置；范围见[原附件方案](DSH_IMPLEMENTATION_PLAN_2026-09-24.md)。

首次真实最小攻略：COMMIT-7在24.910s内完成，5次官方主模型、1次官方搜索、2次正文fetch、2次commit（先format拒绝、同turn一次修复后accepted）。Artifact `01a0d8c0-f4dc-733d-bfff-5a848688c27a`的中文publication accepted、delivery satisfied，hash `84ed95b7f2b74a90fca37f1d168acd6a52d03c25a9cdd31edd0f2255d21137d4`，正式独立GET读取相同内容且账本不变。模型仍`deepseek-v4-flash/thinking disabled/max_tokens4096`，末次正常stop，首次独立Finalizer调用0。来源为浅草寺官网和JNTO中文真实正文，保留partial verification及预算undetermined，不自行认证事实或保证费用。COMMIT-5/6的26.600s/33.785s失败与US$0.36/0.40未知预留保留，第七次新增US$0.32；该证据点累计112模型/35搜索、US$7.28未知预留，当前授权无累计上限。详细generation/session/profile、source IDs、逐阶段时刻、token/cache及公开文本见[D4报告](DSH_LIVE_2026-09-24.md)和[全部11次probe证据](dsh-e2e-evidence/probes.json)；新增三份安全observer，原八条probe证据不改写。H5点击→可读攻略时间在此API探针中未测量。

2026-09-25 09:58：新增US$2/32模型/8搜索授权已审计追加原账本，累计上限US$7/128模型/32搜索。第四probe因无有效正文持续研究，累计32搜索上限触发，保守占用US$6.20、余US$0.80；主模型10次、搜索准入9次（实际官方HTTP8次）、fetch11次，75.156秒，无commit。免费HTTP诊断确认200拦截页及可用JNTO对照，下一probe范围与旧失败Goal隔离；详细标识、失败分布及仍未通过边界见[D4 checkpoint](DSH_LIVE_2026-09-24.md)。修复后合并离线160项、独立PostgreSQL1项、build通过，前端源码diff为0。worker计数不再包含被拒绝的第13尝试，关闭等待子进程真实退出后释放目录锁。

基线 `origin/main@8a83b032a8ee18097af62304d99df86f9a543489`，已 fetch。隔离工作树 `.worktrees/dsh-backend`，分支 `codex/dsh-backend`。原 main 的 `output/` 未跟踪内容保留；不合并或部署。

## D0

2026-09-24 19:49（Asia/Shanghai）开始独立 runtime 实施。核验官方固定提交 `46a7f68b0922371ce7144b668b90e377d8e799f4`；npm 的 DSH 核心实际发布 `0.1.7-rc.1`，Cordis `4.0.4`；本机 Node `22.21.0`。独立 package/lock 不改变前端依赖。

显式组合核心插件；不加载 sdk/sdk-minimal、用户 profile、shell、文件工具、Git、PTC、subagent、插件安装、session-log 或 inventory 上传。Session JSONL 是内部持久化，不是模型工具。插件和工具执行白名单由代码强制。

D0 当时未进行付费调用、费用 0，未取得本批额度。后续用户已配置官方 DeepSeek 模型/搜索 Key，并明确授权本批 US$2、48 次模型调用、12 次搜索请求（含失败），达到任一上限停止；历史额度未复用。

D0 20:03 核心与独立 worker 两项测试通过（Node test 0.751s）：真正 AgentLoop 工具、followup、cancel、JSONL resume；worker private IPC、结果相关 ID 和模型调用数。最初两次分别暴露消息 id/source 缺失，已使用 createUserMessage 与 flightor-context 来源修正。无网络模型调用。

## D1

20:04 至 20:17：抽出四方法 `PlannerServicePort` 与共享 `PlannerDomainService`，配置先选择引擎再检查对应凭证。D1 提交 `b12e809aa3fd483f36be670bc16953cb059815af`；D0 提交 `6fbd5c7e6b8b4b5f596d98edcbb8a5369500ae98`。4 文件16项定向服务/API/配置测试通过（8.66s），DSH 真实 worker 的只读多轮中旧 `CloudPlannerService.runTurn`、`AgentRuntime.run` 和首次 Finalizer 均未调用。

## D2 实现与验证

20:17 起接入官方 `web`/`tool-web`、原始 SerpApi provider 与独立显式 `web-search-deepseek`。当前本批选官方 DeepSeek：模型 `deepseek-v4-flash`，`https://api.deepseek.com/v1`；搜索同名模型，`https://api.deepseek.com/anthropic/v1/messages`。这是当前配置，远端成功须看 D4 实测。Key 不进入文档、数据库或提交。

来源自动记录原始 URL、标题、snippet/body、hash、时间、状态/截断和不透明 evidenceRef；本轮组合工具将材料转换为既有 ResearchArtifact，然后一起提交日程及当前语言 FinalText。复用领域验证/Goal completion/publication，默认首次无独立 synthesis/Finalizer。失败草稿不公开，不能由模型设置 accepted。具体合同见 [来源](DSH_EVIDENCE_2026-09-24.md)、[发布](DSH_PUBLICATION_2026-09-24.md)、[预算](DSH_BUDGET_2026-09-24.md)。

官方适配器本地 HTTP 测试 1/1（2.061s）验证实际 `llm-pi-ai` 与 `web-search-deepseek`、两次模型/一次搜索、请求前计量和来源回执。测试发现并修正搜索 provider ID 和缺少 `/v1` 的默认地址；未发送远端请求。集成发布/组合工具56项、证据9项、预算初版17项分别通过。后续全部结果列于最终验证。

## D3 实现与验证

D2 提交 `52116d6`，包含联网写入所需的计量 IPC、会话安全基础与对应单测；D3 单独提交取消 API 和新增多轮/数据库/前端回归证据。

与 D2 收尾交错执行，未伪造互不重叠的开发耗时。Session manager 持久 owner/Trip/conversation scope、profile 与 Memory epoch；warm followup、冷 resume、容量及空闲回收；退休旧会话后只注入当前数据库状态。Memory 关闭时不重新注入先前 assistant 的推断文字，只保留用户显式历史和当前受控领域上下文。

取消先隔离 generation 并停止 worker，再等待父进程实际工具 Promise 完成，API 确认后方可开始竞争回合。重复 IPC 返回缓存结果，不重写领域数据；工具名/参数严格验证；root lock 的获取/回收/释放均受独占 guard 保护。局部攻略修改按 slot 服务端合并并比较受保护活动。最终引用核对 Trip 与 flight revision。详见 [会话](DSH_SESSIONS_2026-09-24.md)。

会话15/15通过（20.05s），API/turn取消15/15通过（9s），先前超时的取消用例串行复验881ms；没有放宽超时。旧service6/6重跑通过（11.67s）。全量离线20:48:56开始、186.97s结束：115文件949项通过，新增多轮 fixture 1项失败（正在修复，不能声称全量通过）。真实数据库初跑37/39，两个陈旧 legacy Finalizer mock修正后定向2/2通过（12.90s）；原失败保留在[数据库报告](DSH_DATABASE_2026-09-24.md)。

21:02 定向收尾：新多轮 fixture 已修正为合法 ResearchArtifact（一致持久ID、完整verification），同时限制组合提交的公开引用为 flight_search/travel_guide，内部 route 不另发用户结果。实际 worker 执行发布→解释零新增攻略→冷 resume，两服务测试2/2通过（6.18s）。预算增加“任一正数调用上限达到后全部停止”断言，18/18通过（3.49s）；runtime全4项通过（2.207s），backend build通过。上述是失败修复后的定向证据，不改写此前全量失败记录。

前端仅运行回归，零源码/依赖改动：conversation progress、session recovery、artifacts、production presentation 共161明确计数项和2媒体断言组通过（17.585s）；范围见[前端回归](DSH_FRONTEND_REGRESSION_2026-09-24.md)，不代替H5/微信真实验收。

新增真实 PostgreSQL DSH 回归1/1通过（9.20s）：官方 fixture worker、真实 owner-scoped repos/JWT GET，完成保存→解释零写入→仅第二天下午替换→Trip总预算1200→冷恢复。两个Goal/Run满足、首次独立Finalizer/旧Runtime调用0，旧版本Artifact不可复用，GET blocked/stale投影不启动Agent。运行在独立随机schema，与D4固定schema分离，费用0。

## D4

独立live runner核对冻结双对话、D+30/D+31日期、固定schema与新预算后真实执行。A在96.542s首轮失败：来源桥接用了不存在的exec.args，修为官方exec.arguments并补完整文件证据链测试。B在67.582s首轮失败：已持久21份来源（3份正文可引用），但默认推理耗尽4096token；修为官方profile显式thinking disabled，并退休旧profile会话。本地HTTP断言修复通过，未重新执行真实双例。

两例后续解释/局部修改/预算变更以及英文localization均未运行，不能把离线/数据库多轮作为真实对话通过。没有攻略accepted，没有宣布事实已核实。实际主模型13次加官方搜索10次，共23/48模型额度，10/12搜索；未知费用保守预留US$1.72，实际账单金额unknown，余US$0.28，原账本保留、无pending请求。详细双对话、各API/模型/搜索耗时见[D4记录](DSH_LIVE_2026-09-24.md)及[脱敏结果](DSH_LIVE_RESULTS_2026-09-24.json)。

## 交付运行面

固定DSH npm核心包均`0.1.7-rc.1`，Cordis`4.0.4`，zod`4.4.3`，完整传递依赖锁在backend/dsh-runtime/package-lock.json；验证Node22.21.0。显式插件白名单：`llm`、`session`、`session-projection`、`system-prompt`、`tools`（native）、`agent`、`session-persistence-jsonl`、`agent-loop`、`llm-pi-ai`、`web`、`tool-web`、`web-search-deepseek`（官方搜索路线）。SerpApi路线用FlightOR原始provider注册，不加载官方搜索插件。不加载完整sdk profile、shell/文件/Git/PTC/subagent、DSH Goal/Task/Todo、插件安装、session-log/inventory上传。

模型可见工具15个：`get_trip_context`、`get_trip_artifacts`、`read_artifact`、`resolve_location`、`get_user_memory`、`get_active_goal`、`update_trip_context`、`search_flights`、`search_flexible_flights`、`confirm_flight_price`、`update_user_memory`、`start_route_generation`、`commit_travel_guide`、`web_search`、`web_fetch`。7个内部web/计量桥接名称不对模型开放。白名单、单worker单活跃turn及禁止旧Planner/Runtime由代码和测试围栏验证。

| 阶段 | 开发/提交时点 | 可独立计量的验证耗时 |
| --- | --- | --- |
| D0 | 19:49–20:04:40，约15m40s | 最初核心2项0.751s；最终runtime4项1.937s |
| D1 | 20:04:40–20:17:14，12m34s | API/service/config16项8.66s |
| D2 | 20:17:14–21:05:50，48m36s，包含交错D3开发 | 组合发布56项4.57s；预算最终18项3.49s |
| D3 | 与D2交错；21:07:33独立提交c04acea，不把1m43s提交间隔当完整开发耗时 | session15项20.05s；取消15项9s；DSH PG1项9.20s；前端17.585s |
| D4 | 21:07后真实测试、诊断修复和交接 | A96.542s、B67.582s；最终全部DB40项42.39s；最终离线结果见下 |

前端证明：与基线比较`git diff origin/main -- src package.json package-lock.json`为空；本批全部产品改动在backend，公开API schema未更改。原main及各既存worktree保留，没有强推、合并或部署。

## 未解决项与回滚

截至2026-09-25 21:28，累计预算限制已由用户明确取消，官方凭证可用，最小真实攻略首次accepted；旧US$0.28/0.80余额阻塞是历史状态。当前剩余验收为正式H5的冻结A完整多轮：实际发送与显示、解释、局部修改、总预算变更、刷新零调用、显式英文与中文恢复；A全部通过后再跑已采用fixture航班B。最小API探针不替代这些步骤。地图底图原问题继续暂停，不能声明整个G1通过。

运行限制：私有文件持久存储仅单主机/单API实例；无分布式租约；进程中断后的临时HTTP turn不自动重放，后续显式用户回合可冷resume持久上下文。Trip budget更新使旧材料过期，不能任意跨版本复用；这不是自动预算可行性证明。未知费用按预留计入，本批没有可靠供应商货币回执。

启动：backend/dsh-runtime内`npm ci --ignore-scripts`，backend内`npm run build`，配置`FLIGHTOR_AGENT_ENGINE=dsh`及所选路由Key、持久数据目录、当前明确预算后启动后端；本地操作命令见[部署](../../deploy.md)与D4记录。回滚：设`FLIGHTOR_AGENT_ENGINE=legacy`并重启后端，保留数据库、.dsh-data及预算/失败记录；不需要改前端或执行数据回滚。关闭验证runner用SIGINT/SIGTERM；独立数据库的精确停止方式见[数据库报告](DSH_DATABASE_2026-09-24.md)。

## 最终离线验证

2026-09-24 21:43:38 起，在 `codex/dsh-backend` 工作树运行（HEAD `c04acea5f1305dac9e4e692be59eafb1f0702cd4`，包含本轮已修复而尚未提交的增量）。按要求顺序执行一次全量离线测试和一次构建，未重复全量。

| 命令 | 实际结果 | 耗时 |
| --- | --- | --- |
| `cd backend; npm test -- --maxWorkers=2` | **117 文件、952 项全部通过**；退出码 0，无失败 | Vitest 116.90 秒；含 npm 启动的外层墙钟 119.642 秒 |
| `cd backend; npm run build` | TypeScript 编译通过；退出码 0 | 外层墙钟 11.925 秒 |

完整 stdout/stderr 留在忽略目录 `backend/.demo/dsh-final-offline-20260924/tests.log` 和 `build.log`；同目录 `tests.result.json`、`build.result.json` 保留命令、退出码及精确毫秒。此次结果覆盖此前失败修复后的实际全量状态；保留前文 949/1 失败记录，不用成功结果抹除历史。

默认 Vitest 配置明确排除真实 PostgreSQL suites，关闭真实模型/航空/搜索凭证，DSH 使用 fixture 或本地 HTTP 适配器；本次没有真实 Provider 请求、模型/搜索费用为 0。数据库集成证据按前文独立报告评价；build 不代表部署、H5/微信真实验收或整个 G1 通过。

## 显式本地化的 Provider 协议与计量补强

DSH 显式本地化采用独立 `createDshLocalizationClient`：官方 DeepSeek 直接发送 `thinking: { type: "disabled" }` 和 `response_format: { type: "json_object" }`，将既有输出 JSON schema 加入 system 约束，再由原 GuideFinalizer 执行结构、身份和语言校验。官方请求不发送 OpenRouter 的 `reasoning`、`provider` 路由或工具字段；OpenRouter 路线保留既有 `reasoning.enabled=false`、`json_schema` 和网关路由语义。首次攻略仍由主 Agent 输出，不增加 Finalizer 调用。

每次显式本地化及其唯一允许的格式/语言修复在 HTTP 前写入同一 FileDshBudget admission；达到当前预算或次数上限即阻止后续请求。完成后记录 token、finish reason、实际 model/maxTokens/thinking 配置；仅供应商真实货币回执可结算费用，缺失费用或失败均保留预留，不推算账单。已取消请求不申请预算或发出 HTTP。测试仅向随机端口的 127.0.0.1 HTTP fixture 发送请求，不调用真实供应商。

验证：2026-09-24 23:26，四个目标套件共 **81/81** 通过（localization HTTP 5、OpenRouter 15、Finalizer 43、budget 18），Vitest 4.18 秒；`npm run check` 通过（9.87 秒）。本地 HTTP 测试逐项核对官方出站 thinking/json_object、OpenRouter 兼容、token/finish reason 和已知费用入账、预算拒绝不出站、失败保留预留、预先取消零请求。没有真实费用。本轮是上述全量验证之后的增量定向验证，不将前述 952 项全量结果改写为本增量全量通过。

## 2026-09-24 正式 H5 闭环续验：调用前修复与准备

续验基线为 `765f3acf65faf5aa23f5c0029f123b02018aee59`。重新 fetch 后远端 DSH 分支一致，`origin/main=8a83b032a8ee18097af62304d99df86f9a543489`；独立 worktree 继续开发，主目录原有配置改动与 output 保留。

- `DSH_MODEL_MAX_TOKENS` 替代 composition 的硬编码，默认仍4096、范围256–16384；未执行任何真实升档。worker 回执保存 model/maxTokens/thinking/finishReason/输入输出token。`max-tokens` 单独记录为 `MODEL_OUTPUT_LIMIT`，不当作 Provider 故障；不会自动重试或放大。
- 独立 worker 的本地 HTTP 纵向测试实际检查 `/v1/chat/completions` body：`model=deepseek-v4-flash`、`max_tokens=4096`/测试覆盖8192、`thinking={type:disabled}`，无 OpenRouter reasoning 字段。正常 stop 与 length 两种响应均通过，后者保持 max-tokens 终止原因；测试只访问 loopback，不代表远端复验。
- 官方显式本地化与公开回复边界详见本报告前段和 [发布合同](DSH_PUBLICATION_2026-09-24.md)。未增加审核 LLM、独立研究或首次 Finalizer。
- 本批定向12文件144项通过（26.95s，随后新增回执恢复用例另跑19项budget+6项legacy共25项通过，3.88s）；DSH PostgreSQL单个多轮综合用例通过（8.19s）；backend类型/构建通过。正式H5源码无改动，原有H5构建通过（webpack25.45s，两项原有bundle大小警告）；Chrome已打开真实规划页并核对输入框。这些结果均不证明accepted UI闭环成功。

旧账本仍保留23次模型/10次搜索、US$1.72未知费用预留，当前剩余US$0.28；未修改授权或发起新的付费调用。正式H5验收状态必须在后续实际点击、真实Provider、accepted持久化及页面截图齐备后更新，不能由上述测试推断PASS。

2026-09-24 本轮新增授权已明确收到：在旧账本上追加US$3、48模型、12搜索，累计US$5/96模型/24搜索。`FileDshBudget.extendAuthorization`仅供显式管理调用，不在Agent工具或HTTP自动准入路径；记录grant ID、授权引用、前后限制和时间，保留batchId、全部旧entries及未知预留，拒绝重复grant、pending请求和旧配置继续写入。此授权追加后实测旧entries完全相同，仍23模型/10搜索/US$1.72未知预留，可用US$3.28。追加持久化回归20/20通过（1.76s），独立runtime5/5通过（2.62s）。这不是费用归零，也不代表实际计费为零。

## 2026-09-25 保留的后续真实探针

从独立工作树基线 `765f3acf65faf5aa23f5c0029f123b02018aee59` 的真实私有state与安全observer记录核对：model只读探针通过，2次模型完成、调用`get_trip_context`，DSH manager `completed`，API语义为`responded`，耗时2.798s。官方DeepSeek搜索探针通过，4次模型完成、1次官方搜索，实际`web_search`后`web_fetch`，最终有1个可用持久evidenceRef，manager `completed`/`responded`，耗时10.039s。搜索返回的6个候选URL自身没有正文evidenceRef；被抓取正文才产生可用引用。未将这些探针当作攻略保存或质量验收。

账本仍是既有batch `d1a2aef6-d04d-4c44-9d22-6b1892226f95`：本次追加前保留23模型/10搜索及US$1.72未知预留；授权累计US$5、96模型、24搜索。当前累计72模型/23搜索、US$4.72均为已知金额或未知费用预留的保守占用（其中供应商实际美元金额仍unknown）、pending=0，剩余US$0.28。model探针前后23/10→25/10及US$1.72→1.80；首次失败的搜索探针对应25/10→30/11，安全observer `bdafd450-d898-4459-b2db-3e189dcaaf8a.jsonl`记录4个模型receipt和1个搜索receipt，但其回复被截留；之后的官方搜索探针通过，账本快照30/11→35/12及US$2.08→2.36。第三commit尝试开始56/19、US$3.76，结束72/23、US$4.72；其单轮增量16模型/4搜索、US$0.96预留。

三个独立真实commit尝试均产生终态API turn，但没有任何Artifact引用或accepted攻略：首轮66.318s、`goal_partial/partial`；第二轮100.423s、`model_failure/not_requested`；第三轮61.933s、`model_failure/partial`。第三轮model invocation 12产生的`commit_travel_guide`调用以`DSH_TOOL_FAILURE`失败；随后model invocation 13因调用上限被阻止，manager以`reason=error`结束。runner没有将HTTP completed误判为成功。相关修复仍在主任务处理中，不在这里追认通过。

同批配置为DeepSeek `deepseek-v4-flash`、`thinking=disabled`、请求参数`max_tokens=4096`。4096是单次输出配置，不是供应商额度/实际token消耗上限，也不提供真实美元计费上限；账本没有可信货币回执，未知费用继续以reserved计入。H5只读准备有三个独立结果：9/24 23:47准备通过，workspace GET可用、输入框就绪、4项观测事件、0次POST、0个浏览器错误且前后账本SHA256一致；9/25 09:50准备在打开页面前因保存的浏览器current Trip断言失败，0项事件/POST，预算SHA256不变；9/25 09:53仅恢复同一空会话壳后准备通过，输入框就绪、3次真实workspace GET、0次POST/其他mutation、0个pageerror且前后账本SHA256一致。三次均未点击发送，没有accepted UI证据。观察和三次commit失败日志留在忽略目录 `backend/.demo/dsh-e2e-20260924/`，文档仅记录脱敏指标，不收录token、原始session/CoT或页面正文。

本记录只反映`state.private.json`及append-only安全observer中当前保留的证据；D3/D4早期全量/定向测试数量仍按各自时间点报告，不由这些真实探针改写。H5断言套件3/3及observer fixture套件1/1是离线验证，不代表真实commit或真实H5发送通过。


2026-09-26预算文件有界健壮性：B续验在第4次模型调用准入前出现EPERM，旧observer缺少具体操作，不能追认成rename故障。仅为原子账本rename的EPERM/EBUSY加入最多3次同文件/同锁短重试（25/75ms），全部预算文件操作补不含路径的操作级错误code；其他操作不重试，不清账本或绕锁。`budget.test.ts` 27/27通过（2.77秒），证明瞬态故障只准入一次、持续失败旧账本不变/Provider不调用、EIO立即失败，旧锁/损坏/授权围栏仍通过。配置/运行边界见[部署说明](../../deploy.md)。未以离线通过声称真实B已恢复。

2026-09-26 B09:19续验越过请求身份冲突后，首提交复用warm历史旧版本candidateRef遭ARTIFACT_CONTEXT_VERSION_MISMATCH，第二次把同一候选排在多个时段遭guide_duplicate_evidence，第三次被DSH_REPAIR_LIMIT拦截。提示现明确仅复用本轮read_artifact.candidates或当前snapshot的候选；无当前候选先补当前证据；一个候选仅一次访问，不为填满时段重复安排。不改版本validator、单轮12步或最多两次commit。历史失败保留，修复后的真实结果另记D4。

## 2026-09-26 冷恢复对话上下文与探索边界

冷启动新 worker 时，快照保留当前 owner/Trip/conversation 已持久化的 user 与 assistant 公开消息，即使长期 Memory 关闭；不注入其他会话消息或关闭状态下的长期 Memory 内容。这样用户可以追问“第二个国家”并由同一对话中的先前推荐消解指代。国家/地点建议和澄清仍是对话，不会被当成已确认 Trip 目的地；生成/保存攻略或搜索航班须有用户明确请求。Trip 中已确认目的地、实际航班选择与已接纳攻略继续以可信结构化快照为准。
