# Reina MCP 实现审查报告

> 以下为 DeepSeek 对收尾前版本的静态审查发现，不代表最终状态。Codex 后续处置见文末；最终代码已通过 518 项测试、类型检查、构建和两个 Electron smoke 检查。

只读审查范围：`src/main/reina/{service,engine,mcp,query-process,query-entry,validation,file-identity,tag-index,adapter}.ts`、`src/main/ipc/reina-handlers.ts`、相关 migrations/tests。当前 `mcp.ts`、`engine.ts` 已按最新版本复核；F1/F5–F11 所在文件自上次核对未发现变化。Codex 的 510 tests/build/UI/native smoke 通过，但未覆盖下列行为。

## F1 · High — 来源替换后没有重关联入口，断开即级联删除绑定
- File: `src/main/reina/service.ts:45,49-59,69-74`; `src/main/database/migrations.ts:211-217`
- Repro: 替换/移动 Reina DB → 查询提示“请断开后重新选择” → 断开删除 `external_play_sources`，FK 级联清空 `external_game_links`/`game_tag_index`；重连得新 UUID，原绑定不可恢复。Fix: 增加 identity-changed 状态与重关联（保留 source id，按资料 ID 复核）；断开前明确警告，或只失效读取、保留绑定。

## F2 · Medium — MCP/IPC 错误码与可操作分类仍在客户端/IPC 丢失
- File: `src/main/reina/mcp.ts:31-33,46`; `src/main/reina/query-entry.ts:18-19`; `src/main/ipc/reina-handlers.ts:23-27`
- Repro: 缺表/占用/无读权限 DB 在 UI 均显示通用“无法读取数据库”；`mcp.call` 只抛 message、丢弃 `{code,retryable}`，IPC 全包 `DB_ERROR`，连参数解析错误也显示 DB_ERROR；`service.ts:45` 的“已移动”不匹配 `mcp.ts:46` 的 `/^授权数据库已被替换/`。Fix: 保留 structuredContent 的 code/retryable；query-entry 区分 schema/busy/permission/data-limit；IPC 区分协议/业务错误并统一 moved 模式。

## F3 · Medium — get_stats 未在已有快照覆盖范围内筛选
- File: `src/main/reina/engine.ts:34,42-44`
- Repro: 全月范围建立快照后，用同一 `snapshotId` 请求 10-10~10-11 的 `get_stats` → 报“快照已失效”，未在覆盖内过滤，也未返回 INVALID_INPUT。Fix: 快照记录覆盖 from/to；`get_stats` 在覆盖内对快照会话过滤，不覆盖时报 INVALID_INPUT。

## F4 · Medium — 未知 gameId 被当作空结果而非 INVALID_INPUT
- File: `src/main/reina/engine.ts:23-29,61-66`; `src/main/reina/adapter.ts:630-657`
- Repro: 未绑定来源传 `gameId:999999` 调 `reina_list_sessions`/`get_stats`/`get_tags` → 成功返回空会话、0 累计、空标签（方案 §4 第 63 行要求 gameId 必须存在）。Fix: 所有 game 级工具在 `create` 前校验来源 `games()` 中存在该 id，否则抛 INVALID_INPUT。

## F5 · Medium — 单条非法会话行导致整次读取失败
- File: `src/main/reina/adapter.ts:780-798,845-856`; `tests/main/reina-adapter.test.ts:664-672`
- Repro: 插入 `duration=0` 或 `end_time<start_time` 的任意一行 → `sessions`/`snapshot`/`stats` 全部抛 `SCHEMA_UNSUPPORTED`，无 `rejectedRecordCount/warnings`；测试目前固化了该 fail-closed 行为。Fix: 隔离坏行并返回 rejected 计数/warnings；若产品坚持 fail-closed，需同步修改方案 §5/§8 与验收文案。

## F6 · Medium — 标签刷新失败阻断已成功的 stats 响应
- File: `src/main/reina/service.ts:125-135`
- Repro: 绑定作品后让源库在 stats 读取后变为不可读/被占用 → 标签同步抛错，整个 `reina_get_stats` 请求失败，而不是返回 stats + 标签警告。Fix: 标签同步单独 try/catch，失败只记 warning 并保留旧索引。

## F7 · Medium — 全库标签筛选只按名称匹配，忽略 provider
- File: `src/main/reina/tag-index.ts:30-35`; `src/shared/reina.ts:28`
- Repro: VNDB 与 Bangumi 各有同名标签“剧情”，筛选 `['剧情']` 同时命中，无法按来源取消；SQL 使用 `name IN (...)`/`COUNT(DISTINCT name)`，`provider` 未参与（方案 §7 第 145 行要求 provider+真实 ID 稳定 key）。Fix: IPC/索引入参改为 `{provider,name}[]` 或稳定 key，SQL 按 provider+name 做 AND。

