# DSH D6 冻结验收与结果

2026-10-07 r21预算关系结构修复已完成定向：最终12文件461/461，根backend check/build及实际构建独立24/24零外呼回放通过。以局部费用谓词/金额绑定替代费用名词默认误拦，跨句金额指代、whether未确认问句与另行计算边界补回归；不放宽费用估计/保证、权威金额/币种/全程口径或原修订额度。完整后端已开始复验，新冻结完整工程及原12固定+4探索真实390×844 H5仍待执行；r20原失败仍FAIL，D6未PASS、无确认硬阻塞，未push/合并/部署。

2026-10-07 r20真实B01 **FAIL**：94ms受理、129.101秒终态、131.921秒完整runner，completed/partial、0accepted、后8动作blocked；不是180秒超时。两稿仅text.overview的excluded_precise_claim被拒，第三稿撞原修订上限；Astra max用冻结函数确认合法预算目标与“门票、餐饮等实际花费以现场为准”被窄模板误拦，标点改变会影响结果，同时发现同额费用指代的反向漏检。结构修复进行中，不仅添加“现场”词表，不放宽金额/每日/费用/保证或修订额度；之后必须新r21冻结完整工程及原12+4。已看失败截图，真实只读PG和原session保留，原报告不改。[失败与关闭审计](evidence/d6-r20-b01-failure.json)：PID113804/TTY83280退出、锁释放、guards_closed1/forbiddenCalls0，历史账本SHA不变。r20为21model/12search/658498 tokens/33 settled/pending0、USD2.28未知预留（非实付）、fare0；累计20账本/21报告、310model/140search/450 settled/pending0、10930664 tokens、USD29.20未知预留、fare0。B02–B12/E01–E04未运行，D6未PASS、无确认硬阻塞。以下“正在B01”是发送前历史快照。

2026-10-07 r20同冻结版本完整工程通过：backend138文件1420/1420（202.09秒）、真实专用PG52/52（54.92秒）、D5本地HTTP/票价fixture30/30且codeUnchanged、runtime14/14、observer1/1、前端六族116/20/37/52/29/86及根TS、H5/weapp构建。正式固定回放10对两版均accepted、语义一致、0模型/外呼；总P50基线11.158ms/D613.782ms、adapter0.452ms，增加2.624ms保留全部样本，正在只读定位、不宣称提速。源码c1853ad及实际构建/参数不变；原12+4真实390×844 H5从B01开始（TTY98023），尚未通过。D6未PASS、无确认硬阻塞，原失败/DB/会话/账本保留。

2026-10-07 r20已冻结：源码c1853ad4ac06c2071dd5819bdd678fac526137b2，run2ef9cfb7-c7d1-4114-aa87-5bcb6cd6a4f4、独立schema dsh_d6_2ef9cfb7c7d14114aa875bcb6cd6a4f4、API61341/H549895、PID113804/TTY83280；私有目录backend/.demo/dsh-d6-runtime/d6-final-r20。实际[source/backend/H5/worker指纹](evidence/d6-r20-freeze.json)已核对，backend副本783文件一致，原旅程SHA不变。H5编译31.038秒/2条既有体积警告，保存的私有terminal末段不是完整编译日志；weapp exit0保留CSS/体积警告，无单独可靠耗时。backend check/build、真实PG52/52（54.92秒）、D5本地HTTP/票价fixture30/30且codeUnchanged、runtime14/14、observer1/1（0.916秒）、前端116/20/37/52/29/86和根TS通过；runtime首次sandbox EPERM未执行业务断言，原日志保留，重跑同命令通过。完整backend进行中，原12+4真实H5尚未启动，新账本0调用；D6未PASS、无确认硬阻塞。

2026-10-07 r20准备：局改机械限额、完整finding前置计数、预算范围与旧回复覆盖已修复。后端联合313/313、最后预算交叉复核241/241、真实专用PG定向3/3、check/build、observer1/1通过；前端定向303项及根TS通过。H5验收脚本收紧本轮satisfied/Artifact绑定、解释无新攻略、B01/B02/B05必须局改交付；定向19/19及runner语法通过。新冻结全量与原12固定+4探索真实390×844 H5尚待完成，当前D6未PASS、无确认硬阻塞。

2026-10-07 r19真实B01 **FAIL**：首稿99ms受理、189.534秒终态并accepted两天六活动；解释4.129秒正确；局改54.451秒终态为partial、缺accepted_publication、无新正式攻略。后续刷新/详情实际打开旧攻略，旧runner仍记observed，不是PASS，原报告不改写。首稿公开reply另擅自把全程1200元改为不含机票住宿/另计；页面旧publication.reply覆盖本轮局改失败提示。只读PG确认基底Goal上限12、局改新Goal上限6，但完整编辑含5 protected visits+4 supports+1 replacement共10 findings；不能靠丢支持资料或修改已接受Goal解决。B02–B12/E01–E04尚未执行。原报告`backend/.demo/dsh-d6-runtime/d6-final-r19/evidence/B01-2026-10-06T18-57-57-905Z.json`及private/readbacks下PG原件保留。PID109176退出、TTY1542结束、锁释放；guard正常关闭一次、forbiddenCalls0/fare0。r19为53 model/20 search、USD4.52未知预留、pending0；累计19账本/20报告、289 model/128 search/417 settled/pending0、10,272,166 tokens、USD26.92未知预留（非实付）、fare0。历史账本SHA仍3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126，未push/合并/部署。以下r19“待验”均为发送前历史快照。

2026-10-07 r19同冻结版完整工程通过：backend1390/1390、真实专用PG52/52（48.96秒，原随机schema套件）、D5本地HTTP/票价fixture30/30且codeUnchanged、runtime14/14、observer1/1、前端113/20/37/52及根TypeScript、H5/weapp构建。runtime首次sandbox spawn EPERM未收集业务断言，原日志保留，允许本地子进程后原配置14/14通过。固定回放两批各10对均accepted/语义一致/0模型与外部调用；首批总P50 9.916→12.485ms，quiet复核10.144→12.805ms，adapter0.348ms，约2.6ms增加两批均保留，正在有界只读定位、不宣称提速。冻结source及参数不变，原12+4真实390×844 H5从B01启动；D6未PASS、无确认硬阻塞。只读PG诊断用一次性忽略脚本`backend/.demo/d6/read-current-trip.mjs`，验证run/schema一致后BEGIN READ ONLY，原报告/数据库/账本不改写。

2026-10-07 r19同冻结版本完整后端137文件1390/1390通过（184.09秒，退出0，`output/d6/backend-unit-r19-final.log`），weapp正式构建18.00秒退出0（仅工程，保留既有CSS/体积警告）。真实专用PG完整套件正在执行，随后D5及固定回放；前端四族/根TS/runtime由子任务串行验证。实际构建及配置冻结不变，原12+4真实H5尚待同版执行；D6未PASS。

2026-10-07 r19已冻结并开始完整工程：源码提交`5ff50628df66b473f03c17e454897931c6beab1b`，标准v1及原旅程SHA、日期/参数/390×844布局保持。新run`6344c29a-32ba-45ca-a1fd-ed3c488f7bd6`、schema`dsh_d6_6344c29a32ba45caa1fded3c488f7bd6`、API57722/H559937、PID109176/TTY1542，目录`backend/.demo/dsh-d6-runtime/d6-final-r19`；source/backend/H5/worker实际指纹见[冻结指纹](evidence/d6-r19-freeze.json)。H5编译30.711秒、2条既有体积警告；启动已安装保护与observer，0模型/搜索/fare，旧账本SHA不变。首次启动在环境读取前置因fare-env相对路径错误ENOENT退出、无schema/账本/调用，实际文件在原工作区`../../backend/.env`；仅修正命令的只读路径，未修改凭据、源码或产品路由。完整backend/专用PG/D5/runtime/前端四族/根TS及weapp构建进行中，随后同版原12固定+4探索真实H5。当前未PASS、无确认硬阻塞；旧r18失败不追认。

2026-10-07 r19最终复核：预算focused211/211、Astra固定39/39，零外部/模型/业务调用；日期证据适配最终helper SHA`1db130f27a8869fafb05896e94423a84dd90b4f769af28f539251a3d7844bd95`下focused90/90、Astra独立35/35，零外呼。D6-35/36/37最终独立复核通过。根10文件联合367/367（17.42秒）、build退出0、新build observer1/1（1.646秒）通过；backend typecheck退出0；真实专用PG新用例所在套件3/3通过（子任务过程输出未单独落盘，最终完整PG另留日志）。新冻结完整工程与原12固定+4探索390×844真实H5未启动。r18真实B01仍FAIL，117.213秒终态、0accepted，不追认；验收v1及原旅程/hash、Trip日期与证据/发布门槛不变。当前D6未PASS、无确认硬阻塞。

2026-10-07 r19日期复核初版：独立复核发现同URL摘要/正文顺序、日期引文裁剪Published/公開日标签、CJK括号吞另一日期范围三处问题；初版focused89/89、联合366/366和check/build/observer1/1均为最终helper修订前结果，不能作为最终复验。修复和最终独立复核见上；真实PG与新冻结验收仍待完成。

2026-10-07 冻结前累计账本只读核对：当前工树保留18份D6运行账本、19份B/E页面动作报告（含零调用初始化与历史失败，不等同19个通过旅程）。合计236模型准入、108搜索准入、344 settled/pending0；已记录模型token8,124,102（prompt7,997,813/completion126,289），票价method调用0。没有实际金额回执，344调用费用未知、USD22.40为未知预留而非实付或实际零费用；不含旧DSH历史账本，不继承旧授权。一次性私有只读汇总脚本`backend/.demo/d6/summarize-d6-ledgers.mjs`逐文件前后hash核对且不连接数据库/Provider、不修改原账本/报告；本次完整快照保留于同目录`cumulative-ledgers-2026-10-06T18-27-50-753Z.json`。此为中途统计，最终新批次后须再次汇总，不能把API/observer状态当语义验收。

2026-10-07 r19初版联合/工程结果仅为最终helper修订前的历史快照：日期focused89/89、联合366/366、check/build/observer1/1不得当作最终通过。三项日期复核问题及修复情况见上；未新增付费请求。

2026-10-07 r19预算/服务中间定向快照：预算保护两文件211/211（2.79秒），Astra max对当时源码SHA`55ca1cd71099daa11c4c218420f77da70a277712a83a249709e6c6eaf8eaaec5`固定39项独立纯函数回放39/39，零外部/模型/业务调用；每轮真实预算原文、肯定费用/每日/保证及明确名词列表全部保留。service/commit-recovery/public-errors三文件63/63（8.69秒）。日期focused89/89是最终日期helper复核前快照；最终结果见上。新增语义与误拦红绿回归及细节见[公开文案合同](DSH_D6_PUBLIC_ERRORS.md)。以下r18失败不追认。只读远端复核仍`f2ec6c1f`，历史费用账本直接重算SHA未变。

2026-10-07 r18真实390×844 B01 **FAIL**：一次UI提交108ms受理、117.213秒到终态、122.289秒完整runner流程，0accepted、后续8动作blocked。真实PG仅两份research、无travel_guide；setter已satisfied，攻略未交付。六次commit依次为INVALID_ARGUMENTS、两次duplicate_day_or_activity_key、两次guide_event_date_evidence_missing+excluded_precise_claim、DSH_REPAIR_LIMIT。已打开失败截图并审阅页面，不能以completed、工程或回放通过追认。Astra max确认原页有2026年日期，但DSH候选无法传递原领域temporalEvidence；同版纯函数还确认费用谨慎提示导致合法预算目标误拦。重复日期是有效拒绝，反馈丢失具体day值的缺口已补红绿回归21/21。当前修复中，必须新冻结完整重跑原12+4，D6未PASS、无确认硬阻塞。原服务已正常关闭（PID93668退出、server/manager锁不存在、guard关闭且违规0）；原DB/会话/账本/报告与r18冻结runtime副本保留，未push/合并/部署。下段“待验”是本次真实发送前快照。

2026-10-07 r18完整工程完成，真实H5待验：代码`91352c368dab7542bdce866a8e08c0cc51fca7ad`，实际指纹/配置见[冻结记录](evidence/d6-r18-freeze.json)。新run`eadf455a-5523-4a79-8e4c-834061446ceb`、schema`dsh_d6_eadf455a55234a798e4c834061446ceb`、API55171/H551443、PID93668/TTY26207，目录`backend/.demo/dsh-d6-runtime/d6-final-r18`。完整backend137文件1331/1331（183.16秒）、真实专用PG11文件51/51（50.53秒）、D5本地HTTP/票价fixture30/30且codeUnchanged、runtime14/14、observer1/1、前端四族/根TypeScript均通过。H5编译27.955秒/2条既有体积警告；最终输出片段保存在私有`h5-build-final-output.log`，不是此前全部进度的完整日志；weapp编译17.28秒、退出码0，保留CSS顺序/体积警告，仅为构建，不是微信页面验收。构建结束后才开始完整backend，避免大型构建并发。启动与冻结时0真实调用，旧账本hash不变；标准v1、原旅程SHA、日期、参数/限额及390×844布局不变。12+4真实H5仍待同版执行；当前不是PASS，下段准备记录保留为历史。

