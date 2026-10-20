## 2026-10-20 0.13.2 刷新导航恢复

补齐ERR_ABORTED、another navigation、execution context destroyed等手动刷新异常的读取重试。发送前定位被导航打断、且记录仍为draft时保留同一草稿等待下一周期，最多2次；已提交/不明结果绝不自动重发。

扩展personal-browser测试：监听中真实刷新工作台，断言后端running及sessionId不变；夹具注入一次导航中断，再继续读取并仅发送一次。真实抖音刷新现场未重新发送验证。

## 2026-10-20 0.13.1 读取超时暂停修复

真实日志定位：10:40:34评论按钮因元素不稳定点击超时导致暂停；10:36另有已提交回复未检测到回显而uncertain，模型已成功生成。不能把结果不明当作发送失败。

修复：评论入口稳定等待从5秒增至12秒；仅刷新/读取阶段临时超时重试最多2次，间隔至少10秒，连续3次失败暂停。登录、验证码、定位歧义和模型/发送异常不走读取重试。发送不明补充lastError与暂停原因，不自动重发。新增read-retry.js及单元测试，夹具注入一次reload超时验证恢复。真实浏览器页面和不明回复未重新提交。

## 2026-10-20 0.13.0 可靠性与历史性能

- 审核绑定作品/评论/草稿/资料hash；改动后重新审核，旧布尔审核标记无效。个人及官方批量审核共用校验；官方队列遇到旧/变化版本回待审。
- 追问仅沿parentRecordId直接链读取上下文，其他参与者转人工；优先使用字符串账号ID，缺失时昵称匹配仍有同名限制。轮数保持同一级评论共用，未改变限额语义。
- 缺失回复关系进入pending_relation，后续扫描只读重查，最多12次后转人工；新监听会跳过旧待查任务。
- 维护执行前持久化nextAt，重启/失败均不重置每日间隔；界面展示下一次最早时间。
- 状态响应最近200条并提供总数，完整历史分页；评论只写入变化记录，模型日期和作品分页索引；对话分组去除重复全表扫描，展示最多100对话。后台仍持有全量记录，不是完整数据库任务化改造。
- 新增4项边界测试，共89单元通过；service/personal/personal-browser/official-flow/operations回归通过。三万条合成历史：单条修改仅2行写入（app_state+comment），约16ms；50次200条分页约82ms；100个对话分组约23ms。机器相关指标，不代表真实平台吞吐或长期稳定性。报告release/qa-history-performance.json不纳入Git。

未真实抖音联调，未打包。后续仍需生产条件及原验收清单其他待办。

## 2026-10-20 0.12.0 本机服务管理（不打包）

本轮实现并验证：启动检查与未保存设置拦截；按作品保存轮数；模型调用/已知Token预算；敏感关键词与积压转人工；先生成再审核，改稿清除审核标记；对话接管/关闭/恢复；结果不明单独人工确认；运行覆盖范围和错误提示；完整记录导出；先备份再清理过期明细；完整备份列表与新目录恢复；可选空闲时每日自动维护；按作品文本清除保留防重/轮数/用量；同一数据目录进程锁；本机管理审计。

源码新增 src/comments/service-controls.js、src/security/data-lock.js、src/ui/scripts/service.js；测试新增 service-controls.test.js（三项）及 npm run test:service。85项单元、service/personal/official/projects/diagnostics通过，真实平台仍未联调。详细边界见 docs/服务管理与验收说明.md。

不能称全部企业能力完成：多人身份权限、跨设备锁、独立告警、签名自动更新与回滚、浏览器多作品并行/全量分页、精确金额预算及媒体调用预算尚未完成；生产部署与真实平台验收需外部条件。当前为单机单用户自部署版本。未stage/dist、未推远程。

## 2026-10-19 楼中楼追问与轮数限制

- 个人浏览器模式被动解析页面产生的楼中楼响应，尝试展开最近20条已发送对话的回复；仅处理明确指向本程序已确认回复的新追问。回复关系不明确则跳过，不重放私有接口。
- 默认同一一级评论下累计3次回复（包含首次），UI可设置1～10；sent/sending/uncertain均计数，发送前再次核对上限，记录及轮数配置持久化。模型接收该对话此前已发送的上下文。官方模式不扩展。
- 82项单元测试、test:personal及扩展test:personal-browser通过；合成页面已验证首次+两次追问发送，第四次停止、携带两轮历史及错误配置拒绝。真实抖音楼中楼DOM/字段尚未联调，不保证所有页面版本、分页和高评论量覆盖。服务重启不自动监听。

## 2026-10-19 用户交互整理

- 个人入口改为自动回复工作台，按作品资料、账号登录、启动回复分三步；必填/选填标签、未完成事项提示、模型配置快捷入口。
- 手动导入复制移入备用折叠区，检查频率和手动读取归入高级设置；桌面双列和窄屏单列，避免左侧空白。保留原操作ID与接口。
- test:personal和test:official通过；手动流程测试已适配折叠入口。真实平台发送能力未新增验证。不打包。