## F8 · Low — 断开来源不停止查询子进程；退出关闭顺序存在竞态
- File: `src/main/reina/service.ts:69-74`; `src/main/index.ts:774-778`; `src/main/reina/query-process.ts:43`
- Repro: 断开后 query utility 进程继续存在直到应用退出；退出时 `void reina.close()` 后立即 `db.close()`，在途回调可能访问已关闭 DB（仅退出路径）。Fix: 断开最后来源/退出时停止 child 与 MCP，并 await close 后再关 DB。

## F9 · Low — get_connection 返回未注册的随机 snapshotId
- File: `src/main/reina/engine.ts:30-33`
- Repro: `reina_get_connection` 返回随机 UUID 但未写入 snapshots；客户端若用于后续查询会立即得到“快照已失效”（方案允许该字段为 null）。Fix: 返回 null 并放宽共享类型，或注册一个真实空快照。

## F10 · Low — 来源汇总值只检查整数，未检查安全整数
- File: `src/main/reina/adapter.ts:641-651`
- Repro: 超大 `sourceTotalMinutes`/`sourceSessionCount` 通过 `Number.isInteger`，统计显示失真；会话累计已用安全整数检查（方案 §5 第 121 行要求）。Fix: 改用 `Number.isSafeInteger`，越界按 null/缺失处理。

## F11 · Low — 缺少“由有效会话派生的最近结束时间”
- File: `src/main/reina/adapter.ts:652`; `src/main/reina/engine.ts:66`
- Repro: stats 仅有来源 `last_played`，UI 无法显示方案第 101 行要求的会话派生最近结束时间并单列来源值。Fix: `ReinaStats` 增加 derivedLastPlayed（有效会话 endTime 最大值），来源值另列核对。

## 已确认无问题
- 只读约束：`adapter.ts:696-706` 的 `readonly`、`fileMustExist`、`query_only=ON` 并核验。
- 预览绑定未发现绕过：5 分钟内 `list_games` 预览 + 重新读取比对名称/外部 ID + 占用检查 + 事务写入（`service.ts:90-102`）；UI 确认仅是 UX 层。
- 快照跨来源/作品/范围/cursor 篡改被拒绝（`engine.ts:37-45` 及测试）；50,000 行/16 MiB/4 快照/64 MiB 边界显式拒绝。
- MCP/IPC 不暴露 path/SQL，连接路径仅来自原生对话框；未发现路径泄露。


## Codex 处置（2026-10-21）

| 发现 | 最终处理 |
| --- | --- |
| F1 | 已修复：原生选择同一路径的新文件保留 sourceId/旧关联，标为 needs_confirmation，旧关联和标签不可自动读取；作品概览有重新确认提示。断开说明明确本地清理范围。 |
| F2 | 已修复：query-entry、utilityProcess、MCP client 保留安全分类；schema/busy/permission/limit 有不同固定消息。IPC 参数错误保留 INVALID_ARGUMENT，其余映射既有 DB_ERROR，不扩展旧错误枚举。 |
| F3 | 已修复：同一快照覆盖内的子范围统计从固化会话计算，越界 INVALID_INPUT。 |
| F4 | 已修复：MCP 查询创建快照前验证作品存在，未知作品 INVALID_INPUT；适配器内部低层空结果不直接暴露为工具成功。 |
| F5 | 有意采用保守方案：无效会话使整次读取失败，不跳过后伪装完整合计。使用说明与实施记录已说明区别。 |
| F6 | 已修复：标签刷新单独捕获失败，保留旧索引，返回成功统计并提示。 |
| F7 | 已修复：标签 key 为 provider:name，UI 独立选择，SQL 按 provider/name 组合 AND 匹配。 |
| F8 | 已处理：最后断开停止查询进程；共享进程内 MCP 随服务退出关闭。异步返回后检查服务状态，再访问本地库；子进程在 close 的同步部分停止。 |
| F9 | 已修复：连接诊断 snapshotId=null，不再产生无效随机快照号。 |
| F10 | 已修复：来源汇总使用 Number.isSafeInteger，越界保留为 null。 |
| F11 | 已修复：sessionLastPlayed 从当前快照有效会话最大结束时间计算，UI 与 sourceLastPlayed 分列。 |

本审查不包含对真实用户数据库的运行验收，也不代表任意 ReinaManager 版本均兼容。