r18[固定回放](evidence/d6-r18-fixed-replay.json)两版各10/10 accepted，逐例语义一致、0模型/外部调用。p50总耗时基线10.630ms/D6 11.861ms，D6适配0.474ms；内存仓库Trip读取20→18，其余调用及三产物数量一致，无新增数据库往返证据。总耗时增加1.231ms，逐例时间全部保留，不宣称更快；该10对固定材料仅衡量本地组装，不能替代真实PG或用户看到成果耗时。远端再次只读核对仍为f2ec6c1f，未push/合并/部署。

2026-10-07 r18窄修复准备完成：合法全程预算名词关系与逐费用/每日谓词局部否定已实现，保留整句肯定费用/每日用途阻断、所有金额/币种/票价/保证反例及原权限/证据/版本/修订限额。两文件182/182、根联合8文件297/297、check/build、observer1/1通过；Astra对源码SHA5a5b6efb的25项独立纯函数复核符合预期。未改原文的[完整第二稿重放](evidence/d6-r18-original-budget-replay.json)使用真实PG草稿、两份兼容research（13 findings；6活动与1 practical绑定在第二份7 findings）及原text，按发布服务顺序纳入材料；r17冻结构建仅因excluded_precise_claim blocked，r18构建accepted且issues/omitted为空，0模型/外部调用。seq95只核对合法预算文字，不追认其缺practical的首稿；重放也不追认任何正文或H5通过。旧红测、构建与原材料保留。下一步本地提交、新r18隔离run/schema/构建冻结、同版完整工程及原12+4；当前未PASS。

2026-10-07 续作：**r17 真实 B01 FAIL，D6 未 PASS，无已确认硬阻塞**。同冻结源码 `ee29139` 完整工程通过，真实390×844页面首轮101ms受理、110.962秒到终态、113.665秒流程；0 accepted攻略，后续8动作blocked。实际终态completed、delivery partial且缺accepted_publication，不是180秒超时，也不是用户交付成功。r17服务已于2026-10-06T15:58:42.898Z正常关闭，PID84864已退出、两端口ECONNREFUSED、锁释放、guard installed/closed各1且forbiddenCalls0；原schema、会话、失败报告和账本保留。

r17实际计量20模型/10搜索/14次web_fetch工具尝试/0票价，30 settled、pending0；prompt559978、completion9002、total568980，USD2为预留、实际费用未知。历史账本SHA未变。[脱敏B01失败审计](evidence/d6-r17-b01-failure.json)保留原报告、截图、真实PG读取、session、observer及关闭证明的SHA；原件位于忽略目录`backend/.demo/dsh-d6-runtime/d6-final-r17`。冻结副本`private/runtime-frozen`与覆盖前dist的783文件逐字节一致，按launcher同款算法SHA均125b1bdd；冻结状态已更新为失败关闭，旧启动信息仅作历史。

Astra max零出站诊断以冻结构建、真实PG第二稿、7条finding及原6活动重放：seq129原文只报excluded_precise_claim；仅在内存把“全程预算为”改为“全程预算目标为”后完整校验accepted、issues/omitted为空、calls0。seq95首先确有practical必需证据不足，但合法预算目标与“而非每日/亦非已确认花费”也被机械误拦。seq129补齐practical后仍被误拦，seq134正确触发既有修订限额。D6-34继续修复预算关系与局部否定，保留全部费用/每日/保证反例、证据和修订限额；机械回放不追认正文或H5。修复后必须新冻结r18、完整重跑原12固定+4探索，不能续用r17凑成功分母。

下段为r17启动时历史快照，现已失败并关闭。

2026-10-06 r17已冻结并开始完整工程：代码`ee29139c21d16f166b39652f76124d6da4b48189`，实际指纹及配置见[本批冻结](evidence/d6-r17-freeze.json)。独立run`fa5887a0-a12c-42a9-ae42-2b900461f824`，schema`dsh_d6_fa5887a0a12c42a9ae422b900461f824`，API49304/H551734，PID84864/TTY22201，目录`backend/.demo/dsh-d6-runtime/d6-final-r17`。H5编译27.591秒、2条既有体积警告；完整backend137文件1301/1301通过（184.22秒）、专用PG11文件51/51（52.63秒）、D5本版30/30/codeUnchanged=true、runtime14/14、observer1/1、前端四族及根TypeScript通过，weapp构建成功（既有CSS顺序/体积警告）。D5为本地HTTP/票价fixture；固定回放两版各10/10语义一致、0外部调用、适配p50 0.386ms/总耗时11.219/11.797ms。真实390×844 B01已通过headed UI启动（TTY80121），正文/详情/持久联合验收待完成。标准/旅程SHA/原自然输入/参数/390×844布局保持，源码已停止修改。完整同版验收仍未完成，不计PASS。

2026-10-06 r17准备完成：原r16完整backend三项合法预算短答复失败及零真实调用证据保留。权威全程目标短答、小数/句号与每日肯定边界修复联合8文件267/267通过；check/build、observer1/1、停止harness16/16、根TypeScript、runner语法与diff通过。文档门禁114份/765链接通过。原测试期望、标准v1、12固定+4探索、模型参数/修订额度与390×844 H5尺寸保持。远端再次只读核对仍为`f2ec6c1f75000d368d4d83b7ae6428c17dea3e0c`。本地提交后建立新冻结完整工程/PG/D5/UI，当前不是PASS。

2026-10-06 r16冻结记录（本批随后工程FAIL）：本地提交`c901d396a6c6d724073a50e574962e7039ce4eb1`，远端codex/dsh-backend只读复核仍`f2ec6c1f75000d368d4d83b7ae6428c17dea3e0c`。标准v1与原12固定+4探索输入/未来日期不变；DeepSeek v4 flash、official搜索、thinking disabled、max_tokens8192、原超时/修订额度和地点配置保持。新隔离目录`backend/.demo/dsh-d6-runtime/d6-final-r16`H5构建后已关闭，原TTY30880；实际run/schema/source/backend/H5/worker指纹见下述保留记录。先完成完整工程/PG/D5，再真实390×844 B01与剩余旅程；此状态不是PASS。

r16实际构建/配置已冻结，见[冻结指纹](evidence/d6-r16-freeze.json)：run`6bf545f8-e51d-4e96-a309-e520fc4e4a26`，schema`dsh_d6_6bf545f8e51d4e96a309e520fc4e4a26`，API57909/H549212，PID101984/TTY30880；源码`4f35c92c6626cb858232940e8c13340e2a69ff1ded85d650170d5c67799bce3e`，backend`603f2f974f5f451954cc2c8b304fffc0a827b69c1308d072a3019a772dc1af45`，H5`3bd47c29accd5de2f1dc32fc57d4b347ed38705d7574ac689637109ab7a76137`，worker`657015d487ffa07f5597ba1baf19490d538e47cf4c6f4d8ed48e738033ce872e`。H5编译28.273秒、保留2条体积警告；配置/原自然输入与手机布局保持。完整backend结束：137文件1290通过/3失败（183.28秒），全部为既有reply预算确认的合法短答复误拦；原期望保留。r16未调用模型/搜索/fare，完整批次FAIL，隔离服务已关闭，修复后建立新冻结完整复验。未执行PG/D5/前端/平台构建或真实UI，不把已有定向/构建计作完整通过。

标准 v1，2026-10-06，Asia/Shanghai；业务代码修改前冻结。r15历史冻结源码2a7a16b完整工程已通过：backend136文件1265/1265、真实隔离PG51/51、D5 30/30、runtime14/14、observer1/1、前端113/20/37/52及TypeScript和H5/weapp构建。第一次backend整套有app.test.ts 5秒超时；结束并行构建后按原配置整套复验通过，该项558ms；全部失败与成功日志保留。旧版本alias文件异常、Trip准备顺序及多城市安全地点反馈已修，110字段边界红绿验证通过，权限/版本/证据/发布及限额保护不变。真实390×844 B01已FAIL：119ms受理、196.271秒终态、199.318秒流程、0 accepted攻略和后续8动作blocked；r14历史0 accepted/157.339秒终态不追认为通过，没有证据说明180秒timeout问题已在用户流程解决。最终12固定+4探索正文/详情/持久化联合验收未完成，无已确认硬阻塞，不能报告PASS或BLOCKED。

2026-10-06 r12交互前冻结：源码提交 `d9954f478657e846189d591507782c7e0bacdd92`，核心源码指纹 `85f6483fa561945f43e44a26b68115646cbc8ea702ff44e77de5ce04b2c11c98`，backend构建 `3e198755e2b3cda8c78f4847ca02f0083a4f3655d6e42a45e19a34e07bccdb89`，H5构建 `0df804649fc99da2140e3ba5446a5b241307d986bc2815075eb3b1f0e0bfcd1b`，旅程文件SHA256 `91240ac6c741a990ad4a233451cc5982702b9d3856eb85597fa88206be943780`。run `fe58e286-3665-447f-b955-f106ffbe6ac4` 位于私有 `backend/.demo/dsh-d6-runtime/d6-iteration-b01-r12`，API63839/H561468、TTY77507、PID85304。实际配置 deepseek-v4-flash / deepseek-official / thinking disabled / max_tokens8192，模型及搜索路由不变；SerpAPI仅使用用户授权的现有余额。日期和12固定+4探索自然输入不变；Chrome手机布局390×844/DPR1、非mobile/touch仿真。本版包含D6-18/19/20与返回选择器修复，必须完整重跑工程、独立PG、D5及12+4，任一源码/核心配置修订均使批次失效。backend check/build、四前端族、根TypeScript已在相同源码通过；weapp本版构建44.84秒通过，仅为工程验证。以下r11及更早记录为保留历史，不计入r12通过分母。

r15真实B01最终FAIL，详见[脱敏证据](evidence/d6-r15-b01.json)及[原失败诊断](DSH_D6_PRESENTATION_FEEDBACK.md)。119ms受理、196.271秒终态、199.318秒流程、0 accepted与后续8动作blocked，不是180秒timeout。Trip准备正确，首提交漏候选正确拒绝，随后预算目标误拦与模糊反馈耗尽内容修订。真实PG两稿blocked、text=null，原session/账本/页面报告保留。28model/16search/27fetch/0fare，USD3.04预留非实付；缓存token单列。隔离服务已关闭、guard闭合零违规。Astra原材料纯内存对照仅证明机械误拦，不证明来源/日期语义通过；r16修改后完整重跑。

## A：确定性与真实持久化

2026-10-06 r15交互前冻结：源码提交`2a7a16b842c57b79bc4a78dfc1923d2fe45fe7ac`，核心源码指纹`fd29c45d2d2a4736e499a10d686c30b51034c84293ef0be2ae34bfb05d2df029`，backend构建`7c4052c3343a534d209b24af3dec77422a20641acad1da336f4f67520f319340`，H5构建`8dc4031bf805aaaf23a1f8c679cad76a4a8c8fee148c6beb1bc2a7bc39227c71`，worker指纹`657015d487ffa07f5597ba1baf19490d538e47cf4c6f4d8ed48e738033ce872e`，旅程SHA256仍`91240ac6c741a990ad4a233451cc5982702b9d3856eb85597fa88206be943780`。run`80c12499-4760-4a63-b693-247edc55cbd2`，私有目录`backend/.demo/dsh-d6-runtime/d6-iteration-b01-r15`，独立schema`dsh_d6_80c1249947604a63b693247edc55cbd2`、API55587/H562275、PID66536、TTY96449。实际模型deepseek-v4-flash/deepseek-official/thinking disabled/max_tokens8192、当前额度授权、标准v1、未来日期和12固定+4探索输入不变；390×844/DPR1、Chrome默认UA、mobile/touch=false。

r15当前工程结果：定向7文件74/74、check/build、真实专用PG11文件51/51、runtime14/14、observer1/1均通过；[D5本版30/30](evidence/d5-2026-10-06T13-43-28-781Z.json)为本地HTTP/持久fare fixture、HEAD2a7a16b、codeUnchanged=true，不计真实Provider。固定回放`backend/.demo/d6-fixed-replay/fixed-replay-2026-10-06T13-44-43.875Z.json`两版各10/10 accepted、逐例语义一致、0模型/外部调用，p50总耗时12.848/12.996ms、DSH适配0.402ms，仅本地材料性能样本。首次完整backend136文件1264通过/1失败（325.19秒）在`app.test.ts`出现5秒timeout，同时有H5构建与其他工程任务运行；原日志`output/d6/backend-unit-r15-final.log`保留。所有大型构建结束后，相同源码和原配置完整重跑136文件1265/1265通过（184.52秒，output/d6/backend-unit-r15-serial-recheck.log），原超时项558ms通过；没有提高测试/产品超时。这支持构建负载影响的解释，不删首轮失败。前端conversation-progress113/113、session20/20、artifacts37/37、production-presentation52/52及根TypeScript通过；weapp初次spawnSync git EPERM的概要保存于output/d6/weapp-build-r15-launch-eperm-recovered.log（reported-summary，非原始全日志），获准子进程重跑构建成功，原CSS顺序/体积警告保留。H5构建成功（154.809秒、已有体积警告），仍不计真实页面通过。B01随后真实FAIL，0 accepted攻略，后续8动作blocked；原报告、失败截图与只读PG草稿已联合审阅，详见下述r15失败记录。

