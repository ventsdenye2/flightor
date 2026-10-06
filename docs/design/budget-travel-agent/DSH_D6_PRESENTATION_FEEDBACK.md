# D6 发布字段反馈

2026-10-07 D6-50 紧凑正文未知字段反馈（已实现、定向验证通过）：`commit_travel_guide` 的紧凑文本对象保持严格 schema 拒绝未知键；参数反馈对受控路径 `text`、`text.days.<0–59>`、`days.<0–59>.items.<0–5>.text` 分别列出允许字段：`text` 仅 `reply/overview/days`，每日文本仅 `day/theme`，活动文本仅 `name/introduction/recommendationReason`。`locale`、`activities`、`activityId`、`sourceRefs` 等领域字段不属于文本对象允许字段。反馈仅从服务端 schema allowlist 提示纠正，不回传未知键名、其值、正文或任意 Zod details；未知字段仍是arguments纠正，不自动删键或改变提交。既有最多6次工具调用、3次参数纠正及2次完整内容尝试额度不变，参数纠正不占内容额度。

根协调最终使用正式配置 `npm --prefix backend test -- src/agent/dsh/commit-recovery.test.ts` 复验38/38（3.12秒，`backend/output/d6/r24-compact-feedback-green.log`），backend check/build通过（`r24-root-{check,build}.log`），未包含baseline副本。此前红绿过程保留如下。

回归以实际 `dshCommitInputSchema` 产生 `unrecognized_keys` 错误，覆盖顶层、日对象与活动文本对象，并包含恶意键名和值不泄露断言；先前实现的红测在活动文本对象允许字段缺失处失败，日志为 `backend/output/d6/r23-unrecognized-keys-compact-red.log`。最终活动 `commit-recovery.test.ts` 通过38/38。另一次从仓库根目录运行的日志也发现`backend/.demo/d6-baseline`下4个复制测试，故总计42/42仅是两处副本的过程总数，不是当前backend正式测试数；绿测日志为 `backend/output/d6/r23-unrecognized-keys-green.log`。backend typecheck通过，日志为 `r23-unrecognized-keys-check.log`。首次沙箱 worker `spawn EPERM` 未收集测试断言，允许本地子进程执行的复跑通过。无 Provider 或业务数据库调用；此定向结果不构成D6整体验收或H5验收。

2026-10-07 D6-45预算判断修复（已实现、定向验证通过）：r22 B01原首稿完整reply和解释全文作为未改文本回归。共享检查按费用/预算对象与程度、份额、达标谓词匹配，拒绝肯定“预算紧张/门票小额/住宿交通为主要开销/替换餐食就可控制在总预算内”；沿用`budget_guarantee`及提交字段路径。未知、假设、用户自述和费用控制目的限定在对应关系，不能通过前文“参考/未核实”豁免新的费用主语或条件后件。准确预算目标及小吃偏好保持，表达式预编译；DSH overview schema/工具预算说明、主模型来源合同和legacy终稿指令同步。没有自动删除正文、万能免责声明、第二模型或新增修订次数；此规则是有界表达防线，不宣称通用费用/旅行事实认证。

首次3文件红测19失败/285通过（3.61秒），其中18项为预算漏拦，1项为新增正例中文不足正文语言阈值的夹具错误，后者不算预算缺口；首次修后303/304仅余该夹具，补足文本后314/314（3.70秒）。14文件中间联合538/538（27.01秒）及typecheck通过。并列范围复核补“且/同时/and/条件后件”和目的正例，发现2失败/348通过（4.58秒）：中文“门票费用无法确认且住宿是主要开销”和英文“ticket prices and lodging is”把未确认宾语误视作后续判断的一部分。修复当前匹配前的并列分界及英文复合主语/谓词关系，同时保留中英真正复合费用主语的不确定讨论。最终14文件545/545（32.48秒）及backend typecheck通过，范围含finalization/reply/presentation-problems/budget-scope、commit/recovery、Goal/schema、官方fixture worker、预算派生与路线答复。所有日志留在忽略目录`backend/output/d6/r23-budget-affordability-{red,red-retry,first-green,green,joint,scope-red,final-joint,check,final-check}.log`；最初red.log为sandbox esbuild spawn EPERM，未收集业务断言，随后原离线命令允许本地子进程执行。零新增真实Provider与业务数据库写，原r22材料/失败保持；完整新冻结和真实H5仍待执行。