后端更新结果：备份 data/backups/CommentPilot-1792394947491.sqlite，PID57392，健康检查0.11.0。已启用personal-browser，监听暂停、浏览器关闭；保留4条当前评论和1个模型连接，现有autoSend=true。当前连接keyConfigured=false，必须配置有效Key或本地模型后才能真实测试。

## 最新实现：0.11.0 个人浏览器自动回复（不打包）

用户明确要求自动回复、不要复制粘贴。本版新增 personalBrowserEnabled 持久化开关和 personal-browser transport，不依赖 APP_BROWSER_FIXTURE。readiness.js 检查登录/验证码；personal-browser.js 提供启用、昵称/限额/自动发送、打开浏览器、本人作品确认、读取与启停。单作品运行，重新绑定必须新起点；发送核对原评论及新增回复，结果不明暂停。不能自动证明账号归属，真实页面尚未校准。

验证：79项单元、test:personal、test:browser、test:official、test:personal-browser 全通过。后者显式测试预加载只在合成页面运行，验证新评论经模型生成和DOM发送、旧/本人评论跳过、验证码暂停及重启不重发，不能称真实抖音联调。详见 docs/个人浏览器自动回复说明.md。旧0.10章节是手动分支历史说明。未执行stage/dist。

# CommentPilot 开发交接记录

## 最新实现：0.10.0 个人辅助回复（不打包）

用户确认只有个人抖音账号，没有任何开放平台授权，并要求完成个人模式。本轮实现辅助回复，不能宣传自动读取/发布。

- `src/comments/personal.js`：导入解析（1～200条，TXT/TSV每行或JSON rows），按作品+外部ID或昵称正文去重，来源manual-import且commentId为null，防止与官方ID唯一索引混淆；跨作品个人记录校验；copied只记复制，manual_published为用户确认而非sent，保存文字快照、copyCount、最近50事件。
- `personal-work` 保存已有数字作品ID完整URL、资料/模型/KB并选择，无官方网络；`personal-import/generate/edit/copied/published` 有本地互斥、逐记录保护、生成最多20条、发布需confirmed:true。原send接口拒绝manual-import，官方基线/读取不改写手动记录。复用现有draft模型与资料约束，无事实不调用模型。
- `src/ui/scripts/personal.js`独立导航/页面：无需官方账号配置；模型/资料保存、批量导入、生成编辑、一键复制、人工确认、筛选、历史查看。保存个人作品或点击个人入口会持久化assistantMode=personal，刷新/重启默认打开；官方模式仍保留。隐藏官方连接面板，不诱导扫码。未保存作品不允许导入/生成，剪贴板失败不记成功，编辑保留，人工确认后锁定文本。
- `tests/unit/personal.test.js`4项；`test:personal`隔离数据、本地HTTP模型、浏览器内剪贴板替身完整验证，无官方授权、缺资料拒绝、去重、编辑复制、人工发布不同状态、API发送拒绝、作品隔离和重启保留。79项单元全通过，projects/official/diagnostics回归通过。云模型和真实抖音未测试，个人模式本来就不发送抖音请求。
- README/CHANGELOG/`docs/个人辅助回复说明.md`、未来发布清单与版本0.10.0更新；不执行stage/dist、不推远程。客户目前还需要配置可用模型Key或本机模型，作品链接只是归档标识，不会抓取正文。无ID同昵称同正文可能误合并，已说明。
- 后端在暂停/无活动任务状态下备份 `data/backups/CommentPilot-1792394303846.sqlite` 后重启PID26864，健康检查0.10.0，已通过personal-mode保存默认入口personal。原1模型连接、当前4评论保留，personal.js HTTP200，监听暂停。当前选中模型keyConfigured=false，用户需在模型连接中配置Key或可用本机模型；未替用户写入模拟评论或发起付费模型请求。代码提交本地Git，未推远程。


## 最新实现：0.9.0 本轮集中完善（不打包）

用户要求把上一轮待办一次性处理。用户已明确回复抖音应用“尚未申请或仍在审批”，因此真实权限/账号读写、事件订阅、生产域名部署均不可标为实测完成。其余本地源码已集中实现，不要求逐项确认，不执行stage/dist。