2026-10-06 r14交互前冻结：源码提交`e9c9cb4418cd0f0e9537f5ea3c67cd1cfef26f94`，核心源码指纹`c5a438b29e774ae6ebac09d7ece413079250de73a2cfd4ac13daccfddedfe5c7`，backend构建`e58376bf547e226cdf993c4c65793cda8abd7f1dc04966e62ae9e9bd7126de89`，H5构建`e76021b0de6d94e2accba9359475928152a9594d73c4e8a9cb26954df7ecb4a1`，worker指纹仍`657015d487ffa07f5597ba1baf19490d538e47cf4c6f4d8ed48e738033ce872e`，旅程SHA256仍`91240ac6c741a990ad4a233451cc5982702b9d3856eb85597fa88206be943780`。run`283bdb17-de90-403c-b729-0ad35b6eb991`，私有目录`backend/.demo/dsh-d6-runtime/d6-iteration-b01-r14`，独立schema`dsh_d6_283bdb17de90403cb7290ad35b6eb991`、API58487/H559917、TTY30953。实际配置deepseek-v4-flash/deepseek-official/thinking disabled/max_tokens8192，地点配置与当前授权保持；H5手机布局390×844/DPR1、默认Chrome UA、mobile/touch=false。D6-23至26已实现，check/build及联合112/112通过，完整真实PG11文件51/51（55.10秒）通过；其他完整工程正在执行，真实H5尚未发送。标准v1、日期与12固定+4探索自然输入不变；任何源码/核心配置修订均须新批次完整重跑。

2026-10-06 r13交互前冻结：源码提交`743fddd82685f37ed6222e2a30dad0de533e622d`，核心源码指纹`72e7811182a6e9c0ada051cd5cbce8c4ef3b18648da3dba4d94164e860eeb2ac`，backend构建`a90a8e5cfb79886c9d5a7dc09b08bc3fc6e8dce2422651f0398ce6cf3ace88dc`，H5构建`e533c02df53a72d5dee75acf7d920dc57df43ea57b8526b0ccdbe98e8a906cd8`，worker指纹`657015d487ffa07f5597ba1baf19490d538e47cf4c6f4d8ed48e738033ce872e`，旅程SHA256仍`91240ac6c741a990ad4a233451cc5982702b9d3856eb85597fa88206be943780`。run`fc399e4b-3e2f-41b0-834e-6754fbe3fa37`，私有目录`backend/.demo/dsh-d6-runtime/d6-iteration-b01-r13`，独立schema`dsh_d6_fc399e4b3e2f41b0834e6754fbe3fa37`、API50541/H558251、PID83760、TTY12454。实际模型deepseek-v4-flash/deepseek-official/thinking disabled/max_tokens8192及授权边界不变，390×844/DPR1、Chrome默认UA、mobile/touch=false；标准v1及12固定+4探索输入未变。check/build、定向联合207/207通过，runtime14/14、observer1/1；完整backend/PG/D5/前端回归正在运行，真实UI尚未发送。任何源码或核心配置修改使本批失效，原r12失败不改写或计入本批。

2026-10-06 r12同冻结源码工程回归：backend134文件1229/1229（171.10秒），真实专用PG11文件51/51（45.47秒），runtime14/14，observer脱敏1/1均通过。backend首次受限进程在Vitest配置加载阶段遇到spawn EPERM、尚未收集任何测试；授权本地子进程后原命令完整通过，未改测试时限或源码。前端四族/根TypeScript、backend check/build及H5/weapp构建亦在本版通过。D5 [本版完整证据](evidence/d5-2026-10-06T10-05-41-018Z.json)30/30、codeUnchanged=true、HEAD=d9954f4，首轮9/21、自动恢复21/21，均是本地HTTP/持久票价fixture；不称真实Provider性能。固定材料回放 `backend/.demo/d6-fixed-replay/fixed-replay-2026-10-06T10-07-40.042Z.json` baseline/D6各10/10 accepted、逐样本语义一致、0模型/外部调用、无失败。阶段日志均为忽略目录 `output/d6/*r12-final.log`。真实H5及正文/持久化联合评阅仍待完成，工程通过不是D6 PASS。

2026-10-06 r11 完整工程保留失败：backend1223/1224，cloud-state授权单例触及5秒测试时限，原文件单独复验3/3；真实专用PG50/51，Goal持久化文件单独仍11/12。PG的同值setter fixture只手工设置active Goal IDs，缺少D6-14要求的真实服务器激活范围，写前正确以GOAL_FIELD_SCOPE_MISMATCH拒绝。原测试改为先检查未激活零写，再通过真实`resume_goal`工具绑定已接受同generation run，然后保留原持久回执、fresh repository与stale proof断言；不手填scope，不修改产品保护。修改后 `npm run test:db -- src/agent/goals/postgres.integration.test.ts` 在真实专用PG定向12/12通过（10.38秒）；完整PG复验已11文件51/51通过（95.35秒），最终冻结完整套仍待完成。D5本版30/30、runtime14/14、前端4族/根TypeScript及weapp构建通过，不能掩盖两个原完整suite失败，也不能替代H5旅程。

2026-10-06 D6-17 / r10 提交反馈修复：原session的五次commit依次为缺8个category、未接受Goal却省略intent、三天安排违反两天Trip并含精确耗时、只交text而缺days、最后两天安排被参数纠正上限拒绝。category缺失现在列出原枚举和字段；反馈读取现有context的Goal接受状态，未接受则保留真实首次intent，已接受则省略并保持Goal；日覆盖返回从准备Trip派生的预期天数/提交日序/日期窗口，完整重提days和text，同时保留来源重复与精确文字纠正。不自动补语义、截断天数或增加任何额度。

日覆盖红测1失败后commit/preparation45/45通过；联合6文件曾67/68（feedback测试仍使用未接受Goal来期待省略intent），更正为分别验证未接受/已接受状态后最新feedback12/12通过，其余5文件56/56；backend check/build与当前构建包含最新反馈已核验。runner手机390×844静态语法、docs113份/720链接、diff检查通过。原r10失败保留，手机B01与最终12+4仍待完整复验。

八个测试族均必须覆盖，无失败删除、无内存替身替代 PostgreSQL：

| 族 | 冻结预期 |
| --- | --- |
| A1 Goal/适配 | 首次真实 intent；省略 goalRef/hash/version 正确提交；首次无 intent 拒绝；同轮修复复用固定 Goal，变更意图拒绝；跨消息编辑新 Goal |
| A2 引用 | 当前 candidate/source 短引用映射；伪造、跨 owner/Trip/generation、过期、重复候选拒绝；短引用不跨代重新指向 |
| A3 地点 | 唯一标准城市补齐；本地命中零外部调用；真实歧义返回候选；城市/机场/POI 不混淆、不猜机场、不硬编码案例 |
| A4 版本/CAS | 生成期间 Trip/flight/base guide 变化旧结果不覆盖；短事务条件写；受控同轮 Trip update 刷新快照且失效旧材料 |
| A5 编辑/去重 | 非目标 slot、预算语义、航班、来源保留；重复请求/工具消息不重复正式成果；基底绑定生成依据的真实 hash |
| A6 来源/公开内容 | 搜索失败/403/空正文/challenge/网页指令/错误引用正确处理；无证据精确事实和预算保证拒绝；合法预算目标和可信结构化航班显示不误杀 |
| A7 生命周期 | 取消/超时/迟到 IPC/重启/warm-cold/连续对话/Memory 变化保持隔离；取消确认后零迟到写；未完成历史任务不重放 |
| A8 D5 | 503/429/401 有界恢复、每次计量、独立修复额度保持；截断无半成品 accepted；完整 D5 10类×3次分母30 |

执行：实际 package.json 的 backend check/build/test/test:db；DSH runtime 独立测试及 D5 runner；前端 conversation-progress、session-recovery、artifacts、production-presentation；H5/weapp build；docs 检查和 diff --check。先审查出站边界，PostgreSQL 使用独立 loopback 数据库/schema，不访问 public 业务数据。每次命令/分母/结果及未运行边界追加到本报告。

## B：最终真实 UI 固定旅程

2026-10-06 r14同冻结源码完整工程已通过：backend136文件1256/1256（209.23秒），真实专用PG11文件51/51（55.10秒），runtime14/14、observer1/1。D5[本版30/30证据](evidence/d5-2026-10-06T12-00-00-362Z.json)的HEAD为e9c9cb4、codeUnchanged=true，首轮9/21、自动恢复21/21，均为本地HTTP/持久fare fixture，不算真实Provider。固定回放`backend/.demo/d6-fixed-replay/fixed-replay-2026-10-06T11-59-55.873Z.json`两版各10/10 accepted、逐例语义一致、0模型/外部调用；P50总耗时baseline15.812/D616.530ms、adapter0.523ms，差值仅描述本地小样本，不推断真实速度保证。前端四族113/20/37/52、根TypeScript均通过；H5已由本版launcher正式构建，weapp首次spawnSync git EPERM日志保留，获准子进程重跑18.03秒构建通过，仅工程。runtime/observer初次EPERM启动日志亦独立保留于`output/d6/*-r14-launch-eperm.log`。所有最终阶段日志均为忽略目录`output/d6/*r14-final*.log`。随后原B01真实页面首轮失败，工程通过仍不代表D6 PASS。

2026-10-06 r14 B01原失败：私有`backend/.demo/dsh-d6-runtime/d6-iteration-b01-r14/evidence/B01-2026-10-06T12-06-41-180Z.json`，Chrome默认UA、390×844 viewport/screen、DPR1、mobile/touch=false。首发送96ms受理、157339ms终态、整段160385ms，accepted攻略0、首可读计时null；后续8动作blocked。实际查看失败截图，页面明确本次规划未完成；没有180秒timeout或output_limit证据。七次commit依次INVALID_ARGUMENTS、DSH_TOOL_FAILURE、DSH_TOOL_FAILURE、DSH_TOOL_FAILURE、GOAL_INTENT_CONFLICT、DSH_TOOL_FAILURE、DSH_COMMIT_CALL_LIMIT；末次calls=6、argumentCorrections=2、contentAttempts=0、lastFailure=system，不把未知内部错误当作内容违规。原session确认首稿六项candidates都有sourceRefs但缺locationId；后续resolve并显式补locationId，仍失败。[脱敏完整失败证据](evidence/d6-r14-b01-2026-10-06.json)保留分母、错误顺序、费用和局限。

只读联合审阅`backend/.demo/d6/B01-2026-10-06T12-11-40-929Z.private.json`确认Trip v1仅存全程CNY1200、文化/小吃兴趣和relaxed；destinationIntent仍open/required空，departureWindow/returnWindow/travelDays均空，setter satisfied、guide Goal pending、artifacts空。缺准备字段是实测事实，尚不足以证明四次DSH_TOOL_FAILURE根因；不得从自然输入猜写日期/目的地或放宽校验。24model/10search/18fetch/0fare，34 settled、pending0，845382输入+17804输出=863186 tokens，USD2.16预留、实际费用未知；截至r14累计至少167model/71search/0fare、USD15.20预留非实付。服务TTY30953已Ctrl+C正常关闭，PID56752退出、58487/59917无监听、server/manager锁释放，guard恰1 installed/1 closed、forbidden0；全部schema/会话/账本保留，旧历史账本SHA仍`3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`。继续离线定位，确认代码根因后补回归/最小修复，再建立新冻结完整复验；不盲重发、改超时或增加修复额度。

2026-10-06 r13 B01原失败保留于私有`backend/.demo/dsh-d6-runtime/d6-iteration-b01-r13/evidence/B01-2026-10-06T10-58-46-687Z.json`。真实Chrome154默认UA、viewport/screen390×844、DPR1、mobile/touch=false；首发送107ms受理、111202ms终态，整段115748ms，accepted攻略0、可读计时null。后续8动作blocked，没有把内容/提交失败当自然澄清继续。页面显示攻略未通过内容或发布检查；没有180秒超时或output_limit证据。只读联合审阅`backend/.demo/d6/B01-2026-10-06T11-03-28-124Z.private.json`确认Trip v1/Tokyo JP/TYO/11月3–4日/2天/全程CNY1200/relaxed，trip_context_update satisfied、travel_guide未satisfied、无Guide。两次commit均DSH_GUIDE_NEEDS_REVISION、revisionReasons=[candidate_key_unavailable]、contentAttempts0、argumentCorrections0、lastFailure prerequisite；模型21次后completed仍未交付，不能按completed或耗时减少算通过。21model/11search/14fetch/0fare，32条账本全部settled、pending0、727783 total tokens，USD2.16预留，实际费用未知；连同截至r12记录累计至少143model/61search/0fare、USD13.04预留非实付。正在对照原提交与候选注册定位；源码和标准未改，禁止盲重发或增加额度掩盖缺口。