2026-10-07 r22模型可见合同同步：DSH maxResults描述明确全攻略所有distinct排程及补充findings总数，不按日期或raw source去重，未选择的候选定义不计；supporting字段、工具说明与persona一致要求补充finding不得再排程或重复已排finding。紧凑工具说明明确禁止入场费用/免费入场声明。仅说明现有领域合同，不自动删除/替换候选、不改变合法上限、已接受Goal、证据或发布规则；最终联合473/473通过，真实新冻结仍待执行。

2026-10-07 r22初稿数量前置（已实现，定向验证通过）：r21真实形状的10个不同finding与显式maxResults=8冲突现于Goal接受和research保存前拒绝。独立`guide_initial_result_limit`归arguments，返回完整`selectedFindingCount`（0–460整数）、原显式`maxResults`（既有1–20 schema）及服务端schema的`maxAllowedResults=20`，字段固定为`intent.parameters.maxResults`，不接纳传入的合法上限、正文或任意字段路径。主模型仅能在符合用户请求时显式纠正尚未接受的新intent；不得删必需活动/支持证据、将已安排活动重复列为supporting、提高已接受/恢复Goal上限或虚构候选。首稿重提仍带语义intent及完整候选定义，数量修正占既有参数额度、不占内容修订；领域`issues: [guide_result_limit]`与重复证据保持content拒绝。共享raw来源不合并不同finding，未选候选不计数，支持项完整计入；预算保证/免费声明照常验证。

三文件初始红测14失败/107通过（4.66秒），`backend/output/d6/r22-initial-limit-red-retry.log`保留；首次沙箱esbuild `spawn EPERM`未收集业务断言，另存`r22-initial-limit-red.log`。未运行新真实Provider或业务数据库写，不追认r21失败或完整D6通过。

首版三文件120/121时，新增“Admission is free”负例暴露既有英文免费入场漏检，原`r22-initial-limit-first-green.log`保留并转交[免费规则窄修](DSH_D6_EVIDENCE_AND_LOCATIONS.md)；数量回归同时保留原已拒绝的free admission/预算保证测试。随后7文件157/157（15.24秒）及backend typecheck通过，日志为`r22-initial-limit-green.log`/`r22-initial-limit-check.log`。官方fixture worker的10>8参数纠正与重提、恢复Goal不可修改及persisted引用先验加入后8文件172/172（22.97秒，`r22-initial-limit-joint.log`），当时尚未包含最后21>20全选择不可合法承载用例。

最终12文件473/473（27.41秒）及backend typecheck通过，日志为`backend/output/d6/r22-initial-limit-final-joint-retry.log`/`r22-initial-limit-final-check.log`。包含commit63、准备16、官方fixture intent2/registration2、service12、Goal17、恢复37、公开错误24，以及最终化192/reply74/scope31/字段反馈3；两天各5项的首稿在官方worker中返回arguments、0 Goal/Artifact，一次fixture search资料保持后显式maxResults10重提accepted+satisfied，未新增产品模型或外部调用。首次同组469/473仅因说明措辞更新使4条旧关键片段断言失配，保留`r22-initial-limit-final-joint.log`，恢复等义安全片段后原组复跑通过。完整r22工程、新冻结与真实12+4 H5仍由主验收执行，当前结果不追认r21原失败、不构成D6 PASS。

2026-10-07 r21预算关系修复：r20真实B01两次原overview均因`excluded_precise_claim`被拒，原官方session seq141/146和只读PG均确认权威预算为1200 CNY/trip。冻结函数零外呼对照显示：目标句和成本提示分别可通过，逗号/分号合并则拒；“实际花费以现场为准”和“未知费用不作估算”被费用名词默认判为肯定成本。另确认句号可绕过“门票费用就是这个金额”的费用指代拒绝。现移除费用名词默认veto和当地/官方/变量支出提示模板白名单，按局部费用谓词、精确金额或其指代与成本的关系判断；目标金额仍只匹配权威Trip结构，局部否定/谨慎关系保留，不能通过句号/换行把目标转为费用事实。完整合同归[预算与精确字段](DSH_D6_PUBLIC_ERRORS.md)。没有更改预算范围、证据、权限、版本或修订额度。

真实原文与跨句反例红测为14失败/246通过；首版259/260时保留“费用作为本次花费”的旧失败，名词费用/反向等同/估算指代及谨慎关系第二红为15失败/234通过。中间四族`finalization/reply/budget-scope/presentation-problems`为279/279（4.52秒），其他八个关联提交/恢复/派生套件165/165（21.44秒）。日志位于`backend/output/d6/r21-budget-relation-{red-retry,first-green,boundary-red,green,joint}.log`；首次沙箱esbuild `spawn EPERM`未收集断言，单独保留`red.log`，随后原命令允许本地子进程运行，所有旧断言保留。

