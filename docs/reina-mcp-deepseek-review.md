# ReinaManager 游玩记录 MCP 与标签交互：设计评审

评审日期：2026-10-21。评审对象：`docs/superpowers/plans/2026-10-21-reina-mcp-integration.md`（184 行现行版）、`docs/reina-mcp-source-evidence.md`（875 行现行版）、`AGENT.md`、`docs/reina-mcp-deepseek-prompt.md`。
性质：**设计评审，不含任何实现**。全部结论分三类：**[事实]** 有源码行号依据；**[建议]** 评审意见；**[需实测]** 无证据，实施时必须先验证。

## 0. 实际执行的检查（如实记录）

- 已读：上述 4 份文档全文；`src/shared/types.ts`、`src/shared/ipc.ts`、`src/shared/errors.ts`、`src/shared/paths.ts`、`src/main/database/migrations.ts`、`src/main/database/connection.ts`、`src/main/index.ts`、`src/preload/index.ts`、`electron.vite.config.ts`、`package.json`、`src/renderer/src/App.tsx`、`GameOverview.tsx`、`features/journal/JournalWorkspace.tsx`、`journal-export.ts`、`journal-model.ts`、`src/main/ipc/journal-validation.ts`、`components/settings/SettingsPanel.tsx`、`styles/globals.css`（标签段）。
- grep 复核：`src/` 内 `modelcontextprotocol|InMemoryTransport|mcp` **零命中**，与证据文档“尚无 MCP 依赖”一致；`package.json:21-33` 确无 MCP SDK。
- **未执行**：`git status/diff`、`npm`、`vitest`、`tsc`、`electron-vite build`。本会话 shell 启动失败（`SetNamedSecurityInfoW failed (Win32 5)`，沙箱 ACL），按要求未改 ACL、未重试提权、未扩大读取范围。因此本报告**不**声称任何测试、构建或连接结果。

## 1. 已核实事实

| # | 事实 | 依据 |
| --- | --- | --- |
| F1 | `game_sessions` 五列全部非空：`start_time`/`end_time`/`duration` 为 i32，`date` 为 Text；`session_id` 为 `auto_increment = false` 的主键 | `game_sessions.rs:9-16` |
| F2 | **库中不可能存在未结束会话**（`end_time` 非 Option），因此“只读已持久化会话”“`liveSession: false`”有硬约束支撑，不是保守措辞 | `game_sessions.rs:12-14`；对照 `GameSessionTimeline.tsx:35-39` 的 `endTime?` 只是 UI 层内存态 |
| F3 | 分钟取整是**四舍五入**（`seconds/60 + (seconds%60>=30)`），非截断；低于 `MIN_SESSION_SECONDS` 的会话直接丢弃不落库 | `session.rs:23-25`、`session.rs:55-57` |
| F4 | `duration` 由计时模式决定：Playtime 用前台累计秒，Elapsed 用起止差；两者都再取整成分钟入库 | `session.rs:48-53`、`session.rs:86-91` |
| F5 | `date` 与日统计都按**写入当刻的 `Local`** 计算，`date` 取的是 `end_time` 的本地日期 | `game_stats_repository.rs:56-60`、`:443`、`:185-198` |
| F6 | 跨日分摊按“自然跨度比例 + 累计分钟取整”，是来源方自己的估算，不是实测有效时长 | `game_stats_repository.rs:200-215` |
| F7 | 来源自己的分页只按 `StartTime DESC` 排序，**无次级排序键**，offset 翻页在同秒并列时会丢/重 | `game_stats_repository.rs:504-506` |
| F8 | 汇总表字段可空：`total_time`、`session_count`、`last_played`、`daily_stats`(TEXT) 均 `Option` | `game_statistics.rs:11-15` |
| F9 | 来源 provider 实际有 7 个：`hikarinagi|bgm|vndb|erogamescape|dlsite|kun|ymgal`；参与 mixed 标签的是 `bgm`、`hikarinagi`、`dlsite`、`erogamescape`、`vndb`、`kun` | `displayMergeRules.ts:14-31`、`:49-56` |
| F10 | 显示名来源是 `custom_data.name` → 中文环境 `name_cn` → `name`；`games` 表**没有** name/tags 列 | `gameDisplay.ts:8-15`；`games.rs:19-45`；`custom_data.rs:41,53` |
| F11 | NatsumeNote 侧 `MetadataSource` 是 `'vndb'|'bangumi'` 闭集，且被 `game_sources.source` CHECK 与 `games.cover_source` CHECK 双重约束 | `types.ts:34`；`migrations.ts:117,126` |
| F12 | 标签现状：只渲染 `bestSource()` 命中来源的 `tags.slice(0,10)`，纯 `<span>`，无展开无选中；`.game-overview__tags span` 字号 9px | `GameOverview.tsx:16-21,32,57-60`；`globals.css:1063-1064` |
| F13 | 手账 tags 是自由文本（逗号分隔、上限 30），存 `journal_pages.tags_json`，与资料标签无公共键 | `JournalWorkspace.tsx:655`、`journal-validation.ts:125-127`、`migrations.ts:153` |
| F14 | `ErrorCode` 是闭集（8 个值），`AppError.code` 只接受它；UI 已有去前缀的 `getErrorMessage` | `errors.ts:1-9,22,46-63` |
| F15 | 本地库当前 `LATEST_SCHEMA_VERSION = 8`；`migrate()` 在 `user_version >= 8` 时提前返回，新表必须另起版本块 | `migrations.ts:8,81-84,204-205` |
| F16 | 主进程 main 由 electron-vite 以 `externalizeDepsPlugin` 构建，未声明 worker 入口、未改输出格式 | `electron.vite.config.ts:1-12` |