本次[脱敏失败证据](evidence/d6-r13-b01-2026-10-06.json)包含完整动作分母、终态/可读计时、两次拒绝、只读持久化结论和费用未知边界。原session进一步确认：两次提交均省略整个candidates数组，首稿六个candidateKey没有本轮注册定义，第二稿对相同六地点全部换key仍未补定义。首稿allowPartial=true；未进入save/publication，故不能把本次失败解释为内容违规或断言r12预算文案已在真实链路通过。修复限定候选注册条件、受控字段反馈与首次接受前零写检查，保留主模型来源语义选择及完整证据核验。r13已通过TTY Ctrl+C正常关闭：PID83760退出，50541/58251无监听，server/manager锁消失，guard审计恰1 installed/1 closed、forbiddenCalls=0。原schema、会话、证据及账本全部保留，旧历史账本SHA256仍为`3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`；后续源码修改须新冻结完整重跑，不沿用r13工程通过。

2026-10-06 r13同冻结版本完整工程已通过：backend135文件1240/1240（189.78秒），专用真实PG11文件51/51（46.78秒），runtime14/14、observer1/1。D5[本版30/30证据](evidence/d5-2026-10-06T10-54-12-301Z.json)为本地HTTP/持久fare fixture，HEAD743fddd、codeUnchanged=true、首轮9/21、恢复21/21；不计作真实Provider结果。固定回放`backend/.demo/d6-fixed-replay/fixed-replay-2026-10-06T10-55-34.367Z.json` baseline/D6各10/10 accepted、语义逐例一致、0模型/外部调用；p50总耗时9.804/11.249ms，DSH适配0.330ms，差值为本地小样本、不推断真实性能保证。前端conversation-progress113/113、session20/20、artifacts37/37、production-presentation52/52、根TypeScript通过；weapp初次在spawnSync git EPERM前置失败，原日志保留，获准子进程重跑通过，仅工程、不计微信页面验收。日志均保留于忽略的`output/d6/*r13-final*.log`；工程通过不表示D6 PASS，现在开始390×844真实B01及完整12+4的正文/持久化联合评阅。

2026-10-06 r12精确定位及D6-21：原worker两次完整提交均回`issues=[verified_evidence]`、`repair.issues`分类evidence_missing，并附`presentationIssues=[excluded_precise_claim]`。首次intent为allowPartial=false；用户只要求两天文化/小吃与全程1200元，未要求独立核实。当前raw来源新候选均为partially_verified，固定Goal因此不可能由修稿满足。第二稿唯一精确文字拒绝为overview中的1200元全程目标，同句附“实际花费会因住宿、餐饮与购物选择而不同”，未产生具体价格或预算可行保证，但现有豁免把“实际花费”判为正面成本声明。DSH已新增首次raw候选/strict intent兼容性门，在Goal及研究写入之前返回受控前置字段，不自动改intent、放宽已接受Goal或增加任何额度。定向红测2失败/49通过→修后51/51，backend check通过；合法目标误拦与observer反馈漏采正在独立修复，新的官方worker接线回归待完成。原严格Goal回归改为先创建真实持久strict Goal再激活，继续验证raw证据拒绝、allowPartial不可改变、0攻略；这是前置门变化后的明确初始状态修正，不删除原严格证据约束。日志在忽略目录`output/d6/d6-21-prerequisite-{red,green}.log`。

r12已通过TTY Ctrl+C正常关闭：PID85304退出，API63839/H561468无监听，server/manager锁均不存在，原audit恰一条guards_closed、forbiddenCalls=0；会话、schema、失败报告和D6账本保留。原历史账本SHA256仍为`3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`。首次Vitest配置加载EPERM的原同名日志被成功重跑覆盖；已从首次工具输出恢复到忽略的`output/d6/backend-unit-r12-launch-eperm.log`，首行注明recovered-from-tool-output，不能称原始落盘文件。

2026-10-06 r12 B01原失败保留于私有 `backend/.demo/dsh-d6-runtime/d6-iteration-b01-r12/evidence/B01-2026-10-06T10-10-09-761Z.json`。实测Chrome154默认UA、viewport/screen390×844、DPR1、mobile/touch=false。首发送99ms受理、66680ms终态，accepted攻略0，可读计时null；delivery为partial/travel_guide、missing accepted_publication。后续解释、局改、刷新等8动作均blocked，没有重发失败需求。只读联合审阅 `backend/.demo/d6/B01-2026-10-06T10-12-43-463Z.private.json` 确认Trip v1/Tokyo JP/TYO/11月3–4日/2天/全程CNY1200，trip_context_update satisfied、travel_guide partial、无Guide。12model/4search/5fetch/0fare、16条账本全部settled、pending0、393653 total tokens，仅预留USD0.96，实际费用未知；连同此前D6迭代累计122model/50search/0fare、预留USD10.88。三次commit依次为DSH_GUIDE_NEEDS_REVISION、DSH_GUIDE_NEEDS_REVISION、DSH_REPAIR_LIMIT，contentAttempts达到2、argumentCorrections0；observer未给出具体revisionReasons，尚未据此推测根因。没有观察到output_limit或180秒超时；66.680秒为失败耗时，不是完成攻略耗时。需定位、补回归、修复后新冻结完整重跑，不能增加修订额度或凭工程通过宣布PASS。

2026-10-06 真实交互前冻结候选完整批次 r11：源码提交 `57d2c1b`，工作树核心源码指纹 `b3225344c05ce07b81121494f8e2e036cd395a2678a0793fefb35ba3dc3d6151`，backend构建 `58ae2a14c2c79036ff9fc68706512ccf7ef29de13a99a52da3afaebb8a65bf1d`，H5构建 `f5c0f88764e57565c462cc596ab98c49d6a23865d3416e2f7d0bf06e1e499181`。run `13d1f214-6ee4-4a55-a190-7070b7cb1542` 保存于私有 `backend/.demo/dsh-d6-runtime/d6-iteration-b01-r11`；API56227/H559502，TTY14746。配置仍为deepseek-v4-flash / deepseek-official / thinking disabled / max_tokens8192，SerpAPI只用本轮授权既有余额，逐次计量；手机viewport390×844。本批从原B01开始，全部12固定+4探索及完整工程回归须在相同版本完成；任何源码/核心配置修改立即使整批失效，不保留成功例凑分母。当前尚无旅程通过声明。

冻结日期使用 2026-11-03 至 2026-11-09 的未来窗口，不随运行日漂移。北京出发单程范围为 2026-11-03 至 2026-11-05；需要澄清时如实记录，禁止教产品工具协议。最终总分母12；生成样本与澄清/停止类分开统计。初始身份使用项目合法本地测试登录，其余创建行程/消息/采用航班/详情/停止/刷新/重进均 UI；不注入攻略，不 mock 最终真实 Provider。

冻结的自然语言输入和动作顺序见 [D6 UI journeys v1](d6-journeys.json)。执行合同为 `version: 1`、`journeys[].id` 和按序 `actions[]`；双语 `inputs` 仅是人工对照，不由runner执行。消息保持自然语言，不包含内部工具、intent、引用或版本字段。B09/B10 在生成中的取消使用 `send.awaitTerminal:false` 后立即 `stop`；B11/B12 的隔离后端冷重启是人工操作步骤，沿用同一隔离数据库、D6账本、身份密钥、构建与run目录。航班、澄清和发布均以实际页面结果为准，journey 文件不预置或伪造成功结果。

2026-10-06：在不变更12+4分母与冻结自然语言输入的前提下，将B11/B12详情验收步骤具体化为UI动作。B11从Planner结果及My Trips已保存攻略双入口进入详情，逐活动打开并记录详情sheet，返回概览退出并重进，同run冷重启后重读，然后显式切英文、点击首次本地化并要求单次`POST /v1/artifacts/:id/localization` 200，再切回中文。B12在航班UI采用后等待规划turn终态，并对实际攻略逐活动读详情、同样要求首次localization POST与中文返回、刷新及冷重启。journey与runner已表达这些条件，尚未真实运行；不能把动作配置计作通过。

| ID | 自然目标与必要步骤 | 通过预期 |
| --- | --- | --- |
| B01 | 自备票东京11/3–4，文化小吃，全程1200元；解释；仅改第二天下午；刷新 | 实际 accepted 两日；解释无新攻略；其他slot不变；恢复零生成 |
| B02 | 自备票东京11/5–6，全程1800元，安静文化体验；解释；仅改第二天下午；刷新 | 同上且偏好/预算口径准确 |
| B03 | 北京→葡萄牙单程11/3–5，省钱，明确允许独立出票自转机；UI采用真实结果后规划11/5–8 | 真实查票与采用，不保证全球最低；真实航班绑定，多日accepted |
| B04 | 北京→葡萄牙同窗口，省钱，不允许独立出票自转机；UI采用真实结果后规划11/5–9 | 合同内真实路线/采用；权限未放宽；实际交付 |
| B05 | 自备票京都11/3–7，文化饮食，之后只改一时段 | 五日完整accepted；地点准备及兼容资料复用；非目标保留 |
| B06 | 自备票里斯本及波尔图11/3–9，明确城市次序，之后减少购物偏好 | 支持范围内完整交付；不支持时昂贵执行前准确解释；不用于替代B01–04生成要求 |
| B07 | 问当前预算，设全程2000元，重复确认；未指定地区的“圣何塞”安排请求 | 问答只读，正确值无多余写；总额不变每天；真实歧义先澄清 |
| B08 | 问当前预算，明确每天500元并确认总额口径；未指定地区的“圣地亚哥”请求 | 不猜scope/地区，正确澄清；不承诺预算足够 |
| B09 | 东京两日生成中UI停止；改偏好再继续 | 确认停止、无迟到写/双活跃/busy；后续真实accepted |
| B10 | 京都多日生成中停止；改变预算再继续 | 同上，版本/材料更新准确 |
| B11 | 自备票东京生成后退出重进、刷新、隔离服务冷重启、显式英文再中文 | 可读accepted恢复；读缓存零模型/研究；首次本地化按原合同计量 |
| B12 | UI采用真实票后生成，另一入口详情/恢复/冷重启、中英操作 | 航班绑定与accepted持久恢复，缓存无重新规划 |

无票/网页不可读的真实结果保留，不能伪造或将API成功当交付。B03/04/12若真实外部能力无法满足，准确记录失败/硬阻塞，不换成 synthetic 通过。

## 探索：固定用户目标，分母4

E01 模糊但合理的“想找安静的文化城市”推荐与连续追问；E02 中途改变旅行主意和目的地；E03 陌生合理目的地塔林 2026-11-03 至 06 的四日需求；E04 推荐→只读解释→明确选择→规划的连续对话。开始前记录自然输入，探索与修复回归分开统计。要求没有未解决阻塞级问题，不能改测试提示词教 Agent 内部字段。

## C：判定、证据与平台

2026-10-06 r11 候选批次已失败，保留原件 `backend/.demo/dsh-d6-runtime/d6-iteration-b01-r11/evidence/B01-2026-10-06T08-37-21-687Z.json`：真实手机实测viewport/screen均390×844，Chrome默认UA，非微信设备仿真。首发送114ms受理、64982ms终态，accepted攻略两天6项；匹配当前Artifact并逐活动读完详情后可读计时69488ms。随后runner在header返回按钮的CSS宿主与`getByRole(button, name=返回|Back)`相交定位超时，故解释、局改、刷新仍未执行，完整B01及本批12+4均不通过。正在核对真实编译后DOM；不能只凭组件props、API/Goal satisfied或此次首成果宣布修复或验收通过。

同scope只读数据库确认一份accepted攻略，Trip日期2026-11-03至04、两天、Tokyo、relaxed、全程CNY1200；11model/3search/6fetch/0fare，14条费用回执全部结算/pending0，预留USD0.80、实际费用未知。含4条available来源的后续正文/语义联合评阅见下。连同此前D6迭代累计110model/46search/0fare、预留USD9.92，不把未知预留写成已付费用。当前r11服务仍运行，禁止重发本次B01来掩盖失败；先做零Provider导航定位再修复。此前r10失败及冻结指纹保留。

2026-10-06 r11 逐引用内容评阅：按提交的实际 `sourceRefs`→原始evidence记录→已抓正文核对，未按相同URL合并证据。仲见世、Hoppy通、谷中银座、阿美横丁共用的街头饮食文章确有各地点材料；明治神宫的JNTO正文有对应地点。浅草寺/雷门候选却绑定到GO TOKYO通用景点分类页，其实际4768字正文不含该地点或相关寺庙内容，是已确认的来源覆盖缺口，accepted/Goal satisfied不构成内容通过。第二天跨区较多；“边逛边吃”与停下进食提醒、以及“住宿与较大额开销另行安排”相对全程预算有表述歧义，尚不把这些判断写成已确认数据错误。预算结构仍为全程1200、未验证可负担，人数及费用涵盖未明确。r11两次web_fetch确实请求同一JNTO URL且正文hash相同，是本轮真实重复抓取；r10所有fetch URL均独一，不能把r11证据反推为r10重复。正在定位最小修复与回归，未新增Provider调用；完整B01保持失败。