独立复核的明确费用谓词、未确认问句与“另行计算”范围反例补入后，三文件红测9失败/284通过；修后四族296/296（4.25秒）。保持源码不变的最终12文件联合461/461（22.64秒），含预算限额、路线答复、service官方fixture worker、提交/恢复、预算派生及公开错误；日志为`backend/output/d6/r21-budget-independent-{red,green}.log`、`r21-budget-final-joint.log`。根协调完成实际build及独立[24例回放](evidence/d6-r21-budget-independent-replay.json)，没有真实Provider或业务数据写入。

原官方session seq141/146完整文字保持原样，按持久攻略活动顺序绑定既有7个activity/source身份，并使用原research及首次接受的Goal要求，在内存调用完整`validateIntegratedFinalText`：r20冻结函数两稿均`blocked/format/excluded_precise_claim`，当前函数两稿均机械`accepted`，0模型调用/0持久写。来源码SHA为`ec294c11f9d607dd993d118a217933c64aab2ba2aa00734dde5360749370ea29`，对照在`backend/output/d6/r21-original-budget-replay.log`。这只证明预算误拦的因果，不认证来源时段、活动语义或旧稿用户交付；原r20两稿仍为blocked，失败、会话、数据库、账本及冻结构建保留。完整新冻结、真实PG、原12+4真实H5仍需r21验证，D6未PASS。

2026-10-07 r20最后预算交叉复核：Astra再次指出非预算itinerary/行程安排前缀豁免会放行“itinerary budget excludes flights/行程安排的预算不含机票住宿”。已将明确budget/预算/总额优先于范围豁免，新增2例后27个scope例及4文件241/241通过。最新backend check/build通过；observer新增三个edit前置码及scope字段过滤fixture1/1（1.285秒）通过。

2026-10-07 r20定向复核：初始2文件红测10失败/59通过（首次沙箱spawn EPERM未执行业务断言另存）；局改/准备/预算scope84/84、随后9文件联合313/313与backend typecheck通过。Astra有界审阅发现4个scope漏拦和2个票品/行程范围误拦，另补3个边界，新增25例先7失败/18通过，修复后4文件239/239。regex在module scope编译；明确通票/套餐/itinerary包含范围不等同预算排除，未知费用与否定排除保留。规则只证明这些受控表达边界，不宣称通用语义或价格审核。扩展真实专用PG套件3/3通过（8.33秒），含fresh repository恢复、原Goal限额读取、完整8 findings先于accept拒绝小cap及支持证据/非目标活动持久保护，零外呼。完整新冻结与真实H5仍待执行。

2026-10-07 r20预算范围规则（实现待验）：当权威预算scope=trip时，公开reply、overview、活动及短问答中擅自排除费用、另计或限定为少数支出，返回budget_scope_changed及受控输入路径。自购机票不改变全程口径；费用尚未核实、否定排除的句子允许。airfare/transport合同不被改成trip。反馈不回显正文，单主模型修复原文，不自动重写预算、不增加修订额度。本轮先补原“不含机票住宿/机票住宿另计”等红测，原日志保留。

2026-10-07 活动日期适配反馈已实现：仅缺字段/未选来源/不可用来源属于前置；引文或日期抄录错误保持content并照原2次内容额度计数，未知reason失败关闭。仅回传有效`candidates.<0–49>.temporalEvidence`路径与受控缺口原因，主模型选择来源日期，不回显正文或URL、不允许重标event回避校验。红6失败→绿28/28；与service/public-errors联合63/63，耗尽回执及公开原因、output_limit优先均已定向验证。日期完整工具链/真实PG及新冻结UI另记，不等于D6通过。

2026-10-07 r18真实B01再次失败：首轮108ms受理、117.213秒终态、0accepted，后续8动作blocked，原报告和手机截图保留。重复日拒绝正确，但模型反馈丢弃服务端`days=[1,2,2]`，只返回活动内部key；下一稿仅将重复日改为rest，仍失败。已返回最多60个提交日号、有界重复日号和具体`days.<index>.day`，只接纳1–60整数，过滤恶意/越界值而保留原数组索引。主模型选择哪项备选实际进入同日items，禁止代码合并或删掉语义活动；明确不得增加rest日、延长天数或丢弃用户必需活动。原形状及恶意/越界回归红测2失败→绿21/21（`output/d6/r19-duplicate-day-red.log`/`r19-duplicate-day-green.log`），前置分类和既有修订额度保持。event日期证据可表示性与预算原文正由Astra max零出站审查；定向通过不是D6通过。