## 2. 问题清单与修正建议

### P0（不修则契约自相矛盾或运行期直接失败）

**P0-1 `snapshotId` 契约自相矛盾，且没有创建快照的工具。**
§4 第 67 行要求“数据工具的 `snapshotId` 必填”，但第 74 行的首个示例 `reina_list_sessions` 未传 `snapshotId`，第 91 行又称“第二个调用”复用“from-first-call”的快照；第 111 行要求 UI“首次进入先请求一个指定范围快照”，而 5 个工具里没有任何一个能产出快照。**建议**：新增只读工具 `reina_begin_snapshot`（入参 `sourceId, gameId, from?, to?`，返回 `snapshotId`、覆盖区间、`sessionRowCount`、`fetchedAt`），并把其余数据工具的 `snapshotId` 统一改为**必填**；或在 §4 明确“省略 `snapshotId` ⇒ 隐式新建快照并回传”，二选一写清，不要两种规则并存。

**P0-2 MCP SDK 的模块形态与 main 的 CJS 产物可能冲突 **[需实测]**。**
`electron.vite.config.ts:6` 用 `externalizeDepsPlugin()`，即 `@modelcontextprotocol/sdk` 会在运行期由 `require` 加载；若该包以 ESM-only 发布（`"type":"module"`，exports 仅提供 `import` 条件——本轮无法安装核对，属高风险待测），CJS 下静态 `require` 会 `ERR_REQUIRE_ESM`。**建议**：A) 明确用动态 `await import()` 在 `app.whenReady()` 后加载 SDK，或用 B) 给 main 改 ESM 输出（Electron 31 支持，但需整体回归）。二者必须写进 §8 B 的验收，不能留到实现时才发现。

**P0-3 worker 引入三项未列入计划的构建/运行风险。**
§5 第 109 行的“超时取消并终止/重建查询 worker”在 `better-sqlite3` 上不成立：其调用是同步原生调用，`worker.terminate()` **无法中断进行中的 native 调用**，只能等其返回。实际时间上界 = `busy_timeout(500ms)` + 查询耗时，而非 3s。另两点：worker 入口文件需在 `electron.vite.config.ts` 的 rollup input 中声明（现无）；`better-sqlite3` 在 `worker_threads` 内加载需实测（asar + Electron ABI 双重变量）。**建议**：§5 改为“超时后**丢弃响应并重建 worker**，不承诺立即打断”，并在 §8 把 `electron.vite.config.ts` 列进改动文件、增加一条 worker 加载冒烟验收。若不想承担该风险，替代方案是沿用本仓库既有做法（`main/index.ts` 全同步 SQLite），以“固定 SQL + 索引 + 500ms busy_timeout + 结果集上限”换取一致性——这更贴合现有架构，代价是极端慢查询会卡主进程。