D6-18：针对r11确证的同URL重复抓取，新增真实安全reader/受控HTTP定向回归 `fetch-reuse.test.ts`：要求同准备轮次精确URL并发仅一次HTTP，后续调用复用原receipt/hash/retrievedAt；403不缓存，URL查询参数、generation和Trip version不同不共享。第二个并发工具结果标 `sharedFetch`，区别于已有receipt命中 `cacheHit`；各调用保留取消检查，启动reader的signal控制实际请求，取消的非owner等待者不产生receipt或停止owner请求。它不代表语义验证，也不宣称跨轮通用网页缓存。

D6-18红绿记录：首次沙箱esbuild spawn EPERM未执行测试；允许已授权本地测试子进程后，原真实reader回归修前1失败/1通过，失败明确为精确同URL发生两次HTTP。并发扩展回归也先复现一次调用发出两次HTTP；修复后 `fetch-reuse.test.ts` 5/5通过，覆盖并发共享结果/receipt身份与时间/hash、失败和scope隔离、共享等待者取消不写receipt，以及owner取消会中止共享reader并允许重试。先前 `fetch-reuse/web/evidence/evidence-file`四文件23/23通过（11.51秒），backend check通过；主service/worker与web/reuse联合19/19通过（11.38秒），backend build通过；observer官方fixture worker审计1/1通过（1.42秒），当时只核对cacheHit布尔值且正文/私钥/URL查询不泄露。共享中的 `sharedFetch` observer allowlist与fixture复验由本批后续完成；不得将并发工具调用数等同真实HTTP数。真实新冻结批次尚未开始。真实PG完整复验11文件51/51通过（95.35秒，`output/d6/postgres-r11-fixture-recheck.log`），原r11 50/51保留，不冒称最终同版整批通过。

D6-19：r11通用GO TOKYO正文已经完整交给主模型，缺陷是具体候选与来源的语义选择。现有主模型tool/persona合同明确逐候选检查正文，不以城市目录/URL标题/权威标签替代具体地点支持；正文仅提名字不支持额外菜品设施规则。缺口针对研究或选有支持的活动，保留原天数和兴趣；全程预算不能自行排除住宿及大项。没有新增字段、第二模型或字符串词典“证明”语义。旧r11 accepted攻略仍有来源覆盖缺口，修后真实内容行为须新批次再验，不凭静态提示词单测声称改善。

D6-18并发扩展后联合回归：`fetch-reuse/web/evidence/evidence-file/service`五文件33/33通过（17.66秒，`output/d6/d6-18-expanded-green.log`），当前check/build通过；sharedFetch与cacheHit的observer官方fixture worker审计1/1通过（1.26秒，`output/d6/d6-18-shared-observer-green.log`）。受控HTTP并发证明一份read与原receipt；取消原始reader会使shared请求失败且可后续重试，取消非发起waiter只拒绝自己。源地址/DNS检查可在HTTP前失败，不能将新reader尝试数自动等同实际HTTP。真实新完整冻结批次尚未启动。

生成必须有实际可读、可恢复的 accepted 攻略，日期/航班/日程覆盖/预算/偏好/编辑范围符合要求；无错误日期、伪造来源、无依据价格或预算保证。全页面和详情人工评阅，保存截图/可见文字/network/console/只读DB/日志。API200、worker完成、delivery均不能单独判PASS。

最后冻结代码SHA、工作树及构建指纹、核心配置后完整B01–12；修改即新建最终批次完整重跑。保留累计失败、尝试与最终批次，严禁挑最佳12次。微信可用则真实正式构建验证发送/生成/编辑/双入口恢复/取消；H5、微信、真机分别判定，mock或构建不代表平台PASS。

2026-10-06 平台范围调整：用户明确“暂时不用验收微信小程序内的内容，先验证H5”。本轮真实交互验收只覆盖H5，不开启微信开发者工具CLI安全服务端口；保留weapp构建工程检查，但微信与真机均标记未验收。A族、H5的12固定+4探索分母、同版冻结及内容/持久化/费用标准保持不变。

2026-10-06 H5 action contract clarification: the natural-language inputs and 12+4 denominator remain unchanged. Generation actions now assert the Artifact type already specified by each frozen outcome; B03/B04 route discovery expects `flight_search`, followed by `travel_guide` after UI adoption. Accepted guide journeys open the final visible result and inspect every activity detail sheet; B06 inspection is conditional because an accurate early unsupported-scope response is also within its rubric. `--interactive` is separate diagnostic evidence: only completed `responded` turns with no delivery attempt may pause for an operator's real UI choice/reply, and the resulting report is `interactive-assisted`, never an unassisted PASS. Same-page route-aware reload/restart logic and scoped authenticated readback are runner changes still pending final H5 verification; they do not relax recovery expectations.

## 批次及问题台账（追加）

2026-10-06 r14离线根因确认：原唯一setter的patch与接受fields均只有budget/interests/pace，模型未提交目的地/date/duration，服务没有丢掉这些已提交字段。全部原evidence文件均为Trip v0，提交选中source alias scope为`3f4bc23c62`，setter将Trip推进v1后当前scope为`5d06f1b1f3`。在原r14编译模块、原只读文件repository、新v1 store上对step18六个选中sourceRefs逐个调用get，均抛`TypeError: Evidence reference must be a canonical UUID or lowercase SHA-256`。store未命中已注册别名时把旧s1字符串传入严格文件repository，尚未执行scopeMatches就抛错；内存repository返回null掩盖了这条真实文件差异。这精确解释后续原四次提交在同旧scope材料上被映射DSH_TOOL_FAILURE、0 Artifact写入的路径，不将它当正文违规。修复限定未知别名返回不可用、已注册及legacy canonical引用继续原scope校验，不吞真实文件损坏异常、不重贴旧version。setter实际推进版本时向主模型明确旧raw材料失效；通用准备说明要求先保存用户明确的全部条件再取证，代码仍不猜日期/目的地。文件与官方worker红绿回归由本批后续验证记录，原r14仍FAIL。

2026-10-06 r9/r9a B01 selector harness failure: r9 failed during H5 Webpack setup with Windows `spawn EPERM` and made zero Provider calls; its run directory/schema remain preserved. r9a was a separate launch after permitting the same local build subprocess. The first send was accepted in 97ms; a generic `.pl-result` card appeared at 67.071s and terminal status was observed at 70.760s. These are not accepted-guide readability times. The run settled 12 model and 5 search calls with pending count 0; cost receipt remained unknown. The first turn produced an accepted two-day guide with seven activities, and all activity details were read before the report failed in `inspect-latest-result` because the runner expected the demo-only label `返回行程概览`. The production `PublishedTripExperience` uses `trip.back` (`返回` / `Back`) on the single header button; screenshot shows the days view with that arrow, and the source makes it return to overview from a tab or call `onBack` from overview. No separate accepted-guide-readable timestamp exists in that historical report. Thus this is a harness failure, not product navigation failure or PASS; explanation/edit did not run. The failed r9a report is unchanged. The runner and B11 selectors now match the production labels and preserve visible overview/Planner waits; `node scripts/test-production-presentation.cjs` renders the component and checks zh/en labels, both transitions, and B11 destination waits. The runner now records accepted-guide readability after the matching accepted Artifact's activity details are read, with unknown submit timing kept null and original submit-to-terminal evidence retained. r9a's TTY shutdown completed with no `server.lock`, exactly one `guards_closed`, exited PID and closed API/H5 ports; no pending D6 ledger entries and the old ledger SHA-256 remained unchanged. Same-run cold resume remains unverified; this was not the final frozen source/build.

2026-10-06 r10 B01 reliability/performance observation: first `commit_travel_guide` began at 166.712s after 26 model turns, 14 official-search calls, and 22 fetch calls; the commit tool itself returned in 9ms. Final model response arrived at 196.601s and the turn reached terminal at 197.647s, but no accepted Artifact or visible result was produced. The retained browser report records the first send as failed after 200.444s and the other eight planned actions as blocked; this is a failed journey, not a slow success. Run-level budget entries contain 31 model and 14 search receipts, all settled with pending 0; fare audit calls were 0. Reported usage totals 1,182,504 tokens (1,168,641 prompt, 13,863 completion). Reserved cost was US$2.92 (US$1.24 model plus US$1.68 search); this is reservation, not a provider invoice or actual-cost receipt. The linked prior ledger remained SHA-256 `3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`, 984 entries and pending 1; it was not reset or overwritten. After TTY Ctrl+C, the process exited, API/H5 ports were closed, both locks were absent, and the runtime audit contained exactly one `guards_closed` record.

Read-only research audit of r10: the 14 search request hashes and 22 fetch URL hashes were all distinct, so the run does not show literal repeated queries or repeated fetch URLs at the tool-call layer. Across 99 evidence metadata records, 14 exact URL groups appeared twice (mostly a `deepseek-official` `no_body` source paired with `flightor-safe-fetch`); metadata statuses were 12 `available`, 83 `no_body`, 3 `http_error`, and 1 `invalid_url`. Seven fetch result bodies matched one of two repeated body hashes even though their request URLs differed. This establishes exact URL/source overlap and repeated response bytes, but metadata alone cannot establish complete semantic coverage of the requested guide. Small deterministic reuse candidate: within the same turn/context version, index evidence by canonical URL and reuse an already available fetched body across later planning steps; keep search-only/no-body records ineligible for body reuse and preserve freshness/source-applicability checks. Do not infer that broader query deduplication would have reduced this run: query hashes were unique. D5 records that single-turn context can still grow with research; the current Planner prompt already asks the model to reuse compatible evidence and research missing information rather than every day. This observation does not authorize changing token limits, budgets, model count caps, or fixed test input.

The D6 H5 runner uses the prior H5 harness's 390x844 viewport and records browser environment fields. It retains desktop Chrome UA semantics with mobile/touch emulation off; these dimensions are phone-sized browser layout evidence, not WeChat-device acceptance.

当前基线 f2ec6c1；本轮已执行下述迭代测试，真实页面与最终冻结批次待运行。付费授权已明确：D6 DeepSeek API 金额不限，逐次计量；其他供应商不继承历史不限。无已完成PASS声明。