- 三条独立WorkScheduler流水线：扫描、模型、发送。云模型并发1～4（默认2，可UI保存），本地Ollama/LMStudio/vLLM相同baseUrl串行；模型不再占用扫描busy锁。按stage领取任务，单作品单阶段不重入。发送串行至少3秒，DouyinOfficial按app共用请求起始门控（DOUYIN_MIN_REQUEST_MS默认250ms，50～10000）；真实额度仍须应用获批后配置。保留原有全量评论保存方式，本轮未实施部分历史写入优化。
- `src/douyin/accounts.js`独立账号槽位，`douyin_accounts`加密令牌新表，默认槽兼容legacy；刷新单次合并。作品绑定accountSlot，runtime持有对应client，核验按监控账号找client；切换授权账号清空当前作品，避免显示旧账号目标。一个作品的同一会话不跨账号恢复。
- `src/comments/operations.js`：可配最长等待、积压阈值、暂停生成，转review不删除；批量1～100任务approve/regenerate/reject，当前会话、禁止verify/submission任务批准重发，显式批准草稿可在autoSend=false时继续监听发送。重新生成重置等待起点。评论/模型统计与网页本机通知。
- `src/knowledge/retrieval.js`按中文双字/英文词检索6段，知识库最多30万字符；完整资料hash与查询无关，refs含片段id/start/text。`import.js`/`import-worker.js`独立Worker（30秒/256MB）解析20MB TXT/MD/DOCX/PDF文本，PDF最多200页；fflate+saxes只解DOCX正文，禁DOCTYPE，PDF禁eval。扫描PDF/旧DOC未支持。新增生产依赖fflate/saxes/pdfjs-dist，生产审计0漏洞。
- OCR accurate模式增加增强稀疏文字候选；修复总是偏选Windows结果的策略，保留agreement/needsReview。合成中文样本CER由约10.8%降至2.7%，报告 `release/qa-ocr-1792390824838/report.json`，仅37字符左右合成样本，不代表真实作品/长视频准确率。媒体默认仍待核对。原真实英文OCR集成与隐藏桌面OCR/DPAPI通过。
- `src/storage/full-backup.js`：SQLite+media+SHA256清单、integrity_check、拒绝符号链接/越界/未知文件；restore-backup工具只新建目录，拒绝覆盖；DPAPI不能跨用户/机器解密。服务端vault需另外备份。
- `src/broker/server.js`独立部署服务：设备bearer隔离、一次性OAuth state、AES-256-GCM令牌存储、受限官方API代理、不返回Secret/令牌。`remote.js`客户端，`broker-settings.js`DPAPI保存设备凭证，UI填HTTPS域名及凭证后重启生效；无Broker时继续本地开发官方模式。`scripts/dev/configure-broker.mjs`只生成忽略的配置且拒覆盖，未执行；Nginx示例和部署文档已写，未实际部署HTTPS。
- Webhook按官方SHA1(secret+原始body)常量时间验签、challenge、Msg-Id去重，保存7天有限元数据；客户端事件游标持久化，事件只唤醒有界官方扫描，不直接入回复队列。本次公开事件目录未确认可用于当前场景的通用新评论事件，不能宣称权限可用或零漏读。
- 新UI `operations.js`：账号/授权服务设置、统计、批量审核、完整备份、并发、作品积压策略、PDF/Word导入、高精度OCR。历史JSON可查看references片段。
- 验证：75项单元；test:operations完整模拟批准发送/备份/导入/统计/账号UI，test:broker模拟设备隔离/一次性回调/服务端加密且不返令牌，test:multiwork 15秒慢模型期间扫描继续及其他作品推进；official-flow、incremental、projects、official、ui、diagnostics、media、desktop回归通过。修复official-flow/multiwork/incremental/diagnostics清理定时器捕获全局child导致误杀后续进程的测试问题。所有平台/云模型请求均为夹具。
- 文档 `docs/功能完善与验收清单.md` 为当前完成/外部待办总表；`docs/正式授权服务部署.md` 为部署步骤。README/CHANGELOG和未来发布清单更新，服务端源码不进入客户端发布清单。本轮不打包、不推远程。同账号多设备并行回复尚无跨设备去重，建议单主设备。
- 最终后端已在暂停/无活动任务状态下备份并重启，PID4900，健康检查0.9.0；`data/backups/CommentPilot-1792391733280.sqlite` 为最后切换前备份，前一份 `CommentPilot-1792391651678.sqlite`。running/anyMonitoring/busy均false，原1模型连接和当前4评论保留，默认1账号槽位，模型并发2；真实统计接口成功、operations.js HTTP200，官方仍未配置/授权。源代码与文档保存在本地Git，不推远程。


## 最新实现：0.8.0 多作品公平监听（不打包）

用户要求继续上一轮的多作品、高评论量处理方案。本轮已实现同一官方账号多个作品后台运行，仍不打包、不上传远程。