### P1（会造成错误数据或错误标注）

**P1-1 秒/分钟混用：`recordedDurationSeconds` 是伪精度 **[事实+建议]**。**
`duration` 是四舍五入后的分钟（F3），`duration × 60` 得到的是“分钟粒度”的值，冠以 `Seconds` 会让下游（未来外部 MCP 客户端、导出、卡片）按秒级精确显示。建议把契约字段改为 `recordedDurationMinutes`（源值，权威）+ `recordedDurationSecondsEstimate`（派生，明确 `durationPrecision: "minute-rounded"`），并禁止 UI 直接展示派生值；只有 `elapsedSeconds`（起止差）才是真秒。

**P1-2 未把“短会话被源丢弃”“汇总表可能陈旧”转成 warnings。**
F3 说明低于阈值会话不落库，F8 说明汇总列可空、`:181-183` 说明异常行会让来源自己的投影计算失败。因此 `reina_get_stats` 除 `total_time×60` 与 `Σduration×60` 不符外，还应输出 `warnings[]`：`SOURCE_DROPS_SHORT_SESSIONS`、`SOURCE_PROJECTION_MISSING`（`total_time` 为 NULL 时字段必须为 `null` 而非 0）、`SOURCE_ROW_INVALID`(n)。`sourceLifetimeSessionCount` 也需与快照内行数比对，不能只比时长（现计划只比了时长）。

**P1-3 `last_played` 语义未证实，不能当作“最后游玩时间”直接展示 **[需实测]**。**
证据里没有 `last_played` 的写入代码，无法判断它等于最后 `start_time`、`end_time` 还是含其他口径；时间戳单位也只能由其他列类推。建议先按“来源保存值”处理（`sourceLastPlayedAtRaw` + `semantics: "unverified"`），并用快照内 `max(startedAt)` 计算一个本地可解释值并列展示；【实测项】在合成库上核对两者是否一致。

**P1-4 `daily_stats` 不得透传。**
`game_statistics.daily_stats` 是 TEXT（F8），可含任意长度 JSON 与来源自己的分摊估算（F6）。计划第 95 行已决定“不提供按日有效时长图”，那就应显式**不在任何工具返回值中出现 `daily_stats`**（也不出现 `game_sources.data` 原始 JSON、`localpath`/`executable`/`savepath`），并在 §5 增加“字段拒列清单”，避免实现时顺手透传。

**P1-5 标签来源只有 3 类，但来源实际有 7 个 provider **[事实+建议]**。**
§7 第 139 行写“VNDB / Bangumi / ReinaManager 自定义”，而 F9 有 7 个 provider，其中 6 个会产生标签。§5 第 107-108 行已说“未知 provider 保留诊断”，两处需统一为：`ReinaTagProvider = 'vndb' | 'bangumi' | 'hikarinagi' | 'dlsite' | 'erogamescape' | 'kun' | 'ymgal' | 'custom'`，`bgm → bangumi` 是**唯一**别名归一化；UI 对 `vndb`/`bangumi` 显示专有名，对 `custom` 显示“自定义”，其余 5 个显示规范化后的原始 id（中性色），不得并入 VNDB/Bangumi，也不得静默丢弃。

**P1-6 “中文名/原名”在标签上没有合法来源。**
游戏名有 `name_cn`（F10，`vndbAdapter.ts:52`、`bgmAdapter.ts:55`），但标签只有 provider 原始字符串；工作区唯一的中文标签字典是 ReinaManager 的 `tagTranslation.ts:9` 引入的 `_VndbTag_zh_CN.json`，且该文件头声明 `@copyright AGPL-3.0`（`tagTranslation.ts:5-6`），与 §7 第 142 行“不能复制 AGPL 翻译字典”直接冲突。**建议**：v1 明确“标签显示来源原文”，把“中文名/原名”降级为可选后续能力（用户自建本地别名，或改用允许许可的数据源），不要再把“中文名优先”写成首版要求。Bangumi 标签本身多为中文，不需要翻译。