2026-10-06，内部协议实现与定向验证；不是完整 D6 PASS。冻结分母仍为[验收 v1](DSH_D6_ACCEPTANCE.md)的工程、真实隔离 PostgreSQL、D5、12 固定及 4 探索 H5 旅程。

`commit_travel_guide`在发布拒绝或领域保存拒绝附带表达问题时，返回内部`presentationProblems: [{code, fieldPath}]`。它复用`publicProseProblems`，只诊断原聚合校验已拒绝的规则，不形成第二套发布判据或事实审核。路径为`text.reply/overview`、`text.days.<0–59>.theme`、`days.<0–59>.items.<0–5>.text.name/introduction/recommendationReason`。活动按本次提交的activityKey映射；继承活动及局部编辑中忽略的主题不伪装成本次输入。语言阈值对完整正文判断，定位整个`text`，不将短主题或专名误判为错误语言。

受控码为`internal_narration`、`budget_guarantee`、`excluded_precise_claim`、`excluded_admission_or_hours`、`unsupported_asset_or_url`、`language`、`duplicated_or_foreign_prose`、`empty_reply`。反馈先验证码和规范索引路径，再去重，不回显错误原文、来源、Provider正文或任意details。不改公开API、持久FinalIssue schema、权限、版本、候选/证据绑定、受保护slot或修订额度。

准入额度耗尽仍返回原限额码并要求停止提交，同时保留最后实质失败类型与公开阶段。新的Provider/output-limit失败仍优先显示。公开分类只读取code/issue字段，不从repairHint、providerBody或异常prose中寻找source/location字样。observer复用同一字段过滤器，并采集publicationIssues和受控presentationProblems的原因码/路径；不输出原文，不改变发布结果。

## 验证与原失败

字段反馈红测2失败/63通过，修后两文件65/65。原因保留测试首次遗漏fixture配置，修正后2失败/8通过，复现repair limit将lastFailure改为system；公开分类红测1失败/19通过，复现repairHint将format误归evidence。observer红测0/1，复现漏采publicationIssues。日志在忽略目录`output/d6/r16-*`保留，完整联验和新冻结真实H5仍待完成。

[r15脱敏证据](evidence/d6-r15-b01.json)保留原报告哈希、调用/token/费用及关闭证明。已人工查看失败截图：119ms受理、196.271秒终态、199.318秒流程，0 accepted攻略，后续8动作blocked；已保存Trip卡不等于发布攻略。28模型/16搜索/27fetch/0fare，44settled/0pending；USD3.04为预留非实付，cacheRead单列。

Trip准备只推进一次版本且条件正确。首次漏候选注册正确前置拒绝，随后两稿因overview的合法预算目标误拦，修复限额最终耗尽。Astra max用原session/真实只读PG副本，仅内存换预算句后两稿机械accepted，证明误拦因果；原件未改，不能追认正文通过。另发现烤制甜甜圈误写炸制、周日建议不适配周二/周三、散文合同禁止的免费入场中文漏检，新冻结须逐字段联合审阅。

r15服务已关闭：PID66536不存在，API55587/H562275拒绝连接，server/manager lock不存在，guard 1 installed/1 closed、违规调用0。schema/session/草稿/账本/报告保留。源码修改后不得resume r15；r16须完整重跑原分母，目前无确认硬阻塞。

2026-10-06 本批最终定向验证：7文件209/209、backend check/build及observer1/1通过。联合过程曾受并行schema实施状态影响，后又因新增测试自身将无intent的budget工具列入五工具而失败；原日志均保留，修正为commit/setter/search_flights/search_flexible_flights/confirm_flight_price后完整联验209/209。领域错误kind拒绝、protected范围和公开stage回归均在同次通过。

[原始r15材料新validator回放](evidence/d6-r16-original-r15-replay.json)使用未改的seq196/201文字与真实持久guide/research，零业务写入/出站。两份原overview均不再被预算规则拦截；两份仍因中文免费入场声明被正确blocked，并准确定位days.1.items.4.text.introduction。未将旧稿改为accepted，语义问题仍待新自然输入H5审阅。