- `src/comments/scheduler.js`：按作品轮流调度，单个作品每轮最多3页和2个任务步骤。模型/发送并发1，调度轮次间隔1秒，账号提交至少间隔3秒；每作品间隔从本轮结束计算，慢模型会延迟其他作品扫描，不是严格10秒实时保证。最多20作品。现阶段读取和生成未解耦、多账号未实现。
- `src/app/server.js`：`monitor-start {id,resume}` / `monitor-stop {id}` / `monitor-status`；`stop`暂停所有；每作品独立配置快照、会话、游标、Worker，draft/send/reconcile明确传入作品配置/ID，不切换全局config。配置修改/作品切换需全部暂停。停止能撤销尚未提交请求的guard，启动过程中停止不会稍后意外开监听。重启不自动发评论。
- 草稿生成按作品模型和知识库，发送按当前作品资料hash校验；每作品每日上限之外，账号每日总提交上限200（上海日期，sent/sending/uncertain计数）。官方429共用冷却。结果不明暂停该作品，仅按作品公平只读核验；重启后无需启动监听也可核验保存的不明提交，不会盲目POST。
- `src/ui/scripts/multiwork.js`：各作品启动新会话/继续/单独暂停/全部暂停，积压和最久等待，100条或5分钟提示。`projects.js`新增作品自动发送、间隔和日上限编辑；未指定模型时启动时快照绑定当前默认模型。队列没有自动过期或丢弃策略；持续高流量可能积压和漏读，不能宣称每条实时或零遗漏。
- 队列backlog SQL统计；诊断running包含多作品；重启脚本拒绝活动任务并先备份。未来发布源清单添加scheduler和UI但未运行stage/dist。
- 验证：67项单元通过；双作品模拟集成验证不同模型/KB不串、8:1负载公平回复、积压、暂停/重启继续不重复发；官方完整模拟发送/不明核验、1200历史增量、作品UI、官方UI回归通过。所有平台/云模型请求为隔离夹具，没有发送真实评论。
- 文档 `docs/多作品监听说明.md`、监听队列说明、README、CHANGELOG更新。真实官方应用当前仍未配置/授权，真实多作品权限和模型吞吐未联调，获批事件订阅、读取/生成流水线分离、可调并发仍属后续增强。此前旧记录中的“一次一作品”是0.7及之前的历史边界，已由本节更新。
- 后端已确认原监听暂停/无任务，重启脚本自动备份 `data/backups/CommentPilot-1792388952089.sqlite` 后启动 PID50052；健康检查0.8.0，running/anyMonitoring/busy均false，原1模型连接和当前4评论保留，multiwork.js HTTP200。源码提交本地Git，不推远程、不打包。


## 最新实现：0.7.0 持久队列、分批扫描、发送只读核验

用户要求执行上一轮建议的下一步，本轮已实现三项，继续不打包。

- `src/comments/queue.js` / worker.js / scanner.js / reconciliation.js：SQLite comment_tasks按账号/作品/会话/评论唯一，阶段generate/send/verify；保存尝试次数/nextAt，分类退避，尊重429冷却；生成最多3次尝试，发送前读取失败可重试，POST结果不明绝不重发。重启恢复生成，发送阶段先review或verify；新启动取消旧会话未发送任务，继续监听保留任务和起点。当前一作品单后端进程。
- 官方初始仅preview首页20条，避免全量历史基线阻塞；按since保守跳过后续历史。每轮最多3页（首页＋续扫），检查点与采集记录一起persist；不根据旧/置顶时间提前截止，不保证动态分页/持续高流量零漏读。旧于起点的尾页历史不全量落入评论记录。扫描暂时错误持久退避、连续5次暂停；reset-scan保留since与任务。
- 官方发送前先读取原评论回复ID、落盘submission（账号指纹、作品、评论、文本、时间、beforeIds、attemptId）。正常返回ID标记sent；异常保留uncertain暂停发送并建立verify。每10秒只处理到期核验任务；可暂停状态手动核验。严格匹配当前作者/正文/时间/新增ID，唯一匹配才确认并更新原attempt，不匹配最多自动3次后review。0.6旧uncertain缺snapshot不可自动确认。不能证明哪个客户端创建，只证明匹配回复存在。
- `src/ui/scripts/reliability.js`：工作台扫描与队列状态、只读核验、保留起点重置扫描、生成阻塞后重新安排。草稿review不因切换autosend自动补发。诊断报告增taskStates；新增test:incremental命令，未来发布清单更新但未执行stage/dist。
- 测试65项单元通过；test:incremental真实隔离进程模拟1200历史、首轮1页、每轮3页、重启游标续扫/首页复查、无历史入队和重置不改since；test:official-flow模拟超时后核验、原历史更新/重启保留，发送次数不增加；test:ui/projects/diagnostics/media/official/desktop回归通过。新增feature均未用真实平台或云模型联调，不宣称真实权限已通过。
- 文档 docs/监听队列与发送核验说明.md、CHANGELOG、README、架构/官方说明更新。已在暂停/无素材任务状态下备份 `data/backups/CommentPilot-1792382013233.sqlite`，重启PID29860；健康检查0.7.0、监听暂停，原1个模型连接/当前4条评论保留，队列可用且为空、新界面脚本HTTP200。变更保存在本地Git，不推送远程、不打包。真实应用权限、生产OAuth代理、媒体真实准确性和多作品同时监听等仍待后续。

## 最新实现：0.6.0 脱敏日志、操作追踪与诊断报告

用户在日志审查后要求继续完成改进。已实现而非仅出方案，仍不打包。