**P1-7 `bestSource()` 会让标签来源与筛选覆盖率不完整 **[事实]**。**
`GameOverview.tsx:16-21` 只选一个 matched 来源，`:57-60` 只渲染它；当 VNDB 有 40 个标签、Bangumi 只有 5 个时，用户看到的标签集取决于哪边有 `summary`。§7 第 141 行要求索引“覆盖已缓存的全部匹配资料”，因此渲染层也必须从 `metadata.sources` 中**多个** matched 来源聚合，并逐标签标注 provider；否则会出现“索引里有、页面上看不到”的筛选不一致。

**P1-8 `game_tag_index` 缺少唯一约束、索引刷新时间与级联删除。**
§6 第 126 行给出了列，但没有：① 唯一键——建议 `UNIQUE(connection_source_id, local_game_id, tag_provider, raw_key)`，否则重复刷新会累积重复标签；② 索引级刷新时间——`fetched_at` 逐行会让 UI 无法给出 §7 第 141 行要求的“索引刷新时间”，建议另存 `tag_index_refreshed_at`（按来源/按作品）；③ 外键——`local_game_id` 与 `connection_source_id` 都应 `ON DELETE CASCADE`（本仓库已在 `migrations.ts:73` 全局启用 `foreign_keys`，既有表均用 CASCADE，见 `:136`/`:158`/`:175`）；④ `external_game_links.external_game_id` 必须是 TEXT，禁止数值化（本地 `games.id` 是 TEXT，`migrations.ts:14`；来源是 i32）。

**P1-9 筛选选择状态在索引刷新后可能静默失效。**
`custom_data.tags` 无 ID（`custom_data.rs:53`），按 §7 第 139 行 key 退化为“规范文本”；用户在 ReinaManager 改名后，刷新会得到新 key，旧选中项消失却仍显示“筛选中(1)”。建议：选中态按 `(tag_provider, raw_key)` 保存，索引替换后**显式**提示“有 1 个筛选条件已失效”并自动移除，而不是返回空结果。

### P2（体验与一致性）

- **P2-1 `getGames()` 无参数**（`ipc.ts:227`、`preload/index.ts:159`），“在本地作品中筛选”需要新增独立通道（如 `library:list-games-by-tags`）而不是改现有签名，避免波及 `App.tsx:96,126,705` 的既有查询链路；返回需带 `totalCount` 与 `matchedLocalGameIds`。
- **P2-2 9px 标签字号**（`globals.css:1064`）不满足可点击目标；可选 chip 建议 ≥12px 字号、≥24px 高、`focus-visible` 描边，复用主题 token。
- **P2-3 手账卡片若新增 block 类型，有三处三目兜底会静默错标**：`JournalWorkspace.tsx:528-529`、`:622`、`:638` 的标签文字以链式三目结尾落到“视频/旧详情卡”，新增类型必须同步；主进程 `journal-validation.ts:14` 的 `JOURNAL_BLOCK_TYPES` 与 `:16` 的 `METADATA_SOURCES` 是白名单，`journal-export.ts:64-82` 的 `renderBlock` 是导出 switch，三处都要改，否则改动会被主进程拒绝或导出丢块。
- **P2-4 `snapshotId` 是能力令牌**：应绑定 `{sourceId, gameId, rangeHash, contractVersion}` 并不可猜测，跨作品复用要拒绝（计划只写了“跨来源拒绝”）。
- **P2-5 from/to 只在渲染层按用户时区计算**，主进程不解释“本地日”；`sourceRecordedDate` 标注为“写入时本机时区、以结束时间记”的**来源原值**，禁止当本地游玩日排序或分组。

## 3. MCP 角色与生命周期

**角色边界（与计划 §3 一致，建议写成表格进设计）**

| 角色 | 职责 | 明确不做 |
| --- | --- | --- |
| 渲染进程 | 只通过 preload 白名单 IPC 取数据 | 不接触 transport、路径、SQL |
| 主进程 MCP client | 发起 `initialize`/`tools/list`/`tools/call` | 不直接读源库 |
| 进程内 MCP server | 参数校验、快照生命周期、错误码 | 不接受路径、不连网络、不写库 |
| 只读 adapter/worker | 固定 SQL、只读连接、行级规范化 | 不迁移、不改 `journal_mode`、不 checkpoint |
| 本地 IPC/绑定层 | 选择文件、绑定作品、插卡片 | **不暴露为 MCP 工具** |