| 问题 | 复现/根因 | 预期修复/验证 | 状态 |
| --- | --- | --- | --- |
| D6-01 | withGoalIntent允许省略，commit schema/persona/说明却强制重复内部Goal字段 | 同步输入面与固定Goal测试 | 已实施，最终验收待运行 |
| D6-02 | 局部编辑要求模型传baseGuideId/hash；准备快照未集中冻结 | 服务端绑定初始base及Trip，冲突拒绝/CAS回归 | 已实施；PG发现的会话内部/公开ID映射已修复，完整真实PG51项通过；最终UI待验证 |
| D6-03 | 公开规则/修复提示禁预算目标金额 | 精确目标确认允许，预算保证继续拒绝 | 已实施，定向通过并继续检查边界 |
| D6-21 | r12首次allowPartial=false Goal已接受，但选中的raw-web候选均为partially_verified，修稿无法满足verified_evidence | 首次接受前按已解析选择检查兼容性；主模型忠于用户要求显式纠正首次intent或说明不能独立核实，不自动降低Goal | 红测2失败→51/51、worker接线1/1；联合8文件207/207及check/build通过；完整新冻结批次待执行 |
| D6-22 | r12 overview合法全程1200元目标附“实际花费会因住宿、餐饮与购物选择而不同”，被目标豁免当正面价格声明 | 仅为精确匹配全程目标识别有界条件花费说明；其他金额、币种/scope、票价、每日金额及保证继续拒绝 | finalization78/78及联合207/207通过；红测/测试期望更正历史在公开错误说明中保留；真实新批待执行 |
| D6-23 | r13两次commit都省略candidates却使用六个未注册candidateKey，第二稿仅换名；首稿接受Goal后绑定失败，反馈未指出注册缺口 | 接受前确定性检查、明确字段/登记状态提示与schema说明；主模型显式补齐来源候选，不自动匹配网页或重复研究 | 联合8文件112/112、官方worker2/2通过；未取得有效产品修前红测，夹具失败另列；真实新冻结待执行 |
| D6-24 | r13候选绑定前置拒绝被公开错误归为publication，用户被提示内容/发布检查 | 仅将受控candidate_key_unavailable原因归为evidence；已知cause使用固定双语关联失败文案，不暴露内部key/码 | 分类/文案红测2失败→18/18、service/worker接线及联合112/112通过；真实新冻结待验证 |
| D6-25 | 源码检查发现新前置零写拒绝后，无GuideGoal时末端保留not_requested或前一setter的satisfied delivery，可能被误作澄清/攻略完成 | 未成功的guide提交使用既有partial交付结构及accepted_publication缺口，不伪造Goal身份；先成功setter仍保留其独立持久记录 | 官方worker2/2、联合112/112通过；旧局改断言更正前111/112及所有夹具错误单列保留，不当作产品红测 |
| D6-26 | 独立源码审查发现首次候选前置检查早于原Goal runtime/Trip snapshot/flight guard，可能用缺候选提示遮蔽真正的授权或scope冲突；尚非真实UI观察 | 将确定性检查置于原授权、目标kind、Trip版本和航班检查之后、accept之前；复用已有读取，保留旧Goal/恢复Goal规则 | runtime/stale Trip/flight优先级均零写回归通过，联合112/112、check/build通过；无新增DB往返，真实新冻结待运行 |
| D6-27 | r14 B01四次内部提交出现`DSH_TOOL_FAILURE`；原会话显示Trip版本推进后，旧短alias被错误送入只接受canonical UUID/SHA的文件repository并抛TypeError。setter后的地点/日期/天数缺失也需由主模型按用户条件准备，不能由代码猜 | 未知非canonical alias转为受控不可用，保留真实文件损坏及scope/canonical错误的失败关闭；实际版本推进才在内部回执标记旧raw refs失效；将地点准备条件加入通用persona。排查另发现20-path截断与110上限不符，增加有界110回归/修复 | 新7文件联合74/74及check/build通过；110边界有效红测2失败→31/31，红概要backend/output/d6/r15-location-feedback-red-summary.log、绿原日志backend/output/d6/r15-location-feedback-green.log。r14真实B01仍FAIL；新冻结全量工程/H5待执行，无PASS或硬阻塞结论 |
| D6-28 | r15两稿合法全程1200目标及否定每日同额被overview精确金额规则误拦 | 逐金额span识别权威总目标及同字段/句同额否定每日；保留价格、费用核实、其他金额/币种、肯定每日及保证拒绝 | finalization定向94/94；原稿不追认，新冻结待全验 |
| D6-29 | r15仅收到format，无字段；observer漏publicationIssues；repair limit覆写实质cause。新回归又发现repairHint中的source将format错归evidence | 共享validator的受控字段反馈、白名单observer、保留最后实质失败、仅读取code/issue分类 | 红测与定向结果见字段反馈合同；7文件209/209、check/build和observer1/1通过；最终冻结工程/UI待执行 |
| D6-30 | Astra发现五个工具schema各暴露三种Goal，而实际只接受一种，重复无效分支13590字符 | DSH模型schema按工具已定义kind权限收敛，领域执行schema及legacy兼容保持 | worker请求五工具分支验证通过；intent实测20845→7255字符，减13590，见schema证据；不据静态减负证明真实质量 |
| D6-31 | r15原source烤制甜甜圈被写炸制、周日建议混入周二/三；免费入场中文漏检 | 语义问题保留给主模型新自然输入审阅；中文免费开放/入场/进入补原合同拒绝回归，Wi-Fi/资料不误拦 | 机械校验通过不能追认正文；最终新H5逐字段审阅待执行 |
| D6-32 | r16完整backend的3个既有shortReply正例回归，合法英文for-the-trip、两天总预算、total budget否定每日被新span目标识别误拦；复审又确认小数切分、句末金额及daily-budget前缀边界 | 原期望保留，补reply文件到受影响必跑范围；仅权威scope=trip短答可确认总预算，出版仍需全程范围；逐金额拒绝每日肯定/其他金额，句点仅两边均数字时作小数点 | r16原1290/1293与关闭证据保留；r17四文件165/165及联合8文件267/267通过，首次联合启动EPERM无测试、允许同命令重跑日志保留；新冻结完整复验待执行 |
| D6-33 | H5 stop旧脚本接受cancel请求后的任意终态，可能将普通失败/完成算作成功停止 | 按实际cancelAndWait合同要求精确failed/AGENT_TURN_CANCELLED及页面停止/非busy，不改变产品API；cancel响应本身权威，不能强求取消后UI继续轮询；断言前保留实际取消材料 | 红测15/16→绿测16/16，根最终16/16、runner语法通过；B09/B10真实持久/迟到写检查待完整冻结验收 |
| D6-34 | r17真实B01原seq95/129的全程预算为与非每日/非已确认花费被词法规则误拦；第二稿已补实际practical材料但仍无accepted | 预算关系不强求目标口令，按谓词限制否定范围，保留整句后续肯定费用/每日/错误金额币种/保证拒绝，不增加修订额度；复审核实并修复单金额分句费用/daily、plural/compound费用否定边界 | 有效红测6失败/159通过，最终focused182/182、joint297/297、check/build与observer1/1通过；完整原文第二稿r17 blocked→r18 accepted，0调用。r17B01仍FAIL，r18新冻结完整工程及12+4待执行 |
| D6-35 | r18合法预算目标旁的实际花费以当地为准及门票信息以官方为准，被整句成本判断误拦 | 限定局部延期核实与纯名词枚举、相邻已确认/已支付成本及同额用途；补金额间隔预算足够保证，预算确认不跨括号变成费用确认 | 首版190/190仍有独立漏洞，保留全部红绿；最终focused211/211、Astra固定39/39（预算独立复核SHA见中间记录）、零调用，独立复核通过；费用/每日/币种/保证拒绝保持。根10文件联合367/367、build退出0、observer1/1通过；typecheck及PG fresh-read待回传，新冻结12+4未启动 |
| D6-36 | r18原官方正文有2026年event日期，但DSH候选schema与转换无法表达temporalEvidence，共享校验仅识别snippet的ISO | 主模型选当前来源短引用、原样引文及明确日期，服务端绑定真实来源；保持Trip日期/版本/权限/部分验证状态。修复URL-first次序、metadata标签裁剪及CJK括号跨范围误吞 | 首版focused89/89、联合366/366、check/build/observer1/1均为最终helper修订前结果；最终focused90/90、Astra独立35/35通过，零外呼。根10文件联合367/367、build退出0、observer1/1通过；typecheck、真实PG fresh-read及新冻结12+4待完成。原稿晚间slot仍内容不合格，不追认 |
| D6-37 | 正确拒绝重复day后模型反馈丢弃[1,2,2]，下一稿仅将重复日改rest又失败 | 回传有界有效day号、重复day及原索引路径；主模型选择实际活动，不代码合并/删活动/扩天数 | 红2失败→绿21/21；event缺省/引用前置与quote/date语义额度区分红6失败→绿28/28；最终独立复核通过。根10文件联合367/367、build退出0、observer1/1通过；typecheck/PG及新冻结H5 12+4待完成 |
| D6-38 | r19局改只填replacement规模6，但完整受保护活动/实用资料/替换共10，接受Goal后才失败 | compact编辑携带确切prepared base Goal原限额；完整合并结果在accept前检查，原Goal与保护资料不变；只读merge/research同输入立即复用 | 单元/真实PG定向通过，r20新冻结真实局改待复验 |
| D6-39 | r19公开回复擅自将全程预算排除机票/住宿或另计 | budget_scope_changed拒绝受控中英排除/另计表达；未知费用、否定排除及票品/行程范围保留；Astra两轮复核后收窄豁免 | 27个scope例、4文件241/241，check/build/observer通过；真实正文待新冻结复验 |
| D6-40 | r19 partial局改的安全答复被旧publication.reply覆盖，刷新仍显示旧成功 | 当前reply仅由本轮satisfied且Artifact ID绑定的publication替代；缓存partial/failed/cancelled恢复固定双语状态，旧攻略继续可读 | 前端定向303项和根TS通过；真实页面及恢复待新冻结复验 |
| D6-41 | r19 runner将局改partial和随后旧攻略读取记observed，可能误判成功 | 全部guide delivery检查satisfied及本轮ID；mandatory局改不得not_requested；解释无新攻略；正文按权威workspace budget检查，不改原journeys分母/输入/历史报告 | helper19/19及runner语法通过；实际读取函数另覆盖正确workspace路径、无预算、权威预算收窄及会话错绑；真实批次必须人工全文/详情/PG/费用复核，observed仍不是PASS |
| D6-42 | r20 B01两稿合法全程预算目标邻接“门票、餐饮等实际花费以现场为准”被误拦；换句号会通过，跨句“门票费用为这个金额”反而漏放 | 移除费用名词默认肯定及谨慎措辞白名单，改查局部肯定费用谓词、确切金额绑定和跨句金额指代；保留金额/币种/全程口径、每日、保证、费用与原修订上限 | 初版四族279/279后独立24例暴露5种肯定费用谓词/金额指代漏拦和whether问句误拦，新增红9失败/284通过→四族296/296；根check/build及实际构建[24例固定回放](evidence/d6-r21-budget-independent-replay.json)24/24。may cost金额估计仍拒绝；原r20仍FAIL，最终新冻结全量/12+4待执行 |

2026-10-07 对r20未发布原稿的只读内容审查：两稿安排相同7项，均非accepted成果。已保存JNTO滨离宫正文描述茶屋/水上巴士，但没有开闭园或茶屋营业时刻，因此其evening建议未获得现有资料的时段核实；离线证据不足以证明与某个真实闭园时刻冲突，不编造时刻、不追认旧稿。Hoppy来源支持日落后体验，Yanaka已保存店铺时刻与afternoon不直接冲突；其余粗时段仍不是逐时钟排程/交通可行性证明。后续真实正文验收须独立审阅这些边界，不能以预算校验通过替代内容验收。未修改数据库、会话、来源、原报告或账本，未作外呼。
| D6-15 | Taro 初始 main tab 页面尚未完成首次 ready 时，H5 原生 tabbar 可先发起另一标签的切换；native 与 custom 导航未共享页面就绪条件 | 任一 main tab 的 `useReady` 前禁用原生 H5/custom tab 点击，首次 main tab ready 后恢复原 `switchTab`；初始直达任一 main tab 可解锁，详情返回不重置门 | 已实施；session-recovery fixture 20/20、H5 build通过；真实H5复验待新run，late-hide因果仍未证实 |
| D6-07 | `update_trip_context` 的空 patch 返回 `changed: false`，但仍重建同 scope 的 evidence store 并复位 source alias sequence；旧模型引用可能映射到后续不同证据 | 同 generation 在 setter 前后记录相同内容、不同 URL，要求 source alias 不重复，并断言 Trip version 与 accepted base 不变 | 修复及定向绿测通过；最终冻结验收待运行 |
| D6-10 | 准备阶段按当前语言选取任一旧 accepted guide，而发布 CAS 将同 conversation/version 最新任一语言 accepted guide 视为当前基底，可能错误允许回退到旧版或在提交时无故冲突 | 同作用域新英/旧中组合不得把旧中文 guide 当编辑基底；新guide补齐中文 accepted后必须绑定新guide | 准备规则已实施，定向7/7通过；最终冻结验收待运行 |
| D6-08 | 隔离运行守卫以独占新建模式打开固定审计路径，冷重启沿用同目录时会触发 EEXIST，无法恢复服务 | 同一文件追加带 guard-session UUID/PID 的审计；安装、关闭、再次安装保留原字节及各次计数 | 已修复，受控 probe 9 项通过（零网络/模型）；真实 B11/B12 仍待完整验收 |
| D6-09 | 同查询键并发返回不同 OSM city identities 时，后写缓存可能丢失仍有效的身份；空且 unverified 的有效旧缓存也会压过随后 verified 的身份，更新时间字段往返还可能损失 PostgreSQL 微秒精度 | 独立 PostgreSQL 覆盖同身份并发、异身份合并、旧身份/verification/TTL 保留、相同 OSM ID、过期替换、空未验证缓存被有效身份补齐，以及双连接单 HTTP/单 lease/缓存命中不新增 lease；有效行只更新 `result_json` 保留数据库 TTL 原值 | `postgres.integration.test.ts` 红测复现旧 verification 覆盖新结果；修复后专用 PG 5/5 通过。真实免费Provider smoke另见本报告本批证据，不替代冻结验收 |
| D6-13 | Nominatim jsonv2 可返回 `category` 而没有旧 `class` 字段；city parser 只读 `class`，将真实市级 administrative city 拒绝为空未验证 | `class` 存在时优先使用它，仅在缺失时回退到 `category`；category-only 行政城市可解析，冲突字段不得降级，已有名称/国家/类型与多身份歧义规则保持 | 离线红测复现，最小修复后 places+city-resolver 23/23、backend check/build通过。真实Kyoto再请求HTTP200解析为 `osm:relation:357794`、JP、35.0115754/135.7681441；PG缓存复查零HTTP/无新增lease。原安全摘要合并字段不能单独证明其因果字段，但后续诊断记录精确显示 category-only |

续作：完成隔离PG复验、全量冻结回归及真实基线/完整页面旅程；这些迭代结果不能提前宣称通过。

### 第一批实现与保留失败

2026-10-06 新的原 B01 真实 H5 迭代首轮没有 accepted 攻略，后续动作按前置失败阻塞，没有盲发解释/编辑。页面登录/规划可见，提交到受理87ms、终态56779ms；15模型/5搜索均结算，费用回执仍未知。六个安全正文fetch提供有效当前证据。保留会话工具记录确认首commit及后一次修复都把IC卡资料的网页URL写入 `supportingRefs`，同时已通过 `supportingCandidateKeys` 选择相应practical候选；服务端正确拒绝URL，但将 `DSH_CANDIDATE_REFERENCE_UNAVAILABLE` 归为system且反馈没有字段纠正，模型未修正该字段。问题 D6-12：收敛DSH引用schema、说明和安全有界反馈，保留拒绝规则、不删掉错误字段；先加离线失败回归再修复。本次报告 `backend/.demo/dsh-d6-runtime/d6-iteration-b01/evidence/B01-2026-10-06T05-17-53-059Z.json` 与旧失败都保留，不是最终批次。