- `src/security/redaction.js`：已知凭据登记、字段与文本过滤，控制台封装；覆盖常见API Key/token、Authorization/Cookie、OAuth query、手机号/邮箱/身份证样式、本机路径。JSON解析失败不回显原始请求/响应片段。凭据保护/解密及官方令牌保存/加载/请求时登记secret。
- `src/observability/logger.js`：AsyncLocalStorage请求追踪、每轮monitor独立traceId、每进程sessionId，固定字段JSONL，大小2MB/3份备份，SQLite diagnostic_events，30天且每100写入定期收敛10000条（批次间可略多），日志故障只标healthy=false不重发业务。文件轮转是大小策略，不声称所有原始输出均30天删除。
- 请求开始/完成、耗时/HTTP/错误分类、评论读取与跳过统计、基线、模型调用/发送尝试和素材阶段写入。上游提供时记录数值HTTP/官方错误码，请求ID引用化。Storage.attempt业务历史增加traceId/operation；工作台消息过滤但保留本机workId以维持按作品显示。
- `src/observability/diagnostics.js`：只导出固定字段，不读旧日志文件、不导数据库；排除评论/回复/文案/知识库/提示词/模型响应/媒体/文件名/绝对路径/凭据。每次导出独立HMAC引用代号，可在同一报告内关联；按trace分组，附状态计数和非敏感连接协议、供应商/Key存在布尔值。原始错误、完整上游requestId不在报告中。
- API错误带traceId和errorCode，界面显示“排查编号”；设置页新增JSON下载（不是ZIP），导出500/1000/2000条，用户自行选择分享，不自动上传。新增 npm run test:diagnostics。
- 原业务表的正文和旧事件仍保留，不追溯改写旧数据。第三方直接stdout/stderr与旧backend.log不等同于白名单报告，不纳入导出；自然语言过滤无法保证任意文本全部隐私，诊断使用排除自由文本的额外边界。升级前/已过期/未到达后端点击无法完整还原。
- 57项单元测试通过；诊断集成测试验证隐私哨兵/非法JSON/错误编号/重启/浏览器下载/文件不含正文；test:ui、test:projects、test:media、test:official-flow、test:desktop回归通过。全部使用隔离数据与模型/平台夹具，没有发真实评论。
- 更新未来发布白名单、前端脚本核验与package版本0.6.0，没有执行stage/dist。文档见 docs/日志与诊断说明.md，CHANGELOG已记录。
- 已在暂停/无素材任务状态下备份 `data/backups/CommentPilot-1792378492901.sqlite`，重启PID32672；健康检查0.6.0，原1个模型连接/当前4条评论保留、监听暂停，诊断格式commentpilot-diagnostics-v1、loggingHealthy=true、privacyMode=allowlist。本轮提交保存本地Git，可通过日志查看；不向远程推送。

## 最新整理：源码按功能分层，本地 Git 回溯

用户要求整理根目录源码、按功能归档，并将代码和修改记录保存在本机，便于继续开发和回溯；继续遵守先完善功能、不打包。

- 已建立本地 Git 仓库，整理前基线提交 `73ab74a`，标签 `source-layout-before`；整理后检查点使用标签 `source-layout-after`。没有远程仓库，不上传。当前 PATH 的 git 命中失效的 depot_tools/git.bat，使用 `C:\Program Files\Git\bin\git.exe`。
- 51个源码/配置/测试文件迁移；原 `lib.js` 拆为 `src/works/identity.js`、`src/comments/identity.js`、`src/app/config.js`、`src/models/reply.js`。业务源码位于 src/app/comments/works/knowledge/models/storage/security/douyin/media/desktop/ui。不是只创建空目录，根目录旧源码已迁出。
- 测试集中 tests/unit、tests/integration、tests/fixtures；运维脚本位于 scripts/dev、scripts/verification、scripts/release；Electron Builder 配置在 config/。根目录保留 README、CHANGELOG、CONTINUATION、AGENTS 和 npm 配置等入口文档。
- 新 `src/app/paths.js` 统一根路径，运行数据仍在 G:\res\data，不迁移数据库或媒体。更新全部导入、静态服务路径、Electron入口、npm脚本、PowerShell根路径和未来发布白名单。npm start/desktop/test 等保留，新增 npm run restart、test:official、test:official-flow、test:desktop。
- 目录说明 `docs/architecture/目录与模块说明.md`，逐文件映射 `docs/architecture/source-migration.json`，功能变更 `CHANGELOG.md`；历史验收文档和本记录下方旧路径作为历史保留，不应再按旧路径执行。
- .gitignore 排除 data、依赖、release、环境密钥、数据库、日志等；.gitattributes 规范文本行尾。只提交本地源码/测试/配置/文档。
- 验证：53项单元测试、workbench/projects/media/official-ui/browser 全部集成通过；official-flow 完整模拟通过；隐藏 Electron 源码冒烟通过（官方模式、OCR、SQLite、DPAPI），没有访问用户账号或发评论。修正旧桌面冒烟错误要求官方模式也启动浏览器的断言。未执行 stage/dist 或安装包测试。

后端更新前已核对暂停且无素材任务，备份 `data/backups/CommentPilot-1792376377336.sqlite`；通过新命令 `npm run restart` 重启成功，PID 24872，入口 `src/app/server.js`，健康检查0.5.0、official模式、监听暂停，原1个模型连接和当前4条评论保留，页面与素材脚本HTTP200。整理后 Git 标签为 `source-layout-after`，具体提交可 `git log --oneline --decorate` 查询。没有执行打包。