**生命周期缺口**：① 工具集应固定为只读集合，§8 B 需加断言 `tools/list` 恰为这些工具且全部 `annotations.readOnlyHint === true`，不存在任何写工具；② 断开/退出顺序应为 `client.close() → server.close() → 清空快照 → worker.terminate() → db.close()`，而 `main/index.ts:769-773` 现有 `before-quit` 只关 `galmusic.db`，需挂接新清理；③ 热重载重复注册（计划 §5 第 116 行已指出）应以幂等注册函数实现，并由测试覆盖；④ 来源枚举（列出已授权连接）走本地 IPC，**不是** MCP 工具——这点计划未写明，容易误加一个 `reina_list_sources` 工具。

## 4. 查询工具核查（3 个具名工具 + 结构化返回 + 2 个调用示例）

统一成功外层沿用计划 §4 第 67 行；下表的 `data` 为 `structuredContent.data`。

| 工具 | 只读 | 关键输入 | 结构化返回要点 |
| --- | --- | --- | --- |
| `reina_begin_snapshot` | 是 | `sourceId, gameId, from?, to?` | `snapshotId, coverage{from,to}, sessionRowCount, invalidRowCount, fetchedAt, schemaProfile` |
| `reina_list_sessions` | 是 | `sourceId, gameId, snapshotId, limit=50(≤100), cursor?` | `sessions[]`，每项含 `sourceSessionId, startedAt, endedAt, sourceDurationMinutes, recordedDurationSecondsEstimate, elapsedSeconds, sourceRecordedDate, durationPrecision:"minute-rounded", trackingMode:"unknown", recordKind:"unknown"`，加 `nextCursor` |
| `reina_get_tags` | 是 | `sourceId, gameId, limit=100, cursor?` | `tags: [{tagProvider, rawKey, label, hasSourceId:false}]`、`warnings[]`、`nextCursor` |

补两个计划已有、本评审同样要求的工具：`reina_get_connection`（`readable, schemaProfile, capabilities{liveSession:false}, lastReadAt, warnings`，不含路径）、`reina_list_games`（`gameId, displayName, titleSource, externalIds[], tagCount`）。`reina_get_stats` 见 P1-2。

**调用示例 1（首屏）**：先 `reina_begin_snapshot({sourceId:"src-a", gameId:"42"})` → 得 `snapshotId:"snap-1"`；再 `reina_list_sessions({sourceId:"src-a", gameId:"42", snapshotId:"snap-1", limit:20})`。

```json
{ "contractVersion": 1, "sourceApp": "ReinaManager", "sourceId": "src-a", "snapshotId": "snap-1",
  "fetchedAt": "2026-10-21T06:00:00Z", "warnings": [],
  "data": { "sessions": [ { "sourceSessionId": "103", "startedAt": "2026-10-20T12:00:00Z",
    "endedAt": "2026-10-20T13:00:00Z", "sourceDurationMinutes": 42,
    "recordedDurationSecondsEstimate": 2520, "elapsedSeconds": 3600,
    "sourceRecordedDate": "2026-10-20", "durationPrecision": "minute-rounded",
    "trackingMode": "unknown", "recordKind": "unknown" } ],
    "nextCursor": "cur-opaque-1" } }
```

**调用示例 2（同期统计）**：`reina_get_stats({sourceId:"src-a", gameId:"42", snapshotId:"snap-1", from:"2026-10-13T00:00:00+08:00", to:"2026-10-20T00:00:00+08:00"})`，返回 `sourceLifetimeTotalSeconds | null`、`sourceLifetimeSessionCount`、`sourceLastPlayedAtRaw`、`selectedSessionsTotalSeconds`、`selectedSessionsCount`、`selectionPolicy:"session-start-in-range"`、`warnings:[{code:"SOURCE_DROPS_SHORT_SESSIONS"}]`。两值不符时**并列展示**，不相加、不互相覆盖。

## 5. 标签交互（与手账 tags 严格分开）