D6-12 首轮离线回归取得2失败/13通过：schema允许URL、引用不可用被归system。修复仅在DSH紧凑schema限定返回的candidate locator，明确 sourceRefs/candidateKey/supportingCandidateKeys 的关系，并由service提供受控字段路径；不可用引用按prerequisite计数，反馈说明正确字段和首次/已接受Goal区别，不转发URL或原始异常。不自动删除字段、不升级scope、不减弱任何原领域校验。现有官方fixture worker/no-op alias集成用例增加“URL误填→具体字段反馈→保留同份资料正确重提→只一份Goal/accepted攻略”验证，后续定向结果追加。

原始会话进一步确认7项new candidates的 `sourceRefs` 也全是URL，而不是已返回的UUID或 `s1.*` receipt；第二组离线红测2失败/15通过后，DSH source schema排除URL，仍保留既有短receipt和UUID兼容，领域证据层继续核验完整作用域、内容及状态。Zod字段反馈增加受控纠正提示，要求复用当前有效receipt、不重复研究；不猜测URL所对应的事实、不自动挑来源。第一组绿测曾因旧纯schema fixture使用非法 `gc1.example` 失败2/22；将fixture改成合法locator形状后，4文件/23项通过（含官方worker同材料纠正和Goal唯一性）。后续完整定向结果追加。

D6-12 追加完整定向5文件/28项通过（`output/d6/source-reference-green.log`），覆盖引用反馈、紧凑提交、官方worker服务、空patch alias和受控setter。真实B01复跑及最终冻结全批仍未通过。当前iteration服务已停止；该非TTY进程被终端Ctrl-C直接终止，实测原PID64332不存在且两端口关闭，但未执行finally、原锁文件和审计没有closing事件，原件保留。本次不作冷重启通过证据；最终同run重启需使用可验证的正常停止路径并核对身份/账本/guard追加。

2026-10-06 r7 工程回归：引用字段反馈与JSONv2修复后的后端全量133文件/1211项通过（185.28秒，`output/d6/backend-unit-r7.log`），真实专用PostgreSQL 11文件/51项通过（52.70秒，`output/d6/postgres-r7.log`），官方runtime14/14通过（9.42秒，`output/d6/runtime-r7.log`）。均为工程验证，不能替代最终H5批次。B01 r7报告 `backend/.demo/dsh-d6-runtime/d6-iteration-b01-r7/evidence/B01-2026-10-06T05-49-13-863Z.json` 在登录后进入规划页时输入框隐藏，全部旅程动作阻塞，model/search/fare零调用；单次零turn复现可正常进入，间歇导航问题仍在定位，不宣称根因或修复完成。原工作区仅保留用户两份配置修改，历史账本SHA256仍为 `3fdfdb12c1c3297c25548d54a53a2e4473f9f0d19c974f0f45a23afbd3d84126`。

r7追加：D5完整30/30且 `codeUnchanged=true`（[完整报告](evidence/d5-2026-10-06T06-06-07-970Z.json)），规划自动恢复后21/21，fixture P50 1584ms/P95 2583ms；不作真实页面性能结论。导航无初始ready门槛时10次有1次持续空白，两个带初始Plan/composer/nonshade条件的独立10次批次均可见、业务写零次；runner加入相同条件，仍不宣称快速启动导航的产品竞态已修。TTY服务r7在PID57288收到Ctrl+C后实测 `server.lock` 不存在、guard审计新增一条 `guards_closed`、原API/H5端口均关闭且PID退出；与之前非TTY失败不同，finally正常完成。由于后续源码变化，本run不作同版冷恢复证据，B11/B12仍须新冻结run沿用身份/账本/构建完整重启。

已实现准备快照、模型单项文字输入、绑定base/hash、同轮Goal省略、scoped C/source引用、单一已选城市补齐，以及发布短事务的基底条件。实际状态由本轮测试决定；协议见 [ADR0029](../../adr/0029-dsh-prepared-submission.md)。

service 级回归 `backend/src/agent/dsh/d6-controlled-update.test.ts` 使用官方 fixture worker，在同一用户请求中先以真实 `trip_context_update` intent 更新全程预算并得到 `satisfied`，再用真实 `travel_guide` intent 提交 compact 攻略。初始故障是在首个攻略提交的 alias/evidence 检查之前返回 `GOAL_INTENT_CONFLICT`：Trip update adapter 更新快照与 evidence scope 后仍保留已满足的 Goal binding。修复后，已确认 setter 保存其 delivery 并结束活动绑定，再按同一可信 scope/generation 和已确认准备版本派生独立尝试身份；后续攻略仍须提供真实 intent。回归 3/3 通过：独立 Goal/request identity 与 context version、旧 source alias 拒绝而新 alias 接受、缺 intent 拒绝、pending setter 不推进、日期冲突导致的失败 setter 不推进均有断言；不重贴 base id/hash/slot-edit字段，不调用付费 Provider。验证命令 `backend npm test -- src/agent/dsh/d6-controlled-update.test.ts`。

2026-10-06 D6-16 / B01 r8 类别越界修复：只读复核保留的 session、浏览器 evidence 与私有 execution log，确认首次 `commit_travel_guide` 的 Goal 仅允许 `activity`、`seasonal`、`practical`，但候选列表包含 `event`。`convertCandidatesToResearch` 原以普通 `Error` 拒绝该类别，service 因而误报 `DSH_TOOL_FAILURE`；后续提交也失败。提交适配层现在在证据转换前按已接受 Goal 校验类别范围，返回受控原因和字段位置。修复层将该错误作为参数纠正，不消耗内容修订额度；反馈只列允许类别与受控位置，不泄露候选键、被拒值或来源正文，也不自动改类、删项或扩大 Goal。定向红测曾以1失败/34通过确认旧行为，绿测 `npm test -- src/agent/dsh/commit-guide.test.ts src/agent/dsh/commit-recovery.test.ts` 为2文件/44项通过；`npm run check` 通过。日志分别为 `output/d6/d6-16-category-red.log`、`output/d6/d6-16-category-green.log`、`output/d6/d6-16-check.log`。恢复后显式修正候选的覆盖验证同一 Goal 被接受并仅创建一份研究 Artifact。未重试真实模型、搜索或票价调用；原 session、数据库、evidence 未修改。此为定向工程修复，不代表 B01 重跑、冻结 12+4 H5 或最终 D6 验收通过。

| 检查/尝试 | 实际结果 | 处理 |
| --- | --- | --- |
| 首次 Vitest | esbuild spawn EPERM，未执行案例 | 允许已授权本地测试子进程后重跑，未降低测试 |
| 第一领域批57 | 54通过/3失败：旧description断言强制EVERY提交 | 更新协议断言，Goal修复本身已通过 |
| 第二批90 | 81通过/9失败：runtime依赖缺失4、准备测试fixture3、错误分类2 | D6目录按原lockfile离线安装runtime；修fixture及分类；保留原失败 |
| 第三批57 | 55通过/2失败：准备fixture缺checkedAt、旧service anyOf断言 | 补合法fixture；验证新schema无需内部base/hash/goalRef |
| TypeScript初批 | 可选字段exactOptionalPropertyTypes错误 | 修可选条件赋值/预算null；继续复验 |

2026-10-06 D6-14 Trip update Goal 字段围栏：可写字段由 repository 校验后的 Goal 参数绑定到当前 Goal/run/context version；lean wrapper 复用已验证 Goal，不增加 setter 侧 Goal 查询。legacy `declare_goal`/`resume_goal` 的实际 owner/Trip/current-generation run 激活路径也建立同一 scope，保持其合法 setter 兼容；仅 active Goal 字段伪造、无绑定或身份不匹配仍失败关闭，Trip 激活后换版本也拒绝旧 scope。超范围 patch 在 Trip 写入/回执前以受控 `GOAL_FIELD_SCOPE_MISMATCH` 拒绝；空 patch 不写，显式 null/空数组仍可作为清除操作。DSH setter推进到新准备版本、cancel/route-generation 替换 active Goal 或 run 真正结束时清理 scope；`finish_goal` 对仍 running 的 pending/partial run 保留scope，让当前目标可继续修复。唯一的内部 scope 不进入公开 completion。

修前红测为本轮新增的 legacy declare/resume 正例：`npm test -- src/agent/tools/core.test.ts` 2 failed/14 passed（拒绝发生在现有字段围栏，日志 `output/d6/d6-14-legacy-red.log`）。上一轮原始超范围patch缺陷的红测据交接记录曾运行，但本工作树没有其原始输出日志，不能由本轮兼容性红测代替。初次字段围栏批次与最终55项记录见前述日志。新增 pending retry 回归：legacy Goal fields=`budget,notes`，尚无写入时 `finish_goal` 返回 verification pending 且 Run 仍 running，随后 budget setter 成功；`backend npm test -- src/agent/tools/core.test.ts` 17/17，日志 `output/d6/d6-14-finish-scope-green.log`；后续 `backend npm run check` 通过，日志 `output/d6/d6-14-finish-scope-check.log`。未运行 build、全量、真实 PostgreSQL 或最终 H5，因此不代表冻结验收通过。

上述为迭代检查，不是冻结最终全量。初始页面基线尚不可运行：已有独立PG端口58789不监听；Docker只读查询无返回；正在准备隔离替代数据库，不以普通环境问题停工。旧账本984条、1 pending保持不变；新D6授权账本独立并记录历史指纹，不清空/沿用旧权限。

### 隔离数据库与第二批全量迭代

使用官方 PostgreSQL 16.4 Windows binaries，在忽略目录 `backend/.demo/d6-postgres/data` 初始化全新数据库，只监听 `127.0.0.1:58896`，库名 `flightor_d6_validation`。没有创建系统服务、修改旧58789数据或重启Docker。

| 检查 | 实际结果 | 后续 |
| --- | --- | --- |
| backend check/build/test | check/build通过；130文件、1179测试全部通过，190.65秒 | 后续修改使其成为迭代证据，最终完整重跑 |
| DSH runtime | 14/14通过 | 最终版本再核对 |
| 前端session/artifacts | 20项、25项及8项本地化断言通过 | 同最终版本复验 |
| 前端production-presentation | 第9项失败：生产分支缺重新规划按钮 | 补生产按钮，并模拟父组件真实同步busy状态后复验 |
| public error helper | 34项通过 | 已接入conversation-progress |
| test:db第一轮 | 8/10文件、44/46测试通过 | D6 fixture误传Trip record而非context、重复关闭pool；旧DSH局改真实拒绝，继续修复 |
| D5第一轮 | 30/30案例成功，codeUnchanged=false，整批退出1 | 新脚本/测试并行改动使指纹失效；保留 [首轮报告](evidence/d5-2026-10-06T03-19-41-594Z.json)，稳定后全30重跑 |
| 固定材料回放 | baseline/D6各10/10接受；零新增模型/外部请求；trips.get 20→18；组装total P50 11.855→12.027ms | 内存回放基本持平，不宣称真实用户提速；完整样本见证据/地点行为文档 |

真实PG发现 D6-04：`saveFinalVariant` 的事务内原始 Artifact 行保留内部 conversation_id，而基底查询返回公开 conversationId，作用域比较错误拒绝合法局改。修复在既有 Trip 锁查询中同时取得 owner-scoped conversation public ID，不增加数据库往返、不放宽CAS；原真实DSH多轮PG回归负责验证。发布竞争、Trip/flight冲突仍需全套真实PG通过。

修复身份映射后的原DSH PG第二轮，局部编辑已成功，随后暴露历史测试断言仍要求预算更新后只有两份攻略。现有预算限定派生合同本来会保留两份旧稿并新增一份当前版本攻略；改为严格断言3份、当前1200全程预算、所有活动内容与时段继承（只允许source Artifact映射）、accepted英文，以及两份旧稿原样保留。不修改预算派生实现或放宽跨版本来源规则，继续复验余下恢复断言。

原DSH PG第三轮1/1通过（9.64秒），完整发布→只读解释→局改→预算派生→冷会话恢复→旧版本隔离通过。前端第二轮session/artifacts/production-presentation/types通过，conversation-progress在取消失败显示断言失败：组件改用 `PlannerReply` 渲染安全错误，而离线stub只读children，漏掉content属性。补stub的公开文本投影后继续跑完整复合命令，原“未确认停止仍busy、不能显示已停止”断言保留。

conversation-progress第三轮通过取消及发布检查后，在聊天错误文本检查遇到相同stub投影缺口；`nodes` 已执行函数子组件，`text` 却未执行。补齐文本遍历以观察实际stub子组件输出，保留错误可读、历史顺序、停止和新旅行原断言，不放宽产品检查。

新增 D6-05 已有官方 fixture worker 离线红绿证据：显式 Trip setter 带语义 intent 且持久 `satisfied` 后，独立 `travel_guide` Goal 会推进；只清绑定会撞同 generation 请求幂等键，因此实现绑定可信 scope/generation 与已确认准备版本。费用、会话与原 Goal 保留，旧 evidence、候选 alias 和 base 继续失效；失败/pending setter 不推进。`d6-controlled-update.test.ts` 3/3、`service.test.ts` 6/6、`public-errors.test.ts` 14/14 通过，`backend npm run check` 通过；浏览器/真实 Provider 与更广真实 PostgreSQL 发布竞争复验仍未由这些定向检查证明。前端 `node scripts/test-public-planner-errors.cjs` 的 40 项检查通过。首次沙箱运行 Vitest 遇 esbuild `spawn EPERM` 未启动；获准本地测试子进程后测试原样重跑通过。