功能待办保持下方0.5.0记录中的真实素材模型联调、官方资格与生产代理等，不把本次目录整理当成功能联调完成。

## 最新实现：0.5.0 文案与素材识别（本轮不打包）

用户要求完善作品文案及图片、动图、长视频识别，并明确先不要打包。已实现本地素材解析链路；**没有运行 stage/dist，没有生成新 EXE**。

- 新增独立“文案与素材”页：保存已核对完整文案；导入自己的图片/动图/视频/音频/SRT/VTT/TXT；异步进度、取消、逐段来源/时间/置信度、编辑核对、采用/停用，工作台和模型等页面不会常驻展开这个大面板。
- `media.js` + `media-context.js`：流式二进制上传、扩展名白名单、按作品存储、SHA256 去重；完整 ffmpeg-static/ffprobe-static 解码、动图帧/延时读取、视频定时抽帧、重复画面去重、内嵌文本字幕、16kHz单声道音轨每60秒分段；可选视觉模型（Chat/Responses/Ollama 图片输入）和 /audio/transcriptions 兼容服务，用户明确选择及允许素材发送后才调用。云端连接会上传所选素材；默认OCR不上传。素材模型调用写入 model_calls，不保存 Key 或二进制请求。
- SQLite 新表 media_assets/media_jobs，原文件在 data/media/<workId>；原始素材不包含在现有 SQLite 备份中，完整迁移需同时备份 media 目录。中间图片/音频正常结束、错误或取消后清理。取消中的OCR需等当前步骤完成；重启将 running 任务标记 interrupted，不自动恢复调用。
- 每作品20个文件、单个512MB、合计2GB；视频/音频单段最长2小时；默认60帧、最多120帧。视频按时长和总帧预算增大采样间隔，不是全帧或场景切换分析；图像字幕、瞬时文字可能漏。未选语音/视觉、低置信度/无结果均提示。OCR置信度不等于准确率；真实中文长视频尚未测准。
- 官方发布文案 `title` 字段与人工补全文案/媒体结果分开；同步官方文案保留已核对媒体和人工文案。仅 accepted 的识别结果进入 groundedContext；上下文hash包含核对内容，旧草稿变更后不可直接发。上传新素材/删除引用素材会停用旧结果，素材列表改变后需重新识别。按作品隔离，原评论监听启动时拒绝仍在解析的任务。
- `providers.js callModel` 增加可选 maxChars/signal，原短回复200字符限制保持；媒体描述允许更长输出并支持取消。`ocr.js` 增加循环取消检查。版本更新0.5.0。
- 53项单元测试通过（含真实FFmpeg合成视频/音轨/内嵌字幕、GIF抽帧、核对/作品隔离、请求适配、取消/中断）；`node test-media-ui.mjs` 真实英文图片OCR端到端、上传/核对/停用/切换/导航/移动端无横向溢出通过；`npm run test:projects` 和 `node test-official-flow.mjs` 隔离回归通过。媒体视觉/语音请求是模拟验证，未声称真实云模型已联调；没有向真实抖音发评论。npm audit --omit=dev：生产依赖0漏洞。
- 文档 README、docs/文案与素材识别说明.md、docs/官方接口接入说明.md 已更新。只修改未来打包源清单/ffmpeg二进制暂存规则，未执行打包。

后端更新前 running=false、busy=false、没有素材任务；已备份 `data/backups/CommentPilot-1792375627680.sqlite`，重启成功 PID 49588，地址 http://127.0.0.1:3210，0.5.0 源码，未启动评论监听或云端素材识别。

下一步：用用户原始中文图片/动图/长视频做准确性核验；配置真实视觉和语音模型联调；官方应用凭据、权限、回调仍待用户应用后台准备。生产 OAuth 代理、超大评论增量扫描、图文作品实际官方支持仍未完成。继续遵守“不打包，功能完成后再处理”。

## 最新实现：官方接口源码 0.4.0

用户已要求改成官方接口，并咨询自动识别个人/企业和长视频 OCR。当前源码默认走官方 OAuth / OpenAPI，浏览器读写操作在普通运行时禁用；仅 `APP_BROWSER_FIXTURE=1` 供旧隔离测试。不得把现存 0.3.0 安装包当成官方版。