- **数据边界**：资料标签（provider + 文本，`types.ts:118`）与手账标签（自由文本、≤30、`journal_pages.tags_json`，F13）**不是同一概念**，不得共用一个可写组件。建议 `TagChips.tsx` 只服务作品资料标签（只读投影 + 本地筛选态），手账侧保留现有逗号输入（`JournalWorkspace.tsx:655`）；两者可共享 CSS 类名，不共享数据通道。
- **展开/折叠**：默认 12 个 + “展开全部（N）”；折叠只改渲染数量，不清空选择；阈值以 960×640 实测两行高度为准，不硬编码 12。
- **选择/筛选/清空**：`<button aria-pressed>`，选中态用主题色 + 勾选图标（不只靠颜色）；“在本地作品中筛选（N）”“清空筛选”常驻；AND 语义与结果数同屏可见；取消筛选回到原列表并保留滚动位置。
- **来源标记**：每个 chip 显示 provider 缩写或色点（`vndb`/`bangumi`/`custom`/其他原始 id）；同一文本不同 provider 不合并；同 provider 同文本由不同来源实例带来时，**展示层去重**、保留 `connection_source_id` 溯源。
- **中文名/原名**：v1 显示来源原文（见 P1-6），不做翻译；如需“查看原名”，用可聚焦的展开说明区，不依赖 `title`。
- **溢出与长文本**：标签组 `flex-wrap`；单标签 `max-width` + `text-overflow`，完整文本可通过键盘可达的弹层/展开区查看；总标签数受工具分页约束，展开不触发整库读取。
- **空态三分**：“未关联来源”“来源无标签”“标签读取失败（可重试）”；加载态保留占位高度，避免布局跳动。
- **无障碍**：Enter/Space 可切换，焦点可见；筛选结果数只在一个 `role="status"` 区播报，避免每个 chip 各自播报；`prefers-reduced-motion` 下取消 120–160ms 过渡。

## 6. 建议的最小实现文件范围（含计划遗漏）

- 已有计划覆盖：`src/main/integrations/reina/{adapter,mapper,query-worker,snapshots,mcp-server,mcp-client}.ts`、`src/shared/reina.ts`、`src/main/database/queries/external-play.ts`、`src/main/ipc/reina-handlers.ts`、`ReinaConnectionPanel.tsx`、`PlayHistoryPanel.tsx`、`TagChips.tsx`、`shared/ipc.ts`、`preload/index.ts`、`main/index.ts`、`migrations.ts`、`SettingsPanel.tsx`、`App.tsx`。
- **计划遗漏，需补入 §8**：`src/shared/errors.ts`（新增错误码必须扩 `ErrorCode` 闭集，F14）、`electron.vite.config.ts`（worker 入口/模块格式，F16）、`src/main/ipc/validation.ts` 复用说明（新 handler 的参数校验）、`package.json` + lockfile（SDK 与 zod 版本**成对锁定**）、`src/renderer/src/styles/globals.css`（chip 样式替换 9px 规则）。
- 本轮不新增外部 stdio 入口、不改 `MetadataSource`/`CoverSource`、不复用 `game_sources`（F11 的两个 CHECK 会直接拒绝 `reinamanager`）。

## 7. 验收场景（全部基于合成 SQLite，不碰真实库）