2026-10-06 D6-06：冻结适配协议后发现 `safeCommitFeedback` 仍要求缺意图与参数纠正重复“同一accepted intent”，首次并未存在accepted Goal。红测1失败/5通过确认这一说明冲突；修复只收敛DSH反馈，首次要求真实新intent，已有Goal的修复省略重复字段且保持不可变约束。schema、persona、snapshot同时说明已满足且推进版本的显式setter边界，legacy合同不变。

D6-06定向修复后，commit反馈与受控setter批次2文件/9项通过（`output/d6/controlled-update-green.log`），包括旧alias拒绝、新Goal身份、新版本资料提交，以及pending/failed setter不推进。完整真实隔离PostgreSQL第二轮10文件/46项通过（harness记录），仍是迭代证据；未知城市实现及后续冻结变更需要最终完整重跑。

2026-10-06 D6-07 离线红绿测 `backend/src/agent/dsh/d6-noop-alias.test.ts` 使用官方 fixture worker：同一 generation 先搜索来源A，再执行空 patch setter（`changed: false`, `completion: pending`），随后搜索同文本的来源B。红测确认两个 source alias 均为 `s1.eae144b183.1e8e6fab48.1`，尽管 URL 分别为 `https://example.test/source-a` 与 `https://example.test/source-b`，因此空 patch 重置 alias sequence 会让旧引用静默指向另一证据。修复后仅在 Trip context version 前进时刷新准备快照、引用和 evidence store；空 patch 保持当前 generation 的引用映射。回归断言 alias 不重复、`changed: false`、pending delivery、Trip version 不变和既有攻略/研究Artifact仍可读取。合并运行 `d6-noop-alias.test.ts`、`d6-controlled-update.test.ts`、`service.test.ts` 共3文件/10项通过。未调用付费 Provider。首次沙箱运行受 esbuild `spawn EPERM` 阻止；获准启动测试子进程后先取得红测、再以相同命令取得绿测。冻结完整回归仍待运行。

2026-10-06 D6-10 只读审查发现准备与写入CAS对“当前accepted攻略”的定义不一致：准备挑选当前locale accepted攻略，CAS则要求它仍是任意locale accepted攻略中最新者。源码构造的复现为同Trip/conversation/version/flight scope下旧攻略仅中文accepted、新攻略仅英文accepted：旧准备会回退绑定旧中文攻略，而CAS最终以更新英文攻略为最新基底并拒绝提交。为防止旧中文攻略覆盖更新的英文accepted基底，准备先锁定同scope最新的任一locale accepted攻略；若它缺少请求locale，不回退到更旧攻略，应阻止slot edit并要求当前版本先获得该locale。`preparation.test.ts` 定向7/7通过，覆盖倒序记录、不回退、较新攻略补齐中文后绑定它，以及生成期间新英文accepted攻略出现时CAS仍拒绝旧中文基底。该测试在准备逻辑修改同步到工作树后才执行，未取得修改前红测结果；问题依据源码路径复现记录。未执行真实发布或PostgreSQL写入，冻结完整回归待运行。

### r6 收敛后的工程回归与当前页面问题

2026-10-06 12:52 Asia/Shanghai 开始的后端全量回归：133文件/1206项全部通过，188.11秒（`output/d6/backend-unit-r6.log`）；完整真实隔离PostgreSQL：11文件/51项全部通过，49.92秒（`output/d6/postgres-r6.log`）。backend check/build均通过，独立官方DSH runtime 14/14通过（`runtime-r6.log`）；正式weapp构建通过（`weapp-build-r5.log`），不代表微信平台验收。此前完整PG49/50的TTL微秒丢失失败保留在私有harness日志，精确TTL断言没有放宽，已由D6-09只更新结果列修复。

当前D6真实页面迭代 `backend/.demo/dsh-d6-runtime/d6-iteration-b01` 已完成可见本地登录，但点击规划后页面只有tab bar，composer仍隐藏30秒；首次自然消息尚未发送，账本0条，没有accepted成果。失败JSON及截图保留为 `B01-2026-10-06T04-56-37-537Z`。正在定位正常导航/恢复问题，不能把它当作供应商失败或PASS。私有B01动作副本只增加可见成果前置断言，原自然输入及动作顺序未改；无攻略时后续解释/局改被标记依赖阻塞，而非继续盲发模型请求。

上述结果是当前工程里程碑，不是最终冻结验收；最终12固定+4探索仍全部待完成。后续产品修改应按影响验证，并使最终批次完整重跑。

2026-10-06 D6-11 发现缺少当前locale accepted基底时会返回 `DSH_GUIDE_BASE_UNAVAILABLE`，此前按 `context_conflict` 文案告知用户“行程或航班处理期间变化”。后端保留既有8类分类，通过可选白名单 cause code 将该情况改为准确的双语局部修改提示；服务层仅保存受控分类输入，Provider终态仍优先。`public-errors.test.ts`、`service.test.ts`、`preparation.test.ts` 合计3文件/29项通过，service离线回归确认最新无当前locale基底时显示指定提示且不含内部码/异常细节。整个D6冻结回归仍待运行。

### 微信平台准备实测（不阻止其余工作）

2026-10-06 r6 完整 D5 回归已结束：30/30，`codeUnchanged: true`，21个规划场景首次完成率9/21、自动恢复后21/21；Provider retry 6、schema repair 3、semantic repair 6。P50终态1503ms、P95 2546ms仅描述本地HTTP/持久票价fixture批次，不是用户页面或真实Provider性能。完整脱敏报告见 [r6 D5](evidence/d5-2026-10-06T05-03-34-922Z.json)。此前源码变化导致无效的首批报告继续保留；后续产品变更需要最终版本完整回归。

同次固定材料回放再次获得baseline/D6各10/10 accepted及逐样本语义一致，零模型/外部调用；baseline total P50 10.395ms，D6 adapter P50 0.394ms、total P50 9.933ms。全部逐样本及指纹保留于忽略目录 `backend/.demo/d6-fixed-replay/fixed-replay-2026-10-06T05-10-41.010Z.json`。仅验证适配/domain内存开销未见明显退化，不作为真实页面提速结论，最终源码/构建冻结后复测。

2026-10-06 继续审查的 r5 迭代：backend check/build 均通过（`output/d6/backend-check-r5.log`、`backend-build-r5.log`）；前端 session-recovery、artifacts、production-presentation、conversation-progress 全部 exit 0（同目录 `session-r5.log`、`artifacts-r5.log`、`presentation-r5.log`、`conversation-r5.log`）。来源空 patch 回归、受控 setter 与 service 共 3 文件/10 项通过。D6-08 guard probe 9 项通过，原审计前缀保留、两次安装分配不同 session UUID，关闭计数为受控负面 probe 的 4 与第二次 0；不计入真实批次零违规证据。上述仍为迭代证据，城市缓存修复和完整页面批次待完成。

2026-10-06 已发现 `C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat`。官方CLI `--help` 可运行；`islogin` 首次沙箱不能写IDE自己的连接文件，允许本地CLI后复验明确返回“IDE service port disabled / 工具的服务端口已关闭”，未取得登录状态或9432自动化连接。开启属于IDE安全设置变更，已向用户单独请求本轮许可；许可未到不执行开启。H5、代码与数据库测试继续，不能以weapp构建或mock代替实际平台运行。

2026-10-06 用户明确回复“暂时不用验收微信小程序内的内容，先验证H5”。本轮平台验收范围调整为H5；原v1微信条件和CLI关闭实测保留，微信页面不执行、不宣布PASS，也不开服务端口。A八类、PG、D5分母30、H5固定12+探索4与内容/恢复标准不变，weapp构建只列工程验证。此为用户范围指令，不是因测试失败降低H5标准。

2026-10-06 B01 官方 web_search evidence 合同只读核查：5次搜索均成功，但5个 `__record_web` 回执均为空。私有 evidence 目录36行中，30条搜索来源为29 `no_body`（安全 URL、无 snippet）和1 `invalid_url`（非 HTTP(S) 地址）；其余6条来自web_fetch，均为 `available/fetched_body` 并返回 refs。锁定 DSH 工具将官方结构化 sources 保留在 canonical `value.sources`，运行时已将该值传给记录器；DeepSeek 官方 provider 可在缺少 text citation 时返回 URL/title 而没有 snippet。零搜索 refs 符合“无可引用正文不成为证据”的合同，不是当前B01未接纳的根因修复或验收通过；需按证据/地点文档所述尽早fetch正文、被阻则换来源。运行材料仍只保留在私有 `backend/.demo/dsh-d6-runtime/d6-iteration-b01`，未复制或提交原始记录。

2026-10-06 r11 header-back failure diagnosis and bounded recheck: the original H5 journey opened accepted guide `01a1105d-3228-751e-8832-c1c9963ac327`, then timed out in `clickPublishedHeaderBack` before later actions. On the same guide through visible Profile login and My Trips, DOM evidence records CSS host count 1, exact role count 0, header-scoped role count 0, and `.and()` intersection count 0. The host is `<taro-button-core aria-label="返回">` with no explicit role; the selector failure is in the runner's role-based intersection, not product back behavior. The runner now filters visible CSS candidates and intersects them with exact `[aria-label]` selectors for header and generic label actions. `node --check` passed, and the actual helper loaded from the changed runner source successfully navigated days → overview → the visible My Trips card on the same accepted guide. The navigation emitted the expected local-login POST and no agent-turn POST; all subsequent trip/workspace/artifact/media/places requests were GET-only. The saved-conversation route showed no visible `.pl-result`, so the separate Planner destination wait remains unverified. Original r11 report and timeout are preserved as failed; this recheck is not a frozen-journey PASS. Private DOM JSON and 390×844 screenshots are retained under `backend/.demo/d6/` and `backend/.demo/dsh-d6-runtime/d6-iteration-b01-r11/private/`.

2026-10-06 r11 saved-conversation return follow-up supersedes the preceding “Planner destination wait remains unverified” observation: visible My Trips navigation selected conversation `01a1105c-42a3-71c8-9c0b-c5d1992247e1`; its conversation-scoped workspace GET returned HTTP 200 with two messages and the accepted guide ref `01a1105d-3228-751e-8832-c1c9963ac327`. Once settled, Planner showed the restored assistant reply and exactly one visible `.pl-result`; returning from that guide ended at `#/pages/plan/index` with `.ux-published:visible` hidden. A second runner-source diagnostic exercised generic click `waitFor` with both the hidden published route and visible result requirements. Only visible local login used POST; no agent-turn/business POST occurred, and the r11 D6 ledger hash stayed `59f00752eed459a72acc7ba0867d923ae59da974f8429982f3bf1ce2105c62ed`. Private settled-state evidence is `backend/.demo/d6/r11-planner-return-settled.json`; generic-click report and screenshots are under `backend/.demo/d6/r11-generic-click-wait/`. This is bounded read-only recovery/runner evidence, not a frozen B11 journey pass; the original r11 timeout remains failed.

### D6-20：Artifact 恢复公开错误边界

已复现的 r11 现象为：390×844 H5 恢复原 saved conversation 时，迟到 Artifact GET 先显示“本次规划未完成 / Artifact request was superseded”，约700ms后恢复原 accepted 卡片。根因为 `ArtifactService.acceptResponse` 以普通 `Error` 报告同 key 请求已被取代，Plan 与 Route 读取 effect 又把异常 `message` 直接写入页面；这既误报规划失败，也暴露内部文字。修复为受控 `ArtifactRequestSupersededError`。Plan 忽略此回调；仍 active 的 Route 使用固定 `ui_restore` 提示和刷新入口，终止无错误的加载态。对其他仍有效的未知读取异常只显示固定双语恢复说明；scope、generation 和 session 围栏保持有效，真实读取失败仍可见。

红测先在未修复 service 上因缺少受控错误类型而失败（`scripts/test-artifacts.js` 对 `ArtifactRequestSupersededError` 的身份断言触发 TypeError）；修后 `node scripts/test-artifacts.js` 为29/29，`npm run test:artifacts` 的附加 finalization-client 检查8项通过。`node scripts/test-public-planner-errors.cjs` 增补恢复文案/抢占类型断言后共44项通过。实际 PlanPage hook 回归17项覆盖双语敏感读取失败与当前 scope 的 superseded 忽略；RoutePage hook 将旧消费者被另一 GET 取代的情形复现为无错误永久 loading，修后验证其结束 loading、显示固定提示及刷新动作，同时真实未知读取失败不泄露敏感正文；原媒体 owner/session/Trip/generation/content-version 迟到检查仍通过。生产 ArtifactService 两个并发 GET 验证旧请求变为superseded。所有本地日志仅写入忽略目录 `output/d6/`；没有 Provider、数据库业务写或密钥读取。H5回归由主任务后续复验，以上离线验证不构成 H5 恢复或整套 D6 验收通过。
