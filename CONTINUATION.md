# CommentPilot 开发交接记录

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