1. 分钟→秒：42 分钟会话输出 `sourceDurationMinutes:42` 且派生秒数为估算字段；起止差 3600 与记录 2520 同时可见且不相减。
2. 端到端转四舍五入：`duration=1` 的会话（实际 30–89 秒）显示为 1 分钟，UI 不得出现秒级“精确”。
3. 异常行隔离：`start_time<=0`、`end_time<=start_time`、`duration<=0` 的行被排除并计入 `invalidRowCount`，不生成 1970 年记录。
4. 汇总缺失：删掉 `game_statistics` 行 → `sourceLifetimeTotalSeconds: null` + `SOURCE_PROJECTION_MISSING`，绝不显示 0。
5. 汇总与行累计不符 → 两值并列 + warning，不相加。
6. 跨午夜：`23:40→01:10` 的 90 分钟记录，`elapsedSeconds` 与 `sourceDurationMinutes` 不同；`sourceRecordedDate` 等于“结束日”，界面标注来源口径。
7. 分页稳定：同 `start_time` 的 3 条会话按 `(start_time DESC, session_id DESC)` 翻页，两页无重无漏（对比来源只按 `StartTime DESC`，F7 说明这是本设计的改进）。
8. 快照边界：`snapshotId` 跨作品/跨来源被拒；过期 cursor 返回 `SNAPSHOT_EXPIRED` 而不是拼接新快照。
9. 只读证明：对源库执行任意写语句返回只读错误；源库 `journal_mode` 未被改变；连接后不创建新表。
10. 自指拒绝：选中 NatsumeNote 自己的 `galmusic.db`（含改名的副本）被拒——除路径比对外，再校验 schema 签名（无 `game_sessions`/`games.id_type`）。
11. 标签：`bgm → bangumi` 归一化；5 个未映射 provider 以诊断形式出现且不标成 VNDB；`custom_data.tags` 标为自定义；40+ 标签展开后选择保留。
12. 手账隔离：插入/删除/查询标签不影响 `journal_pages.tags`，反之亦然；删除本地作品级联清理索引与绑定，不触碰源库。

## 8. 剩余风险与待实测

- **[需实测]** SDK 模块形态与 CJS/ESM（P0-2）、`better-sqlite3` 在 worker_threads + asar 下加载（P0-3）、`query_only` 与只读 WAL 组合是否可用（打开时 `-shm` 是否存在）、`last_played` 语义（P1-3）。
- **[事实]** 不能用 `mtime`/文件大小做“来源身份”：ReinaManager 运行中持续写库会让字节级指标持续变化，必然误报 `SOURCE_REPLACED`。应使用卷序列号 + 文件索引（稳定跨写），`mtime` 只作“上次读取”参考。
- **[事实]** `game_sessions` 无 `updated_at`，也无删除流，因此“每次刷新取新快照”是唯一正确策略，本评审认同计划 §5 第 115 行；但卡片快照里的 `sourceSessionId` 只能当**引用**（`session_id` 非 AUTOINCREMENT，删除后可能被复用），必须标注“可能已失效”。
- 计划 §9 的未完成项（DeepSeek 评审、文档提交）与本报告对应；本报告只是评审输入，**Codex 仍负责最终验收与修正采纳**。


## 9. Codex 最终复核与采纳记录

本节由 Codex 在 DeepSeek 交接后补充。上文是针对较早设计快照的独立意见，行号和“未完成”描述不随最终设计自动更新；最终接口以 [整合方案](superpowers/plans/2026-10-21-reina-mcp-integration.md) 为准，不以本报告中的建议示例替代契约。

- 已明确首次调用不传 snapshotId/cursor 时隐式创建快照；返回 snapshotId 必填。无需额外 begin_snapshot 工具，因此未采用评审示例中的工具名。
- 已将同步数据库操作隔离方案改为 Electron utilityProcess 查询进程，要求超时返回、进程清理和原生模块加载验收；拒绝把慢查询转回主进程的建议。当前没有实现或验证该进程。
- MCP SDK 的 ESM-only/CJS 冲突是条件性风险，评审没有检查实际所选 SDK 的 exports，不能据此断言项目存在该故障。实施时先核实依赖和构建后导入；不预先改造整个主进程模块格式。
- 补充源码证据 `game_stats_repository.rs:303-322` 已显示 last_played 在当前版本按 session.end_time 更新。因此评审“缺少写入口径证据”的问题已补齐；安装版记录是否匹配仍须只读实测。
- 已纳入分钟精度说明、缺失汇总为 null、来源会话数核对、独立错误码到 IPC 映射、标签 provider 隔离、其他未解析来源诊断、失效筛选清理、标签全库索引与手账校验白名单验收。
- 没有采用强制把 recordedDurationSeconds 改名为 Estimate：最终字段表示将来源整分钟换算为秒，sourceDurationMinutes 与 durationPrecision 已明确精度，不声称秒级有效时长测量。
- 真实 MCP 调用、查询进程退出、源 SQLite/WAL 并发和界面操作均属于后续实施验收。本轮只检查文档内容、引用和 Git 提交范围，不报告应用测试通过。