- `douyin-official.js`：一次性 state、授权码换 token、自动刷新、DPAPI 加密令牌保存到 SQLite、普通 `item.comment` / 企业 `video.comment` 自动按获授 scope 路由。无需用户勾选账号类型；公开 userinfo 文档未给足可靠的角色枚举，因此身份保留 unknown，不假定个人/企业。小程序 ma.item.comment 未适配。
- 官方作品列表分页、按账号保存网页 ID 到官方 item_id 映射（兼容 iesdouyin share/video 链接）；官方加密评论 ID 独立去重。最多 50 页 × 20 条，超过/游标异常明确停止，不接受不完整历史基线。每轮全量读取，超大作品增量扫描待做。
- `server.js` 复用作品、模型、知识库、历史和监听队列。新账号必须新建基线；旧浏览器基线不可恢复。官方返回 reply ID 才标记 sent；超时/缺 ID 记 uncertain，暂停，不自动重试。结果不明自动查询核验待做。HTTP429 冷却，频率仍须按应用额度配置。
- `public/official.js` 提供官方授权、读作品、选择作品、清除本机授权。模型 Key 和抖音授权独立。管理员通过 DOUYIN_CLIENT_KEY / DOUYIN_CLIENT_SECRET / DOUYIN_REDIRECT_URI / DOUYIN_SCOPES 配置。默认 user_info,video.list,item.comment。官方回调可直接接入已批准的本机地址，或开发版从受控回调复制完整地址，校验 state 后交换。分发生产代理尚未实现，不可向其他安装用户下发共享 secret，Electron 随机端口回调也需代理交接。
- 官方内容目前只有标题，不声称已获取完整正文、图集原图、动图帧或长视频字幕/语音。官方模式不走浏览器 OCR 下载。媒体解析尚未实现，依赖已确认知识库；OCR 置信度不等于实际准确率，无法保证长视频准确。
- 文档 `docs/官方接口接入说明.md` 和 README 已更新。打包源清单/核验清单加入新文件，**未构建 0.4.0 安装包**。
- 验证：47 项单元测试通过；`node test-official.mjs` 官方默认后端/UI冒烟通过；`node test-official-flow.mjs` 在正常 Windows 用户环境通过 OAuth/DPAPI/作品/基线/生成/发送/重启去重/超时暂停完整模拟；`npm run test:ui`、`npm run test:projects` 旧功能隔离回归通过。所有抖音和模型请求为夹具模拟，没有真实发评论。完整流程测试 preload 只在显式 --import 测试进程中生效。
- 生产后端更新前已核对 running=false,busy=false,browserOpen=false；先通过旧后端 backup API 备份，再切换。真实开放平台应用尚未配置，不能真实监听或自动回复。实际重启结果见本轮最终说明。

后端切换结果：备份 `data/backups/CommentPilot-1792373675711.sqlite`；重启成功 PID 41824，健康检查确认版本 0.4.0、transport=official、running=false。官方应用未配置、未授权，等待管理员接入；未自动启动监听。

下一步必要条件：获批的应用、实际 scope 和回调配置，验证个人账号资格/原图文作品兼容性，再做真实官方联调。完整媒体分析、生产 OAuth 代理、超大作品增量读取和新版安装包仍未完成。不要把协议模拟测试称作真实官方已验收。

## 最新核查：2026-10-19

用户咨询改为抖音官方 API、现有技术与违规风险。已完成公开官方文档和当前代码核对，详见 [抖音官方接口迁移评估](docs/抖音官方接口迁移评估.md)。当前仍是0.3.0浏览器自动化版，没有实现官方授权与评论通道；本轮未改动运行设置或发送评论。

已确认普通 `item.comment`、企业号 `video.comment`、小程序 `ma.item.comment` 文档路径不同；需要根据实际应用后台确认资格与权限，不能保证个人号获批。小程序回复路径明确不支持图集，对原图文作品尤其要先验证。当前 RPA 自动采集与回复有明确的平台协议风险，不能宣传为官方合规或零风险。

如果后续实施官方版，先核实应用类型、scope申请状态和作品类型，再按评估文档实施 OAuth、官方 ID、分页/事件、配额和发送核验；共享 client_secret 不应打进通用安装包。缺少权限时不以浏览器发送静默替代。此核查结论不代表官方版已完成，也不是具体违法认定。

本轮目标：供应商多型号和智谱、多作品管理与独立历史、输入知识库并绑定作品、按资料约束回复。

更新日期：2026-10-16。当前版本 0.3.0。本轮功能、测试、后端切换、安装包及覆盖升级/卸载验收均已完成。

## 已实现并通过测试

- 智谱供应商预设、云端厂家模型列表读取、同厂家新增型号并复用已加密 Key。
- 数据库 managed_works、knowledge_bases、knowledge_versions；原有作品自动注册。
- 每作品独立背景、模型、知识库绑定；作品切换时清除浏览器确认及旧资料。
- 知识库全文输入及 UTF-8 txt/md 导入；版本化保存、绑定引用保护。
- 生成时合并本作品知识库、正文、已核对 OCR、补充资料；记录知识库版本及全文快照；缺资料拒绝生成，资料冲突要求说明无法确认。
- 作品管理、知识库页面和按作品查看评论历史。
- 39 项单元测试、浏览器夹具、原 UI 集成测试、新 `test-projects.mjs` 集成测试通过。
- 新测试覆盖厂家模型 ID（不误用显示名称）、加密 Key 同源复制及跨厂家拒绝、知识库版本快照、作品切换资料隔离、缺资料不调用模型、文件导入、绑定、作品历史不改变当前作品和重启保留。
- 更新前已通过旧后端 `/api/backup` 创建一致性备份；新版后端已启动，原有 3 个作品自动登记，未启动真实监听。
- 0.3.0 免安装程序 Chromium、OCR、SQLite、DPAPI 检查通过。

