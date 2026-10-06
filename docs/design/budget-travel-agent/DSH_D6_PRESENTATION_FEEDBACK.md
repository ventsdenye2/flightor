# D6 发布字段反馈

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