## 已完成交付

- 安装包 `G:\res\release\CommentPilot-Setup-0.3.0-x64.exe`，320356818 字节；免安装程序 `release/win-unpacked/CommentPilot.exe`，分发须保留完整目录。
- `node scripts/verify-release.mjs` 通过：21 个源码文件一致，未打包用户数据路径，已生成 BUILD-INFO.json 和 SHA256SUMS.txt。
- 安装包 SHA256：`af6539ff2a67f82727850e181de4a04e73ecaf6a4ff231552d81acc257384227`。
- 0.2.1 到 0.3.0 覆盖升级、安装后的 Chromium/OCR/SQLite/DPAPI、卸载均通过；独立数据目录中完成，未影响开发数据。
- 当前后端已运行于 http://127.0.0.1:3210，版本0.3.0，切换时未开启监听。

## 下一次继续的起点

- 本轮无需重做核心功能或重新确认方案。先看当前版本、用户新反馈和实际监听状态，再决定下一项工作。
- 真实 DeepSeek 厂家列表、智谱生成与实际账号回复尚未用用户凭据逐项联调；本轮供应商调用用本地模拟服务验证，不声称真实厂家已全部跑通。
- 如果用户提供配置好的连接，可先做低成本模型测试，再按用户的工作台设置验证新评论链路，不打印 Key。
- 若用户要求多个作品同时监听，需要另建多任务调度与浏览器隔离；当前产品仅支持多作品管理和一次一个作品监听，不能直接开启多个共用全局 config 的循环。
- 知识库目前为30000字符上限全文输入与txt/md导入；大文档检索、PDF/Word解析和知识召回评估属于后续扩展。

## 实现地图

- `providers.js`：智谱预设、厂家模型读取；云服务选择模型 ID，Ollama 筛除已确认的非对话模型。
- `storage.js`：managed_works、knowledge_bases、knowledge_versions；schema_migrations 版本2；旧作品自动注册；同厂家复制密文 Key。
- `knowledge.js`：资料合并、作品/知识绑定校验、上下文 hash、资料长度上限。
- `server.js`：works / works-save / works-select、knowledge-list / knowledge-save / knowledge-delete；生成快照和发送前资料 hash 核验。
- `public/projects.js`：厂家多型号、作品管理、知识库输入/导入/绑定和历史入口；`public/management.js` 仍负责模型连接及历史主体。
- `test-projects.mjs`：独立3277端口、隔离数据库和模拟供应商，正常用户进程运行以验证 DPAPI。
- 安装器仍保留旧 appId 以兼容升级；`release` 中有历次安装包，交付应明确选最新版本，不能把整个 release 当用户数据备份分发。

## 实施边界

本轮支持多作品保存、切换和独立历史；现有浏览器监听当前一次处理一个作品，界面明确提示切换前暂停。没有实现多作品同时后台监听。知识库采用有上限的全文上下文，不依赖向量服务；不声称能完全消除模型幻觉。智谱实际调用需要用户自己的对应 API 权限和 Key。

运行方式 `npm start`，开发地址 http://127.0.0.1:3210。测试 `npm test`、`npm run test:browser`、`npm run test:ui`。构建 `npm run dist`。Windows DPAPI 测试需要正常用户进程，隔离沙箱可能无法解密。禁止打印真实 Key 或将 data 纳入打包。

本轮UI验证：桌面1440px截图已检查，390px无横向溢出、页面脚本零异常、三步布局/六处必填标识。后端经备份重启PID10144，仍暂停。截图data/ui-workflow.png仅本机，不纳入Git。

本轮服务更新PID25248，已备份，监听保持暂停。UI轮数显示3且脚本零异常。未打包、未发送真实评论。

0.12运行验收：备份data/backups/CommentPilot-1792457885638.sqlite后重启PID52468；health=0.12.0，personal-browser，running=false/busy=false，原4条评论及1个连接保留。自动维护默认false。新增test:service实际点击验证维护策略保存；85单元及service/personal/personal-browser/official/official-flow/projects/multiwork/diagnostics通过。实际页面零脚本异常、390px无横向溢出。官方服务及并发设置折叠到高级区。截图data/ui-service.png、data/ui-maintenance.png未纳入版本。

0.13运行验收：备份data/backups/CommentPilot-1792459064315.sqlite后重启PID43288；health0.13.0，running=false/busy=false，当前10条记录/2连接（用户本机数据，未用于模拟测试）。实际页面零脚本异常、390px无横向溢出。真实平台未发送，未打包。

0.13.1更新结果：先备份并通过browser-personal-enable安全关闭真实浏览器，保留登录资料，再重启PID60404；健康0.13.1，监听暂停，原uncertain未重发。90单元、service及注入一次刷新超时的personal-browser全流程通过。个人页签在已为个人模式时不重复请求模式修改，避免监听中无谓报错。

0.13.2验收：91单元通过，personal-browser包含工作台刷新不停止/起点不变和导航中断恢复断言，通过。后端在暂停状态备份重启，health确认0.13.2；未自动启动监听、未重发真实评论。
